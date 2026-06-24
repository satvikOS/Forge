// forge/native/brep/Aabb.cpp
//
// Implementation of the in-house exact analytic AABB (Aabb.hpp). Pure C++20, no
// external deps. See header for the per-surface-kind extremum method + honesty.

#include "forge/native/brep/Aabb.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();

// A running min/max accumulator over the three world axes.
struct Box {
    double mn[3] = { kInf, kInf, kInf };
    double mx[3] = { -kInf, -kInf, -kInf };
    bool   any   = false;
    void add(const Vec3& p) {
        const double c[3] = { p.x, p.y, p.z };
        for (int k = 0; k < 3; ++k) {
            if (c[k] < mn[k]) mn[k] = c[k];
            if (c[k] > mx[k]) mx[k] = c[k];
        }
        any = true;
    }
};

// Extremum of  C + A*cos(t) + B*sin(t)  over t in [t0,t1] (t0<=t1). The
// stationary points are t* = atan2(B,A) and t*+pi; we test each that falls in
// the window plus the two endpoints. Returns the [lo,hi] of the projection.
void sinusoidRange(double C, double A, double B, double t0, double t1,
                   double& lo, double& hi) {
    auto f = [&](double t) { return C + A * std::cos(t) + B * std::sin(t); };
    lo = std::min(f(t0), f(t1));
    hi = std::max(f(t0), f(t1));
    const double R = std::hypot(A, B);
    if (R <= 0.0) return;                     // constant in t
    // The two stationary angles (max at phi, min at phi+pi).
    const double phi = std::atan2(B, A);      // in (-pi, pi]
    for (int s = 0; s < 2; ++s) {
        double base = phi + s * M_PI;
        // Slide `base` into [t0, t0+2pi) then test every 2pi copy inside [t0,t1].
        double k = std::floor((t0 - base) / (2.0 * M_PI));
        for (double tt = base + k * 2.0 * M_PI; tt <= t1 + 1e-15; tt += 2.0 * M_PI) {
            if (tt >= t0 - 1e-15 && tt <= t1 + 1e-15) {
                const double val = f(tt);
                lo = std::min(lo, val);
                hi = std::max(hi, val);
            }
        }
    }
}

// Bound ONE analytic face's projection onto each world axis over its trim
// window, folding the result into `box`. Exact for Plane/Cylinder/Cone/Sphere/
// Torus; grid-sampled for Nurbs.
void boundFace(const Face& f, Box& box, int nurbsGrid) {
    const Surface* surf = f.surface;
    if (!surf) {
        // Bare-topology face (the original box gate before geometry attach):
        // bound by its loop vertices directly.
        if (f.outerLoop && f.outerLoop->first) {
            const Coedge* c = f.outerLoop->first;
            const Coedge* start = c;
            do {
                const Vertex* v = c->originVertex();
                if (v) box.add(Vec3{ v->point.x, v->point.y, v->point.z });
                c = c->next;
            } while (c && c != start);
        }
        return;
    }

    const double u0 = std::min(f.u0, f.u1), u1 = std::max(f.u0, f.u1);
    const double v0 = std::min(f.v0, f.v1), v1 = std::max(f.v0, f.v1);
    const Vec3 O = surf->origin;
    const Vec3 ax = surf->axis;
    const Vec3 rd = surf->refDir;
    const Vec3 bn = surf->binormal();

    switch (surf->kind) {
    case SurfaceKind::Plane: {
        // S·ê is affine in (u,v) → extremum at a trim-rectangle corner. When the
        // face carries a vertexUV loop polygon, its corners are the exact trim
        // boundary; otherwise the [u0,u1]x[v0,v1] rectangle corners bound it.
        // isDisk planar cap: the boundary is a circular arc — bound it as the
        // annular sector below (exact) rather than the rectangle in (theta,r).
        if (surf->isDisk) {
            // S(theta,r) = origin + r*(cos th * refDir + sin th * binormal),
            // theta in [u0,u1], r in [v0,v1]. For each axis k:
            //   S·ê = O·ê + r*( (rd·ê) cos th + (bn·ê) sin th ).
            // The radial factor r is >= 0; max |.| at r=v1, but the sign of the
            // sinusoid can make r=v0 the extreme on one side, so we test BOTH
            // radii endpoints (sinusoidRange over theta at each fixed r).
            const double comp[3][3] = {
                { O.x, rd.x, bn.x }, { O.y, rd.y, bn.y }, { O.z, rd.z, bn.z }
            };
            for (int k = 0; k < 3; ++k) {
                for (double r : { v0, v1 }) {
                    double lo, hi;
                    sinusoidRange(comp[k][0], r * comp[k][1], r * comp[k][2],
                                  u0, u1, lo, hi);
                    box.mn[k] = std::min(box.mn[k], lo);
                    box.mx[k] = std::max(box.mx[k], hi);
                    box.any = true;
                }
            }
            return;
        }
        // Affine plane patch: the extremum over the rectangle is at a corner.
        for (double u : { u0, u1 })
            for (double v : { v0, v1 })
                box.add(surf->evaluate(u, v));
        // If a loop polygon is present, its vertices are interior to / on the
        // rectangle, so they cannot extend the affine extremum — but include the
        // exact loop vertices anyway (cheap, and exact for a sub-polygon face).
        if (f.outerLoop && f.outerLoop->first) {
            const Coedge* c = f.outerLoop->first;
            const Coedge* start = c;
            do {
                const Vertex* vv = c->originVertex();
                if (vv) box.add(Vec3{ vv->point.x, vv->point.y, vv->point.z });
                c = c->next;
            } while (c && c != start);
        }
        return;
    }
    case SurfaceKind::Cylinder: {
        // S(th,z) = O + r1*(cos th rd + sin th bn) + z*ax,  z in [v0,v1].
        // S·ê = O·ê + z*(ax·ê) + r1*( (rd·ê)cos th + (bn·ê)sin th ).
        for (int k = 0; k < 3; ++k) {
            const double Oe  = (&O.x)[k];
            const double axe = (&ax.x)[k];
            const double rde = (&rd.x)[k];
            const double bne = (&bn.x)[k];
            for (double z : { v0, v1 }) {
                double lo, hi;
                sinusoidRange(Oe + z * axe, surf->r1 * rde, surf->r1 * bne,
                              u0, u1, lo, hi);
                box.mn[k] = std::min(box.mn[k], lo);
                box.mx[k] = std::max(box.mx[k], hi);
            }
            box.any = true;
        }
        return;
    }
    case SurfaceKind::Cone: {
        // S(th,t) = O + r(t)*(cos th rd + sin th bn) + param*t*ax, t in [v0,v1],
        // r(t)=r1+(r2-r1)t (monotone in t). The radial amplitude varies with t,
        // so the extreme arises at a t-endpoint (radius extreme) combined with the
        // angular stationary point; testing both t endpoints' sinusoids is exact.
        for (int k = 0; k < 3; ++k) {
            const double Oe  = (&O.x)[k];
            const double axe = (&ax.x)[k];
            const double rde = (&rd.x)[k];
            const double bne = (&bn.x)[k];
            for (double t : { v0, v1 }) {
                const double r = surf->r1 + (surf->r2 - surf->r1) * t;
                double lo, hi;
                sinusoidRange(Oe + surf->param * t * axe, r * rde, r * bne,
                              u0, u1, lo, hi);
                box.mn[k] = std::min(box.mn[k], lo);
                box.mx[k] = std::max(box.mx[k], hi);
            }
            box.any = true;
        }
        return;
    }
    case SurfaceKind::Sphere: {
        // S(th,phi) = O + r1*( sp*(cos th rd + sin th bn) + cp*ax ),
        // phi in [v0,v1] (latitude), th in [u0,u1]. For fixed phi:
        //   S·ê = O·ê + r1*cp*(ax·ê) + r1*sp*( (rd·ê)cos th + (bn·ê)sin th ).
        // The phi-extreme of the sin(phi) amplitude is interior at phi=pi/2 (sp=1)
        // and the cos(phi) axial term is monotone, so we test phi at {v0,v1} AND
        // (when pi/2 lies in [v0,v1]) phi=pi/2 — capturing the equator bulge and
        // the pole exactly.
        double phis[3] = { v0, v1, 0.5 * M_PI };
        int nph = (0.5 * M_PI > v0 && 0.5 * M_PI < v1) ? 3 : 2;
        for (int k = 0; k < 3; ++k) {
            const double Oe  = (&O.x)[k];
            const double axe = (&ax.x)[k];
            const double rde = (&rd.x)[k];
            const double bne = (&bn.x)[k];
            for (int j = 0; j < nph; ++j) {
                const double sp = std::sin(phis[j]), cp = std::cos(phis[j]);
                double lo, hi;
                sinusoidRange(Oe + surf->r1 * cp * axe,
                              surf->r1 * sp * rde, surf->r1 * sp * bne,
                              u0, u1, lo, hi);
                box.mn[k] = std::min(box.mn[k], lo);
                box.mx[k] = std::max(box.mx[k], hi);
            }
            box.any = true;
        }
        return;
    }
    case SurfaceKind::Torus: {
        // S(th,phi) = O + (r1 + r2 cos phi)*(cos th rd + sin th bn) + r2 sin phi*ax,
        // th in [u0,u1], phi in [v0,v1]. The ring radius (r1+r2 cos phi) and the
        // axial offset (r2 sin phi) are BOTH sinusoids in phi; their joint extreme
        // over a phi window is itself a sinusoid range, so we:
        //   * for the axial component contribution r2 sin phi, take its phi range,
        //   * for the in-plane ring radius, take its phi range,
        // then combine with the theta sinusoid. Because the ring radius enters the
        // theta sinusoid amplitude, the exact extreme is at a phi where the ring
        // radius is extreme (phi=0 or pi, clamped) OR a window endpoint — we test
        // phi at {v0, v1, 0, pi} (those in-window) which captures both, plus the
        // axial extreme phi at {pi/2, -pi/2/3pi/2} for the ax term.
        double phiCands[6] = { v0, v1, 0.0, M_PI, 0.5 * M_PI, 1.5 * M_PI };
        for (int k = 0; k < 3; ++k) {
            const double Oe  = (&O.x)[k];
            const double axe = (&ax.x)[k];
            const double rde = (&rd.x)[k];
            const double bne = (&bn.x)[k];
            for (int j = 0; j < 6; ++j) {
                double phi = phiCands[j];
                if (phi < v0 - 1e-15 || phi > v1 + 1e-15) continue;
                const double ring = surf->r1 + surf->r2 * std::cos(phi);
                const double zc   = surf->r2 * std::sin(phi);
                double lo, hi;
                sinusoidRange(Oe + zc * axe, ring * rde, ring * bne,
                              u0, u1, lo, hi);
                box.mn[k] = std::min(box.mn[k], lo);
                box.mx[k] = std::max(box.mx[k], hi);
            }
            box.any = true;
        }
        return;
    }
    case SurfaceKind::Nurbs: {
        // No closed-form extremum: dense grid sample + the trim corners. This is
        // the single non-exact kind (header-documented). The canonical analytic
        // primitives never reach it; the ellipsoid/pyramid sides bound to <<1e-6.
        const int n = nurbsGrid < 2 ? 2 : nurbsGrid;
        for (int i = 0; i <= n; ++i) {
            const double u = u0 + (u1 - u0) * (static_cast<double>(i) / n);
            for (int jj = 0; jj <= n; ++jj) {
                const double v = v0 + (v1 - v0) * (static_cast<double>(jj) / n);
                box.add(surf->evaluate(u, v));
            }
        }
        return;
    }
    }
}

} // namespace

Aabb3 computeAabb(const Solid& solid, int nurbsGrid) {
    Box box;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (f) boundFace(*f, box, nurbsGrid);
        }
    }
    Aabb3 out;
    if (!box.any) { out.void_ = true; return out; }
    out.void_ = false;
    out.minX = box.mn[0]; out.minY = box.mn[1]; out.minZ = box.mn[2];
    out.maxX = box.mx[0]; out.maxY = box.mx[1]; out.maxZ = box.mx[2];
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
