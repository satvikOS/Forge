// Forge-331a — Beam reactions, shear, moment for simply-supported beam (Hibbeler §6).
//   Point load P at distance a from left support of span L:
//     R_left = P·(L−a)/L,    R_right = P·a/L
//     M_max  = P·a·(L−a)/L                (at point of load)
//   Uniform distributed load w over span:
//     R_left = R_right = w·L/2,    M_max = w·L²/8 at midspan
//   Combined: superposition.
//   Max deflection (E·I provided): δ_PL = P·a·(L²−a²)^(3/2) / (9√3·E·I·L)  at x = √((L²−a²)/3),
//                                 δ_w  = 5·w·L⁴ / (384·E·I)                at midspan.

#pragma once

namespace forge::beamreact {

struct Input {
    double span_m;
    double pointLoad_kN;            // P (0 → ignore)
    double pointLoadPosition_m;     // a from left support
    double udl_kNm;                 // w (0 → ignore)
    double EI_kNm2;                 // E·I (0 → don't compute deflection)
};

struct Result {
    double leftReaction_kN;
    double rightReaction_kN;
    double maxBendingMoment_kNm;    // combined |M_max|
    double maxShear_kN;
    double maxDeflection_mm;        // 0 if EI = 0
};

Result analyse(const Input& in);

}  // namespace forge::beamreact
