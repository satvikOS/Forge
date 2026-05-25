/**
 * ExpressionEvaluator — pure-JS tokeniser + recursive-descent parser
 * for parametric expressions used by the Equation Manager (UX Tier 10).
 *
 * Supports:
 *   - Numeric literals (12, 12.5, .5, 1.5e-3, 0xff)
 *   - Identifiers (variable references) resolved via a scope callback
 *   - Arithmetic operators:    + - * / %
 *   - Unary minus + unary plus
 *   - Parentheses for grouping
 *   - Exponentiation:          ^   (right-assoc; alias for pow)
 *   - Comma-separated args inside function calls
 *   - Math functions:          sin cos tan asin acos atan atan2
 *                              sqrt abs min max pow floor ceil round
 *                              ln log log2 exp sign deg rad
 *   - Constants:               PI E TAU
 *
 * Returns a finite Number, or throws a diagnostic Error with `.pos` set
 * to the byte offset of the failure in the source expression so the UI
 * can highlight the bad token.
 *
 * No `eval()`. No `Function()`. No regex-based hacks — a real
 * lexer + Pratt-style recursive-descent parser. The same module is used
 * by EquationStore to evaluate every stored equation and (via the
 * sketch dimension hook) by InteractiveSketch.applyDimension to accept
 * `=expr` strings as dimension values.
 */

const KIND = {
  NUMBER: 'number',
  IDENT:  'ident',
  OP:     'op',
  LPAREN: 'lparen',
  RPAREN: 'rparen',
  COMMA:  'comma',
  EOF:    'eof',
};

const SINGLE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '^']);

// ── Lexer ────────────────────────────────────────────────────────────────

export function tokenize(src) {
  if (typeof src !== 'string') {
    throw makeError('expression must be a string', 0);
  }
  const out = [];
  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i];
    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    // Number — integer / float / scientific. Leading `.` allowed (.5).
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      // hex literal 0x...
      if (c === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X')) {
        j += 2;
        const start = j;
        while (j < N && /[0-9a-fA-F]/.test(src[j])) j += 1;
        if (j === start) throw makeError('invalid hex literal', i);
        const v = parseInt(src.slice(i + 2, j), 16);
        out.push({ kind: KIND.NUMBER, value: v, pos: i });
        i = j;
        continue;
      }
      // Decimal / float / exp.
      while (j < N && src[j] >= '0' && src[j] <= '9') j += 1;
      if (src[j] === '.') {
        j += 1;
        while (j < N && src[j] >= '0' && src[j] <= '9') j += 1;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        j += 1;
        if (src[j] === '+' || src[j] === '-') j += 1;
        const expStart = j;
        while (j < N && src[j] >= '0' && src[j] <= '9') j += 1;
        if (j === expStart) throw makeError('invalid scientific exponent', i);
      }
      const text = src.slice(i, j);
      const v = parseFloat(text);
      if (!Number.isFinite(v)) throw makeError(`invalid number "${text}"`, i);
      out.push({ kind: KIND.NUMBER, value: v, pos: i });
      i = j;
      continue;
    }
    // Identifier — [A-Za-z_][A-Za-z0-9_]*
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let j = i + 1;
      while (j < N && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      out.push({ kind: KIND.IDENT, name: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // Punctuation / operators.
    if (c === '(') { out.push({ kind: KIND.LPAREN, pos: i }); i += 1; continue; }
    if (c === ')') { out.push({ kind: KIND.RPAREN, pos: i }); i += 1; continue; }
    if (c === ',') { out.push({ kind: KIND.COMMA,  pos: i }); i += 1; continue; }
    // `**` is alias for `^` (exponentiation).
    if (c === '*' && src[i + 1] === '*') {
      out.push({ kind: KIND.OP, op: '^', pos: i });
      i += 2; continue;
    }
    if (SINGLE_CHAR_OPS.has(c)) {
      out.push({ kind: KIND.OP, op: c, pos: i });
      i += 1;
      continue;
    }
    throw makeError(`unexpected character "${c}"`, i);
  }
  out.push({ kind: KIND.EOF, pos: N });
  return out;
}

// ── Parser / Evaluator ───────────────────────────────────────────────────

const MATH_FUNCS = {
  sin:   (x) => Math.sin(x),
  cos:   (x) => Math.cos(x),
  tan:   (x) => Math.tan(x),
  asin:  (x) => Math.asin(x),
  acos:  (x) => Math.acos(x),
  atan:  (x) => Math.atan(x),
  atan2: (y, x) => Math.atan2(y, x),
  sqrt:  (x) => Math.sqrt(x),
  abs:   (x) => Math.abs(x),
  min:   (...a) => Math.min(...a),
  max:   (...a) => Math.max(...a),
  pow:   (a, b) => Math.pow(a, b),
  floor: (x) => Math.floor(x),
  ceil:  (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  ln:    (x) => Math.log(x),
  log:   (x) => Math.log10(x),
  log2:  (x) => Math.log2(x),
  exp:   (x) => Math.exp(x),
  sign:  (x) => Math.sign(x),
  deg:   (rad) => rad * 180 / Math.PI,
  rad:   (deg) => deg * Math.PI / 180,
};

const MATH_CONSTS = {
  PI: Math.PI,
  E:  Math.E,
  TAU: Math.PI * 2,
};

/**
 * Evaluate an expression string in the given variable scope.
 *
 * @param {string} expression
 * @param {(name: string) => number | undefined} resolveVar  scope callback
 * @returns {number}
 */
export function evaluateExpression(expression, resolveVar) {
  const src = String(expression);
  const tokens = tokenize(src);
  const state = { src, tokens, idx: 0, resolveVar: resolveVar || (() => undefined) };
  const value = parseExpression(state, 0);
  expect(state, KIND.EOF, 'end of expression');
  if (!Number.isFinite(value)) {
    throw makeError(`expression evaluated to a non-finite number (${value})`, src.length);
  }
  return value;
}

// Pratt-style precedence climber. Operators:
//   + -        prec 10  left-assoc
//   * / %      prec 20  left-assoc
//   ^          prec 30  right-assoc
const BINARY_OPS = {
  '+': { prec: 10, right: false, fn: (a, b) => a + b },
  '-': { prec: 10, right: false, fn: (a, b) => a - b },
  '*': { prec: 20, right: false, fn: (a, b) => a * b },
  '/': { prec: 20, right: false, fn: (a, b) => a / b },
  '%': { prec: 20, right: false, fn: (a, b) => a % b },
  '^': { prec: 30, right: true,  fn: (a, b) => Math.pow(a, b) },
};

function parseExpression(state, minPrec) {
  let lhs = parseUnary(state);
  while (true) {
    const tok = peek(state);
    if (tok.kind !== KIND.OP) break;
    const op = BINARY_OPS[tok.op];
    if (!op || op.prec < minPrec) break;
    consume(state);
    const nextMin = op.right ? op.prec : op.prec + 1;
    const rhs = parseExpression(state, nextMin);
    lhs = op.fn(lhs, rhs);
  }
  return lhs;
}

function parseUnary(state) {
  const tok = peek(state);
  if (tok.kind === KIND.OP && (tok.op === '+' || tok.op === '-')) {
    consume(state);
    const v = parseUnary(state);
    return tok.op === '-' ? -v : +v;
  }
  return parsePrimary(state);
}

function parsePrimary(state) {
  const tok = peek(state);
  if (tok.kind === KIND.NUMBER) {
    consume(state);
    return tok.value;
  }
  if (tok.kind === KIND.LPAREN) {
    consume(state);
    const v = parseExpression(state, 0);
    expect(state, KIND.RPAREN, '")"');
    return v;
  }
  if (tok.kind === KIND.IDENT) {
    consume(state);
    // Function call?
    if (peek(state).kind === KIND.LPAREN) {
      consume(state);
      const args = [];
      if (peek(state).kind !== KIND.RPAREN) {
        args.push(parseExpression(state, 0));
        while (peek(state).kind === KIND.COMMA) {
          consume(state);
          args.push(parseExpression(state, 0));
        }
      }
      expect(state, KIND.RPAREN, '")"');
      const fn = MATH_FUNCS[tok.name];
      if (!fn) {
        throw makeError(`unknown function "${tok.name}"`, tok.pos);
      }
      return fn(...args);
    }
    // Constant?
    if (Object.prototype.hasOwnProperty.call(MATH_CONSTS, tok.name)) {
      return MATH_CONSTS[tok.name];
    }
    // Variable lookup via scope callback.
    const v = state.resolveVar(tok.name);
    if (v === undefined || v === null || Number.isNaN(v)) {
      throw makeError(`unknown variable "${tok.name}"`, tok.pos);
    }
    if (!Number.isFinite(v)) {
      throw makeError(`variable "${tok.name}" is not a finite number`, tok.pos);
    }
    return Number(v);
  }
  throw makeError(`unexpected token "${describeTok(tok)}"`, tok.pos);
}

// ── token helpers ────────────────────────────────────────────────────────

function peek(state) { return state.tokens[state.idx]; }
function consume(state) { return state.tokens[state.idx++]; }
function expect(state, kind, label) {
  const t = peek(state);
  if (t.kind !== kind) {
    throw makeError(`expected ${label}, got "${describeTok(t)}"`, t.pos);
  }
  consume(state);
  return t;
}
function describeTok(t) {
  if (t.kind === KIND.NUMBER) return String(t.value);
  if (t.kind === KIND.IDENT)  return t.name;
  if (t.kind === KIND.OP)     return t.op;
  if (t.kind === KIND.LPAREN) return '(';
  if (t.kind === KIND.RPAREN) return ')';
  if (t.kind === KIND.COMMA)  return ',';
  return '<eof>';
}
function makeError(message, pos) {
  const err = new Error(message);
  err.pos = pos | 0;
  err.isExpressionError = true;
  return err;
}

/**
 * Collect the names of every identifier referenced as a variable
 * (i.e. NOT a function name and NOT a built-in constant). Used by the
 * dependency tracker in EquationStore.
 *
 * @param {string} expression
 * @returns {string[]}  unique variable names, in lex order
 */
export function collectVariableReferences(expression) {
  const src = String(expression);
  let tokens;
  try { tokens = tokenize(src); }
  catch (_) { return []; }
  const seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== KIND.IDENT) continue;
    // Function call → not a variable
    if (tokens[i + 1] && tokens[i + 1].kind === KIND.LPAREN) continue;
    // Built-in constant → not a variable
    if (Object.prototype.hasOwnProperty.call(MATH_CONSTS, t.name)) continue;
    seen.add(t.name);
  }
  return [...seen];
}

export const __test = { MATH_FUNCS, MATH_CONSTS, BINARY_OPS };
