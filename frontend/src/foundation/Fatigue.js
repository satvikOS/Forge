/**
 * ArchDisc Foundation — high-cycle fatigue analysis.
 *
 * Implements the standard design-stage fatigue tools:
 *
 *   - Modified Goodman criterion       σ_a/S_e + σ_m/S_u = 1/n
 *   - Soderberg criterion              σ_a/S_e + σ_m/S_y = 1/n
 *   - Gerber parabolic                 σ_a/S_e + (σ_m/S_u)² = 1/n
 *   - Basquin S-N curve                σ_a = S_f' · (2N)^b
 *
 * Inputs:
 *   - σ_max, σ_min  per location (peak / trough stresses from FEA
 *     applied at extreme load points)
 *   - material (from MaterialDB)
 *   - surface finish factor k_a, size factor k_b, load factor k_c,
 *     temperature factor k_d, reliability factor k_e (Marin factors)
 *
 * Outputs:
 *   - σ_mean, σ_alt
 *   - Endurance limit S_e' = ½ S_u for steel (rotating-beam test);
 *     S_e = S_e' × Π Marin factors
 *   - Goodman / Soderberg / Gerber safety factors
 *   - Cycle life N from Basquin if σ_alt > S_e
 *
 * Reference: Shigley's Mechanical Engineering Design, 10th ed.,
 * Ch. 6 ("Fatigue Failure Resulting from Variable Loading").
 *
 * Stand-alone module — operates on (σ_max, σ_min) numbers; doesn't
 * need a mesh. Wire to a per-element loop after FEA to get a
 * fatigue-life map.
 */

const PI = Math.PI;

/**
 * Compute mean + alternating stress from peak/trough.
 *   σ_mean = (σ_max + σ_min) / 2
 *   σ_alt  = (σ_max − σ_min) / 2
 */
export function meanAltStress(sigmaMax, sigmaMin) {
  return {
    mean: (sigmaMax + sigmaMin) / 2,
    alt: Math.abs(sigmaMax - sigmaMin) / 2,
  };
}

/**
 * Marin endurance limit modification factors (Shigley §6-9).
 *
 * @param {object} args
 * @param {number} args.surfaceFinish  k_a in [0..1]
 *                                       polished     ≈ 1.00
 *                                       ground       ≈ 0.93
 *                                       machined     ≈ 0.85
 *                                       hot-rolled   ≈ 0.70
 *                                       as-forged    ≈ 0.55
 * @param {number} args.size            k_b
 *                                       d ≤ 8 mm: 1.0
 *                                       8 < d ≤ 50 mm: (d/7.62)^-0.107
 *                                       d > 50: ~0.7
 * @param {number} args.load            k_c
 *                                       bending: 1.0
 *                                       axial:   0.85
 *                                       torsion: 0.59
 * @param {number} args.temperature     k_d (≈1 below 450 °C, drops above)
 * @param {number} args.reliability     k_e
 *                                       50%: 1.000
 *                                       90%: 0.897
 *                                       95%: 0.868
 *                                       99%: 0.814
 *                                       99.9%: 0.753
 */
export function marinFactors({
  surfaceFinish = 0.85, size = 1.0, load = 1.0,
  temperature = 1.0, reliability = 0.897,
} = {}) {
  return surfaceFinish * size * load * temperature * reliability;
}

/**
 * Endurance-limit estimate (Shigley §6-7):
 *   For steel:    S_e' = 0.5 S_u   when S_u ≤ 1400 MPa, else 700 MPa
 *   For Al, Ti:   use fatigue.Sf_at_1e6 from material data
 */
export function enduranceLimit(material, marin = 1.0) {
  const Su = material.UTS();
  let SeUncorrected;
  if (material.fatigue && material.fatigue.Sf_at_1e6) {
    SeUncorrected = material.fatigue.Sf_at_1e6;
  } else {
    // Fallback for materials without explicit fatigue data
    SeUncorrected = Math.min(0.5 * Su, 700);
  }
  return SeUncorrected * marin;
}

/**
 * Modified Goodman criterion.
 *   σ_a / S_e + σ_m / S_u = 1 / n
 *   →  n = 1 / (σ_a/S_e + σ_m/S_u)
 *
 * @returns { safetyFactor, failureRatio }
 *   failureRatio = σ_a/S_e + σ_m/S_u   (≤ 1 means safe)
 */
export function goodman(sigmaAlt, sigmaMean, Se, Su) {
  if (Se <= 0 || Su <= 0) return { safetyFactor: 0, failureRatio: Infinity };
  const ratio = sigmaAlt / Se + Math.max(sigmaMean, 0) / Su;
  const n = ratio > 0 ? 1 / ratio : Infinity;
  return { safetyFactor: n, failureRatio: ratio };
}

/** Soderberg (more conservative — uses S_y instead of S_u). */
export function soderberg(sigmaAlt, sigmaMean, Se, Sy) {
  if (Se <= 0 || Sy <= 0) return { safetyFactor: 0, failureRatio: Infinity };
  const ratio = sigmaAlt / Se + Math.max(sigmaMean, 0) / Sy;
  const n = ratio > 0 ? 1 / ratio : Infinity;
  return { safetyFactor: n, failureRatio: ratio };
}

/** Gerber parabolic — less conservative, fits experimental data better. */
export function gerber(sigmaAlt, sigmaMean, Se, Su) {
  if (Se <= 0 || Su <= 0) return { safetyFactor: 0, failureRatio: Infinity };
  const sm_su = Math.max(sigmaMean, 0) / Su;
  const ratio = sigmaAlt / Se + sm_su * sm_su;
  const n = ratio > 0 ? 1 / ratio : Infinity;
  return { safetyFactor: n, failureRatio: ratio };
}

/**
 * Basquin S-N: σ_a = S_f · (N / 1e6)^b   (anchored at 1e6 cycles)
 *
 * - At σ_a = Sf_at_1e6 → life = 1e6 cycles (the convention).
 * - Below the *Marin-corrected* endurance limit Se, life is infinite.
 * - Above, finite life via Basquin extrapolation.
 *
 * @param {number} sigmaAlt   stress amplitude (MPa)
 * @param {Material} material  must expose fatigue: { Sf_at_1e6, slope_b }
 * @param {number=} marin      Marin endurance modifier (default 1.0)
 */
export function basquinLife(sigmaAlt, material, marin = 1.0) {
  if (!material.fatigue) return Infinity;
  const { Sf_at_1e6, slope_b } = material.fatigue;
  // Below the corrected endurance limit → infinite life
  const SeCorrected = Sf_at_1e6 * marin;
  if (sigmaAlt < SeCorrected) return Infinity;
  // At or above corrected limit, extrapolate via Basquin from the
  // 1e6-cycle anchor (use uncorrected Sf because the curve slope is
  // a material property; Marin shifts where the "knee" is).
  // σ_a = Sf · (N / 1e6)^b → N = 1e6 (σ_a/Sf)^(1/b)
  const N = 1e6 * Math.pow(sigmaAlt / Sf_at_1e6, 1 / slope_b);
  return N;
}

/**
 * Full fatigue analysis at a single stress location.
 *
 * @param {object} args
 * @param {number} args.sigmaMax       MPa
 * @param {number} args.sigmaMin       MPa
 * @param {Material} args.material     from MaterialDB
 * @param {object} args.surface        Marin factor inputs
 * @returns {{ mean, alt, Se, Sy, Su, goodman, soderberg, gerber, lifeCycles, status }}
 */
export function analyzeFatigue({
  sigmaMax, sigmaMin, material, surface = {},
}) {
  const { mean, alt } = meanAltStress(sigmaMax, sigmaMin);
  const k = marinFactors(surface);
  const Se = enduranceLimit(material, k);
  const Sy = material.yield();
  const Su = material.UTS();
  const g = goodman(alt, mean, Se, Su);
  const s = soderberg(alt, mean, Se, Sy);
  const r = gerber(alt, mean, Se, Su);
  const N = basquinLife(alt, material, k);
  const status =
    g.safetyFactor < 1 ? 'fail' :
    g.safetyFactor < 1.5 ? 'marginal' : 'safe';
  return {
    mean, alt,
    Se, Sy, Su,
    marinFactor: k,
    goodman: g,
    soderberg: s,
    gerber: r,
    lifeCycles: N,
    status,
  };
}
