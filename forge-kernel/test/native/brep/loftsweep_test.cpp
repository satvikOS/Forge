// forge/native/brep/loftsweep_test.cpp
//
// Standalone validation gate for the ANALYTIC LOFT + SWEEP increment
// (LoftSweep.hpp / LoftSweep.cpp) — the in-house brep::Solid replacement for OCCT
// BRepOffsetAPI_ThruSections (loft) and BRepPrimAPI_MakePrism / MakePipe
// (translational sweep). DISTINCT from the mesh-bridge Loft.cpp / Sweep.cpp. Pure
// C++20, NO external dependencies, NO OCCT, NO WASM, no test framework — a tiny
// hand-rolled harness that prints PASS/FAIL and exits non-zero on any failure
// (mirrors shell_solid_test.cpp / sew_test.cpp).
//
// Build + run (single clang invocation; compiles the brep object set it links):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/LoftSweep.cpp \
//     forge-kernel/src/native/brep/Primitives.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/MassProps.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/test/native/brep/loftsweep_test.cpp \
//     -o /tmp/loftsweep_test && /tmp/loftsweep_test
//
// CLOSED-FORM GATES:
//   (1) LOFT square(side 4) -> square(side 2) over height 6 -> closed 2-manifold
//       frustum. Prismatoid volume V = h/3 (A1 + A2 + sqrt(A1 A2))
//                                   = 6/3 (16 + 4 + sqrt(64)) = 2*(20+8) = 56
//       to <= 1e-9.
//   (2) SWEEP square(side 3) along a straight path of length 10 -> box volume
//       == profileArea * length == 9 * 10 == 90 EXACT (<= 1e-9).
//   (3) LOFT square(side s1) -> regular octagon of the SAME area, over height 5 ->
//       closed 2-manifold (the unequal-vertex-count ruled hull, 4 -> 8). Volume
//       is reported (prismatoid of two equal-area sections; positive + closed).

#include "forge/native/brep/LoftSweep.hpp"
#include "forge/native/brep/MassProps.hpp"

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
    else        std::printf("  [FAIL] %s\n", name.c_str());
}

static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// A square of side `s` centred at the origin, in the plane z=`z`, CCW about +Z.
static std::vector<Point3> squareAt(double s, double z) {
    const double h = 0.5 * s;
    return { {-h, -h, z}, {h, -h, z}, {h, h, z}, {-h, h, z} };
}

// ===========================================================================
// (1) LOFT square(4) -> square(2) over height 6 -> frustum.
//   V = h/3 (A1 + A2 + sqrt(A1 A2)) = 6/3 (16 + 4 + 8) = 56.
// ===========================================================================
static void testFrustumLoft() {
    std::printf("[1] loft square(side 4, z=0) -> square(side 2, z=6) -> frustum\n");
    LoftSection s0; s0.points = squareAt(4.0, 0.0);
    LoftSection s1; s1.points = squareAt(2.0, 6.0);

    LoftSweepResult r = loftSolid({s0, s1});
    check(r.ok, std::string("loft ok (") + r.reason + ")");
    check(r.closedManifold, "frustum is a closed 2-manifold");

    const double A1 = 16.0, A2 = 4.0, h = 6.0;
    const double expected = h / 3.0 * (A1 + A2 + std::sqrt(A1 * A2));   // 56
    check(approx(r.volume, expected, 1e-9),
          "volume == h/3 (A1+A2+sqrt(A1 A2)) == 56 (<= 1e-9)");

    std::printf("      -> V=%.12f (exp %.12f)  V=%zu E=%zu F=%zu  %s\n",
                r.volume, expected, r.vertices, r.edges, r.faces,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (2) SWEEP square(3) along straight path length 10 -> box, V == 90 EXACT.
// ===========================================================================
static void testStraightSweep() {
    std::printf("[2] sweep square(side 3, z=0) along straight path length 10 -> box\n");
    std::vector<Point3> profile = squareAt(3.0, 0.0);
    std::vector<Point3> path = { {0, 0, 0}, {0, 0, 10} };

    LoftSweepResult r = sweepSolid(profile, path);
    check(r.ok, std::string("sweep ok (") + r.reason + ")");
    check(r.closedManifold, "swept box is a closed 2-manifold");

    const double expected = 9.0 * 10.0;   // profileArea * length == 90
    check(approx(r.volume, expected, 1e-9), "volume == profileArea * length == 90 (<= 1e-9)");

    std::printf("      -> V=%.12f (exp %.12f)  V=%zu E=%zu F=%zu  %s\n",
                r.volume, expected, r.vertices, r.edges, r.faces,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (3) LOFT square -> regular octagon of the SAME area -> closed manifold (the
//     unequal-vertex-count ruled hull, 4 -> 8).
// ===========================================================================
static void testSquareOctagonLoft() {
    std::printf("[3] loft square -> equal-area regular octagon (4 -> 8 verts)\n");

    // Square area target = 36 (side 6). Regular octagon area = 2(1+sqrt2) R_e^2
    // where R_e is the EDGE-midpoint apothem... use the standard area = 2(1+sqrt2) a^2
    // with `a` the side length. Solve 2(1+sqrt2) a^2 = 36 -> a, then build the
    // octagon from its circumradius Rc = a / (2 sin(pi/8)).
    const double Asq = 36.0;
    const double a = std::sqrt(Asq / (2.0 * (1.0 + std::sqrt(2.0))));
    const double Rc = a / (2.0 * std::sin(M_PI / 8.0));

    LoftSection s0; s0.points = squareAt(6.0, 0.0);   // area 36, z=0
    LoftSection s1;                                    // octagon area 36, z=5
    for (int i = 0; i < 8; ++i) {
        double th = M_PI / 8.0 + 2.0 * M_PI * i / 8.0;  // offset so a flat-ish hull
        s1.points.push_back({Rc * std::cos(th), Rc * std::sin(th), 5.0});
    }

    LoftSweepResult r = loftSolid({s0, s1});
    check(r.ok, std::string("loft ok (") + r.reason + ")");
    check(r.closedManifold, "square->octagon hull is a closed 2-manifold");
    check(r.volume > 0.0, "positive volume");

    // The octagon area we built should be 36 (sanity on the construction).
    const double Aoct = 2.0 * (1.0 + std::sqrt(2.0)) * a * a;
    check(approx(Aoct, 36.0, 1e-9), "constructed octagon area == 36 (construction check)");

    std::printf("      -> V=%.12f  octArea=%.12f  V=%zu E=%zu F=%zu  %s\n",
                r.volume, Aoct, r.vertices, r.edges, r.faces,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

int main() {
    std::printf("=== forge::native::brep — analytic LOFT + SWEEP (ThruSections/MakePrism) gate ===\n");
    testFrustumLoft();
    testStraightSweep();
    testSquareOctagonLoft();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
