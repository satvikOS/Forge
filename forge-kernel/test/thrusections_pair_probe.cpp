// ─────────────────────────────────────────────────────────────────────────────
// thrusections_pair_probe.cpp — WHAT IS `xlate_edge_count_mismatch` MADE OF?
//
// TKOffset family D (`FORGE_THRUSECTIONS_DROP_NATIVE`) is the largest remaining
// deletion bucket whose OCCT baseline is VALID geometry. The native engine's own
// FK_DEFER channel splits that bucket into two labels, and the larger one is
// `xlate_edge_count_mismatch`: the translated-section identity in
// src/native/brep/NativeLoftPipe.cpp declines because the two section wires do
// not carry the same NUMBER OF EDGES (NativeLoftPipe.cpp, the `n0 != n1` guard).
//
// TWO READINGS, OPPOSITE ENGINEERING. An edge-count mismatch is equally
// consistent with
//   (a) the two wires being the SAME closed curve up to a translation, one of
//       them merely carrying an extra VERTEX that splits an edge — a topological
//       split, which real STEP carries constantly, and on which the extrusion
//       identity still holds exactly; and
//   (b) the two sections being genuinely different closed curves, on which no
//       translate-based path can ever be correct.
// Reading (a) says "relax a structural guard"; reading (b) says "this needs a
// ruled-surface engine". Nothing in the label distinguishes them.
//
// THE DISCRIMINATOR, and why it needs no projection. Two closed wires related by
// a translation must agree on every TRANSLATION-INVARIANT observable of the
// curve, and disagree on the equivariant ones by exactly the same vector:
//
//   * total wire LENGTH is translation-invariant   -> must be equal;
//   * the wire's CENTRE OF MASS is equivariant     -> its difference IS the
//     candidate T, and it is computed from the curve, not from any vertex, so a
//     split vertex cannot move it;
//   * the multiset of per-edge (curve type, length) is invariant under
//     translation but NOT under splitting, so comparing it against the
//     *merged* multiset separates (a) from (b).
//
// This probe reports all of them, per part, plus the raw edge inventory of both
// wires. It reproduces the corpus A/B's own face pick and outer-wire extraction
// so a row here refers to the same two wires a THRUSECTIONS row there refers to.
//
// It MEASURES ONLY: it links no forge object and calls no native engine.
//
// build: bash test/build_thrusections_pair_probe.sh
// run  : .build-corpus-ab/thrusections_pair_probe <part.step>   (one JSON line)
// ─────────────────────────────────────────────────────────────────────────────
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Surface.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

namespace {

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
Handle(Geom_Surface) basisSurface(Handle(Geom_Surface) s) {
    for (int i = 0; i < 8 && !s.IsNull(); ++i) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(s);
        if (rt.IsNull()) break;
        s = rt->BasisSurface();
    }
    return s;
}
bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basisSurface(BRep_Tool::Surface(f)));
    if (pl.IsNull()) return false;
    out = pl->Pln();
    return true;
}

const char* curveTypeName(GeomAbs_CurveType t) {
    switch (t) {
        case GeomAbs_Line:            return "line";
        case GeomAbs_Circle:          return "circle";
        case GeomAbs_Ellipse:         return "ellipse";
        case GeomAbs_Hyperbola:       return "hyperbola";
        case GeomAbs_Parabola:        return "parabola";
        case GeomAbs_BezierCurve:     return "bezier";
        case GeomAbs_BSplineCurve:    return "bspline";
        case GeomAbs_OffsetCurve:     return "offset";
        default:                      return "other";
    }
}

struct EdgeRec { std::string type; double len = 0.0; };

// Per-edge inventory of a wire, in BRepTools_WireExplorer order.
bool wireInventory(const TopoDS_Wire& w, std::vector<EdgeRec>& out) {
    out.clear();
    if (w.IsNull()) return false;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        EdgeRec r;
        try {
            BRepAdaptor_Curve ac(e);
            r.type = curveTypeName(ac.GetType());
        } catch (...) { r.type = "unreadable"; }
        GProp_GProps g;
        try { BRepGProp::LinearProperties(e, g); r.len = g.Mass(); } catch (...) { r.len = -1.0; }
        out.push_back(r);
    }
    return !out.empty();
}

void wireLinear(const TopoDS_Wire& w, double& len, gp_Pnt& com) {
    GProp_GProps g;
    len = 0.0; com = gp_Pnt(0, 0, 0);
    try { BRepGProp::LinearProperties(w, g); len = g.Mass(); com = g.CentreOfMass(); } catch (...) {}
}

std::string typeHistogram(const std::vector<EdgeRec>& v) {
    // "line:4,circle:2" in a fixed order so two rows are comparable as strings.
    static const char* order[] = {"line", "circle", "ellipse", "hyperbola", "parabola",
                                  "bezier", "bspline", "offset", "other", "unreadable"};
    std::string s;
    for (const char* t : order) {
        int n = 0;
        for (const EdgeRec& r : v) if (r.type == t) ++n;
        if (!n) continue;
        if (!s.empty()) s += ",";
        s += t; s += ":"; s += std::to_string(n);
    }
    return s;
}

// The multiset of edge LENGTHS, sorted. Under a pure translation this is
// invariant; under a SPLIT the finer wire's multiset refines the coarser one, so
// comparing them names which of the two readings the part is.
std::string lenList(const std::vector<EdgeRec>& v) {
    std::vector<double> ls;
    for (const EdgeRec& r : v) ls.push_back(r.len);
    std::sort(ls.begin(), ls.end());
    std::string s = "[";
    for (size_t i = 0; i < ls.size(); ++i) {
        char b[40]; std::snprintf(b, sizeof b, "%s%.6g", i ? "," : "", ls[i]);
        s += b;
    }
    return s + "]";
}

}  // namespace

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
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str()); return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str()); return 1;
    }

    // ---- the A/B's planarBig / planarSecond pick, reproduced ---------------
    TopoDS_Face big, second; double bigA = 0.0, secA = 0.0; gp_Pln bigPln;
    double diag = 0.0;
    {
        double bb[6]; bool any = false;
        for (TopExp_Explorer ex(shape, TopAbs_VERTEX); ex.More(); ex.Next()) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
            if (!any) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); any=true; }
            else {
                bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
                bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
                bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z());
            }
        }
        if (any) {
            const double dx=bb[3]-bb[0], dy=bb[4]-bb[1], dz=bb[5]-bb[2];
            diag = std::sqrt(dx*dx+dy*dy+dz*dz);
        }
    }
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        gp_Pln pl;
        if (!planeOf(f, pl)) continue;
        if (betterFace(f, a, big, bigA)) { big = f; bigA = a; bigPln = pl; }
    }
    if (!big.IsNull()) {
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            if (f.IsSame(big)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            const bool sameNormal = pl.Axis().Direction().IsParallel(bigPln.Axis().Direction(), 1e-6);
            const bool samePlane = sameNormal &&
                std::fabs(bigPln.Distance(pl.Location())) < 1e-7 * std::max(1.0, diag);
            if (samePlane) continue;
            if (betterFace(f, a, second, secA)) { second = f; secA = a; }
        }
    }
    if (big.IsNull() || second.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"need_two_non_coplanar_planar_faces\"}\n", name.c_str());
        return 0;
    }

    const TopoDS_Wire w1 = BRepTools::OuterWire(big);
    const TopoDS_Wire w2 = BRepTools::OuterWire(second);
    std::vector<EdgeRec> i1, i2;
    if (!wireInventory(w1, i1) || !wireInventory(w2, i2)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_outer_wire\"}\n", name.c_str());
        return 0;
    }
    double L1 = 0, L2 = 0; gp_Pnt c1, c2;
    wireLinear(w1, L1, c1);
    wireLinear(w2, L2, c2);
    const double dL = (L1 > 0.0) ? std::fabs(L1 - L2) / L1 : -1.0;
    const gp_Vec T(c1, c2);

    std::printf(
        "{\"part\":\"%s\",\"n0\":%zu,\"n1\":%zu,\"len0\":%.12g,\"len1\":%.12g,"
        "\"rel_len_diff\":%.6g,\"com_delta\":[%.12g,%.12g,%.12g],\"|T|\":%.12g,"
        "\"types0\":\"%s\",\"types1\":\"%s\",\"lens0\":%s,\"lens1\":%s}\n",
        name.c_str(), i1.size(), i2.size(), L1, L2, dL,
        T.X(), T.Y(), T.Z(), T.Magnitude(),
        typeHistogram(i1).c_str(), typeHistogram(i2).c_str(),
        lenList(i1).c_str(), lenList(i2).c_str());
    return 0;
}
