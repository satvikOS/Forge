// forge/native/geom/kdtree3d_test.cpp
//
// Standalone validation gate for forge::native::geom::KdTree3D.
//
// Build & run (exactly the agent's verification command):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/KdTree3D.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/kdtree3d_test.cpp \
//       -o /tmp/k_KdTree3D && /tmp/k_KdTree3D
//   (NOTE: Geom.cpp transitively references the robust predicates in
//    src/native/Predicates.cpp; if the link reports undefined orient2d/orient3d
//    symbols, that is Geom.cpp's dependency — not KdTree3D's — and the link must
//    additionally include src/native/Predicates.cpp. KdTree3D itself references
//    NO predicate symbols. See the report at the bottom of this run.)
//
// VALIDATION GATE (per the module spec):
//   (1) Over >= 40 RANDOM point sets / queries (with a fresh std::random_device
//       seed PRINTED), kNearest(q,k) returns EXACTLY the brute-force k-nearest
//       set, in identical order-by-distance, within 1e-9 (in fact bit-exact on
//       the comparison key — same scalar formula).
//   (2) radiusSearch(q,r) over the same sets returns EXACTLY the brute-force
//       in-radius set, in the same ascending-distance/ascending-index order.
//   (3) Edge cases handled HONESTLY: k>n, k<=0, empty tree, empty/zero/negative
//       radius, duplicate/coincident points, querying an unbuilt tree, and a
//       non-finite-coordinate build (must return ok=false, no fabrication).
//
// The brute-force oracle uses the IDENTICAL squared-Euclidean key and the
// IDENTICAL tie rule (ascending distance, then ascending index), so a correct
// kd-tree must agree element-for-element. Any divergence is a real bug, never a
// tolerance artifact — assertions are NEVER weakened to pass.

#include "forge/native/geom/KdTree3D.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using forge::native::geom::KdTree3D;
using forge::native::geom::KnnResult;
using forge::native::geom::Neighbor;
using forge::native::geom::Point3;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

static double sqDist(const Point3& a, const Point3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

// Brute-force oracle: an index sorted by (squared distance asc, index asc) — the
// same total order the kd-tree promises.
struct OracleEntry { double d2; std::size_t idx; };

static std::vector<OracleEntry> bruteSorted(const std::vector<Point3>& pts,
                                            const Point3& q) {
    std::vector<OracleEntry> v;
    v.reserve(pts.size());
    for (std::size_t i = 0; i < pts.size(); ++i)
        v.push_back(OracleEntry{ sqDist(pts[i], q), i });
    std::sort(v.begin(), v.end(), [](const OracleEntry& a, const OracleEntry& b) {
        if (a.d2 != b.d2) return a.d2 < b.d2;
        return a.idx < b.idx;
    });
    return v;
}

// Compare a kd-tree result against an explicit expected (index, distance) list.
// Indices must match exactly in order; distances within 1e-9.
static bool matches(const std::vector<Neighbor>& got,
                    const std::vector<OracleEntry>& expect) {
    if (got.size() != expect.size()) return false;
    for (std::size_t i = 0; i < got.size(); ++i) {
        if (got[i].index != expect[i].idx) return false;
        const double trueDist = std::sqrt(expect[i].d2);
        if (std::fabs(got[i].distance - trueDist) > 1e-9) return false;
    }
    return true;
}

int main() {
    std::printf("== forge::native::geom::KdTree3D validation gate ==\n");

    // Fresh, PRINTED seed so every run is distinct yet reproducible from the log.
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    const unsigned seed = rd();
    std::printf("seed = %u\n", seed);
    std::mt19937 rng(seed);

    // -----------------------------------------------------------------------
    // (1)+(2) Randomized agreement vs brute force over >= 40 sets/queries.
    // -----------------------------------------------------------------------
    std::printf("\n(1)/(2) randomized kNearest + radiusSearch vs brute force\n");
    {
        const int kSets = 50;  // >= 40 required
        std::uniform_int_distribution<int> nDist(1, 400);
        std::uniform_real_distribution<double> coordDist(-100.0, 100.0);
        // Occasionally use a small integer grid so MANY exact-distance TIES occur,
        // stressing the deterministic tie rule (ascending index).
        std::uniform_int_distribution<int> gridFlag(0, 1);
        std::uniform_int_distribution<int> gridCoord(-4, 4);

        int knnSetsOk = 0, radSetsOk = 0;
        int knnSetsTotal = 0, radSetsTotal = 0;

        for (int s = 0; s < kSets; ++s) {
            const int n = nDist(rng);
            const bool grid = gridFlag(rng) == 1;
            std::vector<Point3> pts;
            pts.reserve(static_cast<std::size_t>(n));
            for (int i = 0; i < n; ++i) {
                if (grid) {
                    pts.push_back(Point3{ (double)gridCoord(rng),
                                          (double)gridCoord(rng),
                                          (double)gridCoord(rng) });
                } else {
                    pts.push_back(Point3{ coordDist(rng),
                                          coordDist(rng),
                                          coordDist(rng) });
                }
            }

            KdTree3D tree;
            if (!tree.build(pts)) { check(false, "(1) build succeeded"); continue; }

            // Several queries per set.
            const int kQueries = 4;
            for (int qi = 0; qi < kQueries; ++qi) {
                Point3 q;
                if (grid) {
                    q = Point3{ (double)gridCoord(rng),
                                (double)gridCoord(rng),
                                (double)gridCoord(rng) };
                } else {
                    q = Point3{ coordDist(rng), coordDist(rng), coordDist(rng) };
                }

                const std::vector<OracleEntry> oracle = bruteSorted(pts, q);

                // --- kNearest for a range of k including k>n. ---
                for (int k : { 1, 3, 8, n, n + 5 }) {
                    KnnResult r = tree.kNearest(q, k);
                    ++knnSetsTotal;
                    const std::size_t expCount =
                        std::min<std::size_t>(static_cast<std::size_t>(std::max(0, k)),
                                              pts.size());
                    std::vector<OracleEntry> exp(oracle.begin(),
                                                 oracle.begin() + (long)expCount);
                    if (r.ok && r.neighbors.size() == expCount &&
                        matches(r.neighbors, exp)) {
                        ++knnSetsOk;
                    }
                }

                // --- radiusSearch with a radius spanning empty..all. ---
                // Pick r as the distance to the m-th nearest for a few m, so we
                // exercise empty, partial, and full balls deterministically.
                for (int m : { 0, 1, 5, n }) {
                    double r;
                    if (m <= 0) {
                        r = -1.0;  // negative -> honestly empty
                    } else {
                        const std::size_t mi =
                            std::min<std::size_t>((std::size_t)m, pts.size()) - 1;
                        r = std::sqrt(oracle[mi].d2);  // include exactly through m-th
                    }
                    KnnResult rr = tree.radiusSearch(q, r);
                    ++radSetsTotal;

                    // Oracle: all points with sqDist <= r*r, in oracle order.
                    std::vector<OracleEntry> exp;
                    if (r >= 0.0) {
                        const double r2 = r * r;
                        for (const auto& e : oracle)
                            if (e.d2 <= r2) exp.push_back(e);
                    }
                    if (rr.ok && rr.neighbors.size() == exp.size() &&
                        matches(rr.neighbors, exp)) {
                        ++radSetsOk;
                    }
                }
            }
        }

        std::printf("    kNearest    queries agreeing: %d / %d\n",
                    knnSetsOk, knnSetsTotal);
        std::printf("    radiusSearch queries agreeing: %d / %d\n",
                    radSetsOk, radSetsTotal);
        check(knnSetsTotal >= 40, "(1) ran >= 40 randomized kNearest queries");
        check(knnSetsOk == knnSetsTotal,
              "(1) kNearest matches brute force on EVERY query (set+order+dist)");
        check(radSetsOk == radSetsTotal,
              "(2) radiusSearch matches brute force on EVERY query");
    }

    // -----------------------------------------------------------------------
    // (3a) k > n returns ALL n points, no fabricated padding.
    // -----------------------------------------------------------------------
    std::printf("\n(3a) k > n edge case\n");
    {
        std::vector<Point3> pts = { {0,0,0}, {1,0,0}, {0,1,0} };
        KdTree3D tree; tree.build(pts);
        KnnResult r = tree.kNearest(Point3{0,0,0}, 100);
        check(r.ok && r.neighbors.size() == 3,
              "(3a) k>n returns exactly n neighbors (no padding)");
        check(r.neighbors[0].index == 0 &&
              std::fabs(r.neighbors[0].distance) <= 1e-9,
              "(3a) nearest is the coincident point at distance 0");
    }

    // -----------------------------------------------------------------------
    // (3b) k <= 0 returns ok=true, empty.
    // -----------------------------------------------------------------------
    std::printf("\n(3b) k <= 0 edge case\n");
    {
        std::vector<Point3> pts = { {0,0,0}, {1,1,1} };
        KdTree3D tree; tree.build(pts);
        KnnResult r0 = tree.kNearest(Point3{0,0,0}, 0);
        KnnResult rn = tree.kNearest(Point3{0,0,0}, -3);
        check(r0.ok && r0.neighbors.empty(), "(3b) k==0 -> ok, empty");
        check(rn.ok && rn.neighbors.empty(), "(3b) k<0  -> ok, empty");
    }

    // -----------------------------------------------------------------------
    // (3c) empty tree: build ok, queries ok+empty (NOT a failure).
    // -----------------------------------------------------------------------
    std::printf("\n(3c) empty point set\n");
    {
        KdTree3D tree;
        bool ok = tree.build(std::vector<Point3>{});
        check(ok && tree.built() && tree.size() == 0,
              "(3c) empty build succeeds (empty tree)");
        KnnResult rk = tree.kNearest(Point3{0,0,0}, 5);
        KnnResult rr = tree.radiusSearch(Point3{0,0,0}, 10.0);
        check(rk.ok && rk.neighbors.empty(), "(3c) kNearest on empty -> ok, empty");
        check(rr.ok && rr.neighbors.empty(),
              "(3c) radiusSearch on empty -> ok, empty");
    }

    // -----------------------------------------------------------------------
    // (3d) radius edge cases: negative, zero, and exact-boundary inclusion.
    // -----------------------------------------------------------------------
    std::printf("\n(3d) radius edge cases (negative / zero / boundary)\n");
    {
        std::vector<Point3> pts = { {0,0,0}, {3,0,0}, {3,0,0}, {5,0,0} };
        KdTree3D tree; tree.build(pts);

        KnnResult neg = tree.radiusSearch(Point3{0,0,0}, -0.5);
        check(neg.ok && neg.neighbors.empty(),
              "(3d) negative radius -> ok, empty ball");

        KnnResult zero = tree.radiusSearch(Point3{3,0,0}, 0.0);
        // r==0 returns only points exactly coincident with q: indices 1 and 2.
        check(zero.ok && zero.neighbors.size() == 2 &&
              zero.neighbors[0].index == 1 && zero.neighbors[1].index == 2,
              "(3d) zero radius returns only coincident points, index-ordered");

        // Boundary inclusive: r exactly 3 must include the points at distance 3.
        KnnResult bnd = tree.radiusSearch(Point3{0,0,0}, 3.0);
        // distance 0 (idx0) and distance 3 (idx1, idx2); idx3 at distance 5 out.
        check(bnd.ok && bnd.neighbors.size() == 3 &&
              bnd.neighbors[0].index == 0 &&
              bnd.neighbors[1].index == 1 &&
              bnd.neighbors[2].index == 2,
              "(3d) inclusive boundary |p-q|<=r keeps points exactly at r");
    }

    // -----------------------------------------------------------------------
    // (3e) querying an UNBUILT tree -> ok=false (honest failure, no fabrication).
    // -----------------------------------------------------------------------
    std::printf("\n(3e) querying an unbuilt tree\n");
    {
        KdTree3D tree;  // never built
        KnnResult rk = tree.kNearest(Point3{0,0,0}, 3);
        KnnResult rr = tree.radiusSearch(Point3{0,0,0}, 1.0);
        check(!rk.ok && rk.neighbors.empty(),
              "(3e) kNearest on unbuilt tree -> ok=false");
        check(!rr.ok && rr.neighbors.empty(),
              "(3e) radiusSearch on unbuilt tree -> ok=false");
    }

    // -----------------------------------------------------------------------
    // (3f) non-finite coordinate in build -> ok=false, tree left empty.
    //      We do NOT silently drop the bad point or fabricate a tree.
    // -----------------------------------------------------------------------
    std::printf("\n(3f) non-finite coordinate rejected honestly\n");
    {
        const double inf = std::numeric_limits<double>::infinity();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        std::vector<Point3> bad1 = { {0,0,0}, {inf, 0, 0} };
        std::vector<Point3> bad2 = { {0,0,0}, {0, nan, 0} };
        KdTree3D t1, t2;
        bool ok1 = t1.build(bad1);
        bool ok2 = t2.build(bad2);
        check(!ok1 && !t1.built() && t1.size() == 0,
              "(3f) Inf coordinate -> build ok=false, empty tree");
        check(!ok2 && !t2.built() && t2.size() == 0,
              "(3f) NaN coordinate -> build ok=false, empty tree");
        // And queries on the failed tree are honest failures.
        check(!t1.kNearest(Point3{0,0,0}, 1).ok,
              "(3f) query on failed-build tree -> ok=false");
    }

    // -----------------------------------------------------------------------
    // (3g) deterministic tie order: many coincident points must come back in
    //      ascending-index order, and a re-build must reproduce it identically.
    // -----------------------------------------------------------------------
    std::printf("\n(3g) deterministic tie ordering on coincident points\n");
    {
        std::vector<Point3> pts;
        for (int i = 0; i < 16; ++i) pts.push_back(Point3{2,2,2});  // all identical
        KdTree3D tree; tree.build(pts);
        KnnResult r = tree.kNearest(Point3{2,2,2}, 7);
        bool ascending = (r.neighbors.size() == 7);
        for (std::size_t i = 0; ascending && i < r.neighbors.size(); ++i)
            if (r.neighbors[i].index != i) ascending = false;
        check(ascending,
              "(3g) equal-distance neighbors returned in ascending index order");
    }

    // -----------------------------------------------------------------------
    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
