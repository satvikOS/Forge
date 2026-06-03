// Forge-270 — Steel beam lateral-torsional buckling (AISC 360-22 §F2).
//
// Doubly symmetric I-shape (W-shape) bent about its major axis. Three regimes
// depending on the unbraced length L_b versus the limits L_p (plastic) and
// L_r (inelastic-elastic transition):
//
//   L_p = 1.76 · r_y · √(E/F_y)                                    (F2-5)
//   L_r = 1.95 · r_ts · (E / (0.7·F_y)) ·
//         √( J·c / (S_x·h_o) + √( (J·c/(S_x·h_o))² +
//                                  6.76·(0.7·F_y/E)² ) )           (F2-6)
//   M_p = F_y · Z_x                                                (F2-1)
//
//   Region (a) L_b ≤ L_p  — full plastic strength:
//       M_n = M_p
//   Region (b) L_p < L_b ≤ L_r  — inelastic LTB, linear interpolation:
//       M_n = C_b · ( M_p − (M_p − 0.7·F_y·S_x) · (L_b−L_p)/(L_r−L_p) )
//             clipped to ≤ M_p                                     (F2-2)
//   Region (c) L_b > L_r  — elastic LTB:
//       F_cr = (C_b·π²·E / (L_b/r_ts)²) ·
//              √( 1 + 0.078·(J·c/(S_x·h_o))·(L_b/r_ts)² )          (F2-4)
//       M_n  = F_cr · S_x   clipped to ≤ M_p                       (F2-3)
//
// For doubly symmetric I-shapes the warping coefficient ratio c = 1
// (AISC §F2 commentary). We expose c as a free input for channels (c uses
// the C_w expression). Units: F_y, E in MPa; lengths mm; areas mm²;
// J in mm⁴; S_x, Z_x in mm³. Output stresses MPa, moments N·mm.

#pragma once

#include <string>

namespace forge::steelbeam {

struct Input {
    double yieldMPa;            // F_y
    double elasticModulusMPa;   // E
    double sectionModulusXMm3;  // S_x  (elastic)
    double plasticModulusXMm3;  // Z_x  (plastic)
    double torsionConstantMm4;  // J
    double radiusYMm;           // r_y
    double radiusTsMm;          // r_ts (effective LTB radius)
    double distanceBetweenFlangeCentroidsMm; // h_o
    double warpingCoefficient;  // c — 1.0 for doubly symmetric I-shape
    double unbracedLengthMm;    // L_b
    double cb;                  // C_b (lateral-torsional buckling modifier)
};

struct Result {
    double mPlasticNmm;     // M_p
    double lpMm;            // L_p
    double lrMm;            // L_r
    double mNnominalNmm;    // M_n (governing nominal)
    double fCrMPa;          // F_cr (region c only; 0 elsewhere)
    double phiMnNmm;        // 0.9·M_n
    double mnOverOmegaNmm;  // M_n / 1.67
    std::string regime;     // "plastic" | "inelastic-LTB" | "elastic-LTB"
};

Result analyse(const Input& in);

}  // namespace forge::steelbeam
