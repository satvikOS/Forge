// tkoffset_gh_quality_probe.cpp — what are the THICKSOLID / OFFSETSHAPE
// "successes" actually WORTH?
//
// The coverage baseline (reports/CORPUS_AB_COVERAGE.md) counts a success as
// "the call site would have accepted it", deliberately excluding validity so the
// harness does not mark its own homework. That is the right choice for a
// coverage gate and the wrong one for a SHIPPING argument: a family where the
// incumbent engine returns 133 results and 0 of them are valid solids is not the
// same family as one where the incumbent works.
//
// So this probe measures, per part, for both arms:
//   * BRepCheck_Analyzer validity
//   * the result volume against the SOURCE SOLID's volume
//   * shell / solid / face counts
// A correct uniform-wall hollow of wall t has volume ~ surfaceArea * t, i.e. a
// small fraction of the source volume. A result whose volume is close to (or
// above) the source volume is not a hollow at all.

#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffset_Mode.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_JoinType.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <gp_Pln.hxx>

#include "forge/native/brep/NativeThickSolid.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

namespace {

double volOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps g;
    try { BRepGProp::VolumeProperties(s, g); } catch (...) { return 0.0; }
    return g.Mass();
}
double areaOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(s, g); } catch (...) { return 0.0; }
    return g.Mass();
}
int countOf(const TopoDS_Shape& s, TopAbs_ShapeEnum t) {
    if (s.IsNull()) return 0;
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, t, m);
    return m.Extent();
}
int validOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return -1;
    try { return BRepCheck_Analyzer(s).IsValid() ? 1 : 0; } catch (...) { return -1; }
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
bool betterFace(const TopoDS_Face& c, double ca, const TopoDS_Face& b, double ba) {
    if (b.IsNull()) return ca > 0.0;
    if (ca > ba * (1.0 + 1e-12)) return true;
    if (ca < ba * (1.0 - 1e-12)) return false;
    const gp_Pnt x = faceCentroid(c), y = faceCentroid(b);
    if (x.X() != y.X()) return x.X() < y.X();
    if (x.Y() != y.Y()) return x.Y() < y.Y();
    return x.Z() < y.Z();
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step> [...]\n", argv[0]); return 2; }
    if (std::string(argv[1]) == "--header") {
        std::printf("part\tsrcVol\tsrcArea\twall\tdist\t"
                    "ts_nat_vol\tts_nat_valid\tts_nat_f\tts_nat_sh\tts_nat_so\t"
                    "ts_occ_vol\tts_occ_valid\tts_occ_f\tts_occ_sh\tts_occ_so\t"
                    "os_nat_vol\tos_nat_valid\tos_occ_vol\tos_occ_valid\n");
        return 0;
    }
    for (int a = 1; a < argc; ++a) {
        std::string name(argv[a]);
        const size_t s = name.find_last_of('/');
        if (s != std::string::npos) name = name.substr(s + 1);
        const size_t d = name.find_last_of('.');
        if (d != std::string::npos) name = name.substr(0, d);

        TopoDS_Shape shape;
        {
            STEPControl_Reader rd;
            IFSelect_ReturnStatus st = IFSelect_RetFail;
            try { st = rd.ReadFile(argv[a]); } catch (...) {}
            if (st != IFSelect_RetDone) { std::printf("%s\tREAD_FAIL\n", name.c_str()); continue; }
            try { rd.TransferRoots(); } catch (...) {}
            try { shape = rd.OneShape(); } catch (...) {}
        }
        if (shape.IsNull()) { std::printf("%s\tEMPTY\n", name.c_str()); continue; }

        double bb[6] = {1e300, 1e300, 1e300, -1e300, -1e300, -1e300};
        TopTools_IndexedMapOfShape vm;
        TopExp::MapShapes(shape, TopAbs_VERTEX, vm);
        for (int i = 1; i <= vm.Extent(); ++i) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vm(i)));
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
        const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
        const double minExt = std::min(dx, std::min(dy, dz));
        const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
        const double scale = (minExt > 1e-9 * diag) ? minExt : diag * 0.05;
        const double wall = 0.05 * scale, dist = 0.02 * scale;

        TopoDS_Face big; double bigA = 0.0;
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            const double ar = faceArea(f);
            if (!(ar > 0.0)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            if (betterFace(f, ar, big, bigA)) { big = f; bigA = ar; }
        }

        TopoDS_Shape tsN, tsO, osN, osO;
        if (!big.IsNull()) {
            TopTools_ListOfShape fl; fl.Append(big);
            try { tsN = forge::occtoffset::makeThickSolid(shape, wall, fl, 1.0e-3); } catch (...) {}
            try {
                BRepOffsetAPI_MakeThickSolid mk;
                mk.MakeThickSolidByJoin(shape, fl, -wall, 1.0e-3);
                mk.Build();
                if (mk.IsDone()) tsO = mk.Shape();
            } catch (...) {}
        }
        try { osN = forge::occtoffset::offsetSolidShape(shape, dist, 1.0e-7); } catch (...) {}
        try {
            BRepOffsetAPI_MakeOffsetShape mk;
            mk.PerformByJoin(shape, dist, 1.0e-7, BRepOffset_Skin,
                             Standard_False, Standard_False, GeomAbs_Intersection);
            if (mk.IsDone()) {
                TopoDS_Shape off = mk.Shape();
                if (!off.IsNull() && off.ShapeType() == TopAbs_SHELL) {
                    BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(off));
                    if (ms.IsDone()) off = ms.Solid();
                }
                osO = off;
            }
        } catch (...) {}

        std::printf("%s\t%.6g\t%.6g\t%.6g\t%.6g\t"
                    "%.6g\t%d\t%d\t%d\t%d\t"
                    "%.6g\t%d\t%d\t%d\t%d\t"
                    "%.6g\t%d\t%.6g\t%d\n",
                    name.c_str(), volOf(shape), areaOf(shape), wall, dist,
                    volOf(tsN), validOf(tsN), countOf(tsN, TopAbs_FACE),
                    countOf(tsN, TopAbs_SHELL), countOf(tsN, TopAbs_SOLID),
                    volOf(tsO), validOf(tsO), countOf(tsO, TopAbs_FACE),
                    countOf(tsO, TopAbs_SHELL), countOf(tsO, TopAbs_SOLID),
                    volOf(osN), validOf(osN), volOf(osO), validOf(osO));
        std::fflush(stdout);
    }
    return 0;
}
