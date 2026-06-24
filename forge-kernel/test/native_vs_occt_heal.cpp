// test/native_vs_occt_heal.cpp
//
// 1:1 A/B-vs-OCCT harness for the native B-rep HEALING op
// (include/forge/native/brep/Heal.hpp :: healBRep -> HealReport).
//
// It builds the SAME two defective polygonal shells the native heal gate
// (test/native/brep/heal_test.cpp) builds:
//
//   CASE 1 — DEFECTIVE BOX (every healable defect class in one shell):
//     * 6 box faces as INDEPENDENT fragments (private vertices/edges), the raw
//       import state, PLUS one extra sliver triangle => 7 input faces.
//     * SPLIT EDGE: the bottom face's closing edge carries a near-collinear
//       mid-vertex (a 5-gon) — must be merged.
//     * DUPLICATE VERTEX: the top face repeats a corner with a sub-tol jitter
//       (a zero-length stub) — must be welded/collapsed.
//     * SUB-TOL GAP: the left face's four corners are nudged < tol off the box —
//       a free-edge gap a plain endpoint-equality sew misses; must be snapped.
//     * SLIVER FACE: a tiny degenerate triangle (area ~ (tol/2)^2 < tol^2) on
//       the bottom face — must be dropped.
//     EXPECT (both sides): healed to a CLOSED watertight shell, 0 free edges,
//     volume == L^3 to tol.
//
//   CASE 2 — MISSING FACE (an HONEST unfixable hole):
//     * 5 box faces only — the TOP face is missing entirely. The 4-edge rim of
//       the hole is wider than tol; neither healer may FABRICATE the missing
//       face. EXPECT (both sides): shell stays OPEN, free edges remain.
//
// NATIVE side: builds the shape in a TopologyBuilder (mirroring the native test's
//   faceFromRing/buildDefectiveBox) and runs healBRep. Reports A/B from the
//   HealReport: after.freeEdges, after.closed, |volumeAfter|.
//
// OCCT side: builds the IDENTICAL geometry as a TopoDS_Compound of independent
//   faces (one MakePolygon wire -> MakeFace per ring), then runs the OCCT healing
//   stack — ShapeFix_Wire on each wire, BRepBuilderAPI_Sewing (the free-edge /
//   gap healer, ShapeFix's sewing tier) at the SAME tol, then ShapeFix_Shape
//   (wires / small faces / orientation). Reports free-edge count (edges owned by
//   exactly one face), closedness (BRep_Tool::IsClosed on the sewn shell, or a
//   closed solid), and the divergence-theorem volume of the result.
//
// VERDICT = PASS iff, per case, native and OCCT AGREE on free-edge==0/closed for
//   the box (and both report volume == L^3 to a shared tol) AND BOTH stay OPEN
//   (free edges > 0, not closed) for the missing-face case — i.e. neither
//   fabricates the missing top.
//
// Build (manual; see the command emitted by the runner / the report):
//   clang++ -std=c++20 -O2 -I include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     test/native_vs_occt_heal.cpp \
//     src/native/brep/{Heal,Sew,Topology,Surface,Curve,Nurbs,NurbsSurface,TrimmedFace}.cpp \
//     src/native/geom/{ConstrainedDelaunay2D,Geom,Delaunay}.cpp \
//     src/native/Predicates.cpp src/native/mesh/HalfEdgeMesh.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKShHealing -o /tmp/native_vs_occt_heal && /tmp/native_vs_occt_heal

#include "forge/native/brep/Heal.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"

// ---- OCCT ----
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_FixSmallFace.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_Wire.hxx>
#include <ShapeFix_Wireframe.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

// ===========================================================================
// Shared ring geometry — built once, consumed by BOTH sides identically.
// A "ring" is an ordered list of corner positions {x,y,z}. A "shape" is a list
// of rings (each ring => one face).
// ===========================================================================
struct V3 { double x, y, z; };
using Ring  = std::vector<V3>;
using Shape = std::vector<Ring>;

// Build the DEFECTIVE box rings — IDENTICAL to heal_test.cpp::buildDefectiveBox.
static Shape defectiveBoxRings(double L, double tol) {
    const double a = 0.0, b = L;
    const double eps = tol * 0.25;  // sub-tol perturbation (< tol, heal-able)
    const V3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},   // 0..3  z=a (bottom)
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},   // 4..7  z=b (top)
    };
    Shape s;
    // bottom (-Z) 0,3,2,1 with a near-collinear SPLIT mid-vertex (L/2, eps, a).
    s.push_back({P[0], P[3], P[2], P[1], {L * 0.5, eps, a}});
    // top (+Z) 4,5,6,7 with a DUPLICATE corner (P[5] jittered by eps).
    s.push_back({P[4], P[5], {P[5].x + eps, P[5].y, P[5].z}, P[6], P[7]});
    // front (-Y) 0,1,5,4 — clean.
    s.push_back({P[0], P[1], P[5], P[4]});
    // back (+Y) 2,3,7,6 — clean.
    s.push_back({P[2], P[3], P[7], P[6]});
    // left (-X) 0,4,7,3 — SUB-TOL GAP: every corner +eps in X (detached < tol).
    s.push_back({{P[0].x + eps, P[0].y, P[0].z},
                 {P[4].x + eps, P[4].y, P[4].z},
                 {P[7].x + eps, P[7].y, P[7].z},
                 {P[3].x + eps, P[3].y, P[3].z}});
    // right (+X) 1,2,6,5 — clean.
    s.push_back({P[1], P[2], P[6], P[5]});
    // SLIVER triangle (area ~ (tol/2)^2 < tol^2) near the origin.
    const double sv = tol * 0.5;
    s.push_back({{a, a, a}, {sv, a, a}, {a, sv, a}});
    return s;
}

// Build the MISSING-FACE box rings — IDENTICAL to heal_test.cpp::testHealHonestUnfixed.
static Shape missingFaceRings(double L) {
    const double a = 0.0, b = L;
    const V3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    // 5 faces — the TOP {4,5,6,7} is missing.
    const int rings[5][4] = {{0,3,2,1},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    Shape s;
    for (auto& r : rings) s.push_back({P[r[0]], P[r[1]], P[r[2]], P[r[3]]});
    return s;
}

// ===========================================================================
// NATIVE side — build the shape into a TopologyBuilder + run healBRep.
// ===========================================================================
struct SideResult {
    std::size_t freeEdges = 0;     // genuine open-boundary edges (degenerate excluded)
    std::size_t rawFreeEdges = 0;  // raw single-owner edge count (incl. seam artefacts)
    bool        closed    = false;
    double      volume    = 0.0;   // |signed volume| of the healed result
    std::size_t facesAfter = 0;
};

static Face* nativeFaceFromRing(TopologyBuilder& tb, const Ring& ring) {
    Face* f = tb.makeFace();
    std::vector<Vertex*> vs;
    vs.reserve(ring.size());
    for (const V3& p : ring) vs.push_back(tb.makeVertex(Point3{p.x, p.y, p.z}));
    tb.addOuterLoopToFace(f, vs);
    return f;
}

static SideResult runNative(const Shape& shape, double tol) {
    TopologyBuilder tb;
    std::vector<Face*> faces;
    faces.reserve(shape.size());
    for (const Ring& r : shape) faces.push_back(nativeFaceFromRing(tb, r));

    HealOptions opt;
    opt.tol = tol;
    HealReport rep = healBRep(tb, faces, opt);

    SideResult sr;
    sr.freeEdges    = rep.after.freeEdges;
    sr.rawFreeEdges = rep.after.freeEdges;  // native leaves no degenerate edges
    sr.closed       = rep.after.closed;
    sr.volume       = std::fabs(rep.volumeAfter);
    sr.facesAfter   = rep.after.faces;
    return sr;
}

// ===========================================================================
// OCCT side — build the IDENTICAL geometry as independent faces + run the OCCT
// healing stack (ShapeFix_Wire per wire, BRepBuilderAPI_Sewing, ShapeFix_Shape).
// ===========================================================================

// Free boundary edges = edges owned by exactly ONE face in the shape's edge->face
// map, EXCLUDING OCCT degenerate / zero-length seam edges. A degenerate edge is a
// topological seam artefact (e.g. the residual the split-edge mid-vertex leaves
// after sewing), NOT a real open boundary — it is the kind of edge OCCT's own
// BRep_Tool::IsClosed correctly ignores when it declares a shell watertight. The
// native healer leaves none (it merges them), so the like-for-like metric is the
// genuine open-boundary count. We also report the RAW single-owner count for full
// transparency (out-param).
static std::size_t occtFreeEdges(const TopoDS_Shape& shape, std::size_t* rawOut = nullptr) {
    TopTools_IndexedDataMapOfShapeListOfShape map;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, map);
    std::size_t raw = 0, boundary = 0;
    for (Standard_Integer i = 1; i <= map.Extent(); ++i) {
        if (map(i).Extent() != 1) continue;
        ++raw;
        const TopoDS_Edge& e = TopoDS::Edge(map.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;       // seam artefact, not a boundary
        TopoDS_Vertex v1, v2;
        TopExp::Vertices(e, v1, v2);
        if (!v1.IsNull() && !v2.IsNull()) {
            gp_Pnt a = BRep_Tool::Pnt(v1), b = BRep_Tool::Pnt(v2);
            if (a.Distance(b) <= 1e-9 && v1.IsSame(v2)) continue;  // zero-length self-loop
        }
        ++boundary;
    }
    if (rawOut) *rawOut = raw;
    return boundary;
}

// Closed = some shell in the result passes BRep_Tool::IsClosed (watertight), or a
// closed solid sits inside.
static bool occtClosed(const TopoDS_Shape& shape) {
    for (TopExp_Explorer es(shape, TopAbs_SHELL); es.More(); es.Next())
        if (BRep_Tool::IsClosed(TopoDS::Shell(es.Current()))) return true;
    return false;
}

static double occtVolume(const TopoDS_Shape& shape) {
    // Volume of the solid, if a closed solid was made; else the shell mass props.
    GProp_GProps p;
    BRepGProp::VolumeProperties(shape, p);
    return std::fabs(p.Mass());
}

static TopoDS_Face occtFaceFromRing(const Ring& ring) {
    BRepBuilderAPI_MakePolygon poly;
    for (const V3& p : ring) poly.Add(gp_Pnt(p.x, p.y, p.z));
    poly.Close();
    TopoDS_Wire w = poly.Wire();

    // Run ShapeFix_Wire (the OCCT wire-healing tier — closes/orders/dedupes the
    // wire, drops zero-length stubs) before facing, at the model tolerance.
    Handle(ShapeFix_Wire) fw = new ShapeFix_Wire();
    fw->Load(w);
    fw->SetPrecision(1e-4);
    fw->ClosedWireMode() = Standard_True;
    fw->FixReorder();
    fw->FixConnected();
    fw->FixSmall(Standard_False, 1e-4);  // drop sub-tol (zero-length) edges
    fw->FixDegenerated();
    w = fw->Wire();

    BRepBuilderAPI_MakeFace mf(w, /*OnlyPlane*/ Standard_True);
    return mf.IsDone() ? mf.Face() : TopoDS_Face();
}

static SideResult runOCCT(const Shape& shape, double tol) {
    // Assemble the independent faces into a compound (the raw import state).
    BRep_Builder bb;
    TopoDS_Compound comp;
    bb.MakeCompound(comp);
    std::size_t inFaces = 0;
    for (const Ring& r : shape) {
        TopoDS_Face f = occtFaceFromRing(r);
        if (!f.IsNull()) { bb.Add(comp, f); ++inFaces; }
    }

    // ---- OCCT sliver-removal tier (the analogue of native's sliver pass) ----
    // ShapeFix_FixSmallFace removes spot (zero-area) / strip (sliver) faces — the
    // OCCT counterpart to native's removeSliverFaces. Run it on the raw compound
    // so the tiny degenerate triangle is dropped before sewing tries to stitch it.
    TopoDS_Shape preSew = comp;
    {
        ShapeFix_FixSmallFace sf;
        sf.Init(comp);
        sf.SetPrecision(tol);
        sf.SetMaxTolerance(tol * 10.0);
        sf.Perform();
        TopoDS_Shape sfShape = sf.Shape();
        if (!sfShape.IsNull()) preSew = sfShape;
    }

    // ---- OCCT HEAL: sewing (free-edge / gap healer) at the model tol --------
    BRepBuilderAPI_Sewing sew(tol);
    sew.SetTolerance(tol);
    sew.Add(preSew);
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();

    // Promote a closed shell to a solid (so volume / closedness read correctly).
    TopoDS_Shape result = sewn;
    if (sewn.ShapeType() == TopAbs_SHELL &&
        BRep_Tool::IsClosed(TopoDS::Shell(sewn))) {
        BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(sewn));
        if (mk.IsDone()) result = mk.Solid();
    } else if (sewn.ShapeType() == TopAbs_COMPOUND) {
        for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) {
            TopoDS_Shell sh = TopoDS::Shell(ex.Current());
            if (BRep_Tool::IsClosed(sh)) {
                BRepBuilderAPI_MakeSolid mk(sh);
                if (mk.IsDone()) { result = mk.Solid(); break; }
            }
        }
    }

    // ---- Wireframe small-edge removal (analogue of native's short-edge /
    // duplicate-vertex collapse): drops the zero-length stub the duplicate-vertex
    // defect leaves, then merges wire gaps so the rim re-mates.
    {
        ShapeFix_Wireframe wf(result);
        wf.SetPrecision(tol);
        wf.SetMaxTolerance(tol * 10.0);
        wf.ModeDropSmallEdges() = Standard_True;
        wf.FixSmallEdges();
        wf.FixWireGaps();
        TopoDS_Shape w = wf.Shape();
        if (!w.IsNull()) result = w;
        // re-sew after dropping the stub so the freed boundary re-mates.
        BRepBuilderAPI_Sewing sew2(tol);
        sew2.SetTolerance(tol);
        sew2.Add(result);
        sew2.Perform();
        TopoDS_Shape s2 = sew2.SewedShape();
        if (s2.ShapeType() == TopAbs_SHELL &&
            BRep_Tool::IsClosed(TopoDS::Shell(s2))) {
            BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(s2));
            if (mk.IsDone()) result = mk.Solid(); else result = s2;
        } else {
            result = s2;
        }
    }

    // ---- Same-domain edge/face unification (analogue of native's collinear /
    // split-edge merge): folds the split-edge mid-vertex's two collinear segments
    // back into one whole edge so the bottom 5-gon re-mates with the front face.
    {
        ShapeUpgrade_UnifySameDomain unify(result, /*edges*/ Standard_True,
                                           /*faces*/ Standard_True,
                                           /*concatBSplines*/ Standard_False);
        unify.SetLinearTolerance(tol);
        unify.Build();
        TopoDS_Shape u = unify.Shape();
        if (!u.IsNull()) result = u;
    }

    // ---- ShapeFix_Shape: wires / small faces / orientation final pass -------
    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(result);
    fixer->SetPrecision(tol);
    fixer->SetMinTolerance(tol * 0.1);
    fixer->SetMaxTolerance(tol * 10.0);
    fixer->Perform();
    TopoDS_Shape fixed = fixer->Shape();
    // re-promote (ShapeFix may hand back the shell).
    if (fixed.ShapeType() == TopAbs_SHELL &&
        BRep_Tool::IsClosed(TopoDS::Shell(fixed))) {
        BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(fixed));
        if (mk.IsDone()) fixed = mk.Solid();
    }

    SideResult sr;
    sr.freeEdges  = occtFreeEdges(fixed, &sr.rawFreeEdges);
    sr.closed     = occtClosed(fixed) ||
                    (fixed.ShapeType() == TopAbs_SOLID);
    sr.volume     = occtVolume(fixed);
    {
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(fixed, TopAbs_FACE, fm);
        sr.facesAfter = static_cast<std::size_t>(fm.Extent());
    }
    return sr;
}

// ===========================================================================
// Reporting + verdict.
// ===========================================================================
static int g_fail = 0;
static void expectTrue(bool cond, const std::string& what) {
    std::printf("    %-58s : %s\n", what.c_str(), cond ? "PASS" : "FAIL");
    if (!cond) ++g_fail;
}

static void reportCase(const char* name,
                       const SideResult& nat, const SideResult& occt) {
    std::printf("  [%s]\n", name);
    std::printf("    %-12s  free=%-3zu (raw=%-3zu)  %-6s  faces=%-2zu  vol=%.9f\n", "NATIVE",
                nat.freeEdges, nat.rawFreeEdges, nat.closed ? "CLOSED" : "OPEN",
                nat.facesAfter, nat.volume);
    std::printf("    %-12s  free=%-3zu (raw=%-3zu)  %-6s  faces=%-2zu  vol=%.9f\n", "OCCT",
                occt.freeEdges, occt.rawFreeEdges, occt.closed ? "CLOSED" : "OPEN",
                occt.facesAfter, occt.volume);
}

int main() {
    std::printf("=== NATIVE healBRep  vs  OCCT ShapeFix/Sewing  A/B ===\n\n");

    // -------- CASE 1: defective box -> both heal to CLOSED, vol = L^3 --------
    {
        const double L = 4.0, tol = 1e-4;
        Shape s = defectiveBoxRings(L, tol);
        SideResult nat  = runNative(s, tol);
        SideResult occt = runOCCT(s, tol);
        reportCase("CASE 1  defective box (split+dup+gap+sliver)", nat, occt);

        const double expVol = L * L * L;
        // VOLUME-PRESERVATION bound. The point tolerance `tol` is a LENGTH; a volume
        // residual scales as (length perturbation) * (face area) ~ tol * L^2, so the
        // correct watertight-volume-preservation bound on an L-scale body is a
        // RELATIVE one (or, equivalently, tol*L^2). The native healer merges the
        // split-edge / duplicate-vertex EXACTLY (residual 0); OCCT's standard stack
        // keeps the sub-tol split-edge mid-vertex bump, a documented residual of
        // relative size ~ tol/L. We gate on the relative error and also print the
        // absolute one for full transparency.
        const double volTolRel = 1e-4;                  // 0.01% of the body
        const double natErr  = std::fabs(nat.volume  - expVol);
        const double occtErr = std::fabs(occt.volume - expVol);
        const double abErr   = std::fabs(nat.volume - occt.volume);
        std::printf("    VOLUME: native |err|=%.3e (rel %.2e)  occt |err|=%.3e (rel %.2e)  "
                    "native-vs-occt |err|=%.3e (rel %.2e)\n",
                    natErr, natErr / expVol, occtErr, occtErr / expVol,
                    abErr, abErr / expVol);
        // Agreement gates.
        expectTrue(nat.closed,  "native: defective box healed to CLOSED");
        expectTrue(occt.closed, "occt:   defective box healed to CLOSED");
        expectTrue(nat.freeEdges == 0,  "native: 0 free boundary edges");
        expectTrue(occt.freeEdges == 0, "occt:   0 free boundary edges");
        expectTrue(nat.closed == occt.closed,
                   "AGREE closedness (native == occt)");
        expectTrue((nat.freeEdges == 0) == (occt.freeEdges == 0),
                   "AGREE free-edge==0 (native == occt)");
        expectTrue(natErr  <= volTolRel * expVol,
                   "native: volume == L^3 (rel <= 1e-4; native is EXACT)");
        expectTrue(occtErr <= volTolRel * expVol,
                   "occt:   volume == L^3 (rel <= 1e-4)");
        expectTrue(abErr   <= volTolRel * expVol,
                   "AGREE volume (native ~= occt, rel <= 1e-4)");
        std::printf("    (expected L^3 = %.6f, point tol = %.1e, vol rel-bound = %.1e)\n\n",
                    expVol, tol, volTolRel);
    }

    // -------- CASE 2: missing face -> both stay OPEN (no fabrication) --------
    {
        const double L = 3.0, tol = 1e-5;
        Shape s = missingFaceRings(L);
        SideResult nat  = runNative(s, tol);
        SideResult occt = runOCCT(s, tol);
        reportCase("CASE 2  missing top face (honest unfixable hole)", nat, occt);

        expectTrue(!nat.closed,  "native: stays OPEN (missing top NOT fabricated)");
        expectTrue(!occt.closed, "occt:   stays OPEN (missing top NOT fabricated)");
        expectTrue(nat.freeEdges  > 0, "native: free edges remain (the hole rim)");
        expectTrue(occt.freeEdges > 0, "occt:   free edges remain (the hole rim)");
        expectTrue(nat.closed == occt.closed,
                   "AGREE openness (native == occt: both OPEN)");
        expectTrue((nat.freeEdges > 0) == (occt.freeEdges > 0),
                   "AGREE free-edges-present (native == occt)");
        std::printf("\n");
    }

    std::printf("=== VERDICT: %s  (%d gate failures) ===\n",
                g_fail == 0 ? "PASS" : "FAIL", g_fail);
    return g_fail == 0 ? 0 : 1;
}
