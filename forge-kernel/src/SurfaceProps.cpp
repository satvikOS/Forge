// forge/SurfaceProps.cpp — implementation of the native differential-property
// facade. See include/forge/SurfaceProps.hpp for WHY it exists and for the sign
// and degeneracy conventions, which are normative and are asserted by
// test/surface_props_closed_form_gate.cpp against TEXTBOOK closed forms.
//
// WHAT IS COMPUTED HERE AND WHAT IS DELEGATED:
//
//   FIRST derivatives          delegated to brep::Surface::evaluateDeriv, which
//                              already carries the analytic S_u/S_v of all seven
//                              surface kinds. Not restated here, so p/d1u/d1v are
//                              bit-identical to every other consumer's.
//   SECOND derivatives         ADDED here for the six ANALYTIC kinds. They
//                              existed nowhere: evaluateDeriv is first order,
//                              and the only S_uu/S_uv/S_vv in the native tree
//                              belong to Coons (SurfaceFill) and Gregory
//                              (GregoryFill) patches, which are not a
//                              brep::Surface.
//   NURBS kind (both orders)   delegated wholesale to brep::surfaceDerivatives
//                              (NurbsCalculus), so the rational Leibniz table is
//                              the single supplier for that kind rather than two
//                              evaluators that must agree.
//   FUNDAMENTAL FORMS          delegated to brep::surfaceCurvatureFromForms
//                              (NurbsAlgebra). This file forms NO E,F,G / L,M,N
//                              of its own -- that algebra already existed for the
//                              NURBS kind and was factored down so both suppliers
//                              reach it.
//   CURVE curvature            delegated to brep::curvatureFromDerivatives
//                              (NurbsCalculus), likewise factored rather than
//                              copied.
//
// ── WHAT T-151 ADDED, AND WHY IT HAD TO BE ADDED ───────────────────────────
// T-147 removed 25 OCCT symbols by replacing GeomLProp_SLProps / BRepLProp_
// CLProps with this facade. Those classes differentiate ANY Geom_Surface and ANY
// Geom_Curve; this facade, as first written, did not. MEASURED by a 19-kind
// capability probe against both dylibs: the pre-migration build carried 19 of 19
// and the migrated one carried 14 — the delta had been part-paid in CAPABILITY,
// which doc 11 §4.3/§7 prohibits. The five that fell out, and what carries them
// now, all from documented mathematics and none by calling back into OCCT:
//
//   PARABOLA edge            curveProps, the conic in its own frame
//   HYPERBOLA edge           curveProps, the conic in its own frame
//   revolution of a CIRCLE   PropSurface::Form::Revolved (Rodrigues + chain rule)
//   revolution of a B-spline PropSurface::Form::Revolved, same code path — the
//                            meridian's derivatives come from curveProps, so the
//                            surface inherits every curve kind for free
//   offset of a CONE         PropSurface::Form::Offset (S + d*n, quotient rule),
//                            which also carries the offset of any OTHER base the
//                            exact re-expression route cannot: the general path
//                            is what the cone fixture exercises, deliberately, so
//                            it cannot be inert
//
// Every one of the five is asserted against a CLOSED FORM in
// test/surface_props_closed_form_gate.cpp, never against OCCT, so the gate
// survives OCCT leaving the link.
//
// Pure C++20 + the standard library. No OCCT type is named anywhere in this file.

#include "forge/SurfaceProps.hpp"

#include "forge/native/brep/NurbsAlgebra.hpp"    // surfaceCurvatureFromForms (REUSE)
#include "forge/native/brep/NurbsCalculus.hpp"   // surfaceDerivatives / curveDerivatives /
                                                 // curvatureFromDerivatives (REUSE)

#include <algorithm>
#include <cmath>

namespace forge {
namespace props {

namespace {

using native::brep::Curve;
using native::brep::GeomCurveKind;
using native::brep::Surface;
using native::brep::SurfaceKind;

// The scale-RELATIVE degeneracy threshold, used for the normal here and handed
// to surfaceCurvatureFromForms so ONE criterion decides both. The tangent plane
// is refused when |S_u x S_v| <= kRelTol * max(|S_u|,|S_v|)^2: that sees a
// COLLAPSED partial (a sphere pole, a cone apex, a pinched seam) as well as two
// parallel ones, whereas the tempting |S_u||S_v| denominator sees only
// parallelism and would pass a pole with a plausible number (see NurbsAlgebra).
// It is relative, not absolute, because an absolute floor cannot tell a
// collapsed frame from a merely small one.
//
// It is also deliberately NOT over-eager, and the gate asserts that half too: a
// sphere point 1e-5 rad off the pole still reports the exact 1/R^2. A guard that
// refuses valid points is as wrong as one that accepts invalid ones.
constexpr double kRelTol = 1e-12;

// The principal-normal existence threshold: the component of C'' perpendicular
// to C' must be a real fraction of C'' itself, else the curve is straight (or at
// an inflection) and has no principal normal. Also relative, same reason.
constexpr double kNormalRelTol = 1e-12;

inline Vec3 unitOrZero(const Vec3& v) {
    const double L = v.length();
    if (!(L > 0.0)) return Vec3{};
    return v / L;
}

// ---------------------------------------------------------------------------
// Analytic SECOND partials of the six analytic surface kinds, in the SAME frame
// and the SAME parameter conventions as Surface::evaluate / evaluateDeriv
// (Surface.hpp): R = refDir, B = binormal() = axis x refDir, A = axis, with
// R x B = A. Each is the term-by-term derivative of the first partials that
// Surface::evaluateDeriv returns -- differentiated from that source, not from a
// second parameterisation, so the two orders cannot drift apart.
//
// Returns false for a kind whose second derivatives this function does not
// supply (only the Nurbs kind, which is handled by its own supplier).
// ---------------------------------------------------------------------------
bool analyticSecondDerivs(const Surface& s, double u, double v,
                          Vec3& duu, Vec3& duv, Vec3& dvv) {
    const Vec3 R = s.refDir;
    const Vec3 B = s.binormal();
    const Vec3 A = s.axis;
    duu = Vec3{}; duv = Vec3{}; dvv = Vec3{};

    switch (s.kind) {
    case SurfaceKind::Plane:
        // S = O + u R + v B is affine: every second partial vanishes exactly.
        return true;

    case SurfaceKind::Cylinder: {
        // S_u = r1(-sin u R + cos u B), S_v = A.
        const double c = std::cos(u), si = std::sin(u);
        duu = R * (-s.r1 * c) + B * (-s.r1 * si);
        return true;
    }

    case SurfaceKind::Cone: {
        // S_u = r(v)(-sin u R + cos u B), S_v = dr(cos u R + sin u B) + h A,
        // with r(v) = r1 + (r2-r1) v and h = param. S_vv = 0 because r is linear
        // in v and the axial term is linear in v.
        const double c = std::cos(u), si = std::sin(u);
        const double r = s.r1 + (s.r2 - s.r1) * v;
        const double dr = s.r2 - s.r1;
        duu = R * (-r * c) + B * (-r * si);
        duv = R * (-dr * si) + B * (dr * c);
        return true;
    }

    case SurfaceKind::Sphere: {
        // u = theta, v = phi.
        // S_u = r sin(phi)(-sin th R + cos th B)
        // S_v = r(cos phi cos th R + cos phi sin th B - sin phi A)
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        const double r = s.r1;
        duu = R * (-r * sp * ct) + B * (-r * sp * st);
        duv = R * (-r * cp * st) + B * (r * cp * ct);
        dvv = R * (-r * sp * ct) + B * (-r * sp * st) + A * (-r * cp);
        return true;
    }

    case SurfaceKind::Torus: {
        // u = theta, v = phi, ring(v) = r1 + r2 cos phi.
        // S_u = ring(-sin th R + cos th B)
        // S_v = -r2 sin phi (cos th R + sin th B) + r2 cos phi A
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        const double ring = s.r1 + s.r2 * cp;
        duu = R * (-ring * ct) + B * (-ring * st);
        duv = R * (s.r2 * sp * st) + B * (-s.r2 * sp * ct);
        dvv = R * (-s.r2 * cp * ct) + B * (-s.r2 * cp * st) + A * (-s.r2 * sp);
        return true;
    }

    case SurfaceKind::EllipseExtrusion: {
        // S = O + a cos u R + b sin u B + v A (a = r1, b = r2). Developable:
        // S_v is the constant axis, so S_uv = S_vv = 0 exactly.
        const double c = std::cos(u), si = std::sin(u);
        duu = R * (-s.r1 * c) + B * (-s.r2 * si);
        return true;
    }

    case SurfaceKind::Nurbs:
        return false;   // its own supplier (surfaceDerivatives) handles it
    }
    return false;
}

// ---------------------------------------------------------------------------
// Analytic THIRD partials (T-151). ONE consumer and one reason: an OFFSET
// surface's SECOND derivatives need one more order of its base than anything
// else in this file does, because S_off = S + d*n and n is built from the
// base's FIRST and SECOND partials -- so n's second partials, and hence the
// offset's, reach the base's THIRD. Nothing else calls this, and it is written
// as a separate function rather than folded into analyticSecondDerivs so the
// order-2 path (every other kind) keeps its exact shape.
//
// ★ EXACTLY WHAT THIS ORDER BUYS, AND WHAT IT DOES NOT — measured, because a
//   mutant of the cone's S_uuv first SURVIVED the gate and the reason turned out
//   to be a theorem rather than a hole. Differentiating n.n = 1 twice gives
//        n.n_u = 0   and   n.n_uu = -(n_u . n_u)
//   so the offset's second fundamental form
//        L_off = (S_uu + d n_uu) . n = L - d |n_u|^2
//   depends on n_uu ONLY through n_u, i.e. only through the base's SECOND
//   derivatives. THE THIRD DERIVATIVES CANNOT CHANGE THE OFFSET'S CURVATURE AT
//   ALL. What they do change is the offset's REPORTED d2uu / d2uv / d2vv, which
//   are part of SurfProps' contract (a caller checking G2 continuity reads them),
//   and those are where the closed-form gate asserts them: the offset of a cone
//   IS a cone, so its three second partials have an exact closed form and a wrong
//   third derivative moves them TANGENTIALLY — invisible in K and H, visible
//   there. Reporting them zero, or dropping this order, would have been a silent
//   hole in the struct's contract rather than in its curvature.
//
// Each expression below is the term-by-term v-/u-derivative of the SECOND
// partial directly above it in analyticSecondDerivs -- differentiated from that
// source, not from a re-derived parameterisation, so the two orders cannot
// drift apart. Same frame and conventions: R = refDir, B = binormal(),
// A = axis, R x B = A.
//
// Returns false for the Nurbs kind (whose own supplier carries any order).
// ---------------------------------------------------------------------------
bool analyticThirdDerivs(const Surface& s, double u, double v,
                         Vec3& duuu, Vec3& duuv, Vec3& duvv, Vec3& dvvv) {
    const Vec3 R = s.refDir;
    const Vec3 B = s.binormal();
    const Vec3 A = s.axis;
    duuu = Vec3{}; duuv = Vec3{}; duvv = Vec3{}; dvvv = Vec3{};

    switch (s.kind) {
    case SurfaceKind::Plane:
        // Affine: every derivative above the first vanishes exactly.
        return true;

    case SurfaceKind::Cylinder: {
        // d/du of S_uu = r1(-cos u R - sin u B).
        const double c = std::cos(u), si = std::sin(u);
        duuu = R * (s.r1 * si) + B * (-s.r1 * c);
        return true;                       // every v-derivative is exactly zero
    }

    case SurfaceKind::Cone: {
        // S_uu = -r(v)(cos u R + sin u B), S_uv = dr(-sin u R + cos u B),
        // S_vv = 0. So S_uvv = S_vvv = 0 and only the two below survive.
        const double c = std::cos(u), si = std::sin(u);
        const double r = s.r1 + (s.r2 - s.r1) * v;
        const double dr = s.r2 - s.r1;
        duuu = R * (r * si) + B * (-r * c);          // d/du S_uu
        duuv = R * (-dr * c) + B * (-dr * si);       // d/dv S_uu
        return true;
    }

    case SurfaceKind::Sphere: {
        // u = theta, v = phi (colatitude).
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        const double r = s.r1;
        duuu = R * (r * sp * st) + B * (-r * sp * ct);   // d/du S_uu
        duuv = R * (-r * cp * ct) + B * (-r * cp * st);  // d/dv S_uu
        duvv = R * (r * sp * st) + B * (-r * sp * ct);   // d/dv S_uv
        dvvv = R * (-r * cp * ct) + B * (-r * cp * st) + A * (r * sp);
        return true;
    }

    case SurfaceKind::Torus: {
        // u = theta, v = phi, ring(v) = r1 + r2 cos phi.
        const double ct = std::cos(u), st = std::sin(u);
        const double cp = std::cos(v), sp = std::sin(v);
        const double ring = s.r1 + s.r2 * cp;
        duuu = R * (ring * st) + B * (-ring * ct);              // d/du S_uu
        duuv = R * (s.r2 * sp * ct) + B * (s.r2 * sp * st);     // d/dv S_uu
        duvv = R * (s.r2 * cp * st) + B * (-s.r2 * cp * ct);    // d/dv S_uv
        dvvv = R * (s.r2 * sp * ct) + B * (s.r2 * sp * st) + A * (-s.r2 * cp);
        return true;
    }

    case SurfaceKind::EllipseExtrusion: {
        // S_uu = -a cos u R - b sin u B; S_v is the constant axis.
        const double c = std::cos(u), si = std::sin(u);
        duuu = R * (s.r1 * si) + B * (-s.r2 * c);
        return true;
    }

    case SurfaceKind::Nurbs:
        return false;
    }
    return false;
}

// Every partial of a base surface up to TOTAL ORDER 3, from whichever supplier
// owns the kind. `ok` false means the kind/net could not supply them at all.
struct Derivs3 {
    Vec3 s{};
    Vec3 du{}, dv{};
    Vec3 duu{}, duv{}, dvv{};
    Vec3 duuu{}, duuv{}, duvv{}, dvvv{};
};

bool surfaceDerivs3(const Surface& s, double u, double v, Derivs3& D) {
    if (s.kind == SurfaceKind::Nurbs) {
        if (!s.nurbs.valid()) return false;
        const auto T = native::brep::surfaceDerivatives(s.nurbs, u, v, 3);
        D.s = T[0][0];
        D.du = T[1][0];   D.dv = T[0][1];
        D.duu = T[2][0];  D.duv = T[1][1];  D.dvv = T[0][2];
        D.duuu = T[3][0]; D.duuv = T[2][1]; D.duvv = T[1][2]; D.dvvv = T[0][3];
        return true;
    }
    s.evaluateDeriv(u, v, D.s, D.du, D.dv);
    if (!analyticSecondDerivs(s, u, v, D.duu, D.duv, D.dvv)) return false;
    return analyticThirdDerivs(s, u, v, D.duuu, D.duuv, D.duvv, D.dvvv);
}

// ---------------------------------------------------------------------------
// THE ONE PLACE the normal, the degeneracy criterion and the orientation sign
// algebra live (T-151 factored it out of surfaceProps when the second and third
// FORM appeared; three copies of a sign convention is three chances to drift).
// Fills every field of `out` from a complete set of first and second partials.
// ---------------------------------------------------------------------------
void finishProps(SurfProps& out, const Vec3& du, const Vec3& dv,
                 const Vec3& duu, const Vec3& duv, const Vec3& dvv,
                 bool reversed) {
    out.d1u = du;
    out.d1v = dv;
    out.d2uu = duu;
    out.d2uv = duv;
    out.d2vv = dvv;

    // ── the oriented normal, and the HONEST degeneracy test ────────────────
    const Vec3 cr = du.cross(dv);
    const double crLen = cr.length();
    const double sMax = std::max(du.length(), dv.length());
    if (!(crLen > 0.0) || crLen <= kRelTol * sMax * sMax) {
        // A pole / collapsed seam. p, d1u, d1v and the second partials above are
        // real and are reported; the normal and every curvature are NOT defined
        // and stay zero WITH THE FLAGS FALSE. Never a silent curvature of 0.
        return;
    }
    out.normalDefined = true;
    out.normal = reversed ? (cr / -crLen) : (cr / crLen);

    // ── the curvature invariants, from the ONE shared fundamental-form algebra
    const auto sc = native::brep::surfaceCurvatureFromForms(du, dv, duu, duv, dvv,
                                                            kRelTol);
    if (!sc.ok) return;                           // curvatureDefined stays false
    out.curvatureDefined = true;

    if (!reversed) {
        out.kGauss = sc.gaussian;
        out.kMean  = sc.mean;
        out.kMin   = sc.k1;                       // k1 <= k2 from the shared algebra
        out.kMax   = sc.k2;
    } else {
        // The shared algebra measures against +(S_u x S_v). This surface's own
        // normal is the OPPOSITE one, so L,M,N all negate: K is quadratic in them
        // and is unchanged, H negates, and the two principals negate AND SWAP
        // (the algebraically smaller root of the flipped pair is -k2).
        out.kGauss = sc.gaussian;
        out.kMean  = -sc.mean;
        out.kMin   = -sc.k2;
        out.kMax   = -sc.k1;
    }
}

} // namespace

// ===========================================================================
// surfaceProps
// ===========================================================================
SurfProps surfaceProps(const native::brep::Surface& surface, double u, double v) {
    SurfProps out;

    Vec3 du{}, dv{}, duu{}, duv{}, dvv{};

    if (surface.kind == SurfaceKind::Nurbs) {
        // ONE supplier for this kind: the rational Leibniz derivative table.
        // surfaceDerivatives asserts valid() and indexes control[0], so an
        // invalid net must be refused HERE, not one frame later.
        if (!surface.nurbs.valid()) return out;       // flags stay false
        const auto D = native::brep::surfaceDerivatives(surface.nurbs, u, v, 2);
        out.p = D[0][0];
        du = D[1][0]; dv = D[0][1];
        duu = D[2][0]; duv = D[1][1]; dvv = D[0][2];
    } else {
        // FIRST order comes from the existing analytic evaluator (no restatement);
        // SECOND order is this file's addition.
        Vec3 s{};
        surface.evaluateDeriv(u, v, s, du, dv);
        out.p = s;
        if (!analyticSecondDerivs(surface, u, v, duu, duv, dvv)) return out;
    }

    finishProps(out, du, dv, duu, duv, dvv, surface.reversed);
    return out;
}

// ===========================================================================
// surfaceProps(PropSurface) — the two COMPOSITE forms (T-151)
//
// Both are derived here from standard differential geometry; the identity used
// is named in each block. NEITHER is a translation of any other kernel's source,
// and neither calls back into one: a form restored by delegating to OCCT would
// return the very symbols this facade exists to remove and would make the delta
// a lie.
// ===========================================================================
namespace {

// ── FORM 1: SURFACE OF REVOLUTION ──────────────────────────────────────────
// IDENTITY: RODRIGUES' ROTATION FORMULA applied to the meridian, then the CHAIN
// RULE in each parameter.
//
// For a unit axis k through A, the rotation of a point m about that axis by an
// angle u decomposes m - A into its axial and radial parts:
//     Rot(k,u)(m-A) = h*k + cos(u)*q + sin(u)*(k x q)
//     h = (m-A).k          the axial coordinate (INVARIANT under the rotation)
//     q = (m-A) - h*k      the radial part      (ROTATES in the plane |- k)
// and k x q = k x (m-A) because k x (h k) = 0. So with the meridian m(v):
//
//     S(u,v) = A + h(v)*k + cos(u)*q(v) + sin(u)*p(v),   p(v) = k x (m(v)-A)
//
// u appears ONLY in the two trigonometric factors and v ONLY inside h,q,p, so
// every partial is a product of a derivative of one with the other, and the
// v-derivatives are LINEAR in the meridian's own derivatives:
//     h' = m'.k     q' = m' - h'k     p' = k x m'
//     h'' = m''.k   q'' = m'' - h''k  p'' = k x m''
// ★ THE MERIDIAN DERIVATIVES ARE NOT RE-DERIVED HERE. m, m' and m'' come from
//   curveProps() -- the same evaluator every other caller of this facade uses,
//   for every curve kind it supports (Line, Circle, Ellipse, Parabola,
//   Hyperbola, BSpline). A revolution therefore inherits, exactly, whatever the
//   curve side supports; there is no second curve evaluator to drift.
//
// DEGENERACY: where the meridian MEETS THE AXIS, q and p are both zero, so S_u
// is exactly the zero vector -- a POLE. finishProps' own criterion reports it
// (flags false), which is why this function does not test for it separately.
SurfProps revolvedProps(const PropSurface& ps, double u, double v) {
    SurfProps out;

    const Vec3 k = ps.axisDir;
    // A non-unit axis would scale q and p inconsistently and silently return a
    // wrong curvature, so it is REFUSED rather than normalised behind the
    // caller's back: `axisDir` is documented as unit and this is that contract.
    const double kLen = k.length();
    if (!(std::fabs(kLen - 1.0) <= 1e-12)) return out;    // flags stay false

    const CurveProps mp = curveProps(ps.meridian, v);
    if (!mp.defined) return out;    // the meridian itself has no tangent here

    const Vec3 w = mp.p - ps.axisOrigin;
    const double h  = w.dot(k);
    const double h1 = mp.d1.dot(k);
    const double h2 = mp.d2.dot(k);

    const Vec3 q  = w      - k * h;
    const Vec3 q1 = mp.d1  - k * h1;
    const Vec3 q2 = mp.d2  - k * h2;
    const Vec3 p  = k.cross(w);
    const Vec3 p1 = k.cross(mp.d1);
    const Vec3 p2 = k.cross(mp.d2);

    const double c = std::cos(u), s = std::sin(u);

    out.p = ps.axisOrigin + k * h + q * c + p * s;

    const Vec3 du  = q * (-s) + p * c;
    const Vec3 dv  = k * h1 + q1 * c + p1 * s;
    const Vec3 duu = q * (-c) + p * (-s);
    const Vec3 duv = q1 * (-s) + p1 * c;
    const Vec3 dvv = k * h2 + q2 * c + p2 * s;

    finishProps(out, du, dv, duu, duv, dvv, ps.revolvedReversed);
    return out;
}

// ── FORM 2: OFFSET (PARALLEL) SURFACE ──────────────────────────────────────
// IDENTITY: S_off = S + d*n with n = (S_u x S_v)/|S_u x S_v|, differentiated by
// the QUOTIENT RULE on C/|C| (C = S_u x S_v). Writing L = |C| = sqrt(C.C):
//     C_u  = S_uu x S_v + S_u x S_uv
//     C_uu = S_uuu x S_v + 2 S_uu x S_uv + S_u x S_uuv
//     C_uv = S_uuv x S_v + S_uu x S_vv + S_u x S_uvv     (S_uv x S_uv = 0)
//     C_vv = S_uvv x S_v + 2 S_uv x S_vv + S_u x S_vvv
//     L_a   = (C.C_a)/L
//     L_ab  = (C_a.C_b + C.C_ab)/L - (C.C_a) L_b / L^2
//     n_a   = C_a/L - C L_a/L^2
//     n_ab  = C_ab/L - C_a L_b/L^2 - C_b L_a/L^2 - C L_ab/L^2 + 2 C L_a L_b/L^3
// so the offset's SECOND partials reach the base's THIRD -- which is the whole
// reason analyticThirdDerivs exists.
//
// ★ THE SINGULARITY IS NAMED, NOT ABSORBED. In the principal frame
//   dS_off = (I - d W) dS for the Weingarten map W, so
//       S_off_u x S_off_v = (1 - d k1)(1 - d k2) (S_u x S_v)
//   and the offset surface is SINGULAR exactly where the distance reaches a
//   PRINCIPAL RADIUS OF CURVATURE, 1 - d k_i = 0 (the focal/evolute surface).
//   The frame there is not merely ill-conditioned, it COLLAPSES, and the
//   parallel-surface curvature k_off = k/(1 - d k) is a pole, not a large
//   number. So the point is DECLINED (both flags false) rather than answered
//   with whatever the arithmetic produced. It is an EXACT-singularity test and
//   deliberately not an accuracy filter: a merely NEAR-singular point is a real
//   point of a real surface and is answered, with the honest caveat that its
//   relative accuracy degrades like eps/|1 - d k| toward the focal surface.
//
// ★ THE TEST IS ON THE PRODUCT, AND THE FIRST VERSION THAT TESTED THE TWO
//   FACTORS SEPARATELY WAS WRONG — MEASURED, not anticipated. k1 and k2 are
//   H -/+ sqrt(H^2 - K), and at an UMBILIC that discriminant is a catastrophic
//   cancellation (SurfaceProps.hpp states the bound): on a sphere of R = 1.75
//   the two principals split by ~1e-8 even though both are exactly 1/R. With
//   d = R EXACTLY — the offset that collapses the whole sphere onto its centre,
//   the most singular case there is — neither |1 - d k_i| came out below 1e-9;
//   both were ~1e-8, and the gate caught the point being ANSWERED. The product
//       (1 - d k1)(1 - d k2) = 1 - 2 d H + d^2 K
//   is the WELL-CONDITIONED spelling of the same condition: it is built from H
//   and K, which carry ~1e-16 relative error and never cancel, it vanishes iff
//   at least one factor does, and on that sphere it is exactly 0. The threshold
//   is relative to the magnitude of the terms that had to cancel, because a
//   sum of O(1) terms landing on 1e-9 IS the cancellation, while a genuinely
//   small offset simply leaves the sum near 1.
constexpr double kOffsetSingularTol = 1e-9;   // on the DIMENSIONLESS (1-dk1)(1-dk2)

SurfProps offsetProps(const PropSurface& ps, double u, double v) {
    SurfProps out;

    Derivs3 D;
    if (!surfaceDerivs3(ps.base, u, v, D)) return out;   // base cannot supply them

    const Vec3 C = D.du.cross(D.dv);
    const double L = C.length();
    const double sMax = std::max(D.du.length(), D.dv.length());
    if (!(L > 0.0) || L <= kRelTol * sMax * sMax) return out;   // the BASE is degenerate

    // `offsetDistance` is along the base surface's OWN oriented normal, while
    // everything below is written against n = +(S_u x S_v). A reversed base
    // therefore offsets the other way, and this single line is where that is
    // applied -- not repeated at each use.
    const double d = ps.base.reversed ? -ps.offsetDistance : ps.offsetDistance;

    // The base's principal curvatures w.r.t. n, from the ONE shared algebra, so
    // the singularity test uses the same K/H/k1/k2 every other caller sees.
    const auto bc = native::brep::surfaceCurvatureFromForms(D.du, D.dv, D.duu,
                                                            D.duv, D.dvv, kRelTol);
    if (!bc.ok) return out;
    const double den = 1.0 - 2.0 * d * bc.mean + d * d * bc.gaussian;
    const double denScale = std::max(1.0, std::max(std::fabs(2.0 * d * bc.mean),
                                                   std::fabs(d * d * bc.gaussian)));
    if (std::fabs(den) <= kOffsetSingularTol * denScale)
        return out;                              // ON the focal surface — declined

    const Vec3 n = C / L;

    const Vec3 Cu = D.duu.cross(D.dv) + D.du.cross(D.duv);
    const Vec3 Cv = D.duv.cross(D.dv) + D.du.cross(D.dvv);
    const Vec3 Cuu = D.duuu.cross(D.dv) + D.duu.cross(D.duv) * 2.0
                   + D.du.cross(D.duuv);
    const Vec3 Cuv = D.duuv.cross(D.dv) + D.duu.cross(D.dvv) + D.du.cross(D.duvv);
    const Vec3 Cvv = D.duvv.cross(D.dv) + D.duv.cross(D.dvv) * 2.0
                   + D.du.cross(D.dvvv);

    const double Lu = C.dot(Cu) / L;
    const double Lv = C.dot(Cv) / L;
    const double Luu = (Cu.dot(Cu) + C.dot(Cuu)) / L - C.dot(Cu) * Lu / (L * L);
    const double Luv = (Cu.dot(Cv) + C.dot(Cuv)) / L - C.dot(Cu) * Lv / (L * L);
    const double Lvv = (Cv.dot(Cv) + C.dot(Cvv)) / L - C.dot(Cv) * Lv / (L * L);

    const Vec3 nu = Cu / L - C * (Lu / (L * L));
    const Vec3 nv = Cv / L - C * (Lv / (L * L));
    const Vec3 nuu = Cuu / L - Cu * (2.0 * Lu / (L * L)) - C * (Luu / (L * L))
                   + C * (2.0 * Lu * Lu / (L * L * L));
    const Vec3 nuv = Cuv / L - Cu * (Lv / (L * L)) - Cv * (Lu / (L * L))
                   - C * (Luv / (L * L)) + C * (2.0 * Lu * Lv / (L * L * L));
    const Vec3 nvv = Cvv / L - Cv * (2.0 * Lv / (L * L)) - C * (Lvv / (L * L))
                   + C * (2.0 * Lv * Lv / (L * L * L));

    out.p = D.s + n * d;

    finishProps(out, D.du + nu * d, D.dv + nv * d,
                D.duu + nuu * d, D.duv + nuv * d, D.dvv + nvv * d,
                ps.base.reversed);
    return out;
}

} // namespace

SurfProps surfaceProps(const PropSurface& surface, double u, double v) {
    switch (surface.form) {
    case PropSurface::Form::Native:
        return surfaceProps(surface.base, u, v);
    case PropSurface::Form::Revolved:
        return revolvedProps(surface, u, v);
    case PropSurface::Form::Offset:
        return offsetProps(surface, u, v);
    }
    return SurfProps{};
}

// ===========================================================================
// curveProps
// ===========================================================================
CurveProps curveProps(const native::brep::Curve& curve, double t) {
    CurveProps out;

    const Vec3 R = curve.refDir;
    const Vec3 B = curve.binormal();

    switch (curve.kind) {
    case GeomCurveKind::Line: {
        // C = O + t dir. C' = dir, C'' = C''' = 0.
        out.p  = curve.origin + curve.dir * t;
        out.d1 = curve.dir;
        break;
    }
    case GeomCurveKind::Circle: {
        const double ct = std::cos(t), st = std::sin(t);
        const double r = curve.r;
        out.p  = curve.origin + R * (r * ct) + B * (r * st);
        out.d1 = R * (-r * st) + B * (r * ct);
        out.d2 = R * (-r * ct) + B * (-r * st);
        out.d3 = R * (r * st)  + B * (-r * ct);
        break;
    }
    case GeomCurveKind::Ellipse: {
        const double ct = std::cos(t), st = std::sin(t);
        const double a = curve.a, b = curve.b;
        out.p  = curve.origin + R * (a * ct) + B * (b * st);
        out.d1 = R * (-a * st) + B * (b * ct);
        out.d2 = R * (-a * ct) + B * (-b * st);
        out.d3 = R * (a * st)  + B * (-b * ct);
        break;
    }
    case GeomCurveKind::Parabola: {
        // THE CONIC IN ITS OWN FRAME (T-151). y^2 = 4 f x with the vertex at the
        // origin of the frame, parameterised by y = t:
        //   C(t)   = O + (t^2/(4f)) R + t B
        //   C'(t)  = (t/(2f)) R + B
        //   C''(t) = (1/(2f)) R          -- CONSTANT: the parabola is the one
        //   C'''   = 0                      conic with a constant second
        //                                   derivative in this parameterisation.
        // The curvature then follows from the shared kappa = |C' x C''|/|C'|^3
        // below and is 1/(2f) at the APEX (t = 0), i.e. the vertex radius of
        // curvature is 2f -- the classical result, and the value the gate
        // asserts at the apex precisely because that is where a wrong constant
        // would otherwise hide.
        const double f = curve.a;                  // focal length
        if (!(std::fabs(f) > 0.0)) return out;     // a degenerate parabola: refuse
        out.p  = curve.origin + R * ((t * t) / (4.0 * f)) + B * t;
        out.d1 = R * (t / (2.0 * f)) + B;
        out.d2 = R * (1.0 / (2.0 * f));
        // d3 stays exactly zero — which is the truth, not a fallback.
        break;
    }
    case GeomCurveKind::Hyperbola: {
        // THE CONIC IN ITS OWN FRAME (T-151). x^2/a^2 - y^2/b^2 = 1 on the
        // +refDir branch, parameterised by x = a cosh t, y = b sinh t:
        //   C(t)   = O + a cosh(t) R + b sinh(t) B
        //   C'(t)  = a sinh(t) R + b cosh(t) B
        //   C''(t) = a cosh(t) R + b sinh(t) B     = C(t) - O
        //   C'''(t)= a sinh(t) R + b cosh(t) B     = C'(t)   EXACTLY
        // (cosh and sinh exchange under d/dt, so the derivatives alternate with
        // period 2 — the hyperbolic mirror of the circle's C''' == -C'.) At the
        // WAIST (t = 0) C' = b B and C'' = a R are orthogonal, giving
        // kappa = a/b^2 — the second place a wrong term cannot hide.
        const double a = curve.a, b = curve.b;
        const double ch = std::cosh(t), sh = std::sinh(t);
        out.p  = curve.origin + R * (a * ch) + B * (b * sh);
        out.d1 = R * (a * sh) + B * (b * ch);
        out.d2 = R * (a * ch) + B * (b * sh);
        out.d3 = R * (a * sh) + B * (b * ch);
        break;
    }
    case GeomCurveKind::BSpline: {
        // ONE supplier: the rational curve derivative table, to 3rd order (it
        // returns exact zeros past the degree, which is the truth for a spline
        // of degree < 3, not a fallback).
        if (!curve.nurbs.valid()) return out;     // defined stays false
        const auto d = native::brep::curveDerivatives(curve.nurbs, t, 3);
        out.p = d[0]; out.d1 = d[1]; out.d2 = d[2]; out.d3 = d[3];
        break;
    }
    }

    const double sp = out.d1.length();
    if (!(sp > 0.0)) return out;                  // a cusp: nothing below is real
    out.defined = true;

    // The shared expression, not a second copy of it.
    out.curvature = native::brep::curvatureFromDerivatives(out.d1, out.d2);

    // Principal normal: the unit component of C'' perpendicular to C'. A straight
    // segment (C'' == 0) and an inflection have NONE, and that is reported rather
    // than papered over with a zero vector that looks like a direction.
    const Vec3 T = out.d1 / sp;
    const Vec3 perp = out.d2 - T * out.d2.dot(T);
    const double perpLen = perp.length();
    const double d2Len = out.d2.length();
    if (perpLen > 0.0 && perpLen > kNormalRelTol * d2Len) {
        out.normalDefined = true;
        out.normal = unitOrZero(perp);
    }
    return out;
}

} // namespace props
} // namespace forge
