// Forge-338a — Composite floor slab on steel deck (ANSI/SDI C-1-2017 + AISC 360-22 §I).
//   Total compression  C = min(0.85·f'_c·b·t_s,  n_stud·Q_n,  A_s·F_y)
//   Effective slab depth a = C / (0.85·f'_c·b)
//   Φ_b · M_n  = 0.9 · C · (d + h_r + 0.5·t_s − 0.5·a)         d = depth from top of steel.
//   Transformed-section moment of inertia  I_tr = b·t_s³/(12·n) + I_steel + (Σ)
//     n = E_s / E_c (modular ratio, ≈ 10 for f'_c = 28 MPa).
//   Defl   δ = 5·w·L⁴ / (384·E·I_tr)            simply-supported uniform.

#pragma once

namespace forge::compslab {

struct Input {
    double slabConcreteStrength_fc_MPa;
    double slabThickness_mm;
    double ribHeight_hr_mm;
    double effectiveWidth_b_mm;
    double studCapacity_Qn_kN;
    int    studCount_perSpan;
    double steelArea_mm2;
    double steelDepth_mm;             // d_b (overall steel beam depth)
    double steelYield_Fy_MPa;
    double Es_GPa;
    double Ec_GPa;
    double span_m;
    double serviceLoad_w_kNm;
    double steelI_mm4;
};

struct Result {
    double C_compression_kN;
    double aDepth_mm;
    double phiMn_kNm;
    double Itransformed_mm4;
    double serviceDeflection_mm;
    bool   partialComposite;
};

Result analyse(const Input& in);

}  // namespace forge::compslab
