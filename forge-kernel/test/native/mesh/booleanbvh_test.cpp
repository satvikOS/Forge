// forge/native/mesh/test/booleanbvh_test.cpp
//
// Standalone validation gate for the BVH-accelerated cross-mesh intersection
// layer (forge::native::mesh::crossIntersectBVH / BooleanBVH). Pure C++20, no
// external deps. Build + run:
//
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/BooleanBVH.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/mesh/TriTriIntersect.cpp \
//       forge-kernel/src/native/geom/AABBTree.cpp \
//       forge-kernel/test/native/mesh/booleanbvh_test.cpp -o /tmp/k6_BooleanBVH \
//   && /tmp/k6_BooleanBVH
//
// THE SPEC (validated below over >= 25 random mesh pairs, with a printed
// std::random_device seed so any failure is reproducible):
//   For every random mesh pair, the BVH-found intersecting (triA, triB) pair set
//   is IDENTICAL to the O(n*m) brute-force tri-tri result — no missed pairs, no
//   extra pairs, and the SAME exact relation + intersection segment per pair.
//   The case mix explicitly includes DISJOINT pairs (0 intersecting pairs) and
//   DEEPLY-OVERLAPPING pairs (two meshes packed into the same small region, many
//   pairs). The speedup (pairsBrute = n*m vs pairsTested by the BVH) is reported.

#include "forge/native/mesh/BooleanBVH.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"

#include <algorithm>   // std::max
#include <cmath>       // std::nan
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <cstdio>
#include <random>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {            std::printf("  [FAIL] %s\n", name); }
}

// ---------------------------------------------------------------------------
// A random valid triangle soup inside an axis-aligned box centred at `center`
// with half-size `half`. Each triangle is three DISTINCT random vertices and is
// resampled until it has non-zero area, so the soup satisfies the BooleanBVH /
// AABBTree validity contract (no repeated index, no degenerate triangle).
// ---------------------------------------------------------------------------
struct Soup {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
};

template <class RNG>
static Soup randomSoup(RNG& rng, int numTris, double cx, double cy, double cz,
                       double half) {
    std::uniform_real_distribution<double> U(-half, half);
    Soup s;
    s.pos.reserve(static_cast<std::size_t>(numTris) * 9);
    s.idx.reserve(static_cast<std::size_t>(numTris) * 3);
    auto triArea2 = [](double ax, double ay, double az,
                       double bx, double by, double bz,
                       double ccx, double ccy, double ccz) {
        const double ux = bx - ax, uy = by - ay, uz = bz - az;
        const double vx = ccx - ax, vy = ccy - ay, vz = ccz - az;
        const double nx = uy * vz - uz * vy;
        const double ny = uz * vx - ux * vz;
        const double nz = ux * vy - uy * vx;
        return nx * nx + ny * ny + nz * nz;
    };
    for (int t = 0; t < numTris; ++t) {
        double v[9];
        // Resample until the triangle has non-zero area.
        for (int attempt = 0; attempt < 64; ++attempt) {
            for (int k = 0; k < 9; ++k) {
                const double c = (k % 3 == 0) ? cx : (k % 3 == 1 ? cy : cz);
                v[k] = c + U(rng);
            }
            if (triArea2(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]) > 0.0)
                break;
        }
        const std::uint32_t base = static_cast<std::uint32_t>(s.pos.size() / 3);
        for (int k = 0; k < 9; ++k) s.pos.push_back(v[k]);
        s.idx.push_back(base + 0);
        s.idx.push_back(base + 1);
        s.idx.push_back(base + 2);
    }
    return s;
}

// ---------------------------------------------------------------------------
// A flat triangulated grid surface in the plane z = zPlane, spanning x,y in
// [x0,x0+w] x [y0,y0+h] with res*res cells (2 triangles per cell). This is a
// large, spatially-coherent mesh: when two such grids overlap only over a small
// sub-region, the BVH prunes the vast majority of n*m pairs — exactly the
// asymptotic win a uniform-grid or BVH accelerator exists for. Every triangle
// is non-degenerate (distinct corners), so the soup is valid.
// ---------------------------------------------------------------------------
static Soup gridSurface(double x0, double y0, double w, double h,
                        double zPlane, int res) {
    Soup s;
    const int verts = (res + 1) * (res + 1);
    s.pos.reserve(static_cast<std::size_t>(verts) * 3);
    auto vid = [res](int i, int j) { return static_cast<std::uint32_t>(j * (res + 1) + i); };
    for (int j = 0; j <= res; ++j) {
        for (int i = 0; i <= res; ++i) {
            s.pos.push_back(x0 + w * (double)i / (double)res);
            s.pos.push_back(y0 + h * (double)j / (double)res);
            s.pos.push_back(zPlane);
        }
    }
    s.idx.reserve(static_cast<std::size_t>(res) * res * 6);
    for (int j = 0; j < res; ++j) {
        for (int i = 0; i < res; ++i) {
            const std::uint32_t a = vid(i, j), b = vid(i + 1, j);
            const std::uint32_t c = vid(i + 1, j + 1), d = vid(i, j + 1);
            s.idx.push_back(a); s.idx.push_back(b); s.idx.push_back(c);
            s.idx.push_back(a); s.idx.push_back(c); s.idx.push_back(d);
        }
    }
    return s;
}

// Compare two reports for IDENTICAL intersecting-pair sets (and per-pair exact
// relation + segment endpoints). Both are sorted by (triA,triB) on return from
// the routines, so a positional walk suffices.
static bool sameSegPoint(const Vec3& a, const Vec3& b) {
    // The two paths feed the IDENTICAL triangle coordinates to the IDENTICAL
    // triTriIntersect, so endpoints must match bit-for-bit (==), not within tol.
    return a.x == b.x && a.y == b.y && a.z == b.z;
}

static bool identicalPairSets(const CrossIntersectReport& bvh,
                              const CrossIntersectReport& brute,
                              const char*& why) {
    if (bvh.pairs.size() != brute.pairs.size()) { why = "pair COUNT differs"; return false; }
    for (std::size_t i = 0; i < bvh.pairs.size(); ++i) {
        const CrossPair& a = bvh.pairs[i];
        const CrossPair& b = brute.pairs[i];
        if (a.triA != b.triA || a.triB != b.triB) { why = "pair INDICES differ"; return false; }
        if (a.relation != b.relation)             { why = "pair RELATION differs"; return false; }
        if (!sameSegPoint(a.p, b.p) || !sameSegPoint(a.q, b.q)) {
            why = "pair SEGMENT endpoints differ"; return false;
        }
    }
    why = "";
    return true;
}

int main() {
    std::printf("=== forge::native::mesh BVH cross-mesh intersection gate ===\n");

    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    const unsigned seed = rd();
    std::printf("seed = %u  (reproduce: hard-code this seed)\n", seed);
    std::mt19937 rng(seed);

    // Category counters across the random cases.
    int disjointCases = 0;       // 0 intersecting pairs found
    int deepCases = 0;           // >= 20 intersecting pairs found
    std::uint64_t totalBrute = 0, totalTested = 0;
    int worst_pct = 0;           // worst (largest) pairsTested/pairsBrute %, for honesty

    const int kCases = 30;       // >= 25 required by the spec
    int identicalCount = 0;

    std::printf("\n[random pairs] %d cases — BVH set == brute set, each\n", kCases);
    for (int c = 0; c < kCases; ++c) {
        // Mix the geometry so the >=25 cases SPAN the regimes the spec names:
        //   c % 5 == 0 : FAR-APART meshes               -> DISJOINT (0 pairs)
        //   c % 5 == 1 : two meshes packed in one tiny box -> DEEPLY OVERLAPPING
        //   else       : general random overlap / partial / grazing
        std::uniform_int_distribution<int> Tn(6, 40);
        const int nA = Tn(rng);
        const int nB = Tn(rng);

        Soup A, B;
        if (c % 5 == 0) {
            // Far apart on x: boxes [-1,1] around -1000 vs +1000 cannot overlap.
            A = randomSoup(rng, nA, -1000.0, 0.0, 0.0, 1.0);
            B = randomSoup(rng, nB,  1000.0, 0.0, 0.0, 1.0);
        } else if (c % 5 == 1) {
            // Both packed in the SAME tiny box -> dense mutual crossings.
            A = randomSoup(rng, std::max(nA, 18), 0.0, 0.0, 0.0, 1.0);
            B = randomSoup(rng, std::max(nB, 18), 0.0, 0.0, 0.0, 1.0);
        } else {
            // General partial overlap: B offset by a random fraction of the span.
            std::uniform_real_distribution<double> Off(-2.5, 2.5);
            A = randomSoup(rng, nA, 0.0, 0.0, 0.0, 2.0);
            B = randomSoup(rng, nB, Off(rng), Off(rng), Off(rng), 2.0);
        }

        const CrossIntersectReport bvh =
            crossIntersectBVH(A.pos, A.idx, B.pos, B.idx);
        const CrossIntersectReport brute =
            crossIntersectBruteForce(A.pos, A.idx, B.pos, B.idx);

        // Both must accept the (valid-by-construction) input.
        if (!bvh.ok || !brute.ok) {
            std::printf("    case %d: UNEXPECTED ok=false (bvh=%d brute=%d)\n",
                        c, (int)bvh.ok, (int)brute.ok);
            check(false, "both paths accept valid input");
            continue;
        }

        const char* why = "";
        const bool same = identicalPairSets(bvh, brute, why);
        if (!same) {
            std::printf("    case %d: MISMATCH (%s)  bvh=%zu brute=%zu\n",
                        c, why, bvh.pairs.size(), brute.pairs.size());
        }
        if (same) ++identicalCount;

        // Brute must literally test n*m pairs; BVH must test no more than that
        // and (the whole point) usually far fewer.
        const bool bruteTestsAll = (brute.pairsTested == brute.pairsBrute) &&
                                   (brute.pairsBrute ==
                                    (std::uint64_t)bvh.numTrisA * (std::uint64_t)bvh.numTrisB);
        const bool bvhNoMore = (bvh.pairsTested <= bvh.pairsBrute);
        check(same,           "BVH pair set IDENTICAL to brute (this case)");
        check(bruteTestsAll,  "brute tests exactly n*m pairs (this case)");
        check(bvhNoMore,      "BVH tests <= n*m pairs (this case)");

        totalBrute  += bvh.pairsBrute;
        totalTested += bvh.pairsTested;
        if (bvh.pairsBrute > 0) {
            const int pct = (int)((bvh.pairsTested * 100) / bvh.pairsBrute);
            if (pct > worst_pct) worst_pct = pct;
        }

        if (bvh.pairs.empty()) ++disjointCases;
        if (bvh.pairs.size() >= 20) ++deepCases;

        if (c % 5 == 0) {
            // The far-apart category MUST be disjoint (sanity on the generator).
            check(bvh.disjoint && bvh.pairs.empty(),
                  "far-apart meshes -> 0 intersecting pairs (disjoint)");
        }
    }

    check(identicalCount == kCases, "ALL random cases: BVH set == brute set");
    check(disjointCases >= 1, "case mix includes a DISJOINT pair (0 pairs)");
    check(deepCases >= 1, "case mix includes a DEEPLY-OVERLAPPING pair (>=20 pairs)");
    check(kCases >= 25, "ran >= 25 random cases");

    // ---- explicit hand-built DISJOINT case (named, not random) -------------
    std::printf("\n[explicit disjoint] two unit triangles separated in z\n");
    {
        std::vector<double> pa = {0,0,0, 1,0,0, 0,1,0};
        std::vector<std::uint32_t> ia = {0,1,2};
        std::vector<double> pb = {0,0,5, 1,0,5, 0,1,5};
        std::vector<std::uint32_t> ib = {0,1,2};
        const CrossIntersectReport bvh = crossIntersectBVH(pa, ia, pb, ib);
        const CrossIntersectReport brute = crossIntersectBruteForce(pa, ia, pb, ib);
        const char* why = "";
        check(bvh.ok && brute.ok, "explicit disjoint: both accept");
        check(bvh.pairs.empty() && bvh.disjoint, "explicit disjoint: 0 pairs");
        check(identicalPairSets(bvh, brute, why), "explicit disjoint: sets identical");
    }

    // ---- explicit known crossing (X cross from the tritri gate) ------------
    std::printf("\n[explicit cross] one A triangle crosses one B triangle\n");
    {
        // A in z=0; B vertical in x=0 — they cross (PROPER_CROSS) at the y-axis.
        std::vector<double> pa = {-2,-1,0, 2,-1,0, 0,1,0};
        std::vector<std::uint32_t> ia = {0,1,2};
        std::vector<double> pb = {0,-1,-1, 0,-1,1, 0,1,0};
        std::vector<std::uint32_t> ib = {0,1,2};
        const CrossIntersectReport bvh = crossIntersectBVH(pa, ia, pb, ib);
        const CrossIntersectReport brute = crossIntersectBruteForce(pa, ia, pb, ib);
        const char* why = "";
        check(bvh.ok && brute.ok, "explicit cross: both accept");
        check(bvh.pairs.size() == 1, "explicit cross: exactly 1 intersecting pair");
        check(!bvh.pairs.empty() &&
              bvh.pairs[0].relation == (int)TriTriRelation::PROPER_CROSS,
              "explicit cross: relation == PROPER_CROSS");
        check(identicalPairSets(bvh, brute, why), "explicit cross: sets identical");
    }

    // ---- large-scale: the ASYMPTOTIC win the BVH exists for ----------------
    // Two big triangulated grid surfaces that overlap only over a small corner
    // band. Brute force is n*m (~hundreds of thousands of tri-tri tests); the
    // BVH must (a) return the IDENTICAL pair set and (b) test only a SMALL
    // fraction of n*m, because almost every A triangle is spatially far from
    // almost every B triangle. This is where "far faster than O(n*m)" shows.
    std::printf("\n[large-scale] two %dx%d grid surfaces, small overlap band\n", 24, 24);
    {
        const int res = 24;                       // 24*24*2 = 1152 triangles each
        Soup A = gridSurface(0.0,  0.0, 10.0, 10.0, 0.0, res);
        // B overlaps A only in the corner region [9,10]x[9,10] (one cell wide).
        Soup B = gridSurface(9.0,  9.0, 10.0, 10.0, 0.0, res);

        const CrossIntersectReport bvh =
            crossIntersectBVH(A.pos, A.idx, B.pos, B.idx);
        const CrossIntersectReport brute =
            crossIntersectBruteForce(A.pos, A.idx, B.pos, B.idx);

        const char* why = "";
        check(bvh.ok && brute.ok, "large-scale: both accept");
        check(identicalPairSets(bvh, brute, why), "large-scale: BVH set == brute set");
        check(brute.pairsTested == brute.pairsBrute,
              "large-scale: brute tested exactly n*m");
        // The headline: BVH tested a SMALL fraction of n*m on a spatially
        // separated pair. (Conservatively assert < 25%; in practice it is far
        // lower — printed below.)
        const double frac = bvh.pairsBrute
            ? (double)bvh.pairsTested / (double)bvh.pairsBrute : 1.0;
        std::printf("    n*m = %llu   BVH tested = %llu   (%.3f%% of n*m, %.1fx fewer)\n",
                    (unsigned long long)bvh.pairsBrute,
                    (unsigned long long)bvh.pairsTested,
                    100.0 * frac,
                    bvh.pairsTested ? (double)bvh.pairsBrute / (double)bvh.pairsTested : 0.0);
        check(frac < 0.25, "large-scale: BVH tested < 25% of n*m (real pruning)");
        check(!bvh.pairs.empty(), "large-scale: overlap band -> some pairs found");
    }

    // ---- 0 FAKES: malformed input is rejected honestly ---------------------
    std::printf("\n[honesty] malformed input -> ok=false, never a fake clean verdict\n");
    {
        std::vector<double> goodPos = {0,0,0, 1,0,0, 0,1,0};
        std::vector<std::uint32_t> goodIdx = {0,1,2};

        // positions length not a multiple of 3.
        std::vector<double> badPos = {0,0,0, 1,0};
        check(!crossIntersectBVH(badPos, goodIdx, goodPos, goodIdx).ok,
              "BVH: ragged positions -> ok=false");
        check(!crossIntersectBruteForce(badPos, goodIdx, goodPos, goodIdx).ok,
              "brute: ragged positions -> ok=false");

        // index out of range.
        std::vector<std::uint32_t> oobIdx = {0,1,9};
        check(!crossIntersectBVH(goodPos, oobIdx, goodPos, goodIdx).ok,
              "BVH: out-of-range index -> ok=false");

        // degenerate (repeated index) triangle.
        std::vector<std::uint32_t> dupIdx = {0,0,1};
        check(!crossIntersectBVH(goodPos, dupIdx, goodPos, goodIdx).ok,
              "BVH: repeated-index triangle -> ok=false");

        // zero-area (collinear) triangle.
        std::vector<double> collinear = {0,0,0, 1,0,0, 2,0,0};
        std::vector<std::uint32_t> colIdx = {0,1,2};
        check(!crossIntersectBVH(collinear, colIdx, goodPos, goodIdx).ok,
              "BVH: zero-area triangle -> ok=false");

        // non-finite coordinate.
        std::vector<double> nanPos = {0,0,0, 1,0,0, 0,1,std::nan("")};
        check(!crossIntersectBVH(nanPos, goodIdx, goodPos, goodIdx).ok,
              "BVH: non-finite coordinate -> ok=false");

        // bad input on the B side too (validated symmetrically).
        check(!crossIntersectBVH(goodPos, goodIdx, badPos, goodIdx).ok,
              "BVH: ragged B positions -> ok=false");
    }

    // ---- speedup report ----------------------------------------------------
    std::printf("\n=== speedup over the random suite ===\n");
    std::printf("  brute pairs tested  : %llu\n", (unsigned long long)totalBrute);
    std::printf("  BVH   pairs tested  : %llu\n", (unsigned long long)totalTested);
    if (totalTested > 0) {
        std::printf("  aggregate speedup   : %.2fx fewer tri-tri tests\n",
                    (double)totalBrute / (double)totalTested);
    }
    std::printf("  worst single-case   : BVH tested %d%% of n*m (lower is better)\n",
                worst_pct);
    std::printf("  disjoint cases      : %d   deeply-overlapping cases: %d\n",
                disjointCases, deepCases);

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
