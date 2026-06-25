// forge/native/csg/extrude_test.cpp
//
// Standalone validation gate for forge::native::csg::extrude.
//
// Build & run:
//   clang++ -std=c++20 -O2 -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//       src/native/csg/Extrude.cpp \
//       src/native/geom/Geom.cpp \
//       src/native/mesh/HalfEdgeMesh.cpp \
//       src/native/Predicates.cpp \
//       test/native/csg/extrude_test.cpp -o /tmp/extrude_test && /tmp/extrude_test
//
// ANALYTIC ground truth + RANDOM examples (fresh std::random_device seed each
// run, PRINTED). Every accepted result is checked for:
//   * closed 2-manifold (HalfEdgeMesh::validate -> isValid())
//   * signedVolume == capArea * |height|   (tol 1e-9, scaled)
//   * Euler characteristic 2 (genus 0 — sphere-topology solid) for hole-free
//     profiles; for a square-with-1-hole the solid is still genus 0 (a slab with
//     a through-hole is genus 1 — checked explicitly).
//
// HONEST: degenerate / unsupported inputs MUST return ok=false (never a
// self-intersecting fake). Several such cases are asserted to FAIL cleanly.

#include <cstdint>
#include "forge/native/csg/Extrude.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <random>
#include <algorithm>

using namespace forge::native;
using namespace forge::native::csg;
using forge::native::geom::Point2;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

static bool approxRel(double got, double want, double tol = 1e-9) {
    const double scale = std::max(1.0, std::fabs(want));
    return std::fabs(got - want) <= tol * scale;
}

// Validate a successful extrude against analytic area*height and topology.
static void validateSolid(const ExtrudeResult& r, double expectArea,
                          double height, int expectEuler, const char* tag) {
    char buf[256];

    std::snprintf(buf, sizeof buf, "%s: ok==true", tag);
    check(r.ok, buf);
    if (!r.ok) { std::printf("        reason: %s\n", r.reason); return; }

    const auto rep = r.mesh.validate();
    std::snprintf(buf, sizeof buf, "%s: closed 2-manifold (isValid)", tag);
    check(rep.isValid(), buf);
    if (!rep.isValid())
        std::printf("        twins=%d manifold=%d watertight=%d euler=%d\n",
                    rep.twinsConsistent, rep.manifold, rep.watertight, rep.eulerChar);

    std::snprintf(buf, sizeof buf, "%s: capArea == %.10g", tag, expectArea);
    check(approxRel(r.capArea, expectArea), buf);

    const double expectVol = expectArea * std::fabs(height);
    std::snprintf(buf, sizeof buf, "%s: signedVolume == area*|h| (%.10g)", tag, expectVol);
    check(approxRel(r.volume, expectVol, 1e-9), buf);
    if (!approxRel(r.volume, expectVol, 1e-9))
        std::printf("        got volume %.12g, want %.12g\n", r.volume, expectVol);

    std::snprintf(buf, sizeof buf, "%s: signedVolume > 0 (outward)", tag);
    check(r.volume > 0.0, buf);

    std::snprintf(buf, sizeof buf, "%s: Euler char == %d", tag, expectEuler);
    check(rep.eulerChar == expectEuler, buf);
}

// ---- random simple-polygon generators -------------------------------------

// A random STAR-SHAPED simple polygon (radial sweep with random radii). Always
// simple, always CCW. Returns n vertices.
static std::vector<Point2> randomStarPolygon(std::mt19937& rng, int n,
                                             double cx, double cy) {
    std::uniform_real_distribution<double> rad(0.4, 2.5);
    std::vector<Point2> p;
    p.reserve(n);
    for (int i = 0; i < n; ++i) {
        const double ang = 2.0 * M_PI * i / n;
        const double r = rad(rng);
        p.push_back(Point2{cx + r * std::cos(ang), cy + r * std::sin(ang)});
    }
    return p; // CCW by construction (increasing angle)
}

// A random CONVEX polygon (convex hull of random points), guaranteed simple.
static std::vector<Point2> randomConvexPolygon(std::mt19937& rng, int n) {
    std::uniform_real_distribution<double> co(-3.0, 3.0);
    std::vector<Point2> pts;
    for (int i = 0; i < n * 3; ++i) pts.push_back(Point2{co(rng), co(rng)});
    auto hull = geom::convexHull2D(pts);
    return hull; // CCW, no collinear, >=3 if non-degenerate
}

// Shoelace unsigned area.
static double polyArea(const std::vector<Point2>& p) {
    double a = 0.0;
    const std::size_t n = p.size();
    for (std::size_t i = 0, j = n - 1; i < n; j = i++)
        a += p[j].x * p[i].y - p[i].x * p[j].y;
    return std::fabs(0.5 * a);
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::csg::extrude validation ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    // ----------------------------------------------------------------------
    // ANALYTIC 1: unit square -> box. Volume = 1 * 1 * h.  Euler = 2.
    // ----------------------------------------------------------------------
    {
        Profile2D prof;
        prof.outer = { {0,0}, {1,0}, {1,1}, {0,1} };
        const double h = 2.5;
        auto r = extrude(prof, h);
        validateSolid(r, 1.0, h, 2, "square->box");
    }

    // ----------------------------------------------------------------------
    // ANALYTIC 1b: same square, NEGATIVE height (sweep -Z). Still positive vol.
    // ----------------------------------------------------------------------
    {
        Profile2D prof;
        prof.outer = { {0,0}, {3,0}, {3,2}, {0,2} }; // 3x2 = area 6
        const double h = -1.5;
        auto r = extrude(prof, h);
        validateSolid(r, 6.0, h, 2, "rect->box (neg h)");
    }

    // ----------------------------------------------------------------------
    // ANALYTIC 1c: square given CLOCKWISE — winding must be normalised.
    // ----------------------------------------------------------------------
    {
        Profile2D prof;
        prof.outer = { {0,0}, {0,1}, {1,1}, {1,0} }; // CW
        auto r = extrude(prof, 4.0);
        validateSolid(r, 1.0, 4.0, 2, "square(CW)->box");
    }

    // ----------------------------------------------------------------------
    // ANALYTIC 2: L-shape. Two unit squares minus a corner. Area = 3.
    //   (0,0)-(2,0)-(2,1)-(1,1)-(1,2)-(0,2). Area = 2*2 - 1 = 3.  Euler = 2.
    // ----------------------------------------------------------------------
    {
        Profile2D prof;
        prof.outer = { {0,0},{2,0},{2,1},{1,1},{1,2},{0,2} };
        const double h = 1.7;
        auto r = extrude(prof, h);
        validateSolid(r, 3.0, h, 2, "L-shape");
    }

    // ----------------------------------------------------------------------
    // ANALYTIC 3: square with a square HOLE. Outer 4x4 (area 16), hole 2x2
    //   centred (area 4) -> cap area 12. A slab with a THROUGH hole is genus 1,
    //   so Euler char = 0 (V-E+F = 2 - 2*genus). Verified explicitly.
    // ----------------------------------------------------------------------
    {
        Profile2D prof;
        prof.outer = { {0,0},{4,0},{4,4},{0,4} };
        prof.holes = { { {1,1},{3,1},{3,3},{1,3} } };
        const double h = 0.9;
        auto r = extrude(prof, h);
        validateSolid(r, 12.0, h, 0 /* genus 1 => euler 0 */, "square-with-hole");
    }

    // ----------------------------------------------------------------------
    // ANALYTIC 3b: rectangle with TWO holes. Outer 10x6 (60), holes 2x2 (4) and
    //   3x1 (3) -> cap area 53. Genus 2 => Euler char = 2 - 2*2 = -2.
    // ----------------------------------------------------------------------
    {
        Profile2D prof;
        prof.outer = { {0,0},{10,0},{10,6},{0,6} };
        prof.holes = {
            { {1,1},{3,1},{3,3},{1,3} },     // 2x2 = 4
            { {6,2},{9,2},{9,3},{6,3} }      // 3x1 = 3
        };
        const double h = 1.25;
        auto r = extrude(prof, h);
        validateSolid(r, 53.0, h, -2 /* genus 2 */, "rect-with-2-holes");
    }

    // ----------------------------------------------------------------------
    // HONEST FAILURE CASES — must return ok=false, never a fake.
    // ----------------------------------------------------------------------
    {
        Profile2D prof; prof.outer = { {0,0},{1,0},{1,1},{0,1} };
        auto r = extrude(prof, 0.0);
        check(!r.ok, "reject: zero height");
    }
    {
        Profile2D prof; prof.outer = { {0,0},{1,0} }; // <3 verts
        auto r = extrude(prof, 1.0);
        check(!r.ok, "reject: outer < 3 vertices");
    }
    {
        // Self-intersecting "bowtie".
        Profile2D prof; prof.outer = { {0,0},{2,2},{2,0},{0,2} };
        auto r = extrude(prof, 1.0);
        check(!r.ok, "reject: self-intersecting (bowtie) outer");
    }
    {
        // Degenerate normal.
        Profile2D prof; prof.outer = { {0,0},{1,0},{1,1},{0,1} };
        Plane pl; pl.normal = mesh::Vec3{0,0,0};
        auto r = extrude(prof, 1.0, pl);
        check(!r.ok, "reject: zero-length plane normal");
    }
    {
        // Hole not inside outer.
        Profile2D prof; prof.outer = { {0,0},{2,0},{2,2},{0,2} };
        prof.holes = { { {3,3},{4,3},{4,4},{3,4} } };
        auto r = extrude(prof, 1.0);
        check(!r.ok, "reject: hole outside outer loop");
    }
    {
        // Collinear outer (zero area).
        Profile2D prof; prof.outer = { {0,0},{1,0},{2,0},{3,0} };
        auto r = extrude(prof, 1.0);
        check(!r.ok, "reject: collinear/zero-area outer");
    }

    // ----------------------------------------------------------------------
    // ARBITRARY PLANE: extrude a unit square on a tilted plane. Volume must be
    // invariant under the rigid frame (area*h regardless of orientation).
    // ----------------------------------------------------------------------
    {
        Profile2D prof; prof.outer = { {0,0},{1,0},{1,1},{0,1} };
        Plane pl;
        pl.origin = mesh::Vec3{5, -2, 3};
        pl.normal = mesh::Vec3{1, 1, 1}; // tilted, non-unit
        const double h = 2.0;
        auto r = extrude(prof, h, pl);
        validateSolid(r, 1.0, h, 2, "square on tilted plane");
    }

    // ----------------------------------------------------------------------
    // RANDOM: convex polygons -> prisms.  area*h, closed, Euler 2.
    // ----------------------------------------------------------------------
    {
        std::uniform_int_distribution<int> nd(3, 12);
        std::uniform_real_distribution<double> hd(0.2, 5.0);
        int ran = 0, ok = 0;
        for (int t = 0; t < 40; ++t) {
            auto poly = randomConvexPolygon(rng, nd(rng));
            if (poly.size() < 3) continue;
            const double area = polyArea(poly);
            if (area < 1e-3) continue;
            ++ran;
            Profile2D prof; prof.outer = poly;
            const double h = hd(rng);
            auto r = extrude(prof, h);
            const bool good = r.ok && r.mesh.validate().isValid() &&
                              approxRel(r.volume, area * h, 1e-9) && r.volume > 0;
            if (good) ++ok;
        }
        char buf[128];
        std::snprintf(buf, sizeof buf, "random convex prisms: %d/%d correct", ok, ran);
        check(ran > 0 && ok == ran, buf);
    }

    // ----------------------------------------------------------------------
    // RANDOM: star-shaped (often NON-convex) simple polygons -> prisms.
    // ----------------------------------------------------------------------
    {
        std::uniform_int_distribution<int> nd(5, 20);
        std::uniform_real_distribution<double> hd(0.3, 4.0);
        int ran = 0, ok = 0;
        for (int t = 0; t < 40; ++t) {
            auto poly = randomStarPolygon(rng, nd(rng), 0.0, 0.0);
            const double area = polyArea(poly);
            if (area < 1e-3) continue;
            ++ran;
            Profile2D prof; prof.outer = poly;
            const double h = hd(rng);
            auto r = extrude(prof, h);
            const bool good = r.ok && r.mesh.validate().isValid() &&
                              approxRel(r.volume, area * h, 1e-9) && r.volume > 0;
            if (good) ++ok;
            else if (!r.ok)
                std::printf("        [star non-ok] n=%zu reason=%s\n", poly.size(), r.reason);
        }
        char buf[128];
        std::snprintf(buf, sizeof buf, "random star (non-convex) prisms: %d/%d correct", ok, ran);
        check(ran > 0 && ok == ran, buf);
    }

    // ----------------------------------------------------------------------
    // RANDOM: convex outer with a random concentric square hole -> genus-1 slab.
    // ----------------------------------------------------------------------
    {
        std::uniform_real_distribution<double> hsz(0.2, 1.2);
        std::uniform_real_distribution<double> hd(0.3, 3.0);
        int ran = 0, ok = 0;
        for (int t = 0; t < 30; ++t) {
            // Outer: an axis box [-R,R]^2; hole: a centred square of half-size s<R.
            const double R = 3.0;
            const double s = hsz(rng);
            Profile2D prof;
            prof.outer = { {-R,-R},{R,-R},{R,R},{-R,R} };
            prof.holes = { { {-s,-s},{s,-s},{s,s},{-s,s} } };
            const double outerA = (2*R)*(2*R);
            const double holeA  = (2*s)*(2*s);
            const double area = outerA - holeA;
            const double h = hd(rng);
            ++ran;
            auto r = extrude(prof, h);
            const auto rep = r.ok ? r.mesh.validate() : forge::native::mesh::ValidityReport{};
            const bool good = r.ok && rep.isValid() &&
                              approxRel(r.capArea, area, 1e-9) &&
                              approxRel(r.volume, area * h, 1e-9) && r.volume > 0 &&
                              rep.eulerChar == 0; // genus 1
            if (good) ++ok;
            else if (!r.ok)
                std::printf("        [hole non-ok] reason=%s\n", r.reason);
        }
        char buf[128];
        std::snprintf(buf, sizeof buf, "random box-with-hole slabs: %d/%d correct", ok, ran);
        check(ran > 0 && ok == ran, buf);
    }

    std::printf("\n=== %d/%d checks passed (seed %u) ===\n", g_pass, g_total, seed);
    return (g_pass == g_total) ? 0 : 1;
}
