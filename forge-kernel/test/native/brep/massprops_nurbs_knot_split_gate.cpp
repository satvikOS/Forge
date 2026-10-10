// forge/native/brep/massprops_nurbs_knot_split_gate.cpp
//
// T-274 gate: massProperties must not integrate a B-spline face with ONE Gauss
// rule across an interior KNOT of its (u,v) window.
//
// A B-spline is a (rational) polynomial only BETWEEN knots. The exact rational
// circle has C0 double knots at 1/4, 1/2, 3/4, so a lateral cylinder face whose
// window spans one of them hands an 8x8 Gauss rule a kinked integrand; no Gauss
// order fixes that. MEASURED before the fix (T-274 notes): a 9-point rational
// cylinder r5 h10 cut into thirds at 0/120/240 deg integrated V = 786.524110981
// against pi*r^2*h = 785.398163397 (rel 1.43e-3), the SAME at gaussN 8/16/32/64.
//
// Every solid here is a closed surface of revolution built directly as native
// topology (no STEP reader in the loop): a rational 9-point-circle x B-spline
// generatrix lateral NURBS surface plus two EXACT disk caps. The truths are
// independent of the code under test:
//   * CLOSED FORM  - the cylinder (pi r^2 h, 2 pi r h + 2 pi r^2, h/2, the
//                    cylinder inertia tensor) and a piecewise-linear stepped
//                    profile (frustum volume/area formulas, cross-checked below);
//   * 1-D REFERENCE - the revolution integrals  V = pi int R^2 Z' dt, ...  over
//                    the generatrix, by a test-local Cox-de Boor evaluator and a
//                    test-local Gauss-Legendre generator, composite per knot
//                    span, and its own convergence is asserted (two refinements
//                    agree to < 1e-13).
// Fixtures (each has at least one face whose window spans an interior knot):
//   G1 one lateral face over the whole circle u in [0,1] (3 interior C0 knots)
//   G2 "cyl3eq": three lateral faces cut at 0/120/240 deg (each spans one knot)
//   G3 "split_cyl3": faces 0->90 deg (no interior knot) and 90->360 deg
//   G4 stepped profile: degree-1 generatrix with C0 kinks in v (closed form)
//   G5 cubic generatrix with a simple, a double and a triple interior knot
//   G6 G2 under a rigid motion (truth: COM and inertia tensor co-rotated)
//   G9 knot round-off: a face window ending 1e-14 past a knot
// Checks (relative; 1e-9 unless stated, one documented exception):
//   T1 PRODUCTION order (default gaussN): V and A within 1e-9 (the A1 pin);
//      G5 pins V only (its area integrand is non-polynomial, see T2/G8), G6's
//      off-origin volume is held to 1e-8 (measured 1.65e-9, conditioning).
//   T2 CONVERGENCE: at gaussN 32 EVERY component (V, A, COM, full inertia
//      tensor) of EVERY fixture within 1e-9.
//   G7 METAMORPHIC: a one-face surface integrates BIT-IDENTICALLY to the same
//      surface cut at its u-knots into single-span faces (quadrature-free).
//   G8 the requested order is the order run: gaussN 16 is not the 8-point bits
//      and the G5 area error falls monotonically 8 -> 16 -> 32.
// Every T1/T2/G7/G8 check FAILS on the pre-T-274 MassProps (measured 4/21).
//
// Pure C++20 + the native kernel. Prints "RESULT: P / T passed"; exit != 0 on
// any failure. Auto-discovered by forge-kernel/test/native/run_native.sh.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Topology.hpp"

using namespace forge::native::brep;

namespace {

int g_pass = 0, g_total = 0;
void check(bool ok, const std::string& name, const std::string& detail = "") {
    ++g_total;
    if (ok) ++g_pass;
    std::printf("  [%s] %s%s%s\n", ok ? "PASS" : "FAIL", name.c_str(),
                detail.empty() ? "" : "  ", detail.c_str());
}

constexpr double kPi = 3.14159265358979323846;
constexpr double kTol = 1e-9;

// ---------------------------------------------------------------- reference math
// Gauss-Legendre on [0,1] by Newton on P_n (independent of MassProps' tables).
void gaussLegendre01(int n, std::vector<double>& x, std::vector<double>& w) {
    x.assign(n, 0.0); w.assign(n, 0.0);
    for (int i = 0; i < n; ++i) {
        double z = std::cos(kPi * (i + 0.75) / (n + 0.5)), dp = 0.0;
        for (int it = 0; it < 100; ++it) {
            double p1 = 1.0, p2 = 0.0;
            for (int j = 0; j < n; ++j) { const double p3 = p2; p2 = p1; p1 = ((2.0 * j + 1.0) * z * p2 - j * p3) / (j + 1.0); }
            dp = n * (z * p1 - p2) / (z * z - 1.0);
            const double z1 = z; z = z1 - p1 / dp;
            if (std::fabs(z - z1) < 1e-16) break;
        }
        x[i] = 0.5 * (1.0 - z);
        w[i] = 1.0 / ((1.0 - z * z) * dp * dp);
    }
}

// Cox-de Boor basis value N_{i,p}(t) and derivative, naive recursion (0/0 := 0).
double basis(const std::vector<double>& k, int i, int p, double t) {
    if (p == 0) return (k[i] <= t && t < k[i + 1]) ? 1.0 : 0.0;
    double a = 0.0, b = 0.0;
    if (k[i + p] > k[i])         a = (t - k[i]) / (k[i + p] - k[i]) * basis(k, i, p - 1, t);
    if (k[i + p + 1] > k[i + 1]) b = (k[i + p + 1] - t) / (k[i + p + 1] - k[i + 1]) * basis(k, i + 1, p - 1, t);
    return a + b;
}
double basisDeriv(const std::vector<double>& k, int i, int p, double t) {
    double a = 0.0, b = 0.0;
    if (k[i + p] > k[i])         a = p / (k[i + p] - k[i]) * basis(k, i, p - 1, t);
    if (k[i + p + 1] > k[i + 1]) b = p / (k[i + p + 1] - k[i + 1]) * basis(k, i + 1, p - 1, t);
    return a - b;
}

// A non-rational B-spline generatrix (R(t), Z(t)), t in [0,1], revolved about +z.
struct Profile {
    int p = 1;
    std::vector<double> knots, R, Z;
};
void evalProfile(const Profile& g, double t, double& r, double& z, double& dr, double& dz) {
    r = z = dr = dz = 0.0;
    for (std::size_t i = 0; i < g.R.size(); ++i) {
        const double N = basis(g.knots, (int)i, g.p, t), D = basisDeriv(g.knots, (int)i, g.p, t);
        r += N * g.R[i]; z += N * g.Z[i]; dr += D * g.R[i]; dz += D * g.Z[i];
    }
}

struct Truth {
    double V = 0, A = 0, com[3] = {0, 0, 0}, I[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
};

// Solid of revolution of `g` (with flat disk caps) by 1-D composite Gauss per
// knot span: `sub` sub-intervals per span, `n` points each.
Truth revolutionTruth(const Profile& g, int sub, int n) {
    std::vector<double> gx, gw; gaussLegendre01(n, gx, gw);
    double V = 0, Alat = 0, Mz = 0, R4 = 0, Z2 = 0;
    for (std::size_t s = 0; s + 1 < g.knots.size(); ++s) {
        const double a = g.knots[s], b = g.knots[s + 1];
        if (!(b > a)) continue;
        for (int m = 0; m < sub; ++m) {
            const double c0 = a + (b - a) * m / sub, c1 = a + (b - a) * (m + 1) / sub, h = c1 - c0;
            for (int q = 0; q < n; ++q) {
                double r, z, dr, dz; evalProfile(g, c0 + h * gx[q], r, z, dr, dz);
                const double w = gw[q] * h;
                V    += w * kPi * r * r * dz;
                Alat += w * 2.0 * kPi * r * std::sqrt(dr * dr + dz * dz);
                Mz   += w * kPi * r * r * z * dz;
                R4   += w * kPi * r * r * r * r * dz;    // pi int R^4 Z'
                Z2   += w * kPi * r * r * z * z * dz;
            }
        }
    }
    const double r0 = g.R.front(), r1 = g.R.back();
    Truth t;
    t.V = V;
    t.A = Alat + kPi * r0 * r0 + kPi * r1 * r1;
    t.com[2] = Mz / V;
    const double x2 = R4 / 4.0;                // int x^2 dV = int y^2 dV = (pi/4) int R^4 Z'
    const double IxxO = x2 + Z2, IzzO = 2.0 * x2;
    t.I[0] = IxxO - V * t.com[2] * t.com[2];
    t.I[4] = t.I[0];
    t.I[8] = IzzO;
    return t;
}

// ---------------------------------------------------------------- rigid motion
struct Xf {
    double M[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    double t[3] = {0, 0, 0};
    Vec3 point(const Vec3& p) const {
        return Vec3{M[0] * p.x + M[1] * p.y + M[2] * p.z + t[0],
                    M[3] * p.x + M[4] * p.y + M[5] * p.z + t[1],
                    M[6] * p.x + M[7] * p.y + M[8] * p.z + t[2]};
    }
    Vec3 dir(const Vec3& d) const {
        return Vec3{M[0] * d.x + M[1] * d.y + M[2] * d.z,
                    M[3] * d.x + M[4] * d.y + M[5] * d.z,
                    M[6] * d.x + M[7] * d.y + M[8] * d.z};
    }
};
Xf axisAngle(double ax, double ay, double az, double ang, double tx, double ty, double tz) {
    const double L = std::sqrt(ax * ax + ay * ay + az * az);
    ax /= L; ay /= L; az /= L;
    const double c = std::cos(ang), s = std::sin(ang), C = 1.0 - c;
    Xf x;
    const double M[9] = {c + ax * ax * C,      ax * ay * C - az * s, ax * az * C + ay * s,
                         ay * ax * C + az * s, c + ay * ay * C,      ay * az * C - ax * s,
                         az * ax * C - ay * s, az * ay * C + ax * s, c + az * az * C};
    std::memcpy(x.M, M, sizeof M);
    x.t[0] = tx; x.t[1] = ty; x.t[2] = tz;
    return x;
}
Truth moveTruth(const Truth& in, const Xf& x) {
    Truth o = in;
    const Vec3 c = x.point(Vec3{in.com[0], in.com[1], in.com[2]});
    o.com[0] = c.x; o.com[1] = c.y; o.com[2] = c.z;
    for (int i = 0; i < 3; ++i)            // I' = M I M^T
        for (int j = 0; j < 3; ++j) {
            double acc = 0;
            for (int k = 0; k < 3; ++k)
                for (int l = 0; l < 3; ++l) acc += x.M[3 * i + k] * in.I[3 * k + l] * x.M[3 * j + l];
            o.I[3 * i + j] = acc;
        }
    return o;
}

// ---------------------------------------------------------------- native fixture
// The exact rational quadratic 9-point unit circle, CCW from +x, u in [0,1],
// C0 double knots at 1/4, 1/2, 3/4.
const double kCx[9] = {1, 1, 0, -1, -1, -1, 0, 1, 1};
const double kCy[9] = {0, 1, 1, 1, 0, -1, -1, -1, 0};
const std::vector<double> kCircleKnots = {0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1};

NurbsSurface revolveSurface(const Profile& g, const Xf& x) {
    const double s = std::sqrt(0.5);
    NurbsSurface n;
    n.degreeU = 2;
    n.degreeV = (std::size_t)g.p;
    n.knotsU = kCircleKnots;
    n.knotsV = g.knots;
    n.control.assign(9, std::vector<Vec3>(g.R.size()));
    n.weights.assign(9, std::vector<double>(g.R.size()));
    for (int i = 0; i < 9; ++i)
        for (std::size_t j = 0; j < g.R.size(); ++j) {
            n.control[i][j] = x.point(Vec3{kCx[i] * g.R[j], kCy[i] * g.R[j], g.Z[j]});
            n.weights[i][j] = (i % 2) ? s : 1.0;
        }
    return n;
}

struct Fixture {
    std::vector<std::unique_ptr<Surface>> surfaces;
    std::vector<std::unique_ptr<Face>> faces;
    Shell shell;
    Solid solid;
    Face* addFace(Surface* s, double u0, double u1, double v0, double v1) {
        faces.push_back(std::make_unique<Face>());
        Face* f = faces.back().get();
        f->surface = s; f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
        f->shell = &shell;
        shell.faces.push_back(f);
        return f;
    }
};

// Closed solid: the revolved lateral NURBS surface cut along u at `cuts`
// (one face per [cuts[k], cuts[k+1]] x [0,1]) + two exact disk caps.
std::unique_ptr<Fixture> buildRevolution(const Profile& g, const std::vector<double>& cuts, const Xf& x) {
    auto fx = std::make_unique<Fixture>();
    fx->solid.shells.push_back(&fx->shell);
    fx->shell.solid = &fx->solid;
    fx->surfaces.push_back(std::make_unique<Surface>());
    Surface* lat = fx->surfaces.back().get();
    lat->kind = SurfaceKind::Nurbs;
    lat->nurbs = revolveSurface(g, x);
    for (std::size_t k = 0; k + 1 < cuts.size(); ++k) fx->addFace(lat, cuts[k], cuts[k + 1], 0.0, 1.0);
    for (int top = 0; top < 2; ++top) {
        fx->surfaces.push_back(std::make_unique<Surface>());
        Surface* c = fx->surfaces.back().get();
        c->kind = SurfaceKind::Plane;
        c->origin = x.point(Vec3{0, 0, top ? g.Z.back() : g.Z.front()});
        c->axis = x.dir(Vec3{0, 0, 1});
        c->refDir = x.dir(Vec3{1, 0, 0});
        c->reversed = (top == 0);                // bottom cap faces -axis
        c->isDisk = true;
        c->diskOuter = top ? g.R.back() : g.R.front();
        c->diskInner = 0.0;
        fx->addFace(c, 0.0, 2.0 * kPi, 0.0, c->diskOuter);
    }
    return fx;
}

// Parameter u of the circle at polar angle `deg` (bisection on the exact NURBS).
double uAtAngle(double deg) {
    Profile unit; unit.p = 1; unit.knots = {0, 0, 1, 1}; unit.R = {1, 1}; unit.Z = {0, 1};
    const NurbsSurface n = revolveSurface(unit, Xf{});
    auto ang = [&](double u) {
        const Vec3 p = n.evaluate(u, 0.0);
        double a = std::atan2(p.y, p.x);
        if (a < 0) a += 2.0 * kPi;
        return a;
    };
    const double target = deg * kPi / 180.0;
    double lo = 0.0, hi = 1.0 - 1e-15;
    for (int it = 0; it < 200; ++it) {
        const double mid = 0.5 * (lo + hi);
        (ang(mid) < target ? lo : hi) = mid;
    }
    return 0.5 * (lo + hi);
}

double rel(double a, double b) { return std::fabs(a - b) / std::max(std::fabs(b), 1e-300); }

std::string fmt(const char* f, double a, double b = 0, double c = 0) {
    char buf[256]; std::snprintf(buf, sizeof buf, f, a, b, c); return buf;
}

struct Case {
    std::string name;
    const Fixture* fx;
    Truth truth;
    double L;
};

// Relative errors of one solid vs its truth, by component group.
struct Err { double V, A, C, I; };
Err errors(const MassProps& m, const Truth& t, double L) {
    Err e{rel(m.volume, t.V), rel(m.area, t.A), 0.0, 0.0};
    double In = 0;
    for (int i = 0; i < 9; ++i) In = std::max(In, std::fabs(t.I[i]));
    for (int i = 0; i < 3; ++i) e.C = std::max(e.C, std::fabs(m.com[i] - t.com[i]) / L);
    for (int i = 0; i < 9; ++i) e.I = std::max(e.I, std::fabs(m.inertiaCom[i] - t.I[i]) / In);
    return e;
}

bool bitEqual(const MassProps& a, const MassProps& b) {
    return std::memcmp(&a.volume, &b.volume, sizeof(double)) == 0 &&
           std::memcmp(&a.area, &b.area, sizeof(double)) == 0 &&
           std::memcmp(a.com, b.com, sizeof a.com) == 0 &&
           std::memcmp(a.inertiaCom, b.inertiaCom, sizeof a.inertiaCom) == 0;
}

} // namespace

int main() {
    std::printf("T-274 massprops NURBS knot-split gate\n");
    const Xf id{};
    const double r = 5.0, h = 10.0;

    // ---- closed-form cylinder truth
    Profile cyl; cyl.p = 1; cyl.knots = {0, 0, 1, 1}; cyl.R = {r, r}; cyl.Z = {0, h};
    Truth tc;
    tc.V = kPi * r * r * h;
    tc.A = 2.0 * kPi * r * h + 2.0 * kPi * r * r;
    tc.com[2] = h / 2.0;
    tc.I[0] = tc.I[4] = tc.V * (3.0 * r * r + h * h) / 12.0;
    tc.I[8] = tc.V * r * r / 2.0;

    // fixture sanity: the 9-point surface IS the radius-5 cylinder
    {
        const NurbsSurface n = revolveSurface(cyl, id);
        double dev = 0;
        for (int i = 0; i <= 97; ++i) {
            const Vec3 p = n.evaluate(i / 97.0, (i % 7) / 6.0);
            dev = std::max(dev, std::fabs(std::sqrt(p.x * p.x + p.y * p.y) - r));
        }
        check(dev < 1e-12, "fixture: rational 9-point surface lies on r=5", fmt("max|rho-r| %.2e", dev));
    }

    const double u120 = uAtAngle(120.0), u240 = uAtAngle(240.0);
    check(u120 > 0.25 && u120 < 0.5 && u240 > 0.5 && u240 < 0.75,
          "fixture: 120/240 deg cuts fall strictly inside knot spans", fmt("u120 %.15f u240 %.15f", u120, u240));

    // ---- G1..G3: cylinder faces whose windows span the C0 circle knots
    auto g1 = buildRevolution(cyl, {0.0, 1.0}, id);
    auto g2 = buildRevolution(cyl, {0.0, u120, u240, 1.0}, id);
    auto g3 = buildRevolution(cyl, {0.0, 0.25, 1.0}, id);

    // ---- G4: stepped profile, degree-1 generatrix with C0 kinks in v (closed form)
    Profile step; step.p = 1; step.knots = {0, 0, 1.0 / 3.0, 2.0 / 3.0, 1, 1};
    step.R = {5, 5, 3, 3}; step.Z = {0, 4, 7, 10};
    const Truth ts = revolutionTruth(step, 8, 16);
    {
        // frustum closed forms (independent of the 1-D reference)
        double Vc = 0, Ac = kPi * 25.0 + kPi * 9.0;
        for (std::size_t k = 0; k < 3; ++k) {
            const double a = step.R[k], b = step.R[k + 1], dz = step.Z[k + 1] - step.Z[k];
            Vc += kPi * dz * (a * a + a * b + b * b) / 3.0;
            Ac += kPi * (a + b) * std::sqrt((b - a) * (b - a) + dz * dz);
        }
        check(rel(ts.V, Vc) < 1e-13 && rel(ts.A, Ac) < 1e-13, "G4 reference == frustum closed form",
              fmt("V %.15f vs %.15f, A rel %.2e", ts.V, Vc, rel(ts.A, Ac)));
    }
    auto g4 = buildRevolution(step, {0.0, u120, u240, 1.0}, id);

    // ---- G5: cubic generatrix, interior knots simple (C2) / double (C1) / triple (C0)
    Profile cub; cub.p = 3;
    cub.knots = {0, 0, 0, 0, 0.2, 0.45, 0.45, 0.7, 0.7, 0.7, 1, 1, 1, 1};
    cub.R = {4, 6, 5, 3, 4.5, 6, 3.5, 4, 5, 4.2};
    cub.Z = {0, 1, 2.2, 3.4, 4.6, 5.5, 6.6, 7.8, 9, 10};
    const Truth tq = revolutionTruth(cub, 8, 16);
    const Truth tq2 = revolutionTruth(cub, 16, 20);
    check(rel(tq.V, tq2.V) < 1e-13 && rel(tq.A, tq2.A) < 1e-13 && rel(tq.I[0], tq2.I[0]) < 1e-13 &&
          rel(tq.I[8], tq2.I[8]) < 1e-13 && rel(tq.com[2], tq2.com[2]) < 1e-13,
          "G5 1-D reference converged (8x16 vs 16x20)", fmt("V rel %.2e A rel %.2e", rel(tq.V, tq2.V), rel(tq.A, tq2.A)));
    auto g5 = buildRevolution(cub, {0.0, 1.0}, id);

    // ---- G6: rigid motion of G2
    const Xf mv = axisAngle(1, 2, 3, 0.7, 100.0, -50.0, 30.0);
    auto g6 = buildRevolution(cyl, {0.0, u120, u240, 1.0}, mv);

    // ---- G9: a window ending a hair past a knot (no sliver cell, no loss)
    auto g9 = buildRevolution(cyl, {0.0, 0.25 * (1.0 + 1e-14), 1.0}, id);

    const std::vector<Case> cases = {
        {"G1 one face u 0..1 (3 interior C0 knots)", g1.get(), tc, h},
        {"G2 cyl3eq: faces 0/120/240 deg", g2.get(), tc, h},
        {"G3 split_cyl3: faces 0->90, 90->360 deg", g3.get(), tc, h},
        {"G4 stepped profile (C0 v kinks) x thirds", g4.get(), ts, 10.0},
        {"G5 cubic generatrix (C2/C1/C0 v knots)", g5.get(), tq, 10.0},
        {"G6 cyl3eq under rotation+translation", g6.get(), moveTruth(tc, mv), h},
        {"G9 window edge 1e-14 past a knot", g9.get(), tc, h},
    };

    // Error table (evidence): relative error of V, A, COM (/L), I (/max|I|).
    std::printf("  error table: gaussN | V A COM I\n");
    for (const Case& c : cases)
        for (int n : {8, 10, 16, 32}) {
            const Err e = errors(massProperties(c.fx->solid, n), c.truth, c.L);
            std::printf("    %-44s n=%2d | %.2e %.2e %.2e %.2e\n", c.name.c_str(), n, e.V, e.A, e.C, e.I);
        }

    // T1 -- the PRODUCTION call (default order): the A1 pin. Volume and area of
    // every face that spans a knot match the closed form / converged reference
    // within 1e-9. (G5's area integrand |S_u x S_v| = R|C'| sqrt(R'^2+Z'^2) is
    // not polynomial; its 8-point error is an ORDER matter, pinned in T2.)
    // G6 is the one exception on VOLUME: off the origin the divergence integrand
    // x n_x carries |translation|/r ~ 24x cancellation, so its default-order
    // volume is held to 1e-8 here (measured 1.65e-9) and to 1e-9 in T2.
    for (const Case& c : cases) {
        const MassProps m = massProperties(c.fx->solid);
        const Err e = errors(m, c.truth, c.L);
        const bool areaPinned = c.fx != g5.get();
        const double tolV = c.fx == g6.get() ? 1e-8 : kTol;
        check(e.V < tolV && (!areaPinned || e.A < kTol),
              "T1 " + c.name + (c.fx == g6.get() ? " V <= 1e-8" : " V <= 1e-9") + (areaPinned ? ", A <= 1e-9" : "") + " (default order)",
              fmt("V %.12f (truth %.12f)", m.volume, c.truth.V) + fmt("  A %.12f (truth %.12f)  relV %.2e", m.area, c.truth.A, e.V) +
              fmt(" relA %.2e", e.A));
    }

    // T2 -- CONVERGENCE: with the rule never straddling a knot, raising the order
    // drives EVERY component (V, A, COM, inertia tensor) of EVERY fixture to the
    // truth within 1e-9. Before the split no order converged (kinked integrand),
    // and every order above 8 except 10 silently ran the 8-point rule.
    for (const Case& c : cases) {
        const Err e = errors(massProperties(c.fx->solid, 32), c.truth, c.L);
        const double w = std::max(std::max(e.V, e.A), std::max(e.C, e.I));
        check(w < kTol, "T2 " + c.name + " all components <= 1e-9 at gaussN 32",
              fmt("V %.2e A %.2e COM %.2e", e.V, e.A, e.C) + fmt(" I %.2e", e.I));
    }

    // G7 -- METAMORPHIC: one face == the same surface cut at its knots, bit for bit
    {
        auto split4 = buildRevolution(cyl, {0.0, 0.25, 0.5, 0.75, 1.0}, id);
        const MassProps a = massProperties(g1->solid), b = massProperties(split4->solid);
        check(bitEqual(a, b), "G7 whole-circle face BIT-IDENTICAL to its 4 knot-span faces",
              fmt("V %a vs %a", a.volume, b.volume));
        auto cubSplit = buildRevolution(cub, {0.0, 0.25, 0.5, 0.75, 1.0}, id);
        const MassProps c = massProperties(g5->solid), d = massProperties(cubSplit->solid);
        check(bitEqual(c, d), "G7 cubic one face BIT-IDENTICAL to its 4 u-span faces",
              fmt("V %a vs %a", c.volume, d.volume));
    }

    // G8 -- the requested order is the order run: 16 is not the 8-point bits, and
    // the error falls 8 -> 16 -> 32 on the hardest fixture (G5 area).
    {
        const MassProps m8 = massProperties(g5->solid, 8), m16 = massProperties(g5->solid, 16),
                        m32 = massProperties(g5->solid, 32);
        const double e8 = rel(m8.area, tq.A), e16 = rel(m16.area, tq.A), e32 = rel(m32.area, tq.A);
        check(std::memcmp(&m8.area, &m16.area, sizeof(double)) != 0 && e16 < e8 && e32 < e16,
              "G8 gaussN 16/32 honoured and converging (G5 area)", fmt("rel 8:%.2e 16:%.2e 32:%.2e", e8, e16, e32));
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
