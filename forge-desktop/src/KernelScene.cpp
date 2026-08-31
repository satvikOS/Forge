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
  // GEOMETRY ONLY -- the history rows are the document's records, which the tree
  // source reads directly; this used to also fill a private SceneFeature vector
  // that ForgeFrame then overwrote with a re-derived copy of the same table.
  return buildFromIr(defaultPartIr());
}

void KernelScene::setDocumentLabel(std::string label) {
  documentLabel_ = label.empty() ? std::string("untitled.fpart") : std::move(label);
}

// -- THE EDGE ---------------------------------------------------------------
// forge::ui's IR program -> forge::ft -> a solid -> triangles -> the viewport.
//
// ONE entry point, TWO ways to reach the kernel. Which one runs is a property of
// the SCENE (was an isolated worker configured?), never of the call site, so no
// caller can forget to ask for isolation and no gate has to be rewritten to get
// it. With no worker configured this is exactly the function it always was.
bool KernelScene::buildFromIr(const std::string& program) {
  if (session_.workerConfigured()) {
    bool fellBack = false;
    const bool ok = buildIsolated(program, fellBack);
    if (!fellBack) return ok;
    // The worker could not be LAUNCHED (missing binary, exhausted process
    // table). That is an isolation failure, not a geometry failure, and refusing
    // to model at all would be worse than modelling unprotected: an application
    // shipped without its worker must still be an application. A crash is NEVER
    // retried here -- re-running it in this process is the outcome the whole
    // mechanism exists to prevent.
    ++isolatedFallbacks_;
  }
  return buildInProcess(program);
}

bool KernelScene::buildInProcess(const std::string& program) {
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

// ── SceneFeatureTreeSource ────────────────────────────────────────
//
// Node id encoding, chosen so childAt/rootId stay O(1) and allocation-free:
//   1                       = the document root
//   2 + i                   = the document's i-th FeatureRecord
//   1000 + faceId           = the B-rep face with that 1-based id
namespace {
constexpr forge::ui::NodeId kRootNode = 1;
constexpr forge::ui::NodeId kFeatureBase = 2;
constexpr forge::ui::NodeId kFaceBase = 1000;
}  // namespace

SceneFeatureTreeSource::SceneFeatureTreeSource(const KernelScene& scene,
                                               const forge::ui::PartDocument& document)
    : scene_(scene), document_(document) {}

std::size_t SceneFeatureTreeSource::featureCount() const noexcept {
  return document_.records().size();
}

forge::ui::NodeId SceneFeatureTreeSource::rootId() const { return kRootNode; }

std::size_t SceneFeatureTreeSource::childCount(forge::ui::NodeId parent) const {
  const std::size_t features = featureCount();
  if (parent == kRootNode) return features;
  if (features > 0 && parent >= kFeatureBase && parent < kFeatureBase + features) {
    // Only the LAST feature owns the resulting body's faces.
    if (parent == kFeatureBase + features - 1) return scene_.faceCount();
    return 0;
  }
  return 0;
}

forge::ui::NodeId SceneFeatureTreeSource::childAt(forge::ui::NodeId parent,
                                                  std::size_t index) const {
  if (parent == kRootNode) return kFeatureBase + static_cast<forge::ui::NodeId>(index);
  return kFaceBase + static_cast<forge::ui::NodeId>(index) + 1;
}

forge::ui::NodeId SceneFeatureTreeSource::nodeForFeature(std::size_t index) const {
  return kFeatureBase + static_cast<forge::ui::NodeId>(index);
}

const forge::ui::FeatureRecord* SceneFeatureTreeSource::recordAt(forge::ui::NodeId id) const {
  const std::vector<forge::ui::FeatureRecord>& records = document_.records();
  if (id < kFeatureBase || id >= kFeatureBase + records.size()) return nullptr;
  return &records[static_cast<std::size_t>(id - kFeatureBase)];
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
  if (const forge::ui::FeatureRecord* rec = recordAt(id)) {
    // THE ROW IS THE STATEMENT. Everything below is read off the record the
    // document holds -- no copy, no setter, nothing to forget to refresh.
    d.label = rec->label.empty() ? rec->line.op : rec->label;
    d.iconKey = rec->line.op;
    d.featureIrOp = rec->line.op;
    // A row is in error when the last rebuild named it, or when a rebuild that
    // failed before naming an op leaves every statement unaccounted for.
    const IrBuildReport& r = scene_.lastBuild();
    const bool named = (r.failedOpId == rec->irId) || (r.failedLine == rec->irId);
    d.state = (r.ok() || !named) ? forge::ui::FeatureState::Ok : forge::ui::FeatureState::Error;
    return d;
  }
  const std::uint32_t faceId = static_cast<std::uint32_t>(id - kFaceBase);
  d.label = "Face " + std::to_string(faceId);
  d.iconKey = "face";
  d.featureIrOp = "FACE";
  return d;
}

int SceneFeatureTreeSource::featureIrIdOf(forge::ui::NodeId id) const {
  // The row count comes from the DOCUMENT, not from a second history on the
  // scene: KernelScene::features() was removed when the rows became the IR
  // statements themselves (see the header note above the class). This call site
  // was the one left behind, and nothing caught it because at the time NO CI
  // job compiled the forge-desktop project. One does now: the `desktop` job in
  // .github/workflows/kernel-tests.yml, whose negative control is this exact
  // call site. featureCount() is document_.records().size(), which is the same
  // number childCount() bounds the feature rows by.
  const std::size_t features = featureCount();
  if (id < kFeatureBase || id >= kFeatureBase + features) return 0;
  return static_cast<int>(id - kFeatureBase) + 1;
}

std::uint32_t SceneFeatureTreeSource::faceIdOf(forge::ui::NodeId id) const {
  if (id < kFaceBase) return 0;
  return static_cast<std::uint32_t>(id - kFaceBase);
}

forge::ui::NodeId SceneFeatureTreeSource::nodeForFace(std::uint32_t faceId) const {
  return kFaceBase + faceId;
}

}  // namespace forge::desktop
