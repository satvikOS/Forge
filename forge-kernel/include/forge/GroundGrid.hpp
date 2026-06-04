// Forge-333c — Substation grounding grid (IEEE 80-2013).
//   Tolerable step / touch voltage (50 kg or 70 kg body):
//     C_s = 1 − 0.09·(1 − ρ/ρ_s)/(2·h_s + 0.09)             surface layer derating
//     E_step50  = (1000 + 6·C_s·ρ_s)·0.116/√t_s
//     E_touch50 = (1000 + 1.5·C_s·ρ_s)·0.116/√t_s
//   Conductor minimum cross-section (Sverak):
//     A_mm² = I·√(t·K_f)            K_f from Table 2 (~ 7.06 hard-drawn Cu @ 25→200°C).
//   Grid resistance (Schwarz / Sverak):
//     R_g = ρ · [ 1/L_T + (1/√(20·A))·(1 + 1/(1+h·√(20/A))) ]

#pragma once

namespace forge::groundgrid {

struct Input {
    double soilResistivity_rho_Ohmm;
    double surfaceLayerResistivity_rhos_Ohmm;     // ρ_s
    double surfaceLayerDepth_hs_m;
    double gridDepth_h_m;
    double gridArea_m2;
    double totalConductorLength_m;                // L_T
    double faultClearTime_s;                      // t_s
    double faultCurrent_kA;
    double conductorKf;                           // Sverak Table 2 ≈ 7.06 Cu / 12.0 steel
    int    bodyWeight_kg;                         // 50 or 70
};

struct Result {
    double Cs_surface_derating;
    double allowableStepVoltage_V;
    double allowableTouchVoltage_V;
    double requiredConductorArea_mm2;
    double gridResistance_Ohm;
    double groundPotentialRise_V;        // GPR = I · R_g
};

Result analyse(const Input& in);

}  // namespace forge::groundgrid
