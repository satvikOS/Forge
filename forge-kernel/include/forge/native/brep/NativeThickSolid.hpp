// forge/native/brep/NativeThickSolid.hpp — TKOffset-free HOLLOW on a TopoDS_Shape.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset family G/H). A native,
// self-contained OCCT-TYPED replacement for the TKOffset symbol group that keeps
// forge::part::shell (src/Features.cpp) linked to that toolkit —
//
//   * BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin(...)        (TKOffset)
//   * BRepOffset_MakeOffset::MakeThickSolid(...) [the engine it drives] (TKOffset)
//   * (their vtables)                                               (TKOffset)
//
// BRepOffsetAPI_MakeThickSolid, fed a solid + a list of faces to remove + a wall
// thickness, HOLLOWS the solid to a shell of uniform wall thickness, leaving the
// removed faces as open mouths. This file reproduces that OP on the SURVIVING
// toolkits only (TKMath/TKG3d/TKBRep/TKTopAlgo/TKShHealing). A null
// TopoDS_Shape is an HONEST DEFER — never a plausible wrong shape.
//
// It exists because forge::native::brep::shellSolid (src/native/brep/Shell.cpp)
// solves the same problem on the NATIVE B-rep and therefore cannot be reached
// from an OCCT-backed handle. This is its OCCT-TopoDS mirror; read Shell.cpp
// first for the geometric intent.
//
// ===========================================================================
// SCOPE — two paths, both EXACT, no tessellation on either
// ===========================================================================
//
// (A) PLANAR / PRISMATIC (every face is a Geom_Plane): box, prism, wedge,
//     bracket, any polyhedron.
//       1. OUTWARD PLANE per face: n = plane normal flipped by TopAbs_REVERSED,
//          d0 = n . (point on face). Offset the plane INWARD by t: d = d0 - t.
//       2. INNER CORNER per vertex: the meet of the offset planes of the
//          RETAINED faces incident to that vertex (least-squares 3-plane
//          intersection, exact for a convex corner). A vertex that also bounds a
//          REMOVED face is PINNED into that removed face's ORIGINAL (un-offset)
//          plane, so a mouth corner lands on the open rim.
//       3. INNER FACES: for each retained face, a polygon over its ordered
//          outer-wire vertices' inner corners, wound REVERSE so its normal
//          points into the cavity.
//       4. LIP FACES: for each removed face, one planar quad per rim edge.
//       5. SEW + close-check + solid.
//
// (B) QUADRIC (2026-07-31). Faces may be Geom_{Plane, CylindricalSurface,
//     ConicalSurface, SphericalSurface, ToroidalSurface}. This path exists
//     because PLANAR-ONLY is useless in practice: measured over the 1,613
//     kernel-verified trees of data/forge/complex_all.jsonl, **0 are all-planar**
//     and all 1,613 carry cylindrical faces
//     (reports/TKOFFSET_DECOMPOSITION.md §5).
//
//     EXACT SURFACE PRESERVATION. Every cavity face keeps its analytic type —
//     the offset of a cylinder is a cylinder, of a cone a cone, of a sphere a
//     sphere, of a torus a torus:
//         plane     : location += d * normal
//         cylinder  : R    -> R + d                  (same gp_Ax3)
//         sphere    : R    -> R + d                  (same gp_Ax3)
//         torus     : r    -> r + d                  (same gp_Ax3, same major R)
//         cone      : Rref -> Rref + d / cos(a)      (same gp_Ax3, same a)
//     Nothing is tessellated, sampled or spline-fitted. In particular this file
//     NEVER routes through src/NativeOcctBridge.cpp, whose TopoDS bridge falls
//     back to tessellateSolid (welded triangle soup) for curved input — that
//     would silently corrupt every downstream measurement.
//
//     THE RE-TRIM IS CLOSED FORM, not a marching intersector. Offsetting also
//     moves every shared edge. For a CIRCLE edge with axis A, both adjacent
//     surfaces necessarily contain that circle as a circle of revolution about
//     A (a plane containing it is perpendicular to A; a cylinder/cone containing
//     it is coaxial — any other planar section of those is an ellipse; a sphere
//     containing it has its centre on A; a torus containing it as a "parallel"
//     is coaxial). The normal of a surface of revolution lies in the meridian
//     half-plane, so its offset is a surface of revolution about the SAME A, and
//     offsetting the surface is exactly offsetting its MERIDIAN in (rho, z).
//     Each supported meridian is a LINE (plane / cylinder / cone) or a CIRCLE
//     (sphere / torus), so the new edge is a line/line, line/circle or
//     circle/circle meet — closed form, yielding a true gp_Circ. The full
//     derivation, including the cone offset, is in NativeThickSolid.cpp.
//
//     Both a MOUTH (>=1 removed face: outer skin + cavity + lip, sewn into one
//     shell) and a CLOSED HOLLOW (no removed face: a two-shell solid) are built.
//     The closed-hollow mode is a capability ADD, not a port: OCCT's
//     MakeThickSolid returns the CAVITY or a negative volume there while
//     reporting IsDone() == true (reports/TKOFFSET_DECOMPOSITION.md §4.2).
//
// ===========================================================================
// DROP HYGIENE. Uses ONLY surviving toolkits: gp_* (TKMath), Geom_Plane /
// Geom_CylindricalSurface / Geom_ConicalSurface / Geom_SphericalSurface /
// Geom_ToroidalSurface / Geom_Circle (TKG3d), TopoDS_/TopExp/BRep_Tool/BRepTools/
// BRepTools_WireExplorer/BRepLib (TKBRep), BRepBuilderAPI_MakeEdge/MakeWire/
// MakePolygon/MakeFace/Sewing + BRepGProp (TKTopAlgo), occtheal::solidFromShell
// (the in-house TKShHealing-free ShapeFix_Solid subset). NO BRepOffset*, NO
// BRepOffsetAPI*, NO BRepPrim*, NO GeomFill_/Approx_ symbol is referenced.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape, IsNull() == true):
//   * a face that is not one of the five supported analytic surfaces;
//   * a non-planar face that is not a full revolution in u, or that carries more
//     than one wire (a hole through a curved wall needs a real 2-D trim, not a
//     parametric rectangle);
//   * a non-planar face with a boundary edge that is not a circle coaxial with it;
//   * a planar face with a wire that is not exactly one full circle — so MIXED
//     polygonal+quadric solids are declined (the all-planar case has its own path);
//   * two adjacent removed faces (a zero-width lip);
//   * an offset that collapses a radius or inverts a v-range;
//   * t >= the solid's minimum half-extent (planar path);
//   * a sew that does not close, or an assembled solid that fails its own volume
//     identity self-check.
//
// GATE. test/native_thicksolid_closedform.mjs drives this engine through
// forge::part::shellNativeThick (which has NO OCCT fallback, so a pass has
// necessarily measured native geometry) against CLOSED FORMS for the
// cylinder / cone / sphere / torus / tube shells — derived, not borrowed from
// OCCT, because §4.2 shows OCCT is not a valid oracle for shell.
//
// The oracle is TOPOLOGY *and* POSITION *and* VALIDITY, not volume. Volume
// alone ratifies a wrong solid, and so does volume plus a surface-type census:
// MEASURED on case 1, the correct shell and the shell built at the WRONG END of
// the same cylinder agree to the last printed digit on volume (3795.043925536),
// on surface area (3920.707631680), on every count in the sub-shape census
// (1 solid, 1 shell, 5 faces, 6 wires, 6 edges, 4 vertices), on the surface
// signature (cylinder:10 plane plane *cylinder:8 *plane) and on validity. So
// per case the gate asserts:
//
//   * the closed-form VOLUME and total surface AREA (rel tol 1e-12);
//   * the closed-form CENTRE OF MASS, all three components;
//   * the complete sub-shape CENSUS via forge.direct.topoCounts — the shell
//     term is the one a sew gets wrong (a mouthless shell is 1 solid / 2
//     shells, outer plus reversed inner; an open one is 1 solid / 1 shell
//     because the lip joins them);
//   * per face: its surface type and radius AND its exact area, its axial
//     centroid and its outward-normal / axis z-component — every face pinned
//     to a PLACE, which is what rejects the mirror image;
//   * VALIDITY: forge.heal.checkValidity (closed, manifold, oriented, no
//     self-intersection, no non-manifold edge, no bad face or edge) plus
//     forge.shapecheck.analyse.
//
// It also carries NEGATIVE CONTROLS: valid equal-volume solids built WITHOUT
// this engine that the oracle must reject, and which it must reject on the
// POSITION terms specifically. PROVEN falsifiable — a one-line off-by-one in
// makeThickSolid's removedSet (pin the mouth to the other planar face) leaves
// case 1's volume matching the reference to 3.6e-16 and its whole census
// unmoved; the pre-2026-08-28 gate PASSED that mutant, this one fails it on
// centroid (16.483444 against 13.516556) and on the per-face heights.
//
// WIRING. src/Features.cpp keeps BRepOffsetAPI_MakeThickSolid as the live path;
// the native attempt there is opt-in via FORGE_THICKSOLID_NATIVE=1 and falls
// through on defer. The flip gate is the corpus A/B demanded by
// reports/TKOFFSET_DECOMPOSITION.md §5 step 6 — "native success rate >= the
// measured OCCT baseline" — not "it compiles". Note also that TKOffset needs ALL
// 38 remaining symbols across its other families gone before the link record
// moves at all; this family alone changes the closure by exactly zero.

#ifndef FORGE_NATIVE_BREP_NATIVETHICKSOLID_HPP
#define FORGE_NATIVE_BREP_NATIVETHICKSOLID_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>

namespace forge {
namespace occtoffset {

// Hollow `shape` to a uniform wall of thickness `t` (>0), removing every face in
// `facesToRemove` (leaving those as open mouths; an EMPTY list builds a fully
// enclosed void as a two-shell solid). 1:1 drop-in for
//   BRepOffsetAPI_MakeThickSolid mk;
//   mk.MakeThickSolidByJoin(shape, facesToRemove, t, tol); mk.Build();
//   return mk.Shape();
// Convention matches forge::native::brep::shellSolid: t>0 offsets the retained
// faces INWARD, so the outer boundary is preserved and the cavity is inset by t.
// Returns a null TopoDS_Shape on HONEST DEFER (see the header banner for the
// complete list).
TopoDS_Shape makeThickSolid(const TopoDS_Shape& shape, double t,
                            const TopTools_ListOfShape& facesToRemove,
                            double tol = 1.0e-3);

// ---------------------------------------------------------------- family H
// Whole-solid GROW / SHRINK: slide EVERY boundary face along its OWN outward
// normal by the signed `dist` and re-trim adjacent faces to their new mutual
// intersections (the SHARP / GeomAbs_Intersection join). 1:1 drop-in for
//   BRepOffsetAPI_MakeOffsetShape mk;
//   mk.PerformByJoin(shape, dist, tol, BRepOffset_Skin,
//                    /*Intersection*/false, /*SelfInter*/false, GeomAbs_Intersection);
//   TopoDS_Shape off = mk.Shape();      // a SHELL the caller wraps into a solid
// — except that this returns the SOLID directly, already oriented to positive
// volume, so the caller's BRepBuilderAPI_MakeSolid wrap is a no-op on it.
//
// dist > 0 grows, dist < 0 shrinks. Returns a null TopoDS_Shape on HONEST DEFER;
// the complete defer list is in the PART 5b banner of NativeThickSolid.cpp. The
// engine shares the thick-solid's corner solve and closed-form circle re-trim,
// so it inherits the same exactness and the same analytic-surface scope: planar
// polyhedra, and solids whose faces are Geom_{Plane, Cylindrical, Conical,
// Spherical, Toroidal} with full-revolution curved faces and circular planar
// wires. NURBS faces, faces with holes, and rank-deficient or over-determined
// corners are declined, never approximated.
TopoDS_Shape offsetSolidShape(const TopoDS_Shape& shape, double dist,
                              double tol = 1.0e-7);

// ---------------------------------------------------------- diagnostics
// WHY did the most recent offsetSolidShape call ON THIS THREAD return a null
// shape? A '|'-joined trail of the guard labels it hit, each "<path>/<guard>"
// — e.g. "planar/face_has_hole" or "quadric/planar_wire_not_single_edge" —
// where <path> is the dispatch branch that ran (entry / planar / quadric).
// DIAGNOSTIC ONLY: recording it changes no predicate, tolerance or branch, and
// the string is meaningless (stale) after a call that SUCCEEDED. It exists so a
// coverage measurement can ATTRIBUTE family H's defer column instead of
// reporting a bare null — the same contract as occtloft::lastDeferReason.
const char* lastOffsetDeferReason();

}  // namespace occtoffset
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVETHICKSOLID_HPP
