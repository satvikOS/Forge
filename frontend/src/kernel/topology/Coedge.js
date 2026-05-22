/**
 * ArchDisc Topology Spine — Coedge
 *
 * SP-1 Stage S0. The directed use of an `Edge` by one `Loop` — ACIS COEDGE,
 * Parasolid FIN. This is a NEW first-class entity: it promotes the raw
 * `{edge, reversed}` tuples that `TopoLoop.halfEdges` carried into a real
 * object that can hold:
 *   - `reversed`  — orientation of the edge use relative to the edge's own
 *                   start→end direction.
 *   - `partner`   — the coedge of the adjacent face on the same edge. On a
 *                   manifold edge it points to the single other coedge; on a
 *                   non-manifold edge the coedges form a radial cycle and
 *                   `partner` is the next coedge in that cycle (so
 *                   `radialOrder(edge)` walks the cycle). null on a free edge.
 *   - `pcurve`    — the optional 2-D trace of the edge in the face's surface
 *                   parameter space (a Pcurve), used by analytic faces.
 *
 * A Coedge belongs to exactly one Loop, uses exactly one Edge.
 */

let _transientCounter = 0;

export default class Coedge {
  /**
   * @param {import('./Edge.js').default} edge   the edge this coedge uses.
   * @param {boolean} reversed  true if the use runs end→start of the edge.
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   * @param {object} [opts.pcurve]  optional 2-D parameter-space curve.
   */
  constructor(edge, reversed = false, opts = {}) {
    this.type = 'coedge';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.edge = edge;
    this.reversed = !!reversed;
    this.loop = null;        // owning Loop (set by Loop)
    this.partner = null;     // mate coedge / next in the radial cycle
    this.pcurve = opts.pcurve || null;
    this.attributes = {};    // SP-2 hook
    this.userData = {};

    if (edge) edge.addCoedge(this);
  }

  /** The face this coedge belongs to (via its loop). */
  face() { return this.loop ? this.loop.face : null; }

  /**
   * The directed start vertex — the vertex this coedge departs from, honouring
   * `reversed`. For a forward use it is the edge's startVertex.
   */
  startVertex() {
    if (!this.edge) return null;
    return this.reversed ? this.edge.endVertex : this.edge.startVertex;
  }

  /** The directed end vertex — the vertex this coedge arrives at. */
  endVertex() {
    if (!this.edge) return null;
    return this.reversed ? this.edge.startVertex : this.edge.endVertex;
  }

  /**
   * True if `partner` forms a manifold mate — exactly one other coedge on the
   * edge, on a different face.
   */
  hasManifoldPartner() {
    return !!this.partner && this.edge && this.edge.coedges.size === 2;
  }

  detach() {
    if (this.edge) this.edge.removeCoedge(this);
    this.edge = null;
    this.loop = null;
    this.partner = null;
  }

  toString() {
    const e = this.edge;
    return `Coedge#${this.persistentId || this.transientId}` +
      `(edge ${e ? (e.persistentId || e.transientId) : '?'}` +
      `${this.reversed ? ' reversed' : ''})`;
  }
}
