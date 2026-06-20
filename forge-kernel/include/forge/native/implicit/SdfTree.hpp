// forge/native/implicit/SdfTree.hpp
//
// In-house implicit / F-rep modeling — Stage 4 of KERNEL_INHOUSE_ROADMAP.md.
// libfive-class signed-distance-field (SDF) expression tree.
//
// An SDF is a function f: R^3 -> R whose value at a point p is the signed
// distance to the surface {f = 0}: negative inside the solid, positive outside,
// zero on the surface. The magnitude is (for an EXACT distance field) the
// Euclidean distance to the nearest surface point.
//
// This header defines a small, value-semantics expression tree:
//
//   * Primitives  — sphere, box, plane (each an EXACT analytic distance).
//   * Operators   — union (min), intersection (max), difference (max(a,-b)),
//                   and a smooth-min / smooth-union "blend" (polynomial smin).
//
// Every node answers eval(p) -> double (the signed distance at p). The tree is
// reference-counted (std::shared_ptr) so subtrees can be shared and combined
// freely without copies, and so an Sdf is cheap to pass by value.
//
// PROVENANCE / HONESTY (Bible §0/§9, roadmap Stage 4)
// ---------------------------------------------------
// This is the FIRST increment of a multi-year class. What is REAL and VALIDATED
// here (see test/native/implicit/implicit_gate.cpp):
//   - sphere/box/plane analytic SDFs,
//   - union/intersection/difference CSG,
//   - polynomial smooth-min blend,
//   - a marching-cubes mesher (IsoMesher.hpp) whose sphere volume converges to
//     4/3·π·r³ as resolution rises.
//
// EXACTNESS CAVEAT, stated honestly: the box distance and all CSG/smooth
// operators return a BOUND on the true distance, not necessarily the exact
// Euclidean distance:
//   - The box uses the standard exact exterior distance, but the INTERIOR
//     distance it reports (negative branch) is the Chebyshev-style
//     min(max(d.x,d.y,d.z)) under-estimate, which is a conservative
//     (>= true negative distance) bound — the usual SDF-modeling convention.
//   - min/max of two exact SDFs are themselves only LIPSCHITZ-1 bounds on the
//     union/intersection distance (correct sign, |grad| <= 1), not exact.
//   - smooth-min is intentionally non-distance (it rounds the field).
// This matches the roadmap's "robust-in-practice, never exact-surface" target.
// The marching-cubes ISO error is O(h^2) in cell size; we MEASURE convergence
// rather than claim an exact surface.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_IMPLICIT_SDFTREE_HPP
#define FORGE_NATIVE_IMPLICIT_SDFTREE_HPP

#include <array>
#include <memory>
#include <utility>

namespace forge {
namespace native {
namespace implicit {

// A 3D point / vector with the minimal arithmetic the SDF tree needs.
struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;

    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}

    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
};

double dot(const Vec3& a, const Vec3& b);
double length(const Vec3& v);

// ---------------------------------------------------------------------------
// SdfNode — abstract base of the expression tree.
//
// eval(p) returns the signed distance at p (negative inside, positive outside).
// Nodes are immutable and shared via shared_ptr; build them with the free
// factory functions below, never directly.
// ---------------------------------------------------------------------------
class SdfNode {
public:
    virtual ~SdfNode() = default;
    virtual double eval(const Vec3& p) const = 0;
};

using SdfPtr = std::shared_ptr<const SdfNode>;

// ---------------------------------------------------------------------------
// Sdf — a value-semantics handle around an SdfPtr.
//
// Lets callers write expressions like:  auto s = sphere(...) - box(...);
// Each operator returns a NEW Sdf sharing the operand subtrees.
// ---------------------------------------------------------------------------
class Sdf {
public:
    Sdf() = default;
    explicit Sdf(SdfPtr node) : node_(std::move(node)) {}

    // Signed distance at p. Throws if the handle is empty.
    double eval(const Vec3& p) const;

    bool valid() const { return static_cast<bool>(node_); }
    const SdfPtr& node() const { return node_; }

    // Numerical gradient (central differences) — surface normal direction.
    // h is the finite-difference step.
    Vec3 gradient(const Vec3& p, double h = 1e-5) const;

private:
    SdfPtr node_;
};

// ---- Primitives -----------------------------------------------------------

// Sphere centered at `center` with `radius`. EXACT distance.
//   f(p) = |p - center| - radius
Sdf sphere(const Vec3& center, double radius);

// Axis-aligned box centered at `center` with full-extent `size` (size = the
// side lengths, so half-extents = size/2). Standard SDF box distance:
//   exterior distance is exact; interior is the conservative Chebyshev bound.
Sdf box(const Vec3& center, const Vec3& size);

// Half-space whose boundary plane passes through a point on it at signed
// `offset` along unit normal `normal`. f(p) = dot(normal, p) - offset.
// (Solid = the side the normal points AWAY from, i.e. f<0.)
Sdf plane(const Vec3& normal, double offset);

// ---- Operators ------------------------------------------------------------

// Boolean union: solid(A) OR solid(B).  f = min(a, b).
Sdf unionOp(const Sdf& a, const Sdf& b);

// Boolean intersection: solid(A) AND solid(B).  f = max(a, b).
Sdf intersectionOp(const Sdf& a, const Sdf& b);

// Boolean difference: solid(A) AND NOT solid(B).  f = max(a, -b).
Sdf differenceOp(const Sdf& a, const Sdf& b);

// Smooth union ("blend") of A and B with blend radius k > 0. Polynomial smin
// (Quilez): rounds the union seam over a region of width ~k. As k -> 0 this
// converges to the sharp min. The result is intentionally NOT an exact
// distance field (it is a smoothed scalar field with the correct zero set).
Sdf smoothUnionOp(const Sdf& a, const Sdf& b, double k);

// Convenience operator sugar.
inline Sdf operator|(const Sdf& a, const Sdf& b) { return unionOp(a, b); }
inline Sdf operator&(const Sdf& a, const Sdf& b) { return intersectionOp(a, b); }
inline Sdf operator-(const Sdf& a, const Sdf& b) { return differenceOp(a, b); }

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_SDFTREE_HPP
