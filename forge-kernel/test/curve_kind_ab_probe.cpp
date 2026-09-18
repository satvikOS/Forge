// ─────────────────────────────────────────────────────────────────────────────
// curve_kind_ab_probe.cpp — the A/B for T-146.
//
// NativeLoftPipe classified edge curves through OCCT RTTI
// (`c->IsKind(STANDARD_TYPE(Geom_X))` under a `Handle(Geom_TrimmedCurve)` unwrap
// loop), which made the production dylib demand six `get_type_descriptor()`
// symbols from TKG3d. The replacement is `BRepAdaptor_Curve::GetType()`, whose
// answer is a `GeomAbs_CurveType` enum constant — and enum constants are not
// symbols.
//
// A substitution is only honest if the ANSWERS do not move. This probe carries
// BOTH implementations of every primitive the engine used RTTI for and runs them
// in the SAME process over the SAME edges, so a difference cannot hide behind
// two builds, two fixtures or two tolerances:
//
//   isLineEdge(e)         — the polygon/spine precondition
//   exactlyConvertible(e) — the exactness whitelist (line/circle/ellipse/
//                           Bezier/B-spline in; parabola, hyperbola and offset
//                           curve REFUSED, because the native converter samples
//                           those rather than converting them exactly)
//   edgeKind(e)           — the Line / Circle / Other split that
//                           edgeIsTranslateOf, arcChainRing and profileFrame use
//   edgeCircle(e)         — the gp_Circ (centre, axis, radius) that
//                           circleProfile, fullCircleWire, arcChainRing and
//                           profileFrame read off a circular edge
//
// It links NO forge object: it is a statement about the OCCT idiom, not about
// the engine, so the engine cannot report its own bug back as a property of the
// substitution.
//
// Exit 0 iff every OLD answer equals every NEW answer on every case.
// ─────────────────────────────────────────────────────────────────────────────
#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GeomAbs_CurveType.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Hyperbola.hxx>
#include <Geom_Line.hxx>
#include <Geom_OffsetCurve.hxx>
#include <Geom_Parabola.hxx>
#include <Geom_Plane.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
#include <gp_Hypr.hxx>
#include <gp_Lin.hxx>
#include <gp_Parab.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Trsf.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// ───────────────────────────────────────────────────────── OLD: the RTTI forms
// Copied verbatim from NativeLoftPipe.cpp at 015dd83c (the parent of this
// change), so the "before" column is the shipped code's own answer and not a
// paraphrase of it.

static bool old_isLineEdge(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    while (!c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_TrimmedCurve))) {
        c = Handle(Geom_TrimmedCurve)::DownCast(c)->BasisCurve();
    }
    return !c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_Line));
}

static bool old_exactlyConvertible(const Handle(Geom_Curve)& c0) {
    Handle(Geom_Curve) c = c0;
    while (!c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
        c = Handle(Geom_TrimmedCurve)::DownCast(c)->BasisCurve();
    if (c.IsNull()) return false;
    return c->IsKind(STANDARD_TYPE(Geom_Line))
        || c->IsKind(STANDARD_TYPE(Geom_Circle))
        || c->IsKind(STANDARD_TYPE(Geom_Ellipse))
        || c->IsKind(STANDARD_TYPE(Geom_BezierCurve))
        || c->IsKind(STANDARD_TYPE(Geom_BSplineCurve));
}

// The engine's own gate in front of exactlyConvertible (edgeToBSpline01):
// a null 3D curve or an empty parameter range is refused before the test runs.
static bool old_exactlyConvertibleEdge(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull() || !(l > f)) return false;
    return old_exactlyConvertible(c);
}

enum class Kind { None, Line, Circle, Other };

// The Line / Circle / Other split as edgeIsTranslateOf, arcChainRing and
// profileFrame performed it: unwrap the trims, then IsKind.
static Kind old_edgeKind(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) cv = BRep_Tool::Curve(e, f, l);
    while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
        cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
    if (cv.IsNull()) return Kind::None;
    if (cv->IsKind(STANDARD_TYPE(Geom_Line))) return Kind::Line;
    if (cv->IsKind(STANDARD_TYPE(Geom_Circle))) return Kind::Circle;
    return Kind::Other;
}

static bool old_edgeCircle(const TopoDS_Edge& e, gp_Circ& out) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) cv = BRep_Tool::Curve(e, f, l);
    while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
        cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
    if (cv.IsNull() || !cv->IsKind(STANDARD_TYPE(Geom_Circle))) return false;
    out = Handle(Geom_Circle)::DownCast(cv)->Circ();
    return true;
}

// ─────────────────────────────────────────────── NEW: BRepAdaptor_Curve forms
// These are the bodies the change installs in NativeLoftPipe.cpp. The null-3D-
// curve guard is kept explicitly: BRepAdaptor_Curve falls back to the edge's
// pcurve-on-surface when there is no 3D curve, and the OLD code answered
// false/None there, so the guard is what keeps the two columns equal.

static bool new_isLineEdge(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    if (BRep_Tool::Curve(e, f, l).IsNull()) return false;
    return BRepAdaptor_Curve(e).GetType() == GeomAbs_Line;
}

static bool new_exactlyConvertibleEdge(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull() || !(l > f)) return false;
    switch (BRepAdaptor_Curve(e).GetType()) {
        case GeomAbs_Line:
        case GeomAbs_Circle:
        case GeomAbs_Ellipse:
        case GeomAbs_BezierCurve:
        case GeomAbs_BSplineCurve:
            return true;
        default:
            return false;
    }
}

static Kind new_edgeKind(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    if (BRep_Tool::Curve(e, f, l).IsNull()) return Kind::None;
    const GeomAbs_CurveType t = BRepAdaptor_Curve(e).GetType();
    if (t == GeomAbs_Line) return Kind::Line;
    if (t == GeomAbs_Circle) return Kind::Circle;
    return Kind::Other;
}

static bool new_edgeCircle(const TopoDS_Edge& e, gp_Circ& out) {
    Standard_Real f = 0.0, l = 0.0;
    if (BRep_Tool::Curve(e, f, l).IsNull()) return false;
    BRepAdaptor_Curve ac(e);
    if (ac.GetType() != GeomAbs_Circle) return false;
    out = ac.Circle();
    return true;
}

// THE NEGATIVE CONTROL. Same body with the null-3D-curve guard REMOVED. A probe
// that only shows old==new proves nothing about whether the guard is doing any
// work — this one is run on the pcurve-only edge and MUST disagree with OLD,
// which is what makes the guard's presence in the shipped code load-bearing
// rather than decorative.
static Kind unguarded_edgeKind(const TopoDS_Edge& e) {
    const GeomAbs_CurveType t = BRepAdaptor_Curve(e).GetType();
    if (t == GeomAbs_Line) return Kind::Line;
    if (t == GeomAbs_Circle) return Kind::Circle;
    return Kind::Other;
}

// ───────────────────────────────────────────────────────────────── the fixtures

// An edge that keeps the curve it is HANDED, trims and all. BRepLib_MakeEdge
// strips Geom_TrimmedCurve wrappers, so the trimmed cases have to be built
// through BRep_Builder or the probe would never test the unwrap loop at all.
static TopoDS_Edge rawEdge(const Handle(Geom_Curve)& c, double f, double l,
                           const TopLoc_Location& loc = TopLoc_Location()) {
    BRep_Builder bb;
    TopoDS_Edge e;
    bb.MakeEdge(e);
    bb.UpdateEdge(e, c, loc, Precision::Confusion());
    TopoDS_Vertex v0, v1;
    gp_Pnt p0 = c->Value(f), p1 = c->Value(l);
    if (!loc.IsIdentity()) {
        p0.Transform(loc.Transformation());
        p1.Transform(loc.Transformation());
    }
    bb.MakeVertex(v0, p0, Precision::Confusion());
    bb.MakeVertex(v1, p1, Precision::Confusion());
    v0.Orientation(TopAbs_FORWARD);
    v1.Orientation(TopAbs_REVERSED);
    bb.Add(e, v0);
    bb.Add(e, v1);
    bb.Range(e, f, l);
    return e;
}

static Handle(Geom_BSplineCurve) makeBSpline() {
    TColgp_Array1OfPnt poles(1, 4);
    poles(1) = gp_Pnt(0, 0, 0);
    poles(2) = gp_Pnt(1, 2, 0);
    poles(3) = gp_Pnt(3, -1, 1);
    poles(4) = gp_Pnt(4, 1, 0);
    TColStd_Array1OfReal knots(1, 2);
    knots(1) = 0.0;
    knots(2) = 1.0;
    TColStd_Array1OfInteger mults(1, 2);
    mults(1) = 4;
    mults(2) = 4;
    return new Geom_BSplineCurve(poles, knots, mults, 3);
}

static Handle(Geom_BezierCurve) makeBezier() {
    TColgp_Array1OfPnt poles(1, 3);
    poles(1) = gp_Pnt(0, 0, 0);
    poles(2) = gp_Pnt(1, 3, 0);
    poles(3) = gp_Pnt(2, 0, 0);
    return new Geom_BezierCurve(poles);
}

struct Case {
    std::string name;
    TopoDS_Edge edge;
};

static const char* kindName(Kind k) {
    switch (k) {
        case Kind::None:   return "None";
        case Kind::Line:   return "Line";
        case Kind::Circle: return "Circle";
        default:           return "Other";
    }
}

int main() {
    std::vector<Case> cases;
    TopoDS_Edge pcurveOnly;
    const gp_Ax2 ax(gp_Pnt(1, 2, 3), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
    const gp_Ax2 axT(gp_Pnt(-4, 0.5, 2), gp_Dir(0.3, -0.4, 0.86602540378), gp_Dir(1, 0, 0));

    Handle(Geom_Line)        gline = new Geom_Line(gp_Lin(gp_Pnt(0, 0, 0), gp_Dir(1, 1, 0)));
    Handle(Geom_Circle)      gcirc = new Geom_Circle(ax, 5.0);
    Handle(Geom_Circle)      gcircT = new Geom_Circle(axT, 2.75);
    Handle(Geom_Ellipse)     gelli = new Geom_Ellipse(ax, 7.0, 3.0);
    Handle(Geom_BezierCurve) gbez  = makeBezier();
    Handle(Geom_BSplineCurve) gbsp = makeBSpline();
    Handle(Geom_Parabola)    gpar  = new Geom_Parabola(ax, 2.0);
    Handle(Geom_Hyperbola)   ghyp  = new Geom_Hyperbola(gp_Hypr(ax, 4.0, 2.0));
    Handle(Geom_OffsetCurve) goffL = new Geom_OffsetCurve(gline, 1.5, gp_Dir(0, 0, 1));
    Handle(Geom_OffsetCurve) goffB = new Geom_OffsetCurve(gbsp, 0.75, gp_Dir(0, 0, 1));

    // ── MakeEdge forms: what the corpus actually hands the engine.
    cases.push_back({"mk_line_segment",
                     BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0)).Edge()});
    cases.push_back({"mk_circle_full", BRepBuilderAPI_MakeEdge(gcirc).Edge()});
    cases.push_back({"mk_circle_arc",
                     BRepBuilderAPI_MakeEdge(gcirc, 0.0, 1.2).Edge()});
    cases.push_back({"mk_circle_tilted", BRepBuilderAPI_MakeEdge(gcircT).Edge()});
    cases.push_back({"mk_ellipse_full", BRepBuilderAPI_MakeEdge(gelli).Edge()});
    cases.push_back({"mk_ellipse_arc", BRepBuilderAPI_MakeEdge(gelli, 0.2, 2.0).Edge()});
    cases.push_back({"mk_bezier", BRepBuilderAPI_MakeEdge(gbez).Edge()});
    cases.push_back({"mk_bspline", BRepBuilderAPI_MakeEdge(gbsp).Edge()});
    cases.push_back({"mk_parabola", BRepBuilderAPI_MakeEdge(gpar, -2.0, 2.0).Edge()});
    cases.push_back({"mk_hyperbola", BRepBuilderAPI_MakeEdge(ghyp, -1.0, 1.0).Edge()});
    cases.push_back({"mk_offset_of_line", BRepBuilderAPI_MakeEdge(goffL, 0.0, 6.0).Edge()});
    cases.push_back({"mk_offset_of_bspline", BRepBuilderAPI_MakeEdge(goffB, 0.0, 1.0).Edge()});

    // ── raw forms: the Geom_TrimmedCurve wrappers the unwrap loop existed for.
    cases.push_back({"raw_trimmed_line",
                     rawEdge(new Geom_TrimmedCurve(gline, 0.0, 4.0), 0.0, 4.0)});
    cases.push_back({"raw_trimmed_trimmed_line",
                     rawEdge(new Geom_TrimmedCurve(
                                 new Geom_TrimmedCurve(gline, 0.0, 6.0), 1.0, 4.0),
                             1.0, 4.0)});
    cases.push_back({"raw_trimmed_circle",
                     rawEdge(new Geom_TrimmedCurve(gcirc, 0.3, 2.1), 0.3, 2.1)});
    cases.push_back({"raw_trimmed_trimmed_circle",
                     rawEdge(new Geom_TrimmedCurve(
                                 new Geom_TrimmedCurve(gcirc, 0.0, 3.0), 0.4, 1.9),
                             0.4, 1.9)});
    cases.push_back({"raw_trimmed_ellipse",
                     rawEdge(new Geom_TrimmedCurve(gelli, 0.1, 1.4), 0.1, 1.4)});
    cases.push_back({"raw_trimmed_bezier",
                     rawEdge(new Geom_TrimmedCurve(gbez, 0.1, 0.9), 0.1, 0.9)});
    cases.push_back({"raw_trimmed_bspline",
                     rawEdge(new Geom_TrimmedCurve(gbsp, 0.0, 1.0), 0.0, 1.0)});
    cases.push_back({"raw_trimmed_parabola",
                     rawEdge(new Geom_TrimmedCurve(gpar, -1.0, 1.0), -1.0, 1.0)});
    cases.push_back({"raw_trimmed_hyperbola",
                     rawEdge(new Geom_TrimmedCurve(ghyp, -0.5, 0.5), -0.5, 0.5)});
    cases.push_back({"raw_trimmed_offset",
                     rawEdge(new Geom_TrimmedCurve(goffL, 0.0, 3.0), 0.0, 3.0)});
    cases.push_back({"raw_bare_circle", rawEdge(gcirc, 0.0, 6.283185307179586)});
    cases.push_back({"raw_bare_line", rawEdge(gline, 0.0, 5.0)});

    // ── LOCATION applied: the engine reads a gp_Circ in WORLD space, so the
    //    edge's TopLoc must reach the answer the same way in both columns.
    gp_Trsf tr;
    tr.SetRotation(gp_Ax1(gp_Pnt(2, -1, 0), gp_Dir(1, 2, 3)), 0.7);
    gp_Trsf tl;
    tl.SetTranslation(gp_Vec(3.5, -2.25, 8.0));
    tr.PreMultiply(tl);
    const TopLoc_Location loc(tr);
    cases.push_back({"loc_circle", rawEdge(gcirc, 0.0, 6.283185307179586, loc)});
    cases.push_back({"loc_trimmed_circle",
                     rawEdge(new Geom_TrimmedCurve(gcirc, 0.2, 2.4), 0.2, 2.4, loc)});
    cases.push_back({"loc_trimmed_line",
                     rawEdge(new Geom_TrimmedCurve(gline, 0.0, 4.0), 0.0, 4.0, loc)});
    cases.push_back({"loc_ellipse", rawEdge(gelli, 0.0, 6.283185307179586, loc)});

    // ── REVERSED orientation: classification must not depend on it.
    {
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gcirc, 0.0, 1.2).Edge();
        e.Orientation(TopAbs_REVERSED);
        cases.push_back({"rev_circle_arc", e});
        TopoDS_Edge e2 = BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(3, 4, 0)).Edge();
        e2.Orientation(TopAbs_REVERSED);
        cases.push_back({"rev_line_segment", e2});
    }

    // ── STRAIGHT B-spline / Bezier. Geometrically a segment, but NOT a Geom_Line:
    //    the OLD code answered isLineEdge=false / exactlyConvertible=true, and a
    //    classifier that simplified the curve instead of naming its class would
    //    quietly let these into polygonRing and the spine test. This is the case
    //    that proves GetType() reports the CLASS, not the shape.
    {
        TColgp_Array1OfPnt p2(1, 2);
        p2(1) = gp_Pnt(0, 0, 0);
        p2(2) = gp_Pnt(6, 0, 0);
        TColStd_Array1OfReal k2(1, 2);
        k2(1) = 0.0;
        k2(2) = 1.0;
        TColStd_Array1OfInteger m2(1, 2);
        m2(1) = 2;
        m2(2) = 2;
        Handle(Geom_BSplineCurve) straightBsp = new Geom_BSplineCurve(p2, k2, m2, 1);
        Handle(Geom_BezierCurve)  straightBez = new Geom_BezierCurve(p2);
        cases.push_back({"mk_bspline_deg1_straight",
                         BRepBuilderAPI_MakeEdge(straightBsp).Edge()});
        cases.push_back({"mk_bezier_deg1_straight",
                         BRepBuilderAPI_MakeEdge(straightBez).Edge()});
        cases.push_back({"raw_trimmed_bspline_straight",
                         rawEdge(new Geom_TrimmedCurve(straightBsp, 0.0, 1.0), 0.0, 1.0)});
    }

    // ── an edge with NO geometry at all: BRepAdaptor_Curve THROWS here, which is
    //    exactly why the null-3D-curve guard is kept in front of it.
    {
        BRep_Builder bb;
        TopoDS_Edge e;
        bb.MakeEdge(e);
        cases.push_back({"degenerate_no_curve", e});
    }

    // ── PCURVE ONLY: no 3D curve, just a 2D curve on a plane. BRep_Tool::Curve
    //    returns null, so the OLD code answered false/None — but an UNGUARDED
    //    BRepAdaptor_Curve falls back to Adaptor3d_CurveOnSurface and classifies
    //    the pcurve instead. This case is the whole reason the null guard is kept;
    //    drop the guard and this row is where the two columns part.
    {
        BRep_Builder bb;
        TopoDS_Edge e;
        bb.MakeEdge(e);
        Handle(Geom_Plane) pl = new Geom_Plane(gp_Pnt(0, 0, 4), gp_Dir(0, 0, 1));
        Handle(Geom2d_Line) l2 = new Geom2d_Line(gp_Pnt2d(0, 0), gp_Dir2d(1, 0));
        bb.UpdateEdge(e, l2, pl, TopLoc_Location(), Precision::Confusion());
        bb.Range(e, pl, TopLoc_Location(), 0.0, 5.0);
        cases.push_back({"pcurve_only_line_on_plane", e});
        pcurveOnly = e;
    }

    std::printf("%-28s | %-13s | %-13s | %-15s | %s\n",
                "case", "isLineEdge", "exactlyConv", "edgeKind", "circle(cx,cy,cz,ax,ay,az,r)");
    std::printf("%-28s-+-%-13s-+-%-13s-+-%-15s-+-%s\n",
                "----------------------------", "-------------", "-------------",
                "---------------", "---------------------------");

    int mismatches = 0;
    for (const Case& c : cases) {
        bool oL = false, nL = false, oX = false, nX = false;
        Kind oK = Kind::None, nK = Kind::None;
        bool oC = false, nC = false;
        gp_Circ ocirc, ncirc;
        std::string oldThrew, newThrew;

        try { oL = old_isLineEdge(c.edge); }            catch (const Standard_Failure&) { oldThrew += "L"; }
        try { oX = old_exactlyConvertibleEdge(c.edge); } catch (const Standard_Failure&) { oldThrew += "X"; }
        try { oK = old_edgeKind(c.edge); }               catch (const Standard_Failure&) { oldThrew += "K"; }
        try { oC = old_edgeCircle(c.edge, ocirc); }      catch (const Standard_Failure&) { oldThrew += "C"; }

        try { nL = new_isLineEdge(c.edge); }             catch (const Standard_Failure&) { newThrew += "L"; }
        try { nX = new_exactlyConvertibleEdge(c.edge); } catch (const Standard_Failure&) { newThrew += "X"; }
        try { nK = new_edgeKind(c.edge); }               catch (const Standard_Failure&) { newThrew += "K"; }
        try { nC = new_edgeCircle(c.edge, ncirc); }      catch (const Standard_Failure&) { newThrew += "C"; }

        bool bad = false;
        if (oL != nL) bad = true;
        if (oX != nX) bad = true;
        if (oK != nK) bad = true;
        if (oC != nC) bad = true;
        if (oldThrew != newThrew) bad = true;
        double dmax = 0.0;
        if (oC && nC) {
            dmax = std::max(dmax, ocirc.Location().Distance(ncirc.Location()));
            dmax = std::max(dmax, std::fabs(ocirc.Radius() - ncirc.Radius()));
            dmax = std::max(dmax, ocirc.Axis().Direction().Angle(ncirc.Axis().Direction()));
            // EXACT, not "close enough": the two columns must agree to 1e-12,
            // which is far tighter than any tolerance the engine compares with,
            // so this can never pass by a widened band.
            if (!(dmax <= 1.0e-12)) bad = true;
        }

        char circbuf[160] = "-";
        if (oC) {
            const gp_Pnt p = ocirc.Location();
            const gp_Dir d = ocirc.Axis().Direction();
            std::snprintf(circbuf, sizeof circbuf,
                          "%.9f,%.9f,%.9f,%.9f,%.9f,%.9f,%.9f",
                          p.X(), p.Y(), p.Z(), d.X(), d.Y(), d.Z(), ocirc.Radius());
        }

        std::printf("%-28s | old=%d new=%d | old=%d new=%d | old=%-6s new=%-6s | %s\n",
                    c.name.c_str(), int(oL), int(nL), int(oX), int(nX),
                    kindName(oK), kindName(nK), circbuf);
        if (oC && nC) std::printf("%-28s |   circle agreement dmax = %.3e\n", "", dmax);
        if (!oldThrew.empty() || !newThrew.empty())
            std::printf("%-28s |   threw old=[%s] new=[%s]\n", "",
                        oldThrew.c_str(), newThrew.c_str());
        if (bad) {
            std::printf("  *** MISMATCH on %s\n", c.name.c_str());
            ++mismatches;
        }
    }

    // ── THE CONTROL. If the guard were decorative, removing it would change
    //    nothing and this probe's 35 agreements would be worthless. Run the
    //    UNGUARDED body on the pcurve-only edge and show that it does NOT
    //    reproduce the OLD answer.
    {
        Kind guarded = new_edgeKind(pcurveOnly);
        Kind unguarded = Kind::None;
        std::string threw;
        try { unguarded = unguarded_edgeKind(pcurveOnly); }
        catch (const Standard_Failure&) { threw = "threw"; }
        const bool controlDiffers = (unguarded != guarded) || !threw.empty();
        std::printf("\nCONTROL pcurve_only_line_on_plane:"
                    " guarded=%s unguarded=%s%s -> guard is %s\n",
                    kindName(guarded), kindName(unguarded),
                    threw.empty() ? "" : " (threw)",
                    controlDiffers ? "LOAD-BEARING" : "*** NO-OP: probe is blind ***");
        if (!controlDiffers) {
            std::printf("  *** CONTROL FAILED: the null guard changes no answer,"
                        " so this probe cannot prove it is needed\n");
            ++mismatches;
        }
    }

    std::printf("\ncases=%zu mismatches=%d\n", cases.size(), mismatches);
    std::printf("%s\n", mismatches == 0 ? "AB_RESULT=IDENTICAL" : "AB_RESULT=DIVERGED");
    return mismatches == 0 ? 0 : 1;
}
