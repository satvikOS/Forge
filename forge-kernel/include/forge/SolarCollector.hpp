// Forge-326d — Flat-plate solar thermal collector (Hottel-Whillier-Bliss).
//   q_u = A · F_R · (τα · G_T − U_L · (T_in − T_amb))         W
//   η   = q_u / (A · G_T)

#pragma once

namespace forge::solarcoll {

struct Input {
    double collectorAreaM2;          // A
    double opticalEfficiency_F_R_tau_alpha;  // F_R·τα (typ 0.7-0.85)
    double overallLossCoeff_U_L;     // W/m²·K (typ 3-5)
    double F_R;                      // heat removal factor (typ 0.8-0.9)
    double globalIrradianceWm2;      // G_T
    double inletTempC;
    double ambientTempC;
};

struct Result {
    double usefulHeatGainW;
    double instantaneousEfficiency;
    double reducedTemperature;        // (T_in − T_amb) / G_T
};

Result analyse(const Input& in);

}  // namespace forge::solarcoll
