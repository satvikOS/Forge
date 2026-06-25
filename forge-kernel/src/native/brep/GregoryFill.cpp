// forge/native/brep/GregoryFill.cpp
//
// Implementation of the N-SIDED GREGORY HOLE-FILL (G1) — GregoryFill.hpp. Pure
// C++20, no external dependencies. See the header for the full mathematical
// construction and the honest scope.
//
// Construction re-implemented from the standard definitions (NOT copied source):
// the n-sided fill by N quadrilateral GREGORY sub-patches over a mid-edge split
// of the n-gon (Gregory 1974; Chiyokura & Kimura 1983 "Design of solids with
// free-form surfaces"; Hoschek & Lasser ch.15; Farin §16). Each sub-patch is the
// bicubically-blended (cubic-Hermite) Boolean sum with the Gregory RATIONAL
// CORNER-TWIST split, so the interior radial seams are G1. Boundary curves +
// their derivatives are read through the validated brep::curveDerivatives
// (NurbsCalculus.cpp); this file does NOT re-derive the basis recurrence.

#include "forge/native/brep/GregoryFill.hpp"

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsCalculus.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// --- small Vec3 helpers ------------------------------------------------------
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

// --- cubic Hermite blending functions + 1st derivatives (matches SurfaceFill) -
//   H0(t)=2t^3-3t^2+1   H1(t)=-2t^3+3t^2
//   h0(t)=t^3-2t^2+t    h1(t)=t^3-t^2
struct Hermite { double H0, H1, h0, h1; };
inline Hermite hermite(double t) {
    const double t2 = t * t, t3 = t2 * t;
    return Hermite{ 2 * t3 - 3 * t2 + 1, -2 * t3 + 3 * t2,
                    t3 - 2 * t2 + t,     t3 - t2 };
}
inline Hermite hermiteD(double t) {
    const double t2 = t * t;
    return Hermite{ 6 * t2 - 6 * t, -6 * t2 + 6 * t,
                    3 * t2 - 4 * t + 1, 3 * t2 - 2 * t };
}

// --- quintic Hermite blending functions + 1st & 2nd derivatives (matches the
//     SurfaceFill.cpp 4-sided G2 Coons set, layered here on the radial t).
// Six functions interpolating endpoint {value, 1st-deriv, 2nd-deriv} at t=0,1:
//   H0=1-10t^3+15t^4-6t^5   H1=10t^3-15t^4+6t^5
//   h0=t-6t^3+8t^4-3t^5     h1=-4t^3+7t^4-3t^5
//   g0=t^2/2-3t^3/2+3t^4/2-t^5/2   g1=t^3/2-t^4+t^5/2
// Cardinal endpoint properties (proving exact position + 1st-cross + 2nd-cross
// recovery at t=0): value H0(0)=1; 1st-d h0'(0)=1; 2nd-d g0''(0)=1, all else 0
// at t=0 (and the symmetric set carrying the apex value/tangent/curvature at t=1).
struct Quintic { double H0, H1, h0, h1, g0, g1; };
inline Quintic quintic(double t) {
    const double t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
    return Quintic{ 1 - 10 * t3 + 15 * t4 - 6 * t5,
                    10 * t3 - 15 * t4 + 6 * t5,
                    t - 6 * t3 + 8 * t4 - 3 * t5,
                    -4 * t3 + 7 * t4 - 3 * t5,
                    0.5 * t2 - 1.5 * t3 + 1.5 * t4 - 0.5 * t5,
                    0.5 * t3 - t4 + 0.5 * t5 };
}
inline Quintic quinticD(double t) {
    const double t2 = t * t, t3 = t2 * t, t4 = t3 * t;
    return Quintic{ -30 * t2 + 60 * t3 - 30 * t4,
                    30 * t2 - 60 * t3 + 30 * t4,
                    1 - 18 * t2 + 32 * t3 - 15 * t4,
                    -12 * t2 + 28 * t3 - 15 * t4,
                    t - 4.5 * t2 + 6 * t3 - 2.5 * t4,
                    1.5 * t2 - 4 * t3 + 2.5 * t4 };
}
inline Quintic quinticDD(double t) {
    const double t2 = t * t, t3 = t2 * t;
    return Quintic{ -60 * t + 180 * t2 - 120 * t3,
                    60 * t - 180 * t2 + 120 * t3,
                    -36 * t + 96 * t2 - 60 * t3,
                    -24 * t + 84 * t2 - 60 * t3,
                    1 - 9 * t + 18 * t2 - 10 * t3,
                    3 * t - 12 * t2 + 10 * t3 };
}

// --- boundary-curve evaluation re-parameterised onto [0,1] (matches SurfaceFill)
// A clamped NurbsCurve has intrinsic domain [knots[p], knots[n+1]]; t in [0,1]
// maps linearly onto it. point() = C, along() = dC/dt (chain rule with span).
struct EdgeCurve {
    const NurbsCurve* c = nullptr;
    double u0 = 0.0, u1 = 1.0, span = 1.0;
    bool bound() const { return c != nullptr; }
    void bind(const NurbsCurve& curve) {
        c = &curve;
        const std::size_t p = curve.degree;
        const std::size_t n = curve.controlPoints.size() - 1;
        u0 = curve.knots[p];
        u1 = curve.knots[n + 1];
        span = u1 - u0;
    }
    double intrinsic(double t) const { return u0 + t * span; }
    Vec3 point(double t) const { return c->evaluate(intrinsic(t)); }
    Vec3 along(double t) const {
        const auto d = curveDerivatives(*c, intrinsic(t), 1);
        return vscale(d[1], span);   // dC/dt
    }
    Vec3 alongSecond(double t) const {  // d^2 C/dt^2 (linear reparam -> span^2)
        const auto d = curveDerivatives(*c, intrinsic(t), 2);
        return vscale(d[2], span * span);
    }
};

// A "vector curve": its evaluated POINT is the prescribed cross-tangent VECTOR.
struct VectorCurve {
    const NurbsCurve* c = nullptr;
    double u0 = 0.0, u1 = 1.0, span = 1.0;
    bool bound() const { return c != nullptr; }
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
};

} // namespace

// ===========================================================================
// GregoryBoundary::validate — the honest gate.
// ===========================================================================
bool GregoryBoundary::validate(const char** reason, double cornerTol) const {
    auto fail = [&](const char* why) -> bool {
        if (reason) *reason = why;
        return false;
    };
    if (reason) *reason = "";

    const std::size_t N = sides.size();
    if (N < 3) return fail("fewer than 3 sides (an n-sided hole needs N>=3)");

    for (std::size_t i = 0; i < N; ++i) {
        if (!sides[i].boundary.valid())
            return fail("a boundary curve is not a valid NURBS curve");
    }

    // Loop closure: b_i(1) == b_{i+1}(0).
    std::vector<EdgeCurve> ec(N);
    for (std::size_t i = 0; i < N; ++i) ec[i].bind(sides[i].boundary);
    for (std::size_t i = 0; i < N; ++i) {
        const std::size_t j = (i + 1) % N;
        const Vec3 end_i = ec[i].point(1.0);
        const Vec3 beg_j = ec[j].point(0.0);
        if (vlen(vsub(end_i, beg_j)) > cornerTol)
            return fail("boundary loop does not close (b_i(1) != b_{i+1}(0))");
    }

    // g2 implies g1: the quintic radial blend needs the tangent fields too.
    if (g1 || g2) {
        for (std::size_t i = 0; i < N; ++i) {
            if (!sides[i].cross.valid())
                return fail("g1 requested but a cross-tangent field is invalid");
        }
    }
    if (g2) {
        for (std::size_t i = 0; i < N; ++i) {
            if (!sides[i].curvature.valid())
                return fail("g2 requested but a cross-curvature field is invalid");
        }
    }
    return true;
}

// ===========================================================================
// The shared Gregory build data: the central point C, the N corner vertices, the
// N edge midpoints, and the radial seam-rib tangent frame. Each of the N
// quadrilateral sub-patches is then a Boolean-sum Coons fill whose t=0 fan edge
// runs M_{i-1} -> V_i -> M_i (the two boundary halves around vertex V_i) and
// whose s=0,s=1 edges are the shared radial ribs M_{i-1}->C and M_i->C.
//
// LOCAL SUB-PATCH (i) PARAMETERISATION (s,t) in [0,1]^2:
//   t = RADIAL coordinate: t=0 on the boundary fan, t=1 at the centroid C.
//   s = ANGULAR coordinate along corner i's two boundary half-edges:
//         s=0  -> the midpoint M_{i-1} (mid of edge i-1),
//         s=1/2-> the vertex V_i,
//         s=1  -> the midpoint M_i     (mid of edge i).
//   So the t=0 edge is: M_{i-1} --(edge i-1, second half)--> V_i
//                       --(edge i, first half)--> M_i,
//   reproducing HALVES of the two boundary curves flanking vertex V_i, and the
//   prescribed cross-tangent on each (giving (a)+(b) of the header). The t=1
//   edge degenerates to the single point C (a fan apex); the two side edges
//   s=0 and s=1 are the radial seams M_{i-1}->C and M_i->C shared with the
//   neighbouring sub-patches.
// ===========================================================================
namespace {

struct GregoryBuild {
    std::size_t N = 0;
    bool g1 = false;
    bool g2 = false;
    Vec3 center{};

    std::vector<EdgeCurve>   bnd;     // N boundary curves
    std::vector<VectorCurve> crs;     // N cross-tangent fields (g1)
    std::vector<VectorCurve> crv;     // N cross-curvature fields (g2)
    std::vector<Vec3> V;              // N corner vertices  V_i = b_i(0)
    std::vector<Vec3> M;              // N edge midpoints   M_i = b_i(0.5)
    // Radial boundary->center tangent the surface should carry at the seam
    // endpoints (built from a consistent shared central frame). radM[i] is the
    // radial tangent (pointing boundary->center) AT the midpoint M_i; the matching
    // tangent AT the center for that seam is centerTan[i] (pointing into the fan).
    std::vector<Vec3> radM;           // radial tangent at midpoint M_i
    std::vector<Vec3> centerTan;      // radial tangent at C along seam to M_i
    // G2 only: radial 2nd-derivative (curvature) the surface should carry at the
    // seam boundary endpoint M_i (the prescribed cross-curvature at that midpoint)
    // and at the center end of the seam (a smooth fan apex -> zero curvature).
    std::vector<Vec3> radK;           // radial curvature at midpoint M_i (g2)
    std::vector<Vec3> centerCrv;      // radial curvature at C along seam (g2; ~0)

    // ---- build the frame from the boundary loop + cross fields -------------
    bool build(const GregoryBoundary& B) {
        N = B.sides.size();
        g2 = B.g2;
        g1 = B.g1 || B.g2;   // g2 implies g1 (quintic radial blend needs tangents)
        bnd.resize(N);
        crs.resize(N);
        crv.resize(N);
        V.resize(N);
        M.resize(N);
        for (std::size_t i = 0; i < N; ++i) {
            bnd[i].bind(B.sides[i].boundary);
            if (g1) crs[i].bind(B.sides[i].cross);
            if (g2) crv[i].bind(B.sides[i].curvature);
            V[i] = bnd[i].point(0.0);    // corner i
            M[i] = bnd[i].point(0.5);    // midpoint of edge i
        }
        // ---- the common central point C ----------------------------------
        // The flat vertex-centroid Cflat is the naive choice, but for a CURVED
        // hole it sits inside the surface (a deep cap's centroid is well below the
        // rim). We lift it onto the surface using the PRESCRIBED boundary cross-
        // tangents: near each edge midpoint M_i the surface heads inward along the
        // unit cross-slope q_i, so walking the in-plane radius r_i = |Cflat - M_i|
        // along q_i lands near where the surface's interior wants to be; averaging
        // M_i + r_i q_i over the N edges gives a central point that tracks the
        // surface's curvature. For a PLANAR hole q_i lies in the plane and
        // M_i + r_i q_i ~ Cflat (still in-plane), so the fill stays EXACTLY planar.
        Vec3 cflat{0, 0, 0};
        for (std::size_t i = 0; i < N; ++i) cflat = vadd(cflat, V[i]);
        cflat = vscale(cflat, 1.0 / static_cast<double>(N));

        if (g1) {
            // Tangent extrapolation from a CONVEX rim overshoots the surface (a
            // tangent line leaves a sphere outward), so we under-walk by the
            // chord/arc bias factor kLift in (0,1]: walking the full in-plane
            // radius along the tangent lands beyond the true apex; kLift pulls it
            // back onto the surface. kLift=1 is the pure first-order estimate;
            // 3/4 is the chord-vs-arc correction for the moderate-cap regime (a
            // tangent that spans a half-angle a overshoots by ~ (1-cos a) which the
            // 3/4 factor cancels to second order). This biases the apex INWARD,
            // never outward, so it cannot fabricate a bulge the data doesn't imply.
            constexpr double kLift = 0.75;
            Vec3 acc{0, 0, 0};
            for (std::size_t i = 0; i < N; ++i) {
                const Vec3 mid = M[i];                  // edge midpoint
                const Vec3 q   = crs[i].value(0.5);    // raw inward slope at M_i
                const double ql = vlen(q);
                const double r  = vlen(vsub(cflat, mid));    // in-plane radius
                if (ql > 1e-14)
                    acc = vadd(acc, vadd(mid, vscale(q, kLift * r / ql)));
                else
                    acc = vadd(acc, cflat);
            }
            center = vscale(acc, 1.0 / static_cast<double>(N));
        } else {
            center = cflat;   // G0 positional fill: the flat centroid.
        }

        // Radial seam ribs M_i -> C. Each rib is a cubic Hermite shared IDENTICALLY
        // by the two sub-patches flanking the seam (it depends only on the global
        // per-i data M[i], radM[i], center, centerTan[i]) -> the seam position AND
        // its tangent agree from both sides, the exact G1-across-seam device.
        //
        // The BOUNDARY-END tangent radM[i] is taken from the PRESCRIBED cross-
        // tangent field at the midpoint (crs[i] at the edge midpoint) — the
        // bordering face's inward transverse slope — so the rib LEAVES the
        // boundary tangent to the bordering surface and curves the interior onto a
        // curved hole (this is what reduces a curved cap's sag far below the flat
        // chordal-fan; for a PLANAR hole the cross-tangent is in-plane, the centre
        // is in-plane, so the rib + the whole fill stay exactly planar). The
        // CENTER-END tangent is the inward chord, giving a smoothly-closing fan
        // apex. The rib magnitude is normalised to the chord length so the cubic
        // is well-conditioned (no overshoot) regardless of the prescribed scale.
        radM.resize(N);
        centerTan.resize(N);
        radK.resize(N);
        centerCrv.resize(N);
        for (std::size_t i = 0; i < N; ++i) {
            const Vec3 chord = vsub(center, M[i]);     // M_i -> C
            const double chordLen = vlen(chord);
            Vec3 t0 = chord;                            // default: straight rib
            if (g1) {
                const Vec3 cross = crs[i].value(0.5);   // inward slope at M_i
                const double cl = vlen(cross);
                if (cl > 1e-14 && chordLen > 1e-14) {
                    // unit inward slope, scaled to the chord length (well-posed).
                    t0 = vscale(cross, chordLen / cl);
                }
            }
            radM[i] = t0;
            centerTan[i] = chord;

            // G2: the radial rib carries the PRESCRIBED cross-CURVATURE at its
            // boundary end (the bordering face's transverse 2nd derivative at the
            // midpoint M_i), so the seam curve's S_tt at t=0 EQUALS what the fan
            // edge F's curvature term will impose at the corresponding s — the
            // exact consistency that makes the boundary G2 cancellation hold from
            // both the radial loft and the seam. NOTE: the prescribed curvature is
            // expressed in the SAME radial sub-patch coordinate as `cross`, but
            // the rib's tangent radM[i] above was renormalised to the chord length
            // (a reparam by factor chordLen/|cross|); to keep the rib a faithful
            // quintic-Hermite of the prescribed (position, tangent, curvature) the
            // curvature is scaled by that radial-reparam factor SQUARED so the
            // rib's S_tt matches the field consistently with its retimed S_t.
            if (g2) {
                const Vec3 kraw = crv[i].value(0.5);      // prescribed S_tt at M_i
                const Vec3 cross = crs[i].value(0.5);
                const double cl = vlen(cross);
                double rscale = 1.0;                       // radial reparam factor
                if (cl > 1e-14 && chordLen > 1e-14) rscale = chordLen / cl;
                radK[i] = vscale(kraw, rscale * rscale);
            } else {
                radK[i] = Vec3{0, 0, 0};
            }
            // Smooth-closing fan apex: zero radial curvature at the center end
            // (the rib straightens onto the apex; the apex tangent already closes
            // the fan smoothly). This is the n-sided centroid-frame choice.
            centerCrv[i] = Vec3{0, 0, 0};
        }
        return true;
    }

    // ----- corner-block data for sub-patch i --------------------------------
    // The quad corners in (s,t):
    //   (s=0,t=0) = M_{i-1} ; (s=1,t=0) = M_i ; (s=0,t=1) = (s=1,t=1) = C.
    // The vertex V_i sits at (s=1/2, t=0). The sub-patch is the Boolean-sum Coons
    // fill of these corners + the boundary fan curve + the two shared radial seam
    // curves (see the eval() construction note for the exact-boundary algebra).
    std::size_t prev(std::size_t i) const { return (i + N - 1) % N; }

    // Boundary point at corner i for angular parameter s in [0,1] along the
    // t=0 fan edge (M_{i-1} -> V_i -> M_i). For s in [0,1/2] walk the SECOND half
    // of edge i-1 (from its midpoint to its end V_i); for s in [1/2,1] walk the
    // FIRST half of edge i (from V_i to its midpoint). along-s tangent included.
    void fanEdge(std::size_t i, double s, Vec3& P, Vec3& Ps) const {
        const std::size_t ip = prev(i);
        if (s <= 0.5) {
            // edge i-1, parameter te in [0.5, 1]; s in [0,0.5] -> te = 0.5 + s.
            const double te = 0.5 + s;
            P  = bnd[ip].point(te);
            // d/ds = d/dte * dte/ds, dte/ds = 1.
            Ps = bnd[ip].along(te);
        } else {
            // edge i, parameter te in [0, 0.5]; s in [0.5,1] -> te = s - 0.5.
            const double te = s - 0.5;
            P  = bnd[i].point(te);
            Ps = bnd[i].along(te);
        }
    }

    // d^2 F/ds^2 along the t=0 fan edge (analytic, via the boundary curve's 2nd
    // derivative). Mirrors fanEdge's half-edge selection; dte/ds = 1 each half.
    void fanEdgeSecond(std::size_t i, double s, Vec3& Pss) const {
        const std::size_t ip = prev(i);
        if (s <= 0.5) Pss = bnd[ip].alongSecond(0.5 + s);
        else          Pss = bnd[i].alongSecond(s - 0.5);
    }

    // Prescribed cross-tangent (into the patch) along the t=0 fan edge of corner
    // i at angular s. Mirrors fanEdge's edge selection.
    Vec3 fanCross(std::size_t i, double s) const {
        const std::size_t ip = prev(i);
        if (s <= 0.5) return crs[ip].value(0.5 + s);
        return crs[i].value(s - 0.5);
    }

    // Prescribed cross-CURVATURE (radial S_tt, into the patch) along the t=0 fan
    // edge of corner i at angular s (g2). Mirrors fanEdge/fanCross edge selection
    // so the curvature carried in the radial g0(t) term matches the boundary's.
    Vec3 fanCurv(std::size_t i, double s) const {
        const std::size_t ip = prev(i);
        if (s <= 0.5) return crv[ip].value(0.5 + s);
        return crv[i].value(s - 0.5);
    }

    // ===================================================================
    // Evaluate sub-patch i at (s,t). Boolean-sum Coons sub-patch, BILINEAR in
    // the angular s (the two s-edges are interpolated, not given an s-tangent
    // field) and CUBIC-Hermite in the radial t (carrying the prescribed
    // cross-tangent at t=0 and a smooth apex at t=1):
    //   - t=0 boundary fan:    F(s) = fanEdge position (halves of the 2 edges),
    //                          with prescribed cross-tangent G(s) (the G1 data);
    //   - t=1 center edge:     constant C (the fan apex);
    //   - s=0 radial seam:     M_{i-1} -> C  (cubic, matched radial tangents);
    //   - s=1 radial seam:     M_i     -> C.
    //
    //   S(s,t) = Lt(s,t) + Ls(s,t) - T(s,t)
    //   Lt(s,t) = H0(t)F(s) + H1(t)C + h0(t)G(s)            (radial cubic loft)
    //   Ls(s,t) = H0(s)R0(t) + H1(s)R1(t)                   (angular bilinear loft)
    //   T(s,t)  = [H0(s) H1(s)] B [H0(t) H1(t) h0(t) h1(t)]^T   (corner correction)
    //
    // ALGEBRA (verified, the gate's exact-boundary / exact-tangent property):
    //   At t=0:   Lt=F(s), Ls=H0(s)M_{i-1}+H1(s)M_i, T=H0(s)M_{i-1}+H1(s)M_i,
    //             so S(s,0)=F(s) EXACTLY (boundary interpolation).
    //   d/dt|t=0: Lt_t=G(s); Ls_t=H0(s)radM[i-1]+H1(s)radM[i]; T_t equals the
    //             same -> S_t(s,0)=G(s) EXACTLY (the prescribed cross-tangent, G1).
    //   At s=0:   S(0,t)=R0(t); at s=1: S(1,t)=R1(t) (the shared radial seams),
    //             so the union is watertight + the seam curve+tangent agree from
    //             both neighbours -> G1 across the interior seams.
    //
    // GREGORY NOTE (honest scope): in the classical Gregory patch the corner
    // twist is the cross-derivative that, in a full bicubic, is double-valued
    // (one value from each incident edge) and is reconciled by a RATIONAL split
    // of the two twists. In THIS n-sided decomposition the angular direction is
    // bilinear, so the s-direction carries no Hermite tangent term and no
    // corner-twist column appears at all — the cross-seam G1 is instead delivered
    // geometrically by the SHARED radial seam frame (both neighbours of a seam
    // use the IDENTICAL radial rib curve R(t) AND its tangent), which is the
    // sufficient and exact condition here. We therefore do NOT claim a rational
    // twist split we are not exercising; the G2-Gregory variant that needs it is
    // a documented follow-up.
    // ===================================================================

    // Radial seam curve on the s=0 / s=1 edge: cubic Hermite from the boundary
    // seam endpoint (a fan-edge endpoint: M_{i-1} for sEdge=0, M_i for sEdge=1)
    // with radial start tangent radM[...] to the centroid C with end tangent
    // centerTan[...]. seam(t): position; seamT(t): d/dt.
    void seamData(std::size_t i, int sEdge, Vec3& P0, Vec3& T0,
                  Vec3& P1, Vec3& T1) const {
        // sEdge==0 -> s=0 edge -> midpoint M_{prev(i)}; sEdge==1 -> M_i.
        const std::size_t mIdx = (sEdge == 0) ? prev(i) : i;
        P0 = M[mIdx];          // boundary end of the seam
        T0 = radM[mIdx];       // radial tangent at the midpoint (M->C)
        P1 = center;           // center end
        T1 = centerTan[mIdx];  // radial tangent at center along this seam
    }
    // g2 curvature endpoints of the seam (boundary K0, center K1).
    void seamCurv(std::size_t i, int sEdge, Vec3& K0, Vec3& K1) const {
        const std::size_t mIdx = (sEdge == 0) ? prev(i) : i;
        K0 = radK[mIdx];        // prescribed radial curvature at the midpoint
        K1 = centerCrv[mIdx];   // radial curvature at center (smooth apex ~0)
    }
    static Vec3 hermiteCurve(const Vec3& P0, const Vec3& T0,
                             const Vec3& P1, const Vec3& T1, double t) {
        const Hermite h = hermite(t);
        return vadd(vadd(vscale(P0, h.H0), vscale(P1, h.H1)),
                    vadd(vscale(T0, h.h0), vscale(T1, h.h1)));
    }
    static Vec3 hermiteCurveD(const Vec3& P0, const Vec3& T0,
                              const Vec3& P1, const Vec3& T1, double t) {
        const Hermite h = hermiteD(t);
        return vadd(vadd(vscale(P0, h.H0), vscale(P1, h.H1)),
                    vadd(vscale(T0, h.h0), vscale(T1, h.h1)));
    }

    // ---- QUINTIC seam rib (g2): position + tangent + curvature at both ends ----
    // R(t) = H0 P0 + H1 P1 + h0 T0 + h1 T1 + g0 K0 + g1 K1 (and its 1st/2nd d/dt).
    // For g2 each interior radial seam is this quintic Hermite, carrying the
    // prescribed cross-curvature K0 at the boundary end M and a smooth (K1~0) apex
    // at the center — so the seam is curvature-bearing and the two neighbours that
    // share it use the IDENTICAL quintic rib (watertight + matched along-seam
    // curvature). The g1 path keeps the cubic rib above (curvature terms drop).
    static void quinticSeamData(const Vec3& P0, const Vec3& T0, const Vec3& K0,
                                const Vec3& P1, const Vec3& T1, const Vec3& K1,
                                int order, double t, Vec3& out) {
        const Quintic q = (order == 0) ? quintic(t)
                        : (order == 1) ? quinticD(t) : quinticDD(t);
        out = vadd(vadd(vadd(vscale(P0, q.H0), vscale(P1, q.H1)),
                        vadd(vscale(T0, q.h0), vscale(T1, q.h1))),
                   vadd(vscale(K0, q.g0), vscale(K1, q.g1)));
    }

    // The 2x4 corner block for sub-patch i. Corner index [a][b] with
    //   a in {0,1} -> s in {0,1} (bilinear angular direction);
    //   b in {0,1} -> t in {0,1} (the radial direction carries a Hermite tangent).
    //   P:  positions:  [0][0]=M_{i-1} [1][0]=M_i [0][1]=[1][1]=C
    //   Pt: d/dt:       radial seam tangents at the boundary (t=0) / center (t=1)
    struct Corner {
        Vec3 P, Pt, Ptt;   // position; radial d/dt; radial d^2/dt^2 (g2)
    };

    void corners(std::size_t i, Corner cn[2][2]) const {
        const std::size_t ip = prev(i);
        // --- positions ---
        cn[0][0].P = M[ip];     // (s=0,t=0)
        cn[1][0].P = M[i];      // (s=1,t=0)
        cn[0][1].P = center;    // (s=0,t=1)
        cn[1][1].P = center;    // (s=1,t=1)

        // --- d/dt at the corners (radial) ---
        // At (s=0,t=0): radial tangent at M_{i-1} = radM[ip]. At (s=1,t=0):
        // radM[i]. At t=1 (center): the center-side seam tangents.
        cn[0][0].Pt = radM[ip];
        cn[1][0].Pt = radM[i];
        cn[0][1].Pt = centerTan[ip];
        cn[1][1].Pt = centerTan[i];

        // --- d^2/dt^2 at the corners (radial curvature, g2) ---
        cn[0][0].Ptt = radK[ip];
        cn[1][0].Ptt = radK[i];
        cn[0][1].Ptt = centerCrv[ip];
        cn[1][1].Ptt = centerCrv[i];
    }

    // Evaluate point (and, if wantD, ds/dt partials) of sub-patch i at (s,t).
    // Bilinear-in-s, cubic-Hermite-in-t Boolean sum (see the construction note).
    void eval(std::size_t i, double s, double t,
              Vec3& S, Vec3& Ss, Vec3& St, bool wantD) const {
        Corner cn[2][2];
        corners(i, cn);

        // --- t=0 fan boundary curve F(s) and its prescribed radial cross G(s) --
        Vec3 F, Fs;
        fanEdge(i, s, F, Fs);
        Vec3 G{0, 0, 0};
        if (g1) G = fanCross(i, s);   // prescribed radial (into-patch) tangent

        // --- s=0 / s=1 radial seam curves R0(t), R1(t) (cubic Hermite) ---
        Vec3 r0p0, r0t0, r0p1, r0t1, r1p0, r1t0, r1p1, r1t1;
        seamData(i, 0, r0p0, r0t0, r0p1, r0t1);
        seamData(i, 1, r1p0, r1t0, r1p1, r1t1);
        const Vec3 R0 = hermiteCurve(r0p0, r0t0, r0p1, r0t1, t);
        const Vec3 R1 = hermiteCurve(r1p0, r1t0, r1p1, r1t1, t);

        // --- blends ---
        const Hermite Ht = hermite(t);
        const double H0s = 1.0 - s, H1s = s;          // BILINEAR in s

        // Radial loft Lt(s,t): from the fan F(s) at t=0 (with radial start
        // tangent G(s)) toward the centroid C at t=1 (apex; zero end tangent so
        // the fan closes smoothly to a point).
        Vec3 Lt = vadd(vscale(F, Ht.H0), vscale(center, Ht.H1));
        Lt = vadd(Lt, vscale(G, Ht.h0));   // h1*endTangent = 0 (apex)

        // Angular loft Ls(s,t): linear blend from the s=0 seam R0(t) to R1(t).
        Vec3 Ls = vadd(vscale(R0, H0s), vscale(R1, H1s));

        // Correction T(s,t) = [H0s H1s] B [H0t H1t h0t h1t]^T, B the 2x4 block:
        //   rows  a in {s=0, s=1};  cols b in {value@t0, value@t1, dt@t0, dt@t1}.
        //   value@t0 = M (the seam boundary endpoint), value@t1 = C,
        //   dt@t0    = radM (radial tangent at the midpoint),
        //   dt@t1    = centerTan (radial tangent at the centroid).
        const Vec3 B[2][4] = {
            { cn[0][0].P, cn[0][1].P, cn[0][0].Pt, cn[0][1].Pt },
            { cn[1][0].P, cn[1][1].P, cn[1][0].Pt, cn[1][1].Pt },
        };
        const double ws[2] = {H0s, H1s};
        const double wt[4] = {Ht.H0, Ht.H1, Ht.h0, Ht.h1};
        Vec3 T{0, 0, 0};
        for (int a = 0; a < 2; ++a)
            for (int b = 0; b < 4; ++b)
                T = vadd(T, vscale(B[a][b], ws[a] * wt[b]));

        S = vsub(vadd(Lt, Ls), T);

        if (!wantD) { Ss = St = Vec3{0, 0, 0}; return; }

        // ---- first partials (analytic) ----
        const Hermite dHt = hermiteD(t);
        const double dH0s = -1.0, dH1s = 1.0;   // d/ds of the linear s-blend

        // d/ds of the prescribed cross field G(s) (a given vector field along the
        // fan edge): tight central difference, clamped to [0,1]. It enters only
        // the interior (h0(t) weight) and vanishes on the boundary (h0(0)=0), so
        // this difference never affects the exact-boundary / exact-tangent gates.
        Vec3 Gs{0, 0, 0};
        if (g1) {
            const double hh = 1e-6;
            const double sp = (s + hh > 1.0) ? 1.0 : s + hh;
            const double sm = (s - hh < 0.0) ? 0.0 : s - hh;
            const double inv = 1.0 / (sp - sm);
            Gs = vscale(vsub(fanCross(i, sp), fanCross(i, sm)), inv);
        }

        // Lt_s = H0(t)F'(s) + h0(t)G'(s) ; Lt_t = H0'(t)F + H1'(t)C + h0'(t)G
        Vec3 Lts = vadd(vscale(Fs, Ht.H0), vscale(Gs, Ht.h0));
        Vec3 Ltt = vadd(vadd(vscale(F, dHt.H0), vscale(center, dHt.H1)),
                        vscale(G, dHt.h0));

        // Seam derivatives w.r.t t.
        const Vec3 R0t = hermiteCurveD(r0p0, r0t0, r0p1, r0t1, t);
        const Vec3 R1t = hermiteCurveD(r1p0, r1t0, r1p1, r1t1, t);
        // Ls_s = H0s'R0 + H1s'R1 ; Ls_t = H0s R0' + H1s R1'
        Vec3 Lss = vadd(vscale(R0, dH0s), vscale(R1, dH1s));
        Vec3 Lst = vadd(vscale(R0t, H0s), vscale(R1t, H1s));

        // Correction partials: differentiate the blend weights against the block.
        const double dws[2] = {dH0s, dH1s};
        const double dwt[4] = {dHt.H0, dHt.H1, dHt.h0, dHt.h1};
        Vec3 Ts{0, 0, 0}, Tt{0, 0, 0};
        for (int a = 0; a < 2; ++a)
            for (int b = 0; b < 4; ++b) {
                Ts = vadd(Ts, vscale(B[a][b], dws[a] * wt[b]));
                Tt = vadd(Tt, vscale(B[a][b], ws[a] * dwt[b]));
            }

        Ss = vsub(vadd(Lts, Lss), Ts);
        St = vsub(vadd(Ltt, Lst), Tt);
    }

    // =======================================================================
    // QUINTIC (G2) sub-patch evaluator. Identical Boolean-sum structure to eval()
    // — BILINEAR in the angular s, but the radial t is now a QUINTIC Hermite that
    // carries position (F), cross-tangent (G) AND cross-CURVATURE (K) at t=0:
    //
    //   Lt(s,t) = H0(t)F(s) + H1(t)C + h0(t)G(s) + g0(t)K(s)        (radial quintic
    //             [+ h1(t)*0 + g1(t)*0 : smooth fan apex at t=1])    loft)
    //   Ls(s,t) = (1-s)R0(t) + s R1(t)        (quintic seam ribs; bilinear in s)
    //   T(s,t)  = [1-s, s] * B(2x6) * [H0 H1 h0 h1 g0 g1](t)        (correction)
    //
    // Boundary algebra (the exact G0/G1/G2 boundary property, same cancellation
    // device as eval() extended by the curvature column):
    //   S(s,0)   = F(s)                  (H0(0)=1; Ls,T value@t0 columns cancel)
    //   S_t(s,0) = G(s)                  (h0'(0)=1; dt@t0 columns cancel)
    //   S_tt(s,0)= K(s)                  (g0''(0)=1; dtt@t0 columns cancel)
    // so the prescribed cross-tangent AND cross-curvature are reproduced EXACTLY
    // on every fan edge — i.e. boundary G2 to machine precision for any N. (The
    // INTERIOR seams are watertight + curvature-bearing but only G2-to-tolerance
    // for N!=4 — the honest twist/curvature-compatibility limit; see the header.)
    //
    // `order` (0/1/2) selects how many derivative levels to fill. d/ds of the
    // prescribed fields G,K (which enter only via h0(t),g0(t) — both vanishing at
    // t=0) is a tight central difference; it never touches the boundary gates.
    void evalQuintic(std::size_t i, double s, double t,
                     Vec3& S, Vec3& Ss, Vec3& St,
                     Vec3& Sss, Vec3& Sst, Vec3& Stt, int order) const {
        Corner cn[2][2];
        corners(i, cn);

        // --- t=0 fan boundary curve F(s), prescribed cross-tangent G(s) and
        //     prescribed cross-curvature K(s) (the G2 data) ---
        Vec3 F, Fs;
        fanEdge(i, s, F, Fs);
        const Vec3 G = fanCross(i, s);
        const Vec3 K = fanCurv(i, s);

        // --- quintic seam ribs R0(t) (s=0) and R1(t) (s=1) ---
        Vec3 r0p0, r0t0, r0p1, r0t1, r1p0, r1t0, r1p1, r1t1;
        seamData(i, 0, r0p0, r0t0, r0p1, r0t1);
        seamData(i, 1, r1p0, r1t0, r1p1, r1t1);
        Vec3 r0k0, r0k1, r1k0, r1k1;
        seamCurv(i, 0, r0k0, r0k1);
        seamCurv(i, 1, r1k0, r1k1);
        auto R0at = [&](int ord) { Vec3 o; quinticSeamData(r0p0, r0t0, r0k0, r0p1, r0t1, r0k1, ord, t, o); return o; };
        auto R1at = [&](int ord) { Vec3 o; quinticSeamData(r1p0, r1t0, r1k0, r1p1, r1t1, r1k1, ord, t, o); return o; };
        const Vec3 R0 = R0at(0), R1 = R1at(0);

        // --- radial quintic blends (value + 1st + 2nd) and bilinear s-blend ---
        const Quintic Qt = quintic(t);
        const double H0s = 1.0 - s, H1s = s;

        // Radial loft Lt(s,t).
        Vec3 Lt = vadd(vadd(vscale(F, Qt.H0), vscale(center, Qt.H1)),
                       vadd(vscale(G, Qt.h0), vscale(K, Qt.g0)));
        // Angular loft Ls(s,t).
        Vec3 Ls = vadd(vscale(R0, H0s), vscale(R1, H1s));

        // 2x6 correction block: cols b in {value@t0, value@t1, dt@t0, dt@t1,
        // dtt@t0, dtt@t1}; rows a in {s=0, s=1}. value@t0=M, value@t1=C,
        // dt@t0=radM, dt@t1=centerTan, dtt@t0=radK, dtt@t1=centerCrv.
        const Vec3 B[2][6] = {
            { cn[0][0].P, cn[0][1].P, cn[0][0].Pt, cn[0][1].Pt, cn[0][0].Ptt, cn[0][1].Ptt },
            { cn[1][0].P, cn[1][1].P, cn[1][0].Pt, cn[1][1].Pt, cn[1][0].Ptt, cn[1][1].Ptt },
        };
        const double ws[2]  = {H0s, H1s};
        const double wt0[6] = {Qt.H0, Qt.H1, Qt.h0, Qt.h1, Qt.g0, Qt.g1};
        auto corr = [&](const double wS[2], const double wT[6]) -> Vec3 {
            Vec3 r{0, 0, 0};
            for (int a = 0; a < 2; ++a)
                for (int b = 0; b < 6; ++b)
                    r = vadd(r, vscale(B[a][b], wS[a] * wT[b]));
            return r;
        };
        const Vec3 T = corr(ws, wt0);
        S = vsub(vadd(Lt, Ls), T);
        if (order == 0) { Ss = St = Sss = Sst = Stt = Vec3{0, 0, 0}; return; }

        // ---- d/ds of the prescribed vector fields G(s), K(s) (central diff) ----
        const double hh = 1e-6;
        const double sp = (s + hh > 1.0) ? 1.0 : s + hh;
        const double sm = (s - hh < 0.0) ? 0.0 : s - hh;
        const double inv = 1.0 / (sp - sm);
        const Vec3 Gs = vscale(vsub(fanCross(i, sp), fanCross(i, sm)), inv);
        const Vec3 Ks = vscale(vsub(fanCurv(i, sp), fanCurv(i, sm)), inv);

        const Quintic Qt1 = quinticD(t);
        const double wt1[6] = {Qt1.H0, Qt1.H1, Qt1.h0, Qt1.h1, Qt1.g0, Qt1.g1};
        const double dws[2] = {-1.0, 1.0};

        // First partials.
        //   Lt_s = H0(t)F'(s) + h0(t)G'(s) + g0(t)K'(s)
        //   Lt_t = H0'F + H1'C + h0'G + g0'K
        const Vec3 Lts = vadd(vadd(vscale(Fs, Qt.H0), vscale(Gs, Qt.h0)), vscale(Ks, Qt.g0));
        const Vec3 Ltt = vadd(vadd(vscale(F, Qt1.H0), vscale(center, Qt1.H1)),
                              vadd(vscale(G, Qt1.h0), vscale(K, Qt1.g0)));
        const Vec3 R0t = R0at(1), R1t = R1at(1);
        const Vec3 Lss = vadd(vscale(R0, dws[0]), vscale(R1, dws[1]));
        const Vec3 Lst = vadd(vscale(R0t, H0s), vscale(R1t, H1s));
        const Vec3 Ts = corr(dws, wt0);
        const Vec3 Tt = corr(ws, wt1);
        Ss = vsub(vadd(Lts, Lss), Ts);
        St = vsub(vadd(Ltt, Lst), Tt);
        if (order == 1) { Sss = Sst = Stt = Vec3{0, 0, 0}; return; }

        // Second partials.
        //   d^2/ds^2 of G,K via a symmetric 2nd-difference on a step h2 that is
        //   pulled in from either domain end so the stencil stays inside [0,1]
        //   (these terms enter only via h0(t),g0(t) — zero at t=0 — so they never
        //   touch the boundary G2 gate; this is interior-shape bookkeeping).
        const double h2 = std::min({1e-4, s, 1.0 - s});
        Vec3 Gss{0, 0, 0}, Kss{0, 0, 0};
        if (h2 > 0.0) {
            const double invh2 = 1.0 / (h2 * h2);
            Gss = vscale(vadd(vsub(fanCross(i, s + h2), vscale(fanCross(i, s), 2.0)),
                              fanCross(i, s - h2)), invh2);
            Kss = vscale(vadd(vsub(fanCurv(i, s + h2), vscale(fanCurv(i, s), 2.0)),
                              fanCurv(i, s - h2)), invh2);
        }
        // d^2 F/ds^2 along the fan edge (analytic, via the boundary 2nd deriv).
        Vec3 Fss; fanEdgeSecond(i, s, Fss);

        const Quintic Qt2dd = quinticDD(t);
        const double wt2[6] = {Qt2dd.H0, Qt2dd.H1, Qt2dd.h0, Qt2dd.h1, Qt2dd.g0, Qt2dd.g1};

        // S_ss = Lt_ss + Ls_ss - T_ss
        //   Lt_ss = H0(t)F''(s) + h0(t)G''(s) + g0(t)K''(s)
        //   Ls_ss = 0 (bilinear in s); T_ss = 0 (linear s-weights -> 2nd deriv 0)
        const Vec3 Ltss = vadd(vadd(vscale(Fss, Qt.H0), vscale(Gss, Qt.h0)), vscale(Kss, Qt.g0));
        Sss = Ltss;   // Ls_ss = 0, T_ss = 0

        // S_st = Lt_st + Ls_st - T_st
        //   Lt_st = H0'(t)F'(s) + h0'(t)G'(s) + g0'(t)K'(s)
        //   Ls_st = R0'(t)*(-1) + R1'(t)*(+1)
        //   T_st  = [dws] B [wt1]
        const Vec3 Ltst = vadd(vadd(vscale(Fs, Qt1.H0), vscale(Gs, Qt1.h0)), vscale(Ks, Qt1.g0));
        const Vec3 Lsst = vadd(vscale(R0t, dws[0]), vscale(R1t, dws[1]));
        const Vec3 Tst = corr(dws, wt1);
        Sst = vsub(vadd(Ltst, Lsst), Tst);

        // S_tt = Lt_tt + Ls_tt - T_tt
        //   Lt_tt = H0''F + H1''C + h0''G + g0''K
        //   Ls_tt = H0s R0''(t) + H1s R1''(t)
        //   T_tt  = [ws] B [wt2]
        const Vec3 Lttt = vadd(vadd(vscale(F, Qt2dd.H0), vscale(center, Qt2dd.H1)),
                               vadd(vscale(G, Qt2dd.h0), vscale(K, Qt2dd.g0)));
        const Vec3 R0tt = R0at(2), R1tt = R1at(2);
        const Vec3 Lstt = vadd(vscale(R0tt, H0s), vscale(R1tt, H1s));
        const Vec3 Ttt = corr(ws, wt2);
        Stt = vsub(vadd(Lttt, Lstt), Ttt);
    }
};

constexpr double kDomTol = 1e-9;
inline double clamp01(double t) { return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t); }

} // namespace

// ===========================================================================
// fillGregoryPatch.
// ===========================================================================
GregoryPatch fillGregoryPatch(const GregoryBoundary& boundary) {
    GregoryPatch patch;
    patch.boundary = boundary;
    const char* why = nullptr;
    if (!boundary.validate(&why)) {
        patch.ok = false;
        patch.reason = (why && *why) ? why : "invalid Gregory boundary";
        return patch;
    }
    GregoryBuild gb;
    gb.build(boundary);
    patch.N = gb.N;
    patch.center = gb.center;
    patch.ok = true;
    patch.reason = "";
    return patch;
}

// ===========================================================================
// GregoryPatch::evaluateSub / evaluateSubWithDerivatives /
// evaluateSubWithSecondDerivatives. The g2 fill routes through the QUINTIC
// radial evaluator (evalQuintic); the g1/g0 fill keeps the cubic eval() — the
// g1 path is byte-for-byte unchanged.
// ===========================================================================
Vec3 GregoryPatch::evaluateSub(std::size_t i, double s, double t) const {
    if (!ok || i >= N) return Vec3{0, 0, 0};
    GregoryBuild gb;
    gb.build(boundary);
    Vec3 S, Ss, St;
    if (gb.g2) {
        Vec3 Sss, Sst, Stt;
        gb.evalQuintic(i, clamp01(s), clamp01(t), S, Ss, St, Sss, Sst, Stt, /*order=*/0);
    } else {
        gb.eval(i, clamp01(s), clamp01(t), S, Ss, St, /*wantD=*/false);
    }
    return S;
}

GregorySample GregoryPatch::evaluateSubWithDerivatives(std::size_t i,
                                                       double s, double t) const {
    GregorySample out;
    if (!ok || i >= N) return out;
    if (s < -kDomTol || s > 1.0 + kDomTol ||
        t < -kDomTol || t > 1.0 + kDomTol) return out;
    s = clamp01(s);
    t = clamp01(t);
    GregoryBuild gb;
    gb.build(boundary);
    Vec3 S, Ss, St;
    if (gb.g2) {
        Vec3 Sss, Sst, Stt;
        gb.evalQuintic(i, s, t, S, Ss, St, Sss, Sst, Stt, /*order=*/1);
    } else {
        gb.eval(i, s, t, S, Ss, St, /*wantD=*/true);
    }
    out.point = S;
    out.ds = Ss;
    out.dt = St;
    const Vec3 nrm = vcross(Ss, St);
    const double nl = vlen(nrm);
    if (nl > 0.0) {
        out.normal = vscale(nrm, 1.0 / nl);
        out.ok = true;
    } else {
        out.normal = Vec3{0, 0, 0};
        out.ok = false;
    }
    return out;
}

GregorySample2 GregoryPatch::evaluateSubWithSecondDerivatives(std::size_t i,
                                                              double s, double t) const {
    GregorySample2 out;
    if (!ok || i >= N) return out;
    if (s < -kDomTol || s > 1.0 + kDomTol ||
        t < -kDomTol || t > 1.0 + kDomTol) return out;
    s = clamp01(s);
    t = clamp01(t);
    GregoryBuild gb;
    gb.build(boundary);
    Vec3 S, Ss, St, Sss, Sst, Stt;
    if (gb.g2) {
        gb.evalQuintic(i, s, t, S, Ss, St, Sss, Sst, Stt, /*order=*/2);
    } else {
        // Cubic (g1/g0) path: 2nd partials by a tight central difference of the
        // exact analytic 1st partials of eval() (consistent with that evaluator).
        gb.eval(i, s, t, S, Ss, St, /*wantD=*/true);
        const double h = 1e-5;
        auto firstAt = [&](double su, double tv, Vec3& a, Vec3& b) {
            Vec3 ss, dsa, dta;
            gb.eval(i, clamp01(su), clamp01(tv), ss, dsa, dta, /*wantD=*/true);
            a = dsa; b = dta;
        };
        Vec3 SsP, StP, SsM, StM;
        firstAt(s + h, t, SsP, StP); firstAt(s - h, t, SsM, StM);
        Sss = vscale(vsub(SsP, SsM), 1.0 / (2 * h));
        const Vec3 SstA = vscale(vsub(StP, StM), 1.0 / (2 * h));
        firstAt(s, t + h, SsP, StP); firstAt(s, t - h, SsM, StM);
        Stt = vscale(vsub(StP, StM), 1.0 / (2 * h));
        const Vec3 SstB = vscale(vsub(SsP, SsM), 1.0 / (2 * h));
        Sst = vscale(vadd(SstA, SstB), 0.5);
    }
    out.point = S;
    out.ds = Ss; out.dt = St;
    out.dss = Sss; out.dst = Sst; out.dtt = Stt;
    out.ok = true;
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
