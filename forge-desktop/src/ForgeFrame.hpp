// forge-desktop/src/ForgeFrame.hpp
//
// THE APPLICATION SHELL — one ImGui frame of the Forge CAD workstation.
//
// This class OWNS NO STATE THAT forge::ui ALREADY OWNS. The command set, the
// typed selection, the keymap, the dock tree, the workspace and the feature-tree
// virtualization all live in forge::ui and are consumed here. What lives in this
// class is exactly what a frame builder must own: which panel a splitter is
// being dragged in, what the palette's query string is, and which parameter a
// dialog is editing.
//
// It also DOES NOT TOUCH THE GPU. `build()` needs nothing but an ImGui context
// with a valid DisplaySize, which is what lets the frame gate construct a real
// frame in CI, with no window, no swapchain and no MoltenVK, and assert on the
// draw data that comes out.
//
// ── how docking works here, and why it is not ImGui's ───────────────────────
// The vendored Dear ImGui is the master branch: it has NO docking. That is not a
// gap, it is the shape D-001 asked for. forge::ui::DockLayout is an explicit
// dock TREE — splits with ratios, tab groups with an active index — that
// serializes, round-trips byte-identically, and recovers from a monitor being
// unplugged. This class walks that tree, turns it into rectangles, and places a
// borderless ImGui window per tab group. Splitter drags write the new ratio BACK
// into the tree, so the layout the user sees and the layout that gets saved are
// the same object. ImGui never holds the layout; the model does.
#ifndef FORGE_DESKTOP_FORGEFRAME_HPP
#define FORGE_DESKTOP_FORGEFRAME_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "Camera.hpp"
#include "FileDialog.hpp"
#include "DrawingGdt.hpp"
#include "CamHost.hpp"
#include "KernelScene.hpp"
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandSurface.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/DocumentStore.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MachineProgram.hpp"
#include "forge/ui/Manipulator.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/Onboarding.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SketchDiagnosis.hpp"
#include "forge/ui/StatusModel.hpp"
#include "forge/ui/StudyModel.hpp"
#include "forge/ui/SurfaceAnalysis.hpp"
#include "forge/ui/ToolLibrary.hpp"
#include "forge/ui/ToolCatalog.hpp"
// The sketch panels read the LIVE constraint solver through this. It is plain
// C++ over plain data and reaches no OCCT header, which is what lets the frame
// builder include it at all -- forge/Sketcher.hpp, which it wraps, does not.
#include "forge/ft/SketchInspect.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceTrees.hpp"

struct ImDrawList;

namespace forge::desktop {

// ── WHERE THE AUTOSAVED DRAWING LIVES ───────────────────────────────────────
//
// An autosave is a forge::ui::DocumentModel, and that model has no drawing: the
// title block, the datums, the notes and the geometric tolerances are
// forge::desktop's, carried in the .fpart dialect this application writes
// (PartFile.hpp) and NOT expressible in the forge::ui one. Adding them to the ui
// dialect would need a version 3 there, and forge::desktop has already minted
// FORGE-PART 3 for itself -- two dialects answering to one number is the exact
// collision PartFile.hpp refuses a version 2 file over.
//
// So the drawing rides BESIDE the autosave, in a file named by appending this to
// the autosave's own path, written through the same DocumentStorage seam, by the
// same writePartFile() that documentSave() uses. It holds NO features on
// purpose: a second copy of the feature tree could disagree with the autosave's,
// and the one thing worse than a lost drawing is a drawing stitched onto the
// wrong part.
//
// The suffix deliberately does not end in the autosave's own, so that a scan
// counting autosaves cannot count these too.
inline constexpr const char* kAutosaveDrawingSuffix = ".autosave.drawing.fpart";

// The drawing file that belongs beside `autosavePath`. "" when there is no
// autosave to sit beside.
std::string autosaveDrawingPath(const std::string& autosavePath);

// What the frame decided the viewport needs from the renderer this frame. The
// renderer reads this AFTER build(); build() itself never calls into Vulkan.
struct ViewportRequest {
  bool visible = false;
  int x = 0, y = 0, width = 0, height = 0;  // framebuffer pixels
  std::uint32_t hoverFace = 0;
  bool selectionDirty = false;  // vertex flags changed -> re-upload
  // The DOCUMENT rebuilt: a different triangle count, a different vertex buffer
  // size. The host must wait for the device to go idle before re-uploading,
  // because a growing buffer is destroyed and recreated, unlike a selection
  // re-upload which only rewrites bytes already mapped.
  bool geometryDirty = false;
  // A BODY WAS SHOWN OR HIDDEN. The triangle count changed, so the host must
  // drain the device and re-upload exactly as a rebuild makes it -- but it must
  // NOT re-frame the camera. Hiding one body of six is not opening a new part,
  // and a view that jumps every time a checkbox is clicked is unusable.
  bool visibilityDirty = false;
  bool wireframe = false;
};

// ── WHAT THE HOST DOES ABOUT A VIEWPORT REQUEST — IN ONE RUNNABLE PLACE ─────
//
// main.cpp's frame loop used to decide this inline, and while it was inline it
// grew a SECOND DUTY: it re-framed the camera whenever geometryDirty said
// "re-upload the vertex buffer". Nothing could observe that. forge_desktop links
// SDL2, Vulkan and a display, so no headless gate can link main.cpp, and the
// only instrument available was a TEXT SEARCH over main.cpp for
// `camera().frame(`. A text search is not a measurement, and this one is
// defeated by a single line:
//
//     Camera& cam = frame.camera();
//     cam.frame(c, scene.bounds().radius());       // the whole defect, restored
//
// MEASURED: with exactly that in main.cpp's geometryDirty branch, the gate's
// check stayed GREEN and forge_desktop compiled and linked. Its replacement --
// count the ACCESSOR, `frame.camera()`, exactly once and on the line that hands
// it to the renderer -- was then defeated the same way, by putting the binding
// and the words the check looks for on ONE line:
//
//     Camera& cam = frame.camera();  // handed to viewport.record( below
//
// MEASURED AGAIN: 58 checks, 0 failures, forge_desktop compiled, linked, and
// re-framed the camera on every rebuild. Text checks over a file no gate can
// link are a belt, never the measurement; what closed that one is a rule about
// what the host may CALL, read out of Camera.hpp rather than listed by hand.
//
// So the DECISION lives here instead -- a pure function of the request, with no
// Vulkan in it, no camera in its arguments, none in its return type and none in
// its scope -- and main.cpp executes what it returns. camera_stability_gate RUNS
// this function: it drives every one of the thirty-two reachable request shapes
// through it and applies what comes back to the live application, and it applies
// the host's reaction after every frame it steps, so every camera assertion in
// that gate is made with the host's real response in the loop.
//
// AND IT ASSERTS THE SHAPE OF THIS STRUCT, which is the claim the sweep itself
// cannot make. hostViewportActions() takes a const reference and returns bools,
// so it has no way to move a camera and "the camera moved in none of them" is
// vacuous by construction -- it was written as though it were not, and that is
// corrected in the gate. What is NOT vacuous is that this action set is exactly
// the set the gate executes: a FOURTH duty here is one main.cpp would perform and
// the gate would not, so the gate reads these members and requires them to be the
// three it runs. MEASURED: adding `bool refitCamera` and setting it on every
// geometryDirty left that gate at 58 checks / 0 failures before it did.
//
// The actions are deliberately THREE BOOLS AND NO MORE. Re-hanging the camera
// off a rebuild means adding a member to this struct, in the same header that
// says why not, rather than adding a line to a frame loop nobody can test.
struct HostViewportActions {
  bool resize = false;          // the 3D panel changed size
  // The vertex buffer is about to be DESTROYED AND RECREATED at a new size, and
  // a previous frame may still be reading it. A selection re-upload only rewrites
  // bytes already mapped and needs no drain.
  bool waitDeviceIdle = false;
  bool uploadVertices = false;  // push the tessellation to the GPU
};

constexpr HostViewportActions hostViewportActions(const ViewportRequest& req) {
  HostViewportActions act;
  act.resize = req.visible && req.width > 0 && req.height > 0;
  if (req.geometryDirty) {
    act.waitDeviceIdle = true;
    act.uploadVertices = true;
  } else if (req.visibilityDirty) {
    // A body was shown or hidden. The triangle count moved, so the buffer is
    // resized and the device drained exactly as a rebuild makes it -- and the
    // camera is LEFT WHERE THE USER PUT IT. Hiding one body of six is not
    // opening a new part.
    act.waitDeviceIdle = true;
    act.uploadVertices = true;
  } else if (req.selectionDirty) {
    act.uploadVertices = true;
  }
  return act;
}

// Where one VIEWPORT DRAG HANDLE was drawn, in the same screen coordinates ImGui
// was given. Recorded per handle, per frame, for the same reason TabHit is: the
// handles are not widgets, so nothing outside this class can re-derive where
// they are without re-implementing the gizmo's projection -- and a headless gate
// that re-implemented it would be asserting against its own copy of the
// arithmetic rather than against the app's.
//
// The point recorded is the point the HIT TEST answers for: the projected arrow
// TIP for a translate handle, and the ring sample FARTHEST from the projected
// pivot for a rotate handle (the one with the most screen extent, so it is the
// one a pointer can actually reach when the ring is seen near edge-on).
struct HandleHit {
  forge::ui::ManipulatorMode mode = forge::ui::ManipulatorMode::Off;
  forge::ui::HandleAxis axis = forge::ui::HandleAxis::None;
  float x = 0.0f, y = 0.0f;
};

// Where one dock TAB BUTTON was drawn, in the same screen coordinates ImGui was
// given. Recorded per tab, per frame, so a host can put a pointer on a tab
// without re-deriving the dock layout arithmetic: the click gate uses it to
// drive io.AddMousePosEvent, and it is equally what a UI-automation or
// accessibility layer needs. `panelId` is a COPY, not a reference into the dock
// tree, because the tree is re-seated by the very click this box invites.
struct TabHit {
  std::vector<std::size_t> path;  // node address from the main window's root
  std::size_t index = 0;          // which tab within that Tabs node
  std::string panelId;
  float x = 0.0f, y = 0.0f, w = 0.0f, h = 0.0f;
  float centreX() const noexcept { return x + 0.5f * w; }
  float centreY() const noexcept { return y + 0.5f * h; }
};

// Where one SPLITTER grip was drawn, same coordinates and same reason: a drag is
// the other gesture that writes into the dock tree mid-walk.
struct SplitterHit {
  std::vector<std::size_t> path;
  bool vertical = false;  // true when the split stacks vertically (drag in Y)
  float x = 0.0f, y = 0.0f, w = 0.0f, h = 0.0f;
  float centreX() const noexcept { return x + 0.5f * w; }
  float centreY() const noexcept { return y + 0.5f * h; }
};

// The frame builder is also THE DOCUMENT OWNER. It holds the PartDocument the
// Part commands append to, and implements forge::ui::DocumentHost so the shell's
// ONE file.new / file.open / file.save / edit.undo / edit.redo act on it. Before
// this, three disconnected document models coexisted and none of them was the
// one on screen.
// It is ALSO the source of the posted machine program, for the same reason: the
// CAM plan the Manufacturing panels compute is state in this object and nowhere
// else, and forge::ui::MachineProgramSource is the seam that lets the shell's ONE
// file.export_gcode write it without ui/ knowing what a toolpath is.
class ForgeFrame final : public forge::ui::DocumentHost,
                         public forge::ui::MachineProgramSource {
 public:
  ForgeFrame(forge::ui::ForgeShell& shell, KernelScene& scene);

  // Registers the 16 Part workspace commands into the shell's ONE registry,
  // seeds the PartDocument with the SAME statements KernelScene::build()
  // compiled, and installs this object as the shell's document host. Returns how
  // many commands were added.
  std::size_t wirePartCommands();

  // ── the Archie CoPilot panel ────────────────────────────────────────────
  //
  // THE FRAME BUILDER OPENS NO SOCKET. The panel RAISES A REQUEST and RENDERS A
  // RESULT; whatever fills the gap is the app layer's business, exactly as the
  // 3D viewport works -- build() fills a plain ViewportRequest and the renderer
  // reads it afterwards.
  //
  // A host that wants a real model behind Archie:
  //     frame.setCopilotAutoPlan(false);            // stop answering locally
  //     ... build the frame ...
  //     if (const auto* req = frame.copilotRequest()) {
  //         PlanResponse reply = myTransport.ask(*req);   // I/O lives HERE
  //         frame.deliverCopilotPlan(reply);
  //     }
  // With auto-plan left on (the default), forge::ui::LocalPlanner answers in
  // process: deterministic, offline, and honest about the vocabulary it knows,
  // so the panel is usable and truthful before any model exists.
  //
  // EVERY plan, whoever produced it, goes through the op-constraint gate in
  // forge::ui::validatePlan() before it is offered, and again in applyPlan()
  // before any step is dispatched. This class adds no path around it.
  forge::ui::ArchieCopilot& copilot() noexcept { return copilot_; }
  const forge::ui::ArchieCopilot& copilot() const noexcept { return copilot_; }
  void setCopilotAutoPlan(bool on) noexcept { copilotAutoPlan_ = on; }
  bool copilotAutoPlan() const noexcept { return copilotAutoPlan_; }
  // Install or remove a model-backed planner. Ownership stays with the caller;
  // nullptr restores the deterministic planner alone. Set this and the copilot
  // asks Archie first and falls back, ANNOUNCING the fallback rather than hiding
  // it -- a user who cannot tell which planner answered cannot trust either.
  void setCopilotRemotePlanner(forge::ui::Planner* planner) noexcept {
    copilotRemote_ = planner;
  }
  const forge::ui::Planner* copilotRemotePlanner() const noexcept { return copilotRemote_; }

  // The most recent frame the HOST captured, as a PNG path, attached to every
  // plan request from here on. The host owns the capture because the swapchain
  // image index exists only inside the render loop; ForgeFrame merely carries
  // the path it was handed, which is what keeps this class free of Vulkan.
  //
  // Empty is the normal state and means "no picture": the request then goes out
  // exactly as it did before this existed.
  void setCopilotFramePath(std::string path) noexcept {
    copilotFramePath_ = std::move(path);
  }
  const std::string& copilotFramePath() const noexcept { return copilotFramePath_; }

  const forge::ui::PlanRequest* copilotRequest() const noexcept;
  // Remote first when installed, deterministic otherwise; announces a fallback.
  forge::ui::PlanResponse planWithFallback(const forge::ui::PlanRequest& request);
  forge::ui::PlanCheck deliverCopilotPlan(const forge::ui::PlanResponse& response);
  void failCopilotRequest(const std::string& why);

  // The panel's controls, reachable without a mouse -- for a host, a macro and
  // the gate. They RECORD INTENT exactly as the widgets do, and build() applies
  // it after the dock walk finishes. So they exercise the SHIPPING path rather
  // than a private one beside it, and a caller that presses Apply from outside a
  // frame cannot re-seat a container the next walk is about to index. A frame
  // must be built for a recorded press to take effect.
  void copilotType(const std::string& text);
  void copilotSubmit();
  void copilotApplyPlan();
  void copilotDiscardPlan();
  const std::string& copilotInput() const noexcept { return copilotInput_; }
  std::size_t copilotRowsDrawn() const noexcept { return copilotRowsDrawn_; }
  std::size_t copilotTranscriptRowsDrawn() const noexcept {
    return copilotTranscriptRowsDrawn_;
  }

  // ── the document ────────────────────────────────────────────────────────
  const forge::ui::PartDocument& document() const noexcept { return partDoc_; }
  const std::string& documentProgram() const noexcept { return builtProgram_; }
  const std::string& documentName() const noexcept { return documentName_; }
  // How many times the document has actually driven a kernel rebuild.
  std::size_t rebuilds() const noexcept { return rebuilds_; }

  // The selection node the document's CURRENT body answers to -- what a viewport
  // pick must put in EntityRef::bodyId for a Part command to resolve it back to
  // an IR value. It is READ from the document rather than spelled as a literal:
  // a command rebinds the node to the statement it produced, and a document
  // opened from a file may name its body anything at all, so a hard-coded
  // "body.bracket" makes every solid command silently unavailable the moment
  // either happens.
  std::string activeBodyNode() const;
  // Why the last rebuild failed; empty when the viewport matches the document.
  const std::string& rebuildError() const noexcept { return rebuildError_; }

  // Rebuilds the scene IFF the document's IR program differs from the one the
  // scene was last built from. Idempotent and cheap, so it can be called from
  // every dispatch site AND once per frame: a mutation path that forgets to call
  // it is the defect this method exists to make impossible.
  // Returns true when it actually rebuilt.
  bool syncSceneToDocument();

  // Honour an outstanding DOCUMENT framing request, if there is one and if there
  // is a body to frame. It is ONE function with two call sites inside
  // syncSceneToDocument() -- the rebuild path and the identical-program path
  // that skips it -- because the defect it closes was the second path silently
  // not doing what the first one did.
  //
  // `sceneShowsTheDocument` is the caller's answer to "is the body in the
  // viewport the one this document describes?", which the two call sites know by
  // different means and neither of which this function can re-derive: the
  // rebuild path knows it from the rebuild it just ran, and the skip path from
  // whether the last attempt at this same program left an error. It is NOT
  // scene_.bounds().valid -- a failed build leaves the LAST GOOD BODY on screen,
  // bounds and all, which is exactly what made the first draft of this repair
  // frame an emptied document onto the part it had just thrown away.
  void applyDocumentRefit(bool sceneShowsTheDocument);

  // ── forge::ui::DocumentHost ─────────────────────────────────────────────
  bool documentNew(std::string& error) override;
  // EMPTY, not "new": no starter part is seeded. app.load_sample is about to
  // write a sample's own statements into the document, and stacking fourteen of
  // them on top of the starter part's five would produce a program that is
  // neither. documentNew() is File > New and keeps its seed.
  bool documentReset(std::string& error) override;
  bool documentOpen(const std::string& path, std::string& error) override;
  bool documentSave(const std::string& path, std::string& error) override;
  // The file THIS document's `INPUT()` binds, told to both holders at once --
  // the scene the viewport is rebuilt from and the exchange a STEP export
  // compiles with. "" clears it. Everything that replaces or empties the
  // document calls it, which is what gives the binding a lifetime and stops one
  // part's source file following the next part into its file. See the note on
  // the definition for what it cost when it had none.
  void bindInputFile(const std::string& path);
  bool documentUndo() override;
  bool documentRedo() override;
  // The shell calls this after any Document-side-effect command that ran. It is
  // the ONE place the app re-derives geometry from the document, so no invoker
  // has to remember to.
  void documentChanged() override;
  std::size_t documentFeatureCount() const override;
  std::size_t documentUndoDepth() const override;
  std::size_t documentRedoDepth() const override;
  bool documentDirty() const override;
  std::string documentPath() const override;

  // ── forge::ui::MachineProgramSource ─────────────────────────────────────
  // The egress for the Manufacturing workspace. Both read camPlan_, which
  // ensureCamPlan() fills from forge::camx -- nothing here posts a line of
  // machine code itself, exactly as drawPostOutputPanel() does not.
  //
  // hasMachineProgram() COMPUTES NOTHING. It is called from a command's enabled
  // predicate, which is evaluated for every command on every frame to draw the
  // menu; generating a toolpath there would put a CAM run inside the File menu.
  // It reports what the panels have already computed, so the command is offered
  // once an operation has been set up and greyed until then.
  bool hasMachineProgram() override;
  bool machineProgram(forge::ui::MachineProgram& out) override;

  // Feed one key press. Returns true when it resolved to a command that ran.
  bool onKey(const std::string& key, forge::ui::ModMask mods);

  // Re-frames the camera when the shell's fit counter has moved since the last
  // call, and reports whether it did. Called once per build(), which is what
  // makes `view.fit` work for EVERY invoker -- before this the counter was
  // written by the command and read by nobody, and camera_.frame() ran exactly
  // once, in the constructor. Public so the gate can drive it without a frame.
  bool applyPendingFit();
  // How many fits this frame builder has actually applied.
  std::size_t fitsApplied() const noexcept { return fitsApplied_; }

  // The same contract for the two camera verbs beside it: PULLED once per
  // build(), so a menu item, a keystroke, the palette, the viewport's corner
  // buttons and an Archie tool call all reach the camera by the one path.
  //
  // applyPendingView   orients to shell.document().requestedView.
  // applyPendingSelectionFit  frames the CURRENT selection, resolving each
  //   EntityRef against the same triangle soup picking uses. It returns false
  //   and moves nothing when the selection resolves to no geometry -- framing
  //   the origin because a ref did not resolve is how a part appears to vanish.
  bool applyPendingView();
  bool applyPendingSelectionFit();
  std::size_t viewsApplied() const noexcept { return viewsApplied_; }
  std::size_t selectionFitsApplied() const noexcept { return selectionFitsApplied_; }

  // ── how many times the DOCUMENT path has re-framed the camera ────────────
  // Not the fit count: `view.fit` is the user asking, and this is the
  // application deciding for them. It moves on exactly three KINDS of event --
  // the first body this window ever shows, a document opened or replaced, and a
  // new document -- and on NOTHING else. A counter rather than a flag for the
  // reason DocumentStats states: two opens in a row are two events and a boolean
  // swallows the second.
  //
  // "AND ON NOTHING ELSE" IS A CLAIM ABOUT WHERE THE LATCH IS CONSUMED, and it
  // was FALSE as first written. The three events raise refitCameraPending_;
  // syncSceneToDocument() consumed it. But that function returns EARLY when the
  // program it is handed is identical to the one already built -- which is
  // exactly what re-opening the open file, or File > New on an untouched starter
  // part, produces -- and the early return ran before the latch was consumed. So
  // the request survived into the user's NEXT PLAIN EDIT, and that edit re-framed
  // the camera: the defect this whole mechanism exists to prevent, alive on the
  // one path that skipped it. MEASURED: open a part, open the same file again,
  // nudge one dimension -> target (-1.099, 11.116, 51.765) -> (0, 0, 45),
  // distance 189.48 -> 813.18.
  //
  // Both paths now go through applyDocumentRefit(), and camera_stability_gate
  // asserts the property on the far side of a document event -- which is the
  // only state in which the latch is ever set, and therefore the only state in
  // which a check of it can fail.
  std::size_t cameraRefits() const noexcept { return cameraRefits_; }

  // Build the frame. Must be called between ImGui::NewFrame() and ImGui::Render().
  // `viewportTexture` is 0 when there is no 3D texture yet (headless, or the
  // first frame before the renderer has drawn one).
  void build(std::uint64_t viewportTexture, float dpiScale);

  const ViewportRequest& viewport() const noexcept { return viewportRequest_; }

  // ── WHEN THERE IS NO 3D VIEW AND NOBODY SAYS SO ────────────────────────
  // The renderer's own failure text went to stderr and nowhere else, so a user
  // whose graphics driver refused got a black rectangle where their part should
  // be, with no sentence anywhere in the application. The host loop hands the
  // technical cause here; the frame builder shows the translation of it and
  // logs the cause. Empty (the default) means "no problem to report".
  void setViewportUnavailable(const std::string& internalDetail);
  Camera& camera() noexcept { return camera_; }
  const Camera& camera() const noexcept { return camera_; }

  // ── THE QUIT GUARD, and the data loss it exists to end ──────────────────
  //
  // MEASURED on the tree this was written against, with a headless probe that
  // drove exactly this API: a document with an unsaved `part.fillet` in it,
  // `requestQuit()` -> `wantsQuit()` TRUE on the same line, `documentDirty()`
  // still true, and ZERO autosave files and ZERO session markers anywhere on
  // disk. `Window > Quit`'s whole body was `quit_ = true;` and the window's
  // close box went straight to the host loop's `running = false`. Every edit
  // since the last manual Ctrl+S was gone, with nothing asked and nothing kept.
  //
  // `wantsQuit()` still means exactly what it meant to the host loop -- STOP --
  // so main.cpp's contract is unchanged. What changed is who is allowed to set
  // it: `requestQuit()` is now a REQUEST, and a dirty document turns it into a
  // question instead of an exit. The three answers below are the only ways past
  // it, and Discard is the only one that loses anything.
  bool wantsQuit() const noexcept { return quit_; }
  // Window > Quit, the window's close box, and anything else that means "the
  // user wants out". Takes an autosave FIRST -- before the question is even
  // asked -- so the work is on disk no matter what happens next, including a
  // crash while the prompt is up.
  void requestQuit();
  // Is the application standing on the unsaved-changes question right now?
  bool quitPromptOpen() const noexcept { return quitPrompt_; }
  // How many times the guard has stopped a quit. A lifetime total: "the prompt
  // came up" is a claim about a number, so the number is kept.
  std::size_t quitPromptsRaised() const noexcept { return quitPromptsRaised_; }
  // How many times it took itself back down because the work had been saved by
  // hand while it stood. The prompt is a plain window and not a modal, so that
  // is a thing a user can do, and until this was counted it was a thing nobody
  // could see had happened.
  std::size_t quitPromptsWithdrawn() const noexcept { return quitPromptsWithdrawn_; }
  // The three answers. They RECORD intent exactly as the CoPilot's buttons do,
  // and build() applies it after the dock walk -- Save dispatches file.save,
  // which can rebuild the document and the feature tree the walk was indexing.
  // A frame must be built for a recorded answer to take effect.
  void answerQuitSave();
  void answerQuitDiscard();
  void answerQuitCancel();

  // ── AUTOSAVE: forge::ui::RecoveryService, wired ─────────────────────────
  // ui/src/DocumentStore.cpp has held a complete, gated autosave-and-crash-
  // recovery engine since it was written, and forge-desktop CONSTRUCTED IT ZERO
  // TIMES (measured: `grep -rn RecoveryService forge-desktop` -> 0 hits). This
  // is that wiring and not a second engine: the session marker, the cadence, the
  // atomic write and the change test are all the service's.
  //
  // `directory` is where the marker and the autosave live (the app uses
  // ~/.forge/recovery). Returns false, with the reason in the activity log, when
  // the marker cannot be written -- a session with no crash evidence is a fact
  // worth saying out loud rather than silent disabled recovery.
  bool beginRecoverySession(const std::string& directory);
  // Null until beginRecoverySession() succeeds. Every headless gate that does
  // not ask for autosave therefore writes no files at all.
  const forge::ui::RecoveryService* recovery() const noexcept { return recovery_.get(); }
  // One frame's worth of the cadence. `deltaSeconds` is the frame time, so the
  // clock is the application's own and a gate can step it deterministically.
  // Returns true only when an autosave was actually written.
  bool autosaveTick(double deltaSeconds);
  // "Snapshot now" -- what the quit guard calls. Still skipped when the document
  // has not changed since the last one; that is the service's rule, not a new one.
  bool autosaveNow();
  // A CLEAN exit: removes the autosave and the marker, which is what makes a
  // marker left on disk MEAN a session that died.
  bool endRecoverySession();
  // Every session in the recovery directory that is not this one: every session
  // that did not end cleanly.
  std::vector<forge::ui::RecoveryCandidate> recoverableSessions() const;
  // Reads `candidate`'s autosave back through the service and installs it as the
  // live document. The autosave is a forge::ui::DocumentModel document, so this
  // goes through that reader and lifts the feature tree across -- the two layers
  // share forge::ui::PartDocument, which is what makes this a handful of lines
  // rather than a format conversion.
  bool recoverFromAutosave(const forge::ui::RecoveryCandidate& candidate, std::string& error);
  // Whether the LAST recovery gave up the user's file name because that file was
  // NEWER than the snapshot it was recovering. "Refused" and "there was no file"
  // both leave documentPath() empty, and they are not the same event, so the one
  // that means "your own file holds work this does not" is counted separately.
  bool recoveryRefusedStalePath() const noexcept { return recoveryRefusedStalePath_; }

  // Instrumentation the frame gate asserts on.
  // ── what a menu item, a toolbar button or a palette row actually does ────
  // PUBLIC so the click gate can drive it. ForgeFrame.cpp has 35 interactive
  // widget call sites and only TWO families -- the tab button and the splitter
  // grip -- are spatially addressable from a headless test. The other 33 (10
  // MenuItems, 9 Buttons, 4 Selectables, a SmallButton, a SliderFloat, a
  // RadioButton, 2 InputTexts and a context menu) all end HERE, and this is the
  // function that fills each required parameter from its schema before
  // dispatching. A gate that re-implemented that filling would be asserting
  // against its own copy of the app's behaviour rather than the app's, so it
  // calls this instead. It has no side effect a menu click does not have.
  void invoke(const std::string& id);

  std::size_t panelsDrawn() const noexcept { return panelsDrawn_; }
  // WHICH panels were drawn, in draw order. panelsDrawn() counts; a click gate
  // has to know that the panel behind the tab it clicked is the one that came
  // up, and a count cannot say that.
  const std::vector<std::string>& panelIdsDrawn() const noexcept { return panelIdsDrawn_; }
  // Every tab button this frame drew, with the rectangle it occupies.
  const std::vector<TabHit>& tabHits() const noexcept { return tabHits_; }
  // Every splitter grip this frame drew.
  const std::vector<SplitterHit>& splitterHits() const noexcept { return splitterHits_; }
  // ── the viewport drag handles ───────────────────────────────────────────
  // Every gizmo handle this frame drew, with the pixel a pointer must be put on
  // to grab it. Empty whenever the gizmo is not up.
  const std::vector<HandleHit>& handleHits() const noexcept { return handleHits_; }
  // Is the gizmo on screen this frame? It is up exactly when the live selection
  // is ONE body that resolves against the mesh on screen.
  bool handlesVisible() const noexcept { return handlesVisible_; }
  // Is a handle being dragged right now?
  bool handleDragging() const noexcept {
    return moveHandles_.dragging() || turnHandles_.dragging();
  }
  // How many finished handle drags this builder has turned into a dispatched
  // command. "Dragging a handle edits the document" is a claim about a number,
  // so the number is kept.
  std::size_t handleEmissions() const noexcept { return handleEmissions_; }
  // The live value of the drag in flight: millimetres along the axis for a
  // translate handle, degrees about it for a rotate handle. Zero when idle.
  double handleTranslation() const noexcept { return moveHandles_.translation(); }
  double handleRotationDegrees() const noexcept { return turnHandles_.rotationDegrees(); }
  // ── THE DOCK-WALK INVARIANT ─────────────────────────────────────────────
  // How many times in this frame builder's WHOLE LIFETIME the DockLayout was
  // re-seated while the draw was still walking it. A lifetime total, not a
  // per-frame one, because every useful assertion about the violation is made
  // after the frame FOLLOWING the gesture, and a per-frame counter would have
  // zeroed itself by then. The only correct value is ZERO, always, and
  // it is a memory-safety invariant rather than a preference: drawNode() and
  // drawTabGroup() hold `const DockNode&` into shell_.layout() across their
  // whole recursion, and setActiveTabAt()/setRatioAt() end in
  // `shell_.layout() = std::move(rebuilt)`, which destroys every one of those
  // nodes. A tab click that re-seated the layout inline made the very next
  // statement -- drawPanel(node.panels[active]) -- read a freed std::string, and
  // the shipped app SIGSEGV'd at 0x17 (the size byte of the dangling short
  // string) on the FIRST tab click. Counting the violation makes the defect a
  // VALUE a gate can assert on, in any build, sanitizer or not.
  //
  // The count is OBSERVABLE because the writers do not carry the violation out:
  // an in-walk caller has its request DEFERRED to the end of the frame instead
  // of re-seating under the walk, so the process survives to be asked. Without
  // that net the counter would be unfalsifiable -- every in-walk re-seat kills
  // the process before anyone can read it -- and an unfalsifiable check is not a
  // check.
  std::size_t layoutReseatsDuringWalk() const noexcept { return reseatsDuringWalk_; }
  std::size_t treeRowsDrawn() const noexcept { return treeRowsDrawn_; }
  // Test instrumentation: screen rect of the FIRST feature-tree expander drawn this
  // frame, so a headless gate can click the real widget instead of guessing pixels.
  struct WidgetRect { float x0 = 0, y0 = 0, x1 = 0, y1 = 0; bool valid = false; };
  WidgetRect treeExpanderRect() const noexcept { return treeExpanderRect_; }

  // ── auto-update, as PLAIN DATA ──────────────────────────────────────────────
  // ForgeFrame never opens a socket. The check runs in the app layer, which owns
  // the thread and the curl call and hands the outcome back in as data; the frame
  // only RAISES a request and RENDERS a result. That split is what keeps
  // frame_gate.cpp hermetic -- a frame builder that could reach the network would
  // make every gate run depend on GitHub being up.
  // Installing and Installed are the second half of the path. Without them the
  // menu can only ever say "Forge 0.1.1 is available" at a user who has no way
  // to act on it -- the first download would be the last AUTOMATIC one, and the
  // one-time Gatekeeper approval a shipped bundle costs would be charged again
  // on every single release.
  enum class UpdateState { Idle, Checking, UpToDate, Available, Installing, Installed, Failed };
  struct UpdateInfo {
    UpdateState state = UpdateState::Idle;
    std::string version;  // the offered version, when Available
    std::string message;  // always printable, never empty once a check has run
  };
  void setUpdateInfo(const UpdateInfo& u) { update_ = u; }
  const UpdateInfo& updateInfo() const noexcept { return update_; }
  void setRunningVersion(const std::string& v) { runningVersion_ = v; }
  // Raised by the Help menu, consumed and cleared by the app layer.
  bool updateCheckRequested() const noexcept { return updateCheckPending_; }
  void clearUpdateCheckRequest() noexcept { updateCheckPending_ = false; }
  // Likewise, and deliberately a SECOND flag rather than a mode on the first:
  // installing is a different act from checking, it is the only one that writes
  // to /Applications, and a single flag would make "the user asked to check"
  // and "the user asked to install" indistinguishable at the consuming end.
  bool updateApplyRequested() const noexcept { return updateApplyPending_; }
  void clearUpdateApplyRequest() noexcept { updateApplyPending_ = false; }
  std::size_t treeRowCount() const noexcept { return tree_.rowCount(); }
  std::size_t treeMaterialized() const noexcept { return tree_.materialized(); }
  std::size_t treePeakMaterialized() const noexcept { return tree_.peakMaterialized(); }
  // How many times the source's EXPENSIVE per-row fetch has run. The whole point
  // of virtualizing is that this does not grow with the frame count.
  std::size_t treeFetches() const noexcept { return treeSource_.fetches(); }
  // The live model, for a host that wants to expand/collapse or scroll to a row
  // from outside the panel (Edit > Find, "show in tree", the gate).
  forge::ui::FeatureTreeModel& tree() noexcept { return tree_; }
  // The source, so a host can map a tree node back to the B-rep face it names.
  const SceneFeatureTreeSource& treeSource() const noexcept { return treeSource_; }
  const std::string& lastStatus() const noexcept { return status_; }

  // ── the Measure panel's data ────────────────────────────────────────────
  // The triangle soup is copied out of the scene ONCE and re-used, because the
  // tessellation does not change between frames and re-walking it per frame is
  // the same mistake virtualizing the feature tree exists to avoid. Non-const
  // because the first call is what builds it.
  const forge::ui::MeasureMesh& measureMesh();
  const forge::ui::MeshMeasure& modelMeasure();
  // What the Measure panel reports for the LIVE selection.
  forge::ui::SelectionMeasure selectionMeasure();
  // Per-face rows the Measure panel drew on its last draw.
  std::size_t measureFaceRowsDrawn() const noexcept { return measureFaceRowsDrawn_; }
  // Per-edge rows it drew. Separate counter because an edge selection and a face
  // selection are different reports, and one counter for both cannot say which
  // one was actually drawn.
  std::size_t measureEdgeRowsDrawn() const noexcept { return measureEdgeRowsDrawn_; }
  // ── the drawing ─────────────────────────────────────────────────────────
  // The 2-D documentation side of this document: the title block, the datums,
  // the notes and the geometric tolerances. It is SAVED with the part (format
  // version 2), so a drawing is part of the document rather than something the
  // panels hold until the window closes.
  const forge::ui::DrawingModel& drawing() const noexcept { return drawing_; }
  forge::ui::DrawingModel& drawing() noexcept { return drawing_; }

  // Everything the drawing panels derive from the built part and the chosen
  // sheet. Nothing in it is stored: it is recomputed whenever the tessellation
  // or the sheet choice changes, so a scale can never outlive the geometry it
  // was chosen for.
  struct DrawingLayout {
    bool modelBuilt = false;
    const forge::ui::SheetSize* sheet = nullptr;
    forge::ui::ScaleFit scale{};
    std::vector<forge::ui::DrawingView> views;
    double groupWidthMm = 0.0;
    double groupHeightMm = 0.0;
    forge::ui::MeasureBox box{};
  };
  // Non-const because the first call is what builds it, exactly like
  // measureMesh() above.
  const DrawingLayout& drawingLayout();
  // The title block as it would be drawn, for a gate that wants the values
  // without an ImGui context.
  std::vector<forge::ui::TitleBlockField> titleBlockRows();
  // What the GD&T panel says about one control.
  GdtVerdict gdtVerdict(const forge::ui::FeatureControlFrame& frame);
  // ── the drawing panels' controls, reachable without a mouse ─────────────
  // Same pattern and same reason as the CoPilot's above: a host, a macro and a
  // gate must be able to work these surfaces, and they must do it through the
  // SHIPPING path rather than a private one beside it. Each of these is the
  // exact call the panel's own button makes -- the button and the method call
  // one private body, so there is no second way to add a note.
  //
  // Each returns true when it happened; when it did not, drawingRefusal() holds
  // the sentence the panel shows.
  bool drawingAddNote(const std::string& text, forge::ui::AnnotationKind kind,
                      forge::ui::NamedView view, bool attachToPickedFace);
  bool drawingRemoveNote(const std::string& id);
  bool drawingAddDatum();  // the picked face, at the next free letter
  bool drawingRemoveDatum(char letter);
  bool drawingAddControl(forge::ui::GdtCharacteristic characteristic, double toleranceMm,
                         double basicAngleDeg, forge::ui::ControlledFeatureKind feature,
                         forge::ui::MaterialModifier modifier,
                         const std::vector<char>& datumRefs);
  bool drawingRemoveControl(const std::string& id);
  const std::string& drawingRefusal() const noexcept { return gdtAddRefusal_; }
  const std::string& noteRefusal() const noexcept { return noteRefusal_; }

  // Rows each drawing panel drew on its last draw -- the same witness the
  // Measure panel keeps, so "the panel rendered real data" is a number.
  std::size_t titleBlockRowsDrawn() const noexcept { return titleBlockRowsDrawn_; }
  std::size_t viewListRowsDrawn() const noexcept { return viewListRowsDrawn_; }
  std::size_t gdtRowsDrawn() const noexcept { return gdtRowsDrawn_; }
  std::size_t annotationRowsDrawn() const noexcept { return annotationRowsDrawn_; }

  // ── the simulation study ────────────────────────────────────────────────
  // The study the Restraints and Loads panels edit, and the answer the solver
  // last gave for it. Public so a gate drives the SHIPPING path -- the button in
  // the panel calls runStudy() and so does the gate, and there is no second way
  // in.
  const forge::ui::StudyDefinition& study() const noexcept { return study_; }
  forge::ui::StudyDefinition& study() noexcept { return study_; }
  const forge::ui::StudyOutcome& studyOutcome() const noexcept { return studyOutcome_; }
  // Picks the study's material out of the material library. Returns false,
  // changing nothing, on an id the library does not carry.
  bool setStudyMaterial(const std::string& id);
  // Solves the study against the DOCUMENT's own feature history, so the part
  // that is tested is the part on screen. Returns whether it solved; either way
  // studyOutcome() then holds what happened, and the technical cause of a
  // refusal is in the activity log rather than in the panel.
  bool runStudy();
  // True when the document has been edited since the answer below was computed.
  // A number from a part that no longer exists is worse than no number, so the
  // panels hide the answer and say so instead.
  bool studyOutcomeIsStale() const;
  std::size_t studyRuns() const noexcept { return studyRuns_; }
  // Rows the two panels drew on their last draw -- one per restraint, one per
  // force. Separate counters, because they are separate panels and one number
  // for both could not say which of them drew anything.
  std::size_t restraintRowsDrawn() const noexcept { return restraintRowsDrawn_; }
  std::size_t loadRowsDrawn() const noexcept { return loadRowsDrawn_; }

  // ── THE SKETCH PANELS' DATA ─────────────────────────────────────────────
  // Constraints, Dimensions, Relations and Curves all report ONE thing: the
  // state of the sketch the user is working in, as the constraint solver has it
  // right now. So they share ONE reading of it rather than each taking their own
  // -- four readings of one sketch is four numbers that can disagree, and the
  // solver is the expensive part besides.
  //
  // The reading is re-taken when the DOCUMENT'S PROGRAM CHANGES, on the same
  // witness the scene rebuild uses: the IR text itself, compared, never a flag
  // somebody has to remember to set. Non-const because the first call after an
  // edit is what re-takes it.
  const forge::ft::SketchInspection& sketchInspection();
  // The SKETCH statement the four panels are describing: the sketch the
  // selection is in, else the last one in the document, else 0 for "there is no
  // sketch yet", which is a state the panels say out loud rather than fake.
  int activeSketchIrId();
  // ★ THE RETURNED POINTER POINTS INTO THE CACHED READING. It stays valid for
  //   as long as the document's program does — which is the whole of one frame,
  //   because every edit reachable from a panel is deferred to after the dock
  //   walk. A caller that changes the document must RE-FETCH: the next call
  //   re-takes the reading and the old pointer names freed memory.
  const forge::ft::SketchInfo* activeSketch();
  // Rows each panel drew on its last draw. Four counters, not one: a caller
  // asking "did the Dimensions panel list the dimension" must not be answered by
  // a constraint row drawn in another tab.
  std::size_t sketchConstraintRowsDrawn() const noexcept { return sketchConstraintRows_; }
  std::size_t sketchDimensionRowsDrawn() const noexcept { return sketchDimensionRows_; }
  std::size_t sketchRelationRowsDrawn() const noexcept { return sketchRelationRows_; }
  std::size_t sketchCurveRowsDrawn() const noexcept { return sketchCurveRows_; }
  // Change one driving dimension and REBUILD. Public so the gate can drive the
  // exact path the panel's field drives, without a window.
  //
  // It goes through part.edit_feature and the ONE registry, like every other
  // edit in this class: a panel that wrote to the document directly would bypass
  // the undo stack, the journal and the enabled predicate. Returns whether the
  // document actually changed.
  bool applySketchDimensionEdit(int statementIrId, double value);
  // Which NUMBER argument of that statement the dimension is, in the index
  // part.edit_feature counts by. -1 when the statement has no number to edit,
  // which is what makes a read-only row read-only rather than a field that
  // silently does nothing.
  int sketchDimensionNumberIndex(int statementIrId) const;

  // ── the recovered B-rep edges ───────────────────────────────────────────
  // Derived from the SAME triangle soup the Measure panel uses and cached on the
  // same witness (the scene's triangle count), so a rebuild invalidates both at
  // once and a stale edge can never be picked into a live selection. Non-const
  // because the first call is what builds it.
  const forge::ui::EdgeSet& edges();
  // What the Measure panel reports for an EDGE selection.
  forge::ui::EdgeMeasure edgeMeasure();
  // The edge indices the typed selection currently names, decoded through the
  // one key() vocabulary so the overlay and the Measure panel cannot disagree.
  std::vector<std::size_t> selectedEdgeIndices();

  // ── the Model Browser's and the Sketch Tree's data ──────────────────────
  //
  // WHY THESE ARE ACCESSORS AND NOT PANEL LOCALS. Both views used to be the
  // FEATURE TREE: seven docked tabs -- Features, Model, Sketch, Assembly,
  // Operations, Studies and Sheets -- were dispatched to drawFeatureTreePanel(),
  // so six of them showed a user the build history under a name that promised
  // something else, and nothing could assert otherwise because the panel they
  // shared was itself correct.
  //
  // Each is now a real reading of the live document, computed by forge::ui and
  // therefore assertable HEADLESS: a gate can ask for the same structure the
  // panel draws and check the rows against the document that produced them,
  // which is the only thing that keeps "this tab shows the bodies" true.
  forge::ui::ModelBrowser modelBrowser() const;
  forge::ui::SketchTree sketchTree() const;
  // How many rows each of the two actually put on screen, and -- separately --
  // how many B-REP FACE rows the browser drew. Separate counters because a
  // browser that lists the bodies and silently draws no faces is a different
  // failure from one that draws nothing at all, and one number cannot say which.
  std::size_t modelRowsDrawn() const noexcept { return modelRowsDrawn_; }
  std::size_t modelFaceRowsDrawn() const noexcept { return modelFaceRowsDrawn_; }
  std::size_t sketchRowsDrawn() const noexcept { return sketchRowsDrawn_; }

  // ── the other four readings of the same document ────────────────────────
  // Assembly, Operations, Sheets and Studies. Accessors for the same reason the
  // two above are: a gate can ask for the exact structure the panel draws and
  // check its rows against the document or the measurement that produced them,
  // which is the only thing that keeps "this tab shows the components" true.
  //
  // The last two take a MEASUREMENT rather than the document, so they are
  // non-const: the first call is what builds the triangle-soup measurement they
  // read, exactly as modelMeasure() is.
  forge::ui::AssemblyTree assemblyTree() const;
  forge::ui::MachiningPlan machiningPlan() const;
  forge::ui::DrawingSheetSet drawingSheets();
  forge::ui::StudyPlan studyPlan();
  std::size_t assemblyRowsDrawn() const noexcept { return assemblyRowsDrawn_; }
  std::size_t operationRowsDrawn() const noexcept { return operationRowsDrawn_; }
  std::size_t sheetRowsDrawn() const noexcept { return sheetRowsDrawn_; }
  std::size_t studyRowsDrawn() const noexcept { return studyRowsDrawn_; }

  // ── the six that stopped being empty next ───────────────────────────────
  // Constraints, Relations and Solver are three readings of the sketch family
  // the document carries; Isocline and Continuity are two readings of the
  // tessellation the viewport is already drawing; Tools is what the cuts call
  // for. Accessors for the same reason the four above are: a gate can ask for
  // the exact structure the panel draws and check its rows against the document
  // or the measurement that produced them.
  forge::ui::SketchDiagnosisSet sketchDiagnosis() const;
  forge::ui::DraftReport draftReport();
  forge::ui::ContinuityReport continuityReport();
  forge::ui::ToolList toolList() const;
  std::size_t constraintRowsDrawn() const noexcept { return constraintRowsDrawn_; }
  std::size_t relationRowsDrawn() const noexcept { return relationRowsDrawn_; }
  std::size_t solverRowsDrawn() const noexcept { return solverRowsDrawn_; }
  std::size_t draftRowsDrawn() const noexcept { return draftRowsDrawn_; }
  std::size_t continuityRowsDrawn() const noexcept { return continuityRowsDrawn_; }
  std::size_t toolLibraryRowsDrawn() const noexcept { return toolLibraryRowsDrawn_; }

  // ── the Isocline panel's two controls, reachable without a mouse ────────
  // The pull direction and the taper the JOB asks for are the user's choices,
  // not properties of the part, so they live here and the panel changes them.
  // Exposed so a gate can drive them without pretending to click.
  void setDraftPull(forge::ui::PullAxis axis) noexcept { draftPull_ = axis; }
  forge::ui::PullAxis draftPull() const noexcept { return draftPull_; }
  void setRequiredDraft(double degrees) noexcept;
  double requiredDraft() const noexcept { return draftRequiredDeg_; }
  // The measurement of ONE B-rep face, memoized on the live tessellation. The
  // arithmetic is forge::ui::measureFace's -- this adds a cache and nothing
  // else, because a model browser lists every face and asking the O(triangles)
  // function once per face per frame is quadratic in the body's size.
  const forge::ui::FaceMeasure& faceMeasure(std::uint32_t faceId);

  // ── the Archie Tools panel's data ───────────────────────────────────────
  forge::ui::ToolCatalog toolCatalog() const;
  std::size_t toolRowsDrawn() const noexcept { return toolRowsDrawn_; }

  // ── the four panels that stopped being empty ────────────────────────────
  // Rows each drew on its last draw. Separate counters, one per panel, for the
  // reason measureFaceRowsDrawn/measureEdgeRowsDrawn are separate: one counter
  // over two reports cannot say which report was actually drawn.
  std::size_t materialRowsDrawn() const noexcept { return materialRowsDrawn_; }
  std::size_t curveRowsDrawn() const noexcept { return curveRowsDrawn_; }
  std::size_t dimensionRowsDrawn() const noexcept { return dimensionRowsDrawn_; }
  // ── the assembly panels' row counts ─────────────────────────────────────
  // One counter per panel, reset at the top of each draw. A gate asserts that a
  // panel given a real multi-body model draws a row per thing the kernel
  // measured -- which is the difference between "the tab opened" and "the tab
  // showed the user their model".
  std::size_t bomRowsDrawn() const noexcept { return bomRowsDrawn_; }
  std::size_t contactRowsDrawn() const noexcept { return contactRowsDrawn_; }
  std::size_t componentRowsDrawn() const noexcept { return componentRowsDrawn_; }
  std::size_t mateRowsDrawn() const noexcept { return mateRowsDrawn_; }
  // The text the Components panel is filtering its list by. Exposed so a gate
  // can drive the filter without pretending to type.
  void setComponentFilterText(const std::string& text);
  const char* componentFilterText() const noexcept { return componentQuery_; }

  // ── the Components panel's controls, reachable without a mouse ──────────
  // For a host, a macro and the gate. The checkbox, the two buttons and the
  // per-row "Only" call THESE, so a caller drives the SHIPPING path -- including
  // the latch that tells the host to re-upload the vertex stream -- rather than
  // a private one beside it. Calling the scene directly would hide a body and
  // leave the viewport drawing it until something else happened to redraw.
  bool showBody(std::uint32_t bodyIndex, bool visible);
  void showEveryBody();
  void showOnlyBody(std::uint32_t bodyIndex);
  void hideEveryBody();

  // ── the trust panels' data ──────────────────────────────────────────────
  // What the last check answered, and whether it still describes the model on
  // screen. `qualityStale()` is a WITNESS, not a flag: it compares the program
  // the check ran against with the program the scene is currently built from,
  // so a rebuild nobody remembered to announce still marks the answer old.
  const ModelQualityReport& quality() const noexcept { return scene_.lastQuality(); }
  bool qualityRan() const noexcept { return qualityRan_; }
  bool qualityStale() const;
  // Ask for a check on the next frame. Public so a gate can drive the same
  // request the button records.
  void requestQualityCheck() noexcept { pendingQualityCheck_ = true; }
  std::size_t qualityChecksRun() const noexcept { return qualityChecksRun_; }
  // Rows each trust panel drew on its last draw, so a gate asserts on what
  // reached the screen rather than on what was available to draw.
  std::size_t clashRowsDrawn() const noexcept { return clashRowsDrawn_; }
  std::size_t verifyRowsDrawn() const noexcept { return verifyRowsDrawn_; }
  std::size_t zebraCellsDrawn() const noexcept { return zebraCellsDrawn_; }
  // The settings the next check will use. Public so a gate can drive the pull
  // direction the buttons set.
  QualitySettings& qualitySettings() noexcept { return qualitySettings_; }
  const QualitySettings& qualitySettings() const noexcept { return qualitySettings_; }

  // Selection round-trip: the viewport writes a pick here, the frame turns it
  // into a typed EntityRef through SelectionService and re-flags the mesh.
  void setPreselectedFace(std::uint32_t faceId);
  void clickFace(std::uint32_t faceId, bool additive);
  // The same round trip for an EDGE. `index` indexes edges(); kNoEdge clears.
  // Without this pair the app could produce no EntityRef of kind Edge at all,
  // and the three edge-signature commands in the registry -- part.fillet,
  // part.chamfer, part.variable_fillet -- were unreachable from every gesture.
  void setPreselectedEdge(std::size_t index);
  void clickEdge(std::size_t index, bool additive);

  // THE THIRD PRODUCER, and the one the other two could not stand in for.
  // clickFace makes an EntityKind::Face and clickEdge an EntityKind::Edge, and
  // SelectionSignature::satisfiedBy compares kinds EXACTLY -- so 28 of the 80
  // commands in the registry named a kind the interface could never produce and
  // were greyed out for ever: part.extrude and part.revolve, every boolean,
  // every pattern, mirror/move/rotate, loft, skin, thicken and the whole sketch
  // family. The CoPilot could drive all of them; a person could not.
  //
  // A feature-tree row IS a document statement, which is exactly what those
  // signatures want. The kind comes from forge::ui::entityKindFor(), never from
  // a mapping this class invents. `additive` is the shift-click, which is how
  // two bodies are picked for a boolean and three points for a sketch arc.
  void clickFeature(int irId, bool additive);
  // TRUE when the live selection filter means the viewport picks edges. The
  // filter is the status strip's existing control; before this it could only
  // REFUSE picks, because nothing ever offered it an Edge.
  bool edgePickMode() const;
  // The status strip's filter set to `body`. It is a THIRD viewport pick mode,
  // not a variant of the face one: the ray still strikes a face, but what the
  // click NAMES is the solid that face belongs to.
  bool bodyPickMode() const;
  // The ONE body reference this viewport can produce, built exactly as
  // clickFeature builds it for the same solid -- same bodyId, same
  // persistentName -- so picking the part in the viewport and picking its row
  // in the feature tree produce the IDENTICAL ref. Two spellings of one
  // selection would make `toggle` add a duplicate instead of removing it, and
  // would make part.move's exactly(Body, 1) signature refuse a selection that
  // looks like one body. False when the document has no solid to name.
  bool activeBodyRef(forge::ui::EntityRef& out) const;
  void setPreselectedBody(bool under);
  void clickBody(bool under, bool additive);
  // Which faces the VIEWPORT should light. Not selectedFaceIds(): that one
  // answers the Measure panel, and a Body selection names no face at all -- so
  // the two questions have different answers and must not share a function. A
  // selected body lights ALL of its faces, which is how a user sees that the
  // thing they are about to drag is the thing they picked.
  std::vector<std::uint32_t> highlightFaceIds() const;

  // ── the feature PARAMETER editor ────────────────────────────────────────
  // Which statement, and which of its NUMBER arguments, the Properties panel is
  // editing. This is frame-builder state by the same rule as the palette query:
  // forge::ui owns the document and the command, and what owns "the row the user
  // is pointing at" is the frame. Statement 0 means the last statement, which is
  // what part.edit_feature's `feature` parameter also means -- one convention,
  // not two.
  int editFeatureId() const noexcept { return editFeatureId_; }
  std::size_t editParamIndex() const noexcept { return editParamIndex_; }
  // Clamps to a statement that exists and a NUMBER argument it actually has, and
  // re-seeds the edit field from the value that argument currently holds -- so a
  // panel can never show a stale number beside a different feature's name.
  void setEditTarget(int irId, std::size_t paramIndex);
  // How many NUMBER arguments the current target has. 0 means "nothing here is
  // editable", which is the honest answer for CUT(%2, %3).
  std::size_t editParamCount() const;
  // The value that parameter holds in the document right now.
  double editParamValue() const;
  // Dispatch part.edit_feature for the current target through the ONE registry
  // and re-sync the viewport. Returns whether the document actually changed.
  bool applyFeatureEdit(double value);

  // Palette visibility is app state, not shell state.
  bool paletteOpen() const noexcept { return paletteOpen_; }
  void togglePalette() noexcept { paletteOpen_ = !paletteOpen_; }

  // ── the parameter prompt ────────────────────────────────────────────────
  // What a command with a REQUIRED parameter and no honest default does instead
  // of failing. `file.open` needs a path and "" is not one; `part.edit_feature`
  // needs the new value of a parameter and inventing one would let a menu click
  // silently resize the part. Those two are the whole list, and it is DERIVED --
  // forge::ui::gestureBlockedCommands() computes it from the schemas, so a
  // command that grows a defaultless required parameter starts prompting by
  // itself rather than starting to fail.
  //
  // Before this, ForgeFrame::invoke() fabricated a value for every required
  // parameter (a path became the literal "untitled.fpart") so the prompt could
  // not arise -- and the keyboard, which goes through the shell's own
  // ForgeShell::invoke(), died on missing_required_parameter instead. One
  // registry with two parameter policies is the defect the registry exists to
  // prevent.
  bool promptOpen() const noexcept { return promptOpen_; }
  const std::string& promptCommand() const noexcept { return promptCommand_; }
  // The parameters still being collected, in schema order.
  std::vector<std::string> promptParameters() const;
  // Fill one prompted parameter by name. Returns false when this prompt has no
  // such field, rather than silently creating one the command will not read.
  bool setPromptValue(const std::string& name, const std::string& value);
  // What that box currently HOLDS — the seed before the user types, and what
  // they typed after. "" for a field this prompt does not have.
  //
  // It exists because the seeding is the whole reopen fix and there was no way
  // to assert it: a gate could call pathPromptSeed() and be checking a helper
  // the prompt is free to stop calling, which is the "delegating and not
  // enumerating" mistake in miniature. This reads the FIELD.
  std::string promptValue(const std::string& name) const;
  // WHICH KIND OF BOX that field is, from the command's own schema. Public for
  // the same reason promptValue() is: the four Flag parameters are drawn as a
  // CHECKBOX and the rest as a text box, and a gate that could not see the type
  // would be asserting that a boolean is offered without being able to say it is
  // offered as a boolean. Text for a field this prompt does not have.
  forge::ui::ParamType promptFieldType(const std::string& name) const;
  // Dispatch the prompted command with what has been collected. Returns whether
  // it ran. Public so a gate can drive the whole prompt path by name, the way it
  // drives invoke().
  bool submitPrompt();
  void cancelPrompt() noexcept;

  // What a `path` box STARTS on: the open document, else the most recent one
  // this installation opened or saved, else "". "" is the honest answer on a
  // first-ever launch -- there is nothing to suggest, and inventing a path that
  // does not exist would put a refusal one Enter away.
  //
  // Public so the gate can assert it without a window, and because it is the
  // whole of the reopen fix: `documentPath_` is empty on every launch, so
  // without the recent list Ctrl+O offers an empty box and the only way back to
  // yesterday's part is to type its absolute path from memory.
  std::string pathPromptSeed() const;

  // Open one remembered document, through the SAME `file.open` the menu, the
  // keyboard, the palette and `--open` dispatch -- registry, undo contract,
  // activity log and all. Deferred to the end of the frame like every other
  // command that can replace the document, so the dock walk is never holding a
  // node into a tree this is about to rebuild.
  void requestOpenDocument(const std::string& path);
  // The path requested but not yet dispatched; "" when there is none.
  const std::string& pendingOpenPath() const noexcept { return pendingOpenPath_; }

  // ── THE NATIVE FILE PANEL ───────────────────────────────────────────────
  //
  // WHAT WAS BROKEN. PR #206 registered six file commands and the registry went
  // 80 -> 84. Four of them declare `path` REQUIRED with no honest default, so a
  // menu click reached DispatchStatus::MissingRequiredParameter and this class
  // answered with an ImGui text box: to open a part, a user had to know and type
  // an absolute path. That is a command layer that works and a mouse layer that
  // does not.
  //
  // INSTALLED, NOT OWNED, and nullable. main.cpp constructs the macOS panel and
  // hands it in; every headless gate leaves it null and gets the text prompt
  // that has always been here, so nothing this class already does changes shape
  // when there is no window to put a panel over. It is also what lets the
  // file-dialog gate drive the WHOLE path with a scripted panel and no mouse.
  void setFileDialog(FileDialog* dialog) noexcept { fileDialog_ = dialog; }
  FileDialog* fileDialog() const noexcept { return fileDialog_; }

  // The command whose panel is owed but has not been shown yet; "" when none is.
  // Deferred exactly like the tab click and Open Recent, and for a REASON THIS
  // CLASS HAS ALREADY PAID FOR THREE TIMES: invoke() is called from inside
  // BeginMainMenuBar(), from inside the ribbon and from inside the dock walk,
  // and a modal panel runs a nested event loop and then dispatches a command
  // that can replace the document and rebuild the feature tree -- under a walk
  // still holding references into both.
  const std::string& pendingFileDialog() const noexcept { return pendingDialogId_; }

  // Shows the owed panel and dispatches with what the user chose. PUBLIC for the
  // same reason applyPendingFit() is: a gate must be able to drive the shipping
  // path without building a frame. build() calls it after the dock walk, so the
  // application reaches it by exactly one route.
  void runPendingFileDialog();

  // How many panels this frame builder has shown, and how many of those the user
  // cancelled. A cancel is a NO-OP -- no dispatch, no refusal, no error -- and
  // "nothing happened" is not observable without a counter that says a panel
  // really was shown and really was declined.
  std::size_t fileDialogsShown() const noexcept { return dialogsShown_; }
  std::size_t fileDialogsCancelled() const noexcept { return dialogsCancelled_; }

  // ── THE MANUFACTURING PANELS ────────────────────────────────────────────
  // Four tabs -- Tool Library, Stock, Post Output and Materials -- share ONE
  // computation, cached behind a witness. These readers exist so a headless gate
  // can assert on the values the panels DRAW, against independent calls into the
  // same kernel, without a window: everything below is what is on screen.
  const forge::desktop::cam::PartOutline& camOutline() const noexcept { return camOutline_; }
  const forge::desktop::cam::StockBlock& camStock() const noexcept { return camStock_; }
  const forge::desktop::cam::CamPlan& camPlan() const noexcept { return camPlan_; }
  const forge::desktop::cam::StockCutReport& camCut() const noexcept { return camCut_; }
  // How many times the whole chain was actually recomputed. The cache claim is
  // only meaningful if something counts it.
  std::size_t camRecomputes() const noexcept { return camRecomputes_; }
  // Rows the panels actually put in front of somebody this frame. A model that
  // holds the right numbers and a panel that draws none of them is the defect
  // these panels exist to end, so the two are counted separately.
  std::size_t camToolRowsDrawn() const noexcept { return camToolRowsDrawn_; }
  std::size_t camProgramRowsDrawn() const noexcept { return camProgramRowsDrawn_; }
  std::size_t camStockRowsDrawn() const noexcept { return camStockRowsDrawn_; }
  std::size_t camMaterialRowsDrawn() const noexcept { return camMaterialRowsDrawn_; }

  std::uint32_t camToolId() const noexcept { return camToolId_; }
  // Public so a gate can drive the tool choice the way a click does. Refuses an
  // id the library does not hold rather than leaving the panels pointing at a
  // tool that does not exist.
  bool setCamToolId(std::uint32_t id);
  float camSectionZ() const noexcept { return camSectionZ_; }
  void setCamSectionZ(float z);
  // What the Materials panel and the Properties panel BOTH report. One call, so
  // the two cannot answer the same question differently.
  forge::ui::MassProperties partMass() const;
  // The id of the material the open document holds. "unassigned" when none has
  // been chosen, which is a real document state and has to be nameable.
  const std::string& partDocumentMaterialId() const noexcept {
    return partDoc_.material().id;
  }

  // ── dock mutations ──────────────────────────────────────────────────────
  // Public because they are the layout's write API, not a splitter-drag detail:
  // a host uses them for "reset column widths", for restoring a workspace, and
  // for "show this panel" (which is a tab switch). `path` addresses a node from
  // the main window's root, one child index per step. Both REBUILD the layout
  // from a mutated copy rather than reaching past DockLayout's interface, so
  // what the user sees and what serialize() writes cannot diverge.
  void setRatioAt(const std::vector<std::size_t>& path, double ratio);
  void setActiveTabAt(const std::vector<std::size_t>& path, std::size_t active);
  // ── "show me that panel" ────────────────────────────────────────────────
  // Finds the tab group holding `panelId` in the main window and makes it the
  // active tab, so a caller can bring a panel to the front by NAME instead of by
  // a path it had to work out itself. Returns false when this layout has no such
  // panel -- which is the honest answer for a workspace that does not hold it.
  bool focusPanel(const std::string& panelId);

 private:
  // Panels
  void drawMenuBar();
  void drawWorkspaceTabs(float y, float width, float height);
  void drawToolbar(float y, float width, float height);
  void drawStatusStrip(float y, float width, float height);
  void drawDockedPanels(const forge::ui::Rect& area, std::uint64_t viewportTexture);
  void drawNode(const forge::ui::DockNode& node, const forge::ui::Rect& r,
                const std::vector<std::size_t>& path, std::uint64_t viewportTexture);
  void drawTabGroup(const forge::ui::DockNode& node, const forge::ui::Rect& r,
                    const std::vector<std::size_t>& path, std::uint64_t viewportTexture);
  void drawSplitter(const forge::ui::Rect& r, bool vertical,
                    const std::vector<std::size_t>& path, double ratio,
                    double parentExtent);
  void drawPanel(const std::string& panelId, std::uint64_t viewportTexture);
  void drawViewportPanel(std::uint64_t viewportTexture);
  void drawFeatureTreePanel();
  // The two panels the feature tree used to stand in for.
  void drawModelBrowserPanel();
  void drawSketchTreePanel();
  void drawPropertiesPanel();
  void drawConsolePanel();
  void drawTimelinePanel();
  void drawMeasurePanel();
  // The four panels that stopped being empty. Each draws ONLY quantities
  // forge::ui::InspectionReport (or MeasureModel / EdgeModel) computed, so every
  // number on screen is one a headless gate has already asserted.
  void drawMaterialPanel();
  void drawCurveListPanel();
  void drawDimensionsPanel();
  void drawTitleBlockPanel();
  void drawViewListPanel();
  void drawGdtPanel();
  void drawAnnotationPanel();
  // One editable title-block row. Returns true when the user changed it. Not a
  // draw* function by name on purpose: it draws one widget, and the draw*
  // census is about PANELS.
  bool editTextField(const char* id, std::string& value, char* buffer, std::size_t size);
  // The stable reference for a picked face, built in ONE place: the selection,
  // the datums and the notes all have to name a face the same way or a drawing
  // saved today stops resolving tomorrow.
  forge::ui::EntityRef faceRefFor(std::uint32_t faceId) const;
  void drawRestraintsPanel();
  void drawLoadsPanel();
  // The material, the mesh density, the Run button and the last answer. Drawn at
  // the foot of BOTH simulation panels, from one function, so the two cannot
  // disagree about what the study is set to or what it last said.
  void drawStudyFooter(const char* scopeId);
  void drawToolsPanel();
  // ── THE FOUR TREE TABS THAT DREW NOTHING AT ALL ─────────────────────────
  // Assembly, Operations, Sheets and Studies each named a tab, said in one
  // sentence what it would show, and stopped. Each now draws a DIFFERENT
  // reading of the live document, computed by forge::ui::WorkspaceTrees so
  // every row and every number is one a headless gate has already asserted --
  // ui/test/workspace_trees_test.cpp -- rather than one this file invented.
  void drawAssemblyTreePanel();
  void drawOperationTreePanel();
  void drawSheetTreePanel();
  void drawStudyTreePanel();
  void drawConstraintsPanel();
  void drawRelationsPanel();
  void drawSolverStatusPanel();
  // ── THE ASSEMBLY PANELS ─────────────────────────────────────────────────
  // Four tabs that used to draw one apologetic sentence between them. They are
  // all fed by the SAME body inventory the kernel takes off the B-rep at build
  // time (KernelScene.hpp, SceneBody / SceneBodyPair / SceneBodyAlignment), so
  // no two of them can disagree about how many bodies there are or how far
  // apart they sit -- and none of them computes geometry of its own.
  void drawBomPanel();
  void drawContactsPanel();
  void drawComponentFilterPanel();
  void drawMatesPanel();
  // What the four of them say when there is no inventory to show: either the
  // model has not built, or it built something with no solid bodies in it.
  // Returns true when it drew such a state and the caller must stop. ONE
  // function, because four tabs that answer the same question four different
  // ways is how a user learns to distrust all four.
  bool drawAssemblyEmptyState();
  // Puts every face of one body into the live selection, so a row in a list
  // lights the body up in the 3D view. Goes through the same SelectionService
  // a viewport click goes through -- there is no second way to select.
  void selectBody(std::uint32_t bodyIndex);
  // "Body 3". One spelling, used by all four panels and by the gate.
  static std::string bodyLabel(std::uint32_t bodyIndex);

  // ── the trust panels ────────────────────────────────────────────────────
  // Interference, Verification, Continuity, Draft and Zebra: the five tabs an
  // engineer opens to decide whether a model can be trusted. Every number they
  // draw comes from KernelScene::lastQuality(), which is what the kernel's own
  // queries answered about the solid on screen.
  void drawInterferencePanel();
  void drawVerifyReportPanel();
  void drawContinuityPanel();
  void drawIsoclinePanel();
  void drawZebraPanel();
  // The shared top of all five: the title, the Check button, and whether the
  // answer on screen still belongs to the model on screen. Returns true when
  // there is a report to draw below it.
  bool beginQualityPanel(const char* panelId);
  // Runs the check. Deferred out of the dock walk like every other mutation,
  // because it can take seconds and pumps the host while it waits.
  void runQualityCheck();
  void drawCopilotPanel();
  // The work the three recorded presses stand for. Private: the ONLY caller is
  // build(), after the walk.
  void runCopilotSubmit();
  void runCopilotApply();
  void runCopilotDiscard();
  void drawToolLibraryPanel();
  void drawPostOutputPanel();
  void drawStockPanel();
  void drawMaterialsPanel();
  // Recomputes the section, the stock, the toolpath and the stock simulation
  // when -- and only when -- something they depend on has moved. Called at the
  // top of each of the four panels above, so a workspace with none of them open
  // pays nothing.
  void ensureCamPlan();
  // Dispatches the material the Materials panel asked for, through the ONE
  // registry. Deferred like every other mutation in this class.
  void runPendingMaterial();

  // The four sketch panels. They share one reading of the sketch and one header,
  // so "which sketch am I looking at" and "how is it doing" cannot be answered
  // two different ways on two tabs.
  void drawSketchConstraintsPanel();
  void drawSketchDimensionsPanel();
  void drawSketchRelationsPanel();
  void drawSketchCurvesPanel();
  // Draws the shared title + health line and returns the sketch, or draws the
  // empty state and returns nullptr. `title` is what this tab is called.
  const forge::ft::SketchInfo* drawSketchHeader(const char* title, const char* emptyLine1,
                                                const char* emptyLine2);
  // How a statement is named to a user: "Line 6", "Point 2", "Circle 17".
  std::string sketchEntityName(const forge::ft::SketchInfo& s, int irId) const;
  void drawGenericPanel(const std::string& panelId);
  void drawCommandPalette();
  void drawViewportOverlays(float x, float y, float w, float h);
  void drawContextMenu();
  // ── ONBOARDING: what to do with an empty window ─────────────────────────
  // Drawn over the viewport when the document holds no features. Every action
  // on it is DERIVED — forge::ui::buildEmptyState() asks the registry which
  // commands emit feature IR and need no selection, so a new primitive appears
  // here without this file being edited — and every sample is a COMMAND
  // SEQUENCE replayed through the one registry, never pasted IR.
  void drawEmptyState(float x, float y, float w, float h);

  // Command helpers — every invocation goes through ForgeShell::run.
  bool commandEnabled(const std::string& id) const;
  std::string shortcutText(const std::string& id) const;

  // What the status strip reports for the LIVE selection: the area of the picked
  // faces, or the length of the picked edges, or "-" when nothing measurable is
  // picked. The SAME arithmetic the Measure panel prints, over the same
  // triangles and the same ids, because two readouts of one selection that can
  // disagree will.
  std::string statusMeasurement();

  // ── the frame's command surfaces, rebuilt once at the top of build() ─────
  // WHY ONCE. Each of these is a walk of the whole registry that runs every
  // command's enabled predicate. Asking per menu item would make the menu bar
  // O(n^2) in the command count, and the registry is a list that only grows.
  //
  // WHY AT ALL, WHICH IS THE MORE IMPORTANT HALF. What a menu contains, in what
  // order, greyed out or not, with which shortcut beside it and which sentence
  // in its tooltip used to be computed inline in this file — and CI did not
  // compile this file. Now the DECISIONS are forge::ui::CommandSurface, which
  // ui/test/command_surface_test.cpp holds in its hand and compares, and what is
  // left here is walking a vector and calling ImGui::MenuItem.
  void rebuildCommandSurfaces();
  forge::ui::SurfaceContext surfaceContext() const;

  void syncSelectionToScene();
  // Re-expands and re-flattens the tree after the DOCUMENT's record set changed.
  // There is no row-copying step any more: SceneFeatureTreeSource reads
  // PartDocument::records() itself, so this only has to re-derive the expansion
  // and the flattened index.
  void rebuildTree();
  // Seeds an empty document with defaultPartStatements(). Returns false (and
  // says which statement) if the document refuses one, rather than starting on a
  // half-seeded part.
  bool seedDefaultPart(std::string& error);
  // Guarantees the document's last statement is nameable by the selection. A
  // .fpart written by another tool (or by hand) need carry no NODE line at all,
  // and a body nothing names cannot be picked or modified.
  void ensureBodyBinding();
  // The face ids the typed selection currently names. One decoder, used by the
  // viewport highlight AND by the Measure panel, so the two cannot disagree
  // about which faces are picked.
  std::vector<std::uint32_t> selectedFaceIds() const;
  // Draws one edge's polyline into the viewport overlay, projected through the
  // live camera. Edges are highlighted here rather than in the vertex stream
  // because a segment is not a triangle: scene_.applySelection flags VERTICES of
  // picked faces, and there is no face to flag for an edge.
  void drawEdgePolyline(const forge::ui::MeshEdge& edge, float x, float y, float w, float h,
                        std::uint32_t colour, float thickness);

  // ── THE VIEWPORT DRAG HANDLES (forge::ui::Manipulator, wired) ───────────
  // The gizmo's target: the pivot, the arm length and the box the ghost is drawn
  // from. False when the live selection is not exactly ONE body that resolves
  // against the mesh currently on screen -- which is the only state in which
  // "drag this" has an unambiguous meaning.
  bool manipulatorTarget(double pivot[3], double& armLength, forge::ui::MeasureBox& box);
  // Hover, grab, drag and release, in that order, over the SAME projection the
  // renderer uploads. Returns true when the gizmo has taken the pointer, which
  // is what stops the same click from also picking a face behind the handle and
  // what stops a mid-drag camera gesture from fighting the drag.
  bool updateManipulator(float x, float y, float w, float h, bool hovered);
  // Draws what updateManipulator hit-tested: the three arrows, the three rings,
  // and -- while a drag is in flight -- the moved bounding box and the live
  // value. Every point comes from Manipulator::axisTip / ringPoint through
  // ViewportProjection::project, so what is drawn IS what is grabbable.
  void drawManipulator(float x, float y, float w, float h);

  forge::ui::ForgeShell& shell_;
  KernelScene& scene_;

  // The Part workspace's receiver + caretaker. They must outlive the registry
  // because the command handlers capture them (PartCommands.hpp says so).
  //
  // DECLARED BEFORE THE TREE, and that ordering is load-bearing: members are
  // constructed in declaration order, SceneFeatureTreeSource now binds a
  // reference to partDoc_, and forge::ui::FeatureTreeModel's CONSTRUCTOR calls
  // rebuild() -- which walks the source, which reads partDoc_.records(). With
  // the old order (tree first) that read would touch a member whose lifetime had
  // not begun.
  forge::ui::PartDocument partDoc_;
  forge::ui::UndoStack partUndo_;
  bool partWired_ = false;

  SceneFeatureTreeSource treeSource_;
  forge::ui::FeatureTreeModel tree_;

  // ── document state ──────────────────────────────────────────────────────
  // `builtProgram_` is the IR the SCENE currently holds. Comparing it to
  // partDoc_.irProgram() is the whole dirty check: a witness taken from the
  // thing itself, not a flag somebody has to remember to set.
  std::string builtProgram_;
  // The last program syncSceneToDocument() ATTEMPTED, successful or not.
  //
  // builtProgram_ answers "what is on screen" and must only ever name a program
  // that really built. That alone cannot also be the do-I-have-work guard: after a
  // refused statement the document holds a program builtProgram_ does not name, so
  // the guard would report work to do on every frame and the same doomed rebuild
  // would run for ever. MEASURED when this was missing: click_gate's "the viewport
  // already matches the document after <id>" failed once per command, 96 times.
  std::string lastAttemptedProgram_;
  std::string documentPath_;              // "" until saved or opened
  std::string documentName_ = "untitled";
  bool documentDirty_ = false;
  bool geometryDirty_ = false;            // latched for the host's re-upload
  // Latched the same way, and kept SEPARATE from geometryDirty_ on purpose: a
  // body shown or hidden resizes the vertex buffer without changing the model,
  // and the host drains the device for one and not the other.
  bool visibilityDirty_ = false;
  // ── THE CAMERA IS NOT A FUNCTION OF THE VERTEX BUFFER ────────────────────
  // geometryDirty_ answers "must the host re-upload?", which is true after
  // EVERY rebuild including one the kernel refused. It was also, in
  // main.cpp's frame loop, the answer to "must the camera be re-framed?" --
  // and those are different questions. MEASURED on the unfixed tree: orbit,
  // zoom to distance 108.87, pan the target to (-1.457, -3.397, 12.106), then
  // change one fillet radius; the target snapped back to (0, 0, 10) and the
  // distance to 144.90. The same reset happened after a rebuild that FAILED,
  // when nothing on screen had moved at all. Iterating a dimension -- the core
  // CAD loop -- therefore cost a re-orbit and a re-zoom per Apply.
  //
  // So framing is latched HERE, on the three events that are about the
  // DOCUMENT rather than about the mesh, and the host no longer decides it.
  bool refitCameraPending_ = false;
  std::size_t cameraRefits_ = 0;
  std::size_t rebuilds_ = 0;
  std::string rebuildError_;
  // The shell's fitCount as of the last fit this builder actually applied. The
  // constructor frames the body once, so it starts at the shell's initial 0.
  std::size_t fitsApplied_ = 0;
  // The same watermark for the two camera verbs added beside it. Separate
  // counters rather than one, because framing the selection and orienting the
  // camera are independent requests and a shared counter would let one swallow
  // the other.
  std::size_t viewsApplied_ = 0;
  std::size_t selectionFitsApplied_ = 0;

  // ── the viewport drag handles ───────────────────────────────────────────
  // TWO manipulators rather than one with a mode, and that is not a style
  // choice. Manipulator::setMode() CANCELS any drag in flight, so a single
  // instance hit-tested for arrows and then for rings would cancel its own drag
  // twice per frame; and the arrow tip and the ring sit at the same radius when
  // they share a size, so a pick at the tip is ambiguous. Two instances give the
  // rings a LARGER radius than the arms, which is the separation every CAD
  // triad draws, and neither ever changes mode.
  forge::ui::Manipulator moveHandles_;
  forge::ui::Manipulator turnHandles_;
  // The ONE projection both the draw and the hit test go through -- built from
  // the SAME matrix Camera::viewProj() hands the renderer, so a handle can never
  // be drawn where the hit test does not look.
  forge::ui::ViewportProjection handleView_;
  bool handlesVisible_ = false;
  std::vector<HandleHit> handleHits_;
  // The selection's box, kept so the drag can draw the moved ghost without
  // re-resolving the selection every frame.
  forge::ui::MeasureBox handleBox_{};
  std::size_t handleEmissions_ = 0;
  // What a finished drag asks for, DEFERRED past the dock walk exactly like
  // pendingInvokeId_ below: the viewport is drawn inside drawNode()'s recursion,
  // and part.move / part.rotate rebuild the document, the feature tree and the
  // scene the walk is still holding references into.
  bool pendingHandleDispatch_ = false;
  std::string handleCommand_;
  forge::ui::CommandParams handleParams_;

  // ── Measure panel cache, and the witness that MUST be the build count ────
  //
  // ★ MEASURED DEFECT, fixed here. The witness used to be the scene's TRIANGLE
  // COUNT, on the reasoning that a re-tessellation changes it. It does not: a
  // PARAMETRIC EDIT that leaves the topology alone re-tessellates to the same
  // triangle count with entirely different coordinates. Editing the starting
  // part's rectangle from 80 mm wide to 60 mm rebuilt the body (the scene's own
  // bounding box went to 60.000) and the Measure panel went on reporting
  // 80.000 x 50.000 x 20.000, with the old area, the old volume and the old
  // centre of mass, indefinitely -- a plausible WRONG number, which is worse
  // than no number, because a user believes it.
  //
  // KernelScene::builds() increments on every successful re-tessellation and on
  // nothing else, so it cannot collide the way a count of triangles can. Both
  // caches take it, because two witnesses for one tessellation is how one of
  // them goes stale.
  forge::ui::MeasureMesh measureMesh_;
  forge::ui::MeshMeasure meshMeasure_{};
  std::size_t measureBuilds_ = 0;
  bool measureBuilt_ = false;

  // ── the drawing, and its derived layout ─────────────────────────────────
  forge::ui::DrawingModel drawing_;
  DrawingLayout drawingLayout_{};
  bool drawingLayoutBuilt_ = false;
  // The witnesses the layout was computed from. All four are inputs to the
  // answer, so all four invalidate it: a sheet change with a stale triangle
  // count would print a scale chosen for a different part.
  std::size_t drawingTriangles_ = 0;
  std::string drawingSheetId_;
  forge::ui::ProjectionAngle drawingProjection_ = forge::ui::ProjectionAngle::First;
  forge::ui::ScaleMode drawingScaleMode_ = forge::ui::ScaleMode::Automatic;
  forge::ui::Scale drawingFixedScale_{1, 1};

  // Panel edit buffers. ImGui's text widget writes into a char array, and these
  // are refreshed from the document every frame the widget is NOT being typed
  // in -- so an undo, an Open or a New is visible immediately and a half-typed
  // value is never overwritten under the cursor.
  static constexpr std::size_t kTitleFieldCount = 8;
  static constexpr std::size_t kTitleFieldSize = 96;
  char titleFields_[kTitleFieldCount][kTitleFieldSize] = {};
  char noteText_[256] = {};
  int noteKindIndex_ = 0;
  int noteViewIndex_ = 0;
  bool noteAttach_ = true;
  int gdtCharIndex_ = 0;
  int gdtFeatureIndex_ = 0;
  int gdtModifierIndex_ = 0;
  float gdtTolerance_ = 0.05f;
  float gdtBasicAngle_ = 45.0f;
  // The primary, secondary and tertiary datum a new control references. 0 means
  // "none"; n means the (n-1)th letter that exists on the part. Three slots
  // because ASME Y14.5 allows three, and their ORDER is the precedence.
  int gdtDatumSlot_[3] = {0, 0, 0};
  // The last refusal each add form produced, kept so the sentence stays on
  // screen after the click that caused it rather than flashing for one frame.
  std::string gdtAddRefusal_;
  std::string noteRefusal_;
  std::size_t titleBlockRowsDrawn_ = 0;
  std::size_t viewListRowsDrawn_ = 0;
  std::size_t gdtRowsDrawn_ = 0;
  std::size_t annotationRowsDrawn_ = 0;

  // The recovered edges, on the SAME triangle-count witness as the measure
  // cache. Two witnesses for one tessellation is how one of them goes stale.
  forge::ui::EdgeSet edges_;
  std::size_t edgeBuilds_ = 0;
  bool edgesBuilt_ = false;
  std::size_t hoverEdge_ = forge::ui::kNoEdge;

  // ── the manufacturing panels' shared state and cache ────────────────────
  //
  // WHY ONE CACHE FOR FOUR PANELS. The section, the toolpath, the posted program
  // and the stock simulation are ONE chain: the stock's depth comes from the
  // block, the toolpath comes from the section, the program comes from the
  // toolpath and the simulation comes from both. Computing them per panel would
  // let the Stock tab and the Post Output tab disagree about the operation they
  // are both describing.
  //
  // WHY A WITNESS AND NOT A FLAG. `camControls_` records the inputs the cache was
  // built from, INCLUDING the scene's own build counter and triangle count, so a
  // rebuild under the panels invalidates it without anyone remembering to say so.
  struct CamControls {
    std::uint32_t toolId = 0;
    int side = 0;
    int post = 0;
    float sectionZ = 0.0f;
    float stockSide = 0.0f;
    float stockTop = 0.0f;
    float spindlePercent = 0.0f;
    float stepdown = 0.0f;
    std::size_t builds = 0;
    std::size_t triangles = 0;
    bool operator==(const CamControls& o) const noexcept {
      return toolId == o.toolId && side == o.side && post == o.post && sectionZ == o.sectionZ &&
             stockSide == o.stockSide && stockTop == o.stockTop &&
             spindlePercent == o.spindlePercent && stepdown == o.stepdown && builds == o.builds &&
             triangles == o.triangles;
    }
  };
  std::uint32_t camToolId_ = 1;
  int camSideIndex_ = 1;   // 0 inside the line, 1 outside it, 2 on it
  int camPostIndex_ = 0;   // 0 Fanuc, 1 Heidenhain, 2 Siemens
  float camSectionZ_ = 0.0f;
  // Seeded ONCE, at the middle of the part. Re-seeding on every rebuild would
  // drag the slider out from under anybody who had moved it.
  bool camSectionSeeded_ = false;
  float camStockSideMm_ = 5.0f;
  float camStockTopMm_ = 2.0f;
  float camSpindlePercent_ = 100.0f;
  float camStepdownMm_ = 0.0f;  // 0 asks for half the tool diameter
  CamControls camControls_{};
  bool camPlanValid_ = false;
  std::size_t camRecomputes_ = 0;
  forge::desktop::cam::PartOutline camOutline_{};
  forge::desktop::cam::StockBlock camStock_{};
  forge::desktop::cam::CamPlan camPlan_{};
  forge::desktop::cam::StockCutReport camCut_{};
  std::size_t camToolRowsDrawn_ = 0;
  std::size_t camProgramRowsDrawn_ = 0;
  std::size_t camStockRowsDrawn_ = 0;
  std::size_t camMaterialRowsDrawn_ = 0;
  // The material a click asked for, dispatched after the dock walk for the same
  // reason every other mutation in this class is: it runs a command that touches
  // the document while the walk still holds references into it.
  std::string pendingMaterialId_;

  // ── the trust panels' state ─────────────────────────────────────────────
  // `qualityProgram_` is the IR the last check measured. Comparing it with
  // `builtProgram_` is the whole staleness test, taken from the things
  // themselves rather than from a flag somebody has to remember to set.
  QualitySettings qualitySettings_;
  std::string qualityProgram_;
  bool qualityRan_ = false;
  bool pendingQualityCheck_ = false;
  std::size_t qualityChecksRun_ = 0;
  std::size_t clashRowsDrawn_ = 0;
  std::size_t zebraCellsDrawn_ = 0;
  int zebraFace_ = 0;  // which face's stripes are drawn; 0 = the first one

  Camera camera_;
  ViewportRequest viewportRequest_;
  // The TRANSLATED sentence, not the cause. The cause is in the activity log.
  std::string viewportUnavailable_;

  // Frame-builder-owned UI state.
  bool paletteOpen_ = false;
  bool paletteFocus_ = false;
  char paletteQuery_[128] = {0};
  int paletteIndex_ = 0;

  // ── the parameter prompt's fields ───────────────────────────────────────
  // A fixed char buffer per field rather than a std::string, because that is
  // what ImGui::InputText writes into. `type` records which of setText/setNumber/
  // setFlag the value has to go back through: a number typed into a text box is
  // still a number to the command, and passing "6" as text would fail the schema
  // check with no visible reason.
  //
  // It is the SCHEMA'S type and not a bool, because the sheet now offers every
  // declared parameter and four of them are Flags (part.loft's `ruled` and
  // `open`, part.skin's `ruled`, part.variable_fillet's `smooth`). A Flag written
  // back through setText lands in a map the handler's params().flag() never
  // reads, which is a box that silently does nothing -- worse than no box.
  struct PromptField {
    std::string name;
    forge::ui::ParamType type = forge::ui::ParamType::Text;
    std::array<char, 256> value{};
  };
  // Which theme the ImGui style currently HOLDS, so the frame can notice that
  // app.toggle_theme moved the shell's mode. `styleApplied_` distinguishes "the
  // mode happens to equal the enum's zero value" from "nothing has been applied
  // yet" — a bool that starts false is the witness; comparing an enum against
  // its own default is not.
  bool styleApplied_ = false;
  forge::ui::ThemeMode appliedTheme_ = forge::ui::ThemeMode::Dark;
  float appliedDpi_ = 0.0f;

  // ── operation progress ──────────────────────────────────────────────────
  // Driven by the one place that does work long enough to be worth reporting:
  // syncSceneToDocument(), which compiles the IR program and tessellates it. The
  // strip reads it through buildStatusSummary(), so a future long operation
  // reports itself by begin()/end() and needs no new status plumbing.
  forge::ui::ProgressTracker progress_;

  // The three surfaces this frame draws from, all derived from the ONE registry.
  forge::ui::CommandSurface menuSurface_;
  forge::ui::CommandSurface ribbonSurface_;
  forge::ui::CommandSurface contextSurface_;

  bool promptOpen_ = false;
  bool promptFocus_ = false;
  // Whether the LAST invoke() actually did the thing. Read by submitPrompt(),
  // which must not infer it from journal().back(): the journal is a shared
  // success log that a keystroke, the CoPilot or a macro also append to.
  bool lastInvokeOk_ = false;
  std::string promptCommand_;
  std::vector<PromptField> promptFields_;
  // ── THE TWO WITNESSES `promptCommand_ == id` WAS BEING ASKED FOR ──────────
  // It was carrying two different questions at once, and they are not the same
  // question:
  //
  //   "the values are already in hand, dispatch them"   -- the sheet's own Run
  //   "a sheet is standing on this command"             -- an ordinary click on
  //                                                        the menu or the ribbon
  //                                                        WHILE it stands
  //
  // The sheet is a plain window and not a modal (drawParameterPrompt says so and
  // why), so the menu and the ribbon stay live behind it and the second case is
  // an ordinary thing for a user to do. Reading it as the first is what made a
  // second click DISPATCH SILENTLY behind the standing sheet -- measured as two
  // statements out of (click, click, Run).
  //
  // `promptSubmitting_` is true only while submitPrompt() is inside invoke(), so
  // it answers the first question and nothing else can set it.
  bool promptSubmitting_ = false;
  // How many times a sheet has been RAISED. submitPrompt() reads it across its
  // own dispatch to tell "invoke() put a new sheet up because the command still
  // needs a parameter" (a correction the user can type) from "the sheet I opened
  // with is simply still there" (a refusal nothing in the box can fix). The
  // string-and-flag test it replaces could not tell those apart, so a fillet
  // refused for an empty selection left its sheet standing for ever.
  std::size_t promptOpens_ = 0;
  // Deferred for the same reason as every other mutation in this class: Submit
  // dispatches a command that can rebuild the document, the feature tree and the
  // scene, and the tree is the container the walk is indexing.
  bool pendingPromptSubmit_ = false;

  // ── a command asked for from INSIDE the dock walk ───────────────────────
  // The empty state's buttons and the viewport context menu are drawn inside a
  // docked panel, so they are inside drawNode()'s recursion. A command
  // dispatched there rebuilds the document, the feature tree and the scene while
  // the walk still holds references — the exact shape that has already shipped
  // three crashes in this class. Recorded here and dispatched by build() once
  // the walk has returned, like the tab click, the splitter drag, the tree
  // expander and the CoPilot's buttons.
  //
  // ONE slot, not a queue: these are single-click gestures, and a user cannot
  // press two menu items in one frame. The LAST one recorded wins, which is the
  // one they clicked.
  std::string pendingInvokeId_;

  // The Open Recent click, on the same one-slot deferral and for the same
  // reason. It is a SEPARATE slot from pendingInvokeId_ because it carries an
  // argument: the path decides which document, and pendingInvokeId_ has nowhere
  // to put one.
  std::string pendingOpenPath_;

  // Dispatches pendingOpenPath_ and clears it. Called by build() after the dock
  // walk, never from inside a draw function.
  void runPendingOpen();

  // ── the file panel's three slots ────────────────────────────────────────
  // `fileDialog_` is null in every headless build; see setFileDialog().
  //
  // `pendingDialogId_` is the one-slot deferral, exactly like pendingInvokeId_:
  // a user cannot click two File menu items in one frame, and the last gesture
  // recorded is the one they made.
  //
  // `dialogCommand_` / `dialogPath_` are how the chosen path reaches the
  // dispatch. runPendingFileDialog() sets them and calls invoke() again; invoke()
  // reads them as an OVERRIDE for exactly the command they name -- the same
  // mechanism promptCommand_/promptFields_ already use for the text box, so a
  // path from a panel and a path typed by hand travel the identical route into
  // CommandParams and there is no second dispatch path to disagree.
  FileDialog* fileDialog_ = nullptr;
  std::string pendingDialogId_;
  std::string dialogCommand_;
  std::string dialogPath_;
  std::size_t dialogsShown_ = 0;
  std::size_t dialogsCancelled_ = 0;

  // True when `id` is owed a panel RIGHT NOW: there is a dialog installed, this
  // command has a policy, we are not already answering its panel, and the
  // registry says the only thing standing between the command and running is the
  // path we are about to ask for. Reading the registry rather than re-deciding
  // here is what keeps a disabled command from raising a panel it cannot use.
  bool wantsFileDialog(const std::string& id, const forge::ui::CommandParams& overrides) const;

  // Where a panel should open. The document's own path first, then the most
  // recent one, then the document's NAME -- so a Save on a never-saved part
  // starts on "untitled" rather than on nothing at all.
  // fileDialogRequestFor() puts the COMMAND's own suffix on whatever this
  // returns, which is why the seed itself does not depend on the command.
  std::string fileDialogSeed() const;

  // Writes whether the kernel is running out of process into the ACTIVITY LOG,
  // where a user can still find it. main.cpp prints the same fact to stderr,
  // which a Finder launch does not have. Called once, from wirePartCommands().
  void reportKernelIsolation();

  // `seed` is the CommandParams this invocation WOULD HAVE DISPATCHED. Passing it
  // is what keeps the sheet from making anything slower: every box opens holding
  // the value the command was about to use, so Run alone reproduces the old
  // behaviour exactly and typing is only for when you want something else.
  // nullptr keeps the two historical seeds (a path, a feature value) and nothing
  // more, which is what the keystroke and file-dialog paths still want.
  void openPrompt(const std::string& id, const std::vector<std::string>& parameters,
                  const forge::ui::CommandParams* seed = nullptr);
  // Should this invocation ASK before it runs? True for any command that declares
  // a parameter, EXCEPT when the values are already in hand -- the sheet's own Run
  // (promptCommand_), a finished gizmo drag (handleCommand_) or a path chosen in
  // the file panel (dialogCommand_) all re-enter invoke() with their answers, and
  // asking again would be a loop rather than a dialog -- and EXCEPT the six
  // commands whose parameter entry is the native file panel, which is a way of
  // asking this application already has.
  bool wantsParameterSheet(const std::string& id) const;
  void drawParameterPrompt();

  // ── the unsaved-changes question ────────────────────────────────────────
  // Drawn after the dock walk, beside the parameter prompt, and for the same
  // reason stated there.
  void drawQuitPrompt();
  // The answer the user gave, applied after the walk. One slot: a user cannot
  // press two of three buttons in one frame.
  enum class QuitAnswer { None, Save, Discard, Cancel };
  QuitAnswer pendingQuitAnswer_ = QuitAnswer::None;
  void applyPendingQuitAnswer();
  // Set when the user answered "Save, then quit". Resolved at the END of
  // build(), after the file panel has had its turn: an untitled document raises
  // a panel from inside invoke(), so whether the save happened is not knowable
  // on the line that asked for it.
  bool quitAfterSave_ = false;
  void resolveQuitAfterSave();
  // The one place quit_ is allowed to become true. Ends the recovery session on
  // the way out, which is what turns "a marker is still there" into evidence.
  void grantQuit();
  bool quitPrompt_ = false;
  std::size_t quitPromptsRaised_ = 0;
  // How many times the question WITHDREW itself because the unsaved changes it
  // was asking about had been saved by hand while it stood. A lifetime total,
  // for the same reason quitPromptsRaised_ is one.
  std::size_t quitPromptsWithdrawn_ = 0;

  // ── autosave ────────────────────────────────────────────────────────────
  // The storage is a plain member and the service holds a reference to it, so
  // the declaration order here is load-bearing exactly as partDoc_'s is.
  forge::ui::FileSystemStorage recoveryStorage_;
  std::unique_ptr<forge::ui::RecoveryService> recovery_;
  // The application's own clock, in milliseconds, accumulated from frame times.
  // NOT a wall clock: a gate steps it, and the cadence is then a value rather
  // than a wait.
  std::uint64_t autosaveClockMillis_ = 0;
  // How often the cadence is even ASKED. RecoveryService::tick() takes the
  // document by const reference and this class has to BUILD that document to
  // hand it over, so asking sixty times a second would copy the feature tree
  // sixty times a second to be told "not due". The service still owns the real
  // cadence; this only bounds how often it is consulted.
  std::uint64_t autosaveProbeAtMillis_ = 0;
  // The document as forge::ui::DocumentModel sees it -- the form RecoveryService
  // writes. Built from the live PartDocument on each autosave rather than kept
  // in step, so there is no second document to drift.
  forge::ui::DocumentModel autosaveSnapshot() const;
  // The DRAWING half of that snapshot, which no forge::ui::DocumentModel can
  // carry -- see kAutosaveDrawingSuffix at the top of this header for the format
  // collision that puts it in a file of its own. Written through the same
  // storage seam and skipped when it has not changed, which is the service's own
  // rule applied to the one piece of the document the service cannot see.
  // Returns true only when it actually wrote.
  bool writeAutosaveDrawing();
  // The snapshot File > New and File > Open take before they replace a document
  // that has unsaved changes in it. NEITHER OF THEM ASKS -- see the comment over
  // documentNew() in the .cpp, which states that hole rather than hiding it.
  void autosaveDiscardedWork(const char* what);
  // The bytes last written by the line above. The comparison that keeps an
  // unchanged drawing from spinning a disk every fifteen seconds.
  std::string lastAutosavedDrawing_;
  // When the drawing is next due, on the application's own clock. Separate from
  // the service's cadence because the service decides the TREE's due-ness from a
  // digest this class cannot see, and autosaveTick()'s 250 ms probe is a bound
  // on asking rather than a cadence -- see the comment at the call site.
  std::uint64_t autosaveDrawingDueAtMillis_ = 0;
  // The drawing that belongs to `candidate`, by the ladder recoverFromAutosave()
  // documents: the snapshot beside the autosave, else the user's own file, else
  // NOTHING -- and "nothing" is the answer that also refuses the path, because a
  // document whose drawing is unknown must not be one keystroke from overwriting
  // the file that still has it.
  bool recoverDrawingFor(const forge::ui::RecoveryCandidate& candidate,
                         forge::ui::DrawingModel& out, bool& adoptPath, std::string& why) const;
  // ── THE SECOND QUESTION THE LADDER ABOVE DOES NOT ASK ──────────────────
  // recoverDrawingFor() asks "can I account for the drawing?". This asks the
  // other one: IS THE FILE I AM ABOUT TO TAKE THE NAME OF NEWER THAN THE
  // SNAPSHOT? A recovery that adopts a path is one keystroke from writing over
  // that file, so a file written AFTER the snapshot holds work the snapshot
  // cannot contain -- whatever kind of work it is, which is why this is not
  // part of the drawing ladder. True means the name must be refused, and `why`
  // is the sentence the activity log gets.
  bool fileIsNewerThanSnapshot(const forge::ui::RecoveryCandidate& candidate,
                               std::string& why) const;
  // Reset by recoverFromAutosave() at its FIRST line, so it always describes the
  // last recovery that ran rather than the last one that got far enough to
  // decide. It used to be written only on the success path, and the two early
  // returns above it left the previous answer standing. See the accessor.
  bool recoveryRefusedStalePath_ = false;
  // ── THE PATH A RECOVERY REFUSED, KEPT SO IT CANNOT BE REBUILT ───────────
  // documentSave() invents a target out of documentName_ when it has no path,
  // and recoverFromAutosave() gives up the PATH while keeping the NAME -- so a
  // bare Ctrl+S after a refusal reconstructed the refused file exactly. This is
  // the one path the untitled fallback may never produce, whether or not a file
  // is sitting on it: the user has been told to keep their own copy while they
  // compare, and moving it out of the way must not hand its name back. Empty
  // when the last recovery adopted its path, or when there was no recovery.
  std::string refusedSavePath_;
  // The unsaved-changes question is a plain window, not a modal, so every other
  // gesture still works while it stands -- including Ctrl+S. This re-reads the
  // condition the question was raised on and withdraws it when that condition is
  // gone, so the window cannot go on claiming unsaved changes that no longer
  // exist. Called once per frame, immediately before the question is drawn.
  void refreshQuitPrompt();

  bool quit_ = false;
  std::string status_ = "Ready";
  std::vector<std::string> log_;
  // Which severities the activity panel shows: 0 all, 1 warnings and above,
  // 2 errors only. A view filter, never a recording filter — every dispatch is
  // recorded whatever this says, or "show me everything" could not go back.
  int logLevel_ = 0;
  std::size_t panelsDrawn_ = 0;
  std::vector<std::string> panelIdsDrawn_;
  std::vector<TabHit> tabHits_;
  std::vector<SplitterHit> splitterHits_;
  // ── deferred mutations, and why every one of them is deferred ───────────────
  // ONE root cause, found THREE times in this frame builder: a gesture mutates a
  // container while the draw walk still holds indices or references into it.
  //
  //  1. TAB CLICK      setActiveTabAt() ends in `shell_.layout() = std::move(rebuilt)`,
  //                    which destroys every DockNode the recursion holds by const
  //                    reference; drawTabGroup then dereferenced the freed node and the
  //                    SHIPPED app SIGSEGV'd at 0x17 -- the size byte of the dangling
  //                    std::string -- on the very first tab click.
  //  2. SPLITTER DRAG  setRatioAt() ends in the same re-seat, and drawNode() reads
  //                    node.children[1] on the next line.
  //  3. TREE EXPANDER  tree_.rebuild() inside the ImGuiListClipper loop changes
  //                    rows_.size() while the clipper iterates a range sized from the
  //                    PREVIOUS rowCount, so the next rowAt() threw std::out_of_range
  //                    and the app aborted.
  //
  // All three RECORD here; build() applies them after the walk has finished and no
  // reference is live. The layout still changes on the same frame -- it changes when
  // nothing is pointing into it.
  bool pendingTabValid_ = false;
  std::vector<std::size_t> pendingTabPath_;
  std::size_t pendingTabIndex_ = 0;
  bool pendingRatioValid_ = false;
  std::vector<std::size_t> pendingRatioPath_;
  double pendingRatioValue_ = 0.0;
  bool pendingExpandValid_ = false;
  forge::ui::NodeId pendingExpandId_{};
  bool pendingExpandState_ = false;
  // The CoPilot's three buttons, deferred for the SAME reason as the three
  // above: Send re-seats nothing itself, but Apply dispatches commands that
  // rebuild the document, the feature tree and the scene -- and the feature tree
  // is the container the walk is indexing.
  bool pendingCopilotSubmit_ = false;
  bool pendingCopilotApply_ = false;
  bool pendingCopilotDiscard_ = false;
  // Non-zero while drawNode()/drawTabGroup() are walking the dock tree. The
  // write API reads it to count violations of the invariant above.
  std::size_t walkDepth_ = 0;
  std::size_t reseatsDuringWalk_ = 0;
  std::size_t treeRowsDrawn_ = 0;
  WidgetRect treeExpanderRect_{};
  UpdateInfo update_{};
  bool updateApplyPending_ = false;
  std::string runningVersion_;
  bool updateCheckPending_ = false;
  // ── the sketch panels' shared reading ───────────────────────────────────
  // `sketchProgram_` is the IR the reading was taken from. Comparing it to
  // partDoc_.irProgram() is the whole staleness check -- a witness taken from
  // the thing itself, the same idiom builtProgram_ uses for the scene.
  forge::ft::SketchInspection sketchInspection_;
  std::string sketchProgram_;
  bool sketchInspected_ = false;
  std::size_t sketchConstraintRows_ = 0;
  std::size_t sketchDimensionRows_ = 0;
  std::size_t sketchRelationRows_ = 0;
  std::size_t sketchCurveRows_ = 0;
  // The dimension field's live value, and which statement it belongs to. Held
  // per statement id rather than per row index, because a row index moves when
  // the document does and would silently retarget the field.
  int sketchEditIrId_ = 0;
  float sketchEditValue_ = 0.0f;
  // A dimension edit asked for from INSIDE the dock walk, deferred like every
  // other mutation in this class: part.edit_feature rewrites the document, which
  // rebuilds the feature tree the walk is indexing.
  bool pendingSketchEditValid_ = false;
  int pendingSketchEditIrId_ = 0;
  double pendingSketchEditValue_ = 0.0;

  std::size_t measureFaceRowsDrawn_ = 0;
  std::size_t measureEdgeRowsDrawn_ = 0;
  std::size_t toolRowsDrawn_ = 0;
  std::size_t materialRowsDrawn_ = 0;
  std::size_t curveRowsDrawn_ = 0;
  std::size_t verifyRowsDrawn_ = 0;
  std::size_t dimensionRowsDrawn_ = 0;
  std::size_t bomRowsDrawn_ = 0;
  std::size_t contactRowsDrawn_ = 0;
  std::size_t componentRowsDrawn_ = 0;
  std::size_t mateRowsDrawn_ = 0;
  // The Components panel's list filter. A fixed buffer because that is what an
  // input box writes into.
  char componentQuery_[64] = {0};
  std::size_t modelRowsDrawn_ = 0;
  std::size_t modelFaceRowsDrawn_ = 0;
  std::size_t sketchRowsDrawn_ = 0;
  std::size_t assemblyRowsDrawn_ = 0;
  std::size_t operationRowsDrawn_ = 0;
  std::size_t sheetRowsDrawn_ = 0;
  std::size_t studyRowsDrawn_ = 0;
  std::size_t constraintRowsDrawn_ = 0;
  std::size_t relationRowsDrawn_ = 0;
  std::size_t solverRowsDrawn_ = 0;
  std::size_t draftRowsDrawn_ = 0;
  std::size_t continuityRowsDrawn_ = 0;
  std::size_t toolLibraryRowsDrawn_ = 0;
  // The Isocline panel's two choices. +Z because it is the direction this
  // program's own extrude runs in; three degrees is a STARTING VALUE the panel
  // shows and the user changes, and it is a requirement of the job rather than
  // anything measured from the part.
  forge::ui::PullAxis draftPull_ = forge::ui::PullAxis::ZPlus;
  double draftRequiredDeg_ = 3.0;
  // Per-face measurement cache, indexed by 1-based face id and invalidated on
  // the SAME witness measureMesh() uses -- the scene's BUILD COUNT -- so a
  // rebuild can never leave a face row describing the previous body.
  std::vector<forge::ui::FaceMeasure> faceCache_;
  std::vector<char> faceCached_;
  std::size_t faceCacheBuilds_ = 0;
  bool faceCacheBuilt_ = false;

  // ── the simulation study ────────────────────────────────────────────────
  // Panel state, like the CoPilot's transcript: the restraints and forces a user
  // has set up belong to the surface they are looking at. The ANSWER is not
  // panel state -- it comes from the solver, through StudyHost, and
  // `studyProgram_` is the witness that keeps it honest: it records the feature
  // history the answer was computed from, so an edit makes the answer STALE
  // rather than silently wrong. That is the same witness measureTriangles_ is,
  // and for the same reason.
  forge::ui::StudyDefinition study_;
  forge::ui::StudyOutcome studyOutcome_;
  std::string studyProgram_;
  std::size_t studyRuns_ = 0;
  std::size_t restraintRowsDrawn_ = 0;
  std::size_t loadRowsDrawn_ = 0;
  // The pickers at the foot of each panel. Indices into allStudyFaces().
  int restraintFacePick_ = 0;
  int loadFacePick_ = 1;
  bool restraintHold_[3] = {true, true, true};
  // Zero, deliberately: an input box that starts with a number in it is a
  // number the application made up, and Add stays disabled until the person
  // using it types one.
  float loadForce_[3] = {0.0f, 0.0f, 0.0f};

  // ── the CoPilot ─────────────────────────────────────────────────────────
  // Owned here because it is panel state, not document state: the transcript,
  // the request in flight and the plan on offer belong to the surface the user
  // is looking at. It writes nothing itself -- every edit it causes goes through
  // shell_.run(), the same door a menu click uses.
  forge::ui::ArchieCopilot copilot_;
  // The planner that ships: deterministic, offline, always present. It is the
  // FALLBACK, never removed, so the app still plans when no model is running.
  forge::ui::LocalPlanner copilotPlanner_;
  // Optional model-backed planner, tried FIRST when set. A pointer to the
  // abstract base on purpose: forge-desktop gains no dependency on the archie
  // module, and a build without it is not a build with a hole in it.
  forge::ui::Planner* copilotRemote_ = nullptr;
  bool copilotAutoPlan_ = true;
  std::string copilotFramePath_;   // host-captured PNG of the live window, or empty
  std::string copilotInput_;
  // PLAN rows only -- one per step of the verdict on offer. The transcript is
  // counted separately: a caller asking "did the panel draw a row per planned
  // step" is asking about the plan, and folding a growing chat log into that
  // number would make the answer depend on how much had been said.
  std::size_t copilotRowsDrawn_ = 0;
  std::size_t copilotTranscriptRowsDrawn_ = 0;
  char toolQuery_[96] = {0};
  std::uint32_t hoverFace_ = 0;
  float dpiScale_ = 1.0f;
  // Live parameter for the next parametric command, edited in Properties.
  float paramValue_ = 3.0f;
  // Live parameter of an EXISTING feature, edited in Properties. Distinct from
  // paramValue_ on purpose: one feeds the next command, this one rewrites a
  // statement already in the program, and sharing a field would make "change the
  // fillet I made" and "make the next fillet" the same control.
  int editFeatureId_ = 0;
  std::size_t editParamIndex_ = 0;
  float editValue_ = 0.0f;

  void note(const std::string& line);
};

// The words a person reads for one sketch constraint, from the IR keyword the
// kernel dispatches ("DIST" -> "Distance"). Exposed so the sketch-panel gate can
// require a row for EVERY keyword forge::ft::conKeywords() carries: a keyword
// with no row falls back to its own spelling, which is legible but terse, and a
// silent fallback is how a wired constraint comes to be shown to a user as a
// shouted abbreviation for ever.
std::string sketchConstraintLabel(const std::string& keyword);

// Applies the Forge dark style. Exposed so the headless gate styles its context
// exactly as the app does — a style that only the app applies is a style nobody
// tests.
void applyForgeStyle(float dpiScale);
// The same style in a named THEME. Every colour comes from forge::ui::Theme,
// whose contrast is audited (ui/test/shell_ux_test.cpp requires body text over
// the window to clear WCAG AA in both modes) rather than eyeballed. The overload
// above means Dark, so no existing caller changes.
void applyForgeStyle(float dpiScale, forge::ui::ThemeMode mode);

// The canonical key name for an ImGui key code, matching forge::ui::Keymap's
// vocabulary ("A", "F5", "Delete", "Tab", "Home"). Empty when unmapped.
std::string canonicalKeyName(int imguiKey);

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_FORGEFRAME_HPP
