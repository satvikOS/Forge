/**
 * ArchDisc — Otto / Atkinson Cycle Engine Performance + Emissions
 *
 * Computes brake power, BSFC, IMEP, EGT, and emissions (CO2, NOx, CO,
 * HC, PM) for a spark-ignited gasoline engine. Supports both Otto
 * (conventional) and Atkinson cycles (LIVC late-intake-valve-close,
 * effective expansion > effective compression — used in hybrid engines
 * for higher thermal efficiency at the cost of low-end torque, which
 * the electric motor compensates for).
 *
 * Reference: Heywood "Internal Combustion Engine Fundamentals",
 * Stone "Introduction to Internal Combustion Engines",
 * Ayala et al. "Atkinson Cycle Engine Modeling for Hybrid Applications".
 */

const GAMMA = 1.35;            // air-fuel mixture, average over cycle
const CV = 718;                // J/(kg·K) constant-volume specific heat
const R_AIR = 287;
const LHV_GASOLINE = 44e6;     // J/kg (E0 gasoline)
const STOICH_AFR = 14.7;       // stoichiometric air/fuel ratio

export default class OttoCycle {

  /**
   * Run a cycle simulation at one operating point.
   *
   * @param {object} options
   *   bore_mm, stroke_mm, cylinders
   *   compRatio        geometric compression ratio
   *   atkinsonRatio    expansion ratio / compression ratio (1 for Otto, ~1.4 for hybrid Atkinson)
   *   rpm, lambda      air-fuel equivalence (1 = stoich, >1 = lean)
   *   eta_volumetric   volumetric efficiency 0..1
   *   eta_mechanical   mechanical efficiency 0..1
   *   T_intake_K, P_intake_kPa
   *   spark_advance_deg, EGR_pct
   *   fuel             'gasoline' | 'E10'
   * @returns { performance, stations, emissions }
   */
  static analyze(options = {}) {
    const {
      bore_mm = 92.5, stroke_mm = 86.7, cylinders = 6,
      compRatio = 11.8, atkinsonRatio = 1.10,
      rpm = 4800, lambda = 1.0,
      eta_volumetric = 0.92, eta_mechanical = 0.90,
      T_intake_K = 313, P_intake_kPa = 100,
      spark_advance_deg = 25, EGR_pct = 15,
      fuel = 'gasoline',
    } = options;

    // Geometry
    const bore_m = bore_mm / 1000, stroke_m = stroke_mm / 1000;
    const Vd_per_cyl = Math.PI * (bore_m ** 2) / 4 * stroke_m;  // displacement per cylinder
    const Vd_total = Vd_per_cyl * cylinders;
    const Vc_per_cyl = Vd_per_cyl / (compRatio - 1);
    const V1 = Vd_per_cyl + Vc_per_cyl;  // BDC
    const V2 = Vc_per_cyl;                // TDC

    // Effective compression (Atkinson late-IVC reduces effective intake)
    const compRatio_eff = compRatio / atkinsonRatio;

    // Intake conditions (with EGR dilution)
    const m_air_per_cyl = (P_intake_kPa * 1000) * V1 * eta_volumetric * (1 - EGR_pct / 100) / (R_AIR * T_intake_K);

    // Fuel mass + heat release
    const m_fuel_per_cyl = m_air_per_cyl / (STOICH_AFR * lambda);
    const Q_in_per_cyl = m_fuel_per_cyl * LHV_GASOLINE;

    // Otto-cycle thermodynamic states
    // 1 → 2: isentropic compression
    const T1 = T_intake_K;
    const P1 = P_intake_kPa * 1000;
    const T2 = T1 * Math.pow(compRatio_eff, GAMMA - 1);
    const P2 = P1 * Math.pow(compRatio_eff, GAMMA);
    // 2 → 3: constant-volume heat addition
    const m_total = m_air_per_cyl + m_fuel_per_cyl;
    const dT_combustion = Q_in_per_cyl / (m_total * CV);
    const T3 = T2 + dT_combustion;
    const P3 = P2 * (T3 / T2);
    // 3 → 4: isentropic expansion (over expansionRatio for Atkinson)
    const expansionRatio = compRatio;  // expand back to BDC volume
    const T4 = T3 / Math.pow(expansionRatio, GAMMA - 1);
    const P4 = P3 / Math.pow(expansionRatio, GAMMA);

    // Indicated work per cycle (Atkinson over-expands)
    const W_indicated_per_cyl = Q_in_per_cyl * (1 - 1 / Math.pow(expansionRatio, GAMMA - 1));

    // Brake work (after mechanical friction losses)
    const W_brake_per_cyl = W_indicated_per_cyl * eta_mechanical;

    // Mean effective pressures
    const IMEP_kPa = (W_indicated_per_cyl / Vd_per_cyl) / 1000;
    const BMEP_kPa = (W_brake_per_cyl / Vd_per_cyl) / 1000;

    // Power: 4-stroke, half cycles per revolution per cylinder
    const cyclesPerSecond = (rpm / 60) / 2;  // 4-stroke
    const W_total_per_second = W_brake_per_cyl * cylinders * cyclesPerSecond;
    const power_kW = W_total_per_second / 1000;
    const power_hp = power_kW * 1.341;
    const torque_Nm = (power_kW * 1000) / (rpm * 2 * Math.PI / 60);

    // Fuel flow + BSFC
    const m_fuel_per_second = m_fuel_per_cyl * cylinders * cyclesPerSecond;
    const m_fuel_per_hour = m_fuel_per_second * 3600;
    const BSFC_g_kWh = (m_fuel_per_second * 1000 * 3600) / power_kW;

    // Thermal efficiency
    const Q_in_per_second = Q_in_per_cyl * cylinders * cyclesPerSecond;
    const eta_thermal = power_kW * 1000 / Q_in_per_second;
    const eta_otto_ideal = 1 - 1 / Math.pow(compRatio_eff, GAMMA - 1);

    // ---- Emissions (semi-empirical correlations) ----
    // CO2: derived from fuel carbon balance (3.17 kg CO2 per kg fuel)
    const CO2_g_per_s = m_fuel_per_second * 3170;
    const CO2_g_per_kWh = CO2_g_per_s * 3600 / power_kW;

    // NOx: Zeldovich (thermal NO) — strong T3 dependence + λ effect
    // Empirical: NO_g_kWh ≈ 0.0008 × exp((T3-1700)/200) × (1 - 0.5×|λ-1.05|) × (1 - EGR/100×2)
    const T_eff = Math.min(T3, 2700);
    const NOx_g_kWh = 0.0008 * Math.exp((T_eff - 1700) / 200)
      * Math.max(0.1, 1 - 1.5 * Math.abs(lambda - 1.05))
      * Math.max(0.05, 1 - EGR_pct / 100 * 2.0);

    // CO: very low at lambda ≥ 1, increases at rich
    const CO_g_kWh = lambda > 1.02 ? 0.5 + (lambda - 1.02) * 0.1
      : lambda > 0.98 ? 1.0 + (1.0 - lambda) * 50
      : 50 + (0.98 - lambda) * 800;

    // HC (unburned hydrocarbons): lambda + combustion-completeness dependent
    const HC_g_kWh = 0.4 + Math.abs(lambda - 1.0) * 5
      + (compRatio_eff > 13 ? (compRatio_eff - 13) * 0.2 : 0);

    // PM (particulate matter): higher with DI gasoline, lower with port + DI
    const PM_mg_kWh = 0.5 * (1 + (lambda < 1.0 ? (1.0 - lambda) * 20 : 0));

    return {
      conditions: {
        rpm, lambda, compRatio_geom: compRatio, compRatio_eff,
        atkinsonRatio, EGR_pct, fuel,
      },
      stations: {
        '1': { T_K: T1, P_kPa: P1 / 1000, V_L: V1 * 1000, name: 'BDC intake' },
        '2': { T_K: T2, P_kPa: P2 / 1000, V_L: V2 * 1000, name: 'TDC compressed' },
        '3': { T_K: T3, P_kPa: P3 / 1000, V_L: V2 * 1000, name: 'TDC after combustion' },
        '4': { T_K: T4, P_kPa: P4 / 1000, V_L: V1 * 1000, name: 'BDC after expansion' },
      },
      performance: {
        power_kW: +power_kW.toFixed(2),
        power_hp: +power_hp.toFixed(1),
        torque_Nm: +torque_Nm.toFixed(1),
        torque_lbft: +(torque_Nm * 0.7376).toFixed(1),
        BSFC_g_kWh: +BSFC_g_kWh.toFixed(1),
        BSFC_lb_hph: +(BSFC_g_kWh / 608).toFixed(3),
        IMEP_kPa: +IMEP_kPa.toFixed(1),
        BMEP_kPa: +BMEP_kPa.toFixed(1),
        eta_thermal: +eta_thermal.toFixed(3),
        eta_thermal_pct: +(eta_thermal * 100).toFixed(1),
        eta_otto_ideal: +eta_otto_ideal.toFixed(3),
        eta_volumetric, eta_mechanical,
        EGT_C: +(T4 - 273.15).toFixed(0),
      },
      flows: {
        air_kg_per_hour: +(m_air_per_cyl * cylinders * cyclesPerSecond * 3600).toFixed(2),
        fuel_kg_per_hour: +m_fuel_per_hour.toFixed(3),
        AFR_actual: +(STOICH_AFR * lambda).toFixed(2),
      },
      emissions: {
        CO2_g_per_kWh: +CO2_g_per_kWh.toFixed(0),
        NOx_g_per_kWh: +NOx_g_kWh.toFixed(3),
        CO_g_per_kWh: +CO_g_kWh.toFixed(2),
        HC_g_per_kWh: +HC_g_kWh.toFixed(2),
        PM_mg_per_kWh: +PM_mg_kWh.toFixed(2),
      },
    };
  }

  /**
   * Combined-cycle (city + highway) emissions estimate for a hybrid.
   * Uses an EPA Combined fuel economy model — engine-on duty cycle
   * weighted by hybridization assistance factor.
   */
  static combinedCycle(engineOptions, hybridOptions = {}) {
    const {
      city_engineOnPct = 0.40,    // engine runs 40% of city cycle (rest is EV)
      hwy_engineOnPct = 0.85,
      city_avgKW = 12,
      hwy_avgKW = 35,
      city_distance_km = 17.7,
      hwy_distance_km = 26.4,
      catalystEfficiency = 0.995,  // 3-way cat conversion
      gpfFiltrationEfficiency = 0.95,
    } = hybridOptions;

    // Run cycle at representative load points
    const lowLoad = OttoCycle.analyze({ ...engineOptions, rpm: 1800, lambda: 1.00 });
    const cruise  = OttoCycle.analyze({ ...engineOptions, rpm: 2400, lambda: 1.00 });

    // Time per phase (h)
    const cityTime_h = city_distance_km / 35;     // ~35 km/h average city
    const hwyTime_h = hwy_distance_km / 100;      // ~100 km/h average highway
    const cityEngTime_h = cityTime_h * city_engineOnPct;
    const hwyEngTime_h = hwyTime_h * hwy_engineOnPct;

    // Energy from engine (kWh)
    const cityEngEnergy_kWh = city_avgKW * cityEngTime_h;
    const hwyEngEnergy_kWh = hwy_avgKW * hwyEngTime_h;
    const totalEngEnergy_kWh = cityEngEnergy_kWh + hwyEngEnergy_kWh;

    // Tailpipe (engine-out, then catalysts)
    const cityOut_NOx = lowLoad.emissions.NOx_g_per_kWh * cityEngEnergy_kWh;
    const hwyOut_NOx = cruise.emissions.NOx_g_per_kWh * hwyEngEnergy_kWh;
    const totalNOx_g = (cityOut_NOx + hwyOut_NOx) * (1 - catalystEfficiency);

    const cityOut_HC = lowLoad.emissions.HC_g_per_kWh * cityEngEnergy_kWh;
    const hwyOut_HC = cruise.emissions.HC_g_per_kWh * hwyEngEnergy_kWh;
    const totalHC_g = (cityOut_HC + hwyOut_HC) * (1 - catalystEfficiency);

    const cityOut_CO = lowLoad.emissions.CO_g_per_kWh * cityEngEnergy_kWh;
    const hwyOut_CO = cruise.emissions.CO_g_per_kWh * hwyEngEnergy_kWh;
    const totalCO_g = (cityOut_CO + hwyOut_CO) * (1 - catalystEfficiency);

    const cityOut_PM = lowLoad.emissions.PM_mg_per_kWh / 1000 * cityEngEnergy_kWh;
    const hwyOut_PM = cruise.emissions.PM_mg_per_kWh / 1000 * hwyEngEnergy_kWh;
    const totalPM_g = (cityOut_PM + hwyOut_PM) * (1 - gpfFiltrationEfficiency);

    const cityCO2 = lowLoad.emissions.CO2_g_per_kWh * cityEngEnergy_kWh;
    const hwyCO2 = cruise.emissions.CO2_g_per_kWh * hwyEngEnergy_kWh;
    const totalCO2_g = cityCO2 + hwyCO2;  // CO2 not affected by catalyst

    const totalDistance_km = city_distance_km + hwy_distance_km;

    return {
      input: { engine: engineOptions, hybrid: hybridOptions },
      duty: {
        city: { engineOnPct: city_engineOnPct, avgKW: city_avgKW, distance_km: city_distance_km, energy_kWh: cityEngEnergy_kWh },
        hwy:  { engineOnPct: hwy_engineOnPct,  avgKW: hwy_avgKW,  distance_km: hwy_distance_km,  energy_kWh: hwyEngEnergy_kWh },
        totalEngineEnergy_kWh: totalEngEnergy_kWh,
      },
      tailpipe: {
        CO2_g_per_km: +(totalCO2_g / totalDistance_km).toFixed(1),
        NOx_g_per_mile: +(totalNOx_g / totalDistance_km * 1.609).toFixed(4),
        HC_g_per_mile: +(totalHC_g / totalDistance_km * 1.609).toFixed(4),
        CO_g_per_mile: +(totalCO_g / totalDistance_km * 1.609).toFixed(2),
        PM_g_per_mile: +(totalPM_g / totalDistance_km * 1.609).toFixed(5),
        NMHCNOx_g_per_mile: +((totalHC_g + totalNOx_g) / totalDistance_km * 1.609).toFixed(4),
      },
      compliance: {
        // Tier 4 / SULEV30 limits (g/mi)
        SULEV30_NMHCNOx_g_mi: 0.030,
        SULEV30_CO_g_mi: 1.0,
        SULEV30_PM_g_mi: 0.003,
      },
    };
  }
}
