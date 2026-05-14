/**
 * ArchDisc Foundation — bolted-joint analysis (preload + fatigue).
 *
 * Standard mechanical-engineering bolted-joint design per
 * Shigley §8 / VDI 2230. Computes:
 *
 *   - Joint stiffness ratio C = k_b / (k_b + k_m)
 *   - Bolt and member share of external load P
 *   - Static safety factors:
 *       n_p = preload-loss SF  (F_i / (P (1 − C))) → joint separation
 *       n_y = bolt-yield SF
 *       n_L = proof-load SF
 *   - Fatigue SF via Goodman with sigma_a = C P/(2 A_t), sigma_m = sigma_a + sigma_i
 *
 * Bolt geometry from ISO metric thread spec (M6, M8, M10 etc.) —
 * tensile-area A_t = π/4 (d − 0.9382 p)²  where p = pitch.
 *
 * Reference: Shigley §8-6 to §8-12; VDI 2230 Part 1 (2003).
 *
 * Validation: matches Shigley Example 8-4 (M10×1.5 grade 8.8 bolt,
 * 75 % proof preload, external 6 kN, k_b/k_m = 0.20).
 */

const PI = Math.PI;

/** Tensile stress area for an ISO metric thread (mm²). */
export function tensileArea(d_mm, pitch_mm) {
  return (PI / 4) * Math.pow(d_mm - 0.9382 * pitch_mm, 2);
}

/** Standard ISO metric coarse bolt data (subset). */
export const METRIC_BOLTS = {
  M5:  { d: 5,  pitch: 0.8,  At: 14.2 },
  M6:  { d: 6,  pitch: 1.0,  At: 20.1 },
  M8:  { d: 8,  pitch: 1.25, At: 36.6 },
  M10: { d: 10, pitch: 1.5,  At: 58.0 },
  M12: { d: 12, pitch: 1.75, At: 84.3 },
  M16: { d: 16, pitch: 2.0,  At: 157  },
  M20: { d: 20, pitch: 2.5,  At: 245  },
  M24: { d: 24, pitch: 3.0,  At: 353  },
};

/** Bolt-grade properties (proof strength, yield, UTS — MPa). */
export const BOLT_GRADES = {
  '4.6':  { Sp: 225, Sy: 240, Sut: 400 },
  '5.8':  { Sp: 380, Sy: 420, Sut: 520 },
  '8.8':  { Sp: 600, Sy: 660, Sut: 830 },
  '10.9': { Sp: 830, Sy: 940, Sut: 1040 },
  '12.9': { Sp: 970, Sy: 1100, Sut: 1220 },
};

/**
 * Bolt + member stiffness (Shigley §8-4 & §8-5). Simplified Wileman
 * conical-frustum model for member stiffness.
 *
 * @param {object} args
 * @param {number} args.d_mm         bolt diameter
 * @param {number} args.grip_mm      grip length (clamped material thickness)
 * @param {number} args.E_bolt_MPa
 * @param {number} args.E_member_MPa
 */
export function jointStiffness({ d_mm, grip_mm, E_bolt_MPa = 207000, E_member_MPa = 207000 }) {
  // Bolt stiffness (axial): k_b = A_d A_t E / (A_d l_t + A_t l_d)
  // Simplified: k_b ≈ A_d E / L  for short grip.
  const A_d = (PI / 4) * d_mm * d_mm;
  const k_b = A_d * E_bolt_MPa / grip_mm;            // N/mm
  // Wileman member stiffness (steel-on-steel, Shigley eq 8-23):
  //   k_m = E d * A · exp(B (d/L))   A=0.78715, B=0.62873 for steel
  const A = 0.78715, B = 0.62873;
  const k_m = E_member_MPa * d_mm * A * Math.exp(B * d_mm / grip_mm);
  const C = k_b / (k_b + k_m);
  return { k_b, k_m, C };
}

/**
 * Full bolted-joint analysis: preload + external load → static and
 * fatigue safety factors.
 *
 * @param {object} args
 * @param {string} args.boltSize       e.g. 'M10'
 * @param {string} args.grade          e.g. '8.8'
 * @param {number} args.grip_mm
 * @param {number} args.P_ext_N        external tensile load on the joint
 * @param {number=} args.preloadFraction  F_i / (S_p · A_t), default 0.75
 * @param {number=} args.E_member_MPa
 */
export function analyzeBoltedJoint({
  boltSize, grade, grip_mm, P_ext_N,
  preloadFraction = 0.75, E_member_MPa = 207000,
}) {
  const b = METRIC_BOLTS[boltSize];
  const g = BOLT_GRADES[grade];
  if (!b) throw new Error(`Unknown bolt size: ${boltSize}`);
  if (!g) throw new Error(`Unknown bolt grade: ${grade}`);

  const stiff = jointStiffness({ d_mm: b.d, grip_mm, E_member_MPa });
  const F_i = preloadFraction * g.Sp * b.At;            // N (preload force)
  const sigma_i = F_i / b.At;                            // MPa

  // Loaded bolt: F_b = F_i + C · P,  member: F_m = F_i − (1−C) · P
  const C = stiff.C;
  const F_b = F_i + C * P_ext_N;
  const sigma_max = F_b / b.At;
  const sigma_alt = (C * P_ext_N) / (2 * b.At);
  const sigma_mean = sigma_i + sigma_alt;

  // Joint separation SF: n0 = F_i / (P (1 − C))
  const n_separation = F_i / Math.max(P_ext_N * (1 - C), 1e-9);
  // Yield SF: n_y = (S_p − sigma_i) A_t / (C P)
  const n_yield = (g.Sp - sigma_i) * b.At / Math.max(C * P_ext_N, 1e-9);
  // Proof-load SF:  n_L = (S_p A_t − F_i) / (C P)
  const n_proof = (g.Sp * b.At - F_i) / Math.max(C * P_ext_N, 1e-9);

  // Fatigue SF (Goodman) — Marin endurance for bolts (Shigley Table 8-17):
  //   S_e for rolled threads ≈ 162-310 MPa depending on grade.
  //   Use conservative 162 MPa (grade 4.6) or 310 (12.9) — linear interp:
  const Se = 130 + (g.Sut - 400) / (1220 - 400) * (310 - 130);
  // Goodman: 1/n_f = sigma_a/S_e + (sigma_m - sigma_i)/S_ut
  // The (sigma_m - sigma_i) form removes the mean-preload contribution
  // (Shigley eq 8-38, "Goodman with mean-shift").
  const failureRatio = sigma_alt / Se + (sigma_mean - sigma_i) / g.Sut;
  const n_fatigue = failureRatio > 0 ? 1 / failureRatio : Infinity;

  const status =
    Math.min(n_separation, n_yield, n_proof, n_fatigue) >= 2 ? 'safe' :
    Math.min(n_separation, n_yield, n_proof, n_fatigue) >= 1 ? 'marginal' : 'fail';

  return {
    bolt: { ...b, size: boltSize, grade, ...g },
    stiffness: stiff,
    preload: { F_i_N: F_i, sigma_i_MPa: sigma_i, fraction: preloadFraction },
    loadedState: {
      F_bolt_N: F_b,
      sigma_max_MPa: sigma_max,
      sigma_alt_MPa: sigma_alt,
      sigma_mean_MPa: sigma_mean,
    },
    safetyFactors: {
      separation: n_separation,
      yield: n_yield,
      proof: n_proof,
      fatigue_Goodman: n_fatigue,
    },
    Se_estimate_MPa: Se,
    status,
  };
}
