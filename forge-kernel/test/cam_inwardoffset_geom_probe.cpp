// cam_inwardoffset_geom_probe.cpp — is a RECOVERED offset RIGHT, or merely
// non-null? A defer that becomes an OK is only progress if the geometry it now
// produces is the geometry OCCT produces.
//
// Compiled WITHOUT the drop macro, so `forge::cam::inwardOffset` takes its OCCT
// branch (the FEAT gate is default OFF), while `tryNativeInwardOffset` — the
// same static function the drop build calls — is invoked directly from the same
// process on the same wire. Both results are reduced to the same observable
// vector and compared:
//
//   * total wire length (the offset contour's perimeter),
//   * planar bounding box, reported as a fraction of its own diagonal,
//   * length-weighted centroid,
//   * wire count and closedness.
//
// Face selection, the plane frame and d = 0.05*sqrt(area) are byte-for-byte
// test/cam_inwardoffset_coverage_ab.cpp's, so the operation compared here is the
// operation that harness scores.
#include "../src/Cam.cpp"   // NOLINT — tryNativeInwardOffset has internal linkage

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <gp_Ax3.hxx>
#include <gp_Trsf.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>

namespace {

double gpFaceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
gp_Pnt gpFaceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}
bool gpPlaneOf(const TopoDS_Face& f, gp_Pln& out) {
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
bool gpBetterFace(const TopoDS_Face& cand, double candArea,
                  const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = gpFaceCentroid(cand), b = gpFaceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

struct Obs {
    bool   ok{false};
    int    nWires{0};
    int    nClosed{0};
    double length{0.0};
    double cx{0.0}, cy{0.0};
    double xmin{0}, ymin{0}, xmax{0}, ymax{0};
};

Obs observe(const TopoDS_Shape& sh) {
    Obs o;
    if (sh.IsNull()) return o;
    o.ok = true;
    Bnd_Box bb;
    double wsum = 0.0;
    for (TopExp_Explorer ex(sh, TopAbs_WIRE); ex.More(); ex.Next()) {
        const TopoDS_Wire w = TopoDS::Wire(ex.Current());
        ++o.nWires;
        if (BRep_Tool::IsClosed(w)) ++o.nClosed;
        GProp_GProps g;
        try { BRepGProp::LinearProperties(w, g); } catch (...) { continue; }
        const double L = g.Mass();
        o.length += L;
        const gp_Pnt c = g.CentreOfMass();
        o.cx += c.X() * L; o.cy += c.Y() * L; wsum += L;
        try { BRepBndLib::Add(w, bb); } catch (...) {}
    }
    if (wsum > 0.0) { o.cx /= wsum; o.cy /= wsum; }
    if (!bb.IsVoid()) {
        double zmin, zmax;
        bb.Get(o.xmin, o.ymin, zmin, o.xmax, o.ymax, zmax);
    }
    return o;
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        STEPControl_Reader rd;
        TopoDS_Shape shape;
        try {
            if (rd.ReadFile(argv[i]) != IFSelect_RetDone) continue;
            rd.TransferRoots();
            shape = rd.OneShape();
        } catch (...) { continue; }
        if (shape.IsNull()) continue;

        TopoDS_Face big; double bigArea = 0.0; gp_Pln bigPln;
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int k = 1; k <= fm.Extent(); ++k) {
            const TopoDS_Face f = TopoDS::Face(fm(k));
            const double a = gpFaceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!gpPlaneOf(f, pl)) continue;
            if (gpBetterFace(f, a, big, bigArea)) { big = f; bigArea = a; bigPln = pl; }
        }
        if (big.IsNull()) continue;
        const TopoDS_Wire w = BRepTools::OuterWire(big);
        if (w.IsNull()) continue;
        const gp_Ax3 ax(bigPln.Location(), bigPln.Axis().Direction());
        gp_Trsf toLocal; toLocal.SetTransformation(ax);
        TopoDS_Shape moved;
        try { moved = BRepBuilderAPI_Transform(w, toLocal, true).Shape(); } catch (...) { continue; }
        if (moved.IsNull() || moved.ShapeType() != TopAbs_WIRE) continue;
        const TopoDS_Wire wl = TopoDS::Wire(moved);
        const double d = 0.05 * std::sqrt(bigArea);
        const gp_Pln flat(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));

        // NATIVE_ONLY=1 skips the OCCT arm entirely, so the SAME binary can be
        // built from two revisions of PolygonOffset2D.cpp and their native
        // observable vectors compared row by row without OCCT in the loop (and
        // without waiting on the six parts OCCT itself times out on).
        const char* nativeOnly = std::getenv("NATIVE_ONLY");
        const bool onlyNative = nativeOnly && nativeOnly[0] == '1';

        TopoDS_Shape occt, nat;
        if (!onlyNative) { try { occt = forge::cam::inwardOffset(wl, d, flat); } catch (...) {} }
        try { nat  = forge::cam::tryNativeInwardOffset(wl, d, flat); } catch (...) {}

        const Obs a = observe(occt), b = observe(nat);
        const char* base = std::strrchr(argv[i], '/'); base = base ? base + 1 : argv[i];
        if (onlyNative) {
            std::printf("%-16s ok=%d wires=%d closed=%d len=%.12f cx=%.12f cy=%.12f "
                        "bb=%.12f,%.12f,%.12f,%.12f\n",
                        base, (int)b.ok, b.nWires, b.nClosed, b.length, b.cx, b.cy,
                        b.xmin, b.ymin, b.xmax, b.ymax);
            std::fflush(stdout);
            continue;
        }
        const double diag = std::hypot(a.xmax - a.xmin, a.ymax - a.ymin);
        std::printf("%s  d=%.6f\n", base, d);
        std::printf("   occt   ok=%d wires=%d closed=%d len=%.6f centroid=(%.6f,%.6f) bbox=(%.6f,%.6f)-(%.6f,%.6f)\n",
                    (int)a.ok, a.nWires, a.nClosed, a.length, a.cx, a.cy, a.xmin, a.ymin, a.xmax, a.ymax);
        std::printf("   native ok=%d wires=%d closed=%d len=%.6f centroid=(%.6f,%.6f) bbox=(%.6f,%.6f)-(%.6f,%.6f)\n",
                    (int)b.ok, b.nWires, b.nClosed, b.length, b.cx, b.cy, b.xmin, b.ymin, b.xmax, b.ymax);
        if (a.ok && b.ok && diag > 0.0) {
            const double dl = std::fabs(a.length - b.length) / (a.length > 0 ? a.length : 1.0);
            const double dc = std::hypot(a.cx - b.cx, a.cy - b.cy) / diag;
            double db = 0.0;
            db = std::max(db, std::fabs(a.xmin - b.xmin));
            db = std::max(db, std::fabs(a.ymin - b.ymin));
            db = std::max(db, std::fabs(a.xmax - b.xmax));
            db = std::max(db, std::fabs(a.ymax - b.ymax));
            std::printf("   DELTA  length_rel=%.3e  bbox_rel=%.3e  centroid_rel=%.3e\n",
                        dl, db / diag, dc);
        }
        std::fflush(stdout);
    }
    return 0;
}
