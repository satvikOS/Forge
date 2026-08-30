// draft_defer_probe.cpp — WHY does the native DRAFT engine decline every part?
//
// THE QUESTION. The 600-part corpus A/B (reports/corpus_ab/summary.md) measures
// family J at native 0.0% against OCCT 88.0%, native arm statuses "DEFER:565".
// A defer count alone cannot distinguish three very different worlds:
//   (i)   a narrow APPLICABILITY PREDICATE rejecting inputs the engine's method
//         could in principle handle,
//   (ii)  a genuine CAPABILITY GAP — the method does not cover these shapes,
//   (iii) a WIRING DEFECT — the engine is never actually reached.
// Those decide different roadmaps, so this probe names the guard that fires.
//
// METHOD. The part derivation is copied VERBATIM from test/corpus_ab_coverage.cpp
// (boundsOf / faceArea / faceCentroid / planeOf / betterFace / the sideWall pick
// and the DRAFT case's arguments) so the input distribution is the same one the
// A/B measured; a probe over a different distribution would answer a different
// question. It then calls the SAME entry point the A/B's native arm calls —
// forge::occtdraft::draftFaces — and reads occtdraft::draftLastDeferReason().
// The reason is therefore the ENGINE's own, not a re-implementation of its
// guards that could drift from them.
//
// AND THE ROADMAP CENSUS. Alongside the guard it counts, per part:
//   * how many faces of the solid are planes and how many carry >1 wire — the
//     two WHOLE-SHAPE preconditions of the plane-arrangement formulation;
//   * the LOCAL neighbourhood of the drafted wall: the faces incident to the
//     drafted face's own vertices. Those, and only those, must be rebuilt when
//     the wall tilts (their rings contain a moved corner); every other face of
//     the solid could be carried over verbatim. So "is the local neighbourhood
//     all-planar and single-wire" is exactly the coverage a LOCAL rebuild would
//     have, and it is the number that says whether relaxing the whole-shape
//     precondition is worth anything.
//
// POSITIVE CONTROL. --selftest drafts a box's side wall through this same
// binary and REQUIRES a non-null result with an empty defer reason, and drafts
// a cylinder-bearing solid and REQUIRES the non-plane defer. A probe that
// reported "declined" because it was mis-wired would look exactly like a
// genuine 0%, so both directions are proved before any corpus number is read.
//
// Prints one JSON object per part on stdout. Exit 0 iff the part imported.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeDraft.hpp"

namespace {

constexpr double kPi = 3.14159265358979323846;

// ── copied verbatim from test/corpus_ab_coverage.cpp ────────────────────────
bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z();
            first = false;
        } else {
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    return !first;
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
// ── end verbatim copy ───────────────────────────────────────────────────────

int wireCount(const TopoDS_Face& f) {
    int n = 0;
    for (TopoDS_Iterator it(f); it.More(); it.Next())
        if (it.Value().ShapeType() == TopAbs_WIRE) ++n;
    return n;
}

// Escape a defer reason for JSON (the strings are plain ASCII prose, but a
// stray quote would silently corrupt every downstream count).
std::string jesc(const char* s) {
    std::string o;
    for (const char* p = s ? s : ""; *p; ++p) {
        if (*p == '"' || *p == '\\') { o += '\\'; o += *p; }
        else if (static_cast<unsigned char>(*p) < 0x20) o += ' ';
        else o += *p;
    }
    return o;
}

// The drafted wall's OWN vertices, and every face incident to one of them.
// Those faces are exactly the ones a LOCAL rebuild would have to re-make.
// nLocalNonLineEdges is counted too, because a LOCAL rebuild would re-make each
// touched face as a POLYGON over its (partly moved) ring — which silently
// replaces a circular edge by its chord. A curved edge on a touched face is
// therefore a third obstacle, independent of planarity and wire count, and
// leaving it out would overstate what a bounded fix could reach.
void localNeighbourhood(const TopoDS_Shape& shape, const TopoDS_Face& wall,
                        int& nLocalFaces, int& nLocalPlanar, int& nLocalSingleWire,
                        int& nLocalNonLineEdges,
                        int& nMovedEdges, int& nMovedNonLineEdges) {
    nLocalFaces = nLocalPlanar = nLocalSingleWire = nLocalNonLineEdges = 0;
    nMovedEdges = nMovedNonLineEdges = 0;
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    TopTools_MapOfShape seen, seenEdge, wallVerts;
    for (TopExp_Explorer wv(wall, TopAbs_VERTEX); wv.More(); wv.Next())
        wallVerts.Add(wv.Current());
    for (TopExp_Explorer vx(wall, TopAbs_VERTEX); vx.More(); vx.Next()) {
        const int idx = vfMap.FindIndex(vx.Current());
        if (idx == 0) continue;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(idx)); it.More(); it.Next()) {
            if (!seen.Add(it.Value())) continue;
            const TopoDS_Face f = TopoDS::Face(it.Value());
            ++nLocalFaces;
            gp_Pln pl;
            if (planeOf(f, pl)) ++nLocalPlanar;
            if (wireCount(f) == 1) ++nLocalSingleWire;
            for (TopExp_Explorer ee(f, TopAbs_EDGE); ee.More(); ee.Next()) {
                if (!seenEdge.Add(ee.Current())) continue;
                BRepAdaptor_Curve ad;
                bool line = false;
                try { ad.Initialize(TopoDS::Edge(ee.Current())); line = (ad.GetType() == GeomAbs_Line); }
                catch (...) { line = false; }
                if (!line) ++nLocalNonLineEdges;
                // MOVED edges: those with at least one endpoint on the drafted
                // wall. Only these actually change shape, so a rebuild that keeps
                // untouched edges verbatim is bounded by THESE being lines, not by
                // every edge of every touched face being one.
                bool touches = false;
                for (TopExp_Explorer ev(ee.Current(), TopAbs_VERTEX); ev.More(); ev.Next())
                    if (wallVerts.Contains(ev.Current())) { touches = true; break; }
                if (touches) { ++nMovedEdges; if (!line) ++nMovedNonLineEdges; }
            }
        }
    }
}

int selftest() {
    int bad = 0;

    // POSITIVE: a box side wall MUST draft, with an empty defer reason.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        TopoDS_Face wall;
        for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) {
            gp_Pln pl;
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            if (planeOf(f, pl) && std::fabs(pl.Axis().Direction().Z()) < 0.1) { wall = f; break; }
        }
        if (wall.IsNull()) { std::printf("  selftest: no side wall on a box\n"); return 1; }
        TopTools_ListOfShape fs; fs.Append(wall);
        const gp_Pln neutral(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        const TopoDS_Shape out = forge::occtdraft::draftFaces(
            box, fs, gp_Dir(0, 0, 1), 3.0 * kPi / 180.0, neutral, 1.0e-6);
        const std::string why = forge::occtdraft::draftLastDeferReason();
        GProp_GProps g;
        double vol = 0.0;
        if (!out.IsNull()) { BRepGProp::VolumeProperties(out, g); vol = std::fabs(g.Mass()); }
        if (out.IsNull() || !why.empty() || !(vol > 0.0)) {
            std::printf("  POSITIVE CONTROL FAILED: null=%d why='%s' vol=%.6g\n",
                        out.IsNull() ? 1 : 0, why.c_str(), vol);
            bad = 1;
        } else {
            std::printf("  positive control: box side wall drafted, vol %.6g, reason '' ok\n", vol);
        }
    }

    // NEGATIVE: a solid carrying a cylindrical face MUST defer with the
    // non-plane reason — the exact guard this probe attributes the corpus to.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10.0, 10.0, 10.0).Shape();
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(3.0, 4.0).Shape();
        TopoDS_Shape fused;
        try { fused = BRepAlgoAPI_Fuse(box, cyl).Shape(); } catch (...) {}
        if (fused.IsNull()) { std::printf("  selftest: fuse failed\n"); return 1; }
        TopoDS_Face wall;
        for (TopExp_Explorer ex(fused, TopAbs_FACE); ex.More(); ex.Next()) {
            gp_Pln pl;
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            if (planeOf(f, pl) && std::fabs(pl.Axis().Direction().Z()) < 0.1) { wall = f; break; }
        }
        if (wall.IsNull()) { std::printf("  selftest: no side wall on the fused solid\n"); return 1; }
        TopTools_ListOfShape fs; fs.Append(wall);
        const gp_Pln neutral(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        const TopoDS_Shape out = forge::occtdraft::draftFaces(
            fused, fs, gp_Dir(0, 0, 1), 3.0 * kPi / 180.0, neutral, 1.0e-6);
        const std::string why = forge::occtdraft::draftLastDeferReason();
        if (!out.IsNull() || why != "a face of the solid is not a plane") {
            std::printf("  NEGATIVE CONTROL FAILED: null=%d why='%s'\n",
                        out.IsNull() ? 1 : 0, why.c_str());
            bad = 1;
        } else {
            std::printf("  negative control: cylinder-bearing solid defers '%s' ok\n", why.c_str());
        }
    }

    std::printf(bad ? "SELFTEST FAIL\n" : "SELFTEST PASS\n");
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    std::string stepPath, partName;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a.rfind("--name=", 0) == 0) partName = a.substr(7);
        else if (a.rfind("--", 0) != 0) stepPath = a;
    }
    if (stepPath.empty()) {
        std::fprintf(stderr, "usage: draft_defer_probe <part.step> [--name=ID]\n"
                             "       draft_defer_probe --selftest\n");
        return 2;
    }
    if (partName.empty()) {
        const size_t slash = stepPath.find_last_of('/');
        partName = (slash == std::string::npos) ? stepPath : stepPath.substr(slash + 1);
        const size_t dot = partName.find_last_of('.');
        if (dot != std::string::npos) partName = partName.substr(0, dot);
    }

    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", partName.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
        if (shape.IsNull()) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", partName.c_str());
            return 1;
        }
    }
    double bb[6] = {0, 0, 0, 0, 0, 0};
    if (!boundsOf(shape, bb)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", partName.c_str());
        return 1;
    }

    // ── the A/B's own sideWall pick ─────────────────────────────────────────
    TopoDS_Face sideWall; double sideWallArea = 0.0;
    int nFaces = 0, nPlanar = 0, nMultiWire = 0, nPlanarMultiWire = 0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    nFaces = fm.Extent();
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const int nw = wireCount(f);
        if (nw != 1) ++nMultiWire;
        const double a = faceArea(f);
        gp_Pln pl;
        const bool isPlane = planeOf(f, pl);
        if (isPlane) { ++nPlanar; if (nw != 1) ++nPlanarMultiWire; }
        if (!(a > 0.0)) continue;
        if (isPlane && std::fabs(pl.Axis().Direction().Z()) < 0.1 &&
            betterFace(f, a, sideWall, sideWallArea)) {
            sideWall = f; sideWallArea = a;
        }
    }

    if (sideWall.IsNull()) {
        std::printf("{\"part\":\"%s\",\"applicable\":false,\"na_reason\":\"no_planar_side_wall\","
                    "\"nfaces\":%d,\"nplanar\":%d,\"nmultiwire\":%d}\n",
                    partName.c_str(), nFaces, nPlanar, nMultiWire);
        return 0;
    }

    // ── the A/B's own DRAFT arguments ───────────────────────────────────────
    const double ang = 3.0 * kPi / 180.0;
    const gp_Dir pull(0, 0, 1);
    const gp_Pln neutral(gp_Pnt(0, 0, bb[2]), gp_Dir(0, 0, 1));
    TopTools_ListOfShape faces;
    faces.Append(sideWall);

    TopoDS_Shape out;
    std::string why;
    bool threw = false;
    try {
        out = forge::occtdraft::draftFaces(shape, faces, pull, ang, neutral, 1.0e-6);
        why = forge::occtdraft::draftLastDeferReason();
    } catch (const Standard_Failure& e) {
        threw = true; why = e.GetMessageString() ? e.GetMessageString() : "Standard_Failure";
    } catch (const std::exception& e) {
        threw = true; why = e.what();
    } catch (...) { threw = true; why = "unknown throw"; }

    int nLocal = 0, nLocalPlanar = 0, nLocalSingleWire = 0, nLocalCurved = 0;
    int nMovedE = 0, nMovedCurvedE = 0;
    localNeighbourhood(shape, sideWall, nLocal, nLocalPlanar, nLocalSingleWire, nLocalCurved,
                       nMovedE, nMovedCurvedE);

    double vol = 0.0;
    if (!out.IsNull()) {
        GProp_GProps g;
        try { BRepGProp::VolumeProperties(out, g); vol = g.Mass(); } catch (...) {}
    }

    std::printf("{\"part\":\"%s\",\"applicable\":true,\"status\":\"%s\",\"reason\":\"%s\","
                "\"vol\":%.10g,\"nfaces\":%d,\"nplanar\":%d,\"nnonplanar\":%d,"
                "\"nmultiwire\":%d,\"nplanar_multiwire\":%d,"
                "\"wall_wires\":%d,\"local_faces\":%d,\"local_planar\":%d,"
                "\"local_single_wire\":%d,\"local_curved_edges\":%d,"
                "\"moved_edges\":%d,\"moved_curved_edges\":%d,\"local_all_planar\":%s,"
                "\"local_all_planar_single_wire\":%s}\n",
                partName.c_str(),
                threw ? "THREW" : (out.IsNull() ? "DEFER" : "OK"),
                jesc(why.c_str()).c_str(), vol,
                nFaces, nPlanar, nFaces - nPlanar, nMultiWire, nPlanarMultiWire,
                wireCount(sideWall), nLocal, nLocalPlanar, nLocalSingleWire, nLocalCurved,
                nMovedE, nMovedCurvedE,
                (nLocal > 0 && nLocalPlanar == nLocal) ? "true" : "false",
                (nLocal > 0 && nLocalPlanar == nLocal && nLocalSingleWire == nLocal)
                    ? "true" : "false");
    return 0;
}
