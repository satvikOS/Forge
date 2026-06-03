// Forge-280 — Wire rope sling working-load-limit (WLL) calculator.
// References: ASME B30.9, OSHA 1926.251, DIN 3088.
//
// Single-leg WLL:
//   WLL_single = BS / DF
//   where BS = catalogue breaking strength (kN) and DF = design factor
//   (5 for general rigging per OSHA; 10 for sling-as-tieback per ASME).
//
// Hitch correction (per ASME B30.9 — vertical reference):
//   vertical:    H_factor = 1.00
//   choker:      H_factor = 0.75  (load chokes around itself, reducing capacity)
//   basket(2D):  H_factor = 2.00  (rope wraps under load — both sides carry)
//
// Multi-leg sling at half-angle θ from the vertical:
//   per-leg load when assembly carries W:
//     T_leg = (W / n_legs) / cos θ
//   ⇒ rated assembly capacity such that T_leg ≤ WLL_single·H_factor:
//     WLL_assembly = WLL_single · H_factor · n_legs · cos θ
//
// Note: ASME caps θ at 60 ° (i.e. 30 ° between leg and vertical is the
// safer practice). 60–75 ° is "danger zone" — capacity falls precipitously.
//
// SI units throughout (force N, angle deg).

#pragma once

#include <string>

namespace forge::wireropesling {

enum class HitchType { Vertical, Choker, BasketDouble };

struct Input {
    double breakingStrengthN;       // BS
    double designFactor;            // DF (5 typical)
    int    numberOfLegs;            // 1, 2, 3, or 4
    double legAngleFromVerticalDeg; // θ (0 = vertical, 60 = max OSHA recommended)
    HitchType hitchType;
};

struct Result {
    double singleLegWllN;           // WLL per leg, no hitch
    double hitchFactor;             // 1, 0.75, 2
    double cosTheta;
    double assemblyWllN;            // total assembly WLL
    double perLegLoadAtFullCapacityN;
    std::string angleStatus;        // "safe" | "caution" | "danger"
};

Result analyse(const Input& in);

}  // namespace forge::wireropesling
