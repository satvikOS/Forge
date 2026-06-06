#pragma once

// DirectModeling — synchronous-technology (push/pull, move, delete face,
// surface swap) editing of a TopoDS_Shape without a feature history.
//
// All operations take a *face id*: a 1-based integer into the BREP face
// table produced by `TopExp::MapShapes(shape, TopAbs_FACE, …)`. The
// traversal order is the same one returned by the IndexedMapOfShape OCCT
// builds — stable for a given shape but NOT preserved across boolean
// operations, since boolean operations rebuild the face table. Callers
// that need a stable face label across edits should re-resolve the id
// after each direct-modeling operation (using e.g. face normal +
// centroid as a fingerprint).
//
// All operations return a NEW ShapeHandle (refcount=1) — the original is
// untouched. Failures throw std::runtime_error.
//
// See `Healing.hpp` for the companion repair toolbox.

#include "forge/ShapeRegistry.hpp"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::direct {

using FaceId = std::uint32_t;

// Push/pull a planar face along its outward normal by `distance` mm.
// Negative distance carves a pocket; positive grows a boss. Implemented
// via BRepPrimAPI_MakePrism on the face + boolean fuse/cut — works on
// arbitrary planar faces and heals neighbouring walls automatically.
ShapeHandle pushPullFace(ShapeHandle shape, FaceId faceId, double distance);

// Translate a face freely in 3D. Internally we extrude the face along the
// translation vector and fuse/cut, which is the closest robust approximation
// to a 3-DOF face move on a brep solid built from primitives.
ShapeHandle moveFace(ShapeHandle shape, FaceId faceId,
                     const std::array<double, 3>& translation);

// Rotate a face about an axis. Generates a swept feature equivalent and
// re-stitches walls. For small angles this is equivalent to a local tilt.
ShapeHandle rotateFace(ShapeHandle shape, FaceId faceId,
                       const std::array<double, 3>& axisOrigin,
                       const std::array<double, 3>& axisDir,
                       double angleRad);

// Remove the selected face(s) and close the resulting hole by fitting a
// filling surface across the free boundary, then sewing it back into the
// rest of the shell. Returns a healed solid (or shell if open after fill).
ShapeHandle deleteFaceAndHeal(ShapeHandle shape, const std::vector<FaceId>& faceIds);

// Encoded "new surface" descriptor — kept simple so we can swap planar /
// cylindrical / spherical underlying surfaces from JS without serialising
// OCCT Handle(Geom_Surface) objects. Discriminated union over the kind.
struct SurfaceSpec {
    enum class Kind { Plane, Cylinder, Sphere };
    Kind kind = Kind::Plane;
    std::array<double, 3> origin   = {0, 0, 0};
    std::array<double, 3> normal   = {0, 0, 1}; // plane normal / cylinder axis / unused for sphere
    double radius = 0.0;                         // cylinder / sphere
};

// Replace the underlying surface of `faceId` with `spec`, keeping the face's
// trim wire (topology preserved). Useful for e.g. converting a planar face
// into a cylindrical pocket bottom in one click.
ShapeHandle replaceFace(ShapeHandle shape, FaceId faceId, const SurfaceSpec& spec);

// Feature heuristics: classify the touched face so the UI can show the right
// manipulator (planar=push/pull arrow, cylindrical=diameter ring, etc.).
enum class FeatureKind {
    Unknown = 0,
    Boss,      // planar face on an external protrusion
    Hole,      // cylindrical inner face
    Fillet,    // toroidal / swept face on a convex edge
    Blend,     // freeform smooth blend between faces
    Chamfer    // planar face bridging two non-coplanar planar neighbours
};

struct FeatureInfo {
    FeatureKind kind = FeatureKind::Unknown;
    std::string label;                  // e.g. "planar", "cylindrical (R=5 mm)"
    std::array<double, 3> normal = {0, 0, 1}; // outward normal at face centroid
    std::array<double, 3> centroid = {0, 0, 0};
    double area = 0.0;
    double radius = 0.0;                // 0 if not applicable
};

FeatureInfo inferFeature(ShapeHandle shape, FaceId faceId);

// Returns the total face count in the shape — useful for the UI to
// iterate every face when the user wants to inspect the model.
std::size_t faceCount(ShapeHandle shape);

// PUSH-31 — number of TopAbs_EDGE sub-shapes (deterministic OCCT order).
// Used by the V4 shell to default fillet/chamfer to "all edges" when the
// user invokes the toolbar tool without picking any.
std::size_t edgeCount(ShapeHandle shape);

// Slice-3 edge picking — a sampled world-space polyline for one edge,
// tagged with the 0-based TopExp_Explorer edge id (same order as edgeById
// / part.filletEdges).
struct EdgePolyline {
    std::uint32_t id = 0;
    std::vector<float> points;  // x,y,z triplets along the edge
};

// Sample every edge of `shape` into a polyline (chord tolerance
// `deflection` mm). The returned ids match the fillet/chamfer edge id
// convention so a viewport pick can drive those ops directly.
std::vector<EdgePolyline> edgeSegments(ShapeHandle shape, double deflection);

} // namespace forge::direct
