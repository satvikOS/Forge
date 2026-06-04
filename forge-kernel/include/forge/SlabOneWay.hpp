// Forge-324c — RC one-way slab flexure + minimum thickness (ACI 318-19 §7.3 + §9.3.1.1).
//   t_min: simply supported = L/20 (deflection control if no calc)
//          continuous one end = L/24
//          continuous both ends = L/28
//   M_n = A_s·f_y·(d − a/2),  a = A_s·f_y/(0.85·f'_c·b)  per metre strip

#pragma once

#include <string>

namespace forge::slaboneway {

struct Input {
    double spanLength_m;
    double slabThickness_mm;
    double effectiveDepth_d_mm;
    double areaSteelMm2PerM;        // A_s per metre strip
    double fc_MPa;
    double fy_MPa;
    std::string supportCondition;   // "simple" | "one-cont" | "both-cont" | "cantilever"
};

struct Result {
    double minimumThicknessMm;
    double a_mm;
    double nominalMoment_kNmPerM;
    double designMoment_kNmPerM;
    bool   thicknessAdequate;
};

Result analyse(const Input& in);

}  // namespace forge::slaboneway
