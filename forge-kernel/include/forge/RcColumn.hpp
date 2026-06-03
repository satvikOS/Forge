// Forge-257 — Reinforced concrete column (ACI 318-19 §22.4).
//
// Pure compression nominal:
//   P_no = 0.85·f'_c·(A_g − A_st) + f_y·A_st
//
// Max design axial (ACI 22.4.2.1):
//   tied:   φPn_max = 0.80·φ·P_no    φ = 0.65
//   spiral: φPn_max = 0.85·φ·P_no    φ = 0.75
//
// Balanced point (Gr 60: ε_t = ε_y = 0.002 at extreme tension steel):
//   Strain on extreme compression fibre = 0.003.
//   c_b = (0.003 / (0.003 + 0.002)) · d = 0.6·d
//   a_b = β_1·c_b
//   C_c = 0.85·f'_c·b·a_b
//   Approximate as singly-reinforced (yield in both compression and
//   tension steel). T = A_s·f_y; C_s = A_s'·(f_y − 0.85·f'_c) if
//   compression steel yields.
//   P_nb = C_c + C_s − T
//   M_nb = C_c·(h/2 − a_b/2) + C_s·(h/2 − d') + T·(d − h/2)
//
// We treat a symmetric section (A_s = A_s', d' on compression side).
// Returns: P_no, φPn_max, P_nb, M_nb, and the φ-reduced design pair.

#pragma once

namespace forge::rccolumn {

enum class TieType { Tied, Spiral };

struct Input {
    TieType tieType;
    double grossAreaM2;          // A_g
    double effectiveDepthM;      // d
    double overallDepthM;        // h
    double widthM;               // b
    double coverM;               // d' (centroid of compression steel from face)
    double steelAreaTotalM2;     // A_st
    double concreteFcPa;         // f'_c
    double steelFyPa;             // f_y
};

struct Result {
    double phi;
    double maxFactor;            // 0.80 or 0.85
    double nominalAxialN;        // P_no
    double designMaxAxialN;      // φPn,max
    double balancedAxialN;       // P_nb
    double balancedMomentNm;     // M_nb
    double designBalancedAxialN; // φP_nb
    double designBalancedMomentNm; // φM_nb
    double beta1;
};

Result analyse(const Input& in);

}  // namespace forge::rccolumn
