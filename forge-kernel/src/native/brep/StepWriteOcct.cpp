// forge/native/brep/StepWriteOcct.cpp — see StepWriteOcct.hpp.
//
// ANALYTIC STEP WRITE from an OCCT TopoDS_Shape, the roundtrip sibling of
// StepReadOcct. Emits the exact entity grammar that reader consumes (surfaces,
// 3D curves, SURFACE_CURVE + PCURVE 2D records, topology, AP242 wrapper).

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/StepWriteOcct.hpp"
#include "forge/native/brep/StepPart21.hpp"
#include "forge/OcctNativeMesh.hpp"     // per-face facet fallback (native mesher)

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <Geom2d_Curve.hxx>             // handle type only — inspected via GeomAPI::To3d
#include <GeomAPI.hxx>                  // To3d (TKGeomAlgo) — mirror of the reader's To2d
#include <GeomConvert.hxx>              // TKGeomBase — B-spline conversion fallback
#include "forge/native/geom/NativeNurbsConvert.hpp"  // R2 native analytic→NURBS (drops TKGeomBase GeomConvert)
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Line.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_Surface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Elips.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

namespace forge {
namespace native {
namespace brep {

using p21::stepFmt;

namespace {

[[noreturn]] void wfail(const std::string& why) {
    throw std::runtime_error(why);
}

// ------------------------------------------------------------------ emitter
struct Emit {
    std::string data;
    std::uint64_t next = 1;
    std::uint64_t alloc() { return next++; }
    void id(std::uint64_t i) { data += '#'; data += std::to_string(i); }
    void refId(std::uint64_t i) { data += '#'; data += std::to_string(i); }

    std::uint64_t point3(const gp_Pnt& p) {
        std::uint64_t i = alloc();
        id(i);
        data += "=CARTESIAN_POINT('',(";
        data += stepFmt(p.X()); data += ','; data += stepFmt(p.Y()); data += ',';
        data += stepFmt(p.Z()); data += "));\n";
        return i;
    }
    std::uint64_t point2(double x, double y) {
        std::uint64_t i = alloc();
        id(i);
        data += "=CARTESIAN_POINT('',(";
        data += stepFmt(x); data += ','; data += stepFmt(y); data += "));\n";
        return i;
    }
    std::uint64_t dir3(const gp_Dir& d) {
        std::uint64_t i = alloc();
        id(i);
        data += "=DIRECTION('',(";
        data += stepFmt(d.X()); data += ','; data += stepFmt(d.Y()); data += ',';
        data += stepFmt(d.Z()); data += "));\n";
        return i;
    }
    std::uint64_t dir2(double x, double y) {
        std::uint64_t i = alloc();
        id(i);
        data += "=DIRECTION('',(";
        data += stepFmt(x); data += ','; data += stepFmt(y); data += "));\n";
        return i;
    }
    std::uint64_t vector3(const gp_Dir& d, double mag) {
        std::uint64_t dId = dir3(d);
        std::uint64_t i = alloc();
        id(i);
        data += "=VECTOR('',#"; data += std::to_string(dId); data += ',';
        data += stepFmt(mag); data += ");\n";
        return i;
    }
    std::uint64_t vector2(double x, double y, double mag) {
        std::uint64_t dId = dir2(x, y);
        std::uint64_t i = alloc();
        id(i);
        data += "=VECTOR('',#"; data += std::to_string(dId); data += ',';
        data += stepFmt(mag); data += ");\n";
        return i;
    }
    std::uint64_t axis2(const gp_Pnt& o, const gp_Dir& z, const gp_Dir& x) {
        std::uint64_t oId = point3(o);
        std::uint64_t zId = dir3(z);
        std::uint64_t xId = dir3(x);
        std::uint64_t i = alloc();
        id(i);
        data += "=AXIS2_PLACEMENT_3D('',#"; data += std::to_string(oId);
        data += ",#"; data += std::to_string(zId);
        data += ",#"; data += std::to_string(xId); data += ");\n";
        return i;
    }
    std::uint64_t axis1(const gp_Pnt& o, const gp_Dir& d) {
        std::uint64_t oId = point3(o);
        std::uint64_t dId = dir3(d);
        std::uint64_t i = alloc();
        id(i);
        data += "=AXIS1_PLACEMENT('',#"; data += std::to_string(oId);
        data += ",#"; data += std::to_string(dId); data += ");\n";
        return i;
    }
    // 2D placement in a surface's parameter space (u->X, v->Y). The reader's
    // getAxis22d always reconstructs with the +Z normal (STEP's implied
    // +90deg-CCW Y), so only DIRECT 2D frames may be written through this.
    std::uint64_t axis22d(double px, double py, double dx, double dy) {
        std::uint64_t oId = point2(px, py);
        std::uint64_t xId = dir2(dx, dy);
        std::uint64_t i = alloc();
        id(i);
        data += "=AXIS2_PLACEMENT_2D('',#"; data += std::to_string(oId);
        data += ",#"; data += std::to_string(xId); data += ");\n";
        return i;
    }
};

// -------------------------------------------------- B-spline curve emission
// Emit a (clamped) Geom_BSplineCurve. `planar2d` writes 2-component parametric
// poles (the PCURVE path), with pole Y pre-multiplied by `yScale` — the
// ISO<->OCCT cone-v convention factor the READER multiplies back out
// (pcurveVScale = 1/cos(semiangle); the writer applies cos(semiangle)).
// Non-rational -> the typed B_SPLINE_CURVE_WITH_KNOTS record; rational -> the
// COMPLEX record form (both consumed by the reader's buildBSplineCurveGeom /
// assembleComplexBSplineCurve).
std::uint64_t emitBSplineCurve(Emit& E, const Handle(Geom_BSplineCurve)& c,
                               bool planar2d, double yScale) {
    const int nP = c->NbPoles();
    const int deg = c->Degree();
    const bool rational = c->IsRational();
    std::vector<std::uint64_t> poleIds(nP);
    for (int i = 1; i <= nP; ++i) {
        gp_Pnt p = c->Pole(i);
        poleIds[i - 1] = planar2d ? E.point2(p.X(), p.Y() * yScale) : E.point3(p);
    }
    const int nK = c->NbKnots();
    std::string ctrl = "(";
    for (int i = 0; i < nP; ++i) {
        if (i) ctrl += ',';
        ctrl += '#'; ctrl += std::to_string(poleIds[i]);
    }
    ctrl += ')';
    std::string mults = "(", knots = "(";
    for (int i = 1; i <= nK; ++i) {
        if (i > 1) { mults += ','; knots += ','; }
        mults += std::to_string(c->Multiplicity(i));
        knots += stepFmt(c->Knot(i));
    }
    mults += ')'; knots += ')';

    std::uint64_t i = E.alloc();
    E.id(i);
    if (!rational) {
        E.data += "=B_SPLINE_CURVE_WITH_KNOTS('',";
        E.data += std::to_string(deg); E.data += ',';
        E.data += ctrl;
        E.data += ",.UNSPECIFIED.,.F.,.F.,";
        E.data += mults; E.data += ','; E.data += knots;
        E.data += ",.UNSPECIFIED.);\n";
    } else {
        std::string w = "(";
        for (int k = 1; k <= nP; ++k) {
            if (k > 1) w += ',';
            w += stepFmt(c->Weight(k));
        }
        w += ')';
        E.data += "=(BOUNDED_CURVE()B_SPLINE_CURVE(";
        E.data += std::to_string(deg); E.data += ',';
        E.data += ctrl;
        E.data += ",.UNSPECIFIED.,.F.,.F.)B_SPLINE_CURVE_WITH_KNOTS(";
        E.data += mults; E.data += ','; E.data += knots;
        E.data += ",.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()"
                  "RATIONAL_B_SPLINE_CURVE("; E.data += w;
        E.data += ")REPRESENTATION_ITEM(''));\n";
    }
    return i;
}

// Clamp/segment a B-spline curve copy to the edge range [f,l] so the written
// spline is exactly the edge span (the reader trims by endpoint projection; a
// clamped exact-span curve makes that trivially stable, and a PERIODIC curve —
// which the reader's clamped-knot-sum check rejects — becomes clamped).
Handle(Geom_BSplineCurve) clampedBSpline(const Handle(Geom_BSplineCurve)& src,
                                         double f, double l) {
    Handle(Geom_BSplineCurve) c = Handle(Geom_BSplineCurve)::DownCast(src->Copy());
    const double eps = Precision::PConfusion();
    try {
        if (c->IsPeriodic()) {
            // Segment aligns the origin with f and clamps (also for a full-period
            // closed edge). If OCCT refuses, fall back to a plain de-periodise.
            try { c->Segment(f, l); }
            catch (const Standard_Failure&) { /* fall through */ }
            if (c->IsPeriodic()) c->SetNotPeriodic();
        } else {
            const double cf = c->FirstParameter(), cl = c->LastParameter();
            const double a = std::max(f, cf), b = std::min(l, cl);
            if (b > a + eps && (a > cf + eps || b < cl - eps)) c->Segment(a, b);
        }
    } catch (const Standard_Failure&) {
        // keep the unsegmented clamped copy — the reader projects endpoints.
        if (c->IsPeriodic()) c->SetNotPeriodic();
    }
    return c;
}

// ------------------------------------------------ B-spline surface emission
std::uint64_t emitBSplineSurface(Emit& E, const Handle(Geom_BSplineSurface)& src) {
    Handle(Geom_BSplineSurface) s = Handle(Geom_BSplineSurface)::DownCast(src->Copy());
    if (s->IsUPeriodic()) s->SetUNotPeriodic();
    if (s->IsVPeriodic()) s->SetVNotPeriodic();
    const int nU = s->NbUPoles(), nV = s->NbVPoles();
    const int uDeg = s->UDegree(), vDeg = s->VDegree();
    const bool rational = s->IsURational() || s->IsVRational();

    std::vector<std::vector<std::uint64_t>> cp(nU, std::vector<std::uint64_t>(nV));
    for (int iu = 1; iu <= nU; ++iu)
        for (int iv = 1; iv <= nV; ++iv)
            cp[iu - 1][iv - 1] = E.point3(s->Pole(iu, iv));

    std::string ctrl = "(";
    for (int iu = 0; iu < nU; ++iu) {
        if (iu) ctrl += ',';
        ctrl += '(';
        for (int iv = 0; iv < nV; ++iv) {
            if (iv) ctrl += ',';
            ctrl += '#'; ctrl += std::to_string(cp[iu][iv]);
        }
        ctrl += ')';
    }
    ctrl += ')';
    auto knotBlock = [&](bool isU, std::string& mults, std::string& knots) {
        const int nK = isU ? s->NbUKnots() : s->NbVKnots();
        mults = "("; knots = "(";
        for (int i = 1; i <= nK; ++i) {
            if (i > 1) { mults += ','; knots += ','; }
            mults += std::to_string(isU ? s->UMultiplicity(i) : s->VMultiplicity(i));
            knots += stepFmt(isU ? s->UKnot(i) : s->VKnot(i));
        }
        mults += ')'; knots += ')';
    };
    std::string uM, uK, vM, vK;
    knotBlock(true, uM, uK);
    knotBlock(false, vM, vK);

    std::uint64_t i = E.alloc();
    E.id(i);
    if (!rational) {
        E.data += "=B_SPLINE_SURFACE_WITH_KNOTS('',";
        E.data += std::to_string(uDeg); E.data += ',';
        E.data += std::to_string(vDeg); E.data += ',';
        E.data += ctrl;
        E.data += ",.UNSPECIFIED.,.F.,.F.,.F.,";
        E.data += uM; E.data += ','; E.data += vM; E.data += ',';
        E.data += uK; E.data += ','; E.data += vK;
        E.data += ",.UNSPECIFIED.);\n";
    } else {
        std::string w = "(";
        for (int iu = 1; iu <= nU; ++iu) {
            if (iu > 1) w += ',';
            w += '(';
            for (int iv = 1; iv <= nV; ++iv) {
                if (iv > 1) w += ',';
                w += stepFmt(s->Weight(iu, iv));
            }
            w += ')';
        }
        w += ')';
        E.data += "=(BOUNDED_SURFACE()B_SPLINE_SURFACE(";
        E.data += std::to_string(uDeg); E.data += ',';
        E.data += std::to_string(vDeg); E.data += ',';
        E.data += ctrl;
        E.data += ",.UNSPECIFIED.,.F.,.F.,.F.)B_SPLINE_SURFACE_WITH_KNOTS(";
        E.data += uM; E.data += ','; E.data += vM; E.data += ',';
        E.data += uK; E.data += ','; E.data += vK;
        E.data += ",.UNSPECIFIED.)GEOMETRIC_REPRESENTATION_ITEM()"
                  "RATIONAL_B_SPLINE_SURFACE("; E.data += w;
        E.data += ")REPRESENTATION_ITEM('')SURFACE());\n";
    }
    return i;
}

// ------------------------------------------------------------- 3D curves
// Emit the FULL geometry of a 3D curve entity (used both for edge curves and
// for swept-surface basis curves). Preserves the curve's own parameterisation
// (line location/direction, circle placement, spline knots) so the reader
// reconstructs the SAME parameterisation — the co-parameterised pcurve
// convention then holds. Returns 0 for a curve class it cannot emit.
std::uint64_t emitCurve3d(Emit& E, Handle(Geom_Curve) c, double f, double l,
                          bool segmentSplines) {
    for (int guard = 0; guard < 8; ++guard) {
        Handle(Geom_TrimmedCurve) t = Handle(Geom_TrimmedCurve)::DownCast(c);
        if (t.IsNull()) break;
        c = t->BasisCurve();
    }
    if (Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(c); !ln.IsNull()) {
        gp_Lin L = ln->Lin();
        std::uint64_t pId = E.point3(L.Location());
        std::uint64_t vId = E.vector3(L.Direction(), 1.0);
        std::uint64_t i = E.alloc();
        E.id(i);
        E.data += "=LINE('',#"; E.data += std::to_string(pId);
        E.data += ",#"; E.data += std::to_string(vId); E.data += ");\n";
        return i;
    }
    if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(c); !ci.IsNull()) {
        gp_Circ cc = ci->Circ();
        std::uint64_t ax = E.axis2(cc.Location(), cc.Axis().Direction(),
                                   cc.XAxis().Direction());
        std::uint64_t i = E.alloc();
        E.id(i);
        E.data += "=CIRCLE('',#"; E.data += std::to_string(ax);
        E.data += ','; E.data += stepFmt(cc.Radius()); E.data += ");\n";
        return i;
    }
    if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(c); !el.IsNull()) {
        gp_Elips ee = el->Elips();
        std::uint64_t ax = E.axis2(ee.Location(), ee.Axis().Direction(),
                                   ee.XAxis().Direction());
        std::uint64_t i = E.alloc();
        E.id(i);
        E.data += "=ELLIPSE('',#"; E.data += std::to_string(ax);
        E.data += ','; E.data += stepFmt(ee.MajorRadius());
        E.data += ','; E.data += stepFmt(ee.MinorRadius()); E.data += ");\n";
        return i;
    }
    if (Handle(Geom_BSplineCurve) bs = Handle(Geom_BSplineCurve)::DownCast(c); !bs.IsNull()) {
        Handle(Geom_BSplineCurve) cl2 =
            segmentSplines ? clampedBSpline(bs, f, l)
                           : Handle(Geom_BSplineCurve)::DownCast(bs->Copy());
        if (cl2->IsPeriodic()) cl2->SetNotPeriodic();
        return emitBSplineCurve(E, cl2, /*planar2d=*/false, 1.0);
    }
    if (Handle(Geom_BezierCurve) bz = Handle(Geom_BezierCurve)::DownCast(c); !bz.IsNull()) {
        try {
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
            Handle(Geom_BSplineCurve) conv = forge::occtconv::curveToBSpline(bz);
#else
            Handle(Geom_BSplineCurve) conv = GeomConvert::CurveToBSplineCurve(bz);
#endif
            if (!conv.IsNull()) return emitBSplineCurve(E, conv, false, 1.0);
        } catch (const Standard_Failure&) {}
        return 0;
    }
    // anything else (parabola / hyperbola / offset curve): trim + convert.
    try {
        Handle(Geom_TrimmedCurve) tr = new Geom_TrimmedCurve(c, f, l);
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
        Handle(Geom_BSplineCurve) conv = forge::occtconv::curveToBSpline(tr);
#else
        Handle(Geom_BSplineCurve) conv = GeomConvert::CurveToBSplineCurve(tr);
#endif
        if (!conv.IsNull()) {
            if (conv->IsPeriodic()) conv->SetNotPeriodic();
            return emitBSplineCurve(E, conv, false, 1.0);
        }
    } catch (const Standard_Failure&) {}
    return 0;
}

// ------------------------------------------------------------- 2D pcurves
// Serialise a pcurve over [f2,l2] with pole/locus Y pre-scaled by `yScale`
// (cos(semiangle) on cones — the reader's pcurveVScale multiplies it back).
// The 2D geometry is inspected through GeomAPI::To3d into the w=0 plane so no
// Geom2d concrete class is referenced (mirror of the reader). Returns 0 when
// the form cannot be written faithfully — the caller then OMITS the pcurve
// (reader falls back to projection; it never sees a wrong pcurve).
std::uint64_t emitPcurve2d(Emit& E, const Handle(Geom2d_Curve)& c2,
                           double f2, double l2, double yScale) {
    if (c2.IsNull()) return 0;
    Handle(Geom_Curve) c3;
    try {
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
        c3 = forge::occtconv::to3d(c2, gp_Pln(gp_Ax3(gp::XOY())));   // R3 native (drops TKGeomAlgo GeomAPI::To3d)
#else
        c3 = GeomAPI::To3d(c2, gp_Pln(gp_Ax3(gp::XOY())));
#endif
    } catch (const Standard_Failure&) {
        return 0;
    }
    if (c3.IsNull()) return 0;
    for (int guard = 0; guard < 8; ++guard) {
        Handle(Geom_TrimmedCurve) t = Handle(Geom_TrimmedCurve)::DownCast(c3);
        if (t.IsNull()) break;
        c3 = t->BasisCurve();
    }
    try {
        if (Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(c3); !ln.IsNull()) {
            gp_Lin L = ln->Lin();
            const gp_Pnt o = L.Location();
            const gp_Dir d = L.Direction();
            if (yScale == 1.0) {
                std::uint64_t pId = E.point2(o.X(), o.Y());
                std::uint64_t vId = E.vector2(d.X(), d.Y(), 1.0);
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=LINE('',#"; E.data += std::to_string(pId);
                E.data += ",#"; E.data += std::to_string(vId); E.data += ");\n";
                return i;
            }
            // The Y-scaled image of a line is still a line; renormalise the
            // direction (the reader rebuilds the exact locus and validates the
            // range by endpoint projection).
            const double sx = d.X(), sy = d.Y() * yScale;
            const double m = std::hypot(sx, sy);
            if (m < 1e-12) return 0;
            std::uint64_t pId = E.point2(o.X(), o.Y() * yScale);
            std::uint64_t vId = E.vector2(sx / m, sy / m, 1.0);
            std::uint64_t i = E.alloc();
            E.id(i);
            E.data += "=LINE('',#"; E.data += std::to_string(pId);
            E.data += ",#"; E.data += std::to_string(vId); E.data += ");\n";
            return i;
        }
        if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(c3); !ci.IsNull()) {
            gp_Circ cc = ci->Circ();
            // The reader's AXIS2_PLACEMENT_2D always reconstructs the DIRECT
            // (+Z) frame; an indirect (clockwise) 2D circle or a cone-scaled one
            // must go through the B-spline fallback below.
            if (yScale == 1.0 && cc.Axis().Direction().Z() > 0.0) {
                std::uint64_t ax = E.axis22d(cc.Location().X(), cc.Location().Y(),
                                             cc.XAxis().Direction().X(),
                                             cc.XAxis().Direction().Y());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=CIRCLE('',#"; E.data += std::to_string(ax);
                E.data += ','; E.data += stepFmt(cc.Radius()); E.data += ");\n";
                return i;
            }
        }
        if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(c3); !el.IsNull()) {
            gp_Elips ee = el->Elips();
            if (yScale == 1.0 && ee.Axis().Direction().Z() > 0.0) {
                std::uint64_t ax = E.axis22d(ee.Location().X(), ee.Location().Y(),
                                             ee.XAxis().Direction().X(),
                                             ee.XAxis().Direction().Y());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=ELLIPSE('',#"; E.data += std::to_string(ax);
                E.data += ','; E.data += stepFmt(ee.MajorRadius());
                E.data += ','; E.data += stepFmt(ee.MinorRadius()); E.data += ");\n";
                return i;
            }
        }
        Handle(Geom_BSplineCurve) bs = Handle(Geom_BSplineCurve)::DownCast(c3);
        if (bs.IsNull()) {
            // conic under scaling / indirect frame / other: exact-span convert.
            Handle(Geom_TrimmedCurve) tr = new Geom_TrimmedCurve(c3, f2, l2);
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
            bs = forge::occtconv::curveToBSpline(tr);
#else
            bs = GeomConvert::CurveToBSplineCurve(tr);
#endif
            if (bs.IsNull()) return 0;
        } else {
            bs = clampedBSpline(bs, f2, l2);
        }
        if (bs->IsPeriodic()) bs->SetNotPeriodic();
        return emitBSplineCurve(E, bs, /*planar2d=*/true, yScale);
    } catch (const Standard_Failure&) {
        return 0;
    }
}

// ---------------------------------------------------------------- surfaces
struct FaceInfo {
    std::uint64_t surfId = 0;   // 0 => per-face facet fallback
    double yScale = 1.0;        // pcurve v pre-scale (cones: cos(semiangle))
    bool isPlane = false;       // reader ignores pcurves on planes — skip them
    Handle(Geom_Surface) surf;  // location-applied surface (for VERTEX_LOOP fallback)
};

// Emit the face's surface entity. Throws only std::runtime_error via wfail for
// truly broken topology; an UNSUPPORTED surface class returns 0 (per-face facet
// fallback — never whole-shape).
std::uint64_t emitSurface(Emit& E, const TopoDS_Face& face, FaceInfo& fi) {
    Handle(Geom_Surface) S = BRep_Tool::Surface(face);   // location applied
    if (S.IsNull()) return 0;
    for (int guard = 0; guard < 8; ++guard) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(S);
        if (rt.IsNull()) break;
        S = rt->BasisSurface();
    }
    fi.surf = S;

    auto directAx3 = [](const gp_Ax3& ax) { return ax.Direct(); };

    try {
        if (Handle(Geom_Plane) p = Handle(Geom_Plane)::DownCast(S); !p.IsNull()) {
            gp_Ax3 ax = p->Position();
            if (directAx3(ax)) {
                fi.isPlane = true;
                std::uint64_t a = E.axis2(ax.Location(), ax.Direction(), ax.XDirection());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=PLANE('',#"; E.data += std::to_string(a); E.data += ");\n";
                return i;
            }
        } else if (Handle(Geom_CylindricalSurface) cy =
                       Handle(Geom_CylindricalSurface)::DownCast(S); !cy.IsNull()) {
            gp_Ax3 ax = cy->Position();
            if (directAx3(ax)) {
                std::uint64_t a = E.axis2(ax.Location(), ax.Direction(), ax.XDirection());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=CYLINDRICAL_SURFACE('',#"; E.data += std::to_string(a);
                E.data += ','; E.data += stepFmt(cy->Radius()); E.data += ");\n";
                return i;
            }
        } else if (Handle(Geom_ConicalSurface) co =
                       Handle(Geom_ConicalSurface)::DownCast(S); !co.IsNull()) {
            gp_Ax3 ax = co->Position();
            if (directAx3(ax)) {
                std::uint64_t a = E.axis2(ax.Location(), ax.Direction(), ax.XDirection());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=CONICAL_SURFACE('',#"; E.data += std::to_string(a);
                E.data += ','; E.data += stepFmt(co->RefRadius());
                E.data += ','; E.data += stepFmt(co->SemiAngle()); E.data += ");\n";
                // ISO cone v runs along the AXIS; OCCT's along the GENERATOR:
                // v_iso = v_occt * cos(a). The reader multiplies by 1/cos(a).
                fi.yScale = std::cos(co->SemiAngle());
                return i;
            }
        } else if (Handle(Geom_SphericalSurface) sp =
                       Handle(Geom_SphericalSurface)::DownCast(S); !sp.IsNull()) {
            gp_Ax3 ax = sp->Position();
            if (directAx3(ax)) {
                std::uint64_t a = E.axis2(ax.Location(), ax.Direction(), ax.XDirection());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=SPHERICAL_SURFACE('',#"; E.data += std::to_string(a);
                E.data += ','; E.data += stepFmt(sp->Radius()); E.data += ");\n";
                return i;
            }
        } else if (Handle(Geom_ToroidalSurface) to =
                       Handle(Geom_ToroidalSurface)::DownCast(S); !to.IsNull()) {
            gp_Ax3 ax = to->Position();
            if (directAx3(ax)) {
                std::uint64_t a = E.axis2(ax.Location(), ax.Direction(), ax.XDirection());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=TOROIDAL_SURFACE('',#"; E.data += std::to_string(a);
                E.data += ','; E.data += stepFmt(to->MajorRadius());
                E.data += ','; E.data += stepFmt(to->MinorRadius()); E.data += ");\n";
                return i;
            }
        } else if (Handle(Geom_BSplineSurface) bs =
                       Handle(Geom_BSplineSurface)::DownCast(S); !bs.IsNull()) {
            return emitBSplineSurface(E, bs);
        } else if (Handle(Geom_BezierSurface) bz =
                       Handle(Geom_BezierSurface)::DownCast(S); !bz.IsNull()) {
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
            Handle(Geom_BSplineSurface) conv = forge::occtconv::surfaceToBSpline(bz);
#else
            Handle(Geom_BSplineSurface) conv = GeomConvert::SurfaceToBSplineSurface(bz);
#endif
            if (!conv.IsNull()) return emitBSplineSurface(E, conv);
        } else if (Handle(Geom_SurfaceOfLinearExtrusion) ex =
                       Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(S); !ex.IsNull()) {
            Handle(Geom_Curve) basis = ex->BasisCurve();
            double bf = basis->FirstParameter(), bl = basis->LastParameter();
            std::uint64_t cId = emitCurve3d(E, basis, bf, bl, /*segment=*/false);
            if (cId != 0) {
                // VECTOR magnitude 1.0 (unit sweep) => reader's pcurveVScale = 1,
                // and OCCT's unit-direction v matches ISO's vector-unit v exactly.
                std::uint64_t vId = E.vector3(ex->Direction(), 1.0);
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=SURFACE_OF_LINEAR_EXTRUSION('',#"; E.data += std::to_string(cId);
                E.data += ",#"; E.data += std::to_string(vId); E.data += ");\n";
                return i;
            }
        } else if (Handle(Geom_SurfaceOfRevolution) rv =
                       Handle(Geom_SurfaceOfRevolution)::DownCast(S); !rv.IsNull()) {
            Handle(Geom_Curve) basis = rv->BasisCurve();
            double bf = basis->FirstParameter(), bl = basis->LastParameter();
            std::uint64_t cId = emitCurve3d(E, basis, bf, bl, /*segment=*/false);
            if (cId != 0) {
                gp_Ax1 ax = rv->Axis();
                std::uint64_t aId = E.axis1(ax.Location(), ax.Direction());
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=SURFACE_OF_REVOLUTION('',#"; E.data += std::to_string(cId);
                E.data += ",#"; E.data += std::to_string(aId); E.data += ");\n";
                return i;
            }
        }
        // Unsupported class OR an indirect (left-handed) analytic frame the
        // reader's right-handed AXIS2 reconstruction would flip: convert the
        // face's UV window to a B-spline patch (exact for quadrics up to the
        // conversion tolerance of GeomConvert — a faithful approximation, not a
        // fake; failures fall to the per-face facet path).
        double u0, u1, v0, v1;
        BRepTools::UVBounds(face, u0, u1, v0, v1);
        if (u1 > u0 && v1 > v0) {
            Handle(Geom_RectangularTrimmedSurface) win =
                new Geom_RectangularTrimmedSurface(S, u0, u1, v0, v1);
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
            Handle(Geom_BSplineSurface) conv = forge::occtconv::surfaceToBSpline(win);
#else
            Handle(Geom_BSplineSurface) conv = GeomConvert::SurfaceToBSplineSurface(win);
#endif
            if (!conv.IsNull()) return emitBSplineSurface(E, conv);
        }
    } catch (const Standard_Failure&) {
        return 0;
    }
    return 0;
}

// ---------------------------------------------------- per-face facet fallback
// A face whose surface class cannot be serialised is faceted ALONE: its native
// triangulation becomes planar-triangle ADVANCED_FACEs (curve '*' EDGE_CURVEs
// — the reader's straight-chord form). The rest of the solid stays analytic.
void facetOneFace(Emit& E, const TopoDS_Face& face,
                  std::vector<std::uint64_t>& faceIdsOut) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    if (!forge::occtmesh::tessellateShapeToSoup(face, pos, idx, 0.05, 0.08) ||
        idx.empty()) {
        wfail("per-face facet fallback failed — the native mesher deferred on "
              "this face too (unwritable surface AND unmeshable)");
    }
    // shared vertex/edge tables so neighbouring triangles reuse topology.
    std::vector<std::uint64_t> vp(pos.size() / 3, 0);
    auto vertexOf = [&](std::uint32_t v) -> std::uint64_t {
        if (vp[v] == 0) {
            std::uint64_t pId = E.point3(gp_Pnt(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]));
            std::uint64_t i = E.alloc();
            E.id(i);
            E.data += "=VERTEX_POINT('',#"; E.data += std::to_string(pId); E.data += ");\n";
            vp[v] = i;
        }
        return vp[v];
    };
    std::map<std::pair<std::uint32_t, std::uint32_t>, std::uint64_t> ec;
    auto edgeOf = [&](std::uint32_t a, std::uint32_t b, bool& fwd) -> std::uint64_t {
        const auto key = a < b ? std::make_pair(a, b) : std::make_pair(b, a);
        fwd = (a < b);
        auto it = ec.find(key);
        if (it != ec.end()) return it->second;
        std::uint64_t vA = vertexOf(key.first), vB = vertexOf(key.second);
        std::uint64_t i = E.alloc();
        E.id(i);
        E.data += "=EDGE_CURVE('',#"; E.data += std::to_string(vA);
        E.data += ",#"; E.data += std::to_string(vB); E.data += ",*,.T.);\n";
        ec.emplace(key, i);
        return i;
    };
    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        const std::uint32_t a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const gp_Pnt pa(pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]);
        const gp_Pnt pb(pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]);
        const gp_Pnt pc(pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]);
        const gp_XYZ n = (pb.XYZ() - pa.XYZ()).Crossed(pc.XYZ() - pa.XYZ());
        if (n.Modulus() < 1e-14) continue;
        const gp_XYZ x = pb.XYZ() - pa.XYZ();
        if (x.Modulus() < 1e-14) continue;
        std::uint64_t ax = E.axis2(pa, gp_Dir(n), gp_Dir(x));
        std::uint64_t plId = E.alloc();
        E.id(plId);
        E.data += "=PLANE('',#"; E.data += std::to_string(ax); E.data += ");\n";
        std::uint64_t oe[3];
        const std::uint32_t tri[3] = {a, b, c};
        for (int k = 0; k < 3; ++k) {
            bool fwd = true;
            std::uint64_t e = edgeOf(tri[k], tri[(k + 1) % 3], fwd);
            std::uint64_t i = E.alloc();
            E.id(i);
            E.data += "=ORIENTED_EDGE('',*,*,#"; E.data += std::to_string(e);
            E.data += fwd ? ",.T.);\n" : ",.F.);\n";
            oe[k] = i;
        }
        std::uint64_t loop = E.alloc();
        E.id(loop);
        E.data += "=EDGE_LOOP('',(#"; E.data += std::to_string(oe[0]);
        E.data += ",#"; E.data += std::to_string(oe[1]);
        E.data += ",#"; E.data += std::to_string(oe[2]); E.data += "));\n";
        std::uint64_t bound = E.alloc();
        E.id(bound);
        E.data += "=FACE_OUTER_BOUND('',#"; E.data += std::to_string(loop); E.data += ",.T.);\n";
        std::uint64_t f = E.alloc();
        E.id(f);
        E.data += "=ADVANCED_FACE('',(#"; E.data += std::to_string(bound);
        E.data += "),#"; E.data += std::to_string(plId); E.data += ",.T.);\n";
        faceIdsOut.push_back(f);
    }
    if (faceIdsOut.empty()) wfail("per-face facet fallback produced no triangles");
}

}  // anonymous namespace

// ===========================================================================
// StepWriteOcct::write
// ===========================================================================
OcctStepWriteResult StepWriteOcct::write(const TopoDS_Shape& shape,
                                         const std::string& name) {
    OcctStepWriteResult res;
    if (shape.IsNull()) {
        res.reason = "null shape";
        return res;
    }
    try {
        Emit E;

        // shared 2D parametric context for every DEFINITIONAL_REPRESENTATION
        // (the reader ignores it; the record just has to be referenceable).
        const std::uint64_t ctx2d = E.alloc();
        E.id(ctx2d);
        E.data += "=(GEOMETRIC_REPRESENTATION_CONTEXT(2)"
                  "PARAMETRIC_REPRESENTATION_CONTEXT()"
                  "REPRESENTATION_CONTEXT('2D','parameter space'));\n";

        // ---- pass 1: surfaces (per unique face) ---------------------------
        TopTools_IndexedMapOfShape faceMap;
        TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
        if (faceMap.Extent() == 0) {
            res.reason = "shape has no faces";
            return res;
        }
        res.totalFaces = faceMap.Extent();
        std::vector<FaceInfo> finfo(faceMap.Extent() + 1);
        for (int i = 1; i <= faceMap.Extent(); ++i) {
            const TopoDS_Face face = TopoDS::Face(faceMap(i));
            finfo[i].surfId = emitSurface(E, face, finfo[i]);
            if (finfo[i].surfId == 0) ++res.facetedFaces;
        }

        // ---- pass 2: shared edges (EDGE_CURVE, + SURFACE_CURVE pcurves) ---
        TopTools_IndexedMapOfShape edgeMap, vertMap;
        TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
        TopExp::MapShapes(shape, TopAbs_VERTEX, vertMap);
        TopTools_IndexedDataMapOfShapeListOfShape e2f;
        TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, e2f);

        // How many times each edge OCCURS in each face's loops (the SAME wire
        // traversal pass 3 emits). The reader pairs a face's pcurves against the
        // edge's ORIENTED_EDGE occurrence count (1 -> one pcurve, 2 -> the seam
        // dual) and honestly REJECTS a mismatch ("ambiguous pcurve pairing") on
        // a closed surface — so the written pcurve count must MATCH the loop
        // occurrence count, not BRep_Tool::IsClosed's seam guess (fixture 224:
        // an IsClosed edge whose second use WireExplorer never emits).
        std::map<std::pair<int, int>, int> occCount;   // (faceIdx, edgeIdx) -> n
        for (int i = 1; i <= faceMap.Extent(); ++i) {
            const TopoDS_Face face = TopoDS::Face(faceMap(i));
            for (TopExp_Explorer wx(face, TopAbs_WIRE); wx.More(); wx.Next()) {
                const TopoDS_Wire wire = TopoDS::Wire(wx.Current());
                for (BRepTools_WireExplorer we(wire, face); we.More(); we.Next()) {
                    const TopoDS_Edge& e = we.Current();
                    if (e.Orientation() != TopAbs_FORWARD &&
                        e.Orientation() != TopAbs_REVERSED)
                        continue;
                    const int eIdx = edgeMap.FindIndex(e);
                    if (eIdx > 0) occCount[{i, eIdx}]++;
                }
            }
        }

        std::vector<std::uint64_t> vertId(vertMap.Extent() + 1, 0);
        auto vertexEntity = [&](const TopoDS_Vertex& v) -> std::uint64_t {
            const int vi = vertMap.FindIndex(v);
            if (vi <= 0) wfail("vertex not in map");
            if (vertId[vi] == 0) {
                std::uint64_t pId = E.point3(BRep_Tool::Pnt(v));
                std::uint64_t i = E.alloc();
                E.id(i);
                E.data += "=VERTEX_POINT('',#"; E.data += std::to_string(pId);
                E.data += ");\n";
                vertId[vi] = i;
            }
            return vertId[vi];
        };

        std::vector<std::uint64_t> ecId(edgeMap.Extent() + 1, 0);
        for (int ei = 1; ei <= edgeMap.Extent(); ++ei) {
            const TopoDS_Edge eFwd =
                TopoDS::Edge(edgeMap(ei).Oriented(TopAbs_FORWARD));
            if (BRep_Tool::Degenerated(eFwd)) continue;   // no 3D curve — skipped
            double f = 0, l = 0;
            Handle(Geom_Curve) c3 = BRep_Tool::Curve(eFwd, f, l);
            if (c3.IsNull()) continue;                    // collapsed edge — skipped
            std::uint64_t curveId = emitCurve3d(E, c3, f, l, /*segment=*/true);
            if (curveId == 0) {
                // an edge is SHARED topology — faking it would corrupt both
                // adjacent faces. Honest whole-write failure; the caller keeps
                // its faceted fallback.
                wfail(std::string("unsupported 3D edge curve '") +
                      (c3->DynamicType() ? c3->DynamicType()->Name() : "?") + "'");
            }

            // pcurves for every adjacent NON-PLANE analytic face (the reader
            // ignores plane pcurves; facet-fallback faces have no surface id).
            std::vector<std::uint64_t> pcIds;
            if (e2f.Contains(eFwd)) {
                const TopTools_ListOfShape& faces = e2f.FindFromKey(eFwd);
                std::vector<int> seen;
                for (TopTools_ListOfShape::Iterator it(faces); it.More(); it.Next()) {
                    const TopoDS_Face face = TopoDS::Face(it.Value());
                    const int fidx = faceMap.FindIndex(face);
                    if (fidx <= 0) continue;
                    if (std::find(seen.begin(), seen.end(), fidx) != seen.end()) continue;
                    seen.push_back(fidx);
                    const FaceInfo& fi = finfo[fidx];
                    if (fi.surfId == 0 || fi.isPlane) continue;
                    // Pair against the ACTUAL loop occurrence count (what pass 3
                    // emits): 1 -> one pcurve, 2 -> the seam dual, else none.
                    auto oc = occCount.find({fidx, ei});
                    const int nOcc = (oc == occCount.end()) ? 0 : oc->second;
                    if (nOcc != 1 && nOcc != 2) continue;
                    const bool seam = (nOcc == 2);
                    auto onePcurve = [&](const TopoDS_Edge& eo) -> std::uint64_t {
                        double f2 = 0, l2 = 0;
                        Handle(Geom2d_Curve) c2;
                        try { c2 = BRep_Tool::CurveOnSurface(eo, face, f2, l2); }
                        catch (const Standard_Failure&) { return 0; }
                        if (c2.IsNull()) return 0;
                        // LOCUS VALIDATION before writing: map the pcurve's two
                        // range ends through THIS face's surface and require them
                        // to land on the edge's 3D endpoints (either order,
                        // 0.5mm — stricter than the reader's own gate). A stored
                        // representation that does not map onto its edge (seen
                        // in the wild: fixture 224, ~2-4mm off) is OMITTED — the
                        // reader then heals by projection instead of hard-
                        // failing on a wrong file pcurve. Never ship a pcurve
                        // the roundtrip would disprove.
                        try {
#if defined(FORGE_NATIVE_NURBS_CONVERT) && defined(FORGE_NATIVE_BREP)
                            Handle(Geom_Curve) probe =
                                forge::occtconv::to3d(c2, gp_Pln(gp_Ax3(gp::XOY())));   // R3 native
#else
                            Handle(Geom_Curve) probe =
                                GeomAPI::To3d(c2, gp_Pln(gp_Ax3(gp::XOY())));
#endif
                            if (probe.IsNull()) return 0;
                            gp_Pnt q0 = probe->Value(f2), q1 = probe->Value(l2);
                            gp_Pnt s0 = fi.surf->Value(q0.X(), q0.Y());
                            gp_Pnt s1 = fi.surf->Value(q1.X(), q1.Y());
                            gp_Pnt p0 = c3->Value(f), p1 = c3->Value(l);
                            const double tol = 0.5;
                            const bool okAB = s0.Distance(p0) <= tol &&
                                              s1.Distance(p1) <= tol;
                            const bool okBA = s0.Distance(p1) <= tol &&
                                              s1.Distance(p0) <= tol;
                            if (!okAB && !okBA) return 0;
                        } catch (const Standard_Failure&) {
                            return 0;
                        }
                        return emitPcurve2d(E, c2, f2, l2, fi.yScale);
                    };
                    auto wrapPcurve = [&](std::uint64_t c2dId) {
                        if (c2dId == 0) return;
                        std::uint64_t dr = E.alloc();
                        E.id(dr);
                        E.data += "=DEFINITIONAL_REPRESENTATION('',(#";
                        E.data += std::to_string(c2dId); E.data += "),#";
                        E.data += std::to_string(ctx2d); E.data += ");\n";
                        std::uint64_t pc = E.alloc();
                        E.id(pc);
                        E.data += "=PCURVE('',#"; E.data += std::to_string(fi.surfId);
                        E.data += ",#"; E.data += std::to_string(dr); E.data += ");\n";
                        pcIds.push_back(pc);
                    };
                    if (seam) {
                        // seam edge bounds this face twice: BOTH pcurve branches
                        // (forward + reversed use), the reader's n==2 attach. If
                        // either branch is unwritable, write NEITHER — a lone
                        // seam pcurve would be an "ambiguous pairing".
                        std::uint64_t a = onePcurve(eFwd);
                        std::uint64_t b = onePcurve(
                            TopoDS::Edge(eFwd.Oriented(TopAbs_REVERSED)));
                        if (a != 0 && b != 0) { wrapPcurve(a); wrapPcurve(b); }
                    } else {
                        wrapPcurve(onePcurve(eFwd));
                    }
                }
            }
            std::uint64_t geomId = curveId;
            if (!pcIds.empty()) {
                std::uint64_t sc = E.alloc();
                E.id(sc);
                E.data += "=SURFACE_CURVE('',#"; E.data += std::to_string(curveId);
                E.data += ",(";
                for (std::size_t k = 0; k < pcIds.size(); ++k) {
                    if (k) E.data += ',';
                    E.data += '#'; E.data += std::to_string(pcIds[k]);
                }
                E.data += "),.PCURVE_S1.);\n";
                geomId = sc;
            }

            TopoDS_Vertex vS = TopExp::FirstVertex(eFwd, Standard_True);
            TopoDS_Vertex vE = TopExp::LastVertex(eFwd, Standard_True);
            if (vS.IsNull() || vE.IsNull()) wfail("edge without vertices");
            std::uint64_t vSId = vertexEntity(vS);
            std::uint64_t vEId = vertexEntity(vE);
            std::uint64_t id = E.alloc();
            E.id(id);
            E.data += "=EDGE_CURVE('',#"; E.data += std::to_string(vSId);
            E.data += ",#"; E.data += std::to_string(vEId);
            E.data += ",#"; E.data += std::to_string(geomId); E.data += ",.T.);\n";
            ecId[ei] = id;
        }

        // ---- pass 3: faces (loops from composed-orientation traversal) ----
        // The composed wire traversal (TopExp_Explorer + BRepTools_WireExplorer)
        // yields loops CCW w.r.t. the FACE normal — the STEP convention the
        // reader inverts for same_sense=.F. faces.
        auto emitFace = [&](const TopoDS_Face& face,
                            std::vector<std::uint64_t>& out) {
            const int fidx = faceMap.FindIndex(face);
            if (fidx <= 0) wfail("face not in map");
            const FaceInfo& fi = finfo[fidx];
            if (fi.surfId == 0) {           // per-face facet fallback
                facetOneFace(E, face, out);
                return;
            }
            const bool sameSense = (face.Orientation() != TopAbs_REVERSED);
            const TopoDS_Wire outer = BRepTools::OuterWire(face);
            std::vector<std::uint64_t> bounds;
            for (TopExp_Explorer wx(face, TopAbs_WIRE); wx.More(); wx.Next()) {
                const TopoDS_Wire wire = TopoDS::Wire(wx.Current());
                std::vector<std::uint64_t> oes;
                for (BRepTools_WireExplorer we(wire, face); we.More(); we.Next()) {
                    const TopoDS_Edge& e = we.Current();
                    if (e.Orientation() != TopAbs_FORWARD &&
                        e.Orientation() != TopAbs_REVERSED)
                        continue;   // INTERNAL/EXTERNAL construction edge
                    const int eIdx = edgeMap.FindIndex(e);
                    if (eIdx <= 0 || ecId[eIdx] == 0) continue;   // degenerate — skipped
                    std::uint64_t oe = E.alloc();
                    E.id(oe);
                    E.data += "=ORIENTED_EDGE('',*,*,#";
                    E.data += std::to_string(ecId[eIdx]);
                    E.data += (e.Orientation() == TopAbs_FORWARD) ? ",.T.);\n"
                                                                  : ",.F.);\n";
                    oes.push_back(oe);
                }
                if (oes.empty()) continue;   // pole-only / degenerate ring
                std::uint64_t loop = E.alloc();
                E.id(loop);
                E.data += "=EDGE_LOOP('',(";
                for (std::size_t k = 0; k < oes.size(); ++k) {
                    if (k) E.data += ',';
                    E.data += '#'; E.data += std::to_string(oes[k]);
                }
                E.data += "));\n";
                std::uint64_t bnd = E.alloc();
                E.id(bnd);
                const bool isOuter = !outer.IsNull() && wire.IsSame(outer);
                E.data += isOuter ? "=FACE_OUTER_BOUND('',#" : "=FACE_BOUND('',#";
                E.data += std::to_string(loop); E.data += ",.T.);\n";
                bounds.push_back(bnd);
            }
            if (bounds.empty()) {
                // whole-surface face (closed sphere/torus with degenerate-only
                // bounds): a DEGENERATE VERTEX_LOOP -> reader builds the face
                // over the surface's natural parametric bounds.
                double u0, u1, v0, v1;
                BRepTools::UVBounds(face, u0, u1, v0, v1);
                gp_Pnt pole = fi.surf->Value(u0, v0);
                std::uint64_t pId = E.point3(pole);
                std::uint64_t vp = E.alloc();
                E.id(vp);
                E.data += "=VERTEX_POINT('',#"; E.data += std::to_string(pId);
                E.data += ");\n";
                std::uint64_t vl = E.alloc();
                E.id(vl);
                E.data += "=VERTEX_LOOP('',#"; E.data += std::to_string(vp);
                E.data += ");\n";
                std::uint64_t bnd = E.alloc();
                E.id(bnd);
                E.data += "=FACE_BOUND('',#"; E.data += std::to_string(vl);
                E.data += ",.T.);\n";
                bounds.push_back(bnd);
            }
            std::uint64_t f = E.alloc();
            E.id(f);
            E.data += "=ADVANCED_FACE('',(";
            for (std::size_t k = 0; k < bounds.size(); ++k) {
                if (k) E.data += ',';
                E.data += '#'; E.data += std::to_string(bounds[k]);
            }
            E.data += "),#";
            E.data += std::to_string(fi.surfId);
            E.data += sameSense ? ",.T.);\n" : ",.F.);\n";
            out.push_back(f);
        };

        std::vector<std::vector<std::uint64_t>> shells;
        for (TopExp_Explorer sx(shape, TopAbs_SHELL); sx.More(); sx.Next()) {
            std::vector<std::uint64_t> ids;
            for (TopExp_Explorer fx(sx.Current(), TopAbs_FACE); fx.More(); fx.Next())
                emitFace(TopoDS::Face(fx.Current()), ids);
            if (!ids.empty()) shells.push_back(std::move(ids));
        }
        {   // faces not contained in any shell → one extra shell
            std::vector<std::uint64_t> ids;
            for (TopExp_Explorer fx(shape, TopAbs_FACE, TopAbs_SHELL); fx.More(); fx.Next())
                emitFace(TopoDS::Face(fx.Current()), ids);
            if (!ids.empty()) shells.push_back(std::move(ids));
        }
        if (shells.empty()) wfail("no emittable faces");

        std::vector<std::uint64_t> msbIds;
        for (const auto& ids : shells) {
            std::uint64_t sh = E.alloc();
            E.id(sh);
            E.data += "=CLOSED_SHELL('',(";
            for (std::size_t k = 0; k < ids.size(); ++k) {
                if (k) E.data += ',';
                E.data += '#'; E.data += std::to_string(ids[k]);
            }
            E.data += "));\n";
            std::uint64_t msb = E.alloc();
            E.id(msb);
            E.data += "=MANIFOLD_SOLID_BREP('forge_solid',#";
            E.data += std::to_string(sh); E.data += ");\n";
            msbIds.push_back(msb);
        }

        // ---- minimal AP242 product/unit wrapper (mirrors StepAnalytic) ----
        std::uint64_t appCtx = E.alloc();
        E.id(appCtx);
        E.data += "=APPLICATION_CONTEXT('core data for automotive mechanical "
                  "design processes');\n";
        std::uint64_t appProto = E.alloc();
        E.id(appProto);
        E.data += "=APPLICATION_PROTOCOL_DEFINITION('international standard',"
                  "'automotive_design',2010,#"; E.data += std::to_string(appCtx);
        E.data += ");\n";
        std::uint64_t prodDefCtx = E.alloc();
        E.id(prodDefCtx);
        E.data += "=PRODUCT_DEFINITION_CONTEXT('part definition',#";
        E.data += std::to_string(appCtx); E.data += ",'design');\n";
        std::uint64_t prodCtx = E.alloc();
        E.id(prodCtx);
        E.data += "=PRODUCT_CONTEXT('',#"; E.data += std::to_string(appCtx);
        E.data += ",'mechanical');\n";
        std::uint64_t prod = E.alloc();
        E.id(prod);
        E.data += "=PRODUCT('forge_part','forge_part','',(#";
        E.data += std::to_string(prodCtx); E.data += "));\n";
        std::uint64_t pdf = E.alloc();
        E.id(pdf);
        E.data += "=PRODUCT_DEFINITION_FORMATION('','',#";
        E.data += std::to_string(prod); E.data += ");\n";
        std::uint64_t pd = E.alloc();
        E.id(pd);
        E.data += "=PRODUCT_DEFINITION('design','',#";
        E.data += std::to_string(pdf); E.data += ",#";
        E.data += std::to_string(prodDefCtx); E.data += ");\n";
        std::uint64_t pds = E.alloc();
        E.id(pds);
        E.data += "=PRODUCT_DEFINITION_SHAPE('','',#";
        E.data += std::to_string(pd); E.data += ");\n";
        std::uint64_t lenUnit = E.alloc();
        E.id(lenUnit);
        E.data += "=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n";
        std::uint64_t angUnit = E.alloc();
        E.id(angUnit);
        E.data += "=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n";
        std::uint64_t solUnit = E.alloc();
        E.id(solUnit);
        E.data += "=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());\n";
        std::uint64_t uncert = E.alloc();
        E.id(uncert);
        E.data += "=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#";
        E.data += std::to_string(lenUnit);
        E.data += ",'distance_accuracy_value','confusion accuracy');\n";
        std::uint64_t geoCtx = E.alloc();
        E.id(geoCtx);
        E.data += "=(GEOMETRIC_REPRESENTATION_CONTEXT(3)"
                  "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#";
        E.data += std::to_string(uncert);
        E.data += "))GLOBAL_UNIT_ASSIGNED_CONTEXT((#";
        E.data += std::to_string(lenUnit); E.data += ",#";
        E.data += std::to_string(angUnit); E.data += ",#";
        E.data += std::to_string(solUnit);
        E.data += "))REPRESENTATION_CONTEXT('Context','3D'));\n";
        std::uint64_t absr = E.alloc();
        E.id(absr);
        E.data += "=ADVANCED_BREP_SHAPE_REPRESENTATION('',(";
        for (std::size_t k = 0; k < msbIds.size(); ++k) {
            if (k) E.data += ',';
            E.data += '#'; E.data += std::to_string(msbIds[k]);
        }
        E.data += "),#";
        E.data += std::to_string(geoCtx); E.data += ");\n";
        std::uint64_t sdr = E.alloc();
        E.id(sdr);
        E.data += "=SHAPE_DEFINITION_REPRESENTATION(#";
        E.data += std::to_string(pds); E.data += ",#";
        E.data += std::to_string(absr); E.data += ");\n";
        (void)appProto; (void)sdr;

        // ---- envelope ----
        std::string out;
        out.reserve(E.data.size() + 768);
        out += "ISO-10303-21;\n";
        out += "HEADER;\n";
        out += "FILE_DESCRIPTION(('forge OCCT-handle analytic B-rep solid "
               "(AP242, analytic + B-spline surfaces)'),'2;1');\n";
        out += "FILE_NAME('";
        for (char ch : name) { if (ch == '\'') out += "''"; else out += ch; }
        out += "','2026-01-01T00:00:00',(''),(''),"
               "'forge::native::brep::StepWriteOcct','forge','');\n";
        out += "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF "
               "{ 1 0 10303 442 1 1 4 }'));\n";
        out += "ENDSEC;\n";
        out += "DATA;\n";
        out += E.data;
        out += "ENDSEC;\n";
        out += "END-ISO-10303-21;\n";

        res.ok = true;
        res.text = std::move(out);
        return res;
    } catch (const Standard_Failure& e) {
        const char* m = e.GetMessageString();
        res.ok = false;
        res.reason = std::string("OCCT: ") + (m && *m ? m : "Standard_Failure");
        res.text.clear();
        return res;
    } catch (const std::exception& e) {
        res.ok = false;
        res.reason = e.what();
        res.text.clear();
        return res;
    }
}

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP
