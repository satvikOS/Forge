// Forge-301 — Wire rope FOS + bending fatigue (Shigley §17-7).
//
// Sizes cranes, elevators, mining hoists, suspension rigging. Distinct from
// Forge-299 catenary (continuous-medium static curve) — this is the
// rated-strength, bending-fatigue, D/d-ratio chain used for steel wire rope.
//
// Nominal breaking strength (Shigley Table 17-24 IPS regression):
//     F_u [N] ≈ K_class · d_r²     with d_r in mm
//   K_6x19 = 660, K_6x37 = 600, K_6x61 = 580   (Improved Plow Steel)
//
// Bending stress when the rope wraps a sheave of diameter D (Shigley §17-7):
//     σ_b = E_r · d_w / D
//   E_r ≈ 12 000 MPa (reduced modulus for stranded rope)
//   d_w (individual outer wire diameter) ≈ d_r / w_class
//     w_6x19 = 16, w_6x37 = 22, w_6x61 = 27
//
// Equivalent bending tension (added to applied load for fatigue check):
//     F_b = σ_b · A_m         A_m ≈ a_class · d_r²
//   a_6x19 = 0.314,  a_6x37 = 0.306,  a_6x61 = 0.298   (metallic area)
//
// Total effective tension carried for fatigue assessment:
//     F_tot = F_applied · n_accel + F_b
//   where n_accel = max(1, a/g) covers hoist acceleration.
//
// Design-allowable FOS (Shigley Table 17-25): factor of safety on F_u for
// the application class (track 3.0, guy 3.5, haulage 6.0, hoist 5.0,
// elevator 11.0, mine shaft 8.0). Recommended D/d (Table 17-27): 6x19 → 34,
// 6x37 → 23, 6x61 → 18.

#pragma once

#include <string>

namespace forge::wirerope {

struct Input {
    std::string ropeClass;          // "6x19" | "6x37" | "6x61"
    std::string applicationClass;   // "hoist" | "elevator" | "haulage" |
                                    // "guy" | "track" | "mine"
    double nominalDiameterMm;       // d_r
    double workingLoadN;            // F_applied (static lift weight)
    double sheaveDiameterMm;        // D
    double accelerationG;           // hoist accel / g (1.0 = static)
};

struct Result {
    // -------- Strength
    double breakingStrengthN;            // F_u (table 17-24)
    double factorOfSafetyStatic;         // F_u / F_applied
    double factorOfSafetyDynamic;        // F_u / (F_applied · n_accel)
    // -------- Bending fatigue
    double outerWireDiameterMm;          // d_w
    double bendingStressMPa;             // σ_b = E_r·d_w/D
    double metallicAreaMm2;              // A_m
    double equivalentBendingTensionN;    // F_b = σ_b·A_m
    double totalEffectiveTensionN;       // F_applied·n_accel + F_b
    double factorOfSafetyTotal;          // F_u / F_tot
    // -------- Geometry vs design
    double sheaveRatio;                  // D/d
    double recommendedMinSheaveRatio;    // table 17-27
    double recommendedFOS;               // table 17-25
    // -------- Disposition
    bool   sheavePasses;                 // D/d ≥ recommendedMin
    bool   strengthPasses;               // FOS_total ≥ recommendedFOS
    bool   passes;                       // both
};

Result analyse(const Input& in);

}  // namespace forge::wirerope
