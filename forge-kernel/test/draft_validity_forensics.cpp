// draft_validity_forensics.cpp — IS THE INVALIDITY THE ENGINE'S, OR THE DRAFT'S?
//
// The general native draft (family J) returns a solid BRepCheck rejects when the
// exact drafted boundary CROSSES a wire the same face already carried. That is a
// deliberate carry (see NativeDraftLocal.cpp's gate) and it needs evidence, not a
// claim. From outside, "the engine broke the shape" and "the shape the caller
// asked for is self-crossing" are the SAME boolean. This separates them, per
// part, with two independent measurements and no inference:
//
//   1. THE STATUS MULTISET of BOTH engines' answers, walked over VERTEX / EDGE /
//      WIRE / FACE / SHELL / SOLID. A verdict is not a diagnosis: a
//      self-intersecting wire and a missing pcurve are the same boolean and
//      completely different defects. If the two engines' multisets are identical
//      the native answer carries the incumbent's own defect and nothing else.
//
//   2. THE VALIDITY THRESHOLD, bisected INDEPENDENTLY for each arm: the draft
//      angle at which that engine's answer first stops being BRepCheck-valid. Two
//      engines that are both invalid at 3 degrees have agreed once. Two engines
//      whose thresholds are the SAME ANGLE, on a part whose threshold is its own,
//      have agreed about the GEOMETRY -- the crossing is a property of the draft
//      that was requested, not of either construction.
//
// Measured over the 52 corpus parts that reach the carry: 52 distinct thresholds
// spanning 0.0433 .. 2.9835 deg, max |native - OCCT| = 0.0 at 6.1e-5 deg
// resolution, and 52 of 52 identical status multisets.
//
// usage: draft_validity_forensics <part.step> [name]
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <string>
#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_ListIteratorOfListOfStatus.hxx>
#include <BRepCheck_Result.hxx>
#include <TopExp_Explorer.hxx>
#include <map>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pln.hxx>
#include "forge/native/brep/NativeDraftLocal.hpp"

static const double kPi = 3.14159265358979323846;
static Handle(Geom_Surface) basis(const Handle(Geom_Surface)& s) {
    Handle(Geom_Surface) r = s;
    while (!r.IsNull()) { Handle(Geom_RectangularTrimmedSurface) t =
        Handle(Geom_RectangularTrimmedSurface)::DownCast(r); if (t.IsNull()) break; r = t->BasisSurface(); }
    return r;
}
static bool planeOf(const TopoDS_Face& f, gp_Pln& pl) {
    Handle(Geom_Plane) p = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
    if (p.IsNull()) return false; pl = p->Pln(); return true;
}
static double faceArea(const TopoDS_Face& f) {
    try { GProp_GProps p; BRepGProp::SurfaceProperties(f, p); return p.Mass(); } catch (...) { return 0.0; }
}
static bool betterFace(const TopoDS_Face& f, double a, const TopoDS_Face& best, double bestA) {
    if (best.IsNull()) return true;
    if (a > bestA * (1.0 + 1e-9)) return true;
    if (a < bestA * (1.0 - 1e-9)) return false;
    GProp_GProps p1, p2; BRepGProp::SurfaceProperties(f, p1); BRepGProp::SurfaceProperties(best, p2);
    gp_Pnt c1 = p1.CentreOfMass(), c2 = p2.CentreOfMass();
    if (std::fabs(c1.X()-c2.X()) > 1e-9) return c1.X() < c2.X();
    if (std::fabs(c1.Y()-c2.Y()) > 1e-9) return c1.Y() < c2.Y();
    if (std::fabs(c1.Z()-c2.Z()) > 1e-9) return c1.Z() < c2.Z();
    return false;
}
static bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    TopTools_IndexedMapOfShape mv; TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    if (mv.Extent() == 0) return false;
    for (int i = 1; i <= mv.Extent(); ++i) {
        gp_Pnt q = BRep_Tool::Pnt(TopoDS::Vertex(mv(i)));
        double v[3] = {q.X(), q.Y(), q.Z()};
        for (int k = 0; k < 3; ++k) {
            if (i == 1) { bb[k] = bb[k+3] = v[k]; }
            else { if (v[k] < bb[k]) bb[k] = v[k]; if (v[k] > bb[k+3]) bb[k+3] = v[k]; } }
    } return true;
}

static TopoDS_Shape shp;
static TopoDS_Face  wallF;
static gp_Pln       neutralP;
static bool validNative(double deg) {
    TopTools_ListOfShape fl; fl.Append(wallF);
    TopoDS_Shape s = forge::occtdraftlocal::draftFacesLocal(shp, fl, gp_Dir(0,0,1), deg*kPi/180.0, neutralP);
    if (s.IsNull()) return false;
    try { return BRepCheck_Analyzer(s).IsValid() == Standard_True; } catch (...) { return false; }
}
static bool validOcct(double deg) {
    TopoDS_Shape s;
    try {
        BRepOffsetAPI_DraftAngle mk(shp);
        mk.Add(wallF, gp_Dir(0,0,1), deg*kPi/180.0, neutralP);
        if (!mk.AddDone()) return false;
        mk.Build(); if (!mk.IsDone()) return false; s = mk.Shape();
    } catch (...) { return false; }
    if (s.IsNull()) return false;
    try { return BRepCheck_Analyzer(s).IsValid() == Standard_True; } catch (...) { return false; }
}
// The BRepCheck status MULTISET of a shape, over every sub-shape kind. Empty
// statuses are never reported as "invalid-unnamed" silently: a rejection this
// walk cannot name is printed as such, because an unnamed rejection is exactly
// the thing a carry must never be granted.
std::string statusMultiset(const TopoDS_Shape& s) {
    if (s.IsNull()) return "NULL";
    BRepCheck_Analyzer an(s);
    if (an.IsValid()) return "VALID";
    static const TopAbs_ShapeEnum kinds[] = {TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE,
                                             TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID};
    static const char* kn[] = {"V", "E", "W", "F", "SH", "SO"};
    std::map<std::string, int> t;
    for (int k = 0; k < 6; ++k)
        for (TopExp_Explorer ex(s, kinds[k]); ex.More(); ex.Next()) {
            const Handle(BRepCheck_Result) r = an.Result(ex.Current());
            if (r.IsNull()) continue;
            for (BRepCheck_ListIteratorOfListOfStatus it(r->Status()); it.More(); it.Next())
                if (it.Value() != BRepCheck_NoError)
                    t[std::string(kn[k]) + ":" + std::to_string(static_cast<int>(it.Value()))] += 1;
        }
    std::string o;
    for (const auto& kv : t) { if (!o.empty()) o += "+"; o += kv.first + "x" + std::to_string(kv.second); }
    return o.empty() ? "invalid-unnamed" : o;
}

TopoDS_Shape draftNative(double deg) {
    TopTools_ListOfShape fl; fl.Append(wallF);
    return forge::occtdraftlocal::draftFacesLocal(shp, fl, gp_Dir(0,0,1), deg*kPi/180.0, neutralP);
}
TopoDS_Shape draftOcct(double deg) {
    TopoDS_Shape s;
    try {
        BRepOffsetAPI_DraftAngle mk(shp);
        mk.Add(wallF, gp_Dir(0,0,1), deg*kPi/180.0, neutralP);
        if (!mk.AddDone()) return TopoDS_Shape();
        mk.Build(); if (!mk.IsDone()) return TopoDS_Shape(); s = mk.Shape();
    } catch (...) { return TopoDS_Shape(); }
    return s;
}

// first angle in (lo, hi] at which `f` is no longer valid; -1 if valid throughout,
// -2 if already invalid at lo.
static double threshold(bool (*f)(double), double lo, double hi, int iters) {
    if (!f(lo)) return -2.0;
    if (f(hi))  return -1.0;
    for (int i = 0; i < iters; ++i) {
        const double m = 0.5 * (lo + hi);
        if (f(m)) lo = m; else hi = m;
    }
    return 0.5 * (lo + hi);
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: draft_threshold <part.step> [name]\n"); return 2; }
    const char* name = (argc > 2) ? argv[2] : argv[1];
    STEPControl_Reader rd;
    if (rd.ReadFile(argv[1]) != IFSelect_RetDone) { std::printf("%s READ_FAIL\n", name); return 1; }
    rd.TransferRoots(); shp = rd.OneShape();
    if (shp.IsNull()) { std::printf("%s EMPTY\n", name); return 1; }
    double bb[6] = {0,0,0,0,0,0}; if (!boundsOf(shp, bb)) { std::printf("%s NOBB\n", name); return 1; }
    TopTools_IndexedMapOfShape fm; TopExp::MapShapes(shp, TopAbs_FACE, fm);
    double wa = 0.0;
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i)); const double a = faceArea(f); gp_Pln pl;
        if (!(a > 0.0)) continue;
        if (planeOf(f, pl) && std::fabs(pl.Axis().Direction().Z()) < 0.1 && betterFace(f, a, wallF, wa)) { wallF = f; wa = a; }
    }
    if (wallF.IsNull()) { std::printf("%s NOWALL\n", name); return 0; }
    neutralP = gp_Pln(gp_Pnt(0,0,bb[2]), gp_Dir(0,0,1));
    const double lo = 0.01, hi = 8.0;
    const int iters = 17;                    // 8 deg / 2^17 = 6.1e-5 deg
    const double tn = threshold(validNative, lo, hi, iters);
    const double to = threshold(validOcct,   lo, hi, iters);
    const double d = (tn > 0 && to > 0) ? std::fabs(tn - to) : -1.0;
    const std::string sn = statusMultiset(draftNative(3.0));
    const std::string so = statusMultiset(draftOcct(3.0));
    std::printf("%s native_threshold_deg=%.6f occt_threshold_deg=%.6f abs_diff_deg=%.3e "
                "nat_status=%s occt_status=%s same_status=%s\n",
                name, tn, to, d, sn.c_str(), so.c_str(), (sn == so) ? "yes" : "NO");
    return 0;
}
