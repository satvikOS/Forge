/**
 * ArchDisc Foundation — voxel (Cartesian) hex meshing of arbitrary
 * geometry.
 *
 * HexMesh.regularGrid only meshes an axis-aligned box. Voxel hex
 * meshing handles ANY closed triangle mesh: overlay a Cartesian
 * grid on the body's bounding box, keep every cell whose centre
 * lies inside the body, and emit each kept cell as a trilinear
 * hexahedron with shared vertices.
 *
 * This is a real, named technique — not a shortcut. Industry FEA
 * preprocessors use voxel/Cartesian hex meshes routinely: it is
 * the standard mesh for micro-CT-based FEA and for density-method
 * topology optimisation (the SIMP grid IS a voxel hex mesh).
 * Honest limitation: the boundary is stair-stepped at the grid
 * resolution — exact for axis-aligned features, approximate for
 * oblique/curved ones. Refining the resolution converges to the
 * true geometry.
 *
 * Point-in-mesh test: ray crossing. Cast a ray from the cell
 * centre, count triangle intersections (Möller–Trumbore); an odd
 * count means inside. O(cells × triangles) — fine for the
 * resolutions FEA actually uses. The ray direction is deliberately
 * generic (near +X but with tiny y/z components) so it never lands
 * exactly on a shared triangle edge — an axis-aligned ray on an
 * axis-aligned grid hits every face diagonal and double-counts.
 *
 * Output plugs straight into the existing LinearHexFEM solver.
 */

import { HexMesh } from './HexMesh.js';

// Generic ray direction — near +X, but the tiny y/z tilt keeps the
// ray off every axis-aligned triangle edge so shared edges are never
// double-counted. Not normalised: scale is irrelevant to the parity.
const RAY_DIR = [1, 0.00137, 0.00091];

/**
 * Ray-crossing point-in-mesh test (Möller–Trumbore, generic ray).
 * @returns {boolean} true if p is inside the closed mesh.
 */
export function pointInMesh(p, vertices, triangles) {
  let crossings = 0;
  const EPS = 1e-9;
  const [dx, dy, dz] = RAY_DIR;
  for (const [ia, ib, ic] of triangles) {
    const A = vertices[ia], B = vertices[ib], C = vertices[ic];
    // edge1 = B−A, edge2 = C−A
    const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2];
    const e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
    // h = dir × edge2
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (a > -EPS && a < EPS) continue;            // ray ∥ triangle
    const f = 1 / a;
    const sx = p[0] - A[0], sy = p[1] - A[1], sz = p[2] - A[2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    // q = s × edge1
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    // v = f · (dir · q)
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t > EPS) crossings++;                     // intersection ahead of p
  }
  return (crossings & 1) === 1;
}

/**
 * Voxel hex-mesh a triangle mesh.
 *
 * @param {{vertices:number[][], triangles:number[][]}} mesh
 * @param {object=} opts
 * @param {number=} opts.resolution  cells along the longest axis (default 16)
 * @returns {{ hexMesh: HexMesh, cellCount, candidateCells, fillFraction, cellSize }}
 */
export function voxelHexMesh(mesh, opts = {}) {
  const resolution = Math.max(2, opts.resolution ?? 16);
  const { vertices, triangles } = mesh;

  // Bounding box.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const ext = [maxX - minX, maxY - minY, maxZ - minZ];
  const longest = Math.max(...ext);
  const h = longest / resolution;                  // cubic cell size
  const nx = Math.max(1, Math.ceil(ext[0] / h));
  const ny = Math.max(1, Math.ceil(ext[1] / h));
  const nz = Math.max(1, Math.ceil(ext[2] / h));

  // Per-cell inside test on the cell centre.
  const hexMesh = new HexMesh();
  const vmap = new Map();                          // "i,j,k" → vertex index
  const vIndex = (i, j, k) => {
    const key = `${i},${j},${k}`;
    let idx = vmap.get(key);
    if (idx === undefined) {
      idx = hexMesh.vertices.length;
      hexMesh.vertices.push([minX + i * h, minY + j * h, minZ + k * h]);
      vmap.set(key, idx);
    }
    return idx;
  };

  let kept = 0;
  const candidates = nx * ny * nz;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = [
          minX + (i + 0.5) * h,
          minY + (j + 0.5) * h,
          minZ + (k + 0.5) * h,
        ];
        if (!pointInMesh(c, vertices, triangles)) continue;
        // 8 corners in HEX_NATURAL_SIGNS order.
        hexMesh.hexes.push([
          vIndex(i,     j,     k    ),
          vIndex(i + 1, j,     k    ),
          vIndex(i + 1, j + 1, k    ),
          vIndex(i,     j + 1, k    ),
          vIndex(i,     j,     k + 1),
          vIndex(i + 1, j,     k + 1),
          vIndex(i + 1, j + 1, k + 1),
          vIndex(i,     j + 1, k + 1),
        ]);
        kept++;
      }
    }
  }

  hexMesh.metadata.voxel = { resolution, grid: [nx, ny, nz], cellSize: h };
  return {
    hexMesh,
    cellCount: kept,
    candidateCells: candidates,
    fillFraction: candidates ? kept / candidates : 0,
    cellSize: h,
  };
}

/**
 * Voxel hex-mesh a manifold-3d Manifold.
 * @param {Manifold} manifold
 * @param {object=} opts
 */
export function voxelHexMeshManifold(manifold, opts = {}) {
  const m = manifold.getMesh();
  const np = m.numProp;
  const vertices = [];
  for (let i = 0; i < m.vertProperties.length; i += np) {
    vertices.push([m.vertProperties[i], m.vertProperties[i + 1], m.vertProperties[i + 2]]);
  }
  const triangles = [];
  for (let i = 0; i < m.triVerts.length; i += 3) {
    triangles.push([m.triVerts[i], m.triVerts[i + 1], m.triVerts[i + 2]]);
  }
  return voxelHexMesh({ vertices, triangles }, opts);
}
