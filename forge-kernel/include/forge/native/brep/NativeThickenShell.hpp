// forge/native/brep/NativeThickenShell.hpp — TKOffset-free THICKEN on a TopoDS_Shape.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset FAMILY I). A native,
// self-contained OCCT-TYPED replacement for the last TKOffset symbol group that
// keeps forge::part::thickenSurface (src/Features.cpp) linked to that toolkit —
//
//   BRepOffset_MakeOffset::BRepOffset_MakeOffset()
//   BRepOffset_MakeOffset::Initialize(TopoDS_Shape const&, double, double,
//                                     BRepOffset_Mode, bool, bool,
//                                     GeomAbs_JoinType, bool, bool)
//   BRepOffset_MakeOffset::MakeThickSolid(Message_ProgressRange const&)
//   BRepOffset_MakeOffset::IsDone() const
//   BRepOffset_MakeOffset::Shape() const                            (5 symbols)
//
// This is the "Thicken" command (SolidWorks Insert > Boss/Base > Thicken, Fusion
// Thicken, NX Thicken): skin an OPEN shell into a closed solid of wall thickness
// |t|. It is a DIFFERENT operation from NativeThickSolid.cpp's family G/H, which
// HOLLOW a CLOSED solid — that is why family G/H did not cover it.
//
// ===========================================================================
// THE FORMULATION, NAMED — and why OCCT's answer is not the union of prisms
// ===========================================================================
// Offsetting a shell by |t| with the ARC join (GeomAbs_Arc, which is what the
// call site passes) is the MINKOWSKI SUM of the shell with a ball of radius |t|,
// restricted to one side — the classical formulation of Rossignac & Requicha,
// "Offsetting operations in solid modelling", CAGD 3(2):129-148, 1986. In that
// formulation the offset body of a polyhedral input decomposes EXACTLY into
//
//     union over faces    of the face's PRISM        (the flat wall)
//   + union over CONVEX edges of a CYLINDRICAL wedge of radius |t|
//   + union over CONVEX vertices of a SPHERICAL wedge of radius |t|
//
// and nothing else: at a CONCAVE edge the two prisms already overlap, so the
// union alone is exact there. "Convex" is with respect to the OFFSET direction.
//
// ★ THIS IS MEASURED, NOT ASSERTED. Against live OCCT at offset magnitude 2
//   (recorded in forge-kernel/CMakeLists.txt, family I banner):
//       shell                          OCCT volume    fuse-of-prisms
//       single planar face 20x10          400            400   MATCH
//       L shell, t=+2 (concave corner)    560            560   MATCH
//       L shell, t=-2 (convex corner)     631.4159265    600   MISMATCH
//       U shell, t=+2 (two convex)        862.8318531    800   MISMATCH
//   631.4159265 - 600 = 10*pi and 862.8318531 - 800 = 20*pi: quarter-cylinders
//   of radius 2 and length 10, (pi*2^2/4)*10 = 10*pi, one per convex edge. The
//   two MATCH rows are exactly the cases with no convex edge. So the decomposition
//   above is not a model of OCCT's behaviour — it IS OCCT's behaviour, and the A/B
//   reproduces all four rows.
//
// ★ OCCT IS A VALID ORACLE HERE, unlike MakePipe / MakePipeShell / MakeThickSolid
//   (whose defects are documented in the family D/E/F/G banners): every probe of
//   BRepOffset_MakeOffset in this scope returned a BRepCheck-VALID solid whose
//   volume matched the closed form. So this family is proved by direct A/B.
//
// ===========================================================================
// FOUR PATHS
// ===========================================================================
// (A) COPLANAR — every face of the shell lies in ONE plane (a single face, or a
//     sewn flat patchwork). The offset body is the shell's own PRISM along t*n.
//     There is no edge or vertex wedge because there is no fold. Built with one
//     BRepPrimAPI_MakePrism: exact, V = area*|t|, topology identical to OCCT's.
//     This is the path both shipped smoke tests (thicken_surface_smoke.js,
//     knit_surface_smoke.js) exercise.
//
// (B) FOLDED — planar faces meeting along straight edges. Per the decomposition:
//     prism every face, add a cylindrical sector wedge along every CONVEX shared
//     edge, fuse, then remove the fuse's coplanar seams with
//     ShapeUpgrade_UnifySameDomain so the result carries the same face inventory
//     a single offset operation would. The sector wedge is built from a
//     Geom_Circle arc and two segments — no primitive-boolean trimming and no
//     tessellation — so its volume is exactly (theta/2)*|t|^2*L.
//
// (C) ONE CYLINDRICAL FACE trimmed to its WHOLE parametric rectangle. The offset
//     body is the annular tube between radii R and R+t over the face's v-range,
//     assembled from canonical primitives (occtCylinderSolid CUT occtCylinderSolid)
//     rather than revolved, so it carries the two Geom_CylindricalSurface walls and
//     two Geom_Plane annular caps OCCT returns. Selected by the RECTANGLE
//     CERTIFICATE, area(f) == R*du*dv, which is exact rather than heuristic.
//
// (D) ONE CYLINDRICAL FACE whose trim is NOT that rectangle — a holed or otherwise
//     non-rectangular patch. The offset faces are the SAME face re-based onto radius
//     R+t with every pcurve kept (the radial scale is LINEAR and preserves (u,v)),
//     and the body is closed by a wall over each free boundary edge: a plane over a
//     ruling or a coaxial arc, an exact degree-(p,1) ruled B-spline otherwise. This
//     is the path that closed the family's deletion bucket — see the PATH D banner in
//     src/native/brep/NativeThickenShell.cpp for the construction, the measurement,
//     and the two rejected alternatives (BRepBuilderAPI_GTransform, which degrades the
//     cylinder to a B-spline and carries 0.3% area error; and a fitted plane over a
//     B-spline rail, which took the corpus from 23/23 to 18/23).
//
// ===========================================================================
// DROP HYGIENE. Uses ONLY toolkits ALREADY in the load closure and ALREADY named
// on the link line: gp_* (TKMath), Geom_Plane/Geom_Circle/Geom_Line (TKG3d),
// TopoDS_/TopExp/BRep_Tool/BRepTools/BRepTools_WireExplorer (TKBRep),
// BRepBuilderAPI_MakeEdge/MakeWire/MakeFace/Sewing + BRepGProp + BRepCheck
// (TKTopAlgo), BRepPrimAPI_MakePrism (TKPrim, already a DIRECT link record),
// BRepAlgoAPI_Fuse (TKBO, already in the closure and already called), and
// ShapeUpgrade_UnifySameDomain (TKShHealing, already linked and already called
// from Healing.cpp). NO BRepOffset*, NO BRepOffsetAPI* symbol is referenced —
// asserted on this TU's object file by the A/B harness. This engine therefore
// adds ZERO libraries to OCCT_CLOSURE while removing TKOffset's last five
// symbols; the honest reading is that it converts a TKOffset dependency into
// dependencies the binary already had, which is exactly what makes the toolkit's
// link record disappear.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape, IsNull() == true):
//   * a thickness of zero, or a non-finite one;
//   * on the PLANAR paths (A/B), any face that is not a Geom_Plane. A LONE
//     cylindrical face is NOT declined — it goes to path C or D;
//   * an edge shared by more than two faces (non-manifold);
//   * a shared edge that is not a straight segment (a fold about a curve needs a
//     swept wedge, not a prismed sector);
//   * a fold whose two offset normals are anti-parallel (a 180-degree fold-back),
//     or whose sector bisector does not point away from BOTH plates — the
//     self-check that the wedge really is the gap;
//   * a CONVEX VERTEX where three or more non-coplanar faces meet: the spherical
//     wedge of the decomposition above is NOT built by this version, so rather
//     than emit a body missing a corner patch the whole call declines;
//   * a fuse that fails, a result that is not exactly one solid with one shell,
//     a non-positive volume, or a volume outside the [max prism, sum of parts]
//     bracket the decomposition guarantees;
//   * on path C, an offset radius that reaches the axis, or a PARTIAL u-span (the
//     two planar side walls are not built by that path);
//   * on path D, a boundary edge that is not a Line / coaxial Circle / B-spline, a
//     straight edge that is not a ruling of the cylinder, rails that do not share a
//     control structure, a sew that does not close to exactly one shell, a result
//     that is not one BRepCheck-valid solid, or a volume that misses the closed form
//     area(f)*(Rhi^2-Rlo^2)/(2R).
//
// ===========================================================================
// WHAT IS MEASURED, AND WHERE. forge-kernel/test/run_ab_native_thicken.sh is the
// live-OCCT A/B (338 assertions, 0 failed) and asserts on this engine's OBJECT FILE
// that it imports ZERO TKOffset symbol. The COVERAGE claim is separate and is made by
// test/run_corpus_ab_coverage.sh over all 600 gold reference solids, stride 1:
//
//     THICKEN   native 600/600   OCCT 600/600   deletion bucket 0   PASS
//
// Before path D that read 577/600 against 600/600 with a 23-part bucket. Note what
// the coverage number does NOT say: 0 of the 600 both-OK pairs agree on the full
// observable vector, because OCCT returns this solid NEGATIVELY oriented and this
// engine normalises it (595 agree up to |volume|). Of the 5 that differ beyond
// orientation, all 5 are path-C parts on which OCCT splits the cylindrical wall into
// extra faces — native 4/6/4 against OCCT 6/13/8 — with volume and area bit-identical.
// Those 5 predate path D and are unchanged by it.

#ifndef FORGE_NATIVE_BREP_NATIVETHICKENSHELL_HPP
#define FORGE_NATIVE_BREP_NATIVETHICKENSHELL_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Shape.hxx>

namespace forge {
namespace occtthicken {

// Is the native attempt live at the call site? Two states, mirroring the
// family-C/D/E/F routing:
//   * FORGE_THICKEN_DROP_NATIVE defined -> ALWAYS true: the OCCT fallback is
//     compiled out, so the native engine is the only path.
//   * otherwise -> the environment opt-in FORGE_THICKEN_NATIVE=1, DEFAULT OFF, so
//     the shipped kernel is byte-for-byte unchanged.
bool thickenNativeEnabled();

// Skin the OPEN shell (or single face) `shell` into a closed solid of wall
// thickness |t|, offsetting each face along sign(t) * its own oriented normal.
// 1:1 drop-in for
//   BRepOffset_MakeOffset mk;
//   mk.Initialize(shell, t, tol, BRepOffset_Skin, false, false, GeomAbs_Arc, true);
//   mk.MakeThickSolid();  if (mk.IsDone()) use mk.Shape();
// Returns a null TopoDS_Shape on HONEST DEFER (see the banner for the list).
TopoDS_Shape thickenShell(const TopoDS_Shape& shell, double t, double tol = 1.0e-4);

// Why the LAST thickenShell call on THIS thread declined, as a stable, quotable
// sentence ("a face is not a Geom_Plane", "a convex fold ends at a 3-or-more-plate
// corner ...", "the n-ary fuse of prisms and wedges failed", ...). Empty after a
// call that succeeded. A silent null tells a caller only THAT the engine declined;
// the point of an honest defer is that the reason is inspectable, and the A/B
// asserts the exact reason for every one of its defer controls rather than
// settling for "it returned null".
const char* thickenLastDeferReason();

}  // namespace occtthicken
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVETHICKENSHELL_HPP
