// test/occt_query_tail_gate.cpp — T-148: the OCCT QUERY tail, gate.
//
// WHAT MOVED (measured on b609b41d, libforge_kernel_core.dylib, per object):
// seven OCCT symbols that each had exactly ONE owner in the kernel. The first five
// only answered a question a closed form answers:
//
//   NativeFilletChamfer.cpp  BRepAdaptor_Curve::BRepAdaptor_Curve()
//                            BRepAdaptor_Curve::Initialize(TopoDS_Edge const&)
//                            BRepAdaptor_Curve::D1(double, gp_Pnt&, gp_Vec&) const
//        -> the rim reads a ring edge's kind / window / end tangents natively
//           (readRingEdgeCurve, ringEdgeD1, ringTangents).
//   NativeDraftLocal.cpp     ElCLib::InPeriod(double, double, double)
//        -> liftIntoPeriod, written from the definition.
//   BodyInventory.cpp        BRepExtrema_DistShapeShape::Perform(...)
//        -> deleted: the two-shape constructor already performs; the explicit
//           call was a second, identical extrema search.
// and the last two were OCCT round trips the code did not need:
//   NativeDraftLocal.cpp     Geom2d_Curve::Value(double) const
//        -> the cylinder branch anchor is the pcurve's START point, which the BRep
//           already stores: BRep_Tool::UVPoints (taken by OcctNativeMesh.cpp).
//   NativeAabbBridge.cpp     Bnd_Box::Update(double x6)
//        -> the bridge hands back the native brep::Aabb3 instead of writing an
//           OCCT Bnd_Box; NativeDraftAngle.cpp reads the Aabb3.
//
// The symbol side (each .o stops demanding them, the dylib loses exactly these,
// nothing arrives, and the --assert-symbols ratchet is not inert) is checked by
// test/run_occt_query_tail_gate.sh with nm. THIS FILE checks that nothing a
// caller can observe moved:
//
//   [A] liftIntoPeriod == ElCLib::InPeriod BIT FOR BIT on ~3.7M (t, lo) pairs,
//       including every k*period boundary and its +/-1-ulp neighbours, plus the
//       huge / non-finite guard. (Tolerance: none.)
//   [B] for every edge of a fixture matrix (analytic primitives, a rounded-
//       rectangle rim, ellipse and B-spline profiles, an arc whose window lies
//       beyond 2*pi, a Geom_TrimmedCurve edge, and a TopLoc-LOCATED copy of each,
//       both orientations), the native ring-edge reader against the code it
//       replaced (BRepAdaptor_Curve, reproduced verbatim below as the oracle):
//         kind and readability  : identical
//         parameter window      : bit-identical
//         circle frame / radius : |d| <= 1e-12 (scale-relative)
//         end tangents          : |d| <= 1e-14 per component (unit vectors)
//         every G1 junction decision of every face's outer ring: identical
//       and ONE stated divergence, asserted so it cannot widen: an edge with no
//       3-D curve (p-curve only) is unreadable natively where the adaptor
//       classified its curve-on-surface.
//   [C] forge::bodyInventory (the SHIPPED dylib, black-box) against the old
//       constructor-plus-Perform distance: every pair gap BIT-identical, every
//       box bit-identical to Add+SetGap(0)+Get, plus the measured cost of the
//       removed second search.
//   [D] the AABB bridge (shipped dylib) against its own b609b41d code, reproduced
//       below as the oracle (the route that wrote a Bnd_Box through Update), with
//       FORGE_NATIVE_AABB off AND on: route taken, void flag and all six numbers
//       BIT-identical on every fixture, plus a null shape, an empty compound, a
//       bare face and a bare wire; the out-box is reset on every call.
//   [E] on every (edge, face) pair whose face is a CYLINDER (the only domain the
//       draft engine reads the anchor in): BRep_Tool::UVPoints' start point vs
//       Geom2d_Curve::Value(first), bit for bit, both edge orientations. Pairs on
//       other surfaces are REPORTED, not asserted: there the two are NOT equal in
//       general (MEASURED on the 600-part corpus: 144,948 of 562,312 such pairs
//       differ, by at most 6.85e-7; cause not established here), which is why the
//       swap is confined to the cylinder branch. Cylinders: 128,292 pairs, 0.
//   [F] NativeDraftAngle::draftFaces against CLOSED-FORM volumes, the minimal port
//       of test/native_draft_ab.mjs (READ for its semantics, never run), with the
//       AABB bridge off and on.
//
// MODES
//   (default)          run [A] [B] [C]; exit 0 iff 0 failed.
//   --corpus LIST      also run [B]'s comparison on every edge of every STEP file
//                      named in LIST (one path per line), and [C] on every
//                      multi-solid part, reporting counts.
//   --emit FILE        write the observable record (rim decisions on every
//                      fixture edge, draft curve parameters, inventory numbers)
//                      to FILE as %a hex floats, for a BEFORE/AFTER diff. With
//                      -DOCCTQ_EMIT_ONLY the file compiles against the PRE-change
//                      sources too, which is how the BEFORE record is taken
//                      (run_occt_query_tail_gate.sh, BASE_SRC=).
//
// White-box by inclusion (the idiom of cam_inwardoffset_ring_probe.cpp): the
// two engine TUs are #included so their file-local helpers are callable. The
// binary also links libforge_kernel_core for bodyInventory and the engines'
// own first-party dependencies.

#include "../src/native/brep/NativeFilletChamfer.cpp"
#include "../src/native/brep/NativeDraftLocal.cpp"

#include "forge/BodyInventoryOcct.hpp"
#include "forge/OcctImport.hpp"                       // [D] oracle: importOcctSolid
#include "forge/native/brep/Aabb.hpp"                 // [D] oracle: computeAabb
#include "forge/native/brep/NativeAabbBridge.hpp"
#include "forge/native/brep/NativeDraftAngle.hpp"     // [F] + emit: forge::occtdraft::draftFaces

#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <ElCLib.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Plane.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <STEPControl_Reader.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS_Compound.hxx>
#include <gp_Ax2.hxx>
#include <gp_Elips.hxx>
#include <gp_Trsf.hxx>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <random>
#include <string>
#include <vector>

namespace {

int g_pass = 0, g_fail = 0;

void check(bool ok, const std::string& what) {
    if (ok) { ++g_pass; return; }
    ++g_fail;
    std::printf("  [FAIL] %s\n", what.c_str());
}

std::uint64_t bitsOf(double d) { std::uint64_t b; std::memcpy(&b, &d, 8); return b; }

constexpr double kTwoPi = 6.28318530717958647692;

// ───────────────────────────────────────────────────────────────── fixtures
struct NamedShape { std::string name; TopoDS_Shape shape; };

TopoDS_Shape prismOf(const TopoDS_Wire& w, double depth) {
    const TopoDS_Face f = BRepBuilderAPI_MakeFace(w, Standard_True).Face();
    return BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, depth)).Shape();
}

// A rectangle w x h with every corner rounded to r: a cap whose outer ring is
// four lines and four quarter arcs, G1 at every junction — the rim's own input.
TopoDS_Shape roundedRectPrism(double w, double h, double r, double depth) {
    const double a = 0.5 * w, b = 0.5 * h, kHalfPi = 0.5 * M_PI;
    auto arc = [&](double cx, double cy, double t0, double t1) {
        Handle(Geom_Circle) c = new Geom_Circle(gp_Ax2(gp_Pnt(cx, cy, 0), gp::DZ()), r);
        return BRepBuilderAPI_MakeEdge(c, t0, t1).Edge();
    };
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(-a + r, -b, 0), gp_Pnt(a - r, -b, 0)).Edge());
    mw.Add(arc(a - r, -b + r, -kHalfPi, 0.0));
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(a, -b + r, 0), gp_Pnt(a, b - r, 0)).Edge());
    mw.Add(arc(a - r, b - r, 0.0, kHalfPi));
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(a - r, b, 0), gp_Pnt(-a + r, b, 0)).Edge());
    mw.Add(arc(-a + r, b - r, kHalfPi, M_PI));
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(-a, b - r, 0), gp_Pnt(-a, -b + r, 0)).Edge());
    mw.Add(arc(-a + r, -b + r, M_PI, 1.5 * M_PI));
    return prismOf(mw.Wire(), depth);
}

TopoDS_Shape ellipsePrism() {
    Handle(Geom_Ellipse) e = new Geom_Ellipse(gp_Ax2(gp_Pnt(0, 0, 0), gp::DZ()), 9.0, 4.0);
    return prismOf(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(e).Edge()).Wire(), 5.0);
}

TopoDS_Shape bsplinePrism() {
    TColgp_Array1OfPnt poles(1, 4);
    poles(1) = gp_Pnt(0, 0, 0); poles(2) = gp_Pnt(3, 6, 0);
    poles(3) = gp_Pnt(7, 6, 0); poles(4) = gp_Pnt(10, 0, 0);
    TColStd_Array1OfReal knots(1, 2); knots(1) = 0.0; knots(2) = 1.0;
    TColStd_Array1OfInteger mults(1, 2); mults(1) = 4; mults(2) = 4;
    Handle(Geom_BSplineCurve) bs = new Geom_BSplineCurve(poles, knots, mults, 3);
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(bs).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(10, 0, 0), gp_Pnt(0, 0, 0)).Edge());
    return prismOf(mw.Wire(), 4.0);
}

// A cap whose ring holds a curve the rim declines (a quarter ELLIPSE) between two
// lines, with a non-G1 corner: the one ring shape on which the rim's REASON text
// changed (the decision did not — see buildRimContext).
TopoDS_Shape ellipseCornerPrism() {
    Handle(Geom_Ellipse) e = new Geom_Ellipse(gp_Ax2(gp_Pnt(0, 0, 0), gp::DZ()), 10.0, 6.0);
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(e, 0.0, 0.5 * M_PI).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 6, 0), gp_Pnt(0, 0, 0)).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0)).Edge());
    return prismOf(mw.Wire(), 2.0);
}

// A "D": an arc whose parameter window starts BEYOND 2*pi, closed by its chord.
// Built with BRep_Builder because BRepBuilderAPI_MakeEdge would fold [7, 9.5]
// back into [0, 2*pi) and the fixture would test nothing.
TopoDS_Shape lateArcPrism() {
    Handle(Geom_Circle) c = new Geom_Circle(gp_Ax2(gp_Pnt(1, 2, 0), gp::DZ()), 6.0);
    const double t0 = 7.0, t1 = 7.0 + 2.5;
    BRep_Builder B;
    TopoDS_Vertex v0, v1;
    B.MakeVertex(v0, c->Value(t0), 1.0e-7);
    B.MakeVertex(v1, c->Value(t1), 1.0e-7);
    TopoDS_Edge ae;
    B.MakeEdge(ae, c, 1.0e-7);
    B.Add(ae, v0.Oriented(TopAbs_FORWARD));
    B.Add(ae, v1.Oriented(TopAbs_REVERSED));
    B.Range(ae, t0, t1);
    BRepBuilderAPI_MakeWire mw;
    mw.Add(ae);
    mw.Add(BRepBuilderAPI_MakeEdge(v1, v0).Edge());
    return prismOf(mw.Wire(), 3.0);
}

// A bare edge whose stored 3-D curve IS a Geom_TrimmedCurve (MakeEdge would
// unwrap it, so it is built with BRep_Builder).
TopoDS_Shape trimmedCurveEdge() {
    Handle(Geom_Circle) c = new Geom_Circle(gp_Ax2(gp_Pnt(0, 0, 1), gp::DX()), 2.5);
    Handle(Geom_TrimmedCurve) tc = new Geom_TrimmedCurve(c, 0.3, 2.0);
    BRep_Builder B;
    TopoDS_Edge e;
    B.MakeEdge(e, tc, 1.0e-7);
    B.Range(e, 0.3, 2.0);
    TopoDS_Vertex v0, v1;
    B.MakeVertex(v0, c->Value(0.3), 1.0e-7);
    B.MakeVertex(v1, c->Value(2.0), 1.0e-7);
    B.Add(e, v0.Oriented(TopAbs_FORWARD));
    B.Add(e, v1.Oriented(TopAbs_REVERSED));
    return e;
}

gp_Trsf someMotion() {
    gp_Trsf r, t;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 2, 3)), 0.7);
    t.SetTranslation(gp_Vec(5.0, -3.0, 2.0));
    return t * r;
}

std::vector<NamedShape> edgeFixtures() {
    std::vector<NamedShape> base = {
        {"box", BRepPrimAPI_MakeBox(10, 20, 30).Shape()},
        {"cylinder", BRepPrimAPI_MakeCylinder(5, 12).Shape()},
        {"cone", BRepPrimAPI_MakeCone(6, 2, 10).Shape()},
        {"sphere", BRepPrimAPI_MakeSphere(7).Shape()},
        {"torus", BRepPrimAPI_MakeTorus(10, 3).Shape()},
        {"rounded-rect", roundedRectPrism(40, 24, 3, 8)},
        {"rounded-rect-small", roundedRectPrism(9, 7, 1.25, 2)},
        {"ellipse-prism", ellipsePrism()},
        {"bspline-prism", bsplinePrism()},
        {"late-arc-prism", lateArcPrism()},
        {"ellipse-corner-prism", ellipseCornerPrism()},
        {"trimmed-curve-edge", trimmedCurveEdge()},
    };
    std::vector<NamedShape> out = base;
    const TopLoc_Location loc(someMotion());
    for (const NamedShape& s : base) out.push_back({s.name + "@located", s.shape.Moved(loc)});
    return out;
}

// ─────────────────────────────────────────────── inventory fixtures
std::vector<TopoDS_Shape> solidsOf(const TopoDS_Shape& s) {
    std::vector<TopoDS_Shape> v;
    for (TopExp_Explorer ex(s, TopAbs_SOLID); ex.More(); ex.Next()) v.push_back(ex.Current());
    return v;
}

TopoDS_Shape compoundOf(const std::vector<TopoDS_Shape>& parts) {
    BRep_Builder B;
    TopoDS_Compound c;
    B.MakeCompound(c);
    for (const TopoDS_Shape& p : parts) B.Add(c, p);
    return c;
}

std::vector<NamedShape> inventoryFixtures() {
    std::vector<NamedShape> f;
    f.push_back({"two-boxes-5mm-apart", compoundOf({BRepPrimAPI_MakeBox(10, 10, 10).Shape(),
        BRepPrimAPI_MakeBox(gp_Pnt(15, 0, 0), 10, 10, 10).Shape()})});
    f.push_back({"two-boxes-touching", compoundOf({BRepPrimAPI_MakeBox(10, 10, 10).Shape(),
        BRepPrimAPI_MakeBox(gp_Pnt(10, 0, 0), 10, 10, 10).Shape()})});
    f.push_back({"two-boxes-overlapping", compoundOf({BRepPrimAPI_MakeBox(10, 10, 10).Shape(),
        BRepPrimAPI_MakeBox(gp_Pnt(6, 3, 2), 10, 10, 10).Shape()})});
    {
        const TopoDS_Shape block = BRepPrimAPI_MakeBox(gp_Pnt(-10, -10, 0), 20, 20, 10).Shape();
        const TopoDS_Shape bore = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -1), gp::DZ()), 4, 12).Shape();
        const TopoDS_Shape bored = BRepAlgoAPI_Cut(block, bore).Shape();
        const TopoDS_Shape shaft = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -5), gp::DZ()), 4, 20).Shape();
        f.push_back({"shaft-in-bore", compoundOf({solidsOf(bored).front(), shaft})});
    }
    f.push_back({"three-spheres", compoundOf({BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 3).Shape(),
        BRepPrimAPI_MakeSphere(gp_Pnt(10, 0, 0), 4).Shape(),
        BRepPrimAPI_MakeSphere(gp_Pnt(0, 12, 5), 2).Shape()})});
    f.push_back({"cylinder-and-cone", compoundOf({BRepPrimAPI_MakeCylinder(3, 9).Shape(),
        BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(8, 1, 2), gp::DX()), 4, 1, 6).Shape()})});
    {
        const NamedShape& first = f.front();
        f.push_back({"two-boxes-located", first.shape.Moved(TopLoc_Location(someMotion()))});
    }
    return f;
}

TopoDS_Shape readStep(const std::string& path) {
    STEPControl_Reader rd;
    if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) return TopoDS_Shape();
    rd.TransferRoots();
    return rd.OneShape();
}

std::vector<std::string> readList(const std::string& list) {
    std::vector<std::string> v;
    std::ifstream in(list);
    std::string line;
    while (std::getline(in, line)) if (!line.empty()) v.push_back(line);
    return v;
}

// The rim's DOMAIN on an imported part: edges of a planar face whose outer ring
// has >= 3 edges and at least one circle. Every other edge is declined by the
// rim before a ring edge is read, so it cannot tell the two readers apart.
// (Selected with the adaptor, which both sides of the change share.)
std::vector<TopoDS_Edge> rimCandidates(const TopoDS_Shape& s, std::size_t cap) {
    std::vector<TopoDS_Edge> out;
    TopTools_IndexedMapOfShape seen;
    for (TopExp_Explorer fx(s, TopAbs_FACE); fx.More() && out.size() < cap; fx.Next()) {
        const TopoDS_Face f = TopoDS::Face(fx.Current());
        BRepAdaptor_Surface as(f);
        if (as.GetType() != GeomAbs_Plane) continue;
        const TopoDS_Wire ow = BRepTools::OuterWire(f);
        if (ow.IsNull()) continue;
        std::vector<TopoDS_Edge> ring;
        bool arc = false;
        for (BRepTools_WireExplorer wx(ow, f); wx.More(); wx.Next()) {
            ring.push_back(wx.Current());
            try { if (BRepAdaptor_Curve(wx.Current()).GetType() == GeomAbs_Circle) arc = true; } catch (...) {}
        }
        if (ring.size() < 3 || !arc) continue;
        for (const TopoDS_Edge& e : ring)
            if (out.size() < cap && seen.Add(e) > static_cast<int>(out.size())) out.push_back(e);
    }
    return out;
}

// ─────────────────────────── draft fixtures (shared by [E] [F] and --emit)
constexpr double kDeg = kTwoPi / 360.0;

double volumeOf(const TopoDS_Shape& s) {
    GProp_GProps gp;
    BRepGProp::VolumeProperties(s, gp);
    return gp.Mass();
}

// Outward normal of a planar face (orientation honoured), or false.
bool planeNormal(const TopoDS_Face& f, gp_Dir& n) {
    BRepAdaptor_Surface as(f);
    if (as.GetType() != GeomAbs_Plane) return false;
    n = as.Plane().Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    return true;
}

// 0-based TopExp_Explorer FACE ids — draftFaces' own face-id convention.
template <class Pred>
std::vector<std::uint32_t> faceIdsWhere(const TopoDS_Shape& s, Pred pred) {
    std::vector<std::uint32_t> ids;
    std::uint32_t i = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next(), ++i)
        if (pred(TopoDS::Face(ex.Current()))) ids.push_back(i);
    return ids;
}

std::vector<std::uint32_t> firstOf(std::vector<std::uint32_t> v) {
    if (v.size() > 1) v.resize(1);
    return v;
}

// The planar face whose outward normal is closest to d.
TopoDS_Face faceTowards(const TopoDS_Shape& s, const gp_Dir& d) {
    TopoDS_Face best;
    double bestDot = -2.0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        gp_Dir n;
        if (!planeNormal(f, n)) continue;
        if (n.Dot(d) > bestDot) { bestDot = n.Dot(d); best = f; }
    }
    return best;
}

// NativeDraftAngle (forge::occtdraft::draftFaces, the only production caller of the
// AABB bridge). The cases and their closed forms are the minimal port of
// test/native_draft_ab.mjs, which was READ for its semantics and not run.
struct AngleCase {
    std::string                name;
    TopoDS_Shape               shape;
    std::vector<std::uint32_t> faces;
    gp_Pnt                     origin;   // neutral plane through here, normal = pull = +Z
    double                     deg = 0.0;
    double                     ref = 0.0;  // closed-form volume (0 for a refusal)
    bool                       refuse = false;
};

std::vector<AngleCase> angleCases() {
    const double t3 = std::tan(3.0 * kDeg), t5 = std::tan(5.0 * kDeg);
    auto sqFrustum   = [](double h, double a, double b) { return h / 3.0 * (a * a + b * b + a * b); };
    auto coneFrustum = [](double h, double r0, double r1) {
        return M_PI * h / 3.0 * (r0 * r0 + r1 * r1 + r0 * r1);
    };
    auto plusX    = [](const TopoDS_Face& f) { gp_Dir n; return planeNormal(f, n) && n.X() > 0.9; };
    auto sideWall = [](const TopoDS_Face& f) { gp_Dir n; return planeNormal(f, n) && std::fabs(n.Z()) < 0.5; };
    auto topCap   = [](const TopoDS_Face& f) { gp_Dir n; return planeNormal(f, n) && n.Z() > 0.9; };
    auto cylFace  = [](const TopoDS_Face& f) { return BRepAdaptor_Surface(f).GetType() == GeomAbs_Cylinder; };
    auto sphFace  = [](const TopoDS_Face& f) { return BRepAdaptor_Surface(f).GetType() == GeomAbs_Sphere; };
    const gp_Pnt O(0, 0, 0);

    std::vector<AngleCase> c;
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(10, 10, 10).Shape();
    const std::vector<std::uint32_t> walls = faceIdsWhere(box, sideWall);
    c.push_back({"box one wall +3", box, firstOf(faceIdsWhere(box, plusX)), O, 3.0, 1000.0 - 500.0 * t3});
    c.push_back({"box one wall -3", box, firstOf(faceIdsWhere(box, plusX)), O, -3.0, 1000.0 + 500.0 * t3});
    c.push_back({"box four walls +5", box, walls, O, 5.0, sqFrustum(10, 10, 10 - 20 * t5)});
    c.push_back({"box four walls +5 neutral mid", box, walls, gp_Pnt(0, 0, 5), 5.0,
                 1000.0 + (1000.0 / 3.0) * t5 * t5});
    c.push_back({"box four walls +5 neutral top", box, walls, gp_Pnt(0, 0, 10), 5.0,
                 sqFrustum(10, 10 + 20 * t5, 10)});
    const TopoDS_Shape cy = BRepPrimAPI_MakeCylinder(10, 30).Shape();
    c.push_back({"cylinder wall +3", cy, firstOf(faceIdsWhere(cy, cylFace)), O, 3.0,
                 coneFrustum(30, 10, 10 - 30 * t3)});
    c.push_back({"cylinder wall -3", cy, firstOf(faceIdsWhere(cy, cylFace)), O, -3.0,
                 coneFrustum(30, 10, 10 + 30 * t3)});
    const TopoDS_Shape holed = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(40, 40, 20).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(15, 15, 0), gp::DZ()), 6, 20).Shape()).Shape();
    c.push_back({"bored block: the bore +3", holed, firstOf(faceIdsWhere(holed, cylFace)), O, 3.0,
                 32000.0 - coneFrustum(20, 6, 6 + 20 * t3)});
    c.push_back({"bored block: one outer wall +3", holed, firstOf(faceIdsWhere(holed, sideWall)), O, 3.0,
                 32000.0 - M_PI * 36.0 * 20.0 - 40.0 * 200.0 * t3});
    {   // the L-bracket: the inner flank does NOT support the solid
        ShapeUpgrade_UnifySameDomain u(BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(20, 20, 10).Shape(),
            BRepPrimAPI_MakeBox(gp_Pnt(10, 10, 0), 10, 10, 10).Shape()).Shape());
        u.Build();
        const TopoDS_Shape L = u.Shape();
        const double base = volumeOf(L);
        for (double cx : {10.0, 20.0}) {
            auto flank = [cx](const TopoDS_Face& f) {
                gp_Dir n;
                if (!planeNormal(f, n) || n.X() <= 0.9) return false;
                GProp_GProps gp;
                BRepGProp::SurfaceProperties(f, gp);
                return std::fabs(gp.CentreOfMass().X() - cx) < 1e-3;
            };
            c.push_back({cx == 10.0 ? "L-bracket inner flank x=10 +3" : "L-bracket outer flank x=20 +3",
                         L, firstOf(faceIdsWhere(L, flank)), O, 3.0, base - 500.0 * t3});
        }
    }
    c.push_back({"box top cap (refuse)", box, firstOf(faceIdsWhere(box, topCap)), O, 3.0, 0.0, true});
    const TopoDS_Shape sp = BRepPrimAPI_MakeSphere(10).Shape();
    c.push_back({"sphere wall (refuse)", sp, firstOf(faceIdsWhere(sp, sphFace)), O, 3.0, 0.0, true});
    return c;
}

TopoDS_Shape runAngleCase(const AngleCase& a, std::string& why) {
    why.clear();
    try {
        return forge::occtdraft::draftFaces(a.shape, a.origin, gp::DZ(), a.faces, a.deg * kDeg, &why);
    } catch (...) {
        why = "threw";
        return TopoDS_Shape();
    }
}

// NativeDraftLocal on the CYLINDER-NEIGHBOUR walls, where the branch anchor
// (NativeDraftLocal.cpp, "THE 2*pi BRANCH") is read: the cases (e) (f) (g) of
// test/ab_native_draft_local.cpp, rebuilt here.
struct LocalCase {
    std::string          name;
    TopoDS_Shape         shape;
    TopTools_ListOfShape faces;
    double               deg = 0.0;
};

std::vector<LocalCase> localCases() {
    std::vector<LocalCase> c;
    auto add = [&c](const std::string& name, const TopoDS_Shape& s, double deg) {
        LocalCase l{name, s, {}, deg};
        l.faces.Append(faceTowards(s, gp::DX()));
        c.push_back(l);
    };
    // (e) a bore that breaks OUT through the +X wall: an open arc on the cylinder
    add("(e) wall meets a bore", BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(20, 20, 10).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 10, -1), gp::DZ()), 4.0, 12.0).Shape()).Shape(), 5.0);
    // (f) a bore WHOLLY inside the wall: the closed rim
    add("(f) closed rim", BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(20, 20, 10).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 10, 5), gp::DX()), 3.0, 22.0).Shape()).Shape(), 5.0);
    // (g) the closed rim at the corpus's scale
    add("(g) closed rim 200x200x150 r17", BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(200, 200, 150).Shape(),
        BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 100, 75), gp::DX()), 17.0, 202.0).Shape()).Shape(), 3.0);
    return c;
}

TopoDS_Shape runLocalCase(const LocalCase& l) {
    try {
        return forge::occtdraftlocal::draftFacesLocal(l.shape, l.faces, gp::DZ(), l.deg * kDeg,
                                                      gp_Pln(gp_Pnt(0, 0, 0), gp::DZ()));
    } catch (...) {
        return TopoDS_Shape();
    }
}

// The observable record of a result shape: what a caller can measure.
void emitShape(std::FILE* o, const char* tag, const std::string& name, const TopoDS_Shape& r,
               const std::string& why) {
    if (r.IsNull()) { std::fprintf(o, "%s\t%s\t0\t%s\n", tag, name.c_str(), why.c_str()); return; }
    GProp_GProps vp, sp;
    BRepGProp::VolumeProperties(r, vp);
    BRepGProp::SurfaceProperties(r, sp);
    Bnd_Box bb;
    BRepBndLib::Add(r, bb);
    double b[6] = {0, 0, 0, 0, 0, 0};
    if (!bb.IsVoid()) bb.Get(b[0], b[1], b[2], b[3], b[4], b[5]);
    int nf = 0, ne = 0, nv = 0;
    for (TopExp_Explorer x(r, TopAbs_FACE); x.More(); x.Next()) ++nf;
    for (TopExp_Explorer x(r, TopAbs_EDGE); x.More(); x.Next()) ++ne;
    for (TopExp_Explorer x(r, TopAbs_VERTEX); x.More(); x.Next()) ++nv;
    std::fprintf(o, "%s\t%s\t1\t%a\t%a\t%a %a %a %a %a %a\t%d %d %d\n", tag, name.c_str(), vp.Mass(),
                 sp.Mass(), b[0], b[1], b[2], b[3], b[4], b[5], nf, ne, nv);
    for (TopExp_Explorer x(r, TopAbs_VERTEX); x.More(); x.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(x.Current()));
        std::fprintf(o, "%sv\t%s\t%a %a %a\n", tag, name.c_str(), p.X(), p.Y(), p.Z());
    }
}

#ifndef OCCTQ_EMIT_ONLY
// ───────────────────────────────────── [B] the ORACLE: the code that was replaced
// Reproduced from NativeFilletChamfer.cpp at b609b41d, unchanged except for its
// name. It is the reference the native reader is held to.
bool oracleRingTangents(const TopoDS_Edge& e, gp_Vec& tStart, gp_Vec& tEnd) {
    BRepAdaptor_Curve ac;
    try { ac.Initialize(e); } catch (...) { return false; }
    gp_Pnt p; gp_Vec d;
    const bool rev = (e.Orientation() == TopAbs_REVERSED);
    ac.D1(rev ? ac.LastParameter() : ac.FirstParameter(), p, d);
    if (d.Magnitude() <= forge::occtfillet::kTol) return false;
    tStart = rev ? -d : d;
    ac.D1(rev ? ac.FirstParameter() : ac.LastParameter(), p, d);
    if (d.Magnitude() <= forge::occtfillet::kTol) return false;
    tEnd = rev ? -d : d;
    tStart.Normalize(); tEnd.Normalize();
    return true;
}

struct OracleEdge {
    bool readable = false;
    GeomAbs_CurveType type = GeomAbs_OtherCurve;
    double first = 0.0, last = 0.0;
    gp_Circ circ;
};

OracleEdge oracleEdge(const TopoDS_Edge& e) {
    OracleEdge o;
    BRepAdaptor_Curve ac;
    try { ac.Initialize(e); } catch (...) { return o; }
    o.readable = true;
    o.type = ac.GetType();
    o.first = ac.FirstParameter();
    o.last = ac.LastParameter();
    if (o.type == GeomAbs_Circle) o.circ = ac.Circle();
    return o;
}

// ─────────────────────────────────────────────────────── [A] the periodic lift
void sectionA() {
    std::printf("[A] liftIntoPeriod vs ElCLib::InPeriod (bit-exact)\n");
    using forge::occtdraftlocal::liftIntoPeriod;
    const double P = kTwoPi, kPi = 0.5 * kTwoPi;
    std::vector<double> los = {0.0, -kPi, kPi, 0.5, -0.5, 5.9, -5.9, 1e-12, -1e-12, P, -P,
                               100.0, -100.0, 1e3, 4.71238898038469, 1.5707963267948966,
                               std::nextafter(0.0, 1.0), std::nextafter(P, 0.0)};
    std::vector<double> ts;
    for (double lo : los) {
        for (int k = -3; k <= 3; ++k) {
            const double b = lo + k * P;
            for (double t : {b, std::nextafter(b, 1e300), std::nextafter(b, -1e300),
                             b + 1e-15, b - 1e-15, b + 1e-9, b - 1e-9})
                ts.push_back(t);
        }
    }
    // ElCLib::Parameter on a circle or ellipse returns [0, 2*pi): the call
    // site's own input range, densely.
    for (int i = 0; i <= 4096; ++i) ts.push_back(P * i / 4096.0);
    ts.push_back(std::nextafter(P, 0.0));
    std::mt19937_64 rng(12345);
    std::uniform_real_distribution<double> U(-30.0, 30.0);
    for (int i = 0; i < 200000; ++i) ts.push_back(U(rng));

    long n = 0, diff = 0;
    for (double lo : los) {
        for (double t : ts) {
            const double occt = ElCLib::InPeriod(t, lo, lo + P);
            const double mine = liftIntoPeriod(t, lo, lo + P);
            ++n;
            if (bitsOf(occt) != bitsOf(mine)) {
                if (++diff <= 5)
                    std::printf("    t=%.17g lo=%.17g occt=%.17g native=%.17g\n", t, lo, occt, mine);
            }
        }
    }
    // The guard: OCCT returns U unchanged for |x| >= 1e100 or non-finite input.
    long guardN = 0, guardDiff = 0;
    for (double t : {1e100, -1e100, 3e120, std::numeric_limits<double>::infinity(), 1.0, 7.5}) {
        for (double lo : {0.0, 2e100, -1e101}) {
            ++guardN;
            const double occt = ElCLib::InPeriod(t, lo, lo + P);
            const double mine = liftIntoPeriod(t, lo, lo + P);
            if (bitsOf(occt) != bitsOf(mine)) ++guardDiff;
        }
    }
    std::printf("    %ld pairs, %ld differ; guard %ld cases, %ld differ\n", n, diff, guardN, guardDiff);
    check(n > 3000000, "[A] the comparison covered >3M pairs");
    check(diff == 0, "[A] liftIntoPeriod is bit-identical to ElCLib::InPeriod");
    check(guardDiff == 0, "[A] huge/non-finite inputs are returned unchanged, as ElCLib does");
}

// ─────────────────────────────────────── [B] ring-edge reader vs the adaptor
struct EdgeStats {
    long edges = 0, lineCircle = 0, other = 0, no3d = 0, junctions = 0;
    long kindDiff = 0, readDiff = 0, windowDiff = 0, tanDiff = 0, junctionDiff = 0;
    double maxTan = 0.0, maxCirc = 0.0;
};

void compareEdge(const TopoDS_Edge& e, EdgeStats& st, const std::string& where) {
    using namespace forge::occtfillet;
    ++st.edges;
    const OracleEdge o = oracleEdge(e);
    RingEdgeCurve n;
    const bool nr = readRingEdgeCurve(e, n);
    if (!nr) {
        ++st.no3d;
        // The ONE stated divergence: no 3-D curve. Anything else unreadable is a
        // regression.
        double f = 0, l = 0;
        if (!BRep_Tool::Curve(e, f, l).IsNull()) {
            ++st.readDiff;
            std::printf("    %s: native reader refused an edge that HAS a 3-D curve\n", where.c_str());
        }
        return;
    }
    if (!o.readable) { ++st.readDiff; std::printf("    %s: native read what the adaptor could not\n", where.c_str()); return; }
    const bool oLine = o.type == GeomAbs_Line, oCirc = o.type == GeomAbs_Circle;
    const bool nLine = n.kind == RingEdgeCurve::Kind::Line, nCirc = n.kind == RingEdgeCurve::Kind::Circle;
    if (oLine != nLine || oCirc != nCirc) {
        ++st.kindDiff;
        std::printf("    %s: kind differs (adaptor type %d)\n", where.c_str(), static_cast<int>(o.type));
        return;
    }
    if (bitsOf(o.first) != bitsOf(n.first) || bitsOf(o.last) != bitsOf(n.last)) {
        ++st.windowDiff;
        std::printf("    %s: window [%.17g,%.17g] vs [%.17g,%.17g]\n", where.c_str(), o.first, o.last, n.first, n.last);
    }
    if (!(oLine || oCirc)) { ++st.other; return; }
    ++st.lineCircle;
    if (oCirc) {
        // Scale-relative: the frame is the same gp_Trsf applied on both sides, so
        // any residue is rounding in the transformed coordinates.
        const double sc = std::max({1.0, o.circ.Radius(), gp_Vec(o.circ.Location().XYZ()).Magnitude()});
        const gp_Ax2& a = o.circ.Position();
        const gp_Ax2& b = n.circ.Position();
        double d = std::fabs(o.circ.Radius() - n.circ.Radius()) / sc;
        d = std::max(d, a.Location().Distance(b.Location()) / sc);
        d = std::max(d, gp_Vec(a.XDirection()).Subtracted(gp_Vec(b.XDirection())).Magnitude());
        d = std::max(d, gp_Vec(a.YDirection()).Subtracted(gp_Vec(b.YDirection())).Magnitude());
        d = std::max(d, gp_Vec(a.Direction()).Subtracted(gp_Vec(b.Direction())).Magnitude());
        st.maxCirc = std::max(st.maxCirc, d);
        if (d > 1e-12) std::printf("    %s: circle frame differs by %.3g\n", where.c_str(), d);
        check(d <= 1e-12, "[B] circle frame/radius agree to 1e-12: " + where);
    }
    gp_Vec oa, ob, na, nb;
    const bool ot = oracleRingTangents(e, oa, ob);
    const bool nt = ringTangents(e, na, nb);
    if (ot != nt) { ++st.tanDiff; std::printf("    %s: tangent success differs\n", where.c_str()); return; }
    if (!ot) return;
    const double d = std::max(oa.Subtracted(na).Magnitude(), ob.Subtracted(nb).Magnitude());
    st.maxTan = std::max(st.maxTan, d);
    if (d > 1e-14) { ++st.tanDiff; std::printf("    %s: tangent differs by %.3g\n", where.c_str(), d); }
}

// Every junction of every face's outer ring: the G1 decision the rim makes.
void compareJunctions(const TopoDS_Shape& s, EdgeStats& st, const std::string& name) {
    using namespace forge::occtfillet;
    int fi = 0;
    for (TopExp_Explorer fx(s, TopAbs_FACE); fx.More(); fx.Next(), ++fi) {
        const TopoDS_Face f = TopoDS::Face(fx.Current());
        const TopoDS_Wire ow = BRepTools::OuterWire(f);
        if (ow.IsNull()) continue;
        std::vector<TopoDS_Edge> ring;
        for (BRepTools_WireExplorer wx(ow, f); wx.More(); wx.Next()) ring.push_back(wx.Current());
        const std::size_t n = ring.size();
        for (std::size_t i = 0; i < n; ++i) {
            gp_Vec a0, a1, b0, b1, c0, c1, d0, d1;
            const bool oOk = oracleRingTangents(ring[i], a0, a1) && oracleRingTangents(ring[(i + 1) % n], b0, b1);
            const bool nOk = ringTangents(ring[i], c0, c1) && ringTangents(ring[(i + 1) % n], d0, d1);
            if (!oOk && !nOk) continue;
            ++st.junctions;
            // Where the oracle answered and the native reader declined, the edge
            // must be one the rim declines anyway (not a line / circle): the old
            // code reached the same "declined" outcome by its later type test.
            if (oOk && !nOk) {
                RingEdgeCurve r0, r1;
                const bool k0 = readRingEdgeCurve(ring[i], r0) && r0.kind != RingEdgeCurve::Kind::Other;
                const bool k1 = readRingEdgeCurve(ring[(i + 1) % n], r1) && r1.kind != RingEdgeCurve::Kind::Other;
                if (k0 && k1) {
                    ++st.junctionDiff;
                    std::printf("    %s face %d junction %zu: native declined a line/circle junction\n",
                                name.c_str(), fi, i);
                }
                continue;
            }
            if (!oOk && nOk) { ++st.junctionDiff; continue; }
            const bool oG1 = !(std::fabs(1.0 - a1.Dot(b0)) > 1e-6);
            const bool nG1 = !(std::fabs(1.0 - c1.Dot(d0)) > 1e-6);
            if (oG1 != nG1) {
                ++st.junctionDiff;
                std::printf("    %s face %d junction %zu: G1 decision differs\n", name.c_str(), fi, i);
            }
        }
    }
}

void runEdgeComparison(const TopoDS_Shape& s, const std::string& name, EdgeStats& st) {
    int ei = 0;
    for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next(), ++ei) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        compareEdge(e, st, name + " edge " + std::to_string(ei));
        compareEdge(TopoDS::Edge(e.Reversed()), st, name + " edge " + std::to_string(ei) + " reversed");
    }
    compareJunctions(s, st, name);
}

void reportEdgeStats(const EdgeStats& st, const char* label) {
    std::printf("    %s: %ld edge readings (%ld line/circle, %ld other, %ld without a 3-D curve), "
                "%ld junctions\n", label, st.edges, st.lineCircle, st.other, st.no3d, st.junctions);
    std::printf("    %s: diffs kind %ld, readability %ld, window %ld, tangent %ld, junction %ld; "
                "max |dTangent| %.3g, max circle-frame d %.3g\n", label, st.kindDiff, st.readDiff,
                st.windowDiff, st.tanDiff, st.junctionDiff, st.maxTan, st.maxCirc);
}

void sectionB() {
    std::printf("[B] native ring-edge reader vs BRepAdaptor_Curve (the replaced code)\n");
    EdgeStats st;
    long lateArcs = 0;
    for (const NamedShape& s : edgeFixtures()) {
        runEdgeComparison(s.shape, s.name, st);
        for (TopExp_Explorer ex(s.shape, TopAbs_EDGE); ex.More(); ex.Next()) {
            double f = 0, l = 0;
            if (!BRep_Tool::Curve(TopoDS::Edge(ex.Current()), f, l).IsNull() && f > kTwoPi) ++lateArcs;
        }
    }
    reportEdgeStats(st, "fixtures");
    check(st.lineCircle >= 100, "[B] the matrix exercised >= 100 line/circle edge readings");
    check(st.other > 0, "[B] the matrix includes curves the rim declines (ellipse, B-spline)");
    check(lateArcs > 0, "[B] the matrix includes an edge whose window starts beyond 2*pi");
    check(st.kindDiff == 0 && st.readDiff == 0 && st.windowDiff == 0,
          "[B] kind, readability and parameter window identical on every edge");
    check(st.tanDiff == 0, "[B] end tangents agree to 1e-14 on every line/circle edge");
    check(st.junctionDiff == 0, "[B] every G1 junction decision identical");

    // The rim on a cap whose ring carries an ellipse: declined (as before) and
    // now for the reason that is true of it.
    {
        using namespace forge::occtfillet;
        const TopoDS_Shape s = ellipseCornerPrism();
        long declined = 0, named = 0, asked = 0;
        for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next()) {
            const TopoDS_Edge e = TopoDS::Edge(ex.Current());
            RimContext rc;
            std::string why;
            ++asked;
            if (!buildRimContext(s, e, 0.5, RimKind::Fillet, rc, why)) {
                ++declined;
                if (why.find("neither line nor arc") != std::string::npos) ++named;
            }
        }
        std::printf("    ellipse-corner cap: %ld rim requests, %ld declined, %ld named 'neither line nor arc'\n",
                    asked, declined, named);
        check(declined == asked, "[B] the rim declines every edge of the ellipse-corner prism");
        check(named > 0, "[B] the decline names the ellipse, not a broken junction");
    }

    // The stated divergence, pinned: an edge carrying only a p-curve.
    {
        Handle(Geom_Plane) pl = new Geom_Plane(gp_Pnt(0, 0, 0), gp::DZ());
        Handle(Geom2d_Line) l2 = new Geom2d_Line(gp_Pnt2d(0, 0), gp_Dir2d(1, 0));
        const TopoDS_Edge e = BRepBuilderAPI_MakeEdge(l2, pl, 0.0, 5.0).Edge();
        double f = 0, l = 0;
        const bool no3d = BRep_Tool::Curve(e, f, l).IsNull();
        const OracleEdge o = oracleEdge(e);
        forge::occtfillet::RingEdgeCurve n;
        const bool nr = forge::occtfillet::readRingEdgeCurve(e, n);
        gp_Vec a, b;
        std::printf("    p-curve-only edge: 3-D curve %s; adaptor %s (type %d); native %s\n",
                    no3d ? "absent" : "PRESENT", o.readable ? "reads it" : "refuses it",
                    static_cast<int>(o.type), nr ? "reads it" : "refuses it");
        check(no3d, "[B] the p-curve-only fixture really has no 3-D curve");
        check(!nr && !forge::occtfillet::ringTangents(e, a, b),
              "[B] DIVERGENCE pinned: native refuses a p-curve-only edge (rim declines it, named)");
    }
}

// ─────────────────────────────────── [C] bodyInventory vs constructor+Perform
struct InvStats { long pairs = 0, gapDiff = 0, presenceDiff = 0, boxDiff = 0, bodies = 0; };

void compareInventory(const TopoDS_Shape& shape, const std::string& name, InvStats& st,
                      std::size_t maxPairs = 32) {
    forge::BodyInventoryOptions opt;
    opt.maxPairs = maxPairs;
    const forge::BodyInventory inv = forge::bodyInventory(shape, opt);
    const std::vector<TopoDS_Shape> solids = solidsOf(shape);
    st.bodies += static_cast<long>(inv.bodies.size());
    for (std::size_t i = 0; i < inv.bodies.size() && i < solids.size(); ++i) {
        Bnd_Box bb;
        BRepBndLib::Add(solids[i], bb);
        bb.SetGap(0.0);
        double r[6] = {0, 0, 0, 0, 0, 0};
        if (!bb.IsVoid()) bb.Get(r[0], r[1], r[2], r[3], r[4], r[5]);
        const forge::SolidBody& b = inv.bodies[i];
        for (int c = 0; c < 3; ++c)
            if (bitsOf(b.bboxMin[c]) != bitsOf(r[c]) || bitsOf(b.bboxMax[c]) != bitsOf(r[c + 3])) {
                ++st.boxDiff;
                std::printf("    %s body %zu: box differs\n", name.c_str(), i + 1);
                break;
            }
    }
    for (const forge::SolidBodyPair& p : inv.pairs) {
        ++st.pairs;
        BRepExtrema_DistShapeShape ref(solids[p.a - 1], solids[p.b - 1]);
        ref.Perform();   // the replaced spelling: constructor, then a second search
        if (!ref.IsDone()) { ++st.presenceDiff; continue; }
        if (bitsOf(ref.Value()) != bitsOf(p.gap)) {
            ++st.gapDiff;
            std::printf("    %s pair %u-%u: gap %.17g vs %.17g\n", name.c_str(), p.a, p.b, p.gap, ref.Value());
        }
    }
}

void sectionC() {
    std::printf("[C] bodyInventory (shipped dylib) vs constructor+Perform\n");
    InvStats st;
    for (const NamedShape& s : inventoryFixtures()) compareInventory(s.shape, s.name, st);
    std::printf("    %ld bodies, %ld pairs; diffs gap %ld, presence %ld, box %ld\n",
                st.bodies, st.pairs, st.gapDiff, st.presenceDiff, st.boxDiff);
    check(st.pairs >= 8, "[C] at least 8 measured pairs");
    check(st.gapDiff == 0 && st.presenceDiff == 0, "[C] every pair gap bit-identical to constructor+Perform");
    check(st.boxDiff == 0, "[C] every body box bit-identical to Add+SetGap(0)+Get");

    // What the deleted second search cost (information, not an assertion).
    const std::vector<TopoDS_Shape> s2 = solidsOf(inventoryFixtures()[0].shape);
    const int reps = 40;
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < reps; ++i) { BRepExtrema_DistShapeShape d(s2[0], s2[1]); d.Perform(); (void)d.Value(); }
    auto t1 = std::chrono::steady_clock::now();
    for (int i = 0; i < reps; ++i) { BRepExtrema_DistShapeShape d(s2[0], s2[1]); (void)d.Value(); }
    auto t2 = std::chrono::steady_clock::now();
    const double before = std::chrono::duration<double, std::milli>(t1 - t0).count() / reps;
    const double after = std::chrono::duration<double, std::milli>(t2 - t1).count() / reps;
    std::printf("    per-pair cost, two 10 mm boxes: constructor+Perform %.3f ms, constructor only %.3f ms\n",
                before, after);
}

// ─────────────────────────────────── [D] the AABB bridge vs its b609b41d code
// THE ORACLE: shapeAabbNative as it stood at b609b41d, reproduced verbatim except
// for its name — the route that wrote the caller's Bnd_Box, pushing the analytic
// box in through Bnd_Box::Update. It reads the same process-wide gate.
bool oracleBridge(const TopoDS_Shape& shape, Bnd_Box& box) {
    using namespace forge::native::brep;
    if (forgeNativeAabbEnabled() && !shape.IsNull()) {
        bool haveNative = false;
        double b[6] = {0, 0, 0, 0, 0, 0};
        try {
            forge::ImportResult ir = forge::importOcctSolid(shape);
            if (ir.ok && ir.solid != nullptr) {
                const Aabb3 a = computeAabb(*ir.solid);
                if (!a.void_) {
                    b[0] = a.minX; b[1] = a.minY; b[2] = a.minZ;
                    b[3] = a.maxX; b[4] = a.maxY; b[5] = a.maxZ;
                    haveNative = true;
                    for (int i = 0; i < 6; ++i)
                        if (!std::isfinite(b[i])) haveNative = false;
                    for (int i = 0; i < 3; ++i)
                        if (b[i] > b[i + 3]) haveNative = false;
                }
            }
        } catch (...) {
            haveNative = false;
        }
        if (haveNative) {
            box.Update(b[0], b[1], b[2], b[3], b[4], b[5]);
            return true;
        }
    }
    BRepBndLib::Add(shape, box);
    return false;
}

struct BridgeStats { long calls = 0, native = 0, fellThrough = 0, voids = 0, diff = 0; };

// Every way a caller reads the bridge, against the oracle as the call site read it
// (fresh Bnd_Box, IsVoid, Get).
void compareBridge(const TopoDS_Shape& s, const std::string& where, BridgeStats& st) {
    using namespace forge::native::brep;
    Bnd_Box ob;
    const bool oNat = oracleBridge(s, ob);
    double o6[6] = {0, 0, 0, 0, 0, 0};
    const bool oVoid = ob.IsVoid();
    if (!oVoid) ob.Get(o6[0], o6[1], o6[2], o6[3], o6[4], o6[5]);

    const unsigned long long c0 = shapeAabbCallCount(), n0 = shapeAabbNativeCount();
    Aabb3 a;
    a.void_ = false; a.minX = a.maxX = 12345.0;   // stale contents the call must overwrite
    const bool nNat = shapeAabbNative(s, a);
    const Aabb3 v = shapeAabb(s);
    const unsigned long long c1 = shapeAabbCallCount(), n1 = shapeAabbNativeCount();
    ++st.calls;
    (nNat ? st.native : st.fellThrough) += 1;
    if (oVoid) ++st.voids;

    auto six = [](const Aabb3& x, double* d) {
        d[0] = x.minX; d[1] = x.minY; d[2] = x.minZ; d[3] = x.maxX; d[4] = x.maxY; d[5] = x.maxZ;
    };
    double a6[6], v6[6];
    six(a, a6);
    six(v, v6);
    bool bad = (nNat != oNat) || (a.void_ != oVoid) || (v.void_ != oVoid);
    if (!oVoid)
        for (int i = 0; i < 6; ++i)
            if (bitsOf(a6[i]) != bitsOf(o6[i]) || bitsOf(v6[i]) != bitsOf(o6[i])) bad = true;
    if (c1 != c0 + 2 || n1 != n0 + (nNat ? 2u : 0u)) bad = true;
    if (bad) {
        ++st.diff;
        if (st.diff <= 5)
            std::printf("    %s: bridge differs from its b609b41d code (route %d/%d, void %d/%d, calls +%llu, native +%llu)\n",
                        where.c_str(), nNat ? 1 : 0, oNat ? 1 : 0, a.void_ ? 1 : 0, oVoid ? 1 : 0,
                        c1 - c0, n1 - n0);
    }
}

std::vector<NamedShape> bridgeFixtures() {
    std::vector<NamedShape> v = edgeFixtures();
    for (const NamedShape& s : inventoryFixtures()) v.push_back(s);
    for (const AngleCase& a : angleCases()) v.push_back({"draft: " + a.name, a.shape});
    for (const LocalCase& l : localCases()) v.push_back({"draft-local: " + l.name, l.shape});
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(6, 8, 12).Shape();
    for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) { v.push_back({"bare face", ex.Current()}); break; }
    for (TopExp_Explorer ex(box, TopAbs_WIRE); ex.More(); ex.Next()) { v.push_back({"bare wire", ex.Current()}); break; }
    for (TopExp_Explorer ex(box, TopAbs_SHELL); ex.More(); ex.Next()) { v.push_back({"bare shell", ex.Current()}); break; }
    v.push_back({"empty compound", compoundOf({})});
    v.push_back({"null shape", TopoDS_Shape()});
    return v;
}

void sectionD() {
    std::printf("[D] AABB bridge (shipped dylib) vs its b609b41d code, FORGE_NATIVE_AABB off and on\n");
    const std::vector<NamedShape> fx = bridgeFixtures();
    BridgeStats off, on;
    forge::native::brep::setForgeNativeAabbEnabled(false);
    for (const NamedShape& s : fx) compareBridge(s.shape, s.name + " [off]", off);
    forge::native::brep::setForgeNativeAabbEnabled(true);
    for (const NamedShape& s : fx) compareBridge(s.shape, s.name + " [on]", on);
    forge::native::brep::setForgeNativeAabbEnabled(false);
    std::printf("    off: %ld shapes, %ld native, %ld fell through, %ld void, %ld differ\n",
                off.calls, off.native, off.fellThrough, off.voids, off.diff);
    std::printf("    on : %ld shapes, %ld native, %ld fell through, %ld void, %ld differ\n",
                on.calls, on.native, on.fellThrough, on.voids, on.diff);
    check(off.diff == 0 && on.diff == 0,
          "[D] route, void flag and all six numbers bit-identical to the b609b41d bridge, gate off and on");
    check(off.native == 0, "[D] gate off: the native route never fires");
    check(on.native >= 10, "[D] gate on: the native route fired on >= 10 fixtures");
    check(on.fellThrough >= 3, "[D] gate on: >= 3 honest fall-throughs (face / wire / void shapes)");
    check(off.voids >= 2 && on.voids >= 2, "[D] the void case was exercised (empty compound, null shape)");
}

// ─────────────────────── [E] stored vs evaluated pcurve start, on cylinders
struct UvStats {
    long cylPairs = 0, cylDiff = 0, otherPairs = 0, otherDiff = 0;
    double otherMax = 0.0;
};

void compareUv(const TopoDS_Shape& s, const std::string& where, UvStats& st) {
    for (TopExp_Explorer fx(s, TopAbs_FACE); fx.More(); fx.Next()) {
        const TopoDS_Face F = TopoDS::Face(fx.Current());
        Handle(Geom_Surface) surf;
        try { surf = BRep_Tool::Surface(F); } catch (...) { continue; }
        if (surf.IsNull()) continue;
        // The draft engine's own test for "this neighbour is a cylinder".
        const bool cyl = !Handle(Geom_CylindricalSurface)::DownCast(
                              forge::occtdraftlocal::basisSurface(surf)).IsNull();
        for (TopExp_Explorer ex(F, TopAbs_EDGE); ex.More(); ex.Next()) {
            for (TopAbs_Orientation o : {TopAbs_FORWARD, TopAbs_REVERSED}) {
                const TopoDS_Edge E = TopoDS::Edge(ex.Current().Oriented(o));
                double f = 0.0, l = 0.0;
                Handle(Geom2d_Curve) pc;
                gp_Pnt2d val, uv0, uv1;
                try {
                    pc = BRep_Tool::CurveOnSurface(E, F, f, l);
                    if (pc.IsNull()) continue;
                    val = pc->Value(f);
                    BRep_Tool::UVPoints(E, F, uv0, uv1);
                } catch (...) { continue; }
                const bool same = bitsOf(val.X()) == bitsOf(uv0.X()) && bitsOf(val.Y()) == bitsOf(uv0.Y());
                if (cyl) {
                    ++st.cylPairs;
                    if (!same) {
                        if (++st.cylDiff <= 5)
                            std::printf("    %s: cylinder pcurve start (%.17g, %.17g) vs stored (%.17g, %.17g)\n",
                                        where.c_str(), val.X(), val.Y(), uv0.X(), uv0.Y());
                    }
                } else {
                    ++st.otherPairs;
                    if (!same) {
                        ++st.otherDiff;
                        st.otherMax = std::max({st.otherMax, std::fabs(val.X() - uv0.X()),
                                                std::fabs(val.Y() - uv0.Y())});
                    }
                }
            }
        }
    }
}

void reportUv(const UvStats& st, const char* label) {
    std::printf("    %s: %ld cylinder (edge, face) pairs, %ld differ; other surfaces %ld pairs, %ld differ "
                "(max |d| %.3g, reported only)\n", label, st.cylPairs, st.cylDiff, st.otherPairs,
                st.otherDiff, st.otherMax);
}

void sectionE() {
    std::printf("[E] BRep_Tool::UVPoints start vs Geom2d_Curve::Value(first) on cylinders (bit-exact)\n");
    UvStats st;
    for (const NamedShape& s : edgeFixtures()) compareUv(s.shape, s.name, st);
    for (const AngleCase& a : angleCases()) compareUv(a.shape, "draft: " + a.name, st);
    for (const LocalCase& l : localCases()) compareUv(l.shape, "draft-local: " + l.name, st);
    reportUv(st, "fixtures");
    check(st.cylPairs >= 40, "[E] >= 40 cylinder (edge, face) pairs compared");
    check(st.cylDiff == 0, "[E] the stored start point IS Value(first) on every cylinder pair");

    // The engine the anchor feeds. It BRepCheck-validates its own result and
    // declines otherwise, so a wrong branch is a red check HERE, not only a moved
    // AB record (which needs BASE_SRC to exist at all).
    const std::vector<LocalCase> lc = localCases();
    int built = 0;
    for (const LocalCase& l : lc) {
        const TopoDS_Shape r = runLocalCase(l);
        if (!r.IsNull()) {
            ++built;
            std::printf("    draft-local %-34s built, V = %.10g\n", l.name.c_str(), volumeOf(r));
        } else {
            std::printf("    draft-local %-34s DECLINED: %s\n", l.name.c_str(),
                        forge::occtdraftlocal::draftLocalLastDeferReason());
        }
    }
    check(built == static_cast<int>(lc.size()),
          "[E] the draft engine builds every cylinder-neighbour case the anchor feeds");
}

// ─────────────────────────────────── [F] NativeDraftAngle closed forms
void sectionF() {
    std::printf("[F] NativeDraftAngle::draftFaces vs closed-form volumes, AABB bridge off and on\n");
    for (int aabb = 0; aabb < 2; ++aabb) {
        forge::native::brep::setForgeNativeAabbEnabled(aabb == 1);
        int answered = 0, refused = 0, within = 0, positive = 0, refusals = 0;
        double worst = 0.0;
        for (const AngleCase& a : angleCases()) {
            std::string why;
            const TopoDS_Shape r = runAngleCase(a, why);
            if (a.refuse) {
                ++refusals;
                if (r.IsNull()) ++refused;
                else std::printf("    %s: expected a refusal, got a shape\n", a.name.c_str());
                continue;
            }
            ++positive;
            if (r.IsNull() || a.faces.empty()) {
                std::printf("    %s: declined (%s)\n", a.name.c_str(), why.c_str());
                continue;
            }
            ++answered;
            const double rel = std::fabs(volumeOf(r) - a.ref) / std::fabs(a.ref);
            worst = std::max(worst, rel);
            if (rel <= 1e-9) ++within;
            else std::printf("    %s: V rel error %.3g vs closed form\n", a.name.c_str(), rel);
        }
        std::printf("    aabb %s: %d/%d answered, %d within 1e-9 of the closed form (worst %.3g); %d/%d refusals\n",
                    aabb ? "on " : "off", answered, positive, within, worst, refused, refusals);
        const std::string tag = aabb ? " (bridge on)" : " (bridge off)";
        check(answered == positive, "[F] every positive draft case answered" + tag);
        check(within == positive, "[F] every answered volume within 1e-9 of its closed form" + tag);
        check(refused == refusals, "[F] the top cap and the sphere wall are refused" + tag);
    }
    forge::native::brep::setForgeNativeAabbEnabled(false);
}

// ─────────────────────────────────────────────────────────────── --corpus
void corpus(const std::string& list) {
    std::printf("[corpus] %s\n", list.c_str());
    EdgeStats st;
    InvStats inv;
    UvStats uv;
    BridgeStats bOff, bOn;
    long parts = 0, unread = 0, multi = 0;
    for (const std::string& path : readList(list)) {
        TopoDS_Shape s;
        try { s = readStep(path); } catch (...) { s.Nullify(); }
        if (s.IsNull()) { ++unread; continue; }
        ++parts;
        const std::string name = path.substr(path.find_last_of('/') + 1);
        runEdgeComparison(s, name, st);
        if (solidsOf(s).size() >= 2) { ++multi; compareInventory(s, name, inv, 8); }
        compareUv(s, name, uv);
        forge::native::brep::setForgeNativeAabbEnabled(false);
        compareBridge(s, name + " [off]", bOff);
        forge::native::brep::setForgeNativeAabbEnabled(true);
        compareBridge(s, name + " [on]", bOn);
        forge::native::brep::setForgeNativeAabbEnabled(false);
    }
    std::printf("    %ld parts read (%ld unreadable), %ld multi-solid\n", parts, unread, multi);
    reportEdgeStats(st, "corpus");
    std::printf("    corpus inventory: %ld pairs; diffs gap %ld, presence %ld, box %ld\n",
                inv.pairs, inv.gapDiff, inv.presenceDiff, inv.boxDiff);
    reportUv(uv, "corpus");
    std::printf("    corpus AABB bridge: off %ld parts (%ld native) %ld differ; on %ld parts (%ld native, "
                "%ld fell through) %ld differ\n", bOff.calls, bOff.native, bOff.diff, bOn.calls, bOn.native,
                bOn.fellThrough, bOn.diff);
    check(uv.cylDiff == 0, "[corpus] the stored start point IS Value(first) on every cylinder pair");
    check(bOff.diff == 0 && bOn.diff == 0 && bOff.native == 0,
          "[corpus] the AABB bridge is bit-identical to its b609b41d code on every part, gate off and on");
    check(parts > 0, "[corpus] read at least one part");
    check(st.kindDiff == 0 && st.readDiff == 0 && st.windowDiff == 0 && st.tanDiff == 0 &&
          st.junctionDiff == 0, "[corpus] ring-edge reader identical to the adaptor on every edge");
    check(inv.gapDiff == 0 && inv.presenceDiff == 0 && inv.boxDiff == 0,
          "[corpus] inventory identical to constructor+Perform on every multi-solid part");
}
#endif  // OCCTQ_EMIT_ONLY

// ─────────────────────────────────────────────────────────────── --emit
// The observable record, compilable against the PRE-change sources: only
// functions that exist on both sides of the change are named here.
void emit(const std::string& file, const std::string& corpusList) {
    std::FILE* o = std::fopen(file.c_str(), "w");
    if (!o) { std::printf("cannot write %s\n", file.c_str()); ++g_fail; return; }
    using namespace forge::occtfillet;
    long rims = 0;
    for (const NamedShape& s : edgeFixtures()) {
        int ei = 0;
        for (TopExp_Explorer ex(s.shape, TopAbs_EDGE); ex.More(); ex.Next(), ++ei) {
            const TopoDS_Edge e = TopoDS::Edge(ex.Current());
            for (RimKind k : {RimKind::Fillet, RimKind::Chamfer}) {
                for (double R : {0.5, 1.0, 2.0}) {
                    RimContext rc;
                    std::string why;
                    const bool ok = buildRimContext(s.shape, e, R, k, rc, why);
                    std::fprintf(o, "rim\t%s\t%d\t%d\t%a\t%d\t%s\t%d\t%d\t%a\t%a\n", s.name.c_str(), ei,
                                 static_cast<int>(k), R, ok ? 1 : 0, ok ? "" : why.c_str(),
                                 rc.nLine, rc.nArc, rc.predictedDv, rc.bandArea);
                    if (ok) ++rims;
                }
            }
            // The public engine end to end: does the edge fillet, and to what volume.
            for (double R : {0.5, 1.0}) {
                const Result r = makeFillet(s.shape, {FilletSpec{e, R}});
                double vol = 0.0;
                if (r.ok && !r.shape.IsNull()) { GProp_GProps gp; BRepGProp::VolumeProperties(r.shape, gp); vol = gp.Mass(); }
                std::fprintf(o, "fillet\t%s\t%d\t%a\t%d\t%a\n", s.name.c_str(), ei, R, r.ok ? 1 : 0, vol);
                const Result c = makeChamfer(s.shape, {ChamferSpec{e, R, 0.0, TopoDS_Face()}});
                double cv = 0.0;
                if (c.ok && !c.shape.IsNull()) { GProp_GProps gp; BRepGProp::VolumeProperties(c.shape, gp); cv = gp.Mass(); }
                std::fprintf(o, "chamfer\t%s\t%d\t%a\t%d\t%a\n", s.name.c_str(), ei, R, c.ok ? 1 : 0, cv);
            }
        }
    }
    // Draft local: curve parameters on periodic edges, lo on both sides of 2*pi.
    {
        using forge::occtdraftlocal::curveParamAt;
        Handle(Geom_Circle) ci = new Geom_Circle(gp_Ax2(gp_Pnt(1, 2, 3), gp_Dir(0.2, 0.3, 0.9)), 4.0);
        Handle(Geom_Ellipse) el = new Geom_Ellipse(gp_Ax2(gp_Pnt(-1, 0, 2), gp::DZ()), 6.0, 2.0);
        const std::vector<Handle(Geom_Curve)> curves = {ci, el};
        int ci_ = 0;
        for (const Handle(Geom_Curve)& c : curves) {
            for (double lo : {-7.0, -kTwoPi, -1.0, 0.0, 0.25, 3.0, 5.9, kTwoPi, 7.5, 13.0}) {
                for (int i = 0; i <= 64; ++i) {
                    const double u = lo + kTwoPi * i / 64.0;
                    double t = 0, dist = 0;
                    const bool ok = curveParamAt(c, lo, lo + 2.0, c->Value(u), t, dist);
                    std::fprintf(o, "param\t%d\t%a\t%d\t%d\t%a\t%a\n", ci_, lo, i, ok ? 1 : 0, t, dist);
                }
            }
            ++ci_;
        }
    }
    // The rim on the corpus: every candidate edge of every part.
    long corpusRims = 0, corpusAsked = 0;
    if (!corpusList.empty()) {
        for (const std::string& path : readList(corpusList)) {
            TopoDS_Shape shp;
            try { shp = readStep(path); } catch (...) { shp.Nullify(); }
            const std::string name = path.substr(path.find_last_of('/') + 1);
            if (shp.IsNull()) { std::fprintf(o, "corpus\t%s\tunreadable\n", name.c_str()); continue; }
            int ei = 0;
            for (const TopoDS_Edge& e : rimCandidates(shp, 400)) {
                for (RimKind k : {RimKind::Fillet, RimKind::Chamfer}) {
                    RimContext rc;
                    std::string why;
                    const bool ok = buildRimContext(shp, e, 1.0, k, rc, why);
                    ++corpusAsked;
                    if (ok) ++corpusRims;
                    std::fprintf(o, "rim\t%s\t%d\t%d\t%a\t%d\t%s\t%d\t%d\t%a\t%a\n", name.c_str(), ei,
                                 static_cast<int>(k), 1.0, ok ? 1 : 0, ok ? "" : why.c_str(),
                                 rc.nLine, rc.nArc, rc.predictedDv, rc.bandArea);
                }
                ++ei;
            }
        }
        std::printf("[emit] corpus: %ld rim requests on candidate edges, %ld resolved\n", corpusAsked, corpusRims);
    }
    // NativeDraftAngle, the AABB bridge's only production caller: every case of [F],
    // with the bridge off and on. Only names that exist on both sides of the change.
    for (int aabb = 0; aabb < 2; ++aabb) {
        forge::native::brep::setForgeNativeAabbEnabled(aabb == 1);
        for (const AngleCase& a : angleCases()) {
            std::string why;
            const TopoDS_Shape r = runAngleCase(a, why);
            emitShape(o, "dangle", a.name + (aabb ? "|aabb-on" : "|aabb-off"), r, why);
        }
    }
    forge::native::brep::setForgeNativeAabbEnabled(false);
    // NativeDraftLocal where the cylinder branch anchor is read.
    for (const LocalCase& l : localCases()) {
        const TopoDS_Shape r = runLocalCase(l);
        emitShape(o, "dlocal", l.name, r, r.IsNull() ? forge::occtdraftlocal::draftLocalLastDeferReason() : "");
        const forge::occtdraftlocal::DraftLocalStats& s = forge::occtdraftlocal::draftLocalLastStats();
        std::fprintf(o, "dlstats\t%s\t%d %d %d %d %d %d %d %d %d %d\n", l.name.c_str(), s.movedVertices,
                     s.solvedByPlaneMeet, s.solvedByAnchor, s.solvedByQuadric, s.facesVerbatim, s.facesRebuilt,
                     s.wiresVerbatim, s.edgesVerbatim, s.edgesRetrimmed, s.edgesRebuilt);
    }
#ifndef OCCTQ_NO_INVENTORY
    for (const NamedShape& s : inventoryFixtures()) {
        const forge::BodyInventory inv = forge::bodyInventory(s.shape);
        for (const forge::SolidBody& b : inv.bodies)
            std::fprintf(o, "body\t%s\t%a\t%a\t%a %a %a\t%a %a %a\t%a %a %a\t%u\n", s.name.c_str(), b.volume,
                         b.area, b.centroid[0], b.centroid[1], b.centroid[2], b.bboxMin[0], b.bboxMin[1],
                         b.bboxMin[2], b.bboxMax[0], b.bboxMax[1], b.bboxMax[2], b.faceCount);
        for (const forge::SolidBodyPair& p : inv.pairs)
            std::fprintf(o, "pair\t%s\t%u\t%u\t%a\t%a\n", s.name.c_str(), p.a, p.b, p.gap, p.overlapVolume);
        for (const forge::SolidBodyAlignment& a : inv.alignments)
            std::fprintf(o, "align\t%s\t%d\t%u\t%u\t%u\t%u\t%a\n", s.name.c_str(), static_cast<int>(a.kind),
                         a.a, a.b, a.faceA, a.faceB, a.deviation);
        std::fprintf(o, "inv\t%s\t%d\t%zu\t%d\n", s.name.c_str(), inv.analysed ? 1 : 0,
                     inv.pairsEvaluated, inv.pairsTruncated ? 1 : 0);
    }
#endif
    std::fclose(o);
    std::printf("[emit] wrote %s (%ld rim contexts resolved)\n", file.c_str(), rims);
}

}  // namespace

int main(int argc, char** argv) {
    std::string corpusList, emitFile;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--corpus" && i + 1 < argc) corpusList = argv[++i];
        else if (a == "--emit" && i + 1 < argc) emitFile = argv[++i];
        else { std::printf("usage: %s [--corpus LIST] [--emit FILE]\n", argv[0]); return 2; }
    }
#ifndef OCCTQ_EMIT_ONLY
    sectionA();
    sectionB();
    sectionC();
    sectionD();
    sectionE();
    sectionF();
    if (!corpusList.empty()) corpus(corpusList);
#endif
    if (!emitFile.empty()) emit(emitFile, corpusList);
    std::printf("[occt-query-tail] %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
