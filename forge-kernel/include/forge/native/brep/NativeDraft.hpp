// forge/native/brep/NativeDraft.hpp — TKOffset-free DRAFT on a TopoDS_Shape.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset FAMILY J). A native,
// self-contained OCCT-TYPED replacement for the last-but-one TKOffset symbol
// group that keeps forge::part::draftFaces (src/Features.cpp) linked to that
// toolkit —
//
//   BRepOffsetAPI_DraftAngle::BRepOffsetAPI_DraftAngle(TopoDS_Shape const&)
//   BRepOffsetAPI_DraftAngle::Add(TopoDS_Face const&, gp_Dir const&, double,
//                                 gp_Pln const&, bool)
//   BRepOffsetAPI_DraftAngle::AddDone() const
//   BRepOffsetAPI_DraftAngle::Remove(TopoDS_Face const&)
//   BRepOffsetAPI_DraftAngle::Build(Message_ProgressRange const&)
//   vtable for BRepOffsetAPI_DraftAngle                            (6 symbols)
//
// It exists because forge::native::brep::draftBoxAnalytic
// (include/forge/native/brep/DraftAnalytic.hpp) already solves this problem
// EXACTLY on the NATIVE analytic B-rep and therefore cannot be reached from an
// OCCT-backed handle. This is its OCCT-TopoDS mirror, and it is strictly more
// general: DraftAnalytic covers the canonical cube's four side walls about z=0,
// this file covers any planar-faced solid, any face subset, any neutral plane.
//
// ===========================================================================
// THE FORMULATION, NAMED
// ===========================================================================
// Draft (taper / mould-release angle) is the classical HALF-SPACE ARRANGEMENT
// edit of a polyhedron: a convex polyhedron is the intersection of the
// half-spaces of its face planes, and its vertices are the meets of their
// incident planes (Preparata & Shamos, *Computational Geometry*, ch. 7 —
// the plane/vertex duality; the same identity NativeThickSolid.cpp's family-H
// offset uses). Drafting does not add, delete or re-type a single face: it
// REPLACES the plane of each selected face by that plane ROTATED about its
// intersection line with the neutral plane, and then re-derives every vertex as
// the meet of its (possibly rotated) incident planes.
//
//   * ROTATION AXIS. For a face plane {n . x = d} and neutral plane
//     {m . x = e}, the axis is their intersection line L, direction
//     a = (n x m)/|n x m|. L is non-empty iff |n . m| != 1. The point of L
//     closest to the origin is p0 = alpha*n + beta*m with
//         alpha = (d - c e)/(1 - c^2),  beta = (e - c d)/(1 - c^2),  c = n . m,
//     which is the 2x2 normal-equation solve of {n.p=d, m.p=e} in the span{n,m}
//     plane — exact, and the (1 - c^2) denominator IS the parallel-plane guard.
//
//   * ROTATED PLANE. With a . n = 0, Rodrigues collapses to
//         n' = n cos(theta) + (a x n) sin(theta),        d' = n' . p0.
//     Setting u = a x n (a unit vector lying IN the face plane, perpendicular to
//     L), a face point p = p0 + s*a + w*u is displaced OUTWARD along the new
//     normal by exactly w*sin(theta), and its signed height above the neutral
//     plane is h = w*(m . u). So the wall tapers linearly with height at the
//     rate tan(theta) — which is the definition of a draft angle, and is why
//     nothing here is an approximation of OCCT's answer: it IS the answer.
//
//   * SIGN. theta = +angleRad with m oriented along the PULL direction, so a
//     POSITIVE angle leans every selected wall INTO the material as height above
//     the neutral plane increases (the mould-release sense) and shrinks the
//     volume. This matches BRepOffsetAPI_DraftAngle's own convention for the same
//     (face, pull, angle, neutral) arguments. It was MEASURED, not assumed: the
//     first A/B run used -angleRad and every case came back exactly MIRRORED
//     (cube 5 deg: 1185.18 grown against OCCT's 835.23 shrunk). The A/B asserts
//     equality of the drafted SOLIDS, not merely of some scalar, so a sign error
//     cannot pass.
//
//   * VERTEX RE-MEET. Every vertex is re-derived as the least-squares meet of
//     its incident face planes (NativeThickSolid.cpp's intersectPlanes, reused
//     verbatim) and then VERIFIED to lie on each of them to 1e-7. An
//     over-determined apex whose planes no longer meet in a point after the
//     rotation is DECLINED, never averaged into a plausible wrong vertex.
//
// ===========================================================================
// DROP HYGIENE. Uses ONLY surviving toolkits: gp_* (TKMath), Geom_Plane (TKG3d),
// TopoDS_/TopExp/BRep_Tool/BRepTools/BRepTools_WireExplorer/BRepLib (TKBRep),
// BRepBuilderAPI_MakePolygon/MakeFace/Sewing + BRepGProp (TKTopAlgo), and
// forge::occtheal::solidFromShell (the in-house TKShHealing-free
// ShapeFix_Solid subset). NO BRepOffset*, NO BRepOffsetAPI* symbol is
// referenced — asserted on this TU's object file by the A/B harness.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape, IsNull() == true) — never a
// plausible wrong shape:
//   * any face of the solid that is not a Geom_Plane (a drafted cylinder becomes
//     a cone and the adjacent trims change type; that is a different engine);
//   * any face carrying more than one wire (a hole's ring drafts too);
//   * a selected face whose plane is PARALLEL to the neutral plane — there is no
//     rotation axis, and OCCT's own Add() rejects it as well;
//   * a selected face not present in the shape;
//   * a vertex with fewer than three incident faces, a rank-deficient meet, or a
//     meet whose residual against any incident plane exceeds 1e-7*max(1,|d|);
//   * a rebuilt face that collapses, a sew that leaves a free edge, more than one
//     resulting shell, a face-count change, or a non-positive volume;
//   * |angle| >= 90 degrees, or an angle of exactly 0 (the caller wants a no-op,
//     and returning the input unchanged from a "draft" would hide a bug).

#ifndef FORGE_NATIVE_BREP_NATIVEDRAFT_HPP
#define FORGE_NATIVE_BREP_NATIVEDRAFT_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>

namespace forge {
namespace occtdraft {

// Is the native attempt live at the call site? Two states, mirroring the
// family-C/D/E/F routing:
//   * FORGE_DRAFT_DROP_NATIVE defined -> ALWAYS true: the OCCT fallback is
//     compiled out, so the native engine is the only path.
//   * otherwise -> the environment opt-in FORGE_DRAFT_NATIVE=1, DEFAULT OFF, so
//     the shipped kernel is byte-for-byte unchanged.
bool draftNativeEnabled();

// Tilt every face in `faces` by `angleRad` about its intersection line with the
// `neutral` plane, in the mould-release sense for the `pull` direction, and
// re-trim the solid. 1:1 drop-in for
//   BRepOffsetAPI_DraftAngle mk(shape);
//   for (f : faces) { mk.Add(f, pull, angleRad, neutral); if (!mk.AddDone()) mk.Remove(f); }
//   mk.Build();  if (mk.IsDone()) use mk.Shape();
// — except that a face this engine cannot draft makes the WHOLE call defer
// (null shape) rather than being silently dropped from the feature, because a
// half-applied draft is a wrong part, not a partial success.
TopoDS_Shape draftFaces(const TopoDS_Shape& shape,
                        const TopTools_ListOfShape& faces,
                        const gp_Dir& pull,
                        double angleRad,
                        const gp_Pln& neutral,
                        double tol = 1.0e-6);

}  // namespace occtdraft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEDRAFT_HPP
