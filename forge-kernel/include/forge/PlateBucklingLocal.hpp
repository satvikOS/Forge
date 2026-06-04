// Forge-325c — Local plate buckling for axial compression (AISC 360-22
// §B4.1a + §E7 effective-width / Q_s reduction). Distinct from Forge-311
// (flexural width-thickness classification Table B4.1b).
//
// Case 1 (Unstiffened flange in compression, Case 1 of B4.1a):
//     λ_r = 0.56 · √(E/F_y)
// Case 5 (Stiffened web in uniform compression):
//     λ_r = 1.49 · √(E/F_y)
//
// Slender flange Q_s reduction (§E7.1):
//   λ ≤ 0.56·√(E/F_y)                  →  Q_s = 1.0
//   0.56·√(E/F_y) < λ ≤ 1.03·√(E/F_y)  →  Q_s = 1.415 − 0.74·(b/t)·√(F_y/E)
//   λ > 1.03·√(E/F_y)                  →  Q_s = 0.69·E / (F_y·(b/t)²)

#pragma once

#include <string>

namespace forge::platebuck {

struct Input {
    std::string elementType;         // "flange" | "web"
    double widthMm;                  // b (flange projection) or h (web clear)
    double thicknessMm;              // t
    double Fy_MPa;
    double E_MPa;
};

struct Result {
    double slenderness;              // b/t or h/t_w
    double lambdaR;                  // limit
    std::string classification;      // "nonslender" | "slender"
    double Qs;                       // §E7.1 reduction for slender flange (=1 nonslender)
};

Result analyse(const Input& in);

}  // namespace forge::platebuck
