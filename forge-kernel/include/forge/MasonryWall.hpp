// Forge-322a — Reinforced masonry wall slender-wall flexure (TMS 402-22 §9.3.5.2).
//   A_se  = A_s + P_u/f_y
//   a     = (A_se·f_y + P_u) / (0.80·f'_m·b)
//   M_n   = A_se·f_y·(d − a/2)
//   φ = 0.9 tension-controlled

#pragma once

namespace forge::masonry {

struct Input {
    double wallWidthB_mm;
    double effectiveDepth_d_mm;
    double steelAreaAs_mm2;
    double factoredAxialPu_kN;
    double fm_MPa;                  // f'_m masonry compressive
    double fy_MPa;
};

struct Result {
    double aMm;                     // stress-block depth
    double Ase_mm2;
    double nominalMoment_kNm;       // M_n
    double designMoment_kNm;        // φM_n
};

Result analyse(const Input& in);

}  // namespace forge::masonry
