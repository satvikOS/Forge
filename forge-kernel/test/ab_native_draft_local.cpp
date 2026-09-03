// ab_native_draft_local.cpp — LIVE-OCCT A/B for the GENERAL native draft.
//
// Drives forge::occtdraftlocal::draftFacesLocal (src/native/brep/
// NativeDraftLocal.cpp) and OCCT's BRepOffsetAPI_DraftAngle over the SAME shapes
// with the SAME arguments and compares the resulting SOLIDS on a VECTOR of
// observables, because VOLUME ALONE CANNOT VALIDATE GEOMETRY:
//
//     volume, surface AREA, centre of mass (3), bounding box (6 bounds),
//     face / edge / vertex / shell counts (4), the Euler-Poincare
//     characteristic V - E + F, the GENUS derived from it,
//     BRepCheck_Analyzer validity, and — where a closed form exists — the
//     drafted volume derived from first principles rather than borrowed from
//     either kernel.
//
// A NEGATIVE CONTROL feeds the comparator two shapes of EQUAL VOLUME and
// requires it to REJECT them, so the vector is proved to be doing work.
//
// WHAT THIS FILE EXISTS TO PROVE, beyond agreement: the cases here are the ones
// NativeDraft.cpp DECLINES. Every one of them carries a face that is not a
// plane, or a face with more than one wire, or both — the two whole-shape
// preconditions that the corpus measured as violated by 565 of 565 applicable
// parts. Case 2 in particular is a box with a THROUGH-HOLE: two multi-wire
// planar faces and a cylindrical face, drafted on all four walls. That is the
// shape of the corpus, and it is the shape the prior engine could not touch.
//
// The bounding box is computed from the solids' VERTICES, not from Bnd_Box:
// BRepBndLib inflates by the shape's tolerance, which would blur exactly the
// sub-micron disagreement this harness exists to catch. Where a case carries a
// curved face the vertex hull is not the true bound — but it is the SAME
// quantity on both sides, which is what a comparison needs.
//
// exit 0 iff every assertion holds; exit 1 on the first failure summary.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>   // setenv/unsetenv, for the anchor-solve equivalence case
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

#include "forge/native/brep/NativeDraftLocal.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

// BRepOffsetAPI_DraftAngle is the REFERENCE half of the A/B and is linked HERE
// and only here. The engine's own object file is checked for zero TKOffset
// imports separately, by run_ab_native_draft_local.sh.
#include <BRepOffsetAPI_DraftAngle.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_pass = 0;
int g_fail = 0;
bool g_quiet = false;   // the negative control's reds are its proof, not a failure

void ok(bool cond, const std::string& what) {
    if (cond) { ++g_pass; }
    else { ++g_fail; if (!g_quiet) std::printf("  FAIL  %s\n", what.c_str()); }
}

void okNear(double got, double want, double tol, const std::string& what) {
    const bool c = std::fabs(got - want) <= tol;
    if (c) { ++g_pass; }
    else {
        ++g_fail;
        if (!g_quiet)
            std::printf("  FAIL  %s : got %.12g want %.12g (|d| %.3g > tol %.3g)\n",
                        what.c_str(), got, want, std::fabs(got - want), tol);
    }
}

// ---------------------------------------------------------------- observables
struct Obs {
    double vol = 0.0;
    double area = 0.0;
    double cx = 0.0, cy = 0.0, cz = 0.0;
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    int nF = 0, nE = 0, nV = 0, nS = 0;
    int euler = 0;
    int genus2 = 0;        // 2*genus = 2*nShells - euler, kept doubled so it is an int
    bool valid = false;
    bool have = false;
};

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    GProp_GProps p;
    BRepGProp::VolumeProperties(s, p);
    o.vol = std::fabs(p.Mass());
    const gp_Pnt c = p.CentreOfMass();
    o.cx = c.X(); o.cy = c.Y(); o.cz = c.Z();
    GProp_GProps sp;
    BRepGProp::SurfaceProperties(s, sp);
    o.area = sp.Mass();

    TopTools_IndexedMapOfShape mf, me, mv, ms;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    TopExp::MapShapes(s, TopAbs_SHELL, ms);
    o.nF = mf.Extent(); o.nE = me.Extent(); o.nV = mv.Extent(); o.nS = ms.Extent();
    o.euler = o.nV - o.nE + o.nF;
    // For a closed orientable surface chi = 2 - 2g per shell, so summed over
    // nS shells 2g_total = 2*nS - chi. Kept as 2g to stay exact in integers.
    o.genus2 = 2 * o.nS - o.euler;

    for (int i = 1; i <= mv.Extent(); ++i) {
        const gp_Pnt q = BRep_Tool::Pnt(TopoDS::Vertex(mv.FindKey(i)));
        const double v[3] = {q.X(), q.Y(), q.Z()};
        for (int k = 0; k < 3; ++k) {
            if (i == 1) { o.lo[k] = o.hi[k] = v[k]; }
            else { o.lo[k] = std::min(o.lo[k], v[k]); o.hi[k] = std::max(o.hi[k], v[k]); }
        }
    }
    BRepCheck_Analyzer an(s);
    o.valid = an.IsValid() == Standard_True;
    o.have = true;
    return o;
}

// The comparator the whole harness rests on. Returns the number of assertions
// that FAILED so the negative control can require > 0.
int compareSolids(const Obs& a, const Obs& b, const std::string& label,
                  double tol, bool report) {
    const int failBefore = g_fail;
    const int passBefore = g_pass;
    const bool quietWas = g_quiet;
    if (!report) g_quiet = true;
    okNear(a.vol,  b.vol,  tol * std::max(1.0, b.vol),  label + " volume");
    okNear(a.area, b.area, tol * std::max(1.0, b.area), label + " surface area");
    okNear(a.cx, b.cx, tol * 10.0, label + " com.x");
    okNear(a.cy, b.cy, tol * 10.0, label + " com.y");
    okNear(a.cz, b.cz, tol * 10.0, label + " com.z");
    static const char* ax[3] = {"x", "y", "z"};
    for (int k = 0; k < 3; ++k) {
        okNear(a.lo[k], b.lo[k], tol * 10.0, label + " bbox.lo." + ax[k]);
        okNear(a.hi[k], b.hi[k], tol * 10.0, label + " bbox.hi." + ax[k]);
    }
    ok(a.nF == b.nF, label + " face count");
    ok(a.nE == b.nE, label + " edge count");
    ok(a.nV == b.nV, label + " vertex count");
    ok(a.nS == b.nS, label + " shell count");
    ok(a.euler == b.euler, label + " Euler characteristic");
    ok(a.genus2 == b.genus2, label + " genus");
    const int failed = g_fail - failBefore;
    g_quiet = quietWas;
    if (!report) { g_fail = failBefore; g_pass = passBefore; }
    return failed;
}

// ------------------------------------------------------------------- fixtures
TopTools_ListOfShape sideFaces(const TopoDS_Shape& s) {
    TopTools_ListOfShape out;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface as(f);
        if (as.GetType() != GeomAbs_Plane) continue;
        if (std::fabs(as.Plane().Axis().Direction().Z()) < 1e-9) out.Append(f);
    }
    return out;
}

TopoDS_Face faceTowards(const TopoDS_Shape& s, const gp_Dir& d) {
    TopoDS_Face best;
    double bestDot = -2.0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface as(f);
        if (as.GetType() != GeomAbs_Plane) continue;
        gp_Dir n = as.Plane().Axis().Direction();
        if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
        const double dot = n.Dot(d);
        if (dot > bestDot) { bestDot = dot; best = f; }
    }
    return best;
}

int countNonPlanarFaces(const TopoDS_Shape& s) {
    int n = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        BRepAdaptor_Surface as(TopoDS::Face(ex.Current()));
        if (as.GetType() != GeomAbs_Plane) ++n;
    }
    return n;
}

int countMultiWireFaces(const TopoDS_Shape& s) {
    int n = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        int w = 0;
        for (TopoDS_Iterator it(ex.Current()); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++w;
        if (w != 1) ++n;
    }
    return n;
}

bool occtDraft(const TopoDS_Shape& src, const TopTools_ListOfShape& faces,
               const gp_Dir& pull, double angleRad, const gp_Pln& neutral,
               TopoDS_Shape& out) {
    try {
        BRepOffsetAPI_DraftAngle mk(src);
        for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next()) {
            mk.Add(TopoDS::Face(it.Value()), pull, angleRad, neutral);
            if (!mk.AddDone()) return false;
        }
        mk.Build();
        if (!mk.IsDone()) return false;
        out = mk.Shape();
    } catch (...) { return false; }
    return !out.IsNull();
}

// A box with a vertical THROUGH-HOLE: two multi-wire planar caps and one
// cylindrical face. Both whole-shape preconditions of NativeDraft.cpp violated.
TopoDS_Shape boxWithThroughHole(double lx, double ly, double lz,
                                double cx, double cy, double r) {
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(lx, ly, lz).Shape();
    const TopoDS_Shape cyl =
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(cx, cy, -1.0), gp_Dir(0, 0, 1)),
                                 r, lz + 2.0).Shape();
    return BRepAlgoAPI_Cut(box, cyl).Shape();
}

// ------------------------------------------------------------------ the cases
void abCase(const std::string& label, const TopoDS_Shape& src,
            const TopTools_ListOfShape& faces, const gp_Dir& pull,
            double ang, const gp_Pln& neutral, double tol = 1.0e-7) {
    TopoDS_Shape occt;
    const bool occtOk = occtDraft(src, faces, pull, ang, neutral, occt);
    ok(occtOk, label + " : OCCT built the reference");
    if (!occtOk) return;

    const TopoDS_Shape nat =
        forge::occtdraftlocal::draftFacesLocal(src, faces, pull, ang, neutral);
    if (nat.IsNull())
        std::printf("  [defer] %s : %s\n", label.c_str(),
                    forge::occtdraftlocal::draftLocalLastDeferReason());
    ok(!nat.IsNull(), label + " : native produced a solid (no defer)");
    if (nat.IsNull()) return;

    const Obs a = observe(nat), b = observe(occt);
    ok(a.valid, label + " : native solid is BRepCheck-VALID");
    ok(b.valid, label + " : OCCT solid is BRepCheck-VALID");
    compareSolids(a, b, label, tol, /*report*/ true);
}

void runAll() {
    std::printf("[ab-draft-local] TKOffset family J — the GENERAL native draft vs live OCCT\n");

    const gp_Dir zUp(0, 0, 1);
    const gp_Pln nz0(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));

    // ================================================================= case 1
    // The canonical cube. The general engine must reproduce the exact
    // plane-arrangement engine's answer AND a closed form neither kernel owns:
    // for base L, height H and taper t = tan(alpha) the section at height z is
    // (L - 2 t z)^2, so V = INT_0^H (L - 2 t z)^2 dz = (L^3 - (L-2tH)^3)/(6t).
    {
        const double L = 10.0, alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, L).Shape();
        const TopTools_ListOfShape sides = sideFaces(box);
        ok(sides.Extent() == 4, "case1 : four side faces found");
        abCase("case1 cube L=10 all-4-sides 5deg", box, sides, zUp, alpha, nz0);

        const TopoDS_Shape nat =
            forge::occtdraftlocal::draftFacesLocal(box, sides, zUp, alpha, nz0);
        if (!nat.IsNull()) {
            const double t = std::tan(alpha);
            const double Vclosed = (L * L * L - std::pow(L - 2.0 * t * L, 3.0)) / (6.0 * t);
            const Obs a = observe(nat);
            okNear(a.vol, Vclosed, 1.0e-7 * Vclosed,
                   "case1 : native volume == frustum CLOSED FORM (not borrowed)");
            okNear(a.lo[0], 0.0, 1.0e-9, "case1 : base x-min pinned at 0");
            okNear(a.lo[1], 0.0, 1.0e-9, "case1 : base y-min pinned at 0");
            okNear(a.hi[2], L,   1.0e-9, "case1 : height unchanged");
        }
    }

    // ================================================================= case 2
    // ★ THE CASE THE PRIOR ENGINE CANNOT TOUCH. A box with a vertical
    // through-hole: TWO multi-wire planar caps and ONE cylindrical face, so both
    // whole-shape preconditions of NativeDraft.cpp are violated — which is the
    // shape of the entire 565-part corpus. All four walls drafted 5 degrees.
    //
    // The hole is untouched by the draft, so the volume has a CLOSED FORM again:
    // the frustum minus a cylinder of height L, since the bore is nowhere near
    // the walls.
    {
        const double L = 40.0, H = 20.0, r = 6.0, alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape part = boxWithThroughHole(L, L, H, 20.0, 20.0, r);
        ok(countNonPlanarFaces(part) == 1, "case2 : the part HAS a non-planar face");
        ok(countMultiWireFaces(part) == 2, "case2 : the part HAS multi-wire faces");

        const TopTools_ListOfShape sides = sideFaces(part);
        ok(sides.Extent() == 4, "case2 : four side walls found");
        abCase("case2 40x40x20 plate, 6mm through-bore, all-4-walls 5deg",
               part, sides, zUp, alpha, nz0);

        const TopoDS_Shape nat =
            forge::occtdraftlocal::draftFacesLocal(part, sides, zUp, alpha, nz0);
        if (!nat.IsNull()) {
            const double t = std::tan(alpha);
            // V = INT_0^H (L - 2 t z)^2 dz  -  pi r^2 H
            const double Vtaper = (std::pow(L, 3.0) - std::pow(L - 2.0 * t * H, 3.0)) / (6.0 * t);
            const double Vclosed = Vtaper - kPi * r * r * H;
            const Obs a = observe(nat);
            okNear(a.vol, Vclosed, 1.0e-7 * Vclosed,
                   "case2 : native volume == (tapered prism - bore) CLOSED FORM");
            ok(countNonPlanarFaces(nat) == 1,
               "case2 : the bore SURVIVED as a cylinder (not chorded)");
            ok(countMultiWireFaces(nat) == 2,
               "case2 : both caps still carry their inner wire");
        }
    }

    // ================================================================= case 3
    // ONE wall only, on the SAME holed plate — an asymmetric draft. Catches a
    // sign or axis error that the symmetric four-wall case cancels out, on a
    // shape the prior engine declines.
    {
        const double alpha = 7.0 * kPi / 180.0;
        const TopoDS_Shape part = boxWithThroughHole(40.0, 25.0, 12.0, 20.0, 12.5, 5.0);
        TopTools_ListOfShape one;
        one.Append(faceTowards(part, gp_Dir(1, 0, 0)));
        abCase("case3 holed plate, one +X wall 7deg", part, one, zUp, alpha, nz0);
    }

    // ================================================================= case 4
    // Neutral plane at MID-HEIGHT on the holed plate. Below it the walls lean
    // OUT, above they lean IN, so the volume is preserved to first order and a
    // harness watching only volume would be blind. The bbox and the COM catch it.
    {
        const double alpha = 8.0 * kPi / 180.0;
        const TopoDS_Shape part = boxWithThroughHole(30.0, 30.0, 10.0, 15.0, 15.0, 4.0);
        const gp_Pln nz5(gp_Pnt(0, 0, 5), gp_Dir(0, 0, 1));
        TopTools_ListOfShape two;
        two.Append(faceTowards(part, gp_Dir(1, 0, 0)));
        two.Append(faceTowards(part, gp_Dir(-1, 0, 0)));
        abCase("case4 holed plate two +-X walls 8deg neutral z=5", part, two, zUp, alpha, nz5);

        const TopoDS_Shape nat =
            forge::occtdraftlocal::draftFacesLocal(part, two, zUp, alpha, nz5);
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            const double t = std::tan(alpha);
            okNear(a.lo[0], -5.0 * t, 1.0e-9, "case4 : -X wall leans OUT below neutral");
            okNear(a.hi[0], 30.0 + 5.0 * t, 1.0e-9, "case4 : +X wall leans OUT below neutral");
        }
    }

    // ================================================================= case 5
    // NEGATIVE ANGLE on the holed plate — the walls lean OUT. Proves the sign is
    // carried and not absolute-valued somewhere in the chain.
    {
        const double alpha = -6.0 * kPi / 180.0;
        const TopoDS_Shape part = boxWithThroughHole(20.0, 20.0, 10.0, 10.0, 10.0, 3.0);
        const TopTools_ListOfShape sides = sideFaces(part);
        abCase("case5 holed plate all-4-walls -6deg (leans OUT)", part, sides, zUp, alpha, nz0);
        const TopoDS_Shape nat =
            forge::occtdraftlocal::draftFacesLocal(part, sides, zUp, alpha, nz0);
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            const Obs b = observe(part);
            ok(a.vol > b.vol, "case5 : a negative angle GROWS the part");
        }
    }

    // ================================================================= case 6
    // A NON-AXIS-ALIGNED pull and neutral plane, on a TWO-hole plate. The
    // formulation is frame-free; this is what proves it, and two bores prove the
    // verbatim carry is not a one-hole special case.
    {
        const double alpha = 4.0 * kPi / 180.0;
        TopoDS_Shape part = boxWithThroughHole(40.0, 20.0, 10.0, 12.0, 10.0, 3.0);
        {
            const TopoDS_Shape cyl2 =
                BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(28.0, 10.0, -1.0), gp_Dir(0, 0, 1)),
                                         3.0, 12.0).Shape();
            part = BRepAlgoAPI_Cut(part, cyl2).Shape();
        }
        ok(countNonPlanarFaces(part) == 2, "case6 : the part has TWO bores");
        // pull +Y, so the +-Y faces are PARALLEL to the neutral plane and cannot
        // be drafted, and the +-Z caps MEET both bores (a drafted plane against a
        // cylinder is the named capability gap, defer control (e)). The two walls
        // that are both draftable and bore-free are +-X, and they are the ones
        // that make the caps rebuild while carrying TWO inner wires verbatim.
        const gp_Dir pull(0, 1, 0);
        const gp_Pln ny0(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0));
        TopTools_ListOfShape f;
        f.Append(faceTowards(part, gp_Dir(1, 0, 0)));
        f.Append(faceTowards(part, gp_Dir(-1, 0, 0)));
        abCase("case6 two-bore plate, pull +Y, two walls, 4deg", part, f, pull, alpha, ny0);

        const TopoDS_Shape nat =
            forge::occtdraftlocal::draftFacesLocal(part, f, pull, alpha, ny0);
        if (!nat.IsNull()) {
            ok(countNonPlanarFaces(nat) == 2, "case6 : BOTH bores survived as cylinders");
            ok(countMultiWireFaces(nat) == 2,
               "case6 : both caps still carry their TWO inner wires");
        }
    }

    // ================================================================= case 7
    // A ROTATED frame. The same holed plate, rigidly transformed, drafted about
    // the transformed neutral plane. Every number must transform with it; a
    // formulation that secretly assumed a world axis fails here and nowhere else.
    {
        const double alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape flat = boxWithThroughHole(30.0, 30.0, 12.0, 15.0, 15.0, 5.0);
        gp_Trsf tr;
        tr.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 2, 3)), 0.7);
        const TopoDS_Shape part = BRepBuilderAPI_Transform(flat, tr, Standard_True).Shape();
        const gp_Dir pull = gp_Dir(0, 0, 1).Transformed(tr);
        const gp_Pln neutral = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)).Transformed(tr);
        TopTools_ListOfShape walls;
        for (TopExp_Explorer ex(part, TopAbs_FACE); ex.More(); ex.Next()) {
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            BRepAdaptor_Surface as(f);
            if (as.GetType() != GeomAbs_Plane) continue;
            gp_Dir n = as.Plane().Axis().Direction();
            if (std::fabs(n.Dot(pull)) < 1.0e-6) walls.Append(f);
        }
        ok(walls.Extent() == 4, "case7 : four walls found in the rotated frame");
        abCase("case7 rotated frame, holed plate, all-4-walls 5deg",
               part, walls, pull, alpha, neutral, 1.0e-6);
    }

    // ================================================== ANCHOR-SOLVE EQUIVALENCE
    // ★ THE CORPUS SAYS SOLVE 2 NEVER FIRES. Over all 565 applicable parts the
    // rank-3 linear meet carries EVERY moved vertex, so the anchor solve and the
    // line-vs-quadric solve execute zero times and would otherwise be code
    // claiming to be capability. FORGE_DRAFT_LOCAL_NO_PLANE_MEET turns solve 1
    // off, which drives the SAME fixtures down solve 2 — and the two must agree
    // on every observable, because they are two derivations of the same corner:
    // solve 1 meets the incident planes, solve 2 slides along an untouched
    // incident CURVE until it reaches the rotated plane. Agreement here is what
    // makes solve 2 proved rather than asserted, and the assertion that it
    // ACTUALLY FIRED is what stops this being a comparison of solve 1 to itself.
    {
        const double alpha = 7.0 * kPi / 180.0;
        const TopoDS_Shape part = boxWithThroughHole(40.0, 25.0, 12.0, 20.0, 12.5, 5.0);
        TopTools_ListOfShape one;
        one.Append(faceTowards(part, gp_Dir(1, 0, 0)));

        const TopoDS_Shape byPlaneMeet =
            forge::occtdraftlocal::draftFacesLocal(part, one, zUp, alpha, nz0);
        const forge::occtdraftlocal::DraftLocalStats s1 =
            forge::occtdraftlocal::draftLocalLastStats();

        setenv("FORGE_DRAFT_LOCAL_NO_PLANE_MEET", "1", 1);
        const TopoDS_Shape byAnchor =
            forge::occtdraftlocal::draftFacesLocal(part, one, zUp, alpha, nz0);
        const forge::occtdraftlocal::DraftLocalStats s2 =
            forge::occtdraftlocal::draftLocalLastStats();
        unsetenv("FORGE_DRAFT_LOCAL_NO_PLANE_MEET");

        ok(!byPlaneMeet.IsNull(), "anchor : the plane-meet solve produced a solid");
        if (byAnchor.IsNull())
            std::printf("  [defer] anchor-forced : %s\n",
                        forge::occtdraftlocal::draftLocalLastDeferReason());
        ok(!byAnchor.IsNull(), "anchor : the anchor solve produced a solid");
        ok(s1.solvedByPlaneMeet > 0 && s1.solvedByAnchor == 0,
           "anchor : the unforced run used the PLANE MEET");
        ok(s2.solvedByAnchor > 0 && s2.solvedByPlaneMeet == 0,
           "anchor : the forced run ACTUALLY used the anchor curve "
           "(otherwise this compares solve 1 to itself)");
        std::printf("  [anchor] plane-meet solves %d / anchor solves %d\n",
                    s1.solvedByPlaneMeet, s2.solvedByAnchor);
        if (!byPlaneMeet.IsNull() && !byAnchor.IsNull()) {
            const Obs a = observe(byPlaneMeet), b = observe(byAnchor);
            compareSolids(a, b, "anchor equivalence", 1.0e-9, /*report*/ true);
        }
    }

    // ========================================================= NEGATIVE CONTROL
    // Two shapes of EQUAL VOLUME that the comparator MUST reject. If it does not,
    // every "agrees with OCCT" line above is worthless.
    {
        const double L = 10.0, alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, L).Shape();
        const TopTools_ListOfShape sides = sideFaces(box);
        const TopoDS_Shape nat =
            forge::occtdraftlocal::draftFacesLocal(box, sides, zUp, alpha, nz0);
        ok(!nat.IsNull(), "negctl : the drafted solid exists");
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            const double s = std::cbrt(a.vol);
            const TopoDS_Shape equalVolBox = BRepPrimAPI_MakeBox(s, s, s).Shape();
            const Obs b = observe(equalVolBox);
            okNear(a.vol, b.vol, 1.0e-9 * a.vol,
                   "negctl : the impostor's volume MATCHES to 1e-9 relative");
            const int rejected = compareSolids(a, b, "negctl", 1.0e-7, /*report*/ false);
            ok(rejected > 0, "negctl : the comparator REJECTS an equal-volume impostor");
            std::printf("  [negctl] equal-volume impostor rejected on %d observable(s)\n",
                        rejected);
        }
    }

    // ====================================================== NEGATIVE CONTROL 2
    // An EQUAL-TOPOLOGY impostor: the same holed plate drafted at a DIFFERENT
    // angle. Face, edge, vertex, shell counts, Euler and genus are all identical,
    // so only the metric half of the vector can catch it. This is the control for
    // the half of the vector the first negative control does not exercise.
    {
        const TopoDS_Shape part = boxWithThroughHole(30.0, 30.0, 12.0, 15.0, 15.0, 5.0);
        const TopTools_ListOfShape sides = sideFaces(part);
        const TopoDS_Shape a5 = forge::occtdraftlocal::draftFacesLocal(
            part, sides, zUp, 5.0 * kPi / 180.0, nz0);
        const TopoDS_Shape a6 = forge::occtdraftlocal::draftFacesLocal(
            part, sides, zUp, 6.0 * kPi / 180.0, nz0);
        ok(!a5.IsNull() && !a6.IsNull(), "negctl2 : both drafts exist");
        if (!a5.IsNull() && !a6.IsNull()) {
            const Obs x = observe(a5), y = observe(a6);
            ok(x.nF == y.nF && x.nE == y.nE && x.nV == y.nV && x.euler == y.euler &&
               x.genus2 == y.genus2,
               "negctl2 : the impostor's TOPOLOGY is identical");
            const int rejected = compareSolids(x, y, "negctl2", 1.0e-7, /*report*/ false);
            ok(rejected > 0, "negctl2 : the comparator REJECTS a 1-degree-off draft");
            std::printf("  [negctl2] 1-degree-off impostor rejected on %d observable(s)\n",
                        rejected);
        }
    }

    // ============================================================ DEFER CONTROLS
    // Each must return a NULL shape with a NAMED reason — an honest defer, never
    // a plausible wrong solid. A defer that cannot say why is what made family
    // J's 0/565 unreadable for a month.
    auto deferCtl = [&](const std::string& label, const TopoDS_Shape& s,
                        const TopTools_ListOfShape& f, const gp_Dir& pull,
                        double ang, const gp_Pln& n, const char* wantSubstr) {
        const TopoDS_Shape r = forge::occtdraftlocal::draftFacesLocal(s, f, pull, ang, n);
        const std::string why = forge::occtdraftlocal::draftLocalLastDeferReason();
        ok(r.IsNull(), label + " : DECLINED");
        ok(!why.empty(), label + " : the defer is NAMED");
        ok(why.find(wantSubstr) != std::string::npos,
           label + " : named '" + wantSubstr + "' (got '" + why + "')");
    };

    {
        // (a) a SELECTED face that is not a plane.
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        TopTools_ListOfShape f;
        for (TopExp_Explorer ex(cyl, TopAbs_FACE); ex.More(); ex.Next()) {
            BRepAdaptor_Surface as(TopoDS::Face(ex.Current()));
            if (as.GetType() == GeomAbs_Cylinder) { f.Append(ex.Current()); break; }
        }
        deferCtl("defer(a) selected face is a cylinder", cyl, f, gp_Dir(1, 0, 0),
                 5.0 * kPi / 180.0, gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)),
                 "not a plane");
    }
    {
        // (b) a selected face PARALLEL to the neutral plane — no rotation axis.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(box, gp_Dir(0, 0, 1)));
        deferCtl("defer(b) face parallel to the neutral plane", box, f, zUp,
                 5.0 * kPi / 180.0, nz0, "parallel");
    }
    {
        // (c) empty list, zero angle, 90 degrees.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        const TopTools_ListOfShape none;
        deferCtl("defer(c1) empty face list", box, none, zUp, 0.1, nz0, "no faces selected");
        const TopTools_ListOfShape sides = sideFaces(box);
        deferCtl("defer(c2) zero angle", box, sides, zUp, 0.0, nz0, "angle is zero");
        deferCtl("defer(c3) 90 degrees", box, sides, zUp, 0.5 * kPi, nz0, "90 degrees");
    }
    {
        // (d) a face that belongs to ANOTHER shape must not be silently ignored.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        const TopoDS_Shape other = BRepPrimAPI_MakeBox(3.0, 3.0, 3.0).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(other, gp_Dir(1, 0, 0)));
        deferCtl("defer(d) face from another shape", box, f, zUp, 5.0 * kPi / 180.0, nz0,
                 "not present on the shape");
    }
    {
        // (e) ★ WAS THE NAMED CAPABILITY GAP; IT IS NOW A CAPABILITY. A wall that
        // MEETS a cylinder: the new edge is the exact plane/cylinder ELLIPSE, and
        // only its PCURVE on the cylinder is approximated, under the deviation
        // bound the engine asserts per edge. So this fixture is no longer a
        // defer control -- it is held to the FULL observable vector against live
        // OCCT, which is strictly more than the old control demanded. The bore
        // here breaks out through the +X wall.
        //
        // A DEFER CONTROL THAT BECAME REACHABLE MUST BE PROMOTED, NOT DELETED.
        // Turning "it must decline" into "it must decline for some other reason"
        // would have kept the suite green while testing nothing; the case is
        // instead re-pointed at the harder assertion, and the defer PATH it used
        // to cover is kept alive by (e2) below on a neighbour that really is
        // still out of scope.
        const TopoDS_Shape part = boxWithThroughHole(20.0, 20.0, 10.0, 20.0, 10.0, 4.0);
        TopTools_ListOfShape f;
        f.Append(faceTowards(part, gp_Dir(1, 0, 0)));
        abCase("case(e) drafted wall meets a cylinder", part, f, zUp,
               5.0 * kPi / 180.0, nz0);
    }
    {
        // (e2) THE DEFER PATH (e) USED TO COVER. A SPHERE is not a cylinder, so
        // the section is not an ellipse this engine can write in closed form and
        // the "non-planar" decline must still fire, and still be NAMED.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 20.0, 10.0).Shape();
        const TopoDS_Shape sph =
            BRepPrimAPI_MakeSphere(gp_Pnt(20.0, 10.0, 5.0), 4.0).Shape();
        const TopoDS_Shape part = BRepAlgoAPI_Cut(box, sph).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(part, gp_Dir(1, 0, 0)));
        deferCtl("defer(e2) drafted wall meets a sphere", part, f, zUp,
                 5.0 * kPi / 180.0, nz0, "non-planar");
    }
    {
        // (f) ★ THE CLOSED RIM. Case (e)'s bore breaks OUT through the wall's
        // boundary, so its edge on the cylinder is an ARC with two distinct
        // vertices. A bore that lies WHOLLY INSIDE the drafted wall gives the
        // other case: ONE closed edge, one vertex used twice, and both endpoints
        // therefore project to the SAME parameter. The engine used to read that
        // as a degenerate range and decline; it is a FULL PERIOD.
        //
        // This case exists because the corpus said so: 73 of the 565 parts
        // declined with exactly t0 = t1 = 0 and BOTH residuals 0, which is the
        // signature of one point rather than of a failed projection. A fix
        // derived from a corpus histogram is still a guess until a fixture holds
        // it to OCCT, which is what this is.
        const double L = 20.0, H = 10.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, H).Shape();
        // axis along +X, through the +X wall, well clear of every wall boundary
        const TopoDS_Shape bore =
            BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1.0, 10.0, 5.0), gp_Dir(1, 0, 0)),
                                     3.0, L + 2.0).Shape();
        const TopoDS_Shape part = BRepAlgoAPI_Cut(box, bore).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(part, gp_Dir(1, 0, 0)));
        ok(!f.First().IsNull(), "case(f) : the +X wall was found");
        abCase("case(f) drafted wall with a bore wholly inside it", part, f, zUp,
               5.0 * kPi / 180.0, nz0);
    }
}

}  // namespace

// A MUTANT MUST FAIL LOUDLY, NOT ABORT. An engine defect can drive OCCT into
// throwing Standard_Failure, and an uncaught throw kills the process with no
// summary at all — which the mutation harness would then have to guess about.
int main() {
    try {
        runAll();
    } catch (const Standard_Failure& e) {
        const char* m = e.GetMessageString();
        ok(false, std::string("uncaught OCCT Standard_Failure: ") + (m ? m : "(no message)"));
    } catch (const std::exception& e) {
        ok(false, std::string("uncaught std::exception: ") + e.what());
    } catch (...) {
        ok(false, "uncaught non-standard exception");
    }
    std::printf("[ab-draft-local] %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
