// ─────────────────────────────────────────────────────────────────────────────
// brepcheck_status_probe.cpp — WHY does BRepCheck_Analyzer reject a native
// fillet/chamfer result whose mass properties and shell/solid counts are right?
//
// corpus_ab_coverage.cpp records ONE BIT per arm (`valid` = IsValid()). That bit
// says a solid is rejected; it cannot say WHICH sub-shape is rejected or on what
// grounds, and a whole family of causes (a bad curve-on-surface, an unclosed
// shell, a self-intersecting wire) collapses into the same 0.
//
// This probe re-runs the SAME op the A/B runs — same pickInputs (longest line
// edge), same r = 0.05 * scale — and then walks every sub-shape of the answer
// asking BRepCheck_Analyzer::Result(sub)->Status() and ->StatusOnShape(context)
// for the actual BRepCheck_Status enum values. It CHANGES NOTHING: it does not
// touch the harness, defines no drop macro, and asserts nothing. Its whole
// output is a census.
//
// The walk is the pattern OCCT's own DRAW `checkshape` uses
// (BRepTest_CheckCommands.cxx: GetProblemShapes / GetProblemSub), widened to
// visit every contextual pair rather than only the ones DRAW prints.
//
// ── WHAT IT MEASURED, 2026-09-04, on the 600-part corpus at eb2ea6c3 ─────────
// The 91 parts on which BOTH the native fillet AND the native chamfer are
// BRepCheck-INVALID, and the 312 on which the fillet is valid, run through this
// probe. The result is a clean, mutually exclusive partition, and the source
// parts are ALL valid (91/91 src_valid=true, no status of any kind), so the
// defect is created by the op and not carried in:
//
//   class            n    BRepCheck statuses                       bad sub-shapes
//   ------------------------------------------------------------------------------
//   IntersectingWires 69  FACE/IntersectingWires                   exactly 1 FACE
//   SelfIntersecting  22  FACE/UnorientableShape +                 1 FACE + 1 WIRE
//                         WIRE/SelfIntersectingWire
//   valid controls   312  (none)                                   0
//
// The bad face is, on 91/91: PLANAR, the SOLE bad face, lying in the plane of a
// face adjacent to the very edge being blended, and with an area no source face
// has — i.e. it is the face retrimAdjacentFace() rebuilt. NOTHING else is
// flagged: zero EDGE, zero VERTEX, zero SHELL and zero SOLID statuses, hence a
// closed shell, the right shell/solid counts and mass properties that still
// match OCCT to <=2.1e-5 relative while the shape is rejected.
//
// WHY, in geometry (r = the fillet radius / chamfer distance = 0.05 * min-extent):
//   * 69/69 IntersectingWires parts have, IN THE SOURCE, an INNER (hole) wire of
//     that adjacent face nearer to the blended edge than the setback:
//     d_hole/r in [0.0228, 0.9869]. After the retrim the new outer ring and that
//     inner wire meet at distance ~0 (<=1.0e-14 on all 69) and 69/69 have at
//     least one sampled hole point classified OUT of the new outer ring.
//   * 22/22 SelfIntersectingWire parts instead have a NON-ADJACENT segment of the
//     SAME outer ring nearer than the setback: d_ring/r in [0.0876, 0.9421], and
//     after the retrim 22/22 carry exactly 2 interior (BRepExtrema_IsOnEdge on
//     both sides) contacts between non-adjacent edges of that ring — a fold.
//   * The 312 valid controls have NEITHER: d_hole/r >= 1.009 and d_ring/r >= 1.003
//     on every one of them, 0/312 below 1 on either measure.
// So min(d_hole, d_ring) < r separates 91/91 invalid from 0/312 valid with no
// exceptions, and the margin on the valid side is 0.3%-0.9% — this is the
// mechanism, not a correlate.
//
// THE CODE PATH. retrimAdjacentFace (NativeFilletChamfer.cpp:627) moves the two
// ring vertices of the blended edge to the setback points and hands the ring to
// planarFaceFromSegs, which re-attaches the ORIGINAL inner wires verbatim
// (innerWires(f), "preserved verbatim on re-trim"). The only guard on the shift
// is setbackFitsFaces (:610), whose extent comes from maxRingProjection (:601):
// it takes the MAXIMUM projection over the OUTER ring's VERTICES. It therefore
// cannot see (a) inner wires at all and (b) any nearer non-adjacent segment of
// the ring, because it maximises where the binding constraint is a minimum. Both
// filletOneEdge (:927) and chamferOneEdge (:848) call it with the same setback
// (s = R/tan(theta/2); dA = dB = d), which is why the SAME 91 parts fail in both
// families with zero exceptions.
//
// BUILD: test/build_brepcheck_status_probe.sh   (reuses the A/B object archive)
// RUN:   brepcheck_status_probe <part.step> [--name=ID] [--family=FILLET|CHAMFER]
// Output: one JSON object per line on stdout.
// ─────────────────────────────────────────────────────────────────────────────

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BRepAdaptor_Curve.hxx>
#include <BRepTools.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepExtrema_SupportType.hxx>
#include <BRep_Tool.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Curve.hxx>
#include <TopoDS_Vertex.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <forge/native/brep/NativeFilletChamfer.hpp>

namespace {

const char* statusName(BRepCheck_Status s) {
    switch (s) {
    case BRepCheck_NoError:                       return "NoError";
    case BRepCheck_InvalidPointOnCurve:           return "InvalidPointOnCurve";
    case BRepCheck_InvalidPointOnCurveOnSurface:  return "InvalidPointOnCurveOnSurface";
    case BRepCheck_InvalidPointOnSurface:         return "InvalidPointOnSurface";
    case BRepCheck_No3DCurve:                     return "No3DCurve";
    case BRepCheck_Multiple3DCurve:               return "Multiple3DCurve";
    case BRepCheck_Invalid3DCurve:                return "Invalid3DCurve";
    case BRepCheck_NoCurveOnSurface:              return "NoCurveOnSurface";
    case BRepCheck_InvalidCurveOnSurface:         return "InvalidCurveOnSurface";
    case BRepCheck_InvalidCurveOnClosedSurface:   return "InvalidCurveOnClosedSurface";
    case BRepCheck_InvalidSameRangeFlag:          return "InvalidSameRangeFlag";
    case BRepCheck_InvalidSameParameterFlag:      return "InvalidSameParameterFlag";
    case BRepCheck_InvalidDegeneratedFlag:        return "InvalidDegeneratedFlag";
    case BRepCheck_FreeEdge:                      return "FreeEdge";
    case BRepCheck_InvalidMultiConnexity:         return "InvalidMultiConnexity";
    case BRepCheck_InvalidRange:                  return "InvalidRange";
    case BRepCheck_EmptyWire:                     return "EmptyWire";
    case BRepCheck_RedundantEdge:                 return "RedundantEdge";
    case BRepCheck_SelfIntersectingWire:          return "SelfIntersectingWire";
    case BRepCheck_NoSurface:                     return "NoSurface";
    case BRepCheck_InvalidWire:                   return "InvalidWire";
    case BRepCheck_RedundantWire:                 return "RedundantWire";
    case BRepCheck_IntersectingWires:             return "IntersectingWires";
    case BRepCheck_InvalidImbricationOfWires:     return "InvalidImbricationOfWires";
    case BRepCheck_EmptyShell:                    return "EmptyShell";
    case BRepCheck_RedundantFace:                 return "RedundantFace";
    case BRepCheck_InvalidImbricationOfShells:    return "InvalidImbricationOfShells";
    case BRepCheck_UnorientableShape:             return "UnorientableShape";
    case BRepCheck_NotClosed:                     return "NotClosed";
    case BRepCheck_NotConnected:                  return "NotConnected";
    case BRepCheck_SubshapeNotInShape:            return "SubshapeNotInShape";
    case BRepCheck_BadOrientation:                return "BadOrientation";
    case BRepCheck_BadOrientationOfSubshape:      return "BadOrientationOfSubshape";
    case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
    case BRepCheck_InvalidToleranceValue:         return "InvalidToleranceValue";
    case BRepCheck_EnclosedRegion:                return "EnclosedRegion";
    case BRepCheck_CheckFail:                     return "CheckFail";
    }
    return "UNKNOWN";
}

const char* typeName(TopAbs_ShapeEnum t) {
    switch (t) {
    case TopAbs_COMPOUND:  return "COMPOUND";
    case TopAbs_COMPSOLID: return "COMPSOLID";
    case TopAbs_SOLID:     return "SOLID";
    case TopAbs_SHELL:     return "SHELL";
    case TopAbs_FACE:      return "FACE";
    case TopAbs_WIRE:      return "WIRE";
    case TopAbs_EDGE:      return "EDGE";
    case TopAbs_VERTEX:    return "VERTEX";
    default:               return "SHAPE";
    }
}

const char* curveKind(const TopoDS_Edge& e) {
    BRepAdaptor_Curve ad;
    try { ad.Initialize(e); } catch (...) { return "?"; }
    switch (ad.GetType()) {
    case GeomAbs_Line:            return "Line";
    case GeomAbs_Circle:          return "Circle";
    case GeomAbs_Ellipse:         return "Ellipse";
    case GeomAbs_Hyperbola:       return "Hyperbola";
    case GeomAbs_Parabola:        return "Parabola";
    case GeomAbs_BezierCurve:     return "Bezier";
    case GeomAbs_BSplineCurve:    return "BSpline";
    case GeomAbs_OffsetCurve:     return "OffsetCurve";
    default:                      return "OtherCurve";
    }
}

const char* surfKind(const TopoDS_Face& f) {
    try {
        BRepAdaptor_Surface ad(f, Standard_False);
        switch (ad.GetType()) {
        case GeomAbs_Plane:              return "Plane";
        case GeomAbs_Cylinder:           return "Cylinder";
        case GeomAbs_Cone:               return "Cone";
        case GeomAbs_Sphere:             return "Sphere";
        case GeomAbs_Torus:              return "Torus";
        case GeomAbs_BezierSurface:      return "BezierSurf";
        case GeomAbs_BSplineSurface:     return "BSplineSurf";
        case GeomAbs_SurfaceOfRevolution:return "SurfRevol";
        case GeomAbs_SurfaceOfExtrusion: return "SurfExtrusion";
        case GeomAbs_OffsetSurface:      return "OffsetSurf";
        default:                         return "OtherSurf";
        }
    } catch (...) { return "?"; }
}

// ── the A/B's own input pick, copied verbatim in behaviour ──────────────────
double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
double edgeLength(const TopoDS_Edge& e) {
    GProp_GProps g;
    try { BRepGProp::LinearProperties(e, g); } catch (...) { return 0.0; }
    return g.Mass();
}
bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); first=false; }
        else {
            bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
            bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
            bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z());
        }
    }
    return !first;
}

std::string esc(const std::string& s) {
    std::string o;
    for (char c : s) { if (c == '"' || c == '\\') o += '\\'; o += c; }
    return o;
}


// A census of every non-NoError BRepCheck status in a shape, keyed
// "TYPE/Status" (self) and "TYPE in TYPE/Status" (contextual).
struct Census {
    bool valid = false;
    std::map<std::string, int> self, ctx;
    std::vector<TopoDS_Shape> badFaces, badWires;
};

Census censusOf(const TopoDS_Shape& sh) {
    Census c;
    BRepCheck_Analyzer an(sh);
    c.valid = an.IsValid() ? true : false;
    const TopAbs_ShapeEnum kinds[] = { TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE,
                                       TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID };
    for (TopAbs_ShapeEnum k : kinds) {
        TopTools_IndexedMapOfShape m;
        TopExp::MapShapes(sh, k, m);
        for (int i = 1; i <= m.Extent(); ++i) {
            const TopoDS_Shape& s = m(i);
            const Handle(BRepCheck_Result)& r = an.Result(s);
            if (r.IsNull()) continue;
            for (BRepCheck_ListIteratorOfListOfStatus it(r->Status()); it.More(); it.Next()) {
                if (it.Value() == BRepCheck_NoError) continue;
                c.self[std::string(typeName(k)) + "/" + statusName(it.Value())]++;
                if (k == TopAbs_FACE) c.badFaces.push_back(s);
                if (k == TopAbs_WIRE) c.badWires.push_back(s);
            }
            for (r->InitContextIterator(); r->MoreShapeInContext(); r->NextShapeInContext()) {
                const TopoDS_Shape cx = r->ContextualShape();
                for (BRepCheck_ListIteratorOfListOfStatus it(r->StatusOnShape()); it.More(); it.Next()) {
                    if (it.Value() == BRepCheck_NoError) continue;
                    c.ctx[std::string(typeName(k)) + " in " + typeName(cx.ShapeType())
                          + "/" + statusName(it.Value())]++;
                }
            }
        }
    }
    return c;
}

}  // namespace

int main(int argc, char** argv) {
    std::string stepPath, partName, family = "FILLET";
    bool listAll = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a.rfind("--name=", 0) == 0) partName = a.substr(7);
        else if (a.rfind("--family=", 0) == 0) family = a.substr(9);
        else if (a == "--list-all") listAll = true;
        else if (a.rfind("--", 0) == 0) { std::fprintf(stderr, "unknown flag %s\n", a.c_str()); return 2; }
        else stepPath = a;
    }
    if (stepPath.empty()) {
        std::fprintf(stderr, "usage: brepcheck_status_probe <part.step> [--name=ID] "
                             "[--family=FILLET|CHAMFER] [--list-all]\n");
        return 2;
    }
    if (partName.empty()) {
        const size_t sl = stepPath.find_last_of('/');
        partName = (sl == std::string::npos) ? stepPath : stepPath.substr(sl + 1);
        const size_t dot = partName.find_last_of('.');
        if (dot != std::string::npos) partName = partName.substr(0, dot);
    }

    TopoDS_Shape src;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) {}
        if (st != IFSelect_RetDone) { std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", partName.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { src = rd.OneShape(); } catch (...) {}
        if (src.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", partName.c_str()); return 1; }
    }
    double bb[6];
    if (!boundsOf(src, bb)) { std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", partName.c_str()); return 1; }
    const double dx = bb[3]-bb[0], dy = bb[4]-bb[1], dz = bb[5]-bb[2];
    const double minExt = std::min(dx, std::min(dy, dz));
    const double diag = std::sqrt(dx*dx + dy*dy + dz*dz);
    const bool flat = !(minExt > 1e-9 * diag);
    const double scale = flat ? diag * 0.05 : minExt;

    TopoDS_Edge lineEdge; double lineLen = 0.0;
    {
        TopTools_IndexedMapOfShape em;
        TopExp::MapShapes(src, TopAbs_EDGE, em);
        for (int i = 1; i <= em.Extent(); ++i) {
            const TopoDS_Edge e = TopoDS::Edge(em(i));
            BRepAdaptor_Curve ad;
            try { ad.Initialize(e); } catch (...) { continue; }
            if (ad.GetType() != GeomAbs_Line) continue;
            const double L = edgeLength(e);
            if (L > lineLen * (1.0 + 1e-12)) { lineEdge = e; lineLen = L; }
        }
    }
    if (lineEdge.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"no_line_edge\"}\n", partName.c_str()); return 1; }

    const double arg = 0.05 * scale;
    forge::occtfillet::Result res;
    if (family == "CHAMFER") {
        std::vector<forge::occtfillet::ChamferSpec> sp(1);
        sp[0].edge = lineEdge; sp[0].dist = arg; sp[0].dist2 = 0.0;
        try { res = forge::occtfillet::makeChamfer(src, sp); }
        catch (...) { res.ok = false; res.reason = "threw"; }
    } else {
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = lineEdge; sp[0].radius = arg;
        try { res = forge::occtfillet::makeFillet(src, sp); }
        catch (...) { res.ok = false; res.reason = "threw"; }
    }
    if (!res.ok || res.shape.IsNull()) {
        std::printf("{\"part\":\"%s\",\"family\":\"%s\",\"native_ok\":false,\"reason\":\"%s\"}\n",
                    partName.c_str(), family.c_str(), esc(res.reason).c_str());
        return 0;
    }

    const TopoDS_Shape out = res.shape;
    BRepCheck_Analyzer an(out);
    const bool valid = an.IsValid() ? true : false;

    // ── the census ───────────────────────────────────────────────────────────
    std::map<std::string, int> selfCount;    // "TYPE/Status"
    std::map<std::string, int> ctxCount;     // "TYPE in TYPE/Status"
    struct Bad { std::string kind, status, ctx, detail; };
    std::vector<Bad> bads;

    const TopAbs_ShapeEnum kinds[] = { TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE,
                                       TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID };
    int nSub = 0, nWithResult = 0;
    for (TopAbs_ShapeEnum k : kinds) {
        TopTools_IndexedMapOfShape m;
        TopExp::MapShapes(out, k, m);
        for (int i = 1; i <= m.Extent(); ++i) {
            const TopoDS_Shape& s = m(i);
            ++nSub;
            const Handle(BRepCheck_Result)& r = an.Result(s);
            if (r.IsNull()) continue;
            ++nWithResult;
            // self status
            {
                BRepCheck_ListIteratorOfListOfStatus it(r->Status());
                for (; it.More(); it.Next()) {
                    const BRepCheck_Status st = it.Value();
                    if (st == BRepCheck_NoError && !listAll) continue;
                    selfCount[std::string(typeName(k)) + "/" + statusName(st)]++;
                    if (st != BRepCheck_NoError) {
                        Bad b; b.kind = typeName(k); b.status = statusName(st); b.ctx = "-";
                        char d[256] = {0};
                        if (k == TopAbs_EDGE) {
                            const TopoDS_Edge e = TopoDS::Edge(s);
                            std::snprintf(d, sizeof d, "idx=%d curve=%s len=%.9g tol=%.9g",
                                          i, curveKind(e), edgeLength(e), BRep_Tool::Tolerance(e));
                        } else if (k == TopAbs_FACE) {
                            const TopoDS_Face f = TopoDS::Face(s);
                            std::snprintf(d, sizeof d, "idx=%d surf=%s area=%.9g tol=%.9g",
                                          i, surfKind(f), faceArea(f), BRep_Tool::Tolerance(f));
                        } else if (k == TopAbs_VERTEX) {
                            const TopoDS_Vertex v = TopoDS::Vertex(s);
                            const gp_Pnt p = BRep_Tool::Pnt(v);
                            std::snprintf(d, sizeof d, "idx=%d p=(%.9g,%.9g,%.9g) tol=%.9g",
                                          i, p.X(), p.Y(), p.Z(), BRep_Tool::Tolerance(v));
                        } else {
                            std::snprintf(d, sizeof d, "idx=%d", i);
                        }
                        b.detail = d;
                        bads.push_back(b);
                    }
                }
            }
            // contextual statuses
            for (r->InitContextIterator(); r->MoreShapeInContext(); r->NextShapeInContext()) {
                const TopoDS_Shape ctx = r->ContextualShape();
                BRepCheck_ListIteratorOfListOfStatus it(r->StatusOnShape());
                for (; it.More(); it.Next()) {
                    const BRepCheck_Status st = it.Value();
                    if (st == BRepCheck_NoError && !listAll) continue;
                    ctxCount[std::string(typeName(k)) + " in " + typeName(ctx.ShapeType())
                             + "/" + statusName(st)]++;
                    if (st != BRepCheck_NoError) {
                        Bad b; b.kind = typeName(k); b.status = statusName(st);
                        b.ctx = typeName(ctx.ShapeType());
                        char d[256] = {0};
                        if (k == TopAbs_EDGE) {
                            const TopoDS_Edge e = TopoDS::Edge(s);
                            std::snprintf(d, sizeof d, "idx=%d curve=%s len=%.9g tol=%.9g",
                                          i, curveKind(e), edgeLength(e), BRep_Tool::Tolerance(e));
                            if (ctx.ShapeType() == TopAbs_FACE) {
                                const TopoDS_Face cf = TopoDS::Face(ctx);
                                const size_t n = std::strlen(d);
                                std::snprintf(d + n, sizeof d - n, " ctxsurf=%s ctxarea=%.9g",
                                              surfKind(cf), faceArea(cf));
                            }
                        } else if (k == TopAbs_VERTEX) {
                            const TopoDS_Vertex v = TopoDS::Vertex(s);
                            const gp_Pnt p = BRep_Tool::Pnt(v);
                            std::snprintf(d, sizeof d, "idx=%d p=(%.9g,%.9g,%.9g) tol=%.9g",
                                          i, p.X(), p.Y(), p.Z(), BRep_Tool::Tolerance(v));
                            if (ctx.ShapeType() == TopAbs_EDGE) {
                                const TopoDS_Edge ce = TopoDS::Edge(ctx);
                                const size_t n = std::strlen(d);
                                std::snprintf(d + n, sizeof d - n, " ctxcurve=%s ctxlen=%.9g",
                                              curveKind(ce), edgeLength(ce));
                            }
                        } else if (k == TopAbs_WIRE || k == TopAbs_FACE) {
                            std::snprintf(d, sizeof d, "idx=%d", i);
                        } else {
                            std::snprintf(d, sizeof d, "idx=%d", i);
                        }
                        b.detail = d;
                        bads.push_back(b);
                    }
                }
            }
        }
    }
    // the top shape itself
    {
        const Handle(BRepCheck_Result)& r = an.Result(out);
        if (!r.IsNull()) {
            BRepCheck_ListIteratorOfListOfStatus it(r->Status());
            for (; it.More(); it.Next()) {
                const BRepCheck_Status st = it.Value();
                if (st == BRepCheck_NoError && !listAll) continue;
                selfCount[std::string("TOP:") + typeName(out.ShapeType()) + "/" + statusName(st)]++;
            }
        }
    }

    std::string line = "{";
    char head[512];
    std::snprintf(head, sizeof head,
                  "\"part\":\"%s\",\"family\":\"%s\",\"native_ok\":true,\"valid\":%s,"
                  "\"arg\":%.10g,\"nsub\":%d,\"nsub_with_result\":%d,\"nbad\":%d,",
                  partName.c_str(), family.c_str(), valid ? "true" : "false",
                  arg, nSub, nWithResult, static_cast<int>(bads.size()));
    line += head;
    line += "\"self\":{";
    bool first = true;
    for (const auto& kv : selfCount) {
        if (!first) line += ",";
        first = false;
        line += "\"" + esc(kv.first) + "\":" + std::to_string(kv.second);
    }
    line += "},\"ctx\":{";
    first = true;
    for (const auto& kv : ctxCount) {
        if (!first) line += ",";
        first = false;
        line += "\"" + esc(kv.first) + "\":" + std::to_string(kv.second);
    }
    line += "},\"bad\":[";
    first = true;
    int emitted = 0;
    for (const Bad& b : bads) {
        if (emitted++ >= 40) break;
        if (!first) line += ",";
        first = false;
        line += "{\"kind\":\"" + b.kind + "\",\"status\":\"" + b.status +
                "\",\"ctx\":\"" + b.ctx + "\",\"detail\":\"" + esc(b.detail) + "\"}";
    }
    line += "],";

    // ── CONTROL 1: is the SOURCE part already invalid there? ────────────────
    // If the input STEP carries the same defect, native is not creating it and
    // OCCT's arm is repairing it — a completely different story from "native
    // breaks the face". This must be measured, not assumed.
    const Census sc = censusOf(src);
    {
        char b[128];
        std::snprintf(b, sizeof b, "\"src_valid\":%s,", sc.valid ? "true" : "false");
        line += b;
        line += "\"src_self\":{";
        bool f2 = true;
        for (const auto& kv : sc.self) {
            if (!f2) line += ","; f2 = false;
            line += "\"" + esc(kv.first) + "\":" + std::to_string(kv.second);
        }
        line += "},";
    }

    // ── CONTROL 2: WHICH face is the bad one? ──────────────────────────────
    // Two questions decide whether this is the retrim path:
    //   adj_to_edge — does the bad face lie in the plane of one of the (<=2)
    //                 SOURCE faces adjacent to the very edge that was filleted?
    //   area_in_src — is its area equal to some source face's area, i.e. was it
    //                 copied through verbatim rather than re-trimmed?
    std::vector<gp_Pln> adjPlanes;
    {
        TopTools_IndexedDataMapOfShapeListOfShape efm;
        TopExp::MapShapesAndAncestors(src, TopAbs_EDGE, TopAbs_FACE, efm);
        if (efm.Contains(lineEdge)) {
            const TopTools_ListOfShape& fl = efm.FindFromKey(lineEdge);
            for (TopTools_ListIteratorOfListOfShape it(fl); it.More(); it.Next()) {
                Handle(Geom_Surface) gs = BRep_Tool::Surface(TopoDS::Face(it.Value()));
                Handle(Geom_Plane) gp = Handle(Geom_Plane)::DownCast(gs);
                if (!gp.IsNull()) adjPlanes.push_back(gp->Pln());
            }
        }
    }
    // The SOURCE faces adjacent to the filleted edge, with their wire structure —
    // the "before" picture for whatever the retrim produced.
    std::string srcAdjJson = "[";
    {
        TopTools_IndexedDataMapOfShapeListOfShape efm;
        TopExp::MapShapesAndAncestors(src, TopAbs_EDGE, TopAbs_FACE, efm);
        bool fa = true;
        if (efm.Contains(lineEdge)) {
            const TopTools_ListOfShape& fl = efm.FindFromKey(lineEdge);
            for (TopTools_ListIteratorOfListOfShape it(fl); it.More(); it.Next()) {
                const TopoDS_Face f = TopoDS::Face(it.Value());
                int nw = 0; std::string wd;
                for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
                    ++nw;
                    int ne = 0;
                    for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next()) ++ne;
                    double wl = 0.0; GProp_GProps gl;
                    try { BRepGProp::LinearProperties(wx.Current(), gl); wl = gl.Mass(); } catch (...) {}
                    char wb[64];
                    std::snprintf(wb, sizeof wb, "%s%d:%.6g", nw > 1 ? "|" : "", ne, wl);
                    wd += wb;
                }
                // Same question inside the OUTER ring: how close does the
                // filleted edge come to a ring segment it does NOT share a
                // vertex with, and how long are the two segments it DOES touch?
                double dRing = -1.0, nbrMin = -1.0, nbrMax = -1.0;
                {
                    const TopoDS_Wire ow2 = BRepTools::OuterWire(f);
                    TopTools_IndexedMapOfShape vm;
                    TopExp::MapShapes(lineEdge, TopAbs_VERTEX, vm);
                    for (TopExp_Explorer ex(ow2, TopAbs_EDGE); ex.More(); ex.Next()) {
                        const TopoDS_Edge oe = TopoDS::Edge(ex.Current());
                        if (oe.IsSame(lineEdge)) continue;
                        bool shares = false;
                        for (TopExp_Explorer vx(oe, TopAbs_VERTEX); vx.More(); vx.Next())
                            for (int q = 1; q <= vm.Extent(); ++q)
                                if (vx.Current().IsSame(vm(q))) shares = true;
                        if (shares) {
                            const double L = edgeLength(oe);
                            if (nbrMin < 0.0 || L < nbrMin) nbrMin = L;
                            if (L > nbrMax) nbrMax = L;
                            continue;
                        }
                        try {
                            BRepExtrema_DistShapeShape dss(lineEdge, oe);
                            if (dss.IsDone() && dss.NbSolution() > 0) {
                                const double d = dss.Value();
                                if (dRing < 0.0 || d < dRing) dRing = d;
                            }
                        } catch (...) {}
                    }
                }
                // How close does the edge being filleted come to the nearest
                // INNER wire (hole) of this face? The retrim shifts this edge
                // inward by the setback; if a hole is nearer than that shift,
                // the new outer ring must cross the hole.
                double dHole = -1.0;
                {
                    const TopoDS_Wire ow = BRepTools::OuterWire(f);
                    for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
                        if (wx.Current().IsSame(ow)) continue;
                        try {
                            BRepExtrema_DistShapeShape dss(lineEdge, wx.Current());
                            if (dss.IsDone() && dss.NbSolution() > 0) {
                                const double d = dss.Value();
                                if (dHole < 0.0 || d < dHole) dHole = d;
                            }
                        } catch (...) {}
                    }
                }
                if (!fa) srcAdjJson += ",";
                fa = false;
                char b[512];
                std::snprintf(b, sizeof b, "{\"surf\":\"%s\",\"area\":%.10g,\"nwires\":%d,\"wires\":\"%s\","
                              "\"edge_to_nearest_hole\":%.10g,\"edge_to_nonadj_ring\":%.10g,"
                              "\"nbr_seg_min\":%.10g,\"nbr_seg_max\":%.10g}",
                              surfKind(f), faceArea(f), nw, wd.c_str(), dHole, dRing, nbrMin, nbrMax);
                srcAdjJson += b;
            }
        }
        srcAdjJson += "]";
    }

    std::vector<double> srcAreas;
    {
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(src, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) srcAreas.push_back(faceArea(TopoDS::Face(fm(i))));
    }
    {
        char b[64];
        std::snprintf(b, sizeof b, "\"n_adj_planes\":%d,\"badfaces\":[",
                      static_cast<int>(adjPlanes.size()));
        line += b;
    }
    bool f3 = true;
    // Bad faces of the OUTPUT: the ones BRepCheck flagged directly, plus the
    // faces that own a flagged wire (the UnorientableShape/SelfIntersectingWire
    // pair attaches to a face and a wire of the same face).
    const Census oc = censusOf(out);
    std::vector<TopoDS_Shape> targets = oc.badFaces;
    for (const TopoDS_Shape& w : oc.badWires) {
        TopTools_IndexedDataMapOfShapeListOfShape wfm;
        TopExp::MapShapesAndAncestors(out, TopAbs_WIRE, TopAbs_FACE, wfm);
        if (wfm.Contains(w)) {
            const TopTools_ListOfShape& fl = wfm.FindFromKey(w);
            for (TopTools_ListIteratorOfListOfShape it(fl); it.More(); it.Next()) {
                bool seen = false;
                for (const TopoDS_Shape& t : targets) if (t.IsSame(it.Value())) seen = true;
                if (!seen) targets.push_back(it.Value());
            }
        }
    }
    for (const TopoDS_Shape& fs : targets) {
        const TopoDS_Face f = TopoDS::Face(fs);
        const double a = faceArea(f);
        int nw = 0;
        std::string wireDesc;
        for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
            ++nw;
            int ne = 0;
            for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next()) ++ne;
            double wl = 0.0;
            GProp_GProps gl;
            try { BRepGProp::LinearProperties(wx.Current(), gl); wl = gl.Mass(); } catch (...) {}
            char wb[64];
            std::snprintf(wb, sizeof wb, "%s%d:%.6g", nw > 1 ? "|" : "", ne, wl);
            wireDesc += wb;
        }
        bool adj = false;
        double planeDist = -1.0;
        Handle(Geom_Surface) gs = BRep_Tool::Surface(f);
        Handle(Geom_Plane) gpl = Handle(Geom_Plane)::DownCast(gs);
        if (!gpl.IsNull()) {
            for (const gp_Pln& ap : adjPlanes) {
                const bool par = ap.Axis().Direction().IsParallel(gpl->Pln().Axis().Direction(), 1e-6);
                const double d = ap.Distance(gpl->Pln().Location());
                if (planeDist < 0.0 || d < planeDist) planeDist = d;
                if (par && d < 1e-6 * std::max(1.0, diag)) adj = true;
            }
        }
        bool areaInSrc = false;
        for (double sa : srcAreas)
            if (std::fabs(sa - a) <= 1e-9 * std::max(1.0, std::fabs(a))) { areaInSrc = true; break; }
        // The pairwise minimum distance between this face's wires. A pair at
        // (near) zero IS the intersection BRepCheck is complaining about, and
        // names it in geometry rather than in an enum.
        double minPair = -1.0; int mi = -1, mj = -1;
        {
            std::vector<TopoDS_Shape> ws;
            for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) ws.push_back(wx.Current());
            for (std::size_t i = 0; i + 1 < ws.size(); ++i)
                for (std::size_t j = i + 1; j < ws.size(); ++j) {
                    try {
                        BRepExtrema_DistShapeShape dss(ws[i], ws[j]);
                        if (dss.IsDone() && dss.NbSolution() > 0) {
                            const double d = dss.Value();
                            if (minPair < 0.0 || d < minPair) { minPair = d; mi = (int)i; mj = (int)j; }
                        }
                    } catch (...) {}
                }
        }
        // SELF-intersection: the closest pair of edges WITHIN one wire that do
        // not share a vertex. On a simple ring this is a positive number; a
        // (near) zero is the fold BRepCheck is calling SelfIntersectingWire.
        double selfMin = -1.0;
        {
            for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
                std::vector<TopoDS_Shape> es;
                for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next())
                    es.push_back(ex.Current());
                for (std::size_t i = 0; i < es.size(); ++i)
                    for (std::size_t j = i + 1; j < es.size(); ++j) {
                        bool shares = false;
                        TopTools_IndexedMapOfShape vi;
                        TopExp::MapShapes(es[i], TopAbs_VERTEX, vi);
                        for (TopExp_Explorer vx(es[j], TopAbs_VERTEX); vx.More(); vx.Next())
                            for (int q = 1; q <= vi.Extent(); ++q)
                                if (vx.Current().IsSame(vi(q))) shares = true;
                        if (shares) continue;
                        try {
                            BRepExtrema_DistShapeShape dss(es[i], es[j]);
                            if (dss.IsDone() && dss.NbSolution() > 0) {
                                const double d = dss.Value();
                                if (selfMin < 0.0 || d < selfMin) selfMin = d;
                            }
                        } catch (...) {}
                    }
            }
        }
        // IS THE CONTACT A GRAZE OR A CROSSING? Two independent readings.
        //  (a) sample each INNER wire and classify the points against a face built
        //      from the OUTER ring alone: a point OUT means the hole straddles the
        //      new boundary, which is a real overlap, not a tangency.
        //  (b) at the closest non-adjacent pair inside one wire, is the contact
        //      strictly INTERIOR to both edges (BRepExtrema_IsOnEdge on both)? An
        //      endpoint touch is a shared corner; an interior touch is a fold.
        int holePtsOut = 0, holePtsTot = 0;
        {
            const TopoDS_Wire ow3 = BRepTools::OuterWire(f);
            Handle(Geom_Surface) gs3 = BRep_Tool::Surface(f);
            Handle(Geom_Plane) gp3 = Handle(Geom_Plane)::DownCast(gs3);
            if (!gp3.IsNull()) {
                BRepBuilderAPI_MakeFace mf3(gp3->Pln(), ow3);
                if (mf3.IsDone()) {
                    const TopoDS_Face onlyOuter = mf3.Face();
                    const double tol3 = 1e-7 * std::max(1.0, diag);
                    for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
                        if (wx.Current().IsSame(ow3)) continue;
                        for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next()) {
                            double t0 = 0, t1 = 0;
                            Handle(Geom_Curve) cc = BRep_Tool::Curve(TopoDS::Edge(ex.Current()), t0, t1);
                            if (cc.IsNull()) continue;
                            for (int q = 0; q <= 16; ++q) {
                                const gp_Pnt P = cc->Value(t0 + (t1 - t0) * (q / 16.0));
                                GeomAPI_ProjectPointOnSurf pr(P, gp3, Extrema_ExtAlgo_Grad);
                                if (!pr.IsDone() || pr.NbPoints() < 1) continue;
                                Standard_Real u = 0, v = 0;
                                pr.LowerDistanceParameters(u, v);
                                BRepClass_FaceClassifier cl(onlyOuter, gp_Pnt2d(u, v), tol3);
                                ++holePtsTot;
                                if (cl.State() == TopAbs_OUT) ++holePtsOut;
                            }
                        }
                    }
                }
            }
        }
        int selfInteriorContacts = 0;
        {
            for (TopExp_Explorer wx(f, TopAbs_WIRE); wx.More(); wx.Next()) {
                std::vector<TopoDS_Shape> es;
                for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next())
                    es.push_back(ex.Current());
                for (std::size_t i = 0; i < es.size(); ++i)
                    for (std::size_t j = i + 1; j < es.size(); ++j) {
                        bool shares = false;
                        TopTools_IndexedMapOfShape vi;
                        TopExp::MapShapes(es[i], TopAbs_VERTEX, vi);
                        for (TopExp_Explorer vx(es[j], TopAbs_VERTEX); vx.More(); vx.Next())
                            for (int q = 1; q <= vi.Extent(); ++q)
                                if (vx.Current().IsSame(vi(q))) shares = true;
                        if (shares) continue;
                        try {
                            BRepExtrema_DistShapeShape dss(es[i], es[j]);
                            if (!dss.IsDone() || dss.NbSolution() < 1) continue;
                            if (dss.Value() > 1e-7 * std::max(1.0, diag)) continue;
                            for (int k2 = 1; k2 <= dss.NbSolution(); ++k2)
                                if (dss.SupportTypeShape1(k2) == BRepExtrema_IsOnEdge &&
                                    dss.SupportTypeShape2(k2) == BRepExtrema_IsOnEdge)
                                    ++selfInteriorContacts;
                        } catch (...) {}
                    }
            }
        }
        if (!f3) line += ",";
        f3 = false;
        char b[640];
        std::snprintf(b, sizeof b,
            "{\"surf\":\"%s\",\"area\":%.10g,\"nwires\":%d,\"wires\":\"%s\","
            "\"adj_to_filleted_edge\":%s,\"plane_dist\":%.6g,\"area_in_src\":%s,"
            "\"min_wire_pair_dist\":%.10g,\"min_pair\":[%d,%d],\"min_self_edge_dist\":%.10g,\"hole_pts_out\":%d,\"hole_pts_tot\":%d,\"self_interior_contacts\":%d}",
            surfKind(f), a, nw, wireDesc.c_str(), adj ? "true" : "false",
            planeDist, areaInSrc ? "true" : "false", minPair, mi, mj, selfMin,
            holePtsOut, holePtsTot, selfInteriorContacts);
        line += b;
    }
    line += "],\"src_adj_faces\":" + srcAdjJson + "}";
    std::printf("%s\n", line.c_str());
    return 0;
}
