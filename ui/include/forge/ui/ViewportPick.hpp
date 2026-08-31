// ui/include/forge/ui/ViewportPick.hpp
//
// VIEWPORT PICKING — the accelerated, typed hit-test behind "click that face",
// "hover that edge", "grab that corner" and "select that body".
//
// It lives in forge::ui, not in forge-desktop, for the reason MeasureModel and
// EdgeModel already state: this is arithmetic over the triangle soup the
// viewport is drawing, and a number a UI acts on is only trustworthy if
// something headless can assert it. Nothing here includes ImGui, OCCT, Vulkan
// or a forge-kernel header. (A file nothing compiles cannot break: the two
// defects that reached shipped users both lived in forge-desktop, which CI never
// compiles.)
//
// ── WHY AN INDEX, MEASURED ─────────────────────────────────────────────────
// The app's face pick was a LINEAR SCAN over every triangle
// (KernelScene::pick), and edge picking a linear scan over every mesh segment
// (pickEdge). That is fine on a demo cube and wrong on the target: the owner's
// ground-truth parts are 329-430 faces with cylinder/torus/bspline surfaces,
// which tessellate to tens of thousands of triangles, and the scan runs ONCE PER
// FRAME for the hover highlight -- not once per click. viewport_pick_test.cpp
// measures both arms on a 400-face part and prints the numbers; the BVH is kept
// because the measurement says so, not because a tree is obviously faster.
//
// ── the four pickable kinds, and the gap this closes ───────────────────────
// forge::ui::EntityKind names Vertex, Edge, Face and Body. Before this module
// the application could produce refs of only two of them: ForgeFrame wrote Face
// (clickFace) and Edge (clickEdge) and NOTHING ANYWHERE produced a Body or a
// Vertex. That is not a cosmetic gap -- EIGHT of the twenty IR-emitting Part
// commands declare `SelectionSignature::exactly(EntityKind::Body, ...)`:
// part.move, part.mirror, the three patterns and the three booleans. All eight
// were permanently unreachable from every gesture the app has, exactly as edge
// fillet was before EdgeModel, and the status strip's selection filter offered
// "body" and "vertex" as choices that made the viewport unable to pick anything
// at all. Refusing input is a capability gate wearing a safety hat; this module
// removes the impediment rather than documenting it.
#ifndef FORGE_UI_VIEWPORTPICK_HPP
#define FORGE_UI_VIEWPORTPICK_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/ViewStyle.hpp"

namespace forge::ui {

// ── a bounding-volume hierarchy over item boxes ─────────────────────────────
// Deliberately generic: it indexes ITEM AABBs, so the same tree serves triangles
// and edge segments. Built by the median split on the widest axis, which is the
// build every interactive picker uses -- O(n log n), no SAH sweep, because the
// tree is rebuilt whenever the document rebuilds and a build that costs more
// than the scans it saves is not an optimisation.
struct BvhNode {
  double min[3] = {0.0, 0.0, 0.0};
  double max[3] = {0.0, 0.0, 0.0};
  std::uint32_t start = 0;  // leaf: first index into order()
  std::uint32_t count = 0;  // leaf: how many; 0 for an interior node
  std::uint32_t left = 0;   // interior: child node indices; 0 when leaf
  std::uint32_t right = 0;
  bool leaf() const noexcept { return count != 0; }
};

// How many items a leaf may hold before it splits. Four per leaf is the usual
// interactive-picker setting: smaller leaves buy pruning, bigger ones buy a
// shallower tree, and below four the node overhead dominates.
inline constexpr std::uint32_t kBvhLeafSize = 4;

class BoundsBvh {
 public:
  // `itemBoxes` holds SIX doubles per item: minx miny minz maxx maxy maxz.
  // A size that is not a multiple of six is refused (the tree stays empty)
  // rather than silently truncated.
  bool build(const std::vector<double>& itemBoxes);
  void clear() noexcept;

  std::size_t itemCount() const noexcept { return items_; }
  std::size_t nodeCount() const noexcept { return nodes_.size(); }
  std::size_t maxDepth() const noexcept { return maxDepth_; }
  bool empty() const noexcept { return nodes_.empty(); }
  const std::vector<BvhNode>& nodes() const noexcept { return nodes_; }
  const std::vector<std::uint32_t>& order() const noexcept { return order_; }

  // Ray traversal, nearest-child-first. `tMax` is IN/OUT: the visitor narrows it
  // by writing a nearer hit through the reference it is handed, and the
  // traversal then prunes every node whose slab entry is beyond it -- which is
  // where the win comes from. Returns how many ITEMS reached the visitor, the
  // observable that makes "the tree prunes" a value a gate can assert rather
  // than a claim.
  //
  // `direction` need not be unit length; `tMax` is in units of |direction|.
  template <typename Visitor>
  std::size_t rayQuery(const double origin[3], const double direction[3], double& tMax,
                       Visitor&& visit) const {
    return rayQueryDilated(origin, direction, tMax, 0.0, visit);
  }

  // The same traversal with every node box GROWN by `radius` before the slab
  // test. That is what a DISTANCE query needs: an edge segment or a vertex whose
  // box the ray misses by less than the pick tolerance is still a candidate, and
  // dilating the QUERY rather than the tree keeps one tree valid as the
  // tolerance changes with the zoom -- which it does on every wheel notch.
  // `radius` is in world units and must be >= 0.
  template <typename Visitor>
  std::size_t rayQueryDilated(const double origin[3], const double direction[3], double& tMax,
                              double radius, Visitor&& visit) const {
    if (nodes_.empty()) return 0;
    double inv[3];
    for (int i = 0; i < 3; ++i) {
      // A zero component is given a huge slope, which is the standard branchless
      // slab test: the multiply then yields a huge signed value and the min/max
      // below still classify a ray parallel to that slab correctly.
      inv[i] = direction[i] != 0.0 ? 1.0 / direction[i] : kBigSlope;
    }
    const double r = radius > 0.0 ? radius : 0.0;
    std::size_t tested = 0;
    std::uint32_t stack[kStackDepth];
    std::size_t sp = 0;
    stack[sp++] = 0;
    while (sp != 0) {
      const std::uint32_t ni = stack[--sp];
      const BvhNode& n = nodes_[ni];
      double tNear = 0.0;
      if (!slabHit(n, origin, inv, tMax, r, tNear)) continue;
      if (n.leaf()) {
        for (std::uint32_t k = 0; k < n.count; ++k) {
          ++tested;
          visit(order_[n.start + k], tMax);
        }
        continue;
      }
      // Push the FARTHER child first so the nearer one is popped next: the
      // nearer subtree gets to narrow tMax before the farther one is tested.
      double nearL = 0.0, nearR = 0.0;
      const bool hitL = slabHit(nodes_[n.left], origin, inv, tMax, r, nearL);
      const bool hitR = slabHit(nodes_[n.right], origin, inv, tMax, r, nearR);
      // The stack is sized from the build's depth cap, so an overflow is a build
      // invariant that broke rather than a deep model: drop the push instead of
      // scribbling past the array -- a missed subtree is a wrong answer a gate
      // catches, a smashed stack is not.
      if (hitL && hitR && sp + 2 <= kStackDepth) {
        if (nearL <= nearR) {
          stack[sp++] = n.right;
          stack[sp++] = n.left;
        } else {
          stack[sp++] = n.left;
          stack[sp++] = n.right;
        }
      } else if (hitL && sp < kStackDepth) {
        stack[sp++] = n.left;
      } else if (hitR && sp < kStackDepth) {
        stack[sp++] = n.right;
      }
    }
    return tested;
  }

 private:
  // 1/0 is not representable, and a literal infinity in a constexpr context is a
  // compiler-flag argument nobody should have to have. 1e300 is beyond any model
  // coordinate by 290 orders of magnitude and multiplies without overflowing.
  static constexpr double kBigSlope = 1.0e300;
  // A median split halves the item count at every level, so depth is bounded by
  // log2(items) + 1. 64 covers 2^63 items; the tree also refuses to recurse
  // past it at build time.
  static constexpr std::size_t kStackDepth = 64;

  static bool slabHit(const BvhNode& n, const double o[3], const double inv[3], double tMax,
                      double radius, double& tNear) noexcept {
    double lo = 0.0, hi = tMax;
    for (int i = 0; i < 3; ++i) {
      double t0 = (n.min[i] - radius - o[i]) * inv[i];
      double t1 = (n.max[i] + radius - o[i]) * inv[i];
      if (t0 > t1) {
        const double s = t0;
        t0 = t1;
        t1 = s;
      }
      if (t0 > lo) lo = t0;
      if (t1 < hi) hi = t1;
      if (lo > hi) return false;
    }
    tNear = lo;
    return true;
  }

  std::uint32_t buildRange(const std::vector<double>& boxes, std::uint32_t first,
                           std::uint32_t count, std::size_t depth);

  std::vector<BvhNode> nodes_;
  std::vector<std::uint32_t> order_;
  std::size_t items_ = 0;
  std::size_t maxDepth_ = 0;
};

// ── face picking ────────────────────────────────────────────────────────────
struct FacePick {
  std::uint32_t faceId = 0;
  std::size_t triangle = 0;
  double distance = 0.0;
  double point[3] = {0.0, 0.0, 0.0};
  bool hit() const noexcept { return faceId != 0; }
};

// The mesh's triangles, indexed. It holds no reference to the mesh: the caller
// owns that and rebuilds the index when it changes, and `sourceTriangles()` is
// the cheap witness that says whether it has -- the same witness discipline the
// frame builder's measure and edge caches already use.
class TriangleIndex {
 public:
  void build(const MeasureMesh& mesh);
  void clear() noexcept;

  bool empty() const noexcept { return bvh_.empty(); }
  std::size_t sourceTriangles() const noexcept { return triangles_; }
  const BoundsBvh& bvh() const noexcept { return bvh_; }

  // Nearest triangle along the ray (Moller-Trumbore, 1997). `direction` need not
  // be unit; `distance` comes back in units of |direction|. It culls NOTHING by
  // winding: a pick must find a back face, because a section view and a
  // wrong-wound import both show them and a user still expects to click one.
  //
  // `clip` is the live SECTION PLANE, or nullptr. It is here rather than left to
  // the caller because a section view that still picks the geometry it has cut
  // away is worse than no section at all: the user clicks the visible interior
  // wall and selects the cap that is no longer on screen. A hit whose point is
  // on the removed side is skipped and the traversal carries on to what is
  // actually visible behind it.
  FacePick pick(const MeasureMesh& mesh, const double origin[3], const double direction[3],
                const SectionPlane* clip = nullptr) const;

  // How many triangles the LAST pick() actually intersected. This is the number
  // that makes the acceleration falsifiable: measured against the mesh's own
  // triangle count, a count that does not grow with it is the whole claim.
  std::size_t lastTested() const noexcept { return lastTested_; }

  // The same query with NO index: the positive control. Both must return the
  // same face for the same ray, or the tree is wrong rather than fast.
  static FacePick pickLinear(const MeasureMesh& mesh, const double origin[3],
                             const double direction[3], const SectionPlane* clip = nullptr);

 private:
  BoundsBvh bvh_;
  std::size_t triangles_ = 0;
  mutable std::size_t lastTested_ = 0;
};

// ── edge picking, indexed ───────────────────────────────────────────────────
// EdgeModel::pickEdge already answers this question by scanning every segment of
// every recovered edge. This is the same answer with the same tie-breaks, over a
// tree built on the segments.
class EdgeIndex {
 public:
  void build(const EdgeSet& set);
  void clear() noexcept;

  bool empty() const noexcept { return bvh_.empty(); }
  std::size_t segmentCount() const noexcept { return segments_; }
  const BoundsBvh& bvh() const noexcept { return bvh_; }

  // `maxDistance` is a WORLD radius about the ray; the caller converts its pixel
  // tolerance at the eye distance, exactly as the frame builder already does.
  EdgePick pick(const EdgeSet& set, const double origin[3], const double direction[3],
                double maxDistance) const;
  std::size_t lastTested() const noexcept { return lastTested_; }

 private:
  // Which (edge, segment) each indexed item is.
  struct Item {
    std::uint32_t edge = 0;
    std::uint32_t segment = 0;
  };
  BoundsBvh bvh_;
  std::vector<Item> items_;
  std::size_t segments_ = 0;
  mutable std::size_t lastTested_ = 0;
};

// ── vertex picking ──────────────────────────────────────────────────────────
// A B-REP CORNER RECOVERED FROM THE TESSELLATION, on the same principle
// EdgeModel recovers an edge: a welded mesh point incident to THREE OR MORE
// distinct B-rep face ids is a point where three surfaces meet, and that is a
// B-rep vertex.
//
// The limit is stated rather than hidden, as EdgeModel states its seam limit: a
// point where only TWO faces meet is an edge interior point, not a corner, so a
// plain cylinder recovers NO vertices at all (its rim is everywhere top-plane
// plus side, two faces). The recovered count is therefore a LOWER BOUND on the
// B-rep's vertex count, and the census beside it reports how many welded points
// were examined so the shortfall is visible instead of inferred.
struct MeshVertex {
  double p[3] = {0.0, 0.0, 0.0};
  std::vector<std::uint32_t> faces;  // sorted, distinct, size >= 3
  std::uint32_t ordinal = 0;         // disambiguates two corners with one face set

  // "vertex@<f0>_<f1>_<f2>...#<ordinal>" -- stable under any repermutation that
  // preserves the face ids, the same guarantee "face@<id>" and
  // "edge@<a>_<b>#<n>" already give.
  std::string key() const;
};

struct VertexSet {
  std::vector<MeshVertex> vertices;
  std::size_t weldedPoints = 0;   // distinct welded mesh points examined
  std::size_t twoFacePoints = 0;  // edge-interior points, deliberately not corners

  std::size_t size() const noexcept { return vertices.size(); }
  std::size_t indexOf(const std::string& name) const;
};

inline constexpr std::size_t kNoVertex = static_cast<std::size_t>(-1);

// Deterministic: vertices come back ordered by their face-id list then by
// position, so two runs over one mesh produce byte-identical keys.
VertexSet deriveVertices(const MeasureMesh& mesh);

struct VertexPick {
  std::size_t index = kNoVertex;
  double distance = 0.0;  // world distance from the ray to the vertex
  double along = 0.0;     // ray parameter of the closest point (>= 0)
  bool hit() const noexcept { return index != kNoVertex; }
};

// Nearest vertex within `maxDistance` of the ray. Ties break on the smaller ray
// parameter then the lower index, matching pickEdge, so the answer is
// deterministic and "the thing in front" wins.
VertexPick pickVertex(const VertexSet& set, const double origin[3], const double direction[3],
                      double maxDistance);

// ── the typed pick ──────────────────────────────────────────────────────────
// ONE entry point that answers what the live selection FILTER asked for, so the
// viewport cannot pick a face while the filter says Edge. `EntityKind::Any` and
// `EntityKind::Face` both pick a face; `Body` picks the body THROUGH a face hit,
// which is what clicking a solid means in every CAD system.
struct TypedPick {
  EntityKind kind = EntityKind::None;
  std::uint32_t faceId = 0;             // kind == Face or Body
  std::size_t edgeIndex = kNoEdge;      // kind == Edge
  std::size_t vertexIndex = kNoVertex;  // kind == Vertex
  double distance = 0.0;
  double point[3] = {0.0, 0.0, 0.0};
  std::string persistentName;  // "" for a Body: a body ref names no sub-entity

  bool hit() const noexcept { return kind != EntityKind::None; }
};

// What a pick needs that is not the ray: the recovered topology and the world
// tolerance a screen-space radius converts to. Grouped so the frame builder
// passes ONE thing and cannot hand in an edge set from a stale rebuild beside a
// live mesh.
struct PickScene {
  const MeasureMesh* mesh = nullptr;
  const TriangleIndex* triangles = nullptr;
  const EdgeSet* edges = nullptr;
  const EdgeIndex* edgeIndex = nullptr;
  const VertexSet* vertices = nullptr;
  // The live section plane, or nullptr when nothing is sectioned. See
  // TriangleIndex::pick: a pick that ignores the section selects invisible
  // geometry.
  const SectionPlane* section = nullptr;
  double worldTolerance = 0.0;  // the pixel band, converted at the eye distance

  bool complete() const noexcept {
    return mesh != nullptr && triangles != nullptr && edges != nullptr && edgeIndex != nullptr &&
           vertices != nullptr;
  }
};

// `filter` is the SelectionService filter verbatim. A filter naming a kind the
// viewport cannot produce from geometry (Sketch, Component, Datum, ...) returns
// a MISS rather than silently falling back to a face -- quietly substituting a
// kind is exactly how "pick an edge" came to pick a face.
TypedPick pickTyped(const PickScene& scene, EntityKind filter, const double origin[3],
                    const double direction[3]);

// TRUE when `kind` is something the 3D viewport can hit-test against geometry.
bool isViewportPickable(EntityKind kind) noexcept;

}  // namespace forge::ui

#endif  // FORGE_UI_VIEWPORTPICK_HPP
