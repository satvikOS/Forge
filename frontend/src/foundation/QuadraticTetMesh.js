/**
 * ArchDisc Foundation — 10-node quadratic tetrahedral mesh.
 *
 * Each linear (4-node) tet is upgraded to a 10-node quadratic tet by
 * inserting a mid-edge node on each of its 6 edges. Adjacent tets that
 * share an edge share the same mid-edge node so the mesh remains
 * conforming with no duplicates.
 *
 * Standard local node ordering used here (matches ANSYS, NX Nastran,
 * CalculiX, Abaqus when their order is reverse-mapped):
 *
 *   Corner nodes:      0 1 2 3   (same as the source 4-node tet)
 *   Mid-edge nodes:    4 = mid(0-1)
 *                      5 = mid(1-2)
 *                      6 = mid(2-0)
 *                      7 = mid(0-3)
 *                      8 = mid(1-3)
 *                      9 = mid(2-3)
 *
 * Why 10-node tets:
 *   - Linear (4-node) tets are constant-strain elements; they suffer
 *     "shear locking" under bending and over-stiffen by 25-35 % at
 *     coarse mesh density.
 *   - 10-node tets are quadratic in displacement → linear in strain.
 *     Bending mode is captured properly. Cantilever error drops from
 *     -33 % (linear tet, 20×4×4 grid) to ~5 % at the same node count.
 *   - Unlike hex, tets can mesh ARBITRARY geometry (no structured-grid
 *     requirement). 10-node tets are the production-default element
 *     in NX Nastran, ANSYS, Abaqus for arbitrary 3D solids.
 *
 * Reference: Bathe §5.3, Cook/Malkus/Plesha §6.4-6.6.
 */

export class QuadraticTetMesh {
  constructor() {
    this.vertices = [];     // [x, y, z]
    this.tets = [];         // each is [n0, n1, n2, n3, n4, n5, n6, n7, n8, n9]
    this.metadata = {};
  }

  /**
   * Build a 10-node mesh from an existing linear (4-node) TetMesh by
   * inserting mid-edge nodes on every unique edge.
   *
   * @param {TetMesh} linearMesh
   * @returns {QuadraticTetMesh}
   */
  static fromLinearTetMesh(linearMesh) {
    const out = new QuadraticTetMesh();
    // Copy corner vertices first
    for (const v of linearMesh.vertices) out.vertices.push([v[0], v[1], v[2]]);
    const numCorners = out.vertices.length;

    // Edge map: sorted-pair "i,j" → mid-edge vertex index
    const edgeMidIdx = new Map();
    const getOrCreateMid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let mid = edgeMidIdx.get(key);
      if (mid !== undefined) return mid;
      const va = out.vertices[a], vb = out.vertices[b];
      mid = out.vertices.length;
      out.vertices.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
      edgeMidIdx.set(key, mid);
      return mid;
    };

    // Per-tet edge order matching the local node convention above.
    // Each entry is the pair of corner indices in the linear tet whose
    // midpoint is the mid-edge node.
    const EDGES = [
      [0, 1],   // → node 4
      [1, 2],   // → node 5
      [2, 0],   // → node 6
      [0, 3],   // → node 7
      [1, 3],   // → node 8
      [2, 3],   // → node 9
    ];
    for (const tet of linearMesh.tets) {
      const corners = tet.slice(0, 4);
      const mids = EDGES.map(([a, b]) => getOrCreateMid(tet[a], tet[b]));
      out.tets.push([...corners, ...mids]);
    }
    out.metadata = { ...linearMesh.metadata, sourceLinearTetCount: linearMesh.tets.length };
    return out;
  }

  selectNodes(predicate) {
    const out = [];
    for (let i = 0; i < this.vertices.length; i++)
      if (predicate(this.vertices[i], i)) out.push(i);
    return out;
  }

  /** Total volume = sum of corner-tet volumes (mid-edge nodes don't move). */
  totalVolume() {
    let V = 0;
    for (const tet of this.tets) {
      const a = this.vertices[tet[0]];
      const b = this.vertices[tet[1]];
      const c = this.vertices[tet[2]];
      const d = this.vertices[tet[3]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
      const det =
        ux * (vy * wz - vz * wy) -
        uy * (vx * wz - vz * wx) +
        uz * (vx * wy - vy * wx);
      V += Math.abs(det) / 6;
    }
    return V;
  }

  stats() {
    return {
      vertexCount: this.vertices.length,
      tetCount: this.tets.length,
      cornerCount: this.metadata.sourceLinearTetCount
        ? this.tets.length * 4   // each tet has 4 corners
        : null,
      totalVolume: this.totalVolume(),
      ...this.metadata,
    };
  }
}
