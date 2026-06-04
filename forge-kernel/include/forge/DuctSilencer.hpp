// Forge-334d — HVAC duct silencer attenuation (ASHRAE Handbook Ch 49 / SMACNA).
//   Parallel-baffle silencer attenuation per octave band:
//     A_oct = A_octave_base + (P / A_open) · B_factor
//   Simplified Sabine-Ingard form for lined duct:
//     IL_oct[dB] = K_oct · (P · L) / A_cross           K_oct from table.
//   Self-noise sound power L_w increases with face velocity.
//   Pressure drop ΔP = K_loss · ρ · v² / 2 (typical K = 0.25–1.0).

#pragma once

namespace forge::silencer {

struct Input {
    double length_m;               // L
    double openCrossArea_m2;       // A_open
    double linedPerimeter_m;       // P (linear ft of lining around free area)
    double faceVelocity_mps;       // v
    double airDensity_kgM3;        // ρ
    double pressureLossK;          // K_loss
    double Koct_dBPerMeter;        // K_oct (mid-freq 1 kHz Sabine ~ 1.0/m·m perim ratio)
};

struct Result {
    double insertionLoss_dB;       // Σ across L
    double pressureDrop_Pa;
    double selfNoise_LwA_dB;       // approx empirical
};

Result analyse(const Input& in);

}  // namespace forge::silencer
