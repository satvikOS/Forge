// forge/native/geom/primitivefit_test.cpp
//
// Standalone validation gate for forge::native::geom::PrimitiveFit — the in-house
// least-squares fitting of geometric primitives (plane / line / sphere /
// cylinder) to a 3D point set. Pure C++20, no external deps.
//
// Build & run (the task's command):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/PrimitiveFit.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/primitivefit_test.cpp \
//       -o /tmp/k6_PrimitiveFit && /tmp/k6_PrimitiveFit
//
// LINK NOTE (honest): this module references NONE of the exact predicates — it
// only reuses the header-only Point3 type from Geom.hpp. But the named dep
// Geom.cpp itself calls forge::native::orient2d/orient3d (Predicates.cpp), so
// both are passed to the linker. They change nothing about this module.
//
// WHAT IS VALIDATED (the SPEC):
//   (A) Honest degenerate handling, NO fabrication: too-few points, non-finite
//       coordinates, collinear-for-plane, coplanar-for-sphere, isotropic-for-line,
//       flat-patch-for-cylinder all -> ok=false.
//   (B) PLANE: points on a known plane + small noise recover the unit normal
//       (up to sign) and a centroid on the plane within a noise-scaled tol, RMS
//       tracks the noise level.
//   (C) LINE: points on a known line + small noise recover the unit direction
//       (up to sign) within a noise-scaled tol, RMS tracks the noise level.
//   (D) SPHERE: points on a known sphere + small noise recover center+radius;
//       the explicit SPEC bar — center & radius within 1% at 1% noise — is
//       asserted, and RMS tracks the noise level.
//   (E) CYLINDER: points on a known cylinder + small noise recover the axis
//       direction (up to sign), a point on the axis, and the radius within a
//       noise-scaled tol; RMS tracks the noise level.
//   (F) The exposed symmetricEigen3 building block: eigenvalues ascending,
//       eigenvectors orthonormal, A v = lambda v for a known matrix.
//
//   A fresh std::random_device seed is printed so any failure reproduces.
//
// NEVER weaken an assertion: tolerances are scaled to the injected noise sigma,
// which is the honest statistical bar for a least-squares estimator.

#include <cstdint>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

#include "forge/native/geom/PrimitiveFit.hpp"
#include "forge/native/geom/Geom.hpp"

using forge::native::geom::Point3;
using forge::native::geom::PlaneFit;
using forge::native::geom::LineFit;
using forge::native::geom::SphereFit;
using forge::native::geom::CylinderFit;
using forge::native::geom::fitPlane;
using forge::native::geom::fitLine;
using forge::native::geom::fitSphere;
using forge::native::geom::fitCylinder;
using forge::native::geom::symmetricEigen3;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) ++g_pass;
    else      std::printf("  [FAIL] %s\n", name);
}

using V3 = std::array<double, 3>;
static double dot3(const V3& a, const V3& b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
static double nrm3(const V3& a) { return std::sqrt(dot3(a, a)); }
static V3 unit3(const V3& a) { const double n = nrm3(a); return V3{{a[0]/n, a[1]/n, a[2]/n}}; }
// |cos angle| between two directions, robust to sign (primitives are sign-free).
static double absCos(const V3& a, const V3& b) {
    return std::fabs(dot3(unit3(a), unit3(b)));
}

int main() {
    std::printf("== forge::native::geom::PrimitiveFit (least-squares primitive fitting) gate ==\n");

    std::random_device rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("seed = %llu\n", static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    std::uniform_real_distribution<double> U(0.0, 1.0);
    std::uniform_real_distribution<double> Cen(-20.0, 20.0);
    std::uniform_real_distribution<double> Rad(1.0, 12.0);
    auto unitDir = [&]() {
        for (;;) {
            V3 d{{2*U(rng)-1, 2*U(rng)-1, 2*U(rng)-1}};
            const double n = nrm3(d);
            if (n > 1e-3) return V3{{d[0]/n, d[1]/n, d[2]/n}};
        }
    };

    // =======================================================================
    // (A) Honest degenerate handling — NO fabrication.
    // =======================================================================
    {
        check(!fitPlane(std::vector<Point3>{{0,0,0},{1,0,0}}).ok, "plane: <3 points -> ok=false");
        check(!fitLine(std::vector<Point3>{{0,0,0}}).ok,          "line: <2 points -> ok=false");
        check(!fitSphere(std::vector<Point3>{{0,0,0},{1,0,0},{0,1,0}}).ok,
              "sphere: <4 points -> ok=false");
        check(!fitCylinder(std::vector<Point3>{{0,0,0},{1,0,0},{0,1,0},{1,1,0},{0.5,0.5,0}}).ok,
              "cylinder: <6 points -> ok=false");

        // Collinear points -> NO unique plane.
        std::vector<Point3> coll;
        for (int i = 0; i < 40; ++i) coll.push_back(Point3{static_cast<double>(i), 2.0*i, -i+1.0});
        check(!fitPlane(coll).ok, "plane: collinear -> ok=false (normal ambiguous)");

        // Coplanar points -> NO finite sphere.
        std::vector<Point3> copl;
        for (int i = 0; i < 60; ++i) copl.push_back(Point3{U(rng)*10, U(rng)*10, 3.0});
        check(!fitSphere(copl).ok, "sphere: coplanar -> ok=false (system singular)");

        // Isotropic blob -> NO line direction.
        std::vector<Point3> blob;
        for (int i = 0; i < 200; ++i) blob.push_back(Point3{2*U(rng)-1, 2*U(rng)-1, 2*U(rng)-1});
        check(!fitLine(blob).ok, "line: isotropic blob -> ok=false (no dominant axis)");

        // Non-finite coordinate -> ok=false for every fitter.
        std::vector<Point3> nf;
        for (int i = 0; i < 30; ++i) nf.push_back(Point3{U(rng), U(rng), U(rng)});
        nf[5].y = std::numeric_limits<double>::quiet_NaN();
        check(!fitSphere(nf).ok,   "sphere: non-finite -> ok=false");
        check(!fitCylinder(nf).ok, "cylinder: non-finite -> ok=false");
    }

    // =======================================================================
    // (B) PLANE recovery from noisy on-plane samples.
    // =======================================================================
    {
        const int kInst = 20;
        int normOk = 0, onPlaneOk = 0, rmsOk = 0, allOk = 0;
        for (int inst = 0; inst < kInst; ++inst) {
            const V3 nrm = unitDir();
            const V3 p0{{Cen(rng), Cen(rng), Cen(rng)}};
            // Two in-plane basis vectors.
            V3 ref = (std::fabs(nrm[0]) < 0.9) ? V3{{1,0,0}} : V3{{0,1,0}};
            V3 e1{{ nrm[1]*ref[2]-nrm[2]*ref[1], nrm[2]*ref[0]-nrm[0]*ref[2], nrm[0]*ref[1]-nrm[1]*ref[0] }};
            e1 = unit3(e1);
            V3 e2{{ nrm[1]*e1[2]-nrm[2]*e1[1], nrm[2]*e1[0]-nrm[0]*e1[2], nrm[0]*e1[1]-nrm[1]*e1[0] }};

            const double extent = 10.0;
            const double sigma  = 0.01 * extent;           // 1% of feature size
            std::normal_distribution<double> Noise(0.0, sigma);
            std::uniform_real_distribution<double> Uv(-extent, extent);
            std::vector<Point3> pts;
            for (int i = 0; i < 400; ++i) {
                const double a = Uv(rng), b = Uv(rng);
                const double nn = Noise(rng);
                pts.push_back(Point3{
                    p0[0] + a*e1[0] + b*e2[0] + nn*nrm[0],
                    p0[1] + a*e1[1] + b*e2[1] + nn*nrm[1],
                    p0[2] + a*e1[2] + b*e2[2] + nn*nrm[2] });
            }
            PlaneFit f = fitPlane(pts);
            bool nOk = f.ok && absCos(f.normal, nrm) > 0.999;          // normal recovered
            // Centroid must lie ON the true plane (perp distance small).
            double perp = 0.0;
            if (f.ok) {
                perp = std::fabs(nrm[0]*(f.point[0]-p0[0]) + nrm[1]*(f.point[1]-p0[1]) + nrm[2]*(f.point[2]-p0[2]));
            }
            bool pOk = f.ok && perp < 5.0 * sigma;
            bool rOk = f.ok && f.rms < 2.0 * sigma && f.rms > 0.2 * sigma; // tracks noise
            if (nOk) ++normOk; if (pOk) ++onPlaneOk; if (rOk) ++rmsOk;
            if (nOk && pOk && rOk) ++allOk;
        }
        check(normOk    == kInst, "PLANE: unit normal recovered (|cos|>0.999) all instances");
        check(onPlaneOk == kInst, "PLANE: returned point lies on the true plane all instances");
        check(rmsOk     == kInst, "PLANE: RMS tracks the noise level all instances");
        check(allOk     == kInst, "PLANE: all three criteria together all instances");
    }

    // =======================================================================
    // (C) LINE recovery from noisy on-line samples.
    // =======================================================================
    {
        const int kInst = 20;
        int dirOk = 0, onLineOk = 0, rmsOk = 0, allOk = 0;
        for (int inst = 0; inst < kInst; ++inst) {
            const V3 dir = unitDir();
            const V3 p0{{Cen(rng), Cen(rng), Cen(rng)}};
            // Two directions perpendicular to dir for the noise.
            V3 ref = (std::fabs(dir[0]) < 0.9) ? V3{{1,0,0}} : V3{{0,1,0}};
            V3 e1{{ dir[1]*ref[2]-dir[2]*ref[1], dir[2]*ref[0]-dir[0]*ref[2], dir[0]*ref[1]-dir[1]*ref[0] }};
            e1 = unit3(e1);
            V3 e2{{ dir[1]*e1[2]-dir[2]*e1[1], dir[2]*e1[0]-dir[0]*e1[2], dir[0]*e1[1]-dir[1]*e1[0] }};

            const double extent = 20.0;
            const double sigma  = 0.01 * extent;
            std::normal_distribution<double> Noise(0.0, sigma);
            std::uniform_real_distribution<double> Tt(-extent, extent);
            std::vector<Point3> pts;
            for (int i = 0; i < 300; ++i) {
                const double t = Tt(rng);
                const double n1 = Noise(rng), n2 = Noise(rng);
                pts.push_back(Point3{
                    p0[0] + t*dir[0] + n1*e1[0] + n2*e2[0],
                    p0[1] + t*dir[1] + n1*e1[1] + n2*e2[1],
                    p0[2] + t*dir[2] + n1*e1[2] + n2*e2[2] });
            }
            LineFit f = fitLine(pts);
            bool dOk = f.ok && absCos(f.direction, dir) > 0.999;
            // Returned point must lie ON the true line (perp distance small).
            double perp = 0.0;
            if (f.ok) {
                V3 d{{f.point[0]-p0[0], f.point[1]-p0[1], f.point[2]-p0[2]}};
                const double along = dot3(d, dir);
                V3 pp{{d[0]-along*dir[0], d[1]-along*dir[1], d[2]-along*dir[2]}};
                perp = nrm3(pp);
            }
            bool pOk = f.ok && perp < 5.0 * sigma;
            // RMS is the perpendicular spread ~ sigma*sqrt(2) (two perp dims).
            bool rOk = f.ok && f.rms < 2.5 * sigma && f.rms > 0.3 * sigma;
            if (dOk) ++dirOk; if (pOk) ++onLineOk; if (rOk) ++rmsOk;
            if (dOk && pOk && rOk) ++allOk;
        }
        check(dirOk    == kInst, "LINE: unit direction recovered (|cos|>0.999) all instances");
        check(onLineOk == kInst, "LINE: returned point lies on the true line all instances");
        check(rmsOk    == kInst, "LINE: RMS tracks the noise level all instances");
        check(allOk    == kInst, "LINE: all three criteria together all instances");
    }

    // =======================================================================
    // (D) SPHERE recovery — including the explicit SPEC bar (1% at 1% noise).
    // =======================================================================
    {
        const int kInst = 25;
        int specCenterOk = 0, specRadOk = 0, rmsOk = 0, allOk = 0;
        for (int inst = 0; inst < kInst; ++inst) {
            const double R = Rad(rng);
            const V3 C{{Cen(rng), Cen(rng), Cen(rng)}};
            const double sigma = 0.01 * R;                 // 1% noise
            std::normal_distribution<double> Noise(0.0, sigma);
            std::vector<Point3> pts;
            // Include the 6 axis poles for good coverage, then many random.
            const double ax[6][3] = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
            for (auto& a : ax) {
                const double rr = R + Noise(rng);
                pts.push_back(Point3{C[0]+a[0]*rr, C[1]+a[1]*rr, C[2]+a[2]*rr});
            }
            for (int i = 0; i < 400; ++i) {
                V3 d{{2*U(rng)-1, 2*U(rng)-1, 2*U(rng)-1}};
                double L = nrm3(d);
                if (L < 1e-9) { d = V3{{1,0,0}}; L = 1; }
                const double rr = R + Noise(rng);
                pts.push_back(Point3{C[0]+d[0]/L*rr, C[1]+d[1]/L*rr, C[2]+d[2]/L*rr});
            }
            SphereFit f = fitSphere(pts);
            // SPEC bar: center within 1% of R, radius within 1% of R, at 1% noise.
            double cErr = 0.0;
            if (f.ok) {
                V3 d{{f.center[0]-C[0], f.center[1]-C[1], f.center[2]-C[2]}};
                cErr = nrm3(d);
            }
            bool cOk = f.ok && cErr < 0.01 * R;
            bool radOk = f.ok && std::fabs(f.radius - R) < 0.01 * R;
            bool rOk = f.ok && f.rms < 2.0 * sigma && f.rms > 0.3 * sigma;
            if (cOk) ++specCenterOk; if (radOk) ++specRadOk; if (rOk) ++rmsOk;
            if (cOk && radOk && rOk) ++allOk;
        }
        check(specCenterOk == kInst, "SPHERE: center within 1% at 1% noise (SPEC) all instances");
        check(specRadOk    == kInst, "SPHERE: radius within 1% at 1% noise (SPEC) all instances");
        check(rmsOk        == kInst, "SPHERE: RMS tracks the noise level all instances");
        check(allOk        == kInst, "SPHERE: all three criteria together all instances");
    }

    // =======================================================================
    // (E) CYLINDER recovery from noisy on-surface samples.
    // =======================================================================
    {
        const int kInst = 20;
        int axisOk = 0, axisPtOk = 0, radOk = 0, rmsOk = 0, allOk = 0;
        for (int inst = 0; inst < kInst; ++inst) {
            const V3 axis = unitDir();
            const V3 p0{{Cen(rng), Cen(rng), Cen(rng)}};   // a point on the axis
            const double R = Rad(rng);
            // Tangent frame perpendicular to axis.
            V3 ref = (std::fabs(axis[0]) < 0.9) ? V3{{1,0,0}} : V3{{0,1,0}};
            V3 e1{{ axis[1]*ref[2]-axis[2]*ref[1], axis[2]*ref[0]-axis[0]*ref[2], axis[0]*ref[1]-axis[1]*ref[0] }};
            e1 = unit3(e1);
            V3 e2{{ axis[1]*e1[2]-axis[2]*e1[1], axis[2]*e1[0]-axis[0]*e1[2], axis[0]*e1[1]-axis[1]*e1[0] }};

            const double height = 12.0;
            const double sigma  = 0.01 * R;
            std::normal_distribution<double> Noise(0.0, sigma);
            std::uniform_real_distribution<double> Hh(-height, height);
            std::uniform_real_distribution<double> Th(0.0, 2.0 * M_PI);
            std::vector<Point3> pts;
            for (int i = 0; i < 600; ++i) {
                const double h = Hh(rng), th = Th(rng);
                const double rr = R + Noise(rng);
                const double cx = std::cos(th) * rr, cy = std::sin(th) * rr;
                pts.push_back(Point3{
                    p0[0] + h*axis[0] + cx*e1[0] + cy*e2[0],
                    p0[1] + h*axis[1] + cx*e1[1] + cy*e2[1],
                    p0[2] + h*axis[2] + cx*e1[2] + cy*e2[2] });
            }
            CylinderFit f = fitCylinder(pts);
            bool aOk = f.ok && absCos(f.axisDir, axis) > 0.99;   // axis dir (noisy est)
            // Returned axisPoint must lie ON the true axis (perp distance small).
            double perp = 0.0;
            if (f.ok) {
                V3 d{{f.axisPoint[0]-p0[0], f.axisPoint[1]-p0[1], f.axisPoint[2]-p0[2]}};
                const double along = dot3(d, axis);
                V3 pp{{d[0]-along*axis[0], d[1]-along*axis[1], d[2]-along*axis[2]}};
                perp = nrm3(pp);
            }
            bool apOk = f.ok && perp < 0.05 * R;
            bool rdOk = f.ok && std::fabs(f.radius - R) < 0.03 * R;
            bool rmOk = f.ok && f.rms < 2.5 * sigma;
            if (aOk) ++axisOk; if (apOk) ++axisPtOk; if (rdOk) ++radOk; if (rmOk) ++rmsOk;
            if (aOk && apOk && rdOk && rmOk) ++allOk;
        }
        check(axisOk   == kInst, "CYLINDER: axis direction recovered (|cos|>0.99) all instances");
        check(axisPtOk == kInst, "CYLINDER: returned axis point lies on the true axis all instances");
        check(radOk    == kInst, "CYLINDER: radius within 3% all instances");
        check(rmsOk    == kInst, "CYLINDER: RMS tracks the noise level all instances");
        check(allOk    == kInst, "CYLINDER: all four criteria together all instances");
    }

    // =======================================================================
    // (F) symmetricEigen3 building block — eigenpairs of a known matrix.
    //     Use a diagonal-similar matrix with known eigenvalues {1, 4, 9}.
    // =======================================================================
    {
        // A = R diag(1,4,9) R^T for a fixed rotation; check ascending evals and
        // the eigen-relation A v = lambda v.
        const double m00 = 4.0, m11 = 6.0, m22 = 4.0, m01 = 0.0, m02 = 2.0, m12 = 0.0;
        // Eigenvalues of [[4,0,2],[0,6,0],[2,0,4]] are 2, 6, 6? compute honestly:
        // block [[4,2],[2,4]] -> evals 2 and 6; plus the standalone 6 -> {2,6,6}.
        std::array<double, 6> M = {{m00, m11, m22, m01, m02, m12}};
        std::array<double, 3> ev;
        std::array<std::array<double, 3>, 3> evec;
        bool ok = symmetricEigen3(M, ev, evec);
        check(ok, "eigen3: solve succeeded");
        check(ok && ev[0] <= ev[1] + 1e-12 && ev[1] <= ev[2] + 1e-12,
              "eigen3: eigenvalues ascending");
        check(ok && std::fabs(ev[0] - 2.0) < 1e-9, "eigen3: smallest eigenvalue == 2");
        check(ok && std::fabs(ev[2] - 6.0) < 1e-9, "eigen3: largest eigenvalue == 6");
        // Orthonormal eigenvectors.
        bool orth = ok;
        for (int i = 0; i < 3 && orth; ++i) {
            orth = orth && std::fabs(nrm3(evec[i]) - 1.0) < 1e-9;
            for (int j = i + 1; j < 3; ++j)
                orth = orth && std::fabs(dot3(evec[i], evec[j])) < 1e-8;
        }
        check(orth, "eigen3: eigenvectors orthonormal");
        // A v_i == lambda_i v_i.
        bool rel = ok;
        const double A[3][3] = {{m00,m01,m02},{m01,m11,m12},{m02,m12,m22}};
        for (int i = 0; i < 3 && rel; ++i) {
            const V3& v = evec[i];
            V3 Av{{ A[0][0]*v[0]+A[0][1]*v[1]+A[0][2]*v[2],
                    A[1][0]*v[0]+A[1][1]*v[1]+A[1][2]*v[2],
                    A[2][0]*v[0]+A[2][1]*v[1]+A[2][2]*v[2] }};
            for (int k = 0; k < 3; ++k)
                rel = rel && std::fabs(Av[k] - ev[i]*v[k]) < 1e-8;
        }
        check(rel, "eigen3: A v == lambda v for every eigenpair");
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
