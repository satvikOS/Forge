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

/**
 * Build a uniform grid index over an array of triangles. Each cell
 * contains the indices of triangles whose 3D bbox overlaps that cell.
 */
function buildTriGrid(triData, numTri, min, max, nx, ny, nz) {
  const cellsX = Math.max(1, Math.min(nx * 2, 64));
  const cellsY = Math.max(1, Math.min(ny * 2, 64));
  const cellsZ = Math.max(1, Math.min(nz * 2, 64));
  const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
  const dx = sx / cellsX, dy = sy / cellsY, dz = sz / cellsZ;
  const cells = Array.from({ length: cellsX * cellsY * cellsZ }, () => []);
  const cellIdx = (cx, cy, cz) => cz * cellsX * cellsY + cy * cellsX + cx;
  for (let t = 0; t < numTri; t++) {
    const off = t * 9;
    const x0 = triData[off],     y0 = triData[off + 1], z0 = triData[off + 2];
    const x1 = triData[off + 3], y1 = triData[off + 4], z1 = triData[off + 5];
    const x2 = triData[off + 6], y2 = triData[off + 7], z2 = triData[off + 8];
    const minX = Math.min(x0, x1, x2);
    const maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const minZ = Math.min(z0, z1, z2);
    const maxZ = Math.max(z0, z1, z2);
    const cxL = Math.max(0, Math.min(cellsX - 1, Math.floor((minX - min[0]) / dx)));
    const cxH = Math.max(0, Math.min(cellsX - 1, Math.floor((maxX - min[0]) / dx)));
    const cyL = Math.max(0, Math.min(cellsY - 1, Math.floor((minY - min[1]) / dy)));
    const cyH = Math.max(0, Math.min(cellsY - 1, Math.floor((maxY - min[1]) / dy)));
    const czL = Math.max(0, Math.min(cellsZ - 1, Math.floor((minZ - min[2]) / dz)));
    const czH = Math.max(0, Math.min(cellsZ - 1, Math.floor((maxZ - min[2]) / dz)));
    for (let cz = czL; cz <= czH; cz++)
      for (let cy = cyL; cy <= cyH; cy++)
        for (let cx = cxL; cx <= cxH; cx++) cells[cellIdx(cx, cy, cz)].push(t);
  }
  return { cells, cellsX, cellsY, cellsZ, dx, dy, dz, ox: min[0], oy: min[1], oz: min[2] };
}

/**
 * Möller–Trumbore ray–triangle intersection. Returns t (parametric
 * distance along ray) > 0 if the ray hits the triangle in front of the
 * origin, else null.
 */
function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az;
  const ex2 = cx - ax, ey2 = cy - ay, ez2 = cz - az;
  const px = dy * ez2 - dz * ey2;
  const py = dz * ex2 - dx * ez2;
  const pz = dx * ey2 - dy * ex2;
  const det = ex1 * px + ey1 * py + ez1 * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * ez1 - tz * ey1;
  const qy = tz * ex1 - tx * ez1;
  const qz = tx * ey1 - ty * ex1;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (ex2 * qx + ey2 * qy + ez2 * qz) * inv;
  return t > 1e-9 ? t : null;
}

/**
 * Point-in-mesh test via ray-cast: shoot a +x ray and count surface
 * crossings. Odd → inside, even → outside.
 *
 * Uses the spatial grid only for the triangles whose Y/Z bbox includes
 * the ray's Y/Z (we still scan all X cells along the ray, but cell
 * indexing in Y/Z gives big speedups).
 */
function pointInMeshRaycast(px, py, pz, triGrid, triData, _maxX) {
  const cy = Math.max(0, Math.min(triGrid.cellsY - 1, Math.floor((py - triGrid.oy) / triGrid.dy)));
  const cz = Math.max(0, Math.min(triGrid.cellsZ - 1, Math.floor((pz - triGrid.oz) / triGrid.dz)));
  // Ray direction = (1, 0, 0). Scan all x-cells along this row.
  const seen = new Set();
  let intersections = 0;
  for (let cx = 0; cx < triGrid.cellsX; cx++) {
    const cell = triGrid.cells[cz * triGrid.cellsX * triGrid.cellsY + cy * triGrid.cellsX + cx];
    for (const t of cell) {
      if (seen.has(t)) continue;
      seen.add(t);
      const off = t * 9;
      const dist = rayTri(
        px, py, pz, 1, 0, 0,
        triData[off],     triData[off + 1], triData[off + 2],
        triData[off + 3], triData[off + 4], triData[off + 5],
        triData[off + 6], triData[off + 7], triData[off + 8],
      );
      if (dist != null) intersections++;
    }
  }
  return (intersections & 1) === 1;
}

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
   * Voxel-fill an arbitrary manifold-3d solid.
   *
   * Approach:
   *   1. Compute the manifold's bounding box.
   *   2. Build a regular grid of nx × ny × nz cells covering the bbox.
   *   3. For each cell centroid, ray-cast against the surface mesh and
   *      count triangle intersections (odd = inside).
   *   4. For each cell whose centroid is inside, emit 6 Kuhn tets — but
   *      first dedupe vertices so adjacent voxels share grid corners.
   *
   * Caveats:
   *   - Boundary is staircased (no surface conformity). Acceptable for
   *     coarse FEM; future iterations should refine the boundary cells.
   *   - Cells whose centroid is outside but which still overlap the
   *     surface are dropped (small geometric loss).
   *
   * @param {Manifold} manifold
   * @param {object} options
   * @param {number} options.cellSize - target voxel edge in mm; ignored
   *                                     if nx/ny/nz are provided
   * @param {number} options.nx, options.ny, options.nz - explicit grid
   * @returns {TetMesh}
   */
  static async fromManifold(manifold, options = {}) {
    const bbox = manifold.boundingBox();
    const min = bbox.min, max = bbox.max;
    const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
    const cellSize = options.cellSize ?? Math.max(sx, sy, sz) / 20;
    const nx = options.nx ?? Math.max(1, Math.round(sx / cellSize));
    const ny = options.ny ?? Math.max(1, Math.round(sy / cellSize));
    const nz = options.nz ?? Math.max(1, Math.round(sz / cellSize));
    const dx = sx / nx, dy = sy / ny, dz = sz / nz;

    const surf = manifold.getMesh();
    const numTri = surf.triVerts.length / 3;
    const surfVerts = surf.vertProperties;
    const surfNumProp = surf.numProp;

    // Pre-extract triangle vertex coordinates for fast raycasting.
    // Each tri = 9 contiguous floats (3 verts × 3 coords).
    const triData = new Float32Array(numTri * 9);
    for (let t = 0; t < numTri; t++) {
      for (let v = 0; v < 3; v++) {
        const idx = surf.triVerts[t * 3 + v] * surfNumProp;
        triData[t * 9 + v * 3]     = surfVerts[idx];
        triData[t * 9 + v * 3 + 1] = surfVerts[idx + 1];
        triData[t * 9 + v * 3 + 2] = surfVerts[idx + 2];
      }
    }

    // Spatial grid index for triangles, bucketed by their bbox cells.
    // Same approach as in Drawing2D occlusion.
    const triGrid = buildTriGrid(triData, numTri, min, max, nx, ny, nz);

    // Determine inside/outside for every cell centroid.
    const isInside = new Uint8Array(nx * ny * nz);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const px = min[0] + (i + 0.5) * dx;
          const py = min[1] + (j + 0.5) * dy;
          const pz = min[2] + (k + 0.5) * dz;
          // Ray cast in +x direction; tally odd intersections in (px..max[0]).
          if (pointInMeshRaycast(px, py, pz, triGrid, triData, max[0])) {
            isInside[k * nx * ny + j * nx + i] = 1;
          }
        }
      }
    }

    // Build vertex index for shared corners. Only emit vertices used by
    // at least one inside cell (corners + adjacent corners).
    const vertIdx = new Map();   // "i,j,k" → vertexIndex
    const mesh = new TetMesh();
    const vIdxOf = (i, j, k) => {
      const key = `${i},${j},${k}`;
      let v = vertIdx.get(key);
      if (v === undefined) {
        v = mesh.vertices.length;
        mesh.vertices.push([min[0] + i * dx, min[1] + j * dy, min[2] + k * dz]);
        vertIdx.set(key, v);
      }
      return v;
    };
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (!isInside[k * nx * ny + j * nx + i]) continue;
          const v = [
            vIdxOf(i, j, k),     vIdxOf(i + 1, j, k),
            vIdxOf(i, j + 1, k), vIdxOf(i + 1, j + 1, k),
            vIdxOf(i, j, k + 1), vIdxOf(i + 1, j, k + 1),
            vIdxOf(i, j + 1, k + 1), vIdxOf(i + 1, j + 1, k + 1),
          ];
          for (const t of KUHN_TETS) mesh.tets.push([v[t[0]], v[t[1]], v[t[2]], v[t[3]]]);
        }
      }
    }

    mesh.metadata = {
      bbox: { min: [...min], max: [...max] },
      gridShape: [nx, ny, nz],
      cellSize: [dx, dy, dz],
      sourceTriangles: numTri,
      insideCells: Array.from(isInside).reduce((s, x) => s + x, 0),
      totalCells: nx * ny * nz,
      voxelizationMethod: 'grid + ray-cast (centroid test, +x ray)',
    };
    return mesh;
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
