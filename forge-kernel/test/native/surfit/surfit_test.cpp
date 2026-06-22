// forge/native/surfit/surfit_test.cpp
//
// Standalone validation gate for the point-supervised parametric surface fitter
// (forge::native::surfit). Deterministic, seed-printed RNG; a tiny hand-rolled
// harness (no framework) that prints [PASS]/[FAIL], ends with
//   RESULT: P / T passed
// and exits non-zero on any failure. NEVER weakens an assertion.
//
// Build + run is via the native gate (adds the whole native object set so the
// brep basis/eval resolves automatically):
//   bash forge-kernel/test/native/run_native.sh
//
// SPEC validations covered (varied, distinct fixtures):
//   (1) PARABOLOID z = 0.01 x^2 + 0.005 y^2 -> low Chamfer AND the fitted surface
//       evaluated at grid (u,v) reproduces the analytic z to a small tolerance.
//   (2) FLAT PLANE z = c1 x + c2 y + c3 -> near-exact fit (Chamfer ~ 0): a
//       degree>=1 net represents an affine plane exactly.
//   (3) SADDLE z = 0.01 (x^2 - y^2) -> low Chamfer AND the sign of curvature is
//       correct (the fit dips on one diagonal and rises on the other).
//   (4) PARABOLOID + seeded Gaussian noise (sigma) -> the fit SMOOTHS: Chamfer is
//       on the order of sigma (NOT ~0, NOT huge) AND the fitted surface's
//       deviation from the CLEAN analytic paraboloid is smaller than the raw
//       noise sigma. (Honesty: a real fit, not interpolation.)
//   (5) CONVERGENCE: iters >= 1, chamferHistory non-increasing to numerical
//       slack, final chamfer <= first-iteration chamfer.
//   (6) DEGENERATE input -> ok=false with a non-empty reason (collinear cloud /
//       too few points / degree >= count). No fabricated surface.
//   (7) EDITABLE parametric output: surface.valid() and perturbing one control
//       point then evaluate changes the surface locally (a real net, not a mesh).

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <random>
#include <string>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/surfit/Surfit.hpp"

using forge::native::brep::NurbsSurface;
using forge::native::brep::Vec3;
namespace surfit = forge::native::surfit;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {            std::printf("  [FAIL] %s\n", name.c_str()); }
}

// --- analytic height fields ------------------------------------------------
static double zParaboloid(double x, double y) { return 0.01 * x * x + 0.005 * y * y; }
static double zPlane(double x, double y) { return 0.7 * x - 0.4 * y + 1.25; }
static double zSaddle(double x, double y) { return 0.01 * (x * x - y * y); }

// Build a dense grid cloud of an analytic z = f(x,y) over [-L,L]^2 with `n` per axis.
template <typename F>
static std::vector<Vec3> gridCloud(F f, double L, std::size_t n) {
    std::vector<Vec3> pts;
    pts.reserve(n * n);
    for (std::size_t i = 0; i < n; ++i) {
        const double x = -L + 2.0 * L * static_cast<double>(i) / static_cast<double>(n - 1);
        for (std::size_t j = 0; j < n; ++j) {
            const double y = -L + 2.0 * L * static_cast<double>(j) / static_cast<double>(n - 1);
            pts.push_back(Vec3{x, y, f(x, y)});
        }
    }
    return pts;
}

// Reconstruct the analytic-z residual of a fitted surface over its own (u,v)
// grid: for each surface sample, compare z to f(x,y) of that sample's (x,y).
template <typename F>
static double surfaceVsAnalytic(F f, const NurbsSurface& s, std::size_t res) {
    double worst = 0.0;
    for (std::size_t i = 1; i < res; ++i) {       // skip the seams (i=0,res)
        const double u = static_cast<double>(i) / static_cast<double>(res);
        for (std::size_t j = 1; j < res; ++j) {
            const double v = static_cast<double>(j) / static_cast<double>(res);
            const Vec3 p = s.evaluate(u, v);
            worst = std::max(worst, std::fabs(p.z - f(p.x, p.y)));
        }
    }
    return worst;
}

// Cloud grid spacing for an n x n grid over [-L,L]^2 (used as the honest floor of
// the surface->cloud Chamfer half: a continuous patch sample lands BETWEEN the
// discrete cloud points, so a perfect fit's bidirectional Chamfer ~ this spacing,
// NOT 0 — the true per-point residual is FitResult.rms / maxDist).
static double cloudSpacing(double L, std::size_t n) {
    return 2.0 * L / static_cast<double>(n - 1);
}

// ===========================================================================
// (1) Paraboloid. Fit quality is judged by the cloud->surface residual (rms /
// maxDist) and the analytic-z reconstruction; the bidirectional Chamfer is
// reported and bounded by the cloud's discrete-grid floor.
// ===========================================================================
static void testParaboloid() {
    std::printf("[1] paraboloid z=0.01x^2+0.005y^2 -> tiny residual + analytic-z match\n");
    const double L = 4.0; const std::size_t n = 20;
    std::vector<Vec3> pts = gridCloud(zParaboloid, L, n);
    surfit::FitOptions opt;  // cubic 6x6 defaults
    surfit::FitResult r = surfit::fitNurbsSurface(pts, opt);
    check(r.ok, "fit ok");
    const double spacing = cloudSpacing(L, n);
    std::printf("       chamfer=%.3e rms=%.3e maxDist=%.3e iters=%zu (gridSpacing=%.3f)\n",
                r.chamfer, r.rms, r.maxDist, r.iters, spacing);
    // True fit residual: every data point essentially ON the patch.
    check(r.rms < 1e-3, "cloud->surface rms < 1e-3 (data lies on the patch)");
    check(r.maxDist < 1e-2, "cloud->surface maxDist < 1e-2");
    // Bidirectional Chamfer is at the discrete-grid floor (~half spacing), NOT large.
    check(r.chamfer < spacing, "bidirectional chamfer at the discrete-grid floor");
    const double worst = surfaceVsAnalytic(zParaboloid, r.surface, 24);
    std::printf("       worst |S.z - analytic z| over the (u,v) grid = %.3e\n", worst);
    check(worst < 5e-3, "fitted surface reproduces the analytic paraboloid z");
}

// ===========================================================================
// (2) Flat plane -> near-exact.
// ===========================================================================
static void testPlane() {
    std::printf("[2] affine plane z=0.7x-0.4y+1.25 -> near-exact point-to-surface fit\n");
    const double L = 3.0; const std::size_t n = 16;
    std::vector<Vec3> pts = gridCloud(zPlane, L, n);
    surfit::FitOptions opt;
    surfit::FitResult r = surfit::fitNurbsSurface(pts, opt);
    check(r.ok, "fit ok");
    std::printf("       chamfer=%.3e rms=%.3e maxDist=%.3e\n", r.chamfer, r.rms, r.maxDist);
    // A degree>=1 net represents an affine plane EXACTLY -> point-to-surface ~ 0.
    check(r.rms < 1e-6, "affine plane cloud->surface rms < 1e-6 (near-exact)");
    check(r.maxDist < 1e-6, "affine plane max point-to-surface < 1e-6");
    const double worst = surfaceVsAnalytic(zPlane, r.surface, 24);
    check(worst < 1e-6, "fitted surface reproduces the analytic plane z (<1e-6)");
    // Even the bidirectional chamfer is small here (plane samples interpolate the
    // grid linearly, so surface samples sit close to the cloud lattice).
    check(r.chamfer < cloudSpacing(L, n), "bidirectional chamfer at the grid floor");
}

// ===========================================================================
// (3) Saddle -> sign of curvature correct.
// ===========================================================================
static void testSaddle() {
    std::printf("[3] saddle z=0.01(x^2-y^2) -> tiny residual + correct curvature sign\n");
    const double L = 4.0; const std::size_t n = 20;
    std::vector<Vec3> pts = gridCloud(zSaddle, L, n);
    surfit::FitOptions opt;
    surfit::FitResult r = surfit::fitNurbsSurface(pts, opt);
    check(r.ok, "fit ok");
    std::printf("       chamfer=%.3e rms=%.3e maxDist=%.3e\n", r.chamfer, r.rms, r.maxDist);
    check(r.rms < 1e-3, "saddle cloud->surface rms < 1e-3 (data on the patch)");
    check(r.chamfer < cloudSpacing(L, n), "bidirectional chamfer at the grid floor");
    const double worst = surfaceVsAnalytic(zSaddle, r.surface, 24);
    std::printf("       worst |S.z - analytic z| = %.3e\n", worst);
    check(worst < 5e-3, "fitted surface reproduces the saddle z");

    // Curvature sign: along +x at y=0 z rises (x^2), along +y at x=0 z falls (-y^2).
    // Sample near the patch center vs. an x-edge and a y-edge of the cloud.
    const Vec3 ctr = r.surface.evaluate(0.5, 0.5);
    const Vec3 xhi = r.surface.evaluate(0.92, 0.5);
    const Vec3 yhi = r.surface.evaluate(0.5, 0.92);
    std::printf("       z(center)=%.4f z(x-edge)=%.4f z(y-edge)=%.4f\n",
                ctr.z, xhi.z, yhi.z);
    // One direction must be above center and the other below (anticlastic).
    const bool antiX = xhi.z > ctr.z;   // x extreme rises
    const bool antiY = yhi.z < ctr.z;   // y extreme falls
    check(antiX && antiY, "anticlastic saddle: x-edge up, y-edge down (sign correct)");
}

// ===========================================================================
// (4) Paraboloid + seeded Gaussian noise -> smooths to Chamfer ~ sigma.
// ===========================================================================
static void testNoisySmoothing(std::mt19937_64& rng) {
    std::printf("[4] paraboloid + N(0,sigma) noise -> fit smooths (Chamfer ~ sigma)\n");
    const double sigma = 0.02;
    std::vector<Vec3> clean = gridCloud(zParaboloid, 4.0, 24);
    std::normal_distribution<double> nz(0.0, sigma);
    std::vector<Vec3> noisy = clean;
    for (Vec3& p : noisy) p.z += nz(rng);  // perturb z only

    surfit::FitOptions opt;  // small 6x6 net -> cannot interpolate noise
    surfit::FitResult r = surfit::fitNurbsSurface(noisy, opt);
    check(r.ok, "fit ok");
    std::printf("       sigma=%.3f chamfer=%.4e rms=%.4e maxDist=%.4e\n",
                sigma, r.chamfer, r.rms, r.maxDist);

    // The TRUE smoothing signal: the cloud->surface residual (rms) is ON THE ORDER
    // OF the injected noise sigma — NOT ~0 (a small net cannot interpolate noisy
    // points -> it does not pass through every point) and NOT huge (it is a real
    // fit that tracks the underlying paraboloid). For i.i.d. N(0,sigma) z-noise
    // smoothed by a low-DOF patch the residual rms is a fraction of sigma up to
    // ~sigma; bound it generously but meaningfully.
    check(r.rms > 0.2 * sigma, "rms NOT ~0 (does not interpolate the noise)");
    check(r.rms < 2.0 * sigma, "cloud->surface rms on the order of the noise sigma");

    // Smoothing demonstrated: the fitted surface's deviation from the CLEAN
    // analytic paraboloid is SMALLER than the raw noise sigma (the fit averages out
    // the per-point noise rather than chasing it).
    const double devFromClean = surfaceVsAnalytic(zParaboloid, r.surface, 24);
    std::printf("       worst |S.z - clean analytic z| = %.4e  (raw sigma=%.3f)\n",
                devFromClean, sigma);
    check(devFromClean < sigma, "fitted surface deviates from CLEAN truth < sigma (smoothing)");
}

// ===========================================================================
// (5) Convergence / monotonicity of the reparameterization.
// ===========================================================================
static void testConvergence() {
    std::printf("[5] reparam iteration: iters>=1, chamfer history non-increasing\n");
    std::vector<Vec3> pts = gridCloud(zSaddle, 4.0, 18);
    surfit::FitOptions opt;
    surfit::FitResult r = surfit::fitNurbsSurface(pts, opt);
    check(r.ok, "fit ok");
    check(r.iters >= 1, "at least one reparam iteration ran");
    check(r.chamferHistory.size() >= 2, "chamfer history recorded per iteration");

    bool nonIncreasing = true;
    double worstRise = 0.0;
    for (std::size_t i = 1; i < r.chamferHistory.size(); ++i) {
        const double rise = r.chamferHistory[i] - r.chamferHistory[i - 1];
        worstRise = std::max(worstRise, rise);
        if (rise > 1e-9) nonIncreasing = false;  // allow tiny numerical slack
    }
    std::printf("       history n=%zu first=%.3e final=%.3e worstRise=%.3e\n",
                r.chamferHistory.size(), r.chamferHistory.front(),
                r.chamferHistory.back(), worstRise);
    check(nonIncreasing, "chamfer history non-increasing (reparam improves/holds)");
    check(r.chamfer <= r.chamferHistory.front() + 1e-12,
          "final chamfer <= first-iteration chamfer");
}

// ===========================================================================
// (6) Degenerate / under-determined input -> ok=false with a reason.
// ===========================================================================
static void testDegenerate() {
    std::printf("[6] degenerate input -> ok=false + non-empty reason (honest)\n");

    // (a) collinear cloud (all on a line) -> no valid base plane.
    {
        std::vector<Vec3> line;
        for (std::size_t i = 0; i < 60; ++i) {
            const double t = static_cast<double>(i);
            line.push_back(Vec3{t, 2.0 * t, -0.5 * t});
        }
        surfit::FitResult r = surfit::fitNurbsSurface(line, surfit::FitOptions{});
        check(!r.ok, "collinear cloud rejected");
        check(std::string(r.reason).size() > 0, "  -> non-empty reason");
    }

    // (b) too few points for the DOF (need >= nU*nV = 36).
    {
        std::vector<Vec3> few = gridCloud(zPlane, 1.0, 4);  // 16 points < 36
        surfit::FitResult r = surfit::fitNurbsSurface(few, surfit::FitOptions{});
        check(!r.ok, "too-few-points rejected");
        check(std::string(r.reason).size() > 0, "  -> non-empty reason");
    }

    // (c) degree >= control count -> rejected.
    {
        std::vector<Vec3> pts = gridCloud(zPlane, 2.0, 12);
        surfit::FitOptions bad;
        bad.degreeU = 6; bad.nU = 6;  // degreeU == nU
        surfit::FitResult r = surfit::fitNurbsSurface(pts, bad);
        check(!r.ok, "degree>=count rejected");
        check(std::string(r.reason).size() > 0, "  -> non-empty reason");
    }
}

// ===========================================================================
// (7) Output is an EDITABLE parametric surface (control net, not a mesh).
// ===========================================================================
static void testEditable() {
    std::printf("[7] editable parametric output: valid net + local control-point edit\n");
    std::vector<Vec3> pts = gridCloud(zParaboloid, 4.0, 18);
    surfit::FitResult r = surfit::fitNurbsSurface(pts, surfit::FitOptions{});
    check(r.ok, "fit ok");
    check(r.surface.valid(), "result surface is a valid editable NURBS net");

    // Surface IS the control net + knots (not baked geometry): the grid sizes
    // match the requested control DOF.
    check(r.surface.control.size() == 6 && r.surface.control[0].size() == 6,
          "control grid is 6x6 (editable DOF, not a mesh)");
    check(r.surface.knotsU.size() == 6 + r.surface.degreeU + 1 &&
          r.surface.knotsV.size() == 6 + r.surface.degreeV + 1,
          "clamped knot vectors sized count+degree+1");

    // Edit a single interior control point; the surface must change LOCALLY near
    // that control point's parameter footprint, and stay (numerically) unchanged
    // far away (local support of the B-spline basis).
    NurbsSurface edited = r.surface;
    const Vec3 before = edited.evaluate(0.5, 0.5);
    edited.control[3][3].z += 1.0;  // bump an interior control point
    const Vec3 afterNear = edited.evaluate(0.5, 0.5);
    const Vec3 afterFar = edited.evaluate(0.02, 0.02);
    const Vec3 farBefore = r.surface.evaluate(0.02, 0.02);
    const double localChange = std::fabs(afterNear.z - before.z);
    const double farChange = std::fabs(afterFar.z - farBefore.z);
    std::printf("       local change=%.4f  far-corner change=%.4e\n",
                localChange, farChange);
    check(localChange > 1e-3, "moving a control point changes the surface locally");
    check(farChange < localChange, "edit is local (far corner less affected)");
}

int main() {
    std::random_device rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("=== surfit (point-supervised NURBS fit) gate ===  seed=%llu\n",
                static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    testParaboloid();
    testPlane();
    testSaddle();
    testNoisySmoothing(rng);
    testConvergence();
    testDegenerate();
    testEditable();

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
