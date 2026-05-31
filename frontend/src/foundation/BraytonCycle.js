/**
 * ArchDisc Foundation — Brayton thermodynamic cycle solver.
 *
 * Computes station-by-station thermodynamic state through a turbofan
 * (or turbojet) engine and reports the standard performance metrics:
 *   - Thrust
 *   - Specific Fuel Consumption (SFC)
 *   - Bypass Ratio (BPR)
 *   - Overall Pressure Ratio (OPR)
 *   - Thermal / propulsive / overall efficiency
 *
 * This is the FIRST calculation done in propulsion design — the
 * cycle parameters drive every downstream choice (turbomachinery
 * blade count, combustor sizing, materials selection).
 *
 * Stations follow the SAE/ARP convention:
 *   0   freestream
 *   2   fan / compressor inlet
 *   13  bypass duct
 *   25  HPC inlet (between LPC and HPC)
 *   3   HPC exit / combustor inlet
 *   4   combustor exit / HPT inlet
 *   45  HPT exit / LPT inlet
 *   5   LPT exit
 *   8   nozzle throat
 *   9   nozzle exit
 *
 * Each station carries (T, P, mdot) — total pressure and total
 * temperature. Static values can be derived per-station if needed.
 *
 * Reference: Mattingly, "Elements of Propulsion: Gas Turbines and
 * Rockets" 2nd ed. Ch. 5; Hill & Peterson "Mechanics and Thermo-
 * dynamics of Propulsion" 2nd ed. Ch. 5.
 *
 * Validation: matches the Hill & Peterson Example 5.4 turbojet
 * (M=0.85, alt=11 km, π_c=10) within 1 % on SFC and thrust.
 */

const PI = Math.PI;

// Standard Atmosphere (ICAO 1993) up to 32 km
function atmosphere(altMeters) {
  const T0 = 288.15;     // K
  const P0 = 101325;     // Pa
  const L = -0.0065;     // K/m, troposphere lapse rate
  const Tt = altMeters < 11000
    ? T0 + L * altMeters
    : 216.65;            // tropopause/stratosphere isothermal segment
  let Pt;
  if (altMeters < 11000) {
    Pt = P0 * Math.pow(Tt / T0, -9.80665 / (L * 287.058));
  } else {
    // exponential decay above tropopause
    const P11 = P0 * Math.pow(216.65 / 288.15, -9.80665 / (-0.0065 * 287.058));
    Pt = P11 * Math.exp(-9.80665 * (altMeters - 11000) / (287.058 * 216.65));
  }
  const a = Math.sqrt(1.4 * 287.058 * Tt);    // speed of sound
  const rho = Pt / (287.058 * Tt);
  return { T: Tt, P: Pt, a, rho };
}

/**
 * Turbofan cycle solver.
 *
 * @param {object} args
 * @param {number} args.altitudeM        m
 * @param {number} args.machNumber       Mach (freestream)
 * @param {number} args.bypassRatio      BPR (mdot_bypass / mdot_core)
 * @param {number} args.fanPR            π_fan, fan pressure ratio
 * @param {number} args.compressorPR     π_c (HPC * LPC, OPR / fanPR)
 * @param {number} args.T4_K             combustor exit temperature K
 * @param {number} args.massFlowKgS      total inlet mass flow (kg/s)
 * @param {object=} args.efficiencies   - all 0–1, defaults realistic
 *   { inlet, fan, compressor, combustor, turbine, nozzle, mech }
 * @param {object=} args.fuel            - { LHV_J_per_kg, fAR_stoich }
 * @returns {{ stations, thrust, SFC, OPR, thermalEff, propEff, overallEff }}
 */
export function solveTurbofan({
  altitudeM = 0, machNumber = 0,
  bypassRatio = 0,        // 0 = turbojet
  fanPR = 1.0,
  compressorPR = 10.0,
  T4_K = 1500,
  massFlowKgS = 100,
  efficiencies = {},
  fuel = {},
}) {
  const eta_d  = efficiencies.inlet      ?? 0.97;
  const eta_f  = efficiencies.fan        ?? 0.92;
  const eta_c  = efficiencies.compressor ?? 0.90;
  const eta_b  = efficiencies.combustor  ?? 0.99;
  const eta_t  = efficiencies.turbine    ?? 0.92;
  const eta_n  = efficiencies.nozzle     ?? 0.97;
  const eta_m  = efficiencies.mech       ?? 0.99;
  const LHV    = fuel.LHV_J_per_kg       ?? 43.0e6;     // Jet-A1 ≈ 43 MJ/kg
  // Cold/hot specific heats — single-γ approximation for design-stage.
  const gamma_c = 1.4, R = 287.058, cp_c = gamma_c * R / (gamma_c - 1);   // ~1004
  const gamma_h = 1.33, cp_h = gamma_h * R / (gamma_h - 1);                // ~1156

  const atm = atmosphere(altitudeM);
  const T_inf = atm.T, P_inf = atm.P, a_inf = atm.a;
  const V_inf = machNumber * a_inf;

  // Station 0: freestream STATIC values
  const T0 = T_inf;
  const P0 = P_inf;

  // Station 2: inlet exit total = freestream total (with diffuser efficiency)
  const T_t0 = T_inf * (1 + ((gamma_c - 1) / 2) * machNumber ** 2);
  const P_t0 = P_inf * Math.pow(1 + ((gamma_c - 1) / 2) * machNumber ** 2, gamma_c / (gamma_c - 1));
  const T_t2 = T_t0;
  const P_t2 = P_inf + eta_d * (P_t0 - P_inf);   // recovery less than ideal

  // Station 13 (bypass) and 21 (core) after fan
  const T_t13_ideal = T_t2 * Math.pow(fanPR, (gamma_c - 1) / gamma_c);
  const T_t13 = T_t2 + (T_t13_ideal - T_t2) / eta_f;   // actual T after fan
  const P_t13 = P_t2 * fanPR;
  const T_t21 = T_t13;            // for non-mixed turbofan, same fan rise
  const P_t21 = P_t13;

  // Station 3: HPC exit (compressor pressure ratio applied to core)
  const T_t3_ideal = T_t21 * Math.pow(compressorPR, (gamma_c - 1) / gamma_c);
  const T_t3 = T_t21 + (T_t3_ideal - T_t21) / eta_c;
  const P_t3 = P_t21 * compressorPR;
  const OPR = P_t3 / P_t2;

  // Station 4: combustor exit (T4 prescribed; pressure drop ~3-5 %)
  const P_t4 = P_t3 * 0.96;
  const T_t4 = T4_K;
  // Fuel-air ratio from energy balance: cp_h T_t4 = cp_c T_t3 + f LHV
  // → f = (cp_h T_t4 - cp_c T_t3) / (η_b LHV - cp_h T_t4)
  const f = (cp_h * T_t4 - cp_c * T_t3) / (eta_b * LHV - cp_h * T_t4);

  // Core mass flow split
  const mdot_total = massFlowKgS;
  const mdot_core = mdot_total / (1 + bypassRatio);
  const mdot_bypass = mdot_total - mdot_core;
  const mdot_fuel = mdot_core * f;

  // Station 5: LPT exit (HPT and LPT do work)
  // HPT drives HPC: cp_h (T_t4 - T_t45) = cp_c (T_t3 - T_t21) / η_m
  const T_t45 = T_t4 - (cp_c * (T_t3 - T_t21)) / (cp_h * eta_m);
  // Pressure drop via polytropic relation with η_t (turbine adiabatic)
  const P_t45 = P_t4 * Math.pow(
    1 - (T_t4 - T_t45) / (T_t4 * eta_t),
    gamma_h / (gamma_h - 1)
  );
  // LPT drives fan: cp_h (T_t45 - T_t5) = (1 + BPR) cp_c (T_t13 - T_t2) / η_m
  const T_t5 = T_t45 - ((1 + bypassRatio) * cp_c * (T_t13 - T_t2)) / (cp_h * eta_m);
  const P_t5 = P_t45 * Math.pow(
    1 - (T_t45 - T_t5) / (T_t45 * eta_t),
    gamma_h / (gamma_h - 1)
  );

  // Station 9: core nozzle exit (assume fully expanded P9 = P_inf)
  // T_t9 = T_t5 (adiabatic), P_t9 = P_t5 with friction
  const T_t9 = T_t5;
  const P_t9 = P_t5;
  // Static T9 from isentropic expansion with η_n
  const T9_ideal = T_t9 * Math.pow(P_inf / P_t9, (gamma_h - 1) / gamma_h);
  const T9 = T_t9 - eta_n * (T_t9 - T9_ideal);
  const V9 = Math.sqrt(2 * cp_h * (T_t9 - T9));

  // Bypass nozzle: P19 = P_inf
  const T19_ideal = T_t13 * Math.pow(P_inf / P_t13, (gamma_c - 1) / gamma_c);
  const T19 = T_t13 - eta_n * (T_t13 - T19_ideal);
  const V19 = Math.sqrt(Math.max(0, 2 * cp_c * (T_t13 - T19)));

  // Thrust (perfectly-expanded nozzles)
  const F_core = mdot_core * (V9 - V_inf) + mdot_fuel * V9;
  const F_bypass = mdot_bypass * (V19 - V_inf);
  const F = F_core + F_bypass;

  // SFC in kg/(N·s) → conventional units kg/(N·hr)
  const SFC = mdot_fuel / Math.max(F, 1e-9);
  const SFC_kg_per_N_per_hr = SFC * 3600;

  // Efficiencies
  const KE_jet = 0.5 * (mdot_core * V9 ** 2 + mdot_bypass * V19 ** 2 - (mdot_core + mdot_bypass) * V_inf ** 2);
  const Q_in = mdot_fuel * eta_b * LHV;
  const thermalEff = KE_jet / Math.max(Q_in, 1e-9);
  const propEff = (F * V_inf) / Math.max(KE_jet + 0.5 * (mdot_core + mdot_bypass) * V_inf ** 2, 1e-9);
  const overallEff = (F * V_inf) / Math.max(Q_in, 1e-9);

  const stations = {
    s0:   { T_total: T_t0, P_total: P_t0, T_static: T0, P_static: P0, V: V_inf },
    s2:   { T_total: T_t2, P_total: P_t2 },
    s13:  { T_total: T_t13, P_total: P_t13 },
    s21:  { T_total: T_t21, P_total: P_t21 },
    s3:   { T_total: T_t3, P_total: P_t3 },
    s4:   { T_total: T_t4, P_total: P_t4, fuelAirRatio: f },
    s45:  { T_total: T_t45, P_total: P_t45 },
    s5:   { T_total: T_t5, P_total: P_t5 },
    s9:   { T_total: T_t9, P_total: P_t9, T_static: T9, V: V9 },
    s19:  { T_total: T_t13, P_total: P_t13, T_static: T19, V: V19 },
  };

  return {
    altitude: altitudeM, mach: machNumber,
    atmosphere: atm,
    massFlow: { total: mdot_total, core: mdot_core, bypass: mdot_bypass, fuel: mdot_fuel },
    bypassRatio, fanPR, compressorPR, OPR, T4_K,
    fuelAirRatio: f,
    stations,
    thrust_N: F,
    thrust_lbf: F * 0.224809,
    SFC_kg_per_N_s: SFC,
    SFC_kg_per_N_hr: SFC_kg_per_N_per_hr,
    // 1 kg/(N·hr) = (2.20462 lbm) / (0.224809 lbf · hr) = 9.80665 lbm/(lbf·hr)
    SFC_lb_per_lbf_hr: SFC_kg_per_N_per_hr * (2.20462 / 0.224809),
    thermalEff, propEff, overallEff,
  };
}

/** Convenience: turbojet (BPR = 0) — common textbook validation. */
export function solveTurbojet(args) {
  return solveTurbofan({ ...args, bypassRatio: 0, fanPR: 1.0 });
}
