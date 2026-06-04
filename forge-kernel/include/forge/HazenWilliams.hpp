// Forge-303 — Hazen-Williams pipe friction (NFPA 13 / AWWA water mains).
//
// The empirical Hazen-Williams equation governs fire-protection hydraulic
// calculations under NFPA 13 and is the standard for sizing municipal water
// distribution mains under AWWA M11. Compared with Darcy-Weisbach it skips
// the Reynolds-number dependence and bakes the friction factor into a
// material-dependent coefficient C (steel ~120, ductile iron ~140, PVC
// ~150, copper ~130, old/corroded ~80-100).
//
// Head-loss form (SI, head in metres of water, Q in m³/s, D in m):
//
//     h_f [m/m] = 10.67 · Q^1.85 / (C^1.85 · D^4.87)
//
// Pressure-drop form: ΔP[Pa/m] = ρ · g · h_f.
//
// The equation is only physically valid in the turbulent regime
// (Re ≳ 4000); we report a Reynolds estimate and a regime flag so the
// caller can refuse to apply the model to laminar/transitional flow.
//
// Velocity: V = 4·Q / (π·D²)         (m/s)
// Velocity head: ρV²/2               (Pa)
// Reynolds: Re = ρ·V·D / μ           (water 1000 kg/m³, 1.002e-3 Pa·s)

#pragma once

namespace forge::hazenwilliams {

struct Input {
    double pipeLengthM;          // L
    double innerDiameterMm;      // D (mm for ergonomics)
    double flowLpm;              // Q (L/min)
    double hazenWilliamsC;       // C, dimensionless
};

struct Result {
    double velocityMs;                  // V
    double reynoldsApprox;              // Re
    int    regimeFlag;                  // 1 laminar | 2 transitional | 3 turbulent
    double frictionLossMPerM;           // h_f per m of pipe (m water / m pipe)
    double pressureGradientKpaPerM;     // ΔP/L (kPa/m)
    double totalPressureLossKpa;        // L · ΔP/L
    double velocityHeadKpa;             // ρV²/2 (kPa)
};

Result analyse(const Input& in);

}  // namespace forge::hazenwilliams
