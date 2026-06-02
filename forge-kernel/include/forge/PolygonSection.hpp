#pragma once

// Forge-224 — polygon area + centroid + area moments.
//
// Shoelace area for an N-vertex polygon, with parallel-axis-shifted
// second moments about its centroid. Holes are supported by signed
// area: positive for the outer contour (CCW), negative for inner
// loops (CW).
//
//   A   = ½ Σ (x_i · y_{i+1} − x_{i+1} · y_i)
//   C_x = (1/6A) Σ (x_i + x_{i+1}) · cross_i
//   C_y = (1/6A) Σ (y_i + y_{i+1}) · cross_i
//
//   I_xx (about origin) = (1/12) Σ (y_i² + y_i y_{i+1} + y_{i+1}²) · cross_i
//   I_yy (about origin) = (1/12) Σ (x_i² + x_i x_{i+1} + x_{i+1}²) · cross_i
//   I_xy (about origin) = (1/24) Σ (x_i y_{i+1} + 2x_i y_i + 2x_{i+1} y_{i+1} + x_{i+1} y_i) · cross_i
//
//   I about centroid via parallel-axis: I_c = I_o − A · d²
//
// where cross_i = x_i · y_{i+1} − x_{i+1} · y_i.

#include <vector>

namespace forge { namespace polysec {

struct Vec2 { double x, y; };

struct Inputs {
    std::vector<Vec2>              outer;  // CCW, mandatory
    std::vector<std::vector<Vec2>> holes;  // CW, optional
};

struct Outputs {
    double area;
    Vec2   centroid;
    double IxxCentroid;
    double IyyCentroid;
    double IxyCentroid;
    double radiusOfGyrationX;     // √(I_xx / A) about centroid
    double radiusOfGyrationY;     // √(I_yy / A) about centroid
};

Outputs analyse(const Inputs& in);

}} // namespace forge::polysec
