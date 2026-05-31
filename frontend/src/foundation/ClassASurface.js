/**
 * ArchDisc Foundation — Class A surfacing: curvature analysis on NURBS.
 *
 * Class A surfaces are the smooth, light-reflective body panels used
 * in automotive, marine, aerospace and consumer-product industries.
 * Quality is judged by curvature continuity (G2 / G3) and the
 * smoothness of curvature derivatives. Production pipelines (NX
 * Studio, ICEM Surf, Alias) ship these analysis tools out of the box.
 *
 * Foundation now provides:
 *
 *   • curveCurvature(curve, u): scalar κ + Frenet frame at parameter u
 *
 *       κ = |C'(u) × C''(u)| / |C'(u)|³           (Frenet)
 *       T = C'(u) / |C'(u)|                        (unit tangent)
 *       N = (C''(u) − (C''·T) T) / | … |           (unit normal)
 *       B = T × N                                  (binormal)
 *
 *   • curveCurvatureComb(curve, samples, scale): an array of
 *     (anchor → tip) line-segment pairs that visualises curvature.
 *     Each tine sits at the curve, perpendicular to the tangent, with
 *     length proportional to κ × scale.
 *
 *   • surfaceCurvature(surface, u, v): Gaussian K, mean H, principal
 *     curvatures κ_min / κ_max from the first + second fundamental
 *     forms.
 *
 *       E = S_u · S_u,   F = S_u · S_v,   G = S_v · S_v
 *       L = S_uu · n,    M = S_uv · n,    N = S_vv · n
 *       K = (L N − M²) / (E G − F²)
 *       H = (E N − 2 F M + G L) / (2 (E G − F²))
 *       κ_{min,max} = H ∓ √(H² − K)
 *
 *     Second derivatives computed by central-difference on the
 *     analytic first-derivative formula already available in
 *     NURBSSurface.evalDerivatives.
 *
 * Validation:
 *
 *   Circle R:        κ(u) = 1/R exactly at every u
 *   Sphere R:        K = 1/R² exactly at every (u, v)
 *                    H = 1/R   (with outward-normal convention)
 *   Cylinder R:      K = 0     (developable — has 0 Gaussian curvature)
 *                    H = 1/(2R)
 *
 * SVG output: curvature comb on top of the curve, ready to inspect
 * for kinks, inflection points, and curvature-discontinuity locations.
 */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a) => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Curvature + Frenet frame at parameter u of a NURBS curve.
 *
 * @param {NURBSCurve} curve
 * @param {number} u
 * @returns {{ kappa, tangent, normal, binormal, point }}
 */
export function curveCurvature(curve, u) {
  const ders = curve.evalDerivatives(u, 2);
  const C0 = ders[0];
  const Cp = ders[1];
  const Cpp = ders[2];
  const cpLen = norm(Cp);
  const c12 = cross(Cp, Cpp);
  const kappa = norm(c12) / Math.max(cpLen ** 3, 1e-30);
  const T = unit(Cp);
  // Project Cpp onto plane perpendicular to T to get the principal normal direction
  const CppPerp = sub(Cpp, scale(T, dot(Cpp, T)));
  const N = unit(CppPerp);
  const B = unit(cross(T, N));
  return { kappa, tangent: T, normal: N, binormal: B, point: C0 };
}

/**
 * Build curvature-comb segments along a NURBS curve.
 * Each tine: anchor on the curve, tip at point + N × κ × scale.
 *
 * @param {NURBSCurve} curve
 * @param {number} samples
 * @param {number} kappaScale - mm per unit κ (default 25)
 * @returns {{ tines: [{anchor, tip, kappa}], maxKappa }}
 */
export function curveCurvatureComb(curve, samples = 64, kappaScale = 25) {
  const u0 = curve.uMin, u1 = curve.uMax;
  const tines = [];
  let maxKappa = 0;
  for (let i = 0; i <= samples; i++) {
    const u = u0 + (u1 - u0) * (i / samples);
    const r = curveCurvature(curve, u);
    if (r.kappa > maxKappa) maxKappa = r.kappa;
    const tipOffset = scale(r.normal, r.kappa * kappaScale);
    tines.push({
      u,
      anchor: r.point,
      tip: add(r.point, tipOffset),
      kappa: r.kappa,
    });
  }
  return { tines, maxKappa };
}

/**
 * Render curvature comb to SVG. Projects to the XY plane (drops z).
 */
export function renderCurvatureCombSVG(curve, options = {}) {
  const samples = options.samples ?? 100;
  const kappaScale = options.kappaScale ?? 25;
  const margin = options.marginMm ?? 8;
  const { tines } = curveCurvatureComb(curve, samples, kappaScale);
  const polylinePoints = curve.tessellate(0.05);

  // Compute bounding box in XY
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const p of polylinePoints) {
    if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0];
    if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1];
  }
  for (const t of tines) {
    if (t.tip[0] < xmin) xmin = t.tip[0]; if (t.tip[0] > xmax) xmax = t.tip[0];
    if (t.tip[1] < ymin) ymin = t.tip[1]; if (t.tip[1] > ymax) ymax = t.tip[1];
  }
  const w = (xmax - xmin) + 2 * margin;
  const h = (ymax - ymin) + 2 * margin;
  const project = (p) => [margin + (p[0] - xmin), margin + (ymax - p[1])];

  const out = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">`);
  out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>`);
  // Curve polyline
  let path = '';
  for (let i = 0; i < polylinePoints.length; i++) {
    const [x, y] = project(polylinePoints[i]);
    path += (i === 0 ? `M ${x.toFixed(3)} ${y.toFixed(3)}` : ` L ${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  out.push(`<path d="${path}" fill="none" stroke="black" stroke-width="0.4"/>`);
  // Comb tines
  for (const t of tines) {
    const [x1, y1] = project(t.anchor);
    const [x2, y2] = project(t.tip);
    out.push(`<line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}" stroke="#3060c0" stroke-width="0.18"/>`);
  }
  // Tip envelope
  let envelopePath = '';
  for (let i = 0; i < tines.length; i++) {
    const [x, y] = project(tines[i].tip);
    envelopePath += (i === 0 ? `M ${x.toFixed(3)} ${y.toFixed(3)}` : ` L ${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  out.push(`<path d="${envelopePath}" fill="none" stroke="#c44" stroke-width="0.3"/>`);
  out.push(`<text x="${margin}" y="${h - 2}" font-family="monospace" font-size="3.0">curvature comb · scale ${kappaScale} mm/unit-κ</text>`);
  out.push(`</svg>`);
  return out.join('\n');
}

/**
 * Compute Gaussian + mean + principal curvatures on a NURBS surface
 * at parameter (u, v).
 */
export function surfaceCurvature(surface, u, v, h = 1e-4) {
  const r0 = surface.evalDerivatives(u, v);
  const Su = r0.Su, Sv = r0.Sv;
  // Numerical second derivatives via central difference on the
  // analytic first derivatives.
  const uMin = surface.uMin, uMax = surface.uMax;
  const vMin = surface.vMin, vMax = surface.vMax;
  const eps = h * (uMax - uMin);
  const epv = h * (vMax - vMin);
  // Clip to valid ranges
  const up = Math.min(uMax, u + eps);
  const um = Math.max(uMin, u - eps);
  const vp = Math.min(vMax, v + epv);
  const vm = Math.max(vMin, v - epv);
  const dup = up - um;
  const dvp = vp - vm;
  const rup = surface.evalDerivatives(up, v);
  const rum = surface.evalDerivatives(um, v);
  const rvp = surface.evalDerivatives(u, vp);
  const rvm = surface.evalDerivatives(u, vm);
  // Suu = (Su(u+) - Su(u-)) / dup
  const Suu = scale(sub(rup.Su, rum.Su), 1 / dup);
  const Svv = scale(sub(rvp.Sv, rvm.Sv), 1 / dvp);
  const Suv = scale(sub(rup.Sv, rum.Sv), 1 / dup);  // (∂Sv/∂u via central FD on Sv)

  // Surface unit normal
  const n = r0.normal;

  // First fundamental form
  const E = dot(Su, Su);
  const F = dot(Su, Sv);
  const G = dot(Sv, Sv);
  // Second fundamental form
  const L = dot(Suu, n);
  const M = dot(Suv, n);
  const N = dot(Svv, n);
  const denom = E * G - F * F;
  if (Math.abs(denom) < 1e-30) return { K: 0, H: 0, kMin: 0, kMax: 0 };
  const K = (L * N - M * M) / denom;
  const H = (E * N - 2 * F * M + G * L) / (2 * denom);
  // Principal curvatures: κ_{min,max} = H ∓ √(H² − K)
  const disc = Math.max(H * H - K, 0);
  const sq = Math.sqrt(disc);
  const kMin = H - sq;
  const kMax = H + sq;
  return { K, H, kMin, kMax, point: r0.S, normal: n };
}

/**
 * Convenience: compute curvature stats over a (u, v) grid.
 * Returns { K_min, K_max, K_mean, H_min, H_max, H_mean }.
 */
export function surfaceCurvatureStats(surface, stepsU = 16, stepsV = 16) {
  const Ks = [], Hs = [];
  const u0 = surface.uMin, u1 = surface.uMax;
  const v0 = surface.vMin, v1 = surface.vMax;
  for (let i = 1; i < stepsU; i++) {
    for (let j = 1; j < stepsV; j++) {
      const u = u0 + (u1 - u0) * i / stepsU;
      const v = v0 + (v1 - v0) * j / stepsV;
      const r = surfaceCurvature(surface, u, v);
      Ks.push(r.K);
      Hs.push(r.H);
    }
  }
  const stats = (arr) => ({
    min: Math.min(...arr),
    max: Math.max(...arr),
    mean: arr.reduce((s, v) => s + v, 0) / arr.length,
  });
  return { K: stats(Ks), H: stats(Hs), samples: Ks.length };
}
