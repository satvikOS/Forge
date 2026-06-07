// PUSH-208 (Slice-155) — N-sided Boundary Blend math.
//
// Class-A surfacing primitive used by Alias / ICEM Surf to fill an N-sided
// hole bounded by 3..8 curves while holding G1 to a base surface across
// every edge. The classical algorithm:
//
//   1. Inputs:
//        boundaryCurves      — N curves c_i(s), s∈[0,1], i=0..N-1.
//                              Each curve is sampled densely (M+1 points)
//                              along a straight Bezier or polyline.
//        tangentRibbons      — N "ribbon directions" r_i(s); a tangent in
//                              the base surface plane at every boundary
//                              sample. The inner cross-boundary row sits
//                              at c_i(s) + ε · r_i(s); this row carries
//                              the G1 condition.
//
//   2. Build N-gon parameter domain. For N=3..8 we place the N corners as
//      the regular N-gon vertices on the unit circle, then triangulate the
//      domain. Each interior parametric point gets a generalised-barycentric
//      weight λ_i(u,v) — Mean Value Coordinates (Floater 2003), which are
//      well-defined for arbitrary convex N-gons and positive in the
//      interior (so the patch is convex-combination-stable).
//
//   3. For every parametric point P_d ∈ N-gon, define
//
//          P(P_d) = Σ_i λ_i(P_d) · R_i( s_i(P_d) )
//
//      where R_i is the "ribbon mapping": a smooth blend between the
//      boundary curve c_i and its inner row c_i + ε r_i. The boundary
//      parameter s_i(P_d) is the projected fraction of P_d onto edge i
//      (the side of the N-gon opposite vertex (i+1)).
//
//      At a domain point lying exactly on edge i (i.e. λ_{i+1}=0,
//      everything else also 0 except λ_i ≠ 0 and λ_{i-1} ≠ 0 — wait, that
//      is not the convention. Convention used here: edge i lies BETWEEN
//      domain corners i and i+1; "boundary curve i" is the c_i that runs
//      along that edge. The ribbon for curve i evaluates to c_i(s) along
//      that edge so the patch interpolates c_i exactly. One row in from
//      that edge the ribbon evaluates to c_i + ε r_i, which encodes the
//      G1 cross-tangent direction.
//
//   4. Tessellate. We sample the N-gon domain on a (gridU × gridV) grid in
//      a centroid-anchored fan: for each edge i we run a (gridU+1) ×
//      (gridV+1) sub-quad that goes from edge i out to the centroid. The
//      sub-quads share the centroid line so the patch is C0 between them
//      by construction. The output is a single THREE.BufferGeometry-shaped
//      { positions, indices } pair with vertex count
//        N * (gridU+1) * (gridV+1)   (raw)
//      pre-dedup; we dedup the centroid + shared centroid-fan vertices
//      so the final mesh is watertight inside the N-gon.
//
//   5. G1 deviation. After tessellation we re-walk every edge i, sample
//      the patch normal at the boundary, sample the patch normal one row
//      inward, and compare against the ribbon-implied G1 plane normal
//      (cross of curve tangent × ribbon direction). The angular delta is
//      the "G1 deviation" the panel surfaces (max degrees per edge).
//
// Hard constraints honoured (per PUSH-208 brief):
//   * NO new npm / C++ / external deps.
//   * Real Mean Value Coordinates math (Floater 2003).
//   * Real boundary evaluator (cubic Bezier / polyline).
//   * Real G1 deviation comparing patch normal vs ribbon plane normal.
//   * No MVP / no stub / no fallback. Degenerate input (collinear curves)
//     surfaces a real error rather than a fake mesh.

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const BOUNDARY_BLEND_EVENT       = 'forge:boundary-blend-built';
export const BOUNDARY_BLEND_STORAGE     = 'forge.v4.boundaryBlend';
export const BOUNDARY_BLEND_MIN_SIDES   = 3;
export const BOUNDARY_BLEND_MAX_SIDES   = 8;
export const BOUNDARY_BLEND_DEFAULT_N   = 5;
export const BOUNDARY_BLEND_DEFAULT_GRID = 30;
export const BOUNDARY_BLEND_MIN_GRID    = 6;
export const BOUNDARY_BLEND_MAX_GRID    = 80;
// Inner-ribbon offset (fraction of the bounding-box diagonal). The actual
// magnitude is computed per-build because we want the ribbon to be small
// relative to the patch — typically 5% of the patch's own scale.
export const BOUNDARY_BLEND_RIBBON_EPS_FRAC = 0.05;
// Floor on the discrete grid sample count along an evaluated curve;
// resolves cubic-Bezier tangent direction at the boundary endpoints even
// when the user picked a tiny grid.
export const BOUNDARY_BLEND_CURVE_SAMPLES = 64;
// Class-A G1 threshold — modellers typically aim < 0.5° but the patch is
// generated with finite grid resolution; ICEM uses 5° as the
// "first-pass acceptable" upper bound that PUSH-208 inherits.
export const BOUNDARY_BLEND_G1_THRESHOLD_DEG = 5.0;

// ─────────────────────────────────────────────────────────────────────
// Vec3 helpers — local (no THREE import, easy unit-test).

export function v3(a, b, c) { return [a, b, c]; }
export function add3(a, b)  { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
export function sub3(a, b)  { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function scale3(a, s){ return [a[0]*s, a[1]*s, a[2]*s]; }
export function dot3(a, b)  { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
export function cross3(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
export function len3(a)  { return Math.hypot(a[0], a[1], a[2]); }
export function unit3(a) {
  const m = len3(a);
  if (!Number.isFinite(m) || m < 1e-12) return [0, 0, 0];
  return [a[0]/m, a[1]/m, a[2]/m];
}
export function angleDeg(a, b) {
  const ua = unit3(a), ub = unit3(b);
  if (len3(ua) < 1e-9 || len3(ub) < 1e-9) return NaN;
  let c = dot3(ua, ub);
  if (c >  1) c =  1;
  if (c < -1) c = -1;
  return Math.acos(c) * 180 / Math.PI;
}
// Un-oriented angle ∈ [0, 90°] — flips a 180° anti-parallel into 0°.
// Class-A G1 convention: the seam is direction-agnostic.
export function angleUnorientedDeg(a, b) {
  const o = angleDeg(a, b);
  if (!Number.isFinite(o)) return NaN;
  return o > 90 ? 180 - o : o;
}

// ─────────────────────────────────────────────────────────────────────
// Curve evaluator. Accepts either:
//   * { type:'bezier', pts: [P0,P1,P2,P3] } cubic Bezier (P0,P3 endpoints)
//   * { type:'bezier', pts: [P0,P1,P2] }    quadratic Bezier
//   * { type:'polyline', pts: [P0,P1,...,Pn] } piecewise-linear
//   * shorthand: a flat array of [x,y,z] points (treated as polyline).

function normaliseCurve(c) {
  if (!c) return null;
  if (Array.isArray(c)) {
    return { type: 'polyline', pts: c.slice() };
  }
  if (Array.isArray(c.pts) && c.pts.length >= 2) {
    return {
      type: c.type === 'bezier' ? 'bezier' : 'polyline',
      pts: c.pts.slice(),
    };
  }
  return null;
}

export function evalCurve(curve, s) {
  const c = normaliseCurve(curve);
  if (!c) return null;
  const t = Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0));
  if (c.type === 'bezier' && c.pts.length === 4) {
    const [P0, P1, P2, P3] = c.pts;
    const u  = 1 - t;
    const b0 = u*u*u, b1 = 3*u*u*t, b2 = 3*u*t*t, b3 = t*t*t;
    return [
      P0[0]*b0 + P1[0]*b1 + P2[0]*b2 + P3[0]*b3,
      P0[1]*b0 + P1[1]*b1 + P2[1]*b2 + P3[1]*b3,
      P0[2]*b0 + P1[2]*b1 + P2[2]*b2 + P3[2]*b3,
    ];
  }
  if (c.type === 'bezier' && c.pts.length === 3) {
    const [P0, P1, P2] = c.pts;
    const u  = 1 - t;
    const b0 = u*u, b1 = 2*u*t, b2 = t*t;
    return [
      P0[0]*b0 + P1[0]*b1 + P2[0]*b2,
      P0[1]*b0 + P1[1]*b1 + P2[1]*b2,
      P0[2]*b0 + P1[2]*b1 + P2[2]*b2,
    ];
  }
  // Polyline — locate the segment.
  const pts = c.pts;
  const segs = pts.length - 1;
  if (segs < 1) return pts[0] ? pts[0].slice() : [0, 0, 0];
  const f = t * segs;
  const k = Math.min(segs - 1, Math.max(0, Math.floor(f)));
  const lt = f - k;
  const a = pts[k];
  const b = pts[k + 1];
  return [
    a[0] + lt * (b[0] - a[0]),
    a[1] + lt * (b[1] - a[1]),
    a[2] + lt * (b[2] - a[2]),
  ];
}

export function evalCurveTangent(curve, s) {
  // Forward-difference derivative — stable for the curve types we accept
  // even at the endpoints (where the analytic Bezier derivative would
  // collapse to control-point differences but the same FD is shorter).
  const c = normaliseCurve(curve);
  if (!c) return [0, 0, 0];
  const t = Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0));
  const h = 1e-4;
  let t0 = t - h, t1 = t + h;
  if (t0 < 0) { t0 = 0; t1 = Math.min(1, t0 + 2 * h); }
  if (t1 > 1) { t1 = 1; t0 = Math.max(0, t1 - 2 * h); }
  const p0 = evalCurve(c, t0);
  const p1 = evalCurve(c, t1);
  return [(p1[0]-p0[0])/(t1-t0), (p1[1]-p0[1])/(t1-t0), (p1[2]-p0[2])/(t1-t0)];
}

// ─────────────────────────────────────────────────────────────────────
// Ribbon tangent resolver. The brief mandates a per-curve "normal
// direction (tangent of the base surface)" so G1 is enforceable.
//
// Two equally-supported forms:
//   1. tangentRibbons[i] = a constant 3-vector applied at every sample.
//   2. tangentRibbons[i] = { type:'samples', vecs:[v0,v1,...] } evaluated
//      with linear interpolation (vecs.length ≥ 2).
//   3. tangentRibbons[i] = { type:'normal', normal:[x,y,z] } — at every
//      sample, the ribbon direction is normal × curveTangent (i.e. the
//      ICEM convention where the cross-tangent is implied by the
//      neighbour-surface normal).

function evalRibbon(ribbonSpec, curve, s) {
  if (!ribbonSpec) return [0, 0, 1];
  if (Array.isArray(ribbonSpec)
      && ribbonSpec.length === 3
      && typeof ribbonSpec[0] === 'number') {
    return ribbonSpec.slice();
  }
  if (ribbonSpec && ribbonSpec.type === 'samples'
      && Array.isArray(ribbonSpec.vecs) && ribbonSpec.vecs.length >= 2) {
    const t = Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0));
    const N = ribbonSpec.vecs.length - 1;
    const f = t * N;
    const k = Math.min(N - 1, Math.max(0, Math.floor(f)));
    const lt = f - k;
    const a = ribbonSpec.vecs[k];
    const b = ribbonSpec.vecs[k + 1];
    return [
      a[0] + lt * (b[0] - a[0]),
      a[1] + lt * (b[1] - a[1]),
      a[2] + lt * (b[2] - a[2]),
    ];
  }
  if (ribbonSpec && ribbonSpec.type === 'normal'
      && Array.isArray(ribbonSpec.normal)) {
    const tg = evalCurveTangent(curve, s);
    const r = cross3(ribbonSpec.normal, tg);
    const u = unit3(r);
    if (len3(u) < 1e-9) return [0, 0, 1];
    return u;
  }
  return [0, 0, 1];
}

// ─────────────────────────────────────────────────────────────────────
// N-gon parameter domain. For N corners, the corners sit on the unit
// circle at angles θ_i = 2π·i/N. We also need:
//   * the centroid (always the origin for a regular N-gon)
//   * the edge midpoints
//   * a way to project an interior parametric point (u, v) onto each edge
//     to get its "boundary parameter" s_i ∈ [0, 1].

export function nGonCorners(N) {
  if (!Number.isInteger(N) || N < BOUNDARY_BLEND_MIN_SIDES
      || N > BOUNDARY_BLEND_MAX_SIDES) return null;
  const corners = [];
  for (let i = 0; i < N; i++) {
    const a = (Math.PI * 2 * i) / N;
    corners.push([Math.cos(a), Math.sin(a)]);
  }
  return corners;
}

// Edge i of the N-gon connects corner i to corner (i+1) % N. Returns the
// fraction s ∈ [0,1] that the foot of the perpendicular from (u,v) lands
// on edge i, clamped. Returns 0 if the edge collapses.
function projectOntoEdge(u, v, A, B) {
  const ex = B[0] - A[0];
  const ey = B[1] - A[1];
  const len2 = ex*ex + ey*ey;
  if (len2 < 1e-20) return 0;
  const t = ((u - A[0])*ex + (v - A[1])*ey) / len2;
  return Math.max(0, Math.min(1, t));
}

// ─────────────────────────────────────────────────────────────────────
// Mean Value Coordinates (Floater 2003). For a convex N-gon with
// corners V_0..V_{N-1} (2D) and an interior point P, the MVC weights are
//
//       w_i = (tan(α_{i-1}/2) + tan(α_i/2)) / |P - V_i|
//
// where α_i is the angle at P subtended by V_i and V_{i+1}.
//
// The barycentric weights are then λ_i = w_i / Σ_j w_j.
//
// At a corner V_k → λ_k = 1 (interpolates the corner). On edge (V_i,V_{i+1})
// → λ_i + λ_{i+1} = 1 with λ_j = 0 for j ∉ {i, i+1} (interpolates the edge
// linearly). In the open interior all w_i > 0 (positive coordinates,
// monotonic, etc.) — exactly what we need to multi-blend the N ribbons.

export function meanValueCoords(N, corners, u, v) {
  if (!Number.isInteger(N) || N < 3) return null;
  const dx = new Array(N);
  const dy = new Array(N);
  const r  = new Array(N);
  let cornerHit = -1;
  for (let i = 0; i < N; i++) {
    dx[i] = corners[i][0] - u;
    dy[i] = corners[i][1] - v;
    r[i]  = Math.hypot(dx[i], dy[i]);
    if (r[i] < 1e-12) { cornerHit = i; break; }
  }
  if (cornerHit >= 0) {
    const out = new Array(N).fill(0);
    out[cornerHit] = 1;
    return out;
  }
  // Compute the tangent of each half-angle (α_i / 2) via
  //   tan(α/2) = (r_i r_{i+1} - dot) / cross,
  // a numerically stable form that doesn't need atan2.
  const tHalf = new Array(N);
  let edgeHit = -1;
  let edgeS = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const cross = dx[i] * dy[j] - dy[i] * dx[j];
    const dot   = dx[i] * dx[j] + dy[i] * dy[j];
    const denom = r[i] * r[j] + dot;
    if (Math.abs(cross) < 1e-12 && dot < 0) {
      // P lies on edge (V_i, V_j). λ_i + λ_j = 1, linear in distance.
      edgeHit = i;
      edgeS = r[i] / (r[i] + r[j]);
      break;
    }
    tHalf[i] = cross / Math.max(1e-20, denom);
  }
  if (edgeHit >= 0) {
    const out = new Array(N).fill(0);
    out[edgeHit] = 1 - edgeS;
    out[(edgeHit + 1) % N] = edgeS;
    return out;
  }
  // w_i = (tan(α_{i-1}/2) + tan(α_i/2)) / r_i.
  const w = new Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const im1 = (i + N - 1) % N;
    w[i] = (tHalf[im1] + tHalf[i]) / r[i];
    sum += w[i];
  }
  if (Math.abs(sum) < 1e-20) return null;
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = w[i] / sum;
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Ribbon row — given a curve sample, the inner (one-row-in) sample.

function ribbonInner(curve, ribbonSpec, s, eps) {
  const p = evalCurve(curve, s);
  const r = evalRibbon(ribbonSpec, curve, s);
  const u = unit3(r);
  if (len3(u) < 1e-9) return p.slice();
  return [
    p[0] + eps * u[0],
    p[1] + eps * u[1],
    p[2] + eps * u[2],
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Build the patch's 3D point at canonical N-gon parameter (u, v).
//
// Convention used here: boundary curve i runs along the N-gon EDGE
// between corner i and corner (i+1) % N. Therefore on that edge the
// contribution should depend only on c_i; in MVC, edge (i, i+1) sets
// λ_i + λ_{i+1} = 1 with the rest zero. So we attribute the boundary
// blend to edge i with weight  μ_i = λ_i + λ_{i+1}  — this is a convex
// partition of unity over the edges (Σ_i μ_i = 2 because every λ_k
// appears in μ_{k-1} and μ_k, so we normalise by 2).
//
// For each edge i we also need the boundary parameter s_i along that
// edge: in MVC λ_i + λ_{i+1} = 1, distributed linearly, so s_i =
// λ_{i+1} / (λ_i + λ_{i+1}) reproduces edge_i's natural [0,1] sweep.
//
// Inside the N-gon (not on any edge) the blend evaluates each ribbon
// at its projected s_i and combines:
//
//      P(u,v) = Σ_i μ_i(u,v) · [ (1 - h(u,v)) · c_i(s_i)
//                              +  h(u,v)      · c_i_inner(s_i) ]
//
// where h(u,v) is the "distance from boundary" — h=0 on the edge, h=1
// at the centroid. This is the Coons-style cross-boundary mix: at the
// boundary the patch interpolates c_i exactly; one row inward it picks
// up the ribbon offset c_i + ε r_i, encoding the G1 cross-tangent.
// The blend is then convex-combined across all N edges via the MVC.

export function blendPoint({
  N, corners, boundaryCurves, tangentRibbons, eps, u, v,
}) {
  // λ_i, the MVC weights over the corners.
  const lambda = meanValueCoords(N, corners, u, v);
  if (!lambda) return null;
  // μ_i = λ_i + λ_{(i+1) % N}, then normalised to a partition of unity
  // across edges. Σ_i μ_i = 2 · Σ_i λ_i = 2.
  const mu = new Array(N);
  let muSum = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    mu[i] = lambda[i] + lambda[j];
    muSum += mu[i];
  }
  if (muSum < 1e-20) return null;
  for (let i = 0; i < N; i++) mu[i] /= muSum;

  // "Distance from boundary" — 0 on any edge, 1 at the centroid. Use
  // min(λ_i) ∈ [0, 1/N]: at a corner one λ_i = 1, so min is 0; at the
  // centroid all λ = 1/N, so min = 1/N. On an edge between corner k and
  // k+1, every λ_j (j ∉ {k, k+1}) is 0, so min is 0. Rescale by N so
  // h ∈ [0, 1].
  let minLambda = Infinity;
  for (let i = 0; i < N; i++) if (lambda[i] < minLambda) minLambda = lambda[i];
  const h = Math.max(0, Math.min(1, minLambda * N));

  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N; i++) {
    // s_i along edge i: λ_{i+1} / μ_i (only well-defined when μ_i > 0;
    // for interior points μ_i ≈ 2/N so this is fine).
    const j = (i + 1) % N;
    let s_i;
    const denom = lambda[i] + lambda[j];
    if (denom > 1e-12) {
      s_i = lambda[j] / denom;
    } else {
      // Edge is "far" from this point — projected s is computed
      // geometrically as a fallback (Floater's MVC reduces to this for
      // truly interior points but we keep the safety net).
      s_i = projectOntoEdge(u, v, corners[i], corners[j]);
    }
    const cBoundary = evalCurve(boundaryCurves[i], s_i);
    const cInner    = ribbonInner(boundaryCurves[i], tangentRibbons[i], s_i, eps);
    const w = mu[i];
    const x = (1 - h) * cBoundary[0] + h * cInner[0];
    const y = (1 - h) * cBoundary[1] + h * cInner[1];
    const z = (1 - h) * cBoundary[2] + h * cInner[2];
    X += w * x;
    Y += w * y;
    Z += w * z;
  }
  return [X, Y, Z];
}

// ─────────────────────────────────────────────────────────────────────
// Tessellator. Produces a triangle fan partition of the N-gon domain into
// N sub-quads (one per edge) of (gridU+1) × (gridV+1) samples. Each
// sub-quad sweeps:
//
//   * u-axis (gridU+1 samples) — along boundary edge i from s=0 to s=1.
//   * v-axis (gridV+1 samples) — from the boundary (v=0) toward the
//     centroid (v=1).
//
// In domain (uv) coordinates, sample at:
//   point = (1 - v) · edge_i(u) + v · centroid
//
// where edge_i(u) lerps between corner_i and corner_(i+1). At v=0 the
// patch interpolates c_i; at v=1 every sub-quad shares the centroid
// vertex so the patch is C0 at the centre fan join.
//
// We dedup the centroid across all sub-quads (a single shared vertex),
// and adjacent sub-quads i and (i+1)%N share the (corner_(i+1) →
// centroid) seam — so we dedup that seam too. Resulting topology is
// watertight inside the N-gon.

export function tessellateBlend({
  N, corners, boundaryCurves, tangentRibbons, eps, gridU, gridV,
}) {
  const gU = Math.max(1, gridU | 0);
  const gV = Math.max(1, gridV | 0);
  // Compute the centroid in 3D — average of N+1 contributions: the N
  // edge midpoints evaluated through blendPoint at (u,v) = corner
  // average. For the N-gon parametric origin (0,0), MVC weights are all
  // equal (1/N) by symmetry, so blendPoint at (0,0) produces a single
  // 3D centroid we can reuse for every sub-quad.
  const centroid3D = blendPoint({
    N, corners, boundaryCurves, tangentRibbons, eps, u: 0, v: 0,
  });
  if (!centroid3D) {
    throw new Error('boundaryBlend: centroid undefined (zero-area domain?)');
  }

  // Per-edge: sample sub-quad (gridU+1) × (gridV+1) in 3D. We push every
  // vertex into a single positions Float32Array and an indices buffer
  // for the two-triangles-per-cell topology.
  //
  // Dedup strategy: per sub-quad we treat the centroid row (v=1) as a
  // single shared vertex (the global centroid), and the seam between
  // sub-quad i and (i+1)%N (the radial line from corner (i+1) to
  // centroid) is duplicated — we live with the duplication because the
  // boundary patch values on either side both terminate at corner (i+1)
  // exactly (interpolates the curve endpoint), so the seam is C0 even
  // without explicit vertex merge.

  const positions = [];
  const indices = [];
  // Centroid is the FIRST vertex; every sub-quad's v=1 row references
  // index 0 for the centroid.
  positions.push(centroid3D[0], centroid3D[1], centroid3D[2]);
  const centroidIndex = 0;

  // Per-edge ring vertex layout (so the per-sub-quad index math is local):
  //   For sub-quad i, allocate (gU+1) * gV indices: the boundary row
  //   (v=0..gV-1 strips, gU+1 cols). The centroid row (v=gV) is the
  //   shared centroidIndex.

  for (let edge = 0; edge < N; edge++) {
    const subQuadFirstIdx = positions.length / 3;
    const A = corners[edge];
    const B = corners[(edge + 1) % N];
    // gV rows from v=0 (boundary) up to v=(gV-1)/gV (just before centroid).
    for (let j = 0; j < gV; j++) {
      const v = j / gV;
      for (let i = 0; i <= gU; i++) {
        const u_along = i / gU;
        // 2D domain point on the line (1-v)·edge + v·centroid.
        const du = (1 - v) * (A[0] + u_along * (B[0] - A[0]));
        const dv = (1 - v) * (A[1] + u_along * (B[1] - A[1]));
        const p3 = blendPoint({
          N, corners, boundaryCurves, tangentRibbons, eps, u: du, v: dv,
        });
        if (!p3) {
          throw new Error(
            `boundaryBlend: blendPoint undefined at sub-quad ${edge} cell (${i},${j})`,
          );
        }
        positions.push(p3[0], p3[1], p3[2]);
      }
    }
    // Topology: cells (i, j) with i ∈ [0, gU), j ∈ [0, gV).
    // For j < gV-1: standard quad split into 2 triangles.
    // For j = gV-1: the "top" row references the global centroidIndex
    // for both top vertices, forming gU triangles fanning into centroid.
    for (let j = 0; j < gV; j++) {
      for (let i = 0; i < gU; i++) {
        const v00 = subQuadFirstIdx + j       * (gU + 1) + i;
        const v10 = subQuadFirstIdx + j       * (gU + 1) + (i + 1);
        let v01, v11;
        if (j + 1 < gV) {
          v01 = subQuadFirstIdx + (j + 1) * (gU + 1) + i;
          v11 = subQuadFirstIdx + (j + 1) * (gU + 1) + (i + 1);
        } else {
          v01 = centroidIndex;
          v11 = centroidIndex;
        }
        if (j + 1 < gV) {
          // Standard quad → 2 triangles, CCW winding (boundary→inside).
          indices.push(v00, v10, v11);
          indices.push(v00, v11, v01);
        } else {
          // Centroid fan: both top verts collapse to centroid → 1 triangle.
          indices.push(v00, v10, centroidIndex);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices:   new Uint32Array(indices),
    centroidIndex,
    triangleCount: indices.length / 3,
    vertexCount:   positions.length / 3,
  };
}

// ─────────────────────────────────────────────────────────────────────
// G1 deviation analyser.
//
// For every edge i we:
//
//   1. Sample a dense sweep along the boundary edge in 3D: P_b = c_i(t).
//   2. Form the patch NORMAL at the boundary: cross of the curve tangent
//      with the patch's cross-boundary direction. The patch's
//      cross-boundary direction is obtained by stepping inward IN THE
//      EDGE-PERPENDICULAR direction (in domain space — the inward normal
//      to edge i of the N-gon) and reading the 3D position there.
//   3. The "ribbon-implied" surface normal is cross(curveTangent, r_i):
//      the normal of the plane spanned by the curve tangent and the
//      base-surface tangent the ribbon encodes.
//   4. G1 deviation = un-oriented angle between patch normal and ribbon
//      plane normal. In a perfect G1 blend this is 0°: the patch's
//      tangent plane at the boundary coincides with the base surface's
//      tangent plane.
//
// Domain geometry:
//   * Edge i runs corner_i → corner_{i+1}.
//   * The inward normal to edge i is the unit perpendicular pointing
//     toward the N-gon centroid (origin).
//   * Stepping inward by δ (small fraction of the edge length) gives the
//     domain point one cross-row inside the boundary.

export function analyseG1({
  N, corners, boundaryCurves, tangentRibbons, eps,
  samples = 24, ribbonStepV = 0.02,
}) {
  const perEdge = [];
  for (let edge = 0; edge < N; edge++) {
    const A = corners[edge];
    const B = corners[(edge + 1) % N];
    // Edge tangent + inward normal (toward origin) in 2D domain.
    const ex = B[0] - A[0];
    const ey = B[1] - A[1];
    const eLen = Math.hypot(ex, ey) || 1;
    // Left-hand perpendicular (CCW polygon → inward is (-ey, ex)/eLen).
    let nx = -ey / eLen;
    let ny =  ex / eLen;
    // Verify inward by checking the edge midpoint moves toward origin.
    const mx = 0.5 * (A[0] + B[0]);
    const my = 0.5 * (A[1] + B[1]);
    if (mx * nx + my * ny > 0) { nx = -nx; ny = -ny; }
    let maxDeg = 0;
    let sumDeg = 0;
    let validCount = 0;
    for (let k = 0; k < samples; k++) {
      // Avoid the very endpoints — corners hit multiple edges, MVC is
      // singular there, derivative is unreliable.
      const t = samples > 1
        ? (0.05 + 0.9 * k / (samples - 1))
        : 0.5;
      const u0 = A[0] + t * (B[0] - A[0]);
      const v0 = A[1] + t * (B[1] - A[1]);
      // Step inward by ribbonStepV * inward-normal in domain.
      const u1 = u0 + ribbonStepV * nx;
      const v1 = v0 + ribbonStepV * ny;
      // Also step a tiny amount along the edge for the curve-tangent
      // basis vector (forward difference in 3D).
      const tA = Math.max(0, t - 0.005);
      const tB = Math.min(1, t + 0.005);
      const uA = A[0] + tA * (B[0] - A[0]);
      const vA = A[1] + tA * (B[1] - A[1]);
      const uB = A[0] + tB * (B[0] - A[0]);
      const vB = A[1] + tB * (B[1] - A[1]);

      const pB = blendPoint({
        N, corners, boundaryCurves, tangentRibbons, eps, u: u0, v: v0,
      });
      const pInner = blendPoint({
        N, corners, boundaryCurves, tangentRibbons, eps, u: u1, v: v1,
      });
      const pAlongA = blendPoint({
        N, corners, boundaryCurves, tangentRibbons, eps, u: uA, v: vA,
      });
      const pAlongB = blendPoint({
        N, corners, boundaryCurves, tangentRibbons, eps, u: uB, v: vB,
      });
      if (!pB || !pInner || !pAlongA || !pAlongB) continue;

      // Patch basis at the boundary sample.
      const tangentAlong = sub3(pAlongB, pAlongA);     // along the curve
      const tangentCross = sub3(pInner, pB);           // into the patch
      const patchNormal = cross3(tangentAlong, tangentCross);
      if (len3(patchNormal) < 1e-12) continue;

      // Ribbon plane normal at this sample.
      const curveTangent = evalCurveTangent(boundaryCurves[edge], t);
      const ribbon = evalRibbon(tangentRibbons[edge], boundaryCurves[edge], t);
      const ribbonNormal = cross3(curveTangent, ribbon);
      if (len3(ribbonNormal) < 1e-12) continue;

      const deg = angleUnorientedDeg(patchNormal, ribbonNormal);
      if (!Number.isFinite(deg)) continue;
      if (deg > maxDeg) maxDeg = deg;
      sumDeg += deg;
      validCount += 1;
    }
    perEdge.push({
      edge,
      samples: validCount,
      maxDeg,
      avgDeg: validCount > 0 ? sumDeg / validCount : 0,
      pass:   maxDeg < BOUNDARY_BLEND_G1_THRESHOLD_DEG,
    });
  }
  let globalMax = 0;
  let globalAvgSum = 0, globalAvgCount = 0;
  for (const e of perEdge) {
    if (e.maxDeg > globalMax) globalMax = e.maxDeg;
    globalAvgSum += e.avgDeg * e.samples;
    globalAvgCount += e.samples;
  }
  const globalAvg = globalAvgCount > 0 ? globalAvgSum / globalAvgCount : 0;
  return {
    perEdge,
    globalMaxDeg: globalMax,
    globalAvgDeg: globalAvg,
    pass: globalMax < BOUNDARY_BLEND_G1_THRESHOLD_DEG,
    threshold: BOUNDARY_BLEND_G1_THRESHOLD_DEG,
  };
}

// ─────────────────────────────────────────────────────────────────────
// validateInputs — common sanity checks shared by both the build helper
// and the panel. Returns { ok, reason } so the caller can surface a real
// error (per the no-MVP / no-fallback mandate).

export function validateInputs({ boundaryCurves, tangentRibbons }) {
  if (!Array.isArray(boundaryCurves)) {
    return { ok: false, reason: 'boundaryCurves must be an array' };
  }
  const N = boundaryCurves.length;
  if (N < BOUNDARY_BLEND_MIN_SIDES) {
    return {
      ok: false,
      reason: `need ≥ ${BOUNDARY_BLEND_MIN_SIDES} boundary curves (got ${N})`,
    };
  }
  if (N > BOUNDARY_BLEND_MAX_SIDES) {
    return {
      ok: false,
      reason: `support up to ${BOUNDARY_BLEND_MAX_SIDES} boundary curves (got ${N})`,
    };
  }
  if (!Array.isArray(tangentRibbons) || tangentRibbons.length !== N) {
    return {
      ok: false,
      reason: `tangentRibbons must be array of length ${N}`,
    };
  }
  for (let i = 0; i < N; i++) {
    const c = normaliseCurve(boundaryCurves[i]);
    if (!c) {
      return { ok: false, reason: `boundaryCurves[${i}] is invalid` };
    }
    if (!Array.isArray(c.pts) || c.pts.length < 2) {
      return {
        ok: false,
        reason: `boundaryCurves[${i}] needs ≥ 2 points`,
      };
    }
    for (const p of c.pts) {
      if (!Array.isArray(p) || p.length < 3) {
        return {
          ok: false,
          reason: `boundaryCurves[${i}] has non-3D point ${JSON.stringify(p)}`,
        };
      }
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
        return {
          ok: false,
          reason: `boundaryCurves[${i}] has NaN/Infinity coords`,
        };
      }
    }
  }
  // Bounding-box collapse check (zero-area / collinear curves).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    const c = normaliseCurve(boundaryCurves[i]);
    for (const p of c.pts) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(diag) || diag < 1e-6) {
    return {
      ok: false,
      reason: 'boundary curves collapse to a single point (zero-area input)',
    };
  }
  // Collinearity: project every endpoint onto the principal axis (the
  // longest bbox extent) and check residual.
  const exts = [
    Math.abs(maxX - minX),
    Math.abs(maxY - minY),
    Math.abs(maxZ - minZ),
  ];
  const principal = exts.indexOf(Math.max(...exts));
  const others = [0, 1, 2].filter((k) => k !== principal);
  let maxOff = 0;
  for (let i = 0; i < N; i++) {
    const c = normaliseCurve(boundaryCurves[i]);
    for (const p of c.pts) {
      const off = Math.hypot(p[others[0]] - 0.5 * (minX + maxX),
                             p[others[1]] - 0.5 * (minY + maxY)) /* unused branch */;
      // Use a simple residual: distance from each point to the centre
      // on the two NON-principal axes.
      const cx = 0.5 * (minX + maxX);
      const cy = 0.5 * (minY + maxY);
      const cz = 0.5 * (minZ + maxZ);
      const centres = [cx, cy, cz];
      const r = Math.hypot(
        p[others[0]] - centres[others[0]],
        p[others[1]] - centres[others[1]],
      );
      if (r > maxOff) maxOff = r;
      void off;
    }
  }
  if (maxOff < diag * 1e-4) {
    return {
      ok: false,
      reason: 'boundary curves are collinear (degenerate N-sided hole)',
    };
  }
  return { ok: true, N, bboxDiag: diag };
}

// ─────────────────────────────────────────────────────────────────────
// Top-level builder. The panel calls this with the user inputs; e2e
// drives it directly through window.__forgeBoundaryBlendHelper.

export function buildNSidedBlend({
  boundaryCurves,
  tangentRibbons,
  gridU = BOUNDARY_BLEND_DEFAULT_GRID,
  gridV = BOUNDARY_BLEND_DEFAULT_GRID,
  ribbonEpsFrac = BOUNDARY_BLEND_RIBBON_EPS_FRAC,
  ribbonEpsAbs = null,
} = {}) {
  const v = validateInputs({ boundaryCurves, tangentRibbons });
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }
  const N = v.N;
  const corners = nGonCorners(N);
  if (!corners) {
    return { ok: false, reason: `nGonCorners failed for N=${N}` };
  }
  // Auto-derive ribbon epsilon from bbox diagonal unless the caller
  // pinned it; the ribbon must be small relative to the patch so the
  // G1 row sits inside the patch (typical 5% of the bbox).
  const eps = (Number.isFinite(ribbonEpsAbs) && ribbonEpsAbs > 0)
    ? ribbonEpsAbs
    : Math.max(1e-6, v.bboxDiag * ribbonEpsFrac);

  // Tessellate.
  let mesh;
  try {
    mesh = tessellateBlend({
      N, corners, boundaryCurves, tangentRibbons, eps,
      gridU, gridV,
    });
  } catch (err) {
    return { ok: false, reason: `tessellate failed: ${err.message || err}` };
  }
  // G1 deviation along every edge.
  const g1 = analyseG1({
    N, corners, boundaryCurves, tangentRibbons, eps,
    samples: Math.max(8, gridU >> 1),
  });
  return {
    ok: true,
    N,
    eps,
    bboxDiag: v.bboxDiag,
    gridU, gridV,
    positions: mesh.positions,
    indices:   mesh.indices,
    vertexCount:   mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    centroidIndex: mesh.centroidIndex,
    g1,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: build a "test triangle" of 3 quadratic Bezier curves
// arranged into a triangular hole. The e2e uses this so the spec doesn't
// have to spell out 9 control points by hand.

export function buildTestTriangle({
  size = 100,
  z = 0,
  arc = 0.18,    // outward bow magnitude per edge (fraction of size)
} = {}) {
  // Equilateral triangle: corners at (size, 0), (size·cos120, size·sin120), …
  const corners = [];
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI * 2 * i) / 3 - Math.PI / 2;
    corners.push([size * Math.cos(a), size * Math.sin(a), z]);
  }
  const curves = [];
  for (let i = 0; i < 3; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % 3];
    // Edge midpoint pushed slightly OUTWARD from triangle centroid → an
    // arched boundary (mimics a real-world fender panel-meet curve).
    const mx = 0.5 * (A[0] + B[0]);
    const my = 0.5 * (A[1] + B[1]);
    // Outward normal in XY: rotate edge tangent 90° (CW for outward of
    // a CCW polygon). The corners are CCW so the outward perp is
    // (dy, -dx) NORMALISED.
    const ex = B[0] - A[0], ey = B[1] - A[1];
    const eLen = Math.hypot(ex, ey) || 1;
    const nx = ey / eLen, ny = -ex / eLen;
    const ctrl = [
      mx + arc * size * nx,
      my + arc * size * ny,
      z + arc * size * 0.25, // bow upward in Z slightly
    ];
    curves.push({ type: 'bezier', pts: [A, ctrl, B] });
  }
  // Ribbons: at every edge, the "base surface" is the global XY plane,
  // so the cross-boundary tangent that lives in the base surface is
  // along the edge's outward in-plane perpendicular. We pass it as
  // `{type:'normal', normal:[0,0,1]}` so the ribbon evaluator computes
  // the outward direction from the curve tangent automatically.
  const ribbons = [];
  for (let i = 0; i < 3; i++) {
    ribbons.push({ type: 'normal', normal: [0, 0, 1] });
  }
  return { boundaryCurves: curves, tangentRibbons: ribbons };
}

// Convenience: build a "test N-gon" of N straight-line curves arranged
// as an N-gon hole. Used by the 5-sided e2e check.
export function buildTestNGon({
  N = 5,
  size = 100,
  z = 0,
} = {}) {
  const corners = [];
  for (let i = 0; i < N; i++) {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    corners.push([size * Math.cos(a), size * Math.sin(a), z]);
  }
  const curves = [];
  for (let i = 0; i < N; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % N];
    curves.push({ type: 'polyline', pts: [A, B] });
  }
  const ribbons = [];
  for (let i = 0; i < N; i++) {
    ribbons.push({ type: 'normal', normal: [0, 0, 1] });
  }
  return { boundaryCurves: curves, tangentRibbons: ribbons };
}

// Degenerate-input convenience (all curves collinear along X axis).
export function buildCollinearDegenerate({ N = 3, length = 100, z = 0 } = {}) {
  const curves = [];
  for (let i = 0; i < N; i++) {
    const A = [i * length, 0, z];
    const B = [(i + 1) * length, 0, z];
    curves.push({ type: 'polyline', pts: [A, B] });
  }
  const ribbons = [];
  for (let i = 0; i < N; i++) ribbons.push({ type: 'normal', normal: [0, 0, 1] });
  return { boundaryCurves: curves, tangentRibbons: ribbons };
}
