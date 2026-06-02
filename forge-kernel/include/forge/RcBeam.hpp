// Forge-238 — Reinforced concrete beam flexure (ACI 318-19 §22.2).
//
// Singly reinforced rectangular section, Whitney equivalent stress block.
//
//   β_1 (ACI Table 22.2.2.4.3):
//     f'_c ≤ 28 MPa  → 0.85
//     28 < f'_c ≤ 55 → 0.85 − 0.05·(f'_c − 28)/7   (linear)
//     f'_c > 55      → 0.65
//
//   Equilibrium (tension-controlled assumed for Mn):
//     C = 0.85·f'_c·b·a  =  T = A_s·f_y
//     a = A_s·f_y / (0.85·f'_c·b)
//     c = a / β_1
//     ε_t = 0.003·(d − c)/c
//
//   Strength reduction φ (ACI 21.2.2):
//     ε_t ≤ ε_ty (= f_y/E_s ≈ 0.002 for Gr60): φ = 0.65 (compression-controlled)
//     ε_t ≥ 0.005:                            φ = 0.90 (tension-controlled)
//     between:                                φ = 0.65 + 0.25·(ε_t − ε_ty)/(0.005 − ε_ty)
//
//   Nominal & design moment:
//     M_n = A_s·f_y·(d − a/2)
//     φM_n = φ·M_n
//
//   Reinforcement ratio limits (ACI §9.6.1.2 / §22.2):
//     ρ      = A_s/(b·d)
//     ρ_min  = max(1.4/f_y,   √f'_c / (4·f_y))      [f_y in MPa]
//     ρ_b    = 0.85·β_1·(f'_c/f_y)·(600/(600+f_y))  (balanced; using ε_cu=0.003,
//                                                    f_y in MPa → 600/(600+f_y))
//     ρ_max  = 0.75·ρ_b                              (legacy code limit; we
//                                                    surface this for guidance —
//                                                    ACI 318-19 governs via ε_t)

#pragma once

namespace forge::rcbeam {

struct Input {
    double widthM;          // b (m)
    double effectiveDepthM; // d (m)
    double steelAreaM2;     // A_s (m²)
    double concreteFcPa;    // f'_c (Pa)
    double steelFyPa;       // f_y (Pa)
    double steelEPa;        // E_s (Pa)  — typically 200 GPa
};

struct Result {
    double beta1;
    double stressBlockDepthM;       // a
    double neutralAxisDepthM;       // c
    double steelStrain;             // ε_t
    double phi;                     // φ
    double nominalMomentNm;         // M_n
    double designMomentNm;          // φM_n
    double rho;                     // ρ
    double rhoMin;
    double rhoBalanced;             // ρ_b
    double rhoMax;                  // 0.75·ρ_b (legacy guidance)
    bool tensionControlled;         // ε_t ≥ 0.005
    bool belowRhoMin;
    bool aboveRhoMax;
};

Result analyse(const Input& in);

}  // namespace forge::rcbeam
