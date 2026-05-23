/**
 * ArchDisc Kernel — BrepShape: a managed wrapper over a kernel TopoDS_Shape.
 *
 * the kernel's WASM-bound objects leak the heap
 * unless `.delete()`d. Every kernel op runs inside `withScope()`, which
 * frees every kernel object allocated during the op except the BrepShape(s)
 * the op returns.
 */

let _idCounter = 0;

export class BrepShape {
  /**
   * @param {object} shape  a kernel TopoDS_Shape
   * @param {object} [meta] construction metadata { op, params, parents }
   */
  constructor(shape, meta = {}) {
    this.id = `brep-${++_idCounter}`;
    this.shape = shape;
    this.meta = meta;
    this._disposed = false;
    this._triangulation = null; // cached {positions,normals,indices}
  }

  /** Free the underlying kernel shape and any cached triangulation. */
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
 * Track a kernel WASM-bound object for disposal at the end of the current scope.
 * Called by kernel ops for every transient WASM-bound object (builders, sub-shapes).
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
 * `fn` returns (a BrepShape, a SpineBody, or an array of them), which survive.
 *
 * SP-1 S2 — survivor detection recognises `SpineBody` (the migrated-op
 * currency, duck-compatible with BrepShape). A SpineBody wraps an
 * `occtWrapper` (a BrepShape), and its `.shape` getter delegates to that
 * wrapper's `.shape` — so the engine-shape kept alive is the same TopoDS_Shape
 * by either return path. Detection uses a duck-type check rather than an
 * `instanceof SpineBody` import to avoid a cyclic kernel/topology → kernel/brep
 * module dependency (BrepShape.js is the lower layer; SpineBody.js imports
 * from it transitively via Body / IdAllocator). Any object that exposes a
 * live `.shape` and a `body` field is treated as a SpineBody survivor — the
 * exact public contract of SpineBody.
 *
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
      if (!r) continue;
      // BrepShape — the original currency.
      if (r instanceof BrepShape && r.shape) survivors.add(r.shape);
      // SpineBody (SP-1 S2) — duck-typed to avoid a cyclic import. The
      // SpineBody wraps a BrepShape `occtWrapper`; protect BOTH the engine
      // shape and the underlying wrapper so a subsequent op that hands the
      // wrapper back into withScope still finds a live BrepShape.
      else if (r.body && r.occtWrapper && r.shape) {
        survivors.add(r.shape);
        if (r.occtWrapper instanceof BrepShape && r.occtWrapper.shape) {
          survivors.add(r.occtWrapper.shape);
        }
      }
    }
    for (const obj of scope) {
      if (survivors.has(obj)) continue;
      try { if (obj && obj.delete) obj.delete(); } catch { /* already gone */ }
    }
  }
  return result;
}
