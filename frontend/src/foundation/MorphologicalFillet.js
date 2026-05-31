/**
 * ArchDisc Foundation — volumetric (morphological) rolling-ball fillet.
 *
 * A true *selective* edge fillet on arbitrary curved B-Rep — pick an
 * edge, blend it with a smooth analytic surface — is a Parasolid-class
 * problem and remains the genuine research frontier. This module does
 * NOT pretend to do that.
 *
 * What it does is the other industry-standard fillet definition: the
 * ROLLING-BALL fillet, computed volumetrically by mathematical
 * morphology. Voxelize the body, then:
 *
 *   - morphological OPENING with a ball of radius r (erode → dilate)
 *     rounds every CONVEX edge and corner to radius r;
 *   - morphological CLOSING (dilate → erode) rounds every CONCAVE
 *     (reentrant) edge to radius r.
 *
 * Opening followed by closing rounds both. This is exactly the
 * rolling-ball definition of a fillet, and — unlike the analytic
 * B-Rep version — it works on ANY closed mesh: imported STEP,
 * organic/curved, lattice, CT-scan-derived geometry. Volumetric
 * morphological filleting is a real, named technique used in
 * additive-manufacturing prep and reverse engineering.
 *
 * Honest limitation: the result is discrete at the voxel resolution —
 * its boundary is stair-stepped, exact only in the limit of fine
 * resolution. It is a genuine volumetric fillet, not a smooth analytic
 * blend surface.
 *
 * Reuses the ray-crossing point-in-mesh test from VoxelHexMesh.
 */

import { pointInMesh } from './VoxelHexMesh.js';
import { HexMesh } from './HexMesh.js';

/**
 * Voxelize a triangle mesh into a padded occupancy grid.
 * @param {{vertices:number[][], triangles:number[][]}} mesh
 * @param {number} resolution  cells along the longest axis
 * @param {number} pad         empty cell margin on every side
 */
function voxelize(mesh, resolution, pad) {
  const { vertices, triangles } = mesh;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const ext = [maxX - minX, maxY - minY, maxZ - minZ];
  const h = Math.max(...ext) / resolution;
  const nx = Math.ceil(ext[0] / h) + 2 * pad;
  const ny = Math.ceil(ext[1] / h) + 2 * pad;
  const nz = Math.ceil(ext[2] / h) + 2 * pad;
  const origin = [minX - pad * h, minY - pad * h, minZ - pad * h];

  const occ = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = [
          origin[0] + (i + 0.5) * h,
          origin[1] + (j + 0.5) * h,
          origin[2] + (k + 0.5) * h,
        ];
        if (pointInMesh(c, vertices, triangles)) {
          occ[i + j * nx + k * nx * ny] = 1;
        }
      }
    }
  }
  return { occ, nx, ny, nz, h, origin };
}

/**
 * Offsets of a discrete ball structuring element of the given radius
 * (in cells): every (di,dj,dk) with di²+dj²+dk² ≤ rCells².
 */
export function ballOffsets(rCells) {
  const offsets = [];
  const r2 = rCells * rCells;
  for (let dk = -rCells; dk <= rCells; dk++)
    for (let dj = -rCells; dj <= rCells; dj++)
      for (let di = -rCells; di <= rCells; di++)
        if (di * di + dj * dj + dk * dk <= r2) offsets.push([di, dj, dk]);
  return offsets;
}

/**
 * Morphological erosion or dilation of an occupancy grid by a ball.
 * Out-of-bounds cells are treated as empty.
 * @param {string} mode  'erode' | 'dilate'
 */
function morphOp(occ, nx, ny, nz, offsets, mode) {
  const out = new Uint8Array(occ.length);
  const erode = mode === 'erode';
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = i + j * nx + k * nx * ny;
        if (erode) {
          if (!occ[c]) continue;                 // empty stays empty
          let all = 1;
          for (const [di, dj, dk] of offsets) {
            const ni = i + di, nj = j + dj, nk = k + dk;
            if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz
                || !occ[ni + nj * nx + nk * nx * ny]) { all = 0; break; }
          }
          out[c] = all;
        } else {
          if (occ[c]) { out[c] = 1; continue; }   // occupied stays occupied
          for (const [di, dj, dk] of offsets) {
            const ni = i + di, nj = j + dj, nk = k + dk;
            if (ni >= 0 && ni < nx && nj >= 0 && nj < ny && nk >= 0 && nk < nz
                && occ[ni + nj * nx + nk * nx * ny]) { out[c] = 1; break; }
          }
        }
      }
    }
  }
  return out;
}

function countOccupied(occ) {
  let n = 0;
  for (let i = 0; i < occ.length; i++) n += occ[i];
  return n;
}

/** Build a structured HexMesh from an occupancy grid (one hex per cell). */
function occupancyToHexMesh(occ, nx, ny, nz, h, origin) {
  const hexMesh = new HexMesh();
  const vmap = new Map();
  const vIndex = (i, j, k) => {
    const key = `${i},${j},${k}`;
    let idx = vmap.get(key);
    if (idx === undefined) {
      idx = hexMesh.vertices.length;
      hexMesh.vertices.push([origin[0] + i * h, origin[1] + j * h, origin[2] + k * h]);
      vmap.set(key, idx);
    }
    return idx;
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!occ[i + j * nx + k * nx * ny]) continue;
        hexMesh.hexes.push([
          vIndex(i,     j,     k    ), vIndex(i + 1, j,     k    ),
          vIndex(i + 1, j + 1, k    ), vIndex(i,     j + 1, k    ),
          vIndex(i,     j,     k + 1), vIndex(i + 1, j,     k + 1),
          vIndex(i + 1, j + 1, k + 1), vIndex(i,     j + 1, k + 1),
        ]);
      }
  return hexMesh;
}

/**
 * Closed boundary triangle mesh of an occupancy grid: every cell face
 * adjacent to an empty cell becomes two triangles. Grid nodes are
 * shared, so the surface is watertight (each edge shared by 2 tris).
 */
function occupancyToSurface(occ, nx, ny, nz, h, origin) {
  const vmap = new Map();
  const vertices = [];
  const vIndex = (i, j, k) => {
    const key = `${i},${j},${k}`;
    let idx = vmap.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push([origin[0] + i * h, origin[1] + j * h, origin[2] + k * h]);
      vmap.set(key, idx);
    }
    return idx;
  };
  const at = (i, j, k) =>
    (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz)
      ? occ[i + j * nx + k * nx * ny] : 0;
  const triangles = [];
  const quad = (a, b, c, d) => { triangles.push([a, b, c], [a, c, d]); };

  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!at(i, j, k)) continue;
        // Each exposed face is wound CCW seen from outside the body
        // (outward normal = (b−a)×(c−a) for the first triangle).
        if (!at(i - 1, j, k))   // −X
          quad(vIndex(i, j, k), vIndex(i, j, k + 1), vIndex(i, j + 1, k + 1), vIndex(i, j + 1, k));
        if (!at(i + 1, j, k))   // +X
          quad(vIndex(i + 1, j, k), vIndex(i + 1, j + 1, k), vIndex(i + 1, j + 1, k + 1), vIndex(i + 1, j, k + 1));
        if (!at(i, j - 1, k))   // −Y
          quad(vIndex(i, j, k), vIndex(i + 1, j, k), vIndex(i + 1, j, k + 1), vIndex(i, j, k + 1));
        if (!at(i, j + 1, k))   // +Y
          quad(vIndex(i, j + 1, k), vIndex(i, j + 1, k + 1), vIndex(i + 1, j + 1, k + 1), vIndex(i + 1, j + 1, k));
        if (!at(i, j, k - 1))   // −Z
          quad(vIndex(i, j, k), vIndex(i, j + 1, k), vIndex(i + 1, j + 1, k), vIndex(i + 1, j, k));
        if (!at(i, j, k + 1))   // +Z
          quad(vIndex(i, j, k + 1), vIndex(i + 1, j, k + 1), vIndex(i + 1, j + 1, k + 1), vIndex(i, j + 1, k + 1));
      }
  return { vertices, triangles };
}

/**
 * Volumetric rolling-ball fillet of an arbitrary closed triangle mesh.
 *
 * @param {{vertices:number[][], triangles:number[][]}} mesh
 * @param {object} opts
 * @param {number} opts.radius        rolling-ball radius (mm)
 * @param {number=} opts.resolution   cells along the longest axis (default 32)
 * @param {string=} opts.mode         'round' (both, default) | 'convex' | 'concave'
 * @returns {{ hexMesh, surfaceMesh, cellSize, rCells, ballSize,
 *             volumeBefore, volumeAfter, volumeChangeFraction,
 *             cellCount, exposedFaces, dims }}
 */
export function morphologicalFillet(mesh, opts = {}) {
  const radius = opts.radius;
  if (!(radius > 0)) throw new Error('morphologicalFillet: radius must be > 0');
  const resolution = Math.max(4, opts.resolution ?? 32);
  const mode = opts.mode ?? 'round';

  // Probe cell size to size the padding, then voxelize for real.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const h = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / resolution;
  const rCells = Math.max(1, Math.round(radius / h));
  const pad = rCells + 2;

  const { occ, nx, ny, nz, origin } = voxelize(mesh, resolution, pad);
  const cellVol = h * h * h;
  const volumeBefore = countOccupied(occ) * cellVol;

  const offsets = ballOffsets(rCells);
  let result = occ;
  // Opening = erode → dilate (rounds convex). Closing = dilate → erode
  // (rounds concave). 'round' applies opening then closing.
  if (mode === 'round' || mode === 'convex') {
    result = morphOp(morphOp(result, nx, ny, nz, offsets, 'erode'),
                     nx, ny, nz, offsets, 'dilate');
  }
  if (mode === 'round' || mode === 'concave') {
    result = morphOp(morphOp(result, nx, ny, nz, offsets, 'dilate'),
                     nx, ny, nz, offsets, 'erode');
  }

  const volumeAfter = countOccupied(result) * cellVol;
  const hexMesh = occupancyToHexMesh(result, nx, ny, nz, h, origin);
  const surfaceMesh = occupancyToSurface(result, nx, ny, nz, h, origin);

  return {
    hexMesh,
    surfaceMesh,
    cellSize: h,
    rCells,
    ballSize: offsets.length,
    volumeBefore,
    volumeAfter,
    volumeChangeFraction: volumeBefore > 0 ? (volumeAfter - volumeBefore) / volumeBefore : 0,
    cellCount: hexMesh.hexes.length,
    exposedFaces: surfaceMesh.triangles.length / 2,
    dims: [nx, ny, nz],
  };
}

/**
 * Volumetric rolling-ball fillet of a manifold-3d Manifold.
 * @param {Manifold} manifold
 * @param {object} opts  see morphologicalFillet
 */
export function morphologicalFilletManifold(manifold, opts = {}) {
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
  return morphologicalFillet({ vertices, triangles }, opts);
}
