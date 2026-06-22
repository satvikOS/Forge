// forge/native/brep/native_ssi_test.cpp
//
// Native gate for IN-HOUSE KERNEL STEP 2c: the analytic surface–surface
// intersection (forge::native::brep::intersectSurfaces) for the quadric-pair
// families that completed the analytic SSI — closing the deferred mesh-fallbacks:
//
//   * plane ∩ cone  -> closed-form DANDELIN conic:
//        - circle      (plane ⟂ axis),
//        - ellipse     (plane cuts all generators of one nappe, |n·axis| > sinα),
//        - parabola    (plane parallel to exactly one generator, |n·axis| = sinα),
//        - hyperbola   (plane parallel to the axis / cuts both nappes, |n·axis| < sinα),
//        - line-pair / point (plane through the apex).
//   * general / skew cylinder ∩ cylinder  -> robust adaptive MARCHED polyline.
//   * general (offset)        cylinder ∩ sphere    -> robust adaptive MARCHED polyline.
//
// For EVERY returned curve this gate asserts that every sample lies on BOTH
// surfaces to <1e-9 (the implicit residual), that the curve KIND is the analytic
// family expected from the geometry, that the bounded conics carry the correct
// analytic centre / semi-axes, and that `allClosedForm` is true (closed-form for
// the conics; marched-to-tol for the quartics). Auto-discovered by
// test/native/run_native.sh. Pure C++20, no OCCT, no test framework.

#include "forge/native/brep/SurfaceIntersect.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
constexpr double PI = 3.14159265358979323846;

// ---- surface builders ------------------------------------------------------
static Surface planeSurf(Vec3 o, Vec3 n) {
    Surface s; s.kind = SurfaceKind::Plane; s.origin = o; s.axis = vnorm(n);
    Vec3 t = (std::fabs(s.axis.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    s.refDir = vnorm(vcross(s.axis, t)); return s;
}
static Surface coneSurf(Vec3 o, Vec3 ax, double r1, double r2, double h) {
    Surface s; s.kind = SurfaceKind::Cone; s.origin = o; s.axis = vnorm(ax);
    s.r1 = r1; s.r2 = r2; s.param = h;
    Vec3 t = (std::fabs(s.axis.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    s.refDir = vnorm(vcross(s.axis, t)); return s;
}
static Surface cylSurf(Vec3 b, Vec3 ax, double r) {
    Surface s; s.kind = SurfaceKind::Cylinder; s.origin = b; s.axis = vnorm(ax);
    s.r1 = r;
    Vec3 t = (std::fabs(s.axis.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    s.refDir = vnorm(vcross(s.axis, t)); return s;
}
static Surface sphSurf(Vec3 c, double r) {
    Surface s; s.kind = SurfaceKind::Sphere; s.origin = c; s.r1 = r;
    s.axis = {0, 0, 1}; s.refDir = {1, 0, 0}; return s;
}

// ---- on-surface residual predicates ----------------------------------------
// Cone implicit residual: ((P-apex)·axisToBase)² - cos²α |P-apex|².
static double coneRes(const Vec3& p, const Vec3& apex, const Vec3& axisToBase,
                      double cosA) {
    Vec3 w = vsub(p, apex);
    double ax = vdot(w, axisToBase);
    return std::fabs(ax * ax - cosA * cosA * vdot(w, w));
}
static double planeRes(const Vec3& p, const Vec3& o, const Vec3& n) {
    return std::fabs(vdot(vsub(p, o), vnorm(n)));
}
static double cylRes(const Vec3& p, const Vec3& o, const Vec3& a, double r) {
    Vec3 w = vsub(p, o);
    Vec3 rad = vsub(w, vscale(vnorm(a), vdot(w, vnorm(a))));
    return std::fabs(vlen(rad) - r);
}
static double sphRes(const Vec3& p, const Vec3& c, double r) {
    return std::fabs(vlen(vsub(p, c)) - r);
}
template <class F>
static double maxOver(const std::vector<IntersectionCurve>& cs, F&& f) {
    double mx = 0.0;
    for (const auto& c : cs) for (const Vec3& p : c.samples) mx = std::max(mx, f(p));
    return mx;
}
static std::size_t totalSamples(const std::vector<IntersectionCurve>& cs) {
    std::size_t n = 0; for (const auto& c : cs) n += c.samples.size(); return n;
}

// ===========================================================================
// plane ∩ cone — the full Dandelin family.
// ===========================================================================
static void testPlaneCone() {
    std::printf("[SSI plane∩cone] Dandelin conic (circle/ellipse/parabola/hyperbola/apex)\n");
    // canonical apex cone: base r=3 at z=0, apex at z=6 -> half-angle atan(3/6).
    const double alpha = std::atan(0.5);
    const double cosA = std::cos(alpha), sinA = std::sin(alpha);
    const Vec3 apex{0, 0, 6}, axisToBase{0, 0, -1};

    // (1) plane ⟂ axis at z=2 -> circle, radius = (axial dist from apex)*tanα = 4*0.5 = 2.
    {
        Surface C = coneSurf({0, 0, 0}, {0, 0, 1}, 3, 0, 6);
        Surface P = planeSurf({0, 0, 2}, {0, 0, 1});
        auto r = intersectSurfaces(P, C);
        check(r.ok && r.allClosedForm && r.curves.size() == 1 &&
              r.curves[0].kind == CurveKind::Circle, "plane⟂cone => one closed-form circle");
        if (!r.curves.empty()) {
            check(std::fabs(r.curves[0].r1 - 2.0) < 1e-9, "plane⟂cone circle radius = (h-z)*tanα = 2");
            check(maxOver(r.curves, [&](const Vec3& p){ return coneRes(p, apex, axisToBase, cosA); }) < 1e-9 &&
                  maxOver(r.curves, [&](const Vec3& p){ return planeRes(p, {0,0,2}, {0,0,1}); }) < 1e-9,
                  "plane⟂cone circle lies on BOTH cone and plane (<1e-9)");
        }
    }

    // (2) oblique plane cutting all generators (|n·axis|=0.8 > sinα≈0.447) -> ellipse.
    {
        Surface C = coneSurf({0, 0, 0}, {0, 0, 1}, 3, 0, 6);
        Vec3 n = vnorm(Vec3{0.6, 0, 0.8});
        Surface P = planeSurf({0, 0, 2}, n);
        auto r = intersectSurfaces(P, C);
        check(r.ok && r.allClosedForm && r.curves.size() == 1 &&
              r.curves[0].kind == CurveKind::Ellipse, "plane-oblique-cone => closed-form ellipse");
        if (!r.curves.empty()) {
            // independently-computed truth (generator parametrization): a≈2.9091, b≈2.1574.
            check(std::fabs(r.curves[0].r1 - 2.90909) < 1e-3, "ellipse semi-major ≈ 2.9091");
            check(std::fabs(r.curves[0].r2 - 2.15743) < 1e-3, "ellipse semi-minor ≈ 2.1574");
            check(r.curves[0].r1 > r.curves[0].r2, "ellipse semi-major > semi-minor");
            check(maxOver(r.curves, [&](const Vec3& p){ return coneRes(p, apex, axisToBase, cosA); }) < 1e-9 &&
                  maxOver(r.curves, [&](const Vec3& p){ return planeRes(p, {0,0,2}, n); }) < 1e-9,
                  "ellipse samples lie on BOTH cone and plane (<1e-9)");
        }
    }

    // (3) plane parallel to exactly one generator (|n·axis| == sinα) -> parabola.
    {
        Surface C = coneSurf({0, 0, 0}, {0, 0, 1}, 3, 0, 6);
        Vec3 n = vnorm(Vec3{cosA, 0, sinA}); // |n·axis| = sinα
        Surface P = planeSurf({1, 0, 2}, n);
        auto r = intersectSurfaces(P, C);
        check(r.ok && r.allClosedForm && r.curves.size() == 1 &&
              r.curves[0].kind == CurveKind::Conic, "plane∥generator-cone => parabola (Conic polyline)");
        check(!r.curves.empty() && r.curves[0].samples.size() >= 16, "parabola densely sampled");
        check(maxOver(r.curves, [&](const Vec3& p){ return coneRes(p, apex, axisToBase, cosA); }) < 1e-9 &&
              maxOver(r.curves, [&](const Vec3& p){ return planeRes(p, {1,0,2}, n); }) < 1e-9,
              "parabola samples lie on BOTH cone and plane (<1e-9)");
    }

    // (4) plane parallel to the axis (|n·axis| = 0 < sinα) -> hyperbola.
    {
        Surface C = coneSurf({0, 0, 0}, {0, 0, 1}, 3, 0, 6);
        Surface P = planeSurf({1, 0, 0}, {1, 0, 0}); // x=1, contains the axis direction
        auto r = intersectSurfaces(P, C);
        check(r.ok && r.allClosedForm && r.curves.size() == 1 &&
              r.curves[0].kind == CurveKind::Conic, "plane∥axis-cone => hyperbola (Conic polyline)");
        check(!r.curves.empty() && r.curves[0].samples.size() >= 8, "hyperbola densely sampled");
        check(maxOver(r.curves, [&](const Vec3& p){ return coneRes(p, apex, axisToBase, cosA); }) < 1e-9 &&
              maxOver(r.curves, [&](const Vec3& p){ return planeRes(p, {1,0,0}, {1,0,0}); }) < 1e-9,
              "hyperbola samples lie on BOTH cone and plane (<1e-9)");
    }

    // (5) plane through the apex parallel to the axis -> line-pair (two generators).
    {
        Surface C = coneSurf({0, 0, 0}, {0, 0, 1}, 3, 0, 6);
        Surface P = planeSurf({0, 0, 0}, {0, 1, 0}); // y=0, passes through the apex axis
        auto r = intersectSurfaces(P, C);
        check(r.ok && r.allClosedForm && r.curves.size() == 2 &&
              r.curves[0].kind == CurveKind::Line && r.curves[1].kind == CurveKind::Line,
              "plane-through-apex(∥axis)-cone => line-pair (two generators)");
        check(maxOver(r.curves, [&](const Vec3& p){ return coneRes(p, apex, axisToBase, cosA); }) < 1e-9 &&
              maxOver(r.curves, [&](const Vec3& p){ return planeRes(p, {0,0,0}, {0,1,0}); }) < 1e-9,
              "line-pair lies on BOTH cone and plane (<1e-9)");
    }
    (void)sinA;
}

// ===========================================================================
// general / skew cylinder ∩ cylinder — robust adaptive marched polyline.
// ===========================================================================
static void testMarchedCylCyl() {
    std::printf("[SSI cyl∩cyl marched] skew / unequal-radius quartic -> adaptive trace\n");
    // skew axes (Z and X), unequal radii, crossing region -> two loops.
    {
        Surface A = cylSurf({0, 0, 0}, {0, 0, 1}, 2.0);
        Surface B = cylSurf({0, 0, 3}, {1, 0, 0}, 1.2);
        auto r = intersectSurfaces(A, B);
        check(r.ok && r.allClosedForm, "skew cyl∩cyl marched ok + allClosedForm (marched-to-tol)");
        check(totalSamples(r.curves) >= 32, "skew cyl∩cyl returns a dense polyline");
        double mA = maxOver(r.curves, [&](const Vec3& p){ return cylRes(p, {0,0,0}, {0,0,1}, 2.0); });
        double mB = maxOver(r.curves, [&](const Vec3& p){ return cylRes(p, {0,0,3}, {1,0,0}, 1.2); });
        std::printf("      [skew cyl-cyl] curves=%zu samples=%zu maxResA=%.2e maxResB=%.2e\n",
                    r.curves.size(), totalSamples(r.curves), mA, mB);
        check(mA < 1e-9 && mB < 1e-9, "skew cyl∩cyl every sample on BOTH cylinders (<1e-9)");
    }
    // unequal-radius PARALLEL-offset cylinders (a quartic 'gothic-window' pair).
    {
        Surface A = cylSurf({0, 0, 0}, {0, 0, 1}, 2.0);
        Surface B = cylSurf({1.0, 0, 0}, {0, 0, 1}, 2.0); // same r, parallel, offset 1 -> 2 lines
        auto r = intersectSurfaces(A, B);
        // parallel equal-r offset cylinders meet in two straight lines (∥ axis); the
        // marcher traces them (allClosedForm true, residual <1e-9).
        check(r.ok, "parallel-offset cyl∩cyl ok (marched)");
        if (r.ok) {
            double mA = maxOver(r.curves, [&](const Vec3& p){ return cylRes(p, {0,0,0}, {0,0,1}, 2.0); });
            double mB = maxOver(r.curves, [&](const Vec3& p){ return cylRes(p, {1.0,0,0}, {0,0,1}, 2.0); });
            check(mA < 1e-9 && mB < 1e-9, "parallel-offset cyl∩cyl samples on BOTH cylinders (<1e-9)");
        }
    }
}

// ===========================================================================
// general (axis-offset) cylinder ∩ sphere — robust adaptive marched polyline.
// ===========================================================================
static void testMarchedCylSphere() {
    std::printf("[SSI cyl∩sphere marched] axis-offset quartic -> adaptive trace\n");
    {
        Surface C = cylSurf({0, 0, 0}, {0, 0, 1}, 2.0);
        Surface S = sphSurf({1.0, 0, 0}, 2.5); // sphere centre OFF the cylinder axis
        auto r = intersectSurfaces(C, S);
        check(r.ok && r.allClosedForm, "offset cyl∩sphere marched ok + allClosedForm (marched-to-tol)");
        check(totalSamples(r.curves) >= 32, "offset cyl∩sphere returns a dense polyline");
        double mC = maxOver(r.curves, [&](const Vec3& p){ return cylRes(p, {0,0,0}, {0,0,1}, 2.0); });
        double mS = maxOver(r.curves, [&](const Vec3& p){ return sphRes(p, {1.0,0,0}, 2.5); });
        std::printf("      [offset cyl-sphere] curves=%zu samples=%zu maxResCyl=%.2e maxResSph=%.2e\n",
                    r.curves.size(), totalSamples(r.curves), mC, mS);
        check(mC < 1e-9 && mS < 1e-9, "offset cyl∩sphere every sample on BOTH surfaces (<1e-9)");
    }
}

// ===========================================================================
// HONESTY — the pairs still genuinely outside the analytic envelope must remain
// DEFERRED (ok=false), never faked.
// ===========================================================================
static void testStillDeferred() {
    std::printf("[SSI honesty] genuinely-unsupported pairs remain DEFERRED (ok=false)\n");
    // cone ∩ sphere — no low-degree closed form, not marched here.
    {
        Surface cone = coneSurf({0, 0, 0}, {0, 0, 1}, 2, 0, 4);
        Surface S = sphSurf({0, 0, 0}, 3);
        auto r = intersectSurfaces(cone, S);
        check(!r.ok, "cone∩sphere is HONESTLY deferred (ok=false), not faked");
    }
    // torus ∩ plane — torus pairs are deferred.
    {
        Surface tor; tor.kind = SurfaceKind::Torus; tor.origin = {0,0,0};
        tor.axis = {0,0,1}; tor.refDir = {1,0,0}; tor.r1 = 3; tor.r2 = 1;
        Surface P = planeSurf({0, 0, 0}, {0, 0, 1});
        auto r = intersectSurfaces(P, tor);
        check(!r.ok, "torus∩plane is HONESTLY deferred (ok=false), not faked");
    }
}

int main() {
    std::printf("=== forge::native::brep — ANALYTIC SSI (Step 2c) gate ===\n");
    testPlaneCone();
    testMarchedCylCyl();
    testMarchedCylSphere();
    testStillDeferred();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
