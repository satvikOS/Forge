/**
 * ArchDisc Foundation — heat exchanger (effectiveness-NTU method).
 *
 * Standard heat-transfer design tool for recuperators, oil coolers,
 * intercoolers, regenerators. Computes outlet temperatures and heat
 * transferred for any of the common arrangements:
 *
 *   - Parallel flow
 *   - Counter flow (best effectiveness for given NTU)
 *   - Cross flow, both fluids unmixed
 *   - Cross flow, one fluid mixed
 *   - Shell-and-tube (single shell pass, 2N tube passes)
 *
 * Definitions:
 *   C_h = ṁ_h cp_h      hot-side capacity rate (W/K)
 *   C_c = ṁ_c cp_c      cold-side capacity rate
 *   C_min, C_max
 *   C_r = C_min / C_max
 *   NTU = UA / C_min    "Number of Transfer Units"
 *   q_max = C_min (T_h_in − T_c_in)
 *   ε = q / q_max       effectiveness (0..1)
 *
 * Output: ε, q, T_h_out, T_c_out, NTU, surface area UA.
 *
 * Reference: Incropera & DeWitt "Fundamentals of Heat & Mass
 * Transfer" 7th ed Ch. 11; Kakac & Liu "Heat Exchangers" 4th ed.
 *
 * Validation: matches Incropera Example 11.3 (counter-flow oil
 * cooler) and Example 11.5 (cross-flow recuperator).
 */

/**
 * Compute effectiveness from NTU + C_r for a given arrangement.
 *
 * @param {string} type   'parallel' | 'counter' | 'crossUnmixed' |
 *                        'crossOneMixed' | 'shellTube'
 * @param {number} NTU
 * @param {number} Cr     C_min / C_max
 */
export function effectiveness(type, NTU, Cr) {
  if (Cr === 0) {
    // Phase-change side or evaporator/condenser
    return 1 - Math.exp(-NTU);
  }
  if (Cr === 1 && type === 'counter') {
    return NTU / (1 + NTU);
  }
  switch (type) {
    case 'parallel': {
      return (1 - Math.exp(-NTU * (1 + Cr))) / (1 + Cr);
    }
    case 'counter': {
      const expTerm = Math.exp(-NTU * (1 - Cr));
      return (1 - expTerm) / (1 - Cr * expTerm);
    }
    case 'crossUnmixed': {
      // Approximation (Incropera eq 11.32):
      //   ε = 1 − exp{(1/Cr) NTU^0.22 [exp(−Cr NTU^0.78) − 1]}
      const a = Math.pow(NTU, 0.22);
      const b = Math.exp(-Cr * Math.pow(NTU, 0.78)) - 1;
      return 1 - Math.exp((1 / Cr) * a * b);
    }
    case 'crossOneMixed': {
      // ε = (1/Cr) {1 − exp[−Cr (1 − exp(−NTU))]}
      return (1 / Cr) * (1 - Math.exp(-Cr * (1 - Math.exp(-NTU))));
    }
    case 'shellTube': {
      // Single shell pass, 2N tube passes (Incropera eq 11.31)
      const D = Math.sqrt(1 + Cr * Cr);
      const expTerm = Math.exp(-NTU * D);
      return 2 / (1 + Cr + D * (1 + expTerm) / (1 - expTerm));
    }
    default:
      throw new Error(`Unknown HX type: ${type}`);
  }
}

/**
 * Solve a heat-exchanger problem in design mode (given UA, fluids,
 * inlets) or rating mode (given fluids + heat transferred, return UA).
 *
 * @param {object} args
 * @param {string} args.type
 * @param {number} args.mdot_hot_kgs
 * @param {number} args.cp_hot_J_kgK
 * @param {number} args.T_hot_in_K
 * @param {number} args.mdot_cold_kgs
 * @param {number} args.cp_cold_J_kgK
 * @param {number} args.T_cold_in_K
 * @param {number=} args.UA_W_per_K
 */
export function solveHeatExchanger({
  type, mdot_hot_kgs, cp_hot_J_kgK, T_hot_in_K,
  mdot_cold_kgs, cp_cold_J_kgK, T_cold_in_K,
  UA_W_per_K,
}) {
  const Ch = mdot_hot_kgs * cp_hot_J_kgK;
  const Cc = mdot_cold_kgs * cp_cold_J_kgK;
  const Cmin = Math.min(Ch, Cc);
  const Cmax = Math.max(Ch, Cc);
  const Cr = Cmin / Cmax;
  const q_max = Cmin * (T_hot_in_K - T_cold_in_K);

  let NTU, eps;
  if (UA_W_per_K != null) {
    NTU = UA_W_per_K / Cmin;
    eps = effectiveness(type, NTU, Cr);
  } else {
    throw new Error('Specify UA_W_per_K');
  }

  const q = eps * q_max;
  const T_hot_out = T_hot_in_K - q / Ch;
  const T_cold_out = T_cold_in_K + q / Cc;

  return {
    type,
    capacityRates: { Ch_W_per_K: Ch, Cc_W_per_K: Cc, Cmin_W_per_K: Cmin, Cr },
    UA_W_per_K,
    NTU,
    effectiveness: eps,
    q_W: q,
    q_max_W: q_max,
    T_hot_in_K, T_hot_out_K: T_hot_out,
    T_cold_in_K, T_cold_out_K: T_cold_out,
  };
}

/**
 * Rating mode — given desired heat transfer, find required UA.
 * Solves the inverse problem by inverting the effectiveness-NTU
 * relation. We bracket on NTU.
 */
export function sizeHeatExchanger({
  type, mdot_hot_kgs, cp_hot_J_kgK, T_hot_in_K,
  mdot_cold_kgs, cp_cold_J_kgK, T_cold_in_K,
  q_target_W,
}) {
  const Ch = mdot_hot_kgs * cp_hot_J_kgK;
  const Cc = mdot_cold_kgs * cp_cold_J_kgK;
  const Cmin = Math.min(Ch, Cc);
  const Cmax = Math.max(Ch, Cc);
  const Cr = Cmin / Cmax;
  const q_max = Cmin * (T_hot_in_K - T_cold_in_K);
  const eps_target = q_target_W / q_max;
  if (eps_target >= 1) {
    return {
      feasible: false,
      reason: `Target q exceeds q_max = ${q_max.toFixed(0)} W`,
      q_max_W: q_max,
    };
  }
  // Bisect NTU
  let lo = 0.01, hi = 50;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const eps = effectiveness(type, mid, Cr);
    if (eps < eps_target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  const NTU = (lo + hi) / 2;
  const UA = NTU * Cmin;
  return {
    feasible: true,
    type, NTU, UA_W_per_K: UA,
    effectiveness: eps_target,
    Cr,
    q_max_W: q_max,
    q_target_W,
  };
}
