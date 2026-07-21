// forge/math/Quaternion.hpp — canonical native Hamilton quaternion for
// forge::math. Native equivalent of gp_Quaternion (currently only file-local
// helpers exist, e.g. the in-house Hamilton sandwich product in MateLibrary.cpp
// that replaced gp_Quaternion::Multiply under OCCT_ZERO_ROADMAP W2.2).
//
// Storage & convention are (w, x, y, z) — scalar-first — EXACTLY matching that
// existing in-house helper so the two agree bit-for-bit and can share this type.
//
// ADDITIVE, header-only, namespace forge::math. Depends on Vec3 + Mat3 + <cmath>.

#ifndef FORGE_MATH_QUATERNION_HPP
#define FORGE_MATH_QUATERNION_HPP

#include <cmath>

#include "forge/math/Vec3.hpp"
#include "forge/math/Mat3.hpp"

namespace forge {
namespace math {

struct Quaternion {
    double w = 1.0, x = 0.0, y = 0.0, z = 0.0;   // scalar-first (w,x,y,z)

    Quaternion() = default;
    constexpr Quaternion(double w_, double x_, double y_, double z_)
        : w(w_), x(x_), y(y_), z(z_) {}

    static Quaternion identity() { return Quaternion{1, 0, 0, 0}; }

    // Build from an axis-angle. `axis` need not be unit; a (near-)zero axis or
    // zero angle yields the identity. Matches MateLibrary::quatFromAxisAngle.
    static Quaternion fromAxisAngle(const Vec3& axis, double angle) {
        double l = axis.length();
        if (l < 1e-15) return Quaternion::identity();
        double half = 0.5 * angle;
        double s = std::sin(half) / l;
        return Quaternion{std::cos(half), s * axis.x, s * axis.y, s * axis.z};
    }

    // ── norms ────────────────────────────────────────────────────────────────
    double normSquared() const { return w * w + x * x + y * y + z * z; }
    double norm() const { return std::sqrt(normSquared()); }

    Quaternion conjugate() const { return Quaternion{w, -x, -y, -z}; }

    // General inverse = conjugate / |q|² (== conjugate for a unit quaternion).
    Quaternion inverse() const {
        double n2 = normSquared();
        if (n2 <= 1e-30) return Quaternion::identity();
        double inv = 1.0 / n2;
        return Quaternion{w * inv, -x * inv, -y * inv, -z * inv};
    }

    Quaternion normalized() const {
        double n = norm();
        if (n <= 1e-15) return Quaternion::identity();
        double inv = 1.0 / n;
        return Quaternion{w * inv, x * inv, y * inv, z * inv};
    }
    bool normalize() {
        double n = norm();
        if (n <= 1e-15) { *this = Quaternion::identity(); return false; }
        double inv = 1.0 / n;
        w *= inv; x *= inv; y *= inv; z *= inv;
        return true;
    }

    // ── Hamilton product  r = (*this) * o ─────────────────────────────────────
    Quaternion operator*(const Quaternion& o) const {
        return Quaternion{
            w * o.w - x * o.x - y * o.y - z * o.z,
            w * o.x + x * o.w + y * o.z - z * o.y,
            w * o.y - x * o.z + y * o.w + z * o.x,
            w * o.z + x * o.y - y * o.x + z * o.w};
    }
    Quaternion mul(const Quaternion& o) const { return (*this) * o; }

    // Rotate a vector: out = q * (0,v) * q^-1. Uses the GENERAL inverse
    // (conjugate/|q|²) so a possibly-non-unit q is handled exactly — matching
    // MateLibrary::rotateVec (A/B-verified native==OCCT to 1e-12).
    Vec3 rotate(const Vec3& v) const {
        double n2 = normSquared();
        if (n2 <= 1e-30) return v;
        // t = q * (0,v)
        double tw = -x * v.x - y * v.y - z * v.z;
        double tx =  w * v.x + y * v.z - z * v.y;
        double ty =  w * v.y - x * v.z + z * v.x;
        double tz =  w * v.z + x * v.y - y * v.x;
        // q^-1 = conjugate / |q|²
        double inv = 1.0 / n2;
        double cw =  w * inv, cx = -x * inv, cy = -y * inv, cz = -z * inv;
        // out = (vector part of) t * q^-1
        return Vec3{
            tw * cx + tx * cw + ty * cz - tz * cy,
            tw * cy - tx * cz + ty * cw + tz * cx,
            tw * cz + tx * cy - ty * cx + tz * cw};
    }
    Vec3 rotateVec(const Vec3& v) const { return rotate(v); }

    // Equivalent rotation matrix. Normalises internally so a non-unit q maps to
    // the same rotation rotate() applies.
    Mat3 toMat3() const {
        Quaternion q = normalized();
        double xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
        double xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
        double wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
        return Mat3{
            1 - 2 * (yy + zz),   2 * (xy - wz),       2 * (xz + wy),
            2 * (xy + wz),       1 - 2 * (xx + zz),   2 * (yz - wx),
            2 * (xz - wy),       2 * (yz + wx),       1 - 2 * (xx + yy)};
    }
};

} // namespace math
} // namespace forge

#endif // FORGE_MATH_QUATERNION_HPP
