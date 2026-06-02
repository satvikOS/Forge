#pragma once

// Forge-194 — Reverse-engineering: cubic B-spline tensor-product surface
// fitting to a point cloud.
//
// Parameterises each (x, y, z) point against the cloud's XY bounding box,
// builds the basis matrix B (N × uCount·vCount) with Cox-de-Boor on open-
// uniform knots, solves the least-squares problem B·P = Z for the control-
// point Z grid, and reports per-point residuals.
//
// Open-uniform cubic knots:
//   uCount control points → knot count = uCount + 4
//   first 4 knots = 0, last 4 = 1, interior uCount − 4 knots evenly spaced
//
// `points` is interleaved (x, y, z) length 3·N. The fit only deforms the
// surface in Z — (x, y) come from the cloud's XY bounds. Use after this
// the user can extrude or trim as usual.

#include <cstdint>
#include <vector>

namespace forge { namespace nurbsfit {

struct FitInputs {
    std::vector<double> points;     // 3·N
    int    uCount;                  // ≥ 4
    int    vCount;                  // ≥ 4
};

struct FitResult {
    int    uCount;
    int    vCount;
    // Bounding box (x, y) of the input cloud — the (u, v) parameter range
    // 0..1 maps linearly across these bounds.
    double xMin, xMax, yMin, yMax;
    // Control-point Z grid, row-major (row = v index, col = u index),
    // length = uCount · vCount.
    std::vector<double> controlZ;
    // Residuals per input point (z_fit − z_input), length N.
    std::vector<double> residuals;
    double maxAbsResidual;
    double rmsResidual;
    int    samples;
};

FitResult fitSurface(const FitInputs& in);

}} // namespace forge::nurbsfit
