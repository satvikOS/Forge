// Forge-341b — Round HSS (CHS) flexure (AISC 360-22 §F8).
//   λ_p = 0.07·E/F_y         compact
//   λ_r = 0.31·E/F_y         non-compact
//   D/t ≤ λ_p → M_n = M_p = F_y·Z  (plastic)
//   λ_p < D/t ≤ λ_r → M_n = (0.021·E/(D/t) + F_y)·S
//   D/t > λ_r       → M_n = F_cr·S, F_cr = 0.33·E/(D/t)
//   φ_b = 0.9 LRFD.

#pragma once

namespace forge::roundhss {

struct Input {
    double outsideDiameter_D_mm;
    double wallThickness_t_mm;
    double Fy_MPa;
    double E_GPa;
};

struct Result {
    double DoverT;
    double lambda_p;
    double lambda_r;
    int    classification;        // 0 compact, 1 non-compact, 2 slender
    double plasticModulus_Z_mm3;
    double elasticModulus_S_mm3;
    double Mn_kNm;
    double phiMn_kNm;
};

Result analyse(const Input& in);

}  // namespace forge::roundhss
