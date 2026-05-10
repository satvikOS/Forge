/**
 * ArchDisc Foundation — weld fatigue per IIW recommendations.
 *
 * Implements the standard structural-hot-spot S-N approach used in
 * aerospace mounts, pylons, engine frames, automotive chassis, ship
 * structures, offshore platforms. Reference:
 *   IIW Document XIII-2151r4-07 / XV-1254r4-07 (2008):
 *   "Recommendations for Fatigue Design of Welded Joints and
 *    Components"
 *   Hobbacher, Springer 2nd ed (2016).
 *
 * Concepts:
 *
 *   - **FAT class**: nominal-stress S-N reference value at 2 × 10⁶
 *     cycles, in MPa. e.g. FAT 80 = 80 MPa stress range survives
 *     2e6 cycles at 95 % survival.
 *
 *   - **m = 3**: S-N slope for normal-stress-dominant welds in the
 *     finite-life region. Below the variable-amplitude knee (1e7
 *     cycles) the slope changes to m = 5 (low-cycle still 3).
 *
 *   - **Structural hot-spot stress (HSS)**: extrapolation of FE
 *     stresses to the weld toe, removing notch effects. Per IIW:
 *       σ_hss = 1.67 σ(0.4t) − 0.67 σ(1.0t)        (for plate)
 *     where t is plate thickness and stresses are sampled along the
 *     surface ahead of the weld toe.
 *
 *   - **Standard FAT catalogue** (subset most-used in aerospace):
 *       FAT 100  ground butt weld, full penetration, NDT cleared
 *       FAT  90  butt weld, ground flush
 *       FAT  80  butt weld, as-welded (normal NDT)
 *       FAT  71  fillet weld toe at T-joint, transverse load
 *       FAT  63  fillet weld toe, longitudinal stiffener attachment
 *       FAT  56  cruciform, partial-penetration, transverse
 *       FAT  45  fillet weld root failure
 *       FAT  36  load-carrying cruciform fillet, root failure
 *
 * Output is a strength-ratio (load multiplier to FAT failure at
 * 2e6 cycles) + a Basquin-style life prediction.
 */

const PI = Math.PI;

/**
 * Subset of the IIW FAT catalogue (Hobbacher 2016, Tables 3.1-3.5).
 * Each entry: { fat, slope_m, description }
 */
export const FAT_CLASSES = {
  FAT100_butt_ground:  { fat: 100, slope_m: 3, desc: 'Butt weld, ground flush, NDT cleared' },
  FAT90_butt_ground:   { fat:  90, slope_m: 3, desc: 'Butt weld, ground flush' },
  FAT80_butt_aswelded: { fat:  80, slope_m: 3, desc: 'Butt weld, as-welded, normal NDT' },
  FAT71_T_toe:         { fat:  71, slope_m: 3, desc: 'T-joint fillet, weld toe, transverse load' },
  FAT63_long_stiffener:{ fat:  63, slope_m: 3, desc: 'Longitudinal stiffener attachment' },
  FAT56_cruciform_pp:  { fat:  56, slope_m: 3, desc: 'Cruciform partial-penetration, transverse' },
  FAT45_fillet_root:   { fat:  45, slope_m: 3, desc: 'Fillet weld root failure' },
  FAT36_cruciform_root:{ fat:  36, slope_m: 3, desc: 'Load-carrying cruciform, root failure' },
};

/**
 * Structural hot-spot stress extrapolation per IIW (linear, 0.4t/1.0t
 * reference points on the plate surface ahead of the weld toe).
 *
 *   σ_hss = 1.67 σ(0.4t) − 0.67 σ(1.0t)
 *
 * Caller passes the two FE-evaluated surface stresses; this returns
 * the structural hot-spot stress at the weld toe (toe at x = 0).
 */
export function structuralHotSpotStress({ sigma_at_0p4t, sigma_at_1p0t }) {
  return 1.67 * sigma_at_0p4t - 0.67 * sigma_at_1p0t;
}

/**
 * Quadratic IIW extrapolation (more accurate for high-bending
 * stress fields). Three reference points: 0.4t, 0.9t, 1.4t.
 *
 *   σ_hss = 2.52 σ(0.4t) − 2.24 σ(0.9t) + 0.72 σ(1.4t)
 */
export function structuralHotSpotStressQuadratic({ s_0p4t, s_0p9t, s_1p4t }) {
  return 2.52 * s_0p4t - 2.24 * s_0p9t + 0.72 * s_1p4t;
}

/**
 * IIW S-N: cycles to failure for a stress RANGE Δσ at given FAT
 * class. Two-segment curve:
 *   - High-cycle slope m₁ = 3 (or as specified) up to N = 1e7
 *   - Beyond 1e7 the slope becomes m₂ = 5 (variable amplitude knee)
 *   - Constant amplitude endurance at FAT × (2e6/1e7)^(1/3) ≈ FAT × 0.585
 *     i.e. 36.6 % drop from 2e6 to 1e7 cycles for steel.
 *
 * @param {number} stressRange    Δσ (MPa)
 * @param {object} fatClass       { fat, slope_m }
 * @returns {number} N cycles to failure (Infinity below endurance)
 */
export function fatCyclesToFailure(stressRange, fatClass) {
  const { fat, slope_m } = fatClass;
  const m1 = slope_m;
  const m2 = 2 * m1 - 1;       // IIW post-knee slope
  const N_anchor = 2e6;        // FAT defined here
  const N_knee = 1e7;          // amplitude regime change
  if (stressRange <= 0) return Infinity;

  // Stress at the knee on the m₁-segment:
  //   ΔS_knee = FAT (2e6/1e7)^(1/m₁)
  const dS_knee = fat * Math.pow(N_anchor / N_knee, 1 / m1);

  if (stressRange >= fat) {
    // Below 2e6: solve fat^m1 · 2e6 = ΔS^m1 · N
    return N_anchor * Math.pow(fat / stressRange, m1);
  } else if (stressRange >= dS_knee) {
    // Between 2e6 and 1e7: still m₁ slope
    return N_anchor * Math.pow(fat / stressRange, m1);
  } else {
    // Below the knee — m₂ slope segment
    // Continuity at knee: ΔS_knee^m1 · N_knee = ΔS_knee^m2 · N_knee
    // → ΔS_kneeₘ₂ = ΔS_knee  is the anchor for m₂ at N_knee.
    // For ΔS < ΔS_knee:  N = N_knee · (dS_knee / ΔS)^m₂
    if (stressRange < dS_knee * 0.5) return Infinity;   // beyond cutoff
    return N_knee * Math.pow(dS_knee / stressRange, m2);
  }
}

/**
 * Strength ratio at 2×10⁶ cycles: how much can the load grow before
 * the weld fails the FAT criterion?
 *
 *   R = FAT / Δσ_applied
 *
 *   R > 1 → safe at 2×10⁶ cycles
 *   R < 1 → finite life (use fatCyclesToFailure for N).
 */
export function strengthRatio(stressRange, fatClass) {
  if (stressRange <= 0) return Infinity;
  return fatClass.fat / stressRange;
}

/**
 * Full weld-fatigue assessment for one location.
 *
 * @param {object} args
 * @param {string} args.detail        FAT_CLASSES key
 * @param {number} args.stressRange   Δσ (MPa, structural hot-spot)
 * @param {number=} args.thickness    plate thickness (mm) for size correction
 * @param {number=} args.targetCycles design life
 * @returns {{ fat, life, strengthRatio, sizeFactor, status }}
 */
export function assessWeld({ detail, stressRange, thickness = 25, targetCycles = 2e6 }) {
  const cls = FAT_CLASSES[detail];
  if (!cls) throw new Error(`Unknown weld detail: ${detail}`);
  // IIW thickness correction (for t > 25 mm reduce FAT)
  // FAT_eff = FAT × (25/t)^0.2
  const sizeFactor = thickness > 25 ? Math.pow(25 / thickness, 0.2) : 1.0;
  const fatEff = cls.fat * sizeFactor;
  const effectiveCls = { fat: fatEff, slope_m: cls.slope_m };
  const N = fatCyclesToFailure(stressRange, effectiveCls);
  const R = strengthRatio(stressRange, effectiveCls);
  const meets = N >= targetCycles;
  const status = R >= 1.5 ? 'safe' : R >= 1.0 ? 'marginal' : 'fail';
  return {
    detail, description: cls.desc,
    fat: cls.fat, fatEffective: fatEff, sizeFactor,
    stressRange,
    cyclesToFailure: N,
    strengthRatio: R,
    targetCycles,
    meetsLife: meets,
    status,
  };
}
