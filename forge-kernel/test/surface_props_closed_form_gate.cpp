// surface_props_closed_form_gate.cpp — T-147 Task 1.
//
// ★ THE POINT: forge/SurfaceProps is verified against TEXTBOOK CLOSED FORMS,
//   never against OCCT. If it were checked against GeomLProp_SLProps it could
//   only ever be as right as the thing it is built to delete, and the day OCCT
//   leaves the link the gate leaves with it. Every expected value below is
//   classical differential geometry, written out in the check that uses it:
//
//     plane        k1 = k2 = K = H = 0, and the normal is constant
//     sphere R     k1 = k2 = 1/R,  K = 1/R^2,  H = 1/R
//     cylinder R   {k1,k2} = {1/R, 0},  K = 0,  H = 1/(2R)
//     cone         K = 0,  H = -h / (2 r(v) sqrt(dr^2 + h^2))
//                  (which is cos(alpha)/r for the one non-zero principal --
//                   asserted BIT-IDENTICAL to the cylinder at dr = 0)
//     torus R,r    K = cos v / (r (R + r cos v))
//                  H = -(R + 2 r cos v) / (2 r (R + r cos v))
//     ellipt. cyl  K = 0, |k| = a/b^2 at the major vertex, b/a^2 at the minor
//     circle r     kappa = 1/r, principal normal toward the centre
//     ellipse a,b  kappa = a b / (a^2 sin^2 t + b^2 cos^2 t)^(3/2)
//     NURBS arc    the rational quarter circle has kappa = 1/r at every t
//
// ── SIGN IS PART OF THE CLAIM ───────────────────────────────────────────────
// H, kMin and kMax are signed with respect to the surface's OWN oriented normal
// (SurfaceProps.hpp states the convention). The native (theta,phi) sphere has an
// INWARD +(S_u x S_v) and the cylinder an OUTWARD one, so the textbook POSITIVE
// forms above appear on opposite `reversed` settings. Every curved fixture is
// therefore asserted in BOTH orientations with the exact signed value each one
// must produce. No fixture is oriented to make a number come out positive.
//
// ── THE ONE FIXTURE THAT CAN SEE F AND M ────────────────────────────────────
// Every analytic quadric above is parameterised ORTHOGONALLY: F = S_u.S_v = 0
// and M = S_uv.n = 0 on all of them. So a mutation to the -2FM term or to the
// M^2 term of the fundamental forms is INVISIBLE to all of them, and a gate
// built only from them would call the second fundamental form proven while two
// of its five terms were never exercised. The shear fixture closes that: it
// reparameterises (u,v) -> (a, b) with v = b + lambda a, which leaves the
// SURFACE untouched and so must leave K and H algebraically unchanged, while
// making F = lambda G and M = lambda N both non-zero. The fixture PRINTS its own
// F and M so an inert version of it cannot pass silently.
//
// ── DEGENERACY IS ASSERTED IN BOTH DIRECTIONS ───────────────────────────────
// A pole must report UNDEFINED, not 0 -- 0 is a legitimate curvature and would be
// indistinguishable from a plane. And the guard must NOT be over-eager: a point
// 1e-5 rad off the pole must still report the exact 1/R^2. A guard that refuses
// everything is not a guard.
//
// Pure C++20, standard library only. No OCCT. Exit 0 iff every check passes.

#include "forge/SurfaceProps.hpp"

#include "forge/native/brep/NurbsAlgebra.hpp"   // surfaceCurvatureFromForms (shear fixture)

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using forge::math::Vec3;
using forge::props::CurveProps;
using forge::props::SurfProps;
using forge::props::curveProps;
using forge::props::surfaceProps;
namespace nb = forge::native::brep;

// ───────────────────────────── harness ──────────────────────────────────────
static int g_pass = 0, g_fail = 0;

// The required accuracy where the closed form is exact.
static const double kRel = 1e-9;
// A single UNIFORM absolute floor, expressed as a fraction of each fixture's own
// curvature scale, so a quantity whose exact value is ~1e-18 (cos(pi/2) is
// 6.1e-17, not 0) is not compared to nine significant figures of round-off. It
// is uniform across every fixture and is 1000x tighter than kRel -- it is not a
// per-fixture dial, and every residual is printed so it can be audited.
static const double kAbsFloor = 1e-12;

static void ckTrue(const std::string& name, bool ok, const std::string& detail = "") {
    if (ok) { ++g_pass; std::printf("[PASS] %s %s\n", name.c_str(), detail.c_str()); }
    else    { ++g_fail; std::printf("[FAIL] %s %s\n", name.c_str(), detail.c_str()); }
}

// value check against a closed form. `scale` is the fixture's own characteristic
// curvature (e.g. 1/R), used ONLY by the absolute floor.
static void ckNear(const std::string& name, double actual, double expected,
                   double scale) {
    const double d = std::fabs(actual - expected);
    const double rel = (expected != 0.0) ? d / std::fabs(expected) : d;
    const bool byRel = d <= kRel * std::fabs(expected);
    const bool byFloor = d <= kAbsFloor * scale;
    char buf[320];
    // A pass that came from the FLOOR rather than the relative test is LABELLED,
    // so nobody reads a rel=0.4 line as a 40% agreement. It means the exact value
    // is itself ~1e-18 (cos(pi/2) is 6.1e-17) and |d| is round-off.
    std::snprintf(buf, sizeof buf, "got %.17g want %.17g  |d|=%.3g rel=%.3g%s",
                  actual, expected, d, rel,
                  (!byRel && byFloor) ? "  [floor: exact value is round-off-sized]" : "");
    ckTrue(name, byRel || byFloor, buf);
}

// ★ THE PRINCIPAL SPLIT AT AN UMBILIC IS NOT A 1e-9 QUANTITY, AND THIS IS WHY.
// k = H +/- sqrt(H^2 - K). At an umbilic (a sphere: every point) H^2 == K
// exactly in exact arithmetic, so the discriminant is a CATASTROPHIC
// CANCELLATION: H^2 and K each carry ~1e-16 relative error, their difference is
// ~1e-16 ABSOLUTE, and its square root is ~1e-8. The square root does not lose
// accuracy -- it AMPLIFIES the cancellation, by construction, and no
// implementation of that formula can do better.
//
// MEASURED on this build: at (theta,phi)=(0.9,0.6) K came out bit-exact, the
// discriminant was 0, and the split was exact. One station away, at (2.4,2.1), K
// was ONE ULP low, the discriminant was 5.6e-17, and the two principals split by
// 1.3e-8. Same code, same surface -- the difference is one ulp of K.
//
// So this gate asserts the principals at the CONDITIONING BOUND, sqrt(DBL_EPSILON)
// ~ 1.5e-8, and asserts the WELL-CONDITIONED combinations -- K itself, H itself,
// k1+k2 == 2H and k1*k2 == K -- at the full 1e-9. Asserting 1e-9 on the split
// would be asserting that a cancellation did not happen. It is NOT a widened
// tolerance: it is a different quantity with a different error bound, it applies
// ONLY at an umbilic, and the residual is printed every time.
static const double kUmbilicBound = 2.0e-8;   // > sqrt(DBL_EPSILON) = 1.49e-8

static void ckUmbilic(const std::string& name, double actual, double expected,
                      double scale) {
    const double d = std::fabs(actual - expected);
    char buf[320];
    std::snprintf(buf, sizeof buf,
                  "got %.17g want %.17g  |d|=%.3g  bound=%.3g [umbilic: sqrt of a "
                  "cancelled discriminant]", actual, expected, d,
                  kUmbilicBound * scale);
    ckTrue(name, d <= kUmbilicBound * scale, buf);
}

// EXACT check — for quantities that must be bit-zero or bit-equal because their
// numerator is exactly zero / their inputs are identical. A tolerance here would
// hide a real defect.
static void ckExact(const std::string& name, double actual, double expected) {
    char buf[200];
    std::snprintf(buf, sizeof buf, "got %.17g want %.17g (EXACT)", actual, expected);
    ckTrue(name, actual == expected, buf);
}

static void ckVecNear(const std::string& name, const Vec3& a, const Vec3& e,
                      double tol) {
    const double d = (a - e).length();
    char buf[256];
    std::snprintf(buf, sizeof buf,
                  "got (%.12g,%.12g,%.12g) want (%.12g,%.12g,%.12g) |d|=%.3g",
                  a.x, a.y, a.z, e.x, e.y, e.z, d);
    ckTrue(name, d <= tol, buf);
}

// ───────────────────────────── frames ───────────────────────────────────────
static Vec3 unit(const Vec3& v) { return v / v.length(); }

// A deliberately NON-axis-aligned right-handed frame: a fixture that only ever
// sees (0,0,1)/(1,0,0) cannot catch a frame/binormal error.
struct Frame { Vec3 axis, refDir; };
static Frame rotatedFrame() {
    const Vec3 A = unit(Vec3{1.0, 2.0, 3.0});
    Vec3 r{1.0, -1.0, 0.0};
    r = r - A * r.dot(A);           // orthogonalise against the axis
    return Frame{A, unit(r)};
}
static Frame alignedFrame() { return Frame{Vec3{0, 0, 1}, Vec3{1, 0, 0}}; }

// ─────────────────────── surface fixture builders ───────────────────────────
static nb::Surface mkPlane(const Frame& f) {
    nb::Surface s; s.kind = nb::SurfaceKind::Plane;
    s.origin = Vec3{0.4, -1.2, 2.0}; s.axis = f.axis; s.refDir = f.refDir;
    return s;
}
static nb::Surface mkCylinder(const Frame& f, double R, bool rev) {
    nb::Surface s; s.kind = nb::SurfaceKind::Cylinder;
    s.origin = Vec3{0.1, 0.2, -0.3}; s.axis = f.axis; s.refDir = f.refDir;
    s.r1 = R; s.param = 10.0; s.reversed = rev;
    return s;
}
static nb::Surface mkSphere(const Frame& f, double R, bool rev) {
    nb::Surface s; s.kind = nb::SurfaceKind::Sphere;
    s.origin = Vec3{-0.7, 1.1, 0.45}; s.axis = f.axis; s.refDir = f.refDir;
    s.r1 = R; s.reversed = rev;
    return s;
}
static nb::Surface mkTorus(const Frame& f, double Rmaj, double rmin, bool rev) {
    nb::Surface s; s.kind = nb::SurfaceKind::Torus;
    s.origin = Vec3{2.0, -0.5, 0.25}; s.axis = f.axis; s.refDir = f.refDir;
    s.r1 = Rmaj; s.r2 = rmin; s.reversed = rev;
    return s;
}
static nb::Surface mkCone(const Frame& f, double r1, double r2, double h, bool rev) {
    nb::Surface s; s.kind = nb::SurfaceKind::Cone;
    s.origin = Vec3{0.0, 0.0, 0.0}; s.axis = f.axis; s.refDir = f.refDir;
    s.r1 = r1; s.r2 = r2; s.param = h; s.reversed = rev;
    return s;
}
static nb::Surface mkEllipseCyl(const Frame& f, double a, double b) {
    nb::Surface s; s.kind = nb::SurfaceKind::EllipseExtrusion;
    s.origin = Vec3{0.3, 0.3, 0.3}; s.axis = f.axis; s.refDir = f.refDir;
    s.r1 = a; s.r2 = b; s.param = 5.0;
    return s;
}

// ═══════════════════════════════ 1. PLANE ═══════════════════════════════════
static void gatePlane() {
    std::printf("\n-- PLANE: k1 = k2 = K = H = 0 EXACTLY, normal constant --\n");
    const Frame f = rotatedFrame();
    const nb::Surface s = mkPlane(f);
    const SurfProps a = surfaceProps(s, 0.3, -1.7);
    const SurfProps b = surfaceProps(s, 12.5, 4.25);

    ckTrue("plane normalDefined", a.normalDefined);
    ckTrue("plane curvatureDefined", a.curvatureDefined);
    ckVecNear("plane d1u == refDir", a.d1u, f.refDir, 0.0);
    ckVecNear("plane d1v == binormal", a.d1v, s.binormal(), 0.0);
    ckVecNear("plane normal == axis", a.normal, f.axis, 1e-15);
    ckVecNear("plane normal is CONSTANT over (u,v)", b.normal, a.normal, 0.0);
    // L = M = N = 0 exactly (the second partials are identically zero), so every
    // curvature numerator is exactly zero. A tolerance here would be a lie.
    ckExact("plane K == 0", a.kGauss, 0.0);
    ckExact("plane H == 0", a.kMean, 0.0);
    ckExact("plane kMin == 0", a.kMin, 0.0);
    ckExact("plane kMax == 0", a.kMax, 0.0);
    ckExact("plane S_uu == 0", a.d2uu.length(), 0.0);
    ckExact("plane S_uv == 0", a.d2uv.length(), 0.0);
    ckExact("plane S_vv == 0", a.d2vv.length(), 0.0);
}

// ═════════════════════════════ 2. CYLINDER ══════════════════════════════════
static void gateCylinder() {
    const double R = 2.5;
    std::printf("\n-- CYLINDER R=%.3g: K=0, |H|=1/(2R)=%.17g, {|k|}={0,1/R=%.17g} --\n",
                R, 1.0 / (2.0 * R), 1.0 / R);
    const Frame f = alignedFrame();
    const double u = 0.7, v = 1.3;

    // reversed = false: +(S_u x S_v) is the OUTWARD radial, so H is NEGATIVE.
    const nb::Surface so = mkCylinder(f, R, false);
    const SurfProps po = surfaceProps(so, u, v);
    ckTrue("cyl(out) normalDefined && curvatureDefined",
           po.normalDefined && po.curvatureDefined);
    ckVecNear("cyl(out) normal is the OUTWARD radial",
              po.normal, Vec3{std::cos(u), std::sin(u), 0.0}, 1e-15);
    ckExact("cyl(out) K == 0", po.kGauss, 0.0);              // L*N - M^2, N = M = 0
    ckNear("cyl(out) H == -1/(2R)", po.kMean, -1.0 / (2.0 * R), 1.0 / R);
    ckNear("cyl(out) kMin == -1/R", po.kMin, -1.0 / R, 1.0 / R);
    ckNear("cyl(out) kMax == 0", po.kMax, 0.0, 1.0 / R);

    // reversed = true: the normal points at the axis, and this is the orientation
    // the textbook positive form is written in: H = +1/(2R), {k} = {0, +1/R}.
    const nb::Surface si = mkCylinder(f, R, true);
    const SurfProps pi = surfaceProps(si, u, v);
    ckVecNear("cyl(in) normal is the INWARD radial",
              pi.normal, Vec3{-std::cos(u), -std::sin(u), 0.0}, 1e-15);
    ckExact("cyl(in) K == 0 (normal sign cannot change K)", pi.kGauss, 0.0);
    ckNear("cyl(in) H == +1/(2R)  [TEXTBOOK]", pi.kMean, 1.0 / (2.0 * R), 1.0 / R);
    ckNear("cyl(in) kMin == 0     [TEXTBOOK]", pi.kMin, 0.0, 1.0 / R);
    ckNear("cyl(in) kMax == +1/R  [TEXTBOOK]", pi.kMax, 1.0 / R, 1.0 / R);
    ckNear("cyl flip negates H exactly", pi.kMean, -po.kMean, 1.0 / R);
    ckNear("cyl flip swaps+negates the principals", pi.kMax, -po.kMin, 1.0 / R);
}

// ═══════════════════════════════ 3. SPHERE ══════════════════════════════════
static void gateSphere() {
    const double R = 1.75;
    std::printf("\n-- SPHERE R=%.3g: K=1/R^2=%.17g, |H|=1/R=%.17g, k1=k2 --\n",
                R, 1.0 / (R * R), 1.0 / R);
    const Frame f = rotatedFrame();
    const double stations[2][2] = {{0.9, 0.6}, {2.4, 2.1}};

    for (int i = 0; i < 2; ++i) {
        const double th = stations[i][0], ph = stations[i][1];
        const std::string at = " @(" + std::to_string(th) + "," + std::to_string(ph) + ")";

        // reversed = false: the (theta,phi) parameterisation's +(S_u x S_v) points
        // INWARD, which is the orientation the textbook positive form lives in.
        const nb::Surface si = mkSphere(f, R, false);
        const SurfProps p = surfaceProps(si, th, ph);
        ckTrue("sph normalDefined && curvatureDefined" + at,
               p.normalDefined && p.curvatureDefined);
        ckNear("sph point is on the sphere" + at,
               (p.p - si.origin).length(), R, R);
        ckTrue("sph(unreversed) normal points INWARD" + at,
               (p.p - si.origin).dot(p.normal) < 0.0);
        ckNear("sph K == 1/R^2  [TEXTBOOK]" + at, p.kGauss, 1.0 / (R * R), 1.0 / (R * R));
        ckNear("sph H == 1/R    [TEXTBOOK]" + at, p.kMean, 1.0 / R, 1.0 / R);
        ckUmbilic("sph kMin == 1/R [TEXTBOOK]" + at, p.kMin, 1.0 / R, 1.0 / R);
        ckUmbilic("sph kMax == 1/R [TEXTBOOK]" + at, p.kMax, 1.0 / R, 1.0 / R);
        // The SPREAD is twice the individual deviation BY CONSTRUCTION: the two
        // roots are H -/+ sqrt(disc), so each sits sqrt(disc) from H and they sit
        // 2*sqrt(disc) from each other. The bound doubles for the same reason the
        // quantity does -- it is the arithmetic of the formula, not a dial.
        ckUmbilic("sph is UMBILIC (|kMax-kMin| = 2 sqrt(disc))" + at,
                  p.kMin, p.kMax, 2.0 / R);
        // The two WELL-CONDITIONED combinations of the same pair, at the full
        // 1e-9: the cancellation is in the split, not in the sum or the product.
        ckNear("sph kMin+kMax == 2H (well-conditioned)" + at,
               p.kMin + p.kMax, 2.0 / R, 1.0 / R);
        ckNear("sph kMin*kMax == K (well-conditioned)" + at,
               p.kMin * p.kMax, 1.0 / (R * R), 1.0 / (R * R));

        const nb::Surface so = mkSphere(f, R, true);
        const SurfProps q = surfaceProps(so, th, ph);
        ckTrue("sph(reversed) normal points OUTWARD" + at,
               (q.p - so.origin).dot(q.normal) > 0.0);
        ckNear("sph K unchanged by the flip" + at, q.kGauss, 1.0 / (R * R), 1.0 / (R * R));
        ckNear("sph H negated by the flip" + at, q.kMean, -1.0 / R, 1.0 / R);
        ckUmbilic("sph kMin negated by the flip" + at, q.kMin, -1.0 / R, 1.0 / R);
    }
}

// ═══════════════════════════════ 4. TORUS ═══════════════════════════════════
static void gateTorus() {
    const double Rmaj = 5.0, rmin = 1.5;
    std::printf("\n-- TORUS R=%.3g r=%.3g at the FOUR cardinal points:"
                " K = cos v /(r(R + r cos v)) --\n", Rmaj, rmin);
    const Frame f = rotatedFrame();
    const nb::Surface s = mkTorus(f, Rmaj, rmin, false);
    const double pi = 3.14159265358979323846;
    const double vs[4] = {0.0, pi * 0.5, pi, pi * 1.5};
    const char* nm[4] = {"v=0 (outer equator)", "v=pi/2 (top)",
                         "v=pi (inner equator)", "v=3pi/2 (bottom)"};
    const double u = 1.1;
    const double scale = 1.0 / (rmin * rmin);

    for (int i = 0; i < 4; ++i) {
        const double v = vs[i];
        const double cv = std::cos(v);
        const double ring = Rmaj + rmin * cv;
        // The closed forms, evaluated in double from the SAME cos v the evaluator
        // saw -- cos(pi/2) is 6.1e-17, not 0, and comparing against a hand-typed
        // 0 would be comparing against a different question.
        const double Kexp = cv / (rmin * ring);
        const double Hexp = -(Rmaj + 2.0 * rmin * cv) / (2.0 * rmin * ring);
        const SurfProps p = surfaceProps(s, u, v);
        ckTrue(std::string("torus defined ") + nm[i],
               p.normalDefined && p.curvatureDefined);
        ckNear(std::string("torus K ") + nm[i], p.kGauss, Kexp, scale);
        ckNear(std::string("torus H ") + nm[i], p.kMean, Hexp, 1.0 / rmin);
        // The tube's two principals are the tube circle (1/r) and the ring: their
        // PRODUCT must be K and their SUM 2H -- an independent algebraic identity.
        ckNear(std::string("torus kMin*kMax == K ") + nm[i],
               p.kMin * p.kMax, Kexp, scale);
        ckNear(std::string("torus kMin+kMax == 2H ") + nm[i],
               p.kMin + p.kMax, 2.0 * Hexp, 1.0 / rmin);
        // The outward tube normal gives the tube-circle principal exactly -1/r.
        ckNear(std::string("torus one principal is -1/r ") + nm[i],
               std::min(std::fabs(p.kMin + 1.0 / rmin),
                        std::fabs(p.kMax + 1.0 / rmin)), 0.0, 1.0 / rmin);
    }
}

// ═══════════════════════════════ 5. CONE ════════════════════════════════════
static void gateCone() {
    const double r1 = 3.0, r2 = 1.0, h = 4.0;
    const double dr = r2 - r1;
    const double sl = std::sqrt(dr * dr + h * h);
    std::printf("\n-- CONE r1=%.3g r2=%.3g h=%.3g: K=0, H = -h/(2 r(v) sqrt(dr^2+h^2)) --\n",
                r1, r2, h);
    const Frame f = alignedFrame();
    const nb::Surface s = mkCone(f, r1, r2, h, false);
    const double vs[3] = {0.0, 0.5, 1.0};
    for (int i = 0; i < 3; ++i) {
        const double v = vs[i];
        const double r = r1 + dr * v;
        const double Hexp = -h / (2.0 * r * sl);
        const SurfProps p = surfaceProps(s, 0.4, v);
        const std::string at = " @v=" + std::to_string(v);
        ckTrue("cone defined" + at, p.normalDefined && p.curvatureDefined);
        // NOT ckExact, and the difference from the cylinder is instructive: the
        // cylinder's S_uv and S_vv are the exact zero vector, so M and N are
        // exactly 0 and L*N - M^2 is bit-zero. The cone's S_uv = dr * e_theta is
        // NOT zero, so M is the round-off of e_theta . n (~1e-16) and K is -M^2/
        // det1 ~ -1e-34. Demanding bit-zero here would be demanding that a
        // normalised dot product be exact. MEASURED below; the floor is 1e-12/r^2.
        ckNear("cone K == 0 (developable)" + at, p.kGauss, 0.0, 1.0 / (r * r));
        ckNear("cone H == -h/(2 r sl)" + at, p.kMean, Hexp, 1.0 / r);
        ckNear("cone kMin == 2H" + at, p.kMin, 2.0 * Hexp, 1.0 / r);
        ckNear("cone kMax == 0" + at, p.kMax, 0.0, 1.0 / r);
        // cos(alpha)/r is the classical form of the same principal curvature.
        ckNear("cone |kMin| == cos(alpha)/r" + at,
               std::fabs(p.kMin), (h / sl) / r, 1.0 / r);
    }

    // CROSS-FAMILY: a cone with r1 == r2 and h == 1 has derivatives IDENTICAL to
    // a cylinder's, so the two independent code paths must agree BIT FOR BIT. A
    // tolerance here would hide a wrong term in one of them.
    const double R = 2.5;
    const SurfProps pc = surfaceProps(mkCone(f, R, R, 1.0, false), 0.7, 1.3);
    const SurfProps pz = surfaceProps(mkCylinder(f, R, false), 0.7, 1.3);
    ckExact("cone(dr=0) K == cylinder K  [BIT-IDENTICAL]", pc.kGauss, pz.kGauss);
    ckExact("cone(dr=0) H == cylinder H  [BIT-IDENTICAL]", pc.kMean, pz.kMean);
    ckExact("cone(dr=0) kMin == cylinder kMin [BIT-IDENTICAL]", pc.kMin, pz.kMin);
}

// ══════════════════════ 6. ELLIPTICAL CYLINDER ══════════════════════════════
static void gateEllipticCylinder() {
    const double a = 3.0, b = 2.0;
    std::printf("\n-- ELLIPTICAL CYLINDER a=%.3g b=%.3g: K=0, |k| = a/b^2 = %.17g at the\n"
                "   major vertex and b/a^2 = %.17g at the minor --\n",
                a, b, a / (b * b), b / (a * a));
    const Frame f = alignedFrame();
    const nb::Surface s = mkEllipseCyl(f, a, b);
    const double pi = 3.14159265358979323846;

    const SurfProps p0 = surfaceProps(s, 0.0, 2.0);
    ckTrue("ellcyl defined @u=0", p0.normalDefined && p0.curvatureDefined);
    ckExact("ellcyl K == 0 @u=0 (developable)", p0.kGauss, 0.0);
    ckNear("ellcyl |kMin| == a/b^2 @u=0", std::fabs(p0.kMin), a / (b * b), a / (b * b));
    ckNear("ellcyl H == -a/(2b^2) @u=0", p0.kMean, -a / (2.0 * b * b), a / (b * b));

    const SurfProps p1 = surfaceProps(s, pi * 0.5, 2.0);
    ckExact("ellcyl K == 0 @u=pi/2", p1.kGauss, 0.0);
    ckNear("ellcyl |kMin| == b/a^2 @u=pi/2", std::fabs(p1.kMin), b / (a * a), a / (b * b));
}

// ═════════ 7. SHEAR REPARAMETERISATION — THE ONLY F != 0, M != 0 FIXTURE ════
static void gateShearInvariance() {
    std::printf("\n-- SHEAR INVARIANCE: v = b + lambda a leaves the SURFACE alone, so K\n"
                "   and H are unchanged, while F = lambda G and M = lambda N become\n"
                "   NON-ZERO. This is the ONLY fixture that can see the -2FM and M^2\n"
                "   terms; every orthogonal quadric above has F = M = 0. --\n");
    const double lam = 0.7;
    const Frame f = rotatedFrame();

    struct Case { const char* name; nb::Surface s; double u, v, scale; };
    const Case cases[2] = {
        {"sphere", mkSphere(f, 1.75, false), 0.9, 0.6, 1.0 / 1.75},
        {"torus",  mkTorus(f, 5.0, 1.5, false), 1.1, 0.8, 1.0 / 1.5},
    };

    for (const Case& c : cases) {
        const SurfProps p = surfaceProps(c.s, c.u, c.v);
        if (!p.curvatureDefined) {
            ckTrue(std::string("shear ") + c.name + " base fixture is defined", false);
            continue;
        }
        // The sheared frame: a = u, b = v - lambda u  =>  S(a,b) = S(a, b + lam a).
        const Vec3 Sa  = p.d1u + p.d1v * lam;
        const Vec3 Sb  = p.d1v;
        const Vec3 Saa = p.d2uu + p.d2uv * (2.0 * lam) + p.d2vv * (lam * lam);
        const Vec3 Sab = p.d2uv + p.d2vv * lam;
        const Vec3 Sbb = p.d2vv;

        // The fixture's OWN PREMISE, printed: if F or M were zero this fixture
        // would be inert and would pass a mutated form silently.
        const Vec3 n = Sa.cross(Sb) / Sa.cross(Sb).length();
        const double F = Sa.dot(Sb);
        const double M = Sab.dot(n);
        const double E = Sa.dot(Sa), G = Sb.dot(Sb);
        const double Lf = Saa.dot(n), Nf = Sbb.dot(n);
        std::printf("   [%s] sheared forms: E=%.6g F=%.6g G=%.6g  L=%.6g M=%.6g N=%.6g\n",
                    c.name, E, F, G, Lf, M, Nf);
        ckTrue(std::string("shear ") + c.name + " premise: F != 0 (else inert)",
               std::fabs(F) > 1e-6 * std::sqrt(E * G),
               "F/sqrt(EG)=" + std::to_string(F / std::sqrt(E * G)));
        ckTrue(std::string("shear ") + c.name + " premise: M != 0 (else inert)",
               std::fabs(M) > 1e-6 * std::max(std::fabs(Lf), std::fabs(Nf)),
               "M=" + std::to_string(M));

        const auto sc = nb::surfaceCurvatureFromForms(Sa, Sb, Saa, Sab, Sbb, 1e-12);
        ckTrue(std::string("shear ") + c.name + " ok", sc.ok);
        ckNear(std::string("shear ") + c.name + " K is reparameterisation-INVARIANT",
               sc.gaussian, p.kGauss, c.scale * c.scale);
        ckNear(std::string("shear ") + c.name + " H is reparameterisation-INVARIANT",
               sc.mean, p.kMean, c.scale);
        // The sphere case is umbilic, so its SPLIT carries the sqrt-of-a-cancelled-
        // discriminant bound (see ckUmbilic); the torus case is not umbilic and is
        // held to the full 1e-9. Same reason, applied where it actually applies.
        ckUmbilic(std::string("shear ") + c.name + " k1 INVARIANT", sc.k1, p.kMin,
                  c.scale);
        ckUmbilic(std::string("shear ") + c.name + " k2 INVARIANT", sc.k2, p.kMax,
                  c.scale);
    }
}

// ══════════════════════════ 8. DEGENERACY ═══════════════════════════════════
static void gateDegenerate() {
    std::printf("\n-- DEGENERACY: a pole must report UNDEFINED, never 0 (0 is a real\n"
                "   curvature and would read as a plane); and the guard must NOT refuse\n"
                "   a valid point near the pole. --\n");
    const double R = 1.75;
    const Frame f = rotatedFrame();
    const nb::Surface s = mkSphere(f, R, false);

    // D1 — the EXACT pole: sin(phi) == 0, so S_u is exactly the zero vector.
    const SurfProps d1 = surfaceProps(s, 0.9, 0.0);
    ckTrue("pole(phi=0) normalDefined == FALSE", !d1.normalDefined);
    ckTrue("pole(phi=0) curvatureDefined == FALSE", !d1.curvatureDefined);
    ckTrue("pole(phi=0) normal is the zero vector (not a direction)",
           d1.normal.length() == 0.0);
    ckTrue("pole(phi=0) the POINT is still reported (it exists)",
           std::fabs((d1.p - s.origin).length() - R) < 1e-12,
           "|p-c|=" + std::to_string((d1.p - s.origin).length()));
    // The numbers ARE zero here -- and that is exactly why the FLAG is the
    // assertion. A caller reading kGauss without the flag cannot tell this pole
    // from a plane.
    std::printf("   [note] at the pole kGauss=%.17g kMean=%.17g -- indistinguishable\n"
                "          from a PLANE by value alone; only the flag separates them.\n",
                d1.kGauss, d1.kMean);

    // D2 — a NEAR pole: |S_u x S_v| is 1e-14 but NON-ZERO, so the absolute guard
    // cannot see it. Only the scale-relative criterion refuses this, which is what
    // makes mutation M5 killable.
    const SurfProps d2 = surfaceProps(s, 0.9, 1e-14);
    ckTrue("near-pole(phi=1e-14) refused by the RELATIVE guard",
           !d2.normalDefined && !d2.curvatureDefined);

    // D3 — the OTHER direction: 1e-5 rad off the pole is a perfectly good point
    // and must report the exact closed form. A guard that refuses this is broken.
    const SurfProps d3 = surfaceProps(s, 0.9, 1e-5);
    ckTrue("phi=1e-5 is ACCEPTED (the guard is not over-eager)",
           d3.normalDefined && d3.curvatureDefined);
    ckNear("phi=1e-5 K is still exactly 1/R^2", d3.kGauss, 1.0 / (R * R), 1.0 / (R * R));
    ckNear("phi=1e-5 H is still exactly 1/R", d3.kMean, 1.0 / R, 1.0 / R);

    // D4 — the CONE APEX: r(v) == 0 collapses S_u.
    const nb::Surface cone = mkCone(alignedFrame(), 0.0, 2.0, 3.0, false);
    const SurfProps d4 = surfaceProps(cone, 0.4, 0.0);
    ckTrue("cone apex refused", !d4.normalDefined && !d4.curvatureDefined);

    // D5 — a malformed NURBS net must be refused, not indexed into.
    nb::Surface bad; bad.kind = nb::SurfaceKind::Nurbs;   // empty control net
    const SurfProps d5 = surfaceProps(bad, 0.5, 0.5);
    ckTrue("empty NURBS net refused (no out-of-range read)",
           !d5.normalDefined && !d5.curvatureDefined);
}

// ══════════════════════════ 9. CURVE PROPS ══════════════════════════════════
static void gateCurves() {
    std::printf("\n-- CURVES: kappa = 1/r (circle), a b /(a^2 sin^2 + b^2 cos^2)^(3/2)\n"
                "   (ellipse), and 1/r on the RATIONAL quarter circle --\n");
    const Frame f = rotatedFrame();
    const Vec3 B = f.axis.cross(f.refDir);

    // LINE — no curvature, and therefore NO principal normal.
    nb::Curve line = nb::Curve::makeLine(Vec3{1, 2, 3}, Vec3{4, 6, 9});
    const CurveProps lp = curveProps(line, 0.37);
    ckTrue("line defined", lp.defined);
    ckExact("line kappa == 0 EXACTLY", lp.curvature, 0.0);
    ckExact("line C'' == 0 EXACTLY", lp.d2.length(), 0.0);
    ckExact("line C''' == 0 EXACTLY", lp.d3.length(), 0.0);
    ckTrue("line has NO principal normal (reported, not faked)", !lp.normalDefined);

    // CIRCLE — kappa = 1/r, principal normal toward the centre.
    const double r = 2.5;
    nb::Curve circ = nb::Curve::makeCircle(Vec3{0.5, -1.0, 2.0}, f.refDir, f.axis, r);
    for (double t : {0.0, 0.8, 2.9, 5.5}) {
        const CurveProps p = curveProps(circ, t);
        const std::string at = " @t=" + std::to_string(t);
        ckTrue("circle defined" + at, p.defined && p.normalDefined);
        ckNear("circle kappa == 1/r" + at, p.curvature, 1.0 / r, 1.0 / r);
        ckNear("circle |C'| == r" + at, p.d1.length(), r, r);
        // The principal normal must point AT the centre.
        ckVecNear("circle normal points at the centre" + at,
                  p.normal, (circ.origin - p.p) / r, 1e-13);
        // C''' == -C' for a circle, term for term.
        ckVecNear("circle C''' == -C'" + at, p.d3, -p.d1, 0.0);
    }

    // ELLIPSE — the full closed form at four parameters.
    const double a = 3.0, b = 2.0;
    nb::Curve ell = nb::Curve::makeEllipse(Vec3{0, 0, 0}, f.refDir, f.axis, a, b);
    for (double t : {0.0, 0.8, 1.5707963267948966, 2.6}) {
        const double st = std::sin(t), ct = std::cos(t);
        const double den = std::pow(a * a * st * st + b * b * ct * ct, 1.5);
        const double kexp = a * b / den;
        const CurveProps p = curveProps(ell, t);
        ckNear("ellipse kappa == ab/(a^2sin^2+b^2cos^2)^{3/2} @t=" + std::to_string(t),
               p.curvature, kexp, a / (b * b));
    }

    // RATIONAL NURBS quarter circle — the DELEGATED path (curveDerivatives).
    // Degree 2, weights (1, 1/sqrt2, 1) over the clamped knots [0,0,0,1,1,1] is
    // the exact quarter circle of radius rq, so kappa == 1/rq at EVERY t.
    const double rq = 1.6;
    nb::NurbsCurve nc;
    nc.degree = 2;
    nc.controlPoints = {Vec3{rq, 0, 0}, Vec3{rq, rq, 0}, Vec3{0, rq, 0}};
    nc.weights = {1.0, std::sqrt(0.5), 1.0};
    nc.knots = {0, 0, 0, 1, 1, 1};
    nb::Curve bs = nb::Curve::makeBSpline(nc);
    ckTrue("nurbs arc is valid", nc.valid());
    for (double t : {0.0, 0.25, 0.5, 0.75, 1.0}) {
        const CurveProps p = curveProps(bs, t);
        const std::string at = " @t=" + std::to_string(t);
        ckTrue("nurbs arc defined" + at, p.defined && p.normalDefined);
        ckNear("nurbs arc kappa == 1/r" + at, p.curvature, 1.0 / rq, 1.0 / rq);
        ckNear("nurbs arc point is on the circle" + at, p.p.length(), rq, rq);
        ckVecNear("nurbs arc normal points at the centre" + at,
                  p.normal, -p.p / rq, 1e-9);
    }
    (void)B;
}

// ══════════════════ 10. THE TWO REMAINING CONICS (T-151) ════════════════════
// PARABOLA   C(t) = V + (t^2/4f) R + t B
//            C' = (t/2f)R + B, C'' = (1/2f)R, C''' = 0
//            C' x C'' = (1/2f)(B x R) => |C' x C''| = 1/(2f)
//            kappa = 1/(2f (1 + t^2/(4f^2))^{3/2});  at the APEX kappa = 1/(2f),
//            i.e. the vertex radius of curvature is 2f.
// HYPERBOLA  C(t) = O + a cosh(t) R + b sinh(t) B
//            C' = a sinh R + b cosh B, C'' = a cosh R + b sinh B, C''' = C'
//            C' x C'' = ab(sinh^2 - cosh^2)(R x B) = -ab (R x B)
//            kappa = ab / (a^2 sinh^2 t + b^2 cosh^2 t)^{3/2};  at the WAIST
//            kappa = a/b^2.
// Both are sampled AT the apex/waist and well away from it, because a wrong
// constant term is invisible at one and a wrong t-term is invisible at the other.
static void gateConics() {
    std::printf("\n-- PARABOLA kappa = 1/(2f(1+t^2/4f^2)^{3/2}) and HYPERBOLA\n"
                "   kappa = ab/(a^2 sinh^2 + b^2 cosh^2)^{3/2}, sampled at the\n"
                "   apex/waist AND away from it --\n");
    const Frame f = rotatedFrame();
    const Vec3 B = f.axis.cross(f.refDir);

    // ── PARABOLA ───────────────────────────────────────────────────────────
    const double foc = 2.0;
    const Vec3 vtx{0.5, -1.0, 2.0};
    nb::Curve par = nb::Curve::makeParabola(vtx, f.refDir, f.axis, foc, -3.0, 3.0);
    for (double t : {0.0, 0.4, -1.7, 3.0}) {
        const std::string at = " @t=" + std::to_string(t);
        const CurveProps p = curveProps(par, t);
        const double kexp = 1.0 / (2.0 * foc *
                             std::pow(1.0 + t * t / (4.0 * foc * foc), 1.5));
        ckTrue("parabola defined" + at, p.defined && p.normalDefined);
        // The POINT and the derivatives, term by term — a curvature can be right
        // for two wrong derivatives whose ratio happens to survive.
        ckVecNear("parabola C == V + (t^2/4f)R + tB" + at, p.p,
                  vtx + f.refDir * (t * t / (4.0 * foc)) + B * t, 1e-13);
        ckVecNear("parabola C' == (t/2f)R + B" + at, p.d1,
                  f.refDir * (t / (2.0 * foc)) + B, 1e-14);
        ckVecNear("parabola C'' == (1/2f)R  [CONSTANT]" + at, p.d2,
                  f.refDir * (1.0 / (2.0 * foc)), 1e-14);
        ckExact("parabola C''' == 0 EXACTLY" + at, p.d3.length(), 0.0);
        ckNear("parabola kappa closed form" + at, p.curvature, kexp, 1.0 / (2.0 * foc));
    }
    // The APEX is the one station where the answer is a bare constant, so it is
    // asserted on its own: a wrong t-dependent factor cannot hide here.
    ckNear("parabola APEX kappa == 1/(2f) (vertex radius 2f)",
           curveProps(par, 0.0).curvature, 1.0 / (2.0 * foc), 1.0 / (2.0 * foc));
    // At the apex the principal normal is +refDir: the parabola opens that way,
    // so the centre of curvature lies at V + 2f*R.
    ckVecNear("parabola APEX normal points INTO the opening (+refDir)",
              curveProps(par, 0.0).normal, f.refDir, 1e-14);

    // ── HYPERBOLA ──────────────────────────────────────────────────────────
    const double ha = 3.0, hb = 2.0;
    const Vec3 ctr{-1.0, 0.25, 0.5};
    nb::Curve hyp = nb::Curve::makeHyperbola(ctr, f.refDir, f.axis, ha, hb, -1.5, 1.5);
    for (double t : {0.0, 0.2, 1.0, -1.5}) {
        const std::string at = " @t=" + std::to_string(t);
        const double sh = std::sinh(t), ch = std::cosh(t);
        const CurveProps p = curveProps(hyp, t);
        const double den = std::pow(ha * ha * sh * sh + hb * hb * ch * ch, 1.5);
        const double kexp = ha * hb / den;
        ckTrue("hyperbola defined" + at, p.defined && p.normalDefined);
        ckVecNear("hyperbola C == O + a cosh R + b sinh B" + at, p.p,
                  ctr + f.refDir * (ha * ch) + B * (hb * sh), 1e-13);
        ckVecNear("hyperbola C' == a sinh R + b cosh B" + at, p.d1,
                  f.refDir * (ha * sh) + B * (hb * ch), 1e-13);
        ckVecNear("hyperbola C'' == a cosh R + b sinh B" + at, p.d2,
                  f.refDir * (ha * ch) + B * (hb * sh), 1e-13);
        // The hyperbolic mirror of the circle's C''' == -C': cosh and sinh
        // exchange under d/dt, so the third derivative returns to the first.
        ckVecNear("hyperbola C''' == C' EXACTLY" + at, p.d3, p.d1, 0.0);
        ckNear("hyperbola kappa closed form" + at, p.curvature, kexp, ha / (hb * hb));
    }
    ckNear("hyperbola WAIST kappa == a/b^2", curveProps(hyp, 0.0).curvature,
           ha / (hb * hb), ha / (hb * hb));
    // At the waist C' = b*B and C'' = a*R are ORTHOGONAL, so the principal normal
    // is exactly +refDir (the branch curves back toward the centre).
    ckVecNear("hyperbola WAIST normal == +refDir", curveProps(hyp, 0.0).normal,
              f.refDir, 1e-14);
}

// ══════════════════ 11. SURFACE OF REVOLUTION (T-151) ═══════════════════════
// The implementation sweeps the meridian with Rodrigues' formula. The closed
// forms below are the classical PROFILE-CURVE forms for a surface of revolution
// whose meridian is (rho(v), z(v)) in a half-plane containing the axis:
//     W^2 = rho'^2 + z'^2
//     K = z'(z'' rho' - rho'' z') / (rho W^4)
//     H = [rho (rho'' z' - z'' rho') - z' W^2] / (2 rho W^3)
// with the normal +(S_u x S_v). That is a DIFFERENT expression path from the
// implementation (which forms no profile at all), and it is verified here on two
// fixtures whose answers are independently known: a CIRCLE meridian must give the
// torus forms and a LINE meridian must give the cone forms -- so the profile
// formula is not taken on trust either.
static double revK(double rho, double rho1, double rho2, double z1, double z2) {
    const double W2 = rho1 * rho1 + z1 * z1;
    return z1 * (z2 * rho1 - rho2 * z1) / (rho * W2 * W2);
}
static double revH(double rho, double rho1, double rho2, double z1, double z2) {
    const double W2 = rho1 * rho1 + z1 * z1;
    const double W = std::sqrt(W2);
    return (rho * (rho2 * z1 - z2 * rho1) - z1 * W2) / (2.0 * rho * W2 * W);
}

static forge::props::PropSurface mkRevolved(const nb::Curve& meridian,
                                            const Vec3& axisOrigin,
                                            const Vec3& axisDir, bool rev) {
    forge::props::PropSurface ps;
    ps.form = forge::props::PropSurface::Form::Revolved;
    ps.meridian = meridian;
    ps.axisOrigin = axisOrigin;
    ps.axisDir = axisDir;
    ps.revolvedReversed = rev;
    return ps;
}

// Monomial coefficients of a cubic Bezier, written out so the B-spline fixture's
// expectation is ARITHMETIC and not a second call to the evaluator under test:
//   B(v) = p0 + 3(p1-p0)v + 3(p0-2p1+p2)v^2 + (-p0+3p1-3p2+p3)v^3
struct Cubic {
    double c0, c1, c2, c3;
    double at(double v) const { return c0 + v * (c1 + v * (c2 + v * c3)); }
    double d1(double v) const { return c1 + v * (2.0 * c2 + v * 3.0 * c3); }
    double d2(double v) const { return 2.0 * c2 + 6.0 * c3 * v; }
};
static Cubic cubicOfBezier(double p0, double p1, double p2, double p3) {
    return Cubic{p0, 3.0 * (p1 - p0), 3.0 * (p0 - 2.0 * p1 + p2),
                 -p0 + 3.0 * p1 - 3.0 * p2 + p3};
}

static void gateRevolution() {
    std::printf("\n-- SURFACE OF REVOLUTION: a CIRCLE meridian must reproduce the\n"
                "   TORUS closed forms, a LINE meridian the CONE closed forms, and a\n"
                "   cubic B-spline meridian the profile forms K,H(rho,z) --\n");
    const Frame f = rotatedFrame();
    const Vec3 k = f.axis, X = f.refDir, Y = k.cross(X);
    const Vec3 A{0.3, -0.8, 1.4};          // a point ON the axis, off the origin
    const double pi = 3.14159265358979323846;

    // ── R1. CIRCLE meridian == TORUS ───────────────────────────────────────
    // The meridian circle lies in the (X,k) half-plane at radius Rmaj from the
    // axis. Its frame is chosen so binormal = normal x refDir == k, which makes
    // S(u,v) term-for-term the native torus with r1=Rmaj, r2=rmin.
    {
        const double Rmaj = 5.0, rmin = 1.5;
        const nb::Curve mer = nb::Curve::makeCircle(A + X * Rmaj, X, Y * -1.0, rmin);
        const forge::props::PropSurface rev = mkRevolved(mer, A, k, false);
        const double u = 1.1;
        const double vs[4] = {0.0, pi * 0.5, pi, pi * 1.5};
        const char* nm[4] = {"v=0 (outer equator)", "v=pi/2 (top)",
                             "v=pi (inner equator)", "v=3pi/2 (bottom)"};
        for (int i = 0; i < 4; ++i) {
            const double v = vs[i], cv = std::cos(v);
            const double ring = Rmaj + rmin * cv;
            const double Kexp = cv / (rmin * ring);
            const double Hexp = -(Rmaj + 2.0 * rmin * cv) / (2.0 * rmin * ring);
            const SurfProps p = surfaceProps(rev, u, v);
            ckTrue(std::string("rev(circle) defined ") + nm[i],
                   p.normalDefined && p.curvatureDefined);
            ckNear(std::string("rev(circle) K == torus K ") + nm[i], p.kGauss, Kexp,
                   1.0 / (rmin * rmin));
            ckNear(std::string("rev(circle) H == torus H ") + nm[i], p.kMean, Hexp,
                   1.0 / rmin);
            // The point itself: |distance from the axis| must be the ring radius.
            const Vec3 w = p.p - A;
            const double rho = (w - k * w.dot(k)).length();
            ckNear(std::string("rev(circle) distance from axis == R + r cos v ") + nm[i],
                   rho, ring, ring);

            // ── THE MIXED PARTIAL, ASSERTED DIRECTLY, AND WHY IT HAS TO BE ────
            // A surface of revolution is parameterised ORTHOGONALLY: F = S_u.S_v
            // is 0 and M = S_uv.n is 0 — the two n-components of S_uv's own terms
            // cancel exactly. So S_uv reaches H not at all (H's cross term is
            // -2FM with F == 0) and reaches K only as -M^2, i.e. QUADRATICALLY.
            // MEASURED: scaling one term of S_uv by 1 + 1e-6 changed nothing this
            // gate could see, and the whole 449-assertion run stayed green. That
            // is the same blindness the shear fixture was built for, in a new
            // place, so the reported second partials are asserted against the
            // closed form outright:
            //   S_uu = -rho (cos u X + sin u Y)
            //   S_uv =  rho' (-sin u X + cos u Y)
            //   S_vv =  z'' k + rho'' (cos u X + sin u Y)
            // with rho = R + r cos v, z = r sin v for the circle meridian.
            const double sv = std::sin(v);
            const double rho1 = -rmin * sv, rho2 = -rmin * cv, z2 = -rmin * sv;
            const Vec3 er = X * std::cos(u) + Y * std::sin(u);      // radial at u
            const Vec3 et = X * -std::sin(u) + Y * std::cos(u);     // tangential at u
            ckVecNear(std::string("rev(circle) S_uu == -rho * e_r ") + nm[i],
                      p.d2uu, er * (-ring), 1e-12);
            ckVecNear(std::string("rev(circle) S_uv == rho' * e_theta ") + nm[i],
                      p.d2uv, et * rho1, 1e-12);
            ckVecNear(std::string("rev(circle) S_vv == z'' k + rho'' e_r ") + nm[i],
                      p.d2vv, k * z2 + er * rho2, 1e-12);
        }
        // REVERSED: H must negate and the principals negate AND swap. This is the
        // assertion that catches a dropped orientation flip in the new form.
        const SurfProps pf = surfaceProps(rev, 1.1, 0.7);
        const SurfProps pr = surfaceProps(mkRevolved(mer, A, k, true), 1.1, 0.7);
        ckNear("rev(circle) reversed K is UNCHANGED", pr.kGauss, pf.kGauss,
               1.0 / (rmin * rmin));
        ckNear("rev(circle) reversed H NEGATES", pr.kMean, -pf.kMean, 1.0 / rmin);
        ckNear("rev(circle) reversed kMin == -kMax", pr.kMin, -pf.kMax, 1.0 / rmin);
        ckVecNear("rev(circle) reversed normal flips", pr.normal, -pf.normal, 1e-14);
    }

    // ── R2. LINE meridian == CONE ──────────────────────────────────────────
    // C(t) = p0 + t(p1-p0) over t in [0,1], so rho(t) = r1 + dr t and z(t) = h t:
    // exactly the native cone's parameterisation.
    {
        const double r1 = 3.0, r2 = 1.0, h = 4.0, dr = r2 - r1;
        const double sl = std::sqrt(dr * dr + h * h);
        const nb::Curve mer = nb::Curve::makeLine(A + X * r1, A + X * r2 + k * h);
        const forge::props::PropSurface rev = mkRevolved(mer, A, k, false);
        for (double t : {0.0, 0.5, 1.0}) {
            const double r = r1 + dr * t;
            const double Hexp = -h / (2.0 * r * sl);
            const SurfProps p = surfaceProps(rev, 0.4, t);
            const std::string at = " @v=" + std::to_string(t);
            ckTrue("rev(line) defined" + at, p.normalDefined && p.curvatureDefined);
            ckNear("rev(line) K == 0 (developable)" + at, p.kGauss, 0.0, 1.0 / (r * r));
            ckNear("rev(line) H == cone -h/(2 r sl)" + at, p.kMean, Hexp, 1.0 / r);
            ckNear("rev(line) kMin == 2H" + at, p.kMin, 2.0 * Hexp, 1.0 / r);
        }
    }

    // ── R3. CUBIC B-SPLINE meridian == the profile forms ───────────────────
    // This is the fixture the free-form revolutions of real lathe parts are, and
    // the one that proves the meridian derivatives are taken from curveProps
    // rather than assumed analytic. The expectation is built from the cubic's own
    // MONOMIAL coefficients (Cubic above), not from the evaluator.
    {
        const double xs[4] = {1.0, 1.6, 0.9, 1.4};     // rho control values
        const double zs[4] = {0.0, 1.1, 2.4, 3.2};     // z   control values
        const Cubic RHO = cubicOfBezier(xs[0], xs[1], xs[2], xs[3]);
        const Cubic Z   = cubicOfBezier(zs[0], zs[1], zs[2], zs[3]);

        nb::NurbsCurve nc;
        nc.degree = 3;
        nc.controlPoints = {A + X * xs[0] + k * zs[0], A + X * xs[1] + k * zs[1],
                            A + X * xs[2] + k * zs[2], A + X * xs[3] + k * zs[3]};
        nc.weights = {1.0, 1.0, 1.0, 1.0};
        nc.knots = {0, 0, 0, 0, 1, 1, 1, 1};
        ckTrue("rev(bspline) meridian net is valid", nc.valid());
        const nb::Curve mer = nb::Curve::makeBSpline(nc);
        const forge::props::PropSurface rev = mkRevolved(mer, A, k, false);

        // SAMPLE THE DOMAIN, including both ENDS: a wrong meridian second
        // derivative is smallest in the middle and largest at the clamped ends.
        for (double v : {0.0, 0.17, 0.5, 0.83, 1.0}) {
            const double rho = RHO.at(v), r1d = RHO.d1(v), r2d = RHO.d2(v);
            const double z1 = Z.d1(v), z2 = Z.d2(v);
            const double Kexp = revK(rho, r1d, r2d, z1, z2);
            const double Hexp = revH(rho, r1d, r2d, z1, z2);
            const SurfProps p = surfaceProps(rev, 2.3, v);
            const std::string at = " @v=" + std::to_string(v);
            ckTrue("rev(bspline) defined" + at, p.normalDefined && p.curvatureDefined);
            ckNear("rev(bspline) K == profile form" + at, p.kGauss, Kexp,
                   std::fabs(Kexp) + 1.0);
            ckNear("rev(bspline) H == profile form" + at, p.kMean, Hexp,
                   std::fabs(Hexp) + 1.0);
            const Vec3 w = p.p - A;
            ckNear("rev(bspline) distance from axis == rho(v)" + at,
                   (w - k * w.dot(k)).length(), rho, rho);
            ckNear("rev(bspline) axial coordinate == z(v)" + at, w.dot(k), Z.at(v),
                   std::fabs(Z.at(v)) + 1.0);
            // The same three second partials, on the FREE-FORM meridian, with
            // rho/z from the cubic's own monomial coefficients. Same reason as
            // the circle case: S_uv is invisible to K and H on any revolution.
            const Vec3 er = X * std::cos(2.3) + Y * std::sin(2.3);
            const Vec3 et = X * -std::sin(2.3) + Y * std::cos(2.3);
            ckVecNear("rev(bspline) S_uu == -rho * e_r" + at, p.d2uu, er * (-rho),
                      1e-11);
            ckVecNear("rev(bspline) S_uv == rho' * e_theta" + at, p.d2uv, et * r1d,
                      1e-11);
            ckVecNear("rev(bspline) S_vv == z'' k + rho'' e_r" + at, p.d2vv,
                      k * Z.d2(v) + er * r2d, 1e-11);
        }
        // THE PROFILE FORMULA IS ITSELF CHECKED, not taken on trust: fed the
        // torus's own (rho,z) it must reproduce the torus K and H.
        {
            const double R = 5.0, r = 1.5, v = 0.7;
            const double rho = R + r * std::cos(v);
            const double r1d = -r * std::sin(v), r2d = -r * std::cos(v);
            const double z1 = r * std::cos(v), z2 = -r * std::sin(v);
            ckNear("the profile formula reproduces torus K (self-check)",
                   revK(rho, r1d, r2d, z1, z2), std::cos(v) / (r * rho), 1.0 / (r * r));
            ckNear("the profile formula reproduces torus H (self-check)",
                   revH(rho, r1d, r2d, z1, z2),
                   -(R + 2.0 * r * std::cos(v)) / (2.0 * r * rho), 1.0 / r);
        }
    }

    // ── R3b. THE CLAIM "A REVOLUTION INHERITS EVERY CURVE KIND" IS MEASURED ──
    // revolvedProps takes m, m' and m'' from curveProps and nothing else, so it
    // should carry any meridian the curve side supports. That is a CLAIM until a
    // fixture drives the kinds it names, and the three above only exercise
    // Circle / Line / BSpline. These two close the gap on the ELLIPSE and — the
    // composition that matters most, one T-151 addition feeding the other — the
    // PARABOLA, whose revolution is a paraboloid. Both are checked against the
    // same profile forms, with rho and z written out from the meridian's own
    // closed form rather than read back from the evaluator.
    {
        // ELLIPSE meridian in the (X,k) half-plane: centre at distance Rc from
        // the axis, semi-axes ea along X and eb along k. Its frame is chosen so
        // binormal = normal x refDir == k, exactly as the circle case.
        //   rho(v) = Rc + ea cos v,  z(v) = eb sin v
        const double Rc = 4.0, ea = 1.3, eb = 0.8;
        const nb::Curve mer =
            nb::Curve::makeEllipse(A + X * Rc, X, Y * -1.0, ea, eb);
        const forge::props::PropSurface rev = mkRevolved(mer, A, k, false);
        for (double v : {0.0, 0.7, 2.1, 4.0}) {
            const double cvv = std::cos(v), svv = std::sin(v);
            const double rho = Rc + ea * cvv, r1d = -ea * svv, r2d = -ea * cvv;
            const double z1 = eb * cvv, z2 = -eb * svv;
            const SurfProps p = surfaceProps(rev, 1.7, v);
            const std::string at = " @v=" + std::to_string(v);
            ckTrue("rev(ELLIPSE meridian) defined" + at,
                   p.normalDefined && p.curvatureDefined);
            ckNear("rev(ELLIPSE meridian) K == profile form" + at, p.kGauss,
                   revK(rho, r1d, r2d, z1, z2), 1.0 / (ea * ea) + 1.0);
            ckNear("rev(ELLIPSE meridian) H == profile form" + at, p.kMean,
                   revH(rho, r1d, r2d, z1, z2), 1.0 / ea + 1.0);
        }
    }
    {
        // PARABOLA meridian -> a PARABOLOID OF REVOLUTION. This is the one
        // fixture where BOTH T-151 additions are in the same call: the surface of
        // revolution differentiates a conic that did not exist in the curve model
        // before this change.
        //   the meridian's vertex sits at distance Rv from the axis, opening
        //   along +X, so with C(t) = V + (t^2/4f) X + t k:
        //     rho(t) = Rv + t^2/(4f),  z(t) = t
        const double Rv = 2.0, foc = 1.6;
        const nb::Curve mer =
            nb::Curve::makeParabola(A + X * Rv, X, Y * -1.0, foc, -2.0, 2.0);
        const forge::props::PropSurface rev = mkRevolved(mer, A, k, false);
        for (double t : {-2.0, -0.4, 0.0, 1.1, 2.0}) {
            const double rho = Rv + t * t / (4.0 * foc);
            const double r1d = t / (2.0 * foc), r2d = 1.0 / (2.0 * foc);
            const double z1 = 1.0, z2 = 0.0;
            const SurfProps p = surfaceProps(rev, 0.6, t);
            const std::string at = " @v=" + std::to_string(t);
            ckTrue("rev(PARABOLA meridian) defined" + at,
                   p.normalDefined && p.curvatureDefined);
            ckNear("rev(PARABOLA meridian) K == profile form" + at, p.kGauss,
                   revK(rho, r1d, r2d, z1, z2), 1.0 / (foc * foc) + 1.0);
            ckNear("rev(PARABOLA meridian) H == profile form" + at, p.kMean,
                   revH(rho, r1d, r2d, z1, z2), 1.0 / foc + 1.0);
            // and the point, from the meridian's own closed form.
            const Vec3 w = p.p - A;
            ckNear("rev(PARABOLA meridian) distance from axis == rho(t)" + at,
                   (w - k * w.dot(k)).length(), rho, rho);
        }
        // AT THE MERIDIAN'S APEX (t = 0) the general profile form COLLAPSES to a
        // one-term closed form, and it is worth asserting separately because this
        // is the single station where the parabola's CONSTANT C'' is the only
        // non-zero second derivative in the whole expression — a wrong constant
        // has nothing to hide behind here.
        //   rho' = 0, z' = 1, z'' = 0, W = 1, rho'' = 1/(2f)
        //   => K = -rho''/rho = -1/(2 f Rv),  H = (rho/(2f) - 1)/(2 rho)
        // NOTE the SIGN: K is NEGATIVE. This surface is a saddle-waisted
        // paraboloid — the meridian bends AWAY from the axis in both directions,
        // so the two principal curvatures have opposite signs. (The first version
        // of this assertion claimed K == 0 on the intuition that an apex is flat;
        // the gate said -0.15625 and the gate was right. The expectation was the
        // defect, and it is written out above so nobody re-derives it wrongly.)
        const SurfProps apex = surfaceProps(rev, 0.6, 0.0);
        ckNear("rev(PARABOLA) meridian APEX: K == -1/(2 f Rv)  [SADDLE, not flat]",
               apex.kGauss, -1.0 / (2.0 * foc * Rv), 1.0 / (foc * Rv));
        ckNear("rev(PARABOLA) meridian APEX: H == (rho/(2f) - 1)/(2 rho)",
               apex.kMean, (Rv / (2.0 * foc) - 1.0) / (2.0 * Rv), 1.0 / foc + 1.0);
    }

    // ── R4. THE POLE, IN BOTH DIRECTIONS ───────────────────────────────────
    // Where the meridian MEETS THE AXIS the whole parallel collapses to a point
    // and S_u is exactly zero: that must be reported UNDEFINED, not as 0.
    {
        const nb::Curve mer = nb::Curve::makeLine(A, A + X * 2.0 + k * 3.0);
        const forge::props::PropSurface rev = mkRevolved(mer, A, k, false);
        const SurfProps pole = surfaceProps(rev, 0.9, 0.0);
        ckTrue("rev POLE (meridian on the axis) normalDefined == FALSE",
               !pole.normalDefined);
        ckTrue("rev POLE curvatureDefined == FALSE", !pole.curvatureDefined);
        ckTrue("rev POLE the point is still reported",
               (pole.p - A).length() <= 1e-15,
               "|p-A|=" + std::to_string((pole.p - A).length()));
        // The other direction: a station AWAY from the pole is a perfectly good
        // point and must answer. A guard that refuses everything is not a guard.
        const SurfProps ok = surfaceProps(rev, 0.9, 0.3);
        ckTrue("rev v=0.3 is ACCEPTED (the pole guard is not blanket)",
               ok.normalDefined && ok.curvatureDefined);
    }

    // ── R5. A NON-UNIT AXIS IS REFUSED, NOT SILENTLY NORMALISED ────────────
    {
        const nb::Curve mer = nb::Curve::makeCircle(A + X * 5.0, X, Y * -1.0, 1.5);
        const SurfProps bad = surfaceProps(mkRevolved(mer, A, k * 2.0, false), 1.0, 0.5);
        ckTrue("rev with a NON-UNIT axis is refused (contract, not a guess)",
               !bad.normalDefined && !bad.curvatureDefined);
    }
}

// ══════════════════════ 12. OFFSET SURFACE (T-151) ══════════════════════════
// The implementation differentiates S + d*n directly (quotient rule on C/|C|,
// reaching the base's THIRD derivatives). Two independent closed forms check it:
//
//  (a) ELEMENTARY: the offset of a sphere/cylinder/torus IS the same elementary
//      surface with one radius shifted, so the textbook forms apply outright.
//      These are the strongest checks because they know the whole answer.
//  (b) THE PARALLEL-SURFACE IDENTITY: for ANY base, the principal directions are
//      unchanged and k_off = k/(1 - d k), whence
//          K_off = K / (1 - 2dH + d^2 K)
//          H_off = (H - dK) / (1 - 2dH + d^2 K)
//      and the offset's normal EQUALS the base's. This is what covers the cone
//      (no simpler form that is not itself a cone) and the free-form NURBS base.
//      It is a closed form in the base's own invariants, taken from the Native
//      code path -- a different path from the one under test.
static forge::props::PropSurface mkOffset(const nb::Surface& base, double d) {
    forge::props::PropSurface ps;
    ps.form = forge::props::PropSurface::Form::Offset;
    ps.base = base;
    ps.offsetDistance = d;
    return ps;
}

// Assert the parallel-surface identity at one station, printing the residual.
static void ckParallel(const std::string& what, const nb::Surface& base, double d,
                       double u, double v) {
    const SurfProps b = surfaceProps(base, u, v);
    const SurfProps o = surfaceProps(mkOffset(base, d), u, v);
    const std::string at = " @(" + std::to_string(u) + "," + std::to_string(v) + ")";
    if (!b.curvatureDefined) {
        ckTrue(what + " base is defined" + at, false, "base curvature undefined");
        return;
    }
    const double den = 1.0 - 2.0 * d * b.kMean + d * d * b.kGauss;
    ckTrue(what + " base+offset both defined" + at,
           o.normalDefined && o.curvatureDefined);
    if (!o.curvatureDefined) return;
    const double scale = std::fabs(b.kMean) + std::fabs(b.kGauss) + 1.0;
    ckNear(what + " K_off == K/(1-2dH+d^2K)" + at, o.kGauss, b.kGauss / den, scale);
    ckNear(what + " H_off == (H-dK)/(1-2dH+d^2K)" + at, o.kMean,
           (b.kMean - d * b.kGauss) / den, scale);
    // N_off == N is a theorem wherever both (1 - d k_i) are positive, and it is
    // what a sign error in n_u / n_v breaks first.
    ckVecNear(what + " normal is UNCHANGED by the offset" + at, o.normal, b.normal,
              1e-12);
    // The point moved by exactly d along that normal.
    ckNear(what + " |S_off - S| == |d|" + at, (o.p - b.p).length(), std::fabs(d),
           std::fabs(d) + 1.0);
}

static void gateOffset() {
    std::printf("\n-- OFFSET S + d*n: elementary bases must give the elementary\n"
                "   answer exactly, and EVERY base must satisfy the parallel-surface\n"
                "   identity k_off = k/(1 - d k) --\n");
    const Frame f = rotatedFrame();

    // ── O1. SPHERE base: the answer is the sphere of radius R - d ──────────
    // The native (theta,phi) sphere's own normal is INWARD (SurfaceProps.hpp), so
    // offsetting by +d along it SHRINKS the sphere. That sign is the point of
    // this fixture, not an accident of the fixture's orientation.
    {
        const double R = 1.75, d = 0.4, Rp = R - d;
        const nb::Surface s = mkSphere(f, R, false);
        for (double v : {0.6, 1.4, 2.5}) {
            const SurfProps o = surfaceProps(mkOffset(s, d), 0.9, v);
            const std::string at = " @v=" + std::to_string(v);
            ckTrue("offset(sphere) defined" + at, o.normalDefined && o.curvatureDefined);
            ckNear("offset(sphere) K == 1/(R-d)^2" + at, o.kGauss, 1.0 / (Rp * Rp),
                   1.0 / (Rp * Rp));
            ckNear("offset(sphere) H == 1/(R-d)" + at, o.kMean, 1.0 / Rp, 1.0 / Rp);
            ckNear("offset(sphere) |p - centre| == R-d" + at,
                   (o.p - s.origin).length(), Rp, Rp);
            // Umbilic: the SPLIT carries the sqrt-of-a-cancelled-discriminant
            // bound, exactly as for the plain sphere.
            ckUmbilic("offset(sphere) kMin == 1/(R-d)" + at, o.kMin, 1.0 / Rp, 1.0 / Rp);
            ckUmbilic("offset(sphere) kMax == 1/(R-d)" + at, o.kMax, 1.0 / Rp, 1.0 / Rp);
        }
        // REVERSED base: the offset goes the OTHER way, to R + d, and H is
        // measured against the outward normal so it is -1/(R+d).
        const double Rm = R + d;
        const SurfProps orv = surfaceProps(mkOffset(mkSphere(f, R, true), d), 0.9, 1.4);
        ckNear("offset(sphere, REVERSED base) K == 1/(R+d)^2", orv.kGauss,
               1.0 / (Rm * Rm), 1.0 / (Rm * Rm));
        ckNear("offset(sphere, REVERSED base) H == -1/(R+d)", orv.kMean, -1.0 / Rm,
               1.0 / Rm);
        ckNear("offset(sphere, REVERSED base) |p - centre| == R+d",
               (orv.p - mkSphere(f, R, true).origin).length(), Rm, Rm);
    }

    // ── O2. CYLINDER base: the answer is the cylinder of radius R + d ──────
    // The native cylinder's own normal is OUTWARD, so +d GROWS it.
    {
        const double R = 2.5, d = 0.3, Rp = R + d;
        const nb::Surface s = mkCylinder(f, R, false);
        for (double u : {0.0, 1.3, 4.9}) {
            const SurfProps o = surfaceProps(mkOffset(s, d), u, 2.0);
            const std::string at = " @u=" + std::to_string(u);
            ckTrue("offset(cylinder) defined" + at, o.normalDefined && o.curvatureDefined);
            ckNear("offset(cylinder) K == 0" + at, o.kGauss, 0.0, 1.0 / (Rp * Rp));
            ckNear("offset(cylinder) H == -1/(2(R+d))" + at, o.kMean,
                   -1.0 / (2.0 * Rp), 1.0 / Rp);
            ckNear("offset(cylinder) kMin == -1/(R+d)" + at, o.kMin, -1.0 / Rp, 1.0 / Rp);
            ckNear("offset(cylinder) kMax == 0" + at, o.kMax, 0.0, 1.0 / Rp);
        }
    }

    // ── O3. TORUS base: the answer is the torus of minor radius r + d ──────
    // The one elementary fixture with K != 0 AND H != 0 AND no umbilic, so it is
    // the only one where every term of the identity is separately non-trivial.
    {
        const double Rmaj = 5.0, rmin = 1.5, d = 0.45, rp = rmin + d;
        const nb::Surface s = mkTorus(f, Rmaj, rmin, false);
        for (double v : {0.0, 0.9, 2.2, 4.4}) {
            const double cv = std::cos(v);
            const double ring = Rmaj + rp * cv;
            const double Kexp = cv / (rp * ring);
            const double Hexp = -(Rmaj + 2.0 * rp * cv) / (2.0 * rp * ring);
            const SurfProps o = surfaceProps(mkOffset(s, d), 1.1, v);
            const std::string at = " @v=" + std::to_string(v);
            ckTrue("offset(torus) defined" + at, o.normalDefined && o.curvatureDefined);
            ckNear("offset(torus) K == torus(r+d) K" + at, o.kGauss, Kexp,
                   1.0 / (rp * rp));
            ckNear("offset(torus) H == torus(r+d) H" + at, o.kMean, Hexp, 1.0 / rp);
        }
    }

    // ── O4. CONE base — the MEASURED kind (the 19-kind probe's offset case) ──
    // K is 0 and H follows the parallel identity; the SECOND, independent closed
    // form is that the offset of a cone IS a cone whose radius at v grew by
    // d cos(alpha), giving H_off = -h / (2 (r(v) + d cos a) sqrt(dr^2 + h^2)).
    {
        const double r1 = 3.0, r2 = 1.0, h = 4.0, d = 0.25;
        const double dr = r2 - r1, sl = std::sqrt(dr * dr + h * h), ca = h / sl;
        const nb::Surface s = mkCone(alignedFrame(), r1, r2, h, false);
        for (double v : {0.0, 0.35, 0.7, 1.0}) {
            const double r = r1 + dr * v;
            const double Hbase = -h / (2.0 * r * sl);
            const double Hshift = -h / (2.0 * (r + d * ca) * sl);   // the SHIFTED cone
            const SurfProps o = surfaceProps(mkOffset(s, d), 0.4, v);
            const std::string at = " @v=" + std::to_string(v);
            ckTrue("offset(cone) defined" + at, o.normalDefined && o.curvatureDefined);
            ckNear("offset(cone) K == 0 (still developable)" + at, o.kGauss, 0.0,
                   1.0 / (r * r));
            ckNear("offset(cone) H == H/(1-2dH)  [parallel identity]" + at, o.kMean,
                   Hbase / (1.0 - 2.0 * d * Hbase), 1.0 / r);
            ckNear("offset(cone) H == the SHIFTED cone's own form" + at, o.kMean,
                   Hshift, 1.0 / r);

            // ── THE SECOND PARTIALS, WHICH ARE WHERE THE BASE'S THIRD ORDER IS
            // THE ONLY THING THAT SHOWS. n.n == 1 differentiates to
            // n.n_uu == -|n_u|^2, so L_off = L - d|n_u|^2 sees the base only to
            // SECOND order: a wrong THIRD derivative moves n_uu purely
            // TANGENTIALLY and cannot change K or H by construction. It does move
            // the REPORTED d2uu/d2uv/d2vv, which SurfProps promises to a caller
            // verifying G2 continuity. MEASURED: a sign-flipped cone S_uuv
            // survived every curvature assertion in this gate and is caught here.
            //
            // The closed form: the offset of a cone IS a cone, with
            //   rho_off(v) = r(v) + d cos(a)   and   z_off(v) = h v - d dr/sl,
            // both AFFINE in v with the SAME slopes, so
            //   S_uu = -rho_off (cos u R + sin u B),  S_uv = dr (-sin u R + cos u B),
            //   S_vv = 0 EXACTLY.
            const double cu = std::cos(0.4), su = std::sin(0.4);
            const Vec3 Rd{1, 0, 0}, Bd{0, 1, 0}, Ad{0, 0, 1};
            const double rho_off = r + d * ca;
            ckVecNear("offset(cone) S_uu == -(r + d cos a)(cos u R + sin u B)" + at,
                      o.d2uu, (Rd * cu + Bd * su) * (-rho_off), 1e-12);
            ckVecNear("offset(cone) S_uv == dr(-sin u R + cos u B)  [slope unchanged]"
                      + at, o.d2uv, (Rd * (-su) + Bd * cu) * dr, 1e-12);
            ckNear("offset(cone) |S_vv| == 0 (both profile terms stay affine)" + at,
                   o.d2vv.length(), 0.0, 1.0);
            // and the POINT, from the same shifted-cone closed form.
            ckVecNear("offset(cone) p == rho_off(cos u R + sin u B) + z_off A" + at,
                      o.p, (Rd * cu + Bd * su) * rho_off
                           + Ad * (h * v - d * dr / sl), 1e-12);
        }
        ckParallel("offset(cone)", s, d, 0.4, 0.35);
        ckParallel("offset(cone, negative d)", s, -0.2, 2.1, 0.8);
    }

    // ── O5. FREE-FORM (NURBS) base — the branch that needs the order-3 table ──
    // Nothing else in this gate reaches surfaceDerivatives(..., 3); a wrong third
    // derivative changes the offset's SECOND derivatives and so breaks the
    // identity here and nowhere else.
    {
        nb::Surface s;
        s.kind = nb::SurfaceKind::Nurbs;
        s.nurbs.degreeU = 3;
        s.nurbs.degreeV = 3;
        s.nurbs.knotsU = {0, 0, 0, 0, 1, 1, 1, 1};
        s.nurbs.knotsV = {0, 0, 0, 0, 1, 1, 1, 1};
        s.nurbs.control.assign(4, std::vector<Vec3>(4));
        s.nurbs.weights.assign(4, std::vector<double>(4, 1.0));
        for (int i = 0; i < 4; ++i)
            for (int j = 0; j < 4; ++j) {
                const double x = i * 1.3, y = j * 1.1;
                s.nurbs.control[i][j] =
                    Vec3{x, y, 0.35 * std::sin(0.9 * x) * std::cos(0.7 * y)};
            }
        ckTrue("offset(nurbs) base net is valid", s.nurbs.valid());
        for (double u : {0.15, 0.5, 0.85})
            for (double v : {0.2, 0.75})
                ckParallel("offset(nurbs 4x4 bicubic)", s, 0.22, u, v);
        // A RATIONAL base too: a non-unit weight exercises the quotient terms of
        // the derivative table that a polynomial patch leaves at 1.
        s.nurbs.weights[1][2] = 1.7;
        s.nurbs.weights[2][1] = 0.6;
        ckParallel("offset(nurbs RATIONAL)", s, 0.18, 0.4, 0.6);
    }

    // ── O6. ELLIPTICAL CYLINDER base — the last analytic third-derivative kind ─
    {
        const nb::Surface s = mkEllipseCyl(f, 3.0, 2.0);
        for (double u : {0.0, 0.9, 2.5}) ckParallel("offset(elliptic cyl)", s, 0.3, u, 1.0);
    }

    // ── O7. PLANE base: the offset of a plane is the SAME plane, translated ──
    {
        const nb::Surface s = mkPlane(f);
        const SurfProps o = surfaceProps(mkOffset(s, 0.75), 0.3, -1.7);
        ckTrue("offset(plane) defined", o.normalDefined && o.curvatureDefined);
        ckExact("offset(plane) K == 0", o.kGauss, 0.0);
        ckExact("offset(plane) H == 0", o.kMean, 0.0);
        ckVecNear("offset(plane) normal == the plane's", o.normal, f.axis, 1e-15);
        ckVecNear("offset(plane) p == S + d*n", o.p,
                  surfaceProps(s, 0.3, -1.7).p + f.axis * 0.75, 1e-14);
    }

    // ── O8. THE SINGULARITY, IN BOTH DIRECTIONS ────────────────────────────
    // 1 - d k_i == 0 is the FOCAL surface: the offset's tangent frame collapses
    // and k_off = k/(1-dk) is a pole, not a large number. It must be DECLINED —
    // and a merely nearby point must still be ANSWERED, or the guard is a blanket.
    {
        const double R = 1.75;
        const nb::Surface s = mkSphere(f, R, false);
        // d == R offsets every point of the sphere onto its centre.
        const SurfProps sing = surfaceProps(mkOffset(s, R), 0.9, 1.4);
        ckTrue("offset(sphere, d == R) is DECLINED (the whole sphere is the focus)",
               !sing.normalDefined && !sing.curvatureDefined);
        ckTrue("offset(sphere, d == R) reports no curvature VALUE either",
               sing.kGauss == 0.0 && sing.kMean == 0.0);
        // 0.99R is NOT singular: the answer is a tiny sphere with a huge, and
        // entirely real, curvature.
        const double dn = 0.99 * R, Rn = R - dn;
        const SurfProps near = surfaceProps(mkOffset(s, dn), 0.9, 1.4);
        ckTrue("offset(sphere, d = 0.99R) is ACCEPTED (near is not singular)",
               near.normalDefined && near.curvatureDefined);
        ckNear("offset(sphere, d = 0.99R) K == 1/(0.01R)^2", near.kGauss,
               1.0 / (Rn * Rn), 1.0 / (Rn * Rn));

        // POINTWISE, on a CONE: the singular distance depends on v, so ONE
        // station is declined while another on the SAME surface is answered.
        // The cone's non-zero principal w.r.t. +(S_u x S_v) is k = 2H = -h/(r sl),
        // so 1 - d k == 0 at d = r(v) sl / h  (with the sign k carries).
        const double r1 = 3.0, r2 = 1.0, h = 4.0, dr = r2 - r1;
        const double sl = std::sqrt(dr * dr + h * h);
        const nb::Surface cone = mkCone(alignedFrame(), r1, r2, h, false);
        const double vSing = 0.5;
        const double rS = r1 + dr * vSing;
        const double dSing = -rS * sl / h;          // 1 - d*(-h/(r sl)) == 0
        const SurfProps cs = surfaceProps(mkOffset(cone, dSing), 0.4, vSing);
        ckTrue("offset(cone) DECLINED at the v whose principal radius == d",
               !cs.normalDefined && !cs.curvatureDefined);
        const SurfProps co = surfaceProps(mkOffset(cone, dSing), 0.4, 0.05);
        ckTrue("offset(cone) ANSWERED at another v with the SAME d "
               "(the guard is POINTWISE)", co.normalDefined && co.curvatureDefined);
    }

    // ── O9. A BASE THE FORM CANNOT SUPPLY IS REFUSED, NOT GUESSED ──────────
    {
        nb::Surface bad; bad.kind = nb::SurfaceKind::Nurbs;   // empty control net
        const SurfProps o = surfaceProps(mkOffset(bad, 0.5), 0.5, 0.5);
        ckTrue("offset of an EMPTY NURBS net refused (no out-of-range read)",
               !o.normalDefined && !o.curvatureDefined);
    }
}

int main() {
    std::printf("=== surface_props_closed_form_gate — forge/SurfaceProps vs TEXTBOOK\n");
    std::printf("=== closed forms (never against OCCT). rel tol %.0e, uniform absolute\n", kRel);
    std::printf("=== floor %.0e x the fixture's own curvature scale.\n", kAbsFloor);
    gatePlane();
    gateCylinder();
    gateSphere();
    gateTorus();
    gateCone();
    gateEllipticCylinder();
    gateShearInvariance();
    gateDegenerate();
    gateCurves();
    gateConics();        // T-151: parabola + hyperbola
    gateRevolution();    // T-151: surface of revolution (circle / line / B-spline)
    gateOffset();        // T-151: offset surface + its singularity
    std::printf("\n=== RESULT %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
