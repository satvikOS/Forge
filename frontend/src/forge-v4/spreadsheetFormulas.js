// Forge-153 — Spreadsheet formula tokenizer + recursive-descent parser
// + evaluator. Deliberately NOT eval(): a real grammar that can never
// escape into JS land.
//
// Grammar (precedence climbing — operators listed low → high):
//
//     expr      = or
//     or        = and  ( "OR"  and )*
//     and       = not  ( "AND" not )*
//     not       = "NOT" not | cmp
//     cmp       = add  ( ("="|"<>"|"<="|">="|"<"|">") add )*
//     add       = mul  ( ("+"|"-") mul )*
//     mul       = pow  ( ("*"|"/"|"%") pow )*       // % is modulo
//     pow       = unary ( "^" unary )*               // right-assoc
//     unary     = ("+"|"-") unary | postfix
//     postfix   = atom ( "%"_unary_postfix )?        // 50% → 0.5
//     atom      = NUMBER
//               | STRING
//               | "(" expr ")"
//               | IDENT "(" args? ")"
//               | CELLREF [ ":" CELLREF ]            // range
//               | NAME                               // binding / constant
//     args      = expr ( "," expr )*
//
// CELLREF tokens take the form `[$]?col[$]?row`. The leading "$" marks
// the part as absolute; for evaluation we don't care (no copy-paste
// in this slice), but we record + render the form faithfully.
//
// Supported functions (case-insensitive):
//   SUM, AVG/AVERAGE, COUNT, MIN, MAX, ROUND, ABS, IF, AND, OR, NOT,
//   SIN, COS, TAN, ASIN, ACOS, ATAN, SQRT, EXP, LOG, LN, MOD, POWER,
//   INTERSECT, PI, E.
//
// Cell ranges (A1:B3) expand into a flat list of values during
// evaluation; functions that take ranges (SUM, AVG, …) see this
// expansion automatically.
//
// `parseFormulaDeps(src)` walks the same tokens but returns ONLY the
// set of cell ids the formula touches — used by spreadsheetStore.js to
// build the dependency graph BEFORE evaluation. This way the store can
// always trust the deps even when evaluation throws.

// ── tokenizer ────────────────────────────────────────────────────────

const T_NUM  = 'num';
const T_STR  = 'str';
const T_ID   = 'id';
const T_CELL = 'cell';
const T_OP   = 'op';

function tokenize(src) {
  const out = [];
  const s = String(src);
  let i = 0;

  function emit(k, v) { out.push({ k, v }); }
  function pushOp(o) { out.push({ k: T_OP, v: o }); }

  while (i < s.length) {
    const c = s[i];

    // Whitespace.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // String literal (single OR double quote, doubled-quote escape).
    if (c === '"' || c === '\'') {
      const quote = c;
      let j = i + 1;
      let buf = '';
      while (j < s.length) {
        if (s[j] === quote) {
          if (s[j + 1] === quote) { buf += quote; j += 2; continue; }
          break;
        }
        buf += s[j++];
      }
      if (j >= s.length) throw new Error('unterminated string literal');
      emit(T_STR, buf);
      i = j + 1;
      continue;
    }

    // Number — integer + optional fractional + optional exponent.
    if ((c >= '0' && c <= '9') ||
        (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      let j = i;
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      if (s[j] === '.') {
        j++;
        while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      }
      if (s[j] === 'e' || s[j] === 'E') {
        j++;
        if (s[j] === '+' || s[j] === '-') j++;
        while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      }
      emit(T_NUM, parseFloat(s.slice(i, j)));
      i = j;
      continue;
    }

    // Identifier OR cell reference OR named binding. Both start with
    // a letter (or '$' for absolute cell ref). We disambiguate after
    // reading the run.
    if (c === '$' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let j = i;
      // Possible leading '$' for the column-absolute marker.
      if (s[j] === '$') j++;
      const colStart = j;
      while (j < s.length && ((s[j] >= 'A' && s[j] <= 'Z') ||
                              (s[j] >= 'a' && s[j] <= 'z'))) j++;
      const colEnd = j;
      // Optional '$' before the row, then digits → cell ref.
      let saveJ = j;
      if (s[j] === '$') saveJ = j + 1;
      let rowStart = saveJ;
      let rowEnd = rowStart;
      while (rowEnd < s.length && s[rowEnd] >= '0' && s[rowEnd] <= '9') rowEnd++;

      const looksLikeCell =
        colEnd > colStart &&
        rowEnd > rowStart &&
        // Column letters in a real cell ref are uppercase OR lowercase
        // BUT identifiers can't start with $ — that's what gates this
        // away from variable names. We also reject identifiers that
        // continue past the digits with letters/underscores.
        !(rowEnd < s.length && (
          (s[rowEnd] >= 'A' && s[rowEnd] <= 'Z') ||
          (s[rowEnd] >= 'a' && s[rowEnd] <= 'z') ||
          s[rowEnd] === '_'
        ));

      if (looksLikeCell) {
        const colAbs = s[i] === '$';
        const rowAbs = s[saveJ - 1] === '$' && saveJ === j + 1;
        const colTxt = s.slice(colStart, colEnd).toUpperCase();
        const rowTxt = s.slice(rowStart, rowEnd);
        emit(T_CELL, {
          col:    colTxt,
          row:    parseInt(rowTxt, 10),
          colAbs, rowAbs,
          id:     colTxt + rowTxt,
        });
        i = rowEnd;
        continue;
      }

      // Otherwise it's an identifier (function name or binding). Allow
      // alphanumeric + underscore tail.
      let k = i;
      if (s[k] === '$') {
        // Bare '$' isn't a valid identifier — fall through to the
        // operator/error path.
        throw new Error(`unexpected '$' at position ${i}`);
      }
      while (k < s.length && (
        (s[k] >= 'A' && s[k] <= 'Z') ||
        (s[k] >= 'a' && s[k] <= 'z') ||
        (s[k] >= '0' && s[k] <= '9') ||
        s[k] === '_'
      )) k++;
      emit(T_ID, s.slice(i, k));
      i = k;
      continue;
    }

    // Multi-char operators first.
    if (c === '<' && s[i + 1] === '=') { pushOp('<='); i += 2; continue; }
    if (c === '>' && s[i + 1] === '=') { pushOp('>='); i += 2; continue; }
    if (c === '<' && s[i + 1] === '>') { pushOp('<>'); i += 2; continue; }
    if (c === '!' && s[i + 1] === '=') { pushOp('<>'); i += 2; continue; }
    if (c === '=' && s[i + 1] === '=') { pushOp('=');  i += 2; continue; }

    // Single-char operators.
    if ('+-*/^%(),:<>='.includes(c)) {
      pushOp(c); i++; continue;
    }

    throw new Error(`unexpected character '${c}' at position ${i}`);
  }

  return out;
}

// ── recursive-descent parser ─────────────────────────────────────────

function makeParser(toks) {
  let p = 0;
  function peek(off = 0) { return toks[p + off]; }
  function atEnd() { return p >= toks.length; }
  function consume() { return toks[p++]; }
  function expectOp(op) {
    const t = peek();
    if (!t || t.k !== T_OP || t.v !== op) {
      throw new Error(`expected '${op}'${t ? `, got '${t.v}'` : ' at end of input'}`);
    }
    return consume();
  }
  function isOp(op, off = 0) {
    const t = peek(off);
    return t && t.k === T_OP && t.v === op;
  }
  function isAnyOp(ops, off = 0) {
    const t = peek(off);
    return t && t.k === T_OP && ops.includes(t.v);
  }

  function parseExpr() { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    while (peek()?.k === T_ID && peek().v.toUpperCase() === 'OR') {
      consume();
      const right = parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (peek()?.k === T_ID && peek().v.toUpperCase() === 'AND') {
      consume();
      const right = parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }
  function parseNot() {
    if (peek()?.k === T_ID && peek().v.toUpperCase() === 'NOT') {
      consume();
      return { kind: 'not', operand: parseNot() };
    }
    return parseCmp();
  }
  function parseCmp() {
    let left = parseAdd();
    while (isAnyOp(['=', '<>', '<', '<=', '>', '>='])) {
      const op = consume().v;
      const right = parseAdd();
      left = { kind: 'cmp', op, left, right };
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (isAnyOp(['+', '-'])) {
      const op = consume().v;
      const right = parseMul();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  }
  function parseMul() {
    let left = parsePow();
    while (isAnyOp(['*', '/'])) {
      const op = consume().v;
      const right = parsePow();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  }
  function parsePow() {
    const left = parseUnary();
    if (isOp('^')) {
      consume();
      const right = parsePow();   // right-assoc
      return { kind: 'binop', op: '^', left, right };
    }
    return left;
  }
  function parseUnary() {
    if (isOp('+')) { consume(); return parseUnary(); }
    if (isOp('-')) { consume(); return { kind: 'neg', operand: parseUnary() }; }
    return parsePostfix();
  }
  function parsePostfix() {
    let node = parseAtom();
    // Trailing '%' → divide by 100. Also support binary '%' as modulo
    // at the mul-level — we resolve the ambiguity by looking at what
    // follows: if the '%' is followed by a value-producing token we
    // treat it as modulo, otherwise as percent.
    if (isOp('%')) {
      const next = peek(1);
      const looksBinary = next && (
        next.k === T_NUM || next.k === T_STR || next.k === T_ID ||
        next.k === T_CELL ||
        (next.k === T_OP && (next.v === '(' || next.v === '+' || next.v === '-'))
      );
      if (!looksBinary) {
        consume();
        node = { kind: 'percent', operand: node };
      }
    }
    return node;
  }
  function parseAtom() {
    const t = peek();
    if (!t) throw new Error('unexpected end of formula');

    if (t.k === T_NUM) { consume(); return { kind: 'num', value: t.v }; }
    if (t.k === T_STR) { consume(); return { kind: 'str', value: t.v }; }

    if (t.k === T_OP && t.v === '(') {
      consume();
      const inner = parseExpr();
      expectOp(')');
      return inner;
    }

    if (t.k === T_CELL) {
      consume();
      // Range? Look for ':' CELL.
      if (isOp(':') && peek(1)?.k === T_CELL) {
        consume(); // ':'
        const end = consume();
        return { kind: 'range', from: t.v, to: end.v };
      }
      return { kind: 'cell', ref: t.v };
    }

    if (t.k === T_ID) {
      consume();
      const nameUpper = t.v.toUpperCase();
      // Function call?
      if (isOp('(')) {
        consume();
        const args = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) { consume(); args.push(parseExpr()); }
        }
        expectOp(')');
        return { kind: 'call', name: nameUpper, args };
      }
      // Bare PI / E constants → callable form 'PI()' isn't required.
      if (nameUpper === 'PI') return { kind: 'num', value: Math.PI };
      if (nameUpper === 'E')  return { kind: 'num', value: Math.E };
      // Otherwise it's a named binding reference.
      return { kind: 'name', value: t.v };
    }

    if (t.k === T_OP && (t.v === '+' || t.v === '-')) {
      // already handled in parseUnary — getting here means unexpected.
      throw new Error(`unexpected operator '${t.v}'`);
    }

    throw new Error(`unexpected token '${t.v}'`);
  }

  function parseTop() {
    const node = parseExpr();
    if (!atEnd()) {
      const extra = peek();
      throw new Error(`extra tokens after expression: '${extra.v}'`);
    }
    return node;
  }

  return { parseTop };
}

function parse(src) {
  const toks = tokenize(src);
  return makeParser(toks).parseTop();
}

// ── evaluator ────────────────────────────────────────────────────────

function expandRange(from, to) {
  // Letters → numeric indices (A=0, B=1, …, Z=25, AA=26).
  function colNum(label) {
    let n = 0;
    for (let i = 0; i < label.length; i++) {
      n = n * 26 + (label.charCodeAt(i) - 64);
    }
    return n - 1;
  }
  function colLab(idx) {
    let n = idx + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }
  const c0 = Math.min(colNum(from.col), colNum(to.col));
  const c1 = Math.max(colNum(from.col), colNum(to.col));
  const r0 = Math.min(from.row, to.row);
  const r1 = Math.max(from.row, to.row);
  const out = [];
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      out.push(`${colLab(c)}${r}`);
    }
  }
  return out;
}

function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseFloat(v);
  if (Number.isFinite(n)) return n;
  throw new Error(`cannot coerce "${v}" to number`);
}

function bool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number')  return v !== 0;
  if (v == null || v === '')  return false;
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE')  return true;
    if (u === 'FALSE') return false;
    return v.length > 0;
  }
  return Boolean(v);
}

const FUNCS = {
  SUM(args) {
    let s = 0;
    for (const a of args) for (const v of flatten(a)) s += num(v);
    return s;
  },
  AVG(args)     { return FUNCS.AVERAGE(args); },
  AVERAGE(args) {
    let s = 0, n = 0;
    for (const a of args) for (const v of flatten(a)) {
      if (v == null || v === '') continue;
      s += num(v); n++;
    }
    if (n === 0) throw new Error('AVERAGE: empty range');
    return s / n;
  },
  COUNT(args) {
    let n = 0;
    for (const a of args) for (const v of flatten(a)) {
      if (v == null || v === '') continue;
      if (typeof v === 'number' && !Number.isNaN(v)) n++;
      else if (typeof v === 'string' &&
               /^-?\d+(?:\.\d+)?$/.test(v.trim())) n++;
    }
    return n;
  },
  MIN(args) {
    let best = Infinity;
    let seen = false;
    for (const a of args) for (const v of flatten(a)) {
      if (v == null || v === '') continue;
      const n = num(v);
      if (n < best) best = n;
      seen = true;
    }
    if (!seen) throw new Error('MIN: empty range');
    return best;
  },
  MAX(args) {
    let best = -Infinity;
    let seen = false;
    for (const a of args) for (const v of flatten(a)) {
      if (v == null || v === '') continue;
      const n = num(v);
      if (n > best) best = n;
      seen = true;
    }
    if (!seen) throw new Error('MAX: empty range');
    return best;
  },
  ROUND(args) {
    if (args.length < 1 || args.length > 2) throw new Error('ROUND(value, digits?)');
    const v = num(scalar(args[0]));
    const d = args.length === 2 ? Math.floor(num(scalar(args[1]))) : 0;
    const factor = Math.pow(10, d);
    return Math.round(v * factor) / factor;
  },
  ABS(args) { return Math.abs(num(scalar(args[0]))); },
  IF(args) {
    if (args.length < 2 || args.length > 3) throw new Error('IF(cond, then, else?)');
    const c = bool(scalar(args[0]));
    if (c) return scalar(args[1]);
    return args.length === 3 ? scalar(args[2]) : false;
  },
  AND(args) {
    for (const a of args) for (const v of flatten(a)) if (!bool(v)) return false;
    return true;
  },
  OR(args) {
    for (const a of args) for (const v of flatten(a)) if (bool(v)) return true;
    return false;
  },
  NOT(args) { return !bool(scalar(args[0])); },
  SIN(args)  { return Math.sin(num(scalar(args[0]))); },
  COS(args)  { return Math.cos(num(scalar(args[0]))); },
  TAN(args)  { return Math.tan(num(scalar(args[0]))); },
  ASIN(args) { return Math.asin(num(scalar(args[0]))); },
  ACOS(args) { return Math.acos(num(scalar(args[0]))); },
  ATAN(args) {
    if (args.length === 2) {
      return Math.atan2(num(scalar(args[0])), num(scalar(args[1])));
    }
    return Math.atan(num(scalar(args[0])));
  },
  SQRT(args) { return Math.sqrt(num(scalar(args[0]))); },
  EXP(args)  { return Math.exp(num(scalar(args[0]))); },
  LOG(args) {
    const v = num(scalar(args[0]));
    if (args.length === 2) {
      const base = num(scalar(args[1]));
      return Math.log(v) / Math.log(base);
    }
    return Math.log10(v);
  },
  LN(args)   { return Math.log(num(scalar(args[0]))); },
  PI(args)   {
    if (args.length) throw new Error('PI() takes no arguments');
    return Math.PI;
  },
  E(args) {
    if (args.length) throw new Error('E() takes no arguments');
    return Math.E;
  },
  MOD(args) {
    if (args.length !== 2) throw new Error('MOD(value, divisor)');
    const a = num(scalar(args[0]));
    const b = num(scalar(args[1]));
    if (b === 0) throw new Error('MOD: division by zero');
    return ((a % b) + b) % b;
  },
  POWER(args) {
    if (args.length !== 2) throw new Error('POWER(base, exponent)');
    return Math.pow(num(scalar(args[0])), num(scalar(args[1])));
  },
  INTERSECT(args) {
    // Return the count of cell ids common to every range/list arg.
    // Used for boolean range overlap checks.
    if (args.length < 2) throw new Error('INTERSECT(range1, range2, …)');
    const sets = args.map((a) => new Set(a._cellIds || []));
    if (sets.some((s) => s.size === 0)) return 0;
    const first = sets[0];
    let n = 0;
    for (const id of first) {
      if (sets.every((s) => s.has(id))) n++;
    }
    return n;
  },
};

/** Coerce an argument result to a flat list of leaf values. */
function flatten(arg) {
  if (arg && Array.isArray(arg._values)) return arg._values;
  return [arg];
}

/** Coerce an argument result to a single scalar (first value of a range). */
function scalar(arg) {
  if (arg && Array.isArray(arg._values)) return arg._values[0] ?? null;
  return arg;
}

function evalNode(node, env) {
  switch (node.kind) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'neg': return -num(evalNode(node.operand, env));
    case 'percent': return num(evalNode(node.operand, env)) / 100;
    case 'binop': {
      const a = evalNode(node.left,  env);
      const b = evalNode(node.right, env);
      const an = num(a), bn = num(b);
      switch (node.op) {
        case '+': return an + bn;
        case '-': return an - bn;
        case '*': return an * bn;
        case '/':
          if (bn === 0) throw new Error('division by zero');
          return an / bn;
        case '%':
          if (bn === 0) throw new Error('modulo by zero');
          return ((an % bn) + bn) % bn;
        case '^': return Math.pow(an, bn);
        default: throw new Error(`unknown binop '${node.op}'`);
      }
    }
    case 'cmp': {
      const a = evalNode(node.left,  env);
      const b = evalNode(node.right, env);
      // Numeric compare when both coerce cleanly, else lexicographic.
      const ax = typeof a === 'string' && !/^-?\d+(?:\.\d+)?$/.test(a.trim()) ? a : num(a);
      const bx = typeof b === 'string' && !/^-?\d+(?:\.\d+)?$/.test(b.trim()) ? b : num(b);
      switch (node.op) {
        case '=':  return ax === bx;
        case '<>': return ax !== bx;
        case '<':  return ax <  bx;
        case '<=': return ax <= bx;
        case '>':  return ax >  bx;
        case '>=': return ax >= bx;
        default: throw new Error(`unknown cmp '${node.op}'`);
      }
    }
    case 'and': return bool(evalNode(node.left, env)) && bool(evalNode(node.right, env));
    case 'or':  return bool(evalNode(node.left, env)) || bool(evalNode(node.right, env));
    case 'not': return !bool(evalNode(node.operand, env));
    case 'cell': {
      const id = node.ref.id;
      const v = env.cell(id);
      return v;
    }
    case 'range': {
      const ids = expandRange(node.from, node.to);
      const values = ids.map((id) => env.cell(id));
      // Wrap with marker so functions can flatten or scalarize.
      return { _values: values, _cellIds: ids };
    }
    case 'name': {
      const v = env.name(node.value);
      if (v === null || v === undefined) {
        throw new Error(`unknown name "${node.value}"`);
      }
      return v;
    }
    case 'call': {
      const fn = FUNCS[node.name];
      if (!fn) throw new Error(`unknown function "${node.name}"`);
      const args = node.args.map((a) => evalNode(a, env));
      return fn(args);
    }
    default:
      throw new Error(`unknown node kind "${node.kind}"`);
  }
}

// ── public surface ───────────────────────────────────────────────────

/** Evaluate the formula `src` (without the leading '='). `env` provides
 *  `cell(id)` and `name(n)` callbacks. Throws on parse/eval errors. */
export function evaluateFormula(src, env) {
  const ast = parse(src);
  const v = evalNode(ast, env);
  // Strip the internal range marker for the final return value — the
  // caller should never see it.
  if (v && Array.isArray(v._values)) {
    // A bare range result reduces to its first value (Excel behaviour
    // when a range is used as if it were a scalar).
    return v._values[0] ?? null;
  }
  return v;
}

/** Walk the AST and collect every cell id referenced. Used by the
 *  store to wire dependencies BEFORE evaluation, so the graph is
 *  consistent even when evaluation throws. */
export function parseFormulaDeps(src) {
  const out = new Set();
  let ast;
  try { ast = parse(src); }
  catch { return []; }   // parse error → no deps, evaluation will error out
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    switch (node.kind) {
      case 'cell':
        out.add(node.ref.id);
        return;
      case 'range': {
        const ids = expandRange(node.from, node.to);
        for (const id of ids) out.add(id);
        return;
      }
      case 'call':
        for (const a of node.args) visit(a);
        return;
      case 'binop': case 'cmp':
        visit(node.left); visit(node.right);
        return;
      case 'and': case 'or':
        visit(node.left); visit(node.right);
        return;
      case 'not': case 'neg': case 'percent':
        visit(node.operand);
        return;
      default:
        return;
    }
  }
  visit(ast);
  return Array.from(out);
}

// Re-export tokenizer + parser for unit tests that want to inspect the
// AST without going through the store.
export const __test__ = { tokenize, parse };
