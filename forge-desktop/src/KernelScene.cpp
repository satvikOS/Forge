#include "KernelScene.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <string>
#include <vector>

// The kernel. These four headers are the ONLY forge-kernel/OCCT includes in the
// whole desktop application; see KernelScene.hpp for why that is deliberate.
#include "forge/Booleans.hpp"
#include "forge/Features.hpp"
#include "forge/Primitives.hpp"
#include "forge/Tessellate.hpp"
#include "forge/Transform.hpp"

namespace forge::desktop {
namespace {

// Tessellation tolerances. 0.05 mm linear / 0.35 rad angular is the deflection
// pair the kernel's own mesh probe uses for a display mesh: fine enough that a
// 12 mm bore reads as round, coarse enough to stay interactive.
constexpr double kLinearTol = 0.05;
constexpr double kAngularTol = 0.35;

void normalize3(float v[3]) {
  const float len = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len > 1e-20f) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }
}

}  // namespace

// ── Bounds ──────────────────────────────────────────────────────────────────
void Bounds::centre(float out[3]) const {
  for (int i = 0; i < 3; ++i) out[i] = 0.5f * (min[i] + max[i]);
}

float Bounds::radius() const {
  if (!valid) return 0.0f;
  float d = 0.0f;
  for (int i = 0; i < 3; ++i) {
    const float e = max[i] - min[i];
    d += e * e;
  }
  return 0.5f * std::sqrt(d);
}

// ── KernelScene ─────────────────────────────────────────────────────────────
KernelScene::KernelScene() = default;

bool KernelScene::build() {
  vertices_.clear();
  features_.clear();
  faceCount_ = 0;
  built_ = false;
  error_.clear();

  forge::Mesh mesh;
  try {
    // Each independent body gets its own boolean budget window; see
    // Booleans.hpp for why sharing one across a batch is a measured bug.
    forge::resetBooleanBudget();

    // ── the feature history, built through the real kernel ────────────────
    // A bracket: an 80x50x20 plate, a 12 mm through bore, and a 3 mm fillet on
    // the vertical corner edges. Three real features, each a real kernel call.
    const forge::ShapeHandle plate = forge::makeBox(80.0, 50.0, 20.0);
    features_.push_back(SceneFeature{"plate", "Plate  80 x 50 x 20", "BOX",
                                     "dx=80  dy=50  dz=20", false, true});

    const forge::ShapeHandle tool = forge::translate(
        forge::makeCylinder(6.0, 40.0), 40.0, 25.0, -10.0);
    const forge::ShapeHandle bored = forge::cut(plate, tool);
    features_.push_back(SceneFeature{"bore", "Through Bore  d12", "CUT",
                                     "diameter=12  through  at (40, 25)", false, true});

    // Fillet the four vertical corner edges. Which edge ids those are depends on
    // the boolean's output ordering, so this asks the kernel and DEGRADES
    // HONESTLY: a fillet the kernel refuses becomes an Error row in the tree,
    // not a crash and not a silent omission.
    forge::ShapeHandle body = bored;
    bool filleted = false;
    std::string filletDetail = "r=3 on 4 vertical corner edges";
    try {
      const std::vector<std::uint32_t> edges{1u, 3u, 5u, 7u};
      body = forge::part::filletEdges(bored, edges, 3.0);
      filleted = true;
    } catch (const std::exception& e) {
      filletDetail = std::string("kernel refused: ") + e.what();
    }
    features_.push_back(SceneFeature{"corner_fillet", "Corner Fillet  r3", "FILLET",
                                     filletDetail, false, filleted});

    mesh = forge::tessellate(body, kLinearTol, kAngularTol);
    backend_ = filleted ? "forge-kernel (BOX -> CUT -> FILLET)"
                        : "forge-kernel (BOX -> CUT)";
  } catch (const std::exception& e) {
    error_ = std::string("kernel build failed: ") + e.what();
    return false;
  }

  if (mesh.indices.empty() || mesh.indices.size() % 3 != 0) {
    error_ = "tessellate returned no triangles";
    return false;
  }

  // ── de-index into the viewport's vertex stream ────────────────────────────
  const std::size_t triCount = mesh.indices.size() / 3;
  const bool haveFaceIds = mesh.faceIds.size() == triCount;
  const bool haveNormals = mesh.normals.size() == mesh.positions.size();
  vertices_.resize(triCount * 3);

  for (std::size_t t = 0; t < triCount; ++t) {
    const std::uint32_t faceId = haveFaceIds ? mesh.faceIds[t] : 0u;
    faceCount_ = std::max(faceCount_, faceId);

    // Geometric normal, used when the kernel supplied none, and as the fallback
    // for a degenerate vertex normal.
    float p[3][3] = {};
    for (int c = 0; c < 3; ++c) {
      const std::uint32_t vi = mesh.indices[t * 3 + static_cast<std::size_t>(c)];
      const std::size_t base = static_cast<std::size_t>(vi) * 3;
      if (base + 2 >= mesh.positions.size()) {
        error_ = "tessellate produced an out-of-range index";
        return false;
      }
      p[c][0] = mesh.positions[base + 0];
      p[c][1] = mesh.positions[base + 1];
      p[c][2] = mesh.positions[base + 2];
    }
    float e1[3] = {p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]};
    float e2[3] = {p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]};
    float gn[3] = {e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
                   e1[0] * e2[1] - e1[1] * e2[0]};
    normalize3(gn);

    for (int c = 0; c < 3; ++c) {
      const std::uint32_t vi = mesh.indices[t * 3 + static_cast<std::size_t>(c)];
      const std::size_t base = static_cast<std::size_t>(vi) * 3;
      SceneVertex& out = vertices_[t * 3 + static_cast<std::size_t>(c)];
      out.px = p[c][0];
      out.py = p[c][1];
      out.pz = p[c][2];
      if (haveNormals) {
        float n[3] = {mesh.normals[base + 0], mesh.normals[base + 1],
                      mesh.normals[base + 2]};
        const float len2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
        if (len2 > 1e-12f) {
          normalize3(n);
          out.nx = n[0];
          out.ny = n[1];
          out.nz = n[2];
        } else {
          out.nx = gn[0];
          out.ny = gn[1];
          out.nz = gn[2];
        }
      } else {
        out.nx = gn[0];
        out.ny = gn[1];
        out.nz = gn[2];
      }
      out.faceId = faceId;
      out.flags = 0;
    }
  }

  computeBounds();
  built_ = true;
  return true;
}

void KernelScene::computeBounds() {
  bounds_ = Bounds{};
  if (vertices_.empty()) return;
  bounds_.min[0] = bounds_.max[0] = vertices_[0].px;
  bounds_.min[1] = bounds_.max[1] = vertices_[0].py;
  bounds_.min[2] = bounds_.max[2] = vertices_[0].pz;
  for (const SceneVertex& v : vertices_) {
    const float p[3] = {v.px, v.py, v.pz};
    for (int i = 0; i < 3; ++i) {
      bounds_.min[i] = std::min(bounds_.min[i], p[i]);
      bounds_.max[i] = std::max(bounds_.max[i], p[i]);
    }
  }
  bounds_.valid = true;
}

// Möller–Trumbore, 1997. Non-culling variant: a CAD pick must hit a back face
// too, because the camera can be inside a shelled body.
PickResult KernelScene::pick(const float origin[3], const float direction[3]) const {
  PickResult best;
  float bestT = 0.0f;
  const std::size_t tris = triangleCount();
  for (std::size_t t = 0; t < tris; ++t) {
    const SceneVertex& a = vertices_[t * 3 + 0];
    const SceneVertex& b = vertices_[t * 3 + 1];
    const SceneVertex& c = vertices_[t * 3 + 2];
    const float e1[3] = {b.px - a.px, b.py - a.py, b.pz - a.pz};
    const float e2[3] = {c.px - a.px, c.py - a.py, c.pz - a.pz};
    const float pv[3] = {direction[1] * e2[2] - direction[2] * e2[1],
                         direction[2] * e2[0] - direction[0] * e2[2],
                         direction[0] * e2[1] - direction[1] * e2[0]};
    const float det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (std::fabs(det) < 1e-12f) continue;  // ray parallel to the triangle
    const float inv = 1.0f / det;
    const float tv[3] = {origin[0] - a.px, origin[1] - a.py, origin[2] - a.pz};
    const float u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
    if (u < 0.0f || u > 1.0f) continue;
    const float qv[3] = {tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2],
                         tv[0] * e1[1] - tv[1] * e1[0]};
    const float v = (direction[0] * qv[0] + direction[1] * qv[1] + direction[2] * qv[2]) * inv;
    if (v < 0.0f || u + v > 1.0f) continue;
    const float hitT = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
    if (hitT <= 1e-6f) continue;  // behind the eye
    if (!best.hit() || hitT < bestT) {
      bestT = hitT;
      best.faceId = a.faceId != 0 ? a.faceId : 1u;
      best.distance = hitT;
      for (int i = 0; i < 3; ++i) best.point[i] = origin[i] + direction[i] * hitT;
    }
  }
  return best;
}

std::size_t KernelScene::applySelection(const std::vector<std::uint32_t>& selectedFaceIds) {
  std::size_t changed = 0;
  for (SceneVertex& v : vertices_) {
    const bool sel = std::find(selectedFaceIds.begin(), selectedFaceIds.end(), v.faceId) !=
                     selectedFaceIds.end();
    const std::uint32_t want = sel ? (v.flags | 1u) : (v.flags & ~1u);
    if (want != v.flags) {
      v.flags = want;
      ++changed;
    }
  }
  return changed;
}

// ── SceneFeatureTreeSource ──────────────────────────────────────────────────
//
// Node id encoding, chosen so childAt/rootId stay O(1) and allocation-free:
//   1                       = the document root
//   2 + i                   = feature i
//   1000 + faceId           = the B-rep face with that 1-based id
namespace {
constexpr forge::ui::NodeId kRootNode = 1;
constexpr forge::ui::NodeId kFeatureBase = 2;
constexpr forge::ui::NodeId kFaceBase = 1000;
}  // namespace

SceneFeatureTreeSource::SceneFeatureTreeSource(const KernelScene& scene) : scene_(scene) {}

forge::ui::NodeId SceneFeatureTreeSource::rootId() const { return kRootNode; }

std::size_t SceneFeatureTreeSource::childCount(forge::ui::NodeId parent) const {
  if (parent == kRootNode) return scene_.features().size();
  const std::size_t featureCount = scene_.features().size();
  if (parent >= kFeatureBase && parent < kFeatureBase + featureCount) {
    // Only the LAST feature owns the resulting body's faces.
    if (parent == kFeatureBase + featureCount - 1) return scene_.faceCount();
    return 0;
  }
  return 0;
}

forge::ui::NodeId SceneFeatureTreeSource::childAt(forge::ui::NodeId parent,
                                                  std::size_t index) const {
  if (parent == kRootNode) return kFeatureBase + static_cast<forge::ui::NodeId>(index);
  return kFaceBase + static_cast<forge::ui::NodeId>(index) + 1;
}

forge::ui::FeatureNodeData SceneFeatureTreeSource::data(forge::ui::NodeId id) const {
  ++fetches_;  // this is the EXPENSIVE call the virtualization exists to bound
  forge::ui::FeatureNodeData d;
  d.id = id;
  if (id == kRootNode) {
    d.label = "Bracket.fpart";
    d.iconKey = "document";
    d.featureIrOp = "DOCUMENT";
    return d;
  }
  const std::size_t featureCount = scene_.features().size();
  if (id >= kFeatureBase && id < kFeatureBase + featureCount) {
    const SceneFeature& f = scene_.features()[id - kFeatureBase];
    d.label = f.label;
    d.iconKey = f.irOp;
    d.featureIrOp = f.irOp;
    d.state = f.suppressed ? forge::ui::FeatureState::Suppressed
                           : (f.ok ? forge::ui::FeatureState::Ok
                                   : forge::ui::FeatureState::Error);
    return d;
  }
  const std::uint32_t faceId = static_cast<std::uint32_t>(id - kFaceBase);
  d.label = "Face " + std::to_string(faceId);
  d.iconKey = "face";
  d.featureIrOp = "FACE";
  return d;
}

std::uint32_t SceneFeatureTreeSource::faceIdOf(forge::ui::NodeId id) const {
  if (id < kFaceBase) return 0;
  return static_cast<std::uint32_t>(id - kFaceBase);
}

forge::ui::NodeId SceneFeatureTreeSource::nodeForFace(std::uint32_t faceId) const {
  return kFaceBase + faceId;
}

}  // namespace forge::desktop
