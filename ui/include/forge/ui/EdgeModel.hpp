// ui/include/forge/ui/EdgeModel.hpp
//
// B-REP EDGES RECOVERED FROM THE TESSELLATION — the model that makes "pick an
// edge" mean it.
//
// ── the gap this closes, measured ───────────────────────────────────────────
// Three of the registry's Part commands declare an EDGE signature: part.fillet,
// part.chamfer and part.variable_fillet (PartCommands.cpp, the
// SelectionSignature::atLeast(EntityKind::Edge, 1) calls). The application could
// not produce an EntityRef of kind Edge from ANY gesture: ForgeFrame's two
// selection entry points both wrote EntityKind::Face, because forge::Mesh
// (Tessellate.hpp) carries a per-TRIANGLE face id and nothing else. So Edge
// Fillet — the single most-used feature operation in mechanical CAD — was
// permanently greyed out in the shipped app, and the frame gate asserted that
// state as correct ("an edge tool is not offered on a face pick"). The status
// strip made it worse: the selection filter offers "edge", and choosing it left
// the app unable to pick ANYTHING, because clickFace's accepts(Face) then
// refused every ray hit.
//
// ── what an edge IS here, and the limit of that, stated ─────────────────────
// A tessellated solid does not carry its B-rep edges, but it does carry enough
// to RECOVER them: an undirected mesh segment used by exactly two triangles
// whose B-rep FACE IDS DIFFER lies on the boundary between those two faces, and
// that boundary is a B-rep edge. Segments are grouped by the unordered face pair
// and then split into CONNECTED COMPONENTS, because one pair of faces can meet
// along more than one edge, and merging those would give a single "edge" with
// two disjoint pieces.
//
// The known limit is stated rather than hidden: a SEAM — an edge where one face
// meets itself, such as the closing line of a cylindrical bore — has the SAME
// face id on both sides and is invisible to this construction. So the recovered
// edge count is a LOWER BOUND on the B-rep's own edge count, never an equal, and
// EdgeSet reports the segment census (interior / boundary / non-manifold) beside
// the edges so the shortfall is visible instead of inferred. For selection this
// is exactly right: a seam is not an edge a user fillets.
//
// Vertices are welded on the SAME quantized key MeasureModel uses
// (kMeasureWeldTolerance), for the same reason and with the same known limit —
// two vertices straddling a bucket boundary stay distinct however close.
//
// Nothing here includes ImGui, OCCT or a forge-kernel header: it is arithmetic
// over the triangle soup the viewport already draws, so every number is asserted
// headless.
#ifndef FORGE_UI_EDGEMODEL_HPP
#define FORGE_UI_EDGEMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {

// One recovered B-rep edge: a maximal connected chain of mesh segments shared by
// one pair of distinct faces.
struct MeshEdge {
  std::uint32_t faceA = 0;      // the LOWER of the two face ids
  std::uint32_t faceB = 0;      // the HIGHER
  std::uint32_t component = 0;  // which connected chain of that face pair, from 0
  std::size_t segments = 0;
  double length = 0.0;
  // Closed when every welded vertex on the chain is used by exactly two
  // segments — a bore rim is closed, a plate's top-front edge is not.
  bool closed = false;
  MeasureBox box{};
  // 6 doubles per segment: ax ay az bx by bz. The polyline the viewport draws
  // when the edge is hovered or picked.
  std::vector<double> points;

  // The persistent name an EntityRef carries: "edge@<faceA>_<faceB>#<component>".
  // It is stable under any repermutation that preserves the face ids, which is
  // the same guarantee "face@<id>" already gives the face selection.
  std::string key() const;
};

// The recovered edges PLUS the census of every undirected mesh segment, so a
// caller can see what was NOT turned into an edge. The four counts partition the
// mesh's undirected segments exactly.
struct EdgeSet {
  std::vector<MeshEdge> edges;
  std::size_t faceBoundarySegments = 0;  // used twice, two DIFFERENT face ids -> edges
  std::size_t interiorSegments = 0;      // used twice, the SAME face id (tessellation)
  std::size_t boundarySegments = 0;      // used exactly once (an open mesh)
  std::size_t nonManifoldSegments = 0;   // used more than twice

  std::size_t segmentCount() const noexcept {
    return faceBoundarySegments + interiorSegments + boundarySegments + nonManifoldSegments;
  }
  std::size_t size() const noexcept { return edges.size(); }
  // Index of the edge whose key() matches, or kNoEdge.
  std::size_t indexOf(const std::string& name) const;
};

inline constexpr std::size_t kNoEdge = static_cast<std::size_t>(-1);

// Deterministic: edges come back ordered by (faceA, faceB, component), and a
// component's segments by their welded endpoint ids, so two runs over the same
// mesh produce byte-identical keys.
EdgeSet deriveEdges(const MeasureMesh& mesh);

// ── picking ─────────────────────────────────────────────────────────────────
struct EdgePick {
  std::size_t index = kNoEdge;
  double distance = 0.0;  // world distance from the ray to the closest segment
  double along = 0.0;     // ray parameter of the closest point (>= 0)

  bool hit() const noexcept { return index != kNoEdge; }
};

// Nearest edge to the ray, subject to distance <= maxDistance. `direction` need
// not be unit length. Ties break on the SMALLER ray parameter — the edge in
// front, which is what a pick means — and then on the lower index, so the answer
// is deterministic.
EdgePick pickEdge(const EdgeSet& set, const double origin[3], const double direction[3],
                  double maxDistance);

// ── measurement ─────────────────────────────────────────────────────────────
// What the Measure panel reports for an EDGE selection. Kept beside
// SelectionMeasure rather than inside it because an edge selection and a face
// selection answer different questions, and one struct with half its fields
// meaningless is the shape that lets a stale number be printed as a live one.
struct EdgeMeasure {
  std::size_t edges = 0;
  std::size_t segments = 0;
  double length = 0.0;
  MeasureBox box{};

  // The two-entity measure, meaningful only with exactly two edges picked.
  bool hasPair = false;
  double centreDistance = 0.0;  // between the two edges' bounding-box centres
};

EdgeMeasure measureEdges(const EdgeSet& set, const std::vector<std::size_t>& indices);

}  // namespace forge::ui

#endif  // FORGE_UI_EDGEMODEL_HPP
