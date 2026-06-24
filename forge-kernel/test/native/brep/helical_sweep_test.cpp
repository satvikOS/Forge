// forge/native/brep/helical_sweep_test.cpp
//
// Standalone validation gate for the ANALYTIC HELICAL SWEEP increment
// (HelicalSweep.hpp / HelicalSweep.cpp) — the in-house brep::Solid replacement for
// OCCT BRepOffsetAPI_MakePipe(helixWire, profileWire): sweep a CIRCULAR profile
// along a constant-pitch HELIX into a closed coiled-tube solid (a spring). Pure
// C++20, NO external dependencies, NO OCCT, NO WASM, no test framework — a tiny
// hand-rolled harness that prints PASS/FAIL and exits non-zero on any failure
// (mirrors loftsweep_test.cpp / shell_solid_test.cpp / sew_test.cpp).
//
// Build + run (SINGLE clang invocation; compiles the brep object set it links):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/HelicalSweep.cpp \
//     forge-kernel/src/native/brep/Primitives.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/MassProps.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/test/native/brep/helical_sweep_test.cpp \
//     -o /tmp/helical_sweep_test && /tmp/helical_sweep_test
//
// GATES (a spring: profile r=0.5, coil R=3, pitch p=2, N=4 turns about +z):
//   (1) The assembled coiled tube is a CLOSED 2-MANIFOLD (watertight).
//   (2) helixArcLength == N*sqrt((2 pi R)^2 + p^2)  (closed-form, exact).
//   (3) The faceted volume CONVERGES to the Pappus value V = pi r^2 * arcLength as
//       the path discretisation M grows; at the converged M the relative error is
//       <= 1e-3 (discretization-limited — reported with the convergence table).
//   (4) A second, DISTINCT spring (different r/R/p/N) also closes + matches Pappus
//       to <= 1e-3 (no cherry-picking a single tuned case).

#include <algorithm>
#include "forge/native/brep/HelicalSweep.hpp"

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

// Run one helical sweep and print its literal signature.
static HelicalSweepResult runSpring(double r, double R, double p, double N,
                                    std::size_t stepsPerTurn, std::size_t profileSegs) {
    HelixSpec spec;
    spec.profileRadius   = r;
    spec.coilRadius      = R;
    spec.pitch           = p;
    spec.turns           = N;
    spec.stepsPerTurn    = stepsPerTurn;
    spec.profileSegments = profileSegs;
    return helicalSweep(spec);
}

// ===========================================================================
// (1)+(2)+(3) The canonical spring: r=0.5, R=3, p=2, N=4, with a CONVERGENCE
// table as the path discretisation M (= N*stepsPerTurn) grows.
// ===========================================================================
static void testCanonicalSpring() {
    const double r = 0.5, R = 3.0, p = 2.0, N = 4.0;
    std::printf("[1] spring profile r=%.3f, coil R=%.3f, pitch p=%.3f, N=%.1f turns (+z)\n",
                r, R, p, N);

    // Closed-form references.
    const double arc = helixArcLength(R, p, N);
    const double pappus = M_PI * r * r * arc;
    const double arcCheck = N * std::sqrt(std::pow(2.0 * M_PI * R, 2) + p * p);
    std::printf("      arcLength = N*sqrt((2 pi R)^2 + p^2) = %.12f\n", arc);
    std::printf("      Pappus V  = pi r^2 * arcLength      = %.12f\n", pappus);
    check(approx(arc, arcCheck, 1e-12), "helixArcLength == N*sqrt((2 pi R)^2 + p^2) (exact)");

    // Convergence sweep over path stations/turn (section fixed dense at 96).
    std::printf("      CONVERGENCE (profileSegments=96 fixed):\n");
    std::printf("        %-10s %-8s %-20s %-20s %-12s\n",
                "steps/turn", "M", "volume", "abs.err", "rel.err");
    const std::size_t sptList[] = {16, 32, 64, 128, 256};
    HelicalSweepResult best;
    for (std::size_t spt : sptList) {
        HelicalSweepResult res = runSpring(r, R, p, N, spt, 96);
        if (!res.ok) {
            std::printf("        spt=%zu FAILED: %s\n", spt, res.reason);
            continue;
        }
        const std::size_t M = res.vertices ? (res.vertices / 96) - 1 : 0; // M+1 stations * 96
        const double absErr = std::fabs(res.volume - pappus);
        const double relErr = absErr / pappus;
        std::printf("        %-10zu %-8zu %-20.12f %-20.3e %-12.3e\n",
                    spt, M, res.volume, absErr, relErr);
        best = res;  // keep the finest
    }

    check(best.ok, std::string("finest spring ok (") + best.reason + ")");
    check(best.closedManifold, "coiled tube is a closed 2-manifold (watertight)");
    check(best.volume > 0.0, "positive volume");

    const double relErr = std::fabs(best.volume - pappus) / pappus;
    check(relErr <= 1e-3, "finest faceted volume matches Pappus to rel <= 1e-3");

    std::printf("      -> FINEST: V=%.12f (Pappus %.12f, rel %.3e)\n",
                best.volume, pappus, relErr);
    std::printf("                 area=%.6f  V=%zu E=%zu F=%zu  %s\n",
                best.area, best.vertices, best.edges, best.faces,
                best.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (4) A DISTINCT second spring (fine wire, tight coil, fractional turns) — no
// cherry-picking. r=0.25, R=1.5, p=1.0, N=6.5 turns.
// ===========================================================================
static void testSecondSpring() {
    const double r = 0.25, R = 1.5, p = 1.0, N = 6.5;
    std::printf("[2] DISTINCT spring r=%.3f, coil R=%.3f, pitch p=%.3f, N=%.1f turns\n",
                r, R, p, N);

    HelicalSweepResult res = runSpring(r, R, p, N, 256, 96);
    check(res.ok, std::string("second spring ok (") + res.reason + ")");
    check(res.closedManifold, "second coiled tube is a closed 2-manifold");

    const double arc = helixArcLength(R, p, N);
    const double pappus = M_PI * r * r * arc;
    const double relErr = res.ok ? std::fabs(res.volume - pappus) / pappus : 1.0;
    check(relErr <= 1e-3, "second spring volume matches Pappus to rel <= 1e-3");

    std::printf("      arcLength=%.12f  Pappus=%.12f\n", arc, pappus);
    std::printf("      -> V=%.12f (rel %.3e)  area=%.6f  V=%zu E=%zu F=%zu  %s\n",
                res.volume, relErr, res.area, res.vertices, res.edges, res.faces,
                res.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (5) Honest refusal: a self-intersecting wire (pitch <= 2r) must be rejected.
// ===========================================================================
static void testSelfIntersectRefusal() {
    std::printf("[3] honest refusal: pitch <= 2*profileRadius (self-intersecting wire)\n");
    HelicalSweepResult res = runSpring(/*r*/0.6, /*R*/3.0, /*p*/1.0, /*N*/2.0, 64, 32);
    check(!res.ok, "self-intersecting wire (p=1.0 < 2r=1.2) refused (ok=false)");
    std::printf("      -> reason: %s\n", res.reason);
}

int main() {
    std::printf("=== forge::native::brep — analytic HELICAL SWEEP (MakePipe coil/spring) gate ===\n");
    testCanonicalSpring();
    testSecondSpring();
    testSelfIntersectRefusal();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
