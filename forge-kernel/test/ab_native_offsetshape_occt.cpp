// forge-kernel/test/ab_native_offsetshape_occt.cpp
//
// LIVE-OCCT A/B for TKOffset family H — forge::occtoffset::offsetSolidShape
// (src/native/brep/NativeThickSolid.cpp, PART 5b) against the incumbent
//   BRepOffsetAPI_MakeOffsetShape::PerformByJoin(shape, d, tol,
//        BRepOffset_Skin, false, false, GeomAbs_Intersection)
// on the SAME shape, in ONE process, for the SAME signed distance.
//
// WHY EACH ASSERTION EXISTS. Volume alone proves nothing — an upside-down cone
// and a right-way-up one of the same height match to every digit, and this repo
// has already been bitten by exactly that. So each case asserts, in this order:
//
//   1. VOLUME    native == OCCT           (relative, 1e-9)
//   2. VOLUME    native == CLOSED FORM    (relative, 1e-9) where one exists —
//                because OCCT is not always a valid oracle for its own offset
//                family (reports/TKOFFSET_DECOMPOSITION.md §4.2 measured
//                MakeThickSolid returning the cavity with IsDone()==true), so a
//                second, independent oracle is used wherever the exact answer is
//                derivable in closed form.
//   3. POSITION  centre of mass native == OCCT, componentwise (absolute, 1e-7 mm)
//   4. POSITION  axis-aligned bounding box native == OCCT, all six bounds
//                (absolute, 1e-7 mm) — this is what catches a body of the right
//                size sitting in the wrong place, the exact failure mode a
//                volume check is blind to.
//   5. TOPOLOGY  face / edge / vertex / shell counts native == OCCT, and both
//                shells CLOSED, and both solids valid under BRepCheck_Analyzer.
//
// NEGATIVE CONTROL. Case "control" feeds the comparator two solids with volumes
// equal to 10 significant figures and DIFFERENT geometry, and asserts the
// comparator REJECTS them. A gate that cannot fail is not a gate; this proves
// assertions 3-5 are load-bearing rather than decorative.
//
// Exit 0 iff every assertion holds. Build + run with
//   bash forge-kernel/test/run_ab_native_offsetshape.sh

#include "forge/native/brep/NativeThickSolid.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffset_Mode.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_JoinType.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
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
    double bb[6] = {0, 0, 0, 0, 0, 0};   // xmin ymin zmin xmax ymax zmax
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

// The comparator every case runs. Returns the number of FAILED sub-assertions,
// so the negative control can assert that it returns > 0.
int compareAB(const std::string& tag, const Metrics& n, const Metrics& o,
              bool report) {
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
    sub(n.closedShells, "native shell CLOSED");
    sub(o.closedShells, "OCCT shell CLOSED");
    sub(n.valid, "native solid VALID (BRepCheck_Analyzer)");
    return bad;
}

// The incumbent, exactly as src/Features.cpp offsetSolid calls it.
TopoDS_Shape occtOffset(const TopoDS_Shape& src, double d) {
    BRepOffsetAPI_MakeOffsetShape mk;
    mk.PerformByJoin(src, d, 1.0e-7, BRepOffset_Skin,
                     /*Intersection*/ Standard_False,
                     /*SelfInter*/    Standard_False,
                     GeomAbs_Intersection);
    if (!mk.IsDone()) return TopoDS_Shape();
    TopoDS_Shape off = mk.Shape();
    if (off.ShapeType() == TopAbs_SHELL) {
        BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(off));
        if (ms.IsDone()) off = ms.Solid();
    } else if (off.ShapeType() == TopAbs_COMPOUND) {
        TopExp_Explorer ex(off, TopAbs_SHELL);
        if (ex.More()) {
            BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(ex.Current()));
            if (ms.IsDone()) off = ms.Solid();
        }
    }
    return off;
}

// One A/B case. `closedForm` < 0 means "no independent closed form for this one".
void runCase(const std::string& tag, const TopoDS_Shape& src, double d,
             double closedForm) {
    std::printf("\n--- %s  (d = %+g) ---\n", tag.c_str(), d);

    const TopoDS_Shape nat = forge::occtoffset::offsetSolidShape(src, d, 1.0e-7);
    check(!nat.IsNull(), tag + " native offsetSolidShape produced a shape (no defer)");
    if (nat.IsNull()) return;

    const TopoDS_Shape occ = occtOffset(src, d);
    check(!occ.IsNull(), tag + " OCCT MakeOffsetShape produced a shape");
    if (occ.IsNull()) return;

    const Metrics n = measure(nat), o = measure(occ);
    std::printf("      native vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d\n",
                n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge, n.nVert, n.nShell);
    std::printf("      occt   vol=%.10g com=(%.9g %.9g %.9g) F/E/V/S=%d/%d/%d/%d\n",
                o.vol, o.com[0], o.com[1], o.com[2], o.nFace, o.nEdge, o.nVert, o.nShell);

    compareAB(tag, n, o, /*report*/ true);

    if (closedForm >= 0.0) {
        check(relClose(n.vol, closedForm, 1.0e-9),
              tag + " volume native==CLOSED FORM (" + std::to_string(closedForm) + ")");
        check(relClose(o.vol, closedForm, 1.0e-9),
              tag + " volume OCCT==CLOSED FORM");
    }
}

// ---------------------------------------------------------------- shapes
TopoDS_Shape triPrism(double a, double b, double h) {
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(gp_Pnt(0, 0, 0));
    poly.Add(gp_Pnt(a, 0, 0));
    poly.Add(gp_Pnt(0, b, 0));
    poly.Close();
    const TopoDS_Face f = BRepBuilderAPI_MakeFace(poly.Wire()).Face();
    return BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, h)).Shape();
}

// A NON-CONVEX (L-shaped) prism: every vertex still has exactly three faces, so
// the sharp-join corner solve is exact, but two of the eight are REFLEX.
// A W x H x T plate with its four VERTICAL edges rounded at radius r. This is
// the MIXED profile: cap faces bounded by four straight runs AND four ARCS, and
// four PARTIAL-revolution cylindrical corners. Both were declined outright until
// the mixed line/arc increment; the case is here so that capability cannot
// regress silently.
TopoDS_Shape roundedPlate(double W, double H, double T, double r) {
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(W, H, T).Shape();
    BRepFilletAPI_MakeFillet fil(box);
    int n = 0;
    TopTools_IndexedMapOfShape em;
    TopExp::MapShapes(box, TopAbs_EDGE, em);
    for (int i = 1; i <= em.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(em.FindKey(i));
        TopoDS_Vertex a, b;
        TopExp::Vertices(e, a, b);
        const gp_Pnt pa = BRep_Tool::Pnt(a), pb = BRep_Tool::Pnt(b);
        if (std::fabs(pa.X() - pb.X()) < 1.0e-9 && std::fabs(pa.Y() - pb.Y()) < 1.0e-9 &&
            std::fabs(pa.Z() - pb.Z()) > 1.0e-9) { fil.Add(r, e); ++n; }
    }
    if (n != 4) return TopoDS_Shape();
    try { fil.Build(); } catch (...) { return TopoDS_Shape(); }
    if (!fil.IsDone()) return TopoDS_Shape();
    return fil.Shape();
}

TopoDS_Shape lPrism(double A, double B, double t, double h) {
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(gp_Pnt(0, 0, 0));
    poly.Add(gp_Pnt(A, 0, 0));
    poly.Add(gp_Pnt(A, t, 0));
    poly.Add(gp_Pnt(t, t, 0));
    poly.Add(gp_Pnt(t, B, 0));
    poly.Add(gp_Pnt(0, B, 0));
    poly.Close();
    const TopoDS_Face f = BRepBuilderAPI_MakeFace(poly.Wire()).Face();
    return BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, h)).Shape();
}

}  // namespace

int main() {
    std::printf("== A/B: forge::occtoffset::offsetSolidShape  vs  "
                "BRepOffsetAPI_MakeOffsetShape ==\n");

    // ---------------- planar path ----------------
    {   // box grow: exact (L+2d)(W+2d)(H+2d)
        const double L = 40, W = 30, H = 20, d = 3;
        runCase("box-grow", BRepPrimAPI_MakeBox(L, W, H).Shape(), d,
                (L + 2 * d) * (W + 2 * d) * (H + 2 * d));
    }
    {   // box shrink
        const double L = 40, W = 30, H = 20, d = -4;
        runCase("box-shrink", BRepPrimAPI_MakeBox(L, W, H).Shape(), d,
                (L + 2 * d) * (W + 2 * d) * (H + 2 * d));
    }
    {   // right-triangular prism: legs a,b grow to a + d*(1 + (a+b+c)/b ... ) —
        // no clean closed form, so this case is A/B-only (assertions 1,3,4,5).
        runCase("tri-prism-grow", triPrism(30, 20, 15), 2.0, -1.0);
    }
    {   // NON-CONVEX L-prism: the reflex corners are where a naive offset
        // self-intersects, so this is the case that matters most.
        runCase("L-prism-grow", lPrism(40, 30, 10, 12), 1.5, -1.0);
        runCase("L-prism-shrink", lPrism(40, 30, 10, 12), -1.5, -1.0);
    }

    // ---------------- quadric path ----------------
    {   // capped cylinder: exact pi (R+d)^2 (H+2d)
        const double R = 20, H = 50, d = 5;
        runCase("cyl-grow", BRepPrimAPI_MakeCylinder(R, H).Shape(), d,
                kPi * (R + d) * (R + d) * (H + 2 * d));
    }
    {   const double R = 20, H = 50, d = -5;
        runCase("cyl-shrink", BRepPrimAPI_MakeCylinder(R, H).Shape(), d,
                kPi * (R + d) * (R + d) * (H + 2 * d));
    }
    {   // sphere: exact 4/3 pi (R+d)^3
        const double R = 20, d = 4;
        runCase("sphere-grow", BRepPrimAPI_MakeSphere(R).Shape(), d,
                4.0 / 3.0 * kPi * (R + d) * (R + d) * (R + d));
    }
    {   // torus: exact 2 pi^2 R (r+d)^2
        const double Rmaj = 30, rmin = 8, d = 2;
        runCase("torus-grow", BRepPrimAPI_MakeTorus(Rmaj, rmin).Shape(), d,
                2.0 * kPi * kPi * Rmaj * (rmin + d) * (rmin + d));
    }
    {   // Truncated cone (frustum), R1 at z=0 and R2 at z=H, semi-angle a with
        // tan a = (R2 - R1)/H. Offsetting by d moves the lateral cone to
        // reference radius R1 + d/cos a about the SAME axis and semi-angle
        // (rho(z) = Rref + z tan a), and the two caps to z = -d and z = H + d.
        // The offset frustum's end radii are therefore read off the offset cone
        // AT THE NEW CAP PLANES — the d*tan a term is what a naive
        // "R + d/cos a" gets wrong.
        const double R1 = 25, R2 = 12, H = 40, d = 3;
        const double a   = std::atan2(R2 - R1, H);
        const double Rp  = R1 + d / std::cos(a);
        const double r1  = Rp + (-d) * std::tan(a);
        const double r2  = Rp + (H + d) * std::tan(a);
        const double h   = H + 2 * d;
        runCase("cone-frustum-grow", BRepPrimAPI_MakeCone(R1, R2, H).Shape(), d,
                kPi * h / 3.0 * (r1 * r1 + r1 * r2 + r2 * r2));
    }

    // ---------------- MIXED line/arc profile ----------------
    // A rounded-corner plate. Its cap wires mix straight runs with ARCS and its
    // corners are PARTIAL-revolution cylinders — the two things the mixed
    // increment added. Closed form, independent of both engines: the section
    // becomes (W+2d)(H+2d) less the four corners the rounds remove,
    // (4-pi)(r+d)^2, over a height of T+2d.
    //
    // ★ THE MARGIN THAT MAKES THIS CASE WORTH RUNNING: if an arc were flattened
    //   to its CHORD — the one plausible wrong answer here, and a chamfer is a
    //   perfectly valid-looking solid — the volume would read 17808.0 against
    //   18383.362697409, 3.1% low. So the closed form can actually SEE that
    //   substitution, which a "did something come back" check could not.
    {
        const double W = 40, H = 30, T = 12, r = 5, d = 1.0;
        const TopoDS_Shape plate = roundedPlate(W, H, T, r);
        check(!plate.IsNull(), "rounded-plate fixture built (4 vertical edges rounded)");
        if (!plate.IsNull()) {
            runCase("rounded-plate-grow", plate, d,
                    ((W + 2 * d) * (H + 2 * d) - (4.0 - kPi) * (r + d) * (r + d)) * (T + 2 * d));
            // THE OTHER SIGN. A shrink drives the corner radius DOWN (r-d), which
            // is the direction that can collapse it, so it is asserted here rather
            // than assumed to follow from the grow.
            const double e = -2.0;
            runCase("rounded-plate-shrink", plate, e,
                    ((W + 2 * e) * (H + 2 * e) - (4.0 - kPi) * (r + e) * (r + e)) * (T + 2 * e));
        }
    }

    // ---------------- negative control ----------------
    // Two solids whose volumes agree to 10 significant figures and whose
    // geometry does not. If the comparator passes this, every geometric
    // assertion above is decoration.
    {
        std::printf("\n--- control: SAME volume, DIFFERENT solid ---\n");
        // 46 x 36 x 26 = 43056 exactly (the box-grow answer).
        const TopoDS_Shape a = BRepPrimAPI_MakeBox(46.0, 36.0, 26.0).Shape();
        // 43056 = 39 x 46.4516129032258... x 23.76 -> pick a cuboid of the SAME
        // volume with different extents AND a different corner.
        const double bx = 39.0, by = 23.76;
        const double bz = 43056.0 / (bx * by);
        const TopoDS_Shape b = BRepPrimAPI_MakeBox(gp_Pnt(1.0, 0.0, 0.0), bx, by, bz).Shape();
        const Metrics ma = measure(a), mb = measure(b);
        std::printf("      A vol=%.10g   B vol=%.10g   (relative diff %.3g)\n",
                    ma.vol, mb.vol, std::fabs(ma.vol - mb.vol) / ma.vol);
        check(relClose(ma.vol, mb.vol, 1.0e-9),
              "control: the two solids DO match on volume to 1e-9");
        const int bad = compareAB("control", ma, mb, /*report*/ false);
        check(bad > 0,
              "control: the comparator REJECTS them on position/topology "
              "(" + std::to_string(bad) + " sub-assertions failed)");
    }

    std::printf("\n===== %d/%d assertions passed =====\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
