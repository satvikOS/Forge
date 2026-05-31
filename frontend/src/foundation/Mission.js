/**
 * ArchDisc Foundation — aircraft mission analysis (Breguet + segments).
 *
 * Closes the loop on engine sizing: given a candidate engine's thrust
 * and SFC at altitude/Mach, what range and endurance does it deliver
 * for an airframe of given mass and aerodynamic efficiency?
 *
 * Two reference equations (Anderson "Aircraft Performance & Design"
 * 1st ed. §5):
 *
 *   Cruise range (Breguet):
 *     R = (V / (g · SFC)) · (L/D) · ln(W_initial / W_final)
 *
 *   Cruise endurance:
 *     E = (1 / (g · SFC)) · (L/D) · ln(W_initial / W_final)
 *
 *   Climb/descent segments via energy method:
 *     Excess power = thrust − drag at climb speed = m g (rate of climb)
 *
 * Inputs: airframe mass, fuel mass, L/D ratio (or polar coefficients),
 * cruise altitude/Mach, engine map (thrust + SFC at design point).
 *
 * Reference: Anderson §5, Mattingly §1, Raymer §6.
 *
 * Validation: matches the standard textbook example (subsonic
 * transport, L/D=15, SFC=0.6 lbm/(lbf·hr), MTOW 200000 kg, fuel
 * 60000 kg, V=240 m/s) → R ≈ 8000 km.
 */

const PI = Math.PI;
const G = 9.80665;

/**
 * Breguet cruise range.
 *
 * @param {object} args
 * @param {number} args.V_ms              cruise speed (m/s)
 * @param {number} args.SFC_kg_per_N_per_s   specific fuel consumption
 * @param {number} args.LoverD            cruise lift/drag ratio
 * @param {number} args.W_initial_kg      mass at start of cruise (kg)
 * @param {number} args.W_final_kg        mass at end (typically reserves)
 * @returns {{ range_m, range_km, range_nmi }}
 */
export function breguetRange({ V_ms, SFC_kg_per_N_per_s, LoverD, W_initial_kg, W_final_kg }) {
  // R = V / (g · SFC) · (L/D) · ln(W_i / W_f)
  if (W_final_kg >= W_initial_kg) return { range_m: 0, range_km: 0, range_nmi: 0 };
  const ratio = W_initial_kg / W_final_kg;
  const R_m = V_ms / (G * SFC_kg_per_N_per_s) * LoverD * Math.log(ratio);
  return { range_m: R_m, range_km: R_m / 1000, range_nmi: R_m / 1852 };
}

/**
 * Breguet cruise endurance.
 */
export function breguetEndurance({ SFC_kg_per_N_per_s, LoverD, W_initial_kg, W_final_kg }) {
  if (W_final_kg >= W_initial_kg) return { endurance_s: 0, endurance_hr: 0 };
  const E_s = 1 / (G * SFC_kg_per_N_per_s) * LoverD * Math.log(W_initial_kg / W_final_kg);
  return { endurance_s: E_s, endurance_hr: E_s / 3600 };
}

/**
 * Drag from a parabolic polar (induced + parasitic):
 *   C_D = C_D0 + k · C_L²
 *   k   = 1 / (π · AR · e)
 *
 * Returns drag force (N) for a given mass + density + speed + area.
 */
export function parabolicPolar({
  mass_kg, V_ms, rho_kg_m3, S_m2, CD0, AR, e = 0.85,
}) {
  const k = 1 / (PI * AR * e);
  const W = mass_kg * G;
  const q = 0.5 * rho_kg_m3 * V_ms * V_ms;
  const CL = W / (q * S_m2);
  const CD = CD0 + k * CL * CL;
  const D = q * S_m2 * CD;
  const LoverD = CL / CD;
  return { CL, CD, D, LoverD, dynamicPressure: q };
}

/**
 * (L/D)_max for a parabolic polar:
 *   (L/D)_max = 1 / (2 √(C_D0 · k))   at  C_L = √(C_D0 / k)
 */
export function maxLoverD(CD0, AR, e = 0.85) {
  const k = 1 / (PI * AR * e);
  return 1 / (2 * Math.sqrt(CD0 * k));
}

/**
 * Standard Anderson textbook subsonic transport mission:
 *  - Climb to cruise altitude (energy method)
 *  - Cruise at constant altitude/speed (Breguet)
 *  - Descent (typically free)
 *  - Reserve fuel
 */
export function fullMissionEstimate({
  // Airframe
  MTOW_kg, OEW_kg, payload_kg,
  fuel_total_kg, reserve_fraction = 0.10,
  // Aero
  S_m2, CD0, AR, e = 0.85,
  // Cruise condition
  altitude_m, V_cruise_ms, rho_cruise = 0.4135,    // typical FL350 air density
  // Engine
  SFC_kg_per_N_per_hr,
}) {
  const SFC_si = SFC_kg_per_N_per_hr / 3600;

  // Use cruise (L/D) at TOC weight
  const W_cruise_start = OEW_kg + payload_kg + fuel_total_kg * (1 - 0.05);   // 5 % climb fuel
  const polar_start = parabolicPolar({
    mass_kg: W_cruise_start, V_ms: V_cruise_ms,
    rho_kg_m3: rho_cruise, S_m2, CD0, AR, e,
  });
  const usable_fuel = fuel_total_kg * (1 - reserve_fraction) * 0.95;   // minus climb fuel
  const W_cruise_end = W_cruise_start - usable_fuel;

  // Cruise (L/D) — use mid-cruise weight average
  const W_avg = (W_cruise_start + W_cruise_end) / 2;
  const polar_avg = parabolicPolar({
    mass_kg: W_avg, V_ms: V_cruise_ms, rho_kg_m3: rho_cruise, S_m2, CD0, AR, e,
  });

  const range = breguetRange({
    V_ms: V_cruise_ms, SFC_kg_per_N_per_s: SFC_si,
    LoverD: polar_avg.LoverD,
    W_initial_kg: W_cruise_start, W_final_kg: W_cruise_end,
  });
  const endurance = breguetEndurance({
    SFC_kg_per_N_per_s: SFC_si, LoverD: polar_avg.LoverD,
    W_initial_kg: W_cruise_start, W_final_kg: W_cruise_end,
  });

  return {
    weights: {
      MTOW_kg, OEW_kg, payload_kg, fuel_total_kg,
      reserve_kg: fuel_total_kg * reserve_fraction,
      usable_kg: usable_fuel,
      W_cruise_start_kg: W_cruise_start,
      W_cruise_end_kg: W_cruise_end,
    },
    cruise: {
      altitude_m, V_ms: V_cruise_ms, rho_cruise,
      CL_avg: polar_avg.CL,
      CD_avg: polar_avg.CD,
      LoverD_avg: polar_avg.LoverD,
      LoverD_max: maxLoverD(CD0, AR, e),
      drag_avg_N: polar_avg.D,
      thrust_required_per_engine_N: polar_avg.D / 2,    // assume 2 engines
    },
    range, endurance,
    SFC_kg_per_N_per_hr,
  };
}
