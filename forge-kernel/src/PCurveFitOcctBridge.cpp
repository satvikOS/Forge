// src/PCurveFitOcctBridge.cpp — the OCCT face of the native pcurve fit.
//
// Read include/forge/PCurveFitOcctBridge.hpp first: it says what this layer is
// for and why it exists as a separate file (T-154).
//
// ★ THE RULE THIS FILE IS HELD TO: no geometry is computed here. Every function
//   converts, calls `forge::pcurvefit::`, and converts back. The two places
//   where a conversion is subtler than it looks are marked ★ below; everything
//   else is a field copy.

#ifdef FORGE_NATIVE_BREP

#include "forge/PCurveFitOcctBridge.hpp"

#include <cmath>

#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Ellipse.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <Standard_Failure.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax22d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt2d.hxx>

namespace forge {
namespace pcurvefit {
namespace occt {

namespace nat = forge::pcurvefit;
using forge::math::Vec3;

// ---------------------------------------------------------------------------
// 0. CONVERSIONS
// ---------------------------------------------------------------------------

Vec3 toNative(const gp_Dir& d) { return Vec3(d.X(), d.Y(), d.Z()); }
Vec3 toNative(const gp_Pnt& p) { return Vec3(p.X(), p.Y(), p.Z()); }

// ★ gp_Ax3 MAY BE LEFT-HANDED. Its YDirection() is `Direction() ^ XDirection()`
//   for a direct frame and the NEGATIVE of that for an indirect one. Deriving y
//   as dir x xdir here would mirror the u parameterisation of every indirect
//   cylinder and produce a pcurve that is wrong but perfectly well-formed — the
//   exact shape of defect this engine refuses to emit. So YDirection() is
//   carried across, not recomputed.
nat::Ax3 toNative(const gp_Ax3& ax) {
    nat::Ax3 out;
    out.loc  = toNative(ax.Location());
    out.dir  = toNative(ax.Direction());
    out.xdir = toNative(ax.XDirection());
    out.ydir = toNative(ax.YDirection());
    return out;
}

Handle(Geom_Curve) toOcct(const nat::Conic3& c) {
    if (!c.valid) return Handle(Geom_Curve)();
    try {
        // gp_Ax2(P, N, Vx) sets XDirection = Vx orthogonalised against N and
        // YDirection = N ^ XDirection. With xdir and ydir already orthonormal
        // and N = xdir x ydir, that reproduces the frame exactly.
        const Vec3 N = c.xdir.cross(c.ydir);
        const gp_Ax2 ax(gp_Pnt(c.centre.x, c.centre.y, c.centre.z),
                        gp_Dir(N.x, N.y, N.z),
                        gp_Dir(c.xdir.x, c.xdir.y, c.xdir.z));
        if (c.circle) return new Geom_Circle(ax, c.a);
        return new Geom_Ellipse(ax, c.a, c.b);
    } catch (const Standard_Failure&) {
        return Handle(Geom_Curve)();
    }
}

Handle(Geom2d_BSplineCurve) toOcct(const nat::BSpline2d& c) {
    if (!c.valid()) return Handle(Geom2d_BSplineCurve)();
    const int np = static_cast<int>(c.poles.size());
    TColgp_Array1OfPnt2d P(1, np);
    for (int i = 0; i < np; ++i)
        P.SetValue(i + 1, gp_Pnt2d(c.poles[static_cast<std::size_t>(i)].x,
                                   c.poles[static_cast<std::size_t>(i)].y));
    TColStd_Array1OfReal    K(1, static_cast<int>(c.knots.size()));
    TColStd_Array1OfInteger M(1, static_cast<int>(c.mults.size()));
    for (int i = 0; i < static_cast<int>(c.knots.size()); ++i)
        K.SetValue(i + 1, c.knots[static_cast<std::size_t>(i)]);
    for (int i = 0; i < static_cast<int>(c.mults.size()); ++i)
        M.SetValue(i + 1, c.mults[static_cast<std::size_t>(i)]);
    try {
        return new Geom2d_BSplineCurve(P, K, M, c.degree, Standard_False);
    } catch (const Standard_Failure&) {
        return Handle(Geom2d_BSplineCurve)();
    }
}

Handle(Geom2d_Curve) toOcct(const nat::PCurve2d& c) {
    if (!c.valid) return Handle(Geom2d_Curve)();
    if (!c.line) return toOcct(c.spline);

    // ★ A unit-direction Geom2d_Line CANNOT carry a non-unit affine map at the
    //   edge's own parameter — it would silently reparameterise the pcurve. A
    //   degree-1 two-pole B-spline can, and it is just as exact. This is the one
    //   place the OCCT representation depends on a NUMBER rather than a kind,
    //   and it is the original code's rule, unchanged.
    const double nrm = std::sqrt(c.dir.x * c.dir.x + c.dir.y * c.dir.y);
    if (!(nrm > 0.0)) return Handle(Geom2d_Curve)();
    try {
        if (std::fabs(nrm - 1.0) <= 1e-12)
            return new Geom2d_Line(gp_Pnt2d(c.origin.x, c.origin.y),
                                   gp_Dir2d(c.dir.x, c.dir.y));
    } catch (const Standard_Failure&) {
        return Handle(Geom2d_Curve)();
    }
    nat::BSpline2d seg;
    seg.degree = 1;
    seg.poles  = { nat::Pnt2d{ c.origin.x + c.dir.x * c.tFirst,
                               c.origin.y + c.dir.y * c.tFirst },
                   nat::Pnt2d{ c.origin.x + c.dir.x * c.tLast,
                               c.origin.y + c.dir.y * c.tLast } };
    seg.knots  = { c.tFirst, c.tLast };
    seg.mults  = { 2, 2 };
    return toOcct(seg);
}

namespace {

std::vector<nat::Pnt2d> toNativePts(const TColgp_Array1OfPnt2d& Q) {
    std::vector<nat::Pnt2d> out;
    out.reserve(static_cast<std::size_t>(Q.Length()));
    for (Standard_Integer i = Q.Lower(); i <= Q.Upper(); ++i)
        out.push_back(nat::Pnt2d{ Q.Value(i).X(), Q.Value(i).Y() });
    return out;
}

bool conicFromOcct(const Handle(Geom_Curve)& c3, nat::Conic3& out) {
    if (c3.IsNull()) return false;
    if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(c3); !el.IsNull()) {
        const gp_Ax2 ax = el->Position();
        out.valid  = true;
        out.circle = false;
        out.centre = toNative(ax.Location());
        out.xdir   = toNative(ax.XDirection());
        out.ydir   = toNative(ax.YDirection());
        out.a      = el->MajorRadius();
        out.b      = el->MinorRadius();
        return true;
    }
    if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(c3); !ci.IsNull()) {
        const gp_Ax2 ax = ci->Position();
        out.valid  = true;
        out.circle = true;
        out.centre = toNative(ax.Location());
        out.xdir   = toNative(ax.XDirection());
        out.ydir   = toNative(ax.YDirection());
        out.a      = ci->Radius();
        out.b      = ci->Radius();
        return true;
    }
    return false;
}

}  // namespace

// ---------------------------------------------------------------------------
// 1. THE FITTER
// ---------------------------------------------------------------------------

Handle(Geom2d_BSplineCurve) pointsToBSpline2d(const TColgp_Array1OfPnt2d& Q,
                                              const std::vector<double>& params,
                                              int degMin, int degMax, double tol) {
    return toOcct(nat::pointsToBSpline2d(toNativePts(Q), params, degMin, degMax, tol));
}

Handle(Geom2d_BSplineCurve) fitBSpline2dAt(const TColgp_Array1OfPnt2d& Q,
                                           const std::vector<double>& params,
                                           int degree, int nCtrl, double& maxResidual) {
    return toOcct(nat::fitBSpline2dAt(toNativePts(Q), params, degree, nCtrl, maxResidual));
}

// ---------------------------------------------------------------------------
// 2. THE SECTION
// ---------------------------------------------------------------------------

PlaneCylSection planeCylinderSection(const gp_Dir& n, double d,
                                     const gp_Ax3& cylAx, double radius, double tol) {
    PlaneCylSection out;
    out.native  = nat::planeCylinderSection(toNative(n), d, toNative(cylAx), radius, tol);
    out.kind    = out.native.kind;
    out.cosAxis = out.native.cosAxis;
    out.defer   = out.native.defer;
    if (out.native.curve.valid) {
        out.curve = toOcct(out.native.curve);
        // A section the native engine produced but OCCT refused to carry is a
        // defer with a NAME, not a silent null: the caller prints `defer` and an
        // empty string there would report nothing at all.
        if (out.curve.IsNull() && out.defer.empty())
            out.defer = "the exact section could not be represented as an OCCT conic";
    }
    return out;
}

double sectionResidual(const PlaneCylSection& sec, const gp_Dir& n, double d,
                       const gp_Ax3& cylAx, double radius, int nSamples) {
    return nat::sectionResidual(sec.native, toNative(n), d, toNative(cylAx), radius, nSamples);
}

// ---------------------------------------------------------------------------
// 3. THE PCURVE
// ---------------------------------------------------------------------------

PCurveFit cylinderPCurve(const Handle(Geom_Curve)& c3, double t0, double t1,
                         const gp_Ax3& cylAx, double radius,
                         double tol3d, double uNear) {
    // A null handle is passed through as an EMPTY evaluator so the native engine
    // emits its own "no 3-D curve" defer. Answering here would be a second copy
    // of a guard that already exists.
    nat::Curve3dEval eval;
    if (!c3.IsNull()) {
        eval = [&c3](double t, Vec3& p) -> bool {
            try {
                const gp_Pnt P = c3->Value(t);
                p = Vec3(P.X(), P.Y(), P.Z());
                return true;
            } catch (const Standard_Failure&) {
                return false;
            }
        };
    }

    const nat::PCurveFit R = nat::cylinderPCurve(eval, t0, t1, toNative(cylAx),
                                                 radius, tol3d, uNear);
    PCurveFit out;
    out.exact    = R.exact;
    out.maxDev3d = R.maxDev3d;
    out.maxDevU  = R.maxDevU;
    out.degree   = R.degree;
    out.nPoles   = R.nPoles;
    out.nSpans   = R.nSpans;
    out.nAudit   = R.nAudit;
    out.defer    = R.defer;
    if (R.curve.valid) {
        out.curve = toOcct(R.curve);
        if (out.curve.IsNull() && out.defer.empty())
            out.defer = "the fitted pcurve could not be represented as an OCCT 2-D curve";
    }
    return out;
}

Handle(Geom2d_Curve) planePCurve(const Handle(Geom_Curve)& c3, const gp_Pnt& O,
                                 const gp_Dir& px, const gp_Dir& py) {
    nat::Conic3 conic;
    if (!conicFromOcct(c3, conic)) return Handle(Geom2d_Curve)();
    const nat::Conic2 c2 = nat::planePCurve(conic, toNative(O), toNative(px), toNative(py));
    if (!c2.valid) return Handle(Geom2d_Curve)();
    try {
        const gp_Ax22d ax(gp_Pnt2d(c2.centre.x, c2.centre.y),
                          gp_Dir2d(c2.xdir.x, c2.xdir.y),
                          gp_Dir2d(c2.ydir.x, c2.ydir.y));
        if (c2.circle) return new Geom2d_Circle(ax, c2.a);
        return new Geom2d_Ellipse(ax, c2.a, c2.b);
    } catch (const Standard_Failure&) {
        return Handle(Geom2d_Curve)();
    }
}

}  // namespace occt
}  // namespace pcurvefit
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
