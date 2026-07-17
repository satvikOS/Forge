// forge-kernel/test/native_hlr_import_perf.cpp
//
// PERF PROBE for the FACETED-IMPORT HLR route (the K4 attempt-3 ">100 s" wall):
// an OCCT box - cylinder (drilled box) imported via importOcctSolid becomes a
// faceted-topology solid (~64 bore strips, each re-tessellated by emitFaceTris),
// then hiddenLineRemoval runs on it. This is the route projectView/sectionView
// take (they receive a raw TopoDS_Shape). Times it WITH the 2D-BVH occlusion.
//
// BUILD: mirror build_hlr_import_gate.sh (links OCCT + OcctImport.cpp).

#include "forge/native/brep/Hlr.hpp"
#include "forge/OcctImport.hpp"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <TopoDS_Shape.hxx>

#include <chrono>
#include <cstdio>

using namespace forge::native::brep;

static double ms(std::chrono::steady_clock::duration d) {
    return std::chrono::duration<double, std::milli>(d).count();
}

int main() {
    // Drilled box: box 100x60x40 minus a r=10 through-bore along +Z at centre.
    TopoDS_Shape box = BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape();
    TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(10.0, 80.0).Shape();
    gp_Trsf tr; tr.SetTranslation(gp_Vec(50, 30, -20));
    cyl = BRepBuilderAPI_Transform(cyl, tr, false).Shape();
    TopoDS_Shape drilled = BRepAlgoAPI_Cut(box, cyl).Shape();

    forge::ImportResult imp = forge::importOcctSolid(drilled);
    if (!imp.ok || !imp.solid) {
        std::printf("FATAL: importOcctSolid failed (ok=%d)\n", (int)imp.ok);
        return 2;
    }
    std::size_t nf = 0;
    for (const Shell* sh : imp.solid->shells) nf += sh->faces.size();

    const Vec3 viewDir{0, -1, 0};  // front
    HlrResult r0 = hiddenLineRemoval(*imp.solid, viewDir);
    std::printf("=== FACETED-IMPORT HLR PERF — drilled box front(-Y) ===\n");
    std::printf("  imported faces=%zu  ok=%d\n", nf, (int)r0.ok);
    std::printf("  OUTPUT: visSeg=%u hidSeg=%u  V=%.6f H=%.6f\n",
                r0.visibleSegments, r0.hiddenSegments,
                r0.visibleLength2d, r0.hiddenLength2d);

    double best = 1e300;
    for (int i = 0; i < 3; ++i) {
        auto t0 = std::chrono::steady_clock::now();
        HlrResult r = hiddenLineRemoval(*imp.solid, viewDir);
        auto t1 = std::chrono::steady_clock::now();
        double dt = ms(t1 - t0);
        if (dt < best) best = dt;
        std::printf("  iter %d: %.2f ms  (vis=%u hid=%u)\n",
                    i, dt, r.visibleSegments, r.hiddenSegments);
    }
    std::printf("  --> best %.2f ms\n", best);
    return 0;
}
