#pragma once

// Forge-222 — Hydraulic cylinder sizing.
//
// Standard double-acting cylinder calculations:
//
//   Piston area     A_p = π·D²/4
//   Rod area        A_r = π·d²/4
//   Annulus area    A_a = A_p − A_r
//
//   Extend force    F_ext = p · A_p
//   Retract force   F_ret = p · A_a              (rod side, smaller area)
//   Extend speed    v_ext = Q / A_p
//   Retract speed   v_ret = Q / A_a              (faster due to smaller area)
//   Volume / cycle  V_cycle = A_p · stroke
//
// Buckling check on the rod (Euler critical load with the supplied
// effective-length factor K for the rod end conditions):
//
//   I_rod = π·d⁴/64
//   P_cr  = π² · E · I_rod / (K · L)²
//   SF    = P_cr / F_ext     (factor of safety against buckling)
//
// All lengths in metres, pressure in Pa, flow in m³/s.

namespace forge { namespace hydcyl {

struct Inputs {
    double bore;                   // D, m
    double rodDiameter;            // d, m
    double pressure;               // p, Pa
    double flowRate;               // Q, m³/s
    double strokeLength;           // L, m
    double rodE;                   // Pa
    double bucklingK;              // effective-length factor (1.0 pin-pin etc.)
};

struct Outputs {
    double pistonArea;             // m²
    double rodArea;
    double annulusArea;
    double extendForce;            // N
    double retractForce;
    double extendSpeed;            // m/s
    double retractSpeed;
    double volumePerCycle;         // m³
    double rodMomentI;             // m⁴
    double rodEulerCriticalLoad;   // N
    double bucklingSafetyFactor;
};

Outputs analyse(const Inputs& in);

}} // namespace forge::hydcyl
