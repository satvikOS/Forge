// forge/OcctImport.cpp — see include/forge/OcctImport.hpp for scope / honesty.
//
// Strategy (mirrors the proven Boolean.cpp "faceted topology over EXACT analytic
// geometry" model): every OCCT analytic face becomes the SAME analytic surface
// in the native model, triangulated in its own (u,v) domain by the in-house
// constrained-Delaunay triangulator. The wire loops (outer + holes) are the CDT
// constraint loops, so a bored cap imports as the correct annulus; curved faces
// get interior Steiner points so the boundary mesh is fine enough for a
// watertight tessellation + Betti analysis. Mass stays EXACT — a planar sub-face
// integrates its exact polygon, a curved sub-face integrates the parent quadric
// over its (u,v) parameter triangle (paramTri). All 3-D corners are welded
// GLOBALLY by position so the shells stitch into a closed 2-manifold.

#ifdef FORGE_NATIVE_BREP

#include "forge/OcctImport.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <vector>

// --- OCCT (read side only) -------------------------------------------------
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopAbs_Orientation.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_FindPlane.hxx>
#include <GeomAbs_CurveType.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_OffsetSurface.hxx>
#include <Geom_BSplineCurve.hxx>
#include <GeomConvert.hxx>
#include <Standard_Failure.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <gp_Pnt2d.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <BRepAdaptor_Surface.hxx>
#include "forge/native/brep/FaceNormal.hpp"  // native BRepGProp_Face::Normal replacement
#include <GeomAbs_SurfaceType.hxx>
#include <gp_Pln.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Cone.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax3.hxx>

// --- native (emit side) ----------------------------------------------------
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"           // nb::NurbsSurface
#include "forge/native/brep/NurbsSurface.hpp"    // validateSurface / evaluateWithDerivatives
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"
#include "forge/native/brep/Sweep.hpp"           // nb::Profile (Point2 rings)

namespace forge {

namespace nb = native::brep;
namespace ng = native::geom;
using nb::Vec3;

namespace {

constexpr double kPi = 3.14159265358979323846;

inline Vec3 toV3(const gp_Pnt& p) { return Vec3{p.X(), p.Y(), p.Z()}; }
inline Vec3 toV3(const gp_Dir& d) { return Vec3{d.X(), d.Y(), d.Z()}; }

// A native analytic-surface descriptor for ONE OCCT face, with the frame matched
// to OCCT's elementary parameterization so the native (u,v) == OCCT's (u,v).
struct FaceSurf {
    nb::SurfaceKind kind = nb::SurfaceKind::Plane;
    Vec3 origin{}, axis{0, 0, 1}, refDir{1, 0, 0};
    double r1 = 0, r2 = 0, param = 0;
    bool reversed = false;     // flip native normal so it points OUT of the solid
    bool angular = false;      // u is an angle (cylinder/cone/sphere) -> unwrap
    bool sphere = false;       // v maps as native_v = pi/2 - occt_v
    // BSpline/Bezier path (kind == Nurbs): the EXACT rational tensor-product
    // surface (poles/weights/clamped knots/degrees). For a Nurbs face the native
    // (u,v) == OCCT's surface (u,v) directly (the p-curves CurveOnSurface returns
    // are in this same parameter domain), so no angular unwrap / colatitude remap
    // is applied — occtToNative is the identity for the Nurbs kind.
    nb::NurbsSurface nurbs;
};

// native partials dS/du, dS/dv at (u,v) (mirror of brep::Surface::evaluateDeriv).
void evalDeriv(const FaceSurf& s, double u, double v, Vec3& du, Vec3& dv) {
    const Vec3 b = nb::vcross(s.axis, s.refDir);
    switch (s.kind) {
    case nb::SurfaceKind::Plane:
        du = s.refDir; dv = b; return;
    case nb::SurfaceKind::Cylinder: {
        double c = std::cos(u), si = std::sin(u);
        du = nb::vadd(nb::vscale(s.refDir, -s.r1 * si), nb::vscale(b, s.r1 * c));
        dv = s.axis; return;
    }
    case nb::SurfaceKind::Cone: {
        double c = std::cos(u), si = std::sin(u);
        double r = s.r1 + (s.r2 - s.r1) * v, dr = (s.r2 - s.r1);
        du = nb::vadd(nb::vscale(s.refDir, -r * si), nb::vscale(b, r * c));
        dv = nb::vadd(nb::vadd(nb::vscale(s.refDir, dr * c), nb::vscale(b, dr * si)),
                      nb::vscale(s.axis, s.param));
        return;
    }
    case nb::SurfaceKind::Sphere: {
        double ct = std::cos(u), st = std::sin(u), cp = std::cos(v), sp = std::sin(v);
        du = nb::vadd(nb::vscale(s.refDir, -s.r1 * sp * st), nb::vscale(b, s.r1 * sp * ct));
        dv = nb::vadd(nb::vscale(s.refDir, s.r1 * cp * ct),
             nb::vadd(nb::vscale(b, s.r1 * cp * st), nb::vscale(s.axis, -s.r1 * sp)));
        return;
    }
    case nb::SurfaceKind::Torus: {
        // Mirror of Surface.cpp Torus: S(u,v) = O + (r1 + r2 cos v)*(cos u rd + sin u bn)
        //                                        + r2 sin v * ax  (u=theta, v=phi).
        double ct = std::cos(u), st = std::sin(u), cp = std::cos(v), sp = std::sin(v);
        double ring = s.r1 + s.r2 * cp;
        du = nb::vadd(nb::vscale(s.refDir, -ring * st), nb::vscale(b, ring * ct));   // d/dtheta
        dv = nb::vadd(nb::vadd(nb::vscale(s.refDir, -s.r2 * sp * ct),
                               nb::vscale(b, -s.r2 * sp * st)),
                      nb::vscale(s.axis, s.r2 * cp));                                  // d/dphi
        return;
    }
    case nb::SurfaceKind::Nurbs: {
        // EXACT rational partials from the native bivariate NURBS evaluator
        // (quotient rule on the homogeneous numerator/denominator). Same code the
        // mass integrator runs on the built Face, so the staged orientation check
        // sees the identical surface geometry.
        nb::SurfaceSample ss = nb::evaluateWithDerivatives(s.nurbs, u, v);
        du = ss.du; dv = ss.dv;
        return;
    }
    default: du = s.refDir; dv = b; return;
    }
}

// evaluate native S(u,v) (mirror of brep::Surface::evaluate for these 4 kinds).
Vec3 evalUV(const FaceSurf& s, double u, double v) {
    const Vec3 b = nb::vcross(s.axis, s.refDir);
    switch (s.kind) {
    case nb::SurfaceKind::Plane:
        return nb::vadd(s.origin, nb::vadd(nb::vscale(s.refDir, u), nb::vscale(b, v)));
    case nb::SurfaceKind::Cylinder: {
        double c = std::cos(u), si = std::sin(u);
        return nb::vadd(s.origin, nb::vadd(nb::vadd(nb::vscale(s.refDir, s.r1 * c),
                                                    nb::vscale(b, s.r1 * si)),
                                           nb::vscale(s.axis, v)));
    }
    case nb::SurfaceKind::Cone: {
        double c = std::cos(u), si = std::sin(u);
        double r = s.r1 + (s.r2 - s.r1) * v;
        return nb::vadd(s.origin, nb::vadd(nb::vadd(nb::vscale(s.refDir, r * c),
                                                    nb::vscale(b, r * si)),
                                           nb::vscale(s.axis, s.param * v)));
    }
    case nb::SurfaceKind::Sphere: {
        double ct = std::cos(u), st = std::sin(u), cp = std::cos(v), sp = std::sin(v);
        return nb::vadd(s.origin, nb::vadd(nb::vscale(s.refDir, s.r1 * sp * ct),
                       nb::vadd(nb::vscale(b, s.r1 * sp * st),
                                nb::vscale(s.axis, s.r1 * cp))));
    }
    case nb::SurfaceKind::Torus: {
        double ct = std::cos(u), st = std::sin(u), cp = std::cos(v), sp = std::sin(v);
        double ring = s.r1 + s.r2 * cp;
        return nb::vadd(s.origin, nb::vadd(nb::vadd(nb::vscale(s.refDir, ring * ct),
                                                    nb::vscale(b, ring * st)),
                                           nb::vscale(s.axis, s.r2 * sp)));
    }
    case nb::SurfaceKind::Nurbs: {
        // EXACT rational surface point S(u,v) (used for interior Steiner points;
        // boundary points are the canonical shared edge-curve 3-D positions).
        nb::SurfaceSample ss = nb::evaluatePoint(s.nurbs, u, v);
        return ss.point;
    }
    default:
        return s.origin;
    }
}

// ---------------------------------------------------------------------------
// Convert an OCCT Geom_BSplineSurface into a native nb::NurbsSurface, EXACTLY:
// every pole (control point) + weight, the FLAT (multiplicity-expanded) clamped
// knot vectors, and the U/V degrees are copied 1:1 — no refit, no approximation
// of the geometry itself. A U- or V-PERIODIC OCCT surface (its knot vector is not
// clamped, so the native validateSurface would reject it) is first converted to its
// equivalent CLAMPED (non-periodic) form. SetUNotPeriodic / SetVNotPeriodic unrolls
// the periodicity and is enough for a surface whose ends are ALREADY clamped (the
// fillet/loft BSpline faces), but a surface born periodic from a full revolution
// keeps a NON-clamped end-knot multiplicity (e.g. a degree-2 revolution's U knot
// sequence has multiplicity 1 at the ends and knots OUTSIDE the [0,2pi] range), which
// the native clamped invariant rejects. So we additionally Segment() the surface to
// its natural bounds: on a B-spline, Segment(U1,U2,V1,V2) re-clamps the end knots to
// full multiplicity over EXACTLY that domain WITHOUT changing the geometry (OCCT's own
// knot-insertion), giving a clamped surface the native side accepts. This is the same
// EXACT surface — a faithful representation, not a refit. The native surface keeps
// OCCT's parameter domain (knotsU/V carry OCCT's actual U/V values), so the face
// p-curves (BRep_Tool::CurveOnSurface, in that same domain) index it directly.
//
// Returns false (with `why`) only if the converted surface fails the native
// validateSurface gate — an HONEST defer, never a fabricated surface.
bool readBSplineSurface(const Handle(Geom_BSplineSurface)& srcIn,
                        nb::NurbsSurface& out, std::string& why) {
    if (srcIn.IsNull()) { why = "null BSpline surface"; return false; }

    // Work on a copy so converting periodic->clamped never mutates the input
    // shape's geometry (we only READ the OCCT side).
    Handle(Geom_BSplineSurface) s =
        Handle(Geom_BSplineSurface)::DownCast(srcIn->Copy());
    if (s.IsNull()) { why = "BSpline surface copy failed"; return false; }
    const bool wasPeriodic = s->IsUPeriodic() || s->IsVPeriodic();
    if (s->IsUPeriodic()) s->SetUNotPeriodic();
    if (s->IsVPeriodic()) s->SetVNotPeriodic();
    if (wasPeriodic) {
        // Re-clamp the de-periodised surface to its natural bounds so the end-knot
        // multiplicities become degree+1 (the native clamped invariant). Segment is a
        // geometry-preserving knot operation; guard the rare DomainError on a hairline
        // over-period and fall back to the (possibly still-unclamped) de-periodised form,
        // which then defers honestly at the validateSurface gate below.
        Standard_Real bu1, bu2, bv1, bv2;
        s->Bounds(bu1, bu2, bv1, bv2);
        try {
            s->Segment(bu1, bu2, bv1, bv2);
        } catch (const Standard_Failure&) {
            // leave s as-is; validateSurface will catch a residual non-clamp.
        }
    }

    const int nU = s->NbUPoles();
    const int nV = s->NbVPoles();
    if (nU < 2 || nV < 2) { why = "BSpline pole count < 2"; return false; }

    out.degreeU = (std::size_t)s->UDegree();
    out.degreeV = (std::size_t)s->VDegree();

    // Poles + weights (OCCT 1-based grid: rows index U, cols index V — matches the
    // native control[i_u][j_v] convention). Weight defaults to 1 for a polynomial
    // (non-rational) surface (OCCT returns a null weight array there).
    const bool rational = s->IsURational() || s->IsVRational();
    out.control.assign(nU, std::vector<nb::Vec3>(nV));
    out.weights.assign(nU, std::vector<double>(nV, 1.0));
    for (int iu = 1; iu <= nU; ++iu)
        for (int iv = 1; iv <= nV; ++iv) {
            gp_Pnt p = s->Pole(iu, iv);
            out.control[iu - 1][iv - 1] = nb::Vec3{p.X(), p.Y(), p.Z()};
            if (rational) {
                double w = s->Weight(iu, iv);
                if (!(w > 0.0)) { why = "BSpline non-positive weight"; return false; }
                out.weights[iu - 1][iv - 1] = w;
            }
        }

    // FLAT knot vectors (multiplicities already expanded): size nU+degreeU+1 and
    // nV+degreeV+1, clamped after the de-periodisation above.
    TColStd_Array1OfReal uk(1, nU + s->UDegree() + 1);
    TColStd_Array1OfReal vk(1, nV + s->VDegree() + 1);
    s->UKnotSequence(uk);
    s->VKnotSequence(vk);
    out.knotsU.assign(uk.Length(), 0.0);
    out.knotsV.assign(vk.Length(), 0.0);
    for (int i = uk.Lower(); i <= uk.Upper(); ++i) out.knotsU[i - uk.Lower()] = uk.Value(i);
    for (int i = vk.Lower(); i <= vk.Upper(); ++i) out.knotsV[i - vk.Lower()] = vk.Value(i);

    const char* vr = nullptr;
    if (!nb::validateSurface(out, &vr)) {
        why = std::string("BSpline surface invalid for native (") +
              (vr ? vr : "?") + ")";
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// EXACT surface of LINEAR EXTRUSION -> native NurbsSurface, built DIRECTLY (not via
// GeomConvert, which THROWS for a B-spline-based extrusion). A linear extrusion is
// S(u,v) = C(u) + v*D, where C is the basis curve and D the extrusion direction. As a
// tensor B-spline this is EXACT: the U-direction is the basis curve (its poles, knots,
// weights, degree carried 1:1 — CurveToBSplineCurve is exact for a line/conic/B-spline
// basis), and the V-direction is degree 1 over the face's actual [v0,v1] window with
// just two pole rows, C-poles + v0*D and C-poles + v1*D (the same weight on both). The
// resulting surface matches OCCT's extrusion to MACHINE PRECISION in BOTH geometry AND
// (u,v) parameterization (V is linear = OCCT's v, U is the basis param = OCCT's u), so
// the face's CurveOnSurface p-curves index it directly. We then feed it through the
// SAME readBSplineSurface 1:1 extractor (de-periodise/validate) for a single code path.
// Returns false (named `why`) if the basis can't be turned into a B-spline curve or the
// built surface fails the native validate gate — an HONEST defer, never a refit.
bool readExtrusionSurface(const Handle(Geom_SurfaceOfLinearExtrusion)& ext,
                          const TopoDS_Face& face,
                          nb::NurbsSurface& out, std::string& why) {
    if (ext.IsNull()) { why = "null extrusion surface"; return false; }
    Handle(Geom_Curve) basis = ext->BasisCurve();
    if (basis.IsNull()) { why = "extrusion has null basis curve"; return false; }
    Handle(Geom_BSplineCurve) cb;
    try { cb = GeomConvert::CurveToBSplineCurve(basis); }
    catch (const Standard_Failure&) { cb.Nullify(); }
    if (cb.IsNull()) { why = "extrusion basis curve -> B-spline failed"; return false; }

    const gp_Dir D = ext->Direction();
    double u0, u1, v0, v1;
    BRepTools::UVBounds(face, u0, u1, v0, v1);   // v-window = extrusion-length range

    const int nU = cb->NbPoles();
    if (nU < 2) { why = "extrusion basis pole count < 2"; return false; }
    const bool curveRational = cb->IsRational();
    TColgp_Array2OfPnt poles(1, nU, 1, 2);
    TColStd_Array2OfReal wts(1, nU, 1, 2);
    for (int i = 1; i <= nU; ++i) {
        gp_Pnt p = cb->Pole(i);
        double w = curveRational ? cb->Weight(i) : 1.0;
        poles.SetValue(i, 1, gp_Pnt(p.X() + v0 * D.X(), p.Y() + v0 * D.Y(), p.Z() + v0 * D.Z()));
        poles.SetValue(i, 2, gp_Pnt(p.X() + v1 * D.X(), p.Y() + v1 * D.Y(), p.Z() + v1 * D.Z()));
        wts.SetValue(i, 1, w); wts.SetValue(i, 2, w);
    }
    // U knots from the basis curve; V knots = degree-1 clamped over [v0,v1].
    const int nUk = cb->NbKnots();
    TColStd_Array1OfReal uk(1, nUk); cb->Knots(uk);
    TColStd_Array1OfInteger um(1, nUk); cb->Multiplicities(um);
    TColStd_Array1OfReal vk(1, 2); vk.SetValue(1, v0); vk.SetValue(2, v1);
    TColStd_Array1OfInteger vm(1, 2); vm.SetValue(1, 2); vm.SetValue(2, 2);

    Handle(Geom_BSplineSurface) bs;
    try {
        bs = new Geom_BSplineSurface(poles, wts, uk, vk, um, vm,
                                     cb->Degree(), 1, cb->IsPeriodic(), Standard_False);
    } catch (const Standard_Failure& f) {
        why = std::string("extrusion tensor surface build failed: ") + f.GetMessageString();
        return false;
    }
    // 1:1 extract (handles a periodic U basis via the de-periodise+clamp path).
    return readBSplineSurface(bs, out, why);
}

// Build the native FaceSurf from an OCCT analytic face. Returns false (with
// `why` set) for a non-analytic surface type.
bool readSurface(const TopoDS_Face& face, FaceSurf& out, std::string& why) {
    BRepAdaptor_Surface ad(face, Standard_True);
    GeomAbs_SurfaceType t = ad.GetType();
    switch (t) {
    case GeomAbs_Plane: {
        gp_Pln pl = ad.Plane();
        const gp_Ax3& ax = pl.Position();
        out.kind = nb::SurfaceKind::Plane;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());     // plane normal
        out.refDir = toV3(ax.XDirection());
        break;
    }
    case GeomAbs_Cylinder: {
        gp_Cylinder cy = ad.Cylinder();
        const gp_Ax3& ax = cy.Position();
        out.kind = nb::SurfaceKind::Cylinder;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());
        out.refDir = toV3(ax.XDirection());
        out.r1 = cy.Radius();
        out.angular = true;
        break;
    }
    case GeomAbs_Cone: {
        gp_Cone co = ad.Cone();
        const gp_Ax3& ax = co.Position();
        double semi = co.SemiAngle();           // signed half-angle
        double Rref = co.RefRadius();           // radius at the Location plane (v=0)
        // We re-anchor the cone to the face's actual v-window after UV bounds are
        // known (origin -> circle centre at vmin); here keep the OCCT reference.
        out.kind = nb::SurfaceKind::Cone;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());
        out.refDir = toV3(ax.XDirection());
        out.r1 = Rref;                          // placeholder; fixed up below
        out.r2 = semi;                          // stash semi-angle (re-used below)
        out.param = 0.0;
        out.angular = true;
        break;
    }
    case GeomAbs_Sphere: {
        gp_Sphere sp = ad.Sphere();
        const gp_Ax3& ax = sp.Position();
        out.kind = nb::SurfaceKind::Sphere;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());
        out.refDir = toV3(ax.XDirection());
        out.r1 = sp.Radius();
        out.angular = true;
        out.sphere  = true;
        break;
    }
    case GeomAbs_Torus: {
        // A torus IS an exact native analytic surface (nb::SurfaceKind::Torus): OCCT's
        // gp_Torus parameterization P(u,v) = Loc + (R + r cos v)(cos u XDir + sin u YDir)
        // + r sin v ZDir is IDENTICAL to the native S(theta,phi) (see Surface.cpp), so we
        // copy major/minor radii + the gp_Ax3 frame 1:1 — NOT a facet-fake, the same
        // closed-form quadric OCCT uses. The full-periodic torus (u,v both span 2pi, the
        // BRepPrimAPI_MakeTorus case) is staged by the doubly-periodic torus grid below;
        // a TRIMMED torus patch (e.g. a pipe bend) falls through to the general CDT path
        // with this exact surface + its real (u,v) trim loops.
        gp_Torus to = ad.Torus();
        const gp_Ax3& ax = to.Position();
        out.kind = nb::SurfaceKind::Torus;
        out.origin = toV3(ax.Location());
        out.axis   = toV3(ax.Direction());     // torus symmetry axis (+Z of frame)
        out.refDir = toV3(ax.XDirection());
        out.r1 = to.MajorRadius();             // major R (ring centre radius)
        out.r2 = to.MinorRadius();             // minor r (tube radius)
        out.angular = true;
        break;
    }
    case GeomAbs_SurfaceOfExtrusion: {
        // A linear-extrusion (sweep of a profile along a straight direction) face has NO
        // dedicated native analytic kind, but it IS an EXACT rational tensor B-spline
        // (basis curve x linear-in-direction). We build it DIRECTLY (readExtrusionSurface)
        // rather than via GeomConvert — GeomConvert::SurfaceToBSplineSurface THROWS for a
        // B-spline-based extrusion, and even where it succeeds it can reparameterise. The
        // direct construction matches OCCT's extrusion to MACHINE PRECISION in geometry
        // AND (u,v) parameterization, so the face p-curves index it; it is then routed
        // through the proven native NURBS path with the face's real (u,v) trim loops.
        Handle(Geom_Surface) gs = BRep_Tool::Surface(face);
        Handle(Geom_SurfaceOfLinearExtrusion) ext =
            Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(gs);
        if (ext.IsNull()) { why = "extrusion face had no Geom_SurfaceOfLinearExtrusion"; return false; }
        if (!readExtrusionSurface(ext, face, out.nurbs, why)) return false;
        out.kind = nb::SurfaceKind::Nurbs;
        return true;
    }
    case GeomAbs_SurfaceOfRevolution: {
        // HONEST DEFER. A surface of revolution sweeps the profile around the axis through
        // a TRUE-ANGLE u parameter (OCCT's u is the revolution angle, uniform). The only
        // exact representation of a circular sweep as a B-spline is a RATIONAL QUADRATIC,
        // whose u parameter is NON-uniform in the angle (the tan(theta/2) reparameterisation)
        // — so NO rational B-spline surface can simultaneously (a) trace the exact circle
        // AND (b) keep OCCT's uniform-angle u domain that the face's CurveOnSurface p-curves
        // live in. GeomConvert::SurfaceToBSplineSurface confirms this: it returns a degree-2
        // NON-rational (polynomial) approximation that misses the true surface by ~0.16 at
        // model scale (~4.6% volume) and is parameter-mismatched. Rather than import a
        // facet-grade-inexact, p-curve-misindexed body, we DEFER until the native kernel
        // grows a first-class revolved-surface geometry (which would re-derive the p-curves
        // in its own parameterisation). [A native Torus IS supported — that quadric's
        // parameterisation IS uniform-angle and matches OCCT exactly.]
        why = "non-analytic face Revolution (no exact uniform-angle NURBS; GeomConvert "
              "approximation ~4.6% volume / 0.16 abs — deferred, not facet-faked)";
        return false;
    }
    case GeomAbs_OffsetSurface: {
        // HONEST DEFER. An OffsetSurface is the base surface displaced by a constant along
        // its normal; it is exactly a rational B-spline ONLY for special bases, and for a
        // free-form base GeomConvert::SurfaceToBSplineSurface yields a TOLERANCED (fitted)
        // approximation, not an exact surface — and (like the revolution) its (u,v)
        // parameterisation need not match the offset's p-curve domain. With no verified
        // exact-and-parameter-matched case, we DEFER honestly rather than import an
        // approximate offset wall.
        why = "non-analytic face Offset (offset->NURBS is a toleranced fit, not exact — "
              "deferred, not facet-faked)";
        return false;
    }
    case GeomAbs_BSplineSurface: {
        // The biggest OCCT-zero gap: real CAD parts (fillet blends, lofts, sweeps)
        // are bounded by BSpline faces. Extract OCCT's Geom_BSplineSurface EXACTLY
        // into the native rational tensor-product surface; the face's trim (its
        // (u,v) wire loops) is applied by the CDT path below.
        Handle(Geom_Surface) gs = BRep_Tool::Surface(face);
        Handle(Geom_BSplineSurface) bs = Handle(Geom_BSplineSurface)::DownCast(gs);
        if (bs.IsNull()) { why = "BSpline face had no Geom_BSplineSurface"; return false; }
        if (!readBSplineSurface(bs, out.nurbs, why)) return false;
        out.kind = nb::SurfaceKind::Nurbs;
        return true;   // frame fields (origin/axis/refDir) are unused for Nurbs.
    }
    case GeomAbs_BezierSurface: {
        // A Bezier surface is the special case of a B-spline with the clamped
        // Bezier knot vector [0..0,1..1]; OCCT converts it LOSSLESSLY. We do the
        // Bezier->BSpline promotion here (cheap + exact) so the same native path
        // handles it — no separate Bezier evaluator needed.
        Handle(Geom_Surface) gs = BRep_Tool::Surface(face);
        Handle(Geom_BezierSurface) bz = Handle(Geom_BezierSurface)::DownCast(gs);
        if (bz.IsNull()) { why = "Bezier face had no Geom_BezierSurface"; return false; }
        Handle(Geom_BSplineSurface) bs = GeomConvert::SurfaceToBSplineSurface(bz);
        if (bs.IsNull()) { why = "Bezier->BSpline conversion failed"; return false; }
        if (!readBSplineSurface(bs, out.nurbs, why)) return false;
        out.kind = nb::SurfaceKind::Nurbs;
        return true;
    }
    default: {
        // Any surface type with no native route at all (e.g. GeomAbs_OtherSurface).
        why = "non-analytic face other";
        return false;
    }
    }
    // Re-orthonormalize the frame defensively (OCCT dirs are already unit + ortho,
    // but guard against a non-unit XDirection feeding the parameterization).
    out.axis   = nb::vnorm(out.axis);
    out.refDir = nb::vnorm(nb::vsub(out.refDir, nb::vscale(out.axis,
                              nb::vdot(out.refDir, out.axis))));
    return true;
}

// Number of intermediate samples per boundary edge. Both faces sharing an OCCT
// edge sample its SAME 3-D curve at the SAME arc fractions, so their boundary
// vertices are bit-identical (after the global position weld) => every shared
// edge is used by exactly two faces => the assembled shell is a closed 2-manifold.
// 64 keeps a circular cap's chordal polygon area within ~0.06% of the true disk
// (the curved SIDE walls integrate EXACTLY via paramTri regardless of N) so the
// whole import lands well inside the 0.5% volume/area A/B gate.
constexpr int kEdgeSamples = 64;

// One boundary sample on a wire edge: the 3-D point (canonical, shared across the
// two faces using this edge) AND this face's (u,v) at the same point.
struct BSample {
    Vec3 p3;                       // 3-D point on the edge's curve
    std::array<double, 2> uv;      // this face's NATIVE (u,v) at that point
};

} // namespace

// TEST-ONLY PROBE counter (see OcctImport.hpp). Process-wide; bumped on entry to every
// importOcctSolid call. Relaxed atomic so a concurrent assembly scan can't trip TSan;
// production never reads it.
static std::atomic<unsigned long long> g_importCallCount{0};

unsigned long long importOcctSolidCallCount() {
    return g_importCallCount.load(std::memory_order_relaxed);
}

ImportResult importOcctSolid(const TopoDS_Shape& shape) {
    g_importCallCount.fetch_add(1, std::memory_order_relaxed);
    ImportResult res;
    if (shape.IsNull()) { res.reason = "null shape"; return res; }

    // Pick the faces to import: prefer a TopoDS_Solid; else use the shape's faces.
    TopExp_Explorer solidEx(shape, TopAbs_SOLID);
    TopoDS_Shape src = shape;
    if (solidEx.More()) src = solidEx.Current();

    std::vector<TopoDS_Face> faces;
    for (TopExp_Explorer fe(src, TopAbs_FACE); fe.More(); fe.Next())
        faces.push_back(TopoDS::Face(fe.Current()));
    if (faces.empty()) { res.reason = "no faces in shape"; return res; }

    // ---- edge -> "every adjacent face is PLANAR" map --------------------------
    // A STRAIGHT (3-D Line) edge is sampled at just its two endpoints (no interior
    // densification) ONLY when EVERY face that uses it is planar. Rationale: the
    // over-densification CDT crossing this avoids is a PLANAR-FACET artifact (a flat
    // facet's straight boundary sampled at 64 collinear points proper-crosses its
    // neighbour near a shared corner — the faceted-STEP failure). A line edge shared
    // with a CURVED face (e.g. an analytic fillet's tangent line, between a plane and
    // a cylindrical/spherical blend) must KEEP the dense sampling: the curved face's
    // constrained triangulation relies on it, and collapsing the edge there folds the
    // weld at the arc junction (non-manifold). Keying the reduction off the SHARED
    // edge's neighbourhood (not the per-face surface) keeps BOTH faces' sample counts
    // identical, so every shared edge still welds into one oppositely-mated edge.
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors(src, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    auto allAdjacentPlanar = [&](const TopoDS_Edge& e) -> bool {
        if (!edgeFaces.Contains(e)) return false;
        const TopTools_ListOfShape& adj = edgeFaces.FindFromKey(e);
        if (adj.IsEmpty()) return false;
        for (TopTools_ListIteratorOfListOfShape it(adj); it.More(); it.Next()) {
            BRepAdaptor_Surface as(TopoDS::Face(it.Value()), Standard_False);
            if (as.GetType() != GeomAbs_Plane) return false;
        }
        return true;
    };

    // ---- global vertex weld: one native Vertex per unique 3-D position --------
    auto owner = std::make_shared<nb::TopologyBuilder>();
    nb::Solid* solid = owner->makeSolid();
    nb::Shell* shell = owner->makeShell();
    owner->addShellToSolid(solid, shell);

    // model-scale weld tolerance from the shape's overall extent.
    double diag = 1.0;
    {
        double lo[3] = {1e300, 1e300, 1e300}, hi[3] = {-1e300, -1e300, -1e300};
        for (const auto& f : faces)
            for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next()) {
                Vec3 p = toV3(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())));
                lo[0] = std::min(lo[0], p.x); hi[0] = std::max(hi[0], p.x);
                lo[1] = std::min(lo[1], p.y); hi[1] = std::max(hi[1], p.y);
                lo[2] = std::min(lo[2], p.z); hi[2] = std::max(hi[2], p.z);
            }
        diag = std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0]) + (hi[1]-lo[1])*(hi[1]-lo[1]) +
                         (hi[2]-lo[2])*(hi[2]-lo[2]));
        if (!(diag > 0)) diag = 1.0;
    }
    const double weld = 1e-7 * std::max(1.0, diag);
    std::map<std::array<long long, 3>, int> vmap;     // welded position -> vid
    std::vector<Vec3> vpos;                           // vid -> position
    std::vector<nb::Vertex*> verts;                   // vid -> native Vertex (built later)
    auto key = [&](const Vec3& p) {
        return std::array<long long, 3>{
            (long long)std::llround(p.x / weld),
            (long long)std::llround(p.y / weld),
            (long long)std::llround(p.z / weld)};
    };
    auto weldId = [&](const Vec3& p) -> int {
        auto k = key(p);
        auto it = vmap.find(k);
        if (it != vmap.end()) return it->second;
        int id = (int)vpos.size();
        vmap.emplace(k, id);
        vpos.push_back(p);
        return id;
    };

    // One triangle sub-face (planar polygon or paramTri curved) staged before the
    // manifold pre-check + build (CDT path).
    struct StagedFace {
        std::array<int, 3> vid;          // welded vertex ids
        nb::SurfaceKind kind = nb::SurfaceKind::Plane;
        Vec3 origin{}, axis{0,0,1}, refDir{1,0,0};
        double r1 = 0, r2 = 0, param = 0;
        bool reversed = false, paramTri = false;
        std::array<std::array<double, 2>, 3> uv{};
        std::shared_ptr<const nb::NurbsSurface> nurbs; // valid iff kind==Nurbs
    };
    std::vector<StagedFace> staged;

    // An n-gon curved sector band (periodic-wall path) integrated EXACTLY over its
    // full [u0,u1]x[v0,v1] rectangle (paramTri=false), like the native primitives.
    // For a NURBS face whose trim IS the full parameter rectangle, the same exact
    // rectangle path (tensor Gauss over the EXACT rational Jacobian) is used, so the
    // wall's mass is computed to quadrature precision instead of the coarser CDT
    // degree-5 triangle rule — `nurbs` carries the EXACT rational surface for that.
    struct StagedPoly {
        std::vector<int> vids;
        nb::SurfaceKind kind = nb::SurfaceKind::Plane;
        Vec3 origin{}, axis{0,0,1}, refDir{1,0,0};
        double r1 = 0, r2 = 0, param = 0;
        bool reversed = false, paramTri = false;
        std::vector<std::array<double, 2>> uv;
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
        std::shared_ptr<const nb::NurbsSurface> nurbs; // valid iff kind==Nurbs
    };
    std::vector<StagedPoly> stagedPoly;

    // Per-face import: triangulate the (u,v) domain (wires + Steiner grid for
    // curvature) and STAGE one native triangle sub-face per inside CDT triangle.
    for (const TopoDS_Face& face : faces) {
        FaceSurf fs;
        std::string why;
        if (!readSurface(face, fs, why)) { res.reason = why; return res; }

        // OCCT UV bounds (in OCCT's elementary parameterization, which we matched).
        double umin, umax, vmin, vmax;
        BRepTools::UVBounds(face, umin, umax, vmin, vmax);

        // For a CONE, re-anchor the native surface so native t in [0,1] spans the
        // face's OCCT v-window [vmin,vmax]. OCCT cone: radius(v)=Rref+v*sin(semi),
        // axial offset = v*cos(semi). Native cone: r(t)=r1+(r2-r1)t over axis*param*t.
        double coneSemi = 0.0, coneCos = 1.0;
        if (fs.kind == nb::SurfaceKind::Cone) {
            coneSemi = fs.r2;                   // stashed semi-angle
            double Rref = fs.r1;
            coneCos = std::cos(coneSemi);
            double rA = Rref + vmin * std::sin(coneSemi);
            double rB = Rref + vmax * std::sin(coneSemi);
            fs.origin = nb::vadd(fs.origin, nb::vscale(fs.axis, vmin * coneCos));
            fs.r1 = rA; fs.r2 = rB;
            fs.param = (vmax - vmin) * coneCos;
        }

        const bool curved = (fs.kind != nb::SurfaceKind::Plane);

        // ============ FULL TORUS (DOUBLY-periodic) — WRAP GRID BOTH WAYS =========
        // BRepPrimAPI_MakeTorus is a SINGLE face periodic in BOTH u (theta, around the
        // major ring) and v (phi, around the tube): u,v each span 2*pi, with NO cap
        // wires to weld to. A CDT of the flat [0,2pi]x[0,2pi] rectangle would duplicate
        // BOTH seams. Instead build a structured NxM grid whose u AND v indices WRAP
        // (column nu == column 0 and row nv == row 0, SHARED vertices) — exactly how the
        // native buildTorus primitive segments the surface. Each cell is emitted as a
        // native FACE over its EXACT [u_i,u_{i+1}]x[v_k,v_{k+1}] torus rectangle
        // (paramTri=false), integrated EXACTLY by the analytic |S_u x S_v| Jacobian
        // (degree-exact tensor Gauss). The closed grid is genus 1 (chi = 0 => b1 = 2),
        // a watertight 2-manifold. NB: only a FULL doubly-periodic torus takes this path;
        // a trimmed torus patch (a real (u,v) sub-window) falls through to the general
        // CDT path below with the same exact native Torus surface + its trim loops.
        if (fs.kind == nb::SurfaceKind::Torus &&
            std::fabs((umax - umin) - 2.0 * kPi) < 1e-6 &&
            std::fabs((vmax - vmin) - 2.0 * kPi) < 1e-6) {
            // `faceReversed`: native du x dv vs OCCT's OUTWARD normal, compared at the
            // SAME physical point (umin,vmin). For a default torus native du x dv points
            // OUTWARD already; this stays robust for a placed/flipped torus frame.
            Vec3 faceOutward{0, 0, 1};
            {
                gp_Pnt op; gp_Vec on;
                forge::native::brep::faceOrientedNormal(face, umin, vmin, op, on);
                faceOutward = nb::vnorm(Vec3{on.X(), on.Y(), on.Z()});
            }
            Vec3 ndu, ndv; evalDeriv(fs, 0.0, 0.0, ndu, ndv);
            Vec3 nNat = nb::vnorm(nb::vcross(ndu, ndv));
            bool faceReversed = (nb::vlen(faceOutward) > 0.5 && nb::vlen(nNat) > 0.5)
                                ? (nb::vdot(nNat, faceOutward) < 0.0) : false;

            const int nu = kEdgeSamples;             // segments around the major ring
            const int nv = std::max(24, kEdgeSamples / 2); // segments around the tube
            auto uParT = [&](int iu) { return (2.0 * kPi * iu) / nu; };  // un-wrapped
            auto vParT = [&](int iv) { return (2.0 * kPi * iv) / nv; };
            auto vidAtT = [&](int iu, int iv) -> int {
                double u = (2.0 * kPi * (iu % nu)) / nu;   // wraps: nu -> 0
                double v = (2.0 * kPi * (iv % nv)) / nv;   // wraps: nv -> 0
                return weldId(evalUV(fs, u, v));
            };
            for (int iu = 0; iu < nu; ++iu)
                for (int iv = 0; iv < nv; ++iv) {
                    std::vector<int> ring = {vidAtT(iu, iv), vidAtT(iu + 1, iv),
                                             vidAtT(iu + 1, iv + 1), vidAtT(iu, iv + 1)};
                    std::vector<std::array<double,2>> uv = {
                        {uParT(iu), vParT(iv)}, {uParT(iu + 1), vParT(iv)},
                        {uParT(iu + 1), vParT(iv + 1)}, {uParT(iu), vParT(iv + 1)}};
                    // drop welded-duplicate consecutive corners (defensive; none for a
                    // proper torus where r2 < r1 so no row collapses).
                    std::vector<int> r; std::vector<std::array<double,2>> u2;
                    for (std::size_t i = 0; i < ring.size(); ++i) {
                        int prev = r.empty() ? ring.back() : r.back();
                        if (ring[i] != prev) { r.push_back(ring[i]); u2.push_back(uv[i]); }
                    }
                    if (r.size() < 3) continue;
                    // parameter-orientation signed area, flipped uniformly by faceReversed
                    // so the winding is consistently OUTWARD (=> closed 2-manifold).
                    double cr = 0;
                    for (std::size_t i = 0; i < u2.size(); ++i) {
                        auto& p = u2[i]; auto& q = u2[(i + 1) % u2.size()];
                        cr += p[0] * q[1] - q[0] * p[1];
                    }
                    bool ccw = cr > 0.0;
                    if (ccw == faceReversed) {
                        std::reverse(r.begin() + 1, r.end());
                        std::reverse(u2.begin() + 1, u2.end());
                    }
                    StagedPoly sp;
                    sp.vids = r;
                    sp.kind = fs.kind; sp.origin = fs.origin; sp.axis = fs.axis;
                    sp.refDir = fs.refDir; sp.r1 = fs.r1; sp.r2 = fs.r2; sp.param = fs.param;
                    sp.reversed = faceReversed; sp.paramTri = false;
                    sp.uv = u2;
                    sp.u0 = uParT(iu); sp.u1 = uParT(iu + 1);
                    sp.v0 = vParT(iv); sp.v1 = vParT(iv + 1);
                    stagedPoly.push_back(std::move(sp));
                }
            continue;   // full torus fully staged; next face.
        }

        // ============ FULL-REVOLUTION (periodic) CURVED FACE — WRAP GRID =========
        // A cylinder/cone/sphere side spanning a full 2*pi in u has a SEAM: a CDT of
        // the flat [0,2pi] rectangle would duplicate it (two boundary columns weld to
        // the same 3-D line => a non-manifold/duplicated directed edge). Instead build
        // a STRUCTURED grid whose u index WRAPS (column nu == column 0, SHARED
        // vertices) — exactly how the native primitives segment a curved side. The
        // rim rows (v = vmin / vmax) sample at the SAME nu angles the bounding cap
        // circles use (kEdgeSamples), so wall-rim and cap-rim vertices weld => the
        // wall stitches watertight to its caps. Mass stays EXACT (paramTri quads).
        // NB: NURBS faces NEVER take the periodic-wrap-grid path — that path bakes
        // in the quadric angular/colatitude parameterisation (nv0/nv1, sphere-pole
        // collapse). A NURBS face's u-domain is its knot range (which may happen to
        // span 2*pi but is NOT an angle), so it is handled by the general CDT path
        // below with its real (u,v) trim loops. A TORUS is likewise excluded — a full
        // torus was already staged by the doubly-periodic grid above (and `continue`d),
        // and a partial torus patch (u=2pi but v<2pi) has v=phi as a tube angle this
        // cap-rim path does not model, so it routes through the general CDT path with
        // the exact native Torus surface + its real trim loops.
        if (fs.kind != nb::SurfaceKind::Nurbs && fs.kind != nb::SurfaceKind::Torus &&
            curved && std::fabs((umax - umin) - 2.0 * kPi) < 1e-6) {
            // `faceReversed`: native du x dv vs OCCT's OUTWARD normal, compared at the
            // SAME physical point (a curved face's outward direction varies with u, so
            // both MUST be sampled at the same (u,v) — here OCCT u=umin / native u=0).
            double ov = 0.5 * (vmin + vmax);
            Vec3 faceOutward{0, 0, 1};
            {
                gp_Pnt op; gp_Vec on;
                forge::native::brep::faceOrientedNormal(face, umin, ov, op, on);  // outward at native u=0
                faceOutward = nb::vnorm(Vec3{on.X(), on.Y(), on.Z()});
            }
            double nv_mid = (fs.kind == nb::SurfaceKind::Sphere) ? (0.5 * kPi - ov)
                          : (fs.kind == nb::SurfaceKind::Cone)   ? 0.5 : ov;
            Vec3 ndu, ndv; evalDeriv(fs, 0.0, nv_mid, ndu, ndv);
            Vec3 nNat = nb::vnorm(nb::vcross(ndu, ndv));
            bool faceReversed = (nb::vlen(faceOutward) > 0.5 && nb::vlen(nNat) > 0.5)
                                ? (nb::vdot(nNat, faceOutward) < 0.0) : false;

            const int nu = kEdgeSamples;                 // matches cap-circle sampling
            // native v-rows. cylinder: [vmin,vmax]; cone: t in [0,1]; sphere: phi in
            // [phi(vmax)..phi(vmin)] = colatitude rows. We sample nv rows + handle the
            // sphere poles (radius 0) by emitting triangles instead of quads.
            double nv0, nv1;
            if (fs.kind == nb::SurfaceKind::Sphere) { nv0 = 0.5 * kPi - vmax; nv1 = 0.5 * kPi - vmin; }
            else if (fs.kind == nb::SurfaceKind::Cone) { nv0 = 0.0; nv1 = 1.0; }
            else { nv0 = vmin; nv1 = vmax; }
            int nv = (fs.kind == nb::SurfaceKind::Sphere) ? 16
                   : (fs.kind == nb::SurfaceKind::Cone)   ? 8 : 4;

            auto vidAt = [&](int iu, int iv) -> int {
                double u = (2.0 * kPi * (iu % nu)) / nu;   // wraps: nu -> 0
                double v = nv0 + (nv1 - nv0) * iv / nv;
                return weldId(evalUV(fs, u, v));
            };
            auto uPar = [&](int iu) { return (2.0 * kPi * iu) / nu; };     // un-wrapped u
            auto vPar = [&](int iv) { return nv0 + (nv1 - nv0) * iv / nv; };

            // Emit each cell as a native FACE over its FULL [u_iu,u_{iu+1}]x[v0,v1]
            // RECTANGLE band (paramTri=false), integrated EXACTLY by the rectangle
            // parametric quadrature — identical to how the native primitives build a
            // curved side. A sphere/cone pole row collapses to a triangle (the rect
            // domain still integrates the analytic taper exactly). The ring is wound
            // by parameter orientation, flipped uniformly by `faceReversed` so the
            // shell is consistently outward (=> mates with the caps).
            auto emitCell = [&](std::vector<int> ring,
                                std::vector<std::array<double,2>> uv) {
                // drop welded-duplicate consecutive corners (pole collapse).
                std::vector<int> r; std::vector<std::array<double,2>> u2;
                for (std::size_t i = 0; i < ring.size(); ++i) {
                    int prev = r.empty() ? ring.back() : r.back();
                    if (ring[i] != prev) { r.push_back(ring[i]); u2.push_back(uv[i]); }
                }
                if (r.size() < 3) return;
                // parameter-orientation signed area of the (u,v) polygon.
                double cr = 0;
                for (std::size_t i = 0; i < u2.size(); ++i) {
                    auto& p = u2[i]; auto& q = u2[(i + 1) % u2.size()];
                    cr += p[0] * q[1] - q[0] * p[1];
                }
                bool ccw = cr > 0.0;
                if (ccw == faceReversed) {
                    std::reverse(r.begin() + 1, r.end());
                    std::reverse(u2.begin() + 1, u2.end());
                }
                StagedPoly sp;
                sp.vids = r;
                sp.kind = fs.kind; sp.origin = fs.origin; sp.axis = fs.axis;
                sp.refDir = fs.refDir; sp.r1 = fs.r1; sp.r2 = fs.r2; sp.param = fs.param;
                sp.reversed = faceReversed; sp.paramTri = false;
                sp.uv = u2;
                sp.u0 = uPar(0); sp.u1 = uPar(0); sp.v0 = nv0; sp.v1 = nv1;
                // exact rectangle trim window for this cell:
                stagedPoly.push_back(std::move(sp));
            };
            for (int iu = 0; iu < nu; ++iu)
                for (int iv = 0; iv < nv; ++iv) {
                    std::vector<int> ring = {vidAt(iu, iv), vidAt(iu + 1, iv),
                                             vidAt(iu + 1, iv + 1), vidAt(iu, iv + 1)};
                    std::vector<std::array<double,2>> uv = {
                        {uPar(iu), vPar(iv)}, {uPar(iu + 1), vPar(iv)},
                        {uPar(iu + 1), vPar(iv + 1)}, {uPar(iu), vPar(iv + 1)}};
                    emitCell(ring, uv);
                    // set the rectangle trim window on the just-pushed cell.
                    if (!stagedPoly.empty()) {
                        auto& sp = stagedPoly.back();
                        sp.u0 = uPar(iu); sp.u1 = uPar(iu + 1);
                        sp.v0 = vPar(iv); sp.v1 = vPar(iv + 1);
                    }
                }
            continue;   // periodic curved face fully staged; next face.
        }

        // unwrap reference for the angular (u) coordinate: the UV-bounds u-centre.
        const double uref = 0.5 * (umin + umax);
        auto unwrapU = [&](double u) {
            while (u - uref > kPi) u -= 2.0 * kPi;
            while (uref - u > kPi) u += 2.0 * kPi;
            return u;
        };
        // v-unwrap reference (only needed for the torus, whose v=phi is ALSO an angle).
        const double vref = 0.5 * (vmin + vmax);
        auto unwrapV = [&](double v) {
            while (v - vref > kPi) v -= 2.0 * kPi;
            while (vref - v > kPi) v += 2.0 * kPi;
            return v;
        };
        // OCCT (u,v) -> native (u_n,v_n). u is the same angle (unwrapped) for the
        // angular kinds; native v differs: sphere uses colatitude phi = pi/2 - v_occt,
        // cone uses t = (v_occt - vmin)/(vmax-vmin).
        auto occtToNative = [&](double uo, double vo, double& un, double& vn) {
            switch (fs.kind) {
            case nb::SurfaceKind::Plane:
                un = uo; vn = vo; return;
            case nb::SurfaceKind::Cylinder:
                un = unwrapU(uo); vn = vo; return;
            case nb::SurfaceKind::Cone: {
                un = unwrapU(uo);
                double span = (vmax - vmin);
                vn = (span != 0.0) ? (vo - vmin) / span : 0.0;
                return;
            }
            case nb::SurfaceKind::Sphere:
                un = unwrapU(uo); vn = 0.5 * kPi - vo; return; // colatitude
            case nb::SurfaceKind::Torus:
                // OCCT torus (u=theta, v=phi) maps IDENTICALLY to the native torus; both
                // are angles, so just keep each within a contiguous window for the CDT.
                un = unwrapU(uo); vn = unwrapV(vo); return;
            case nb::SurfaceKind::Nurbs:
                // IDENTITY: the native NURBS surface keeps OCCT's parameter domain,
                // and CurveOnSurface returns the p-curve in that same (u,v), so the
                // native (u,v) == OCCT's (u,v) with no remap.
                un = uo; vn = vo; return;
            default: un = uo; vn = vo; return;
            }
        };

        // ---- boundary loops: each wire edge sampled on BOTH its 3-D curve (the
        // CANONICAL point, identical for both faces using the edge) and this face's
        // p-curve (the (u,v) at the same point). The 3-D points weld across faces,
        // so every shared edge ends up used by exactly two faces => closed manifold.
        TopoDS_Wire outer = BRepTools::OuterWire(face);
        std::vector<std::vector<BSample>> rings;
        // Native OCCT (u,v) recovery for CURVED faces: project the shared 3-D boundary
        // point onto this face's surface (GeomAPI_ProjectPointOnSurf, TKGeomAlgo — kept)
        // instead of evaluating the stored 2-D p-curve (Geom2d_Curve::Value, TKG2d). This
        // yields the SAME (u,v) the p-curve encodes. Only NON-full-periodic curved trims
        // reach here (a full wrap is staged analytically above), so no seam branch is
        // ambiguous; the existing occtToNative/unwrapU folds the result into native (u,v).
        Handle(Geom_Surface) faceSurf = BRep_Tool::Surface(face);
        GeomAPI_ProjectPointOnSurf faceProj;
        auto projectOcctUV = [&](const gp_Pnt& q, double& uo, double& vo) -> bool {
            faceProj.Init(q, faceSurf, umin, umax, vmin, vmax);
            if (!faceProj.IsDone() || faceProj.NbPoints() < 1) {
                faceProj.Init(q, faceSurf);
                if (!faceProj.IsDone() || faceProj.NbPoints() < 1) return false;
            }
            faceProj.LowerDistanceParameters(uo, vo);
            return true;
        };
        auto addRing = [&](const TopoDS_Wire& w) {
            std::vector<BSample> ring;
            for (BRepTools_WireExplorer ex(w, face); ex.More(); ex.Next()) {
                TopoDS_Edge e = ex.Current();
                Standard_Real p3a, p3b;
                Handle(Geom_Curve)   c3 = BRep_Tool::Curve(e, p3a, p3b);
                if (c3.IsNull()) continue;
                const bool rev = (ex.Current().Orientation() == TopAbs_REVERSED);
                // How many samples does THIS edge need? A STRAIGHT 3-D edge (a Line in
                // model space) is fully described by its two endpoints: densifying it
                // with intermediate collinear points adds no geometry and, near a shared
                // corner, lets two adjacent edges' dense near-corner samples spuriously
                // register as a PROPER_CROSS in the CDT PSLG (the faceted-STEP failure:
                // every planar facet boundary is a chain of LINE edges). So a 3-D line
                // edge contributes ONE point per edge (its start; the next edge contributes
                // the shared end vertex), giving the exact polygon. A genuinely CURVED 3-D
                // edge (an analytic arc / a B-spline trim) still gets the full kEdgeSamples
                // chordal densification so a curved cap / blend boundary is resolved finely.
                //
                // THE DECISION KEYS OFF THE SHARED EDGE (3-D Line type + the edge's
                // adjacent-face set), never this face's p-curve — because the SAME edge is
                // used by exactly two faces and BOTH must sample it IDENTICALLY (same count,
                // same arc fractions) for their boundary 3-D points to weld into one shared,
                // oppositely-mated edge (closed 2-manifold). `allAdjacentPlanar(e)` is a
                // property of the edge (same answer for both faces), so the reduction stays
                // weld-consistent. We collapse to the two endpoints only for a straight edge
                // between PLANAR faces — exactly the faceted-facet case the dense sampling
                // breaks; a straight edge bordering a curved blend keeps the full sampling
                // that the curved face's CDT needs (see the map comment above).
                int nSamp = kEdgeSamples;
                {
                    BRepAdaptor_Curve ac(e);
                    if (ac.GetType() == GeomAbs_Line && allAdjacentPlanar(e)) nSamp = 1;
                }
                // ---- PLANAR-FACE (u,v) FROM EXACT 3-D PROJECTION -------------------
                // On a PLANAR face, derive each boundary sample's (u,v) by EXACT affine
                // projection of its CANONICAL 3-D point (c3->Value, the same point both
                // adjacent faces weld to) onto the plane's orthonormal frame, instead of
                // routing each sample through the OCCT p-curve (pc->Value, a reconstructed
                // 2-D trim that injects ~1e-9 FP wiggle). For a plane the surface map is
                // P = origin + u*refDir + v*b (b = axis x refDir, refDir/b orthonormal),
                // so the inverse u=(P-o).refDir, v=(P-o).b is EXACT and is the very frame
                // evalDeriv/faceReversed already use — the boundary embedding is now in the
                // native frame (more consistent, not less). For a STRAIGHT shared edge this
                // makes the planar face's (u,v) affine in the edge parameter (u,v collinear
                // with the line), the collinear-only intent of this fix. Only the PLANAR
                // face's (u,v) changes; the 3-D weld points and every curved/NURBS face's
                // own sampling path are untouched, so all masses stay bit-identical (a
                // planar face's mass is a 3-D flux that ignores the (u,v) triangulation).
                // NOTE: a STEP straight edge that borders a CURVED face must still be
                // sampled at kEdgeSamples collinear points (to weld to the neighbour), and
                // FP cannot place N points EXACTLY on an arbitrary line, so the exact CDT
                // predicate would still read a sub-ULP "crossing" between two far-apart
                // sub-segments of that run — that residual is cleared by the EXACT
                // bounding-box reject in constrainedDelaunay2D's self-intersection guard
                // (the predicate itself is left untouched).
                const bool planarProj = (fs.kind == nb::SurfaceKind::Plane);
                const Vec3 pframeB = nb::vcross(fs.axis, fs.refDir); // plane v-axis (unit)
                // sample [0,1) along the edge in its wire-traversal sense; the next
                // edge contributes the shared end vertex.
                std::vector<BSample> es; es.reserve(nSamp);
                for (int i = 0; i < nSamp; ++i) {
                    double s = (double)i / nSamp;
                    double f3 = rev ? (p3b + (p3a - p3b) * s) : (p3a + (p3b - p3a) * s);
                    gp_Pnt q3 = c3->Value(f3);
                    Vec3 P = toV3(q3);
                    double un, vn;
                    if (planarProj) {
                        Vec3 d = nb::vsub(P, fs.origin);
                        un = nb::vdot(d, fs.refDir);
                        vn = nb::vdot(d, pframeB);
                    } else {
                        double uo = 0.0, vo = 0.0;
                        projectOcctUV(q3, uo, vo);   // native projection ≡ the p-curve (u,v)
                        occtToNative(uo, vo, un, vn);
                    }
                    es.push_back({P, {un, vn}});
                }
                for (auto& bs : es) ring.push_back(bs);
            }
            if (ring.size() >= 3) rings.push_back(std::move(ring));
        };
        addRing(outer);
        for (TopExp_Explorer we(face, TopAbs_WIRE); we.More(); we.Next()) {
            TopoDS_Wire w = TopoDS::Wire(we.Current());
            if (w.IsSame(outer)) continue;
            addRing(w);
        }
        if (rings.empty()) { res.reason = "no usable face wire"; return res; }

        // native (u,v) window extent (for grid sizing + dedup tolerance).
        double pu0 = 1e300, pu1 = -1e300, pv0 = 1e300, pv1 = -1e300;
        for (const auto& r : rings)
            for (const auto& bs : r) {
                pu0 = std::min(pu0, bs.uv[0]); pu1 = std::max(pu1, bs.uv[0]);
                pv0 = std::min(pv0, bs.uv[1]); pv1 = std::max(pv1, bs.uv[1]);
            }
        double du = pu1 - pu0, dv = pv1 - pv0;
        if (!(du > 0) || !(dv > 0)) { res.reason = "degenerate face param window"; return res; }

        // ============ FULL-RECTANGLE-TRIM NURBS FACE — STRUCTURED EXACT GRID ======
        // A NURBS face whose trim IS the whole parameter rectangle [umin,umax]x[vmin,vmax]
        // (one outer loop, no inner holes, the loop running along the 4 rectangle edges —
        // e.g. an extrusion/sweep wall or a single loft patch) is integrated EXACTLY by
        // the tensor-Gauss RECTANGLE path (paramTri=false), the SAME path the native
        // primitives + the periodic walls use. This matters because a NURBS born from a
        // chord/centripetal-parameterised profile has a wildly non-uniform |S_u x S_v|;
        // the general CDT path's single degree-5 triangle rule under-integrates it by a
        // few %, whereas a per-cell 10-pt tensor-Gauss over the rational Jacobian is exact
        // to quadrature precision. We build a structured (nu+1)x(nv+1) grid whose 4 BORDER
        // rows/columns reuse the SAME canonical shared-edge 3-D points the adjacent faces
        // sample (so the wall welds watertight to its caps), and whose interior comes from
        // the exact surface; each cell is one paramTri=false NURBS rectangle sub-face.
        if (fs.kind == nb::SurfaceKind::Nurbs && rings.size() == 1) {
            // Is the single outer loop exactly the rectangle border? (every sample lies on
            // one of the 4 edges within tolerance). If so, the trim is the full rectangle.
            const double rtu = 1e-6 * std::max(1.0, du), rtv = 1e-6 * std::max(1.0, dv);
            bool fullRect = true;
            for (const auto& bs : rings[0]) {
                bool onU = std::fabs(bs.uv[0] - pu0) < rtu || std::fabs(bs.uv[0] - pu1) < rtu;
                bool onV = std::fabs(bs.uv[1] - pv0) < rtv || std::fabs(bs.uv[1] - pv1) < rtv;
                if (!onU && !onV) { fullRect = false; break; }
            }
            if (fullRect) {
                // outward orientation at the rectangle centre.
                bool faceReversed = false;
                {
                    double ou = 0.5 * (umin + umax), ov = 0.5 * (vmin + vmax);
                    gp_Pnt occtP; gp_Vec occtN;
                    forge::native::brep::faceOrientedNormal(face, ou, ov, occtP, occtN);
                    Vec3 faceOutward = nb::vnorm(Vec3{occtN.X(), occtN.Y(), occtN.Z()});
                    double un, vn; occtToNative(ou, ov, un, vn);
                    Vec3 ndu, ndv; evalDeriv(fs, un, vn, ndu, ndv);
                    Vec3 nNat = nb::vnorm(nb::vcross(ndu, ndv));
                    if (nb::vlen(faceOutward) > 0.5 && nb::vlen(nNat) > 0.5)
                        faceReversed = (nb::vdot(nNat, faceOutward) < 0.0);
                }
                auto sharedNs = std::make_shared<const nb::NurbsSurface>(fs.nurbs);
                const int nu = kEdgeSamples, nv = kEdgeSamples;
                auto gx = [&](int iu) { return pu0 + du * iu / nu; };
                auto gy = [&](int iv) { return pv0 + dv * iv / nv; };

                // BORDER welding: the 4 rectangle edges are SHARED with adjacent faces,
                // which sample them from the CANONICAL edge 3-D curve. To weld watertight
                // the structured grid's border vertices MUST be those same canonical points,
                // NOT evalUV (the surface and the edge curve agree geometrically but their
                // PARAMETERS differ, so evalUV at a uniform grid param lands at a slightly
                // different 3-D point than the edge's canonical sample). So we build, for
                // each of the 4 borders, a lookup from the grid index to the canonical 3-D
                // point by binning the outer-wire edge samples (which carry both the native
                // (u,v) and the canonical p3) onto the nearest grid line. A grid border slot
                // with no canonical sample (coarser edge sampling) falls back to evalUV.
                std::vector<Vec3> bU0(nv + 1), bU1(nv + 1), bV0(nu + 1), bV1(nu + 1);
                std::vector<char> hU0(nv + 1, 0), hU1(nv + 1, 0), hV0(nu + 1, 0), hV1(nu + 1, 0);
                for (const BSample& bs : rings[0]) {
                    double u = bs.uv[0], v = bs.uv[1];
                    bool onU0 = std::fabs(u - pu0) < rtu, onU1 = std::fabs(u - pu1) < rtu;
                    bool onV0 = std::fabs(v - pv0) < rtv, onV1 = std::fabs(v - pv1) < rtv;
                    if (onU0 || onU1) { // const-u border: bin by v
                        int iv = (int)std::llround((v - pv0) / dv * nv);
                        if (iv >= 0 && iv <= nv) {
                            if (onU0) { bU0[iv] = bs.p3; hU0[iv] = 1; }
                            else      { bU1[iv] = bs.p3; hU1[iv] = 1; }
                        }
                    }
                    if (onV0 || onV1) { // const-v border: bin by u
                        int iu = (int)std::llround((u - pu0) / du * nu);
                        if (iu >= 0 && iu <= nu) {
                            if (onV0) { bV0[iu] = bs.p3; hV0[iu] = 1; }
                            else      { bV1[iu] = bs.p3; hV1[iu] = 1; }
                        }
                    }
                }
                auto vidAt = [&](int iu, int iv) -> int {
                    // border slots: use the canonical shared-edge point if we have it.
                    if (iu == 0  && hU0[iv]) return weldId(bU0[iv]);
                    if (iu == nu && hU1[iv]) return weldId(bU1[iv]);
                    if (iv == 0  && hV0[iu]) return weldId(bV0[iu]);
                    if (iv == nv && hV1[iu]) return weldId(bV1[iu]);
                    return weldId(evalUV(fs, gx(iu), gy(iv)));
                };
                for (int iu = 0; iu < nu; ++iu)
                    for (int iv = 0; iv < nv; ++iv) {
                        std::vector<int> ring = {vidAt(iu, iv), vidAt(iu + 1, iv),
                                                 vidAt(iu + 1, iv + 1), vidAt(iu, iv + 1)};
                        std::vector<std::array<double,2>> uv = {
                            {gx(iu), gy(iv)}, {gx(iu + 1), gy(iv)},
                            {gx(iu + 1), gy(iv + 1)}, {gx(iu), gy(iv + 1)}};
                        std::vector<int> r; std::vector<std::array<double,2>> u2;
                        for (std::size_t i = 0; i < ring.size(); ++i) {
                            int prev = r.empty() ? ring.back() : r.back();
                            if (ring[i] != prev) { r.push_back(ring[i]); u2.push_back(uv[i]); }
                        }
                        if (r.size() < 3) continue;
                        double cr = 0;
                        for (std::size_t i = 0; i < u2.size(); ++i) {
                            auto& p = u2[i]; auto& q = u2[(i + 1) % u2.size()];
                            cr += p[0] * q[1] - q[0] * p[1];
                        }
                        bool ccw = cr > 0.0;
                        if (ccw == faceReversed) {
                            std::reverse(r.begin() + 1, r.end());
                            std::reverse(u2.begin() + 1, u2.end());
                        }
                        StagedPoly sp;
                        sp.vids = r;
                        sp.kind = nb::SurfaceKind::Nurbs;
                        sp.reversed = faceReversed; sp.paramTri = false;
                        sp.uv = u2;
                        sp.u0 = gx(iu); sp.u1 = gx(iu + 1);
                        sp.v0 = gy(iv); sp.v1 = gy(iv + 1);
                        sp.nurbs = sharedNs;
                        stagedPoly.push_back(std::move(sp));
                    }
                continue;   // full-rectangle NURBS face staged exactly; next face.
            }
        }

        // ---- build the CDT PSLG in native (u,v). Each `pts` entry also carries
        // its CANONICAL 3-D point (from the edge curve) for BOUNDARY points, or a
        // sentinel for interior Steiner points (whose 3-D comes from evalUV). -----
        std::vector<ng::Point2> pts;
        std::vector<Vec3>       pts3D;     // canonical 3-D for boundary, else sentinel
        std::vector<char>       isBoundary;
        std::vector<ng::ConstraintEdge> cons;
        const double tu = 1e-7 * std::max(1.0, du), tv = 1e-7 * std::max(1.0, dv);
        const Vec3 kSentinel{1e308, 1e308, 1e308};
        auto addBoundaryP = [&](double u, double v, const Vec3& p3) -> int {
            for (std::size_t i = 0; i < pts.size(); ++i)
                if (std::fabs(pts[i].x - u) < tu && std::fabs(pts[i].y - v) < tv)
                    return (int)i;
            pts.push_back({u, v}); pts3D.push_back(p3); isBoundary.push_back(1);
            return (int)pts.size() - 1;
        };
        auto addInteriorP = [&](double u, double v) -> int {
            for (std::size_t i = 0; i < pts.size(); ++i)
                if (std::fabs(pts[i].x - u) < tu && std::fabs(pts[i].y - v) < tv)
                    return (int)i;
            pts.push_back({u, v}); pts3D.push_back(kSentinel); isBoundary.push_back(0);
            return (int)pts.size() - 1;
        };
        for (const auto& r : rings) {
            std::vector<int> idx;
            idx.reserve(r.size());
            for (const BSample& bs : r) idx.push_back(addBoundaryP(bs.uv[0], bs.uv[1], bs.p3));
            for (std::size_t i = 0; i < idx.size(); ++i) {
                int a = idx[i], b = idx[(i + 1) % idx.size()];
                if (a != b) cons.push_back({a, b});
            }
        }

        // CURVED faces (non-periodic — e.g. a cut wall): interior Steiner grid so the
        // boundary triangulation is fine enough for a watertight tessellation + Betti
        // (mass is exact via paramTri regardless of grid). Planar faces need none.
        if (curved && fs.kind == nb::SurfaceKind::Nurbs) {
            // NURBS: no analytic radius, so mass accuracy is the quadrature density.
            // Each interior cell becomes paramTri sub-faces whose degree-5 rule
            // integrates that patch; a finer (u,v) grid => more patches => the
            // approximation of a strongly-curved blend/loft tightens. Scale the
            // grid with the control-net span in each direction (more poles between
            // the knot bounds => more curvature to resolve), clamped for cost.
            std::size_t npU = fs.nurbs.control.size();
            std::size_t npV = npU ? fs.nurbs.control[0].size() : 0;
            int nu = std::max(8, std::min(40, 6 * (int)npU));
            int nv = std::max(8, std::min(40, 6 * (int)npV));
            for (int iu = 1; iu < nu; ++iu)
                for (int iv = 1; iv < nv; ++iv)
                    addInteriorP(pu0 + du * iu / nu, pv0 + dv * iv / nv);
        } else if (curved) {
            int nu = std::max(2, (int)std::ceil(du / (2.0 * kPi) * 48.0));
            int nv = std::max(2, (int)std::ceil(dv / std::max(dv, 1e-9) * 6.0));
            if (fs.kind == nb::SurfaceKind::Sphere) nv = std::max(8, nv);
            // A torus patch is doubly angular: v=phi (tube) is as curved as u=theta, so
            // scale BOTH by their angular span and give v a sphere-like floor.
            if (fs.kind == nb::SurfaceKind::Torus) {
                nv = std::max(8, (int)std::ceil(dv / (2.0 * kPi) * 48.0));
            }
            nu = std::min(nu, 96); nv = std::min(nv, 24);
            for (int iu = 1; iu < nu; ++iu)
                for (int iv = 1; iv < nv; ++iv)
                    addInteriorP(pu0 + du * iu / nu, pv0 + dv * iv / nv);
        }

        ng::CDTResult cdt = ng::constrainedDelaunay2D(pts, cons);
        if (!cdt.ok) { res.reason = std::string("face CDT failed: ") + cdt.reason; return res; }

        // ---- per-face OUTWARD orientation, via OCCT's oriented normal ----------
        // faceOrientedNormal (native BRepGProp_Face::Normal) folds in the face's
        // TopAbs orientation, so it points OUT of the solid. We wind each ring CCW about that
        // outward normal (=> mated, opposite-sense shared coedges => closed
        // manifold) and set `reversed` so native normalAt also points OUTWARD.
        // Compare native du x dv vs OCCT's outward normal AT THE SAME physical point
        // (curved faces vary; planar are constant). Sample at OCCT UV-midpoint, and
        // the native (u,v) of that same OCCT point.
        bool faceReversed = false;
        {
            double ou = 0.5 * (umin + umax), ov = 0.5 * (vmin + vmax);
            gp_Pnt occtP; gp_Vec occtN;
            forge::native::brep::faceOrientedNormal(face, ou, ov, occtP, occtN);
            Vec3 faceOutward = nb::vnorm(Vec3{occtN.X(), occtN.Y(), occtN.Z()});
            double un, vn; occtToNative(ou, ov, un, vn);
            Vec3 ndu, ndv; evalDeriv(fs, un, vn, ndu, ndv);
            Vec3 nNat = nb::vnorm(nb::vcross(ndu, ndv));
            if (nb::vlen(faceOutward) > 0.5 && nb::vlen(nNat) > 0.5)
                faceReversed = (nb::vdot(nNat, faceOutward) < 0.0);
        }

        // 3-D point of a CDT mesh point: boundary -> the canonical edge point (so
        // it welds across faces); interior -> evalUV on the exact surface.
        auto meshPoint3D = [&](int mi) -> Vec3 {
            int orig = (mi < (int)cdt.inputIndex.size()) ? cdt.inputIndex[mi] : -1;
            if (orig >= 0 && orig < (int)isBoundary.size() && isBoundary[orig])
                return pts3D[orig];
            const ng::Point2& P = cdt.points[mi];
            return evalUV(fs, P.x, P.y);
        };

        // One shared copy of this OCCT face's NURBS surface (if any), referenced by
        // every staged sub-face — not copied per-triangle (a blend can have many).
        std::shared_ptr<const nb::NurbsSurface> sharedNurbs;
        if (fs.kind == nb::SurfaceKind::Nurbs)
            sharedNurbs = std::make_shared<const nb::NurbsSurface>(fs.nurbs);

        // even-odd `inside` over the closed constraint loops == the annulus for a
        // bored cap. Stage one native sub-face per inside triangle (built below).
        for (std::size_t t = 0; t < cdt.triangles.size(); ++t) {
            if (t < cdt.inside.size() && !cdt.inside[t]) continue;
            const auto& tri = cdt.triangles[t];
            ng::Point2 A = cdt.points[tri[0]];
            ng::Point2 B = cdt.points[tri[1]];
            ng::Point2 C = cdt.points[tri[2]];
            Vec3 pA = meshPoint3D(tri[0]);
            Vec3 pB = meshPoint3D(tri[1]);
            Vec3 pC = meshPoint3D(tri[2]);

            // Wind by PARAMETER orientation (native du x dv), flipped uniformly by
            // `faceReversed` so the winding is OUTWARD — the SAME convention the
            // periodic wall path uses, so wall-rim and cap-rim coedges mate exactly.
            double cr = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
            bool ccw = cr > 0.0;
            if (ccw == faceReversed) { std::swap(pB, pC); std::swap(B, C); }

            int ia = weldId(pA), ib = weldId(pB), ic = weldId(pC);
            if (ia == ib || ib == ic || ia == ic) continue; // degenerate after weld

            StagedFace sfc;
            sfc.vid = {ia, ib, ic};
            sfc.kind = fs.kind; sfc.origin = fs.origin; sfc.axis = fs.axis;
            sfc.refDir = fs.refDir; sfc.r1 = fs.r1; sfc.r2 = fs.r2; sfc.param = fs.param;
            sfc.reversed = faceReversed;
            sfc.uv = {{{{A.x, A.y}}, {{B.x, B.y}}, {{C.x, C.y}}}};
            sfc.paramTri = curved;
            sfc.nurbs = sharedNurbs;
            staged.push_back(std::move(sfc));
        }
    }

    if (staged.empty() && stagedPoly.empty()) { res.reason = "no faces produced triangles"; return res; }

    // ---- DEGENERATE-FIN (back-to-back overlap) REMOVAL -------------------------
    // Where two ANALYTIC fillet faces meet at a shared box/cylinder corner, OCCT's
    // trimming of the two blend surfaces OVERLAPS in a sliver lens at the corner:
    // both faces' p-curves cover the same corner triangle, so the importer stages
    // the SAME 3-D triangle from each face — with OPPOSITE winding (each face's
    // outward normal points the opposite way in the shared lens). That is a
    // zero-volume "fin": a pair of coincident, oppositely-wound triangles whose net
    // geometric contribution is nil but which makes every interior fan edge of the
    // lens used 4× (2 per copy) — a spurious non-2-manifold. (Diagnosed on the
    // box-pocket-fillet and flange-rim-fillet golden models: 6 such pairs at one
    // corner, each appearing twice with identical area and reversed orientation.)
    //
    // The fix removes EXACTLY these back-to-back pairs (same welded vertex SET,
    // opposite winding). It is geometry-neutral — the two slivers were equal-and-
    // opposite, so volume/area/inertia are unchanged to quadrature precision — and
    // it touches ONLY genuinely coincident overlap fins (a clean watertight mesh has
    // none, so the 48 passing models are untouched). It does NOT relax the CDT's
    // PROPER_CROSS test; the CDT per-face triangulation is correct — the defect is
    // the cross-face TRIM OVERLAP, repaired here at the stitch, exactly where
    // Boolean.cpp's stitch also reconciles coincident operand facets.
    {
        // Canonical key for a triangle's vertex SET (sorted) and its directed cyclic
        // identity (to tell winding apart). Two staged faces are a back-to-back pair
        // iff same set + opposite cyclic orientation.
        auto sortedKey = [](const std::array<int, 3>& v) {
            int a = v[0], b = v[1], c = v[2];
            if (a > b) std::swap(a, b);
            if (b > c) std::swap(b, c);
            if (a > b) std::swap(a, b);
            return std::array<int, 3>{a, b, c};
        };
        // +1 if (v) is a cyclic rotation of the ascending-order set's canonical CCW
        // (a<b<c → a,b,c), -1 if it is the reversed (CW) orientation. Degenerate
        // (repeated vid) returns 0 and is left for the existing post-weld guard.
        auto orient = [](const std::array<int, 3>& v) -> int {
            const int a = v[0], b = v[1], c = v[2];
            if (a == b || b == c || a == c) return 0;
            // The three CCW rotations of the ascending triple (lo,mid,hi):
            int lo = std::min({a, b, c}), hi = std::max({a, b, c});
            int mid = a ^ b ^ c ^ lo ^ hi;
            // v matches CCW (lo,mid,hi) up to rotation?
            const bool ccw =
                (a == lo && b == mid && c == hi) ||
                (a == mid && b == hi && c == lo) ||
                (a == hi && b == lo && c == mid);
            return ccw ? +1 : -1;
        };
        // Group staged-triangle indices by their vertex set, tracking orientation.
        struct Slot { std::vector<int> pos, neg; };
        std::map<std::array<int, 3>, Slot> groups;
        for (std::size_t i = 0; i < staged.size(); ++i) {
            int o = orient(staged[i].vid);
            if (o == 0) continue;                       // degenerate — handled elsewhere
            Slot& s = groups[sortedKey(staged[i].vid)];
            (o > 0 ? s.pos : s.neg).push_back((int)i);
        }
        std::vector<char> drop(staged.size(), 0);
        for (auto& kv : groups) {
            Slot& s = kv.second;
            // Cancel as many opposite-wound copies as pair up: each (pos,neg) match
            // is a back-to-back fin → drop BOTH. Leftovers (a genuine single triangle,
            // or an unpaired same-wound duplicate) are kept for the manifold check to
            // judge honestly — we only remove provable equal-and-opposite fins.
            std::size_t np = std::min(s.pos.size(), s.neg.size());
            for (std::size_t k = 0; k < np; ++k) {
                drop[s.pos[k]] = 1;
                drop[s.neg[k]] = 1;
            }
        }
        std::size_t w = 0;
        for (std::size_t i = 0; i < staged.size(); ++i)
            if (!drop[i]) staged[w++] = std::move(staged[i]);
        staged.resize(w);
    }

    // ---- COMBINATORIAL 2-MANIFOLD PRE-CHECK (mirrors Boolean.cpp's stitch) -----
    // Build only AFTER proving every directed edge (a->b) is matched by exactly
    // one opposite (b->a) and no undirected edge appears more than twice, so we
    // never hit TopologyBuilder's non-manifold assert. On failure -> honest defer.
    {
        std::map<std::pair<int, int>, int> directed, undirected;
        for (const StagedFace& sf : staged)
            for (int i = 0; i < 3; ++i) {
                int a = sf.vid[i], b = sf.vid[(i + 1) % 3];
                directed[{a, b}]++;
                undirected[{std::min(a, b), std::max(a, b)}]++;
            }
        for (const StagedPoly& sp : stagedPoly) {
            std::size_t n = sp.vids.size();
            for (std::size_t i = 0; i < n; ++i) {
                int a = sp.vids[i], b = sp.vids[(i + 1) % n];
                directed[{a, b}]++;
                undirected[{std::min(a, b), std::max(a, b)}]++;
            }
        }
        for (const auto& kv : undirected)
            if (kv.second != 2) {
                res.reason = "import not 2-manifold (edge shared by != 2 faces)"; return res; }
        for (const auto& kv : directed) {
            if (kv.second != 1) {
                res.reason = "import not 2-manifold (duplicated directed edge)"; return res; }
            auto opp = directed.find({kv.first.second, kv.first.first});
            if (opp == directed.end() || opp->second != 1) {
                res.reason = "import not 2-manifold (edge not oppositely mated)"; return res;
            }
        }
    }

    // ---- BUILD the native topology (proven manifold above) ---------------------
    verts.assign(vpos.size(), nullptr);
    for (std::size_t i = 0; i < vpos.size(); ++i)
        verts[i] = owner->makeVertex({vpos[i].x, vpos[i].y, vpos[i].z});

    for (const StagedFace& sf : staged) {
        nb::Face* f = owner->makeFace();
        owner->addFaceToShell(shell, f);
        std::vector<nb::Vertex*> ring = {verts[sf.vid[0]], verts[sf.vid[1]], verts[sf.vid[2]]};
        owner->addOuterLoopToFace(f, ring);

        nb::Surface* surf = owner->makeSurface();
        surf->kind = sf.kind; surf->origin = sf.origin; surf->axis = sf.axis;
        surf->refDir = sf.refDir; surf->r1 = sf.r1; surf->r2 = sf.r2;
        surf->param = sf.param; surf->reversed = sf.reversed;
        if (sf.kind == nb::SurfaceKind::Nurbs && sf.nurbs)
            surf->nurbs = *sf.nurbs;   // the EXACT rational surface for this patch
        f->surface = surf;
        f->vertexUV = {sf.uv[0], sf.uv[1], sf.uv[2]};
        f->u0 = std::min({sf.uv[0][0], sf.uv[1][0], sf.uv[2][0]});
        f->u1 = std::max({sf.uv[0][0], sf.uv[1][0], sf.uv[2][0]});
        f->v0 = std::min({sf.uv[0][1], sf.uv[1][1], sf.uv[2][1]});
        f->v1 = std::max({sf.uv[0][1], sf.uv[1][1], sf.uv[2][1]});
        f->paramTri = sf.paramTri;
    }

    for (const StagedPoly& sp : stagedPoly) {
        nb::Face* f = owner->makeFace();
        owner->addFaceToShell(shell, f);
        std::vector<nb::Vertex*> ring;
        ring.reserve(sp.vids.size());
        for (int id : sp.vids) ring.push_back(verts[id]);
        owner->addOuterLoopToFace(f, ring);

        nb::Surface* surf = owner->makeSurface();
        surf->kind = sp.kind; surf->origin = sp.origin; surf->axis = sp.axis;
        surf->refDir = sp.refDir; surf->r1 = sp.r1; surf->r2 = sp.r2;
        surf->param = sp.param; surf->reversed = sp.reversed;
        if (sp.kind == nb::SurfaceKind::Nurbs && sp.nurbs)
            surf->nurbs = *sp.nurbs;   // exact rational surface for this rectangle cell
        f->surface = surf;
        f->vertexUV = sp.uv;
        f->u0 = sp.u0; f->u1 = sp.u1; f->v0 = sp.v0; f->v1 = sp.v1;
        f->paramTri = sp.paramTri;     // false -> exact rectangle parametric integral
    }

    if (!owner->isClosedTwoManifold()) {
        res.reason = "not a closed 2-manifold after import";
        return res;
    }
    nb::EulerCounts c = owner->counts();
    if (c.faces == 0 || c.edges == 0 || c.vertices == 0) {
        res.reason = "empty topology after import";
        return res;
    }

    res.ok = true;
    res.solid = solid;
    res.owner = owner;
    return res;
}

// ===========================================================================
// OCCT sketch WIRE / planar FACE -> native B-rep PROFILE (Sweep.hpp Profile).
// ===========================================================================
namespace {

// Native arc-length uniform sampler over an adaptor curve on [f, l] — the drop-in
// replacement for GCPnts_UniformAbscissa (a TKGeomBase symbol). Fills `params` with
// `nPts` parameters ordered f -> l whose 3-D points are equally spaced by ARC LENGTH
// (params.front()==f, params.back()==l). Method: (1) build a fine cumulative
// arc-length table by composite Simpson integration of the curve speed |C'(t)|
// (adaptor D1, TKG3d — not TKGeomBase); (2) for each target abscissa s_k = k*L/N,
// bracket it in the table and refine the parameter by Newton on
// g(t)=arclen(f,t)-s_k with g'(t)=|C'(t)|, clamped to the bracket. Returns false if
// the curve has ~zero length (caller then falls back to uniform-parameter sampling).
bool nativeUniformAbscissaParams(BRepAdaptor_Curve& ad, int nPts,
                                 double f, double l,
                                 std::vector<double>& params) {
    params.clear();
    if (nPts < 2) return false;
    const int N = nPts - 1;                    // sub-intervals between sample points
    auto speed = [&](double t) -> double {
        gp_Pnt P;
        gp_Vec V;
        ad.D1(t, P, V);
        return V.Magnitude();
    };
    // Fine cumulative arc-length table in the parameter direction f -> l.
    const int M = std::max(N * 16, 256);
    std::vector<double> tt(M + 1), ss(M + 1);
    const double h = (l - f) / M;
    tt[0] = f;
    ss[0] = 0.0;
    double sPrev = speed(f);
    for (int i = 1; i <= M; ++i) {
        const double t0 = f + h * (i - 1);
        const double t1 = f + h * i;
        const double tm = 0.5 * (t0 + t1);
        const double sm = speed(tm), s1 = speed(t1);
        const double seg = std::fabs(h) / 6.0 * (sPrev + 4.0 * sm + s1);  // Simpson
        tt[i] = t1;
        ss[i] = ss[i - 1] + seg;
        sPrev = s1;
    }
    const double L = ss[M];
    if (!(L > 0.0)) return false;
    params.assign(nPts, f);
    params[N] = l;                             // exact endpoints
    const double hsgn = (h >= 0.0) ? 1.0 : -1.0;
    const double eps = std::fabs(l - f) * 1e-12;
    int j = 0;
    for (int k = 1; k < N; ++k) {
        const double sk = L * (double)k / N;
        while (j < M && ss[j + 1] < sk) ++j;   // advance monotone bracket
        const double segLen = ss[j + 1] - ss[j];
        double t = (segLen > 0.0)
                     ? tt[j] + (tt[j + 1] - tt[j]) * (sk - ss[j]) / segLen
                     : tt[j];
        const double lo = std::min(tt[j], tt[j + 1]);
        const double hi = std::max(tt[j], tt[j + 1]);
        for (int it = 0; it < 12; ++it) {
            const double tm2 = 0.5 * (tt[j] + t);
            const double localLen = std::fabs(t - tt[j]) / 6.0 *
                (speed(tt[j]) + 4.0 * speed(tm2) + speed(t));
            const double g = (ss[j] + localLen) - sk;
            const double gp = speed(t);        // |C'(t)|
            if (gp < 1e-30) break;
            double tn = t - g / gp * hsgn;     // Newton step in param space
            if (tn < lo) tn = lo;
            if (tn > hi) tn = hi;
            const bool converged = std::fabs(tn - t) < eps;
            t = tn;
            if (converged) break;
        }
        params[k] = t;
    }
    return true;
}

// Discretise ONE oriented wire edge into ordered 3-D points, in the wire's
// traversal sense. A line edge contributes its two endpoints; a curved edge is
// sampled by nativeUniformAbscissaParams (uniform arc length) into
// kProfileEdgeSamples points. The edge's END vertex is NOT appended here — the wire
// explorer's next edge contributes it (so the ring has no duplicated shared vertex).
// Returns false only if the edge's 3-D curve cannot be read.
bool sampleEdge3D(const TopoDS_Edge& e, bool reversed, std::vector<Vec3>& out) {
    BRepAdaptor_Curve ad(e);
    Standard_Real f = ad.FirstParameter(), l = ad.LastParameter();
    if (!(l > f) && !(f > l)) {
        // zero-length parameter range -> nothing usable from this edge.
        return true;
    }
    const GeomAbs_CurveType ct = ad.GetType();
    auto emit = [&](double param) { out.push_back(toV3(ad.Value(param))); };

    if (ct == GeomAbs_Line) {
        // exact: only the start vertex (the next edge contributes the shared end).
        emit(reversed ? l : f);
        return true;
    }
    // curved edge — native arc-length uniform discretisation over [f,l].
    std::vector<double> uaParams;
    if (nativeUniformAbscissaParams(ad, kProfileEdgeSamples + 1, f, l, uaParams) &&
        uaParams.size() >= 2) {
        const int n = (int)uaParams.size();
        // emit all but the LAST point (the shared end goes to the next edge),
        // honouring traversal direction.
        for (int i = 0; i < n - 1; ++i) {
            int idx = reversed ? (n - 1 - i) : i;     // 0-based sample index
            emit(uaParams[idx]);
        }
        return true;
    }
    // fall back to a uniform PARAMETER sampling if the abscissa solver failed.
    for (int i = 0; i < kProfileEdgeSamples; ++i) {
        double s = (double)i / kProfileEdgeSamples;
        emit(reversed ? (l + (f - l) * s) : (f + (l - f) * s));
    }
    return true;
}

// Project ordered 3-D ring points into the plane (origin, xDir, yDir) -> Point2,
// dropping consecutive (welded) duplicates and the wrap-around duplicate. `tol2`
// is the squared in-plane weld tolerance. Returns false if < 3 distinct points.
bool projectRing(const std::vector<Vec3>& pts3, const Vec3& org,
                 const Vec3& xd, const Vec3& yd, double tol,
                 std::vector<ng::Point2>& ring2) {
    ring2.clear();
    const double tol2 = tol * tol;
    for (const Vec3& p : pts3) {
        Vec3 d = nb::vsub(p, org);
        ng::Point2 q{nb::vdot(d, xd), nb::vdot(d, yd)};
        if (!ring2.empty()) {
            double ddx = q.x - ring2.back().x, ddy = q.y - ring2.back().y;
            if (ddx * ddx + ddy * ddy <= tol2) continue;   // welded duplicate
        }
        ring2.push_back(q);
    }
    // drop the wrap-around duplicate (last == first).
    if (ring2.size() >= 2) {
        double ddx = ring2.front().x - ring2.back().x;
        double ddy = ring2.front().y - ring2.back().y;
        if (ddx * ddx + ddy * ddy <= tol2) ring2.pop_back();
    }
    return ring2.size() >= 3;
}

// signed area of a 2D loop (positive == CCW) — same convention as Sweep::signedArea.
double ringSignedArea(const std::vector<ng::Point2>& r) {
    double a = 0.0;
    for (std::size_t i = 0; i < r.size(); ++i) {
        const auto& p = r[i]; const auto& q = r[(i + 1) % r.size()];
        a += p.x * q.y - q.x * p.y;
    }
    return 0.5 * a;
}

// Find the plane a single wire lies in (OCCT BRepBuilderAPI_FindPlane). Returns
// false (NON-planar / no plane) if the wire's edges are not coplanar.
bool wirePlane(const TopoDS_Wire& w, gp_Pln& pl) {
    BRepBuilderAPI_FindPlane fp(w);
    if (!fp.Found()) return false;
    pl = fp.Plane()->Pln();
    return true;
}

// Sample + project one wire into a 2D ring in the GIVEN plane frame (no orientation
// fix-up here — the caller orients outer CCW / hole CW).
bool ringFromWire(const TopoDS_Wire& w, const TopoDS_Face* faceForPCurve,
                  const Vec3& org, const Vec3& xd, const Vec3& yd, double tol,
                  std::vector<ng::Point2>& ring2, std::string& why) {
    std::vector<Vec3> pts3;
    if (faceForPCurve) {
        for (BRepTools_WireExplorer ex(w, *faceForPCurve); ex.More(); ex.Next()) {
            TopoDS_Edge e = ex.Current();
            bool rev = (ex.Current().Orientation() == TopAbs_REVERSED);
            if (!sampleEdge3D(e, rev, pts3)) { why = "wire edge has no 3-D curve"; return false; }
        }
    } else {
        for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
            TopoDS_Edge e = ex.Current();
            bool rev = (ex.Current().Orientation() == TopAbs_REVERSED);
            if (!sampleEdge3D(e, rev, pts3)) { why = "wire edge has no 3-D curve"; return false; }
        }
    }
    if (pts3.size() < 3) { why = "wire produced < 3 ring points (open or degenerate)"; return false; }
    if (!projectRing(pts3, org, xd, yd, tol, ring2)) {
        why = "projected ring degenerate (< 3 distinct in-plane points)"; return false; }
    if (std::fabs(ringSignedArea(ring2)) <= tol * tol) {
        why = "projected ring has zero area"; return false; }
    return true;
}

} // namespace

ProfileImportResult importOcctProfile(const TopoDS_Wire& wire) {
    ProfileImportResult r;
    if (wire.IsNull()) { r.reason = "null wire"; return r; }

    gp_Pln pl;
    if (!wirePlane(wire, pl)) {
        r.reason = "non-planar wire (no exact plane for sketch profile — deferred)";
        return r;
    }
    const gp_Ax3& ax = pl.Position();
    const Vec3 org = toV3(ax.Location());
    const Vec3 xd  = nb::vnorm(toV3(ax.XDirection()));
    const Vec3 yd  = nb::vnorm(toV3(ax.YDirection()));
    const Vec3 nrm = nb::vnorm(toV3(ax.Direction()));

    // plane-scale weld tolerance from the wire bbox diagonal (cheap: vertex span).
    double diag = 1.0;
    {
        double lo[3] = {1e300,1e300,1e300}, hi[3] = {-1e300,-1e300,-1e300};
        for (TopExp_Explorer ve(wire, TopAbs_VERTEX); ve.More(); ve.Next()) {
            Vec3 p = toV3(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())));
            for (int k = 0; k < 3; ++k) { double v = (&p.x)[k];
                lo[k] = std::min(lo[k], v); hi[k] = std::max(hi[k], v); }
        }
        diag = std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0]) + (hi[1]-lo[1])*(hi[1]-lo[1]) +
                         (hi[2]-lo[2])*(hi[2]-lo[2]));
        if (!(diag > 0)) diag = 1.0;
    }
    const double tol = 1e-7 * std::max(1.0, diag);

    std::vector<ng::Point2> outer;
    std::string why;
    if (!ringFromWire(wire, nullptr, org, xd, yd, tol, outer, why)) { r.reason = why; return r; }

    // orient OUTER CCW (Profile contract).
    if (ringSignedArea(outer) < 0.0) std::reverse(outer.begin(), outer.end());
    r.profile.outer = std::move(outer);
    r.profile.holes.clear();

    r.origin = {{org.x, org.y, org.z}};
    r.normal = {{nrm.x, nrm.y, nrm.z}};
    r.xDir   = {{xd.x,  xd.y,  xd.z}};
    r.yDir   = {{yd.x,  yd.y,  yd.z}};
    r.ok = true;
    return r;
}

ProfileImportResult importOcctProfile(const TopoDS_Face& face) {
    ProfileImportResult r;
    if (face.IsNull()) { r.reason = "null face"; return r; }

    // Only a PLANAR sketch face has an exact 2D profile; defer otherwise.
    BRepAdaptor_Surface ad(face, Standard_True);
    if (ad.GetType() != GeomAbs_Plane) {
        r.reason = "non-planar sketch face (only a planar profile face imports — deferred)";
        return r;
    }
    gp_Pln pl = ad.Plane();
    const gp_Ax3& ax = pl.Position();
    const Vec3 org = toV3(ax.Location());
    const Vec3 xd  = nb::vnorm(toV3(ax.XDirection()));
    const Vec3 yd  = nb::vnorm(toV3(ax.YDirection()));
    const Vec3 nrm = nb::vnorm(toV3(ax.Direction()));

    double diag = 1.0;
    {
        double lo[3] = {1e300,1e300,1e300}, hi[3] = {-1e300,-1e300,-1e300};
        for (TopExp_Explorer ve(face, TopAbs_VERTEX); ve.More(); ve.Next()) {
            Vec3 p = toV3(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())));
            for (int k = 0; k < 3; ++k) { double v = (&p.x)[k];
                lo[k] = std::min(lo[k], v); hi[k] = std::max(hi[k], v); }
        }
        diag = std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0]) + (hi[1]-lo[1])*(hi[1]-lo[1]) +
                         (hi[2]-lo[2])*(hi[2]-lo[2]));
        if (!(diag > 0)) diag = 1.0;
    }
    const double tol = 1e-7 * std::max(1.0, diag);

    TopoDS_Wire outerW = BRepTools::OuterWire(face);
    std::vector<ng::Point2> outer;
    std::string why;
    if (!ringFromWire(outerW, &face, org, xd, yd, tol, outer, why)) { r.reason = why; return r; }
    if (ringSignedArea(outer) < 0.0) std::reverse(outer.begin(), outer.end());
    r.profile.outer = std::move(outer);
    r.profile.holes.clear();

    // every OTHER wire on the face is a HOLE loop -> CW ring inside the outer.
    for (TopExp_Explorer we(face, TopAbs_WIRE); we.More(); we.Next()) {
        TopoDS_Wire w = TopoDS::Wire(we.Current());
        if (w.IsSame(outerW)) continue;
        std::vector<ng::Point2> hole;
        std::string hwhy;
        if (!ringFromWire(w, &face, org, xd, yd, tol, hole, hwhy)) { r.reason = hwhy; return r; }
        if (ringSignedArea(hole) > 0.0) std::reverse(hole.begin(), hole.end()); // CW
        r.profile.holes.push_back(std::move(hole));
    }

    r.origin = {{org.x, org.y, org.z}};
    r.normal = {{nrm.x, nrm.y, nrm.z}};
    r.xDir   = {{xd.x,  xd.y,  xd.z}};
    r.yDir   = {{yd.x,  yd.y,  yd.z}};
    r.ok = true;
    return r;
}

}  // namespace forge

#endif  // FORGE_NATIVE_BREP
