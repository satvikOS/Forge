// Forge-340b — Slip-critical bolt connection (AISC 360-22 §J3.8 / RCSC).
//   Nominal slip resistance per bolt:
//     R_n = μ · D_u · h_f · T_b · n_s
//       μ  = 0.30 (Class A, mill scale / clean), 0.50 (Class B, blast clean)
//       D_u = 1.13 (ratio of mean to specified pretension)
//       h_f = 1.0 (no filler) or 0.85 (filler)
//       T_b = minimum bolt pretension (Table J3.1)
//       n_s = slip-plane count (1 or 2).
//   Tension reduction (loaded in tension + shear) — k_sc = 1 − T_u/(D_u·T_b·n_b).
//   φ slip = 1.0 standard holes, 0.85 oversized.

#pragma once

namespace forge::sccrit {

struct Input {
    double slipCoefficient_mu;       // 0.30 or 0.50
    int    fillerCount_hf;           // 0 → h_f = 1.0; ≥ 1 → 0.85
    double pretension_Tb_kN;         // per RCSC Table 8.1 ASTM F3125 A325 M20 = 142 kN, M24 = 205, M30=325
    int    slipPlaneCount_ns;
    int    boltCount_nb;
    double Tu_per_bolt_kN;           // applied tension per bolt for k_sc reduction
    double phi_for_holeType;         // 1.0 std, 0.85 OVS/SSLT
};

struct Result {
    double Du;                       // = 1.13
    double hf;
    double Ksc_reduction;
    double Rn_per_bolt_kN;
    double Rn_total_kN;
    double phiRn_total_kN;
};

Result analyse(const Input& in);

}  // namespace forge::sccrit
