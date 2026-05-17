/**
 * ArchDisc Foundation — involute spur gear GEOMETRY generator.
 *
 * Generates the real tooth geometry of a standard involute spur gear
 * from first principles — nothing imported, no canned model. Every flank
 * is a true involute of the base circle, the curve a gear tooth actually
 * has; the result is a closed 2-D profile the platform's feature kernel
 * extrudes into a real 3-D gear.
 *
 * Involute mathematics (standard, e.g. Shigley / AGMA):
 *
 *   pitch radius      r  = m·N / 2
 *   base radius       r_b = r·cos φ
 *   addendum radius   r_a = r + m          (addendum = 1·module)
 *   root radius       r_f = r − 1.25·m     (dedendum  = 1.25·module)
 *
 *   A point on the involute at roll parameter t:
 *       ρ(t) = r_b·√(1 + t²)               radius
 *       inv(t) = t − arctan(t)             involute (roll) angle
 *
 *   Tooth half-angle at radius ρ(t):
 *       θ(t) = π/(2N) + inv(t_pitch) − inv(t)
 *   so the tooth is exactly the design circular thickness π·m/2 at the
 *   pitch circle and narrows correctly toward the tip — because that is
 *   what a real involute does.
 *
 *   Below the base circle (r_f < r_b, the usual case for N < ~42) the
 *   flank is extended radially inward to the root circle.
 *
 * Honest scope: a standard full-depth involute spur gear (20° default).
 * The root is a circular arc, not a generated trochoid; helical, bevel,
 * profile-shifted and undercut-relieved gears are not covered here.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

/** Involute function via the roll parameter: inv(t) = t − arctan(t). */
const involute = (t) => t - Math.atan(t);

/**
 * Build the 2-D profile of an involute spur gear.
 *
 * @param {object} o
 *   teeth              number of teeth N (>= 6)
 *   module_mm          module m (pitch diameter / N)
 *   pressureAngleDeg   pressure angle φ (default 20)
 *   boreDiameter_mm    centre bore (default auto ≈ 1.5·m); 0 = no bore
 *   ptsPerFlank        involute sampling density (default 12)
 * @returns {{
 *   profile:[[x,y]…],          outer gear boundary, CCW (mm)
 *   borePolygon:[[x,y]…]|null, centre bore, CW (hole), or null
 *   teeth, module_mm, pressureAngleDeg,
 *   pitchDiameter_mm, baseDiameter_mm, addendumDiameter_mm,
 *   rootDiameter_mm, boreDiameter_mm
 * }}
 */
export function involuteGearProfile(o = {}) {
  const N = Math.max(6, Math.round(o.teeth ?? 20));
  const m = o.module_mm ?? 2;
  const phiDeg = o.pressureAngleDeg ?? 20;
  const phi = (phiDeg * Math.PI) / 180;
  const ptsFlank = Math.max(4, Math.round(o.ptsPerFlank ?? 12));

  const r = (m * N) / 2;                     // pitch radius
  const rb = r * Math.cos(phi);              // base radius
  const ra = r + m;                          // addendum (tip) radius
  const rf = r - 1.25 * m;                   // root radius
  const rfEff = Math.max(rf, 0.25 * m);      // guard against a vanishing root

  const rollAt = (rho) => Math.sqrt(Math.max(0, (rho / rb) ** 2 - 1));
  const tPitch = rollAt(r);                  // roll parameter at the pitch circle
  const tTip = rollAt(ra);
  // half-tooth-angle constant: θ(t) = C − inv(t)
  const C = Math.PI / (2 * N) + involute(tPitch);

  // One flank as (radius, angle-from-tooth-centre), root → tip.
  const flank = [];
  if (rf < rb) {
    flank.push({ rho: rfEff, ang: C });      // radial segment, root → base circle
    flank.push({ rho: rb, ang: C });
    for (let i = 1; i <= ptsFlank; i++) {
      const t = (i / ptsFlank) * tTip;
      flank.push({ rho: rb * Math.sqrt(1 + t * t), ang: C - involute(t) });
    }
  } else {
    const tRoot = rollAt(rfEff);
    for (let i = 0; i <= ptsFlank; i++) {
      const t = tRoot + (i / ptsFlank) * (tTip - tRoot);
      flank.push({ rho: rb * Math.sqrt(1 + t * t), ang: C - involute(t) });
    }
  }
  const angTip = Math.max(1e-4, flank[flank.length - 1].ang);

  // Walk all N teeth counter-clockwise into one closed polygon.
  const profile = [];
  const pitchAng = (2 * Math.PI) / N;
  const TIP_SEGS = 4, ROOT_SEGS = 4;
  for (let k = 0; k < N; k++) {
    const ctr = k * pitchAng;
    // minus-side flank: root → tip
    for (const f of flank) {
      profile.push([f.rho * Math.cos(ctr - f.ang), f.rho * Math.sin(ctr - f.ang)]);
    }
    // tooth tip arc
    for (let i = 1; i < TIP_SEGS; i++) {
      const a = ctr - angTip + (i / TIP_SEGS) * (2 * angTip);
      profile.push([ra * Math.cos(a), ra * Math.sin(a)]);
    }
    // plus-side flank: tip → root
    for (let i = flank.length - 1; i >= 0; i--) {
      const f = flank[i];
      profile.push([f.rho * Math.cos(ctr + f.ang), f.rho * Math.sin(ctr + f.ang)]);
    }
    // root arc to the next tooth
    const a0 = ctr + C, a1 = (k + 1) * pitchAng - C;
    for (let i = 1; i < ROOT_SEGS; i++) {
      const a = a0 + (i / ROOT_SEGS) * (a1 - a0);
      profile.push([rfEff * Math.cos(a), rfEff * Math.sin(a)]);
    }
  }

  // Centre bore — a clockwise circle so the kernel treats it as a hole.
  let borePolygon = null;
  const boreR = (o.boreDiameter_mm != null ? o.boreDiameter_mm : Math.max(1.5 * m, 0.6 * rfEff)) / 2;
  if (boreR > 0.1 && boreR < rfEff * 0.92) {
    borePolygon = [];
    const segs = 64;
    for (let i = 0; i < segs; i++) {
      const a = (-2 * Math.PI * i) / segs;   // CW → hole
      borePolygon.push([boreR * Math.cos(a), boreR * Math.sin(a)]);
    }
  }

  return {
    profile, borePolygon,
    teeth: N, module_mm: m, pressureAngleDeg: phiDeg,
    pitchDiameter_mm: +(2 * r).toFixed(4),
    baseDiameter_mm: +(2 * rb).toFixed(4),
    addendumDiameter_mm: +(2 * ra).toFixed(4),
    rootDiameter_mm: +(2 * rfEff).toFixed(4),
    boreDiameter_mm: borePolygon ? +(2 * boreR).toFixed(4) : 0,
    circularPitch_mm: +(Math.PI * m).toFixed(4),
  };
}
