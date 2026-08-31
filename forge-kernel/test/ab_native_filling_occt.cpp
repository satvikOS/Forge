// forge-kernel/test/ab_native_filling_occt.cpp
//
// LIVE-OCCT A/B for TKOffset family C —
//   forge::occtfill::fillC0Boundary  vs  BRepOffsetAPI_MakeFilling
// on the SAME boundaries, in ONE process.
//
// WHY EACH ASSERTION EXISTS. Area alone proves nothing, for the same reason
// volume alone proves nothing: this repo has already measured a wrong solid
// matching the right volume to ten significant figures. So each case asserts
// AREA and CENTRE OF MASS and BOUNDING BOX and face/edge/vertex counts and
// validity, plus the SURFACE TYPE, plus a whole-solid end-to-end where the cap
// is sewn back into a box and the resulting SOLID is measured.
//
// ★ OCCT IS NOT AN EXACT ORACLE FOR THIS FAMILY, and the A/B says so with
//   numbers rather than inheriting its error. BRepOffsetAPI_MakeFilling returns
//   a B-SPLINE approximation of the plate; the native engine returns the exact
//   analytic Geom_Plane region. On a POLYGONAL boundary the two agree to 1e-9,
//   so OCCT is used as the oracle there. On a CIRCULAR boundary OCCT's area is
//   wrong in the 7th significant figure, so the oracle there is the CLOSED FORM
//   pi r^2, and OCCT's error is ASSERTED so the claim is on the record.
//
// NEGATIVE CONTROL. Two faces whose areas agree to ten significant figures and
// whose geometry does not, asserted to be REJECTED by the comparator. A gate
// that cannot fail is not a gate.
//
// DEFER CONTROLS. Four cases assert a NULL return outside the stated scope. The
// sharpest is "planar vertices, non-planar arc": all four corners lie in z=0 but
// one edge is an arc bulging to z=5, so an endpoint-only planarity test would
// wrongly accept it and flatten real geometry. That case is why the engine
// samples whole curves.
//
// Exit 0 iff every assertion holds. Build + run with
//   bash forge-kernel/test/run_ab_native_filling.sh

#include "forge/native/brep/NativeFilling.hpp"

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
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
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

const char* surfType(const TopoDS_Shape& s) {
    for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
        BRepAdaptor_Surface a(TopoDS::Face(e.Current()));
        switch (a.GetType()) {
            case GeomAbs_Plane:           return "Plane";
            case GeomAbs_BSplineSurface:  return "BSplineSurface";
            case GeomAbs_BezierSurface:   return "BezierSurface";
            default:                      return "other";
        }
    }
    return "none";
}

// ---------------------------------------------------------------- metrics
struct Metrics {
    double area = 0.0;         // SurfaceProperties for a face
    double vol = 0.0;          // VolumeProperties for a solid
    double com[3] = {0, 0, 0};
    double bb[6] = {0, 0, 0, 0, 0, 0};
    int nFace = 0, nEdge = 0, nVert = 0;
    bool valid = false;
};

Metrics measureFace(const TopoDS_Shape& s) {
    Metrics m;
    GProp_GProps g;
    BRepGProp::SurfaceProperties(s, g);
    m.area = g.Mass();
    const gp_Pnt c = g.CentreOfMass();
    m.com[0] = c.X(); m.com[1] = c.Y(); m.com[2] = c.Z();
    Bnd_Box box;
    BRepBndLib::Add(s, box);
    box.SetGap(0.0);
    box.Get(m.bb[0], m.bb[1], m.bb[2], m.bb[3], m.bb[4], m.bb[5]);
    TopTools_IndexedMapOfShape mf, me, mv;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    m.nFace = mf.Extent(); m.nEdge = me.Extent(); m.nVert = mv.Extent();
    m.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True;
    return m;
}

Metrics measureSolid(const TopoDS_Shape& s) {
    Metrics m = measureFace(s);
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    m.vol = std::fabs(g.Mass());
    const gp_Pnt c = g.CentreOfMass();
    m.com[0] = c.X(); m.com[1] = c.Y(); m.com[2] = c.Z();
    return m;
}

// The comparator. Returns the number of FAILED sub-assertions so the negative
// control can assert it returns > 0.
int compareAB(const std::string& tag, const Metrics& n, const Metrics& o,
              bool useVolume, bool compareBBox, bool report) {
    int bad = 0;
    auto sub = [&](bool ok, const std::string& what) {
        if (!ok) ++bad;
        if (report) check(ok, tag + " " + what);
    };
    if (useVolume) sub(relClose(n.vol, o.vol, 1.0e-9), "volume native==OCCT");
    else           sub(relClose(n.area, o.area, 1.0e-9), "area native==OCCT");
    for (int k = 0; k < 3; ++k)
        sub(std::fabs(n.com[k] - o.com[k]) <= 1.0e-7,
            std::string("centre-of-mass ") + "xyz"[k] + " native==OCCT");
    if (compareBBox) {
        static const char* bbn[6] = {"xmin", "ymin", "zmin", "xmax", "ymax", "zmax"};
        for (int k = 0; k < 6; ++k)
            sub(std::fabs(n.bb[k] - o.bb[k]) <= 1.0e-7,
                std::string("bbox ") + bbn[k] + " native==OCCT");
    }
    sub(n.nFace == o.nFace, "face count native==OCCT");
    sub(n.nEdge == o.nEdge, "edge count native==OCCT");
    sub(n.nVert == o.nVert, "vertex count native==OCCT");
    sub(n.valid, "native shape VALID (BRepCheck_Analyzer)");
    return bad;
}

// ---------------------------------------------------------------- shapes
TopoDS_Wire polyWire(const std::vector<gp_Pnt>& pts) {
    BRepBuilderAPI_MakePolygon p;
    for (const gp_Pnt& q : pts) p.Add(q);
    p.Close();
    p.Build();
    return p.Wire();
}

TopoDS_Shape occtFill(const TopoDS_Wire& w) {
    BRepOffsetAPI_MakeFilling f;
    for (TopExp_Explorer e(w, TopAbs_EDGE); e.More(); e.Next())
        f.Add(TopoDS::Edge(e.Current()), GeomAbs_C0);
    f.Build();
    return f.IsDone() ? f.Shape() : TopoDS_Shape();
}

// Bounding box of a WIRE — the exact extent of the trimmed region a correct cap
// must have, and what OCCT's B-spline support overshoots.
void wireBBox(const TopoDS_Wire& w, double out[6]) {
    Bnd_Box b;
    BRepBndLib::Add(w, b);
    b.SetGap(0.0);
    b.Get(out[0], out[1], out[2], out[3], out[4], out[5]);
}

}  // namespace

int main() {
    std::printf("== A/B: forge::occtfill::fillC0Boundary vs BRepOffsetAPI_MakeFilling ==\n");

    // ================================ POLYGONAL boundaries ===================
    // OCCT is EXACT on these, so it is used as the oracle.
    {
        struct PolyCase {
            const char* tag;
            std::vector<gp_Pnt> pts;
            double area;                 // independent closed form
        };
        const std::vector<PolyCase> cases{
            {"fill-square", {gp_Pnt(0, 0, 3), gp_Pnt(10, 0, 3),
                             gp_Pnt(10, 10, 3), gp_Pnt(0, 10, 3)}, 100.0},
            {"fill-rect",   {gp_Pnt(-4, -2, 0), gp_Pnt(8, -2, 0),
                             gp_Pnt(8, 5, 0), gp_Pnt(-4, 5, 0)}, 12.0 * 7.0},
            {"fill-tri",    {gp_Pnt(0, 0, 0), gp_Pnt(6, 0, 0), gp_Pnt(0, 8, 0)}, 24.0},
        };
        for (const PolyCase& c : cases) {
            std::printf("\n--- %s (planar polygon; OCCT is exact here) ---\n", c.tag);
            const TopoDS_Wire w = polyWire(c.pts);
            const TopoDS_Shape nat = forge::occtfill::fillC0Boundary(w, 1.0e-6);
            const TopoDS_Shape occ = occtFill(w);
            check(!nat.IsNull(), std::string(c.tag) + " native fill produced a face (no defer)");
            check(!occ.IsNull(), std::string(c.tag) + " OCCT MakeFilling produced a face");
            if (nat.IsNull() || occ.IsNull()) continue;
            const Metrics n = measureFace(nat), o = measureFace(occ);
            std::printf("      native area=%.12g com=(%.9g %.9g %.9g) surf=%s\n",
                        n.area, n.com[0], n.com[1], n.com[2], surfType(nat));
            std::printf("      occt   area=%.12g com=(%.9g %.9g %.9g) surf=%s\n",
                        o.area, o.com[0], o.com[1], o.com[2], surfType(occ));
            // bbox is deliberately NOT compared against OCCT: its B-spline support
            // extends past the trim (measured, see below). It is compared against
            // the WIRE instead, which is the exact truth.
            compareAB(c.tag, n, o, /*useVolume*/ false, /*compareBBox*/ false, /*report*/ true);
            check(relClose(n.area, c.area, 1.0e-12),
                  std::string(c.tag) + " native area == CLOSED FORM (to 1e-12)");
            check(std::string(surfType(nat)) == "Plane",
                  std::string(c.tag) + " native support surface is an analytic PLANE");
            double wb[6];
            wireBBox(w, wb);
            bool exactBox = true;
            for (int k = 0; k < 6; ++k) if (std::fabs(n.bb[k] - wb[k]) > 1.0e-9) exactBox = false;
            check(exactBox,
                  std::string(c.tag) + " native face bbox == its BOUNDARY's bbox exactly");
            bool occtOvershoots = false;
            for (int k = 0; k < 6; ++k) if (std::fabs(o.bb[k] - wb[k]) > 1.0e-6) occtOvershoots = true;
            check(occtOvershoots,
                  std::string(c.tag) +
                      " OCCT's face bbox OVERSHOOTS the boundary (B-spline support past the trim) "
                      "— recorded, which is why bbox is not compared against OCCT");
        }
    }

    // ================================ CURVED boundary ========================
    // OCCT is NOT exact here; the oracle is the closed form and OCCT's error is
    // asserted rather than inherited.
    {
        std::printf("\n--- fill-circle (planar circle; OCCT is APPROXIMATE, closed form is the oracle) ---\n");
        const double r = 5.0;
        const TopoDS_Wire w = BRepBuilderAPI_MakeWire(
            BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), r)).Edge())
                                  .Wire();
        const double exact = M_PI * r * r;
        const TopoDS_Shape nat = forge::occtfill::fillC0Boundary(w, 1.0e-6);
        const TopoDS_Shape occ = occtFill(w);
        check(!nat.IsNull(), "fill-circle native fill produced a face");
        check(!occ.IsNull(), "fill-circle OCCT MakeFilling produced a face");
        if (!nat.IsNull() && !occ.IsNull()) {
            const Metrics n = measureFace(nat), o = measureFace(occ);
            std::printf("      native area=%.12g  (exact pi r^2 = %.12g)  surf=%s\n",
                        n.area, exact, surfType(nat));
            std::printf("      occt   area=%.12g  (error %.3g relative)      surf=%s\n",
                        o.area, std::fabs(o.area - exact) / exact, surfType(occ));
            check(relClose(n.area, exact, 1.0e-12),
                  "fill-circle native area == CLOSED FORM pi r^2 to 1e-12");
            check(std::fabs(n.com[0]) <= 1.0e-9 && std::fabs(n.com[1]) <= 1.0e-9 &&
                      std::fabs(n.com[2]) <= 1.0e-9,
                  "fill-circle native centre of mass is the circle's centre to 1e-9");
            check(std::string(surfType(nat)) == "Plane",
                  "fill-circle native support surface is an analytic PLANE");
            check(!relClose(o.area, exact, 1.0e-9),
                  "fill-circle OCCT area is NOT exact (measured relative error " +
                      std::to_string(std::fabs(o.area - exact) / exact) +
                      ") — so OCCT is not used as the oracle here");
            check(std::fabs(n.area - exact) < std::fabs(o.area - exact),
                  "fill-circle the NATIVE cap is strictly closer to the closed form than OCCT's");
        }
    }

    // ================================ END-TO-END SOLID =======================
    // The real call-site shape: a box missing one face, capped, sewn, promoted to
    // a solid. This is what autoFillMissingFaces actually does.
    {
        std::printf("\n--- fill-e2e: box missing its top face, capped and sewn to a SOLID ---\n");
        const double L = 10.0;
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(L, L, L).Shape();
        TopoDS_Face top;
        std::vector<TopoDS_Face> keep;
        double bestZ = -1.0e30;
        for (TopExp_Explorer e(box, TopAbs_FACE); e.More(); e.Next()) {
            const TopoDS_Face f = TopoDS::Face(e.Current());
            GProp_GProps g;
            BRepGProp::SurfaceProperties(f, g);
            if (g.CentreOfMass().Z() > bestZ) { bestZ = g.CentreOfMass().Z(); top = f; }
        }
        for (TopExp_Explorer e(box, TopAbs_FACE); e.More(); e.Next()) {
            const TopoDS_Face f = TopoDS::Face(e.Current());
            if (!f.IsSame(top)) keep.push_back(f);
        }
        check(keep.size() == 5, "fill-e2e the open shell has exactly 5 faces");
        TopoDS_Wire hole;
        for (TopExp_Explorer e(top, TopAbs_WIRE); e.More(); e.Next())
            hole = TopoDS::Wire(e.Current());
        check(!hole.IsNull(), "fill-e2e the hole boundary wire was found");

        auto sewWith = [&](const TopoDS_Shape& cap) {
            BRepBuilderAPI_Sewing sew(1.0e-6);
            for (const TopoDS_Face& f : keep) sew.Add(f);
            sew.Add(cap);
            sew.Perform();
            const TopoDS_Shape sewn = sew.SewedShape();
            TopoDS_Shape out;
            for (TopExp_Explorer e(sewn, TopAbs_SHELL); e.More(); e.Next()) {
                const TopoDS_Shell sh = TopoDS::Shell(e.Current());
                if (BRep_Tool::IsClosed(sh)) {
                    BRepBuilderAPI_MakeSolid mk(sh);
                    if (mk.IsDone()) out = mk.Solid();
                }
            }
            return out;
        };

        const TopoDS_Shape natCap = forge::occtfill::fillC0Boundary(hole, 1.0e-6);
        const TopoDS_Shape occCap = occtFill(hole);
        check(!natCap.IsNull(), "fill-e2e native cap produced");
        check(!occCap.IsNull(), "fill-e2e OCCT cap produced");
        if (!natCap.IsNull() && !occCap.IsNull()) {
            const TopoDS_Shape natSol = sewWith(natCap);
            const TopoDS_Shape occSol = sewWith(occCap);
            check(!natSol.IsNull(), "fill-e2e native cap SEWS to a CLOSED SOLID");
            if (!natSol.IsNull()) {
                const Metrics n = measureSolid(natSol);
                std::printf("      native solid vol=%.12g com=(%.9g %.9g %.9g) F/E/V=%d/%d/%d valid=%d\n",
                            n.vol, n.com[0], n.com[1], n.com[2], n.nFace, n.nEdge, n.nVert,
                            static_cast<int>(n.valid));
                check(relClose(n.vol, L * L * L, 1.0e-12),
                      "fill-e2e native solid volume == CLOSED FORM L^3 to 1e-12");
                check(std::fabs(n.com[0] - L / 2) <= 1.0e-9 &&
                          std::fabs(n.com[1] - L / 2) <= 1.0e-9 &&
                          std::fabs(n.com[2] - L / 2) <= 1.0e-9,
                      "fill-e2e native solid centre of mass is the box centre to 1e-9");
                check(n.nFace == 6, "fill-e2e native solid has exactly 6 faces");
                check(n.nEdge == 12, "fill-e2e native solid has exactly 12 edges");
                check(n.nVert == 8, "fill-e2e native solid has exactly 8 vertices");
                check(n.nVert - n.nEdge + n.nFace == 2,
                      "fill-e2e native solid Euler-Poincare V-E+F==2");
                check(n.valid, "fill-e2e native solid VALID (BRepCheck_Analyzer)");
                double wb[6];
                wireBBox(hole, wb);
                check(std::fabs(n.bb[5] - wb[5]) <= 1.0e-9,
                      "fill-e2e native solid's top does NOT overshoot the hole boundary");
                if (!occSol.IsNull()) {
                    const Metrics o = measureSolid(occSol);
                    std::printf("      occt   solid vol=%.12g valid=%d\n", o.vol,
                                static_cast<int>(o.valid));
                    compareAB("fill-e2e", n, o, /*useVolume*/ true, /*compareBBox*/ false,
                              /*report*/ true);
                } else {
                    std::printf("      occt   cap did NOT sew to a closed solid — recorded\n");
                }
            }
        }
    }

    // ================================ DEFER CONTROLS =========================
    {
        std::printf("\n--- defer controls ---\n");
        {
            // Genuinely non-planar boundary: a 3-D patch, which this engine does
            // not have and does not fake.
            const TopoDS_Wire w = polyWire({gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0),
                                            gp_Pnt(10, 10, 4), gp_Pnt(0, 10, 0)});
            check(forge::occtfill::fillC0Boundary(w, 1.0e-6).IsNull(),
                  "defer: a NON-PLANAR boundary is DECLINED (no native N-sided patch exists)");
        }
        {
            // ★ THE SHARP ONE: all four CORNERS lie in z=0, but one edge is an arc
            //   bulging to z=5. An endpoint-only planarity test would accept this
            //   and flatten real geometry; sampling whole curves rejects it.
            const gp_Pnt a(0, 0, 0), b(10, 0, 0), mid(5, 0, 5);
            const TopoDS_Edge arc = BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(5, 0, 0),
                                                                          gp_Dir(0, 1, 0)), 5.0),
                                                            a, b).Edge();
            BRepBuilderAPI_MakeWire mw(arc);
            mw.Add(BRepBuilderAPI_MakeEdge(b, gp_Pnt(10, 10, 0)).Edge());
            mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)).Edge());
            mw.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 10, 0), a).Edge());
            mw.Build();
            check(mw.IsDone() == Standard_True, "defer-setup: the arc wire was built");
            if (mw.IsDone()) {
                (void)mid;
                check(forge::occtfill::fillC0Boundary(mw.Wire(), 1.0e-6).IsNull(),
                      "defer: COPLANAR CORNERS but an OUT-OF-PLANE ARC is DECLINED "
                      "(an endpoint-only test would have wrongly accepted this)");
            }
        }
        {
            // An OPEN boundary bounds nothing.
            BRepBuilderAPI_MakePolygon p;
            p.Add(gp_Pnt(0, 0, 0)); p.Add(gp_Pnt(10, 0, 0)); p.Add(gp_Pnt(10, 10, 0));
            p.Build();
            check(forge::occtfill::fillC0Boundary(p.Wire(), 1.0e-6).IsNull(),
                  "defer: an OPEN boundary wire is DECLINED");
        }
        {
            // ★ THE TOLERANCE CONTROL — proves the engine's OWN planarity test is
            //   load-bearing, not decorative.
            //
            //   MEASURED 2026-08-28: BRepBuilderAPI_MakeFace(wire, OnlyPlane) has an
            //   internal planarity threshold between 1e-6 and 1e-5 — it ACCEPTS a
            //   corner displaced by 1e-7 and returns area 100. So for any caller
            //   tolerance TIGHTER than that, MakeFace is NOT a sufficient gate and
            //   the engine's explicit residual test is the only thing standing
            //   between a near-planar boundary and a silently flattened cap.
            //
            //   This control asserts BOTH halves of that: MakeFace accepts the wire,
            //   AND the engine at tol=1e-9 declines it. Without it, widening the
            //   engine's tolerance by 1e12 was measured to leave every other
            //   assertion green — i.e. the test suite could not see the difference.
            const double dev = 1.0e-7;
            const TopoDS_Wire w = polyWire({gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0),
                                            gp_Pnt(10, 10, dev), gp_Pnt(0, 10, 0)});
            BRepBuilderAPI_MakeFace mkf(w, Standard_True);
            check(mkf.IsDone() == Standard_True,
                  "tolerance-control: OCCT MakeFace ACCEPTS a boundary off-plane by 1e-7 "
                  "(so MakeFace alone is not the gate)");
            check(!forge::occtfill::fillC0Boundary(w, 1.0e-2).IsNull(),
                  "tolerance-control: the engine ACCEPTS it at a LOOSE tol of 1e-2");
            check(forge::occtfill::fillC0Boundary(w, 1.0e-9).IsNull(),
                  "tolerance-control: the engine DECLINES it at a TIGHT tol of 1e-9 "
                  "— the engine's own residual test is what rejects it");
        }
        {
            // A COLLINEAR degenerate boundary has no plane and must not be given one.
            BRepBuilderAPI_MakePolygon p;
            p.Add(gp_Pnt(0, 0, 0)); p.Add(gp_Pnt(5, 0, 0)); p.Add(gp_Pnt(10, 0, 0));
            p.Close();
            p.Build();
            check(forge::occtfill::fillC0Boundary(p.Wire(), 1.0e-6).IsNull(),
                  "defer: a COLLINEAR (zero-area) boundary is DECLINED");
        }
    }

    // ================================ NEGATIVE CONTROL =======================
    {
        std::printf("\n--- control: SAME area, DIFFERENT face ---\n");
        // 10x10 square at z=0, and a 20x5 rectangle at z=0 offset in x.
        const TopoDS_Shape a =
            BRepBuilderAPI_MakeFace(polyWire({gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0),
                                              gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)}),
                                    Standard_True).Face();
        const TopoDS_Shape b =
            BRepBuilderAPI_MakeFace(polyWire({gp_Pnt(1, 0, 0), gp_Pnt(21, 0, 0),
                                              gp_Pnt(21, 5, 0), gp_Pnt(1, 5, 0)}),
                                    Standard_True).Face();
        const Metrics ma = measureFace(a), mb = measureFace(b);
        std::printf("      A area=%.12g   B area=%.12g   (relative diff %.3g)\n",
                    ma.area, mb.area, std::fabs(ma.area - mb.area) / ma.area);
        check(relClose(ma.area, mb.area, 1.0e-9),
              "control: the two faces DO match on area to 1e-9");
        const int bad = compareAB("control", ma, mb, /*useVolume*/ false,
                                  /*compareBBox*/ true, /*report*/ false);
        check(bad > 0,
              "control: the comparator REJECTS them on position/bbox (" +
                  std::to_string(bad) + " sub-assertions failed)");
    }

    std::printf("\n===== %d/%d assertions passed =====\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
