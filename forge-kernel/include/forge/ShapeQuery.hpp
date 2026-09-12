// ShapeQuery.hpp — B-rep topology queries, in Forge's own vocabulary.
//
// WHY THIS EXISTS. The migration rule is that Forge application code stops talking
// to OCCT directly and goes through the Forge Kernel API. Measured before this file:
// exactly one application translation unit still violated it --
// forge-desktop/src/ModelQuality.cpp, with 13 OCCT includes -- and every one of them
// was there for a QUERY the Kernel API did not expose: a bounding box, the solids of
// a shape, the face count, and the edges where two faces meet.
//
// Those are questions about a shape, not operations on one, and they belong on this
// side of the boundary. OCCT still answers them; it answers them HERE, where it is
// allowed to live during the migration, instead of in the app.
//
// HANDLES ARE THE CALLER'S. Every ShapeHandle returned by this header was added to
// the ShapeRegistry and must be released by the caller, exactly like
// ShapeRegistry::add(). The desktop's OwnedHandle RAII wrapper is the intended way.
#pragma once

#include "forge/ShapeRegistry.hpp"

#include <cstddef>
#include <vector>

namespace forge {

// An axis-aligned bounding box in model units.
struct ShapeBounds {
  double lo[3] = {0.0, 0.0, 0.0};
  double hi[3] = {0.0, 0.0, 0.0};
};

// False when the shape is missing or its box is void -- an empty compound has no
// bounds, and reporting zeros for one would be a measurement that is not true.
bool shapeBounds(ShapeHandle body, ShapeBounds& out);

// How many B-rep faces the shape has. Zero if the handle is unknown.
std::size_t shapeFaceCount(ShapeHandle body);

// The shape's solids, in traversal order, each registered as its own handle.
// THE CALLER RELEASES EACH ONE.
std::vector<ShapeHandle> shapeSolids(ShapeHandle body);

// The shape's faces, in FACE-MAP ORDER, so index i in this vector is face i+1 in
// the 1-based indices EdgeJoin and DraftFaceIndexed report. That correspondence is
// the whole point: a caller can hold face handles and still speak the same index
// language the rest of this header answers in. THE CALLER RELEASES EACH ONE.
std::vector<ShapeHandle> shapeFaces(ShapeHandle body);

// An edge and the two faces that meet along it.
struct EdgeJoin {
  ShapeHandle edge = 0;    // caller releases
  ShapeHandle faceA = 0;   // caller releases
  ShapeHandle faceB = 0;   // caller releases
  // 1-based position in the shape's face map, or 0 when the face is not in it.
  // Computed HERE so the caller never needs the map itself -- handing the map
  // across the boundary would hand an OCCT type across with it.
  std::size_t indexA = 0;
  std::size_t indexB = 0;
  // The same face on both sides: the closing line of a bore is the usual case.
  // "How does this face meet itself" is not a continuity question, and callers
  // that measure continuity skip these rather than count them.
  bool seam = false;
};

// Draft analysis, answered in face INDICES rather than face objects.
//
// forge::mold::analyseDraft() returns one DraftFace per face, each carrying a
// TopoDS_Face -- and the only thing the application ever did with it was look up
// that face's index in the shape's face map. Handing an OCCT type across the
// boundary so the caller can convert it back to a number is the boundary leaking
// for no reason, so this overload does the lookup on this side.
struct DraftFaceIndexed {
  std::size_t faceIndex = 0;   // 1-based into the shape's face map, 0 if absent
  double angleDeg = 0.0;       // face normal vs the pull direction, [0, 180]
  bool isPositive = false;     // releases along the pull
  bool isNegative = false;     // needs a side action
  bool isVertical = false;     // a sliver, within the threshold of 90 degrees
};

// Empty when the handle is unknown or the analysis throws.
std::vector<DraftFaceIndexed> shapeDraftFaces(ShapeHandle body,
                                              const double pullDir[3],
                                              double draftThresholdDeg);

// Every edge bounded by exactly two faces. Edges with any other number of adjacent
// faces (a free edge, or a non-manifold one) are not joins and are not returned.
std::vector<EdgeJoin> shapeEdgeJoins(ShapeHandle body);

}  // namespace forge
