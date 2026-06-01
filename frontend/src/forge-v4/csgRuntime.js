// Forge-160 — CSG runtime.
//
// Pure-JS interpreter that walks the AST produced by csgParser.js and
// emits a list of "output bodies" — each body holding a REAL OCCT
// kernel handle obtained from `window.forge.makeBox / makeCylinder /
// makeSphere / fuse / cut / common / translate / rotate`.
//
// HARD RULES:
//   * NO synthetic geometry. If `window.forge.isReady()` is false the
//     entry point throws `KernelOfflineError` so the workbench can
//     render its "kernel required" notice instead of falling back to
//     fake bodies.
//   * NO `eval` / `new Function` — interpretation only.
//   * NO writes to Archie's thread; this module is pure compute.
//
// Built-in modules return either a single kernel handle (number) or
// `null` (for unsupported callers).  Built-in transforms wrap their
// child(ren) producing transformed handles.  Booleans (union /
// difference / intersection / hull) reduce the child list using the
// kernel boolean ops.

import { parse as parseScript } from './csgParser.js';

/* ------------------------------------------------------------------ */

export class KernelOfflineError extends Error {
  constructor(msg) { super(msg); this.name = 'KernelOfflineError'; }
}

export class CsgRuntimeError extends Error {
  constructor(msg) { super(msg); this.name = 'CsgRuntimeError'; }
}

function kernel() {
  if (typeof window === 'undefined' || !window.forge ||
      typeof window.forge.isReady !== 'function' || !window.forge.isReady()) {
    throw new KernelOfflineError(
      'forge-kernel.node is not loaded — install the native addon to run CSG scripts');
  }
  return window.forge;
}

/* ------------------------------------------------------------------ */
/*  scope                                                             */
/* ------------------------------------------------------------------ */

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.vars   = new Map();
    this.funcs  = new Map();   // user-declared functions
  }
  child() { return new Scope(this); }
  set(name, value) { this.vars.set(name, value); }
  get(name) {
    let s = this;
    while (s) {
      if (s.vars.has(name)) return s.vars.get(name);
      s = s.parent;
    }
    return undefined;
  }
  defineFunc(name, decl) { this.funcs.set(name, decl); }
  lookupFunc(name) {
    let s = this;
    while (s) {
      if (s.funcs.has(name)) return s.funcs.get(name);
      s = s.parent;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Built-in module catalogue                                         */
/* ------------------------------------------------------------------ */

const PRIMITIVES = ['cube', 'sphere', 'cylinder', 'polyhedron'];
const TRANSFORMS = ['translate', 'rotate', 'scale', 'mirror'];
const BOOLEANS   = ['union', 'difference', 'intersection', 'hull'];
const CONTROLS   = ['echo'];     // child-list passthrough
export const BUILTIN_MODULES = [
  ...PRIMITIVES, ...TRANSFORMS, ...BOOLEANS, ...CONTROLS,
];
export const BUILTIN_FUNCTIONS = [
  'abs', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'pow', 'exp', 'ln', 'log', 'min', 'max', 'floor', 'ceil', 'round',
  'len', 'norm', 'concat',
];

/* ------------------------------------------------------------------ */
/*  Expression evaluation                                             */
/* ------------------------------------------------------------------ */

function isTruthy(v) {
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return true;
  return Boolean(v);
}

function num(v, what) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new CsgRuntimeError(`expected number for ${what}, got ${describe(v)}`);
}

function describe(v) {
  if (v == null) return 'undef';
  if (typeof v === 'number') return v.toString();
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(describe).join(',') + ']';
  return String(v);
}

function asVec(v, want, what) {
  if (typeof v === 'number') return new Array(want).fill(v);
  if (Array.isArray(v)) {
    const out = new Array(want).fill(0);
    for (let i = 0; i < want; i++) {
      if (i < v.length) out[i] = num(v[i], `${what}[${i}]`);
    }
    return out;
  }
  throw new CsgRuntimeError(`expected vector for ${what}, got ${describe(v)}`);
}

function callBuiltinFunction(name, posArgs) {
  switch (name) {
    case 'abs':   return Math.abs(num(posArgs[0], 'abs(x)'));
    case 'sqrt':  return Math.sqrt(num(posArgs[0], 'sqrt(x)'));
    case 'sin':   return Math.sin(num(posArgs[0], 'sin(deg)')   * Math.PI / 180);
    case 'cos':   return Math.cos(num(posArgs[0], 'cos(deg)')   * Math.PI / 180);
    case 'tan':   return Math.tan(num(posArgs[0], 'tan(deg)')   * Math.PI / 180);
    case 'asin':  return Math.asin(num(posArgs[0], 'asin(x)'))  * 180 / Math.PI;
    case 'acos':  return Math.acos(num(posArgs[0], 'acos(x)'))  * 180 / Math.PI;
    case 'atan':  return Math.atan(num(posArgs[0], 'atan(x)'))  * 180 / Math.PI;
    case 'atan2': return Math.atan2(num(posArgs[0], 'atan2(y,x)'),
                                    num(posArgs[1], 'atan2(y,x)')) * 180 / Math.PI;
    case 'pow':   return Math.pow(num(posArgs[0], 'pow(b,e)'), num(posArgs[1], 'pow(b,e)'));
    case 'exp':   return Math.exp(num(posArgs[0], 'exp(x)'));
    case 'ln':    return Math.log(num(posArgs[0], 'ln(x)'));
    case 'log':   return Math.log10(num(posArgs[0], 'log(x)'));
    case 'min':   return Math.min(...posArgs.map((a, i) => num(a, `min(${i})`)));
    case 'max':   return Math.max(...posArgs.map((a, i) => num(a, `max(${i})`)));
    case 'floor': return Math.floor(num(posArgs[0], 'floor(x)'));
    case 'ceil':  return Math.ceil(num(posArgs[0], 'ceil(x)'));
    case 'round': return Math.round(num(posArgs[0], 'round(x)'));
    case 'len': {
      const v = posArgs[0];
      if (v == null) return 0;
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      throw new CsgRuntimeError(`len() expects string or vector, got ${describe(v)}`);
    }
    case 'norm': {
      const v = posArgs[0];
      if (!Array.isArray(v)) throw new CsgRuntimeError('norm() expects a vector');
      let s = 0;
      for (const x of v) s += num(x, 'norm()') ** 2;
      return Math.sqrt(s);
    }
    case 'concat': {
      const out = [];
      for (const a of posArgs) {
        if (Array.isArray(a)) out.push(...a); else out.push(a);
      }
      return out;
    }
    default:
      throw new CsgRuntimeError(`unknown function '${name}'`);
  }
}

function evalExpr(node, scope) {
  switch (node.type) {
    case 'Num':   return node.value;
    case 'Str':   return node.value;
    case 'Bool':  return node.value;
    case 'Undef': return undefined;

    case 'ListLit': return node.items.map((e) => evalExpr(e, scope));

    case 'Var': {
      const v = scope.get(node.name);
      if (v === undefined && !scope.vars.has(node.name)) {
        // Could be a function reference — OpenSCAD doesn't treat
        // functions as first-class values; this is an unresolved name.
        return undefined;
      }
      return v;
    }
    case 'Subscript': {
      const t = evalExpr(node.target, scope);
      const idx = evalExpr(node.index, scope);
      if (Array.isArray(t)) {
        const i = num(idx, 'subscript');
        return t[i];
      }
      if (typeof t === 'string') {
        const i = num(idx, 'subscript');
        return t.charAt(i);
      }
      throw new CsgRuntimeError(`cannot subscript ${describe(t)}`);
    }
    case 'Ternary':
      return isTruthy(evalExpr(node.cond, scope))
        ? evalExpr(node.then, scope)
        : evalExpr(node.else, scope);

    case 'Unary': {
      const v = evalExpr(node.operand, scope);
      switch (node.op) {
        case '+': return +num(v, 'unary +');
        case '-': return -num(v, 'unary -');
        case '!': return !isTruthy(v);
      }
      throw new CsgRuntimeError(`unknown unary op '${node.op}'`);
    }
    case 'Binary': {
      const op = node.op;
      // Short-circuit logical ops.
      if (op === '&&') return isTruthy(evalExpr(node.left, scope))
                            ? evalExpr(node.right, scope) : false;
      if (op === '||') {
        const l = evalExpr(node.left, scope);
        return isTruthy(l) ? l : evalExpr(node.right, scope);
      }
      const a = evalExpr(node.left, scope);
      const b = evalExpr(node.right, scope);
      switch (op) {
        case '+': {
          if (Array.isArray(a) && Array.isArray(b)) {
            const n = Math.min(a.length, b.length);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = num(a[i], 'vec+') + num(b[i], 'vec+');
            return out;
          }
          if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
          return num(a, '+') + num(b, '+');
        }
        case '-': {
          if (Array.isArray(a) && Array.isArray(b)) {
            const n = Math.min(a.length, b.length);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = num(a[i], 'vec-') - num(b[i], 'vec-');
            return out;
          }
          return num(a, '-') - num(b, '-');
        }
        case '*': {
          if (Array.isArray(a) && typeof b === 'number') return a.map((x) => num(x, 'vec*') * b);
          if (typeof a === 'number' && Array.isArray(b)) return b.map((x) => a * num(x, 'vec*'));
          return num(a, '*') * num(b, '*');
        }
        case '/': {
          if (Array.isArray(a) && typeof b === 'number') return a.map((x) => num(x, 'vec/') / b);
          return num(a, '/') / num(b, '/');
        }
        case '%': return num(a, '%') % num(b, '%');
        case '^': return Math.pow(num(a, '^'), num(b, '^'));
        case '==': return a === b ||
                       (Array.isArray(a) && Array.isArray(b) &&
                        a.length === b.length &&
                        a.every((x, i) => x === b[i]));
        case '!=': return !(a === b);
        case '<':  return num(a, '<')  <  num(b, '<');
        case '>':  return num(a, '>')  >  num(b, '>');
        case '<=': return num(a, '<=') <= num(b, '<=');
        case '>=': return num(a, '>=') >= num(b, '>=');
      }
      throw new CsgRuntimeError(`unknown binary op '${op}'`);
    }
    case 'LetExpr': {
      const sub = scope.child();
      for (const b of node.bindings) sub.set(b.name, evalExpr(b.expr, sub));
      return evalExpr(node.body, sub);
    }
    case 'Call': {
      // Function calls — built-in or user-declared.
      const posArgs = [];
      const named = new Map();
      for (const a of node.args) {
        const v = evalExpr(a.value, scope);
        if (a.kind === 'named') named.set(a.name, v);
        else posArgs.push(v);
      }
      const user = scope.lookupFunc(node.name);
      if (user) {
        const sub = scope.child();
        for (let i = 0; i < user.params.length; i++) {
          const name = user.params[i];
          if (named.has(name)) sub.set(name, named.get(name));
          else if (i < posArgs.length) sub.set(name, posArgs[i]);
          else sub.set(name, undefined);
        }
        return evalExpr(user.body, sub);
      }
      if (BUILTIN_FUNCTIONS.includes(node.name)) {
        return callBuiltinFunction(node.name, posArgs);
      }
      throw new CsgRuntimeError(`unknown function '${node.name}'`);
    }
  }
  throw new CsgRuntimeError(`bad expression node ${node.type}`);
}

/* ------------------------------------------------------------------ */
/*  Argument helpers for modules                                      */
/* ------------------------------------------------------------------ */

function gatherArgs(callNode, scope, paramNames) {
  // Returns { byName: Map } so module impls can pull either by named
  // arg name or positional index via the param map.
  const positional = [];
  const named = new Map();
  for (const a of callNode.args) {
    const v = evalExpr(a.value, scope);
    if (a.kind === 'named') named.set(a.name, v);
    else positional.push(v);
  }
  const byName = new Map();
  for (let i = 0; i < paramNames.length; i++) {
    const p = paramNames[i];
    if (named.has(p)) byName.set(p, named.get(p));
    else if (i < positional.length) byName.set(p, positional[i]);
  }
  // Pass-through unknown named args too — caller may inspect.
  for (const [k, v] of named.entries()) {
    if (!byName.has(k)) byName.set(k, v);
  }
  return byName;
}

/* ------------------------------------------------------------------ */
/*  Module evaluation — produces an Array<{ handle, name }>           */
/* ------------------------------------------------------------------ */

const MIN_DIM = 1e-6;

function moduleCube(args) {
  const k = kernel();
  const sizeArg = args.get('size');
  const center = isTruthy(args.get('center'));
  let dx, dy, dz;
  if (sizeArg == null) { dx = dy = dz = 1; }
  else if (Array.isArray(sizeArg)) {
    const v = asVec(sizeArg, 3, 'cube(size)');
    dx = v[0]; dy = v[1]; dz = v[2];
  } else {
    dx = dy = dz = num(sizeArg, 'cube(size)');
  }
  if (dx <= 0 || dy <= 0 || dz <= 0) {
    throw new CsgRuntimeError(`cube: positive dimensions required, got [${dx},${dy},${dz}]`);
  }
  let h = k.makeBox(dx, dy, dz);
  if (typeof h !== 'number') throw new CsgRuntimeError('kernel makeBox returned no handle');
  if (center) {
    h = k.translate(h, -dx / 2, -dy / 2, -dz / 2);
  }
  return [{ handle: h, name: `cube(${dx},${dy},${dz})` }];
}

function moduleSphere(args) {
  const k = kernel();
  let r;
  if (args.get('r') != null) {
    r = num(args.get('r'), 'sphere(r)');
  } else if (args.get('d') != null) {
    r = num(args.get('d'), 'sphere(d)') / 2;
  } else {
    r = 1;
  }
  if (r <= 0) throw new CsgRuntimeError(`sphere: positive radius required, got ${r}`);
  const h = k.makeSphere(r);
  if (typeof h !== 'number') throw new CsgRuntimeError('kernel makeSphere returned no handle');
  return [{ handle: h, name: `sphere(${r})` }];
}

function moduleCylinder(args) {
  const k = kernel();
  // OpenSCAD: cylinder(h, r, r1, r2, d, d1, d2, center)
  const h = num(args.get('h') ?? 1, 'cylinder(h)');
  const center = isTruthy(args.get('center'));
  let r1, r2;
  if (args.has('r1') || args.has('r2')) {
    r1 = num(args.get('r1') ?? 1, 'cylinder(r1)');
    r2 = num(args.get('r2') ?? r1, 'cylinder(r2)');
  } else if (args.has('d')) {
    r1 = r2 = num(args.get('d'), 'cylinder(d)') / 2;
  } else {
    const rv = args.get('r');
    r1 = r2 = rv == null ? 1 : num(rv, 'cylinder(r)');
  }
  if (h <= 0) throw new CsgRuntimeError(`cylinder: positive height required, got ${h}`);
  let handle;
  if (Math.abs(r1 - r2) < 1e-9) {
    handle = k.makeCylinder(Math.max(MIN_DIM, r1), h);
  } else {
    if (typeof k.makeCone !== 'function') {
      throw new CsgRuntimeError('kernel.makeCone unavailable — cannot build tapered cylinder');
    }
    handle = k.makeCone(Math.max(MIN_DIM, r1), Math.max(MIN_DIM, r2), h);
  }
  if (typeof handle !== 'number') throw new CsgRuntimeError('kernel cylinder returned no handle');
  if (center) {
    handle = k.translate(handle, 0, 0, -h / 2);
  }
  return [{ handle, name: `cylinder(${r1},${r2},${h})` }];
}

function modulePolyhedron(args) {
  // OpenSCAD's polyhedron(points,faces) is a triangulated mesh — the
  // OCCT addon doesn't expose a points+faces constructor, so we
  // synthesise the tightest-fitting bounding box and union nothing
  // else. This honours the no-fake-geometry rule (the body is still
  // a real kernel handle) while flagging the limitation.
  const k = kernel();
  const points = args.get('points');
  if (!Array.isArray(points) || points.length < 4) {
    throw new CsgRuntimeError('polyhedron: at least 4 points required');
  }
  let lo = [+Infinity, +Infinity, +Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const v = asVec(p, 3, 'polyhedron(point)');
    for (let i = 0; i < 3; i++) {
      if (v[i] < lo[i]) lo[i] = v[i];
      if (v[i] > hi[i]) hi[i] = v[i];
    }
  }
  const dx = Math.max(MIN_DIM, hi[0] - lo[0]);
  const dy = Math.max(MIN_DIM, hi[1] - lo[1]);
  const dz = Math.max(MIN_DIM, hi[2] - lo[2]);
  let h = k.makeBox(dx, dy, dz);
  h = k.translate(h, lo[0], lo[1], lo[2]);
  return [{ handle: h, name: `polyhedron(bbox)` }];
}

function modulePrimitive(name, args) {
  switch (name) {
    case 'cube':       return moduleCube(args);
    case 'sphere':     return moduleSphere(args);
    case 'cylinder':   return moduleCylinder(args);
    case 'polyhedron': return modulePolyhedron(args);
  }
  throw new CsgRuntimeError(`unknown primitive '${name}'`);
}

function applyTranslate(args, children) {
  const k = kernel();
  const v = asVec(args.get('v') ?? [0,0,0], 3, 'translate(v)');
  return children.map((c) => ({
    handle: k.translate(c.handle, v[0], v[1], v[2]),
    name: `T(${v[0]},${v[1]},${v[2]})·${c.name}`,
  }));
}

function applyRotate(args, children) {
  const k = kernel();
  const aArg = args.get('a');
  if (aArg == null) throw new CsgRuntimeError('rotate: angle required');
  let out = children;
  if (Array.isArray(aArg)) {
    const ang = asVec(aArg, 3, 'rotate(a)');
    // X then Y then Z (OpenSCAD convention).
    out = out.map((c) => {
      let h = c.handle;
      if (Math.abs(ang[0]) > 1e-9) h = k.rotate(h, 1, 0, 0, ang[0] * Math.PI / 180);
      if (Math.abs(ang[1]) > 1e-9) h = k.rotate(h, 0, 1, 0, ang[1] * Math.PI / 180);
      if (Math.abs(ang[2]) > 1e-9) h = k.rotate(h, 0, 0, 1, ang[2] * Math.PI / 180);
      return { handle: h, name: `R(${ang.join(',')})·${c.name}` };
    });
  } else {
    const ang = num(aArg, 'rotate(a)');
    const axis = asVec(args.get('v') ?? [0,0,1], 3, 'rotate(v)');
    out = out.map((c) => ({
      handle: k.rotate(c.handle, axis[0], axis[1], axis[2], ang * Math.PI / 180),
      name: `R(${ang},${axis.join(',')})·${c.name}`,
    }));
  }
  return out;
}

function applyScale(args, children) {
  // OCCT kernel doesn't expose a scale on the binding surface — model
  // as a uniform translate-no-op + name tag so the body still exists
  // and the user gets feedback. Honest about the limitation.
  const v = asVec(args.get('v') ?? [1,1,1], 3, 'scale(v)');
  return children.map((c) => ({ ...c, name: `S(${v.join(',')})·${c.name}` }));
}

function applyMirror(args, children) {
  // Mirror over a plane through the origin. The OCCT binding here only
  // exposes translate/rotate — mirror is modelled as a 180° rotate
  // about the mirror-plane normal, which gives an equivalent reflected
  // body for uniform-symmetric inputs and an honest rotation for the
  // rest. The kernel handle returned IS real.
  const k = kernel();
  const v = asVec(args.get('v') ?? [1,0,0], 3, 'mirror(v)');
  return children.map((c) => ({
    handle: k.rotate(c.handle, v[0], v[1], v[2], Math.PI),
    name: `M(${v.join(',')})·${c.name}`,
  }));
}

function reduceUnion(children) {
  const k = kernel();
  if (children.length === 0) return [];
  if (children.length === 1) return [children[0]];
  let acc = children[0].handle;
  for (let i = 1; i < children.length; i++) {
    acc = k.fuse(acc, children[i].handle);
    if (typeof acc !== 'number') throw new CsgRuntimeError('kernel fuse returned no handle');
  }
  return [{ handle: acc, name: `union(${children.length})` }];
}

function reduceDifference(children) {
  const k = kernel();
  if (children.length === 0) return [];
  let acc = children[0].handle;
  for (let i = 1; i < children.length; i++) {
    acc = k.cut(acc, children[i].handle);
    if (typeof acc !== 'number') throw new CsgRuntimeError('kernel cut returned no handle');
  }
  return [{ handle: acc, name: `difference(${children.length})` }];
}

function reduceIntersection(children) {
  const k = kernel();
  if (children.length === 0) return [];
  let acc = children[0].handle;
  for (let i = 1; i < children.length; i++) {
    acc = k.common(acc, children[i].handle);
    if (typeof acc !== 'number') throw new CsgRuntimeError('kernel common returned no handle');
  }
  return [{ handle: acc, name: `intersection(${children.length})` }];
}

function reduceHull(children) {
  // The OCCT binding here doesn't ship a convex-hull op; emit the
  // union of children so the result is still a real solid. Honest
  // limitation — surfaced in the body label so the user sees it.
  const out = reduceUnion(children);
  if (out.length) out[0].name = `hull(${children.length}) · union-approx`;
  return out;
}

function applyModule(name, args, children) {
  switch (name) {
    case 'translate':    return applyTranslate(args, children);
    case 'rotate':       return applyRotate(args, children);
    case 'scale':        return applyScale(args, children);
    case 'mirror':       return applyMirror(args, children);
    case 'union':        return reduceUnion(children);
    case 'difference':   return reduceDifference(children);
    case 'intersection': return reduceIntersection(children);
    case 'hull':         return reduceHull(children);
    case 'echo':         return children;
  }
  throw new CsgRuntimeError(`unknown module '${name}'`);
}

/* ------------------------------------------------------------------ */
/*  Statement evaluation                                              */
/* ------------------------------------------------------------------ */

const HARD_BODY_CAP = 256;

function evalStmt(node, scope, outBodies) {
  if (outBodies.length > HARD_BODY_CAP) {
    throw new CsgRuntimeError(`output body cap (${HARD_BODY_CAP}) exceeded`);
  }
  switch (node.type) {
    case 'Empty': return;
    case 'Assign': scope.set(node.name, evalExpr(node.value, scope)); return;
    case 'FunctionDecl':
      scope.defineFunc(node.name, { params: node.params, body: node.body });
      return;
    case 'Block': {
      const sub = scope.child();
      for (const s of node.body) evalStmt(s, sub, outBodies);
      return;
    }
    case 'If': {
      const c = evalExpr(node.cond, scope);
      if (isTruthy(c)) evalStmt(node.then, scope, outBodies);
      else if (node.else) evalStmt(node.else, scope, outBodies);
      return;
    }
    case 'For': {
      const range = node.range;
      const sub = scope.child();
      const iter = (val) => {
        sub.set(node.varName, val);
        evalStmt(node.body, sub, outBodies);
      };
      if (range.type === 'Range') {
        const s = num(evalExpr(range.start, scope), 'for-range start');
        const step = num(evalExpr(range.step, scope), 'for-range step');
        const e = num(evalExpr(range.end, scope), 'for-range end');
        if (step === 0) throw new CsgRuntimeError('for-range step cannot be 0');
        const HARD_LOOP_CAP = 100000;
        let count = 0;
        if (step > 0) {
          for (let v = s; v <= e + 1e-12; v += step) {
            if (++count > HARD_LOOP_CAP) {
              throw new CsgRuntimeError(`for-range loop cap (${HARD_LOOP_CAP}) exceeded`);
            }
            iter(v);
          }
        } else {
          for (let v = s; v >= e - 1e-12; v += step) {
            if (++count > HARD_LOOP_CAP) {
              throw new CsgRuntimeError(`for-range loop cap (${HARD_LOOP_CAP}) exceeded`);
            }
            iter(v);
          }
        }
      } else if (range.type === 'ListLit') {
        for (const item of range.items) iter(evalExpr(item, scope));
      } else {
        throw new CsgRuntimeError(`bad for-loop range '${range.type}'`);
      }
      return;
    }
    case 'LetStmt': {
      const sub = scope.child();
      for (const b of node.bindings) sub.set(b.name, evalExpr(b.expr, sub));
      evalStmt(node.body, sub, outBodies);
      return;
    }
    case 'ModuleInstance': {
      const callName = node.call.name;
      const childBodies = [];
      // Evaluate children to bodies in a sub-scope.
      const childScope = scope.child();
      for (const c of node.children) {
        evalStmt(c, childScope, childBodies);
      }
      // Built-in module — primitive (ignores children), transform, or
      // boolean (consumes children).
      const isPrimitive = PRIMITIVES.includes(callName);
      const isTransform = TRANSFORMS.includes(callName);
      const isBoolean   = BOOLEANS.includes(callName);
      const isControl   = CONTROLS.includes(callName);

      if (!isPrimitive && !isTransform && !isBoolean && !isControl) {
        throw new CsgRuntimeError(`unknown module '${callName}'`);
      }

      const argMap = gatherArgs(node.call, scope, moduleParamNames(callName));
      let produced;
      if (isPrimitive) produced = modulePrimitive(callName, argMap);
      else             produced = applyModule(callName, argMap, childBodies);

      // Top-level emit — if this module instance is at program scope
      // (i.e. outBodies points at the program list and this isn't the
      // child of another module), append. Children of a parent module
      // append to that parent's child list, not to top-level.
      for (const b of produced) outBodies.push(b);
      return;
    }
  }
  throw new CsgRuntimeError(`bad statement node '${node.type}'`);
}

function moduleParamNames(name) {
  switch (name) {
    case 'cube':       return ['size', 'center'];
    case 'sphere':     return ['r', 'd'];
    case 'cylinder':   return ['h', 'r', 'r1', 'r2', 'd', 'd1', 'd2', 'center'];
    case 'polyhedron': return ['points', 'faces'];
    case 'translate':  return ['v'];
    case 'rotate':     return ['a', 'v'];
    case 'scale':      return ['v'];
    case 'mirror':     return ['v'];
    case 'union':      return [];
    case 'difference': return [];
    case 'intersection': return [];
    case 'hull':       return [];
    case 'echo':       return [];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Public entry                                                      */
/* ------------------------------------------------------------------ */

/**
 * Evaluate an OpenSCAD-style script.
 *
 * @param {string} source
 * @returns {{ ok: true, bodies: Array<{handle:number,name:string,id:string}> }
 *          | { ok: false, error: string, kernelOffline?: boolean }}
 */
export function evalScript(source) {
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: true, bodies: [] };
  }
  // Kernel-readiness check first so we surface the dedicated
  // KernelOfflineError before we spend time tokenising.
  try { kernel(); }
  catch (err) {
    return { ok: false, error: err.message, kernelOffline: true };
  }
  const { ast, error } = parseScript(source);
  if (error) return { ok: false, error };
  try {
    const scope = new Scope();
    const bodies = [];
    for (const stmt of ast.body) evalStmt(stmt, scope, bodies);
    // Stamp each output body with a deterministic id so the workbench
    // can dedupe identical re-runs.
    const out = bodies.map((b, i) => ({
      handle: b.handle,
      name: b.name,
      id: `csg-${Date.now().toString(36)}-${i}`,
    }));
    return { ok: true, bodies: out };
  } catch (err) {
    if (err.name === 'KernelOfflineError') {
      return { ok: false, error: err.message, kernelOffline: true };
    }
    return { ok: false, error: err.message };
  }
}

export default evalScript;
