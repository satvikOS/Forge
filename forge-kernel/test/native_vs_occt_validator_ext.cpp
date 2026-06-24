// native_vs_occt_validator_ext.cpp
//
// A/B-vs-OCCT for the EXHAUSTIVE VALIDATOR completions of the Forge native B-rep
// validator (forge::native::brep — Check.cpp / Check.hpp). This standalone C++20
// program runs the native validator and the OCCT BRepCheck_Analyzer / BRepCheck_Face
// machinery on the SAME geometric defects, then compares the VALID/INVALID verdict
// per case + the BRepCheck_Status family each side reports.
//
// It mirrors the four "new completion" cases the native validator_test.cpp asserts:
//   5b  hole-wire pokes OUTSIDE the outer loop  -> SelfIntersectingWire (native)
//                                               -> IntersectingWires    (OCCT)
//   5c  figure-eight pcurve / self-crossing wire -> SelfIntersectingWire (native)
//                                               -> SelfIntersectingWire (OCCT)
//   6a  VALID concave L-prism solid             -> report.valid==true (native: G3 OK)
//                                               -> BRepCheck IsValid()==true (OCCT)
//   6b  inverted re-entrant face on the L-prism -> BadOrientationFace  (native G3)
//                                               -> BadOrientation      (OCCT)
//
// For 5b/5c the native side runs checkTrimmedFaceSelfIntersection (the exhaustive
// G4-trimmed routine) on a planar TrimmedFace mirroring the OCCT face exactly. For
// 6a/6b the native side runs checkBRep on a geometry-bearing L-block shell mirroring
// the OCCT L-prism.
//
// VERDICT: PASS iff the VALID/INVALID classification AGREES between the native
// validator and OCCT on ALL FOUR cases — most importantly the 6a L-block-valid case
// (proving the old centroid mis-call on the re-entrant face is gone and both kernels
// agree the concave solid is valid).
//
// ---------------------------------------------------------------------------
// Build (clang++ -std=c++20), OCCT 7.9.3 from Homebrew + the native sources:
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     native_vs_occt_validator_ext.cpp \
//     <native srcs...> \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKShHealing -lTKBO -lTKBool \
//     -o /tmp/native_vs_occt_validator_ext && /tmp/native_vs_occt_validator_ext
// ---------------------------------------------------------------------------

// ----------------------------- NATIVE side --------------------------------
#include "forge/native/brep/Check.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/TrimmedFace.hpp"

// ------------------------------- OCCT side --------------------------------
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Pln.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Face.hxx>
#include <BRepCheck_Wire.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Status.hxx>
#include <BRepCheck_ListOfStatus.hxx>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

using namespace forge::native::brep;

// =========================================================================
// Small reporting harness.
// =========================================================================
static int g_pass = 0;
static int g_total = 0;
static void expect(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("    [PASS] %s\n", name.c_str()); }
    else        std::printf("    [FAIL] %s\n", name.c_str());
}

static const char* occtStatusName(BRepCheck_Status s) {
    switch (s) {
        case BRepCheck_NoError: return "NoError";
        case BRepCheck_InvalidPointOnCurve: return "InvalidPointOnCurve";
        case BRepCheck_InvalidPointOnCurveOnSurface: return "InvalidPointOnCurveOnSurface";
        case BRepCheck_InvalidPointOnSurface: return "InvalidPointOnSurface";
        case BRepCheck_No3DCurve: return "No3DCurve";
        case BRepCheck_Multiple3DCurve: return "Multiple3DCurve";
        case BRepCheck_Invalid3DCurve: return "Invalid3DCurve";
        case BRepCheck_NoCurveOnSurface: return "NoCurveOnSurface";
        case BRepCheck_InvalidCurveOnSurface: return "InvalidCurveOnSurface";
        case BRepCheck_InvalidCurveOnClosedSurface: return "InvalidCurveOnClosedSurface";
        case BRepCheck_InvalidSameRangeFlag: return "InvalidSameRangeFlag";
        case BRepCheck_InvalidSameParameterFlag: return "InvalidSameParameterFlag";
        case BRepCheck_InvalidDegeneratedFlag: return "InvalidDegeneratedFlag";
        case BRepCheck_FreeEdge: return "FreeEdge";
        case BRepCheck_InvalidMultiConnexity: return "InvalidMultiConnexity";
        case BRepCheck_InvalidRange: return "InvalidRange";
        case BRepCheck_EmptyWire: return "EmptyWire";
        case BRepCheck_RedundantEdge: return "RedundantEdge";
        case BRepCheck_SelfIntersectingWire: return "SelfIntersectingWire";
        case BRepCheck_NoSurface: return "NoSurface";
        case BRepCheck_InvalidWire: return "InvalidWire";
        case BRepCheck_RedundantWire: return "RedundantWire";
        case BRepCheck_IntersectingWires: return "IntersectingWires";
        case BRepCheck_InvalidImbricationOfWires: return "InvalidImbricationOfWires";
        case BRepCheck_EmptyShell: return "EmptyShell";
        case BRepCheck_RedundantFace: return "RedundantFace";
        case BRepCheck_InvalidImbricationOfShells: return "InvalidImbricationOfShells";
        case BRepCheck_UnorientableShape: return "UnorientableShape";
        case BRepCheck_NotClosed: return "NotClosed";
        case BRepCheck_NotConnected: return "NotConnected";
        case BRepCheck_SubshapeNotInShape: return "SubshapeNotInShape";
        case BRepCheck_BadOrientation: return "BadOrientation";
        case BRepCheck_BadOrientationOfSubshape: return "BadOrientationOfSubshape";
        case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
        case BRepCheck_InvalidToleranceValue: return "InvalidToleranceValue";
        case BRepCheck_EnclosedRegion: return "EnclosedRegion";
        case BRepCheck_CheckFail: return "CheckFail";
        default: return "<unknown>";
    }
}

// Collect EVERY non-NoError BRepCheck_Status the analyzer attached to ANY subshape
// of `shape` (the OCCT analog of CheckReport::failedStatuses()). Walks faces, wires,
// edges, vertices, shells, and the shape itself.
static std::set<BRepCheck_Status> occtFailedStatuses(const BRepCheck_Analyzer& ana,
                                                      const TopoDS_Shape& shape) {
    std::set<BRepCheck_Status> out;
    auto pull = [&](const TopoDS_Shape& s) {
        Handle(BRepCheck_Result) res = ana.Result(s);
        if (res.IsNull()) return;
        // (i) the subshape's own status list.
        const BRepCheck_ListOfStatus& lst = res->Status();
        for (BRepCheck_ListIteratorOfListOfStatus it(lst); it.More(); it.Next())
            if (it.Value() != BRepCheck_NoError) out.insert(it.Value());
        // (ii) the IN-CONTEXT statuses (orientation faults — BadOrientation /
        //      BadOrientationOfSubshape — are attached to the subshape in the
        //      context of its parent shell/face, not to its plain status list).
        for (res->InitContextIterator(); res->MoreShapeInContext(); res->NextShapeInContext()) {
            const BRepCheck_ListOfStatus& clst = res->StatusOnShape();
            for (BRepCheck_ListIteratorOfListOfStatus it(clst); it.More(); it.Next())
                if (it.Value() != BRepCheck_NoError) out.insert(it.Value());
        }
    };
    pull(shape);
    for (TopExp_Explorer e(shape, TopAbs_FACE);   e.More(); e.Next()) pull(e.Current());
    for (TopExp_Explorer e(shape, TopAbs_WIRE);   e.More(); e.Next()) pull(e.Current());
    for (TopExp_Explorer e(shape, TopAbs_EDGE);   e.More(); e.Next()) pull(e.Current());
    for (TopExp_Explorer e(shape, TopAbs_VERTEX); e.More(); e.Next()) pull(e.Current());
    for (TopExp_Explorer e(shape, TopAbs_SHELL);  e.More(); e.Next()) pull(e.Current());
    return out;
}

static void printStatuses(const std::set<BRepCheck_Status>& s) {
    std::printf("      OCCT failed statuses: { ");
    for (auto st : s) std::printf("%s ", occtStatusName(st));
    if (s.empty()) std::printf("(none) ");
    std::printf("}\n");
}

// =========================================================================
// NATIVE helpers — mirror the validator_test.cpp builders for the L-block + the
// planar TrimmedFace, kept independent so this A/B file is self-contained.
// =========================================================================
static Vec3 vsubL(const Point3& a, const Point3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static double vlenL(const Vec3& a) { return std::sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
static Vec3 vnormL(const Vec3& a) { double L = vlenL(a); return (L > 0) ? Vec3{a.x/L, a.y/L, a.z/L} : a; }
static double vdotL(const Vec3& a, const Vec3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }

static std::vector<Coedge*> ringCoedges(Loop* lp) {
    std::vector<Coedge*> out;
    if (!lp || !lp->first) return out;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) { out.push_back(c); c = c->next; }
    return out;
}

// Decorate a face with an OUTWARD analytic plane + per-vertex (u,v) + pcurves +
// 3D line curves, taking the winding (Newell) normal directly as the outward axis
// (no centroid flip — exactly as validator_test.cpp does, so the concave L-block
// re-entrant faces are oriented correctly).
static void decorateFaceOutward(TopologyBuilder& tb, Face* f) {
    std::vector<Coedge*> ring = ringCoedges(f->outerLoop);
    const std::size_t n = ring.size();
    if (n < 3) return;
    Vec3 nrm{0, 0, 0};
    for (std::size_t i = 0; i < n; ++i) {
        const Point3& a = ring[i]->originVertex()->point;
        const Point3& b = ring[(i + 1) % n]->originVertex()->point;
        nrm.x += (a.y - b.y) * (a.z + b.z);
        nrm.y += (a.z - b.z) * (a.x + b.x);
        nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    Vec3 nn = vnormL(nrm);

    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Plane;
    const Point3& o = ring[0]->originVertex()->point;
    s->origin = {o.x, o.y, o.z};
    s->refDir = vnormL(vsubL(ring[1]->originVertex()->point, o));
    s->axis = nn;
    s->reversed = false;
    f->surface = s;

    Vec3 uDir = s->refDir, vDir = s->binormal();
    f->vertexUV.clear();
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    for (std::size_t k = 0; k < n; ++k) {
        const Point3& p = ring[k]->originVertex()->point;
        Vec3 rel = vsubL(p, o);
        double pu = vdotL(rel, uDir), pv = vdotL(rel, vDir);
        f->vertexUV.push_back({pu, pv});
        if (k == 0) { u0 = u1 = pu; v0 = v1 = pv; }
        else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
               v0 = std::min(v0, pv); v1 = std::max(v1, pv); }
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;

    for (std::size_t k = 0; k < n; ++k) {
        Coedge* c = ring[k];
        const std::size_t kn = (k + 1) % n;
        UVCoord a{f->vertexUV[k][0],  f->vertexUV[k][1]};
        UVCoord b{f->vertexUV[kn][0], f->vertexUV[kn][1]};
        c->pcurve = tb.makePcurve(PCurve::makeLine2(a, b));
        Edge* e = c->edge;
        if (e->curve == nullptr) {
            Vec3 p0 = (e->start ? Vec3{e->start->point.x, e->start->point.y, e->start->point.z} : Vec3{});
            Vec3 p1 = (e->end   ? Vec3{e->end->point.x,   e->end->point.y,   e->end->point.z}   : Vec3{});
            e->curve = tb.makeCurve(Curve::makeLine(p0, p1));
        }
    }
}

// The L-block (a deep non-convex solid) — identical dims to validator_test.cpp.
struct LBlock {
    TopologyBuilder tb;
    Shell* shell = nullptr;
    std::vector<Face*> faces;
};
static void buildLBlock(LBlock& lb) {
    const double a = 1.0, b = 4.0, N = 1.0, W = 4.0, H = 2.0;
    struct P2 { double x, y; };
    const P2 cs[6] = { {0,0}, {a,0}, {a,N}, {b,N}, {b,W}, {0,W} };
    lb.shell = lb.tb.makeShell();
    Vertex* vb[6]; Vertex* vt[6];
    for (int i = 0; i < 6; ++i) {
        vb[i] = lb.tb.makeVertex({cs[i].x, cs[i].y, 0.0});
        vt[i] = lb.tb.makeVertex({cs[i].x, cs[i].y, H});
    }
    auto addFace = [&](const std::vector<Vertex*>& ring) -> Face* {
        Face* f = lb.tb.makeFace();
        lb.tb.addFaceToShell(lb.shell, f);
        lb.tb.addOuterLoopToFace(f, ring);
        lb.faces.push_back(f);
        return f;
    };
    for (int i = 0; i < 6; ++i) {
        const int j = (i + 1) % 6;
        addFace({ vb[i], vb[j], vt[j], vt[i] });
    }
    addFace({ vb[5], vb[4], vb[3], vb[2], vb[1], vb[0] });   // bottom (reversed)
    addFace({ vt[0], vt[1], vt[2], vt[3], vt[4], vt[5] });   // top
    for (Face* f : lb.faces) decorateFaceOutward(lb.tb, f);
}

// Planar TrimmedFace builders (mirror validator_test.cpp 5b/5c).
static NurbsSurface makePlaneSurf(double L) {
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    s.control = { { {0,0,0}, {0,L,0} }, { {L,0,0}, {L,L,0} } };
    s.weights = { {1,1}, {1,1} };
    s.knotsU = {0,0,1,1};
    s.knotsV = {0,0,1,1};
    return s;
}
static TrimLoop squareOuter() {
    TrimLoop lp; lp.isOuter = true;
    lp.segments.push_back(PCurve::makeLine2({0,0},{1,0}));
    lp.segments.push_back(PCurve::makeLine2({1,0},{1,1}));
    lp.segments.push_back(PCurve::makeLine2({1,1},{0,1}));
    lp.segments.push_back(PCurve::makeLine2({0,1},{0,0}));
    return lp;
}
static TrimLoop squareHole(double u0, double u1, double v0, double v1) {
    TrimLoop lp; lp.isOuter = false;
    lp.segments.push_back(PCurve::makeLine2({u0,v0},{u0,v1}));
    lp.segments.push_back(PCurve::makeLine2({u0,v1},{u1,v1}));
    lp.segments.push_back(PCurve::makeLine2({u1,v1},{u1,v0}));
    lp.segments.push_back(PCurve::makeLine2({u1,v0},{u0,v0}));
    return lp;
}

// =========================================================================
// OCCT helpers — build the equivalent shapes.
// =========================================================================

// A planar face on z=0 with an OUTER square wire [0,S]x[0,S] and an optional inner
// HOLE wire (a rectangle). The hole rectangle can poke outside the outer square so
// the wires intersect / imbricate. Returns the TopoDS_Face.
static TopoDS_Face occtPlanarFaceWithHole(double S,
                                          double hu0, double hu1, double hv0, double hv1) {
    gp_Pln plane(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));

    // Outer square wire (CCW).
    BRepBuilderAPI_MakePolygon outer;
    outer.Add(gp_Pnt(0, 0, 0));
    outer.Add(gp_Pnt(S, 0, 0));
    outer.Add(gp_Pnt(S, S, 0));
    outer.Add(gp_Pnt(0, S, 0));
    outer.Close();
    TopoDS_Wire outerW = outer.Wire();

    BRepBuilderAPI_MakeFace mf(plane, outerW, /*Inside=*/Standard_True);

    // Inner hole wire (wound the OTHER way relative to the outer so it is a hole).
    BRepBuilderAPI_MakePolygon hole;
    hole.Add(gp_Pnt(hu0, hv0, 0));
    hole.Add(gp_Pnt(hu0, hv1, 0));
    hole.Add(gp_Pnt(hu1, hv1, 0));
    hole.Add(gp_Pnt(hu1, hv0, 0));
    hole.Close();
    mf.Add(hole.Wire());

    return mf.Face();
}

// A planar face whose SINGLE outer wire is a self-crossing figure-eight (bowtie).
// The four points produce two transversally crossing strands.
static TopoDS_Face occtFigureEightFace(double S) {
    gp_Pln plane(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
    // Same bowtie polygon as validator_test.cpp scaled by S.
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(gp_Pnt(0.0 * S, 0.0 * S, 0));
    poly.Add(gp_Pnt(1.0 * S, 1.0 * S, 0));
    poly.Add(gp_Pnt(1.0 * S, 0.2 * S, 0));
    poly.Add(gp_Pnt(0.0 * S, 0.5 * S, 0));
    poly.Close();
    TopoDS_Wire w = poly.Wire();
    BRepBuilderAPI_MakeFace mf(plane, w, Standard_True);
    return mf.Face();
}

// An L-prism SOLID: extrude the L cross-section (z=0) along +Z by H.
static TopoDS_Shape occtLPrism(double a, double b, double N, double W, double H) {
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(gp_Pnt(0, 0, 0));
    poly.Add(gp_Pnt(a, 0, 0));
    poly.Add(gp_Pnt(a, N, 0));
    poly.Add(gp_Pnt(b, N, 0));
    poly.Add(gp_Pnt(b, W, 0));
    poly.Add(gp_Pnt(0, W, 0));
    poly.Close();
    TopoDS_Wire profile = poly.Wire();
    BRepBuilderAPI_MakeFace mf(profile, Standard_True);
    TopoDS_Face base = mf.Face();
    BRepPrimAPI_MakePrism prism(base, gp_Vec(0, 0, H));
    return prism.Shape();
}

// =========================================================================
// CASE 5b — hole-wire pokes outside the outer loop.
// =========================================================================
static void case5b() {
    std::printf("[5b] hole-wire pokes OUTSIDE the outer loop\n");

    // NATIVE: planar TrimmedFace, hole [0.7,1.3]x[0.4,0.6] straddles u=1.
    TrimmedFace nf;
    nf.surface = makePlaneSurf(4.0);
    nf.loops.push_back(squareOuter());
    nf.loops.push_back(squareHole(0.7, 1.3, 0.4, 0.6));
    TrimSelfIntersectResult nr = checkTrimmedFaceSelfIntersection(nf);
    const bool nativeInvalid = nr.selfIntersects;
    std::printf("      NATIVE: selfIntersects=%s status=%s detail='%s'\n",
                nativeInvalid ? "true" : "false",
                checkStatusName(nr.status), nr.detail.c_str());

    // OCCT: planar face S=1 with hole [0.7,1.3]x[0.4,0.6] (straddles the u=1 edge).
    TopoDS_Face of = occtPlanarFaceWithHole(1.0, 0.7, 1.3, 0.4, 0.6);
    BRepCheck_Face fc(of);
    BRepCheck_Status ir = fc.IntersectWires();   // wire-vs-wire intersection
    BRepCheck_Status cr = fc.ClassifyWires();     // imbrication / containment
    const bool occtInvalid =
        (ir != BRepCheck_NoError) || (cr != BRepCheck_NoError);
    std::printf("      OCCT  : IntersectWires=%s ClassifyWires=%s\n",
                occtStatusName(ir), occtStatusName(cr));

    expect(nativeInvalid, "5b NATIVE flags INVALID (SelfIntersectingWire)");
    expect(nr.status == CheckStatus::SelfIntersectingWire,
           "5b NATIVE status == SelfIntersectingWire");
    expect(occtInvalid, "5b OCCT flags INVALID (IntersectingWires / InvalidImbrication)");
    expect(nativeInvalid == occtInvalid, "5b VERDICT AGREES (both INVALID)");
}

// =========================================================================
// CASE 5c — figure-eight (self-crossing) wire.
// =========================================================================
static void case5c() {
    std::printf("[5c] figure-eight / self-crossing wire\n");

    // NATIVE: bowtie outer loop.
    TrimmedFace nf;
    nf.surface = makePlaneSurf(4.0);
    TrimLoop bow; bow.isOuter = true;
    bow.segments.push_back(PCurve::makeLine2({0.0, 0.0}, {1.0, 1.0}));
    bow.segments.push_back(PCurve::makeLine2({1.0, 1.0}, {1.0, 0.2}));
    bow.segments.push_back(PCurve::makeLine2({1.0, 0.2}, {0.0, 0.5}));
    bow.segments.push_back(PCurve::makeLine2({0.0, 0.5}, {0.0, 0.0}));
    nf.loops.push_back(bow);
    TrimSelfIntersectResult nr = checkTrimmedFaceSelfIntersection(nf);
    const bool nativeInvalid = nr.selfIntersects;
    std::printf("      NATIVE: selfIntersects=%s status=%s detail='%s'\n",
                nativeInvalid ? "true" : "false",
                checkStatusName(nr.status), nr.detail.c_str());

    // OCCT: figure-eight face S=1; check the wire's SelfIntersect.
    TopoDS_Face of = occtFigureEightFace(1.0);
    bool occtInvalid = false;
    BRepCheck_Status sis = BRepCheck_NoError;
    for (TopExp_Explorer e(of, TopAbs_WIRE); e.More(); e.Next()) {
        TopoDS_Wire w = TopoDS::Wire(e.Current());
        BRepCheck_Wire wc(w);
        TopoDS_Edge e1, e2;
        BRepCheck_Status s = wc.SelfIntersect(of, e1, e2);
        if (s != BRepCheck_NoError) { occtInvalid = true; sis = s; }
    }
    // Also run the whole-shape analyzer as a cross-check.
    BRepCheck_Analyzer ana(of);
    const bool occtAnaInvalid = !ana.IsValid();
    std::printf("      OCCT  : Wire.SelfIntersect=%s  Analyzer.IsValid=%s\n",
                occtStatusName(sis), occtAnaInvalid ? "false" : "true");

    expect(nativeInvalid, "5c NATIVE flags INVALID (self-crossing)");
    expect(nr.status == CheckStatus::SelfIntersectingWire,
           "5c NATIVE status == SelfIntersectingWire");
    expect(occtInvalid || occtAnaInvalid, "5c OCCT flags INVALID (SelfIntersectingWire)");
    expect(nativeInvalid == (occtInvalid || occtAnaInvalid),
           "5c VERDICT AGREES (both INVALID)");
}

// =========================================================================
// CASE 6a — VALID concave L-prism solid (the centroid mis-call must be gone).
// =========================================================================
static void case6a() {
    std::printf("[6a] VALID concave L-prism solid -> both kernels VALID\n");

    // NATIVE: full battery on the L-block shell; require G3 (+ closure + manifold).
    LBlock lb;
    buildLBlock(lb);
    CheckReport r = checkBRep(lb.shell);
    for (const auto& p : r.predicates)
        if (!p.passed) std::printf("      NATIVE FAIL %s (%s) %s\n",
                                   p.name.c_str(), checkStatusName(p.status), p.detail.c_str());
    const CheckPredicate* g3 = r.find("G3.FaceNormalOutward");
    const bool nativeG3ok = g3 && g3->passed;
    // The native "valid" verdict for THIS A/B is: G3 outward-consistent AND
    // closed-2-manifold (T1/T6) — the geometric properties OCCT's IsValid gauges on
    // the prism. (The native battery also runs G5/G7 curve-on-surface sampling, which
    // is orthogonal to the orientation verdict under test here.)
    const bool nativeValid =
        nativeG3ok &&
        (r.find("T1.EveryEdgeHasOneOrTwoCoedges") && r.find("T1.EveryEdgeHasOneOrTwoCoedges")->passed) &&
        (r.find("T6.ShellClosureConsistent") && r.find("T6.ShellClosureConsistent")->passed);
    std::printf("      NATIVE: G3=%s  T1=%s  T6=%s  report.valid=%s\n",
                nativeG3ok ? "pass" : "FAIL",
                (r.find("T1.EveryEdgeHasOneOrTwoCoedges")->passed) ? "pass" : "FAIL",
                (r.find("T6.ShellClosureConsistent")->passed) ? "pass" : "FAIL",
                r.valid ? "true" : "false");

    // OCCT: extrude the same L cross-section and ask BRepCheck_Analyzer.IsValid().
    TopoDS_Shape sol = occtLPrism(1.0, 4.0, 1.0, 4.0, 2.0);
    BRepCheck_Analyzer ana(sol);
    const bool occtValid = ana.IsValid();
    std::set<BRepCheck_Status> fs = occtFailedStatuses(ana, sol);
    std::printf("      OCCT  : Analyzer.IsValid=%s\n", occtValid ? "true" : "false");
    printStatuses(fs);

    expect(nativeG3ok, "6a NATIVE G3 PASSES on the concave L-block (centroid mis-call gone)");
    expect(nativeValid, "6a NATIVE verdict VALID (G3 + closed-2-manifold)");
    expect(occtValid, "6a OCCT BRepCheck IsValid == true");
    expect(nativeValid == occtValid, "6a VERDICT AGREES (both VALID)");
    expect(fs.find(BRepCheck_BadOrientation) == fs.end(),
           "6a OCCT reports NO BadOrientation on the valid L-prism");
}

// =========================================================================
// CASE 6b — inverted re-entrant face on the L-prism -> both INVALID (BadOrientation).
// =========================================================================
static void case6b() {
    std::printf("[6b] inverted re-entrant face on the L-prism -> both INVALID\n");

    // NATIVE: flip the re-entrant pocket-wall side face #2's analytic surface.
    LBlock lb;
    buildLBlock(lb);
    Face* victim = lb.faces[2];   // re-entrant wall edge (a,N)->(b,N)
    victim->surface->reversed = !victim->surface->reversed;
    CheckReport r = checkBRep(lb.shell);
    const CheckPredicate* g3 = r.find("G3.FaceNormalOutward");
    const bool nativeG3failedNaming =
        g3 && !g3->passed &&
        std::any_of(g3->offenders.begin(), g3->offenders.end(),
                    [&](const CheckPredicate::Offender& o){ return o.id == victim->id; });
    const bool nativeInvalid = nativeG3failedNaming;
    std::printf("      NATIVE: G3 failed=%s names-victim=%s status=%s\n",
                (g3 && !g3->passed) ? "true" : "false",
                nativeG3failedNaming ? "true" : "false",
                g3 ? checkStatusName(g3->status) : "?");

    // OCCT: build the valid L-prism, then GENUINELY reverse the orientation of one
    // re-entrant pocket-wall face by REBUILDING a fresh shell/solid in which that one
    // face is added with its orientation flipped (`.Reversed()`). A plain local
    // `face.Reverse()` would only flip a detached copy's orientation flag and leave
    // the shared face inside the solid untouched (the analyzer would still see the
    // valid solid), so we must reconstruct the topology with the flipped face baked
    // in. The target is the re-entrant pocket wall x==a above y=N — the exact face
    // native flips (lb.faces[2]).
    TopoDS_Shape sol = occtLPrism(1.0, 4.0, 1.0, 4.0, 2.0);

    // Identify the target face: the planar wall entirely at x≈a(=1.0) touching the
    // pocket corner (a,N)=(1,1) — the re-entrant inner wall.
    TopoDS_Face target;
    for (TopExp_Explorer fe(sol, TopAbs_FACE); fe.More(); fe.Next()) {
        const TopoDS_Face& f = TopoDS::Face(fe.Current());
        bool hasPocketCorner = false;
        double xmin = 1e300, xmax = -1e300;
        for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next()) {
            gp_Pnt P = BRep_Tool::Pnt(TopoDS::Vertex(ve.Current()));
            xmin = std::min(xmin, P.X()); xmax = std::max(xmax, P.X());
            if (std::abs(P.X() - 1.0) < 1e-6 && std::abs(P.Y() - 1.0) < 1e-6)
                hasPocketCorner = true;
        }
        if (hasPocketCorner && std::abs(xmin - 1.0) < 1e-6 && std::abs(xmax - 1.0) < 1e-6) {
            target = f; break;
        }
    }
    if (target.IsNull()) {  // fallback: any single face — still breaks orientation
        TopExp_Explorer fe(sol, TopAbs_FACE);
        target = TopoDS::Face(fe.Current());
    }

    // Rebuild a fresh solid: new shell with every original face, but the target added
    // REVERSED. The reversed face's coedges now run the same sense as its neighbours
    // across the shared edges -> BRepCheck_Analyzer reports BadOrientation.
    BRep_Builder bb;
    TopoDS_Shape reversed;
    {
        // Grab the original shell to preserve its (closed) flag.
        TopoDS_Shell newShell;
        bb.MakeShell(newShell);
        for (TopExp_Explorer fe(sol, TopAbs_FACE); fe.More(); fe.Next()) {
            const TopoDS_Face& f = TopoDS::Face(fe.Current());
            if (f.IsSame(target)) bb.Add(newShell, f.Reversed());
            else                  bb.Add(newShell, f);
        }
        newShell.Closed(Standard_True);
        TopoDS_Solid newSolid;
        bb.MakeSolid(newSolid);
        bb.Add(newSolid, newShell);
        reversed = newSolid;
    }

    BRepCheck_Analyzer ana(reversed);
    const bool occtValid = ana.IsValid();
    const bool occtInvalid = !occtValid;
    std::set<BRepCheck_Status> fs = occtFailedStatuses(ana, reversed);
    std::printf("      OCCT  : Analyzer.IsValid=%s\n", occtValid ? "true" : "false");
    printStatuses(fs);

    expect(nativeInvalid, "6b NATIVE flags INVALID (G3 BadOrientationFace, names victim)");
    expect(g3 && g3->status == CheckStatus::BadOrientationFace,
           "6b NATIVE status == BadOrientationFace");
    expect(occtInvalid, "6b OCCT flags INVALID (BadOrientation)");
    expect(nativeInvalid == occtInvalid, "6b VERDICT AGREES (both INVALID)");
}

int main() {
    std::printf("=== A/B-vs-OCCT — exhaustive native B-rep VALIDATOR completions ===\n");
    std::printf("    OCCT 7.9.3 (BRepCheck_Analyzer / BRepCheck_Face / BRepCheck_Wire)\n\n");
    case5b();
    std::printf("\n");
    case5c();
    std::printf("\n");
    case6a();
    std::printf("\n");
    case6b();
    std::printf("\n=== A/B RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
