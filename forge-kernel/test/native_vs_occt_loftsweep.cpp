// forge-kernel/test/native_vs_occt_loftsweep.cpp
//
// 1:1 A/B harness: Forge native ANALYTIC LOFT + SWEEP (brep::loftSolid /
// brep::sweepSolid) vs OCCT (BRepOffsetAPI_ThruSections / BRepPrimAPI_MakePrism),
// comparing measured VOLUME (GProp_GProps) and CLOSEDNESS on the identical inputs.
//
// Standalone C++20. Links OCCT 7.9.3 from Homebrew AND compiles the native brep
// object set directly (no binding/CMake/native-gate touched).
//
// CASES (mirror loftsweep_test.cpp):
//   (1) LOFT  square(side 4, z=0) -> square(side 2, z=6)   expect vol 56
//   (2) SWEEP square(side 3) along straight path length 10 expect vol 90 EXACTLY
//
// PASS iff, for BOTH cases, |Vnative - Vocct| / |Vocct| <= 1e-6 AND both bodies
// report a closed solid.
//
// Build + run:
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_loftsweep.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/LoftSweep.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Primitives.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Topology.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Surface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/MassProps.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Nurbs.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsSurface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_loftsweep && /tmp/native_vs_occt_loftsweep

// --- Forge native ----------------------------------------------------------
#include "forge/native/brep/LoftSweep.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("    [PASS] %s\n", name.c_str()); }
    else        std::printf("    [FAIL] %s\n", name.c_str());
}

// A square of side `s` centred on the Z axis, in the plane z=`z`, CCW about +Z.
static std::vector<Point3> squareAt(double s, double z) {
    const double h = 0.5 * s;
    return { {-h, -h, z}, {h, -h, z}, {h, h, z}, {-h, h, z} };
}

// Build a CLOSED OCCT polygon wire from an ordered ring of points.
static TopoDS_Wire occtWire(const std::vector<Point3>& ring) {
    BRepBuilderAPI_MakePolygon poly;
    for (const Point3& p : ring) poly.Add(gp_Pnt(p.x, p.y, p.z));
    poly.Close();
    return poly.Wire();
}

static double occtVolume(const TopoDS_Shape& s) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(s, props);
    return props.Mass();  // for VolumeProperties, Mass() == enclosed volume
}

// A shape is "closed solid"-like if it is valid and contains at least one solid
// (ThruSections solid / MakePrism of a face both yield a SOLID with a closed shell).
static bool occtClosed(const TopoDS_Shape& s) {
    BRepCheck_Analyzer an(s);
    if (!an.IsValid()) return false;
    TopExp_Explorer ex(s, TopAbs_SOLID);
    return ex.More();
}

// ===========================================================================
// (1) LOFT square(4) -> square(2) over height 6 -> frustum, expect vol 56.
// ===========================================================================
static void caseLoft() {
    std::printf("[1] LOFT square(side 4, z=0) -> square(side 2, z=6)  (expect 56)\n");
    const double EXPECT = 56.0;

    // --- native ---
    LoftSection s0; s0.points = squareAt(4.0, 0.0);
    LoftSection s1; s1.points = squareAt(2.0, 6.0);
    LoftSweepResult r = loftSolid({s0, s1});
    const double vNative = r.volume;
    const bool   cNative = r.ok && r.closedManifold;

    // --- OCCT: BRepOffsetAPI_ThruSections(solid=true, ruled=true) ---
    BRepOffsetAPI_ThruSections thru(Standard_True /*solid*/, Standard_True /*ruled*/);
    thru.AddWire(occtWire(squareAt(4.0, 0.0)));
    thru.AddWire(occtWire(squareAt(2.0, 6.0)));
    thru.Build();
    const TopoDS_Shape occtShape = thru.Shape();
    const double vOcct = occtVolume(occtShape);
    const bool   cOcct = thru.IsDone() && occtClosed(occtShape);

    const double rel = std::fabs(vNative - vOcct) / (std::fabs(vOcct) + 1e-300);
    std::printf("    native V = %.12f  (ok=%d closed=%d)\n", vNative, (int)r.ok, (int)cNative);
    std::printf("    OCCT   V = %.12f  (done=%d closed=%d)\n", vOcct, (int)thru.IsDone(), (int)cOcct);
    std::printf("    expect V = %.12f   |rel native-vs-OCCT| = %.3e\n", EXPECT, rel);

    check(cNative, "native loft is a closed solid");
    check(cOcct,   "OCCT loft is a closed solid");
    check(rel <= 1e-6, "loft volume native-vs-OCCT  rel <= 1e-6");
    check(std::fabs(vOcct - EXPECT) <= 1e-6 * EXPECT, "OCCT loft volume == 56 (sanity)");
}

// ===========================================================================
// (2) SWEEP square(3) along straight path length 10 -> box, expect vol 90.
// ===========================================================================
static void caseSweep() {
    std::printf("[2] SWEEP square(side 3, z=0) along straight len 10  (expect 90)\n");
    const double EXPECT = 90.0;

    // --- native ---
    std::vector<Point3> profile = squareAt(3.0, 0.0);
    std::vector<Point3> path = { {0, 0, 0}, {0, 0, 10} };
    LoftSweepResult r = sweepSolid(profile, path);
    const double vNative = r.volume;
    const bool   cNative = r.ok && r.closedManifold;

    // --- OCCT: BRepPrimAPI_MakePrism(profileFace, gp_Vec(0,0,10)) ---
    TopoDS_Wire wire = occtWire(squareAt(3.0, 0.0));
    TopoDS_Face profileFace = BRepBuilderAPI_MakeFace(wire, Standard_True);
    BRepPrimAPI_MakePrism prism(profileFace, gp_Vec(0.0, 0.0, 10.0));
    prism.Build();
    const TopoDS_Shape occtShape = prism.Shape();
    const double vOcct = occtVolume(occtShape);
    const bool   cOcct = prism.IsDone() && occtClosed(occtShape);

    const double rel = std::fabs(vNative - vOcct) / (std::fabs(vOcct) + 1e-300);
    std::printf("    native V = %.12f  (ok=%d closed=%d)\n", vNative, (int)r.ok, (int)cNative);
    std::printf("    OCCT   V = %.12f  (done=%d closed=%d)\n", vOcct, (int)prism.IsDone(), (int)cOcct);
    std::printf("    expect V = %.12f   |rel native-vs-OCCT| = %.3e\n", EXPECT, rel);

    check(cNative, "native sweep is a closed solid");
    check(cOcct,   "OCCT sweep is a closed solid");
    check(rel <= 1e-6, "sweep volume native-vs-OCCT  rel <= 1e-6");
    check(std::fabs(vOcct - EXPECT) <= 1e-6 * EXPECT, "OCCT sweep volume == 90 (sanity)");
}

int main() {
    std::printf("=== A/B 1:1  forge::native::brep LOFT+SWEEP  vs  OCCT 7.9.3 ===\n");
    caseLoft();
    caseSweep();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
