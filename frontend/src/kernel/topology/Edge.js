/**
 * ArchDisc Topology Spine — Edge
 *
 * SP-1 Stage S0. The 1-D entity of the unified spine, adapted from
 * `TopoEdge.js` and extended for the spine contract:
 *   - `persistentId` / `transientId` — see Vertex.js.
 *   - `geomRef`   — engine sub-edge reference, or null (spine-native edge).
 *   - `tolerance` — modelling tolerance (SP-11 tolerant edges; default 0).
 *   - `coedges`   — the directed uses of this edge by loops (the radial set).
 *                   This REPLACES `TopoEdge.faces`: in the spine an edge knows
 *                   its `Coedge`s, and the faces are reached through them.
 *                   Manifold edge = exactly 2 coedges. Non-manifold = >2.
 *   - `body`      — owning Body back-reference.
 *
 * An Edge references one Curve, bounded by two Vertices.
 */

let _transientCounter = 0;

export default class Edge {
  /**
   * @param {import('./Vertex.js').default} startVertex
   * @param {import('./Vertex.js').default} endVertex
   * @param {object|null} curve  a Curve adapter (pointAt/tangentAt/length) or null.
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   * @param {object} [opts.geomRef]
   * @param {number} [opts.tolerance]
   */
  constructor(startVertex, endVertex, curve, opts = {}) {
    this.type = 'edge';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.geomRef = opts.geomRef || null;
    this.tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 0;
    this.startVertex = startVertex;
    this.endVertex = endVertex;
    this.curve = curve || null;
    this.coedges = new Set();   // Coedge objects — the directed uses of this edge
    this.body = null;
    this.degenerate = false;    // true for a degenerate (zero-length / seam) edge
    this.derivedFrom = [];
    this.attributes = {};       // SP-2 hook
    this.userData = {};

    // Register with vertices.
    if (startVertex) startVertex.addEdge(this);
    if (endVertex && endVertex !== startVertex) endVertex.addEdge(this);
  }

  /** Length of the edge — from the curve if present, else chord. */
  length() {
    if (this.curve && typeof this.curve.length === 'function') {
      try { return this.curve.length(); } catch { /* fall through */ }
    }
    if (!this.startVertex || !this.endVertex) return 0;
    return distance(this.startVertex.point, this.endVertex.point);
  }

  /** The other endpoint, or null if `v` is not an endpoint. */
  otherVertex(v) {
    if (v === this.startVertex) return this.endVertex;
    if (v === this.endVertex) return this.startVertex;
    return null;
  }

  hasVertex(v) { return v === this.startVertex || v === this.endVertex; }

  addCoedge(coedge) { this.coedges.add(coedge); }
  removeCoedge(coedge) { this.coedges.delete(coedge); }

  /** Number of coedges (directed uses) of this edge. */
  coedgeCount() { return this.coedges.size; }

  /**
   * Manifold = exactly 2 coedges (the edge is shared by exactly 2 face-uses).
   * The classic interior edge of a watertight solid.
   */
  isManifold() { return this.coedges.size === 2; }

  /**
   * Non-manifold = more than 2 coedges (≥3 faces meet at this edge — the
   * radial-edge case). bindSpine builds a radial cycle for these.
   */
  isNonManifold() { return this.coedges.size > 2; }

  /**
   * Free boundary = fewer than 2 coedges — a lamina / open-sheet edge, or a
   * dangling wire edge (0 coedges).
   */
  isBoundary() { return this.coedges.size < 2; }

  /** The distinct faces using this edge (through its coedges). */
  faces() {
    const fs = new Set();
    for (const ce of this.coedges) {
      const f = ce.loop && ce.loop.face;
      if (f) fs.add(f);
    }
    return [...fs];
  }

  /** True for a degenerate (zero-length) edge — a kernel seam/apex artefact. */
  isDegenerate() {
    if (this.degenerate) return true;
    return this.length() < 1e-9;
  }

  toString() {
    return `Edge#${this.persistentId || this.transientId}` +
      `(V${this.startVertex ? (this.startVertex.persistentId || this.startVertex.transientId) : '?'}` +
      `→V${this.endVertex ? (this.endVertex.persistentId || this.endVertex.transientId) : '?'}` +
      `, ${this.coedges.size} coedge${this.coedges.size === 1 ? '' : 's'})`;
  }

  // ── SP-2 attribute accessors ────────────────────────────────────────────
  /** Keys of every attribute on this edge. */
  attributeKeys() { return Object.keys(this.attributes || {}); }
  /** Get one attribute record, or null. */
  getAttribute(key) { return (this.attributes && this.attributes[key]) || null; }
  /** Get the value of one attribute, or undefined. */
  attributeValue(key) {
    const r = this.getAttribute(key); return r ? r.value : undefined;
  }
  /** True if this edge has an attribute under `key`. */
  hasAttribute(key) { return !!(this.attributes && this.attributes[key]); }
  /** Iterate every attribute record on this edge. */
  *listAttributes() {
    if (this.attributes) for (const r of Object.values(this.attributes)) yield r;
  }

  // ── SP-11 tolerance accessors ─────────────────────────────────────────
  //
  // First-class tolerant edges — the Parasolid "tedge" / ACIS "tolerant
  // edge" contract. An edge's tolerance is the maximum modelling distance
  // its curve geometry may diverge from the kernel-ideal curve before
  // adjacent ops should still treat the edge as valid. Default 0 = exact.
  // SP-11 promotes tolerance from a passive S0 field into an ACTIVE op
  // input: ops query `getTolerance()` to widen their fuzzy thresholds;
  // booleans propagate the MAX of input tolerances onto result edges via
  // `carryLineage`; tolerant edges are listed via `BrepSheet.tolerantEdges`.
  //
  // The setter validates that the value is a non-negative finite number —
  // a tolerance is a distance, never negative, and NaN/Infinity would
  // poison the survival propagation max-rule. Throws on a bad value
  // rather than silently coercing.

  /**
   * Set this edge's modelling tolerance (mm). Must be a finite ≥0 number.
   * @param {number} value  tolerance in millimetres (0 = exact).
   * @returns {this}
   * @throws if `value` is negative, NaN, or non-finite.
   */
  setTolerance(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `Edge.setTolerance: expected a finite ≥0 number, got ${String(value)}`);
    }
    this.tolerance = value;
    return this;
  }

  /** Read this edge's modelling tolerance (mm). 0 = exact. */
  getTolerance() {
    return Number.isFinite(this.tolerance) ? this.tolerance : 0;
  }

  /** True if this edge is "tolerant" (tolerance > `threshold`, default 0). */
  isTolerant(threshold = 0) {
    return this.getTolerance() > threshold;
  }
}

function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
