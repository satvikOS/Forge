// forge/native/surfit/Surfit.hpp
//
// POINT-SUPERVISED PARAMETRIC SURFACE FITTING for the Forge native kernel
// (Task #41 — forge::native::surfit). Fits a single editable NURBS / B-spline
// surface patch to a 3D POINT CLOUD by alternating linear least-squares on the
// control points with a closest-point re-parameterization, and reports a
// bidirectional Chamfer distance as the fit-quality + stopping criterion.
//
// The research frontier (DreamCAD / NURBGen / point2cad) fits parametric
// surfaces to clouds; this is the CLASSIC, deterministic least-squares core of
// that frontier (NOT yet autodiff / image / differentiable refinement).
//
// ============================ HONESTY (Bible §0/§9) ========================
// What is REAL and VALIDATED here (see test/native/surfit/surfit_test.cpp):
//   * Parameterization of the cloud onto a base plane (centroid + 3x3 covariance
//     Jacobi eigensolve -> the two largest-eigenvalue eigenvectors span the
//     plane; the smallest is the normal), giving an initial (u,v) in [0,1]^2.
//   * Linear least-squares solve of the B-spline control net from the tensor-
//     product Cox-de Boor basis at the current (u,v): normal equations
//     (N^T N) c = N^T p solved independently for x,y,z via a self-contained SPD
//     Cholesky (Gaussian-pivoting fallback), with a tiny Tikhonov diagonal for
//     conditioning. The basis is REUSED from brep::findSpan / brep::basisFunctions
//     (zero duplication of the recurrence).
//   * Closest-point re-parameterization: a coarse parameter-grid seed refined by
//     a clamped Gauss-Newton footpoint step using brep::evaluateWithDerivatives.
//     Iterate refit <-> reparam until the Chamfer improvement falls below tol.
//   * A BIDIRECTIONAL Chamfer / point-to-surface metric (mean cloud->surface +
//     mean surface->cloud) used both as the stopping criterion and reported in
//     the result, alongside RMS and max point-to-surface residuals.
//   * The output is an EDITABLE parametric surface — the control net + both
//     clamped knot vectors + unit weights as a brep::NurbsSurface — NOT a mesh,
//     so it can be further edited (move a control point -> the surface changes
//     locally). On a noisy cloud the fit SMOOTHS: Chamfer ~ the noise level,
//     NOT 0 — that is correct, not a bug.
//
// What is explicitly TARGETED (NOT built here) — FOLLOW-UPS:
//   * No autodiff / image-supervised / differentiable refinement (the DreamCAD
//     image-loss path). This is the least-squares core only.
//   * No trimming and no multi-patch decomposition. This fits ONE NURBS patch
//     over a height-field-style base-plane parameterization. A cloud that is not
//     a single-valued patch over its base plane (closed / multi-branch / folded /
//     overlapping) needs trimming or a multi-patch split — those are follow-ups;
//     this version honestly reports a large residual on such a cloud rather than
//     fabricating a fit.
//   * Polynomial B-spline only (unit weights). Rational (true-NURBS) weight
//     fitting is a follow-up.
//   * No kernel/UI bridge (ForgeToolBridge) yet — that is a separate follow-up.
//
// Pure C++20, ZERO external dependencies (standard library + the existing forge
// native NURBS basis/eval headers only). No OCCT, no WASM, no third-party libs.
// Degenerate / under-determined input -> ok=false + a non-empty `reason`; never
// a stub or fabricated surface.
//
// CONVENTIONS: namespace forge::native::surfit. Control net is nU x nV; each
// clamped open-uniform knot vector is sized (count + degree + 1). Parameter
// domain is [0,1]^2.

#ifndef FORGE_NATIVE_SURFIT_SURFIT_HPP
#define FORGE_NATIVE_SURFIT_SURFIT_HPP

#include <cstddef>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"  // brep::Vec3, brep::NurbsSurface, findSpan, basisFunctions

namespace forge {
namespace native {
namespace surfit {

using brep::NurbsSurface;
using brep::Vec3;

// ---------------------------------------------------------------------------
// Fitting controls. Defaults are a cubic 6x6 net over [0,1]^2 — enough DOF for
// the smooth height-field patches the gate exercises, small enough to stay
// well-conditioned with the Tikhonov term.
// ---------------------------------------------------------------------------
struct FitOptions {
    std::size_t degreeU = 3, degreeV = 3;  // spline degree per direction (>= 1)
    std::size_t nU = 6, nV = 6;            // control-net size per direction (> degree)
    std::size_t maxIters = 20;            // reparam <-> refit iterations
    double tol = 1e-9;                    // stop when Chamfer improvement < tol
    double lambda = 1e-8;                 // Tikhonov on the diagonal of N^T N
};

// ---------------------------------------------------------------------------
// Fit result. `surface` is the editable control net + knots; the residual
// fields are reported HONESTLY (Chamfer is bidirectional; rms/maxDist are the
// cloud->surface point-to-surface residuals).
// ---------------------------------------------------------------------------
struct FitResult {
    bool ok = false;
    const char* reason = "";              // honest diagnostic on failure
    NurbsSurface surface;                 // EDITABLE control net + clamped knots
    double chamfer = 0.0;                 // bidirectional point<->surface (final)
    double rms = 0.0;                     // RMS cloud->surface
    double maxDist = 0.0;                 // max cloud->surface
    std::size_t iters = 0;                // reparam iterations actually run
    std::vector<double> chamferHistory;   // per-iteration chamfer (report)
};

// Main entry. Fits a single NURBS patch to `points`. Honest ok=false + reason
// on degenerate / under-determined input (too few points for the DOF, degree
// >= count, collinear / coincident cloud, non-finite coordinates).
FitResult fitNurbsSurface(const std::vector<Vec3>& points, const FitOptions& opt);

// Bidirectional Chamfer between a cloud and a fitted surface:
//   mean_p min_s |p - s|   +   mean_s min_p |s - p|
// The surface is sampled on a (sampleU+1) x (sampleV+1) parameter grid; the
// cloud->surface direction is refined with the footpoint Gauss-Newton step.
// HONESTY: the cloud is a finite DISCRETE set, so the surface->cloud half has an
// irreducible floor of ~half the cloud's sample spacing even for a PERFECT fit (a
// continuous surface sample lands between cloud points). The bidirectional
// Chamfer is therefore NOT driven to 0 by a perfect fit on a coarse-grid cloud;
// the true per-point fit residual is the cloud->surface direction (see
// FitResult.rms / FitResult.maxDist). Exposed for tests / re-reporting. Returns 0
// for an empty cloud or invalid surface (it is a diagnostic, not an evaluator).
double chamferDistance(const std::vector<Vec3>& points, const NurbsSurface& s,
                       std::size_t sampleU = 40, std::size_t sampleV = 40);

}  // namespace surfit
}  // namespace native
}  // namespace forge

#endif  // FORGE_NATIVE_SURFIT_SURFIT_HPP
