// Forge-271 — Cast-in headed anchor shear capacity (ACI 318-19 §17.7).
//
// Two failure modes covered (steel + concrete breakout perpendicular to free
// edge):
//
//   Steel (§17.7.1):
//       V_sa = 0.6 · A_se,V · f_uta
//       φ    = 0.65 (ductile)
//
//   Concrete breakout in shear perpendicular to free edge (§17.7.2, SI):
//       V_b  = 0.6 · (l_e/d_a)^0.2 · √d_a · λ_a · √f'_c · c_a1^1.5
//              with l_e ≤ 8·d_a
//       A_Vco = 4.5 · c_a1²
//       If h_a ≥ 1.5·c_a1:  A_Vc = A_Vco
//       Else:                 A_Vc = 2·(1.5·c_a1)·h_a
//       Edge factor (perpendicular edge):
//           ψ_ed,V = 1                              if c_a2 ≥ 1.5·c_a1
//                  = 0.7 + 0.3·c_a2/(1.5·c_a1)    otherwise
//       Thickness factor:
//           ψ_h,V  = max(1, √(1.5·c_a1 / h_a))
//       Cracking factor:
//           ψ_c,V  = 1.0 (cracked) / 1.4 (uncracked, no supplementary
//                   reinforcement) — ACI 17.7.2.7 simplification.
//       V_cb  = (A_Vc / A_Vco) · ψ_ed,V · ψ_c,V · ψ_h,V · V_b
//       φ     = 0.70 (Cond B)
//
// All inputs SI: stress MPa, dimensions mm, area mm², force N.

#pragma once

#include <string>

namespace forge::anchorshear {

struct Input {
    double effectiveShearAreaMm2;  // A_se,V
    double steelUltimateMPa;       // f_uta (raw; we cap at 1.9·f_ya, 860 MPa)
    double steelYieldMPa;          // f_ya
    double anchorDiameterMm;       // d_a
    double loadBearingLengthMm;    // l_e (caller responsibility, typically h_ef ≤ 8·d_a)
    double concreteStrengthMPa;    // f'_c
    double edgeDistanceCa1Mm;      // c_a1 (perpendicular to applied shear)
    double edgeDistanceCa2Mm;      // c_a2 (orthogonal — large ⇒ ψ_ed = 1)
    double memberThicknessHaMm;    // h_a
    double lambdaLightweight;      // λ_a
    bool   crackedConcrete;        // true → ψ_c,V = 1.0
};

struct Result {
    double cappedFutaMPa;
    double steelNominalN;           // V_sa
    double phiSteelN;
    double aVcoMm2;
    double aVcMm2;
    double psiEdV;
    double psiCV;
    double psiHV;
    double vBN;                     // V_b
    double breakoutNominalN;        // V_cb
    double phiBreakoutN;
    double phiGoverningN;
    std::string governingMode;      // "steel" | "breakout"
};

Result analyse(const Input& in);

}  // namespace forge::anchorshear
