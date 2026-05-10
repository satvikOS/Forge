/**
 * ArchDisc Foundation — Tetrahedral mesh generation.
 *
 * For now we ship a regular grid tetrahedralizer: divide a bounding box
 * into nx × ny × nz hexahedral cells, split each cell into 6 tetrahedra
 * via Kuhn's standard decomposition, and (optionally) prune cells whose
 * centroids lie outside a target manifold solid.
 *
 * This is enough to do real FEM on the convex / boxy demonstrators (the
 * cantilever validation case is exact). Surface-conforming refinement
 * for arbitrary geometry is a future-iteration job.
 *
 * Vertex labels in a unit cell (binary x,y,z bits):
 *   0=(0,0,0)  1=(1,0,0)  2=(0,1,0)  3=(1,1,0)
 *   4=(0,0,1)  5=(1,0,1)  6=(0,1,1)  7=(1,1,1)
 *
 * Kuhn decomposition: 6 tets, each sharing the 0–7 main diagonal,
 * walking around the cube via x→y→z, x→z→y, y→x→z, y→z→x, z→x→y, z→y→x.
 */

const KUHN_TETS = [
  [0, 1, 3, 7],   // x → y → z
  [0, 1, 5, 7],   // x → z → y
  [0, 4, 5, 7],   // z → x → y
  [0, 4, 6, 7],   // z → y → x
  [0, 2, 6, 7],   // y → z → x
  [0, 2, 3, 7],   // y → x → z
];

export class TetMesh {
  constructor() {
    this.vertices = [];          // each entry: [x, y, z]
    this.tets = [];              // each entry: [v0, v1, v2, v3]
    this.boundaryFaces = [];     // each entry: [v0, v1, v2] (CCW from outside)
    this.metadata = {};
  }

  /**
   * Build a regular structured tetrahedral mesh covering [min..max] with
   * nx × ny × nz hex cells.
   */
  static regularGrid(min, max, nx, ny, nz) {
    const mesh = new TetMesh();
    const dx = (max[0] - min[0]) / nx;
    const dy = (max[1] - min[1]) / ny;
    const dz = (max[2] - min[2]) / nz;
    const idx = (i, j, k) => i + j * (nx + 1) + k * (nx + 1) * (ny + 1);
    for (let k = 0; k <= nz; k++)
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++)
          mesh.vertices.push([min[0] + i * dx, min[1] + j * dy, min[2] + k * dz]);

    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const v = [
            idx(i, j, k), idx(i + 1, j, k),
            idx(i, j + 1, k), idx(i + 1, j + 1, k),
            idx(i, j, k + 1), idx(i + 1, j, k + 1),
            idx(i, j + 1, k + 1), idx(i + 1, j + 1, k + 1),
          ];
          for (const t of KUHN_TETS) mesh.tets.push([v[t[0]], v[t[1]], v[t[2]], v[t[3]]]);
        }

    mesh.metadata.gridShape = [nx, ny, nz];
    mesh.metadata.cellSize = [dx, dy, dz];
    mesh.metadata.bbox = { min: [...min], max: [...max] };
    return mesh;
  }

  /**
   * Find all DOF nodes whose coordinates satisfy a predicate.
   * Useful for boundary conditions: e.g. fix all nodes with x ≈ 0.
   */
  selectNodes(predicate) {
    const out = [];
    for (let i = 0; i < this.vertices.length; i++) {
      if (predicate(this.vertices[i], i)) out.push(i);
    }
    return out;
  }

  /**
   * Compute total mesh volume by summing tet signed volumes.
   * Returns absolute value (for diagnostics).
   */
  totalVolume() {
    let V = 0;
    for (const t of this.tets) {
      const a = this.vertices[t[0]];
      const b = this.vertices[t[1]];
      const c = this.vertices[t[2]];
      const d = this.vertices[t[3]];
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

  /**
   * Statistics for a quality report.
   */
  stats() {
    return {
      vertexCount: this.vertices.length,
      tetCount: this.tets.length,
      totalVolume: this.totalVolume(),
      ...this.metadata,
    };
  }
}
