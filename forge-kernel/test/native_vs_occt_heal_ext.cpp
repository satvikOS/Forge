// forge-kernel/test/native_vs_occt_heal_ext.cpp
//
// A/B validation: forge native HEAL (Heal.cpp pass 6/7/8 — the "exhaustive HEAL
// completions") vs OCCT ShapeFix_Shape (+ FixFaceOrientation / ShapeFix_Solid) on
// the SAME three fixtures the native heal_test.cpp gate exercises in cases [4]/[5]/[6]:
//
//   ORIENTATION     ([4]): a box with ONE reversed face.
//                          forge: pass-6 flips it -> closed, +volume, consistent.
//                          OCCT : ShapeFix_Shape::FixFaceOrientation -> same.
//                          COMPARE: both closed, both signed-volume positive, both
//                          orientation-consistent.
//
//   SELF-INTERSECT  ([5]): a clean box PLUS a tiny rogue triangle that properly
//                          interpenetrates the front wall.
//                          forge: pass-7 drops the sliver -> watertight, vol == L^3.
//                          OCCT : sew + ShapeFix -> the rogue patch does not join the
//                          watertight shell; the box volume is preserved.
//                          COMPARE: both watertight, both volume preserved.
//
//   NON-MANIFOLD    ([6]): a closed box PLUS a flap re-using one box edge (that edge
//                          is shared by 3 faces).
//                          forge: pass-8 DETECTS + reports the join UNFIXED (the
//                          2-manifold model cannot resolve it) -> NOT fully healed.
//                          OCCT : the sewer reports a multiple (non-manifold) edge and
//                          the result is NOT a valid closed solid.
//                          COMPARE: both report not-fully-healed / not a clean closed
//                          2-manifold solid.
//
// Standalone C++20. Links the forge native heal stack AND OCCT.
//
// Build (also see the run block at the foot of this file):
//   clang++ -std=c++20 -O2 \
//     -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_heal_ext.cpp \
//     forge-kernel/src/native/brep/{Heal,Sew,Topology,Surface,Curve,Nurbs,NurbsSurface}.cpp \
//     forge-kernel/src/native/{ExactReal,ExactPredicates3D}.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKShHealing -lTKBO -lTKBool \
//     -o /tmp/native_vs_occt_heal_ext && /tmp/native_vs_occt_heal_ext

// ---- forge native heal stack ------------------------------------------------
#include "forge/native/brep/Heal.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"

// ---- OCCT -------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_Solid.hxx>
#include <ShapeAnalysis_Shell.hxx>

#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

// =============================================================================
// tiny PASS/FAIL harness
// =============================================================================
static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("    [PASS] %s\n", name.c_str()); }
    else        std::printf("    [FAIL] %s\n", name.c_str());
}

// =============================================================================
// shared geometry — the SAME box corners + rings the native heal_test uses
// =============================================================================
struct V3 { double x, y, z; };
// CCW-seen-from-outside box rings (identical to heal_test.cpp).
static const int kRings[6][4] = {{0,3,2,1},{4,5,6,7},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
static std::array<V3,8> boxCorners(double L) {
    const double a = 0.0, b = L;
    return {{ {a,a,a},{b,a,a},{b,b,a},{a,b,a},{a,a,b},{b,a,b},{b,b,b},{a,b,b} }};
}

// =============================================================================
// forge-native face builder (mirror of heal_test.cpp faceFromRing)
// =============================================================================
static Face* faceFromRing(TopologyBuilder& tb, const std::vector<Point3>& ring) {
    Face* f = tb.makeFace();
    std::vector<Vertex*> vs; vs.reserve(ring.size());
    for (const Point3& p : ring) vs.push_back(tb.makeVertex(p));
    tb.addOuterLoopToFace(f, vs);
    return f;
}

// =============================================================================
// OCCT face builder from an ordered position ring (planar polygon face)
// =============================================================================
static TopoDS_Face occtFaceFromRing(const std::vector<V3>& ring) {
    BRepBuilderAPI_MakePolygon poly;
    for (const V3& p : ring) poly.Add(gp_Pnt(p.x, p.y, p.z));
    poly.Close();
    BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True /*planar only*/);
    return mf.Face();
}

// Count free (single-coedge) + multiple (3+-coedge / non-manifold) edges of a shape
// by walking the edge->face incidence map.
struct EdgeStats { int freeEdges = 0; int sharedEdges = 0; int multipleEdges = 0; };
static EdgeStats occtEdgeStats(const TopoDS_Shape& sh) {
    EdgeStats s;
    TopTools_IndexedDataMapOfShapeListOfShape m;
    TopExp::MapShapesAndAncestors(sh, TopAbs_EDGE, TopAbs_FACE, m);
    for (int i = 1; i <= m.Extent(); ++i) {
        const TopoDS_Edge& e = TopoDS::Edge(m.FindKey(i));
        // skip seam/degenerate-free count by edge degeneracy is not needed for polygons
        int nf = m.FindFromIndex(i).Extent();
        if (nf <= 1) s.freeEdges++;
        else if (nf == 2) s.sharedEdges++;
        else s.multipleEdges++;
    }
    return s;
}

static double occtSignedVolume(const TopoDS_Shape& sh) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(sh, props);
    return props.Mass();   // signed for an oriented closed shell
}

// Whether OCCT considers the shell closed (every edge shared by exactly 2 faces,
// no free edges) — the watertight test for a polygonal shell.
static bool occtClosed(const TopoDS_Shape& sh) {
    EdgeStats s = occtEdgeStats(sh);
    return s.freeEdges == 0 && s.multipleEdges == 0 && s.sharedEdges > 0;
}

// =============================================================================
// CASE [4] — ORIENTATION: box with ONE reversed face.
// =============================================================================
static void caseOrientation() {
    std::printf("[4] ORIENTATION  (one reversed box face)\n");
    const double L = 5.0, tol = 1e-6;
    auto P = boxCorners(L);

    // -------- forge native --------
    std::printf("  forge native (Heal pass-6 FixFaceOrientation):\n");
    TopologyBuilder tb;
    std::vector<Face*> faces;
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<Point3> ring;
        for (int k = 0; k < 4; ++k) { auto& q = P[kRings[fi][k]]; ring.push_back({q.x,q.y,q.z}); }
        if (fi == 2) std::reverse(ring.begin(), ring.end());   // reverse FRONT face
        faces.push_back(faceFromRing(tb, ring));
    }
    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    const double fvol = r.volumeAfter;
    std::printf("      closed=%s  facesFlipped=%zu  vol=%.6f  fullyHealed=%s\n",
                r.after.closed ? "yes" : "no", r.facesFlipped, fvol,
                r.fullyHealed() ? "yes" : "no");
    const bool forgeClosed = r.after.closed;
    const bool forgeVolPos = (fvol > 0.0);
    const bool forgeConsistent = r.after.closed && r.after.nonManifoldEdges == 0 &&
                                 r.after.eulerCharacteristic == 2;

    // -------- OCCT --------
    std::printf("  OCCT (Sewing -> ShapeFix_Solid::FixFaceOrientation -> ShapeFix_Shape):\n");
    // The 6 faces are built as INDEPENDENT polygons (private edges) — exactly the raw
    // forge input. They must be SEWN into one connected shell before orientation can be
    // fixed (the analogue of forge's rebuild+sew). The reversed face is the defect the
    // subsequent ShapeFix_Solid::FixFaceOrientation must correct.
    BRepBuilderAPI_Sewing sew(tol);
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<V3> ring;
        for (int k = 0; k < 4; ++k) ring.push_back(P[kRings[fi][k]]);
        if (fi == 2) std::reverse(ring.begin(), ring.end());   // same reversed face
        sew.Add(occtFaceFromRing(ring));
    }
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    // grab the (single) sewn shell.
    TopoDS_Shell shell;
    for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) { shell = TopoDS::Shell(ex.Current()); break; }
    // ShapeFix_Solid wraps the shell into a solid and FIXES face orientation so the
    // shell is consistently oriented + outward (the OCCT analogue of pass-6).
    ShapeFix_Solid sfs;
    sfs.SetPrecision(tol);
    TopoDS_Shape madeSolid = sfs.SolidFromShell(shell);
    ShapeFix_Shape fixer(madeSolid);
    fixer.SetPrecision(tol);
    fixer.Perform();
    TopoDS_Shape fixed = fixer.Shape();
    const bool occtIsClosed = occtClosed(fixed);
    const double ovol = occtSignedVolume(fixed);
    std::printf("      sewer: free=%d contig=%d  | fixed closed=%s  signedVol=%.6f\n",
                sew.NbFreeEdges(), sew.NbContigousEdges(), occtIsClosed ? "yes":"no", ovol);
    const bool occtVolPos = (ovol > 0.0);

    // -------- COMPARE --------
    std::printf("  COMPARE:\n");
    check(forgeClosed && occtIsClosed,   "orientation: BOTH closed");
    check(forgeVolPos && occtVolPos,     "orientation: BOTH signed-volume POSITIVE (outward)");
    check(forgeConsistent,               "orientation: forge shell orientation-consistent (chi=2, 0 non-manifold)");
    check(std::fabs(std::fabs(fvol) - L*L*L) <= 1e-6 &&
          std::fabs(std::fabs(ovol) - L*L*L) <= 1e-6, "orientation: BOTH volume == L^3");
}

// =============================================================================
// CASE [5] — SELF-INTERSECTION: box + tiny interpenetrating rogue triangle.
// =============================================================================
static void caseSelfIntersect() {
    std::printf("[5] SELF-INTERSECTION  (box + tiny interpenetrating sliver)\n");
    const double L = 10.0, tol = 1e-6;
    auto P = boxCorners(L);
    const double cx = L*0.5, cz = L*0.5, s = L*0.02, d = L*0.01;
    const std::array<V3,3> rogue = {{ {cx - s, +d, cz}, {cx + s, +d, cz}, {cx, -d, cz + s} }};

    // -------- forge native --------
    std::printf("  forge native (Heal pass-7 self-intersection trim):\n");
    TopologyBuilder tb;
    std::vector<Face*> faces;
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<Point3> ring;
        for (int k = 0; k < 4; ++k) { auto& q = P[kRings[fi][k]]; ring.push_back({q.x,q.y,q.z}); }
        faces.push_back(faceFromRing(tb, ring));
    }
    faces.push_back(faceFromRing(tb, {{rogue[0].x,rogue[0].y,rogue[0].z},
                                      {rogue[1].x,rogue[1].y,rogue[1].z},
                                      {rogue[2].x,rogue[2].y,rogue[2].z}}));
    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    const double fvol = std::fabs(r.volumeAfter);
    std::printf("      F=%zu  closed=%s  selfxRemoved=%zu  unfixedPairs=%zu  vol=%.6f  fullyHealed=%s\n",
                r.after.faces, r.after.closed ? "yes":"no", r.selfIntersectingFacesRemoved,
                r.unfixedSelfIntersectionFacePairs.size(), fvol, r.fullyHealed() ? "yes":"no");
    const bool forgeWatertight = r.after.closed && r.after.freeEdges == 0 &&
                                 r.after.nonManifoldEdges == 0;
    const bool forgeVolOk = std::fabs(fvol - L*L*L) <= 1e-6;

    // -------- OCCT --------
    // Sew the 6 box faces (the watertight intent) — OCCT's sewer keeps the rogue patch
    // OUT of the closed shell (it shares no boundary, so it cannot mate); then ShapeFix.
    std::printf("  OCCT (BRepBuilderAPI_Sewing of the 6 box faces + ShapeFix):\n");
    BRepBuilderAPI_Sewing sew(tol);
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<V3> ring;
        for (int k = 0; k < 4; ++k) ring.push_back(P[kRings[fi][k]]);
        sew.Add(occtFaceFromRing(ring));
    }
    // include the rogue triangle too — OCCT will leave it as a dangling free patch.
    sew.Add(occtFaceFromRing({rogue[0], rogue[1], rogue[2]}));
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    std::printf("      sewer: NbFreeEdges=%d  NbMultipleEdges=%d  NbContigousEdges=%d\n",
                sew.NbFreeEdges(), sew.NbMultipleEdges(), sew.NbContigousEdges());
    // Extract the closed shell (the box) and measure it.
    ShapeFix_Shape fixer(sewn);
    fixer.SetPrecision(tol);
    fixer.Perform();
    TopoDS_Shape fixed = fixer.Shape();
    // find the watertight shell among the result + its volume.
    double ovol = 0.0; bool occtWatertight = false;
    for (TopExp_Explorer ex(fixed, TopAbs_SHELL); ex.More(); ex.Next()) {
        const TopoDS_Shape& sh = ex.Current();
        EdgeStats st = occtEdgeStats(sh);
        if (st.freeEdges == 0 && st.multipleEdges == 0 && st.sharedEdges > 0) {
            occtWatertight = true;
            ovol = std::fabs(occtSignedVolume(sh));
        }
    }
    std::printf("      watertight-shell-found=%s  vol=%.6f\n", occtWatertight ? "yes":"no", ovol);
    const bool occtVolOk = occtWatertight && std::fabs(ovol - L*L*L) <= 1e-6;

    // -------- COMPARE --------
    std::printf("  COMPARE:\n");
    check(r.selfIntersectingFacesRemoved == 1, "selfx: forge dropped exactly 1 interpenetrating sliver");
    check(forgeWatertight && occtWatertight, "selfx: BOTH yield a watertight box shell");
    check(forgeVolOk && occtVolOk,           "selfx: BOTH volume preserved == L^3");
}

// =============================================================================
// CASE [6] — NON-MANIFOLD: box + flap re-using one box edge (3 faces on an edge).
// =============================================================================
static void caseNonManifold() {
    std::printf("[6] NON-MANIFOLD  (3 faces on one edge — flap)\n");
    const double L = 6.0, tol = 1e-6;
    auto P = boxCorners(L);
    const V3 q0{0.0, -L*0.5, L*0.5};
    const V3 q1{L,   -L*0.5, L*0.5};

    // -------- forge native --------
    std::printf("  forge native (Heal pass-8 non-manifold detect+report):\n");
    TopologyBuilder tb;
    std::vector<Face*> faces;
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<Point3> ring;
        for (int k = 0; k < 4; ++k) { auto& q = P[kRings[fi][k]]; ring.push_back({q.x,q.y,q.z}); }
        faces.push_back(faceFromRing(tb, ring));
    }
    // flap re-using box edge (0)->(1) = (0,0,0)->(L,0,0).
    faces.push_back(faceFromRing(tb, {{P[0].x,P[0].y,P[0].z},{P[1].x,P[1].y,P[1].z},
                                      {q1.x,q1.y,q1.z},{q0.x,q0.y,q0.z}}));
    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    std::printf("      dupRemoved=%zu  nmEdgesReported=%zu  nmVerts=%zu  fullyHealed=%s\n",
                r.duplicateFacesRemoved, r.unfixedNonManifoldEdgeReport.size(),
                r.nonManifoldVertexIds.size(), r.fullyHealed() ? "yes":"no");
    const bool forgeReportsUnfixed = !r.fullyHealed() &&
                                     !r.unfixedNonManifoldEdgeReport.empty();

    // -------- OCCT --------
    std::printf("  OCCT (non-manifold sew + ShapeFix — cannot make a valid closed solid):\n");
    // Enable NON-MANIFOLD processing (option4=true) so OCCT actually mates the flap onto
    // the shared box edge and surfaces it as a MULTIPLE (3-face / non-manifold) edge,
    // rather than silently leaving it free — the explicit OCCT analogue of forge's
    // pass-8 "detect the 3-faces-on-an-edge join".
    BRepBuilderAPI_Sewing sew(tol,
                              /*sewing*/ Standard_True,
                              /*analysis*/ Standard_True,
                              /*cutting*/ Standard_True,
                              /*nonManifold*/ Standard_True);
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<V3> ring;
        for (int k = 0; k < 4; ++k) ring.push_back(P[kRings[fi][k]]);
        sew.Add(occtFaceFromRing(ring));
    }
    sew.Add(occtFaceFromRing({P[0], P[1], q1, q0}));   // the flap
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    std::printf("      sewer: NbFreeEdges=%d  NbMultipleEdges=%d  NbContigousEdges=%d\n",
                sew.NbFreeEdges(), sew.NbMultipleEdges(), sew.NbContigousEdges());
    ShapeFix_Shape fixer(sewn);
    fixer.SetPrecision(tol);
    fixer.Perform();
    TopoDS_Shape fixed = fixer.Shape();
    EdgeStats st = occtEdgeStats(fixed);
    // OCCT surfaces the non-manifold join either as a 3+-face (multiple) edge in the
    // sewn/fixed topology OR — when run manifold-only — as residual free edges that
    // keep the shell from closing. EITHER way OCCT cannot make a clean closed 2-manifold
    // solid: the honest "un-resolvable / open" verdict that mirrors forge's report.
    const bool occtHasNonManifold = (st.multipleEdges > 0) || (sew.NbMultipleEdges() > 0);
    const bool occtNotCleanSolid  = !occtClosed(fixed) || occtHasNonManifold;
    std::printf("      fixed: freeEdges=%d sharedEdges=%d multipleEdges=%d  -> clean-closed-solid=%s\n",
                st.freeEdges, st.sharedEdges, st.multipleEdges, (!occtNotCleanSolid) ? "yes":"no");

    // -------- COMPARE --------
    std::printf("  COMPARE:\n");
    check(r.duplicateFacesRemoved == 0,           "nonman: forge did NOT drop the flap (not a duplicate)");
    check(forgeReportsUnfixed,                    "nonman: forge reports the join UNFIXED (not fully healed)");
    check(occtHasNonManifold,                     "nonman: OCCT reports a multiple/non-manifold edge");
    check(occtNotCleanSolid,                      "nonman: OCCT result is NOT a clean closed 2-manifold solid");
    check(forgeReportsUnfixed && occtNotCleanSolid,
          "nonman: BOTH report not-fully-healed / unresolvable (expected)");
}

int main() {
    std::printf("=== A/B: forge native HEAL (pass 6/7/8) vs OCCT ShapeFix_Shape ===\n\n");
    caseOrientation();
    std::printf("\n");
    caseSelfIntersect();
    std::printf("\n");
    caseNonManifold();
    std::printf("\n=== RESULT: %d / %d A/B checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
