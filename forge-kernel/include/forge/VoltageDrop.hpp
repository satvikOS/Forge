// Forge-304 — Conductor voltage drop (NEC 215.2 informational, IEC 60364).
//
// Computes the line-to-load voltage drop of a feeder or branch circuit and
// flags the NEC 215.2(A)(1) informational note recommendations:
//     ≤ 3 % drop on the feeder
//     ≤ 5 % drop on the combined feeder + branch
//
// Single-phase 2-wire:   V_drop = 2 · I · (R·PF + X·sin(φ)) · L
// Three-phase line-line: V_drop = √3 · I · (R·PF + X·sin(φ)) · L
//
// where R is the AC resistance per metre (ρ/A scaled), X the reactance per
// metre (taken from Chapter 9 Table 9; for cables in PVC conduit X ≈
// 0.13 mΩ/m for #6 AWG dropping to 0.10 mΩ/m at 500 kcmil — we use a
// dimension-independent default of 0.000125 Ω/m unless the caller provides
// a specific value). Conductor resistivity uses ρ(20 °C) = 1.72e-8 Ω·m for
// copper, 2.83e-8 Ω·m for aluminium, scaled to T by the standard
//     ρ(T) = ρ(20) · (1 + α (T − 20))
// with α = 0.00393 (Cu) or 0.00403 (Al) per IEC 60228.

#pragma once

#include <string>

namespace forge::voltagedrop {

struct Input {
    std::string conductor;          // "copper" | "aluminum"
    std::string phaseSystem;        // "single" | "three"
    double crossSectionMm2;         // conductor cross-section
    double currentA;                // load current
    double oneWayLengthM;           // L (run, not the round trip)
    double nominalVoltageV;         // 120, 208, 240, 277, 480 …
    double powerFactor;             // cos φ ∈ (0,1]
    double conductorTempC;          // 75 default per Table 310.16 75 °C col
    double reactancePerMOhm;        // X per metre (set 0 to ignore)
};

struct Result {
    double resistancePerMOhm;          // R per metre at conductorTempC
    double reactancePerMOhmOut;        // echoed X
    double impedanceVoltageDropV;      // (R·PF + X·sinφ)·I·L·K
    double voltageDropV;               // alias = impedance-based drop
    double voltageDropPercent;         // V_drop / V_nom · 100
    double powerLossKw;                // I²·R·L·N (N=2 single, 3 three)
    bool   meetsFeederLimit;           // ≤ 3 %
    bool   meetsCombinedLimit;         // ≤ 5 %
};

Result analyse(const Input& in);

}  // namespace forge::voltagedrop
