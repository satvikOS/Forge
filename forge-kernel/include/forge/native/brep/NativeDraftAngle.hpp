// forge/native/brep/NativeDraftAngle.hpp — TKOffset-free FACE DRAFT on a TopoDS_Shape.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset **family C**). A native,
// self-contained OCCT-TYPED replacement for the one TKOffset symbol group that
// keeps forge::part::draftFaces (src/Features.cpp) linked to that toolkit:
//
//   BRepOffsetAPI_DraftAngle::BRepOffsetAPI_DraftAngle(const TopoDS_Shape&)
//   BRepOffsetAPI_DraftAngle::Add(const TopoDS_Face&, const gp_Dir&, double,
//                                 const gp_Pln&, bool)
//   BRepOffsetAPI_DraftAngle::AddDone() const
//   BRepOffsetAPI_DraftAngle::Build(const Message_ProgressRange&)
//   BRepOffsetAPI_DraftAngle::Remove(const TopoDS_Face&)
//   vtable for BRepOffsetAPI_DraftAngle
//                                                       — 6 symbols, 1 call site.
//
// ★ THIS FAMILY MOVES OCCT_CLOSURE BY EXACTLY ZERO. TKOffset keeps loading until
//   ALL 38 of its remaining symbols are gone (families B, D, E, F, G, H, I too),
//   and even then the ledger only goes 14 -> 13. The value here is reducing the
//   BLOCKING SET. Do not report this file as a drop.
//
// ===========================================================================
// WHAT A DRAFT IS, AS A CLOSED FORM (measured against OCCT, not assumed)
// ===========================================================================
// A draft tilts a selected face about the line where it meets a NEUTRAL PLANE, so
// a moulded part releases from its tool. Writing p̂ for the pull direction (the
// neutral plane's normal), o for a point on the neutral plane, and
//
//     h(x) = (x - o) · p̂            the signed height of x above the neutral plane
//
// the drafted surface is the original surface displaced along the face's OUTWARD
// normal m by exactly  -h·tan(alpha):  material RECEDES as you climb toward +p̂.
// Every number below was read off the shipped OCCT path before a line was written
// (the oracle runs are in the report), so the sign convention is measured:
//
//   box 10^3, neutral z=0, pull +Z, face x=10 (m=+X), alpha=+3deg
//       OCCT V = 973.796110358        closed form 1000 - 500·tan3 = 973.796110358
//   same, alpha = -3deg
//       OCCT V = 1026.203889642       closed form 1000 + 500·tan3   (draft ADDS)
//   box 10^3, all four side walls, alpha=+5deg
//       OCCT V = 835.228361276        the exact square frustum
//   box 10^3, neutral z=5 (mid-height), all four walls, alpha=+5deg
//       OCCT V = 1002.551422082       closed form 1000 + (1000/3)·tan^2(5deg)
//                                     — ABOVE the neutral plane the wall leans in,
//                                       BELOW it flares out. Both happen at once.
//   cylinder r=10 h=30, lateral face, neutral z=0, alpha=+3deg
//       OCCT V = 8020.640499186       the exact CONE frustum r: 10 -> 10-30·tan3
//                                     — a drafted CYLINDER is a CONE, exactly.
//   40x40x20 block with a Ø12 through bore, bore wall drafted +3deg
//       OCCT V = 29319.898287215      bore becomes a cone r: 6 -> 6+20·tan3
//                                     — an INNER wall opens out; the sign follows
//                                       the face's own outward normal.
//
// So: PLANE -> PLANE, CYLINDER -> CONE, CONE -> CONE. All three are exact, and
// all three stay analytic. Nothing here is sampled, fitted or tessellated.
//
// ===========================================================================
// HOW IT IS BUILT — a LOCALISED difference, never a global half-space
// ===========================================================================
// The naive implementation intersects the solid with the drafted half-space. That
// is correct only when the original face's plane SUPPORTS the whole solid, and it
// silently mills away unrelated geometry the moment it does not (an L-bracket's
// inner flank is the standard counter-example). This engine instead builds the
// two exact difference bodies and applies them locally:
//
//   PLANAR face F, outward normal m, drafted plane N·x = c with N = m + tan(a)·p̂:
//       P_in  = F extruded by -d·m        (a prism through the material side)
//       P_out = F extruded by +d·m        (a prism through the void side)
//       W_cut = P_in  ∩ {N·x >= c}        material the draft REMOVES
//       W_add = P_out ∩ {N·x <= c}        material the draft ADDS
//       result = (S \ W_cut) ∪ W_add
//   Both prisms inherit F's own trimming — inner wires included — so the change is
//   confined to F's footprint exactly the way OCCT's local re-trim is. d is derived
//   from F's own bounding box (d > max|h·tan a| over F), so both W bodies are
//   BOUNDED and every boolean runs solid-against-solid.
//
//   CYLINDRICAL / CONICAL face coaxial with p̂, radius profile r(h) (linear in h):
//       A = the solid of revolution of r(h)                over F's axial span
//       B = the solid of revolution of r(h) - s·h·tan(a)   over F's axial span
//   where s = +1 when the outward normal points AWAY from the axis (a boss) and
//   s = -1 when it points TOWARD it (a bore). r(h) - s·h·tan(a) is again linear in
//   h, therefore again a true cone.
//       boss: W_cut = A \ B, W_add = B \ A
//       bore: W_cut = B \ A, W_add = A \ B
//   Both bodies span only the face's own axial extent, so a boss on a plate drafts
//   the boss and leaves the plate alone.
//
// Multi-face selections resolve EVERY face's geometry against the ORIGINAL shape
// first and only then apply the accumulated booleans, so drafting all four walls of
// a box yields the union of four wedges — i.e. the exact square frustum — and never
// a sequence-dependent answer.
//
// ===========================================================================
// DROP HYGIENE — the point of the file
// ===========================================================================
// Uses ONLY toolkits that SURVIVE the TKOffset drop, and adds no toolkit the kernel
// does not already link:
//   gp_* (TKMath) · Geom_{Plane,CylindricalSurface,ConicalSurface} (TKG3d) ·
//   TopoDS_/TopExp/BRep_Tool/BRepTools (TKBRep) · BRepBndLib/BRepGProp (TKTopAlgo) ·
//   BRepBuilderAPI_Transform (TKTopAlgo) · forge::occt{Box,Cylinder,Cone}Solid and
//   forge::occtPrism (src/OcctPrimBuilder.cpp — pure TKG3d/TKBRep/TKTopAlgo, NO TKPrim) ·
//   BRepAlgoAPI_{Cut,Fuse,Common} (TKBO, already used by src/Features.cpp).
// Verified with nm on the shipped OCCT 7.9 dylibs: BRepAlgoAPI_* is exported by libTKBO
// — NOT by libTKBool, which is the library that dropping TKOffset+TKFillet frees, and
// which this file therefore must not and does not touch.
//
// ★ CORRECTED 2026-08-07. This list previously read "BRepPrimAPI_{MakePrism,MakeBox,
//   MakeCone} (TKPrim, already used by src/Primitives.cpp)". That was FALSE when it was
//   written: the K-PRIM drop of 2026-07-21 had already retired the last TKPrim consumer,
//   Primitives.cpp included. Acting on the stale premise put 12 TKPrim symbols back into
//   the binary and took OCCT_PHANTOM from 2 to 3 — a native replacement written to
//   REMOVE a toolkit had added one. Before claiming a toolkit is "already linked",
//   measure it: `bash scripts/occt_closure_count.sh`, and nm -u the .node against that
//   toolkit's exports. Do not read it off a comment.
// NO BRepOffset*, NO BRepOffsetAPI*, NO BRepFilletAPI*, NO BRepAlgo_* (old TKBool
// API), NO Draft_* symbol is referenced.
//
// ★ NO FACETING. Every body built here is an analytic primitive (prism of the real
// trimmed face, box, cone) and every combination is an exact OCCT boolean on the
// B-rep. This file NEVER routes through src/NativeOcctBridge.cpp, whose native<->
// TopoDS bridge falls back to tessellateSolid (welded triangle soup) for curved
// input; putting curved geometry through that path would silently corrupt every
// downstream measurement, so a curved face this engine cannot express analytically
// is an HONEST DEFER, never a tessellated approximation.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape, IsNull() == true, with a reason)
// ===========================================================================
//   * a selected face that is not a Geom_{Plane, CylindricalSurface,
//     ConicalSurface} — sphere / torus / B-spline walls have no linear draft;
//   * a planar face whose normal is parallel to the pull direction: there is no
//     in-plane draft tangent (OCCT throws on exactly this input too);
//   * a cylinder / cone whose axis is not parallel to the pull direction — the
//     drafted surface is then not a surface of revolution, so it is not a cone;
//   * a cylinder / cone face that is not a full 2·pi revolution in u, or that
//     carries an inner wire (a partial wall needs a real angular trim);
//   * |alpha| >= 80 deg, or a taper that drives a radius to <= 0 inside the face's
//     own span (the wall would invert);
//   * any boolean that fails, or a result whose volume is non-finite / non-positive.
// A defer is NEVER a wrong shape. With FORGE_OFFSET_DROP_DRAFT=OFF the caller falls
// back to the OCCT branch on a defer; with it ON the caller throws the reason.
//
// GATE. test/native_draft_ab.mjs — a closed-form matrix (box wall, four walls,
// negative angle, mid-height neutral plane, cylinder->cone, bore->cone) asserted
// against DERIVED volumes, plus the same shapes through OCCT so the A/B is on one
// binary. The flip gate is the corpus sweep demanded by
// reports/TKOFFSET_DECOMPOSITION.md §5 step 6 — "native defers where OCCT succeeds"
// (LOST) must be 0 — not "it compiles".

#ifndef FORGE_NATIVE_BREP_NATIVEDRAFTANGLE_HPP
#define FORGE_NATIVE_BREP_NATIVEDRAFTANGLE_HPP

#ifdef FORGE_NATIVE_BREP

#include <cstdint>
#include <string>
#include <vector>

#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

namespace forge {
namespace occtdraft {

// Draft the faces of `src` named by `faceIds` (0-based TopExp_Explorer FACE order —
// the SAME convention as forge::part::faceById, so the caller passes its ids
// through untouched) by `angleRad` about the neutral plane through
// `neutralOrigin` with normal / pull direction `pull`.
//
// A POSITIVE angle makes material recede along each face's own outward normal as
// height above the neutral plane increases (the mould-release direction); a
// negative angle adds material. Below the neutral plane the sense reverses, which
// is what OCCT does and what the mid-height fixture measures.
//
// Returns the drafted shape, or a NULL TopoDS_Shape on an honest defer, in which
// case `*why` (when non-null) carries the reason. Never throws for a geometric
// reason: an out-of-scope input is a defer, not an exception.
TopoDS_Shape draftFaces(const TopoDS_Shape& src,
                        const gp_Pnt& neutralOrigin,
                        const gp_Dir& pull,
                        const std::vector<std::uint32_t>& faceIds,
                        double angleRad,
                        std::string* why);

}  // namespace occtdraft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEDRAFTANGLE_HPP
