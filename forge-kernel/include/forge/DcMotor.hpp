// Forge-279 — DC shunt motor steady-state analysis.
//
// Separately-excited / shunt DC motor with constant field flux Φ:
//
//   E_a = V_t − I_a · R_a                  (Kirchhoff at armature)
//   E_a = K_aΦ · ω                          (back-EMF identity)
//   T_a = K_aΦ · I_a                        (developed torque)
//
// Given operating point with mechanical load torque T_L = T_a:
//   I_a    = T_L / (K_aΦ)
//   E_a    = V_t − I_a · R_a
//   ω      = E_a / (K_aΦ),       n = ω · 60 / (2π)
//
// Speed characteristic (textbook):
//   No-load:   n_0   = V_t / (K_aΦ) · 60/(2π)
//   Stall:     T_s   = V_t · K_aΦ / R_a   (at ω = 0)
//   Slope:    dn/dT = −R_a / (K_aΦ)²       (linearised in rad/s)
//
// Speed regulation:  SR = (n_0 − n_FL) / n_FL · 100 %
//
// Armature-side efficiency:
//   P_mech    = T_L · ω
//   P_in_arm  = V_t · I_a
//   η_arm     = P_mech / P_in_arm
//
// (Field-circuit losses are reported separately so the user can decide
// whether to combine into overall η.)

#pragma once

namespace forge::dcmotor {

struct Input {
    double supplyVoltageV;          // V_t
    double armatureResistanceOhms;  // R_a
    double motorConstantVPerRadS;   // K_a · Φ
    double loadTorqueNm;            // T_L (= T_a at steady state)
    double fieldResistanceOhms;     // R_f (set 0 if separately excited / no field on V_t)
};

struct Result {
    double armatureCurrentA;        // I_a
    double backEmfV;                // E_a
    double angularSpeedRadS;        // ω
    double speedRpm;                // n
    double noLoadSpeedRpm;          // n_0
    double stallTorqueNm;           // T_s
    double speedRegulationPct;      // SR
    double mechanicalPowerW;        // P_mech
    double armatureInputPowerW;     // V_t · I_a
    double armatureCopperLossW;     // I_a² · R_a
    double fieldCurrentA;           // I_f = V_t / R_f, 0 if R_f = 0
    double fieldCopperLossW;        // I_f² · R_f
    double armatureEfficiency;      // η_arm = P_mech / (V_t · I_a)
};

Result analyse(const Input& in);

}  // namespace forge::dcmotor
