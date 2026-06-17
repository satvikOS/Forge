// PUSH-214 (Slice-165) — Real G2 Surface Match math (Class-A surfacing).
//
// Given a TARGET tensor-product Bezier surface S(u,v) of degree (n×m) and
// a REFERENCE Bezier surface R(u,v) of the same u-degree that share a
// boundary edge, this module adjusts the first three target control rows
// nearest the shared edge so that the join satisfies:
//
//   G0:  S = R         on the boundary
//   G1:  ∂S/∂v ∥ ∂R/∂v on the boundary (matched magnitude, single side)
//   G2:  ∂²S/∂v² = ∂²R/∂v² on the boundary
//
// For a tensor-product Bezier surface S(u,v) of degree (n×m) with control
// points P_{i,j}, i∈[0..n], j∈[0..m]:
//
//   S(u, v=0) = Σ_i B_{i,n}(u) · P_{i,0}                    boundary row.
//   ∂S/∂v|_{v=0} = m · Σ_i B_{i,n}(u) · (P_{i,1} − P_{i,0}).
//   ∂²S/∂v²|_{v=0} = m(m−1) · Σ_i B_{i,n}(u) · (P_{i,2} − 2P_{i,1} + P_{i,0}).
//
// So writing T_i = ∂R/∂v|_{v=0, u=u_i} (a vector evaluated by sampling R)
// and C_i = ∂²R/∂v²|_{v=0, u=u_i}, the back-solve is:
//
//   P_{i,0}  = R_{i, edgeRow}                                ← G0
//   P_{i,1} = P_{i,0} + T_i / m                              ← G1
//   P_{i,2} = P_{i,0} + 2 · (P_{i,1} − P_{i,0}) + C_i / (m(m−1))
//          = 2·P_{i,1} − P_{i,0} + C_i / (m(m−1))            ← G2
//
// The same template applies to every boundary edge of S — we just permute
// rows/columns and reverse traversal order. Internally we always normalise
// the chosen edge to v=0 for the maths, then write back to the original
// row/column on the way out.
//
// VERIFICATION
// ────────────
// After the back-solve we re-sample BOTH surfaces at N points along the
// shared boundary and compute, at every sample:
//   * normalDeviation  — angle between unit surface normals.
//   * tangentAlongDev  — angle between unit boundary tangents (∂/∂u).
//   * tangentCrossDev  — angle between unit cross-boundary tangents (∂/∂v).
//   * meanCurvDelta    — |H_S − H_R| (mean curvature delta, 1/mm).
//   * gaussCurvDelta   — |K_S − K_R| (Gaussian curvature delta, 1/mm²).
//   * princCurv1Delta  — |κ1_S − κ1_R| (max principal curvature delta).
//   * princCurv2Delta  — |κ2_S − κ2_R| (min principal curvature delta).
//   * pointDistance    — Euclidean distance between sampled points (G0).
//
// We report max + average of each metric. A perfect G2 match drives every
// metric below 1e-5 (numerical floor — De Casteljau, finite-difference
// rebuilds, etc.).
//
// Hard constraints honoured:
//   * NO new npm / C++ deps.
//   * Pure functions. No THREE import. No DOM.
//   * Real tensor-product Bezier math. Real De Casteljau. Real curvature
//     computation via first/second fundamental forms.
//   * No MVP / no fallback. Degenerate input (mismatched u-degree,
//     incompatible edge, missing control grid) returns a real `{ ok:false,
//     reason }` for the panel to surface.

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const SURFACE_MATCH_G2_EVENT   = 'forge:surface-match-g2-built';
export const SURFACE_MATCH_G2_STORAGE = 'forge.v4.surfaceMatchG2';
/** Default verification sample count along the boundary. */
export const SURFACE_MATCH_G2_DEFAULT_SAMPLES = 25;
/** Bounds for verification sample count (slider range). */
export const SURFACE_MATCH_G2_MIN_SAMPLES = 5;
export const SURFACE_MATCH_G2_MAX_SAMPLES = 201;
/** Supported boundary edges of a tensor-product Bezier surface. */
export const SURFACE_MATCH_G2_EDGES = ['v0', 'v1', 'u0', 'u1'];
/** Pass thresholds for the G0 / G1 / G2 PASS/FAIL chips. The math should
 *  reach 1e-5 on identity matches; we lift the threshold to 1e-4 to give
 *  unit-floor numerical drift on small surfaces some room while still
 *  being three orders of magnitude tighter than the G1 reflection-line
 *  threshold elsewhere in the codebase. */
export const SURFACE_MATCH_G2_G0_THRESHOLD = 1e-5;   // mm
export const SURFACE_MATCH_G2_G1_THRESHOLD = 1e-3;   // degrees
export const SURFACE_MATCH_G2_G2_THRESHOLD = 1e-5;   // 1/mm

// ─────────────────────────────────────────────────────────────────────
// Vec3 helpers — pure, no deps. Vectors are flat [x, y, z] arrays.

export function v3(x, y, z) { return [+x, +y, +z]; }
export function v3Add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
export function v3Sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function v3Scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
export function v3Dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
export function v3Cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
export function v3Len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3Unit(a) {
  const L = v3Len(a);
  if (!Number.isFinite(L) || L < 1e-15) return [0, 0, 0];
  return [a[0]/L, a[1]/L, a[2]/L];
}
export function v3Dist(a, b) {
  return Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
}
/** Un-oriented angle (degrees) ∈ [0, 90°] between two 3-vectors —
 *  Class-A convention treats both orientations of a normal as the same
 *  tangent plane so a flipped normal reads 0°, not 180°. */
export function angleUnorientedDeg(a, b) {
  const ua = v3Unit(a);
  const ub = v3Unit(b);
  if (v3Len(ua) < 1e-12 || v3Len(ub) < 1e-12) return NaN;
  let c = v3Dot(ua, ub);
  if (c >  1) c =  1;
  if (c < -1) c = -1;
  const o = Math.acos(c) * 180 / Math.PI;
  return o > 90 ? 180 - o : o;
}
/** Oriented angle (degrees) ∈ [0, 180°] between two 3-vectors. */
export function angleOrientedDeg(a, b) {
  const ua = v3Unit(a);
  const ub = v3Unit(b);
  if (v3Len(ua) < 1e-12 || v3Len(ub) < 1e-12) return NaN;
  let c = v3Dot(ua, ub);
  if (c >  1) c =  1;
  if (c < -1) c = -1;
  return Math.acos(c) * 180 / Math.PI;
}

// ─────────────────────────────────────────────────────────────────────
// Surface normalisation.
//
// The accepted form is:
//
//   { controlPoints: [ [P_{0,0}, P_{0,1}, ..., P_{0,m}],
//                      [P_{1,0}, P_{1,1}, ..., P_{1,m}],
//                      ...
//                      [P_{n,0}, P_{n,1}, ..., P_{n,m}] ] }
//
// i.e. controlPoints[i][j] is the (i, j) control point with i indexing u
// and j indexing v. The u-degree is n = controlPoints.length - 1; the
// v-degree is m = controlPoints[0].length - 1. We require a rectangular
// grid (every row the same length).
//
// Returns { ok, n, m, P } or { ok:false, reason }. P is a defensive deep
// copy so callers don't mutate the input.

export function normaliseSurface(input) {
  if (!input || !Array.isArray(input.controlPoints)) {
    return { ok: false, reason: 'surface.controlPoints missing' };
  }
  const rows = input.controlPoints;
  const n = rows.length - 1;
  if (n < 1) {
    return { ok: false, reason: 'u-degree must be ≥ 1 (need ≥ 2 control rows)' };
  }
  const m = rows[0].length - 1;
  if (m < 2) {
    return {
      ok: false,
      reason: 'v-degree must be ≥ 2 for G2 match (need ≥ 3 control columns)',
    };
  }
  const P = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    if (!Array.isArray(rows[i]) || rows[i].length !== m + 1) {
      return {
        ok: false,
        reason: `row ${i} has ${(rows[i] || []).length} cols, expected ${m + 1}`,
      };
    }
    P[i] = new Array(m + 1);
    for (let j = 0; j <= m; j++) {
      const p = rows[i][j];
      if (!Array.isArray(p) || p.length !== 3) {
        return {
          ok: false,
          reason: `controlPoints[${i}][${j}] must be a [x,y,z] triple`,
        };
      }
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
        return {
          ok: false,
          reason: `controlPoints[${i}][${j}] has non-finite coordinates`,
        };
      }
      P[i][j] = [+p[0], +p[1], +p[2]];
    }
  }
  return { ok: true, n, m, P };
}

// ─────────────────────────────────────────────────────────────────────
// 1-D De Casteljau evaluator. Given control points pts[0..deg] and t ∈
// [0,1], returns the Bezier curve point at t.
//
// Real De Casteljau (not Bernstein expansion) so we get a stable result
// at every t even for high-degree Bezier rows. The algorithm runs in
// place over a buffer copy.

export function deCasteljau(pts, t) {
  const n = pts.length - 1;
  if (n < 0) return [0, 0, 0];
  if (n === 0) return [pts[0][0], pts[0][1], pts[0][2]];
  const buf = new Array(n + 1);
  for (let i = 0; i <= n; i++) buf[i] = [pts[i][0], pts[i][1], pts[i][2]];
  const u = 1 - t;
  for (let r = 1; r <= n; r++) {
    for (let i = 0; i <= n - r; i++) {
      buf[i][0] = u * buf[i][0] + t * buf[i + 1][0];
      buf[i][1] = u * buf[i][1] + t * buf[i + 1][1];
      buf[i][2] = u * buf[i][2] + t * buf[i + 1][2];
    }
  }
  return buf[0];
}

/** First derivative of a Bezier curve via the standard control-difference
 *  identity: B'(t) = n · Σ B_{i, n-1}(t) · (P_{i+1} − P_i). Returns the
 *  derivative vector at t. */
export function deCasteljauDeriv1(pts, t) {
  const n = pts.length - 1;
  if (n < 1) return [0, 0, 0];
  const diff = new Array(n);
  for (let i = 0; i < n; i++) {
    diff[i] = [
      n * (pts[i + 1][0] - pts[i][0]),
      n * (pts[i + 1][1] - pts[i][1]),
      n * (pts[i + 1][2] - pts[i][2]),
    ];
  }
  return deCasteljau(diff, t);
}

/** Second derivative of a Bezier curve via two control-difference
 *  iterations: B''(t) = n(n−1) · Σ B_{i, n-2}(t) · (P_{i+2} − 2P_{i+1} + P_i). */
export function deCasteljauDeriv2(pts, t) {
  const n = pts.length - 1;
  if (n < 2) return [0, 0, 0];
  const diff = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    diff[i] = [
      n * (n - 1) * (pts[i + 2][0] - 2 * pts[i + 1][0] + pts[i][0]),
      n * (n - 1) * (pts[i + 2][1] - 2 * pts[i + 1][1] + pts[i][1]),
      n * (n - 1) * (pts[i + 2][2] - 2 * pts[i + 1][2] + pts[i][2]),
    ];
  }
  return deCasteljau(diff, t);
}

// ─────────────────────────────────────────────────────────────────────
// Tensor-product Bezier surface evaluation.
//
// S(u, v) = Σ_i Σ_j B_{i,n}(u) · B_{j,m}(v) · P_{i,j}
//
// We use the curve-of-curves trick: at fixed v, compute the v-curve at
// every i (an array of n+1 column points), then evaluate the u-curve
// through those n+1 points at u. This costs O((n+1)·(m+1)) per call but
// uses real De Casteljau both ways.

export function surfaceEval(P, n, m, u, v) {
  const colPts = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    colPts[i] = deCasteljau(P[i], v);
  }
  return deCasteljau(colPts, u);
}

/** ∂S/∂u at (u, v). */
export function surfaceDu(P, n, m, u, v) {
  const colPts = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    colPts[i] = deCasteljau(P[i], v);
  }
  return deCasteljauDeriv1(colPts, u);
}

/** ∂S/∂v at (u, v). */
export function surfaceDv(P, n, m, u, v) {
  const colPts = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    colPts[i] = deCasteljauDeriv1(P[i], v);
  }
  return deCasteljau(colPts, u);
}

/** ∂²S/∂u² at (u, v). */
export function surfaceDuu(P, n, m, u, v) {
  const colPts = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    colPts[i] = deCasteljau(P[i], v);
  }
  return deCasteljauDeriv2(colPts, u);
}

/** ∂²S/∂v² at (u, v). */
export function surfaceDvv(P, n, m, u, v) {
  const colPts = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    colPts[i] = deCasteljauDeriv2(P[i], v);
  }
  return deCasteljau(colPts, u);
}

/** ∂²S/∂u∂v at (u, v). The mixed partial computes the v-derivative of
 *  every row, then takes the u-derivative of the resulting column-of-
 *  derivatives. */
export function surfaceDuv(P, n, m, u, v) {
  const colPts = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    colPts[i] = deCasteljauDeriv1(P[i], v);
  }
  return deCasteljauDeriv1(colPts, u);
}

// ─────────────────────────────────────────────────────────────────────
// Surface differential geometry — unit normal + first/second fundamental
// forms + mean/Gaussian curvatures + principal curvatures at a point.
//
// First fundamental form (E, F, G):
//   E = du · du,  F = du · dv,  G = dv · dv.
// Second fundamental form (L, M, N) with unit normal n = (du × dv)/|du × dv|:
//   L = duu · n,  M = duv · n,  N = dvv · n.
// Mean curvature H = (E·N − 2·F·M + G·L) / (2(EG − F²)).
// Gaussian curvature K = (L·N − M²) / (EG − F²).
// Principal curvatures κ1, κ2 = H ± √(H² − K).

export function surfaceLocalGeometry(P, n, m, u, v) {
  const du = surfaceDu(P, n, m, u, v);
  const dv = surfaceDv(P, n, m, u, v);
  const duu = surfaceDuu(P, n, m, u, v);
  const dvv = surfaceDvv(P, n, m, u, v);
  const duv = surfaceDuv(P, n, m, u, v);
  const cross = v3Cross(du, dv);
  const crossLen = v3Len(cross);
  let nrm = [0, 0, 0];
  if (crossLen > 1e-18) {
    nrm = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen];
  }
  const E = v3Dot(du, du);
  const F = v3Dot(du, dv);
  const G = v3Dot(dv, dv);
  const L = v3Dot(duu, nrm);
  const M = v3Dot(duv, nrm);
  const N = v3Dot(dvv, nrm);
  const denom = E * G - F * F;
  let H = 0, K = 0, k1 = 0, k2 = 0;
  if (Math.abs(denom) > 1e-18) {
    H = (E * N - 2 * F * M + G * L) / (2 * denom);
    K = (L * N - M * M) / denom;
    const disc = H * H - K;
    const sqrt = disc > 0 ? Math.sqrt(disc) : 0;
    k1 = H + sqrt;
    k2 = H - sqrt;
  }
  return {
    point: surfaceEval(P, n, m, u, v),
    du, dv, duu, dvv, duv,
    normal: nrm,
    E, F, G, L, M, N,
    meanH: H,
    gaussK: K,
    princK1: k1,
    princK2: k2,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Edge encoding.
//
// A tensor-product Bezier control grid P has four boundary edges that
// the user might want to match against:
//
//   'v0' → P_{i, 0}    i ∈ [0..n]   (the v=0 row, sweeps in u)
//   'v1' → P_{i, m}    i ∈ [0..n]   (the v=1 row, sweeps in u)
//   'u0' → P_{0, j}    j ∈ [0..m]   (the u=0 column, sweeps in v)
//   'u1' → P_{n, j}    j ∈ [0..m]   (the u=1 column, sweeps in v)
//
// For the maths we always rebase to v=0 (the brief's canonical formulae).
// Given an arbitrary edge, we virtually re-parameterise the surface so
// that:
//   * "along-edge" coordinate t ∈ [0..1] sweeps the boundary in the
//     surface's natural direction for that edge.
//   * "across-edge" coordinate s ∈ [0..1] grows INTO the surface (away
//     from the boundary).
//
// Then we expose helpers that pull the right control rows out of P:
//   getEdgeRow(P, edge, k)     k = 0,1,2 (row-from-boundary into surface)
//   setEdgeRow(P, edge, k, …)
//
// and a (u, v) helper that maps (t, s_step) into surface parameters.
//
// Importantly, the v-degree-vs-u-degree count depends on which edge we
// picked: for a 'v0'/'v1' edge the boundary curve has degree n (in u);
// for a 'u0'/'u1' edge the boundary curve has degree m (in v). The G2
// formulas need:
//   * `crossDegree`: the degree perpendicular to the edge (m for v-edges,
//     n for u-edges). This is the m(m-1) factor in the second-derivative
//     formula.
//   * `boundaryDegree`: degree of the boundary curve itself (n for v-
//     edges, m for u-edges). We use this when sanity-checking that the
//     target and the reference have a compatible boundary parameterisation.

export function edgeMeta(edge, n, m) {
  if (edge === 'v0' || edge === 'v1') {
    return { ok: true, edge, boundaryDegree: n, crossDegree: m };
  }
  if (edge === 'u0' || edge === 'u1') {
    return { ok: true, edge, boundaryDegree: m, crossDegree: n };
  }
  return { ok: false, reason: `unknown edge "${edge}"` };
}

/** Read the k-th cross-boundary control row at edge `edge`. k=0 is the
 *  boundary row itself; k=1 is the row one step into the surface; k=2 is
 *  two rows in. Returns an array of [x,y,z] points. */
export function getEdgeRow(P, n, m, edge, k) {
  if (edge === 'v0') {
    return P.map((row) => [row[k][0], row[k][1], row[k][2]]);
  }
  if (edge === 'v1') {
    return P.map((row) => [
      row[m - k][0], row[m - k][1], row[m - k][2],
    ]);
  }
  if (edge === 'u0') {
    return P[k].map((p) => [p[0], p[1], p[2]]);
  }
  if (edge === 'u1') {
    return P[n - k].map((p) => [p[0], p[1], p[2]]);
  }
  return null;
}

/** Write back the k-th cross-boundary control row at edge `edge`. Mutates
 *  P in place. Returns true on success, false if `edge` is invalid. */
export function setEdgeRow(P, n, m, edge, k, row) {
  if (edge === 'v0') {
    if (row.length !== n + 1) return false;
    for (let i = 0; i <= n; i++) {
      P[i][k][0] = row[i][0];
      P[i][k][1] = row[i][1];
      P[i][k][2] = row[i][2];
    }
    return true;
  }
  if (edge === 'v1') {
    if (row.length !== n + 1) return false;
    for (let i = 0; i <= n; i++) {
      P[i][m - k][0] = row[i][0];
      P[i][m - k][1] = row[i][1];
      P[i][m - k][2] = row[i][2];
    }
    return true;
  }
  if (edge === 'u0') {
    if (row.length !== m + 1) return false;
    for (let j = 0; j <= m; j++) {
      P[k][j][0] = row[j][0];
      P[k][j][1] = row[j][1];
      P[k][j][2] = row[j][2];
    }
    return true;
  }
  if (edge === 'u1') {
    if (row.length !== m + 1) return false;
    for (let j = 0; j <= m; j++) {
      P[n - k][j][0] = row[j][0];
      P[n - k][j][1] = row[j][1];
      P[n - k][j][2] = row[j][2];
    }
    return true;
  }
  return false;
}

/** Map a "boundary parameter" t ∈ [0,1] to the (u, v) pair that lands on
 *  the edge in the surface's native parameter space.
 *  For 'v0'/'v1' edges the boundary sweeps in u (so u = t, v = 0 or 1).
 *  For 'u0'/'u1' edges the boundary sweeps in v (so u = 0 or 1, v = t). */
export function edgeParamToUv(edge, t) {
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (edge === 'v0') return [tt, 0];
  if (edge === 'v1') return [tt, 1];
  if (edge === 'u0') return [0, tt];
  if (edge === 'u1') return [1, tt];
  return [0, 0];
}

/** Return the cross-direction first derivative (∂S/∂v at v=0 or v=1,
 *  ∂S/∂u at u=0 or u=1) evaluated at boundary parameter t. NO sign flip
 *  — the returned vector is the partial derivative in the surface's
 *  native parameter direction. For two surfaces joined at a shared
 *  boundary, the natural G1 condition is that the target's cross-
 *  derivative MATCHES the reference's cross-derivative in the same
 *  parameter direction (because the target continues the reference's
 *  parameterisation across the seam). See the brief's formula
 *  "P_{i,1} = P_{i,0} + (1/m)·∂R/∂v|_{end}" — no negation involved. */
export function edgeCrossDeriv(P, n, m, edge, t) {
  const [u, v] = edgeParamToUv(edge, t);
  if (edge === 'v0' || edge === 'v1') return surfaceDv(P, n, m, u, v);
  if (edge === 'u0' || edge === 'u1') return surfaceDu(P, n, m, u, v);
  return [0, 0, 0];
}

/** Return the cross-direction second derivative evaluated at boundary
 *  parameter t. Same parameter-direction convention as edgeCrossDeriv. */
export function edgeCrossDeriv2(P, n, m, edge, t) {
  const [u, v] = edgeParamToUv(edge, t);
  if (edge === 'v0' || edge === 'v1') return surfaceDvv(P, n, m, u, v);
  if (edge === 'u0' || edge === 'u1') return surfaceDuu(P, n, m, u, v);
  return [0, 0, 0];
}

// ─────────────────────────────────────────────────────────────────────
// G2 control-row solver.
//
// Given a reference R and a target T sharing the SAME boundary curve
// degree (and sharing the same boundary parameter direction), this
// function adjusts T's control rows nearest the boundary so the join
// is G2.
//
// The brief's canonical formulas (rebased to v=0):
//   P_{i,0}  = R_{i, refEdgeRow=0}                    G0
//   P_{i,1} = P_{i,0} + T_i / m                       G1
//                where T_i = ∂R/∂v|_{v=0, u=u_i}
//                and m is the v-degree of the TARGET surface.
//   P_{i,2} = 2·P_{i,1} − P_{i,0} + C_i / (m(m−1))    G2
//                where C_i = ∂²R/∂v²|_{v=0, u=u_i}
//
// In practice the matching boundary curve in R might live on R's v=1
// edge or u=0 edge — not v=0 — and the cross-derivative samples need to
// come from R's actual edge. We rebase via the same edgeCrossDeriv /
// edgeCrossDeriv2 helpers above so the same code path supports every
// (refEdge, tgtEdge) combination.
//
// The boundary degree of R and the boundary degree of T must match
// (n_R == boundaryDegree(refEdge) == boundaryDegree(tgtEdge) == n_T).
// We sample R's boundary at the (n_T + 1) Greville abscissae — i.e. at
// the n_T+1 control-point parametric anchors, the standard Bezier
// interpolation grid. This is the simplest "match the control rows at
// the same anchors" approach the brief describes ("sampled at each u_i").

/** Greville-style anchor parameters for a degree-n Bezier curve. For a
 *  pure Bezier the standard anchors are equispaced t_i = i / n. This is
 *  the parameter set the brief's formulas use. */
export function bezierAnchorParams(n) {
  const t = new Array(n + 1);
  if (n === 0) { t[0] = 0; return t; }
  for (let i = 0; i <= n; i++) t[i] = i / n;
  return t;
}

/** SOLVE — adjust the three control rows of T at edge `tgtEdge` so the
 *  join with R at `refEdge` is G2. Returns:
 *
 *    { ok, n, m_target, anchors, beforeMetrics, afterMetrics, edited:{
 *        row0, row1, row2  // n+1 inward rows, each a list of [x,y,z]
 *      }}
 *
 *  or { ok:false, reason }. T's control points are mutated in place.
 *
 *  The math works at the CONTROL-POINT level, not by sampling. For a
 *  tensor-product Bezier surface
 *      S(u,v) = Σ_i Σ_j B_{i,n}(u) · B_{j,m}(v) · P_{i,j}
 *  the v=0 cross-section is the Bezier curve in u with control points
 *  P_{i,0}; the v-derivative at v=0 is the Bezier curve in u with control
 *  points m·(P_{i,1} − P_{i,0}); the v²-derivative at v=0 is the Bezier
 *  curve in u with control points m(m−1)·(P_{i,2} − 2·P_{i,1} + P_{i,0}).
 *
 *  Two surfaces R, T joined at a boundary edge will be G0/G1/G2-continuous
 *  exactly when those three control-point sequences AGREE on the boundary
 *  curve. So matching is a one-to-one control-point copy: pull row 0 of
 *  the reference's edge (the boundary curve's control polygon), then
 *  derive row 1 and row 2 of the target from the reference's row 0 / 1 /
 *  2 differences. This is the correct closed-form solution — no
 *  iteration, no anchor-sample interpolation.
 *
 *  For the identity case (target == reference, same edge) this yields
 *  exactly zero correction. For G2 across a sphere → plane join it
 *  transfers the sphere's row-1 and row-2 control-point offsets directly,
 *  so the target's first three cross-boundary rows reproduce the same
 *  cross-derivatives as the sphere (curvature transferred). */
export function solveSurfaceMatchG2({
  reference,
  target,
  refEdge = 'v1',
  tgtEdge = 'v0',
  samples = SURFACE_MATCH_G2_DEFAULT_SAMPLES,
}) {
  const refN = normaliseSurface(reference);
  if (!refN.ok) return { ok: false, reason: `reference: ${refN.reason}` };
  const tgtN = normaliseSurface(target);
  if (!tgtN.ok) return { ok: false, reason: `target: ${tgtN.reason}` };

  const refMeta = edgeMeta(refEdge, refN.n, refN.m);
  if (!refMeta.ok) return { ok: false, reason: `refEdge: ${refMeta.reason}` };
  const tgtMeta = edgeMeta(tgtEdge, tgtN.n, tgtN.m);
  if (!tgtMeta.ok) return { ok: false, reason: `tgtEdge: ${tgtMeta.reason}` };
  if (refMeta.boundaryDegree !== tgtMeta.boundaryDegree) {
    return {
      ok: false,
      reason: `boundary degree mismatch (ref ${refMeta.boundaryDegree} vs tgt ${tgtMeta.boundaryDegree})`,
    };
  }
  const m_r = refMeta.crossDegree;
  const m_t = tgtMeta.crossDegree;
  if (m_t < 2) {
    return {
      ok: false,
      reason: `target cross-degree must be ≥ 2 for G2 (got ${m_t})`,
    };
  }
  if (m_r < 2) {
    return {
      ok: false,
      reason: `reference cross-degree must be ≥ 2 for G2 (got ${m_r})`,
    };
  }

  // Capture "before" verification metrics so the UI can compare against.
  const beforeMetrics = verifyG2Match({
    reference, target,
    refEdge, tgtEdge, samples,
  });

  // Pull rows 0, 1, 2 OF THE REFERENCE'S CROSS-BOUNDARY DIRECTION at the
  // reference's edge. getEdgeRow returns the rows ordered from boundary
  // (k=0) to interior (k=2). For v0/u0 edges this aligns with the
  // surface's native parameter direction (the v-derivative formula
  // m·(P_{i,1}−P_{i,0}) reads "row1 − row0"). For v1/u1 edges the
  // surface's parameter increases AWAY from the boundary so the v-
  // derivative formula reads "row0 − row1" — i.e. the cross-derivative
  // points along the surface's outward boundary normal (toward the
  // "next" patch that continues beyond the seam). Two surfaces sharing
  // a boundary edge are G1 when the outward cross-derivative of the
  // reference equals the INWARD cross-derivative of the target, where
  // "inward" / "outward" are taken w.r.t. the surface's domain.
  //
  // To collapse both cases into a single formula we work in the "control
  // polygon" of the boundary curve plus its inward first/second
  // differences. Define for either surface:
  //   ΔR_{i,1} = (R_{i, k=0} − R_{i, k=1})  · sign_ref
  //   ΔR_{i,2} = (R_{i, k=0} − 2·R_{i, k=1} + R_{i, k=2})  (sign-invariant)
  // where sign_ref = +1 for v0/u0 (k indices ASCEND with v/u, so
  // R_{i,k=0} − R_{i,k=1} = −∂/∂v ascending control diff) wait no — let
  // me redo this cleanly below.
  //
  // CLEAN VERSION:
  //
  // For a "0" edge (v0 or u0), the cross-derivative at the boundary is
  //     d_cross(R) = m_r · (R_{i, 1} − R_{i, 0})
  // expressed in the surface's native parameter. getEdgeRow returns
  // R_{i,k=0} = R_{i,0} (boundary) and R_{i,k=1} = R_{i,1} (one step
  // inward). So d_cross = m_r · (rowK1 − rowK0).
  //
  // For a "1" edge (v1 or u1), the cross-derivative at the boundary is
  //     d_cross(R) = m_r · (R_{i, m} − R_{i, m-1})
  // getEdgeRow returns R_{i,k=0} = R_{i,m} (boundary) and R_{i,k=1} =
  // R_{i,m-1} (one step inward). So d_cross = m_r · (rowK0 − rowK1) —
  // OPPOSITE SIGN from the "0" edge case.
  //
  // The SECOND derivative is the same formula regardless of edge end:
  //   d²_cross(R) = m_r(m_r−1) · (R_{i,k=0} − 2·R_{i,k=1} + R_{i,k=2}) for "1" edges
  //   d²_cross(R) = m_r(m_r−1) · (R_{i,k=2} − 2·R_{i,k=1} + R_{i,k=0}) for "0" edges
  // these two are IDENTICAL because the formula is symmetric (it's just
  // R_{i,m-2} − 2·R_{i,m-1} + R_{i,m} for v1, R_{i,2} − 2·R_{i,1} + R_{i,0}
  // for v0 — same expression with the second differences).
  //
  // So we encode the sign for the FIRST-derivative pull:
  //
  //   refSign = (refEdge ends in '1') ? +1 : −1
  //   tgtSign = (tgtEdge ends in '1') ? +1 : −1
  //
  // d_cross(R) = m_r · refSign · (R_{k=0} − R_{k=1})
  // d_cross(T) needed = m_t · tgtSign · (T_{k=0} − T_{k=1})
  //
  // Set equal:
  //   m_t · tgtSign · (T_{k=0} − T_{k=1}) = m_r · refSign · (R_{k=0} − R_{k=1})
  //
  // With T_{k=0} = R_{k=0} (G0), solve for T_{k=1}:
  //   T_{k=1} = T_{k=0} − (m_r · refSign / (m_t · tgtSign))
  //             · (R_{k=0} − R_{k=1})
  //
  // For the second derivative (sign-invariant):
  //   d²_cross(R) = m_r(m_r−1) · (R_{k=0} − 2·R_{k=1} + R_{k=2})
  //   d²_cross(T) = m_t(m_t−1) · (T_{k=0} − 2·T_{k=1} + T_{k=2})
  // Equal them and back-solve T_{k=2}.
  const refRow0 = getEdgeRow(refN.P, refN.n, refN.m, refEdge, 0);
  const refRow1 = getEdgeRow(refN.P, refN.n, refN.m, refEdge, 1);
  const refRow2 = getEdgeRow(refN.P, refN.n, refN.m, refEdge, 2);

  const n_b = refMeta.boundaryDegree;
  const row0 = new Array(n_b + 1);
  const row1 = new Array(n_b + 1);
  const row2 = new Array(n_b + 1);

  const refSign = (refEdge === 'v1' || refEdge === 'u1') ? +1 : -1;
  const tgtSign = (tgtEdge === 'v1' || tgtEdge === 'u1') ? +1 : -1;
  const ratio1 = (m_r * refSign) / (m_t * tgtSign);
  const ratio2 = (m_r * (m_r - 1)) / (m_t * (m_t - 1));

  for (let i = 0; i <= n_b; i++) {
    const R0 = refRow0[i];
    const R1 = refRow1[i];
    const R2 = refRow2[i];
    // G0
    const P0 = [R0[0], R0[1], R0[2]];
    // G1: T_{k=1} = T_{k=0} − ratio1 · (R_{k=0} − R_{k=1})
    const d1 = [R0[0] - R1[0], R0[1] - R1[1], R0[2] - R1[2]];
    const P1 = [
      P0[0] - ratio1 * d1[0],
      P0[1] - ratio1 * d1[1],
      P0[2] - ratio1 * d1[2],
    ];
    // G2: T_{k=2} = 2·T_{k=1} − T_{k=0} + ratio2 · (R_{k=0} − 2·R_{k=1} + R_{k=2})
    //
    // Derivation: m_t(m_t−1) · (T_{k=0} − 2·T_{k=1} + T_{k=2})
    //           = m_r(m_r−1) · (R_{k=0} − 2·R_{k=1} + R_{k=2})
    //  → T_{k=2} = 2·T_{k=1} − T_{k=0} + ratio2 · second-diff(R)
    const d2 = [
      R0[0] - 2 * R1[0] + R2[0],
      R0[1] - 2 * R1[1] + R2[1],
      R0[2] - 2 * R1[2] + R2[2],
    ];
    const P2 = [
      2 * P1[0] - P0[0] + ratio2 * d2[0],
      2 * P1[1] - P0[1] + ratio2 * d2[1],
      2 * P1[2] - P0[2] + ratio2 * d2[2],
    ];
    row0[i] = P0;
    row1[i] = P1;
    row2[i] = P2;
  }

  // Write back the three solved rows to the target's edge.
  setEdgeRow(tgtN.P, tgtN.n, tgtN.m, tgtEdge, 0, row0);
  setEdgeRow(tgtN.P, tgtN.n, tgtN.m, tgtEdge, 1, row1);
  setEdgeRow(tgtN.P, tgtN.n, tgtN.m, tgtEdge, 2, row2);

  // Replace the target's control points in place so the caller's wrapper
  // surface object holds the edited control grid.
  target.controlPoints = tgtN.P;

  // Post-edit verification.
  const afterMetrics = verifyG2Match({
    reference, target,
    refEdge, tgtEdge, samples,
  });

  // Anchor parameters along the boundary curve (Greville-style equi-
  // spaced) — kept on the return record so the UI can label rows.
  const anchors = bezierAnchorParams(n_b);

  return {
    ok: true,
    n_boundary: n_b,
    m_target: m_t,
    m_reference: m_r,
    refEdge, tgtEdge,
    anchors,
    edited: { row0, row1, row2 },
    beforeMetrics,
    afterMetrics,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Verifier.
//
// Sample the boundary at `samples` evenly-spaced parameters, compute the
// per-sample geometric metrics (G0/G1/G2 + curvatures), and return the
// max + average of each.

export function verifyG2Match({
  reference, target, refEdge = 'v1', tgtEdge = 'v0',
  samples = SURFACE_MATCH_G2_DEFAULT_SAMPLES,
}) {
  const refN = normaliseSurface(reference);
  if (!refN.ok) return { ok: false, reason: `reference: ${refN.reason}` };
  const tgtN = normaliseSurface(target);
  if (!tgtN.ok) return { ok: false, reason: `target: ${tgtN.reason}` };
  const n = Math.max(2, Math.min(SURFACE_MATCH_G2_MAX_SAMPLES, samples | 0));
  const perSample = new Array(n);

  let sumPt = 0,  maxPt = 0;
  let sumNa = 0,  maxNa = 0;
  let sumTa = 0,  maxTa = 0;
  let sumTc = 0,  maxTc = 0;
  let sumMc = 0,  maxMc = 0;
  let sumGc = 0,  maxGc = 0;
  let sumK1 = 0,  maxK1 = 0;
  let sumK2 = 0,  maxK2 = 0;

  let validCount = 0;

  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const [uR, vR] = edgeParamToUv(refEdge, t);
    const [uT, vT] = edgeParamToUv(tgtEdge, t);
    const gR = surfaceLocalGeometry(refN.P, refN.n, refN.m, uR, vR);
    const gT = surfaceLocalGeometry(tgtN.P, tgtN.n, tgtN.m, uT, vT);

    const ptDist = v3Dist(gR.point, gT.point);

    // Boundary along-edge tangent. The reference's "along" direction
    // depends on its edge; for v0/v1 it's du, for u0/u1 it's dv. The
    // target's "along" depends on tgtEdge similarly. The two surfaces
    // share the same boundary parameter direction by construction, so
    // both along-tangents should agree up to magnitude.
    const alongR = (refEdge === 'v0' || refEdge === 'v1') ? gR.du : gR.dv;
    const alongT = (tgtEdge === 'v0' || tgtEdge === 'v1') ? gT.du : gT.dv;
    const crossR = edgeCrossDeriv(refN.P, refN.n, refN.m, refEdge, t);
    const crossT = edgeCrossDeriv(tgtN.P, tgtN.n, tgtN.m, tgtEdge, t);

    // Surface normals (un-oriented — Class-A convention).
    const normalDev = angleUnorientedDeg(gR.normal, gT.normal);
    // Boundary along-tangent (un-oriented).
    const tangentAlongDev = angleUnorientedDeg(alongR, alongT);
    // Cross-boundary tangent (un-oriented).
    const tangentCrossDev = angleUnorientedDeg(crossR, crossT);
    // Curvature deltas.
    const meanCurvDelta = Math.abs(gR.meanH - gT.meanH);
    const gaussCurvDelta = Math.abs(gR.gaussK - gT.gaussK);
    // Principal curvatures — k1 = max, k2 = min on each side.
    const princCurv1Delta = Math.abs(
      Math.max(gR.princK1, gR.princK2) - Math.max(gT.princK1, gT.princK2));
    const princCurv2Delta = Math.abs(
      Math.min(gR.princK1, gR.princK2) - Math.min(gT.princK1, gT.princK2));

    perSample[k] = {
      k, t,
      pointR: gR.point, pointT: gT.point,
      normalR: gR.normal, normalT: gT.normal,
      pointDistance:    ptDist,
      normalDeviation:  normalDev,
      tangentAlongDev,
      tangentCrossDev,
      meanCurvDelta,
      gaussCurvDelta,
      princCurv1Delta,
      princCurv2Delta,
      meanR: gR.meanH, meanT: gT.meanH,
      gaussR: gR.gaussK, gaussT: gT.gaussK,
    };

    if (!Number.isFinite(ptDist)) continue;
    validCount += 1;
    sumPt += ptDist; if (ptDist > maxPt) maxPt = ptDist;
    if (Number.isFinite(normalDev)) {
      sumNa += normalDev; if (normalDev > maxNa) maxNa = normalDev;
    }
    if (Number.isFinite(tangentAlongDev)) {
      sumTa += tangentAlongDev; if (tangentAlongDev > maxTa) maxTa = tangentAlongDev;
    }
    if (Number.isFinite(tangentCrossDev)) {
      sumTc += tangentCrossDev; if (tangentCrossDev > maxTc) maxTc = tangentCrossDev;
    }
    if (Number.isFinite(meanCurvDelta)) {
      sumMc += meanCurvDelta; if (meanCurvDelta > maxMc) maxMc = meanCurvDelta;
    }
    if (Number.isFinite(gaussCurvDelta)) {
      sumGc += gaussCurvDelta; if (gaussCurvDelta > maxGc) maxGc = gaussCurvDelta;
    }
    if (Number.isFinite(princCurv1Delta)) {
      sumK1 += princCurv1Delta; if (princCurv1Delta > maxK1) maxK1 = princCurv1Delta;
    }
    if (Number.isFinite(princCurv2Delta)) {
      sumK2 += princCurv2Delta; if (princCurv2Delta > maxK2) maxK2 = princCurv2Delta;
    }
  }

  const safeAvg = (s) => (validCount > 0 ? s / validCount : 0);
  return {
    ok: true,
    samples: n,
    validCount,
    perSample,
    g0Max:               maxPt,
    g0Avg:               safeAvg(sumPt),
    normalDevMaxDeg:     maxNa,
    normalDevAvgDeg:     safeAvg(sumNa),
    tangentAlongMaxDeg:  maxTa,
    tangentAlongAvgDeg:  safeAvg(sumTa),
    tangentCrossMaxDeg:  maxTc,
    tangentCrossAvgDeg:  safeAvg(sumTc),
    meanCurvMaxDelta:    maxMc,
    meanCurvAvgDelta:    safeAvg(sumMc),
    gaussCurvMaxDelta:   maxGc,
    gaussCurvAvgDelta:   safeAvg(sumGc),
    princCurv1MaxDelta:  maxK1,
    princCurv1AvgDelta:  safeAvg(sumK1),
    princCurv2MaxDelta:  maxK2,
    princCurv2AvgDelta:  safeAvg(sumK2),
    // Aggregate pass/fail per metric using the module thresholds. The
    // panel surfaces both raw numbers and these PASS/FAIL chips.
    g0Pass: maxPt < SURFACE_MATCH_G2_G0_THRESHOLD,
    g1Pass: maxNa < SURFACE_MATCH_G2_G1_THRESHOLD,
    g2Pass: Math.max(maxMc, maxK1, maxK2) < SURFACE_MATCH_G2_G2_THRESHOLD,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Convenience constructors used by the UI seed-buttons + the e2e.
//
// Every constructor returns the canonical `{ controlPoints }` shape the
// solver expects, with a u-degree of 3 and a v-degree of 3 (bicubic).
// These match the brief's reference patches:
//
//   * makeBicubicFlatPatch — a planar bicubic patch.
//   * makeBicubicSpherePatch — a bicubic approximation of a sphere
//     section (the standard 4×4 sphere patch).
//   * makeBicubicSaddlePatch — a saddle-shape patch (changing curvature
//     in u vs v).
//   * makeReferenceTargetPair — utility that picks a reference and a
//     target whose v=1 (ref) and v=0 (tgt) edges share a single boundary
//     curve. Useful for the e2e and the panel seed.

/** A flat planar bicubic patch in the X-Y plane, centred at (cx, cy, z),
 *  with the patch covering [cx−w/2..cx+w/2] in u and [cy−h/2..cy+h/2] in
 *  v. The 4×4 control grid sits at the corner+1/3+2/3+corner anchor
 *  parameter pattern of a degree-3 Bezier (standard). */
export function makeBicubicFlatPatch({
  cx = 0, cy = 0, z = 0, w = 100, h = 100,
} = {}) {
  const xs = [-0.5, -1/6, 1/6, 0.5].map((t) => cx + t * w);
  const ys = [-0.5, -1/6, 1/6, 0.5].map((t) => cy + t * h);
  const cp = new Array(4);
  for (let i = 0; i < 4; i++) {
    cp[i] = new Array(4);
    for (let j = 0; j < 4; j++) {
      cp[i][j] = [xs[i], ys[j], z];
    }
  }
  return { controlPoints: cp };
}

/** A bicubic "dome" patch — z = cz + R - sqrt(R² - x² - y²) over a
 *  (w × h) footprint, sampled at the 4×4 standard cubic-Bezier anchor
 *  parameter pattern. Real curvature in BOTH u and v (both principal
 *  curvatures are ≈ 1/R near the dome apex), so the verifier picks up
 *  non-zero mean + Gaussian curvature deltas vs a flat patch. */
export function makeBicubicSpherePatch({
  cx = 0, cy = 0, cz = 0, R = 100,
  w = 100, h = 100,
} = {}) {
  const us = [-0.5, -1/6, 1/6, 0.5];
  const vs = [-0.5, -1/6, 1/6, 0.5];
  const cp = new Array(4);
  for (let i = 0; i < 4; i++) {
    cp[i] = new Array(4);
    for (let j = 0; j < 4; j++) {
      const x = cx + us[i] * w;
      const y = cy + vs[j] * h;
      const r2 = x * x + y * y;
      const inside = R * R - r2;
      const dz = inside > 0 ? (R - Math.sqrt(inside)) : R;
      cp[i][j] = [x, y, cz + dz];
    }
  }
  return { controlPoints: cp };
}

/** A bicubic saddle patch — z = a·x² − b·y² over [-w/2..w/2] × [-h/2..h/2]. */
export function makeBicubicSaddlePatch({
  cx = 0, cy = 0, cz = 0, w = 100, h = 100, a = 0.01, b = 0.01,
} = {}) {
  const us = [-0.5, -1/6, 1/6, 0.5];
  const vs = [-0.5, -1/6, 1/6, 0.5];
  const cp = new Array(4);
  for (let i = 0; i < 4; i++) {
    cp[i] = new Array(4);
    for (let j = 0; j < 4; j++) {
      const x = cx + us[i] * w;
      const y = cy + vs[j] * h;
      const z = cz + a * x * x - b * y * y;
      cp[i][j] = [x, y, z];
    }
  }
  return { controlPoints: cp };
}

/** A "shared boundary" pair — a flat reference plus a flat target whose
 *  boundary edges share a common curve in 3D. The reference patch sits
 *  in z=0 covering x∈[-size..0], y∈[-size/2..size/2]; the target sits in
 *  z=0 covering x∈[0..size], y∈[-size/2..size/2]. They share the line
 *  x=0, y∈[-size/2..size/2] as a common boundary — ref's u=1 column and
 *  target's u=0 column. Both flat, so the join is C∞ (every continuity
 *  metric reads 0) — a useful "no-op solve" sanity check. */
export function makeFlatRefTargetPair({
  size = 100, z = 0,
} = {}) {
  const ref = makeBicubicFlatPatch({
    cx: -size / 2, cy: 0, z, w: size, h: size,
  });
  const tgt = makeBicubicFlatPatch({
    cx:  size / 2, cy: 0, z, w: size, h: size,
  });
  // Reference u=1 column = target u=0 column already (both at x=0,
  // y ∈ {-size/2, -size/6, size/6, size/2}, z=0). Verify by copy so the
  // pair is robust to anchor-pattern drift.
  for (let j = 0; j < 4; j++) {
    const Pi = ref.controlPoints[3][j];
    tgt.controlPoints[0][j] = [Pi[0], Pi[1], Pi[2]];
  }
  return { reference: ref, target: tgt, refEdge: 'u1', tgtEdge: 'u0' };
}

/** Reference = sphere dome patch, target = flat patch glued at boundary.
 *  This is the "ref = sphere, target = plane" case in the brief: pre-
 *  match the join is C0 but curvature jumps to ~0 across the seam; post
 *  G2-match the target picks up the sphere's curvature in the first
 *  three control rows. */
export function makeSphereFlatPair({
  R = 200,
  size = 100,
} = {}) {
  // Reference dome: centred at (-size/2, 0) covering [-size..0] in x.
  const ref = makeBicubicSpherePatch({
    cx: -size / 2, cy: 0, cz: 0, R, w: size, h: size,
  });
  // Target flat patch: centred at (size/2, 0) covering [0..size] in x.
  const target = makeBicubicFlatPatch({
    cx: size / 2, cy: 0, z: 0, w: size, h: size,
  });
  // Glue reference's u=1 edge (its right side) into target's u=0 edge
  // (its left side).
  for (let j = 0; j < 4; j++) {
    const Pi = ref.controlPoints[3][j];
    target.controlPoints[0][j] = [Pi[0], Pi[1], Pi[2]];
  }
  return { reference: ref, target, refEdge: 'u1', tgtEdge: 'u0' };
}

/** Two identical bicubic patches sharing a boundary (target = reference).
 *  The G2 solver should be the identity transform on the target's three
 *  control rows here. The e2e uses this to confirm "identity match is
 *  identity correction". */
export function makeIdentityPair({
  patch = null,
} = {}) {
  // Default: bicubic saddle to give the verifier real curvature
  // numbers to check.
  const baseRef = patch || makeBicubicSaddlePatch({ w: 100, h: 100, a: 0.005, b: 0.003 });
  // Deep clone for the target.
  const cloneSurface = (s) => ({
    controlPoints: s.controlPoints.map(
      (row) => row.map((p) => [p[0], p[1], p[2]])),
  });
  const ref = cloneSurface(baseRef);
  const tgt = cloneSurface(baseRef);
  // The target should match the reference at its OWN v=0 edge (since
  // the target IS the reference); use the same refEdge / tgtEdge so the
  // solver sees identical boundary samples.
  return { reference: ref, target: tgt, refEdge: 'v0', tgtEdge: 'v0' };
}

// ─────────────────────────────────────────────────────────────────────
// validateInputs — common sanity checks shared by panel + e2e for the
// "ref + target + edges" tuple. Returns { ok, reason }.

export function validateInputs({
  reference, target, refEdge, tgtEdge,
}) {
  const refN = normaliseSurface(reference);
  if (!refN.ok) return { ok: false, reason: `reference: ${refN.reason}` };
  const tgtN = normaliseSurface(target);
  if (!tgtN.ok) return { ok: false, reason: `target: ${tgtN.reason}` };
  const refMeta = edgeMeta(refEdge, refN.n, refN.m);
  if (!refMeta.ok) return { ok: false, reason: `refEdge: ${refMeta.reason}` };
  const tgtMeta = edgeMeta(tgtEdge, tgtN.n, tgtN.m);
  if (!tgtMeta.ok) return { ok: false, reason: `tgtEdge: ${tgtMeta.reason}` };
  if (refMeta.boundaryDegree !== tgtMeta.boundaryDegree) {
    return {
      ok: false,
      reason: `boundary degree mismatch (ref ${refMeta.boundaryDegree} vs tgt ${tgtMeta.boundaryDegree})`,
    };
  }
  if (tgtMeta.crossDegree < 2) {
    return {
      ok: false,
      reason: `target cross-degree must be ≥ 2 (got ${tgtMeta.crossDegree})`,
    };
  }
  return { ok: true, n: refN.n, m: refN.m, refMeta, tgtMeta };
}
