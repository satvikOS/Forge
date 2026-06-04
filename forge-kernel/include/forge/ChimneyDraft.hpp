// Forge-326e — Chimney/stack natural draft pressure (ASHRAE Fund Ch 35).
//   ΔP_avail = g · h · (ρ_amb − ρ_flue)         Pa
//   ρ = p_atm / (R · T_K)                        ideal gas
//   Required flue velocity from continuity:  V = ṁ_flue / (ρ_flue · A)
//   Friction loss: ΔP_f = f · (h / D) · ½ · ρ_flue · V²
//   Net draft = ΔP_avail − ΔP_f

#pragma once

namespace forge::chimney {

struct Input {
    double stackHeightM;
    double flueDiameterM;
    double flueGasTempC;
    double ambientTempC;
    double flueMassFlowKgPerS;
    double atmPressureKPa;          // default 101.325
};

struct Result {
    double rhoAmbient;
    double rhoFlue;
    double availableDraftPa;
    double flueVelocityMs;
    double frictionLossPa;
    double netDraftPa;
    bool   draftAdequate;           // net > 5 Pa minimum design
};

Result analyse(const Input& in);

}  // namespace forge::chimney
