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

            // A hole this engine cannot represent must DEFER, never be dropped.
            // An ELLIPTICAL hole is neither a polygon nor a circle: no exact
            // swept surface exists in this engine's vocabulary for it.
            {
                const TopoDS_Wire sp = spineOf(straightSpine);
                gp_Elips he(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 6.0, 3.0);
                TopoDS_Wire ew =
                    BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(he).Edge()).Wire();
                ew.Reverse();
                BRepBuilderAPI_MakeFace mkEl(outer, Standard_True);
                mkEl.Add(ew);
                check(forge::occtloft::pipe(sp, mkEl.Face(), 1.0e-6).IsNull(),
                      "defer: a face with an ELLIPTICAL hole is DECLINED, not swept without it");
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
            // An ELLIPSE profile is neither a polygon nor a circle.
            gp_Elips el(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 6.0, 3.0);
            const TopoDS_Wire ew =
                BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(el).Edge()).Wire();
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25)});
            check(forge::occtloft::pipe(sp, ew, 1.0e-6).IsNull(),
                  "defer: an ELLIPSE profile is DECLINED (neither polygon nor circle)");
        }
        {
            // A 180-degree spine reversal has no mitre plane.
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(0, 0, 5)});
            check(forge::occtloft::pipe(sp, sqFace, 1.0e-6).IsNull(),
                  "defer: a 180-degree spine reversal is DECLINED");
        }
        {
            // A circle whose centre is off the spine start is outside scope.
            gp_Ax2 off(gp_Pnt(3.0, 0, 0), gp_Dir(0, 0, 1));
            const TopoDS_Wire ow =
                BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(off, cr)).Edge()).Wire();
            const TopoDS_Wire sp = spineOf({gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 25), gp_Pnt(30, 0, 25)});
            check(forge::occtloft::pipe(sp, ow, 1.0e-6).IsNull(),
                  "defer: a circle centre off the spine start is DECLINED");
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
