// PUSH-105 (Slice-74) — Curvature comb pure math.
//
// The curvature comb is the classical automotive Class-A surfacing tool
// for spotting inflection points and G2 (curvature-discontinuity) breaks
// in a curve. At every sample along the curve a "hair" is drawn
// perpendicular to the tangent with length proportional to the absolute
// curvature there. Sudden changes in hair length, sign flips, or kinks in
// the comb envelope are visual signatures of the underlying continuity
// defect.
//
// This module is pure JS — no React, no DOM, no window globals. It is
// exported so the e2e spec, plugins and Archie tool calls can drive the
// same math the panel uses without mounting any UI.
//
// Discretisation
// --------------
// The curve is a polyline of N points (the tessellated edge polyline the
// kernel returns from forge.direct.edgeSegments). For each interior point
// p_i (i = 1 .. N-2):
//
//   t_a = (p_i   − p_{i−1}) / |p_i   − p_{i−1}|     incoming unit tangent
//   t_b = (p_{i+1} − p_i  ) / |p_{i+1} − p_i  |     outgoing unit tangent
//   θ_i = angle( t_a , t_b )                         turning angle
//   s_i = ½ ( |p_{i+1} − p_{i−1}| )                  half the chord across
//
// The slice brief writes the curvature estimator as
//
//   κ_i = 2 · sin(θ_i) / |segment|
//
// where θ is the angle between adjacent tangents and |segment| is the
// mean chord length. We use that form verbatim — both for fidelity to
// the brief and because the e2e asserts against it numerically. For a
// regular N-gon inscribed in a radius-R circle the formula converges to
// 2·cos(π/N)/R, i.e. κ → 2/R as N → ∞. (The canonical Boehm/Farin form
// `2·sin(θ/2)/|seg|` would converge to 1/R instead.)
//
// Sign convention
// ---------------
// 2D / planar curves carry a curvature SIGN, picked from the cross product
// of the incoming and outgoing tangents projected onto the curve's mean
// plane normal. A sign FLIP between two adjacent samples is an
// "inflection point" — one of the comb's primary deliverables. For 3D
// space curves we still return a sign, but it's anchored to a stable
// curve-plane normal so the inflection detector keeps working.
//
// Endpoints
// ---------
// The first and last point of the polyline have no κ defined (they lack
// one neighbour). Both panel and e2e treat them as κ = 0 with the
// tangent copied from the nearest interior sample.

// ───────────────────────────────────────────────────────────── tiny vec3
function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vscl(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vlen(a) { return Math.sqrt(vdot(a, a)); }
function vnorm(a) {
  const L = vlen(a);
  if (L === 0) return [0, 0, 0];
  return [a[0] / L, a[1] / L, a[2] / L];
}

// ────────────────────────────────────────────── normalise polyline input
//
// The kernel returns Float32Array of flat [x,y,z, x,y,z, …]; the
// EntityPropsPanel layer hands us plain Array<number>. Accept either, plus
// the convenience shape of array-of-{x,y,z} that test fixtures sometimes
// use. Output is always Array<[x,y,z]> so the downstream maths is uniform.
export function toPolyline(input) {
  if (!input) return [];
  // Array of {x,y,z}.
  if (Array.isArray(input) && input.length > 0 && typeof input[0] === 'object'
      && input[0] && 'x' in input[0]) {
    return input.map((p) => [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0]);
  }
  // Flat typed-array or array of numbers.
  if (input.length != null && typeof input[0] === 'number') {
    const out = [];
    for (let i = 0; i + 2 < input.length; i += 3) {
      out.push([input[i], input[i + 1], input[i + 2]]);
    }
    return out;
  }
  // Already array of [x,y,z].
  if (Array.isArray(input) && Array.isArray(input[0])) {
    return input.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
  }
  return [];
}

// ──────────────────────────────────── pick a stable "curve plane" normal
//
// For a planar polyline this returns the plane normal. For a 3D space
// curve it returns the normal of the best-fit plane through the first
// chord triple that defines a non-degenerate triangle. Failing that, the
// world-Z axis is the documented fallback so the SVG projection in the
// panel stays consistent across edge re-picks.
export function pickCurveNormal(points) {
  for (let i = 2; i < points.length; ++i) {
    const a = vsub(points[i - 1], points[i - 2]);
    const b = vsub(points[i],     points[i - 1]);
    const n = vcross(a, b);
    const L = vlen(n);
    if (L > 1e-9) return vscl(n, 1 / L);
  }
  return [0, 0, 1];
}

// ────────────────────────────────────────────────── core: edgeCurvature
//
// Given a polyline (in any of the shapes toPolyline accepts), return an
// array of { x, y, z, nx, ny, nz, kappa } — one entry per polyline point.
// The (nx, ny, nz) is the unit outward "hair" direction (curve normal,
// pointing away from the centre of the osculating circle for positive
// κ, towards it for negative κ — i.e. on the side the sign indicates).
//
// The endpoints carry κ = 0 with the nearest interior tangent's normal so
// callers can still draw a hair there without a special case.
export function edgeCurvature(input) {
  const pts = toPolyline(input);
  const N = pts.length;
  if (N < 2) return [];

  const planeN = pickCurveNormal(pts);

  // Per-segment tangents.
  const segT = new Array(N - 1);
  const segLen = new Array(N - 1);
  for (let i = 0; i < N - 1; ++i) {
    const d = vsub(pts[i + 1], pts[i]);
    const L = vlen(d);
    segLen[i] = L;
    segT[i] = L > 0 ? vscl(d, 1 / L) : [1, 0, 0];
  }

  const out = new Array(N);

  // First sample — flat tangent, no curvature.
  {
    const n0 = vnorm(vcross(planeN, segT[0]));
    out[0] = {
      x: pts[0][0], y: pts[0][1], z: pts[0][2],
      nx: n0[0], ny: n0[1], nz: n0[2],
      kappa: 0,
    };
  }

  // Interior samples — discrete curvature κ = 2 sin(θ) / |segment|
  // exactly as the slice brief writes it, where:
  //   θ        = angle between adjacent tangents (radians)
  //   |segment| = mean of the two adjacent segment lengths
  //
  // The hair direction is the in-plane normal of the curve at this
  // sample. Sign comes from the cross product (segT[i-1] × segT[i]) · planeN.
  for (let i = 1; i < N - 1; ++i) {
    const tA = segT[i - 1];
    const tB = segT[i];
    let cosT = vdot(tA, tB);
    if (cosT > 1) cosT = 1; else if (cosT < -1) cosT = -1;
    const theta = Math.acos(cosT);
    const sinT = Math.sin(theta);
    const meanSeg = 0.5 * (segLen[i - 1] + segLen[i]);
    let kappa = meanSeg > 0 ? (2 * sinT / meanSeg) : 0;

    // Sign — positive when the curve turns in the direction of planeN,
    // negative when it turns the other way. The cross product's
    // projection onto planeN gives the signed area of the parallelogram
    // spanned by the tangents.
    const cross = vcross(tA, tB);
    const signProj = vdot(cross, planeN);
    if (signProj < 0) kappa = -kappa;

    // Hair direction — bisector of the inward (acute) angle between the
    // tangents, rotated 90° in the curve plane. For a straight segment we
    // fall back to the perpendicular of tA in the curve plane so the
    // panel still has a stable direction to draw.
    let n = vsub(tB, tA);              // points roughly towards the centre
    if (vlen(n) < 1e-9) {
      n = vcross(planeN, tA);          // straight bit — perp in plane
    }
    n = vnorm(n);
    // Flip so the hair points OUTWARD from the curve (away from centre)
    // when κ > 0 — the comb's convention is that long hairs stick out.
    // We canonicalise to the outward direction here by negating, since
    // (tB - tA) initially points TOWARDS the centre.
    n = vscl(n, -1);
    out[i] = {
      x: pts[i][0], y: pts[i][1], z: pts[i][2],
      nx: n[0], ny: n[1], nz: n[2],
      kappa,
    };
  }

  // Last sample — same treatment as the first.
  {
    const nL = vnorm(vcross(planeN, segT[N - 2]));
    out[N - 1] = {
      x: pts[N - 1][0], y: pts[N - 1][1], z: pts[N - 1][2],
      nx: nL[0], ny: nL[1], nz: nL[2],
      kappa: 0,
    };
  }
  return out;
}

// ───────────────────────────────────────────────────────────── summary
//
// { count, min, max, avg, absAvg, inflections } over an edgeCurvature
// result. `inflections` counts sign changes in κ across the interior
// samples — a κ = 0 sample between κ < 0 and κ > 0 still counts as one
// inflection (the sign flip is the signal, not the zero crossing's
// magnitude).
export function summariseCurvature(samples) {
  let min = Infinity, max = -Infinity, sum = 0, sumAbs = 0, count = 0;
  let inflections = 0;
  let lastSign = 0;
  for (let i = 0; i < samples.length; ++i) {
    const k = samples[i].kappa;
    if (!Number.isFinite(k)) continue;
    count += 1;
    sum += k; sumAbs += Math.abs(k);
    if (k < min) min = k;
    if (k > max) max = k;
    if (i > 0 && i < samples.length - 1) {
      const s = Math.sign(k);
      if (s !== 0) {
        if (lastSign !== 0 && s !== lastSign) inflections += 1;
        lastSign = s;
      }
    }
  }
  if (count === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, absAvg: 0, inflections: 0 };
  }
  return {
    count,
    min,
    max,
    avg:    sum / count,
    absAvg: sumAbs / count,
    inflections,
  };
}

// ──────────────────────────────────────── projection helper for the SVG
//
// The comb is rendered as inline SVG inside the panel. The panel projects
// the 3D points to 2D via a "best-fit plane" projection — the plane
// normal picked by pickCurveNormal becomes the SVG's out-of-plane axis,
// the first chord direction becomes the SVG +X, and the cross of those
// two becomes the SVG +Y.
//
// Returns { proj2d: Array<[u,v]>, normals2d: Array<[nu, nv]>, basis }.
export function projectComb(samples) {
  if (!samples || samples.length < 2) {
    return { proj2d: [], normals2d: [], basis: null };
  }
  const pts3 = samples.map((s) => [s.x, s.y, s.z]);
  const n   = pickCurveNormal(pts3);
  // First chord = primary in-plane axis.
  let uAxis = vsub(pts3[1], pts3[0]);
  // If the polyline starts with a zero chord, walk forward until we find
  // a non-zero one.
  for (let i = 1; i < pts3.length - 1 && vlen(uAxis) < 1e-9; ++i) {
    uAxis = vsub(pts3[i + 1], pts3[i]);
  }
  if (vlen(uAxis) < 1e-9) uAxis = [1, 0, 0];
  // Project uAxis into the plane (subtract any normal component).
  uAxis = vsub(uAxis, vscl(n, vdot(uAxis, n)));
  uAxis = vnorm(uAxis);
  const vAxis = vnorm(vcross(n, uAxis));

  const origin = pts3[0];
  const proj2d = pts3.map((p) => {
    const d = vsub(p, origin);
    return [vdot(d, uAxis), vdot(d, vAxis)];
  });
  const normals2d = samples.map((s) => {
    const nv = [s.nx, s.ny, s.nz];
    return [vdot(nv, uAxis), vdot(nv, vAxis)];
  });
  return { proj2d, normals2d, basis: { origin, uAxis, vAxis, planeN: n } };
}

// ──────────────────────────────────────── numeric formatting for the UI
export function fmtKappa(k, digits = 5) {
  if (!Number.isFinite(k)) return '—';
  if (Math.abs(k) >= 1) return k.toFixed(Math.max(2, digits - 2));
  return k.toFixed(digits);
}
