/**
 * ArchDisc Kernel — BrepShape: a managed wrapper over an OCCT TopoDS_Shape.
 *
 * OCCT objects are Embind-wrapped C++ objects; they leak the WASM heap
 * unless `.delete()`d. Every kernel op runs inside `withScope()`, which
 * frees every OCCT object allocated during the op except the BrepShape(s)
 * the op returns.
 */

let _idCounter = 0;

export class BrepShape {
  /**
   * @param {object} shape  an OCCT TopoDS_Shape
   * @param {object} [meta] construction metadata { op, params, parents }
   */
  constructor(shape, meta = {}) {
    this.id = `brep-${++_idCounter}`;
    this.shape = shape;
    this.meta = meta;
    this._disposed = false;
    this._triangulation = null; // cached {positions,normals,indices}
  }

  /** Free the underlying OCCT shape and any cached triangulation. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { if (this.shape && this.shape.delete) this.shape.delete(); } catch { /* already gone */ }
    this.shape = null;
    this._triangulation = null;
  }
}

// Stack of active disposal scopes. The innermost is at the end.
const _scopeStack = [];

/**
 * Track an OCCT Embind object for disposal at the end of the current scope.
 * Called by kernel ops for every transient OCCT object (builders, sub-shapes).
 * @template T
 * @param {T} ocObject
 * @returns {T} the same object, for chaining
 */
export function track(ocObject) {
  const scope = _scopeStack[_scopeStack.length - 1];
  if (scope && ocObject) scope.push(ocObject);
  return ocObject;
}

/**
 * Run `fn` inside a disposal scope. Every object passed to `track()` during
 * `fn` is `.delete()`d on exit — except objects reachable from the value
 * `fn` returns (a BrepShape, or an array of them), which survive.
 * @param {() => (Promise<any>|any)} fn
 * @returns {Promise<any>} whatever `fn` returns
 */
export async function withScope(fn) {
  const scope = [];
  _scopeStack.push(scope);
  let result;
  try {
    result = await fn();
  } finally {
    _scopeStack.pop();
    const survivors = new Set();
    const keep = Array.isArray(result) ? result : [result];
    for (const r of keep) {
      if (r instanceof BrepShape && r.shape) survivors.add(r.shape);
    }
    for (const obj of scope) {
      if (survivors.has(obj)) continue;
      try { if (obj && obj.delete) obj.delete(); } catch { /* already gone */ }
    }
  }
  return result;
}
