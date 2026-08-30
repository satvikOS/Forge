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
// The scene owns NO geometry of its own. Every triangle it holds was produced by
// compiling a feature-IR PROGRAM — the one the live PartDocument emits — through
// forge::ft::parse -> forge::ft::compile -> forge::tessellate, and de-indexing
// the result into the vertex stream the viewport draws. Before buildFromIr()
// existed, this class hard-coded its part in C++ (makeBox -> cut -> filletEdges)
// and `build()` was called exactly once, from main.cpp: no user action could
// ever change what the viewport showed.
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

// forge::Mesh lives in forge/Tessellate.hpp, which reaches OCCT headers. This
// header is included by the ImGui frame builder and by every headless gate, so
// it forward-declares the type instead: only KernelScene.cpp may see OCCT.
namespace forge {
struct Mesh;
}  // namespace forge

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

// What the LAST document rebuild did — the reconciliation the app shows instead
// of a silent empty viewport. It carries a VECTOR of observables, never volume
// alone: a wrong solid reproducing a right volume to ten significant figures has
// been measured repeatedly in this programme.
struct IrBuildReport {
  bool parsed = false;
  bool compiled = false;
  bool tessellated = false;
  std::string error;        // empty iff the whole chain succeeded
  int failedOpId = -1;      // the IR statement that failed, or -1
  int failedLine = 0;       // 1-based source line for a PARSE failure, else 0
  bool valid = false;       // watertight / manifold / oriented
  long faceCount = -1;
  long edgeCount = -1;
  double volume = 0.0;
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  // s0.4: a feature declared and parsed but never compiled is a missing feature
  // reported as a built part.
  std::size_t nDeclared = 0;
  std::size_t nParsed = 0;
  std::size_t nCompiled = 0;
  std::size_t triangles = 0;
  bool ok() const noexcept { return parsed && compiled && tessellated && error.empty(); }
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

  // Builds the part a fresh document starts on: defaultPartIr() through the same
  // buildFromIr() every later edit takes, then the matching history rows. There
  // is no second, hand-written construction path — the starting part IS a
  // document.
  //
  // Returns false and fills `error()` if the kernel refused — the app then runs
  // with an empty viewport rather than dying, because a kernel failure must be
  // reportable in the UI, not a crash before the window opens.
  bool build();

  // ── THE EDGE: a feature-IR program -> a solid -> the viewport's vertices ──
  //
  // forge::ft::parse -> forge::ft::compile -> forge::tessellate -> de-index.
  // This is the ONLY way geometry enters the scene, so what the viewport draws
  // is by construction what the document says.
  //
  // On failure the PREVIOUS geometry is KEPT (a rebuild that fails leaves the
  // last good body on screen, as every history-based CAD system does) and the
  // reason lands in lastBuild() and error(). It never throws: forge::ft::compile
  // is documented not to throw for a modelling failure, and that is MEASURED
  // FALSE — `SHELL(%5, 3)` on the default bracket escapes an OCCT
  // Standard_ConstructionError, which is not a std::exception and would abort
  // the process. Both the std and non-std cases are caught here.
  bool buildFromIr(const std::string& program);

  const IrBuildReport& lastBuild() const noexcept { return report_; }

  // The history rows the tree and timeline show. Supplied by the document owner
  // (ForgeFrame), because labels are document metadata the kernel does not have.
  void setFeatureRows(std::vector<SceneFeature> rows);

  // The tree's ROOT row. It used to be the string literal "Bracket.fpart", which
  // named a file that did not exist and could not change; it is now the open
  // document's name, so opening a file is visible in the tree.
  void setDocumentLabel(std::string label);
  const std::string& documentLabel() const noexcept { return documentLabel_; }

  bool built() const noexcept { return built_; }
  const std::string& error() const noexcept { return error_; }
  const std::string& backend() const noexcept { return backend_; }

  const std::vector<SceneVertex>& vertices() const noexcept { return vertices_; }
  std::size_t triangleCount() const noexcept { return vertices_.size() / 3; }
  const Bounds& bounds() const noexcept { return bounds_; }
  std::uint32_t faceCount() const noexcept { return faceCount_; }

  const std::vector<SceneFeature>& features() const noexcept { return features_; }

  // How many times buildFromIr() has actually re-tessellated. The claim "running
  // a command changes the geometry" is only meaningful if something counts it.
  std::size_t builds() const noexcept { return builds_; }

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
  // Turns a kernel Mesh into the viewport's de-indexed vertex stream. Writes
  // into `out` so a failed build cannot half-replace the live geometry.
  bool deindex(const forge::Mesh& mesh, std::vector<SceneVertex>& out,
               std::uint32_t& faceCount, std::string& error) const;

  bool built_ = false;
  IrBuildReport report_;
  std::size_t builds_ = 0;
  std::string error_;
  std::string backend_ = "unknown";
  std::vector<SceneVertex> vertices_;
  Bounds bounds_;
  std::uint32_t faceCount_ = 0;
  std::vector<SceneFeature> features_;
  std::string documentLabel_ = "untitled.fpart";
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
  // Maps a node id back to the feature-IR STATEMENT it names -- the 1-based id
  // the document numbers its records by -- and 0 when the node is the root or a
  // face. The feature rows are built one per document record, in order
  // (ForgeFrame::refreshFeatureRows), which is what makes the position of a row
  // and the id of a statement the same number.
  int featureIrIdOf(forge::ui::NodeId id) const;
  // The node id for a given 1-based face id.
  forge::ui::NodeId nodeForFace(std::uint32_t faceId) const;

 private:
  const KernelScene& scene_;
  mutable std::size_t fetches_ = 0;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_KERNELSCENE_HPP
