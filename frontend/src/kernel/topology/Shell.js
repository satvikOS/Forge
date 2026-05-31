/**
 * ArchDisc Topology Spine — Shell
 *
 * SP-1 Stage S0. A connected set of faces (± wire edges) — adapted from
 * `TopoShell.js` and extended for the spine:
 *   - `role`      — 'peripheral' (bounds the lump outward) or 'void' (bounds
 *                    an internal cavity). The pre-spine model had no explicit
 *                    notion; `TopoSolid.innerShells` was the only void hint.
 *   - `wireEdges` — a Shell may carry dangling wire edges alongside faces (an
 *                    ACIS mixed shell), and a pure wire-body shell carries ONLY
 *                    wire edges, no faces (the carrier for sketch profiles /
 *                    sweep paths — SP-1 §2.2).
 *   - `lump`      — owning Lump back-reference.
 *
 * Closure, manifold classification and Euler characteristic live here.
 */

let _transientCounter = 0;

export default class Shell {
  /**
   * @param {import('./Face.js').default[]} [faces]
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   * @param {'peripheral'|'void'} [opts.role]
   * @param {import('./Edge.js').default[]} [opts.wireEdges]
   */
  constructor(faces = [], opts = {}) {
    this.type = 'shell';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.faces = new Set();
    this.wireEdges = new Set(opts.wireEdges || []);
    this.lump = null;
    this.role = opts.role || 'peripheral';
    this.attributes = {};        // SP-2 hook
    this.userData = {};
    for (const f of faces) this.addFace(f);
  }

  /** Add a face, taking ownership (sets `face.shell`). */
  addFace(face) {
    if (!face) return;
    this.faces.add(face);
    face.shell = this;
  }

  removeFace(face) {
    this.faces.delete(face);
    if (face && face.shell === this) face.shell = null;
  }

  /** Add a dangling wire edge (no face uses it). */
  addWireEdge(edge) { if (edge) this.wireEdges.add(edge); }

  /** Number of faces in this shell. */
  faceCount() { return this.faces.size; }

  /** Distinct edges of all faces, plus wire edges. */
  edges() {
    const es = new Set();
    for (const f of this.faces) { for (const e of f.edges()) es.add(e); }
    for (const e of this.wireEdges) es.add(e);
    return [...es];
  }

  /** Distinct vertices of all faces + wire edges. */
  vertices() {
    const vs = new Set();
    for (const f of this.faces) { for (const v of f.vertices()) vs.add(v); }
    for (const e of this.wireEdges) {
      if (e.startVertex) vs.add(e.startVertex);
      if (e.endVertex) vs.add(e.endVertex);
    }
    return [...vs];
  }

  /** Every coedge of every face. */
  coedges() {
    const out = [];
    for (const f of this.faces) out.push(...f.coedges());
    return out;
  }

  /**
   * Closed = every real face-bounding edge is shared by ≥2 coedges (no free
   * boundary edge).
   *
   * DEGENERATE edges are excluded: a degenerate edge (a zero-length seam/apex
   * edge — e.g. the pole of a sphere or the apex of a cone) is a topological
   * artefact, not a real boundary. It legitimately carries only 1 coedge, and
   * counting it as a free boundary would wrongly classify a watertight solid
   * sphere as an open sheet. This mirrors how commercial kernels treat the
   * degenerate (singular) edge — it bounds nothing.
   *
   * Wire edges do not count against closure either — a closed solid shell may
   * still carry incidental wire edges (mixed shell).
   */
  isClosed() {
    if (this.faces.size === 0) return false;
    for (const f of this.faces) {
      for (const e of f.edges()) {
        if (e.isDegenerate()) continue;
        if (e.coedges.size < 2) return false;
      }
    }
    return true;
  }

  /**
   * Manifold = every real (non-degenerate) face-bounding edge has exactly 2
   * coedges. A non-manifold shell has at least one edge used by >2 faces.
   * Degenerate edges are excluded (see `isClosed`).
   */
  isManifold() {
    for (const f of this.faces) {
      for (const e of f.edges()) {
        if (e.isDegenerate()) continue;
        if (e.coedges.size !== 2) return false;
      }
    }
    return true;
  }

  /** Edges of this shell used by >2 coedges — the non-manifold edges. */
  nonManifoldEdges() {
    return this.edges().filter(e => e.coedges.size > 2);
  }

  /** True if this shell carries only wire edges and no faces (wire-body shell). */
  isWireOnly() {
    return this.faces.size === 0 && this.wireEdges.size > 0;
  }

  /** Euler characteristic χ = V − E + F of this shell. */
  eulerCharacteristic() {
    return this.vertices().length - this.edges().length + this.faces.size;
  }

  /** Surface area — sum of face areas. */
  surfaceArea() {
    let a = 0;
    for (const f of this.faces) a += f.area();
    return a;
  }

  toString() {
    return `Shell#${this.persistentId || this.transientId}` +
      `(${this.role}, ${this.faces.size} faces` +
      `${this.wireEdges.size ? `, ${this.wireEdges.size} wire-edges` : ''}, ` +
      `${this.isClosed() ? 'closed' : 'open'}` +
      `${this.isManifold() ? '' : ', non-manifold'})`;
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
