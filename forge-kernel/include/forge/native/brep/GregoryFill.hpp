// forge/native/brep/GregoryFill.hpp
//
// N-SIDED GREGORY HOLE-FILL (G1) — Class-A surfacing completion for NON-4-sided
// holes. The 4-sided G1/G2 Coons fill (SurfaceFill.hpp) handles a quadrilateral
// boundary loop; this module fills a TRIANGULAR (N=3), PENTAGONAL (N=5),
// HEXAGONAL (N=6) — generally any N>=3 — boundary loop with G1 (tangent-plane)
// continuity to the N bordering faces, using the standard RATIONAL N-SIDED
// GREGORY patch (Gregory 1974; Chiyokura & Kimura 1983; Hoschek & Lasser
// "Fundamentals of CAGD" ch.15; Farin "Curves and Surfaces for CAGD" §16).
//
// ============================ WHAT THIS BUILDS (honest scope, Bible §0/§9)
// Given N boundary curves b_0..b_{N-1} (rational NURBS) that form a CLOSED loop
// (b_i(1) == b_{i+1}(0), indices mod N), PLUS the prescribed CROSS-BOUNDARY
// TANGENT field c_i along each edge (the rate at which the surface must leave
// that edge — the bordering face's transverse slope, i.e. the G1 data), this
// module builds an evaluable surface that
//
//   (a) INTERPOLATES every boundary curve EXACTLY  (the fill meets b_i on side i);
//   (b) MATCHES the prescribed cross-boundary tangent c_i along every edge (G1),
//       so the fill leaves each bordering face tangent-plane-continuously;
//   (c) is G1-CONTINUOUS across the interior radial seams between the N
//       sub-patches and joins them WATERTIGHT at a common central point.
//
// CONSTRUCTION — N quadrilateral GREGORY sub-patches over a mid-edge split.
// The n-gon is split into N quadrilateral sub-domains meeting at the centroid C:
//   sub-patch i has the four corners
//       M_{i-1}  (midpoint of edge i-1) ,  V_i  (boundary vertex / corner i) ,
//       M_i      (midpoint of edge i)   ,  C    (the common central point),
// with V_i sitting at the middle of the t=0 fan edge. Each sub-patch is the
// Boolean-sum Coons fill in its own (s,t) in [0,1]^2: BILINEAR in the angular s
// (the two interior radial seams are interpolated) and CUBIC-HERMITE in the
// radial t (the t=0 fan edge carries the boundary halves AND the prescribed
// cross-boundary tangent; the t=1 apex closes smoothly to C). The two outer
// halves of the t=0 edge (the M_{i-1}->V_i and V_i->M_i half-edges) reproduce
// halves of the boundary curves and the boundary cross-tangent field EXACTLY,
// giving (a)+(b); the two inner edges (the radial seams to C) are built from one
// shared central frame, giving (c).
//
// G1 ACROSS THE INTERIOR SEAMS. Each interior radial seam M_i->C is shared by
// sub-patches i and i+1. Both neighbours use the IDENTICAL radial rib curve
// R_i(t) (a cubic Hermite from M_i with tangent radM[i] to C with tangent
// centerTan[i]) as that seam edge, so the seam POSITION and its along-seam
// TANGENT agree from both sides; with the transverse tangents drawn from the same
// frame the seam is tangent-plane continuous (G1). This shared-rib device is the
// exact, sufficient G1 condition for the mid-edge fan and is what the gate
// measures as the per-seam G1 residual. (The classical rational corner-twist
// split is the device a FULL-bicubic-s Gregory variant needs; the bilinear-s fan
// here does not exercise it — see GregoryFill.cpp's honest GREGORY NOTE.)
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL transfinite/Gregory construction only — NO stub / MVP / placeholder /
// fallback. The patch is evaluated ANALYTICALLY from the boundary curves and
// their derivatives (no pre-sample/fit), so boundary interpolation and the
// prescribed cross-tangent recovery are exact to the precision of the boundary
// evaluators. REUSE (no re-derivation): boundary curves are brep::NurbsCurve read
// through brep::curveDerivatives (NurbsCalculus.hpp); the per-sub-patch bicubic
// Boolean sum reuses the SAME cubic-Hermite blend the 4-sided Coons fill uses.
//
// G2 (CURVATURE-CONTINUOUS) MODE (additive; set GregoryBoundary::g2 = true and
// supply GregorySide::curvature on every side). The radial direction is upgraded
// from a cubic Hermite to a QUINTIC Hermite carrying the prescribed cross-
// boundary CURVATURE at t=0 (alongside position + cross-tangent), via the same
// six quintic-Hermite blends SurfaceFill.cpp uses for the 4-sided G2 Coons fill.
// The g2 sub-patch then (a) interpolates the boundary EXACTLY, (b) matches the
// prescribed cross-tangent (G1) AND (c) matches the prescribed cross-CURVATURE
// (G2) along every edge, all to machine precision. The g1-only path is BYTE-FOR-
// BYTE unchanged when g2 == false.
//
// HONEST N!=4 INTERIOR-SEAM LIMIT (a known CAGD result — twist/curvature
// incompatibility at a singular vertex). The BOUNDARY G2 is exact for any N. The
// INTERIOR radial seams are kept watertight (C0, exact) and curvature-continuous
// only to the tolerance the rational n-sided fan allows: for N == 4 the fan IS a
// regular bi-parametric quad and the interior can be made C2/G2, but for N != 4
// EXACT G2 at the common central singular point is NOT achievable (the per-sector
// twists/curvatures meeting at the apex are mutually incompatible — Gregory's
// twist-compatibility obstruction, the same reason the classical Gregory patch
// needs a RATIONAL corner blend). This module therefore achieves G2 at the
// BOUNDARY exactly and REPORTS the residual interior-seam curvature jump as a
// printed metric rather than faking zero. The central point + radial frame is a
// reasonable averaged centroid frame (the standard n-sided choice), not a global
// energy-minimising optimum (that — and the curvature-comb reflection-line
// FAIRING — remains the documented Class-A follow-up).
//
// Pure C++20, ZERO external dependencies (stdlib + existing forge native headers
// only). No OCCT, no WASM, no third-party libs. namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_GREGORYFILL_HPP
#define FORGE_NATIVE_BREP_GREGORYFILL_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"          // Vec3, NurbsCurve, NurbsSurface
#include "forge/native/brep/NurbsCalculus.hpp"  // curveDerivatives (REUSE)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// GregorySide — one side of the N-sided hole: the boundary curve b_i plus the
// PRESCRIBED cross-boundary tangent field c_i.
//
//   boundary : the i-th boundary curve, re-parameterised to t in [0,1] over its
//              clamped knot domain. boundary(0) is the i-th corner vertex, and
//              boundary(1) coincides with the (i+1)-th side's boundary(0) (the
//              loop closes — checked by validate()).
//   cross    : a "vector curve" (a NurbsCurve whose evaluated POINT is the
//              prescribed cross-boundary tangent VECTOR at that edge parameter,
//              NOT a point on the surface). It is the OUTWARD-into-the-patch
//              transverse derivative the bordering face dictates — the surface
//              must satisfy d(S)/d(transverse) = cross(t) along this edge for G1.
//              Sign convention: `cross` points INTO the hole (toward the patch
//              interior). Leave default-constructed + set g1=false for a pure
//              G0 (positional-only) planar fill.
// ---------------------------------------------------------------------------
struct GregorySide {
    NurbsCurve boundary;   // b_i(t), t in [0,1]; b_i(0) = corner i
    NurbsCurve cross;      // prescribed cross-boundary tangent field c_i(t) (G1)

    // PRESCRIBED cross-boundary CURVATURE field k_i(t) (the G2 data): a "vector
    // curve" whose evaluated POINT is the prescribed 2nd-order cross-derivative
    // VECTOR d^2(S)/d(transverse)^2 at that edge parameter, NOT a point on the
    // surface. It is the bordering face's transverse 2nd-partial along this edge
    // — what the surface's curvature in the radial (into-the-hole) direction must
    // be AT the boundary. Same sign/parameterisation convention as `cross` (both
    // measured in the radial sub-patch coordinate, points INTO the hole). Only
    // used (and required by validate()) when GregoryBoundary::g2 == true; leave
    // default-constructed for the g1-only path.
    NurbsCurve curvature;  // prescribed cross-boundary curvature field k_i(t) (G2)
};

// ---------------------------------------------------------------------------
// GregoryBoundary — the full N-sided boundary loop (N>=3 sides) + G1 flag.
// ---------------------------------------------------------------------------
struct GregoryBoundary {
    std::vector<GregorySide> sides;   // N >= 3 sides, in CCW loop order
    bool g1 = true;                   // true: G1 fill (cross fields required);
                                      // false: G0 positional fill (planar holes)

    // G2 (curvature-continuous) MODE. When g2 == true the fill ADDITIVELY upgrades
    // the radial direction from a cubic Hermite to a QUINTIC Hermite that carries
    // the prescribed cross-boundary CURVATURE (GregorySide::curvature) at t=0, so
    // the fill matches the bordering face's position, transverse tangent AND
    // transverse 2nd-derivative along every edge (G2 at the boundary). g2 implies
    // g1 (the quintic blend needs the tangent fields too); every side's
    // `curvature` field must then be a valid curve. The g1-only path is UNCHANGED
    // when g2 == false (purely additive). See the cpp for the exact boundary
    // algebra and the honest N!=4 interior-seam curvature-jump limit.
    bool g2 = false;

    // True iff there are >= 3 sides, each boundary curve is a valid clamped NURBS
    // curve, the loop CLOSES (b_i(1) == b_{i+1}(0) within cornerTol for all i),
    // (when g1/g2) every cross-tangent field is a valid curve, AND (when g2) every
    // cross-curvature field is a valid curve. `reason` (if non-null) gets a short
    // diagnostic on failure. The honest gate.
    bool validate(const char** reason = nullptr, double cornerTol = 1e-7) const;
};

// ---------------------------------------------------------------------------
// GregorySample — analytic evaluation result on a sub-patch: ok-status, the
// point and its two first partials w.r.t. the sub-patch (s,t) parameters, plus
// the unit normal. A caller verifies G1 (cross-tangent + seam continuity)
// directly from du/dv/normal.
// ---------------------------------------------------------------------------
struct GregorySample {
    bool ok = false;
    Vec3 point;   // S(s,t) on sub-patch
    Vec3 ds;      // dS/ds
    Vec3 dt;      // dS/dt
    Vec3 normal;  // unit (ds x dt); zero if degenerate
};

// ---------------------------------------------------------------------------
// GregorySample2 — the G2-verifiable evaluation result on a sub-patch: the
// point, the two first partials AND the three second partials (S_ss, S_st,
// S_tt) w.r.t. the sub-patch (s,t) parameters. A caller verifies the prescribed
// cross-boundary CURVATURE directly by comparing dtt at t=0 (the radial 2nd
// derivative leaving the boundary) against the prescribed curvature field.
// ---------------------------------------------------------------------------
struct GregorySample2 {
    bool ok = false;
    Vec3 point;   // S(s,t)
    Vec3 ds;      // dS/ds
    Vec3 dt;      // dS/dt
    Vec3 dss;     // d^2 S/ds^2
    Vec3 dst;     // d^2 S/ds dt
    Vec3 dtt;     // d^2 S/dt^2 (the radial 2nd deriv; == prescribed curvature at t=0)
};

// ===========================================================================
// GregoryPatch — the EVALUABLE N-sided Gregory hole-fill.
//
// Built from N quadrilateral Gregory sub-patches. Evaluate either by sub-patch
// local (s,t) — evaluateSub(i, s, t) — or by a global "fan" parameterisation
// evaluate(side, t): side in [0,N) selects the sub-patch (its integer part) and
// the fraction + t walk that sub-patch. Each sub-patch domain is [0,1]^2 in
// (s,t): s runs ALONG the boundary fan (from the M_{i-1}->V_i half toward the
// V_i->M_i half is encoded per-edge; see the cpp), t runs RADIALLY from the
// boundary (t=0) to the centroid (t=1).
// ===========================================================================
struct GregoryPatch {
    GregoryBoundary boundary;
    std::size_t N = 0;        // number of sides / sub-patches
    Vec3 center;              // the common central point all sub-patches meet at
    bool ok = false;
    std::string reason;

    // Number of quadrilateral sub-patches (== N).
    std::size_t subPatchCount() const { return N; }

    // Evaluate the i-th sub-patch at local (s,t) in [0,1]^2. t=0 is the boundary
    // fan (s walks the two boundary half-edges of corner i), t=1 is the centroid.
    Vec3 evaluateSub(std::size_t i, double s, double t) const;

    // Evaluate with first partials + unit normal on the i-th sub-patch.
    GregorySample evaluateSubWithDerivatives(std::size_t i, double s, double t) const;

    // Evaluate with first AND second partials on the i-th sub-patch (the
    // G2-verifiable form). The 2nd partials are the exact analytic derivatives of
    // the same Boolean sum — quintic-Hermite in the radial t for the g2 fill,
    // cubic-Hermite (central-differenced) for the g1/g0 fill. The radial 2nd
    // partial dtt at t=0 equals the prescribed cross-boundary curvature exactly.
    GregorySample2 evaluateSubWithSecondDerivatives(std::size_t i,
                                                    double s, double t) const;
};

// Build the N-sided Gregory G1 (or G0) fill from the boundary loop + cross
// fields. On invalid boundary data the returned patch has ok=false and `reason`
// set; it never fabricates geometry.
GregoryPatch fillGregoryPatch(const GregoryBoundary& boundary);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_GREGORYFILL_HPP
