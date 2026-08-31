// signprobe.cpp — POSITIVE CONTROL for the cylindrical THICKEN closed form.
// Runs the EXACT call src/Features.cpp makes (and corpus_ab_coverage.cpp
// replicates) on the face the THICKEN family picks, and prints OCCT's volume
// next to BOTH candidate closed forms:
//     grow   pi*((R+t)^2 - R^2)*h        (offset along +er)
//     shrink pi*(R^2 - (R-t)^2)*h        (offset along -er)
// so which side OCCT skins to is MEASURED, not assumed.
#include <cmath>
#include <cstdio>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <BRepOffset_MakeOffset.hxx>
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
    if (ad.GetType() != GeomAbs_Cylinder) return 0;
    const gp_Cylinder cy = ad.Cylinder();
    const double R = cy.Radius();
    const double du = ad.LastUParameter() - ad.FirstUParameter();
    const double dv = ad.LastVParameter() - ad.FirstVParameter();

    double bb[6]; bool first = true;
    for (TopExp_Explorer vx(shape, TopAbs_VERTEX); vx.More(); vx.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
        if (first) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); first=false; }
        else { bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
               bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
               bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z()); } }
    const double t = 0.05 * std::min(std::min(bb[3]-bb[0], bb[4]-bb[1]), bb[5]-bb[2]);

    double occtVol = 0.0; int done = 0;
    try {
        BRepOffset_MakeOffset mk;
        mk.Initialize(big, t, 1.0e-4, BRepOffset_Skin,
                      Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
        mk.MakeThickSolid();
        if (mk.IsDone() && !mk.Shape().IsNull()) {
            done = 1; GProp_GProps g; BRepGProp::VolumeProperties(mk.Shape(), g);
            occtVol = std::fabs(g.Mass());
        }
    } catch (...) { done = -1; }

    const double grow   = 0.5 * du * ((R + t) * (R + t) - R * R) * dv;
    const double shrink = 0.5 * du * (R * R - (R - t) * (R - t)) * dv;
    const char* pick = (std::fabs(occtVol - grow) < std::fabs(occtVol - shrink)) ? "GROW" : "SHRINK";
    const double rel = std::fabs(occtVol - (pick[0]=='G' ? grow : shrink)) / std::max(1e-30, occtVol);
    std::printf("{\"part\":\"%s\",\"done\":%d,\"rev\":%s,\"R\":%.8g,\"t\":%.8g,"
                "\"occt_vol\":%.10g,\"grow\":%.10g,\"shrink\":%.10g,\"pick\":\"%s\",\"rel\":%.3e}\n",
                argv[2], done, (big.Orientation()==TopAbs_REVERSED)?"true":"false",
                R, t, occtVol, grow, shrink, pick, rel);
    return 0;
}
