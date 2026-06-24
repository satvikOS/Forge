// forge/native/brep/nurbs_algebra_test.cpp
//
// Standalone validation gate for the K1.1 NURBS ALGEBRA COMPLETION
// (NurbsAlgebra.hpp). Pure C++20, no test framework — a hand-rolled harness
// that prints PASS/FAIL and exits non-zero on any failure.
//
// Build + run (standalone — only the three NURBS TUs are needed):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/test/native/brep/nurbs_algebra_test.cpp \
//     -o /tmp/nurbs_algebra_test && /tmp/nurbs_algebra_test
//
// VALIDATION GATE (each op grounded against geometry-preservation or a
// closed-form reference):
//   (1) r-fold knot insertion: geometry preserved (<=1e-12), +r control pts.
//   (2) knot refinement (vector): geometry preserved (<=1e-12), +|X| ctrl pts.
//   (3) knot removal: removes inserted knots, geometry preserved (<=1e-10);
//       a non-removable knot is reported as removed=0 (no corruption).
//   (4) curve degree elevation: geometry preserved (<=1e-12), degree raised.
//   (5) surface knot insertion (U+V): geometry preserved (<=1e-12).
//   (6) surface degree elevation (U+V): geometry preserved (<=1e-12).
//   (7) isocurve extraction: isoCurveU(u)(t) == S(u,t); isoCurveV(v)(t)==S(t,v).
//   (8) surface curvature CLOSED FORM: sphere patch K=1/R^2, H=1/R, k1=k2=1/R;
//       cylinder K=0, principal {0,1/R}; plane K=H=0.
//   (9) curve projection: known on-curve point -> dist~0; off point on a circle
//       -> radial foot (closest point at distance |P|-R).
//  (10) surface projection: on-surface point -> dist~0; off point above a
//       sphere patch -> radial foot at distance |P|-R.

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsCalculus.hpp"
#include "forge/native/brep/NurbsAlgebra.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {            std::printf("  [FAIL] %s\n", name.c_str()); }
}
static bool approx(double a, double b, double tol) {
    return std::fabs(a - b) <= tol;
}
static double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
static double norm(const Vec3& a) { return std::sqrt(dot(a, a)); }
static Vec3 vscaleLocal(const Vec3& a, double s) {
    return Vec3{a.x * s, a.y * s, a.z * s};
}

// ---- fixtures --------------------------------------------------------------

// Degree-3 B-spline with an interior knot at 0.5 (polynomial).
static NurbsCurve bspline3() {
    NurbsCurve c;
    c.degree = 3;
    c.controlPoints = {{0, 0, 0}, {1, 2, 0}, {2, -1, 1}, {4, 1, 0}, {5, 0, 2}};
    c.weights = std::vector<double>(5, 1.0);
    c.knots = {0, 0, 0, 0, 0.5, 1, 1, 1, 1};
    return c;
}

// Rational quarter circle, R=1, center origin (1,0)->(0,1).
static NurbsCurve quarterCircle() {
    NurbsCurve c;
    c.degree = 2;
    c.controlPoints = {{1, 0, 0}, {1, 1, 0}, {0, 1, 0}};
    const double wc = std::sqrt(2.0) / 2.0;
    c.weights = {1.0, wc, 1.0};
    c.knots = {0, 0, 0, 1, 1, 1};
    return c;
}

// Bilinear flat patch on the z=0 plane, [0,2]x[0,3].
static NurbsSurface flatPatch() {
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    s.control = {{{0, 0, 0}, {0, 3, 0}}, {{2, 0, 0}, {2, 3, 0}}};
    s.weights = {{1, 1}, {1, 1}};
    s.knotsU = {0, 0, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    return s;
}

// Generic biquadratic NURBS surface (non-trivial weights) for preservation
// tests.
static NurbsSurface biquadPatch() {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 2;
    s.control = {
        {{0, 0, 0}, {0, 1, 1}, {0, 2, 0}},
        {{1, 0, 1}, {1, 1, 2}, {1, 2, 1}},
        {{2, 0, 0}, {2, 1, 1}, {2, 2, 0}},
    };
    s.weights = {{1, 0.8, 1}, {0.9, 1.2, 0.9}, {1, 0.8, 1}};
    s.knotsU = {0, 0, 0, 1, 1, 1};
    s.knotsV = {0, 0, 0, 1, 1, 1};
    return s;
}

// A full hemisphere octant as a rational biquadratic NURBS (one Bezier patch),
// radius R, centred at origin. Standard 9-control-point spherical-triangle net
// (Piegl & Tiller §7.5 / Cobb): corners at the 3 axis points, edge midpoints
// weighted 1/sqrt2, centre weighted 1/2. Covers the +x+y+z octant of the
// sphere |X|=R. Parameter (u,v) in [0,1]^2.
static NurbsSurface sphereOctant(double R) {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 2;
    const double a = R;
    const double w = std::sqrt(2.0) / 2.0;     // 1/sqrt2
    // Net: this is the well-known one-patch octant. Control net (unweighted
    // Euclidean points) with the matching weight grid below evaluates to the
    // exact sphere of radius R over [0,1]^2.
    //   row i (u), col j (v).
    s.control = {
        {{a, 0, 0},  {a, 0, a},   {0, 0, a}},
        {{a, a, 0},  {a, a, a},   {0, 0, a}},
        {{0, a, 0},  {0, a, a},   {0, 0, a}},
    };
    s.weights = {
        {1.0, w,   1.0},
        {w,   0.5, w  },
        {1.0, w,   1.0},
    };
    s.knotsU = {0, 0, 0, 1, 1, 1};
    s.knotsV = {0, 0, 0, 1, 1, 1};
    return s;
}

// Cylindrical patch radius R: a rational quarter-circle arc (in U) extruded a
// height H along +z (in V, linear). Gaussian curvature 0; principal {0, 1/R}.
static NurbsSurface cylinderQuarter(double R, double H) {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 1;
    const double w = std::sqrt(2.0) / 2.0;
    // U = quarter circle arc (R), V = extrude along z by H.
    s.control = {
        {{R, 0, 0}, {R, 0, H}},
        {{R, R, 0}, {R, R, H}},
        {{0, R, 0}, {0, R, H}},
    };
    s.weights = {{1, 1}, {w, w}, {1, 1}};
    s.knotsU = {0, 0, 0, 1, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    return s;
}

// ===========================================================================
// (1) r-fold knot insertion: geometry preserved, +r control points.
// ===========================================================================
static void testKnotInsertR() {
    std::printf("[1] r-fold knot insertion (A5.1): geometry preserved, +r cps\n");
    auto run = [&](NurbsCurve c, double u, std::size_t r, const char* label) {
        std::size_t before = c.controlPoints.size();
        NurbsCurve c2 = insertKnotR(c, u, r);
        std::size_t mult = 0; for (double k : c.knots) if (k == u) ++mult;
        std::size_t rr = std::min(r, c.degree - mult);
        bool cntOk = (c2.controlPoints.size() == before + rr);
        bool knOk  = (c2.knots.size() == c.knots.size() + rr);
        double worst = 0.0;
        for (int i = 0; i <= 50; ++i) {
            double t = static_cast<double>(i) / 50.0;
            Vec3 a = c.evaluate(t), b = c2.evaluate(t);
            worst = std::max({worst, std::fabs(a.x - b.x),
                              std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
        }
        std::printf("       %-22s +cps=%d knots ok=%d worst=%.2e\n",
                    label, cntOk, knOk, worst);
        check(cntOk, std::string(label) + ": +r control points");
        check(knOk,  std::string(label) + ": knot vector +r");
        check(worst <= 1e-12, std::string(label) + ": geometry preserved <=1e-12");
    };
    run(bspline3(), 0.5, 2, "bspline u=0.5 r=2");
    run(bspline3(), 0.3, 3, "bspline u=0.3 r=3");
    run(quarterCircle(), 0.4, 2, "rational circle r=2");
}

// ===========================================================================
// (2) knot refinement (vector): geometry preserved, +|X| control points.
// ===========================================================================
static void testRefine() {
    std::printf("[2] knot refinement (A5.4): geometry preserved, +|X| cps\n");
    auto run = [&](NurbsCurve c, std::vector<double> X, const char* label) {
        std::size_t before = c.controlPoints.size();
        NurbsCurve c2 = refineKnotVector(c, X);
        bool cntOk = (c2.controlPoints.size() == before + X.size());
        bool knOk  = (c2.knots.size() == c.knots.size() + X.size());
        double worst = 0.0;
        for (int i = 0; i <= 60; ++i) {
            double t = static_cast<double>(i) / 60.0;
            Vec3 a = c.evaluate(t), b = c2.evaluate(t);
            worst = std::max({worst, std::fabs(a.x - b.x),
                              std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
        }
        std::printf("       %-22s +cps=%d knots ok=%d worst=%.2e\n",
                    label, cntOk, knOk, worst);
        check(cntOk, std::string(label) + ": +|X| control points");
        check(knOk,  std::string(label) + ": knots +|X|");
        check(worst <= 1e-12, std::string(label) + ": geometry preserved <=1e-12");
    };
    run(bspline3(), {0.25, 0.6, 0.8}, "bspline X={.25,.6,.8}");
    run(quarterCircle(), {0.2, 0.5, 0.5, 0.7}, "circle X (dup .5)");
}

// ===========================================================================
// (3) knot removal: inserted knot is removable (geometry preserved); a knot at
// full-degree multiplicity (the clamp) is NOT interior-removable -> removed=0.
// ===========================================================================
static void testRemove() {
    std::printf("[3] knot removal (A5.8): inverse of insertion, exact-or-skip\n");
    // Insert a knot twice, then remove it twice -> back to original geometry.
    NurbsCurve c = bspline3();
    NurbsCurve ins = insertKnotR(c, 0.4, 2);   // +2 knots at 0.4
    std::size_t removed = 0;
    NurbsCurve rem = removeKnot(ins, 0.4, 2, 1e-9, removed);
    std::printf("       removed=%zu (expected 2)  cps %zu->%zu->%zu\n",
                removed, c.controlPoints.size(), ins.controlPoints.size(),
                rem.controlPoints.size());
    check(removed == 2, "removed the 2 inserted knots");
    check(rem.controlPoints.size() == ins.controlPoints.size() - 2,
          "control-point count reduced by 2");
    double worst = 0.0;
    for (int i = 0; i <= 60; ++i) {
        double t = static_cast<double>(i) / 60.0;
        Vec3 a = c.evaluate(t), b = rem.evaluate(t);
        worst = std::max({worst, std::fabs(a.x - b.x),
                          std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
    }
    std::printf("       worst dEval (orig vs insert+remove) = %.2e\n", worst);
    check(worst <= 1e-10, "geometry preserved through insert+remove <=1e-10");

    // The native interior knot 0.5 of bspline3 has multiplicity 1; removing it
    // once changes the curve only if it is redundant. It is NOT (real C2 join),
    // so a strict tolerance must report removed==0 (no silent corruption).
    std::size_t rem2 = 0;
    NurbsCurve strict = removeKnot(c, 0.5, 1, 1e-12, rem2);
    std::printf("       non-redundant 0.5 removal: removed=%zu (expect 0)\n", rem2);
    check(rem2 == 0, "non-removable knot reported removed=0 (no corruption)");
    (void)strict;
}

// ===========================================================================
// (4) curve degree elevation: geometry preserved, degree raised by t.
// ===========================================================================
static void testElevateCurve() {
    std::printf("[4] curve degree elevation (A5.9): geometry preserved\n");
    auto run = [&](NurbsCurve c, std::size_t t, const char* label) {
        NurbsCurve c2 = elevateDegree(c, t);
        bool degOk = (c2.degree == c.degree + t);
        bool valid = c2.valid();
        double worst = 0.0;
        for (int i = 0; i <= 80; ++i) {
            double tt = static_cast<double>(i) / 80.0;
            Vec3 a = c.evaluate(tt), b = c2.evaluate(tt);
            worst = std::max({worst, std::fabs(a.x - b.x),
                              std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
        }
        std::printf("       %-22s deg %zu->%zu valid=%d cps=%zu worst=%.2e\n",
                    label, c.degree, c2.degree, valid,
                    c2.controlPoints.size(), worst);
        check(degOk, std::string(label) + ": degree raised by t");
        check(valid, std::string(label) + ": elevated curve valid");
        check(worst <= 1e-12, std::string(label) + ": geometry preserved <=1e-12");
    };
    run(bspline3(), 1, "bspline t=1");
    run(bspline3(), 2, "bspline t=2");
    run(quarterCircle(), 1, "rational circle t=1");
}

// ===========================================================================
// (5) surface knot insertion (U + V): geometry preserved.
// ===========================================================================
static void testSurfaceKnotIns() {
    std::printf("[5] surface knot insertion (A5.3): geometry preserved\n");
    auto run = [&](NurbsSurface s, bool dirU, double val, const char* label) {
        NurbsSurface s2 = insertSurfaceKnot(s, dirU, val);
        double worst = 0.0;
        for (int i = 0; i <= 20; ++i)
            for (int j = 0; j <= 20; ++j) {
                double u = static_cast<double>(i) / 20.0;
                double v = static_cast<double>(j) / 20.0;
                Vec3 a = s.evaluate(u, v), b = s2.evaluate(u, v);
                worst = std::max({worst, std::fabs(a.x - b.x),
                                  std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
            }
        std::printf("       %-22s worst=%.2e\n", label, worst);
        check(worst <= 1e-12, std::string(label) + ": geometry preserved <=1e-12");
    };
    run(biquadPatch(), true,  0.5, "biquad insert U=0.5");
    run(biquadPatch(), false, 0.4, "biquad insert V=0.4");
    run(sphereOctant(2.0), true, 0.5, "sphere insert U=0.5");
}

// ===========================================================================
// (6) surface degree elevation (U + V): geometry preserved.
// ===========================================================================
static void testElevateSurface() {
    std::printf("[6] surface degree elevation (A5.10): geometry preserved\n");
    auto run = [&](NurbsSurface s, bool dirU, std::size_t t, const char* label) {
        NurbsSurface s2 = elevateSurfaceDegree(s, dirU, t);
        bool degOk = dirU ? (s2.degreeU == s.degreeU + t)
                          : (s2.degreeV == s.degreeV + t);
        double worst = 0.0;
        for (int i = 0; i <= 20; ++i)
            for (int j = 0; j <= 20; ++j) {
                double u = static_cast<double>(i) / 20.0;
                double v = static_cast<double>(j) / 20.0;
                Vec3 a = s.evaluate(u, v), b = s2.evaluate(u, v);
                worst = std::max({worst, std::fabs(a.x - b.x),
                                  std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
            }
        std::printf("       %-22s degOk=%d worst=%.2e\n", label, degOk, worst);
        check(degOk, std::string(label) + ": degree raised");
        check(worst <= 1e-12, std::string(label) + ": geometry preserved <=1e-12");
    };
    run(biquadPatch(), true,  1, "biquad elevate U");
    run(biquadPatch(), false, 1, "biquad elevate V");
    run(sphereOctant(1.5), true, 1, "sphere elevate U");
}

// ===========================================================================
// (7) isocurve extraction: isoCurveU(u)(t) == S(u,t); isoCurveV(v)(t)==S(t,v).
// ===========================================================================
static void testIsocurve() {
    std::printf("[7] isocurve extraction: iso(t) == S(...) <=1e-12\n");
    NurbsSurface s = biquadPatch();
    double worstU = 0.0, worstV = 0.0;
    for (double fix : {0.0, 0.3, 0.5, 0.8, 1.0}) {
        NurbsCurve cu = isoCurveU(s, fix);   // free v
        NurbsCurve cv = isoCurveV(s, fix);   // free u
        for (int i = 0; i <= 40; ++i) {
            double t = static_cast<double>(i) / 40.0;
            Vec3 a = cu.evaluate(t), b = s.evaluate(fix, t);
            worstU = std::max({worstU, std::fabs(a.x - b.x),
                               std::fabs(a.y - b.y), std::fabs(a.z - b.z)});
            Vec3 c = cv.evaluate(t), d = s.evaluate(t, fix);
            worstV = std::max({worstV, std::fabs(c.x - d.x),
                               std::fabs(c.y - d.y), std::fabs(c.z - d.z)});
        }
    }
    std::printf("       worst isoU=%.2e  worst isoV=%.2e\n", worstU, worstV);
    check(worstU <= 1e-12, "isoCurveU(u)(t) == S(u,t)");
    check(worstV <= 1e-12, "isoCurveV(v)(t) == S(t,v)");
}

// ===========================================================================
// (8) surface curvature CLOSED FORM.
// ===========================================================================
static void testCurvature() {
    std::printf("[8] surface curvature vs closed form (sphere/cylinder/plane)\n");

    // -- sphere patch: K = 1/R^2, H = 1/R, k1 == k2 == 1/R everywhere.
    const double R = 2.0;
    NurbsSurface sph = sphereOctant(R);
    bool sphOk = true, radiusOk = true;
    double worstK = 0.0, worstH = 0.0;
    for (double u : {0.2, 0.4, 0.5, 0.6, 0.8})
        for (double v : {0.2, 0.4, 0.5, 0.6, 0.8}) {
            // Confirm the patch really is the sphere of radius R first.
            Vec3 p = sph.evaluate(u, v);
            radiusOk = radiusOk && approx(norm(p), R, 1e-9);
            SurfaceCurvature c = surfaceCurvature(sph, u, v);
            sphOk = sphOk && c.ok;
            worstK = std::max(worstK, std::fabs(std::fabs(c.gaussian) - 1.0/(R*R)));
            worstH = std::max(worstH, std::fabs(std::fabs(c.mean) - 1.0/R));
            sphOk = sphOk && approx(std::fabs(c.gaussian), 1.0/(R*R), 1e-7);
            sphOk = sphOk && approx(std::fabs(c.mean), 1.0/R, 1e-7);
            sphOk = sphOk && approx(std::fabs(c.k1), 1.0/R, 1e-6);
            sphOk = sphOk && approx(std::fabs(c.k2), 1.0/R, 1e-6);
        }
    std::printf("       sphere R=%.1f  K target=%.5f worst|K|err=%.2e "
                "worst|H|err=%.2e radiusOk=%d\n",
                R, 1.0/(R*R), worstK, worstH, radiusOk);
    check(radiusOk, "sphere patch really has |S(u,v)| == R");
    check(sphOk, "sphere: K=1/R^2, H=1/R, k1=k2=1/R");

    // -- cylinder patch: K == 0, principal curvatures {0, 1/R}.
    const double Rc = 1.5;
    NurbsSurface cyl = cylinderQuarter(Rc, 4.0);
    bool cylOk = true;
    double worstKc = 0.0;
    for (double u : {0.2, 0.5, 0.8})
        for (double v : {0.2, 0.5, 0.8}) {
            SurfaceCurvature c = surfaceCurvature(cyl, u, v);
            cylOk = cylOk && c.ok;
            worstKc = std::max(worstKc, std::fabs(c.gaussian));
            cylOk = cylOk && approx(c.gaussian, 0.0, 1e-7);
            // One principal curvature ~0, the other ~1/Rc (sign-agnostic).
            double pmin = std::min(std::fabs(c.k1), std::fabs(c.k2));
            double pmax = std::max(std::fabs(c.k1), std::fabs(c.k2));
            cylOk = cylOk && approx(pmin, 0.0, 1e-6);
            cylOk = cylOk && approx(pmax, 1.0/Rc, 1e-6);
        }
    std::printf("       cylinder R=%.1f  worst|K|=%.2e  (expect 0; kmax=1/R=%.4f)\n",
                Rc, worstKc, 1.0/Rc);
    check(cylOk, "cylinder: K=0, principal {0, 1/R}");

    // -- plane: K == 0, H == 0.
    NurbsSurface pl = flatPatch();
    bool plOk = true;
    for (double u : {0.2, 0.5, 0.8})
        for (double v : {0.2, 0.5, 0.8}) {
            SurfaceCurvature c = surfaceCurvature(pl, u, v);
            plOk = plOk && c.ok && approx(c.gaussian, 0.0, 1e-12)
                   && approx(c.mean, 0.0, 1e-12);
        }
    check(plOk, "plane: K=0 and H=0");
}

// ===========================================================================
// (9) curve projection: on-curve point -> dist~0; off-circle -> radial foot.
// ===========================================================================
static void testCurveProjection() {
    std::printf("[9] curve point projection (Newton foot-point)\n");
    NurbsCurve circ = quarterCircle();

    // On-curve point: evaluate at a known parameter, project, expect the same
    // parameter and ~0 distance.
    double uKnown = 0.37;
    Vec3 onCurve = circ.evaluate(uKnown);
    CurveProjection pr = projectPointToCurve(circ, onCurve);
    std::printf("       on-curve: u*=%.6f (known %.3f) dist=%.2e it=%zu\n",
                pr.u, uKnown, pr.distance, pr.iterations);
    check(pr.ok && approx(pr.distance, 0.0, 1e-9),
          "on-curve point projects to distance ~0");
    check(approx(pr.u, uKnown, 1e-6), "recovers the known foot parameter");

    // Off-curve point along a radial: the quarter-circle is |X|=1 on z=0; pick
    // P = 3*(cos45,sin45,0). The closest point is the radial foot at angle 45deg
    // -> the curve point with |foot|=1, and distance = |P| - 1 = 2.
    const double c45 = std::sqrt(2.0) / 2.0;
    Vec3 P{3.0 * c45, 3.0 * c45, 0.0};
    CurveProjection pr2 = projectPointToCurve(circ, P);
    Vec3 foot = pr2.point;
    bool footOnCircle = approx(norm(foot), 1.0, 1e-7);
    bool radial = approx(std::fabs(dot(foot, Vec3{c45, c45, 0}) /
                                   (norm(foot))), 1.0, 1e-5);
    std::printf("       off-curve: foot=(%.5f,%.5f) |foot|=%.6f dist=%.6f "
                "(expect 2.0)\n", foot.x, foot.y, norm(foot), pr2.distance);
    check(footOnCircle, "off-curve foot lies on the circle (|foot|=1)");
    check(radial, "off-curve foot is the radial (45deg) point");
    check(approx(pr2.distance, 2.0, 1e-6), "off-curve distance == |P| - R == 2");
}

// ===========================================================================
// (10) surface projection: on-surface -> dist~0; off-sphere -> radial foot.
// ===========================================================================
static void testSurfaceProjection() {
    std::printf("[10] surface point projection (2D Newton)\n");
    const double R = 2.0;
    NurbsSurface sph = sphereOctant(R);

    // On-surface point.
    Vec3 onSurf = sph.evaluate(0.42, 0.63);
    SurfaceProjection pr = projectPointToSurface(sph, onSurf);
    std::printf("       on-surf: (u,v)=(%.4f,%.4f) dist=%.2e it=%zu\n",
                pr.u, pr.v, pr.distance, pr.iterations);
    check(pr.ok && approx(pr.distance, 0.0, 1e-8),
          "on-surface point projects to distance ~0");
    check(approx(pr.u, 0.42, 1e-5) && approx(pr.v, 0.63, 1e-5),
          "recovers the known (u,v) foot");

    // Off-surface point: take an interior sphere point's direction and push it
    // out to radius 3R. The radial foot is the sphere point in that direction;
    // distance = 3R - R = 2R = 4.
    Vec3 dir = sph.evaluate(0.5, 0.5);          // |dir| = R, on the sphere
    double dl = norm(dir);
    Vec3 P{dir.x / dl * 3.0 * R, dir.y / dl * 3.0 * R, dir.z / dl * 3.0 * R};
    SurfaceProjection pr2 = projectPointToSurface(sph, P);
    Vec3 foot = pr2.point;
    std::printf("       off-surf: |foot|=%.6f dist=%.6f (expect R=%.1f, 2R=%.1f)\n",
                norm(foot), pr2.distance, R, 2.0 * R);
    check(approx(norm(foot), R, 1e-6), "off-surface foot lies on the sphere");
    check(approx(pr2.distance, 2.0 * R, 1e-5),
          "off-surface distance == 3R - R == 2R");
    // Foot is radial: foot parallel to P.
    Vec3 fn = vscaleLocal(foot, 1.0 / norm(foot));
    Vec3 pn = vscaleLocal(P, 1.0 / norm(P));
    check(approx(dot(fn, pn), 1.0, 1e-5), "off-surface foot is radial to P");
}

int main() {
    std::printf("=== K1.1 NURBS algebra completion gate ===\n");
    testKnotInsertR();
    testRefine();
    testRemove();
    testElevateCurve();
    testSurfaceKnotIns();
    testElevateSurface();
    testIsocurve();
    testCurvature();
    testCurveProjection();
    testSurfaceProjection();
    std::printf("=== %d / %d PASS ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
