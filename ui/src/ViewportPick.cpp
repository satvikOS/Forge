#include "forge/ui/ViewportPick.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/ViewStyle.hpp"

namespace forge::ui {
namespace {

using WeldKey = std::array<long long, 3>;

// The SAME quantum MeasureModel and EdgeModel weld on. A third tolerance here
// would put a vertex on one side of a bucket boundary and the edge that ends at
// it on the other, and the two would disagree about a point they both name.
WeldKey weld(const double p[3]) noexcept {
  return WeldKey{std::llround(p[0] / kMeasureWeldTolerance),
                 std::llround(p[1] / kMeasureWeldTolerance),
                 std::llround(p[2] / kMeasureWeldTolerance)};
}

double dot(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void sub(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
}

void cross(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

// Moller-Trumbore, "Fast, Minimum Storage Ray/Triangle Intersection", Journal of
// Graphics Tools 2(1), 1997. Two-sided on purpose: see TriangleIndex::pick.
// `t` comes back in units of |direction|.
bool rayTriangle(const double origin[3], const double direction[3], const double* tri,
                 double& t, double point[3]) noexcept {
  double e1[3], e2[3];
  sub(tri + 3, tri, e1);
  sub(tri + 6, tri, e2);
  double pv[3];
  cross(direction, e2, pv);
  const double det = dot(e1, pv);
  // The epsilon is on the DETERMINANT, which carries the scale of the two edges
  // and the ray. A degenerate (zero-area) triangle and a ray in the triangle's
  // plane both land here, and both are honest misses.
  if (std::fabs(det) < 1e-14) return false;
  const double invDet = 1.0 / det;
  double tv[3];
  sub(origin, tri, tv);
  const double u = dot(tv, pv) * invDet;
  if (u < 0.0 || u > 1.0) return false;
  double qv[3];
  cross(tv, e1, qv);
  const double v = dot(direction, qv) * invDet;
  if (v < 0.0 || u + v > 1.0) return false;
  const double hit = dot(e2, qv) * invDet;
  if (hit < 0.0) return false;  // behind the eye
  t = hit;
  for (int i = 0; i < 3; ++i) point[i] = origin[i] + direction[i] * hit;
  return true;
}

// Squared distance from a point to a ray, and the ray parameter of the closest
// point. Clamped at 0: a point behind the eye measures to the eye, not to a
// negative extension of the ray.
double pointRayDistance2(const double p[3], const double origin[3], const double direction[3],
                         double& along) noexcept {
  double w[3];
  sub(p, origin, w);
  const double dd = dot(direction, direction);
  along = dd > 1e-18 ? dot(w, direction) / dd : 0.0;
  if (along < 0.0) along = 0.0;
  double closest[3];
  for (int i = 0; i < 3; ++i) closest[i] = origin[i] + direction[i] * along - p[i];
  return dot(closest, closest);
}

// Squared distance between a ray and a finite segment, with the ray parameter of
// the closest approach. The same construction EdgeModel::pickEdge uses, so the
// indexed edge pick and the linear one cannot disagree about a tie.
double segmentRayDistance2(const double a[3], const double b[3], const double origin[3],
                           const double direction[3], double& along) noexcept {
  double u[3], v[3], w[3];
  for (int i = 0; i < 3; ++i) {
    u[i] = direction[i];
    v[i] = b[i] - a[i];
    w[i] = origin[i] - a[i];
  }
  const double a1 = dot(u, u);
  const double b1 = dot(u, v);
  const double c1 = dot(v, v);
  const double d1 = dot(u, w);
  const double e1 = dot(v, w);
  const double den = a1 * c1 - b1 * b1;
  // Only the SEGMENT parameter is solved for here. The unconstrained ray
  // parameter the same system yields is discarded on purpose: it is wrong the
  // moment the segment parameter is clamped, and it takes no account of the ray
  // being a half-line. Both are re-derived below from the clamped point.
  double tt = 0.0;  // segment parameter, clamped to [0,1]
  if (den > 1e-18) {
    tt = (a1 * e1 - b1 * d1) / den;
  } else {
    tt = 0.0;  // parallel: any point on the ray is as good, so take the start
  }
  if (tt < 0.0) tt = 0.0;
  if (tt > 1.0) tt = 1.0;
  double q[3];
  for (int i = 0; i < 3; ++i) q[i] = a[i] + v[i] * tt;
  double along2 = 0.0;
  const double d2 = pointRayDistance2(q, origin, direction, along2);
  along = along2;
  return d2;
}

}  // namespace

// ── BoundsBvh ───────────────────────────────────────────────────────────────
void BoundsBvh::clear() noexcept {
  nodes_.clear();
  order_.clear();
  items_ = 0;
  maxDepth_ = 0;
}

std::uint32_t BoundsBvh::buildRange(const std::vector<double>& boxes, std::uint32_t first,
                                    std::uint32_t count, std::size_t depth) {
  const std::uint32_t self = static_cast<std::uint32_t>(nodes_.size());
  nodes_.push_back(BvhNode{});
  if (depth > maxDepth_) maxDepth_ = depth;

  double lo[3] = {0.0, 0.0, 0.0};
  double hi[3] = {0.0, 0.0, 0.0};
  for (std::uint32_t k = 0; k < count; ++k) {
    const std::size_t item = static_cast<std::size_t>(order_[first + k]);
    const double* b = &boxes[item * 6];
    for (int i = 0; i < 3; ++i) {
      if (k == 0) {
        lo[i] = b[i];
        hi[i] = b[3 + i];
      } else {
        lo[i] = std::min(lo[i], b[i]);
        hi[i] = std::max(hi[i], b[3 + i]);
      }
    }
  }
  for (int i = 0; i < 3; ++i) {
    nodes_[self].min[i] = lo[i];
    nodes_[self].max[i] = hi[i];
  }

  // A leaf at the item cap, and a HARD leaf at depth 62 so the traversal stack
  // (64 entries, two pushes per level) can never overflow. A pathological set of
  // coincident boxes cannot be split by any median, so without this the recursion
  // would not terminate on it -- which is the failure mode a median-split BVH
  // actually has.
  if (count <= kBvhLeafSize || depth >= 62) {
    nodes_[self].start = first;
    nodes_[self].count = count;
    return self;
  }

  int axis = 0;
  double widest = hi[0] - lo[0];
  for (int i = 1; i < 3; ++i) {
    if (hi[i] - lo[i] > widest) {
      widest = hi[i] - lo[i];
      axis = i;
    }
  }
  const std::uint32_t mid = count / 2;
  std::nth_element(order_.begin() + first, order_.begin() + first + mid,
                   order_.begin() + first + count,
                   [&boxes, axis](std::uint32_t x, std::uint32_t y) {
                     const double cx = boxes[x * 6 + static_cast<std::size_t>(axis)] +
                                       boxes[x * 6 + 3 + static_cast<std::size_t>(axis)];
                     const double cy = boxes[y * 6 + static_cast<std::size_t>(axis)] +
                                       boxes[y * 6 + 3 + static_cast<std::size_t>(axis)];
                     if (cx != cy) return cx < cy;
                     return x < y;  // total order: nth_element on ties must be deterministic
                   });
  const std::uint32_t l = buildRange(boxes, first, mid, depth + 1);
  const std::uint32_t r = buildRange(boxes, first + mid, count - mid, depth + 1);
  nodes_[self].left = l;
  nodes_[self].right = r;
  nodes_[self].count = 0;
  return self;
}

bool BoundsBvh::build(const std::vector<double>& itemBoxes) {
  clear();
  if (itemBoxes.size() % 6 != 0) return false;
  items_ = itemBoxes.size() / 6;
  if (items_ == 0) return true;  // an empty tree is a legal answer, not a failure
  order_.resize(items_);
  for (std::size_t i = 0; i < items_; ++i) order_[i] = static_cast<std::uint32_t>(i);
  // A median-split tree of n items has at most 2n-1 nodes.
  nodes_.reserve(2 * items_);
  buildRange(itemBoxes, 0, static_cast<std::uint32_t>(items_), 1);
  return true;
}

// ── TriangleIndex ───────────────────────────────────────────────────────────
void TriangleIndex::clear() noexcept {
  bvh_.clear();
  triangles_ = 0;
  lastTested_ = 0;
}

void TriangleIndex::build(const MeasureMesh& mesh) {
  clear();
  triangles_ = mesh.triangleCount();
  if (triangles_ == 0) return;
  const std::vector<double>& xyz = mesh.coords();
  std::vector<double> boxes(triangles_ * 6);
  for (std::size_t t = 0; t < triangles_; ++t) {
    const double* p = &xyz[t * 9];
    for (int i = 0; i < 3; ++i) {
      double lo = p[i];
      double hi = p[i];
      lo = std::min(lo, std::min(p[3 + i], p[6 + i]));
      hi = std::max(hi, std::max(p[3 + i], p[6 + i]));
      boxes[t * 6 + static_cast<std::size_t>(i)] = lo;
      boxes[t * 6 + 3 + static_cast<std::size_t>(i)] = hi;
    }
  }
  bvh_.build(boxes);
}

FacePick TriangleIndex::pick(const MeasureMesh& mesh, const double origin[3],
                             const double direction[3], const SectionPlane* clip) const {
  lastTested_ = 0;
  FacePick out;
  // A stale index over a rebuilt mesh would read triangles that are not there.
  // Answering a miss is the honest reading; the caller's witness (sourceTriangles
  // == mesh.triangleCount()) is what stops it from happening at all.
  if (bvh_.empty() || mesh.triangleCount() != triangles_) return out;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  double tBest = 1.0e300;
  std::size_t bestTri = 0;
  bool found = false;
  double bestPoint[3] = {0.0, 0.0, 0.0};

  lastTested_ = bvh_.rayQuery(origin, direction, tBest,
                              [&](std::uint32_t item, double& tMax) {
                                double t = 0.0;
                                double p[3];
                                if (!rayTriangle(origin, direction, &xyz[item * 9], t, p)) return;
                                if (t >= tMax) return;
                                // Sectioned-away geometry is not on screen, so it
                                // is not pickable. tMax is deliberately NOT
                                // narrowed here: the traversal must carry on to
                                // whatever is visible behind the removed surface.
                                if (clip != nullptr && !clip->keeps(p)) return;
                                tMax = t;  // narrows the traversal: this is the pruning
                                found = true;
                                bestTri = item;
                                bestPoint[0] = p[0];
                                bestPoint[1] = p[1];
                                bestPoint[2] = p[2];
                              });
  if (!found) return out;
  out.faceId = ids[bestTri];
  out.triangle = bestTri;
  out.distance = tBest;
  out.point[0] = bestPoint[0];
  out.point[1] = bestPoint[1];
  out.point[2] = bestPoint[2];
  // A triangle carrying face id 0 means "unknown face" in the vertex stream, and
  // FacePick::hit() reads a 0 as a miss. Report the hit distance anyway so a
  // caller measuring depth is not lied to; kind resolution is the caller's.
  return out;
}

FacePick TriangleIndex::pickLinear(const MeasureMesh& mesh, const double origin[3],
                                   const double direction[3], const SectionPlane* clip) {
  FacePick out;
  const std::size_t n = mesh.triangleCount();
  if (n == 0) return out;
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  double tBest = 1.0e300;
  bool found = false;
  for (std::size_t t = 0; t < n; ++t) {
    double hit = 0.0;
    double p[3];
    if (!rayTriangle(origin, direction, &xyz[t * 9], hit, p)) continue;
    if (hit >= tBest) continue;
    if (clip != nullptr && !clip->keeps(p)) continue;
    tBest = hit;
    found = true;
    out.faceId = ids[t];
    out.triangle = t;
    out.distance = hit;
    out.point[0] = p[0];
    out.point[1] = p[1];
    out.point[2] = p[2];
  }
  if (!found) return FacePick{};
  return out;
}

// ── EdgeIndex ───────────────────────────────────────────────────────────────
void EdgeIndex::clear() noexcept {
  bvh_.clear();
  items_.clear();
  segments_ = 0;
  lastTested_ = 0;
}

void EdgeIndex::build(const EdgeSet& set) {
  clear();
  std::vector<double> boxes;
  for (std::size_t e = 0; e < set.edges.size(); ++e) {
    const MeshEdge& edge = set.edges[e];
    for (std::size_t s = 0; s + 5 < edge.points.size(); s += 6) {
      const double* a = &edge.points[s];
      const double* b = &edge.points[s + 3];
      for (int i = 0; i < 3; ++i) boxes.push_back(std::min(a[i], b[i]));
      for (int i = 0; i < 3; ++i) boxes.push_back(std::max(a[i], b[i]));
      items_.push_back(Item{static_cast<std::uint32_t>(e), static_cast<std::uint32_t>(s / 6)});
    }
  }
  segments_ = items_.size();
  bvh_.build(boxes);
}

EdgePick EdgeIndex::pick(const EdgeSet& set, const double origin[3], const double direction[3],
                         double maxDistance) const {
  lastTested_ = 0;
  EdgePick out;
  if (bvh_.empty() || !(maxDistance > 0.0)) return out;

  // An edge pick is a DISTANCE-to-ray query, not a surface intersection, so the
  // traversal must not prune on the ray parameter: tMax stays unbounded and the
  // node boxes are dilated by the tolerance instead. The dilated slab test is
  // conservative (a box corner within `maxDistance` of the ray in each axis
  // separately), so it over-admits and never under-admits; the true segment
  // distance below rejects the surplus.
  const double dLen2 = dot(direction, direction);
  if (!(dLen2 > 1e-18)) return out;
  double tMax = 1.0e300;
  double bestD2 = maxDistance * maxDistance;
  double bestAlong = 0.0;
  std::size_t bestIndex = kNoEdge;

  lastTested_ = bvh_.rayQueryDilated(
      origin, direction, tMax, maxDistance, [&](std::uint32_t item, double&) {
        const Item& it = items_[item];
        const MeshEdge& edge = set.edges[it.edge];
        const std::size_t s = static_cast<std::size_t>(it.segment) * 6;
        double along = 0.0;
        const double d2 =
            segmentRayDistance2(&edge.points[s], &edge.points[s + 3], origin, direction, along);
        if (d2 > bestD2) return;
        if (d2 == bestD2 && bestIndex != kNoEdge) {
          // Same distance: the one in FRONT wins, then the lower edge index --
          // EdgeModel::pickEdge's tie-break, verbatim, so the indexed answer and
          // the linear one cannot differ.
          if (along > bestAlong) return;
          if (along == bestAlong && it.edge >= bestIndex) return;
        }
        bestD2 = d2;
        bestAlong = along;
        bestIndex = it.edge;
      });
  if (bestIndex == kNoEdge) return out;
  out.index = bestIndex;
  out.distance = std::sqrt(bestD2);
  out.along = bestAlong;
  return out;
}

// ── vertices ────────────────────────────────────────────────────────────────
std::string MeshVertex::key() const {
  std::string k = "vertex@";
  for (std::size_t i = 0; i < faces.size(); ++i) {
    if (i != 0) k += '_';
    k += std::to_string(faces[i]);
  }
  k += '#';
  k += std::to_string(ordinal);
  return k;
}

std::size_t VertexSet::indexOf(const std::string& name) const {
  for (std::size_t i = 0; i < vertices.size(); ++i) {
    if (vertices[i].key() == name) return i;
  }
  return kNoVertex;
}

VertexSet deriveVertices(const MeasureMesh& mesh) {
  VertexSet out;
  if (mesh.empty()) return out;

  struct Point {
    double p[3] = {0.0, 0.0, 0.0};
    std::set<std::uint32_t> faces;
  };
  std::map<WeldKey, Point> points;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  for (std::size_t t = 0; t < ids.size(); ++t) {
    for (int c = 0; c < 3; ++c) {
      const double* p = &xyz[t * 9 + static_cast<std::size_t>(c) * 3];
      Point& slot = points[weld(p)];
      if (slot.faces.empty()) {
        slot.p[0] = p[0];
        slot.p[1] = p[1];
        slot.p[2] = p[2];
      }
      slot.faces.insert(ids[t]);
    }
  }
  out.weldedPoints = points.size();

  for (const auto& entry : points) {
    if (entry.second.faces.size() == 2) ++out.twoFacePoints;
    if (entry.second.faces.size() < 3) continue;
    MeshVertex v;
    v.p[0] = entry.second.p[0];
    v.p[1] = entry.second.p[1];
    v.p[2] = entry.second.p[2];
    v.faces.assign(entry.second.faces.begin(), entry.second.faces.end());
    out.vertices.push_back(std::move(v));
  }

  // Deterministic order: by face-id list, then by position. Two runs over one
  // mesh must produce the same keys or a saved selection stops resolving.
  std::sort(out.vertices.begin(), out.vertices.end(),
            [](const MeshVertex& a, const MeshVertex& b) {
              if (a.faces != b.faces) return a.faces < b.faces;
              for (int i = 0; i < 3; ++i) {
                if (a.p[i] != b.p[i]) return a.p[i] < b.p[i];
              }
              return false;
            });
  // Ordinals within one face set. Two corners CAN share a face set -- a slot
  // through a plate meets the same three faces at both ends -- and without this
  // they would share a key, so a selection of one would resolve to the other.
  for (std::size_t i = 0; i < out.vertices.size(); ++i) {
    if (i != 0 && out.vertices[i].faces == out.vertices[i - 1].faces) {
      out.vertices[i].ordinal = out.vertices[i - 1].ordinal + 1;
    } else {
      out.vertices[i].ordinal = 0;
    }
  }
  return out;
}

VertexPick pickVertex(const VertexSet& set, const double origin[3], const double direction[3],
                      double maxDistance) {
  VertexPick out;
  if (set.vertices.empty() || !(maxDistance > 0.0)) return out;
  double bestD2 = maxDistance * maxDistance;
  for (std::size_t i = 0; i < set.vertices.size(); ++i) {
    double along = 0.0;
    const double d2 = pointRayDistance2(set.vertices[i].p, origin, direction, along);
    if (d2 > bestD2) continue;
    if (d2 == bestD2 && out.hit() && along >= out.along) continue;
    bestD2 = d2;
    out.index = i;
    out.distance = std::sqrt(d2);
    out.along = along;
  }
  return out;
}

// ── the typed pick ──────────────────────────────────────────────────────────
bool isViewportPickable(EntityKind kind) noexcept {
  switch (kind) {
    case EntityKind::Vertex:
    case EntityKind::Edge:
    case EntityKind::Face:
    case EntityKind::Body:
    case EntityKind::Any:
      return true;
    case EntityKind::None:
    case EntityKind::Sketch:
    case EntityKind::SketchCurve:
    case EntityKind::Wire:
    case EntityKind::Feature:
    case EntityKind::Component:
    case EntityKind::Datum:
      return false;
  }
  return false;
}

TypedPick pickTyped(const PickScene& scene, EntityKind filter, const double origin[3],
                    const double direction[3]) {
  TypedPick out;
  if (!scene.complete() || !isViewportPickable(filter)) return out;

  if (filter == EntityKind::Edge) {
    const EdgePick p = scene.edgeIndex->pick(*scene.edges, origin, direction,
                                             scene.worldTolerance);
    if (!p.hit()) return out;
    out.kind = EntityKind::Edge;
    out.edgeIndex = p.index;
    out.distance = p.along;
    out.persistentName = scene.edges->edges[p.index].key();
    for (int i = 0; i < 3; ++i) out.point[i] = origin[i] + direction[i] * p.along;
    return out;
  }

  if (filter == EntityKind::Vertex) {
    const VertexPick p = pickVertex(*scene.vertices, origin, direction, scene.worldTolerance);
    if (!p.hit()) return out;
    out.kind = EntityKind::Vertex;
    out.vertexIndex = p.index;
    out.distance = p.along;
    out.persistentName = scene.vertices->vertices[p.index].key();
    for (int i = 0; i < 3; ++i) out.point[i] = scene.vertices->vertices[p.index].p[i];
    return out;
  }

  // Face, Body and Any all resolve through the surface hit. Any prefers the
  // most SPECIFIC entity under the cursor -- vertex, then edge, then face --
  // which is what "no filter" means in every CAD system: the closer you get to a
  // corner, the more the corner is what you meant.
  const FacePick f = scene.triangles->pick(*scene.mesh, origin, direction, scene.section);
  if (filter == EntityKind::Any) {
    const VertexPick v = pickVertex(*scene.vertices, origin, direction, scene.worldTolerance);
    if (v.hit() && (!f.hit() || v.along <= f.distance + scene.worldTolerance)) {
      out.kind = EntityKind::Vertex;
      out.vertexIndex = v.index;
      out.distance = v.along;
      out.persistentName = scene.vertices->vertices[v.index].key();
      for (int i = 0; i < 3; ++i) out.point[i] = scene.vertices->vertices[v.index].p[i];
      return out;
    }
    const EdgePick e = scene.edgeIndex->pick(*scene.edges, origin, direction,
                                             scene.worldTolerance);
    if (e.hit() && (!f.hit() || e.along <= f.distance + scene.worldTolerance)) {
      out.kind = EntityKind::Edge;
      out.edgeIndex = e.index;
      out.distance = e.along;
      out.persistentName = scene.edges->edges[e.index].key();
      for (int i = 0; i < 3; ++i) out.point[i] = origin[i] + direction[i] * e.along;
      return out;
    }
  }
  if (!f.hit()) return out;
  out.faceId = f.faceId;
  out.distance = f.distance;
  out.point[0] = f.point[0];
  out.point[1] = f.point[1];
  out.point[2] = f.point[2];
  if (filter == EntityKind::Body) {
    out.kind = EntityKind::Body;
    out.persistentName.clear();  // a body ref names the whole body, not a sub-entity
  } else {
    out.kind = EntityKind::Face;
    out.persistentName = "face@" + std::to_string(f.faceId);
  }
  return out;
}

}  // namespace forge::ui
