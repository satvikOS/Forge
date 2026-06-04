// Forge-324e — Unreinforced CMU compression (TMS 402 §8.2.2 / ASTM C90).
//   P_n = 0.80 · A_n · f'_m · [1 − (h/(140·r))²]   for h/r ≤ 99
//       = 0.80 · A_n · f'_m · (70·r/h)²             for h/r > 99
//   φ = 0.60

#pragma once

namespace forge::cmucomp {

struct Input {
    double netAreaMm2;             // A_n
    double radiusOfGyrationMm;     // r
    double effectiveHeightMm;      // h
    double fm_MPa;                 // f'_m masonry compressive
};

struct Result {
    double slendernessRatio_h_r;
    double nominalCapacityKn;      // P_n
    double designCapacityKn;       // φP_n
    bool   slenderRegime;          // h/r > 99
};

Result analyse(const Input& in);

}  // namespace forge::cmucomp
