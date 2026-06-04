// Forge-324d — Crane runway beam wheel load + flange bending (AISC Design Guide 7 §3).
//   Per AISC DG 7 simplified:
//   Vertical wheel load P_w, impact 25 %, lateral 20 % per AISC F11
//   Beam moment M = P_w·1.25·L_span / 4 (simply supported with central load)
//   φM_n from §F11 lateral-torsional limits (we report M_required only)

#pragma once

namespace forge::cranerunway {

struct Input {
    double maxWheelLoadKn;
    double spanLengthM;
    double impactFactor;            // typ 0.25 cab op, 0.10 pendant
    double lateralFraction;         // typ 0.20 of vertical
};

struct Result {
    double wheelLoadWithImpactKn;
    double lateralLoadKn;
    double verticalMomentKnm;       // P·1.25·L/4 simply supported point
    double lateralMomentKnm;        // 0.20·P·L/4
    double combinedDesignMomentKnm; // V + L per §H1 simplified
};

Result analyse(const Input& in);

}  // namespace forge::cranerunway
