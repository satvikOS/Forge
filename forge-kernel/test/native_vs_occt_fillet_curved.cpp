// forge-kernel/test/native_vs_occt_fillet_curved.cpp
//
// 1:1 A/B parity harness — the CURVED-FACE (planar + cylinder) TORUS edge fillet,
// forge::native vs OpenCASCADE (OCCT 7.9.3). Mirrors the native gate
// test/native/brep/fillet_curved_test.cpp: cylinder Rc=5, H=8, fillet R=1 on the
// TOP rim circular edge where the cylindrical wall meets the planar top cap. The
// rolling-ball blend on a cylinder+plane convex circular edge is a TORUS of tube
// (minor) radius R=1 and ring (major) radius Rc-R=4.
//
// NATIVE (forge analytic B-rep):
//   filletCylinderTopEdgeAnalytic(Rc,H,R)  ->  filleted volume + SurfaceKind::Torus
//   blend face with r2==R (minor), r1==Rc-R (major). Reference value baked into the
//   native gate: 621.877800740224.
//
// OCCT:
//   BRepPrimAPI_MakeCylinder(Rc,H)            (cylinder axis +Z, base at z=0)
//   find the TOP rim circular edge (the one circular edge shared by the cylindrical
//      side face and the planar top cap face — at z=H, radius Rc)
//   BRepFilletAPI_MakeFillet(solid); .Add(R, topEdge); .Build()
//   GProp volume (BRepGProp::VolumeProperties) of the filleted solid
//   the NEW face must be a TORUS (BRepAdaptor_Surface::GetType()==GeomAbs_Torus)
//      with MinorRadius()==R==1 and MajorRadius()==Rc-R==4.
//
// VERDICT: PASS iff
//   (A) | V_occt - V_native | / V_native  <= 1e-6                              AND
//   (B) the native blend face is a torus with r2==R, r1==Rc-R                  AND
//   (C) the OCCT new fillet face is a torus with MinorRadius==R, MajorRadius==Rc-R.
//
// Build (single clang++; OCCT via homebrew; forge native srcs compiled in):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     <forge native srcs> native_vs_occt_fillet_curved.cpp \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_fillet_curved && /tmp/native_vs_occt_fillet_curved

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// ---- forge native analytic B-rep ------------------------------------------
#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

// ---- OpenCASCADE ----------------------------------------------------------
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopAbs.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Circle.hxx>
#include <gp_Torus.hxx>
#include <Bnd_Box.hxx>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

int main() {
    std::printf("=== A/B parity: CURVED-FACE TORUS edge fillet — forge::native vs OCCT 7.9.3 ===\n");
    constexpr double kPi = 3.14159265358979323846;

    const double Rc = 5.0;   // cylinder radius
    const double H  = 8.0;   // cylinder height
    const double R  = 1.0;   // fillet radius
    const int    N  = 64;    // native angular segments

    const double majorExpected = Rc - R;   // 4 (torus ring / major radius)
    const double minorExpected = R;         // 1 (torus tube / minor radius)

    // =======================================================================
    // (1) NATIVE forge analytic fillet
    // =======================================================================
    TopologyBuilder tb;
    AnalyticTorusFilletResult fr = filletCylinderTopEdgeAnalytic(tb, Rc, H, R, N);
    std::printf("\n[native] %s\n", fr.reason);
    check(fr.ok, "native cylinder-top torus fillet op ok");

    double nativeVol = 0.0, nativeMinor = 0.0, nativeMajor = 0.0;
    bool nativeIsTorus = false;
    if (fr.ok) {
        MassProps mp = massProperties(*fr.solid, /*gaussN=*/8);
        nativeVol = mp.volume;
        Surface* s = fr.filletFace ? fr.filletFace->surface : nullptr;
        nativeIsTorus = (s != nullptr) && (s->kind == SurfaceKind::Torus);
        if (s) { nativeMinor = s->r2; nativeMajor = s->r1; }
        std::printf("      native filleted volume          = %.15f\n", nativeVol);
        std::printf("      native blend surface kind        = %s\n",
                    nativeIsTorus ? "Torus" : "NON-TORUS");
        std::printf("      native torus minor(r2)/major(r1) = %.15f / %.15f\n",
                    nativeMinor, nativeMajor);
        std::printf("      native reported tube/ring radius = %.15f / %.15f\n",
                    fr.tubeRadius, fr.ringRadius);
    }

    check(nativeIsTorus, "native blend surface kind == Torus");
    check(std::fabs(nativeMinor - minorExpected) <= 1e-12,
          "native torus minor radius r2 == R (1)");
    check(std::fabs(nativeMajor - majorExpected) <= 1e-12,
          "native torus major radius r1 == Rc-R (4)");

    // =======================================================================
    // (2) OCCT fillet
    // =======================================================================
    bool occtOk = false, occtIsTorus = false;
    double occtVol = 0.0, occtMinor = 0.0, occtMajor = 0.0;
    int occtTorusFaceCount = 0;

    try {
        // Base cylinder: axis +Z, base disk at z=0, top disk at z=H, radius Rc.
        BRepPrimAPI_MakeCylinder mkCyl(Rc, H);
        mkCyl.Build();
        TopoDS_Shape cyl = mkCyl.Shape();

        // ---- find the TOP rim circular edge --------------------------------
        // It is the one circular edge whose supporting circle has radius Rc and
        // sits at z = H, and which is shared by exactly the cylindrical side face
        // and the planar top cap face (2 faces). We verify both invariants.
        TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
        TopExp::MapShapesAndAncestors(cyl, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

        TopoDS_Edge topEdge;
        bool foundTop = false;
        for (TopExp_Explorer ex(cyl, TopAbs_EDGE); ex.More(); ex.Next()) {
            const TopoDS_Edge& e = TopoDS::Edge(ex.Current());
            Standard_Real f0, l0;
            Handle(Geom_Curve) c = BRep_Tool::Curve(e, f0, l0);
            if (c.IsNull()) continue;
            Handle(Geom_Circle) circ = Handle(Geom_Circle)::DownCast(c);
            if (circ.IsNull()) continue;
            const gp_Pnt loc = circ->Location();
            const double rad = circ->Radius();
            // top rim: circle of radius Rc centred on the axis at z = H.
            if (std::fabs(rad - Rc) > 1e-9) continue;
            if (std::fabs(loc.Z() - H) > 1e-9) continue;
            // shared by exactly two faces (cylindrical side + planar top)
            int nFaces = 0;
            if (edgeFaceMap.Contains(e))
                nFaces = edgeFaceMap.FindFromKey(e).Extent();
            std::printf("\n[occt] candidate top rim edge: radius=%.6f z=%.6f sharedFaces=%d\n",
                        rad, loc.Z(), nFaces);
            if (nFaces == 2) { topEdge = e; foundTop = true; break; }
        }

        if (!foundTop) {
            std::printf("[occt] ERROR: could not locate the top rim circular edge\n");
        } else {
            BRepFilletAPI_MakeFillet mkFil(cyl);
            mkFil.Add(R, topEdge);
            mkFil.Build();
            if (!mkFil.IsDone()) {
                std::printf("[occt] ERROR: BRepFilletAPI_MakeFillet did not complete\n");
            } else {
                TopoDS_Shape filleted = mkFil.Shape();

                // volume
                GProp_GProps vprops;
                BRepGProp::VolumeProperties(filleted, vprops);
                occtVol = vprops.Mass();

                // the NEW fillet face is a torus; scan all faces for torus surfaces.
                for (TopExp_Explorer fx(filleted, TopAbs_FACE); fx.More(); fx.Next()) {
                    const TopoDS_Face& face = TopoDS::Face(fx.Current());
                    BRepAdaptor_Surface ad(face, Standard_True);
                    if (ad.GetType() == GeomAbs_Torus) {
                        ++occtTorusFaceCount;
                        gp_Torus tor = ad.Torus();
                        occtMinor = tor.MinorRadius();
                        occtMajor = tor.MajorRadius();
                        std::printf("[occt] torus face #%d: MinorRadius=%.15f  MajorRadius=%.15f\n",
                                    occtTorusFaceCount, occtMinor, occtMajor);
                    }
                }
                occtIsTorus = (occtTorusFaceCount >= 1);
                occtOk = true;
                std::printf("[occt] filleted volume            = %.15f\n", occtVol);
            }
        }
    } catch (const std::exception& ex) {
        std::printf("[occt] EXCEPTION: %s\n", ex.what());
    } catch (...) {
        std::printf("[occt] UNKNOWN EXCEPTION during OCCT fillet\n");
    }

    check(occtOk, "OCCT cylinder-top fillet built");
    check(occtIsTorus, "OCCT new fillet face is a Torus (GeomAbs_Torus)");
    check(occtTorusFaceCount == 1, "OCCT produced exactly one torus blend face");
    check(std::fabs(occtMinor - minorExpected) <= 1e-9,
          "OCCT torus MinorRadius == R (1)");
    check(std::fabs(occtMajor - majorExpected) <= 1e-9,
          "OCCT torus MajorRadius == Rc-R (4)");

    // =======================================================================
    // (3) A/B parity of the filleted VOLUME (rel <= 1e-6)
    // =======================================================================
    const double absDiff = std::fabs(occtVol - nativeVol);
    const double relDiff = (nativeVol != 0.0) ? absDiff / std::fabs(nativeVol) : absDiff;
    std::printf("\n[A/B] native vol = %.15f\n", nativeVol);
    std::printf("[A/B] occt   vol = %.15f\n", occtVol);
    std::printf("[A/B] |abs diff| = %.6e   rel diff = %.6e   (tol rel <= 1e-6)\n",
                absDiff, relDiff);
    check(relDiff <= 1e-6, "filleted VOLUME parity native vs OCCT (rel <= 1e-6)");

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    const bool verdict = (g_pass == g_total);
    std::printf("=== VERDICT: %s ===\n", verdict ? "PASS" : "FAIL");
    return verdict ? 0 : 1;
}
