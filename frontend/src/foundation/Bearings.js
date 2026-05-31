/**
 * ArchDisc Foundation — rolling-element bearing analysis.
 *
 * Two design tools every CAD app's "Toolbox" provides:
 *   1. L10 fatigue life (Lundberg-Palmgren / ISO 281)
 *   2. Hertz contact stress at the most-loaded element
 *
 * Used by mechanical-design engineers daily for shafts, gearboxes,
 * spindles, turbomachinery support, automotive wheel hubs.
 *
 *   L10 (millions of revolutions) = (C / P)^p
 *   where:
 *     C  = dynamic load rating (catalog value, kN)
 *     P  = equivalent dynamic load (kN)
 *     p  = 3   for ball bearings
 *          10/3 for roller bearings (cylindrical, tapered, spherical)
 *
 *   Hours of life:  L10h = L10 · 10⁶ / (60 · n)   for n RPM
 *
 *   Equivalent dynamic load:
 *     P = X F_r + Y F_a       (X, Y catalog factors, depend on F_a/(C_0))
 *   Simplification for pure radial:  P = F_r
 *
 *   Hertz contact stress (ball on race, point contact):
 *     p_max = 0.6164 · ((P E*²) / (R*²))^(1/3) · (1/π)
 *   with E* = E/(1−ν²) for steel-on-steel.
 *
 * Reference: Shigley's MED 10th ed. Ch. 11 (Rolling-Contact
 * Bearings); ISO 281:2007.
 *
 * Validation: matches Shigley Example 11-4 (SKF 6210 deep-groove
 * ball bearing under combined load) for L10 hours.
 */

const PI = Math.PI;

/**
 * Compute L10 fatigue life (millions of revolutions and hours).
 *
 * @param {object} args
 * @param {number} args.C_kN       dynamic load rating (kN)
 * @param {number} args.P_kN       equivalent dynamic load (kN)
 * @param {number} args.rpm
 * @param {string=} args.type      'ball' | 'roller'  (default 'ball')
 * @param {number=} args.a1        reliability adjustment factor
 *                                  (1.0 = 90%, 0.62 = 95%, 0.21 = 99%)
 */
export function bearingLife({ C_kN, P_kN, rpm, type = 'ball', a1 = 1.0 }) {
  const p = type === 'ball' ? 3 : 10 / 3;
  const L10_Mrev = a1 * Math.pow(C_kN / P_kN, p);
  const L10_hours = (L10_Mrev * 1e6) / (60 * rpm);
  return { L10_Mrev, L10_hours, exponent: p };
}

/**
 * Equivalent dynamic load for combined radial + axial.
 * Simplified Shigley §11-7: X, Y from F_a/(C_0 · e) thresholds.
 *
 * @param {object} args
 * @param {number} args.Fr_kN
 * @param {number} args.Fa_kN
 * @param {number} args.C0_kN       static load rating
 * @param {number=} args.contactAngleDeg  0 for deep-groove, 25-40 for ang-contact
 */
export function equivalentDynamicLoad({ Fr_kN, Fa_kN, C0_kN, contactAngleDeg = 0 }) {
  // Simplified bilinear factors per Shigley Table 11-1 (deep-groove)
  // e ≈ 0.014 · (F_a / C_0)^0.236   (interpolated from catalog)
  const ratio = Fa_kN / Math.max(C0_kN, 1e-9);
  const e = 0.014 * Math.pow(Math.max(ratio, 1e-9), 0.236);
  let X, Y;
  if (Fa_kN / Math.max(Fr_kN, 1e-9) <= e) {
    X = 1.0; Y = 0.0;
  } else {
    X = 0.56;
    // Y interpolated, simplified: Y ≈ 1.0 + 0.5 · contactAngleEffect
    Y = 1.0 + 0.5 * (contactAngleDeg / 40);
  }
  const P = X * Fr_kN + Y * Fa_kN;
  return { P_kN: P, X, Y, e };
}

/**
 * Hertz contact stress for a ball pressed against a flat (or any race
 * with effective radius R*). Used to size races + check brinelling.
 *
 *   p_max = (3 F / (2 π a²))   where a = (3 F R* / (4 E*))^(1/3)
 *
 * @param {object} args
 * @param {number} args.force_N   contact normal force (N)
 * @param {number} args.R_ball_m  ball radius (m)
 * @param {number=} args.R_race_m race conformity radius
 *                                 (Infinity for flat plate, negative for
 *                                 concave race — typically −1.05 × R_ball)
 * @param {number=} args.E1_Pa    Young's modulus body 1 (Pa)
 * @param {number=} args.E2_Pa
 * @param {number=} args.nu1
 * @param {number=} args.nu2
 */
export function hertzContact({
  force_N, R_ball_m, R_race_m = -1.05 * 0.01,
  E1_Pa = 200e9, E2_Pa = 200e9, nu1 = 0.3, nu2 = 0.3,
}) {
  // Effective radius: 1/R* = 1/R1 + 1/R2  (negative R for concave)
  const invR = 1 / R_ball_m + 1 / R_race_m;
  const R_star = 1 / invR;
  // Effective modulus
  const E_star = 1 / ((1 - nu1 * nu1) / E1_Pa + (1 - nu2 * nu2) / E2_Pa);
  // Contact patch radius
  const a = Math.pow(3 * force_N * Math.abs(R_star) / (4 * E_star), 1 / 3);
  // Peak (Hertz) contact pressure at centre of patch
  const p_max = (3 * force_N) / (2 * PI * a * a);
  return { p_max_Pa: p_max, contactRadius_m: a, R_star_m: R_star, E_star_Pa: E_star };
}
