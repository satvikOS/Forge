#pragma once

// Forge-216 — closed-form beam deflection for common configurations.
//
// All formulas assume linear elastic small-deflection beam theory
// (Euler-Bernoulli). Inputs: length L, load (point P or UDL w),
// flexural rigidity EI. Outputs: max deflection δ, max slope θ_max
// (radians), max bending moment M_max.
//
// Configurations covered:
//
//   cantilever-point   P at free tip:
//       δ = P L³ / (3 E I), θ = P L² / (2 E I), M = P L
//   cantilever-udl     w over whole span:
//       δ = w L⁴ / (8 E I), θ = w L³ / (6 E I), M = w L² / 2
//   ss-point           P at mid-span of simply supported beam:
//       δ = P L³ / (48 E I), θ = P L² / (16 E I), M = P L / 4
//   ss-udl             w over whole span:
//       δ = 5 w L⁴ / (384 E I), θ = w L³ / (24 E I), M = w L² / 8
//   ff-udl             w over whole span, both ends fixed:
//       δ = w L⁴ / (384 E I), θ ≈ 0, M = w L² / 12

#include <string>

namespace forge { namespace beam {

enum class Config {
    CantileverPoint,
    CantileverUdl,
    SimplySupportedPoint,
    SimplySupportedUdl,
    FixedFixedUdl,
};

Config configFromString(const std::string& name);

struct Inputs {
    Config config;
    double length;              // m
    double load;                // P [N] for point, w [N/m] for UDL
    double youngsModulus;       // Pa
    double secondMomentI;       // m⁴
};

struct Outputs {
    double deflectionMax;       // m
    double slopeMax;            // rad
    double momentMax;           // N·m
};

Outputs solve(const Inputs& in);

}} // namespace forge::beam
