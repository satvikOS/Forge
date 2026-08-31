#include "forge/ui/AnalysisModel.hpp"

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

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {
namespace {

constexpr double kDegPerRad = 57.29577951308232;

void sub3(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
}

void cross3(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

double norm3(const double a[3]) noexcept { return std::sqrt(dot3(a, a)); }

bool unit3(double v[3]) noexcept {
  const double n = norm3(v);
  if (!(n > 1e-12)) return false;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
  return true;
}

void triangleNormal(const double* t, double out[3]) noexcept {
  double e1[3], e2[3];
  sub3(t + 3, t, e1);
  sub3(t + 6, t, e2);
  cross3(e1, e2, out);
}

// The SAME weld quantum MeasureModel and EdgeModel use, for the same reason:
// three modules that disagree about which vertices are the same vertex produce
// three different topologies of one mesh.
using WeldKey = std::array<long long, 3>;

WeldKey weldKey(const double p[3]) noexcept {
  return WeldKey{std::llround(p[0] / kMeasureWeldTolerance),
                 std::llround(p[1] / kMeasureWeldTolerance),
                 std::llround(p[2] / kMeasureWeldTolerance)};
}

std::string fmt(double v) {
  char buf[40];
  const int n = std::snprintf(buf, sizeof(buf), "%.6g", v);
  return n > 0 ? std::string(buf, static_cast<std::size_t>(n)) : std::string("0");
}

std::string vec3(const double v[3]) {
  return "(" + fmt(v[0]) + ", " + fmt(v[1]) + ", " + fmt(v[2]) + ")";
}

// Möller & Trumbore (1997), "Fast, Minimum Storage Ray/Triangle Intersection",
// J. Graphics Tools 2(1). Two-sided: a thickness ray leaves the material through
// the far wall's BACK, and a one-sided test would report no far wall at all.
bool rayTriangle(const double origin[3], const double direction[3], const double* t,
                 double& distance) {
  double e1[3], e2[3], pv[3], tv[3], qv[3];
  sub3(t + 3, t, e1);
  sub3(t + 6, t, e2);
  cross3(direction, e2, pv);
  const double det = dot3(e1, pv);
  if (std::fabs(det) < 1e-15) return false;  // ray parallel to the triangle plane
  const double inv = 1.0 / det;
  sub3(origin, t, tv);
  const double u = dot3(tv, pv) * inv;
  if (u < -1e-9 || u > 1.0 + 1e-9) return false;
  cross3(tv, e1, qv);
  const double v = dot3(direction, qv) * inv;
  if (v < -1e-9 || u + v > 1.0 + 1e-9) return false;
  distance = dot3(e2, qv) * inv;
  return true;
}

void fillHit(const MeasureMesh& mesh, std::size_t tri, const double origin[3],
             const double direction[3], double distance, RayHit& out) {
  out.hit = true;
  out.distance = distance;
  out.triangle = tri;
  out.faceId = mesh.faceIds()[tri];
  for (std::size_t i = 0; i < 3; ++i) out.point[i] = origin[i] + distance * direction[i];
  double n[3];
  triangleNormal(&mesh.coords()[tri * 9], n);
  if (unit3(n)) {
    for (std::size_t i = 0; i < 3; ++i) out.normal[i] = n[i];
  }
}

}  // namespace

// ── ray casting ─────────────────────────────────────────────────────────────
RayHit rayMeshHitBruteForce(const MeasureMesh& mesh, const double origin[3],
                            const double direction[3], double minDistance,
                            double maxDistance) {
  RayHit best;
  const std::vector<double>& xyz = mesh.coords();
  const std::size_t tris = mesh.triangleCount();
  double bestT = 0.0;
  for (std::size_t t = 0; t < tris; ++t) {
    double d = 0.0;
    if (!rayTriangle(origin, direction, &xyz[t * 9], d)) continue;
    if (d < minDistance || d > maxDistance) continue;
    if (best.hit && d >= bestT) continue;
    bestT = d;
    fillHit(mesh, t, origin, direction, d, best);
  }
  return best;
}

void MeshRayIndex::build(const MeasureMesh& mesh, double targetPerCell) {
  built_ = false;
  cellStart_.clear();
  items_.clear();
  dims_[0] = dims_[1] = dims_[2] = 0;
  const std::size_t tris = mesh.triangleCount();
  if (tris == 0) return;

  const std::vector<double>& xyz = mesh.coords();
  MeasureBox box;
  for (std::size_t i = 0; i + 2 < xyz.size(); i += 3) box.grow(&xyz[i]);
  if (!box.valid) return;

  double extent[3];
  for (std::size_t k = 0; k < 3; ++k) {
    // A flat mesh (a single planar face) has zero extent on one axis. A zero
    // cell size divides by zero in the DDA, so the axis is given ONE cell and a
    // nominal size rather than being special-cased later.
    extent[k] = std::max(box.max[k] - box.min[k], 1e-9);
  }
  if (!(targetPerCell > 0.0)) targetPerCell = 4.0;
  const double wanted = static_cast<double>(tris) / targetPerCell;
  const double volume = extent[0] * extent[1] * extent[2];
  const double density = std::cbrt(std::max(wanted, 1.0) / std::max(volume, 1e-30));
  for (std::size_t k = 0; k < 3; ++k) {
    const double n = std::floor(extent[k] * density);
    // 64 per axis caps the grid at 262 144 cells — enough for the target part
    // and small enough that the prefix table stays a few megabytes.
    dims_[k] = static_cast<std::size_t>(std::clamp(n, 1.0, 64.0));
    origin_[k] = box.min[k];
    cell_[k] = extent[k] / static_cast<double>(dims_[k]);
  }

  const std::size_t total = cellCount();
  std::vector<std::size_t> counts(total, 0);
  const auto cellRange = [this, &xyz](std::size_t t, std::size_t lo[3], std::size_t hi[3]) {
    for (std::size_t k = 0; k < 3; ++k) {
      double mn = xyz[t * 9 + k];
      double mx = mn;
      for (std::size_t v = 1; v < 3; ++v) {
        const double c = xyz[t * 9 + v * 3 + k];
        mn = std::min(mn, c);
        mx = std::max(mx, c);
      }
      const double a = std::floor((mn - origin_[k]) / cell_[k]);
      const double b = std::floor((mx - origin_[k]) / cell_[k]);
      lo[k] = static_cast<std::size_t>(
          std::clamp(a, 0.0, static_cast<double>(dims_[k] - 1)));
      hi[k] = static_cast<std::size_t>(
          std::clamp(b, 0.0, static_cast<double>(dims_[k] - 1)));
    }
  };

  for (std::size_t t = 0; t < tris; ++t) {
    std::size_t lo[3], hi[3];
    cellRange(t, lo, hi);
    for (std::size_t z = lo[2]; z <= hi[2]; ++z) {
      for (std::size_t y = lo[1]; y <= hi[1]; ++y) {
        for (std::size_t x = lo[0]; x <= hi[0]; ++x) {
          ++counts[(z * dims_[1] + y) * dims_[0] + x];
        }
      }
    }
  }
  cellStart_.assign(total + 1, 0);
  for (std::size_t i = 0; i < total; ++i) cellStart_[i + 1] = cellStart_[i] + counts[i];
  items_.assign(cellStart_[total], 0);
  std::vector<std::size_t> cursor(cellStart_.begin(), cellStart_.end() - 1);
  for (std::size_t t = 0; t < tris; ++t) {
    std::size_t lo[3], hi[3];
    cellRange(t, lo, hi);
    for (std::size_t z = lo[2]; z <= hi[2]; ++z) {
      for (std::size_t y = lo[1]; y <= hi[1]; ++y) {
        for (std::size_t x = lo[0]; x <= hi[0]; ++x) {
          items_[cursor[(z * dims_[1] + y) * dims_[0] + x]++] = t;
        }
      }
    }
  }
  built_ = true;
}

RayHit MeshRayIndex::cast(const MeasureMesh& mesh, const double origin[3],
                          const double direction[3], double minDistance,
                          double maxDistance) const {
  lastTests_ = 0;
  RayHit best;
  if (!built_) return best;

  double dir[3] = {direction[0], direction[1], direction[2]};
  const double dirLen = norm3(dir);
  if (!(dirLen > 1e-300)) return best;

  // Clip the ray to the grid box, in the ray's OWN parameter (so `distance`
  // stays comparable with minDistance / maxDistance without rescaling).
  double t0 = minDistance;
  double t1 = maxDistance;
  for (std::size_t k = 0; k < 3; ++k) {
    const double lo = origin_[k];
    const double hi = origin_[k] + cell_[k] * static_cast<double>(dims_[k]);
    if (std::fabs(dir[k]) < 1e-300) {
      if (origin[k] < lo || origin[k] > hi) return best;  // parallel and outside
      continue;
    }
    double a = (lo - origin[k]) / dir[k];
    double b = (hi - origin[k]) / dir[k];
    if (a > b) std::swap(a, b);
    t0 = std::max(t0, a);
    t1 = std::min(t1, b);
    if (t0 > t1) return best;
  }

  // Entry cell. A tiny nudge past t0 keeps a ray that grazes a boundary from
  // landing one cell outside and missing everything.
  double p[3];
  for (std::size_t k = 0; k < 3; ++k) p[k] = origin[k] + dir[k] * (t0 + 1e-12);
  long idx[3];
  for (std::size_t k = 0; k < 3; ++k) {
    const double c = std::floor((p[k] - origin_[k]) / cell_[k]);
    idx[k] = static_cast<long>(std::clamp(c, 0.0, static_cast<double>(dims_[k] - 1)));
  }

  long step[3];
  double tMax[3], tDelta[3];
  for (std::size_t k = 0; k < 3; ++k) {
    if (std::fabs(dir[k]) < 1e-300) {
      step[k] = 0;
      tMax[k] = t1 + 1.0;  // never the smallest
      tDelta[k] = t1 + 1.0;
      continue;
    }
    step[k] = dir[k] > 0.0 ? 1 : -1;
    const double boundary =
        origin_[k] + cell_[k] * static_cast<double>(idx[k] + (step[k] > 0 ? 1 : 0));
    tMax[k] = (boundary - origin[k]) / dir[k];
    tDelta[k] = cell_[k] / std::fabs(dir[k]);
  }

  double bestT = 0.0;
  std::vector<std::size_t> seen;  // triangles already tested (they span cells)
  while (true) {
    const std::size_t cell =
        (static_cast<std::size_t>(idx[2]) * dims_[1] + static_cast<std::size_t>(idx[1])) *
            dims_[0] +
        static_cast<std::size_t>(idx[0]);
    for (std::size_t i = cellStart_[cell]; i < cellStart_[cell + 1]; ++i) {
      const std::size_t t = items_[i];
      if (std::find(seen.begin(), seen.end(), t) != seen.end()) continue;
      seen.push_back(t);
      ++lastTests_;
      double d = 0.0;
      if (!rayTriangle(origin, dir, &mesh.coords()[t * 9], d)) continue;
      if (d < minDistance || d > maxDistance) continue;
      if (best.hit && d >= bestT) continue;
      bestT = d;
      fillHit(mesh, t, origin, dir, d, best);
    }
    // A hit inside the cell just visited is final only once the ray has left
    // that cell — a triangle spanning two cells can be hit closer from the next
    // one. Comparing against the cell EXIT parameter is what makes early-out
    // correct rather than merely fast.
    const std::size_t axis = (tMax[0] < tMax[1]) ? ((tMax[0] < tMax[2]) ? 0 : 2)
                                                 : ((tMax[1] < tMax[2]) ? 1 : 2);
    if (best.hit && bestT <= tMax[axis]) break;
    if (tMax[axis] > t1) break;
    idx[axis] += step[axis];
    if (idx[axis] < 0 || static_cast<std::size_t>(idx[axis]) >= dims_[axis]) break;
    tMax[axis] += tDelta[axis];
  }
  return best;
}

// ── SECTION ─────────────────────────────────────────────────────────────────
SectionPlane SectionPlane::through(const double point[3], const double normal[3]) {
  SectionPlane p;
  double n[3] = {normal[0], normal[1], normal[2]};
  if (!unit3(n)) {
    // A zero normal is not a plane. Leave the default +Z and an offset that
    // says so, and let sectionMesh() report measured=false — inventing a plane
    // here would silently section the part somewhere nobody asked for.
    p.normal[0] = p.normal[1] = p.normal[2] = 0.0;
    p.offset = 0.0;
    return p;
  }
  for (std::size_t k = 0; k < 3; ++k) p.normal[k] = n[k];
  p.offset = dot3(n, point);
  return p;
}

SectionResult sectionMesh(const MeasureMesh& mesh, const SectionPlane& plane) {
  SectionResult out;
  double n[3] = {plane.normal[0], plane.normal[1], plane.normal[2]};
  const double len = norm3(n);
  if (!(len > 1e-12)) return out;  // not a plane
  const double offset = plane.offset / len;
  for (std::size_t k = 0; k < 3; ++k) n[k] /= len;
  if (mesh.triangleCount() == 0) return out;

  const std::vector<double>& xyz = mesh.coords();
  // A tolerance proportional to the part, not an absolute epsilon: a vertex ON
  // the plane must not produce a zero-length segment, and "on the plane" means
  // something different at 0.5 mm and at 500 mm.
  MeasureBox box;
  for (std::size_t i = 0; i + 2 < xyz.size(); i += 3) box.grow(&xyz[i]);
  const double eps = std::max(1e-12, 1e-9 * std::max(1.0, box.diagonal()));

  std::vector<double> segs;
  for (std::size_t t = 0; t < mesh.triangleCount(); ++t) {
    const double* p = &xyz[t * 9];
    double d[3];
    for (std::size_t v = 0; v < 3; ++v) d[v] = dot3(p + v * 3, n) - offset;
    const bool above = d[0] > eps && d[1] > eps && d[2] > eps;
    const bool below = d[0] < -eps && d[1] < -eps && d[2] < -eps;
    if (above) {
      ++out.trianglesAbove;
      continue;
    }
    if (below) {
      ++out.trianglesBelow;
      continue;
    }
    ++out.trianglesCut;
    // Collect the crossing points on the three edges. A triangle lying IN the
    // plane contributes no crossing and is skipped: its three edges would each
    // produce a degenerate segment and the loop tracer would see a mess.
    double hits[3][3];
    std::size_t count = 0;
    for (std::size_t e = 0; e < 3 && count < 3; ++e) {
      const std::size_t a = e;
      const std::size_t b = (e + 1) % 3;
      const double da = d[a];
      const double db = d[b];
      if ((da > eps && db > eps) || (da < -eps && db < -eps)) continue;
      if (std::fabs(da) <= eps && std::fabs(db) <= eps) continue;  // edge in-plane
      if (std::fabs(da) <= eps) {
        for (std::size_t k = 0; k < 3; ++k) hits[count][k] = p[a * 3 + k];
        ++count;
        continue;
      }
      if (std::fabs(db) <= eps) continue;  // taken when this edge is visited as `a`
      if ((da > 0.0) == (db > 0.0)) continue;
      const double s = da / (da - db);
      for (std::size_t k = 0; k < 3; ++k) {
        hits[count][k] = p[a * 3 + k] + s * (p[b * 3 + k] - p[a * 3 + k]);
      }
      ++count;
    }
    if (count != 2) continue;
    double delta[3];
    sub3(hits[1], hits[0], delta);
    if (!(norm3(delta) > eps)) continue;  // a point, not a segment
    for (std::size_t v = 0; v < 2; ++v) {
      for (std::size_t k = 0; k < 3; ++k) segs.push_back(hits[v][k]);
    }
  }

  out.measured = true;
  out.segments = segs.size() / 6;
  out.points = segs;
  for (std::size_t i = 0; i + 2 < segs.size(); i += 3) out.box.grow(&segs[i]);
  for (std::size_t s = 0; s < out.segments; ++s) {
    double delta[3];
    sub3(&segs[s * 6 + 3], &segs[s * 6], delta);
    out.perimeter += norm3(delta);
  }
  if (out.segments == 0) return out;

  // ── loops, and the area they enclose ──────────────────────────────────────
  // Chain the segments end to end on the welded endpoint key. A closed chain is
  // a loop; anything else is reported as an open chain rather than being folded
  // into the area, because an unclosed boundary has no enclosed area and
  // pretending otherwise is a fabricated number.
  std::map<WeldKey, std::vector<std::size_t>> incident;  // vertex -> segment ids
  std::vector<WeldKey> endA(out.segments), endB(out.segments);
  for (std::size_t s = 0; s < out.segments; ++s) {
    endA[s] = weldKey(&segs[s * 6]);
    endB[s] = weldKey(&segs[s * 6 + 3]);
    incident[endA[s]].push_back(s);
    incident[endB[s]].push_back(s);
  }
  std::vector<bool> used(out.segments, false);
  // An in-plane basis for the signed area.
  double t0[3] = {1.0, 0.0, 0.0};
  if (std::fabs(n[0]) > 0.9) {
    t0[0] = 0.0;
    t0[1] = 1.0;
  }
  double e1[3], e2[3];
  cross3(n, t0, e1);
  unit3(e1);
  cross3(n, e1, e2);
  unit3(e2);

  double signedArea = 0.0;
  for (std::size_t s = 0; s < out.segments; ++s) {
    if (used[s]) continue;
    used[s] = true;
    std::vector<double> chain;
    for (std::size_t k = 0; k < 3; ++k) chain.push_back(segs[s * 6 + k]);
    for (std::size_t k = 0; k < 3; ++k) chain.push_back(segs[s * 6 + 3 + k]);
    WeldKey head = endA[s];
    WeldKey tail = endB[s];
    bool closed = false;
    while (true) {
      if (tail == head) {
        closed = true;
        break;
      }
      std::size_t next = out.segments;
      for (std::size_t cand : incident[tail]) {
        if (used[cand]) continue;
        next = cand;
        break;
      }
      if (next == out.segments) break;  // open chain
      used[next] = true;
      const bool forward = endA[next] == tail;
      const std::size_t from = forward ? 3 : 0;
      for (std::size_t k = 0; k < 3; ++k) chain.push_back(segs[next * 6 + from + k]);
      tail = forward ? endB[next] : endA[next];
    }
    if (!closed) {
      ++out.openChains;
      continue;
    }
    ++out.loops;
    // Shoelace in the plane basis. The SIGN is kept: an inner loop traced the
    // other way subtracts, so a sectioned tube reports its annulus.
    const std::size_t pts = chain.size() / 3;
    double acc = 0.0;
    for (std::size_t i = 0; i < pts; ++i) {
      const double* a = &chain[i * 3];
      const double* b = &chain[((i + 1) % pts) * 3];
      const double ua = dot3(a, e1), va = dot3(a, e2);
      const double ub = dot3(b, e1), vb = dot3(b, e2);
      acc += ua * vb - ub * va;
    }
    signedArea += 0.5 * acc;
  }
  out.area = std::fabs(signedArea);
  return out;
}

// ── DRAFT ───────────────────────────────────────────────────────────────────
const char* toString(DraftClass cls) noexcept {
  switch (cls) {
    case DraftClass::Positive:     return "positive";
    case DraftClass::Negative:     return "negative";
    case DraftClass::Insufficient: return "insufficient";
    case DraftClass::Degenerate:   return "degenerate";
  }
  return "degenerate";
}

namespace {

DraftClass classifyDraft(double angleDegrees, double required) {
  if (angleDegrees >= required) return DraftClass::Positive;
  if (angleDegrees <= -required) return DraftClass::Negative;
  return DraftClass::Insufficient;
}

}  // namespace

DraftAnalysis draftAnalysis(const MeasureMesh& mesh, const double pull[3],
                            double requiredDegrees) {
  DraftAnalysis out;
  out.requiredDegrees = requiredDegrees;
  double p[3] = {pull[0], pull[1], pull[2]};
  if (!unit3(p)) return out;  // no pull direction: nothing to say
  for (std::size_t k = 0; k < 3; ++k) out.pull[k] = p[k];
  if (mesh.triangleCount() == 0) return out;
  out.measured = true;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  std::map<std::uint32_t, FaceDraft> byFace;
  // [0] = sum(area * draftAngle), [1] = sum(area) over triangles with a usable
  // normal, [2] unused. See the comment at the accumulation site for why the
  // ANGLE is averaged rather than the normal.
  std::map<std::uint32_t, std::array<double, 3>> accumNormal;
  // How many triangles of a face carried a usable normal. Kept here rather than
  // on FaceDraft because it is scaffolding for the min/max seed, not something
  // a caller of the analysis has any use for.
  std::map<std::uint32_t, std::size_t> normalSamples;

  for (std::size_t t = 0; t < ids.size(); ++t) {
    double n[3];
    triangleNormal(&xyz[t * 9], n);
    const double area = 0.5 * norm3(n);
    FaceDraft& f = byFace[ids[t]];
    f.faceId = ids[t];
    f.area += area;
    if (!unit3(n)) continue;  // a sliver carries no direction
    const double a = std::asin(std::clamp(dot3(n, p), -1.0, 1.0)) * kDegPerRad;
    // THE ANGLE IS AVERAGED, THE NORMAL IS NOT. Averaging the normals and taking
    // the angle of the mean is the obvious implementation and it is WRONG on
    // exactly the face draft analysis exists for: a full cylindrical wall's
    // area-weighted normal sums to ZERO, so a bore with no draft at all — the
    // canonical mouldability defect — came back classified `degenerate` and was
    // counted in neither the pass nor the fail column. Measured on a 32-segment
    // cylinder: the wall reported no usable normal while every one of its
    // triangles reported a draft angle of 0.000. Averaging the SCALAR angle,
    // area-weighted, agrees with the normal method on any planar face and gives
    // the cylinder wall the 0 degrees it actually has.
    std::array<double, 3>& acc = accumNormal[ids[t]];
    acc[0] += area * a;   // sum(area * angle)
    acc[1] += area;       // sum(area) over triangles WITH a normal
    std::size_t& seen = normalSamples[ids[t]];
    if (seen == 0) {
      f.minTriangleAngle = a;
      f.maxTriangleAngle = a;
    } else {
      f.minTriangleAngle = std::min(f.minTriangleAngle, a);
      f.maxTriangleAngle = std::max(f.maxTriangleAngle, a);
    }
    ++seen;
  }

  for (auto& [id, face] : byFace) {
    const std::array<double, 3>& acc = accumNormal[id];
    if (normalSamples[id] == 0 || !(acc[1] > 1e-15)) {
      // NOT ONE triangle of this face had a usable normal. That is a face made
      // entirely of slivers, and it has no draft angle to report.
      face.cls = DraftClass::Degenerate;
      face.uniform = false;
      out.faces.push_back(face);
      continue;
    }
    face.angleDegrees = acc[0] / acc[1];
    face.cls = classifyDraft(face.angleDegrees, requiredDegrees);
    // A curved wall can be drafted at one end and not the other, and a per-FACE
    // colour would show it as uniformly fine. Say so.
    face.uniform = classifyDraft(face.minTriangleAngle, requiredDegrees) == face.cls &&
                   classifyDraft(face.maxTriangleAngle, requiredDegrees) == face.cls;
    out.faces.push_back(face);
  }

  double worstArea = -1.0;
  for (const FaceDraft& f : out.faces) {
    switch (f.cls) {
      case DraftClass::Positive:
        ++out.countPositive;
        out.areaPositive += f.area;
        break;
      case DraftClass::Negative:
        ++out.countNegative;
        out.areaNegative += f.area;
        break;
      case DraftClass::Insufficient:
        ++out.countInsufficient;
        out.areaInsufficient += f.area;
        if (f.area > worstArea) {
          worstArea = f.area;
          out.worstFace = f.faceId;
        }
        break;
      case DraftClass::Degenerate:
        ++out.countDegenerate;
        break;
    }
  }
  return out;
}

// ── CURVATURE / ZEBRA ───────────────────────────────────────────────────────
CurvatureAnalysis curvatureAnalysis(const MeasureMesh& mesh, double tangentToleranceDegrees) {
  CurvatureAnalysis out;
  out.tangentToleranceDegrees = tangentToleranceDegrees;
  if (mesh.triangleCount() == 0) return out;
  out.measured = true;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();

  // Per-triangle unit normal and centroid, computed once.
  const std::size_t tris = mesh.triangleCount();
  std::vector<double> normals(tris * 3, 0.0);
  std::vector<bool> hasNormal(tris, false);
  for (std::size_t t = 0; t < tris; ++t) {
    double n[3];
    triangleNormal(&xyz[t * 9], n);
    if (unit3(n)) {
      hasNormal[t] = true;
      for (std::size_t k = 0; k < 3; ++k) normals[t * 3 + k] = n[k];
    }
  }

  // Undirected welded segment -> the triangles that use it, and its LENGTH.
  // The length is the Cohen-Steiner/Morvan weight, so it is carried here rather
  // than recovered from the weld key (which is quantised and would give a
  // slightly wrong length).
  struct SegmentUse {
    std::vector<std::size_t> triangles;
    double length = 0.0;
  };
  std::map<std::pair<WeldKey, WeldKey>, SegmentUse> segments;
  for (std::size_t t = 0; t < tris; ++t) {
    const double* p = &xyz[t * 9];
    const WeldKey k[3] = {weldKey(p), weldKey(p + 3), weldKey(p + 6)};
    for (std::size_t e = 0; e < 3; ++e) {
      WeldKey a = k[e];
      WeldKey b = k[(e + 1) % 3];
      if (a == b) continue;
      double d[3];
      sub3(p + ((e + 1) % 3) * 3, p + e * 3, d);
      const double len = norm3(d);
      if (b < a) std::swap(a, b);
      SegmentUse& use = segments[{a, b}];
      use.triangles.push_back(t);
      use.length = len;
    }
  }

  struct FaceAccum {
    std::size_t edges = 0;
    double sumDeg = 0.0;
    double maxDeg = 0.0;
    double sumBetaLen = 0.0;  // sum(dihedral in RADIANS * edge length)
  };
  std::map<std::uint32_t, FaceAccum> faceAccum;
  // The Cohen-Steiner/Morvan average needs the face's AREA, so it is summed here
  // rather than asking measureFace() to re-walk the whole soup once per face —
  // which on a 430-face part is 430 full passes over the triangle list.
  std::map<std::uint32_t, double> faceArea;
  for (std::size_t t = 0; t < tris; ++t) {
    double n[3];
    triangleNormal(&xyz[t * 9], n);
    faceArea[ids[t]] += 0.5 * norm3(n);
  }
  struct JoinAccum {
    std::size_t segments = 0;
    double sumDeg = 0.0;
    double maxDeg = 0.0;
  };
  std::map<std::pair<std::uint32_t, std::uint32_t>, JoinAccum> joinAccum;

  // Every face gets a row even with no interior edge — a planar face of two
  // triangles that share one segment has one; a single-triangle face has none,
  // and reporting no row for it would make it look absent from the part.
  for (std::uint32_t id : mesh.faces()) faceAccum[id];

  for (const auto& [key, use] : segments) {
    (void)key;
    if (use.triangles.size() != 2) continue;  // boundary or non-manifold: no dihedral
    const std::size_t ta = use.triangles[0];
    const std::size_t tb = use.triangles[1];
    if (!hasNormal[ta] || !hasNormal[tb]) continue;
    const double c = std::clamp(dot3(&normals[ta * 3], &normals[tb * 3]), -1.0, 1.0);
    const double deg = std::acos(c) * kDegPerRad;

    if (ids[ta] == ids[tb]) {
      FaceAccum& acc = faceAccum[ids[ta]];
      ++acc.edges;
      acc.sumDeg += deg;
      acc.maxDeg = std::max(acc.maxDeg, deg);
      acc.sumBetaLen += (deg / kDegPerRad) * use.length;
    } else {
      const std::uint32_t lo = std::min(ids[ta], ids[tb]);
      const std::uint32_t hi = std::max(ids[ta], ids[tb]);
      JoinAccum& acc = joinAccum[{lo, hi}];
      ++acc.segments;
      acc.sumDeg += deg;
      acc.maxDeg = std::max(acc.maxDeg, deg);
    }
  }

  for (const auto& [id, acc] : faceAccum) {
    FaceCurvature fc;
    fc.faceId = id;
    fc.interiorEdges = acc.edges;
    fc.area = faceArea[id];
    fc.meanDihedralDegrees = acc.edges ? acc.sumDeg / static_cast<double>(acc.edges) : 0.0;
    fc.maxDihedralDegrees = acc.maxDeg;
    if (fc.area > 1e-12 && acc.sumBetaLen > 1e-12) {
      fc.hasCurvature = true;
      fc.meanCurvature = acc.sumBetaLen / (2.0 * fc.area);
      fc.curvatureRadius = fc.area / acc.sumBetaLen;
    }
    fc.planar = acc.maxDeg <= kMeasureAngleTolerance;
    out.faces.push_back(fc);
  }
  for (const auto& [pair, acc] : joinAccum) {
    FaceContinuity fj;
    fj.faceA = pair.first;
    fj.faceB = pair.second;
    fj.segments = acc.segments;
    fj.maxAngleDegrees = acc.maxDeg;
    fj.meanAngleDegrees = acc.segments ? acc.sumDeg / static_cast<double>(acc.segments) : 0.0;
    fj.tangent = acc.maxDeg <= tangentToleranceDegrees;
    if (fj.tangent) ++out.tangentJoins;
    else ++out.sharpJoins;
    out.sharpestJoinDegrees = std::max(out.sharpestJoinDegrees, acc.maxDeg);
    out.joins.push_back(fj);
  }
  return out;
}

double zebraValue(const double normal[3], const double viewDir[3], double stripes) {
  double n[3] = {normal[0], normal[1], normal[2]};
  double v[3] = {viewDir[0], viewDir[1], viewDir[2]};
  if (!unit3(n) || !unit3(v)) return 0.0;
  // Reflect the view about the normal: r = 2(n.v)n - v. That is exactly what a
  // reflection-line shader shows, so the stripe a gate asserts is the stripe the
  // viewport draws.
  const double d = dot3(n, v);
  double r[3];
  for (std::size_t k = 0; k < 3; ++k) r[k] = 2.0 * d * n[k] - v[k];
  if (!unit3(r)) return 0.0;
  // Elevation of the reflected ray, mapped to [0, 1).
  const double elev = std::asin(std::clamp(r[2], -1.0, 1.0));
  const double turns = elev / 3.14159265358979323846 + 0.5;
  return turns * stripes;
}

// ── THICKNESS ───────────────────────────────────────────────────────────────
ThicknessAnalysis thicknessAnalysis(const MeasureMesh& mesh, std::size_t samplesPerFace) {
  ThicknessAnalysis out;
  if (mesh.triangleCount() == 0 || samplesPerFace == 0) return out;

  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();

  MeasureBox box;
  for (std::size_t i = 0; i + 2 < xyz.size(); i += 3) box.grow(&xyz[i]);
  const double diagonal = box.diagonal();
  if (!(diagonal > 0.0)) return out;
  // The ray starts just inside the surface so it cannot hit the triangle it was
  // launched from, and stops at the part's own diagonal — no wall is thicker
  // than that, and an unbounded ray would report a hit on the far side of a
  // neighbouring body.
  const double startOffset = 1e-6 * diagonal;
  const double maxRange = diagonal * 1.000001;

  MeshRayIndex index;
  index.build(mesh);

  std::map<std::uint32_t, std::vector<std::size_t>> byFace;
  for (std::size_t t = 0; t < ids.size(); ++t) byFace[ids[t]].push_back(t);

  out.measured = true;
  bool anyHit = false;
  for (const auto& [id, tris] : byFace) {
    FaceThickness ft;
    ft.faceId = id;
    const std::size_t take = std::min(samplesPerFace, tris.size());
    // Spread the samples through the triangle list rather than taking the first
    // N: the first N triangles of a long cylindrical wall are all in one strip,
    // and would measure one place on the part very precisely.
    const std::size_t stride = std::max<std::size_t>(1, tris.size() / std::max<std::size_t>(1, take));
    double sum = 0.0;
    for (std::size_t s = 0; s < take; ++s) {
      const std::size_t t = tris[std::min(s * stride, tris.size() - 1)];
      const double* p = &xyz[t * 9];
      double n[3];
      triangleNormal(p, n);
      if (!unit3(n)) continue;
      double c[3];
      for (std::size_t k = 0; k < 3; ++k) c[k] = (p[k] + p[3 + k] + p[6 + k]) / 3.0;
      // INTO the material is -n for an outward-wound closed mesh.
      double dir[3] = {-n[0], -n[1], -n[2]};
      double origin[3];
      for (std::size_t k = 0; k < 3; ++k) origin[k] = c[k] + dir[k] * startOffset;
      ++ft.samples;
      ++out.samplesRequested;
      ++out.samplesTaken;
      const RayHit hit = index.cast(mesh, origin, dir, 0.0, maxRange);
      if (!hit.hit) continue;
      const double thickness = hit.distance + startOffset;
      ++ft.hits;
      ++out.rayHits;
      sum += thickness;
      if (ft.hits == 1 || thickness < ft.minThickness) {
        ft.minThickness = thickness;
        for (std::size_t k = 0; k < 3; ++k) ft.minPoint[k] = c[k];
      }
      ft.maxThickness = ft.hits == 1 ? thickness : std::max(ft.maxThickness, thickness);
      if (!anyHit || thickness < out.minThickness) {
        anyHit = true;
        out.minThickness = thickness;
        out.minFace = id;
        for (std::size_t k = 0; k < 3; ++k) out.minPoint[k] = c[k];
      }
    }
    if (ft.hits > 0) ft.meanThickness = sum / static_cast<double>(ft.hits);
    else ++out.facesWithoutHits;
    out.faces.push_back(ft);
  }
  return out;
}

// ── export ──────────────────────────────────────────────────────────────────
std::string analysisText(const SectionResult& s) {
  if (!s.measured) return "section unavailable — the plane normal has no length\n";
  std::string out;
  out += "cut segments   " + std::to_string(s.segments) + "\n";
  out += "closed loops   " + std::to_string(s.loops);
  if (s.openChains > 0) out += "  (" + std::to_string(s.openChains) + " open chain(s))";
  out += "\n";
  out += "perimeter      " + fmt(s.perimeter) + " mm\n";
  out += "section area   " + fmt(s.area) + " mm2\n";
  out += "triangles      " + std::to_string(s.trianglesAbove) + " above / " +
         std::to_string(s.trianglesBelow) + " below / " + std::to_string(s.trianglesCut) +
         " cut\n";
  return out;
}

std::string analysisText(const DraftAnalysis& d) {
  if (!d.measured) return "draft unavailable — the pull direction has no length\n";
  std::string out;
  out += "pull           " + vec3(d.pull) + "\n";
  out += "required       " + fmt(d.requiredDegrees) + " deg\n";
  out += "positive       " + std::to_string(d.countPositive) + " faces, " +
         fmt(d.areaPositive) + " mm2\n";
  out += "negative       " + std::to_string(d.countNegative) + " faces, " +
         fmt(d.areaNegative) + " mm2\n";
  out += "INSUFFICIENT   " + std::to_string(d.countInsufficient) + " faces, " +
         fmt(d.areaInsufficient) + " mm2\n";
  if (d.countDegenerate > 0) {
    out += "degenerate     " + std::to_string(d.countDegenerate) + " faces\n";
  }
  if (d.worstFace != kNoFace) {
    out += "worst face     " + std::to_string(d.worstFace) + "\n";
  }
  return out;
}

std::string analysisText(const CurvatureAnalysis& c) {
  if (!c.measured) return "curvature unavailable — the mesh has no triangles\n";
  std::string out;
  out += "faces          " + std::to_string(c.faces.size()) + "\n";
  out += "face joins     " + std::to_string(c.joins.size()) + "\n";
  out += "tangent joins  " + std::to_string(c.tangentJoins) + " (within " +
         fmt(c.tangentToleranceDegrees) + " deg)\n";
  out += "sharp joins    " + std::to_string(c.sharpJoins) + "\n";
  out += "sharpest       " + fmt(c.sharpestJoinDegrees) + " deg\n";
  bool anyRadius = false;
  double tightest = 0.0;
  std::uint32_t tightestFace = kNoFace;
  for (const FaceCurvature& f : c.faces) {
    if (!f.hasCurvature) continue;
    if (!anyRadius || f.curvatureRadius < tightest) {
      anyRadius = true;
      tightest = f.curvatureRadius;
      tightestFace = f.faceId;
    }
  }
  if (anyRadius) {
    out += "tightest radius " + fmt(tightest) + " mm (face " + std::to_string(tightestFace) +
           ", mean-curvature radius)\n";
  } else {
    // Not "radius 0". A part of planes HAS no curvature radius, and printing one
    // would be a fabricated measurement.
    out += "tightest radius none — every face is planar within tolerance\n";
  }
  return out;
}

std::string analysisText(const ThicknessAnalysis& t) {
  if (!t.measured) return "thickness unavailable — the mesh has no triangles\n";
  std::string out;
  out += "samples        " + std::to_string(t.samplesTaken) + " cast, " +
         std::to_string(t.rayHits) + " found a far wall\n";
  if (t.rayHits == 0) {
    out += "min thickness  none measured — no ray found an opposite wall\n";
    return out;
  }
  out += "min thickness  " + fmt(t.minThickness) + " mm at face " + std::to_string(t.minFace) +
         " " + vec3(t.minPoint) + "\n";
  if (t.facesWithoutHits > 0) {
    out += "no far wall    " + std::to_string(t.facesWithoutHits) + " face(s)\n";
  }
  return out;
}

std::string draftCsv(const DraftAnalysis& d) {
  std::string out = "faceId,angleDeg,class,area,uniform,minTriangleDeg,maxTriangleDeg\n";
  for (const FaceDraft& f : d.faces) {
    out += std::to_string(f.faceId) + "," + fmt(f.angleDegrees) + "," + toString(f.cls) + "," +
           fmt(f.area) + "," + (f.uniform ? "1" : "0") + "," + fmt(f.minTriangleAngle) + "," +
           fmt(f.maxTriangleAngle) + "\n";
  }
  return out;
}

std::string thicknessCsv(const ThicknessAnalysis& t) {
  std::string out = "faceId,samples,hits,minThickness,maxThickness,meanThickness,mx,my,mz\n";
  for (const FaceThickness& f : t.faces) {
    out += std::to_string(f.faceId) + "," + std::to_string(f.samples) + "," +
           std::to_string(f.hits) + ",";
    // Empty cells, not zeros: a face where no ray found a far wall has no
    // thickness, and 0 is a number a spreadsheet will happily take a minimum of.
    if (f.hits > 0) {
      out += fmt(f.minThickness) + "," + fmt(f.maxThickness) + "," + fmt(f.meanThickness) + "," +
             fmt(f.minPoint[0]) + "," + fmt(f.minPoint[1]) + "," + fmt(f.minPoint[2]);
    } else {
      out += ",,,,,";
    }
    out += "\n";
  }
  return out;
}

}  // namespace forge::ui
