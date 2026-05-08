/**
 * ArchDisc Geometry Kernel — Topological Loop (Wire)
 * A loop is an ordered, closed sequence of edges forming a boundary of a face.
 * A face has one outer loop and zero or more inner loops (holes).
 */

let _loopId = 0;

export default class TopoLoop {
  constructor(halfEdges = []) {
    this.id = ++_loopId;
    this.type = 'loop';
    this.halfEdges = halfEdges; // Array of { edge, reversed: bool }
    this.face = null;           // parent face
    this.isOuter = true;        // false = hole
    this.tag = 0;
    this.userData = {};
  }

  vertices() {
    return this.halfEdges.map(he =>
      he.reversed ? he.edge.endVertex : he.edge.startVertex
    );
  }

  edges() {
    return this.halfEdges.map(he => he.edge);
  }

  isClosed() {
    if (this.halfEdges.length === 0) return false;
    const first = this.halfEdges[0];
    const last = this.halfEdges[this.halfEdges.length - 1];
    const firstVertex = first.reversed ? first.edge.endVertex : first.edge.startVertex;
    const lastVertex = last.reversed ? last.edge.startVertex : last.edge.endVertex;
    return firstVertex === lastVertex;
  }

  length() {
    return this.halfEdges.reduce((sum, he) => sum + he.edge.length(), 0);
  }

  // Get ordered points around the loop
  orderedPoints() {
    const pts = [];
    for (const he of this.halfEdges) {
      const v = he.reversed ? he.edge.endVertex : he.edge.startVertex;
      pts.push(v.point);
    }
    return pts;
  }

  // Compute normal from loop vertices (Newell's method)
  computeNormal() {
    const pts = this.orderedPoints();
    const n = pts.length;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      nx += (curr.y - next.y) * (curr.z + next.z);
      ny += (curr.z - next.z) * (curr.x + next.x);
      nz += (curr.x - next.x) * (curr.y + next.y);
    }
    const normal = { x: nx, y: ny, z: nz };
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) return { x: nx / len, y: ny / len, z: nz / len };
    return { x: 0, y: 0, z: 1 };
  }

  // Signed area (for orientation checking, works best for planar loops)
  signedArea(normal) {
    const pts = this.orderedPoints();
    const n = pts.length;
    if (n < 3) return 0;

    // Project to 2D using dominant axis
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);

    let u, v;
    if (az >= ax && az >= ay) { u = 'x'; v = 'y'; }
    else if (ay >= ax) { u = 'x'; v = 'z'; }
    else { u = 'y'; v = 'z'; }

    let area = 0;
    for (let i = 0; i < n; i++) {
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      area += curr[u] * next[v] - next[u] * curr[v];
    }
    return area * 0.5;
  }

  reverse() {
    this.halfEdges.reverse();
    for (const he of this.halfEdges) {
      he.reversed = !he.reversed;
    }
    return this;
  }

  addHalfEdge(edge, reversed = false) {
    this.halfEdges.push({ edge, reversed });
  }

  toString() {
    const vIds = this.vertices().map(v => v.id).join('→');
    return `Loop#${this.id}(${this.isOuter ? 'outer' : 'hole'}: ${vIds})`;
  }
}

export function resetLoopIds() { _loopId = 0; }
