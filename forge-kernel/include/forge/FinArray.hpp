// Forge-295 — Heat sink rectangular fin array (Incropera §3.6, Kern).
//
// Extends Forge-261 (single-fin efficiency) to the full extended-surface
// configuration: a plain base plate with N uniformly spaced rectangular
// straight fins, each of thickness t, length (height) L_f, width W (same as
// the base). The Harper-Brown corrected length L_c = L_f + t/2 absorbs the
// fin tip area into an equivalent insulated-tip fin.
//
//   Fin parameter:           m = √(2 h / (k · t))
//   Corrected length:        L_c = L_f + t/2
//   Single-fin efficiency:   η_f = tanh(m · L_c) / (m · L_c)
//
//   Per-fin surface area:    A_f = 2 · L_c · W
//   Total fin area:          A_f_tot = N · A_f
//   Bare base area between:  A_b = (b − N·t) · W           (b = base length)
//   Total exposed area:      A_t = A_f_tot + A_b
//
//   Overall surface efficiency:
//       η_o = 1 − (A_f_tot / A_t) · (1 − η_f)
//
//   Thermal resistance:      R_t = 1 / (η_o · h · A_t)     [K/W]
//   Heat dissipated:         Q   = (T_base − T_amb) / R_t  [W]
//
// SI throughout. Dimensions mm internally → m for the heat-transfer math.

#pragma once

namespace forge::finarray {

struct Input {
    double baseWidthMm;
    double baseLengthMm;
    int    finCount;
    double finThicknessMm;
    double finLengthMm;
    double materialConductivityWmK;
    double convectionCoefficientWm2K;
    double baseTemperatureC;
    double ambientTemperatureC;
};

struct Result {
    double finParameterPerM;        // m
    double correctedLengthMm;       // L_c
    double singleFinEfficiency;     // η_f
    double singleFinAreaMm2;
    double totalFinAreaMm2;
    double baseAreaMm2;             // exposed base between fins
    double totalAreaMm2;
    double overallSurfaceEfficiency; // η_o
    double thermalResistanceKW;     // K/W
    double heatDissipatedW;
};

Result analyse(const Input& in);

}  // namespace forge::finarray
