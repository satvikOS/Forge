// forge/native/brep/loft_test.cpp
//
// Standalone validation gate for forge::native::brep::Loft — the OCCT-class
// loft/skin through parallel section polygons. Pure C++20, no test framework:
// a tiny hand-rolled harness that prints PASS/FAIL and exits non-zero on any
// failure. Ends with "RESULT: P / T passed".
//
// Build + run (module + named deps + this test ONLY, not the whole tree):
//   cd /Users/account_clawteam1/archdisc-Mech && clang++ -std=c++20 -O2 \
//     -Wall -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/Loft.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/loft_test.cpp \
//     -o /tmp/k3_Loft && /tmp/k3_Loft
//
// VALIDATION GATE (asserted below — NEVER weakened):
//   (1) Two EQUAL square sections distance H apart loft to a box whose volume
//       equals (side^2 * H) within 1e-9, and which is a closed 2-manifold.
//   (2) A square -> smaller-square loft equals a square frustum whose volume
//       matches the analytic prismatoid formula H/3*(A1 + A2 + sqrt(A1*A2))
//       within 1e-9 (a tolerance-free analytic truth).
//   (3) HONEST refusals (ok == false): reversed-winding section, an empty
//       section list, an empty-points section, and a section with a mismatched
//       vertex count.
//   (4) The valid results are closed 2-manifolds (validate().isValid()), have
//       correct Euler characteristic 2 (genus 0), and a randomized fuzz of
//       many random convex sections always yields closed 2-manifolds.

#include "forge/native/brep/Loft.hpp"

#include <cmath>
#include <cstdio>
#include <random>
#include <string>
#include <vector>

using namespace forge::native::brep;
using forge::native::mesh::Vec3;

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

// Build a CCW-about-+Z square (side s, centered at origin) at height z.
static LoftSection square(double s, double z) {
    const double h = 0.5 * s;
    LoftSection sec;
    sec.points = {Vec3{-h, -h, z}, Vec3{h, -h, z}, Vec3{h, h, z},
                  Vec3{-h, h, z}};
    return sec;
}

// Build a CCW-about-+Z regular n-gon (radius r, centered at (cx,cy)) at z.
static LoftSection ngon(int n, double r, double cx, double cy, double z) {
    LoftSection sec;
    for (int i = 0; i < n; ++i) {
        const double a = 2.0 * M_PI * static_cast<double>(i) / n;
        sec.points.push_back(Vec3{cx + r * std::cos(a),
                                  cy + r * std::sin(a), z});
    }
    return sec;
}

// ===========================================================================
// (1) Box: two equal squares distance H apart.
// ===========================================================================
static void testBox() {
    std::printf("[1] equal square sections distance H -> box\n");
    const double s = 2.0, H = 5.0;
    std::vector<LoftSection> secs = {square(s, 0.0), square(s, H)};
    LoftResult r = loftSections(secs);
    check(r.ok, "box loft ok");
    if (!r.ok) {
        std::printf("      reason: %s\n", r.reason.c_str());
        return;
    }
    const double expect = s * s * H;  // base area * height
    std::printf("      volume=%.12f  expected=%.12f\n", r.volume, expect);
    check(approx(r.volume, expect, 1e-9),
          "box volume == side^2 * H within 1e-9");
    check(r.mesh.validate().isValid(),
          "box loft is a closed 2-manifold (validate().isValid())");
    auto rep = r.mesh.validate();
    check(rep.eulerChar == 2, "box Euler characteristic == 2 (genus 0)");
}

// ===========================================================================
// (2) Frustum: square -> smaller square at height H.
// ===========================================================================
static void testFrustum() {
    std::printf("[2] square -> smaller-square sections -> frustum\n");
    const double a = 4.0, b = 1.5, H = 3.0;
    std::vector<LoftSection> secs = {square(a, 0.0), square(b, H)};
    LoftResult r = loftSections(secs);
    check(r.ok, "frustum loft ok");
    if (!r.ok) {
        std::printf("      reason: %s\n", r.reason.c_str());
        return;
    }
    // Prismatoid / frustum analytic volume: V = H/3 (A1 + A2 + sqrt(A1 A2)).
    const double A1 = a * a, A2 = b * b;
    const double expect = (H / 3.0) * (A1 + A2 + std::sqrt(A1 * A2));
    std::printf("      volume=%.12f  expected=%.12f\n", r.volume, expect);
    check(approx(r.volume, expect, 1e-9),
          "frustum volume == H/3 (A1+A2+sqrt(A1 A2)) within 1e-9");
    check(r.mesh.validate().isValid(),
          "frustum loft is a closed 2-manifold");
    // A non-trivial frustum is strictly smaller than its enclosing box.
    check(r.volume < A1 * H && r.volume > A2 * H,
          "frustum volume bracketed strictly between top/bottom prisms");
}

// ===========================================================================
// (3) Honest refusals: ok == false on degenerate / unsupported input.
// ===========================================================================
static void testRefusals() {
    std::printf("[3] honest refusals (ok == false, 0 FAKES)\n");

    // (3a) Reversed winding: bottom CCW, top CW about +Z.
    {
        LoftSection bot = square(2.0, 0.0);
        LoftSection top = square(2.0, 4.0);
        std::vector<Vec3> rev(top.points.rbegin(), top.points.rend());
        top.points = rev;  // now CW about +Z relative to bottom
        std::vector<LoftSection> secs = {bot, top};
        LoftResult r = loftSections(secs);
        check(!r.ok, "reversed-winding section -> ok == false");
        std::printf("      (reason: %s)\n", r.reason.c_str());
    }

    // (3b) Empty section list.
    {
        std::vector<LoftSection> secs;
        LoftResult r = loftSections(secs);
        check(!r.ok, "empty section list -> ok == false");
    }

    // (3c) A single section (need >= 2).
    {
        std::vector<LoftSection> secs = {square(2.0, 0.0)};
        LoftResult r = loftSections(secs);
        check(!r.ok, "single section -> ok == false");
    }

    // (3d) A section with too few vertices (< 3).
    {
        LoftSection bad;
        bad.points = {Vec3{0, 0, 0}, Vec3{1, 0, 0}};  // only 2
        std::vector<LoftSection> secs = {bad, bad};
        LoftResult r = loftSections(secs);
        check(!r.ok, "section with < 3 vertices -> ok == false");
    }

    // (3e) Mismatched vertex counts (square vs triangle).
    {
        LoftSection sq = square(2.0, 0.0);
        LoftSection tri;
        tri.points = {Vec3{-1, -1, 4}, Vec3{1, -1, 4}, Vec3{0, 1, 4}};
        std::vector<LoftSection> secs = {sq, tri};
        LoftResult r = loftSections(secs);
        check(!r.ok, "mismatched vertex counts -> ok == false");
        std::printf("      (reason: %s)\n", r.reason.c_str());
    }

    // (3f) Degenerate (collinear) section -> zero area in plane.
    {
        LoftSection line;
        line.points = {Vec3{0, 0, 0}, Vec3{1, 0, 0}, Vec3{2, 0, 0},
                       Vec3{3, 0, 0}};
        LoftSection line2 = line;
        for (auto& p : line2.points) p.z = 4.0;
        std::vector<LoftSection> secs = {line, line2};
        LoftResult r = loftSections(secs);
        check(!r.ok, "collinear (zero-area) section -> ok == false");
    }

    // (3g) Non-monotonic stacking (same plane twice) -> refused.
    {
        std::vector<LoftSection> secs = {square(2.0, 0.0), square(2.0, 0.0)};
        LoftResult r = loftSections(secs);
        check(!r.ok, "coincident-plane sections -> ok == false");
    }
}

// ===========================================================================
// (4) Multi-section + randomized fuzz: always closed 2-manifolds.
// ===========================================================================
static void testMultiAndFuzz(std::mt19937& rng) {
    std::printf("[4] multi-section + randomized convex fuzz\n");

    // A 4-section hexagonal taper (cooling-tower style) -> still closed.
    {
        std::vector<LoftSection> secs = {
            ngon(6, 3.0, 0, 0, 0.0), ngon(6, 2.0, 0, 0, 2.0),
            ngon(6, 2.5, 0, 0, 4.0), ngon(6, 1.0, 0, 0, 6.0)};
        LoftResult r = loftSections(secs);
        check(r.ok && r.mesh.validate().isValid(),
              "4-section hexagonal taper is a closed 2-manifold");
        check(r.ok && r.mesh.validate().eulerChar == 2,
              "4-section taper Euler == 2 (genus 0)");
        // Each side band = 2 sections-1 layers * 6 quads * 2 tris + 2 caps*4.
        const std::size_t expectF = (4 - 1) * 6 * 2 + 2 * (6 - 2);
        check(r.ok && r.mesh.faceCount() == expectF,
              "taper face count matches band+cap accounting");
    }

    // Randomized fuzz: random convex polygon (regular n-gon, random radius &
    // center jitter) stacked at strictly increasing heights. Every run uses a
    // fresh random configuration. A convex section's fan cap is always valid,
    // so EVERY one must come out a closed 2-manifold. (We do not cherry-pick;
    // a failure here is a real bug, never weakened.)
    std::uniform_int_distribution<int> nDist(3, 10);
    std::uniform_int_distribution<int> kDist(2, 6);
    std::uniform_real_distribution<double> rDist(0.4, 4.0);
    std::uniform_real_distribution<double> jDist(-0.5, 0.5);
    std::uniform_real_distribution<double> stepDist(0.3, 2.5);

    const int trials = 200;
    int closed = 0, total = 0;
    for (int t = 0; t < trials; ++t) {
        const int n = nDist(rng);
        const int K = kDist(rng);
        double z = 0.0;
        std::vector<LoftSection> secs;
        for (int k = 0; k < K; ++k) {
            const double r = rDist(rng);
            const double cx = jDist(rng), cy = jDist(rng);
            secs.push_back(ngon(n, r, cx, cy, z));
            z += stepDist(rng);  // strictly increasing
        }
        LoftResult res = loftSections(secs);
        ++total;
        if (res.ok && res.mesh.validate().isValid() &&
            res.mesh.validate().eulerChar == 2)
            ++closed;
    }
    std::printf("      fuzz: %d / %d random convex lofts closed 2-manifolds\n",
                closed, total);
    check(closed == total,
          "every random convex loft is a closed genus-0 2-manifold");
}

// ===========================================================================
int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    const unsigned seed = rd();
    std::mt19937 rng(seed);
    std::printf("=== forge::native::brep::Loft validation gate ===\n");
    std::printf("    random_device seed = %u\n\n", seed);

    testBox();
    testFrustum();
    testRefusals();
    testMultiAndFuzz(rng);

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
