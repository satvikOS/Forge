// srfcensus.cpp — for one STEP part, name the surface type of the SAME face
// corpus_ab_coverage.cpp's THICKEN family picks (pk.anyBig: the largest face of
// ANY type, ties broken on centroid lexicographically). Replicates faceArea /
// betterFace / pickInputs verbatim so the census is over the SAME input the
// coverage number was measured on.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Surface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

static double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
static gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0,0,0); }
    return g.CentreOfMass();
}
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
static const char* stName(GeomAbs_SurfaceType t) {
    switch (t) {
        case GeomAbs_Plane: return "Plane";
        case GeomAbs_Cylinder: return "Cylinder";
        case GeomAbs_Cone: return "Cone";
        case GeomAbs_Sphere: return "Sphere";
        case GeomAbs_Torus: return "Torus";
        case GeomAbs_BezierSurface: return "Bezier";
        case GeomAbs_BSplineSurface: return "BSpline";
        case GeomAbs_SurfaceOfRevolution: return "Revolution";
        case GeomAbs_SurfaceOfExtrusion: return "Extrusion";
        case GeomAbs_OffsetSurface: return "OffsetSurface";
        default: return "Other";
    }
}
int main(int argc, char** argv) {
    if (argc < 3) return 2;
    TopoDS_Shape shape;
    { STEPControl_Reader rd;
      if (rd.ReadFile(argv[1]) != IFSelect_RetDone) { std::printf("{\"part\":\"%s\",\"err\":\"read\"}\n", argv[2]); return 0; }
      try { rd.TransferRoots(); } catch (...) {}
      try { shape = rd.OneShape(); } catch (...) {} }
    if (shape.IsNull()) { std::printf("{\"part\":\"%s\",\"err\":\"null\"}\n", argv[2]); return 0; }

    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    TopoDS_Face big; double bigA = 0.0;
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        if (betterFace(f, a, big, bigA)) { big = f; bigA = a; }
    }
    if (big.IsNull()) { std::printf("{\"part\":\"%s\",\"err\":\"noface\"}\n", argv[2]); return 0; }

    BRepAdaptor_Surface ad;
    const char* ty = "Other"; bool trimmed = false; bool per = false;
    double u0=0,u1=0,v0=0,v1=0;
    try { ad.Initialize(big); ty = stName(ad.GetType());
          u0=ad.FirstUParameter(); u1=ad.LastUParameter();
          v0=ad.FirstVParameter(); v1=ad.LastVParameter();
          per = ad.IsUClosed() || ad.IsVClosed(); } catch (...) {}
    Handle(Geom_Surface) s = BRep_Tool::Surface(big);
    if (!s.IsNull() && !Handle(Geom_RectangularTrimmedSurface)::DownCast(s).IsNull()) trimmed = true;

    int nw = 0, ne = 0, nl = 0, nc = 0, no = 0;
    for (TopExp_Explorer wx(big, TopAbs_WIRE); wx.More(); wx.Next()) {
        ++nw;
        for (TopExp_Explorer ex(wx.Current(), TopAbs_EDGE); ex.More(); ex.Next()) {
            ++ne; BRepAdaptor_Curve c;
            try { c.Initialize(TopoDS::Edge(ex.Current())); } catch (...) { ++no; continue; }
            if (c.GetType() == GeomAbs_Line) ++nl;
            else if (c.GetType() == GeomAbs_Circle) ++nc;
            else ++no;
        }
    }
    std::printf("{\"part\":\"%s\",\"srf\":\"%s\",\"area\":%.10g,\"nfaces\":%d,"
                "\"trimmed\":%s,\"closed\":%s,\"u\":[%.10g,%.10g],\"v\":[%.10g,%.10g],"
                "\"wires\":%d,\"edges\":%d,\"lines\":%d,\"circles\":%d,\"other\":%d}\n",
                argv[2], ty, bigA, fm.Extent(), trimmed?"true":"false", per?"true":"false",
                u0,u1,v0,v1, nw, ne, nl, nc, no);
    return 0;
}
