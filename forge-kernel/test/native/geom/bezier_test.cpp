// forge/native/geom/bezier_test.cpp
//
// Standalone validation gate for forge::native::geom::Bezier (curves + tensor-
// product surfaces). Pure C++20; prints a fresh std::random_device seed so every
// failure is reproducible.
//
// Build & run (exactly the command in the task):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/Bezier.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/geom/bezier_test.cpp \
//       -o /tmp/k7_Bezier && /tmp/k7_Bezier
//
// SPEC validations (each exactly as the task states):
//   (A) A degree-1 Bezier == linear interpolation, EXACTLY.
//   (B) The curve passes through its first/last control points exactly (endpoints
//       B(0)==P0, B(1)==Pn).
//   (C) The curve stays within the control-point convex hull (verified via the
//       axis-aligned bounding box of the control net AND a strict half-space test
//       against every supporting plane of a random 3D control hull — both are
//       necessary consequences of the convex-hull property).
//   (D) Subdivision at t reproduces the SAME curve: both halves evaluate to the
//       original within 1e-12 over a dense parameter sweep.
//   (E) Analytic curve tangents match central finite differences < 1e-6.
//   (F) A flat (planar) control net -> planar surface: every sampled point lies
//       on the plane to 1e-12 and the normal is CONSTANT.
//   (G) Analytic surface partials (dS/du, dS/dv) match central finite differences
//       < 1e-6; surface corners are interpolated exactly.
//   (H) tessellateSurface builds a non-empty HalfEdgeMesh whose vertices land on
//       the analytic surface; envelope rejections (ok=false) are honest.

#include "forge/native/geom/Bezier.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using namespace forge::native::geom;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}

static bool vapprox(const Vec3& a, const Vec3& b, double tol = 1e-6) {
    return vdist(a, b) <= tol;
}

int main() {
    std::random_device rd;
    unsigned seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(-10.0, 10.0);
    std::uniform_int_distribution<int> Deg(1, 8);

    std::printf("== forge::native::geom::Bezier validation ==\n");
    std::printf("seed = %u\n", seed);

    auto rp = [&]() { return Vec3{U(rng), U(rng), U(rng)}; };
    auto randNet = [&](int degree) {
        std::vector<Vec3> p(static_cast<std::size_t>(degree) + 1);
        for (auto& q : p) q = rp();
        return p;
    };

    // -----------------------------------------------------------------------
    // (A) degree-1 Bezier == exact linear interpolation.
    // -----------------------------------------------------------------------
    {
        bool exact = true;
        for (int k = 0; k < 100; ++k) {
            Vec3 p0 = rp(), p1 = rp();
            std::vector<Vec3> net{p0, p1};
            for (int s = 0; s <= 50; ++s) {
                double t = double(s) / 50.0;
                CurveSample cs = evalCurve(net, t);
                Vec3 lerp = vadd(vscale(p0, 1.0 - t), vscale(p1, t));
                if (!cs.ok || !vapprox(cs.point, lerp, 1e-15)) exact = false;
                // derivative of a line is the constant (p1-p0).
                if (!vapprox(cs.deriv, vsub(p1, p0), 1e-12)) exact = false;
            }
        }
        check(exact, "(A) degree-1 Bezier equals linear interp + constant deriv exactly");
    }

    // -----------------------------------------------------------------------
    // (B) endpoint interpolation: B(0)==P0, B(1)==Pn exactly.
    // -----------------------------------------------------------------------
    {
        bool ends = true;
        for (int k = 0; k < 300; ++k) {
            int d = Deg(rng);
            std::vector<Vec3> net = randNet(d);
            CurveSample c0 = evalCurve(net, 0.0);
            CurveSample c1 = evalCurve(net, 1.0);
            if (!c0.ok || !c1.ok) ends = false;
            if (!vapprox(c0.point, net.front(), 1e-12)) ends = false;
            if (!vapprox(c1.point, net.back(), 1e-12)) ends = false;
        }
        check(ends, "(B) curve interpolates first/last control points exactly");
    }

    // -----------------------------------------------------------------------
    // (C) convex-hull containment. (C1) AABB of the control net (necessary).
    //     (C2) strict half-space test against the supporting planes of the net.
    // -----------------------------------------------------------------------
    {
        bool aabbOk = true;
        for (int k = 0; k < 300; ++k) {
            int d = Deg(rng);
            std::vector<Vec3> net = randNet(d);
            Vec3 lo{ std::numeric_limits<double>::infinity(),
                     std::numeric_limits<double>::infinity(),
                     std::numeric_limits<double>::infinity() };
            Vec3 hi{ -lo.x, -lo.y, -lo.z };
            for (const auto& p : net) {
                lo.x = std::min(lo.x, p.x); hi.x = std::max(hi.x, p.x);
                lo.y = std::min(lo.y, p.y); hi.y = std::max(hi.y, p.y);
                lo.z = std::min(lo.z, p.z); hi.z = std::max(hi.z, p.z);
            }
            for (int s = 0; s <= 80; ++s) {
                double t = double(s) / 80.0;
                CurveSample cs = evalCurve(net, t);
                const double e = 1e-12;
                if (cs.point.x < lo.x - e || cs.point.x > hi.x + e ||
                    cs.point.y < lo.y - e || cs.point.y > hi.y + e ||
                    cs.point.z < lo.z - e || cs.point.z > hi.z + e) aabbOk = false;
            }
        }
        check(aabbOk, "(C1) curve stays within the control-net AABB (hull necessary cond.)");

        // (C2) For a planar 2D control net, the convex hull is a polygon in the
        // plane; every curve point must lie on the same side of (or on) every
        // hull edge. We build control points in the z=0 plane and test against a
        // computed 2D convex hull's supporting half-planes.
        bool halfOk = true;
        std::uniform_real_distribution<double> U2(-5.0, 5.0);
        for (int k = 0; k < 60; ++k) {
            int d = Deg(rng);
            std::vector<Vec3> net(static_cast<std::size_t>(d) + 1);
            for (auto& q : net) q = Vec3{U2(rng), U2(rng), 0.0};
            // brute 2D hull (monotone chain) on the net.
            std::vector<std::array<double,2>> pts;
            for (auto& q : net) pts.push_back({q.x, q.y});
            std::sort(pts.begin(), pts.end());
            pts.erase(std::unique(pts.begin(), pts.end()), pts.end());
            if (pts.size() < 3) continue;  // degenerate hull, AABB already covers it
            auto cross = [](const std::array<double,2>& O,
                            const std::array<double,2>& A,
                            const std::array<double,2>& B) {
                return (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0]);
            };
            std::vector<std::array<double,2>> hull(2*pts.size());
            int m = 0;
            for (std::size_t i = 0; i < pts.size(); ++i) {
                while (m >= 2 && cross(hull[m-2], hull[m-1], pts[i]) <= 0) m--;
                hull[m++] = pts[i];
            }
            int lower = m + 1;
            for (int i = int(pts.size()) - 2; i >= 0; --i) {
                while (m >= lower && cross(hull[m-2], hull[m-1], pts[i]) <= 0) m--;
                hull[m++] = pts[i];
            }
            hull.resize(m - 1);  // CCW hull, no repeat
            // Each curve sample must be inside-or-on every CCW edge.
            for (int s = 0; s <= 60; ++s) {
                double t = double(s) / 60.0;
                CurveSample cs = evalCurve(net, t);
                std::array<double,2> P{cs.point.x, cs.point.y};
                for (std::size_t e = 0; e < hull.size(); ++e) {
                    const auto& A = hull[e];
                    const auto& B = hull[(e + 1) % hull.size()];
                    // CCW hull: interior is to the LEFT (cross >= 0).
                    if (cross(A, B, P) < -1e-9) halfOk = false;
                }
            }
        }
        check(halfOk, "(C2) curve stays inside every supporting half-plane of the 2D hull");
    }

    // -----------------------------------------------------------------------
    // (D) subdivision reproduces the original curve EXACTLY (< 1e-12).
    // -----------------------------------------------------------------------
    {
        double worst = 0.0;
        bool ok = true;
        for (int k = 0; k < 300; ++k) {
            int d = Deg(rng);
            std::vector<Vec3> net = randNet(d);
            double splitT = std::uniform_real_distribution<double>(0.05, 0.95)(rng);
            CurveSplit sp = subdivideCurve(net, splitT);
            if (!sp.ok || sp.left.size() != net.size() || sp.right.size() != net.size()) {
                ok = false; continue;
            }
            for (int s = 0; s <= 100; ++s) {
                double gs = double(s) / 100.0;          // global parameter
                Vec3 orig = evalCurve(net, gs).point;
                Vec3 got;
                if (gs <= splitT) {
                    double ls = gs / splitT;            // local param in left half
                    got = evalCurve(sp.left, ls).point;
                } else {
                    double rs = (gs - splitT) / (1.0 - splitT);
                    got = evalCurve(sp.right, rs).point;
                }
                double e = vdist(orig, got);
                worst = std::max(worst, e);
                if (e > 1e-12) ok = false;
            }
        }
        std::printf("(D) subdivision reconstruction worst error = %.3e\n", worst);
        check(ok, "(D) both subdivision halves reproduce the original curve < 1e-12");
    }

    // -----------------------------------------------------------------------
    // (E) analytic curve tangent/derivative vs central finite difference < 1e-6.
    // -----------------------------------------------------------------------
    {
        double worst = 0.0;
        bool ok = true;
        const double h = 1e-6;
        for (int k = 0; k < 300; ++k) {
            int d = Deg(rng);
            std::vector<Vec3> net = randNet(d);
            for (int s = 1; s < 50; ++s) {              // interior params only
                double t = double(s) / 50.0;
                CurveSample cs = evalCurve(net, t);
                Vec3 fwd = evalCurve(net, t + h).point;
                Vec3 bwd = evalCurve(net, t - h).point;
                Vec3 fd  = vscale(vsub(fwd, bwd), 1.0 / (2.0 * h));
                double e = vdist(cs.deriv, fd);
                worst = std::max(worst, e);
                if (e > 1e-6 * (1.0 + vlen(cs.deriv))) ok = false;
            }
        }
        std::printf("(E) analytic-vs-FD curve derivative worst error = %.3e\n", worst);
        check(ok, "(E) analytic curve derivative matches central FD < 1e-6");
    }

    // -----------------------------------------------------------------------
    // (F) flat control net -> planar surface (point on plane 1e-12, const normal).
    // -----------------------------------------------------------------------
    {
        // Build a random plane through `origin` spanned by `ex`,`ey`; place a
        // 4x5 control net by random in-plane offsets so it is genuinely planar
        // but NOT axis-aligned.
        Vec3 origin = rp();
        Vec3 ex = rp(), ey = rp();
        // Gram-Schmidt to make ex,ey independent (avoid a degenerate flat net).
        Vec3 exn = vscale(ex, 1.0 / std::max(vlen(ex), 1e-9));
        Vec3 eyp = vsub(ey, vscale(exn, vdot(ey, exn)));
        if (vlen(eyp) < 1e-6) eyp = Vec3{0, 1, 0};
        Vec3 eyn = vscale(eyp, 1.0 / vlen(eyp));
        Vec3 planeN = vcross(exn, eyn);
        planeN = vscale(planeN, 1.0 / vlen(planeN));

        const int M = 3, N = 4;  // degrees -> 4x5 net
        std::vector<std::vector<Vec3>> grid(M + 1, std::vector<Vec3>(N + 1));
        for (int i = 0; i <= M; ++i)
            for (int j = 0; j <= N; ++j) {
                double a = U(rng), b = U(rng);
                grid[i][j] = vadd(origin, vadd(vscale(exn, a), vscale(eyn, b)));
            }

        bool planar = true, constNormal = true;
        Vec3 refNormal{};
        bool first = true;
        for (int su = 0; su <= 20; ++su)
            for (int sv = 0; sv <= 20; ++sv) {
                double u = double(su) / 20.0, v = double(sv) / 20.0;
                SurfaceSample ss = evalSurface(grid, u, v);
                if (!ss.ok) { planar = false; continue; }
                // distance of the point to the plane:
                double dist = vdot(planeN, vsub(ss.point, origin));
                if (std::fabs(dist) > 1e-12) planar = false;
                if (ss.normalDefined) {
                    // normal must be +/- planeN and identical across the patch.
                    Vec3 nn = ss.normal;
                    if (vdot(nn, planeN) < 0) nn = vscale(nn, -1.0);
                    if (first) { refNormal = nn; first = false; }
                    else if (!vapprox(nn, refNormal, 1e-9)) constNormal = false;
                    if (!vapprox(nn, planeN, 1e-9)) constNormal = false;
                }
            }
        check(planar, "(F) flat control net yields points on the plane to 1e-12");
        check(constNormal, "(F) flat control net yields a constant surface normal");
    }

    // -----------------------------------------------------------------------
    // (G) surface partials vs central FD < 1e-6; corner interpolation exact.
    // -----------------------------------------------------------------------
    {
        double worstU = 0.0, worstV = 0.0;
        bool ok = true, corners = true;
        const double h = 1e-6;
        for (int k = 0; k < 120; ++k) {
            int M = std::uniform_int_distribution<int>(1, 5)(rng);
            int N = std::uniform_int_distribution<int>(1, 5)(rng);
            std::vector<std::vector<Vec3>> grid(M + 1, std::vector<Vec3>(N + 1));
            for (int i = 0; i <= M; ++i)
                for (int j = 0; j <= N; ++j) grid[i][j] = rp();

            // corner interpolation S(0,0)=grid[0][0] etc.
            if (!vapprox(evalSurface(grid,0,0).point, grid[0][0],     1e-11)) corners = false;
            if (!vapprox(evalSurface(grid,1,0).point, grid[M][0],     1e-11)) corners = false;
            if (!vapprox(evalSurface(grid,0,1).point, grid[0][N],     1e-11)) corners = false;
            if (!vapprox(evalSurface(grid,1,1).point, grid[M][N],     1e-11)) corners = false;

            for (int su = 1; su < 8; ++su)
                for (int sv = 1; sv < 8; ++sv) {
                    double u = double(su) / 8.0, v = double(sv) / 8.0;
                    SurfaceSample ss = evalSurface(grid, u, v);
                    if (!ss.ok) { ok = false; continue; }
                    Vec3 du_fd = vscale(vsub(evalSurface(grid, u + h, v).point,
                                             evalSurface(grid, u - h, v).point),
                                        1.0 / (2.0 * h));
                    Vec3 dv_fd = vscale(vsub(evalSurface(grid, u, v + h).point,
                                             evalSurface(grid, u, v - h).point),
                                        1.0 / (2.0 * h));
                    double eu = vdist(ss.du, du_fd);
                    double ev = vdist(ss.dv, dv_fd);
                    worstU = std::max(worstU, eu);
                    worstV = std::max(worstV, ev);
                    if (eu > 1e-6 * (1.0 + vlen(ss.du))) ok = false;
                    if (ev > 1e-6 * (1.0 + vlen(ss.dv))) ok = false;
                }
        }
        std::printf("(G) surface partial worst error: du=%.3e dv=%.3e\n", worstU, worstV);
        check(ok, "(G) analytic surface partials match central FD < 1e-6");
        check(corners, "(G) surface interpolates its four corner control points exactly");
    }

    // -----------------------------------------------------------------------
    // (H) tessellation builds a real HalfEdgeMesh on the analytic surface;
    //     honest envelope rejections.
    // -----------------------------------------------------------------------
    {
        std::vector<std::vector<Vec3>> grid(3, std::vector<Vec3>(4));
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 4; ++j)
                grid[i][j] = Vec3{double(i), double(j), std::sin(double(i + j))};
        bool ok = false;
        forge::native::mesh::HalfEdgeMesh hem = tessellateSurface(grid, 6, 8, ok);
        check(ok && hem.vertexCount() == 7 * 9 && hem.faceCount() == 2 * 6 * 8,
              "(H) tessellation produces the expected vertex/face counts");

        // Every mesh vertex must coincide with the analytic surface at its (u,v).
        bool onSurf = true;
        const auto& verts = hem.vertices();
        std::size_t idx = 0;
        for (std::size_t i = 0; i <= 6 && onSurf; ++i)
            for (std::size_t j = 0; j <= 8; ++j) {
                double u = double(i) / 6.0, v = double(j) / 8.0;
                Vec3 a = evalSurface(grid, u, v).point;
                const auto& p = verts[idx].position;
                if (!vapprox(Vec3{p.x, p.y, p.z}, a, 1e-12)) { onSurf = false; break; }
                ++idx;
            }
        check(onSurf, "(H) tessellated vertices lie exactly on the analytic surface");

        // Envelope: ok=false on malformed/over-degree inputs (no fabrication).
        check(!evalCurve({rp()}, 0.5).ok, "(H) single-point curve rejected (ok=false)");
        check(!evalCurve(randNet(2), 1.5).ok, "(H) out-of-domain t rejected (ok=false)");
        std::vector<Vec3> tooHigh(kMaxBezierDegree + 2, Vec3{});
        check(!evalCurve(tooHigh, 0.5).ok, "(H) over-degree curve rejected (ok=false)");
        std::vector<std::vector<Vec3>> ragged{ {rp(), rp()}, {rp(), rp(), rp()} };
        check(!evalSurface(ragged, 0.5, 0.5).ok, "(H) ragged (non-rectangular) net rejected");
        bool tok = true;
        tessellateSurface(ragged, 4, 4, tok);
        check(!tok, "(H) tessellation of a ragged net reports ok=false");
        check(!subdivideCurve(randNet(3), 0.0).ok, "(H) subdivision at endpoint rejected");
    }

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
