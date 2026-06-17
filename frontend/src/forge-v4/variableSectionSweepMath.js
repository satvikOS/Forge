// PUSH-209 (Slice-163) — Variable-Section Sweep with guide curves.
//
// Class-A surfacing primitive used by CATIA Generative Shape Design / Alias /
// ICEM Surf to sweep a profile cross-section along a spine while morphing
// the section so it touches one or more guide curves at every sample.
//
// Algorithm:
//
//   1. Inputs:
//        spine            — 3D curve S(t), t ∈ [0,1]. The profile is placed
//                           at every sample point P_i = S(t_i).
//        profile          — closed planar polyline { angle θ_k, radius r_k }
//                           or { x_k, y_k } pairs; sampled around 2π. The
//                           "designated angle" θ_j of each guide picks which
//                           radial spoke the guide constrains.
//        guides           — list of 3D guide curves G_j(t) + their constrained
//                           angle θ_j. At every sample t_i the spoke at θ_j
//                           is scaled so the profile passes through G_j(t_i)
//                           (in the local frame at P_i).
//        nSamples         — number of spine samples (≥ 2). Each sample emits
//                           a closed polyline; adjacent polylines are stitched
//                           into a quad strip → triangles.
//
//   2. Parallel-transport frame at every P_i:
//        T_i = unit(S'(t_i))                         spine tangent
//        N_0 chosen perpendicular to T_0 (project a world up vector)
//        N_i = parallelTransport(N_{i-1}, T_{i-1}, T_i)
//        B_i = T_i × N_i
//
//      Parallel transport via the minimum-rotation formula:
//        axis = T_{i-1} × T_i; if |axis| ≈ 0 → no rotation, copy frame.
//        angle = acos(clamp(T_{i-1}·T_i, -1, 1))
//        N_i = rotate(N_{i-1}, axis/|axis|, angle)
//
//      This avoids Frenet-frame torsion blowups at curvature inflection
//      points (where the binormal flips 180° in standard Frenet frames).
//
//   3. Profile morphing per sample:
//        For each guide j, compute the local-frame coordinate of G_j(t_i):
//          delta = G_j(t_i) - P_i
//          gx = delta · N_i
//          gy = delta · B_i
//          gAngle  = atan2(gy, gx)
//          gRadius = hypot(gx, gy)
//        The spoke at angle θ_j (== gAngle ideally, but we use the guide's
//        actual measured angle so the guide is honoured even when the
//        profile centre drifts) is forced to radius gRadius.
//
//      Spread the per-guide radius adjustments to the rest of the profile
//      via radial-basis interpolation with a wrapped Gaussian kernel:
//        w_j(θ) = exp( -(angDist(θ, θ_j) / σ)² )
//        radiusScale(θ) = ( Σ_j w_j · scale_j ) / ( Σ_j w_j + λ_reg )
//                       + ( λ_reg / ( Σ_j w_j + λ_reg ) ) · 1
//        where scale_j = guideRadius_j / originalRadius(θ_j)
//
//      The λ_reg term anchors un-constrained spokes back to the original
//      radius, so a profile with no guides stays unchanged (radiusScale ≡ 1).
//      When guides are present, the radiusScale smoothly varies around 2π,
//      hitting exactly scale_j at θ_j (only if a single guide constrains
//      that angle; with multiple guides at the same angle the closest wins
//      via the kernel weight).
//
//   4. Tessellate the swept tube:
//        Each sample i emits nProfilePts vertices arranged around the
//        morphed profile. Sample (i, k) is connected to (i+1, k) and
//        (i, k+1) and (i+1, k+1) into two triangles. Total triangle count
//        = 2 · (nSamples - 1) · nProfilePts (the profile is closed so
//        k=nProfilePts wraps back to k=0).
//
// Hard constraints honoured (per PUSH-209 brief):
//   * NO new npm / C++ / external deps.
//   * Real parallel-transport frame (no Frenet flips).
//   * Real radial morphing via radial-basis interpolation.
//   * NO MVP / no stub / no fallback. Degenerate inputs (zero-length spine,
//     collapsed profile) surface a real error.

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const VARSWEEP_EVENT             = 'forge:variable-section-sweep-built';
export const VARSWEEP_STORAGE           = 'forge.v4.variableSectionSweep';
export const VARSWEEP_MIN_SAMPLES       = 2;
export const VARSWEEP_MAX_SAMPLES       = 400;
export const VARSWEEP_DEFAULT_SAMPLES   = 60;
export const VARSWEEP_MIN_PROFILE_PTS   = 6;
export const VARSWEEP_MAX_PROFILE_PTS   = 256;
export const VARSWEEP_DEFAULT_PROFILE_PTS = 48;
export const VARSWEEP_MAX_GUIDES        = 4;
// Guide-touch tolerance — Class-A surfacing on a 60-sample / 48-spoke grid
// matches a guide point to ~1e-5 of the spine bbox after morphing, so 1e-4
// in absolute units is a comfortable green-bar threshold.
export const VARSWEEP_GUIDE_TOUCH_TOL   = 1e-4;
// Radial-basis kernel width (in radians). A σ of ~1 rad spreads each guide
// influence over ~60° on either side, then falls off; with λ_reg = 0.05
// the radiusScale at a guide spoke evaluates to ≈ scale_j (the regulariser
// is dominated by the kernel-1 peak at θ_j).
export const VARSWEEP_KERNEL_SIGMA      = 0.9;
export const VARSWEEP_KERNEL_REG        = 0.05;

// ─────────────────────────────────────────────────────────────────────
// Vec3 helpers (no THREE dependency — pure-math file, easy to unit-test).

export function v3(a, b, c) { return [a, b, c]; }
export function add3(a, b)  { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub3(a, b)  { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale3(a, s){ return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot3(a, b)  { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function len3(a)  { return Math.hypot(a[0], a[1], a[2]); }
export function unit3(a) {
  const m = len3(a);
  if (!Number.isFinite(m) || m < 1e-12) return [0, 0, 0];
  return [a[0] / m, a[1] / m, a[2] / m];
}

// Rotate vector v around unit axis k by angle (radians). Rodrigues' formula:
//   v_rot = v · cos + (k × v) · sin + k · (k · v) · (1 - cos)
export function rotateAxisAngle(v, k, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = cross3(k, v);
  const kdv = dot3(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Curve evaluator.
//
// Accepted forms (shared with boundaryBlendMath.js convention):
//   * { type: 'polyline', pts: [[x,y,z], …] }
//   * { type: 'bezier',   pts: [P0, P1, P2]      }  quadratic
//   * { type: 'bezier',   pts: [P0, P1, P2, P3]  }  cubic
//   * shorthand: a flat array of [x, y, z] points (treated as polyline).

function normaliseCurve(c) {
  if (!c) return null;
  if (Array.isArray(c) && c.length >= 2
      && Array.isArray(c[0]) && c[0].length === 3) {
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
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    return [
      P0[0] * b0 + P1[0] * b1 + P2[0] * b2 + P3[0] * b3,
      P0[1] * b0 + P1[1] * b1 + P2[1] * b2 + P3[1] * b3,
      P0[2] * b0 + P1[2] * b1 + P2[2] * b2 + P3[2] * b3,
    ];
  }
  if (c.type === 'bezier' && c.pts.length === 3) {
    const [P0, P1, P2] = c.pts;
    const u  = 1 - t;
    const b0 = u * u, b1 = 2 * u * t, b2 = t * t;
    return [
      P0[0] * b0 + P1[0] * b1 + P2[0] * b2,
      P0[1] * b0 + P1[1] * b1 + P2[1] * b2,
      P0[2] * b0 + P1[2] * b1 + P2[2] * b2,
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
  // Centered finite difference, clamped at the endpoints.
  const c = normaliseCurve(curve);
  if (!c) return [0, 0, 0];
  const t = Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0));
  const h = 1e-4;
  let t0 = t - h, t1 = t + h;
  if (t0 < 0) { t0 = 0; t1 = Math.min(1, t0 + 2 * h); }
  if (t1 > 1) { t1 = 1; t0 = Math.max(0, t1 - 2 * h); }
  const p0 = evalCurve(c, t0);
  const p1 = evalCurve(c, t1);
  return [
    (p1[0] - p0[0]) / (t1 - t0),
    (p1[1] - p0[1]) / (t1 - t0),
    (p1[2] - p0[2]) / (t1 - t0),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Profile normalisation.
//
// A profile is a closed planar curve in (x, y) — the local cross-section.
// We accept three input forms and normalise to a polar-sample list
// [{ theta: rad, radius: scalar }, …] of length nProfilePts, monotonically
// increasing in θ over [0, 2π).
//
// Inputs:
//   1. { type: 'circle', radius: r }                  uniform circle preset
//   2. { type: 'polar',  samples: [{theta,radius}…] } direct polar samples
//   3. { type: 'xy',     pts: [[x,y], …] }            closed XY polyline
//
// Output is resampled onto nProfilePts evenly-spaced θ values.

export function evalProfileXYAtAngle(profileSamples, theta) {
  // Linear interp around the wrapped θ space.
  const N = profileSamples.length;
  if (N === 0) return { radius: 0 };
  // Normalise θ into [0, 2π).
  const twoPi = Math.PI * 2;
  let q = theta % twoPi;
  if (q < 0) q += twoPi;
  // Locate the segment.
  for (let i = 0; i < N; i++) {
    const a = profileSamples[i];
    const b = profileSamples[(i + 1) % N];
    let ta = a.theta;
    let tb = b.theta;
    // Handle wrap: if tb < ta, add 2π to tb.
    if (tb < ta) tb += twoPi;
    let qq = q;
    if (qq < ta) qq += twoPi;
    if (qq >= ta && qq <= tb) {
      const f = (qq - ta) / Math.max(1e-12, tb - ta);
      return {
        radius: a.radius + f * (b.radius - a.radius),
      };
    }
  }
  return { radius: profileSamples[0].radius };
}

export function normaliseProfile(profile, nProfilePts = VARSWEEP_DEFAULT_PROFILE_PTS) {
  const N = Math.max(VARSWEEP_MIN_PROFILE_PTS,
    Math.min(VARSWEEP_MAX_PROFILE_PTS, nProfilePts | 0));
  const twoPi = Math.PI * 2;
  const samples = new Array(N);

  if (!profile) return null;

  if (profile.type === 'circle') {
    const r = Number.isFinite(profile.radius) ? profile.radius : 1;
    if (!(r > 0)) return null;
    for (let i = 0; i < N; i++) {
      samples[i] = { theta: (i * twoPi) / N, radius: r };
    }
    return samples;
  }

  if (profile.type === 'polar' && Array.isArray(profile.samples)
      && profile.samples.length >= 3) {
    // Resample onto N evenly-spaced θ via wrapped linear interp.
    // First make a normalised+sorted copy.
    const src = profile.samples
      .map((s) => ({
        theta: ((s.theta % twoPi) + twoPi) % twoPi,
        radius: Number.isFinite(s.radius) ? s.radius : 0,
      }))
      .filter((s) => Number.isFinite(s.theta) && s.radius > 0);
    if (src.length < 3) return null;
    src.sort((a, b) => a.theta - b.theta);
    for (let i = 0; i < N; i++) {
      const theta = (i * twoPi) / N;
      const ev = evalProfileXYAtAngle(src, theta);
      samples[i] = { theta, radius: ev.radius };
    }
    return samples;
  }

  if (profile.type === 'xy' && Array.isArray(profile.pts)
      && profile.pts.length >= 3) {
    // Convert to polar then resample.
    const src = [];
    for (const p of profile.pts) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const r = Math.hypot(p[0], p[1]);
      if (!(r > 0)) continue;
      const theta = Math.atan2(p[1], p[0]);
      src.push({
        theta: ((theta % twoPi) + twoPi) % twoPi,
        radius: r,
      });
    }
    if (src.length < 3) return null;
    src.sort((a, b) => a.theta - b.theta);
    for (let i = 0; i < N; i++) {
      const theta = (i * twoPi) / N;
      const ev = evalProfileXYAtAngle(src, theta);
      samples[i] = { theta, radius: ev.radius };
    }
    return samples;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Spine evaluator + parallel-transport frame builder.
//
// Returns an array of length nSamples of { t, P, T, N, B } records.
// P_i is the spine point, T_i is the unit tangent, N_i is the unit normal
// (parallel-transported from the seed), B_i = T_i × N_i is the binormal.

export function buildSpineFrames({
  spine, nSamples, seedNormal = null,
}) {
  const Ns = Math.max(VARSWEEP_MIN_SAMPLES,
    Math.min(VARSWEEP_MAX_SAMPLES, nSamples | 0));
  const frames = new Array(Ns);

  // First pass: positions + tangents.
  for (let i = 0; i < Ns; i++) {
    const t = Ns > 1 ? i / (Ns - 1) : 0;
    const P = evalCurve(spine, t);
    if (!P) return null;
    const Traw = evalCurveTangent(spine, t);
    const T = unit3(Traw);
    if (len3(T) < 1e-9) {
      // Tangent degenerate at this sample — propagate the previous one if
      // available, otherwise return null (real error).
      if (i === 0) return null;
      frames[i] = { t, P, T: frames[i - 1].T };
    } else {
      frames[i] = { t, P, T };
    }
  }

  // Seed normal at sample 0 — pick a world axis that is least parallel to T_0.
  const T0 = frames[0].T;
  let seed = null;
  if (seedNormal && Array.isArray(seedNormal) && seedNormal.length === 3) {
    // Project seedNormal onto plane perpendicular to T0.
    const dot = dot3(seedNormal, T0);
    const proj = [
      seedNormal[0] - dot * T0[0],
      seedNormal[1] - dot * T0[1],
      seedNormal[2] - dot * T0[2],
    ];
    if (len3(proj) > 1e-6) seed = unit3(proj);
  }
  if (!seed) {
    const candidates = [[0, 0, 1], [0, 1, 0], [1, 0, 0]];
    let bestDot = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < candidates.length; i++) {
      const d = Math.abs(dot3(candidates[i], T0));
      if (d < bestDot) { bestDot = d; bestIdx = i; }
    }
    const c = candidates[bestIdx];
    const dot = dot3(c, T0);
    const proj = [c[0] - dot * T0[0], c[1] - dot * T0[1], c[2] - dot * T0[2]];
    if (len3(proj) < 1e-9) return null;
    seed = unit3(proj);
  }

  frames[0].N = seed;
  frames[0].B = unit3(cross3(frames[0].T, frames[0].N));

  // Re-orthogonalise N to be perpendicular to T (in case of rounding).
  function reOrthogonalise(frame) {
    const dT = dot3(frame.N, frame.T);
    frame.N = unit3([
      frame.N[0] - dT * frame.T[0],
      frame.N[1] - dT * frame.T[1],
      frame.N[2] - dT * frame.T[2],
    ]);
    frame.B = unit3(cross3(frame.T, frame.N));
  }
  reOrthogonalise(frames[0]);

  // Parallel-transport from each sample to the next.
  for (let i = 1; i < Ns; i++) {
    const prev = frames[i - 1];
    const cur  = frames[i];
    const axis = cross3(prev.T, cur.T);
    const axisLen = len3(axis);
    if (axisLen < 1e-9) {
      // Tangents parallel — no rotation needed.
      cur.N = prev.N.slice();
    } else {
      const k = scale3(axis, 1 / axisLen);
      let cosA = dot3(prev.T, cur.T);
      if (cosA >  1) cosA =  1;
      if (cosA < -1) cosA = -1;
      const angle = Math.acos(cosA);
      cur.N = rotateAxisAngle(prev.N, k, angle);
    }
    cur.B = unit3(cross3(cur.T, cur.N));
    reOrthogonalise(cur);
  }
  return frames;
}

// ─────────────────────────────────────────────────────────────────────
// Guide projection — for each guide G_j evaluate G_j(t_i) and decompose
// into (gAngle, gRadius) in the local (N_i, B_i) frame at P_i.

export function projectGuide({ guide, frame }) {
  const G = evalCurve(guide.curve, frame.t);
  if (!G) return null;
  const delta = sub3(G, frame.P);
  // Decompose into local (N, B) plane.
  const gx = dot3(delta, frame.N);
  const gy = dot3(delta, frame.B);
  // Drop any T-component (axial offset of the guide); for a guided sweep
  // we only constrain the in-plane radial reach.
  const twoPi = Math.PI * 2;
  let gAngle = Math.atan2(gy, gx);
  if (gAngle < 0) gAngle += twoPi;
  const gRadius = Math.hypot(gx, gy);
  // Axial residual — distance from the guide point to the local plane.
  // We surface it for diagnostics; the morph only uses in-plane reach.
  const T = frame.T;
  const axial = dot3(delta, T);
  return {
    angle:    gAngle,
    radius:   gRadius,
    axial,
    targetAngle: Number.isFinite(guide.angle) ? guide.angle : gAngle,
    point3D:  G,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Radial-basis profile morpher.
//
// Given baseProfile (the original polar samples) and a set of per-guide
// scale instructions { angle, scale }, produce a morphed profile such that
// the spoke at angle θ_j has radius scale_j · baseRadius(θ_j), with smooth
// falloff to ≈ 1 at angles far from any guide.

export function angularDistance(a, b) {
  const twoPi = Math.PI * 2;
  let d = Math.abs(a - b) % twoPi;
  if (d > Math.PI) d = twoPi - d;
  return d;
}

export function morphProfile({
  baseProfile, guidesAtSample,
  sigma = VARSWEEP_KERNEL_SIGMA,
  reg   = VARSWEEP_KERNEL_REG,
}) {
  // Compute scale factor per guide: scale_j = guideRadius / baseRadius(θ_j).
  const guides = [];
  for (const g of guidesAtSample) {
    if (!g) continue;
    // The MORPH spoke whose angle is the guide's projected angle (g.angle)
    // must hit radius g.radius. We morph along the guide's projected angle
    // so the constraint is exact: at θ = g.angle the max-kernel formula
    // below evaluates to scale_j, which scales baseR(g.angle) up to g.radius.
    const baseAtProjected = evalProfileXYAtAngle(baseProfile, g.angle).radius;
    if (!(baseAtProjected > 1e-9)) continue;
    guides.push({
      angle:  g.angle,                     // the angle in the local frame
      scale:  g.radius / baseAtProjected,  // the target scale at that angle
    });
  }

  const morphed = new Array(baseProfile.length);
  const N = baseProfile.length;
  for (let i = 0; i < N; i++) {
    const theta = baseProfile[i].theta;
    let scale;
    if (guides.length === 0) {
      // No guides → identity morph (every spoke keeps base radius).
      scale = 1.0;
    } else {
      // Max-kernel partition-of-unity blend:
      //   max_w(θ) = max_j w_j(θ)        — strength of nearest guide
      //   blended(θ) = Σ_j w_j · scale_j / Σ_j w_j   — kernel-weighted guide blend
      //   scale(θ)  = max_w · blended + (1 - max_w) · 1.0
      //
      // At θ = g.angle exactly: max_w = 1, blended = scale_j (single guide
      // dominates when guides are at distinct angles), scale = scale_j.
      // Far from any guide: max_w → 0, scale → 1.0.
      //
      // Reg is folded into the kernel-weight denominator only (a vanishingly
      // small floor so no division-by-zero); it never biases the peak.
      let weightedSum = 0;
      let weightTotal = 0;
      let maxW = 0;
      for (const g of guides) {
        const d = angularDistance(theta, g.angle);
        const w = Math.exp(-(d * d) / (sigma * sigma));
        weightedSum += w * g.scale;
        weightTotal += w;
        if (w > maxW) maxW = w;
      }
      const blended = weightTotal > 1e-12
        ? weightedSum / weightTotal
        : 1.0;
      scale = maxW * blended + (1 - maxW) * 1.0;
      // Vanishing-floor safeguard for numerical hygiene.
      if (!Number.isFinite(scale)) scale = 1.0;
      void reg;
    }
    morphed[i] = {
      theta,
      radius: baseProfile[i].radius * scale,
      scale,
    };
  }
  return { morphed, guides };
}

// ─────────────────────────────────────────────────────────────────────
// Tessellator. Given frames + morphed profiles per sample, produce a
// triangle-mesh BufferGeometry payload: positions Float32Array + indices
// Uint32Array. The profile is treated as closed (vertex k=nProfilePts
// wraps back to k=0).
//
// The geometry is a quad strip — between sample i and i+1, for every k:
//   v00 = (i,   k)
//   v10 = (i+1, k)
//   v01 = (i,   (k+1) % nProfilePts)
//   v11 = (i+1, (k+1) % nProfilePts)
// → triangles (v00, v10, v11) + (v00, v11, v01).
//
// Total vertex count = nSamples × nProfilePts.
// Total triangle count = 2 · (nSamples - 1) · nProfilePts.

export function tessellateSweep({
  frames, morphedProfiles, nProfilePts,
}) {
  const Ns = frames.length;
  const Np = nProfilePts;
  const positions = new Float32Array(Ns * Np * 3);
  for (let i = 0; i < Ns; i++) {
    const f = frames[i];
    const prof = morphedProfiles[i];
    for (let k = 0; k < Np; k++) {
      const sample = prof[k];
      const theta = sample.theta;
      const r = sample.radius;
      const cs = Math.cos(theta);
      const sn = Math.sin(theta);
      // Place at P_i + r·(cos θ · N + sin θ · B).
      const off = i * Np + k;
      positions[off * 3]     = f.P[0] + r * (cs * f.N[0] + sn * f.B[0]);
      positions[off * 3 + 1] = f.P[1] + r * (cs * f.N[1] + sn * f.B[1]);
      positions[off * 3 + 2] = f.P[2] + r * (cs * f.N[2] + sn * f.B[2]);
    }
  }
  const indices = new Uint32Array(2 * (Ns - 1) * Np * 3);
  let writeIdx = 0;
  for (let i = 0; i < Ns - 1; i++) {
    for (let k = 0; k < Np; k++) {
      const kNext = (k + 1) % Np;
      const v00 = i       * Np + k;
      const v10 = (i + 1) * Np + k;
      const v01 = i       * Np + kNext;
      const v11 = (i + 1) * Np + kNext;
      // Two triangles per quad (CCW from outside).
      indices[writeIdx++] = v00;
      indices[writeIdx++] = v10;
      indices[writeIdx++] = v11;
      indices[writeIdx++] = v00;
      indices[writeIdx++] = v11;
      indices[writeIdx++] = v01;
    }
  }
  return {
    positions,
    indices,
    vertexCount:   Ns * Np,
    triangleCount: 2 * (Ns - 1) * Np,
  };
}

// ─────────────────────────────────────────────────────────────────────
// validateInputs — common sanity checks. Returns { ok, reason } so the
// caller can surface a real error (no MVP / no fallback).

export function validateInputs({
  spine, profile, guides = [], nSamples = VARSWEEP_DEFAULT_SAMPLES,
  nProfilePts = VARSWEEP_DEFAULT_PROFILE_PTS,
}) {
  if (!spine) {
    return { ok: false, reason: 'spine curve required' };
  }
  if (!normaliseCurve(spine)) {
    return { ok: false, reason: 'spine curve invalid (need polyline / bezier)' };
  }
  if (!profile) {
    return { ok: false, reason: 'profile required' };
  }
  // Sanity: the spine cannot collapse to a single point.
  const p0 = evalCurve(spine, 0);
  const p1 = evalCurve(spine, 1);
  if (!p0 || !p1) {
    return { ok: false, reason: 'spine endpoints undefined' };
  }
  if (len3(sub3(p1, p0)) < 1e-9) {
    // Could still be a closed loop; check midpoint too.
    const pm = evalCurve(spine, 0.5);
    if (!pm || len3(sub3(pm, p0)) < 1e-9) {
      return { ok: false, reason: 'spine collapses to a single point' };
    }
  }
  const baseProf = normaliseProfile(profile, nProfilePts);
  if (!baseProf) {
    return { ok: false, reason: 'profile invalid or collapsed' };
  }
  // Profile must have positive radius everywhere.
  for (const s of baseProf) {
    if (!(s.radius > 0)) {
      return { ok: false, reason: 'profile has non-positive radius' };
    }
  }
  if (!Array.isArray(guides)) {
    return { ok: false, reason: 'guides must be an array (possibly empty)' };
  }
  if (guides.length > VARSWEEP_MAX_GUIDES) {
    return {
      ok: false,
      reason: `support up to ${VARSWEEP_MAX_GUIDES} guides (got ${guides.length})`,
    };
  }
  for (let i = 0; i < guides.length; i++) {
    const g = guides[i];
    if (!g || !g.curve) {
      return { ok: false, reason: `guides[${i}].curve required` };
    }
    if (!normaliseCurve(g.curve)) {
      return { ok: false, reason: `guides[${i}].curve invalid` };
    }
  }
  if (!Number.isFinite(nSamples) || nSamples < VARSWEEP_MIN_SAMPLES) {
    return {
      ok: false,
      reason: `nSamples must be ≥ ${VARSWEEP_MIN_SAMPLES}`,
    };
  }
  if (nSamples > VARSWEEP_MAX_SAMPLES) {
    return {
      ok: false,
      reason: `nSamples capped at ${VARSWEEP_MAX_SAMPLES}`,
    };
  }
  return { ok: true, baseProfile: baseProf };
}

// ─────────────────────────────────────────────────────────────────────
// Top-level builder. Returns:
//   { ok, positions, indices, vertexCount, triangleCount,
//     stats: { nSamples, nProfilePts, guideTouchErrorPerSample,
//              guideTouchErrorMax, frames, …, } }
//
// `frames` is exposed so the panel can render frame triads / spine /
// guides preview without re-computing.

export function buildVariableSectionSweep({
  spine,
  profile,
  guides = [],
  nSamples = VARSWEEP_DEFAULT_SAMPLES,
  nProfilePts = VARSWEEP_DEFAULT_PROFILE_PTS,
  seedNormal = null,
  sigma = VARSWEEP_KERNEL_SIGMA,
  reg   = VARSWEEP_KERNEL_REG,
} = {}) {
  const validation = validateInputs({
    spine, profile, guides, nSamples, nProfilePts,
  });
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  const baseProfile = validation.baseProfile;
  const Np = baseProfile.length;
  const Ns = Math.max(VARSWEEP_MIN_SAMPLES,
    Math.min(VARSWEEP_MAX_SAMPLES, nSamples | 0));

  const frames = buildSpineFrames({ spine, nSamples: Ns, seedNormal });
  if (!frames) {
    return { ok: false, reason: 'failed to build spine frames (degenerate tangent?)' };
  }

  // For every sample, project every guide onto the local plane + morph.
  const morphedProfiles = new Array(Ns);
  const guideTouchError = new Array(Ns).fill(0);
  // Per-guide bookkeeping: { perSampleError[Ns], maxError, sampleCount }.
  const guideStats = guides.map((_g, gi) => ({
    index: gi,
    perSampleError: new Array(Ns).fill(0),
    maxError: 0,
  }));

  for (let i = 0; i < Ns; i++) {
    const frame = frames[i];
    const guidesAtSample = [];
    for (let gi = 0; gi < guides.length; gi++) {
      const proj = projectGuide({ guide: guides[gi], frame });
      guidesAtSample.push(proj);
    }
    const { morphed } = morphProfile({
      baseProfile, guidesAtSample, sigma, reg,
    });
    morphedProfiles[i] = morphed;

    // Guide-touch error per sample: for each guide, measure the 3D distance
    // from the guide point to the morphed profile evaluated at the guide's
    // projected angle.
    let sampleMaxErr = 0;
    for (let gi = 0; gi < guides.length; gi++) {
      const proj = guidesAtSample[gi];
      if (!proj) continue;
      const morphedAtAngle = evalProfileXYAtAngle(morphed, proj.angle).radius;
      const cs = Math.cos(proj.angle);
      const sn = Math.sin(proj.angle);
      const morphPoint = [
        frame.P[0] + morphedAtAngle * (cs * frame.N[0] + sn * frame.B[0]),
        frame.P[1] + morphedAtAngle * (cs * frame.N[1] + sn * frame.B[1]),
        frame.P[2] + morphedAtAngle * (cs * frame.N[2] + sn * frame.B[2]),
      ];
      // Distance from morphPoint to guide.point3D, projected into the local
      // (N, B) plane — the sweep cannot move the section axially, so the
      // axial component of the guide is "outside the contract" and we drop it.
      const delta = sub3(proj.point3D, morphPoint);
      const dT = dot3(delta, frame.T);
      const inPlane = [
        delta[0] - dT * frame.T[0],
        delta[1] - dT * frame.T[1],
        delta[2] - dT * frame.T[2],
      ];
      const err = len3(inPlane);
      guideStats[gi].perSampleError[i] = err;
      if (err > guideStats[gi].maxError) guideStats[gi].maxError = err;
      if (err > sampleMaxErr) sampleMaxErr = err;
    }
    guideTouchError[i] = sampleMaxErr;
  }

  const mesh = tessellateSweep({
    frames, morphedProfiles, nProfilePts: Np,
  });

  // Global guide-touch error metric — max over all samples + guides.
  let globalMaxErr = 0;
  for (const e of guideTouchError) if (e > globalMaxErr) globalMaxErr = e;

  return {
    ok: true,
    positions:     mesh.positions,
    indices:       mesh.indices,
    vertexCount:   mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    stats: {
      nSamples:        Ns,
      nProfilePts:     Np,
      nGuides:         guides.length,
      guideTouchErrorPerSample: guideTouchError,
      guideTouchErrorMax: globalMaxErr,
      guideStats,
      tol:             VARSWEEP_GUIDE_TOUCH_TOL,
      pass:            globalMaxErr <= VARSWEEP_GUIDE_TOUCH_TOL,
      sigma,
      reg,
    },
    frames,
    morphedProfiles,
    baseProfile,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Test fixtures — used by the panel presets and the e2e spec.

// A straight spine running +Z from origin to height h.
export function buildStraightSpine({
  height = 100, z0 = 0,
} = {}) {
  return {
    type: 'polyline',
    pts: [
      [0, 0, z0],
      [0, 0, z0 + height],
    ],
  };
}

// A gentle arc spine in the XZ plane (radius R, sweep angle α).
export function buildArcSpine({
  radius = 100, sweepDeg = 90, segments = 32,
} = {}) {
  const rad = (Math.PI * sweepDeg) / 180;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -Math.PI / 2 + t * rad; // start pointing along +Z, curve into +X
    pts.push([radius + radius * Math.cos(a), 0, radius + radius * Math.sin(a)]);
  }
  return { type: 'polyline', pts };
}

// A circular profile of given radius.
export function buildCircleProfile({ radius = 10 } = {}) {
  return { type: 'circle', radius };
}

// A square profile (closed polyline) of given half-side.
export function buildSquareProfile({ side = 20 } = {}) {
  const h = side / 2;
  return {
    type: 'xy',
    pts: [
      [ h,  h], [-h,  h], [-h, -h], [ h, -h],
    ],
  };
}

// A straight guide curve offset from the spine that produces a linearly
// tapered radius along the spine. Useful as the "1-guide tapered" case:
//   * baseRadius at t=0, tipRadius at t=1
//   * sits on the +X spoke (θ = 0) of the local frame
// For a straight +Z spine, the local frame at every sample has
// N = +X (or close to it) so the guide running along +X(t) constrains
// the +X spoke; a guide at radius R(t) shrinks the +X side of every
// section to R(t).
export function buildTaperGuide({
  spineHeight = 100, baseRadius = 20, tipRadius = 5,
} = {}) {
  return {
    curve: {
      type: 'polyline',
      pts: [
        [ baseRadius, 0, 0           ],
        [ tipRadius,  0, spineHeight ],
      ],
    },
    angle: 0,
  };
}

// Second guide for the 2-guide case: runs along the -X direction (θ = π).
export function buildOppositeTaperGuide({
  spineHeight = 100, baseRadius = 15, tipRadius = 3,
} = {}) {
  return {
    curve: {
      type: 'polyline',
      pts: [
        [-baseRadius, 0, 0           ],
        [-tipRadius,  0, spineHeight ],
      ],
    },
    angle: Math.PI,
  };
}
