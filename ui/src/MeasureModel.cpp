#include "forge/ui/MeasureModel.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <utility>
#include <vector>

namespace forge::ui {
namespace {

using WeldKey = std::array<long long, 3>;

WeldKey weld(const double p[3]) noexcept {
  return WeldKey{std::llround(p[0] / kMeasureWeldTolerance),
                 std::llround(p[1] / kMeasureWeldTolerance),
                 std::llround(p[2] / kMeasureWeldTolerance)};
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

double dot(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

double norm(const double a[3]) noexcept { return std::sqrt(dot(a, a)); }

// Unit-normalizes in place; returns false (and leaves the vector alone) when the
// length is too small to give a direction, which is what a degenerate triangle
// or a face whose normals cancel produces.
bool normalize(double v[3]) noexcept {
  const double n = norm(v);
  if (!(n > 1e-12)) return false;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
  return true;
}

// Twice the area-weighted normal of one triangle, i.e. (b-a) x (c-a).
void triangleCrossProduct(const double* t, double out[3]) noexcept {
  double e1[3], e2[3];
  sub(t + 3, t, e1);
  sub(t + 6, t, e2);
  cross(e1, e2, out);
}

constexpr double kDegPerRad = 57.29577951308232;

}  // namespace

// ── MeasureBox ──────────────────────────────────────────────────────────────
double MeasureBox::size(std::size_t axis) const noexcept {
  if (!valid || axis > 2) return 0.0;
  return max[axis] - min[axis];
}

double MeasureBox::diagonal() const noexcept {
  if (!valid) return 0.0;
  const double dx = max[0] - min[0];
  const double dy = max[1] - min[1];
  const double dz = max[2] - min[2];
  return std::sqrt(dx * dx + dy * dy + dz * dz);
}

void MeasureBox::centre(double out[3]) const noexcept {
  for (std::size_t i = 0; i < 3; ++i) out[i] = valid ? 0.5 * (min[i] + max[i]) : 0.0;
}

void MeasureBox::grow(const double p[3]) noexcept {
  if (!valid) {
    for (std::size_t i = 0; i < 3; ++i) {
      min[i] = p[i];
      max[i] = p[i];
    }
    valid = true;
    return;
  }
  for (std::size_t i = 0; i < 3; ++i) {
    min[i] = std::min(min[i], p[i]);
    max[i] = std::max(max[i], p[i]);
  }
}

// ── MeasureMesh ─────────────────────────────────────────────────────────────
void MeasureMesh::addTriangle(const double a[3], const double b[3], const double c[3],
                              std::uint32_t faceId) {
  for (std::size_t i = 0; i < 3; ++i) xyz_.push_back(a[i]);
  for (std::size_t i = 0; i < 3; ++i) xyz_.push_back(b[i]);
  for (std::size_t i = 0; i < 3; ++i) xyz_.push_back(c[i]);
  faceIds_.push_back(faceId);
}

void MeasureMesh::clear() noexcept {
  xyz_.clear();
  faceIds_.clear();
}

std::vector<std::uint32_t> MeasureMesh::faces() const {
  std::vector<std::uint32_t> ids(faceIds_);
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
  return ids;
}

// ── whole-mesh measurement ──────────────────────────────────────────────────
MeshMeasure measureMesh(const MeasureMesh& mesh) {
  MeshMeasure m;
  m.triangles = mesh.triangleCount();
  m.faces = mesh.faces().size();
  if (m.triangles == 0) return m;

  const std::vector<double>& xyz = mesh.coords();

  // forward count, backward count, per undirected (welded) edge.
  std::map<std::pair<WeldKey, WeldKey>, std::pair<std::size_t, std::size_t>> edges;

  double signedVolume = 0.0;
  double volumeCentroid[3] = {0.0, 0.0, 0.0};
  double areaCentroid[3] = {0.0, 0.0, 0.0};

  for (std::size_t t = 0; t < m.triangles; ++t) {
    const double* p = &xyz[t * 9];
    for (std::size_t v = 0; v < 3; ++v) m.box.grow(p + v * 3);

    double n[3];
    triangleCrossProduct(p, n);
    const double area = 0.5 * norm(n);
    m.area += area;
    for (std::size_t i = 0; i < 3; ++i) {
      areaCentroid[i] += area * (p[i] + p[3 + i] + p[6 + i]) / 3.0;
    }

    // Signed tetrahedron on the origin: p0 . (p1 x p2) / 6.
    double c12[3];
    cross(p + 3, p + 6, c12);
    const double vt = dot(p, c12) / 6.0;
    signedVolume += vt;
    for (std::size_t i = 0; i < 3; ++i) {
      volumeCentroid[i] += vt * (p[i] + p[3 + i] + p[6 + i]) / 4.0;
    }

    const WeldKey k[3] = {weld(p), weld(p + 3), weld(p + 6)};
    for (std::size_t e = 0; e < 3; ++e) {
      const WeldKey& a = k[e];
      const WeldKey& b = k[(e + 1) % 3];
      if (a == b) continue;  // a collapsed edge is not a topological edge
      if (a < b) {
        ++edges[{a, b}].first;
      } else {
        ++edges[{b, a}].second;
      }
    }
  }

  for (const auto& [key, counts] : edges) {
    (void)key;
    const std::size_t total = counts.first + counts.second;
    if (total == 1) {
      ++m.boundaryEdges;
    } else if (total > 2) {
      ++m.nonManifoldEdges;
    } else if (counts.first != 1 || counts.second != 1) {
      ++m.reversedEdges;  // used twice, but both times the same way round
    }
  }

  m.watertight = m.boundaryEdges == 0 && m.nonManifoldEdges == 0 && m.reversedEdges == 0;

  if (m.watertight) {
    m.volume = std::fabs(signedVolume);
    m.outward = signedVolume > 0.0;
    if (std::fabs(signedVolume) > 1e-12) {
      for (std::size_t i = 0; i < 3; ++i) m.centroid[i] = volumeCentroid[i] / signedVolume;
    }
  } else if (m.area > 1e-12) {
    for (std::size_t i = 0; i < 3; ++i) m.centroid[i] = areaCentroid[i] / m.area;
  }
  return m;
}

// ── per-face measurement ────────────────────────────────────────────────────
bool measureFace(const MeasureMesh& mesh, std::uint32_t faceId, FaceMeasure& out) {
  out = FaceMeasure{};
  out.faceId = faceId;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();

  double accumNormal[3] = {0.0, 0.0, 0.0};
  double accumCentroid[3] = {0.0, 0.0, 0.0};
  for (std::size_t t = 0; t < ids.size(); ++t) {
    if (ids[t] != faceId) continue;
    ++out.triangles;
    const double* p = &xyz[t * 9];
    for (std::size_t v = 0; v < 3; ++v) out.box.grow(p + v * 3);

    double n[3];
    triangleCrossProduct(p, n);
    const double area = 0.5 * norm(n);
    out.area += area;
    for (std::size_t i = 0; i < 3; ++i) {
      accumNormal[i] += 0.5 * n[i];
      accumCentroid[i] += area * (p[i] + p[3 + i] + p[6 + i]) / 3.0;
    }
  }
  if (out.triangles == 0) return false;

  if (out.area > 1e-12) {
    for (std::size_t i = 0; i < 3; ++i) out.centroid[i] = accumCentroid[i] / out.area;
  }
  for (std::size_t i = 0; i < 3; ++i) out.normal[i] = accumNormal[i];
  if (!normalize(out.normal)) {
    out.normal[0] = out.normal[1] = out.normal[2] = 0.0;
    return true;  // measurable area, no single direction — reported honestly
  }

  // Planarity: every contributing triangle must point the same way as the whole.
  const double limit = std::cos(kMeasureAngleTolerance / kDegPerRad);
  out.planar = true;
  for (std::size_t t = 0; t < ids.size(); ++t) {
    if (ids[t] != faceId) continue;
    double n[3];
    triangleCrossProduct(&xyz[t * 9], n);
    if (!normalize(n)) continue;  // degenerate sliver carries no direction
    if (dot(n, out.normal) < limit) {
      out.planar = false;
      break;
    }
  }
  return true;
}

// ── selection measurement ───────────────────────────────────────────────────
SelectionMeasure measureFaces(const MeasureMesh& mesh,
                              const std::vector<std::uint32_t>& faceIds) {
  SelectionMeasure s;

  std::vector<std::uint32_t> unique(faceIds);
  std::sort(unique.begin(), unique.end());
  unique.erase(std::unique(unique.begin(), unique.end()), unique.end());

  double accumCentroid[3] = {0.0, 0.0, 0.0};
  std::vector<FaceMeasure> measured;
  for (std::uint32_t id : unique) {
    FaceMeasure f;
    if (!measureFace(mesh, id, f)) continue;
    ++s.faces;
    s.triangles += f.triangles;
    s.area += f.area;
    for (std::size_t i = 0; i < 3; ++i) {
      accumCentroid[i] += f.area * f.centroid[i];
    }
    if (f.box.valid) {
      s.box.grow(f.box.min);
      s.box.grow(f.box.max);
    }
    measured.push_back(f);
  }
  if (s.area > 1e-12) {
    for (std::size_t i = 0; i < 3; ++i) s.centroid[i] = accumCentroid[i] / s.area;
  }

  if (measured.size() == 2) {
    s.hasPair = true;
    double d[3];
    sub(measured[1].centroid, measured[0].centroid, d);
    s.centreDistance = norm(d);
    const double na = norm(measured[0].normal);
    const double nb = norm(measured[1].normal);
    if (na > 0.5 && nb > 0.5) {  // both are unit vectors when they exist at all
      const double c = std::clamp(dot(measured[0].normal, measured[1].normal), -1.0, 1.0);
      s.angleDegrees = std::acos(c) * kDegPerRad;
      s.parallel = s.angleDegrees < kMeasureAngleTolerance ||
                   s.angleDegrees > 180.0 - kMeasureAngleTolerance;
      s.perpendicular = std::fabs(s.angleDegrees - 90.0) < kMeasureAngleTolerance;
    }
  }
  return s;
}

}  // namespace forge::ui
