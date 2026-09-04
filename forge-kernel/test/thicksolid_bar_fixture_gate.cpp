// thicksolid_bar_fixture_gate.cpp — THE FLIP GATE'S SUCCESS PREDICATE ACCEPTS
// THE FUNCTION'S OWN ARGUMENT. Pinned on six-face fixtures, no corpus.
//
// WHAT THIS GUARDS. Every FORGE_*_DROP_* option in forge-kernel/CMakeLists.txt
// names the same flip condition — "native success rate >= the measured OCCT
// baseline" — and test/corpus_ab_coverage.cpp implements the OCCT side of that
// baseline with the call site's own acceptance test:
//
//     mk.MakeThickSolidByJoin(src, faces, -wall, 1e-3);
//     mk.Build();
//     if (!mk.IsDone()) return TopoDS_Shape();
//     return mk.Shape();                                  // == SUCCESS
//
// reports/corpus_ab/THICKSOLID_HONEST_BAR.md measures what that predicate is
// counting on the 600-part corpus. This gate reproduces the finding on fixtures
// that fit on one screen, so it survives without the corpus and runs in CI:
//
//   A SOLID WHOSE TOP FACE IS SPLIT INTO TWO COPLANAR HALVES, HOLLOWED WITH ONE
//   HALF REMOVED, COMES BACK UNCHANGED — IsDone() true, BRepCheck_Analyzer VALID,
//   shell closed, and every observable equal to the INPUT'S: volume, area, face,
//   edge and vertex counts, and the bounding box. The paired A/B scores that row
//   OCCT_ONLY, i.e. "a capability the drop deletes".
//
// The identity is not a degenerate request, and this gate proves that without an
// offset engine: the ball of radius (20 - t) about (0, 0, H/2) lies inside the
// solid and more than t from every retained boundary face, so the cavity
// { p in int(S) : d(p, dS \ F) > t } contains it and the correct result is at
// most vol(S) - (4/3)pi(20 - t)^3. At the derivation's own wall that bound is
// 54922 against the 87583 OCCT returns.
//
// A GATE THAT ONLY EVER SHOWS OCCT FAILING IS A RIGGED GATE, so the positive
// control comes first: the SAME cylinder with an UNSPLIT top hollows correctly
// at all five walls. The only difference between the two fixtures is whether one
// flat region is carried as one face or as two.
//
// It links NO forge source. The claim is about OCCT's answer and about the
// harness's predicate; a fixture that shared code with the native engine could
// report the engine's own defect as a property of the baseline.
//
// BUILD/RUN: test/run_ab_native_thicksolid_bar_fixture.sh (ratcheted by run_ab_all.sh)
// Prints "N passed, M failed". Exit 0 iff M == 0.

#include <cmath>
#include <cstdio>
#include <string>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;
int gPass = 0, gFail = 0;

void ck(const char* what, bool ok) {
    std::printf("  %-62s %s\n", what, ok ? "ok" : "FAIL");
    if (ok) ++gPass; else ++gFail;
}
void ckNear(const char* what, double got, double want, double tol) {
    const bool ok = std::fabs(got - want) <= tol;
    std::printf("  %-62s %s  (got %.10g want %.10g tol %.3g)\n",
                what, ok ? "ok" : "FAIL", got, want, tol);
    if (ok) ++gPass; else ++gFail;
}

struct Obs {
    bool done = false;
    double vol = 0, area = 0;
    int nface = 0, nedge = 0, nvert = 0, nshell = 0, nsolid = 0;
    int free_edges = 0, nm_edges = 0;
    int valid = -1;
    double bb[6] = {0,0,0,0,0,0};
};

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    o.done = true;
    { GProp_GProps g; BRepGProp::VolumeProperties(s, g); o.vol = g.Mass(); }
    { GProp_GProps g; BRepGProp::SurfaceProperties(s, g); o.area = g.Mass(); }
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE, m);   o.nface = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_EDGE, m);   o.nedge = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_VERTEX, m); o.nvert = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SHELL, m);  o.nshell = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SOLID, m);  o.nsolid = m.Extent();
    TopTools_IndexedDataMapOfShapeListOfShape ef;
    TopExp::MapShapesAndAncestors(s, TopAbs_EDGE, TopAbs_FACE, ef);
    for (int i = 1; i <= ef.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(ef.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;   // a cone apex bounds one face legitimately
        const int n = ef(i).Extent();
        if (n <= 1) ++o.free_edges; else if (n > 2) ++o.nm_edges;
    }
    o.valid = BRepCheck_Analyzer(s).IsValid() ? 1 : 0;
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { o.bb[0]=o.bb[3]=p.X(); o.bb[1]=o.bb[4]=p.Y(); o.bb[2]=o.bb[5]=p.Z(); first=false; }
        else {
            o.bb[0]=std::min(o.bb[0],p.X()); o.bb[3]=std::max(o.bb[3],p.X());
            o.bb[1]=std::min(o.bb[1],p.Y()); o.bb[4]=std::max(o.bb[4],p.Y());
            o.bb[2]=std::min(o.bb[2],p.Z()); o.bb[5]=std::max(o.bb[5],p.Z());
        }
    }
    return o;
}

// The face the corpus A/B's derivation removes: the largest PLANAR face, ties
// broken on the centroid ordered lexicographically. Mirrored from
// test/corpus_ab_coverage.cpp::pickInputs so this fixture exercises the SAME
// input the gate scores.
double faceArea(const TopoDS_Face& f) { GProp_GProps g; BRepGProp::SurfaceProperties(f, g); return g.Mass(); }
gp_Pnt faceCentroid(const TopoDS_Face& f) { GProp_GProps g; BRepGProp::SurfaceProperties(f, g); return g.CentreOfMass(); }

TopoDS_Face largestPlanarFace(const TopoDS_Shape& s, int* nPlanar) {
    TopoDS_Face best; double bestA = 0.0; int np = 0;
    TopTools_IndexedMapOfShape fm; TopExp::MapShapes(s, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        if (Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(f)).IsNull()) continue;
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        ++np;
        bool better;
        if (best.IsNull()) better = true;
        else if (a > bestA * (1.0 + 1e-12)) better = true;
        else if (a < bestA * (1.0 - 1e-12)) better = false;
        else {
            const gp_Pnt p = faceCentroid(f), q = faceCentroid(best);
            better = (p.X() != q.X()) ? (p.X() < q.X())
                   : (p.Y() != q.Y()) ? (p.Y() < q.Y()) : (p.Z() < q.Z());
        }
        if (better) { best = f; bestA = a; }
    }
    if (nPlanar) *nPlanar = np;
    return best;
}

// EXACTLY the call test/corpus_ab_coverage.cpp:1221 makes, including the sign.
Obs occtThickSolid(const TopoDS_Shape& src, const TopoDS_Face& rm, double wall, bool* isDone) {
    TopTools_ListOfShape faces; faces.Append(rm);
    BRepOffsetAPI_MakeThickSolid mk;
    mk.MakeThickSolidByJoin(src, faces, -wall, 1.0e-3);
    mk.Build();
    *isDone = mk.IsDone() != 0;
    if (!*isDone) return Obs();
    const TopoDS_Shape r = mk.Shape();
    if (r.IsNull()) { *isDone = false; return Obs(); }
    return observe(r);
}

// The harness's success predicate, restated here so the gate asserts against the
// predicate rather than against a description of it.
bool harnessCountsAsSuccess(bool isDone, const Obs& o) {
    return isDone && o.done && o.nface > 0;
}

TopoDS_Shape splitTopCylinder(double R, double H) {
    const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(R, H).Shape();
    const TopoDS_Shape hA = BRepPrimAPI_MakeBox(gp_Pnt(-R-1, -R-1, -1), 2*R+2, R+1, H+2).Shape();
    const TopoDS_Shape hB = BRepPrimAPI_MakeBox(gp_Pnt(-R-1,  0.0, -1), 2*R+2, R+1, H+2).Shape();
    return BRepAlgoAPI_Fuse(BRepAlgoAPI_Cut(cyl, hA).Shape(),
                            BRepAlgoAPI_Cut(cyl, hB).Shape()).Shape();
}

TopoDS_Shape boltCircleHub(double R, double H, int n, double bc, double rh) {
    TopoDS_Shape p = BRepPrimAPI_MakeCylinder(R, H).Shape();
    for (int i = 0; i < n; ++i) {
        const double a = 2.0 * kPi * i / n;
        gp_Trsf t; t.SetTranslation(gp_Vec(bc*std::cos(a), bc*std::sin(a), -5.0));
        TopoDS_Shape c = BRepPrimAPI_MakeCylinder(rh, H + 20.0).Shape();
        c = BRepBuilderAPI_Transform(c, t, Standard_True).Shape();
        p = BRepAlgoAPI_Cut(p, c).Shape();
    }
    return p;
}

}  // namespace

int main() {
    const double R = 26.4, H = 40.0;
    // The corpus A/B derives wall = 0.05 * (min bbox extent), and for a body whose
    // circular edges carry a single seam vertex that minimum collapses, so the
    // derivation falls back to 0.05 * (0.05 * diag). For this cylinder that is
    // 0.16560193235587564 — the wall this fixture is scored at.
    const double tDerived = 0.16560193235587564;

    std::printf("thicksolid_bar_fixture_gate — what the flip gate's success predicate counts\n\n");

    // ── 1. POSITIVE CONTROL. The same solid with an UNSPLIT top hollows correctly.
    //       Closed form: the cavity is a cylinder of radius R-t and height H-t,
    //       open at the top, so vol = pi*R^2*H - pi*(R-t)^2*(H-t).
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(R, H).Shape();
        int np = 0;
        const TopoDS_Face rm = largestPlanarFace(cyl, &np);
        ck("(1) plain cylinder has 2 planar faces", np == 2);
        const double srcVol = kPi * R * R * H;
        for (double t : {tDerived, 0.5, 1.0, 2.3808, 5.0}) {
            bool done = false;
            const Obs o = occtThickSolid(cyl, rm, t, &done);
            char lbl[128];
            std::snprintf(lbl, sizeof lbl, "(1) plain cylinder t=%.5g builds a CLOSED VALID hollow", t);
            ck(lbl, done && o.valid == 1 && o.free_edges == 0 && o.nm_edges == 0);
            std::snprintf(lbl, sizeof lbl, "(1) plain cylinder t=%.5g volume is the closed form", t);
            const double want = srcVol - kPi * (R - t) * (R - t) * (H - t);
            ckNear(lbl, o.vol, want, 1e-6 * want);
        }
    }

    // ── 2. THE FINDING. Split that top flat region into two coplanar faces, remove
    //       ONE of them, and the answer is the input — at every wall.
    const TopoDS_Shape split = splitTopCylinder(R, H);
    const Obs src = observe(split);
    {
        int np = 0;
        const TopoDS_Face rm = largestPlanarFace(split, &np);
        ck("(2) split-top solid is valid", src.valid == 1);
        ck("(2) split-top solid has 6 faces (2 top, 2 bottom, 2 lateral)", src.nface == 6);
        ck("(2) split-top solid has 4 planar faces", np == 4);
        ckNear("(2) split-top volume is pi*R^2*H", src.vol, kPi*R*R*H, 1e-6*kPi*R*R*H);

        for (double t : {tDerived, 0.5, 1.0, 2.3808, 5.0}) {
            bool done = false;
            const Obs o = occtThickSolid(split, rm, t, &done);
            char lbl[128];
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: OCCT reports IsDone", t);
            ck(lbl, done);
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: the HARNESS counts it a SUCCESS", t);
            ck(lbl, harnessCountsAsSuccess(done, o));
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: result is BRepCheck VALID", t);
            ck(lbl, o.valid == 1);
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: result is CLOSED (0 free edges)", t);
            ck(lbl, o.free_edges == 0 && o.nm_edges == 0);
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: volume EQUALS the input's", t);
            ckNear(lbl, o.vol, src.vol, 1e-9 * src.vol);
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: area EQUALS the input's", t);
            ckNear(lbl, o.area, src.area, 1e-9 * src.area);
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: topology counts EQUAL the input's", t);
            ck(lbl, o.nface == src.nface && o.nedge == src.nedge && o.nvert == src.nvert &&
                    o.nshell == src.nshell && o.nsolid == src.nsolid);
            std::snprintf(lbl, sizeof lbl, "(2) split-top t=%.5g: bounding box EQUALS the input's", t);
            bool bbSame = true;
            for (int q = 0; q < 6; ++q) bbSame = bbSame && std::fabs(o.bb[q] - src.bb[q]) <= 1e-9 * (R + H);
            ck(lbl, bbSame);
        }
    }

    // ── 3. AND THE IDENTITY IS WRONG, proved without an offset engine.
    //       The point C = (0, 0, H/2) is inside the solid. Its distance to the
    //       lateral surface is R, to the bottom H/2, to either half of the top
    //       H/2 — so every retained boundary face is at least min(R, H/2) = 20
    //       away. The open ball of radius (20 - t) about C therefore lies in
    //       { p in int(S) : d(p, dS \ F) > t }, which is the cavity, so the
    //       correct result CANNOT be the whole solid, and its volume is at most
    //       vol(S) - (4/3)pi(20 - t)^3.
    {
        const double reach = std::min(R, H / 2.0);      // 20
        ckNear("(3) clearance from the body centre to every retained face", reach, 20.0, 1e-12);
        for (double t : {tDerived, 0.5, 1.0, 2.3808, 5.0}) {
            const double rr = reach - t;
            const double cavityAtLeast = (4.0 / 3.0) * kPi * rr * rr * rr;
            const double upper = src.vol - cavityAtLeast;
            char lbl[128];
            std::snprintf(lbl, sizeof lbl,
                          "(3) t=%.5g: correct volume <= %.6g, OCCT returned %.6g", t, upper, src.vol);
            ck(lbl, upper < src.vol * (1.0 - 1e-9) && rr > 0.0);
        }
    }

    // ── 4. THE OVER-THICK BOX. The same identity, reached the obvious way, so (2)
    //       is not a one-off: a wall larger than the half extent leaves no cavity
    //       and MakeThickSolidByJoin hands the source back rather than declining.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 20.0).Shape();
        int np = 0;
        const TopoDS_Face rm = largestPlanarFace(box, &np);
        bool done = false;
        const Obs o = occtThickSolid(box, rm, 30.0, &done);
        ck("(4) over-thick wall on a box: IsDone", done);
        ck("(4) over-thick wall on a box: the HARNESS counts it a SUCCESS", harnessCountsAsSuccess(done, o));
        ck("(4) over-thick wall on a box: BRepCheck VALID", o.valid == 1);
        ckNear("(4) over-thick wall on a box: volume is the input's 8000", o.vol, 8000.0, 1e-9);
        ck("(4) over-thick wall on a box: 6 faces, i.e. the input", o.nface == 6);
    }

    // ── 5. THE CORPUS'S DOMINANT FAILURE MODE, hermetically, and a decline from
    //       the SAME SOLID one face away. Eight holes on a bolt circle whose grown
    //       images cross the grown rim: the cavity's boundary loops MERGE, which is
    //       a topology change. These numbers are ho1041's own (R 26.4, 8 holes
    //       r 2.304 at 23.808, wall 2.3808) — the part
    //       src/native/brep/NativeThickSolid.cpp's circlesNest guard cites, and the
    //       geometry reports/corpus_ab/THICKSOLID_HONEST_BAR.md measures on 133 of
    //       133 corpus answers.
    const TopoDS_Shape hub = boltCircleHub(26.4, 40.0, 8, 23.808, 2.304);
    const Obs hubSrc = observe(hub);
    {
        // (5a) removing the face the corpus derivation itself picks — the largest
        //      planar face, ties broken on the centroid lexicographically, which
        //      here is the z=0 annulus.
        int np = 0;
        const TopoDS_Face rm = largestPlanarFace(hub, &np);
        ck("(5a) the derivation picks the z=0 annulus", std::fabs(faceCentroid(rm).Z()) < 1e-9);
        bool done = false;
        const Obs o = occtThickSolid(hub, rm, 2.3808, &done);
        ck("(5a) merging holes: OCCT reports IsDone", done);
        ck("(5a) merging holes: the HARNESS counts it a SUCCESS", harnessCountsAsSuccess(done, o));
        ck("(5a) merging holes: the result is NOT valid", o.valid == 0);
        ck("(5a) merging holes: the result is an OPEN shell (free edges > 0)", o.free_edges > 0);
        ck("(5a) merging holes: and it is not the identity either",
           o.vol < 0.99 * hubSrc.vol && o.vol > 0.0);
    }
    {
        // (5b) THE SAME SOLID AND THE SAME WALL, removing the MIRROR face at z=H.
        //      OCCT declines. One face apart, the same request is answered two
        //      different ways — so "IsDone is meaningless" is not the claim, and
        //      neither is "this shape class is impossible".
        TopoDS_Face top; double bz = -1e30;
        TopTools_IndexedMapOfShape fm; TopExp::MapShapes(hub, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            if (Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(f)).IsNull()) continue;
            const double z = faceCentroid(f).Z();
            if (z > bz) { bz = z; top = f; }
        }
        ck("(5b) the mirror face is the z=40 annulus", std::fabs(bz - 40.0) < 1e-9);
        bool done = false;
        occtThickSolid(hub, top, 2.3808, &done);
        ck("(5b) same solid, mirror face: OCCT DECLINES (IsDone false)", !done);
    }
    {
        // (5c) POSITIVE CONTROL: pull the holes clear of the rim and the same
        //      engine builds a clean hollow, so (5a) is a property of the merge
        //      and not of the shape class.
        const TopoDS_Shape ok = boltCircleHub(26.4, 40.0, 8, 18.0, 2.304);
        int np = 0;
        const TopoDS_Face rm = largestPlanarFace(ok, &np);
        bool done = false;
        const Obs o = occtThickSolid(ok, rm, 2.3808, &done);
        ck("(5c) holes clear of the rim: OCCT builds a CLOSED VALID hollow",
           done && o.valid == 1 && o.free_edges == 0 && o.nm_edges == 0);
        ck("(5c) and it is NOT the identity", o.vol < 0.99 * (kPi*26.4*26.4*40.0));
    }

    std::printf("\n%d passed, %d failed\n", gPass, gFail);
    return gFail ? 1 : 0;
}
