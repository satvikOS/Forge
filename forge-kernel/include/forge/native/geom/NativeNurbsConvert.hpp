// forge/native/geom/NativeNurbsConvert.hpp
//
// ROUTINE R2 (kernel OCCT-zero drop plan, reports/KERNEL_DROP_MASTER_PLAN.md):
// native, self-contained replacements for the THREE TKGeomBase / TKGeomAlgo
// symbols that keep the STEP write/import path linked to those toolkits —
//
//   * GeomConvert::CurveToBSplineCurve(Handle(Geom_Curve)[,ParamType])   (TKGeomBase)
//   * GeomConvert::SurfaceToBSplineSurface(Handle(Geom_Surface))          (TKGeomBase)
//   * GeomAPI_PointsToBSpline(pts, degMin, degMax, cont, tol).Curve()     (TKGeomAlgo)
//   * GeomAPI::To2d / GeomAPI::To3d(curve, gp_Pln)                        (TKGeomAlgo)
//
// EXACTNESS. Every analytic primitive we actually emit (line, circle/arc,
// ellipse; plane, cylinder, cone, sphere, torus; Bezier) has an EXACT rational
// (or polynomial) B-spline form — the poles/weights/knots are reproduced to
// machine precision, NOT approximated. The exact forms are catalogued and
// verified in reports/nurbs_forms_reference.md; this file is the code
// realisation of that reference.
//
// DROP HYGIENE. The builders below reference ONLY gp_ (TKMath), Geom_ / Geom2d_
// concrete classes (TKG3d / TKG2d) and the Geom_BSpline* constructors (TKG3d) —
// all of which SURVIVE the TKGeomBase + TKGeomAlgo drop. No GeomConvert, no
// GeomAPI, no Convert_*ToBSpline*, no Extrema_* symbol is referenced. Swapping
// the call sites onto these entry points removes TKGeomBase's 4 remaining
// exclusive symbols and TKGeomAlgo's To2d/To3d + PointsToBSpline exclusives.
//
// A null Handle return is an HONEST DEFER (the type is not covered / the trim is
// unbounded) — the caller keeps OCCT's GeomConvert/GeomAPI compiled behind an
// #ifdef fallback until the per-routine A/B on the Models-OS fixtures passes and
// the toolkit is removed from OCCT_LIBS (see the wiring plan in
// NativeNurbsConvert.cpp).

#ifndef FORGE_NATIVE_GEOM_NATIVENURBSCONVERT_HPP
#define FORGE_NATIVE_GEOM_NATIVENURBSCONVERT_HPP

#ifdef FORGE_NATIVE_BREP

#include <Geom2d_Curve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <gp_Pln.hxx>

namespace forge {
namespace occtconv {

// --- Analytic curve -> exact B-spline. 1:1 drop-in for
//     GeomConvert::CurveToBSplineCurve(c). Handles (through any Geom_TrimmedCurve
//     wrapper): Geom_Line (deg-1), Geom_Circle / Geom_Ellipse (rational quadratic,
//     n = ceil(sweep/90 deg) spans), Geom_BezierCurve (knot-insert = clamp),
//     Geom_BSplineCurve (segment/copy). Any other analytic (parabola / hyperbola /
//     offset) is sampled and least-squares fitted via pointsToBSpline (a faithful
//     approximation, matching GeomConvert's own tolerance-bounded behaviour) —
//     keep the OCCT fallback for those until validated. Null => defer.
Handle(Geom_BSplineCurve) curveToBSpline(const Handle(Geom_Curve)& c);

// --- Analytic surface -> exact B-spline. 1:1 drop-in for
//     GeomConvert::SurfaceToBSplineSurface(s). Handles (through any
//     Geom_RectangularTrimmedSurface wrapper): Geom_Plane (bilinear),
//     Geom_CylindricalSurface / Geom_ConicalSurface (bidegree (2,1), rational in u),
//     Geom_SphericalSurface / Geom_ToroidalSurface (bidegree (2,2), rational),
//     Geom_BezierSurface (knot-insert), Geom_BSplineSurface (segment/copy).
//     Requires a FINITE UV window (the callers wrap unbounded quadrics in a
//     Geom_RectangularTrimmedSurface first). Null => defer.
Handle(Geom_BSplineSurface) surfaceToBSpline(const Handle(Geom_Surface)& s);

// --- Least-squares B-spline through points (Piegl & Tiller, The NURBS Book ch.9).
//     1:1 drop-in for GeomAPI_PointsToBSpline(pts, degMin, degMax, cont, tol).Curve().
//     Chord-length parametrisation; endpoints interpolated; interior control points
//     from the normal equations (native SPD solve). Falls back to full
//     interpolation when the point set is small or the approximation residual
//     exceeds `tol`. Non-rational. Null => fewer than 2 points.
Handle(Geom_BSplineCurve) pointsToBSpline(const TColgp_Array1OfPnt& pts,
                                          int    degMin = 3,
                                          int    degMax = 8,
                                          double tol    = 1.0e-6);

// --- Planar 2D<->3D lift/drop. 1:1 drop-in for GeomAPI::To3d / GeomAPI::To2d.
//     to3d embeds a 2D curve into plane `pln` ((x,y) -> O + x*Xdir + y*Ydir);
//     to2d projects a 3D curve that lies in `pln` back to plane coordinates.
//     Concrete-type preserving (line->line, circle->circle, ellipse->ellipse,
//     bezier->bezier, bspline->bspline, trimmed->trimmed) so the caller's fast
//     paths and pcurve fidelity are unchanged. Null => unsupported class.
Handle(Geom_Curve)   to3d(const Handle(Geom2d_Curve)& c2, const gp_Pln& pln);
Handle(Geom2d_Curve) to2d(const Handle(Geom_Curve)&   c3, const gp_Pln& pln);

}  // namespace occtconv
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_GEOM_NATIVENURBSCONVERT_HPP
