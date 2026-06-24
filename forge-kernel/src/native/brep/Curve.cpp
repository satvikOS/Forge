// forge/native/brep/Curve.cpp
//
// Implementation of the tagged 3D Curve and 2D PCurve evaluators (Curve.hpp).
// Pure C++20, no external dependencies. See header for honesty / scope.

#include "forge/native/brep/Curve.hpp"

#include <cmath>

namespace forge {
namespace native {
namespace brep {

// Local 3-vector helpers (kept private to this TU so Curve.hpp does not need to
// pull Surface.hpp's vadd/vsub/etc.; identical algebra on the shared Vec3 POD).
namespace {
inline Vec3 cAdd(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 cSub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 cScale(const Vec3& a, double s)    { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 cCross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double cLen(const Vec3& a) { return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
inline Vec3 cNorm(const Vec3& a) {
    double L = cLen(a);
    if (L <= 0.0) return {0, 0, 0};
    return {a.x / L, a.y / L, a.z / L};
}
} // namespace

// ===========================================================================
// Curve (3D)
// ===========================================================================
Vec3 Curve::binormal() const { return cCross(normal, refDir); }

Vec3 Curve::evaluate(double t) const {
    switch (kind) {
    case GeomCurveKind::Line:
        // C(t) = origin + t*dir.
        return cAdd(origin, cScale(dir, t));
    case GeomCurveKind::Circle: {
        const Vec3 bn = binormal();
        const double c = std::cos(t), s = std::sin(t);
        return cAdd(origin,
                    cAdd(cScale(refDir, r * c), cScale(bn, r * s)));
    }
    case GeomCurveKind::Ellipse: {
        const Vec3 bn = binormal();
        const double c = std::cos(t), s = std::sin(t);
        return cAdd(origin,
                    cAdd(cScale(refDir, a * c), cScale(bn, b * s)));
    }
    case GeomCurveKind::BSpline:
        return nurbs.evaluate(t);
    }
    return origin;
}

Curve Curve::makeLine(const Vec3& p0, const Vec3& p1) {
    Curve c;
    c.kind = GeomCurveKind::Line;
    c.origin = p0;
    c.dir = cSub(p1, p0);   // unit param: C(0)=p0, C(1)=p1.
    c.t0 = 0.0;
    c.t1 = 1.0;
    return c;
}

Curve Curve::makeCircle(const Vec3& centre, const Vec3& refDir,
                        const Vec3& normal, double radius,
                        double t0, double t1) {
    Curve c;
    c.kind = GeomCurveKind::Circle;
    c.origin = centre;
    c.refDir = cNorm(refDir);
    c.normal = cNorm(normal);
    c.r = radius;
    c.t0 = t0;
    c.t1 = t1;
    return c;
}

Curve Curve::makeEllipse(const Vec3& centre, const Vec3& refDir,
                         const Vec3& normal, double semiA, double semiB,
                         double t0, double t1) {
    Curve c;
    c.kind = GeomCurveKind::Ellipse;
    c.origin = centre;
    c.refDir = cNorm(refDir);
    c.normal = cNorm(normal);
    c.a = semiA;
    c.b = semiB;
    c.t0 = t0;
    c.t1 = t1;
    return c;
}

Curve Curve::makeBSpline(const NurbsCurve& nc) {
    Curve c;
    c.kind = GeomCurveKind::BSpline;
    c.nurbs = nc;
    // Domain = the clamped knot span of the curve (first/last distinct knots).
    if (!nc.knots.empty()) {
        c.t0 = nc.knots.front();
        c.t1 = nc.knots.back();
    }
    return c;
}

// ===========================================================================
// PCurve (2D, parameter-space)
// ===========================================================================
UVCoord PCurve::evaluate(double t) const {
    switch (kind) {
    case GeomPCurveKind::Line2: {
        // Affine interpolation p0 -> p1 over t in [0,1] (t0,t1 select a sub-range).
        return UVCoord{p0.u + t * (p1.u - p0.u),
                       p0.v + t * (p1.v - p0.v)};
    }
    case GeomPCurveKind::Circle2: {
        const double c = std::cos(t), s = std::sin(t);
        return UVCoord{centre.u + r * c, centre.v + r * s};
    }
    case GeomPCurveKind::BSpline2: {
        Vec3 q = nurbs.evaluate(t);
        return UVCoord{q.x, q.y};   // x->u, y->v (z ignored)
    }
    }
    return p0;
}

PCurve PCurve::makeLine2(const UVCoord& a, const UVCoord& b) {
    PCurve p;
    p.kind = GeomPCurveKind::Line2;
    p.p0 = a;
    p.p1 = b;
    p.t0 = 0.0;
    p.t1 = 1.0;
    return p;
}

PCurve PCurve::makeCircle2(const UVCoord& centre, double radius,
                           double t0, double t1) {
    PCurve p;
    p.kind = GeomPCurveKind::Circle2;
    p.centre = centre;
    p.r = radius;
    p.t0 = t0;
    p.t1 = t1;
    return p;
}

PCurve PCurve::makeBSpline2(const NurbsCurve& nc) {
    PCurve p;
    p.kind = GeomPCurveKind::BSpline2;
    p.nurbs = nc;
    if (!nc.knots.empty()) {
        p.t0 = nc.knots.front();
        p.t1 = nc.knots.back();
    }
    return p;
}

} // namespace brep
} // namespace native
} // namespace forge
