// Forge-269 — Power screw (lead screw / ball screw) torque & efficiency.
// References: Shigley §8-2; Faires "Design of Machine Elements" §8.
//
// Square thread (no flank angle correction):
//   tan λ  = L / (π · d_m)               (lead angle)
//   tan φ  = μ                            (friction angle)
//   T_raise = (F · d_m / 2) · (L + π·μ·d_m) / (π·d_m − μ·L)
//   T_lower = (F · d_m / 2) · (π·μ·d_m − L) / (π·d_m + μ·L)
//
// Trapezoidal / ACME thread (α = 14.5° half-angle on the thread flank,
// 29° included): replace μ by μ_eff = μ / cos α (secant friction):
//   T_raise = (F · d_m / 2) · (L + π·μ_eff·d_m) / (π·d_m − μ_eff·L)
//
// Thrust-collar torque (constant-pressure assumption):
//   T_collar = F · μ_c · d_c / 2
//
// Efficiency (raising), excluding collar:
//   η = (F · L) / (2π · T_raise) = tan λ / tan(λ + φ_eff)
//
// Self-locking criterion:
//   μ_eff > tan λ   (T_lower ≤ 0 ⇒ thread won't back-drive)
//
// All inputs SI: force N, dimensions mm. Torques output in N·m.

#pragma once

#include <string>

namespace forge::powerscrew {

enum class ThreadType { Square, Acme };

struct Input {
    double axialForceN;
    double meanDiameterMm;     // d_m
    double leadMm;             // L  (multi-start → L = n_starts · pitch)
    double threadFriction;     // μ
    double collarFriction;     // μ_c (0 if no collar)
    double collarMeanDiameterMm; // d_c
    ThreadType threadType;
};

struct Result {
    double leadAngleDeg;
    double frictionAngleDeg;        // atan(μ_eff)
    double effectiveFriction;        // μ_eff = μ (square) or μ/cos α (ACME)
    double raiseTorqueNm;
    double lowerTorqueNm;           // can be negative ⇒ self-locking
    double collarTorqueNm;
    double totalRaiseTorqueNm;       // raise + collar
    double totalLowerTorqueNm;       // lower + collar (collar resists motion)
    double efficiencyPct;            // raising efficiency, no collar
    bool   selfLocking;
};

Result analyse(const Input& in);

}  // namespace forge::powerscrew
