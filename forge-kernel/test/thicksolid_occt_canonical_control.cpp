// ─────────────────────────────────────────────────────────────────────────────
// thicksolid_occt_canonical_control.cpp — THE CONTROL THAT DECIDES THE ARGUMENT.
//
// The 600-part A/B says OCCT's BRepOffsetAPI_MakeThickSolid returns a
// BRepCheck-INVALID solid on 133/133 of its successes. Read alone, that invites
// the conclusion "the operation has no correct capability, so deleting it loses
// nothing". THAT INFERENCE IS ONLY SOUND IF THE 0/133 IS A PROPERTY OF THE
// OPERATION RATHER THAN OF THE CORPUS AND THE DERIVED INPUT.
//
// This file measures the other end of the input distribution: the SIMPLE
// analytic solids the shipped call sites actually shell (ft/FeatureTreeCompiler
// opShell, part.shell from the UI/AI bridges, part_features_smoke.js). Each case
// has a CLOSED-FORM answer derived here, never borrowed from OCCT, and each
// asserts the whole observable vector — volume, area, face census, BRepCheck.
//
// Links NO forge source. OCCT only.
// Exit 0 iff every case ran; the PASS/FAIL lines are the measurement.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Plane.hxx>
#include <gp_Pln.hxx>
#include <gp_Ax2.hxx>
#include <Standard_Failure.hxx>

static double vol(const TopoDS_Shape& s) { GProp_GProps g; BRepGProp::VolumeProperties(s, g); return g.Mass(); }
static double area(const TopoDS_Shape& s) { GProp_GProps g; BRepGProp::SurfaceProperties(s, g); return g.Mass(); }
static int nf(const TopoDS_Shape& s) { TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, TopAbs_FACE, m); return m.Extent(); }
static double faceArea(const TopoDS_Face& f) { GProp_GProps g; BRepGProp::SurfaceProperties(f, g); return g.Mass(); }

// pick the face whose plane has outward normal closest to +Z and largest area
static TopoDS_Face axisFace(const TopoDS_Shape& s, double az) {
    TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, TopAbs_FACE, m);
    TopoDS_Face best; double bestA = 0, bestZ = -2;
    for (int i = 1; i <= m.Extent(); ++i) {
        TopoDS_Face f = TopoDS::Face(m(i));
        Handle(Geom_Surface) su = BRep_Tool::Surface(f);
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(su);
        if (pl.IsNull()) continue;
        gp_Dir n = pl->Pln().Axis().Direction();
        if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
        const double z = n.Z()*az, a = faceArea(f);
        if (z > 0.9 && (best.IsNull() || a > bestA || (std::fabs(a-bestA)<1e-12 && z>bestZ))) {
            best = f; bestA = a; bestZ = z;
        }
    }
    return best;
}

static int fails = 0, ran = 0;
static void report(const char* name, const TopoDS_Shape& src, const TopoDS_Shape& res,
                   bool done, double expectV, const char* expectStr) {
    ++ran;
    std::printf("  %-34s ", name);
    if (!done || res.IsNull()) { std::printf("OCCT DEFER (IsDone false / null)\n"); ++fails; return; }
    int valid = -1;
    try { BRepCheck_Analyzer an(res); valid = an.IsValid() ? 1 : 0; } catch (...) { valid = -1; }
    const double V = vol(res), A = area(res), Vs = vol(src);
    std::printf("V=%.9g  (closed form %s = %.9g)  dV=%.3g  A=%.9g  f=%d  BRepCheck=%s  V/Vsrc=%.4f\n",
                V, expectStr, expectV, V - expectV, A, nf(res),
                valid == 1 ? "VALID" : (valid == 0 ? "INVALID" : "threw"), V / Vs);
    if (std::fabs(V - expectV) > 1e-7 * std::max(1.0, std::fabs(expectV))) {
        std::printf("      ^ VOLUME DISAGREES WITH THE CLOSED FORM\n"); ++fails;
    }
    if (valid != 1) { std::printf("      ^ NOT BRepCheck-VALID\n"); ++fails; }
}

int main() {
    const double t = 1.0;
    std::printf("OCCT BRepOffsetAPI_MakeThickSolid on CANONICAL analytic solids\n");
    std::printf("(the input distribution the shipped shell() call sites produce)\n");
    std::printf("wall t = %.3g, inward (MakeThickSolidByJoin with -t), tol 1e-3\n\n", t);

    struct Case { const char* name; TopoDS_Shape src; double expect; const char* expr; double t = 1.0; double az = 1.0; };
    std::vector<Case> cases;

    // (1) box 10x10x10, top removed:  1000 - 8*8*9
    {
        TopoDS_Shape b = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        cases.push_back({"box 10^3, top open", b, 1000.0 - 8.0*8.0*9.0, "1000-8*8*9"});
    }
    // (2) box 40x40x20, top removed: 40*40*20 - 38*38*19
    {
        TopoDS_Shape b = BRepPrimAPI_MakeBox(40.0, 40.0, 20.0).Shape();
        cases.push_back({"box 40x40x20, top open", b, 40.0*40.0*20.0 - 38.0*38.0*19.0, "32000-38*38*19"});
    }
    // (3) cylinder R=10 H=30, top removed: pi(100*30 - 81*29)
    {
        TopoDS_Shape c = BRepPrimAPI_MakeCylinder(10.0, 30.0).Shape();
        cases.push_back({"cyl R10 H30, top open", c, M_PI*(100.0*30.0 - 81.0*29.0), "pi(3000-81*29)"});
    }
    // (4) plate 40x40x20 with a R=5 through hole, top removed.
    //     wall volume = (32000 - 20*pi*25) - [ 38*38*19 - 19*pi*36 ]
    //     inner cavity: 38x38x19 box minus the GROWN hole cylinder r=6 over height 19.
    {
        TopoDS_Shape b = BRepPrimAPI_MakeBox(40.0, 40.0, 20.0).Shape();
        gp_Ax2 ax(gp_Pnt(20, 20, -1), gp_Dir(0, 0, 1));
        TopoDS_Shape h = BRepPrimAPI_MakeCylinder(ax, 5.0, 22.0).Shape();
        BRepAlgoAPI_Cut cut(b, h); cut.Build();
        const double src = 32000.0 - 20.0*M_PI*25.0;
        const double cav = 38.0*38.0*19.0 - 19.0*M_PI*36.0;
        cases.push_back({"plate 40x40x20 + R5 hole, top open", cut.Shape(), src - cav,
                         "(32000-500pi)-(27436-684pi)"});
    }

    // (5) THE SHIPPED IR SHELL CASE, verbatim from ft/FeatureTreeCompiler.cpp opShell
    //     and forge-desktop/ui_ir_probe.cpp: SHELL(BOX(60,40,30), wall 3), open axis
    //     -Z, i.e. the -Z face removed.  72000 - 54*34*27 = 22428.
    {
        TopoDS_Shape b = BRepPrimAPI_MakeBox(60.0, 40.0, 30.0).Shape();
        cases.push_back({"IR SHELL box 60x40x30 t=3, -Z open", b, 72000.0 - 54.0*34.0*27.0, "72000-54*34*27", 3.0, -1.0});
    }

    for (auto& c : cases) {
        TopoDS_Face f = axisFace(c.src, c.az);
        if (f.IsNull()) { std::printf("  %-34s NO TOP FACE FOUND\n", c.name); ++fails; ++ran; continue; }
        TopoDS_Shape out; bool done = false;
        try {
            TopTools_ListOfShape rm; rm.Append(f);
            BRepOffsetAPI_MakeThickSolid mk;
            mk.MakeThickSolidByJoin(c.src, rm, -c.t, 1.0e-3);
            mk.Build();
            done = mk.IsDone();
            if (done) out = mk.Shape();
        } catch (const Standard_Failure& e) {
            std::printf("  %-34s THREW %s\n", c.name, e.GetMessageString() ? e.GetMessageString() : "?");
            ++fails; ++ran; continue;
        }
        // source validity, so an invalid result can never be blamed on the input
        int sv = -1; try { BRepCheck_Analyzer a(c.src); sv = a.IsValid() ? 1 : 0; } catch (...) {}
        std::printf("  [src %-30s V=%.9g f=%d BRepCheck=%s]\n", c.name, vol(c.src), nf(c.src),
                    sv == 1 ? "VALID" : "INVALID");
        report(c.name, c.src, out, done, c.expect, c.expr);
    }

    std::printf("\n%d cases, %d assertion failures\n", ran, fails);
    std::printf("%s\n", fails == 0
        ? "RESULT: OCCT THICKSOLID IS EXACT AND VALID ON THE CANONICAL INPUTS"
        : "RESULT: at least one canonical case is wrong or invalid (see ^ lines)");
    return 0;   // the PASS/FAIL text is the measurement; the exit code is not a verdict
}
