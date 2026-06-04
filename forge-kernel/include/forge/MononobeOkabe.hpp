// Forge-309 — Mononobe-Okabe seismic active earth-pressure (Mononobe 1924,
// Okabe 1929, Seed & Whitman 1970 application).
//
// Companion to Forge-242 (or wherever) static Coulomb retaining wall — every
// retaining wall in a seismic zone needs both. The classic Mononobe-Okabe
// pseudo-static extension treats earthquake acceleration as an extra body
// force on a Coulomb wedge:
//
//   θ = arctan(k_h / (1 − k_v))                  seismic inertia angle
//
//   K_AE = cos²(φ − θ − β)
//          ──────────────────────────────────────────────────────
//          cos(θ) · cos²(β) · cos(δ + β + θ) · [1 + √(N)]²
//
//   where N = sin(φ + δ) · sin(φ − θ − i)
//             ─────────────────────────────────
//             cos(δ + β + θ) · cos(i − β)
//
//   P_AE = ½ · γ · H² · K_AE · (1 − k_v)         total active force (kN/m)
//   P_a  = ½ · γ · H² · K_a                       Coulomb static portion
//   ΔP   = P_AE − P_a                             seismic increment
//
//   Point of application above the base (Seed & Whitman 1970):
//     static portion at H/3, dynamic increment at 0.6·H — composite varies.

#pragma once

namespace forge::mokabe {

struct Input {
    double soilFrictionAngleDeg;     // φ
    double wallFrictionAngleDeg;     // δ — typ 2/3·φ for concrete wall
    double backfillSlopeDeg;         // i
    double wallTiltDeg;              // β — 0 = vertical
    double horizontalSeismicCoeff;   // k_h (PGA / g design)
    double verticalSeismicCoeff;     // k_v — typ ± ⅔·k_h or 0
    double soilUnitWeightKnPerM3;    // γ
    double wallHeightM;              // H
};

struct Result {
    double staticKa;
    double seismicKae;
    double seismicInertiaAngleDeg;
    double staticForceKnPerM;
    double totalSeismicForceKnPerM;
    double seismicIncrementKnPerM;
    double pointOfApplicationFromBaseM;  // composite Seed-Whitman
};

Result analyse(const Input& in);

}  // namespace forge::mokabe
