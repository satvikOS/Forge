// forge-kernel/test/nurbs_input_validation_gate.cpp — T-153
//
// "An assert() is not input validation." The native NURBS evaluator guarded its
// rational denominator, its shapes and its knot vector with assert(); the
// product builds with -DNDEBUG, where every one of them vanishes. This gate
// feeds malformed NURBS input — zero / negative / NaN / inf weights,
// non-monotone and non-finite knots, degree vs control-point count, empty
// spans and empty domains, ragged / mis-shaped nets, non-finite parameters and
// control points — and asserts a REFUSAL, in whatever build it is compiled in.
// run_nurbs_input_validation_gate.sh compiles it with -DNDEBUG (the shipped
// configuration) AND with asserts live, against this tree AND against the
// pre-T-153 sources (it must FAIL there), and kills mutants of each guard.
//
// It is written so it COMPILES AGAINST THE PRE-T-153 API TOO:
//   * the BEHAVIOURAL checks use only what existed before (valid(), evaluate(),
//     bezier*Point(), findSpan(), basisFunctions());
//   * the TYPED checks (validate() codes, evaluateChecked(), the refusal
//     counter) are compiled iff Nurbs.hpp defines FORGE_NURBS_INPUT_VALIDATION;
//     when it does not, every malformed case FAILS with "typed API absent".
// Every case runs in a forked child with an alarm, so an out-of-bounds read
// that crashes, or a hang, is a named failure of that case, not a dead gate.
//
// Modes
//   (default)                 the case battery; exit 0 iff every case passes
//   --dump-valid              hex dump of raw evaluation over VALID input only
//                             (old API) — the run script diffs pre/post builds
//   --bench                   ns per raw evaluate() on a valid curve / surface
//   --readers                 (built with -DNURBS_GATE_READERS, i.e. linked with
//                             every native TU) synthetic STEP and IGES files, one
//                             corrupt B-spline each: the importer must refuse it
//                             under its NAMED key before any evaluator sees it;
//                             valid controls must import cleanly. Portable (CI).
//   --corpus <list> --root R  (same build) readForeignStep over a fixture list
//                             of real files; each must refuse the named
//                             B-spline with no evaluator refusal and no
//                             non-finite vertex
//
// Pure C++20 + POSIX fork/wait. No test framework. Never weakens an assertion.

#include "forge/native/brep/Nurbs.hpp"
#ifdef NURBS_GATE_READERS
#include "forge/native/brep/IgesRead.hpp"
#include "forge/native/brep/StepRead.hpp"
#include <map>
#endif

#include <chrono>
#include <cinttypes>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#include <sys/wait.h>
#include <unistd.h>

using namespace forge::native::brep;

#ifdef FORGE_NURBS_INPUT_VALIDATION
static constexpr bool kTyped = true;
#else
static constexpr bool kTyped = false;
#endif

namespace {

const double kNaN = std::numeric_limits<double>::quiet_NaN();
const double kInf = std::numeric_limits<double>::infinity();

// Expected codes as integers so the file compiles without the enum. The
// mapping is pinned by static_asserts in the typed build.
enum Code : int {
    C_NONE = 0, C_EMPTY_NET = 1, C_RAGGED = 2, C_WSHAPE = 3, C_DEG0 = 4,
    C_FEW_CP = 5, C_KCOUNT = 6, C_NONFINITE_KNOT = 7, C_DECREASING = 8,
    C_EMPTY_DOMAIN = 9, C_MULT = 10, C_NONFINITE_W = 11, C_NONPOS_W = 12,
    C_NONFINITE_CP = 13, C_NONFINITE_PARAM = 14, C_DENOM = 15, C_NONFINITE_RESULT = 16,
};
#ifdef FORGE_NURBS_INPUT_VALIDATION
static_assert(int(NurbsInputError::EmptyControlNet) == C_EMPTY_NET);
static_assert(int(NurbsInputError::RaggedControlNet) == C_RAGGED);
static_assert(int(NurbsInputError::WeightShapeMismatch) == C_WSHAPE);
static_assert(int(NurbsInputError::DegreeBelowOne) == C_DEG0);
static_assert(int(NurbsInputError::TooFewControlPoints) == C_FEW_CP);
static_assert(int(NurbsInputError::KnotCountMismatch) == C_KCOUNT);
static_assert(int(NurbsInputError::NonFiniteKnot) == C_NONFINITE_KNOT);
static_assert(int(NurbsInputError::DecreasingKnots) == C_DECREASING);
static_assert(int(NurbsInputError::EmptyParameterDomain) == C_EMPTY_DOMAIN);
static_assert(int(NurbsInputError::KnotMultiplicityTooHigh) == C_MULT);
static_assert(int(NurbsInputError::NonFiniteWeight) == C_NONFINITE_W);
static_assert(int(NurbsInputError::NonPositiveWeight) == C_NONPOS_W);
static_assert(int(NurbsInputError::NonFiniteControlPoint) == C_NONFINITE_CP);
static_assert(int(NurbsInputError::NonFiniteParameter) == C_NONFINITE_PARAM);
static_assert(int(NurbsInputError::DegenerateDenominator) == C_DENOM);
static_assert(int(NurbsInputError::NonFiniteResult) == C_NONFINITE_RESULT);
#endif

bool finite3(const Vec3& p) { return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z); }
bool allNaN(const Vec3& p) { return std::isnan(p.x) && std::isnan(p.y) && std::isnan(p.z); }
bool sameBits(double a, double b) { return std::memcmp(&a, &b, sizeof a) == 0; }
bool sameBits(const Vec3& a, const Vec3& b) { return sameBits(a.x, b.x) && sameBits(a.y, b.y) && sameBits(a.z, b.z); }

std::string fmt(const Vec3& p) {
    char b[160];
    std::snprintf(b, sizeof b, "(%.17g, %.17g, %.17g)", p.x, p.y, p.z);
    return b;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
NurbsCurve makeCurve(std::size_t p, std::vector<Vec3> cps, std::vector<double> w,
                     std::vector<double> k) {
    NurbsCurve c;
    c.degree = p; c.controlPoints = std::move(cps); c.weights = std::move(w); c.knots = std::move(k);
    return c;
}

// C0: valid rational cubic, 7 control points, clamped, interior knots.
NurbsCurve baseCurve() {
    std::vector<Vec3> cps;
    for (int i = 0; i < 7; ++i) cps.push_back(Vec3{double(i), std::sin(double(i)), 0.1 * i * i});
    return makeCurve(3, cps, {1.0, 0.8, 1.2, 1.0, 0.9, 1.1, 1.0},
                     {0, 0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 1});
}

// S0: valid rational surface, degU=2 (nU=4), degV=3 (nV=5), clamped.
NurbsSurface baseSurface() {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 3;
    s.knotsU = {0, 0, 0, 0.5, 1, 1, 1};
    s.knotsV = {0, 0, 0, 0, 0.5, 1, 1, 1, 1};
    s.control.assign(4, std::vector<Vec3>(5));
    s.weights.assign(4, std::vector<double>(5, 1.0));
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 5; ++j) {
            s.control[i][j] = Vec3{double(i), double(j), 0.25 * std::cos(i + 0.5 * j)};
            s.weights[i][j] = 0.8 + 0.1 * ((i + 2 * j) % 4);
        }
    return s;
}

// Independent span choice for the reference evaluation: the largest s in
// [p, n] with knots[s] <= u (the right-continuous convention; it is never an
// empty span inside the domain), or at/after the domain end the last span with
// knots[s] < knots[n+1] (the left limit). Linear scan — shares no code with
// findSpan().
std::size_t refSpan(std::size_t n, std::size_t p, double u, const std::vector<double>& k) {
    if (u >= k[n + 1]) {
        std::size_t s = n;
        while (s > p && !(k[s] < k[n + 1])) --s;
        return s;
    }
    std::size_t s = p;
    for (std::size_t i = p; i <= n; ++i)
        if (k[i] <= u) s = i;
    return s;
}

// Reference rational curve point via basisFunctions() and the same homogeneous
// accumulation order as the evaluator — so on accepted input it must agree
// BIT FOR BIT; disagreement means the evaluator chose a different span.
Vec3 refCurvePoint(const NurbsCurve& c, double u) {
    const std::size_t n = c.controlPoints.size() - 1;
    const std::size_t s = refSpan(n, c.degree, u, c.knots);
    const std::vector<double> N = basisFunctions(s, u, c.degree, c.knots);
    double x = 0, y = 0, z = 0, w = 0;
    for (std::size_t i = 0; i <= c.degree; ++i) {
        const std::size_t idx = s - c.degree + i;
        const double wb = c.weights[idx] * N[i];
        x += c.controlPoints[idx].x * wb; y += c.controlPoints[idx].y * wb;
        z += c.controlPoints[idx].z * wb; w += wb;
    }
    return Vec3{x / w, y / w, z / w};
}

Vec3 refSurfacePoint(const NurbsSurface& sf, double u, double v) {
    const std::size_t nU = sf.control.size(), nV = sf.control[0].size();
    const std::size_t su = refSpan(nU - 1, sf.degreeU, u, sf.knotsU);
    const std::size_t sv = refSpan(nV - 1, sf.degreeV, v, sf.knotsV);
    const std::vector<double> Nu = basisFunctions(su, u, sf.degreeU, sf.knotsU);
    const std::vector<double> Nv = basisFunctions(sv, v, sf.degreeV, sf.knotsV);
    double x = 0, y = 0, z = 0, w = 0;
    for (std::size_t a = 0; a <= sf.degreeU; ++a) {
        const std::size_t iu = su - sf.degreeU + a;
        for (std::size_t b = 0; b <= sf.degreeV; ++b) {
            const std::size_t iv = sv - sf.degreeV + b;
            const double wb = sf.weights[iu][iv] * (Nu[a] * Nv[b]);
            x += sf.control[iu][iv].x * wb; y += sf.control[iu][iv].y * wb;
            z += sf.control[iu][iv].z * wb; w += wb;
        }
    }
    return Vec3{x / w, y / w, z / w};
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
enum Kind { CURVE, SURF, BEZC, BEZS };
enum Expect { REFUSE, FINITE_REF };

struct Case {
    std::string name;
    std::string family;
    Kind kind = CURVE;
    bool expectValid = false;          // what valid() must return (n/a for Bezier)
    int validateCode = C_NONE;         // typed: expected validate()
    std::vector<double> params;        // u... (curve/BEZC) or u,v pairs (SURF/BEZS)
    Expect expect = REFUSE;
    int evalCode = C_NONE;             // typed: expected evaluateChecked() code when REFUSE
    double refTol = 0.0;               // FINITE_REF: 0 => bit-identical
    NurbsCurve c;
    NurbsSurface s;
    std::vector<Vec3> bcp; std::vector<double> bw;
    std::vector<std::vector<Vec3>> bsc; std::vector<std::vector<double>> bsw;
    std::function<Vec3(double, double)> ref;   // FINITE_REF expected point
};

Case curveCase(std::string name, std::string fam, NurbsCurve c, bool expectValid, int vcode,
               std::vector<double> us, Expect e, int ecode) {
    Case k; k.name = std::move(name); k.family = std::move(fam); k.kind = CURVE; k.c = std::move(c);
    k.expectValid = expectValid; k.validateCode = vcode; k.params = std::move(us); k.expect = e; k.evalCode = ecode;
    return k;
}
Case surfCase(std::string name, std::string fam, NurbsSurface s, bool expectValid, int vcode,
              std::vector<double> uvs, Expect e, int ecode) {
    Case k; k.name = std::move(name); k.family = std::move(fam); k.kind = SURF; k.s = std::move(s);
    k.expectValid = expectValid; k.validateCode = vcode; k.params = std::move(uvs); k.expect = e; k.evalCode = ecode;
    return k;
}

std::vector<Case> buildCases() {
    std::vector<Case> cs;
    const NurbsCurve C0 = baseCurve();
    const NurbsSurface S0 = baseSurface();

    // ---------------- weights ----------------
    {   // A1's case: every weight 0 -> the accumulated denominator is exactly 0.
        NurbsCurve c = C0; for (double& w : c.weights) w = 0.0;
        cs.push_back(curveCase("curve_zero_weight_all", "weights", c, false, C_NONPOS_W, {0.1, 0.5, 0.9}, REFUSE, C_NONPOS_W));
    }
    {   NurbsCurve c = C0; c.weights[3] = 0.0;   // denominator stays > 0: a silent wrong point pre-T-153
        cs.push_back(curveCase("curve_zero_weight_single", "weights", c, false, C_NONPOS_W, {0.1, 0.5}, REFUSE, C_NONPOS_W));
    }
    {   NurbsCurve c = C0; c.weights[3] = -0.5;
        cs.push_back(curveCase("curve_negative_weight", "weights", c, false, C_NONPOS_W, {0.1, 0.5}, REFUSE, C_NONPOS_W));
    }
    {   NurbsCurve c = C0; c.weights[3] = kNaN;
        cs.push_back(curveCase("curve_nan_weight", "weights", c, false, C_NONFINITE_W, {0.1, 0.5}, REFUSE, C_NONFINITE_W));
    }
    {   NurbsCurve c = C0; c.weights[3] = kInf;
        cs.push_back(curveCase("curve_inf_weight", "weights", c, false, C_NONFINITE_W, {0.1, 0.5}, REFUSE, C_NONFINITE_W));
    }
    {   NurbsSurface s = S0; for (auto& r : s.weights) for (double& w : r) w = 0.0;
        cs.push_back(surfCase("surf_zero_weight_grid", "weights", s, false, C_NONPOS_W, {0.3, 0.6}, REFUSE, C_NONPOS_W));
    }
    {   NurbsSurface s = S0; s.weights[1][2] = -1.0;
        cs.push_back(surfCase("surf_negative_weight", "weights", s, false, C_NONPOS_W, {0.3, 0.45}, REFUSE, C_NONPOS_W));
    }
    {   NurbsSurface s = S0; s.weights[1][2] = kNaN;
        cs.push_back(surfCase("surf_nan_weight", "weights", s, false, C_NONFINITE_W, {0.3, 0.45}, REFUSE, C_NONFINITE_W));
    }
    {   NurbsSurface s = S0; s.weights[1][2] = -kInf;
        cs.push_back(surfCase("surf_neg_inf_weight", "weights", s, false, C_NONFINITE_W, {0.3, 0.45}, REFUSE, C_NONFINITE_W));
    }

    // ---------------- knots ----------------
    {   NurbsCurve c = C0; c.knots[5] = 0.8;     // .25, .8, .75 — decreasing inside the basis window of u=0.6
        cs.push_back(curveCase("curve_decreasing_knots", "knots", c, false, C_DECREASING, {0.6}, REFUSE, C_DECREASING));
    }
    {   NurbsCurve c = C0; c.knots[5] = kNaN;
        cs.push_back(curveCase("curve_nan_knot", "knots", c, false, C_NONFINITE_KNOT, {0.6}, REFUSE, C_NONFINITE_KNOT));
    }
    {   // The LAST knot of a clamped vector is never read by any evaluation (the
        // basis window ends at U_{n+p}). validate() must still refuse it; the
        // evaluator — which validates what it reads, not the whole object — must
        // return exactly C0's point. This pins the documented contract split.
        NurbsCurve c = C0; c.knots.back() = kInf;
        Case k = curveCase("curve_inf_last_knot_unread", "knots", c, false, C_NONFINITE_KNOT, {0.0, 0.5, 1.0}, FINITE_REF, C_NONE);
        k.ref = [C0](double u, double) { return refCurvePoint(C0, u); };
        cs.push_back(k);
    }
    {   NurbsCurve c = C0; c.knots[7] = kInf;      // U_{n+1}: the domain end itself
        cs.push_back(curveCase("curve_inf_domain_end_knot", "knots", c, false, C_NONFINITE_KNOT, {0.5}, REFUSE, C_NONFINITE_KNOT));
    }
    {   NurbsSurface s = S0; s.knotsU[3] = 1.5;  // 0,0,0,1.5,1 — decreasing inside the window of u=0.3
        cs.push_back(surfCase("surf_decreasing_knots_u", "knots", s, false, C_DECREASING, {0.3, 0.5}, REFUSE, C_DECREASING));
    }

    // ---------------- degree vs control points ----------------
    {   NurbsCurve c = makeCurve(3, {Vec3{0, 0, 0}, Vec3{1, 1, 0}}, {1, 1}, {0, 0, 0, 1, 1, 1});
        cs.push_back(curveCase("curve_degree_exceeds_points", "degree", c, false, C_FEW_CP, {0.0, 0.5, 1.0}, REFUSE, C_FEW_CP));
    }
    {   NurbsCurve c = C0; c.degree = 0; c.knots.pop_back(); c.knots.pop_back(); c.knots.pop_back();
        cs.push_back(curveCase("curve_degree_zero", "degree", c, false, C_DEG0, {0.5}, REFUSE, C_DEG0));
    }
    {   NurbsCurve c = C0; c.knots.pop_back();
        cs.push_back(curveCase("curve_knot_count_mismatch", "degree", c, false, C_KCOUNT, {0.5}, REFUSE, C_KCOUNT));
    }
    {   NurbsSurface s = S0; s.degreeV = 3;      // nV = 3 < degreeV + 1
        for (auto& r : s.control) r.resize(3);
        for (auto& r : s.weights) r.resize(3);
        s.knotsV = {0, 0, 0, 0.5, 1, 1, 1};      // = nV + degreeV + 1: the COUNT is right
        cs.push_back(surfCase("surf_degree_exceeds_points_v", "degree", s, false, C_FEW_CP, {0.3, 0.5}, REFUSE, C_FEW_CP));
    }
    {   NurbsSurface s = S0; s.knotsV.pop_back();
        cs.push_back(surfCase("surf_knot_count_mismatch_v", "degree", s, false, C_KCOUNT, {0.3, 0.5}, REFUSE, C_KCOUNT));
    }

    // ---------------- empty spans / empty domain ----------------
    {   // MEASURED corpus pattern #1 (e.g. mmcad_b_raw 1258.step #5912): degree 3,
        // 4 control points, every knot 0 — the domain [U3, U4] has zero length.
        NurbsCurve c = makeCurve(3, {Vec3{1, 2, 3}, Vec3{1, 2, 3}, Vec3{1, 2, 3}, Vec3{1, 2, 3}},
                                 {1, 1, 1, 1}, {0, 0, 0, 0, 0, 0, 0, 0});
        cs.push_back(curveCase("curve_empty_domain_all_knots_equal", "empty-span", c, false, C_EMPTY_DOMAIN, {0.0}, REFUSE, C_EMPTY_DOMAIN));
    }
    {   NurbsSurface s = S0; s.knotsU = {0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5};
        cs.push_back(surfCase("surf_empty_domain_u", "empty-span", s, false, C_EMPTY_DOMAIN, {0.5, 0.5}, REFUSE, C_EMPTY_DOMAIN));
    }
    {   // MEASURED corpus pattern #2: degree 3, the FIRST knot repeated 7 times
        // (> degree+1). The spans U3..U6 are empty; the NURBS-book FindSpan put
        // u = U0 on span 3, where every basis function is 0 -> the T-153 division.
        // validate() refuses it (ISO 10303-42 forbids the run). The evaluator, if
        // asked anyway, must not divide by zero: the curve on its non-empty span
        // is EXACTLY the curve without its three dead control points, so the
        // answer is checked bit-for-bit against that trimmed curve.
        NurbsCurve c = makeCurve(3, {}, {}, {0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1});
        for (int i = 0; i < 7; ++i) { c.controlPoints.push_back(Vec3{double(i), double(i * i), 1.0}); c.weights.push_back(0.9 + 0.02 * i); }
        NurbsCurve t = makeCurve(3, {c.controlPoints.begin() + 3, c.controlPoints.end()},
                                 {c.weights.begin() + 3, c.weights.end()}, {0, 0, 0, 0, 1, 1, 1, 1});
        Case k = curveCase("curve_start_knot_run_exceeds_order", "empty-span", c, false, C_MULT, {0.0, 0.5, 1.0}, FINITE_REF, C_NONE);
        k.ref = [t](double u, double) { return refCurvePoint(t, u); };
        cs.push_back(k);
    }
    {   // Mirror at the END: degree 2, last knot repeated 5 times (> 3).
        NurbsCurve c = makeCurve(2, {}, {}, {0, 0, 0, 1, 1, 1, 1, 1});
        for (int i = 0; i < 5; ++i) { c.controlPoints.push_back(Vec3{double(i), 1.0 - i, 0.5 * i}); c.weights.push_back(1.0 + 0.1 * i); }
        NurbsCurve t = makeCurve(2, {c.controlPoints.begin(), c.controlPoints.begin() + 3},
                                 {c.weights.begin(), c.weights.begin() + 3}, {0, 0, 0, 1, 1, 1});
        Case k = curveCase("curve_end_knot_run_exceeds_order", "empty-span", c, false, C_MULT, {0.0, 0.5, 1.0}, FINITE_REF, C_NONE);
        k.ref = [t](double u, double) { return refCurvePoint(t, u); };
        cs.push_back(k);
    }
    {   // Surface form of pattern #2 (MEASURED: a degreeV=3 surface whose V knots
        // start 0 x7), checked against the surface without its three dead V columns.
        NurbsSurface s = S0;
        s.knotsV = {0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1};
        for (std::size_t i = 0; i < s.control.size(); ++i) {
            s.control[i].clear(); s.weights[i].clear();
            for (int j = 0; j < 7; ++j) { s.control[i].push_back(Vec3{double(i), double(j), 0.1 * double(i * j)}); s.weights[i].push_back(0.85 + 0.05 * ((i + j) % 3)); }
        }
        NurbsSurface t = s;
        t.knotsV = {0, 0, 0, 0, 1, 1, 1, 1};
        for (std::size_t i = 0; i < t.control.size(); ++i) {
            t.control[i].erase(t.control[i].begin(), t.control[i].begin() + 3);
            t.weights[i].erase(t.weights[i].begin(), t.weights[i].begin() + 3);
        }
        Case k = surfCase("surf_start_knot_run_exceeds_order_v", "empty-span", s, false, C_MULT, {0.3, 0.0, 0.7, 0.5, 1.0, 1.0}, FINITE_REF, C_NONE);
        k.ref = [t](double u, double v) { return refSurfacePoint(t, u, v); };
        cs.push_back(k);
    }
    {   // VALID unclamped vector whose domain START knot is repeated: U2 == U3 == 2,
        // so span 2 is empty. Pre-T-153 FindSpan returned it for u = 2 -> 0/0.
        NurbsCurve c = makeCurve(2, {Vec3{0, 0, 0}, Vec3{1, 2, 0}, Vec3{3, 2, 1}, Vec3{4, 0, 1}},
                                 {1.0, 0.7, 1.3, 1.0}, {0, 1, 2, 2, 3, 4, 5});
        Case k = curveCase("curve_unclamped_repeated_domain_start", "empty-span", c, true, C_NONE, {2.0, 2.5, 3.0}, FINITE_REF, C_NONE);
        k.ref = [c](double u, double) { return refCurvePoint(c, u); };
        cs.push_back(k);
    }
    {   // VALID unclamped vector whose domain END knot is repeated: U3 == U4 == 3.
        NurbsCurve c = makeCurve(2, {Vec3{0, 0, 0}, Vec3{1, 2, 0}, Vec3{3, 2, 1}, Vec3{4, 0, 1}},
                                 {1.0, 0.7, 1.3, 1.0}, {0, 1, 2, 3, 3, 4, 5});
        Case k = curveCase("curve_unclamped_repeated_domain_end", "empty-span", c, true, C_NONE, {2.0, 2.5, 3.0}, FINITE_REF, C_NONE);
        k.ref = [c](double u, double) { return refCurvePoint(c, u); };
        cs.push_back(k);
    }

    // ---------------- shape ----------------
    {   NurbsCurve c;  // nothing at all
        cs.push_back(curveCase("curve_empty_control_net", "shape", c, false, C_EMPTY_NET, {0.5}, REFUSE, C_EMPTY_NET));
    }
    {   NurbsCurve c = C0; c.weights.pop_back();
        cs.push_back(curveCase("curve_weight_count_mismatch", "shape", c, false, C_WSHAPE, {0.95}, REFUSE, C_WSHAPE));
    }
    {   NurbsSurface s; s.degreeU = 2; s.degreeV = 2;
        cs.push_back(surfCase("surf_empty_control_net", "shape", s, false, C_EMPTY_NET, {0.5, 0.5}, REFUSE, C_EMPTY_NET));
    }
    {   NurbsSurface s = S0; s.control[1].pop_back(); s.weights[1].pop_back();
        cs.push_back(surfCase("surf_ragged_row", "shape", s, false, C_RAGGED, {0.1, 0.95}, REFUSE, C_RAGGED));
    }
    {   NurbsSurface s = S0; s.weights.pop_back();
        cs.push_back(surfCase("surf_weights_missing_row", "shape", s, false, C_WSHAPE, {0.9, 0.5}, REFUSE, C_WSHAPE));
    }

    // ---------------- non-finite values / parameters ----------------
    {   NurbsCurve c = C0; c.controlPoints[3].y = kNaN;
        cs.push_back(curveCase("curve_nan_control_point", "values", c, false, C_NONFINITE_CP, {0.5}, REFUSE, C_NONFINITE_CP));
    }
    {   NurbsCurve c = C0; c.controlPoints[3].x = kInf;
        cs.push_back(curveCase("curve_inf_control_point", "values", c, false, C_NONFINITE_CP, {0.5}, REFUSE, C_NONFINITE_CP));
    }
    cs.push_back(curveCase("curve_nan_parameter", "param", C0, true, C_NONE, {kNaN}, REFUSE, C_NONFINITE_PARAM));
    cs.push_back(curveCase("curve_inf_parameter", "param", C0, true, C_NONE, {kInf, -kInf}, REFUSE, C_NONFINITE_PARAM));
    cs.push_back(surfCase("surf_nan_parameter", "param", S0, true, C_NONE, {kNaN, 0.5, 0.5, kInf}, REFUSE, C_NONFINITE_PARAM));
    {   NurbsSurface s = S0; s.control[2][2].z = kInf;
        cs.push_back(surfCase("surf_inf_control_point", "values", s, false, C_NONFINITE_CP, {0.6, 0.5}, REFUSE, C_NONFINITE_CP));
    }

    // ---------------- the denominator itself ----------------
    {   // VALID rational line, weights 1 and 3: w(u) = 1 + 2u, which is EXACTLY 0
        // at u = -0.5 and negative beyond. Extrapolating there divided by 0 (and
        // by a negative w) pre-T-153. This is the case that proves the
        // denominator check itself — the weights are all positive.
        NurbsCurve c = makeCurve(1, {Vec3{0, 0, 0}, Vec3{3, 1, 0}}, {1.0, 3.0}, {0, 0, 1, 1});
        cs.push_back(curveCase("curve_extrapolated_zero_denominator", "denominator", c, true, C_NONE, {-0.5}, REFUSE, C_DENOM));
        // ...and past the pole (w = -1 at u = -1) the old evaluator returned the
        // rational function's value (9, 3, 0). That is not malformed input, so
        // the answer is KEPT, bit for bit — the refusal is the old assert's
        // w == 0, not a new, wider rule.
        Case k = curveCase("curve_extrapolated_past_pole_unchanged", "denominator", c, true, C_NONE, {-1.0}, FINITE_REF, C_NONE);
        k.ref = [c](double u, double) { return refCurvePoint(c, u); };
        cs.push_back(k);
    }
    {   // VALID input whose homogeneous sum overflows: finite in, inf out.
        NurbsCurve c = makeCurve(1, {Vec3{1e308, 0, 0}, Vec3{1e308, 0, 0}}, {10.0, 10.0}, {0, 0, 1, 1});
        cs.push_back(curveCase("curve_overflow_result", "denominator", c, true, C_NONE, {0.5}, REFUSE, C_NONFINITE_RESULT));
    }

    // ---------------- Bezier (direct de Casteljau) ----------------
    auto bezC = [&](std::string name, std::string fam, std::vector<Vec3> cp, std::vector<double> w,
                    std::vector<double> ts, int code) {
        Case k; k.name = std::move(name); k.family = std::move(fam); k.kind = BEZC; k.bcp = std::move(cp); k.bw = std::move(w);
        k.params = std::move(ts); k.expect = REFUSE; k.evalCode = code; cs.push_back(k);
    };
    const std::vector<Vec3> B0 = {Vec3{0, 0, 0}, Vec3{1, 2, 0}, Vec3{3, 2, 1}, Vec3{4, 0, 1}};
    bezC("bezier_curve_empty", "shape", {}, {}, {0.5}, C_EMPTY_NET);
    bezC("bezier_curve_short_weights", "shape", B0, {1, 1, 1}, {0.5}, C_WSHAPE);
    bezC("bezier_curve_zero_weights", "weights", B0, {0, 0, 0, 0}, {0.5}, C_NONPOS_W);
    bezC("bezier_curve_negative_weight", "weights", B0, {1, -2, 1, 1}, {0.5}, C_NONPOS_W);
    bezC("bezier_curve_nan_weight", "weights", B0, {1, kNaN, 1, 1}, {0.5}, C_NONFINITE_W);
    bezC("bezier_curve_nan_parameter", "param", B0, {1, 1, 1, 1}, {kNaN}, C_NONFINITE_PARAM);
    bezC("bezier_curve_inf_control_point", "values", {B0[0], Vec3{kInf, 0, 0}, B0[2], B0[3]}, {1, 1, 1, 1}, {0.5}, C_NONFINITE_CP);
    auto bezS = [&](std::string name, std::string fam, std::vector<std::vector<Vec3>> cp,
                    std::vector<std::vector<double>> w, int code) {
        Case k; k.name = std::move(name); k.family = std::move(fam); k.kind = BEZS; k.bsc = std::move(cp); k.bsw = std::move(w);
        k.params = {0.5, 0.5}; k.expect = REFUSE; k.evalCode = code; cs.push_back(k);
    };
    const std::vector<std::vector<Vec3>> G0 = {{Vec3{0, 0, 0}, Vec3{0, 1, 1}, Vec3{0, 2, 0}},
                                               {Vec3{1, 0, 1}, Vec3{1, 1, 2}, Vec3{1, 2, 1}},
                                               {Vec3{2, 0, 0}, Vec3{2, 1, 1}, Vec3{2, 2, 0}}};
    const std::vector<std::vector<double>> W1 = {{1, 1, 1}, {1, 1, 1}, {1, 1, 1}};
    bezS("bezier_surface_empty", "shape", {}, {}, C_EMPTY_NET);
    bezS("bezier_surface_weights_missing_row", "shape", G0, {{1, 1, 1}, {1, 1, 1}}, C_WSHAPE);
    bezS("bezier_surface_ragged", "shape", {G0[0], {G0[1][0], G0[1][1]}, G0[2]}, {{1, 1, 1}, {1, 1}, {1, 1, 1}}, C_RAGGED);
    bezS("bezier_surface_zero_weights", "weights", G0, {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, C_NONPOS_W);
    bezS("bezier_surface_negative_weight", "weights", G0, {{1, 1, 1}, {1, -1, 1}, {1, 1, 1}}, C_NONPOS_W);

    // ---------------- VALID controls: must be accepted and exact ----------------
    {   // Quarter circle: the analytic truth, |C(u)| == 1.
        const double s2 = std::sqrt(2.0) / 2.0;
        NurbsCurve c = makeCurve(2, {Vec3{1, 0, 0}, Vec3{1, 1, 0}, Vec3{0, 1, 0}}, {1.0, s2, 1.0}, {0, 0, 0, 1, 1, 1});
        Case k = curveCase("valid_quarter_circle", "control", c, true, C_NONE, {0.0, 0.25, 0.5, 0.75, 1.0}, FINITE_REF, C_NONE);
        k.refTol = 1e-14;
        k.ref = [](double u, double) {   // the arc point at the same rational parameter, from the closed form
            const double s = std::sqrt(2.0) / 2.0;
            const double b0 = (1 - u) * (1 - u), b1 = 2 * u * (1 - u) * s, b2 = u * u;
            const double w = b0 + b1 + b2;
            return Vec3{(b0 + b1) / w, (b1 + b2) / w, 0.0};
        };
        cs.push_back(k);
    }
    {   Case k = curveCase("valid_rational_cubic", "control", C0, true, C_NONE,
                           {0.0, 0.1, 0.25, 0.3, 0.5, 0.6, 0.75, 0.9, 1.0}, FINITE_REF, C_NONE);
        k.ref = [C0](double u, double) { return refCurvePoint(C0, u); };
        cs.push_back(k);
    }
    {   NurbsCurve c = makeCurve(3, {}, {}, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10});
        for (int i = 0; i < 7; ++i) { c.controlPoints.push_back(Vec3{double(i), std::cos(double(i)), 0.0}); c.weights.push_back(1.0 + 0.05 * i); }
        Case k = curveCase("valid_unclamped_uniform_cubic", "control", c, true, C_NONE, {3.0, 4.5, 5.0, 7.0}, FINITE_REF, C_NONE);
        k.ref = [c](double u, double) { return refCurvePoint(c, u); };
        cs.push_back(k);
    }
    {   // Interior multiplicity == degree+1 (a C^-1 join) is allowed.
        NurbsCurve c = makeCurve(2, {}, {}, {0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1});
        for (int i = 0; i < 6; ++i) { c.controlPoints.push_back(Vec3{double(i), double(i % 2), 0.0}); c.weights.push_back(1.0); }
        Case k = curveCase("valid_interior_multiplicity_order", "control", c, true, C_NONE, {0.25, 0.5, 0.75, 1.0}, FINITE_REF, C_NONE);
        k.ref = [c](double u, double) { return refCurvePoint(c, u); };
        cs.push_back(k);
    }
    {   Case k = surfCase("valid_rational_surface", "control", S0, true, C_NONE,
                          {0.0, 0.0, 0.3, 0.6, 0.5, 0.5, 0.99, 0.01, 1.0, 1.0}, FINITE_REF, C_NONE);
        k.ref = [S0](double u, double v) { return refSurfacePoint(S0, u, v); };
        cs.push_back(k);
    }
    return cs;
}

// ---------------------------------------------------------------------------
// One case, executed in a child process. Returns the failure messages.
// ---------------------------------------------------------------------------
struct Eval { Vec3 raw; bool typedOk = false; int typedCode = 0; std::string reason; Vec3 typedValue; };

Eval evaluateBoth(const Case& k, double u, double v) {
    Eval e;
    switch (k.kind) {
    case CURVE: e.raw = k.c.evaluate(u); break;
    case SURF:  e.raw = k.s.evaluate(u, v); break;
    case BEZC:  e.raw = bezierCurvePoint(k.bcp, k.bw, u); break;
    case BEZS:  e.raw = bezierSurfacePoint(k.bsc, k.bsw, u, v); break;
    }
#ifdef FORGE_NURBS_INPUT_VALIDATION
    PointEval r;
    switch (k.kind) {
    case CURVE: r = k.c.evaluateChecked(u); break;
    case SURF:  r = k.s.evaluateChecked(u, v); break;
    case BEZC:  r = bezierCurvePointChecked(k.bcp, k.bw, u); break;
    case BEZS:  r = bezierSurfacePointChecked(k.bsc, k.bsw, u, v); break;
    }
    e.typedOk = r.ok; e.typedCode = int(r.code); e.reason = r.reason ? r.reason : "(null)"; e.typedValue = r.value;
#endif
    return e;
}

std::vector<std::string> runCase(const Case& k) {
    std::vector<std::string> fail;
    auto bad = [&](const std::string& m) { fail.push_back(m); };
    char buf[512];

    // B1 (old API): valid() is the importers' gate.
    if (k.kind == CURVE || k.kind == SURF) {
        const bool v = (k.kind == CURVE) ? k.c.valid() : k.s.valid();
        if (v != k.expectValid) {
            std::snprintf(buf, sizeof buf, "valid() returned %s, expected %s", v ? "true" : "false", k.expectValid ? "true" : "false");
            bad(buf);
        }
    }
#ifdef FORGE_NURBS_INPUT_VALIDATION
    // T1: validate() names the defect.
    if (k.kind == CURVE || k.kind == SURF) {
        const NurbsInputError got = (k.kind == CURVE) ? k.c.validate() : k.s.validate();
        if (int(got) != k.validateCode) {
            std::snprintf(buf, sizeof buf, "validate() = %s (%d), expected code %d", nurbsInputErrorName(got), int(got), k.validateCode);
            bad(buf);
        }
    }
    const std::uint64_t before = nurbsEvaluationRefusals();
#endif
    const bool pairs = (k.kind == SURF || k.kind == BEZS);
    [[maybe_unused]] std::size_t evals = 0;
    for (std::size_t i = 0; i < k.params.size(); i += pairs ? 2 : 1) {
        const double u = k.params[i], v = pairs ? k.params[i + 1] : 0.0;
        const Eval e = evaluateBoth(k, u, v);
        ++evals;
        char at[96];
        if (pairs) std::snprintf(at, sizeof at, "(u,v)=(%g,%g)", u, v); else std::snprintf(at, sizeof at, "u=%g", u);
        if (k.expect == REFUSE) {
            // B2 (old API): the raw form must not hand back a coordinate.
            if (!allNaN(e.raw)) {
                std::snprintf(buf, sizeof buf, "%s: raw evaluate returned %s — expected the refusal point (NaN,NaN,NaN)%s",
                              at, fmt(e.raw).c_str(), finite3(e.raw) ? " — a FABRICATED finite point" : " — a non-finite (inf) coordinate");
                bad(buf);
            }
            if (!kTyped) { bad(std::string(at) + ": typed API absent (no FORGE_NURBS_INPUT_VALIDATION): no refusal can be named"); continue; }
            if (e.typedOk) {
                std::snprintf(buf, sizeof buf, "%s: evaluateChecked returned ok=true with value %s — %s", at, fmt(e.typedValue).c_str(),
                              finite3(e.typedValue) ? "accepted malformed input" : "the guard did not fire: NaN/inf passed as a point");
                bad(buf);
            } else {
                if (e.typedCode != k.evalCode) {
                    std::snprintf(buf, sizeof buf, "%s: refusal code %d (%s), expected %d", at, e.typedCode, e.reason.c_str(), k.evalCode);
                    bad(buf);
                }
                if (e.reason.empty()) bad(std::string(at) + ": refusal with an EMPTY reason");
                if (!allNaN(e.typedValue)) bad(std::string(at) + ": refusal value is not the NaN refusal point: " + fmt(e.typedValue));
            }
        } else {   // FINITE_REF
            const Vec3 want = k.ref(u, v);
            const bool okRaw = finite3(e.raw) &&
                (k.refTol == 0.0 ? sameBits(e.raw, want)
                                 : (std::fabs(e.raw.x - want.x) <= k.refTol && std::fabs(e.raw.y - want.y) <= k.refTol &&
                                    std::fabs(e.raw.z - want.z) <= k.refTol));
            if (!okRaw) {
                std::snprintf(buf, sizeof buf, "%s: raw evaluate = %s, expected %s%s", at, fmt(e.raw).c_str(), fmt(want).c_str(),
                              k.refTol == 0.0 ? " (bit-identical)" : "");
                bad(buf);
            }
            if (kTyped && (!e.typedOk || !sameBits(e.typedValue, e.raw))) {
                std::snprintf(buf, sizeof buf, "%s: evaluateChecked ok=%d code=%d value=%s disagrees with the raw form",
                              at, int(e.typedOk), e.typedCode, fmt(e.typedValue).c_str());
                bad(buf);
            }
        }
    }
#ifdef FORGE_NURBS_INPUT_VALIDATION
    // T3: every refusal is counted (raw + checked = 2 per evaluation point);
    // an accepted evaluation is never counted.
    const std::uint64_t delta = nurbsEvaluationRefusals() - before;
    const std::uint64_t want = (k.expect == REFUSE) ? 2 * evals : 0;
    if (delta != want) {
        std::snprintf(buf, sizeof buf, "refusal counter moved by %" PRIu64 ", expected %" PRIu64, delta, want);
        bad(buf);
    }
#endif
    return fail;
}

int runBattery(const char* only) {
    const std::vector<Case> cases = buildCases();
    int pass = 0, failN = 0, crash = 0, ran = 0;
    std::printf("[t153-gate] build: %s, typed API %s, %zu cases\n",
#ifdef NDEBUG
                "NDEBUG (asserts compiled OUT — the shipped configuration)",
#else
                "asserts LIVE",
#endif
                kTyped ? "present" : "ABSENT", cases.size());
    std::fflush(stdout);
    for (const Case& k : cases) {
        if (only && k.name.find(only) == std::string::npos) continue;
        ++ran;
        const pid_t pid = fork();
        if (pid == 0) {
            alarm(20);
            const std::vector<std::string> f = runCase(k);
            if (f.empty()) std::printf("[PASS] %-44s %s\n", k.name.c_str(), k.family.c_str());
            for (const std::string& m : f) std::printf("[FAIL] %-44s %s\n", k.name.c_str(), m.c_str());
            std::fflush(stdout);
            _exit(f.empty() ? 0 : 1);
        }
        int st = 0;
        waitpid(pid, &st, 0);
        if (WIFEXITED(st) && WEXITSTATUS(st) == 0) ++pass;
        else if (WIFEXITED(st)) ++failN;
        else {
            ++crash;
            const int sig = WIFSIGNALED(st) ? WTERMSIG(st) : -1;
            std::printf("[CRASH] %-43s %s (signal %d%s)\n", k.name.c_str(), k.family.c_str(), sig,
                        sig == SIGALRM ? ": HANG, killed after 20 s" : sig == SIGABRT ? ": abort — an assert() fired" : "");
            std::fflush(stdout);
        }
    }
    std::printf("SUMMARY cases=%d pass=%d fail=%d crash=%d\n", ran, pass, failN, crash);
    return (ran > 0 && pass == ran) ? 0 : 1;
}

// ---------------------------------------------------------------------------
// --dump-valid: raw evaluation over VALID input only (old API), as exact hex,
// so a pre- and post-T-153 build can be diffed bit for bit.
// ---------------------------------------------------------------------------
struct Lcg { std::uint64_t s; double next() { s = s * 6364136223846793005ULL + 1442695040888963407ULL; return double(s >> 11) * (1.0 / 9007199254740992.0); } };

void hexOut(std::FILE* f, const Vec3& p, std::uint64_t& n) {
    std::fprintf(f, "%a %a %a\n", p.x, p.y, p.z); n += 3;
}

NurbsCurve randomCurve(Lcg& g, std::size_t p, std::size_t ncp, bool clamped) {
    NurbsCurve c; c.degree = p;
    for (std::size_t i = 0; i < ncp; ++i) {
        c.controlPoints.push_back(Vec3{10 * g.next() - 5, 10 * g.next() - 5, 10 * g.next() - 5});
        c.weights.push_back(0.2 + 2 * g.next());
    }
    const std::size_t m = ncp + p + 1;
    if (clamped) {
        const std::size_t interior = m - 2 * (p + 1);
        for (std::size_t i = 0; i <= p; ++i) c.knots.push_back(0.0);
        double t = 0;
        for (std::size_t i = 0; i < interior; ++i) { t += 0.1 + g.next(); c.knots.push_back(t); }
        const double end = t + 0.1 + g.next();
        for (std::size_t i = 0; i <= p; ++i) c.knots.push_back(end);
    } else {
        double t = 0;
        for (std::size_t i = 0; i < m; ++i) { c.knots.push_back(t); t += 0.1 + g.next(); }
    }
    return c;
}

int dumpValid(const char* path) {
    std::FILE* f = path ? std::fopen(path, "w") : stdout;
    if (!f) return 2;
    std::uint64_t n = 0;
    Lcg g{0x7153};
    for (int rep = 0; rep < 400; ++rep) {
        const std::size_t p = 1 + rep % 4, ncp = p + 1 + (rep * 7) % 9;
        const NurbsCurve c = randomCurve(g, p, ncp, rep % 3 != 0);
        const double a = c.knots[p], b = c.knots[ncp];
        for (int i = 0; i <= 40; ++i) hexOut(f, c.evaluate(a + (b - a) * i / 40.0), n);
        for (int i = 0; i <= 8; ++i) {   // findSpan + basis directly
            const double u = a + (b - a) * i / 8.0;
            const std::size_t s = findSpan(ncp - 1, p, u, c.knots);
            std::fprintf(f, "span %zu\n", s); ++n;
            for (double x : basisFunctions(s, u, p, c.knots)) { std::fprintf(f, "%a\n", x); ++n; }
        }
    }
    for (int rep = 0; rep < 60; ++rep) {
        const std::size_t pu = 1 + rep % 3, pv = 1 + (rep / 3) % 3;
        const std::size_t nu = pu + 1 + rep % 4, nv = pv + 1 + (rep * 5) % 5;
        const NurbsCurve cu = randomCurve(g, pu, nu, rep % 4 != 0), cv = randomCurve(g, pv, nv, rep % 5 != 0);
        NurbsSurface s; s.degreeU = pu; s.degreeV = pv; s.knotsU = cu.knots; s.knotsV = cv.knots;
        s.control.assign(nu, std::vector<Vec3>(nv)); s.weights.assign(nu, std::vector<double>(nv));
        for (std::size_t i = 0; i < nu; ++i)
            for (std::size_t j = 0; j < nv; ++j) {
                s.control[i][j] = Vec3{10 * g.next() - 5, 10 * g.next() - 5, 10 * g.next() - 5};
                s.weights[i][j] = 0.2 + 2 * g.next();
            }
        const double ua = s.knotsU[pu], ub = s.knotsU[nu], va = s.knotsV[pv], vb = s.knotsV[nv];
        for (int i = 0; i <= 12; ++i)
            for (int j = 0; j <= 12; ++j)
                hexOut(f, s.evaluate(ua + (ub - ua) * i / 12.0, va + (vb - va) * j / 12.0), n);
    }
    for (int rep = 0; rep < 100; ++rep) {   // Bezier, valid only
        const std::size_t m = 2 + rep % 6;
        std::vector<Vec3> cp; std::vector<double> w;
        for (std::size_t i = 0; i < m; ++i) { cp.push_back(Vec3{g.next(), g.next(), g.next()}); w.push_back(0.3 + g.next()); }
        std::vector<std::vector<Vec3>> sc(m, std::vector<Vec3>(m)); std::vector<std::vector<double>> sw(m, std::vector<double>(m));
        for (std::size_t i = 0; i < m; ++i) for (std::size_t j = 0; j < m; ++j) { sc[i][j] = Vec3{g.next(), g.next(), g.next()}; sw[i][j] = 0.3 + g.next(); }
        for (int i = 0; i <= 10; ++i) {
            hexOut(f, bezierCurvePoint(cp, w, i / 10.0), n);
            hexOut(f, bezierSurfacePoint(sc, sw, i / 10.0, 1.0 - i / 10.0), n);
        }
    }
    if (path) std::fclose(f);
    std::fprintf(stderr, "[t153-gate] dump-valid: %" PRIu64 " values\n", n);
    return 0;
}

// ---------------------------------------------------------------------------
// --bench: ns per raw evaluate() on valid input (old API).
// ---------------------------------------------------------------------------
int bench() {
    const NurbsCurve c = baseCurve();
    const NurbsSurface s = baseSurface();
    volatile double sink = 0;
    const int N = 2000000;
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) sink = sink + c.evaluate((i % 1000) / 999.0).x;
    auto t1 = std::chrono::steady_clock::now();
    for (int i = 0; i < N; ++i) sink = sink + s.evaluate((i % 997) / 996.0, (i % 991) / 990.0).y;
    auto t2 = std::chrono::steady_clock::now();
    const double nc = std::chrono::duration<double, std::nano>(t1 - t0).count() / N;
    const double ns = std::chrono::duration<double, std::nano>(t2 - t1).count() / N;
    std::printf("BENCH curve_ns_per_eval=%.2f surface_ns_per_eval=%.2f (sink %g)\n", nc, ns, double(sink));
    return 0;
}

#ifdef NURBS_GATE_READERS
// ---------------------------------------------------------------------------
// --readers: the IMPORT BOUNDARY, on synthetic files (portable — no corpus).
// A minimal STEP file (one bilinear B-spline face on [0,L]^2 bounded by four
// edges) and a minimal IGES file (a 144 over a 128 bilinear surface bounded by
// a 102 of four curves) are written in-memory; each variant corrupts ONE
// entity. A valid variant must import with nothing unsupported; a corrupt one
// must be refused under its NAMED key, with no evaluator ever asked to evaluate
// the corrupt entity (the refusal counter does not move) and no non-finite
// vertex in the result.
// ---------------------------------------------------------------------------
struct ReaderOutcome {
    bool ok = false, closed = false;
    std::size_t trimmed = 0, nonFinite = 0;
    std::uint64_t refusals = 0;
    bool counted = false;
    std::map<std::string, std::size_t> unsupported;
    std::string reason;
};

template <class Result>
ReaderOutcome summarise(const Result& r, std::uint64_t refusals, bool counted) {
    ReaderOutcome o;
    o.ok = r.ok; o.closed = r.closed; o.trimmed = r.trimmedFaces.size(); o.reason = r.reason;
    o.unsupported = r.unsupported; o.refusals = refusals; o.counted = counted;
    auto walk = [&](const Loop* L) {
        if (!L || !L->first) return;
        const Coedge* c = L->first;
        for (std::size_t i = 0; i < L->coedgeCount && c; ++i, c = c->next) {
            const Vertex* v = c->originVertex();
            if (v && !(std::isfinite(v->point.x) && std::isfinite(v->point.y) && std::isfinite(v->point.z))) ++o.nonFinite;
        }
    };
    for (const Shell* sh : r.shells)
        if (sh) for (const Face* fc : sh->faces)
            if (fc) { walk(fc->outerLoop); for (const Loop* L : fc->innerLoops) walk(L); }
    return o;
}

template <class Fn>
ReaderOutcome readCounted(Fn&& fn) {
#ifdef FORGE_NURBS_INPUT_VALIDATION
    const std::uint64_t before = nurbsEvaluationRefusals();
    const auto r = fn();
    return summarise(r, nurbsEvaluationRefusals() - before, true);
#else
    const auto r = fn();
    return summarise(r, 0, false);
#endif
}

// ---- STEP fixture ----------------------------------------------------------
// `surface`: the #10 record body after "#10="; `edgeCurve`: "" keeps #41 a LINE,
// otherwise the #85 record body used as #41's curve.
std::string stepFixture(const std::string& surface, const std::string& edgeCurve) {
    const double L = 10.0;
    char b[256];
    std::string s = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('t153'),'2;1');\n"
                    "FILE_NAME('t153','2026-10-08T00:00:00',(''),(''),'t153','t153','');\n"
                    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
    std::snprintf(b, sizeof b, "#1=CARTESIAN_POINT('',(0.,0.,0.));\n#2=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += b;
    std::snprintf(b, sizeof b, "#3=CARTESIAN_POINT('',(%.17g,0.,0.));\n#4=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L, L); s += b;
    s += "#10=" + surface + ";\n";
    std::snprintf(b, sizeof b, "#21=CARTESIAN_POINT('',(0.,0.,0.));\n#22=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += b;
    std::snprintf(b, sizeof b, "#23=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n#24=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L, L, L); s += b;
    s += "#31=VERTEX_POINT('',#21);\n#32=VERTEX_POINT('',#22);\n#33=VERTEX_POINT('',#23);\n#34=VERTEX_POINT('',#24);\n";
    auto edge = [&](int ec, int va, int vb, int lp, double ax, double ay, int dir, int vec, int line,
                    double dx, double dy, const std::string& curve) {
        char e[320];
        std::snprintf(e, sizeof e, "#%d=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n#%d=DIRECTION('',(%.17g,%.17g,0.));\n"
                      "#%d=VECTOR('',#%d,%.17g);\n#%d=LINE('',#%d,#%d);\n", lp, ax, ay, dir, dx, dy, vec, dir, L, line, lp, vec);
        s += e;
        std::snprintf(e, sizeof e, "#%d=EDGE_CURVE('',#%d,#%d,#%s,.T.);\n", ec, va, vb,
                      curve.empty() ? std::to_string(line).c_str() : "85");
        s += e;
        if (!curve.empty()) s += "#85=" + curve + ";\n";
    };
    edge(41, 31, 32, 51, 0., 0., 61, 71, 81, 1., 0., edgeCurve);
    edge(42, 32, 33, 52, L, 0., 62, 72, 82, 0., 1., "");
    edge(43, 33, 34, 53, L, L, 63, 73, 83, -1., 0., "");
    edge(44, 34, 31, 54, 0., L, 64, 74, 84, 0., -1., "");
    s += "#91=ORIENTED_EDGE('',*,*,#41,.T.);\n#92=ORIENTED_EDGE('',*,*,#42,.T.);\n"
         "#93=ORIENTED_EDGE('',*,*,#43,.T.);\n#94=ORIENTED_EDGE('',*,*,#44,.T.);\n"
         "#100=EDGE_LOOP('',(#91,#92,#93,#94));\n#101=FACE_OUTER_BOUND('',#100,.T.);\n"
         "#300=ADVANCED_FACE('',(#101),#10,.T.);\n#310=OPEN_SHELL('',(#300));\n"
         "#320=SHELL_BASED_SURFACE_MODEL('',(#310));\n"
         "#9001=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n"
         "#9002=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n"
         "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}
std::string bilinear(const std::string& uMult, const std::string& uKnots) {
    return "B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#1,#2),(#3,#4)),.UNSPECIFIED.,.F.,.F.,.F.,"
           "(" + uMult + "),(2,2),(" + uKnots + "),(0.,1.),.UNSPECIFIED.)";
}
std::string rationalBilinear(const std::string& weights) {
    return "(BOUNDED_SURFACE()B_SPLINE_SURFACE(1,1,((#1,#2),(#3,#4)),.UNSPECIFIED.,.F.,.F.,.F.)"
           "B_SPLINE_SURFACE_WITH_KNOTS((2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)"
           "GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE(" + weights + ")"
           "REPRESENTATION_ITEM('')SURFACE())";
}

// ---- IGES fixture (fixed 80-column ASCII) ------------------------------------
struct Iges {
    std::string global, dir, param;
    long deNext = 1, pNext = 1, gCount = 0, dCount = 0, pCount = 0;
    static std::string f8(const std::string& v) { return v.size() >= 8 ? v.substr(0, 8) : std::string(8 - v.size(), ' ') + v; }
    static void line(std::string& dst, std::string payload, char sec, long seq) {
        payload.resize(72, ' ');
        dst += payload; dst += sec; dst += f8(std::to_string(seq)); dst += "\n";
    }
    long add(int type, const std::string& record) {
        const long de = deNext; deNext += 2;
        const std::string full = record + ";";
        const long first = pNext; long lines = 0;
        for (std::size_t pos = 0; pos < full.size(); pos += 64) {
            std::string chunk = full.substr(pos, 64); chunk.resize(64, ' ');
            line(param, chunk + f8(std::to_string(de)), 'P', pNext++); ++pCount; ++lines;
        }
        std::string l1 = f8(std::to_string(type)) + f8(std::to_string(first));
        for (int i = 0; i < 7; ++i) l1 += f8("0");
        line(dir, l1, 'D', de); ++dCount;
        std::string l2 = f8(std::to_string(de)) + f8("0") + f8("0") + f8(std::to_string(lines)) + f8("0");
        for (int i = 0; i < 4; ++i) l2 += f8("0");
        line(dir, l2, 'D', de + 1); ++dCount;
        return de;
    }
    std::string assemble() {
        const std::string g = "1H,,1H;,4Ht153,4Hfile,4Hforg,4Hforg,32,38,6,308,15,4Hrcvr,1,2,2HMM;";
        for (std::size_t pos = 0; pos < g.size(); pos += 72) line(global, g.substr(pos, 72), 'G', ++gCount);
        std::string s, t;
        line(s, "T-153 nurbs input validation gate", 'S', 1);
        line(t, "S" + f8("1") + "G" + f8(std::to_string(gCount)) + "D" + f8(std::to_string(dCount)) + "P" + f8(std::to_string(pCount)), 'T', 1);
        return s + global + dir + param + t;
    }
};
// 144 over a 128 bilinear S(u,v) = (10u, 10v, 0), bounded by a 102 of four
// model-space curves. `uKnots`/`weights` replace the 128's U knots / weights;
// `firstEdge126` (non-empty) replaces the first boundary 110 LINE by a degree-1
// 126 B-spline with those weights.
std::string igesFixture(const std::string& uKnots, const std::string& weights, const std::string& firstEdge126) {
    Iges b;
    const long surf = b.add(128, "128,1,1,1,1,0,0,1,0,0," + uKnots + ",0,0,1,1," + weights +
                                 ",0,0,0,10,0,0,0,10,0,10,10,0,0,1,0,1");
    const double c[4][2] = {{0, 0}, {10, 0}, {10, 10}, {0, 10}};
    std::string comp = "102,4";
    for (int k = 0; k < 4; ++k) {
        const int a = k, d = (k + 1) % 4;
        char rec[200];
        long id;
        if (k == 0 && !firstEdge126.empty()) {
            std::snprintf(rec, sizeof rec, "126,1,1,0,0,1,0,0,0,1,1,%s,%g,%g,0,%g,%g,0,0,1,0,0,1",
                          firstEdge126.c_str(), c[a][0], c[a][1], c[d][0], c[d][1]);
            id = b.add(126, rec);
        } else {
            std::snprintf(rec, sizeof rec, "110,%g,%g,0,%g,%g,0", c[a][0], c[a][1], c[d][0], c[d][1]);
            id = b.add(110, rec);
        }
        comp += "," + std::to_string(id);
    }
    const long composite = b.add(102, comp);
    const long cos = b.add(142, "142,0," + std::to_string(surf) + ",0," + std::to_string(composite) + ",0");
    b.add(144, "144," + std::to_string(surf) + ",0,0," + std::to_string(cos));
    return b.assemble();
}

int readers() {
    struct RCase { std::string name; bool iges; std::string text; std::string expectKey; };   // expectKey "" = must import cleanly
    std::vector<RCase> rc;
    const std::string line1 = "";
    rc.push_back({"step_valid_bilinear_face", false, stepFixture(bilinear("2,2", "0.,1."), line1), ""});
    rc.push_back({"step_valid_rational_face", false, stepFixture(rationalBilinear("((1.,1.),(1.,1.))"), line1), ""});
    rc.push_back({"step_valid_bspline_edge", false,
                  stepFixture(bilinear("2,2", "0.,1."), "B_SPLINE_CURVE_WITH_KNOTS('',1,(#21,#22),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,1.),.UNSPECIFIED.)"), ""});
    rc.push_back({"step_surface_zero_weights", false, stepFixture(rationalBilinear("((0.,0.),(0.,0.))"), line1),
                  "B_SPLINE_SURFACE_WITH_KNOTS(non_positive_weight)"});
    rc.push_back({"step_surface_negative_weight", false, stepFixture(rationalBilinear("((1.,1.),(-1.,1.))"), line1),
                  "B_SPLINE_SURFACE_WITH_KNOTS(non_positive_weight)"});
    rc.push_back({"step_surface_knot_count_mismatch", false, stepFixture(bilinear("2,1", "0.,1."), line1),
                  "B_SPLINE_SURFACE_WITH_KNOTS(knot_count_mismatch)"});
    rc.push_back({"step_surface_empty_domain", false, stepFixture(bilinear("2,2", "0.,0."), line1),
                  "B_SPLINE_SURFACE_WITH_KNOTS(empty_parameter_domain)"});
    rc.push_back({"step_surface_decreasing_knots", false, stepFixture(bilinear("2,2", "1.,0."), line1),
                  "B_SPLINE_SURFACE_WITH_KNOTS(decreasing_knots)"});
    // the two MEASURED corpus patterns, as edge curves
    rc.push_back({"step_edge_empty_domain_corpus_pattern", false,
                  stepFixture(bilinear("2,2", "0.,1."), "B_SPLINE_CURVE_WITH_KNOTS('',3,(#21,#21,#22,#22),.UNSPECIFIED.,.F.,.F.,(4,4),(0.,0.),.UNSPECIFIED.)"),
                  "B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)"});
    rc.push_back({"step_edge_knot_run_corpus_pattern", false,
                  stepFixture(bilinear("2,2", "0.,1."), "B_SPLINE_CURVE_WITH_KNOTS('',3,(#21,#21,#21,#21,#22,#22,#22),.UNSPECIFIED.,.F.,.F.,(7,4),(0.,1.),.UNSPECIFIED.)"),
                  "B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)"});
    rc.push_back({"step_edge_zero_weights", false,
                  stepFixture(bilinear("2,2", "0.,1."), "(BOUNDED_CURVE()B_SPLINE_CURVE(1,(#21,#22),.UNSPECIFIED.,.F.,.F.)"
                              "B_SPLINE_CURVE_WITH_KNOTS((2,2),(0.,1.),.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()"
                              "RATIONAL_B_SPLINE_CURVE((0.,0.))REPRESENTATION_ITEM(''))"),
                  "B_SPLINE_CURVE_WITH_KNOTS(non_positive_weight)"});
    rc.push_back({"step_edge_degree_exceeds_points", false,
                  stepFixture(bilinear("2,2", "0.,1."), "B_SPLINE_CURVE_WITH_KNOTS('',3,(#21,#22),.UNSPECIFIED.,.F.,.F.,(3,3),(0.,1.),.UNSPECIFIED.)"),
                  "B_SPLINE_CURVE_WITH_KNOTS(too_few_control_points)"});
    rc.push_back({"iges_valid_128_face", true, igesFixture("0,0,1,1", "1,1,1,1", ""), ""});
    rc.push_back({"iges_valid_126_edge", true, igesFixture("0,0,1,1", "1,1,1,1", "1,1"), ""});
    rc.push_back({"iges_128_zero_weights", true, igesFixture("0,0,1,1", "0,0,0,0", ""), "IGES_128(non_positive_weight)"});
    rc.push_back({"iges_128_empty_domain", true, igesFixture("0,0,0,0", "1,1,1,1", ""), "IGES_128(empty_parameter_domain)"});
    rc.push_back({"iges_126_zero_weights", true, igesFixture("0,0,1,1", "1,1,1,1", "0,0"), "IGES_126(non_positive_weight)"});

    int pass = 0, ran = 0;
    for (const RCase& k : rc) {
        ++ran;
        const pid_t pid = fork();
        if (pid == 0) {
            alarm(60);
            const ReaderOutcome o = k.iges ? readCounted([&] { return readForeignIges(k.text); })
                                           : readCounted([&] { return readForeignStep(k.text); });
            std::vector<std::string> f;
            std::string keys;
            for (const auto& kv : o.unsupported) keys += kv.first + " x" + std::to_string(kv.second) + "; ";
            if (k.expectKey.empty()) {
                if (!o.ok || !o.unsupported.empty() || o.trimmed != 1)
                    f.push_back("valid fixture did not import cleanly: ok=" + std::to_string(o.ok) + " trimmedFaces=" +
                                std::to_string(o.trimmed) + " unsupported={" + keys + "} reason='" + o.reason + "'");
            } else if (!o.unsupported.count(k.expectKey)) {
                f.push_back("expected named refusal '" + k.expectKey + "' missing: ok=" + std::to_string(o.ok) +
                            " unsupported={" + keys + "} reason='" + o.reason + "'");
            }
            if (!o.counted) f.push_back("typed API absent: no refusal counter");
            else if (o.refusals != 0)
                f.push_back(std::to_string(o.refusals) + " evaluator refusal(s): an invalid entity reached an evaluator instead of being refused at import");
            if (o.nonFinite) f.push_back(std::to_string(o.nonFinite) + " non-finite vertex coordinate(s)");
            if (f.empty()) std::printf("[PASS] %-44s %s\n", k.name.c_str(), k.expectKey.empty() ? "imports cleanly" : ("refused: " + k.expectKey).c_str());
            for (const auto& m : f) std::printf("[FAIL] %-44s %s\n", k.name.c_str(), m.c_str());
            std::fflush(stdout);
            _exit(f.empty() ? 0 : 1);
        }
        int st = 0;
        waitpid(pid, &st, 0);
        if (WIFEXITED(st) && WEXITSTATUS(st) == 0) ++pass;
        else if (!WIFEXITED(st)) {
            const int sig = WIFSIGNALED(st) ? WTERMSIG(st) : -1;
            std::printf("[CRASH] %-43s signal %d%s\n", k.name.c_str(), sig, sig == SIGABRT ? " (abort — an assert() fired)" : sig == SIGALRM ? " (hang)" : "");
        }
        std::fflush(stdout);
    }
    std::printf("READERS cases=%d pass=%d\n", ran, pass);
    return (ran > 0 && pass == ran) ? 0 : 1;
}

// ---------------------------------------------------------------------------
// --corpus: readForeignStep over the fixture list. Line format (tab-separated):
//   <path relative to --root>  <offending entity id>  <expected unsupported key>
// Per file, in a forked child: the read must finish (no signal, no hang); the
// expected NAMED refusal key must be in `unsupported`; the refusal counter must
// not move (no invalid NURBS reached an evaluator — the importer refused it at
// the boundary, so "none returns a point"); every vertex reachable from the
// returned shells must be finite; and every trimmed face's surface must pass
// validate(). The entity id is checked to exist in the file as a B-spline record.
// ---------------------------------------------------------------------------
int corpus(const char* listPath, const std::string& root) {
    std::ifstream lf(listPath);
    if (!lf) { std::printf("[t153-corpus] cannot open %s\n", listPath); return 2; }
    std::string line;
    int ran = 0, pass = 0;
    while (std::getline(lf, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::vector<std::string> col;
        std::stringstream ls(line); std::string tok;
        while (std::getline(ls, tok, '\t')) col.push_back(tok);
        if (col.size() < 3) { std::printf("[t153-corpus] bad fixture line: %s\n", line.c_str()); return 2; }
        ++ran;
        const std::string path = root + "/" + col[0];
        const pid_t pid = fork();
        if (pid == 0) {
            alarm(300);
            std::vector<std::string> fail;
            std::ifstream f(path, std::ios::binary);
            if (!f) { std::printf("[FAIL] %s: cannot read the fixture file\n", col[0].c_str()); _exit(1); }
            std::stringstream ss; ss << f.rdbuf();
            const std::string text = ss.str();
            // the named entity exists and is a B-spline record
            const std::string tag = "#" + col[1];
            std::size_t at = std::string::npos;
            for (std::size_t pos = text.find(tag); pos != std::string::npos; pos = text.find(tag, pos + 1)) {
                std::size_t q = pos + tag.size();
                while (q < text.size() && text[q] == ' ') ++q;
                const bool bol = (pos == 0 || text[pos - 1] == '\n' || text[pos - 1] == '\r');
                if (bol && q < text.size() && text[q] == '=') { at = pos; break; }
            }
            if (at == std::string::npos) fail.push_back("entity " + tag + " not found as a record");
            else {
                const std::size_t end = text.find(';', at);
                if (text.substr(at, end == std::string::npos ? std::string::npos : end - at).find("B_SPLINE_") == std::string::npos)
                    fail.push_back("entity " + tag + " is not a B_SPLINE_ record");
            }
#ifdef FORGE_NURBS_INPUT_VALIDATION
            const std::uint64_t before = nurbsEvaluationRefusals();
            const ForeignReadResult r = readForeignStep(text);
            const std::uint64_t refusals = nurbsEvaluationRefusals() - before;
#else
            const ForeignReadResult r = readForeignStep(text);
            const std::uint64_t refusals = 0;
            fail.push_back("typed API absent: no refusal counter, so 'no evaluator saw invalid data' cannot be shown");
#endif
            if (!r.unsupported.count(col[2])) {
                std::string keys;
                for (const auto& kv : r.unsupported) keys += kv.first + " x" + std::to_string(kv.second) + "; ";
                fail.push_back("expected named refusal '" + col[2] + "' missing; unsupported = {" + keys + "} ok=" +
                               std::to_string(r.ok) + " reason='" + r.reason + "'");
            }
            if (refusals != 0)
                fail.push_back(std::to_string(refusals) + " evaluator refusal(s) during the read: invalid NURBS data reached an evaluator");
            std::size_t verts = 0, nonFinite = 0;
            auto walk = [&](const Loop* L) {
                if (!L || !L->first) return;
                const Coedge* c = L->first;
                for (std::size_t i = 0; i < L->coedgeCount && c; ++i, c = c->next) {
                    const Vertex* v = c->originVertex();
                    if (!v) continue;
                    ++verts;
                    if (!std::isfinite(v->point.x) || !std::isfinite(v->point.y) || !std::isfinite(v->point.z)) ++nonFinite;
                }
            };
            for (const Shell* sh : r.shells)
                if (sh) for (const Face* fc : sh->faces)
                    if (fc) { walk(fc->outerLoop); for (const Loop* L : fc->innerLoops) walk(L); }
            if (nonFinite) fail.push_back(std::to_string(nonFinite) + " non-finite vertex coordinate(s) in the returned B-rep");
            std::size_t badSurf = 0;
            for (const auto& tf : r.trimmedFaces) if (!tf.surface.valid()) ++badSurf;
            if (badSurf) fail.push_back(std::to_string(badSurf) + " trimmed face(s) carry a surface validate() rejects");
            if (fail.empty())
                std::printf("[PASS] %s  refused '%s' (ok=%d closed=%d faces=%zu verts=%zu unsupported_kinds=%zu evaluator_refusals=0)\n",
                            col[0].c_str(), col[2].c_str(), int(r.ok), int(r.closed), r.faces, verts, r.unsupported.size());
            for (const auto& m : fail) std::printf("[FAIL] %s: %s\n", col[0].c_str(), m.c_str());
            std::fflush(stdout);
            _exit(fail.empty() ? 0 : 1);
        }
        int st = 0;
        waitpid(pid, &st, 0);
        if (WIFEXITED(st) && WEXITSTATUS(st) == 0) ++pass;
        else if (!WIFEXITED(st)) {
            const int sig = WIFSIGNALED(st) ? WTERMSIG(st) : -1;
            std::printf("[CRASH] %s: signal %d%s\n", col[0].c_str(), sig, sig == SIGABRT ? " (abort — an assert() fired)" : sig == SIGALRM ? " (hang)" : "");
        }
        std::fflush(stdout);
    }
    std::printf("CORPUS files=%d refused_with_named_reason=%d\n", ran, pass);
    return (ran > 0 && pass == ran) ? 0 : 1;
}
#endif

} // namespace

int main(int argc, char** argv) {
    const char* only = nullptr;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--dump-valid") return dumpValid(i + 1 < argc ? argv[i + 1] : nullptr);
        if (a == "--bench") return bench();
        if (a == "--only" && i + 1 < argc) { only = argv[++i]; continue; }
        if (a == "--corpus") {
#ifdef NURBS_GATE_READERS
            std::string root = ".";
            const char* list = (i + 1 < argc) ? argv[i + 1] : nullptr;
            for (int j = i + 2; j + 1 < argc; ++j) if (std::string(argv[j]) == "--root") root = argv[j + 1];
            if (!list) return 2;
            return corpus(list, root);
#else
            std::printf("[t153-gate] built without -DNURBS_GATE_READERS\n");
            return 2;
#endif
        }
        if (a == "--readers") {
#ifdef NURBS_GATE_READERS
            return readers();
#else
            std::printf("[t153-gate] built without -DNURBS_GATE_READERS\n");
            return 2;
#endif
        }
    }
    return runBattery(only);
}
