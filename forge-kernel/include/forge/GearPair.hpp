#pragma once

// Forge-221 — Spur gear pair AGMA/Lewis bending + Hertz contact stress.
//
// Pinion (1) drives gear (2). Module m and pressure angle φ (default
// 20°) follow ISO conventions.
//
//   Pitch radius        r_i = m · N_i / 2
//   Centre distance     C   = (r_1 + r_2)
//   Gear ratio          m_G = N_2 / N_1
//   Tangential force    W_t = T_1 / r_1
//
//   Lewis form factor Y (smooth fit to Shigley Table 14-2 for φ=20°
//   full-depth involute):
//     Y(N) ≈ 0.484 − 0.2745 / √N      (good to ~3% for N ∈ [17, 100])
//
//   Lewis bending stress (per gear):
//     σ_b = W_t / (b · m · Y)
//
//   AGMA bending stress (simple form, factors default to 1.0):
//     σ_AGMA = σ_b · K_O · K_V · K_S · K_H · K_B
//
//   Hertz contact stress (spur gear contact at pitch point):
//     I  = (sin φ · cos φ · m_G) / (2 (m_G + 1))   (external)
//     Z_E = √(1 / (π · ((1−ν_1²)/E_1 + (1−ν_2²)/E_2)))
//     σ_H = Z_E · √(W_t / (b · d_1 · I))
//
//   where b = face width, d_1 = pitch diameter of the pinion.

namespace forge { namespace gearpair {

double lewisFormFactor(double teeth);

struct Inputs {
    double module;                  // m, mm
    double teeth1;                  // pinion
    double teeth2;                  // gear
    double faceWidth;               // b, mm
    double torque1;                 // T at pinion, N·mm
    double pressureAngleDeg;        // typically 20°
    double materialE1;              // Pa
    double materialE2;              // Pa
    double materialNu1;             // Poisson
    double materialNu2;             // Poisson
    double KO, KV, KS, KH, KB;      // AGMA correction factors (1.0 default)
};

struct Outputs {
    double centreDistance;          // mm
    double gearRatio;
    double pitchDiameter1;          // mm
    double pitchDiameter2;          // mm
    double tangentialLoadN;         // N
    double lewisFormFactor1;
    double lewisFormFactor2;
    double bendingStressLewis1;     // Pa, pinion
    double bendingStressLewis2;     // Pa, gear
    double bendingStressAGMA1;      // Pa, with factors applied
    double bendingStressAGMA2;
    double contactStressHertz;      // Pa
};

Outputs analyse(const Inputs& in);

}} // namespace forge::gearpair
