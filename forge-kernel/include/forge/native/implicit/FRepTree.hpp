// forge/native/implicit/FRepTree.hpp
//
// In-house libfive-class FUNCTIONAL-REPRESENTATION (F-rep) CSG tree —
// a self-contained companion to the eval-only SdfTree (SdfTree.hpp).
//
// WHAT THIS ADDS over SdfTree
// ---------------------------
//   * ANALYTIC GRADIENT  ∇f  propagated by the CHAIN RULE through the whole
//     CSG tree (NOT central finite differences). Every node returns BOTH its
//     scalar value f and its gradient ∇f in one pass (forward-mode AD over the
//     three spatial inputs). This is what libfive does for fast, exact normals
//     and Newton surface projection.
//   * INTERVAL / RANGE evaluation  f([box])  →  [lo, hi]  over an AABB, so a
//     mesher / octree can PRUNE cells that the surface provably cannot cross
//     (lo > 0 ⇒ wholly outside, hi < 0 ⇒ wholly inside). This is the classic
//     F-rep affine/interval pruning, done here with plain interval arithmetic.
//   * A CYLINDER primitive (SdfTree has sphere/box/plane only).
//
// WHAT THIS REUSES (by #include only, never re-implemented):
//   * forge::native::implicit::Vec3       (from SdfTree.hpp)
//   * forge::native::implicit::IsoMesher  (marching cubes; meshes the tree via
//                                          the SdfTree bridge below)
//   * forge::native::implicit::Mesh / GridSpec (from IsoMesher.hpp)
//
// HONESTY (Bible §0/§9)
// ---------------------
//   * Primitive fields (sphere / plane / cylinder side / box exterior) are EXACT
//     Euclidean distances, so |∇f| == 1 there. The box INTERIOR and all
//     min/max CSG fields are Lipschitz-1 BOUNDS (correct sign, |∇f| ≤ 1), the
//     standard SDF-modeling convention — so |∇f| ~ 1 is asserted only for the
//     exact-field cases, never fabricated for the bound cases.
//   * The analytic gradient is the TRUE derivative of the field the tree
//     evaluates (min/max included, via sub-gradient selection). At the measure-
//     zero ridge where a==b the value is well-defined but the gradient is a
//     sub-gradient (we pick one branch deterministically); validation samples
//     RANDOM points, where this set has probability zero.
//   * Interval bounds are CONSERVATIVE (they enclose the true range); they are
//     not the tightest possible. Pruning with them is sound (never discards a
//     cell the surface crosses).
//   * Degenerate input (non-finite params, radius ≤ 0, height ≤ 0, zero-area
//     box, empty operand) returns ok=false; we NEVER fabricate geometry.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_IMPLICIT_FREPTREE_HPP
#define FORGE_NATIVE_IMPLICIT_FREPTREE_HPP

#include <memory>
#include <utility>

#include "forge/native/implicit/IsoMesher.hpp" // Mesh, GridSpec, IsoMesher (pulls in SdfTree.hpp → Vec3)

namespace forge {
namespace native {
namespace implicit {

// ---------------------------------------------------------------------------
// Interval — a closed real interval [lo, hi] for range/AABB evaluation.
//
// Minimal interval arithmetic, just enough for the F-rep operations the tree
// needs: negate, add a scalar, hypot of three intervals (for distances), and
// interval min/max (for CSG). Every operation returns a CONSERVATIVE enclosure.
// ---------------------------------------------------------------------------
struct Interval {
    double lo = 0.0;
    double hi = 0.0;

    Interval() = default;
    Interval(double l, double h) : lo(l), hi(h) {}
    static Interval point(double v) { return {v, v}; }

    bool contains(double v) const { return v >= lo && v <= hi; }
    double width() const { return hi - lo; }
};

// ---------------------------------------------------------------------------
// A scalar value bundled with its gradient — the forward-AD pair the tree
// threads through every node. value == f(p), grad == ∇f(p).
// ---------------------------------------------------------------------------
struct ValueGrad {
    double value = 0.0;
    Vec3 grad{0.0, 0.0, 0.0};
};

// ---------------------------------------------------------------------------
// FRepNode — abstract base of the F-rep expression tree.
//
// Three evaluation modes, all const & thread-safe (nodes are immutable):
//   eval(p)        → f(p)                       (scalar value only)
//   evalGrad(p)    → {f(p), ∇f(p)}             (value + ANALYTIC gradient)
//   evalInterval(box) → [min f, max f] over box (conservative range)
//
// Nodes are shared via shared_ptr; build them with the factory functions on
// FRep below, never directly.
// ---------------------------------------------------------------------------
class FRepNode {
public:
    virtual ~FRepNode() = default;
    virtual double eval(const Vec3& p) const = 0;
    virtual ValueGrad evalGrad(const Vec3& p) const = 0;
    virtual Interval evalInterval(const Vec3& lo, const Vec3& hi) const = 0;
};

using FRepPtr = std::shared_ptr<const FRepNode>;

// ---------------------------------------------------------------------------
// FRep — value-semantics handle around an FRepPtr.
//
// Lets callers compose:  auto t = FRep::sphere(...) - FRep::box(...);
// Each operator returns a NEW FRep sharing operand subtrees.
//
// Construction validates parameters and sets ok()=false on degenerate input;
// composing onto an invalid handle yields an invalid handle (no exceptions).
// ---------------------------------------------------------------------------
class FRep {
public:
    FRep() = default;
    explicit FRep(FRepPtr node) : node_(std::move(node)) {}

    bool ok() const { return static_cast<bool>(node_); }
    const FRepPtr& node() const { return node_; }

    // Scalar field value. Returns 0 on an invalid handle (caller should check
    // ok()); the meshing / validation paths guard ok() up front.
    double eval(const Vec3& p) const;

    // Value + ANALYTIC gradient (chain rule through the tree). On an invalid
    // handle returns {0, {0,0,0}}.
    ValueGrad evalGrad(const Vec3& p) const;

    // Just the analytic gradient ∇f(p).
    Vec3 gradient(const Vec3& p) const { return evalGrad(p).grad; }

    // Conservative range of f over the AABB [lo, hi]. On an invalid handle
    // returns the empty/degenerate interval [0,0].
    Interval range(const Vec3& lo, const Vec3& hi) const;

    // AABB pruning verdict (sound, conservative):
    //   if range(lo,hi).lo > 0  → cell wholly OUTSIDE the solid (surface absent)
    //   if range(lo,hi).hi < 0  → cell wholly INSIDE the solid  (surface absent)
    //   otherwise               → cell MAY contain the surface
    enum class CellClass { Outside, Inside, Crossing };
    CellClass classify(const Vec3& lo, const Vec3& hi) const;

    // Bridge to the existing IsoMesher: build the equivalent SdfTree::Sdf for
    // this tree (so marching cubes can mesh it) and return it. Invalid handle →
    // an invalid Sdf.
    Sdf toSdf() const;

    // Convenience: mesh the zero-isosurface over a cubic grid via IsoMesher.
    // Empty mesh on an invalid handle.
    Mesh mesh(const Vec3& lo, const Vec3& hi, int n, double isovalue = 0.0) const;

    // ---- Primitives (factory functions) -----------------------------------

    // Sphere |p-c| - r. EXACT distance (|∇f|==1). ok()=false if r ≤ 0 or any
    // parameter is non-finite.
    static FRep sphere(const Vec3& center, double radius);

    // Axis-aligned box, center + full-extent size (half = size/2). Standard SDF
    // box: exterior exact, interior conservative Chebyshev bound. ok()=false if
    // any size component ≤ 0 or non-finite.
    static FRep box(const Vec3& center, const Vec3& size);

    // Plane half-space, f = dot(n̂,p) - offset (n normalised internally). EXACT
    // (|∇f|==1). ok()=false if |normal| == 0 or non-finite.
    static FRep plane(const Vec3& normal, double offset);

    // Z-axis-aligned finite cylinder: radius r, height h, centered at `center`,
    // axis along +z. Standard capped-cylinder SDF (exact exterior). ok()=false
    // if r ≤ 0, h ≤ 0, or non-finite.
    static FRep cylinder(const Vec3& center, double radius, double height);

    // ---- Operators --------------------------------------------------------

    static FRep unionOp(const FRep& a, const FRep& b);        // min(a,b)
    static FRep intersectionOp(const FRep& a, const FRep& b); // max(a,b)
    static FRep differenceOp(const FRep& a, const FRep& b);   // max(a,-b)

    // Smooth union (Quilez polynomial smin) with blend radius k > 0. k ≤ 0
    // degrades to the sharp min. The gradient is the analytic derivative of the
    // blended field.
    static FRep smoothUnionOp(const FRep& a, const FRep& b, double k);

private:
    FRepPtr node_;
};

// Operator sugar mirroring SdfTree.
inline FRep operator|(const FRep& a, const FRep& b) { return FRep::unionOp(a, b); }
inline FRep operator&(const FRep& a, const FRep& b) { return FRep::intersectionOp(a, b); }
inline FRep operator-(const FRep& a, const FRep& b) { return FRep::differenceOp(a, b); }

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_FREPTREE_HPP
