// forge/native/implicit/FRepTree.cpp
//
// Implementation of the F-rep CSG tree declared in FRepTree.hpp.
//
// Each node implements three modes:
//   eval         — scalar f(p)
//   evalGrad     — {f(p), ∇f(p)} via the CHAIN RULE (forward-mode AD over x,y,z)
//   evalInterval — conservative range [min f, max f] over an AABB
//
// And the whole tree can be re-expressed as an SdfTree::Sdf (toSdf) so the
// existing IsoMesher (marching cubes) meshes it — no mesher is re-implemented.
//
// Pure C++20. No external dependencies.

#include "forge/native/implicit/FRepTree.hpp"

#include <algorithm>
#include <cmath>

namespace forge {
namespace native {
namespace implicit {

namespace {

// ---- small helpers --------------------------------------------------------

inline bool finite(double v) { return std::isfinite(v); }
inline bool finite(const Vec3& v) { return finite(v.x) && finite(v.y) && finite(v.z); }

// Interval arithmetic primitives (conservative enclosures).

inline Interval iadd(const Interval& a, double s) { return {a.lo + s, a.hi + s}; }
inline Interval ineg(const Interval& a) { return {-a.hi, -a.lo}; }
inline Interval imin(const Interval& a, const Interval& b) {
    return {std::min(a.lo, b.lo), std::min(a.hi, b.hi)};
}
inline Interval imax(const Interval& a, const Interval& b) {
    return {std::max(a.lo, b.lo), std::max(a.hi, b.hi)};
}
// Interval of |t| for t in [lo,hi].
inline Interval iabs(const Interval& a) {
    if (a.lo >= 0.0) return a;
    if (a.hi <= 0.0) return {-a.hi, -a.lo};
    return {0.0, std::max(-a.lo, a.hi)};
}
// Interval of t*t for t in [lo,hi]  (square is monotone in |t|).
inline Interval isquare(const Interval& a) {
    const Interval m = iabs(a);
    return {m.lo * m.lo, m.hi * m.hi};
}
// One coordinate's interval over the AABB: [lo_i - c_i, hi_i - c_i] style is the
// caller's job; here we just expose per-axis spans.
inline Interval axisSpan(double lo, double hi) { return {lo, hi}; }

// Conservative interval for the Euclidean length of a vector each of whose
// components lies in the given interval. length = sqrt(x^2+y^2+z^2); square is
// monotone so we sum the per-axis square enclosures and sqrt the bounds.
inline Interval ilength3(const Interval& ix, const Interval& iy, const Interval& iz) {
    const Interval sx = isquare(ix);
    const Interval sy = isquare(iy);
    const Interval sz = isquare(iz);
    const double loSum = sx.lo + sy.lo + sz.lo;
    const double hiSum = sx.hi + sy.hi + sz.hi;
    return {std::sqrt(std::max(0.0, loSum)), std::sqrt(std::max(0.0, hiSum))};
}
inline Interval ilength2(const Interval& ix, const Interval& iy) {
    const Interval sx = isquare(ix);
    const Interval sy = isquare(iy);
    return {std::sqrt(std::max(0.0, sx.lo + sy.lo)),
            std::sqrt(std::max(0.0, sx.hi + sy.hi))};
}

// =========================================================================
// Primitive nodes
// =========================================================================

class SphereNode final : public FRepNode {
public:
    SphereNode(Vec3 c, double r) : c_(c), r_(r) {}
    double eval(const Vec3& p) const override {
        return length(p - c_) - r_;
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        // f = |p-c| - r ;  ∇f = (p-c)/|p-c|  (unit, |∇f|==1 off the center).
        const Vec3 d = p - c_;
        const double L = length(d);
        ValueGrad vg;
        vg.value = L - r_;
        if (L > 0.0) vg.grad = d * (1.0 / L);
        else vg.grad = {0.0, 0.0, 0.0}; // center: gradient undefined → 0
        return vg;
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        const Interval ix = iadd(axisSpan(lo.x, hi.x), -c_.x);
        const Interval iy = iadd(axisSpan(lo.y, hi.y), -c_.y);
        const Interval iz = iadd(axisSpan(lo.z, hi.z), -c_.z);
        return iadd(ilength3(ix, iy, iz), -r_);
    }
private:
    Vec3 c_;
    double r_;
};

class PlaneNode final : public FRepNode {
public:
    PlaneNode(Vec3 n, double offset) : n_(n), off_(offset) {}
    double eval(const Vec3& p) const override { return dot(n_, p) - off_; }
    ValueGrad evalGrad(const Vec3& p) const override {
        // f = n·p - off ;  ∇f = n  (constant unit vector).
        return {dot(n_, p) - off_, n_};
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        // n·p over the box: extremes at the corner aligned with sign(n_i).
        double mn = -off_, mx = -off_;
        auto axis = [&](double ni, double a, double b) {
            const double t0 = ni * a, t1 = ni * b;
            mn += std::min(t0, t1);
            mx += std::max(t0, t1);
        };
        axis(n_.x, lo.x, hi.x);
        axis(n_.y, lo.y, hi.y);
        axis(n_.z, lo.z, hi.z);
        return {mn, mx};
    }
private:
    Vec3 n_;   // unit
    double off_;
};

class BoxNode final : public FRepNode {
public:
    BoxNode(Vec3 c, Vec3 half) : c_(c), h_(half) {}
    double eval(const Vec3& p) const override {
        const Vec3 d = p - c_;
        const Vec3 q{std::fabs(d.x) - h_.x, std::fabs(d.y) - h_.y, std::fabs(d.z) - h_.z};
        const Vec3 qp{std::max(q.x, 0.0), std::max(q.y, 0.0), std::max(q.z, 0.0)};
        const double outside = length(qp);
        const double inside = std::min(std::max(q.x, std::max(q.y, q.z)), 0.0);
        return outside + inside;
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        // Standard SDF box (Quilez). Differentiate the two branches.
        const Vec3 d = p - c_;
        const double sx = (d.x >= 0.0) ? 1.0 : -1.0; // d/dp of |d| = sign(d)
        const double sy = (d.y >= 0.0) ? 1.0 : -1.0;
        const double sz = (d.z >= 0.0) ? 1.0 : -1.0;
        const Vec3 q{std::fabs(d.x) - h_.x, std::fabs(d.y) - h_.y, std::fabs(d.z) - h_.z};
        const Vec3 qp{std::max(q.x, 0.0), std::max(q.y, 0.0), std::max(q.z, 0.0)};
        const double outside = length(qp);
        const double qmax = std::max(q.x, std::max(q.y, q.z));
        const double inside = std::min(qmax, 0.0);

        ValueGrad vg;
        vg.value = outside + inside;

        Vec3 g{0.0, 0.0, 0.0};
        if (outside > 0.0) {
            // ∇outside = (qp / |qp|) ⊙ sign(d)   (only positive-q axes contribute)
            const Vec3 dir = qp * (1.0 / outside);
            g.x += dir.x * sx;
            g.y += dir.y * sy;
            g.z += dir.z * sz;
        } else {
            // Interior branch active (qmax ≤ 0): ∇ = sign(d) on the axis whose q
            // is the maximum (the controlling face), 0 elsewhere.
            if (qmax == q.x) g.x = sx;
            else if (qmax == q.y) g.y = sy;
            else g.z = sz;
        }
        vg.grad = g;
        return vg;
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        // q_i = |p_i - c_i| - h_i over the box, per axis.
        const Interval qx = iadd(iabs(iadd(axisSpan(lo.x, hi.x), -c_.x)), -h_.x);
        const Interval qy = iadd(iabs(iadd(axisSpan(lo.y, hi.y), -c_.y)), -h_.y);
        const Interval qz = iadd(iabs(iadd(axisSpan(lo.z, hi.z), -c_.z)), -h_.z);
        // outside = | max(q,0) | (length of clamped-positive q)
        const Interval qxp{std::max(qx.lo, 0.0), std::max(qx.hi, 0.0)};
        const Interval qyp{std::max(qy.lo, 0.0), std::max(qy.hi, 0.0)};
        const Interval qzp{std::max(qz.lo, 0.0), std::max(qz.hi, 0.0)};
        const Interval outside = ilength3(qxp, qyp, qzp);
        // inside = min(max(qx,qy,qz), 0)
        const Interval qmax = imax(imax(qx, qy), qz);
        const Interval inside{std::min(qmax.lo, 0.0), std::min(qmax.hi, 0.0)};
        // f = outside + inside (the two branches are mutually exclusive in value
        // but summing the conservative enclosures is still a sound bound).
        return {outside.lo + inside.lo, outside.hi + inside.hi};
    }
private:
    Vec3 c_, h_;
};

class CylinderNode final : public FRepNode {
public:
    // Z-axis capped cylinder, radius r, half-height hh, centered at c.
    CylinderNode(Vec3 c, double r, double hh) : c_(c), r_(r), hh_(hh) {}
    double eval(const Vec3& p) const override {
        const Vec3 d = p - c_;
        const double radial = std::sqrt(d.x * d.x + d.y * d.y) - r_; // dx
        const double axial = std::fabs(d.z) - hh_;                   // dy
        const double dx = radial, dy = axial;
        const double outside =
            std::sqrt(std::max(dx, 0.0) * std::max(dx, 0.0) +
                      std::max(dy, 0.0) * std::max(dy, 0.0));
        const double inside = std::min(std::max(dx, dy), 0.0);
        return outside + inside;
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        // Standard 2D-distance capped-cylinder SDF in (radial, axial) coords.
        const Vec3 d = p - c_;
        const double rho = std::sqrt(d.x * d.x + d.y * d.y);
        const double dx = rho - r_;            // radial distance to side
        const double dz = (d.z >= 0.0) ? 1.0 : -1.0;
        const double dy = std::fabs(d.z) - hh_; // axial distance to cap
        // d(rho)/dp = (d.x, d.y, 0)/rho ; chain through dx, dy.
        Vec3 gRadial{0.0, 0.0, 0.0};
        if (rho > 0.0) gRadial = Vec3{d.x / rho, d.y / rho, 0.0};
        const Vec3 gAxial{0.0, 0.0, dz};

        ValueGrad vg;
        const double pdx = std::max(dx, 0.0);
        const double pdy = std::max(dy, 0.0);
        const double outside = std::sqrt(pdx * pdx + pdy * pdy);
        const double inside = std::min(std::max(dx, dy), 0.0);
        vg.value = outside + inside;

        Vec3 g{0.0, 0.0, 0.0};
        if (outside > 0.0) {
            // ∇outside = (pdx·∇dx + pdy·∇dy)/outside
            const double inv = 1.0 / outside;
            g = (gRadial * (pdx * inv)) + (gAxial * (pdy * inv));
        } else {
            // interior: ∇ follows the controlling (larger) of dx, dy
            if (dx >= dy) g = gRadial; else g = gAxial;
        }
        vg.grad = g;
        return vg;
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        const Interval ix = iadd(axisSpan(lo.x, hi.x), -c_.x);
        const Interval iy = iadd(axisSpan(lo.y, hi.y), -c_.y);
        const Interval iz = iadd(axisSpan(lo.z, hi.z), -c_.z);
        const Interval dx = iadd(ilength2(ix, iy), -r_);    // radial
        const Interval dy = iadd(iabs(iz), -hh_);           // axial
        const Interval dxp{std::max(dx.lo, 0.0), std::max(dx.hi, 0.0)};
        const Interval dyp{std::max(dy.lo, 0.0), std::max(dy.hi, 0.0)};
        // outside = sqrt(dxp^2 + dyp^2)
        const Interval sx = isquare(dxp);
        const Interval sy = isquare(dyp);
        const Interval outside{std::sqrt(std::max(0.0, sx.lo + sy.lo)),
                               std::sqrt(std::max(0.0, sx.hi + sy.hi))};
        const Interval mx = imax(dx, dy);
        const Interval inside{std::min(mx.lo, 0.0), std::min(mx.hi, 0.0)};
        return {outside.lo + inside.lo, outside.hi + inside.hi};
    }
private:
    Vec3 c_;
    double r_, hh_;
};

// =========================================================================
// Operator nodes
// =========================================================================

class UnionNode final : public FRepNode {
public:
    UnionNode(FRepPtr a, FRepPtr b) : a_(std::move(a)), b_(std::move(b)) {}
    double eval(const Vec3& p) const override {
        return std::min(a_->eval(p), b_->eval(p));
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        // f = min(a,b) ; ∇f is the gradient of whichever branch is the minimum.
        const ValueGrad va = a_->evalGrad(p);
        const ValueGrad vb = b_->evalGrad(p);
        return (va.value <= vb.value) ? va : vb;
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        return imin(a_->evalInterval(lo, hi), b_->evalInterval(lo, hi));
    }
private:
    FRepPtr a_, b_;
};

class IntersectionNode final : public FRepNode {
public:
    IntersectionNode(FRepPtr a, FRepPtr b) : a_(std::move(a)), b_(std::move(b)) {}
    double eval(const Vec3& p) const override {
        return std::max(a_->eval(p), b_->eval(p));
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        const ValueGrad va = a_->evalGrad(p);
        const ValueGrad vb = b_->evalGrad(p);
        return (va.value >= vb.value) ? va : vb;
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        return imax(a_->evalInterval(lo, hi), b_->evalInterval(lo, hi));
    }
private:
    FRepPtr a_, b_;
};

class DifferenceNode final : public FRepNode {
public:
    DifferenceNode(FRepPtr a, FRepPtr b) : a_(std::move(a)), b_(std::move(b)) {}
    double eval(const Vec3& p) const override {
        return std::max(a_->eval(p), -b_->eval(p));
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        // f = max(a, -b). The -b branch contributes gradient -∇b.
        const ValueGrad va = a_->evalGrad(p);
        ValueGrad vb = b_->evalGrad(p);
        const double negB = -vb.value;
        if (va.value >= negB) return va;
        return {negB, vb.grad * (-1.0)};
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        return imax(a_->evalInterval(lo, hi), ineg(b_->evalInterval(lo, hi)));
    }
private:
    FRepPtr a_, b_;
};

class SmoothUnionNode final : public FRepNode {
public:
    SmoothUnionNode(FRepPtr a, FRepPtr b, double k)
        : a_(std::move(a)), b_(std::move(b)), k_(k) {}
    double eval(const Vec3& p) const override {
        const double a = a_->eval(p);
        const double b = b_->eval(p);
        if (k_ <= 0.0) return std::min(a, b);
        double h = std::clamp(0.5 + 0.5 * (b - a) / k_, 0.0, 1.0);
        return (b * (1.0 - h) + a * h) - k_ * h * (1.0 - h);
    }
    ValueGrad evalGrad(const Vec3& p) const override {
        const ValueGrad va = a_->evalGrad(p);
        const ValueGrad vb = b_->evalGrad(p);
        const double a = va.value, b = vb.value;
        if (k_ <= 0.0) return (a <= b) ? va : vb;
        const double h = std::clamp(0.5 + 0.5 * (b - a) / k_, 0.0, 1.0);
        ValueGrad vg;
        vg.value = (b * (1.0 - h) + a * h) - k_ * h * (1.0 - h);
        // ENVELOPE THEOREM (see header / .hpp note): at interior h the explicit
        // h-dependence of f has zero derivative, so ∇f = h·∇a + (1-h)·∇b holds
        // for all h (including the clamped boundaries where h is locally const).
        vg.grad = (va.grad * h) + (vb.grad * (1.0 - h));
        return vg;
    }
    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        // The smooth union lies BELOW the sharp min by at most k/4 (the maximum
        // of k·h·(1-h) over h∈[0,1]) and never above it. A sound enclosure:
        //   [min(A,B).lo - k/4 , min(A,B).hi]
        const Interval ia = a_->evalInterval(lo, hi);
        const Interval ib = b_->evalInterval(lo, hi);
        const Interval m = imin(ia, ib);
        const double bump = (k_ > 0.0) ? 0.25 * k_ : 0.0;
        return {m.lo - bump, m.hi};
    }
private:
    FRepPtr a_, b_;
    double k_;
};

} // namespace

// ===========================================================================
// FRep handle
// ===========================================================================
double FRep::eval(const Vec3& p) const {
    if (!node_) return 0.0;
    return node_->eval(p);
}

ValueGrad FRep::evalGrad(const Vec3& p) const {
    if (!node_) return ValueGrad{};
    return node_->evalGrad(p);
}

Interval FRep::range(const Vec3& lo, const Vec3& hi) const {
    if (!node_) return Interval{0.0, 0.0};
    return node_->evalInterval(lo, hi);
}

FRep::CellClass FRep::classify(const Vec3& lo, const Vec3& hi) const {
    const Interval r = range(lo, hi);
    if (r.lo > 0.0) return CellClass::Outside;
    if (r.hi < 0.0) return CellClass::Inside;
    return CellClass::Crossing;
}

// ---- Primitive factories --------------------------------------------------
FRep FRep::sphere(const Vec3& center, double radius) {
    if (!finite(center) || !finite(radius) || radius <= 0.0) return FRep{};
    return FRep(std::make_shared<SphereNode>(center, radius));
}

FRep FRep::box(const Vec3& center, const Vec3& size) {
    if (!finite(center) || !finite(size) ||
        size.x <= 0.0 || size.y <= 0.0 || size.z <= 0.0)
        return FRep{};
    return FRep(std::make_shared<BoxNode>(
        center, Vec3{size.x * 0.5, size.y * 0.5, size.z * 0.5}));
}

FRep FRep::plane(const Vec3& normal, double offset) {
    if (!finite(normal) || !finite(offset)) return FRep{};
    const double L = length(normal);
    if (!(L > 0.0)) return FRep{};
    const Vec3 n = normal * (1.0 / L);
    return FRep(std::make_shared<PlaneNode>(n, offset / L));
}

FRep FRep::cylinder(const Vec3& center, double radius, double height) {
    if (!finite(center) || !finite(radius) || !finite(height) ||
        radius <= 0.0 || height <= 0.0)
        return FRep{};
    return FRep(std::make_shared<CylinderNode>(center, radius, height * 0.5));
}

// ---- Operator factories ---------------------------------------------------
FRep FRep::unionOp(const FRep& a, const FRep& b) {
    if (!a.ok() || !b.ok()) return FRep{};
    return FRep(std::make_shared<UnionNode>(a.node(), b.node()));
}

FRep FRep::intersectionOp(const FRep& a, const FRep& b) {
    if (!a.ok() || !b.ok()) return FRep{};
    return FRep(std::make_shared<IntersectionNode>(a.node(), b.node()));
}

FRep FRep::differenceOp(const FRep& a, const FRep& b) {
    if (!a.ok() || !b.ok()) return FRep{};
    return FRep(std::make_shared<DifferenceNode>(a.node(), b.node()));
}

FRep FRep::smoothUnionOp(const FRep& a, const FRep& b, double k) {
    if (!a.ok() || !b.ok() || !finite(k)) return FRep{};
    return FRep(std::make_shared<SmoothUnionNode>(a.node(), b.node(), k));
}

// ===========================================================================
// Bridge to the existing IsoMesher via SdfTree
//
// IsoMesher consumes an SdfTree::Sdf and only ever calls eval(p) on it. We wrap
// the whole F-rep tree in a tiny SdfNode adapter that forwards eval(p) verbatim,
// so the (separately-validated) marching-cubes mesher meshes our field exactly —
// including the cylinder, which SdfTree has no native primitive for. No mesher
// and no field is re-implemented.
// ===========================================================================
namespace {

// Adapter: expose any FRepNode as an SdfTree::SdfNode (value only — the mesher
// needs eval(p) alone). This lets the cylinder (and indeed any subtree) feed the
// existing marching cubes without re-implementing it.
class FRepAsSdfNode final : public SdfNode {
public:
    explicit FRepAsSdfNode(FRepPtr n) : n_(std::move(n)) {}
    double eval(const Vec3& p) const override { return n_->eval(p); }
private:
    FRepPtr n_;
};

} // namespace

Sdf FRep::toSdf() const {
    if (!node_) return Sdf{};
    // A single adapter over the whole tree is sufficient and exact for meshing:
    // IsoMesher only samples eval(p), which the adapter forwards verbatim.
    return Sdf(std::make_shared<FRepAsSdfNode>(node_));
}

Mesh FRep::mesh(const Vec3& lo, const Vec3& hi, int n, double isovalue) const {
    if (!node_ || n < 1) return Mesh{};
    return IsoMesher::marchCubic(toSdf(), lo, hi, n, isovalue);
}

} // namespace implicit
} // namespace native
} // namespace forge
