// forge/native/brep/NativeSectionFill.hpp — TKGeomAlgo-free N-section skin.
//
// ROUTINE (kernel OCCT-zero drop plan, reports/KERNEL_DROP_MASTER_PLAN.md):
// a native, self-contained replacement for the ONE TKGeomAlgo symbol group that
// keeps forge::part::loftWithGuides (Features.cpp) linked to that toolkit —
//
//   * GeomFill_NSections(TColGeom_SequenceOfCurve)                 (TKGeomAlgo)
//   * GeomFill_NSections::ComputeSurface()                         (TKGeomAlgo)
//   * GeomFill_NSections::BSplineSurface()                         (TKGeomAlgo)
//   * (its vtable)                                                 (TKGeomAlgo)
//
// GeomFill_NSections, fed only a family of section curves, skins a single
// B-spline surface through them (u = the section curve, v = interpolation across
// the ordered sections). This file reproduces that as the TEXTBOOK NURBS SKINNED
// (lofted) SURFACE — Piegl & Tiller, "The NURBS Book" ch.10.3:
//
//   1. convert every section to a B-spline via forge::occtconv::curveToBSpline
//      (native, TKG3d/TKMath — the R2 analytic->NURBS converter),
//   2. make the sections COMPATIBLE: reparametrise to a common [0,1] u-domain,
//      degree-elevate all to the common max degree (Geom_BSplineCurve::
//      IncreaseDegree, TKG3d), then merge to one common u-knot vector
//      (Geom_BSplineCurve::InsertKnots with Add=false = raise-to-max, TKG3d) —
//      after which every section has the SAME degree, knots and pole count,
//   3. INTERPOLATE across the sections in v: for each u control-column, fit a
//      global v-interpolating B-spline through the K section poles (averaged
//      chord-length parameters + averaged v-knots, P&T eq 10.8 / 9.8; one shared
//      collocation matrix, solved per column). Rational sections are skinned in
//      homogeneous (w*x,w*y,w*z,w) coordinates so weights are honoured EXACTLY.
//
// The result INTERPOLATES every input section (a loft passes THROUGH its
// sections) — a faithful, arguably stronger contract than GeomFill_NSections'
// tolerance-bounded approximation; the Features.cpp caller only needs a valid
// Geom_BSplineSurface to wrap in a face.
//
// DROP HYGIENE. Uses ONLY surviving toolkits: gp_ / TColgp_ / TColStd_ (TKMath),
// Geom_BSplineCurve / Geom_BSplineSurface concrete classes + their member ops
// (TKG3d), and forge::occtconv (native). NO GeomFill_, NO GeomAPI_, NO
// GeomConvert, NO Approx_/AppDef_ symbol is referenced. A null Handle return is
// an HONEST DEFER (fewer than 2 sections, a section that would not convert, or a
// compatibility mismatch) — the caller keeps OCCT's GeomFill_NSections compiled
// behind an #ifdef fallback until the A/B on the loft fixtures passes and
// TKGeomAlgo is removed from OCCT_LIBS. See the wiring plan in NativeSectionFill.cpp.

#ifndef FORGE_NATIVE_BREP_NATIVESECTIONFILL_HPP
#define FORGE_NATIVE_BREP_NATIVESECTIONFILL_HPP

#ifdef FORGE_NATIVE_BREP

#include <Geom_BSplineSurface.hxx>
#include <Geom_Curve.hxx>
#include <TColGeom_SequenceOfCurve.hxx>

#include <vector>

namespace forge {
namespace occtfill {

// Skin a B-spline surface through the ordered section curves. 1:1 drop-in for
//   GeomFill_NSections(sections); f.ComputeSurface(); return f.BSplineSurface();
// `vDegreeMax` caps the v (across-section) degree; the realised v-degree is
// min(vDegreeMax, sections-1) so K=2 sections skin RULED (v-degree 1). Null =>
// defer (< 2 sections, a section fails to convert, or a compatibility mismatch).
Handle(Geom_BSplineSurface) sectionFillSurface(const TColGeom_SequenceOfCurve& sections,
                                               int vDegreeMax = 3);

// Same, taking a std::vector of section curves (convenience overload).
Handle(Geom_BSplineSurface) sectionFillSurface(const std::vector<Handle(Geom_Curve)>& sections,
                                               int vDegreeMax = 3);

}  // namespace occtfill
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVESECTIONFILL_HPP
