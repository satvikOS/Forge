// thicken_bucket_census.cpp — PURE-OCCT census of the face the corpus A/B picks
// for TKOffset family I (THICKEN), written to attribute the DELETION BUCKET.
//
// The A/B thickens `pk.anyBig` — the largest-area face of the part, ties broken
// by centroid — and the native engine declines 23 of 600 with the single reason
// "the face is not the full parametric rectangle (a trimmed or holed patch)".
// That sentence names a predicate, not a shape. This probe prints WHAT the trim
// actually is, so the fix is chosen from measurement rather than from the guess
// that "trimmed or holed" suggests.
//
// Links NO forge object: it cannot be influenced by an engine change, which is
// what lets it stand as an oracle for one.
//
// Emits one JSON object per part on stdout.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAdaptor_Curve2d.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Surface.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Pnt.hxx>

static const double kTwoPi = 2.0 * M_PI;

static double faceArea(const TopoDS_Face& f) {
    GProp_GProps p;
    try { BRepGProp::SurfaceProperties(f, p); } catch (...) { return 0.0; }
    return p.Mass();
}
static gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps p;
    try { BRepGProp::SurfaceProperties(f, p); } catch (...) { return gp_Pnt(0, 0, 0); }
    return p.CentreOfMass();
}
// betterFace, copied verbatim from test/corpus_ab_coverage.cpp:442 so the face
// this probe reports on is the SAME face the A/B thickened.
static bool betterFace(const TopoDS_Face& cand, double candArea,
                       const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}
static Handle(Geom_Surface) basis(Handle(Geom_Surface) s) {
    for (;;) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(s);
        if (rt.IsNull()) return s;
        s = rt->BasisSurface();
    }
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step>\n", argv[0]); return 2; }
    const std::string path = argv[1];
    std::string name = path;
    { const size_t sl = name.find_last_of('/');
      if (sl != std::string::npos) name = name.substr(sl + 1);
      const size_t dot = name.find_last_of('.');
      if (dot != std::string::npos) name = name.substr(0, dot); }

    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(path.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str());
        return 1;
    }

    TopoDS_Face pick; double pickArea = 0.0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        if (betterFace(f, a, pick, pickArea)) { pick = f; pickArea = a; }
    }
    if (pick.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_face\"}\n", name.c_str());
        return 1;
    }

    const Handle(Geom_Surface) s = basis(BRep_Tool::Surface(pick));
    Handle(Geom_CylindricalSurface) cs = Handle(Geom_CylindricalSurface)::DownCast(s);
    const char* stype = cs.IsNull() ? s->DynamicType()->Name() : "Geom_CylindricalSurface";

    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    BRepTools::UVBounds(pick, u0, u1, v0, v1);
    const double du = u1 - u0, dv = v1 - v0;

    // wire census: how many wires, and is the DEFICIT a hole or a non-rectangular
    // outer boundary? Also classify every edge's pcurve as u-iso / v-iso / other,
    // because a trim made only of isoparametric edges is a rectangle in uv even
    // when it is not the FULL uv box — a distinction the certificate cannot make.
    int nWires = 0;
    TopExp_Explorer wx(pick, TopAbs_WIRE);
    for (; wx.More(); wx.Next()) ++nWires;

    const TopoDS_Wire outer = BRepTools::OuterWire(pick);
    int nEdgesOuter = 0, nUiso = 0, nViso = 0, nOther = 0;
    if (!outer.IsNull()) {
        BRepTools_WireExplorer we(outer, pick);
        for (; we.More(); we.Next()) {
            ++nEdgesOuter;
            const TopoDS_Edge e = we.Current();
            Standard_Real f2 = 0, l2 = 0;
            Handle(Geom2d_Curve) pc = BRep_Tool::CurveOnSurface(e, pick, f2, l2);
            if (pc.IsNull()) { ++nOther; continue; }
            const gp_Pnt2d a = pc->Value(f2), b = pc->Value(l2), m = pc->Value(0.5 * (f2 + l2));
            const double tolp = 1.0e-7 * std::max(1.0, std::max(std::fabs(du), std::fabs(dv)));
            const bool uconst = std::fabs(a.X() - b.X()) <= tolp && std::fabs(a.X() - m.X()) <= tolp;
            const bool vconst = std::fabs(a.Y() - b.Y()) <= tolp && std::fabs(a.Y() - m.Y()) <= tolp;
            if (uconst && !vconst) ++nUiso;
            else if (vconst && !uconst) ++nViso;
            else ++nOther;
        }
    }

    double R = 0.0, want = 0.0;
    if (!cs.IsNull()) { R = cs->Cylinder().Radius(); want = R * du * dv; }
    const double got = pickArea;
    const double ratio = want > 0 ? got / want : 0.0;

    std::printf(
        "{\"part\":\"%s\",\"stype\":\"%s\",\"nfaces\":%d,\"R\":%.10g,"
        "\"u0\":%.10g,\"u1\":%.10g,\"v0\":%.10g,\"v1\":%.10g,\"du\":%.10g,\"dv\":%.10g,"
        "\"full_turn\":%s,\"area\":%.10g,\"want\":%.10g,\"ratio\":%.10g,"
        "\"nwires\":%d,\"nedges_outer\":%d,\"uiso\":%d,\"viso\":%d,\"other\":%d}\n",
        name.c_str(), stype, fm.Extent(), R, u0, u1, v0, v1, du, dv,
        (du >= kTwoPi - 1e-9 ? "true" : "false"), got, want, ratio,
        nWires, nEdgesOuter, nUiso, nViso, nOther);
    return 0;
}
