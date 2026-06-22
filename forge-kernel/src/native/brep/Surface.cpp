// forge/native/brep/Surface.cpp
//
// Implementation of the analytic surface evaluators (Surface.hpp). Pure C++20,
// no external deps. See header for honesty / scope.

#include "forge/native/brep/Surface.hpp"

#include <cmath>

namespace forge {
namespace native {
namespace brep {

double vlen(const Vec3& a) { return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }

Vec3 vnorm(const Vec3& a) {
    double L = vlen(a);
    if (L <= 0.0) return {0, 0, 0};
    return {a.x / L, a.y / L, a.z / L};
}

// ---------------------------------------------------------------------------
// evaluate — point S(u,v).
// ---------------------------------------------------------------------------
Vec3 Surface::evaluate(double u, double v) const {
    const Vec3 b = binormal();
    switch (kind) {
    case SurfaceKind::Plane:
        return vadd(origin, vadd(vscale(refDir, u), vscale(b, v)));
    case SurfaceKind::Cylinder: {
        const double c = std::cos(u), s = std::sin(u);
        Vec3 radial = vadd(vscale(refDir, r1 * c), vscale(b, r1 * s));
        return vadd(origin, vadd(radial, vscale(axis, v)));
    }
    case SurfaceKind::Cone: {
        const double c = std::cos(u), s = std::sin(u);
        const double r = r1 + (r2 - r1) * v;
        Vec3 radial = vadd(vscale(refDir, r * c), vscale(b, r * s));
        return vadd(origin, vadd(radial, vscale(axis, param * v)));
    }
    case SurfaceKind::Sphere: {
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        Vec3 radial = vadd(vscale(refDir, r1 * sp * ct),
                           vadd(vscale(b, r1 * sp * st), vscale(axis, r1 * cp)));
        return vadd(origin, radial);
    }
    case SurfaceKind::Torus: {
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        const double ring = r1 + r2 * cp;
        Vec3 inplane = vadd(vscale(refDir, ring * ct), vscale(b, ring * st));
        return vadd(origin, vadd(inplane, vscale(axis, r2 * sp)));
    }
    case SurfaceKind::Nurbs: {
        SurfaceSample ss = evaluatePoint(nurbs, u, v);
        return ss.point;
    }
    }
    return origin;
}

// ---------------------------------------------------------------------------
// evaluateDeriv — point + analytic partials.
// ---------------------------------------------------------------------------
void Surface::evaluateDeriv(double u, double v, Vec3& s, Vec3& du, Vec3& dv) const {
    const Vec3 b = binormal();
    switch (kind) {
    case SurfaceKind::Plane:
        s  = vadd(origin, vadd(vscale(refDir, u), vscale(b, v)));
        du = refDir;
        dv = b;
        return;
    case SurfaceKind::Cylinder: {
        const double c = std::cos(u), si = std::sin(u);
        s  = vadd(origin, vadd(vadd(vscale(refDir, r1 * c), vscale(b, r1 * si)),
                               vscale(axis, v)));
        du = vadd(vscale(refDir, -r1 * si), vscale(b, r1 * c)); // d/dtheta
        dv = axis;                                              // d/dz
        return;
    }
    case SurfaceKind::Cone: {
        const double c = std::cos(u), si = std::sin(u);
        const double r = r1 + (r2 - r1) * v;
        const double dr = (r2 - r1);
        s  = vadd(origin, vadd(vadd(vscale(refDir, r * c), vscale(b, r * si)),
                               vscale(axis, param * v)));
        du = vadd(vscale(refDir, -r * si), vscale(b, r * c));   // d/dtheta
        dv = vadd(vadd(vscale(refDir, dr * c), vscale(b, dr * si)),
                  vscale(axis, param));                          // d/dt
        return;
    }
    case SurfaceKind::Sphere: {
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        s  = vadd(origin, vadd(vscale(refDir, r1 * sp * ct),
                  vadd(vscale(b, r1 * sp * st), vscale(axis, r1 * cp))));
        du = vadd(vscale(refDir, -r1 * sp * st), vscale(b, r1 * sp * ct)); // d/dtheta
        dv = vadd(vscale(refDir, r1 * cp * ct),
                  vadd(vscale(b, r1 * cp * st), vscale(axis, -r1 * sp))); // d/dphi
        return;
    }
    case SurfaceKind::Torus: {
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        const double ring = r1 + r2 * cp;
        s  = vadd(origin, vadd(vadd(vscale(refDir, ring * ct), vscale(b, ring * st)),
                               vscale(axis, r2 * sp)));
        du = vadd(vscale(refDir, -ring * st), vscale(b, ring * ct));        // d/dtheta
        dv = vadd(vadd(vscale(refDir, -r2 * sp * ct), vscale(b, -r2 * sp * st)),
                  vscale(axis, r2 * cp));                                    // d/dphi
        return;
    }
    case SurfaceKind::Nurbs: {
        SurfaceSample ss = evaluateWithDerivatives(nurbs, u, v);
        s  = ss.point;
        du = ss.du;
        dv = ss.dv;
        return;
    }
    }
    s = origin; du = refDir; dv = b;
}

// ---------------------------------------------------------------------------
// normalAt — outward unit normal (respecting `reversed`).
// ---------------------------------------------------------------------------
Vec3 Surface::normalAt(double u, double v) const {
    Vec3 s, du, dv;
    evaluateDeriv(u, v, s, du, dv);
    Vec3 n = vnorm(vcross(du, dv));
    if (reversed) n = vscale(n, -1.0);
    return n;
}

} // namespace brep
} // namespace native
} // namespace forge
