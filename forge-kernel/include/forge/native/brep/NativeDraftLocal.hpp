// forge/native/brep/NativeDraftLocal.hpp — the GENERAL native draft-angle engine.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset FAMILY J, second engine). A
// TKOffset-free DRAFT that works on solids with NON-PLANAR and MULTI-WIRE faces.
// It is the successor to NativeDraft.cpp, not a replacement of it: the two are
// chained at the call site, the exact plane-arrangement engine first.
//
// ===========================================================================
// WHY A SECOND ENGINE EXISTS — THE MEASUREMENT THAT DEMANDED IT
// ===========================================================================
// NativeDraft.cpp rebuilds the WHOLE solid as a plane arrangement, so it
// requires every face of the solid to be a single-wire Geom_Plane. The 600-part
// corpus A/B measured that engine at native 0.0% against OCCT's 88.0%, and
// commit 5adc26a0 recorded WHY, from the engine's own defer reasons:
//
//     565 of 565 applicable parts DEFER; 375 on "a face of the solid carries
//     more than one wire (a hole)", 190 on "a face of the solid is not a plane",
//     and that 375/190 split is only face VISIT ORDER. Order-independently ALL
//     565 violate BOTH guards. The parts violating exactly one are 0 and 0.
//
// RE-VERIFIED here against the committed probe data
// (reports/corpus_ab/draft_defer_probe.jsonl.gz, 600 rows, 565 applicable):
//
//     has a non-planar face : 565      has a multi-wire face : 565
//     BOTH                  : 565      exactly one           : 0 and 0
//     applicable faces 72,201 of which 26,684 non-planar = 37.0%
//     parts that are polyhedra: 0
//
// So NO relaxation of either guard moves a single part, and there is no bounded
// fix to find. What is needed is a different construction, and this file is it.
//
// ===========================================================================
// THE CONSTRUCTION: A LOCAL INCIDENT REBUILD
// ===========================================================================
// Draft rotates the PLANE of each selected wall about that plane's intersection
// line with the neutral plane. Every other surface in the solid is untouched.
// Therefore, exactly:
//
//   * a face with NO vertex on a drafted wall is carried VERBATIM — the same
//     TopoDS_Face, whatever its surface type and however many wires it has.
//     This is what removes both whole-shape guards. It is not a relaxation of
//     them; the guards simply never apply to a face that does not move.
//
//   * an edge with NO endpoint on a drafted wall is carried VERBATIM.
//
//   * an edge with a moved endpoint that is NOT on a wall lies on the meet of
//     two surfaces NEITHER of which moved, so ITS CURVE IS UNCHANGED and only
//     its parameter range changes. It is RE-TRIMMED, not rebuilt. This is exact
//     for ANY curve type — a circle stays a circle, a spline stays that spline.
//     The prior art's measured 424/565 (75.0%) ceiling assumed a local rebuild
//     would re-make each touched face as a POLYGON, replacing such an arc by its
//     chord (test/draft_defer_probe.cpp, localNeighbourhood's own comment).
//     Re-trimming is why that number is a ceiling on a different construction
//     and not on this one.
//
//   * an edge ON a wall is the meet of the ROTATED plane with the neighbouring
//     surface. Against a plane that is a line, in closed form. Against anything
//     else the section is a curve that must be re-parameterised on the
//     NEIGHBOUR too, which needs a new pcurve on a non-planar surface — an
//     approximation, so it DEFERS (see HONEST DEFER below).
//
//   * a moved vertex is re-solved from ITS OWN incident constraints, and then
//     VERIFIED against every one of them. Three solves, in order of exactness:
//       1. rank-3 linear — the meet of its incident planes (rotated walls plus
//          untouched planar neighbours). Closed form.
//       2. anchor curve — an incident edge with NO wall face keeps its curve, so
//          the vertex SLIDES ALONG IT to the rotated plane. A 1-D root find on
//          the edge's own parameter range: exact for any curve, and the same
//          root gives the re-trim parameter.
//       3. line-vs-quadric — two rotated planes meet in a line; intersect it
//          with a single incident cylinder / sphere / cone / torus in closed
//          form and take the root nearest the original vertex.
//     A vertex that no solve places on ALL of its own surfaces to tolerance is
//     DECLINED, never averaged into a plausible wrong corner.
//
// The output is built with BRep_Builder over EmptyCopied() shells, faces and
// edges, so the untouched topology is the SAME TShape, shared exactly as it was.
// Nothing is sewn and no tolerance is widened to make a seam close: the face,
// edge, vertex and shell counts of the result are identical to the input's by
// construction, and the engine ASSERTS that before returning.
//
// ===========================================================================
// DROP HYGIENE. gp_*/ElCLib/ElSLib (TKMath), Geom_* (TKG3d), TopoDS_/TopExp/
// BRep_Tool/BRep_Builder/BRepTools (TKBRep), BRepGProp/BRepCheck_Analyzer
// (TKTopAlgo). NO BRepOffset*, NO BRepOffsetAPI*, and deliberately NOTHING from
// TKGeomBase or TKGeomAlgo — those two leave the closure as FREE RIDERS at drop
// steps 5 and 6 precisely because the kernel has no references of its own left
// to them (reports/OCCT_DROP_ORDER.md, section 3), and a new reference from here
// would take that away. Asserted on this TU's object file by
// test/run_ab_native_draft_local.sh, which checks all three toolkits.
//
// ===========================================================================
// HONEST DEFER (returns a null TopoDS_Shape) — never a plausible wrong shape.
// Every one of these is readable back through draftLocalLastDeferReason():
//   * a SELECTED face that is not a Geom_Plane (drafting a cylinder makes a
//     cone: a different operation, not a harder case of this one);
//   * a selected face parallel to the neutral plane (no rotation axis);
//   * a selected face not present on the shape;
//   * a NON-PLANAR face that must be rebuilt and whose change is not purely a
//     re-trim — its new pcurve would be an approximation;
//   * a moved vertex whose constraints are rank-deficient, or that no solve
//     places on all of them within tolerance;
//   * a moved vertex incident to a face whose surface is neither a plane nor an
//     analytic quadric AND which no anchor edge of that vertex lies on — the
//     engine cannot verify the vertex is on that surface, so it will not claim
//     it is;
//   * a degenerate edge that would have to move;
//   * any face carrying a non-identity Location (the sub-shape frames would
//     have to be composed, and a silently mis-composed frame is a wrong part);
//   * a result whose face/edge/vertex/shell count differs from the input's, or
//     that BRepCheck_Analyzer rejects, or whose volume is not positive.
//
// |angle| must be > 0 and < 90 degrees, as for NativeDraft.

#ifndef FORGE_NATIVE_BREP_NATIVEDRAFTLOCAL_HPP
#define FORGE_NATIVE_BREP_NATIVEDRAFTLOCAL_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Shape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>

namespace forge {
namespace occtdraftlocal {

// Is the local engine live at the call site? Same two states as
// occtdraft::draftNativeEnabled(), and it answers for the SAME switches, because
// the two engines are one chain: FORGE_DRAFT_DROP_NATIVE compiles the OCCT
// fallback out (so this is part of the only path), otherwise FORGE_DRAFT_NATIVE=1
// opts in and the default build is byte-for-byte unchanged.
bool draftLocalEnabled();

// WHICH guard declined the LAST draftFacesLocal() call on this thread; empty if
// it succeeded. Mirrors occtdraft::draftLastDeferReason() — a coverage
// measurement that cannot name the guard cannot tell a narrow applicability
// predicate from a capability gap, which is the whole reason family J's 0/565
// took a dedicated probe to explain.
const char* draftLocalLastDeferReason();

// WHAT THE LAST CALL DID, per path. Not diagnostics for their own sake: the
// three vertex solves and the three edge classes have very different exactness
// arguments, and a coverage number that cannot say WHICH of them carried a part
// cannot be read. It is also how a path that never fires gets found — the
// anchor solve fires on no case in the A/B, and only a counter says so.
struct DraftLocalStats {
    int movedVertices = 0;      // vertices on a drafted wall
    int solvedByPlaneMeet = 0;  // rank-3 linear, closed form
    int solvedByAnchor = 0;     // 1-D slide along an untouched incident curve
    int solvedByQuadric = 0;    // line-of-two-planes against one analytic quadric
    int facesVerbatim = 0;      // carried whole, any surface, any wire count
    int facesRebuilt = 0;
    int wiresVerbatim = 0;      // carried inside a REBUILT face (the hole case)
    int edgesVerbatim = 0;
    int edgesRetrimmed = 0;     // same curve, new range
    int edgesRebuilt = 0;       // new line from the rotated plane meet
};
const DraftLocalStats& draftLocalLastStats();

// Tilt every face in `faces` by `angleRad` about its intersection line with the
// `neutral` plane, in the mould-release sense for `pull`, and rebuild ONLY the
// topology that moves. Same contract as occtdraft::draftFaces: a face this
// engine cannot draft makes the WHOLE call defer, because a half-applied draft
// is a wrong part and not a partial success.
TopoDS_Shape draftFacesLocal(const TopoDS_Shape& shape,
                             const TopTools_ListOfShape& faces,
                             const gp_Dir& pull,
                             double angleRad,
                             const gp_Pln& neutral,
                             double tol = 1.0e-6);

}  // namespace occtdraftlocal
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEDRAFTLOCAL_HPP
