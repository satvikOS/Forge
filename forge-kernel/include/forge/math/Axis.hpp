// forge/math/Axis.hpp — canonical native axis/frame types for forge::math:
// Ax1, Ax2, Ax3. Native equivalents of gp_Ax1 / gp_Ax2 / gp_Ax3 (93 uses across
// the kernel — the Axis/Frame with Location + Direction + XDirection/YDirection
// + SetRotation that every primitive-placement / rotation boundary goes through,
// and which has NO native equivalent today).
//
//   Ax1 — an axis: Location + a unit main Direction. (rotation axis / ray)
//   Ax2 — a RIGHT-HANDED frame: Location + Z(main Direction) + X + Y, with
//         Y = Z × X. This is the primitive-placement frame (cylinder/cone/torus
//         base + axis + ref-dir).
//   Ax3 — a frame that may be right- OR left-handed (the `direct` flag).
//
// ADDITIVE, header-only, namespace forge::math. Depends on Vec3 + Mat3 + <cmath>.

#ifndef FORGE_MATH_AXIS_HPP
#define FORGE_MATH_AXIS_HPP

#include <cmath>

#include "forge/math/Vec3.hpp"
#include "forge/math/Mat3.hpp"

namespace forge {
namespace math {

// Pick a unit vector perpendicular to `d` deterministically & robustly: cross
// `d` with whichever cardinal axis is *least* aligned with it (so the cross is
// well-conditioned). `d` need not be unit; result is unit. For a degenerate d
// (near zero) returns +X.
inline Vec3 anyPerpendicular(const Vec3& d) {
    Vec3 u = d.normalized();
    if (u.isZero()) return Vec3{1, 0, 0};
    // choose the cardinal axis with the smallest |component|.
    double ax = std::fabs(u.x), ay = std::fabs(u.y), az = std::fabs(u.z);
    Vec3 cardinal = (ax <= ay && ax <= az) ? Vec3{1, 0, 0}
                  : (ay <= az)             ? Vec3{0, 1, 0}
                                           : Vec3{0, 0, 1};
    Vec3 p = u.cross(cardinal);
    if (p.normalize()) return p;
    // extremely unlikely fallback (u == chosen cardinal): use another axis.
    return u.cross(Vec3{0, 0, 1}).normalized();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ax1 — an axis (Location + unit Direction).
// ─────────────────────────────────────────────────────────────────────────────
struct Ax1 {
    Vec3 location{0, 0, 0};
    Vec3 direction{0, 0, 1};   // kept unit by the constructors below

    Ax1() = default;
    Ax1(const Vec3& loc, const Vec3& dir)
        : location(loc), direction(dir.normalized()) {}

    // Rotate a POINT about this axis by `angle` (radians, right-handed about
    // `direction`). Matches the p' = O + R·(p − O) that gp_Trsf::SetRotation does.
    Vec3 rotatePoint(const Vec3& p, double angle) const {
        Mat3 R = Mat3::fromAxisAngle(direction, angle);
        return location + R * (p - location);
    }
    // Rotate a VECTOR/DIRECTION about this axis (linear part only).
    Vec3 rotateVec(const Vec3& v, double angle) const {
        return Mat3::fromAxisAngle(direction, angle) * v;
    }

    Ax1 reversed() const { return Ax1{location, -direction}; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Ax2 — a RIGHT-HANDED coordinate frame (Location + X + Y + Z), Y = Z × X.
// ─────────────────────────────────────────────────────────────────────────────
struct Ax2 {
    Vec3 location{0, 0, 0};
    Vec3 xDirection{1, 0, 0};
    Vec3 yDirection{0, 1, 0};
    Vec3 direction{0, 0, 1};   // main / Z axis

    Ax2() = default;

    // From (location, main direction): X is auto-derived perpendicular to N,
    // Y = N × X. (gp_Ax2(P, N).)
    Ax2(const Vec3& loc, const Vec3& n) {
        location = loc;
        direction = n.normalized();
        xDirection = anyPerpendicular(direction);
        yDirection = direction.cross(xDirection);   // right-handed
    }

    // From (location, main direction, ref X): X = component of vx orthogonal to
    // N (normalised), Y = N × X. (gp_Ax2(P, N, Vx).) If vx is parallel to N the
    // reference is degenerate and X falls back to an auto perpendicular.
    Ax2(const Vec3& loc, const Vec3& n, const Vec3& vx) {
        location = loc;
        direction = n.normalized();
        Vec3 xp = vx - direction * vx.dot(direction);   // Gram–Schmidt
        if (!xp.normalize()) xp = anyPerpendicular(direction);
        xDirection = xp;
        yDirection = direction.cross(xDirection);       // right-handed
    }

    Ax1 axis() const { return Ax1{location, direction}; }

    // Rotation matrix of this frame (columns = X, Y, Z): maps LOCAL → WORLD dirs.
    Mat3 rotation() const { return Mat3::fromColumns(xDirection, yDirection, direction); }

    // ── transform a point/vec INTO and OUT of the frame ──────────────────────
    // local → world (a POINT: translation included).
    Vec3 toWorld(const Vec3& local) const {
        return location + xDirection * local.x + yDirection * local.y + direction * local.z;
    }
    // world → local (a POINT). Orthonormal frame ⇒ inverse is the projection.
    Vec3 toLocal(const Vec3& world) const {
        Vec3 d = world - location;
        return Vec3{d.dot(xDirection), d.dot(yDirection), d.dot(direction)};
    }
    // local → world (a DIRECTION: no translation).
    Vec3 dirToWorld(const Vec3& local) const {
        return xDirection * local.x + yDirection * local.y + direction * local.z;
    }
    // world → local (a DIRECTION).
    Vec3 dirToLocal(const Vec3& world) const {
        return Vec3{world.dot(xDirection), world.dot(yDirection), world.dot(direction)};
    }

    // Rotate the WHOLE frame about an arbitrary axis (gp_Ax2::Rotate). Location
    // is rotated as a point; the three directions as vectors.
    Ax2 rotated(const Ax1& about, double angle) const {
        Mat3 R = Mat3::fromAxisAngle(about.direction, angle);
        Ax2 r;
        r.location   = about.location + R * (location - about.location);
        r.xDirection = R * xDirection;
        r.yDirection = R * yDirection;
        r.direction  = R * direction;
        return r;
    }
    // In-place convenience (gp_Ax2::SetRotation-style mutate about the frame's
    // OWN main axis by `angle`).
    void setRotation(double angle) { *this = rotated(axis(), angle); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Ax3 — a frame that may be right- OR left-handed (the `direct` flag).
//   direct == true  ⇒ Y = Z × X   (right-handed, same as Ax2)
//   direct == false ⇒ Y = X × Z   (left-handed / indirect)
// ─────────────────────────────────────────────────────────────────────────────
struct Ax3 {
    Vec3 location{0, 0, 0};
    Vec3 xDirection{1, 0, 0};
    Vec3 yDirection{0, 1, 0};
    Vec3 direction{0, 0, 1};
    bool direct = true;   // true = right-handed

    Ax3() = default;

    Ax3(const Vec3& loc, const Vec3& n, const Vec3& vx, bool rightHanded = true) {
        location = loc;
        direction = n.normalized();
        Vec3 xp = vx - direction * vx.dot(direction);
        if (!xp.normalize()) xp = anyPerpendicular(direction);
        xDirection = xp;
        direct = rightHanded;
        yDirection = rightHanded ? direction.cross(xDirection)
                                 : xDirection.cross(direction);
    }
    Ax3(const Vec3& loc, const Vec3& n) {
        location = loc;
        direction = n.normalized();
        xDirection = anyPerpendicular(direction);
        yDirection = direction.cross(xDirection);
        direct = true;
    }
    // Widen an Ax2 to an Ax3 (always right-handed).
    explicit Ax3(const Ax2& a)
        : location(a.location), xDirection(a.xDirection),
          yDirection(a.yDirection), direction(a.direction), direct(true) {}

    Ax1 axis() const { return Ax1{location, direction}; }

    // For an INDIRECT (left-handed) frame this is NOT a pure rotation — its
    // determinant is −1 (a reflection composed with the frame). That is exactly
    // gp_Ax3's behaviour and is required to express mirrored placements.
    Mat3 transform() const { return Mat3::fromColumns(xDirection, yDirection, direction); }

    Vec3 toWorld(const Vec3& local) const {
        return location + xDirection * local.x + yDirection * local.y + direction * local.z;
    }
    Vec3 toLocal(const Vec3& world) const {
        Vec3 d = world - location;
        return Vec3{d.dot(xDirection), d.dot(yDirection), d.dot(direction)};
    }
};

} // namespace math
} // namespace forge

#endif // FORGE_MATH_AXIS_HPP
