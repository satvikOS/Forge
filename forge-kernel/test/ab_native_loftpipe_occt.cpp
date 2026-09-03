// forge-kernel/test/ab_native_loftpipe_occt.cpp
//
// LIVE-OCCT A/B for TKOffset families D and F —
//   forge::occtloft::thruSections  vs  BRepOffsetAPI_ThruSections
//   forge::occtloft::pipeShell     vs  BRepOffsetAPI_MakePipeShell
// on the SAME inputs, in ONE process.
//
// WHY EACH ASSERTION EXISTS. Volume alone proves nothing — this repo has already
// measured a wrong solid matching the right volume to ten significant figures.
// So each case asserts, in this order:
//
//   1. VOLUME    native == OCCT            (relative, 1e-9)
//   2. VOLUME    native == CLOSED FORM     (relative, 1e-9) where one exists —
//                a second, INDEPENDENT oracle, because OCCT is demonstrably not
//                always a valid oracle for its own TKOffset family (see case
//                "ps-elbow" below, and TKOFFSET_DECOMPOSITION.md §4.2)
//   3. POSITION  centre of mass, componentwise (absolute, 1e-7 mm)
//   4. POSITION  axis-aligned bounding box, all six bounds (absolute, 1e-7 mm) —
//                what catches a body of the right size in the wrong place
//   5. TOPOLOGY  face / edge / vertex / shell counts native == OCCT, shells
//                closed where a solid is expected, and BRepCheck_Analyzer valid
//
// NEGATIVE CONTROL. Case "control" feeds the comparator two solids whose volumes
// agree to ten significant figures and whose geometry does not, and asserts the
// comparator REJECTS them. A gate that cannot fail is not a gate.
//
// DEFER CONTROL. Eight cases in the "defer controls" block assert the engine
// returns a NULL shape on inputs outside its stated scope (non-planar lateral
// quad, mismatched section vertex counts, circle pairs whose centres are off the
// common axis / whose axes are not parallel / whose wire origins sit at different
// polar angles, a smoothed 3-section loft, a guided pipe-shell, an open section
// wire). A defer contract that is never exercised is a comment, not a contract.
// Each of the three circle-pair declines carries its own control proving OCCT
// DOES answer for that input, so none of them is a decline the engine gets for
// free on an impossible input.
// (The banner said FOUR for a long time while there were six; the count is now
// stated from the assertions rather than from memory.)
//
// Exit 0 iff every assertion holds. Build + run with
//   bash forge-kernel/test/run_ab_native_loftpipe.sh

#include "forge/native/brep/NativeLoftPipe.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <gp_Cylinder.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

namespace {

int g_pass = 0, g_total = 0;

const double kPi = 3.14159265358979323846;

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

    m.closedShells = ms.Extent() > 0;
    for (int i = 1; i <= ms.Extent(); ++i)
        if (!BRep_Tool::IsClosed(ms.FindKey(i))) m.closedShells = false;

    m.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True;
    return m;
}

// The comparator every case runs. Returns the number of FAILED sub-assertions so
// the negative control can assert it returns > 0.
int compareAB(const std::string& tag, const Metrics& n, const Metrics& o,
              bool wantClosed, bool report) {
    int bad = 0;
    auto sub = [&](bool ok, const std::string& what) {
        if (!ok) ++bad;
        if (report) check(ok, tag + " " + what);
    };
    sub(relClose(n.vol, o.vol, 1.0e-9), "volume native==OCCT");
    for (int k = 0; k < 3; ++k)
        sub(std::fabs(n.com[k] - o.com[k]) <= 1.0e-7,
            std::string("centre-of-mass ") + "xyz"[k] + " native==OCCT");
    static const char* bbn[6] = {"xmin", "ymin", "zmin", "xmax", "ymax", "zmax"};
    for (int k = 0; k < 6; ++k)
        sub(std::fabs(n.bb[k] - o.bb[k]) <= 1.0e-7,
            std::string("bbox ") + bbn[k] + " native==OCCT");
    sub(n.nFace == o.nFace, "face count native==OCCT");
    sub(n.nEdge == o.nEdge, "edge count native==OCCT");
    sub(n.nVert == o.nVert, "vertex count native==OCCT");
    sub(n.nShell == o.nShell, "shell count native==OCCT");
    if (wantClosed) {
        sub(n.closedShells, "native shell CLOSED");
        sub(o.closedShells, "OCCT shell CLOSED");
    } else {
        sub(n.closedShells == o.closedShells, "native/OCCT shell closedness agrees");
    }
    sub(n.valid, "native shape VALID (BRepCheck_Analyzer)");
    return bad;
}

// ---------------------------------------------------------------- shapes
TopoDS_Wire rectWire(double x0, double y0, double z, double w, double h) {
    BRepBuilderAPI_MakePolygon p;
    p.Add(gp_Pnt(x0, y0, z));
    p.Add(gp_Pnt(x0 + w, y0, z));
    p.Add(gp_Pnt(x0 + w, y0 + h, z));
    p.Add(gp_Pnt(x0, y0 + h, z));
    p.Close();
    return p.Wire();
}

TopoDS_Wire polyWire(const std::vector<gp_Pnt>& pts) {
    BRepBuilderAPI_MakePolygon p;
    for (const gp_Pnt& q : pts) p.Add(q);
    p.Close();
    return p.Wire();
}

// A whole CIRCLE as one edge, and an OBROUND (two lines + two semicircular arcs).
// Both exist for the translated-section path: every wire above is all-line-edged,
// so nothing here reached the code that covers 189 of the 258 corpus parts the
// THRUSECTIONS drop was deleting.
TopoDS_Wire circleWire(double r, double z) {
    const gp_Circ c(gp_Ax2(gp_Pnt(0.0, 0.0, z), gp_Dir(0, 0, 1)), r);
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(c).Edge()).Wire();
}
// The same circle with the frame stated EXPLICITLY. The coaxial-circle cases
// below turn each of the three frame degrees of freedom in turn — centre off the
// axis, axis tilted, seam (the wire's origin direction) rotated — so each is a
// separate, named input rather than three variations hidden in one helper.
TopoDS_Wire circleWireAx(double r, const gp_Pnt& c, const gp_Dir& axis,
                         const gp_Dir& xdir) {
    const gp_Circ k(gp_Ax2(c, axis, xdir), r);
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(k).Edge()).Wire();
}
// Straight length L between the arc centres, radius r; area = 2 r L + pi r^2.
TopoDS_Wire obroundWire(double L, double r, double z) {
    const double hx = 0.5 * L;
    const gp_Circ cr(gp_Ax2(gp_Pnt(hx, 0.0, z), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), r);
    const gp_Circ cl(gp_Ax2(gp_Pnt(-hx, 0.0, z), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), r);
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(-hx, -r, z), gp_Pnt(hx, -r, z)).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(cr, -M_PI / 2.0, M_PI / 2.0).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(hx, r, z), gp_Pnt(-hx, r, z)).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(cl, M_PI / 2.0, 3.0 * M_PI / 2.0).Edge());
    return mw.Wire();
}

TopoDS_Wire regularNgon(int n, double r, double z) {
    std::vector<gp_Pnt> pts;
    for (int i = 0; i < n; ++i) {
        const double a = 2.0 * M_PI * static_cast<double>(i) / static_cast<double>(n);
        pts.push_back(gp_Pnt(r * std::cos(a), r * std::sin(a), z));
    }
    return polyWire(pts);
}

// ---------------------------------------------------------------- incumbents
TopoDS_Shape occtThru(const std::vector<TopoDS_Shape>& sections, bool solid, bool ruled) {
    BRepOffsetAPI_ThruSections mk(solid ? Standard_True : Standard_False,
                                  ruled ? Standard_True : Standard_False, 1.0e-6);
    for (const TopoDS_Shape& s : sections) {
        if (s.ShapeType() == TopAbs_VERTEX) mk.AddVertex(TopoDS::Vertex(s));
        else                                mk.AddWire(TopoDS::Wire(s));
    }
    mk.Build();
    if (!mk.IsDone()) return TopoDS_Shape();
    return mk.Shape();
}

TopoDS_Shape occtPipeShell(const TopoDS_Wire& spine, const TopoDS_Shape& profile,
                           bool makeSolid) {
    BRepOffsetAPI_MakePipeShell mk(spine);
    mk.Add(profile);
    mk.Build();
    if (!mk.IsDone()) return TopoDS_Shape();
    if (makeSolid) mk.MakeSolid();
    return mk.Shape();
}

// ---------------------------------------------------------------- runners
void runThru(const std::string& tag, const std::vector<TopoDS_Shape>& sections,
             bool solid, bool ruled, double closedForm) {
    std::printf("\n--- %s  (solid=%d ruled=%d) ---\n", tag.c_str(), solid ? 1 : 0,
                ruled ? 1 : 0);
    const TopoDS_Shape nat = forge::occtloft::thruSections(sections, solid, ruled, 1.0e-6);
    check(!nat.IsNull(), tag + " native thruSections produced a shape (no defer)");
    if (nat.IsNull()) return;
    const TopoDS_Shape occ = occtThru(sections, solid, ruled);
    check(!occ.IsNull(), tag + " OCCT ThruSections produced a shape");
    if (occ.IsNull()) return;

    const Metrics n = measure(nat), o = measure(occ);
    std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge, n.nVert, n.nShell,
                n.valid ? 1 : 0);
    std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge, o.nVert, o.nShell,
                o.valid ? 1 : 0);
    compareAB(tag, n, o, /*wantClosed*/ solid, /*report*/ true);
    if (closedForm >= 0.0) {
        check(relClose(n.vol, closedForm, 1.0e-9), tag + " volume native==CLOSED FORM");
        check(relClose(o.vol, closedForm, 1.0e-9), tag + " volume OCCT==CLOSED FORM");
    }
}

void runPipe(const std::string& tag, const TopoDS_Wire& spine,
             const TopoDS_Shape& profile, double closedForm) {
    std::printf("\n--- %s ---\n", tag.c_str());
    const TopoDS_Shape nat =
        forge::occtloft::pipeShell(spine, profile, {}, /*makeSolid*/ true, 1.0e-6);
    check(!nat.IsNull(), tag + " native pipeShell produced a shape (no defer)");
    if (nat.IsNull()) return;
    const TopoDS_Shape occ = occtPipeShell(spine, profile, /*makeSolid*/ true);
    check(!occ.IsNull(), tag + " OCCT MakePipeShell produced a shape");
    if (occ.IsNull()) return;

    const Metrics n = measure(nat), o = measure(occ);
    std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge, n.nVert, n.nShell,
                n.valid ? 1 : 0);
    std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge, o.nVert, o.nShell,
                o.valid ? 1 : 0);
    compareAB(tag, n, o, /*wantClosed*/ true, /*report*/ true);
    if (closedForm >= 0.0) {
        check(relClose(n.vol, closedForm, 1.0e-9), tag + " volume native==CLOSED FORM");
        check(relClose(o.vol, closedForm, 1.0e-9), tag + " volume OCCT==CLOSED FORM");
    }
}

}  // namespace

int main() {
    std::printf("== A/B: forge::occtloft (TKOffset families D + F) vs live OCCT ==\n");

    // ================================ family D — ThruSections ================
    {   // Two identical 20x10 squares 10 apart -> a box. Exact 20*10*10.
        std::vector<TopoDS_Shape> s{rectWire(0, 0, 0, 20, 10), rectWire(0, 0, 10, 20, 10)};
        runThru("ts-box", s, true, true, 2000.0);
    }
    {   // Square frustum 20 -> 10 over h=12. Prismatoid: h/6 (A1 + 4Am + A2)
        //   = 12/6 * (400 + 4*225 + 100) = 2800.
        std::vector<TopoDS_Shape> s{rectWire(-10, -10, 0, 20, 20), rectWire(-5, -5, 12, 10, 10)};
        runThru("ts-frustum", s, true, true, 2800.0);
    }
    {   // AddVertex apex -> pyramid. Exact (1/3) * 400 * 15 = 2000.
        std::vector<TopoDS_Shape> s{
            rectWire(-10, -10, 0, 20, 20),
            BRepBuilderAPI_MakeVertex(gp_Pnt(0, 0, 15)).Vertex()};
        runThru("ts-pyramid", s, true, true, 2000.0);
    }
    {   // Three sections: two stacked prismatoids.
        //   seg1 h=8, A1=400, A2=196, Am=289 -> 8/6*(400+1156+196) = 2336
        //   seg2 h=8, A1=196, A2= 36, Am=100 -> 8/6*(196+ 400+ 36) =  842.666...
        std::vector<TopoDS_Shape> s{rectWire(-10, -10, 0, 20, 20),
                                    rectWire(-7, -7, 8, 14, 14),
                                    rectWire(-3, -3, 16, 6, 6)};
        runThru("ts-3section", s, true, true, 2336.0 + 8.0 / 6.0 * 632.0);
    }
    {   // ruled == false with exactly TWO sections: the SAME surface (PART 2 of
        // NativeLoftPipe.cpp). Asserted here rather than assumed.
        std::vector<TopoDS_Shape> s{rectWire(-10, -10, 0, 20, 20), rectWire(-5, -5, 12, 10, 10)};
        runThru("ts-smooth-2sec", s, true, false, 2800.0);
    }
    {   // Hexagonal frustum: r=12 at z=0, r=6 at z=20. Regular n-gon area
        //   = (n/2) r^2 sin(2pi/n); prismatoid with the mid n-gon at r=9.
        const int N = 6;
        auto A = [&](double r) {
            return 0.5 * N * r * r * std::sin(2.0 * M_PI / N);
        };
        const double cf = 20.0 / 6.0 * (A(12.0) + 4.0 * A(9.0) + A(6.0));
        std::vector<TopoDS_Shape> s{regularNgon(N, 12.0, 0.0), regularNgon(N, 6.0, 20.0)};
        runThru("ts-hex-frustum", s, true, true, cf);
    }
    {   // solid == false: the OPEN lateral skin. Volume is not a solid volume for
        // either side, but it is the same deterministic functional of the same
        // surface, so it still discriminates — and the topology/bbox assertions
        // are the load-bearing ones here.
        std::vector<TopoDS_Shape> s{rectWire(0, 0, 0, 20, 10), rectWire(0, 0, 10, 20, 10)};
        runThru("ts-shell-open", s, false, true, -1.0);
    }
    {   // ★ THE TRANSLATED-SECTION PATH. Every case above is all-line-edged and so
        // takes the polygonal engine; these are the first that cannot. Two EQUAL
        // circles offset in z: the ruled loft is exactly the cylinder, and the
        // closed form pins it. Instrumented on the 600-part corpus this shape of
        // input was 291 of 291 native deferrals before the path existed.
        const double r = 7.0, h = 13.0;
        std::vector<TopoDS_Shape> s{circleWire(r, 0.0), circleWire(r, h)};
        runThru("ts-xlate-cylinder", s, true, true, M_PI * r * r * h);
    }
    {   // The same pair with solid == false — the OPEN lateral skin. This is the
        // branch forge::loftguide::loft reaches when its caller asks for an open
        // loft, and it is the only isSolid=false case in the suite whose sections
        // are not all-line-edged.
        const double r = 7.0, h = 13.0;
        std::vector<TopoDS_Shape> s{circleWire(r, 0.0), circleWire(r, h)};
        runThru("ts-xlate-cyl-open", s, false, true, -1.0);
    }
    {   // MIXED lines and arcs — an obround, translated. This is the corpus's
        // single most common declined signature in kind (a rounded outline whose
        // two parallel faces are congruent): area = 2 r L + pi r^2.
        const double L = 24.0, r = 6.0, t = 9.0;
        std::vector<TopoDS_Shape> s{obroundWire(L, r, 0.0), obroundWire(L, r, t)};
        runThru("ts-xlate-obround", s, true, true, (2.0 * r * L + M_PI * r * r) * t);
    }
    {   // ★ THE COAXIAL-CIRCLE PATH — half two of family D, and the PROMOTION of
        // what used to be a documented defer in the controls below ("UNEQUAL
        // circles are DECLINED"). Two circles of different radius are NOT a
        // translate, so the translated-section path above still declines them and
        // must: the lateral surface is not a linear extrusion. It is, exactly, a
        // RIGHT CIRCULAR CONE — every ruled line between polar angle t on one
        // circle and polar angle t on the other passes through the single axis
        // point where the affine radius (1-s) r0 + s r1 vanishes — so the loft is
        // the frustum of that cone, and the closed form pins it independently:
        //   V = pi h / 3 * (r0^2 + r0 r1 + r1^2).
        // The old defer's POSITIVE CONTROL is KEPT, verbatim in intent, as the
        // first assertion here — where it now reads as what it always was: the
        // proof that OCCT is a live oracle for this input, and that the pair was
        // never an impossible one.
        const double r0 = 7.0, r1 = 4.0, h = 13.0;
        std::vector<TopoDS_Shape> s{circleWire(r0, 0.0), circleWire(r1, h)};
        check(!occtThru(s, true, true).IsNull(),
              "control: OCCT DOES build that cone — the comparison below has a "
              "live oracle, and this input was never impossible");
        runThru("ts-cone-frustum", s, true, true,
                M_PI * h / 3.0 * (r0 * r0 + r0 * r1 + r1 * r1));
    }
    {   // The same pair with solid == false — the OPEN conical skin, one face in
        // one shell, which is the shape kind OCCT returns here too.
        const double r0 = 7.0, r1 = 4.0, h = 13.0;
        std::vector<TopoDS_Shape> s{circleWire(r0, 0.0), circleWire(r1, h)};
        runThru("ts-cone-open", s, false, true, -1.0);
    }
    {   // EXPANDING (r0 < r1), on an ARBITRARY axis, off the origin, and with a
        // seam direction that is not any global axis. The identity is a statement
        // about the two circles, not about +Z through (0,0,0) — a frame-dependent
        // implementation passes the case above and fails this one.
        const double r0 = 4.0, r1 = 9.0, h = 20.0;
        const gp_Dir A(1, 2, 2), X(2, -1, 0);
        const gp_Pnt c0(3, 4, 5);
        const gp_Pnt c1 = c0.Translated(gp_Vec(A) * h);
        std::vector<TopoDS_Shape> s{circleWireAx(r0, c0, A, X), circleWireAx(r1, c1, A, X)};
        runThru("ts-cone-arbaxis", s, true, true,
                M_PI * h / 3.0 * (r0 * r0 + r0 * r1 + r1 * r1));
    }
    {   // ruled == false on the same coaxial pair: for TWO sections that is the
        // same surface (PART 2 of NativeLoftPipe.cpp), asserted rather than
        // assumed — exactly as ts-smooth-2sec does for the polygonal engine.
        const double r0 = 7.0, r1 = 4.0, h = 13.0;
        std::vector<TopoDS_Shape> s{circleWire(r0, 0.0), circleWire(r1, h)};
        runThru("ts-cone-smooth-2sec", s, true, false,
                M_PI * h / 3.0 * (r0 * r0 + r0 * r1 + r1 * r1));
    }

    // ================================ family F — MakePipeShell ===============
    {   // Straight spine up z, 10x10 square profile in z=0. Exact 100 * 30.
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(0, 0, 0)); sp.Add(gp_Pnt(0, 0, 30));
        runPipe("ps-straight", sp.Wire(), rectWire(-5, -5, 0, 10, 10), 3000.0);
    }
    {   // The SAME profile with the spine moved 50 mm away in x. MEASURED: OCCT
        // does NOT relocate the profile — the answer is identical to ps-straight.
        // This is the case that pins the sweep law down.
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(50, 0, 0)); sp.Add(gp_Pnt(50, 0, 30));
        runPipe("ps-offset-spine", sp.Wire(), rectWire(-5, -5, 0, 10, 10), 3000.0);
    }
    {   // Spine along +x, profile in the x=0 plane. Exact 100 * 40.
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(0, 0, 0)); sp.Add(gp_Pnt(40, 0, 0));
        const TopoDS_Wire prof = polyWire({gp_Pnt(0, -5, -5), gp_Pnt(0, 5, -5),
                                           gp_Pnt(0, 5, 5), gp_Pnt(0, -5, 5)});
        runPipe("ps-x-spine", sp.Wire(), prof, 4000.0);
    }
    {   // Hexagonal profile swept along a straight spine.
        const int N = 6;
        const double r = 9.0, L = 25.0;
        const double A = 0.5 * N * r * r * std::sin(2.0 * M_PI / N);
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(0, 0, 0)); sp.Add(gp_Pnt(0, 0, L));
        runPipe("ps-hex-straight", sp.Wire(), regularNgon(N, r, 0.0), A * L);
    }

    // ---- the bent spine: OCCT is NOT a valid oracle here, and this says so ----
    {
        std::printf("\n--- ps-elbow: bent spine — OCCT INVALID, native vs CLOSED FORM ---\n");
        BRepBuilderAPI_MakePolygon sp;
        sp.Add(gp_Pnt(0, 0, 0)); sp.Add(gp_Pnt(0, 0, 30)); sp.Add(gp_Pnt(20, 0, 30));
        const TopoDS_Wire prof = rectWire(-5, -5, 0, 10, 10);

        const TopoDS_Shape nat =
            forge::occtloft::pipeShell(sp.Wire(), prof, {}, /*makeSolid*/ true, 1.0e-6);
        check(!nat.IsNull(), "ps-elbow native pipeShell produced a shape");
        const TopoDS_Shape occ = occtPipeShell(sp.Wire(), prof, true);
        check(!occ.IsNull(), "ps-elbow OCCT MakePipeShell produced a shape");
        if (!nat.IsNull() && !occ.IsNull()) {
            const Metrics n = measure(nat), o = measure(occ);
            std::printf("      native vol=%.10g F/E/V/S=%d/%d/%d/%d valid=%d\n",
                        n.vol, n.nFace, n.nEdge, n.nVert, n.nShell, n.valid ? 1 : 0);
            std::printf("      occt   vol=%.10g F/E/V/S=%d/%d/%d/%d valid=%d\n",
                        o.vol, o.nFace, o.nEdge, o.nVert, o.nShell, o.valid ? 1 : 0);
            // Section area 100, spine length 30 + 20 = 50, centroid on the spine
            // => a rigid mitred sweep encloses exactly 5000.
            check(relClose(n.vol, 5000.0, 1.0e-9),
                  "ps-elbow native volume == CLOSED FORM 5000 (area * spine length)");
            check(n.valid, "ps-elbow native solid VALID (BRepCheck_Analyzer)");
            check(n.closedShells, "ps-elbow native shell CLOSED");
            check(!o.valid,
                  "ps-elbow OCCT MakePipeShell result is INVALID — recorded, not "
                  "used as an oracle");
            check(!relClose(o.vol, 5000.0, 1.0e-6),
                  "ps-elbow OCCT volume differs from the closed form (measured " +
                      std::to_string(o.vol) + ")");
        }
    }

    // ================================ DEFER CONTROLS =========================
    // A defer contract that is never exercised is a comment, not a contract.
    {
        std::printf("\n--- defer controls ---\n");
        // (1) Non-planar lateral quad: rotate the top square 30 degrees about z,
        //     so every side quad is a twisted (bilinear) patch.
        {
            std::vector<gp_Pnt> top;
            const double a = 30.0 * M_PI / 180.0;
            const double c = std::cos(a), s = std::sin(a);
            const double q[4][2] = {{-10, -10}, {10, -10}, {10, 10}, {-10, 10}};
            for (auto& p : q)
                top.push_back(gp_Pnt(p[0] * c - p[1] * s, p[0] * s + p[1] * c, 12.0));
            std::vector<TopoDS_Shape> sec{rectWire(-10, -10, 0, 20, 20), polyWire(top)};
            check(forge::occtloft::thruSections(sec, true, true, 1.0e-6).IsNull(),
                  "defer: twisted (non-planar-quad) loft is DECLINED, not triangulated");
        }
        // (2) Mismatched section vertex counts.
        {
            std::vector<TopoDS_Shape> sec{rectWire(-10, -10, 0, 20, 20),
                                          regularNgon(6, 8.0, 12.0)};
            check(forge::occtloft::thruSections(sec, true, true, 1.0e-6).IsNull(),
                  "defer: sections of differing vertex count are DECLINED");
        }
        // (2b) THE COAXIAL-CIRCLE PATH'S OWN BOUNDARY. The unequal-circle pair
        //      that used to sit here as a defer is now the real comparison
        //      ts-cone-frustum above. What replaces it are the three neighbours
        //      that path must still turn away, one per degree of freedom of the
        //      section frame, each with its own control proving OCCT builds
        //      something for the same input — so none of them is an impossible
        //      input, and none of these is a decline the engine gets for free.
        //
        //      Without these the new path would be a rubber stamp on any pair of
        //      circles, which is exactly what the old defer existed to prevent.
        {
            // (i) CENTRES OFF THE AXIS. Parallel axes, centres 2 mm apart across
            //     them: the ruled loft is an OBLIQUE circular cone. Real, but not
            //     a right circular one, so no Geom_ConicalSurface represents it.
            //     MEASURED: OCCT leaves its own analytic path here too and
            //     returns a B-spline lateral whose volume misses the exact
            //     oblique-frustum closed form by 2.37e-9 relative — recorded, not
            //     used as a licence to approximate.
            std::vector<TopoDS_Shape> sec{
                circleWireAx(7.0, gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)),
                circleWireAx(4.0, gp_Pnt(2, 0, 13), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0))};
            check(forge::occtloft::thruSections(sec, true, true, 1.0e-6).IsNull(),
                  "defer: circles with centres OFF the common axis are DECLINED "
                  "(an oblique cone is not a right circular one)");
            check(!occtThru(sec, true, true).IsNull(),
                  "control: OCCT DOES build the oblique cone — the decline is a real "
                  "coverage gap, not an impossible input");
        }
        {
            // (ii) AXES NOT PARALLEL. 20 degrees of tilt: the surface is not a
            //      cone at all, and OCCT's own answer is 1.96e-2 relative away
            //      from the frustum closed form.
            //      ★ The tilt is about X, NOT about Y, so that the second wire's
            //        ORIGIN direction stays (1,0,0) and the seam control (iii)
            //        does not also fire on this input. A tilt about Y moves the
            //        origin too, and then the axis guard is never the reason this
            //        case declines — MEASURED: removing the axis guard entirely
            //        left this case still declining, i.e. the assertion was
            //        passing for someone else's reason (test/run_cone_loft_
            //        mutation_gate.sh, mutant M4).
            const double a = 0.35;
            std::vector<TopoDS_Shape> sec{
                circleWireAx(7.0, gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)),
                circleWireAx(4.0, gp_Pnt(0, 0, 13),
                             gp_Dir(0, std::sin(a), std::cos(a)),
                             gp_Dir(1, 0, 0))};
            check(forge::occtloft::thruSections(sec, true, true, 1.0e-6).IsNull(),
                  "defer: circles whose AXES are not parallel are DECLINED");
            check(!occtThru(sec, true, true).IsNull(),
                  "control: OCCT DOES build the tilted pair");
        }
        {
            // (iii) SEAM NOT ALIGNED. Same two coaxial circles, but the second
            //       wire's origin rotated 45 degrees about the axis. The ruled
            //       correspondence is then t -> t + phi and the surface is a
            //       TWISTED one, not the cone. MEASURED on the incumbent: OCCT
            //       re-origins the wires and returns FOUR faces / 6 edges / 4
            //       vertices for this input where the aligned pair gives 3/3/2.
            //       Emitting the 3-face cone here would be a topology change
            //       smuggled in under a drop, so it is declined, and the control
            //       records that OCCT does answer.
            const double a = 45.0 * M_PI / 180.0;
            std::vector<TopoDS_Shape> sec{
                circleWireAx(7.0, gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)),
                circleWireAx(4.0, gp_Pnt(0, 0, 13), gp_Dir(0, 0, 1),
                             gp_Dir(std::cos(a), std::sin(a), 0))};
            check(forge::occtloft::thruSections(sec, true, true, 1.0e-6).IsNull(),
                  "defer: coaxial circles whose wire ORIGINS sit at different polar "
                  "angles are DECLINED (the correspondence is twisted, not a cone)");
            const TopoDS_Shape occ = occtThru(sec, true, true);
            check(!occ.IsNull(), "control: OCCT DOES build the seam-offset pair");
            if (!occ.IsNull()) {
                const Metrics m = measure(occ);
                check(m.nFace == 4 && m.nEdge == 6 && m.nVert == 4,
                      "control: and it builds it with a SPLIT lateral — 4F/6E/4V, not the "
                      "3F/3E/2V of the aligned pair (measured " +
                          std::to_string(m.nFace) + "F/" + std::to_string(m.nEdge) + "E/" +
                          std::to_string(m.nVert) + "V)");
            }
        }
        {
            // (iv) EQUAL radii, coaxial: still the TRANSLATED-SECTION path's, and
            //      it must stay there. Two engines answering the same input is how
            //      two answers start to drift, so this asserts the answer carries
            //      NO conical face — i.e. the cone path did not claim a cylinder.
            const double r = 7.0, h = 13.0;
            std::vector<TopoDS_Shape> sec{circleWire(r, 0.0), circleWire(r, h)};
            const TopoDS_Shape nat = forge::occtloft::thruSections(sec, true, true, 1.0e-6);
            check(!nat.IsNull(), "control: EQUAL coaxial circles still BUILD");
            int nCone = 0;
            for (TopExp_Explorer ex(nat, TopAbs_FACE); ex.More(); ex.Next()) {
                BRepAdaptor_Surface as(TopoDS::Face(ex.Current()));
                if (as.GetType() == GeomAbs_Cone) ++nCone;
            }
            check(nCone == 0,
                  "control: and they carry NO conical face — the cylinder is still the "
                  "translated-section path's answer, not the cone path's");
        }
        // (3) Smoothed loft over THREE sections.
        {
            std::vector<TopoDS_Shape> sec{rectWire(-10, -10, 0, 20, 20),
                                          rectWire(-7, -7, 8, 14, 14),
                                          rectWire(-3, -3, 16, 6, 6)};
            check(forge::occtloft::thruSections(sec, true, false, 1.0e-6).IsNull(),
                  "defer: ruled=false with 3 sections is DECLINED (different skin)");
        }
        // (4) Guided pipe-shell.
        {
            BRepBuilderAPI_MakePolygon sp;
            sp.Add(gp_Pnt(0, 0, 0)); sp.Add(gp_Pnt(0, 0, 30));
            std::vector<TopoDS_Wire> guides{rectWire(-8, -8, 0, 16, 16)};
            check(forge::occtloft::pipeShell(sp.Wire(), rectWire(-5, -5, 0, 10, 10),
                                             guides, true, 1.0e-6)
                      .IsNull(),
                  "defer: a GUIDED pipe-shell is DECLINED (no native guided sweep exists)");
        }
        // (5) A section wire with a non-line edge would be declined too; the
        //     cheapest exact witness is an OPEN wire, which is the same guard.
        {
            BRepBuilderAPI_MakePolygon open;
            open.Add(gp_Pnt(0, 0, 0)); open.Add(gp_Pnt(10, 0, 0)); open.Add(gp_Pnt(10, 10, 0));
            std::vector<TopoDS_Shape> sec{open.Wire(), rectWire(0, 0, 10, 10, 10)};
            check(forge::occtloft::thruSections(sec, true, true, 1.0e-6).IsNull(),
                  "defer: an OPEN section wire is DECLINED");
        }
    }

    // ================================ FAMILY E ===============================
    // forge::occtloft::pipe  vs  BRepOffsetAPI_MakePipe.
    //
    // OCCT IS ONLY A VALID ORACLE ON A SINGLE-SEGMENT SPINE. Measured here, and
    // asserted below so the claim is on the record: on every BENT polyline spine
    // MakePipe either fails BRepCheck_Analyzer or returns a shape whose volume is
    // only the FIRST leg's contribution while its bounding box spans the whole
    // spine. Straight-spine cases are therefore proved A/B against OCCT on all
    // five metric groups; bent-spine cases are proved against the CLOSED FORM
    // V = area(profile) * (total spine length), with OCCT's error asserted.
    {
        const TopoDS_Wire sqWire = rectWire(-5.0, -5.0, 0.0, 10.0, 10.0);
        const TopoDS_Face sqFace = BRepBuilderAPI_MakeFace(sqWire, Standard_True).Face();
        const double sqArea = 100.0;

        gp_Ax2 cax(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        const double cr = 4.0;
        const TopoDS_Wire ciWire =
            BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(cax, cr)).Edge()).Wire();
        const TopoDS_Face ciFace = BRepBuilderAPI_MakeFace(ciWire, Standard_True).Face();
        const double ciArea = M_PI * cr * cr;

        auto spineOf = [](const std::vector<gp_Pnt>& pts) {
            BRepBuilderAPI_MakePolygon sp;
            for (const gp_Pnt& q : pts) sp.Add(q);
            sp.Build();
            return sp.Wire();
        };
        auto spineLen = [](const std::vector<gp_Pnt>& pts) {
            double L = 0.0;
            for (std::size_t i = 0; i + 1 < pts.size(); ++i) L += pts[i].Distance(pts[i + 1]);
            return L;
        };

        // ---- STRAIGHT spines: full A/B against OCCT ------------------------
        struct StraightCase {
            const char* tag;
            const TopoDS_Face* prof;
            double area;
            std::vector<gp_Pnt> spine;
        };
        const std::vector<StraightCase> straight{
            {"pipe-square-straight", &sqFace, sqArea, {gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)}},
            {"pipe-circle-straight", &ciFace, ciArea, {gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 30)}},
        };
        for (const StraightCase& c : straight) {
            std::printf("\n--- %s ---\n", c.tag);
            const TopoDS_Wire sp = spineOf(c.spine);
            const TopoDS_Shape nat = forge::occtloft::pipe(sp, *c.prof, 1.0e-6);
            BRepOffsetAPI_MakePipe mk(sp, *c.prof);
            mk.Build();
            check(!nat.IsNull(), std::string(c.tag) + " native pipe produced a shape (no defer)");
            check(mk.IsDone() == Standard_True,
                  std::string(c.tag) + " OCCT MakePipe produced a shape");
            if (nat.IsNull() || !mk.IsDone()) continue;
            const Metrics n = measure(nat), o = measure(mk.Shape());
            std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                        n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge, n.nVert, n.nShell,
                        static_cast<int>(n.valid));
            std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                        o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge, o.nVert, o.nShell,
                        static_cast<int>(o.valid));
            compareAB(c.tag, n, o, /*wantClosed*/ true, /*report*/ true);
            const double cf = c.area * spineLen(c.spine);
            check(relClose(n.vol, cf, 1.0e-9), std::string(c.tag) + " volume native==CLOSED FORM");
            check(relClose(o.vol, cf, 1.0e-9), std::string(c.tag) + " volume OCCT==CLOSED FORM");
            check(n.nVert - n.nEdge + n.nFace == 2,
                  std::string(c.tag) + " native Euler-Poincare V-E+F==2 (genus-0 solid)");
        }

        // ---- BENT spines: native vs CLOSED FORM, OCCT recorded as broken ---
        struct BentCase {
            const char* tag;
            const TopoDS_Face* prof;
            double area;
            std::vector<gp_Pnt> spine;
        };
        const std::vector<BentCase> bent{
            {"pipe-square-L", &sqFace, sqArea,
             {gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(30, 0, 25)}},
            {"pipe-circle-L", &ciFace, ciArea,
             {gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(30, 0, 25)}},
            {"pipe-circle-Z3", &ciFace, ciArea,
             {gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 20), gp_Pnt(20, 0, 20), gp_Pnt(20, 15, 20)}},
        };
        for (const BentCase& c : bent) {
            std::printf("\n--- %s: bent spine — OCCT NOT AN ORACLE, native vs CLOSED FORM ---\n",
                        c.tag);
            const TopoDS_Wire sp = spineOf(c.spine);
            const TopoDS_Shape nat = forge::occtloft::pipe(sp, *c.prof, 1.0e-6);
            BRepOffsetAPI_MakePipe mk(sp, *c.prof);
            mk.Build();
            check(!nat.IsNull(), std::string(c.tag) + " native pipe produced a shape");
            if (nat.IsNull()) continue;
            const Metrics n = measure(nat);
            const double cf = c.area * spineLen(c.spine);
            std::printf("      native vol=%.10g (closed form %.10g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                        n.vol, cf, n.nFace, n.nEdge, n.nVert, n.nShell, static_cast<int>(n.valid));
            check(relClose(n.vol, cf, 1.0e-9),
                  std::string(c.tag) + " native volume == CLOSED FORM area*spine-length");
            check(n.valid, std::string(c.tag) + " native solid VALID (BRepCheck_Analyzer)");
            check(n.closedShells, std::string(c.tag) + " native shell CLOSED");
            check(n.nShell == 1, std::string(c.tag) + " native has exactly ONE shell");
            check(n.nVert - n.nEdge + n.nFace == 2,
                  std::string(c.tag) + " native Euler-Poincare V-E+F==2 (genus-0 solid)");
            // The centre of mass must sit strictly inside the spine's bounding
            // span — a body of the right volume in the wrong place fails here.
            check(n.com[0] > -5.0 && n.com[2] > 0.0,
                  std::string(c.tag) + " native centre of mass lies within the swept region");
            if (mk.IsDone()) {
                const Metrics o = measure(mk.Shape());
                std::printf("      occt   vol=%.10g valid=%d  <-- recorded, NOT used as an oracle\n",
                            o.vol, static_cast<int>(o.valid));
                check(!o.valid || !relClose(o.vol, cf, 1.0e-6),
                      std::string(c.tag) +
                          " OCCT MakePipe is INVALID or volume-wrong on this bent spine "
                          "(measured " + std::to_string(o.vol) + ")");
            }
        }

        // ---- HOLED profiles (family E): the sweep carries the holes --------
        // profileRings() used to reject any face with more than one wire. On the
        // 600-part corpus A/B that one line was 581 of 598 PIPE defers (97.2%),
        // so the hole path is now built -- and everything below exists to prove
        // the hole is REALLY THERE rather than quietly dropped, which is the one
        // way this change could be worse than the defer it replaces.
        {
            std::printf("\n--- holed profiles: outer polygon + polygon holes ---\n");
            const TopoDS_Wire outer = rectWire(-20, -20, 0, 40, 40);   // area 1600
            TopoDS_Wire hole1 = rectWire(-5, -5, 0, 10, 10);           // area  100
            hole1.Reverse();
            BRepBuilderAPI_MakeFace mkHoled(outer, Standard_True);
            mkHoled.Add(hole1);
            const TopoDS_Face holedFace = mkHoled.Face();
            const double holedArea = 1600.0 - 100.0;

            TopoDS_Wire h2a = rectWire(-14, -4, 0, 8, 8);              // area 64
            TopoDS_Wire h2b = rectWire(6, -4, 0, 8, 8);                // area 64
            h2a.Reverse(); h2b.Reverse();
            BRepBuilderAPI_MakeFace mkTwo(outer, Standard_True);
            mkTwo.Add(h2a);
            mkTwo.Add(h2b);
            const TopoDS_Face twoHoleFace = mkTwo.Face();
            const double twoHoleArea = 1600.0 - 64.0 - 64.0;

            // STRAIGHT spine: OCCT MakePipe IS a trustworthy oracle here (the
            // banner's measurement), so this is a full A/B, not a closed form
            // standing alone.
            struct HoledCase { const char* tag; const TopoDS_Face* prof; double area; };
            const std::vector<HoledCase> holed{
                {"pipe-holed-straight",   &holedFace,   holedArea},
                {"pipe-2holes-straight",  &twoHoleFace, twoHoleArea},
            };
            const std::vector<gp_Pnt> straightSpine{gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)};
            for (const HoledCase& c : holed) {
                std::printf("\n--- %s ---\n", c.tag);
                const TopoDS_Wire sp = spineOf(straightSpine);
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, *c.prof, 1.0e-6);
                BRepOffsetAPI_MakePipe mk(sp, *c.prof);
                mk.Build();
                check(!nat.IsNull(),
                      std::string(c.tag) + " native pipe produced a shape (no defer)");
                check(mk.IsDone() == Standard_True,
                      std::string(c.tag) + " OCCT MakePipe produced a shape");
                if (nat.IsNull() || !mk.IsDone()) continue;
                const Metrics n = measure(nat), o = measure(mk.Shape());
                std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                            n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge, n.nVert,
                            n.nShell, static_cast<int>(n.valid));
                std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                            o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge, o.nVert,
                            o.nShell, static_cast<int>(o.valid));
                compareAB(c.tag, n, o, /*wantClosed*/ true, /*report*/ true);
                const double cf = c.area * 25.0;
                check(relClose(n.vol, cf, 1.0e-9),
                      std::string(c.tag) + " volume native==CLOSED FORM (outer minus holes)");
                check(relClose(o.vol, cf, 1.0e-9),
                      std::string(c.tag) + " volume OCCT==CLOSED FORM (outer minus holes)");
            }

            // ★ THE CONTROL THAT MATTERS: prove the HOLE IS THERE. A sweep that
            // silently dropped the hole would still be a valid closed solid with
            // a plausible volume, and every assertion above except the closed
            // form would still pass. So compare it, on the SAME spine, with the
            // sweep of the hole-free outer wire.
            {
                const TopoDS_Wire sp = spineOf(straightSpine);
                const TopoDS_Face solidFace = BRepBuilderAPI_MakeFace(outer, Standard_True).Face();
                const TopoDS_Shape natHole = forge::occtloft::pipe(sp, holedFace, 1.0e-6);
                const TopoDS_Shape natFull = forge::occtloft::pipe(sp, solidFace, 1.0e-6);
                check(!natHole.IsNull() && !natFull.IsNull(),
                      "hole control: both the holed and the hole-free sweep built");
                if (!natHole.IsNull() && !natFull.IsNull()) {
                    const Metrics nh = measure(natHole), nf = measure(natFull);
                    std::printf("      holed vol=%.10g F=%d   hole-free vol=%.10g F=%d\n",
                                nh.vol, nh.nFace, nf.vol, nf.nFace);
                    check(!relClose(nh.vol, nf.vol, 1.0e-6),
                          "hole control: the holed sweep is NOT the hole-free sweep (volume)");
                    check(relClose(nf.vol - nh.vol, 100.0 * 25.0, 1.0e-9),
                          "hole control: the missing volume is EXACTLY the hole's prism");
                    check(nh.nFace == nf.nFace + 4,
                          "hole control: the holed sweep carries 4 extra lateral faces");
                    check(std::fabs(nh.bb[0] - nf.bb[0]) <= 1.0e-9 &&
                          std::fabs(nh.bb[3] - nf.bb[3]) <= 1.0e-9,
                          "hole control: the OUTER boundary is unchanged by the hole");
                }
            }

            // BENT spine, profile centroid ON the spine: OCCT is not an oracle,
            // so the closed form is, exactly as the bent cases above.
            {
                const std::vector<gp_Pnt> bentSpine{gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25),
                                                    gp_Pnt(30, 0, 25)};
                std::printf("\n--- pipe-holed-L: bent spine — native vs CLOSED FORM ---\n");
                const TopoDS_Wire sp = spineOf(bentSpine);
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, holedFace, 1.0e-6);
                check(!nat.IsNull(), "pipe-holed-L native pipe produced a shape");
                if (!nat.IsNull()) {
                    const Metrics n = measure(nat);
                    const double cf = holedArea * (25.0 + 30.0);
                    std::printf("      native vol=%.10g (closed form %.10g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                n.vol, cf, n.nFace, n.nEdge, n.nVert, n.nShell,
                                static_cast<int>(n.valid));
                    check(relClose(n.vol, cf, 1.0e-9),
                          "pipe-holed-L native volume == CLOSED FORM (outer minus hole) * length");
                    check(n.valid, "pipe-holed-L native solid VALID (BRepCheck_Analyzer)");
                    check(n.closedShells, "pipe-holed-L native shell CLOSED");
                    check(n.nShell == 1, "pipe-holed-L native has exactly ONE shell");
                }
            }

            // ---- CIRCULAR holes -------------------------------------------
            // The corpus census: of 3426 hole wires across 600 real parts, 3426
            // are full circles and none is a polygon. So this kind, not the
            // polygon-hole kind, is what the coverage number turns on.
            {
                std::printf("\n--- circular holes in a polygon outer boundary ---\n");
                auto circWire = [](double cx, double cy, double r) {
                    gp_Circ ci(gp_Ax2(gp_Pnt(cx, cy, 0.0), gp_Dir(0, 0, 1)), r);
                    return BRepBuilderAPI_MakeWire(
                               BRepBuilderAPI_MakeEdge(ci).Edge()).Wire();
                };
                auto holedFaceOf = [&](const std::vector<TopoDS_Wire>& hs) {
                    BRepBuilderAPI_MakeFace mk(outer, Standard_True);
                    for (TopoDS_Wire h : hs) { h.Reverse(); mk.Add(h); }
                    return mk.Face();
                };

                const double r1 = 5.0;
                const TopoDS_Face oneCirc = holedFaceOf({circWire(0, 0, r1)});
                const double aOne = 1600.0 - M_PI * r1 * r1;

                const double r2 = 4.0;
                const TopoDS_Face twoCirc =
                    holedFaceOf({circWire(-10, 0, r2), circWire(10, 0, r2)});
                const double aTwo = 1600.0 - 2.0 * M_PI * r2 * r2;

                // STRAIGHT spine -> OCCT MakePipe is a trustworthy oracle.
                struct CC { const char* tag; const TopoDS_Face* f; double area; };
                const std::vector<CC> cc{{"pipe-circhole-straight",  &oneCirc, aOne},
                                         {"pipe-2circholes-straight", &twoCirc, aTwo}};
                for (const CC& c : cc) {
                    std::printf("\n--- %s ---\n", c.tag);
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    const TopoDS_Shape nat = forge::occtloft::pipe(sp, *c.f, 1.0e-6);
                    BRepOffsetAPI_MakePipe mk(sp, *c.f);
                    mk.Build();
                    check(!nat.IsNull(),
                          std::string(c.tag) + " native pipe produced a shape (no defer)");
                    check(mk.IsDone() == Standard_True,
                          std::string(c.tag) + " OCCT MakePipe produced a shape");
                    if (nat.IsNull() || !mk.IsDone()) continue;
                    const Metrics n = measure(nat), o = measure(mk.Shape());
                    std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge,
                                n.nVert, n.nShell, static_cast<int>(n.valid));
                    std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge,
                                o.nVert, o.nShell, static_cast<int>(o.valid));
                    compareAB(c.tag, n, o, /*wantClosed*/ true, /*report*/ true);
                    const double cf = c.area * 25.0;
                    check(relClose(n.vol, cf, 1.0e-9),
                          std::string(c.tag) + " volume native==CLOSED FORM");
                    check(relClose(o.vol, cf, 1.0e-9),
                          std::string(c.tag) + " volume OCCT==CLOSED FORM");
                }

                // BENT spine. OCCT is not an oracle, so the closed form is, and
                // it is DERIVED rather than assumed: for the L-spine
                // (0,0,0)->(0,0,H)->(W,0,H) a section point (x,y) travels
                // (H - x) along +Z to the mitre plane and then (W - x) along +X,
                // so its total path is the AFFINE L(x) = H + W - 2x and the swept
                // volume of a region is A * (H + W - 2*xbar). An off-axis hole
                // therefore has a DIFFERENT arm than the outer boundary, which is
                // exactly the case a centroid-on-spine formula would get wrong.
                {
                    const double H = 25.0, W = 30.0;
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, H),
                                                    gp_Pnt(W, 0, H)});
                    // hole ON the spine axis
                    const double cfOn = 1600.0 * (H + W - 0.0)
                                      - M_PI * r1 * r1 * (H + W - 0.0);
                    // hole OFF the spine axis, centre x = 8
                    const double rOff = 3.0, xOff = 8.0;
                    const TopoDS_Face offFace = holedFaceOf({circWire(xOff, 0, rOff)});
                    const double cfOff = 1600.0 * (H + W)
                                       - M_PI * rOff * rOff * (H + W - 2.0 * xOff);

                    struct BC { const char* tag; const TopoDS_Face* f; double cf; };
                    const std::vector<BC> bc{{"pipe-circhole-L", &oneCirc, cfOn},
                                             {"pipe-circhole-offaxis-L", &offFace, cfOff}};
                    for (const BC& b : bc) {
                        std::printf("\n--- %s: bent spine — native vs DERIVED CLOSED FORM ---\n",
                                    b.tag);
                        const TopoDS_Shape nat = forge::occtloft::pipe(sp, *b.f, 1.0e-6);
                        check(!nat.IsNull(), std::string(b.tag) + " native pipe produced a shape");
                        if (nat.IsNull()) continue;
                        const Metrics n = measure(nat);
                        std::printf("      native vol=%.10g (closed form %.10g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                    n.vol, b.cf, n.nFace, n.nEdge, n.nVert, n.nShell,
                                    static_cast<int>(n.valid));
                        check(relClose(n.vol, b.cf, 1.0e-9),
                              std::string(b.tag) + " native volume == CLOSED FORM A*(H+W-2*xbar)");
                        check(n.valid, std::string(b.tag) + " native solid VALID");
                        check(n.closedShells, std::string(b.tag) + " native shell CLOSED");
                        check(n.nShell == 1, std::string(b.tag) + " native has exactly ONE shell");
                    }
                }

                // ★ THE CONTROL: prove the circular hole is REALLY THERE.
                {
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    const TopoDS_Face solidFace =
                        BRepBuilderAPI_MakeFace(outer, Standard_True).Face();
                    const TopoDS_Shape nh = forge::occtloft::pipe(sp, oneCirc, 1.0e-6);
                    const TopoDS_Shape nf = forge::occtloft::pipe(sp, solidFace, 1.0e-6);
                    check(!nh.IsNull() && !nf.IsNull(),
                          "circ-hole control: both the holed and hole-free sweep built");
                    if (!nh.IsNull() && !nf.IsNull()) {
                        const Metrics a = measure(nh), b = measure(nf);
                        std::printf("      holed vol=%.10g F=%d   hole-free vol=%.10g F=%d\n",
                                    a.vol, a.nFace, b.vol, b.nFace);
                        check(!relClose(a.vol, b.vol, 1.0e-6),
                              "circ-hole control: the holed sweep is NOT the hole-free sweep");
                        check(relClose(b.vol - a.vol, M_PI * r1 * r1 * 25.0, 1.0e-9),
                              "circ-hole control: the removed volume is EXACTLY the hole cylinder");
                        check(std::fabs(a.bb[0] - b.bb[0]) <= 1.0e-9 &&
                              std::fabs(a.bb[3] - b.bb[3]) <= 1.0e-9,
                              "circ-hole control: the OUTER boundary is unchanged by the hole");
                    }
                }

                // A hole stored as TWO SEMICIRCULAR ARCS is the same circle a
                // STEP writer may have split; it must build, and build the SAME
                // solid as the one-edge form. A half-arc wire that does NOT
                // close the turn must still be declined.
                {
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    const gp_Ax2 hax(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
                    const gp_Circ hc(hax, r1);
                    BRepBuilderAPI_MakeWire mw(
                        BRepBuilderAPI_MakeEdge(hc, 0.0, M_PI).Edge(),
                        BRepBuilderAPI_MakeEdge(hc, M_PI, 2.0 * M_PI).Edge());
                    TopoDS_Wire twoArc = mw.Wire();
                    twoArc.Reverse();
                    BRepBuilderAPI_MakeFace mkTA(outer, Standard_True);
                    mkTA.Add(twoArc);
                    const TopoDS_Shape natA = forge::occtloft::pipe(sp, mkTA.Face(), 1.0e-6);
                    check(!natA.IsNull(),
                          "two-arc hole: a circle split into two arcs BUILDS (no defer)");
                    if (!natA.IsNull()) {
                        const Metrics m = measure(natA);
                        std::printf("      two-arc hole vol=%.10g F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                    m.vol, m.nFace, m.nEdge, m.nVert, m.nShell,
                                    static_cast<int>(m.valid));
                        check(relClose(m.vol, aOne * 25.0, 1.0e-9),
                              "two-arc hole: volume == the SAME closed form as the one-edge circle");
                        check(m.valid, "two-arc hole: native solid VALID");
                        check(m.nShell == 1, "two-arc hole: exactly ONE shell");
                    }
                }
                {
                    // HALF a circle is not a circle: an open arc wire closed by
                    // nothing must NOT be read as a full hole.
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    const gp_Circ hc(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), r1);
                    BRepBuilderAPI_MakeWire mh(BRepBuilderAPI_MakeEdge(hc, 0.0, M_PI).Edge());
                    TopoDS_Wire half = mh.Wire();
                    half.Reverse();
                    BRepBuilderAPI_MakeFace mkH(outer, Standard_True);
                    mkH.Add(half);
                    check(forge::occtloft::pipe(sp, mkH.Face(), 1.0e-6).IsNull(),
                          "defer: a HALF-circle hole wire is DECLINED (it is not a full turn)");
                }

                // ★ THE GATE MUST FIRE: a hole bigger than the outer boundary
                // would carve the wall. It must be DECLINED, not chewed.
                {
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    BRepBuilderAPI_MakeFace mkBad(outer, Standard_True);
                    TopoDS_Wire big = circWire(0, 0, 25.0);   // r=25 in a 40x40 square
                    big.Reverse();
                    mkBad.Add(big);
                    check(forge::occtloft::pipe(sp, mkBad.Face(), 1.0e-6).IsNull(),
                          "defer: a hole that pokes through the outer wall is DECLINED "
                          "(removed-volume gate fires)");
                }
                {
                    // Two OVERLAPPING holes double-count under a naive cut; the
                    // same gate must catch it.
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    BRepBuilderAPI_MakeFace mkOv(outer, Standard_True);
                    TopoDS_Wire o1 = circWire(-2, 0, 6.0), o2 = circWire(2, 0, 6.0);
                    o1.Reverse(); o2.Reverse();
                    mkOv.Add(o1); mkOv.Add(o2);
                    check(forge::occtloft::pipe(sp, mkOv.Face(), 1.0e-6).IsNull(),
                          "defer: two OVERLAPPING holes are DECLINED (removed-volume gate fires)");
                }
                {
                    // A hole circle whose plane is not the profile plane.
                    const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                    gp_Circ tc(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 1)), 4.0);
                    TopoDS_Wire tw =
                        BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(tc).Edge()).Wire();
                    tw.Reverse();
                    BRepBuilderAPI_MakeFace mkT(outer, Standard_True);
                    mkT.Add(tw);
                    check(forge::occtloft::pipe(sp, mkT.Face(), 1.0e-6).IsNull(),
                          "defer: a TILTED hole circle is DECLINED (its sweep is not a cylinder)");
                }
            }

            // ★ AN ELLIPTICAL HOLE IS NOW CARRIED, NOT DECLINED — and the thing
            // this case has always been protecting against is the hole being
            // silently DROPPED. Until the curved-section transport landed there
            // was no exact swept surface in this engine's vocabulary for an
            // ellipse and the only honest answer was a defer; sweepFaceMitre
            // extrudes the section FACE, so every boundary curve — the four
            // outer lines and the elliptical inner wire alike — gets its own
            // Geom_SurfaceOfLinearExtrusion lateral face. The assertion is
            // therefore STRENGTHENED rather than relaxed: the closed form now
            // has to come out right WITH the hole subtracted, and the extra wall
            // has to be present, which a dropped hole could not fake.
            {
                const TopoDS_Wire sp = spineOf(straightSpine);
                gp_Elips he(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 6.0, 3.0);
                TopoDS_Wire ew =
                    BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(he).Edge()).Wire();
                ew.Reverse();
                BRepBuilderAPI_MakeFace mkEl(outer, Standard_True);
                mkEl.Add(ew);
                const TopoDS_Shape natEl = forge::occtloft::pipe(sp, mkEl.Face(), 1.0e-6);
                const TopoDS_Face solidFace =
                    BRepBuilderAPI_MakeFace(outer, Standard_True).Face();
                const TopoDS_Shape natFull = forge::occtloft::pipe(sp, solidFace, 1.0e-6);
                check(!natEl.IsNull(),
                      "elliptical hole: the sweep BUILDS (curved-section transport)");
                check(!natFull.IsNull(), "elliptical hole control: the hole-free sweep builds");
                if (!natEl.IsNull() && !natFull.IsNull()) {
                    const Metrics ne = measure(natEl), nf = measure(natFull);
                    const double cf = (1600.0 - kPi * 6.0 * 3.0) * 25.0;
                    std::printf("      elliptical-hole vol=%.10g F=%d S=%d valid=%d   "
                                "hole-free vol=%.10g F=%d\n",
                                ne.vol, ne.nFace, ne.nShell, static_cast<int>(ne.valid),
                                nf.vol, nf.nFace);
                    check(relClose(ne.vol, cf, 1.0e-9),
                          "elliptical hole: volume == CLOSED FORM (square minus pi*a*b) * 25");
                    check(!relClose(ne.vol, nf.vol, 1.0e-6),
                          "elliptical hole: the hole is THERE — volume differs from hole-free");
                    check(ne.nFace == nf.nFace + 1,
                          "elliptical hole: exactly ONE extra face, the elliptical wall");
                    check(ne.nShell == 1, "elliptical hole: exactly ONE shell");
                    check(ne.valid, "elliptical hole: the solid is BRepCheck VALID");
                }
            }
        }


        // ================================================================
        // THE EXACT ARC-SWEPT LATERAL FACE — family E's fourth profile kind
        // ================================================================
        // Corpus census of the 351 parts family E still declined after the
        // circular-hole kind: 141 have an ARC-CHAIN outer wire, 60 a POLYGON
        // outer with an arc-chain (slot / kidney) hole, 44 a FULL-CIRCLE outer
        // with holes, and 106 a B-SPLINE outer that no arc geometry can reach.
        // Every case below is one of those four shapes, and every one carries an
        // INDEPENDENT closed form so OCCT is never the only oracle.
        {
            std::printf("\n--- arc-chain profiles: the exact arc-swept lateral face ---\n");

            // A closed wire of LINE and ARC edges, given as an ordered vertex
            // list plus, for each edge, the bulge radius (0 == a straight line;
            // sign gives the side the arc bulges towards).
            // a -> b along the circle centred at `c`; `ccw` says which way round
            // the profile normal the arc runs, so the SUBTENDED ANGLE is stated
            // by the caller rather than inferred from a bulge sign. (Getting
            // that inference wrong is how the first draft of this block built
            // 270-degree bumps and then blamed the engine for them.)
            auto arcEdge = [](const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c,
                              bool ccw) {
                const double r = c.Distance(a);
                const gp_Circ ci(gp_Ax2(c, gp_Dir(0, 0, ccw ? 1 : -1)), r);
                return BRepBuilderAPI_MakeEdge(ci, a, b).Edge();
            };
            auto lineEdge = [](const gp_Pnt& a, const gp_Pnt& b) {
                return BRepBuilderAPI_MakeEdge(a, b).Edge();
            };

            // ---- (1) a ROUNDED RECTANGLE, the corpus's single most common
            //          arc-chain outer wire (80 of the 141), 4 quarter-circle
            //          corners.  area = W*H - (4 - pi) r^2, exactly.
            const double RW = 40.0, RH = 30.0, RR = 6.0;
            auto roundedRectWire = [&](double z) {
                const double x0 = -RW / 2, x1 = RW / 2, y0 = -RH / 2, y1 = RH / 2;
                const gp_Pnt p1(x0 + RR, y0, z), p2(x1 - RR, y0, z);
                const gp_Pnt p3(x1, y0 + RR, z), p4(x1, y1 - RR, z);
                const gp_Pnt p5(x1 - RR, y1, z), p6(x0 + RR, y1, z);
                const gp_Pnt p7(x0, y1 - RR, z), p8(x0, y0 + RR, z);
                BRepBuilderAPI_MakeWire w;
                w.Add(lineEdge(p1, p2));
                w.Add(arcEdge(p2, p3, gp_Pnt(x1 - RR, y0 + RR, z), true));
                w.Add(lineEdge(p3, p4));
                w.Add(arcEdge(p4, p5, gp_Pnt(x1 - RR, y1 - RR, z), true));
                w.Add(lineEdge(p5, p6));
                w.Add(arcEdge(p6, p7, gp_Pnt(x0 + RR, y1 - RR, z), true));
                w.Add(lineEdge(p7, p8));
                w.Add(arcEdge(p8, p1, gp_Pnt(x0 + RR, y0 + RR, z), true));
                return w.Wire();
            };
            const double rrArea = RW * RH - (4.0 - M_PI) * RR * RR;
            const TopoDS_Face rrFace =
                BRepBuilderAPI_MakeFace(roundedRectWire(0.0), Standard_True).Face();

            {
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, rrFace, 1.0e-6);
                BRepOffsetAPI_MakePipe mk(sp, rrFace);
                mk.Build();
                check(!nat.IsNull(), "arc-roundrect-straight native pipe built (no defer)");
                check(mk.IsDone() == Standard_True,
                      "arc-roundrect-straight OCCT MakePipe built");
                if (!nat.IsNull() && mk.IsDone()) {
                    const Metrics n = measure(nat), o = measure(mk.Shape());
                    std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge,
                                n.nVert, n.nShell, static_cast<int>(n.valid));
                    std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge,
                                o.nVert, o.nShell, static_cast<int>(o.valid));
                    compareAB("arc-roundrect-straight", n, o, /*wantClosed*/ true, /*report*/ true);
                    check(relClose(n.vol, rrArea * 25.0, 1.0e-9),
                          "arc-roundrect-straight volume native == CLOSED FORM "
                          "(W*H - (4-pi)r^2) * L");
                    check(relClose(o.vol, rrArea * 25.0, 1.0e-9),
                          "arc-roundrect-straight volume OCCT == CLOSED FORM");
                }
            }

            // ★ THE CONTROL THAT MAKES "EXACT ARC-SWEPT FACE" FALSIFIABLE.
            // A chord-polygon answer — the octagon through the eight arc end
            // points, which is what a decomposition that FORGOT its arcs would
            // build — is a DIFFERENT solid. Its volume must differ, and the real
            // answer must carry four analytic cylindrical faces of radius RR
            // that the chord answer does not have at all.
            {
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                const double x0 = -RW / 2, x1 = RW / 2, y0 = -RH / 2, y1 = RH / 2;
                const TopoDS_Wire oct = polyWire({
                    gp_Pnt(x0 + RR, y0, 0), gp_Pnt(x1 - RR, y0, 0),
                    gp_Pnt(x1, y0 + RR, 0), gp_Pnt(x1, y1 - RR, 0),
                    gp_Pnt(x1 - RR, y1, 0), gp_Pnt(x0 + RR, y1, 0),
                    gp_Pnt(x0, y1 - RR, 0), gp_Pnt(x0, y0 + RR, 0)});
                const TopoDS_Shape chord =
                    forge::occtloft::pipe(sp, BRepBuilderAPI_MakeFace(oct, Standard_True).Face(),
                                          1.0e-6);
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, rrFace, 1.0e-6);
                check(!chord.IsNull() && !nat.IsNull(),
                      "arc-vs-chord control: both the arc profile and its chord polygon built");
                if (!chord.IsNull() && !nat.IsNull()) {
                    const Metrics a = measure(nat), b = measure(chord);
                    // octagon area = W*H - 4 * (r^2/2) = W*H - 2 r^2
                    const double octArea = RW * RH - 2.0 * RR * RR;
                    std::printf("      arc vol=%.10g   chord-polygon vol=%.10g   (differ by %.6g%%)\n",
                                a.vol, b.vol, 100.0 * std::fabs(a.vol - b.vol) / a.vol);
                    check(relClose(b.vol, octArea * 25.0, 1.0e-9),
                          "arc-vs-chord control: the chord answer is EXACTLY the octagon prism");
                    check(!relClose(a.vol, b.vol, 1.0e-6),
                          "arc-vs-chord control: the arc answer is NOT the chord answer");
                    // and the arcs are real analytic cylinders, not facets
                    int nCyl = 0, nCylR = 0;
                    TopTools_IndexedMapOfShape mf;
                    TopExp::MapShapes(nat, TopAbs_FACE, mf);
                    for (int i = 1; i <= mf.Extent(); ++i) {
                        Handle(Geom_Surface) su = BRep_Tool::Surface(TopoDS::Face(mf(i)));
                        Handle(Geom_CylindricalSurface) cy =
                            Handle(Geom_CylindricalSurface)::DownCast(su);
                        if (cy.IsNull()) continue;
                        ++nCyl;
                        if (std::fabs(cy->Cylinder().Radius() - RR) <= 1.0e-9) ++nCylR;
                    }
                    std::printf("      arc answer carries %d cylindrical face(s), %d of radius %.6g\n",
                                nCyl, nCylR, RR);
                    check(nCyl == 4 && nCylR == 4,
                          "arc-vs-chord control: the four corners are ANALYTIC cylinders of "
                          "exactly the arc radius");
                    int nCylChord = 0;
                    TopTools_IndexedMapOfShape mc;
                    TopExp::MapShapes(chord, TopAbs_FACE, mc);
                    for (int i = 1; i <= mc.Extent(); ++i)
                        if (!Handle(Geom_CylindricalSurface)::DownCast(
                                 BRep_Tool::Surface(TopoDS::Face(mc(i)))).IsNull()) ++nCylChord;
                    check(nCylChord == 0,
                          "arc-vs-chord control: the chord answer has NO cylindrical face");
                }
            }

            // ---- (2) the same rounded rectangle on a BENT spine, where OCCT is
            //          NOT an oracle. The derived law for the L-spine
            //          (0,0,0)->(0,0,H)->(W,0,H) is  V = A * (H + W - 2*xbar),
            //          and the rounded rectangle is symmetric so xbar = 0.
            {
                const double H = 25.0, W = 30.0;
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, H),
                                                gp_Pnt(W, 0, H)});
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, rrFace, 1.0e-6);
                check(!nat.IsNull(), "arc-roundrect-L native pipe built");
                if (!nat.IsNull()) {
                    const Metrics n = measure(nat);
                    const double cf = rrArea * (H + W);
                    std::printf("      native vol=%.10g (closed form %.10g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                n.vol, cf, n.nFace, n.nEdge, n.nVert, n.nShell,
                                static_cast<int>(n.valid));
                    check(relClose(n.vol, cf, 1.0e-9),
                          "arc-roundrect-L volume == DERIVED CLOSED FORM A*(H+W-2*xbar)");
                    check(n.valid, "arc-roundrect-L native solid VALID");
                    check(n.nShell == 1, "arc-roundrect-L exactly ONE shell");
                }
            }

            // ---- (3) a SLOT (obround) HOLE in a polygon outer — the 60-part
            //          bucket. Two 180-degree arcs and two lines; the segment
            //          angle is exactly pi, the boundary case of the
            //          (r^2/2)(D - sin D) segment area.
            const double SL = 14.0, SR = 4.0;   // centre-to-centre, radius
            auto slotWire = [&](double cx, double cy) {
                const gp_Pnt a(cx - SL / 2, cy - SR, 0), b(cx + SL / 2, cy - SR, 0);
                const gp_Pnt c(cx + SL / 2, cy + SR, 0), d(cx - SL / 2, cy + SR, 0);
                BRepBuilderAPI_MakeWire w;
                w.Add(lineEdge(a, b));
                w.Add(arcEdge(b, c, gp_Pnt(cx + SL / 2, cy, 0), true));
                w.Add(lineEdge(c, d));
                w.Add(arcEdge(d, a, gp_Pnt(cx - SL / 2, cy, 0), true));
                return w.Wire();
            };
            const double slotArea = SL * 2.0 * SR + M_PI * SR * SR;
            {
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                const TopoDS_Wire out40 = rectWire(-20, -20, 0, 40, 40);
                BRepBuilderAPI_MakeFace mk(out40, Standard_True);
                TopoDS_Wire sw = slotWire(0.0, 0.0);
                sw.Reverse();
                mk.Add(sw);
                const TopoDS_Face slotted = mk.Face();
                const double cfA = 1600.0 - slotArea;
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, slotted, 1.0e-6);
                BRepOffsetAPI_MakePipe mp(sp, slotted);
                mp.Build();
                check(!nat.IsNull(), "arc-slothole-straight native pipe built (no defer)");
                check(mp.IsDone() == Standard_True, "arc-slothole-straight OCCT MakePipe built");
                if (!nat.IsNull() && mp.IsDone()) {
                    const Metrics n = measure(nat), o = measure(mp.Shape());
                    std::printf("      native vol=%.10g   occt vol=%.10g   closed form %.10g\n",
                                n.vol, o.vol, cfA * 25.0);
                    compareAB("arc-slothole-straight", n, o, true, true);
                    check(relClose(n.vol, cfA * 25.0, 1.0e-9),
                          "arc-slothole-straight volume native == CLOSED FORM "
                          "(1600 - (2rL + pi r^2)) * 25");
                    check(relClose(o.vol, cfA * 25.0, 1.0e-9),
                          "arc-slothole-straight volume OCCT == CLOSED FORM");
                }
            }

            // ---- (4) a MAJOR arc (subtended angle > pi), which is where the
            //          "disc INTERSECT half-plane" reading of a circular segment
            //          has to hold for the LARGER of the two pieces. Ring:
            //          a 300-degree arc from A to B, then B->P->A.
            {
                const double r = 10.0, th = M_PI / 6.0;   // 30 degrees
                const gp_Pnt A(r * std::cos(th), r * std::sin(th), 0.0);
                const gp_Pnt B(r * std::cos(th), -r * std::sin(th), 0.0);
                const gp_Pnt P(2.0 * r, 0.0, 0.0);
                BRepBuilderAPI_MakeWire w;
                w.Add(arcEdge(A, B, gp_Pnt(0, 0, 0), true));   // the LONG way: 300 deg
                w.Add(lineEdge(B, P));
                w.Add(lineEdge(P, A));
                const TopoDS_Face f = BRepBuilderAPI_MakeFace(w.Wire(), Standard_True).Face();
                const double D = 2.0 * M_PI - 2.0 * th;
                const double majorSeg = 0.5 * r * r * (D - std::sin(D));
                const double tri = 0.5 * (2.0 * r * std::sin(th)) * (P.X() - A.X());
                const double area = tri + majorSeg;
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 20)});
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, f, 1.0e-6);
                BRepOffsetAPI_MakePipe mp(sp, f);
                mp.Build();
                check(!nat.IsNull(), "arc-major-straight native pipe built (no defer)");
                if (!nat.IsNull()) {
                    const Metrics n = measure(nat);
                    std::printf("      native vol=%.10g   closed form %.10g  (arc sweeps %.1f deg)\n",
                                n.vol, area * 20.0, D * 180.0 / M_PI);
                    check(relClose(n.vol, area * 20.0, 1.0e-9),
                          "arc-major-straight volume == CLOSED FORM triangle + MAJOR segment");
                    check(n.valid, "arc-major-straight native solid VALID");
                    if (mp.IsDone()) {
                        const Metrics o = measure(mp.Shape());
                        compareAB("arc-major-straight", n, o, true, true);
                    }
                }
            }

            // ---- (5) an INWARD (subtracted) arc: a square whose bottom edge is
            //          replaced by an arc bulging INTO the material. This is the
            //          `add == false` branch, which 58 corpus parts need.
            {
                const double s = 30.0, r = 25.0;
                const gp_Pnt a(-s / 2, -s / 2, 0), b(s / 2, -s / 2, 0);
                const gp_Pnt c(s / 2, s / 2, 0), d(-s / 2, s / 2, 0);
                BRepBuilderAPI_MakeWire w;
                // centre BELOW the chord and traversed CLOCKWISE about +Z, so
                // the arc passes through (0, -15 + (r - h)) — UP, into the
                // square. This is also the only case whose supporting circle has
                // its axis ANTIPARALLEL to the profile normal, so it exercises
                // the sign branch in the engine's arc parser.
                w.Add(arcEdge(a, b, gp_Pnt(0.0, -s / 2 - std::sqrt(r * r - 0.25 * s * s), 0.0),
                              false));
                w.Add(lineEdge(b, c));
                w.Add(lineEdge(c, d));
                w.Add(lineEdge(d, a));
                const TopoDS_Face f = BRepBuilderAPI_MakeFace(w.Wire(), Standard_True).Face();
                const double D = 2.0 * std::asin(0.5 * s / r);
                const double seg = 0.5 * r * r * (D - std::sin(D));
                const double area = s * s - seg;
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 18)});
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, f, 1.0e-6);
                BRepOffsetAPI_MakePipe mp(sp, f);
                mp.Build();
                check(!nat.IsNull(), "arc-concave-straight native pipe built (no defer)");
                if (!nat.IsNull()) {
                    const Metrics n = measure(nat);
                    std::printf("      native vol=%.10g   closed form %.10g (square MINUS segment)\n",
                                n.vol, area * 18.0);
                    check(relClose(n.vol, area * 18.0, 1.0e-9),
                          "arc-concave-straight volume == CLOSED FORM square MINUS the segment");
                    check(n.valid, "arc-concave-straight native solid VALID");
                    if (mp.IsDone()) {
                        const Metrics o = measure(mp.Shape());
                        compareAB("arc-concave-straight", n, o, true, true);
                    }
                }
            }

            // ---- (6) a FULL-CIRCLE outer boundary WITH holes — the 44-part
            //          bucket, which the circle path above declines because the
            //          face has more than one wire.
            {
                const double RO = 20.0, RI = 6.0;
                auto circWire2 = [](double cx, double cy, double r) {
                    gp_Circ ci(gp_Ax2(gp_Pnt(cx, cy, 0.0), gp_Dir(0, 0, 1)), r);
                    return BRepBuilderAPI_MakeWire(
                               BRepBuilderAPI_MakeEdge(ci).Edge()).Wire();
                };
                BRepBuilderAPI_MakeFace mk(circWire2(0, 0, RO), Standard_True);
                TopoDS_Wire h1 = circWire2(9, 0, RI), h2 = circWire2(-9, 0, RI);
                h1.Reverse(); h2.Reverse();
                mk.Add(h1); mk.Add(h2);
                const TopoDS_Face f = mk.Face();
                const double area = M_PI * (RO * RO - 2.0 * RI * RI);
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 22)});
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, f, 1.0e-6);
                BRepOffsetAPI_MakePipe mp(sp, f);
                mp.Build();
                check(!nat.IsNull(), "arc-annulus-straight native pipe built (no defer)");
                check(mp.IsDone() == Standard_True, "arc-annulus-straight OCCT MakePipe built");
                if (!nat.IsNull() && mp.IsDone()) {
                    const Metrics n = measure(nat), o = measure(mp.Shape());
                    std::printf("      native vol=%.10g   occt vol=%.10g   closed form %.10g\n",
                                n.vol, o.vol, area * 22.0);
                    compareAB("arc-annulus-straight", n, o, true, true);
                    check(relClose(n.vol, area * 22.0, 1.0e-9),
                          "arc-annulus-straight volume native == CLOSED FORM pi(R^2-2r^2)*L");
                    check(relClose(o.vol, area * 22.0, 1.0e-9),
                          "arc-annulus-straight volume OCCT == CLOSED FORM");
                }
            }

            // ---- (7) a rounded rectangle with an OFF-AXIS slot hole on a BENT
            //          spine: BOTH new kinds at once, and the L-spine law
            //          V = A_out*(H+W-2*xout) - A_hole*(H+W-2*xhole) separates
            //          them, so a hole carried by the wrong arm cannot pass.
            {
                const double H = 25.0, W = 30.0, xh = 8.0;
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, H),
                                                gp_Pnt(W, 0, H)});
                BRepBuilderAPI_MakeFace mk(roundedRectWire(0.0), Standard_True);
                TopoDS_Wire sw = slotWire(xh, 0.0);
                sw.Reverse();
                mk.Add(sw);
                const TopoDS_Face f = mk.Face();
                const double cf = rrArea * (H + W) - slotArea * (H + W - 2.0 * xh);
                const TopoDS_Shape nat = forge::occtloft::pipe(sp, f, 1.0e-6);
                check(!nat.IsNull(), "arc-roundrect-slot-offaxis-L native pipe built");
                if (!nat.IsNull()) {
                    const Metrics n = measure(nat);
                    std::printf("      native vol=%.10g (closed form %.10g) F/E/V/S=%d/%d/%d/%d valid=%d\n",
                                n.vol, cf, n.nFace, n.nEdge, n.nVert, n.nShell,
                                static_cast<int>(n.valid));
                    check(relClose(n.vol, cf, 1.0e-9),
                          "arc-roundrect-slot-offaxis-L volume == DERIVED CLOSED FORM "
                          "A_out*(H+W) - A_slot*(H+W-2*x)");
                    check(n.valid, "arc-roundrect-slot-offaxis-L native solid VALID");
                    check(n.nShell == 1, "arc-roundrect-slot-offaxis-L exactly ONE shell");
                }
            }

            // ---- (8) FAMILY F gets the SAME arc-swept face. pipeShell is
            //          handed the profile as a bare WIRE, which is the whole
            //          reason profileFrame() reads the plane from the ring. On
            //          the 600-part corpus family F is fed exactly the outer
            //          wire of the same faces family E is fed the whole of.
            {
                const TopoDS_Wire rrw = roundedRectWire(0.0);
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                const TopoDS_Shape nat =
                    forge::occtloft::pipeShell(sp, rrw, {}, /*makeSolid*/ true, 1.0e-6);
                const TopoDS_Shape occ = occtPipeShell(sp, rrw, true);
                check(!nat.IsNull(), "ps-arc-roundrect-straight native pipeShell built");
                check(!occ.IsNull(), "ps-arc-roundrect-straight OCCT MakePipeShell built");
                if (!nat.IsNull() && !occ.IsNull()) {
                    const Metrics n = measure(nat), o = measure(occ);
                    std::printf("      native vol=%.10g   occt vol=%.10g   closed form %.10g\n",
                                n.vol, o.vol, rrArea * 25.0);
                    compareAB("ps-arc-roundrect-straight", n, o, /*wantClosed*/ true,
                              /*report*/ true);
                    check(relClose(n.vol, rrArea * 25.0, 1.0e-9),
                          "ps-arc-roundrect-straight volume native == CLOSED FORM");
                    check(relClose(o.vol, rrArea * 25.0, 1.0e-9),
                          "ps-arc-roundrect-straight volume OCCT == CLOSED FORM");
                }
            }
            {
                // BENT spine: the derived law again, and OCCT is NOT the oracle
                // here — its default transition is Transformed, which does not
                // carry the section through the corner (see PART 3 of the .cpp
                // banner and the PIPESHELL_RC row of the corpus A/B).
                const double H = 25.0, W = 30.0;
                const TopoDS_Wire rrw = roundedRectWire(0.0);
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, H),
                                                gp_Pnt(W, 0, H)});
                const TopoDS_Shape nat =
                    forge::occtloft::pipeShell(sp, rrw, {}, true, 1.0e-6);
                check(!nat.IsNull(), "ps-arc-roundrect-L native pipeShell built");
                if (!nat.IsNull()) {
                    const Metrics n = measure(nat);
                    std::printf("      native vol=%.10g (closed form %.10g) valid=%d\n",
                                n.vol, rrArea * (H + W), static_cast<int>(n.valid));
                    check(relClose(n.vol, rrArea * (H + W), 1.0e-9),
                          "ps-arc-roundrect-L volume == DERIVED CLOSED FORM A*(H+W-2*xbar)");
                    check(n.valid, "ps-arc-roundrect-L native solid VALID");
                    check(n.nShell == 1, "ps-arc-roundrect-L exactly ONE shell");
                }
            }
            {
                // An OPEN SKIN of an arc chain is not something a boolean can
                // hand back, and the engine says so instead of returning a solid
                // where a skin was asked for.
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
                check(forge::occtloft::pipeShell(sp, roundedRectWire(0.0), {},
                                                 /*makeSolid*/ false, 1.0e-6).IsNull(),
                      "defer: an arc-chain pipeShell with makeSolid=false is DECLINED "
                      "(the boolean assembly builds solids, not skins)");
            }

            // ---- DEFER CONTROLS for the arc path. Each is a way the
            //      decomposition could be wrong; each must DECLINE, not guess.
            {
                const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});

                // (a) THE GATE MUST FIRE: a slot hole that pokes out through the
                //     outer wall would carve material the profile never removed.
                {
                    BRepBuilderAPI_MakeFace mk(roundedRectWire(0.0), Standard_True);
                    TopoDS_Wire sw = slotWire(19.0, 0.0);   // half outside x=+20
                    sw.Reverse();
                    mk.Add(sw);
                    check(forge::occtloft::pipe(sp, mk.Face(), 1.0e-6).IsNull(),
                          "defer: an arc-chain hole that pokes through the outer wall is "
                          "DECLINED (the A*L gate fires)");
                }
                // (b) two OVERLAPPING slot holes double-count under a naive cut.
                {
                    BRepBuilderAPI_MakeFace mk(roundedRectWire(0.0), Standard_True);
                    TopoDS_Wire s1 = slotWire(-2.0, 0.0), s2 = slotWire(2.0, 0.0);
                    s1.Reverse(); s2.Reverse();
                    mk.Add(s1); mk.Add(s2);
                    check(forge::occtloft::pipe(sp, mk.Face(), 1.0e-6).IsNull(),
                          "defer: two OVERLAPPING arc-chain holes are DECLINED "
                          "(the A*L gate fires)");
                }
                // (c) an arc whose axis is NOT the profile normal sweeps to an
                //     ELLIPTIC cylinder — a different surface, so it is declined
                //     rather than approximated by a circular one.
                {
                    const gp_Pnt a(-10, 0, 0), b(10, 0, 0);
                    gp_Circ tilted(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 1)), 12.0);
                    BRepBuilderAPI_MakeWire w;
                    w.Add(BRepBuilderAPI_MakeEdge(tilted).Edge());
                    // a closed wire whose single edge is a tilted full circle is
                    // read as a circle by fullCircleWire and must be rejected on
                    // its axis, not silently swept.
                    BRepBuilderAPI_MakeFace mk(roundedRectWire(0.0), Standard_True);
                    TopoDS_Wire tw = w.Wire();
                    tw.Reverse();
                    mk.Add(tw);
                    check(forge::occtloft::pipe(sp, mk.Face(), 1.0e-6).IsNull(),
                          "defer: a TILTED arc in an arc-chain profile is DECLINED");
                    (void)a; (void)b;
                }
                // (d) ★ THE 106-PART WALL, NOW A POSITIVE ROW. A B-SPLINE
                //     boundary was the largest single decline bucket in the corpus
                //     census (106 of the 291 declined profiles) and this row
                //     asserted that defer. The general planar-section transport
                //     carries it, so the row is INVERTED rather than deleted -- a
                //     decline that becomes a build is exactly the kind of change
                //     that must show up in the suite.
                //
                //     Checked against an INDEPENDENT closed form, not the engine's
                //     own oracle: the spine here is STRAIGHT, so the sweep is a
                //     prism and V = area(section) x 25, with the area measured off
                //     the FACE by BRepGProp rather than taken from the sweep.
                //     Validity is asserted SEPARATELY, because volume cannot see a
                //     fold -- see (d2) directly below.
                {
                    TColgp_Array1OfPnt pts(1, 4);
                    pts(1) = gp_Pnt(-15, -10, 0); pts(2) = gp_Pnt(-5, 14, 0);
                    pts(3) = gp_Pnt(9, -14, 0);   pts(4) = gp_Pnt(15, 10, 0);
                    Handle(Geom_BezierCurve) bez = new Geom_BezierCurve(pts);
                    BRepBuilderAPI_MakeWire w;
                    w.Add(BRepBuilderAPI_MakeEdge(bez).Edge());
                    w.Add(lineEdge(gp_Pnt(15, 10, 0), gp_Pnt(0, 25, 0)));
                    w.Add(lineEdge(gp_Pnt(0, 25, 0), gp_Pnt(-15, -10, 0)));
                    const TopoDS_Face f =
                        BRepBuilderAPI_MakeFace(w.Wire(), Standard_True).Face();
                    // This particular outline is SELF-INTERSECTING: the S-shaped
                    // Bezier crosses its own closing lines, so the FACE is not valid
                    // and the section gate declines it. Measured, not assumed --
                    // the reason is asserted below. Declining it is correct, and the
                    // row is kept as a decline WITH ITS REASON NAMED, which is a
                    // stronger claim than the bare IsNull() it replaces: it says the
                    // engine refused for the right cause rather than by accident.
                    const TopoDS_Shape spl = forge::occtloft::pipe(sp, f, 1.0e-6);
                    const std::string splWhy = forge::occtloft::lastDeferReason();
                    std::printf("      self-intersecting spline outline: reason %s\n",
                                splWhy.c_str());
                    check(spl.IsNull(),
                          "a SELF-INTERSECTING spline outline is DECLINED");
                    check(splWhy.find("gen_section_invalid") != std::string::npos,
                          "and it is the SECTION-VALIDITY gate that declined it");

                    // ★ THE 106-PART WALL ITSELF, positively. A WELL-FORMED spline
                    // outline is the capability the census counted (106 of 291
                    // declined profiles carried B-spline edges), and it must BUILD.
                    // Checked against an INDEPENDENT closed form rather than the
                    // engine's own oracle: the spine here is STRAIGHT, so the sweep
                    // is a prism and V = area(section) x 25, with the area measured
                    // off the FACE by BRepGProp. Validity is asserted SEPARATELY,
                    // because volume cannot see a fold -- see (d2) below.
                    {
                        TColgp_Array1OfPnt gp_(1, 4);
                        gp_(1) = gp_Pnt(-15, -8, 0); gp_(2) = gp_Pnt(-5, 4, 0);
                        gp_(3) = gp_Pnt(5, 4, 0);    gp_(4) = gp_Pnt(15, -8, 0);
                        Handle(Geom_BezierCurve) gb = new Geom_BezierCurve(gp_);
                        BRepBuilderAPI_MakeWire gw;
                        gw.Add(BRepBuilderAPI_MakeEdge(gb).Edge());
                        gw.Add(lineEdge(gp_Pnt(15, -8, 0), gp_Pnt(0, 20, 0)));
                        gw.Add(lineEdge(gp_Pnt(0, 20, 0), gp_Pnt(-15, -8, 0)));
                        const TopoDS_Face gf =
                            BRepBuilderAPI_MakeFace(gw.Wire(), Standard_True).Face();
                        const TopoDS_Shape good = forge::occtloft::pipe(sp, gf, 1.0e-6);
                        if (good.IsNull())
                            std::printf("      well-formed spline DECLINED, reason: %s\n",
                                        forge::occtloft::lastDeferReason());
                        check(!good.IsNull(),
                              "the 106-part wall: a WELL-FORMED spline profile BUILDS");
                        if (!good.IsNull()) {
                            GProp_GProps ag;
                            BRepGProp::SurfaceProperties(gf, ag);
                            const double area = ag.Mass();
                            const Metrics ms = measure(good);
                            const double want = area * 25.0;
                            const double rel =
                                want > 0.0 ? std::fabs(ms.vol - want) / want : 1.0;
                            std::printf("      spline profile vol=%.10g want=%.10g rel=%.3g "
                                        "valid=%d shells=%d\n",
                                        ms.vol, want, rel, ms.valid ? 1 : 0, ms.nShell);
                            check(rel < 1.0e-6,
                                  "spline profile: volume == area x straight-spine length");
                            check(ms.valid, "spline profile: the solid is BRepCheck-VALID");
                            check(ms.nShell == 1, "spline profile: exactly one shell");
                        }
                    }
                }
                // (d2) ★ THE FOLD PREFLIGHT, POSITIVELY CONTROLLED — and the
                //      one thing the A*L gate CANNOT see. BRepGProp integrates
                //      the divergence theorem over the faces, so a shell that
                //      has folded through itself still reports exactly the
                //      SIGNED volume A*L that the gate compares against.
                //
                //      MEASURED with the preflight removed, on this profile (a
                //      40x30 rectangle with ONE rounded corner on the near side,
                //      so the FAR edge that folds is a straight line and the
                //      per-segment arc check never looks at it):
                //          spine (0,0,0)->(0,0,H)->(W,0,H)
                //          H=W=40/25 : BUILT vol=77209.51305  valid=1   <- fine
                //          H=W=5     : BUILT vol=11634.42469  valid=0   <- WRONG
                //          H=W=8     : BUILT vol=18788.07069  valid=0   <- WRONG
                //          H=W=12    : BUILT vol=28326.26536  valid=0   <- WRONG
                //      Three self-intersecting solids that BRepCheck_Analyzer
                //      rejects, every one of them past the A*L gate. With the
                //      preflight in, the three decline and the valid one still
                //      builds to the same 77209.51305. So the assertion names
                //      the guard, not merely the null.
                {
                    const gp_Pnt q1(-20, -15, 0), q2(20, -15, 0), q3(20, 15, 0);
                    const gp_Pnt q4(-20 + RR, 15, 0), q5(-20, 15 - RR, 0);
                    BRepBuilderAPI_MakeWire fw;
                    fw.Add(lineEdge(q1, q2)); fw.Add(lineEdge(q2, q3));
                    fw.Add(lineEdge(q3, q4));
                    fw.Add(arcEdge(q4, q5, gp_Pnt(-20 + RR, 15 - RR, 0), true));
                    fw.Add(lineEdge(q5, q1));
                    const TopoDS_Face ff =
                        BRepBuilderAPI_MakeFace(fw.Wire(), Standard_True).Face();

                    const TopoDS_Wire tight = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 5),
                                                       gp_Pnt(5, 0, 5)});
                    const TopoDS_Shape bad = forge::occtloft::pipe(tight, ff, 1.0e-6);
                    const std::string why = forge::occtloft::lastDeferReason();
                    check(bad.IsNull(),
                          "defer: a section a sharp mitre would fold BACKWARDS is DECLINED");
                    check(why.find("arc_section_folds_at_mitre") != std::string::npos,
                          "defer: and it is the FOLD PREFLIGHT that declined it, not a "
                          "downstream accident (reason: " + why + ")");

                    // ...and the guard is not simply refusing every bent spine:
                    // the same profile on a spine long enough not to fold still
                    // builds, to the volume measured above.
                    const TopoDS_Wire ok = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 40),
                                                    gp_Pnt(25, 0, 40)});
                    const TopoDS_Shape good = forge::occtloft::pipe(ok, ff, 1.0e-6);
                    check(!good.IsNull(),
                          "fold control: the SAME profile on a spine long enough not to "
                          "fold still builds");
                    if (!good.IsNull()) {
                        const Metrics m = measure(good);
                        check(relClose(m.vol, 77209.51305, 1.0e-9),
                              "fold control: and to the volume measured with the guard "
                              "removed, so the guard changed nothing it should not have");
                        check(m.valid, "fold control: that answer is VALID");
                    }
                }
                // (e) a 180-degree spine reversal still has no mitre plane, on
                //     the arc path as on every other.
                {
                    const TopoDS_Wire rev = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25),
                                                     gp_Pnt(0, 0, 5)});
                    check(forge::occtloft::pipe(rev, rrFace, 1.0e-6).IsNull(),
                          "defer: an arc-chain profile on a REVERSING spine is DECLINED");
                }
            }
        }

        // ---- family E DEFER controls --------------------------------------
        std::printf("\n--- family E defer controls ---\n");
        {
            // Profile plane NOT perpendicular to the first leg, multi-leg spine.
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(30, 0, 25)});
            const TopoDS_Wire tilted = polyWire({gp_Pnt(-5, -5, 0), gp_Pnt(5, -5, 0),
                                                 gp_Pnt(5, 5, 10), gp_Pnt(-5, 5, 10)});
            check(forge::occtloft::pipe(sp, tilted, 1.0e-6).IsNull(),
                  "defer: a profile plane not perpendicular to the first leg is DECLINED");
        }
        {
            // ★ AN ELLIPSE PROFILE IS NEITHER A POLYGON NOR A CIRCLE, AND IS NOW
            // COVERED. On a STRAIGHT spine the curved-section transport needs no
            // boolean at all — both stations are perpendicular to the leg, so the
            // answer IS occtPrism's prism — and the closed form is met exactly.
            // The old row asserted the defer this replaces.
            gp_Elips el(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 6.0, 3.0);
            const TopoDS_Wire ew =
                BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(el).Edge()).Wire();
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
            const TopoDS_Shape nat = forge::occtloft::pipe(sp, ew, 1.0e-6);
            check(!nat.IsNull(), "ELLIPSE profile: the sweep BUILDS on a straight spine");
            if (!nat.IsNull()) {
                const Metrics m = measure(nat);
                std::printf("      ellipse-profile vol=%.10g F=%d S=%d valid=%d\n",
                            m.vol, m.nFace, m.nShell, static_cast<int>(m.valid));
                check(relClose(m.vol, kPi * 6.0 * 3.0 * 25.0, 1.0e-9),
                      "ELLIPSE profile: volume == CLOSED FORM pi*a*b*L");
                check(m.nFace == 3, "ELLIPSE profile: 3 faces (one lateral wall, two caps)");
                check(m.nShell == 1, "ELLIPSE profile: exactly ONE shell");
                check(m.valid, "ELLIPSE profile: the solid is BRepCheck VALID");
            }
        }
        {
            // A 180-degree spine reversal has no mitre plane.
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(0, 0, 5)});
            check(forge::occtloft::pipe(sp, sqFace, 1.0e-6).IsNull(),
                  "defer: a 180-degree spine reversal is DECLINED");
        }
        {
            // ★ A CIRCLE CENTRED OFF THE SPINE START WAS OUT OF SCOPE FOR
            // pipeCircleMitre (which requires the centre ON the spine) AND IS NOW
            // COVERED by the curved-section transport, which needs no such
            // restriction: the mitre is a rigid motion of the whole section
            // wherever it sits. The old row asserted the defer this replaces.
            //
            // THE CLOSED FORM. The centroid starts at (3,0,0). The mitre plane at
            // (0,0,25) has normal (1,0,1)/sqrt2, so the centroid travels
            //   s0 = ((0,0,25)-(3,0,0)).n / ((0,0,1).n) = (25-3) = 22
            // to (3,0,22); the end plane is x = 30, so s1 = 30-3 = 27. Hence
            //   V = pi r^2 (22+27) = pi*16*49.
            // OCCT is NOT an oracle on a bent spine (see the banner), so this is
            // checked against that closed form — and, crucially, against the SAME
            // circle centred ON the spine, which must give a DIFFERENT answer.
            // Volume alone would ratify an engine that quietly ignored the offset.
            gp_Ax2 off(gp_Pnt(3.0, 0, 0), gp_Dir(0, 0, 1));
            const TopoDS_Wire ow =
                BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(off, cr)).Edge()).Wire();
            gp_Ax2 on(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
            const TopoDS_Wire onw =
                BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(on, cr)).Edge()).Wire();
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(30, 0, 25)});
            const TopoDS_Shape natOff = forge::occtloft::pipe(sp, ow, 1.0e-6);
            const TopoDS_Shape natOn = forge::occtloft::pipe(sp, onw, 1.0e-6);
            check(!natOff.IsNull(), "circle off spine: the sweep BUILDS");
            check(!natOn.IsNull(), "circle off spine control: the ON-spine sweep builds");
            if (!natOff.IsNull() && !natOn.IsNull()) {
                const Metrics mo = measure(natOff), mn = measure(natOn);
                std::printf("      off-spine vol=%.10g F=%d S=%d valid=%d   "
                            "on-spine vol=%.10g\n",
                            mo.vol, mo.nFace, mo.nShell, static_cast<int>(mo.valid), mn.vol);
                check(relClose(mo.vol, kPi * cr * cr * 49.0, 1.0e-6),
                      "circle off spine: volume == CLOSED FORM pi*r^2*(22+27)");
                check(relClose(mn.vol, kPi * cr * cr * 55.0, 1.0e-6),
                      "circle off spine control: ON-spine volume == pi*r^2*(25+30)");
                check(!relClose(mo.vol, mn.vol, 1.0e-3),
                      "circle off spine: the OFFSET is honoured — the two differ");
                check(mo.nShell == 1, "circle off spine: exactly ONE shell");
                check(mo.valid, "circle off spine: the solid is BRepCheck VALID");            }
        }
    }

    // ================================ NEGATIVE CONTROL =======================
    {
        std::printf("\n--- control: SAME volume, DIFFERENT solid ---\n");
        const TopoDS_Shape a = BRepPrimAPI_MakeBox(46.0, 36.0, 26.0).Shape();  // 43056
        const double bx = 39.0, by = 23.76;
        const double bz = 43056.0 / (bx * by);
        const TopoDS_Shape b = BRepPrimAPI_MakeBox(gp_Pnt(1.0, 0.0, 0.0), bx, by, bz).Shape();
        const Metrics ma = measure(a), mb = measure(b);
        std::printf("      A vol=%.10g   B vol=%.10g   (relative diff %.3g)\n",
                    ma.vol, mb.vol, std::fabs(ma.vol - mb.vol) / ma.vol);
        check(relClose(ma.vol, mb.vol, 1.0e-9),
              "control: the two solids DO match on volume to 1e-9");
        const int bad = compareAB("control", ma, mb, /*wantClosed*/ true, /*report*/ false);
        check(bad > 0,
              "control: the comparator REJECTS them on position/topology (" +
                  std::to_string(bad) + " sub-assertions failed)");
    }

    std::printf("\n===== %d/%d assertions passed =====\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
