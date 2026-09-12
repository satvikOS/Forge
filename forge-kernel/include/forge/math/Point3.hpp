// forge/math/Point3.hpp — canonical native 3-point for the unified forge::math
// substrate (OCCT-zero foundation).
//
// WHY THIS IS NOT JUST Vec3. forge/math/Vec3.hpp says "A Vec3 is used both as a
// POINT and as a VECTOR or DIRECTION ... exactly as with the OCCT trio", and the
// obvious move when Point3's three per-module declarations were unified was to
// alias them onto Vec3 and be done. That does not compile, and the codebase says
// why: forge/native/geom/AABBTree.hpp declares BOTH
//
//     RayHit        rayIntersect(const mesh::Vec3& origin, const mesh::Vec3& dir) const;  // :136
//     RayHit        rayIntersect(const Point3&    origin, const Point3&    dir) const;  // :142
//     ClosestResult closestPoint(const mesh::Vec3& q) const;                            // :139
//     ClosestResult closestPoint(const Point3&    q) const;                             // :143
//
// as separate overloads. MEASURED with a minimal repro: with `using Point3 =
// mesh::Vec3` clang reports "class member cannot be redeclared"; with Point3 a
// distinct struct it compiles clean. So this kernel deliberately offers both
// spellings at its API boundary, and merging the types means DELETING public API
// -- a larger decision than unifying a fragmented type, and not this header's to
// make. OCCT keeps gp_Pnt and gp_Vec distinct for the same reason.
//
// ADOPTED, not additive: ft::Point3, brep::Point3 and geom::Point3 are aliases of
// this type. All three were plain {double x, y, z} = 0.0 in three namespaces, and
// all 132 brace-initialisations in the tree pass exactly three arguments, so the
// user-declared constructors below cost no call site. (The per-module copies are
// what forced 28 of the 32 pure-repack functions in this kernel to exist -- each
// converts Point3 to Vec3 or back, field by field.)
//
// DELIBERATELY MINIMAL. A point is not a vector: it has no dot, no cross, no
// norm, and adding two points is meaningless. The three declarations this
// replaces carried no members at all, so anything beyond construction and field
// access would be new API arriving through the back door of a unification patch.
// Point-minus-point belongs on Vec3 and is not declared here, because a free
// operator- at this scope is found by ADL alongside every module's own -- exactly
// the collision that broke 28 translation units when forge/math/Vec3.hpp shipped
// free dot/cross/length/normalize (see its header note).
//
// Header-only, no dependency beyond the C++ standard library.

#ifndef FORGE_MATH_POINT3_HPP
#define FORGE_MATH_POINT3_HPP

namespace forge {
namespace math {

struct Point3 {
    double x = 0.0, y = 0.0, z = 0.0;

    Point3() = default;
    constexpr Point3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
};

}  // namespace math
}  // namespace forge

#endif  // FORGE_MATH_POINT3_HPP
