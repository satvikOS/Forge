// forge-kernel/test/native_vs_occt_hlr_import.cpp
//
// A/B gate for the NATIVE-HLR FEATURE-EDGE SUPPRESSION on an importOcctSolid
// round-trip — the coverage the K4 TKHLR-drop brief flagged as MISSING (the
// original native_vs_occt_hlr.cpp only exercised hand-built clean-topology
// solids, never an import, so the faceted-topology divergence was latent).
//
// It imports an OCCT box + cylinder through forge::importOcctSolid (the
// "faceted topology over exact geometry" model — every analytic face is
// triangulated in its (u,v) domain, so each face's triangulation diagonal /
// tessellation seam becomes a topological Edge), runs the NATIVE
// hiddenLineRemoval with cullSmoothEdges ON, and A/Bs the per-visibility-class
// projected polyline length against OCCT 7.9.3 HLRBRep_Algo on the SAME OCCT
// shape.
//
// WHAT THIS PROVES (measured, machine-precision on the polyhedral case):
//   * POLYHEDRAL import (box): feature-edge suppression restores EXACT parity —
//     a box that imports as 18 edges (12 real + 6 facet diagonals) draws only
//     its 12 real edges, matching OCCT's 4 visible + 4 hidden (front) and
//     9 + 3 (iso) to rel <= 1e-9. Without suppression it drew 5 + 13 / 12 + 6.
//   * ANALYTIC-QUADRIC import, view ALONG the cap normal (cylinder top): the
//     kept cap-boundary rings ARE the outline, so native matches OCCT to the
//     chordal tessellation tolerance (rel <= 1e-2).
//
// RESOLVED (2026-07-17, attempt 3 — the GROUPED ANALYTIC SILHOUETTE):
//   * ANALYTIC-QUADRIC import, view ACROSS the axis (cylinder front): OCCT draws
//     the two analytic SILHOUETTE (outline) lines. The native HLR now GROUPS the
//     faceted sub-faces by shared analytic-surface signature + connectivity and
//     traces the silhouette over the whole cylinder's u in [0,2pi] (closed-form
//     iso-u tangent lines), so it reconstructs BOTH outline lines and matches OCCT
//     per-class (V=180 H=80) to rel 0 — native 160 -> 260. This case is now
//     ASSERTED (mode 1, total within chordal tol), not merely measured.
//
// BUILD: see test/build_hlr_import_gate.sh (links OCCT + OcctImport.cpp, mirrors
// build_occt_import_test.sh). Exit 0 iff every ASSERTED case passes.

#include "forge/native/brep/Hlr.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/OcctImport.hpp"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <HLRAlgo_Projector.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GCPnts_QuasiUniformAbscissa.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name);
    if (cond) ++g_pass;
}

// ---- OCCT reference (projected screen-plane length + non-degenerate count) ----
struct AB { int vCount = 0, hCount = 0; double vLen = 0, hLen = 0; };
static double slen(const gp_Pnt& a, const gp_Pnt& b) {
    double dx = b.X() - a.X(), dy = b.Y() - a.Y();
    return std::sqrt(dx * dx + dy * dy);
}
static void accum(const TopoDS_Shape& comp, int& count, double& len, double eps) {
    if (comp.IsNull()) return;
    for (TopExp_Explorer ex(comp, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Edge e = TopoDS::Edge(ex.Current());
        BRepAdaptor_Curve ad(e);
        GCPnts_QuasiUniformAbscissa d(ad, 24);
        double elen = 0;
        if (d.IsDone() && d.NbPoints() >= 2) {
            gp_Pnt prev = ad.Value(d.Parameter(1));
            for (int i = 2; i <= d.NbPoints(); ++i) {
                gp_Pnt cur = ad.Value(d.Parameter(i));
                elen += slen(prev, cur); prev = cur;
            }
        } else {
            elen = slen(ad.Value(ad.FirstParameter()), ad.Value(ad.LastParameter()));
        }
        if (elen > eps) { ++count; len += elen; }
    }
}
static AB runOcct(const TopoDS_Shape& shape, const Vec3& N) {
    AB o;
    Handle(HLRBRep_Algo) algo = new HLRBRep_Algo();
    algo->Add(shape);
    algo->Projector(HLRAlgo_Projector(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(N.x, N.y, N.z))));
    algo->Update(); algo->Hide();
    HLRBRep_HLRToShape ts(algo);
    accum(ts.VCompound(), o.vCount, o.vLen, 1e-7);
    accum(ts.OutLineVCompound(), o.vCount, o.vLen, 1e-7);   // silhouette -> visible
    accum(ts.HCompound(), o.hCount, o.hLen, 1e-7);
    return o;
}
static AB natSummary(const HlrResult& r, double eps) {
    AB s;
    for (const HlrSegment& seg : r.segments) {
        if (seg.length2d <= eps) continue;                  // drop zero-length depth edges
        if (seg.visibility == HlrVisibility::Hidden) { ++s.hCount; s.hLen += seg.length2d; }
        else { ++s.vCount; s.vLen += seg.length2d; }
    }
    return s;
}
static bool relClose(double a, double b, double rel) {
    double d = std::max({std::fabs(a), std::fabs(b), 1e-300});
    return std::fabs(a - b) / d <= rel;
}

// A/B one imported shape at one view. `mode`: 0 = assert per-class rel<=relTol;
// 1 = assert TOTAL length rel<=relTol (chordal cases); 2 = MEASURE only (non-fatal).
static void abCase(const char* label, const TopoDS_Shape& shape, const Vec3& viewDir,
                   int mode, double relTol) {
    forge::ImportResult imp = forge::importOcctSolid(shape);
    Vec3 N = vnorm(viewDir);
    AB occ = runOcct(shape, N);
    HlrOptions opt; opt.cullSmoothEdges = true;
    AB nat{};
    bool imported = imp.ok && imp.solid;
    if (imported) nat = natSummary(hiddenLineRemoval(*imp.solid, viewDir, opt), 1e-7);
    double natTot = nat.vLen + nat.hLen, occTot = occ.vLen + occ.hLen;
    double tRel = std::fabs(natTot - occTot) / std::max({natTot, occTot, 1e-300});
    std::printf("\n--- %s ---\n", label);
    std::printf("  OCCT  : vis=%d hid=%d  V=%.4f H=%.4f  tot=%.4f\n",
                occ.vCount, occ.hCount, occ.vLen, occ.hLen, occTot);
    std::printf("  NATIVE: vis=%d hid=%d  V=%.4f H=%.4f  tot=%.4f  (cullSmoothEdges ON)\n",
                nat.vCount, nat.hCount, nat.vLen, nat.hLen, natTot);
    std::printf("  totRel=%.3e\n", tRel);
    check(imported, "import ok");
    if (mode == 0) {
        check(relClose(nat.vLen, occ.vLen, relTol) && relClose(nat.hLen, occ.hLen, relTol),
              "per-class projected length matches OCCT (feature-edge suppression exact)");
        check(nat.vCount == occ.vCount && nat.hCount == occ.hCount,
              "non-degenerate polyline COUNT matches OCCT");
    } else if (mode == 1) {
        check(tRel <= relTol, "TOTAL projected length matches OCCT within chordal tol");
    } else {
        std::printf("  [MEASURE] known-limitation case (non-fatal): native under-draws by the\n"
                    "            analytic silhouette outline the faceted import cannot reconstruct.\n"
                    "            missing length ~= %.4f (OCCT %.4f - native %.4f)\n",
                    occTot - natTot, occTot, natTot);
    }
}

int main() {
    std::printf("=== NATIVE HLR feature-edge suppression  vs  OCCT 7.9.3  (importOcctSolid A/B) ===\n");

    // POLYHEDRAL import — MUST be exact (the primary K4 blocker: box drew facet diagonals).
    abCase("BOX 100x60x40 front(-Y)  [assert per-class exact]",
           BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape(), Vec3{0, -1, 0}, 0, 1e-9);
    abCase("BOX 100x60x40 iso(-1,-1,-1)  [assert per-class exact]",
           BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape(), Vec3{-1, -1, -1}, 0, 1e-9);

    // ANALYTIC-QUADRIC import, view ALONG cap normal — cap rings ARE the outline.
    abCase("CYLINDER r20 h50 top(-Z)  [assert total within chordal tol]",
           BRepPrimAPI_MakeCylinder(20.0, 50.0).Shape(), Vec3{0, 0, -1}, 1, 1e-2);

    // ANALYTIC-QUADRIC import, view ACROSS axis — the grouped analytic silhouette
    // now reconstructs the 2 outline lines; assert total within chordal tol.
    abCase("CYLINDER r20 h50 front(-Y)  [assert total within chordal tol: silhouette restored]",
           BRepPrimAPI_MakeCylinder(20.0, 50.0).Shape(), Vec3{0, -1, 0}, 1, 1e-2);

    std::printf("\n=== %d / %d ASSERTED checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
