// Forge-313 — Saturated-steam pipe sizing (Spirax Sarco "Steam Engineering
// Tutorial" Module 10 — pipe sizing for steam mains).
//
// Complements Forge-303 Hazen-Williams (incompressible water pipes) with the
// compressible-saturated-steam case: pipes that carry boiler-supplied steam
// to traps, heat exchangers, sterilizers, and humidifiers.
//
// Velocity-based sizing per the standard Spirax Sarco/CIBSE method:
//
//   v_g  = saturated-steam specific volume at the operating pressure
//          (linearly interpolated from a 0-10 bar gauge steam-table fit)
//   A_req = ṁ · v_g / v_limit         where v_limit is the design velocity
//                                     (25 m/s mains conservative, 40 m/s
//                                     aggressive for short branches)
//   D_req = √(4·A_req / π)
//
// Pipe pressure drop (per Spirax Sarco Module 11 / Crane TP-410 simplified):
//
//   ΔP/L = f · ρ · V² / (2 · D)
//         where ρ = 1 / v_g and f ≈ 0.02 (smooth commercial steel)
//
// Reports specific volume, actual velocity at the nearest standard DN, and
// total ΔP over the pipe length.

#pragma once

namespace forge::steampipe {

struct Input {
    double steamPressureBarGauge;   // 0-10 typical
    double steamMassFlowKgPerH;     // ṁ in kg/h
    double velocityLimitMs;         // design limit (25-40 m/s)
    double pipeLengthM;             // total run length
};

struct Result {
    double saturationTempC;             // T_sat at P
    double specificVolumeM3PerKg;       // v_g
    double requiredAreaMm2;
    double requiredDiameterMm;          // smooth ideal
    double standardDN;                  // next size up
    double actualVelocityMs;            // at the chosen DN
    double pressureDropBarPer100m;
    double totalPressureDropBar;
};

Result analyse(const Input& in);

}  // namespace forge::steampipe
