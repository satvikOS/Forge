#include "forge/ui/StudyField.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

namespace {

// The six faces of one brick, each wound so that its normal points OUT of the
// brick, in the mesher's node order (see StudyField.hpp). The direction index is
// the face's outward axis: 0 = -x, 1 = +x, 2 = -y, 3 = +y, 4 = -z, 5 = +z -- the
// same numbering the solver uses for the sides of the bounding box.
struct BrickFace {
  int corner[4];
  int direction;
};
constexpr BrickFace kBrickFaces[6] = {
    {{0, 4, 7, 3}, 0},  // -x
    {{1, 2, 6, 5}, 1},  // +x
    {{0, 1, 5, 4}, 2},  // -y
    {{3, 7, 6, 2}, 3},  // +y
    {{0, 3, 2, 1}, 4},  // -z
    {{4, 5, 6, 7}, 5},  // +z
};

struct FaceRecord {
  std::array<std::uint32_t, 4> key;  // the four node ids, sorted
  std::uint32_t brick;
  std::uint8_t face;
};

struct EdgeRecord {
  std::uint32_t lo;
  std::uint32_t hi;
  std::uint8_t direction;
};

const char* axisLetter(int axis) noexcept {
  switch (axis) {
    case 0: return "X";
    case 1: return "Y";
    default: return "Z";
  }
}

}  // namespace

// ── the outside of the mesh ─────────────────────────────────────────────────
StudySurface exteriorOfHexMesh(const std::vector<double>& nodesMm,
                               const std::vector<std::uint32_t>& hexes) {
  StudySurface out;
  if (nodesMm.size() % 3 != 0 || hexes.size() % 8 != 0) return out;
  const std::size_t nNodes = nodesMm.size() / 3;
  for (std::uint32_t id : hexes) {
    if (id >= nNodes) return out;
  }
  const std::size_t nBricks = hexes.size() / 8;

  // Every brick face, keyed on its sorted node ids. Sorting the records puts the
  // two copies of a shared face side by side, so "on the outside" is "a run of
  // length one" -- counted, never guessed from coordinates.
  std::vector<FaceRecord> faces;
  faces.reserve(nBricks * 6);
  for (std::size_t e = 0; e < nBricks; ++e) {
    for (std::uint8_t f = 0; f < 6; ++f) {
      FaceRecord r;
      for (int c = 0; c < 4; ++c) r.key[c] = hexes[e * 8 + kBrickFaces[f].corner[c]];
      std::sort(r.key.begin(), r.key.end());
      r.brick = static_cast<std::uint32_t>(e);
      r.face = f;
      faces.push_back(r);
    }
  }
  std::sort(faces.begin(), faces.end(), [](const FaceRecord& a, const FaceRecord& b) {
    if (a.key != b.key) return a.key < b.key;
    if (a.brick != b.brick) return a.brick < b.brick;
    return a.face < b.face;
  });

  std::vector<EdgeRecord> edgeUses;
  std::vector<std::uint8_t> quadDirection;
  for (std::size_t i = 0; i < faces.size();) {
    std::size_t j = i + 1;
    while (j < faces.size() && faces[j].key == faces[i].key) ++j;
    if (j - i == 1) {
      const FaceRecord& r = faces[i];
      const BrickFace& bf = kBrickFaces[r.face];
      std::uint32_t q[4];
      for (int c = 0; c < 4; ++c) q[c] = hexes[static_cast<std::size_t>(r.brick) * 8 + bf.corner[c]];
      for (int c = 0; c < 4; ++c) out.quads.push_back(q[c]);
      quadDirection.push_back(static_cast<std::uint8_t>(bf.direction));
      for (int c = 0; c < 4; ++c) {
        const std::uint32_t a = q[c];
        const std::uint32_t b = q[(c + 1) % 4];
        EdgeRecord er;
        er.lo = std::min(a, b);
        er.hi = std::max(a, b);
        er.direction = static_cast<std::uint8_t>(bf.direction);
        edgeUses.push_back(er);
      }
    }
    i = j;
  }

  // Each distinct edge once. It is a crease when the outside faces that use it do
  // not all face the same way.
  std::sort(edgeUses.begin(), edgeUses.end(), [](const EdgeRecord& a, const EdgeRecord& b) {
    if (a.lo != b.lo) return a.lo < b.lo;
    if (a.hi != b.hi) return a.hi < b.hi;
    return a.direction < b.direction;
  });
  for (std::size_t i = 0; i < edgeUses.size();) {
    std::size_t j = i + 1;
    bool turns = false;
    while (j < edgeUses.size() && edgeUses[j].lo == edgeUses[i].lo &&
           edgeUses[j].hi == edgeUses[i].hi) {
      if (edgeUses[j].direction != edgeUses[i].direction) turns = true;
      ++j;
    }
    out.edges.push_back(edgeUses[i].lo);
    out.edges.push_back(edgeUses[i].hi);
    if (turns) {
      out.creases.push_back(edgeUses[i].lo);
      out.creases.push_back(edgeUses[i].hi);
    }
    i = j;
  }
  out.nodesMm = nodesMm;
  return out;
}

// ── a mode shape ────────────────────────────────────────────────────────────
bool normaliseModeShape(std::vector<double>& shape, std::size_t nodeCount,
                        std::uint32_t& peakNode) {
  if (nodeCount == 0 || shape.size() != nodeCount * 3) return false;
  double best = 0.0;
  std::size_t at = 0;
  for (std::size_t n = 0; n < nodeCount; ++n) {
    const double x = shape[3 * n], y = shape[3 * n + 1], z = shape[3 * n + 2];
    if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return false;
    const double m = x * x + y * y + z * z;
    if (m > best) {
      best = m;
      at = n;
    }
  }
  if (!(best > 0.0)) return false;
  // The sign: the furthest-moving node's largest component points the positive
  // way. Ties go to the lower axis, so the choice is deterministic.
  int axis = 0;
  for (int c = 1; c < 3; ++c) {
    if (std::fabs(shape[3 * at + c]) > std::fabs(shape[3 * at + axis])) axis = c;
  }
  double scale = 1.0 / std::sqrt(best);
  if (shape[3 * at + axis] < 0.0) scale = -scale;
  for (double& v : shape) v *= scale;
  peakNode = static_cast<std::uint32_t>(at);
  return true;
}

ModeMotion classifyModeMotion(const std::vector<double>& nodesMm,
                              const std::vector<double>& unitShape) {
  ModeMotion m;
  if (nodesMm.empty() || nodesMm.size() % 3 != 0 || unitShape.size() != nodesMm.size()) return m;
  const std::size_t n = nodesMm.size() / 3;

  double lo[3] = {nodesMm[0], nodesMm[1], nodesMm[2]};
  double hi[3] = {nodesMm[0], nodesMm[1], nodesMm[2]};
  for (std::size_t i = 0; i < n; ++i) {
    for (int c = 0; c < 3; ++c) {
      lo[c] = std::min(lo[c], nodesMm[3 * i + c]);
      hi[c] = std::max(hi[c], nodesMm[3 * i + c]);
    }
  }
  int a = 0;
  for (int c = 1; c < 3; ++c) {
    if (hi[c] - lo[c] > hi[a] - lo[a]) a = c;
  }
  m.longAxis = a;
  const int b = (a + 1) % 3, c = (a + 2) % 3;
  const double cb = 0.5 * (lo[b] + hi[b]);
  const double cc = 0.5 * (lo[c] + hi[c]);

  double sq[3] = {0.0, 0.0, 0.0};
  for (std::size_t i = 0; i < n; ++i) {
    for (int k = 0; k < 3; ++k) sq[k] += unitShape[3 * i + k] * unitShape[3 * i + k];
  }
  const double total = sq[0] + sq[1] + sq[2];
  if (!(total > 0.0) || !std::isfinite(total)) return m;
  for (int k = 0; k < 3; ++k) m.share[k] = sq[k] / total;

  // ── the twist, slice by slice ─────────────────────────────────────────────
  // Nodes sorted along the long axis; a slice is a run whose positions agree to
  // a billionth of the part's length.
  std::vector<std::size_t> order(n);
  for (std::size_t i = 0; i < n; ++i) order[i] = i;
  std::sort(order.begin(), order.end(), [&](std::size_t p, std::size_t q) {
    return nodesMm[3 * p + a] < nodesMm[3 * q + a];
  });
  const double tol = 1e-9 * std::max(hi[a] - lo[a], 1e-300);
  double explained = 0.0;
  for (std::size_t i = 0; i < n;) {
    std::size_t j = i;
    double dot = 0.0, rr = 0.0;
    const double at = nodesMm[3 * order[i] + a];
    while (j < n && nodesMm[3 * order[j] + a] - at <= tol) {
      const std::size_t p = order[j];
      // r = e_a x d: the motion of a unit turn of this slice about the axis.
      const double rb = -(nodesMm[3 * p + c] - cc);
      const double rc = nodesMm[3 * p + b] - cb;
      dot += unitShape[3 * p + b] * rb + unitShape[3 * p + c] * rc;
      rr += rb * rb + rc * rc;
      ++j;
    }
    if (rr > 0.0) explained += dot * dot / rr;
    i = j;
  }
  m.twist = std::clamp(explained / total, 0.0, 1.0);

  // ── the character ─────────────────────────────────────────────────────────
  const int side = (m.share[b] >= m.share[c]) ? b : c;
  int dominant = 0;
  for (int k = 1; k < 3; ++k) {
    if (m.share[k] > m.share[dominant]) dominant = k;
  }
  if (m.twist >= kModeTwistThreshold) {
    m.character = ModeCharacter::Twisting;
    m.direction = a;
  } else if (m.share[a] >= kModeShareThreshold) {
    m.character = ModeCharacter::Stretching;
    m.direction = a;
  } else if (m.share[b] + m.share[c] >= kModeShareThreshold) {
    m.character = ModeCharacter::Bending;
    m.direction = side;
    m.singleDirection = m.share[side] >= kModeShareThreshold;
  } else {
    m.character = ModeCharacter::Mixed;
    m.direction = dominant;
  }
  return m;
}

std::string ModeMotion::describe() const {
  switch (character) {
    case ModeCharacter::Bending: {
      if (singleDirection) return std::string("bends along ") + axisLetter(direction);
      const int first = std::min((longAxis + 1) % 3, (longAxis + 2) % 3);
      const int second = std::max((longAxis + 1) % 3, (longAxis + 2) % 3);
      return std::string("bends along ") + axisLetter(first) + " and " + axisLetter(second);
    }
    case ModeCharacter::Twisting:
      return std::string("twists about ") + axisLetter(direction);
    case ModeCharacter::Stretching:
      return std::string("stretches along ") + axisLetter(direction);
    case ModeCharacter::Mixed:
      break;
  }
  return std::string("moves mostly along ") + axisLetter(direction);
}

double modeDisplayAmplitudeMm(double longestSideMm) noexcept {
  if (!(longestSideMm > 0.0) || !std::isfinite(longestSideMm)) return 0.0;
  return kModeDisplayFraction * longestSideMm;
}

std::vector<Segment3> modeShapeSegments(const StudySurface& surface,
                                        const std::vector<double>& unitShape,
                                        double amplitudeMm, double phaseRad,
                                        bool creasesOnly) {
  std::vector<Segment3> out;
  const std::size_t n = surface.nodeCount();
  if (n == 0 || unitShape.size() != n * 3) return out;
  if (!std::isfinite(amplitudeMm) || !std::isfinite(phaseRad)) return out;
  const double s = amplitudeMm * std::sin(phaseRad);
  const std::vector<std::uint32_t>& list = creasesOnly ? surface.creases : surface.edges;
  out.reserve(list.size() / 2);
  for (std::size_t i = 0; i + 1 < list.size(); i += 2) {
    const std::uint32_t p = list[i], q = list[i + 1];
    if (p >= n || q >= n) return std::vector<Segment3>();
    Segment3 seg;
    for (int c = 0; c < 3; ++c) {
      seg.a[c] = surface.nodesMm[3 * p + c] + s * unitShape[3 * p + c];
      seg.b[c] = surface.nodesMm[3 * q + c] + s * unitShape[3 * q + c];
    }
    out.push_back(seg);
  }
  return out;
}

// ── a temperature field ─────────────────────────────────────────────────────
Rgb temperatureColour(double temperature, double coldest, double hottest) noexcept {
  // Three stops: a cool blue, a neutral near-white, a warm red.
  constexpr Rgb kCold{0.23f, 0.30f, 0.75f};
  constexpr Rgb kMid{0.87f, 0.87f, 0.87f};
  constexpr Rgb kHot{0.71f, 0.02f, 0.15f};
  const double span = hottest - coldest;
  if (!(span > 0.0) || !std::isfinite(span) || !std::isfinite(temperature)) {
    return Rgb{1.0f, 1.0f, 1.0f};
  }
  double t = (temperature - coldest) / span;
  t = std::clamp(t, 0.0, 1.0);
  const Rgb& a = (t < 0.5) ? kCold : kMid;
  const Rgb& b = (t < 0.5) ? kMid : kHot;
  const float w = static_cast<float>((t < 0.5) ? t * 2.0 : (t - 0.5) * 2.0);
  return Rgb{a.r + (b.r - a.r) * w, a.g + (b.g - a.g) * w, a.b + (b.b - a.b) * w};
}

}  // namespace forge::ui
