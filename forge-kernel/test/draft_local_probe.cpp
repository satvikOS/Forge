// draft_local_probe.cpp — what does the GENERAL native draft actually cover?
//
// THE QUESTION. The 600-part corpus A/B measures family J at native 0.0%
// against OCCT's 88.0%, and test/draft_defer_probe.cpp established WHY: the
// plane-arrangement engine's two whole-shape preconditions are violated by 565
// of 565 applicable parts, BOTH of them, with zero parts violating exactly one.
// src/native/brep/NativeDraftLocal.cpp is the different construction that
// finding demanded. This probe measures it, on the SAME 600 parts, with the SAME
// derivation, against the SAME reference.
//
// METHOD. The part derivation — boundsOf / faceArea / faceCentroid / planeOf /
// betterFace / the sideWall pick and the DRAFT case's arguments — is copied
// VERBATIM from test/draft_defer_probe.cpp, which copied it verbatim from
// test/corpus_ab_coverage.cpp. A probe over a different distribution would
// answer a different question, and the point of this one is to be comparable to
// the row it is trying to move.
//
// IT DOES NOT SCORE ITSELF ON "DID NOT DEFER". A native answer counts only if it
// AGREES WITH OCCT on a VECTOR of observables, because VOLUME ALONE CANNOT
// VALIDATE GEOMETRY:
//     volume, surface area, centre of mass (3), bounding box (6),
//     face / edge / vertex / shell counts, Euler characteristic, genus,
//     and BRepCheck validity.
// Every row carries the per-observable verdict, so a part that "built" while
// disagreeing is visible as such and is NOT counted as coverage.
//
// It also reports the ENGINE'S OWN path census (draftLocalLastStats): which of
// the three vertex solves carried the part, how many faces and wires were
// carried verbatim, and how many edges were re-trimmed rather than rebuilt.
// Those paths have different exactness arguments, so a coverage number that
// cannot say which of them did the work cannot be read — and a path that never
// fires is only findable with a counter.
//
// CONTROLS. --selftest drafts a cube's side wall (POSITIVE: must build and must
// match the closed-form frustum volume) and a plate whose bore breaks out
// through the drafted wall (NEGATIVE: must decline, naming the non-planar
// neighbour). A probe that reported 0% because it was mis-wired would look
// exactly like a genuine 0%, so both directions are proved before any corpus
// number is read.
//
// Prints one JSON object per part on stdout. Exit 0 iff the part imported.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
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
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

// The reference half. Linked here on purpose; the engine's own object file is
// checked for zero TKOffset imports by run_ab_native_draft_local.sh.
#include <BRepOffsetAPI_DraftAngle.hxx>

#include "forge/native/brep/NativeDraftLocal.hpp"

namespace {

constexpr double kPi = 3.14159265358979323846;

// ── copied verbatim from test/draft_defer_probe.cpp ─────────────────────────
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

std::string jesc(const char* s) {
    std::string o;
    for (const char* p = s ? s : ""; *p; ++p) {
        if (*p == '"' || *p == '\\') { o += '\\'; o += *p; }
        else if (static_cast<unsigned char>(*p) < 0x20) o += ' ';
        else o += *p;
    }
    return o;
}

// ── the observable vector ───────────────────────────────────────────────────
struct Obs {
    double vol = 0.0, area = 0.0;
    double com[3] = {0, 0, 0};
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    int nF = 0, nE = 0, nV = 0, nS = 0, euler = 0, genus2 = 0;
    bool valid = false;
    bool have = false;
};

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    try {
        GProp_GProps p;
        BRepGProp::VolumeProperties(s, p);
        o.vol = std::fabs(p.Mass());
        const gp_Pnt c = p.CentreOfMass();
        o.com[0] = c.X(); o.com[1] = c.Y(); o.com[2] = c.Z();
        GProp_GProps sp;
        BRepGProp::SurfaceProperties(s, sp);
        o.area = sp.Mass();
    } catch (...) { return o; }

    TopTools_IndexedMapOfShape mf, me, mv, ms;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    TopExp::MapShapes(s, TopAbs_SHELL, ms);
    o.nF = mf.Extent(); o.nE = me.Extent(); o.nV = mv.Extent(); o.nS = ms.Extent();
    o.euler = o.nV - o.nE + o.nF;
    o.genus2 = 2 * o.nS - o.euler;
    for (int i = 1; i <= mv.Extent(); ++i) {
        const gp_Pnt q = BRep_Tool::Pnt(TopoDS::Vertex(mv.FindKey(i)));
        const double v[3] = {q.X(), q.Y(), q.Z()};
        for (int k = 0; k < 3; ++k) {
            if (i == 1) { o.lo[k] = o.hi[k] = v[k]; }
            else { o.lo[k] = std::min(o.lo[k], v[k]); o.hi[k] = std::max(o.hi[k], v[k]); }
        }
    }
    try { o.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True; } catch (...) {}
    o.have = true;
    return o;
}

// Which observables DISAGREE, as a comma-joined list. Empty means agreement on
// all of them. `scale` is the model's own size, so the length bounds mean the
// same thing on a 1 mm part and a 1 m one; it is derived from the input and is
// never widened to make a part pass.
std::string disagreements(const Obs& a, const Obs& b, double scale) {
    std::string out;
    auto add = [&](const char* w) { if (!out.empty()) out += ","; out += w; };
    const double lenTol = 1.0e-6 * std::max(1.0, scale);
    if (!(std::fabs(a.vol - b.vol) <= 1.0e-6 * std::max(1.0, b.vol)))   add("volume");
    if (!(std::fabs(a.area - b.area) <= 1.0e-6 * std::max(1.0, b.area))) add("area");
    static const char* cn[3] = {"com.x", "com.y", "com.z"};
    static const char* ln[3] = {"bbox.lo.x", "bbox.lo.y", "bbox.lo.z"};
    static const char* hn[3] = {"bbox.hi.x", "bbox.hi.y", "bbox.hi.z"};
    for (int k = 0; k < 3; ++k) {
        if (!(std::fabs(a.com[k] - b.com[k]) <= lenTol)) add(cn[k]);
        if (!(std::fabs(a.lo[k]  - b.lo[k])  <= lenTol)) add(ln[k]);
        if (!(std::fabs(a.hi[k]  - b.hi[k])  <= lenTol)) add(hn[k]);
    }
    if (a.nF != b.nF) add("nfaces");
    if (a.nE != b.nE) add("nedges");
    if (a.nV != b.nV) add("nverts");
    if (a.nS != b.nS) add("nshells");
    if (a.euler  != b.euler)  add("euler");
    if (a.genus2 != b.genus2) add("genus");
    if (a.valid != b.valid) add("validity");
    return out;
}

bool occtDraft(const TopoDS_Shape& src, const TopTools_ListOfShape& faces,
               const gp_Dir& pull, double ang, const gp_Pln& neutral,
               TopoDS_Shape& out) {
    try {
        BRepOffsetAPI_DraftAngle mk(src);
        for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next()) {
            mk.Add(TopoDS::Face(it.Value()), pull, ang, neutral);
            if (!mk.AddDone()) return false;
        }
        mk.Build();
        if (!mk.IsDone()) return false;
        out = mk.Shape();
    } catch (...) { return false; }
    return !out.IsNull();
}

int selftest() {
    int bad = 0;
    const gp_Dir zUp(0, 0, 1);
    const gp_Pln nz0(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));

    // POSITIVE: a cube's four side walls must draft, and the volume must match
    // the frustum closed form, which neither kernel owns.
    {
        const double L = 10.0, alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, L).Shape();
        TopTools_ListOfShape sides;
        for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) {
            gp_Pln pl;
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            if (planeOf(f, pl) && std::fabs(pl.Axis().Direction().Z()) < 0.1) sides.Append(f);
        }
        const TopoDS_Shape out =
            forge::occtdraftlocal::draftFacesLocal(box, sides, zUp, alpha, nz0);
        const std::string why = forge::occtdraftlocal::draftLocalLastDeferReason();
        const double t = std::tan(alpha);
        const double Vclosed = (L * L * L - std::pow(L - 2.0 * t * L, 3.0)) / (6.0 * t);
        const Obs o = observe(out);
        if (out.IsNull() || !why.empty() ||
            std::fabs(o.vol - Vclosed) > 1.0e-7 * Vclosed) {
            std::printf("  POSITIVE CONTROL FAILED: null=%d why='%s' vol=%.10g want %.10g\n",
                        out.IsNull() ? 1 : 0, why.c_str(), o.vol, Vclosed);
            bad = 1;
        } else {
            const forge::occtdraftlocal::DraftLocalStats& st =
                forge::occtdraftlocal::draftLocalLastStats();
            std::printf("  positive control: cube 4 walls drafted, vol %.10g == closed form; "
                        "solves plane/anchor/quadric = %d/%d/%d\n",
                        o.vol, st.solvedByPlaneMeet, st.solvedByAnchor, st.solvedByQuadric);
        }
    }

    // NEGATIVE: a bore that BREAKS OUT through the drafted wall. The new wall
    // edge would be a conic on the cylinder; it MUST decline, and say so.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 10.0).Shape();
        const TopoDS_Shape cyl =
            BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20.0, 10.0, -1.0), gp_Dir(0, 0, 1)),
                                     4.0, 12.0).Shape();
        TopoDS_Shape part;
        try { part = BRepAlgoAPI_Cut(box, cyl).Shape(); } catch (...) {}
        if (part.IsNull()) { std::printf("  selftest: cut failed\n"); return 1; }
        TopoDS_Face wall; double bestX = -1.0e300;
        for (TopExp_Explorer ex(part, TopAbs_FACE); ex.More(); ex.Next()) {
            gp_Pln pl;
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            if (!planeOf(f, pl)) continue;
            if (pl.Axis().Direction().X() < 0.9) continue;
            if (pl.Location().X() > bestX) { bestX = pl.Location().X(); wall = f; }
        }
        if (wall.IsNull()) { std::printf("  selftest: no +X wall on the cut part\n"); return 1; }
        TopTools_ListOfShape fs; fs.Append(wall);
        const TopoDS_Shape r =
            forge::occtdraftlocal::draftFacesLocal(part, fs, zUp, 5.0 * kPi / 180.0, nz0);
        const std::string why = forge::occtdraftlocal::draftLocalLastDeferReason();
        if (!r.IsNull() || why.find("non-planar") == std::string::npos) {
            std::printf("  NEGATIVE CONTROL FAILED: null=%d why='%s'\n",
                        r.IsNull() ? 1 : 0, why.c_str());
            bad = 1;
        } else {
            std::printf("  negative control: wall meeting a bore declines '%s' ok\n", why.c_str());
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
        std::fprintf(stderr, "usage: draft_local_probe <part.step> [--name=ID]\n"
                             "       draft_local_probe --selftest\n");
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

    // ── the A/B's own sideWall pick, verbatim ───────────────────────────────
    TopoDS_Face sideWall; double sideWallArea = 0.0;
    int nFaces = 0, nPlanar = 0, nMultiWire = 0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    nFaces = fm.Extent();
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        if (wireCount(f) != 1) ++nMultiWire;
        const double a = faceArea(f);
        gp_Pln pl;
        const bool isPlane = planeOf(f, pl);
        if (isPlane) ++nPlanar;
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

    // ── the A/B's own DRAFT arguments, verbatim ─────────────────────────────
    const double ang = 3.0 * kPi / 180.0;
    const gp_Dir pull(0, 0, 1);
    const gp_Pln neutral(gp_Pnt(0, 0, bb[2]), gp_Dir(0, 0, 1));
    TopTools_ListOfShape faces;
    faces.Append(sideWall);

    TopoDS_Shape nat;
    std::string why;
    bool threw = false;
    try {
        nat = forge::occtdraftlocal::draftFacesLocal(shape, faces, pull, ang, neutral);
        why = forge::occtdraftlocal::draftLocalLastDeferReason();
    } catch (const Standard_Failure& e) {
        threw = true; why = e.GetMessageString() ? e.GetMessageString() : "Standard_Failure";
    } catch (const std::exception& e) {
        threw = true; why = e.what();
    } catch (...) { threw = true; why = "unknown throw"; }
    const forge::occtdraftlocal::DraftLocalStats st =
        forge::occtdraftlocal::draftLocalLastStats();

    // THE INPUT'S OWN VALIDITY. A defer on "the rebuilt solid is not
    // BRepCheck-valid" means one of two very different things depending on this
    // number: the engine broke a good solid, or it faithfully carried an input
    // that was already invalid. Both look like a defer from outside.
    bool inValid = false;
    try { inValid = BRepCheck_Analyzer(shape).IsValid() == Standard_True; } catch (...) {}

    TopoDS_Shape occt;
    const bool occtOk = occtDraft(shape, faces, pull, ang, neutral, occt);

    const double scale = std::max(std::max(bb[3] - bb[0], bb[4] - bb[1]), bb[5] - bb[2]);
    const Obs a = observe(nat), b = observe(occt);
    std::string diff;
    if (!nat.IsNull() && occtOk) diff = disagreements(a, b, scale);

    // AGREES is the only thing that counts as coverage. "Built" is not enough:
    // a solid that disagrees with the reference is a wrong answer wearing a
    // right answer's shape.
    const bool agrees = !nat.IsNull() && occtOk && diff.empty();

    std::printf("{\"part\":\"%s\",\"applicable\":true,\"status\":\"%s\",\"reason\":\"%s\","
                "\"occt_ok\":%s,\"agrees\":%s,\"diff\":\"%s\","
                "\"nat_vol\":%.10g,\"occt_vol\":%.10g,\"nat_valid\":%s,\"occt_valid\":%s,"
                "\"in_valid\":%s,"
                "\"nfaces\":%d,\"nplanar\":%d,\"nmultiwire\":%d,\"scale\":%.6g,"
                "\"moved_verts\":%d,\"solve_plane\":%d,\"solve_anchor\":%d,\"solve_quadric\":%d,"
                "\"faces_verbatim\":%d,\"faces_rebuilt\":%d,\"wires_verbatim\":%d,"
                "\"edges_verbatim\":%d,\"edges_retrim\":%d,\"edges_rebuilt\":%d}\n",
                partName.c_str(),
                threw ? "THREW" : (nat.IsNull() ? "DEFER" : "OK"),
                jesc(why.c_str()).c_str(),
                occtOk ? "true" : "false",
                agrees ? "true" : "false",
                jesc(diff.c_str()).c_str(),
                a.vol, b.vol,
                a.valid ? "true" : "false", b.valid ? "true" : "false",
                inValid ? "true" : "false",
                nFaces, nPlanar, nMultiWire, scale,
                st.movedVertices, st.solvedByPlaneMeet, st.solvedByAnchor, st.solvedByQuadric,
                st.facesVerbatim, st.facesRebuilt, st.wiresVerbatim,
                st.edgesVerbatim, st.edgesRetrimmed, st.edgesRebuilt);
    return 0;
}
