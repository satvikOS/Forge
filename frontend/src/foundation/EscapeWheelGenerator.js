/**
 * ArchDisc Foundation — Swiss-lever escape wheel GEOMETRY generator.
 *
 * Generates the real tooth geometry of a watch escape wheel from first
 * principles — nothing imported. An escape-wheel tooth is NOT an
 * involute: it is a slender tooth raked in the direction of rotation,
 * with a steep locking face (the heel), a small club flat at the tip
 * (the Swiss-lever "club tooth"), a long shallow impulse face, and a
 * throat between teeth.
 *
 * Per tooth, at base angle θ over an angular pitch p = 2π/N:
 *   heel   A  = (θ,                       r_rim)   locking corner
 *   tip    T1 = (θ + lead·p,              r_tip)   leading tip corner
 *   tip    T2 = (θ + (lead+club)·p,       r_tip)   club flat (impulse start)
 *   base   B  = (θ + (1−throat)·p,        r_rim)   end of the impulse face
 *   throat arc along r_rim from B to the next tooth's heel.
 *
 * Honest scope: the functional tooth form of a club-tooth escape wheel.
 * The web is solid (real escape wheels have crossings/spokes — a later
 * refinement); the exact impulse/locking angles are representative, not
 * tuned to a specific calibre.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

/**
 * Build the 2-D profile of a Swiss-lever (club-tooth) escape wheel.
 *
 * @param {object} o
 *   teeth            tooth count (watch escape wheels are typically 15)
 *   rimDiameter_mm   rim (root) diameter
 *   toothHeight_mm   radial tooth height above the rim
 *   clubFrac         club tip flat, as a fraction of the angular pitch
 *   tipLeadFrac      how far the tip leads the heel (fraction of pitch)
 *   throatFrac       throat gap before the next tooth (fraction of pitch)
 *   boreDiameter_mm  centre bore (0 = none)
 * @returns {{ profile, borePolygon, teeth, rimDiameter_mm, tipDiameter_mm,
 *             toothHeight_mm, boreDiameter_mm }}
 */
export function escapeWheelProfile(o = {}) {
  const N = Math.max(6, Math.round(o.teeth ?? 15));
  const rRim = (o.rimDiameter_mm ?? 6) / 2;
  const toothH = o.toothHeight_mm ?? 0.7;
  const rTip = rRim + toothH;
  const clubFrac = Math.max(0, Math.min(0.30, o.clubFrac ?? 0.12));
  const leadFrac = Math.max(0.05, Math.min(0.40, o.tipLeadFrac ?? 0.22));
  const throatFrac = Math.max(0.05, Math.min(0.40, o.throatFrac ?? 0.16));
  const p = (2 * Math.PI) / N;

  const polar = (ang, rad) => [rad * Math.cos(ang), rad * Math.sin(ang)];
  const profile = [];
  const THROAT_SEGS = 3;
  for (let k = 0; k < N; k++) {
    const th = k * p;
    profile.push(polar(th, rRim));                                  // A — heel
    profile.push(polar(th + leadFrac * p, rTip));                   // T1 — tip lead
    profile.push(polar(th + (leadFrac + clubFrac) * p, rTip));      // T2 — club flat end
    profile.push(polar(th + (1 - throatFrac) * p, rRim));           // B — impulse base
    const a0 = th + (1 - throatFrac) * p, a1 = th + p;
    for (let i = 1; i < THROAT_SEGS; i++) {
      profile.push(polar(a0 + (i / THROAT_SEGS) * (a1 - a0), rRim));
    }
  }

  let borePolygon = null;
  const boreR = (o.boreDiameter_mm != null ? o.boreDiameter_mm : Math.max(0.8, rRim * 0.3)) / 2;
  if (boreR > 0.05 && boreR < rRim * 0.9) {
    borePolygon = [];
    const segs = 48;
    for (let i = 0; i < segs; i++) borePolygon.push(polar((-2 * Math.PI * i) / segs, boreR));
  }

  return {
    profile, borePolygon,
    teeth: N,
    rimDiameter_mm: +(2 * rRim).toFixed(4),
    tipDiameter_mm: +(2 * rTip).toFixed(4),
    toothHeight_mm: toothH,
    boreDiameter_mm: borePolygon ? +(2 * boreR).toFixed(4) : 0,
  };
}
