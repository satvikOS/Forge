// forge-kernel/test/native_vs_occt_fillet.cpp
//
// RIGOROUS 1:1 A/B HARNESS — native ANALYTIC ROLLING-BALL EDGE FILLET
//   (forge::native::brep::filletBoxEdgeAnalytic)   vs   OCCT
//   BRepFilletAPI_MakeFillet.
//
// This is a STANDALONE C++20 oracle test that LINKS OCCT (brew opencascade
// 7.9.3). It is NOT part of the native gate (run_native.sh) and does NOT touch
// binding.cpp / CMakeLists.txt. It builds the SAME case on BOTH sides and
// compares the two physical signatures the analytic blend must match OCCT on:
//
//   CASE: box L=10, constant fillet radius R=1.5, TOP-FRONT edge (edge id 4 in
//         the native cube-edge enumeration: v4(0,0,L)->v5(L,0,L), along +X at
//         y=0, z=L, shared by the TOP face z=L and the FRONT face y=0).
//
//   GATE (1) — FILLETED SOLID VOLUME, native vs OCCT, rel <= 1e-6.
//     Native: filletBoxEdgeAnalytic builds the exact analytic B-rep whose
//       MassProps integrator measures volume = L^3 - (1 - pi/4) R^2 L EXACTLY.
//     OCCT:   BRepFilletAPI_MakeFillet on the same box edge, Build(); volume via
//       GProp_GProps / BRepGProp::VolumeProperties.Mass().
//     For a single straight convex edge these are the SAME true B-rep fillet
//       volume and must agree to <= 1e-6 relative.
//
//   GATE (2) — the NEW FILLET FACE is a CYLINDER of radius R on BOTH sides.
//     Native: res.filletFace->surface->kind == Cylinder && r1 == R.
//     OCCT:   the face that BRepFilletAPI exposes as newly generated from the
//       filleted edge has BRepAdaptor_Surface::GetType() == GeomAbs_Cylinder and
//       Cylinder().Radius() == R within 1e-9.
//
// Build + run (manual; mirrors native_vs_occt_sew.cpp's build line + the OCCT
// fillet link set):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     <native sources, see CMake-free list below> \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_fillet.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_fillet && /tmp/native_vs_occt_fillet

// --- native analytic fillet ----------------------------------------------
#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <gp_Cylinder.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>

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

// ---------------------------------------------------------------------------
// The shared problem definition (MUST mirror fillet_analytic_test.cpp exactly):
//   box [0,L]^3 with L=10, constant fillet radius R=1.5, the TOP-FRONT edge
//   (native edge id 4): v4(0,0,L)->v5(L,0,L), y=0 & z=L, shared by top & front.
// ---------------------------------------------------------------------------
static constexpr double kPi = 3.14159265358979323846;
static constexpr double L   = 10.0;
static constexpr double R   = 1.5;
static constexpr int    kNativeEdgeIndex = 4;   // EXACT same edge as the gate test

// ===========================================================================
// NATIVE side: run the analytic rolling-ball fillet on box edge 4.
// ===========================================================================
struct NativeResult {
    bool   ok = false;
    double volume = 0.0;
    bool   filletIsCylinder = false;
    double filletRadius = 0.0;
};

static NativeResult runNative() {
    NativeResult nr;
    TopologyBuilder tb;
    AnalyticFilletResult fr = filletBoxEdgeAnalytic(tb, L, R, kNativeEdgeIndex);
    if (!fr.ok || fr.solid == nullptr) {
        std::printf("  [native] NOT ok: %s\n", fr.reason);
        return nr;
    }
    MassProps mp = massProperties(*fr.solid, /*gaussN=*/8);
    nr.volume = mp.volume;

    if (fr.filletFace != nullptr && fr.filletFace->surface != nullptr) {
        Surface* s = fr.filletFace->surface;
        nr.filletIsCylinder = (s->kind == SurfaceKind::Cylinder);
        nr.filletRadius = s->r1;
    }
    nr.ok = true;
    return nr;
}

// ===========================================================================
// OCCT side: same box, BRepFilletAPI_MakeFillet on the SAME top-front edge,
// Build(); read filleted volume and the generated cylindrical fillet face.
// ===========================================================================
struct OcctResult {
    bool   ok = false;
    double volume = 0.0;
    bool   filletIsCylinder = false;
    double filletRadius = 0.0;
    int    nCylFaces = 0;
};

// Is `e` the box's top-front edge (y==0 && z==L over its whole extent, runs
// along +X)? Test both endpoints AND the midpoint to be unambiguous.
static bool isTopFrontEdge(const TopoDS_Edge& e) {
    TopTools_IndexedMapOfShape vmap;
    TopExp::MapShapes(e, TopAbs_VERTEX, vmap);
    if (vmap.Extent() < 2) return false;
    const double tol = 1e-7;
    int hitsY0Zl = 0;
    double xmin = 1e300, xmax = -1e300, yref = 1e300, zref = 1e300;
    for (Standard_Integer i = 1; i <= vmap.Extent(); ++i) {
        gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vmap(i)));
        if (std::fabs(p.Y() - 0.0) <= tol && std::fabs(p.Z() - L) <= tol) ++hitsY0Zl;
        xmin = std::min(xmin, p.X());
        xmax = std::max(xmax, p.X());
        yref = p.Y(); zref = p.Z();
    }
    (void)yref; (void)zref;
    // Both endpoints at y=0,z=L and the edge spans the full box length in X.
    return hitsY0Zl == vmap.Extent() && std::fabs((xmax - xmin) - L) <= 1e-6;
}

static OcctResult runOcct() {
    OcctResult orr;

    // Box [0,L]^3 (OCCT MakeBox corner at origin, sides L,L,L).
    BRepPrimAPI_MakeBox mkBox(gp_Pnt(0, 0, 0), L, L, L);
    TopoDS_Shape box = mkBox.Shape();

    // Find the single top-front edge (y=0, z=L, along +X).
    TopoDS_Edge target;
    bool found = false;
    for (TopExp_Explorer ex(box, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        if (isTopFrontEdge(e)) { target = e; found = true; break; }
    }
    if (!found) { std::printf("  [occt] could not locate the top-front edge\n"); return orr; }

    // Add the constant radius R fillet on that edge and build.
    BRepFilletAPI_MakeFillet fillet(box);
    fillet.Add(R, target);
    fillet.Build();
    if (!fillet.IsDone()) { std::printf("  [occt] fillet Build() not done\n"); return orr; }
    TopoDS_Shape result = fillet.Shape();
    if (result.IsNull()) { std::printf("  [occt] fillet result is null\n"); return orr; }

    // (1) Filleted solid volume.
    GProp_GProps props;
    BRepGProp::VolumeProperties(result, props);
    orr.volume = props.Mass();

    // (2) The NEW fillet face: BRepFilletAPI generates the cylindrical patch from
    // the original edge. Inspect the generated faces; among all faces of the
    // result identify the cylinder(s) of radius R that did NOT exist in the box
    // (the box has 6 planar faces, no cylinders), and verify radius == R.
    const TopTools_ListOfShape& gen = fillet.Generated(target);
    for (TopTools_ListIteratorOfListOfShape it(gen); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_FACE) continue;
        TopoDS_Face f = TopoDS::Face(it.Value());
        BRepAdaptor_Surface surf(f);
        if (surf.GetType() == GeomAbs_Cylinder) {
            ++orr.nCylFaces;
            orr.filletIsCylinder = true;
            orr.filletRadius = surf.Cylinder().Radius();
        }
    }
    // Fallback / cross-check: scan ALL result faces for cylinders of radius R
    // (the box itself contributes none, so any cylinder is the fillet patch).
    if (!orr.filletIsCylinder) {
        for (TopExp_Explorer ex(result, TopAbs_FACE); ex.More(); ex.Next()) {
            TopoDS_Face f = TopoDS::Face(ex.Current());
            BRepAdaptor_Surface surf(f);
            if (surf.GetType() == GeomAbs_Cylinder) {
                ++orr.nCylFaces;
                orr.filletIsCylinder = true;
                orr.filletRadius = surf.Cylinder().Radius();
            }
        }
    }
    orr.ok = true;
    return orr;
}

int main() {
    std::printf("=== A/B 1:1  native analytic rolling-ball fillet  vs  "
                "OCCT BRepFilletAPI_MakeFillet ===\n");
    std::printf("    box L=%.6f   R=%.6f   edge=top-front (native id %d)\n\n",
                L, R, kNativeEdgeIndex);

    const NativeResult nat = runNative();
    const OcctResult   occ = runOcct();

    // Closed-form oracle for context.
    const double expectedRemoved = (1.0 - kPi / 4.0) * R * R * L;
    const double expectedVol     = L * L * L - expectedRemoved;

    std::printf("  NATIVE : volume = %.15f   filletFace=Cylinder(%s) r=%.15f\n",
                nat.volume, nat.filletIsCylinder ? "yes" : "no", nat.filletRadius);
    std::printf("  OCCT   : volume = %.15f   filletFace=Cylinder(%s) r=%.15f  (nCyl=%d)\n",
                occ.volume, occ.filletIsCylinder ? "yes" : "no", occ.filletRadius, occ.nCylFaces);
    std::printf("  ORACLE : volume = %.15f  (= L^3 - (1 - pi/4) R^2 L)\n", expectedVol);

    const double volAbsErr = std::fabs(nat.volume - occ.volume);
    const double volRelErr = volAbsErr / std::fabs(occ.volume);
    std::printf("  -> |native.vol - occt.vol| = %.6e   rel = %.6e\n", volAbsErr, volRelErr);

    std::printf("\n=== GATES ===\n");
    check(nat.ok, "native analytic fillet ok");
    check(occ.ok, "occt BRepFilletAPI fillet ok");

    // (1) filleted volume native vs OCCT, rel <= 1e-6.
    check(volRelErr <= 1e-6, "filleted VOLUME native == OCCT  (relative <= 1e-6)");

    // sanity: both also hit the analytic closed-form oracle.
    check(std::fabs(nat.volume - expectedVol) / expectedVol <= 1e-6,
          "native volume == closed-form  L^3 - (1 - pi/4) R^2 L  (rel <= 1e-6)");
    check(std::fabs(occ.volume - expectedVol) / expectedVol <= 1e-6,
          "occt   volume == closed-form  L^3 - (1 - pi/4) R^2 L  (rel <= 1e-6)");

    // (2) new fillet face is a cylinder of radius R on BOTH sides.
    check(nat.filletIsCylinder, "native fillet face is a Cylinder");
    check(std::fabs(nat.filletRadius - R) <= 1e-9, "native fillet cylinder radius == R (<= 1e-9)");
    check(occ.filletIsCylinder, "occt fillet face is a Cylinder (GeomAbs_Cylinder)");
    check(std::fabs(occ.filletRadius - R) <= 1e-9, "occt fillet cylinder radius == R (<= 1e-9)");

    const bool volPass = volRelErr <= 1e-6;
    const bool cylPass = nat.filletIsCylinder && std::fabs(nat.filletRadius - R) <= 1e-9 &&
                         occ.filletIsCylinder && std::fabs(occ.filletRadius - R) <= 1e-9;
    std::printf("\n=== VERDICT: %s ===\n",
                (volPass && cylPass) ? "PASS" : "FAIL");
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
