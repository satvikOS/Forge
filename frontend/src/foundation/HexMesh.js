/**
 * ArchDisc Foundation — Structured hexahedral mesh.
 *
 * Each grid cell becomes one 8-node trilinear hexahedral element.
 * For axis-aligned grids the elements are right rectangular prisms;
 * the same code accepts non-axis-aligned input by storing the 8
 * corner positions per element.
 *
 * Vertex local-numbering convention (matches LinearHexFEM Gauss
 * integration):
 *
 *      4 ─────── 5         z=+1
 *      │        │
 *      │  top   │
 *      │        │
 *      7 ─────── 6
 *
 *      0 ─────── 1         z=-1
 *      │        │
 *      │ bottom │
 *      │        │
 *      3 ─────── 2
 *
 * In natural coordinates (ξ, η, ζ) ∈ [-1, +1]³ corner i has signs
 * (xi[i], et[i], ze[i]) per the table:
 *
 *   i:   0  1  2  3   4  5  6  7
 *   ξ:  -1 +1 +1 -1  -1 +1 +1 -1
 *   η:  -1 -1 +1 +1  -1 -1 +1 +1
 *   ζ:  -1 -1 -1 -1  +1 +1 +1 +1
 *
 * The 12 element edges and 6 element faces follow this numbering.
 */

export const HEX_NATURAL_SIGNS = [
  [-1, -1, -1],   // 0
  [+1, -1, -1],   // 1
  [+1, +1, -1],   // 2
  [-1, +1, -1],   // 3
  [-1, -1, +1],   // 4
  [+1, -1, +1],   // 5
  [+1, +1, +1],   // 6
  [-1, +1, +1],   // 7
];

export class HexMesh {
  constructor() {
    this.vertices = [];     // each [x, y, z]
    this.hexes = [];        // each is an 8-element vertex-index array in HEX_NATURAL_SIGNS order
    this.metadata = {};
  }

  /**
   * Build a structured hex mesh from a regular grid covering [min, max].
   * Produces nx · ny · nz hex elements.
   */
  static regularGrid(min, max, nx, ny, nz) {
    const mesh = new HexMesh();
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
          // 8 corners in HEX_NATURAL_SIGNS order
          const v = [
            idx(i,     j,     k    ),  // 0
            idx(i + 1, j,     k    ),  // 1
            idx(i + 1, j + 1, k    ),  // 2
            idx(i,     j + 1, k    ),  // 3
            idx(i,     j,     k + 1),  // 4
            idx(i + 1, j,     k + 1),  // 5
            idx(i + 1, j + 1, k + 1),  // 6
            idx(i,     j + 1, k + 1),  // 7
          ];
          mesh.hexes.push(v);
        }

    mesh.metadata.gridShape = [nx, ny, nz];
    mesh.metadata.cellSize = [dx, dy, dz];
    mesh.metadata.bbox = { min: [...min], max: [...max] };
    return mesh;
  }

  /** Pick all node indices satisfying a predicate (vertex, index) → bool. */
  selectNodes(predicate) {
    const out = [];
    for (let i = 0; i < this.vertices.length; i++)
      if (predicate(this.vertices[i], i)) out.push(i);
    return out;
  }

  totalVolume() {
    // For a hex with 8 vertices, volume = ∫ det(J) dξdηdζ over [-1,+1]³.
    // For an axis-aligned right hex it's simply h_x · h_y · h_z. For a
    // distorted hex use 2×2×2 Gauss approximation.
    const G = 1 / Math.sqrt(3);
    const gp = [-G, +G];
    let V = 0;
    for (const hex of this.hexes) {
      const corners = hex.map(v => this.vertices[v]);
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
        const xi = gp[a], et = gp[b], ze = gp[c];
        // Compute Jacobian = ∂x/∂(ξ, η, ζ)
        const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < 8; i++) {
          const [xs, es, zs] = HEX_NATURAL_SIGNS[i];
          // ∂N_i/∂ξ = (1/8) xs (1 + es·η)(1 + zs·ζ)
          const dNxi = (1 / 8) * xs * (1 + es * et) * (1 + zs * ze);
          const dNet = (1 / 8) * es * (1 + xs * xi) * (1 + zs * ze);
          const dNze = (1 / 8) * zs * (1 + xs * xi) * (1 + es * et);
          for (let d = 0; d < 3; d++) {
            J[d][0] += dNxi * corners[i][d];
            J[d][1] += dNet * corners[i][d];
            J[d][2] += dNze * corners[i][d];
          }
        }
        const det = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1])
                  - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0])
                  + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
        V += Math.abs(det);   // weight = 1 for each Gauss point
      }
    }
    return V;
  }

  stats() {
    return {
      vertexCount: this.vertices.length,
      hexCount: this.hexes.length,
      totalVolume: this.totalVolume(),
      ...this.metadata,
    };
  }
}
