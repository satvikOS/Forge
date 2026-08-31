// ─────────────────────────────────────────────────────────────────────────────
// pipeshell_defer_census.cpp — WHY does the native pipe-shell decline a part?
//
// THE QUESTION. On the 600-part corpus A/B the native PIPESHELL engine covers
// 309 parts and declines 291, and EVERY ONE of the 291 carries the same single
// FK_DEFER label: `prof_edge_not_line`. A single label over a whole deletion
// bucket is not yet an attribution — "an edge that is not a line" is equally
// consistent with "the corpus profiles are B-spline blobs no bounded engine will
// ever sweep" and with "they are line-and-arc outlines an arc-aware transport
// covers exactly". This census distinguishes the two by naming, per part, the
// EXACT curve types on the profile the harness hands the engine.
//
// THE INPUT IS THE HARNESS'S INPUT, not an approximation of it. The face pick
// (largest planar face, deterministic centroid tie-break), the outer-wire
// extraction and the spine construction are copied from
// test/corpus_ab_coverage.cpp so a row here refers to the same geometry the A/B
// row refers to. Any drift between the two would make this census describe
// parts that were never measured.
//
// ★ THE CENSUS CARRIES A CONTROL. Classifying the input and then reporting the
//   engine's own verdict on it is two readings of one thing only if they can
//   disagree. `--selftest` asserts BOTH directions on synthetic geometry: an
//   all-line square profile classifies LINE_ONLY and the engine returns a solid,
//   and a rounded-rectangle profile (lines + four arcs) classifies LINE_ARC. A
//   run whose self-test does not produce that pair is fatal before any corpus
//   row exists.
//
// COLUMNS (tab separated)
//   part  class  n_edge  n_line  n_circle  n_ellipse  n_bspline  n_bezier
//   n_other  planar_face_ok  engine  reason
// where `class` is one of
//   LINE_ONLY     every edge a line                 (the engine already covers)
//   LINE_ARC      lines and circular arcs only      <- bounded, arc transport
//   ARC_ONLY      circular arcs only
//   HAS_ELLIPSE / HAS_BSPLINE / HAS_BEZIER / HAS_OTHER   a free-form boundary
// and `planar_face_ok` records whether BRepBuilderAPI_MakeFace(wire, planar)
// succeeds — the precondition of ANY face-based transport, measured rather than
// assumed, because a wire that will not close into a planar face cannot be swept
// by a face prism no matter what its edges are.
//
// Driven by test/run_pipeshell_defer_census.sh.
// ─────────────────────────────────────────────────────────────────────────────
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
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <forge/native/brep/NativeLoftPipe.hpp>

namespace {

const double kPi = 3.14159265358979323846;

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

// The A/B's spine: two legs of 0.5*diag, the second turned 30 degrees.
TopoDS_Wire spineFromFace(const gp_Pnt& origin, const gp_Dir& n, double len) {
    gp_Dir perp(1, 0, 0);
    if (std::fabs(n.Dot(gp_Dir(1, 0, 0))) > 0.9) perp = gp_Dir(0, 1, 0);
    const gp_Dir axis = n.Crossed(perp);
    gp_Trsf rot;
    rot.SetRotation(gp_Ax1(origin, axis), 30.0 * kPi / 180.0);
    gp_Dir n2 = n;
    n2.Transform(rot);
    const gp_Pnt p1 = origin.Translated(gp_Vec(n) * len);
    const gp_Pnt p2 = p1.Translated(gp_Vec(n2) * len);
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(origin); mp.Add(p1); mp.Add(p2);
    if (!mp.IsDone()) return TopoDS_Wire();
    return mp.Wire();
}

struct Census {
    int ne = 0, nl = 0, nc = 0, nel = 0, nbs = 0, nbz = 0, no = 0;
    bool planarFaceOk = false;
    const char* cls() const {
        if (no) return "HAS_OTHER";
        if (nbs) return "HAS_BSPLINE";
        if (nbz) return "HAS_BEZIER";
        if (nel) return "HAS_ELLIPSE";
        if (nc && nl) return "LINE_ARC";
        if (nc) return "ARC_ONLY";
        if (nl) return "LINE_ONLY";
        return "EMPTY";
    }
};

Census censusWire(const TopoDS_Wire& w) {
    Census c;
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
        ++c.ne;
        BRepAdaptor_Curve ad;
        try { ad.Initialize(TopoDS::Edge(ex.Current())); } catch (...) { ++c.no; continue; }
        switch (ad.GetType()) {
            case GeomAbs_Line:         ++c.nl;  break;
            case GeomAbs_Circle:       ++c.nc;  break;
            case GeomAbs_Ellipse:      ++c.nel; break;
            case GeomAbs_BSplineCurve: ++c.nbs; break;
            case GeomAbs_BezierCurve:  ++c.nbz; break;
            default:                   ++c.no;  break;
        }
    }
    try {
        BRepBuilderAPI_MakeFace mf(w, Standard_True);
        c.planarFaceOk = mf.IsDone() && !mf.Face().IsNull() && faceArea(mf.Face()) > 0.0;
    } catch (const Standard_Failure&) { c.planarFaceOk = false;
    } catch (...) { c.planarFaceOk = false; }
    return c;
}

// ───────────────────────────────────────────────────────────── the self-test
// Two synthetic profiles on the SAME 2-leg spine, asserting BOTH directions so
// the classifier and the engine cannot be two constants agreeing.
TopoDS_Wire squareWire(double s) {
    BRepBuilderAPI_MakePolygon mp;
    mp.Add(gp_Pnt(-s, -s, 0)); mp.Add(gp_Pnt(s, -s, 0));
    mp.Add(gp_Pnt(s, s, 0));   mp.Add(gp_Pnt(-s, s, 0));
    mp.Close();
    return mp.IsDone() ? mp.Wire() : TopoDS_Wire();
}

// A rounded rectangle: four lines and four quarter-circle corners, closed.
TopoDS_Wire roundedRectWire(double a, double b, double r) {
    BRepBuilderAPI_MakeWire mw;
    const gp_Dir Z(0, 0, 1);
    struct Corner { double cx, cy, start; };
    const Corner cs[4] = {{ a - r,  b - r, 0.0}, {-a + r,  b - r, 0.5 * kPi},
                          {-a + r, -b + r, kPi}, { a - r, -b + r, 1.5 * kPi}};
    gp_Pnt prevEnd(a, b - r, 0);
    for (int i = 0; i < 4; ++i) {
        const Corner& c = cs[i];
        const gp_Circ ci(gp_Ax2(gp_Pnt(c.cx, c.cy, 0), Z), r);
        BRepBuilderAPI_MakeEdge ae(ci, c.start, c.start + 0.5 * kPi);
        if (!ae.IsDone()) return TopoDS_Wire();
        const gp_Pnt as(c.cx + r * std::cos(c.start), c.cy + r * std::sin(c.start), 0);
        if (as.Distance(prevEnd) > 1e-9) {
            BRepBuilderAPI_MakeEdge le(prevEnd, as);
            if (!le.IsDone()) return TopoDS_Wire();
            mw.Add(le.Edge());
        }
        mw.Add(ae.Edge());
        prevEnd = gp_Pnt(c.cx + r * std::cos(c.start + 0.5 * kPi),
                         c.cy + r * std::sin(c.start + 0.5 * kPi), 0);
    }
    BRepBuilderAPI_MakeEdge le(prevEnd, gp_Pnt(a, b - r, 0));
    if (le.IsDone()) mw.Add(le.Edge());
    return mw.IsDone() ? mw.Wire() : TopoDS_Wire();
}

int selftest() {
    const TopoDS_Wire spine = spineFromFace(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), 40.0);
    if (spine.IsNull()) { std::fprintf(stderr, "selftest: spine null\n"); return 1; }
    const std::vector<TopoDS_Wire> noGuides;
    int bad = 0;

    const TopoDS_Wire sq = squareWire(10.0);
    const Census cs = censusWire(sq);
    const TopoDS_Shape rs = forge::occtloft::pipeShell(spine, sq, noGuides, true, 1.0e-6);
    std::printf("  POSITIVE square      class=%-12s engine=%s\n",
                cs.cls(), rs.IsNull() ? "NULL" : "SOLID");
    if (std::strcmp(cs.cls(), "LINE_ONLY") != 0 || rs.IsNull()) {
        std::printf("    EXPECTED LINE_ONLY + SOLID\n"); bad = 1;
    }

    const TopoDS_Wire rr = roundedRectWire(10.0, 6.0, 2.0);
    if (rr.IsNull()) { std::fprintf(stderr, "selftest: rounded rect null\n"); return 1; }
    const Census cr = censusWire(rr);
    const TopoDS_Shape rr2 = forge::occtloft::pipeShell(spine, rr, noGuides, true, 1.0e-6);
    const std::string why = forge::occtloft::lastDeferReason();
    std::printf("  NEGATIVE roundedrect class=%-12s engine=%s reason=%s\n",
                cr.cls(), rr2.IsNull() ? "NULL" : "SOLID", why.c_str());
    if (std::strcmp(cr.cls(), "LINE_ARC") != 0) {
        std::printf("    EXPECTED LINE_ARC\n"); bad = 1;
    }
    // The ENGINE's verdict on the arc profile is what this census exists to
    // explain, and it is asserted as the CURRENT behaviour rather than as a
    // requirement: FORGE_PS_CENSUS_EXPECT_ARC_SOLID=1 flips the expectation for
    // a tree where the arc transport has landed, so the same self-test stays a
    // live control both before and after the fix rather than a line to delete.
    if (std::getenv("FORGE_PS_CENSUS_EXPECT_ARC_SOLID") != nullptr) {
        if (rr2.IsNull()) { std::printf("    EXPECTED a SOLID (arc transport)\n"); bad = 1; }
    } else {
        if (!rr2.IsNull() || why != "prof_edge_not_line") {
            std::printf("    EXPECTED NULL + prof_edge_not_line\n"); bad = 1;
        }
    }
    std::printf(bad ? "SELFTEST FAIL\n" : "SELFTEST PASS\n");
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step> [--name=X]\n", argv[0]); return 2; }
    std::string name = argv[1];
    for (int i = 2; i < argc; ++i) {
        const std::string a = argv[i];
        if (a.rfind("--name=", 0) == 0) name = a.substr(7);
    }

    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(argv[1]); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) { std::printf("%s\tSTEP_READ_FAIL\n", name.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) { std::printf("%s\tSTEP_EMPTY\n", name.c_str()); return 1; }

    double bb[6] = {0, 0, 0, 0, 0, 0};
    bool first = true;
    for (TopExp_Explorer ex(shape, TopAbs_VERTEX); ex.More(); ex.Next()) {
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
    const double diag = std::sqrt((bb[3] - bb[0]) * (bb[3] - bb[0]) +
                                  (bb[4] - bb[1]) * (bb[4] - bb[1]) +
                                  (bb[5] - bb[2]) * (bb[5] - bb[2]));

    TopoDS_Face big; double bigA = 0.0; gp_Pln bigPln;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        gp_Pln pl;
        if (!planeOf(f, pl)) continue;
        if (betterFace(f, a, big, bigA)) { big = f; bigA = a; bigPln = pl; }
    }
    if (big.IsNull()) { std::printf("%s\tNO_PLANAR_FACE\n", name.c_str()); return 0; }

    const TopoDS_Wire ow = BRepTools::OuterWire(big);
    if (ow.IsNull()) { std::printf("%s\tNO_OUTER_WIRE\n", name.c_str()); return 0; }

    const Census c = censusWire(ow);
    const TopoDS_Wire spine =
        spineFromFace(faceCentroid(big), bigPln.Axis().Direction(), 0.5 * diag);
    const char* eng = "NO_SPINE";
    std::string why;
    if (!spine.IsNull()) {
        TopoDS_Shape r;
        bool threw = false;
        try {
            const std::vector<TopoDS_Wire> noGuides;
            r = forge::occtloft::pipeShell(spine, ow, noGuides, true, 1.0e-6);
            why = forge::occtloft::lastDeferReason();
        } catch (const Standard_Failure& e) {
            why = e.GetMessageString() ? e.GetMessageString() : "Standard_Failure";
            threw = true;
        } catch (...) { why = "unknown throw"; threw = true; }
        eng = threw ? "THREW" : (r.IsNull() ? "NULL" : "SOLID");
    }
    std::printf("%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%s\n",
                name.c_str(), c.cls(), c.ne, c.nl, c.nc, c.nel, c.nbs, c.nbz, c.no,
                c.planarFaceOk ? 1 : 0, eng, why.c_str());
    return 0;
}
