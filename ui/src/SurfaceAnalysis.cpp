#include "forge/ui/SurfaceAnalysis.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <utility>
#include <vector>

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = 180.0 / kPi;

double dot(const double a[3], const double b[3]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

double length(const double a[3]) { return std::sqrt(dot(a, a)); }

void cross(const double a[3], const double b[3], double out[3]) {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

// The angle between two unit vectors, in degrees, 0..180. acos is clamped
// because a dot product of two computed unit vectors can leave the domain by an
// ulp and NaN is not an angle.
double angleBetween(const double a[3], const double b[3]) {
  double c = dot(a, b);
  if (c > 1.0) c = 1.0;
  if (c < -1.0) c = -1.0;
  return std::acos(c) * kDeg;
}

// The same weld MeasureModel uses, and for the same reason: the incoming stream
// is de-indexed float32, so two references to one B-rep vertex agree only to
// float precision and exact comparison would report every interior edge as a
// boundary.
struct WeldKey {
  long long x = 0;
  long long y = 0;
  long long z = 0;
  bool operator<(const WeldKey& o) const noexcept {
    if (x != o.x) return x < o.x;
    if (y != o.y) return y < o.y;
    return z < o.z;
  }
};

WeldKey weld(const double p[3]) {
  WeldKey k;
  k.x = static_cast<long long>(std::llround(p[0] / kMeasureWeldTolerance));
  k.y = static_cast<long long>(std::llround(p[1] / kMeasureWeldTolerance));
  k.z = static_cast<long long>(std::llround(p[2] / kMeasureWeldTolerance));
  return k;
}

struct TriangleFacts {
  double normal[3] = {0.0, 0.0, 0.0};
  double centroid[3] = {0.0, 0.0, 0.0};
  bool valid = false;  // a degenerate triangle has no direction
};

TriangleFacts triangleFacts(const std::vector<double>& xyz, std::size_t t) {
  TriangleFacts f;
  const double* a = &xyz[t * 9 + 0];
  const double* b = &xyz[t * 9 + 3];
  const double* c = &xyz[t * 9 + 6];
  const double u[3] = {b[0] - a[0], b[1] - a[1], b[2] - a[2]};
  const double v[3] = {c[0] - a[0], c[1] - a[1], c[2] - a[2]};
  double n[3];
  cross(u, v, n);
  const double len = length(n);
  if (len > 0.0) {
    f.normal[0] = n[0] / len;
    f.normal[1] = n[1] / len;
    f.normal[2] = n[2] / len;
    f.valid = true;
  }
  for (int i = 0; i < 3; ++i) f.centroid[i] = (a[i] + b[i] + c[i]) / 3.0;
  return f;
}

}  // namespace

// ── the pull direction ──────────────────────────────────────────────────────

const char* pullAxisWord(PullAxis axis) noexcept {
  switch (axis) {
    case PullAxis::XPlus:  return "+X";
    case PullAxis::XMinus: return "-X";
    case PullAxis::YPlus:  return "+Y";
    case PullAxis::YMinus: return "-Y";
    case PullAxis::ZPlus:  return "+Z";
    case PullAxis::ZMinus: return "-Z";
  }
  return "+Z";
}

void pullAxisVector(PullAxis axis, double out[3]) noexcept {
  out[0] = out[1] = out[2] = 0.0;
  switch (axis) {
    case PullAxis::XPlus:  out[0] =  1.0; return;
    case PullAxis::XMinus: out[0] = -1.0; return;
    case PullAxis::YPlus:  out[1] =  1.0; return;
    case PullAxis::YMinus: out[1] = -1.0; return;
    case PullAxis::ZPlus:  out[2] =  1.0; return;
    case PullAxis::ZMinus: out[2] = -1.0; return;
  }
  out[2] = 1.0;
}

const std::vector<PullAxis>& allPullAxes() {
  static const std::vector<PullAxis> kAll = {PullAxis::XPlus,  PullAxis::XMinus,
                                             PullAxis::YPlus,  PullAxis::YMinus,
                                             PullAxis::ZPlus,  PullAxis::ZMinus};
  return kAll;
}

const char* toString(DraftVerdict verdict) noexcept {
  switch (verdict) {
    case DraftVerdict::Releasing:  return "comes away";
    case DraftVerdict::Shallow:    return "comes away, shallow";
    case DraftVerdict::Square:     return "square to the pull";
    case DraftVerdict::Opposite:   return "comes out the other way";
    case DraftVerdict::Unmeasured: return "not drawn";
  }
  return "not drawn";
}

const char* toString(JoinSmoothness smoothness) noexcept {
  switch (smoothness) {
    case JoinSmoothness::Smooth: return "runs in";
    case JoinSmoothness::Sharp:  return "breaks";
  }
  return "runs in";
}

// ── 1. THE DRAFT READING ───────────────────────────────────────────────────

DraftReport buildDraftReport(const MeasureMesh& mesh, PullAxis pull, double requiredDeg) {
  DraftReport out;
  out.pull = pull;
  out.requiredDeg = requiredDeg > 0.0 && std::isfinite(requiredDeg) ? requiredDeg : 0.0;
  if (mesh.empty()) return out;
  out.known = true;

  double d[3];
  pullAxisVector(pull, d);

  // ONE PASS over the soup, not one per face. measureFace() walks every triangle
  // to answer for one face, so asking it per face is quadratic in the body's
  // size -- which is exactly the reason ForgeFrame caches it for the model
  // browser. An imported part has thousands of faces and this panel measures all
  // of them on every rebuild.
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& faceIds = mesh.faceIds();
  const std::size_t triangles = mesh.triangleCount();

  struct FaceAccum {
    std::size_t measured = 0;              // triangles with a direction
    double area = 0.0;
    double normal[3] = {0.0, 0.0, 0.0};    // area-weighted, not yet normalised
    double centroid[3] = {0.0, 0.0, 0.0};  // area-weighted
    double worstDeg = 0.0;                 // the smallest draft over the face
    double bestDeg = 0.0;                  // and the largest
  };
  std::map<std::uint32_t, FaceAccum> byFace;

  for (std::size_t t = 0; t < triangles; ++t) {
    const double* a = &xyz[t * 9 + 0];
    const double* b = &xyz[t * 9 + 3];
    const double* c = &xyz[t * 9 + 6];
    const double u[3] = {b[0] - a[0], b[1] - a[1], b[2] - a[2]};
    const double v[3] = {c[0] - a[0], c[1] - a[1], c[2] - a[2]};
    double n[3];
    cross(u, v, n);
    const double twiceArea = length(n);
    const double area = 0.5 * twiceArea;
    FaceAccum& acc = byFace[faceIds[t]];
    acc.area += area;
    // The cross product's LENGTH is twice the area, so adding it raw is already
    // the area weighting; normalising first and scaling by area would be the
    // same number computed twice.
    for (int i = 0; i < 3; ++i) acc.normal[i] += 0.5 * n[i];
    for (int i = 0; i < 3; ++i) acc.centroid[i] += area * (a[i] + b[i] + c[i]) / 3.0;
    if (twiceArea <= 0.0) continue;  // a degenerate triangle has no direction
    double s = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / twiceArea;
    if (s > 1.0) s = 1.0;
    if (s < -1.0) s = -1.0;
    const double draft = std::asin(s) * kDeg;
    if (acc.measured == 0) {
      acc.worstDeg = draft;
      acc.bestDeg = draft;
    } else {
      acc.worstDeg = std::min(acc.worstDeg, draft);
      acc.bestDeg = std::max(acc.bestDeg, draft);
    }
    ++acc.measured;
  }

  // A second pass for planarity: every triangle normal within tolerance of the
  // face's own area-weighted one. Kept separate because that normal is not known
  // until the first pass has finished.
  std::map<std::uint32_t, bool> planar;
  std::map<std::uint32_t, std::vector<double>> unit;
  for (const auto& entry : byFace) {
    const double len = length(entry.second.normal);
    std::vector<double> u(3, 0.0);
    if (len > 0.0) {
      u[0] = entry.second.normal[0] / len;
      u[1] = entry.second.normal[1] / len;
      u[2] = entry.second.normal[2] / len;
    }
    unit[entry.first] = u;
    // A face whose triangle normals cancel out -- a bore, a whole cylinder --
    // has no single direction, so it is NOT flat. That is a fact about the face
    // and not a failure to measure it: every one of its triangles was measured,
    // and the range they cover is what the two angles below report.
    planar[entry.first] = len > 0.0;
  }
  for (std::size_t t = 0; t < triangles; ++t) {
    const std::vector<double>& u = unit[faceIds[t]];
    if (length(u.data()) < 0.5) continue;
    const TriangleFacts f = triangleFacts(xyz, t);
    if (!f.valid) continue;
    if (angleBetween(f.normal, u.data()) > kMeasureAngleTolerance) planar[faceIds[t]] = false;
  }

  for (const auto& entry : byFace) {
    const std::uint32_t faceId = entry.first;
    const FaceAccum& acc = entry.second;
    DraftFace f;
    f.faceId = faceId;
    f.area = acc.area;
    f.planar = planar[faceId];
    if (acc.area > 0.0) {
      for (int i = 0; i < 3; ++i) f.centroid[i] = acc.centroid[i] / acc.area;
    }

    // Only a face the kernel drew NOTHING measurable of is unmeasured. A face
    // that faces every way at once is measured perfectly well; it simply has no
    // single answer, which is what `uniform` says.
    if (acc.measured == 0) {
      f.verdict = DraftVerdict::Unmeasured;
      ++out.unmeasured;
      out.faces.push_back(f);
      continue;
    }
    f.draftDeg = acc.worstDeg;
    f.bestDraftDeg = acc.bestDeg;
    f.uniform = (acc.bestDeg - acc.worstDeg) <= kMeasureAngleTolerance;

    // THE WORST PART OF THE FACE DECIDES, and SQUARE is asked first: a wall
    // within the tolerance of running exactly along the pull drags whichever
    // side of zero it lands on, and calling it "releasing at 0.2 degrees" would
    // be a number pretending to be an answer.
    if (std::fabs(f.draftDeg) <= kMeasureAngleTolerance) {
      f.verdict = DraftVerdict::Square;
      ++out.square;
      out.squareArea += f.area;
    } else if (f.draftDeg < 0.0) {
      f.verdict = DraftVerdict::Opposite;
      ++out.opposite;
      out.oppositeArea += f.area;
    } else if (f.draftDeg + 1e-9 >= out.requiredDeg) {
      f.verdict = DraftVerdict::Releasing;
      ++out.releasing;
      out.releasingArea += f.area;
    } else {
      f.verdict = DraftVerdict::Shallow;
      ++out.shallow;
      out.shallowArea += f.area;
    }
    out.area += f.area;
    if (f.verdict == DraftVerdict::Releasing || f.verdict == DraftVerdict::Shallow) {
      if (!out.worstKnown || f.draftDeg < out.worstDraftDeg) {
        out.worstDraftDeg = f.draftDeg;
        out.worstKnown = true;
      }
    }
    out.faces.push_back(f);
  }

  // WORST FIRST: the face that will not come out is what the panel was opened
  // for. An unmeasured face has no angle and sorts last rather than to -90,
  // which would put a face nobody can see at the top of the list.
  std::sort(out.faces.begin(), out.faces.end(), [](const DraftFace& a, const DraftFace& b) {
    const bool au = a.verdict == DraftVerdict::Unmeasured;
    const bool bu = b.verdict == DraftVerdict::Unmeasured;
    if (au != bu) return bu;
    if (au && bu) return a.faceId < b.faceId;
    if (a.draftDeg != b.draftDeg) return a.draftDeg < b.draftDeg;
    return a.faceId < b.faceId;
  });
  return out;
}

// ── 2. THE CONTINUITY READING ──────────────────────────────────────────────

ContinuityReport buildContinuityReport(const MeasureMesh& mesh, const MeshMeasure& measured) {
  ContinuityReport out;
  if (mesh.empty()) return out;
  out.known = true;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& faceIds = mesh.faceIds();
  const std::size_t triangles = mesh.triangleCount();

  std::vector<TriangleFacts> facts(triangles);
  for (std::size_t t = 0; t < triangles; ++t) facts[t] = triangleFacts(xyz, t);

  // Every undirected welded edge, and the triangles that use it. The map is
  // ordered so the walk is deterministic run to run, which is what lets a gate
  // pin the answer.
  struct EdgeUse {
    std::size_t triangle = 0;
    double length = 0.0;
  };
  std::map<std::pair<WeldKey, WeldKey>, std::vector<EdgeUse>> edges;

  for (std::size_t t = 0; t < triangles; ++t) {
    for (int e = 0; e < 3; ++e) {
      const double* p = &xyz[t * 9 + static_cast<std::size_t>(e) * 3];
      const double* q = &xyz[t * 9 + static_cast<std::size_t>((e + 1) % 3) * 3];
      WeldKey a = weld(p);
      WeldKey b = weld(q);
      if (b < a) std::swap(a, b);
      const double delta[3] = {q[0] - p[0], q[1] - p[1], q[2] - p[2]};
      edges[std::make_pair(a, b)].push_back(EdgeUse{t, length(delta)});
    }
  }

  // ── the resolution: the largest break INSIDE one face ────────────────────
  // A curved face is drawn as flat facets, so the surface breaks by a few
  // degrees at every one of them. That step is the finest join this mesh can
  // resolve, and it is measured here rather than chosen. See the header.
  double step = 0.0;
  bool sawInterior = false;
  for (const auto& entry : edges) {
    if (entry.second.size() != 2) continue;
    const std::size_t t0 = entry.second[0].triangle;
    const std::size_t t1 = entry.second[1].triangle;
    if (faceIds[t0] != faceIds[t1]) continue;
    if (!facts[t0].valid || !facts[t1].valid) continue;
    sawInterior = true;
    const double a = angleBetween(facts[t0].normal, facts[t1].normal);
    if (a > step) step = a;
  }
  out.resolutionDeg = std::max(step, kMeasureAngleTolerance);
  out.resolutionIsFloor = !sawInterior || step <= kMeasureAngleTolerance;

  // ── the joins ────────────────────────────────────────────────────────────
  struct Accum {
    std::size_t edges = 0;
    double length = 0.0;
    double minDeg = 0.0;
    double maxDeg = 0.0;
    double weighted = 0.0;   // sum of break * length
    long convexVotes = 0;    // one vote per shared edge: + outside, - inside
  };
  std::map<std::pair<std::uint32_t, std::uint32_t>, Accum> joins;

  for (const auto& entry : edges) {
    const std::vector<EdgeUse>& uses = entry.second;
    if (uses.size() == 1) { ++out.openEdges; continue; }
    if (uses.size() > 2) { ++out.oddEdges; continue; }
    const std::size_t t0 = uses[0].triangle;
    const std::size_t t1 = uses[1].triangle;
    const std::uint32_t f0 = faceIds[t0];
    const std::uint32_t f1 = faceIds[t1];
    if (f0 == f1) continue;  // inside one face: that is the resolution, above
    if (!facts[t0].valid || !facts[t1].valid) continue;

    const std::uint32_t lo = std::min(f0, f1);
    const std::uint32_t hi = std::max(f0, f1);
    const double breakDeg = angleBetween(facts[t0].normal, facts[t1].normal);
    const double len = uses[0].length;

    Accum& acc = joins[std::make_pair(lo, hi)];
    if (acc.edges == 0) {
      acc.minDeg = breakDeg;
      acc.maxDeg = breakDeg;
    } else {
      acc.minDeg = std::min(acc.minDeg, breakDeg);
      acc.maxDeg = std::max(acc.maxDeg, breakDeg);
    }
    ++acc.edges;
    acc.length += len;
    acc.weighted += breakDeg * len;

    // WHICH SIDE THE MATERIAL IS ON. For an outward-facing closed mesh the
    // second triangle's centre falls BELOW the first triangle's plane at an
    // outside corner and above it at an inside one.
    const double delta[3] = {facts[t1].centroid[0] - facts[t0].centroid[0],
                             facts[t1].centroid[1] - facts[t0].centroid[1],
                             facts[t1].centroid[2] - facts[t0].centroid[2]};
    const double side = dot(delta, facts[t0].normal);
    if (side < 0.0) ++acc.convexVotes;
    else if (side > 0.0) --acc.convexVotes;
  }

  const bool orientationKnown = measured.watertight && measured.outward;
  for (const auto& entry : joins) {
    const Accum& acc = entry.second;
    SurfaceJoin j;
    j.faceA = entry.first.first;
    j.faceB = entry.first.second;
    j.sharedEdges = acc.edges;
    j.sharedLength = acc.length;
    j.minBreakDeg = acc.minDeg;
    j.maxBreakDeg = acc.maxDeg;
    j.meanBreakDeg = acc.length > 0.0 ? acc.weighted / acc.length : acc.maxDeg;
    j.smoothness = acc.maxDeg <= out.resolutionDeg ? JoinSmoothness::Smooth : JoinSmoothness::Sharp;
    j.convexKnown = orientationKnown && acc.convexVotes != 0;
    j.convex = acc.convexVotes > 0;
    if (j.smoothness == JoinSmoothness::Smooth) {
      ++out.smooth;
      out.smoothLength += j.sharedLength;
    } else {
      ++out.sharp;
      out.sharpLength += j.sharedLength;
    }
    if (!out.worstKnown || j.maxBreakDeg > out.worstBreakDeg) {
      out.worstBreakDeg = j.maxBreakDeg;
      out.worstKnown = true;
    }
    out.joins.push_back(std::move(j));
  }

  // HARDEST FIRST: the join a customer would see is the one at the top.
  std::sort(out.joins.begin(), out.joins.end(), [](const SurfaceJoin& a, const SurfaceJoin& b) {
    if (a.maxBreakDeg != b.maxBreakDeg) return a.maxBreakDeg > b.maxBreakDeg;
    if (a.faceA != b.faceA) return a.faceA < b.faceA;
    return a.faceB < b.faceB;
  });
  return out;
}

}  // namespace forge::ui
