// tkoffset_gh_defer_census.cpp — per-part FIRST BINDING DEFER for the two
// TKOffset families whose native coverage sits at 1.2%: THICKSOLID (family G,
// occtoffset::makeThickSolid) and OFFSETSHAPE (family H,
// occtoffset::offsetSolidShape).
//
// WHY. reports/CORPUS_AB_COVERAGE.md §3.2 records the transferable lesson from
// THRUSECTIONS: a success RATE cannot distinguish "the corpus has nothing this
// engine covers" from "the engine declines the corpus's most common input for a
// reason inside the engine". Only a per-part cause census can. THICKSOLID and
// OFFSETSHAPE have never had one.
//
// METHOD. This TU #includes src/native/brep/NativeThickSolid.cpp, so the ladder
// below is walked with the engine's OWN helpers (surfKind, basisSurface,
// edgeFullCircle, faceSample, offsetSurfaceOf, vParamOf, offsetCircle) — the
// same code, not a re-derivation that could drift. The input derivation is
// copied from test/corpus_ab_coverage.cpp §2.3 so the census is over exactly the
// operations the coverage baseline measured.
//
// CONTROL. Every part also RUNS the real public entry points. The invariant
//   ladder said DEFER  =>  the engine returned a null shape
// is checked on every row and any violation is printed in the `control` column.
// A census that disagreed with the engine it claims to explain would be a
// harness result, not an engine result.
//
// ★ WHAT-WOULD-BIND-NEXT MODE — FORGE_GH_CENSUS_SKIP_S2_PLANAR=1
//
// A first-binding-rung census tells you what to fix FIRST. It does NOT tell you
// how far fixing it gets you, and reading it that way is a live trap: the
// obvious reading of the result below is "370 parts are blocked by the
// planar-wire rule, so lifting that rule frees 370 parts", which is FALSE and
// this mode is what proves it. With the rule suppressed IN THE LADDER ONLY (the
// engine is untouched and its verdict is still reported in eng_TS/eng_OS), the
// census keeps walking and reports the rung that binds after it.
//
// Use it before quoting a ceiling. A rung that hides another rung is the same
// mistake as a rate that hides a defect.

#include "../src/native/brep/NativeThickSolid.cpp"

#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Pln.hxx>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace forge {
namespace occtoffset {   // reopened so the anonymous-namespace helpers resolve

namespace census {

struct Row {
    std::string part;
    int nFaces = 0, nPlanar = 0, nCurved = 0;
    bool allPlanar = false;
    int fUnsupportedSurf = 0;     // SK::Other
    int fCurvedMultiWire = 0;
    int fCurvedPartialRev = 0;
    int fPlanarPolyWire = 0;      // planar wire carrying a non-full-circle edge
    int fPlanarMultiEdgeWire = 0; // planar wire of >1 full circles
    int fPlanarOk = 0;
    int fCurvedOk = 0;
    std::string rungTS, rungOS;
    bool engTS = false, engOS = false;
};

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

// ── census pass: how many faces of the part satisfy each step-2 rule ────────
// Runs to completion (no early return) so the SHAPE of the corpus is visible,
// not only its first obstacle.
void faceCensus(const TopoDS_Shape& shape, Row& row) {
    TopTools_IndexedMapOfShape faceIdx;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        if (faceIdx.Contains(f)) continue;
        faceIdx.Add(f);
        ++row.nFaces;
        const Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
        const SK k = surfKind(s);
        if (k == SK::Other) { ++row.fUnsupportedSurf; continue; }
        if (k == SK::Plane) ++row.nPlanar; else ++row.nCurved;

        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;

        if (k != SK::Plane) {
            double u1, u2, v1, v2;
            BRepTools::UVBounds(f, u1, u2, v1, v2);
            if (nWires != 1) { ++row.fCurvedMultiWire; continue; }
            if (std::fabs((u2 - u1) - 2.0 * kPi) > 1.0e-7) { ++row.fCurvedPartialRev; continue; }
            ++row.fCurvedOk;
        } else {
            bool poly = false, multi = false;
            for (TopoDS_Iterator it(f); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0; gp_Circ c; bool p = false;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    if (!edgeFullCircle(TopoDS::Edge(ee.Current()), c)) { p = true; break; }
                }
                if (p) { poly = true; break; }
                if (nE != 1) { multi = true; break; }
            }
            if (poly) ++row.fPlanarPolyWire;
            else if (multi) ++row.fPlanarMultiEdgeWire;
            else ++row.fPlanarOk;
        }
    }
}

// FORGE_GH_CENSUS_SKIP_S2_PLANAR=1 — see the banner. Diagnostic only: it changes
// what the LADDER reports, never what the engine does.
bool skipS2Planar() {
    static const bool v = [] {
        const char* e = std::getenv("FORGE_GH_CENSUS_SKIP_S2_PLANAR");
        return e && (*e == '1' || *e == 'y' || *e == 'Y');
    }();
    return v;
}

// ── the engine's ladder, walked in the engine's own order, first-return ─────
std::string walk(const TopoDS_Shape& shape, double t,
                 const TopTools_MapOfShape& removedSet, bool hollow) {
    std::vector<QF> qf;
    TopTools_IndexedMapOfShape faceIdx;

    // step 1
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        if (faceIdx.Contains(f)) continue;
        faceIdx.Add(f);
        QF q;
        q.face = f;
        q.surf = basisSurface(BRep_Tool::Surface(f));
        q.kind = surfKind(q.surf);
        q.removed = hollow && removedSet.Contains(f);
        if (q.kind == SK::Other) return "S1_unsupported_surface";
        BRepTools::UVBounds(f, q.u1, q.u2, q.v1, q.v2);
        q.nv1 = q.v1; q.nv2 = q.v2;
        if (!q.removed) {
            gp_Pnt P; gp_Dir outward;
            if (!faceSample(f, q.surf, q.u1, q.u2, q.v1, q.v2, P, outward))
                return "S1_face_sample_failed";
            const gp_Vec disp = hollow ? gp_Vec(outward) * (-t) : gp_Vec(outward) * t;
            q.off = offsetSurfaceOf(q.surf, q.kind, P, disp, std::fabs(t));
            if (q.off.IsNull()) return "S1_offset_surface_null";
        }
        qf.push_back(q);
    }
    if (qf.empty()) return "S1_no_faces";

    auto qOf = [&](const TopoDS_Shape& f) -> QF* {
        const int i = faceIdx.FindIndex(f);
        if (i == 0) return nullptr;
        return &qf[static_cast<std::size_t>(i) - 1];
    };

    // step 2
    for (const QF& q : qf) {
        int nWires = 0;
        for (TopoDS_Iterator it(q.face); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;
        if (q.kind != SK::Plane) {
            if (nWires != 1) return "S2_curved_face_multi_wire";
            if (std::fabs((q.u2 - q.u1) - 2.0 * kPi) > 1.0e-7)
                return "S2_curved_face_partial_revolution";
        } else {
            if (nWires < 1) return "S2_planar_face_no_wire";
            if (skipS2Planar()) continue;   // diagnostic: what binds AFTER this rule
            for (TopoDS_Iterator it(q.face); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0; gp_Circ c;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    if (!edgeFullCircle(TopoDS::Edge(ee.Current()), c))
                        return "S2_planar_wire_edge_not_full_circle";
                }
                if (nE != 1) return "S2_planar_wire_multi_edge";
            }
        }
    }

    // step 3
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;
        std::vector<QF*> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            QF* q = qOf(it.Value());
            if (!q) return "S3_face_not_indexed";
            if (std::find(nb.begin(), nb.end(), q) == nb.end()) nb.push_back(q);
        }
        if (nb.size() == 1) continue;
        if (nb.size() != 2) return "S3_non_manifold_edge";
        QF& A = *nb[0];
        QF& B = *nb[1];
        if (hollow && A.removed && B.removed) return "S3_zero_width_lip";
        gp_Circ orig;
        if (!edgeFullCircle(e, orig)) return "S3_edge_not_full_circle";
        gp_Circ oc;
        const bool ok = hollow
            ? offsetCircle(orig, A.surf, A.kind, B.surf, B.kind,
                           contributing(A), A.removed ? A.kind : surfKind(A.off),
                           contributing(B), B.removed ? B.kind : surfKind(B.off), oc)
            : offsetCircle(orig, A.surf, A.kind, B.surf, B.kind,
                           A.off, surfKind(A.off), B.off, surfKind(B.off), oc);
        if (!ok) return "S3_offset_circle_failed";
        for (QF* q : nb) {
            if (q->kind == SK::Plane) continue;
            if (hollow && q->removed) continue;
            double vOrig = 0.0, vNew = 0.0;
            if (!vParamOf(q->surf, q->kind, orig, vOrig)) return "S3_vparam_orig_failed";
            if (!vParamOf(q->off, q->kind, oc, vNew)) return "S3_vparam_offset_failed";
            const bool atLo = std::fabs(vOrig - q->v1) <= std::fabs(vOrig - q->v2);
            if (atLo) { q->nv1 = vNew; q->gotV1 = true; }
            else      { q->nv2 = vNew; q->gotV2 = true; }
        }
    }
    return "PASSED_S1_S3";   // whatever binds is in the build/sew/self-check tail
}

int run(const char* stepPath) {
    Row row;
    {
        std::string p(stepPath);
        const size_t s = p.find_last_of('/');
        row.part = (s == std::string::npos) ? p : p.substr(s + 1);
        const size_t d = row.part.find_last_of('.');
        if (d != std::string::npos) row.part = row.part.substr(0, d);
    }
    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) { std::printf("%s\tSTEP_READ_FAILED\n", row.part.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) { std::printf("%s\tSTEP_EMPTY\n", row.part.c_str()); return 1; }

    double bb[6] = {1e300, 1e300, 1e300, -1e300, -1e300, -1e300};
    {
        TopTools_IndexedMapOfShape vm;
        TopExp::MapShapes(shape, TopAbs_VERTEX, vm);
        if (vm.Extent() == 0) { std::printf("%s\tNO_VERTICES\n", row.part.c_str()); return 1; }
        for (int i = 1; i <= vm.Extent(); ++i) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vm(i)));
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double minExt = std::min(dx, std::min(dy, dz));
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const bool flat = !(minExt > 1e-9 * diag);
    const double scale = flat ? diag * 0.05 : minExt;
    const double wall = 0.05 * scale;
    const double dist = 0.02 * scale;

    TopoDS_Face planarBig; double planarBigArea = 0.0;
    {
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            if (betterFace(f, a, planarBig, planarBigArea)) { planarBig = f; planarBigArea = a; }
        }
    }

    {
        row.allPlanar = true;
        for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next())
            if (surfKind(basisSurface(BRep_Tool::Surface(TopoDS::Face(ex.Current())))) != SK::Plane) {
                row.allPlanar = false; break;
            }
    }

    faceCensus(shape, row);

    TopTools_MapOfShape rmSet, empty;
    if (!planarBig.IsNull()) rmSet.Add(planarBig);

    if (row.allPlanar) {
        row.rungTS = "PLANAR_PATH";
        row.rungOS = "PLANAR_PATH";
    } else {
        row.rungTS = planarBig.IsNull() ? "NO_PLANAR_FACE" : walk(shape, wall, rmSet, true);
        row.rungOS = walk(shape, dist, empty, false);
    }

    // ── CONTROL: run the real public entry points ──────────────────────────
    if (!planarBig.IsNull()) {
        TopTools_ListOfShape faces;
        faces.Append(planarBig);
        TopoDS_Shape r;
        try { r = makeThickSolid(shape, wall, faces, 1.0e-3); } catch (...) {}
        row.engTS = !r.IsNull();
    }
    {
        TopoDS_Shape r;
        try { r = offsetSolidShape(shape, dist, 1.0e-7); } catch (...) {}
        row.engOS = !r.IsNull();
    }

    std::string vio;
    if (row.rungTS.rfind("S", 0) == 0 && row.engTS) vio += "CONTROL_VIOLATION_TS ";
    if (row.rungOS.rfind("S", 0) == 0 && row.engOS) vio += "CONTROL_VIOLATION_OS ";
    if (vio.empty()) vio = "ok";

    std::printf("%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%s\t%d\t%d\t%s\n",
                row.part.c_str(), row.nFaces, row.nPlanar, row.nCurved,
                row.fUnsupportedSurf, row.fCurvedMultiWire, row.fCurvedPartialRev,
                row.fPlanarPolyWire, row.fPlanarMultiEdgeWire, row.fPlanarOk, row.fCurvedOk,
                row.rungTS.c_str(), row.rungOS.c_str(),
                row.engTS ? 1 : 0, row.engOS ? 1 : 0, vio.c_str());
    std::fflush(stdout);
    return 0;
}

}  // namespace census
}  // namespace occtoffset
}  // namespace forge

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step> [...]\n", argv[0]); return 2; }
    if (std::strcmp(argv[1], "--header") == 0) {
        std::printf("part\tnFaces\tnPlanar\tnCurved\tunsupported\tcurvedMultiWire\t"
                    "curvedPartialRev\tplanarPolyWire\tplanarMultiEdgeWire\tplanarOk\tcurvedOk\t"
                    "rung_THICKSOLID\trung_OFFSETSHAPE\teng_TS\teng_OS\tcontrol\n");
        return 0;
    }
    int rc = 0;
    for (int i = 1; i < argc; ++i) rc |= forge::occtoffset::census::run(argv[i]);
    return rc;
}
