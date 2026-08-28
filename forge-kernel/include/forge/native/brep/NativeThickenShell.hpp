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
// TWO PATHS
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
//   * any face that is not a Geom_Plane;
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
//     bracket the decomposition guarantees.

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
