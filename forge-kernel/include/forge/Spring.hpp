#pragma once

// Forge-217 — helical compression spring design.
//
// Reference: Shigley's Mechanical Engineering Design Ch. 10.
//
// Spring rate     k = G · d⁴ / (8 · D³ · N_a)
// Spring index    C = D / d   (typical 4 ≤ C ≤ 12)
// Wahl factor     K_W = (4C-1)/(4C-4) + 0.615/C
// Max shear       τ_max = K_W · (8 · F · D) / (π · d³)
// Solid height    h_s = N_t · d
// Free length     L_f = h_s + (1 + safetyClearance) · F_max / k
//
// where d = wire diameter, D = mean coil diameter, N_a = active
// coils, N_t = total coils, G = shear modulus, F = applied force.

namespace forge { namespace spring {

struct Inputs {
    double wireDiameter;        // d [m]
    double meanDiameter;        // D [m]
    double activeCoils;         // N_a
    double totalCoils;          // N_t
    double shearModulus;        // G [Pa]
    double appliedForce;        // F [N]
};

struct Outputs {
    double rate;                // N/m
    double springIndex;
    double wahlFactor;
    double maxShearStress;      // Pa
    double solidHeight;         // m
    double deflectionAtF;       // m  ( = F / k )
};

Outputs design(const Inputs& in);

}} // namespace forge::spring
