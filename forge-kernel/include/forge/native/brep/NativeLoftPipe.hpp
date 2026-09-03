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
//   ★ TWO MORE ENGINES SIT BEHIND THAT ONE, each tried ONLY when the previous
//   declines, so every one of them is strictly additive — an input the polygonal
//   path covered still takes the polygonal path and returns the shape it always
//   returned. Both are IDENTITIES, not approximations, and both exist because the
//   polygonal path represents a section as a ring of VERTICES and therefore turns
//   away every curved section (measured: 291 of 291 native THRUSECTIONS deferrals
//   on the 600-part corpus A/B):
//
//     TRANSLATED SECTIONS. When section B is section A translated by T, every
//     ruled line joins p to p + T, so the loft IS the linear extrusion of A along
//     T — exactly, for any edge geometry, arcs and splines alike. Built with
//     forge::occtPrism. 189 of the 258 corpus parts the drop was deleting.
//
//     COAXIAL CIRCLES (unequal radii). Between two COAXIAL full circles the ruled
//     line from polar angle t on one to polar angle t on the other has radius
//     (1-s) r0 + s r1, affine in s, which vanishes at one point ON the axis — so
//     every such line passes through a single apex and the surface is EXACTLY a
//     right circular cone. The loft is the frustum of it, built by
//     forge::occtConeSolid as one analytic Geom_ConicalSurface lateral plus two
//     planar circular caps (solid=true) or as that lateral alone in a one-face
//     shell (solid=false) — the same minimal B-rep BRepOffsetAPI_ThruSections
//     emits for the same input, MEASURED equal on volume, centre of mass, all six
//     bbox bounds and face/edge/vertex/shell counts.
//     EQUAL radii is NOT claimed here: that pair is a translate and the path above
//     owns it. Accepted only against closed forms computed from the INPUT NUMBERS
//     alone, and never on volume alone: V = pi h/3 (r0^2 + r0 r1 + r1^2) AND the
//     axial centroid h(r0^2 + 2 r0 r1 + 3 r1^2)/(4(r0^2 + r0 r1 + r1^2)) for the
//     solid, the exact lateral area pi (r0+r1) sqrt(h^2 + (r1-r0)^2) for the skin.
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
//   A FACE profile may carry POLYGON HOLES: every ring is carried by the same
//   per-leg affine map and the caps carry the holes as inner wires (see family
//   E's third profile kind for the derivation and the measurement behind it).
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
//     * a circle pair the coaxial-circle path cannot claim, each declined by name
//       and each MEASURED against live OCCT rather than assumed impossible:
//         - centres OFF the common axis (`cone_centres_off_axis`) — the loft is an
//           OBLIQUE cone, which no Geom_ConicalSurface represents; OCCT leaves its
//           own analytic path there too and returns a B-spline lateral 2.37e-9
//           relative away from the exact oblique-frustum closed form;
//         - axes NOT PARALLEL (`cone_axes_not_parallel`) — not a cone at all;
//           20 degrees of tilt moves OCCT's own volume 1.96e-2 off the frustum;
//         - wire ORIGINS at different polar angles (`cone_seam_not_aligned`) — the
//           correspondence is then t -> t + phi and the surface is TWISTED, not
//           the cone. At phi = 0 OCCT returns the analytic 3-face cone whose volume
//           is the closed form to 1.8e-16; from 1e-9 rad to 5 degrees it keeps 3
//           faces but approximates a twisted skin 2.4e-9 to 1.2e-3 off it; from 45
//           degrees it re-origins the wires and returns 4 faces / 6 edges / 4
//           vertices. Emitting a 3-face cone for any of those would be a rubber
//           stamp on a curved pair or a topology change smuggled in under a drop;
//         - anything that is not two closed single-edge FULL-circle wires (an arc,
//           an ellipse, a three-section stack);
//         - a built frustum that misses either closed form above;
//     * a non-planar end section when solid=true;
//     * ruled=false (the SMOOTHED B-spline skin is a genuinely different
//       surface — approximating it here would be a silent substitution);
//     * a sew that leaves a free edge, more than one shell, or a zero volume.
//   pipeShell / pipe:
//     * ANY guide wire (there is no native guided pipe-shell anywhere in the
//       tree; reports/TKOFFSET_DECOMPOSITION.md §2 names family F the one
//       genuine wall and this engine does not pretend otherwise);
//       ★ NARROWED 2026-09-02, and the sentence above is kept rather than edited
//       because it states the rule this is an exception TO. ONE guide is now
//       ACCEPTED: a guide that is the spine RIGIDLY TRANSLATED. Under
//       SetMode(guide, CurvilinearEquivalence) the guide is an auxiliary spine
//       whose motion relative to the spine defines the section's rotation/scaling
//       law; when it is a constant translation that law is the IDENTITY and the
//       guided sweep IS the unguided sweep, exactly, for any profile. It is an
//       identity, not an approximation, and it is confirmed on the incumbent:
//       OCCT returns 50.265440 guided against 50.265482 unguided for the same
//       input (8e-7, its own approximation noise). Edges are matched on the
//       underlying CURVE, not just on endpoints — two arcs can share endpoints
//       and bulge differently — so a LINE is pinned by its endpoints and a CIRCLE
//       must also match in radius with a parallel axis; any other curve kind is
//       declined. EVERY other guide still defers, now by the name
//       `guides_not_spine_translate` rather than the blanket `guides_present`.
//       The general guided sweep REMAINS the wall: a guide that spreads moves
//       OCCT's answer by 2.4e-3 relative and this engine does not fake it.
//       Two-sided gate: test/run_pipeshell_guided_gate.sh (10 checks, proved to
//       FAIL 3 against the pre-change engine).
//     * a spine that is not an open polyline of >= 1 LINE edges;
//     * a profile that is none of the FIVE kinds this engine can sweep EXACTLY:
//       a closed planar POLYGON wire; a full CIRCLE wire (family E only); a face
//       whose rings are all polygons; a face with a POLYGON outer boundary and
//       CIRCULAR holes (family E only); or a FACE whose every ring is a full
//       circle or an ordered chain of LINE and CIRCULAR-ARC edges, in any
//       combination (family E only -- the arc-swept lateral face). Anything
//       else -- a spline, a Bezier, an ellipse, a hyperbola -- is DECLINED,
//       never approximated;
//     * an arc whose supporting circle's axis is not the profile normal (its
//       swept surface is an ELLIPTIC cylinder, a genuinely different surface);
//     * an arc-chain profile whose section a sharp mitre would carry BACKWARDS
//       through a station plane (the sweep is then not a simple prism);
//     * an arc-chain answer whose volume is not A * L for the CLOSED-FORM area
//       A and the closed-form mitred path length L of the area centroid;
//     * a hole ring that is not coplanar / not parallel with the outer ring, or
//       a circular hole whose axis is not the sweep direction;
//     * a mitre that is degenerate (a spine reversal, i.e. a 180-degree turn);
//     * a lateral quad that is not planar within `tol`;
//     * a set of holes that does not remove exactly its own volume from the
//       outer solid (i.e. a hole outside the boundary, or two overlapping holes);
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
// test/run_cone_loft_mutation_gate.sh proves the coaxial-circle half of that
// harness CAN fail: six mutants of THIS FILE (never of the test), each of which
// must turn the harness red on its OWN assertion — including the two-sided pair
// that shows the closed-form oracle is what converts a deliberately wrong build
// into an honest defer rather than a plausible wrong answer.
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

// ---------------------------------------------------------- diagnostics
// WHY did the most recent thruSections/pipeShell/pipe call ON THIS THREAD
// return a null shape? A '|'-joined trail of the precondition labels it hit,
// e.g. "prof_face_multi_wire" or "spine_edge_not_line|circ_not_circle".
// DIAGNOSTIC ONLY: setting it changes no predicate, tolerance or branch, and
// the string is meaningless (stale) after a call that SUCCEEDED. It exists so
// a coverage measurement can attribute a defer instead of reporting a bare
// null -- see reports/corpus_ab and test/corpus_ab_coverage.cpp.
const char* lastDeferReason();

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
// THREE PROFILE KINDS, all EXACT:
//   * POLYGON  — the same rotation-minimizing mitre transport pipeShell() uses
//     (see the MITRE derivation in the .cpp banner). Any number of legs. A face
//     may carry POLYGON holes: every ring rides the same affine per-leg map.
//   * CIRCLE   — a chain of mitre-trimmed circular cylinders, every lateral face
//     an analytic Geom_CylindricalSurface and every cap a Geom_Plane. This kind
//     exists because forge::part::pipeFromPolyline feeds a CIRCLE, so a
//     polygon-only engine would leave that entry point permanently deferring.
//   * POLYGON OUTER + CIRCULAR HOLES — the dominant shape of a real machined
//     face. MEASURED on the 600-part corpus A/B: of 3426 hole wires, 3426 are
//     circles and none is a polygon, and 307 of 600 profile faces are exactly
//     this kind. Built as the polygon sweep minus one mitre-trimmed cylinder
//     chain per hole, and accepted only if the cut removed EXACTLY the sum of
//     the tube volumes -- which is true iff every tube lies inside the outer
//     solid and no two overlap. This kind took the family's measured corpus
//     coverage from 2/600 to 249/600.
//   * ARC CHAIN — the general kind, and THE EXACT ARC-SWEPT LATERAL FACE. Every
//     ring of the face is a full circle or an ordered chain of LINE and
//     CIRCULAR-ARC edges. A ring's region is decomposed EXACTLY as its chord
//     polygon plus the circular segments that bulge away from it and minus
//     those that bulge into it, and each segment is a disc intersected with the
//     half-plane on the arc's side of its own chord. The mitred sweep is a
//     boolean homomorphism (an affine station map, a cylindrical extrusion and
//     a slab clip each commute with union / intersection / difference), so the
//     SOLID is assembled with that same expression over swept atoms, all of
//     which this file already builds. The arc's lateral surface is therefore a
//     right circular Geom_CylindricalSurface on EVERY leg -- the section is
//     transported RIGIDLY, the mitre composing to a rotation -- trimmed by two
//     station planes and one chord plane per leg. Nothing is fitted, sampled or
//     faceted. MEASURED on the same 600-part corpus: this kind is what the
//     remaining 245 of the 351 declines needed (141 arc-chain outer wires, 60
//     slot/kidney holes, 44 full-circle outer wires with holes), taking the
//     family from 249/600 to 494/600. The other 106 have a B-SPLINE boundary
//     and are declined -- no arc geometry reaches them, and this engine says so.
//     ACCEPTED ONLY IF vol == A * L, with A the closed-form area (chord-polygon
//     shoelace plus (r^2/2)(D - sin D) per segment) and L the closed-form
//     mitred path length of the area centroid: BOTH sides independent of the
//     B-rep being judged. The area half of that oracle was validated against
//     OCCT's own BRepGProp on all 494 arc-chain faces of the corpus before a
//     single solid was built -- worst relative disagreement 2.59e-14.
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
