// Forge-332c — Welded fillet group, elastic-vector method (Salmon-Johnson Ch 6).
//   Centroid: (x̄, ȳ) of weld linear segments.
//   I_x = Σ L_i·(y_i − ȳ)²,   I_y = Σ L_i·(x_i − x̄)²,   J = I_x + I_y
//   Direct shear:  f_v = P/L_total   along load direction
//   Torsional shear:  f_t = T·r/J     T = P · e (eccentricity from centroid)
//   Resultant per linear inch: f_max = √( (f_v + f_tx)² + f_ty² )
//   Allowable per linear mm: F_w = 0.6·F_EXX·sin(45°)·effective leg
//   Returns max shear / weld throat MPa.

#pragma once

#include <vector>

namespace forge::weldgroup {

struct WeldSegment {
    double x0_mm, y0_mm, x1_mm, y1_mm;
};

struct Input {
    std::vector<WeldSegment> segments;
    double loadP_kN;
    double eccentricity_mm;    // e — to centroid
    double legSize_mm;         // weld leg w
    double electrodeFu_MPa;    // F_EXX (typ 480 / 550)
};

struct Result {
    double centroidX_mm, centroidY_mm;
    double totalLength_mm;
    double polarSecondMoment_mm3;    // J/throat (treated as line)
    double maxStress_MPa;            // throat stress at critical point
    double allowableStress_MPa;      // 0.6·F_EXX
    double utilisation;
    bool   passes;
};

Result analyse(const Input& in);

}  // namespace forge::weldgroup
