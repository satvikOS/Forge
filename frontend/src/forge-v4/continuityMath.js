// PUSH-150 (Slice-110) — Surface Continuity Inspector math.
//
// Pure helpers used by SurfaceContinuityPanel + push-150-surface-continuity
// e2e. The brief:
//
//   "Pick 2 faces, sample boundary points, compute distance (G0), tangent
//    angle (G1), curvature mismatch (G2) via existing forge.surfacing.eval.
//    Report worst/avg per metric."
//
// The G0/G1/G2 metrics live at the SEAM between two adjacent NURBS faces.
// Class-A modellers (CATIA ICEM, Alias, Rhino V-Ray) lay this exact set of
// numbers out as the Class-A continuity audit. Our kernel does NOT yet
// bind LocalAnalysis_SurfaceContinuity (the OCCT class), so we re-derive
// the three metrics from forge.surfacing.eval samples on each face.
//
// Contract of forge.surfacing.eval(face, u, v):
//   { point:[x,y,z], du:[x,y,z], dv:[x,y,z], normal:[x,y,z],
//     gaussian: number, mean: number }
//
// Sampling strategy:
//   For face A and face B presumed to share an edge in 3D, the user picks
//   which parametric side of A and B corresponds to that shared edge:
//
//     side ∈ { 'u0', 'u1', 'v0', 'v1' }
//
//   • 'u0' → u=0, v∈[0,1] sweep        (the u-min edge)
//   • 'u1' → u=1, v∈[0,1] sweep        (the u-max edge)
//   • 'v0' → v=0, u∈[0,1] sweep        (the v-min edge)
//   • 'v1' → v=1, u∈[0,1] sweep        (the v-max edge)
//
//   The "boundary tangent" lives along that edge — it's the parameter
//   direction the sweep runs in. The "cross-seam tangent" is the other
//   parameter direction (perpendicular to the boundary in parameter
//   space). G1 measures the angle between the cross-seam tangents of A
//   and B; that's the angle by which the NURBS surface kinks at the seam.
//
//   For mirrored / reversed seams the cross-seam tangents on A and B
//   naturally point in opposite directions (one face's normal is "out"
//   while the neighbour's is "in"). G1 compensates by taking the angle
//   modulo π (i.e. we treat the seam as un-oriented). The same applies
//   to the normal: G1 reads on the absolute angle between cross-tangents,
//   and the comb sign is sample-by-sample so a flipped face shows up as
//   a uniform 180° run that wraps to 0° — exactly the way ICEM shows it.
//
// Hard constraints honoured:
//   * NO new npm / C++ deps.
//   * NO kernel modifications. The math here reads forge.surfacing.eval
//     and does the rest in JS.
//   * Pure functions — easy to unit-test, easy to drive from e2e.

// ─────────────────────────────────────────────────────────────────────
// Constants — match the UI defaults and bus event name.

export const FORGE_CONTINUITY_EVENT   = 'forge:surface-continuity-built';
export const FORGE_CONTINUITY_STORAGE = 'forge.v4.surfaceContinuity';
/** Default sample count along the seam. Mirrors PUSH-85 / PUSH-107
 *  density — enough to capture curvature, sparse enough to keep the
 *  inline SVG chart legible at panel width 460 px. */
export const CONTINUITY_DEFAULT_SAMPLES = 25;
/** Slider bounds for the sample count. */
export const CONTINUITY_MIN_SAMPLES = 5;
export const CONTINUITY_MAX_SAMPLES = 101;
/** The four parametric sides a face's shared edge can live on. */
export const CONTINUITY_SIDES = ['u0', 'u1', 'v0', 'v1'];
/** The three continuity metric ids surfaced to the UI. */
export const CONTINUITY_MODES = ['G0', 'G1', 'G2'];

// ─────────────────────────────────────────────────────────────────────
// Vector helpers — local (no imports, easy tree-shake).

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit3(v) {
  const m = magnitude3(v);
  if (!Number.isFinite(m) || m < 1e-12) return [0, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

// ─────────────────────────────────────────────────────────────────────
// distanceMm — Euclidean distance between two points (mm).

export function distanceMm(pa, pb) {
  if (!Array.isArray(pa) || !Array.isArray(pb)) return NaN;
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const dz = pb[2] - pa[2];
  return Math.hypot(dx, dy, dz);
}

// ─────────────────────────────────────────────────────────────────────
// tangentAngleDeg — Angle (degrees) between two 3-vectors, treated as
// un-oriented (so 180° flips wrap to 0°). Matches the Class-A convention
// where the seam is direction-agnostic — what we care about is the kink
// magnitude, not whether the second face's parameter winds CW vs CCW.

export function tangentAngleDeg(ta, tb) {
  if (!Array.isArray(ta) || !Array.isArray(tb)) return NaN;
  const ua = unit3(ta);
  const ub = unit3(tb);
  if (magnitude3(ua) < 1e-9 || magnitude3(ub) < 1e-9) return NaN;
  // Un-oriented: use |dot|; angle ∈ [0, 90°].
  // Then the panel reports min(angle, 180 - angle) implicitly via abs.
  let c = dot3(ua, ub);
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  const oriented = Math.acos(c) * 180 / Math.PI;
  // Un-oriented angle ∈ [0, 90°] — for a flipped face the cross-seam
  // tangent points the other way, so a perfectly matched seam can read
  // 180° before this fold. The fold makes G1 read the kink magnitude.
  return oriented > 90 ? 180 - oriented : oriented;
}

// ─────────────────────────────────────────────────────────────────────
// curvatureDelta — Absolute difference between two scalar curvatures
// (mean or Gaussian). Units: 1/mm (since the kernel reports in 1/mm).

export function curvatureDelta(ka, kb) {
  const a = Number(ka);
  const b = Number(kb);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.abs(a - b);
}

// ─────────────────────────────────────────────────────────────────────
// sideToUv — Map a 'u0'|'u1'|'v0'|'v1' side + an "along-seam" parameter
// t∈[0,1] to a (u, v) parameter pair on the face.

export function sideToUv(side, t) {
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (side === 'u0') return [0, tt];
  if (side === 'u1') return [1, tt];
  if (side === 'v0') return [tt, 0];
  if (side === 'v1') return [tt, 1];
  // Default — degenerate side, fall back to u=0,v=t.
  return [0, tt];
}

// ─────────────────────────────────────────────────────────────────────
// sideCrossTangent — Given a side and the (du, dv) basis at that
// parameter, return the cross-seam tangent vector. The cross-seam
// tangent is the one perpendicular to the seam direction in parameter
// space — du for v-sides, dv for u-sides.

export function sideCrossTangent(side, du, dv) {
  if (side === 'u0' || side === 'u1') return du; // seam runs in v → cross is du
  return dv;                                      // seam runs in u → cross is dv
}

// ─────────────────────────────────────────────────────────────────────
// sideAlongTangent — Inverse of sideCrossTangent: the along-seam tangent.

export function sideAlongTangent(side, du, dv) {
  if (side === 'u0' || side === 'u1') return dv;
  return du;
}

// ─────────────────────────────────────────────────────────────────────
// evalAtParam — Wraps forge.surfacing.eval with a defensive contract.
// Returns null on any failure so callers can surface a per-sample error
// instead of throwing through the loop.

export function evalAtParam(faceHandle, u, v, surfacingEval) {
  if (!Number.isFinite(faceHandle) || faceHandle <= 0) return null;
  if (typeof surfacingEval !== 'function') return null;
  try {
    const r = surfacingEval(faceHandle, u, v);
    if (!r || !Array.isArray(r.point) || !Array.isArray(r.du)
        || !Array.isArray(r.dv) || !Array.isArray(r.normal)) {
      return null;
    }
    return {
      point: [r.point[0], r.point[1], r.point[2]],
      du:    [r.du[0],    r.du[1],    r.du[2]],
      dv:    [r.dv[0],    r.dv[1],    r.dv[2]],
      normal: [r.normal[0], r.normal[1], r.normal[2]],
      gaussian: Number.isFinite(r.gaussian) ? r.gaussian : 0,
      mean:     Number.isFinite(r.mean)     ? r.mean     : 0,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// sampleBoundary — Sample one face's shared edge at N points and return
// the per-sample evaluations + a few derived per-sample vectors used by
// the continuity comparator.
//
// Returns:
//   { ok, side, samples:[{t, uv, point, du, dv, normal, cross, along,
//     mean, gaussian}], reason, message }

export function sampleBoundary({
  faceHandle, side, samples = CONTINUITY_DEFAULT_SAMPLES, surfacingEval,
}) {
  if (!Number.isFinite(faceHandle) || faceHandle <= 0) {
    return { ok: false, reason: 'invalid face handle', samples: [] };
  }
  if (!CONTINUITY_SIDES.includes(side)) {
    return { ok: false, reason: 'invalid side', samples: [] };
  }
  const evalFn = surfacingEval
    || (typeof window !== 'undefined' && window.forge && window.forge.surfacing
        && window.forge.surfacing.eval)
    || null;
  if (typeof evalFn !== 'function') {
    return { ok: false, reason: 'surfacing.eval missing', samples: [] };
  }
  const n = Math.max(2, samples | 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [u, v] = sideToUv(side, t);
    const r = evalAtParam(faceHandle, u, v, evalFn);
    if (!r) {
      return {
        ok: false,
        reason: `eval failed at sample ${i} (u=${u.toFixed(4)},v=${v.toFixed(4)})`,
        samples: out, side,
      };
    }
    const cross = sideCrossTangent(side, r.du, r.dv);
    const along = sideAlongTangent(side, r.du, r.dv);
    out.push({
      t, uv: [u, v],
      point: r.point, du: r.du, dv: r.dv,
      normal: r.normal,
      cross, along,
      mean: r.mean, gaussian: r.gaussian,
    });
  }
  return { ok: true, side, samples: out };
}

// ─────────────────────────────────────────────────────────────────────
// computeContinuity — Top-level driver. Sample A on its side, sample B
// on its side, pair them up at matching t, return:
//   • the per-sample arrays { distance, tangentAngle, meanDelta,
//     gaussianDelta, normalAngle }
//   • summaries { g0Avg, g0Max, g1Avg, g1Max, g2Avg, g2Max, … }
//   • boundary AB diagnostic info { worstSampleIndex per metric }
//
// Returns { ok, perSample, summary, faceA, faceB, samples, reason }.

export function computeContinuity({
  faceA, sideA, faceB, sideB,
  samples = CONTINUITY_DEFAULT_SAMPLES,
  surfacingEval,
  reverseB = false,
}) {
  const evalFn = surfacingEval
    || (typeof window !== 'undefined' && window.forge && window.forge.surfacing
        && window.forge.surfacing.eval)
    || null;
  if (typeof evalFn !== 'function') {
    return { ok: false, reason: 'surfacing.eval missing' };
  }
  const a = sampleBoundary({
    faceHandle: faceA, side: sideA, samples, surfacingEval: evalFn,
  });
  if (!a.ok) return { ok: false, reason: `face A: ${a.reason}` };
  const bRaw = sampleBoundary({
    faceHandle: faceB, side: sideB, samples, surfacingEval: evalFn,
  });
  if (!bRaw.ok) return { ok: false, reason: `face B: ${bRaw.reason}` };
  // Optionally walk B in the opposite parameter direction — common when
  // the two faces meet at the same 3D edge but their UV winds disagree.
  const b = reverseB
    ? { ...bRaw, samples: bRaw.samples.slice().reverse() }
    : bRaw;
  const n = Math.min(a.samples.length, b.samples.length);
  const perSample = [];
  for (let i = 0; i < n; i++) {
    const sa = a.samples[i];
    const sb = b.samples[i];
    perSample.push({
      i, t: sa.t,
      pointA: sa.point, pointB: sb.point,
      distance:      distanceMm(sa.point, sb.point),
      tangentAngle:  tangentAngleDeg(sa.cross, sb.cross),
      normalAngle:   tangentAngleDeg(sa.normal, sb.normal),
      meanA: sa.mean, meanB: sb.mean,
      meanDelta:     curvatureDelta(sa.mean, sb.mean),
      gaussA: sa.gaussian, gaussB: sb.gaussian,
      gaussianDelta: curvatureDelta(sa.gaussian, sb.gaussian),
    });
  }
  return {
    ok: true,
    faceA, sideA, faceB, sideB, samples: n,
    perSample,
    summary: summariseContinuity(perSample),
  };
}

// ─────────────────────────────────────────────────────────────────────
// summariseContinuity — Reduces a perSample array to a single record of
// worst/avg per metric + the index of the worst sample.

export function summariseContinuity(perSample) {
  const n = perSample.length;
  if (n === 0) {
    return {
      n: 0,
      g0Avg: 0, g0Max: 0, g0WorstIdx: -1,
      g1Avg: 0, g1Max: 0, g1WorstIdx: -1,
      g2Avg: 0, g2Max: 0, g2WorstIdx: -1,
      normalAvg: 0, normalMax: 0, normalWorstIdx: -1,
      gaussianAvg: 0, gaussianMax: 0, gaussianWorstIdx: -1,
    };
  }
  let g0Sum = 0, g0Max = 0, g0WorstIdx = -1;
  let g1Sum = 0, g1Max = 0, g1WorstIdx = -1;
  let g2Sum = 0, g2Max = 0, g2WorstIdx = -1;
  let normalSum = 0, normalMax = 0, normalWorstIdx = -1;
  let gaussSum = 0, gaussMax = 0, gaussWorstIdx = -1;
  let g0Valid = 0, g1Valid = 0, g2Valid = 0, normValid = 0, gaussValid = 0;
  for (let i = 0; i < n; i++) {
    const s = perSample[i];
    if (Number.isFinite(s.distance)) {
      g0Sum += s.distance; g0Valid += 1;
      if (s.distance > g0Max) { g0Max = s.distance; g0WorstIdx = i; }
    }
    if (Number.isFinite(s.tangentAngle)) {
      g1Sum += s.tangentAngle; g1Valid += 1;
      if (s.tangentAngle > g1Max) { g1Max = s.tangentAngle; g1WorstIdx = i; }
    }
    if (Number.isFinite(s.meanDelta)) {
      g2Sum += s.meanDelta; g2Valid += 1;
      if (s.meanDelta > g2Max) { g2Max = s.meanDelta; g2WorstIdx = i; }
    }
    if (Number.isFinite(s.normalAngle)) {
      normalSum += s.normalAngle; normValid += 1;
      if (s.normalAngle > normalMax) { normalMax = s.normalAngle; normalWorstIdx = i; }
    }
    if (Number.isFinite(s.gaussianDelta)) {
      gaussSum += s.gaussianDelta; gaussValid += 1;
      if (s.gaussianDelta > gaussMax) { gaussMax = s.gaussianDelta; gaussWorstIdx = i; }
    }
  }
  return {
    n,
    g0Avg: g0Valid ? g0Sum / g0Valid : 0, g0Max, g0WorstIdx,
    g1Avg: g1Valid ? g1Sum / g1Valid : 0, g1Max, g1WorstIdx,
    g2Avg: g2Valid ? g2Sum / g2Valid : 0, g2Max, g2WorstIdx,
    normalAvg: normValid ? normalSum / normValid : 0, normalMax, normalWorstIdx,
    gaussianAvg: gaussValid ? gaussSum / gaussValid : 0, gaussianMax: gaussMax, gaussianWorstIdx: gaussWorstIdx,
  };
}

// ─────────────────────────────────────────────────────────────────────
// classifyContinuity — Map summary thresholds to a continuity grade.
//
// Class-A audit conventions (CATIA Generative Shape Design):
//   • G0 PASS  if max distance      < 1 mm
//   • G1 PASS  if max tangent angle < 10°  (better: < 0.5°)
//   • G2 PASS  if max meanΔ         < 0.05 1/mm (heuristic — depends on geometry)
//
// These thresholds are loose intentionally — Class-A modelling at the
// designer's bench usually starts with "is this G0 yet?" and tightens
// later. The panel shows the numeric value next to the badge so the user
// can judge for themselves.

export function classifyContinuity(summary) {
  const g0Pass = Number.isFinite(summary.g0Max) && summary.g0Max < 1.0;
  const g1Pass = Number.isFinite(summary.g1Max) && summary.g1Max < 10.0;
  const g2Pass = Number.isFinite(summary.g2Max) && summary.g2Max < 0.05;
  return {
    g0: g0Pass ? 'PASS' : 'FAIL',
    g1: g1Pass ? 'PASS' : 'FAIL',
    g2: g2Pass ? 'PASS' : 'FAIL',
    grade: g2Pass ? 'G2' : g1Pass ? 'G1' : g0Pass ? 'G0' : 'NONE',
  };
}

// ─────────────────────────────────────────────────────────────────────
// dataForMode — Pick the per-sample series for a given mode (G0/G1/G2).
//
// Returns { label, unit, values[], avg, max, worstIdx }.

export function dataForMode(perSample, summary, mode) {
  const m = String(mode || 'G0').toUpperCase();
  if (m === 'G1') {
    return {
      label: 'Tangent angle',
      unit: '°',
      values: perSample.map((s) => s.tangentAngle),
      avg: summary.g1Avg, max: summary.g1Max,
      worstIdx: summary.g1WorstIdx,
    };
  }
  if (m === 'G2') {
    return {
      label: 'Mean curvature Δ',
      unit: '1/mm',
      values: perSample.map((s) => s.meanDelta),
      avg: summary.g2Avg, max: summary.g2Max,
      worstIdx: summary.g2WorstIdx,
    };
  }
  // G0
  return {
    label: 'Distance',
    unit: 'mm',
    values: perSample.map((s) => s.distance),
    avg: summary.g0Avg, max: summary.g0Max,
    worstIdx: summary.g0WorstIdx,
  };
}

// ─────────────────────────────────────────────────────────────────────
// buildSparkPath — Build an inline SVG polyline path "M ... L ... L ..."
// for a per-sample series, normalised into a (width × height) box.
//
// Returns { d, max, min }.

export function buildSparkPath(values, width, height, { padding = 4 } = {}) {
  const n = values.length;
  if (n === 0) return { d: '', max: 0, min: 0 };
  let max = -Infinity, min = +Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      if (v > max) max = v;
      if (v < min) min = v;
    }
  }
  if (!Number.isFinite(max)) max = 0;
  if (!Number.isFinite(min)) min = 0;
  const range = max - min;
  const w = Math.max(1, width  - padding * 2);
  const h = Math.max(1, height - padding * 2);
  let d = '';
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(values[i]) ? values[i] : 0;
    const x = padding + (n > 1 ? (i / (n - 1)) * w : w * 0.5);
    const y = padding + (range > 0 ? (1 - (v - min) / range) * h : h * 0.5);
    d += (i === 0 ? 'M' : ' L') + x.toFixed(2) + ',' + y.toFixed(2);
  }
  return { d, max, min };
}
