// test/native_vs_occt_validator.cpp
//
// 1:1 A/B-vs-OCCT harness for the K5 / H1.1 NATIVE B-REP VALIDATOR
// (forge::native::brep::checkBRep, include/forge/native/brep/Check.hpp).
//
// For each of FIVE cases we build BOTH:
//   (a) the NATIVE geometry-bearing shape (mirroring test/native/brep/
//       validator_test.cpp's clean box + the 4 injected-defect constructions
//       EXACTLY) and run checkBRep();
//   (b) the EQUIVALENT OCCT shape and run BRepCheck (the BRepCheck_Analyzer of
//       src/ShapeCheck.cpp, AND the dedicated BRepCheck_Shell/Edge checkers that
//       expose the named BRepCheck_Status for the shell-level closure/orientation/
//       multi-connexity faults the top-level analyzer flags only as IsValid==false).
//
// We then compare, per case:
//   * the VALID/INVALID verdict — native CheckReport.valid vs the OCCT verdict
//     (must agree 5/5), and
//   * the failed status NAMES — native failedStatuses() vs the BRepCheck_Status
//     names OCCT reports (the per-status A/B mapping).
//
// HONESTY: BRepCheck_Analyzer::IsValid() does NOT, by itself, surface a named
// status for shell-level closure / orientation / non-manifold faults in OCCT 7.9.3
// (its public per-sub-shape Status() list reads NoError on the solid even when
// IsValid()==false). OCCT's OWN oracle for those is the dedicated checker class —
// BRepCheck_Shell::Closed()/Orientation() returns BRepCheck_NotClosed /
// BRepCheck_BadOrientationOfSubshape / BRepCheck_InvalidMultiConnexity directly.
// That is the named OCCT status we compare against; the geometric edge fault
// (zero-length) DOES surface through the analyzer (BRepCheck_InvalidRange). This
// is the real OCCT validation machinery, no shim.
//
// CASES (mirroring validator_test.cpp), with the native status -> OCCT status map:
//   0  valid sewn box        -> both VALID,   no failed status
//   1  flipped face          -> both INVALID, native BadOrientationFace
//                                ~ OCCT BadOrientationOfSubshape (BRepCheck_Shell)
//   2  zero-length edge       -> both INVALID, native ZeroLengthEdge
//                                ~ OCCT InvalidRange (BRepCheck_Analyzer)
//   3  non-manifold 3rd coedge-> both INVALID, native InvalidMultiConnexity +
//                                NonManifoldEdge ~ OCCT InvalidMultiConnexity (Shell)
//   4  dropped face (free edges)-> both INVALID, native NotClosed
//                                ~ OCCT NotClosed (BRepCheck_Shell)
//
// verdict=PASS only if the VALID/INVALID verdict agrees on all 5 cases AND the
// native failed-status set maps onto OCCT's reported status set per defect.
//
// BUILD (standalone C++20, links OCCT):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_validator.cpp \
//     forge-kernel/src/native/brep/Check.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/src/native/ExactReal.cpp \
//     forge-kernel/src/native/ExactPredicates3D.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKShHealing \
//     -o /tmp/native_vs_occt_validator && /tmp/native_vs_occt_validator

// ───────────────────────────── NATIVE side ──────────────────────────────────
#include "forge/native/brep/Check.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Curve.hpp"

// ───────────────────────────── OCCT side ────────────────────────────────────
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Shell.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Status.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Line.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

using namespace forge::native::brep;

// ============================================================================
// NATIVE box builder — copied VERBATIM from test/native/brep/validator_test.cpp
// so the native side of the A/B is byte-for-byte the gated construction.
// ============================================================================
struct GeoBox {
    TopologyBuilder tb;
    Solid* solid = nullptr;
    Shell* shell = nullptr;
    std::vector<Face*> faces;
};

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

static void buildGeoBox(GeoBox& gb, double L) {
    gb.solid = gb.tb.buildBox({0, 0, 0}, {L, L, L});
    gb.shell = gb.solid->shells.front();
    gb.faces.assign(gb.shell->faces.begin(), gb.shell->faces.end());

    const Point3 ctr{L * 0.5, L * 0.5, L * 0.5};
    for (Face* f : gb.faces) {
        std::vector<Coedge*> ring = ringCoedges(f->outerLoop);
        if (ring.size() < 3) continue;
        Vec3 nrm{0, 0, 0};
        const std::size_t n = ring.size();
        for (std::size_t i = 0; i < n; ++i) {
            const Point3& a = ring[i]->originVertex()->point;
            const Point3& b = ring[(i + 1) % n]->originVertex()->point;
            nrm.x += (a.y - b.y) * (a.z + b.z);
            nrm.y += (a.z - b.z) * (a.x + b.x);
            nrm.z += (a.x - b.x) * (a.y + b.y);
        }
        Vec3 nn = vnormL(nrm);
        Point3 fc{0, 0, 0};
        for (Coedge* c : ring) { const Point3& p = c->originVertex()->point; fc.x += p.x; fc.y += p.y; fc.z += p.z; }
        fc.x /= n; fc.y /= n; fc.z /= n;
        Vec3 outward = vnormL({fc.x - ctr.x, fc.y - ctr.y, fc.z - ctr.z});
        if (vdotL(nn, outward) < 0) nn = {-nn.x, -nn.y, -nn.z};

        Surface* s = gb.tb.makeSurface();
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
            c->pcurve = gb.tb.makePcurve(PCurve::makeLine2(a, b));
            Edge* e = c->edge;
            if (e->curve == nullptr) {
                Vec3 p0 = (e->start ? Vec3{e->start->point.x, e->start->point.y, e->start->point.z} : Vec3{});
                Vec3 p1 = (e->end   ? Vec3{e->end->point.x,   e->end->point.y,   e->end->point.z}   : Vec3{});
                e->curve = gb.tb.makeCurve(Curve::makeLine(p0, p1));
            }
        }
    }
}

// ============================================================================
// OCCT side.
// ============================================================================
static const char* occtStatusName(BRepCheck_Status s) {
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
    return "UnknownStatus";
}

// Collect the distinct set of non-NoError BRepCheck_Status NAMES the analyzer
// reports over the whole shape (top + every sub-shape kind), mirroring the walk
// in src/ShapeCheck.cpp. Surfaces edge/wire/face geometric faults (e.g. the
// zero-length edge's InvalidRange).
static std::set<std::string> occtAnalyzerStatuses(const TopoDS_Shape& s) {
    std::set<std::string> names;
    BRepCheck_Analyzer chk(s, Standard_True);
    auto pull = [&](const TopoDS_Shape& sub) {
        if (chk.IsValid(sub)) return;
        Handle(BRepCheck_Result) res = chk.Result(sub);
        if (res.IsNull()) return;
        for (BRepCheck_ListIteratorOfListOfStatus it(res->Status()); it.More(); it.Next())
            if (it.Value() != BRepCheck_NoError) names.insert(occtStatusName(it.Value()));
        res->InitContextIterator();
        for (; res->MoreShapeInContext(); res->NextShapeInContext())
            for (BRepCheck_ListIteratorOfListOfStatus it(res->StatusOnShape()); it.More(); it.Next())
                if (it.Value() != BRepCheck_NoError) names.insert(occtStatusName(it.Value()));
    };
    pull(s);
    constexpr TopAbs_ShapeEnum kinds[] = {
        TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE, TopAbs_WIRE, TopAbs_EDGE, TopAbs_VERTEX
    };
    for (auto kind : kinds) {
        TopTools_IndexedMapOfShape sub;
        TopExp::MapShapes(s, kind, sub);
        for (Standard_Integer i = 1; i <= sub.Extent(); ++i) pull(sub(i));
    }
    return names;
}

static bool occtAnalyzerValid(const TopoDS_Shape& s) {
    BRepCheck_Analyzer chk(s, Standard_True);
    return chk.IsValid();
}

// OCCT planar quad face from 4 CCW corner points.
static TopoDS_Face occtQuadFace(const gp_Pnt& a, const gp_Pnt& b,
                                const gp_Pnt& c, const gp_Pnt& d) {
    BRepBuilderAPI_MakePolygon poly(a, b, c, d, Standard_True);
    return BRepBuilderAPI_MakeFace(poly.Wire()).Face();
}

static void boxCorners(double L, gp_Pnt c[8]) {
    c[0] = gp_Pnt(0, 0, 0); c[1] = gp_Pnt(L, 0, 0);
    c[2] = gp_Pnt(L, L, 0); c[3] = gp_Pnt(0, L, 0);
    c[4] = gp_Pnt(0, 0, L); c[5] = gp_Pnt(L, 0, L);
    c[6] = gp_Pnt(L, L, L); c[7] = gp_Pnt(0, L, L);
}

// The six CCW-outward box faces.
static void boxFaces(double L, TopoDS_Face F[6]) {
    gp_Pnt c[8]; boxCorners(L, c);
    F[0] = occtQuadFace(c[0], c[3], c[2], c[1]); // bottom z=0
    F[1] = occtQuadFace(c[4], c[5], c[6], c[7]); // top    z=L
    F[2] = occtQuadFace(c[0], c[1], c[5], c[4]); // front  y=0
    F[3] = occtQuadFace(c[3], c[7], c[6], c[2]); // back   y=L
    F[4] = occtQuadFace(c[0], c[4], c[7], c[3]); // left   x=0
    F[5] = occtQuadFace(c[1], c[2], c[6], c[5]); // right  x=L
}

// Sew the six box faces (optionally dropping one). Returns the sewn shell shape.
static TopoDS_Shape occtBoxShellSewn(double L, int dropFace) {
    TopoDS_Face F[6]; boxFaces(L, F);
    BRepBuilderAPI_Sewing sew(1e-6);
    for (int i = 0; i < 6; ++i) if (i != dropFace) sew.Add(F[i]);
    sew.Perform();
    return sew.SewedShape();
}

// A genuine zero-length OCCT edge: a real Geom_Line with a degenerate [0,0]
// parameter range and coincident endpoint vertices. BRepCheck_Analyzer flags it
// BRepCheck_InvalidRange — OCCT's named equivalent of native ZeroLengthEdge.
static TopoDS_Edge occtZeroLengthEdge(const gp_Pnt& p) {
    BRep_Builder bb;
    Handle(Geom_Line) line = new Geom_Line(p, gp_Dir(1, 0, 0));
    TopoDS_Vertex va = BRepBuilderAPI_MakeVertex(p);
    TopoDS_Vertex vb = BRepBuilderAPI_MakeVertex(p);
    TopoDS_Edge e; bb.MakeEdge(e, line, 1e-7);
    bb.Add(e, va.Oriented(TopAbs_FORWARD));
    bb.Add(e, vb.Oriented(TopAbs_REVERSED));
    bb.Range(e, 0.0, 0.0);
    bb.UpdateVertex(va, 0.0, e, 1e-7);
    bb.UpdateVertex(vb, 0.0, e, 1e-7);
    return e;
}

// A manual shell of THREE faces all sharing ONE common edge (e01: P0->P1), so
// that edge has three face-uses (non-manifold). BRepCheck_Shell::Closed() reports
// BRepCheck_InvalidMultiConnexity on it — OCCT's named equivalent of native
// InvalidMultiConnexity / NonManifoldEdge.
static TopoDS_Shell occtThreeFaceNonManifold(double L) {
    BRep_Builder bb;
    gp_Pnt P0(0, 0, 0), P1(L, 0, 0);
    TopoDS_Edge e01 = BRepBuilderAPI_MakeEdge(P0, P1).Edge();
    auto faceUsing = [&](gp_Pnt cpt, gp_Pnt d) -> TopoDS_Face {
        BRepBuilderAPI_MakeWire mw;
        mw.Add(e01);
        mw.Add(BRepBuilderAPI_MakeEdge(P1, cpt).Edge());
        mw.Add(BRepBuilderAPI_MakeEdge(cpt, d).Edge());
        mw.Add(BRepBuilderAPI_MakeEdge(d, P0).Edge());
        return BRepBuilderAPI_MakeFace(mw.Wire()).Face();
    };
    TopoDS_Face f1 = faceUsing(gp_Pnt(L, L, 0), gp_Pnt(0, L, 0));    // into +y
    TopoDS_Face f2 = faceUsing(gp_Pnt(L, 0, L), gp_Pnt(0, 0, L));    // into +z
    TopoDS_Face f3 = faceUsing(gp_Pnt(L, 0, -L), gp_Pnt(0, 0, -L));  // into -z
    TopoDS_Shell sh; bb.MakeShell(sh);
    bb.Add(sh, f1); bb.Add(sh, f2); bb.Add(sh, f3);
    return sh;
}

// ============================================================================
// A/B comparison bookkeeping.
// ============================================================================
static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("    %s %s\n", cond ? "[PASS]" : "[FAIL]", name.c_str());
    if (cond) ++g_pass;
}

static std::set<std::string> nativeFailedStatusNames(const CheckReport& r) {
    std::set<std::string> out;
    for (CheckStatus s : r.failedStatuses()) out.insert(checkStatusName(s));
    return out;
}

static std::string joinSet(const std::set<std::string>& s) {
    if (s.empty()) return "{}";
    std::string out = "{";
    bool first = true;
    for (const auto& x : s) { if (!first) out += ", "; out += x; first = false; }
    return out + "}";
}

int main() {
    std::printf("=== NATIVE vs OCCT — K5 B-rep VALIDATOR A/B harness (5 cases) ===\n");
    const double L = 4.0;

    bool verdictAgreeAll = true;
    bool statusMapAll     = true;

    // ──────────────────────────────────────────────────────────────────────
    // CASE 0 — VALID SEWN BOX. OCCT: the primitive box solid (canonical valid).
    // ──────────────────────────────────────────────────────────────────────
    {
        std::printf("\n[CASE 0] valid sewn box\n");
        GeoBox gb; buildGeoBox(gb, L);
        CheckReport nr = checkBRep(gb.shell);
        auto nfs = nativeFailedStatusNames(nr);

        TopoDS_Shape os = BRepPrimAPI_MakeBox(L, L, L).Solid();
        bool ov = occtAnalyzerValid(os);
        auto ofs = occtAnalyzerStatuses(os);

        std::printf("    NATIVE: valid=%s  failedStatuses=%s\n",
                    nr.valid ? "true" : "false", joinSet(nfs).c_str());
        std::printf("    OCCT  : valid=%s  failedStatuses=%s  [BRepCheck_Analyzer on Solid]\n",
                    ov ? "true" : "false", joinSet(ofs).c_str());

        bool verdictAgree = (nr.valid == ov) && nr.valid;
        check(verdictAgree, "CASE 0 verdict agrees (both VALID)");
        bool statusMap = nfs.empty() && ofs.empty();
        check(statusMap, "CASE 0 status sets both empty");
        verdictAgreeAll &= verdictAgree; statusMapAll &= statusMap;
    }

    // ──────────────────────────────────────────────────────────────────────
    // CASE 1 — FLIPPED FACE. Native: reverse Surface::reversed on face 0
    // (G3.FaceNormalOutward -> BadOrientationFace). OCCT: sew the closed box
    // shell, reverse one face's orientation, and ask BRepCheck_Shell::Orientation
    // -> BRepCheck_BadOrientationOfSubshape.
    // ──────────────────────────────────────────────────────────────────────
    {
        std::printf("\n[CASE 1] flipped face normal\n");
        GeoBox gb; buildGeoBox(gb, L);
        gb.faces[0]->surface->reversed = !gb.faces[0]->surface->reversed;
        CheckReport nr = checkBRep(gb.shell);
        auto nfs = nativeFailedStatusNames(nr);

        // OCCT: closed sewn shell with face #0 reversed.
        TopoDS_Shape sewn = occtBoxShellSewn(L, /*dropFace=*/-1);
        TopoDS_Shell shell = TopoDS::Shell(sewn);
        BRep_Builder bb;
        TopoDS_Shell ns; bb.MakeShell(ns);
        bool flippedOne = false;
        for (TopExp_Explorer fe(shell, TopAbs_FACE); fe.More(); fe.Next()) {
            TopoDS_Face ff = TopoDS::Face(fe.Current());
            if (!flippedOne) { ff.Reverse(); flippedOne = true; }
            bb.Add(ns, ff);
        }
        BRepCheck_Shell sck(ns);
        BRepCheck_Status closedSt = sck.Closed();
        BRepCheck_Status orientSt = sck.Orientation();
        std::set<std::string> ofs;
        if (closedSt != BRepCheck_NoError) ofs.insert(occtStatusName(closedSt));
        if (orientSt != BRepCheck_NoError) ofs.insert(occtStatusName(orientSt));
        bool ov = ofs.empty();

        std::printf("    NATIVE: valid=%s  failedStatuses=%s\n",
                    nr.valid ? "true" : "false", joinSet(nfs).c_str());
        std::printf("    OCCT  : valid=%s  failedStatuses=%s  [BRepCheck_Shell Closed=%s Orientation=%s]\n",
                    ov ? "true" : "false", joinSet(ofs).c_str(),
                    occtStatusName(closedSt), occtStatusName(orientSt));

        bool verdictAgree = (nr.valid == ov) && !nr.valid;
        check(verdictAgree, "CASE 1 verdict agrees (both INVALID)");
        bool nativeHas = nfs.count("BadOrientationFace") > 0;
        bool occtHas = ofs.count("BadOrientationOfSubshape") > 0 ||
                       ofs.count("BadOrientation") > 0 ||
                       ofs.count("UnorientableShape") > 0;
        check(nativeHas, "CASE 1 native reports BadOrientationFace");
        check(occtHas, "CASE 1 OCCT reports a BadOrientation-family status");
        bool statusMap = nativeHas && occtHas;
        verdictAgreeAll &= verdictAgree; statusMapAll &= statusMap;
    }

    // ──────────────────────────────────────────────────────────────────────
    // CASE 2 — ZERO-LENGTH EDGE. Native: snap an edge's endpoints together +
    // collapse its Line curve (G1.NoZeroLengthEdge -> ZeroLengthEdge). OCCT: a
    // hand-built degenerate-range edge -> BRepCheck_Analyzer flags InvalidRange.
    // ──────────────────────────────────────────────────────────────────────
    {
        std::printf("\n[CASE 2] zero-length edge\n");
        GeoBox gb; buildGeoBox(gb, L);
        std::vector<Coedge*> ring = ringCoedges(gb.faces[0]->outerLoop);
        Edge* victim = ring[0]->edge;
        victim->end->point = victim->start->point;
        if (victim->curve) {
            Vec3 p = {victim->start->point.x, victim->start->point.y, victim->start->point.z};
            *victim->curve = Curve::makeLine(p, p);
        }
        CheckReport nr = checkBRep(gb.shell);
        auto nfs = nativeFailedStatusNames(nr);

        TopoDS_Edge oe = occtZeroLengthEdge(gp_Pnt(0, 0, 0));
        bool ov = occtAnalyzerValid(oe);
        auto ofs = occtAnalyzerStatuses(oe);

        std::printf("    NATIVE: valid=%s  failedStatuses=%s\n",
                    nr.valid ? "true" : "false", joinSet(nfs).c_str());
        std::printf("    OCCT  : valid=%s  failedStatuses=%s  [BRepCheck_Analyzer on zero-range Edge]\n",
                    ov ? "true" : "false", joinSet(ofs).c_str());

        bool verdictAgree = (nr.valid == ov) && !nr.valid;
        check(verdictAgree, "CASE 2 verdict agrees (both INVALID)");
        bool nativeHas = nfs.count("ZeroLengthEdge") > 0;
        bool occtHas = ofs.count("InvalidRange") > 0 ||
                       ofs.count("Invalid3DCurve") > 0 ||
                       ofs.count("InvalidDegeneratedFlag") > 0;
        check(nativeHas, "CASE 2 native reports ZeroLengthEdge");
        check(occtHas, "CASE 2 OCCT reports InvalidRange (degenerate edge)");
        bool statusMap = nativeHas && occtHas;
        verdictAgreeAll &= verdictAgree; statusMapAll &= statusMap;
    }

    // ──────────────────────────────────────────────────────────────────────
    // CASE 3 — NON-MANIFOLD 3rd COEDGE. Native: graft a triangle whose first
    // coedge re-points at a box edge -> that edge reads 3 coedge uses
    // (T1 InvalidMultiConnexity + T9 NonManifoldEdge). OCCT: a manual shell of
    // THREE faces sharing ONE edge -> BRepCheck_Shell::Closed reports
    // BRepCheck_InvalidMultiConnexity.
    // ──────────────────────────────────────────────────────────────────────
    {
        std::printf("\n[CASE 3] non-manifold 3rd coedge on one edge\n");
        GeoBox gb; buildGeoBox(gb, L);
        std::vector<Coedge*> ring = ringCoedges(gb.faces[0]->outerLoop);
        Edge* victim = ring[0]->edge;
        Vertex* a = victim->start;
        Vertex* b = victim->end;
        Face* extra = gb.tb.makeFace();
        gb.tb.addFaceToShell(gb.shell, extra);
        Vertex* apex = gb.tb.makeVertex({a->point.x, a->point.y, a->point.z - 2.0});
        Vertex* a2 = gb.tb.makeVertex(a->point);
        Vertex* b2 = gb.tb.makeVertex(b->point);
        std::vector<Vertex*> tri = {a2, b2, apex};
        gb.tb.addOuterLoopToFace(extra, tri);
        Coedge* tc0 = extra->outerLoop->first;
        tc0->edge = victim;
        CheckReport nr = checkBRep(gb.shell);
        auto nfs = nativeFailedStatusNames(nr);

        TopoDS_Shell osh = occtThreeFaceNonManifold(L);
        BRepCheck_Shell sck(osh);
        BRepCheck_Status closedSt = sck.Closed();
        std::set<std::string> ofs;
        if (closedSt != BRepCheck_NoError) ofs.insert(occtStatusName(closedSt));
        bool ov = (closedSt == BRepCheck_NoError);

        std::printf("    NATIVE: valid=%s  failedStatuses=%s\n",
                    nr.valid ? "true" : "false", joinSet(nfs).c_str());
        std::printf("    OCCT  : valid=%s  failedStatuses=%s  [BRepCheck_Shell Closed=%s]\n",
                    ov ? "true" : "false", joinSet(ofs).c_str(), occtStatusName(closedSt));

        bool verdictAgree = (nr.valid == ov) && !nr.valid;
        check(verdictAgree, "CASE 3 verdict agrees (both INVALID)");
        check(nfs.count("InvalidMultiConnexity") > 0,
              "CASE 3 native reports InvalidMultiConnexity (T1)");
        check(nfs.count("NonManifoldEdge") > 0,
              "CASE 3 native reports NonManifoldEdge (T9)");
        check(ofs.count("InvalidMultiConnexity") > 0,
              "CASE 3 OCCT reports InvalidMultiConnexity");
        bool statusMap = (nfs.count("InvalidMultiConnexity") > 0 ||
                          nfs.count("NonManifoldEdge") > 0) &&
                         ofs.count("InvalidMultiConnexity") > 0;
        verdictAgreeAll &= verdictAgree; statusMapAll &= statusMap;
    }

    // ──────────────────────────────────────────────────────────────────────
    // CASE 4 — DROPPED FACE -> FREE EDGES. Native: validate FIVE box faces
    // (drop the top) -> the 4 rim edges are free; T6.ShellClosureConsistent ->
    // NotClosed. OCCT: sew five box faces into an OPEN shell ->
    // BRepCheck_Shell::Closed reports BRepCheck_NotClosed.
    // ──────────────────────────────────────────────────────────────────────
    {
        std::printf("\n[CASE 4] dropped face -> free rim edges (open shell)\n");
        GeoBox gb; buildGeoBox(gb, L);
        std::vector<Face*> five;
        for (std::size_t i = 0; i < gb.faces.size(); ++i) if (i != 1) five.push_back(gb.faces[i]);
        CheckReport nr = checkBRep(five);  // expectClosed default true
        auto nfs = nativeFailedStatusNames(nr);

        TopoDS_Shape sewn = occtBoxShellSewn(L, /*dropFace=*/1);
        std::set<std::string> ofs;
        BRepCheck_Status closedSt = BRepCheck_NoError;
        if (sewn.ShapeType() == TopAbs_SHELL) {
            BRepCheck_Shell sck(TopoDS::Shell(sewn));
            closedSt = sck.Closed();
            if (closedSt != BRepCheck_NoError) ofs.insert(occtStatusName(closedSt));
        }
        bool ov = (closedSt == BRepCheck_NoError);

        std::printf("    NATIVE: valid=%s  failedStatuses=%s\n",
                    nr.valid ? "true" : "false", joinSet(nfs).c_str());
        std::printf("    OCCT  : valid=%s  failedStatuses=%s  [BRepCheck_Shell Closed=%s]\n",
                    ov ? "true" : "false", joinSet(ofs).c_str(), occtStatusName(closedSt));

        bool verdictAgree = (nr.valid == ov) && !nr.valid;
        check(verdictAgree, "CASE 4 verdict agrees (both INVALID)");
        bool nativeHas = nfs.count("NotClosed") > 0;
        bool occtHas = ofs.count("NotClosed") > 0 || ofs.count("FreeEdge") > 0;
        check(nativeHas, "CASE 4 native reports NotClosed (T6)");
        check(occtHas, "CASE 4 OCCT reports NotClosed");
        bool statusMap = nativeHas && occtHas;
        verdictAgreeAll &= verdictAgree; statusMapAll &= statusMap;
    }

    // ──────────────────────────────────────────────────────────────────────
    std::printf("\n=== A/B SUMMARY ===\n");
    std::printf("    verdict agreement 5/5 : %s\n", verdictAgreeAll ? "YES" : "NO");
    std::printf("    status sets map        : %s\n", statusMapAll ? "YES" : "NO");
    std::printf("    sub-checks: %d / %d passed\n", g_pass, g_total);

    bool overall = verdictAgreeAll && statusMapAll && (g_pass == g_total);
    std::printf("\n=== VERDICT: %s ===\n", overall ? "PASS" : "FAIL");
    return overall ? 0 : 1;
}
