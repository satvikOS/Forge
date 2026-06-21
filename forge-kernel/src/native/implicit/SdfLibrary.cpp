// forge/native/implicit/SdfLibrary.cpp
//
// Implementation of the expanded analytic SDF primitive library + TPMS fields
// declared in forge/native/implicit/SdfLibrary.hpp. See the header for the
// exactness / honesty statement of each field.
//
// Pure C++20. No external dependencies. Reuses ONLY implicit/SdfTree.hpp.

#include "forge/native/implicit/SdfLibrary.hpp"

#include <algorithm>
#include <cmath>
#include <memory>

namespace forge {
namespace native {
namespace implicit {

namespace {

constexpr double kPi  = 3.14159265358979323846;
constexpr double kTau = 2.0 * kPi;

// 2D helpers on the (x,y) projection used by the radially-symmetric primitives.
inline double length2(double x, double y) { return std::sqrt(x * x + y * y); }

// -----------------------------------------------------------------------------
// Analytic primitive nodes
// -----------------------------------------------------------------------------

// Torus, axis +z through center, major radius R, minor radius r. EXACT distance:
//   q   = ( length(p.xy) - R , p.z )
//   f   = length(q) - r
class TorusNode final : public SdfNode {
public:
    TorusNode(Vec3 c, double R, double r) : center_(c), R_(R), r_(r) {}
    double eval(const Vec3& p) const override {
        const Vec3 d = p - center_;
        const double qx = length2(d.x, d.y) - R_;
        const double qy = d.z;
        return length2(qx, qy) - r_;
    }
private:
    Vec3 center_;
    double R_, r_;
};

// Bounded right circular cone. Apex at apex_, opening half-angle theta_, height
// h_ down -z. The solid is the surface of revolution (about +z) of the triangle
// with vertices, in the (q,w) half-plane [q = radius from axis >= 0, w = depth
// below the apex = -(p.z - apex.z)]:
//      A = apex     = (0, 0)
//      B = rim      = (rBase, h),   rBase = h*tan(theta)
//      C = axis-base= (0, h)
// We return the 3D distance as the signed distance to that triangle in (q,w),
// computed as: distance to the nearest of the two REAL boundary edges (lateral
// A->B and base B->C; the edge C->A lies on the symmetry axis and is interior to
// the revolution, never a true surface), signed negative when (q,w) is inside
// the triangle. This is EXACT on the lateral face and the base disk and a
// Lipschitz-1 bound at the rim B (the only convex corner of the revolved solid).
class ConeNode final : public SdfNode {
public:
    ConeNode(Vec3 apex, double theta, double h)
        : apex_(apex), tan_(std::tan(theta)), h_(h), rBase_(h * std::tan(theta)) {}
    double eval(const Vec3& p) const override {
        const Vec3 d = p - apex_;
        const double q = length2(d.x, d.y);     // radial coordinate (>= 0)
        const double w = -d.z;                   // depth below apex
        const double pq = q, pw = w;
        // Edge A(0,0) -> B(rBase,h): lateral.
        const double abx = rBase_, aby = h_;
        double tab = (pq * abx + pw * aby) / (abx * abx + aby * aby);
        tab = std::clamp(tab, 0.0, 1.0);
        const double lx = pq - abx * tab, ly = pw - aby * tab;
        const double dLat2 = lx * lx + ly * ly;
        // Edge B(rBase,h) -> C(0,h): the base disk (horizontal, w=h, 0<=q<=rBase).
        const double bx = pq - std::clamp(pq, 0.0, rBase_);
        const double by = pw - h_;
        const double dBase2 = bx * bx + by * by;
        const double dist = std::sqrt(std::min(dLat2, dBase2));
        // Inside test: below the base plane (w <= h) AND on the inner side of the
        // lateral line. Lateral line through origin with direction (tan, 1)
        // (i.e. (rBase,h)); a point is inside (radius smaller than the cone at
        // that depth) when q <= w*tan, i.e. q - w*tan <= 0. Also need w >= 0.
        const bool inside = (w >= 0.0) && (w <= h_) && (q - w * tan_ <= 0.0);
        return inside ? -dist : dist;
    }
private:
    Vec3 apex_;
    double tan_, h_, rBase_;
};

// Capsule (swept sphere): dist(p, segment(a,b)) - r. EXACT.
class CapsuleNode final : public SdfNode {
public:
    CapsuleNode(Vec3 a, Vec3 b, double r) : a_(a), b_(b), r_(r) {}
    double eval(const Vec3& p) const override {
        const Vec3 pa = p - a_;
        const Vec3 ba = b_ - a_;
        const double bb = dot(ba, ba);
        double h = (bb > 0.0) ? dot(pa, ba) / bb : 0.0;
        h = std::clamp(h, 0.0, 1.0);
        const Vec3 closest = a_ + ba * h;
        return length(p - closest) - r_;
    }
private:
    Vec3 a_, b_;
    double r_;
};

// Rounded box: standard box SDF on half-extents, then subtract r (inflate).
//   q = |p-c| - half ; outside = length(max(q,0)) ; inside = min(max comp,0)
//   f = outside + inside - r
class RoundedBoxNode final : public SdfNode {
public:
    RoundedBoxNode(Vec3 c, Vec3 half, double r) : center_(c), half_(half), r_(r) {}
    double eval(const Vec3& p) const override {
        const Vec3 d = p - center_;
        const Vec3 q{std::fabs(d.x) - half_.x,
                     std::fabs(d.y) - half_.y,
                     std::fabs(d.z) - half_.z};
        const Vec3 qpos{std::max(q.x, 0.0), std::max(q.y, 0.0), std::max(q.z, 0.0)};
        const double outside = length(qpos);
        const double inside = std::min(std::max(q.x, std::max(q.y, q.z)), 0.0);
        return outside + inside - r_;
    }
private:
    Vec3 center_, half_;
    double r_;
};

// Regular hexagonal prism, axis +z, half-height h, apothem r (across the flats).
// Standard Quilez sdHexPrism (exact on the faces).
class HexPrismNode final : public SdfNode {
public:
    HexPrismNode(Vec3 c, double h, double r) : center_(c), h_(h), r_(r) {}
    double eval(const Vec3& p) const override {
        // k = (-sqrt(3)/2, 1/2, 1/sqrt(3))
        const double kx = -0.8660254037844386;
        const double ky = 0.5;
        const double kz = 0.5773502691896257;
        Vec3 d = p - center_;
        double px = std::fabs(d.x);
        double py = std::fabs(d.y);
        const double pz = std::fabs(d.z);
        // Fold across the two mirror lines of the hexagon.
        const double dotk = std::min(kx * px + ky * py, 0.0);
        px -= 2.0 * dotk * kx;
        py -= 2.0 * dotk * ky;
        // 2D distance to the hexagon of apothem r.
        const double clampedX = std::clamp(px, -kz * r_, kz * r_);
        const double dx = px - clampedX;
        const double dy = py - r_;
        const double d2x = length2(dx, dy) * ((py - r_ < 0.0) ? -1.0 : 1.0);
        // z component (prism cap), half-height h.
        const double d2z = pz - h_;
        // Combine the 2D in-plane distance with the cap distance.
        const double inside = std::min(std::max(d2x, d2z), 0.0);
        const double outside = length2(std::max(d2x, 0.0), std::max(d2z, 0.0));
        return inside + outside;
    }
private:
    Vec3 center_;
    double h_, r_;
};

// -----------------------------------------------------------------------------
// TPMS field nodes:  f(p) = |trigField(2*pi*(p-c)/period)| - thickness
// -----------------------------------------------------------------------------

enum class Tpms { Gyroid, SchwarzP, SchwarzD, Neovius };

class TpmsNode final : public SdfNode {
public:
    TpmsNode(Tpms kind, Vec3 c, double period, double t)
        : kind_(kind), center_(c), scale_(kTau / period), t_(t) {}
    double eval(const Vec3& p) const override {
        const Vec3 d = p - center_;
        const double u = d.x * scale_;
        const double v = d.y * scale_;
        const double w = d.z * scale_;
        return std::fabs(field(u, v, w)) - t_;
    }
private:
    double field(double u, double v, double w) const {
        const double su = std::sin(u), cu = std::cos(u);
        const double sv = std::sin(v), cv = std::cos(v);
        const double sw = std::sin(w), cw = std::cos(w);
        switch (kind_) {
            case Tpms::Gyroid:
                return su * cv + sv * cw + sw * cu;
            case Tpms::SchwarzP:
                return cu + cv + cw;
            case Tpms::SchwarzD:
                return su * sv * sw + su * cv * cw + cu * sv * cw + cu * cv * sw;
            case Tpms::Neovius:
                return 3.0 * (cu + cv + cw) + 4.0 * cu * cv * cw;
        }
        return 0.0;
    }
    Tpms kind_;
    Vec3 center_;
    double scale_, t_;
};

} // namespace

// -----------------------------------------------------------------------------
// TPMS analytic amplitudes (max |trigField|), validated numerically — see the
// matching constants asserted in the test. Used for the thickness sanity check.
// -----------------------------------------------------------------------------
double SdfLibrary::gyroidAmplitude()   { return 1.5; }
double SdfLibrary::schwarzPAmplitude() { return 3.0; }
double SdfLibrary::schwarzDAmplitude() { return 1.4142135623730951; } // sqrt(2)
double SdfLibrary::neoviusAmplitude()  { return 13.0; }

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------
SdfResult SdfLibrary::torus(const Vec3& center, double R, double r) {
    if (!(R > 0.0)) return SdfResult::failure("torus: major radius R must be > 0");
    if (!(r > 0.0)) return SdfResult::failure("torus: minor radius r must be > 0");
    if (!(r < R))   return SdfResult::failure("torus: require r < R (non-self-intersecting tube)");
    return SdfResult::success(Sdf(std::make_shared<TorusNode>(center, R, r)));
}

SdfResult SdfLibrary::cone(const Vec3& apex, double angle, double h) {
    if (!(h > 0.0)) return SdfResult::failure("cone: height h must be > 0");
    if (!(angle > 0.0 && angle < kPi * 0.5))
        return SdfResult::failure("cone: half-angle must be in (0, pi/2)");
    return SdfResult::success(Sdf(std::make_shared<ConeNode>(apex, angle, h)));
}

SdfResult SdfLibrary::capsule(const Vec3& a, const Vec3& b, double r) {
    if (!(r > 0.0)) return SdfResult::failure("capsule: radius r must be > 0");
    return SdfResult::success(Sdf(std::make_shared<CapsuleNode>(a, b, r)));
}

SdfResult SdfLibrary::roundedBox(const Vec3& center, const Vec3& half, double r) {
    if (half.x < 0.0 || half.y < 0.0 || half.z < 0.0)
        return SdfResult::failure("roundedBox: half-extents must be >= 0");
    if (r < 0.0)
        return SdfResult::failure("roundedBox: round radius r must be >= 0");
    if (half.x == 0.0 && half.y == 0.0 && half.z == 0.0 && r == 0.0)
        return SdfResult::failure("roundedBox: degenerate (zero box and zero radius)");
    return SdfResult::success(Sdf(std::make_shared<RoundedBoxNode>(center, half, r)));
}

SdfResult SdfLibrary::hexPrism(const Vec3& center, double h, double r) {
    if (!(h > 0.0)) return SdfResult::failure("hexPrism: half-height h must be > 0");
    if (!(r > 0.0)) return SdfResult::failure("hexPrism: apothem r must be > 0");
    return SdfResult::success(Sdf(std::make_shared<HexPrismNode>(center, h, r)));
}

// TPMS builders share the same validation: period>0, 0<t<amplitude.
static SdfResult makeTpms(Tpms kind, const Vec3& c, double period, double t,
                          double amplitude, const char* name) {
    if (!(period > 0.0))
        return SdfResult::failure(std::string(name) + ": period must be > 0");
    if (!(t > 0.0))
        return SdfResult::failure(std::string(name) + ": thickness must be > 0");
    if (!(t < amplitude))
        return SdfResult::failure(std::string(name) +
            ": thickness must be < field amplitude (else the shell fills the cell)");
    return SdfResult::success(Sdf(std::make_shared<TpmsNode>(kind, c, period, t)));
}

SdfResult SdfLibrary::gyroid(const Vec3& center, double period, double thickness) {
    return makeTpms(Tpms::Gyroid, center, period, thickness, gyroidAmplitude(), "gyroid");
}
SdfResult SdfLibrary::schwarzP(const Vec3& center, double period, double thickness) {
    return makeTpms(Tpms::SchwarzP, center, period, thickness, schwarzPAmplitude(), "schwarzP");
}
SdfResult SdfLibrary::schwarzD(const Vec3& center, double period, double thickness) {
    return makeTpms(Tpms::SchwarzD, center, period, thickness, schwarzDAmplitude(), "schwarzD");
}
SdfResult SdfLibrary::neovius(const Vec3& center, double period, double thickness) {
    return makeTpms(Tpms::Neovius, center, period, thickness, neoviusAmplitude(), "neovius");
}

} // namespace implicit
} // namespace native
} // namespace forge
