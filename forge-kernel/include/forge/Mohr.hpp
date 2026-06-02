#pragma once

// Forge-220 — Mohr's circle / principal stress transformation.
//
// 2D state σ_x, σ_y, τ_xy:
//
//   σ_avg = (σ_x + σ_y) / 2
//   R     = √((σ_x − σ_y)² / 4 + τ_xy²)
//   σ_1   = σ_avg + R        (max principal)
//   σ_2   = σ_avg − R        (min principal)
//   τ_max = R
//   θ_p   = ½ · atan2(2 τ_xy, σ_x − σ_y)
//
// Stress on a plane at angle θ from the x-axis:
//
//   σ_θ = σ_avg + (σ_x − σ_y)/2 · cos 2θ + τ_xy · sin 2θ
//   τ_θ = −(σ_x − σ_y)/2 · sin 2θ + τ_xy · cos 2θ
//
// 3D principal stresses are the eigenvalues of the symmetric stress
// tensor [σ_x, τ_xy, τ_zx; τ_xy, σ_y, τ_yz; τ_zx, τ_yz, σ_z].

namespace forge { namespace mohr {

struct Stress2D {
    double sx, sy, txy;
};

struct Principal2D {
    double sigma1;
    double sigma2;
    double tauMax;
    double thetaPRad;   // principal angle from the x-axis
};

Principal2D principal2D(const Stress2D& s);

struct StressOnPlane {
    double sigma;
    double tau;
};

StressOnPlane stressAtAngle(const Stress2D& s, double thetaRad);

struct Stress3D {
    double sx, sy, sz, txy, tyz, tzx;
};

struct Principal3D {
    double sigma1, sigma2, sigma3;   // sorted descending
};

Principal3D principal3D(const Stress3D& s);

}} // namespace forge::mohr
