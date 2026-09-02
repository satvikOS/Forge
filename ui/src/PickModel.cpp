#include "forge/ui/PickModel.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {
namespace {

// The SAME weld quantum MeasureModel and EdgeModel use. Spelled again rather
// than shared because the helper is file-local in both of them; the CONSTANT is
// shared, which is the part that must not drift.
using WeldKey = std::array<long long, 3>;

WeldKey weld(const double p[3]) noexcept {
  return WeldKey{std::llround(p[0] / kMeasureWeldTolerance),
                 std::llround(p[1] / kMeasureWeldTolerance),
                 std::llround(p[2] / kMeasureWeldTolerance)};
}

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void cross3(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

// Möller–Trumbore, 1997. Two-sided: a CAD pick wants the nearest surface under
// the cursor whichever way it faces, because a shelled or open body shows its
// inside and a back-face cull would make that surface unpickable.
//
// `t` comes back in units of |direction|, so a caller that passes a unit
// direction gets a world distance and a caller that does not gets a parameter
// it can still compare between hits. Every consumer here compares hits from the
// SAME ray, so the scale cancels.
bool rayTriangle(const double origin[3], const double direction[3], const double* tri,
                 double& t) noexcept {
  constexpr double kEps = 1e-12;
  const double e1[3] = {tri[3] - tri[0], tri[4] - tri[1], tri[5] - tri[2]};
  const double e2[3] = {tri[6] - tri[0], tri[7] - tri[1], tri[8] - tri[2]};
  double pv[3];
  cross3(direction, e2, pv);
  const double det = dot3(e1, pv);
  if (det > -kEps && det < kEps) return false;  // ray parallel to the triangle
  const double invDet = 1.0 / det;
  const double tv[3] = {origin[0] - tri[0], origin[1] - tri[1], origin[2] - tri[2]};
  const double u = dot3(tv, pv) * invDet;
  if (u < 0.0 || u > 1.0) return false;
  double qv[3];
  cross3(tv, e1, qv);
  const double v = dot3(direction, qv) * invDet;
  if (v < 0.0 || u + v > 1.0) return false;
  const double hit = dot3(e2, qv) * invDet;
  if (hit <= kEps) return false;  // behind the eye
  t = hit;
  return true;
}

// Squared distance from a point to a ray, and the ray parameter of the closest
// approach. Clamped at 0 so a point behind the eye reports its distance to the
// ray ORIGIN rather than to the backward extension of the ray.
double pointToRaySquared(const double origin[3], const double direction[3], const double p[3],
                         double& along) noexcept {
  const double w[3] = {p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]};
  const double dd = dot3(direction, direction);
  along = dd > 0.0 ? dot3(w, direction) / dd : 0.0;
  if (along < 0.0) along = 0.0;
  const double c[3] = {w[0] - along * direction[0], w[1] - along * direction[1],
                       w[2] - along * direction[2]};
  return dot3(c, c);
}

}  // namespace

// ── tolerance conversion ────────────────────────────────────────────────────
double worldPerPixel(double eyeDistance, double fovYRadians, double viewportHeightPixels) noexcept {
  const double h = viewportHeightPixels > 1.0 ? viewportHeightPixels : 1.0;
  const double d = eyeDistance > 0.0 ? eyeDistance : 0.0;
  return 2.0 * d * std::tan(0.5 * fovYRadians) / h;
}

// ── the linear reference scan ───────────────────────────────────────────────
FacePick pickFaceLinear(const MeasureMesh& mesh, const double origin[3],
                        const double direction[3]) noexcept {
  FacePick best;
  double bestT = std::numeric_limits<double>::infinity();
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  for (std::size_t i = 0; i < ids.size(); ++i) {
    double t = 0.0;
    if (!rayTriangle(origin, direction, &xyz[i * 9], t)) continue;
    if (t >= bestT) continue;
    bestT = t;
    best.faceId = ids[i];
    best.triangle = i;
    best.distance = t;
  }
  if (best.faceId != 0) {
    for (int a = 0; a < 3; ++a) best.point[a] = origin[a] + bestT * direction[a];
  }
  return best;
}

// ── the uniform grid ────────────────────────────────────────────────────────
std::size_t PickAccelerator::cellCount() const noexcept {
  return static_cast<std::size_t>(dim_[0]) * static_cast<std::size_t>(dim_[1]) *
         static_cast<std::size_t>(dim_[2]);
}

void PickAccelerator::clear() noexcept {
  built_ = false;
  triangleCount_ = 0;
  dim_[0] = dim_[1] = dim_[2] = 1;
  start_.clear();
  items_.clear();
  mailbox_.clear();
  stamp_ = 0;
  lastTested_ = 0;
  lastCells_ = 0;
}

void PickAccelerator::build(const MeasureMesh& mesh) {
  clear();
  const std::size_t n = mesh.triangleCount();
  if (n == 0) return;
  const std::vector<double>& xyz = mesh.coords();

  for (int a = 0; a < 3; ++a) {
    min_[a] = std::numeric_limits<double>::infinity();
    max_[a] = -std::numeric_limits<double>::infinity();
  }
  for (std::size_t i = 0; i < n * 3; ++i) {
    for (int a = 0; a < 3; ++a) {
      const double v = xyz[i * 3 + static_cast<std::size_t>(a)];
      if (v < min_[a]) min_[a] = v;
      if (v > max_[a]) max_[a] = v;
    }
  }

  // Target roughly one triangle per cell, which is the classic uniform-grid
  // rule of thumb, and cap the axis count so a degenerate (flat) part cannot ask
  // for an enormous grid along an axis of zero extent.
  const double target = std::cbrt(static_cast<double>(n));
  int axes = static_cast<int>(target + 0.5);
  if (axes < 1) axes = 1;
  if (axes > 128) axes = 128;

  double extent[3];
  double longest = 0.0;
  for (int a = 0; a < 3; ++a) {
    extent[a] = max_[a] - min_[a];
    if (extent[a] > longest) longest = extent[a];
  }
  if (!(longest > 0.0)) longest = 1.0;
  for (int a = 0; a < 3; ++a) {
    // Pad a zero-extent axis so a planar sheet still has a cell to live in.
    if (!(extent[a] > 0.0)) {
      const double pad = longest * 1e-6;
      min_[a] -= pad;
      max_[a] += pad;
      extent[a] = max_[a] - min_[a];
    }
    int d = static_cast<int>(static_cast<double>(axes) * extent[a] / longest + 0.5);
    if (d < 1) d = 1;
    if (d > 128) d = 128;
    dim_[a] = d;
    cell_[a] = extent[a] / static_cast<double>(d);
    if (!(cell_[a] > 0.0)) cell_[a] = 1.0;
  }

  const std::size_t cells = cellCount();
  // Two passes: count per cell, prefix-sum, then scatter. No sorting, no
  // per-cell vector, one allocation per array.
  std::vector<std::uint32_t> counts(cells + 1, 0);
  const auto cellRange = [&](std::size_t tri, int lo[3], int hi[3]) {
    for (int a = 0; a < 3; ++a) {
      double tmin = xyz[tri * 9 + static_cast<std::size_t>(a)];
      double tmax = tmin;
      for (int c = 1; c < 3; ++c) {
        const double v = xyz[tri * 9 + static_cast<std::size_t>(c * 3 + a)];
        if (v < tmin) tmin = v;
        if (v > tmax) tmax = v;
      }
      int l = static_cast<int>((tmin - min_[a]) / cell_[a]);
      int h = static_cast<int>((tmax - min_[a]) / cell_[a]);
      if (l < 0) l = 0;
      if (h < 0) h = 0;
      if (l >= dim_[a]) l = dim_[a] - 1;
      if (h >= dim_[a]) h = dim_[a] - 1;
      lo[a] = l;
      hi[a] = h;
    }
  };

  for (std::size_t i = 0; i < n; ++i) {
    int lo[3], hi[3];
    cellRange(i, lo, hi);
    for (int z = lo[2]; z <= hi[2]; ++z) {
      for (int y = lo[1]; y <= hi[1]; ++y) {
        for (int x = lo[0]; x <= hi[0]; ++x) {
          ++counts[static_cast<std::size_t>((z * dim_[1] + y) * dim_[0] + x)];
        }
      }
    }
  }
  start_.assign(cells + 1, 0);
  std::uint32_t running = 0;
  for (std::size_t c = 0; c < cells; ++c) {
    start_[c] = running;
    running += counts[c];
  }
  start_[cells] = running;
  items_.assign(running, 0);
  std::vector<std::uint32_t> cursor(start_.begin(), start_.begin() + static_cast<std::ptrdiff_t>(cells));
  for (std::size_t i = 0; i < n; ++i) {
    int lo[3], hi[3];
    cellRange(i, lo, hi);
    for (int z = lo[2]; z <= hi[2]; ++z) {
      for (int y = lo[1]; y <= hi[1]; ++y) {
        for (int x = lo[0]; x <= hi[0]; ++x) {
          const std::size_t c = static_cast<std::size_t>((z * dim_[1] + y) * dim_[0] + x);
          items_[cursor[c]++] = static_cast<std::uint32_t>(i);
        }
      }
    }
  }

  mailbox_.assign(n, 0);
  stamp_ = 0;
  triangleCount_ = n;
  built_ = true;
}

FacePick PickAccelerator::pick(const MeasureMesh& mesh, const double origin[3],
                               const double direction[3]) const noexcept {
  lastTested_ = 0;
  lastCells_ = 0;
  FacePick best;
  if (!built_ || mesh.triangleCount() != triangleCount_) return best;

  // ── clip the ray to the grid's box ────────────────────────────────────────
  double tEnter = 0.0;
  double tExit = std::numeric_limits<double>::infinity();
  for (int a = 0; a < 3; ++a) {
    if (std::fabs(direction[a]) < 1e-15) {
      if (origin[a] < min_[a] || origin[a] > max_[a]) return best;
      continue;
    }
    const double inv = 1.0 / direction[a];
    double t0 = (min_[a] - origin[a]) * inv;
    double t1 = (max_[a] - origin[a]) * inv;
    if (t0 > t1) std::swap(t0, t1);
    if (t0 > tEnter) tEnter = t0;
    if (t1 < tExit) tExit = t1;
    if (tEnter > tExit) return best;
  }

  // ── seed the DDA ──────────────────────────────────────────────────────────
  int cellIdx[3];
  int step[3];
  double tMax[3];
  double tDelta[3];
  for (int a = 0; a < 3; ++a) {
    const double p = origin[a] + tEnter * direction[a];
    int c = static_cast<int>((p - min_[a]) / cell_[a]);
    if (c < 0) c = 0;
    if (c >= dim_[a]) c = dim_[a] - 1;
    cellIdx[a] = c;
    if (std::fabs(direction[a]) < 1e-15) {
      step[a] = 0;
      tMax[a] = std::numeric_limits<double>::infinity();
      tDelta[a] = std::numeric_limits<double>::infinity();
    } else if (direction[a] > 0.0) {
      step[a] = 1;
      const double boundary = min_[a] + static_cast<double>(c + 1) * cell_[a];
      tMax[a] = (boundary - origin[a]) / direction[a];
      tDelta[a] = cell_[a] / direction[a];
    } else {
      step[a] = -1;
      const double boundary = min_[a] + static_cast<double>(c) * cell_[a];
      tMax[a] = (boundary - origin[a]) / direction[a];
      tDelta[a] = -cell_[a] / direction[a];
    }
  }

  // A fresh stamp per query. On wraparound the mailbox is reset, so a stale
  // stamp from 4 billion queries ago cannot suppress a triangle test.
  if (++stamp_ == 0) {
    std::fill(mailbox_.begin(), mailbox_.end(), 0u);
    stamp_ = 1;
  }

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  double bestT = std::numeric_limits<double>::infinity();

  for (;;) {
    ++lastCells_;
    const std::size_t c = static_cast<std::size_t>((cellIdx[2] * dim_[1] + cellIdx[1]) * dim_[0] +
                                                  cellIdx[0]);
    for (std::uint32_t k = start_[c]; k < start_[c + 1]; ++k) {
      const std::uint32_t tri = items_[k];
      if (mailbox_[tri] == stamp_) continue;  // already tested in this query
      mailbox_[tri] = stamp_;
      ++lastTested_;
      double t = 0.0;
      if (!rayTriangle(origin, direction, &xyz[static_cast<std::size_t>(tri) * 9], t)) continue;
      if (t >= bestT) continue;
      bestT = t;
      best.faceId = ids[tri];
      best.triangle = tri;
      best.distance = t;
    }

    // Advance to the next cell, and stop as soon as the nearest hit so far is
    // closer than the far wall of the cell just finished: nothing further along
    // the ray can beat it.
    int axis = 0;
    if (tMax[1] < tMax[axis]) axis = 1;
    if (tMax[2] < tMax[axis]) axis = 2;
    if (bestT <= tMax[axis]) break;
    if (tMax[axis] > tExit) break;
    cellIdx[axis] += step[axis];
    if (cellIdx[axis] < 0 || cellIdx[axis] >= dim_[axis]) break;
    tMax[axis] += tDelta[axis];
  }

  if (best.faceId != 0) {
    for (int a = 0; a < 3; ++a) best.point[a] = origin[a] + bestT * direction[a];
  }
  return best;
}

// ── vertices ────────────────────────────────────────────────────────────────
std::string MeshVertex::key() const {
  std::string k = "vertex@";
  for (std::size_t i = 0; i < faces.size(); ++i) {
    if (i > 0) k += '_';
    k += std::to_string(faces[i]);
  }
  k += '#';
  k += std::to_string(component);
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
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();

  struct Accum {
    double p[3] = {0.0, 0.0, 0.0};
    std::vector<std::uint32_t> faces;
    std::size_t triangles = 0;
  };
  // std::map, not unordered_map: the iteration order IS the tie-break that makes
  // the component numbering reproducible across runs and platforms.
  std::map<WeldKey, Accum> points;
  for (std::size_t t = 0; t < ids.size(); ++t) {
    for (int c = 0; c < 3; ++c) {
      const double* p = &xyz[t * 9 + static_cast<std::size_t>(c * 3)];
      Accum& a = points[weld(p)];
      if (a.triangles == 0) {
        a.p[0] = p[0];
        a.p[1] = p[1];
        a.p[2] = p[2];
      }
      ++a.triangles;
      if (std::find(a.faces.begin(), a.faces.end(), ids[t]) == a.faces.end()) {
        a.faces.push_back(ids[t]);
      }
    }
  }
  out.weldedPoints = points.size();

  // Group by face SET so the component index can be assigned deterministically.
  std::map<std::vector<std::uint32_t>, std::vector<Accum>> byFaces;
  for (auto& kv : points) {
    Accum& a = kv.second;
    if (a.faces.size() < 3) {
      if (a.faces.size() == 2) {
        ++out.twoFacePoints;
      } else {
        ++out.oneFacePoints;
      }
      continue;
    }
    std::sort(a.faces.begin(), a.faces.end());
    byFaces[a.faces].push_back(a);
  }
  for (auto& kv : byFaces) {
    std::vector<Accum>& group = kv.second;
    std::sort(group.begin(), group.end(), [](const Accum& x, const Accum& y) {
      const WeldKey kx = weld(x.p);
      const WeldKey ky = weld(y.p);
      return kx < ky;
    });
    for (std::size_t i = 0; i < group.size(); ++i) {
      MeshVertex v;
      v.p[0] = group[i].p[0];
      v.p[1] = group[i].p[1];
      v.p[2] = group[i].p[2];
      v.faces = kv.first;
      v.triangles = group[i].triangles;
      v.component = static_cast<std::uint32_t>(i);
      out.vertices.push_back(std::move(v));
    }
  }
  return out;
}

VertexPick pickVertex(const VertexSet& set, const double origin[3], const double direction[3],
                      double maxDistance) noexcept {
  VertexPick best;
  double bestDistance = maxDistance;
  for (std::size_t i = 0; i < set.vertices.size(); ++i) {
    double along = 0.0;
    const double d2 = pointToRaySquared(origin, direction, set.vertices[i].p, along);
    const double d = std::sqrt(d2);
    if (d > bestDistance) continue;
    if (d < bestDistance || !best.hit() || along < best.along) {
      bestDistance = d;
      best.index = i;
      best.distance = d;
      best.along = along;
    }
  }
  return best;
}

// ── the whole pick ──────────────────────────────────────────────────────────
namespace {

ScenePick faceAnswer(const PickScene& scene, const FacePick& face) {
  ScenePick out;
  out.faceId = face.faceId;
  out.distance = face.distance;
  for (int a = 0; a < 3; ++a) out.point[a] = face.point[a];
  out.ref.bodyId = scene.bodyId;
  out.ref.kind = EntityKind::Face;
  out.ref.persistentName = "face@" + std::to_string(face.faceId);
  return out;
}

}  // namespace

ScenePick pickScene(const PickScene& scene, const PickRequest& request) {
  ScenePick out;
  if (scene.mesh == nullptr || scene.mesh->empty()) return out;
  if (scene.bodyId.empty()) return out;  // an EntityRef with no body cannot resolve

  const EntityKind filter = request.filter;
  const bool wantFace = filter == EntityKind::Any || filter == EntityKind::Face;
  const bool wantEdge = filter == EntityKind::Any || filter == EntityKind::Edge;
  const bool wantVertex = filter == EntityKind::Any || filter == EntityKind::Vertex;
  const bool wantBody = filter == EntityKind::Body;
  if (!wantFace && !wantEdge && !wantVertex && !wantBody) return out;

  // The surface hit is computed FIRST even when the filter excludes faces,
  // because it is the depth reference the edge and vertex snaps are tested
  // against. Without it an edge on the far side of the part snaps in front of
  // the face the user is pointing at.
  FacePick face;
  if (scene.accelerator != nullptr && scene.accelerator->built()) {
    face = scene.accelerator->pick(*scene.mesh, request.origin, request.direction);
  } else {
    face = pickFaceLinear(*scene.mesh, request.origin, request.direction);
  }

  if (wantBody) {
    if (!face.hit()) return out;
    out.faceId = face.faceId;
    out.distance = face.distance;
    for (int a = 0; a < 3; ++a) out.point[a] = face.point[a];
    out.ref.bodyId = scene.bodyId;
    out.ref.kind = EntityKind::Body;
    // A whole-body reference carries no persistent topology name: there is no
    // sub-entity to name, and EntityRef::valid() asks only for a body id and a
    // kind. Types.hpp says exactly this — "empty only for whole-body references".
    out.ref.persistentName.clear();
    return out;
  }

  const double tol = request.pixelTolerance * request.worldPerPixel;
  // How much further than the surface a snap may sit and still count as "on"
  // it: one tolerance radius, so a vertex on the silhouette of a curved face is
  // still reachable while one on the back of the part is not.
  const double depthSlack = tol;
  const double surfaceT = face.hit() ? face.distance : std::numeric_limits<double>::infinity();

  if (wantVertex && scene.vertices != nullptr && !scene.vertices->vertices.empty()) {
    const VertexPick v = pickVertex(*scene.vertices, request.origin, request.direction, tol);
    if (v.hit() && v.along <= surfaceT + depthSlack) {
      const MeshVertex& mv = scene.vertices->vertices[v.index];
      out.vertexIndex = v.index;
      out.distance = v.along;
      for (int a = 0; a < 3; ++a) out.point[a] = mv.p[a];
      out.ref.bodyId = scene.bodyId;
      out.ref.kind = EntityKind::Vertex;
      out.ref.persistentName = mv.key();
      return out;
    }
  }

  if (wantEdge && scene.edges != nullptr && !scene.edges->edges.empty()) {
    const EdgePick e = pickEdge(*scene.edges, request.origin, request.direction, tol);
    if (e.hit() && e.along <= surfaceT + depthSlack) {
      out.edgeIndex = e.index;
      out.distance = e.along;
      for (int a = 0; a < 3; ++a) {
        out.point[a] = request.origin[a] + e.along * request.direction[a];
      }
      out.ref.bodyId = scene.bodyId;
      out.ref.kind = EntityKind::Edge;
      out.ref.persistentName = scene.edges->edges[e.index].key();
      return out;
    }
  }

  if (wantFace && face.hit()) return faceAnswer(scene, face);
  return out;
}

}  // namespace forge::ui
