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
//   * TANGENT SEAM: a plain cylinder's u-wrap edge, where ONE face meets ITSELF.
//     There is no material at such an edge, so the only honest answer is to
//     decline. The engine used to return the caller's own shape UNCHANGED with
//     ok==true — a fillet that did nothing, reported as a fillet that worked — and
//     the 600-part corpus A/B scored that as 51 native-only WINS over OCCT, which
//     declines the same request. MEASURED 2026-08-30; see
//     forge-kernel/reports/corpus_ab/FILLET_ATTRIBUTION.md.
//
// MULTI-LUMP CASE. Two disjoint boxes in one compound, blended on an edge of one
// lump. The engine re-sews EVERY face of the input, so a two-lump body sews into
// two shells, and keeping only the first silently deleted the other lump. That was
// the whole 198-part "fillet volume disagrees with the closed form" bucket of the
// same corpus row, where removed-to-expected material ran from 27x to 273x. The
// case asserts the blend now matches OCCT on the full observable vector and that
// BOTH lumps survive.
//
// Exit 0 iff every assertion holds. Build + run with
//   bash forge-kernel/test/run_ab_native_fillet_concave.sh

#include "forge/native/brep/NativeFilletChamfer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <string>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
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

// An EXACT rounded-rectangle prism: four tangent quarter arcs of radius rho joined
// by four straight runs, extruded h along +Z. Every junction is G1 by construction,
// which is what makes the top rim a propagating fillet contour — the shape the
// corpus A/B's 58 "end face not planar" parts all are.
TopoDS_Shape roundedRectPrism(double W, double H, double rho, double h,
                              double holeY = 0.0, double holeR = 0.0) {
    if (!(W > 2.0 * rho) || !(H > 2.0 * rho) || !(rho > 0.0) || !(h > 0.0))
        return TopoDS_Shape();
    const double a = W * 0.5 - rho, b = H * 0.5 - rho;
    const double cx[4] = { a, -a, -a,  a };
    const double cy[4] = { b,  b, -b, -b };
    const double a0[4] = { 0.0, 0.5 * kPi, kPi, 1.5 * kPi };
    BRepBuilderAPI_MakeWire mw;
    for (int i = 0; i < 4; ++i) {
        const gp_Ax2 ax(gp_Pnt(cx[i], cy[i], 0.0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        BRepBuilderAPI_MakeEdge me(gp_Circ(ax, rho), a0[i], a0[i] + 0.5 * kPi);
        if (!me.IsDone()) return TopoDS_Shape();
        mw.Add(me.Edge());
        const int j = (i + 1) % 4;
        const gp_Pnt p1(cx[i] + rho * std::cos(a0[i] + 0.5 * kPi),
                        cy[i] + rho * std::sin(a0[i] + 0.5 * kPi), 0.0);
        const gp_Pnt p2(cx[j] + rho * std::cos(a0[j]), cy[j] + rho * std::sin(a0[j]), 0.0);
        if (p1.Distance(p2) > 1e-12) {
            BRepBuilderAPI_MakeEdge ml(p1, p2);
            if (!ml.IsDone()) return TopoDS_Shape();
            mw.Add(ml.Edge());
        }
    }
    if (!mw.IsDone()) return TopoDS_Shape();
    BRepBuilderAPI_MakeFace mf(mw.Wire(), Standard_True);
    if (!mf.IsDone()) return TopoDS_Shape();
    if (holeR > 0.0) {
        const gp_Ax2 hax(gp_Pnt(0.0, holeY, 0.0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        BRepBuilderAPI_MakeEdge hm(gp_Circ(hax, holeR));
        if (!hm.IsDone()) return TopoDS_Shape();
        BRepBuilderAPI_MakeWire hw(hm.Edge());
        if (!hw.IsDone()) return TopoDS_Shape();
        mf.Add(TopoDS::Wire(hw.Wire().Reversed()));
        if (!mf.IsDone()) return TopoDS_Shape();
    }
    return BRepPrimAPI_MakePrism(mf.Face(), gp_Vec(0, 0, h)).Shape();
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

// Faces binned by SURFACE KIND. This is the observable that separates a CHAMFER rim
// from a FILLET rim: both remove a band from the same cap, both leave 18 faces, and
// a volume or an area can be matched by the wrong surface. `Cone:4` vs `Torus:4` is
// what says which operation actually ran.
std::string faceKinds(const TopoDS_Shape& s) {
    std::map<std::string, int> k;
    // The SAME map `measure()` counts faces with, not a TopExp_Explorer: an explorer
    // visits a face once per containing shell, so a census taken with it could
    // disagree with the nFace assertion sitting next to it.
    TopTools_IndexedMapOfShape mf;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    for (int i = 1; i <= mf.Extent(); ++i) {
        const char* n = "other";
        switch (BRepAdaptor_Surface(TopoDS::Face(mf.FindKey(i))).GetType()) {
            case GeomAbs_Plane:    n = "Plane"; break;
            case GeomAbs_Cylinder: n = "Cyl";   break;
            case GeomAbs_Cone:     n = "Cone";  break;
            case GeomAbs_Sphere:   n = "Sph";   break;
            case GeomAbs_Torus:    n = "Torus"; break;
            default: break;
        }
        k[n]++;
    }
    std::string out;
    for (const auto& p : k) out += p.first + ":" + std::to_string(p.second) + " ";
    if (!out.empty()) out.pop_back();
    return out;
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

    // The OCCT arm must run the SAME OPERATION the native arm just declined: a
    // chamfer control measured against BRepFilletAPI_MakeFillet would record what
    // OCCT does to a DIFFERENT request, which is not a capability gap at all.
    // (Every call site was `fillet == true` when this dispatch was added, so no
    // existing expectation moves; the chamfer controls below are the first users.)
    bool oOk = false;
    try {
        if (fillet) {
            BRepFilletAPI_MakeFillet mk(shape);
            for (const TopoDS_Edge& e : es) mk.Add(R, e);
            mk.Build();
            if (mk.IsDone()) { const TopoDS_Shape s = mk.Shape(); oOk = !s.IsNull(); }
        } else {
            BRepFilletAPI_MakeChamfer mk(shape);
            for (const TopoDS_Edge& e : es) mk.Add(R, e);
            mk.Build();
            if (mk.IsDone()) { const TopoDS_Shape s = mk.Shape(); oOk = !s.IsNull(); }
        }
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
    // ── CO-MOVING PAIR: the batch-path gap the per-edge guard structurally cannot see.
    //    Two OPPOSITE edges of the 30x10 front face (z=0 and z=10, 10 mm apart), R=6.
    //    EACH passes its own clearance test — 6 < 10 against that face and 6 < 20 against
    //    the top/bottom — because setbackFitsFaces compares the ORIGINAL edge with the
    //    ORIGINAL ring. But blendBatch rebuilds the front face ONCE and moves BOTH of its
    //    horizontal boundaries inward by 6, closing a 10 mm face to -2. Only a test on the
    //    PAIR can see it, and this is the control that proves that test fires.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(30.0, 20.0, 10.0).Shape();
        TopoDS_Edge lo, hi;
        bool gotLo = false, gotHi = false;
        for (const TopoDS_Edge& e : allEdges(box)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt p0 = c.Value(c.FirstParameter()), p1 = c.Value(c.LastParameter());
            auto isSeg = [&](const gp_Pnt& a, const gp_Pnt& b) {
                return (p0.Distance(a) < 1e-9 && p1.Distance(b) < 1e-9) ||
                       (p0.Distance(b) < 1e-9 && p1.Distance(a) < 1e-9);
            };
            if (isSeg(gp_Pnt(0, 0, 0), gp_Pnt(30, 0, 0)))   { lo = e; gotLo = true; }
            if (isSeg(gp_Pnt(0, 0, 10), gp_Pnt(30, 0, 10))) { hi = e; gotHi = true; }
        }
        check(gotLo && gotHi, "co-moving control: located both front-face edges");
        if (gotLo && gotHi) {
            // Each edge ALONE must still build at R=6 — otherwise the pair test below
            // would be proving nothing but that a single setback is too large.
            for (int which = 0; which < 2; ++which) {
                std::vector<forge::occtfillet::FilletSpec> one(1);
                one[0].edge = which == 0 ? lo : hi;
                one[0].radius = 6.0;
                const forge::occtfillet::Result r = forge::occtfillet::makeFillet(box, one);
                check(r.ok, std::string("co-moving control: edge ") + (which == 0 ? "LO" : "HI") +
                            " alone at R=6 still BUILDS (got: " +
                            (r.ok ? std::string("ok") : r.reason) + ")");
            }
            // TWO REGIMES, and each trips a DIFFERENT branch of the topological test —
            // both are controlled, because a branch never seen to fire is not a guard.
            //   R=6   the two transverse corner clips on the 20x10 end face OVERLAP ->
            //         the rebuilt ring SELF-INTERSECTS  (BRepCheck_Analyzer)
            //   R=5   exactly half the 10 mm face: the front face collapses to zero
            //         area, winding 400 -> -1.1e-13  -> INSIDE OUT  (winding sign)
            deferCase("CO-MOVING pair, SELF-INTERSECTION regime (R=6 on a 10 mm face)",
                      box, {lo, hi}, 6.0, true,
                      "folds that face through itself", OcctExpect::Declines);
            deferCase("CO-MOVING pair, INVERSION regime (R=5, exactly half the face)",
                      box, {lo, hi}, 5.0, true,
                      "turns that face inside out", OcctExpect::Declines);
            // And the SAME pair at a radius that genuinely fits (6+6 > 10, but 2+2 < 10)
            // must still build — the pair test is a clearance test, not a ban on pairs.
            std::vector<forge::occtfillet::FilletSpec> two(2);
            two[0].edge = lo; two[0].radius = 2.0;
            two[1].edge = hi; two[1].radius = 2.0;
            const forge::occtfillet::Result ok2 = forge::occtfillet::makeFillet(box, two);
            check(ok2.ok, std::string("co-moving control: the SAME pair at R=2 still BUILDS "
                                      "(got: ") + (ok2.ok ? std::string("ok") : ok2.reason) + ")");
        }
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

    // ---- TANGENT SEAM: a cylinder's u-wrap edge is a no-op, not a fillet ------
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 20.0).Shape();
        TopoDS_Edge seam; bool got = false;
        for (const TopoDS_Edge& e : allEdges(cyl)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() == GeomAbs_Line) { seam = e; got = true; break; }
        }
        if (got) {
            deferCase("TANGENT SEAM (a cylinder u-wrap edge: no material to blend)",
                      cyl, {seam}, 0.5, true, "tangent no-op", OcctExpect::Declines);
            // and the specific lie it used to tell: the INPUT, returned unchanged
            std::vector<forge::occtfillet::FilletSpec> sp(1);
            sp[0].edge = seam; sp[0].radius = 0.5;
            const forge::occtfillet::Result r = forge::occtfillet::makeFillet(cyl, sp);
            const double v0 = measure(cyl).vol;
            check(!r.ok || std::fabs(measure(r.shape).vol - v0) > 1e-9,
                  "TANGENT SEAM: the engine does not hand back the INPUT as a success");
        } else {
            check(false, "defer control: could not locate the cylinder seam");
        }
    }

    // ---- MULTI-LUMP: two disjoint boxes; blend one edge of the first lump -----
    {
        const TopoDS_Shape b1 = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 30.0, 20.0, 10.0).Shape();
        const TopoDS_Shape b2 = BRepPrimAPI_MakeBox(gp_Pnt(100, 0, 0), 8.0, 8.0, 8.0).Shape();
        TopoDS_Compound comp;
        BRep_Builder bld;
        bld.MakeCompound(comp);
        bld.Add(comp, b1);
        bld.Add(comp, b2);
        const double R = 2.0;
        TopoDS_Edge pick; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(b1)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); pick = e; }
        }
        std::printf("[multi-lump] two disjoint boxes, fillet R=2 on the longest edge of lump 1\n");
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = pick; sp[0].radius = R;
        const forge::occtfillet::Result nr = forge::occtfillet::makeFillet(comp, sp);
        check(nr.ok, std::string("MULTI-LUMP: engine builds (got: ") +
                     (nr.ok ? std::string("ok") : nr.reason) + ")");
        if (nr.ok) {
            const Metrics m0 = measure(comp), m1 = measure(nr.shape);
            const double moved = (1.0 - kPi / 4.0) * R * R * best;
            check(relClose(m0.vol - m1.vol, moved, 1e-6),
                  "MULTI-LUMP: removes exactly (1-pi/4)R^2 L");
            check(m1.nFace == m0.nFace + 1,
                  "MULTI-LUMP: BOTH lumps survive (6+6 faces -> 7+6)");
            TopoDS_Shape occtOut;
            try {
                BRepFilletAPI_MakeFillet mk(comp);
                mk.Add(R, pick);
                mk.Build();
                if (mk.IsDone()) occtOut = mk.Shape();
            } catch (...) {}
            check(!occtOut.IsNull(), "MULTI-LUMP: OCCT builds the same request");
            if (!occtOut.IsNull())
                check(sameMetrics(m1, measure(occtOut), "MULTI-LUMP"),
                      "MULTI-LUMP: native == OCCT on the full observable vector");
        }
    }

    // ---- TANGENT RIM: a rounded-rectangle prism, blended all the way round -----
    //
    // ★ MEASURED 2026-08-30 over the 600-part corpus A/B: 58 of the 117 parts left in
    //   the FILLET deletion bucket are this shape, and all 58 declined with the same
    //   guard ("end face not planar") because the face at each end of the picked edge
    //   is the corner cylinder, not a plane. The right answer is not a clipped
    //   one-edge blend: the rim is G1-tangent, so OCCT's BRepFilletAPI PROPAGATES the
    //   contour and removes 2.53x-4.11x what one edge would. This case pins the whole
    //   rim — 4 cylinder patches + 4 torus patches — against OCCT and against a
    //   closed form that shares no code with the engine.
    {
        struct RimCase { double W, H, rho, h, R; const char* tag; };
        const RimCase cases[] = {
            { 60.0, 40.0,  8.0, 15.0, 3.0, "RIM 60x40 rho=8 h=15 R=3" },
            {100.0, 70.0, 20.0, 30.0, 5.0, "RIM 100x70 rho=20 h=30 R=5" },
        };
        for (const RimCase& rc : cases) {
            std::printf("[rim] %s\n", rc.tag);
            const TopoDS_Shape prism = roundedRectPrism(rc.W, rc.H, rc.rho, rc.h);
            check(!prism.IsNull(), std::string(rc.tag) + ": the input prism builds");
            if (prism.IsNull()) continue;
            // pick the longest LINE edge of the top rim — the corpus A/B's own rule
            TopoDS_Edge pick; double best = 0.0;
            for (const TopoDS_Edge& e : allEdges(prism)) {
                BRepAdaptor_Curve c(e);
                if (c.GetType() != GeomAbs_Line) continue;
                GProp_GProps g; BRepGProp::LinearProperties(e, g);
                const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
                if (std::fabs(mid.Z() - rc.h) > 1e-9) continue;      // top rim only
                if (g.Mass() > best) { best = g.Mass(); pick = e; }
            }
            check(!pick.IsNull(), std::string(rc.tag) + ": a top-rim straight edge exists");
            if (pick.IsNull()) continue;

            std::vector<forge::occtfillet::FilletSpec> sp(1);
            sp[0].edge = pick; sp[0].radius = rc.R;
            const forge::occtfillet::Result nr = forge::occtfillet::makeFillet(prism, sp);
            check(nr.ok, std::string(rc.tag) + ": engine builds (got: " +
                         (nr.ok ? std::string("ok") : nr.reason) + ")");
            if (!nr.ok) continue;
            check(nr.reason.find("rim fillet") != std::string::npos,
                  std::string(rc.tag) + ": answered by the RIM path, named as such");

            // INDEPENDENT closed form, from the profile alone:
            //   4 straight runs  (1-pi/4) R^2 L
            // + 4 quarter corners theta * [R^2(2rho-R)/2 - R^3/3 - (rho-R) pi R^2/4]
            const double lineL = 2.0 * (rc.W - 2.0 * rc.rho) + 2.0 * (rc.H - 2.0 * rc.rho);
            const double corner = 4.0 * (0.5 * kPi) *
                (rc.R * rc.R * (2.0 * rc.rho - rc.R) * 0.5 - rc.R * rc.R * rc.R / 3.0
                 - (rc.rho - rc.R) * kPi * rc.R * rc.R * 0.25);
            const double want = (1.0 - kPi / 4.0) * rc.R * rc.R * lineL + corner;

            const Metrics m0 = measure(prism), m1 = measure(nr.shape);
            check(relClose(m0.vol - m1.vol, want, 1e-9),
                  std::string(rc.tag) + ": removes exactly the rim closed form");
            check(m1.nFace == m0.nFace + 8,
                  std::string(rc.tag) + ": 10 faces -> 18 (4 cylinder + 4 torus patches added)");
            check(m1.valid && m1.closedShells && m1.nShell == 1,
                  std::string(rc.tag) + ": native is ONE closed valid shell");
            check(m1.genus2 == 0, std::string(rc.tag) + ": native genus 0");

            TopoDS_Shape occtOut;
            try {
                BRepFilletAPI_MakeFillet mk(prism);
                mk.Add(rc.R, pick);
                mk.Build();
                if (mk.IsDone()) occtOut = mk.Shape();
            } catch (...) {}
            check(!occtOut.IsNull(), std::string(rc.tag) + ": OCCT propagates the same request");
            if (!occtOut.IsNull())
                check(sameMetrics(m1, measure(occtOut), rc.tag),
                      std::string(rc.tag) + ": native == OCCT on the full observable vector");
        }
    }

    // ---- RIM defer controls ---------------------------------------------------
    // The rim path must not fire outside its stated scope, and — the property that
    // keeps it from changing any answer the per-edge path already gives — must not
    // substitute itself for a request the per-edge path can serve.
    {
        // (a) a PLAIN BOX lid. Its rim is a polygon: NOT tangent-continuous, so OCCT
        //     does not propagate and neither may we. The per-edge path answers it,
        //     and the reason must say so.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(30.0, 20.0, 10.0).Shape();
        TopoDS_Edge top; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(box)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 10.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); top = e; }
        }
        std::printf("[rim-defer] a plain box lid is a POLYGON rim, not a propagating contour\n");
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = top; sp[0].radius = 2.0;
        const forge::occtfillet::Result nr = forge::occtfillet::makeFillet(box, sp);
        check(nr.ok, "BOX LID: the per-edge path still answers it");
        check(nr.ok && nr.reason.find("rim fillet") == std::string::npos,
              "BOX LID: the RIM path did not substitute itself for the per-edge answer");
        if (nr.ok) {
            const double moved = (1.0 - kPi / 4.0) * 2.0 * 2.0 * best;
            check(relClose(measure(box).vol - measure(nr.shape).vol, moved, 1e-9),
                  "BOX LID: still removes exactly the ONE-EDGE closed form");
        }
    }
    {
        // (b) corner radius NOT larger than the fillet radius: the offset ring would
        //     collapse. OCCT declines this too.
        const TopoDS_Shape prism = roundedRectPrism(60.0, 40.0, 2.5, 15.0);
        TopoDS_Edge pick; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(prism)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 15.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); pick = e; }
        }
        // MEASURED: OCCT blends this and the native rim path cannot — the inward
        // offset of a corner of radius rho by R >= rho inverts the arc, and an
        // inverted arc is not the profile. An honest gap, pinned so it stays visible.
        if (!pick.IsNull())
            deferCase("RIM rho <= R (the corner would invert)", prism, {pick}, 3.0, true,
                      "corner radius is not larger", OcctExpect::Succeeds);
        else
            check(false, "rim defer control: could not locate a top-rim edge");
    }
    {
        // (d) A HOLE CLOSER TO THE RIM THAN R — the defect the volume and area checks
        //     could not see. MEASURED 2026-08-30 over the 600-part corpus: on 21 parts
        //     the cap's nearest hole lies closer to the rim than R (ratio 0.104 to
        //     1.000 of R, against 1.000 to 10.59 on the parts that are fine), so the
        //     inward offset ring crosses that hole's wire. The removed volume STILL
        //     matched the closed form to the last printed digit on all 21, because
        //     both the volume and the cap-area identity are computed as (outer region)
        //     minus (hole regions) — the same subtraction whether or not the regions
        //     overlap. BRepCheck_Analyzer reports `IntersectingWires` on one planar
        //     face, 21/21. The guard is that topological reading, and this case is the
        //     proof it fires: the hole's edge sits 0.5R from the straight rim.
        const double R = 3.0, rho = 8.0, W = 60.0, H = 40.0, hgt = 15.0;
        const double holeR = 4.0;
        const double holeY = H * 0.5 - (holeR + 0.5 * R);   // hole edge 0.5R from the rim
        const TopoDS_Shape prism = roundedRectPrism(W, H, rho, hgt, holeY, holeR);
        check(!prism.IsNull(), "RIM hole-inside-band: the holed prism builds");
        if (!prism.IsNull()) {
            TopoDS_Edge pick; double best = 0.0;
            for (const TopoDS_Edge& e : allEdges(prism)) {
                BRepAdaptor_Curve c(e);
                if (c.GetType() != GeomAbs_Line) continue;
                const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
                if (std::fabs(mid.Z() - hgt) > 1e-9) continue;
                GProp_GProps g; BRepGProp::LinearProperties(e, g);
                if (g.Mass() > best) { best = g.Mass(); pick = e; }
            }
            if (!pick.IsNull())
                deferCase("RIM a hole lies inside the blend band", prism, {pick}, R, true,
                          "runs into a hole", OcctExpect::Succeeds);
            else
                check(false, "rim defer control: could not locate a rim edge on the holed prism");
        }
    }
    {
        // (e) THE SAME PRISM with the hole moved out to 1.5R — the guard must not be
        //     a blanket refusal of holed caps. It must build, keep the hole, and match
        //     OCCT on the full observable vector.
        const double R = 3.0, rho = 8.0, W = 60.0, H = 40.0, hgt = 15.0;
        const double holeR = 4.0;
        const double holeY = H * 0.5 - (holeR + 1.5 * R);
        const TopoDS_Shape prism = roundedRectPrism(W, H, rho, hgt, holeY, holeR);
        check(!prism.IsNull(), "RIM hole-clear-of-band: the holed prism builds");
        if (!prism.IsNull()) {
            TopoDS_Edge pick; double best = 0.0;
            for (const TopoDS_Edge& e : allEdges(prism)) {
                BRepAdaptor_Curve c(e);
                if (c.GetType() != GeomAbs_Line) continue;
                const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
                if (std::fabs(mid.Z() - hgt) > 1e-9) continue;
                GProp_GProps g; BRepGProp::LinearProperties(e, g);
                if (g.Mass() > best) { best = g.Mass(); pick = e; }
            }
            std::printf("[rim] holed prism, hole edge 1.5R clear of the rim\n");
            std::vector<forge::occtfillet::FilletSpec> sp(1);
            sp[0].edge = pick; sp[0].radius = R;
            const forge::occtfillet::Result nr = forge::occtfillet::makeFillet(prism, sp);
            check(nr.ok, std::string("RIM hole-clear-of-band: engine builds (got: ") +
                         (nr.ok ? std::string("ok") : nr.reason) + ")");
            if (nr.ok) {
                const double lineL = 2.0 * (W - 2.0 * rho) + 2.0 * (H - 2.0 * rho);
                const double corner = 4.0 * (0.5 * kPi) *
                    (R * R * (2.0 * rho - R) * 0.5 - R * R * R / 3.0
                     - (rho - R) * kPi * R * R * 0.25);
                const double want = (1.0 - kPi / 4.0) * R * R * lineL + corner;
                const Metrics m0 = measure(prism), m1 = measure(nr.shape);
                check(relClose(m0.vol - m1.vol, want, 1e-9),
                      "RIM hole-clear-of-band: removes exactly the rim closed form");
                check(m1.valid, "RIM hole-clear-of-band: native is BRepCheck-VALID");
                TopoDS_Shape occtOut;
                try {
                    BRepFilletAPI_MakeFillet mk(prism);
                    mk.Add(R, pick);
                    mk.Build();
                    if (mk.IsDone()) occtOut = mk.Shape();
                } catch (...) {}
                check(!occtOut.IsNull(), "RIM hole-clear-of-band: OCCT builds it too");
                if (!occtOut.IsNull())
                    check(sameMetrics(m1, measure(occtOut), "RIM hole-clear-of-band"),
                          "RIM hole-clear-of-band: native == OCCT on the full observable vector");
            }
        }
    }
    {
        // (c) a wall shallower than R: the pull-back would run off the bottom.
        const TopoDS_Shape prism = roundedRectPrism(60.0, 40.0, 8.0, 2.0);
        TopoDS_Edge pick; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(prism)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 2.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); pick = e; }
        }
        if (!pick.IsNull())
            deferCase("RIM wall shallower than R", prism, {pick}, 3.0, true,
                      "shallower than the blend setback", OcctExpect::Declines);
        else
            check(false, "rim defer control: could not locate a shallow-wall rim edge");
    }

    // ---- TANGENT RIM, CHAMFER: the other half of the same seam ----------------
    //
    // ★ MEASURED 2026-09-04 over the same 600-part corpus A/B that motivated the
    //   FILLET rim above. CHAMFER's single largest remaining defer class is "end
    //   face is not a straight-boundary corner", n=67 of 347 defers, and those 67
    //   are the SAME rounded-rectangle plates the FILLET rim path answers — one
    //   adjacent face is the flat cap with an 8-segment ring (4 lines + 4 arcs),
    //   the other a flat wall, and the face at each END of the picked edge is the
    //   corner CYLINDER (a SurfOfExtrusion, flatness deviation 2.07-4.42 mm), not a
    //   plane. The per-edge guard fires for exactly the right reason and the right
    //   answer is the propagated rim.
    //
    //   WHAT THIS PINS, and why the volume alone could not: the chamfer rim and the
    //   fillet rim remove a band from the SAME cap, leave the SAME 18 faces, and
    //   agree on the SAME closed-form structure. What separates them is the SURFACE
    //   KIND — 4 CONE patches where the fillet has 4 TORUS patches, 4 PLANE bevels
    //   where it has 4 CYLINDERS — so the face-kind census is asserted beside the
    //   metrics. A rim built with the wrong patch would still sew, still close, and
    //   still hit a volume that a loose tolerance would accept.
    {
        struct RimCase { double W, H, rho, h, d; const char* tag; };
        const RimCase cases[] = {
            { 60.0, 40.0,  8.0, 15.0, 3.0, "RIMCHAM 60x40 rho=8 h=15 d=3" },
            {100.0, 70.0, 20.0, 30.0, 5.0, "RIMCHAM 100x70 rho=20 h=30 d=5" },
            { 60.0, 40.0,  8.0, 15.0, 1.5, "RIMCHAM 60x40 rho=8 h=15 d=1.5" },
        };
        for (const RimCase& rc : cases) {
            std::printf("[rim-chamfer] %s\n", rc.tag);
            const TopoDS_Shape prism = roundedRectPrism(rc.W, rc.H, rc.rho, rc.h);
            check(!prism.IsNull(), std::string(rc.tag) + ": the input prism builds");
            if (prism.IsNull()) continue;
            // the SAME pick rule the corpus A/B uses: the longest straight top-rim edge
            TopoDS_Edge pick; double best = 0.0;
            for (const TopoDS_Edge& e : allEdges(prism)) {
                BRepAdaptor_Curve c(e);
                if (c.GetType() != GeomAbs_Line) continue;
                const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
                if (std::fabs(mid.Z() - rc.h) > 1e-9) continue;
                GProp_GProps g; BRepGProp::LinearProperties(e, g);
                if (g.Mass() > best) { best = g.Mass(); pick = e; }
            }
            check(!pick.IsNull(), std::string(rc.tag) + ": a top-rim straight edge exists");
            if (pick.IsNull()) continue;

            std::vector<forge::occtfillet::ChamferSpec> sp(1);
            sp[0].edge = pick; sp[0].dist = rc.d; sp[0].dist2 = 0.0;
            const forge::occtfillet::Result nr = forge::occtfillet::makeChamfer(prism, sp);
            check(nr.ok, std::string(rc.tag) + ": engine builds (got: " +
                         (nr.ok ? std::string("ok") : nr.reason) + ")");
            if (!nr.ok) continue;
            check(nr.reason.find("rim chamfer") != std::string::npos,
                  std::string(rc.tag) + ": answered by the RIM path, named as such");

            // INDEPENDENT closed form, from the profile alone and sharing no code
            // with the engine:
            //   4 straight runs   d^2/2 * L
            // + 4 quarter corners theta * 1/2 [ rho^2 d - (rho^3 - (rho-d)^3)/3 ]
            const double lineL = 2.0 * (rc.W - 2.0 * rc.rho) + 2.0 * (rc.H - 2.0 * rc.rho);
            const double aa    = rc.rho - rc.d;
            const double corner = 4.0 * (0.5 * kPi) * 0.5 *
                (rc.rho * rc.rho * rc.d - (rc.rho * rc.rho * rc.rho - aa * aa * aa) / 3.0);
            const double want = 0.5 * rc.d * rc.d * lineL + corner;

            const Metrics m0 = measure(prism), m1 = measure(nr.shape);
            check(relClose(m0.vol - m1.vol, want, 1e-9),
                  std::string(rc.tag) + ": removes exactly the CHAMFER rim closed form");
            // ★ The closed form must not merely be satisfiable by the fillet answer.
            //   Asserting they DIFFER is what stops the chamfer row from being green
            //   because the engine quietly ran the blend it already knew how to run.
            const double filletWant = (1.0 - kPi / 4.0) * rc.d * rc.d * lineL +
                4.0 * (0.5 * kPi) * (rc.d * rc.d * (2.0 * rc.rho - rc.d) * 0.5
                    - rc.d * rc.d * rc.d / 3.0 - aa * kPi * rc.d * rc.d * 0.25);
            check(!relClose(want, filletWant, 1e-3),
                  std::string(rc.tag) + ": the chamfer closed form is DISTINCT from the fillet one");
            check(m1.nFace == m0.nFace + 8,
                  std::string(rc.tag) + ": 10 faces -> 18 (4 bevel + 4 cone patches added)");
            // THE KIND CENSUS — see the note above. Plane 6 -> 10 (4 flat bevels),
            // Cyl 4 unchanged (the corner walls, pulled back), Cone 0 -> 4.
            check(faceKinds(nr.shape) == "Cone:4 Cyl:4 Plane:10",
                  std::string(rc.tag) + ": faces by KIND are Cone:4 Cyl:4 Plane:10 (got " +
                  faceKinds(nr.shape) + ")");
            check(faceKinds(nr.shape).find("Torus") == std::string::npos,
                  std::string(rc.tag) + ": NO torus patch — this is a chamfer, not a fillet");
            check(m1.valid && m1.closedShells && m1.nShell == 1,
                  std::string(rc.tag) + ": native is ONE closed valid shell");
            check(m1.genus2 == 0, std::string(rc.tag) + ": native genus 0");

            TopoDS_Shape occtOut;
            try {
                BRepFilletAPI_MakeChamfer mk(prism);
                mk.Add(rc.d, pick);
                mk.Build();
                if (mk.IsDone()) occtOut = mk.Shape();
            } catch (...) {}
            check(!occtOut.IsNull(), std::string(rc.tag) + ": OCCT propagates the same request");
            if (!occtOut.IsNull()) {
                check(sameMetrics(m1, measure(occtOut), rc.tag),
                      std::string(rc.tag) + ": native == OCCT on the full observable vector");
                check(faceKinds(nr.shape) == faceKinds(occtOut),
                      std::string(rc.tag) + ": native == OCCT on the face-KIND census (got " +
                      faceKinds(nr.shape) + " vs " + faceKinds(occtOut) + ")");
            }
        }
    }

    // ---- RIM CHAMFER defer controls -------------------------------------------
    // Same contract as the fillet rim's: the path must not fire outside its stated
    // scope, and must never substitute itself for a request the per-edge path serves.
    {
        // (a) a PLAIN BOX lid — a POLYGON rim, not a propagating contour. The
        //     per-edge chamfer already answers it and must keep answering it.
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(30.0, 20.0, 10.0).Shape();
        TopoDS_Edge top; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(box)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 10.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); top = e; }
        }
        std::printf("[rim-chamfer-defer] a plain box lid is a POLYGON rim\n");
        std::vector<forge::occtfillet::ChamferSpec> sp(1);
        sp[0].edge = top; sp[0].dist = 2.0; sp[0].dist2 = 0.0;
        const forge::occtfillet::Result nr = forge::occtfillet::makeChamfer(box, sp);
        check(nr.ok, "BOX LID chamfer: the per-edge path still answers it");
        check(nr.ok && nr.reason.find("rim chamfer") == std::string::npos,
              "BOX LID chamfer: the RIM path did not substitute itself for the per-edge answer");
        if (nr.ok) {
            const double moved = 0.5 * 2.0 * 2.0 * best;
            check(relClose(measure(box).vol - measure(nr.shape).vol, moved, 1e-9),
                  "BOX LID chamfer: still removes exactly the ONE-EDGE closed form");
        }
    }
    {
        // (b) rho <= d: the inward offset would invert the corner arc.
        //     MEASURED 2026-09-04: OCCT's chamfer RETURNS a shape here and that shape
        //     is BRepCheck-INVALID (volume 35273.13 on a 35175.93 input — it ADDS
        //     material). So this is not a capability we are giving up: it is one
        //     where declining is the better answer, and OcctExpect::Succeeds records
        //     that OCCT answers at all rather than that its answer is usable.
        const TopoDS_Shape prism = roundedRectPrism(60.0, 40.0, 2.5, 15.0);
        TopoDS_Edge pick; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(prism)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 15.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); pick = e; }
        }
        if (!pick.IsNull()) {
            deferCase("RIMCHAM rho <= d (the corner would invert)", prism, {pick}, 3.0, false,
                      "corner radius is not larger", OcctExpect::Succeeds);
            TopoDS_Shape oc;
            try {
                BRepFilletAPI_MakeChamfer mk(prism);
                mk.Add(3.0, pick); mk.Build();
                if (mk.IsDone()) oc = mk.Shape();
            } catch (...) {}
            check(!oc.IsNull() && !measure(oc).valid,
                  "RIMCHAM rho <= d: OCCT's own answer here is BRepCheck-INVALID "
                  "(declining is the better answer, not a lost capability)");
        } else {
            check(false, "rim-chamfer defer control: could not locate a top-rim edge");
        }
    }
    {
        // (c) a wall shallower than d: the pull-back would run off the bottom.
        //     OCCT declines this too.
        const TopoDS_Shape prism = roundedRectPrism(60.0, 40.0, 8.0, 2.0);
        TopoDS_Edge pick; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(prism)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 2.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); pick = e; }
        }
        if (!pick.IsNull())
            deferCase("RIMCHAM wall shallower than d", prism, {pick}, 3.0, false,
                      "shallower than the blend setback", OcctExpect::Declines);
        else
            check(false, "rim-chamfer defer control: could not locate a shallow-wall rim edge");
    }
    {
        // (d) A HOLE CLOSER TO THE RIM THAN d — the topological defect neither the
        //     volume nor the cap-area identity can see, because both are computed as
        //     (outer region) minus (hole regions), the same subtraction whether or
        //     not the regions overlap. MEASURED: OCCT's chamfer declines it as well.
        const double d = 3.0, rho = 8.0, W = 60.0, H = 40.0, hgt = 15.0, holeR = 4.0;
        const double holeY = H * 0.5 - (holeR + 0.5 * d);   // hole edge 0.5d from the rim
        const TopoDS_Shape prism = roundedRectPrism(W, H, rho, hgt, holeY, holeR);
        check(!prism.IsNull(), "RIMCHAM hole-inside-band: the holed prism builds");
        if (!prism.IsNull()) {
            TopoDS_Edge pick; double best = 0.0;
            for (const TopoDS_Edge& e : allEdges(prism)) {
                BRepAdaptor_Curve c(e);
                if (c.GetType() != GeomAbs_Line) continue;
                const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
                if (std::fabs(mid.Z() - hgt) > 1e-9) continue;
                GProp_GProps g; BRepGProp::LinearProperties(e, g);
                if (g.Mass() > best) { best = g.Mass(); pick = e; }
            }
            if (!pick.IsNull())
                deferCase("RIMCHAM a hole lies inside the blend band", prism, {pick}, d, false,
                          "runs into a hole", OcctExpect::Declines);
            else
                check(false, "rim-chamfer defer control: could not locate a rim edge on the holed prism");
        }
    }
    {
        // (e) THE SAME PRISM with the hole moved out to 1.5d — the guard must be a
        //     clearance test, not a blanket refusal of holed caps.
        const double d = 3.0, rho = 8.0, W = 60.0, H = 40.0, hgt = 15.0, holeR = 4.0;
        const double holeY = H * 0.5 - (holeR + 1.5 * d);
        const TopoDS_Shape prism = roundedRectPrism(W, H, rho, hgt, holeY, holeR);
        check(!prism.IsNull(), "RIMCHAM hole-clear-of-band: the holed prism builds");
        if (!prism.IsNull()) {
            TopoDS_Edge pick; double best = 0.0;
            for (const TopoDS_Edge& e : allEdges(prism)) {
                BRepAdaptor_Curve c(e);
                if (c.GetType() != GeomAbs_Line) continue;
                const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
                if (std::fabs(mid.Z() - hgt) > 1e-9) continue;
                GProp_GProps g; BRepGProp::LinearProperties(e, g);
                if (g.Mass() > best) { best = g.Mass(); pick = e; }
            }
            std::printf("[rim-chamfer] holed prism, hole edge 1.5d clear of the rim\n");
            std::vector<forge::occtfillet::ChamferSpec> sp(1);
            sp[0].edge = pick; sp[0].dist = d; sp[0].dist2 = 0.0;
            const forge::occtfillet::Result nr = forge::occtfillet::makeChamfer(prism, sp);
            check(nr.ok, std::string("RIMCHAM hole-clear-of-band: engine builds (got: ") +
                         (nr.ok ? std::string("ok") : nr.reason) + ")");
            if (nr.ok) {
                const double lineL = 2.0 * (W - 2.0 * rho) + 2.0 * (H - 2.0 * rho);
                const double aa = rho - d;
                const double want = 0.5 * d * d * lineL + 4.0 * (0.5 * kPi) * 0.5 *
                    (rho * rho * d - (rho * rho * rho - aa * aa * aa) / 3.0);
                const Metrics m0 = measure(prism), m1 = measure(nr.shape);
                check(relClose(m0.vol - m1.vol, want, 1e-9),
                      "RIMCHAM hole-clear-of-band: removes exactly the rim closed form");
                check(m1.valid, "RIMCHAM hole-clear-of-band: native is BRepCheck-VALID");
                TopoDS_Shape occtOut;
                try {
                    BRepFilletAPI_MakeChamfer mk(prism);
                    mk.Add(d, pick); mk.Build();
                    if (mk.IsDone()) occtOut = mk.Shape();
                } catch (...) {}
                check(!occtOut.IsNull(), "RIMCHAM hole-clear-of-band: OCCT builds it too");
                if (!occtOut.IsNull())
                    check(sameMetrics(m1, measure(occtOut), "RIMCHAM hole-clear-of-band"),
                          "RIMCHAM hole-clear-of-band: native == OCCT on the full observable vector");
            }
        }
    }
    {
        // (f) AN ASYMMETRIC CHAMFER — a DECLARED scope limit, pinned so it stays
        //     visible. buildRimContext resolves ONE setback: its offset ring, its
        //     wall-depth guard and its band-clearance guard are all written against
        //     that one number. Serving dA != dB off it would build a body whose bevel
        //     is not the requested bevel, and a wrong body is far worse than a defer.
        const TopoDS_Shape prism = roundedRectPrism(60.0, 40.0, 8.0, 15.0);
        TopoDS_Edge pick; double best = 0.0;
        for (const TopoDS_Edge& e : allEdges(prism)) {
            BRepAdaptor_Curve c(e);
            if (c.GetType() != GeomAbs_Line) continue;
            const gp_Pnt mid = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
            if (std::fabs(mid.Z() - 15.0) > 1e-9) continue;
            GProp_GProps g; BRepGProp::LinearProperties(e, g);
            if (g.Mass() > best) { best = g.Mass(); pick = e; }
        }
        std::printf("[rim-chamfer-defer] an ASYMMETRIC chamfer is out of the rim's scope\n");
        std::vector<forge::occtfillet::ChamferSpec> sp(1);
        sp[0].edge = pick; sp[0].dist = 3.0; sp[0].dist2 = 2.0;
        const forge::occtfillet::Result nr = forge::occtfillet::makeChamfer(prism, sp);
        check(!nr.ok, "RIMCHAM asymmetric: engine DEFERS");
        check(!nr.ok && nr.reason.find("asymmetric chamfer is not a single-setback rim")
                            != std::string::npos,
              "RIMCHAM asymmetric: the deferral names the scope limit");
        // and the SYMMETRIC request on the same edge still builds, so (f) is a
        // statement about the argument and not about the shape.
        sp[0].dist2 = 0.0;
        const forge::occtfillet::Result sym = forge::occtfillet::makeChamfer(prism, sp);
        check(sym.ok && sym.reason.find("rim chamfer") != std::string::npos,
              "RIMCHAM asymmetric: the SYMMETRIC request on the same edge still builds by the rim");
    }

    std::printf("\n=== %d/%d assertions passed ===\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
