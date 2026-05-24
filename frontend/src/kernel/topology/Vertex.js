/**
 * ArchDisc Topology Spine — Vertex
 *
 * SP-1 Stage S0. The 0-D entity of the unified spine, adapted from
 * `TopoVertex.js` and extended for the spine contract:
 *   - `persistentId`  — a body-namespaced stable id (b3:v7), via IdAllocator.
 *   - `transientId`   — a fast in-session integer for map keys / debugging.
 *   - `geomRef`       — a stable reference into the B-rep engine's shape
 *                       (the engine sub-vertex), or null for a spine-native
 *                       vertex with no engine sub-shape.
 *   - `tolerance`     — modelling tolerance at this vertex (SP-11 tolerant
 *                       vertices; default 0 = exact).
 *   - `body`          — back-reference to the owning Body.
 *
 * A Vertex references one Point (a `{x,y,z}` / Vec3-like). It knows its edges.
 */

let _transientCounter = 0;

export default class Vertex {
  /**
   * @param {{x:number,y:number,z:number}} point  the geometric point (mm).
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   * @param {object} [opts.geomRef]    engine sub-shape reference, or null.
   * @param {number} [opts.tolerance]  modelling tolerance (mm).
   */
  constructor(point, opts = {}) {
    this.type = 'vertex';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.geomRef = opts.geomRef || null;
    this.tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 0;
    // Point — store a plain copy so the spine never aliases caller geometry.
    this.point = point && typeof point.clone === 'function'
      ? point.clone()
      : { x: point.x, y: point.y, z: point.z };
    this.edges = new Set();   // Edge objects referencing this vertex
    this.body = null;         // owning Body (set when attached)
    this.derivedFrom = [];    // persistentIds this vertex was derived from
    this.attributes = {};     // SP-2 hook — per-entity attributes
    this.userData = {};       // legacy provenance carrier (BooleanEngine etc.)
  }

  addEdge(edge) { this.edges.add(edge); }
  removeEdge(edge) { this.edges.delete(edge); }

  /** Number of edges incident on this vertex. */
  valence() { return this.edges.size; }

  /** Vertices reachable across one edge. */
  connectedVertices() {
    const verts = new Set();
    for (const edge of this.edges) {
      if (edge.startVertex && edge.startVertex !== this) verts.add(edge.startVertex);
      if (edge.endVertex && edge.endVertex !== this) verts.add(edge.endVertex);
    }
    return [...verts];
  }

  /** Faces touching this vertex (across its edges' coedges). */
  connectedFaces() {
    const faces = new Set();
    for (const edge of this.edges) {
      for (const f of edge.faces()) faces.add(f);
    }
    return [...faces];
  }

  /**
   * True if this vertex bridges otherwise-disjoint shells (a non-manifold
   * vertex) — its incident edges span more than one shell.
   */
  isNonManifold() {
    const shells = new Set();
    for (const edge of this.edges) {
      for (const f of edge.faces()) {
        if (f.shell) shells.add(f.shell);
      }
    }
    return shells.size > 1;
  }

  toString() {
    const p = this.point;
    return `Vertex#${this.persistentId || this.transientId}` +
      `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`;
  }

  // ── SP-2 attribute accessors ────────────────────────────────────────────
  attributeKeys() { return Object.keys(this.attributes || {}); }
  getAttribute(key) { return (this.attributes && this.attributes[key]) || null; }
  attributeValue(key) {
    const r = this.getAttribute(key); return r ? r.value : undefined;
  }
  hasAttribute(key) { return !!(this.attributes && this.attributes[key]); }
  *listAttributes() {
    if (this.attributes) for (const r of Object.values(this.attributes)) yield r;
  }

  // ── SP-11 tolerance accessors ─────────────────────────────────────────
  //
  // First-class tolerant vertices — the Parasolid "tvertex" / ACIS
  // "tolerant vertex" contract. A vertex's tolerance is the radius of the
  // sphere around its `point` within which the geometry of every incident
  // edge end must terminate. Default 0 = exact. SP-11 promotes the field
  // from a passive S0 carrier into an ACTIVE op input + lineage carry
  // (see Edge.setTolerance for the broader policy).

  /**
   * Set this vertex's modelling tolerance (mm). Must be a finite ≥0 number.
   * @param {number} value
   * @returns {this}
   * @throws if `value` is negative, NaN, or non-finite.
   */
  setTolerance(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `Vertex.setTolerance: expected a finite ≥0 number, got ${String(value)}`);
    }
    this.tolerance = value;
    return this;
  }

  /** Read this vertex's modelling tolerance (mm). 0 = exact. */
  getTolerance() {
    return Number.isFinite(this.tolerance) ? this.tolerance : 0;
  }

  /** True if this vertex is "tolerant" (tolerance > `threshold`, default 0). */
  isTolerant(threshold = 0) {
    return this.getTolerance() > threshold;
  }
}
