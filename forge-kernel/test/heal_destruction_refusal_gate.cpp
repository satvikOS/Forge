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
// armed only when the INPUT face set ENCLOSES MATERIAL. Two legs: the healed body
// must still be CLOSED (leg A), and it must not have lost more than
// opt.maxMaterialLossFrac of what the input bounded (leg B).
//
// THE ARMING PREDICATE, and the one it replaced. The first version of this fix
// armed on Gauss's residual (SUM of the face area vectors == 0, `shellBoundsVolume`).
// That reads the theorem backwards: closed => SUM A = 0 is true, the converse is
// not, and the converse is what was asserted. MEASURED consequences, all now
// pinned by fixtures below:
//   FIVE FALSE REFUSALS on legitimately open bodies whose normals cancel — an
//   open tube, an open tube with a repairable split edge, a hexagonal extruded
//   profile shell, a zero-thickness sandwich, a pair of parallel opposite plates;
//   and TWO DISARMS by the very defect classes the healer exists to repair — one
//   face wound backwards (12/12 flips of the T-137 plate stood the guard down,
//   6/12 then returned ok=true having lost more than half the part) and a
//   sub-tolerance gap (identical defect, opposite verdicts, decided by which
//   corner moved).
// The replacement, `shellClosure`, asks the topological question topologically:
// weld the corner positions at the heal's own tolerance, normalise each ring the
// way pass (2) does, and pair the directed boundary edges. Closed iff every edge
// is used exactly twice AND the two uses run opposite ways; twice-but-same-way is
// the distinct verdict INCONSISTENTLY WOUND, which arms (with an
// orientation-independent volume) instead of disarming.
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
//   * This refusal covers the NATIVE arm only, and the OCCT arm IS NOT BROKEN.
//     MEASURED: pure ShapeFix_Shape and ShapeFix_FixSmallFace return the same
//     100 x 100 x 0.001 plate with V = 10, 6 faces, BRepCheck VALID, at
//     precision=0 and at precision=0.001/maxTol=0.01, and likewise at
//     1000x1000x0.02 and 2000x2000x0.05. The destruction is entirely native.
//     THAT IS WHAT MAKES DEFERRING A CORRECT ROUTING DECISION rather than a way
//     of handing the user's part to a second destroyer. (An earlier revision of
//     this comment claimed the OCCT arm destroys the plate too; that claim
//     contradicted the measurement and was wrong.)
//   * The post-condition is ARMED ONLY when the input face set ENCLOSES MATERIAL:
//     shellClosure — every boundary edge of the welded soup used exactly twice —
//     and a non-zero bounded volume. A caller that hands healBRep an already-open
//     or already-incomplete soup gets no material claim, because for an open
//     surface the divergence-theorem "volume" is an origin-dependent surface
//     integral, not an amount of material, and refusing on it would be inventing
//     a measurement. That boundary is deliberate, and the NEGATIVE arm below now
//     pins it with the five open bodies whose face normals happen to cancel —
//     the measured false refusals of the Newell-sum predicate this replaced.
//   * The refusal REASON reaches the caller only through fixShapeGeneral's
//     GeneralFixReport today. ShapeFix.cpp::tryNativeRepair and
//     Healing.cpp::tryNativeHeal both `return false` with no string channel in
//     their signatures, so they route correctly (false == defer to OCCT) but
//     drop the literal. Stated, not claimed as done.

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

// Defined with the ARMING ARM at the bottom; the instrument checks in the negative
// arm need the open-tube counterexample too.
static std::vector<Face*> openTube(TopologyBuilder& tb, double L, bool splitOneEdge);

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
    // WHICH LEG. Without this the two legs dual-cover each other and deleting one
    // of them entirely leaves the gate green — MEASURED on the first version of
    // this file: removing leg A outright still scored 74/74. These bodies are
    // all opened by the sliver drop, so it must be leg A that speaks.
    check(std::string(r.reason).find("opened a closed body") != std::string::npos,
          w + ": it is LEG A (closure) that fired, and it says so");
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
    // ---- THE TOTAL-DESTRUCTION BRANCH — every face removed as a sliver --------
    // healBRep has an early exit for "nothing survived the sliver pass" that used
    // to `return ok = true, reason = "all faces removed as slivers"`. It is a
    // SEPARATE return from the post-condition at the bottom of the function, so
    // nothing else in this file covers it: MEASURED on the first version, reverting
    // that branch to ok=true still scored 74/74. This body reaches it — a 0.01 mm
    // square 1e-7 thick at tol 0.05, where every one of the 12 triangles is below
    // the area floor as well as over the aspect limit.
    {
        TopologyBuilder tb;
        std::vector<Face*> f = triBox(tb, 0.01, 0.01, 1e-7);
        HealOptions opt; opt.tol = 0.05;
        HealReport r = healBRep(tb, f, opt);
        std::printf("    total destruction (all faces slivers): armed=%d ok=%d refused=%d "
                    "survivors=%zu slivers=%zu  V %.6g -> %.6g   reason=\"%s\"\n",
                    r.inputBoundsVolume ? 1 : 0, r.ok ? 1 : 0, r.destructionRefused ? 1 : 0,
                    r.faces.size(), r.sliverFacesRemoved, r.volumeBefore, r.volumeAfter,
                    r.reason ? r.reason : "");
        check(r.faces.empty(), "total-destruction: the branch really is reached (0 survivors)");
        check(r.inputBoundsVolume, "total-destruction: input enclosed material (armed)");
        check(!r.ok, "total-destruction: REFUSED — ok == false (this branch returned true)");
        check(r.destructionRefused, "total-destruction: refusal is the destruction post-condition");
        check(std::string(r.reason).find("emptied the body") != std::string::npos,
              "total-destruction: reason names the emptying, not \"all faces removed as slivers\"");
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
    {   // (7) A GLOBALLY INVERTED closed box — every face wound inward. This is a
        //     legitimate orientation defect (pass (6) flips it), and its signed
        //     volume is NEGATIVE, so it is the fixture that separates leg B's
        //     "magnitudes and LOSS only" rule from a naive |volumeAfter -
        //     volumeBefore| comparison. MEASURED on the first version of this file:
        //     swapping leg B for the naive delta still scored 74/74 AND refused
        //     this body. Nothing covered it.
        TopologyBuilder tb;
        const double L = 3.0;
        std::vector<Face*> f = boxRings(tb, L, -1, -1);
        std::vector<Face*> inv;
        for (Face* face : f) {
            std::vector<Point3> ring;
            for (Coedge* c = face->outerLoop->first;
                 ring.size() < face->outerLoop->coedgeCount && c; c = c->next)
                ring.push_back(c->originVertex()->point);
            std::reverse(ring.begin(), ring.end());
            inv.push_back(faceFromRing(tb, ring));
        }
        HealOptions opt; opt.tol = 1e-6;
        HealReport r = healBRep(tb, inv, opt);
        negativeReport("globally INVERTED box L=3", r);
        check(r.inputBoundsVolume, "neg/inverted-box: input encloses material (ARMED)");
        check(r.volumeBefore < 0.0, "neg/inverted-box: its signed volume really is NEGATIVE");
        check(std::fabs(r.boundedVolumeBefore - L*L*L) <= 1e-9,
              "neg/inverted-box: boundedVolume is +L^3 (orientation-independent)");
        check(r.ok && !r.destructionRefused,
              "neg/inverted-box: NOT refused — leg B compares MAGNITUDES and only on LOSS");
        check(std::fabs(std::fabs(r.volumeAfter) - L*L*L) <= 1e-9,
              "neg/inverted-box: volume magnitude still L^3");
        // WHY LEG B'S fabs() IS NOT COVERED BY A MUTANT, stated rather than hidden.
        // Now that leg B's "before" is shellClosure's orientation-independent
        // boundedVolume, the ONLY input class on which it differs from a naive
        // signed |volumeAfter - volumeBefore| is one where the heal returns a
        // CLOSED shell with NEGATIVE volume — and pass (6) normalises the shell
        // outward, so that class is empty. MEASURED across all 64 face-winding
        // masks of a box at two origin offsets: 0 of 128 armed+closed outputs had
        // a negative volume; the fully inverted case flips all six faces. The
        // naive-delta mutant is therefore EQUIVALENT, not a survivor. These two
        // checks pin the property that makes it so, so if the orientation pass
        // ever stops normalising, the gate says so and the fabs() becomes
        // load-bearing again.
        check(r.volumeAfter > 0.0, "neg/inverted-box: pass (6) normalises the shell OUTWARD");
        check(r.facesFlipped == 6, "neg/inverted-box: and it flipped all six faces to do it");
    }
    {   // (8) BOTH instruments, both ways. A predicate only ever observed saying
        //     "not armed" would be unfalsifiable — and the pair matters here,
        //     because the whole round-2 correction is that these two answer
        //     DIFFERENT questions and only one of them answers closedness.
        {   TopologyBuilder tb;
            check(shellBoundsVolume(triBox(tb, 7.0, 3.0, 2.0)),
                  "instrument/gauss: a complete box soup has a vanishing area-vector sum"); }
        {   TopologyBuilder tb;
            check(!shellBoundsVolume(boxRings(tb, 3.0, -1, 1)),
                  "instrument/gauss: a box missing a face does not"); }
        {   std::vector<Face*> none;
            check(!shellBoundsVolume(none), "instrument/gauss: an empty set bounds nothing"); }
        {   // THE COUNTEREXAMPLE that makes the Gauss test unusable as a closedness
            //     test, asserted here so nobody re-arms on it: an OPEN tube passes it.
            TopologyBuilder tb;
            std::vector<Face*> tube = openTube(tb, 3.0, false);
            check(shellBoundsVolume(tube),
                  "instrument/gauss: an OPEN TUBE also passes it — the converse of "
                  "Gauss's theorem is FALSE, which is why it cannot arm the guard");
            check(shellClosure(tube, 1e-5).verdict == ShellClosureVerdict::Open,
                  "instrument/closure: and the topological test calls the same tube OPEN"); }
        {   TopologyBuilder tb;
            const ShellClosure c = shellClosure(triBox(tb, 7.0, 3.0, 2.0), 1e-6);
            check(c.verdict == ShellClosureVerdict::Closed, "instrument/closure: a box soup is CLOSED");
            check(c.boundsMaterial, "instrument/closure: and it encloses material");
            check(std::fabs(c.boundedVolume - 42.0) <= 1e-9,
                  "instrument/closure: boundedVolume == 7*3*2"); }
        {   TopologyBuilder tb;
            check(shellClosure(boxRings(tb, 3.0, -1, 1), 1e-6).verdict == ShellClosureVerdict::Open,
                  "instrument/closure: a box missing a face is OPEN"); }
        {   TopologyBuilder tb;
            const ShellClosure c = shellClosure(boxRings(tb, 3.0, 2, -1), 1e-6);
            check(c.verdict == ShellClosureVerdict::InconsistentlyWound,
                  "instrument/closure: a box with ONE reversed face is INCONSISTENTLY WOUND, "
                  "a distinct verdict from OPEN (this is the round-1 disarm)");
            check(c.boundsMaterial && std::fabs(c.boundedVolume - 27.0) <= 1e-9,
                  "instrument/closure: it still bounds 27 — the backwards face does not "
                  "corrupt the number leg B compares against");
            check(c.misorientedEdges == 4,
                  "instrument/closure: and it names the 4 edges whose uses agree in direction"); }
        {   // a 3+-use edge is NON-MANIFOLD, a third distinct verdict.
            TopologyBuilder tb;
            std::vector<Face*> f = boxRings(tb, 2.0, -1, -1);
            f.push_back(faceFromRing(tb, {{0,0,0},{2,0,0},{2,0,2},{0,0,2}}));  // extra wall on an edge
            check(shellClosure(f, 1e-6).verdict == ShellClosureVerdict::NonManifold,
                  "instrument/closure: a 3-faces-on-an-edge join is NON-MANIFOLD"); }
        {   std::vector<Face*> none;
            check(!shellClosure(none, 1e-6).boundsMaterial,
                  "instrument/closure: an empty set bounds nothing"); }
    }
}

// ===========================================================================
// THE ARMING ARM — the predicate itself, both ways.
//
// Everything above tests the two LEGS. This section tests the thing that decides
// whether the legs run at all, and it is the part that was wrong in round 1. Two
// halves, because a predicate can fail in two opposite directions and a gate that
// only pins one of them is not measuring the predicate:
//   OVER-ARM  bodies that are NOT closed must not be refused (the five measured
//             false refusals of the Newell-sum predicate);
//   UNDER-ARM bodies that ARE closed must stay armed through the two defect
//             classes that disarmed the Newell-sum predicate (a backwards face,
//             a sub-tolerance gap).
// ===========================================================================

// An open rectangular TUBE: the four side walls of a box, no caps. The canonical
// counterexample to "SUM of the area vectors is zero, therefore closed" — +x/-x
// and +y/-y cancel exactly while the body is as open as a body can be.
static std::vector<Face*> openTube(TopologyBuilder& tb, double L, bool splitOneEdge) {
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a,a,a},{b,a,a},{b,b,a},{a,b,a},{a,a,b},{b,a,b},{b,b,b},{a,b,b},
    };
    std::vector<Face*> f;
    f.push_back(faceFromRing(tb, {P[0],P[1],P[5],P[4]}));            // front
    f.push_back(faceFromRing(tb, {P[2],P[3],P[7],P[6]}));            // back
    if (splitOneEdge) {
        // A REAL repairable defect: one wall carries a collinear mid-vertex on the
        // shared vertical edge (heal_test's own split-edge defect class).
        const Point3 mid{P[0].x, P[0].y, (P[0].z + P[4].z) * 0.5};
        f.push_back(faceFromRing(tb, {P[0],mid,P[4],P[7],P[3]}));    // left, SPLIT
    } else {
        f.push_back(faceFromRing(tb, {P[0],P[4],P[7],P[3]}));        // left
    }
    f.push_back(faceFromRing(tb, {P[1],P[2],P[6],P[5]}));            // right
    return f;
}

// A hexagonal open tube — an extruded profile shell, the commonest real
// open-tube CAD artefact, whose six wall normals also cancel by symmetry.
static std::vector<Face*> hexOpenTube(TopologyBuilder& tb, double R, double H) {
    std::vector<Point3> lo, hi;
    for (int i = 0; i < 6; ++i) {
        const double t = 2.0 * 3.14159265358979323846 * i / 6.0;
        lo.push_back(Point3{R * std::cos(t), R * std::sin(t), 0.0});
        hi.push_back(Point3{R * std::cos(t), R * std::sin(t), H});
    }
    std::vector<Face*> f;
    for (int i = 0; i < 6; ++i) {
        const int j = (i + 1) % 6;
        f.push_back(faceFromRing(tb, {lo[i], lo[j], hi[j], hi[i]}));
    }
    return f;
}

static void notArmed(const char* what, std::vector<Face*> faces, TopologyBuilder& tb,
                     double tol, const char* why) {
    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    std::printf("    %s: armed=%d ok=%d refused=%d closed=%d  V %.6g -> %.6g   reason=\"%s\"\n",
                what, r.inputBoundsVolume ? 1 : 0, r.ok ? 1 : 0, r.destructionRefused ? 1 : 0,
                r.after.closed ? 1 : 0, r.volumeBefore, r.volumeAfter, r.reason ? r.reason : "");
    const std::string w(what);
    check(!r.inputBoundsVolume, w + std::string(": NOT armed — ") + why);
    check(!r.destructionRefused, w + ": NOT refused (this was a measured false refusal)");
    check(r.ok, w + ": still ok == true");
    // The heal really did leave the body alone — otherwise "not refused" would be
    // hiding a destruction rather than proving the predicate stood down correctly.
    check(std::fabs(r.volumeAfter - r.volumeBefore) <= 1e-9 * (1.0 + std::fabs(r.volumeBefore)),
          w + ": and its volume is untouched");
}

static void runArmingArm() {
    std::printf("[ARMING/over] open bodies whose normals CANCEL must NOT be refused\n");
    {   TopologyBuilder tb;
        notArmed("open tube (top+bottom missing)", openTube(tb, 3.0, false), tb, 1e-5,
                 "an open tube is open, whatever Gauss's residual says"); }
    {   TopologyBuilder tb;
        notArmed("open tube + SPLIT edge", openTube(tb, 3.0, true), tb, 1e-5,
                 "a split edge is a repairable defect, not a closure"); }
    {   TopologyBuilder tb;
        notArmed("hex open tube (extruded profile)", hexOpenTube(tb, 10.0, 4.0), tb, 1e-5,
                 "a profile shell with no caps is open"); }
    {   // zero-thickness sandwich: a closed 2-cycle with NO material in it.
        TopologyBuilder tb;
        const Point3 A{0,0,0}, B{10,0,0}, C{10,10,0}, D{0,10,0};
        std::vector<Face*> f;
        f.push_back(faceFromRing(tb, {A,B,C,D}));
        f.push_back(faceFromRing(tb, {A,D,C,B}));
        notArmed("zero-thickness sandwich", f, tb, 1e-5,
                 "a closed cycle bounding NO volume has nothing to conserve"); }
    {   // two parallel opposite-facing plates, 8 free edges.
        TopologyBuilder tb;
        std::vector<Face*> f;
        f.push_back(faceFromRing(tb, {{0,0,0},{10,0,0},{10,10,0},{0,10,0}}));
        f.push_back(faceFromRing(tb, {{0,0,5},{0,10,5},{10,10,5},{10,0,5}}));
        notArmed("parallel opposite plate pair", f, tb, 1e-5, "two loose sheets are not a body"); }
    {   // a closed box PLUS a disjoint open tube: the soup's residual still cancels.
        TopologyBuilder tb;
        std::vector<Face*> f = boxRings(tb, 2.0, -1, -1);
        TopologyBuilder& tb2 = tb;
        std::vector<Face*> t = openTube(tb2, 3.0, false);
        for (Face* x : t) f.push_back(x);
        notArmed("closed box + DISJOINT open tube", f, tb, 1e-5,
                 "one open component makes the soup open"); }

    std::printf("[ARMING/under] closed bodies must STAY armed through the two disarms\n");
    {   // (i) ONE BACKWARDS FACE. 12/12 flips of the T-137 plate disarmed the old
        //     predicate and 6/12 then returned ok=true having lost >half the part.
        int armed = 0, refused = 0, silent = 0;
        for (int i = 0; i < 12; ++i) {
            TopologyBuilder tb;
            std::vector<Face*> f = triBox(tb, 100.0, 100.0, 0.001);
            // reverse triangle i in place by rebuilding it backwards
            std::vector<Face*> g;
            for (int k = 0; k < (int)f.size(); ++k) {
                if (k != i) { g.push_back(f[(std::size_t)k]); continue; }
                std::vector<Point3> ring;
                for (Coedge* c = f[(std::size_t)k]->outerLoop->first;
                     ring.size() < f[(std::size_t)k]->outerLoop->coedgeCount && c; c = c->next)
                    ring.push_back(c->originVertex()->point);
                std::reverse(ring.begin(), ring.end());
                g.push_back(faceFromRing(tb, ring));
            }
            HealOptions opt; opt.tol = 1e-6;
            HealReport r = healBRep(tb, g, opt);
            if (r.inputBoundsVolume) ++armed;
            if (r.destructionRefused) ++refused;
            if (r.ok && std::fabs(r.volumeAfter) < 0.5 * 10.0) ++silent;
            if (i == 0) {
                std::printf("    flip sweep sample (tri 0): armed=%d refused=%d closure=%d "
                            "boundedV=%.6g  V %.6g -> %.6g\n",
                            r.inputBoundsVolume ? 1 : 0, r.destructionRefused ? 1 : 0,
                            (int)r.inputClosure, r.boundedVolumeBefore,
                            r.volumeBefore, r.volumeAfter);
                check(r.inputClosure == ShellClosureVerdict::InconsistentlyWound,
                      "flip: the verdict is INCONSISTENTLY WOUND, a distinct answer from OPEN");
                check(std::fabs(r.boundedVolumeBefore - 10.0) <= 1e-9,
                      "flip: boundedVolume is the part's REAL volume (10), not the "
                      "corrupted signed sum the backwards face produces");
            }
        }
        std::printf("    flip sweep: armed %d/12, refused %d/12, SILENT >half-loss %d/12\n",
                    armed, refused, silent);
        check(armed == 12, "flip sweep: all 12 backwards-face variants stay ARMED (was 0/12)");
        check(refused == 12, "flip sweep: all 12 are REFUSED");
        check(silent == 0, "flip sweep: NONE is silently destroyed (was 6/12)");
    }
    {   // (ii) A SUB-TOLERANCE GAP. Same plate, one corner nudged 1e-4 at tol 1e-3:
        //      the old predicate refused on some faces and returned ok=true with the
        //      part gone on others, decided purely by which corner moved.
        int armed = 0, refused = 0, silent = 0;
        for (int i = 0; i < 12; ++i) {
            TopologyBuilder tb;
            std::vector<Face*> f = triBox(tb, 100.0, 100.0, 0.001);
            std::vector<Face*> g;
            for (int k = 0; k < (int)f.size(); ++k) {
                if (k != i) { g.push_back(f[(std::size_t)k]); continue; }
                std::vector<Point3> ring;
                for (Coedge* c = f[(std::size_t)k]->outerLoop->first;
                     ring.size() < f[(std::size_t)k]->outerLoop->coedgeCount && c; c = c->next)
                    ring.push_back(c->originVertex()->point);
                ring[0].x += 1e-4;
                g.push_back(faceFromRing(tb, ring));
            }
            HealOptions opt; opt.tol = 1e-3;
            HealReport r = healBRep(tb, g, opt);
            if (r.inputBoundsVolume) ++armed;
            if (r.destructionRefused) ++refused;
            if (r.ok && std::fabs(r.volumeAfter) < 0.5 * 10.0) ++silent;
        }
        std::printf("    sub-tol sweep: armed %d/12, refused %d/12, SILENT >half-loss %d/12\n",
                    armed, refused, silent);
        check(armed == 12, "sub-tol sweep: all 12 nudge positions stay ARMED (was 8/12)");
        check(refused == 12, "sub-tol sweep: all 12 are REFUSED, whichever corner moved");
        check(silent == 0, "sub-tol sweep: NONE is silently destroyed (was 4/12)");
    }
    {   // (iii) THE QUIET PRODUCTION SETTING: precision=0.001 on a 0.001-thick plate,
        //       i.e. opt.tol EQUAL TO the wall thickness. The weld folds the body flat
        //       before it can be paired, so the single-tolerance verdict is NonManifold
        //       and the guard would stand down on the very body being destroyed. This
        //       is what the tolerance sweep in shellClosure exists for.
        for (double t : {0.001, 0.01}) {
            TopologyBuilder tb;
            HealOptions opt; opt.tol = t;
            HealReport r = healBRep(tb, triBox(tb, 100.0, 100.0, 0.001), opt);
            char nm[80]; std::snprintf(nm, sizeof nm, "plate 100x100x0.001 at tol==thickness %g", t);
            std::printf("    %s: armed=%d ok=%d refused=%d  V %.6g -> %.6g\n",
                        nm, r.inputBoundsVolume ? 1 : 0, r.ok ? 1 : 0,
                        r.destructionRefused ? 1 : 0, r.volumeBefore, r.volumeAfter);
            check(r.inputBoundsVolume, std::string(nm) + ": ARMED (the tolerance sweep fires)");
            check(!r.ok && r.destructionRefused, std::string(nm) + ": REFUSED");
        }
    }
}

int main() {
    std::printf("=== heal destruction-refusal gate (T-137) ===\n");
    std::printf("A repair that empties the user's part must REFUSE, not report success.\n\n");
    runPositiveArm();
    std::printf("\n");
    runNegativeArm();
    std::printf("\n");
    runArmingArm();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
