// forge/native/brep/NativeLoftPipe.hpp — TKOffset-free LOFT and PIPE-SHELL on
// OCCT TopoDS types.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset families D and F). A native,
// self-contained OCCT-TYPED replacement for the two TKOffset symbol groups that
// keep forge::part::loft / forge::loftguide::loft / forge::airfoil::loftWing /
// forge::makePyramid / forge::part::sweep / forge::part::sweepWithGuides linked
// to that toolkit —
//
//   family D  BRepOffsetAPI_ThruSections::{ctor(bool,bool,double), AddWire,
//             AddVertex, CheckCompatibility, Build} + vtable        (6 symbols)
//   family F  BRepOffsetAPI_MakePipeShell::{ctor(Wire), Add(Shape,bool,bool),
//             SetMode(bool), SetMode(Wire,bool,BRepFill_TypeOfContact),
//             MakeSolid, Build} + vtable                            (7 symbols)
//
// It mirrors src/native/brep/NativeThickSolid.cpp (families G/H): same
// TopoDS-typed signature, same HONEST-DEFER contract (a null TopoDS_Shape is
// "this engine does not cover that input", NEVER a plausible wrong shape), same
// sew + occtheal::solidFromShell tail, same drop hygiene.
//
// ===========================================================================
// SCOPE — EXACT, no tessellation, no approximation, no spline fitting
// ===========================================================================
//
// family D — thruSections()
//   RULED loft over N >= 2 ordered sections. A section is either
//     * a CLOSED planar wire whose every edge is a LINE segment (a polygon), or
//     * a single VERTEX (a degenerate point section — the AddVertex apex that
//       forge::makePyramid and forge::loftguide::loft use), allowed only as the
//       FIRST and/or LAST entry.
//   Polygon sections must all carry the SAME vertex count; correspondence is an
//   index pairing, exactly as BRepFill_Generator pairs them after
//   CheckCompatibility. ★ THE "after CheckCompatibility" IS LOAD-BEARING and was
//   for a long time not implemented here: BRepOffsetAPI_ThruSections runs
//   BRepFill_CompatibleWires first, which REORIENTS and RE-ORIGINS each wire
//   before that pairing. Pairing by the raw wire-explorer index instead twists
//   every lateral quad whenever the two rings wind oppositely in world space —
//   which is exactly what the two outer wires of two OPPOSITE faces of a solid
//   do — and made this engine decline 309 of 600 reference solids that it can in
//   fact build. src/native/brep/NativeLoftPipe.cpp::canonicalRing supplies the
//   missing step: the raw order is tried first and kept when it already yields
//   planar quads, otherwise the canonical (reorient + nearest-origin)
//   correspondence is tried once, and a pair that fails both is still declined.
//   Between consecutive sections the engine emits
//     * one PLANAR QUAD per index i: (A_i, A_i+1, B_i+1, B_i), or
//     * one TRIANGLE per index i when one side is the point section.
//   With solid=true the two end sections are closed by planar cap faces. The
//   result is sewn, checked watertight, and oriented to positive volume.
//
//   ★ WHY PLANAR QUADS ARE A HARD REQUIREMENT, not a shortcut. The ruled surface
//   between two non-parallel straight edges is a BILINEAR patch, and a bilinear
//   patch's signed volume contribution is the MEAN of its two triangulations —
//   so a quad split into triangles encloses a DIFFERENT volume from the ruled
//   patch OCCT builds. Rather than approximate, a quad whose four corners are
//   not coplanar within `tol` is an HONEST DEFER. This covers prisms, frustums,
//   pyramids, wedges, and every pair of sections related by translation and/or a
//   homothety about a common axis — and declines exactly the twisted cases where
//   a triangulated answer would be silently wrong.
//
// family F — pipeShell()
//   Unguided sweep of a CLOSED planar polygon profile along a POLYLINE spine
//   (every spine edge a LINE segment). The section is rigidly translated onto
//   the spine start and then carried along it; at an interior spine vertex the
//   section is carried through the MITRE plane (the plane bisecting the two
//   segment directions), which is what makes consecutive lateral faces planar.
//   With makeSolid=true the two ends are capped.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape, IsNull() == true)
// ===========================================================================
//   thruSections:
//     * fewer than 2 sections, or a point section that is not first/last, or
//       two point sections that are adjacent;
//     * a section that is not a closed wire of LINE edges (any arc, spline,
//       conic or open wire);
//     * polygon sections of differing vertex count (OCCT auto-reparametrises;
//       this engine does NOT and says so);
//     * a lateral quad whose 4 corners are not coplanar within `tol`, or whose
//       area is degenerate;
//     * a non-planar end section when solid=true;
//     * ruled=false (the SMOOTHED B-spline skin is a genuinely different
//       surface — approximating it here would be a silent substitution);
//     * a sew that leaves a free edge, more than one shell, or a zero volume.
//   pipeShell:
//     * ANY guide wire (there is no native guided pipe-shell anywhere in the
//       tree; reports/TKOFFSET_DECOMPOSITION.md §2 names family F the one
//       genuine wall and this engine does not pretend otherwise);
//     * a spine that is not an open polyline of >= 1 LINE edges;
//     * a profile that is not a closed planar polygon wire (or a face whose
//       outer wire is one);
//     * a mitre that is degenerate (a spine reversal, i.e. a 180-degree turn);
//     * a lateral quad that is not planar within `tol`;
//     * the same sew / shell / volume checks as above.
//
// ===========================================================================
// DROP HYGIENE. Uses ONLY surviving toolkits: gp_* (TKMath), Geom_Line /
// Geom_TrimmedCurve (TKG3d), TopoDS_/TopExp/BRep_Tool/BRepTools_WireExplorer
// (TKBRep), BRepBuilderAPI_MakePolygon/MakeFace/Sewing + BRepGProp (TKTopAlgo),
// occtheal::solidFromShell (the in-house TKShHealing-free ShapeFix_Solid
// subset). NO BRepOffset*, NO BRepOffsetAPI*, NO BRepFill*, NO GeomFill_*
// symbol is referenced — test/run_ab_native_loftpipe.sh asserts that on the
// engine's own object file.
//
// GATE. test/ab_native_loftpipe_occt.cpp drives BOTH entry points against LIVE
// OCCT in one process on volume AND centre of mass AND bounding box AND
// face/edge/vertex/shell counts AND validity, plus independent closed forms,
// plus a NEGATIVE CONTROL proving the comparator rejects two shapes of equal
// volume. Run it with test/run_ab_native_loftpipe.sh.
//
// WIRING. The OCCT calls stay live by default; the native attempt is opt-in
// (FORGE_LOFT_NATIVE=1 / FORGE_PIPESHELL_NATIVE=1) and falls through on defer.
// FORGE_THRUSECTIONS_DROP_NATIVE / FORGE_PIPESHELL_DROP_NATIVE (CMake options,
// DEFAULT OFF) are the compile-time form that actually removes the 13 symbols.
// ★ TKOffset needs ALL 38 of its remaining symbols gone before its link record
// moves: families D+F alone change OCCT_CLOSURE by exactly ZERO.

#ifndef FORGE_NATIVE_BREP_NATIVELOFTPIPE_HPP
#define FORGE_NATIVE_BREP_NATIVELOFTPIPE_HPP

#ifdef FORGE_NATIVE_BREP

#include <vector>

#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>

namespace forge {
namespace occtloft {

// ---------------------------------------------------------------- routing
// Is the native attempt live at the call sites? Two states, mirroring the
// family-G/H routing in src/Features.cpp:
//   * FORGE_THRUSECTIONS_DROP_NATIVE / FORGE_PIPESHELL_DROP_NATIVE defined ->
//     ALWAYS true: the OCCT fallback is compiled out, so the native engine is
//     the only path and a defer becomes a thrown error rather than a wrong shape.
//   * otherwise -> the environment opt-in FORGE_LOFT_NATIVE=1 /
//     FORGE_PIPESHELL_NATIVE=1, DEFAULT OFF, so the shipped kernel is unchanged.
// Read once per process (function-local static).
bool loftNativeEnabled();
bool pipeShellNativeEnabled();

// ---------------------------------------------------------------- family D
// Ruled loft through `sections` (each a closed polygon TopoDS_Wire, or a
// TopoDS_Vertex point section at the first/last position). 1:1 drop-in for
//   BRepOffsetAPI_ThruSections mk(solid, ruled, tol);
//   for (w : wires) mk.AddWire(w);  [ mk.AddVertex(v); ]
//   mk.Build();  return mk.Shape();
// Returns a null TopoDS_Shape on HONEST DEFER (see the banner for the full list).
TopoDS_Shape thruSections(const std::vector<TopoDS_Shape>& sections,
                          bool solid, bool ruled, double tol = 1.0e-6);

// ---------------------------------------------------------------- family F
// Unguided pipe-shell sweep of `profile` (a closed polygon wire, or a face whose
// outer wire is one) along the polyline `spine`. 1:1 drop-in for
//   BRepOffsetAPI_MakePipeShell mk(spine);
//   mk.Add(profile);  [ mk.SetMode(guide, true); ... ]
//   mk.Build();  if (makeSolid) mk.MakeSolid();  return mk.Shape();
// `guides` is accepted so the call sites can pass what they have; a NON-EMPTY
// guides list is an unconditional HONEST DEFER. Returns a null TopoDS_Shape on
// defer.
TopoDS_Shape pipeShell(const TopoDS_Wire& spine,
                       const TopoDS_Shape& profile,
                       const std::vector<TopoDS_Wire>& guides,
                       bool makeSolid, double tol = 1.0e-6);

// ---------------------------------------------------------------- family E
// Sweep `profile` along the polyline `spine` and return the SOLID. 1:1 drop-in
// for the three BRepOffsetAPI_MakePipe call sites in src/Features.cpp
// (forge::part::{sweep (unguided branch), pipeFromPolyline, sweepPolyline}):
//   BRepOffsetAPI_MakePipe mk(spine, profileFace);
//   mk.Build();  return mk.Shape();
//
//   family E  BRepOffsetAPI_MakePipe::{ctor(Wire,Shape), Build} + vtable  (3 symbols)
//
// TWO PROFILE KINDS, both EXACT:
//   * POLYGON  — the same rotation-minimizing mitre transport pipeShell() uses
//     (see the MITRE derivation in the .cpp banner). Any number of legs.
//   * CIRCLE   — a chain of mitre-trimmed circular cylinders, every lateral face
//     an analytic Geom_CylindricalSurface and every cap a Geom_Plane. This kind
//     exists because forge::part::pipeFromPolyline feeds a CIRCLE, so a
//     polygon-only engine would leave that entry point permanently deferring.
//
// Returns a null TopoDS_Shape on HONEST DEFER — never a plausible wrong shape.
// Defers: a closed/curved/zero-length spine, a profile that is neither a polygon
// nor a circle, a profile plane not perpendicular to the first leg on a
// multi-leg spine, a 180-degree spine reversal, a non-planar lateral quad, and a
// mitre trim or leg union that does not close.
TopoDS_Shape pipe(const TopoDS_Wire& spine, const TopoDS_Shape& profile,
                  double tol = 1.0e-6);

// Routing for family E, mirroring loftNativeEnabled/pipeShellNativeEnabled:
// always true under FORGE_PIPE_DROP_NATIVE (the OCCT fallback is compiled out),
// otherwise the env opt-in FORGE_PIPE_NATIVE=1, default OFF.
bool pipeNativeEnabled();

}  // namespace occtloft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVELOFTPIPE_HPP
