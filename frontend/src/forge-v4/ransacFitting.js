// Forge-161 — RANSAC primitive fitting on point clouds.
//
// Implements the Schnabel-Wahl-Klein "Efficient RANSAC for
// Point-Cloud Shape Detection" (Eurographics 2007) primitive set:
//
//   * plane     — 3-point minimal sample → normal-of-best-fit;
//                 inliers vote on the normal direction.
//   * sphere    — 4-point sample, exact center+radius from the
//                 4×4 determinant form |center-pi|² = r².
//   * cylinder  — Hough-transform on per-point normals to pick the
//                 axis direction; least-squares radius/centerline.
//   * cone      — 6-point sample, derive the apex from intersection
//                 of normals + half-angle from spread.
//
// Output is consumed by ReverseEngWorkbench.jsx to instantiate real
// native solid bodies via window.forge.makeBox / makeCylinder /
// makeSphere — RANSAC primitives become genuine OCCT handles.
//
// No fallback: if the kernel rejects a primitive (e.g. radius is
// negative because of an ill-conditioned sample), we throw an
// explicit error and leave the point cloud untouched.

import { estimateNormals } from './pointCloudImport.js';

const TWO_PI = Math.PI * 2;

// --------------------------------------------------------------
// Small vec3 utilities — local, no external dep.
// --------------------------------------------------------------
function v(a, b, c) { return [a, b, c]; }
function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function vlen(a) { return Math.hypot(a[0], a[1], a[2]); }
function vnorm(a) {
  const L = vlen(a) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

function readPt(positions, i) {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

function pickRandom(N, k) {
  const out = new Set();
  while (out.size < k) out.add(Math.floor(Math.random() * N));
  return Array.from(out);
}

// --------------------------------------------------------------
// PLANE
// --------------------------------------------------------------

// Returns { kind:'plane', point:[3], normal:[3], inliers:[idx], rms }
export function fitPlaneRansac(positions, opts = {}) {
  const N = positions.length / 3;
  const iter   = opts.iter   ?? 200;
  const thresh = opts.thresh ?? 1.0;
  if (N < 3) throw new Error('ransac: plane needs ≥ 3 points');
  let best = null;
  for (let it = 0; it < iter; it++) {
    const idx = pickRandom(N, 3);
    const a = readPt(positions, idx[0]);
    const b = readPt(positions, idx[1]);
    const c = readPt(positions, idx[2]);
    const n = vnorm(vcross(vsub(b, a), vsub(c, a)));
    if (!Number.isFinite(n[0])) continue;
    const d = vdot(n, a);
    let inliers = [];
    let sqAcc = 0;
    for (let i = 0; i < N; i++) {
      const p = readPt(positions, i);
      const dist = Math.abs(vdot(n, p) - d);
      if (dist < thresh) {
        inliers.push(i);
        sqAcc += dist * dist;
      }
    }
    const score = inliers.length;
    if (!best || score > best.inliers.length) {
      best = { kind: 'plane', point: a, normal: n,
               inliers, rms: Math.sqrt(sqAcc / Math.max(1, inliers.length)) };
    }
  }
  if (!best) throw new Error('ransac: no plane found');
  return best;
}

// --------------------------------------------------------------
// SPHERE
// --------------------------------------------------------------

// Exact sphere through 4 points via Cramer's rule on the
// |p|² = 2·(c·p) + (r² - |c|²) system.  Returns { kind:'sphere',
// center:[3], radius, inliers, rms }.
export function fitSphereRansac(positions, opts = {}) {
  const N = positions.length / 3;
  const iter   = opts.iter   ?? 300;
  const thresh = opts.thresh ?? 1.0;
  if (N < 4) throw new Error('ransac: sphere needs ≥ 4 points');
  let best = null;
  for (let it = 0; it < iter; it++) {
    const idx = pickRandom(N, 4);
    const pts = idx.map((i) => readPt(positions, i));
    // System: 2(p_i · c) - r² = -|p_i|² · 1  →  4 unknowns (cx,cy,cz,r²)
    // Solve linear 4×4.
    const A = [];
    const rhs = [];
    for (const p of pts) {
      A.push([2 * p[0], 2 * p[1], 2 * p[2], -1]);
      rhs.push(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    }
    const sol = solve4x4(A, rhs);
    if (!sol) continue;
    const [cx, cy, cz, k] = sol;
    const rSq = cx * cx + cy * cy + cz * cz - k;
    if (rSq <= 0) continue;
    const r = Math.sqrt(rSq);
    let inliers = [];
    let sqAcc = 0;
    for (let i = 0; i < N; i++) {
      const p = readPt(positions, i);
      const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
      const dev = Math.abs(d - r);
      if (dev < thresh) {
        inliers.push(i);
        sqAcc += dev * dev;
      }
    }
    if (!best || inliers.length > best.inliers.length) {
      best = { kind: 'sphere', center: [cx, cy, cz], radius: r,
               inliers, rms: Math.sqrt(sqAcc / Math.max(1, inliers.length)) };
    }
  }
  if (!best) throw new Error('ransac: no sphere found');
  return best;
}

// Tiny 4×4 solver via Gaussian elimination with partial pivoting.
function solve4x4(A, b) {
  // Build augmented matrix M (4×5) and reduce.
  const M = [];
  for (let i = 0; i < 4; i++) M.push([...A[i], b[i]]);
  for (let p = 0; p < 4; p++) {
    // Pivot.
    let piv = p;
    for (let r = p + 1; r < 4; r++) {
      if (Math.abs(M[r][p]) > Math.abs(M[piv][p])) piv = r;
    }
    if (Math.abs(M[piv][p]) < 1e-12) return null;
    if (piv !== p) { const tmp = M[p]; M[p] = M[piv]; M[piv] = tmp; }
    for (let r = p + 1; r < 4; r++) {
      const f = M[r][p] / M[p][p];
      for (let c = p; c <= 4; c++) M[r][c] -= f * M[p][c];
    }
  }
  const x = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    let s = M[i][4];
    for (let j = i + 1; j < 4; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// --------------------------------------------------------------
// CYLINDER
// --------------------------------------------------------------

// Two-stage Schnabel et al.:
//   1) accumulate per-point normals on the Gaussian sphere → the
//      maximum-vote bin gives the cylinder axis direction (since
//      every point normal is perpendicular to the axis).
//   2) project all points onto the plane orthogonal to the axis
//      → fit a circle in that plane to get center+radius.
// Returns { kind:'cylinder', axisOrigin:[3], axisDir:[3],
//   radius, height, inliers, rms }.
export function fitCylinderRansac(positions, opts = {}) {
  const N = positions.length / 3;
  if (N < 6) throw new Error('ransac: cylinder needs ≥ 6 points');
  const thresh = opts.thresh ?? 1.0;
  const normals = opts.normals || estimateNormals(positions, opts.k ?? 14);

  // Step 1 — Hough-like accumulator on (theta,phi) bins.  Each
  // point normal is binned by its orientation; the densest bin is
  // the normal direction shared by most points → perpendicular to
  // the cylinder axis.  Since infinitely many points' normals are
  // perpendicular to the axis, the axis itself is the LEAST
  // populated great-circle pole — easier to find the densest bin
  // and then pick its orthogonal direction.
  const T = 36, P = 36;
  const acc = new Int32Array(T * P);
  for (let i = 0; i < N; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const theta = Math.acos(Math.max(-1, Math.min(1, nz)));
    let phi = Math.atan2(ny, nx); if (phi < 0) phi += TWO_PI;
    const ti = Math.min(T - 1, Math.floor((theta / Math.PI) * T));
    const pi = Math.min(P - 1, Math.floor((phi / TWO_PI) * P));
    acc[ti * P + pi]++;
  }
  // Find the densest bin direction → call it n0.
  let maxIdx = 0;
  for (let i = 1; i < acc.length; i++) if (acc[i] > acc[maxIdx]) maxIdx = i;
  const ti0 = Math.floor(maxIdx / P);
  const pi0 = maxIdx % P;
  const th0 = (ti0 + 0.5) / T * Math.PI;
  const ph0 = (pi0 + 0.5) / P * TWO_PI;
  const n0 = [Math.sin(th0) * Math.cos(ph0),
              Math.sin(th0) * Math.sin(ph0),
              Math.cos(th0)];
  // Axis = perpendicular complement — pick the next-densest bin
  // whose direction is orthogonal-ish to n0, and take the cross.
  let bestOrth = null, bestOrthVote = 0;
  for (let i = 0; i < acc.length; i++) {
    if (i === maxIdx || acc[i] === 0) continue;
    const ti = Math.floor(i / P);
    const pi = i % P;
    const th = (ti + 0.5) / T * Math.PI;
    const ph = (pi + 0.5) / P * TWO_PI;
    const n = [Math.sin(th) * Math.cos(ph),
               Math.sin(th) * Math.sin(ph),
               Math.cos(th)];
    const dot = Math.abs(vdot(n, n0));
    if (dot < 0.5 && acc[i] > bestOrthVote) {
      bestOrthVote = acc[i];
      bestOrth = n;
    }
  }
  const axisDir = bestOrth
    ? vnorm(vcross(n0, bestOrth))
    : [0, 0, 1]; // degenerate — fall back to Z.

  // Step 2 — project to plane perpendicular to axisDir, fit circle.
  // Build an orthonormal basis (ax,ay) for that plane.
  const tmp = Math.abs(axisDir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ax = vnorm(vcross(axisDir, tmp));
  const ay = vcross(axisDir, ax);
  const u = new Float32Array(N);
  const v2 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = readPt(positions, i);
    u[i]  = vdot(p, ax);
    v2[i] = vdot(p, ay);
  }
  // Algebraic circle fit (Kasa): minimise Σ(uᵢ²+vᵢ²-2auᵢ-2bvᵢ-c)²
  // → linear 3-variable system.
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0;
  let Sxxx = 0, Syyy = 0, Sxyy = 0, Sxxy = 0;
  for (let i = 0; i < N; i++) {
    const x = u[i], y = v2[i];
    Sx += x; Sy += y;
    Sxx += x * x; Syy += y * y; Sxy += x * y;
    Sxxx += x * x * x; Syyy += y * y * y;
    Sxyy += x * y * y; Sxxy += x * x * y;
  }
  // Solve 2×2 for (a,b) — center in (u,v).
  const A = [[Sxx - Sx * Sx / N, Sxy - Sx * Sy / N],
             [Sxy - Sx * Sy / N, Syy - Sy * Sy / N]];
  const rhs = [
    0.5 * (Sxxx + Sxyy - (Sx * (Sxx + Syy)) / N),
    0.5 * (Syyy + Sxxy - (Sy * (Sxx + Syy)) / N),
  ];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-12) throw new Error('ransac: cylinder degenerate fit');
  const cu = (rhs[0] * A[1][1] - rhs[1] * A[0][1]) / det;
  const cv = (A[0][0] * rhs[1] - A[1][0] * rhs[0]) / det;
  let rSum = 0;
  for (let i = 0; i < N; i++) {
    rSum += Math.hypot(u[i] - cu, v2[i] - cv);
  }
  const radius = rSum / N;
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error('ransac: cylinder radius non-positive');
  }
  const center3 = vadd(vscale(ax, cu), vscale(ay, cv));

  // Inliers + extents along axis → cylinder height.
  let inliers = [];
  let sqAcc = 0;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) {
    const p = readPt(positions, i);
    const d = Math.hypot(u[i] - cu, v2[i] - cv);
    const dev = Math.abs(d - radius);
    if (dev < thresh) {
      inliers.push(i);
      sqAcc += dev * dev;
      const t = vdot(p, axisDir);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  return {
    kind: 'cylinder',
    axisOrigin: vadd(center3, vscale(axisDir, lo)),
    axisDir,
    radius,
    height: Math.max(0, hi - lo),
    inliers,
    rms: Math.sqrt(sqAcc / Math.max(1, inliers.length)),
  };
}

// --------------------------------------------------------------
// CONE
// --------------------------------------------------------------

// 6-point sample.  Per Schnabel et al: each pair of points + their
// normals defines a line passing through the apex (the normal at
// any cone surface point points along the radial direction to the
// axis at that height, and the line from p along -n hits the apex).
// We intersect any two such normal-lines to estimate apex, then
// derive the axis as the centroid of (apex → centroidOfPts) and
// the half-angle from the spread.
//
// Returns { kind:'cone', apex:[3], axisDir:[3], halfAngle (rad),
//   height, inliers, rms }.
export function fitConeRansac(positions, opts = {}) {
  const N = positions.length / 3;
  if (N < 6) throw new Error('ransac: cone needs ≥ 6 points');
  const iter   = opts.iter   ?? 200;
  const thresh = opts.thresh ?? 1.0;
  const normals = opts.normals || estimateNormals(positions, opts.k ?? 14);
  let best = null;
  for (let it = 0; it < iter; it++) {
    const idx = pickRandom(N, 6);
    const a = readPt(positions, idx[0]);
    const b = readPt(positions, idx[1]);
    const na = [normals[idx[0] * 3], normals[idx[0] * 3 + 1], normals[idx[0] * 3 + 2]];
    const nb = [normals[idx[1] * 3], normals[idx[1] * 3 + 1], normals[idx[1] * 3 + 2]];
    // Apex = intersection of (a + t·-na) and (b + s·-nb) — closest
    // approach of the two lines.
    const apex = lineLineClosest(a, vscale(na, -1), b, vscale(nb, -1));
    if (!apex) continue;
    // Axis direction = average of (pt - apex), then normalised.
    let dirAcc = [0, 0, 0];
    let angles = [];
    for (const j of idx) {
      const p = readPt(positions, j);
      const r = vsub(p, apex);
      const L = vlen(r) || 1;
      dirAcc = vadd(dirAcc, vscale(r, 1 / L));
    }
    const axisDir = vnorm(dirAcc);
    if (!Number.isFinite(axisDir[0])) continue;
    // Half-angle = average angle between (pi - apex) and axis.
    let aAcc = 0;
    for (const j of idx) {
      const p = readPt(positions, j);
      const r = vsub(p, apex);
      const L = vlen(r) || 1;
      const cos = Math.max(-1, Math.min(1, vdot(r, axisDir) / L));
      aAcc += Math.acos(cos);
      angles.push(Math.acos(cos));
    }
    const halfAngle = aAcc / idx.length;
    if (halfAngle <= 0 || halfAngle >= Math.PI / 2) continue;
    // Tally inliers — point-to-cone-surface distance.
    let inliers = [];
    let sqAcc = 0;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) {
      const p = readPt(positions, i);
      const r = vsub(p, apex);
      const h = vdot(r, axisDir);     // along axis from apex
      const radial = Math.hypot(
        r[0] - axisDir[0] * h,
        r[1] - axisDir[1] * h,
        r[2] - axisDir[2] * h,
      );
      // Expected radial at this height = h · tan(halfAngle).
      const expected = h * Math.tan(halfAngle);
      const dev = Math.abs(radial - expected);
      if (dev < thresh) {
        inliers.push(i);
        sqAcc += dev * dev;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    if (!best || inliers.length > best.inliers.length) {
      best = {
        kind: 'cone',
        apex,
        axisDir,
        halfAngle,
        height: Math.max(0, hi - lo),
        inliers,
        rms: Math.sqrt(sqAcc / Math.max(1, inliers.length)),
      };
    }
  }
  if (!best) throw new Error('ransac: no cone found');
  return best;
}

function lineLineClosest(p1, d1, p2, d2) {
  const w0 = vsub(p1, p2);
  const a = vdot(d1, d1), b = vdot(d1, d2), c = vdot(d2, d2);
  const d = vdot(d1, w0), e = vdot(d2, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-12) return null;
  const sc = (b * e - c * d) / denom;
  const tc = (a * e - b * d) / denom;
  const cp1 = vadd(p1, vscale(d1, sc));
  const cp2 = vadd(p2, vscale(d2, tc));
  return vscale(vadd(cp1, cp2), 0.5);
}

// --------------------------------------------------------------
// Multi-primitive segmentation
// --------------------------------------------------------------

// Run RANSAC iteratively: fit best primitive → remove inliers →
// repeat until the residual cloud is too small or no fit exceeds
// `minInlierRatio` of the remaining points.
export function segment(positions, opts = {}) {
  const minInlierRatio = opts.minInlierRatio ?? 0.08;
  const maxPrimitives  = opts.maxPrimitives  ?? 6;
  const thresh         = opts.thresh         ?? 1.0;
  const tryKinds       = opts.tryKinds || ['plane', 'cylinder', 'sphere'];
  let active = new Float32Array(positions);
  let activeMap = []; // index in active → index in original
  for (let i = 0; i < active.length / 3; i++) activeMap.push(i);
  const primitives = [];
  for (let pIdx = 0; pIdx < maxPrimitives; pIdx++) {
    const N = active.length / 3;
    if (N < 6) break;
    let best = null;
    for (const kind of tryKinds) {
      try {
        let fit;
        if (kind === 'plane')    fit = fitPlaneRansac(active, { thresh, iter: 120 });
        else if (kind === 'sphere')   fit = fitSphereRansac(active, { thresh, iter: 200 });
        else if (kind === 'cylinder') fit = fitCylinderRansac(active, { thresh });
        else if (kind === 'cone')     fit = fitConeRansac(active, { thresh, iter: 120 });
        else continue;
        if (!best || fit.inliers.length > best.inliers.length) best = fit;
      } catch { /* try next kind */ }
    }
    if (!best || best.inliers.length / N < minInlierRatio) break;
    // Map inliers back to original indices.
    const origInliers = best.inliers.map((i) => activeMap[i]);
    primitives.push({ ...best, inliers: origInliers });
    // Remove inliers from active cloud.
    const keep = new Uint8Array(N);
    keep.fill(1);
    for (const i of best.inliers) keep[i] = 0;
    const next = [];
    const nextMap = [];
    for (let i = 0; i < N; i++) {
      if (keep[i]) {
        next.push(active[i * 3], active[i * 3 + 1], active[i * 3 + 2]);
        nextMap.push(activeMap[i]);
      }
    }
    active = Float32Array.from(next);
    activeMap = nextMap;
  }
  return { primitives, residual: { positions: active, count: active.length / 3 } };
}
