// test/native/brep/aabb_test.cpp
//
// Gate for forge::native::brep::computeAabb (OCCT_ZERO_ROADMAP W2.1). Pure C++20,
// no OCCT. Two independent oracles per primitive:
//
//   (1) CLOSED-FORM expected box — the analytic AABB of each canonical primitive
//       is known exactly (a cylinder of radius r height h centred on the Z axis
//       spans [-r,r]x[-r,r]x[0,h], a sphere of radius r at the origin spans
//       [-r,r]^3, etc.). computeAabb must match it to 1e-9.
//
//   (2) DENSE SURFACE-SAMPLE reference — independently, sample every face's
//       analytic surface on a fine (u,v) grid and bound the samples. The analytic
//       box must CONTAIN the sampled box (samples lie on the surface) AND be no
//       looser than the sample resolution warrants (they converge as the grid
//       refines). This catches a face whose extremum the analytic path misses.
//
// This is the native-side A/B oracle; the OCCT 1e-9 tie (vs BRepBndLib::AddOptimal)
// runs at the addon level through test/native_vs_occt_core.mjs.

#include "forge/native/brep/Aabb.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <limits>
#include <string>

using namespace forge::native::brep;

namespace {

int g_fail = 0;

void expectNear(const char* what, double got, double want, double tol) {
    if (std::abs(got - want) > tol) {
        std::printf("  [FAIL] %s: got %.12g want %.12g (|d|=%.3g > %.3g)\n",
                    what, got, want, std::abs(got - want), tol);
        ++g_fail;
    }
}

// Dense surface-sample box of a solid: bound every face surface over its trim
// window on an (N+1)x(N+1) grid. Returns the min/max over all samples.
Aabb3 sampleBox(const Solid& s, int N) {
    Aabb3 b;
    double mn[3] = { std::numeric_limits<double>::infinity(),
                     std::numeric_limits<double>::infinity(),
                     std::numeric_limits<double>::infinity() };
    double mx[3] = { -std::numeric_limits<double>::infinity(),
                     -std::numeric_limits<double>::infinity(),
                     -std::numeric_limits<double>::infinity() };
    bool any = false;
    for (const Shell* sh : s.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f || !f->surface) continue;
            const double u0 = f->u0, u1 = f->u1, v0 = f->v0, v1 = f->v1;
            const Surface* surf = f->surface;
            const Vec3 bn = surf->binormal();
            for (int i = 0; i <= N; ++i)
                for (int j = 0; j <= N; ++j) {
                    const double u = u0 + (u1 - u0) * (double(i) / N);
                    const double v = v0 + (v1 - v0) * (double(j) / N);
                    Vec3 p;
                    if (surf->kind == SurfaceKind::Plane && surf->isDisk) {
                        // Disk cap is parameterised in polar (theta=u, r=v), NOT the
                        // Cartesian Plane::evaluate — mirror computeAabb's handling.
                        p = vadd(surf->origin,
                                 vadd(vscale(surf->refDir, v * std::cos(u)),
                                      vscale(bn,            v * std::sin(u))));
                    } else {
                        p = surf->evaluate(u, v);
                    }
                    const double c[3] = { p.x, p.y, p.z };
                    for (int k = 0; k < 3; ++k) {
                        if (c[k] < mn[k]) mn[k] = c[k];
                        if (c[k] > mx[k]) mx[k] = c[k];
                    }
                    any = true;
                }
        }
    }
    b.void_ = !any;
    b.minX = mn[0]; b.minY = mn[1]; b.minZ = mn[2];
    b.maxX = mx[0]; b.maxY = mx[1]; b.maxZ = mx[2];
    return b;
}

// The analytic box must CONTAIN the sampled box (samples are on the surface), and
// the sampled box must converge UP to the analytic one as the grid refines — so
// with a dense grid the gap is tiny. We assert containment (with a hair of slack
// for float noise) and a small upper bound on the gap.
void checkContainsAndTight(const char* name, const Aabb3& a, const Aabb3& s,
                           double gapTol) {
    const double slack = 1e-9;
    auto le = [&](double x, double y) { return x <= y + slack; };
    bool contains = le(a.minX, s.minX) && le(a.minY, s.minY) && le(a.minZ, s.minZ) &&
                    le(s.maxX, a.maxX) && le(s.maxY, a.maxY) && le(s.maxZ, a.maxZ);
    if (!contains) {
        std::printf("  [FAIL] %s: analytic box does not contain sampled box\n", name);
        ++g_fail;
    }
    double gap = 0;
    gap = std::max(gap, std::abs(a.minX - s.minX));
    gap = std::max(gap, std::abs(a.minY - s.minY));
    gap = std::max(gap, std::abs(a.minZ - s.minZ));
    gap = std::max(gap, std::abs(a.maxX - s.maxX));
    gap = std::max(gap, std::abs(a.maxY - s.maxY));
    gap = std::max(gap, std::abs(a.maxZ - s.maxZ));
    if (gap > gapTol) {
        std::printf("  [FAIL] %s: analytic/sampled gap %.3g > %.3g\n", name, gap, gapTol);
        ++g_fail;
    }
}

} // namespace

int main() {
    std::printf("[aabb] forge::native::brep::computeAabb — W2.1 gate\n");

    // ---- BOX(2,3,4): planar, exact ----
    {
        SolidFactory f;
        Solid* s = f.buildBox(2, 3, 4);
        Aabb3 a = computeAabb(*s);
        expectNear("box minX", a.minX, 0, 1e-9);
        expectNear("box minY", a.minY, 0, 1e-9);
        expectNear("box minZ", a.minZ, 0, 1e-9);
        expectNear("box maxX", a.maxX, 2, 1e-9);
        expectNear("box maxY", a.maxY, 3, 1e-9);
        expectNear("box maxZ", a.maxZ, 4, 1e-9);
    }

    // ---- CYLINDER(r=1.3,h=5): exact ±r bulge captured analytically ----
    {
        SolidFactory f;
        const double r = 1.3, h = 5;
        Solid* s = f.buildCylinder(r, h);
        Aabb3 a = computeAabb(*s);
        expectNear("cyl minX", a.minX, -r, 1e-9);
        expectNear("cyl maxX", a.maxX,  r, 1e-9);
        expectNear("cyl minY", a.minY, -r, 1e-9);
        expectNear("cyl maxY", a.maxY,  r, 1e-9);
        expectNear("cyl minZ", a.minZ,  0, 1e-9);
        expectNear("cyl maxZ", a.maxZ,  h, 1e-9);
        checkContainsAndTight("cyl", a, sampleBox(*s, 200), 1e-3);
    }

    // ---- SPHERE(r=2.1): exact ±r on every axis (pole + equator) ----
    {
        SolidFactory f;
        const double r = 2.1;
        Solid* s = f.buildSphere(r);
        Aabb3 a = computeAabb(*s);
        expectNear("sph minX", a.minX, -r, 1e-9);
        expectNear("sph maxX", a.maxX,  r, 1e-9);
        expectNear("sph minY", a.minY, -r, 1e-9);
        expectNear("sph maxY", a.maxY,  r, 1e-9);
        expectNear("sph minZ", a.minZ, -r, 1e-9);
        expectNear("sph maxZ", a.maxZ,  r, 1e-9);
        checkContainsAndTight("sph", a, sampleBox(*s, 200), 1e-3);
    }

    // ---- CONE(rB=2,rT=0.8,h=4): widest at the base radius ----
    {
        SolidFactory f;
        const double rB = 2, rT = 0.8, h = 4;
        Solid* s = f.buildCone(rB, rT, h);
        Aabb3 a = computeAabb(*s);
        expectNear("cone minX", a.minX, -rB, 1e-9);
        expectNear("cone maxX", a.maxX,  rB, 1e-9);
        expectNear("cone minY", a.minY, -rB, 1e-9);
        expectNear("cone maxY", a.maxY,  rB, 1e-9);
        expectNear("cone minZ", a.minZ,   0, 1e-9);
        expectNear("cone maxZ", a.maxZ,   h, 1e-9);
        checkContainsAndTight("cone", a, sampleBox(*s, 200), 1e-3);
    }

    // ---- TORUS(R=3,r=1): spans ±(R+r) in plane, ±r in axis ----
    {
        SolidFactory f;
        const double R = 3, r = 1;
        Solid* s = f.buildTorus(R, r);
        Aabb3 a = computeAabb(*s);
        expectNear("tor minX", a.minX, -(R + r), 1e-9);
        expectNear("tor maxX", a.maxX,  (R + r), 1e-9);
        expectNear("tor minY", a.minY, -(R + r), 1e-9);
        expectNear("tor maxY", a.maxY,  (R + r), 1e-9);
        expectNear("tor minZ", a.minZ, -r, 1e-9);
        expectNear("tor maxZ", a.maxZ,  r, 1e-9);
        checkContainsAndTight("tor", a, sampleBox(*s, 200), 1e-3);
    }

    // ---- TUBE(rO=2,rI=1,h=4): outer radius bounds; height [0,h] ----
    {
        SolidFactory f;
        const double rO = 2, rI = 1, h = 4;
        Solid* s = f.buildTube(rO, rI, h);
        Aabb3 a = computeAabb(*s);
        expectNear("tube minX", a.minX, -rO, 1e-9);
        expectNear("tube maxX", a.maxX,  rO, 1e-9);
        expectNear("tube minZ", a.minZ,   0, 1e-9);
        expectNear("tube maxZ", a.maxZ,   h, 1e-9);
        (void)rI;
        checkContainsAndTight("tube", a, sampleBox(*s, 200), 1e-3);
    }

    if (g_fail == 0) std::printf("[aabb] ALL AABB GATES PASS\n");
    else             std::printf("[aabb] %d FAILURE(S)\n", g_fail);
    return g_fail == 0 ? 0 : 1;
}
