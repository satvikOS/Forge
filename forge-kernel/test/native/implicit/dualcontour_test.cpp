// forge/native/implicit/dualcontour_test.cpp
//
// Standalone validation gate for the in-house DUAL CONTOURING mesher
// (forge::native::implicit::DualContour) — Stage 4 of KERNEL_INHOUSE_ROADMAP.md,
// the "dual contouring for feature preservation" follow-on to marching cubes.
//
// Build & run (no deps, pure C++20):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/implicit/DualContour.cpp \
//       forge-kernel/src/native/implicit/SdfTree.cpp \
//       forge-kernel/src/native/implicit/IsoMesher.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/test/native/implicit/dualcontour_test.cpp \
//       -o /tmp/dualcontour_test && /tmp/dualcontour_test
//
// Gates (from the increment spec):
//   (a) A BOX SDF reconstructs with SHARP corners — dual-contour vertices land
//       near the true box edges/corners within tolerance, and the corner
//       reconstruction is MEASURABLY sharper than marching cubes at the SAME
//       grid resolution (both run, both measured; MC is the explicit baseline).
//   (b) A SPHERE SDF still encloses volume ≈ 4/3·π·r³ (smooth case not regressed).
//   (c) The output is a CLOSED mesh (no boundary edges — every undirected mesh
//       edge is shared by an even number of triangles).
//
// Every assertion prints PASS/FAIL with the measured number. No faked success.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <string>
#include <vector>

#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"
#include "forge/native/implicit/DualContour.hpp"

using namespace forge::native::implicit;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s — %s\n", name.c_str(), detail.c_str());
    } else {
        std::printf("  [FAIL] %s — %s\n", name.c_str(), detail.c_str());
    }
}

static constexpr double PI = 3.14159265358979323846;

// Distance from a point to the nearest point of the surface of an axis-aligned
// box of half-extent `h` centred at origin (exact box SDF magnitude — the truth
// we compare reconstructed vertices against).
static double boxSurfaceDist(const Vec3& p, double h) {
    const Vec3 q{std::fabs(p.x) - h, std::fabs(p.y) - h, std::fabs(p.z) - h};
    const Vec3 qpos{std::max(q.x, 0.0), std::max(q.y, 0.0), std::max(q.z, 0.0)};
    const double outside = length(qpos);
    const double inside = std::min(std::max(q.x, std::max(q.y, q.z)), 0.0);
    return std::fabs(outside + inside);
}

// Max over the 8 true box corners of: the distance from that corner to the
// NEAREST mesh vertex. A sharp reconstruction reproduces the corner, so some
// vertex sits right on it → small; a rounded (bevelled) reconstruction has no
// vertex at the corner → large. This is the discriminating sharpness metric.
static double maxCornerGap(const Mesh& m, double h) {
    const double s[2] = {-h, h};
    double worst = 0.0;
    for (int a = 0; a < 2; ++a)
        for (int b = 0; b < 2; ++b)
            for (int c = 0; c < 2; ++c) {
                const Vec3 corner{s[a], s[b], s[c]};
                double best = 1e300;
                for (const Vec3& v : m.positions) {
                    const Vec3 d = v - corner;
                    best = std::min(best, length(d));
                }
                worst = std::max(worst, best);
            }
    return worst;
}

// Count undirected mesh edges used an ODD number of times → boundary edges.
// A closed (no-boundary) surface has ZERO such edges (each edge shared by an
// even number of triangles; a clean 2-manifold shares each exactly twice).
static int boundaryEdgeCount(const Mesh& m) {
    std::map<std::pair<int, int>, int> use;
    for (const auto& t : m.triangles) {
        for (int e = 0; e < 3; ++e) {
            int a = t[e];
            int b = t[(e + 1) % 3];
            if (a > b) std::swap(a, b);
            use[{a, b}]++;
        }
    }
    int odd = 0;
    for (const auto& kv : use)
        if (kv.second % 2 != 0) ++odd;
    return odd;
}

// ---------------------------------------------------------------------------
// Gate (a): box sharp-corner reconstruction, dual contour vs marching cubes.
// ---------------------------------------------------------------------------
static void gate_box_sharp_features() {
    std::printf("Gate (a): BOX reconstructs with SHARP corners (DC vs MC baseline)\n");

    const double h = 1.0;                 // half-extent → box [-1,1]^3
    Sdf b = box({0, 0, 0}, {2 * h, 2 * h, 2 * h});

    // Grid OFFSET so cell boundaries do NOT align with the box faces — this is
    // the hard case for marching cubes (faces fall mid-cell, the sharp edge is
    // interior to a cell) and exactly where dual contouring should win. Same
    // grid for both meshers.
    const Vec3 lo{-1.55, -1.55, -1.55};
    const Vec3 hi{1.55, 1.55, 1.55};
    const int n = 16;

    Mesh dc = DualContour::contourCubic(b, lo, hi, n);
    Mesh mc = IsoMesher::marchCubic(b, lo, hi, n);

    std::printf("    DC: verts=%zu tris=%zu    MC: verts=%zu tris=%zu\n",
                dc.positions.size(), dc.triangles.size(),
                mc.positions.size(), mc.triangles.size());

    check(!dc.empty(), "dual-contour box mesh is non-empty",
          std::to_string(dc.triangles.size()) + " triangles");

    // (a1) Every DC vertex must lie NEAR the true box surface (the reconstruction
    // tracks the real boundary, not floating in space). Tolerance ~ one cell.
    const double cell = (hi.x - lo.x) / n;
    double maxOff = 0.0;
    for (const Vec3& v : dc.positions) maxOff = std::max(maxOff, boxSurfaceDist(v, h));
    check(maxOff < 0.6 * cell, "DC vertices lie on the true box surface",
          "max |box SDF| over verts = " + std::to_string(maxOff) +
          " < 0.6*cell=" + std::to_string(0.6 * cell));

    // (a2) THE SHARPNESS COMPARISON: how close does each mesh get to the true
    // box corners? Dual contouring places a vertex AT the corner (QEF minimiser
    // of the three meeting faces); marching cubes bevels it, leaving no vertex
    // near the corner. DC's max corner-gap must be measurably smaller than MC's.
    const double gapDC = maxCornerGap(dc, h);
    const double gapMC = maxCornerGap(mc, h);
    std::printf("    corner-gap (max corner→nearest-vertex): DC=%.4f  MC=%.4f  (smaller = sharper)\n",
                gapDC, gapMC);
    check(gapDC < gapMC, "DC corners are MEASURABLY sharper than marching cubes",
          "gapDC=" + std::to_string(gapDC) + " < gapMC=" + std::to_string(gapMC));

    // (a3) And quantitatively sharp: DC should reach within a small fraction of a
    // cell of each true corner (it reproduces the corner, not just beats MC).
    check(gapDC < 0.5 * cell, "DC reaches the true corners (within half a cell)",
          "gapDC=" + std::to_string(gapDC) + " < 0.5*cell=" + std::to_string(0.5 * cell));
}

// ---------------------------------------------------------------------------
// Gate (b): sphere volume ≈ 4/3·π·r³ (smooth case not regressed by sharp logic).
// ---------------------------------------------------------------------------
static void gate_sphere_volume() {
    std::printf("Gate (b): SPHERE encloses volume ≈ 4/3·π·r³\n");

    const double r = 1.0;
    const double exact = 4.0 / 3.0 * PI * r * r * r;
    const Vec3 lo{-1.5, -1.5, -1.5};
    const Vec3 hi{1.5, 1.5, 1.5};

    Sdf s = sphere({0, 0, 0}, r);

    const std::vector<int> resolutions = {16, 32, 64};
    std::vector<double> relErr;
    for (int n : resolutions) {
        Mesh m = DualContour::contourCubic(s, lo, hi, n);
        const double vol = m.volume();
        const double err = std::fabs(vol - exact) / exact;
        relErr.push_back(err);
        std::printf("    n=%2d  tris=%6zu  volume=%.6f  exact=%.6f  relErr=%.3e\n",
                    n, m.triangles.size(), vol, exact, err);
    }

    // Non-empty, positively oriented (correct winding → positive enclosed volume).
    Mesh m64 = DualContour::contourCubic(s, lo, hi, 64);
    check(!m64.empty() && m64.volume() > 0.0,
          "sphere mesh non-empty & positively oriented",
          "volume=" + std::to_string(m64.volume()) + " > 0");

    // Volume must be within tolerance of analytic at the finest resolution.
    // (Dual contouring of a smooth sphere matches MC's O(h^2) accuracy band.)
    const double finest = relErr.back();
    check(finest < 0.01, "finest-resolution sphere volume within 1% of analytic",
          "relErr[64]=" + std::to_string(finest) + " < 0.01");

    // Convergence: error shrinks as resolution rises (the mesher converges, not
    // just runs). Allow non-strict at the noisy coarse end but require the finest
    // to beat the coarsest by a clear margin.
    check(relErr.back() < relErr.front(),
          "sphere volume error shrinks with resolution",
          "relErr[16]=" + std::to_string(relErr.front()) +
          " -> relErr[64]=" + std::to_string(relErr.back()));
}

// ---------------------------------------------------------------------------
// Gate (c): output is a CLOSED mesh (no boundary edges).
// ---------------------------------------------------------------------------
static void gate_closed_mesh() {
    std::printf("Gate (c): output is a CLOSED mesh (no boundary edges)\n");

    // Box.
    Sdf b = box({0, 0, 0}, {2, 2, 2});
    Mesh mb = DualContour::contourCubic(b, {-1.55, -1.55, -1.55}, {1.55, 1.55, 1.55}, 16);
    const int bb = boundaryEdgeCount(mb);
    std::printf("    box   : verts=%zu tris=%zu boundary-edges=%d\n",
                mb.positions.size(), mb.triangles.size(), bb);
    check(bb == 0, "box dual-contour mesh has no boundary edges (closed)",
          std::to_string(bb) + " odd-use edges");

    // Sphere.
    Sdf s = sphere({0, 0, 0}, 1.0);
    Mesh ms = DualContour::contourCubic(s, {-1.5, -1.5, -1.5}, {1.5, 1.5, 1.5}, 24);
    const int sb = boundaryEdgeCount(ms);
    std::printf("    sphere: verts=%zu tris=%zu boundary-edges=%d\n",
                ms.positions.size(), ms.triangles.size(), sb);
    check(sb == 0, "sphere dual-contour mesh has no boundary edges (closed)",
          std::to_string(sb) + " odd-use edges");

    // CSG box-minus-sphere (has BOTH sharp box edges and a smooth cavity): still
    // closed.
    Sdf cut = differenceOp(box({0, 0, 0}, {2, 2, 2}), sphere({0, 0, 0}, 0.8));
    Mesh mc = DualContour::contourCubic(cut, {-1.55, -1.55, -1.55}, {1.55, 1.55, 1.55}, 24);
    const int cb = boundaryEdgeCount(mc);
    std::printf("    box-sphere CSG: verts=%zu tris=%zu boundary-edges=%d\n",
                mc.positions.size(), mc.triangles.size(), cb);
    check(cb == 0, "CSG dual-contour mesh has no boundary edges (closed)",
          std::to_string(cb) + " odd-use edges");
}

int main() {
    std::printf("=== forge::native::implicit::DualContour — Stage 4 sharp-feature gate ===\n\n");

    gate_box_sharp_features();
    std::printf("\n");
    gate_sphere_volume();
    std::printf("\n");
    gate_closed_mesh();

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
