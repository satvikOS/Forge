#pragma once

// DirectEdit — face-level direct modelling on an existing solid.
//
// Motivation (CADGenBench editing family): every one of the benchmark's 32
// editing fixtures is a localised parametric change to a solid that already
// exists — "remove these three holes", "extend the +Z face by 10mm", "shrink
// the largest bore by 5mm", "remove the fillet from the boss". None of these
// can be expressed as a feature-tree rebuild, because there is no tree: the
// input is a naked STEP file.
//
// The kernel could not do any of it. It had 323 exported ops and no way to
// enumerate a face, let alone remove one. This module supplies the four
// primitives that the whole family reduces to:
//
//   faceInventory  — enumerate faces with the geometry needed to select one
//                    (kind, area, centroid, normal/axis, radius, concavity)
//   defeature      — delete faces and heal the wound (BRepAlgoAPI_Defeaturing)
//   pushPullFace   — translate a planar face along its normal, adding or
//                    removing material
//   resizeBore     — change a cylindrical bore's radius exactly
//
// Face indices are 1-based into TopExp::MapShapes(shape, TopAbs_FACE), which is
// deterministic for a given TopoDS_Shape. They are stable for the lifetime of a
// handle and are invalidated by any op that returns a new handle.

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ShapeHandle.hpp"

namespace forge {

struct FaceInfo {
    int index = 0;                       // 1-based, into the shape's face map
    std::string kind;                    // plane|cylinder|cone|sphere|torus|bspline|bezier|revolution|other
    double area = 0.0;
    std::array<double, 3> centroid{{0, 0, 0}};

    // plane: outward normal (orientation-corrected).
    // cylinder/cone/torus: the surface axis direction.
    std::array<double, 3> direction{{0, 0, 0}};

    // cylinder/cone/torus/sphere. torus: radius = major, minorRadius = blend radius.
    double radius = 0.0;
    double minorRadius = 0.0;

    // A point on the axis (cylinder/cone/torus).
    std::array<double, 3> axisLocation{{0, 0, 0}};

    // Parametric extent along the axis (cylinder), i.e. the bore's length span.
    double vMin = 0.0;
    double vMax = 0.0;

    // True when material lies OUTSIDE the surface: a bore, a hole, a concave
    // blend. False for a boss, a shaft, a convex fillet.
    bool concave = false;
};

// Merge faces that lie on the same underlying surface into one face.
//
// REQUIRED before face-level editing of any solid built on the native B-rep
// path. The native->OCCT bridge emits an analytic cylinder as N angular strips
// (makeCylinder(7,25) arrives as 128 cylindrical faces of radius 7, not one).
// Volume and area are exact, but face identity is destroyed, so "select the
// bore and resize it" has no meaning until the strips are merged back.
// On a shape imported from STEP this is normally a no-op.
ShapeHandle unifyFaces(ShapeHandle body);

// Enumerate every face of `body` with the geometry needed to select one.
std::vector<FaceInfo> faceInventory(ShapeHandle body);

// Remove `faceIndices` and extend the neighbouring faces to close the gap.
// This is the workhorse for every "remove the X" edit: holes, grooves, blends,
// bosses. Throws std::runtime_error if OCCT cannot heal the result.
ShapeHandle defeature(ShapeHandle body, const std::vector<int>& faceIndices);

// Translate planar face `faceIndex` by `distance` along `dir`. Positive
// distance adds material (the face moves outward), negative removes it.
// Throws if the face is not planar.
ShapeHandle pushPullFace(ShapeHandle body, int faceIndex,
                         const std::array<double, 3>& dir, double distance);

// Set cylindrical face `faceIndex` to `newRadius` exactly. Widening cuts the
// annulus [oldR, newR]; shrinking fuses the annulus [newR, oldR]. The axial
// span is taken from the face's own parametric extent. Throws if the face is
// not cylindrical, or if newRadius <= 0.
ShapeHandle resizeBore(ShapeHandle body, int faceIndex, double newRadius);


// ───────────────────────── EDGE IDENTITY ─────────────────────────────────────
//
// The face side of this header has had a rich language since the CADGenBench
// editing family landed: kind, area, centroid, normal, radius, concavity, and a
// selector grammar on top of it (@name, face:N, +Z, plane:largest, bore/boss,
// radial:k). The EDGE side had four keywords classified off a TESSELLATED CHORD
// — ALL | VERTICAL | RIM | HORIZONTAL — of which RIM was a byte-identical alias
// of HORIZONTAL, and the CONVEX the app offers in its own fillet command was
// refused by name. MEASURED on a 60x40x20 box, HEAD build, one process per row:
//
//   FILLET(%1,3,RIM)        -> 47248.141380  14f/28e
//   FILLET(%1,3,HORIZONTAL) -> 47248.141380  14f/28e     identical to the digit
//   FILLET(%1,3,CONVEX)     -> refused: "the keyword has no resolver"
//
// So nobody could fillet a rib root and nothing else: the choices were ALL
// (every edge of the part), VERTICAL, or HORIZONTAL — and at a rib root
// HORIZONTAL takes volume OFF, because it is dominated by the convex outer
// edges of the plate. Edge identity is what closes that gap, and it is the
// mirror of faceInventory, not a new subsystem.
//
// ─── THE ID CONVENTION, WHICH IS THE WHOLE TRAP ───
//
// Faces are 1-based into TopExp::MapShapes(FACE), which DEDUPLICATES.
// Edges are addressed by forge::part::filletEdges / chamferEdges / varfillet
// through forge::part::edgeById, which is a RAW TopExp_Explorer walk with a
// 0-based counter and NO map. TopExp_Explorer has no dedup member (see
// TopExp_Explorer.hxx: a stack, a shape, a top, a size, two enums, a flag), so
// it visits an edge ONCE PER PARENT FACE. MEASURED with OCCT 7.9 directly:
//
//   box       EDGE explorer-walk=24  unique=12  MapShapes=12
//   cylinder  EDGE explorer-walk=6   unique=3   MapShapes=3
//   box+bore  EDGE explorer-walk=30  unique=15  MapShapes=15
//
// A box's twelve edges occupy TWENTY-FOUR ids. That is the id space the fillet
// ops consume, so an inventory that enumerated unique edges would hand out ids
// that name a DIFFERENT edge — silently, with ok=true. EdgeInfo::filletId is
// therefore the explorer id (the FIRST visit of that edge), never a unique-edge
// ordinal, and `aliasIds` records the other positions the same edge occupies so
// a caller that needs to reason about the id space can see it rather than
// rediscover it.
//
// Face ids in faceA/faceB are 1-based into TopExp::MapShapes(FACE) — the SAME
// convention faceInventory publishes — so `edge:3_5` and `face:3` speak one
// language. The two orders are checked, not assumed: the face index is looked
// up with FindIndex on the map, not inferred from the traversal counter.
//
// ─── CONVEXITY ───
//
// The dihedral classification is the point of the whole structure: a rib root
// is a CONCAVE edge and a plate corner is a CONVEX one, and no amount of
// VERTICAL/HORIZONTAL can separate them.
//
// It cannot be decided from the two outward normals alone. Two planes through
// an edge always bound two opposite wedges; WHICH wedge holds the material is a
// topological fact, not a metric one, so the face orientations have to enter.
// The construction used here is the standard one (Mantyla, "An Introduction to
// Solid Modeling", 1988, ch. 4 — edge convexity and the dihedral angle; and
// Hoffmann, "Geometric and Solid Modeling", 1989, ch. 3 — face/edge orientation
// conventions in a boundary representation):
//
//   n1, n2  outward unit normals of the two adjacent faces at the edge
//           midpoint, each flipped when its face is REVERSED (OCCT's
//           convention: a FORWARD face's dU x dV points out of the material)
//   t1      the edge tangent in the direction face 1's boundary is TRAVERSED,
//           i.e. the curve tangent negated when the edge is REVERSED in face 1
//   m1 = n1 x t1     the co-normal: the in-plane direction pointing from the
//   m2 = n2 x t2     edge INTO each face, with t2 = -t1 because a manifold
//                    edge is traversed in opposite senses by its two faces
//
//   theta = atan2( (m1 x m2) . t1 , m1 . m2 )
//
// and the interior dihedral angle is pi + theta. theta < 0 is CONVEX, theta > 0
// is CONCAVE, |theta| ~ 0 is TANGENT (a smooth joint, e.g. a fillet meeting the
// wall it blends into). Worked on a box's top-front edge this gives theta =
// -pi/2, interior pi/2 — convex; worked on an L-bracket's rib root it gives
// theta = +pi/2, interior 3pi/2 — concave. Both are asserted by the gate.
//
// The evaluation point on each face comes from the edge's own pcurve
// (BRep_Tool::CurveOnSurface), so no projection or search is involved. An edge
// with no pcurve on one of its faces, a non-manifold edge, or a seam is left
// convexity = Unknown rather than guessed — see EdgeConvexity.
enum class EdgeConvexity {
    Unknown = 0,   // undecidable: no pcurve, non-manifold, seam, or degenerate
    Convex  = 1,   // interior dihedral < pi   — a plate corner, a boss rim
    Concave = 2,   // interior dihedral > pi   — a rib root, a pocket floor
    Tangent = 3,   // interior dihedral ~ pi   — a smooth joint, nothing to break
};

const char* edgeConvexityName(EdgeConvexity c);

struct EdgeInfo {
    // THE id forge::part::filletEdges / chamferEdges / varfillet consume:
    // 0-based, TopExp_Explorer(EDGE) order, first visit of this edge.
    int filletId = 0;
    // 1-based position of this edge among the UNIQUE edges, in first-visit
    // order. User-facing (`edge:7` means the 7th edge), never passed to a
    // kernel op. Deliberately a different name from filletId so the two can
    // never be confused at a call site.
    int ordinal = 0;
    // The other explorer positions this same edge occupies (one per additional
    // parent face). Empty only for a free edge; one entry for every manifold
    // edge of a closed solid.
    std::vector<int> aliasIds;

    // 1-based face ids on faceInventory's convention (TopExp::MapShapes(FACE)).
    // faceB is 0 for a free/boundary edge; faceA == faceB marks a seam.
    int faceA = 0;
    int faceB = 0;
    std::string faceAKind;   // same vocabulary as FaceInfo::kind
    std::string faceBKind;

    // line|circle|ellipse|hyperbola|parabola|bspline|bezier|other
    std::string kind;
    double length = 0.0;
    double radius = 0.0;                    // circle: radius. ellipse: major.
    std::array<double, 3> midpoint{{0, 0, 0}};
    std::array<double, 3> tangent{{0, 0, 0}};   // unit, at the mid parameter

    EdgeConvexity convexity = EdgeConvexity::Unknown;
    // Interior dihedral angle in DEGREES at the midpoint (pi + theta above).
    // 0 when convexity is Unknown.
    double dihedralDeg = 0.0;

    bool closed = false;     // a full circle / closed spline — a bore or boss rim
    bool seam = false;       // the same face on both sides (a cylinder's seam)
    bool degenerate = false; // a pole edge (a sphere's apex), zero length
};

// Enumerate every edge of `body` with the geometry needed to select one.
//
// One entry per UNIQUE edge, ordered by first explorer visit, so
// out[k].ordinal == k + 1 and out[k].filletId is the id the fillet ops take.
//
// Throws std::runtime_error when the body has no OCCT representation to walk
// (a NativeSolid handle addresses its edges through a different, geometric
// enumeration — enumerateSharpConvexEdges — and mixing the two id spaces is the
// exact silent-wrong-edge failure this header exists to prevent).
std::vector<EdgeInfo> edgeInventory(ShapeHandle body);

} // namespace forge
