// forge/SurfaceProps.hpp
//
// ONE PLACE IN THE KERNEL turns a native surface (or curve) into DIFFERENTIAL
// PROPERTIES — point, first derivatives, oriented normal, and the curvature
// invariants — so that OCCT's LProp family has ONE PLACE TO BE DELETED FROM.
//
// ── WHY THIS FILE EXISTS (11_ARCHDISC_CONVERGENCE_EXECUTION_PROGRAM §4.2) ────
// MEASURED on this build: the GeomLProp_/BRepLProp_/GeomAdaptor_/BRepAdaptor_/
// BRepGProp/GProp_ cluster is 61 undefined symbols spread over 33 distinct
// OWNERS. A symbol leaves the link only when EVERY owner stops naming it, and
// today each owner constructs its own BRepLProp_SLProps / GeomLProp_SLProps /
// BRepLProp_CLProps inline. Thirty-three inline constructions cannot be deleted
// thirty-three times; they have to converge on one native call first. This
// header is that convergence point:
//
//     surfaceProps(surface, u, v)  replaces  BRepLProp_SLProps / GeomLProp_SLProps
//     curveProps(curve, t)         replaces  BRepLProp_CLProps
//
// It NAMES NO OCCT TYPE — not in a signature, not in an include, not in a
// comment as a dependency. The only types crossing its boundary are
// forge::math::Vec3 and the native tagged geometry in
// forge::native::brep::{Surface,Curve}.
//
// ── WHAT IS REUSED, NOT REWRITTEN (the grep came first) ─────────────────────
// A native curvature evaluator ALREADY EXISTED when this was written, under a
// different name, and this file extends it rather than adding a second:
//
//   * forge/native/brep/NurbsAlgebra.hpp  surfaceCurvature(NurbsSurface,u,v)
//       -> the first/second fundamental form algebra (E,F,G / L,M,N -> K,H,k1,k2).
//          It accepted ONLY a NurbsSurface. It has been factored so the algebra
//          is reachable from the six ANALYTIC surface kinds too, via the new
//          surfaceCurvatureFromForms(Su,Sv,Suu,Suv,Svv). This file computes NO
//          fundamental form of its own — it supplies derivatives to that one.
//   * forge/native/brep/NurbsCalculus.hpp curveDerivatives / surfaceDerivatives
//       -> the rational NURBS derivative tables (up to any order). The Nurbs
//          surface/curve kinds delegate straight to them.
//   * forge/native/brep/NurbsCalculus.hpp curvatureFromDerivatives(d1,d2)
//       -> |C' x C''| / |C'|^3, factored out of the existing curveCurvature so
//          the analytic curve kinds share the identical expression.
//   * forge/native/mesh/Curvature.hpp     computeCurvature(mesh)
//       -> the DISCRETE (Meyer et al. cotangent/angle-defect) curvature field on
//          a triangle mesh. Deliberately NOT used here: it is a mesh operator
//          whose accuracy is a refinement limit, and these props must be exact
//          on the analytic kinds. It shares this file's k = H +/- sqrt(H^2 - K)
//          convention and its k1 <= k2 ordering.
//
// WHAT THIS FILE ADDS that existed nowhere: the SECOND derivatives S_uu, S_uv,
// S_vv of the ANALYTIC surface kinds (Plane, Cylinder, Cone, Sphere, Torus,
// EllipseExtrusion). brep::Surface::evaluateDeriv is first-order only, and the
// only second derivatives in the native tree belonged to Coons (SurfaceFill)
// and Gregory (GregoryFill) patches, neither of which is a brep::Surface.
//
// ── SIGN CONVENTION, STATED ONCE ────────────────────────────────────────────
// `normal` is the surface's OWN oriented unit normal: +(S_u x S_v) normalised,
// negated when Surface::reversed is set. That is bit-identical to what
// Surface::normalAt already returns, so the kernel keeps ONE normal convention.
// kMean / kMin / kMax are signed WITH RESPECT TO THAT REPORTED NORMAL (flip the
// normal and H, kMin, kMax negate and the two principals swap). kGauss is
// independent of the normal's sign. Consequence, verified by the gate: a sphere
// patch in the native (theta, phi) parameterisation has an INWARD +(S_u x S_v),
// so an unreversed sphere reports H = +1/R; a cylinder's is OUTWARD, so an
// unreversed cylinder reports H = -1/(2R). Both signs are asserted, in both
// orientations, against the closed form — no fixture is oriented to make a
// number come out positive.
//
// ── HONESTY ─────────────────────────────────────────────────────────────────
// A degenerate tangent plane (EG - F^2 -> 0: a sphere/cone pole, a collapsed
// seam, a malformed NURBS net) sets normalDefined=false and curvatureDefined=
// false and leaves every dependent number at zero. It NEVER reports a curvature
// of 0 at a pole, because 0 is a legitimate curvature and would be
// indistinguishable from a plane. `p`, `d1u` and `d1v` are still reported there
// (the point and the partials exist at a pole; it is their cross product that
// does not).
//
// ── ONE ACCURACY FACT EVERY CALLER MUST KNOW (measured, not assumed) ────────
// kMin and kMax are H -/+ sqrt(H^2 - K). At an UMBILIC point -- every point of a
// sphere, and the apex neighbourhood of any blend -- H^2 == K in exact
// arithmetic, so that discriminant is a CATASTROPHIC CANCELLATION: H^2 and K each
// carry ~1e-16 relative error, their difference is ~1e-16 ABSOLUTE, and the
// square root AMPLIFIES it to ~1e-8. MEASURED on this build: at one sphere
// station K came out bit-exact and the split was exact; ONE STATION AWAY K was a
// single ulp low and the two principals split by 1.3e-8. Same code, same sphere.
//
// So kMean and kGauss are good to ~1e-16 relative, and so are the combinations
// (kMin + kMax) and (kMin * kMax), but the SPLIT between kMin and kMax is good
// only to ~sqrt(DBL_EPSILON) ~ 1.5e-8 near an umbilic. A caller comparing
// principal curvatures across a blend boundary (a class-A continuity check is
// exactly that) must compare at that bound, or compare H and K instead. No
// implementation of this formula can do better; a cancellation-free eigenvalue
// route for the shape operator would, and is not built.
//
// Pure C++20, standard library only. No OCCT, no WASM, no new link libraries.

#ifndef FORGE_SURFACEPROPS_HPP
#define FORGE_SURFACEPROPS_HPP

#include "forge/math/Vec3.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/Surface.hpp"

namespace forge {
namespace props {

// THE canonical forge vector (forge::native::brep::Vec3 is an alias of the same
// type), so no conversion happens at this boundary.
using Vec3 = forge::math::Vec3;

// ---------------------------------------------------------------------------
// SurfProps — everything the LProp surface classes were constructed for.
//
//   BRepLProp_SLProps::Value            -> p
//   GeomLProp_SLProps::D1U / D1V        -> d1u / d1v
//   BRepLProp_SLProps::Normal           -> normal        (see sign convention)
//   BRepLProp_SLProps::IsNormalDefined  -> normalDefined
//   BRepLProp_SLProps::MeanCurvature    -> kMean
//   GeomLProp_SLProps::GaussianCurvature-> kGauss
//   GeomLProp_SLProps::MinCurvature     -> kMin
//   GeomLProp_SLProps::MaxCurvature     -> kMax
//   GeomLProp_SLProps::IsCurvatureDefined -> curvatureDefined
// ---------------------------------------------------------------------------
struct SurfProps {
    Vec3 p{};        // S(u,v)
    Vec3 d1u{};      // dS/du
    Vec3 d1v{};      // dS/dv
    Vec3 normal{};   // unit oriented normal; zero vector iff !normalDefined

    double kMean  = 0.0;   // H = (EN - 2FM + GL) / (2(EG - F^2))
    double kGauss = 0.0;   // K = (LN - M^2) / (EG - F^2)
    double kMin   = 0.0;   // H - sqrt(H^2 - K)   (the algebraically smaller root)
    double kMax   = 0.0;   // H + sqrt(H^2 - K)

    bool normalDefined    = false;  // |S_u x S_v| is non-degenerate
    bool curvatureDefined = false;  // the second fundamental form was formed

    // The three second partials, reported because they are what the caller
    // would otherwise re-derive to verify G2 continuity (SurfaceFill's
    // CoonsSample2 carries the same three for the same reason).
    Vec3 d2uu{};
    Vec3 d2uv{};
    Vec3 d2vv{};
};

// Differential properties of a native analytic-or-NURBS surface at (u,v).
// Never throws; degeneracy is reported through the two flags.
SurfProps surfaceProps(const native::brep::Surface& surface, double u, double v);

// ---------------------------------------------------------------------------
// PropSurface — the surface this facade differentiates (T-151).
//
// ── WHY A SECOND TAG EXISTS AT ALL ─────────────────────────────────────────
// Two of the geometry families a property query is handed CANNOT be expressed
// as a forge::native::brep::Surface, and not for want of a spare enum value:
// that type is a FLAT analytic POD with room for a frame, two radii and a NURBS
// net, and it has nowhere to put a meridian CURVE (a surface of revolution) nor
// a base SURFACE (an offset). MEASURED before choosing: SurfaceKind is named by
// 76 files and SWITCHED ON by 16 of them, so growing it to serve one facade is
// a native-geometry restructure with a 16-switch blast radius, while
// GeomCurveKind is named by 4 files and switched on by 2 -- which is why the
// two new CONICS did go in there (Curve.hpp) and these two composites did not.
// forge::native::brep::Surface is UNCHANGED by T-151.
//
// ── WHY IT IS NOT A CAPABILITY REGRESSION TO NEED IT ───────────────────────
// The OCCT classes this facade replaced (GeomLProp_SLProps / BRepLProp_CLProps)
// differentiate ANY Geom_Surface, revolutions and offsets included. A native
// facade that silently declined those two would have bought its symbol delta
// with capability. These two forms are what keeps the replacement whole.
// ---------------------------------------------------------------------------
struct PropSurface {
    enum class Form {
        Native,    // `base` IS the surface (all seven brep SurfaceKinds)
        Revolved,  // a meridian curve swept about an axis
        Offset     // `base` displaced by `offsetDistance` along its own normal
    };
    Form form = Form::Native;

    // Form::Native — the surface. Form::Offset — the BASE surface being offset.
    // Form::Revolved — UNUSED (see `reversed` below for the one exception).
    native::brep::Surface base{};

    // Form::Revolved. THE PARAMETER ORDER IS PART OF THE CONTRACT:
    //     S(u, v) = A + h(v)*k + cos(u)*q(v) + sin(u)*(k x q(v))
    // i.e. **u is the revolution ANGLE and v the MERIDIAN parameter**, where
    // k = axisDir (unit), A = axisOrigin, and for m = meridian(v):
    //     h(v) = (m - A).k          the axial coordinate
    //     q(v) = (m - A) - h(v)*k   the radial offset from the axis
    // That is Rodrigues' rotation of the meridian about the axis, written with
    // the two parameters in the order an importer hands them over, so the
    // OCCT->native parameter map for this form is the IDENTITY rather than an
    // axis swap the bridge's (scale, shift) contract cannot express.
    native::brep::Curve meridian{};
    Vec3 axisOrigin{};
    Vec3 axisDir{0, 0, 1};      // MUST be unit; a non-unit axis is refused

    // Form::Offset. Signed, along the BASE surface's own oriented normal, so
    // `base.reversed` flips which side of the base the offset lies on exactly as
    // it flips the reported normal. The offset is SINGULAR where the distance
    // reaches a principal radius of curvature (1 - d*k_i == 0) and that point is
    // DECLINED (both flags false) rather than answered with a large number.
    double offsetDistance = 0.0;

    // ORIENTATION, in ONE place per form so there is never a second flag to
    // forget: Form::Native and Form::Offset use `base.reversed` (for Offset it
    // is the base's own flag, which governs both surfaces); Form::Revolved has
    // no base surface and uses THIS flag. The names are deliberately different
    // so a caller cannot set the wrong one and have it silently read.
    bool revolvedReversed = false;

    static PropSurface fromNative(const native::brep::Surface& s) {
        PropSurface p;
        p.form = Form::Native;
        p.base = s;
        return p;
    }
    // The orientation flag that actually governs THIS form. One accessor so a
    // reader never has to remember the rule above.
    bool isReversed() const {
        return form == Form::Revolved ? revolvedReversed : base.reversed;
    }
};

// Differential properties of ANY of the three forms at (u,v). Never throws;
// degeneracy (a pole of the revolution, a singular point of the offset, an
// unusable base) is reported through the two flags, never by a wrong number.
SurfProps surfaceProps(const PropSurface& surface, double u, double v);

// ---------------------------------------------------------------------------
// CurveProps — everything BRepLProp_CLProps was constructed for.
//
//   BRepLProp_CLProps::SetParameter -> the `t` argument (no mutable state here)
//   BRepLProp_CLProps::Value        -> p
//   BRepLProp_CLProps::D1/D2/D3     -> d1 / d2 / d3
//   BRepLProp_CLProps::Curvature    -> curvature
//   BRepLProp_CLProps::Normal       -> normal (unit PRINCIPAL normal, toward the
//                                      centre of curvature), valid iff
//                                      normalDefined
// ---------------------------------------------------------------------------
struct CurveProps {
    Vec3 p{};       // C(t)
    Vec3 d1{};      // C'(t)
    Vec3 d2{};      // C''(t)
    Vec3 d3{};      // C'''(t)
    Vec3 normal{};  // unit principal normal; zero vector iff !normalDefined

    double curvature = 0.0;   // kappa = |C' x C''| / |C'|^3  (>= 0)

    bool defined = false;        // |C'| > 0, so d1..d3 and curvature are meaningful
    bool normalDefined = false;  // kappa > 0, so the principal normal exists
                                 // (a straight segment or an inflection has none)
};

// Differential properties of a native tagged curve at parameter t. Never
// throws; a cusp (|C'| == 0) or a straight curve is reported through the flags.
//
// Supports every GeomCurveKind: Line / Circle / Ellipse / Parabola / Hyperbola
// (analytic, closed form) and BSpline (the rational derivative table). The two
// unbounded conics were added by T-151 — see Curve.hpp for their frames.
CurveProps curveProps(const native::brep::Curve& curve, double t);

} // namespace props
} // namespace forge

#endif // FORGE_SURFACEPROPS_HPP
