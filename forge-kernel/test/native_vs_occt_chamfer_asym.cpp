// native_vs_occt_chamfer_asym.cpp
//
// Standalone A/B-vs-OCCT validation for the ANALYTIC ASYMMETRIC TWO-DISTANCE
// FLAT-BEVEL EDGE CHAMFER (forge::native::brep::chamferBoxEdgeAsymmetric).
//
// Mirrors the closed-form gate in test/native/brep/chamfer_analytic_test.cpp:
//   box L=10, dA=1.5 on face A (TOP, z=L), dB=2.5 on face B (FRONT, y=0),
//   top-front edge (native edgeIndex 4)  ->  chamfered volume 981.25.
//
// SIDE A (native):  chamferBoxEdgeAsymmetric(tb, 10, 1.5, 2.5, 4)  -> MassProps volume
// SIDE B (OCCT 7.9.3):
//   BRepPrimAPI_MakeBox(10,10,10)
//   -> BRepFilletAPI_MakeChamfer ch(box)
//   -> ch.Add(dA=1.5, dB=2.5, theTopFrontEdge, theTopFace)   // two-distance overload;
//      pass the TOP face as the reference so dA (=Dis1) binds to it (z=L) and
//      dB (=Dis2) binds to the FRONT face (y=0), matching the native binding
//   -> ch.Build()  -> BRepGProp::VolumeProperties volume
//   plus: confirm the new bevel face is a Plane (GeomAbs_Plane).
//
// PASS iff the OCCT chamfered volume matches 981.25 to relative <= 1e-6 AND the
// bevel face is planar. (Native side is reported too for a direct A/B compare.)
//
// Build (linked against the WHOLE native object set so cross-module symbols
// resolve), then run:
//   clang++ -std=c++20 -O2 \
//     -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_chamfer_asym.cpp \
//     <native srcs: ChamferAnalytic Topology Surface Curve MassProps Sew Nurbs \
//                   NurbsSurface mesh/HalfEdgeMesh> \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_chamfer_asym && /tmp/native_vs_occt_chamfer_asym

// ---- native analytic chamfer ----
#include "forge/native/brep/ChamferAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/MassProps.hpp"

// ---- OCCT ----
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <GeomAbs_SurfaceType.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

// Find the edge shared by exactly the two given faces of `box`.
static bool sharedEdge(const TopoDS_Shape& box, const TopoDS_Face& fa,
                       const TopoDS_Face& fb, TopoDS_Edge& out) {
    TopTools_IndexedMapOfShape edgesB;
    TopExp::MapShapes(fb, TopAbs_EDGE, edgesB);
    for (TopExp_Explorer ex(fa, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Shape& e = ex.Current();
        if (edgesB.Contains(e)) { out = TopoDS::Edge(e); return true; }
    }
    return false;
}

int main() {
    std::printf("=== A/B vs OCCT — ANALYTIC ASYMMETRIC TWO-DISTANCE CHAMFER ===\n");

    const double L  = 10.0;
    const double dA = 1.5;   // face A == TOP (z = L)
    const double dB = 2.5;   // face B == FRONT (y = 0)
    const double expectedVol = L * L * L - 0.5 * dA * dB * L;  // 981.25
    std::printf("box L=%.1f  dA(top,z=L)=%.2f  dB(front,y=0)=%.2f  ->  expected vol = %.6f\n\n",
                L, dA, dB, expectedVol);

    // =====================================================================
    // SIDE A — native analytic chamfer
    // =====================================================================
    std::printf("--- SIDE A: native chamferBoxEdgeAsymmetric(L,dA,dB,edge=4) ---\n");
    double nativeVol = 0.0;
    bool nativeBevelPlanar = false;
    {
        TopologyBuilder tb;
        AnalyticChamferResult ar =
            chamferBoxEdgeAsymmetric(tb, L, dA, dB, /*edgeIndex=*/4);
        std::printf("  reason: %s\n", ar.reason);
        check(ar.ok, "native chamfer op ok");
        if (ar.ok) {
            check(tb.isClosedTwoManifold(), "native shell is a closed 2-manifold");
            MassProps mp = massProperties(*ar.solid, /*gaussN=*/8);
            nativeVol = mp.volume;
            nativeBevelPlanar =
                ar.bevelFace && ar.bevelFace->surface &&
                ar.bevelFace->surface->kind == SurfaceKind::Plane;
            std::printf("  >> NATIVE chamfered volume = %.15f\n", nativeVol);
            check(nativeBevelPlanar, "native bevel surface kind == Plane");
            const double relN = std::fabs(nativeVol - expectedVol) / expectedVol;
            std::printf("  >> native |rel err| vs 981.25 = %.3e\n", relN);
            check(relN <= 1e-6, "native volume matches 981.25 (rel <= 1e-6)");
        }
    }

    // =====================================================================
    // SIDE B — OCCT 7.9.3 BRepFilletAPI_MakeChamfer two-distance Add
    // =====================================================================
    std::printf("\n--- SIDE B: OCCT BRepFilletAPI_MakeChamfer (two-distance Add) ---\n");
    double occtVol = 0.0;
    bool occtBevelPlanar = false;
    bool occtBuilt = false;
    try {
        BRepPrimAPI_MakeBox mkBox(L, L, L);
        TopoDS_Shape box = mkBox.Shape();

        // Box volume sanity (1000).
        GProp_GProps gp0;
        BRepGProp::VolumeProperties(box, gp0);
        std::printf("  OCCT box volume = %.12f (expect 1000)\n", gp0.Mass());

        const TopoDS_Face topFace   = mkBox.TopFace();    // z = L  (face A)
        const TopoDS_Face frontFace = mkBox.FrontFace();  // y = 0  (face B)

        TopoDS_Edge topFrontEdge;
        bool gotEdge = sharedEdge(box, topFace, frontFace, topFrontEdge);
        check(gotEdge, "found the top-front shared edge");

        if (gotEdge) {
            // Two-distance overload: Add(Dis1, Dis2, E, F). Dis1 (=dA) binds to the
            // reference face F; pass the TOP face so dA binds to z=L and dB to y=0.
            BRepFilletAPI_MakeChamfer ch(box);
            ch.Add(dA, dB, topFrontEdge, topFace);
            ch.Build();
            check(ch.IsDone(), "OCCT chamfer Build() IsDone");

            if (ch.IsDone()) {
                occtBuilt = true;
                TopoDS_Shape result = ch.Shape();

                GProp_GProps gp;
                BRepGProp::VolumeProperties(result, gp);
                occtVol = gp.Mass();
                std::printf("  >> OCCT chamfered volume = %.15f\n", occtVol);

                // The chamfered solid has 7 faces (6 box faces, one shrunk; one new
                // bevel plane). The bevel is the unique face that is neither axis-
                // aligned at x in {0,L}, y in {0,L}, z in {0,L}. Detect it as the
                // planar face whose normal is not axis-aligned; assert it is a Plane.
                int planarBevels = 0;
                int nFaces = 0;
                for (TopExp_Explorer ex(result, TopAbs_FACE); ex.More(); ex.Next()) {
                    ++nFaces;
                    TopoDS_Face f = TopoDS::Face(ex.Current());
                    BRepAdaptor_Surface surf(f);
                    GeomAbs_SurfaceType st = surf.GetType();
                    if (st != GeomAbs_Plane) continue;
                    gp_Pln pln = surf.Plane();
                    gp_Dir n = pln.Axis().Direction();
                    const double ax = std::fabs(n.X()), ay = std::fabs(n.Y()),
                                 az = std::fabs(n.Z());
                    const bool axisAligned =
                        (ax > 1.0 - 1e-7) || (ay > 1.0 - 1e-7) || (az > 1.0 - 1e-7);
                    if (!axisAligned) ++planarBevels;
                }
                std::printf("  OCCT result face count = %d ; non-axis-aligned planar "
                            "bevel faces = %d\n", nFaces, planarBevels);
                occtBevelPlanar = (planarBevels == 1);
                check(occtBevelPlanar,
                      "OCCT bevel face is a single non-axis-aligned Plane");

                const double rel = std::fabs(occtVol - expectedVol) / expectedVol;
                std::printf("  >> OCCT |rel err| vs 981.25 = %.3e\n", rel);
                check(rel <= 1e-6, "OCCT chamfered volume matches 981.25 (rel <= 1e-6)");
            }
        }
    } catch (const Standard_Failure& ex) {
        std::printf("  [FAIL] OCCT threw: %s\n", ex.GetMessageString());
        check(false, "OCCT chamfer did not throw");
    }

    // =====================================================================
    // A/B compare
    // =====================================================================
    std::printf("\n=== A/B COMPARE ===\n");
    std::printf("  expected (closed-form 1000 - 0.5*dA*dB*L) = %.15f\n", expectedVol);
    std::printf("  NATIVE chamfered volume                    = %.15f\n", nativeVol);
    std::printf("  OCCT   chamfered volume                    = %.15f\n", occtVol);
    if (occtBuilt && nativeVol > 0.0) {
        const double relAB = std::fabs(nativeVol - occtVol) /
                             std::max(std::fabs(occtVol), 1.0);
        std::printf("  NATIVE vs OCCT |rel err|                    = %.3e\n", relAB);
        check(relAB <= 1e-6, "native vs OCCT agree (rel <= 1e-6)");
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
