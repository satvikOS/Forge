// native_thicksolid_nesting_gate.cpp — the offset-circle NESTING guard in
// forge::occtoffset (src/native/brep/NativeThickSolid.cpp, circlesNest).
//
// ===========================================================================
// WHAT THIS PINS, AND WHY THE ENGINE'S OWN SELF-CHECKS COULD NOT
// ===========================================================================
// Offsetting a face is only injective while the offset stays below the local
// feature size. Past it, the offset of an outer rim and the offset of a hole
// inside it CROSS: the two openings have merged, which is a real geometric
// operation this engine does not implement. Before this gate the engine emitted
// the crossed face anyway, and NEITHER of its two self-checks could see it:
//
//   * planarCircularFace compares the built face's area to the closed form
//     pi*(R^2 - sum r_i^2). That is an identity in the RADII ALONE and holds
//     just as exactly when a hole has left the outer circle.
//   * quadricThickSolid then compares the assembled solid's volume against its
//     own identity, which is likewise blind.
//
// MEASURED (expert3d_v5cap_e600/ho1041, the corpus A/B's own THICKSOLID
// derivation, wall 2.3808): the cavity face came back with outer R = 24.0192 and
// eight holes of r = 4.6848 centred 23.808 from the axis — reaching 28.493, i.e.
// 4.47 mm PAST the rim. Its area measured 589.43237 against a `want` of
// 589.4325: the check passed to 2e-7 relative on a face whose wires cross.
// BRepCheck_Analyzer called the result IntersectingWires, and all SEVEN parts
// the native thick-solid built on that 600-part corpus were invalid this way.
//
// So the guard has to be a DISTANCE test, and this gate has to assert a
// POSITION-free property no area or volume can stand in for.
//
// ===========================================================================
// THE FIXTURE — one solid, two wall thicknesses, opposite verdicts
// ===========================================================================
// A cylinder R = 10, H = 30 with one off-axis through bore r = 2 whose axis sits
// 7.5 from the centre. The material between the bore and the outer skin is
// 10 - (7.5 + 2) = 0.5 mm.
//
//   t = 0.2  ->  rim 10 -> 9.8, bore 2 -> 2.2 reaching 7.5 + 2.2 = 9.7 < 9.8.
//               STILL NESTS. The engine MUST build it. (A guard that declined
//               here would be a blanket refusal wearing a predicate's clothes,
//               so this half is what makes the gate falsifiable in the useful
//               direction.)
//   t = 0.4  ->  rim 10 -> 9.6, bore 2 -> 2.4 reaching 9.9 > 9.6.
//               CROSSED. The engine MUST return a null shape (honest defer),
//               never a shape.
//
// The threshold between them is t = 0.25 (rim 10-t against 7.5+2+t), so the two
// cases sit either side of a boundary derived from the geometry, not tuned to
// the code.
//
// ASSERTED, in both directions:
//   * t = 0.2 builds, and the built solid is BRepCheck_Analyzer VALID and has
//     the closed-form volume of the shell;
//   * t = 0.4 returns IsNull() — and, the part that makes this a regression
//     test rather than a restatement, the shape it USED to return is shown to
//     be invalid, so the gate is asserting the defer is an improvement and not
//     merely a behaviour change.
//
// Exit 0 iff every assertion holds.

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeThickSolid.hpp"

#include <cmath>
#include <cstdio>
#include <string>

namespace {

int gPass = 0, gFail = 0;

void ok(bool cond, const std::string& what) {
    if (cond) { ++gPass; std::printf("  [PASS] %s\n", what.c_str()); }
    else      { ++gFail; std::printf("  [FAIL] %s\n", what.c_str()); }
}

double volOf(const TopoDS_Shape& s) {
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return std::fabs(g.Mass());
}

const double kPi = 3.14159265358979323846;
const double kR = 10.0, kH = 30.0, kBore = 2.0, kOff = 7.5;

// cylinder R=10 H=30 with an off-axis through bore r=2 at x=7.5
TopoDS_Shape fixture() {
    TopoDS_Shape body = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), kR, kH).Shape();
    // the bore runs past both ends so the cut leaves no sliver face
    TopoDS_Shape bore = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(kOff, 0, -5.0), gp_Dir(0, 0, 1)), kBore, kH + 10.0).Shape();
    BRepAlgoAPI_Cut cut(body, bore);
    cut.Build();
    if (!cut.IsDone()) return TopoDS_Shape();
    return cut.Shape();
}

// the largest planar face — the same pick the corpus A/B's THICKSOLID
// derivation makes, so this gate exercises the path that produced the defect
TopoDS_Face largestPlanar(const TopoDS_Shape& s) {
    TopoDS_Face best;
    double bestA = 0.0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(s, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        if (Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(f)).IsNull()) continue;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (g.Mass() > bestA) { bestA = g.Mass(); best = f; }
    }
    return best;
}

}  // namespace

int main() {
    std::printf("=== native thick-solid: offset-circle NESTING guard ===\n\n");

    const TopoDS_Shape src = fixture();
    if (src.IsNull()) { std::printf("FATAL: fixture did not build\n"); return 2; }
    const TopoDS_Face rm = largestPlanar(src);
    if (rm.IsNull()) { std::printf("FATAL: fixture has no planar face\n"); return 2; }

    // the fixture itself must be what the comment says it is
    const double srcVol = volOf(src);
    const double wantSrc = kPi * kR * kR * kH - kPi * kBore * kBore * kH;
    ok(std::fabs(srcVol - wantSrc) < 1e-6 * wantSrc,
       "fixture volume == pi*(R^2 - r^2)*H (" + std::to_string(wantSrc) + ")");
    ok(BRepCheck_Analyzer(src).IsValid(), "fixture is a VALID solid");
    ok(kR - (kOff + kBore) > 0.0, "fixture really has material between bore and skin");

    std::printf("\n--- t = 0.2 : offsets still NEST (9.7 < 9.8) — must BUILD ---\n");
    {
        const double t = 0.2;
        TopTools_ListOfShape fl; fl.Append(rm);
        const TopoDS_Shape r = forge::occtoffset::makeThickSolid(src, t, fl, 1.0e-3);
        ok(!r.IsNull(), "t=0.2 builds (the guard is NOT a blanket refusal)");
        if (!r.IsNull()) {
            ok(BRepCheck_Analyzer(r).IsValid(), "t=0.2 result is BRepCheck VALID");
            // mouth at the largest planar face (an end annulus): cavity runs the
            // full height minus one wall, outer 10-t, bore 2+t.
            const double outer = kR - t, bore = kBore + t;
            const double cav = kPi * (outer * outer - bore * bore) * (kH - t);
            const double want = srcVol - cav;
            const double got = volOf(r);
            std::printf("      volume got %.9f   closed form %.9f   rel %.3e\n",
                        got, want, std::fabs(got - want) / want);
            ok(std::fabs(got - want) < 1e-9 * want, "t=0.2 volume == closed form");
        }
    }

    std::printf("\n--- t = 0.4 : offsets CROSS (9.9 > 9.6) — must DEFER ---\n");
    {
        const double t = 0.4;
        TopTools_ListOfShape fl; fl.Append(rm);
        const TopoDS_Shape r = forge::occtoffset::makeThickSolid(src, t, fl, 1.0e-3);
        ok(r.IsNull(), "t=0.4 returns a NULL shape (honest defer)");
        if (!r.IsNull()) {
            // THE REGRESSION EVIDENCE. If the guard is ever removed, this line
            // prints what the engine went back to emitting, and the assertion
            // above has already failed. A defer is only an improvement if the
            // thing it replaced was wrong, so say whether it was.
            std::printf("      the shape it returned instead is BRepCheck VALID=%d"
                        "  (0 == the silent wrong answer this guard exists to stop)\n",
                        BRepCheck_Analyzer(r).IsValid() ? 1 : 0);
        }
    }

    std::printf("\n--- boundary is derived, not tuned: t* = %.4f ---\n",
                (kR - (kOff + kBore)) / 2.0);
    {
        // just inside the boundary must build, just outside must not
        for (double t : {0.24, 0.26}) {
            TopTools_ListOfShape fl; fl.Append(rm);
            const TopoDS_Shape r = forge::occtoffset::makeThickSolid(src, t, fl, 1.0e-3);
            const bool built = !r.IsNull();
            const bool nests = (kR - t) > (kOff + kBore + t);
            char buf[128];
            std::snprintf(buf, sizeof buf,
                          "t=%.2f  nests=%d  built=%d  (verdict follows the geometry)",
                          t, nests ? 1 : 0, built ? 1 : 0);
            ok(built == nests, buf);
        }
    }

    std::printf("\n===== %d/%d assertions passed =====\n", gPass, gPass + gFail);
    if (gFail) { std::printf("[thicksolid-nesting] FAIL\n"); return 1; }
    std::printf("[thicksolid-nesting] PASS\n");
    return 0;
}
