// Forge-246 — Three-phase induction motor (Chapman / Fitzgerald).
//
// Per-phase equivalent circuit referred to stator (Y-equivalent):
//   Stator branch  : R_1 + jX_1
//   Magnetising    : R_c || jX_m  (often R_c omitted; we keep X_m only)
//   Rotor branch   : R_2/s + jX_2   (referred)
//
// Thevenin from terminal of magnetising branch onwards:
//   V_th = V_ph · jX_m / (R_1 + j(X_1 + X_m))
//   Z_th = (R_1 + jX_1) · jX_m / (R_1 + j(X_1 + X_m))
//   so |V_th| ≈ V_ph · X_m / √(R_1² + (X_1+X_m)²)
//   R_th = Re(Z_th); X_th = Im(Z_th)
//
// Synchronous angular speed: ω_s = 4·π·f / poles
// Mech speed: ω_m = (1−s)·ω_s
//
// Developed torque (per-phase Thevenin form):
//   T_d(s) = (3 / ω_s) · |V_th|² · (R_2/s) /
//            [ (R_th + R_2/s)² + (X_th + X_2)² ]
//
// Breakdown slip (max torque on motor side):
//   s_b = R_2 / √(R_th² + (X_th + X_2)²)
//   T_max = (3 / ω_s) · 0.5 · |V_th|² /
//           [ R_th + √(R_th² + (X_th + X_2)²) ]
//
// Starting torque (s = 1) and starting current.

#pragma once

namespace forge::inductionmotor {

struct Input {
    double phaseVoltageV;       // V_ph (line-to-neutral)
    double frequencyHz;         // f
    int poles;                  // 2, 4, 6, ...
    double stator_R1;           // Ω
    double stator_X1;
    double rotor_R2;            // Ω, referred to stator
    double rotor_X2;
    double mag_Xm;
    double slip;                // s (0 < s ≤ 1)
};

struct Result {
    double synchronousRadPerS;  // ω_s
    double synchronousRpm;
    double mechanicalRpm;
    double thevenin_V;          // |V_th|
    double thevenin_R;          // R_th
    double thevenin_X;          // X_th
    double developedTorqueNm;   // T_d(s)
    double airGapPowerW;        // P_ag = T_d · ω_s
    double mechPowerW;          // P_m  = (1−s)·P_ag
    double rotorCopperLossW;    // P_cu_r = s·P_ag
    double rotorCurrentA;       // I_2 magnitude
    double breakdownSlip;       // s_b
    double breakdownTorqueNm;   // T_max
    double startingTorqueNm;    // T_d(1)
    double startingCurrentA;    // I_2 at s=1
};

Result analyse(const Input& in);

}  // namespace forge::inductionmotor
