// forge/native/brep/SurfaceIntersect.hpp
//
// In-house ANALYTIC surface–surface intersection (SSI) for the Forge native
// B-rep kernel — the OCCT IntPatch / GeomInt analog, working DIRECTLY on the
// analytic brep::Surface (Plane/Cylinder/Cone/Sphere/Torus) rather than on a
// tessellation. This is the closed-form geometry the native BOOLEAN imprints to
// place its cut vertices EXACTLY on the true quadric intersection (so a bored
// plate's hole circle is the exact analytic circle, not a chord polyline).
//
// ============================ HONESTY (Bible §0/§9) ========================
// This module returns one or more IntersectionCurve, each a closed-form analytic
// curve (a line, a circle, an ellipse, a general conic) OR — for the high-degree
// pairs that have NO low-degree closed form (torus-anything, skew cyl-cyl,
// cyl-sphere general, cone-cone) — a MARCHED polyline traced by Newton iteration
// on F(u,v,s,t)=Sa(u,v)-Sb(s,t)=0. The `kind` field states which it is, and
// `closedForm` is true ONLY for the exact-analytic cases. The boolean consults
// `closedForm`: where it is false the boolean falls back to the proven mesh-level
// arrangement (Boolean.cpp), so this module NEVER silently degrades the result —
// it reports what it can solve exactly and defers the rest honestly.
//
// CLOSED-FORM PAIRS IMPLEMENTED (each validated in native_ssi_test.cpp against an
// analytic ground truth — radius / direction / point-on-both):
//   * plane ∩ plane          -> Line          (cross of the two normals)
//   * plane ∩ sphere         -> Circle / point / empty
//   * plane ∩ cylinder       -> 2 Lines (∥ axis) / Circle (⊥) / Ellipse (oblique)
//   * sphere ∩ sphere        -> Circle / point / empty
//   * cylinder ∩ cylinder    -> Circle (coaxial-equal-r degenerate) / 2 Ellipses
//                                (equal-radius intersecting axes = Steinmetz) —
//                                the general SKEW case is DEFERRED (marched)
//   * cylinder ∩ sphere      -> Circle (axis through centre) — general DEFERRED
//
// DEFERRED (honestly reported, closedForm=false, marched or handed to the mesh
//  boolean): plane∩cone (Dandelin conic — NOT yet implemented), general skew
//  cyl∩cyl, general cyl∩sphere, cone∩(cyl/cone/sphere/
//  torus), every torus pair, anything involving a NURBS face. These are the
//  quartic / higher-degree intersections with no elementary closed form.
//
// Pure C++20, ZERO external deps (stdlib + existing forge native brep headers).
// No OCCT, no WASM. CONVENTIONS: namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_SURFACEINTERSECT_HPP
#define FORGE_NATIVE_BREP_SURFACEINTERSECT_HPP

#include <vector>

#include "forge/native/brep/Surface.hpp"   // Surface, Vec3, vadd/vsub/...

namespace forge {
namespace native {
namespace brep {

// The analytic family of an intersection curve.
enum class CurveKind {
    Empty,      // surfaces do not meet
    Point,      // measure-zero tangency contact (one point)
    Line,       // a straight line (or a line segment after trimming)
    Circle,     // a circle in 3D (centre, axis-normal, radius)
    Ellipse,    // a planar ellipse (centre, two conjugate semi-axes)
    Conic,      // a general planar conic returned as a sampled polyline
    Polyline    // a marched / sampled curve (the deferred quartic cases)
};

// One intersection curve between two analytic surfaces.
//   * For Line:   `origin` is a point on the line, `dir` the unit direction.
//   * For Circle: `origin` is the centre, `axis` the unit normal of the circle
//                 plane, `r1` the radius; `refDir` the in-plane +X.
//   * For Ellipse:`origin` is the centre, `refDir`/`binorm()` the two semi-axis
//                 directions, `r1`/`r2` the two semi-axis lengths, `axis` the
//                 plane normal.
//   * For Conic / Polyline: `samples` carries the ordered 3D polyline points
//                 (and `closed` says whether it loops). For the analytic Line /
//                 Circle / Ellipse cases `samples` is ALSO filled (a dense, exact
//                 sampling clipped to the relevant span) so a caller that just
//                 wants points need not special-case the kind.
struct IntersectionCurve {
    CurveKind kind = CurveKind::Empty;
    bool   closedForm = false;   // true => an exact analytic curve (not marched)
    bool   closed = false;       // the sampled polyline loops (circle/ellipse)

    Vec3   origin{};             // point-on-line / circle-centre / ellipse-centre
    Vec3   dir{1, 0, 0};         // line direction (unit)
    Vec3   axis{0, 0, 1};        // circle/ellipse plane normal (unit)
    Vec3   refDir{1, 0, 0};      // circle/ellipse in-plane +X (unit)
    double r1 = 0.0;             // circle radius / ellipse semi-axis along refDir
    double r2 = 0.0;             // ellipse semi-axis along binormal

    std::vector<Vec3> samples;   // ordered 3D points (always populated)

    Vec3 binorm() const { return vcross(axis, refDir); }
};

// Result of an analytic SSI query between two whole surfaces (untrimmed).
struct SurfaceIntersectResult {
    bool ok = false;             // false => the pair is DEFERRED (not handled here)
    bool allClosedForm = false;  // every returned curve is exact-analytic
    const char* reason = "deferred";
    std::vector<IntersectionCurve> curves;
};

// Tuning. `sampleN` is the number of points used to densely sample a closed-form
// analytic curve (circle/ellipse/line span) into `IntersectionCurve::samples`.
struct SurfaceIntersectOptions {
    int    sampleN = 128;
    double tol     = 1e-9;       // geometric coincidence tolerance
};

// Intersect two analytic surfaces. Returns ok=false (reason set, curves empty)
// for the DEFERRED higher-degree pairs (caller falls back to the mesh boolean).
// When ok=true, every curve's `closedForm` flag states whether it is exact.
SurfaceIntersectResult intersectSurfaces(
    const Surface& a, const Surface& b,
    const SurfaceIntersectOptions& opts = SurfaceIntersectOptions{});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SURFACEINTERSECT_HPP
