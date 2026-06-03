// Forge-268 — Cast-in headed anchor bolt tension capacity (ACI 318-19 Ch.17).
//
// Three failure modes:
//
//   Steel:        N_sa = A_se,N · min(f_uta, 1.9·f_ya, 860 MPa)
//                 φ = 0.75 (ductile, ACI 17.5.2)
//
//   Concrete breakout (single anchor, CCD, SI form §17.6.2):
//                 N_b   = k_c · λ_a · √f'_c · h_ef^1.5     (k_c = 10 cast-in,
//                                                          7 post-installed)
//                 A_Nco = 9 · h_ef²
//                 If c_a,min ≥ 1.5·h_ef:    A_Nc  = A_Nco
//                                            ψ_ed = 1
//                 Else:                      A_Nc = (c_a,min + 1.5·h_ef)·(3·h_ef)
//                                            ψ_ed = 0.7 + 0.3·c_a,min/(1.5·h_ef)
//                 ψ_c,N = 1 (cracked) or 1.25 (uncracked, cast-in only)
//                 N_cb  = (A_Nc/A_Nco) · ψ_ed · ψ_c,N · N_b
//                 φ = 0.70 (Cond B, no supplementary reinforcement)
//
//   Pullout (headed, §17.6.3):
//                 N_p   = 8 · A_brg · f'_c
//                 N_pn  = ψ_c,P · N_p     (ψ_c,P = 1 cracked, 1.4 uncracked)
//                 φ = 0.70
//
// SI units throughout: stresses MPa, dimensions mm, area mm², force N.
//
// Governing design strength φN_n = min(φN_sa, φN_cb, φN_pn).

#pragma once

#include <string>

namespace forge::anchorbolt {

struct Input {
    double effectiveTensileAreaMm2;   // A_se,N
    double steelUltimateMPa;          // f_uta (already capped or raw — we cap)
    double steelYieldMPa;             // f_ya  (used for 1.9·f_ya cap)
    double embedmentDepthMm;          // h_ef
    double concreteStrengthMPa;       // f'_c
    double minEdgeDistanceMm;         // c_a,min
    double bearingAreaMm2;            // A_brg (head bearing for pullout)
    double lambdaLightweight;         // λ_a (1.0 normal weight)
    bool   crackedConcrete;           // true → ψ_c,N=1.0, ψ_c,P=1.0
                                      // false → ψ_c,N=1.25, ψ_c,P=1.4
    bool   castInAnchor;              // true → k_c=10, false → 7 (post-installed)
};

struct Result {
    double cappedFutaMPa;
    double steelNominalN;             // N_sa
    double phiSteelN;
    double aNcoMm2;
    double aNcMm2;
    double psiEdN;
    double psiCN;
    double nBN;                       // N_b
    double breakoutNominalN;          // N_cb
    double phiBreakoutN;
    double psiCP;
    double nPN;                       // N_p
    double pulloutNominalN;           // N_pn
    double phiPulloutN;
    double phiGoverningN;
    std::string governingMode;        // "steel" | "breakout" | "pullout"
};

Result analyse(const Input& in);

}  // namespace forge::anchorbolt
