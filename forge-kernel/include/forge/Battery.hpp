// Forge-254 — Battery sizing (Peukert + runtime + CC-CV charge).
//
// Peukert's law: effective capacity drops with discharge rate.
//   t = C_rated · (C_rated / I)^(n − 1) / I
//     = C_rated^n / I^n
//   where C_rated is at the rated discharge time t_rated (e.g. 20 h);
//   n is Peukert exponent (lead-acid 1.1-1.3; Li-ion 1.02-1.06).
//
// Effective Ah at current I (referred to 20-h capacity):
//   C_eff = C_rated · (C_rated / (I · t_rated))^(n − 1)
//
// Charge time (CC-CV) — simplified:
//   CC phase: t_cc = (SOC_target − SOC_initial) · C_rated / I_charge
//   CV phase: t_cv approximated as half of CC time
//   total ≈ t_cc + t_cv  (rough; user can tweak via factor)
//
// Voltage drop on discharge:
//   V_terminal = V_oc − I · R_internal
//
// State-of-charge from open-circuit voltage (linear Pb-acid model):
//   SOC = (V_oc − 11.7) / (12.7 − 11.7)  (clamped to [0,1])

#pragma once

namespace forge::battery {

struct RuntimeInput {
    double ratedCapacityAh;     // C_20 typically
    double ratedHours;          // 20 for "C/20"
    double peukertExponent;     // n
    double loadCurrentA;        // I
};

struct RuntimeResult {
    double effectiveCapacityAh; // C_eff at this I
    double runtimeHours;        // t = C_eff / I
};

RuntimeResult runtime(const RuntimeInput& in);

struct ChargeInput {
    double ratedCapacityAh;
    double chargeCurrentA;
    double initialSoc;          // 0..1
    double targetSoc;           // 0..1, > initialSoc
    double cvPhaseFactor;       // 0.5 default
};

struct ChargeResult {
    double constantCurrentHours;
    double constantVoltageHours;
    double totalHours;
};

ChargeResult chargeTime(const ChargeInput& in);

struct DropInput {
    double openCircuitVoltage;
    double internalResistanceOhm;
    double loadCurrentA;
};

struct DropResult {
    double terminalVoltageV;
    double dropV;
    double stateOfCharge;
};

DropResult terminalState(const DropInput& in);

}  // namespace forge::battery
