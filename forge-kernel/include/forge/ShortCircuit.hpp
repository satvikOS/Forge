// Forge-251 — Short-circuit study (Stevenson Ch. 10 / Glover Ch. 7).
//
// Given Y_bus from generator sub-transient reactances X_d'' + branch
// reactances, invert to Z_bus. Bus driving-point impedance Z_ii drives:
//
//   3-phase fault current at bus i:
//     I_F_pu = V_prefault / Z_ii
//   Fault MVA at bus i:
//     S_F_pu = V_prefault² / |Z_ii|
//
// In ampere terms: I_F = I_F_pu · I_base where I_base = S_base/(√3·V_base).
//
// We accept the same branch / shunt-Y_bus representation as Forge-250
// plus an extra `subtransientShuntPu` per bus that injects 1/X_d''
// admittance at the generator buses (sub-transient model). Pure
// loads have no extra shunt.

#pragma once
#include <vector>

namespace forge::shortcircuit {

struct GenShunt {
    int    busIndex;        // 0-indexed
    double subtransientX;   // X_d'' in pu (use 0.20 default for big gen)
};

struct Branch {
    int    from;
    int    to;
    double R;       // pu
    double X;       // pu
};

struct Input {
    int numBuses;
    std::vector<GenShunt> generators;   // generator sub-transient shunts
    std::vector<Branch>   branches;
    double prefaultVoltagePu;            // typically 1.0
};

struct BusResult {
    double zDriveMag;        // |Z_ii|  pu
    double zDriveAngDeg;     // ∠Z_ii   deg
    double faultCurrentPu;   // I_F = V/|Z_ii|
    double faultMvaPu;       // S_F = V²/|Z_ii|  (S in same per-unit base as V)
};

struct Result {
    std::vector<BusResult> buses;
};

Result analyse(const Input& in);

}  // namespace forge::shortcircuit
