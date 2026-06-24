// forge/native/brep/SurfaceFill.hpp
//
// CLASS-A SURFACE FILL — the FIRST piece of Class-A surfacing for the Forge
// native kernel (NX/CATIA/ICEM-class). A G1-tangent BICUBICALLY-BLENDED
// COONS / GORDON patch that fills a 4-sided boundary loop with TANGENT
// continuity (G1) to the bordering faces.
//
// ============================ WHAT THIS BUILDS (honest scope, Bible §0/§9)
// Given FOUR boundary curves (rational NURBS) that form a closed quadrilateral
// loop in (u,v) corner order, PLUS the prescribed CROSS-BOUNDARY TANGENT
// (first-derivative) field along each edge (the rate at which the surface must
// leave that edge, i.e. the bordering face's slope), this module builds a
// surface S(u,v), 0<=u,v<=1, that
//
//   (a) INTERPOLATES the four boundary curves EXACTLY:
//          S(u,0)=c0(u)  S(u,1)=c1(u)  S(0,v)=d0(v)  S(1,v)=d1(v),
//   (b) MATCHES the prescribed cross-boundary tangents (G1) at the boundaries:
//          S_v(u,0)=t0(u)  S_v(u,1)=t1(u)  S_u(0,v)=e0(v)  S_u(1,v)=e1(v).
//
// The classical construction is the BICUBICALLY-BLENDED COONS PATCH
// (Coons 1967; Farin "Curves and Surfaces for CADGD" ch.22; Hoschek & Lasser
// "Fundamentals of CAGD" ch.14). It is the sum of two Hermite "lofts" minus a
// tensor-product bicubic Hermite correction over the FOUR CORNERS:
//
//   S(u,v) =  Lc(u,v)  +  Ld(u,v)  -  T(u,v)
//
//   Lc(u,v) = H0(v)c0(u) + H1(v)c1(u) + h0(v)t0(u) + h1(v)t1(u)          (loft in v)
//   Ld(u,v) = H0(u)d0(v) + H1(u)d1(v) + h0(u)e0(v) + h1(u)e1(v)          (loft in u)
//   T(u,v)  = [H0(u) H1(u) h0(u) h1(u)] * B * [H0(v) H1(v) h0(v) h1(v)]^T
//
// where H0,H1,h0,h1 are the CUBIC HERMITE basis functions
//   H0(t)=2t^3-3t^2+1   H1(t)=-2t^3+3t^2   h0(t)=t^3-2t^2+t   h1(t)=t^3-t^2,
// and B is the 4x4 corner data matrix of the FOUR corner points, the FOUR
// boundary tangents AT the corners, and the FOUR mixed "twist" vectors S_uv at
// the corners (Adini twist, taken consistently from the prescribed edge tangent
// fields so the correction term cancels the double-counting on the boundary).
//
// Because H0(0)=1,H0(1)=0,H1(0)=0,H1(1)=1, h0(0)=h0(1)=h1(0)=h1(1)=0 and
// h0'(0)=1, h1'(1)=1 (all other endpoint values/derivatives 0), one can verify
// ALGEBRAICALLY that S reproduces every boundary curve and every prescribed
// cross-boundary tangent EXACTLY (this is the property the gate measures, not a
// fitted approximation). The patch is the unique transfinite blend of the data.
//
// GORDON generalisation: when an INTERIOR network of iso-curves is supplied
// (not just the 4 sides), the same Boolean-sum blend over a richer 1-D basis
// gives a Gordon surface; this increment exposes the 4-sided G1 Coons case and
// the bilinearly-blended (G0) Coons case, with the Gordon network left as a
// documented follow-up (see HONEST FOLLOW-UPS below).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL transfinite construction only — NO stub / MVP / placeholder / fallback.
// The patch is evaluated ANALYTICALLY from the boundary curves and their
// derivatives (it does NOT pre-sample/fit, so interpolation and tangent
// recovery are exact to the precision of the boundary-curve evaluators).
//
// REUSE (no re-derivation): the boundary curves are brep::NurbsCurve and are
// evaluated through brep::curveDerivatives (NurbsCalculus.hpp) for the on-edge
// point + the ALONG-edge tangent; the cross-boundary tangent fields are
// supplied as their own NurbsCurve "vector curves" (each evaluates to the
// PRESCRIBED S_v / S_u vector at that parameter) and are likewise read with the
// validated evaluator. Vec3 / NurbsCurve come from Nurbs.hpp.
//
// A NurbsSurface EXPORT is also provided: bicubic Hermite is a polynomial of
// degree 3 in each direction, so when the four boundaries are themselves
// polynomial of degree <= 3 (the common Class-A bicubic patch) the Coons patch
// is an EXACT bicubic and is emitted as a degree-3x3 Bezier NurbsSurface that
// reproduces the analytic patch to machine precision; for higher-degree or
// rational boundaries the export is a least-squares-free direct bicubic-Hermite
// sample that AGREES with the analytic patch at the 4x4 Hermite nodes and is
// flagged `exactBicubic=false` (honest: it is the standard bicubic approximation
// downstream consumers expect, while the analytic evaluator stays exact).
//
// HONEST FOLLOW-UPS (TARGETED, NOT built here):
//   * G2 (curvature-continuous) fill — needs quintic Hermite + 2nd-cross data;
//   * n-sided GREGORY patch — for non-4-sided holes (rational corner blend);
//   * full GORDON surface over an interior iso-curve NETWORK;
//   * class-A reflection-line / highlight-line FAIRING + curvature-comb
//     optimisation. These are the documented next pieces of Class-A surfacing.
//
// Pure C++20, ZERO external dependencies (stdlib + existing forge native headers
// only). No OCCT, no WASM, no third-party libs. namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_SURFACEFILL_HPP
#define FORGE_NATIVE_BREP_SURFACEFILL_HPP

#include <cstddef>
#include <string>

#include "forge/native/brep/Nurbs.hpp"          // Vec3, NurbsCurve, NurbsSurface
#include "forge/native/brep/NurbsCalculus.hpp"  // curveDerivatives (REUSE)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// CoonsBoundary — the four boundary curves of the quad patch, in corner order,
// plus the four PRESCRIBED cross-boundary tangent fields.
//
// PARAMETER CONVENTION (all four curves are re-parameterised to t in [0,1] via
// their clamped knot domain; the fill maps t linearly onto the patch (u,v)):
//
//   c0 : v=0 edge,  parameter u in [0,1] -> S(u,0) = c0(u)
//   c1 : v=1 edge,  parameter u in [0,1] -> S(u,1) = c1(u)
//   d0 : u=0 edge,  parameter v in [0,1] -> S(0,v) = d0(v)
//   d1 : u=1 edge,  parameter v in [0,1] -> S(1,v) = d1(v)
//
// CORNER COMPATIBILITY (required, checked honestly by validate()):
//   c0(0)=d0(0)   c0(1)=d1(0)   c1(0)=d0(1)   c1(1)=d1(1)
// i.e. the four edges actually meet at the four corners (a closed loop).
//
// CROSS-BOUNDARY TANGENTS (each a "vector curve": a NurbsCurve whose evaluated
// POINT is the PRESCRIBED derivative VECTOR at that edge parameter, NOT a point
// on the surface). They are the G1 data — the bordering face's outgoing slope:
//
//   t0(u) = prescribed S_v(u,0)   (how the surface leaves the v=0 edge)
//   t1(u) = prescribed S_v(u,1)   (how it leaves the v=1 edge)
//   e0(v) = prescribed S_u(0,v)   (how it leaves the u=0 edge)
//   e1(v) = prescribed S_u(1,v)   (how it leaves the u=1 edge)
//
// For a pure interpolation-only (G0 / bilinearly-blended) Coons patch leave the
// four tangent fields default-constructed (empty control points) and set
// `g1` = false: the four `h0/h1`-weighted Hermite terms drop and the blend
// reduces to the bilinearly-blended Coons patch (exact plane for straight
// edges). When `g1` = true all four tangent fields must be supplied.
// ---------------------------------------------------------------------------
struct CoonsBoundary {
    NurbsCurve c0, c1;   // v=0 and v=1 edges, parameter u
    NurbsCurve d0, d1;   // u=0 and u=1 edges, parameter v
    NurbsCurve t0, t1;   // prescribed S_v on the v=0 / v=1 edges (G1 data)
    NurbsCurve e0, e1;   // prescribed S_u on the u=0 / u=1 edges (G1 data)
    bool g1 = true;      // true: bicubic G1 fill; false: bilinear (G0) Coons

    // True iff the four boundary curves are valid clamped NURBS curves whose
    // shared corners coincide to within `cornerTol`, and (when g1) the four
    // tangent fields are valid and parameter-consistent. `reason` (if non-null)
    // gets a short diagnostic on failure. This is the HONEST gate.
    bool validate(const char** reason = nullptr, double cornerTol = 1e-7) const;
};

// ---------------------------------------------------------------------------
// CoonsSample — analytic patch evaluation result with ok-status, the point and
// its two first partials (so a caller can verify G1 directly).
// ---------------------------------------------------------------------------
struct CoonsSample {
    bool ok = false;
    Vec3 point;   // S(u,v)
    Vec3 du;      // S_u(u,v)
    Vec3 dv;      // S_v(u,v)
    Vec3 normal;  // unit (du x dv); zero if degenerate
};

// ===========================================================================
// CoonsPatch — the EVALUABLE bicubically-blended Coons / Gordon fill surface.
//
// Construct via fillCoonsPatch(); then evaluate ANALYTICALLY (exact
// interpolation + exact prescribed-tangent recovery). The patch domain is the
// unit square [0,1]x[0,1] in (u,v).
// ===========================================================================
struct CoonsPatch {
    CoonsBoundary boundary;
    bool ok = false;
    std::string reason;

    // Analytic surface point S(u,v) only (Boolean-sum blend of the boundaries).
    Vec3 evaluate(double u, double v) const;

    // Analytic point + first partials + unit normal (the G1-verifiable form).
    CoonsSample evaluateWithDerivatives(double u, double v) const;
};

// Build the G1 (or G0) Coons fill from the four boundaries + tangent fields.
// On invalid boundary data the returned patch has ok=false and `reason` set;
// it never fabricates geometry.
CoonsPatch fillCoonsPatch(const CoonsBoundary& boundary);

// ---------------------------------------------------------------------------
// NurbsSurface EXPORT.
//
// Emits a degree-3x3 (bicubic) Bezier NurbsSurface that represents the Coons
// patch. When every boundary curve is polynomial of degree <= 3 (and the
// tangent fields likewise), the Coons patch IS an exact bicubic and the export
// reproduces the analytic patch to machine precision (`exactBicubic`=true).
// Otherwise the export is the bicubic-Hermite surface through the 4x4 Hermite
// node data (the standard downstream bicubic), AGREEING with the analytic patch
// at the nodes; `exactBicubic`=false flags that the analytic evaluator remains
// the ground truth away from the nodes. `ok`=false (empty surface) when the
// patch itself is invalid.
//
// The 16 bicubic Bezier control points are obtained from the 4x4 Hermite corner
// data [position, u-tangent, v-tangent, twist] via the fixed Hermite->Bezier
// change of basis (the tangents are scaled by 1/3 onto the inner Bezier rows),
// which is exact for the bicubic case.
// ---------------------------------------------------------------------------
struct CoonsSurfaceExport {
    bool ok = false;
    bool exactBicubic = false;
    NurbsSurface surface;     // degree 3x3 Bezier; clamped knots [0,0,0,0,1,1,1,1]
    std::string reason;
};
CoonsSurfaceExport exportBicubicSurface(const CoonsPatch& patch);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SURFACEFILL_HPP
