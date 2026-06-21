// forge/native/geom/constraineddelaunay2d_test.cpp
//
// Standalone validation gate for forge::native::geom::constrainedDelaunay2D.
//
// Build & run (exactly the command the task prescribes):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/ConstrainedDelaunay2D.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/constraineddelaunay2d_test.cpp \
//       -o /tmp/k6_ConstrainedDelaunay2D && /tmp/k6_ConstrainedDelaunay2D
//
// Covers the SPEC validations:
//   (a) Triangulating a simple polygon WITH HOLES yields triangles covering
//       exactly the polygon interior: sum of inside-triangle areas == polygon
//       area within 1e-9 (the polygon area is computed independently by the exact
//       shoelace on the boundary loops).
//   (b) Every constraint edge is present as a triangulation edge.
//   (c) The empty-circumcircle (constrained-Delaunay) property holds for every
//       non-constrained edge.
//   (d) Self-intersecting constraints -> ok=false HONESTLY.
//   (e) Degenerate / out-of-range / unsupported inputs -> ok=false HONESTLY.
//   (f) With NO constraints the result equals an ordinary Delaunay triangulation
//       of the convex hull (all inside; constrained-Delaunay == Delaunay).
//
// A fresh std::random_device seed is printed so any failure is reproducible.

#include "forge/native/geom/ConstrainedDelaunay2D.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <random>
#include <unordered_map>
#include <utility>
#include <vector>

using namespace forge::native;
using namespace forge::native::geom;

// Edge-manifold validity: a planar triangulation with NO overlapping and NO
// inverted (flipped) triangles has every triangle CCW, every undirected edge
// used at most twice, and every DIRECTED edge used at most once. Two overlapping
// CCW triangles would reuse a directed edge or push an undirected edge past 2.
// Decided with the EXACT orient2d predicate.
static bool isValidMesh(const CDTResult& r) {
    const auto& P = r.points;
    for (const auto& t : r.triangles) {
        if (orient2d(P[t[0]].x, P[t[0]].y, P[t[1]].x, P[t[1]].y,
                     P[t[2]].x, P[t[2]].y) != Sign::POSITIVE)
            return false;  // inverted / degenerate
    }
    std::unordered_map<std::uint64_t, int> und, dir;
    auto uk = [](int u, int v) {
        if (u > v) std::swap(u, v);
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(u)) << 32) |
                static_cast<std::uint64_t>(static_cast<std::uint32_t>(v));
    };
    auto dk = [](int u, int v) {
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(u)) << 32) |
                static_cast<std::uint64_t>(static_cast<std::uint32_t>(v));
    };
    for (const auto& t : r.triangles) {
        int e[3][2] = {{t[0], t[1]}, {t[1], t[2]}, {t[2], t[0]}};
        for (auto& ed : e) {
            if (++und[uk(ed[0], ed[1])] > 2) return false;
            if (++dir[dk(ed[0], ed[1])] > 1) return false;
        }
    }
    return true;
}

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

// Independent exact-shoelace area of a CCW polygon loop given by point indices.
static double loopAreaSigned(const std::vector<Point2>& pts,
                             const std::vector<int>& loop) {
    double a = 0.0;
    for (std::size_t i = 0; i < loop.size(); ++i) {
        const Point2& p = pts[loop[i]];
        const Point2& q = pts[loop[(i + 1) % loop.size()]];
        a += p.x * q.y - q.x * p.y;
    }
    return 0.5 * a;
}

// Build constraint edges for a loop of consecutive indices.
static void addLoopConstraints(std::vector<ConstraintEdge>& cons,
                               const std::vector<int>& loop) {
    for (std::size_t i = 0; i < loop.size(); ++i)
        cons.push_back(ConstraintEdge{loop[i], loop[(i + 1) % loop.size()]});
}

// ===========================================================================
// (f) No constraints: must equal a Delaunay triangulation of the convex hull.
// ===========================================================================
static void test_no_constraints(std::mt19937_64& rng) {
    std::printf("[no constraints: plain Delaunay over convex hull]\n");
    std::uniform_real_distribution<double> U(-100.0, 100.0);
    int okAll = 0, trials = 12;
    for (int t = 0; t < trials; ++t) {
        int N = 8 + static_cast<int>(rng() % 40);
        std::vector<Point2> pts;
        for (int i = 0; i < N; ++i) pts.push_back(Point2{U(rng), U(rng)});
        CDTResult R = constrainedDelaunay2D(pts, {});
        if (!R.ok) continue;
        bool del = isConstrainedDelaunay(R);     // == Delaunay (no constraints)
        bool valid = isValidMesh(R);             // no overlap / no inversion
        bool allIn = true;
        for (char c : R.inside) if (!c) { allIn = false; break; }
        // inside area == total area (whole hull is inside).
        bool areaEq = std::fabs(insideArea(R) - totalArea(R)) < 1e-9;
        if (del && valid && allIn && areaEq && R.closedLoops) ++okAll;
    }
    check(okAll == trials, "no-constraint: Delaunay + valid + all-inside + area on all trials");
}

// ===========================================================================
// (a)(b)(c) Simple polygon WITH HOLES.
// ===========================================================================
static void test_polygon_with_hole() {
    std::printf("[polygon with a square hole]\n");
    // Outer square [0,10]^2 (CCW), inner hole [3,7]^2 (the hole loop is given
    // CW so its even-odd parity removes it).
    std::vector<Point2> pts = {
        {0,0}, {10,0}, {10,10}, {0,10},          // 0..3 outer (CCW)
        {3,3}, {7,3}, {7,7}, {3,7}                // 4..7 inner
    };
    std::vector<int> outer = {0, 1, 2, 3};
    std::vector<int> innerCW = {4, 7, 6, 5};      // CW so area is negative

    std::vector<ConstraintEdge> cons;
    addLoopConstraints(cons, outer);
    addLoopConstraints(cons, innerCW);

    CDTResult R = constrainedDelaunay2D(pts, cons);
    check(R.ok, "poly+hole: ok");
    if (!R.ok) { std::printf("    reason: %s\n", R.reason); return; }

    check(R.closedLoops, "poly+hole: constraint loops are closed");
    check(allConstraintsPresent(R), "poly+hole: every constraint edge present");
    check(isConstrainedDelaunay(R), "poly+hole: constrained-Delaunay (empty circle off-constraint)");
    check(isValidMesh(R), "poly+hole: valid mesh (no overlap / no inversion)");

    // Independent expected interior area = outer area - hole area.
    double outerArea = std::fabs(loopAreaSigned(pts, outer));     // 100
    std::vector<int> innerCCW = {4, 5, 6, 7};
    double holeArea = std::fabs(loopAreaSigned(pts, innerCCW));   // 16
    double expect = outerArea - holeArea;                        // 84
    double got = insideArea(R);
    std::printf("    inside area=%.12f expected=%.12f\n", got, expect);
    check(std::fabs(got - expect) < 1e-9, "poly+hole: inside area == polygon-minus-hole within 1e-9");
}

// ===========================================================================
// (a) Non-convex (L-shaped) polygon, no hole — constrained edges create a
//     concavity an unconstrained DT would never respect.
// ===========================================================================
static void test_L_shape() {
    std::printf("[non-convex L-shaped polygon]\n");
    // L-shape (CCW): area = full 4x4 minus the 2x2 notch = 16 - 4 = 12.
    std::vector<Point2> pts = {
        {0,0}, {4,0}, {4,2}, {2,2}, {2,4}, {0,4}
    };
    std::vector<int> loop = {0, 1, 2, 3, 4, 5};
    std::vector<ConstraintEdge> cons;
    addLoopConstraints(cons, loop);

    CDTResult R = constrainedDelaunay2D(pts, cons);
    check(R.ok, "L-shape: ok");
    if (!R.ok) { std::printf("    reason: %s\n", R.reason); return; }
    check(allConstraintsPresent(R), "L-shape: every boundary edge present");
    check(isConstrainedDelaunay(R), "L-shape: constrained-Delaunay");
    check(isValidMesh(R), "L-shape: valid mesh (no overlap / no inversion)");
    double expect = std::fabs(loopAreaSigned(pts, loop));   // 12
    double got = insideArea(R);
    std::printf("    inside area=%.12f expected=%.12f\n", got, expect);
    check(std::fabs(got - expect) < 1e-9, "L-shape: inside area == polygon area within 1e-9");
}

// ===========================================================================
// (a)(b)(c) RANDOM convex polygon + interior points + a forced long diagonal.
//   The interior points are NOT on the boundary; the forced diagonal is an edge
//   the unconstrained DT would not necessarily contain, so it stresses strip
//   insertion. The whole convex polygon is the interior region.
// ===========================================================================
static void test_random_convex_with_diagonal(std::mt19937_64& rng) {
    std::printf("[regular convex polygon + interior points + forced diagonal]\n");
    int okAll = 0, trials = 20;
    std::uniform_real_distribution<double> Ang(0.0, 1.0);
    std::uniform_real_distribution<double> Rad(0.0, 1.0);
    for (int t = 0; t < trials; ++t) {
        // REGULAR convex polygon (radius 10) so its convex hull is exactly the
        // K-gon and a chord between corners stays strictly inside. Interior points
        // are placed at radius < the polygon's inradius (= 10*cos(pi/K)) so the
        // convex hull equals the polygon and `totalArea` == the K-gon area.
        int K = 6 + static_cast<int>(rng() % 8);    // 6..13 corners
        const double inradius = 10.0 * std::cos(M_PI / K);
        std::vector<Point2> pts;
        std::vector<int> loop;
        for (int i = 0; i < K; ++i) {
            double a = 2.0 * M_PI * i / K;
            pts.push_back(Point2{10.0 * std::cos(a), 10.0 * std::sin(a)});
            loop.push_back(i);
        }
        // Forced diagonal: opposite-ish corners (chord well inside the polygon).
        int vDiagB = K / 2;
        // Interior points strictly inside, kept clear of the diagonal chord so we
        // never land an input vertex exactly on the constraint (that case is the
        // honest "unsupported PSLG" — exercised separately).
        int interior = 3 + static_cast<int>(rng() % 5);
        for (int i = 0; i < interior; ++i) {
            double a = 2.0 * M_PI * Ang(rng);
            double r = 0.85 * inradius * std::sqrt(Rad(rng));  // uniform-ish, inside
            Point2 p{r * std::cos(a), r * std::sin(a)};
            // Skip points that are (near) collinear with the diagonal 0->vDiagB so
            // the constraint never passes exactly through an interior vertex.
            if (orient2d(pts[0].x, pts[0].y, pts[vDiagB].x, pts[vDiagB].y, p.x, p.y)
                    == Sign::ZERO) { --i; continue; }
            pts.push_back(p);
        }
        std::vector<ConstraintEdge> cons;
        addLoopConstraints(cons, loop);
        // Interior constraint (not part of a closed loop): stresses strip
        // insertion AND makes even-odd parity non-meaningful — the kernel must
        // honestly report closedLoops == false.
        cons.push_back(ConstraintEdge{0, vDiagB});

        CDTResult R = constrainedDelaunay2D(pts, cons);
        if (!R.ok) { std::printf("    trial %d reason: %s\n", t, R.reason); continue; }
        bool pres = allConstraintsPresent(R);   // diagonal + boundary all present
        bool del = isConstrainedDelaunay(R);    // empty-circle off constraints
        // The WHOLE convex polygon (hull) is triangulated; total area == K-gon
        // area regardless of the interior diagonal. (insideArea is NOT the polygon
        // area here because the bisecting interior constraint flips even-odd
        // parity — and the kernel honestly reports that via closedLoops == false.)
        double expect = std::fabs(loopAreaSigned(pts, loop));
        bool areaOK = std::fabs(totalArea(R) - expect) < 1e-9;
        bool valid = isValidMesh(R);                  // no overlap / no inversion
        bool loopsHonest = (R.closedLoops == false);  // interior chord => open
        if (pres && del && valid && areaOK && loopsHonest) ++okAll;
        else std::printf("    trial %d: pres=%d del=%d valid=%d areaOK=%d loopsHonest=%d (tot=%.9f exp=%.9f)\n",
                         t, pres, del, valid, areaOK, loopsHonest, totalArea(R), expect);
    }
    check(okAll == trials, "regular convex+diagonal: present + cDelaunay + valid + total-area + honest-loops");
}

// ===========================================================================
// (a) Star (non-convex, reflex vertices) polygon, no holes.
// ===========================================================================
static void test_star_polygon() {
    std::printf("[non-convex star polygon (reflex vertices)]\n");
    std::vector<Point2> pts;
    std::vector<int> loop;
    const int spikes = 5;
    for (int i = 0; i < spikes * 2; ++i) {
        double a = M_PI / 2.0 + M_PI * i / spikes;  // alternate
        double r = (i % 2 == 0) ? 10.0 : 4.0;
        pts.push_back(Point2{r * std::cos(a), r * std::sin(a)});
        loop.push_back(i);
    }
    std::vector<ConstraintEdge> cons;
    addLoopConstraints(cons, loop);
    CDTResult R = constrainedDelaunay2D(pts, cons);
    check(R.ok, "star: ok");
    if (!R.ok) { std::printf("    reason: %s\n", R.reason); return; }
    check(allConstraintsPresent(R), "star: every boundary edge present");
    check(isConstrainedDelaunay(R), "star: constrained-Delaunay");
    check(isValidMesh(R), "star: valid mesh (no overlap / no inversion)");
    double expect = std::fabs(loopAreaSigned(pts, loop));
    double got = insideArea(R);
    std::printf("    inside area=%.12f expected=%.12f\n", got, expect);
    check(std::fabs(got - expect) < 1e-9, "star: inside area == polygon area within 1e-9");
}

// ===========================================================================
// (a)(b)(c) RANDOMIZED rectangle with several non-overlapping square holes —
//   different layout EVERY run (seed-driven). This is the central SPEC gate:
//   the inside triangles tile EXACTLY the polygon-minus-holes area to 1e-9, the
//   exact-arithmetic constraint edges are all present, the off-constraint edges
//   are empty-circle, and the mesh has no overlaps / inversions.
// ===========================================================================
static void test_random_rect_with_holes(std::mt19937_64& rng) {
    std::printf("[randomized rectangle with non-overlapping square holes]\n");
    const int trials = 25;
    int okAll = 0;
    for (int t = 0; t < trials; ++t) {
        // Outer rectangle [0,W]x[0,H].
        double W = 20.0 + (rng() % 1000) / 50.0;   // 20..40
        double H = 20.0 + (rng() % 1000) / 50.0;
        std::vector<Point2> pts = {{0,0}, {W,0}, {W,H}, {0,H}};
        std::vector<int> outer = {0, 1, 2, 3};
        std::vector<ConstraintEdge> cons;
        addLoopConstraints(cons, outer);

        // Place a few axis-aligned square holes on a coarse grid so they never
        // overlap and stay strictly inside (margins keep them off the boundary).
        int holes = 1 + static_cast<int>(rng() % 4);
        double holeArea = 0.0;
        int placed = 0;
        for (int h = 0; h < holes; ++h) {
            double s = 1.5 + (rng() % 100) / 50.0;       // side 1.5..3.5
            // grid cell to avoid overlap: divide interior into a 4x4 grid.
            int gx = static_cast<int>(rng() % 4);
            int gy = static_cast<int>(rng() % 4);
            double cellW = (W - 4.0) / 4.0, cellH = (H - 4.0) / 4.0;
            if (cellW <= s + 0.5 || cellH <= s + 0.5) continue;
            double x0 = 2.0 + gx * cellW + 0.25 * cellW;
            double y0 = 2.0 + gy * cellH + 0.25 * cellH;
            // Reject if this grid cell was used (simple dedup by corner identity).
            bool dup = false;
            for (const auto& p : pts)
                if (std::fabs(p.x - x0) < 1e-9 && std::fabs(p.y - y0) < 1e-9) dup = true;
            if (dup) continue;
            int base = static_cast<int>(pts.size());
            pts.push_back(Point2{x0,     y0});
            pts.push_back(Point2{x0 + s, y0});
            pts.push_back(Point2{x0 + s, y0 + s});
            pts.push_back(Point2{x0,     y0 + s});
            // Hole loop given CW so even-odd parity removes it.
            cons.push_back(ConstraintEdge{base + 0, base + 3});
            cons.push_back(ConstraintEdge{base + 3, base + 2});
            cons.push_back(ConstraintEdge{base + 2, base + 1});
            cons.push_back(ConstraintEdge{base + 1, base + 0});
            holeArea += s * s;
            ++placed;
        }

        CDTResult R = constrainedDelaunay2D(pts, cons);
        if (!R.ok) { std::printf("    trial %d reason: %s\n", t, R.reason); continue; }
        bool pres = allConstraintsPresent(R);
        bool del = isConstrainedDelaunay(R);
        bool valid = isValidMesh(R);
        bool closed = R.closedLoops;
        double expect = W * H - holeArea;
        double got = insideArea(R);
        bool areaOK = std::fabs(got - expect) < 1e-9;
        if (pres && del && valid && closed && areaOK) ++okAll;
        else std::printf("    trial %d: holes=%d pres=%d del=%d valid=%d closed=%d area %.9f/%.9f\n",
                         t, placed, pres, del, valid, closed, got, expect);
    }
    check(okAll == trials,
          "random rect+holes: present + cDelaunay + valid + closed + exact area (all trials)");
}

// ===========================================================================
// (d) Self-intersecting constraints must report ok=false.
// ===========================================================================
static void test_self_intersecting() {
    std::printf("[self-intersecting constraints -> ok=false]\n");
    // Two crossing diagonals of a square: (0,2) and (1,3) cross at the centre.
    std::vector<Point2> pts = {{0,0},{2,0},{2,2},{0,2}};
    std::vector<ConstraintEdge> cons = {{0,2},{1,3}};
    CDTResult R = constrainedDelaunay2D(pts, cons);
    check(!R.ok, "crossing diagonals: ok==false");
    std::printf("    reason: %s\n", R.reason);

    // Collinear overlapping constraints: (0->2) and (1->3) on the same line.
    std::vector<Point2> pts2 = {{0,0},{1,0},{2,0},{3,0},{1,2}};
    std::vector<ConstraintEdge> cons2 = {{0,2},{1,3}};
    CDTResult R2 = constrainedDelaunay2D(pts2, cons2);
    check(!R2.ok, "collinear overlap: ok==false");
    std::printf("    reason: %s\n", R2.reason);
}

// ===========================================================================
// (e) Degenerate / out-of-range inputs report honestly.
// ===========================================================================
static void test_degenerate_inputs() {
    std::printf("[degenerate / invalid inputs -> ok=false]\n");

    CDTResult e0 = constrainedDelaunay2D({}, {});
    check(!e0.ok, "empty input: ok==false");

    CDTResult e1 = constrainedDelaunay2D({{0,0},{1,1}}, {});
    check(!e1.ok, "two points: ok==false");

    CDTResult col = constrainedDelaunay2D({{0,0},{1,1},{2,2},{3,3}}, {});
    check(!col.ok, "all-collinear: ok==false");

    // Out-of-range constraint endpoint.
    CDTResult oor = constrainedDelaunay2D({{0,0},{1,0},{0,1}}, {{0, 9}});
    check(!oor.ok, "out-of-range constraint endpoint: ok==false");

    // Degenerate (zero-length) constraint via duplicate point that collapses.
    CDTResult dz = constrainedDelaunay2D({{0,0},{1,0},{0,1},{0,0}}, {{0, 3}});
    check(!dz.ok, "zero-length constraint (dup endpoints): ok==false");
}

// ===========================================================================
// Determinism: same seed => identical triangle list.
// ===========================================================================
static void test_determinism() {
    std::printf("[determinism: same seed => identical mesh]\n");
    std::vector<Point2> pts = {
        {0,0}, {10,0}, {10,10}, {0,10}, {3,3}, {7,3}, {7,7}, {3,7}
    };
    std::vector<ConstraintEdge> cons;
    addLoopConstraints(cons, std::vector<int>{0,1,2,3});
    addLoopConstraints(cons, std::vector<int>{4,7,6,5});
    CDTResult a = constrainedDelaunay2D(pts, cons, 0xABCDEF1234567890ull);
    CDTResult b = constrainedDelaunay2D(pts, cons, 0xABCDEF1234567890ull);
    bool same = a.ok && b.ok && a.triangles.size() == b.triangles.size();
    for (std::size_t i = 0; same && i < a.triangles.size(); ++i)
        same = (a.triangles[i] == b.triangles[i]);
    check(same, "same seed => identical triangulation");
}

int main() {
    std::random_device rd;
    std::uint64_t seed = (static_cast<std::uint64_t>(rd()) << 32) ^ rd();
    std::printf("== forge::native::geom::constrainedDelaunay2D validation gate ==\n");
    std::printf("seed: 0x%016llx\n\n", static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    test_no_constraints(rng);
    test_polygon_with_hole();
    test_L_shape();
    test_random_convex_with_diagonal(rng);
    test_star_polygon();
    test_random_rect_with_holes(rng);
    test_self_intersecting();
    test_degenerate_inputs();
    test_determinism();

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
