// Forge-337c — Morison wave force on slender cylinder (DNV-OS-J101 / API RP 2A WSD).
//   F per metre = ρ·(π·D²/4)·C_M·(∂u/∂t) + 0.5·ρ·D·C_D·u·|u|
//   Airy linear wave: u = (πH/T)·(cosh(k(z+d))/sinh(kd))·cos(ωt)
//                    ∂u/∂t = −(2π²H/T²)·(cosh(k(z+d))/sinh(kd))·sin(ωt)
//   ω = 2π/T, k from dispersion ω² = g·k·tanh(k·d)
//   F_max over t = √(F_inertia² + F_drag²) at quarter-cycle approximation.

#pragma once

namespace forge::morison {

struct Input {
    double waveHeight_H_m;
    double wavePeriod_T_s;
    double waterDepth_d_m;
    double cylinderDiameter_D_m;
    double waterDensity_kgM3;       // 1025 sea
    double inertiaCoeff_CM;          // 2.0 cylinder
    double dragCoeff_CD;             // 0.7–1.0 cylinder
    double evaluationDepth_z_m;      // below SWL (negative)
};

struct Result {
    double waveNumber_k_perM;
    double maxParticleVelocity_mps;
    double maxParticleAccel_mps2;
    double inertiaForcePerM_kN;
    double dragForcePerM_kN;
    double resultantPerM_kN;        // √(F_i² + F_d²) approximation
};

Result analyse(const Input& in);

}  // namespace forge::morison
