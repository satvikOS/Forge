// Forge-319e — Basement hydrostatic uplift / buoyancy (Archimedes).
//
//   F_buoy   = γ_w · h_water · A_slab   kN
//   W_total  = (q_slab + q_overburden) · A_slab  kN
//   FOS_uplift = W_total / F_buoy
//   Required FOS typically 1.10-1.25 per IBC / Eurocode 7

#pragma once

namespace forge::buoyancy {

struct Input {
    double basementWidthB_m;
    double basementLengthN_m;
    double waterHeadAboveSlabM;       // h_water
    double slabSelfWeightKnPerM2;     // q_slab
    double overburdenKnPerM2;         // q_over (soil + finish)
    double waterUnitWeightKnPerM3;    // 9.81 default
};

struct Result {
    double slabAreaM2;
    double upliftForceKn;
    double weightForceKn;
    double netUpliftKn;
    double factorOfSafety;
    bool   passes;                     // FOS ≥ 1.10
};

Result analyse(const Input& in);

}  // namespace forge::buoyancy
