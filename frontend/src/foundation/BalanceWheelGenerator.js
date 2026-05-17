/**
 * ArchDisc Foundation — balance wheel GEOMETRY generator.
 *
 * Generates the real geometry of a watch balance wheel from scratch — an
 * annular rim carried by N straight arms from a central hub, the open
 * sectors between the arms left as cut-outs, a central bore for the
 * balance staff. The balance wheel is the watch's oscillating mass; its
 * geometry is a rim ring + arms + hub, not a primitive disc.
 *
 * Built as a profile-with-holes: the outer boundary is the rim's outer
 * circle; the open sectors between arms are CW holes; the staff bore is
 * a CW hole. The kernel's CrossSection fills the outer and subtracts the
 * holes, leaving rim + arms + hub.
 *
 *   r_out = rim outer radius          arms span r_hub → r_in
 *   r_in  = r_out − rimWidth          rim ring spans r_in → r_out
 *   each arm: constant physical width → angular half-width = w/(2·ρ)
 *
 * Honest scope: rim + arms + hub + bore. Rim timing screws / poising
 * weights and a non-circular (e.g. Guillaume) rim are later refinements.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const circle = (rad, ccw, segs = 96) => {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (ccw ? 1 : -1) * (2 * Math.PI * i) / segs;
    pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }
  return pts;
};

const signedArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

/**
 * Build the 2-D profile (+ holes) of a balance wheel.
 *
 * @param {object} o
 *   rimDiameter_mm    outer diameter (default 10)
 *   rimWidth_mm       radial thickness of the rim ring (default 0.9)
 *   arms              number of arms (default 2)
 *   armWidth_mm       physical width of each arm (default 0.9)
 *   hubDiameter_mm    hub outer diameter (default 2.4)
 *   boreDiameter_mm   centre bore for the balance staff (default 0.6)
 * @returns {{ profile, holes:[…], rimDiameter_mm, rimInnerDiameter_mm,
 *             arms, hubDiameter_mm, boreDiameter_mm }}
 */
export function balanceWheelProfile(o = {}) {
  const rOut = (o.rimDiameter_mm ?? 10) / 2;
  const rimW = o.rimWidth_mm ?? 0.9;
  const rIn = Math.max(0.6, rOut - rimW);
  const nArms = Math.max(2, Math.round(o.arms ?? 2));
  const armW = o.armWidth_mm ?? 0.9;
  const rHub = Math.min(rIn - 0.3, (o.hubDiameter_mm ?? 2.4) / 2);
  const boreR = (o.boreDiameter_mm ?? 0.6) / 2;

  const profile = circle(rOut, true);          // rim outer boundary, CCW

  const arcPts = (rad, a0, a1, n) => {
    const p = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (a1 - a0);
      p.push([rad * Math.cos(a), rad * Math.sin(a)]);
    }
    return p;
  };

  // open sector between each pair of adjacent arms → a CW hole
  const holes = [];
  for (let k = 0; k < nArms; k++) {
    const a0 = (k * 2 * Math.PI) / nArms;
    const a1 = ((k + 1) * 2 * Math.PI) / nArms;
    const eRimK = a0 + armW / 2 / rIn,  eRimK1 = a1 - armW / 2 / rIn;
    const eHubK = a0 + armW / 2 / rHub, eHubK1 = a1 - armW / 2 / rHub;
    if (eRimK1 <= eRimK || eHubK1 <= eHubK) continue;   // arms too wide — no gap
    const hole = [
      ...arcPts(rIn, eRimK, eRimK1, 18),     // along the rim inner edge
      ...arcPts(rHub, eHubK1, eHubK, 10),    // back along the hub outer edge
    ];
    if (signedArea(hole) > 0) hole.reverse();           // ensure CW (a hole)
    holes.push(hole);
  }
  // staff bore
  if (boreR > 0.05 && boreR < rHub * 0.92) holes.push(circle(boreR, false, 48));

  return {
    profile, holes,
    rimDiameter_mm: +(2 * rOut).toFixed(4),
    rimInnerDiameter_mm: +(2 * rIn).toFixed(4),
    arms: nArms,
    hubDiameter_mm: +(2 * rHub).toFixed(4),
    boreDiameter_mm: boreR > 0.05 && boreR < rHub * 0.92 ? +(2 * boreR).toFixed(4) : 0,
  };
}
