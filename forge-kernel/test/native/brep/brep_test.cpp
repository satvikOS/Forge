// forge/native/brep/brep_test.cpp
//
// Standalone validation gate for the FIRST in-house B-rep / NURBS increment.
// Pure C++20, no external dependencies, no test framework — a tiny hand-rolled
// harness that prints PASS/FAIL lines and exits non-zero on any failure.
//
// Build + run (from KERNEL_INHOUSE_ROADMAP convention):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/test/native/brep/brep_test.cpp \
//     -o /tmp/brep_test && /tmp/brep_test
//
// VALIDATION GATE (asserted below):
//   (a) The box solid satisfies Euler-Poincare  V - E + F = 2  (genus 0),
//       AND the structural closed-2-manifold invariants hold.
//   (b) A cubic Bezier with known control points, and a weighted quarter-circle
//       NURBS, evaluate to their ANALYTIC points within 1e-9.
//   (c) A bilinear (and a higher-order Bezier) surface patch evaluate to known
//       corner + midpoint values within 1e-9.

#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Nurbs.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s\n", name.c_str());
    }
}

static bool approx(double a, double b, double tol) {
    return std::fabs(a - b) <= tol;
}

static bool approxPt(const Vec3& a, const Vec3& bx, double tol) {
    return approx(a.x, bx.x, tol) && approx(a.y, bx.y, tol) &&
           approx(a.z, bx.z, tol);
}

// ===========================================================================
// (a) Box solid Euler-Poincare gate
// ===========================================================================
static void testBoxEuler() {
    std::printf("[a] B-rep box topology / Euler-Poincare\n");
    TopologyBuilder tb;
    Solid* box = tb.buildBox(Point3{0, 0, 0}, Point3{2, 3, 5});
    (void)box;

    EulerCounts c = tb.counts();
    std::printf("      V=%zu E=%zu F=%zu L=%zu Sh=%zu  (V-E+F)=%lld\n",
                c.vertices, c.edges, c.faces, c.loops, c.shells,
                c.characteristic());

    // A cube/box has 8 vertices, 12 edges, 6 faces.
    check(c.vertices == 8, "box has 8 vertices");
    check(c.edges == 12, "box has 12 edges");
    check(c.faces == 6, "box has 6 faces");
    check(c.loops == 6, "box has 6 loops (one outer loop per face)");
    check(c.shells == 1, "box has 1 shell");

    // The core gate: Euler-Poincare for a genus-0 solid.
    check(c.characteristic() == 2, "Euler-Poincare V-E+F == 2 (genus 0)");

    // Structural validity: closed, oriented 2-manifold.
    check(tb.isClosedTwoManifold(),
          "box is a closed 2-manifold (every edge shared by 2 mated coedges)");

    // Each edge used by exactly two coedges => coedge count == 2 * edges.
    check(tb.coedgeCount() == 2 * c.edges,
          "coedge count == 2 * edge count (24)");
}

// ===========================================================================
// (b) Curve evaluation gates
// ===========================================================================
static void testCubicBezierCurve() {
    std::printf("[b1] cubic Bezier curve vs analytic\n");
    // Known cubic Bezier control points.
    std::vector<Vec3> P = {
        {0.0, 0.0, 0.0},
        {1.0, 2.0, 0.0},
        {2.0, 2.0, 0.0},
        {3.0, 0.0, 0.0},
    };
    std::vector<double> W = {1, 1, 1, 1};

    // Analytic Bernstein evaluation B(t) = sum C(3,k) (1-t)^{3-k} t^k P_k.
    auto analytic = [&](double t) {
        double mt = 1.0 - t;
        double b0 = mt * mt * mt;
        double b1 = 3 * mt * mt * t;
        double b2 = 3 * mt * t * t;
        double b3 = t * t * t;
        Vec3 r;
        r.x = b0 * P[0].x + b1 * P[1].x + b2 * P[2].x + b3 * P[3].x;
        r.y = b0 * P[0].y + b1 * P[1].y + b2 * P[2].y + b3 * P[3].y;
        r.z = b0 * P[0].z + b1 * P[1].z + b2 * P[2].z + b3 * P[3].z;
        return r;
    };

    const double tol = 1e-9;

    // Endpoint interpolation (Bezier passes through first/last control points).
    check(approxPt(bezierCurvePoint(P, W, 0.0), P[0], tol),
          "Bezier(0) == P0");
    check(approxPt(bezierCurvePoint(P, W, 1.0), P[3], tol),
          "Bezier(1) == P3");

    // Interior samples vs analytic Bernstein.
    bool ok = true;
    for (double t : {0.1, 0.25, 0.5, 0.75, 0.9}) {
        if (!approxPt(bezierCurvePoint(P, W, t), analytic(t), tol)) ok = false;
    }
    check(ok, "Bezier de-Casteljau matches Bernstein analytic (5 samples)");

    // Cross-check: the SAME Bezier expressed as a degree-3 B-spline (NURBS)
    // with a clamped knot vector must reproduce the direct evaluator within tol.
    NurbsCurve nc;
    nc.degree = 3;
    nc.controlPoints = P;
    nc.weights = W;
    nc.knots = bezierKnotVector(3); // [0,0,0,0,1,1,1,1]
    check(nc.valid(), "Bezier-as-NURBS curve has consistent sizes");

    bool ok2 = true;
    for (double t : {0.0, 0.2, 0.5, 0.8, 1.0}) {
        if (!approxPt(nc.evaluate(t), bezierCurvePoint(P, W, t), tol))
            ok2 = false;
    }
    check(ok2,
          "B-spline(clamped Bezier knots) == direct Bezier (5 samples)");
}

static void testQuarterCircleNurbs() {
    std::printf("[b2] weighted quarter-circle NURBS vs analytic circle\n");
    // Exact rational quadratic representation of a quarter unit circle from
    // (1,0) to (0,1). Standard NURBS-book construction:
    //   degree 2, control pts P0=(1,0) P1=(1,1) P2=(0,1),
    //   weights w0=1, w1 = cos(45 deg) = sqrt(2)/2, w2=1,
    //   knots = [0,0,0,1,1,1].
    const double w = std::sqrt(2.0) / 2.0;
    NurbsCurve arc;
    arc.degree = 2;
    arc.controlPoints = {{1, 0, 0}, {1, 1, 0}, {0, 1, 0}};
    arc.weights = {1.0, w, 1.0};
    arc.knots = {0, 0, 0, 1, 1, 1};
    check(arc.valid(), "quarter-circle NURBS has consistent sizes");

    const double tol = 1e-9;

    // Endpoints exact.
    check(approxPt(arc.evaluate(0.0), Vec3{1, 0, 0}, tol),
          "arc(0) == (1,0)");
    check(approxPt(arc.evaluate(1.0), Vec3{0, 1, 0}, tol),
          "arc(1) == (0,1)");

    // Every evaluated point must lie EXACTLY on the unit circle: x^2+y^2 == 1.
    // This is the analytic truth for a circle independent of parametrization.
    bool onCircle = true;
    for (double u = 0.0; u <= 1.0 + 1e-12; u += 0.05) {
        Vec3 p = arc.evaluate(u);
        double r2 = p.x * p.x + p.y * p.y;
        if (!approx(r2, 1.0, tol)) onCircle = false;
    }
    check(onCircle,
          "every arc sample lies on unit circle x^2+y^2==1 (21 samples, 1e-9)");

    // The midpoint u=0.5 of THIS standard parametrization lands at the 45-deg
    // point (cos45, sin45) = (sqrt(2)/2, sqrt(2)/2). (Derivable directly: at
    // u=0.5 the rational quadratic gives ( (0.5+0.5w):(0.5w+0.5):(0.5+w+0.5) )
    // normalized -> (0.5(1+w), 0.5(1+w)) / (1+w) = (0.5, 0.5)... careful: the
    // homogeneous w-accumulation is 0.25*1 + 0.5*w + 0.25*1, so we just assert
    // the geometric truth: it is the 45-degree point.)
    Vec3 mid = arc.evaluate(0.5);
    check(approx(mid.x, std::sqrt(2.0) / 2.0, tol) &&
          approx(mid.y, std::sqrt(2.0) / 2.0, tol),
          "arc(0.5) == (sqrt2/2, sqrt2/2) [45-degree point]");

    // Negative control: a NON-weighted (w1=1) quadratic Bezier through the same
    // control points is a PARABOLA, not a circle, so its midpoint must NOT be
    // on the unit circle. This proves the weighting is doing real work.
    NurbsCurve parab = arc;
    parab.weights = {1, 1, 1};
    Vec3 pmid = parab.evaluate(0.5);
    double pr2 = pmid.x * pmid.x + pmid.y * pmid.y;
    check(!approx(pr2, 1.0, 1e-6),
          "unweighted parabola midpoint is NOT on the circle (weights matter)");
}

// ===========================================================================
// (c) Surface evaluation gates
// ===========================================================================
static void testBilinearSurface() {
    std::printf("[c1] bilinear surface patch corner+midpoint\n");
    // Bilinear (degree 1 x 1) patch over a 2x2 control grid. A non-planar
    // (hyperbolic-paraboloid / saddle) corner set makes the midpoint a real
    // average, not a trivial plane value.
    //   S(0,0)=C00  S(1,0)=C10  S(0,1)=C01  S(1,1)=C11
    //   S(0.5,0.5) = (C00+C10+C01+C11)/4
    NurbsSurface s;
    s.degreeU = 1;
    s.degreeV = 1;
    s.control = {
        {{0, 0, 0}, {0, 1, 1}},   // i=0 (u row): j=0 -> C00, j=1 -> C01
        {{1, 0, 1}, {1, 1, 0}},   // i=1 (u row): j=0 -> C10, j=1 -> C11
    };
    s.weights = {{1, 1}, {1, 1}};
    s.knotsU = {0, 0, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    check(s.valid(), "bilinear surface has consistent sizes");

    const double tol = 1e-9;
    Vec3 C00 = {0, 0, 0}, C01 = {0, 1, 1}, C10 = {1, 0, 1}, C11 = {1, 1, 0};

    check(approxPt(s.evaluate(0, 0), C00, tol), "S(0,0) == C00");
    check(approxPt(s.evaluate(1, 0), C10, tol), "S(1,0) == C10");
    check(approxPt(s.evaluate(0, 1), C01, tol), "S(0,1) == C01");
    check(approxPt(s.evaluate(1, 1), C11, tol), "S(1,1) == C11");

    Vec3 expectMid = {
        (C00.x + C01.x + C10.x + C11.x) / 4.0,
        (C00.y + C01.y + C10.y + C11.y) / 4.0,
        (C00.z + C01.z + C10.z + C11.z) / 4.0,
    };
    check(approxPt(s.evaluate(0.5, 0.5), expectMid, tol),
          "S(0.5,0.5) == average of 4 corners (saddle midpoint)");

    // The z=0.5 saddle midpoint above is the analytic hyperbolic-paraboloid
    // value; assert the specific number too.
    check(approx(s.evaluate(0.5, 0.5).z, 0.5, tol),
          "saddle midpoint z == 0.5 (analytic)");
}

static void testBezierSurface() {
    std::printf("[c2] biquadratic Bezier surface patch corner+midpoint\n");
    // A 3x3 biquadratic Bezier patch. Corners interpolate the corner control
    // points; the center value has a closed-form Bernstein expression.
    std::vector<std::vector<Vec3>> C = {
        {{0, 0, 0}, {1, 0, 1}, {2, 0, 0}},
        {{0, 1, 1}, {1, 1, 2}, {2, 1, 1}},
        {{0, 2, 0}, {1, 2, 1}, {2, 2, 0}},
    };
    std::vector<std::vector<double>> W = {
        {1, 1, 1}, {1, 1, 1}, {1, 1, 1}};

    const double tol = 1e-9;

    // Corner interpolation.
    check(approxPt(bezierSurfacePoint(C, W, 0, 0), C[0][0], tol),
          "Bezier S(0,0) == C[0][0]");
    check(approxPt(bezierSurfacePoint(C, W, 1, 0), C[2][0], tol),
          "Bezier S(1,0) == C[2][0]");
    check(approxPt(bezierSurfacePoint(C, W, 0, 1), C[0][2], tol),
          "Bezier S(0,1) == C[0][2]");
    check(approxPt(bezierSurfacePoint(C, W, 1, 1), C[2][2], tol),
          "Bezier S(1,1) == C[2][2]");

    // Center: tensor Bernstein at (0.5,0.5). For degree-2 the basis at 0.5 is
    // {1/4, 1/2, 1/4}; the weighted double sum gives the closed-form center.
    auto bern2 = [](double t, int k) {
        if (k == 0) return (1 - t) * (1 - t);
        if (k == 1) return 2 * (1 - t) * t;
        return t * t;
    };
    Vec3 expect = {0, 0, 0};
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) {
            double bw = bern2(0.5, i) * bern2(0.5, j);
            expect.x += bw * C[i][j].x;
            expect.y += bw * C[i][j].y;
            expect.z += bw * C[i][j].z;
        }
    check(approxPt(bezierSurfacePoint(C, W, 0.5, 0.5), expect, tol),
          "Bezier S(0.5,0.5) == analytic tensor-Bernstein center");

    // Cross-check: same patch as a NURBS surface with clamped Bezier knots.
    NurbsSurface ns;
    ns.degreeU = 2;
    ns.degreeV = 2;
    ns.control = C;
    ns.weights = W;
    ns.knotsU = bezierKnotVector(2);
    ns.knotsV = bezierKnotVector(2);
    check(ns.valid(), "Bezier-as-NURBS surface has consistent sizes");

    bool ok = true;
    for (double u : {0.0, 0.3, 0.5, 0.7, 1.0})
        for (double v : {0.0, 0.4, 0.5, 0.6, 1.0}) {
            if (!approxPt(ns.evaluate(u, v),
                          bezierSurfacePoint(C, W, u, v), tol))
                ok = false;
        }
    check(ok,
          "NURBS(clamped Bezier knots) surface == direct Bezier (25 samples)");
}

// ===========================================================================
int main() {
    std::printf("=== forge::native::brep — first-increment validation gate ===\n");
    testBoxEuler();
    testCubicBezierCurve();
    testQuarterCircleNurbs();
    testBilinearSurface();
    testBezierSurface();

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
