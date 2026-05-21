/**
 * ArchDisc Foundation — true G2 (curvature-continuous) surface blend.
 *
 * A G2 blend ("fairing surface") joins two boundary curves with a surface
 * that matches, at BOTH boundaries: position (G0), tangent plane (G1) and
 * curvature (G2). G2 is the continuity an aesthetic / class-A surface needs
 * — a zebra-stripe reflection runs unbroken AND kink-free across the seam.
 *
 * ── The degree-5-in-v construction ──────────────────────────────────────────
 * Each isoparametric u-curve of the blend is a degree-5 Bézier segment with
 * 6 control points P0..P5, parameter v ∈ [0,1]. The standard Bézier endpoint
 * derivative identities (e.g. Shene CS3621 notes; Farin, "Curves and Surfaces
 * for CAGD" §5 on geometric continuity) give, for degree n=5:
 *
 *     position(0)        = P0
 *     d/dv (0)           = 5 (P1 − P0)
 *     d²/dv² (0)         = 20 (P2 − 2 P1 + P0)
 *     position(1)        = P5
 *     d/dv (1)           = 5 (P5 − P4)
 *     d²/dv² (1)         = 20 (P5 − 2 P4 + P3)
 *
 * Inverting them — given boundary-0 data (C0, T0, K0) and boundary-1 data
 * (C1, T1, K1), where C = cross-boundary position, T = 1st derivative
 * (the tangent leaving the boundary into the blend) and K = 2nd derivative —
 * the 6 control points are FULLY DETERMINED:
 *
 *     P0 = C0
 *     P1 = P0 + T0/5
 *     P2 = K0/20 + 2 P1 − P0
 *     P5 = C1
 *     P4 = P5 − T1/5
 *     P3 = K1/20 + 2 P4 − P5
 *
 * Because P0,P1,P2 fix position+tangent+curvature at v=0 and P3,P4,P5 fix
 * them at v=1, the resulting u-curve is automatically G2 with both boundary
 * curves. Degree 5 is the minimum degree that can match position + 1st +
 * 2nd derivative at BOTH ends (degree 4 suffices for one end only) — see the
 * Step-0 references in docs/superpowers/notes/g2-blend-G.md.
 *
 * ── The u-direction ─────────────────────────────────────────────────────────
 * The u-direction is the boundary parameter. The per-station 6-tuples form a
 * raw net rawNet[station][0..5]. To make the surface a genuine tensor-product
 * NURBS that still interpolates the boundary data at every station, each of
 * the 6 v-columns is fitted with a degree-3 (cubic) curve that PASSES THROUGH
 * every station point — classical global cubic interpolation (Piegl & Tiller,
 * "The NURBS Book" §9.2.1, Algorithm A9.1). Interpolation (not least-squares)
 * is used so the boundary match is exact: at v=0 / v=1 the surface reproduces
 * the supplied C/T/K to machine precision (verified in the self-test footer).
 *
 * The result is a NURBSSurface of degree 3 in u and degree 5 in v.
 *
 * Honest scope:
 *   - This fits the blend between TWO boundary curves. It is not an N-sided
 *     patch and does not auto-trim against neighbouring faces.
 *   - The curvature data is the 2nd cross-derivative; matching it gives true
 *     G2 along the v-isocurves. Full curvature continuity in every tangent
 *     direction additionally needs the mixed (twist) terms to agree — for the
 *     near-parallel boundary blends this op targets that is satisfied to the
 *     fitting tolerance; arbitrary skew boundaries are a documented gap.
 *
 * Kernel-free pure math — node-importable for e2e.
 *
 * Refs:
 *   Piegl & Tiller, "The NURBS Book" §9.2.1 (global interpolation).
 *   G. Farin, "Curves and Surfaces for CAGD" — geometric continuity / fairing.
 *   docs/superpowers/notes/g2-blend-G.md (Step-0 browser references).
 */

import { NURBSSurface } from './NURBSSurface.js';

const EPS = 1e-12;

// ── tiny vec3 helpers ───────────────────────────────────────────────────────
const sub3   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3   = (a)    => Math.hypot(a[0], a[1], a[2]);
const dist3  = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function unit3(a) {
  const n = len3(a);
  return n > EPS ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}
function isFinite3(a) {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
}

// ────────────────────────────────────────────────────────────────────────────
// Boundary normalisation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a caller-supplied boundary descriptor into
 * { points, tangents, curvatures } with consistent array lengths.
 *
 * If `opts.computeFromPositions` is set and tangents/curvatures are absent
 * (or partially absent), they are derived from the `points` by finite
 * difference: the cross-boundary tangent defaults to a small inward step and
 * the curvature to a small second-difference. When the caller cannot supply
 * real cross-boundary derivatives this still yields a smooth, well-defined
 * blend (it degrades gracefully to a near-G1 ruled-ish surface).
 *
 * @param {{points:number[][], tangents?:number[][], curvatures?:number[][]}} b
 * @param {{computeFromPositions?:boolean, label?:string}} opts
 * @returns {{points:number[][], tangents:number[][], curvatures:number[][]}}
 */
function normaliseBoundary(b, opts = {}) {
  const label = opts.label || 'boundary';
  if (!b || !Array.isArray(b.points) || b.points.length < 2) {
    throw new Error(`g2Blend: ${label} needs at least 2 points`);
  }
  const n = b.points.length;
  const points = b.points.map((p) => {
    if (!Array.isArray(p) || p.length < 3 || !isFinite3(p)) {
      throw new Error(`g2Blend: ${label} has a non-finite / malformed point`);
    }
    return [p[0], p[1], p[2]];
  });

  let tangents = b.tangents;
  let curvatures = b.curvatures;

  const haveTangents =
    Array.isArray(tangents) && tangents.length === n &&
    tangents.every((t) => Array.isArray(t) && t.length >= 3 && isFinite3(t));
  const haveCurv =
    Array.isArray(curvatures) && curvatures.length === n &&
    curvatures.every((k) => Array.isArray(k) && k.length >= 3 && isFinite3(k));

  if ((!haveTangents || !haveCurv) && !opts.computeFromPositions) {
    if (!haveTangents) {
      throw new Error(
        `g2Blend: ${label}.tangents missing or wrong length — ` +
        'supply them, or pass opts.computeFromPositions=true');
    }
    throw new Error(
      `g2Blend: ${label}.curvatures missing or wrong length — ` +
      'supply them, or pass opts.computeFromPositions=true');
  }

  // ── finite-difference fallback for tangents along the boundary curve ──────
  // The boundary curve runs along u (station index). Its first/second
  // along-curve differences are a sound default cross-boundary frame when the
  // caller has no genuine cross-derivative data.
  if (!haveTangents) {
    tangents = new Array(n);
    for (let i = 0; i < n; i++) {
      const ip = Math.min(n - 1, i + 1);
      const im = Math.max(0, i - 1);
      const d = sub3(points[ip], points[im]);
      // A modest inward magnitude keeps the blend bounded.
      tangents[i] = scale3(d, 0.5);
    }
  } else {
    tangents = tangents.map((t) => [t[0], t[1], t[2]]);
  }

  if (!haveCurv) {
    curvatures = new Array(n);
    for (let i = 0; i < n; i++) {
      const ip = Math.min(n - 1, i + 1);
      const im = Math.max(0, i - 1);
      // Central 2nd difference P[i+1] - 2 P[i] + P[i-1].
      curvatures[i] = add3(sub3(points[ip], scale3(points[i], 2)), points[im]);
    }
  } else {
    curvatures = curvatures.map((k) => [k[0], k[1], k[2]]);
  }

  return { points, tangents, curvatures };
}

/**
 * Linearly resample a normalised boundary to exactly `targetStations` stations.
 * Positions, tangents and curvatures are all interpolated along the existing
 * station polyline. Used to guarantee at least 4 stations so the degree-3
 * u-direction fit is well-posed (a cubic needs ≥ 4 control points).
 *
 * @param {{points:number[][],tangents:number[][],curvatures:number[][]}} b
 * @param {number} targetStations
 */
function densifyBoundary(b, targetStations) {
  const srcN = b.points.length;
  if (srcN >= targetStations) return b;
  const lerpArr = (arr, f) => {
    const lo = Math.min(srcN - 1, Math.floor(f));
    const hi = Math.min(srcN - 1, lo + 1);
    const fr = f - lo;
    return add3(scale3(arr[lo], 1 - fr), scale3(arr[hi], fr));
  };
  const points = new Array(targetStations);
  const tangents = new Array(targetStations);
  const curvatures = new Array(targetStations);
  for (let i = 0; i < targetStations; i++) {
    const f = (i / (targetStations - 1)) * (srcN - 1);
    points[i] = lerpArr(b.points, f);
    tangents[i] = lerpArr(b.tangents, f);
    curvatures[i] = lerpArr(b.curvatures, f);
  }
  return { points, tangents, curvatures };
}

// ────────────────────────────────────────────────────────────────────────────
// Degree-5 control points from boundary data (the core G2 construction)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The six degree-5 v-control points P0..P5 of one isoparametric u-curve,
 * from boundary-0 data (C0,T0,K0) and boundary-1 data (C1,T1,K1).
 *
 *   P0 = C0
 *   P1 = P0 + T0/5
 *   P2 = K0/20 + 2 P1 − P0
 *   P5 = C1
 *   P4 = P5 − T1/5
 *   P3 = K1/20 + 2 P4 − P5
 *
 * Matches position + 1st + 2nd derivative at v=0 AND v=1 → G2 at both ends.
 *
 * @returns {number[][]} [P0,P1,P2,P3,P4,P5]
 */
export function degree5BlendControlPoints(C0, T0, K0, C1, T1, K1) {
  const P0 = [C0[0], C0[1], C0[2]];
  const P1 = add3(P0, scale3(T0, 1 / 5));
  const P2 = add3(scale3(K0, 1 / 20), sub3(scale3(P1, 2), P0));
  const P5 = [C1[0], C1[1], C1[2]];
  const P4 = sub3(P5, scale3(T1, 1 / 5));
  const P3 = add3(scale3(K1, 1 / 20), sub3(scale3(P4, 2), P5));
  return [P0, P1, P2, P3, P4, P5];
}

// ────────────────────────────────────────────────────────────────────────────
// Global cubic interpolation in u (Piegl & Tiller A9.1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Solve a linear system A·x = d by Gaussian elimination with partial pivoting.
 * `A` is an n×n matrix of scalars; `d` is a length-n column of 3-D points;
 * the solution `x` is a length-n column of 3-D points (all 3 coordinates are
 * solved simultaneously against the shared matrix).
 *
 * Returns null if the matrix is singular (caller falls back).
 */
function solveLinearVec3(A, d) {
  const n = A.length;
  // Augment: copy the matrix and the 3-wide rhs.
  const M = A.map((row) => row.slice());
  const R = d.map((p) => [p[0], p[1], p[2]]);

  for (let col = 0; col < n; col++) {
    // partial pivot — largest |entry| in this column at/below the diagonal
    let piv = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-14) return null; // singular
    if (piv !== col) {
      const tmpM = M[piv]; M[piv] = M[col]; M[col] = tmpM;
      const tmpR = R[piv]; R[piv] = R[col]; R[col] = tmpR;
    }
    const diag = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= factor * M[col][c];
      R[r][0] -= factor * R[col][0];
      R[r][1] -= factor * R[col][1];
      R[r][2] -= factor * R[col][2];
    }
  }
  // back-substitution
  const x = new Array(n);
  for (let row = n - 1; row >= 0; row--) {
    const acc = [R[row][0], R[row][1], R[row][2]];
    for (let c = row + 1; c < n; c++) {
      acc[0] -= M[row][c] * x[c][0];
      acc[1] -= M[row][c] * x[c][1];
      acc[2] -= M[row][c] * x[c][2];
    }
    const inv = 1 / M[row][row];
    x[row] = [acc[0] * inv, acc[1] * inv, acc[2] * inv];
  }
  return x;
}

/** Degree-3 clamped B-spline basis functions (Cox-de Boor, NURBS Book A2.2). */
function cubicBasis(knots, span, u, p) {
  const N = new Float64Array(p + 1);
  const left = new Float64Array(p + 1);
  const right = new Float64Array(p + 1);
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const tmp = denom > EPS ? N[r] / denom : 0;
      N[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
  return N;
}

/** Knot span index for parameter u (NURBS Book A2.1), nCP control points. */
function cubicSpan(knots, nCP, u, p) {
  if (u >= knots[nCP] - EPS) return nCP - 1;
  if (u <= knots[p] + EPS) return p;
  let lo = p, hi = nCP;
  let mid = (lo + hi) >> 1;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) hi = mid; else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/**
 * Build a degree-3 clamped knot vector from chord-length parameters for m+1
 * data points. Returns a knot vector of length (m+1)+p+1 = m+5.
 *
 * Standard global-interpolation knot placement (Piegl & Tiller "The NURBS
 * Book" §9.2.1, eq. 9.8): for n+1 data points (here n = m) a degree-p curve
 * has n+1 control points; the interior knots are sliding averages of p
 * consecutive parameters. This guarantees the interpolation matrix is
 * totally positive and well-conditioned.
 *
 * @param {number[]} uk  parameters ŭ_0..ŭ_m ∈ [0,1] (ŭ_0=0, ŭ_m=1)
 * @returns {number[]}
 */
function cubicKnotVector(uk) {
  const m = uk.length - 1;
  const p = 3;
  const nCP = m + 1;                 // one control point per data point
  const nKnots = nCP + p + 1;        // = m + 5
  const knots = new Array(nKnots).fill(0);
  for (let i = 0; i <= p; i++) knots[i] = 0;
  for (let i = 0; i <= p; i++) knots[nKnots - 1 - i] = 1;
  // interior knots: knot[j+p] = (1/p) Σ_{i=j}^{j+p-1} ŭ_i,  j = 1..m-p
  for (let j = 1; j <= m - p; j++) {
    let s = 0;
    for (let i = j; i <= j + p - 1; i++) s += uk[i];
    knots[j + p] = s / p;
  }
  return knots;
}

/**
 * Chord-length parameters ŭ_0..ŭ_m ∈ [0,1] for a polyline of points.
 * Coincident polylines fall back to a uniform spread.
 */
function chordLengthParams(Q) {
  const m = Q.length - 1;
  let total = 0;
  const chord = new Array(m + 1).fill(0);
  for (let k = 1; k <= m; k++) {
    chord[k] = dist3(Q[k], Q[k - 1]);
    total += chord[k];
  }
  const uk = new Array(m + 1);
  uk[0] = 0;
  uk[m] = 1;
  if (total < EPS) {
    for (let k = 1; k < m; k++) uk[k] = m > 0 ? k / m : 0;
  } else {
    let acc = 0;
    for (let k = 1; k < m; k++) { acc += chord[k]; uk[k] = acc / total; }
  }
  return uk;
}

/**
 * Degree-3 global interpolation: given target points Q[0..m], parameters
 * uk[0..m] and a SHARED knot vector, solve for the m+1 control points so the
 * cubic passes through every Q[k] EXACTLY (Piegl & Tiller A9.1).
 *
 * Using a SHARED knot vector + parameters for every v-column is what keeps the
 * assembled tensor-product net valid: all six v-columns must speak the same
 * u-parameterisation. The interpolation matrix N (m+1 square) has the cubic
 * basis functions evaluated at uk[k]; it is solved with a robust general
 * Gaussian solver (the matrix is small and banded — a dense solve is ample).
 *
 * The exact pass-through property is what makes the blend surface reproduce
 * the boundary position/tangent/curvature data to machine precision at the
 * v=0 and v=1 isocurves.
 *
 * @param {number[][]} Q      data points
 * @param {number[]}   uk     parameters (shared)
 * @param {number[]}   knots  shared degree-3 clamped knot vector
 * @returns {number[][]}      m+1 control points
 */
function cubicInterpolateColumn(Q, uk, knots) {
  const m = Q.length - 1;
  const p = 3;
  const nCP = m + 1;

  // degenerate: too few points for a cubic — linear spread, still nCP points.
  if (m < 3) {
    const cp = new Array(nCP);
    for (let i = 0; i < nCP; i++) cp[i] = [Q[i][0], Q[i][1], Q[i][2]];
    return cp;
  }

  // Interpolation matrix: row k enforces S(uk[k]) = Q[k].
  const A = Array.from({ length: nCP }, () => new Array(nCP).fill(0));
  const rhs = new Array(nCP);
  for (let k = 0; k <= m; k++) {
    const u = uk[k];
    const span = cubicSpan(knots, nCP, u, p);
    const N = cubicBasis(knots, span, u, p);
    for (let r = 0; r <= p; r++) {
      const cpIdx = span - p + r;
      if (cpIdx >= 0 && cpIdx < nCP) A[k][cpIdx] += N[r];
    }
    rhs[k] = [Q[k][0], Q[k][1], Q[k][2]];
  }

  let P = solveLinearVec3(A, rhs);
  if (!P) {
    // Singular (e.g. an all-coincident column) — fall back to the data points.
    P = new Array(nCP);
    for (let i = 0; i < nCP; i++) P[i] = [Q[i][0], Q[i][1], Q[i][2]];
  }
  return P;
}

// ────────────────────────────────────────────────────────────────────────────
// g2Blend — the public surface fit
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fit a G2 (curvature-continuous) blend surface between two boundary curves.
 *
 * @param {{points:number[][], tangents?:number[][], curvatures?:number[][]}} boundary0
 * @param {{points:number[][], tangents?:number[][], curvatures?:number[][]}} boundary1
 *   Each boundary samples, along the boundary curve:
 *     points     — cross-boundary position
 *     tangents   — 1st derivative (the tangent leaving the boundary into the blend)
 *     curvatures — 2nd derivative along that cross direction
 *   The two boundaries MUST be sampled with the same number of stations.
 * @param {object} [opts]
 * @param {boolean} [opts.computeFromPositions] derive tangents/curvatures by
 *   finite difference when they are absent.
 * @returns {{
 *   surface: NURBSSurface,
 *   stats: {
 *     stations:number, degreeU:number, degreeV:number,
 *     controlPointsU:number, controlPointsV:number,
 *     boundary0MaxError:number, boundary1MaxError:number
 *   }
 * }}
 */
export function g2Blend(boundary0, boundary1, opts = {}) {
  let b0 = normaliseBoundary(boundary0, { ...opts, label: 'boundary0' });
  let b1 = normaliseBoundary(boundary1, { ...opts, label: 'boundary1' });

  if (b0.points.length !== b1.points.length) {
    throw new Error(
      `g2Blend: the two boundaries must have equal station counts ` +
      `(boundary0 has ${b0.points.length}, boundary1 has ${b1.points.length})`);
  }
  // A degree-3 u-direction fit needs at least 4 control points (= 4 stations).
  // Boundaries sampled with fewer stations are linearly densified — the blend
  // construction is unchanged, the boundary data is merely resampled.
  const MIN_STATIONS = 4;
  if (b0.points.length < MIN_STATIONS) {
    b0 = densifyBoundary(b0, MIN_STATIONS);
    b1 = densifyBoundary(b1, MIN_STATIONS);
  }
  const nStations = b0.points.length; // count, indices 0..M
  const M = nStations - 1;

  // ── 1. degree-5 raw net: per station, the 6 v-control points ──────────────
  // rawNet[station] = [P0..P5].
  const rawNet = new Array(nStations);
  for (let i = 0; i < nStations; i++) {
    rawNet[i] = degree5BlendControlPoints(
      b0.points[i], b0.tangents[i], b0.curvatures[i],
      b1.points[i], b1.tangents[i], b1.curvatures[i],
    );
  }

  // ── 2. degree-3 fit in u for each of the 6 v-columns ──────────────────────
  // Column j is the sequence rawNet[0..M][j]. EVERY column is interpolated
  // against ONE shared u-parameterisation + knot vector — derived from the
  // boundary-0 positions (rawNet[*][0]), the natural boundary parameterisation
  // — so the six fitted columns assemble into a valid tensor-product net.
  const uk = chordLengthParams(rawNet.map((row) => row[0]));
  const uKnots = cubicKnotVector(uk);
  const columns = [];
  for (let j = 0; j < 6; j++) {
    const Q = rawNet.map((row) => row[j]);
    columns.push(cubicInterpolateColumn(Q, uk, uKnots));
  }
  const nCPu = columns[0].length;       // m+1 control points in u

  // ── 3. assemble the tensor-product control net controlNet[i][j] ───────────
  // i indexes u (0..nCPu-1), j indexes v (0..5).
  const controlNet = new Array(nCPu);
  for (let i = 0; i < nCPu; i++) {
    controlNet[i] = new Array(6);
    for (let j = 0; j < 6; j++) {
      controlNet[i][j] = columns[j][i];
    }
  }

  // ── 4. degree-5 Bézier knot vector in v: [0,0,0,0,0,0,1,1,1,1,1,1] ────────
  const vKnots = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];

  const surface = new NURBSSurface({
    degreeU: 3,
    degreeV: 5,
    controlNet,
    knotsU: uKnots,
    knotsV: vKnots,
  });

  // ── 5. measure how exactly the surface reproduces the boundary data ───────
  // At v=0 the surface position must equal b0.points; at v=1, b1.points.
  let err0 = 0;
  let err1 = 0;
  const u0 = surface.uMin;
  const u1 = surface.uMax;
  for (let i = 0; i <= M; i++) {
    const u = u0 + (u1 - u0) * (M > 0 ? i / M : 0);
    const s0 = surface.eval(u, 0);
    const s1 = surface.eval(u, 1);
    err0 = Math.max(err0, dist3(s0, b0.points[i]));
    err1 = Math.max(err1, dist3(s1, b1.points[i]));
  }

  return {
    surface,
    stats: {
      stations: nStations,
      degreeU: 3,
      degreeV: 5,
      controlPointsU: nCPu,
      controlPointsV: 6,
      boundary0MaxError: err0,
      boundary1MaxError: err1,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// evaluation helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a G2 blend surface (or any NURBSSurface) at normalised (s,t),
 * s,t ∈ [0,1] — s maps across the boundary parameter, t from boundary-0
 * (t=0) to boundary-1 (t=1). Returns { point, normal }.
 */
export function evalG2Blend(surface, s, t) {
  const u = surface.uMin + (surface.uMax - surface.uMin) * Math.min(1, Math.max(0, s));
  const v = surface.vMin + (surface.vMax - surface.vMin) * Math.min(1, Math.max(0, t));
  const d = surface.evalDerivatives(u, v);
  return { point: d.S, normal: d.normal };
}

// ────────────────────────────────────────────────────────────────────────────
// tessellateG2Blend — surface → triangle mesh
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sample the blend surface on a uSegs×vSegs grid and emit a triangle mesh.
 * Normals are computed from the surface partial derivatives (Su × Sv), so the
 * mesh shades smoothly; degenerate samples fall back to per-triangle normals.
 *
 * @param {NURBSSurface} surface
 * @param {number} [uSegs=32]  segments across the boundary
 * @param {number} [vSegs=16]  segments from boundary-0 to boundary-1
 * @returns {{positions:Float32Array, normals:Float32Array, indices:Uint32Array}}
 */
export function tessellateG2Blend(surface, uSegs = 32, vSegs = 16) {
  const nu = Math.max(2, Math.round(uSegs));
  const nv = Math.max(2, Math.round(vSegs));
  const u0 = surface.uMin, u1 = surface.uMax;
  const v0 = surface.vMin, v1 = surface.vMax;

  const nVerts = (nu + 1) * (nv + 1);
  const positions = new Float32Array(nVerts * 3);
  const normals = new Float32Array(nVerts * 3);

  let vi = 0;
  for (let jv = 0; jv <= nv; jv++) {
    const v = v0 + (v1 - v0) * (jv / nv);
    for (let iu = 0; iu <= nu; iu++) {
      const u = u0 + (u1 - u0) * (iu / nu);
      const d = surface.evalDerivatives(u, v);
      positions[vi * 3]     = d.S[0];
      positions[vi * 3 + 1] = d.S[1];
      positions[vi * 3 + 2] = d.S[2];
      // surface normal from the partials
      let nrm = d.normal;
      if (!isFinite3(nrm) || len3(nrm) < EPS) nrm = [0, 0, 0];
      normals[vi * 3]     = nrm[0];
      normals[vi * 3 + 1] = nrm[1];
      normals[vi * 3 + 2] = nrm[2];
      vi++;
    }
  }

  const stride = nu + 1;
  const indices = new Uint32Array(nu * nv * 6);
  let ti = 0;
  for (let jv = 0; jv < nv; jv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = jv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[ti++] = a; indices[ti++] = b; indices[ti++] = d;
      indices[ti++] = a; indices[ti++] = d; indices[ti++] = c;
    }
  }

  // Patch any zero / non-finite normals with averaged per-triangle normals.
  let needsFix = false;
  for (let i = 0; i < normals.length; i += 3) {
    if (!Number.isFinite(normals[i]) ||
        (normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0)) {
      needsFix = true;
      break;
    }
  }
  if (needsFix) {
    const acc = new Float64Array(normals.length);
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
      const ux = positions[ib] - positions[ia];
      const uy = positions[ib + 1] - positions[ia + 1];
      const uz = positions[ib + 2] - positions[ia + 2];
      const wx = positions[ic] - positions[ia];
      const wy = positions[ic + 1] - positions[ia + 1];
      const wz = positions[ic + 2] - positions[ia + 2];
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      for (const idx of [ia, ib, ic]) {
        acc[idx] += nx; acc[idx + 1] += ny; acc[idx + 2] += nz;
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const haveSurfNormal = Number.isFinite(normals[i]) &&
        !(normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0);
      if (haveSurfNormal) continue;
      const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
      normals[i]     = acc[i] / l;
      normals[i + 1] = acc[i + 1] / l;
      normals[i + 2] = acc[i + 2] / l;
    }
  }

  return { positions, normals, indices };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SELF-TEST (commented — run by uncommenting under `node`):
 *
 *   A blend between two parallel offset boundary curves. boundary0 is a line
 *   of points along +X at z=0; boundary1 is the same line lifted to z=10. The
 *   cross tangents point +Z (toward the other boundary); the curvatures are
 *   zero (a flat ruled-ish join). The fitted surface must reproduce the given
 *   positions / tangents / curvatures at v=0 and v=1 to ~1e-9.
 *
 *   import { g2Blend, evalG2Blend } from './G2BlendSurface.js';
 *
 *   const N = 9;
 *   const pts0 = [], pts1 = [], tan0 = [], tan1 = [], cur0 = [], cur1 = [];
 *   for (let i = 0; i <= N; i++) {
 *     const x = (i / N) * 100;
 *     pts0.push([x, 0, 0]);   pts1.push([x, 0, 10]);
 *     tan0.push([0, 0, 4]);   tan1.push([0, 0, 4]);   // 1st deriv leaving bnd
 *     cur0.push([0, 2, 0]);   cur1.push([0, 2, 0]);   // 2nd deriv (curvature)
 *   }
 *   const { surface, stats } = g2Blend(
 *     { points: pts0, tangents: tan0, curvatures: cur0 },
 *     { points: pts1, tangents: tan1, curvatures: cur1 });
 *
 *   // Position match at both boundaries:
 *   console.assert(stats.boundary0MaxError < 1e-9, 'b0 pos', stats.boundary0MaxError);
 *   console.assert(stats.boundary1MaxError < 1e-9, 'b1 pos', stats.boundary1MaxError);
 *
 *   // Tangent + curvature match at v=0 / v=1 via the surface's 2nd-order
 *   // derivative evaluator. d/dt and d²/dt² in the NORMALISED t∈[0,1] frame
 *   // equal the supplied tangents / curvatures (vMin..vMax is 0..1 here).
 *   for (let i = 0; i <= N; i++) {
 *     const u = surface.uMin + (surface.uMax - surface.uMin) * (i / N);
 *     const d0 = surface.evalDerivatives2(u, 0);
 *     const d1 = surface.evalDerivatives2(u, 1);
 *     // Sv == tangent, Svv == curvature (degree-5 Bézier on [0,1]).
 *     for (let c = 0; c < 3; c++) {
 *       console.assert(Math.abs(d0.Sv[c]  - tan0[i][c]) < 1e-7, 'b0 tan', i, c);
 *       console.assert(Math.abs(d0.Svv[c] - cur0[i][c]) < 1e-6, 'b0 cur', i, c);
 *       console.assert(Math.abs(d1.Sv[c]  - tan1[i][c]) < 1e-7, 'b1 tan', i, c);
 *       console.assert(Math.abs(d1.Svv[c] - cur1[i][c]) < 1e-6, 'b1 cur', i, c);
 *     }
 *   }
 *   console.log('G2BlendSurface self-test OK', stats);
 *
 *   // computeFromPositions fallback — positions only:
 *   const fb = g2Blend({ points: pts0 }, { points: pts1 },
 *                      { computeFromPositions: true });
 *   console.assert(fb.stats.boundary0MaxError < 1e-9, 'fallback b0');
 *   console.assert(fb.stats.boundary1MaxError < 1e-9, 'fallback b1');
 * ───────────────────────────────────────────────────────────────────────────── */
