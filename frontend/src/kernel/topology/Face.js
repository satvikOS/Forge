/**
 * ArchDisc Topology Spine — Face
 *
 * SP-1 Stage S0. The 2-D entity of the unified spine — a bounded region of
 * exactly one Surface — adapted from `TopoFace.js` and extended:
 *   - `persistentId` / `transientId` — see Vertex.js.
 *   - `geomRef`  — engine sub-face reference; null for a spine-native analytic
 *                  face (G2 blend / N-sided / face-replace — S6 makes those
 *                  genuine spine faces; their `Surface.analytic === true`).
 *   - `body`     — owning Body back-reference.
 *   - `surface`  — a Surface adapter presenting a uniform `pointAt/normalAt`
 *                  contract regardless of which engine backs the geometry.
 *
 * A Face has one OUTER loop and zero or more INNER loops (holes); `reversed`
 * flags the face normal relative to the surface normal.
 */

let _transientCounter = 0;

export default class Face {
  /**
   * @param {object} surface  a Surface adapter (pointAt/normalAt), or null.
   * @param {import('./Loop.js').default} outerLoop
   * @param {import('./Loop.js').default[]} [innerLoops]
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   * @param {object} [opts.geomRef]
   * @param {boolean} [opts.reversed]
   */
  constructor(surface, outerLoop, innerLoops = [], opts = {}) {
    this.type = 'face';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.geomRef = opts.geomRef || null;
    this.surface = surface || null;
    this.outerLoop = outerLoop || null;
    this.innerLoops = innerLoops || [];
    this.shell = null;             // owning Shell
    this.body = null;              // owning Body
    this.reversed = !!opts.reversed;
    this.derivedFrom = [];
    this.attributes = {};          // SP-2 hook
    this.userData = {};

    // Link loops to this face.
    if (this.outerLoop) {
      this.outerLoop.face = this;
      this.outerLoop.isOuter = true;
    }
    for (const loop of this.innerLoops) {
      loop.face = this;
      loop.isOuter = false;
    }
  }

  /** Outer loop + every inner loop. */
  allLoops() {
    const loops = [];
    if (this.outerLoop) loops.push(this.outerLoop);
    loops.push(...this.innerLoops);
    return loops;
  }

  /** Every coedge of every loop of this face. */
  coedges() {
    const out = [];
    for (const loop of this.allLoops()) out.push(...loop.coedges);
    return out;
  }

  /** Distinct edges bounding this face. */
  edges() {
    const es = new Set();
    for (const ce of this.coedges()) { if (ce.edge) es.add(ce.edge); }
    return [...es];
  }

  /** Distinct vertices on this face's boundary. */
  vertices() {
    const vs = new Set();
    for (const loop of this.allLoops()) {
      for (const v of loop.vertices()) { if (v) vs.add(v); }
    }
    return [...vs];
  }

  /** Faces sharing an edge with this face (across coedge partners). */
  adjacentFaces() {
    const fs = new Set();
    for (const edge of this.edges()) {
      for (const f of edge.faces()) { if (f !== this) fs.add(f); }
    }
    return [...fs];
  }

  /** True if the face geometry is a spine-native analytic surface (no geomRef). */
  get isAnalytic() {
    return !this.geomRef && !!(this.surface && this.surface.analytic);
  }

  /** Add an inner (hole) loop. */
  addInnerLoop(loop) {
    if (!loop) return;
    loop.face = this;
    loop.isOuter = false;
    this.innerLoops.push(loop);
  }

  /** Surface normal at (u,v), honouring the `reversed` flag. */
  normal(u, v) {
    if (this.surface && typeof this.surface.normalAt === 'function') {
      const n = this.surface.normalAt(u, v);
      if (n) return this.reversed ? negate(n) : n;
    }
    if (this.outerLoop) {
      const n = this.outerLoop.computeNormal();
      return this.reversed ? negate(n) : n;
    }
    return { x: 0, y: 0, z: 1 };
  }

  /** Approximate boundary area (outer minus inner loops). */
  area() {
    if (!this.outerLoop) return 0;
    const normal = this.outerLoop.computeNormal();
    let a = Math.abs(this.outerLoop.signedArea(normal));
    for (const inner of this.innerLoops) {
      a -= Math.abs(inner.signedArea(normal));
    }
    return Math.max(0, a);
  }

  /** Flip the face — toggle `reversed` and reverse all loops. */
  flip() {
    this.reversed = !this.reversed;
    if (this.outerLoop) this.outerLoop.reverse();
    for (const loop of this.innerLoops) loop.reverse();
    return this;
  }

  toString() {
    return `Face#${this.persistentId || this.transientId}` +
      `(${this.surface ? (this.surface.type || 'surface') : 'no-surf'}` +
      `${this.isAnalytic ? ' analytic' : ''}, ${this.edges().length} edges, ` +
      `${this.innerLoops.length} hole${this.innerLoops.length === 1 ? '' : 's'})`;
  }
}

function negate(n) { return { x: -n.x, y: -n.y, z: -n.z }; }
