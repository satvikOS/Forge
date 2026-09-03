// forge-kernel/test/pipeshell_guided_gate.cpp — TKOffset family F, the GUIDED
// half of BRepOffsetAPI_MakePipeShell.
//
// WHY THIS FILE EXISTS. The corpus A/B (test/corpus_ab_coverage.cpp) measures
// family F at 599/600 — one part from its flip gate — and that number is about
// the UNGUIDED sweep, because the harness passes an empty guide list. All three
// production call sites of MakePipeShell exist to serve GUIDED sweeps
// (src/Features.cpp:736 and :2828, src/ClassASurfacing.cpp:771); an unguided
// sweep is family E's job. So the near-passing coverage number is measured on an
// input distribution the call sites do not produce, and nothing in the tree
// measured the guided half at all: the two smoke tests that drive a guided sweep
// (test/part_features_smoke.js:624, test/push07_classa_smoke.js:190) each wrap
// the call in a try/catch that PRINTS the exception and continues, so a build in
// which guided sweeping has ceased to exist passes both of them unchanged.
//
// This gate measures the guided half directly, two-sidedly, against live OCCT.
//
// BUILD + RUN: test/run_pipeshell_guided_gate.sh.  Exit 0 iff every check holds.
#include "forge/native/brep/NativeLoftPipe.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

namespace {

int gPass = 0, gFail = 0;
void check(bool ok, const std::string& what) {
    (ok ? gPass : gFail)++;
    std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
}

struct M {
    bool built = false;
    double vol = 0, area = 0;
    int faces = 0;
    bool valid = false;
};

int nFaces(const TopoDS_Shape& s) {
    int n = 0;
    for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) ++n;
    return n;
}

M measure(const TopoDS_Shape& s) {
    M m;
    if (s.IsNull()) return m;
    m.built = true;
    GProp_GProps v, a;
    BRepGProp::VolumeProperties(s, v);
    BRepGProp::SurfaceProperties(s, a);
    m.vol = std::fabs(v.Mass());
    m.area = a.Mass();
    m.faces = nFaces(s);
    m.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True;
    return m;
}

bool rel(double a, double b, double t) {
    const double s = std::max(std::fabs(a), std::fabs(b));
    return s < 1e-12 ? std::fabs(a - b) < t : std::fabs(a - b) / s < t;
}

// The OCCT incumbent, exactly as src/ClassASurfacing.cpp:771 drives it.
M occtPipeShell(const TopoDS_Wire& spine, const TopoDS_Wire& prof,
                const std::vector<TopoDS_Wire>& guides, bool solid) {
    try {
        BRepOffsetAPI_MakePipeShell mk(spine);
        for (const auto& g : guides) mk.SetMode(g, Standard_True);
        mk.Add(prof);
        mk.Build();
        if (!mk.IsDone()) return M();
        if (solid) mk.MakeSolid();
        return measure(mk.Shape());
    } catch (const Standard_Failure&) {
        return M();
    }
}

M nativePipeShell(const TopoDS_Wire& spine, const TopoDS_Wire& prof,
                  const std::vector<TopoDS_Wire>& guides, bool solid) {
    return measure(forge::occtloft::pipeShell(spine, prof, guides, solid, 1.0e-6));
}

TopoDS_Wire poly3(const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c) {
    BRepBuilderAPI_MakePolygon p;
    p.Add(a); p.Add(b); p.Add(c);
    return p.Wire();
}

}  // namespace

int main() {
    const double kPi = 3.14159265358979323846;

    // ── geometry ────────────────────────────────────────────────────────────
    // Profile: circle r=1 in the XY plane. Spine: 2 legs, TRANSVERSE to it.
    gp_Circ c(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 1.0);
    const TopoDS_Wire prof =
        BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(c).Edge()).Wire();
    const TopoDS_Wire spine =
        poly3(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 10), gp_Pnt(6, 0, 16));
    const double L = 10.0 + std::sqrt(36.0 + 36.0);       // leg lengths
    const double exact = kPi * 1.0 * 1.0 * L;             // mitred sweep volume

    // A guide that IS the spine translated by (3,0,0) — the identity case.
    const TopoDS_Wire gTrans =
        poly3(gp_Pnt(3, 0, 0), gp_Pnt(3, 0, 10), gp_Pnt(9, 0, 16));
    // A guide that SPREADS — a genuine section law, correctly declined.
    const TopoDS_Wire gSpread =
        poly3(gp_Pnt(3, 0, 0), gp_Pnt(5, 0, 10), gp_Pnt(11, 0, 16));

    const std::vector<TopoDS_Wire> none, one{gTrans}, spread{gSpread};

    std::printf("== TKOffset family F — GUIDED pipe-shell gate ==\n");
    std::printf("   spine legs %.6f + %.6f, exact mitred sweep volume %.9f\n",
                10.0, std::sqrt(72.0), exact);

    // ── A. native unguided is exact against the CLOSED FORM, not against OCCT
    const M nU = nativePipeShell(spine, prof, none, true);
    check(nU.built && rel(nU.vol, exact, 1e-9),
          "A native UNGUIDED volume == closed form pi*r^2*(L1+L2) "
          "(got " + std::to_string(nU.vol) + ", exact " + std::to_string(exact) + ")");
    check(nU.valid, "A native UNGUIDED result is BRepCheck_Analyzer VALID");

    // ── B. THE IDENTITY, and the POSITIVE CONTROL that the new path RAN.
    // A guide that is the spine rigidly translated has a constant section law, so
    // the guided sweep IS the unguided sweep. If guideIsSpineTranslate() were
    // absent or never reached, this would DEFER and the check would fail.
    const M nG = nativePipeShell(spine, prof, one, true);
    check(nG.built, "B native accepts a guide that is the spine TRANSLATED "
                    "(positive control: the new path ran)");
    check(nG.built && rel(nG.vol, nU.vol, 1e-12) && rel(nG.area, nU.area, 1e-12) &&
              nG.faces == nU.faces && nG.valid == nU.valid,
          "B native GUIDED(translate) == native UNGUIDED on volume+area+faces+validity");

    // ── C. the identity is a property of the OPERATION, not of our engine:
    // OCCT must also return its unguided answer for a translated guide.
    const M oU = occtPipeShell(spine, prof, none, true);
    const M oG = occtPipeShell(spine, prof, one, true);
    check(oU.built && oG.built && rel(oU.vol, oG.vol, 1e-5),
          "C OCCT GUIDED(translate) == OCCT UNGUIDED within 1e-5 "
          "(got " + std::to_string(oG.vol) + " vs " + std::to_string(oU.vol) + ")");

    // ── D. NEGATIVE CONTROL: a guide that is NOT a translate must still DEFER,
    // by name. Without this, B could be a blanket "accept every guide".
    const M nS = nativePipeShell(spine, prof, spread, true);
    check(!nS.built, "D native DEFERS a guide that is not a spine translate");
    check(std::string(forge::occtloft::lastDeferReason()) == "guides_not_spine_translate",
          std::string("D the defer names its reason (got \"") +
              forge::occtloft::lastDeferReason() + "\")");

    // ── E. and that declined case is genuinely DIFFERENT, so D is refusing
    // something real rather than something indistinguishable from the identity.
    const M oS = occtPipeShell(spine, prof, spread, true);
    check(oS.built && !rel(oS.vol, oU.vol, 1e-5),
          "E OCCT's spreading-guide answer DIFFERS from its unguided answer "
          "(got " + std::to_string(oS.vol) + " vs " + std::to_string(oU.vol) + ")");

    // ── F. WHAT THE DROP DELETES AT THE PRODUCTION ENTRY POINT.
    // forge::part::sweepWithGuides feeds wires from extractWires, which emits on
    // the world Z=0 plane (src/Features.cpp:472) — so the profile plane always
    // CONTAINS the spine. The native transport requires a transverse section and
    // declines. This is recorded as a MEASUREMENT, not as an aspiration: under
    // FORGE_PIPESHELL_DROP_NATIVE that decline is a thrown error for every input
    // that entry point can build, guided or not.
    const TopoDS_Wire coSpine =
        poly3(gp_Pnt(0, 0, 0), gp_Pnt(0, 5, 0), gp_Pnt(0, 10, 0));
    const M nC = nativePipeShell(coSpine, prof, none, true);
    const M oC = occtPipeShell(coSpine, prof, none, true);
    check(!nC.built, "F native DEFERS the COPLANAR profile+spine that "
                     "part::sweepWithGuides always builds");
    // ★ AND THE THING THAT CUTS AGAINST CALLING THAT A LOSS: OCCT's own answer
    //   for the same input is a ZERO-VOLUME shell. The drop replaces a silently
    //   degenerate result with a loud error; it does not delete working geometry
    //   at this entry point. If OCCT ever starts returning a real solid here,
    //   this check FAILS and the claim above must be rewritten.
    check(oC.built && oC.vol < 1e-9,
          "F OCCT's answer for that same coplanar input is a ZERO-VOLUME shell "
          "(vol " + std::to_string(oC.vol) + ", area " + std::to_string(oC.area) + ")");

    std::printf("\n%d passed, %d failed\n", gPass, gFail);
    return gFail == 0 ? 0 : 1;
}
