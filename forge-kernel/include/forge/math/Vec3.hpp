// forge/math/Vec3.hpp — canonical native 3-vector for the unified forge::math
// substrate (OCCT-zero foundation).
//
// CONTEXT (OCCT-zero assessment): the native math substrate is FRAGMENTED — a
// `Vec3` value type is re-declared per module (native/brep, native/composites,
// native/implicit, native/geom, …) with slightly different member sets, and
// there is NO single canonical `forge::math` header. This header is that single
// canonical Vec3: it carries the FULL arithmetic every per-module copy has, so
// it can become the ONE substitution boundary for the ~780 gp_Pnt / gp_Vec /
// gp_Dir / gp_XYZ uses when the modules migrate onto it (a later wave).
//
// ADDITIVE: this does NOT replace any existing per-module Vec3 yet. It lives in
// its own namespace (forge::math) so it can be linked alongside every module
// without ODR conflict. Header-only, no dependencies beyond <cmath>.
//
// A Vec3 is used both as a POINT (a gp_Pnt / gp_XYZ location) and as a VECTOR
// or DIRECTION (a gp_Vec / gp_Dir). The distinction is contextual, exactly as
// with the OCCT trio; the frame/transform types below apply translation to the
// former and not the latter.

#ifndef FORGE_MATH_VEC3_HPP
#define FORGE_MATH_VEC3_HPP

#include <cmath>

namespace forge {
namespace math {

struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;

    Vec3() = default;
    constexpr Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}

    // ── element-wise arithmetic (matches every per-module Vec3 superset) ────
    constexpr Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    constexpr Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    constexpr Vec3 operator-() const { return {-x, -y, -z}; }
    constexpr Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    constexpr Vec3 operator/(double s) const { return {x / s, y / s, z / s}; }

    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
    Vec3& operator*=(double s)      { x *= s;   y *= s;   z *= s;   return *this; }
    Vec3& operator/=(double s)      { x /= s;   y /= s;   z /= s;   return *this; }

    // Named "scale" alias (some modules spell operator* as scale()).
    constexpr Vec3 scaled(double s) const { return {x * s, y * s, z * s}; }

    // ── products ────────────────────────────────────────────────────────────
    constexpr double dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
    constexpr Vec3 cross(const Vec3& o) const {
        return {y * o.z - z * o.y,
                z * o.x - x * o.z,
                x * o.y - y * o.x};
    }

    // ── norms ────────────────────────────────────────────────────────────────
    constexpr double lengthSquared() const { return x * x + y * y + z * z; }
    constexpr double normSquared() const { return x * x + y * y + z * z; }
    double length() const { return std::sqrt(lengthSquared()); }
    double norm() const { return length(); }   // gp_Vec::Magnitude synonym

    // Distance between two points.
    double distance(const Vec3& o) const { return (*this - o).length(); }

    // Returns a unit copy. If the vector is (near-)degenerate (||v|| <= eps),
    // returns the zero vector rather than dividing by ~0 (callers that need a
    // hard failure should test isZero() first — see normalize()).
    Vec3 normalized(double eps = 1e-15) const {
        double n = length();
        if (n <= eps) return Vec3{0.0, 0.0, 0.0};
        double inv = 1.0 / n;
        return {x * inv, y * inv, z * inv};
    }

    // In-place normalise. Returns false (and leaves the vector unchanged) if the
    // vector is degenerate, so a caller can branch on it — this is the "hard"
    // form that the fragmented per-module helpers open-code.
    bool normalize(double eps = 1e-15) {
        double n = length();
        if (n <= eps) return false;
        double inv = 1.0 / n;
        x *= inv; y *= inv; z *= inv;
        return true;
    }

    bool isZero(double eps = 1e-15) const { return length() <= eps; }
};

// scalar * vector (commutative convenience).
constexpr inline Vec3 operator*(double s, const Vec3& v) { return {v.x * s, v.y * s, v.z * s}; }

// Free-function forms (mirror gp_Vec free helpers; handy in generic code).
constexpr inline double dot(const Vec3& a, const Vec3& b) { return a.dot(b); }
constexpr inline Vec3   cross(const Vec3& a, const Vec3& b) { return a.cross(b); }
inline double           length(const Vec3& v) { return v.length(); }
inline Vec3             normalize(const Vec3& v) { return v.normalized(); }

} // namespace math
} // namespace forge

#endif // FORGE_MATH_VEC3_HPP
