// forge/native/brep/NativeFilling.hpp — TKOffset-free BOUNDARY FILL on a
// TopoDS_Wire.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset family C). A native,
// self-contained OCCT-TYPED replacement for the TKOffset symbol group that keeps
// forge::heal::autoFillMissingFaces (src/Healing.cpp) linked to that toolkit —
//
//   family C  BRepOffsetAPI_MakeFilling::{ctor(int,int,int,bool,double,double,
//             double,double,int,int), Add(Edge,GeomAbs_Shape,bool), Build,
//             IsDone} + vtable                                     (5 symbols)
//
// ===========================================================================
// WHAT THE CALL SITE ACTUALLY ASKS FOR — and why that is exactly solvable
// ===========================================================================
// src/Healing.cpp adds EVERY boundary edge with GeomAbs_C0 and adds NOTHING
// else: no tangency constraint, no interior point, no interior curve. So the
// requested object is the weakest one BRepFill_Filling can build — a patch that
// merely INTERPOLATES a closed boundary with C0 continuity. For a PLANAR
// boundary that patch is the PLANE region the boundary encloses, and that region
// is representable EXACTLY as a Geom_Plane face trimmed by the wire itself. No
// fitting, no sampling, no approximation is needed or wanted.
//
// ★ MEASURED 2026-08-28, OCCT 7.9 on this machine — the native answer is not
//   merely equal to OCCT's, it is STRICTLY MORE ACCURATE:
//
//     boundary                     OCCT MakeFilling      exact planar face
//     10x10 square at z=3          area 100              area 100
//                                  com (5,5,3)           com (5,5,3)
//                                  surface B-SPLINE      surface PLANE
//                                  face bbox padded      face bbox == the wire's
//                                    to [-0.5,-0.5]-       [0,0,3]-[10,10,3]
//                                    [10.5,10.5]
//     circle r=5 at z=0            area 78.5398652       area 78.53981634
//                                  com off by ~7e-7      com at the origin to 1e-16
//                                  (exact pi r^2 = 78.53981634)
//
//   OCCT returns a B-SPLINE APPROXIMATION whose area is wrong in the 7th
//   significant figure on a curved boundary, and whose face bounding box
//   overshoots the trimmed region because the supporting surface extends past
//   the trim. The native answer is the exact analytic plane, area exact to
//   machine epsilon and bounded exactly by its own boundary. The A/B therefore
//   compares native against OCCT where OCCT is exact (a polygonal boundary) and
//   against the CLOSED FORM where OCCT is not (a circular boundary), asserting
//   OCCT's error rather than inheriting it.
//
// ===========================================================================
// SCOPE — EXACT, no fitting, no tessellation
// ===========================================================================
//   A CLOSED wire whose every point lies within `tol` of a single plane. Edges
//   may be lines, arcs, or any curve, so long as the whole curve — not merely
//   its endpoints — is planar: each edge is SAMPLED along its parameter range
//   and every sample is tested, so an arc that bulges out of the endpoint plane
//   is rejected rather than silently flattened. The result is one Geom_Plane
//   face trimmed by the wire.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape, IsNull() == true)
// ===========================================================================
//   * a null, open, or edge-less wire
//   * a boundary that is NOT planar within tol (the genuinely 3-D patch case —
//     a Coons/Gregory N-sided fill, which this engine does not pretend to have)
//   * a planar boundary the face builder still refuses (self-intersecting or
//     degenerate)
//
// ★ WHY A DEFER IS SAFE AT THIS CALL SITE, unlike families D/E/F. Healing.cpp
//   already wraps its filling attempt in try/catch and SKIPS any wire it cannot
//   fill, leaving it as a residual open edge counted in the after-report. So
//   under FORGE_FILLING_DROP_NATIVE a deferred wire takes the SAME path a failed
//   OCCT filling already takes today — the drop cannot turn a fillable hole into
//   a thrown error, it can only leave a non-planar hole unfilled, which is
//   reported honestly in AutoFillReport.facesAdded / openEdgesAfter.
//
// PROOF: forge-kernel/test/run_ab_native_filling.sh — area AND centre of mass
// AND bbox AND face/edge/vertex counts AND validity AND the surface TYPE, plus
// a whole-solid end-to-end (cap a box missing one face, then compare the sewn
// SOLID's volume, centre of mass, bbox and validity), a closed-form oracle, a
// NEGATIVE CONTROL that rejects two faces of equal area, and defer controls.
//
// DROP HYGIENE. Only TKBRep/TKTopAlgo/TKG3d/TKMath are used below; no
// BRepOffset*, BRepOffsetAPI*, BRepFill* or GeomPlate_* symbol appears. The A/B
// asserts that on this file's own object file.

#ifndef FORGE_NATIVE_BREP_NATIVEFILLING_HPP
#define FORGE_NATIVE_BREP_NATIVEFILLING_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>

namespace forge {
namespace occtfill {

// Is the native attempt live at the call site? Two states, mirroring the
// family-D/E/F routing in src/native/brep/NativeLoftPipe.cpp:
//   * FORGE_FILLING_DROP_NATIVE defined -> ALWAYS true: the OCCT fallback is
//     compiled out, so the native engine is the only path.
//   * otherwise -> the environment opt-in FORGE_FILLING_NATIVE=1, DEFAULT OFF,
//     so the shipped kernel is unchanged.
bool fillingNativeEnabled();

// Fill the closed boundary `w` with a C0-interpolating patch. 1:1 drop-in for
//   BRepOffsetAPI_MakeFilling f;
//   for (e : edges of w) f.Add(e, GeomAbs_C0);
//   f.Build();  if (f.IsDone()) use f.Shape();
// Returns the trimmed planar TopoDS_Face, or a null TopoDS_Shape on HONEST
// DEFER (see the banner for the complete list).
TopoDS_Shape fillC0Boundary(const TopoDS_Wire& w, double tol = 1.0e-6);

}  // namespace occtfill
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEFILLING_HPP
