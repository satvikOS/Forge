// forge-kernel/test/ab_native_sweep_occt.cpp
//
// LIVE-OCCT A/B for the analytic swept solids: builds the SAME profile+params
// BOTH ways in one process —
//   * native  : SolidFactory::buildPrismFromProfile / buildRevolveProfile
//               (in-house analytic brep::Solid, volume via native massProperties),
//   * OCCT     : BRepPrimAPI_MakePrism / BRepPrimAPI_MakeRevol on the same face,
//               volume via BRepGProp::VolumeProperties —
// and asserts native volume == OCCT volume to 1e-9 (relative). For the all-planar
// PRISMs it also asserts the native analytic FACE COUNT == the OCCT face count
// (n profile edges -> n side faces + 2 caps). Revolves are faceted over exact
// analytic geometry, so only the (exact) volume is A/B'd there.
//
// This is the ground-truth confirmation behind the OCCT-free run_native.sh gate
// test/native/brep/native_sweep_analytic_test.cpp (which A/Bs against the closed
// form). It is NOT under test/native/<class>/, so run_native.sh (OCCT-free) never
// compiles it; build+run it with test/run_ab_native_sweep.sh.
//
// Exit 0 iff every A/B assertion holds.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool relClose(double a, double b, double tol) {
    double s = std::max(1.0, std::max(std::fabs(a), std::fabs(b)));
    return std::fabs(a - b) <= tol * s;
}

// OCCT: planar face from an ordered ring of 3D points (auto-closed).
static TopoDS_Face occtFace(const std::vector<gp_Pnt>& pts) {
    BRepBuilderAPI_MakePolygon poly;
    for (const auto& p : pts) poly.Add(p);
    poly.Close();
    return BRepBuilderAPI_MakeFace(poly.Wire()).Face();
}
static double occtVolume(const TopoDS_Shape& s) {
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return std::fabs(g.Mass());
}
static int occtFaceCount(const TopoDS_Shape& s) {
    int n = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) ++n;
    return n;
}

int main() {
    std::printf("== LIVE-OCCT A/B: native analytic sweep vs BRepPrimAPI MakePrism/MakeRevol ==\n");
    const double PI = 3.14159265358979323846;

    // ------------------------------------------------ PRISM: rectangle -> box
    {
        std::vector<std::array<double, 2>> rect = {{0, 0}, {2, 0}, {2, 3}, {0, 3}};
        const double vz = 5.0;
        SolidFactory fac;
        Solid* s = fac.buildPrismFromProfile(rect, 0, 0, vz);
        double natV = massProperties(*s).volume;
        int natF = static_cast<int>(fac.builder().faceCount());

        std::vector<gp_Pnt> pts;
        for (auto& p : rect) pts.emplace_back(p[0], p[1], 0.0);
        TopoDS_Shape occt = BRepPrimAPI_MakePrism(occtFace(pts), gp_Vec(0, 0, vz)).Shape();
        double occV = occtVolume(occt);
        int occF = occtFaceCount(occt);
        std::printf("      [prism/rect] native V=%.10f F=%d | OCCT V=%.10f F=%d\n", natV, natF, occV, occF);
        check(relClose(natV, occV, 1e-9), "prism/rect: native volume == OCCT MakePrism volume");
        check(natF == occF, "prism/rect: native face count == OCCT face count");
    }

    // ------------------------------------------ PRISM: non-convex L -> prism
    {
        std::vector<std::array<double, 2>> Lp = {{0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}};
        const double vz = 3.0;
        SolidFactory fac;
        Solid* s = fac.buildPrismFromProfile(Lp, 0, 0, vz);
        double natV = massProperties(*s).volume;
        int natF = static_cast<int>(fac.builder().faceCount());

        std::vector<gp_Pnt> pts;
        for (auto& p : Lp) pts.emplace_back(p[0], p[1], 0.0);
        TopoDS_Shape occt = BRepPrimAPI_MakePrism(occtFace(pts), gp_Vec(0, 0, vz)).Shape();
        double occV = occtVolume(occt);
        int occF = occtFaceCount(occt);
        std::printf("      [prism/L] native V=%.10f F=%d | OCCT V=%.10f F=%d\n", natV, natF, occV, occF);
        check(relClose(natV, occV, 1e-9), "prism/L: native volume == OCCT MakePrism volume (non-convex)");
        check(natF == occF, "prism/L: native face count == OCCT face count");
    }

    // ------------------------------------------ PRISM: OBLIQUE extrude vector
    {
        std::vector<std::array<double, 2>> rect = {{0, 0}, {2, 0}, {2, 3}, {0, 3}};
        const double vx = 1.0, vy = 0.5, vz = 4.0;
        SolidFactory fac;
        Solid* s = fac.buildPrismFromProfile(rect, vx, vy, vz);
        double natV = massProperties(*s).volume;
        int natF = static_cast<int>(fac.builder().faceCount());

        std::vector<gp_Pnt> pts;
        for (auto& p : rect) pts.emplace_back(p[0], p[1], 0.0);
        TopoDS_Shape occt = BRepPrimAPI_MakePrism(occtFace(pts), gp_Vec(vx, vy, vz)).Shape();
        double occV = occtVolume(occt);
        int occF = occtFaceCount(occt);
        std::printf("      [prism/oblique] native V=%.10f F=%d | OCCT V=%.10f F=%d\n", natV, natF, occV, occF);
        check(relClose(natV, occV, 1e-9), "prism/oblique: native volume == OCCT MakePrism volume");
        check(natF == occF, "prism/oblique: native face count == OCCT face count");
    }

    // OCCT MakeRevol about +Z. Profile (r,z) -> XZ-plane points (r,0,z).
    auto abRevol = [&](const char* tag, std::vector<std::array<double, 2>> rz,
                       double angle, double expClosedForm) {
        SolidFactory fac;
        Solid* s = fac.buildRevolveProfile(rz, angle);
        double natV = massProperties(*s).volume;
        int natF = static_cast<int>(fac.builder().faceCount());

        std::vector<gp_Pnt> pts;
        for (auto& p : rz) pts.emplace_back(p[0], 0.0, p[1]);
        gp_Ax1 axis(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        TopoDS_Shape occt = BRepPrimAPI_MakeRevol(occtFace(pts), axis, angle).Shape();
        double occV = occtVolume(occt);
        int occF = occtFaceCount(occt);
        std::printf("      [%s] native V=%.10f F=%d | OCCT V=%.10f F=%d | closed-form=%.10f\n",
                    tag, natV, natF, occV, occF, expClosedForm);
        check(relClose(natV, occV, 1e-9),
              std::string(tag) + ": native volume == OCCT MakeRevol volume");
        check(relClose(occV, expClosedForm, 1e-9),
              std::string(tag) + ": OCCT MakeRevol volume == closed form");
    };

    // ------------------------------------------- REVOLVE cases (full + partial)
    abRevol("revolve/cyl",     {{0, 0}, {2, 0}, {2, 5}, {0, 5}}, 2.0 * PI, PI * 4.0 * 5.0);
    abRevol("revolve/frustum", {{0, 0}, {3, 0}, {1, 4}, {0, 4}}, 2.0 * PI,
            PI * 4.0 / 3.0 * (9.0 + 3.0 + 1.0));
    abRevol("revolve/tube",    {{1, 0}, {3, 0}, {3, 4}, {1, 4}}, 2.0 * PI, PI * (9.0 - 1.0) * 4.0);
    abRevol("revolve/partial", {{0, 0}, {2, 0}, {2, 5}, {0, 5}}, PI / 2.0, (PI / 2.0) * 4.0 * 5.0 / 2.0);

    std::printf("== LIVE-OCCT sweep A/B: %d/%d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
