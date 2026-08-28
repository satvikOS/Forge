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
// DEFER CONTROL. Four cases assert the engine returns a NULL shape on inputs
// outside its stated scope (non-planar lateral quad, mismatched section vertex
// counts, a smoothed 3-section loft, a guided pipe-shell). A defer contract that
// is never exercised is a comment, not a contract.
//
// Exit 0 iff every assertion holds. Build + run with
//   bash forge-kernel/test/run_ab_native_loftpipe.sh

#include "forge/native/brep/NativeLoftPipe.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

namespace {

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
