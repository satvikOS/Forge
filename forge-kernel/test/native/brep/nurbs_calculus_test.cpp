// forge/native/brep/nurbs_calculus_test.cpp
//
// Standalone validation gate for the NURBS CALCULUS + Boehm knot-insertion
// increment (NurbsCalculus.hpp). Pure C++20, no test framework — a tiny
// hand-rolled harness that prints PASS/FAIL and exits non-zero on any failure.
//
// Build + run:
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/test/native/brep/nurbs_calculus_test.cpp \
//     -o /tmp/nurbs_calculus_test && /tmp/nurbs_calculus_test
//
// VALIDATION GATE:
//   (1) Cubic Bezier derivative  C'  ==  degree * (P[i+1]-P[i]) Bernstein form
//       (Bezier hodograph). Checked at several t against the closed form.
//   (2) Weighted quarter-circle NURBS: the curve TANGENT is perpendicular to
//       the radius vector at sample parameters (dot ~ 0).
//   (3) Curvature of the unit-circle arc ~ 1.0 at sample parameters.
//   (4) Boehm knot insertion: every evaluation unchanged within 1e-12, AND the
//       control-point count increases by exactly 1.
// Plus cross-checks: ders[0] == basisFunctions(); surface normal of a saddle.

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsCalculus.hpp"

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

// Build a clamped NURBS from a Bezier (degree p, control pts, weights).
static NurbsCurve bezierAsNurbs(std::size_t p,
                               const std::vector<Vec3>& cp,
                               const std::vector<double>& w) {
    NurbsCurve c;
    c.degree = p;
    c.controlPoints = cp;
    c.weights = w;
    c.knots = bezierKnotVector(p);
    return c;
}

// ===========================================================================
// (1) Cubic Bezier derivative == degree*(P[i+1]-P[i]) Bernstein hodograph.
// ===========================================================================
static void testBezierHodograph() {
    std::printf("[1] cubic Bezier derivative == degree*(P[i+1]-P[i])\n");
    const std::size_t p = 3;
    std::vector<Vec3> P = {
        {0.0, 0.0, 0.0}, {1.0, 2.0, 0.0}, {3.0, 2.0, 1.0}, {4.0, 0.0, 0.0}};
    std::vector<double> w(4, 1.0); // polynomial Bezier
    NurbsCurve c = bezierAsNurbs(p, P, w);

    // Hodograph control points  Q[i] = p*(P[i+1]-P[i]).
    std::vector<Vec3> Q(p);
    for (std::size_t i = 0; i < p; ++i)
        Q[i] = Vec3{static_cast<double>(p) * (P[i + 1].x - P[i].x),
                    static_cast<double>(p) * (P[i + 1].y - P[i].y),
                    static_cast<double>(p) * (P[i + 1].z - P[i].z)};

    // Evaluate the degree-(p-1) Bernstein hodograph directly via de Casteljau
    // (the existing bezierCurvePoint with unit weights) and compare to C'.
    std::vector<double> qw(p, 1.0);
    bool ok = true;
    for (double t : {0.0, 0.2, 0.5, 0.75, 1.0}) {
        auto d = curveDerivatives(c, t, 1);
        Vec3 ref = bezierCurvePoint(Q, qw, t);
        ok = ok && approx(d[1].x, ref.x, 1e-9)
                && approx(d[1].y, ref.y, 1e-9)
                && approx(d[1].z, ref.z, 1e-9);
    }
    check(ok, "C'(t) matches degree*(P[i+1]-P[i]) Bernstein hodograph");

    // Also verify the explicit endpoint derivative: C'(0) = p*(P1-P0).
    auto d0 = curveDerivatives(c, 0.0, 1);
    check(approx(d0[1].x, 3.0 * (P[1].x - P[0].x), 1e-9) &&
          approx(d0[1].y, 3.0 * (P[1].y - P[0].y), 1e-9) &&
          approx(d0[1].z, 3.0 * (P[1].z - P[0].z), 1e-9),
          "C'(0) = degree*(P1-P0) exactly");

    // ders[0] cross-check: derivative table row 0 == value basis functions.
    const std::size_t n = c.controlPoints.size() - 1;
    double t = 0.37;
    std::size_t span = findSpan(n, p, t, c.knots);
    auto bf = basisFunctions(span, t, p, c.knots);
    auto ders = basisFunctionDerivatives(span, t, p, 2, c.knots);
    bool row0 = true;
    for (std::size_t i = 0; i <= p; ++i)
        row0 = row0 && approx(ders[0][i], bf[i], 1e-12);
    check(row0, "basisFunctionDerivatives row 0 == basisFunctions value");
}

// ===========================================================================
// Build the standard weighted quarter-circle NURBS (radius 1, center origin,
// from (1,0) to (0,1)): degree 2, 3 control pts, middle weight cos(45)=1/sqrt2.
// ===========================================================================
static NurbsCurve quarterCircle() {
    NurbsCurve c;
    c.degree = 2;
    c.controlPoints = {{1.0, 0.0, 0.0}, {1.0, 1.0, 0.0}, {0.0, 1.0, 0.0}};
    const double wc = std::sqrt(2.0) / 2.0; // 1/sqrt(2)
    c.weights = {1.0, wc, 1.0};
    c.knots = {0.0, 0.0, 0.0, 1.0, 1.0, 1.0};
    return c;
}

// ===========================================================================
// (2) Quarter-circle NURBS tangent perpendicular to the radius (dot ~ 0).
// ===========================================================================
static void testCircleTangentPerp() {
    std::printf("[2] quarter-circle tangent perpendicular to radius\n");
    NurbsCurve c = quarterCircle();
    bool ok = true;
    for (double t : {0.1, 0.25, 0.5, 0.75, 0.9}) {
        Vec3 pt = c.evaluate(t);          // radius vector (center is origin)
        Vec3 T = curveTangent(c, t);      // unit tangent
        // Point must be on the unit circle (sanity of the construction).
        ok = ok && approx(norm(pt), 1.0, 1e-12);
        ok = ok && approx(dot(pt, T), 0.0, 1e-9);
    }
    check(ok, "T . radius ~ 0  AND  |point| == 1 at samples");
}

// ===========================================================================
// (3) Curvature of the unit circle arc ~ 1.0.
// ===========================================================================
static void testCircleCurvature() {
    std::printf("[3] unit-circle arc curvature ~ 1.0\n");
    NurbsCurve c = quarterCircle();
    bool ok = true;
    double worst = 0.0;
    for (double t : {0.1, 0.25, 0.5, 0.75, 0.9}) {
        double k = curveCurvature(c, t);
        worst = std::max(worst, std::fabs(k - 1.0));
        ok = ok && approx(k, 1.0, 1e-9);
    }
    std::printf("       worst |kappa - 1| = %.3e\n", worst);
    check(ok, "kappa ~ 1.0 across the arc");
}

// ===========================================================================
// (4) Boehm knot insertion preserves the curve + adds exactly one control pt.
// ===========================================================================
static void testKnotInsertion() {
    std::printf("[4] Boehm knot insertion: geometry preserved, +1 control pt\n");

    // Use a degree-3 B-spline with an interior knot so insertion is nontrivial,
    // and also the rational quarter-circle to exercise the homogeneous path.
    NurbsCurve bspline;
    bspline.degree = 3;
    bspline.controlPoints = {{0, 0, 0}, {1, 2, 0}, {2, -1, 1},
                             {4, 1, 0},  {5, 0, 2}};
    bspline.weights = std::vector<double>(5, 1.0);
    // n+p+2 = 5+3+1 = 9 knots, clamped, one interior knot at 0.5.
    bspline.knots = {0, 0, 0, 0, 0.5, 1, 1, 1, 1};

    auto runCase = [&](NurbsCurve c, double uIns, const char* label) {
        const std::size_t before = c.controlPoints.size();
        NurbsCurve c2 = insertKnot(c, uIns);
        const std::size_t after = c2.controlPoints.size();

        bool countOk = (after == before + 1);
        bool knotOk  = (c2.knots.size() == c.knots.size() + 1);

        // Evaluations identical within 1e-12 across the domain.
        double worst = 0.0;
        for (int i = 0; i <= 40; ++i) {
            double t = static_cast<double>(i) / 40.0;
            Vec3 a = c.evaluate(t);
            Vec3 b = c2.evaluate(t);
            worst = std::max(worst,
                std::max(std::fabs(a.x - b.x),
                std::max(std::fabs(a.y - b.y), std::fabs(a.z - b.z))));
        }
        std::printf("       %-18s +1 ctrlpt=%d  knot+1=%d  worst dEval=%.3e\n",
                    label, countOk ? 1 : 0, knotOk ? 1 : 0, worst);
        check(countOk, std::string(label) + ": control-point count +1");
        check(knotOk,  std::string(label) + ": knot vector size +1");
        check(worst <= 1e-12,
              std::string(label) + ": all evaluations unchanged (<=1e-12)");
    };

    runCase(bspline, 0.3, "bspline u=0.3");
    runCase(bspline, 0.5, "bspline u=0.5(interior)");
    runCase(bspline, 0.7, "bspline u=0.7");
    runCase(quarterCircle(), 0.5, "rational circle");
    runCase(quarterCircle(), 0.25, "rational circle u=.25");
}

// ===========================================================================
// Bonus cross-check: surface normal of a hyperbolic-paraboloid (saddle) patch.
// z = x*y on [0,1]^2 represented as a bilinear Bezier; the analytic unit normal
// at center (0.5,0.5) is (-0.5,-0.5,1)/||.|| .
// ===========================================================================
static void testSurfaceNormal() {
    std::printf("[5] bonus: saddle surface unit normal vs analytic\n");
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    s.control = {{{0, 0, 0}, {0, 1, 0}},
                 {{1, 0, 0}, {1, 1, 1}}};   // z = x*y at the corners
    s.weights = {{1, 1}, {1, 1}};
    s.knotsU = {0, 0, 1, 1};
    s.knotsV = {0, 0, 1, 1};

    Vec3 nrm = surfaceNormal(s, 0.5, 0.5);
    // Analytic: n ~ (-dz/dx, -dz/dy, 1) = (-0.5,-0.5,1) normalized.
    double inv = 1.0 / std::sqrt(0.25 + 0.25 + 1.0);
    Vec3 ref{-0.5 * inv, -0.5 * inv, 1.0 * inv};
    // Normal could point either way; align sign.
    if (dot(nrm, ref) < 0) { nrm.x = -nrm.x; nrm.y = -nrm.y; nrm.z = -nrm.z; }
    check(approx(nrm.x, ref.x, 1e-9) && approx(nrm.y, ref.y, 1e-9) &&
          approx(nrm.z, ref.z, 1e-9),
          "saddle unit normal matches analytic at center");
}

int main() {
    std::printf("=== NURBS calculus + knot-insertion gate ===\n");
    testBezierHodograph();
    testCircleTangentPerp();
    testCircleCurvature();
    testKnotInsertion();
    testSurfaceNormal();
    std::printf("=== %d / %d PASS ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
