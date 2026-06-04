// Forge-308 — Open-loop cooling tower performance (ASHRAE Handbook —
// HVAC Systems & Equipment Ch. 40, Marley Cooling Technology design guide).
//
// Common to every water-cooled chiller plant: closes the heat-balance loop
// between the condenser (Forge-230 refrigeration) and the wet-bulb air.
//
//   Range      ΔT_w  = T_in − T_out                 (°C, ≡ K)
//   Approach   ΔT_a  = T_out − T_wb                 (°C; design target 3-5 K)
//   Q_rej      = ṁ_w · c_p,w · Range                (kW)
//
// Make-up water budget (mass balance on dissolved-solids cycles):
//   Evaporation   ṁ_e = Q_rej / h_fg                 (≈ c_p·Range/h_fg of ṁ_w)
//   Bleed (blow-down) ṁ_b = ṁ_e / (CoC − 1)          (limits concentration)
//   Drift loss    ṁ_d = drift_frac · ṁ_w             (modern fill ~ 0.002 %)
//   Make-up       ṁ_m = ṁ_e + ṁ_b + ṁ_d
//
// Constants: c_p,w = 4.186 kJ/kg·K, h_fg ≈ 2430 kJ/kg at 30 °C, ρ_w = 1000.
//
// Validates strictly positive flow, range > 0, and CoC ≥ 2.

#pragma once

namespace forge::coolingtower {

struct Input {
    double waterFlowLps;          // Q_w (L/s)
    double inletTempC;            // T_in
    double outletTempC;           // T_out
    double wetBulbTempC;          // T_wb (design)
    double cyclesOfConcentration; // CoC (≥ 2 typ)
    double driftFraction;         // ≈ 2e-5 modern, 2e-4 older
};

struct Result {
    double rangeK;
    double approachK;
    double heatRejectionKw;
    double evaporationLps;
    double bleedLps;
    double driftLps;
    double makeupLps;
    double evaporationPercent;    // ṁ_e / ṁ_w · 100
    double makeupPercent;
};

Result analyse(const Input& in);

}  // namespace forge::coolingtower
