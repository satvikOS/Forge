// forge/math/Mat3.hpp — canonical native 3x3 matrix (row-major) for forge::math.
//
// Native equivalent of gp_Mat (a 3x3 value type). ROW-MAJOR storage: element
// (row i, col j) is m[3*i + j] — this matches the row-major `double r[9]`
// convention the existing brep::RigidTransform already uses, so migration is a
// straight lift. A matrix acts on a column vector: (M*v)_i = Σ_j M(i,j) v_j.
//
// ADDITIVE, header-only, namespace forge::math. Depends only on Vec3 + <cmath>.

#ifndef FORGE_MATH_MAT3_HPP
#define FORGE_MATH_MAT3_HPP

#include <cmath>

#include "forge/math/Vec3.hpp"

namespace forge {
namespace math {

struct Mat3 {
    // row-major: m[3*row + col]
    double m[9] = {1, 0, 0,
                   0, 1, 0,
                   0, 0, 1};

    Mat3() = default;
    // element-wise, row-major (a,b,c) = row0, (d,e,f) = row1, (g,h,i) = row2.
    Mat3(double a, double b, double c,
         double d, double e, double f,
         double g, double h, double i)
        : m{a, b, c, d, e, f, g, h, i} {}

    static Mat3 identity() { return Mat3{}; }
    static Mat3 zero() { return Mat3{0, 0, 0, 0, 0, 0, 0, 0, 0}; }

    // Diagonal (non-uniform) scale matrix.
    static Mat3 diagonal(double sx, double sy, double sz) {
        return Mat3{sx, 0, 0, 0, sy, 0, 0, 0, sz};
    }

    // Column accessors (the 3 columns are the images of the basis vectors).
    Vec3 column(int j) const { return Vec3{m[j], m[3 + j], m[6 + j]}; }
    Vec3 row(int i) const { return Vec3{m[3 * i], m[3 * i + 1], m[3 * i + 2]}; }

    // Build from three COLUMN vectors (image of e_x, e_y, e_z). This is the
    // natural way to assemble an orthonormal frame's rotation.
    static Mat3 fromColumns(const Vec3& cx, const Vec3& cy, const Vec3& cz) {
        return Mat3{cx.x, cy.x, cz.x,
                    cx.y, cy.y, cz.y,
                    cx.z, cy.z, cz.z};
    }

    double at(int i, int j) const { return m[3 * i + j]; }
    double& at(int i, int j) { return m[3 * i + j]; }

    // ── matrix * column vector ────────────────────────────────────────────────
    Vec3 operator*(const Vec3& v) const {
        return Vec3{m[0] * v.x + m[1] * v.y + m[2] * v.z,
                    m[3] * v.x + m[4] * v.y + m[5] * v.z,
                    m[6] * v.x + m[7] * v.y + m[8] * v.z};
    }
    Vec3 mul(const Vec3& v) const { return (*this) * v; }

    // ── matrix * matrix ───────────────────────────────────────────────────────
    Mat3 operator*(const Mat3& o) const {
        Mat3 r = Mat3::zero();
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0.0;
                for (int k = 0; k < 3; ++k) s += m[3 * i + k] * o.m[3 * k + j];
                r.m[3 * i + j] = s;
            }
        return r;
    }
    Mat3 mul(const Mat3& o) const { return (*this) * o; }

    Mat3 operator*(double s) const {
        Mat3 r;
        for (int k = 0; k < 9; ++k) r.m[k] = m[k] * s;
        return r;
    }

    Mat3 transpose() const {
        return Mat3{m[0], m[3], m[6],
                    m[1], m[4], m[7],
                    m[2], m[5], m[8]};
    }

    double determinant() const {
        return m[0] * (m[4] * m[8] - m[5] * m[7])
             - m[1] * (m[3] * m[8] - m[5] * m[6])
             + m[2] * (m[3] * m[7] - m[4] * m[6]);
    }

    // General inverse via adjugate / determinant. Returns false (and leaves out
    // untouched) if the matrix is singular (|det| <= eps).
    bool inverse(Mat3& out, double eps = 1e-300) const {
        double det = determinant();
        if (std::fabs(det) <= eps) return false;
        double inv = 1.0 / det;
        // cofactor / adjugate (transpose of cofactor matrix).
        out.m[0] = (m[4] * m[8] - m[5] * m[7]) * inv;
        out.m[1] = (m[2] * m[7] - m[1] * m[8]) * inv;
        out.m[2] = (m[1] * m[5] - m[2] * m[4]) * inv;
        out.m[3] = (m[5] * m[6] - m[3] * m[8]) * inv;
        out.m[4] = (m[0] * m[8] - m[2] * m[6]) * inv;
        out.m[5] = (m[2] * m[3] - m[0] * m[5]) * inv;
        out.m[6] = (m[3] * m[7] - m[4] * m[6]) * inv;
        out.m[7] = (m[1] * m[6] - m[0] * m[7]) * inv;
        out.m[8] = (m[0] * m[4] - m[1] * m[3]) * inv;
        return true;
    }

    // Right-handed rotation of `angle` radians about `axis` (need not be unit),
    // via Rodrigues' formula. Matches gp_Mat::SetRotation.
    static Mat3 fromAxisAngle(const Vec3& axis, double angle) {
        Vec3 u = axis.normalized();
        if (u.isZero()) return Mat3::identity();   // degenerate axis → no rotation
        double c = std::cos(angle);
        double s = std::sin(angle);
        double t = 1.0 - c;
        double ux = u.x, uy = u.y, uz = u.z;
        return Mat3{
            c + ux * ux * t,        ux * uy * t - uz * s,   ux * uz * t + uy * s,
            uy * ux * t + uz * s,   c + uy * uy * t,        uy * uz * t - ux * s,
            uz * ux * t - uy * s,   uz * uy * t + ux * s,   c + uz * uz * t};
    }
};

inline Mat3 operator*(double s, const Mat3& a) { return a * s; }

} // namespace math
} // namespace forge

#endif // FORGE_MATH_MAT3_HPP
