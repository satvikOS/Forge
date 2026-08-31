// cylcert.cpp — for the SAME face the THICKEN family picks, when it is a
// CYLINDER, report R, the UV span, and the RECTANGLE CERTIFICATE:
//   a cylindrical patch over UV region D has area = R * area(D), and D is
//   contained in the adaptor's [u0,u1]x[v0,v1] box, so
//        area(face) == R * du * dv   <=>   D IS that whole rectangle.
// A face with a hole, or any non-rectangular trim, has strictly smaller area.
#include <cmath>
#include <cstdio>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Cylinder.hxx>
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
static bool betterFace(const TopoDS_Face& c, double ca, const TopoDS_Face& b, double ba) {
    if (b.IsNull()) return ca > 0.0;
    if (ca > ba * (1.0 + 1e-12)) return true;
    if (ca < ba * (1.0 - 1e-12)) return false;
    const gp_Pnt p = faceCentroid(c), q = faceCentroid(b);
    if (p.X() != q.X()) return p.X() < q.X();
    if (p.Y() != q.Y()) return p.Y() < q.Y();
    return p.Z() < q.Z();
}
int main(int argc, char** argv) {
    if (argc < 3) return 2;
    TopoDS_Shape shape;
    { STEPControl_Reader rd;
      if (rd.ReadFile(argv[1]) != IFSelect_RetDone) return 0;
      try { rd.TransferRoots(); } catch (...) {}
      try { shape = rd.OneShape(); } catch (...) {} }
    if (shape.IsNull()) return 0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    TopoDS_Face big; double bigA = 0.0;
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        if (betterFace(f, a, big, bigA)) { big = f; bigA = a; }
    }
    if (big.IsNull()) return 0;
    BRepAdaptor_Surface ad;
    try { ad.Initialize(big); } catch (...) { return 0; }
    if (ad.GetType() != GeomAbs_Cylinder) {
        std::printf("{\"part\":\"%s\",\"cyl\":false}\n", argv[2]); return 0;
    }
    const gp_Cylinder cy = ad.Cylinder();
    const double R = cy.Radius();
    const double du = ad.LastUParameter() - ad.FirstUParameter();
    const double dv = ad.LastVParameter() - ad.FirstVParameter();
    const double want = R * du * dv;
    const double rel = (want > 0.0) ? std::fabs(bigA - want) / want : 1.0;
    int nw = 0;
    for (TopExp_Explorer wx(big, TopAbs_WIRE); wx.More(); wx.Next()) ++nw;
    // the THICKEN family's thickness: 0.05 * min bbox extent of the WHOLE part
    double bb[6]; bool first = true;
    for (TopExp_Explorer vx(shape, TopAbs_VERTEX); vx.More(); vx.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
        if (first) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); first=false; }
        else { bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
               bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
               bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z()); } }
    const double minExt = std::min(std::min(bb[3]-bb[0], bb[4]-bb[1]), bb[5]-bb[2]);
    const double t = 0.05 * minExt;
    const bool rev = (big.Orientation() == TopAbs_REVERSED);
    const double Rp = R + (rev ? -t : t);
    std::printf("{\"part\":\"%s\",\"cyl\":true,\"R\":%.10g,\"du\":%.10g,\"dv\":%.10g,"
                "\"area\":%.10g,\"want\":%.10g,\"rel\":%.3e,\"rect\":%s,\"wires\":%d,"
                "\"rev\":%s,\"t\":%.10g,\"Rp\":%.10g,\"Rp_pos\":%s,\"full_u\":%s}\n",
                argv[2], R, du, dv, bigA, want, rel,
                (rel < 1e-6 ? "true" : "false"), nw, rev ? "true" : "false",
                t, Rp, (Rp > 1e-9 ? "true" : "false"),
                (du > 6.283185307179586 - 1e-7 ? "true" : "false"));
    return 0;
}
