// forge/math/Transform.hpp — canonical native affine transform for forge::math.
//
// A Transform is a general affine map p' = A·p + t: a 3x3 linear part `linear`
// (a Mat3) plus a `translation` (Vec3). Because the linear part is an ARBITRARY
// Mat3, this expresses NON-UNIFORM scale and shear — the native equivalent of
// gp_GTrsf — so e.g. sphere → ellipsoid (diag(rx,ry,rz)) is representable, which
// the rigid-only brep::RigidTransform cannot do. It also generalises gp_Trsf
// (the rigid + uniform-scale subset): a rigid transform is just this with an
// orthonormal `linear`, and `rigid()` / the transpose fast-path serve that case.
//
// ADDITIVE, header-only, namespace forge::math. Depends on Vec3 + Mat3 (+ Axis
// for the axis-rotation factory) + <cmath>.

#ifndef FORGE_MATH_TRANSFORM_HPP
#define FORGE_MATH_TRANSFORM_HPP

#include <cmath>

#include "forge/math/Vec3.hpp"
#include "forge/math/Mat3.hpp"
#include "forge/math/Axis.hpp"

namespace forge {
namespace math {

struct Transform {
    Mat3 linear = Mat3::identity();   // general 3x3 (rotation / scale / shear)
    Vec3 translation{0, 0, 0};

    Transform() = default;
    Transform(const Mat3& lin, const Vec3& t) : linear(lin), translation(t) {}

    static Transform identity() { return Transform{}; }

    // ── factories ─────────────────────────────────────────────────────────────
    static Transform translationOf(const Vec3& t) { return Transform{Mat3::identity(), t}; }

    // NON-UNIFORM scale about the origin — this is what a rigid transform cannot
    // express (sphere → ellipsoid). gp_GTrsf territory.
    static Transform scaling(double sx, double sy, double sz) {
        return Transform{Mat3::diagonal(sx, sy, sz), Vec3{0, 0, 0}};
    }
    static Transform uniformScaling(double s) { return scaling(s, s, s); }

    // Rigid: rotation about an axis through the origin by `angle`, then translate.
    static Transform rotation(const Vec3& axis, double angle, const Vec3& t = {}) {
        return Transform{Mat3::fromAxisAngle(axis, angle), t};
    }
    // Rigid: rotation about an arbitrary line (Ax1) by `angle`. Keeps points ON
    // the line fixed: p' = O + R·(p−O) = R·p + (O − R·O).
    static Transform rotationAbout(const Ax1& line, double angle) {
        Mat3 R = Mat3::fromAxisAngle(line.direction, angle);
        return Transform{R, line.location - R * line.location};
    }
    // Rigid from an explicit orthonormal rotation + translation.
    static Transform rigid(const Mat3& rot, const Vec3& t) { return Transform{rot, t}; }

    // ── apply ─────────────────────────────────────────────────────────────────
    // POINT: full affine map (translation included).
    Vec3 transformPoint(const Vec3& p) const { return linear * p + translation; }
    // VECTOR / DIRECTION: linear part only (no translation). NOTE: under a
    // non-uniform linear part a direction is NOT length-preserving — normalise
    // downstream if a unit direction is required (matches gp_GTrsf semantics).
    Vec3 transformVec(const Vec3& v) const { return linear * v; }

    // Convenience call-operator applies to a POINT.
    Vec3 operator*(const Vec3& p) const { return transformPoint(p); }

    // ── compose ───────────────────────────────────────────────────────────────
    // (this ∘ other): apply `other` first, then `this`.
    //   (A∘B)(p) = A(B(p)) = A.linear·(B.linear·p + B.t) + A.t
    Transform compose(const Transform& other) const {
        return Transform{linear * other.linear,
                         linear * other.translation + translation};
    }
    Transform operator*(const Transform& other) const { return compose(other); }

    double determinant() const { return linear.determinant(); }
    // Proper (orientation-preserving) iff det > 0; a reflection (mirror) has det<0.
    bool isProper() const { return determinant() > 0.0; }

    // Orthonormal linear part (a rigid / uniform-rotation transform) ⇒ the fast
    // inverse below (transpose) is valid. Tolerance is on Aᵀ·A ≈ I.
    bool isRigid(double tol = 1e-9) const {
        Mat3 g = linear.transpose() * linear;
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j) {
                double expect = (i == j) ? 1.0 : 0.0;
                if (std::fabs(g.m[3 * i + j] - expect) > tol) return false;
            }
        return true;
    }

    // General inverse via the Mat3 inverse. Returns false (out untouched) if the
    // linear part is singular.  p = A·q + t  ⇒  q = A⁻¹·(p − t) = A⁻¹·p − A⁻¹·t.
    bool inverse(Transform& out) const {
        Mat3 inv;
        if (!linear.inverse(inv)) return false;
        out.linear = inv;
        out.translation = -(inv * translation);
        return true;
    }

    // FAST rigid-only inverse: assumes an orthonormal linear part so A⁻¹ = Aᵀ.
    // (Caller guarantees rigidity — check isRigid() if unsure.)
    Transform rigidInverse() const {
        Mat3 rt = linear.transpose();
        return Transform{rt, -(rt * translation)};
    }
};

} // namespace math
} // namespace forge

#endif // FORGE_MATH_TRANSFORM_HPP
