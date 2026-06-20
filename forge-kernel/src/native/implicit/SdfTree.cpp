// forge/native/implicit/SdfTree.cpp
//
// Implementation of the SDF expression tree declared in
// forge/native/implicit/SdfTree.hpp. See the header for the honesty / exactness
// statement. Each primitive documents the closed-form distance it realises.
//
// Pure C++20. No external dependencies.

#include "forge/native/implicit/SdfTree.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace forge {
namespace native {
namespace implicit {

double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

double length(const Vec3& v) {
    return std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// ---------------------------------------------------------------------------
// Sdf handle
// ---------------------------------------------------------------------------
double Sdf::eval(const Vec3& p) const {
    if (!node_) throw std::runtime_error("Sdf::eval on empty handle");
    return node_->eval(p);
}

Vec3 Sdf::gradient(const Vec3& p, double h) const {
    // Central differences of the scalar field — the SDF's gradient points along
    // the outward surface normal. For an exact distance field |grad| == 1, but
    // we do NOT rely on that for CSG/smooth fields, so we return the raw grad.
    const double dx = eval({p.x + h, p.y, p.z}) - eval({p.x - h, p.y, p.z});
    const double dy = eval({p.x, p.y + h, p.z}) - eval({p.x, p.y - h, p.z});
    const double dz = eval({p.x, p.y, p.z + h}) - eval({p.x, p.y, p.z - h});
    return {dx / (2 * h), dy / (2 * h), dz / (2 * h)};
}

// ---------------------------------------------------------------------------
// Primitive nodes
// ---------------------------------------------------------------------------
namespace {

class SphereNode final : public SdfNode {
public:
    SphereNode(Vec3 c, double r) : center_(c), radius_(r) {}
    double eval(const Vec3& p) const override {
        // EXACT signed distance to a sphere: |p - c| - r.
        return length(p - center_) - radius_;
    }
private:
    Vec3 center_;
    double radius_;
};

class BoxNode final : public SdfNode {
public:
    BoxNode(Vec3 c, Vec3 half) : center_(c), half_(half) {}
    double eval(const Vec3& p) const override {
        // Standard SDF box (Quilez). q = |p-c| - half.
        //   exterior distance = |max(q,0)|         (EXACT)
        //   interior distance = min(max(qx,qy,qz),0) (conservative Chebyshev
        //                                             under-estimate, see header)
        const Vec3 d = p - center_;
        const Vec3 q{std::fabs(d.x) - half_.x,
                     std::fabs(d.y) - half_.y,
                     std::fabs(d.z) - half_.z};
        const Vec3 qpos{std::max(q.x, 0.0), std::max(q.y, 0.0), std::max(q.z, 0.0)};
        const double outside = length(qpos);
        const double inside = std::min(std::max(q.x, std::max(q.y, q.z)), 0.0);
        return outside + inside;
    }
private:
    Vec3 center_;
    Vec3 half_;
};

class PlaneNode final : public SdfNode {
public:
    PlaneNode(Vec3 n, double offset) : n_(n), offset_(offset) {
        // Normalise so the field is an exact distance (|grad| == 1).
        const double L = length(n_);
        if (L > 0) {
            n_ = n_ * (1.0 / L);
            offset_ /= L;
        }
    }
    double eval(const Vec3& p) const override {
        // EXACT signed distance to a plane: dot(n,p) - offset, n unit.
        return dot(n_, p) - offset_;
    }
private:
    Vec3 n_;
    double offset_;
};

// ---------------------------------------------------------------------------
// Operator nodes
// ---------------------------------------------------------------------------
class UnionNode final : public SdfNode {
public:
    UnionNode(SdfPtr a, SdfPtr b) : a_(std::move(a)), b_(std::move(b)) {}
    double eval(const Vec3& p) const override {
        return std::min(a_->eval(p), b_->eval(p));
    }
private:
    SdfPtr a_, b_;
};

class IntersectionNode final : public SdfNode {
public:
    IntersectionNode(SdfPtr a, SdfPtr b) : a_(std::move(a)), b_(std::move(b)) {}
    double eval(const Vec3& p) const override {
        return std::max(a_->eval(p), b_->eval(p));
    }
private:
    SdfPtr a_, b_;
};

class DifferenceNode final : public SdfNode {
public:
    DifferenceNode(SdfPtr a, SdfPtr b) : a_(std::move(a)), b_(std::move(b)) {}
    double eval(const Vec3& p) const override {
        // A AND NOT B  ->  max(a, -b).
        return std::max(a_->eval(p), -b_->eval(p));
    }
private:
    SdfPtr a_, b_;
};

class SmoothUnionNode final : public SdfNode {
public:
    SmoothUnionNode(SdfPtr a, SdfPtr b, double k)
        : a_(std::move(a)), b_(std::move(b)), k_(k) {}
    double eval(const Vec3& p) const override {
        // Polynomial smooth-min (Quilez):
        //   h = clamp(0.5 + 0.5*(b-a)/k, 0, 1)
        //   smin = mix(b, a, h) - k*h*(1-h)
        // As k -> 0 this converges to min(a,b). The subtracted bump rounds the
        // seam, producing a blended (non-sharp) surface. NOT an exact distance.
        const double a = a_->eval(p);
        const double b = b_->eval(p);
        if (k_ <= 0.0) return std::min(a, b);
        double h = 0.5 + 0.5 * (b - a) / k_;
        h = std::clamp(h, 0.0, 1.0);
        // mix(b, a, h) = b*(1-h) + a*h
        return (b * (1.0 - h) + a * h) - k_ * h * (1.0 - h);
    }
private:
    SdfPtr a_, b_;
    double k_;
};

} // namespace

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------
Sdf sphere(const Vec3& center, double radius) {
    return Sdf(std::make_shared<SphereNode>(center, radius));
}

Sdf box(const Vec3& center, const Vec3& size) {
    return Sdf(std::make_shared<BoxNode>(center, Vec3{size.x * 0.5, size.y * 0.5, size.z * 0.5}));
}

Sdf plane(const Vec3& normal, double offset) {
    return Sdf(std::make_shared<PlaneNode>(normal, offset));
}

static void requireValid(const Sdf& a, const Sdf& b, const char* op) {
    if (!a.valid() || !b.valid())
        throw std::runtime_error(std::string("forge::native::implicit: empty operand to ") + op);
}

Sdf unionOp(const Sdf& a, const Sdf& b) {
    requireValid(a, b, "unionOp");
    return Sdf(std::make_shared<UnionNode>(a.node(), b.node()));
}

Sdf intersectionOp(const Sdf& a, const Sdf& b) {
    requireValid(a, b, "intersectionOp");
    return Sdf(std::make_shared<IntersectionNode>(a.node(), b.node()));
}

Sdf differenceOp(const Sdf& a, const Sdf& b) {
    requireValid(a, b, "differenceOp");
    return Sdf(std::make_shared<DifferenceNode>(a.node(), b.node()));
}

Sdf smoothUnionOp(const Sdf& a, const Sdf& b, double k) {
    requireValid(a, b, "smoothUnionOp");
    return Sdf(std::make_shared<SmoothUnionNode>(a.node(), b.node(), k));
}

} // namespace implicit
} // namespace native
} // namespace forge
