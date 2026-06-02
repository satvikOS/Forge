#pragma once

// Forge-230 — Refrigeration / heat-pump COP (Carnot + vapor cycle).
//
// Carnot COPs (upper limit, K-temperatures):
//   COP_refrig = T_cold / (T_hot − T_cold)
//   COP_HP     = T_hot  / (T_hot − T_cold)         = COP_refrig + 1
//
// Vapor-compression cycle (caller supplies the 4 cycle enthalpies):
//   1 — compressor inlet (saturated vapor at low pressure)
//   2 — compressor outlet (superheated at high pressure)
//   3 — condenser outlet (saturated liquid at high pressure)
//   4 — throttle outlet = h_3 (constant-enthalpy expansion)
//
//   q_L = h_1 − h_4                          (refrigeration effect)
//   q_H = h_2 − h_3                          (condenser rejection)
//   w_c = h_2 − h_1                          (compressor work input)
//   COP_refrig = q_L / w_c
//   COP_HP     = q_H / w_c                   = COP_refrig + 1 ideal
//
// Sizing:
//   Compressor power W_dot = Q_dot_cool / COP_refrig    (refrig mode)
//                          = Q_dot_heat / COP_HP        (HP mode)
//
// Cycle efficiency vs Carnot (a useful screening number):
//   η_2nd-law = COP_actual / COP_Carnot

#include <string>

namespace forge { namespace refrig {

enum class Mode { Refrigeration, HeatPump };

Mode modeFromString(const std::string& s);

double carnotCOP(double T_hot_K, double T_cold_K, Mode mode);

struct CycleInputs {
    double h1;       // J/kg
    double h2;       // J/kg
    double h3;       // J/kg (= h4 after throttle)
    Mode   mode;
};

struct CycleOutputs {
    double refrigerationEffect;  // q_L, J/kg
    double condenserRejection;   // q_H, J/kg
    double compressorWork;       // w_c, J/kg
    double cop;                  // refrig or HP per mode
};

CycleOutputs vaporCycle(const CycleInputs& in);

double compressorPower(double thermalCapacity, double cop);

}} // namespace forge::refrig
