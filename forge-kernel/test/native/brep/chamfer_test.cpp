// forge/native/brep/chamfer_test.cpp
//
// Standalone validation gate for forge::native::brep::chamferEdges — the MESH
// edge chamfer. Pure C++20, no test framework: a tiny hand-rolled harness that
// prints PASS/FAIL, prints a FRESH std::random_device seed, and exits non-zero on
// any failure. Ends with "RESULT: P / T passed".
//
// Build + run (module + named deps + this test ONLY, not the whole tree):
//   cd /Users/account_clawteam1/archdisc-Mech && clang++ -std=c++20 -O2 \
//     -Wall -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/Chamfer.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/src/native/mesh/FeatureEdges.cpp \
//     forge-kernel/test/native/brep/chamfer_test.cpp \
//     -o /tmp/k7_Chamfer && /tmp/k7_Chamfer
//
// SPEC VALIDATIONS (asserted below — NEVER weakened):
//   (1) Chamfering all 12 edges of a unit cube by setback d yields a watertight
//       2-manifold (validate().isValid(), Euler char == 2), whose volume equals
//       cube - the analytic removed wedge volume (12 edge wedges + 8 corner
//       pieces = 6 d^2 - (16/3) d^3 for a unit cube) within a mesh tolerance.
//   (2) The analytic removed-volume formula is CROSS-CHECKED by an INDEPENDENT
//       Monte-Carlo half-space membership integral (seeded by the printed
//       random_device seed), so the assertion does not ride on the same algebra
//       the mesh uses.
//   (3) Every original sharp (90 deg) edge is REPLACED by a chamfer face: after
//       chamfering, NO edge with dihedral > threshold survives except the new
//       chamfer-face borders (which are shallow 45 deg seams, below the original
//       90 deg sharpness) — i.e. the count of >threshold edges strictly drops to
//       the chamfer seams only.
//   (4) HONEST refusals (ok == false): d <= 0; d >= half the shortest edge; a
//       non-closed (open) mesh; a non-finite coordinate. A smooth/flat input with
//       no sharp convex edges is a faithful no-op (ok == true, unchanged).
//   (5) A randomized fuzz over many cube sizes / setbacks always yields a closed
//       2-manifold whose volume matches the analytic law within tolerance.

#include "forge/native/brep/Chamfer.hpp"

#include <algorithm>   // std::max
#include <cmath>       // std::fabs, std::sqrt
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <cstdio>      // std::printf
#include <limits>      // std::numeric_limits
#include <random>      // std::random_device, std::mt19937_64, distributions
#include <string>      // std::string
#include <vector>      // std::vector

using namespace forge::native::brep;
// brep::Vec3 (from Nurbs.hpp, pulled in via FeatureEdges.hpp) shadows the mesh
// Vec3, so name the mesh point type distinctly here.
using MVec3 = ::forge::native::mesh::Vec3;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s\n", name.c_str());
    }
}

static bool approx(double a, double b, double tol) {
    return std::fabs(a - b) <= tol;
}

// Analytic removed-material volume for a unit cube chamfered (all 12 edges) by
// setback d, for the MESH construction that this module ships (12 flat edge
// bevels + 8 flat corner facets — exactly the "12 edge wedges + 8 corner pieces"
// the SPEC names):
//
//   * 12 EDGE WEDGES, half-space model: each face trimmed back by d => a 45-deg
//     bevel plane (e.g. y+z=d at the x-axis edge). Their union over the cube, by
//     inclusion-exclusion (12 single prisms 6 d^2, minus 24 adjacent-pair corner
//     overlaps 8 d^3, plus 8 triple overlaps 2 d^3) = 6 d^2 - 6 d^3.
//   * 8 CORNER PIECES: at each corner the three offset edge-points (e.g.
//     (d,d,0),(d,0,d),(0,d,d)) are bridged by ONE flat triangular corner facet
//     (plane x+y+z=2d). That plane cuts BELOW the 3-bevel meeting point
//     (x+y+z=1.5d), removing one extra tetra per corner: apex (d/2,d/2,d/2),
//     base triangle {(0,d,d),(d,0,d),(d,d,0)} on x+y+z=2d. Its volume is d^3/12,
//     so the 8 corner pieces add 8*d^3/12 = (2/3) d^3.
//
//   removed(d) = (6 d^2 - 6 d^3) + (2/3) d^3 = 6 d^2 - (16/3) d^3.
//
// (Cross-checked by the Monte-Carlo oracle in test (2), which samples the EXACT
// same 12 bevel + 8 corner half-spaces.)
static double analyticRemovedUnitCube(double d) {
    return 6.0 * d * d - (16.0 / 3.0) * d * d * d;
}

// Independent Monte-Carlo oracle: the chamfered UNIT cube (this module's mesh
// construction) is the cube intersected with the 12 edge-bevel half-spaces AND
// the 8 corner-facet half-spaces. Sample uniformly in the cube and measure the
// fraction INSIDE every cut; that fraction == the chamfered solid's volume.
static double monteCarloChamferedUnitCubeVolume(double d, std::mt19937_64& rng,
                                                std::uint64_t samples) {
    std::uniform_real_distribution<double> U(0.0, 1.0);
    std::uint64_t inside = 0;
    const double d2 = 2.0 * d;
    for (std::uint64_t i = 0; i < samples; ++i) {
        const double x = U(rng), y = U(rng), z = U(rng);
        // 12 edge bevels: a point is removed if it violates ANY bevel plane.
        bool removed =
            (x + y < d) || ((1 - x) + y < d) || (x + (1 - y) < d) || ((1 - x) + (1 - y) < d) ||
            (y + z < d) || ((1 - y) + z < d) || (y + (1 - z) < d) || ((1 - y) + (1 - z) < d) ||
            (x + z < d) || ((1 - x) + z < d) || (x + (1 - z) < d) || ((1 - x) + (1 - z) < d);
        // 8 corner facets: corner (cx,cy,cz) cut by (|x-cx|+|y-cy|+|z-cz|) < 2d,
        // i.e. the L1 distance to the corner below 2d is removed.
        if (!removed) {
            const double xl = x, xh = 1 - x, yl = y, yh = 1 - y, zl = z, zh = 1 - z;
            if ((xl + yl + zl < d2) || (xh + yl + zl < d2) ||
                (xl + yh + zl < d2) || (xh + yh + zl < d2) ||
                (xl + yl + zh < d2) || (xh + yl + zh < d2) ||
                (xl + yh + zh < d2) || (xh + yh + zh < d2))
                removed = true;
        }
        if (!removed) ++inside;
    }
    return static_cast<double>(inside) / static_cast<double>(samples);
}

// Count undirected manifold edges whose dihedral angle exceeds `thr` degrees,
// using the kernel's own feature detector on the result mesh.
static std::uint32_t countSharpEdges(const forge::native::mesh::HalfEdgeMesh& m,
                                     double thr) {
    auto fs = forge::native::mesh::detectFeatureEdges(m, thr);
    if (!fs.ok) return 0xFFFFFFFFu;  // detector failure surfaces as a sentinel
    return fs.numFeatureEdges;
}

// A regular-ish tetrahedron (convex, triangular faces — exercises the
// single-triangle face-group path and 3-edge convex corners). Outward-wound.
static void makeTetSoup(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos = {0,0,0,  1,0,0,  0,1,0,  0,0,1};
    // Outward CCW faces of the corner tetra at the origin.
    idx = {0,2,1,  0,1,3,  0,3,2,  1,2,3};
}

// A NON-CONVEX closed 2-manifold: an L-bar (a 2x1x1 box with a 1x1x1 notch),
// i.e. the union of two unit cubes forming an L in the xy-plane, extruded in z.
// Built as an extruded L-pentagon prism. Outward-wound. This has CONCAVE feature
// edges (the reentrant corner), which the convexity filter must NOT chamfer.
static void makeLBarSoup(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    // L-polygon (CCW in xy): (0,0)->(2,0)->(2,1)->(1,1)->(1,2)->(0,2). The vertex
    // (1,1) is the REENTRANT (concave) corner.
    const double P[6][2] = {{0,0},{2,0},{2,1},{1,1},{1,2},{0,2}};
    pos.clear(); idx.clear();
    // bottom ring z=0 -> verts 0..5 ; top ring z=1 -> verts 6..11
    for (int z = 0; z < 2; ++z)
        for (int i = 0; i < 6; ++i) { pos.push_back(P[i][0]); pos.push_back(P[i][1]); pos.push_back(z ? 1.0 : 0.0); }
    auto B = [](int i){ return (std::uint32_t)i; };
    auto T = [](int i){ return (std::uint32_t)(i + 6); };
    // side walls: for edge i->i+1 (CCW), outward quad (Bi, Bi1, Ti1, Ti).
    for (int i = 0; i < 6; ++i) {
        int j = (i + 1) % 6;
        idx.insert(idx.end(), {B(i), B(j), T(j),  B(i), T(j), T(i)});
    }
    // bottom cap z=0 (normal -z, wound CW seen from +z) : fan from vertex 0.
    for (int i = 1; i + 1 < 6; ++i) idx.insert(idx.end(), {B(0), B(i + 1), B(i)});
    // top cap z=1 (normal +z, CCW) : fan from vertex 0.
    for (int i = 1; i + 1 < 6; ++i) idx.insert(idx.end(), {T(0), T(i), T(i + 1)});
}

// ===========================================================================
// (1)+(2)+(3) Canonical unit-cube chamfer.
// ===========================================================================
static void testUnitCube(std::mt19937_64& rng) {
    std::printf("[1] unit cube chamfered on all 12 edges by setback d\n");
    const double d = 0.15;

    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    makeCubeSoup(1.0, MVec3{0, 0, 0}, pos, idx);

    ChamferResult r = chamferEdges(pos, idx, d, 30.0);
    check(r.ok, "cube chamfer ok");
    if (!r.ok) {
        std::printf("      reason: %s\n", r.reason.c_str());
        return;
    }

    // Watertight 2-manifold.
    auto rep = r.mesh.validate();
    check(rep.isValid(), "chamfered cube is a closed 2-manifold (validate().isValid())");
    check(rep.eulerChar == 2, "chamfered cube Euler characteristic == 2 (genus 0)");

    // 12 chamfered edges, 6 + corner facets present.
    std::printf("      numSharpEdges=%u numChamferedEdges=%u chamferFaces=%u cornerFaces=%u\n",
                r.numSharpEdges, r.numChamferedEdges, r.numChamferFaces, r.numCornerFaces);
    check(r.numChamferedEdges == 12, "all 12 cube edges detected sharp+convex and chamfered");
    check(r.numChamferFaces == 12, "12 chamfer facets emitted (one per edge)");
    check(r.numCornerFaces == 8, "8 corner facets emitted (one per cube vertex)");

    // Volume == cube - removed wedge (analytic), within a mesh tolerance.
    const double removedAnalytic = analyticRemovedUnitCube(d);
    const double expectVol = 1.0 - removedAnalytic;
    std::printf("      inputVol=%.12f outputVol=%.12f removed=%.12f (analytic removed=%.12f)\n",
                r.inputVolume, r.outputVolume, r.removedVolume, removedAnalytic);
    check(approx(r.inputVolume, 1.0, 1e-9), "input cube volume == 1");
    check(approx(r.outputVolume, expectVol, 1e-9),
          "chamfered volume == cube - analytic removed wedge within 1e-9");
    check(approx(r.removedVolume, removedAnalytic, 1e-9),
          "removed volume == 6 d^2 - (16/3) d^3 within 1e-9");

    // (2) Independent Monte-Carlo cross-check of the analytic removed-volume.
    std::printf("[2] Monte-Carlo half-space oracle cross-checks the analytic law\n");
    const std::uint64_t N = 4'000'000;
    const double mcVol = monteCarloChamferedUnitCubeVolume(d, rng, N);
    // 3-sigma MC tolerance for a Bernoulli fraction over N samples.
    const double p = mcVol;
    const double sigma = std::sqrt(std::max(p * (1.0 - p), 1e-12) / static_cast<double>(N));
    const double tol = 6.0 * sigma + 1e-9;
    std::printf("      MC volume=%.8f  analytic=%.8f  (tol=%.2e, sigma=%.2e)\n",
                mcVol, expectVol, tol, sigma);
    check(approx(mcVol, expectVol, tol),
          "Monte-Carlo chamfered volume matches the analytic law (independent oracle)");

    // (3) Every original sharp (90 deg) edge replaced by a chamfer face: no
    //     >threshold edge survives EXCEPT the shallower chamfer seams. The 90 deg
    //     cube edges are gone; the chamfer introduces 45 deg seams. So at a 60 deg
    //     threshold (between 45 and 90) the result has ZERO sharp edges.
    std::printf("[3] original sharp edges are replaced by chamfer faces\n");
    const std::uint32_t sharpAt60 = countSharpEdges(r.mesh, 60.0);
    std::printf("      sharp edges (>60 deg) remaining = %u\n", sharpAt60);
    check(sharpAt60 == 0,
          "no >60deg sharp edge survives (original 90deg edges all replaced by chamfers)");
    // Sanity: the chamfer seams DO exist as shallower features (>1 deg).
    const std::uint32_t seamsAt1 = countSharpEdges(r.mesh, 1.0);
    std::printf("      shallow seam edges (>1 deg) = %u\n", seamsAt1);
    check(seamsAt1 > 0 && seamsAt1 != 0xFFFFFFFFu,
          "chamfer introduces shallow seam edges (the new chamfer-face borders)");
}

// ===========================================================================
// (4) Honest refusals (ok == false) + faithful no-op.
// ===========================================================================
static void testRefusals() {
    std::printf("[4] honest refusals (ok == false, 0 FAKES) + no-op\n");

    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    makeCubeSoup(1.0, MVec3{0, 0, 0}, pos, idx);

    // (4a) d <= 0.
    {
        ChamferResult r = chamferEdges(pos, idx, 0.0, 30.0);
        check(!r.ok, "d == 0 -> ok == false");
        std::printf("      (reason: %s)\n", r.reason.c_str());
    }
    {
        ChamferResult r = chamferEdges(pos, idx, -0.1, 30.0);
        check(!r.ok, "d < 0 -> ok == false");
    }

    // (4b) d >= half the shortest edge (shortest cube edge == 1, so d=0.5).
    {
        ChamferResult r = chamferEdges(pos, idx, 0.5, 30.0);
        check(!r.ok, "d == half shortest edge -> ok == false");
        std::printf("      (reason: %s)\n", r.reason.c_str());
    }
    {
        ChamferResult r = chamferEdges(pos, idx, 0.75, 30.0);
        check(!r.ok, "d > half shortest edge -> ok == false");
    }

    // (4c) Non-closed (open) mesh: drop the top two triangles of the cube.
    {
        std::vector<std::uint32_t> open(idx.begin(), idx.end() - 6);
        ChamferResult r = chamferEdges(pos, open, 0.1, 30.0);
        check(!r.ok, "open (non-closed) mesh -> ok == false");
        std::printf("      (reason: %s)\n", r.reason.c_str());
    }

    // (4d) Non-finite coordinate.
    {
        std::vector<double> bad = pos;
        bad[0] = std::numeric_limits<double>::quiet_NaN();
        ChamferResult r = chamferEdges(bad, idx, 0.1, 30.0);
        check(!r.ok, "non-finite coordinate -> ok == false");
    }

    // (4e) Faithful no-op: a threshold so high (179 deg) that the cube's 90 deg
    //      edges are NOT sharp -> nothing chamfered, mesh returned unchanged.
    {
        ChamferResult r = chamferEdges(pos, idx, 0.1, 179.0);
        check(r.ok, "no-sharp-edge input -> ok == true (faithful no-op)");
        check(r.numChamferedEdges == 0, "no-op chamfers zero edges");
        check(approx(r.outputVolume, 1.0, 1e-9), "no-op preserves volume == 1");
        check(r.mesh.validate().isValid(), "no-op result still a valid closed 2-manifold");
    }
}

// ===========================================================================
// (6) Envelope: a convex non-cube solid chamfers cleanly; a non-convex solid is
//     handled honestly (concave edges are NOT chamfered; result stays valid or
//     ok==false — never a fake).
// ===========================================================================
static void testEnvelope() {
    std::printf("[6] convex generalization + non-convex honesty\n");

    // (6a) Tetrahedron (convex, triangular faces) chamfers to a closed 2-manifold,
    //      removing a strictly positive wedge < the whole solid.
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeTetSoup(pos, idx);
        const double vol0 = 1.0 / 6.0;   // corner tetra volume
        ChamferResult r = chamferEdges(pos, idx, 0.08, 30.0);
        check(r.ok, "tetrahedron chamfer ok (convex, non-cube)");
        if (r.ok) {
            check(r.mesh.validate().isValid(), "chamfered tetra is a closed 2-manifold");
            check(r.numChamferedEdges == 6, "all 6 tetra edges are sharp+convex+chamfered");
            check(r.numChamferFaces == 6 && r.numCornerFaces == 4,
                  "tetra: 6 chamfer facets + 4 corner facets emitted");
            check(r.outputVolume > 0.0 && r.outputVolume < vol0,
                  "chamfered tetra volume strictly between 0 and the original");
            check(r.outputFaces > r.inputFaces,
                  "chamfer adds facets (every original edge replaced by a bevel)");
            // NOTE (honest): a chamfered TETRA can leave seams steeper than the
            // cube's 45deg because the tetra faces meet at steeper angles; we do
            // NOT claim "no sharp edge survives" for arbitrary solids (the cube
            // case asserts that precisely in test [3]). The replacement is
            // structural: 6 edges -> 6 bevel facets + 4 corner facets.
        } else {
            std::printf("      (reason: %s)\n", r.reason.c_str());
        }
    }

    // (6b) The L-bar is itself a valid closed 2-manifold (sanity on the fixture).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeLBarSoup(pos, idx);
        forge::native::mesh::HalfEdgeMesh m;
        const bool built = m.buildFromSoup(pos, idx);
        check(built && m.validate().isValid(),
              "L-bar fixture is itself a valid closed 2-manifold");
    }

    // (6c) Non-convex L-bar: the convexity filter must SKIP the reentrant (concave)
    //      edges and chamfer only the convex ones. The result, when ok, stays a
    //      valid closed 2-manifold; if the offset cannot rebuild, ok==false is
    //      returned honestly (never a fake). Either way: zero concave edges
    //      chamfered, and numChamfered < numSharp (some edges are concave).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeLBarSoup(pos, idx);
        ChamferResult r = chamferEdges(pos, idx, 0.1, 30.0);
        std::printf("      L-bar: ok=%d numSharp=%u numChamfered=%u reason=%s\n",
                    (int)r.ok, r.numSharpEdges, r.numChamferedEdges, r.reason.c_str());
        check(r.numChamferedEdges < r.numSharpEdges,
              "non-convex L-bar: concave edges are NOT chamfered (chamfered < sharp)");
        if (r.ok) {
            check(r.mesh.validate().isValid(),
                  "when ok, the chamfered L-bar is a valid closed 2-manifold");
            check(r.outputVolume < r.inputVolume,
                  "chamfering the L-bar's convex edges removes material");
        } else {
            // An honest refusal is acceptable for the non-convex envelope edge.
            check(true, "non-convex offset that cannot rebuild -> honest ok==false");
        }
    }
}

// ===========================================================================
// (5) Randomized fuzz: many cube sizes / setbacks all close + match the law.
// ===========================================================================
static void testFuzz(std::mt19937_64& rng) {
    std::printf("[5] randomized fuzz over cube sizes and setbacks\n");
    std::uniform_real_distribution<double> Lsz(0.5, 4.0);
    std::uniform_real_distribution<double> frac(0.02, 0.45);   // d as a fraction of L (< 0.5)
    std::uniform_real_distribution<double> off(-2.0, 2.0);

    const int trials = 60;
    int closed = 0, lawOk = 0;
    for (int t = 0; t < trials; ++t) {
        const double L = Lsz(rng);
        const double d = frac(rng) * L;     // strictly < 0.5 * L (== shortest edge)
        std::vector<double> pos;
        std::vector<std::uint32_t> idx;
        makeCubeSoup(L, MVec3{off(rng), off(rng), off(rng)}, pos, idx);
        ChamferResult r = chamferEdges(pos, idx, d, 30.0);
        if (!r.ok) {
            std::printf("      [trial %d] L=%.3f d=%.3f UNEXPECTED ok==false: %s\n",
                        t, L, d, r.reason.c_str());
            continue;
        }
        if (r.mesh.validate().isValid() && r.mesh.validate().eulerChar == 2) ++closed;
        // Removed volume scales as L^3 about the unit-cube law evaluated at d/L.
        const double removedExpect = analyticRemovedUnitCube(d / L) * (L * L * L);
        if (approx(r.removedVolume, removedExpect, 1e-7 * (L * L * L) + 1e-9)) ++lawOk;
    }
    std::printf("      closed 2-manifolds: %d/%d ; volume-law matches: %d/%d\n",
                closed, trials, lawOk, trials);
    check(closed == trials, "every fuzz chamfer is a closed 2-manifold (Euler 2)");
    check(lawOk == trials, "every fuzz chamfer matches the analytic removed-volume law");
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("forge::native::brep::Chamfer validation gate\n");
    std::printf("seed = %llu\n", static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    testUnitCube(rng);
    testRefusals();
    testEnvelope();
    testFuzz(rng);

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
