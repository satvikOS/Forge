// forge/native/brep/NativeThickSolid.hpp — TKOffset-free planar/prismatic HOLLOW.
//
// ROUTINE (kernel OCCT-zero drop plan). A native, self-contained OCCT-TYPED
// replacement for the ONE TKOffset symbol group that keeps forge::part::shell
// (Features.cpp) linked to that toolkit for the PRISMATIC case —
//
//   * BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin(...)        (TKOffset)
//   * BRepOffset_MakeOffset::MakeThickSolid(...) [the engine it drives] (TKOffset)
//   * (their vtables)                                               (TKOffset)
//
// BRepOffsetAPI_MakeThickSolid, fed a solid + a list of faces to remove + a wall
// thickness, HOLLOWS the solid to a shell of uniform wall thickness, leaving the
// removed faces as open mouths. This file reproduces that OP for the PLANAR /
// PRISMATIC class (every boundary face is a Geom_Plane — box, prism, wedge,
// bracket, any convex polyhedron) as the exact analytic construction already
// proven, on the pure-native B-rep, by forge::native::brep::shellSolid
// (src/native/brep/Shell.cpp — READ that first; this is its OCCT-TopoDS mirror):
//
//   1. OUTWARD PLANE per face: n = plane normal flipped by TopAbs_REVERSED,
//      d0 = n . (point on face). Offset the plane INWARD by t: d = d0 - t.
//   2. INNER CORNER per vertex: the meet of the offset planes of the RETAINED
//      faces incident to that vertex (least-squares 3-plane intersection, exact
//      for a convex corner). A vertex that also bounds a REMOVED face is PINNED
//      into that removed face's ORIGINAL (un-offset) plane, so a mouth corner
//      lands on the open rim (Shell.cpp step 2).
//   3. INNER FACES: for each retained face, a polygon over its ordered outer-wire
//      vertices' inner corners, wound REVERSE so its normal points into the cavity.
//   4. LIP FACES: for each removed face, one planar quad per rim edge joining the
//      two outer rim points to the two inner corners (the wall lip of thickness t).
//   5. SEW outer(unchanged) + inner + lip faces (BRepBuilderAPI_Sewing) into one
//      shell, close-check (NbFreeEdges==0), then ShapeFix_Solid -> a valid solid.
//
// DROP HYGIENE. Uses ONLY surviving toolkits: gp_/gp_Pln (TKMath), Geom_Plane
// (TKG3d), TopoDS_/TopExp/BRep_Tool/BRepTools/BRepTools_WireExplorer (TKBRep),
// BRepBuilderAPI_MakePolygon/MakeFace/Sewing/MakeSolid + BRepGProp (TKTopAlgo),
// ShapeFix_Solid (TKShHealing). NO BRepOffset*, NO BRepOffsetAPI*, NO BRepPrim*,
// NO GeomFill_/Approx_ symbol is referenced.
//
// HONEST DEFER (returns a null TopoDS_Shape, IsNull()==true): any non-planar face,
// ZERO openings (a fully-closed void needs a two-shell solid — left to OCCT),
// t >= the solid's minimum half-extent, a degenerate corner meet, or a sew that
// does not close. The caller keeps OCCT's BRepOffsetAPI_MakeThickSolid compiled
// behind an #ifdef fallback until the A/B on the shell fixtures passes and
// TKOffset is removed from OCCT_LIBS. See the wiring plan in NativeThickSolid.cpp.

#ifndef FORGE_NATIVE_BREP_NATIVETHICKSOLID_HPP
#define FORGE_NATIVE_BREP_NATIVETHICKSOLID_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>

namespace forge {
namespace occtoffset {

// Hollow `shape` to a uniform wall of thickness `t` (>0), removing every face in
// `facesToRemove` (leaving those as open mouths). 1:1 drop-in for the prismatic
// case of
//   BRepOffsetAPI_MakeThickSolid mk;
//   mk.MakeThickSolidByJoin(shape, facesToRemove, t, tol); mk.Build();
//   return mk.Shape();
// Convention matches forge::native::brep::shellSolid: t>0 offsets the retained
// faces INWARD, so the outer boundary is preserved and the cavity is inset by t.
// Returns a null TopoDS_Shape on HONEST DEFER (see header banner for the list).
TopoDS_Shape makeThickSolid(const TopoDS_Shape& shape, double t,
                            const TopTools_ListOfShape& facesToRemove,
                            double tol = 1.0e-3);

}  // namespace occtoffset
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVETHICKSOLID_HPP
