// forge/native/geom/minenclosingsphere_test.cpp
//
// Standalone validation gate for forge::native::geom::minEnclosingSphere — the
// in-house smallest enclosing sphere (Welzl, move-to-front). Pure C++20, no
// external deps.
//
// Build & run (the task's command):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/MinEnclosingSphere.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/minenclosingsphere_test.cpp \
//       -o /tmp/k3_MinEnclosingSphere && /tmp/k3_MinEnclosingSphere
//
// LINK NOTE (honest): this module references NONE of the exact predicates — it
// only reuses the header-only Point3 type from Geom.hpp. But the named dep
// Geom.cpp itself calls forge::native::orient2d/orient3d (from Predicates.cpp),
// so Predicates.cpp is passed too. It changes nothing about this module.
//
// WHAT IS VALIDATED (the SPEC):
//   (A) Degenerate handling, NO fabrication: empty -> ok=false; non-finite ->
//       ok=false; ragged flat array -> ok=false.
//   (B) Single point -> radius 0 at the point (ok=true).
//   (C) 1..4-point base cases exact: the sphere through up to 4 points has every
//       support point exactly on the boundary; collinear triple / coplanar quad
//       report ok=false from sphere3/sphere4 yet the FULL solver still returns a
//       correct enclosing ball.
//   (D) Points sampled INSIDE a known sphere: result radius <= known radius + tol
//       AND the ball encloses every point (max dist to center <= radius + 1e-9).
//   (E) Points sampled ON a known sphere: the solver RECOVERS that sphere
//       (center + radius) within 1e-6.
//
//   A fresh std::random_device seed is printed so any failure reproduces.

#include <cstdint>
#include <algorithm>
#include "forge/native/geom/MinEnclosingSphere.hpp"
#include "forge/native/geom/Geom.hpp"

#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using forge::native::geom::Point3;
using forge::native::geom::MinSphere;
using forge::native::geom::minEnclosingSphere;
using forge::native::geom::sphere1;
using forge::native::geom::sphere2;
using forge::native::geom::sphere3;
using forge::native::geom::sphere4;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) ++g_pass;
    else      std::printf("  [FAIL] %s\n", name);
}

static double dist(const std::array<double,3>& c, const Point3& p) {
    const double dx = c[0]-p.x, dy = c[1]-p.y, dz = c[2]-p.z;
    return std::sqrt(dx*dx + dy*dy + dz*dz);
}

// Verify a sphere encloses every point in `pts` (max dist <= radius + 1e-9).
static bool encloses(const MinSphere& s, const std::vector<Point3>& pts) {
    if (!s.ok) return false;
    for (const Point3& p : pts)
        if (dist(s.center, p) > s.radius + 1e-9) return false;
    return true;
}

// Verify every support point lies exactly on the boundary.
static bool supportOnBoundary(const MinSphere& s) {
    if (!s.ok) return false;
    for (const auto& q : s.support) {
        const double d = dist(s.center, Point3{q[0],q[1],q[2]});
        if (std::fabs(d - s.radius) > 1e-9 * (1.0 + s.radius)) return false;
    }
    return true;
}

int main() {
    std::printf("== forge::native::geom::MinEnclosingSphere (Welzl MTF) validation gate ==\n");

    std::random_device rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("seed = %llu\n", static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    // -----------------------------------------------------------------------
    // (A) Honest degenerate handling — NO fabrication.
    // -----------------------------------------------------------------------
    {
        check(!minEnclosingSphere(std::vector<Point3>{}).ok, "empty set -> ok=false");
        std::vector<Point3> nf = {{0,0,0},{1,0,0},{0,1,0}};
        nf[1].x = std::numeric_limits<double>::quiet_NaN();
        check(!minEnclosingSphere(nf).ok, "non-finite coordinate -> ok=false");
        nf[1].x = std::numeric_limits<double>::infinity();
        check(!minEnclosingSphere(nf).ok, "infinite coordinate -> ok=false");
        check(!minEnclosingSphere(std::vector<double>{0,0,0, 1,1}).ok,
              "ragged flat array -> ok=false");
    }

    // -----------------------------------------------------------------------
    // (B) Single point -> radius 0 at the point.
    // -----------------------------------------------------------------------
    {
        Point3 p{ 2.0, -3.0, 7.0 };
        MinSphere s = minEnclosingSphere(std::vector<Point3>{p});
        check(s.ok, "single point -> ok=true");
        check(std::fabs(s.radius) < 1e-12, "single point -> radius 0");
        check(dist(s.center, p) < 1e-12, "single point -> center at the point");
        check(s.support.size() == 1, "single point -> 1 support point");
    }

    // -----------------------------------------------------------------------
    // (C) 1..4-point base cases EXACT, and the full solver agrees.
    // -----------------------------------------------------------------------
    {
        // 2 points -> diametral sphere (center = midpoint, r = half distance).
        Point3 a{-1,0,0}, b{3,0,0};
        MinSphere s2 = sphere2(a, b);
        check(s2.ok && std::fabs(s2.center[0]-1.0)<1e-12
              && std::fabs(s2.radius-2.0)<1e-12, "sphere2: diametral exact");
        MinSphere f2 = minEnclosingSphere(std::vector<Point3>{a,b});
        check(f2.ok && std::fabs(f2.radius-2.0)<1e-9 && encloses(f2, {a,b}),
              "full solver: 2 points -> diametral");

        // 3 points -> circumcircle; right triangle's hypotenuse is the diameter.
        Point3 c0{0,0,0}, c1{4,0,0}, c2{0,3,0};   // right angle at origin
        MinSphere s3 = sphere3(c0, c1, c2);
        check(s3.ok && supportOnBoundary(s3), "sphere3: circumcircle on boundary");
        check(s3.ok && std::fabs(s3.radius - 2.5) < 1e-9,
              "sphere3: right-triangle circumradius == hypotenuse/2 (2.5)");
        check(s3.ok && std::fabs(s3.center[2]) < 1e-12,
              "sphere3: center lies in the points' z=0 plane");
        // collinear triple -> sphere3 ok=false, but full solver still encloses.
        Point3 l0{0,0,0}, l1{1,1,1}, l2{2,2,2};
        check(!sphere3(l0,l1,l2).ok, "sphere3: collinear -> ok=false");
        MinSphere fl = minEnclosingSphere(std::vector<Point3>{l0,l1,l2});
        check(fl.ok && encloses(fl, {l0,l1,l2}), "full solver: collinear triple still enclosed");

        // 4 points -> circumsphere of a tetrahedron (unit-corner tet).
        Point3 t0{0,0,0}, t1{2,0,0}, t2{0,2,0}, t3{0,0,2};
        MinSphere s4 = sphere4(t0,t1,t2,t3);
        check(s4.ok && supportOnBoundary(s4), "sphere4: circumsphere on boundary");
        // circumcenter of this tet is (1,1,1), r = sqrt(3).
        check(s4.ok && std::fabs(s4.center[0]-1.0)<1e-9
              && std::fabs(s4.center[1]-1.0)<1e-9 && std::fabs(s4.center[2]-1.0)<1e-9,
              "sphere4: circumcenter == (1,1,1)");
        check(s4.ok && std::fabs(s4.radius - std::sqrt(3.0)) < 1e-9,
              "sphere4: circumradius == sqrt(3)");
        // coplanar quad -> sphere4 ok=false, but full solver still encloses.
        Point3 q0{0,0,0}, q1{1,0,0}, q2{0,1,0}, q3{1,1,0};
        check(!sphere4(q0,q1,q2,q3).ok, "sphere4: coplanar -> ok=false");
        MinSphere fq = minEnclosingSphere(std::vector<Point3>{q0,q1,q2,q3});
        check(fq.ok && encloses(fq, {q0,q1,q2,q3}), "full solver: coplanar quad enclosed");
        // the unit square's min enclosing sphere has r = sqrt(2)/2 at its center.
        check(fq.ok && std::fabs(fq.radius - std::sqrt(2.0)/2.0) < 1e-9,
              "full solver: unit square min sphere r == sqrt(2)/2");
    }

    // -----------------------------------------------------------------------
    // (D) Points sampled INSIDE a known sphere: result radius <= known + tol AND
    //     encloses every point. Many random instances with varied known spheres.
    // -----------------------------------------------------------------------
    const int kInside = 25;
    int insideRadOk = 0, insideEnclOk = 0;
    std::uniform_real_distribution<double> Cen(-20.0, 20.0);
    std::uniform_real_distribution<double> Rad(0.5, 12.0);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    for (int inst = 0; inst < kInside; ++inst) {
        const double R = Rad(rng);
        const std::array<double,3> C = { Cen(rng), Cen(rng), Cen(rng) };
        std::vector<Point3> pts;
        const int N = 200 + (inst % 50);
        for (int i = 0; i < N; ++i) {
            // uniform-in-ball sample: random direction * R * cbrt(u)
            double x = 2*U(rng)-1, y = 2*U(rng)-1, z = 2*U(rng)-1;
            double L = std::sqrt(x*x+y*y+z*z);
            if (L < 1e-12) { x=1; y=0; z=0; L=1; }
            const double rr = R * std::cbrt(U(rng));
            pts.push_back(Point3{ C[0]+x/L*rr, C[1]+y/L*rr, C[2]+z/L*rr });
        }
        MinSphere s = minEnclosingSphere(pts);
        if (s.ok && s.radius <= R + 1e-6) ++insideRadOk;
        if (encloses(s, pts) && supportOnBoundary(s)) ++insideEnclOk;
    }
    check(insideRadOk == kInside,  "INSIDE: result radius <= known radius + tol (all)");
    check(insideEnclOk == kInside, "INSIDE: ball encloses every point + support on boundary (all)");

    // -----------------------------------------------------------------------
    // (E) Points sampled ON a known sphere: recover that sphere within 1e-6.
    //     A point set ON a sphere has THAT sphere as its unique min enclosing
    //     sphere (any smaller ball would miss the antipodal points). We sample
    //     densely & symmetrically so 4 non-coplanar support points are present.
    // -----------------------------------------------------------------------
    const int kOn = 20;
    int onCenterOk = 0, onRadOk = 0, onEnclOk = 0;
    for (int inst = 0; inst < kOn; ++inst) {
        const double R = Rad(rng);
        const std::array<double,3> C = { Cen(rng), Cen(rng), Cen(rng) };
        std::vector<Point3> pts;
        // include the 6 axis poles (guarantees antipodal coverage) ...
        const double ax[6][3] = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        for (auto& d : ax)
            pts.push_back(Point3{ C[0]+d[0]*R, C[1]+d[1]*R, C[2]+d[2]*R });
        // ... plus many random surface points.
        const int N = 300;
        for (int i = 0; i < N; ++i) {
            double x = 2*U(rng)-1, y = 2*U(rng)-1, z = 2*U(rng)-1;
            double L = std::sqrt(x*x+y*y+z*z);
            if (L < 1e-12) { x=1; y=0; z=0; L=1; }
            pts.push_back(Point3{ C[0]+x/L*R, C[1]+y/L*R, C[2]+z/L*R });
        }
        MinSphere s = minEnclosingSphere(pts);
        if (s.ok && dist(s.center, Point3{C[0],C[1],C[2]}) < 1e-6) ++onCenterOk;
        if (s.ok && std::fabs(s.radius - R) < 1e-6) ++onRadOk;
        if (encloses(s, pts)) ++onEnclOk;
    }
    check(onCenterOk == kOn, "ON-sphere: recovered center within 1e-6 (all)");
    check(onRadOk    == kOn, "ON-sphere: recovered radius within 1e-6 (all)");
    check(onEnclOk   == kOn, "ON-sphere: ball encloses every surface point (all)");

    // -----------------------------------------------------------------------
    // (F) Order-independence: a random cloud's min sphere is invariant to input
    //     permutation (Welzl shuffles internally, but the RESULT must agree).
    // -----------------------------------------------------------------------
    {
        std::vector<Point3> pts;
        std::uniform_real_distribution<double> P(-5.0, 5.0);
        for (int i = 0; i < 120; ++i) pts.push_back(Point3{P(rng),P(rng),P(rng)});
        MinSphere a = minEnclosingSphere(pts);
        std::vector<Point3> q = pts;
        std::shuffle(q.begin(), q.end(), rng);
        MinSphere b = minEnclosingSphere(q);
        bool same = a.ok && b.ok
            && std::fabs(a.radius - b.radius) < 1e-7
            && dist(a.center, Point3{b.center[0],b.center[1],b.center[2]}) < 1e-7;
        check(same, "order-independent: same sphere under input permutation");
        check(encloses(a, pts) && encloses(b, pts), "order test: both balls enclose the cloud");
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
