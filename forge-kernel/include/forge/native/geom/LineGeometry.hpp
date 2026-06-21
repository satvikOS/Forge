// forge/native/geom/LineGeometry.hpp
//
// Robust line / segment / ray / plane geometric primitives in 3D —
// forge::native::geom.
//
// This module supplies the everyday distance / closest-point / intersection
// queries that sit underneath meshing, BReP edge handling, collision, and
// constraint solving. They are written in pure C++20 against ONLY the existing
// forge/native types (geom::Point3 from geom/Geom.hpp) — no OCCT, no WASM, no
// third-party libraries.
//
// WHAT SHIPS HERE (each REAL and VALIDATED in test/native/geom/
// linegeometry_test.cpp against a dense-sampling brute force and the analytic
// formulae):
//
//   (1) segmentSegmentClosest — the closest pair of points between two finite
//       segments in 3D, plus their distance and the two barycentric parameters
//       s,t in [0,1]. Handles the full taxonomy: skew, parallel, intersecting,
//       endpoint-clamped, and zero-length (degenerate) inputs. The classic
//       Ericson clamp-and-recompute method; parallel/degenerate configurations
//       are detected from the denominator and resolved honestly rather than
//       dividing by ~0.
//
//   (2) lineLineClosest — the closest pair of points between two INFINITE lines
//       given by point+direction. Reports parallel lines via `ok=false` (no
//       unique closest pair) while still returning a representative distance.
//
//   (3) segmentPlaneIntersect / linePlaneIntersect / rayPlaneIntersect — where a
//       segment / line / ray meets a plane. The crossing parameter t is exact in
//       the sense that the returned point reconstructs identically from BOTH the
//       segment param and the plane equation (validated). Parallel (no hit) and
//       in-plane (infinitely many hits) cases are flagged via the status enum,
//       never collapsed to a bogus single point.
//
//   (4) pointSegmentDistance / pointLineDistance — Euclidean distance from a
//       point to a finite segment (clamped) or an infinite line (perpendicular).
//
//   (5) pointPlaneSignedDistance / pointPlaneDistance — signed (and unsigned)
//       distance from a point to a plane, matching the analytic
//       n·(p - p0) / |n| formula exactly.
//
// HONESTY POSTURE (Bible §0): these are ordinary double-precision constructions.
// The CLASSIFICATION of degeneracy (parallel / zero-length / line-in-plane) is
// reported truthfully through `ok` / status flags — there are NO silent
// fallbacks and NO fabricated answers on degenerate input. The numeric results
// are best-effort double, validated to 1e-6 against an independent brute force.
// Robustness here is "robust-in-practice", not the proven-exact EPECK posture of
// the orientation predicates in Predicates.hpp (which this module does not need).
//
// CONVENTIONS: pure C++20, standard library only. Unique symbols live in
// namespace forge::native::geom.

#ifndef FORGE_NATIVE_GEOM_LINEGEOMETRY_HPP
#define FORGE_NATIVE_GEOM_LINEGEOMETRY_HPP

#include <array>
#include <cstddef>

#include "forge/native/geom/Geom.hpp"  // geom::Point3

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// A lightweight 3D vector view. We reuse geom::Point3 for both positions and
// directions to avoid introducing a parallel type; these free helpers give the
// usual vector algebra without polluting the Point3 struct.
// ---------------------------------------------------------------------------
inline Point3 vsub(const Point3& a, const Point3& b) {
    return Point3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Point3 vadd(const Point3& a, const Point3& b) {
    return Point3{a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Point3 vscale(const Point3& a, double s) {
    return Point3{a.x * s, a.y * s, a.z * s};
}
inline double vdot(const Point3& a, const Point3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Point3 vcross(const Point3& a, const Point3& b) {
    return Point3{a.y * b.z - a.z * b.y,
                  a.z * b.x - a.x * b.z,
                  a.x * b.y - a.y * b.x};
}
double vlen(const Point3& a);                 // Euclidean length
double vdist(const Point3& a, const Point3& b);  // distance between two points

// ---------------------------------------------------------------------------
// A plane in point-normal form. `normal` need NOT be unit length; all routines
// normalize internally where a unit normal is required. A point p lies on the
// plane when dot(normal, p - point) == 0.
// ---------------------------------------------------------------------------
struct Plane {
    Point3 point{};                 // any point on the plane
    Point3 normal{0.0, 0.0, 1.0};   // plane normal (need not be unit)
};

// Construct a plane from three points; `ok` is false if the three are collinear
// (the normal would be zero, so the plane is undefined).
struct PlaneFit {
    bool   ok{false};
    Plane  plane{};
    const char* reason{""};
};
PlaneFit planeFromPoints(const Point3& a, const Point3& b, const Point3& c);

// ---------------------------------------------------------------------------
// (5) Point–plane signed distance.
//
// signedDistance = dot(normalize(plane.normal), p - plane.point).
// Positive on the side the normal points toward, negative on the other, zero on
// the plane. `ok` is false only if the plane normal is (numerically) zero.
// ---------------------------------------------------------------------------
struct PointPlaneResult {
    bool   ok{false};
    double signedDistance{0.0};   // signed perpendicular distance
    double distance{0.0};         // |signedDistance|
    Point3 foot{};                // the projection of p onto the plane
};
PointPlaneResult pointPlaneSignedDistance(const Point3& p, const Plane& plane);
// Convenience: unsigned distance only (0 on degenerate plane, with ok flagged).
double pointPlaneDistance(const Point3& p, const Plane& plane, bool* ok = nullptr);

// ---------------------------------------------------------------------------
// (4) Point–line and point–segment distance.
//
// pointLineDistance: distance from p to the INFINITE line through `a` with
// direction `dir`. `ok` false iff dir is ~zero (line undefined).
//
// pointSegmentDistance: distance from p to the FINITE segment a->b, with the
// clamped parameter t in [0,1] and the closest point on the segment. A
// zero-length segment (a==b) is handled honestly: t=0, foot=a, distance=|p-a|,
// and `degenerate` is set true.
// ---------------------------------------------------------------------------
struct PointLineResult {
    bool   ok{false};
    double distance{0.0};
    double t{0.0};       // parameter of the foot along dir (line: unbounded)
    Point3 foot{};       // closest point on the line
};
PointLineResult pointLineDistance(const Point3& p,
                                  const Point3& a, const Point3& dir);

struct PointSegmentResult {
    double distance{0.0};
    double t{0.0};            // clamped parameter in [0,1]
    Point3 foot{};            // closest point on the segment
    bool   degenerate{false}; // true iff the segment had zero length
};
PointSegmentResult pointSegmentDistance(const Point3& p,
                                        const Point3& a, const Point3& b);

// ---------------------------------------------------------------------------
// (1) Segment–segment closest points.
//
// p1->q1 is the first segment, p2->q2 the second. Returns the parameters s,t in
// [0,1], the two closest points c1 = p1 + s*(q1-p1), c2 = p2 + t*(q2-p2), and
// their distance.
//
//   parallel   — set true when the two segment directions are (numerically)
//                parallel; the closest pair is then not unique and we return a
//                valid representative pair (Ericson's parallel branch).
//   degenerate — set true when at least one segment has zero length; the result
//                is still a correct point-to-segment (or point-to-point)
//                distance, just not a generic segment-segment one.
// ---------------------------------------------------------------------------
struct SegSegResult {
    double distance{0.0};
    double s{0.0};
    double t{0.0};
    Point3 c1{};
    Point3 c2{};
    bool   parallel{false};
    bool   degenerate{false};
};
SegSegResult segmentSegmentClosest(const Point3& p1, const Point3& q1,
                                   const Point3& p2, const Point3& q2);

// ---------------------------------------------------------------------------
// (2) Line–line closest approach (INFINITE lines).
//
// Line A: a0 + s*da. Line B: b0 + t*db. Returns the closest points and their
// distance. `ok` is false when the directions are parallel (no unique closest
// pair) — in that case the distance returned is the (constant) distance between
// the lines, and the points are a representative pair.
// ---------------------------------------------------------------------------
struct LineLineResult {
    bool   ok{false};        // false => lines parallel (or a direction is zero)
    double distance{0.0};
    double s{0.0};
    double t{0.0};
    Point3 c1{};
    Point3 c2{};
    bool   parallel{false};
};
LineLineResult lineLineClosest(const Point3& a0, const Point3& da,
                               const Point3& b0, const Point3& db);

// ---------------------------------------------------------------------------
// (3) Segment / line / ray vs plane.
//
// Status taxonomy:
//   HIT      — a single crossing point exists (returned in `point`, parameter
//              `t`). For a segment, t is in [0,1]; for a ray, t >= 0; for a line,
//              t is unbounded.
//   MISS     — the segment/ray is entirely on one side and does not reach the
//              plane (for a segment: the line WOULD cross but the crossing
//              parameter is outside [0,1]; for a ray: behind the origin).
//   PARALLEL — direction is parallel to the plane and the start is NOT on it
//              (no intersection).
//   IN_PLANE — direction is parallel to the plane and the start IS on it
//              (infinitely many intersections; `point`=start, `t`=0).
// ---------------------------------------------------------------------------
enum class PlaneHit {
    HIT,
    MISS,
    PARALLEL,
    IN_PLANE
};

struct LinePlaneResult {
    PlaneHit status{PlaneHit::MISS};
    double   t{0.0};      // crossing parameter along the (a->b) direction
    Point3   point{};     // crossing point (meaningful for HIT and IN_PLANE)
};

// Segment a->b. HIT only when t in [0,1].
LinePlaneResult segmentPlaneIntersect(const Point3& a, const Point3& b,
                                      const Plane& plane);
// Infinite line through `a` with direction `dir`. HIT for any finite t.
LinePlaneResult linePlaneIntersect(const Point3& a, const Point3& dir,
                                   const Plane& plane);
// Ray from `origin` along `dir`. HIT only when t >= 0.
LinePlaneResult rayPlaneIntersect(const Point3& origin, const Point3& dir,
                                  const Plane& plane);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_LINEGEOMETRY_HPP
