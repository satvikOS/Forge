// ─────────────────────────────────────────────────────────────────────────────
// plane_spline_consumer_equivalence.cpp
//
// THE QUESTION. The flip gate reds FILLING on 407 of 407 pairs where the two
// arms match on volume, area, centre of mass, all six bbox bounds and every
// face/edge/vertex/shell/solid count, and differ ONLY in B-Rep surface kind:
// native returns an exact `Geom_Plane`, OCCT's BRepOffsetAPI_MakeFilling returns
// a `Geom_BSplineSurface` over the same four line edges. The gate is right that
// they are not IDENTICAL. This binary asks the different question the design
// decision actually turns on:
//
//   Is an exact Plane a FAITHFUL REPLACEMENT for a BSplineSurface that is that
//   same plane, in the contexts that consume these faces?
//
// It answers it by MEASUREMENT, on the real pair produced by the real engines —
// never on a hand-built fixture — through four named consumers:
//
//   C1 MASS PROPERTIES  area / centre of mass / inertia of the cap face, and
//                       volume / COM of the solid it closes
//   C2 BOOLEANS         Cut, Common and Fuse of that solid against a probe box
//   C3 OFFSETS          BRepOffsetAPI_MakeThickSolid on that solid
//   C4 STEP EXPORT      STEPControl_Writer -> file -> STEPControl_Reader,
//                       round-tripped and re-measured, plus the bytes on disk
//
// and it establishes, in the SAME run, that the equivalence rule those results
// justify CANNOT be widened into "ignore surface kind": every quadric is put
// through BRepBuilderAPI_NurbsConvert and the certificate is required to REFUSE
// each one. Those refusals are the whole safety argument, so they are measured
// here rather than asserted in prose.
//
// Exit 0 iff every assertion holds. Every number it prints is measured in-run.
// ─────────────────────────────────────────────────────────────────────────────

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <sys/stat.h>

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_NurbsConvert.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GProp_PrincipalProps.hxx>
#include <gp_Mat.hxx>
#include <GeomAbs_Shape.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Interface_Static.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Trsf.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <Poly_Triangulation.hxx>
#include <TopLoc_Location.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "forge/OcctPrimBuilder.hpp"
#include "forge/native/brep/NativeFilling.hpp"
#include "planar_surface_certificate.hpp"

using forge::planarcert::PlanarCert;
using forge::planarcert::certify;

namespace {

int g_bad = 0;
int g_checks = 0;

void check(const char* what, bool ok, const char* detail = "") {
    ++g_checks;
    if (!ok) ++g_bad;
    std::printf("  [%s] %-58s %s\n", ok ? " ok " : "FAIL", what, detail);
}

// ── an observable VECTOR, never a single scalar. This repo has four measured
//    cases where a wrong solid matched the right volume, and one where no
//    single observable caught it.
struct Obs {
    bool   ok = false;
    int    valid = -1;
    int    nf = 0, ne = 0, nv = 0, nsh = 0, nso = 0;
    double vol = 0, area = 0;
    double com[3] = {0, 0, 0};
    double bb[6]  = {0, 0, 0, 0, 0, 0};   // Bnd_Box-free: vertex-derived
    // THE INERTIA MATRIX, not the principal moments. GProp_PrincipalProps
    // requires an eigen-decomposition, and on a symmetric part two principal
    // moments are EQUAL, so the eigenvectors are not unique and the returned
    // moments are perturbed by whatever the solver does with a degenerate
    // subspace. Measured here: a square prism read 1.34e-08 apart on principal
    // moments where every basis-fixed observable agreed to 1e-12. The matrix
    // is basis-fixed and well conditioned, so it is a STRICTER observable that
    // is also a correct one — the principal form was measuring the eigensolver.
    double im[6] = {0, 0, 0, 0, 0, 0};   // Ixx Iyy Izz Ixy Ixz Iyz
    int    fk[11] = {0};
};

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    o.ok = true;
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE, m);   o.nf = m.Extent();
    for (int i = 1; i <= m.Extent(); ++i) {
        int k = static_cast<int>(GeomAbs_OtherSurface);
        try {
            BRepAdaptor_Surface ad(TopoDS::Face(m(i)), Standard_False);
            const int t = static_cast<int>(ad.GetType());
            if (t >= 0 && t <= static_cast<int>(GeomAbs_OtherSurface)) k = t;
        } catch (...) {}
        o.fk[k]++;
    }
    m.Clear();
    TopExp::MapShapes(s, TopAbs_EDGE, m);   o.ne  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_VERTEX, m); o.nv  = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SHELL, m);  o.nsh = m.Extent(); m.Clear();
    TopExp::MapShapes(s, TopAbs_SOLID, m);  o.nso = m.Extent(); m.Clear();

    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { o.bb[0] = o.bb[3] = p.X(); o.bb[1] = o.bb[4] = p.Y();
                     o.bb[2] = o.bb[5] = p.Z(); first = false; }
        else {
            o.bb[0] = std::min(o.bb[0], p.X()); o.bb[3] = std::max(o.bb[3], p.X());
            o.bb[1] = std::min(o.bb[1], p.Y()); o.bb[4] = std::max(o.bb[4], p.Y());
            o.bb[2] = std::min(o.bb[2], p.Z()); o.bb[5] = std::max(o.bb[5], p.Z());
        }
    }
    GProp_GProps ga; try { BRepGProp::SurfaceProperties(s, ga); o.area = ga.Mass(); } catch (...) {}
    if (o.nso > 0) {
        GProp_GProps gv;
        try {
            BRepGProp::VolumeProperties(s, gv);
            o.vol = gv.Mass();
            const gp_Pnt c = gv.CentreOfMass();
            o.com[0] = c.X(); o.com[1] = c.Y(); o.com[2] = c.Z();
            const gp_Mat mi = gv.MatrixOfInertia();
            o.im[0] = mi(1,1); o.im[1] = mi(2,2); o.im[2] = mi(3,3);
            o.im[3] = mi(1,2); o.im[4] = mi(1,3); o.im[5] = mi(2,3);
        } catch (...) {}
    } else {
        const gp_Pnt c = ga.CentreOfMass();
        o.com[0] = c.X(); o.com[1] = c.Y(); o.com[2] = c.Z();
        try {
            const gp_Mat mi = ga.MatrixOfInertia();
            o.im[0] = mi(1,1); o.im[1] = mi(2,2); o.im[2] = mi(3,3);
            o.im[3] = mi(1,2); o.im[4] = mi(1,3); o.im[5] = mi(2,3);
        } catch (...) {}
    }
    try { BRepCheck_Analyzer an(s); o.valid = an.IsValid() ? 1 : 0; } catch (...) { o.valid = -1; }
    return o;
}

double relDiff(double a, double b) {
    const double s = std::max(std::fabs(a), std::fabs(b));
    if (s < 1e-12) return std::fabs(a - b);
    return std::fabs(a - b) / s;
}

// Worst RELATIVE difference over the whole observable vector, plus the name of
// the term that produced it, so a failure says WHICH observable moved.
struct VecDiff { double worst = 0.0; std::string term = "-"; bool bothOk = false;
                 bool kindsEqual = true; };

VecDiff compareObs(const Obs& a, const Obs& b, double lenScale) {
    VecDiff d;
    d.bothOk = a.ok && b.ok;
    if (!d.bothOk) { d.worst = 1.0; d.term = "one side absent"; return d; }
    auto take = [&](const char* nm, double x) { if (x > d.worst) { d.worst = x; d.term = nm; } };
    take("volume", relDiff(a.vol, b.vol));
    take("area",   relDiff(a.area, b.area));
    // COM and bbox are LENGTHS: normalise by the fixture's own size, not by the
    // value, so a coordinate that is legitimately ~0 does not read as a 100%
    // error (a trap this repo has hit: a centroid term that reds a valid part).
    for (int i = 0; i < 3; ++i) take("com",  std::fabs(a.com[i] - b.com[i]) / lenScale);
    for (int i = 0; i < 6; ++i) take("bbox", std::fabs(a.bb[i]  - b.bb[i])  / lenScale);
    // Off-diagonal inertia terms are legitimately ~0 on a symmetric part, so
    // they are normalised by the matrix's own SCALE rather than by their own
    // magnitude — the same trap as a COM coordinate that is legitimately zero.
    double iScale = 0.0;
    for (int i = 0; i < 6; ++i) iScale = std::max(iScale, std::max(std::fabs(a.im[i]),
                                                                  std::fabs(b.im[i])));
    if (iScale > 1e-12)
        for (int i = 0; i < 6; ++i) take("inertia", std::fabs(a.im[i] - b.im[i]) / iScale);
    if (a.nf != b.nf)   take("nfaces", 1.0);
    if (a.ne != b.ne)   take("nedges", 1.0);
    if (a.nv != b.nv)   take("nverts", 1.0);
    if (a.nsh != b.nsh) take("nshells", 1.0);
    if (a.nso != b.nso) take("nsolids", 1.0);
    if (a.valid != b.valid) take("validity", 1.0);
    for (int i = 0; i < 11; ++i) if (a.fk[i] != b.fk[i]) d.kindsEqual = false;
    return d;
}

const char* kindName(int k) {
    switch (k) {
        case GeomAbs_Plane: return "Plane";
        case GeomAbs_Cylinder: return "Cylinder";
        case GeomAbs_Cone: return "Cone";
        case GeomAbs_Sphere: return "Sphere";
        case GeomAbs_Torus: return "Torus";
        case GeomAbs_BezierSurface: return "Bezier";
        case GeomAbs_BSplineSurface: return "BSpline";
        case GeomAbs_SurfaceOfRevolution: return "SurfRev";
        case GeomAbs_SurfaceOfExtrusion: return "SurfExtr";
        case GeomAbs_OffsetSurface: return "OffsetSurf";
        default: return "Other";
    }
}

std::string kindHist(const Obs& o) {
    std::string s;
    for (int i = 0; i < 11; ++i)
        if (o.fk[i]) { if (!s.empty()) s += " "; s += kindName(i);
                       s += "x" + std::to_string(o.fk[i]); }
    return s.empty() ? "-" : s;
}

int faceKind(const TopoDS_Face& f) {
    try { return static_cast<int>(BRepAdaptor_Surface(f, Standard_False).GetType()); }
    catch (...) { return static_cast<int>(GeomAbs_OtherSurface); }
}

// ── the fixture: a box with its +Z face removed, and that face's outer wire.
struct Fixture {
    TopoDS_Shape openShell;     // the 5 remaining faces, sewn
    TopoDS_Wire  capWire;
    TopoDS_Face  originalCap;
    bool ok = false;
};

// A prism over an arbitrary planar polygon, rigidly transformed, with the far
// cap face REMOVED. The transform exists so the certificate is exercised on a
// plane whose normal is not axis-aligned: an axis-aligned-only fixture would
// leave the canonicalisation of (n, d) untested on the only inputs where it can
// go wrong.
Fixture makeOpenPrism(const std::vector<gp_Pnt>& base, double h, const gp_Trsf& t) {
    Fixture fx;
    if (base.size() < 3) return fx;
    BRepBuilderAPI_MakePolygon poly;
    for (const gp_Pnt& p : base) poly.Add(p);
    poly.Close();
    if (!poly.IsDone()) return fx;
    BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True);
    if (!mf.IsDone()) return fx;
    TopoDS_Shape solid;
    try { solid = forge::occtPrism(mf.Face(), gp_Vec(0, 0, h)); } catch (...) {}
    if (solid.IsNull()) return fx;
    if (t.Form() != gp_Identity) {
        try { BRepBuilderAPI_Transform tr(solid, t, Standard_True); solid = tr.Shape(); }
        catch (...) { return fx; }
    }
    gp_Dir up(0, 0, 1);
    up.Transform(t);
    TopoDS_Face top;
    double bestD = -1e300;
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        GProp_GProps g; BRepGProp::SurfaceProperties(f, g);
        const gp_Pnt c = g.CentreOfMass();
        const double dd = c.X() * up.X() + c.Y() * up.Y() + c.Z() * up.Z();
        if (dd > bestD) { bestD = dd; top = f; }
    }
    if (top.IsNull()) return fx;
    fx.originalCap = top;
    fx.capWire = BRepTools::OuterWire(top);
    BRepBuilderAPI_Sewing sew(1e-7);
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next())
        if (!ex.Current().IsSame(top)) sew.Add(ex.Current());
    sew.Perform();
    fx.openShell = sew.SewedShape();
    fx.ok = !fx.capWire.IsNull() && !fx.openShell.IsNull();
    return fx;
}

// Sew a cap onto the open shell and make a solid — the production consumer
// (forge::heal::autoFillMissingFaces closes an open shell with exactly this
// cap, so this is the call chain the FILLING family actually feeds).
TopoDS_Shape closeWithCap(const TopoDS_Shape& openShell, const TopoDS_Shape& cap) {
    if (openShell.IsNull() || cap.IsNull()) return TopoDS_Shape();
    BRepBuilderAPI_Sewing sew(1e-6);
    sew.Add(openShell);
    sew.Add(cap);
    sew.Perform();
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return TopoDS_Shape();
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        try {
            BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(ex.Current()));
            if (mk.IsDone()) return mk.Solid();
        } catch (...) {}
    }
    return sewed;
}

long fileSize(const char* p) { struct stat st; return ::stat(p, &st) == 0 ? (long)st.st_size : -1L; }

bool fileContains(const char* p, const char* needle) {
    std::FILE* f = std::fopen(p, "rb");
    if (!f) return false;
    std::string all;
    char buf[65536]; size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) all.append(buf, n);
    std::fclose(f);
    return all.find(needle) != std::string::npos;
}

int countOccurrences(const char* p, const char* needle) {
    std::FILE* f = std::fopen(p, "rb");
    if (!f) return -1;
    std::string all;
    char buf[65536]; size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) all.append(buf, n);
    std::fclose(f);
    int c = 0; size_t pos = 0;
    while ((pos = all.find(needle, pos)) != std::string::npos) { ++c; pos += std::strlen(needle); }
    return c;
}

bool stepRoundTrip(const TopoDS_Shape& s, const char* path, TopoDS_Shape& back) {
    if (s.IsNull()) return false;
    STEPControl_Writer w;
    Interface_Static::SetCVal("write.step.schema", "AP214IS");
    if (w.Transfer(s, STEPControl_AsIs) != IFSelect_RetDone) return false;
    if (w.Write(path) != IFSelect_RetDone) return false;
    STEPControl_Reader r;
    if (r.ReadFile(path) != IFSelect_RetDone) return false;
    r.TransferRoots();
    back = r.OneShape();
    return !back.IsNull();
}

const char* TMPDIR_ = nullptr;
std::string tmpPath(const char* name) {
    return std::string(TMPDIR_ ? TMPDIR_ : "/tmp") + "/" + name;
}

// ── C5: tessellation. A plane meshes to two triangles; a spline over the same
//    boundary does not have to. This is a REAL consumer (STL/3MF export, the
//    viewport, any downstream mesh tool), and it is the one place these two
//    faces are NOT expected to be identical — so it is measured and reported
//    rather than asserted equal. The mesh VOLUME is compared against the exact
//    analytic volume, because a difference in triangle COUNT is a cost and a
//    difference in mesh volume is an ERROR, and they must not be confused.
struct MeshObs { bool ok = false; int tris = 0, nodes = 0; double vol = 0.0; };

MeshObs meshOf(const TopoDS_Shape& s, double deflection) {
    MeshObs m;
    if (s.IsNull()) return m;
    try {
        BRepMesh_IncrementalMesh im(s, deflection, Standard_False, 0.5, Standard_False);
        im.Perform();
    } catch (...) { return m; }
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(f, loc);
        if (tri.IsNull()) continue;
        m.tris  += tri->NbTriangles();
        m.nodes += tri->NbNodes();
        const bool rev = (f.Orientation() == TopAbs_REVERSED);
        for (int i = 1; i <= tri->NbTriangles(); ++i) {
            int a, b, c;
            tri->Triangle(i).Get(a, b, c);
            if (rev) std::swap(b, c);
            const gp_Pnt p1 = tri->Node(a).Transformed(loc.Transformation());
            const gp_Pnt p2 = tri->Node(b).Transformed(loc.Transformation());
            const gp_Pnt p3 = tri->Node(c).Transformed(loc.Transformation());
            const gp_Vec v1(p1.X(), p1.Y(), p1.Z());
            const gp_Vec v2(p2.X(), p2.Y(), p2.Z());
            const gp_Vec v3(p3.X(), p3.Y(), p3.Z());
            m.vol += v1.Dot(v2.Crossed(v3)) / 6.0;
        }
    }
    m.ok = m.tris > 0;
    return m;
}


// ── C6: THE REPO'S OWN SURFACE-KIND PREDICATES ──────────────────────────────
// The four consumers above are OCCT's. This one is ours, and it is the only
// place where the two caps are NOT interchangeable — so it is measured rather
// than argued, and in the direction that matters.
//
// SIX sites in this tree reject a face whose surface is not a Geom_Plane, by
// TYPE and nothing else:
//     forge-kernel/src/DirectEdit.cpp:370          pushPullFace  (throws)
//     forge-kernel/src/OcctImport.cpp:850                        (returns false)
//     forge-kernel/src/OcctImport.cpp:2009                       (rejects)
//     forge-kernel/src/OcctPrimBuilder.cpp:458                   (returns false)
//     forge-kernel/src/native/brep/NativeLoftPipe.cpp:1436       (DEFERs)
//     forge-kernel/src/native/brep/NativeLoftPipe.cpp:1576       (DEFERs)
// and one site classifies by type for the user:
//     forge-kernel/src/DirectModeling.cpp:754/783  Plane -> Boss "planar",
//                                                  BSpline -> Blend "freeform"
//
// A SEVENTH SITE ALREADY MADE THIS EXACT CORRECTION, and its comment is the
// precedent for this whole change — forge-kernel/src/native/brep/
// NativeFilletChamfer.cpp:118-137, measured 2026-07-31:
//   "a `GeomAbs_Plane` test alone is NOT a planarity test, it is a
//    REPRESENTATION test, and it silently deleted capability."
// It kept the fast path for a true Geom_Plane and otherwise verified planarity
// BY SAMPLING. That is the same predicate this change generalises.
//
// Both predicates are reimplemented here — the representation test as those six
// sites write it, and the sampling test as NativeFilletChamfer writes it — and
// applied to both caps. The direction of the result is the whole point.
bool repoRepresentationTest(const TopoDS_Face& f) {   // DirectEdit.cpp:370 et al
    try { return BRepAdaptor_Surface(f).GetType() == GeomAbs_Plane; } catch (...) { return false; }
}

bool repoSamplingTest(const TopoDS_Face& f) {         // NativeFilletChamfer.cpp:137
    try {
        BRepAdaptor_Surface as(f);
        if (as.GetType() == GeomAbs_Plane) return true;
        const double u0 = as.FirstUParameter(), u1 = as.LastUParameter();
        const double v0 = as.FirstVParameter(), v1 = as.LastVParameter();
        if (!std::isfinite(u0) || !std::isfinite(u1) ||
            !std::isfinite(v0) || !std::isfinite(v1)) return false;
        if (!(u1 - u0 > 1e-12) || !(v1 - v0 > 1e-12)) return false;
        gp_Pnt P; gp_Vec dU, dV;
        as.D1(0.5 * (u0 + u1), 0.5 * (v0 + v1), P, dU, dV);
        return dU.Crossed(dV).Magnitude() > 1e-12;
    } catch (...) { return false; }
}

const char* repoFeatureLabel(const TopoDS_Face& f) {  // DirectModeling.cpp:754/783
    int k = -1;
    try { k = static_cast<int>(BRepAdaptor_Surface(f).GetType()); } catch (...) {}
    if (k == GeomAbs_Plane) return "Boss/planar";
    if (k == GeomAbs_BSplineSurface || k == GeomAbs_BezierSurface ||
        k == GeomAbs_SurfaceOfExtrusion || k == GeomAbs_SurfaceOfRevolution)
        return "Blend/freeform";
    return "other";
}

// One case = one boundary shape. Sections 0..6 run per case so the claim is
// never made from a single square.
struct CaseOut {
    std::string name;
    bool ok = false;
    Fixture fx;
    TopoDS_Shape natCap, occCap;
    PlanarCert cn, co;
    double tol = 0.0, lenScale = 0.0;
    double worstConsumer = 0.0;
    std::string worstTerm = "-";
    double natBoolResid = 0.0, occBoolResid = 0.0;
    double planeInvWorst = 0.0;
    bool repoRepNative = false, repoRepOcct = false;
    bool repoSamNative = false, repoSamOcct = false;
    int  natTris = 0, occTris = 0;
    long natStepBytes = 0, occStepBytes = 0;
    int  natSplinesInStep = 0, occSplinesInStep = 0;
};

CaseOut runCase(const char* name, const std::vector<gp_Pnt>& base, double h,
                const gp_Trsf& t, double exactCapArea) {
    CaseOut R;
    R.name = name;
    std::printf("\n══════════════════════════════════════════════════════════════════════\n");
    std::printf("CASE: %s\n", name);
    std::printf("══════════════════════════════════════════════════════════════════════\n");

    R.fx = makeOpenPrism(base, h, t);
    char lbl[192];
    std::snprintf(lbl, sizeof lbl, "%s: fixture built", name);
    check(lbl, R.fx.ok);
    if (!R.fx.ok) return R;

    const Obs shellObs = observe(R.fx.openShell);
    R.lenScale = std::max(1.0, std::sqrt(
        (shellObs.bb[3] - shellObs.bb[0]) * (shellObs.bb[3] - shellObs.bb[0]) +
        (shellObs.bb[4] - shellObs.bb[1]) * (shellObs.bb[4] - shellObs.bb[1]) +
        (shellObs.bb[5] - shellObs.bb[2]) * (shellObs.bb[5] - shellObs.bb[2])));
    // The SAME tolerance the corpus A/B's FILLING row passes to the native
    // engine (test/corpus_ab_coverage.cpp: 1.0e-6 * max(1, part.diag)). Copied,
    // not chosen, so this experiment measures the harness's own tolerance.
    R.tol = 1.0e-6 * R.lenScale;

    R.natCap = forge::occtfill::fillC0Boundary(R.fx.capWire, R.tol);
    {
        BRepOffsetAPI_MakeFilling filling;
        for (TopExp_Explorer ex(R.fx.capWire, TopAbs_EDGE); ex.More(); ex.Next())
            filling.Add(TopoDS::Edge(ex.Current()), GeomAbs_C0);
        filling.Build();
        if (filling.IsDone()) R.occCap = filling.Shape();
    }
    std::snprintf(lbl, sizeof lbl, "%s: both arms returned a cap", name);
    check(lbl, !R.natCap.IsNull() && !R.occCap.IsNull());
    if (R.natCap.IsNull() || R.occCap.IsNull()) return R;

    TopoDS_Face natF, occF;
    { TopExp_Explorer e(R.natCap, TopAbs_FACE); if (e.More()) natF = TopoDS::Face(e.Current()); }
    { TopExp_Explorer e(R.occCap, TopAbs_FACE); if (e.More()) occF = TopoDS::Face(e.Current()); }
    if (natF.IsNull() || occF.IsNull()) {
        std::snprintf(lbl, sizeof lbl, "%s: both caps are a face", name);
        check(lbl, false);
        return R;
    }
    const int natK = faceKind(natF), occK = faceKind(occF);
    char kb[160]; std::snprintf(kb, sizeof kb, "native=%s occt=%s", kindName(natK), kindName(occK));
    std::snprintf(lbl, sizeof lbl, "%s: reproduces the Plane-vs-BSpline mismatch", name);
    check(lbl, natK == GeomAbs_Plane && occK == GeomAbs_BSplineSurface, kb);

    // ── 1. certificate. tolAng is 1.0 here ON PURPOSE: this section MEASURES
    //    angMax on real geometry so the gate's angular threshold can be set
    //    from data. Nothing is asserted against a chosen angle.
    R.cn = certify(natF, R.tol, 1.0);
    R.co = certify(occF, R.tol, 1.0);
    std::printf("  cert native kind=%-9s planar=%d devMax=%.6e angMax=%.6e nsamp=%3d "
                "n=(%+.12f,%+.12f,%+.12f) d=%+.12f\n",
                kindName(R.cn.rawKind), (int)R.cn.planar, R.cn.devMax, R.cn.angMax,
                R.cn.nsamp, R.cn.n[0], R.cn.n[1], R.cn.n[2], R.cn.d);
    std::printf("  cert occt   kind=%-9s planar=%d devMax=%.6e angMax=%.6e nsamp=%3d "
                "n=(%+.12f,%+.12f,%+.12f) d=%+.12f\n",
                kindName(R.co.rawKind), (int)R.co.planar, R.co.devMax, R.co.angMax,
                R.co.nsamp, R.co.n[0], R.co.n[1], R.co.n[2], R.co.d);
    const double dn = std::sqrt((R.cn.n[0] - R.co.n[0]) * (R.cn.n[0] - R.co.n[0]) +
                                (R.cn.n[1] - R.co.n[1]) * (R.cn.n[1] - R.co.n[1]) +
                                (R.cn.n[2] - R.co.n[2]) * (R.cn.n[2] - R.co.n[2]));
    // SAMENESS IS ASSERTED ON THE SIGN-INVARIANT MOMENTS, not on the canonical
    // (n, d) printed above. The canonical form has a sign threshold in it, and a
    // normal component landing either side of that threshold would make two
    // identical planes read as opposite. The invariants are products of two
    // sign-flipping factors, so no threshold exists to straddle. The canonical
    // pair is still printed, because it is what a reader can check by eye.
    double invN[10], invO[10];
    forge::planarcert::invariants(R.cn.n, R.cn.d, invN);
    forge::planarcert::invariants(R.co.n, R.co.d, invO);
    double invWorst = 0.0;
    for (int k = 0; k < 10; ++k) invWorst = std::max(invWorst, std::fabs(invN[k] - invO[k]));
    std::printf("  |dn|=%.6e  |dd|=%.6e  worst plane invariant %.6e "
                "(tolLen=%.4g, lenScale=%.6g)\n",
                dn, std::fabs(R.cn.d - R.co.d), invWorst, R.tol, R.lenScale);
    R.planeInvWorst = invWorst;
    std::snprintf(lbl, sizeof lbl, "%s: OCCT spline certifies planar", name);
    check(lbl, R.co.planar);
    // The invariants carry units up to length-squared, so the bound is scaled by
    // the fixture's own size the way close_() scales every length in the gate.
    std::snprintf(lbl, sizeof lbl, "%s: certifies as THE SAME plane (invariants)", name);
    check(lbl, invWorst <= 1e-6 * R.lenScale * R.lenScale);

    auto note = [&](const VecDiff& d) {
        if (d.worst > R.worstConsumer) { R.worstConsumer = d.worst; R.worstTerm = d.term; }
    };

    // ── 2. C1 mass properties of the cap face.
    const Obs fnat = observe(R.natCap), focc = observe(R.occCap);
    const VecDiff dFace = compareObs(fnat, focc, R.lenScale); note(dFace);
    std::printf("  C1 face      nat area=%.12g com=(%.9g,%.9g,%.9g) | "
                "occ area=%.12g com=(%.9g,%.9g,%.9g) | worst %.3e (%s)\n",
                fnat.area, fnat.com[0], fnat.com[1], fnat.com[2],
                focc.area, focc.com[0], focc.com[1], focc.com[2],
                dFace.worst, dFace.term.c_str());
    if (exactCapArea > 0)
        std::printf("  C1 face      exact area %.12g ; native err %.3e ; occt err %.3e\n",
                    exactCapArea, std::fabs(fnat.area - exactCapArea),
                    std::fabs(focc.area - exactCapArea));

    // ── 3. the solid each cap closes.
    const TopoDS_Shape natSolid = closeWithCap(R.fx.openShell, R.natCap);
    const TopoDS_Shape occSolid = closeWithCap(R.fx.openShell, R.occCap);
    const Obs snat = observe(natSolid), socc = observe(occSolid);
    const VecDiff dSolid = compareObs(snat, socc, R.lenScale); note(dSolid);
    std::printf("  C1 solid     nat vol=%.12g valid=%d f/e/v/sh/so=%d/%d/%d/%d/%d kinds=%s\n",
                snat.vol, snat.valid, snat.nf, snat.ne, snat.nv, snat.nsh, snat.nso,
                kindHist(snat).c_str());
    std::printf("  C1 solid     occ vol=%.12g valid=%d f/e/v/sh/so=%d/%d/%d/%d/%d kinds=%s\n",
                socc.vol, socc.valid, socc.nf, socc.ne, socc.nv, socc.nsh, socc.nso,
                kindHist(socc).c_str());
    std::printf("  C1 solid     worst %.3e (%s)\n", dSolid.worst, dSolid.term.c_str());
    std::snprintf(lbl, sizeof lbl, "%s: both caps close a VALID single solid", name);
    check(lbl, snat.valid == 1 && socc.valid == 1 && snat.nso == 1 && socc.nso == 1);
    std::snprintf(lbl, sizeof lbl, "%s: C1 mass properties agree to 1e-9", name);
    check(lbl, dFace.bothOk && dFace.worst <= 1e-9 && dSolid.bothOk && dSolid.worst <= 1e-9);

    // ── 4. C2 booleans.
    const Obs pbb = observe(natSolid);
    const gp_Pnt lo(pbb.bb[0] + 0.4 * (pbb.bb[3] - pbb.bb[0]),
                    pbb.bb[1] + 0.4 * (pbb.bb[4] - pbb.bb[1]),
                    pbb.bb[2] + 0.4 * (pbb.bb[5] - pbb.bb[2]));
    const gp_Pnt hi(pbb.bb[3] + 0.4 * (pbb.bb[3] - pbb.bb[0]),
                    pbb.bb[4] + 0.4 * (pbb.bb[4] - pbb.bb[1]),
                    pbb.bb[5] + 0.4 * (pbb.bb[5] - pbb.bb[2]));
    const TopoDS_Solid probe = forge::occtBoxSolid(lo, hi);
    struct BoolCase { const char* nm; TopoDS_Shape n, o; };
    std::vector<BoolCase> bools(3);
    bools[0].nm = "Cut";    bools[1].nm = "Common"; bools[2].nm = "Fuse";
    try { BRepAlgoAPI_Cut    b(natSolid, probe); b.Build(); if (b.IsDone()) bools[0].n = b.Shape(); } catch (...) {}
    try { BRepAlgoAPI_Cut    b(occSolid, probe); b.Build(); if (b.IsDone()) bools[0].o = b.Shape(); } catch (...) {}
    try { BRepAlgoAPI_Common b(natSolid, probe); b.Build(); if (b.IsDone()) bools[1].n = b.Shape(); } catch (...) {}
    try { BRepAlgoAPI_Common b(occSolid, probe); b.Build(); if (b.IsDone()) bools[1].o = b.Shape(); } catch (...) {}
    try { BRepAlgoAPI_Fuse   b(natSolid, probe); b.Build(); if (b.IsDone()) bools[2].n = b.Shape(); } catch (...) {}
    try { BRepAlgoAPI_Fuse   b(occSolid, probe); b.Build(); if (b.IsDone()) bools[2].o = b.Shape(); } catch (...) {}
    double vN[3] = {0, 0, 0}, vO[3] = {0, 0, 0};
    int bi = 0;
    for (const auto& c : bools) {
        const Obs a = observe(c.n), b = observe(c.o);
        vN[bi] = a.vol; vO[bi] = b.vol; ++bi;
        const VecDiff d = compareObs(a, b, R.lenScale); note(d);
        std::printf("  C2 %-7s  nat vol=%-18.12g valid=%d f=%-3d | occ vol=%-18.12g valid=%d f=%-3d"
                    " | worst %.3e (%s) kindsEq=%d\n",
                    c.nm, a.vol, a.valid, a.nf, b.vol, b.valid, b.nf,
                    d.worst, d.term.c_str(), (int)d.kindsEqual);
        std::snprintf(lbl, sizeof lbl, "%s: boolean %s valid on both arms", name, c.nm);
        check(lbl, a.ok && b.ok && a.valid == 1 && b.valid == 1);
        std::snprintf(lbl, sizeof lbl, "%s: boolean %s agrees to 1e-7", name, c.nm);
        check(lbl, d.bothOk && d.worst <= 1e-7);
    }

    // ── 4b. THE CLOSED FORM. The pairwise comparison above says how far apart
    //    the two arms are; it cannot say WHICH ONE IS RIGHT, and on this
    //    fixture they are not always equally right. Two identities hold for ANY
    //    two solids, exactly, independent of shape:
    //          vol(A\B) + vol(A^B) == vol(A)
    //          vol(A|B) + vol(A^B) == vol(A) + vol(B)
    //    so each arm can be scored against ARITHMETIC rather than against the
    //    other arm. That is the oracle the A/B does not have, and it is where
    //    the design question is actually settled: a faithful replacement must
    //    be no further from the closed form than the thing it replaces.
    {
        const Obs pobs = observe(probe);
        const double vs_n = snat.vol, vs_o = socc.vol, vp = pobs.vol;
        auto resCut  = [&](const double v[3], double vs) {
            return std::fabs(v[0] + v[1] - vs) / std::fabs(vs); };
        auto resFuse = [&](const double v[3], double vs) {
            return std::fabs(v[2] + v[1] - vs - vp) / std::fabs(vs); };
        const double rn1 = resCut(vN, vs_n), ro1 = resCut(vO, vs_o);
        const double rn2 = resFuse(vN, vs_n), ro2 = resFuse(vO, vs_o);
        std::printf("  C2 closed-form residual |Cut+Common-A|/A   native %.17e   occt %.17e\n", rn1, ro1);
        std::printf("  C2 closed-form residual |Fuse+Common-A-B|/A native %.17e   occt %.17e\n", rn2, ro2);
        R.natBoolResid = std::max(rn1, rn2);
        R.occBoolResid = std::max(ro1, ro2);
        // NOT "the residual is zero". It is not: OCCT's boolean engine leaves a
        // residual of its own on these prisms (the walls are SurfaceOfExtrusion,
        // not Plane), and on four of the five shapes BOTH ARMS CARRY THE SAME
        // RESIDUAL TO EVERY PRINTED DIGIT — which is itself the evidence that
        // the residual is the engine's and not the cap's. The claim that can be
        // made, and is asserted, is COMPARATIVE: the plane arm is never the
        // worse of the two.
        std::snprintf(lbl, sizeof lbl,
                      "%s: the plane arm is NO FURTHER from the closed form than the spline arm",
                      name);
        char det[192];
        std::snprintf(det, sizeof det, "native %.6e vs occt %.6e (ratio %.4f)",
                      R.natBoolResid, R.occBoolResid,
                      R.occBoolResid > 0 ? R.natBoolResid / R.occBoolResid : 1.0);
        // THE EPSILON IS MEASURED. On the four shapes where the residual is the
        // boolean engine's own, the two arms differ by AT MOST 1.9e-15 absolute
        // on residuals of order 1e-8 — floating-point summation noise, and the
        // SIGN of that difference flips between Cut and Fuse within one shape,
        // which is what noise looks like and what a systematic effect does not.
        // 1e-14 is five times the largest observed excess and six orders below
        // the residuals being compared.
        check(lbl, R.natBoolResid <= R.occBoolResid + 1e-14, det);
        // THE NON-VACUOUS HALF. On the axis-aligned square the boolean engine
        // handles the walls exactly, so the whole residual IS the cap — and
        // there the two arms separate by seven orders. Without this the
        // comparative check above could be passing only because both arms are
        // identical everywhere, which would prove nothing.
        if (R.name == "square") {
            std::snprintf(det, sizeof det, "plane %.4e, spline %.4e, ratio %.3g",
                          R.natBoolResid, R.occBoolResid,
                          R.natBoolResid > 0 ? R.occBoolResid / R.natBoolResid : 0.0);
            check("square: where the walls are exact, the PLANE arm is exact and the "
                  "SPLINE arm is not", R.natBoolResid < 1e-12 && R.occBoolResid > 1e-10, det);
        }
    }

    // ── 5. C3 offset.
    auto thicken = [&](const TopoDS_Shape& s) -> TopoDS_Shape {
        try {
            TopTools_ListOfShape none;
            BRepOffsetAPI_MakeThickSolid mk;
            mk.MakeThickSolidByJoin(s, none, 0.1 * R.lenScale, 1.0e-4);
            mk.Build();
            if (mk.IsDone()) return mk.Shape();
        } catch (...) {}
        return TopoDS_Shape();
    };
    {
        const Obs a = observe(thicken(natSolid)), b = observe(thicken(occSolid));
        const VecDiff d = compareObs(a, b, R.lenScale); note(d);
        std::printf("  C3 offset    nat vol=%-16.10g valid=%d f=%-3d kinds=%s\n",
                    a.vol, a.valid, a.nf, kindHist(a).c_str());
        std::printf("  C3 offset    occ vol=%-16.10g valid=%d f=%-3d kinds=%s\n",
                    b.vol, b.valid, b.nf, kindHist(b).c_str());
        std::printf("  C3 offset    worst %.3e (%s) kindsEq=%d\n",
                    d.worst, d.term.c_str(), (int)d.kindsEqual);
        // 1e-7, and the number is printed: the worst MEASURED value over the
        // five boundary shapes is 3.527e-09, on the non-convex L, in
        // BRepOffset's own area — not in the cap. A threshold below what the
        // incumbent engine reproduces against itself would be a wrong gate.
        std::snprintf(lbl, sizeof lbl, "%s: C3 offset agrees to 1e-7", name);
        check(lbl, d.bothOk && d.worst <= 1e-7);
    }

    // ── 6. C4 STEP.
    {
        const std::string pn = tmpPath((std::string("psce_nat_") + name + ".step").c_str());
        const std::string po = tmpPath((std::string("psce_occ_") + name + ".step").c_str());
        TopoDS_Shape natBack, occBack;
        const bool wn = stepRoundTrip(natSolid, pn.c_str(), natBack);
        const bool wo = stepRoundTrip(occSolid, po.c_str(), occBack);
        std::snprintf(lbl, sizeof lbl, "%s: C4 STEP round-trips on both arms", name);
        check(lbl, wn && wo);
        if (wn && wo) {
            const Obs a = observe(natBack), b = observe(occBack);
            const VecDiff d = compareObs(a, b, R.lenScale); note(d);
            R.natStepBytes = fileSize(pn.c_str()); R.occStepBytes = fileSize(po.c_str());
            R.natSplinesInStep = countOccurrences(pn.c_str(), "B_SPLINE_SURFACE");
            R.occSplinesInStep = countOccurrences(po.c_str(), "B_SPLINE_SURFACE");
            std::printf("  C4 STEP      nat bytes=%-7ld splines=%-3d vol=%.12g valid=%d kinds=%s\n",
                        R.natStepBytes, R.natSplinesInStep, a.vol, a.valid, kindHist(a).c_str());
            std::printf("  C4 STEP      occ bytes=%-7ld splines=%-3d vol=%.12g valid=%d kinds=%s\n",
                        R.occStepBytes, R.occSplinesInStep, b.vol, b.valid, kindHist(b).c_str());
            std::printf("  C4 STEP      worst %.3e (%s) kindsEq=%d\n",
                        d.worst, d.term.c_str(), (int)d.kindsEqual);
            std::snprintf(lbl, sizeof lbl, "%s: C4 round-tripped vectors agree to 1e-9", name);
            check(lbl, d.bothOk && d.worst <= 1e-9);
            std::snprintf(lbl, sizeof lbl, "%s: C4 native STEP carries NO B_SPLINE_SURFACE", name);
            check(lbl, R.natSplinesInStep == 0);
            std::snprintf(lbl, sizeof lbl, "%s: C4 OCCT STEP DOES carry one", name);
            check(lbl, R.occSplinesInStep >= 1);
            std::remove(pn.c_str()); std::remove(po.c_str());
        }
    }

    // ── 6b. C5 tessellation — REPORTED, and only the mesh ERROR is asserted.
    {
        const double defl = 0.001 * R.lenScale;
        const MeshObs mn = meshOf(natSolid, defl), mo = meshOf(occSolid, defl);
        R.natTris = mn.tris; R.occTris = mo.tris;
        const double exactVol = snat.vol;
        std::printf("  C5 mesh      defl=%.4g  nat tris=%-6d nodes=%-6d meshvol=%.10g (err %.3e)\n",
                    defl, mn.tris, mn.nodes, mn.vol, std::fabs(mn.vol - exactVol));
        std::printf("  C5 mesh      %*s occ tris=%-6d nodes=%-6d meshvol=%.10g (err %.3e)\n",
                    (int)std::strlen("defl=0.01732 "), "", mo.tris, mo.nodes, mo.vol,
                    std::fabs(mo.vol - exactVol));
        std::snprintf(lbl, sizeof lbl, "%s: C5 both arms tessellate", name);
        check(lbl, mn.ok && mo.ok);
        std::snprintf(lbl, sizeof lbl, "%s: C5 mesh volume error < 1e-6 relative on both", name);
        check(lbl, mn.ok && mo.ok &&
                   std::fabs(mn.vol - exactVol) <= 1e-6 * std::fabs(exactVol) &&
                   std::fabs(mo.vol - exactVol) <= 1e-6 * std::fabs(exactVol));
    }

    // ── 6c. C6 the repo's own predicates.
    {
        const bool nRep = repoRepresentationTest(natF), oRep = repoRepresentationTest(occF);
        const bool nSam = repoSamplingTest(natF),        oSam = repoSamplingTest(occF);
        std::printf("  C6 repo      representation test (`GetType()==GeomAbs_Plane`, 6 sites): "
                    "native %s, occt %s\n", nRep ? "ACCEPT" : "REJECT", oRep ? "ACCEPT" : "REJECT");
        std::printf("  C6 repo      sampling test (NativeFilletChamfer.cpp:137): "
                    "native %s, occt %s\n", nSam ? "ACCEPT" : "REJECT", oSam ? "ACCEPT" : "REJECT");
        std::printf("  C6 repo      DirectModeling feature label: native \"%s\", occt \"%s\"\n",
                    repoFeatureLabel(natF), repoFeatureLabel(occF));
        R.repoRepNative = nRep; R.repoRepOcct = oRep;
        R.repoSamNative = nSam; R.repoSamOcct = oSam;
        // THE DIRECTION IS THE FINDING. Replacing OCCT with native is what the
        // drop does, so what would break the drop is a consumer that accepts
        // OCCT and refuses NATIVE. There is none — and there are six that do
        // the opposite. Asserted both ways round so a future change that
        // reversed it could not pass quietly.
        std::snprintf(lbl, sizeof lbl,
                      "%s: NO repo predicate accepts the OCCT spline and refuses the native plane",
                      name);
        check(lbl, !(oRep && !nRep) && !(oSam && !nSam));
        std::snprintf(lbl, sizeof lbl,
                      "%s: the representation test ACCEPTS native and REFUSES the OCCT spline",
                      name);
        check(lbl, nRep && !oRep);
        std::snprintf(lbl, sizeof lbl,
                      "%s: the SAMPLING test accepts both — which is the corrected predicate",
                      name);
        check(lbl, nSam && oSam);
    }

    R.ok = true;
    return R;
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strncmp(argv[i], "--tmp=", 6) == 0) TMPDIR_ = argv[i] + 6;

    std::printf("\n=== plane_spline_consumer_equivalence "
                "— is an exact Plane a faithful replacement for a planar BSpline? ===\n");
    std::printf("OCCT %s, built %s %s\n", "7.9", __DATE__, __TIME__);

    // Five boundaries, not one. A single axis-aligned square would leave the
    // canonicalisation of (n, d), a non-convex boundary and a many-edge boundary
    // all untested, and the corpus's FILLING row feeds the outer wire of
    // WHATEVER the largest face of a real part happens to be.
    gp_Trsf ident;
    gp_Trsf tilt;
    tilt.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 1, 0)), 0.7);
    gp_Trsf tilt2;
    tilt2.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0.3, 0.9, 0.31)), 1.1);

    std::vector<gp_Pnt> sq = {{0,0,0},{10,0,0},{10,10,0},{0,10,0}};
    std::vector<gp_Pnt> hexa;
    for (int i = 0; i < 6; ++i)
        hexa.push_back(gp_Pnt(6.0 * std::cos(i * M_PI / 3.0), 6.0 * std::sin(i * M_PI / 3.0), 0));
    // A NON-CONVEX L. MakeFilling's GeomPlate patch over a re-entrant boundary is
    // the case where a spline is most likely to leave the plane, so it is the
    // one that would break the rule if the rule were unsound.
    std::vector<gp_Pnt> ell = {{0,0,0},{12,0,0},{12,4,0},{4,4,0},{4,12,0},{0,12,0}};
    // Many short edges: a 24-gon, so the patch is built from 24 constraints.
    std::vector<gp_Pnt> poly24;
    for (int i = 0; i < 24; ++i)
        poly24.push_back(gp_Pnt(7.0 * std::cos(i * M_PI / 12.0), 7.0 * std::sin(i * M_PI / 12.0), 0));

    auto shoelace = [](const std::vector<gp_Pnt>& p) {
        double a = 0.0;
        for (size_t i = 0; i < p.size(); ++i) {
            const gp_Pnt& q = p[i]; const gp_Pnt& r = p[(i + 1) % p.size()];
            a += q.X() * r.Y() - r.X() * q.Y();
        }
        return std::fabs(a) * 0.5;
    };

    std::vector<CaseOut> cases;
    cases.push_back(runCase("square",       sq,     10.0, ident, shoelace(sq)));
    cases.push_back(runCase("square_tilt",  sq,     10.0, tilt,  shoelace(sq)));
    cases.push_back(runCase("hexagon",      hexa,    8.0, ident, shoelace(hexa)));
    cases.push_back(runCase("L_nonconvex",  ell,     9.0, tilt2, shoelace(ell)));
    cases.push_back(runCase("polygon24",    poly24,  5.0, ident, shoelace(poly24)));

    // The fixture the negative controls below reuse (they need a real
    // MakeFilling patch and its native counterpart).
    const CaseOut& C0 = cases[0];
    Fixture fx = C0.fx;
    const TopoDS_Shape occCap = C0.occCap;
    const PlanarCert cn = C0.cn;
    const double tol = C0.tol;
    const double DX = 10.0, DY = 10.0, DZ = 10.0;
    (void)DY;

    // ─────────────────────────────────────────────────────────────────────
    // 7. THE NEGATIVE CONTROLS — the rule must REFUSE every quadric->spline.
    //    These use BRepBuilderAPI_NurbsConvert on real primitives: that IS the
    //    substitution the kind histogram was added to catch, so it is measured
    //    on the real converter and not on a hand-written fixture.
    // ─────────────────────────────────────────────────────────────────────
    std::printf("\n--- 7. negative controls: NurbsConvert of each quadric must NOT certify ---\n");
    struct Q { const char* name; TopoDS_Shape s; };
    std::vector<Q> quads;
    quads.push_back({"cylinder r5 h10", forge::occtCylinderSolid(5.0, 10.0)});
    quads.push_back({"sphere r5",       forge::occtSphereSolid(5.0)});
    quads.push_back({"cone r5->r2 h10", forge::occtConeSolid(5.0, 2.0, 10.0)});
    quads.push_back({"torus R8 r3",     forge::occtTorusSolid(8.0, 3.0)});
    for (const auto& q : quads) {
        if (q.s.IsNull()) { check("negative control primitive built", false, q.name); continue; }
        TopoDS_Shape nurbs;
        try { BRepBuilderAPI_NurbsConvert nc(q.s, Standard_True); nurbs = nc.Shape(); } catch (...) {}
        if (nurbs.IsNull()) { check("NurbsConvert produced a shape", false, q.name); continue; }
        int nCurved = 0, nCurvedSpline = 0, nCertified = 0;
        double worstDev = 0.0, worstAng = 0.0;
        for (TopExp_Explorer ex(nurbs, TopAbs_FACE); ex.More(); ex.Next()) {
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            const PlanarCert c = certify(f, 1.0e-6 * 20.0, 1.0e-6);
            const int k = faceKind(f);
            // A planar face of the primitive (a cylinder's flat end) is planar
            // BY RIGHT and certifying it is correct. Only the CURVED faces are
            // the control, so they are separated here rather than lumped in.
            const bool wasCurved = !(std::fabs(c.devMax) <= 1e-9 && c.angMax <= 1e-9);
            if (wasCurved) {
                ++nCurved;
                if (k == GeomAbs_BSplineSurface || k == GeomAbs_BezierSurface) ++nCurvedSpline;
                worstDev = std::max(worstDev, c.devMax);
                worstAng = std::max(worstAng, c.angMax);
                if (c.planar) ++nCertified;
            }
        }
        char det[192];
        std::snprintf(det, sizeof det,
                      "%s: curved faces %d (spline-kind %d), certified planar %d, "
                      "max dev %.4g, max ang %.4g rad",
                      q.name, nCurved, nCurvedSpline, nCertified, worstDev, worstAng);
        check("NurbsConvert: every curved face REFUSED by the certificate",
              nCurved > 0 && nCertified == 0, det);
        check("NurbsConvert: the curved faces really did become splines",
              nCurvedSpline == nCurved, q.name);
    }

    // 7b. a planar spline on a DIFFERENT plane — certifies planar, must NOT be
    //     accepted as the SAME plane. This is the leak a boolean-only rule leaves.
    std::printf("\n--- 7b. a planar spline translated 0.5mm: planar, but NOT the same plane ---\n");
    {
        gp_Trsf t; t.SetTranslation(gp_Vec(0, 0, 0.5));
        TopoDS_Shape moved;
        try { BRepBuilderAPI_Transform tr(occCap, t, Standard_True); moved = tr.Shape(); } catch (...) {}
        TopoDS_Face mf;
        { TopExp_Explorer e(moved, TopAbs_FACE); if (e.More()) mf = TopoDS::Face(e.Current()); }
        if (mf.IsNull()) { check("translated spline built", false); }
        else {
            const PlanarCert cm = certify(mf, tol, 1.0e-6);
            std::printf("  translated  planar=%d d=%.9f  (native d=%.9f, delta=%.6g)\n",
                        (int)cm.planar, cm.d, cn.d, std::fabs(cm.d - cn.d));
            check("translated spline still certifies PLANAR", cm.planar);
            check("but its plane offset d differs by the translation",
                  std::fabs(std::fabs(cm.d - cn.d) - 0.5) < 1e-6);
            check("so a (n,d)-comparing rule REJECTS it",
                  !(std::fabs(cm.d - cn.d) <= tol));
        }
    }

    // 7c. THE RESOLUTION OF THE RULE, measured rather than claimed. A real
    //     MakeFilling patch is pulled off its plane by an interior point at a
    //     sweep of amplitudes. Two things are asserted:
    //       (i)  the certificate is SELF-CONSISTENT — `planar` is exactly
    //            `devMax <= tolLen && angMax <= tolAng`, so the printed numbers
    //            are the reason for the verdict and not a coincidence;
    //       (ii) every bulge at or above 1e-4 mm is REFUSED, which is the
    //            non-vacuous half.
    //     The crossover is REPORTED, not hidden: the rule inherits the
    //     harness's own 1e-6-relative tolerance and therefore accepts a patch
    //     that leaves the plane by less than that. That is the same tolerance
    //     the volume, area, COM and bbox terms already use; this rule is not
    //     permitted to be looser than the vector it sits inside, and it is not.
    std::printf("\n--- 7c. resolution: a MakeFilling patch bulged off its plane "
                "(tolLen=%.4g, tolAng=1e-6 rad) ---\n", tol);
    {
        const double tolAng = 1.0e-6;
        double smallestRefused = -1.0;
        double largestAccepted = -1.0;
        for (double bulge : {1e-7, 1e-6, 1e-5, 3e-5, 1e-4, 1e-3, 1e-2, 0.1, 1.0}) {
            TopoDS_Shape bent;
            try {
                BRepOffsetAPI_MakeFilling filling;
                for (TopExp_Explorer ex(fx.capWire, TopAbs_EDGE); ex.More(); ex.Next())
                    filling.Add(TopoDS::Edge(ex.Current()), GeomAbs_C0);
                filling.Add(gp_Pnt(DX * 0.5, DY * 0.5, DZ + bulge));
                filling.Build();
                if (filling.IsDone()) bent = filling.Shape();
            } catch (...) {}
            TopoDS_Face bf;
            { TopExp_Explorer e(bent, TopAbs_FACE); if (e.More()) bf = TopoDS::Face(e.Current()); }
            if (bf.IsNull()) { check("bulged patch built", false); continue; }
            const PlanarCert cb = certify(bf, tol, tolAng);
            std::printf("  bulge %-9.3g devMax=%.6e angMax=%.6e -> planar=%d\n",
                        bulge, cb.devMax, cb.angMax, (int)cb.planar);
            const bool want = (cb.devMax <= tol) && (cb.angMax <= tolAng);
            char det[160];
            std::snprintf(det, sizeof det, "bulge %.3g", bulge);
            check("certificate verdict == its own printed thresholds", cb.planar == want, det);
            if (cb.planar) largestAccepted = bulge;
            else if (smallestRefused < 0) smallestRefused = bulge;
            if (bulge >= 1e-4) {
                std::snprintf(det, sizeof det, "bulge %.3g mm, devMax %.4g", bulge, cb.devMax);
                check("a >=1e-4mm bulge is REFUSED", !cb.planar, det);
            }
        }
        std::printf("  MEASURED RESOLUTION: largest bulge accepted %.3g mm, "
                    "smallest refused %.3g mm (part diagonal %.4g mm)\n",
                    largestAccepted, smallestRefused, C0.lenScale);
        check("the accept/refuse boundary is bracketed by the sweep",
              largestAccepted > 0 && smallestRefused > largestAccepted);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. SUMMARY — one row per boundary shape.
    // ─────────────────────────────────────────────────────────────────────
    std::printf("\n--- 8. summary: worst consumer disagreement per boundary shape ---\n");
    std::printf("  %-13s %-12s %-12s %-11s %-9s %-9s %s\n",
                "case", "occ devMax", "occ angMax", "worst cons", "term",
                "STEP +B", "mesh tris nat/occ");
    for (const auto& c : cases) {
        if (!c.ok) { std::printf("  %-13s (case did not complete)\n", c.name.c_str()); continue; }
        std::printf("  %-13s %-12.4e %-12.4e %-11.4e %-9s %-9ld %d/%d\n",
                    c.name.c_str(), c.co.devMax, c.co.angMax, c.worstConsumer, c.worstTerm.c_str(),
                    c.occStepBytes - c.natStepBytes, c.natTris, c.occTris);
    }
    {
        double worstAll = 0.0, worstDev = 0.0, worstAng = 0.0;
        double worstNatResid = 0.0, worstOccResid = 0.0;
        for (const auto& c : cases)
            if (c.ok) {
                worstAll = std::max(worstAll, c.worstConsumer);
                worstDev = std::max(worstDev, c.co.devMax);
                worstAng = std::max(worstAng, c.co.angMax);
                worstNatResid = std::max(worstNatResid, c.natBoolResid);
                worstOccResid = std::max(worstOccResid, c.occBoolResid);
            }
        std::printf("\n  ACROSS ALL %zu BOUNDARY SHAPES: worst consumer disagreement %.4e,\n"
                    "  worst OCCT-spline planarity deviation %.4e, worst normal swing %.4e rad\n",
                    cases.size(), worstAll, worstDev, worstAng);
        // EVERY THRESHOLD BELOW IS THE MEASUREMENT PLUS HEADROOM, never a round
        // number chosen first. Measured over the five boundary shapes:
        //   worst consumer disagreement   1.123e-08  (square, boolean Cut)
        //   worst spline planarity dev    9.148e-13 mm (tilted non-convex L)
        //   worst spline normal swing     1.490e-08 rad (both tilted cases)
        // and the smallest INJECTED defect the sweep refuses sits at
        // devMax 2.068e-05 / angMax 8.296e-06, so the gate's tolLen (1e-6 x the
        // part diagonal) and tolAng (1e-6 rad) separate signal from defect by
        // seven and two orders respectively. Asserting 1e-9 here — which an
        // earlier draft did — was a GUESS, and the measurement refuted it.
        check("no consumer disagrees by more than 1e-7 on any boundary shape",
              worstAll <= 1e-7);
        check("every real OCCT spline is planar to better than 1e-11 mm", worstDev <= 1e-11);
        check("every real OCCT spline's normals swing less than 1e-7 rad", worstAng <= 1e-7);
        std::printf("  boolean closed-form residual, worst over the five shapes:"
                    " native %.4e, occt %.4e\n", worstNatResid, worstOccResid);
        check("across every shape the PLANE arm is no further from the closed form",
              worstNatResid <= worstOccResid + 1e-14);
        int repRejOcct = 0, repRejNat = 0, samBoth = 0, nOk = 0;
        for (const auto& c : cases)
            if (c.ok) {
                ++nOk;
                if (c.repoRepNative && !c.repoRepOcct) ++repRejOcct;
                if (c.repoRepOcct && !c.repoRepNative) ++repRejNat;
                if (c.repoSamNative && c.repoSamOcct) ++samBoth;
            }
        std::printf("\n  THE ONLY CONSUMER THAT DISTINGUISHES THEM IS THIS REPO'S OWN\n"
                    "  `GetType() == GeomAbs_Plane` TEST, and it distinguishes them in the\n"
                    "  direction that makes the substitution SAFE: on %d of %d shapes it accepts\n"
                    "  the native plane and REFUSES the OCCT spline; on %d it does the reverse.\n"
                    "  The sampling predicate NativeFilletChamfer.cpp:137 already uses accepts\n"
                    "  both on %d of %d.\n", repRejOcct, nOk, repRejNat, samBoth, nOk);
        check("no shape has a repo predicate that accepts OCCT and refuses native",
              repRejNat == 0);
    }

    std::printf("\n%s: %d check(s) red of %d\n", g_bad ? "FAIL" : "PASS", g_bad, g_checks);
    return g_bad ? 1 : 0;
}
