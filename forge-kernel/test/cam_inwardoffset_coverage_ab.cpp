// camoffset_ab.cpp — the flip gate's COVERAGE clause, run against the SHIPPED
// function rather than a replica.
//
// FORGE_OFFSET_DROP_MAKEOFFSET's stated flip condition is "native defers <= the
// OCCT baseline rate" for forge::cam::inwardOffset (forge-kernel/CMakeLists.txt
// :527). The 382-part corpus that condition was first measured over
// (data/forge/complex_all.jsonl) is not in the tree at this SHA, so this drives
// the SAME function over the 600-part corpus that IS: for each part, the outer
// wire of its largest planar face, brought into that plane's own frame (the
// transform Cam's XY-planar call sites would already have applied), offset
// inward by 0.05*sqrt(area).
//
// WHY IT #includes Cam.cpp. inwardOffset lives in Cam.cpp's ANONYMOUS namespace
// (src/Cam.cpp:91-449), so it has internal linkage and cannot be linked to. It
// is textually included rather than copied precisely so that what runs here is
// the shipped code and the shipped #ifdef, not a replica that could drift.
//
// The two arms are two BINARIES of this same file:
//   stock : compiled WITHOUT the drop -> BRepOffsetAPI_MakeOffset (the FEAT gate
//           is default OFF, so this is the OCCT baseline the option must beat)
//   drop  : compiled WITH -DFORGE_OFFSET_DROP_MAKEOFFSET -> PolygonOffset2D only
// A defer is an empty TopoDS_Shape, which is exactly what the call sites treat
// as "re-use the unoffset wire".
#include "../src/Cam.cpp"   // NOLINT — see the note above

#include <cstdio>
#include <cstring>
#include <cmath>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <gp_Ax3.hxx>
#include <gp_Trsf.hxx>

namespace {

double abFaceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}

gp_Pnt abFaceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}

bool abPlaneOf(const TopoDS_Face& f, gp_Pln& out) {
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

// Byte-for-byte the tie-break rule test/corpus_ab_coverage.cpp uses, so both
// harnesses derive the SAME operation from the same part.
bool abBetterFace(const TopoDS_Face& cand, double candArea,
                  const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = abFaceCentroid(cand), b = abFaceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

}  // namespace

int main(int argc, char** argv) {
    int nOk = 0, nDefer = 0, nSkip = 0;
#if defined(FORGE_OFFSET_DROP_MAKEOFFSET)
    const char* arm = "drop  (PolygonOffset2D only)";
#else
    const char* arm = "stock (BRepOffsetAPI_MakeOffset)";
#endif
    std::printf("# arm: %s\n", arm);
    for (int i = 1; i < argc; ++i) {
        STEPControl_Reader rd;
        TopoDS_Shape shape;
        try {
            if (rd.ReadFile(argv[i]) != IFSelect_RetDone) { ++nSkip; continue; }
            rd.TransferRoots();
            shape = rd.OneShape();
        } catch (...) { ++nSkip; continue; }
        if (shape.IsNull()) { ++nSkip; continue; }

        TopoDS_Face big;
        double bigArea = 0.0;
        gp_Pln bigPln;
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int k = 1; k <= fm.Extent(); ++k) {
            const TopoDS_Face f = TopoDS::Face(fm(k));
            const double a = abFaceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!abPlaneOf(f, pl)) continue;
            if (abBetterFace(f, a, big, bigArea)) { big = f; bigArea = a; bigPln = pl; }
        }
        if (big.IsNull()) { ++nSkip; continue; }
        const TopoDS_Wire w = BRepTools::OuterWire(big);
        if (w.IsNull()) { ++nSkip; continue; }

        // Into the face's own plane frame, so the wire this hands the SHIPPED
        // function is XY-planar -- the precondition every Cam call site already
        // satisfies. Nothing else about the call changes.
        const gp_Ax3 ax(bigPln.Location(), bigPln.Axis().Direction());
        gp_Trsf toLocal;
        toLocal.SetTransformation(ax);
        TopoDS_Shape moved;
        try { moved = BRepBuilderAPI_Transform(w, toLocal, true).Shape(); }
        catch (...) { ++nSkip; continue; }
        if (moved.IsNull() || moved.ShapeType() != TopAbs_WIRE) { ++nSkip; continue; }

        const double d = 0.05 * std::sqrt(bigArea);
        TopoDS_Shape res;
        try {
            res = forge::cam::inwardOffset(TopoDS::Wire(moved), d,
                                           gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)));
        } catch (...) { res = TopoDS_Shape(); }

        const char* base = std::strrchr(argv[i], '/');
        base = base ? base + 1 : argv[i];
        const bool ok = !res.IsNull();
        ok ? ++nOk : ++nDefer;
        std::printf("%-16s %s\n", base, ok ? "OK" : "DEFER");
        std::fflush(stdout);
    }
    std::printf("TOTAL ok=%d defer=%d skipped=%d\n", nOk, nDefer, nSkip);
    return 0;
}
