// thicksolid_bar_census.cpp — WHAT IS THE OCCT THICKSOLID BASELINE MADE OF?
//
// THE QUESTION. reports/CORPUS_AB_COVERAGE.md §3 scores
// FORGE_THICKSOLID_DROP_NATIVE against an OCCT baseline of 132/600 successes,
// and reports/corpus_ab/THICKSOLID_ATTRIBUTION.md §4 measured that EVERY one of
// those successes fails BRepCheck_Analyzer. The coverage gate therefore asks the
// native engine to reproduce a set of shapes none of which is a valid solid.
//
// "Invalid" on its own is not a verdict. BRepCheck_Analyzer reports 36 distinct
// statuses and they are not interchangeable: an InvalidSameParameterFlag is a
// bookkeeping complaint that ShapeFix repairs without moving a single point,
// while a self-intersection or a non-manifold edge is a shape no downstream
// consumer can use. This probe separates them, BY MEASUREMENT rather than by
// reading the status name:
//
//   (a) it records the full BRepCheck status histogram per part;
//   (b) it records the structural facts BRepCheck does NOT report --
//       non-manifold edges (an edge with >2 face uses), free edges (an edge with
//       1 face use, i.e. an open shell), signed volume, and the result volume
//       against the source volume;
//   (c) it runs BOPAlgo_ArgumentAnalyzer's self-interference test, which is the
//       check every boolean operation makes on its own arguments;
//   (d) it then runs ShapeFix_Shape and RE-MEASURES. A complaint is benign iff a
//       tolerance-level repair clears it WITHOUT moving the geometry (volume
//       ratio within 1e-9). That is a falsifiable operationalisation of "benign":
//       if the repair cannot clear it, or clears it by moving the shape, the
//       complaint was not benign.
//
// AND IT ANSWERS A SECOND QUESTION: is the operation ill-posed at the derived
// wall, or is the engine wrong? --mode=sweep re-runs the SAME derived operation
// at wall * {1, 1/2, 1/4, 1/8, 1/16, 1/32} and reports validity at each. A part
// whose answer becomes valid at a thinner wall is a part where a correct answer
// EXISTS and the derived thickness simply exceeds the local feature spacing; a
// part invalid at every thickness is one where the engine is wrong at any scale.
//
// THE DERIVED OPERATION IS COPIED, NOT REINVENTED. Bounds from VERTICES,
// scale = min bbox extent (or 0.05*diag when that is ~0), wall = 0.05*scale,
// removed face = the largest planar face with the same deterministic tie-break,
// and the OCCT call is the exact MakeThickSolidByJoin(src, {rm}, -wall, 1e-3)
// that test/corpus_ab_coverage.cpp:1221 makes. Every one of those lines is
// mirrored from that file so this probe measures the SAME bar the gate does.
//
// CONTAINMENT. OCCT's thicksolid engine SIGSEGVs on this corpus. All OCCT work
// happens in a FORKED CHILD which streams key<TAB>value records back as it
// completes each stage, so a crash in a late stage does not cost the earlier
// measurements and is attributed to the stage it happened in. The parent kills a
// child that outlives the deadline.
//
// LINKS NO FORGE SOURCE. This probe measures the OCCT arm only. Sharing code
// with the native engine would let the engine's own defects be reported back as
// properties of the baseline.
//
// BUILD: test/build_thicksolid_bar_census.sh   (runs --selftest, refuses to emit
// a binary if the controls are red)
// Exit 0 iff the part imported.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <functional>
#include <map>
#include <string>
#include <vector>

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <BOPAlgo_CheckResult.hxx>
#include <BOPAlgo_ListOfCheckResult.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_ListIteratorOfListOfStatus.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Status.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

namespace {

// ─────────────────────────────────────────────────────── status names
const char* brepCheckName(BRepCheck_Status s) {
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
    }
    return "Unknown";
}

const char* bopCheckName(BOPAlgo_CheckStatus s) {
    switch (s) {
        case BOPAlgo_CheckUnknown: return "CheckUnknown";
        case BOPAlgo_BadType: return "BadType";
        case BOPAlgo_SelfIntersect: return "SelfIntersect";
        case BOPAlgo_TooSmallEdge: return "TooSmallEdge";
        case BOPAlgo_NonRecoverableFace: return "NonRecoverableFace";
        case BOPAlgo_IncompatibilityOfVertex: return "IncompatibilityOfVertex";
        case BOPAlgo_IncompatibilityOfEdge: return "IncompatibilityOfEdge";
        case BOPAlgo_IncompatibilityOfFace: return "IncompatibilityOfFace";
        case BOPAlgo_OperationAborted: return "OperationAborted";
        case BOPAlgo_GeomAbs_C0: return "GeomAbs_C0";
        case BOPAlgo_InvalidCurveOnSurface: return "InvalidCurveOnSurface";
        case BOPAlgo_NotValid: return "NotValid";
    }
    return "Unknown";
}

// ─────────────────────────────────────── derivation, mirrored from the A/B
bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z();
            first = false;
        } else {
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    return !first;
}

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}

gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}

bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return false;
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln p = pl->Pln();
    gp_Dir n = p.Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Pln(p.Location(), n);
    return true;
}

bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

TopoDS_Face largestPlanarFace(const TopoDS_Shape& shape, int* nPlanar, double* areaOut) {
    TopoDS_Face best; double bestArea = 0.0; int np = 0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        gp_Pln pl;
        if (!planeOf(f, pl)) continue;
        ++np;
        if (betterFace(f, a, best, bestArea)) { best = f; bestArea = a; }
    }
    if (nPlanar) *nPlanar = np;
    if (areaOut) *areaOut = bestArea;
    return best;
}

// ────────────────────────────────────────────── observables of a result shape
struct Obs {
    double vol = 0.0, area = 0.0;
    int nsolid = 0, nshell = 0, nface = 0, nedge = 0, nvert = 0;
    int free_edges = 0, nonmanifold_edges = 0;
    int valid = -1;
    // BRepCheck_Shell only tests closure on a shell whose Closed FLAG is set, so
    // "valid" and "closed" are different questions and the flag decides which one
    // was asked. Both are recorded.
    int shells_closedflag = 0;
};

// `traceFd >= 0` streams a marker before each step, so a SIGSEGV inside OCCT's
// own property evaluation is attributed to the step it happened in rather than
// to "the observation". A crash while MEASURING a shape OCCT has just declared
// IsDone() is a different fact from a crash while BUILDING it.
int gTraceFd = -1;
void traceStep(const char* what);

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    traceStep("obs_vol");
    { GProp_GProps g; try { BRepGProp::VolumeProperties(s, g); o.vol = g.Mass(); } catch (...) {} }
    traceStep("obs_area");
    { GProp_GProps g; try { BRepGProp::SurfaceProperties(s, g); o.area = g.Mass(); } catch (...) {} }
    traceStep("obs_maps");
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_SOLID, m);  o.nsolid = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SHELL, m);  o.nshell = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_FACE, m);   o.nface  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_EDGE, m);   o.nedge  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_VERTEX, m); o.nvert  = m.Extent();
    TopTools_IndexedDataMapOfShapeListOfShape ef;
    TopExp::MapShapesAndAncestors(s, TopAbs_EDGE, TopAbs_FACE, ef);
    for (int i = 1; i <= ef.Extent(); ++i) {
        // A DEGENERATE edge (a cone apex, a sphere pole) legitimately bounds one
        // face and is not a free edge. Counting it would report a hole in every
        // valid cone in the corpus -- a term that reds a valid part is a wrong
        // gate, not a stricter one.
        const TopoDS_Edge e = TopoDS::Edge(ef.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;
        const int n = ef(i).Extent();
        if (n <= 1) ++o.free_edges;
        else if (n > 2) ++o.nonmanifold_edges;
    }
    { TopTools_IndexedMapOfShape sh; TopExp::MapShapes(s, TopAbs_SHELL, sh);
      for (int i = 1; i <= sh.Extent(); ++i)
          if (BRep_Tool::IsClosed(sh(i))) ++o.shells_closedflag; }
    traceStep("obs_check");
    try { o.valid = BRepCheck_Analyzer(s).IsValid() ? 1 : 0; } catch (...) { o.valid = -1; }
    traceStep("obs_done");
    return o;
}

// Full BRepCheck status histogram: every subshape, every status on it, plus the
// statuses recorded on a subshape IN THE CONTEXT of a parent (which is where
// BRepCheck records FreeEdge / InvalidMultiConnexity / BadOrientationOfSubshape).
void statusHistogram(const TopoDS_Shape& s, std::map<std::string, int>& hist) {
    BRepCheck_Analyzer ana(s);
    TopTools_IndexedMapOfShape all;
    TopExp::MapShapes(s, all);
    all.Add(s);
    for (int i = 1; i <= all.Extent(); ++i) {
        const TopoDS_Shape sub = all(i);
        Handle(BRepCheck_Result) r;
        try { r = ana.Result(sub); } catch (...) { continue; }
        if (r.IsNull()) continue;
        for (BRepCheck_ListIteratorOfListOfStatus it(r->Status()); it.More(); it.Next()) {
            if (it.Value() == BRepCheck_NoError) continue;
            hist[brepCheckName(it.Value())] += 1;
        }
        try {
            for (r->InitContextIterator(); r->MoreShapeInContext(); r->NextShapeInContext()) {
                for (BRepCheck_ListIteratorOfListOfStatus it(r->StatusOnShape()); it.More(); it.Next()) {
                    if (it.Value() == BRepCheck_NoError) continue;
                    hist[brepCheckName(it.Value())] += 1;
                }
            }
        } catch (...) {}
    }
}

// ─────────────────────────────────────────────────────────── record emitting
void rec(int fd, const char* key, const char* val) {
    char buf[4096];
    const int n = std::snprintf(buf, sizeof buf, "%s\t%s\n", key, val);
    if (n > 0) { ssize_t w = ::write(fd, buf, (size_t)n); (void)w; }
}
void recd(int fd, const char* key, double v) {
    char b[64]; std::snprintf(b, sizeof b, "%.17g", v); rec(fd, key, b);
}
void reci(int fd, const char* key, long v) {
    char b[64]; std::snprintf(b, sizeof b, "%ld", v); rec(fd, key, b);
}

void traceStep(const char* what) {
    if (gTraceFd >= 0) rec(gTraceFd, "stage", what);
}

void emitObs(int fd, const char* prefix, const Obs& o) {
    char k[128];
    std::snprintf(k, sizeof k, "%s_vol", prefix);   recd(fd, k, o.vol);
    std::snprintf(k, sizeof k, "%s_area", prefix);  recd(fd, k, o.area);
    std::snprintf(k, sizeof k, "%s_nsolid", prefix); reci(fd, k, o.nsolid);
    std::snprintf(k, sizeof k, "%s_nshell", prefix); reci(fd, k, o.nshell);
    std::snprintf(k, sizeof k, "%s_nface", prefix);  reci(fd, k, o.nface);
    std::snprintf(k, sizeof k, "%s_nedge", prefix);  reci(fd, k, o.nedge);
    std::snprintf(k, sizeof k, "%s_nvert", prefix);  reci(fd, k, o.nvert);
    std::snprintf(k, sizeof k, "%s_free_edges", prefix); reci(fd, k, o.free_edges);
    std::snprintf(k, sizeof k, "%s_nm_edges", prefix);   reci(fd, k, o.nonmanifold_edges);
    std::snprintf(k, sizeof k, "%s_valid", prefix);      reci(fd, k, o.valid);
    std::snprintf(k, sizeof k, "%s_shells_closedflag", prefix); reci(fd, k, o.shells_closedflag);
}

// ─────────────────────────────────────────── the child: OCCT work, staged
// Every stage writes its result before the next begins, so a crash is attributed.
void childCensus(int fd, const TopoDS_Shape& src, const TopoDS_Face& rm, double wall,
                 bool doBop, bool doFix) {
    rec(fd, "stage", "start");
    gTraceFd = fd;
    double srcVol = 0.0;
    { GProp_GProps g; try { BRepGProp::VolumeProperties(src, g); srcVol = g.Mass(); } catch (...) {} }
    TopTools_ListOfShape faces;
    faces.Append(rm);
    TopoDS_Shape res;
    bool done = false;
    rec(fd, "stage", "thick_enter");
    try {
        BRepOffsetAPI_MakeThickSolid mk;
        mk.MakeThickSolidByJoin(src, faces, -wall, 1.0e-3);
        mk.Build();
        if (mk.IsDone()) { res = mk.Shape(); done = true; }
    } catch (...) { rec(fd, "thick_threw", "1"); }
    rec(fd, "stage", "thick_done");
    reci(fd, "occt_isdone", done ? 1 : 0);
    if (!done || res.IsNull()) { rec(fd, "occt_status", "DEFER"); rec(fd, "stage", "end"); return; }
    { TopTools_IndexedMapOfShape m; TopExp::MapShapes(res, TopAbs_FACE, m);
      if (m.Extent() == 0) { rec(fd, "occt_status", "DEFER_EMPTY"); rec(fd, "stage", "end"); return; } }
    rec(fd, "occt_status", "OK");

    rec(fd, "stage", "observe_enter");
    const Obs o = observe(res);
    emitObs(fd, "occt", o);
    // THE IDENTITY RETURN. When the requested wall exceeds the local half-extent
    // the cavity vanishes and MakeThickSolidByJoin hands the SOURCE BODY back with
    // IsDone() true and BRepCheck valid. That is not a hollow, and the coverage
    // gate counts it as a success, so it is measured explicitly rather than left
    // to be inferred from a volume ratio.
    reci(fd, "occt_cavity_absent",
         (srcVol > 0.0 && std::fabs(o.vol - srcVol) <= 1.0e-9 * srcVol) ? 1 : 0);
    recd(fd, "occt_vol_ratio", srcVol > 0.0 ? o.vol / srcVol : 0.0);
    rec(fd, "stage", "observe_done");

    rec(fd, "stage", "hist_enter");
    { std::map<std::string, int> h;
      try { statusHistogram(res, h); } catch (...) { rec(fd, "hist_threw", "1"); }
      for (const auto& kv : h) {
          char k[256]; std::snprintf(k, sizeof k, "bc_%s", kv.first.c_str());
          reci(fd, k, kv.second);
      } }
    rec(fd, "stage", "hist_done");

    if (doBop) {
        rec(fd, "stage", "bop_enter");
        try {
            BOPAlgo_ArgumentAnalyzer an;
            an.SetShape1(res);
            an.OperationType() = BOPAlgo_UNKNOWN;
            an.StopOnFirstFaulty() = Standard_False;
            an.ArgumentTypeMode() = Standard_True;
            an.SelfInterMode() = Standard_True;
            an.SmallEdgeMode() = Standard_False;
            an.RebuildFaceMode() = Standard_False;
            an.TangentMode() = Standard_False;
            an.MergeVertexMode() = Standard_False;
            an.MergeEdgeMode() = Standard_False;
            an.ContinuityMode() = Standard_False;
            an.CurveOnSurfaceMode() = Standard_False;
            an.Perform();
            reci(fd, "bop_faulty", an.HasFaulty() ? 1 : 0);
            std::map<std::string, int> bh;
            const BOPAlgo_ListOfCheckResult& lst = an.GetCheckResult();
            for (BOPAlgo_ListIteratorOfListOfCheckResult it(lst); it.More(); it.Next())
                bh[bopCheckName(it.Value().GetCheckStatus())] += 1;
            for (const auto& kv : bh) {
                char k[256]; std::snprintf(k, sizeof k, "bop_%s", kv.first.c_str());
                reci(fd, k, kv.second);
            }
        } catch (...) { rec(fd, "bop_threw", "1"); }
        rec(fd, "stage", "bop_done");
    }

    if (doFix) {
        // THE BENIGN TEST. A tolerance-level repair that does NOT move the
        // geometry (volume ratio within 1e-9) and returns a valid shape means the
        // complaint was bookkeeping. Anything else means it was not.
        rec(fd, "stage", "fix_enter");
        try {
            Handle(ShapeFix_Shape) sf = new ShapeFix_Shape(res);
            sf->SetPrecision(1.0e-7);
            sf->SetMaxTolerance(1.0e-3);
            sf->Perform();
            const TopoDS_Shape fx = sf->Shape();
            if (!fx.IsNull()) {
                const Obs fo = observe(fx);
                emitObs(fd, "fix", fo);
            }
        } catch (...) { rec(fd, "fix_threw", "1"); }
        rec(fd, "stage", "fix_done");
    }
    rec(fd, "stage", "end");
}

void childSweep(int fd, const TopoDS_Shape& src, const TopoDS_Face& rm, double wall) {
    rec(fd, "stage", "start");
    double srcVol = 0.0;
    { GProp_GProps g; try { BRepGProp::VolumeProperties(src, g); srcVol = g.Mass(); } catch (...) {} }
    recd(fd, "src_vol_child", srcVol);
    static const double kDiv[] = {1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0};
    for (size_t i = 0; i < sizeof(kDiv) / sizeof(kDiv[0]); ++i) {
        const double w = wall / kDiv[i];
        char tag[32]; std::snprintf(tag, sizeof tag, "w%d", (int)kDiv[i]);
        char k[64];
        std::snprintf(k, sizeof k, "stage_%s", tag); rec(fd, "stage", k);
        gTraceFd = fd;
        TopTools_ListOfShape faces; faces.Append(rm);
        TopoDS_Shape res; bool done = false;
        try {
            BRepOffsetAPI_MakeThickSolid mk;
            mk.MakeThickSolidByJoin(src, faces, -w, 1.0e-3);
            mk.Build();
            if (mk.IsDone()) { res = mk.Shape(); done = true; }
        } catch (...) {}
        std::snprintf(k, sizeof k, "%s_wall", tag); recd(fd, k, w);
        std::snprintf(k, sizeof k, "%s_done", tag); reci(fd, k, done ? 1 : 0);
        if (!done || res.IsNull()) continue;
        const Obs o = observe(res);
        std::snprintf(k, sizeof k, "%s_valid", tag);  reci(fd, k, o.valid);
        std::snprintf(k, sizeof k, "%s_vol", tag);    recd(fd, k, o.vol);
        std::snprintf(k, sizeof k, "%s_nface", tag);  reci(fd, k, o.nface);
        std::snprintf(k, sizeof k, "%s_free", tag);   reci(fd, k, o.free_edges);
        std::snprintf(k, sizeof k, "%s_nm", tag);     reci(fd, k, o.nonmanifold_edges);
        std::snprintf(k, sizeof k, "%s_absent", tag);
        reci(fd, k, (srcVol > 0.0 && std::fabs(o.vol - srcVol) <= 1.0e-9 * srcVol) ? 1 : 0);
    }
    rec(fd, "stage", "end");
}

// ───────────────────────────────────────────────── fork + deadline + collect
struct ChildOut {
    std::map<std::string, std::string> kv;
    std::vector<std::string> stages;
    std::string outcome;   // OK | CRASH_sig<N> | TIMEOUT | EXIT<N>
};

ChildOut runChild(const std::function<void(int)>& body, int timeoutSec) {
    ChildOut out;
    int fds[2];
    if (::pipe(fds) != 0) { out.outcome = "PIPE_FAIL"; return out; }
    std::fflush(nullptr);
    const pid_t pid = ::fork();
    if (pid < 0) { ::close(fds[0]); ::close(fds[1]); out.outcome = "FORK_FAIL"; return out; }
    if (pid == 0) {
        ::close(fds[0]);
        body(fds[1]);
        ::close(fds[1]);
        ::_exit(0);
    }
    ::close(fds[1]);
    std::string buf;
    const long deadline = (long)::time(nullptr) + timeoutSec;
    bool timedOut = false;
    for (;;) {
        struct pollfd p; p.fd = fds[0]; p.events = POLLIN; p.revents = 0;
        const long left = deadline - (long)::time(nullptr);
        if (left <= 0) { timedOut = true; break; }
        const int pr = ::poll(&p, 1, (int)std::min(1000L, left * 1000L));
        if (pr < 0) { if (errno == EINTR) continue; break; }
        if (pr == 0) continue;
        char tmp[8192];
        const ssize_t n = ::read(fds[0], tmp, sizeof tmp);
        if (n <= 0) break;
        buf.append(tmp, (size_t)n);
    }
    if (timedOut) ::kill(pid, SIGKILL);
    int st = 0;
    ::waitpid(pid, &st, 0);
    ::close(fds[0]);
    if (timedOut) out.outcome = "TIMEOUT";
    else if (WIFSIGNALED(st)) { char b[32]; std::snprintf(b, sizeof b, "CRASH_sig%d", WTERMSIG(st)); out.outcome = b; }
    else if (WIFEXITED(st) && WEXITSTATUS(st) != 0) { char b[32]; std::snprintf(b, sizeof b, "EXIT%d", WEXITSTATUS(st)); out.outcome = b; }
    else out.outcome = "OK";

    size_t pos = 0;
    while (pos < buf.size()) {
        const size_t nl = buf.find('\n', pos);
        if (nl == std::string::npos) break;
        const std::string line = buf.substr(pos, nl - pos);
        pos = nl + 1;
        const size_t tab = line.find('\t');
        if (tab == std::string::npos) continue;
        const std::string k = line.substr(0, tab), v = line.substr(tab + 1);
        if (k == "stage") out.stages.push_back(v);
        else out.kv[k] = v;
    }
    return out;
}

std::string jsonEsc(const std::string& s) {
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if ((unsigned char)c < 0x20) o += ' ';
        else o += c;
    }
    return o;
}

bool isNumeric(const std::string& v) {
    if (v.empty()) return false;
    char* end = nullptr;
    std::strtod(v.c_str(), &end);
    return end && *end == '\0';
}

// ───────────────────────────────────────────────────────────── the controls
int selftest() {
    int bad = 0;
    auto say = [&](const char* what, bool ok) {
        std::fprintf(stderr, "  %-46s %s\n", what, ok ? "ok" : "FAIL");
        if (!ok) ++bad;
    };

    // C1. A hollow that IS valid must be reported valid, and the observables must
    //     be the closed form: box 20, wall 1, top removed.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape();
        int np = 0; double a = 0.0;
        const TopoDS_Face top = largestPlanarFace(box, &np, &a);
        // largest planar face of a cube is a tie; the deterministic tie-break picks one.
        say("C1 box has 6 planar faces", np == 6);
        ChildOut c = runChild([&](int fd) { childCensus(fd, box, top, 1.0, true, true); }, 60);
        say("C1 child completed", c.outcome == "OK");
        say("C1 occt built", c.kv["occt_status"] == "OK");
        const double vol = std::atof(c.kv["occt_vol"].c_str());
        const double want = 20.0 * 20.0 * 20.0 - 18.0 * 18.0 * 19.0;
        say("C1 volume == 8000 - 18*18*19", std::fabs(vol - want) < 1e-6 * want);
        say("C1 BRepCheck valid", c.kv["occt_valid"] == "1");
        say("C1 no free edges", c.kv["occt_free_edges"] == "0");
        say("C1 no non-manifold edges", c.kv["occt_nm_edges"] == "0");
        say("C1 BOP reports no faulty", c.kv["bop_faulty"] == "0");
        bool anyBc = false;
        for (const auto& kv : c.kv) if (kv.first.rfind("bc_", 0) == 0) anyBc = true;
        say("C1 status histogram empty", !anyBc);
        say("C1 stages reached end", !c.stages.empty() && c.stages.back() == "end");
    }

    // C2. THE IDENTITY RETURN MUST BE VISIBLE. A wall thicker than the half
    //     extent is a request no hollow can satisfy. Measured on this OCCT
    //     (7.9.x, /opt/homebrew/opt/opencascade): MakeThickSolidByJoin returns
    //     IsDone(), BRepCheck VALID, and the SOURCE BOX unchanged -- 6 faces,
    //     volume 8000. A coverage gate counts that as a success. The probe must
    //     flag it, or the census would score an identity as a hollow.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape();
        int np = 0; double a = 0.0;
        const TopoDS_Face top = largestPlanarFace(box, &np, &a);
        ChildOut c = runChild([&](int fd) { childCensus(fd, box, top, 30.0, true, true); }, 60);
        say("C2 over-thick wall still reports IsDone", c.kv["occt_isdone"] == "1");
        say("C2 over-thick result is BRepCheck valid", c.kv["occt_valid"] == "1");
        say("C2 over-thick result IS the source (6 faces)", c.kv["occt_nface"] == "6");
        say("C2 identity return is FLAGGED", c.kv["occt_cavity_absent"] == "1");
        say("C2 vol_ratio is 1", std::fabs(std::atof(c.kv["occt_vol_ratio"].c_str()) - 1.0) < 1e-12);
    }

    // C1b. A CLOSED SOLID MUST REPORT ITS SHELL CLOSED. If shells_closedflag read
    //      zero on a genuinely closed hollow the column would be inert, and the
    //      corpus finding that rests on it would be an artefact.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape();
        int np = 0; double a = 0.0;
        const TopoDS_Face top = largestPlanarFace(box, &np, &a);
        ChildOut c = runChild([&](int fd) { childCensus(fd, box, top, 1.0, false, false); }, 60);
        say("C1b valid hollow has 1 shell", c.kv["occt_nshell"] == "1");
        say("C1b that shell carries the Closed flag", c.kv["occt_shells_closedflag"] == "1");
    }

    // C2b. AND THE FLAG MUST NOT FIRE ON A REAL HOLLOW -- both directions.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape();
        int np = 0; double a = 0.0;
        const TopoDS_Face top = largestPlanarFace(box, &np, &a);
        ChildOut c = runChild([&](int fd) { childCensus(fd, box, top, 1.0, true, true); }, 60);
        say("C2b real hollow is NOT flagged as identity", c.kv["occt_cavity_absent"] == "0");
    }

    // C3. CONTAINMENT. A child that dies must be reported as CRASH, and the
    //     records it wrote BEFORE dying must survive.
    {
        ChildOut c = runChild([&](int fd) {
            rec(fd, "stage", "start");
            reci(fd, "canary", 42);
            ::fsync(fd);
            ::raise(SIGSEGV);
        }, 30);
        say("C3 crash reported as CRASH_sig11", c.outcome == "CRASH_sig11");
        say("C3 pre-crash record survived", c.kv["canary"] == "42");
        say("C3 last stage is start (not end)", !c.stages.empty() && c.stages.back() == "start");
    }

    // C4. CONTAINMENT. A child that hangs must be reported as TIMEOUT.
    {
        ChildOut c = runChild([&](int fd) {
            rec(fd, "stage", "start");
            for (;;) { }
        }, 2);
        say("C4 hang reported as TIMEOUT", c.outcome == "TIMEOUT");
    }

    // C5. The sweep must actually vary the wall and must find the thick end bad
    //     and the thin end good on a shape where that is known: a 20 box with a
    //     wall of 12 is impossible and 12/16 = 0.75 is fine.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape();
        int np = 0; double a = 0.0;
        const TopoDS_Face top = largestPlanarFace(box, &np, &a);
        ChildOut c = runChild([&](int fd) { childSweep(fd, box, top, 12.0); }, 120);
        say("C5 sweep completed", c.outcome == "OK");
        say("C5 w1 wall is 12", std::fabs(std::atof(c.kv["w1_wall"].c_str()) - 12.0) < 1e-12);
        say("C5 w16 wall is 0.75", std::fabs(std::atof(c.kv["w16_wall"].c_str()) - 0.75) < 1e-12);
        const bool thinOk = c.kv["w16_done"] == "1" && c.kv["w16_valid"] == "1";
        say("C5 thin wall yields a valid hollow", thinOk);
        say("C5 impossible thick wall is the identity", c.kv["w1_absent"] == "1");
        say("C5 thin wall is not the identity", c.kv["w16_absent"] == "0");
    }

    std::fprintf(stderr, bad ? "SELFTEST: %d FAILED\n" : "SELFTEST: all controls pass\n", bad);
    return bad ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string step, name, mode = "census";
    int timeoutSec = 120;
    bool doBop = true, doFix = true;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a.rfind("--name=", 0) == 0) name = a.substr(7);
        else if (a.rfind("--mode=", 0) == 0) mode = a.substr(7);
        else if (a.rfind("--timeout=", 0) == 0) timeoutSec = std::atoi(a.c_str() + 10);
        else if (a == "--no-bop") doBop = false;
        else if (a == "--no-fix") doFix = false;
        else if (a.rfind("--", 0) != 0) step = a;
    }
    if (step.empty()) { std::fprintf(stderr, "usage: %s <part.step> [--name=N] [--mode=census|sweep]\n", argv[0]); return 2; }
    if (name.empty()) {
        const size_t slash = step.find_last_of('/');
        name = (slash == std::string::npos) ? step : step.substr(slash + 1);
        const size_t dot = name.find_last_of('.');
        if (dot != std::string::npos) name = name.substr(0, dot);
    }

    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(step.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) { std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
        if (shape.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str()); return 1; }
    }
    double bb[6];
    if (!boundsOf(shape, bb)) { std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", name.c_str()); return 1; }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double minExt = std::min(dx, std::min(dy, dz));
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diag > 0.0)) { std::printf("{\"part\":\"%s\",\"error\":\"degenerate_bbox\"}\n", name.c_str()); return 1; }
    const bool flat = !(minExt > 1e-9 * diag);
    const double scale = flat ? diag * 0.05 : minExt;
    const double wall = 0.05 * scale;

    TopTools_IndexedMapOfShape sm;
    TopExp::MapShapes(shape, TopAbs_SOLID, sm);
    const bool hasSolid = sm.Extent() > 0;
    int nPlanar = 0; double rmArea = 0.0;
    const TopoDS_Face rm = largestPlanarFace(shape, &nPlanar, &rmArea);

    const Obs src = observe(shape);

    std::string out = "{";
    char h[1024];
    std::snprintf(h, sizeof h,
        "\"part\":\"%s\",\"mode\":\"%s\",\"has_solid\":%d,\"flat\":%d,"
        "\"min_ext\":%.17g,\"diag\":%.17g,\"wall\":%.17g,\"rm_area\":%.17g,\"n_planar\":%d,"
        "\"src_vol\":%.17g,\"src_area\":%.17g,\"src_valid\":%d,\"src_nsolid\":%d,"
        "\"src_nshell\":%d,\"src_nface\":%d,\"src_nedge\":%d,"
        "\"src_free_edges\":%d,\"src_nm_edges\":%d",
        jsonEsc(name).c_str(), mode.c_str(), hasSolid ? 1 : 0, flat ? 1 : 0,
        minExt, diag, wall, rmArea, nPlanar,
        src.vol, src.area, src.valid, src.nsolid, src.nshell, src.nface, src.nedge,
        src.free_edges, src.nonmanifold_edges);
    out += h;

    if (!hasSolid || rm.IsNull()) {
        out += ",\"applicable\":0,\"na_reason\":\"";
        out += (!hasSolid ? "not_a_solid" : "no_planar_face");
        out += "\"}";
        std::printf("%s\n", out.c_str());
        return 0;
    }
    out += ",\"applicable\":1";

    ChildOut c = (mode == "sweep")
        ? runChild([&](int fd) { childSweep(fd, shape, rm, wall); }, timeoutSec)
        : runChild([&](int fd) { childCensus(fd, shape, rm, wall, doBop, doFix); }, timeoutSec);

    out += ",\"child_outcome\":\"" + jsonEsc(c.outcome) + "\"";
    out += ",\"last_stage\":\"" + jsonEsc(c.stages.empty() ? std::string("none") : c.stages.back()) + "\"";
    out += ",\"n_stages\":" + std::to_string(c.stages.size());
    for (const auto& kv : c.kv) {
        out += ",\"" + jsonEsc(kv.first) + "\":";
        if (isNumeric(kv.second)) out += kv.second;
        else out += "\"" + jsonEsc(kv.second) + "\"";
    }
    out += "}";
    std::printf("%s\n", out.c_str());
    return 0;
}
