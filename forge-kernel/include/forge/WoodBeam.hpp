// Forge-272 — Wood beam bending capacity (NDS 2018 §3.3 + §4.3 ASD).
//
// Reference design value F_b is adjusted by the cumulative product of
// applicable factors:
//
//   F'_b = F_b · C_D · C_M · C_t · C_L · C_F · C_fu · C_i · C_r
//
// where (all default to 1.0 if not applicable):
//   C_D  load-duration factor       (Normal 1.0, Snow 1.15, Wind/Earthquake 1.6)
//   C_M  wet-service factor          (1.0 dry; 0.85 for F_b in some species)
//   C_t  temperature factor          (1.0 typical)
//   C_L  beam stability factor       (§3.3.3, computed below)
//   C_F  size factor                 (§4.3.6 dimension lumber tables)
//   C_fu flat-use factor             (1.0 unless beam loaded on weak axis)
//   C_i  incising factor             (1.0 unincised; 0.8 incised)
//   C_r  repetitive-member factor    (1.15 for joists at ≤24" o.c.)
//
// Beam stability factor C_L (§3.3.3):
//   Slenderness: R_B = √(l_e · d / b²)
//   F_bE = 1.20 · E'_min / R_B²
//   F*_b = reference adjusted by all factors except C_L
//   Let α = F_bE / F*_b
//   C_L = (1 + α)/1.9 − √((1 + α)²/1.9² − α/0.95)
//
// Section modulus (rectangular section bent about strong axis):
//   S_x = b · d² / 6
//   M_allow = F'_b · S_x
//
// All inputs SI. Stresses MPa, dimensions mm. Output M_allow N·mm.

#pragma once

namespace forge::woodbeam {

struct Input {
    double referenceFbMPa;          // F_b (tabulated)
    double emin_MPa;                // E'_min (for beam stability)
    double widthMm;                 // b
    double depthMm;                 // d
    double effectiveLengthMm;       // l_e (NDS Table 3.3.3)
    double cD;                      // load duration factor
    double cM;                      // wet service
    double cT;                      // temperature
    double cF;                      // size factor
    double cFu;                     // flat use
    double cI;                      // incising
    double cR;                      // repetitive member
};

struct Result {
    double sectionModulusMm3;       // S_x = b·d²/6
    double fbStarMPa;               // F*_b (all adjustments except C_L)
    double slendernessRb;           // R_B
    double fbEMPa;                  // F_bE
    double alphaRatio;              // α = F_bE / F*_b
    double cL;                      // C_L beam stability factor
    double fbPrimeMPa;              // F'_b = F*_b · C_L
    double mAllowNmm;               // F'_b · S_x
};

Result analyse(const Input& in);

}  // namespace forge::woodbeam
