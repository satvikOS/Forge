// heal_destruction_refusal_gate.cpp — T-137.
//
// THE DEFECT THIS GATE EXISTS FOR
// ------------------------------------------------------------------------------
// A valid 100 x 100 x 0.001 plate — V = 10, six planar faces, BRepCheck VALID —
// entered the native heal path and came back EMPTY, reported as a clean success:
//
//   imported=1 healed=1 exported=1 changed=1 faceted=0 reason=""
//
// and NativeShapeHealBridge.hpp's own header defines an empty reason as "an exact
// pass". Inside, healBRep had removed all 8 side triangles of the plate
// (slivers=8, unfixedFreeEdges=8) and returned ok=true reason="ok".
//
// The cause is Heal.cpp pass (3): degenerateAspect() deletes a face whose
// (longest edge)/(mean altitude) exceeds opt.aspectMax, whose default is the
// literal 1e4 and which NO caller sets. importOcctSolid hands the healer
// TRIANGLES, so each side triangle of an L x t plate has area 0.5*L*t and longest
// edge L, giving mean altitude exactly t and a ratio of exactly L/t. The rule is
// therefore a hard, scale-free, unit-free "L/t > 10000 => delete this face" —
// identical for a 1 mm part and a 2 m panel. MEASURED boundary: 100x100x0.0101
// survives (aspect 9901) and 100x100x0.01 is destroyed (aspect 1e4);
// 1000x1000x0.11 survives (9090) and 1000x1000x0.09 is destroyed (11111).
//
// Nothing refused, for three independent reasons, all of them measured:
//   (1) the sliver-restore safety net (Heal.cpp, "re-sew with the slivers back and
//       keep them if the drop opened the shell") keys off `rep.before.closed`,
//       and every caller of healBRep first clones each face with PRIVATE fresh
//       vertices, so every edge of the input soup is free and before.closed is
//       ALWAYS false. The net has never once executed;
//   (2) HealReport had no vocabulary for "the repair destroyed the body" —
//       ok=false meant only "malformed input";
//   (3) healBRep already MEASURED volumeBefore and volumeAfter and then never
//       compared them; nothing outside this file's tests ever read either field.
//
// WHAT THIS GATE ASSERTS
// ------------------------------------------------------------------------------
// The fix is a POST-CONDITION on the heal's OWN OUTPUT, in the house style of
// Chamfer/Draft/Boolean ("rebuild + re-validate — never fake a closed solid"),
// armed only when the INPUT face set geometrically BOUNDS A VOLUME (the new
// shellBoundsVolume: SUM of Newell area vectors == 0, a topology-free test that
// still works on a fragment soup, which is exactly what before.closed could not
// do). Two legs: the healed body must still be CLOSED, and it must not have lost
// more than opt.maxMaterialLossFrac of its volume.
//
//   POSITIVE ARM — five thin bodies that the heal DESTROYS must now REFUSE:
//     ok == false, a non-empty reason that is not "ok", destructionRefused set.
//     Thicknesses span the decade the aspect rule cuts across (0.001 / 0.01 /
//     0.05 / 0.09 / 0.1 mm at footprints from 100 mm to 2 m), and the last body
//     is an L-BRACKET, not a plate, so the gate is not testing one shape.
//     Every one of these returned ok=true reason="ok" before the fix.
//
//   NEGATIVE ARM — bodies the heal SHOULD still fix must still be fixed:
//     ok == true and the volume preserved. Six of the seven are the EXISTING
//     heal fixtures, their constructions copied VERBATIM from
//     test/native/brep/heal_test.cpp (the defective box, the clean box, the
//     unclosable missing-face box, the reversed-face box, the duplicate-face box)
//     so the negative set cannot be accused of being hand-picked friendly. The
//     seventh is the control that matters most for this defect: a THIN plate that
//     is NOT destroyed (100 x 100 x 0.1, aspect 1000) must still heal cleanly —
//     the refusal must be about destruction, never about thinness.
//
// Pure forge::native::brep — no OCCT is needed or used; it is registered beside
// the native_vs_occt_heal gates because those are the heal gates.
//
// HONEST SCOPE, stated here so no reader has to infer it:
//   * This refusal covers the NATIVE arm only. The OCCT arm (ShapeFix_Shape) is
//     not touched by it and destroys the same plate; see the task ledger.
//   * The post-condition is ARMED ONLY when the input face set closes exactly.
//     That is the fixShapeGeneral path by construction (importOcctSolid accepts
//     only a closed 2-manifold), but a caller that hands healBRep an already-open
//     or already-incomplete soup gets no material claim — because for an open
//     surface the divergence-theorem "volume" is an origin-dependent surface
//     integral, not an amount of material, and refusing on it would be inventing
//     a measurement. That boundary is deliberate and is the gate's known hole.

#include "forge/native/brep/Heal.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else        std::printf("  [FAIL] %s\n", name.c_str());
}

// Build one face from an ordered vertex-position ring (private vertices/edges) —
// copied from test/native/brep/heal_test.cpp so the fixtures below are identical.
static Face* faceFromRing(TopologyBuilder& tb, const std::vector<Point3>& ring) {
    Face* f = tb.makeFace();
    std::vector<Vertex*> vs;
    vs.reserve(ring.size());
    for (const Point3& p : ring) vs.push_back(tb.makeVertex(p));
    tb.addOuterLoopToFace(f, vs);
    return f;
}

// ===========================================================================
// TRIANGULATED bodies — the shape importOcctSolid actually hands the healer.
// This matters: the aspect rule is evaluated on the RING it is given, and it is
// the fan-triangulation of a quad side wall (area 0.5*L*t, longest edge L, so
// altitude exactly t) that makes the ratio exactly L/t. A quad side wall has
// altitude t as well, so the same rule fires; triangles are used here because
// that is what the production import path produces.
// ===========================================================================
static void pushQuadAsTris(TopologyBuilder& tb, std::vector<Face*>& out,
                           const Point3& a, const Point3& b,
                           const Point3& c, const Point3& d) {
    out.push_back(faceFromRing(tb, {a, b, c}));
    out.push_back(faceFromRing(tb, {a, c, d}));
}

// Axis-aligned box [x0,x0+X] x [y0,y0+Y] x [z0,z0+Z] as 12 outward-wound triangles.
static std::vector<Face*> triBoxAt(TopologyBuilder& tb, double x0, double y0, double z0,
                                   double X, double Y, double Z) {
    const Point3 P[8] = {
        {x0,     y0,     z0    }, {x0 + X, y0,     z0    },
        {x0 + X, y0 + Y, z0    }, {x0,     y0 + Y, z0    },
        {x0,     y0,     z0 + Z}, {x0 + X, y0,     z0 + Z},
        {x0 + X, y0 + Y, z0 + Z}, {x0,     y0 + Y, z0 + Z},
    };
    std::vector<Face*> f;
    pushQuadAsTris(tb, f, P[0], P[3], P[2], P[1]);   // bottom (-Z)
    pushQuadAsTris(tb, f, P[4], P[5], P[6], P[7]);   // top    (+Z)
    pushQuadAsTris(tb, f, P[0], P[1], P[5], P[4]);   // front  (-Y)
    pushQuadAsTris(tb, f, P[2], P[3], P[7], P[6]);   // back   (+Y)
    pushQuadAsTris(tb, f, P[0], P[4], P[7], P[3]);   // left   (-X)
    pushQuadAsTris(tb, f, P[1], P[2], P[6], P[5]);   // right  (+X)
    return f;
}
static std::vector<Face*> triBox(TopologyBuilder& tb, double X, double Y, double Z) {
    return triBoxAt(tb, 0.0, 0.0, 0.0, X, Y, Z);
}

// A THIN L-BRACKET: the L-shaped profile below, extruded by `t` in Z. Not a plate
// — a real part with six side walls, so the gate is not asserting one shape. Its
// volume is profileArea * t = (arm*span*2 - arm*arm) * t.
static std::vector<Face*> triLBracket(TopologyBuilder& tb, double span, double arm, double t) {
    // CCW profile in XY (seen from +Z).
    const Point3 Q[6] = {
        {0, 0, 0}, {span, 0, 0}, {span, arm, 0},
        {arm, arm, 0}, {arm, span, 0}, {0, span, 0},
    };
    auto lift = [&](int i, double z) { return Point3{Q[i].x, Q[i].y, z}; };
    std::vector<Face*> f;
    // bottom cap (-Z): profile wound CW seen from +Z => outward -Z. Fan 0,i+1,i.
    for (int i = 1; i + 1 < 6; ++i)
        f.push_back(faceFromRing(tb, {lift(0, 0.0), lift(i + 1, 0.0), lift(i, 0.0)}));
    // top cap (+Z): fan 0,i,i+1.
    for (int i = 1; i + 1 < 6; ++i)
        f.push_back(faceFromRing(tb, {lift(0, t), lift(i, t), lift(i + 1, t)}));
    // six side walls, each as two triangles, outward-wound.
    for (int i = 0; i < 6; ++i) {
        const int j = (i + 1) % 6;
        pushQuadAsTris(tb, f, lift(i, 0.0), lift(j, 0.0), lift(j, t), lift(i, t));
    }
    return f;
}

static double lBracketVolume(double span, double arm, double t) {
    return (span * arm + arm * (span - arm)) * t;   // the L profile area * t
}

// ===========================================================================
// POSITIVE ARM — the heal destroys these; it must now REFUSE.
// ===========================================================================
static void positiveCase(const char* what,
                         std::vector<Face*> faces,
                         TopologyBuilder& tb,
                         double expectVolume,
                         double tol) {
    HealOptions opt;
    opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);

    std::printf("    %s: inputBounds=%d ok=%d refused=%d closed=%d faces=%zu "
                "slivers=%zu free=%zu  V %.6g -> %.6g   reason=\"%s\"\n",
                what, r.inputBoundsVolume ? 1 : 0, r.ok ? 1 : 0,
                r.destructionRefused ? 1 : 0, r.after.closed ? 1 : 0,
                r.after.faces, r.sliverFacesRemoved, r.unfixedFreeEdgeIds.size(),
                r.volumeBefore, r.volumeAfter, r.reason ? r.reason : "");

    const std::string w(what);
    // The input really is the valid body we think it is — otherwise a "refusal"
    // here would prove nothing (a gate must know its own fixture is sound).
    check(std::fabs(std::fabs(r.volumeBefore) - expectVolume) <= 1e-6 * expectVolume,
          w + ": INPUT volume is the part's true volume");
    check(r.inputBoundsVolume, w + ": input BOUNDS a volume (the post-condition is armed)");
    // The destruction really happens — this arm is not asserting a refusal on a
    // body the heal would have handled correctly.
    check(r.sliverFacesRemoved > 0, w + ": heal did classify walls as slivers (the defect fires)");
    check(!r.after.closed || std::fabs(r.volumeAfter) < 0.99 * std::fabs(r.volumeBefore),
          w + ": heal did destroy the body (opened it, or ate its material)");
    // THE REFUSAL.
    check(!r.ok, w + ": REFUSED — ok == false (was true before T-137)");
    check(r.destructionRefused, w + ": refusal is the destruction post-condition");
    check(r.reason != nullptr && r.reason[0] != '\0' && std::string(r.reason) != "ok",
          w + ": reason NAMES what happened (non-empty, not \"ok\")");
}

static void runPositiveArm() {
    std::printf("[POSITIVE] thin bodies the heal DESTROYS -> must REFUSE\n");
    {   // the exact body from the T-137 report.
        TopologyBuilder tb;
        positiveCase("plate 100x100x0.001", triBox(tb, 100, 100, 0.001), tb, 10.0, 1e-6);
    }
    {   // thickness x10; measured destroyed (aspect exactly 1e4, the boundary).
        TopologyBuilder tb;
        positiveCase("plate 100x100x0.01", triBox(tb, 100, 100, 0.01), tb, 100.0, 1e-6);
    }
    {   // a 2 m panel 0.05 mm thick; measured V=0 BRepCheck-INVALID end to end.
        TopologyBuilder tb;
        positiveCase("panel 2000x2000x0.05", triBox(tb, 2000, 2000, 0.05), tb, 200000.0, 1e-6);
    }
    {   // gasket foil on a 1 m plate; 0.09 destroyed where 0.11 survives.
        TopologyBuilder tb;
        positiveCase("gasket 1000x1000x0.09", triBox(tb, 1000, 1000, 0.09), tb, 90000.0, 1e-6);
    }
    {   // NOT a plate: a thin L-bracket, 0.1 mm on a 2 m span (aspect 20000).
        TopologyBuilder tb;
        const double span = 2000.0, arm = 400.0, t = 0.1;
        positiveCase("L-bracket 2000/400 x 0.1", triLBracket(tb, span, arm, t), tb,
                     lBracketVolume(span, arm, t), 1e-6);
    }
    // ---- THE QUIET VARIANT — the case ONLY the material leg can see. ----------
    // All five bodies above are caught by LEG A: dropping their walls OPENS them,
    // so the loss is visible as free edges. The dangerous version is the one the
    // end-to-end run measured at precision=0.001 — V 10 -> 1.667, BRepCheck VALID,
    // zero unfixed residuals, reason "" — where the output is a perfectly closed,
    // perfectly valid solid and the material is simply gone. NO topological or
    // validity check can see that; only the volume can.
    //
    // This fixture is deliberately synthetic, and here is exactly why: a face
    // dropped from a closed cycle nearly always opens it, so the quiet variant is
    // hard to reach by thinning a plate. A PART PLUS A HAIR-THIN WHISKER reaches it
    // honestly — a 1 mm cube and a 1000 x 0.06 x 0.06 whisker, both closed. Every
    // one of the whisker's 12 triangles is a sliver (its four long walls by ASPECT
    // at 16667:1, its two end caps by AREA below tol^2), so the whisker vanishes
    // whole, the cube is left CLOSED with zero free edges, and 78% of the body's
    // material is gone. Leg A is silent. Leg B is the whole defence.
    {
        TopologyBuilder tb;
        std::vector<Face*> f = triBox(tb, 1.0, 1.0, 1.0);                 // the part, V = 1
        std::vector<Face*> w = triBoxAt(tb, 10.0, 0.0, 0.0, 1000.0, 0.06, 0.06); // whisker, V = 3.6
        f.insert(f.end(), w.begin(), w.end());

        HealOptions opt; opt.tol = 0.05;
        HealReport r = healBRep(tb, f, opt);
        std::printf("    part+whisker (quiet variant): inputBounds=%d ok=%d refused=%d closed=%d "
                    "shells=%zu faces=%zu free=%zu slivers=%zu  V %.6g -> %.6g   reason=\"%s\"\n",
                    r.inputBoundsVolume ? 1 : 0, r.ok ? 1 : 0, r.destructionRefused ? 1 : 0,
                    r.after.closed ? 1 : 0, r.after.shellCount, r.after.faces,
                    r.unfixedFreeEdgeIds.size(), r.sliverFacesRemoved,
                    r.volumeBefore, r.volumeAfter, r.reason ? r.reason : "");
        check(r.inputBoundsVolume, "quiet: input bounds a volume (post-condition armed)");
        // The output is exactly the kind of result that passes every OTHER check.
        check(r.after.closed, "quiet: output IS closed (leg A cannot see this)");
        check(r.unfixedFreeEdgeIds.empty(), "quiet: output has ZERO unfixed residuals");
        check(std::fabs(r.volumeAfter) < 0.5 * std::fabs(r.volumeBefore),
              "quiet: and yet most of the material is GONE");
        check(!r.ok, "quiet: REFUSED — ok == false");
        check(r.destructionRefused, "quiet: refusal is the destruction post-condition");
        check(std::string(r.reason).find("consumed the body") != std::string::npos,
              "quiet: it is the MATERIAL leg that fired, naming the loss");
    }
    {   // The control for the leg itself: the SAME body with the material threshold
        //  relaxed past the measured loss must NOT refuse. A leg that fires whatever
        //  its threshold is would not be measuring anything.
        TopologyBuilder tb;
        std::vector<Face*> f = triBox(tb, 1.0, 1.0, 1.0);
        std::vector<Face*> w = triBoxAt(tb, 10.0, 0.0, 0.0, 1000.0, 0.06, 0.06);
        f.insert(f.end(), w.begin(), w.end());
        HealOptions opt; opt.tol = 0.05; opt.maxMaterialLossFrac = 0.99;
        HealReport r = healBRep(tb, f, opt);
        check(r.ok && !r.destructionRefused,
              "quiet/control: threshold relaxed past the loss -> NOT refused "
              "(it really is leg B that fires, not leg A)");
    }
}

// ===========================================================================
// NEGATIVE ARM — bodies the heal SHOULD still fix. Constructions (1)-(5) are
// copied VERBATIM from test/native/brep/heal_test.cpp; (6) is the thin-but-safe
// control that proves the refusal is about destruction, not about thinness.
// ===========================================================================

// heal_test.cpp buildDefectiveBox, verbatim.
static std::vector<Face*> buildDefectiveBox(TopologyBuilder& tb, double L, double tol) {
    const double a = 0.0, b = L;
    const double eps = tol * 0.25;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    std::vector<Face*> faces;
    {
        std::vector<Point3> ring = {P[0], P[3], P[2], P[1], {L * 0.5, eps, a}};
        faces.push_back(faceFromRing(tb, ring));
    }
    {
        std::vector<Point3> ring = {P[4], P[5], {P[5].x + eps, P[5].y, P[5].z}, P[6], P[7]};
        faces.push_back(faceFromRing(tb, ring));
    }
    faces.push_back(faceFromRing(tb, {P[0], P[1], P[5], P[4]}));
    faces.push_back(faceFromRing(tb, {P[2], P[3], P[7], P[6]}));
    {
        auto nudge = [&](const Point3& p) { return Point3{p.x + eps, p.y, p.z}; };
        faces.push_back(faceFromRing(tb, {nudge(P[0]), nudge(P[4]), nudge(P[7]), nudge(P[3])}));
    }
    faces.push_back(faceFromRing(tb, {P[1], P[2], P[6], P[5]}));
    {
        const double s = tol * 0.5;
        faces.push_back(faceFromRing(tb, {{a, a, a}, {s, a, a}, {a, s, a}}));
    }
    return faces;
}

static std::vector<Face*> boxRings(TopologyBuilder& tb, double L, int reverseFace, int drop) {
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    const int rings[6][4] = {{0,3,2,1},{4,5,6,7},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    std::vector<Face*> faces;
    for (int fi = 0; fi < 6; ++fi) {
        if (fi == drop) continue;
        std::vector<Point3> ring = {P[rings[fi][0]], P[rings[fi][1]], P[rings[fi][2]], P[rings[fi][3]]};
        if (fi == reverseFace) std::reverse(ring.begin(), ring.end());
        faces.push_back(faceFromRing(tb, ring));
    }
    return faces;
}

static void negativeReport(const char* what, const HealReport& r) {
    std::printf("    %s: inputBounds=%d ok=%d refused=%d closed=%d faces=%zu "
                "free=%zu  V %.6g -> %.6g   reason=\"%s\"\n",
                what, r.inputBoundsVolume ? 1 : 0, r.ok ? 1 : 0,
                r.destructionRefused ? 1 : 0, r.after.closed ? 1 : 0,
                r.after.faces, r.unfixedFreeEdgeIds.size(),
                r.volumeBefore, r.volumeAfter, r.reason ? r.reason : "");
}

static void runNegativeArm() {
    std::printf("[NEGATIVE] the existing heal fixtures must still be HEALED\n");

    {   // (1) heal_test.cpp [1]: the defective box (sliver + gap + split edge + dup vertex).
        TopologyBuilder tb;
        const double L = 4.0, tol = 1e-6;
        HealOptions opt; opt.tol = tol;
        HealReport r = healBRep(tb, buildDefectiveBox(tb, L, tol), opt);
        negativeReport("defective box L=4", r);
        check(r.ok, "neg/defective-box: still ok == true");
        check(!r.destructionRefused, "neg/defective-box: NOT refused");
        check(r.after.closed, "neg/defective-box: still closes");
        check(std::fabs(std::fabs(r.volumeAfter) - L*L*L) <= tol, "neg/defective-box: volume still L^3");
        check(r.fullyHealed(), "neg/defective-box: still fullyHealed()");
    }
    {   // (2) heal_test.cpp [2]: the clean box — idempotent. THIS ONE IS BOUNDED,
        //     so it is the negative case that actually exercises the armed path.
        TopologyBuilder tb;
        const double L = 2.0;
        HealOptions opt; opt.tol = 1e-6;
        HealReport r = healBRep(tb, boxRings(tb, L, -1, -1), opt);
        negativeReport("clean box L=2", r);
        check(r.inputBoundsVolume, "neg/clean-box: input bounds a volume (post-condition ARMED)");
        check(r.ok, "neg/clean-box: still ok == true WITH the post-condition armed");
        check(!r.destructionRefused, "neg/clean-box: NOT refused");
        check(std::fabs(std::fabs(r.volumeAfter) - L*L*L) <= 1e-9, "neg/clean-box: volume still L^3");
    }
    {   // (3) heal_test.cpp [3]: the box with the TOP face missing — legitimately
        //     open. The refusal must NOT fire on an input that never bounded a volume.
        TopologyBuilder tb;
        HealOptions opt; opt.tol = 1e-5;
        HealReport r = healBRep(tb, boxRings(tb, 3.0, -1, 1), opt);
        negativeReport("open box (top missing)", r);
        check(r.ok, "neg/open-box: still ok == true (honest unfixed, not a refusal)");
        check(!r.destructionRefused, "neg/open-box: NOT refused");
        check(!r.after.closed, "neg/open-box: still reports OPEN");
        check(r.unfixedFreeEdgeIds.size() == 4, "neg/open-box: still 4 free edges reported UNFIXED");
    }
    {   // (4) heal_test.cpp [4]: one face wound backwards. Orientation repair changes
        //     the SIGN of volumeBefore, which is exactly why the material leg compares
        //     MAGNITUDES and refuses only on a LOSS.
        TopologyBuilder tb;
        const double L = 5.0;
        HealOptions opt; opt.tol = 1e-6;
        HealReport r = healBRep(tb, boxRings(tb, L, 2, -1), opt);
        negativeReport("reversed-face box L=5", r);
        check(r.ok, "neg/orientation: still ok == true");
        check(!r.destructionRefused, "neg/orientation: NOT refused");
        check(r.facesFlipped >= 1, "neg/orientation: still flips the offender");
        check(std::fabs(r.volumeAfter - L*L*L) <= 1e-6, "neg/orientation: volume still +L^3");
    }
    {   // (5) heal_test.cpp [6b]: box + an EXACT DUPLICATE face -> duplicate dropped.
        TopologyBuilder tb;
        const double L = 2.0;
        std::vector<Face*> faces = boxRings(tb, L, -1, -1);
        const double a = 0.0, b = L;
        faces.push_back(faceFromRing(tb, {{a,a,a},{a,b,a},{b,b,a},{b,a,a}}));  // duplicate bottom
        HealOptions opt; opt.tol = 1e-6;
        HealReport r = healBRep(tb, faces, opt);
        negativeReport("box + duplicate face", r);
        check(r.ok, "neg/duplicate-face: still ok == true");
        check(!r.destructionRefused, "neg/duplicate-face: NOT refused");
        check(r.duplicateFacesRemoved == 1, "neg/duplicate-face: still drops exactly 1 duplicate");
        check(r.after.closed, "neg/duplicate-face: still closes");
    }
    {   // (6) THE CONTROL THAT MATTERS: a THIN plate that the aspect rule does NOT
        //     trip (100 x 100 x 0.1 => aspect 1000). The refusal is about
        //     DESTRUCTION, not about thinness — this must heal cleanly, ok=true,
        //     with its (small) volume intact.
        TopologyBuilder tb;
        HealOptions opt; opt.tol = 1e-6;
        HealReport r = healBRep(tb, triBox(tb, 100, 100, 0.1), opt);
        negativeReport("thin-but-safe plate 100x100x0.1", r);
        check(r.inputBoundsVolume, "neg/thin-safe: input bounds a volume (ARMED)");
        check(r.ok, "neg/thin-safe: a THIN plate still heals — ok == true");
        check(!r.destructionRefused, "neg/thin-safe: NOT refused (thin is not destroyed)");
        check(r.sliverFacesRemoved == 0, "neg/thin-safe: no wall classified a sliver");
        check(r.after.closed, "neg/thin-safe: still closes");
        check(std::fabs(std::fabs(r.volumeAfter) - 1000.0) <= 1e-6, "neg/thin-safe: volume still 1000");
    }
    {   // (7) the shellBoundsVolume instrument itself, both ways — a new predicate
        //     that is only ever observed saying "not armed" would be unfalsifiable.
        TopologyBuilder tb;
        check(shellBoundsVolume(triBox(tb, 7.0, 3.0, 2.0)),
              "instrument: a complete box soup BOUNDS a volume");
        TopologyBuilder tb2;
        check(!shellBoundsVolume(boxRings(tb2, 3.0, -1, 1)),
              "instrument: a box missing a face does NOT bound a volume");
        TopologyBuilder tb3;
        check(!shellBoundsVolume(boxRings(tb3, 3.0, 2, -1)),
              "instrument: a box with a reversed face does NOT bound a volume");
        TopologyBuilder tb4;
        std::vector<Face*> none;
        check(!shellBoundsVolume(none), "instrument: an empty set bounds nothing");
        (void)tb4;
    }
}

int main() {
    std::printf("=== heal destruction-refusal gate (T-137) ===\n");
    std::printf("A repair that empties the user's part must REFUSE, not report success.\n\n");
    runPositiveArm();
    std::printf("\n");
    runNegativeArm();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
