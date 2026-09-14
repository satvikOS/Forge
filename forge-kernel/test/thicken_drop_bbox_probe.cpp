// thicken_drop_bbox_probe.cpp — is the family-I bbox disagreement GEOMETRY or is
// it the VERTEX BOX?
//
// WHY THIS EXISTS. The 600-part A/B for TKOffset family I reports 5 pairs on which
// native and the OCCT oracle differ, and on all 5 the difference is bbox ALONE:
// volume and area are BIT-IDENTICAL (relative difference exactly 0.000e+00), the
// centre of mass matches to 4e-15, and only the box moves — by as much as 33 mm.
//
// That pattern is the exact shape of the defect this repository has been bitten by
// four times, and the standing rule is that VOLUME ALONE CANNOT VALIDATE GEOMETRY.
// So it is not waved away. There are two candidate explanations and they have
// opposite consequences:
//
//   (a) THE TWO SOLIDS REALLY OCCUPY DIFFERENT SPACE and volume/area/centroid all
//       happen to coincide. That would be a blocking defect.
//   (b) THE HARNESS'S `bb` IS THE VERTEX BOX. corpus_ab_coverage.cpp builds it by
//       walking TopAbs_VERTEX (see its line 464) — it is the box of the CORNER
//       POINTS, not of the surfaces. Two solids that occupy identical space but
//       split a curved wall into a different number of faces have DIFFERENT
//       VERTEX SETS, so this box legitimately differs while the geometry does not.
//
// (a) and (b) are distinguished by ONE measurement: the true geometric bounding
// box. BRepBndLib::AddOptimal bounds the SURFACES rather than the vertices (and,
// unlike plain BRepBndLib::Add, it does not bound a spline by its control polygon,
// which is its own source of spurious millimetres). If the optimal boxes agree to
// tolerance while the vertex boxes differ by tens of millimetres, (b) is proved and
// (a) is excluded.
//
// This probe therefore prints, for BOTH arms, on the SAME face the A/B thickened:
//   volume, area, centroid, F/E/V/shell/solid counts, surface-type census,
//   BRepCheck validity, the VERTEX box, and the OPTIMAL box.
// It asserts nothing; it reports, and the numbers decide.
//
// usage: thicken_drop_bbox_probe <part.step> [thickness-fraction]
// The thickness is 0.05 * the part diagonal, which is what corpus_ab_coverage.cpp
// uses, so the probe is thickening the same shape by the same amount.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeThickenShell.hpp"
#include "OcctThickenOracle.hpp"

namespace {

double faceArea(const TopoDS_Face& f) {
    GProp_GProps p;
    try { BRepGProp::SurfaceProperties(f, p); } catch (...) { return 0.0; }
    return p.Mass();
}
gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps p;
    try { BRepGProp::SurfaceProperties(f, p); } catch (...) { return gp_Pnt(0, 0, 0); }
    return p.CentreOfMass();
}
// betterFace, copied from test/corpus_ab_coverage.cpp so this probe reports on the
// SAME face the A/B thickened. A probe that picked a different face would be
// answering a different question and could not settle this one.
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

struct Obs {
    bool ok = false;
    int f = 0, e = 0, v = 0, sh = 0, so = 0;
    int valid = 0;
    double vol = 0, area = 0;
    double com[3] = {0, 0, 0};
    double vbb[6] = {0, 0, 0, 0, 0, 0};   // VERTEX box — what the A/B compares
    double obb[6] = {0, 0, 0, 0, 0, 0};   // OPTIMAL box — the real geometric one
    int st[7] = {0, 0, 0, 0, 0, 0, 0};    // plane cyl cone sphere torus bspline other
};

int count(const TopoDS_Shape& s, TopAbs_ShapeEnum t) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, t, m);
    return m.Extent();
}

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    o.ok = true;
    o.f = count(s, TopAbs_FACE);
    o.e = count(s, TopAbs_EDGE);
    o.v = count(s, TopAbs_VERTEX);
    o.sh = count(s, TopAbs_SHELL);
    o.so = count(s, TopAbs_SOLID);
    try { o.valid = BRepCheck_Analyzer(s).IsValid() ? 1 : 0; } catch (...) { o.valid = -1; }
    GProp_GProps vp, sp;
    try { BRepGProp::VolumeProperties(s, vp); o.vol = vp.Mass();
          o.com[0] = vp.CentreOfMass().X(); o.com[1] = vp.CentreOfMass().Y();
          o.com[2] = vp.CentreOfMass().Z(); } catch (...) {}
    try { BRepGProp::SurfaceProperties(s, sp); o.area = sp.Mass(); } catch (...) {}

    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            o.vbb[0] = o.vbb[3] = p.X(); o.vbb[1] = o.vbb[4] = p.Y();
            o.vbb[2] = o.vbb[5] = p.Z(); first = false;
        } else {
            o.vbb[0] = std::min(o.vbb[0], p.X()); o.vbb[3] = std::max(o.vbb[3], p.X());
            o.vbb[1] = std::min(o.vbb[1], p.Y()); o.vbb[4] = std::max(o.vbb[4], p.Y());
            o.vbb[2] = std::min(o.vbb[2], p.Z()); o.vbb[5] = std::max(o.vbb[5], p.Z());
        }
    }
    try {
        Bnd_Box b;
        BRepBndLib::AddOptimal(s, b, Standard_False, Standard_False);
        b.Get(o.obb[0], o.obb[1], o.obb[2], o.obb[3], o.obb[4], o.obb[5]);
    } catch (...) {}

    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        try {
            BRepAdaptor_Surface ad(TopoDS::Face(ex.Current()), Standard_False);
            switch (ad.GetType()) {
                case GeomAbs_Plane:       ++o.st[0]; break;
                case GeomAbs_Cylinder:    ++o.st[1]; break;
                case GeomAbs_Cone:        ++o.st[2]; break;
                case GeomAbs_Sphere:      ++o.st[3]; break;
                case GeomAbs_Torus:       ++o.st[4]; break;
                case GeomAbs_BSplineSurface: ++o.st[5]; break;
                default:                  ++o.st[6]; break;
            }
        } catch (...) { ++o.st[6]; }
    }
    return o;
}

void dump(const char* tag, const Obs& o) {
    if (!o.ok) { std::printf("  %-8s ABSENT\n", tag); return; }
    std::printf("  %-8s F/E/V/sh/so %d/%d/%d/%d/%d  valid=%d\n",
                tag, o.f, o.e, o.v, o.sh, o.so, o.valid);
    std::printf("  %-8s vol %.10g   area %.10g   com (%.10g, %.10g, %.10g)\n",
                "", o.vol, o.area, o.com[0], o.com[1], o.com[2]);
    std::printf("  %-8s VERTEX  box [%.6f %.6f %.6f] .. [%.6f %.6f %.6f]\n",
                "", o.vbb[0], o.vbb[1], o.vbb[2], o.vbb[3], o.vbb[4], o.vbb[5]);
    std::printf("  %-8s OPTIMAL box [%.6f %.6f %.6f] .. [%.6f %.6f %.6f]\n",
                "", o.obb[0], o.obb[1], o.obb[2], o.obb[3], o.obb[4], o.obb[5]);
    std::printf("  %-8s surfaces  pl=%d cyl=%d cone=%d sph=%d tor=%d bspl=%d other=%d\n",
                "", o.st[0], o.st[1], o.st[2], o.st[3], o.st[4], o.st[5], o.st[6]);
}

double relv(double a, double b) {
    const double d = std::max(std::fabs(a), std::fabs(b));
    return d == 0.0 ? 0.0 : std::fabs(a - b) / d;
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
        if (st != IFSelect_RetDone) { std::printf("%s: STEP READ FAILED\n", name.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) { std::printf("%s: STEP TRANSFER EMPTY\n", name.c_str()); return 1; }

    // the A/B's own thickness rule: 0.05 * the part's vertex-box diagonal
    double bb[6] = {0, 0, 0, 0, 0, 0};
    bool first = true;
    for (TopExp_Explorer ex(shape, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z(); first = false; }
        else {
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double t = 0.05 * diag;

    TopoDS_Face pick; double pickArea = 0.0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        if (betterFace(f, a, pick, pickArea)) { pick = f; pickArea = a; }
    }
    if (pick.IsNull()) { std::printf("%s: NO FACE\n", name.c_str()); return 1; }

    std::printf("== %s   t=%.6g  (diag %.6g)\n", name.c_str(), t, diag);

    TopoDS_Shape nat, occ;
    try { nat = forge::occtthicken::thickenShell(pick, t, 1.0e-4); } catch (...) {}
    try { occ = forge::testoracle::occtThickenOracle(pick, t, 1.0e-4); } catch (...) {}

    const Obs on = observe(nat), oo = observe(occ);
    dump("NATIVE", on);
    dump("ORACLE", oo);

    if (on.ok && oo.ok) {
        double vmax = 0, omax = 0;
        for (int i = 0; i < 6; ++i) {
            vmax = std::max(vmax, std::fabs(on.vbb[i] - oo.vbb[i]));
            omax = std::max(omax, std::fabs(on.obb[i] - oo.obb[i]));
        }
        double cmax = 0;
        for (int i = 0; i < 3; ++i) cmax = std::max(cmax, std::fabs(on.com[i] - oo.com[i]));
        std::printf("  VERDICT  d|vol| rel %.3e   d area rel %.3e   d com %.3e mm\n",
                    relv(std::fabs(on.vol), std::fabs(oo.vol)), relv(on.area, oo.area), cmax);
        std::printf("  VERDICT  worst VERTEX-box difference  %.6f mm\n", vmax);
        std::printf("  VERDICT  worst OPTIMAL-box difference %.6e mm   <-- the geometric one\n", omax);
    }
    return 0;
}
