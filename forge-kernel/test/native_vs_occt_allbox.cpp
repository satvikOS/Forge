// forge-kernel/test/native_vs_occt_allbox.cpp
//
// 1:1 A/B HARNESS for the SHARED-VERTEX (spherical-octant) corner blend: fillet
// ALL 12 EDGES of a box [0,L]^3 with the SAME constant radius R, BOTH ways, and
// compare the filleted-solid volumes:
//   * NATIVE  filletSolidStraightEdgesAnalytic (topology-sourced multi-edge analytic
//             rolling-ball fillet — 6 inset planar squares + 12 set-back cylinder
//             blends + 8 SPHERICAL-OCTANT corner blends, one watertight closed
//             2-manifold), volume via the analytic divergence-theorem MassProps.
//   * OCCT    BRepFilletAPI_MakeFillet adding R on all 12 box edges (OCCT's own
//             exact analytic fillet — its rolling-ball blend builds the same
//             cylinders + spherical corners on a simple box), volume via BRepGProp.
//
// OCCT's BRepFilletAPI on a SIMPLE box does NOT hang (only multi-hole bodies do —
// the documented OCCT-deletion-gate hang), so this is a valid analytic-vs-analytic
// A/B. The closed-form expected volume is also asserted on both sides:
//   V = L^3 - 12*(1-pi/4)*R^2*(L-2R) - 8*(1-pi/6)*R^3.
//
// STANDALONE C++20 that LINKS OCCT. NOT part of run_native.sh; does NOT touch
// binding.cpp / CMakeLists.txt. Build + run (mirrors native_vs_occt_fillet_ext.cpp;
// link the OCCT-free native object set built by run_native.sh against OCCT):
//   OCCT=/opt/homebrew/opt/opencascade   # or /usr/local/opt/opencascade
//   clang++ -std=c++20 -O2 -I forge-kernel/include -I "$OCCT/include/opencascade" \
//     forge-kernel/test/native_vs_occt_allbox.cpp <native brep .o set> \
//     -L "$OCCT/lib" -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d \
//     -lTKGeomBase -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_allbox && /tmp/native_vs_occt_allbox

#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Edge.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopExp.hxx>
#include <TopAbs.hxx>

#include <cmath>
#include <cstdio>
#include <cstdint>
#include <vector>

using namespace forge::native::brep;

int main() {
    std::printf("=== A/B: ALL-12-EDGE box fillet — native spherical-octant vs OCCT ===\n");
    constexpr double kPi = 3.14159265358979323846;
    const double L = 10.0, R = 1.5;

    // Closed-form expected filleted volume.
    const double expected = L * L * L
                          - 12.0 * (1.0 - kPi / 4.0) * R * R * (L - 2.0 * R)
                          - 8.0 * (1.0 - kPi / 6.0) * R * R * R;

    // ---- NATIVE: fillet all 12 enumerated edges in one call -----------------
    double nativeVol = 0.0; bool nativeOk = false; int corners = 0;
    {
        SolidFactory fac;
        Solid* box = fac.buildBox(L, L, L);
        std::vector<Edge*> edges = enumerateSolidStraightEdges(*box);
        std::vector<std::uint32_t> all;
        for (std::uint32_t i = 0; i < edges.size(); ++i) all.push_back(i);
        TopologyBuilder tb;
        AnalyticChainFilletResult ch = filletSolidStraightEdgesAnalytic(tb, *box, all, R);
        if (ch.ok && ch.solid) {
            nativeVol = massProperties(*ch.solid, 10).volume;
            corners = static_cast<int>(ch.cornerFaces.size());
            nativeOk = true;
        } else {
            std::printf("  [native] NOT ok: %s\n", ch.reason);
        }
    }

    // ---- OCCT: BRepFilletAPI_MakeFillet, R on every box edge ----------------
    double occtVol = 0.0; bool occtOk = false;
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), L, L, L).Shape();
        BRepFilletAPI_MakeFillet fillet(box);
        TopTools_IndexedMapOfShape emap;
        TopExp::MapShapes(box, TopAbs_EDGE, emap);
        for (int i = 1; i <= emap.Extent(); ++i)
            fillet.Add(R, TopoDS::Edge(emap(i)));
        fillet.Build();
        if (!fillet.IsDone()) {
            std::printf("  [occt] fillet Build() not done\n");
        } else {
            TopoDS_Shape result = fillet.Shape();
            if (result.IsNull()) {
                std::printf("  [occt] fillet result is null\n");
            } else {
                GProp_GProps props;
                BRepGProp::VolumeProperties(result, props);
                occtVol = props.Mass();
                occtOk = true;
            }
        }
    }

    std::printf("  closed-form expected volume = %.12f\n", expected);
    std::printf("  NATIVE : ok=%d corners=%d volume=%.12f\n", nativeOk ? 1 : 0, corners, nativeVol);
    std::printf("  OCCT   : ok=%d           volume=%.12f\n", occtOk ? 1 : 0, occtVol);

    int fails = 0;
    auto gate = [&](bool cond, const char* name) {
        std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name);
        if (!cond) ++fails;
    };
    gate(nativeOk, "native all-12 fillet ok (spherical-octant corners)");
    gate(corners == 8, "native built 8 spherical-octant corner faces");
    gate(occtOk, "OCCT all-12 fillet built (no hang on a simple box)");
    if (nativeOk) {
        const double dNat = std::fabs(nativeVol - expected);
        std::printf("  native vs closed-form  |dV|=%.3e\n", dNat);
        gate(dNat <= 1e-9, "native volume == closed-form to <= 1e-9");
    }
    if (occtOk) {
        const double dOcc = std::fabs(occtVol - expected);
        std::printf("  OCCT   vs closed-form  |dV|=%.3e\n", dOcc);
        gate(dOcc <= 1e-6, "OCCT volume == closed-form to <= 1e-6");
    }
    if (nativeOk && occtOk) {
        const double rel = std::fabs(nativeVol - occtVol) /
                           std::max(std::fabs(occtVol), 1e-12);
        std::printf("  NATIVE vs OCCT  |dV|=%.3e  rel=%.3e\n",
                    std::fabs(nativeVol - occtVol), rel);
        gate(rel <= 1e-6, "native all-12 volume == OCCT all-12 volume (rel <= 1e-6)");
    }

    std::printf("=== RESULT: %s (%d failed) ===\n", fails == 0 ? "ALL PASS" : "FAIL", fails);
    return fails == 0 ? 0 : 1;
}
