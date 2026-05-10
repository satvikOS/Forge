/**
 * ArchDisc Foundation — Point cloud → solid reconstruction
 * (reverse engineering of physical scans).
 *
 * Given an unstructured 3D point cloud (e.g. from a structured-light
 * scan or photogrammetry), produce a watertight triangle mesh that
 * approximates the underlying surface.
 *
 * Two pipelines are implemented:
 *
 *   (a) Density-voxel reconstruction (fast, robust, this module's MVP):
 *       - bin points into a voxel grid
 *       - smooth via 3×3×3 box averaging (multi-pass)
 *       - marching cubes at threshold
 *       Works well for closed shapes with reasonable point density.
 *
 *   (b) Hoppe-style SDF (more accurate, more code):
 *       - estimate per-point normal via PCA on k-nearest neighbors
 *       - orient normals consistently via MST graph propagation
 *       - build signed distance field from oriented points
 *       - marching cubes at 0
 *       NOT implemented in this MVP — would add ~400 LOC.
 *
 * Plus utilities to sample points uniformly on a Manifold's surface
 * (area-weighted triangle sampling), so we can simulate scanned input
 * from a known shape and validate.
 */

import { extractIsoSurface, smoothGridField } from './MarchingCubes.js';

/**
 * Sample N points uniformly on the surface of a manifold-3d Manifold
 * (or any { vertProperties, triVerts, numProp } mesh).
 * Each sample point is placed inside a triangle picked by area weight.
 */
export function sampleSurface(manifold, N, opts = {}) {
  const noiseStdMm = opts.noiseStdMm ?? 0;
  const seed = opts.seed ?? 1;
  let state = seed | 0; if (state === 0) state = 1;
  const rng = () => {
    state ^= state << 13; state |= 0;
    state ^= state >>> 17;
    state ^= state << 5; state |= 0;
    return ((state >>> 0) % 0xffffffff) / 0xffffffff;
  };
  const gauss = () => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const mesh = manifold.getMesh ? manifold.getMesh() : manifold;
  const numProp = mesh.numProp;
  const verts = mesh.vertProperties;
  const tris = mesh.triVerts;
  const numTri = tris.length / 3;

  // Triangle areas + cumulative
  const cum = new Float64Array(numTri);
  let total = 0;
  for (let t = 0; t < numTri; t++) {
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const p0x = verts[i0 * numProp], p0y = verts[i0 * numProp + 1], p0z = verts[i0 * numProp + 2];
    const p1x = verts[i1 * numProp], p1y = verts[i1 * numProp + 1], p1z = verts[i1 * numProp + 2];
    const p2x = verts[i2 * numProp], p2y = verts[i2 * numProp + 1], p2z = verts[i2 * numProp + 2];
    const ux = p1x - p0x, uy = p1y - p0y, uz = p1z - p0z;
    const vx = p2x - p0x, vy = p2y - p0y, vz = p2z - p0z;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += 0.5 * Math.hypot(cx, cy, cz);
    cum[t] = total;
  }

  // Binary-search helper
  const pickTri = () => {
    const r = rng() * total;
    let lo = 0, hi = numTri - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cum[mid] < r) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const points = new Float32Array(N * 3);
  for (let s = 0; s < N; s++) {
    const t = pickTri();
    let r1 = rng(), r2 = rng();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const r3 = 1 - r1 - r2;
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const p0x = verts[i0 * numProp], p0y = verts[i0 * numProp + 1], p0z = verts[i0 * numProp + 2];
    const p1x = verts[i1 * numProp], p1y = verts[i1 * numProp + 1], p1z = verts[i1 * numProp + 2];
    const p2x = verts[i2 * numProp], p2y = verts[i2 * numProp + 1], p2z = verts[i2 * numProp + 2];
    let px = r3 * p0x + r1 * p1x + r2 * p2x;
    let py = r3 * p0y + r1 * p1y + r2 * p2y;
    let pz = r3 * p0z + r1 * p1z + r2 * p2z;
    if (noiseStdMm > 0) {
      px += gauss() * noiseStdMm;
      py += gauss() * noiseStdMm;
      pz += gauss() * noiseStdMm;
    }
    points[s * 3] = px;
    points[s * 3 + 1] = py;
    points[s * 3 + 2] = pz;
  }
  return points;
}

/**
 * Sample N points uniformly on a sphere of radius R centered at `c`.
 * Optional Gaussian noise.
 */
export function sampleSphere(R, N, opts = {}) {
  const c = opts.center ?? [0, 0, 0];
  const noiseStdMm = opts.noiseStdMm ?? 0;
  const seed = opts.seed ?? 1;
  let state = seed | 0; if (state === 0) state = 1;
  const rng = () => {
    state ^= state << 13; state |= 0;
    state ^= state >>> 17;
    state ^= state << 5; state |= 0;
    return ((state >>> 0) % 0xffffffff) / 0xffffffff;
  };
  const gauss = () => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const points = new Float32Array(N * 3);
  for (let s = 0; s < N; s++) {
    // Uniform on sphere via Marsaglia: pick (u, v) in unit disk, then
    //   x = 2u sqrt(1−u²−v²), y = 2v sqrt(...), z = 1 − 2(u²+v²)
    let u, v, w;
    do { u = 2 * rng() - 1; v = 2 * rng() - 1; w = u * u + v * v; } while (w >= 1);
    const sw = Math.sqrt(1 - w);
    const x = 2 * u * sw, y = 2 * v * sw, z = 1 - 2 * w;
    let px = c[0] + R * x, py = c[1] + R * y, pz = c[2] + R * z;
    if (noiseStdMm > 0) {
      px += gauss() * noiseStdMm;
      py += gauss() * noiseStdMm;
      pz += gauss() * noiseStdMm;
    }
    points[s * 3] = px; points[s * 3 + 1] = py; points[s * 3 + 2] = pz;
  }
  return points;
}

/**
 * Reconstruct a triangulated surface from a point cloud via density
 * voxelization + smoothing + marching cubes.
 *
 * @param {Float32Array} points - flat [x0,y0,z0, x1,y1,z1, …]
 * @param {object} options
 * @param {number} options.voxelSizeMm - target cell size (default = 1/30 of bbox max-extent)
 * @param {number} options.smoothingPasses - 3×3×3 box smoothings (default 3)
 * @param {number} options.threshold - marching-cubes iso level on the
 *                                     normalized density field [0..1]
 *                                     (default 0.5; lower = more enclosing)
 * @param {number} options.padMm - bbox pad on each side
 * @returns {{ vertProperties, triVerts, numProp, gridStats }}
 */
export function reconstruct(points, options = {}) {
  const N = points.length / 3;
  if (N === 0) throw new Error('Empty point cloud');
  // bbox
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const extent = Math.max(xmax - xmin, ymax - ymin, zmax - zmin);
  const pad = options.padMm ?? extent / 20;
  xmin -= pad; xmax += pad;
  ymin -= pad; ymax += pad;
  zmin -= pad; zmax += pad;
  const voxelSize = options.voxelSizeMm ?? extent / 40;
  const passes = options.smoothingPasses ?? 3;
  const threshold = options.threshold ?? 0.5;

  const nx = Math.max(2, Math.ceil((xmax - xmin) / voxelSize) + 1);
  const ny = Math.max(2, Math.ceil((ymax - ymin) / voxelSize) + 1);
  const nz = Math.max(2, Math.ceil((zmax - zmin) / voxelSize) + 1);
  const dx = (xmax - xmin) / (nx - 1);
  const dy = (ymax - ymin) / (ny - 1);
  const dz = (zmax - zmin) / (nz - 1);
  // Build density field — each point contributes to its 8 surrounding
  // grid corners with linear weights (trilinear stamping).
  const density = new Float32Array(nx * ny * nz);
  const gIdx = (i, j, k) => k * (nx * ny) + j * nx + i;
  for (let s = 0; s < N; s++) {
    const x = points[s * 3], y = points[s * 3 + 1], z = points[s * 3 + 2];
    const fx = (x - xmin) / dx, fy = (y - ymin) / dy, fz = (z - zmin) / dz;
    const i0 = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
    const k0 = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i0));
    const ty = Math.max(0, Math.min(1, fy - j0));
    const tz = Math.max(0, Math.min(1, fz - k0));
    const c000 = (1 - tx) * (1 - ty) * (1 - tz);
    const c100 = tx       * (1 - ty) * (1 - tz);
    const c010 = (1 - tx) * ty       * (1 - tz);
    const c110 = tx       * ty       * (1 - tz);
    const c001 = (1 - tx) * (1 - ty) * tz;
    const c101 = tx       * (1 - ty) * tz;
    const c011 = (1 - tx) * ty       * tz;
    const c111 = tx       * ty       * tz;
    density[gIdx(i0,     j0,     k0    )] += c000;
    density[gIdx(i0 + 1, j0,     k0    )] += c100;
    density[gIdx(i0,     j0 + 1, k0    )] += c010;
    density[gIdx(i0 + 1, j0 + 1, k0    )] += c110;
    density[gIdx(i0,     j0,     k0 + 1)] += c001;
    density[gIdx(i0 + 1, j0,     k0 + 1)] += c101;
    density[gIdx(i0,     j0 + 1, k0 + 1)] += c011;
    density[gIdx(i0 + 1, j0 + 1, k0 + 1)] += c111;
  }

  // Smooth heavily + normalize
  const smoothed = smoothGridField(density, nx, ny, nz, passes);
  let dmax = 0;
  for (const v of smoothed) if (v > dmax) dmax = v;
  if (dmax > 0) for (let i = 0; i < smoothed.length; i++) smoothed[i] /= dmax;

  // Flood-fill from outside: mark voxels reachable from EVERY bbox corner
  // (gives all 8 starting points so disjoint outer regions get marked).
  // Surface voxels (density > occupiedTol) block flood propagation.
  // Then `inside` = NOT outside.
  const occupiedTol = options.occupiedTol ?? 0.05;
  const outside = new Uint8Array(nx * ny * nz);
  const queue = [];
  const seedCorners = [
    [0, 0, 0], [nx - 1, 0, 0], [0, ny - 1, 0], [nx - 1, ny - 1, 0],
    [0, 0, nz - 1], [nx - 1, 0, nz - 1], [0, ny - 1, nz - 1], [nx - 1, ny - 1, nz - 1],
  ];
  for (const [i, j, k] of seedCorners) {
    const idx = gIdx(i, j, k);
    if (smoothed[idx] <= occupiedTol) {
      outside[idx] = 1;
      queue.push(idx);
    }
  }
  while (queue.length) {
    const k = queue.shift();
    const kk = Math.floor(k / (nx * ny));
    const j = Math.floor((k - kk * nx * ny) / nx);
    const i = k - kk * nx * ny - j * nx;
    const neighbours = [
      [i - 1, j, kk], [i + 1, j, kk],
      [i, j - 1, kk], [i, j + 1, kk],
      [i, j, kk - 1], [i, j, kk + 1],
    ];
    for (const [ni, nj, nk] of neighbours) {
      if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
      const nIdx = gIdx(ni, nj, nk);
      if (outside[nIdx]) continue;
      if (smoothed[nIdx] > occupiedTol) continue;
      outside[nIdx] = 1;
      queue.push(nIdx);
    }
  }
  const insideMask = new Float32Array(nx * ny * nz);
  for (let k = 0; k < insideMask.length; k++) insideMask[k] = outside[k] ? 0 : 1;
  const insideSmooth = smoothGridField(insideMask, nx, ny, nz, 1);

  const iso = extractIsoSurface({
    values: insideSmooth,
    nx, ny, nz,
    origin: [xmin, ymin, zmin],
    cellSize: [dx, dy, dz],
    threshold,
  });

  // Diagnostics: triangle count + bounding box of result
  return {
    ...iso,
    gridStats: {
      nx, ny, nz, dx, dy, dz,
      bbox: { min: [xmin, ymin, zmin], max: [xmax, ymax, zmax] },
      pointCount: N,
      triangleCount: iso.triVerts.length / 3,
      vertexCount: iso.vertProperties.length / 3,
    },
  };
}

/**
 * Compute the volume of an iso-surface mesh via signed-tetrahedron
 * sum (Gauss divergence). Works for closed surfaces.
 */
export function meshVolume(meshLike) {
  const tris = meshLike.triVerts;
  const verts = meshLike.vertProperties;
  const numProp = meshLike.numProp ?? 3;
  let V = 0;
  for (let t = 0; t < tris.length / 3; t++) {
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const p0x = verts[i0 * numProp], p0y = verts[i0 * numProp + 1], p0z = verts[i0 * numProp + 2];
    const p1x = verts[i1 * numProp], p1y = verts[i1 * numProp + 1], p1z = verts[i1 * numProp + 2];
    const p2x = verts[i2 * numProp], p2y = verts[i2 * numProp + 1], p2z = verts[i2 * numProp + 2];
    V += (p0x * (p1y * p2z - p1z * p2y)
        - p0y * (p1x * p2z - p1z * p2x)
        + p0z * (p1x * p2y - p1y * p2x)) / 6;
  }
  return Math.abs(V);
}
