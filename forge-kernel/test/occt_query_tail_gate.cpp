// test/occt_query_tail_gate.cpp — T-148: the OCCT QUERY tail, gate.
//
// WHAT MOVED (measured on b609b41d, libforge_kernel_core.dylib, per object):
// five OCCT symbols that each had exactly ONE owner in the kernel, and whose only
// job was to answer a question a closed form answers:
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

// ─────────────────────────────────────────────────────────────── --corpus
void corpus(const std::string& list) {
    std::printf("[corpus] %s\n", list.c_str());
    EdgeStats st;
    InvStats inv;
    long parts = 0, unread = 0, multi = 0;
    for (const std::string& path : readList(list)) {
        TopoDS_Shape s;
        try { s = readStep(path); } catch (...) { s.Nullify(); }
        if (s.IsNull()) { ++unread; continue; }
        ++parts;
        const std::string name = path.substr(path.find_last_of('/') + 1);
        runEdgeComparison(s, name, st);
        if (solidsOf(s).size() >= 2) { ++multi; compareInventory(s, name, inv, 8); }
    }
    std::printf("    %ld parts read (%ld unreadable), %ld multi-solid\n", parts, unread, multi);
    reportEdgeStats(st, "corpus");
    std::printf("    corpus inventory: %ld pairs; diffs gap %ld, presence %ld, box %ld\n",
                inv.pairs, inv.gapDiff, inv.presenceDiff, inv.boxDiff);
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
        std::fprintf(o, "inv\t%s\t%d\t%u\t%d\n", s.name.c_str(), inv.analysed ? 1 : 0,
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
    if (!corpusList.empty()) corpus(corpusList);
#endif
    if (!emitFile.empty()) emit(emitFile, corpusList);
    std::printf("[occt-query-tail] %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
