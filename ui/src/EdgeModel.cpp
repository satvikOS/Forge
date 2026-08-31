#include "forge/ui/EdgeModel.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace forge::ui {
namespace {

using WeldKey = std::array<long long, 3>;

// The SAME quantum MeasureModel welds on. Written as a call into the same
// constant rather than a second literal: two weld tolerances for one mesh is how
// the edge model and the measure model would come to disagree about whether two
// triangles touch.
WeldKey weld(const double p[3]) noexcept {
  return WeldKey{std::llround(p[0] / kMeasureWeldTolerance),
                 std::llround(p[1] / kMeasureWeldTolerance),
                 std::llround(p[2] / kMeasureWeldTolerance)};
}

// One undirected mesh segment, keyed by its two WELDED vertex ids.
using SegKey = std::pair<int, int>;

struct SegRecord {
  int uses = 0;
  std::uint32_t faceA = 0;  // first face id seen
  std::uint32_t faceB = 0;  // second DISTINCT face id seen, 0 while none
  double a[3] = {0.0, 0.0, 0.0};
  double b[3] = {0.0, 0.0, 0.0};
};

double distance3(const double p[3], const double q[3]) noexcept {
  const double dx = p[0] - q[0];
  const double dy = p[1] - q[1];
  const double dz = p[2] - q[2];
  return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// Union-find over welded vertex ids, used ONLY within one face pair, so a
// vertex shared by two different face pairs cannot merge their components.
class DisjointSet {
 public:
  int find(int x) {
    const auto it = parent_.find(x);
    if (it == parent_.end()) {
      parent_[x] = x;
      return x;
    }
    if (it->second == x) return x;
    const int root = find(it->second);
    it->second = root;
    return root;
  }
  void unite(int x, int y) {
    const int rx = find(x);
    const int ry = find(y);
    if (rx != ry) parent_[rx] = ry;
  }

 private:
  std::map<int, int> parent_;
};

// Shortest distance between a ray (origin + t*dir, t >= 0) and a segment [p,q].
// `outAlong` receives the ray parameter of the closest point. Handles the
// parallel case, which is not rare here: a user sights straight down an edge.
double rayToSegment(const double origin[3], const double dir[3], const double p[3],
                    const double q[3], double& outAlong) noexcept {
  const double u[3] = {dir[0], dir[1], dir[2]};
  const double v[3] = {q[0] - p[0], q[1] - p[1], q[2] - p[2]};
  const double w[3] = {origin[0] - p[0], origin[1] - p[1], origin[2] - p[2]};
  const double a = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const double b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const double c = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const double d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const double e = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  const double denom = a * c - b * b;

  double s = 0.0;  // along the ray
  double t = 0.0;  // along the segment, clamped to [0,1]
  if (denom > 1e-12) {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  } else {
    // Parallel: fix the segment parameter at its start and solve for the ray.
    t = 0.0;
    s = a > 1e-12 ? -d / a : 0.0;
  }
  t = std::min(1.0, std::max(0.0, t));
  // Re-solve the ray for the clamped segment point, then clamp the ray to t>=0.
  s = a > 1e-12 ? (b * t - d) / a : 0.0;
  if (s < 0.0) s = 0.0;
  outAlong = s;

  const double cp[3] = {origin[0] + s * u[0], origin[1] + s * u[1], origin[2] + s * u[2]};
  const double cq[3] = {p[0] + t * v[0], p[1] + t * v[1], p[2] + t * v[2]};
  return distance3(cp, cq);
}

}  // namespace

std::string MeshEdge::key() const {
  return "edge@" + std::to_string(faceA) + "_" + std::to_string(faceB) + "#" +
         std::to_string(component);
}

std::size_t EdgeSet::indexOf(const std::string& name) const {
  for (std::size_t i = 0; i < edges.size(); ++i) {
    if (edges[i].key() == name) return i;
  }
  return kNoEdge;
}

EdgeSet deriveEdges(const MeasureMesh& mesh) {
  EdgeSet out;
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& faces = mesh.faceIds();
  if (faces.empty()) return out;

  // ── 1. weld every vertex, then census every undirected segment ───────────
  std::map<WeldKey, int> vertexIds;
  std::map<SegKey, SegRecord> segments;
  for (std::size_t tri = 0; tri < faces.size(); ++tri) {
    const double* t = &xyz[tri * 9];
    int id[3];
    for (std::size_t k = 0; k < 3; ++k) {
      const WeldKey wk = weld(t + k * 3);
      const auto ins = vertexIds.emplace(wk, static_cast<int>(vertexIds.size()));
      id[k] = ins.first->second;
    }
    for (std::size_t k = 0; k < 3; ++k) {
      const std::size_t k2 = (k + 1) % 3;
      if (id[k] == id[k2]) continue;  // a degenerate triangle contributes no segment
      const SegKey sk = id[k] < id[k2] ? SegKey{id[k], id[k2]} : SegKey{id[k2], id[k]};
      SegRecord& rec = segments[sk];
      if (rec.uses == 0) {
        for (std::size_t c = 0; c < 3; ++c) {
          rec.a[c] = t[k * 3 + c];
          rec.b[c] = t[k2 * 3 + c];
        }
        rec.faceA = faces[tri];
      } else if (rec.faceB == 0 && faces[tri] != rec.faceA) {
        rec.faceB = faces[tri];
      }
      ++rec.uses;
    }
  }

  // ── 2. partition the census, and keep the face-boundary segments ─────────
  struct Kept {
    SegKey key;
    const SegRecord* rec;
  };
  std::map<std::pair<std::uint32_t, std::uint32_t>, std::vector<Kept>> byPair;
  for (const auto& kv : segments) {
    const SegRecord& rec = kv.second;
    if (rec.uses == 1) {
      ++out.boundarySegments;
      continue;
    }
    if (rec.uses > 2) {
      ++out.nonManifoldSegments;
      continue;
    }
    if (rec.faceB == 0) {  // used twice by ONE face: a tessellation interior segment
      ++out.interiorSegments;
      continue;
    }
    ++out.faceBoundarySegments;
    const std::uint32_t lo = std::min(rec.faceA, rec.faceB);
    const std::uint32_t hi = std::max(rec.faceA, rec.faceB);
    byPair[{lo, hi}].push_back(Kept{kv.first, &rec});
  }

  // ── 3. split each face pair into connected components ───────────────────
  for (const auto& pair : byPair) {
    DisjointSet ds;
    for (const Kept& k : pair.second) ds.unite(k.key.first, k.key.second);

    // Component ordering is by the SMALLEST welded vertex id the component
    // holds, so it does not depend on iteration order of anything hashed.
    std::map<int, std::vector<const Kept*>> comps;
    for (const Kept& k : pair.second) comps[ds.find(k.key.first)].push_back(&k);

    std::vector<std::pair<int, const std::vector<const Kept*>*>> ordered;
    ordered.reserve(comps.size());
    for (const auto& c : comps) {
      int lowest = c.second.front()->key.first;
      for (const Kept* k : c.second) {
        lowest = std::min(lowest, std::min(k->key.first, k->key.second));
      }
      ordered.push_back({lowest, &c.second});
    }
    std::sort(ordered.begin(), ordered.end(),
              [](const auto& a, const auto& b) { return a.first < b.first; });

    std::uint32_t component = 0;
    for (const auto& c : ordered) {
      MeshEdge edge;
      edge.faceA = pair.first.first;
      edge.faceB = pair.first.second;
      edge.component = component++;
      std::map<int, int> degree;
      // `comps` is a std::map keyed by the segment's welded ids, so this list is
      // already in a deterministic order; sorting again would only re-state it.
      for (const Kept* k : *c.second) {
        ++edge.segments;
        edge.length += distance3(k->rec->a, k->rec->b);
        edge.box.grow(k->rec->a);
        edge.box.grow(k->rec->b);
        for (std::size_t i = 0; i < 3; ++i) edge.points.push_back(k->rec->a[i]);
        for (std::size_t i = 0; i < 3; ++i) edge.points.push_back(k->rec->b[i]);
        ++degree[k->key.first];
        ++degree[k->key.second];
      }
      edge.closed = true;
      for (const auto& d : degree) {
        if (d.second != 2) edge.closed = false;
      }
      out.edges.push_back(std::move(edge));
    }
  }
  return out;
}

EdgePick pickEdge(const EdgeSet& set, const double origin[3], const double direction[3],
                  double maxDistance) {
  EdgePick best;
  double bestDistance = maxDistance;
  for (std::size_t i = 0; i < set.edges.size(); ++i) {
    const MeshEdge& e = set.edges[i];
    for (std::size_t s = 0; s + 5 < e.points.size(); s += 6) {
      double along = 0.0;
      const double d = rayToSegment(origin, direction, &e.points[s], &e.points[s + 3], along);
      if (d > bestDistance) continue;
      // A strictly closer segment wins; an equally close one wins only if it is
      // nearer along the ray, so the answer does not depend on edge order.
      if (d < bestDistance || !best.hit() || along < best.along) {
        bestDistance = d;
        best.index = i;
        best.distance = d;
        best.along = along;
      }
    }
  }
  return best;
}

EdgeMeasure measureEdges(const EdgeSet& set, const std::vector<std::size_t>& indices) {
  EdgeMeasure m;
  std::vector<double> centres;
  for (std::size_t idx : indices) {
    if (idx >= set.edges.size()) continue;
    const MeshEdge& e = set.edges[idx];
    ++m.edges;
    m.segments += e.segments;
    m.length += e.length;
    if (e.box.valid) {
      m.box.grow(e.box.min);
      m.box.grow(e.box.max);
      double c[3];
      e.box.centre(c);
      centres.insert(centres.end(), c, c + 3);
    }
  }
  if (m.edges == 2 && centres.size() == 6) {
    m.hasPair = true;
    m.centreDistance = distance3(&centres[0], &centres[3]);
  }
  return m;
}

}  // namespace forge::ui
