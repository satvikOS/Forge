/**
 * ArchDisc Foundation — HPT blade cooling design.
 *
 * Without cooling, a turbine blade exposed to T_gas = 1750 K gas
 * would melt — even single-crystal CMSX-4 caps at 1100 °C metal
 * temperature for long life. Modern HPT blades survive this gas
 * temperature only because of:
 *
 *   1. INTERNAL CONVECTION COOLING — compressor bleed air flows
 *      through serpentine passages inside the blade, removing heat
 *      via forced convection. Heat-transfer coefficient h_int is
 *      enhanced by ribs, pin-fins, or matrix structures.
 *
 *   2. FILM COOLING — the same coolant exits through holes on the
 *      blade surface, forming a protective thin film of cool air
 *      between the gas and the metal wall. Film effectiveness η_film
 *      depends on blowing ratio M = (ρU)_coolant / (ρU)_gas and
 *      hole geometry.
 *
 *   3. THERMAL BARRIER COATING (TBC) — yttria-stabilized zirconia
 *      (~0.3 mm) over the metal, drops effective metal T by 100–200 K.
 *
 * The combined effect is the OVERALL COOLING EFFECTIVENESS:
 *
 *   φ_c  =  (T_gas − T_wall_outer) / (T_gas − T_coolant_inlet)
 *
 * Modern HPT blades achieve φ_c = 0.55–0.70.
 *
 * 1D thermal-resistance model (per unit area of blade wall):
 *
 *   q  =  (T_g_eff − T_c) / (R_film + R_TBC + R_metal + R_int)
 *
 * with
 *   T_g_eff  =  T_gas − η_film (T_gas − T_c)        film-protected gas T
 *   R_film   =  1 / h_g            (when no film: full external h_g)
 *   R_TBC    =  t_TBC / k_TBC
 *   R_metal  =  t_metal / k_metal
 *   R_int    =  1 / h_c           (effective with augmentation)
 *
 * Then T_wall_outer = T_g_eff − q · (R_film)        (no TBC)
 *      T_wall_outer = T_g_eff − q · (R_film + R_TBC)  (with TBC)
 *
 * Reference: Lakshminarayana "Fluid Dynamics and Heat Transfer of
 * Turbomachinery" (Wiley 1996), Chapter 9; Hill & Peterson Ch 7.
 *
 * Validation: Tu/Yan correlation for typical HPT cruise design
 * gives φ_c ≈ 0.6 for h_int = 2000, h_ext = 3000, η_film = 0.4.
 */

const PI = Math.PI;

/**
 * Film-cooling effectiveness from blowing ratio (simplified Goldstein
 * correlation for a row of cylindrical holes, single row):
 *
 *   For blowing ratio M = (ρU)_c / (ρU)_g:
 *     M < 0.5:  η_film_max ≈ 0.55 + 0.5 M
 *     0.5 ≤ M ≤ 1.0:  η_film_max ≈ 0.6 (peak)
 *     M > 1.0:  η_film_max declines (jet liftoff)
 *
 * Streamwise decay: η(x/D) ≈ η_max · (1 − 0.6 · x/(20D))   for x/D ≤ 20
 *
 * @param {number} M  blowing ratio
 * @param {number=} xOverD  streamwise distance / hole diameter
 */
export function filmEffectiveness(M, xOverD = 5) {
  // Peak effectiveness at the hole exit
  let etaMax;
  if (M < 0.5) etaMax = 0.55 + 0.5 * M;
  else if (M <= 1.0) etaMax = 0.6;
  else etaMax = 0.6 - 0.4 * (M - 1.0);
  if (etaMax < 0) etaMax = 0;
  // Streamwise decay (linear in x/D up to 20D)
  const decay = Math.max(0, 1 - 0.6 * xOverD / 20);
  return etaMax * decay;
}

/**
 * 1D thermal-resistance cooling analysis at a single point on the
 * blade surface.
 *
 * @param {object} args
 * @param {number} args.T_gas_K           local gas T (K)
 * @param {number} args.T_coolant_K       internal coolant T (K)
 * @param {number} args.h_external        gas-side h (W/(m²·K))
 * @param {number} args.h_internal        coolant-side h
 * @param {number} args.t_metal_m         metal wall thickness (m)
 * @param {number} args.k_metal           metal conductivity (W/(m·K))
 * @param {number=} args.t_TBC_m
 * @param {number=} args.k_TBC            (default ~1.0 for YSZ)
 * @param {number=} args.filmEffectiveness  η_film (dimensionless)
 */
export function bladePointTemperature({
  T_gas_K, T_coolant_K, h_external, h_internal,
  t_metal_m, k_metal,
  t_TBC_m = 0, k_TBC = 1.0,
  filmEffectiveness: eta_f = 0,
}) {
  // Effective hot-gas T seen by the blade SURFACE (after film):
  const T_g_eff = T_gas_K - eta_f * (T_gas_K - T_coolant_K);

  // Thermal resistances (per unit area)
  const R_ext = 1 / h_external;
  const R_TBC = t_TBC_m / k_TBC;
  const R_metal = t_metal_m / k_metal;
  const R_int = 1 / h_internal;
  const R_total = R_ext + R_TBC + R_metal + R_int;

  // Heat flux per unit area (W/m²)
  const q = (T_g_eff - T_coolant_K) / R_total;

  // Wall temperatures by walking the resistance chain inward:
  const T_outer_TBC = T_g_eff - q * R_ext;       // outside surface of TBC
  const T_outer_metal = T_outer_TBC - q * R_TBC; // metal outer surface
  const T_inner_metal = T_outer_metal - q * R_metal;
  const T_coolant_wall = T_inner_metal - q * R_int;  // sanity: should equal T_coolant_K

  // Overall cooling effectiveness based on the metal outer surface
  // (the temperature that controls life — this is what TMC fatigue
  // and creep see):
  const phi_c = (T_gas_K - T_outer_metal) / (T_gas_K - T_coolant_K);

  return {
    T_g_eff,
    T_outer_TBC, T_outer_metal, T_inner_metal,
    heat_flux_W_per_m2: q,
    resistances: { R_ext, R_TBC, R_metal, R_int, R_total },
    overall_cooling_effectiveness: phi_c,
    metal_safe: T_outer_metal < 1373,    // CMSX-4 long-life limit ~1100 °C
    sanity_check_T_coolant: T_coolant_wall,
  };
}

/**
 * Whole-blade cooling design summary: leading edge, midchord
 * pressure side, trailing edge, suction side. Each location gets
 * its own external h, film effectiveness, and reports metal T.
 *
 * @param {object} args
 *   T_gas, T_coolant, t_metal, k_metal, t_TBC, k_TBC: same as above
 *   stations: { LE, midPS, midSS, TE } each with { h_ext, h_int, etaFilm }
 */
export function analyzeBladeCooling({
  T_gas_K, T_coolant_K,
  t_metal_m, k_metal,
  t_TBC_m = 0, k_TBC = 1.0,
  stations,
}) {
  const out = {};
  for (const [name, st] of Object.entries(stations)) {
    out[name] = bladePointTemperature({
      T_gas_K, T_coolant_K,
      h_external: st.h_ext,
      h_internal: st.h_int,
      filmEffectiveness: st.etaFilm,
      t_metal_m, k_metal, t_TBC_m, k_TBC,
    });
  }

  // Hot-spot: highest T_outer_metal across all stations
  let T_metal_max = -Infinity;
  let hotspot = null;
  for (const [name, r] of Object.entries(out)) {
    if (r.T_outer_metal > T_metal_max) {
      T_metal_max = r.T_outer_metal;
      hotspot = name;
    }
  }

  return {
    stations: out,
    T_metal_max_K: T_metal_max,
    hotspot,
    survives_long_life: T_metal_max < 1373,    // CMSX-4 1100 °C limit
    survives_short_life: T_metal_max < 1473,   // 1200 °C, with reduced creep margin
  };
}
