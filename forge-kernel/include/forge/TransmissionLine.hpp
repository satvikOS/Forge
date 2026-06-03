// Forge-248 — Transmission line ABCD (Stevenson Chapter 5).
//
// Three models per length L:
//
// Short (L ≤ ~80 km):
//   A = 1,  B = Z = (r + jx)·L
//   C = 0,  D = 1
//
// Medium π (~80 < L ≤ ~250 km):
//   Y = (g + jb)·L,   Z = (r + jx)·L
//   A = 1 + Y·Z/2     B = Z
//   C = Y·(1 + Y·Z/4) D = A
//
// Long (L > 250 km):
//   γ = √(z·y);   Z_c = √(z/y)
//   A = cosh(γL)            B = Z_c · sinh(γL)
//   C = sinh(γL)/Z_c        D = cosh(γL)
//
// Given receiving-end V_R and I_R (complex), sending end:
//   V_S = A·V_R + B·I_R
//   I_S = C·V_R + D·I_R
//
// Voltage regulation:
//   reg% = (|V_R,noload| − |V_R,fullload|) / |V_R,fullload| · 100
//        ≈ (|V_S|/|A| − |V_R|) / |V_R| · 100
//
// Efficiency: η = Re(V_R · I_R*) / Re(V_S · I_S*)  (per-phase).

#pragma once

namespace forge::tline {

enum class Model { Short, MediumPi, LongLine };

struct LineParams {
    double resistancePerKmOhm;   // r (Ω/km)
    double reactancePerKmOhm;    // x (Ω/km)
    double conductancePerKmS;    // g (S/km) — often 0
    double susceptancePerKmS;    // b (S/km) — capacitive
    double lengthKm;             // L (km)
};

struct LoadInput {
    double receivingPhaseVoltageV;  // |V_R| (line-to-neutral)
    double receivingPowerW;         // P_R (per-phase real power)
    double receivingPowerFactor;    // cosφ_R
    bool   leading;                 // load is leading?
};

struct Abcd {
    double A_mag, A_ang;
    double B_mag, B_ang;
    double C_mag, C_ang;
    double D_mag, D_ang;
};

Abcd abcd(Model model, const LineParams& p);

struct Result {
    Abcd abcd;
    double sendingVoltageV;
    double sendingVoltageAngDeg;
    double sendingCurrentA;
    double sendingCurrentAngDeg;
    double sendingPowerFactor;
    double sendingRealPowerW;
    double sendingApparentVA;
    double regulationPct;
    double efficiency;
};

Result analyse(Model model, const LineParams& p, const LoadInput& load);

}  // namespace forge::tline
