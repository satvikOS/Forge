// forge-kernel/test/native_vs_occt_section.cpp
//
// RIGOROUS 1:1 A/B HARNESS — native PLANAR SECTION / CUT-VIEW
//   (forge::native::brep::sectionSolid)   vs   OCCT
//   BRepAlgoAPI_Section + section-fill (ConnectEdgesToWires -> MakeFace ->
//   BRepGProp::SurfaceProperties).
//
// This is a STANDALONE C++20 oracle test that LINKS OCCT (brew opencascade
// 7.9.3). It is NOT part of the native gate (run_native.sh) and does NOT touch
// binding.cpp / CMakeLists.txt / the native gate. It builds the SAME four cases
// on BOTH sides and compares the physical signatures the planar section must
// match OCCT on: WIRE COUNT, filled section AREA, and section CENTROID.
//
// The four cases mirror section_test.cpp EXACTLY:
//   (1) box 10x6x4, mid-height cut z=2          -> 1 wire, area 60,  centroid (5,3,2)
//   (2) cylinder R=3 H=8, AXIAL cut y=0         -> 1 wire, area 48,  centroid (0,0,4)
//   (3) cylinder R=3 H=8, TRANSVERSE cut z=4    -> 1 wire, area pi*9, centroid (0,0,4)
//   (4) tube rO=4 rI=2 H=10, TRANSVERSE cut z=5 -> 2 wires, area pi*12, centroid (0,0,5)
//
// GATES (per case):
//   * WIRE COUNT native == OCCT (EQUAL).
//   * SECTION AREA native vs OCCT, relative <= 1e-6.
//   * SECTION CENTROID native vs OCCT, absolute <= 1e-6 (each component).
//
// Build + run (manual; mirrors native_vs_occt_fillet.cpp's build line + the OCCT
// section/fill link set):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     src/native/brep/Section.cpp src/native/brep/Surface.cpp \
//     src/native/brep/Topology.cpp src/native/brep/Primitives.cpp \
//     src/native/brep/SurfaceIntersect.cpp src/native/brep/Nurbs.cpp \
//     src/native/brep/NurbsSurface.cpp src/native/mesh/HalfEdgeMesh.cpp \
//     test/native_vs_occt_section.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_section && /tmp/native_vs_occt_section

// --- native section -------------------------------------------------------
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Section.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pln.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <TopTools_HSequenceOfShape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <BRep_Tool.hxx>
#include <GeomLib_IsPlanarSurface.hxx>
#include <Geom_Surface.hxx>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

static constexpr double kPi = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// A common physical signature returned from BOTH sides for a section.
// ---------------------------------------------------------------------------
struct SectionSig {
    bool   ok = false;
    int    numWires = 0;
    double area = 0.0;
    double cx = 0.0, cy = 0.0, cz = 0.0;
};

// ===========================================================================
// NATIVE side: sectionSolid on a SolidFactory primitive.
// ===========================================================================
static SectionSig runNative(Solid* solid, const Vec3& point, const Vec3& normal) {
    SectionSig s;
    if (!solid) { std::printf("  [native] null solid\n"); return s; }
    SectionPlane pl;
    pl.point  = point;
    pl.normal = normal;
    SectionResult r = sectionSolid(*solid, pl);
    if (!r.ok) {
        std::printf("  [native] NOT ok: %s\n", r.reason);
        return s;
    }
    s.ok       = true;
    s.numWires = static_cast<int>(r.numWires);
    s.area     = r.area;
    s.cx = r.centroid.x; s.cy = r.centroid.y; s.cz = r.centroid.z;
    return s;
}

// ===========================================================================
// OCCT side: BRepAlgoAPI_Section(solid, gp_Pln) -> section edges; connect into
// wires (ShapeAnalysis_FreeBounds::ConnectEdgesToWires); build a planar face on
// the wires (outer + holes); BRepGProp::SurfaceProperties -> area + centroid.
// ===========================================================================
static SectionSig runOcct(const TopoDS_Shape& solid,
                          const gp_Pln& plane) {
    SectionSig s;

    // (a) section edges where the plane cuts the solid.
    BRepAlgoAPI_Section sec(solid, plane, Standard_False);
    sec.ComputePCurveOn1(Standard_True);   // pcurves on the planar section
    sec.Approximation(Standard_True);
    sec.Build();
    if (!sec.IsDone()) { std::printf("  [occt] section Build() not done\n"); return s; }
    TopoDS_Shape secShape = sec.Shape();
    if (secShape.IsNull()) { std::printf("  [occt] section shape null\n"); return s; }

    // (b) collect the section edges, then connect them into closed wires.
    Handle(TopTools_HSequenceOfShape) edges = new TopTools_HSequenceOfShape();
    for (TopExp_Explorer ex(secShape, TopAbs_EDGE); ex.More(); ex.Next())
        edges->Append(ex.Current());
    if (edges->Length() == 0) { std::printf("  [occt] no section edges\n"); return s; }

    Handle(TopTools_HSequenceOfShape) wiresSeq;
    const double connectTol = 1e-7;
    ShapeAnalysis_FreeBounds::ConnectEdgesToWires(
        edges, connectTol, /*shared*/ Standard_False, wiresSeq);
    if (wiresSeq.IsNull() || wiresSeq->Length() == 0) {
        std::printf("  [occt] ConnectEdgesToWires produced no wires\n");
        return s;
    }

    // Collect the closed wires (a planar section of a closed solid yields closed
    // loops; outer material loop + any hole loops).
    std::vector<TopoDS_Wire> wires;
    for (Standard_Integer i = 1; i <= wiresSeq->Length(); ++i) {
        TopoDS_Wire w = TopoDS::Wire(wiresSeq->Value(i));
        if (!w.IsNull()) wires.push_back(w);
    }
    s.numWires = static_cast<int>(wires.size());

    // (c) build a planar face on the wires. To recover the FILLED region (outer
    // minus holes), build a face per wire, measure each |area| on the cutting
    // plane, then the outer face is the largest; the rest are holes added back.
    // We compute the net filled area & centroid by signed combination:
    //   filled  = |outer| - Σ |hole|
    //   moment  = |outer|*c_outer - Σ |hole|*c_hole
    //   centroid = moment / filled
    struct WireProp { double area; double cx, cy, cz; };
    std::vector<WireProp> wp;
    for (const TopoDS_Wire& w : wires) {
        BRepBuilderAPI_MakeFace mf(plane, w, /*OnlyPlane*/ Standard_True);
        if (!mf.IsDone()) { std::printf("  [occt] MakeFace on a wire failed\n"); return s; }
        TopoDS_Face f = mf.Face();
        GProp_GProps props;
        BRepGProp::SurfaceProperties(f, props);
        gp_Pnt c = props.CentreOfMass();
        wp.push_back({std::fabs(props.Mass()), c.X(), c.Y(), c.Z()});
    }

    // outer = max-area wire; everything else is a hole.
    std::size_t outerIdx = 0;
    for (std::size_t i = 1; i < wp.size(); ++i)
        if (wp[i].area > wp[outerIdx].area) outerIdx = i;

    double filled = 0.0, mx = 0.0, my = 0.0, mz = 0.0;
    for (std::size_t i = 0; i < wp.size(); ++i) {
        double sgn = (i == outerIdx) ? +1.0 : -1.0;
        filled += sgn * wp[i].area;
        mx += sgn * wp[i].area * wp[i].cx;
        my += sgn * wp[i].area * wp[i].cy;
        mz += sgn * wp[i].area * wp[i].cz;
    }
    s.area = std::fabs(filled);
    if (std::fabs(filled) > 0.0) {
        s.cx = mx / filled; s.cy = my / filled; s.cz = mz / filled;
    }
    s.ok = true;
    return s;
}

// ---------------------------------------------------------------------------
// Compare + report one case.
// ---------------------------------------------------------------------------
static bool compareCase(const std::string& label,
                        const SectionSig& nat, const SectionSig& occ) {
    std::printf("\n--- CASE: %s ---\n", label.c_str());
    std::printf("  NATIVE : ok=%d  wires=%d  area=%.15f  centroid=(%.12f, %.12f, %.12f)\n",
                (int)nat.ok, nat.numWires, nat.area, nat.cx, nat.cy, nat.cz);
    std::printf("  OCCT   : ok=%d  wires=%d  area=%.15f  centroid=(%.12f, %.12f, %.12f)\n",
                (int)occ.ok, occ.numWires, occ.area, occ.cx, occ.cy, occ.cz);

    double areaAbs = std::fabs(nat.area - occ.area);
    double areaRel = (std::fabs(occ.area) > 0.0) ? areaAbs / std::fabs(occ.area) : areaAbs;
    double cAbs = std::max({std::fabs(nat.cx - occ.cx),
                            std::fabs(nat.cy - occ.cy),
                            std::fabs(nat.cz - occ.cz)});
    std::printf("  -> wires: native=%d occt=%d | area rel=%.3e | centroid maxabs=%.3e\n",
                nat.numWires, occ.numWires, areaRel, cAbs);

    bool bothOk    = nat.ok && occ.ok;
    bool wiresEq   = nat.numWires == occ.numWires;
    bool areaPass  = areaRel <= 1e-6;
    bool centPass  = cAbs <= 1e-6;

    check(bothOk,   label + ": both sides ok");
    check(wiresEq,  label + ": wire count native == OCCT (EQUAL)");
    check(areaPass, label + ": section area native == OCCT (rel <= 1e-6)");
    check(centPass, label + ": section centroid native == OCCT (abs <= 1e-6)");
    return bothOk && wiresEq && areaPass && centPass;
}

int main() {
    std::printf("=== A/B 1:1  native sectionSolid  vs  OCCT BRepAlgoAPI_Section "
                "+ ConnectEdgesToWires/MakeFace/SurfaceProperties ===\n");

    bool allPass = true;

    // -------------------------------------------------------------------------
    // (1) BOX 10x6x4, mid-height cut z=2.  -> 1 wire, area 60, centroid (5,3,2).
    //     OCCT MakeBox corner at origin spans [0,10]x[0,6]x[0,4].
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* box = fac.buildBox(10.0, 6.0, 4.0);
        SectionSig nat = runNative(box, Vec3{0, 0, 2.0}, Vec3{0, 0, 1});

        TopoDS_Shape occBox = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10.0, 6.0, 4.0).Shape();
        gp_Pln pl(gp_Pnt(0, 0, 2.0), gp_Dir(0, 0, 1));
        SectionSig occ = runOcct(occBox, pl);

        allPass &= compareCase("box 10x6x4  z=2", nat, occ);
    }

    // -------------------------------------------------------------------------
    // (2) CYLINDER R=3 H=8, AXIAL cut y=0 (contains the axis).
    //     -> 1 wire, area 2R*H = 48, centroid on axis at (0,0,4).
    //     OCCT MakeCylinder: axis +Z, base on z=0, radius 3, height 8.
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* cyl = fac.buildCylinder(3.0, 8.0);
        SectionSig nat = runNative(cyl, Vec3{0, 0, 0}, Vec3{0, 1, 0});

        TopoDS_Shape occCyl = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 3.0, 8.0).Shape();
        gp_Pln pl(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0));
        SectionSig occ = runOcct(occCyl, pl);

        allPass &= compareCase("cyl R=3 H=8  axial y=0", nat, occ);
    }

    // -------------------------------------------------------------------------
    // (3) CYLINDER R=3 H=8, TRANSVERSE cut z=4 (perp to axis).
    //     -> 1 wire, area pi*R^2 = pi*9, centroid on axis at (0,0,4).
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* cyl = fac.buildCylinder(3.0, 8.0);
        SectionSig nat = runNative(cyl, Vec3{0, 0, 4.0}, Vec3{0, 0, 1});

        TopoDS_Shape occCyl = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 3.0, 8.0).Shape();
        gp_Pln pl(gp_Pnt(0, 0, 4.0), gp_Dir(0, 0, 1));
        SectionSig occ = runOcct(occCyl, pl);

        allPass &= compareCase("cyl R=3 H=8  transverse z=4", nat, occ);
    }

    // -------------------------------------------------------------------------
    // (4) HOLLOW TUBE rO=4 rI=2 H=10, TRANSVERSE cut z=5.
    //     -> 2 wires (outer + hole), filled area pi(rO^2-rI^2) = pi*12,
    //        centroid on axis at (0,0,5).
    //     OCCT tube = outer cylinder CUT inner cylinder (same axis +Z).
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* tube = fac.buildTube(4.0, 2.0, 10.0);
        SectionSig nat = runNative(tube, Vec3{0, 0, 5.0}, Vec3{0, 0, 1});

        TopoDS_Shape outer = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 4.0, 10.0).Shape();
        TopoDS_Shape inner = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2.0, 10.0).Shape();
        BRepAlgoAPI_Cut cut(outer, inner);
        cut.Build();
        TopoDS_Shape occTube = cut.Shape();
        gp_Pln pl(gp_Pnt(0, 0, 5.0), gp_Dir(0, 0, 1));
        SectionSig occ = runOcct(occTube, pl);

        allPass &= compareCase("tube rO=4 rI=2 H=10  transverse z=5", nat, occ);
    }

    std::printf("\n=== VERDICT: %s ===\n", allPass ? "PASS" : "FAIL");
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
