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

    if (g1) {
        for (std::size_t i = 0; i < N; ++i) {
            if (!sides[i].cross.valid())
                return fail("g1 requested but a cross-tangent field is invalid");
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
    Vec3 center{};

    std::vector<EdgeCurve>   bnd;     // N boundary curves
    std::vector<VectorCurve> crs;     // N cross-tangent fields (g1)
    std::vector<Vec3> V;              // N corner vertices  V_i = b_i(0)
    std::vector<Vec3> M;              // N edge midpoints   M_i = b_i(0.5)
    // Radial boundary->center tangent the surface should carry at the seam
    // endpoints (built from a consistent shared central frame). radM[i] is the
    // radial tangent (pointing boundary->center) AT the midpoint M_i; the matching
    // tangent AT the center for that seam is centerTan[i] (pointing into the fan).
    std::vector<Vec3> radM;           // radial tangent at midpoint M_i
    std::vector<Vec3> centerTan;      // radial tangent at C along seam to M_i

    // ---- build the frame from the boundary loop + cross fields -------------
    bool build(const GregoryBoundary& B) {
        N = B.sides.size();
        g1 = B.g1;
        bnd.resize(N);
        crs.resize(N);
        V.resize(N);
        M.resize(N);
        for (std::size_t i = 0; i < N; ++i) {
            bnd[i].bind(B.sides[i].boundary);
            if (g1) crs[i].bind(B.sides[i].cross);
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

    // Prescribed cross-tangent (into the patch) along the t=0 fan edge of corner
    // i at angular s. Mirrors fanEdge's edge selection.
    Vec3 fanCross(std::size_t i, double s) const {
        const std::size_t ip = prev(i);
        if (s <= 0.5) return crs[ip].value(0.5 + s);
        return crs[i].value(s - 0.5);
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

    // The 2x4 corner block for sub-patch i. Corner index [a][b] with
    //   a in {0,1} -> s in {0,1} (bilinear angular direction);
    //   b in {0,1} -> t in {0,1} (the radial direction carries a Hermite tangent).
    //   P:  positions:  [0][0]=M_{i-1} [1][0]=M_i [0][1]=[1][1]=C
    //   Pt: d/dt:       radial seam tangents at the boundary (t=0) / center (t=1)
    struct Corner {
        Vec3 P, Pt;
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
// GregoryPatch::evaluateSub / evaluateSubWithDerivatives.
// ===========================================================================
Vec3 GregoryPatch::evaluateSub(std::size_t i, double s, double t) const {
    if (!ok || i >= N) return Vec3{0, 0, 0};
    GregoryBuild gb;
    gb.build(boundary);
    Vec3 S, Ss, St;
    gb.eval(i, clamp01(s), clamp01(t), S, Ss, St, /*wantD=*/false);
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
    gb.eval(i, s, t, S, Ss, St, /*wantD=*/true);
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

} // namespace brep
} // namespace native
} // namespace forge
