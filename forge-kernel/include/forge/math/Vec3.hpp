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
// ADOPTED (was "ADDITIVE: does not replace any per-module Vec3 yet"): the nine
// per-module Vec3 declarations listed above are now `using Vec3 =
// forge::math::Vec3;` aliases of this type -- brep/Nurbs, composites, gdt,
// geom/Bezier, implicit/SdfTree, materials, mesh/HalfEdgeMesh, voxel/VoxelGrid,
// vvuq and src/FeaTet.cpp. All ten were layout-identical and this type is a
// superset of each, so adoption was an alias, not a rewrite. This is now THE
// forge vector type, which is what makes it usable as the single substitution
// boundary for the gp_Pnt/gp_Vec/gp_Dir uses. Header-only, only <cmath>.
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
// NO free dot/cross/length/normalize here, deliberately.
//
// They existed, and outside their own unit test no production file called them.
// (I first checked that by grepping the QUALIFIED name math::dot, which found
// zero -- the wrong instrument: every real call site spells them unqualified and
// reaches them by ADL. test/native/linalg/forge_math_test.cpp did exactly that
// and was the one thing that broke.) Every module that now aliases its Vec3
// to this type ALREADY declares its own `dot`/`cross`/`length`/`normalize` for
// its own namespace, so free functions here are found by ADL as well and every
// call site becomes ambiguous -- MEASURED: 28 translation units failed to
// compile on exactly these four names, and on nothing else.
//
// Removing them loses no capability -- the members below are the same
// operations -- and it is the SAFE direction of the two. The modules' versions
// are not interchangeable with these: their zero-length guards use different
// epsilons (materials DBL_MIN, composites 1e-300, this header 1e-15), and the
// gap is observable. MEASURED on a vector of length 1e-20: materials and
// composites normalize it to {1,0,0}; `normalized()` collapses it to {0,0,0}.
// So deleting the MODULES' free functions and routing them here would have
// silently changed numerics in nine subsystems; deleting these four changes
// nothing, because nothing called them.

} // namespace math
} // namespace forge

#endif // FORGE_MATH_VEC3_HPP
