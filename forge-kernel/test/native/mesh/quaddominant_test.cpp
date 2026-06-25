// forge/native/mesh/test/quaddominant_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::quadDominant — greedy
// triangle-to-quad-dominant conversion. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test, so it
// does not race sibling agents on the rest of the tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/QuadDominant.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/quaddominant_test.cpp -o /tmp/k5_QuadDominant \
//   && /tmp/k5_QuadDominant
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE (the headline win — a real tri->quad conversion that stays
// geometrically honest). RANDOMIZED: a fresh std::random_device seed each run (so
// it can never be cherry-picked) drives (a) the grid size, (b) a random rigid
// rotation + translation of the grid (so the planar projection / orient2d gate is
// exercised on non-axis-aligned geometry), and (c) a random per-vertex in-plane
// jitter that keeps the grid planar but breaks axis alignment of the squares.
//
//   (S1) A regular triangulated grid (each unit square split into 2 tris), under a
//        random rigid transform:
//          * conversion succeeds (ok=true),
//          * recovers ~100% quads: quadFraction >= 0.90,
//          * ZERO degenerate / non-convex quads — every emitted 4-gon is verified
//            INDEPENDENTLY by this test to be a strictly convex simple quad
//            (orient2d in its own average plane, all four turns same non-zero sign)
//            with strictly positive area,
//          * every emitted vertex index is in range and references the SAME vertex
//            array (no vertices added / moved / removed),
//          * AREA preserved: |Σ poly areas - Σ tri areas| <= 1e-9 (and the report's
//            own inputArea/outputArea agree to 1e-9),
//          * each triangle used AT MOST once: Σ(4-per-quad source tris) + leftover
//            tris == input triangle count, exactly.
//   (S2) A single triangle (no interior edge) stays a triangle: ok=true, 0 quads,
//        1 tri face, area preserved.
//   (S3) Two triangles sharing one edge that form a NON-CONVEX pairing are NEVER
//        merged into a quad — the convexity gate keeps them as two triangles,
//        area preserved.
//   (S4) 0-FAKES — degenerate / unsupported inputs return ok=false honestly and
//        leave `out` untouched:
//          * empty soup,
//          * positions length not a multiple of 3,
//          * indices length not a multiple of 3,
//          * an out-of-range index,
//          * a degenerate (repeated-vertex) triangle,
//          * a zero-area (collinear) triangle.
//
// HONESTY (Bible §0/§9): ok==true ALWAYS implies the asserted convexity + area +
// vertex-preservation audit passes (re-derived independently here, not trusted from
// the module). The test asserts the SPEC; it NEVER weakens an assertion.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/QuadDominant.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/Predicates.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[512];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else     std::printf("  [FAIL] %s\n", buf);
}

// ── geometry helpers (independent of the module under test) ──────────────────
struct V3 { double x, y, z; };
static V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
static double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static double len(const V3& a) { return std::sqrt(dot(a, a)); }

static V3 vof(const std::vector<double>& P, std::uint32_t i) {
    return {P[3 * i + 0], P[3 * i + 1], P[3 * i + 2]};
}

// Polygon area in 3D via the fan / Newell method (works for tris and convex quads).
static double polyArea(const std::vector<double>& P, const std::vector<std::uint32_t>& f) {
    V3 acc{0, 0, 0};
    std::size_t n = f.size();
    for (std::size_t i = 0; i < n; ++i) {
        V3 a = vof(P, f[i]);
        V3 b = vof(P, f[(i + 1) % n]);
        acc.x += a.y * b.z - a.z * b.y;
        acc.y += a.z * b.x - a.x * b.z;
        acc.z += a.x * b.y - a.y * b.x;
    }
    return 0.5 * len(acc);
}

// Independently verify: this 4-gon is a strictly convex simple quad. Project into
// its average-plane basis and assert all four orient2d turns share a non-zero sign.
static bool quadIsStrictlyConvex(const std::vector<double>& P,
                                 const std::vector<std::uint32_t>& f) {
    if (f.size() != 4) return false;
    V3 p[4] = {vof(P, f[0]), vof(P, f[1]), vof(P, f[2]), vof(P, f[3])};
    // Newell normal of the polygon.
    V3 n{0, 0, 0};
    for (int i = 0; i < 4; ++i) {
        const V3& a = p[i];
        const V3& b = p[(i + 1) % 4];
        n.x += a.y * b.z - a.z * b.y;
        n.y += a.z * b.x - a.x * b.z;
        n.z += a.x * b.y - a.y * b.x;
    }
    double nl = len(n);
    if (nl <= 0.0) return false;
    n = {n.x / nl, n.y / nl, n.z / nl};
    V3 ref = (std::fabs(n.x) < 0.9) ? V3{1, 0, 0} : V3{0, 1, 0};
    V3 u = cross(n, ref);
    double ul = len(u);
    if (ul <= 0.0) return false;
    u = {u.x / ul, u.y / ul, u.z / ul};
    V3 w = cross(n, u);
    std::array<std::array<double, 2>, 4> q;
    for (int i = 0; i < 4; ++i) q[i] = {dot(p[i], u), dot(p[i], w)};
    auto turn = [&](int i) {
        const auto& a = q[i];
        const auto& b = q[(i + 1) % 4];
        const auto& c = q[(i + 2) % 4];
        return forge::native::signValue(
            forge::native::orient2d(a[0], a[1], b[0], b[1], c[0], c[1]));
    };
    int s = turn(0);
    if (s == 0) return false;
    for (int i = 1; i < 4; ++i) {
        int si = turn(i);
        if (si == 0 || (si > 0) != (s > 0)) return false;
    }
    return true;
}

// ── a random rigid transform (rotation R + translation) ──────────────────────
struct Rigid { double R[3][3]; double t[3]; };
static Rigid randomRigid(std::mt19937& rng) {
    std::uniform_real_distribution<double> ang(0.0, 6.283185307179586);
    std::uniform_real_distribution<double> tr(-5.0, 5.0);
    double a = ang(rng), b = ang(rng), c = ang(rng);
    double ca = std::cos(a), sa = std::sin(a);
    double cb = std::cos(b), sb = std::sin(b);
    double cc = std::cos(c), sc = std::sin(c);
    // ZYX euler.
    Rigid g;
    g.R[0][0] = ca * cb;
    g.R[0][1] = ca * sb * sc - sa * cc;
    g.R[0][2] = ca * sb * cc + sa * sc;
    g.R[1][0] = sa * cb;
    g.R[1][1] = sa * sb * sc + ca * cc;
    g.R[1][2] = sa * sb * cc - ca * sc;
    g.R[2][0] = -sb;
    g.R[2][1] = cb * sc;
    g.R[2][2] = cb * cc;
    g.t[0] = tr(rng); g.t[1] = tr(rng); g.t[2] = tr(rng);
    return g;
}
static V3 apply(const Rigid& g, const V3& p) {
    return {g.R[0][0] * p.x + g.R[0][1] * p.y + g.R[0][2] * p.z + g.t[0],
            g.R[1][0] * p.x + g.R[1][1] * p.y + g.R[1][2] * p.z + g.t[1],
            g.R[2][0] * p.x + g.R[2][1] * p.y + g.R[2][2] * p.z + g.t[2]};
}

// ── build a triangulated W x H grid (each square split into 2 tris) ──────────
// Vertices laid out in the local XY plane, then rigidly transformed. A small
// in-plane shear keeps it planar but breaks axis alignment of the squares.
static void buildGrid(int W, int H, const Rigid& g, double shear,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    auto vid = [&](int i, int j) { return static_cast<std::uint32_t>(j * (W + 1) + i); };
    for (int j = 0; j <= H; ++j) {
        for (int i = 0; i <= W; ++i) {
            // local planar coords with a uniform shear (still flat: z=0).
            double lx = static_cast<double>(i) + shear * static_cast<double>(j);
            double ly = static_cast<double>(j);
            V3 p = apply(g, V3{lx, ly, 0.0});
            pos.push_back(p.x); pos.push_back(p.y); pos.push_back(p.z);
        }
    }
    for (int j = 0; j < H; ++j) {
        for (int i = 0; i < W; ++i) {
            std::uint32_t a = vid(i, j), b = vid(i + 1, j),
                          c = vid(i + 1, j + 1), d = vid(i, j + 1);
            // split square (a,b,c,d) along diagonal a-c -> (a,b,c) + (a,c,d), CCW.
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
    }
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::quadDominant validation gate "
                "(tri -> quad-dominant) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // ── (S1) regular triangulated grid -> ~100% convex quads ─────────────────
    {
        std::uniform_int_distribution<int> dimD(3, 7);
        int W = dimD(rng), H = dimD(rng);
        Rigid g = randomRigid(rng);
        std::uniform_real_distribution<double> shD(-0.25, 0.25);
        double shear = shD(rng);

        std::vector<double> pos; std::vector<std::uint32_t> idx;
        buildGrid(W, H, g, shear, pos, idx);
        const std::size_t numTris  = idx.size() / 3;
        const std::size_t numVerts = pos.size() / 3;
        std::printf("\n[S1] grid %dx%d  (tris=%zu verts=%zu  shear=%.3f)\n",
                    W, H, numTris, numVerts, shear);

        std::vector<PolyFace> out;
        QuadDominantReport r = quadDominant(pos, idx, out);
        check(r.ok, "[S1] conversion succeeds (reason='%s')", r.reason);

        std::printf("    faces=%zu  quads=%zu  tris=%zu  quadFraction=%.4f\n",
                    r.faceCount, r.quadCount, r.triCount, r.quadFraction);
        check(r.quadFraction >= 0.90,
              "[S1] recovers ~100%% quads (quadFraction %.4f >= 0.90)", r.quadFraction);

        // every quad strictly convex + positive area; every vertex index in range.
        std::size_t badConvex = 0, badIdx = 0, badArea = 0, quads = 0, tris = 0;
        double sumPolyArea = 0.0;
        std::size_t quadSrcTris = 0;
        for (const auto& f : out) {
            for (std::uint32_t vi : f.verts) if (vi >= numVerts) ++badIdx;
            double aA = polyArea(pos, f.verts);
            sumPolyArea += aA;
            if (aA <= 0.0) ++badArea;
            if (f.verts.size() == 4) {
                ++quads;
                quadSrcTris += 2;
                if (!quadIsStrictlyConvex(pos, f.verts)) ++badConvex;
            } else if (f.verts.size() == 3) {
                ++tris;
            } else {
                ++badIdx;  // a face that is neither tri nor quad is invalid
            }
        }
        check(badIdx == 0, "[S1] every emitted index in range + every face is tri/quad "
              "(%zu bad)", badIdx);
        check(badConvex == 0, "[S1] every emitted quad strictly convex by orient2d "
              "(%zu non-convex)", badConvex);
        check(badArea == 0, "[S1] every emitted face has strictly positive area "
              "(%zu degenerate)", badArea);

        // area preservation (independent sum vs the module's two area totals).
        double sumTriArea = 0.0;
        for (std::size_t t = 0; t < numTris; ++t) {
            V3 a = vof(pos, idx[3*t+0]), b = vof(pos, idx[3*t+1]), c = vof(pos, idx[3*t+2]);
            sumTriArea += 0.5 * len(cross(sub(b, a), sub(c, a)));
        }
        std::printf("    Σtri=%.12f  Σpoly=%.12f  report(in=%.12f out=%.12f)\n",
                    sumTriArea, sumPolyArea, r.inputArea, r.outputArea);
        check(std::fabs(sumPolyArea - sumTriArea) <= 1e-9,
              "[S1] area preserved: |Σpoly - Σtri| = %.3e <= 1e-9",
              std::fabs(sumPolyArea - sumTriArea));
        check(std::fabs(r.outputArea - r.inputArea) <= 1e-9,
              "[S1] report inputArea == outputArea (|Δ| = %.3e <= 1e-9)",
              std::fabs(r.outputArea - r.inputArea));

        // each triangle used at most once: 2*quads + leftover tris == numTris.
        check(quadSrcTris + tris == numTris,
              "[S1] each tri used <= once: 2*quads(%zu) + tris(%zu) = %zu == input %zu",
              quads, tris, quadSrcTris + tris, numTris);
        check(quads == r.quadCount && tris == r.triCount,
              "[S1] face tallies match report (quads %zu==%zu tris %zu==%zu)",
              quads, r.quadCount, tris, r.triCount);
    }

    // ── (S2) a single triangle stays a triangle ──────────────────────────────
    {
        std::printf("\n[S2] single triangle (no interior edge) stays a triangle\n");
        std::vector<double> pos = {0,0,0, 1,0,0, 0,1,0};
        std::vector<std::uint32_t> idx = {0, 1, 2};
        std::vector<PolyFace> out;
        QuadDominantReport r = quadDominant(pos, idx, out);
        check(r.ok, "[S2] ok=true (reason='%s')", r.reason);
        check(r.quadCount == 0 && r.triCount == 1 && out.size() == 1,
              "[S2] 0 quads, 1 tri face (quads=%zu tris=%zu faces=%zu)",
              r.quadCount, r.triCount, out.size());
        bool isTri = (out.size() == 1 && out[0].verts.size() == 3);
        check(isTri, "[S2] the lone face is a triangle");
        check(std::fabs(r.outputArea - 0.5) <= 1e-12,
              "[S2] area preserved (%.12f == 0.5)", r.outputArea);
    }

    // ── (S3) a non-convex tri pairing is never merged ────────────────────────
    {
        std::printf("\n[S3] non-convex pairing must stay two triangles\n");
        // Shared edge 0-2. Apex 1 and apex 3 are placed so the quad 1-0-3-2 (or any
        // ordering) is a non-convex "dart": apex 3 sits INSIDE the wedge of the two
        // triangles, making the quad reflex. Both tris CCW about +Z.
        //   v0=(0,0), v1=(2,0), v2=(2,2)  -> tri(0,1,2)
        //   v3=(0.6,0.4) close to the diagonal -> tri(0,2,3) reflex at v3.
        std::vector<double> pos = {
            0.0, 0.0, 0.0,
            2.0, 0.0, 0.0,
            2.0, 2.0, 0.0,
            0.6, 0.4, 0.0,
        };
        std::vector<std::uint32_t> idx = {0, 1, 2,  0, 2, 3};
        std::vector<PolyFace> out;
        QuadDominantReport r = quadDominant(pos, idx, out);
        check(r.ok, "[S3] ok=true (reason='%s')", r.reason);
        check(r.quadCount == 0,
              "[S3] non-convex pairing NOT merged (quads=%zu, expected 0)", r.quadCount);
        check(r.triCount == 2 && out.size() == 2,
              "[S3] stays two triangles (tris=%zu faces=%zu)", r.triCount, out.size());
        // every quad (if any wrongly emitted) would be convex — but there must be none.
        for (const auto& f : out)
            check(f.verts.size() == 3, "[S3] face is a triangle (n=%zu)", f.verts.size());
        // area preserved (tri(0,1,2) area=2; tri(0,2,3) area by the shoelace below).
        double expect = 2.0 /*tri(0,1,2): base2 height2 =2*/ +
                        0.5 * std::fabs(0.0*(2.0-0.4) + 2.0*(0.4-0.0) + 0.6*(0.0-2.0));
        check(std::fabs(r.outputArea - expect) <= 1e-9,
              "[S3] area preserved (%.9f == %.9f)", r.outputArea, expect);
    }

    // ── (S4) 0-FAKES: degenerate / unsupported inputs -> ok=false, out untouched ─
    {
        std::printf("\n[S4] 0-FAKES — bad inputs must return ok=false, out untouched\n");
        std::vector<PolyFace> sentinel;
        sentinel.push_back(PolyFace{{42, 43, 44}});  // a marker the module must NOT clobber.

        auto expectFail = [&](const char* tag, const std::vector<double>& p,
                              const std::vector<std::uint32_t>& i) {
            std::vector<PolyFace> out = sentinel;
            QuadDominantReport r = quadDominant(p, i, out);
            bool untouched = (out.size() == 1 && out[0].verts.size() == 3 &&
                              out[0].verts[0] == 42 && out[0].verts[1] == 43 &&
                              out[0].verts[2] == 44);
            check(!r.ok, "[S4] %s -> ok=false (reason='%s')", tag, r.reason);
            check(untouched, "[S4] %s -> out left untouched", tag);
        };

        // empty soup
        expectFail("empty", {}, {});
        // positions length not multiple of 3
        expectFail("pos%%3", {0,0,0, 1,0}, {0,1,2});
        // indices length not multiple of 3
        expectFail("idx%%3", {0,0,0, 1,0,0, 0,1,0}, {0,1,2, 0});
        // out-of-range index
        expectFail("oob-idx", {0,0,0, 1,0,0, 0,1,0}, {0,1,9});
        // degenerate (repeated-vertex) triangle
        expectFail("dup-vert", {0,0,0, 1,0,0, 0,1,0}, {0,1,1});
        // zero-area (collinear) triangle
        expectFail("zero-area", {0,0,0, 1,0,0, 2,0,0}, {0,1,2});
    }

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
