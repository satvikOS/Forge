// Forge-261 — Fin efficiency (Incropera Ch. 3).
//
// Straight rectangular fin (insulated tip approximation, corrected length):
//   L_c = L + t/2
//   m   = √(2·h / (k·t))
//   η_f = tanh(m·L_c) / (m·L_c)
//   A_f = 2·w·L_c                        (per fin face area)
//   q_f = η_f · h · A_f · ΔT
//   ε_f = q_f / (h·A_c·ΔT)               A_c = w·t (base area)
//
// Pin fin (insulated tip):
//   L_c = L + D/4
//   m   = √(4·h / (k·D))
//   η_f = tanh(m·L_c) / (m·L_c)
//   A_f = π·D·L_c
//   A_c = π·D²/4
//   q_f = η_f · h · A_f · ΔT
//   ε_f = q_f / (h·A_c·ΔT)

#pragma once

namespace forge::finefficiency {

struct RectInput {
    double heightM;             // L (un-corrected)
    double thicknessM;          // t
    double widthM;              // w
    double thermalConductivity; // k (W/m·K)
    double convectionH;         // h (W/m²·K)
    double temperatureDiffK;    // ΔT (T_b − T_∞)
};

struct Result {
    double parameter_m;
    double correctedLength;     // L_c
    double finEfficiency;       // η_f ∈ [0, 1]
    double finAreaM2;           // A_f
    double heatRateW;           // q_f
    double finEffectiveness;    // ε_f
};

Result rectangular(const RectInput& in);

struct PinInput {
    double lengthM;
    double diameterM;
    double thermalConductivity;
    double convectionH;
    double temperatureDiffK;
};

Result pin(const PinInput& in);

}  // namespace forge::finefficiency
