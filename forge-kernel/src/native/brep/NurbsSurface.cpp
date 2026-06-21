// forge/native/brep/NurbsSurface.cpp
//
// Implementation of the bivariate NURBS surface evaluator + tessellator
// (NurbsSurface.hpp). Pure C++20, no external dependencies. See the header for
// honesty / scope.
//
// Algorithms re-implemented from the standard mathematical definitions (NOT
// copied source): the Cox-de Boor basis recurrence and its derivative ("ders")
// table from Piegl & Tiller "The NURBS Book", combined with the quotient rule
// for the rational (weighted) surface S = A(u,v)/w(u,v).
//
// The point-evaluation basis (findSpan / basisFunctions) is REUSED from
// brep/Nurbs.cpp by #include — this file deliberately does not re-derive it.
// The basis-function FIRST-derivative table is implemented locally here because
// the value-only Nurbs.cpp does not export it (the curve-side derivative table
// lives in NurbsCalculus.cpp, which is not a dependency of this surface module).

#include "forge/native/brep/NurbsSurface.hpp"

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>   // std::max, std::is_sorted
#include <array>       // std::array
#include <cmath>       // std::sqrt, std::fabs
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace brep {

namespace {

// --- small vector helpers (local; Vec3 comes from Nurbs.hpp) ----------------
inline Vec3 vsub(const Vec3& a, const Vec3& b) {
    return Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 vscale(const Vec3& a, double s) {
    return Vec3{a.x * s, a.y * s, a.z * s};
}
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}
inline double vdot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline double vlen(const Vec3& a) { return std::sqrt(vdot(a, a)); }

// Is `knots` a non-decreasing, clamped vector for the given degree and count?
// Clamped == first knot repeated (degree+1) times and last knot repeated
// (degree+1) times. Returns false for any violation (the HONEST gate).
bool clampedKnotVector(const std::vector<double>& knots,
                       std::size_t count, std::size_t degree) {
    const std::size_t need = count + degree + 1;
    if (knots.size() != need) return false;
    // Non-decreasing.
    if (!std::is_sorted(knots.begin(), knots.end())) return false;
    // The clamped end-multiplicity must be exactly degree+1 at both ends, which
    // requires the first degree+1 knots to be equal and the last degree+1 equal.
    const double k0 = knots.front();
    const double k1 = knots.back();
    if (!(k0 < k1)) return false;  // empty / zero-length parameter domain
    for (std::size_t i = 0; i <= degree; ++i) {
        if (knots[i] != k0) return false;
        if (knots[knots.size() - 1 - i] != k1) return false;
    }
    return true;
}

// Basis functions AND their first derivatives at u for the (degree+1) nonzero
// functions in `span`. ders[0][.] are the values (== basisFunctions), ders[1][.]
// the first derivatives dN/du, both indexed local 0..degree mapping to the
// global functions span-degree .. span. Local to this TU.
//
// Implementation: we evaluate the value triangle for BOTH degree p and degree
// p-1 (the lower-degree functions feed the derivative), then apply the closed
// first-derivative identity
//   dN_{i,p}/du = p * ( N_{i,p-1}/(U[i+p]-U[i]) - N_{i+1,p-1}/(U[i+p+1]-U[i+1]) )
// with the standard 0/0 -> 0 convention at repeated knots. This is the direct,
// hard-to-get-wrong form of the NURBS-book DersBasisFuns (k = 1 only) and is
// cross-checked against central finite differences in the validation gate.
std::array<std::vector<double>, 2>
basisDeriv1(std::size_t span, double u, std::size_t degree,
            const std::vector<double>& knots) {
    const std::size_t p = degree;

    std::array<std::vector<double>, 2> ders;
    ders[0] = basisFunctions(span, u, p, knots);  // REUSE Nurbs.cpp values
    ders[1].assign(p + 1, 0.0);
    if (p == 0) return ders;  // derivative is identically zero

    // Degree p-1 basis values over the SAME span window. basisFunctions returns
    // the (p) nonzero functions for degree p-1, i.e. local index k=0..p-1 maps
    // to global functions (span-1)-... ; specifically for span the lower-degree
    // nonzero functions are global indices (span-(p-1)) .. span. We need both
    // N_{i,p-1} and N_{i+1,p-1} for global i = span-p .. span. The lower-degree
    // call gives N_{j,p-1} for j = span-(p-1) .. span. Build a lookup keyed by
    // the global function index so the derivative formula can index safely.
    const std::vector<double> low = basisFunctions(span, u, p - 1, knots);
    // low[k] == N_{(span-(p-1)+k), p-1}, k = 0..p-1.  (p entries)
    auto Nlow = [&](std::size_t gi) -> double {
        // gi is a GLOBAL function index. Map to the low[] window.
        const std::size_t base = span - (p - 1);  // first global idx in low[]
        if (gi < base) return 0.0;
        const std::size_t k = gi - base;
        if (k >= low.size()) return 0.0;
        return low[k];
    };

    const double fp = static_cast<double>(p);
    for (std::size_t a = 0; a <= p; ++a) {
        const std::size_t i = span - p + a;  // global function index
        const double dL = knots[i + p] - knots[i];
        const double dR = knots[i + p + 1] - knots[i + 1];
        const double termL = (dL != 0.0) ? (Nlow(i)     / dL) : 0.0;
        const double termR = (dR != 0.0) ? (Nlow(i + 1) / dR) : 0.0;
        ders[1][a] = fp * (termL - termR);
    }
    return ders;
}

// Homogeneous accumulator with first partials (numerator A and weight w, plus
// their u- and v-derivatives). Projected via the quotient rule:
//   S   = A / w
//   S_u = (A_u - S * w_u) / w
//   S_v = (A_v - S * w_v) / w
struct RatAccum {
    Vec3 A{}, Au{}, Av{};
    double w = 0.0, wu = 0.0, wv = 0.0;
};

} // namespace

// ---------------------------------------------------------------------------
// validateSurface — the honest gate.
// ---------------------------------------------------------------------------
bool validateSurface(const NurbsSurface& s, const char** reason) {
    auto fail = [&](const char* why) -> bool {
        if (reason) *reason = why;
        return false;
    };
    if (reason) *reason = "";

    if (s.control.empty()) return fail("empty control net");
    const std::size_t nU = s.control.size();
    const std::size_t nV = s.control[0].size();
    if (nV == 0) return fail("empty control row");

    // Rectangular net + matching weights, all > 0.
    if (s.weights.size() != nU) return fail("weights row count mismatch");
    for (std::size_t i = 0; i < nU; ++i) {
        if (s.control[i].size() != nV) return fail("ragged control net");
        if (s.weights[i].size() != nV) return fail("ragged weights net");
        for (std::size_t j = 0; j < nV; ++j) {
            if (!(s.weights[i][j] > 0.0)) return fail("non-positive weight");
        }
    }

    // degree >= 1 and STRICTLY less than the count in that direction.
    if (s.degreeU < 1 || s.degreeV < 1) return fail("degree < 1");
    if (s.degreeU >= nU) return fail("degreeU >= control count (U)");
    if (s.degreeV >= nV) return fail("degreeV >= control count (V)");

    // Clamped, non-decreasing, correctly-sized knot vectors.
    if (!clampedKnotVector(s.knotsU, nU, s.degreeU))
        return fail("U knot vector not clamped/sized/sorted");
    if (!clampedKnotVector(s.knotsV, nV, s.degreeV))
        return fail("V knot vector not clamped/sized/sorted");

    return true;
}

// ---------------------------------------------------------------------------
// evaluatePoint — point-only honest wrapper.
// ---------------------------------------------------------------------------
SurfaceSample evaluatePoint(const NurbsSurface& s, double u, double v) {
    SurfaceSample out;
    if (!validateSurface(s)) return out;  // ok stays false

    // In-domain check against the clamped knot range.
    const double u0 = s.knotsU.front(), u1 = s.knotsU.back();
    const double v0 = s.knotsV.front(), v1 = s.knotsV.back();
    if (u < u0 || u > u1 || v < v0 || v > v1) return out;

    out.point = s.evaluate(u, v);  // reuse the validated Nurbs.cpp evaluator
    out.ok = true;
    return out;
}

// ---------------------------------------------------------------------------
// evaluateWithDerivatives — point + analytic partials + unit normal.
// ---------------------------------------------------------------------------
SurfaceSample evaluateWithDerivatives(const NurbsSurface& s, double u, double v) {
    SurfaceSample out;
    if (!validateSurface(s)) return out;

    const std::size_t nU = s.control.size();
    const std::size_t nV = s.control[0].size();
    const double u0 = s.knotsU.front(), u1 = s.knotsU.back();
    const double v0 = s.knotsV.front(), v1 = s.knotsV.back();
    if (u < u0 || u > u1 || v < v0 || v > v1) return out;

    const std::size_t spanU = findSpan(nU - 1, s.degreeU, u, s.knotsU);
    const std::size_t spanV = findSpan(nV - 1, s.degreeV, v, s.knotsV);

    // Value + first-derivative basis tables in each direction.
    const auto du = basisDeriv1(spanU, u, s.degreeU, s.knotsU);  // [0]=val [1]=d/du
    const auto dv = basisDeriv1(spanV, v, s.degreeV, s.knotsV);

    RatAccum acc;
    for (std::size_t a = 0; a <= s.degreeU; ++a) {
        const std::size_t iu = spanU - s.degreeU + a;
        for (std::size_t b = 0; b <= s.degreeV; ++b) {
            const std::size_t iv = spanV - s.degreeV + b;
            const Vec3& P = s.control[iu][iv];
            const double wgt = s.weights[iu][iv];

            // Tensor-product basis values and partials.
            const double Bu  = du[0][a], Bup = du[1][a];
            const double Bv  = dv[0][b], Bvp = dv[1][b];
            const double N    = Bu  * Bv;     // basis value
            const double Nu_  = Bup * Bv;     // d/du
            const double Nv_  = Bu  * Bvp;    // d/dv

            const double wN   = wgt * N;
            const double wNu  = wgt * Nu_;
            const double wNv  = wgt * Nv_;

            acc.A.x  += P.x * wN;  acc.A.y  += P.y * wN;  acc.A.z  += P.z * wN;
            acc.Au.x += P.x * wNu; acc.Au.y += P.y * wNu; acc.Au.z += P.z * wNu;
            acc.Av.x += P.x * wNv; acc.Av.y += P.y * wNv; acc.Av.z += P.z * wNv;
            acc.w  += wN;
            acc.wu += wNu;
            acc.wv += wNv;
        }
    }

    if (!(std::fabs(acc.w) > 0.0)) return out;  // degenerate rational denom

    const double invW = 1.0 / acc.w;
    out.point = vscale(acc.A, invW);
    // Quotient rule: S_u = (A_u - S*w_u)/w ; S_v = (A_v - S*w_v)/w
    out.du = vscale(vsub(acc.Au, vscale(out.point, acc.wu)), invW);
    out.dv = vscale(vsub(acc.Av, vscale(out.point, acc.wv)), invW);

    const Vec3 nrm = vcross(out.du, out.dv);
    const double nlen = vlen(nrm);
    if (nlen > 0.0) {
        out.normal = vscale(nrm, 1.0 / nlen);
        out.ok = true;
    } else {
        // Parallel partials: singular parameter point. Honest: no usable normal.
        out.normal = Vec3{0.0, 0.0, 0.0};
        out.ok = false;
    }
    return out;
}

// ---------------------------------------------------------------------------
// tessellate — uniform (u,v) grid -> triangulated HalfEdgeMesh (open patch).
// ---------------------------------------------------------------------------
mesh::HalfEdgeMesh tessellate(const NurbsSurface& s,
                              std::size_t resU, std::size_t resV, bool& ok) {
    ok = false;
    mesh::HalfEdgeMesh hem;
    if (resU < 1 || resV < 1) return hem;
    if (!validateSurface(s)) return hem;

    const double u0 = s.knotsU.front(), u1 = s.knotsU.back();
    const double v0 = s.knotsV.front(), v1 = s.knotsV.back();

    const std::size_t gu = resU + 1;  // grid columns (U samples)
    const std::size_t gv = resV + 1;  // grid rows    (V samples)

    std::vector<double> positions;
    positions.reserve(3 * gu * gv);
    for (std::size_t i = 0; i < gu; ++i) {
        const double tu = (gu == 1) ? 0.0
                                    : static_cast<double>(i) / static_cast<double>(resU);
        const double u = u0 + (u1 - u0) * tu;
        for (std::size_t j = 0; j < gv; ++j) {
            const double tv = (gv == 1) ? 0.0
                                        : static_cast<double>(j) / static_cast<double>(resV);
            const double v = v0 + (v1 - v0) * tv;
            const Vec3 p = s.evaluate(u, v);
            positions.push_back(p.x);
            positions.push_back(p.y);
            positions.push_back(p.z);
        }
    }

    auto vid = [gv](std::size_t i, std::size_t j) -> std::uint32_t {
        return static_cast<std::uint32_t>(i * gv + j);
    };

    std::vector<std::uint32_t> indices;
    indices.reserve(6 * resU * resV);
    for (std::size_t i = 0; i + 1 < gu; ++i) {
        for (std::size_t j = 0; j + 1 < gv; ++j) {
            const std::uint32_t a = vid(i,     j);
            const std::uint32_t b = vid(i + 1, j);
            const std::uint32_t c = vid(i,     j + 1);
            const std::uint32_t d = vid(i + 1, j + 1);
            // Two CCW triangles per quad (consistent winding for the half-edge
            // build; an open patch so it is intentionally not watertight).
            indices.push_back(a); indices.push_back(b); indices.push_back(d);
            indices.push_back(a); indices.push_back(d); indices.push_back(c);
        }
    }

    if (!hem.buildFromSoup(positions, indices)) {
        // Surface a build failure honestly (e.g. a fully-degenerate grid with a
        // repeated vertex index) rather than returning a half-built mesh.
        return mesh::HalfEdgeMesh{};
    }
    ok = true;
    return hem;
}

} // namespace brep
} // namespace native
} // namespace forge
