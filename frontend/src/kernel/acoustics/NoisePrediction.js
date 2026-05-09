/**
 * ArchDisc — Aircraft Engine Noise Prediction
 *
 * Computes approximate noise margin per FAR Part 36 / ICAO Annex 16
 * Chapter 14 at the three certification measurement points:
 *
 *   1. Lateral (sideline)  — full-power takeoff, 450m offset
 *   2. Flyover             — full-power, then cutback to climb power
 *   3. Approach            — 4° glideslope, 120m altitude
 *
 * Uses the GE Aviation / NASA simplified noise correlations:
 *   - Fan noise: ESDU 95023 / NASA TM 100016 fan-noise model
 *   - Jet noise: SAE ARP 876 (Stone) jet-mixing noise
 *   - Combustor: NASA TM 79096 lean-combustor noise (negligible at idle)
 *   - Turbine: NASA TM 87053 turbine tone + broadband
 *
 * Output is EPNdB (effective perceived noise) — the cert metric.
 *
 * Reference: ICAO CAEP 9 reports, GE9X application TC4-2.
 */

const REF_PNL_DB = 20;  // arbitrary 20 µPa reference
const SAFETY_MARGIN_DB = 1.0;  // typical certification margin

export default class NoisePrediction {

  /**
   * Compute noise at the three cert points for a given engine cycle.
   *
   * @param {object} cycle - output from BraytonCycle.analyze({takeoff})
   * @param {object} options
   *   fanDiameter_m, fanBladeCount, FPR
   * @returns {object} { lateral, flyover, approach, cumulativeMargin }
   */
  static analyze(cycle, options = {}) {
    const {
      fanDiameter_m = 3.40,
      fanBladeCount = 16,
      FPR = 1.45,
    } = options;

    // Extract operating-point quantities
    const massFlow = cycle.flows.massFlow_total_kg_s;
    const m_bypass = cycle.flows.massFlow_bypass_kg_s;
    const m_core = cycle.flows.massFlow_core_kg_s;
    const v_bp = cycle.performance.exitVelocity_bypass_m_s;
    const v_core = cycle.performance.exitVelocity_core_m_s;
    const Tt2 = cycle.stations['2'].Tt;
    const Tt13 = cycle.stations['13'].Tt;

    // ---- Fan noise ----
    // Tip Mach number (relevant when supersonic for "buzz-saw" tone)
    const fanArea = Math.PI * Math.pow(fanDiameter_m / 2, 2);
    const fanTipSpeed = NoisePrediction._fanTipSpeed(massFlow, Tt2, FPR, fanArea);
    const speedOfSound = Math.sqrt(1.4 * 287 * Tt2);
    const tipMach = fanTipSpeed / speedOfSound;
    // Fan source PWL (sound power level): correlation with FPR, mass flow, blade count
    // PWL_fan ≈ 10 log10(massFlow) + 50 log10(FPR) + 10 log10(blades) + 80
    const fanPWL = 10 * Math.log10(Math.max(1, massFlow)) +
                   50 * Math.log10(FPR) +
                   10 * Math.log10(fanBladeCount) + 80;
    // Buzz-saw boost when tip supersonic
    const buzzSaw = tipMach > 1.0 ? 5 * (tipMach - 1.0) : 0;

    // ---- Jet noise (Stone 1976 / SAE ARP 876) ----
    // Mixed-jet velocity: mass-weighted average of bypass + core
    const v_mixed = (m_bypass * v_bp + m_core * v_core) / massFlow;
    // Stone correlation: PWL_jet ≈ 80 + 75 log10(v_mixed/300) + 10 log10(massFlow / 100)
    const jetPWL = 80 + 75 * Math.log10(Math.max(50, v_mixed) / 300) +
                   10 * Math.log10(massFlow / 100);

    // ---- Turbine noise ----
    // Rough order: PWL_turbine ≈ jetPWL - 15 (much quieter than jet at takeoff)
    const turbinePWL = jetPWL - 15;

    // Combine via 10*log10 sum of intensities
    const totalPWL = NoisePrediction._sumDB([fanPWL + buzzSaw, jetPWL, turbinePWL]);

    // Convert to EPNdB at each measurement point
    // Approximation: SPL = PWL - 20*log10(distance_m) - 11
    function epnAt(distance_m, dirCorrection_db = 0) {
      const spl = totalPWL - 20 * Math.log10(distance_m) - 11;
      // EPNL is SPL + ≈3 dB tone correction + 5 dB duration correction
      return spl + 8 + dirCorrection_db;
    }

    // Cert reference distances (from FAA AC 36-1H / ICAO Annex 16)
    const lateralDist = 450;     // m sideline
    const flyoverDist = 700;     // m altitude × distance to mic
    const approachDist = 120;    // m glide-slope mic

    const lateral = {
      EPNdB: epnAt(lateralDist, 0),
      distance_m: lateralDist,
    };
    const flyover = {
      EPNdB: epnAt(flyoverDist, -3),  // cutback gives ~3 dB
      distance_m: flyoverDist,
    };
    const approach = {
      // Approach: lower thrust setting, ~6 dB lower jet
      EPNdB: epnAt(approachDist, 0) - 6,
      distance_m: approachDist,
    };

    // Chapter 14 cumulative limits (for >272 t MTOW aircraft):
    //   Lateral:  103 EPNdB
    //   Flyover:   99 EPNdB
    //   Approach: 105 EPNdB
    //   Cumulative: 17 EPNdB margin below the sum of the 3 limits
    const ch14Limits = { lateral: 103, flyover: 99, approach: 105 };
    const margin = {
      lateral:  +(ch14Limits.lateral - lateral.EPNdB).toFixed(1),
      flyover:  +(ch14Limits.flyover - flyover.EPNdB).toFixed(1),
      approach: +(ch14Limits.approach - approach.EPNdB).toFixed(1),
    };
    margin.cumulative = +(margin.lateral + margin.flyover + margin.approach).toFixed(1);

    return {
      sources: {
        fanPWL: +fanPWL.toFixed(1),
        buzzSawAdd: +buzzSaw.toFixed(1),
        jetPWL: +jetPWL.toFixed(1),
        turbinePWL: +turbinePWL.toFixed(1),
        totalPWL: +totalPWL.toFixed(1),
      },
      conditions: {
        fanTipSpeed_m_s: +fanTipSpeed.toFixed(0),
        fanTipMach: +tipMach.toFixed(2),
        mixedJetVelocity_m_s: +v_mixed.toFixed(0),
      },
      certPoints: {
        lateral:  { EPNdB: +lateral.EPNdB.toFixed(1),  distance_m: lateralDist,  limit: ch14Limits.lateral,  margin: margin.lateral },
        flyover:  { EPNdB: +flyover.EPNdB.toFixed(1),  distance_m: flyoverDist,  limit: ch14Limits.flyover,  margin: margin.flyover },
        approach: { EPNdB: +approach.EPNdB.toFixed(1), distance_m: approachDist, limit: ch14Limits.approach, margin: margin.approach },
      },
      cumulativeMargin_EPNdB: margin.cumulative,
      ch14Compliant: margin.cumulative > 17,
    };
  }

  /** Approximate fan tip speed from cycle quantities. */
  static _fanTipSpeed(massFlow, Tt2, FPR, fanArea) {
    // Specific work absorbed by the fan: Δh = Cp×(Tt13 - Tt2) ≈ Cp×Tt2×(FPR^((γ-1)/γ) - 1)
    const dh = 1005 * Tt2 * (Math.pow(FPR, 0.286) - 1);
    // Fan stage loading coefficient ψ ≈ 0.4 (typical) → U_tip = sqrt(Δh/ψ)
    return Math.sqrt(dh / 0.4);
  }

  /** Sum dB levels (incoherent sources). */
  static _sumDB(levels) {
    let sum = 0;
    for (const L of levels) sum += Math.pow(10, L / 10);
    return 10 * Math.log10(sum);
  }
}
