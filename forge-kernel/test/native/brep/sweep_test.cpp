// forge/native/brep/sweep_test.cpp
//
// Standalone validation gate for forge::native::brep::Sweep — the in-house
// linear sweep / extrude-along-path. Pure C++20, no test framework: a tiny
// hand-rolled harness that prints a fresh std::random_device seed, asserts the
// SPEC validations, and ends with "RESULT: P / T passed". Exits non-zero on any
// failure. NEVER weaken an assertion — the code is fixed instead.
//
// Build + run EXACTLY (module + named deps + this test only, NOT the whole tree):
//   cd /Users/account_clawteam1/archdisc-Mech && clang++ -std=c++20 -O2 -Wall \
//     -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/Sweep.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/sweep_test.cpp -o /tmp/k3_Sweep && /tmp/k3_Sweep
//
// SPEC validations asserted:
//   (1) square profile swept along a straight segment of length L == box volume
//       area*L within 1e-9 (prism identity).
//   (2) profile-with-hole keeps genus (closed 2-manifold, Euler char == that of
//       a square-with-hole tube == 0).
//   (3) multi-segment polyline path stays watertight 2-manifold.
//   (4) self-intersecting / degenerate path -> ok == false (no fake).
//   (5) non-simple profile / bad orientation -> ok == false (no fake).

#include "forge/native/brep/Sweep.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstdio>
#include <random>
#include <string>
#include <vector>

using namespace forge::native::brep;
using forge::native::geom::Point2;
using forge::native::geom::Point3;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}

static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// Build a CCW axis-aligned rectangle [0,w] x [0,h].
static std::vector<Point2> rect(double w, double h) {
    return { {0, 0}, {w, 0}, {w, h}, {0, h} };
}
// CW hole rectangle [x0,x0+w] x [y0,y0+h] (clockwise => negative area).
static std::vector<Point2> holeRect(double x0, double y0, double w, double h) {
    return { {x0, y0}, {x0, y0 + h}, {x0 + w, y0 + h}, {x0 + w, y0} };
}

int main() {
    std::random_device rd;
    const unsigned seed = rd();
    std::mt19937 rng(seed);
    std::printf("forge::native::brep::Sweep validation gate\n");
    std::printf("SEED: %u\n", seed);

    // =======================================================================
    // (1) PRISM IDENTITY: square swept straight of length L == area * L.
    // =======================================================================
    std::printf("[1] prism identity (volume == area * length)\n");
    {
        std::uniform_real_distribution<double> dW(0.3, 9.0);
        std::uniform_real_distribution<double> dL(0.3, 12.0);
        int trials = 0, ok = 0;
        double worst = 0.0;
        for (int t = 0; t < 200; ++t) {
            const double w = dW(rng), h = dW(rng), L = dL(rng);
            Profile prof; prof.outer = rect(w, h);
            const double area = signedArea(prof.outer);     // == w*h
            SweepResult r = prism(prof, L);
            ++trials;
            if (!r.ok) continue;
            const double expect = area * L;
            const double err = std::fabs(r.volume - expect);
            if (err > worst) worst = err;
            if (approx(r.volume, expect, 1e-9)) ++ok;
        }
        std::printf("    trials=%d ok=%d worstAbsErr=%.3e\n", trials, ok, worst);
        check(ok == trials, "square prism volume == area*L within 1e-9 (all trials)");

        // A concrete, fixed unit box: 2x3 swept 5 -> volume 30.
        Profile box; box.outer = rect(2.0, 3.0);
        SweepResult br = prism(box, 5.0);
        check(br.ok, "unit box prism builds");
        check(approx(br.volume, 30.0, 1e-9), "2x3x5 box volume == 30");
        check(br.solid.validate().isValid(), "box solid is watertight 2-manifold");
        check(br.eulerChar == 2, "box Euler characteristic == 2 (genus 0)");
        // surface area == 2*(2*3 + 2*5 + 3*5) = 2*(6+10+15)=62
        check(approx(br.area, 62.0, 1e-9), "2x3x5 box surface area == 62");
    }

    // =======================================================================
    // (2) PROFILE WITH HOLE keeps genus: square-with-square-hole tube is a
    //     closed 2-manifold; its Euler characteristic is 0 (genus 1 shell:
    //     a square tube is topologically a torus -> chi = 0).
    // =======================================================================
    std::printf("[2] profile-with-hole keeps genus\n");
    {
        Profile tube;
        tube.outer = rect(6.0, 6.0);
        tube.holes = { holeRect(2.0, 2.0, 2.0, 2.0) };   // 2x2 hole centred
        const double L = 4.0;
        SweepResult r = sweep(tube, { {0,0,0}, {0,0,L} });
        check(r.ok, "square-with-hole tube builds");
        if (r.ok) {
            check(r.solid.validate().isValid(), "tube is watertight 2-manifold");
            // outer 6x6 area 36, hole 2x2 area 4 -> cross-section area 32.
            // Volume of the solid (material) == 32 * L = 128.
            check(approx(r.volume, 32.0 * L, 1e-9), "tube volume == (36-4)*L == 128");
            // A tube (square annulus extruded, capped both ends) is a genus-1
            // closed surface -> Euler characteristic 0.
            check(r.eulerChar == 0, "tube Euler characteristic == 0 (genus 1)");
            std::printf("    tube V-E+F = %d, volume = %.6f\n", r.eulerChar, r.volume);
        }
    }

    // =======================================================================
    // (3) MULTI-SEGMENT polyline path stays watertight 2-manifold.
    // =======================================================================
    std::printf("[3] multi-segment polyline path watertight 2-manifold\n");
    {
        Profile prof; prof.outer = rect(1.0, 1.0);

        // An L-shaped path: along +X then +Y (90-degree miter).
        SweepResult rL = sweep(prof, { {0,0,0}, {5,0,0}, {5,5,0} });
        check(rL.ok, "L-path sweep builds");
        if (rL.ok) {
            check(rL.solid.validate().isValid(), "L-path solid watertight 2-manifold");
            check(rL.eulerChar == 2, "L-path solid genus 0 (chi==2)");
            check(rL.volume > 0.0, "L-path solid positive volume");
        }

        // A 3D zig-zag with 4 segments leaving the plane.
        SweepResult rZ = sweep(prof, {
            {0,0,0}, {3,0,0}, {3,3,0}, {3,3,3}, {6,3,3}
        });
        check(rZ.ok, "3D zig-zag (4-seg) sweep builds");
        if (rZ.ok) {
            check(rZ.solid.validate().isValid(), "zig-zag solid watertight 2-manifold");
            check(rZ.eulerChar == 2, "zig-zag solid genus 0 (chi==2)");
        }

        // Randomised gently-turning 3D paths must always stay 2-manifold.
        std::uniform_real_distribution<double> dStep(1.5, 4.0);
        std::uniform_real_distribution<double> dTurn(-0.6, 0.6); // radians, gentle
        int built = 0, manifold = 0, attempts = 0;
        for (int t = 0; t < 60; ++t) {
            std::vector<Point3> path;
            path.push_back({0,0,0});
            double dirx = 1.0, diry = 0.0;
            double px = 0, py = 0, pz = 0;
            const int segs = 3 + (static_cast<int>(rng() % 4));
            for (int s = 0; s < segs; ++s) {
                const double ang = dTurn(rng);
                const double nx = dirx * std::cos(ang) - diry * std::sin(ang);
                const double ny = dirx * std::sin(ang) + diry * std::cos(ang);
                dirx = nx; diry = ny;
                const double step = dStep(rng);
                px += dirx * step; py += diry * step;
                pz += (dTurn(rng)) * 0.3;   // gentle out-of-plane drift
                path.push_back({px, py, pz});
            }
            ++attempts;
            SweepResult r = sweep(prof, path);
            if (r.ok) {
                ++built;
                if (r.solid.validate().isValid() && r.volume > 0.0) ++manifold;
            }
        }
        std::printf("    random gentle paths: attempts=%d built=%d manifold=%d\n",
                    attempts, built, manifold);
        check(built > 0, "at least some random gentle paths build");
        check(manifold == built, "every built random path is watertight 2-manifold + positive volume");
    }

    // =======================================================================
    // (4) DEGENERATE / SELF-INTERSECTING PATH -> ok == false (no fake).
    // =======================================================================
    std::printf("[4] degenerate / self-intersecting path rejected\n");
    {
        Profile prof; prof.outer = rect(1.0, 1.0);

        // < 2 points
        check(!sweep(prof, { {0,0,0} }).ok, "single-point path rejected");
        // zero-length segment (duplicate consecutive points only) -> collapses
        check(!sweep(prof, { {0,0,0}, {0,0,0} }).ok, "duplicate-point path rejected");
        // 180-degree reversal at the joint
        check(!sweep(prof, { {0,0,0}, {5,0,0}, {0,0,0} }).ok, "180-degree reversal rejected");
        // self-intersecting path: a square loop in XY whose far segment passes
        // back through an earlier segment region.
        SweepResult rx = sweep(prof, {
            {0,0,0}, {5,0,0}, {5,5,0}, {-1,5,0}, {-1,-2,0}, {2,-2,0}, {2,2,0}
        });
        // the last segment (2,-2)->(2,2) crosses the first segment region.
        check(!rx.ok, "self-intersecting path rejected");
        // empty path
        check(!sweep(prof, {}).ok, "empty path rejected");
    }

    // =======================================================================
    // (5) NON-SIMPLE / BAD-ORIENTATION PROFILE -> ok == false (no fake).
    // =======================================================================
    std::printf("[5] non-simple / bad-orientation profile rejected\n");
    {
        // Self-intersecting "bowtie" outer loop.
        Profile bow; bow.outer = { {0,0}, {2,2}, {2,0}, {0,2} };
        check(!prism(bow, 1.0).ok, "bowtie (self-intersecting) profile rejected");

        // Outer loop given CW (negative area) instead of CCW.
        Profile cw; cw.outer = { {0,0}, {0,1}, {1,1}, {1,0} };
        check(signedArea(cw.outer) < 0.0, "CW square has negative signed area");
        check(!prism(cw, 1.0).ok, "CW outer loop rejected");

        // Hole given CCW (should be CW).
        Profile badHole;
        badHole.outer = rect(6, 6);
        badHole.holes = { { {2,2}, {4,2}, {4,4}, {2,4} } }; // CCW => invalid hole
        check(signedArea(badHole.holes[0]) > 0.0, "given hole is CCW (positive area)");
        check(!prism(badHole, 1.0).ok, "CCW hole rejected");

        // Hole not inside the outer loop.
        Profile outsideHole;
        outsideHole.outer = rect(3, 3);
        outsideHole.holes = { holeRect(5, 5, 1, 1) };
        check(!prism(outsideHole, 1.0).ok, "hole outside outer loop rejected");

        // Degenerate: fewer than 3 outer vertices.
        Profile tooFew; tooFew.outer = { {0,0}, {1,0} };
        check(!prism(tooFew, 1.0).ok, "outer loop with < 3 vertices rejected");

        // Zero / negative prism length.
        check(!prism(([]{ Profile p; p.outer = rect(1,1); return p; }()), 0.0).ok,
              "prism length 0 rejected");
        check(!prism(([]{ Profile p; p.outer = rect(1,1); return p; }()), -3.0).ok,
              "prism length < 0 rejected");
    }

    // =======================================================================
    // (6) BONUS: a non-axis-aligned triangle profile prism keeps the identity,
    //     guarding against any assumption baked into the rectangle fixtures.
    // =======================================================================
    std::printf("[6] triangle profile prism identity\n");
    {
        Profile tri; tri.outer = { {0,0}, {4,0}, {1,3} };  // CCW, area = 6
        const double area = signedArea(tri.outer);
        const double L = 7.5;
        SweepResult r = prism(tri, L);
        check(r.ok, "triangle prism builds");
        if (r.ok) {
            check(r.solid.validate().isValid(), "triangle prism watertight 2-manifold");
            check(approx(r.volume, area * L, 1e-9), "triangle prism volume == area*L");
            check(r.eulerChar == 2, "triangle prism genus 0");
        }
    }

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
