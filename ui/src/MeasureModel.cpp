#include "forge/ui/MeasureModel.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
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

    // THE distance, as distinct from the distance between centroids. Two faces
    // of an L-bracket have centroids far apart and surfaces that meet at the
    // corner; a Measure tool that only reported the first would answer a
    // question nobody asked. Both are kept, named apart.
    const ClearanceMeasure c =
        measureClearance(mesh, {measured[0].faceId}, {measured[1].faceId});
    if (c.measured) {
      s.hasMinDistance = true;
      s.minDistance = c.distance;
      s.touching = c.touching;
      for (std::size_t i = 0; i < 3; ++i) {
        s.minPointA[i] = c.pointA[i];
        s.minPointB[i] = c.pointB[i];
      }
    }
  }
  return s;
}


// ── the geometric primitives ────────────────────────────────────────────────
double pointSegmentDistance(const double p[3], const double a[3], const double b[3],
                            double closest[3]) {
  double ab[3], ap[3];
  sub(b, a, ab);
  sub(p, a, ap);
  const double denom = dot(ab, ab);
  // A degenerate segment is a POINT. Dividing by its zero length would give a
  // NaN distance that compares false against every bound, which reads to a
  // caller as "no clearance problem" — the most dangerous possible answer.
  double t = denom > 1e-24 ? dot(ap, ab) / denom : 0.0;
  t = std::clamp(t, 0.0, 1.0);
  for (std::size_t i = 0; i < 3; ++i) closest[i] = a[i] + t * ab[i];
  double d[3];
  sub(p, closest, d);
  return norm(d);
}

double segmentSegmentDistance(const double a0[3], const double a1[3], const double b0[3],
                              const double b1[3], double closestA[3], double closestB[3]) {
  double u[3], v[3], w[3];
  sub(a1, a0, u);
  sub(b1, b0, v);
  sub(a0, b0, w);
  const double a = dot(u, u);
  const double b = dot(u, v);
  const double c = dot(v, v);
  const double d = dot(u, w);
  const double e = dot(v, w);
  const double denom = a * c - b * b;

  double sc = 0.0;
  double tc = 0.0;
  // PARALLEL (or a degenerate segment): the shared perpendicular is not unique,
  // so the closed form divides by zero. Two parallel edges of a plate are an
  // ordinary input here, not an exotic one, so this branch is the common case
  // and not an afterthought: pin one segment's start and clamp on the other.
  if (denom < 1e-18 * std::max(1.0, a * c)) {
    sc = 0.0;
    tc = (c > 1e-24) ? (e / c) : 0.0;
  } else {
    sc = (b * e - c * d) / denom;
    tc = (a * e - b * d) / denom;
  }
  sc = std::clamp(sc, 0.0, 1.0);
  tc = std::clamp(tc, 0.0, 1.0);

  // One clamp can move the other's optimum, so re-solve each against the
  // clamped partner. Two passes are enough for segments: after re-solving both,
  // a further pass cannot move either (the objective is convex and each
  // coordinate is already optimal for the other's final value).
  double pa[3], pb[3];
  for (std::size_t i = 0; i < 3; ++i) pa[i] = a0[i] + sc * u[i];
  tc = (c > 1e-24) ? std::clamp((dot(pa, v) - dot(b0, v)) / c, 0.0, 1.0) : 0.0;
  for (std::size_t i = 0; i < 3; ++i) pb[i] = b0[i] + tc * v[i];
  sc = (a > 1e-24) ? std::clamp((dot(pb, u) - dot(a0, u)) / a, 0.0, 1.0) : 0.0;
  for (std::size_t i = 0; i < 3; ++i) pa[i] = a0[i] + sc * u[i];

  for (std::size_t i = 0; i < 3; ++i) {
    closestA[i] = pa[i];
    closestB[i] = pb[i];
  }
  double diff[3];
  sub(pa, pb, diff);
  return norm(diff);
}

double pointTriangleDistance(const double p[3], const double a[3], const double b[3],
                             const double c[3], double closest[3]) {
  // Ericson, *Real-Time Collision Detection* (2005), 5.1.5 — the barycentric
  // REGION method. A plane projection plus a "clamp into the triangle" is wrong
  // in the three vertex regions, and those regions are exactly where a sharp
  // corner of one part approaches the face of another, which is the case a
  // clearance check exists for.
  double ab[3], ac[3], ap[3];
  sub(b, a, ab);
  sub(c, a, ac);
  sub(p, a, ap);
  const double d1 = dot(ab, ap);
  const double d2 = dot(ac, ap);
  const auto take = [&closest](const double q[3]) {
    for (std::size_t i = 0; i < 3; ++i) closest[i] = q[i];
  };
  const auto finish = [&p, &closest]() {
    double d[3];
    sub(p, closest, d);
    return norm(d);
  };
  if (d1 <= 0.0 && d2 <= 0.0) {  // vertex region A
    take(a);
    return finish();
  }
  double bp[3];
  sub(p, b, bp);
  const double d3 = dot(ab, bp);
  const double d4 = dot(ac, bp);
  if (d3 >= 0.0 && d4 <= d3) {  // vertex region B
    take(b);
    return finish();
  }
  const double vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {  // edge region AB
    const double denom = d1 - d3;
    const double t = denom != 0.0 ? d1 / denom : 0.0;
    for (std::size_t i = 0; i < 3; ++i) closest[i] = a[i] + t * ab[i];
    return finish();
  }
  double cp[3];
  sub(p, c, cp);
  const double d5 = dot(ab, cp);
  const double d6 = dot(ac, cp);
  if (d6 >= 0.0 && d5 <= d6) {  // vertex region C
    take(c);
    return finish();
  }
  const double vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {  // edge region AC
    const double denom = d2 - d6;
    const double t = denom != 0.0 ? d2 / denom : 0.0;
    for (std::size_t i = 0; i < 3; ++i) closest[i] = a[i] + t * ac[i];
    return finish();
  }
  const double va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {  // edge region BC
    const double denom = (d4 - d3) + (d5 - d6);
    const double t = denom != 0.0 ? (d4 - d3) / denom : 0.0;
    for (std::size_t i = 0; i < 3; ++i) closest[i] = b[i] + t * (c[i] - b[i]);
    return finish();
  }
  const double denom = va + vb + vc;
  if (!(std::fabs(denom) > 1e-24)) {  // degenerate triangle: fall back to its edges
    double q[3];
    double best = pointSegmentDistance(p, a, b, closest);
    double d = pointSegmentDistance(p, b, c, q);
    if (d < best) { best = d; take(q); }
    d = pointSegmentDistance(p, c, a, q);
    if (d < best) { best = d; take(q); }
    return best;
  }
  const double v = vb / denom;
  const double w = vc / denom;
  for (std::size_t i = 0; i < 3; ++i) closest[i] = a[i] + ab[i] * v + ac[i] * w;
  return finish();
}

bool pointFaceDistance(const MeasureMesh& mesh, std::uint32_t faceId, const double p[3],
                       double& distance, double closest[3]) {
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  bool found = false;
  double best = 0.0;
  double bestPoint[3] = {0.0, 0.0, 0.0};
  for (std::size_t t = 0; t < ids.size(); ++t) {
    if (ids[t] != faceId) continue;
    const double* q = &xyz[t * 9];
    double hit[3];
    const double d = pointTriangleDistance(p, q, q + 3, q + 6, hit);
    if (!found || d < best) {
      found = true;
      best = d;
      for (std::size_t i = 0; i < 3; ++i) bestPoint[i] = hit[i];
    }
  }
  if (!found) return false;
  distance = best;
  for (std::size_t i = 0; i < 3; ++i) closest[i] = bestPoint[i];
  return true;
}

// ── clearance ───────────────────────────────────────────────────────────────
namespace {

// Minimum distance between two triangles, as the minimum over the six
// point-triangle queries. That is EXACT when the closest feature involves a
// vertex or an interior point of a face, and an UPPER BOUND when it is
// edge-to-edge on two skew triangles — so the nine edge-pair queries are done
// too. Six + nine is the whole feature set of a triangle pair; nothing is
// approximated.
double triangleTriangleDistance(const double* A, const double* B, double outA[3],
                                double outB[3]) {
  double best = -1.0;
  double bestA[3] = {0.0, 0.0, 0.0};
  double bestB[3] = {0.0, 0.0, 0.0};
  const auto consider = [&best, &bestA, &bestB](double d, const double pa[3],
                                                const double pb[3]) {
    if (best >= 0.0 && d >= best) return;
    best = d;
    for (std::size_t i = 0; i < 3; ++i) {
      bestA[i] = pa[i];
      bestB[i] = pb[i];
    }
  };
  double hit[3];
  for (std::size_t v = 0; v < 3; ++v) {
    const double d = pointTriangleDistance(A + v * 3, B, B + 3, B + 6, hit);
    consider(d, A + v * 3, hit);
  }
  for (std::size_t v = 0; v < 3; ++v) {
    const double d = pointTriangleDistance(B + v * 3, A, A + 3, A + 6, hit);
    consider(d, hit, B + v * 3);
  }
  for (std::size_t i = 0; i < 3; ++i) {
    for (std::size_t j = 0; j < 3; ++j) {
      double pa[3], pb[3];
      const double d = segmentSegmentDistance(A + i * 3, A + ((i + 1) % 3) * 3, B + j * 3,
                                              B + ((j + 1) % 3) * 3, pa, pb);
      consider(d, pa, pb);
    }
  }
  for (std::size_t i = 0; i < 3; ++i) {
    outA[i] = bestA[i];
    outB[i] = bestB[i];
  }
  return best < 0.0 ? 0.0 : best;
}

std::vector<std::size_t> trianglesOfGroup(const MeasureMesh& mesh,
                                          const std::vector<std::uint32_t>& group) {
  std::vector<std::size_t> out;
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  for (std::size_t t = 0; t < ids.size(); ++t) {
    for (std::uint32_t id : group) {
      if (ids[t] == id) {
        out.push_back(t);
        break;
      }
    }
  }
  return out;
}

}  // namespace

ClearanceMeasure measureClearance(const MeasureMesh& mesh,
                                  const std::vector<std::uint32_t>& groupA,
                                  const std::vector<std::uint32_t>& groupB,
                                  double touchTolerance) {
  ClearanceMeasure out;
  const std::vector<std::size_t> ta = trianglesOfGroup(mesh, groupA);
  const std::vector<std::size_t> tb = trianglesOfGroup(mesh, groupB);
  out.trianglesA = ta.size();
  out.trianglesB = tb.size();
  if (ta.empty() || tb.empty()) return out;  // measured stays false: nothing to compare

  const std::vector<double>& xyz = mesh.coords();
  double best = -1.0;
  for (std::size_t i : ta) {
    for (std::size_t j : tb) {
      double pa[3], pb[3];
      const double d = triangleTriangleDistance(&xyz[i * 9], &xyz[j * 9], pa, pb);
      ++out.pairsTested;
      if (best < 0.0 || d < best) {
        best = d;
        for (std::size_t k = 0; k < 3; ++k) {
          out.pointA[k] = pa[k];
          out.pointB[k] = pb[k];
        }
      }
      // An exact touch cannot be beaten, and a 430-face part squared is a lot of
      // pairs. Stopping is a measurement, not a shortcut: 0 IS the minimum.
      if (best <= 0.0) break;
    }
    if (best <= 0.0) break;
  }
  out.measured = true;
  out.distance = best < 0.0 ? 0.0 : best;
  out.touching = out.distance <= touchTolerance;
  return out;
}

// ── circle / arc fit ────────────────────────────────────────────────────────
namespace {

// Smallest-eigenvalue eigenvector of a symmetric 3x3, by inverse iteration on
// (M - lambda I). `eigenvalues` must be ascending.
void symmetricEigenvalues(const double m[9], double out[3]) {
  // Smith (1961), the closed form for a symmetric 3x3. Iterative methods are
  // overkill for a fixed 3x3 and introduce a convergence question a gate would
  // then have to answer.
  const double p1 = m[1] * m[1] + m[2] * m[2] + m[5] * m[5];
  const double tr = m[0] + m[4] + m[8];
  if (p1 <= 1e-30 * std::max(1.0, tr * tr)) {  // already diagonal
    double d[3] = {m[0], m[4], m[8]};
    std::sort(d, d + 3);
    out[0] = d[0];
    out[1] = d[1];
    out[2] = d[2];
    return;
  }
  const double q = tr / 3.0;
  const double p2 = (m[0] - q) * (m[0] - q) + (m[4] - q) * (m[4] - q) +
                    (m[8] - q) * (m[8] - q) + 2.0 * p1;
  const double p = std::sqrt(p2 / 6.0);
  double b[9];
  for (std::size_t i = 0; i < 9; ++i) b[i] = m[i];
  b[0] -= q;
  b[4] -= q;
  b[8] -= q;
  for (std::size_t i = 0; i < 9; ++i) b[i] /= (p > 1e-300 ? p : 1.0);
  const double detB = b[0] * (b[4] * b[8] - b[5] * b[7]) - b[1] * (b[3] * b[8] - b[5] * b[6]) +
                      b[2] * (b[3] * b[7] - b[4] * b[6]);
  const double r = std::clamp(detB / 2.0, -1.0, 1.0);
  const double phi = std::acos(r) / 3.0;
  const double e1 = q + 2.0 * p * std::cos(phi);
  const double e3 = q + 2.0 * p * std::cos(phi + 2.0 * 3.14159265358979323846 / 3.0);
  const double e2 = tr - e1 - e3;
  double d[3] = {e1, e2, e3};
  std::sort(d, d + 3);
  out[0] = d[0];
  out[1] = d[1];
  out[2] = d[2];
}

// Null-space direction of (M - lambda I) for a symmetric M, by taking the
// largest cross product of its rows — the standard, numerically safe choice.
bool eigenvectorFor(const double m[9], double lambda, double out[3]) {
  double a[9];
  for (std::size_t i = 0; i < 9; ++i) a[i] = m[i];
  a[0] -= lambda;
  a[4] -= lambda;
  a[8] -= lambda;
  const double* rows[3] = {a, a + 3, a + 6};
  double best[3] = {0.0, 0.0, 0.0};
  double bestLen = 0.0;
  for (std::size_t i = 0; i < 3; ++i) {
    for (std::size_t j = i + 1; j < 3; ++j) {
      double c[3];
      cross(rows[i], rows[j], c);
      const double len = norm(c);
      if (len > bestLen) {
        bestLen = len;
        for (std::size_t k = 0; k < 3; ++k) best[k] = c[k];
      }
    }
  }
  if (!(bestLen > 1e-18)) return false;
  for (std::size_t k = 0; k < 3; ++k) out[k] = best[k] / bestLen;
  return true;
}

}  // namespace

CircleFit fitCircle(const std::vector<double>& points) {
  CircleFit fit;
  const std::size_t n = points.size() / 3;
  fit.points = n;
  if (n < 3) return fit;

  double centroid[3] = {0.0, 0.0, 0.0};
  for (std::size_t i = 0; i < n; ++i) {
    for (std::size_t k = 0; k < 3; ++k) centroid[k] += points[i * 3 + k];
  }
  for (double& c : centroid) c /= static_cast<double>(n);

  double cov[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
  for (std::size_t i = 0; i < n; ++i) {
    const double d[3] = {points[i * 3] - centroid[0], points[i * 3 + 1] - centroid[1],
                         points[i * 3 + 2] - centroid[2]};
    for (std::size_t r = 0; r < 3; ++r) {
      for (std::size_t c = 0; c < 3; ++c) cov[r * 3 + c] += d[r] * d[c];
    }
  }
  double eig[3];
  symmetricEigenvalues(cov, eig);
  double normal[3];
  if (!eigenvectorFor(cov, eig[0], normal)) return fit;  // collinear: no plane

  // An in-plane basis. The larger cross product of the normal with a unit axis
  // avoids the near-parallel case, which would give a basis vector of length ~0.
  double t[3] = {1.0, 0.0, 0.0};
  if (std::fabs(normal[0]) > 0.9) {
    t[0] = 0.0;
    t[1] = 1.0;
  }
  double e1[3], e2[3];
  cross(normal, t, e1);
  if (!normalize(e1)) return fit;
  cross(normal, e1, e2);
  if (!normalize(e2)) return fit;

  // Kasa's algebraic fit in the plane: minimise sum (x^2+y^2 + Dx + Ey + F)^2,
  // which is linear in (D, E, F). Chosen over a geometric fit because it is
  // closed-form and this runs per frame on a hovered edge; its known bias
  // (toward smaller radii on a SHORT arc) is why `rms` is reported rather than
  // implied — a caller that needs a tight arc measurement can see the residual.
  double sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  std::vector<double> u(n), v(n), w(n);
  for (std::size_t i = 0; i < n; ++i) {
    const double d[3] = {points[i * 3] - centroid[0], points[i * 3 + 1] - centroid[1],
                         points[i * 3 + 2] - centroid[2]};
    u[i] = dot(d, e1);
    v[i] = dot(d, e2);
    w[i] = dot(d, normal);
    const double z = u[i] * u[i] + v[i] * v[i];
    sx += u[i];
    sy += v[i];
    sxx += u[i] * u[i];
    syy += v[i] * v[i];
    sxy += u[i] * v[i];
    sxz += u[i] * z;
    syz += v[i] * z;
    sz += z;
  }
  const double N = static_cast<double>(n);
  // Solve the 3x3 normal equations by Cramer's rule.
  const double a11 = sxx, a12 = sxy, a13 = sx;
  const double a21 = sxy, a22 = syy, a23 = sy;
  const double a31 = sx,  a32 = sy,  a33 = N;
  const double b1 = -sxz, b2 = -syz, b3 = -sz;
  const double det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) +
                     a13 * (a21 * a32 - a22 * a31);
  if (!(std::fabs(det) > 1e-18)) return fit;
  const double dD = b1 * (a22 * a33 - a23 * a32) - a12 * (b2 * a33 - a23 * b3) +
                    a13 * (b2 * a32 - a22 * b3);
  const double dE = a11 * (b2 * a33 - a23 * b3) - b1 * (a21 * a33 - a23 * a31) +
                    a13 * (a21 * b3 - b2 * a31);
  const double dF = a11 * (a22 * b3 - b2 * a32) - a12 * (a21 * b3 - b2 * a31) +
                    b1 * (a21 * a32 - a22 * a31);
  const double D = dD / det, E = dE / det, F = dF / det;
  const double cu = -D / 2.0, cv = -E / 2.0;
  const double r2 = cu * cu + cv * cv - F;
  if (!(r2 > 0.0)) return fit;
  const double radius = std::sqrt(r2);

  double sumSq = 0.0, planeSq = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    const double dr = std::hypot(u[i] - cu, v[i] - cv) - radius;
    sumSq += dr * dr;
    planeSq += w[i] * w[i];
  }
  fit.ok = true;
  fit.radius = radius;
  fit.rms = std::sqrt(sumSq / N);
  fit.planeRms = std::sqrt(planeSq / N);
  for (std::size_t k = 0; k < 3; ++k) {
    fit.centre[k] = centroid[k] + cu * e1[k] + cv * e2[k];
    fit.normal[k] = normal[k];
  }
  return fit;
}

double polylineLength(const std::vector<double>& points, bool closed) {
  const std::size_t n = points.size() / 3;
  if (n < 2) return 0.0;
  double total = 0.0;
  for (std::size_t i = 0; i + 1 < n; ++i) {
    double d[3];
    sub(&points[(i + 1) * 3], &points[i * 3], d);
    total += norm(d);
  }
  if (closed) {
    double d[3];
    sub(&points[0], &points[(n - 1) * 3], d);
    total += norm(d);
  }
  return total;
}

// ── mass properties ─────────────────────────────────────────────────────────
const std::vector<MaterialDensity>& materialDensities() {
  // g/cm3 at room temperature. Deliberately short: every entry is a number a
  // user can check against a handbook, and a long table nobody verified is a
  // liability. Sorted by name so the picker order is deterministic.
  static const std::vector<MaterialDensity> table = {
      {"ABS", 1.04},          {"Aluminium 6061", 2.70}, {"Brass", 8.50},
      {"Copper", 8.96},       {"Nylon", 1.14},          {"PLA", 1.24},
      {"Stainless 304", 8.00}, {"Steel", 7.85},         {"Titanium Ti-6Al-4V", 4.43},
  };
  return table;
}

double densityForMaterial(const std::string& name) {
  for (const MaterialDensity& m : materialDensities()) {
    if (name == m.name) return m.gramsPerCm3;
  }
  return 0.0;
}

MassMeasure measureMass(const MeasureMesh& mesh, double densityGramsPerCm3) {
  MassMeasure out;
  out.density = densityGramsPerCm3;
  const MeshMeasure m = measureMesh(mesh);
  out.surfaceArea = m.area;
  // No mass without a CLOSED surface, and this is the whole reason the
  // watertightness test exists: an open mesh's signed-tetrahedron sum is a
  // number, and it is meaningless. Reporting valid=false is the honest answer,
  // and it is what stops a wrong mass being printed beside a right area.
  if (!m.watertight) return out;

  out.valid = true;
  out.volume = m.volume;
  // mm3 * (g/cm3) / 1000 = g. The 1000 is (10 mm/cm)^3, and it is written once,
  // here, because a factor of 10^3 in a mass is the classic CAD units defect and
  // a gate pins it on a 100 mm steel cube: 1e6 mm3 * 7.85 / 1000 = 7850 g, which
  // is 7.85 kg for a 10 cm cube of steel — a figure a person can sanity-check.
  out.mass = out.volume * densityGramsPerCm3 / 1000.0;
  for (std::size_t i = 0; i < 3; ++i) out.centreOfMass[i] = m.centroid[i];

  // Blow & Binstock's covariance formulation: for the tetrahedron (0, a, b, c)
  // the second-moment covariance is det(A) * A * Ccanon * A^T with
  // Ccanon = (1/120) * [[2,1,1],[1,2,1],[1,1,2]] and A = [a b c] as columns.
  // Summing over the closed surface's triangles gives the solid's covariance
  // about the ORIGIN; the parallel-axis shift then moves it to the centroid.
  double cov[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
  double signedVolume = 0.0;
  const std::vector<double>& xyz = mesh.coords();
  const std::size_t tris = mesh.triangleCount();
  static const double kCanon[9] = {2.0 / 120.0, 1.0 / 120.0, 1.0 / 120.0,
                                   1.0 / 120.0, 2.0 / 120.0, 1.0 / 120.0,
                                   1.0 / 120.0, 1.0 / 120.0, 2.0 / 120.0};
  for (std::size_t t = 0; t < tris; ++t) {
    const double* p = &xyz[t * 9];
    // A = [a b c] as COLUMNS, so A[r][k] is component r of vertex k.
    double A[9];
    for (std::size_t r = 0; r < 3; ++r) {
      for (std::size_t k = 0; k < 3; ++k) A[r * 3 + k] = p[k * 3 + r];
    }
    const double det = A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) +
                       A[2] * (A[3] * A[7] - A[4] * A[6]);
    signedVolume += det / 6.0;
    // A * Ccanon * A^T
    double AC[9];
    for (std::size_t r = 0; r < 3; ++r) {
      for (std::size_t c = 0; c < 3; ++c) {
        double s = 0.0;
        for (std::size_t k = 0; k < 3; ++k) s += A[r * 3 + k] * kCanon[k * 3 + c];
        AC[r * 3 + c] = s;
      }
    }
    for (std::size_t r = 0; r < 3; ++r) {
      for (std::size_t c = 0; c < 3; ++c) {
        double s = 0.0;
        for (std::size_t k = 0; k < 3; ++k) s += AC[r * 3 + k] * A[c * 3 + k];  // A^T
        cov[r * 3 + c] += det * s;
      }
    }
  }
  // An inward-wound closed surface gives a negative signed volume and a negated
  // covariance. Flip both rather than reporting a negative moment of inertia,
  // which is not a thing a solid has.
  if (signedVolume < 0.0) {
    for (double& v : cov) v = -v;
    signedVolume = -signedVolume;
  }

  // Parallel-axis shift to the centre of mass: C_com = C - V * (com com^T).
  const double* com = out.centreOfMass;
  for (std::size_t r = 0; r < 3; ++r) {
    for (std::size_t c = 0; c < 3; ++c) cov[r * 3 + c] -= signedVolume * com[r] * com[c];
  }
  // I = trace(C) * Id - C, then scaled from volume to MASS units.
  const double trace = cov[0] + cov[4] + cov[8];
  const double scale = densityGramsPerCm3 / 1000.0;
  for (std::size_t r = 0; r < 3; ++r) {
    for (std::size_t c = 0; c < 3; ++c) {
      const double v = (r == c ? trace : 0.0) - cov[r * 3 + c];
      out.inertiaCom[r * 3 + c] = v * scale;
    }
  }
  symmetricEigenvalues(out.inertiaCom, out.principalMoments);
  for (std::size_t i = 0; i < 3; ++i) {
    out.radiiOfGyration[i] =
        out.mass > 1e-12 ? std::sqrt(std::max(0.0, out.principalMoments[i] / out.mass)) : 0.0;
  }
  return out;
}

// ── export ──────────────────────────────────────────────────────────────────
namespace {

std::string fmt(double v) {
  char buf[40];
  const int n = std::snprintf(buf, sizeof(buf), "%.6g", v);
  return n > 0 ? std::string(buf, static_cast<std::size_t>(n)) : std::string("0");
}

std::string vec3(const double v[3]) {
  return "(" + fmt(v[0]) + ", " + fmt(v[1]) + ", " + fmt(v[2]) + ")";
}

}  // namespace

std::string measureText(const MeshMeasure& m) {
  std::string out;
  out += "triangles      " + std::to_string(m.triangles) + "\n";
  out += "faces          " + std::to_string(m.faces) + "\n";
  out += "surface area   " + fmt(m.area) + " mm2\n";
  out += std::string("watertight     ") + (m.watertight ? "yes" : "NO") + "\n";
  if (m.watertight) {
    out += "volume         " + fmt(m.volume) + " mm3\n";
    out += std::string("winding        ") + (m.outward ? "outward" : "INWARD") + "\n";
    out += "centroid       " + vec3(m.centroid) + " mm\n";
  } else {
    // NOT a volume. An open mesh's number is meaningless, so the reason is
    // printed where the volume would have been.
    out += "boundary edges " + std::to_string(m.boundaryEdges) + "\n";
    out += "non-manifold   " + std::to_string(m.nonManifoldEdges) + "\n";
    out += "reversed       " + std::to_string(m.reversedEdges) + "\n";
    out += "area centroid  " + vec3(m.centroid) + " mm\n";
  }
  if (m.box.valid) {
    out += "bbox           " + fmt(m.box.size(0)) + " x " + fmt(m.box.size(1)) + " x " +
           fmt(m.box.size(2)) + " mm\n";
  }
  return out;
}

std::string measureText(const SelectionMeasure& s) {
  std::string out;
  out += "selected faces " + std::to_string(s.faces) + "\n";
  out += "triangles      " + std::to_string(s.triangles) + "\n";
  out += "area           " + fmt(s.area) + " mm2\n";
  out += "centroid       " + vec3(s.centroid) + " mm\n";
  if (s.box.valid) {
    out += "bbox           " + fmt(s.box.size(0)) + " x " + fmt(s.box.size(1)) + " x " +
           fmt(s.box.size(2)) + " mm\n";
  }
  if (s.hasPair) {
    out += "centre dist    " + fmt(s.centreDistance) + " mm\n";
    out += "angle          " + fmt(s.angleDegrees) + " deg";
    if (s.parallel) out += "  (parallel)";
    if (s.perpendicular) out += "  (perpendicular)";
    out += "\n";
  }
  if (s.hasMinDistance) {
    out += "min distance   " + fmt(s.minDistance) + " mm";
    if (s.touching) out += "  (touching)";
    out += "\n";
    out += "  at A         " + vec3(s.minPointA) + "\n";
    out += "  at B         " + vec3(s.minPointB) + "\n";
  }
  return out;
}

std::string measureText(const MassMeasure& m) {
  if (!m.valid) {
    return "mass properties unavailable — the mesh is not watertight, so it has no volume\n";
  }
  std::string out;
  out += "density        " + fmt(m.density) + " g/cm3\n";
  out += "volume         " + fmt(m.volume) + " mm3\n";
  out += "mass           " + fmt(m.mass) + " g\n";
  out += "surface area   " + fmt(m.surfaceArea) + " mm2\n";
  out += "centre of mass " + vec3(m.centreOfMass) + " mm\n";
  out += "inertia (com)  [" + fmt(m.inertiaCom[0]) + ", " + fmt(m.inertiaCom[1]) + ", " +
         fmt(m.inertiaCom[2]) + "; " + fmt(m.inertiaCom[3]) + ", " + fmt(m.inertiaCom[4]) + ", " +
         fmt(m.inertiaCom[5]) + "; " + fmt(m.inertiaCom[6]) + ", " + fmt(m.inertiaCom[7]) + ", " +
         fmt(m.inertiaCom[8]) + "] g*mm2\n";
  out += "principal      " + vec3(m.principalMoments) + " g*mm2\n";
  out += "gyration radii " + vec3(m.radiiOfGyration) + " mm\n";
  return out;
}

std::string measureText(const ClearanceMeasure& c) {
  if (!c.measured) return "clearance unavailable — one of the two groups has no triangles\n";
  std::string out;
  out += "clearance      " + fmt(c.distance) + " mm";
  if (c.touching) out += "  (TOUCHING / interfering)";
  out += "\n";
  out += "  at A         " + vec3(c.pointA) + "\n";
  out += "  at B         " + vec3(c.pointB) + "\n";
  out += "  triangles    " + std::to_string(c.trianglesA) + " vs " + std::to_string(c.trianglesB) +
         ", " + std::to_string(c.pairsTested) + " pairs tested\n";
  return out;
}

std::string measureText(const CircleFit& f) {
  if (!f.ok) {
    return "not a circle — fewer than three points, or they are collinear\n";
  }
  std::string out;
  out += "radius         " + fmt(f.radius) + " mm\n";
  out += "diameter       " + fmt(f.diameter()) + " mm\n";
  out += "centre         " + vec3(f.centre) + " mm\n";
  out += "axis           " + vec3(f.normal) + "\n";
  out += "fit residual   " + fmt(f.rms) + " mm rms (" + fmt(f.planeRms) + " mm out of plane, " +
         std::to_string(f.points) + " points)\n";
  return out;
}

}  // namespace forge::ui
