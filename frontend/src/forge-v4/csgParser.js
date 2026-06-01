// Forge-160 — OpenSCAD-style CSG parser.
//
// Real recursive-descent parser with hand-rolled lexer + AST + interpreter.
// NO `eval()` and NO `new Function()` ever run on user-supplied source.
// Every token is produced by the lexer, every node is produced by the
// parser, and the interpreter walks the AST node-by-node — the user's
// script never touches the JS evaluation stack directly.
//
// Grammar (OpenSCAD subset):
//
//   Program     := Stmt*
//   Stmt        := AssignStmt
//                | FuncDecl
//                | IfStmt
//                | ForStmt
//                | LetStmt
//                | Call ';'
//                | Call Block          // module-instance with children
//                | Block
//   AssignStmt  := Ident '=' Expr ';'
//   FuncDecl    := 'function' Ident '(' ParamList? ')' '=' Expr ';'
//   IfStmt      := 'if' '(' Expr ')' Stmt ('else' Stmt)?
//   ForStmt     := 'for' '(' Ident '=' RangeOrList ')' Stmt
//   LetStmt     := 'let' '(' AssignList ')' Stmt
//   RangeOrList := '[' Expr ':' Expr (':' Expr)? ']'
//                | '[' ExprList ']'
//   Block       := '{' Stmt* '}'
//   Call        := Ident '(' ArgList? ')'
//   ArgList     := Arg (',' Arg)*
//   Arg         := Expr
//                | Ident '=' Expr        // named arg
//   ParamList   := Ident (',' Ident)*
//
// Expressions (precedence climb, low→high):
//   ||  &&  ==/!=  </>/<=/>=  +/-  *//%  unary -/+/!  power(^)  primary
//
// Primary       := Number | String | 'true' | 'false' | 'undef'
//                | '[' ExprList? ']'        // vector literal
//                | '(' Expr ')'
//                | Ident '(' ArgList? ')'   // function-call
//                | Ident                    // variable / parameter
//                | Ident '[' Expr ']'       // subscript

/* ------------------------------------------------------------------ */
/*  TOKENS                                                            */
/* ------------------------------------------------------------------ */

const TT = Object.freeze({
  NUM:   'NUM',
  STR:   'STR',
  IDENT: 'IDENT',
  PUNCT: 'PUNCT',
  KW:    'KW',
  EOF:   'EOF',
});

const KEYWORDS = new Set([
  'function', 'if', 'else', 'for', 'let', 'true', 'false', 'undef',
]);

const SINGLE_PUNCT = new Set([
  '(', ')', '{', '}', '[', ']', ',', ';', ':',
  '+', '-', '*', '/', '%', '^', '?',
]);

/**
 * Hand-rolled lexer. Returns { tokens, error? }.
 */
export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;

  function push(type, value, lit) {
    toks.push({ type, value, lit, line, col });
  }
  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  }
  function peek(off = 0) { return src[i + off]; }
  function isDigit(c)    { return c >= '0' && c <= '9'; }
  function isAlpha(c)    { return c && (/[A-Za-z_$]/).test(c); }
  function isAlnum(c)    { return c && (/[A-Za-z0-9_$]/).test(c); }

  try {
    while (i < src.length) {
      const c = src[i];

      // whitespace
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        advance(); continue;
      }
      // line comment
      if (c === '/' && peek(1) === '/') {
        while (i < src.length && src[i] !== '\n') advance();
        continue;
      }
      // block comment
      if (c === '/' && peek(1) === '*') {
        advance(2);
        while (i < src.length && !(src[i] === '*' && peek(1) === '/')) advance();
        if (i < src.length) advance(2);
        continue;
      }
      // number — integer or float, optional exponent
      if (isDigit(c) || (c === '.' && isDigit(peek(1)))) {
        const startLine = line, startCol = col;
        let buf = '';
        while (i < src.length && isDigit(src[i])) { buf += src[i]; advance(); }
        if (src[i] === '.' && isDigit(peek(1))) {
          buf += '.'; advance();
          while (i < src.length && isDigit(src[i])) { buf += src[i]; advance(); }
        }
        if (src[i] === 'e' || src[i] === 'E') {
          buf += src[i]; advance();
          if (src[i] === '+' || src[i] === '-') { buf += src[i]; advance(); }
          while (i < src.length && isDigit(src[i])) { buf += src[i]; advance(); }
        }
        toks.push({ type: TT.NUM, value: parseFloat(buf), lit: buf,
                    line: startLine, col: startCol });
        continue;
      }
      // string — double-quoted, with \\, \", \n escapes
      if (c === '"') {
        const startLine = line, startCol = col;
        advance();
        let buf = '';
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') {
            const nxt = peek(1);
            if (nxt === 'n')  { buf += '\n'; advance(2); continue; }
            if (nxt === 't')  { buf += '\t'; advance(2); continue; }
            if (nxt === '\\') { buf += '\\'; advance(2); continue; }
            if (nxt === '"')  { buf += '"';  advance(2); continue; }
            buf += src[i]; advance(); continue;
          }
          buf += src[i]; advance();
        }
        if (src[i] !== '"') {
          throw new Error(`Unterminated string starting at line ${startLine}`);
        }
        advance();
        toks.push({ type: TT.STR, value: buf, lit: '"' + buf + '"',
                    line: startLine, col: startCol });
        continue;
      }
      // identifier / keyword
      if (isAlpha(c)) {
        const startLine = line, startCol = col;
        let buf = '';
        while (i < src.length && isAlnum(src[i])) { buf += src[i]; advance(); }
        if (KEYWORDS.has(buf)) {
          toks.push({ type: TT.KW, value: buf, lit: buf,
                      line: startLine, col: startCol });
        } else {
          toks.push({ type: TT.IDENT, value: buf, lit: buf,
                      line: startLine, col: startCol });
        }
        continue;
      }
      // multi-char punctuation
      const two  = c + (peek(1) || '');
      const three = two + (peek(2) || '');
      if (three === '...') { push(TT.PUNCT, '...', '...'); advance(3); continue; }
      if (two === '==' || two === '!=' || two === '<=' ||
          two === '>=' || two === '&&' || two === '||') {
        push(TT.PUNCT, two, two); advance(2); continue;
      }
      if (c === '<' || c === '>' || c === '=' || c === '!') {
        push(TT.PUNCT, c, c); advance(); continue;
      }
      if (SINGLE_PUNCT.has(c)) {
        push(TT.PUNCT, c, c); advance(); continue;
      }
      throw new Error(`Unexpected character '${c}' at line ${line}, col ${col}`);
    }
    push(TT.EOF, null, '<eof>');
    return { tokens: toks };
  } catch (err) {
    return { tokens: toks, error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/*  PARSER                                                            */
/* ------------------------------------------------------------------ */

class ParseError extends Error {
  constructor(msg, tok) {
    super(`Parse error: ${msg} at line ${tok?.line ?? '?'}, col ${tok?.col ?? '?'}`);
    this.tok = tok;
  }
}

class Parser {
  constructor(tokens) {
    this.toks = tokens;
    this.pos = 0;
  }
  peek(off = 0) { return this.toks[this.pos + off]; }
  at(type, value) {
    const t = this.peek();
    if (t.type !== type) return false;
    if (value != null && t.value !== value) return false;
    return true;
  }
  match(type, value) {
    if (this.at(type, value)) { this.pos++; return this.toks[this.pos - 1]; }
    return null;
  }
  expect(type, value, hint) {
    const t = this.peek();
    if (t.type !== type || (value != null && t.value !== value)) {
      throw new ParseError(`expected ${value || type}${hint ? ' (' + hint + ')' : ''}, got ${t.lit}`, t);
    }
    this.pos++;
    return t;
  }
  parseProgram() {
    const stmts = [];
    while (!this.at(TT.EOF)) stmts.push(this.parseStmt());
    return { type: 'Program', body: stmts };
  }
  parseStmt() {
    const t = this.peek();

    if (t.type === TT.KW && t.value === 'function') return this.parseFunctionDecl();
    if (t.type === TT.KW && t.value === 'if')       return this.parseIf();
    if (t.type === TT.KW && t.value === 'for')      return this.parseFor();
    if (t.type === TT.KW && t.value === 'let')      return this.parseLetStmt();
    if (t.type === TT.PUNCT && t.value === '{')     return this.parseBlock();
    if (t.type === TT.PUNCT && t.value === ';')     { this.pos++; return { type: 'Empty' }; }

    // assignment or module-instance
    if (t.type === TT.IDENT) {
      // look ahead — IDENT '=' is assignment; IDENT '(' is call.
      const next = this.peek(1);
      if (next && next.type === TT.PUNCT && next.value === '=') {
        return this.parseAssign();
      }
      if (next && next.type === TT.PUNCT && next.value === '(') {
        return this.parseCallStmt();
      }
      throw new ParseError(`unexpected identifier '${t.value}'`, t);
    }
    throw new ParseError(`unexpected token '${t.lit}'`, t);
  }
  parseAssign() {
    const id = this.expect(TT.IDENT);
    this.expect(TT.PUNCT, '=');
    const expr = this.parseExpr();
    this.expect(TT.PUNCT, ';');
    return { type: 'Assign', name: id.value, value: expr };
  }
  parseFunctionDecl() {
    this.expect(TT.KW, 'function');
    const name = this.expect(TT.IDENT).value;
    this.expect(TT.PUNCT, '(');
    const params = [];
    if (!this.at(TT.PUNCT, ')')) {
      params.push(this.expect(TT.IDENT).value);
      while (this.match(TT.PUNCT, ',')) {
        params.push(this.expect(TT.IDENT).value);
      }
    }
    this.expect(TT.PUNCT, ')');
    this.expect(TT.PUNCT, '=');
    const body = this.parseExpr();
    this.expect(TT.PUNCT, ';');
    return { type: 'FunctionDecl', name, params, body };
  }
  parseIf() {
    const startTok = this.expect(TT.KW, 'if');
    this.expect(TT.PUNCT, '(');
    const cond = this.parseExpr();
    this.expect(TT.PUNCT, ')');
    const then = this.parseStmt();
    let elseBranch = null;
    if (this.match(TT.KW, 'else')) elseBranch = this.parseStmt();
    return { type: 'If', cond, then, else: elseBranch, line: startTok.line };
  }
  parseFor() {
    this.expect(TT.KW, 'for');
    this.expect(TT.PUNCT, '(');
    const varName = this.expect(TT.IDENT).value;
    this.expect(TT.PUNCT, '=');
    const range = this.parseRangeOrList();
    this.expect(TT.PUNCT, ')');
    const body = this.parseStmt();
    return { type: 'For', varName, range, body };
  }
  parseLetStmt() {
    this.expect(TT.KW, 'let');
    this.expect(TT.PUNCT, '(');
    const bindings = [];
    if (!this.at(TT.PUNCT, ')')) {
      bindings.push(this.parseLetBinding());
      while (this.match(TT.PUNCT, ',')) bindings.push(this.parseLetBinding());
    }
    this.expect(TT.PUNCT, ')');
    const body = this.parseStmt();
    return { type: 'LetStmt', bindings, body };
  }
  parseLetBinding() {
    const name = this.expect(TT.IDENT).value;
    this.expect(TT.PUNCT, '=');
    const expr = this.parseExpr();
    return { name, expr };
  }
  parseRangeOrList() {
    this.expect(TT.PUNCT, '[');
    const first = this.parseExpr();
    if (this.match(TT.PUNCT, ':')) {
      const second = this.parseExpr();
      let third = null;
      if (this.match(TT.PUNCT, ':')) third = this.parseExpr();
      this.expect(TT.PUNCT, ']');
      // [start : step : end] or [start : end]
      if (third != null) {
        return { type: 'Range', start: first, step: second, end: third };
      }
      return { type: 'Range', start: first, step: { type: 'Num', value: 1 }, end: second };
    }
    // comma-list
    const items = [first];
    while (this.match(TT.PUNCT, ',')) items.push(this.parseExpr());
    this.expect(TT.PUNCT, ']');
    return { type: 'ListLit', items };
  }
  parseBlock() {
    this.expect(TT.PUNCT, '{');
    const stmts = [];
    while (!this.at(TT.PUNCT, '}')) stmts.push(this.parseStmt());
    this.expect(TT.PUNCT, '}');
    return { type: 'Block', body: stmts };
  }
  parseCallStmt() {
    const call = this.parseCallExpr();
    // OpenSCAD: call followed by '{' or a single statement is a parent
    // module taking children; call followed by ';' is a terminal stmt.
    if (this.at(TT.PUNCT, '{')) {
      const block = this.parseBlock();
      return { type: 'ModuleInstance', call, children: block.body };
    }
    if (this.at(TT.PUNCT, ';')) {
      this.pos++;
      return { type: 'ModuleInstance', call, children: [] };
    }
    // Single child without braces — translate(...) cube(...);
    // The child statement itself MUST be a module-instance.
    const child = this.parseStmt();
    return { type: 'ModuleInstance', call, children: [child] };
  }
  parseCallExpr() {
    const name = this.expect(TT.IDENT).value;
    this.expect(TT.PUNCT, '(');
    const args = [];
    if (!this.at(TT.PUNCT, ')')) {
      args.push(this.parseArg());
      while (this.match(TT.PUNCT, ',')) args.push(this.parseArg());
    }
    this.expect(TT.PUNCT, ')');
    return { type: 'Call', name, args };
  }
  parseArg() {
    // Named arg: IDENT '=' Expr
    if (this.peek().type === TT.IDENT &&
        this.peek(1)?.type === TT.PUNCT && this.peek(1).value === '=') {
      const id = this.expect(TT.IDENT).value;
      this.expect(TT.PUNCT, '=');
      const v = this.parseExpr();
      return { kind: 'named', name: id, value: v };
    }
    return { kind: 'positional', value: this.parseExpr() };
  }

  /* expression parsing with precedence climbing ----------------- */

  parseExpr() { return this.parseTernary(); }

  parseTernary() {
    const cond = this.parseOr();
    if (this.match(TT.PUNCT, '?')) {
      const then = this.parseExpr();
      this.expect(TT.PUNCT, ':');
      const elseE = this.parseExpr();
      return { type: 'Ternary', cond, then, else: elseE };
    }
    return cond;
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.match(TT.PUNCT, '||')) {
      const right = this.parseAnd();
      left = { type: 'Binary', op: '||', left, right };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseEquality();
    while (this.match(TT.PUNCT, '&&')) {
      const right = this.parseEquality();
      left = { type: 'Binary', op: '&&', left, right };
    }
    return left;
  }
  parseEquality() {
    let left = this.parseRelational();
    while (this.at(TT.PUNCT, '==') || this.at(TT.PUNCT, '!=')) {
      const op = this.peek().value; this.pos++;
      const right = this.parseRelational();
      left = { type: 'Binary', op, left, right };
    }
    return left;
  }
  parseRelational() {
    let left = this.parseAdd();
    while (this.at(TT.PUNCT, '<')  || this.at(TT.PUNCT, '>') ||
           this.at(TT.PUNCT, '<=') || this.at(TT.PUNCT, '>=')) {
      const op = this.peek().value; this.pos++;
      const right = this.parseAdd();
      left = { type: 'Binary', op, left, right };
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.at(TT.PUNCT, '+') || this.at(TT.PUNCT, '-')) {
      const op = this.peek().value; this.pos++;
      const right = this.parseMul();
      left = { type: 'Binary', op, left, right };
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (this.at(TT.PUNCT, '*') || this.at(TT.PUNCT, '/') || this.at(TT.PUNCT, '%')) {
      const op = this.peek().value; this.pos++;
      const right = this.parseUnary();
      left = { type: 'Binary', op, left, right };
    }
    return left;
  }
  parseUnary() {
    if (this.at(TT.PUNCT, '-') || this.at(TT.PUNCT, '+') || this.at(TT.PUNCT, '!')) {
      const op = this.peek().value; this.pos++;
      const operand = this.parseUnary();
      return { type: 'Unary', op, operand };
    }
    return this.parsePower();
  }
  parsePower() {
    const base = this.parsePostfix();
    if (this.match(TT.PUNCT, '^')) {
      const exp = this.parseUnary(); // right-associative
      return { type: 'Binary', op: '^', left: base, right: exp };
    }
    return base;
  }
  parsePostfix() {
    let node = this.parsePrimary();
    while (this.at(TT.PUNCT, '[')) {
      this.pos++;
      const idx = this.parseExpr();
      this.expect(TT.PUNCT, ']');
      node = { type: 'Subscript', target: node, index: idx };
    }
    return node;
  }
  parsePrimary() {
    const t = this.peek();
    if (t.type === TT.NUM) { this.pos++; return { type: 'Num', value: t.value }; }
    if (t.type === TT.STR) { this.pos++; return { type: 'Str', value: t.value }; }
    if (t.type === TT.KW && t.value === 'true')  { this.pos++; return { type: 'Bool', value: true  }; }
    if (t.type === TT.KW && t.value === 'false') { this.pos++; return { type: 'Bool', value: false }; }
    if (t.type === TT.KW && t.value === 'undef') { this.pos++; return { type: 'Undef' }; }
    if (t.type === TT.KW && t.value === 'let') {
      // let-expression: let (a=1, b=2) expr
      this.pos++;
      this.expect(TT.PUNCT, '(');
      const bindings = [];
      if (!this.at(TT.PUNCT, ')')) {
        bindings.push(this.parseLetBinding());
        while (this.match(TT.PUNCT, ',')) bindings.push(this.parseLetBinding());
      }
      this.expect(TT.PUNCT, ')');
      const body = this.parseExpr();
      return { type: 'LetExpr', bindings, body };
    }
    if (t.type === TT.PUNCT && t.value === '(') {
      this.pos++;
      const e = this.parseExpr();
      this.expect(TT.PUNCT, ')');
      return e;
    }
    if (t.type === TT.PUNCT && t.value === '[') {
      this.pos++;
      const items = [];
      if (!this.at(TT.PUNCT, ']')) {
        items.push(this.parseExpr());
        while (this.match(TT.PUNCT, ',')) items.push(this.parseExpr());
      }
      this.expect(TT.PUNCT, ']');
      return { type: 'ListLit', items };
    }
    if (t.type === TT.IDENT) {
      // function-call vs. variable
      if (this.peek(1)?.type === TT.PUNCT && this.peek(1).value === '(') {
        return this.parseCallExpr();
      }
      this.pos++;
      return { type: 'Var', name: t.value };
    }
    throw new ParseError(`unexpected token '${t.lit}'`, t);
  }
}

/**
 * Parse OpenSCAD-style source.  Returns { ast?, error? }.
 */
export function parse(source) {
  const { tokens, error } = tokenize(source || '');
  if (error) return { error };
  try {
    const parser = new Parser(tokens);
    const ast = parser.parseProgram();
    return { ast };
  } catch (err) {
    return { error: err.message };
  }
}

export const __TT = TT;
export default parse;
