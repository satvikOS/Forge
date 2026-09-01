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

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "Camera.hpp"
#include "KernelScene.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"
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

  // Build the frame. Must be called between ImGui::NewFrame() and ImGui::Render().
  // `viewportTexture` is 0 when there is no 3D texture yet (headless, or the
  // first frame before the renderer has drawn one).
  void build(std::uint64_t viewportTexture, float dpiScale);

  const ViewportRequest& viewport() const noexcept { return viewportRequest_; }
  Camera& camera() noexcept { return camera_; }
  const Camera& camera() const noexcept { return camera_; }

  // The shell state the host loop needs.
  bool wantsQuit() const noexcept { return quit_; }
  void requestQuit() noexcept { quit_ = true; }

  // Instrumentation the frame gate asserts on.
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
  // IT COUNTS ALL THREE CONTAINERS, not just the dock. The name says "layout"
  // because the dock is where it started, but a mid-walk `tree_.rebuild()` is the
  // same defect against a different container -- the walk holds a row range sized
  // before the rebuild instead of a node reference freed by it -- and it aborted
  // the app just as hard. setTreeExpandedAt() reports into this same counter, so
  // the one assertion a gate makes covers every container the walk holds.
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
  enum class UpdateState { Idle, Checking, UpToDate, Available, Failed };
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

  // ── the Archie Tools panel's data ───────────────────────────────────────
  forge::ui::ToolCatalog toolCatalog() const;
  std::size_t toolRowsDrawn() const noexcept { return toolRowsDrawn_; }

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

  // ── dock mutations ──────────────────────────────────────────────────────
  // Public because they are the layout's write API, not a splitter-drag detail:
  // a host uses them for "reset column widths", for restoring a workspace, and
  // for "show this panel" (which is a tab switch). `path` addresses a node from
  // the main window's root, one child index per step. Both REBUILD the layout
  // from a mutated copy rather than reaching past DockLayout's interface, so
  // what the user sees and what serialize() writes cannot diverge.
  void setRatioAt(const std::vector<std::size_t>& path, double ratio);
  void setActiveTabAt(const std::vector<std::size_t>& path, std::size_t active);
  // THE THIRD CONTAINER'S WRITER, and it exists for the same reason the two
  // above do. The dock had a safety net and a counter; the feature tree had
  // NEITHER, even though it is where the third mid-walk crash actually happened
  // (tree_.rebuild() resizing rows_ while ImGuiListClipper iterates a range sized
  // from the PREVIOUS rowCount, then std::out_of_range out of rowAt()). The
  // gesture site records and defers correctly, so the shipped path is fixed --
  // but nothing stopped or counted a DIRECT call from inside the walk, so a
  // reintroduction would have aborted the process with the invariant still
  // reading zero. Routing every tree mutation through one writer is what makes
  // the counter tell the truth about all three containers rather than two.
  void setTreeExpandedAt(const forge::ui::NodeId& id, bool expanded);

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
  void drawPropertiesPanel();
  void drawConsolePanel();
  void drawTimelinePanel();
  void drawMeasurePanel();
  void drawToolsPanel();
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

  // Command helpers — every invocation goes through ForgeShell::run.
  void invoke(const std::string& id);
  bool commandEnabled(const std::string& id) const;
  std::string shortcutText(const std::string& id) const;

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
  std::size_t rebuilds_ = 0;
  std::string rebuildError_;
  // The shell's fitCount as of the last fit this builder actually applied. The
  // constructor frames the body once, so it starts at the shell's initial 0.
  std::size_t fitsApplied_ = 0;

  // Measure panel cache. `measureTriangles_` is the triangle count the cache was
  // built from: it is the cheap witness that the scene has not been re-built
  // under us, so a stale measurement cannot be printed as a live one.
  forge::ui::MeasureMesh measureMesh_;
  forge::ui::MeshMeasure meshMeasure_{};
  std::size_t measureTriangles_ = 0;
  bool measureBuilt_ = false;

  // The recovered edges, on the SAME triangle-count witness as the measure
  // cache. Two witnesses for one tessellation is how one of them goes stale.
  forge::ui::EdgeSet edges_;
  std::size_t edgeTriangles_ = 0;
  bool edgesBuilt_ = false;
  std::size_t hoverEdge_ = forge::ui::kNoEdge;

  Camera camera_;
  ViewportRequest viewportRequest_;

  // Frame-builder-owned UI state.
  bool paletteOpen_ = false;
  bool paletteFocus_ = false;
  char paletteQuery_[128] = {0};
  int paletteIndex_ = 0;
  bool quit_ = false;
  std::string status_ = "Ready";
  std::vector<std::string> log_;
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
  std::string runningVersion_;
  bool updateCheckPending_ = false;
  std::size_t measureFaceRowsDrawn_ = 0;
  std::size_t measureEdgeRowsDrawn_ = 0;
  std::size_t toolRowsDrawn_ = 0;

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

// The canonical key name for an ImGui key code, matching forge::ui::Keymap's
// vocabulary ("A", "F5", "Delete", "Tab", "Home"). Empty when unmapped.
std::string canonicalKeyName(int imguiKey);

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_FORGEFRAME_HPP
