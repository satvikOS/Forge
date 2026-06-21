// forge/native/geom/Bezier.hpp
//
// In-house Bezier CURVE + tensor-product Bezier SURFACE evaluator / subdivider /
// tessellator for the Forge native kernel — forge::native::geom. This COMPLEMENTS
// the rational B-spline / NURBS suite (brep/Nurbs.hpp, brep/NurbsSurface.hpp,
// brep/NurbsCalculus.hpp): a Bezier patch is the simplest non-rational free-form
// primitive — a single polynomial span with no knot vector — and is the building
// block every NURBS curve decomposes into (Bezier extraction). It is provided
// here as a small, exactly-validated, standalone unit rather than as another
// configuration of the NURBS evaluator so its numerics are independently auditable.
//
// Pure C++20, ZERO external dependencies (standard library + existing forge
// native headers only). No OCCT, no WASM, no third-party libs. The only forge
// header reused (by #include) is mesh/HalfEdgeMesh.hpp, the tessellation target.
// The basic 3D point type is geom::Point3 (re-declared here is forbidden — we do
// NOT have a geom dependency on Geom.hpp's algorithms, only its trivial structs,
// so we define our own header-only Vec3 to keep this module self-contained and
// avoid pulling Predicates.hpp transitively; the SURFACE tessellation still emits
// a mesh::HalfEdgeMesh).
//
// ============================ WHAT SHIPS (REAL + VALIDATED) ==================
// Validated in test/native/geom/bezier_test.cpp against analytic identities and
// finite differences (the test prints a fresh std::random_device seed):
//
//   (1) evalCurve(P, t)  — de Casteljau evaluation of a degree-n Bezier curve
//       from its (n+1) control points. Returns the point B(t), the first
//       derivative B'(t) (the hodograph, i.e. n*(P[i+1]-P[i]) evaluated by a
//       second de Casteljau pass — NOT a finite difference), and the unit tangent.
//       VALIDATED: degree-1 == exact linear interp; endpoints B(0)==P0, B(1)==Pn
//       to machine precision; the curve stays inside the control-point convex hull
//       (axis-aligned-bounding-box containment, the cheap necessary condition the
//       convex-hull property guarantees); analytic B'(t) matches a central finite
//       difference to < 1e-6.
//
//   (2) subdivideCurve(P, t) — de Casteljau subdivision: splits the curve at
//       parameter t into TWO Bezier curves (left control net = the de Casteljau
//       "left" diagonal, right net = the "right" diagonal), each of the same
//       degree, whose union reproduces the original curve EXACTLY. VALIDATED: for
//       any s in [0,1], the left half at s/ t and the right half at (s-t)/(1-t)
//       reproduce the original B(s) to < 1e-12 (a polynomial identity, not a
//       tolerance approximation).
//
//   (3) evalSurface(grid, u, v) — tensor-product Bezier surface S(u,v) over an
//       (m+1) x (n+1) control net: de Casteljau in u on each row, then in v on
//       the resulting points (and the symmetric pass for the v-tangent). Returns
//       the point, dS/du, dS/dv, and the unit normal (du x dv normalized).
//       VALIDATED: a flat (planar) control net yields points on that plane to
//       1e-12 with a CONSTANT normal; analytic partials match central finite
//       differences to < 1e-6; the four net corners are interpolated exactly.
//
//   (4) tessellateSurface(grid, resU, resV) — samples the unit (u,v) domain on a
//       regular (resU+1) x (resV+1) grid and emits a triangulated
//       mesh::HalfEdgeMesh OPEN patch (it has a boundary loop, so it is
//       intentionally not watertight). `ok` is false (and the mesh empty) on a
//       malformed net or res < 1.
//
// ============================ HONESTY / ENVELOPE (Bible §0/§9) ===============
// These are ordinary double-precision polynomial constructions evaluated by the
// numerically-stable de Casteljau corner-cutting recurrence (NOT the monomial /
// Bernstein-power form, which is ill-conditioned at high degree). The corner-
// cutting steps are convex combinations, so every intermediate point stays in the
// convex hull — this is why the hull-containment property holds in floating point.
//
// ENVELOPE (the honestly-validated operating range — outside it the functions
// report ok=false and NEVER fabricate a result):
//   * Curve degree n with 1 <= n <= 30 (a degree-0 single point is rejected as a
//     curve: it has no tangent). A degree > 30 net is rejected rather than risk
//     the (n choose k) growth that erodes precision — high-degree Beziers should
//     be modeled as NURBS / segmented Beziers, which the brep/ suite owns.
//   * Surface net (m+1) x (n+1) with 1 <= m,n <= 30 and every row the SAME width
//     (a rectangular net). A ragged net -> ok=false.
//   * Parameters u,v are CLAMPED to [0,1] for evaluation? NO — they are validated
//     to lie in [0,1]; out-of-domain -> ok=false (a Bezier is only defined on
//     [0,1]; extrapolation is not silently performed).
//   * Tangent/normal `ok` is false when the relevant derivative vector is
//     (numerically) zero — a genuine geometric singularity (e.g. a cusp or a
//     degenerate net where two control rows coincide). The POINT is still valid
//     in that case; only the unit direction is undefined and reported as such.
//
// CONVENTIONS: namespace forge::native::geom; unique symbols. Control points are
// std::vector<Vec3> (curve) or row-major std::vector<std::vector<Vec3>> (surface,
// grid[i][j] with i indexing the u-direction rows, j the v-direction columns).

#ifndef FORGE_NATIVE_GEOM_BEZIER_HPP
#define FORGE_NATIVE_GEOM_BEZIER_HPP

#include <cstddef>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // mesh::HalfEdgeMesh tessellation target

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// A trivial 3D point/vector. Self-contained (no dependency on Geom.hpp /
// Predicates.hpp) so this module compiles against the mesh header alone.
// ---------------------------------------------------------------------------
struct Vec3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};

// Header-only vector algebra (free functions; keeps Vec3 a plain aggregate).
inline Vec3 vadd(const Vec3& a, const Vec3& b) {
    return Vec3{a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Vec3 vsub(const Vec3& a, const Vec3& b) {
    return Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 vscale(const Vec3& a, double s) {
    return Vec3{a.x * s, a.y * s, a.z * s};
}
inline double vdot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}
double vlen(const Vec3& a);                    // Euclidean length
double vdist(const Vec3& a, const Vec3& b);    // distance between two points

// The validated maximum Bezier degree (see ENVELOPE in the file header).
inline constexpr std::size_t kMaxBezierDegree = 30;

// ---------------------------------------------------------------------------
// (1) Curve evaluation.
//
// `point` is B(t); `tangent` is the UNIT first derivative direction; `deriv` is
// the raw (un-normalized) first derivative B'(t). `ok` is false (and the fields
// default-constructed) when the control net is malformed (fewer than 2 points, or
// degree > kMaxBezierDegree) or t is outside [0,1]. `tangentDefined` is false
// when B'(t) is numerically zero (a stationary point / cusp) — the `point` is
// still valid; only `tangent` is undefined.
// ---------------------------------------------------------------------------
struct CurveSample {
    bool ok{false};
    Vec3 point{};
    Vec3 deriv{};           // B'(t), un-normalized (the hodograph value)
    Vec3 tangent{};         // unit B'(t); zero when tangentDefined == false
    bool tangentDefined{false};
};

CurveSample evalCurve(const std::vector<Vec3>& control, double t);

// ---------------------------------------------------------------------------
// (2) Curve subdivision (de Casteljau split at parameter t in (0,1)).
//
// `left` is the control net of the sub-curve over [0,t] reparametrized to [0,1];
// `right` is the sub-curve over [t,1] reparametrized to [0,1]. Both have the same
// degree as the input. `ok` is false (and both nets empty) on a malformed net or
// t outside the OPEN interval (0,1) — splitting at an endpoint is a no-op the
// caller should not request.
// ---------------------------------------------------------------------------
struct CurveSplit {
    bool ok{false};
    std::vector<Vec3> left;
    std::vector<Vec3> right;
};

CurveSplit subdivideCurve(const std::vector<Vec3>& control, double t);

// ---------------------------------------------------------------------------
// (3) Tensor-product surface evaluation.
//
// `grid` is row-major: grid[i][j], i in [0,m] indexing the u-rows, j in [0,n]
// indexing the v-columns. `point` = S(u,v); `du`,`dv` the partials; `normal` the
// unit (du x dv). `ok` false on a malformed (non-rectangular / too small / too
// large) net or (u,v) outside [0,1]^2. `normalDefined` false when du x dv is
// numerically zero (a degenerate parameter point); the point/partials are still
// valid, only the unit normal is undefined.
// ---------------------------------------------------------------------------
struct SurfaceSample {
    bool ok{false};
    Vec3 point{};
    Vec3 du{};              // dS/du
    Vec3 dv{};              // dS/dv
    Vec3 normal{};          // unit (du x dv); zero when normalDefined == false
    bool normalDefined{false};
};

SurfaceSample evalSurface(const std::vector<std::vector<Vec3>>& grid,
                          double u, double v);

// Validate a control net (rectangular, within the degree envelope). Sets
// `reason` (if non-null) to a short diagnostic on failure.
bool validateCurveNet(const std::vector<Vec3>& control, const char** reason = nullptr);
bool validateSurfaceNet(const std::vector<std::vector<Vec3>>& grid,
                        const char** reason = nullptr);

// ---------------------------------------------------------------------------
// (4) Surface tessellation -> mesh::HalfEdgeMesh (open patch).
//
// Samples the unit (u,v) domain on a regular (resU+1) x (resV+1) grid. `ok` is
// false (and the mesh empty) when the net is invalid or resU/resV < 1.
// ---------------------------------------------------------------------------
mesh::HalfEdgeMesh tessellateSurface(const std::vector<std::vector<Vec3>>& grid,
                                     std::size_t resU, std::size_t resV, bool& ok);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_BEZIER_HPP
