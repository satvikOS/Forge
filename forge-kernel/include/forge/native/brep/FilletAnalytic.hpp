// forge/native/brep/FilletAnalytic.hpp
//
// K-series ANALYTIC ROLLING-BALL EDGE FILLET (constant radius) on the Forge
// native ANALYTIC B-rep (Topology/Surface/MassProps/Sew) — the REAL blend, NOT
// the mesh-bridge rounded-edge strip that Fillet.cpp/Chamfer.cpp build on the
// triangle HalfEdgeMesh. This is the first slice of the "analytic blend family …
// constant-radius rolling-ball fillet surface on the B-rep" called MISSING in
// docs/SCOPE_2026-06-24/kernel/brep-nurbs.md §2.3 (roadmap W3.10 / Phase E2).
//
// WHAT IT DOES (the genuine analytic rolling-ball contact):
//   For a CONSTANT radius R rolling-ball fillet on ONE CONVEX, STRAIGHT edge
//   shared by TWO PLANAR faces of a closed solid, it computes the rolling-ball
//   contact analytically:
//     * The ball of radius R rolls in the convex valley tangent to BOTH planes
//       from the material (inner) side. Its CENTRE sweeps a line parallel to the
//       edge, a distance R inside each face plane — this line is the AXIS of the
//       fillet surface, which is a CYLINDER of radius R.
//     * The two TANGENT LINES (where the cylinder touches each face plane) are
//       the new trim boundaries: each adjacent planar face is RE-TRIMMED back
//       from the sharp edge to its tangent line.
//     * The cylindrical fillet PATCH is a TrimmedFace-style quarter-cylinder
//       (here carried as an analytic SurfaceKind::Cylinder face with a parameter-
//       rectangle [angle]×[along-edge] trim) spanning the quarter arc between the
//       two tangent lines, over the full edge length.
//   The two re-trimmed planar faces + the new cylindrical patch + the solid's
//   remaining faces are assembled (K1.4 sew semantics — every edge mated by two
//   opposite-sense coedges) into an updated closed 2-manifold Solid whose mass
//   the analytic MassProps integrator measures EXACTLY (planar faces exact polygon
//   moments; the cylinder face exact-to-rounding Gauss-Legendre over the quadric).
//
// HONEST SCOPE (Bible §0/§9 — REAL, no MVP/stub/fake; explicit boundary):
//   THIS FAMILY NOW COVERS (each REAL, exact-mass-validated):
//     * a single CONVEX straight edge between two PLANAR faces (the original gate)
//       — fillet REMOVES (1 - pi/4) R^2 L of material;
//     * a single CONCAVE (reflex) straight edge between two PLANAR faces (an L-block
//       inner edge) — the rolling ball sits on the OUTSIDE of the corner, so the
//       fillet ADDS (1 - pi/4) R^2 L of material; convex-vs-concave is decided from
//       the face normals + a material-side reference, then the cylinder centre and
//       the re-trim flip side accordingly;
//     * an EDGE CHAIN — a connected set of box edges filleted in ONE call; each
//       edge gets its own cylindrical patch + exact quarter-disk caps, sewn into one
//       closed solid. Where two filleted edges meet at a SHARED VERTEX this pass
//       does NOT fabricate a (subtly-wrong) corner blend: the per-edge caps keep the
//       corner watertight and the vertex is reported HONESTLY in `unblendedCorners`
//       (its position + the meeting edges) for a later setback/spherical-corner pass.
//   EXPLICIT FOLLOW-UPS (NOT built here, surfaced in `reason`, never faked):
//     * the spherical / setback VERTEX BLEND at a shared chain corner,
//     * curved adjacent faces (cylinder/cone/sphere/NURBS — the contact becomes a
//       torus/pipe surface, not a cylinder),
//     * variable / law-controlled radius.
//
// Pure C++20, ZERO external dependencies (stdlib + existing forge native brep
// headers only). No OCCT, no WASM. ADDITIVE: a brand-new header + TU; Topology /
// Surface / MassProps / Sew are NOT edited. CONVENTIONS: namespace
// forge::native::brep.

#ifndef FORGE_NATIVE_BREP_FILLETANALYTIC_HPP
#define FORGE_NATIVE_BREP_FILLETANALYTIC_HPP

#include <vector>

#include "forge/native/brep/Topology.hpp"   // Point3, Solid, TopologyBuilder, Surface
#include "forge/native/brep/Surface.hpp"    // Vec3 helpers, SurfaceKind

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// AnalyticFilletResult — the rolling-ball blend output + the analytic contact
// diagnostics a caller / A/B harness inspects.
// ---------------------------------------------------------------------------
struct AnalyticFilletResult {
    bool   ok = false;
    Solid* solid = nullptr;     // the filleted closed 2-manifold solid (owned by tb)

    // The new cylindrical fillet patch face (SurfaceKind::Cylinder, radius R).
    Face*  filletFace = nullptr;
    // The two adjacent planar faces, re-trimmed back to their tangent lines.
    Face*  trimmedFaceA = nullptr;  // the face on side 0 of the edge
    Face*  trimmedFaceB = nullptr;  // the face on side 1 of the edge

    // The rolling-ball contact, reported for verification.
    double radius = 0.0;        // R
    double edgeLength = 0.0;    // L
    double dihedralDeg = 0.0;   // interior dihedral angle of the two faces at the edge
    Vec3   axisPoint{};         // a point on the cylinder axis (at the edge's start)
    Vec3   axisDir{};           // unit cylinder-axis direction (== edge direction)
    Vec3   tangentA{};          // tangent point on face A at the axis-start cross-section
    Vec3   tangentB{};          // tangent point on face B at the axis-start cross-section

    const char* reason = "";
};

// ---------------------------------------------------------------------------
// filletBoxEdgeAnalytic — build the analytic constant-radius rolling-ball fillet
// of ONE convex straight edge of an axis-aligned box [0,L]^3, on the analytic
// B-rep. `tb` owns the resulting topology/geometry. `edgeIndex` selects which of
// the box's 12 edges to fillet (0..11, the standard cube-edge enumeration below).
// `R` is the constant fillet radius; it must be > 0 and < L (so the tangent lines
// stay inside both faces). Returns the closed filleted Solid + the contact
// diagnostics. `ok` is false (with a `reason`) for any out-of-scope input — never
// a faked/broken solid.
//
// Box-edge enumeration (matches the box vertex layout in Topology::buildBox):
//   bottom face z=0 ring  v0(0,0,0) v1(L,0,0) v2(L,L,0) v3(0,L,0)
//   top    face z=L ring  v4(0,0,L) v5(L,0,L) v6(L,L,L) v7(0,L,L)
//   edges 0..3 : bottom ring  (v0-v1, v1-v2, v2-v3, v3-v0)
//   edges 4..7 : top ring     (v4-v5, v5-v6, v6-v7, v7-v4)
//   edges 8..11: verticals    (v0-v4, v1-v5, v2-v6, v3-v7)
// The canonical gate fillets edge 4 (top-front, v4->v5, along +X at y=0,z=L),
// shared by the TOP face (z=L) and the FRONT face (y=0) — both planar, convex.
// ---------------------------------------------------------------------------
AnalyticFilletResult filletBoxEdgeAnalytic(TopologyBuilder& tb,
                                           double L, double R,
                                           int edgeIndex = 4);

// ---------------------------------------------------------------------------
// enumerateSolidStraightEdges — the DETERMINISTIC edge enumeration the
// topology-sourced fillet (and the part.filletEdges native routing) indexes
// `edgeId` through. It walks shells[0] -> faces[*] -> outerLoop (and inner)
// coedges, collects each distinct Edge* once (canonicalised by its endpoint
// vertices), and sorts the survivors by (edge MIDPOINT, then sign-canonical
// unit DIRECTION) — the SAME canonical (midpoint, direction) ordering the mesh
// enumeration enumerateSharpConvexEdges (Fillet.hpp) sorts its sharp-convex
// edges by, so an `edgeId` resolves to the geometrically same edge on both the
// analytic-B-rep and the mesh-bridge backends (JS edge ids stay stable). Pure,
// allocation-only; returns an empty vector for an empty / shell-less solid.
// ---------------------------------------------------------------------------
std::vector<Edge*> enumerateSolidStraightEdges(const Solid& src);

// ---------------------------------------------------------------------------
// filletSolidStraightEdgeAnalytic — the OCCT-ZERO keystone: the analytic
// constant-radius ROLLING-BALL fillet of ONE straight CONVEX edge of an
// arbitrary native analytic Solid, TOPOLOGY-SOURCED (not box-hardcoded). This
// is the same rolling-ball contact + cylinder blend + re-trim + quarter-disk
// caps as filletBoxEdgeAnalytic, but the edge and its adjacent / perpendicular
// faces are resolved by WALKING the real B-rep topology of `src`, so it runs
// on STEP-imported / boolean / extrude solids — the cases part.filletEdges
// would otherwise hand to OCCT BRepFilletAPI_MakeFillet (which spins forever on
// a multi-hole body). `edgeId` indexes enumerateSolidStraightEdges(src).
//
// HONEST SCOPE of THIS increment (each REFUSED with `reason`, never faked):
//   * the selected edge must be STRAIGHT, CONVEX, and shared by exactly two
//     PLANAR faces whose normals are ORTHOGONAL (the 90-degree edge — the exact
//     scope of filletBoxEdgeAnalytic, so the quarter-cylinder blend + the
//     (1-pi/4)R^2 L removed cross-section are exact);
//   * each of the two faces that CAP the edge ends (the perpendicular end
//     faces) must be PLANAR, hole-free, and perpendicular to the edge (the
//     box/prism/plate local topology). A non-orthogonal / curved / holed
//     adjacent or end face, or a concave edge, is REFUSED (the torus / mitre /
//     setback follow-ups), NOT fabricated. Faces that touch NEITHER endpoint
//     are copied faithfully (any surface, inner loops preserved), so a solid
//     with curved or holed faces ELSEWHERE is fully supported.
//
// The two re-trimmed faces + the L-polygon-re-trimmed end faces + the two
// quarter-disk caps + the cylindrical blend patch + every untouched face are
// SEWN (Sew.hpp) into one closed 2-manifold whose mass the analytic integrator
// measures exactly; `ok` is true only when that sew is watertight (else `reason`).
// ---------------------------------------------------------------------------
AnalyticFilletResult filletSolidStraightEdgeAnalytic(TopologyBuilder& tb,
                                                     const Solid& src,
                                                     std::uint32_t edgeId,
                                                     double R);

// ---------------------------------------------------------------------------
// filletLBlockEdgeAnalytic — CONCAVE (reflex) constant-radius rolling-ball fillet.
//
// Builds the canonical L-PRISM: the L-shaped cross-section
//     (0,0) (W,0) (W,h) (t,h) (t,D) (0,D)
// (a width-W, depth-D rectangle with the top-right (x>t, y>h) notch removed)
// extruded along +Z by Lz. Its single REFLEX (interior 270°) edge runs along Z at
// (t,h) and is shared by the planar face A (y = h, x in [t,W], outward +Y) and the
// planar face B (x = t, y in [h,D], outward +X). Because the dihedral is reflex,
// the rolling ball of radius R sits in the EMPTY notch on the OUTSIDE of the corner
// (centre at (t+R, h+R)); the concave cylindrical fillet patch ADDS the quarter-
// round of material between the sharp notch and the rolled ball:
//     filleted volume = V_Lblock + (1 - pi/4) R^2 Lz   (material ADDED).
// The two adjacent faces are re-trimmed OUTWARD to their tangent lines, the two
// end cross-sections get an L-polygon + quarter-disk fill, and everything is sewn
// into a closed 2-manifold whose mass the analytic integrator measures EXACTLY.
//
// Requires W,D,Lz > 0; 0 < t < W; 0 < h < D; and R > 0 with R <= W - t, R <= D - h
// (the fillet must fit inside the notch) and R <= t, R <= h (the tangent lines stay
// on the L's legs). `ok` is false with a `reason` for any out-of-scope input.
// ---------------------------------------------------------------------------
AnalyticFilletResult filletLBlockEdgeAnalytic(TopologyBuilder& tb,
                                              double W, double D, double t, double h,
                                              double Lz, double R);

// ---------------------------------------------------------------------------
// AnalyticChainFilletResult — output of filleting a CONNECTED SET of box edges in
// one call. Each requested edge becomes its own cylindrical patch + quarter-disk
// caps; the whole assembly is sewn into one closed solid. A SHARED VERTEX where two
// filleted edges meet is NOT blended this pass (an honest scope boundary): it is
// reported in `unblendedCorners` for a later setback/spherical-corner increment.
// ---------------------------------------------------------------------------
struct UnblendedCorner {
    Vec3 position{};            // the shared box corner where >=2 filleted edges meet
    int  cornerIndex = -1;      // box corner index 0..7
    int  edgeA = -1, edgeB = -1; // two of the meeting filleted edge indices
    int  meetingFilletCount = 0; // how many requested edges touch this corner
};

struct AnalyticChainFilletResult {
    bool   ok = false;
    Solid* solid = nullptr;     // the filleted closed 2-manifold solid (owned by tb)

    int    filletedEdgeCount = 0;          // how many edges were filleted
    std::vector<Face*> filletFaces;        // one cylinder patch per filleted edge
    // One SPHERICAL-OCTANT corner blend (SurfaceKind::Sphere) per orthogonal
    // trihedral vertex where three filleted edges meet (the multi-edge keystone's
    // shared-vertex blend). Empty for a pairwise vertex-disjoint selection.
    std::vector<Face*> cornerFaces;
    std::vector<UnblendedCorner> unblendedCorners; // shared vertices left sharp (honest)

    double radius = 0.0;        // R
    double removedVolume = 0.0; // total removed = SUM (1-pi/4) R^2 L_cyl + SUM (1-pi/6) R^3
    const char* reason = "";
};

// filletBoxEdgeChainAnalytic — fillet a connected SET of CONVEX box edges (indices
// into the 0..11 enumeration) in one call. The edges should form a connected chain
// (e.g. {4,5} share top corner v5); disjoint edges are also accepted (then there
// are no shared vertices to report). All edges are CONVEX box edges (the concave
// case has its own L-block entry point). Each requested edge is re-trimmed + capped
// exactly like the single-edge path; shared vertices are reported, not faked.
AnalyticChainFilletResult filletBoxEdgeChainAnalytic(TopologyBuilder& tb,
                                                     double L, double R,
                                                     const std::vector<int>& edgeIndices);

// ---------------------------------------------------------------------------
// filletSolidStraightEdgesAnalytic — the MULTI-EDGE topology-sourced rolling-ball
// fillet: fillet a SET of straight CONVEX edges of one ARBITRARY native analytic
// Solid in a single watertight result, so a real native solid with several selected
// edges is filleted ENTIRELY natively (OCCT-zero) instead of falling back to the
// mesh-bridge. Unlike filletBoxEdgeChainAnalytic (box-hardcoded indices + a
// world-axis grid), this resolves the edges + their adjacent / perpendicular faces
// by WALKING the real B-rep of `src`, so it runs on imported / boolean / extrude
// solids. `edgeIds` index enumerateSolidStraightEdges(src); each is resolved +
// validated exactly like the single-edge path (straight, CONVEX, shared by two
// ORTHOGONAL PLANAR faces, terminating against PLANAR PERPENDICULAR end faces).
//
// Every face is re-trimmed for ALL the requested edges that touch it at once: a face
// ADJACENT to several edges has all of those corners pulled back to their tangent
// lines; a face that is the perpendicular END of several edges has each such corner
// rounded with its own quarter-disk. The modified planar faces are decomposed into
// CONVEX triangles (an ear-clip of the real re-trimmed polygon — so the exact
// polygon-moment mass integral stays exact even where the re-trim makes a face
// non-convex, e.g. the rounded-rectangle top/bottom of a post). The per-edge
// cylindrical blends + quarter-disk caps are added and everything is SEWN into one
// closed 2-manifold whose mass the analytic integrator measures exactly.
//
// Returns AnalyticChainFilletResult (reusing its filletFaces / unblendedCorners /
// removedVolume fields). For a TOPOLOGY-SOURCED solid UnblendedCorner.cornerIndex
// is -1 and edgeA/edgeB carry the meeting edgeIds.
//
// SHARED-VERTEX CORNER BLEND (now built, not refused): when three of the requested
// edges meet at one ORTHOGONAL TRIHEDRAL vertex (a convex box corner — three
// mutually-orthogonal planar faces, each shared by two of the three edges), the
// corner is closed by a SPHERICAL OCTANT of radius R centred at the vertex's
// set-back point  C = P_vertex + R*(sum of the three faces' INWARD normals). The
// sphere is tangent to all three planes and to each adjacent cylinder blend along a
// quarter great-circle: each meeting cylinder is SET BACK by R at the shared vertex
// and its end cross-section IS one of the octant's three boundary arcs, so the three
// cylinders + the octant + the (re-trimmed) planar faces sew watertight. This makes
// the ALL-12-EDGES-of-a-box fillet a single native closed 2-manifold (genus 0, the
// 8 corners carried as SurfaceKind::Sphere faces in `cornerFaces`), removing exactly
//   SUM_edges (1 - pi/4) R^2 L_cyl  +  SUM_corners (1 - pi/6) R^3.
//
// HONEST SCOPE (each REFUSED with `reason`, never faked):
//   * The supported shared vertex is EXACTLY the orthogonal trihedral corner above
//     (three meeting edges, three distinct mutually-orthogonal faces each used by two
//     of them). Any OTHER shared-vertex configuration — two edges meeting (a partial
//     spherical lune), four-or-more edges, or a non-trihedral / non-orthogonal corner
//     — is the documented follow-up: rather than fabricate a subtly-wrong corner it is
//     reported in `unblendedCorners`, `ok` is set false, and the caller
//     (part.filletEdges) falls back to the proven mesh-bridge for that selection.
//   * Same straight / convex / orthogonal-planar / perpendicular-end envelope as the
//     single-edge path; any curved / concave / non-orthogonal / holed / oblique
//     input is refused (not fabricated).
// `ok` is true only when the sew is watertight (closed 2-manifold); otherwise the
// caller falls back to the mesh-bridge.
// ---------------------------------------------------------------------------
AnalyticChainFilletResult filletSolidStraightEdgesAnalytic(
    TopologyBuilder& tb, const Solid& src,
    const std::vector<std::uint32_t>& edgeIds, double R);

// ---------------------------------------------------------------------------
// filletCylinderTopEdgeAnalytic — CURVED-FACE rolling-ball fillet increment.
//
// The first member of the family where ONE adjacent face is CURVED: the constant-
// radius rolling-ball fillet on the CONVEX CIRCULAR edge where a cylinder's
// CYLINDRICAL side (radius Rc, axis +Z, z in [0,H]) meets its FLAT TOP CAP (the
// plane z=H). Because one contact face is a cylinder and the other a plane, the
// rolling-ball blend is NOT a cylinder — its centre sweeps a CIRCLE (the spine) of
// radius (Rc - R) at height z = H - R, so the blend surface is a TORUS of:
//     minor (tube) radius  r2 = R           (the constant ball radius),
//     major (ring) radius  r1 = Rc - R      (the spine-circle radius).
// The two TANGENT CONTACT CIRCLES are the new trim boundaries:
//   * on the cylinder wall: the circle at radius Rc, z = H - R (phi = 0 of the
//     torus, where the ball touches the wall), so the wall is re-trimmed to
//     z in [0, H - R];
//   * on the top plane: the circle at radius Rc - R, z = H (phi = pi/2, where the
//     ball touches the cap), so the top cap shrinks to the disk of radius Rc - R.
// The torus patch spans the quarter tube-arc phi in [0, pi/2] over the full 2*pi
// revolution; it is carried as an analytic SurfaceKind::Torus face. The re-trimmed
// wall + shrunk cap + torus blend + bottom cap are SEWN into one closed genus-0
// 2-manifold whose mass the analytic integrator measures EXACTLY (the torus patch
// via the analytic |S_u x S_v| Gauss-Legendre quadrature).
//
// EXACT REMOVED VOLUME (the toroidal-corner material). The removed corner cross-
// section in the (radius rho, z) half-plane is the R x R square corner minus the
// quarter-disk of radius R centred at the spine point (Rc - R, H - R) — area
// (1 - pi/4) R^2 — REVOLVED about the axis (Pappus + the off-axis area moment):
//     removed = 2*pi*(Rc - R)*(1 - pi/4)*R^2   +   (pi/3)*R^3
// (the first term is the thin-shell Pappus term at the spine radius; the second is
// the exact second-radial-moment correction, integral of 2*pi*a over the corner).
// So the filleted volume is  pi*Rc^2*H  -  that removed corner, measured EXACTLY by
// the analytic mass integrator. Requires Rc > 0, H > 0, R > 0, R < Rc (so the spine
// radius Rc - R stays positive) and R < H (the wall re-trim stays above z=0). `ok`
// is false with a `reason` for any out-of-scope input (never a faked solid).
//
// HONEST SCOPE of THIS increment: planar + cylinder CONVEX edge, CONSTANT radius.
// Cylinder+cylinder / cone / sphere / NURBS contact and variable radius are
// explicit follow-ups (the contact stops being a single torus there).
// ---------------------------------------------------------------------------
struct AnalyticTorusFilletResult {
    bool   ok = false;
    Solid* solid = nullptr;       // the filleted closed genus-0 2-manifold (owned by tb)

    Face*  filletFace = nullptr;  // ONE representative torus blend patch (SurfaceKind::Torus)
    std::vector<Face*> blendFaces; // all angular segments of the torus blend

    double radius = 0.0;          // R (== torus minor/tube radius)
    double tubeRadius = 0.0;      // r2 == R
    double ringRadius = 0.0;      // r1 == Rc - R (the spine-circle / torus major radius)
    Vec3   spineCenter{};         // centre of the spine circle (0,0,H-R)
    double cylinderRadius = 0.0;  // Rc
    double height = 0.0;          // H
    double removedVolume = 0.0;   // 2*pi*(Rc-R)*(1-pi/4)*R^2 + (pi/3)*R^3 (exact)
    const char* reason = "";
};

AnalyticTorusFilletResult filletCylinderTopEdgeAnalytic(TopologyBuilder& tb,
                                                        double Rc, double H, double R,
                                                        int nSeg = 64);

// ---------------------------------------------------------------------------
// AnalyticVariableFilletResult — output of a VARIABLE-RADIUS rolling-ball fillet
// of ONE CONVEX straight edge between two PLANAR faces, where the ball radius
// follows a LINEAR law R(t) = R0 + (R1 - R0) * (t / L) along the edge length L.
// ---------------------------------------------------------------------------
struct AnalyticVariableFilletResult {
    bool   ok = false;
    Solid* solid = nullptr;       // the filleted closed 2-manifold solid (owned by tb)

    // The variable-radius blend patch (carried as an EXACT rational NURBS surface:
    // a quarter-circle of radius R(t) swept linearly along the edge — degree 2 in
    // the arc parameter (rational quarter circle), degree 1 along the edge).
    Face*  filletFace = nullptr;
    Face*  trimmedFaceA = nullptr; // adjacent planar face A, re-trimmed (now a trapezoid)
    Face*  trimmedFaceB = nullptr; // adjacent planar face B, re-trimmed (now a trapezoid)

    double radius0 = 0.0;          // R0 (radius at the edge start, t = 0)
    double radius1 = 0.0;          // R1 (radius at the edge end,   t = L)
    double edgeLength = 0.0;       // L
    double dihedralDeg = 0.0;      // interior dihedral of the two faces at the edge
    Vec3   axisStart{};            // spine (axis-foot) point at t = 0
    Vec3   axisEnd{};              // spine (axis-foot) point at t = L
    Vec3   axisDir{};              // unit edge direction
    // Exact removed material: (1 - pi/4) * L * (R0^2 + R0*R1 + R1^2) / 3
    // = (1 - pi/4) * INT_0^L R(t)^2 dt, the varying quarter-round prism removed.
    double removedVolume = 0.0;
    const char* reason = "";
};

// ---------------------------------------------------------------------------
// filletBoxEdgeVariable — VARIABLE-RADIUS rolling-ball fillet of one CONVEX
// straight edge of an axis-aligned box [0,L]^3, with a LINEAR radius law
//     R(t) = R0 + (R1 - R0) * (t / L)        (t in [0, L] along the edge)
// on the native ANALYTIC B-rep. The rolling-ball SPINE is still the edge line,
// but the ball radius varies, so at each station t the cross-section is a
// quarter-circle of radius R(t) tangent to both planes, its centre offset R(t)
// into the solid. The blend surface is therefore NOT a cylinder: it is the
// VARIABLE-RADIUS surface that sweeps that varying quarter-arc — built here as an
// EXACT rational NURBS (the quarter circle is a degree-2 rational Bezier whose
// three control points move LINEARLY in t, so the surface is degree 2 x degree 1
// and represents the swept arc exactly, NOT a tessellation). The two adjacent
// planes are re-trimmed to the (now non-parallel) tangent lines and everything is
// sewn into a closed 2-manifold whose mass the analytic integrator measures.
//
// filleted volume = V_box - (1 - pi/4) * L * (R0^2 + R0*R1 + R1^2) / 3
// (the removed quarter-round prism with varying R, == (1 - pi/4) INT_0^L R(t)^2 dt).
//
// Requires L > 0, R0 > 0, R1 > 0, both R0,R1 < L (tangent lines stay on the faces),
// and the same orthogonal-convex-box-edge scope as filletBoxEdgeAnalytic.
//
// HONEST SCOPE: LINEAR radius law on a CONVEX STRAIGHT planar-planar box edge.
// A GENERAL (non-linear) law, curved adjacent faces, and setback are explicit
// follow-ups (the swept arc stops being degree-2 x degree-1 there). `ok` is false
// with a `reason` for any out-of-scope input (never a faked/broken solid).
// ---------------------------------------------------------------------------
AnalyticVariableFilletResult filletBoxEdgeVariable(TopologyBuilder& tb,
                                                   double L, double R0, double R1,
                                                   int edgeIndex = 4);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_FILLETANALYTIC_HPP
