// forge/native/mesh/test/projectsilhouette_test.cpp
//
// RANDOMIZED standalone gate for forge::native::mesh::projectSilhouette — the
// projection of a triangle mesh onto a plane (along a view/pull direction) and
// extraction of the OUTER silhouette outline (boundary of the union of the
// projected triangles) as closed 2D contour(s), for 2D drawings / drafting /
// nesting. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + named deps, not the whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/ProjectSilhouette.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/projectsilhouette_test.cpp \
//       -o /tmp/k7_ProjectSilhouette && /tmp/k7_ProjectSilhouette
//
// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION DIRECTION CONVENTION (asserted in the header doc):
//   `dir` is the VIEW / PULL direction — the direction the parallel projection
//   rays travel. The projection plane has normal N = normalize(dir); each point
//   maps to (u,v) in a right-handed (U,V,N) frame (U × V = N). The silhouette is
//   the shadow cast along +dir. dir and -dir give the same silhouette SHAPE.
//
// SPEC ASSERTIONS (per task brief):
//   (S)  A SPHERE projects to a CIRCLE outline: ONE outer contour, fitted radius
//        ~ R and enclosed area ~ pi R^2 within a resolution-set tolerance; the
//        residual SHRINKS as the grid refines (random R, centre, dir each run).
//   (B)  A BOX projects to its rectangular silhouette along an axis (correct
//        area = product of the two perpendicular sides) AND to a 6-sided
//        (hexagonal) silhouette along a body-diagonal direction.
//   (TOR) A TORUS projected ALONG ITS AXIS yields an ANNULUS: exactly 2 contours
//        (one outer, one inner HOLE); outer area ~ pi*Ro^2, hole area ~ pi*Ri^2.
//   (C)  A CONCAVE shape (L-shaped prism) KEEPS its concavity: its silhouette
//        area equals the L area (strictly LESS than the bounding-box area, which
//        a convex hull would wrongly report).
//   (DS) dir and -dir produce the SAME silhouette area/shape (shadow symmetry).
//   (CV) Area error DECREASES monotonically under grid refinement (unbiased).
//   (R)  Degenerate / malformed input returns HONEST ok=false with a reason.
//   (F)  0-FAKES invariant: ok==true ALWAYS implies the reported contours are
//        genuinely closed (>=3 pts), nonzero-area loops (or a legitimate empty
//        set).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/ProjectSilhouette.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstddef>
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

// ── torus about the +Z axis: major radius Ro_centerline R, tube radius rt ─────
// Returns a closed 2-manifold. nMaj segments around the main ring, nMin around
// the tube. Projected ALONG +Z it is an annulus with outer radius R+rt and inner
// radius R-rt.
static void torus(double R, double rt, int nMaj, int nMin,
                  std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    auto vid = [&](int i, int j) -> std::uint32_t {
        return static_cast<std::uint32_t>((i % nMaj) * nMin + (j % nMin));
    };
    for (int i = 0; i < nMaj; ++i) {
        const double a = 2.0 * M_PI * i / nMaj;
        const double ca = std::cos(a), sa = std::sin(a);
        for (int j = 0; j < nMin; ++j) {
            const double b = 2.0 * M_PI * j / nMin;
            const double cb = std::cos(b), sb = std::sin(b);
            const double x = (R + rt * cb) * ca;
            const double y = (R + rt * cb) * sa;
            const double z = rt * sb;
            pos.push_back(x); pos.push_back(y); pos.push_back(z);
        }
    }
    for (int i = 0; i < nMaj; ++i) {
        for (int j = 0; j < nMin; ++j) {
            std::uint32_t a = vid(i, j);
            std::uint32_t b = vid(i + 1, j);
            std::uint32_t c = vid(i + 1, j + 1);
            std::uint32_t d = vid(i, j + 1);
            // outward winding (CCW seen from outside)
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
    }
}

// ── L-shaped prism (CONCAVE) extruded along Z. Footprint is an "L" occupying a
// big square of side `s` MINUS a corner square of side `s/2`. Area = s^2 -
// (s/2)^2 = 0.75 s^2. The L is a concave hexagon; its bounding box area is s^2.
static void lPrism(double s, double h, std::vector<double>& pos,
                   std::vector<std::uint32_t>& idx) {
    const double m = s * 0.5;
    // 6 footprint corners CCW (concave at the inner corner):
    //   (0,0) (s,0) (s,m) (m,m) (m,s) (0,s)
    std::array<std::array<double,2>,6> fp = {{
        {0,0}, {s,0}, {s,m}, {m,m}, {m,s}, {0,s}
    }};
    pos.clear(); idx.clear();
    // bottom ring z=0 (indices 0..5), top ring z=h (indices 6..11)
    for (int z = 0; z < 2; ++z) {
        const double zz = z == 0 ? 0.0 : h;
        for (auto& c : fp) { pos.push_back(c[0]); pos.push_back(c[1]); pos.push_back(zz); }
    }
    auto B = [](int i){ return static_cast<std::uint32_t>(i); };       // bottom 0..5
    auto T = [](int i){ return static_cast<std::uint32_t>(6 + i); };   // top    6..11
    // side walls (6 quads). Outward normals; bottom CCW so side a=fp[i] b=fp[i+1].
    for (int i = 0; i < 6; ++i) {
        int j = (i + 1) % 6;
        // quad (Bi, Bj, Tj, Ti) outward
        idx.push_back(B(i)); idx.push_back(B(j)); idx.push_back(T(j));
        idx.push_back(B(i)); idx.push_back(T(j)); idx.push_back(T(i));
    }
    // bottom cap (faces down, CW when viewed from +Z so normal is -Z). Fan from 0.
    // Triangulate the L footprint as a fan from corner 0 — valid for THIS L since
    // corner 0 sees all others (it's the convex corner opposite the notch).
    for (int i = 1; i + 1 < 6; ++i) {
        // bottom: normal -Z -> wind CW seen from above => (0, i+1, i)
        idx.push_back(B(0)); idx.push_back(B(i + 1)); idx.push_back(B(i));
        // top: normal +Z -> wind CCW seen from above => (0, i, i+1)
        idx.push_back(T(0)); idx.push_back(T(i)); idx.push_back(T(i + 1));
    }
}

static std::array<double,3> norm3(std::array<double,3> n) {
    double L = std::sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
    return { n[0]/L, n[1]/L, n[2]/L };
}

// Count genuine corners of a 2D ring by turning angle (collinear pts ignored).
static int countCorners(const std::vector<Point2D>& P) {
    const std::size_t n = P.size();
    int corners = 0;
    for (std::size_t k = 0; k < n; ++k) {
        const Point2D& a = P[(k + n - 1) % n];
        const Point2D& b = P[k];
        const Point2D& c = P[(k + 1) % n];
        const double e0x = b.u - a.u, e0y = b.v - a.v;
        const double e1x = c.u - b.u, e1y = c.v - b.v;
        const double l0 = std::sqrt(e0x*e0x + e0y*e0y);
        const double l1 = std::sqrt(e1x*e1x + e1y*e1y);
        if (l0 < 1e-12 || l1 < 1e-12) continue;
        const double cosA = (e0x*e1x + e0y*e1y) / (l0*l1);
        if (cosA < 1.0 - 1e-6) ++corners;
    }
    return corners;
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };

    std::printf("=== forge::native::mesh projectSilhouette gate "
                "(union-of-projected-triangles outline) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);
    std::printf("=== CONVENTION: dir = view/pull direction; plane normal N=normalize(dir);\n");
    std::printf("===   right-handed (U,V,N), U x V = N; silhouette = shadow along +dir. ===\n\n");

    int fakes = 0;
    auto countFake = [&](const SilhouetteResult& r) {
        if (!r.ok) return;
        for (const auto& c : r.contours)
            if (c.points.size() < 3 || std::fabs(c.signedArea) == 0.0) { ++fakes; return; }
    };
    auto outerArea = [&](const SilhouetteResult& r) -> double {
        double a = 0.0;
        for (const auto& c : r.contours) if (c.signedArea > 0.0) a += c.signedArea;
        return a;
    };

    // ── (S) sphere -> circle: ONE outer loop, radius ~ R, area ~ pi R^2 ───────
    std::printf("[S] sphere projects to a CIRCLE outline: 1 outer loop, r~R, area~pi*R^2\n");
    for (int trial = 0; trial < 5; ++trial) {
        const double R = uni(0.7, 1.7);
        const std::array<double,3> ctr = { uni(-2,2), uni(-2,2), uni(-2,2) };
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(R, 4, ctr, pos, idx);
        const std::array<double,3> Nd = norm3({ uni(-1,1), uni(-1,1), uni(-1,1) });
        const Vec3 dir{ Nd[0], Nd[1], Nd[2] };

        SilhouetteResult r = projectSilhouette(pos, idx, dir, 512);
        countFake(r);

        check(r.ok && r.numOuter == 1 && r.numHoles == 0,
              "(S) R=%.3f -> 1 outer loop, 0 holes (got ok=%d outer=%u holes=%u) [%s]",
              R, (int)r.ok, r.numOuter, r.numHoles, r.ok ? "ok" : r.reason);

        if (r.ok && r.numOuter == 1 && r.numHoles == 0) {
            // the single outer contour
            const SilhouetteContour* oc = nullptr;
            for (const auto& c : r.contours) if (c.signedArea > 0.0) oc = &c;
            bool fok = false;
            const double fr = oc ? fitCircleRadius2D(oc->points, fok) : 0.0;
            const double area = outerArea(r);
            const double expA = M_PI * R * R;
            check(fok && std::fabs(fr - R) / R <= 0.02,
                  "(S) fitted radius %.4f ~ R=%.4f  rel<=2%%", fr, R);
            check(std::fabs(area - expA) / expA <= 0.02,
                  "(S) silhouette area %.4f ~ pi*R^2=%.4f  rel<=2%%", area, expA);
        } else {
            check(false, "(S) skipped radius (no clean single circle)");
            check(false, "(S) skipped area   (no clean single circle)");
        }
    }
    std::printf("\n");

    // ── (CV) area error shrinks under grid refinement (unbiased convergence) ──
    std::printf("[CV] sphere silhouette area error decreases under grid refinement\n");
    {
        const double R = 1.0;
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(R, 5, {0,0,0}, pos, idx);
        const Vec3 dir{0,0,1};
        const double expA = M_PI * R * R;
        double prev = 1e9; bool monotone = true;
        for (std::uint32_t resn : {32u, 64u, 128u, 256u, 512u}) {
            SilhouetteResult r = projectSilhouette(pos, idx, dir, resn); countFake(r);
            if (!r.ok || r.numOuter != 1) { monotone = false; break; }
            const double err = std::fabs(outerArea(r) - expA) / expA;
            std::printf("    res=%4u  area-rel-err=%.5f\n", resn, err);
            if (err >= prev + 1e-12) monotone = false;
            prev = err;
        }
        check(monotone, "(CV) area rel-err non-increasing as resolution 32->512 -> analytic");
    }
    std::printf("\n");

    // ── (B) box -> rectangle along an axis, hexagon along a body diagonal ─────
    std::printf("[B] box projects to a rectangle (axis) and a hexagon (body diagonal)\n");
    for (int trial = 0; trial < 3; ++trial) {
        const double sx = uni(1.2, 3.0), sy = uni(1.2, 3.0), sz = uni(1.2, 3.0);
        const std::array<double,3> o = { uni(-2,2), uni(-2,2), uni(-2,2) };
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        box(sx, sy, sz, o, pos, idx);

        // (B-axis) project along +Z -> the sx-by-sy rectangle, area = sx*sy, 4 corners
        SilhouetteResult ra = projectSilhouette(pos, idx, Vec3{0,0,1}, 512); countFake(ra);
        check(ra.ok && ra.numOuter == 1 && ra.numHoles == 0,
              "(B-axis) box %.2fx%.2fx%.2f along +Z -> 1 rect loop [%s]",
              sx, sy, sz, ra.ok ? "ok" : ra.reason);
        if (ra.ok && ra.numOuter == 1) {
            const double area = outerArea(ra);
            check(std::fabs(area - sx*sy) / (sx*sy) <= 0.02,
                  "(B-axis) rect area %.4f ~ sx*sy=%.4f rel<=2%%", area, sx*sy);
            const SilhouetteContour* oc = nullptr;
            for (const auto& c : ra.contours) if (c.signedArea > 0.0) oc = &c;
            check(oc && countCorners(oc->points) == 4,
                  "(B-axis) rectangle has exactly 4 corners (got %d)",
                  oc ? countCorners(oc->points) : -1);
        } else {
            check(false, "(B-axis) skipped area");
            check(false, "(B-axis) skipped corners");
        }

        // (B-diag) project a CUBE along its body diagonal (1,1,1) -> regular
        // hexagon silhouette (6 corners). Use a cube so the hexagon is regular.
        std::vector<double> cpos; std::vector<std::uint32_t> cidx;
        const double s = uni(1.0, 2.5);
        box(s, s, s, {0,0,0}, cpos, cidx);
        SilhouetteResult rdg = projectSilhouette(cpos, cidx, Vec3{1,1,1}, 512); countFake(rdg);
        const SilhouetteContour* hc = nullptr;
        if (rdg.ok) for (const auto& c : rdg.contours) if (c.signedArea > 0.0) hc = &c;
        int corn = hc ? countCorners(hc->points) : -1;
        check(rdg.ok && rdg.numOuter == 1 && rdg.numHoles == 0 && corn == 6,
              "(B-diag) cube along (1,1,1) -> hexagon: 1 loop, 6 corners (got outer=%u corners=%d) [%s]",
              rdg.numOuter, corn, rdg.ok ? "ok" : rdg.reason);
        // The cube body-diagonal hexagon has area = sqrt(3) * s^2.
        if (rdg.ok && rdg.numOuter == 1) {
            const double area = outerArea(rdg);
            const double expA = std::sqrt(3.0) * s * s;
            check(std::fabs(area - expA) / expA <= 0.03,
                  "(B-diag) hexagon area %.4f ~ sqrt(3)*s^2=%.4f rel<=3%%", area, expA);
        } else {
            check(false, "(B-diag) skipped hexagon area");
        }
    }
    std::printf("\n");

    // ── (TOR) torus along its axis -> ANNULUS: 2 contours (outer + inner hole) ─
    std::printf("[TOR] torus projected along its axis -> ANNULUS: 2 contours (1 outer + 1 hole)\n");
    for (int trial = 0; trial < 3; ++trial) {
        const double R  = uni(1.5, 2.5);          // centerline major radius
        const double rt = uni(0.35, 0.6) * R;     // tube radius (< R so a real hole)
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        torus(R, rt, 96, 48, pos, idx);
        const Vec3 dir{0,0,1};                     // along the torus axis

        SilhouetteResult r = projectSilhouette(pos, idx, dir, 512); countFake(r);
        check(r.ok && r.numContours == 2 && r.numOuter == 1 && r.numHoles == 1,
              "(TOR) R=%.2f rt=%.2f -> 2 contours (outer=%u hole=%u) [%s]",
              R, rt, r.numOuter, r.numHoles, r.ok ? "ok" : r.reason);
        if (r.ok && r.numOuter == 1 && r.numHoles == 1) {
            double outerA = 0.0, holeA = 0.0;
            for (const auto& c : r.contours) {
                if (c.signedArea > 0.0) outerA = c.signedArea;
                else holeA = -c.signedArea;
            }
            const double expO = M_PI * (R + rt) * (R + rt);
            const double expI = M_PI * (R - rt) * (R - rt);
            check(std::fabs(outerA - expO) / expO <= 0.03,
                  "(TOR) outer area %.4f ~ pi*(R+rt)^2=%.4f rel<=3%%", outerA, expO);
            check(std::fabs(holeA - expI) / expI <= 0.05,
                  "(TOR) hole  area %.4f ~ pi*(R-rt)^2=%.4f rel<=5%%", holeA, expI);
            // net area (outer minus hole) is the annulus material area
            const double net = r.netArea;
            const double expNet = expO - expI;
            check(std::fabs(net - expNet) / expNet <= 0.05,
                  "(TOR) net area %.4f ~ annulus pi((R+rt)^2-(R-rt)^2)=%.4f rel<=5%%", net, expNet);
        } else {
            check(false, "(TOR) skipped outer area");
            check(false, "(TOR) skipped hole area");
            check(false, "(TOR) skipped net area");
        }
    }
    std::printf("\n");

    // ── (C) concave L-prism keeps its concavity (area < bbox area) ────────────
    std::printf("[C] concave L-prism keeps concavity: silhouette area == L area (< bbox area)\n");
    for (int trial = 0; trial < 3; ++trial) {
        const double s = uni(2.0, 4.0), h = uni(1.0, 3.0);
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        lPrism(s, h, pos, idx);
        // project along +Z -> the L footprint. Area = 0.75 s^2; bbox area = s^2.
        SilhouetteResult r = projectSilhouette(pos, idx, Vec3{0,0,1}, 512); countFake(r);
        const double expA = 0.75 * s * s;
        const double bboxA = s * s;
        const double area = outerArea(r);
        check(r.ok && r.numOuter == 1 && r.numHoles == 0,
              "(C) L-prism s=%.2f along +Z -> 1 outer loop, no hole (outer=%u holes=%u) [%s]",
              s, r.numOuter, r.numHoles, r.ok ? "ok" : r.reason);
        check(r.ok && std::fabs(area - expA) / expA <= 0.02,
              "(C) silhouette area %.4f ~ L area=0.75*s^2=%.4f rel<=2%% (NOT convex bbox %.4f)",
              area, expA, bboxA);
        // The L silhouette must be a concave hexagon (6 corners, one reflex).
        const SilhouetteContour* oc = nullptr;
        if (r.ok) for (const auto& c : r.contours) if (c.signedArea > 0.0) oc = &c;
        int corn = oc ? countCorners(oc->points) : -1;
        check(corn == 6, "(C) L silhouette is a hexagon: 6 corners (got %d)", corn);
        // and strictly smaller than the convex bbox (proves concavity preserved)
        check(area < bboxA * 0.95, "(C) area %.4f strictly < 95%% of bbox %.4f (concavity kept)",
              area, bboxA);
    }
    std::printf("\n");

    // ── (DS) dir and -dir produce the SAME silhouette shape/area (shadow sym) ──
    std::printf("[DS] dir and -dir give the same silhouette area (shadow direction symmetry)\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        lPrism(3.0, 2.0, pos, idx);
        const std::array<double,3> Nd = norm3({ uni(0.2,1), uni(0.2,1), uni(0.2,1) });
        const Vec3 dp{ Nd[0], Nd[1], Nd[2] };
        const Vec3 dn{ -Nd[0], -Nd[1], -Nd[2] };
        SilhouetteResult rp = projectSilhouette(pos, idx, dp, 384); countFake(rp);
        SilhouetteResult rn = projectSilhouette(pos, idx, dn, 384); countFake(rn);
        const double ap = outerArea(rp), an = outerArea(rn);
        check(rp.ok && rn.ok && std::fabs(ap - an) / std::max(ap, an) <= 0.02,
              "(DS) area(+dir)=%.4f ~ area(-dir)=%.4f rel<=2%%", ap, an);
    }
    std::printf("\n");

    // ── (H) HalfEdgeMesh overload agrees with the soup overload ───────────────
    std::printf("[H] HalfEdgeMesh overload agrees with the soup overload\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.3, 4, {0,0,0}, pos, idx);
        HalfEdgeMesh m; bool built = m.buildFromSoup(pos, idx);
        const Vec3 dir{0.3, 0.2, 1.0};
        SilhouetteResult rs = projectSilhouette(pos, idx, dir, 256); countFake(rs);
        SilhouetteResult rm = built ? projectSilhouette(m, dir, 256) : SilhouetteResult{};
        if (built) countFake(rm);
        check(built && rm.ok && rs.ok && rm.numContours == rs.numContours
              && std::fabs(outerArea(rm) - outerArea(rs)) <= 1e-9,
              "(H) overloads match: n=%u area=%.5f", rs.numContours, outerArea(rs));
    }
    std::printf("\n");

    // ── (R) degenerate / malformed input -> honest ok=false ───────────────────
    std::printf("[R] degenerate / malformed input returns honest ok=false\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 2, {0,0,0}, pos, idx);

        // (R1) ragged positions
        SilhouetteResult r1 = projectSilhouette({0,0,0, 1,0}, {0,1,2}, Vec3{0,0,1}, 64);
        countFake(r1);
        check(!r1.ok, "(R1) ragged positions -> ok=false [%s]", r1.reason);

        // (R2) indices not a multiple of 3
        SilhouetteResult r2 = projectSilhouette({0,0,0, 1,0,0, 0,1,0}, {0,1}, Vec3{0,0,1}, 64);
        countFake(r2);
        check(!r2.ok, "(R2) ragged indices -> ok=false [%s]", r2.reason);

        // (R3) out-of-range index
        SilhouetteResult r3 = projectSilhouette({0,0,0, 1,0,0, 0,1,0}, {0,1,9}, Vec3{0,0,1}, 64);
        countFake(r3);
        check(!r3.ok, "(R3) out-of-range index -> ok=false [%s]", r3.reason);

        // (R4) zero-length direction
        SilhouetteResult r4 = projectSilhouette(pos, idx, Vec3{0,0,0}, 64);
        countFake(r4);
        check(!r4.ok, "(R4) zero direction -> ok=false [%s]", r4.reason);

        // (R5) non-finite direction
        const double inf = std::numeric_limits<double>::infinity();
        SilhouetteResult r5 = projectSilhouette(pos, idx, Vec3{inf,0,0}, 64);
        countFake(r5);
        check(!r5.ok, "(R5) non-finite direction -> ok=false [%s]", r5.reason);

        // (R6) non-finite mesh coordinate
        std::vector<double> bad = pos; bad[0] = std::numeric_limits<double>::quiet_NaN();
        SilhouetteResult r6 = projectSilhouette(bad, idx, Vec3{0,0,1}, 64);
        countFake(r6);
        check(!r6.ok, "(R6) NaN mesh coordinate -> ok=false [%s]", r6.reason);

        // (R7) resolution < 2
        SilhouetteResult r7 = projectSilhouette(pos, idx, Vec3{0,0,1}, 1);
        countFake(r7);
        check(!r7.ok, "(R7) resolution < 2 -> ok=false [%s]", r7.reason);

        // (R8) projection along a direction that flattens a FLAT mesh to a line:
        // a single planar quad (in the XY plane) projected along +X is a line ->
        // zero 2D extent -> honest ok=false.
        std::vector<double> flat = { 0,0,0, 1,0,0, 1,1,0, 0,1,0 };
        std::vector<std::uint32_t> fidx = { 0,1,2, 0,2,3 };
        SilhouetteResult r8 = projectSilhouette(flat, fidx, Vec3{0,0,1}, 64); countFake(r8);
        // along +Z the quad has full extent (OK). along +X it collapses to a line:
        SilhouetteResult r8b = projectSilhouette(flat, fidx, Vec3{0,1,0}, 64); countFake(r8b);
        check(r8.ok && !r8b.ok,
              "(R8) flat quad: along +Z ok=%d (area), along in-plane dir ok=%d (degenerate) [%s]",
              (int)r8.ok, (int)r8b.ok, r8b.reason);
    }
    std::printf("\n");

    // ── (F) 0-FAKES invariant ─────────────────────────────────────────────────
    std::printf("[F] 0-FAKES invariant across ALL cases above\n");
    check(fakes == 0,
          "(F) 0 FAKES -- ok==true ALWAYS implies genuinely closed (>=3 pt) nonzero-area loops (got %d)",
          fakes);

    std::printf("\n=== HONEST ENVELOPE ===\n");
    std::printf("=== CONVENTION: dir = view/pull direction; projection plane normal N=normalize(dir);\n");
    std::printf("===   right-handed (U,V,N) frame, U x V = N; output 2D (u,v) is the shadow along +dir;\n");
    std::printf("===   dir and -dir give the SAME silhouette shape.\n");
    std::printf("=== ROBUST: orthographic projection of every triangle onto the plane, UNION rasterized\n");
    std::printf("===   onto an occupancy grid (cell occupied iff its centre is inside ANY projected\n");
    std::printf("===   triangle by EXACT orient2d sign agreement), boundary traced by a filled-on-left\n");
    std::printf("===   marching walk into closed loops: OUTER loops CCW (signedArea>0), HOLE loops CW.\n");
    std::printf("===   Sphere -> 1 circle (fitted radius ~ R, area ~ pi*R^2); box along an axis -> exact\n");
    std::printf("===   rectangle (4 corners); cube along body diagonal -> hexagon (6 corners, area\n");
    std::printf("===   sqrt(3)*s^2); torus along axis -> ANNULUS (2 contours: outer + inner hole);\n");
    std::printf("===   concave L-prism -> concave hexagon (area = L area < bbox, concavity KEPT).\n");
    std::printf("===   Area/radius residuals SHRINK under grid refinement; tolerances are resolution-set.\n");
    std::printf("=== ok=FALSE (honest, never fabricated): ragged/out-of-range/non-finite input; zero or\n");
    std::printf("===   non-finite direction; resolution<2; a projection that collapses the mesh to a line\n");
    std::printf("===   (zero 2D extent). The outline is accurate to ~1 grid cell; a hole/gap THINNER than\n");
    std::printf("===   ~2 cells can be under-resolved (raise resolution). Contour vertex coordinates are\n");
    std::printf("===   doubles at cell-edge midpoints (robust-in-practice), NOT a proven-exact 2D-union\n");
    std::printf("===   arrangement (that remains TARGETED).\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
