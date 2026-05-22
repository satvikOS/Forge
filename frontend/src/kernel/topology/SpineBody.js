/**
 * ArchDisc Topology Spine — SpineBody
 *
 * SP-1 Stage S2. The successor to `BrepShape` as the currency that flows
 * facade → scene. A `SpineBody` wraps:
 *   - `body`        — the spine `Body` (topology truth: Body→…→Vertex).
 *   - `occtWrapper` — the heap-managed B-rep-engine `TopoDS_Shape` wrapper
 *                     (literally a `BrepShape` instance), which stays the
 *                     geometry engine + heavy-operation muscle.
 *   - `id` / `meta` — construction identity + metadata.
 *
 * CRUCIAL — the migration adapter (SP-1 §5): `SpineBody` is **duck-compatible
 * with `BrepShape`**. It exposes `.shape` (→ `occtWrapper.shape`), `.id`,
 * `.meta`, `.dispose()` and the `_triangulation` cache slot exactly as
 * `BrepShape` does. So `brepToMesh`, `measure`, `addBrepShapeToScene`,
 * `BodyRegistry.selectedBrepShapes`, and `withScope`'s survivor detection all
 * consume a `SpineBody` WITHOUT any change — an op can return a `SpineBody`
 * OR a `BrepShape` and the downstream is identical. This is what lets S3/S4
 * migrate ops incrementally with zero behaviour change.
 *
 * S0 introduces this class as scaffold (no op constructs one yet). S2 wires
 * the first op (`makeBox`) through it.
 */

let _idCounter = 0;

export default class SpineBody {
  /**
   * @param {import('./Body.js').default} body  the spine Body.
   * @param {import('../brep/BrepShape.js').BrepShape} occtWrapper  the
   *        heap-managed engine-shape wrapper (a BrepShape).
   * @param {object} [meta]  construction metadata { op, params, parents }.
   */
  constructor(body, occtWrapper, meta = {}) {
    this.id = `spine-${++_idCounter}`;
    this.body = body;
    this.occtWrapper = occtWrapper;
    this.meta = meta;
    this._disposed = false;
    // Mirror BrepShape's triangulation cache slot. Some consumers read/write
    // `._triangulation` directly on the body object they were handed;
    // delegating it to the occtWrapper keeps a single cache.
  }

  /**
   * The live engine `TopoDS_Shape` — the `.shape` getter `BrepShape` exposes.
   * Every existing `BrepShape` consumer reads `.shape`; delegating here makes
   * a `SpineBody` indistinguishable to them.
   */
  get shape() {
    return this.occtWrapper ? this.occtWrapper.shape : null;
  }

  /** Triangulation cache — delegated to the engine wrapper (single cache). */
  get _triangulation() {
    return this.occtWrapper ? this.occtWrapper._triangulation : null;
  }

  set _triangulation(v) {
    if (this.occtWrapper) this.occtWrapper._triangulation = v;
  }

  /** Body kind ('solid'|'sheet'|'wire') — convenience pass-through. */
  get kind() {
    return this.body ? this.body.kind : null;
  }

  /** True if the spine body carries any non-manifold edge. */
  get isNonManifold() {
    return !!(this.body && this.body.nonManifoldEdges().length > 0);
  }

  /**
   * Free the underlying engine shape (delegates to the BrepShape wrapper's
   * own `dispose`, preserving its `withScope`/`.delete()` discipline) and
   * drop the spine graph.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try {
      if (this.occtWrapper && typeof this.occtWrapper.dispose === 'function') {
        this.occtWrapper.dispose();
      }
    } catch { /* already gone */ }
    this.occtWrapper = null;
    this.body = null;
  }
}

/**
 * True if `x` is a SpineBody (used by `withScope` survivor detection and by
 * ops that accept either currency).
 * @param {*} x
 * @returns {boolean}
 */
export function isSpineBody(x) {
  return !!x && x instanceof SpineBody;
}
