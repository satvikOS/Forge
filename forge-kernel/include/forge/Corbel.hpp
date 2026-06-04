// Forge-335a — Reinforced-concrete corbel / bracket (ACI 318-19 §16.5).
//   Shear-friction:  V_n = μ · A_vf · f_y           normal-weight: μ = 1.4 monolithic, 1.0 cold-joint
//   Direct tension:  N_uc ≥ 0.20·V_u (assumed restraint)
//   Primary reinforcement A_f from moment M_u = V_u·a + N_uc·(h − d):
//     A_f = M_u / (φ · f_y · j·d)         j ≈ 0.875
//   A_n = N_uc / (φ · f_y)
//   A_s primary = max(A_f + A_n, (2/3)·A_vf + A_n, 0.04·f'_c/f_y · b·d)
//   Closed stirrups A_h ≥ 0.5·(A_s − A_n).

#pragma once

namespace forge::corbel {

struct Input {
    double Vu_kN;                 // factored vertical
    double Nuc_kN;                // factored horizontal tension (≥ 0.2 V_u)
    double a_mm;                  // shear span (load to face)
    double bw_mm;                 // beam width at corbel
    double d_mm;                  // effective depth at face
    double h_mm;                  // total depth at face
    double fc_MPa;                // f'_c
    double fy_MPa;                // f_y
    double frictionMu;            // μ shear-friction
    double phi;                   // strength reduction factor (0.75 §16.5.3)
};

struct Result {
    double Vn_max_kN;             // 0.20·f'_c·b·d cap
    double Avf_required_mm2;
    double As_primary_mm2;        // governing
    double Ah_stirrups_mm2;
    double momentArm_jd_mm;
    bool   shearOK;               // V_u ≤ φ·V_n_max
};

Result analyse(const Input& in);

}  // namespace forge::corbel
