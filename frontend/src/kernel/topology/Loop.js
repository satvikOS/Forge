/**
 * ArchDisc Topology Spine — Loop
 *
 * SP-1 Stage S0. The closed coedge cycle bounding (part of) a Face — adapted
 * from `TopoLoop.js`. The defining upgrade over `TopoLoop`:
 *   `TopoLoop.halfEdges` was a raw array of `{edge, reversed}` tuples;
 *   `Loop.coedges` is an ordered array of first-class `Coedge` objects.
 *
 * A Face has one OUTER loop and zero or more INNER loops (holes).
 * `isOuter` distinguishes them. Newell-normal + signed-area carried over from
 * `TopoLoop` for orientation work.
 */

let _transientCounter = 0;

export default class Loop {
  /**
   * @param {import('./Coedge.js').default[]} [coedges]  ordered coedge cycle.
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   * @param {boolean} [opts.isOuter]
   */
  constructor(coedges = [], opts = {}) {
    this.type = 'loop';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.coedges = [];          // ordered Coedge[]
    this.face = null;           // owning Face
    this.isOuter = opts.isOuter !== undefined ? !!opts.isOuter : true;
    this.attributes = {};       // SP-2 hook
    this.userData = {};
    for (const ce of coedges) this.addCoedge(ce);
  }

  /** Append a coedge, taking ownership (sets `coedge.loop`). */
  addCoedge(coedge) {
    if (!coedge) return;
    coedge.loop = this;
    this.coedges.push(coedge);
  }

  /** Edges of the loop, in coedge order. */
  edges() { return this.coedges.map(ce => ce.edge); }

  /** Vertices of the loop, in traversal order (each coedge's start vertex). */
  vertices() { return this.coedges.map(ce => ce.startVertex()); }

  /** Ordered 3-D points around the loop. */
  orderedPoints() {
    return this.coedges
      .map(ce => { const v = ce.startVertex(); return v ? v.point : null; })
      .filter(Boolean);
  }

  /**
   * Closed = the last coedge's end vertex coincides with the first coedge's
   * start vertex. A valid loop is always closed.
   */
  isClosed() {
    if (this.coedges.length === 0) return false;
    const first = this.coedges[0];
    const last = this.coedges[this.coedges.length - 1];
    const a = first.startVertex();
    const b = last.endVertex();
    if (a && b && a === b) return true;
    // Geometric fallback — a degenerate/seam edge can break object identity;
    // accept coincident points within a tight tolerance.
    if (a && b) {
      const dx = a.point.x - b.point.x;
      const dy = a.point.y - b.point.y;
      const dz = a.point.z - b.point.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < 1e-6;
    }
    return false;
  }

  /**
   * Coedge-chain continuity: every coedge's end vertex is the next coedge's
   * start vertex. Stronger than `isClosed` — checks the whole cycle.
   */
  isChainContinuous() {
    const n = this.coedges.length;
    if (n === 0) return false;
    for (let i = 0; i < n; i++) {
      const cur = this.coedges[i];
      const nxt = this.coedges[(i + 1) % n];
      const end = cur.endVertex();
      const start = nxt.startVertex();
      if (end === start) continue;
      if (end && start) {
        const dx = end.point.x - start.point.x;
        const dy = end.point.y - start.point.y;
        const dz = end.point.z - start.point.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1e-6) continue;
      }
      return false;
    }
    return true;
  }

  /** Perimeter length. */
  length() {
    return this.coedges.reduce((s, ce) => s + (ce.edge ? ce.edge.length() : 0), 0);
  }

  /** Newell-method normal from the loop's ordered points. */
  computeNormal() {
    const pts = this.orderedPoints();
    const n = pts.length;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const c = pts[i];
      const d = pts[(i + 1) % n];
      nx += (c.y - d.y) * (c.z + d.z);
      ny += (c.z - d.z) * (c.x + d.x);
      nz += (c.x - d.x) * (c.y + d.y);
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) return { x: nx / len, y: ny / len, z: nz / len };
    return { x: 0, y: 0, z: 1 };
  }

  /** Signed area of the loop projected onto the plane normal to `normal`. */
  signedArea(normal) {
    const pts = this.orderedPoints();
    const n = pts.length;
    if (n < 3) return 0;
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    let u, v;
    if (az >= ax && az >= ay) { u = 'x'; v = 'y'; }
    else if (ay >= ax) { u = 'x'; v = 'z'; }
    else { u = 'y'; v = 'z'; }
    let area = 0;
    for (let i = 0; i < n; i++) {
      const c = pts[i];
      const d = pts[(i + 1) % n];
      area += c[u] * d[v] - d[u] * c[v];
    }
    return area * 0.5;
  }

  /** Reverse the loop — flip coedge order and each coedge's orientation. */
  reverse() {
    this.coedges.reverse();
    for (const ce of this.coedges) ce.reversed = !ce.reversed;
    return this;
  }

  toString() {
    return `Loop#${this.persistentId || this.transientId}` +
      `(${this.isOuter ? 'outer' : 'hole'}, ${this.coedges.length} coedges)`;
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
}
