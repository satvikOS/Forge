// Forge-335b — Wind tower / monopole foundation overturning (IEC 61400-6 / DNVGL-ST-0126).
//   Overturning moment  M_OT = F_thrust · h_hub
//   Resisting moment     M_R  = (W_tower + W_foundation + W_soil) · B/2     square base side B
//   Safety factor   SF = M_R / M_OT             (≥ 1.5 typical)
//   Eccentricity    e = (M_OT − M_R_unfavorable) / W_total      check e ≤ B/6 to avoid uplift
//   Soil bearing pressure σ = W/(B²) · (1 + 6e/B)   max edge (e ≤ B/6).

#pragma once

namespace forge::wtbase {

struct Input {
    double thrustForce_kN;         // F_thrust @ rotor
    double hubHeight_m;            // h_hub
    double towerWeight_kN;
    double foundationWidth_m;      // B (square)
    double foundationDepth_m;      // t (block depth)
    double concreteDensity_kgM3;   // 2400
    double soilDensity_kgM3;       // 1800 over the block (cap soil)
    double soilCapDepth_m;         // soil above foundation top
    double allowableBearing_kPa;
};

struct Result {
    double foundationWeight_kN;
    double soilCapWeight_kN;
    double totalGravity_kN;
    double overturningMoment_kNm;
    double restoringMoment_kNm;
    double overturningSF;
    double eccentricity_m;
    double maxBearingPressure_kPa;
    bool   sizeOK;                 // SF ≥ 1.5 and e ≤ B/6 and σ ≤ σ_allow
};

Result analyse(const Input& in);

}  // namespace forge::wtbase
