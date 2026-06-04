// Forge-302 — Steel beam / plate girder web shear (AISC 360-22 §G2).
//
// Governs the shear strength of every rolled and welded I-shape and is the
// distinguishing calc for plate-girder web design. The §G2 nominal shear:
//
//     V_n = 0.6 · F_y · A_w · C_v1                              (Eq. G2-1)
//   A_w = d · t_w (overall depth × web thickness)
//
//   k_v = 5.34                                       (unstiffened, a/h > 3)
//       = 5 + 5 / (a/h)²                              (transverse stiffeners)
//
//   Three regions for C_v1 with the slenderness h/t_w:
//   (i)   h/t_w ≤ 2.24·√(E/F_y)    →  C_v1 = 1.0    (yielding)
//   (ii)  ≤ 1.10·√(k_v·E/F_y)      →  C_v1 = 1.0    (compact web)
//   (iii) ≤ 1.37·√(k_v·E/F_y)      →  C_v1 = 1.10·√(k_v·E/F_y) / (h/t_w)
//                                                    (inelastic buckling)
//   (iv)  >  1.37·√(k_v·E/F_y)     →  C_v1 = 1.51·k_v·E / ((h/t_w)² · F_y)
//                                                    (elastic buckling)
//
// LRFD φ = 0.9, ASD Ω = 1.67 (both per §G1 for plate-girder webs; the
// special §G2.1(a) case φ=1.0, Ω=1.50 for rolled I-shapes with
// h/t_w ≤ 2.24·√(E/F_y) is exposed via the `compactRolled` flag — the
// caller selects whether to enjoy the rolled-section bonus).

#pragma once

namespace forge::webshear {

struct Input {
    double overallDepthMm;      // d
    double webThicknessMm;      // t_w
    double flangeThicknessMm;   // t_f (for h = d - 2·t_f)
    double Fy_MPa;              // yield
    double E_MPa;               // Young's modulus
    double stiffenerSpacingMm;  // a (0 → unstiffened, a/h>3)
    bool   compactRolled;       // true → §G2.1(a) rolled bonus eligible
};

struct Result {
    double clearWebDepthMm;          // h = d - 2·t_f
    double webSlenderness;           // h / t_w
    double limitCompact;             // 2.24·√(E/F_y)
    double limitInelastic;           // 1.10·√(k_v·E/F_y)
    double limitElastic;             // 1.37·√(k_v·E/F_y)
    double k_v;                      // selected k_v
    double C_v1;                     // shear coefficient
    int    regime;                   // 1 yielding | 2 inelastic | 3 elastic
    double nominalShearN;            // V_n = 0.6·F_y·A_w·C_v1
    double LRFDshearN;               // φ·V_n
    double ASDshearN;                // V_n / Ω
    double phi;                      // selected φ
    double omega;                    // selected Ω
};

Result analyse(const Input& in);

}  // namespace forge::webshear
