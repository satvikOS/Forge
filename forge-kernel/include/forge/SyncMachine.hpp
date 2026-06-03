// Forge-249 — Cylindrical-rotor synchronous machine (Chapman Ch. 5).
//
// Generator convention: I_a from machine to bus.
//   E_f = V_t + jX_s·I_a + R_a·I_a       (with R_a usually neglected)
//   For generator with lag pf: E_f leads V_t by angle δ (power angle).
//
// Real and reactive power (per phase, V_t reference):
//   P_e = |V_t||E_f| sinδ / X_s         (per phase)
//   Q_e = |V_t| ( |E_f|cosδ − |V_t| ) / X_s
//
// Working point computed:
//   I_a magnitude / angle (referred to V_t)
//   E_f magnitude / power angle δ
//   pull-out (max P) at δ = 90°: P_max = |V_t||E_f|/X_s
//
// Motor convention reverses sign of P (motor draws power) — we expose
// a `mode` flag; both share the formulas.

#pragma once

namespace forge::syncmachine {

enum class Mode { Generator, Motor };

struct Input {
    Mode mode;
    double terminalPhaseVoltageV;     // |V_t|
    double synchronousReactanceOhm;   // X_s
    double armatureResistanceOhm;     // R_a (often 0)
    double realPowerPerPhaseW;        // P_e (per-phase real power)
    double powerFactor;               // cosφ
    bool   leading;                   // current leading V_t?
};

struct Result {
    double armatureCurrentA;          // |I_a|
    double armatureCurrentAngDeg;     // ∠I_a (V_t as reference)
    double inducedEmfV;               // |E_f|
    double inducedEmfAngDeg;          // δ (power angle, deg)
    double reactivePowerPerPhaseVar;  // Q_e
    double maxPullOutPowerW;          // P_max per phase
};

Result analyse(const Input& in);

}  // namespace forge::syncmachine
