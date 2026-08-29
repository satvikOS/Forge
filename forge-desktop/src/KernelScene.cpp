#include "KernelScene.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <string>
#include <vector>

#include "PartFile.hpp"

// The kernel. These are the ONLY forge-kernel/OCCT includes in the whole desktop
// application; see KernelScene.hpp for why that is deliberate.
#include "forge/Booleans.hpp"
#include "forge/Tessellate.hpp"
#include "forge/ft/FeatureTree.hpp"

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
  // The starting part IS a document: the same statements ForgeFrame seeds the
  // PartDocument with, compiled through the same edge every later edit takes.
  const bool ok = buildFromIr(defaultPartIr());
  std::vector<SceneFeature> rows;
  for (const SeedStatement& st : defaultPartStatements()) {
    SceneFeature f;
    f.name = st.node.empty() ? ("value_" + std::to_string(st.line.id)) : st.node;
    f.label = st.label;
    f.irOp = st.line.op;
    f.detail = st.detail;
    f.ok = ok || (report_.failedOpId != st.line.id && report_.failedLine != st.line.id);
    rows.push_back(std::move(f));
  }
  setFeatureRows(std::move(rows));
  return ok;
}

void KernelScene::setFeatureRows(std::vector<SceneFeature> rows) { features_ = std::move(rows); }

void KernelScene::setDocumentLabel(std::string label) {
  documentLabel_ = label.empty() ? std::string("untitled.fpart") : std::move(label);
}

// -- THE EDGE ---------------------------------------------------------------
// forge::ui's IR program -> forge::ft -> a solid -> triangles -> the viewport.
bool KernelScene::buildFromIr(const std::string& program) {
  report_ = IrBuildReport{};

  // ---- parse, with the KERNEL's parser ------------------------------------
  forge::ft::FeatureTree tree;
  try {
    tree = forge::ft::parse(program);
    report_.parsed = true;
  } catch (const forge::ft::ParseError& e) {
    report_.error = "parse failed at line " + std::to_string(e.line) + ": " + e.what();
    report_.failedLine = e.line;
    error_ = report_.error;
    return false;
  } catch (const std::exception& e) {
    report_.error = std::string("parse failed: ") + e.what();
    error_ = report_.error;
    return false;
  } catch (...) {
    report_.error = "parse failed: a non-std exception escaped forge::ft::parse";
    error_ = report_.error;
    return false;
  }

  // ---- compile it into a solid --------------------------------------------
  //
  // forge::ft::compile is documented "Never throws for a modelling failure".
  // MEASURED FALSE on this build: SHELL(%5, 3) on the default bracket lets an
  // OCCT Standard_ConstructionError escape. That is NOT a std::exception, so a
  // catch (const std::exception&) would miss it and std::terminate would take
  // the whole application down on a menu click. Hence catch (...).
  forge::ft::CompileResult res;
  try {
    // Each independent body gets its own boolean budget window; see
    // Booleans.hpp for why sharing one across a batch is a measured bug.
    forge::resetBooleanBudget();
    res = forge::ft::compile(tree);
  } catch (const std::exception& e) {
    report_.error = std::string("compile threw: ") + e.what();
    error_ = report_.error;
    return false;
  } catch (...) {
    report_.error = "compile threw a non-std exception (an OCCT Standard_Failure)";
    error_ = report_.error;
    return false;
  }

  report_.nDeclared = res.nDeclared;
  report_.nParsed = res.nParsed;
  report_.nCompiled = res.nCompiled;
  report_.failedOpId = res.failedOpId;
  if (!res.ok || res.handle == 0) {
    report_.error = res.error.empty() ? std::string("the kernel produced no solid") : res.error;
    error_ = report_.error;
    return false;
  }
  report_.compiled = true;
  report_.valid = res.valid;
  report_.faceCount = res.faceCount;
  report_.edgeCount = res.edgeCount;
  report_.volume = res.volume;
  for (int i = 0; i < 3; ++i) {
    report_.bboxMin[i] = res.bboxMin[i];
    report_.bboxMax[i] = res.bboxMax[i];
  }

  // ---- tessellate ---------------------------------------------------------
  forge::Mesh mesh;
  try {
    mesh = forge::tessellate(res.handle, kLinearTol, kAngularTol);
  } catch (const std::exception& e) {
    report_.error = std::string("tessellate failed: ") + e.what();
    error_ = report_.error;
    return false;
  } catch (...) {
    report_.error = "tessellate failed: a non-std exception escaped forge::tessellate";
    error_ = report_.error;
    return false;
  }
  if (mesh.indices.empty() || mesh.indices.size() % 3 != 0) {
    report_.error = "tessellate returned no triangles";
    error_ = report_.error;
    return false;
  }

  // ---- de-index into the viewport's vertex stream -------------------------
  // Into a LOCAL buffer: a rebuild that fails must leave the last good body on
  // screen, not half of a new one.
  std::vector<SceneVertex> next;
  std::uint32_t faces = 0;
  std::string why;
  if (!deindex(mesh, next, faces, why)) {
    report_.error = why;
    error_ = why;
    return false;
  }

  vertices_ = std::move(next);
  faceCount_ = faces;
  computeBounds();
  report_.tessellated = true;
  report_.triangles = triangleCount();
  built_ = true;
  error_.clear();
  ++builds_;
  backend_ = "forge::ui -> forge::ft -> forge-kernel (" + std::to_string(res.nCompiled) +
             " ops, " + std::to_string(res.faceCount) + " faces)";
  return true;
}

bool KernelScene::deindex(const forge::Mesh& mesh, std::vector<SceneVertex>& out,
                          std::uint32_t& faceCount, std::string& error) const {
  const std::size_t triCount = mesh.indices.size() / 3;
  const bool haveFaceIds = mesh.faceIds.size() == triCount;
  const bool haveNormals = mesh.normals.size() == mesh.positions.size();
  out.assign(triCount * 3, SceneVertex{});
  faceCount = 0;

  for (std::size_t t = 0; t < triCount; ++t) {
    const std::uint32_t faceId = haveFaceIds ? mesh.faceIds[t] : 0u;
    faceCount = std::max(faceCount, faceId);

    // Geometric normal, used when the kernel supplied none, and as the fallback
    // for a degenerate vertex normal.
    float p[3][3] = {};
    for (int c = 0; c < 3; ++c) {
      const std::uint32_t vi = mesh.indices[t * 3 + static_cast<std::size_t>(c)];
      const std::size_t base = static_cast<std::size_t>(vi) * 3;
      if (base + 2 >= mesh.positions.size()) {
        error = "tessellate produced an out-of-range index";
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
      SceneVertex& v = out[t * 3 + static_cast<std::size_t>(c)];
      v.px = p[c][0];
      v.py = p[c][1];
      v.pz = p[c][2];
      if (haveNormals) {
        float n[3] = {mesh.normals[base + 0], mesh.normals[base + 1], mesh.normals[base + 2]};
        const float len2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
        if (len2 > 1e-12f) {
          normalize3(n);
          v.nx = n[0];
          v.ny = n[1];
          v.nz = n[2];
        } else {
          v.nx = gn[0];
          v.ny = gn[1];
          v.nz = gn[2];
        }
      } else {
        v.nx = gn[0];
        v.ny = gn[1];
        v.nz = gn[2];
      }
      v.faceId = faceId;
      v.flags = 0;
    }
  }
  error.clear();
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
    d.label = scene_.documentLabel();
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
