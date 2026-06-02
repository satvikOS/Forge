#pragma once

// Forge-227 — V-belt drive design (open belt geometry).
//
// Pitch length (approximate, < 1% error for C / (d_2 − d_1) ≥ 3):
//   L_p = 2·C + (π/2)·(d_1 + d_2) + (d_2 − d_1)² / (4·C)
//
// Centre distance from pitch length:
//   B  = 4·L_p − 2·π·(d_1 + d_2)
//   C  = [B + √(B² − 32·(d_2 − d_1)²)] / 16
//
// Wrap angle on small pulley:
//   θ_s = π − 2·arcsin((d_2 − d_1) / (2·C))   [rad]
//
// Belt speed at the small pulley:
//   V = π · d_1 · n_1 / 60      [m/s if d in m, n in rpm]
//
// Number of belts:
//   P_design = K_S · P_nominal
//   n_belts  = ceil(P_design / P_per_belt)

namespace forge { namespace vbelt {

double pitchLength(double d1, double d2, double centreDist);
double centreDistFromLength(double d1, double d2, double pitchLength);
double wrapAngleSmallRad(double d1, double d2, double centreDist);

struct Inputs {
    double d1;                // small pulley pitch dia, m
    double d2;                // large pulley pitch dia, m
    double centreDist;        // m
    double rpmSmall;          // n_1
    double nominalPower;      // P, W
    double serviceFactor;     // K_S
    double ratingPerBelt;     // W per belt (after K_θ and K_L)
};

struct Outputs {
    double pitchLength;       // m
    double wrapAngleSmallDeg; // °
    double beltSpeed;         // m/s
    double designPower;       // W
    double beltCount;         // continuous (caller ceils)
};

Outputs analyse(const Inputs& in);

}} // namespace forge::vbelt
