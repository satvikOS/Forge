// test/native_vs_occt_offset_shape.cpp
//
// A/B differential validation: the Forge NATIVE analytic OFFSET-SHAPE op
// (forge::native::brep::offsetSolidShape — the in-house BRepOffsetAPI_MakeOffsetShape
// analog, BRepOffset_Skin + GeomAbs_Intersection sharp join) vs OCCT 7.9.3's
// real BRepOffsetAPI_MakeOffsetShape, on the same three closed-form cases the
// native gate (test/native/brep/offset_shape_test.cpp) asserts:
//
//   (1) BOX GROW.   box L=10 grown t=+1   -> box L+2t=12, V = 12^3      = 1728
//   (2) BOX SHRINK. box L=10 shrunk t=-1  -> box L-2t=8 , V = 8^3       = 512
//   (3) CYL GROW.   cyl r=3 h=8 grown t=+0.5 -> r=3.5,h+2t=9, V=pi*3.5^2*9 = 346.36...
//
// For each case we compute BOTH volumes (native + OCCT) and compare each
// against the closed-form analytic reference with a relative tolerance of 1e-6.
// We also cross-check native-vs-OCCT directly. PASS iff every native AND every
// OCCT volume is within rel<=1e-6 of its analytic reference on all 3 cases.
//
// OCCT path:
//   BRepPrimAPI_MakeBox(L,L,L) / BRepPrimAPI_MakeCylinder(r,h) -> TopoDS_Solid
//   BRepOffsetAPI_MakeOffsetShape::PerformByJoin(
//       solid, t, 1e-7, BRepOffset_Skin,
//       /*Intersection*/ Standard_False, /*SelfInter*/ Standard_False,
//       GeomAbs_Intersection)
//   -> BRepBuilderAPI_MakeSolid(shell) -> BRepGProp::VolumeProperties -> Mass().
//
// NATIVE path:
//   SolidFactory::buildBox / buildCylinder -> offsetSolidShape(..) -> .volume.
//
// SINGLE-CLANG build (no cmake, no run_native.sh — mirrors the native gate):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/OffsetShape.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Primitives.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Topology.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Surface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/MassProps.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Sew.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/SurfaceIntersect.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Curve.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Nurbs.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsSurface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_offset_shape.cpp \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKOffset -lTKBO -lTKBool -lTKShHealing -lTKFillet \
//     -o /tmp/native_vs_occt_offset_shape && /tmp/native_vs_occt_offset_shape

// ----- Forge native ------------------------------------------------------
#include "forge/native/brep/OffsetShape.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/MassProps.hpp"

// ----- OCCT 7.9.3 --------------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepOffset_Mode.hxx>
#include <GeomAbs_JoinType.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static bool relApprox(double a, double b, double rel) {
    double denom = std::max(1.0, std::fabs(b));
    return std::fabs(a - b) <= rel * denom;
}

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else        std::printf("  [FAIL] %s\n", name.c_str());
}

// ---------------------------------------------------------------------------
// NATIVE: build the primitive, offset it by t, return the offset solid volume.
// ---------------------------------------------------------------------------
static bool nativeBoxOffset(double L, double t, double& volOut) {
    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);
    OffsetShapeOptions opt; opt.distance = t; opt.tol = 1e-9;
    OffsetShapeResult r = offsetSolidShape(fac.builder(), box, opt);
    if (!r.ok) { std::printf("      native box offset FAILED: %s\n", r.reason); return false; }
    volOut = r.volume;
    return true;
}

static bool nativeCylOffset(double r, double h, double t, double& volOut) {
    SolidFactory fac;
    Solid* cyl = fac.buildCylinder(r, h);
    OffsetShapeOptions opt; opt.distance = t; opt.tol = 1e-9;
    OffsetShapeResult res = offsetSolidShape(fac.builder(), cyl, opt);
    if (!res.ok) { std::printf("      native cyl offset FAILED: %s\n", res.reason); return false; }
    volOut = res.volume;
    return true;
}

// ---------------------------------------------------------------------------
// OCCT: real BRepOffsetAPI_MakeOffsetShape (Skin, Intersection join), then make
// a solid from the resulting shell and measure its exact volume.
// ---------------------------------------------------------------------------
static bool occtOffsetVolume(const TopoDS_Shape& solid, double t, double& volOut,
                             const char* tag) {
    try {
        BRepOffsetAPI_MakeOffsetShape mk;
        mk.PerformByJoin(solid, t, 1e-7, BRepOffset_Skin,
                         Standard_False,        // Intersection
                         Standard_False,        // SelfInter
                         GeomAbs_Intersection); // sharp join
        if (!mk.IsDone()) { std::printf("      OCCT %s: MakeOffsetShape not done\n", tag); return false; }
        TopoDS_Shape off = mk.Shape();

        // The offset of a solid is delivered as a shell; wrap it into a solid so
        // VolumeProperties integrates the enclosed (offset) volume.
        TopoDS_Shape measured = off;
        if (off.ShapeType() == TopAbs_SHELL) {
            BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(off));
            if (ms.IsDone()) measured = ms.Solid();
        } else if (off.ShapeType() == TopAbs_COMPOUND) {
            // Grab the first shell out of the compound and solidify it.
            TopExp_Explorer ex(off, TopAbs_SHELL);
            if (ex.More()) {
                BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(ex.Current()));
                if (ms.IsDone()) measured = ms.Solid();
            }
        }

        GProp_GProps props;
        BRepGProp::VolumeProperties(measured, props);
        volOut = std::fabs(props.Mass());
        return true;
    } catch (const Standard_Failure& e) {
        std::printf("      OCCT %s: exception %s\n", tag, e.GetMessageString());
        return false;
    }
}

int main() {
    std::printf("=== A/B vs OCCT 7.9.3 — native OFFSET-SHAPE vs BRepOffsetAPI_MakeOffsetShape ===\n");
    const double REL = 1e-6;

    // -------- case 1: BOX GROW (L=10, t=+1 -> 12^3 = 1728) -----------------
    {
        const double L = 10.0, t = 1.0;
        const double ref = (L + 2 * t) * (L + 2 * t) * (L + 2 * t); // 1728
        std::printf("\n[1] BOX GROW  L=%.1f t=%+.1f   analytic ref = %.12f\n", L, t, ref);

        double vn = 0, vo = 0;
        bool okn = nativeBoxOffset(L, t, vn);
        BRepPrimAPI_MakeBox mb(L, L, L);
        bool oko = occtOffsetVolume(mb.Solid(), t, vo, "box-grow");

        std::printf("      NATIVE V = %.12f\n", vn);
        std::printf("      OCCT   V = %.12f\n", vo);
        std::printf("      rel(native,ref)=%.3e  rel(occt,ref)=%.3e  rel(native,occt)=%.3e\n",
                    std::fabs(vn - ref) / ref, std::fabs(vo - ref) / ref,
                    std::fabs(vn - vo) / ref);
        check(okn && relApprox(vn, ref, REL), "native box-grow == 1728 (rel<=1e-6)");
        check(oko && relApprox(vo, ref, REL), "OCCT   box-grow == 1728 (rel<=1e-6)");
    }

    // -------- case 2: BOX SHRINK (L=10, t=-1 -> 8^3 = 512) -----------------
    {
        const double L = 10.0, t = -1.0;
        const double ref = (L + 2 * t) * (L + 2 * t) * (L + 2 * t); // 512
        std::printf("\n[2] BOX SHRINK  L=%.1f t=%+.1f   analytic ref = %.12f\n", L, t, ref);

        double vn = 0, vo = 0;
        bool okn = nativeBoxOffset(L, t, vn);
        BRepPrimAPI_MakeBox mb(L, L, L);
        bool oko = occtOffsetVolume(mb.Solid(), t, vo, "box-shrink");

        std::printf("      NATIVE V = %.12f\n", vn);
        std::printf("      OCCT   V = %.12f\n", vo);
        std::printf("      rel(native,ref)=%.3e  rel(occt,ref)=%.3e  rel(native,occt)=%.3e\n",
                    std::fabs(vn - ref) / ref, std::fabs(vo - ref) / ref,
                    std::fabs(vn - vo) / ref);
        check(okn && relApprox(vn, ref, REL), "native box-shrink == 512 (rel<=1e-6)");
        check(oko && relApprox(vo, ref, REL), "OCCT   box-shrink == 512 (rel<=1e-6)");
    }

    // -------- case 3: CYL GROW (r=3 h=8 t=+0.5 -> pi*3.5^2*9 = 346.36..) ---
    {
        const double r = 3.0, h = 8.0, t = 0.5;
        const double rO = r + t, hO = h + 2 * t;
        const double ref = M_PI * rO * rO * hO; // 346.3605900582...
        std::printf("\n[3] CYL GROW  r=%.1f h=%.1f t=%+.1f   analytic ref = %.12f\n", r, h, t, ref);

        double vn = 0, vo = 0;
        bool okn = nativeCylOffset(r, h, t, vn);
        BRepPrimAPI_MakeCylinder mc(r, h);
        bool oko = occtOffsetVolume(mc.Solid(), t, vo, "cyl-grow");

        std::printf("      NATIVE V = %.12f\n", vn);
        std::printf("      OCCT   V = %.12f\n", vo);
        std::printf("      rel(native,ref)=%.3e  rel(occt,ref)=%.3e  rel(native,occt)=%.3e\n",
                    std::fabs(vn - ref) / ref, std::fabs(vo - ref) / ref,
                    std::fabs(vn - vo) / ref);
        // OCCT measures the exact analytic cylinder (rel<=1e-6). The native solid
        // is a faceted (sectored) cap rim, so its chord-polygon volume carries a
        // small faceting deficit; we hold OCCT to 1e-6 vs the analytic ref and
        // report the native value alongside (the native gate itself uses 1e-3 rel).
        check(oko && relApprox(vo, ref, REL), "OCCT   cyl-grow == pi*3.5^2*9 (rel<=1e-6)");
        check(okn && relApprox(vn, ref, 1e-3), "native cyl-grow == pi*3.5^2*9 (rel<=1e-3, faceted)");
        check(okn && relApprox(vn, ref, REL),  "native cyl-grow == pi*3.5^2*9 (rel<=1e-6, exact)");
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
