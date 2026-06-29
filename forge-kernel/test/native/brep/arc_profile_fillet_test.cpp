// forge/native/brep/arc_profile_fillet_test.cpp
//
// Native gate for FIX #1 — "dense-profile fillet refusal".
//
// THE FRICTION (production / OCCT path): part.fillet (and the OCCT
// BRepFilletAPI behind it) REFUSES a body with more than 1000 edges
// (Features.cpp kMaxFilletSrcEdges). A rounded / waisted profile drawn as MANY
// short polyline chords extrudes into a body with hundreds–thousands of edges,
// so the fillet is silently skipped and the part ships with SHARP corners (the
// "135 waisted bracket built valid but un-rounded"). The fix is to draw rounded
// profiles with TRUE ARC segments, so a rounded-rect is ~8–16 edges, not
// hundreds — well under the fillet's edge limit.
//
// This gate proves the GEOMETRY of that fix in the dependency-free in-house
// kernel (Sweep::prism + Fillet::filletConvexEdges + MassProps), independent of
// OCCT — pure C++20, NO external deps, NO WASM, no framework. (The OCCT-side
// end-to-end — sketcher arc edges through extrudeProfile — additionally needs
// the batched forge-kernel.node relink for the Sketcher.cpp minor-arc fix.)
//
// CLOSED-FORM GATES (asserted below — never weakened):
//   (1) ARC-PROFILE EXTRUDE IS EXACT. A rounded-rectangle profile (W×H, corner
//       radius rc) built from TRUE corner arcs, extruded a length L, is a
//       WATERTIGHT 2-manifold whose volume == signedArea(profile)·L to 1e-9
//       (the prism identity), and whose section area converges to the analytic
//       rounded-rect area  W·H − (4−π)·rc²  as the arc sampling is refined.
//   (2) ARCS PRESERVE GEOMETRY AT A FRACTION OF THE EDGES. The COARSE arc
//       profile (4 chords/corner ⇒ 20 vertices) and a DENSE one (60/corner ⇒
//       244) describe the SAME shape (areas agree to <0.5 % of W·H) — yet the
//       coarse one carries ~12× fewer segments. That is exactly why true arcs
//       stay under the 1000-edge fillet limit where a dense polyline does not.
//   (3) FILLET SUCCEEDS ON THE EXTRUDED BODY. A rectangular prism built by the
//       same profile-extrude path accepts a rolling-ball edge fillet: the
//       result is a WATERTIGHT 2-manifold, ≥1 convex edge rounded, with volume
//       strictly inside the rolling-ball envelope (less than the prism, more
//       than prism − r²·ΣL). The extrude → fillet chain completes (not refused).
//   (4) HONEST REFUSAL. A degenerate (zero-length) profile extrude reports
//       ok == false (no fake solid).

#include "forge/native/brep/Sweep.hpp"
#include "forge/native/brep/Fillet.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;
using forge::native::geom::Point2;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}
static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

constexpr double kPi = 3.14159265358979323846;

// A CCW rounded rectangle on [0,W]×[0,H] with corner radius rc, each corner
// arc sampled into `seg` chords. The four straight sides are the chords joining
// consecutive corner-arc endpoints (no duplicate tangent vertices).
static std::vector<Point2> roundedRect(double W, double H, double rc, int seg) {
    std::vector<Point2> p;
    auto arc = [&](double cx, double cy, double a0, double a1) {
        for (int i = 0; i <= seg; ++i) {
            const double a = a0 + (a1 - a0) * (static_cast<double>(i) / seg);
            p.push_back(Point2{cx + rc * std::cos(a), cy + rc * std::sin(a)});
        }
    };
    arc(W - rc, rc,     -kPi / 2, 0.0);       // bottom-right
    arc(W - rc, H - rc,  0.0,     kPi / 2);   // top-right
    arc(rc,     H - rc,  kPi / 2, kPi);       // top-left
    arc(rc,     rc,      kPi,     1.5 * kPi); // bottom-left
    return p;
}
// A plain CCW rectangle [0,W]×[0,H] (the clean-edged extrude body for the fillet).
static std::vector<Point2> rect(double W, double H) {
    return { {0, 0}, {W, 0}, {W, H}, {0, H} };
}

// (1)+(2) arc-profile extrude is exact, and arcs preserve geometry cheaply.
static void testArcProfileExtrude() {
    std::printf("[1] arc rounded-rect profile extrude (exact prism + few segments)\n");
    const double W = 60.0, H = 40.0, rc = 8.0, L = 20.0;
    const double trueArea = W * H - (4.0 - kPi) * rc * rc;

    Profile coarse; coarse.outer = roundedRect(W, H, rc, 4);
    Profile dense;  dense.outer  = roundedRect(W, H, rc, 60);

    const double aCoarse = signedArea(coarse.outer);
    const double aDense  = signedArea(dense.outer);

    SweepResult rc4 = prism(coarse, L);
    SweepResult r60 = prism(dense,  L);
    check(rc4.ok && r60.ok, "both rounded-rect prisms build");
    if (!rc4.ok || !r60.ok) { std::printf("      reason: %s / %s\n", rc4.reason, r60.reason); return; }

    check(rc4.solid.validate().isValid(), "coarse arc prism is a watertight 2-manifold");
    check(r60.solid.validate().isValid(), "dense  arc prism is a watertight 2-manifold");

    // Prism identity: extruded volume == section area × length, exactly.
    check(approx(rc4.volume, aCoarse * L, 1e-9), "coarse volume == signedArea·L (1e-9)");
    check(approx(r60.volume, aDense  * L, 1e-9), "dense  volume == signedArea·L (1e-9)");

    // Arc sampling converges to the analytic rounded-rect area, and refining
    // strictly reduces the (chord-undershoot) error.
    const double errCoarse = std::fabs(aCoarse - trueArea);
    const double errDense  = std::fabs(aDense  - trueArea);
    check(errDense < errCoarse, "refined arc sampling is closer to the analytic area");
    check(errDense < 0.02 * trueArea, "dense area within 2% of W·H − (4−π)·rc²");

    // THE CRUX: the coarse arc profile already captures the shape (areas agree
    // to < 0.5 % of W·H) with ~12× FEWER segments than the dense polyline — so
    // true arcs stay far under the 1000-edge fillet limit a dense chord
    // approximation would blow past.
    const std::size_t nCoarse = coarse.outer.size();   // 4·(4+1)  = 20
    const std::size_t nDense  = dense.outer.size();     // 4·(60+1) = 244
    check(std::fabs(aCoarse - aDense) < 0.005 * (W * H),
          "coarse vs dense arc sections agree to < 0.5% of W·H (same geometry)");
    check(nCoarse * 6 < nDense, "coarse arc profile uses far fewer segments (>6× sparser)");

    std::printf("      -> coarseSegs=%zu denseSegs=%zu  areaCoarse=%.4f areaDense=%.4f trueArea=%.4f\n",
                nCoarse, nDense, aCoarse, aDense, trueArea);
    std::printf("      -> Vcoarse=%.6f (==area·L %.6f)  Vdense=%.6f (==area·L %.6f)\n",
                rc4.volume, aCoarse * L, r60.volume, aDense * L);
}

// (3) the extruded body accepts a fillet — the chain completes, not refused.
static void testExtrudeThenFilletSucceeds() {
    std::printf("[2] extruded-profile body → edge fillet SUCCEEDS (watertight)\n");
    const double W = 30.0, H = 18.0, L = 12.0, r = 2.0;
    const std::uint32_t nSeg = 12;

    Profile prof; prof.outer = rect(W, H);
    SweepResult body = prism(prof, L);
    check(body.ok && body.solid.validate().isValid(), "rectangular prism extrude builds (watertight)");
    if (!body.ok) { std::printf("      reason: %s\n", body.reason); return; }
    const double vBox = body.volume;                 // == W·H·L

    FilletResult fr = filletConvexEdges(body.positions, body.indices, r, nSeg);
    check(fr.ok, std::string("fillet ok (") + fr.reason + ")");
    if (!fr.ok) return;

    check(fr.mesh.validate().isValid(), "filleted body is a watertight 2-manifold");
    check(fr.numConvexEdgesRounded > 0, "at least one convex edge was rounded");

    // Rolling-ball envelope: rounding REMOVES material (0 < removed < square wedge).
    const double lower = vBox - r * r * fr.totalConvexEdgeLength;
    check(fr.outputVolume < vBox - 1e-9,      "filleted volume strictly < prism volume");
    check(fr.outputVolume > lower + 1e-9,     "filleted volume > prism − r²·ΣedgeLen (envelope)");

    std::printf("      -> edgesRounded=%u  Vprism=%.6f  Vfillet=%.6f  envelope(%.6f, %.6f)\n",
                fr.numConvexEdgesRounded, vBox, fr.outputVolume, lower, vBox);
}

// (4) honest refusal of a degenerate profile.
static void testHonestRefusal() {
    std::printf("[3] honest refusal — degenerate profile\n");
    Profile zero; zero.outer = { {0, 0}, {0, 0}, {0, 0} };   // zero-area / collapsed
    SweepResult r = prism(zero, 10.0);
    check(!r.ok, "collapsed profile extrude refused (ok == false, no fake)");
    if (!r.ok) std::printf("      (reason: %s)\n", r.reason);
}

int main() {
    std::printf("=== forge::native::brep — ARC-PROFILE EXTRUDE + FILLET gate (fix #1) ===\n");
    testArcProfileExtrude();
    testExtrudeThenFilletSucceeds();
    testHonestRefusal();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
