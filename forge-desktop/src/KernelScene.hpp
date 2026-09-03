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
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/KernelSession.hpp"
// The feature history is the DOCUMENT's, so the tree source reads it straight
// out of forge::ui::PartDocument. Both headers are headless forge::ui: this
// file still reaches no OCCT and no ImGui.
#include "forge/ui/PartCommands.hpp"
// The trust panels' answers. A plain struct: no kernel type and no OCCT type
// crosses it, so this header stays includable by the ImGui frame builder.
#include "ModelQuality.hpp"

// forge::Mesh lives in forge/Tessellate.hpp, which reaches OCCT headers. This
// header is included by the ImGui frame builder and by every headless gate, so
// it forward-declares the type instead: only KernelScene.cpp may see OCCT.
namespace forge {
struct Mesh;
}  // namespace forge

namespace forge::desktop {

// The first line of a `forge_kernel_worker` answer. Spelled once, here, because
// the worker writes it and the scene reads it and a protocol spelled in two
// places is a protocol that drifts.
inline constexpr const char* kWorkerResultMagic = "FORGE-WORKER-RESULT 1";

// ── the file `INPUT()` binds, across the worker boundary ────────────────────
// `forge::ft::compile` takes the input file as a COMPILE PARAMETER, not as an op
// argument: `INPUT()` has arity 0..0 and reads Builder::inputStep. The parent
// therefore has to tell the worker which file the program's INPUT() means, and
// the worker reads one thing -- the program on stdin. So the path travels as a
// first-line pragma, exactly as the self-test pragmas already do, and for the
// same reason they can: `#` starts a comment in the IR grammar
// (FeatureTreeCompiler strips '#' and '//'), so nothing forge::ui can emit
// collides with it, and a worker that failed to strip the line would still parse
// the program correctly rather than mis-compile it.
//
// It is prepended ONLY when a file is bound, so every existing gate submits a
// byte-identical payload to the one it submitted before.
inline constexpr const char* kWorkerInputPragma = "#!forge-worker-input ";

// One de-indexed vertex, matching shaders/viewport_solid.vert exactly.
struct SceneVertex {
  float px = 0.0f, py = 0.0f, pz = 0.0f;
  float nx = 0.0f, ny = 0.0f, nz = 0.0f;
  std::uint32_t faceId = 0;  // 1-based OCCT face id (0 = unknown)
  std::uint32_t flags = 0;   // bit0 = selected
};

// The vertex stream crosses a process boundary as raw bytes, so its layout is
// part of the protocol rather than an implementation detail. If a field is ever
// added, BOTH ends are rebuilt from this header in the same build — and the
// assertion below is what makes a silent size change a compile error instead of
// a viewport full of noise.
static_assert(sizeof(SceneVertex) == 32, "SceneVertex is the worker wire record");

// An axis-aligned bounding box; the camera's "fit" uses it, so it is part of the
// scene's contract rather than something the viewport recomputes.
struct Bounds {
  float min[3] = {0.0f, 0.0f, 0.0f};
  float max[3] = {0.0f, 0.0f, 0.0f};
  bool valid = false;

  void centre(float out[3]) const;
  float radius() const;  // half the diagonal; 0 when !valid
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
  // ── THE PART'S OWN CHECKS, AS THE KERNEL ANSWERED THEM ──────────────────
  // `VERIFY` and `SURFCHECK` statements measure the live body and record one
  // line each -- "PASS holes=2 (got 2)", "FAIL volume<=100 (got 140)". The
  // compiler has always produced them and this report DROPPED them, so the one
  // thing a part can say about itself reached no panel and no user. They are
  // carried here and across the worker boundary with everything else.
  std::vector<std::string> checks;
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
  // buildFromIr() every later edit takes. There is no second, hand-written
  // construction path — the starting part IS a document.
  //
  // It produces GEOMETRY ONLY. The history rows that go with it are the
  // PartDocument's records, which ForgeFrame seeds from the same
  // defaultPartStatements() table; this class no longer keeps a second copy of
  // them (see SceneFeatureTreeSource below for what that copy cost).
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

  // ── ★ CRASH ISOLATION: the same edge, in a process we can afford to lose ──
  //
  // A SIGSEGV is not an exception. The catch clauses above are real and they
  // catch real failures — an escaping Standard_ConstructionError among them —
  // but forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md documents a null
  // Geom2d_Curve dereferenced INSIDE OCCT on three paths, on model output AND on
  // the gold reference parts, and no catch clause exists for a signal. The
  // report's own measured self-correction rules out a pre-check: the crashing
  // shape had nullPcurves=0, so the null is born inside the operation.
  //
  // So when an isolated worker is configured, buildFromIr() runs the whole
  // parse -> compile -> tessellate chain in a CHILD PROCESS and reads the vertex
  // stream back. A fault costs one rebuild: the document, the undo stack, the
  // dock layout and the last good body all survive, and the failure arrives as a
  // sentence that NAMES THE STATEMENT (from the worker's op trail) rather than as
  // the silence a segfault normally leaves.
  //
  // `argv` is the worker command. `limits` carry the deadline — non-zero, always:
  // 6 of 600 corpus parts exceed 300 s in the verifier, and an operation with no
  // deadline is indistinguishable from a hang.
  void useIsolatedWorker(std::vector<std::string> argv, const forge::ui::GuardLimits& limits);
  bool isolationConfigured() const noexcept { return session_.workerConfigured(); }
  // Runs `worker --version` once and reports whether it answered. An application
  // that discovers it has no isolation on the first rebuild has discovered it too
  // late to tell anyone.
  bool probeWorker(std::string& error);
  const forge::ui::KernelSession& session() const noexcept { return session_; }
  // How many builds were served out of process, and how each of them ended.
  std::size_t isolatedBuilds() const noexcept { return isolatedBuilds_; }
  std::size_t isolatedFallbacks() const noexcept { return isolatedFallbacks_; }

  // ── keeping the host alive, and giving the user a way out ────────────────
  // Called between polls while an isolated build runs, with the elapsed time and
  // the statement the worker last announced. Return TRUE to cancel.
  //
  // This is what keeps a long operation from freezing the application: the host
  // pumps its event queue here, draws a progress line, and answers "the user hit
  // Escape" by returning true. Without it the wait is merely BOUNDED (the
  // deadline still fires); with it the wait is also INTERRUPTIBLE.
  using HostPump = std::function<bool(std::uint64_t elapsedMs, const std::string& opText)>;
  void setHostPump(HostPump pump);

  const IrBuildReport& lastBuild() const noexcept { return report_; }

  // ── ★ THE QUALITY CHECK: interference, verification, continuity, draft, zebra ──
  //
  // Runs every query in ModelQuality.hpp against the solid this scene last
  // built, and returns what each one answered. It is NOT part of a rebuild: the
  // continuity pass alone projects a point onto two surfaces at every sample of
  // every shared edge, which is proportional to the model and would put that
  // cost on every keystroke. A person asks for a check; the check runs.
  //
  // It takes the SAME road a build takes. With an isolated worker configured the
  // whole analysis happens in that process -- which matters more here than for a
  // build, because these are exactly the OCCT paths
  // forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md records faulting on, and a
  // fault must cost one check rather than the user's document.
  //
  // Returns false when the check could not be run at all; `lastQuality()` then
  // carries the sentence saying why. A check that RAN and found problems is a
  // SUCCESS -- the problems are the answer.
  bool analyseQuality(const QualitySettings& settings);
  const ModelQualityReport& lastQuality() const noexcept { return quality_; }
  // How many checks have completed, and how many of those ran out of process.
  std::size_t qualityRuns() const noexcept { return qualityRuns_; }
  std::size_t isolatedQualityRuns() const noexcept { return isolatedQualityRuns_; }

  // ── THE FILE `INPUT()` BINDS ────────────────────────────────────────────
  //
  // THE GAP THIS CLOSES, MEASURED. `part.input_solid` has been in the registry
  // and dispatchable, and it emits `INPUT()`. Nothing in the application ever
  // gave the compiler an input file: KernelScene called
  // `forge::ft::compile(tree)` with the default empty path, and opInput's first
  // line is `if (inputStep.empty()) throw OpError(op.id, "INPUT() used but no
  // input STEP was supplied to the compiler")`. So the one op every editing
  // benchmark starts from was a command that could only ever fail, and the
  // failure it produced was a developer sentence in the user's status strip.
  //
  // Setting this does NOT rebuild: it is a parameter of the NEXT build, and the
  // caller that binds a file is about to change the document anyway.
  void setInputFile(std::string path);
  const std::string& inputFile() const noexcept { return inputFile_; }

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
  // The in-process chain. Named so the isolated path can be a peer rather than a
  // wrapper, and so a fallback reads as a deliberate choice at its call site.
  bool buildInProcess(const std::string& program);
  // Runs the program in the worker and installs the answer. Returns false on any
  // non-success, having kept the previous geometry. `fellBack` comes back true
  // ONLY when the worker could not be launched at all — never after a crash,
  // because re-running a crasher in this process is exactly the outcome the
  // isolation exists to prevent.
  bool buildIsolated(const std::string& program, bool& fellBack);
  // Decodes the worker's answer into `report` and `verts`. Returns false with a
  // reason when the payload is truncated or malformed — a worker that exits 0 and
  // writes nonsense must be a diagnosis, not a viewport full of noise.
  static bool decodeWorkerPayload(const std::string& payload, IrBuildReport& report,
                                  std::vector<SceneVertex>& verts, std::string& backend,
                                  std::string& error);
  // The worker payload decoder is the only thing standing between a corrupted
  // pipe and the viewport, and its interesting cases -- a truncated mesh, an
  // over-long one, a newline inside the error block -- are ones no live worker
  // can be asked to produce on demand. So the gate drives it directly. This is a
  // seam for a TEST, not an API: it forwards to the private static above and
  // adds nothing, so it cannot become a second way to decode a payload.
  friend struct KernelSceneTestAccess;
  // Turns a kernel Mesh into the viewport's de-indexed vertex stream. Writes
  // into `out` so a failed build cannot half-replace the live geometry.
  bool deindex(const forge::Mesh& mesh, std::vector<SceneVertex>& out,
               std::uint32_t& faceCount, std::string& error) const;

  // The check, in this process, against `solidHandle_`.
  bool analyseQualityInProcess(const QualitySettings& settings);
  // The check, in the worker. `fellBack` comes back true only when nothing
  // started, exactly as buildIsolated uses it.
  bool analyseQualityIsolated(const QualitySettings& settings, bool& fellBack);

  bool built_ = false;
  IrBuildReport report_;
  // The solid the last IN-PROCESS build produced, so the quality check measures
  // the body the viewport is showing rather than recompiling its own. Recorded,
  // not retained: nothing in this application releases a compiled handle, so the
  // entry outlives the scene either way and taking a reference here would change
  // a lifetime rule that is not this feature's to change. Zero after an isolated
  // build -- that solid lives in the worker, which is where the isolated check
  // runs.
  std::uint32_t solidHandle_ = 0;
  // The program this scene was last asked to build. The isolated check has to
  // send the worker something to compile, and asking the caller to hand the
  // program back is how the check and the viewport come to describe two
  // different models.
  std::string program_;
  ModelQualityReport quality_;
  std::size_t qualityRuns_ = 0;
  std::size_t isolatedQualityRuns_ = 0;
  std::size_t builds_ = 0;
  std::string error_;
  std::string backend_ = "unknown";
  std::vector<SceneVertex> vertices_;
  Bounds bounds_;
  std::uint32_t faceCount_ = 0;
  std::string documentLabel_ = "untitled.fpart";
  // "" means no file is bound, which is what every build before this one had.
  std::string inputFile_;

  // The isolation. Idle and inert until useIsolatedWorker() is called, which is
  // what keeps every existing headless gate on the in-process path it was written
  // against.
  forge::ui::KernelSession session_;
  forge::ui::GuardLimits limits_{};
  HostPump hostPump_;
  std::size_t isolatedBuilds_ = 0;
  std::size_t isolatedFallbacks_ = 0;
};

struct KernelSceneTestAccess {
  static bool decode(const std::string& payload, IrBuildReport& report,
                     std::vector<SceneVertex>& verts, std::string& backend, std::string& error) {
    return KernelScene::decodeWorkerPayload(payload, report, verts, backend, error);
  }
};

// ── the feature tree seam ───────────────────────────────────────────────────
// forge::ui::FeatureTreeModel virtualizes over a handle-based source. This is
// the source: the document root, the DOCUMENT'S OWN feature records under it,
// and one child row per B-rep face under the last feature — which is what makes
// the row count large enough for the virtualization to be doing real work on a
// real part rather than on a synthetic fixture.
//
// ── THE ROWS ARE THE IR STATEMENTS ──────────────────────────────────────────
// This source used to read a `std::vector<SceneFeature>` that KernelScene held
// and ForgeFrame::refreshFeatureRows() re-copied out of PartDocument::records()
// after every rebuild: a SECOND history, four strings wide, that had to be
// pushed into the scene by a setter any mutation path could forget to call.
// What that copy could not carry is exactly what a feature tree is for —
// `irId` (the statement the row IS), `commandId` (what authored it) and the
// `IrLine` itself — so the rows were reduced to a label and an op name, and the
// row identity was a synthesized string ("value_4") rather than the statement's
// own id. Reading records() directly means a row cannot be stale, cannot be
// missing, and carries the whole statement: recordAt() hands it back.
class SceneFeatureTreeSource final : public forge::ui::FeatureTreeSource {
 public:
  // `scene` supplies the face rows and the build report the row STATE is read
  // from; `document` supplies the history itself. Both must outlive this object.
  SceneFeatureTreeSource(const KernelScene& scene, const forge::ui::PartDocument& document);

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

  // ── the row IS the statement ─────────────────────────────────────────────
  // The document record a feature row stands for, or nullptr when the node is
  // the root or a face. This is what lets the timeline, the properties panel and
  // a gate read a row's irId, its authoring commandId and its IrLine WITHOUT a
  // parallel copy of the history existing anywhere.
  const forge::ui::FeatureRecord* recordAt(forge::ui::NodeId id) const;
  // The node id of the i-th document record.
  forge::ui::NodeId nodeForFeature(std::size_t index) const;
  // How many feature rows the tree has — the document's record count.
  std::size_t featureCount() const noexcept;

 private:
  const KernelScene& scene_;
  const forge::ui::PartDocument& document_;
  mutable std::size_t fetches_ = 0;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_KERNELSCENE_HPP
