// ab_native_thicken_occt.cpp — LIVE-OCCT A/B for TKOffset FAMILY I.
//
// Drives forge::occtthicken::thickenShell (src/native/brep/NativeThickenShell.cpp)
// and OCCT's BRepOffset_MakeOffset (Skin + makeThickSolid + GeomAbs_Arc — the
// exact call forge::part::thickenSurface makes today) over the SAME shells with
// the SAME thickness, and compares the resulting SOLIDS on
//
//     volume, centre of mass (3), bounding box (6 bounds),
//     face / edge / vertex / shell counts (4), BRepCheck_Analyzer validity,
//     and the Euler-Poincare characteristic V - E + F,
//
// plus, independently of BOTH kernels, the CLOSED FORM of each case:
//     flat patch          V = area * |t|
//     one concave fold    V = (A1 + A2)|t| - |t|^2 L        (the prisms overlap)
//     one convex fold     V = (A1 + A2)|t| + (theta/2)|t|^2 L   (rolling-ball arc)
// The +(theta/2)t^2 L term is the Rossignac-Requicha cylindrical edge wedge; it
// is what a fuse-of-prisms implementation would MISS, and asserting it is what
// makes this harness able to tell the two apart.
//
// VOLUME ALONE PROVES NOTHING — this repo has three measured cases where a WRONG
// solid matched the right volume to ten significant figures — so a NEGATIVE
// CONTROL feeds the comparator two shapes of EQUAL VOLUME and requires it to
// REJECT them.
//
// Bounding boxes come from the solids' VERTICES, not Bnd_Box, which inflates by
// the shape tolerance and would blur the disagreement this harness exists to see.
// The convex cases carry a cylindrical face, whose extreme point is not a vertex,
// so for those the bbox is compared only on the axes where it is vertex-exact —
// the comparison is stated per axis and never silently widened.
//
// exit 0 iff every assertion holds.

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "forge/native/brep/NativeThickenShell.hpp"
#include "forge/OcctThickenBaseline.hpp"   // orientedPositiveSolid: the oracle's post-condition

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <gp_Ax2d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt2d.hxx>
#include <BRepLib.hxx>
#include <Geom_Circle.hxx>
#include <gp_Ax2.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <gp_Ax3.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <Standard_Failure.hxx>
#include <BRepGProp.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Geom_BSplineSurface.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_JoinType.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Pnt.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_pass = 0;
int g_fail = 0;
bool g_quiet = false;   // the negative control's reds are the proof, not a failure

void ok(bool cond, const std::string& what) {
    if (cond) { ++g_pass; }
    else { ++g_fail; if (!g_quiet) std::printf("  FAIL  %s\n", what.c_str()); }
}

// A defer must be NAMEABLE, not merely null: assert the exact reason string.
void okReason(const char* want, const std::string& label) {
    const char* got = forge::occtthicken::thickenLastDeferReason();
    const bool c = std::strcmp(got, want) == 0;
    if (c) { ++g_pass; }
    else {
        ++g_fail;
        if (!g_quiet)
            std::printf("  FAIL  %s : defer reason\n          got  '%s'\n          want '%s'\n",
                        label.c_str(), got, want);
    }
}

void okNear(double got, double want, double tol, const std::string& what) {
    if (std::fabs(got - want) <= tol) { ++g_pass; }
    else {
        ++g_fail;
        if (!g_quiet)
            std::printf("  FAIL  %s : got %.12g want %.12g (|d| %.3g > tol %.3g)\n",
                        what.c_str(), got, want, std::fabs(got - want), tol);
    }
}

void okInt(int got, int want, const std::string& what) {
    if (got == want) { ++g_pass; }
    else {
        ++g_fail;
        if (!g_quiet)
            std::printf("  FAIL  %s : got %d want %d\n", what.c_str(), got, want);
    }
}

// ---------------------------------------------------------------- observables
struct Obs {
    double vol = 0.0;
    double cx = 0.0, cy = 0.0, cz = 0.0;
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    int nF = 0, nE = 0, nV = 0, nS = 0;
    int nPlane = 0, nCyl = 0, nOther = 0;   // surface-type inventory
    int rawF = 0, rawE = 0;                 // counts BEFORE canonicalisation
    bool valid = false;
};

// WHY TOPOLOGY IS COUNTED AFTER CANONICALISATION ON BOTH SIDES.
// A solid's face count is a property of its REPRESENTATION, not of its geometry:
// the same body can be carried with a rim split into two coplanar quads or merged
// into one. MEASURED on the L shell at |t| = 2, this is exactly what separates the
// two kernels — OCCT keeps its per-original-face rim quads (10 faces concave,
// 13 convex) while the native fuse is already merged (8 and 9). Running the SAME
// ShapeUpgrade_UnifySameDomain over BOTH brings them to 8/18/12 and 9/21/14
// respectively, identical face for face and with the same plane/cylinder
// inventory. So the harness canonicalises both and compares that; it ALSO records
// the raw counts, so the representation difference is reported rather than hidden.
TopoDS_Shape canonical(const TopoDS_Shape& s) {
    if (s.IsNull()) return s;
    ShapeUpgrade_UnifySameDomain u(s, Standard_True, Standard_True, Standard_True);
    u.Build();
    const TopoDS_Shape r = u.Shape();
    return r.IsNull() ? s : r;
}

Obs observe(const TopoDS_Shape& raw) {
    Obs o;
    if (raw.IsNull()) return o;
    {
        TopTools_IndexedMapOfShape rf, re;
        TopExp::MapShapes(raw, TopAbs_FACE, rf);
        TopExp::MapShapes(raw, TopAbs_EDGE, re);
        o.rawF = rf.Extent(); o.rawE = re.Extent();
    }
    const TopoDS_Shape s = canonical(raw);
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
    for (int i = 1; i <= mf.Extent(); ++i) {
        BRepAdaptor_Surface as(TopoDS::Face(mf.FindKey(i)));
        if (as.GetType() == GeomAbs_Plane)         ++o.nPlane;
        else if (as.GetType() == GeomAbs_Cylinder) ++o.nCyl;
        else                                       ++o.nOther;
    }
    // Validity is asserted on the RAW shape: canonicalising could mask a defect.
    BRepCheck_Analyzer an(raw);
    o.valid = an.IsValid() == Standard_True;
    return o;
}

int compareSolids(const Obs& a, const Obs& b, const std::string& label,
                  double tol, bool report, bool compareTypes = true) {
    const int failBefore = g_fail, passBefore = g_pass;
    const bool quietWas = g_quiet;
    if (!report) g_quiet = true;
    okNear(a.vol, b.vol, tol * std::max(1.0, b.vol), label + " volume");
    okNear(a.cx, b.cx, tol * 100.0, label + " com.x");
    okNear(a.cy, b.cy, tol * 100.0, label + " com.y");
    okNear(a.cz, b.cz, tol * 100.0, label + " com.z");
    static const char* ax[3] = {"x", "y", "z"};
    for (int k = 0; k < 3; ++k) {
        okNear(a.lo[k], b.lo[k], tol * 100.0, label + " bbox.lo." + ax[k]);
        okNear(a.hi[k], b.hi[k], tol * 100.0, label + " bbox.hi." + ax[k]);
    }
    ok(a.nF == b.nF, label + " face count");
    ok(a.nE == b.nE, label + " edge count");
    ok(a.nV == b.nV, label + " vertex count");
    ok(a.nS == b.nS, label + " shell count");
    ok(a.nV - a.nE + a.nF == b.nV - b.nE + b.nF, label + " Euler characteristic");
    if (compareTypes) {
        okInt(a.nPlane, b.nPlane, label + " planar-face count");
        okInt(a.nCyl, b.nCyl, label + " cylindrical-face count (the ARC join wedge)");
        okInt(a.nOther, b.nOther, label + " other-surface-type count");
    }
    const int failed = g_fail - failBefore;
    g_quiet = quietWas;
    if (!report) { g_fail = failBefore; g_pass = passBefore; }
    return failed;
}

// ------------------------------------------------------------------- fixtures
TopoDS_Face quadFace(const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c, const gp_Pnt& d) {
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(a); poly.Add(b); poly.Add(c); poly.Add(d);
    poly.Close();
    BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
    return mkf.Face();
}

TopoDS_Shape sewShell(const std::vector<TopoDS_Face>& fs) {
    BRepBuilderAPI_Sewing sew(1.0e-6);
    for (const TopoDS_Face& f : fs) sew.Add(f);
    sew.Perform();
    return sew.SewedShape();
}

// FLAT: one 20 x 10 patch in z = 0.
TopoDS_Shape flatPatch() {
    return quadFace(gp_Pnt(0, 0, 0), gp_Pnt(20, 0, 0), gp_Pnt(20, 10, 0), gp_Pnt(0, 10, 0));
}

// L: a 20x10 plate in z=0 (area 200) + a 10x10 plate in x=0 (area 100), sharing
// the straight edge x=0, z=0, y in [0,10] of length 10.
TopoDS_Shape lShell() {
    std::vector<TopoDS_Face> fs;
    fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(20, 0, 0), gp_Pnt(20, 10, 0), gp_Pnt(0, 10, 0)));
    fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
    return sewShell(fs);
}

// U: 10x10 wall at x=0 + 20x10 floor in z=0 + 10x10 wall at x=20. Two folds.
TopoDS_Shape uShell() {
    std::vector<TopoDS_Face> fs;
    fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
    fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(20, 0, 0), gp_Pnt(20, 10, 0), gp_Pnt(0, 10, 0)));
    fs.push_back(quadFace(gp_Pnt(20, 0, 0), gp_Pnt(20, 10, 0), gp_Pnt(20, 10, 10), gp_Pnt(20, 0, 10)));
    return sewShell(fs);
}

bool occtThicken(const TopoDS_Shape& shell, double t, TopoDS_Shape& out) {
    BRepOffset_MakeOffset mk;
    mk.Initialize(shell, t, 1.0e-4, BRepOffset_Skin,
                  /*Intersection*/ Standard_False, /*SelfInter*/ Standard_False,
                  GeomAbs_Arc, /*makeThickSolid*/ Standard_True);
    mk.MakeThickSolid();
    if (!mk.IsDone()) return false;
    // THE WHOLE ORACLE, NOT HALF OF IT. test/OcctThickenOracle.hpp records that
    // this family's most expensive mistake was an A/B arm that hand-copied the
    // BRepOffset_MakeOffset call WITHOUT the orientation normalisation production
    // applied after it -- and this function was still that half-copy. MEASURED on
    // case9 (the closed 10x6x4 box sheet, t = +1): the raw answer is a REVERSED
    // solid, signed volume -315.020643, and BRepCheck flags its SOLID with
    // BRepCheck_SubshapeNotInShape; the SAME shape after orientedPositiveSolid is
    // +315.020643 and BRepCheck-VALID. So "OCCT solid is BRepCheck-VALID" failing
    // there was neither an inverted assertion nor an invalid OCCT answer: it was
    // this arm skipping the post-condition. The waiver case9 carried for it is
    // removed; the validity assertion is unconditional again.
    out = ::forge::part::orientedPositiveSolid(mk.Shape());
    return !out.IsNull();
}

// One A/B case. Returns the native volume (0 if it deferred) so the caller can
// assert the closed form for whichever side of the shell it landed on.
double abCase(const std::string& label, const TopoDS_Shape& shell, double t,
              double tol = 1.0e-6, bool compareTypes = true) {
    TopoDS_Shape occt;
    const bool occtOk = occtThicken(shell, t, occt);
    ok(occtOk, label + " : OCCT built the reference");
    if (!occtOk) return 0.0;

    const TopoDS_Shape nat = forge::occtthicken::thickenShell(shell, t);
    ok(!nat.IsNull(), label + " : native produced a solid (no defer)");
    if (nat.IsNull()) return 0.0;

    const Obs a = observe(nat), b = observe(occt);
    ok(a.valid, label + " : native solid is BRepCheck-VALID");
    ok(b.valid, label + " : OCCT solid is BRepCheck-VALID");
    compareSolids(a, b, label, tol, /*report*/ true, compareTypes);
    std::printf("  [%s] native raw F/E = %d/%d, OCCT raw F/E = %d/%d;"
                " canonical F/E/V = %d/%d/%d both\n",
                label.c_str(), a.rawF, a.rawE, b.rawF, b.rawE, a.nF, a.nE, a.nV);
    return a.vol;
}

void runAll() {
    std::printf("[ab-thicken] TKOffset family I — native thicken vs live OCCT\n");

    const double T = 2.0;

    // ================================================================= case 1
    // FLAT 20x10 patch. Closed form V = area * |t| = 200 * 2 = 400 — the first
    // row of the header's MEASURED table.
    {
        const TopoDS_Shape p = flatPatch();
        for (double t : {T, -T}) {
            const std::string lab = "case1 flat 20x10 t=" + std::to_string(t);
            const double v = abCase(lab, p, t);
            if (v > 0.0) okNear(v, 400.0, 1.0e-7, lab + " : CLOSED FORM area*|t| = 400");
        }
    }

    // ================================================================= case 2
    // L shell, BOTH offset sides. One side is CONCAVE (the prisms overlap in a
    // |t| x |t| x L box) and the other CONVEX (a quarter-cylinder is added):
    //     concave  V = (200 + 100)*2 - 2*2*10           = 560
    //     convex   V = (200 + 100)*2 + (pi/2)/2*4*10    = 600 + 10 pi
    // Asserting the two volumes as a SET is a claim about the GEOMETRY that is
    // independent of which way the sew happened to orient the shell, and
    // independent of both kernels.
    {
        const TopoDS_Shape s = lShell();
        ok(!s.IsNull(), "case2 : L shell sewed");
        std::vector<double> vols;
        for (double t : {T, -T}) {
            const std::string lab = "case2 L shell t=" + std::to_string(t);
            const double v = abCase(lab, s, t);
            if (v > 0.0) vols.push_back(v);
        }
        ok(vols.size() == 2, "case2 : both offset sides produced a solid");
        if (vols.size() == 2) {
            const double concave = 560.0;
            const double convex  = 600.0 + 10.0 * kPi;
            const double lo = std::min(vols[0], vols[1]), hi = std::max(vols[0], vols[1]);
            okNear(lo, concave, 1.0e-6, "case2 : CONCAVE side == (A1+A2)|t| - |t|^2 L = 560");
            okNear(hi, convex, 1.0e-6,
                   "case2 : CONVEX side == 600 + 10*pi (the Rossignac-Requicha edge wedge)");
            okNear(hi - 600.0, 10.0 * kPi, 1.0e-6,
                   "case2 : the surplus over the fuse-of-prisms IS a quarter-cylinder");
        }
    }

    // ================================================================= case 3
    // U shell, both sides. TWO folds:
    //     concave  V = 400*2 - 2*(2*2*10)        = 720
    //     convex   V = 400*2 + 2*(10 pi)         = 800 + 20 pi
    {
        const TopoDS_Shape s = uShell();
        ok(!s.IsNull(), "case3 : U shell sewed");
        std::vector<double> vols;
        for (double t : {T, -T}) {
            const std::string lab = "case3 U shell t=" + std::to_string(t);
            const double v = abCase(lab, s, t);
            if (v > 0.0) vols.push_back(v);
        }
        ok(vols.size() == 2, "case3 : both offset sides produced a solid");
        if (vols.size() == 2) {
            const double lo = std::min(vols[0], vols[1]), hi = std::max(vols[0], vols[1]);
            okNear(lo, 720.0, 1.0e-6, "case3 : CONCAVE side == 800 - 2*40 = 720");
            okNear(hi, 800.0 + 20.0 * kPi, 1.0e-6,
                   "case3 : CONVEX side == 800 + 20*pi (TWO edge wedges)");
        }
    }

    // ================================================================= case 4
    // A THIRD thickness on the L shell, to prove the wedge term scales as t^2 and
    // is not a constant fitted to t = 2.
    {
        const TopoDS_Shape s = lShell();
        std::vector<double> vols;
        for (double t : {3.0, -3.0}) {
            const std::string lab = "case4 L shell t=" + std::to_string(t);
            const double v = abCase(lab, s, t);
            if (v > 0.0) vols.push_back(v);
        }
        if (vols.size() == 2) {
            const double hi = std::max(vols[0], vols[1]);
            const double lo = std::min(vols[0], vols[1]);
            okNear(lo, 300.0 * 3.0 - 9.0 * 10.0, 1.0e-6, "case4 : concave at t=3 == 810");
            okNear(hi, 300.0 * 3.0 + 0.25 * kPi * 9.0 * 10.0, 1.0e-6,
                   "case4 : convex at t=3 == 900 + 22.5*pi (wedge scales as t^2)");
        }
    }

    // ================================================================= case 5
    // A FLAT B-SPLINE PATCH — a plane that is NOT a Geom_Plane. This is exactly
    // what forge.surfacing.buildPatch emits, so it is the surface the two SHIPPED
    // smoke tests (thicken_surface_smoke.js, knit_surface_smoke.js) thicken. A
    // type-tag planarity test rejects it and would have silently deleted a shipped
    // capability the moment the OCCT fallback was compiled out; this case is the
    // regression guard for that.
    {
        TColgp_Array2OfPnt poles(1, 2, 1, 2);
        poles.SetValue(1, 1, gp_Pnt(0, 0, 0));
        poles.SetValue(2, 1, gp_Pnt(20, 0, 0));
        poles.SetValue(1, 2, gp_Pnt(0, 10, 0));
        poles.SetValue(2, 2, gp_Pnt(20, 10, 0));
        TColStd_Array1OfReal uk(1, 2), vk(1, 2);
        uk.SetValue(1, 0.0); uk.SetValue(2, 1.0);
        vk.SetValue(1, 0.0); vk.SetValue(2, 1.0);
        TColStd_Array1OfInteger um(1, 2), vm(1, 2);
        um.SetValue(1, 2); um.SetValue(2, 2);
        vm.SetValue(1, 2); vm.SetValue(2, 2);
        Handle(Geom_BSplineSurface) bs =
            new Geom_BSplineSurface(poles, uk, vk, um, vm, 1, 1);
        BRepBuilderAPI_MakeFace mkf(bs, 1.0e-7);
        ok(mkf.IsDone(), "case5 : the flat B-spline face was built");
        if (mkf.IsDone()) {
            const TopoDS_Face bf = mkf.Face();
            // ★ A MEASURED DIFFERENCE, STATED RATHER THAN ASSERTED AWAY. Volume,
            // centre of mass, bounding box, all four topology counts, the Euler
            // characteristic and validity agree exactly. The SURFACE TYPES do not:
            // OCCT's offset RE-TYPES the flat B-spline caps as Geom_Plane, while the
            // native prism PRESERVES the input surface it was handed. Same solid,
            // different carrier. Asserting equality here would be asserting that
            // one kernel's conversion policy is the right answer, so the inventory
            // is compared as an explicit claim about each side instead.
            const double v = abCase("case5 flat B-SPLINE patch t=2", bf, T,
                                    1.0e-6, /*compareTypes*/ false);
            if (v > 0.0) {
                okNear(v, 400.0, 1.0e-7,
                       "case5 : CLOSED FORM area*|t| = 400 on a NON-Geom_Plane plane");
                TopoDS_Shape occt5;
                if (occtThicken(bf, T, occt5)) {
                    const Obs na = observe(forge::occtthicken::thickenShell(bf, T));
                    const Obs ob = observe(occt5);
                    std::printf("  [case5] surface types  native plane/cyl/other = %d/%d/%d ;"
                                "  OCCT = %d/%d/%d\n",
                                na.nPlane, na.nCyl, na.nOther,
                                ob.nPlane, ob.nCyl, ob.nOther);
                    okInt(na.nPlane + na.nCyl + na.nOther, 6,
                          "case5 : native prism has 6 faces");
                    okInt(ob.nPlane + ob.nCyl + ob.nOther, 6,
                          "case5 : OCCT offset has 6 faces");
                    // MEASURED 2026-08-28: native 0 plane / 6 B-spline, OCCT
                    // 5 plane / 1 B-spline. BRepPrimAPI_MakePrism carries the input
                    // surface into the swept cap AND rules the four laterals as
                    // B-splines; OCCT's offset keeps only the original face as a
                    // B-spline and emits the other five as planes. Every one of the
                    // twelve faces is geometrically FLAT either way, which is what
                    // the identical volume / COM / bbox / topology above already
                    // establish. These two lines pin the carriers so a future
                    // change to either policy is noticed rather than absorbed.
                    okInt(na.nOther, 6,
                          "case5 : the native prism carries all six faces as B-splines");
                    okInt(ob.nOther, 1,
                          "case5 : OCCT keeps one B-spline and re-types five as planes");
                }
            }
        }
    }

    // ================================================================= case 6
    // A CYLINDRICAL face — the surface type that WAS the entire deletion bucket.
    //
    // WHY THIS CASE EXISTS. test/corpus_ab_coverage.cpp measured this engine at
    // 67.8% against OCCT's 100.0% over 600 real parts, a deletion bucket of 193.
    // Instrumenting the native arm with thickenLastDeferReason() attributed ALL
    // 193 to the single reason "a face is not a Geom_Plane", and a surface census
    // of the picked face found every one of the 193 to be a CYLINDER (the corpus
    // contains no third surface type in that slot: 407 Plane, 193 Cylinder). So
    // the deletion bucket was one missing surface type, and this is the case that
    // pins the engine that closes it.
    //
    // CLOSED FORM. Skinning the full lateral face of a cylinder of radius R and
    // height h by |t| gives the coaxial annular tube between R and R + s*t, where
    // s is +1 when the face's outward normal points away from the axis and -1
    // when it points at it. BRepPrimAPI_MakeCylinder's lateral face is FORWARD
    // with the outward normal, so t = +2 GROWS it:
    //     V = pi*((R+t)^2 - R^2)*h = pi*(49 - 25)*10 = 240 pi
    //     V = pi*(R^2 - (R-t)^2)*h = pi*(25 -  9)*10 = 160 pi
    // Both are asserted against live OCCT AND against the closed form, so a
    // kernel and a formula would both have to be wrong in the same direction.
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        TopoDS_Face lateral;
        for (TopExp_Explorer ex(cyl, TopAbs_FACE); ex.More(); ex.Next()) {
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            GProp_GProps gp;
            BRepGProp::SurfaceProperties(f, gp);
            if (std::fabs(gp.Mass() - 2.0 * kPi * 5.0 * 10.0) < 1.0e-6) lateral = f;
        }
        ok(!lateral.IsNull(), "case6 : found the cylinder's lateral face");
        if (!lateral.IsNull()) {
            const double vPlus = abCase("case6 cylinder lateral t=+2", lateral, T);
            if (vPlus > 0.0)
                okNear(vPlus, kPi * (49.0 - 25.0) * 10.0, 1.0e-7 * kPi * 240.0,
                       "case6 : CLOSED FORM pi*((R+t)^2-R^2)*h = 240 pi");
            const double vMinus = abCase("case6 cylinder lateral t=-2", lateral, -T);
            if (vMinus > 0.0)
                okNear(vMinus, kPi * (25.0 - 9.0) * 10.0, 1.0e-7 * kPi * 160.0,
                       "case6 : CLOSED FORM pi*(R^2-(R-t)^2)*h = 160 pi");

            // SURFACE INVENTORY, as an explicit claim about each side. The whole
            // reason the engine builds this body out of canonical primitives
            // rather than revolving its axial section is that a revolve emits
            // Geom_SurfaceOfRevolution everywhere: MEASURED on corpus part
            // ho1002 that came back 4F/8E where OCCT returns 4F/6E. Pinning the
            // inventory is what stops that regression coming back silently.
            TopoDS_Shape occt6;
            if (occtThicken(lateral, T, occt6)) {
                const Obs na = observe(forge::occtthicken::thickenShell(lateral, T));
                const Obs ob = observe(occt6);
                std::printf("  [case6] surface types  native plane/cyl/other = %d/%d/%d ;"
                            "  OCCT = %d/%d/%d\n",
                            na.nPlane, na.nCyl, na.nOther, ob.nPlane, ob.nCyl, ob.nOther);
                okInt(na.nCyl, 2, "case6 : native emits exactly TWO cylindrical walls");
                okInt(na.nPlane, 2, "case6 : native emits exactly TWO planar annular caps");
                okInt(na.nOther, 0, "case6 : native emits NO non-analytic face");
                okInt(ob.nCyl, 2, "case6 : OCCT emits exactly TWO cylindrical walls");
                okInt(ob.nPlane, 2, "case6 : OCCT emits exactly TWO planar annular caps");
                okInt(ob.nOther, 0, "case6 : OCCT emits NO non-analytic face");
            }
        }
    }

    // ================================================================= case 7
    // A GENUINELY HOLED cylindrical patch — the PATH D input, and the shape of the
    // whole 23-part deletion bucket PATH D was written for (all 23 corpus parts are
    // full-turn cylinders whose trim is not the parametric rectangle; 19 of them carry
    // exactly one hole). Unlike defer(a) above, every edge of this hole LIES ON the
    // cylinder: two v=const arcs and two u=const rulings.
    //
    // This is the POSITIVE CONTROL for PATH D. It is not a repeat of case 6: case 6's
    // face is the full rectangle and is built by the closed-form tube, so if PATH D
    // were deleted case 6 would still pass and case 7 would not.
    {
        Handle(Geom_CylindricalSurface) cs7 =
            new Geom_CylindricalSurface(gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1),
                                               gp_Dir(1, 0, 0)), 5.0);
        BRepBuilderAPI_MakeFace mkOuter7(cs7, 0.0, 2.0 * kPi, 0.0, 10.0, 1.0e-7);
        ok(mkOuter7.IsDone(), "case7 : the untrimmed lateral face rebuilt");
        if (mkOuter7.IsDone()) {
            const double u0 = 0.5, u1 = 1.5, v0 = 3.0, v1 = 7.0, R7 = 5.0;
            // THE HOLE IS BUILT IN THE PARAMETRIC DOMAIN, and that is the whole
            // difference from defer(a) above. An edge made from a 2D pcurve on the
            // surface is ON the surface by construction; BRepLib::BuildCurves3d then
            // derives the 3D curve FROM the pcurve. Building it the other way round —
            // 3D points first, BuildCurves3d after — is what makes defer(a)'s wire a
            // set of chords, and it also silently yields a ZERO-AREA face (measured:
            // 0.000000 against the intended 294.159265), so that shape could never
            // have exercised this path at all.
            auto seg7 = [&](double a, double b, double c, double d) {
                Handle(Geom2d_Line) L =
                    new Geom2d_Line(gp_Pnt2d(a, b), gp_Dir2d(c - a, d - b));
                const double len = std::hypot(c - a, d - b);
                return BRepBuilderAPI_MakeEdge(new Geom2d_TrimmedCurve(L, 0.0, len), cs7).Edge();
            };
            BRepBuilderAPI_MakeWire w7;
            w7.Add(seg7(u0, v0, u1, v0));
            w7.Add(seg7(u1, v0, u1, v1));
            w7.Add(seg7(u1, v1, u0, v1));
            w7.Add(seg7(u0, v1, u0, v0));
            ok(w7.IsDone(), "case7 : the on-surface hole wire closed");
            if (w7.IsDone()) {
                BRepBuilderAPI_MakeFace mkHoled7(mkOuter7.Face());
                mkHoled7.Add(TopoDS::Wire(w7.Wire().Reversed()));
                ok(mkHoled7.IsDone(), "case7 : the holed face built");
                if (mkHoled7.IsDone()) {
                    BRepLib::BuildCurves3d(mkHoled7.Face());
                    const TopoDS_Face f7 = mkHoled7.Face();

                    // The input itself is asserted before it is used. A face that came
                    // out empty would make every comparison below pass vacuously.
                    const double area7 =
                        2.0 * kPi * R7 * 10.0 - (u1 - u0) * R7 * (v1 - v0);
                    GProp_GProps ga7;
                    BRepGProp::SurfaceProperties(f7, ga7);
                    okNear(ga7.Mass(), area7, 1.0e-9 * area7,
                           "case7 : the holed INPUT face has the intended area");

                    // INDEPENDENT closed form in literals: the body between R and R+t
                    // over trim domain D has volume area(f)*((R+t)^2-R^2)/(2R).
                    const double vPlus7 = abCase("case7 holed cylinder t=+2", f7, T,
                                                 1.0e-6, /*compareTypes*/ false);
                    if (vPlus7 > 0.0)
                        okNear(vPlus7, area7 * ((R7 + T) * (R7 + T) - R7 * R7) / (2.0 * R7),
                               1.0e-6 * area7 * 2.4,
                               "case7 : CLOSED FORM area*((R+t)^2-R^2)/(2R)");
                    const double vMinus7 = abCase("case7 holed cylinder t=-2", f7, -T,
                                                  1.0e-6, /*compareTypes*/ false);
                    if (vMinus7 > 0.0)
                        okNear(vMinus7, area7 * (R7 * R7 - (R7 - T) * (R7 - T)) / (2.0 * R7),
                               1.0e-6 * area7 * 1.6,
                               "case7 : CLOSED FORM area*(R^2-(R-t)^2)/(2R)");

                    // THE HOLE MUST SURVIVE. A construction that quietly dropped the
                    // inner wire would still be a valid solid and still close in volume;
                    // it would NOT carry the window's four walls. Pinned against OCCT.
                    TopoDS_Shape occt7;
                    const TopoDS_Shape nat7 = forge::occtthicken::thickenShell(f7, T);
                    if (occtThicken(f7, T, occt7) && !nat7.IsNull()) {
                        const Obs n7 = observe(nat7);
                        const Obs o7 = observe(occt7);
                        okInt(n7.nF, o7.nF, "case7 : native face count == OCCT's");
                        okInt(n7.nE, o7.nE, "case7 : native edge count == OCCT's");
                        okInt(n7.nV, o7.nV, "case7 : native vertex count == OCCT's");
                        ok(n7.nF > 4, "case7 : the window's walls are present (F > 4)");

                        // ★ THE SURFACE-TYPE CENSUS IS *NOT* COMPARED FOR THIS CASE,
                        // and the exemption is pinned rather than waved through.
                        //
                        // This face's hole is built from pcurves, so
                        // BRepLib::BuildCurves3d hands back B-SPLINE images of what are
                        // geometrically four straight rulings and arcs. PATH D builds a
                        // plane only where the rail is an analytic Geom_Line or coaxial
                        // Geom_Circle, because fitting a plane to a B-spline rail forces
                        // MakeFace to PROJECT it — an approximation that was MEASURED to
                        // take the 23 corpus parts from 23/23 down to 18/23 at t>0. So
                        // native emits ruled B-spline walls here where OCCT emits planes.
                        //
                        // Everything else agrees: volume to the closed form, area, centre
                        // of mass, bounding box, validity and F/E/V, all asserted above.
                        // The exact counts are pinned so that if this limit is ever
                        // removed THIS TEST FAILS and the claim gets restated rather than
                        // quietly going stale.
                        std::printf("  [case7] surface types  native plane/cyl/other ="
                                    " %d/%d/%d ;  OCCT = %d/%d/%d\n",
                                    n7.nPlane, n7.nCyl, n7.nOther,
                                    o7.nPlane, o7.nCyl, o7.nOther);
                        okInt(n7.nCyl, 2, "case7 : native emits TWO cylindrical skins");
                        okInt(o7.nCyl, 2, "case7 : OCCT emits TWO cylindrical skins");
                        okInt(o7.nPlane, 6, "case7 : OCCT plans all six walls");
                        okInt(n7.nPlane, 2,
                              "case7 : native plans only the 2 analytic walls "
                              "(KNOWN LIMIT: B-spline-encoded rulings)");
                        okInt(n7.nOther, 4,
                              "case7 : native's other 4 walls are exact RULED B-splines "
                              "(KNOWN LIMIT, not a geometry error)");
                    }
                }
            }
        }
    }

    // ========================================================= NEGATIVE CONTROL
    // A cylinder of exactly the flat case's volume (400) is not the flat case.
    {
        const TopoDS_Shape p = flatPatch();
        const TopoDS_Shape nat = forge::occtthicken::thickenShell(p, T);
        ok(!nat.IsNull(), "negctl : the thickened patch exists");
        if (!nat.IsNull()) {
            const Obs a = observe(nat);
            const double h = 4.0;
            const double rad = std::sqrt(a.vol / (kPi * h));
            const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(rad, h).Shape();
            const Obs b = observe(cyl);
            okNear(a.vol, b.vol, 1.0e-9 * a.vol,
                   "negctl : the impostor's volume MATCHES to 1e-9 relative");
            const int rejected = compareSolids(a, b, "negctl", 1.0e-6, /*report*/ false);
            ok(rejected > 0, "negctl : the comparator REJECTS an equal-volume impostor");
            std::printf("  [negctl] equal-volume impostor rejected on %d observable(s)\n",
                        rejected);
        }
    }

    // ============================================================ DEFER CONTROLS
    {
        // (a) a cylindrical face that is NOT the full parametric rectangle.
        //
        // THIS CONTROL REPLACES, AND DOES NOT RELAX, THE ONE THAT WAS HERE. It
        // used to feed the lateral face of a cylinder and require a DECLINE with
        // the reason "a face is not a Geom_Plane". That face is now BUILT — case 6
        // asserts the result against live OCCT and against the closed form — so
        // the old assertion is not a weakened test but an obsolete one, and the
        // capability it guarded (a curved face must never be silently approximated)
        // is guarded here instead, on the input the engine still declines.
        //
        // WHY THIS INPUT. The closed form the cylindrical path uses is exact only
        // when the face is trimmed to its WHOLE parametric rectangle. MEASURED on
        // the corpus: over the 193 cylindrical parts, the 170 that pass the
        // rectangle certificate match OCCT's volume to rel < 1e-9, and the 23 that
        // fail it miss BOTH candidate closed forms by 2e-2 .. 9e-2. So a holed
        // patch is exactly the input on which the formula stops being OCCT's
        // answer, and it must decline rather than return a plausible wrong solid.
        // A window cut out of the wall reduces the area below R*du*dv, which is
        // precisely what the certificate detects.
        const TopoDS_Shape tube = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        TopoDS_Face lateral;
        for (TopExp_Explorer ex(tube, TopAbs_FACE); ex.More(); ex.Next()) {
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            GProp_GProps gp;
            BRepGProp::SurfaceProperties(f, gp);
            if (std::fabs(gp.Mass() - 2.0 * kPi * 5.0 * 10.0) < 1.0e-6) lateral = f;
        }
        ok(!lateral.IsNull(), "defer(a) : found the cylinder's lateral face");
        // Cut a window out of the wall: the same lateral surface, trimmed to a
        // sub-rectangle in v. Its area is strictly less than R * du * dv over the
        // ORIGINAL v range, so the certificate must reject it... except that a
        // sub-rectangle IS a rectangle. So the window is punched as an inner loop
        // instead: build the face from the surface with an added hole wire.
        Handle(Geom_CylindricalSurface) cs =
            new Geom_CylindricalSurface(gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1),
                                               gp_Dir(1, 0, 0)), 5.0);
        BRepBuilderAPI_MakeFace mkOuter(cs, 0.0, 2.0 * kPi, 0.0, 10.0, 1.0e-7);
        ok(mkOuter.IsDone(), "defer(a) : the untrimmed lateral face rebuilt");
        if (mkOuter.IsDone()) {
            // A rectangular hole in (u,v): u in [0.5, 1.5], v in [3, 7].
            BRepBuilderAPI_MakePolygon holeUV;
            const double uu[4] = {0.5, 1.5, 1.5, 0.5};
            const double vv[4] = {3.0, 3.0, 7.0, 7.0};
            for (int i = 0; i < 4; ++i)
                holeUV.Add(gp_Pnt(5.0 * std::cos(uu[i]), 5.0 * std::sin(uu[i]), vv[i]));
            holeUV.Close();
            ok(holeUV.IsDone(), "defer(a) : the hole wire closed");
            if (holeUV.IsDone()) {
                BRepBuilderAPI_MakeFace mkHoled(mkOuter.Face());
                mkHoled.Add(TopoDS::Wire(holeUV.Wire().Reversed()));
                if (mkHoled.IsDone()) {
                    BRepLib::BuildCurves3d(mkHoled.Face());
                    const TopoDS_Shape got =
                        forge::occtthicken::thickenShell(mkHoled.Face(), T);
                    // ★ THE REASON THIS CONTROL ASSERTS CHANGED, AND THE CHANGE IS
                    // THE POINT. Before PATH D a non-rectangular trim ended the call
                    // at the rectangle certificate, and this control asserted that
                    // sentence. PATH D now ATTEMPTS such a face, so the certificate no
                    // longer decides this input and asserting its old sentence would be
                    // asserting dead code.
                    //
                    // THE INPUT IS STILL A GENUINE DECLINE, and for a truer reason. The
                    // hole wire above is a MakePolygon through four points that lie on
                    // the cylinder — but the straight segments BETWEEN them are CHORDS,
                    // and a chord at constant v does not lie on the cylinder at all.
                    // Only the two u=const sides are real rulings. PATH D detects
                    // exactly that and names it. So this input is not "a holed patch"
                    // (case 7 below builds one of those and matches OCCT); it is a face
                    // whose boundary is not on its own surface, and declining it is
                    // correct rather than a coverage gap.
                    ok(got.IsNull(),
                       "defer(a) : a patch whose hole wire is CHORDS is DECLINED");
                    okReason("trimmed-cylinder path: a straight boundary edge is not a "
                             "ruling of the cylinder", "defer(a)");
                }
            }
        }
    }
    {
        // (a2) a curved face that is NEITHER a plane NOR a cylinder still declines
        // with the original reason — the engine gained ONE surface type, not a
        // licence to approximate every one. A sphere's face is the control.
        const TopoDS_Shape sph = BRepPrimAPI_MakeSphere(5.0).Shape();
        TopoDS_Face sf;
        for (TopExp_Explorer ex(sph, TopAbs_FACE); ex.More(); ex.Next())
            sf = TopoDS::Face(ex.Current());
        ok(!sf.IsNull(), "defer(a2) : found the sphere's face");
        if (!sf.IsNull()) {
            ok(forge::occtthicken::thickenShell(sf, T).IsNull(),
               "defer(a2) : a SPHERICAL face is DECLINED");
            okReason("a face is not a Geom_Plane", "defer(a2)");
        }
    }
    {
        // (b) a zero / non-finite thickness.
        const TopoDS_Shape p = flatPatch();
        ok(forge::occtthicken::thickenShell(p, 0.0).IsNull(),
           "defer(b1) : a zero thickness is DECLINED");
        okReason("thickness is zero or not finite", "defer(b1)");
        ok(forge::occtthicken::thickenShell(TopoDS_Shape(), T).IsNull(),
           "defer(b2) : a null shape is DECLINED");
        okReason("input shape is null", "defer(b2)");
    }
    // ============================================ case 8..12 — CONVEX CORNERS
    // DERIVATION 4 (the spherical vertex wedge). Before it, every one of these
    // declined with "a convex fold ends at a 3-or-more-plate corner (the
    // spherical vertex wedge is not built)" — and the shipped app lost THICKEN of
    // UNFOLD(BOX) (ft_silent_noop_gate.sh: 5524.631241 mm^3 under OCCT, a named
    // refusal under native). Each case is asserted against live OCCT on the full
    // observable vector AND, where one exists, against a closed form derived here.
    {
        // case 8 — THREE PERPENDICULAR 10x10 PLATES at the origin (what used to be
        // defer(c)). Both sides, as a SET, so the sew's orientation cannot matter:
        //   concave  V = 3*200 - 3*(2*2*10) + 2*2*2                = 488
        //   convex   V = 3*200 + 3*(pi/4)*2^2*10 + (1/8)(4/3)pi 2^3 = 600 + 30pi + 4pi/3
        std::vector<TopoDS_Face> fs;
        fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
        fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
        fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 10), gp_Pnt(10, 0, 10), gp_Pnt(10, 0, 0)));
        const TopoDS_Shape corner = sewShell(fs);
        ok(!corner.IsNull(), "case8 : the three-plate corner shell sewed");
        std::vector<double> vols;
        for (double t : {T, -T}) {
            const double v = abCase("case8 three-plate corner t=" + std::to_string(t), corner, t);
            if (v > 0.0) vols.push_back(v);
        }
        ok(vols.size() == 2, "case8 : BOTH sides of the corner now build");
        if (vols.size() == 2) {
            std::sort(vols.begin(), vols.end());
            okNear(vols[0], 488.0, 1.0e-6, "case8 : CONCAVE side == 488 (prisms overlap)");
            okNear(vols[1], 600.0 + 30.0 * kPi + 4.0 * kPi / 3.0, 1.0e-6,
                   "case8 : CONVEX side == 600 + 30pi + 4pi/3 (3 edge wedges + 1 ball octant)");
        }
    }
    {
        // case 9 — the CLOSED boundary of a 10 x 6 x 4 box (what UNFOLD(BOX) hands
        // THICKEN). A closed sheet thickens to a skin with a VOID, so the result
        // has TWO shells. Closed forms, a=10 b=6 c=4:
        //   outward  V = 2(ab+bc+ca)t + pi(a+b+c)t^2 + (4/3)pi t^3   (Steiner)
        //   inward   V = abc - (a-2t)(b-2t)(c-2t)
        const double a = 10.0, b = 6.0, c = 4.0, t9 = 1.0;
        std::vector<TopoDS_Face> fs;
        TopoDS_Shape box;
        {
            // six outward quads, sewn
            const gp_Pnt p[8] = {gp_Pnt(0,0,0), gp_Pnt(a,0,0), gp_Pnt(a,b,0), gp_Pnt(0,b,0),
                                 gp_Pnt(0,0,c), gp_Pnt(a,0,c), gp_Pnt(a,b,c), gp_Pnt(0,b,c)};
            fs.push_back(quadFace(p[0], p[3], p[2], p[1]));   // z=0
            fs.push_back(quadFace(p[4], p[5], p[6], p[7]));   // z=c
            fs.push_back(quadFace(p[0], p[1], p[5], p[4]));   // y=0
            fs.push_back(quadFace(p[2], p[3], p[7], p[6]));   // y=b
            fs.push_back(quadFace(p[0], p[4], p[7], p[3]));   // x=0
            fs.push_back(quadFace(p[1], p[2], p[6], p[5]));   // x=a
            box = sewShell(fs);
        }
        ok(!box.IsNull(), "case9 : the closed box sheet sewed");
        std::vector<double> vols;
        for (double t : {t9, -t9}) {
            const std::string lab = "case9 closed box sheet t=" + std::to_string(t);
            const double v = abCase(lab, box, t);
            if (v > 0.0) {
                vols.push_back(v);
                const TopoDS_Shape nat = forge::occtthicken::thickenShell(box, t);
                if (!nat.IsNull()) okInt(observe(nat).nS, 2, lab + " : a skin with a VOID has TWO shells");
            }
        }
        ok(vols.size() == 2, "case9 : BOTH sides of the closed sheet build");
        if (vols.size() == 2) {
            std::sort(vols.begin(), vols.end());
            okNear(vols[0], a * b * c - (a - 2 * t9) * (b - 2 * t9) * (c - 2 * t9), 1.0e-6,
                   "case9 : INWARD == abc - (a-2t)(b-2t)(c-2t) = 176");
            okNear(vols[1], 2 * (a * b + b * c + c * a) * t9 + kPi * (a + b + c) * t9 * t9 +
                                4.0 / 3.0 * kPi * t9 * t9 * t9, 1.0e-6,
                   "case9 : OUTWARD == Steiner 2(ab+bc+ca)t + pi(a+b+c)t^2 + 4/3 pi t^3");
        }
    }
    {
        // case 10 — an OPEN box (no lid), 10 x 6 base, 4 high. The 4 floor corners
        // are closed 3-face fans; the 4 rim corners have only 2 faces. Outward:
        //   V = t(ab + 2ac + 2bc) + (pi/4)t^2(2a + 2b + 4c) + 4 * (pi/6) t^3
        const double a = 10.0, b = 6.0, c = 4.0;
        const gp_Pnt p[8] = {gp_Pnt(0,0,0), gp_Pnt(a,0,0), gp_Pnt(a,b,0), gp_Pnt(0,b,0),
                             gp_Pnt(0,0,c), gp_Pnt(a,0,c), gp_Pnt(a,b,c), gp_Pnt(0,b,c)};
        std::vector<TopoDS_Face> fs;
        fs.push_back(quadFace(p[0], p[3], p[2], p[1]));
        fs.push_back(quadFace(p[0], p[1], p[5], p[4]));
        fs.push_back(quadFace(p[2], p[3], p[7], p[6]));
        fs.push_back(quadFace(p[0], p[4], p[7], p[3]));
        fs.push_back(quadFace(p[1], p[2], p[6], p[5]));
        const TopoDS_Shape tray = sewShell(fs);
        ok(!tray.IsNull(), "case10 : the open box sheet sewed");
        const double t10 = 1.0;
        const double outward = t10 * (a * b + 2 * a * c + 2 * b * c) +
                               kPi / 4.0 * t10 * t10 * (2 * a + 2 * b + 4 * c) +
                               4.0 * kPi / 6.0 * t10 * t10 * t10;
        std::vector<double> vols;
        for (double t : {t10, -t10}) {
            const double v = abCase("case10 open box t=" + std::to_string(t), tray, t);
            if (v > 0.0) vols.push_back(v);
        }
        ok(vols.size() == 2, "case10 : BOTH sides of the open box build");
        if (vols.size() == 2) {
            std::sort(vols.begin(), vols.end());
            okNear(vols[1], outward, 1.0e-6,
                   "case10 : OUTWARD == t(ab+2ac+2bc) + (pi/4)t^2(2a+2b+4c) + 4(pi/6)t^3");
        }
    }
    {
        // case 11 — a NON-ORTHOGONAL 4-face apex: the four sides of a square
        // pyramid (base 20, height 10, no base face). The apex is a closed 4-fan
        // with dihedral angles that are not right angles, so the wedge's solid
        // angle is not a textbook fraction — OCCT is the reference.
        const gp_Pnt apex(0, 0, 10);
        const gp_Pnt q[4] = {gp_Pnt(-10,-10,0), gp_Pnt(10,-10,0), gp_Pnt(10,10,0), gp_Pnt(-10,10,0)};
        std::vector<TopoDS_Face> fs;
        for (int i = 0; i < 4; ++i) {
            BRepBuilderAPI_MakePolygon tri(q[i], q[(i + 1) % 4], apex, Standard_True);
            fs.push_back(BRepBuilderAPI_MakeFace(tri.Wire(), Standard_True).Face());
        }
        const TopoDS_Shape pyr = sewShell(fs);
        ok(!pyr.IsNull(), "case11 : the pyramid sheet sewed");
        // Which side is convex depends on how the sew oriented the sheet, so ask:
        // exactly one side builds (the convex apex, A/B'd against OCCT) and the other
        // (a concave apex of four non-perpendicular faces) declines BY NAME. That
        // decline is MEASURED to be necessary: union-of-prisms gave 527.099639 there
        // against OCCT's 526.628234.
        int built = 0, declinedConcave = 0;
        for (double t : {1.0, -1.0}) {
            if (forge::occtthicken::thickenShell(pyr, t).IsNull()) {
                if (std::string(forge::occtthicken::thickenLastDeferReason()).find(
                        "not mutually perpendicular") != std::string::npos)
                    ++declinedConcave;
                continue;
            }
            if (abCase("case11 square-pyramid apex t=" + std::to_string(t), pyr, t) > 0.0) ++built;
        }
        ok(built == 1, "case11 : the CONVEX 4-face apex builds and matches OCCT");
        ok(declinedConcave == 1,
           "case11 : the CONCAVE 4-face apex DECLINES, naming the non-perpendicular corner");
    }
    {
        // case 12 — a NON-ORTHOGONAL 3-face corner: three faces of a regular
        // tetrahedron around one vertex (dihedral acos(1/3) = 70.53 deg).
        const double s = 10.0;
        const gp_Pnt v0(0, 0, 0), v1(s, 0, 0), v2(s / 2, s * std::sqrt(3.0) / 2, 0),
                     v3(s / 2, s * std::sqrt(3.0) / 6, s * std::sqrt(2.0 / 3.0));
        std::vector<TopoDS_Face> fs;
        for (const auto& tri : {std::array<gp_Pnt, 3>{v0, v1, v3},
                                std::array<gp_Pnt, 3>{v1, v2, v3},
                                std::array<gp_Pnt, 3>{v2, v0, v3}}) {
            BRepBuilderAPI_MakePolygon poly(tri[0], tri[1], tri[2], Standard_True);
            fs.push_back(BRepBuilderAPI_MakeFace(poly.Wire(), Standard_True).Face());
        }
        const TopoDS_Shape tet = sewShell(fs);
        ok(!tet.IsNull(), "case12 : the tetrahedral corner sheet sewed");
        // The concave side has ACUTE folds (70.53 degrees): MEASURED union-of-prisms
        // 102.414132 with material at y = -0.47, behind the y=0 face, against OCCT's
        // 92.096206. It must decline, by name.
        int built = 0, declinedAcute = 0;
        for (double t : {1.0, -1.0}) {
            if (forge::occtthicken::thickenShell(tet, t).IsNull()) {
                if (std::string(forge::occtthicken::thickenLastDeferReason()).find(
                        "acute concave fold") != std::string::npos)
                    ++declinedAcute;
                continue;
            }
            if (abCase("case12 tetrahedral apex t=" + std::to_string(t), tet, t) > 0.0) ++built;
        }
        ok(built == 1, "case12 : the CONVEX tetrahedral apex builds and matches OCCT");
        ok(declinedAcute == 1,
           "case12 : the CONCAVE side (acute folds) DECLINES, naming the acute fold");
    }
    {
        // case 13 — the FOLD-ANGLE sweep that located the acute-fold defect. A V of
        // two 10x10 plates at 60/90/120/150 degrees, both sides. MEASURED before the
        // acute rule: every row matched OCCT except the 60-degree CONCAVE side
        // (native 188.452995, bbox z down to -0.5; OCCT 182.679492). So: 90/120/150
        // must match OCCT on both sides; 60 must match on its convex side and
        // DECLINE on its concave side.
        for (double deg : {60.0, 90.0, 120.0, 150.0}) {
            const double th = deg * kPi / 180.0;
            std::vector<TopoDS_Face> fs;
            fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
            const gp_Pnt b1(10.0 * std::cos(th), 0, 10.0 * std::sin(th));
            fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0),
                                  gp_Pnt(b1.X(), 10, b1.Z()), b1));
            const TopoDS_Shape vf = sewShell(fs);
            int built = 0, declined = 0;
            for (double t : {1.0, -1.0}) {
                const std::string lab = "case13 V " + std::to_string(static_cast<int>(deg)) +
                                        "deg t=" + std::to_string(t);
                if (deg < 90.0 && forge::occtthicken::thickenShell(vf, t).IsNull()) {
                    if (std::string(forge::occtthicken::thickenLastDeferReason()).find(
                            "acute concave fold") != std::string::npos)
                        ++declined;
                    continue;
                }
                if (abCase(lab, vf, t) > 0.0) ++built;
            }
            if (deg < 90.0) {
                ok(built == 1, "case13 : the 60-degree V builds on its CONVEX side");
                ok(declined == 1, "case13 : the 60-degree V DECLINES on its CONCAVE side, naming it");
            } else {
                ok(built == 2, "case13 : a " + std::to_string(static_cast<int>(deg)) +
                               "-degree V builds on BOTH sides");
            }
        }
    }
    {
        // (c) THE DECLINE THAT REMAINS: a SADDLE corner. The closed boundary of an
        // L-shaped block has two re-entrant vertices where one fold is CONCAVE
        // and two are CONVEX. The ball octant is not the missing piece there and
        // nothing else is built for it, so BOTH sides must decline, by name.
        const gp_Pnt L[6] = {gp_Pnt(0,0,0), gp_Pnt(20,0,0), gp_Pnt(20,0,10),
                             gp_Pnt(10,0,10), gp_Pnt(10,0,20), gp_Pnt(0,0,20)};
        const double depth = 10.0;
        std::vector<TopoDS_Face> fs;
        {
            BRepBuilderAPI_MakePolygon front, back;
            for (const gp_Pnt& p : L) { front.Add(p); back.Add(p.Translated(gp_Vec(0, depth, 0))); }
            front.Close(); back.Close();
            fs.push_back(BRepBuilderAPI_MakeFace(front.Wire(), Standard_True).Face());
            fs.push_back(BRepBuilderAPI_MakeFace(back.Wire(), Standard_True).Face());
            for (int i = 0; i < 6; ++i) {
                const gp_Pnt& p0 = L[i]; const gp_Pnt& p1 = L[(i + 1) % 6];
                fs.push_back(quadFace(p0, p1, p1.Translated(gp_Vec(0, depth, 0)),
                                      p0.Translated(gp_Vec(0, depth, 0))));
            }
        }
        const TopoDS_Shape lblock = sewShell(fs);
        ok(!lblock.IsNull(), "defer(c) : the L-block boundary sewed");
        const bool plus  = forge::occtthicken::thickenShell(lblock, T).IsNull();
        const std::string rPlus = forge::occtthicken::thickenLastDeferReason();
        const bool minus = forge::occtthicken::thickenShell(lblock, -T).IsNull();
        const std::string rMinus = forge::occtthicken::thickenLastDeferReason();
        std::printf("  [defer(c)] t=+2 reason '%s' ; t=-2 reason '%s'\n",
                    rPlus.c_str(), rMinus.c_str());
        ok(plus && minus, "defer(c) : a SADDLE corner is DECLINED on BOTH sides");
        const std::string want = "not convex at every fold";
        ok(plus && minus && rPlus.find(want) != std::string::npos &&
               rMinus.find(want) != std::string::npos,
           "defer(c) : and the reason NAMES the saddle");
    }
    {
        // (c2) an OPEN fan: three plates at the origin where two share edges with
        // the first but not with each other (one rises, one falls). A convex fold
        // reaches a 3-face vertex that has free rim edges — declined by name.
        std::vector<TopoDS_Face> fs;
        fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
        fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
        fs.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, -10), gp_Pnt(10, 0, -10), gp_Pnt(10, 0, 0)));
        const TopoDS_Shape fan = sewShell(fs);
        ok(!fan.IsNull(), "defer(c2) : the open fan sewed");
        const bool plus  = forge::occtthicken::thickenShell(fan, T).IsNull();
        const std::string rPlus = forge::occtthicken::thickenLastDeferReason();
        const bool minus = forge::occtthicken::thickenShell(fan, -T).IsNull();
        const std::string rMinus = forge::occtthicken::thickenLastDeferReason();
        std::printf("  [defer(c2)] t=+2 reason '%s' ; t=-2 reason '%s'\n",
                    rPlus.c_str(), rMinus.c_str());
        const std::string want = "free rim";
        ok((plus && rPlus.find(want) != std::string::npos) ||
               (minus && rMinus.find(want) != std::string::npos),
           "defer(c2) : an OPEN-fan convex corner is DECLINED, naming the free rim");
    }

    {
        // case 14 — AN INWARD THICKNESS PAST A FACE'S EXTENT (DERIVATION 5a). Before
        // the rule, thicken_corner_parity_gate MEASURED these shipping as success:
        // UNFOLD(BOX(60,40,2)) inward by 5 -> V=19200, bbox z down to -3 (below the
        // sheet); the 10 mm cube corner inward by 50 -> V=13000, bbox -40..10. No
        // skin of that thickness exists, so each must DECLINE, naming it; and just
        // short of the event the same inputs must still BUILD and match OCCT.
        const double a = 10.0, b = 6.0, c = 4.0;
        const gp_Pnt p[8] = {gp_Pnt(0,0,0), gp_Pnt(a,0,0), gp_Pnt(a,b,0), gp_Pnt(0,b,0),
                             gp_Pnt(0,0,c), gp_Pnt(a,0,c), gp_Pnt(a,b,c), gp_Pnt(0,b,c)};
        std::vector<TopoDS_Face> fs;
        fs.push_back(quadFace(p[0], p[3], p[2], p[1]));
        fs.push_back(quadFace(p[4], p[5], p[6], p[7]));
        fs.push_back(quadFace(p[0], p[1], p[5], p[4]));
        fs.push_back(quadFace(p[2], p[3], p[7], p[6]));
        fs.push_back(quadFace(p[0], p[4], p[7], p[3]));
        fs.push_back(quadFace(p[1], p[2], p[6], p[5]));
        const TopoDS_Shape box = sewShell(fs);
        // Which sign is inward depends on the sew; ask the engine at a thickness
        // both sides build, then pick the side whose volume is the INWARD closed form.
        const double vPlus = [&] { const TopoDS_Shape s = forge::occtthicken::thickenShell(box, 1.0);
                                   GProp_GProps g; if (!s.IsNull()) BRepGProp::VolumeProperties(s, g);
                                   return s.IsNull() ? 0.0 : g.Mass(); }();
        const double inSign = std::fabs(vPlus - (a * b * c - (a - 2) * (b - 2) * (c - 2))) < 1.0e-6 ? 1.0 : -1.0;
        const double tNear = 1.9;   // c - 2t = 0.2 > 0: the 4 mm faces survive
        const double vNear = abCase("case14 closed box INWARD t=1.9 (just short of the event)", box, inSign * tNear);
        okNear(vNear, a * b * c - (a - 2 * tNear) * (b - 2 * tNear) * (c - 2 * tNear), 1.0e-6,
               "case14 : INWARD t=1.9 == abc - (a-2t)(b-2t)(c-2t)");
        for (double tt : {2.0, 2.5, 5.0}) {
            const std::string lab = "case14 closed box INWARD t=" + std::to_string(tt);
            ok(forge::occtthicken::thickenShell(box, inSign * tt).IsNull(),
               lab + " : DECLINED (the 4 mm faces are consumed; no skin exists)");
            okReason("the thickness CONSUMES A FACE: on the concave side a fold trims the offset of "
                     "a neighbouring face down to nothing, so no skin of this thickness exists (use a "
                     "thinner thickness, or thicken to the other side)", lab);
        }
        // the three-plate corner of case 8, plates 10: inward by 12 declines, by 9 builds
        std::vector<TopoDS_Face> cf;
        cf.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
        cf.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
        cf.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 10), gp_Pnt(10, 0, 10), gp_Pnt(10, 0, 0)));
        const TopoDS_Shape corner = sewShell(cf);
        int declinedFar = 0, builtFarConvex = 0;
        for (double sgn : {1.0, -1.0}) {
            const TopoDS_Shape s9 = forge::occtthicken::thickenShell(corner, sgn * 9.0);
            const TopoDS_Shape s12 = forge::occtthicken::thickenShell(corner, sgn * 12.0);
            if (s12.IsNull()) {
                if (std::string(forge::occtthicken::thickenLastDeferReason()).find("CONSUMES A FACE") !=
                    std::string::npos)
                    ++declinedFar;
                // the same (concave) side just short of the event: exact, 3*10^2*9 - 3*9^2*10 + 9^3
                ok(!s9.IsNull(), "case14 : the concave corner side at t=9 (< plate 10) still BUILDS");
                if (!s9.IsNull()) {
                    GProp_GProps g;
                    BRepGProp::VolumeProperties(s9, g);
                    okNear(g.Mass(), 3.0 * 100.0 * 9.0 - 3.0 * 81.0 * 10.0 + 729.0, 1.0e-6,
                           "case14 : concave corner t=9 == 3*A*t - 3*t^2*L + t^3");
                }
            } else {
                ++builtFarConvex;
                abCase("case14 three-plate corner CONVEX t=12 (past the plate size)", corner, sgn * 12.0);
            }
        }
        ok(declinedFar == 1, "case14 : the CONCAVE corner at t=12 (> plate 10) DECLINES, naming the consumed face");
        ok(builtFarConvex == 1, "case14 : the CONVEX corner at t=12 still builds (the outward body is exact at any t)");
    }
    {
        // case 15 — A PRISM THROUGH ANOTHER PART OF THE SHEET (DERIVATION 5b). Two
        // parallel 10x10 plates 1 apart, no shared edge: at t = 2 each plate's prism
        // passes through the other plate, the fused body is ONE solid of 300 mm^3 and
        // every earlier self-check passes (300 is inside [200, 400]). The sheet is
        // buried inside its own body; it must DECLINE on both sides, naming it.
        std::vector<TopoDS_Face> pf;
        pf.push_back(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
        pf.push_back(quadFace(gp_Pnt(0, 0, 1), gp_Pnt(10, 0, 1), gp_Pnt(10, 10, 1), gp_Pnt(0, 10, 1)));
        const TopoDS_Shape two = sewShell(pf);
        for (double tt : {2.0, -2.0}) {
            const std::string lab = "case15 stacked plates t=" + std::to_string(tt);
            ok(forge::occtthicken::thickenShell(two, tt).IsNull(),
               lab + " : DECLINED (a prism passes through the other plate)");
            okReason("a face prism PASSES THROUGH another part of the sheet (the sheet is buried "
                     "inside its own thickened body; use a thinner thickness)", lab);
        }
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
    std::printf("[ab-thicken] %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
