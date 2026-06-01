// Forge-161 — screened Poisson surface reconstruction.
//
// Implements Kazhdan-Hoppe screened Poisson reconstruction (Kazhdan
// 2006 + Kazhdan-Hoppe 2013 "Screened Poisson Surface
// Reconstruction") on a regular voxel grid:
//
//   1.  Estimate per-point oriented normals (if not supplied).
//   2.  Splat normals into a regular voxel grid → vector field V.
//   3.  Compute divergence of V on the grid: b = ∇·V.
//   4.  Solve Δχ = b on the grid via SOR Gauss-Seidel on the
//       standard 7-point Laplacian stencil with Dirichlet boundary.
//   5.  Add the screened term — each sample location bumps the
//       diagonal so χ is pulled toward the data.
//   6.  Shift χ so that the average χ at the sample positions is
//       the iso value, then extract the iso-surface via marching
//       cubes (the existing `extractIsoSurface` in
//       frontend/src/foundation/MarchingCubes.js — solid, tested).
//
// JS port — for huge clouds (>1M points) the native PoissonRecon
// binary remains recommended; the caveats list calls this out.

import { estimateNormals } from './pointCloudImport.js';
import { extractIsoSurface } from '../foundation/MarchingCubes.js';

export function reconstructPoisson(positions, opts = {}) {
  if (!(positions instanceof Float32Array)) {
    positions = Float32Array.from(positions);
  }
  const N = positions.length / 3;
  if (N < 8) throw new Error('poisson: need ≥ 8 points');

  const gridRes  = Math.min(96, Math.max(16, opts.gridRes ?? 48));
  const smoothIt = opts.smoothIter ?? 36;
  const screen   = opts.screen    ?? 0.5;
  const k        = Math.min(opts.k ?? 16, Math.max(8, Math.floor(N / 4)));
  const normals  = opts.normals || estimateNormals(positions, k);

  // 1) bounding box, inflated 5 %.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX)     minX = positions[i];
    if (positions[i] > maxX)     maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  const dx = (maxX - minX) * 0.05;
  const dy = (maxY - minY) * 0.05;
  const dz = (maxZ - minZ) * 0.05;
  minX -= dx; maxX += dx;
  minY -= dy; maxY += dy;
  minZ -= dz; maxZ += dz;
  const sx = (maxX - minX) / (gridRes - 1);
  const sy = (maxY - minY) / (gridRes - 1);
  const sz = (maxZ - minZ) / (gridRes - 1);

  // 2) splat normals into Vx, Vy, Vz grids using trilinear weights.
  const G = gridRes;
  const G2 = G * G;
  const sz3 = G * G * G;
  const Vx = new Float32Array(sz3);
  const Vy = new Float32Array(sz3);
  const Vz = new Float32Array(sz3);
  const W  = new Float32Array(sz3);

  function idx(i, j, k) { return i + j * G + k * G2; }

  for (let p = 0; p < N; p++) {
    const x = positions[p * 3], y = positions[p * 3 + 1], z = positions[p * 3 + 2];
    const fi = (x - minX) / sx, fj = (y - minY) / sy, fk = (z - minZ) / sz;
    const i0 = Math.floor(fi), j0 = Math.floor(fj), k0 = Math.floor(fk);
    const ti = fi - i0, tj = fj - j0, tk = fk - k0;
    for (let dk = 0; dk <= 1; dk++) {
      const kk = k0 + dk;
      if (kk < 0 || kk >= G) continue;
      const wk = dk ? tk : 1 - tk;
      for (let dj = 0; dj <= 1; dj++) {
        const jj = j0 + dj;
        if (jj < 0 || jj >= G) continue;
        const wj = dj ? tj : 1 - tj;
        for (let di = 0; di <= 1; di++) {
          const ii = i0 + di;
          if (ii < 0 || ii >= G) continue;
          const w = (di ? ti : 1 - ti) * wj * wk;
          const id = idx(ii, jj, kk);
          Vx[id] += w * normals[p * 3];
          Vy[id] += w * normals[p * 3 + 1];
          Vz[id] += w * normals[p * 3 + 2];
          W[id]  += w;
        }
      }
    }
  }

  // 3) divergence of V on the grid (central differences).
  const B = new Float32Array(sz3);
  for (let kk = 1; kk < G - 1; kk++) {
    for (let jj = 1; jj < G - 1; jj++) {
      for (let ii = 1; ii < G - 1; ii++) {
        const id = idx(ii, jj, kk);
        B[id] = (Vx[idx(ii + 1, jj, kk)] - Vx[idx(ii - 1, jj, kk)]) / (2 * sx)
              + (Vy[idx(ii, jj + 1, kk)] - Vy[idx(ii, jj - 1, kk)]) / (2 * sy)
              + (Vz[idx(ii, jj, kk + 1)] - Vz[idx(ii, jj, kk - 1)]) / (2 * sz);
      }
    }
  }

  // 4) Δχ = B  via SOR Gauss-Seidel on the 7-point stencil.  The
  //    screened term shifts the diagonal proportionally to sample
  //    weight W per voxel.
  const X = new Float32Array(sz3);
  const omega = 1.6;
  const hx2 = 1 / (sx * sx), hy2 = 1 / (sy * sy), hz2 = 1 / (sz * sz);
  const diag = 2 * (hx2 + hy2 + hz2);
  for (let it = 0; it < smoothIt; it++) {
    for (let kk = 1; kk < G - 1; kk++) {
      for (let jj = 1; jj < G - 1; jj++) {
        for (let ii = 1; ii < G - 1; ii++) {
          const id = idx(ii, jj, kk);
          const sum =
            hx2 * (X[idx(ii - 1, jj, kk)] + X[idx(ii + 1, jj, kk)]) +
            hy2 * (X[idx(ii, jj - 1, kk)] + X[idx(ii, jj + 1, kk)]) +
            hz2 * (X[idx(ii, jj, kk - 1)] + X[idx(ii, jj, kk + 1)]);
          const wScr = screen * W[id];
          const newX = (sum - B[id] + wScr * X[id]) / (diag + wScr);
          X[id] = X[id] + omega * (newX - X[id]);
        }
      }
    }
  }

  // 5) iso = average χ at the sample positions (Kazhdan §4.4).
  let isoAcc = 0, isoCnt = 0;
  for (let p = 0; p < N; p++) {
    const fi = (positions[p * 3]     - minX) / sx;
    const fj = (positions[p * 3 + 1] - minY) / sy;
    const fk = (positions[p * 3 + 2] - minZ) / sz;
    const ii = Math.min(G - 1, Math.max(0, Math.round(fi)));
    const jj = Math.min(G - 1, Math.max(0, Math.round(fj)));
    const kk = Math.min(G - 1, Math.max(0, Math.round(fk)));
    isoAcc += X[idx(ii, jj, kk)];
    isoCnt++;
  }
  const iso = isoAcc / Math.max(1, isoCnt);

  // 6) Marching cubes via the foundation module.  extractIsoSurface
  //    indexes z * (nx*ny) + j * nx + i — same layout as our `idx`.
  const surf = extractIsoSurface({
    values: X,
    nx: G, ny: G, nz: G,
    origin:   [minX, minY, minZ],
    cellSize: [sx, sy, sz],
    threshold: iso,
  });
  return {
    positions: surf.vertProperties,
    indices:   surf.triVerts,
    vertices:  surf.vertProperties.length / 3,
    triangles: surf.triVerts.length / 3,
    iso, gridRes,
  };
}
