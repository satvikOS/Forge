// Forge-334e — Thrust block at pipe fitting (DIPRA TB-3 / AWWA M11 Ch 13).
//   Thrust force per fitting:
//     T_bend   = 2·P·A·sin(θ/2)
//     T_tee    = P·A
//     T_cap    = P·A
//     T_reducer= P·(A_1 − A_2)
//   Bearing area required A_req = T · SF / σ_bearing_soil
//   Block size: assume square footprint → side s = √A_req.

#pragma once

namespace forge::thrustblk {

struct Input {
    double pipeOuterDiameter_mm;
    double designPressure_MPa;
    double bendAngleDeg;            // 0 → tee/cap; > 0 → bend
    double soilBearingPressure_kPa;
    double safetyFactor;            // 1.5 typ
    int    fittingType;             // 0 bend, 1 tee, 2 cap, 3 reducer
    double reducerOD2_mm;           // for reducer
};

struct Result {
    double pipeArea_mm2;
    double thrustForce_kN;
    double requiredBearingArea_m2;
    double squareBlockSide_m;
    double blockMassEstimate_t;     // concrete 2400 kg/m³, depth = side/2 assumed
};

Result analyse(const Input& in);

}  // namespace forge::thrustblk
