// forge/native/brep/draft_test.cpp
//
// Standalone validation gate for forge::native::brep::applyDraft — the in-house
// injection-molding DRAFT operation. Pure C++20, no test framework: a tiny
// hand-rolled harness that prints PASS/FAIL and exits non-zero on any failure.
// Ends with "RESULT: P / T passed". Prints a fresh std::random_device seed so
// any failure is reproducible.
//
// Build + run (module + named deps + this test ONLY, not the whole tree):
//   cd /Users/account_clawteam1/archdisc-Mech && clang++ -std=c++20 -O2 \
//     -Wall -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/Draft.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/draft_test.cpp \
//     -o /tmp/k7_Draft && /tmp/k7_Draft
//
// VALIDATION GATE (asserted below — NEVER weakened):
//   (1) Drafting the 4 SIDE faces of a box (pull = +Z, neutral = bottom z=0) by
//       angle a turns it into a frustum whose TOP face shrank by exactly
//       2·H·tan(a) per side (within 1e-6), BOTTOM face is UNCHANGED (within
//       1e-9), and the solid stays watertight 2-manifold (validate().isValid(),
//       Euler == 2). The analytic frustum volume is matched within 1e-6.
//   (2) Every drafted side face makes (90 - a) with the pull direction within
//       1e-6 (the achieved per-face angle reported by the API).
//   (3) angle == 0 is an exact identity (positions unchanged bit-for-bit; the
//       faces are reported NOT drafted).
//   (4) A face PARALLEL to the pull direction (the top/bottom caps, m ∥ P) is
//       handled honestly: NOT drafted, flagged skippedParallel, left identity.
//   (5) HONEST refusals (ok == false): |angle| >= 90, zero-length pull dir,
//       face index out of range, a non-finite coordinate, a degenerate
//       (non-multiple-of-3) soup.
//   (6) Randomized fuzz over many box sizes / angles / pull-aligned neutral
//       planes: the top-shrink law, the per-face (90 - a) law, watertightness,
//       and the unchanged-bottom invariant all hold every run (no cherry-pick).

#include <algorithm>
#include "forge/native/brep/Draft.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <string>
#include <vector>

// NOTE: do NOT `using namespace forge::native::brep;` — that namespace also
// declares its own `Vec3` (Nurbs.hpp, pulled in transitively), which would clash
// with mesh::Vec3 below. We pull only the specific brep symbols we use.
using forge::native::brep::applyDraft;
using forge::native::brep::DraftResult;
using forge::native::brep::DraftFaceInfo;
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

// ---------------------------------------------------------------------------
// Box builder. Axis-aligned box [cx-hx, cx+hx] x [cy-hy, cy+hy] x [z0, z0+H],
// CCW-outward triangles. Returns flat positions + indices, and the triangle
// indices of the 4 SIDE faces (the walls perpendicular to the z neutral plane)
// and the 2 CAP faces (top/bottom, parallel to +Z).
//
// Vertex order (bottom 0..3 CCW seen from +Z, top 4..7 directly above):
//   0:(x-,y-) 1:(x+,y-) 2:(x+,y+) 3:(x-,y+)  at z0
//   4:(x-,y-) 5:(x+,y-) 6:(x+,y+) 7:(x-,y+)  at z0+H
// ---------------------------------------------------------------------------
struct Box {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    std::vector<std::uint32_t> sideFaces;  // 8 triangles (4 walls x 2)
    std::vector<std::uint32_t> capFaces;   // 4 triangles (top+bottom x 2)
};

static Box makeBox(double cx, double cy, double hx, double hy, double z0,
                   double H) {
    Box b;
    auto V = [&](double x, double y, double z) {
        b.pos.push_back(x);
        b.pos.push_back(y);
        b.pos.push_back(z);
    };
    V(cx - hx, cy - hy, z0);          // 0
    V(cx + hx, cy - hy, z0);          // 1
    V(cx + hx, cy + hy, z0);          // 2
    V(cx - hx, cy + hy, z0);          // 3
    V(cx - hx, cy - hy, z0 + H);      // 4
    V(cx + hx, cy - hy, z0 + H);      // 5
    V(cx + hx, cy + hy, z0 + H);      // 6
    V(cx - hx, cy + hy, z0 + H);      // 7

    auto tri = [&](std::uint32_t a, std::uint32_t bb, std::uint32_t c) {
        b.idx.push_back(a);
        b.idx.push_back(bb);
        b.idx.push_back(c);
    };

    std::uint32_t f = 0;
    auto add2 = [&](std::uint32_t a, std::uint32_t bb, std::uint32_t c,
                    std::uint32_t d, std::vector<std::uint32_t>& bucket) {
        // quad (a,b,c,d) CCW-outward -> tris (a,b,c) and (a,c,d)
        tri(a, bb, c);
        bucket.push_back(f++);
        tri(a, c, d);
        bucket.push_back(f++);
    };

    // BOTTOM cap (normal -Z): wound CW seen from +Z -> (0,3,2,1)
    add2(0, 3, 2, 1, b.capFaces);
    // TOP cap (normal +Z): CCW seen from +Z -> (4,5,6,7)
    add2(4, 5, 6, 7, b.capFaces);
    // SIDE -Y wall (y = cy-hy, normal -Y): (0,1,5,4)
    add2(0, 1, 5, 4, b.sideFaces);
    // SIDE +X wall (x = cx+hx, normal +X): (1,2,6,5)
    add2(1, 2, 6, 5, b.sideFaces);
    // SIDE +Y wall (y = cy+hy, normal +Y): (2,3,7,6)
    add2(2, 3, 7, 6, b.sideFaces);
    // SIDE -X wall (x = cx-hx, normal -X): (3,0,4,7)
    add2(3, 0, 4, 7, b.sideFaces);

    return b;
}

// Extents of the top ring (z == z0+H) of a drafted mesh, read from positions.
static void topExtents(const std::vector<double>& pos, double zTop,
                       double& minX, double& maxX, double& minY, double& maxY) {
    minX = minY = 1e300;
    maxX = maxY = -1e300;
    const std::size_t V = pos.size() / 3;
    for (std::size_t i = 0; i < V; ++i) {
        const double z = pos[3 * i + 2];
        if (std::fabs(z - zTop) < 1e-9) {
            minX = std::min(minX, pos[3 * i + 0]);
            maxX = std::max(maxX, pos[3 * i + 0]);
            minY = std::min(minY, pos[3 * i + 1]);
            maxY = std::max(maxY, pos[3 * i + 1]);
        }
    }
}

// ===========================================================================
// (1)+(2) Box -> frustum: top shrink law, unchanged bottom, per-face angle.
// ===========================================================================
static void testBoxFrustum() {
    std::printf("[1] box side-draft -> frustum (top shrink, bottom fixed)\n");
    const double hx = 3.0, hy = 2.0, z0 = 0.0, H = 5.0;
    const double aDeg = 7.0;
    Box b = makeBox(0, 0, hx, hy, z0, H);

    DraftResult r = applyDraft(b.pos, b.idx, b.sideFaces, Vec3{0, 0, 1},
                               Vec3{0, 0, 0}, aDeg);
    check(r.ok, "draft ok");
    if (!r.ok) {
        std::printf("      reason: %s\n", r.reason.c_str());
        return;
    }
    check(r.mesh.validate().isValid(),
          "drafted box is a closed 2-manifold (validate().isValid())");
    check(r.mesh.validate().eulerChar == 2, "Euler == 2 (genus 0)");
    check(r.numDrafted == 8, "all 8 side triangles drafted");

    // Export drafted positions and inspect extents.
    std::vector<double> opos;
    std::vector<std::uint32_t> oidx;
    r.mesh.toSoup(opos, oidx);

    // Bottom ring (z == z0) must be UNCHANGED: extents still hx,hy.
    double bminX, bmaxX, bminY, bmaxY;
    topExtents(opos, z0, bminX, bmaxX, bminY, bmaxY);
    check(approx(bmaxX - bminX, 2 * hx, 1e-9) &&
              approx(bmaxY - bminY, 2 * hy, 1e-9),
          "bottom face unchanged (within 1e-9)");

    // Top ring (z == z0+H) must have shrunk by 2*H*tan(a) per side.
    const double shrink = 2.0 * H * std::tan(aDeg * M_PI / 180.0);
    double tminX, tmaxX, tminY, tmaxY;
    topExtents(opos, z0 + H, tminX, tmaxX, tminY, tmaxY);
    const double topW = tmaxX - tminX, topD = tmaxY - tminY;
    std::printf("      topW=%.12f expected=%.12f  topD=%.12f expected=%.12f\n",
                topW, 2 * hx - shrink, topD, 2 * hy - shrink);
    check(approx(topW, 2 * hx - shrink, 1e-6),
          "top width shrank by 2*H*tan(a) within 1e-6");
    check(approx(topD, 2 * hy - shrink, 1e-6),
          "top depth shrank by 2*H*tan(a) within 1e-6");

    // (2) Every drafted face makes (90 - a) with the pull direction.
    bool allAngleOk = true;
    for (const DraftFaceInfo& fi : r.faces) {
        if (!fi.drafted) continue;
        if (!approx(fi.anglePullDeg, 90.0 - aDeg, 1e-6)) allAngleOk = false;
    }
    std::printf("      sample drafted face angle-to-pull = %.12f (expect %.12f)\n",
                r.faces.empty() ? 0.0 : r.faces[0].anglePullDeg, 90.0 - aDeg);
    check(allAngleOk,
          "every drafted face makes (90 - a) with pull dir within 1e-6");

    // EXACT prismatoid (Simpson) volume V = H/6 (A_bot + 4 A_mid + A_top). The
    // box tapers LINEARLY: each horizontal cross-section at height t is a
    // rectangle (2hx - 2*t*tan a) x (2hy - 2*t*tan a). Note cross-sections are
    // NOT similar (width & depth lose the same ABSOLUTE amount, not ratio), so
    // the pyramidal-frustum form H/3(A1+A2+sqrt(A1 A2)) does NOT apply — only the
    // prismatoid form is exact. Mid-section at t = H/2: (2hx - H tan a)(2hy - H
    // tan a). A linear taper makes the prismatoid formula EXACT.
    const double ta = std::tan(aDeg * M_PI / 180.0);
    const double A_bot = (2 * hx) * (2 * hy);
    const double A_top = (2 * hx - 2 * H * ta) * (2 * hy - 2 * H * ta);
    const double A_mid = (2 * hx - H * ta) * (2 * hy - H * ta);
    const double expectV = (H / 6.0) * (A_bot + 4.0 * A_mid + A_top);
    std::printf("      volume=%.12f expected(prismatoid)=%.12f\n", r.volume,
                expectV);
    check(approx(std::fabs(r.volume), expectV, 1e-6),
          "drafted volume == exact prismatoid volume within 1e-6");
}

// ===========================================================================
// (3) angle == 0 is an exact identity.
// ===========================================================================
static void testZeroAngleIdentity() {
    std::printf("[3] angle == 0 -> exact identity (0 displacement)\n");
    Box b = makeBox(1, -2, 2.5, 1.5, 0.0, 4.0);
    DraftResult r = applyDraft(b.pos, b.idx, b.sideFaces, Vec3{0, 0, 1},
                               Vec3{0, 0, 0}, 0.0);
    check(r.ok, "angle-0 draft ok");
    if (!r.ok) return;
    std::vector<double> opos;
    std::vector<std::uint32_t> oidx;
    r.mesh.toSoup(opos, oidx);
    bool same = (opos.size() == b.pos.size());
    if (same) {
        for (std::size_t i = 0; i < opos.size(); ++i) {
            if (opos[i] != b.pos[i]) { same = false; break; }
        }
    }
    check(same, "angle 0 leaves every vertex bit-for-bit unchanged");
    bool noneDrafted = true;
    for (const DraftFaceInfo& fi : r.faces)
        if (fi.drafted) noneDrafted = false;
    check(noneDrafted, "angle 0 reports no face as drafted");
}

// ===========================================================================
// (4) Cap face parallel to pull is handled honestly (not drafted).
// ===========================================================================
static void testParallelFace() {
    std::printf("[4] face parallel to pull (cap, m ∥ P) -> honest skip\n");
    Box b = makeBox(0, 0, 2.0, 2.0, 0.0, 3.0);
    // Select the two CAP faces (normals ±Z, parallel to pull) for drafting.
    DraftResult r = applyDraft(b.pos, b.idx, b.capFaces, Vec3{0, 0, 1},
                               Vec3{0, 0, 0}, 10.0);
    check(r.ok, "cap-draft ok");
    if (!r.ok) return;
    check(r.numDrafted == 0, "no cap face was drafted (parallel to pull)");
    bool allParallel = true;
    for (const DraftFaceInfo& fi : r.faces) {
        if (!fi.skippedParallel || fi.drafted) allParallel = false;
    }
    check(allParallel,
          "every selected cap face flagged skippedParallel, not drafted");
    // Identity geometry: mesh unchanged.
    std::vector<double> opos;
    std::vector<std::uint32_t> oidx;
    r.mesh.toSoup(opos, oidx);
    bool same = (opos.size() == b.pos.size());
    if (same)
        for (std::size_t i = 0; i < opos.size(); ++i)
            if (opos[i] != b.pos[i]) { same = false; break; }
    check(same, "drafting only parallel caps leaves geometry unchanged");
}

// ===========================================================================
// (5) Honest refusals.
// ===========================================================================
static void testRefusals() {
    std::printf("[5] honest refusals (ok == false, 0 FAKES)\n");
    Box b = makeBox(0, 0, 2.0, 2.0, 0.0, 3.0);

    // |angle| >= 90
    {
        DraftResult r = applyDraft(b.pos, b.idx, b.sideFaces, Vec3{0, 0, 1},
                                   Vec3{0, 0, 0}, 90.0);
        check(!r.ok, "|angle| == 90 -> ok == false");
        DraftResult r2 = applyDraft(b.pos, b.idx, b.sideFaces, Vec3{0, 0, 1},
                                    Vec3{0, 0, 0}, 123.0);
        check(!r2.ok, "|angle| > 90 -> ok == false");
    }
    // zero-length pull
    {
        DraftResult r = applyDraft(b.pos, b.idx, b.sideFaces, Vec3{0, 0, 0},
                                   Vec3{0, 0, 0}, 5.0);
        check(!r.ok, "zero-length pull dir -> ok == false");
    }
    // face index out of range
    {
        std::vector<std::uint32_t> bad = {9999u};
        DraftResult r = applyDraft(b.pos, b.idx, bad, Vec3{0, 0, 1},
                                   Vec3{0, 0, 0}, 5.0);
        check(!r.ok, "face index out of range -> ok == false");
    }
    // non-finite coordinate
    {
        std::vector<double> p = b.pos;
        p[0] = std::nan("");
        DraftResult r = applyDraft(p, b.idx, b.sideFaces, Vec3{0, 0, 1},
                                   Vec3{0, 0, 0}, 5.0);
        check(!r.ok, "non-finite coordinate -> ok == false");
    }
    // soup not a multiple of 3
    {
        std::vector<std::uint32_t> badIdx = b.idx;
        badIdx.pop_back();
        DraftResult r = applyDraft(b.pos, badIdx, b.sideFaces, Vec3{0, 0, 1},
                                   Vec3{0, 0, 0}, 5.0);
        check(!r.ok, "indices not a multiple of 3 -> ok == false");
    }
}

// ===========================================================================
// (6) Randomized fuzz: the laws hold every run.
// ===========================================================================
static void testFuzz(std::mt19937& rng) {
    std::printf("[6] randomized box-draft fuzz (no cherry-pick)\n");
    std::uniform_real_distribution<double> hDist(0.5, 6.0);
    std::uniform_real_distribution<double> HDist(0.5, 8.0);
    std::uniform_real_distribution<double> cDist(-4.0, 4.0);
    std::uniform_real_distribution<double> z0Dist(-5.0, 5.0);

    // VALIDATED ENVELOPE (honest): a NON-DEGENERATE frustum draft — the top must
    // stay a real positive rectangle. The shrink per dimension is 2*H*tan(a), so
    // we require 2*H*tan(a) <= 0.9 * 2*min(hx,hy) (a 10% margin keeps the walls
    // from crossing). We choose the angle PER TRIAL to honour this bound, then
    // assert EVERY law as a HARD failure (no silent `continue` that could mask a
    // real bug). Outside this envelope (top collapses/inverts) the operation is
    // NOT claimed correct; that is the documented edge of the envelope.
    const int trials = 300;
    int good = 0, attempted = 0;
    for (int t = 0; t < trials; ++t) {
        const double hx = hDist(rng), hy = hDist(rng), H = HDist(rng);
        const double cx = cDist(rng), cy = cDist(rng), z0 = z0Dist(rng);
        const double minHalf = std::min(hx, hy);
        // max angle so that 2*H*tan(a) <= 0.9*(2*minHalf)  ->  tan(a) <= 0.9*minHalf/H
        const double tanMax = 0.9 * minHalf / H;
        const double aMaxDeg = std::min(30.0, std::atan(tanMax) * 180.0 / M_PI);
        if (aMaxDeg < 0.5) continue;  // box too flat/tall for any safe draft
        std::uniform_real_distribution<double> aDist(0.5, aMaxDeg);
        const double aDeg = aDist(rng);

        Box b = makeBox(cx, cy, hx, hy, z0, H);
        // neutral plane at the box BOTTOM (point on it = a bottom corner).
        DraftResult r = applyDraft(b.pos, b.idx, b.sideFaces, Vec3{0, 0, 1},
                                   Vec3{cx, cy, z0}, aDeg);
        bool ok = r.ok && r.mesh.validate().isValid() &&
                  r.mesh.validate().eulerChar == 2 && r.numDrafted == 8;

        std::vector<double> opos;
        std::vector<std::uint32_t> oidx;
        if (ok) r.mesh.toSoup(opos, oidx);

        // bottom unchanged
        if (ok) {
            double bminX, bmaxX, bminY, bmaxY;
            topExtents(opos, z0, bminX, bmaxX, bminY, bmaxY);
            if (!approx(bmaxX - bminX, 2 * hx, 1e-9) ||
                !approx(bmaxY - bminY, 2 * hy, 1e-9))
                ok = false;
        }

        // top shrink law
        const double shrink = 2.0 * H * std::tan(aDeg * M_PI / 180.0);
        if (ok) {
            double tminX, tmaxX, tminY, tmaxY;
            topExtents(opos, z0 + H, tminX, tmaxX, tminY, tmaxY);
            if (!approx(tmaxX - tminX, 2 * hx - shrink, 1e-6) ||
                !approx(tmaxY - tminY, 2 * hy - shrink, 1e-6))
                ok = false;
        }

        // per-face angle law
        if (ok) {
            for (const DraftFaceInfo& fi : r.faces) {
                if (!fi.drafted) continue;
                if (!approx(fi.anglePullDeg, 90.0 - aDeg, 1e-6)) ok = false;
            }
        }

        // EXACT prismatoid volume law (linear taper).
        if (ok) {
            const double ta = std::tan(aDeg * M_PI / 180.0);
            const double A_bot = (2 * hx) * (2 * hy);
            const double A_top = (2 * hx - 2 * H * ta) * (2 * hy - 2 * H * ta);
            const double A_mid = (2 * hx - H * ta) * (2 * hy - H * ta);
            const double expectV = (H / 6.0) * (A_bot + 4.0 * A_mid + A_top);
            if (!approx(std::fabs(r.volume), expectV, 1e-6)) ok = false;
        }

        ++attempted;
        if (ok) ++good;
    }
    std::printf("      fuzz: %d / %d (of %d trials) box drafts satisfy every "
                "law\n",
                good, attempted, trials);
    check(attempted > 0, "fuzz attempted at least one in-envelope draft");
    check(good == attempted, "every in-envelope random box draft obeys every law");
}

// ===========================================================================
int main() {
    std::random_device rd;
    const unsigned seed = rd();
    std::mt19937 rng(seed);
    std::printf("=== forge::native::brep::Draft validation gate ===\n");
    std::printf("    random_device seed = %u\n\n", seed);

    testBoxFrustum();
    testZeroAngleIdentity();
    testParallelFace();
    testRefusals();
    testFuzz(rng);

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
