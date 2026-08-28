// forge-desktop/src/KernelScene.hpp
//
// The ONE seam between the Forge desktop application and the geometry kernel.
//
// Everything the app draws in the viewport comes through here, and NOTHING else
// in forge-desktop includes an OCCT or forge-kernel header. That matters for two
// reasons: the ImGui frame builder stays compilable and testable without a
// kernel, and the "which kernel backend produced this body" question stays where
// ShapeRegistry already answers it.
//
// The scene owns a real feature history — a box, a through-bore cut, and a
// fillet on the top edges — built by calling the kernel, tessellated by
// forge::tessellate, and de-indexed into the vertex stream the viewport draws.
//
// DE-INDEXING, and why. forge::Mesh carries `faceIds` PER TRIANGLE (one 1-based
// OCCT face id per triangle, in TopExp_Explorer order). A shared-vertex index
// buffer cannot carry a per-triangle attribute, and the per-face id is exactly
// what face preselection, face selection and sketch-on-face need. Three vertices
// per triangle is the standard resolution and costs a factor of ~2 in vertex
// memory on a typical B-rep mesh; correctness of picking is worth it.
#ifndef FORGE_DESKTOP_KERNELSCENE_HPP
#define FORGE_DESKTOP_KERNELSCENE_HPP

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "forge/ui/FeatureTreeModel.hpp"

namespace forge::desktop {

// One de-indexed vertex, matching shaders/viewport_solid.vert exactly.
struct SceneVertex {
  float px = 0.0f, py = 0.0f, pz = 0.0f;
  float nx = 0.0f, ny = 0.0f, nz = 0.0f;
  std::uint32_t faceId = 0;  // 1-based OCCT face id (0 = unknown)
  std::uint32_t flags = 0;   // bit0 = selected
};

// An axis-aligned bounding box; the camera's "fit" uses it, so it is part of the
// scene's contract rather than something the viewport recomputes.
struct Bounds {
  float min[3] = {0.0f, 0.0f, 0.0f};
  float max[3] = {0.0f, 0.0f, 0.0f};
  bool valid = false;

  void centre(float out[3]) const;
  float radius() const;  // half the diagonal; 0 when !valid
};

// One row of the real feature history the tree panel shows.
struct SceneFeature {
  std::string name;        // persistent name — what a selection stores
  std::string label;       // human label
  std::string irOp;        // feature-IR op this row corresponds to
  std::string detail;      // parameters, for the properties panel
  bool suppressed = false;
  bool ok = true;
};

// The result of a viewport pick: which triangle the ray hit and which face it
// belongs to. `faceId == 0` means the ray missed.
struct PickResult {
  std::uint32_t faceId = 0;
  float distance = 0.0f;
  float point[3] = {0.0f, 0.0f, 0.0f};
  bool hit() const { return faceId != 0; }
};

class KernelScene {
 public:
  KernelScene();

  // Builds the demonstration part through the real kernel and tessellates it.
  // Returns false and fills `error()` if the kernel refused — the app then runs
  // with an empty viewport rather than dying, because a kernel failure must be
  // reportable in the UI, not a crash before the window opens.
  bool build();

  bool built() const noexcept { return built_; }
  const std::string& error() const noexcept { return error_; }
  const std::string& backend() const noexcept { return backend_; }

  const std::vector<SceneVertex>& vertices() const noexcept { return vertices_; }
  std::size_t triangleCount() const noexcept { return vertices_.size() / 3; }
  const Bounds& bounds() const noexcept { return bounds_; }
  std::uint32_t faceCount() const noexcept { return faceCount_; }

  const std::vector<SceneFeature>& features() const noexcept { return features_; }

  // Ray/triangle intersection over the whole mesh (Möller–Trumbore, 1997,
  // "Fast, Minimum Storage Ray/Triangle Intersection", J. Graphics Tools 2(1)).
  // Returns the NEAREST hit, which is what a picking ray means.
  PickResult pick(const float origin[3], const float direction[3]) const;

  // Rewrites the `flags` attribute in place from a set of selected face ids, so
  // the viewport's vertex buffer can be re-uploaded without re-tessellating.
  // Returns the number of vertices whose flags changed.
  std::size_t applySelection(const std::vector<std::uint32_t>& selectedFaceIds);

 private:
  void computeBounds();

  bool built_ = false;
  std::string error_;
  std::string backend_ = "unknown";
  std::vector<SceneVertex> vertices_;
  Bounds bounds_;
  std::uint32_t faceCount_ = 0;
  std::vector<SceneFeature> features_;
};

// ── the feature tree seam ───────────────────────────────────────────────────
// forge::ui::FeatureTreeModel virtualizes over a handle-based source. This is
// the source backed by a KernelScene: the document root, the real features under
// it, and one child row per B-rep face under the last feature — which is what
// makes the row count large enough for the virtualization to be doing real work
// on a real part rather than on a synthetic fixture.
class SceneFeatureTreeSource final : public forge::ui::FeatureTreeSource {
 public:
  explicit SceneFeatureTreeSource(const KernelScene& scene);

  forge::ui::NodeId rootId() const override;
  std::size_t childCount(forge::ui::NodeId parent) const override;
  forge::ui::NodeId childAt(forge::ui::NodeId parent, std::size_t index) const override;
  forge::ui::FeatureNodeData data(forge::ui::NodeId id) const override;

  // How many times the EXPENSIVE fetch actually ran — the virtualization claim
  // is only meaningful if something counts it.
  std::size_t fetches() const noexcept { return fetches_; }
  void resetFetches() noexcept { fetches_ = 0; }

  // Maps a node id back to the face id it names, 0 when the node is not a face.
  std::uint32_t faceIdOf(forge::ui::NodeId id) const;
  // The node id for a given 1-based face id.
  forge::ui::NodeId nodeForFace(std::uint32_t faceId) const;

 private:
  const KernelScene& scene_;
  mutable std::size_t fetches_ = 0;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_KERNELSCENE_HPP
