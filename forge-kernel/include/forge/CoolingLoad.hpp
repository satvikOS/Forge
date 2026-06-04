// Forge-306 — HVAC sensible + latent cooling/heating load (ASHRAE Fund. Ch 18).
//
// Air-side energy balance across a coil:
//   ṁ_a = ρ_a · Q_v                     (dry-air mass flow)
//   Q_sensible = ṁ_a · c_p · (T_ret − T_sup)         (kW)
//   Q_latent   = ṁ_a · h_fg · (ω_ret − ω_sup)         (kW)
//   Q_total    = ṁ_a · (h_ret − h_sup)
//   SHR        = Q_sens / Q_total
//
// Moist-air enthalpy h(t, ω) = c_pa·t + ω·(h_fg₀ + c_pv·t)        (kJ/kg dry air)
//   c_pa = 1.006 kJ/kg·K, c_pv = 1.86 kJ/kg·K, h_fg₀ = 2501 kJ/kg at 0 °C.
//
// Standard sea-level air density ρ_a ≈ 101.325 / (0.287·(t+273.15)) kg/m³
// — we use ρ_a = 1.20 kg/m³ when the caller passes atmPressureKPa ≤ 0 (default).
//
// Negative ΔT or Δω flips the sign — convention: positive Q means cooling
// (return warmer than supply) or, with negative output, heating. The
// `modeName` field reports "cooling" or "heating" for the dominant load.

#pragma once

#include <string>

namespace forge::coolingload {

struct Input {
    double airflowLps;          // Q_v (L/s) supply air
    double tSupplyC;
    double tReturnC;
    double wSupplyKgPerKg;      // ω_sup (kg moisture / kg dry air)
    double wReturnKgPerKg;
    double atmPressureKPa;      // ≤ 0 → use 1.20 kg/m³ default
};

struct Result {
    double massFlowKgPerS;          // ṁ_a
    double sensibleLoadKw;          // (T_ret − T_sup) · ṁ · c_p
    double latentLoadKw;            // (ω_ret − ω_sup) · ṁ · h_fg
    double totalLoadKw;             // sens + latent
    double sensibleHeatRatio;       // Q_sens / Q_total
    double enthalpyDifferenceKjKg;  // h_ret − h_sup
    std::string modeName;           // "cooling" | "heating"
};

Result analyse(const Input& in);

}  // namespace forge::coolingload
