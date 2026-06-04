// Forge-311 — Width-thickness classification for steel I-shapes in flexure
// (AISC 360-22 Table B4.1b, Cases 10 + 15).
//
// The gateway calc that determines whether a steel I-shape can be designed
// as compact (no local-buckling penalty, full plastic moment), non-compact
// (linear-interpolation penalty between F_y·Z and F_y·S), or slender
// (must reduce capacity per §F4/F5). Every flexure check in §F2-F5 starts
// here.
//
// Flange (unstiffened, Case 10 — rolled or welded I-shape compression flange):
//     λ_f = (b_f / 2) / t_f                      half-flange projection / thickness
//     λ_pf = 0.38·√(E/F_y)
//     λ_rf = 1.0·√(E/F_y)
//
// Web (stiffened, Case 15 — symmetric I in flexure):
//     λ_w = h / t_w                              h = d − 2·t_f
//     λ_pw = 3.76·√(E/F_y)
//     λ_rw = 5.70·√(E/F_y)
//
// Class per element:
//   λ ≤ λ_p  →  compact
//   λ ≤ λ_r  →  non-compact
//   λ >  λ_r →  slender
//
// Overall section class = worst (highest) of flange / web classes.

#pragma once

#include <string>

namespace forge::sectclass {

struct Input {
    double bf_mm;           // flange width b_f
    double tf_mm;           // flange thickness t_f
    double d_mm;            // overall depth d
    double tw_mm;           // web thickness t_w
    double Fy_MPa;          // F_y
    double E_MPa;           // E
};

struct Result {
    double flangeSlenderness;       // λ_f
    double flangeLambda_p;
    double flangeLambda_r;
    std::string flangeClass;        // compact | non-compact | slender
    double webSlenderness;          // λ_w
    double webLambda_p;
    double webLambda_r;
    std::string webClass;
    std::string overallClass;       // worst of the two
};

Result analyse(const Input& in);

}  // namespace forge::sectclass
