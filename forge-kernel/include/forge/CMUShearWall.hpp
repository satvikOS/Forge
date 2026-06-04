// Forge-340a — Concrete-masonry in-plane shear wall (TMS 402-22 §9.3.4).
//   Shear strength V_n = V_nm + V_ns
//     V_nm = (4.0 − 1.75·M_u/(V_u·d_v)) · A_n · 0.083 · √f'_m   imperial  (SI: 0.083 = MPa unit)
//     V_ns = 0.5·A_v/s · f_y · d_v
//   Max shear cap (§9.3.4.1.2):
//     V_n,max ≤ 0.5·A_n·√f'_m       if M_u/(V_u·d_v) ≤ 0.25
//     V_n,max ≤ 0.33·A_n·√f'_m      if M_u/(V_u·d_v) ≥ 1.0
//   φ = 0.8 ASD-style for shear (used here as Φ_v).

#pragma once

namespace forge::cmushear {

struct Input {
    double Vu_kN;                  // factored shear
    double Mu_kNm;                 // factored moment at section
    double netArea_An_mm2;         // gross less voids (filled-cell A_n)
    double wallLength_dv_mm;       // length of wall in direction of shear
    double primeMasonryStrength_fm_MPa;
    double horizReinfArea_Av_mm2;  // total area per spacing s
    double horizReinfSpacing_s_mm;
    double horizReinfYield_fy_MPa;
    double phi;                    // 0.8 typ shear
};

struct Result {
    double M_over_Vd;
    double Vnm_kN;
    double Vns_kN;
    double Vn_kN;
    double VnMax_kN;
    double Vn_governed_kN;
    double phiVn_kN;
    bool   meetsDemand;            // φV_n ≥ V_u
};

Result analyse(const Input& in);

}  // namespace forge::cmushear
