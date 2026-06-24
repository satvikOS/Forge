// forge/native/brep/Curve.hpp
//
// In-house tagged CURVE geometry (3D, attached to an Edge) + tagged PCURVE
// geometry (2D parameter-space curve, attached to a Coedge) for the Forge native
// kernel. This is the K0 topology FOUNDATION layer the trimmed-NURBS face (K1.2)
// needs: an Edge can now carry the EXACT 3D curve it follows, and a Coedge can
// carry the 2D (u,v) image of that edge in its Face's surface parameter space.
//
// ============================ HONESTY (Bible §0/§9) ========================
// This file adds the GEOMETRY a topological Edge/Coedge points at. What is REAL
// and VALIDATED here (see test/native/brep/k0_topology_test.cpp):
//
//   * Curve  (3D): a tagged union over Line, Circle, Ellipse, BSpline. Each kind
//     evaluates the EXACT analytic point C(t) over its own parameter domain
//     [t0,t1]. The BSpline kind delegates to the validated rational evaluator in
//     brep/Nurbs.hpp (NurbsCurve) — zero re-derivation of the basis recurrence.
//   * PCurve (2D): a tagged union over Line2, Circle2, BSpline2 in the (u,v)
//     parameter plane of a surface, evaluating the EXACT 2D point P(t). A planar
//     PCurve composed with its Face's analytic Surface S(u,v) reproduces the 3D
//     Edge curve to ~1e-9 (the consistency invariant the K0 test asserts).
//
// What is explicitly TARGETED (NOT built here, do not claim it works):
//   * No curve fitting / projection / surface-curve recovery (a PCurve is GIVEN
//     consistent with its edge's 3D curve; this layer does not derive one from
//     the other — that is K1.x). No knot insertion / refinement on the bspline
//     kinds (NurbsCalculus owns those). No intersection / closest-point.
//   * No periodic-curve wrap handling beyond the analytic Circle/Ellipse closing
//     at t0+2pi; the domain [t0,t1] is the caller's trim window.
//
// Pure C++20, ZERO external dependencies (standard library + existing forge
// native headers only). No OCCT, no WASM. CONVENTIONS: namespace
// forge::native::brep. Reuses by #include only: brep/Nurbs.hpp (Vec3 +
// NurbsCurve point eval).

#ifndef FORGE_NATIVE_BREP_CURVE_HPP
#define FORGE_NATIVE_BREP_CURVE_HPP

#include <array>
#include <cstddef>

#include "forge/native/brep/Nurbs.hpp"   // Vec3, NurbsCurve

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// GeomCurveKind — the 3D analytic curve families an Edge may follow.
//
// NOTE: named GeomCurveKind (not CurveKind) to coexist with the existing
// SurfaceIntersect.hpp `CurveKind`, which is a DIFFERENT concept (the family of
// a surface-surface INTERSECTION result, with Empty/Point/Conic/Polyline cases).
// This enum classifies the GEOMETRY a topological edge carries — a deliberate,
// non-colliding distinct type in the same forge::native::brep namespace.
// ---------------------------------------------------------------------------
enum class GeomCurveKind {
    Line,     // origin + t*dir,            t in [t0,t1]
    Circle,   // centre + r*(cos t * refDir + sin t * binormal),  t = angle
    Ellipse,  // centre + a*cos t * refDir + b*sin t * binormal,  t = eccentric angle
    BSpline   // rational/polynomial B-spline (NurbsCurve), t in [t0,t1] over its knots
};

// ---------------------------------------------------------------------------
// Curve — a tagged 3D analytic curve in model space. The (refDir, normal) frame
// is right-handed for the conic kinds: refDir is the local +X in the conic's
// plane, binormal = normal x refDir the local +Y, and `normal` the plane axis.
//
//   Line:    C(t) = origin + t*dir
//   Circle:  C(t) = origin + r*(cos t * refDir + sin t * (normal x refDir))
//   Ellipse: C(t) = origin + a*cos t * refDir + b*sin t * (normal x refDir)
//   BSpline: C(t) = NurbsCurve::evaluate(t)   (its own knot domain is the trim)
//
// `t0,t1` is the parameter trim window (the portion of the curve the Edge spans).
// For the conic kinds t is an angle in radians; for Line/BSpline it is the
// curve's intrinsic parameter.
// ---------------------------------------------------------------------------
struct Curve {
    GeomCurveKind kind = GeomCurveKind::Line;

    Vec3   origin{};               // line point / conic centre
    Vec3   dir{1, 0, 0};           // Line: direction (need not be unit). Conic: unused.
    Vec3   refDir{1, 0, 0};        // conic in-plane +X axis (unit)
    Vec3   normal{0, 0, 1};        // conic plane axis (unit); binormal = normal x refDir
    double r = 0.0;                // Circle radius
    double a = 0.0;                // Ellipse semi-axis along refDir
    double b = 0.0;                // Ellipse semi-axis along binormal

    double t0 = 0.0;               // parameter-domain start (trim)
    double t1 = 1.0;               // parameter-domain end   (trim)

    NurbsCurve nurbs;              // valid only when kind == BSpline

    // binormal = normal x refDir (the conic frame's +Y).
    Vec3 binormal() const;

    // Exact point C(t) on the curve at parameter t.
    Vec3 evaluate(double t) const;

    // Convenience: the two trim endpoints C(t0), C(t1).
    Vec3 startPoint() const { return evaluate(t0); }
    Vec3 endPoint()   const { return evaluate(t1); }

    // --- analytic factories (so callers never hand-fill the frame wrong) -----
    static Curve makeLine(const Vec3& p0, const Vec3& p1);
    static Curve makeCircle(const Vec3& centre, const Vec3& refDir,
                            const Vec3& normal, double radius,
                            double t0 = 0.0, double t1 = 6.28318530717958647692);
    static Curve makeEllipse(const Vec3& centre, const Vec3& refDir,
                             const Vec3& normal, double semiA, double semiB,
                             double t0 = 0.0, double t1 = 6.28318530717958647692);
    static Curve makeBSpline(const NurbsCurve& c);
};

// ---------------------------------------------------------------------------
// GeomPCurveKind — the 2D parameter-space curve families a Coedge may follow
// inside its Face's surface (u,v) plane. (Geom-prefixed for symmetry with
// GeomCurveKind and to stay collision-free in the shared namespace.)
// ---------------------------------------------------------------------------
enum class GeomPCurveKind {
    Line2,    // p0 + t*(p1-p0),  t in [0,1]            (a straight segment in (u,v))
    Circle2,  // (cu,cv) + r*(cos t, sin t),  t = angle (a circle in (u,v))
    BSpline2  // 2D B-spline in (u,v) (a NurbsCurve whose z is ignored / 0)
};

// A 2D point in a surface's (u,v) parameter plane. Named UVCoord (not UV) so it
// never collides with mesh::UV under combined `using namespace` directives.
struct UVCoord {
    double u = 0.0;
    double v = 0.0;
};

// ---------------------------------------------------------------------------
// PCurve — a tagged 2D curve in a surface's parameter plane. Composing it with
// the owning Face's Surface S(u,v) yields the same 3D point as the Edge's 3D
// Curve at the corresponding parameter (the K0 consistency invariant).
//
//   Line2:    P(t) = p0 + t*(p1 - p0),               t in [t0,t1]  (usually [0,1])
//   Circle2:  P(t) = centre + r*(cos t, sin t),      t = angle
//   BSpline2: P(t) = (NurbsCurve::evaluate(t).x as u, .y as v)
//
// `t0,t1` is the parameter trim. For Circle2 t is an angle; for Line2 the
// affine parameter; for BSpline2 the curve's intrinsic parameter.
// ---------------------------------------------------------------------------
struct PCurve {
    GeomPCurveKind kind = GeomPCurveKind::Line2;

    UVCoord p0{};                  // Line2 start
    UVCoord p1{1, 0};              // Line2 end
    UVCoord centre{};              // Circle2 centre
    double  r = 0.0;               // Circle2 radius
    double  t0 = 0.0;
    double  t1 = 1.0;

    NurbsCurve nurbs;              // valid only when kind == BSpline2 (x->u, y->v)

    // Exact 2D point P(t).
    UVCoord evaluate(double t) const;

    UVCoord startPoint() const { return evaluate(t0); }
    UVCoord endPoint()   const { return evaluate(t1); }

    // --- factories -----------------------------------------------------------
    static PCurve makeLine2(const UVCoord& a, const UVCoord& b);
    static PCurve makeCircle2(const UVCoord& centre, double radius,
                              double t0 = 0.0, double t1 = 6.28318530717958647692);
    static PCurve makeBSpline2(const NurbsCurve& c);
};

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_CURVE_HPP
