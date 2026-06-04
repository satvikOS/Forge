// Forge-330a — Infinite-slope stability (Coulomb–Mohr).
//   Dry / partially submerged: FS = [c' + (γ·h·cos²β − u)·tan φ'] / (γ·h·cos β·sin β)
//   Submerged seepage parallel: γ_eff = γ_sat − γ_w
//   Cohesionless dry: FS → tan φ' / tan β.

#pragma once

namespace forge::slope {

struct Input {
    double cohesion_kPa;
    double unitWeight_kNm3;
    double sliceDepth_m;
    double slopeAngleDeg;
    double frictionAngleDeg;
    double waterTableDepth_m;     // 0 = full submergence; >= slice depth = dry
};

struct Result {
    double slipDepth_m;
    double effectiveNormalStress_kPa;
    double mobilisedShearStress_kPa;
    double resistingShearStress_kPa;
    double factorOfSafety;
    bool   stable;                // FS >= 1.5
};

Result analyse(const Input& in);

}  // namespace forge::slope
