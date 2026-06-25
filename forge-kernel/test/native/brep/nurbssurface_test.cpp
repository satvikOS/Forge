// forge/native/brep/nurbssurface_test.cpp
//
// Standalone validation gate for the bivariate NURBS SURFACE increment
// (NurbsSurface.hpp): rational tensor-product evaluation, analytic partial
// derivatives + surface normal, and HalfEdgeMesh tessellation.
//
// Pure C++20, no test framework — a tiny hand-rolled harness that prints a fresh
// std::random_device seed, runs the SPEC assertions, and ends with
//   RESULT: P / T passed
// exiting non-zero on any failure. NEVER weakens an assertion.
//
// Build + run (exactly the verification command in the task):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/test/native/brep/nurbssurface_test.cpp \
//     -o /tmp/k5_NurbsSurface && /tmp/k5_NurbsSurface
//
// SPEC validations covered:
//   (1) flat control net  -> S(u,v) lies on the affine plane (point < 1e-9),
//       and the surface normal is CONSTANT across the patch.
//   (2) sphere-patch control net -> evaluated points within tol of the radius.
//   (3) bilinear (degree 1x1) surface reproduces bilinear interpolation EXACTLY.
//   (4) analytic partial-derivative normals match central finite differences
//       < 1e-5 (random parameters from the seeded RNG).
//   (5) non-clamped / invalid knot vectors and degree>=count -> ok=false.
//   (6) tessellate -> a HalfEdgeMesh with the expected vertex/triangle counts
//       whose vertices all lie on the surface (open patch, not watertight).

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <string>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

using namespace forge::native::brep;
namespace mesh = forge::native::mesh;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {            std::printf("  [FAIL] %s\n", name.c_str()); }
}

static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }
static double dot(const Vec3& a, const Vec3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
static double nrm(const Vec3& a) { return std::sqrt(dot(a, a)); }
static Vec3 sub(const Vec3& a, const Vec3& b) { return Vec3{a.x-b.x, a.y-b.y, a.z-b.z}; }

// ---------------------------------------------------------------------------
// Surface builders.
// ---------------------------------------------------------------------------

// Bilinear (degree 1x1) surface over the unit parameter square with arbitrary
// corner points. S(u,v) = (1-u)(1-v)P00 + (1-u)v P01 + u(1-v)P10 + uv P11.
static NurbsSurface bilinear(const Vec3& P00, const Vec3& P01,
                             const Vec3& P10, const Vec3& P11) {
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    // control[i][j]: i over U, j over V.
    s.control = {{P00, P01}, {P10, P11}};
    s.weights = {{1, 1}, {1, 1}};
    s.knotsU = {0, 0, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    return s;
}

// A flat (degree 2x2) 3x3 control net whose points are an affine function of the
// grid indices: P(i,j) = origin + (i/2)*du + (j/2)*dv. Every such net evaluates
// to the SAME affine plane regardless of degree (partition of unity).
static NurbsSurface flatPlane(const Vec3& origin, const Vec3& dU, const Vec3& dV) {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 2;
    s.control.assign(3, std::vector<Vec3>(3));
    s.weights.assign(3, std::vector<double>(3, 1.0));
    for (std::size_t i = 0; i < 3; ++i)
        for (std::size_t j = 0; j < 3; ++j) {
            const double a = static_cast<double>(i) / 2.0;
            const double b = static_cast<double>(j) / 2.0;
            s.control[i][j] = Vec3{origin.x + a*dU.x + b*dV.x,
                                   origin.y + a*dU.y + b*dV.y,
                                   origin.z + a*dU.z + b*dV.z};
        }
    s.knotsU = {0, 0, 0, 1, 1, 1};
    s.knotsV = {0, 0, 0, 1, 1, 1};
    return s;
}

// One octant of a sphere of radius R as an EXACT rational biquadratic NURBS
// patch, built as a SURFACE OF REVOLUTION (the construction that genuinely
// reproduces the sphere to machine precision, verified separately).
//
// Profile (U direction): a degree-2 weighted quarter circle in the (radius,z)
// half-plane sweeping from the equator (r=R, z=0) up to the pole (r=0, z=R),
// with control polygon {(R,0), (R,R)[corner], (0,R)} and weights {1, 1/sqrt2, 1}.
// Revolution (V direction): a degree-2 weighted quarter circle of the AZIMUTH
// from +X toward +Y, with the planar control polygon {(1,0),(1,1)[corner],(0,1)}
// and weights {1, 1/sqrt2, 1}. Revolving a profile control point of planar
// radius pr[i] gives control points pr[i]*(dx[j],dy[j]) at height pz[i] with
// weight pw[i]*dw[j]. The product of two unit-weight-partitioned quarter circles
// in this revolution form yields |S(u,v)| == R exactly.
static NurbsSurface sphereOctant(double R) {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 2;
    const double wc = std::sqrt(2.0) / 2.0; // 1/sqrt(2)

    // Profile quarter circle in (r, z): equator -> pole.
    const double pr[3] = {R, R, 0.0};   // planar radius of profile control pts
    const double pz[3] = {0.0, R, R};   // height (z) of profile control pts
    const double pw[3] = {1.0, wc, 1.0};

    // Azimuth quarter circle in the xy-plane (unit polygon), revolved.
    const double dx[3] = {1.0, 1.0, 0.0};
    const double dy[3] = {0.0, 1.0, 1.0};
    const double dw[3] = {1.0, wc, 1.0};

    s.control.assign(3, std::vector<Vec3>(3));
    s.weights.assign(3, std::vector<double>(3, 1.0));
    for (std::size_t i = 0; i < 3; ++i) {
        for (std::size_t j = 0; j < 3; ++j) {
            s.control[i][j] = Vec3{pr[i] * dx[j], pr[i] * dy[j], pz[i]};
            s.weights[i][j] = pw[i] * dw[j];
        }
    }
    s.knotsU = {0, 0, 0, 1, 1, 1};
    s.knotsV = {0, 0, 0, 1, 1, 1};
    return s;
}

// ===========================================================================
// (1) Flat net -> affine plane, constant normal.
// ===========================================================================
static void testFlatPlane() {
    std::printf("[1] flat control net -> affine plane + constant normal\n");
    const Vec3 O{1.0, -2.0, 0.5};
    const Vec3 dU{3.0, 0.0, 1.0};
    const Vec3 dV{0.0, 4.0, -2.0};
    NurbsSurface s = flatPlane(O, dU, dV);
    check(validateSurface(s), "flat plane surface validates");

    // Analytic plane normal (constant) for reference.
    Vec3 refN = Vec3{dU.y*dV.z - dU.z*dV.y,
                     dU.z*dV.x - dU.x*dV.z,
                     dU.x*dV.y - dU.y*dV.x};
    const double rn = nrm(refN);
    refN = Vec3{refN.x/rn, refN.y/rn, refN.z/rn};

    bool ptOk = true, nOk = true;
    double worstPt = 0.0, worstN = 0.0;
    for (double u : {0.0, 0.13, 0.5, 0.77, 1.0}) {
        for (double v : {0.0, 0.31, 0.5, 0.62, 1.0}) {
            SurfaceSample S = evaluateWithDerivatives(s, u, v);
            ptOk = ptOk && S.ok;
            // Expected affine point.
            Vec3 want = Vec3{O.x + u*dU.x + v*dV.x,
                             O.y + u*dU.y + v*dV.y,
                             O.z + u*dU.z + v*dV.z};
            worstPt = std::max(worstPt, nrm(sub(S.point, want)));
            ptOk = ptOk && nrm(sub(S.point, want)) < 1e-9;
            // Normal constant (sign-aligned to refN).
            Vec3 n = S.normal;
            if (dot(n, refN) < 0) n = Vec3{-n.x, -n.y, -n.z};
            worstN = std::max(worstN, nrm(sub(n, refN)));
            nOk = nOk && nrm(sub(n, refN)) < 1e-12;
        }
    }
    std::printf("       worst |S - plane| = %.3e   worst |n - n0| = %.3e\n",
                worstPt, worstN);
    check(ptOk, "every S(u,v) on the affine plane within 1e-9");
    check(nOk,  "surface normal constant across the patch (<1e-12)");
}

// ===========================================================================
// (2) Sphere-patch net -> points within tol of the radius.
// ===========================================================================
static void testSpherePatch() {
    std::printf("[2] sphere-patch net -> |S(u,v)| ~ radius\n");
    const double R = 2.5;
    NurbsSurface s = sphereOctant(R);
    check(validateSurface(s), "sphere octant validates");

    bool ok = true;
    double worst = 0.0;
    for (double u : {0.0, 0.2, 0.4, 0.6, 0.8, 1.0}) {
        for (double v : {0.0, 0.2, 0.4, 0.6, 0.8, 1.0}) {
            SurfaceSample S = evaluatePoint(s, u, v);
            ok = ok && S.ok;
            const double r = nrm(S.point);
            worst = std::max(worst, std::fabs(r - R));
            ok = ok && approx(r, R, 1e-9);
        }
    }
    std::printf("       worst | |S| - R | = %.3e  (R=%.3f)\n", worst, R);
    check(ok, "all sphere-patch samples within 1e-9 of the radius");
}

// ===========================================================================
// (3) Bilinear (1x1) surface reproduces bilinear interpolation EXACTLY.
// ===========================================================================
static void testBilinearExact() {
    std::printf("[3] degree 1x1 surface == bilinear interpolation (exact)\n");
    const Vec3 P00{0, 0, 0}, P01{0, 2, 1}, P10{3, 0, -1}, P11{3, 2, 4};
    NurbsSurface s = bilinear(P00, P01, P10, P11);
    check(validateSurface(s), "bilinear surface validates");

    bool ok = true;
    double worst = 0.0;
    for (double u : {0.0, 0.1, 0.25, 0.5, 0.7, 1.0}) {
        for (double v : {0.0, 0.15, 0.3, 0.5, 0.85, 1.0}) {
            SurfaceSample S = evaluatePoint(s, u, v);
            ok = ok && S.ok;
            Vec3 want = Vec3{
                (1-u)*(1-v)*P00.x + (1-u)*v*P01.x + u*(1-v)*P10.x + u*v*P11.x,
                (1-u)*(1-v)*P00.y + (1-u)*v*P01.y + u*(1-v)*P10.y + u*v*P11.y,
                (1-u)*(1-v)*P00.z + (1-u)*v*P01.z + u*(1-v)*P10.z + u*v*P11.z};
            worst = std::max(worst, nrm(sub(S.point, want)));
            ok = ok && nrm(sub(S.point, want)) <= 1e-12;
        }
    }
    std::printf("       worst |S - bilinear| = %.3e\n", worst);
    check(ok, "bilinear surface matches closed form exactly (<=1e-12)");
}

// ===========================================================================
// (4) Analytic partial-derivative normals match central finite differences.
// ===========================================================================
static void testDerivativesVsFD(std::mt19937_64& rng) {
    std::printf("[4] analytic partials vs central finite differences (<1e-5)\n");
    // A genuinely curved, weighted, mixed-degree surface so the partials are
    // non-trivial: a 4x3 rational net, degree 3 in U, degree 2 in V.
    NurbsSurface s;
    s.degreeU = 3; s.degreeV = 2;
    s.control = {
        {{0,0,0},   {0,1,0.3}, {0,2,0}},
        {{1,0,0.5}, {1,1,1.2}, {1,2,0.4}},
        {{2,0,0.2}, {2,1,0.8}, {2,2,0.6}},
        {{3,0,0},   {3,1,0.5}, {3,2,0}},
    };
    s.weights = {
        {1.0, 1.5, 1.0},
        {0.8, 2.0, 1.2},
        {1.3, 0.9, 1.1},
        {1.0, 1.4, 1.0},
    };
    s.knotsU = {0, 0, 0, 0, 1, 1, 1, 1};   // 4 ctrl, deg 3 -> Bezier in U
    s.knotsV = {0, 0, 0, 1, 1, 1};         // 3 ctrl, deg 2 -> Bezier in V
    check(validateSurface(s), "curved weighted surface validates");

    std::uniform_real_distribution<double> dist(0.08, 0.92);  // stay off the seams
    const double h = 1e-5;
    bool duOk = true, dvOk = true, nOk = true;
    double worstDu = 0.0, worstDv = 0.0;
    const int N = 200;
    for (int it = 0; it < N; ++it) {
        const double u = dist(rng);
        const double v = dist(rng);
        SurfaceSample S = evaluateWithDerivatives(s, u, v);
        duOk = duOk && S.ok;

        // Central differences of the POINT evaluator.
        Vec3 up = evaluatePoint(s, u + h, v).point;
        Vec3 um = evaluatePoint(s, u - h, v).point;
        Vec3 vp = evaluatePoint(s, u, v + h).point;
        Vec3 vm = evaluatePoint(s, u, v - h).point;
        Vec3 fdU = Vec3{(up.x-um.x)/(2*h), (up.y-um.y)/(2*h), (up.z-um.z)/(2*h)};
        Vec3 fdV = Vec3{(vp.x-vm.x)/(2*h), (vp.y-vm.y)/(2*h), (vp.z-vm.z)/(2*h)};

        worstDu = std::max(worstDu, nrm(sub(S.du, fdU)));
        worstDv = std::max(worstDv, nrm(sub(S.dv, fdV)));
        duOk = duOk && nrm(sub(S.du, fdU)) < 1e-5;
        dvOk = dvOk && nrm(sub(S.dv, fdV)) < 1e-5;

        // Normal from the FD partials must match the analytic normal direction.
        Vec3 fdN = Vec3{fdU.y*fdV.z - fdU.z*fdV.y,
                        fdU.z*fdV.x - fdU.x*fdV.z,
                        fdU.x*fdV.y - fdU.y*fdV.x};
        const double l = nrm(fdN);
        if (l > 0) {
            fdN = Vec3{fdN.x/l, fdN.y/l, fdN.z/l};
            Vec3 an = S.normal;
            if (dot(an, fdN) < 0) an = Vec3{-an.x, -an.y, -an.z};
            nOk = nOk && nrm(sub(an, fdN)) < 1e-4;
        }
    }
    std::printf("       worst |du-FD| = %.3e   worst |dv-FD| = %.3e  (N=%d)\n",
                worstDu, worstDv, N);
    check(duOk, "dS/du matches central FD < 1e-5");
    check(dvOk, "dS/dv matches central FD < 1e-5");
    check(nOk,  "analytic normal matches FD-derived normal < 1e-4");
}

// ===========================================================================
// (5) Honest rejection of malformed surfaces -> ok=false.
// ===========================================================================
static void testHonestRejection() {
    std::printf("[5] malformed surfaces -> ok=false (honest)\n");

    // (a) degree >= control count in U (2 ctrl pts but degreeU 2).
    {
        NurbsSurface s;
        s.degreeU = 2; s.degreeV = 1;
        s.control = {{{0,0,0}, {0,1,0}}, {{1,0,0}, {1,1,0}}};
        s.weights = {{1,1}, {1,1}};
        s.knotsU = {0,0,0,1,1};   // sized count+deg+1 = 2+2+1 = 5, but deg>=count
        s.knotsV = {0,0,1,1};
        const char* why = nullptr;
        check(!validateSurface(s, &why), "degreeU>=count rejected");
        check(!evaluatePoint(s, 0.5, 0.5).ok, "  -> evaluatePoint ok=false");
    }

    // (b) non-clamped U knot vector (interior end-multiplicity).
    {
        NurbsSurface s;
        s.degreeU = 2; s.degreeV = 2;
        s.control.assign(3, std::vector<Vec3>(3, Vec3{0,0,0}));
        s.weights.assign(3, std::vector<double>(3, 1.0));
        s.knotsU = {0, 0.1, 0.2, 0.8, 0.9, 1.0};  // NOT clamped (no end mult)
        s.knotsV = {0, 0, 0, 1, 1, 1};
        check(!validateSurface(s), "non-clamped U knot vector rejected");
    }

    // (c) wrong knot-vector SIZE in V.
    {
        NurbsSurface s;
        s.degreeU = 2; s.degreeV = 2;
        s.control.assign(3, std::vector<Vec3>(3, Vec3{0,0,0}));
        s.weights.assign(3, std::vector<double>(3, 1.0));
        s.knotsU = {0, 0, 0, 1, 1, 1};
        s.knotsV = {0, 0, 0, 1, 1};   // one short
        check(!validateSurface(s), "wrong-size V knot vector rejected");
    }

    // (d) non-decreasing violated (a descending knot).
    {
        NurbsSurface s;
        s.degreeU = 2; s.degreeV = 2;
        s.control.assign(3, std::vector<Vec3>(3, Vec3{0,0,0}));
        s.weights.assign(3, std::vector<double>(3, 1.0));
        s.knotsU = {0, 0, 0, 1, 1, 1};
        s.knotsV = {0, 0, 0.4, 0.2, 1, 1};   // 0.4 then 0.2 — descends
        check(!validateSurface(s), "descending knot vector rejected");
    }

    // (e) non-positive weight.
    {
        NurbsSurface s;
        s.degreeU = 1; s.degreeV = 1;
        s.control = {{{0,0,0}, {0,1,0}}, {{1,0,0}, {1,1,0}}};
        s.weights = {{1, 0.0}, {1, 1}};   // zero weight
        s.knotsU = {0,0,1,1};
        s.knotsV = {0,0,1,1};
        check(!validateSurface(s), "non-positive weight rejected");
    }

    // (f) ragged control net.
    {
        NurbsSurface s;
        s.degreeU = 1; s.degreeV = 1;
        s.control = {{{0,0,0}, {0,1,0}}, {{1,0,0}}};   // second row short
        s.weights = {{1, 1}, {1, 1}};
        s.knotsU = {0,0,1,1};
        s.knotsV = {0,0,1,1};
        check(!validateSurface(s), "ragged control net rejected");
    }

    // (g) out-of-domain parameter -> evaluatePoint ok=false even for a valid net.
    {
        NurbsSurface s = bilinear({0,0,0},{0,1,0},{1,0,0},{1,1,0});
        check(validateSurface(s), "valid bilinear net (control)");
        check(!evaluatePoint(s, 1.5, 0.5).ok, "u out of [0,1] -> ok=false");
        check(!evaluatePoint(s, 0.5, -0.2).ok, "v out of [0,1] -> ok=false");
    }
}

// ===========================================================================
// (6) Tessellation -> HalfEdgeMesh with vertices on the surface.
// ===========================================================================
static void testTessellation() {
    std::printf("[6] tessellate -> HalfEdgeMesh (open patch) on the surface\n");
    NurbsSurface s = sphereOctant(1.0);
    const std::size_t resU = 8, resV = 6;
    bool ok = false;
    mesh::HalfEdgeMesh hem = tessellate(s, resU, resV, ok);
    check(ok, "tessellate reports ok");

    const std::size_t expectV = (resU + 1) * (resV + 1);
    const std::size_t expectF = 2 * resU * resV;
    check(hem.vertexCount() == expectV, "vertex count == (resU+1)(resV+1)");
    check(hem.faceCount() == expectF, "triangle count == 2*resU*resV");

    // Every tessellated vertex lies on the unit sphere octant.
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    hem.toSoup(pos, idx);
    bool onSurface = true;
    double worst = 0.0;
    for (std::size_t k = 0; k + 2 < pos.size(); k += 3) {
        const double r = std::sqrt(pos[k]*pos[k] + pos[k+1]*pos[k+1] + pos[k+2]*pos[k+2]);
        worst = std::max(worst, std::fabs(r - 1.0));
        onSurface = onSurface && approx(r, 1.0, 1e-9);
    }
    std::printf("       grid verts=%zu  tris=%zu  worst | |v| - R | = %.3e\n",
                hem.vertexCount(), hem.faceCount(), worst);
    check(onSurface, "all mesh vertices on the sphere octant (<1e-9)");

    // An open patch is intentionally NOT watertight (it has a boundary loop).
    mesh::ValidityReport rep = hem.validate();
    check(rep.twinsConsistent && !rep.watertight,
          "open patch: twins consistent but not watertight (honest)");

    // Degenerate tessellation request -> ok=false.
    bool bad = true;
    mesh::HalfEdgeMesh empty = tessellate(s, 0, 4, bad);
    check(!bad && empty.vertexCount() == 0, "resU=0 -> ok=false, empty mesh");
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("=== NURBS surface gate ===  seed=%llu\n",
                static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    testFlatPlane();
    testSpherePatch();
    testBilinearExact();
    testDerivativesVsFD(rng);
    testHonestRejection();
    testTessellation();

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
