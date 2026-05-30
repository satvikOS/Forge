/**
 * CopeCut — saddle-cut planning for tube-on-tube weldment joints.
 * The "cope" (also called fishmouth or saddle) is the curved end-cut on
 * the secondary tube that lets it nest cleanly onto the primary's outer
 * surface. It is the flagship weldment op in NX / Creo / SolidWorks and
 * was queued in BrepWeldments.js (Tier-6b note line 67-70).
 *
 * This module is the PLANNER half: pure geometric reasoning about the
 * two axes, no kernel calls. Given primary radius R₁, secondary radius
 * R₂, the (signed) angle between their axes θ, and the perpendicular
 * offset of their axis lines d, it predicts whether a cope is required,
 * how deep it will cut into the secondary, and roughly what arc length
 * the contact edge subtends. The actual material removal is a boolean
 * subtract handled by the foundation Features layer in the tool handler
 * — the planner just tells the caller what to expect.
 *
 * Geometry contract:
 *   Both tube axes are straight lines in 3D. Let a₁ and a₂ be their unit
 *   direction vectors and p₁, p₂ any points on each. Then the signed
 *   shortest distance between the lines is
 *       d_axes = |(p₂ − p₁) · (a₁ × a₂)| / |a₁ × a₂|     (a₁ ∦ a₂)
 *   For parallel axes the same formula collapses to the perpendicular
 *   distance from p₂ to the line through p₁.
 *
 *   The two cylinders intersect ⇔ d_axes < R₁ + R₂.  When they do, the
 *   secondary's end on the primary side is coped: the deepest point of
 *   the cope is at axial coordinate s* on the secondary where the local
 *   radial distance to the primary axis is minimum, and the cope DEPTH
 *   measured from the secondary's flat end is
 *       copeDepth = R₂ + (R₁ − d_axes) / sin θ           (axes-crossing)
 *   — i.e. the closer the axes and the shallower the angle, the deeper
 *   the saddle. We clamp copeDepth ≥ 0; when copeDepth ≤ 0 the cope is
 *   degenerate (tubes don't actually meet).
 *
 *   The contact-edge approximate arc length on the primary's surface is
 *       contactArc ≈ 2 · R₁ · acos( max(0, d_axes / R₁) )
 *   (an upper bound; the true curve is a saddle, not a circle).
 *
 * Edge cases handled honestly:
 *   - Axes parallel and d_axes ≥ R₁ + R₂ → no cope needed (returns
 *     willCut=false with note).
 *   - Axes crossing exactly (d_axes = 0) → full saddle, copeDepth = R₁/sinθ.
 *   - θ ≈ 0 (collinear secondary) → cope formula → ∞; we treat as
 *     "secondary lies along primary, no cope" and flag.
 *
 * No kernel imports — this module is pure JS so it stays unit-testable
 * in Node without WASM init.
 */

const EPS = 1e-9;

const sub  = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot  = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > EPS ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0]; };

/**
 * Signed shortest distance between two infinite lines defined by a
 * point + unit direction each. The result is always ≥ 0; sign would
 * require a chosen "side" reference, which the cope geometry doesn't
 * need (volume booleans don't care).
 */
export function shortestDistanceBetweenLines(p1, d1, p2, d2) {
  const u1 = unit(d1), u2 = unit(d2);
  const c = cross(u1, u2);
  const cn = norm(c);
  const r = sub(p2, p1);
  if (cn < EPS) {
    // Parallel lines: distance from p2 to line(p1, u1) = |r − (r·u1)u1|.
    const tProj = dot(r, u1);
    const proj = [u1[0] * tProj, u1[1] * tProj, u1[2] * tProj];
    return norm(sub(r, proj));
  }
  return Math.abs(dot(r, c)) / cn;
}

/**
 * Plan a tube-on-tube cope given the primary axis (p1, d1, R1) and the
 * secondary axis (p2, d2, R2). Returns:
 *   {
 *     axesDistance,   // perpendicular distance between the axes (mm)
 *     angleRad,       // angle between the axes, ∈ (0, π]
 *     angleDeg,       // angle in degrees
 *     willCut,        // true ⇔ the tubes actually intersect
 *     copeDepth,      // depth of the cope on the secondary (mm), ≥ 0
 *     contactArc,     // upper-bound arc length on the primary (mm)
 *     note,           // human-readable status
 *   }
 *
 * The math assumes straight tubes; for swept/curved members the caller
 * passes the local tangent at the joint as d1 / d2.
 */
export function planCope({ p1, d1, R1, p2, d2, R2 }) {
  if (!(R1 > 0) || !(R2 > 0)) {
    throw new Error('planCope: both radii must be > 0');
  }
  const u1 = unit(d1), u2 = unit(d2);
  const cosA = Math.max(-1, Math.min(1, Math.abs(dot(u1, u2))));   // use abs so θ ∈ [0, π/2]
  const angleRad = Math.acos(cosA);
  const angleDeg = angleRad * 180 / Math.PI;
  const axesDistance = shortestDistanceBetweenLines(p1, u1, p2, u2);

  const willCut = axesDistance < (R1 + R2) - EPS;

  if (angleRad < 1e-3) {
    // Collinear / near-parallel inside the cope window: secondary runs
    // alongside the primary. There's no saddle cope to compute.
    return {
      axesDistance, angleRad, angleDeg, willCut,
      copeDepth: 0, contactArc: 0,
      note: 'axes nearly parallel — no saddle cope geometry; use butt joint or end-cap instead',
    };
  }
  if (!willCut) {
    return {
      axesDistance, angleRad, angleDeg, willCut,
      copeDepth: 0, contactArc: 0,
      note: 'axes too far apart — tubes do not intersect; no cope required',
    };
  }

  // Cope depth: the secondary's wall thickness "lost" to the saddle,
  // measured along the secondary axis from its flat end. The minimum
  // radial distance from the secondary axis to the primary surface is
  // (axesDistance · sin θ − R₁); when negative the surfaces overlap by
  // the same magnitude along the perpendicular, and dividing by sin θ
  // converts that perpendicular overlap back to length along the
  // secondary axis. We add R₂ so the depth is measured from the
  // secondary's outer end (the natural fabricator's measurement).
  const sinA = Math.sin(angleRad);
  const perpOverlap = R1 - axesDistance * sinA;            // ≥ 0 when tubes meet
  const copeDepth = Math.max(0, R2 + perpOverlap / sinA);
  const contactArc = 2 * R1 * Math.acos(Math.max(0, Math.min(1, axesDistance / R1)));

  return {
    axesDistance, angleRad, angleDeg, willCut,
    copeDepth, contactArc,
    note: 'cope will be cut',
  };
}
