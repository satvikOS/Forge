// Forge-281 — Disc clutch / disc brake torque calculator.
// Reference: Shigley §16-2 (axial-actuated annular friction interface).
//
// Two classical assumptions for the radial pressure distribution between
// the friction faces:
//
//   Uniform wear (preferred for "broken-in" clutches and brakes):
//       p(r) = p_a · R_i / r        (constant p·r product)
//       F   = π · p_a · R_i · (R_o − R_i)
//       T   = μ · F · (R_o + R_i) / 2 · n
//       p_max = p_a   (at r = R_i — the inner radius)
//
//   Uniform pressure (preferred for "new" friction surfaces):
//       p(r) = p_a = const
//       F   = π · p_a · (R_o² − R_i²)
//       T   = (2/3) · μ · F · (R_o³ − R_i³) / (R_o² − R_i²) · n
//       p_max = p_a   (uniform — same everywhere)
//
// where n = number of pairs of friction surfaces (a single disc clutch has
// n = 2 because both faces of the disc rub against mating plates).
//
// SI units: force N, radii mm, friction coefficient dimensionless, output
// torque N·m and pressure MPa.

#pragma once

#include <string>

namespace forge::discbrake {

enum class Assumption { UniformWear, UniformPressure };

struct Input {
    double outerRadiusMm;       // R_o
    double innerRadiusMm;       // R_i
    double frictionCoefficient; // μ
    double clampingForceN;      // F
    int    numberOfFaces;       // n (2 for single-disc clutch w/ both sides used)
    Assumption assumption;
};

struct Result {
    double meanRadiusMm;        // (R_o + R_i) / 2
    double contactAreaMm2;      // π·(R_o² − R_i²)
    double torqueNm;
    double averagePressureMPa;  // F / A
    double maxPressureMPa;      // p_a
    std::string assumptionUsed;
};

Result analyse(const Input& in);

}  // namespace forge::discbrake
