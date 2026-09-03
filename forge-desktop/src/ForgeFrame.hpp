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
#include "KernelScene.hpp"
#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandSurface.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/Onboarding.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/StatusModel.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/Types.hpp"

struct ImDrawList;

namespace forge::desktop {

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
class ForgeFrame final : public forge::ui::DocumentHost {
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
  const forge::ui::PlanRequest* copilotRequest() const noexcept;
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

  // ── forge::ui::DocumentHost ─────────────────────────────────────────────
  bool documentNew(std::string& error) override;
  // EMPTY, not "new": no starter part is seeded. app.load_sample is about to
  // write a sample's own statements into the document, and stacking fourteen of
  // them on top of the starter part's five would produce a program that is
  // neither. documentNew() is File > New and keeps its seed.
  bool documentReset(std::string& error) override;
  bool documentOpen(const std::string& path, std::string& error) override;
  bool documentSave(const std::string& path, std::string& error) override;
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

  // The shell state the host loop needs.
  bool wantsQuit() const noexcept { return quit_; }
  void requestQuit() noexcept { quit_ = true; }

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
  // The measurement of ONE B-rep face, memoized on the live tessellation. The
  // arithmetic is forge::ui::measureFace's -- this adds a cache and nothing
  // else, because a model browser lists every face and asking the O(triangles)
  // function once per face per frame is quadratic in the body's size.
  const forge::ui::FaceMeasure& faceMeasure(std::uint32_t faceId);

  // ── the Archie Tools panel's data ───────────────────────────────────────
  forge::ui::ToolCatalog toolCatalog() const;
  std::size_t toolRowsDrawn() const noexcept { return toolRowsDrawn_; }

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

  // ── dock mutations ──────────────────────────────────────────────────────
  // Public because they are the layout's write API, not a splitter-drag detail:
  // a host uses them for "reset column widths", for restoring a workspace, and
  // for "show this panel" (which is a tab switch). `path` addresses a node from
  // the main window's root, one child index per step. Both REBUILD the layout
  // from a mutated copy rather than reaching past DockLayout's interface, so
  // what the user sees and what serialize() writes cannot diverge.
  void setRatioAt(const std::vector<std::size_t>& path, double ratio);
  void setActiveTabAt(const std::vector<std::size_t>& path, std::size_t active);

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
  void drawToolsPanel();
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
  void drawCopilotPanel();
  // The work the three recorded presses stand for. Private: the ONLY caller is
  // build(), after the walk.
  void runCopilotSubmit();
  void runCopilotApply();
  void runCopilotDiscard();
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
  std::string documentPath_;              // "" until saved or opened
  std::string documentName_ = "untitled";
  bool documentDirty_ = false;
  bool geometryDirty_ = false;            // latched for the host's re-upload
  // Latched the same way, and kept SEPARATE from geometryDirty_ on purpose: the
  // host re-frames the camera on a rebuild and must not re-frame it when a body
  // is merely hidden.
  bool visibilityDirty_ = false;
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

  forge::ui::EdgeSet edges_;
  std::size_t edgeBuilds_ = 0;
  bool edgesBuilt_ = false;
  std::size_t hoverEdge_ = forge::ui::kNoEdge;

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
  // what ImGui::InputText writes into. `text` records which of setText/setNumber
  // the value has to go back through: a number typed into a text box is still a
  // number to the command, and passing "6" as text would fail the schema check
  // with no visible reason.
  struct PromptField {
    std::string name;
    bool text = true;
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

  void openPrompt(const std::string& id, const std::vector<std::string>& parameters);
  void drawParameterPrompt();
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
  std::size_t measureFaceRowsDrawn_ = 0;
  std::size_t measureEdgeRowsDrawn_ = 0;
  std::size_t toolRowsDrawn_ = 0;
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
  // Per-face measurement cache, indexed by 1-based face id and invalidated on
  // the SAME witness measureMesh() uses -- the scene's BUILD COUNT -- so a
  // rebuild can never leave a face row describing the previous body.
  std::vector<forge::ui::FaceMeasure> faceCache_;
  std::vector<char> faceCached_;
  std::size_t faceCacheBuilds_ = 0;
  bool faceCacheBuilt_ = false;

  // ── the CoPilot ─────────────────────────────────────────────────────────
  // Owned here because it is panel state, not document state: the transcript,
  // the request in flight and the plan on offer belong to the surface the user
  // is looking at. It writes nothing itself -- every edit it causes goes through
  // shell_.run(), the same door a menu click uses.
  forge::ui::ArchieCopilot copilot_;
  forge::ui::LocalPlanner copilotPlanner_;
  bool copilotAutoPlan_ = true;
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
