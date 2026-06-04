// Forge-307 — Reinforced-concrete one-way shear (ACI 318-19 §22.5).
//
// Companion to Forge-238 RC beam flexure (§22.2): every flexural design
// pairs with a §22.5 shear check. Standard simplified §22.5.5 formulation
// for members without axial load:
//
//     V_c = 0.17 · λ · √f'_c · b · d                  (Eq. 22.5.5.1)
//     V_s = A_v · f_yt · d / s                        (Eq. 22.5.10.5.3)
//     V_n = V_c + V_s
//     V_n,max = V_c + 0.66 · √f'_c · b · d            (Eq. 22.5.1.2)
//
// LRFD φ = 0.75 for shear (§21.2.1).
// λ — lightweight concrete modification factor: 1.0 normal, 0.85 sand-LW,
//     0.75 all-LW (Table 19.2.4.2(a)).
//
// Stirrup spacing limits (§9.7.6.2.2):
//   When V_s ≤ 0.33·√f'_c·b·d :  s_max = min(d/2, 600 mm)
//   When V_s >  0.33·√f'_c·b·d :  s_max = min(d/4, 300 mm)
//
// `crushingControls` is true if the section is at the §22.5.1.2 crushing
// limit V_n ≈ V_n,max — caller must enlarge the section, since adding
// more steel won't help past that limit.

#pragma once

namespace forge::rcshear {

struct Input {
    double widthMm;             // b
    double effectiveDepthMm;    // d
    double fc_MPa;              // f'_c
    double shearReinfAreaMm2;   // A_v (area of vertical legs at one cross-section)
    double stirrupSpacingMm;    // s
    double fyt_MPa;             // f_yt (Grade 60 = 420 typ.)
    double lambda;              // λ
};

struct Result {
    double Vc_kN;
    double Vs_kN;
    double Vn_kN;
    double VnMax_kN;
    double phi;                       // 0.75
    double phiVn_kN;
    double maxStirrupSpacingMm;
    bool   spacingMeetsLimit;
    bool   crushingControls;
};

Result analyse(const Input& in);

}  // namespace forge::rcshear
