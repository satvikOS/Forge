/**
 * ArchDisc Foundation — axial turbine stage mean-line analysis.
 *
 * Counterpart to the compressor mean-line (M57). The turbine
 * extracts work from the hot gas: gas enters with high tangential
 * velocity from the nozzle vane (stator), the rotor turns this
 * tangential momentum into shaft torque, and the gas exits with
 * (mostly) axial velocity.
 *
 * Same Euler work equation:
 *
 *     w  =  U (Δc_θ)  =  cp (T_t,in − T_t,out)
 *
 * but with c_θ DECREASING through the rotor (work extracted) and a
 * negative ΔT_t (cooling). Loading is much higher than a compressor
 * because flow is being accelerated rather than diffused — Smith
 * chart limits ψ ≤ ~2.5 (turbine) vs ψ ≤ ~0.5 (compressor).
 *
 * Notation matches CompressorStage.js for symmetry.
 *
 * Reference: Hill & Peterson Ch 7 (Axial Turbines); Saravanamuttoo
 * "Gas Turbine Theory" 7th ed Ch 6.
 *
 * Validation: HPT stage at engine cruise conditions — typical
 * loading ψ ≈ 1.5–2.0, reaction ≈ 0.50, blade Mach 0.8–1.2.
 */

const PI = Math.PI;
const GAMMA_HOT = 1.33;       // hot gas (Mattingly)
const R_AIR = 287.058;
const CP_HOT = GAMMA_HOT * R_AIR / (GAMMA_HOT - 1);   // ~1156 J/(kg·K)

/**
 * Axial turbine stage mean-line analysis.
 *
 * @param {object} args
 * @param {number} args.massFlowKgS
 * @param {number} args.T_t1_K           rotor inlet total temp (= T4 from cycle)
 * @param {number} args.P_t1_Pa
 * @param {number} args.rpm
 * @param {number} args.r_tip_m
 * @param {number} args.hubToTip
 * @param {number} args.deltaTtotal_K    stage total-T drop (set by Brayton)
 * @param {number=} args.polytropicEff   default 0.90
 * @param {number=} args.alpha1Deg       absolute flow angle leaving stator
 *                                        (typical 65–75° from axial)
 */
export function analyzeTurbineStage({
  massFlowKgS, T_t1_K, P_t1_Pa,
  rpm, r_tip_m, hubToTip,
  deltaTtotal_K,
  polytropicEff = 0.90,
  alpha1Deg = 70,
}) {
  const r_tip = r_tip_m;
  const r_hub = r_tip * hubToTip;
  const r_mean = (r_tip + r_hub) / 2;
  const A = PI * (r_tip * r_tip - r_hub * r_hub);

  // Blade speed
  const omega = rpm * 2 * PI / 60;
  const U_mean = omega * r_mean;
  const U_tip = omega * r_tip;
  const U_hub = omega * r_hub;

  // Stator-exit absolute velocity:
  //   work per stage:  w = U Δc_θ → Δc_θ = cp ΔT / U
  //   c_θ1 (rotor inlet) = c_θ2 (after rotor) + Δc_θ
  // For typical turbine α₂ ≈ 0 (axial exit), c_θ2 ≈ 0:
  //   c_θ1 = cp ΔT / U_mean   at mean
  const c_theta1_mean = CP_HOT * deltaTtotal_K / U_mean;

  // Resolve absolute velocity from α₁:
  //   c_θ1 = c_1 sin α₁,  c_x1 = c_1 cos α₁
  const alpha1 = alpha1Deg * PI / 180;
  const c_x1 = c_theta1_mean / Math.tan(alpha1);   // axial velocity at rotor inlet
  const c1_mag = c_theta1_mean / Math.sin(alpha1);

  // Static temperature (energy conservation, isentropic)
  const T_static_1 = T_t1_K - c1_mag * c1_mag / (2 * CP_HOT);
  const a_static_1 = Math.sqrt(GAMMA_HOT * R_AIR * T_static_1);
  const M1 = c1_mag / a_static_1;

  // Static pressure from total pressure + isentropic relation
  const P_static_1 = P_t1_Pa * Math.pow(T_static_1 / T_t1_K, GAMMA_HOT / (GAMMA_HOT - 1));
  const rho_static_1 = P_static_1 / (R_AIR * T_static_1);

  // Free-vortex: r·c_θ = const → c_θ at any radius
  function station(r) {
    const U = omega * r;
    const c_theta1_r = (r_mean / r) * c_theta1_mean;
    // Assume axial exit (c_θ2 = 0), constant axial vel
    const c_theta2_r = 0;
    const c_x = c_x1;

    // Velocity triangles
    const w_theta1 = c_theta1_r - U;
    const w1 = Math.hypot(c_x, w_theta1);
    const beta1 = Math.atan2(-w_theta1, c_x);
    const w_theta2 = c_theta2_r - U;
    const w2 = Math.hypot(c_x, w_theta2);
    const beta2 = Math.atan2(-w_theta2, c_x);
    const c2 = c_x;            // axial exit
    const alpha2 = 0;
    return {
      radius: r, U,
      c_theta1: c_theta1_r, c_theta2: c_theta2_r,
      w1, w2, c1: Math.hypot(c_x, c_theta1_r), c2,
      alpha1_deg: alpha1Deg, alpha2_deg: alpha2,
      beta1_deg: beta1 * 180 / PI, beta2_deg: beta2 * 180 / PI,
      // For turbines we don't check De Haller (flow accelerates) but
      // we report w2/w1 anyway. w2 should be > w1 because of work
      // extraction in the rotor.
      relativeAccel: w2 / w1,
    };
  }

  const hub  = station(r_hub);
  const mid  = station(r_mean);
  const tip  = station(r_tip);

  // Stage pressure ratio (drop):
  //   π_t = (1 − η_p · ΔT_t / T_t1)^(γ/(γ−1))
  const stagePR_drop = Math.pow(
    1 - polytropicEff * deltaTtotal_K / T_t1_K,
    GAMMA_HOT / (GAMMA_HOT - 1)
  );
  const P_t2 = P_t1_Pa * stagePR_drop;
  const stageWork_kJ_per_kg = CP_HOT * deltaTtotal_K / 1000;
  const stageWork_total_kW = massFlowKgS * stageWork_kJ_per_kg;

  // Loading + flow + reaction
  const loadingPsi = CP_HOT * deltaTtotal_K / (U_mean * U_mean);
  const flowPhi = c_x1 / U_mean;
  // Reaction R = (h2 - h3) / (h1 - h3); for axial exit and free-vortex:
  //   R ≈ 1 − c_θ1_mean / (2 U_mean)
  const reactionMean = 1 - c_theta1_mean / (2 * U_mean);

  // Annulus area / continuity check
  const mdot_check = rho_static_1 * A * c_x1;

  // Blade count
  const aspect = 1.5;       // turbines are typically lower aspect than compressors
  const span = r_tip - r_hub;
  const chord = span / aspect;
  const optimalSolidity = 1.4;   // turbine blades are more solid
  const pitch = chord / optimalSolidity;
  const bladeCount = Math.max(20, Math.round(2 * PI * r_mean / pitch));

  return {
    geometry: { r_tip, r_hub, r_mean, span, chord, pitch, bladeCount, area_m2: A },
    blade_speed: { U_hub, U_mean, U_tip, omega, M_inlet_abs: M1 },
    inlet_state: {
      T_total: T_t1_K, P_total: P_t1_Pa,
      T_static: T_static_1, P_static: P_static_1,
      rho_static: rho_static_1, c1: c1_mag, c_x: c_x1,
    },
    massFlow: { mdot: massFlowKgS, mdot_continuity_check: mdot_check },
    radial: { hub, mid, tip },
    work: {
      deltaTtotal_K,
      stagePR_drop,                   // < 1 (pressure drops through turbine)
      polytropicEff,
      P_t2_Pa: P_t2,
      specific_work_kJ_per_kg: stageWork_kJ_per_kg,
      total_power_kW: stageWork_total_kW,
    },
    nondim: {
      loadingPsi, flowPhi, reactionMean,
    },
    smithChart: {
      // Smith-chart efficiency-loss zones (rough thresholds):
      //   ψ < 1.5, φ ≈ 0.5: high efficiency (η_p ≥ 0.92)
      //   ψ > 2.5: high losses, may need 2 stages
      eff_zone:
        loadingPsi < 1.5 && flowPhi > 0.4 && flowPhi < 0.7 ? 'high_efficiency' :
        loadingPsi < 2.5 ? 'acceptable' : 'too_loaded',
    },
  };
}
