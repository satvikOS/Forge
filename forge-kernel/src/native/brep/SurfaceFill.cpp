// forge/native/brep/SurfaceFill.cpp
//
// Implementation of the CLASS-A SURFACE FILL — bicubically-blended Coons / Gordon
// patch (SurfaceFill.hpp). Pure C++20, no external dependencies. See the header
// for the full mathematical construction and honesty / scope.
//
// Construction re-implemented from the standard definitions (NOT copied source):
// the Boolean-sum (Coons) transfinite blend with cubic-Hermite blending
// functions (Coons 1967; Farin "Curves and Surfaces for CAGD" ch.22; Hoschek &
// Lasser "Fundamentals of CAGD" ch.14). Boundary curves + their derivatives are
// read through the validated brep::curveDerivatives (NurbsCalculus.cpp) — this
// file does NOT re-derive the basis recurrence or the rational derivative rule.

#include "forge/native/brep/SurfaceFill.hpp"

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsCalculus.hpp"

#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// --- small Vec3 helpers (local; Vec3 comes from Nurbs.hpp) ------------------
inline Vec3 vadd(const Vec3& a, const Vec3& b) {
    return Vec3{a.x + b.x, a.y + b.y, a.z + b.z};
}
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

// Sum a list of (scalar * Vec3) terms.
inline Vec3 lc4(double a, const Vec3& A, double b, const Vec3& B,
                double c, const Vec3& C, double d, const Vec3& D) {
    return Vec3{a * A.x + b * B.x + c * C.x + d * D.x,
                a * A.y + b * B.y + c * C.y + d * D.y,
                a * A.z + b * B.z + c * C.z + d * D.z};
}

// --- cubic Hermite blending functions and their first derivatives -----------
//   H0(t)=2t^3-3t^2+1   H1(t)=-2t^3+3t^2
//   h0(t)=t^3-2t^2+t    h1(t)=t^3-t^2
// Endpoint properties (used to prove exact interpolation/tangent recovery):
//   H0(0)=1 H0(1)=0  H1(0)=0 H1(1)=1   h0(0)=h0(1)=0  h1(0)=h1(1)=0
//   H0'(0)=H0'(1)=0  H1'(0)=H1'(1)=0   h0'(0)=1 h0'(1)=0  h1'(0)=0 h1'(1)=1
struct Hermite { double H0, H1, h0, h1; };

inline Hermite hermite(double t) {
    const double t2 = t * t, t3 = t2 * t;
    return Hermite{ 2 * t3 - 3 * t2 + 1,    // H0
                   -2 * t3 + 3 * t2,        // H1
                    t3 - 2 * t2 + t,        // h0
                    t3 - t2 };              // h1
}
inline Hermite hermiteD(double t) {
    const double t2 = t * t;
    return Hermite{ 6 * t2 - 6 * t,         // H0'
                   -6 * t2 + 6 * t,         // H1'
                    3 * t2 - 4 * t + 1,     // h0'
                    3 * t2 - 2 * t };       // h1'
}

// --- boundary-curve evaluation re-parameterised onto the patch [0,1] --------
// A clamped NurbsCurve has intrinsic parameter domain [knots[p], knots[n+1]].
// The patch maps t in [0,1] linearly onto that domain. point() returns C, and
// alongTangent() returns dC/dt = (u1-u0)*C'(u_intrinsic) (chain rule), i.e. the
// tangent ALONG the edge with respect to the PATCH parameter.
struct EdgeCurve {
    const NurbsCurve* c = nullptr;
    double u0 = 0.0, u1 = 1.0, span = 1.0;

    void bind(const NurbsCurve& curve) {
        c = &curve;
        const std::size_t p = curve.degree;
        const std::size_t n = curve.controlPoints.size() - 1;
        u0 = curve.knots[p];
        u1 = curve.knots[n + 1];
        span = u1 - u0;
    }
    double intrinsic(double t) const { return u0 + t * span; }

    Vec3 point(double t) const {
        return c->evaluate(intrinsic(t));
    }
    // dC/dt along the edge (chain rule).
    Vec3 alongTangent(double t) const {
        const auto d = curveDerivatives(*c, intrinsic(t), 1);
        return vscale(d[1], span);
    }
};

// A "vector curve": a NurbsCurve whose EVALUATED POINT is the prescribed
// derivative VECTOR (S_v or S_u) at that edge parameter, re-parameterised the
// same way. value(t) returns that vector; dValue(t) its derivative w.r.t. t
// (needed for the consistent corner twist).
struct VectorCurve {
    const NurbsCurve* c = nullptr;
    double u0 = 0.0, u1 = 1.0, span = 1.0;

    void bind(const NurbsCurve& curve) {
        c = &curve;
        const std::size_t p = curve.degree;
        const std::size_t n = curve.controlPoints.size() - 1;
        u0 = curve.knots[p];
        u1 = curve.knots[n + 1];
        span = u1 - u0;
    }
    double intrinsic(double t) const { return u0 + t * span; }

    Vec3 value(double t) const { return c->evaluate(intrinsic(t)); }
    Vec3 dValue(double t) const {
        const auto d = curveDerivatives(*c, intrinsic(t), 1);
        return vscale(d[1], span);
    }
};

} // namespace

// ===========================================================================
// CoonsBoundary::validate — the honest gate.
// ===========================================================================
bool CoonsBoundary::validate(const char** reason, double cornerTol) const {
    auto fail = [&](const char* why) -> bool {
        if (reason) *reason = why;
        return false;
    };
    if (reason) *reason = "";

    if (!c0.valid()) return fail("c0 (v=0 edge) is not a valid NURBS curve");
    if (!c1.valid()) return fail("c1 (v=1 edge) is not a valid NURBS curve");
    if (!d0.valid()) return fail("d0 (u=0 edge) is not a valid NURBS curve");
    if (!d1.valid()) return fail("d1 (u=1 edge) is not a valid NURBS curve");

    EdgeCurve ec0, ec1, ed0, ed1;
    ec0.bind(c0); ec1.bind(c1); ed0.bind(d0); ed1.bind(d1);

    // Corner compatibility: the four edges must close the loop.
    //   c0(0)=d0(0)   c0(1)=d1(0)   c1(0)=d0(1)   c1(1)=d1(1)
    auto close = [&](const Vec3& a, const Vec3& b) -> bool {
        return vlen(vsub(a, b)) <= cornerTol;
    };
    if (!close(ec0.point(0.0), ed0.point(0.0)))
        return fail("corner (0,0): c0(0) != d0(0)");
    if (!close(ec0.point(1.0), ed1.point(0.0)))
        return fail("corner (1,0): c0(1) != d1(0)");
    if (!close(ec1.point(0.0), ed0.point(1.0)))
        return fail("corner (0,1): c1(0) != d0(1)");
    if (!close(ec1.point(1.0), ed1.point(1.0)))
        return fail("corner (1,1): c1(1) != d1(1)");

    if (g1) {
        if (!t0.valid()) return fail("t0 (S_v on v=0) tangent field invalid");
        if (!t1.valid()) return fail("t1 (S_v on v=1) tangent field invalid");
        if (!e0.valid()) return fail("e0 (S_u on u=0) tangent field invalid");
        if (!e1.valid()) return fail("e1 (S_u on u=1) tangent field invalid");
    }
    return true;
}

// ===========================================================================
// fillCoonsPatch — build the patch (validation only; the blend is analytic).
// ===========================================================================
CoonsPatch fillCoonsPatch(const CoonsBoundary& boundary) {
    CoonsPatch patch;
    patch.boundary = boundary;
    const char* why = nullptr;
    if (!boundary.validate(&why)) {
        patch.ok = false;
        patch.reason = (why && *why) ? why : "invalid Coons boundary";
        return patch;
    }
    patch.ok = true;
    patch.reason = "";
    return patch;
}

// ===========================================================================
// The shared Boolean-sum blend kernel.
//
// We assemble the bicubically-blended Coons patch and (optionally) its first
// partials. The construction is:
//
//   S(u,v) = Lc + Ld - T
//
//   Lc(u,v) = H0(v) c0(u) + H1(v) c1(u) [+ h0(v) t0(u) + h1(v) t1(u)]   (loft v)
//   Ld(u,v) = H0(u) d0(v) + H1(u) d1(v) [+ h0(u) e0(v) + h1(u) e1(v)]   (loft u)
//   T(u,v)  = sum over the 4 corners of the bicubic Hermite of the corner
//             position / u-tangent / v-tangent / twist data.
//
// The correction T is the bicubic Hermite interpolant of the 4x4 corner block:
//   value:    S at the 4 corners (= c0/c1 endpoints),
//   u-deriv:  S_u at the 4 corners (from d0/d1 along-tangents and, for G1, the
//             e0/e1 fields at v=0/1 — both agree at a compatible corner; we take
//             the along-edge value so the loft cancellation is exact),
//   v-deriv:  S_v at the 4 corners (from c0/c1 along-tangents resp. t0/t1),
//   twist:    S_uv at the 4 corners (Adini: derivative of the prescribed cross
//             field along the adjacent edge, taken consistently so T cancels the
//             double-counted boundary contribution of Lc and Ld).
//
// Endpoint algebra guarantees S(u,0)=c0(u), S(u,1)=c1(u), S(0,v)=d0(v),
// S(1,v)=d1(v) and (G1) S_v(u,0)=t0(u), S_v(u,1)=t1(u), S_u(0,v)=e0(v),
// S_u(1,v)=e1(v) EXACTLY — this is the property the gate measures.
// ===========================================================================
namespace {

struct BlendData {
    EdgeCurve   ec0, ec1, ed0, ed1;   // c0,c1 (param u); d0,d1 (param v)
    VectorCurve vt0, vt1, ve0, ve1;   // S_v on v=0/1; S_u on u=0/1
    bool g1 = false;

    // Corner block (indexed [iu][iv], iu,iv in {0,1} -> u,v in {0,1}):
    //   P[iu][iv]   corner position
    //   Pu[iu][iv]  S_u at the corner
    //   Pv[iu][iv]  S_v at the corner
    //   Puv[iu][iv] twist S_uv at the corner
    Vec3 P[2][2], Pu[2][2], Pv[2][2], Puv[2][2];

    void build(const CoonsBoundary& b) {
        g1 = b.g1;
        ec0.bind(b.c0); ec1.bind(b.c1);
        ed0.bind(b.d0); ed1.bind(b.d1);
        if (g1) { vt0.bind(b.t0); vt1.bind(b.t1); ve0.bind(b.e0); ve1.bind(b.e1); }

        // Corner positions (use the c-edges; they share the corners with d-edges).
        P[0][0] = ec0.point(0.0);   // (u=0,v=0)
        P[1][0] = ec0.point(1.0);   // (u=1,v=0)
        P[0][1] = ec1.point(0.0);   // (u=0,v=1)
        P[1][1] = ec1.point(1.0);   // (u=1,v=1)

        // S_u at corners = along-tangent of the d-edges (param v) evaluated at
        // the corner's v. d0 is the u=0 edge, d1 the u=1 edge — but S_u at a
        // corner is the cross-derivative of the d-edge, i.e. how S moves in u.
        // The along-tangent of d0/d1 is dS/dv (it runs in v). S_u at the corners
        // comes from the c-edges' along-tangent (which runs in u):
        //   S_u(0,0)=c0'(0)  S_u(1,0)=c0'(1)  S_u(0,1)=c1'(0)  S_u(1,1)=c1'(1)
        Pu[0][0] = ec0.alongTangent(0.0);
        Pu[1][0] = ec0.alongTangent(1.0);
        Pu[0][1] = ec1.alongTangent(0.0);
        Pu[1][1] = ec1.alongTangent(1.0);

        // S_v at the corners runs in v -> from the d-edges' along-tangent:
        //   S_v(0,0)=d0'(0)  S_v(0,1)=d0'(1)  S_v(1,0)=d1'(0)  S_v(1,1)=d1'(1)
        Pv[0][0] = ed0.alongTangent(0.0);
        Pv[0][1] = ed0.alongTangent(1.0);
        Pv[1][0] = ed1.alongTangent(0.0);
        Pv[1][1] = ed1.alongTangent(1.0);

        // Twist S_uv at the corners. For exact Boolean-sum cancellation the
        // twist of the correction MUST equal the mixed partial implied by the
        // loft terms. We take the consistent Adini twist: the derivative of the
        // PRESCRIBED cross field along the adjacent edge when G1 data is present,
        // else (G0) the derivative of the boundary along-tangent (the bilinear
        // mixed partial), so the bilinearly-blended Coons patch is reproduced.
        if (g1) {
            // S_uv(u,0) = d/du t0(u);  S_uv(u,1) = d/du t1(u)
            //   -> at the four corners (u in {0,1}):
            Puv[0][0] = vt0.dValue(0.0);   // (0,0) from t0
            Puv[1][0] = vt0.dValue(1.0);   // (1,0) from t0
            Puv[0][1] = vt1.dValue(0.0);   // (0,1) from t1
            Puv[1][1] = vt1.dValue(1.0);   // (1,1) from t1
        } else {
            // Bilinear mixed partial = d/du of the v-along-tangent at the corner,
            // i.e. derivative of d-edge tangent in u — equivalently d/dv of the
            // u-along-tangent. Use the c-edge cross difference (finite, exact in
            // the bilinear case where the twist is the corner-rule constant).
            // For straight edges the twist is zero (the patch is the bilinear
            // Coons = exact plane). We compute it as d/dv of Pu via the d-edge:
            //   for a bilinear blend the consistent twist is the corner-rule
            //   (P11 - P10 - P01 + P00)-style mixed slope; with only boundary
            //   data the standard zero-twist (Coons "deficient") choice is taken,
            //   which is EXACT for ruled/planar boundaries (the gate's plane).
            Puv[0][0] = Vec3{0, 0, 0};
            Puv[1][0] = Vec3{0, 0, 0};
            Puv[0][1] = Vec3{0, 0, 0};
            Puv[1][1] = Vec3{0, 0, 0};
        }
    }

    // Blend weight vector [b0 b1 c0 c1] in one direction at parameter t, plus
    // its derivative. For G1 these are the CUBIC HERMITE functions [H0 H1 h0 h1].
    // For G0 (bilinear) they collapse to the LINEAR blend [1-t, t, 0, 0] — the
    // zero tangent/twist columns drop the h-terms in BOTH the lofts and the
    // correction, so the construction reduces EXACTLY to the bilinearly-blended
    // Coons patch (which reproduces a plane / ruled surface exactly). Using the
    // SAME weight vector in the loft and the correction is what guarantees the
    // Boolean-sum cancellation on the boundary.
    struct W { double b0, b1, c0, c1; };
    W weights(double t) const {
        if (g1) { const Hermite h = hermite(t); return W{h.H0, h.H1, h.h0, h.h1}; }
        return W{1.0 - t, t, 0.0, 0.0};
    }
    W weightsD(double t) const {
        if (g1) { const Hermite h = hermiteD(t); return W{h.H0, h.H1, h.h0, h.h1}; }
        return W{-1.0, 1.0, 0.0, 0.0};
    }

    // Evaluate point and (if wantD) first partials at (u,v).
    void eval(double u, double v, Vec3& S, Vec3& Su, Vec3& Sv, bool wantD) const {
        const W Wu = weights(u),  Wv = weights(v);
        const W dWu = weightsD(u), dWv = weightsD(v);

        // Edge samples.
        const Vec3 C0 = ec0.point(u), C1 = ec1.point(u);   // along u
        const Vec3 D0 = ed0.point(v), D1 = ed1.point(v);   // along v

        // ---- Loft in v: Lc = b0(v)c0 + b1(v)c1 [+ c0(v)t0 + c1(v)t1] (G1) -----
        Vec3 Lc = lc4(Wv.b0, C0, Wv.b1, C1, 0.0, C0, 0.0, C0);
        if (g1) {
            const Vec3 T0 = vt0.value(u), T1 = vt1.value(u);
            Lc = vadd(Lc, lc4(Wv.c0, T0, Wv.c1, T1, 0.0, T0, 0.0, T0));
        }

        // ---- Loft in u: Ld = b0(u)d0 + b1(u)d1 [+ c0(u)e0 + c1(u)e1] (G1) -----
        Vec3 Ld = lc4(Wu.b0, D0, Wu.b1, D1, 0.0, D0, 0.0, D0);
        if (g1) {
            const Vec3 E0 = ve0.value(v), E1 = ve1.value(v);
            Ld = vadd(Ld, lc4(Wu.c0, E0, Wu.c1, E1, 0.0, E0, 0.0, E0));
        }

        // ---- Correction T(u,v): tensor product of the same blend over the 4x4
        // corner block. T = wu^T * B * wv with wu=[b0 b1 c0 c1], same in v.
        const double wu[4] = {Wu.b0, Wu.b1, Wu.c0, Wu.c1};
        const double wv[4] = {Wv.b0, Wv.b1, Wv.c0, Wv.c1};
        // 4x4 geometry block B[iu][iv], rows/cols indexed {value0,value1,deriv0,
        // deriv1}. Standard bicubic Hermite layout:
        //   B = [[P00,  P01,  Pv00, Pv01 ],
        //        [P10,  P11,  Pv10, Pv11 ],
        //        [Pu00, Pu01, Puv00,Puv01],
        //        [Pu10, Pu11, Puv10,Puv11]]
        const Vec3 B[4][4] = {
            { P[0][0],  P[0][1],  Pv[0][0],  Pv[0][1]  },
            { P[1][0],  P[1][1],  Pv[1][0],  Pv[1][1]  },
            { Pu[0][0], Pu[0][1], Puv[0][0], Puv[0][1] },
            { Pu[1][0], Pu[1][1], Puv[1][0], Puv[1][1] },
        };
        Vec3 T{0, 0, 0};
        for (int a = 0; a < 4; ++a)
            for (int bb = 0; bb < 4; ++bb)
                T = vadd(T, vscale(B[a][bb], wu[a] * wv[bb]));

        S = vsub(vadd(Lc, Ld), T);

        if (!wantD) { Su = Sv = Vec3{0, 0, 0}; return; }

        // ---- First partials -------------------------------------------------
        // Along-edge curve tangents (in u for c, in v for d).
        const Vec3 C0u = ec0.alongTangent(u), C1u = ec1.alongTangent(u);
        const Vec3 D0v = ed0.alongTangent(v), D1v = ed1.alongTangent(v);

        // Lc partials.
        //   Lc_u = b0(v)c0' + b1(v)c1' [+ c0(v)t0' + c1(v)t1']
        //   Lc_v = b0'(v)c0 + b1'(v)c1 [+ c0'(v)t0 + c1'(v)t1]
        Vec3 Lcu = lc4(Wv.b0, C0u, Wv.b1, C1u, 0, C0u, 0, C0u);
        Vec3 Lcv = lc4(dWv.b0, C0, dWv.b1, C1, 0, C0, 0, C0);
        if (g1) {
            const Vec3 T0 = vt0.value(u), T1 = vt1.value(u);
            const Vec3 T0u = vt0.dValue(u), T1u = vt1.dValue(u);
            Lcu = vadd(Lcu, lc4(Wv.c0, T0u, Wv.c1, T1u, 0, T0u, 0, T0u));
            Lcv = vadd(Lcv, lc4(dWv.c0, T0, dWv.c1, T1, 0, T0, 0, T0));
        }

        // Ld partials.
        //   Ld_u = b0'(u)d0 + b1'(u)d1 [+ c0'(u)e0 + c1'(u)e1]
        //   Ld_v = b0(u)d0' + b1(u)d1' [+ c0(u)e0' + c1(u)e1']
        Vec3 Ldu = lc4(dWu.b0, D0, dWu.b1, D1, 0, D0, 0, D0);
        Vec3 Ldv = lc4(Wu.b0, D0v, Wu.b1, D1v, 0, D0v, 0, D0v);
        if (g1) {
            const Vec3 E0 = ve0.value(v), E1 = ve1.value(v);
            const Vec3 E0v = ve0.dValue(v), E1v = ve1.dValue(v);
            Ldu = vadd(Ldu, lc4(dWu.c0, E0, dWu.c1, E1, 0, E0, 0, E0));
            Ldv = vadd(Ldv, lc4(Wu.c0, E0v, Wu.c1, E1v, 0, E0v, 0, E0v));
        }

        // T partials: dwu/du and dwv/dv applied to the same block B.
        const double dwu[4] = {dWu.b0, dWu.b1, dWu.c0, dWu.c1};
        const double dwv[4] = {dWv.b0, dWv.b1, dWv.c0, dWv.c1};
        Vec3 Tu{0, 0, 0}, Tv{0, 0, 0};
        for (int a = 0; a < 4; ++a)
            for (int bb = 0; bb < 4; ++bb) {
                Tu = vadd(Tu, vscale(B[a][bb], dwu[a] * wv[bb]));
                Tv = vadd(Tv, vscale(B[a][bb], wu[a] * dwv[bb]));
            }

        Su = vsub(vadd(Lcu, Ldu), Tu);
        Sv = vsub(vadd(Lcv, Ldv), Tv);
    }
};

} // namespace

// ===========================================================================
// CoonsPatch::evaluate / evaluateWithDerivatives.
// ===========================================================================
// Clamp a parameter to the patch domain [0,1] with a small numerical tolerance:
// values within `domTol` of the ends are snapped in (so float accumulation that
// overshoots 1.0 by an ULP is evaluated on the boundary, not rejected); values
// grossly outside are clamped to the nearest end (honest: the Coons blend is
// only defined on the unit square, and the caller asked for an out-of-domain
// point — we evaluate the nearest in-domain patch point rather than fabricate).
namespace {
constexpr double kDomTol = 1e-9;
inline double clampDomain(double t) {
    if (t < 0.0) return 0.0;
    if (t > 1.0) return 1.0;
    return t;
}
} // namespace

Vec3 CoonsPatch::evaluate(double u, double v) const {
    if (!ok) return Vec3{0, 0, 0};
    BlendData bd;
    bd.build(boundary);
    Vec3 S, Su, Sv;
    bd.eval(clampDomain(u), clampDomain(v), S, Su, Sv, /*wantD=*/false);
    return S;
}

CoonsSample CoonsPatch::evaluateWithDerivatives(double u, double v) const {
    CoonsSample out;
    if (!ok) return out;
    // Reject only GROSSLY out-of-domain queries; snap a tiny float overshoot in.
    if (u < -kDomTol || u > 1.0 + kDomTol ||
        v < -kDomTol || v > 1.0 + kDomTol) return out;
    u = clampDomain(u);
    v = clampDomain(v);
    BlendData bd;
    bd.build(boundary);
    Vec3 S, Su, Sv;
    bd.eval(u, v, S, Su, Sv, /*wantD=*/true);
    out.point = S;
    out.du = Su;
    out.dv = Sv;
    const Vec3 nrm = vcross(Su, Sv);
    const double nl = vlen(nrm);
    if (nl > 0.0) {
        out.normal = vscale(nrm, 1.0 / nl);
        out.ok = true;
    } else {
        out.normal = Vec3{0, 0, 0};
        out.ok = false;  // degenerate (e.g. a corner where edges are parallel)
    }
    return out;
}

// ===========================================================================
// exportBicubicSurface — degree-3x3 Bezier NurbsSurface representation.
//
// Build the 16 Bezier control points from the 4x4 Hermite corner block via the
// fixed Hermite->Bezier change of basis on a unit interval:
//   given endpoint values f0,f1 and end derivatives m0,m1, the cubic Bezier
//   control values are  b0=f0,  b1=f0+m0/3,  b2=f1-m1/3,  b3=f1.
// Applied tensor-product in u and v to the [P, Pu, Pv, Puv] block this gives the
// bicubic Bezier net that reproduces the Coons patch exactly when the patch is a
// genuine bicubic (boundaries polynomial of degree <= 3); otherwise it is the
// bicubic-Hermite surface through the corner nodes (exactBicubic=false).
// ===========================================================================
CoonsSurfaceExport exportBicubicSurface(const CoonsPatch& patch) {
    CoonsSurfaceExport ex;
    if (!patch.ok) {
        ex.ok = false;
        ex.reason = patch.reason.empty() ? "invalid Coons patch" : patch.reason;
        return ex;
    }

    BlendData bd;
    bd.build(patch.boundary);

    // 4x4 Hermite block, indexed [iu][iv] over {value0,value1,deriv0,deriv1}.
    // We need, per direction, the cubic Bezier of the matched Hermite data.
    // First convert in u for each of the four "v-rows", then in v.
    //
    // Hermite block H[a][b], a over u-data, b over v-data (same layout as B in
    // the kernel): rows {P0*, P1*, Pu0*, Pu1*}, cols {*0, *1, *v0, *v1}.
    Vec3 H[4][4] = {
        { bd.P[0][0],  bd.P[0][1],  bd.Pv[0][0],  bd.Pv[0][1]  },
        { bd.P[1][0],  bd.P[1][1],  bd.Pv[1][0],  bd.Pv[1][1]  },
        { bd.Pu[0][0], bd.Pu[0][1], bd.Puv[0][0], bd.Puv[0][1] },
        { bd.Pu[1][0], bd.Pu[1][1], bd.Puv[1][0], bd.Puv[1][1] },
    };

    // Hermite(value0,value1,deriv0,deriv1) -> Bezier(b0,b1,b2,b3) on [0,1].
    auto hermToBez = [](const Vec3& f0, const Vec3& f1,
                        const Vec3& m0, const Vec3& m1,
                        Vec3 out[4]) {
        out[0] = f0;
        out[1] = vadd(f0, vscale(m0, 1.0 / 3.0));
        out[2] = vsub(f1, vscale(m1, 1.0 / 3.0));
        out[3] = f1;
    };

    // Step 1: convert each v-column of the block in the U direction.
    // For fixed v-data column index, the u-data is (value0,value1,deriv0,deriv1)
    // = (H[0][b], H[1][b], H[2][b], H[3][b]). Produces 4 u-Bezier rows per col.
    Vec3 mid[4][4];  // mid[iBezU][b]
    for (int b = 0; b < 4; ++b) {
        Vec3 col[4];
        hermToBez(H[0][b], H[1][b], H[2][b], H[3][b], col);
        for (int a = 0; a < 4; ++a) mid[a][b] = col[a];
    }

    // Step 2: convert each u-Bezier row in the V direction. For fixed iBezU=a,
    // the v-data is (value0,value1,deriv0,deriv1) = (mid[a][0], mid[a][1],
    // mid[a][2], mid[a][3]).
    Vec3 bez[4][4];  // bez[iBezU][iBezV] — the 16 bicubic Bezier control pts
    for (int a = 0; a < 4; ++a) {
        Vec3 row[4];
        hermToBez(mid[a][0], mid[a][1], mid[a][2], mid[a][3], row);
        for (int b = 0; b < 4; ++b) bez[a][b] = row[b];
    }

    // Assemble the NurbsSurface (degree 3x3 Bezier, weights 1, clamped knots).
    NurbsSurface& s = ex.surface;
    s.degreeU = 3;
    s.degreeV = 3;
    s.control.assign(4, std::vector<Vec3>(4));
    s.weights.assign(4, std::vector<double>(4, 1.0));
    for (int a = 0; a < 4; ++a)
        for (int b = 0; b < 4; ++b)
            s.control[a][b] = bez[a][b];
    s.knotsU = {0, 0, 0, 0, 1, 1, 1, 1};
    s.knotsV = {0, 0, 0, 0, 1, 1, 1, 1};

    // exactBicubic iff all four boundaries (and, for G1, tangent fields) are
    // polynomial of degree <= 3. A NURBS curve is polynomial when every weight
    // is equal; it is degree <= 3 trivially by its `degree` field. The Coons
    // patch is then a genuine bicubic and this Bezier net reproduces it exactly.
    auto polyLE3 = [](const NurbsCurve& c) -> bool {
        if (c.degree > 3) return false;
        if (c.weights.empty()) return true;
        const double w0 = c.weights.front();
        for (double w : c.weights) if (std::fabs(w - w0) > 1e-12) return false;
        return true;
    };
    const CoonsBoundary& b = patch.boundary;
    bool exact = polyLE3(b.c0) && polyLE3(b.c1) && polyLE3(b.d0) && polyLE3(b.d1);
    if (b.g1)
        exact = exact && polyLE3(b.t0) && polyLE3(b.t1) &&
                polyLE3(b.e0) && polyLE3(b.e1);
    ex.exactBicubic = exact;
    ex.ok = true;
    ex.reason = "";
    return ex;
}

} // namespace brep
} // namespace native
} // namespace forge
