// forge-desktop/src/DrawingHost.hpp
//
// THE SEAM BETWEEN THE DRAWING SHEET AND THE KERNEL'S HIDDEN-LINE REMOVER (T-230).
//
// forge::ui lays the sheet out and writes the file; it includes no kernel header.
// This translation unit is the one that compiles the document's own feature
// history and asks forge::native::brep::hiddenLineRemoval -- the native analytic
// HLR the kernel switched to when libTKHLR was dropped -- for each view's visible
// and hidden edge spans. Same split, and the same reason, as StudyHost and
// FileExchangeHost: the ImGui frame builder still reaches no kernel header.
//
// ── what is real here ───────────────────────────────────────────────────────
// The program compiled is the document's irProgram(), the text the viewport is
// built from, so the drawing is of the part on screen by construction and never
// of a cached body. Each view's polylines are re-projected onto the SAME
// forge::ui::drawingViewAxes() the View List prints, so the file and the panel
// agree about which way is right and up on every view. A body the native HLR
// cannot take (the importer defers on a face kind, or the solid is degenerate)
// is REFUSED with a sentence; a view is never fabricated.
//
// NEVER THROWS: every kernel call is wrapped, and a failure is a result.
#ifndef FORGE_DESKTOP_DRAWINGHOST_HPP
#define FORGE_DESKTOP_DRAWINGHOST_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/DrawingExport.hpp"
#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/KernelSession.hpp"
#include "forge/ui/Types.hpp"

namespace forge::desktop {

struct DrawingProjectionRequest {
  std::string irProgram;
  std::string inputFile;  // backs INPUT(), "" for a document with no file bound
  std::vector<forge::ui::NamedView> views;
};

struct DrawingProjectionResult {
  bool ok = false;
  std::string blocker;  // a sentence for the user when !ok
  std::string detail;   // the technical cause, for the activity log
  std::vector<forge::ui::DrawingViewLines> views;
  // The compiled body's own bounding box (forge::ft::compile's), an oracle
  // independent of both the HLR and the display tessellation.
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  std::size_t edgesClassified = 0;
  // The two HLR densities this body was drawn at, chosen from the body itself
  // (see hlrOptionsFor in DrawingHost.cpp): curved-face tessellation 4..48 and
  // samples per edge (1 when no edge has a curve). 0 when nothing was drawn.
  std::size_t curveTess = 0;
  std::size_t samplesPerEdge = 0;
  // Where the time went, for the activity log: this all runs on the thread that
  // dispatched the command. Wall-clock milliseconds; 0 for a phase not reached.
  double compileMs = 0.0;
  double importMs = 0.0;   // importOcctSolid, and nothing else
  double viewsMs = 0.0;    // tessellation choice + every view's HLR + tidying
  std::size_t nativeFaces = 0;
  // True when the projection ran in forge_kernel_worker rather than in this
  // process. Set by DrawingProjector; never sent over the wire.
  bool isolated = false;
};

// Compiles `request.irProgram` and projects every requested view. Fills each
// view's extent from its own lines. Never throws.
DrawingProjectionResult projectDrawingViews(const DrawingProjectionRequest& request);

// ════════════════════════════════════════════════════════════════════════════
// THE DRAWING REQUEST, IN THE PROCESS THE APPLICATION IS ALLOWED TO LOSE (T-360)
//
// projectDrawingViews() compiles the part, imports it into the native B-rep and
// runs three hidden-line passes: the OCCT compile and import paths the kernel's
// own report records SIGSEGVing on, and seconds of work (3.2 s measured on the
// starting part in T-230, minutes on larger parts). In this process a fault
// there takes the application -- and the user's unsaved document -- down with
// it, and the wait freezes whatever thread asked. So it is also offered to
// forge_kernel_worker, as a request kind of its own, exactly as the quality
// check is: a first-line pragma names the views, the worker projects them and
// answers with the whole DrawingProjectionResult.
//
// ── the wire ────────────────────────────────────────────────────────────────
//   request   kWorkerDrawingPragma + the views as NamedView numbers + "\n",
//             then the input-file pragma when a file is bound, then the program
//   answer    kDrawingResultMagic, then `key value` lines; the two sentences are
//             LENGTH-prefixed (a newline inside one cannot be read as a field);
//             every view and every polyline is COUNT-prefixed (a short answer is
//             a diagnosis, not a drawing with a view missing); every double is a
//             C99 hex float, so the numbers that come back are the numbers that
//             were computed, BIT FOR BIT -- the drawing written from a worker
//             projection is byte-identical to one written from an in-process one.
inline constexpr const char* kWorkerDrawingPragma = "#!forge-worker-drawing ";
inline constexpr const char* kDrawingResultMagic = "FORGE-DRAWING-RESULT 1";

// The payload the worker reads on stdin for `request`.
std::string drawingWorkerPayload(const DrawingProjectionRequest& request);
// Worker side: when `program` starts with the drawing pragma, strips that line,
// fills `views` and returns true. `why` is set (and false returned) for a
// pragma that is present but names no view or a view this build does not have.
bool takeDrawingPragma(std::string& program, std::vector<forge::ui::NamedView>& views,
                       bool& present, std::string& why);
std::string encodeDrawingProjection(const DrawingProjectionResult& result);
// Strict: any count, length or number that does not add up is a refusal with
// `why` naming it, and `out` is left untouched.
bool decodeDrawingProjection(const std::string& payload, DrawingProjectionResult& out,
                             std::string& why);

// ── who runs it ─────────────────────────────────────────────────────────────
// One drawing job at a time, on its OWN KernelSession -- never the rebuild's, so
// a rebuild started while a drawing is being worked out is not refused for
// "already running", and a drawing never waits behind a rebuild.
//
// Configured with the SAME worker command and GuardLimits the scene's rebuild
// uses (KernelScene::session().workerArgv() / limits()): the drawing gets the
// rebuild's deadline. With no worker configured everything runs in this
// process, which is what every headless gate that never configures one gets --
// byte-identical to before.
class DrawingProjector {
 public:
  void configure(std::vector<std::string> argv, const forge::ui::GuardLimits& limits);
  bool isolated() const noexcept { return session_.workerConfigured(); }
  const std::vector<std::string>& workerArgv() const noexcept { return session_.workerArgv(); }
  const forge::ui::GuardLimits& limits() const noexcept { return session_.limits(); }

  // SYNCHRONOUS: in the worker when one is configured -- the wait bounded by the
  // deadline -- otherwise, or when the worker cannot be started, or when the
  // limits carry no deadline (nothing here could end that wait), in this
  // process. Never throws.
  DrawingProjectionResult project(const DrawingProjectionRequest& request);

  // ASYNCHRONOUS, worker only. start() never blocks and returns false when
  // nothing started (no worker, one already running, the spawn refused); the
  // caller then decides whether to project in process. poll() advances the job
  // and returns true EXACTLY ONCE, on the call that finished it, with the answer
  // -- a refusal sentence when it crashed, timed out, was cancelled or answered
  // in a form this build cannot read. cancel() makes it end on a later poll().
  bool start(const DrawingProjectionRequest& request, std::uint64_t nowMs);
  bool running() const noexcept { return session_.running(); }
  bool poll(std::uint64_t nowMs, DrawingProjectionResult& out);
  void cancel(std::uint64_t nowMs) { session_.cancel(nowMs); }
  std::uint64_t elapsedMs(std::uint64_t nowMs) const { return session_.elapsedMs(nowMs); }

  const forge::ui::KernelSession& session() const noexcept { return session_; }
  std::size_t isolatedRuns() const noexcept { return isolatedRuns_; }
  std::size_t inProcessRuns() const noexcept { return inProcessRuns_; }
  std::size_t fallbacks() const noexcept { return fallbacks_; }

 private:
  // The terminal session, read into a result.
  DrawingProjectionResult finish();
  DrawingProjectionResult inProcess(const DrawingProjectionRequest& request);

  forge::ui::KernelSession session_;
  std::size_t isolatedRuns_ = 0;
  std::size_t inProcessRuns_ = 0;
  std::size_t fallbacks_ = 0;
};

}  // namespace forge::desktop

// The isolation gate's drawing section is compiled against trees without this
// (that is how its failing-first run was measured), so it probes for it.
#define FORGE_DESKTOP_HAS_DRAWING_PROJECTOR 1

#endif  // FORGE_DESKTOP_DRAWINGHOST_HPP
