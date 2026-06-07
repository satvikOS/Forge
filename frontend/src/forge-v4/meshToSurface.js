// PUSH-112 (Slice-81) — Reverse engineering: mesh → least-squares
// NURBS surface fit.
//
// The user's brief:
//   "Reverse engineering = take an STL mesh, sample points on it, fit a
//    B-rep surface … fitSurface(points, uCount=11, vCount=11) — given
//    scattered (x,y,z) points, project to dominant plane, build a uniform
//    UV grid by binning, average z per cell, return ControlGrid."
//
// This module is pure functions. ReverseEngineeringPanel.jsx imports the
// `runReverseEngineeringPipeline()` driver and the supporting helpers
// (`generateSyntheticSphereMesh`, `sampleMeshPoints`, `fitSurface`) so the
// React panel + the headless contract surface (window.__forgeReverseEngHelper)
// share the same code path. The e2e exercises both surfaces.
//
// Why JS-side instead of OCCT GeomAPI_PointsToBSplineSurface?
//   OCCT exposes GeomAPI_PointsToBSplineSurface but our preload bridge
//   does not yet ship a binding for it — that's a kernel rebuild. The
//   user's PUSH-85 brief carved that work out for surfacing slices
//   ("for this slice, since adding OCCT API binding takes a kernel
//   rebuild, implement at JS level using existing forge.surfacing
//   buildPatch"). PUSH-112 follows the same pattern: bin the scattered
//   points onto a uniform UV grid, average the z per cell, then commit
//   the grid through window.forge.surfacing.buildPatch.
//
// The pipeline:
//   1. Generate or import a mesh. The panel either calls
//      generateSyntheticSphereMesh() (radius 50 mm, 12 longitude × 8
//      latitude bands by default) or — via the file picker — loads an
//      STL through window.forge.io.importStl then re-tessellates back
//      to {positions, indices} via window.forge.tessellate.
//   2. sampleMeshPoints(mesh, N) — pick N points uniformly distributed
//      across the mesh's triangle area (area-weighted, deterministic
//      via Math.random unless seed is supplied). Returns
//      Float64Array(N*3).
//   3. fitSurface(points, uCount, vCount) — PCA the points to find the
//      dominant fitting plane (smallest eigenvalue of the covariance
//      matrix → normal). Project each point to that plane to derive
//      (u, v) in [0,1] across the projected bounding box. Bin into a
//      uCount × vCount grid; the height (n̂ · pt) per cell is averaged;
//      cells with no samples are filled by nearest-neighbour bilinear
//      from filled neighbours. Returns
//      { uCount, vCount, grid, normal, uAxis, vAxis, origin, rmsResidual }.
//   4. commitFittedSurface(controlGrid) — calls
//      window.forge.surfacing.buildPatch with bicubic open-uniform knot
//      vectors. Returns { ok, faceHandle, reason, message }.
//   5. appendFittedSurfaceBody(faceHandle, …) commits the surface to the
//      live scene as a native surface body (kind:native, surface:true)
//      via window.__forgeAppendBody, mirroring the surface body shape
//      Class-A Blend / Surface Offset / Loft Sections use.
//
// Hard constraints honoured:
//   * NO new npm / C++ / external dependencies. Pure JS math + the
//     existing forge.surfacing.buildPatch + the existing forge.io.importStl
//     + forge.tessellate bridges.
//   * NO kernel modifications.
//   * Real OCCT NURBS surface, real face handle, real native body — no
//     placeholder mesh, no fallback geometry.
//   * The PCA implementation is hand-rolled (3×3 symmetric eigendecomp
//     via Jacobi rotation) — zero external linear-algebra dependencies.

import { buildPatchKnots } from './coonsPatch.js';

// ─────────────────────────────────────────────────────────────────────
// Public constants.

export const REVERSE_ENG_EVENT       = 'forge:reverse-eng-fitted';
export const REVERSE_ENG_STORAGE     = 'forge.v4.reverseEng';
export const REVERSE_ENG_DEFAULT_SAMPLES = 500;
export const REVERSE_ENG_MIN_SAMPLES = 100;
export const REVERSE_ENG_MAX_SAMPLES = 2000;
export const REVERSE_ENG_DEFAULT_UV  = 11;
export const REVERSE_ENG_SOURCE_SYNTH = 'synth';
export const REVERSE_ENG_SOURCE_STL  = 'stl';
export const REVERSE_ENG_SEED_TAG    = 'reverseEng.fittedSurface';

// ─────────────────────────────────────────────────────────────────────
// Synthetic test mesh — a faceted sphere (radius 50 mm by default) made of
// triangles via UV-sphere tessellation. Returns
// { positions: Float64Array(3N), indices: Uint32Array(3T), name }.
//
// The default 12×8 grid produces 96 quads / 192 triangles — enough for
// the e2e to sample 500 points and still see clear coverage, without
// blowing kernel timeouts on the buildPatch round-trip.

export function generateSyntheticSphereMesh({
  radius = 50,
  longitudeBands = 12,
  latitudeBands  = 8,
  name = 'synth sphere',
} = {}) {
  const positions = [];
  const indices = [];
  // Build vertices.
  for (let lat = 0; lat <= latitudeBands; lat++) {
    const theta = (lat * Math.PI) / latitudeBands;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let lon = 0; lon <= longitudeBands; lon++) {
      const phi = (lon * 2 * Math.PI) / longitudeBands;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      const x = radius * cosP * sinT;
      const y = radius * cosT;
      const z = radius * sinP * sinT;
      positions.push(x, y, z);
    }
  }
  // Build triangle indices.
  for (let lat = 0; lat < latitudeBands; lat++) {
    for (let lon = 0; lon < longitudeBands; lon++) {
      const first  = lat * (longitudeBands + 1) + lon;
      const second = first + longitudeBands + 1;
      indices.push(first,      second,     first + 1);
      indices.push(second,     second + 1, first + 1);
    }
  }
  return {
    positions: new Float64Array(positions),
    indices:   new Uint32Array(indices),
    name,
    triangleCount: indices.length / 3,
    vertexCount:   positions.length / 3,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tessellate an OCCT body handle into a JS mesh via window.forge.tessellate.
// Returns { positions: Float64Array, indices: Uint32Array, name }, or
// throws on bridge / kernel failure. Used by the STL import path: after
// forge.io.importStl(filepath) returns a handle, tessellate it back to a
// renderable mesh.

export function tessellateBodyAsMesh(handle, { linearTol = 0.5, angularTol = 0.5,
                                                name = 'imported mesh' } = {}) {
  if (typeof window === 'undefined' || !window.forge ||
      typeof window.forge.tessellate !== 'function') {
    throw new Error('window.forge.tessellate unavailable');
  }
  const t = window.forge.tessellate(handle, linearTol, angularTol);
  if (!t || !t.positions || !t.indices) {
    throw new Error('forge.tessellate returned no geometry');
  }
  // tessellate returns Float32Array positions; widen to Float64 so the
  // downstream maths preserves precision through the binning step.
  const pos = t.positions instanceof Float32Array
            ? Float64Array.from(t.positions)
            : new Float64Array(t.positions);
  const idx = t.indices instanceof Uint32Array
            ? new Uint32Array(t.indices)
            : new Uint32Array(t.indices);
  return {
    positions: pos,
    indices:   idx,
    name,
    triangleCount: idx.length / 3,
    vertexCount:   pos.length / 3,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Area-weighted sampling — pick N points uniformly distributed across the
// mesh's triangle area. The classic algorithm: build a CDF of triangle
// areas, draw a uniform random number to pick a triangle, then sample
// barycentric coordinates uniformly on that triangle.
//
// Deterministic when a seed function is passed (rng); otherwise uses
// Math.random. The e2e passes a deterministic seeded LCG so the sample
// point cloud is reproducible across runs.

export function sampleMeshPoints(mesh, n, { rng } = {}) {
  if (!mesh || !mesh.positions || !mesh.indices) {
    throw new Error('sampleMeshPoints: invalid mesh');
  }
  const N = Math.max(1, n | 0);
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) {
    throw new Error('sampleMeshPoints: mesh has no triangles');
  }
  const rand = typeof rng === 'function' ? rng : Math.random;
  const pos = mesh.positions;
  const idx = mesh.indices;

  // 1. Area-weighted CDF.
  const areas = new Float64Array(triCount);
  let totalArea = 0;
  for (let t = 0; t < triCount; t++) {
    const a = idx[3 * t]     * 3;
    const b = idx[3 * t + 1] * 3;
    const c = idx[3 * t + 2] * 3;
    const abx = pos[b]     - pos[a];
    const aby = pos[b + 1] - pos[a + 1];
    const abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c]     - pos[a];
    const acy = pos[c + 1] - pos[a + 1];
    const acz = pos[c + 2] - pos[a + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    areas[t] = area;
    totalArea += area;
  }
  if (!Number.isFinite(totalArea) || totalArea <= 0) {
    throw new Error('sampleMeshPoints: total triangle area is zero');
  }
  // Build CDF in-place; areas[t] becomes the prefix sum.
  let acc = 0;
  for (let t = 0; t < triCount; t++) {
    acc += areas[t];
    areas[t] = acc;
  }

  // 2. Sample N points.
  const out = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = rand() * totalArea;
    // Binary search to find triangle index where prefix sum ≥ u.
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (areas[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;
    // Uniform barycentric coordinates on triangle t.
    let r1 = rand();
    let r2 = rand();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const r0 = 1 - r1 - r2;
    const a = idx[3 * t]     * 3;
    const b = idx[3 * t + 1] * 3;
    const c = idx[3 * t + 2] * 3;
    out[3 * i]     = r0 * pos[a]     + r1 * pos[b]     + r2 * pos[c];
    out[3 * i + 1] = r0 * pos[a + 1] + r1 * pos[b + 1] + r2 * pos[c + 1];
    out[3 * i + 2] = r0 * pos[a + 2] + r1 * pos[b + 2] + r2 * pos[c + 2];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic LCG random — used by the e2e to seed sampleMeshPoints so
// the point cloud is bit-reproducible across CI runs.

export function makeSeededRng(seed = 0xDEADBEEF) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    // Numerical Recipes LCG.
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─────────────────────────────────────────────────────────────────────
// 3×3 symmetric eigendecomposition via Jacobi rotation. Returns the three
// eigenvalues sorted ascending and the matching eigenvectors as a flat
// array (e0[0..2], e1[0..2], e2[0..2]). Used by fitSurface() to find the
// dominant fitting plane (the eigenvector matching the SMALLEST
// eigenvalue is the plane normal — minimises out-of-plane variance).
//
// Reference: Numerical Recipes 3e §11.1. Pure-JS implementation; converges
// in ≤ 50 sweeps for any symmetric 3×3.

function symEigen3(m00, m01, m02, m11, m12, m22) {
  // Working symmetric matrix.
  let a00 = m00, a01 = m01, a02 = m02;
  let a11 = m11, a12 = m12;
  let a22 = m22;
  // Initial eigenvector basis = identity.
  let v00 = 1, v01 = 0, v02 = 0;
  let v10 = 0, v11 = 1, v12 = 0;
  let v20 = 0, v21 = 0, v22 = 1;
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a01) + Math.abs(a02) + Math.abs(a12);
    if (off < 1e-12) break;
    // Rotate (0,1).
    if (Math.abs(a01) > 1e-14) {
      const theta = (a11 - a00) / (2 * a01);
      const t = theta >= 0
        ? 1 / (theta + Math.sqrt(1 + theta * theta))
        : 1 / (theta - Math.sqrt(1 + theta * theta));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      const newA00 = a00 - t * a01;
      const newA11 = a11 + t * a01;
      const newA02 =  c * a02 - s * a12;
      const newA12 =  s * a02 + c * a12;
      a00 = newA00; a11 = newA11; a01 = 0;
      a02 = newA02; a12 = newA12;
      // Accumulate eigenvectors.
      const nv00 = c * v00 - s * v10;
      const nv10 = s * v00 + c * v10;
      const nv01 = c * v01 - s * v11;
      const nv11 = s * v01 + c * v11;
      const nv02 = c * v02 - s * v12;
      const nv12 = s * v02 + c * v12;
      v00 = nv00; v10 = nv10;
      v01 = nv01; v11 = nv11;
      v02 = nv02; v12 = nv12;
    }
    // Rotate (0,2).
    if (Math.abs(a02) > 1e-14) {
      const theta = (a22 - a00) / (2 * a02);
      const t = theta >= 0
        ? 1 / (theta + Math.sqrt(1 + theta * theta))
        : 1 / (theta - Math.sqrt(1 + theta * theta));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      const newA00 = a00 - t * a02;
      const newA22 = a22 + t * a02;
      const newA01 =  c * a01 - s * a12;
      const newA12 =  s * a01 + c * a12;
      a00 = newA00; a22 = newA22; a02 = 0;
      a01 = newA01; a12 = newA12;
      const nv00 = c * v00 - s * v20;
      const nv20 = s * v00 + c * v20;
      const nv01 = c * v01 - s * v21;
      const nv21 = s * v01 + c * v21;
      const nv02 = c * v02 - s * v22;
      const nv22 = s * v02 + c * v22;
      v00 = nv00; v20 = nv20;
      v01 = nv01; v21 = nv21;
      v02 = nv02; v22 = nv22;
    }
    // Rotate (1,2).
    if (Math.abs(a12) > 1e-14) {
      const theta = (a22 - a11) / (2 * a12);
      const t = theta >= 0
        ? 1 / (theta + Math.sqrt(1 + theta * theta))
        : 1 / (theta - Math.sqrt(1 + theta * theta));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;
      const newA11 = a11 - t * a12;
      const newA22 = a22 + t * a12;
      const newA01 =  c * a01 - s * a02;
      const newA02 =  s * a01 + c * a02;
      a11 = newA11; a22 = newA22; a12 = 0;
      a01 = newA01; a02 = newA02;
      const nv10 = c * v10 - s * v20;
      const nv20 = s * v10 + c * v20;
      const nv11 = c * v11 - s * v21;
      const nv21 = s * v11 + c * v21;
      const nv12 = c * v12 - s * v22;
      const nv22 = s * v12 + c * v22;
      v10 = nv10; v20 = nv20;
      v11 = nv11; v21 = nv21;
      v12 = nv12; v22 = nv22;
    }
  }
  // Sort eigenvalues ascending.
  const evals = [
    { val: a00, vec: [v00, v01, v02] },
    { val: a11, vec: [v10, v11, v12] },
    { val: a22, vec: [v20, v21, v22] },
  ];
  evals.sort((x, y) => x.val - y.val);
  return {
    eigenvalues:  [evals[0].val, evals[1].val, evals[2].val],
    eigenvectors: [evals[0].vec, evals[1].vec, evals[2].vec],
  };
}

// ─────────────────────────────────────────────────────────────────────
// fitSurface — the headline math.
//
// Given scattered (x, y, z) points, do:
//   1. Compute centroid.
//   2. Compute 3×3 covariance matrix of (pt - centroid).
//   3. Eigendecompose. Smallest eigenvalue → plane normal n̂. The two
//      larger eigenvectors → in-plane axes (uAxis, vAxis).
//   4. Project each point: (u, v) = ((pt - centroid)·uAxis,
//      (pt - centroid)·vAxis). Height h = (pt - centroid)·n̂.
//   5. Normalise (u, v) to [0, 1] using the projected bounding box.
//   6. Bin into uCount × vCount grid; sum height + count per cell.
//   7. Average per cell; fill empty cells by IDW (inverse-distance
//      weighted) interpolation from nearest filled neighbours.
//   8. Reconstruct each grid cell's 3D control point:
//        cp = centroid + u*uExtent*uAxis + v*vExtent*vAxis + h*n̂
//      (with u, v in [0, 1] mapped back to [-extent/2, +extent/2]).
//   9. Compute RMS residual: for each input point, look up the projected
//      (u, v) cell, compare the per-sample height to the cell average.
//
// Returns { uCount, vCount, grid, normal, uAxis, vAxis, centroid,
//           uExtent, vExtent, rmsResidual, filledCellRatio }.

export function fitSurface(points, uCount = REVERSE_ENG_DEFAULT_UV,
                                   vCount = REVERSE_ENG_DEFAULT_UV) {
  const uN = Math.max(2, uCount | 0);
  const vN = Math.max(2, vCount | 0);

  // Normalise input to Float64Array.
  let xyz;
  if (points instanceof Float64Array) xyz = points;
  else if (points instanceof Float32Array) xyz = Float64Array.from(points);
  else if (Array.isArray(points)) {
    if (points.length > 0 && Array.isArray(points[0])) {
      // Array of [x, y, z] tuples — flatten.
      xyz = new Float64Array(points.length * 3);
      for (let i = 0; i < points.length; i++) {
        xyz[3 * i]     = points[i][0];
        xyz[3 * i + 1] = points[i][1];
        xyz[3 * i + 2] = points[i][2];
      }
    } else {
      xyz = Float64Array.from(points);
    }
  } else {
    throw new Error('fitSurface: points must be Array or TypedArray');
  }
  const nPoints = (xyz.length / 3) | 0;
  if (nPoints < 4) {
    throw new Error(`fitSurface: need at least 4 points (got ${nPoints})`);
  }

  // 1. Centroid.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < nPoints; i++) {
    cx += xyz[3 * i];
    cy += xyz[3 * i + 1];
    cz += xyz[3 * i + 2];
  }
  cx /= nPoints; cy /= nPoints; cz /= nPoints;

  // 2. 3×3 covariance (symmetric).
  let m00 = 0, m01 = 0, m02 = 0;
  let m11 = 0, m12 = 0, m22 = 0;
  for (let i = 0; i < nPoints; i++) {
    const dx = xyz[3 * i]     - cx;
    const dy = xyz[3 * i + 1] - cy;
    const dz = xyz[3 * i + 2] - cz;
    m00 += dx * dx;  m01 += dx * dy;  m02 += dx * dz;
    m11 += dy * dy;  m12 += dy * dz;
    m22 += dz * dz;
  }
  m00 /= nPoints; m01 /= nPoints; m02 /= nPoints;
  m11 /= nPoints; m12 /= nPoints;
  m22 /= nPoints;

  // 3. Eigendecomposition.
  const { eigenvalues, eigenvectors } = symEigen3(m00, m01, m02, m11, m12, m22);
  // Smallest eigenvalue → normal direction. Two larger eigenvectors → in-plane.
  const normal = eigenvectors[0];
  let uAxis    = eigenvectors[1];
  let vAxis    = eigenvectors[2];

  // Renormalise to unit length defensively.
  const unit = (v) => {
    const m = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  };
  const nUnit = unit(normal);
  const uUnit = unit(uAxis);
  // Make vUnit orthogonal to both nUnit and uUnit via Gram-Schmidt + cross.
  const cross = [
    nUnit[1] * uUnit[2] - nUnit[2] * uUnit[1],
    nUnit[2] * uUnit[0] - nUnit[0] * uUnit[2],
    nUnit[0] * uUnit[1] - nUnit[1] * uUnit[0],
  ];
  const vUnit = unit(cross);

  // 4 + 5. Project to UV plane + record per-point heights. Track UV bounds.
  const uVals = new Float64Array(nPoints);
  const vVals = new Float64Array(nPoints);
  const hVals = new Float64Array(nPoints);
  let uMin = +Infinity, uMax = -Infinity;
  let vMin = +Infinity, vMax = -Infinity;
  for (let i = 0; i < nPoints; i++) {
    const dx = xyz[3 * i]     - cx;
    const dy = xyz[3 * i + 1] - cy;
    const dz = xyz[3 * i + 2] - cz;
    const u = dx * uUnit[0] + dy * uUnit[1] + dz * uUnit[2];
    const v = dx * vUnit[0] + dy * vUnit[1] + dz * vUnit[2];
    const h = dx * nUnit[0] + dy * nUnit[1] + dz * nUnit[2];
    uVals[i] = u; vVals[i] = v; hVals[i] = h;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }
  const uExtent = Math.max(1e-9, uMax - uMin);
  const vExtent = Math.max(1e-9, vMax - vMin);

  // 6 + 7. Bin into uN × vN grid; sum heights + count per cell.
  const sumH  = new Float64Array(uN * vN);
  const cnt   = new Int32Array(uN * vN);
  for (let i = 0; i < nPoints; i++) {
    const uu = (uVals[i] - uMin) / uExtent;  // ∈ [0, 1]
    const vv = (vVals[i] - vMin) / vExtent;  // ∈ [0, 1]
    let iu = Math.min(uN - 1, Math.max(0, Math.floor(uu * (uN - 1) + 0.5)));
    let iv = Math.min(vN - 1, Math.max(0, Math.floor(vv * (vN - 1) + 0.5)));
    const k = iv * uN + iu;
    sumH[k] += hVals[i];
    cnt[k]  += 1;
  }
  // Per-cell average; cells with no samples → NaN, filled in next step.
  const avgH = new Float64Array(uN * vN);
  let filledCells = 0;
  for (let k = 0; k < uN * vN; k++) {
    if (cnt[k] > 0) { avgH[k] = sumH[k] / cnt[k]; filledCells += 1; }
    else            { avgH[k] = NaN; }
  }
  // Fill empty cells by inverse-distance-weighted interpolation from
  // filled neighbours. We walk every empty cell and combine the four
  // nearest filled cells (Chebyshev distance) — cheap and robust for
  // sparse coverage.
  for (let iv = 0; iv < vN; iv++) {
    for (let iu = 0; iu < uN; iu++) {
      const k = iv * uN + iu;
      if (!Number.isNaN(avgH[k])) continue;
      let wSum = 0, hSum = 0;
      // Spiral outward until we collect at least 4 filled samples.
      let collected = 0;
      for (let r = 1; r < uN + vN && collected < 16; r++) {
        for (let dv = -r; dv <= r; dv++) {
          for (let du = -r; du <= r; du++) {
            if (Math.max(Math.abs(du), Math.abs(dv)) !== r) continue;
            const ju = iu + du, jv = iv + dv;
            if (ju < 0 || ju >= uN || jv < 0 || jv >= vN) continue;
            const kk = jv * uN + ju;
            if (Number.isNaN(avgH[kk])) continue;
            const d = Math.hypot(du, dv);
            const w = 1 / (d * d);
            hSum += avgH[kk] * w;
            wSum += w;
            collected += 1;
          }
        }
      }
      avgH[k] = wSum > 0 ? hSum / wSum : 0;
    }
  }

  // 8. Reconstruct grid as 3D control points. Order matches buildPatch's
  // convention: grid[i][j] where i ∈ [0, uN) sweeps u, j ∈ [0, vN) sweeps v.
  // The Forge convention (per coonsPatch.js / SurfacingPanel) is uCount
  // rows × vCount columns: grid[i][j] = control at (u=i/(uN-1), v=j/(vN-1)).
  const grid = [];
  for (let iu = 0; iu < uN; iu++) {
    const row = [];
    const uu = iu / (uN - 1);                // ∈ [0, 1]
    const uLocal = uMin + uu * uExtent;      // projected coord
    for (let jv = 0; jv < vN; jv++) {
      const vv = jv / (vN - 1);
      const vLocal = vMin + vv * vExtent;
      const k = jv * uN + iu;
      const h = avgH[k];
      const x = cx + uLocal * uUnit[0] + vLocal * vUnit[0] + h * nUnit[0];
      const y = cy + uLocal * uUnit[1] + vLocal * vUnit[1] + h * nUnit[1];
      const z = cz + uLocal * uUnit[2] + vLocal * vUnit[2] + h * nUnit[2];
      row.push([x, y, z]);
    }
    grid.push(row);
  }

  // 9. RMS residual — per-point predicted heights vs sampled heights.
  let sqSum = 0;
  for (let i = 0; i < nPoints; i++) {
    const uu = (uVals[i] - uMin) / uExtent;
    const vv = (vVals[i] - vMin) / vExtent;
    const iu = Math.min(uN - 1, Math.max(0, Math.floor(uu * (uN - 1) + 0.5)));
    const jv = Math.min(vN - 1, Math.max(0, Math.floor(vv * (vN - 1) + 0.5)));
    const k = jv * uN + iu;
    const dh = hVals[i] - avgH[k];
    sqSum += dh * dh;
  }
  const rmsResidual = Math.sqrt(sqSum / nPoints);

  return {
    uCount: uN, vCount: vN, grid,
    normal:  nUnit, uAxis: uUnit, vAxis: vUnit,
    centroid: [cx, cy, cz],
    uMin, uMax, vMin, vMax, uExtent, vExtent,
    rmsResidual,
    filledCellRatio: filledCells / (uN * vN),
    eigenvalues,
    pointCount: nPoints,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Commit a fitted control grid as a new NURBS face via
// window.forge.surfacing.buildPatch. Returns
// { ok, faceHandle, reason, message, uKnots, vKnots }.

export function commitFittedSurface(controlGrid, { uDeg = 3, vDeg = 3 } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready' };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing' };
  }
  if (!controlGrid || !Array.isArray(controlGrid.grid)
      || controlGrid.uCount < uDeg + 1 || controlGrid.vCount < vDeg + 1) {
    return { ok: false, reason: 'control grid too small for chosen degree' };
  }
  const uKnots = buildPatchKnots(controlGrid.uCount, uDeg);
  const vKnots = buildPatchKnots(controlGrid.vCount, vDeg);
  try {
    const faceHandle = buildPatch(controlGrid.grid, uDeg, vDeg, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle) };
    }
    return { ok: true, faceHandle, uKnots, vKnots, uDeg, vDeg };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Append a fitted surface body to the live scene. Returns the body
// record appended.

export function appendFittedSurfaceBody(faceHandle, {
  source, samples, uCount, vCount, rmsResidual, sourcePath, sourceMeshName, name,
} = {}) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `reverse-eng-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: REVERSE_ENG_SEED_TAG,
    surface: true,
    params: {
      source, samples, uCount, vCount, rmsResidual,
      sourcePath: sourcePath || null,
      sourceMeshName: sourceMeshName || null,
    },
    name: name || `Fitted Surface (${source}, ${samples} pts, RMS ${rmsResidual.toFixed(2)} mm)`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────
// importStlMesh — read an STL file off disk through forge.io.importStl,
// then tessellate the returned native handle back to a JS mesh via
// forge.tessellate. Returns { ok, mesh, sourceHandle, reason, message }.
//
// The kernel takes care of mesh decoding so we don't need a userland STL
// parser. The native handle stays in the scene as an importable-mesh
// representation; the fitted surface is committed as a separate body.

export async function importStlMesh(filepath) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.io
      || typeof window.forge.io.importStl !== 'function') {
    return { ok: false, reason: 'forge.io.importStl unavailable' };
  }
  if (typeof filepath !== 'string' || filepath.length === 0) {
    return { ok: false, reason: 'filepath required' };
  }
  let h;
  try {
    h = window.forge.io.importStl(filepath);
  } catch (err) {
    return { ok: false, reason: 'forge.io.importStl threw',
             message: err && err.message ? err.message : String(err) };
  }
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) {
    return { ok: false, reason: 'importStl returned invalid handle',
             message: String(h) };
  }
  let mesh;
  try {
    mesh = tessellateBodyAsMesh(h, { name: filepath });
  } catch (err) {
    return { ok: false, reason: 'tessellate threw', sourceHandle: h,
             message: err && err.message ? err.message : String(err) };
  }
  return { ok: true, mesh, sourceHandle: h };
}

// ─────────────────────────────────────────────────────────────────────
// Top-level driver — pick source → sample N points → fit → commit
// surface → append to scene → bus event. Used by both the panel Fit
// button and the e2e spec / Archie tool-call paths.
//
// Inputs:
//   { source: 'synth' | 'stl',
//     samples: integer,
//     uCount, vCount,
//     stlPath: string (when source==='stl'),
//     points: Float64Array | Array<[x,y,z]> (when caller already has
//             a sampled cloud — the e2e uses this to skip mesh gen),
//     mesh:   { positions, indices } (caller-provided mesh),
//     rng:    optional seeded random function. }
//
// Returns { ok, faceHandle, body, mesh, points, fit, reason, message }.

export async function runReverseEngineeringPipeline({
  source = REVERSE_ENG_SOURCE_SYNTH,
  samples = REVERSE_ENG_DEFAULT_SAMPLES,
  uCount = REVERSE_ENG_DEFAULT_UV,
  vCount = REVERSE_ENG_DEFAULT_UV,
  stlPath = null,
  points = null,
  mesh = null,
  rng = null,
  uDeg = 3,
  vDeg = 3,
} = {}) {
  let resolvedMesh = mesh || null;
  let sourceHandle = null;
  // Resolve mesh.
  if (!resolvedMesh && !points) {
    if (source === REVERSE_ENG_SOURCE_STL) {
      if (!stlPath) {
        return { ok: false, reason: 'stl source requires stlPath' };
      }
      const imp = await importStlMesh(stlPath);
      if (!imp.ok) {
        return { ok: false, reason: imp.reason, message: imp.message };
      }
      resolvedMesh = imp.mesh;
      sourceHandle = imp.sourceHandle;
    } else {
      // Synthetic sphere.
      resolvedMesh = generateSyntheticSphereMesh();
    }
  }
  // Sample points if not pre-supplied.
  let resolvedPoints = points;
  if (!resolvedPoints) {
    try {
      resolvedPoints = sampleMeshPoints(resolvedMesh, samples, { rng });
    } catch (err) {
      return { ok: false, reason: 'sampleMeshPoints threw',
               message: err && err.message ? err.message : String(err) };
    }
  }
  // Fit.
  let fit;
  try {
    fit = fitSurface(resolvedPoints, uCount, vCount);
  } catch (err) {
    return { ok: false, reason: 'fitSurface threw',
             message: err && err.message ? err.message : String(err),
             mesh: resolvedMesh, points: resolvedPoints };
  }
  // Commit.
  const committed = commitFittedSurface(fit, { uDeg, vDeg });
  if (!committed.ok) {
    return { ok: false, reason: committed.reason, message: committed.message,
             mesh: resolvedMesh, points: resolvedPoints, fit };
  }
  // Append to scene.
  const body = appendFittedSurfaceBody(committed.faceHandle, {
    source, samples: (resolvedPoints.length / 3) | 0,
    uCount: fit.uCount, vCount: fit.vCount,
    rmsResidual: fit.rmsResidual,
    sourcePath: stlPath || null,
    sourceMeshName: resolvedMesh ? (resolvedMesh.name || null) : null,
  });
  // Broadcast.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(REVERSE_ENG_EVENT, {
        detail: {
          faceHandle: committed.faceHandle, bodyId: body?.id,
          source, samples: (resolvedPoints.length / 3) | 0,
          uCount: fit.uCount, vCount: fit.vCount,
          rmsResidual: fit.rmsResidual,
          sourceHandle, ts: Date.now(),
        },
      }));
    }
  } catch { /* CustomEvent is universal in Electron */ }
  return {
    ok: true, faceHandle: committed.faceHandle, body,
    mesh: resolvedMesh, points: resolvedPoints, fit,
    sourceHandle,
    uKnots: committed.uKnots, vKnots: committed.vKnots,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — the moment this module is imported,
// the helper API mirror is available on window. Same pattern as
// ClassABlendPanel / SurfaceOffsetPanel.

if (typeof window !== 'undefined') {
  try {
    window.__forgeReverseEngHelper = Object.freeze({
      generateSyntheticSphereMesh,
      tessellateBodyAsMesh,
      sampleMeshPoints,
      makeSeededRng,
      fitSurface,
      commitFittedSurface,
      appendFittedSurfaceBody,
      importStlMesh,
      runReverseEngineeringPipeline,
      EVENT_NAME:      REVERSE_ENG_EVENT,
      STORAGE_KEY:     REVERSE_ENG_STORAGE,
      DEFAULT_SAMPLES: REVERSE_ENG_DEFAULT_SAMPLES,
      MIN_SAMPLES:     REVERSE_ENG_MIN_SAMPLES,
      MAX_SAMPLES:     REVERSE_ENG_MAX_SAMPLES,
      DEFAULT_UV:      REVERSE_ENG_DEFAULT_UV,
      SOURCE_SYNTH:    REVERSE_ENG_SOURCE_SYNTH,
      SOURCE_STL:      REVERSE_ENG_SOURCE_STL,
      SEED_TAG:        REVERSE_ENG_SEED_TAG,
    });
    // Bus subscriber for tools.reverseEng that doesn't depend on the
    // React Host being mounted — surfaces a window.__forgeReverseEngLastMenuTs
    // the e2e can poll on even before the React host has booted.
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.reverseEng') {
        window.__forgeReverseEngLastMenuTs = Date.now();
      }
    });
  } catch { /* defensive — fail soft in SSR / non-window envs */ }
}
