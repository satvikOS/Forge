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
  std::size_t treeRowsDrawn() const noexcept { return treeRowsDrawn_; }
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
  std::size_t treeRowsDrawn_ = 0;
  std::size_t measureFaceRowsDrawn_ = 0;
  std::size_t measureEdgeRowsDrawn_ = 0;
  std::size_t toolRowsDrawn_ = 0;
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
