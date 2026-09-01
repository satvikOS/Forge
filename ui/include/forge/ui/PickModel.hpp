// ui/include/forge/ui/PickModel.hpp
//
// THE VIEWPORT PICK ENGINE — what turns a pixel into a typed EntityRef, and the
// acceleration structure that keeps it interactive on a REAL part.
//
// ── why it is here and not in forge-desktop ─────────────────────────────────
// Picking was already implemented twice in this tree and NEITHER copy could be
// measured: KernelScene::pick() is a linear ray/triangle scan in a translation
// unit that includes OCCT (so timing it means building the whole desktop app),
// and forge::ui::pickEdge() is a linear scan over every segment of every
// recovered edge. Both are arithmetic. Arithmetic a cheap gate cannot run is
// arithmetic nobody has a number for, and "picking must stay interactive at 400
// faces" is a claim about a number.
//
// So the whole pick — faces, edges, vertices, bodies, the tolerance conversion
// and the priority rule between them — lives here, in headless forge::ui, over
// the SAME MeasureMesh triangle soup the Measure panel and the edge recovery
// already use. Nothing in this file includes ImGui, OCCT or a forge-kernel
// header. The frame builder hands it a ray and prints what comes back.
//
// ── the four kinds, and the two that did not exist ─────────────────────────
// The status strip has always offered a selection FILTER with `vertex` and
// `body` in it, and choosing either left the application unable to pick
// ANYTHING: ForgeFrame produced only Face and (later) Edge refs, so every ray
// hit was refused by SelectionService::accepts(). That is the same defect the
// edge work already fixed once, and it is not cosmetic — SEVEN registry
// commands declare a Body signature (part.move, part.rotate, the three
// patterns, part.mirror, and the two-body booleans), so TRANSLATE and ROTATE
// were reachable from the IR and unreachable from every gesture.
//
// ── what a VERTEX is here, and the limit of that, stated ───────────────────
// A tessellated solid does not carry its B-rep vertices, but it carries enough
// to recover the ones that matter: a welded mesh point used by THREE OR MORE
// DISTINCT B-rep FACE IDS is a corner of the B-rep, because three surfaces meet
// only at a point. The limit is stated rather than hidden — a point where only
// two faces meet (a cone apex against one lateral face, a sphere pole, a
// tangent point) has too few face ids and is INVISIBLE to this construction, so
// the recovered vertex count is a LOWER BOUND on the B-rep's own vertex count,
// exactly as EdgeModel's is for edges. VertexSet reports the census of what was
// rejected beside what was kept, so the shortfall is visible instead of
// inferred.
//
// Vertices weld on the SAME quantized key MeasureModel and EdgeModel use
// (kMeasureWeldTolerance), with the same known limit: two points straddling a
// bucket boundary stay distinct however close.
#ifndef FORGE_UI_PICKMODEL_HPP
#define FORGE_UI_PICKMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── screen tolerance -> world tolerance ─────────────────────────────────────
// A pick tolerance is a PIXEL radius. Converting it to world units at the eye
// distance is what keeps an edge as easy to hit zoomed out as zoomed in; a fixed
// world tolerance makes a distant edge unhittable and a near one grab the whole
// screen. Written once, here, because the formula was inline at its only call
// site and a second copy of it is a copy that drifts.
double worldPerPixel(double eyeDistance, double fovYRadians, double viewportHeightPixels) noexcept;

// ── face picking ────────────────────────────────────────────────────────────
struct FacePick {
  std::uint32_t faceId = 0;  // 1-based B-rep face id; 0 = miss
  std::size_t triangle = 0;  // index into MeasureMesh, meaningful only on a hit
  double distance = 0.0;     // ray parameter of the hit, in |direction| units
  double point[3] = {0.0, 0.0, 0.0};

  bool hit() const noexcept { return faceId != 0; }
};

// The REFERENCE implementation: Möller–Trumbore over every triangle, nearest
// hit wins. It is what KernelScene::pick() does today, and it is exported on
// purpose — the accelerator below is only trustworthy if something asserts it
// returns the SAME answer, ray for ray.
FacePick pickFaceLinear(const MeasureMesh& mesh, const double origin[3],
                        const double direction[3]) noexcept;

// A uniform grid over the triangle soup, traversed with a 3-D DDA
// (Amanatides & Woo, "A Fast Voxel Traversal Algorithm for Ray Tracing",
// Eurographics 1987). A uniform grid rather than a BVH because a tessellated
// B-rep is close to uniformly dense on its own surface, it builds in one linear
// pass with no sorting, and the whole of it is small enough that a headless gate
// can prove it equal to the linear scan on every ray it fires.
//
// NOT THREAD-SAFE for concurrent picks: pick() stamps a per-query mailbox so a
// triangle spanning several cells is intersected once. That is the only mutable
// state, and it is what the `mutable` members below are.
class PickAccelerator {
 public:
  void build(const MeasureMesh& mesh);
  void clear() noexcept;

  bool built() const noexcept { return built_; }
  std::size_t triangles() const noexcept { return triangleCount_; }
  int dim(int axis) const noexcept { return (axis >= 0 && axis < 3) ? dim_[axis] : 0; }
  std::size_t cellCount() const noexcept;
  // Total (cell, triangle) pairs stored — a triangle straddling cells is counted
  // once per cell. The ratio to triangles() is the grid's duplication factor,
  // which is the number that says whether the resolution is sane.
  std::size_t entries() const noexcept { return items_.size(); }

  // The SAME answer pickFaceLinear gives, on every ray. `mesh` must be the mesh
  // build() was called with; the grid stores indices into it, not a copy.
  FacePick pick(const MeasureMesh& mesh, const double origin[3],
                const double direction[3]) const noexcept;

  // How many triangle intersections the LAST pick() actually performed. The
  // acceleration claim is only meaningful if something counts it: against
  // triangles() this is the speed-up, measured rather than asserted.
  std::size_t lastTested() const noexcept { return lastTested_; }
  std::size_t lastCellsWalked() const noexcept { return lastCells_; }

 private:
  bool built_ = false;
  std::size_t triangleCount_ = 0;
  double min_[3] = {0.0, 0.0, 0.0};
  double max_[3] = {0.0, 0.0, 0.0};
  double cell_[3] = {1.0, 1.0, 1.0};
  int dim_[3] = {1, 1, 1};
  std::vector<std::uint32_t> start_;  // cellCount()+1 prefix offsets into items_
  std::vector<std::uint32_t> items_;  // triangle indices, grouped by cell
  mutable std::vector<std::uint32_t> mailbox_;
  mutable std::uint32_t stamp_ = 0;
  mutable std::size_t lastTested_ = 0;
  mutable std::size_t lastCells_ = 0;
};

// ── vertex picking ──────────────────────────────────────────────────────────
inline constexpr std::size_t kNoVertex = static_cast<std::size_t>(-1);

// One recovered B-rep vertex: a welded mesh point where three or more distinct
// B-rep faces meet.
struct MeshVertex {
  double p[3] = {0.0, 0.0, 0.0};
  std::vector<std::uint32_t> faces;  // sorted, unique, size >= 3
  std::size_t triangles = 0;         // how many triangles use this welded point
  std::uint32_t component = 0;       // which vertex of this face SET, from 0

  // The persistent name an EntityRef carries: "vertex@<f0>_<f1>_..#<component>".
  // Stable under any repermutation that preserves the face ids, which is the
  // same guarantee "face@<id>" and "edge@<a>_<b>#<c>" already give.
  //
  // The component index is NOT decoration: three PLANES meet in at most one
  // point, but a cylinder and two planes can meet at two, so a face set alone
  // does not name a vertex. Components are numbered by welded position in a
  // fixed order, which does not permute when the B-rep is rebuilt.
  std::string key() const;
};

struct VertexSet {
  std::vector<MeshVertex> vertices;
  std::size_t weldedPoints = 0;   // every distinct welded point in the soup
  std::size_t twoFacePoints = 0;  // welded on exactly 2 face ids -> not a vertex
  std::size_t oneFacePoints = 0;  // welded on exactly 1 -> interior of a face

  std::size_t size() const noexcept { return vertices.size(); }
  // Index of the vertex whose key() matches, or kNoVertex.
  std::size_t indexOf(const std::string& name) const;
};

// Deterministic: vertices come back ordered by face set and then by welded
// position, so two runs over the same mesh produce byte-identical keys.
VertexSet deriveVertices(const MeasureMesh& mesh);

struct VertexPick {
  std::size_t index = kNoVertex;
  double distance = 0.0;  // world distance from the ray to the point
  double along = 0.0;     // ray parameter of the closest approach (>= 0)

  bool hit() const noexcept { return index != kNoVertex; }
};

// Nearest vertex to the ray, subject to distance <= maxDistance. `direction`
// need not be unit length. Ties break on the SMALLER ray parameter — the vertex
// in front — and then on the lower index, so the answer is deterministic.
VertexPick pickVertex(const VertexSet& set, const double origin[3], const double direction[3],
                      double maxDistance) noexcept;

// ── the whole pick, one call ────────────────────────────────────────────────
// Everything a viewport click needs, so the frame builder holds no picking
// policy of its own. `bodyId` is the document node the answer is attributed to;
// it is what an EntityRef must carry for a Part command to resolve it back to an
// IR value.
struct PickScene {
  const MeasureMesh* mesh = nullptr;
  const PickAccelerator* accelerator = nullptr;  // optional; linear scan if null
  const EdgeSet* edges = nullptr;                // optional; no edge answers if null
  const VertexSet* vertices = nullptr;           // optional; no vertex answers if null
  std::string bodyId;
};

struct PickRequest {
  double origin[3] = {0.0, 0.0, 0.0};
  double direction[3] = {0.0, 0.0, 1.0};
  // What the status strip's filter says. EntityKind::Any means "whatever is
  // under the cursor", resolved by the priority rule below.
  EntityKind filter = EntityKind::Any;
  double pixelTolerance = 8.0;  // snap radius for edges and vertices, in pixels
  double worldPerPixel = 1.0;   // from worldPerPixel(), above
};

// What one ray found. `ref` is empty (kind None) on a miss.
struct ScenePick {
  EntityRef ref;
  std::uint32_t faceId = 0;
  std::size_t edgeIndex = kNoEdge;
  std::size_t vertexIndex = kNoVertex;
  double distance = 0.0;
  double point[3] = {0.0, 0.0, 0.0};

  bool hit() const noexcept { return ref.kind != EntityKind::None; }
};

// THE PRIORITY RULE, when the filter is Any: VERTEX before EDGE before FACE,
// each only when it is within the pixel tolerance AND not behind the surface the
// ray actually struck. Behind matters: without the depth test, an edge on the
// far side of the part snaps in front of the face you are pointing at, which is
// the classic wrong-side pick. A BODY answer is only ever produced by an
// explicit Body filter, because "the whole body" is never what a user means when
// they can see a face.
ScenePick pickScene(const PickScene& scene, const PickRequest& request);

}  // namespace forge::ui

#endif  // FORGE_UI_PICKMODEL_HPP
