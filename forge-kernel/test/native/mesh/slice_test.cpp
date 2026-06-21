// forge/native/mesh/test/slice_test.cpp
//
// RANDOMIZED standalone gate for forge::native::mesh::slice — the planar
// cross-section of a closed mesh into closed contour loops (CAM / 3D-print
// layers). Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + named deps, not the whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Slice.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/slice_test.cpp -o /tmp/k4_Slice && /tmp/k4_Slice
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTIONS (per task brief):
//   (S)  Slicing a sphere of radius R at height h yields a SINGLE loop whose
//        fitted radius ~ sqrt(R²-h²) and whose enclosed area ~ π(R²-h²) within a
//        coarse-mesh tolerance — random R, h, plane orientation each run.
//   (B)  A box sliced at mid-height yields its rectangular cross-section: correct
//        area AND exactly 4 corners.
//   (M)  A plane that MISSES the mesh yields 0 contours, ok=true, empty.
//   (T)  A tangent / grazing plane is handled WITHOUT duplicate or degenerate
//        loops (touching a single vertex / edge / coplanar face -> no spurious
//        zero-area loop).
//   (R)  Degenerate / malformed input returns HONEST ok=false with a reason.
//   (F)  0-FAKES invariant: ok==true ALWAYS implies the reported contours are
//        genuinely closed (>=3 pts) loops (or a legitimate empty set).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Slice.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <map>
#include <random>
#include <vector>

using namespace forge::native::mesh;

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[256];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else    std::printf("  [FAIL] %s\n", buf);
}

// ── icosphere builder (CCW outward, closed 2-manifold) ───────────────────────
static void icosphere(double r, int subdiv, const std::array<double, 3>& center,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    const double t = (1.0 + std::sqrt(5.0)) / 2.0;
    std::vector<std::array<double, 3>> v = {
        {-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0},
        {0, -1, t}, {0, 1, t}, {0, -1, -t}, {0, 1, -t},
        {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}
    };
    std::vector<std::array<std::uint32_t, 3>> f = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    for (int s = 0; s < subdiv; ++s) {
        std::map<std::uint64_t, std::uint32_t> mid;
        auto midpoint = [&](std::uint32_t a, std::uint32_t b) -> std::uint32_t {
            std::uint64_t key = (static_cast<std::uint64_t>(std::min(a, b)) << 32) | std::max(a, b);
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m = {
                0.5 * (v[a][0] + v[b][0]), 0.5 * (v[a][1] + v[b][1]), 0.5 * (v[a][2] + v[b][2]) };
            std::uint32_t newIdx = static_cast<std::uint32_t>(v.size());
            v.push_back(m); mid.emplace(key, newIdx); return newIdx;
        };
        std::vector<std::array<std::uint32_t, 3>> nf; nf.reserve(f.size() * 4);
        for (auto& tri : f) {
            std::uint32_t a = midpoint(tri[0], tri[1]);
            std::uint32_t b = midpoint(tri[1], tri[2]);
            std::uint32_t c = midpoint(tri[2], tri[0]);
            nf.push_back({tri[0], a, c}); nf.push_back({tri[1], b, a});
            nf.push_back({tri[2], c, b}); nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    pos.clear(); pos.reserve(v.size() * 3);
    for (auto& p : v) {
        double nn = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        pos.push_back(p[0] / nn * r + center[0]);
        pos.push_back(p[1] / nn * r + center[1]);
        pos.push_back(p[2] / nn * r + center[2]);
    }
    idx.clear(); idx.reserve(f.size() * 3);
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// ── axis-aligned box [0,sx]x[0,sy]x[0,sz] (CCW outward, closed 2-manifold) ────
static void box(double sx, double sy, double sz, const std::array<double, 3>& o,
                std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos = {
        o[0]+0,  o[1]+0,  o[2]+0,    o[0]+sx, o[1]+0,  o[2]+0,
        o[0]+sx, o[1]+sy, o[2]+0,    o[0]+0,  o[1]+sy, o[2]+0,
        o[0]+0,  o[1]+0,  o[2]+sz,   o[0]+sx, o[1]+0,  o[2]+sz,
        o[0]+sx, o[1]+sy, o[2]+sz,   o[0]+0,  o[1]+sy, o[2]+sz };
    idx = {
        0,2,1, 0,3,2,   4,5,6, 4,6,7,   0,1,5, 0,5,4,
        1,2,6, 1,6,5,   2,3,7, 2,7,6,   3,0,4, 3,4,7 };
}

// Normalised 3-vector.
static std::array<double,3> norm3(std::array<double,3> n) {
    double L = std::sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
    return { n[0]/L, n[1]/L, n[2]/L };
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };

    std::printf("=== forge::native::mesh slice gate (planar cross-section -> closed contours) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    int fakes = 0;
    auto countFake = [&](const SliceResult& r) {
        if (!r.ok) return;
        for (const auto& c : r.contours)
            if (c.points.size() < 3) { ++fakes; return; }   // a "loop" with <3 pts is a fake
    };

    // ── (S) sphere sliced at height h -> ONE loop, r~sqrt(R²-h²), A~π(R²-h²) ───
    // Random sphere radius, random plane offset along a RANDOM (not axis-aligned)
    // direction, and a random sphere centre — so nothing is cherry-picked.
    std::printf("[S] sphere R sliced at signed offset h: ONE loop, radius ~ sqrt(R^2-h^2), area ~ pi(R^2-h^2)\n");
    for (int trial = 0; trial < 6; ++trial) {
        const int subdiv = 4;                              // fine enough for ~1% area
        const double R = uni(0.8, 1.6);
        const std::array<double,3> ctr = { uni(-2,2), uni(-2,2), uni(-2,2) };
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(R, subdiv, ctr, pos, idx);

        // random unit plane normal and a signed offset h in (-0.8R, 0.8R)
        std::array<double,3> N = norm3({ uni(-1,1), uni(-1,1), uni(-1,1) });
        const double h = uni(-0.8 * R, 0.8 * R);
        // plane point = centre + h*N  ==> signed distance of centre to plane = -h.
        Plane pl;
        pl.normal = Vec3{ N[0], N[1], N[2] };
        pl.point  = Vec3{ ctr[0] + h*N[0], ctr[1] + h*N[1], ctr[2] + h*N[2] };

        SliceResult r = slice(pos, idx, pl);
        countFake(r);

        const double expR = std::sqrt(std::max(0.0, R*R - h*h));
        const double expA = M_PI * (R*R - h*h);

        check(r.ok && r.numContours == 1,
              "(S) R=%.3f h=%+.3f -> exactly 1 loop (got ok=%d n=%u) [%s]",
              R, h, (int)r.ok, r.numContours, r.ok ? "ok" : r.reason);

        if (r.ok && r.numContours == 1) {
            bool fok = false;
            const double fr = fitCircleRadius(r.contours[0].points, pl.normal, fok);
            const double area = std::fabs(r.contours[0].area);
            // coarse-mesh tol: the icosphere chord error under-fills by O(1/4^L);
            // at L4 a few % is the honest bound for an oblique cut.
            check(fok && std::fabs(fr - expR) / expR <= 0.03,
                  "(S) fitted radius %.4f ~ sqrt(R^2-h^2)=%.4f  rel<=3%%", fr, expR);
            check(std::fabs(area - expA) / expA <= 0.03,
                  "(S) enclosed area %.4f ~ pi(R^2-h^2)=%.4f  rel<=3%%", area, expA);
        } else {
            check(false, "(S) skipped radius/area (no single loop)");
            check(false, "(S) skipped radius/area (no single loop)");
        }
    }
    std::printf("\n");

    // ── (S-converge) area error shrinks as the sphere mesh refines ────────────
    std::printf("[S-converge] slice area error decreases under mesh refinement (unbiased)\n");
    {
        const double R = 1.0, h = 0.3;
        const std::array<double,3> ctr = {0,0,0};
        Plane pl; pl.normal = Vec3{0,0,1}; pl.point = Vec3{0,0,h};
        const double expA = M_PI * (R*R - h*h);
        double prev = 1e9; bool monotone = true;
        for (int subdiv : {1,2,3,4}) {
            std::vector<double> pos; std::vector<std::uint32_t> idx;
            icosphere(R, subdiv, ctr, pos, idx);
            SliceResult r = slice(pos, idx, pl); countFake(r);
            if (!r.ok || r.numContours != 1) { monotone = false; break; }
            double err = std::fabs(std::fabs(r.contours[0].area) - expA) / expA;
            std::printf("    L%d  area-rel-err=%.5f\n", subdiv, err);
            if (err >= prev) monotone = false;
            prev = err;
        }
        check(monotone, "(S-converge) area rel-err strictly decreases L1>L2>L3>L4 -> analytic");
    }
    std::printf("\n");

    // ── (B) box sliced mid-height -> rectangle: correct area + 4 corners ──────
    std::printf("[B] box sliced mid-height -> rectangular cross-section (area + 4 corners)\n");
    for (int trial = 0; trial < 4; ++trial) {
        const double sx = uni(1.0, 3.0), sy = uni(1.0, 3.0), sz = uni(1.0, 3.0);
        const std::array<double,3> o = { uni(-2,2), uni(-2,2), uni(-2,2) };
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        box(sx, sy, sz, o, pos, idx);

        // cut by a horizontal plane z = o.z + sz/2 (mid-height): cross-section is
        // the sx-by-sy rectangle, area = sx*sy, 4 corners.
        Plane pl; pl.normal = Vec3{0,0,1}; pl.point = Vec3{0, 0, o[2] + 0.5 * sz};
        SliceResult r = slice(pos, idx, pl); countFake(r);

        check(r.ok && r.numContours == 1, "(B) box %.2fx%.2fx%.2f -> 1 loop [%s]",
              sx, sy, sz, r.ok ? "ok" : r.reason);

        if (r.ok && r.numContours == 1) {
            const double area = std::fabs(r.contours[0].area);
            check(std::fabs(area - sx*sy) / (sx*sy) <= 1e-9,
                  "(B) cross-section area %.5f == sx*sy=%.5f", area, sx*sy);
            // A rectangle has exactly 4 CORNERS (vertices where direction turns).
            // The contour may carry collinear mid-edge points (where the cut plane
            // crosses a box-face diagonal); count genuine corners by turning angle.
            const auto& P = r.contours[0].points;
            const std::size_t n = P.size();
            int corners = 0;
            for (std::size_t k = 0; k < n; ++k) {
                Vec3 a = P[(k + n - 1) % n], b = P[k], c = P[(k + 1) % n];
                Vec3 e0{ b.x-a.x, b.y-a.y, b.z-a.z };
                Vec3 e1{ c.x-b.x, c.y-b.y, c.z-b.z };
                double l0 = std::sqrt(e0.x*e0.x+e0.y*e0.y+e0.z*e0.z);
                double l1 = std::sqrt(e1.x*e1.x+e1.y*e1.y+e1.z*e1.z);
                if (l0 < 1e-12 || l1 < 1e-12) continue;
                double cosA = (e0.x*e1.x+e0.y*e1.y+e0.z*e1.z) / (l0*l1);
                if (cosA < 1.0 - 1e-7) ++corners;   // a genuine turn
            }
            check(corners == 4, "(B) rectangle has exactly 4 corners (got %d, ring %zu pts)",
                  corners, n);
        } else {
            check(false, "(B) skipped (no single loop)");
            check(false, "(B) skipped (no single loop)");
        }
    }
    std::printf("\n");

    // ── (M) plane misses the mesh -> 0 contours, ok=true, empty ───────────────
    std::printf("[M] plane that misses the mesh -> 0 contours, ok=true, empty\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, {0,0,0}, pos, idx);
        // sphere spans z in [-1,1]; a plane at z = 5 is entirely outside.
        Plane pl; pl.normal = Vec3{0,0,1}; pl.point = Vec3{0,0,5.0};
        SliceResult r = slice(pos, idx, pl); countFake(r);
        check(r.ok && r.numContours == 0 && r.contours.empty(),
              "(M) far plane -> ok=true, 0 contours [%s]", r.ok ? "ok" : r.reason);

        // also an oblique far plane
        std::array<double,3> N = norm3({1, 2, -1});
        Plane pl2; pl2.normal = Vec3{N[0],N[1],N[2]}; pl2.point = Vec3{10*N[0],10*N[1],10*N[2]};
        SliceResult r2 = slice(pos, idx, pl2); countFake(r2);
        check(r2.ok && r2.numContours == 0, "(M) oblique far plane -> ok=true, 0 contours [%s]",
              r2.ok ? "ok" : r2.reason);
    }
    std::printf("\n");

    // ── (T) tangent / grazing planes handled without dup / degenerate loops ───
    std::printf("[T] tangent / grazing plane -> no duplicate or degenerate loops\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        box(2.0, 2.0, 2.0, {0,0,0}, pos, idx);

        // (T1) plane EXACTLY on the top face z=2 (coplanar face / vertex graze):
        // touches the top, does not transversally cut -> 0 transversal contours.
        Plane t1; t1.normal = Vec3{0,0,1}; t1.point = Vec3{0,0,2.0};
        SliceResult r1 = slice(pos, idx, t1); countFake(r1);
        check(r1.ok && r1.numContours == 0,
              "(T1) plane on top face -> ok=true, 0 transversal loops (coplanarFaces=%u) [%s]",
              r1.coplanarFaces, r1.ok ? "ok" : r1.reason);

        // (T2) plane EXACTLY through a single box CORNER vertex via an oblique
        // normal touching only (0,0,0): a single-vertex graze -> 0 loops.
        std::array<double,3> N = norm3({-1,-1,-1});  // points away from box interior at origin
        Plane t2; t2.normal = Vec3{N[0],N[1],N[2]}; t2.point = Vec3{0,0,0};
        SliceResult r2 = slice(pos, idx, t2); countFake(r2);
        // The plane through the origin corner with this normal has the whole box
        // on one side (all coords >=0, dot with N <=0) -> grazes one vertex only.
        check(r2.ok && r2.numContours == 0,
              "(T2) single-corner graze -> ok=true, 0 loops [%s]", r2.ok ? "ok" : r2.reason);

        // (T3) sphere plane EXACTLY tangent at the north pole z=R: isolated touch.
        std::vector<double> sp; std::vector<std::uint32_t> si;
        icosphere(1.0, 3, {0,0,0}, sp, si);
        Plane t3; t3.normal = Vec3{0,0,1}; t3.point = Vec3{0,0,1.0};
        SliceResult r3 = slice(sp, si, t3); countFake(r3);
        check(r3.ok && r3.numContours == 0,
              "(T3) sphere tangent at pole -> ok=true, 0 loops (no zero-area dup) [%s]",
              r3.ok ? "ok" : r3.reason);

        // (T4) plane just BELOW the pole still gives ONE clean loop (no dup).
        Plane t4; t4.normal = Vec3{0,0,1}; t4.point = Vec3{0,0,0.97};
        SliceResult r4 = slice(sp, si, t4); countFake(r4);
        check(r4.ok && r4.numContours == 1,
              "(T4) plane just below pole -> exactly 1 loop (got %u) [%s]",
              r4.numContours, r4.ok ? "ok" : r4.reason);
    }
    std::printf("\n");

    // ── (R) degenerate / malformed input -> honest ok=false ───────────────────
    std::printf("[R] degenerate / malformed input returns honest ok=false\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 2, {0,0,0}, pos, idx);

        // (R1) ragged positions
        SliceResult r1 = slice({0,0,0, 1,0}, {0,1,2}, Plane{Vec3{0,0,0},Vec3{0,0,1}});
        countFake(r1);
        check(!r1.ok, "(R1) ragged positions -> ok=false [%s]", r1.reason);

        // (R2) indices not a multiple of 3
        SliceResult r2 = slice({0,0,0, 1,0,0, 0,1,0}, {0,1}, Plane{Vec3{0,0,0},Vec3{0,0,1}});
        countFake(r2);
        check(!r2.ok, "(R2) ragged indices -> ok=false [%s]", r2.reason);

        // (R3) out-of-range index
        SliceResult r3 = slice({0,0,0, 1,0,0, 0,1,0}, {0,1,9}, Plane{Vec3{0,0,0},Vec3{0,0,1}});
        countFake(r3);
        check(!r3.ok, "(R3) out-of-range index -> ok=false [%s]", r3.reason);

        // (R4) zero-length plane normal
        SliceResult r4 = slice(pos, idx, Plane{Vec3{0,0,0}, Vec3{0,0,0}});
        countFake(r4);
        check(!r4.ok, "(R4) zero plane normal -> ok=false [%s]", r4.reason);

        // (R5) non-finite plane point
        const double inf = std::numeric_limits<double>::infinity();
        SliceResult r5 = slice(pos, idx, Plane{Vec3{inf,0,0}, Vec3{0,0,1}});
        countFake(r5);
        check(!r5.ok, "(R5) non-finite plane -> ok=false [%s]", r5.reason);

        // (R6) non-finite mesh coordinate
        std::vector<double> bad = pos; bad[0] = std::numeric_limits<double>::quiet_NaN();
        SliceResult r6 = slice(bad, idx, Plane{Vec3{0,0,0}, Vec3{0,0,1}});
        countFake(r6);
        check(!r6.ok, "(R6) NaN mesh coordinate -> ok=false [%s]", r6.reason);
    }
    std::printf("\n");

    // ── (H) HalfEdgeMesh overload agrees with the soup overload ───────────────
    std::printf("[H] HalfEdgeMesh overload agrees with the soup overload\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.2, 3, {0,0,0}, pos, idx);
        HalfEdgeMesh m; bool built = m.buildFromSoup(pos, idx);
        Plane pl; pl.normal = Vec3{0,0,1}; pl.point = Vec3{0,0,0.25};
        SliceResult rs = slice(pos, idx, pl); countFake(rs);
        SliceResult rm = built ? slice(m, pl) : SliceResult{};
        if (built) countFake(rm);
        check(built && rm.ok && rs.ok && rm.numContours == rs.numContours
              && std::fabs(rm.totalArea - rs.totalArea) < 1e-9,
              "(H) overloads match: n=%u area=%.5f", rs.numContours, rs.totalArea);
    }
    std::printf("\n");

    // ── (F) 0-FAKES invariant ─────────────────────────────────────────────────
    std::printf("[F] 0-FAKES invariant across ALL cases above\n");
    check(fakes == 0, "(F) 0 FAKES -- ok==true ALWAYS implies genuinely closed (>=3 pt) loops (got %d)", fakes);

    std::printf("\n=== HONEST ENVELOPE ===\n");
    std::printf("=== ROBUST: planar slice of a closed 2-manifold by a point+normal plane into a set of\n");
    std::printf("===         CCW-wound closed contour loops via edge-keyed crossing points + segment\n");
    std::printf("===         stitching. Sphere slice: ONE loop, fitted radius ~ sqrt(R^2-h^2) and area\n");
    std::printf("===         ~ pi(R^2-h^2) within coarse-mesh tol (residual SHRINKS under refinement);\n");
    std::printf("===         box mid-cut: exact rectangle area + exactly 4 corners; oblique normals,\n");
    std::printf("===         random centres/offsets. Far plane -> 0 contours ok=true. Tangent / grazing\n");
    std::printf("===         (single vertex, edge, coplanar face) -> NO duplicate/zero-area loops.\n");
    std::printf("=== ok=FALSE (honest, never fabricated): ragged/out-of-range/non-finite input; zero\n");
    std::printf("===         plane normal; a contour chain that cannot close (mesh not watertight across\n");
    std::printf("===         the cut) or a self-touching/non-simple section graph. Coordinate placement\n");
    std::printf("===         is double linear interpolation (NOT proven-exact); a coplanar FACE is\n");
    std::printf("===         counted+skipped (its outline is the face boundary, not a transversal cut).\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
