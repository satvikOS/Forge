// forge-kernel/test/ab_native_fillet_concave_occt.cpp
//
// LIVE-OCCT A/B for the TKFillet-free CONCAVE (reflex) edge blend —
//   forge::occtfillet::makeFillet   vs  BRepFilletAPI_MakeFillet
//   forge::occtfillet::makeChamfer  vs  BRepFilletAPI_MakeChamfer
// on the SAME inputs, in ONE process.
//
// WHAT IS UNDER TEST. Before 2026-08-29 the native engine refused every reflex
// edge outright ("concave (reflex) edge — out of scope"), which is the single most
// common blend in real mechanical parts: the inside corner of an L-bracket, a
// pocket, a rib-to-floor joint, a slot. Both one-edge routines and the corner-aware
// batch now accept it. The construction is the SAME rolling-ball geometry with two
// signs flipped — the cylinder axis sits R along +nA instead of -nA, and the blend
// ADDS material instead of removing it — so this A/B also re-pins the convex cases
// to prove nothing regressed when the sign became a variable.
//
// WHY EACH ASSERTION EXISTS. Volume alone proves nothing; this repo has measured a
// wrong solid matching the right volume to ten significant figures, and did so again
// while this capability was being written (see the OVER-SIZE defer control below).
// So each case asserts, in this order:
//
//   1. VOLUME    native == OCCT                        (relative, 1e-9)
//   2. VOLUME    native == CLOSED FORM                 (relative, 1e-9) — a second,
//                INDEPENDENT oracle computed from the prism's own polygon by
//                shoelace + the wedge cross-section  s·R − ½R²(π−ψ)  (fillet) /
//                ½d²·sin ψ (chamfer), signed − for convex and + for concave. It
//                shares no code with the engine.
//   3. POSITION  centre of mass, componentwise         (absolute, 1e-7 mm)
//   4. POSITION  axis-aligned bounding box, all six    (absolute, 1e-7 mm) — what
//                catches a body of the right size in the wrong place
//   5. TOPOLOGY  face / edge / vertex / shell counts native == OCCT
//   6. TOPOLOGY  Euler characteristic V−E+F and the genus (2−χ)/2 it implies —
//                what catches a body with the right counts wired up wrong
//   7. VALIDITY  BRepCheck_Analyzer, and every shell closed
//
// NEGATIVE CONTROL. Case "control" feeds the comparator two solids of EXACTLY equal
// volume (6000 = 30·20·10 = 60·10·10) whose geometry differs, and asserts the
// comparator REJECTS them. A gate that cannot fail is not a gate.
//
// DEFER CONTROLS. Four cases assert the engine returns ok==false on inputs outside
// its stated scope, and — where it matters — assert what OCCT does with the same
// input, so the scope statement is measured rather than asserted:
//   * OVER-SIZE concave  (setback deeper than the adjacent face): the engine used to
//     return a BRepCheck-VALID solid with exactly the ideal volume here; OCCT
//     declines. Both must now decline.
//   * OVER-SIZE convex   (the same leak on the older convex path).
//   * MIXED-CONVEXITY trihedral vertex: the engine defers; OCCT SUCCEEDS. That is an
//     honest capability gap, and the test pins it so it cannot be quietly forgotten —
//     it is exactly why the OCCT fallback must stay compiled (FORGE_FILLET_DROP_NATIVE
//     is OFF) until the two-edge corner surface is authored.
//   * CURVED adjacent face (cylinder rim -> torus blend): engine defers, OCCT succeeds.
//
// Exit 0 iff every assertion holds. Build + run with
//   bash forge-kernel/test/run_ab_native_fillet_concave.sh

#include "forge/native/brep/NativeFilletChamfer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_pass = 0, g_total = 0;

void check(bool cond, const std::string& what) {
    ++g_total;
    std::printf("  %s %s\n", cond ? "[PASS]" : "[FAIL]", what.c_str());
    if (cond) ++g_pass;
}

bool relClose(double a, double b, double tol) {
    const double s = std::max(1.0, std::max(std::fabs(a), std::fabs(b)));
    return std::fabs(a - b) <= tol * s;
}

// ---------------------------------------------------------------- metrics
struct Metrics {
    double vol = 0.0;
    double com[3] = {0, 0, 0};
    double bb[6] = {0, 0, 0, 0, 0, 0};
    int nFace = 0, nEdge = 0, nVert = 0, nShell = 0;
    int euler = 0;          // V - E + F
    int genus2 = 0;         // 2 - euler  (== 2*genus for a closed orientable shell)
    bool closedShells = false;
    bool valid = false;
};

Metrics measure(const TopoDS_Shape& s) {
    Metrics m;
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    m.vol = std::fabs(g.Mass());
    const gp_Pnt c = g.CentreOfMass();
    m.com[0] = c.X(); m.com[1] = c.Y(); m.com[2] = c.Z();

    Bnd_Box box;
    BRepBndLib::Add(s, box);
    box.SetGap(0.0);
    box.Get(m.bb[0], m.bb[1], m.bb[2], m.bb[3], m.bb[4], m.bb[5]);

    TopTools_IndexedMapOfShape mf, me, mv, ms;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    TopExp::MapShapes(s, TopAbs_SHELL, ms);
    m.nFace = mf.Extent(); m.nEdge = me.Extent();
    m.nVert = mv.Extent(); m.nShell = ms.Extent();
    m.euler = m.nVert - m.nEdge + m.nFace;
    m.genus2 = 2 - m.euler;

    m.closedShells = ms.Extent() > 0;
    for (int i = 1; i <= ms.Extent(); ++i)
        if (!BRep_Tool::IsClosed(ms.FindKey(i))) m.closedShells = false;

    m.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True;
    return m;
}

// The whole observable vector, one call. Returns false (and prints which observable
// diverged) if ANY of them differs — this is the comparator the negative control
// must be able to trip.
bool sameMetrics(const Metrics& a, const Metrics& b, const std::string& tag) {
    bool ok = true;
    auto fail = [&](const std::string& what) { std::printf("      DIFF %s: %s\n", tag.c_str(), what.c_str()); ok = false; };
    char buf[256];

    if (!relClose(a.vol, b.vol, 1e-9)) {
        std::snprintf(buf, sizeof(buf), "volume %.12g vs %.12g", a.vol, b.vol); fail(buf);
    }
    for (int i = 0; i < 3; ++i)
        if (std::fabs(a.com[i] - b.com[i]) > 1e-7) {
            std::snprintf(buf, sizeof(buf), "com[%d] %.12g vs %.12g", i, a.com[i], b.com[i]); fail(buf);
        }
    for (int i = 0; i < 6; ++i)
        if (std::fabs(a.bb[i] - b.bb[i]) > 1e-7) {
            std::snprintf(buf, sizeof(buf), "bbox[%d] %.12g vs %.12g", i, a.bb[i], b.bb[i]); fail(buf);
        }
    if (a.nFace != b.nFace)  { std::snprintf(buf, sizeof(buf), "faces %d vs %d", a.nFace, b.nFace); fail(buf); }
    if (a.nEdge != b.nEdge)  { std::snprintf(buf, sizeof(buf), "edges %d vs %d", a.nEdge, b.nEdge); fail(buf); }
    if (a.nVert != b.nVert)  { std::snprintf(buf, sizeof(buf), "verts %d vs %d", a.nVert, b.nVert); fail(buf); }
    if (a.nShell != b.nShell){ std::snprintf(buf, sizeof(buf), "shells %d vs %d", a.nShell, b.nShell); fail(buf); }
    if (a.euler != b.euler)  { std::snprintf(buf, sizeof(buf), "euler %d vs %d", a.euler, b.euler); fail(buf); }
    if (a.genus2 != b.genus2){ std::snprintf(buf, sizeof(buf), "2*genus %d vs %d", a.genus2, b.genus2); fail(buf); }
    if (a.closedShells != b.closedShells) fail("closed-shell flag");
    if (a.valid != b.valid)               fail("BRepCheck validity");
    return ok;
}

// ---------------------------------------------------------------- geometry helpers
struct Poly {
    std::vector<gp_Pnt> pts;   // CCW in z=0
    double h = 0.0;            // prism height along +Z
};

TopoDS_Shape prismOf(const Poly& p) {
    BRepBuilderAPI_MakePolygon poly;
    for (const gp_Pnt& q : p.pts) poly.Add(q);
    poly.Close();
    return BRepPrimAPI_MakePrism(BRepBuilderAPI_MakeFace(poly.Wire()).Face(),
                                 gp_Vec(0, 0, p.h)).Shape();
}

double shoelaceArea(const Poly& p) {
    double a = 0.0;
    const std::size_t n = p.pts.size();
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& u = p.pts[i];
        const gp_Pnt& v = p.pts[(i + 1) % n];
        a += u.X() * v.Y() - v.X() * u.Y();
    }
    return 0.5 * std::fabs(a);
}

// The wedge angle ψ the rolling ball sits in at polygon vertex i, and whether the
// vertex is convex. For a CCW polygon the vertex is convex iff the turn is left.
// ψ = interior angle when convex, 2π − interior when reflex — computed here from
// the POLYGON ONLY, with no reference to the engine's own frame.
void wedgeAt(const Poly& p, std::size_t i, double& psi, bool& convex) {
    const std::size_t n = p.pts.size();
    const gp_Pnt& prev = p.pts[(i + n - 1) % n];
    const gp_Pnt& here = p.pts[i];
    const gp_Pnt& next = p.pts[(i + 1) % n];
    const double ax = here.X() - prev.X(), ay = here.Y() - prev.Y();
    const double bx = next.X() - here.X(), by = next.Y() - here.Y();
    convex = (ax * by - ay * bx) > 0.0;                 // CCW polygon: left turn
    const double ux = prev.X() - here.X(), uy = prev.Y() - here.Y();
    const double vx = next.X() - here.X(), vy = next.Y() - here.Y();
    const double cu = std::hypot(ux, uy), cv = std::hypot(vx, vy);
    double cosang = (ux * vx + uy * vy) / (cu * cv);
    cosang = std::max(-1.0, std::min(1.0, cosang));
    const double between = std::acos(cosang);           // angle between the two arms
    const double interior = convex ? between : 2.0 * kPi - between;
    psi = convex ? interior : 2.0 * kPi - interior;      // == between, either way
}

// Signed volume change of one constant-radius fillet on a prism's vertical edge.
double filletDelta(const Poly& p, std::size_t i, double R) {
    double psi; bool convex;
    wedgeAt(p, i, psi, convex);
    const double s = R / std::tan(0.5 * psi);
    const double area = s * R - 0.5 * R * R * (kPi - psi);
    return (convex ? -1.0 : 1.0) * area * p.h;
}

// Signed volume change of one symmetric flat chamfer on a prism's vertical edge.
double chamferDelta(const Poly& p, std::size_t i, double d) {
    double psi; bool convex;
    wedgeAt(p, i, psi, convex);
    const double area = 0.5 * d * d * std::sin(psi);
    return (convex ? -1.0 : 1.0) * area * p.h;
}

std::vector<TopoDS_Edge> allEdges(const TopoDS_Shape& s) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_EDGE, m);
    std::vector<TopoDS_Edge> v;
    for (int i = 1; i <= m.Extent(); ++i) v.push_back(TopoDS::Edge(m(i)));
    return v;
}

bool isVerticalLine(const TopoDS_Edge& e) {
    BRepAdaptor_Curve c(e);
    if (c.GetType() != GeomAbs_Line) return false;
    const gp_Vec d(c.Value(c.FirstParameter()), c.Value(c.LastParameter()));
    if (d.Magnitude() < 1e-12) return false;
    return std::fabs(std::fabs(d.Normalized().Z()) - 1.0) < 1e-9;
}

// The prism's vertical edge standing on polygon vertex i.
bool verticalEdgeAt(const TopoDS_Shape& s, const gp_Pnt& xy, TopoDS_Edge& out) {
    for (const TopoDS_Edge& e : allEdges(s)) {
        if (!isVerticalLine(e)) continue;
        BRepAdaptor_Curve c(e);
        const gp_Pnt p = c.Value(c.FirstParameter());
        if (std::fabs(p.X() - xy.X()) < 1e-9 && std::fabs(p.Y() - xy.Y()) < 1e-9) { out = e; return true; }
    }
    return false;
}

// ---------------------------------------------------------------- the A/B driver
struct Sel { std::vector<std::size_t> verts; };   // polygon vertex indices to blend

void abCase(const std::string& name, const Poly& p, const Sel& sel, double R, bool fillet) {
    std::printf("[case] %s\n", name.c_str());
    const TopoDS_Shape shape = prismOf(p);

    std::vector<TopoDS_Edge> es;
    for (std::size_t i : sel.verts) {
        TopoDS_Edge e;
        if (!verticalEdgeAt(shape, p.pts[i], e)) { check(false, name + ": could not locate the vertical edge"); return; }
        es.push_back(e);
    }

    // --- native
    forge::occtfillet::Result nr;
    if (fillet) {
        std::vector<forge::occtfillet::FilletSpec> sp;
        for (const TopoDS_Edge& e : es) { forge::occtfillet::FilletSpec s; s.edge = e; s.radius = R; sp.push_back(s); }
        nr = forge::occtfillet::makeFillet(shape, sp);
    } else {
        std::vector<forge::occtfillet::ChamferSpec> sp;
        for (const TopoDS_Edge& e : es) { forge::occtfillet::ChamferSpec s; s.edge = e; s.dist = R; sp.push_back(s); }
        nr = forge::occtfillet::makeChamfer(shape, sp);
    }
    if (!nr.ok) { check(false, name + ": native DEFERRED (" + nr.reason + ")"); return; }

    // --- OCCT
    TopoDS_Shape os;
    bool oOk = false;
    try {
        if (fillet) {
            BRepFilletAPI_MakeFillet mk(shape);
            for (const TopoDS_Edge& e : es) mk.Add(R, e);
            mk.Build();
            if (mk.IsDone()) { os = mk.Shape(); oOk = true; }
        } else {
            BRepFilletAPI_MakeChamfer mk(shape);
            for (const TopoDS_Edge& e : es) mk.Add(R, e);
            mk.Build();
            if (mk.IsDone()) { os = mk.Shape(); oOk = true; }
        }
    } catch (...) { oOk = false; }
    if (!oOk) { check(false, name + ": OCCT reference failed to build"); return; }

    const Metrics mn = measure(nr.shape), mo = measure(os);

    // 1..7 — the whole observable vector against OCCT
    check(sameMetrics(mn, mo, name), name + ": native == OCCT on volume/com/bbox/F/E/V/shells/euler/genus/validity");

    // 2 — the INDEPENDENT closed form
    double expect = shoelaceArea(p) * p.h;
    for (std::size_t i : sel.verts) expect += fillet ? filletDelta(p, i, R) : chamferDelta(p, i, R);
    char buf[256];
    std::snprintf(buf, sizeof(buf), "%s: native volume %.12g == closed form %.12g", name.c_str(), mn.vol, expect);
    check(relClose(mn.vol, expect, 1e-9), buf);

    // 7 — absolute validity, not just agreement with OCCT
    check(mn.valid && mn.closedShells && mn.nShell == 1, name + ": native is ONE closed valid shell");
    check(mn.genus2 == 0, name + ": native genus 0");
}

// A defer control. `occtShould` records what OCCT does with the same input, so an
// honest capability gap is measured instead of assumed.
enum class OcctExpect { Declines, Succeeds };

void deferCase(const std::string& name, const TopoDS_Shape& shape,
               const std::vector<TopoDS_Edge>& es, double R, bool fillet,
               const std::string& reasonSubstr, OcctExpect occtShould) {
    std::printf("[defer] %s\n", name.c_str());
    forge::occtfillet::Result nr;
    if (fillet) {
        std::vector<forge::occtfillet::FilletSpec> sp;
        for (const TopoDS_Edge& e : es) { forge::occtfillet::FilletSpec s; s.edge = e; s.radius = R; sp.push_back(s); }
        nr = forge::occtfillet::makeFillet(shape, sp);
    } else {
        std::vector<forge::occtfillet::ChamferSpec> sp;
        for (const TopoDS_Edge& e : es) { forge::occtfillet::ChamferSpec s; s.edge = e; s.dist = R; sp.push_back(s); }
        nr = forge::occtfillet::makeChamfer(shape, sp);
    }
    check(!nr.ok, name + ": engine DEFERS (got: " + (nr.ok ? std::string("ok") : nr.reason) + ")");
    check(!nr.ok && nr.reason.find(reasonSubstr) != std::string::npos,
          name + ": deferral names \"" + reasonSubstr + "\"");

    bool oOk = false;
    try {
        BRepFilletAPI_MakeFillet mk(shape);
        for (const TopoDS_Edge& e : es) mk.Add(R, e);
        mk.Build();
        if (mk.IsDone()) { const TopoDS_Shape s = mk.Shape(); oOk = !s.IsNull(); }
    } catch (...) { oOk = false; }
    if (occtShould == OcctExpect::Declines)
        check(!oOk, name + ": OCCT ALSO declines this input");
    else
        check(oOk, name + ": OCCT SUCCEEDS here — the fallback is genuinely load-bearing");
}

}  // namespace

int main() {
    std::printf("=== A/B: native CONCAVE (reflex) edge blend vs OCCT BRepFilletAPI ===\n");

    // ---- L-prism: one 270 deg reflex vertex at index 3 -----------------------
    const Poly L{{{0,0,0},{30,0,0},{30,10,0},{10,10,0},{10,20,0},{0,20,0}}, 8.0};
    abCase("L concave-only fillet R=2",  L, {{3}},                 2.0, true);
    abCase("L concave-only fillet R=4",  L, {{3}},                 4.0, true);
    abCase("L concave-only chamfer d=2", L, {{3}},                 2.0, false);
    abCase("L all-6 fillet R=2 (5 convex + 1 concave)",  L, {{0,1,2,3,4,5}}, 2.0, true);
    abCase("L all-6 chamfer d=2 (5 convex + 1 concave)", L, {{0,1,2,3,4,5}}, 2.0, false);
    abCase("L 5-convex-only fillet R=2", L, {{0,1,2,4,5}},         2.0, true);

    // ---- T-prism: TWO reflex vertices (indices 4 and 5) ----------------------
    const Poly T{{{0,0,0},{30,0,0},{30,20,0},{20,20,0},{20,10,0},{10,10,0},{10,20,0},{0,20,0}}, 6.0};
    abCase("T both-concave fillet R=2",  T, {{4,5}},                     2.0, true);
    abCase("T both-concave chamfer d=2", T, {{4,5}},                     2.0, false);
    abCase("T all-8 fillet R=2",         T, {{0,1,2,3,4,5,6,7}},         2.0, true);
    abCase("T all-8 chamfer d=2",        T, {{0,1,2,3,4,5,6,7}},         2.0, false);

    // ---- Chevron: an OBTUSE reflex vertex (interior 233.13 deg) -------------
    // The 90 deg cases alone would not distinguish s = R/tan(psi/2) from s = R.
    const Poly C{{{0,0,0},{40,0,0},{40,20,0},{20,10,0},{0,20,0}}, 5.0};
    abCase("chevron obtuse-reflex fillet R=2",  C, {{3}}, 2.0, true);
    abCase("chevron obtuse-reflex chamfer d=2", C, {{3}}, 2.0, false);

    // ---- Regression: the convex corner cases must be untouched --------------
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(30.0, 20.0, 10.0).Shape();
        const std::vector<TopoDS_Edge> es = allEdges(box);
        for (int pass = 0; pass < 2; ++pass) {
            const bool fillet = (pass == 0);
            const double R = fillet ? 3.0 : 2.0;
            const std::string name = fillet ? "REGRESSION box all-12 fillet R=3"
                                            : "REGRESSION box all-12 chamfer d=2";
            std::printf("[case] %s\n", name.c_str());
            forge::occtfillet::Result nr;
            if (fillet) {
                std::vector<forge::occtfillet::FilletSpec> sp;
                for (const TopoDS_Edge& e : es) { forge::occtfillet::FilletSpec s; s.edge = e; s.radius = R; sp.push_back(s); }
                nr = forge::occtfillet::makeFillet(box, sp);
            } else {
                std::vector<forge::occtfillet::ChamferSpec> sp;
                for (const TopoDS_Edge& e : es) { forge::occtfillet::ChamferSpec s; s.edge = e; s.dist = R; sp.push_back(s); }
                nr = forge::occtfillet::makeChamfer(box, sp);
            }
            if (!nr.ok) { check(false, name + ": native DEFERRED (" + nr.reason + ")"); continue; }
            TopoDS_Shape os; bool oOk = false;
            try {
                if (fillet) { BRepFilletAPI_MakeFillet mk(box); for (const TopoDS_Edge& e : es) mk.Add(R, e); mk.Build();
                              if (mk.IsDone()) { os = mk.Shape(); oOk = true; } }
                else        { BRepFilletAPI_MakeChamfer mk(box); for (const TopoDS_Edge& e : es) mk.Add(R, e); mk.Build();
                              if (mk.IsDone()) { os = mk.Shape(); oOk = true; } }
            } catch (...) { oOk = false; }
            if (!oOk) { check(false, name + ": OCCT reference failed"); continue; }
            check(sameMetrics(measure(nr.shape), measure(os), name),
                  name + ": native == OCCT on the whole observable vector");
            // Minkowski closed form for the all-edges fillet of a box:
            //   a·b·c − ... is easiest as the exact literal OCCT/native agree on.
            if (fillet) check(relClose(measure(nr.shape).vol, 5572.619358586, 1e-9),
                              name + ": volume == 5572.619358586 (Minkowski box (+) ball)");
            else        check(relClose(measure(nr.shape).vol, 5562.666666667, 1e-9),
                              name + ": volume == 5562.666666667");
        }
    }

    // ---- NEGATIVE CONTROL: equal volume, different geometry -----------------
    {
        const Metrics a = measure(BRepPrimAPI_MakeBox(30.0, 20.0, 10.0).Shape());
        const Metrics b = measure(BRepPrimAPI_MakeBox(60.0, 10.0, 10.0).Shape());
        std::printf("[control] equal-volume decoy (%.9f == %.9f)\n", a.vol, b.vol);
        check(relClose(a.vol, b.vol, 1e-12), "control: the two decoys DO have equal volume");
        check(!sameMetrics(a, b, "control"), "control: comparator REJECTS them anyway");
    }

    // ---- DEFER CONTROLS -----------------------------------------------------
    {
        const TopoDS_Shape lp = prismOf(L);
        TopoDS_Edge conc;
        if (verticalEdgeAt(lp, L.pts[3], conc)) {
            deferCase("OVER-SIZE concave R=15 (setback 15 into a 10 mm face)",
                      lp, {conc}, 15.0, true,
                      "setback exceeds the adjacent face extent", OcctExpect::Declines);
        } else {
            check(false, "defer control: could not locate the reflex edge");
        }
        // The MIXED-CONVEXITY trihedral vertex: the reflex vertical at (10,10) and the
        // convex top edge (10,10,h)-(30,10,h) share a vertex. Engine defers; OCCT does not.
        TopoDS_Edge topAt;
        bool gotTop = false;
        for (const TopoDS_Edge& e : allEdges(lp)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt p0 = c.Value(c.FirstParameter()), p1 = c.Value(c.LastParameter());
            const gp_Pnt a(10, 10, L.h), b(30, 10, L.h);
            if ((p0.Distance(a) < 1e-9 && p1.Distance(b) < 1e-9) ||
                (p0.Distance(b) < 1e-9 && p1.Distance(a) < 1e-9)) { topAt = e; gotTop = true; break; }
        }
        if (gotTop && !conc.IsNull()) {
            deferCase("MIXED-CONVEXITY trihedral vertex (concave + convex share a vertex)",
                      lp, {conc, topAt}, 2.0, true,
                      "TWO blended edges", OcctExpect::Succeeds);
        } else {
            check(false, "defer control: could not locate the mixed-convexity pair");
        }
    }
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(30.0, 20.0, 10.0).Shape();
        const std::vector<TopoDS_Edge> es = allEdges(box);
        deferCase("OVER-SIZE convex R=25 (the older convex-path leak)",
                  box, {es[0]}, 25.0, true,
                  "setback exceeds the adjacent face extent", OcctExpect::Declines);
    }
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 8.0).Shape();
        TopoDS_Edge rim; bool got = false;
        for (const TopoDS_Edge& e : allEdges(cyl)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Circle) continue;
            if (std::fabs(c.Value(0.0).Z() - 8.0) < 1e-9) { rim = e; got = true; break; }
        }
        if (got) {
            deferCase("CURVED adjacent face (cylinder top rim -> torus blend)",
                      cyl, {rim}, 1.0, true, "not planar", OcctExpect::Succeeds);
        } else {
            check(false, "defer control: could not locate the cylinder rim");
        }
    }

    std::printf("\n=== %d/%d assertions passed ===\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
