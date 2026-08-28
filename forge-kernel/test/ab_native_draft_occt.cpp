// ab_native_draft_occt.cpp — LIVE-OCCT A/B for TKOffset FAMILY J.
//
// Drives forge::occtdraft::draftFaces (src/native/brep/NativeDraft.cpp) and
// OCCT's BRepOffsetAPI_DraftAngle over the SAME shapes with the SAME arguments
// and compares the resulting SOLIDS on every observable that can distinguish
// them:
//
//     volume, centre of mass (3), bounding box (6 bounds),
//     face / edge / vertex / shell counts (4), BRepCheck_Analyzer validity,
//     the Euler-Poincare characteristic V - E + F,
//     and — where a closed form exists — the drafted volume derived from first
//     principles rather than borrowed from either kernel.
//
// VOLUME ALONE PROVES NOTHING and this repo has three measured cases where a
// WRONG solid matched the right volume to ten significant figures, so a NEGATIVE
// CONTROL is included that feeds the comparator two shapes of EQUAL VOLUME and
// requires it to REJECT them.
//
// The bounding box is computed from the solids' VERTICES, not from Bnd_Box:
// BRepBndLib inflates by the shape's tolerance, which would blur exactly the
// sub-micron disagreement this harness exists to catch. Both bodies are planar
// polyhedra, so the vertex hull bound is exact.
//
// exit 0 iff every assertion holds; exit 1 on the first failure summary.

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "forge/native/brep/NativeDraft.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <Standard_Failure.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_pass = 0;
int g_fail = 0;
// The negative control DELIBERATELY drives the comparator red. Its reds are the
// proof, not a failure, so they are neither scored nor printed as FAIL.
bool g_quiet = false;

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
    double cx = 0.0, cy = 0.0, cz = 0.0;
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    int nF = 0, nE = 0, nV = 0, nS = 0;
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

    TopTools_IndexedMapOfShape mf, me, mv, ms;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    TopExp::MapShapes(s, TopAbs_SHELL, ms);
    o.nF = mf.Extent(); o.nE = me.Extent(); o.nV = mv.Extent(); o.nS = ms.Extent();

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

// The comparator the whole harness rests on. `label` names the case; `tol` is
// the ABSOLUTE bound on lengths and the RELATIVE bound on volume. Returns the
// number of assertions that FAILED, so the negative control can require > 0.
int compareSolids(const Obs& a, const Obs& b, const std::string& label,
                  double tol, bool report) {
    const int failBefore = g_fail;
    const int passBefore = g_pass;
    const bool quietWas = g_quiet;
    if (!report) g_quiet = true;
    okNear(a.vol, b.vol, tol * std::max(1.0, b.vol), label + " volume");
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
    ok(a.nV - a.nE + a.nF == b.nV - b.nE + b.nF, label + " Euler characteristic");
    const int failed = g_fail - failBefore;
    g_quiet = quietWas;
    if (!report) {
        // A negative control must not pollute the score with its deliberate reds.
        g_fail = failBefore;
        g_pass = passBefore;
    }
    return failed;
}

// ------------------------------------------------------------------- fixtures
// The four vertical side faces of an axis-aligned MakeBox (normal has no Z).
TopTools_ListOfShape boxSideFaces(const TopoDS_Shape& box) {
    TopTools_ListOfShape out;
    for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface as(f);
        if (as.GetType() != GeomAbs_Plane) continue;
        if (std::fabs(as.Plane().Axis().Direction().Z()) < 1e-9) out.Append(f);
    }
    return out;
}

// The single face whose outward-ish plane normal is closest to `d`.
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

bool occtDraft(const TopoDS_Shape& src, const TopTools_ListOfShape& faces,
               const gp_Dir& pull, double angleRad, const gp_Pln& neutral,
               TopoDS_Shape& out) {
    BRepOffsetAPI_DraftAngle mk(src);
    for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next()) {
        mk.Add(TopoDS::Face(it.Value()), pull, angleRad, neutral);
        if (!mk.AddDone()) return false;
    }
    mk.Build();
    if (!mk.IsDone()) return false;
    out = mk.Shape();
    return !out.IsNull();
}

// ------------------------------------------------------------------ the cases
// Case: draft `faces` of `src` by `ang` about `neutral`/`pull` on BOTH engines
// and require them to agree on everything.
void abCase(const std::string& label, const TopoDS_Shape& src,
            const TopTools_ListOfShape& faces, const gp_Dir& pull,
            double ang, const gp_Pln& neutral, double tol = 1.0e-7) {
    TopoDS_Shape occt;
    const bool occtOk = occtDraft(src, faces, pull, ang, neutral, occt);
    ok(occtOk, label + " : OCCT built the reference");
    if (!occtOk) return;

    const TopoDS_Shape nat = forge::occtdraft::draftFaces(src, faces, pull, ang, neutral);
    ok(!nat.IsNull(), label + " : native produced a solid (no defer)");
    if (nat.IsNull()) return;

    const Obs a = observe(nat), b = observe(occt);
    ok(a.valid, label + " : native solid is BRepCheck-VALID");
    ok(b.valid, label + " : OCCT solid is BRepCheck-VALID");
    compareSolids(a, b, label, tol, /*report*/ true);
}

void runAll() {
    std::printf("[ab-draft] TKOffset family J — native draft vs live OCCT\n");

    const gp_Dir zUp(0, 0, 1);
    const gp_Pln nz0(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));

    // ================================================================= case 1
    // Canonical cube, all four side walls, 5 degrees, neutral z=0. The drafted
    // body is the square frustum and its volume has a CLOSED FORM independent of
    // both kernels: for a base L, height H and taper t = tan(alpha) the section
    // at height z is (L - 2 t z)^2, so
    //     V = INT_0^H (L - 2 t z)^2 dz = (L^3 - (L - 2 t H)^3) / (6 t).
    {
        const double L = 10.0, alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, L).Shape();
        const TopTools_ListOfShape sides = boxSideFaces(box);
        ok(sides.Extent() == 4, "case1 : four side faces found");
        abCase("case1 cube L=10 all-4-sides 5deg", box, sides, zUp, alpha, nz0);

        const TopoDS_Shape nat = forge::occtdraft::draftFaces(box, sides, zUp, alpha, nz0);
        if (!nat.IsNull()) {
            const double t = std::tan(alpha);
            const double Vclosed = (L * L * L - std::pow(L - 2.0 * t * L, 3.0)) / (6.0 * t);
            const Obs a = observe(nat);
            okNear(a.vol, Vclosed, 1.0e-7 * Vclosed,
                   "case1 : native volume == frustum CLOSED FORM (not borrowed)");
            // The neutral section is PINNED: the base square is untouched.
            okNear(a.lo[0], 0.0, 1.0e-9, "case1 : base x-min pinned at 0");
            okNear(a.lo[1], 0.0, 1.0e-9, "case1 : base y-min pinned at 0");
            okNear(a.hi[2], L, 1.0e-9, "case1 : height unchanged");
            // Top square side = L - 2 t L.
            okNear(a.hi[0], L, 1.0e-9, "case1 : bbox x-max is the BASE square (top is inset)");
        }
    }

    // ================================================================= case 2
    // ONE side face only — an asymmetric draft. Catches a sign or axis error that
    // the symmetric four-wall case cancels out.
    {
        const double alpha = 7.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 10.0, 6.0).Shape();
        TopTools_ListOfShape one;
        one.Append(faceTowards(box, gp_Dir(1, 0, 0)));
        abCase("case2 box 20x10x6 one +X wall 7deg", box, one, zUp, alpha, nz0);
    }

    // ================================================================= case 3
    // TWO OPPOSITE walls, neutral plane at MID-HEIGHT z=3. Below the neutral
    // plane the walls lean OUT, above they lean IN — the volume is preserved to
    // first order, so a harness that only watched volume would be blind here.
    // The bounding box and the centre of mass are what catch it.
    {
        const double alpha = 8.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 10.0, 6.0).Shape();
        const gp_Pln nz3(gp_Pnt(0, 0, 3), gp_Dir(0, 0, 1));
        TopTools_ListOfShape two;
        two.Append(faceTowards(box, gp_Dir(1, 0, 0)));
        two.Append(faceTowards(box, gp_Dir(-1, 0, 0)));
        abCase("case3 box two +-X walls 8deg neutral z=3", box, two, zUp, alpha, nz3);

        const TopoDS_Shape nat = forge::occtdraft::draftFaces(box, two, zUp, alpha, nz3);
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            const double t = std::tan(alpha);
            // The walls pivot about z=3: at z=0 they are OUT by 3t, at z=6 IN by 3t.
            okNear(a.lo[0], -3.0 * t, 1.0e-9, "case3 : -X wall leans OUT below neutral");
            okNear(a.hi[0], 20.0 + 3.0 * t, 1.0e-9, "case3 : +X wall leans OUT below neutral");
            // Mid-plane pinned => the x-extent AT z=3 is still exactly 20, so the
            // volume of the drafted box equals the original: 20*10*6 = 1200.
            okNear(a.vol, 1200.0, 1.0e-7, "case3 : pivoting about mid-height PRESERVES volume");
        }
    }

    // ================================================================= case 4
    // NEGATIVE ANGLE — the walls lean OUT. Proves the sign is carried, not
    // absolute-valued somewhere in the chain.
    {
        const double alpha = -6.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        const TopTools_ListOfShape sides = boxSideFaces(box);
        abCase("case4 cube all-4-sides -6deg (leans OUT)", box, sides, zUp, alpha, nz0);

        const TopoDS_Shape nat = forge::occtdraft::draftFaces(box, sides, zUp, alpha, nz0);
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            ok(a.vol > 1000.0, "case4 : a negative angle GROWS the box");
        }
    }

    // ================================================================= case 5
    // A non-axis-aligned neutral plane and pull direction. The formulation is
    // frame-free; this is what proves it.
    {
        const double alpha = 4.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(12.0, 8.0, 8.0).Shape();
        const gp_Dir pull(0, 1, 0);
        const gp_Pln ny0(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0));
        TopTools_ListOfShape f;
        f.Append(faceTowards(box, gp_Dir(1, 0, 0)));
        f.Append(faceTowards(box, gp_Dir(0, 0, 1)));
        abCase("case5 pull +Y, two walls, 4deg", box, f, pull, alpha, ny0);
    }

    // ========================================================= NEGATIVE CONTROL
    // Two shapes of EQUAL VOLUME that the comparator MUST reject. A cube of side
    // s = V^(1/3) has exactly the drafted frustum's volume and is not it.
    {
        const double L = 10.0, alpha = 5.0 * kPi / 180.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, L).Shape();
        const TopTools_ListOfShape sides = boxSideFaces(box);
        const TopoDS_Shape nat = forge::occtdraft::draftFaces(box, sides, zUp, alpha, nz0);
        ok(!nat.IsNull(), "negctl : the drafted solid exists");
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            const double s = std::cbrt(a.vol);
            const TopoDS_Shape equalVolBox = BRepPrimAPI_MakeBox(s, s, s).Shape();
            const Obs b = observe(equalVolBox);
            okNear(a.vol, b.vol, 1.0e-9 * a.vol,
                   "negctl : the impostor's volume MATCHES to 1e-9 relative");
            const int rejected = compareSolids(a, b, "negctl", 1.0e-7, /*report*/ false);
            ok(rejected > 0,
               "negctl : the comparator REJECTS an equal-volume impostor");
            std::printf("  [negctl] equal-volume impostor rejected on %d observable(s)\n",
                        rejected);
        }
    }

    // ============================================================ DEFER CONTROLS
    // Each of these must return a NULL shape — an honest defer, not a wrong solid.
    {
        // (a) a non-planar face anywhere in the solid.
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(cyl, gp_Dir(0, 0, -1)));
        const TopoDS_Shape r =
            forge::occtdraft::draftFaces(cyl, f, zUp, 5.0 * kPi / 180.0, nz0);
        ok(r.IsNull(), "defer(a) : a cylinder (non-planar face) is DECLINED");
    }
    {
        // (b) a selected face PARALLEL to the neutral plane — no rotation axis.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(box, gp_Dir(0, 0, 1)));   // the top cap
        const TopoDS_Shape r =
            forge::occtdraft::draftFaces(box, f, zUp, 5.0 * kPi / 180.0, nz0);
        ok(r.IsNull(), "defer(b) : a face PARALLEL to the neutral plane is DECLINED");
    }
    {
        // (c) an empty face list, a zero angle and a 90-degree angle.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        const TopTools_ListOfShape none;
        ok(forge::occtdraft::draftFaces(box, none, zUp, 0.1, nz0).IsNull(),
           "defer(c1) : an empty face list is DECLINED");
        const TopTools_ListOfShape sides = boxSideFaces(box);
        ok(forge::occtdraft::draftFaces(box, sides, zUp, 0.0, nz0).IsNull(),
           "defer(c2) : a zero angle is DECLINED (a no-op is not a draft)");
        ok(forge::occtdraft::draftFaces(box, sides, zUp, 0.5 * kPi, nz0).IsNull(),
           "defer(c3) : a 90-degree angle is DECLINED");
    }
    {
        // (d) a face that is not on the shape at all — must not be silently ignored.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        const TopoDS_Shape other = BRepPrimAPI_MakeBox(3.0, 3.0, 3.0).Shape();
        TopTools_ListOfShape f;
        f.Append(faceTowards(other, gp_Dir(1, 0, 0)));
        ok(forge::occtdraft::draftFaces(box, f, zUp, 5.0 * kPi / 180.0, nz0).IsNull(),
           "defer(d) : a face belonging to ANOTHER shape is DECLINED");
    }

}

}  // namespace

// A MUTANT MUST FAIL LOUDLY, NOT ABORT. An engine defect can drive OCCT into
// throwing Standard_Failure, and an uncaught throw kills the process with no
// summary at all — which the mutation harness would then have to guess about.
// (Measured: the "rotation axis moved to the origin" mutant did exactly this.)
// Catching it here turns a crash into a counted, named failure.
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
    std::printf("[ab-draft] %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
