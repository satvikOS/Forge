// forge/native/implicit/SdfOps.cpp
//
// Implementation of the scalar SDF FIELD OPERATORS declared in
// forge/native/implicit/SdfOps.hpp. See the header for the exactness / honesty
// statement of each operator.
//
// Pure C++20. No external dependencies. Reuses ONLY implicit/SdfTree.hpp.

#include "forge/native/implicit/SdfOps.hpp"

#include <algorithm>   // std::max, std::min, std::clamp
#include <cmath>       // std::fabs, std::sin, std::cos, std::sqrt, std::isfinite
#include <memory>      // std::make_shared, std::shared_ptr
#include <string>      // std::string
#include <utility>     // std::move

namespace forge {
namespace native {
namespace implicit {

namespace {

// ===========================================================================
// VALUE-TRANSFORM nodes — re-map the scalar f(p) returned by the source field.
// ===========================================================================

// Offset / round: f'(p) = f(p) - d. (round is offset with the modeling intent
// of a positive radius; the arithmetic is identical, so one node serves both.)
class OffsetNode final : public SdfNode {
public:
    OffsetNode(SdfPtr src, double d) : src_(std::move(src)), d_(d) {}
    double eval(const Vec3& p) const override {
        return src_->eval(p) - d_;
    }
private:
    SdfPtr src_;
    double d_;
};

// Shell / hollow: f'(p) = |f(p)| - t/2. The wall straddles {f=0} by +/- t/2.
class ShellNode final : public SdfNode {
public:
    ShellNode(SdfPtr src, double half) : src_(std::move(src)), half_(half) {}
    double eval(const Vec3& p) const override {
        return std::fabs(src_->eval(p)) - half_;
    }
private:
    SdfPtr src_;
    double half_;   // = t/2
};

// ===========================================================================
// DOMAIN-WARP nodes — re-map the query point p, then evaluate the source.
// ===========================================================================

// Elongate (Quilez opElongate): split space along an axis-aligned slab of
// half-widths h and translate the two halves apart, stretching by 2*h per axis.
//   q  = p - clamp(p, -h, +h)
//   f' = f(q)
// EXACT on an exact source: each octant maps to a rigid translation of the
// source, so |grad| is preserved.
class ElongateNode final : public SdfNode {
public:
    ElongateNode(SdfPtr src, Vec3 h) : src_(std::move(src)), h_(h) {}
    double eval(const Vec3& p) const override {
        const Vec3 q{p.x - std::clamp(p.x, -h_.x, h_.x),
                     p.y - std::clamp(p.y, -h_.y, h_.y),
                     p.z - std::clamp(p.z, -h_.z, h_.z)};
        return src_->eval(q);
    }
private:
    SdfPtr src_;
    Vec3 h_;
};

// Twist about +z (Quilez opTwist): rotate (x,y) by angle k*z, leaving z.
//   c = cos(k*z), s = sin(k*z)
//   q = ( c*x - s*y , s*x + c*y , z )
//   f' = f(q)
// NON-isometric in the field sense (the warp is a z-dependent rotation, which
// is an isometry per slice but shears across slices) -> correct-sign BOUND.
class TwistNode final : public SdfNode {
public:
    TwistNode(SdfPtr src, double k) : src_(std::move(src)), k_(k) {}
    double eval(const Vec3& p) const override {
        const double a = k_ * p.z;
        const double c = std::cos(a), s = std::sin(a);
        const Vec3 q{c * p.x - s * p.y, s * p.x + c * p.y, p.z};
        return src_->eval(q);
    }
private:
    SdfPtr src_;
    double k_;
};

// Bend the +x axis about +z (Quilez opCheapBend): rotate (x,y) by angle k*x.
//   c = cos(k*x), s = sin(k*x)
//   q = ( c*x - s*y , s*x + c*y , z )
//   f' = f(q)
// NON-isometric -> correct-sign BOUND.
class BendNode final : public SdfNode {
public:
    BendNode(SdfPtr src, double k) : src_(std::move(src)), k_(k) {}
    double eval(const Vec3& p) const override {
        const double a = k_ * p.x;
        const double c = std::cos(a), s = std::sin(a);
        const Vec3 q{c * p.x - s * p.y, s * p.x + c * p.y, p.z};
        return src_->eval(q);
    }
private:
    SdfPtr src_;
    double k_;
};

// ===========================================================================
// SMOOTH-BLEND nodes — polynomial smin / smax (Quilez), C1 seam of width ~k.
// ===========================================================================

// Polynomial smooth-min: rounded min(a,b) over a band of width k>0.
//   h    = clamp(0.5 + 0.5*(b-a)/k, 0, 1)
//   smin = mix(b, a, h) - k*h*(1-h)        (== min(a,b) when |a-b| >= k)
// The subtracted bump rounds the seam; the result is 1-Lipschitz when a,b are.
inline double smin(double a, double b, double k) {
    double h = 0.5 + 0.5 * (b - a) / k;
    h = std::clamp(h, 0.0, 1.0);
    return (b * (1.0 - h) + a * h) - k * h * (1.0 - h);
}

// Polynomial smooth-max via smin: smax(a,b,k) = -smin(-a,-b,k). 1-Lipschitz.
inline double smax(double a, double b, double k) {
    return -smin(-a, -b, k);
}

// Smooth union: f' = smin(a, b, k). Rounded OR.
class SmoothUnionNode final : public SdfNode {
public:
    SmoothUnionNode(SdfPtr a, SdfPtr b, double k)
        : a_(std::move(a)), b_(std::move(b)), k_(k) {}
    double eval(const Vec3& p) const override {
        return smin(a_->eval(p), b_->eval(p), k_);
    }
private:
    SdfPtr a_, b_;
    double k_;
};

// Smooth subtraction: a AND NOT b == smax(a, -b, k). Rounded difference.
class SmoothSubNode final : public SdfNode {
public:
    SmoothSubNode(SdfPtr a, SdfPtr b, double k)
        : a_(std::move(a)), b_(std::move(b)), k_(k) {}
    double eval(const Vec3& p) const override {
        return smax(a_->eval(p), -b_->eval(p), k_);
    }
private:
    SdfPtr a_, b_;
    double k_;
};

} // namespace

// ===========================================================================
// Builders — value transforms
// ===========================================================================
OpResult SdfOps::offset(const Sdf& f, double d) {
    if (!f.valid())          return OpResult::failure("offset: empty source field");
    if (!std::isfinite(d))   return OpResult::failure("offset: distance d must be finite");
    return OpResult::success(Sdf(std::make_shared<OffsetNode>(f.node(), d)));
}

OpResult SdfOps::round(const Sdf& f, double r) {
    if (!f.valid())          return OpResult::failure("round: empty source field");
    if (!std::isfinite(r))   return OpResult::failure("round: radius r must be finite");
    if (r < 0.0)             return OpResult::failure("round: radius r must be >= 0");
    return OpResult::success(Sdf(std::make_shared<OffsetNode>(f.node(), r)));
}

OpResult SdfOps::shell(const Sdf& f, double t) {
    if (!f.valid())          return OpResult::failure("shell: empty source field");
    if (!std::isfinite(t))   return OpResult::failure("shell: thickness t must be finite");
    if (!(t > 0.0))          return OpResult::failure("shell: thickness t must be > 0");
    return OpResult::success(Sdf(std::make_shared<ShellNode>(f.node(), t * 0.5)));
}

// ===========================================================================
// Builders — domain warps
// ===========================================================================
OpResult SdfOps::elongate(const Sdf& f, const Vec3& h) {
    if (!f.valid())          return OpResult::failure("elongate: empty source field");
    if (!(std::isfinite(h.x) && std::isfinite(h.y) && std::isfinite(h.z)))
        return OpResult::failure("elongate: half-widths must be finite");
    if (h.x < 0.0 || h.y < 0.0 || h.z < 0.0)
        return OpResult::failure("elongate: half-widths must be >= 0");
    return OpResult::success(Sdf(std::make_shared<ElongateNode>(f.node(), h)));
}

OpResult SdfOps::twist(const Sdf& f, double k) {
    if (!f.valid())          return OpResult::failure("twist: empty source field");
    if (!std::isfinite(k))   return OpResult::failure("twist: rate k must be finite");
    return OpResult::success(Sdf(std::make_shared<TwistNode>(f.node(), k)));
}

OpResult SdfOps::bend(const Sdf& f, double k) {
    if (!f.valid())          return OpResult::failure("bend: empty source field");
    if (!std::isfinite(k))   return OpResult::failure("bend: curvature k must be finite");
    return OpResult::success(Sdf(std::make_shared<BendNode>(f.node(), k)));
}

// ===========================================================================
// Builders — smooth blends
// ===========================================================================
OpResult SdfOps::smoothUnion(const Sdf& a, const Sdf& b, double k) {
    if (!a.valid() || !b.valid())
        return OpResult::failure("smoothUnion: empty operand");
    if (!std::isfinite(k))   return OpResult::failure("smoothUnion: blend radius k must be finite");
    if (!(k > 0.0))          return OpResult::failure("smoothUnion: blend radius k must be > 0");
    return OpResult::success(Sdf(std::make_shared<SmoothUnionNode>(a.node(), b.node(), k)));
}

OpResult SdfOps::smoothSub(const Sdf& a, const Sdf& b, double k) {
    if (!a.valid() || !b.valid())
        return OpResult::failure("smoothSub: empty operand");
    if (!std::isfinite(k))   return OpResult::failure("smoothSub: blend radius k must be finite");
    if (!(k > 0.0))          return OpResult::failure("smoothSub: blend radius k must be > 0");
    return OpResult::success(Sdf(std::make_shared<SmoothSubNode>(a.node(), b.node(), k)));
}

} // namespace implicit
} // namespace native
} // namespace forge
