// ─────────────────────────────────────────────────────────────────────────────
// thrusections_xlate_label_gate.cpp — the TWO-DIRECTION control for the
// translated-section defer label in src/native/brep/NativeLoftPipe.cpp.
//
// WHAT IS UNDER TEST. `thruSectionsTranslate` cannot run its edge-aligned
// rotation search when the two section wires carry different numbers of edges,
// so it declines. Until now it recorded that decline as
// `xlate_edge_count_mismatch`, which reads as a STRUCTURAL fact ("relax the
// guard") when the binding fact may be GEOMETRIC ("these are different curves,
// build a ruled engine"). The engine now separates them with total wire LENGTH —
// decomposition-independent and exactly translation-invariant — and records
// `xlate_not_a_translate_length` when the lengths disagree.
//
// WHY THIS GATE EXISTS. A discriminator that has only ever been seen to fire one
// way is indistinguishable from one that always fires that way. This gate drives
// BOTH directions through the real `forge::occtloft::thruSections` entry:
//
//   SPLIT      same closed curve, one wire carrying an extra vertex
//              -> different edge counts, EQUAL lengths
//              -> must say `xlate_edge_count_mismatch`    (reading (a))
//   DIFFERENT  genuinely different closed curves
//              -> different edge counts, UNEQUAL lengths
//              -> must say `xlate_not_a_translate_length` (reading (b))
//
// and additionally pins the two properties the change must NOT disturb:
//
//   NEUTRAL-1  a true translate with MATCHING edge counts still BUILDS, and its
//              volume is still the exact prism volume;
//   NEUTRAL-2  a non-translate with MATCHING edge counts still says
//              `xlate_not_a_translate` — the pre-existing label, untouched.
//
// The SPLIT case is the load-bearing one: it is what would silently disappear if
// the length test were written the wrong way round, or with a tolerance loose
// enough to swallow every pair. Its assertion is that the NEW label does NOT
// fire, so a change that made the new label unconditional turns this gate red.
//
// build+run: bash test/run_thrusections_xlate_label_gate.sh
// exit 0 iff every assertion holds.
// ─────────────────────────────────────────────────────────────────────────────
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeLoftPipe.hpp"

namespace {

int g_fail = 0, g_pass = 0;

void ok(bool cond, const std::string& what) {
    if (cond) { ++g_pass; std::printf("  [ok]   %s\n", what.c_str()); }
    else      { ++g_fail; std::printf("  [FAIL] %s\n", what.c_str()); }
}

// Rectangle in the plane z, corners (+-hx, +-hy), as a 4-edge closed wire.
TopoDS_Wire rect4(double hx, double hy, double z) {
    BRepBuilderAPI_MakePolygon p;
    p.Add(gp_Pnt(-hx, -hy, z));
    p.Add(gp_Pnt( hx, -hy, z));
    p.Add(gp_Pnt( hx,  hy, z));
    p.Add(gp_Pnt(-hx,  hy, z));
    p.Close();
    return p.Wire();
}

// The SAME rectangle, but with the first side split at its midpoint: five edges,
// identical point set, identical total length. This is the topological split the
// label has to be able to name.
TopoDS_Wire rect5split(double hx, double hy, double z) {
    BRepBuilderAPI_MakePolygon p;
    p.Add(gp_Pnt(-hx, -hy, z));
    p.Add(gp_Pnt(0.0, -hy, z));      // <- the extra vertex, ON the same edge
    p.Add(gp_Pnt( hx, -hy, z));
    p.Add(gp_Pnt( hx,  hy, z));
    p.Add(gp_Pnt(-hx,  hy, z));
    p.Close();
    return p.Wire();
}

// One full circle as a single-edge closed wire, centred on the z axis.
TopoDS_Wire circle1(double r, double z) {
    const gp_Circ c(gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), r);
    BRepBuilderAPI_MakeEdge me(c);
    BRepBuilderAPI_MakeWire mw(me.Edge());
    return mw.Wire();
}
// The same, with the centre moved OFF that axis. See NEUTRAL-2 below for why the
// offset is load-bearing.
TopoDS_Wire circle1At(double r, double x, double z) {
    const gp_Circ c(gp_Ax2(gp_Pnt(x, 0, z), gp_Dir(0, 0, 1)), r);
    BRepBuilderAPI_MakeEdge me(c);
    BRepBuilderAPI_MakeWire mw(me.Edge());
    return mw.Wire();
}

double wireLen(const TopoDS_Wire& w) {
    GProp_GProps g;
    BRepGProp::LinearProperties(w, g);
    return g.Mass();
}

int nEdges(const TopoDS_Wire& w) {
    int n = 0;
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) ++n;
    return n;
}

bool reasonHas(const char* needle) {
    const char* r = forge::occtloft::lastDeferReason();
    return r && std::strstr(r, needle) != nullptr;
}

std::string reasonStr() {
    const char* r = forge::occtloft::lastDeferReason();
    return r ? std::string(r) : std::string("(null)");
}

}  // namespace

int main() {
    std::printf("thrusections_xlate_label_gate\n");

    // ── SPLIT: same curve, extra vertex. Equal length, unequal edge count. ──
    {
        const TopoDS_Wire a = rect4(20.0, 15.0, 0.0);
        const TopoDS_Wire b = rect5split(20.0, 15.0, 12.0);
        ok(nEdges(a) == 4 && nEdges(b) == 5, "SPLIT setup: edge counts are 4 and 5");
        const double la = wireLen(a), lb = wireLen(b);
        ok(std::fabs(la - lb) <= 1e-9 * la, "SPLIT setup: the two wires have EQUAL length");

        std::vector<TopoDS_Shape> secs{a, b};
        const TopoDS_Shape out = forge::occtloft::thruSections(secs, true, true, 1.0e-6);
        // Whether some other path covers this pair is not what is under test; the
        // label is. If it built, the translated path was never reached and the
        // case cannot speak — that is reported, never silently passed.
        if (!out.IsNull()) {
            ok(false, "SPLIT: the engine BUILT, so the translated path was not reached "
                      "- this control cannot fire and must be re-authored");
        } else {
            ok(reasonHas("xlate_edge_count_mismatch"),
               "SPLIT: label is xlate_edge_count_mismatch, got \"" + reasonStr() + "\"");
            ok(!reasonHas("xlate_not_a_translate_length"),
               "SPLIT: the LENGTH label must NOT fire on equal lengths");
        }
    }

    // ── DIFFERENT: genuinely different curves. Unequal length AND edge count. ─
    // This is the corpus population measured by test/thrusections_pair_probe.cpp:
    // every part the old label was declining has section lengths differing by
    // 2.3% to 38.7%.
    {
        const TopoDS_Wire a = rect4(20.0, 15.0, 0.0);
        BRepBuilderAPI_MakePolygon p;
        p.Add(gp_Pnt(-8.0, -6.0, 12.0));
        p.Add(gp_Pnt( 8.0, -6.0, 12.0));
        p.Add(gp_Pnt(10.0,  0.0, 12.0));
        p.Add(gp_Pnt( 8.0,  6.0, 12.0));
        p.Add(gp_Pnt(-8.0,  6.0, 12.0));
        p.Close();
        const TopoDS_Wire b = p.Wire();
        ok(nEdges(a) == 4 && nEdges(b) == 5, "DIFFERENT setup: edge counts are 4 and 5");
        const double la = wireLen(a), lb = wireLen(b);
        ok(std::fabs(la - lb) > 1e-3 * la, "DIFFERENT setup: the two wires have UNEQUAL length");

        std::vector<TopoDS_Shape> secs{a, b};
        const TopoDS_Shape out = forge::occtloft::thruSections(secs, true, true, 1.0e-6);
        if (!out.IsNull()) {
            ok(false, "DIFFERENT: the engine BUILT, so the translated path was not reached "
                      "- this control cannot fire and must be re-authored");
        } else {
            ok(reasonHas("xlate_not_a_translate_length"),
               "DIFFERENT: label is xlate_not_a_translate_length, got \"" + reasonStr() + "\"");
        }
    }

    // ── NEUTRAL-1: a true translate with MATCHING edge counts still builds. ──
    {
        const TopoDS_Wire a = rect4(20.0, 15.0, 0.0);
        const TopoDS_Wire b = rect4(20.0, 15.0, 12.0);
        std::vector<TopoDS_Shape> secs{a, b};
        const TopoDS_Shape out = forge::occtloft::thruSections(secs, true, true, 1.0e-6);
        ok(!out.IsNull(), "NEUTRAL-1: the translate pair still BUILDS");
        if (!out.IsNull()) {
            GProp_GProps g;
            BRepGProp::VolumeProperties(out, g);
            const double v = std::fabs(g.Mass());
            ok(std::fabs(v - 14400.0) <= 1e-9 * 14400.0,
               "NEUTRAL-1: volume is exactly 40*30*12 = 14400, got " + std::to_string(v));
        }
    }

    // ── NEUTRAL-2: a non-translate with MATCHING edge counts keeps its label. ─
    // Two circles of DIFFERENT radius: one edge each, so the edge-count guard is
    // not reached at all and the pre-existing geometric label must still be the
    // one recorded. (Circular sections also make the polygonal path decline, so
    // the translated path is genuinely reached.)
    //
    // ★ RE-AUTHORED. This control used to use two COAXIAL circles of different
    //   radius, and it fired its own "the engine BUILT - this control cannot fire
    //   and must be re-authored" arm the moment the coaxial-circle path landed:
    //   that pair is exactly the right circular frustum the new path now builds
    //   (test/ab_native_loftpipe_occt.cpp::ts-cone-frustum), so it can no longer
    //   reach any defer at all. The second circle's centre is therefore moved OFF
    //   the common axis, which is the SMALLEST change that restores the property
    //   this control is about — one edge each, still not a translate, and now
    //   also outside the coaxial-circle path's scope (an oblique cone is not a
    //   right circular one, so that path declines it as `cone_centres_off_axis`).
    //   The assertion itself is UNCHANGED: the translated path must still record
    //   `xlate_not_a_translate`, and must not record the LENGTH label.
    {
        const TopoDS_Wire a = circle1(20.0, 0.0);
        const TopoDS_Wire b = circle1At(10.0, 7.0, 12.0);
        ok(nEdges(a) == nEdges(b), "NEUTRAL-2 setup: edge counts MATCH (1 and 1)");
        std::vector<TopoDS_Shape> secs{a, b};
        const TopoDS_Shape out = forge::occtloft::thruSections(secs, true, true, 1.0e-6);
        if (!out.IsNull()) {
            ok(false, "NEUTRAL-2: the engine BUILT - this control cannot fire and must "
                      "be re-authored");
        } else {
            ok(reasonHas("xlate_not_a_translate") && !reasonHas("xlate_not_a_translate_length"),
               "NEUTRAL-2: keeps the pre-existing xlate_not_a_translate label, got \"" +
               reasonStr() + "\"");
        }
    }

    std::printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
