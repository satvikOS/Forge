#include "ForgeFrame.hpp"

#include "PartFile.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "Camera.hpp"
#include "ImGuiErrorPolicy.hpp"
#include "KernelScene.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/InspectionReport.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/PanelCatalog.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/RecentDocuments.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "forge/ui/WorkspaceTrees.hpp"

namespace forge::desktop {
namespace {

// Chrome band heights, in unscaled points; multiplied by the DPI scale.
constexpr float kWorkspaceTabH = 30.0f;
constexpr float kScrollbarSize = 12.0f;  // style.ScrollbarSize; see applyStyle() below
// One row of buttons (40) plus the ribbon's horizontal scrollbar. The Part
// ribbon carries 34 commands, more than fits any window width, so the band is
// scrollable and must be tall enough to hold the scrollbar without squeezing
// the buttons. Deriving it from kScrollbarSize keeps the two from drifting.
constexpr float kToolbarH = 40.0f + kScrollbarSize;
constexpr float kStatusH = 26.0f;
constexpr float kSplitter = 5.0f;
constexpr float kTabBarH = 26.0f;
// How near the cursor an edge has to be, in PIXELS, to be picked. Every CAD
// system picks edges on a screen-space radius rather than a world one, because
// an edge is a line with no area and a world tolerance is unusable at both ends
// of the zoom range. 8 px at 1x is the NX/Creo default band.
constexpr double kEdgePickPixels = 8.0;

ImVec4 rgb(int r, int g, int b, float a = 1.0f) {
  return ImVec4(static_cast<float>(r) / 255.0f, static_cast<float>(g) / 255.0f,
                static_cast<float>(b) / 255.0f, a);
}

const char* prettyPanelName(const std::string& id) {
  struct Row { const char* id; const char* label; };
  static const Row kRows[] = {
      {"feature_tree", "Feature Tree"},   {"model_browser", "Model Browser"},
      {"viewport_3d", "3D Viewport"},     {"viewport_sketch", "Sketch Viewport"},
      {"viewport_toolpath", "Toolpath"},  {"viewport_results", "Results"},
      {"sheet_canvas", "Sheet"},          {"properties", "Properties"},
      {"measure", "Measure"},             {"appearance", "Appearance"},
      {"timeline", "Timeline"},           {"console", "Console"},
      {"sketch_tree", "Sketch Tree"},     {"constraints", "Constraints"},
      {"dimensions", "Dimensions"},       {"relations", "Relations"},
      {"solver_status", "Solver"},        {"assembly_tree", "Assembly"},
      {"component_filter", "Components"}, {"mates", "Mates"},
      {"interference", "Interference"},   {"bom", "BOM"},
      {"curve_list", "Curves"},           {"continuity", "Continuity"},
      {"isocline", "Isocline"},           {"zebra_analysis", "Zebra"},
      {"operation_tree", "Operations"},   {"tool_library", "Tools"},
      {"operation_params", "Op Params"},  {"stock", "Stock"},
      {"fixtures", "Fixtures"},           {"simulation_log", "Sim Log"},
      {"post_output", "Post"},            {"sheet_tree", "Sheets"},
      {"view_list", "Views"},             {"annotation", "Annotation"},
      {"gdt", "GD&T"},                    {"title_block", "Title Block"},
      {"study_tree", "Studies"},          {"materials", "Materials"},
      {"loads", "Loads"},                 {"restraints", "Restraints"},
      {"contacts", "Contacts"},           {"convergence", "Convergence"},
      {"solver_log", "Solver Log"},       {"archie_chat", "Archie"},
      {"archie_copilot", "CoPilot"},      {"archie_tools", "Tools"},
      {"archie_trace", "Trace"},          {"verify_report", "Verify"},
  };
  for (const Row& r : kRows) {
    if (id == r.id) return r.label;
  }
  return id.c_str();
}

bool isViewportPanel(const std::string& id) {
  return id.rfind("viewport_", 0) == 0 || id == "sheet_canvas";
}

const char* featureStateLabel(forge::ui::FeatureState s) {
  switch (s) {
    case forge::ui::FeatureState::Ok:         return "ok";
    case forge::ui::FeatureState::Warning:    return "check";
    case forge::ui::FeatureState::Error:      return "failed";
    case forge::ui::FeatureState::Suppressed: return "off";
    case forge::ui::FeatureState::Rolled:     return "rolled back";
  }
  return "";
}

ImVec4 featureStateColor(forge::ui::FeatureState s) {
  switch (s) {
    case forge::ui::FeatureState::Ok:         return rgb(120, 200, 130);
    case forge::ui::FeatureState::Warning:    return rgb(230, 190, 90);
    case forge::ui::FeatureState::Error:      return rgb(235, 105, 95);
    case forge::ui::FeatureState::Suppressed: return rgb(140, 140, 150);
    case forge::ui::FeatureState::Rolled:     return rgb(120, 170, 230);
  }
  return rgb(200, 200, 200);
}

}  // namespace

// ── style ───────────────────────────────────────────────────────────────────
ImVec4 toImVec4(const forge::ui::Rgba& c) {
  return ImVec4(static_cast<float>(c.r), static_cast<float>(c.g), static_cast<float>(c.b),
                static_cast<float>(c.a));
}

// ── THE PALETTE IS A VALUE, AND IT IS AUDITED ───────────────────────────────
// Every colour below comes from forge::ui::Theme, whose contrast is CHECKED
// rather than eyeballed: ui/test/shell_ux_test.cpp requires body text over the
// window to clear WCAG AA in BOTH modes and asserts auditContrast() is empty.
// Hard-coded literals cannot be audited, and "is this readable" is arithmetic,
// not taste.
//
// The dpi-only overload below keeps every existing call site (main.cpp and four
// gates) working unchanged and means Dark, which is what they got before.
void applyForgeStyle(float dpiScale, forge::ui::ThemeMode mode) {
  const forge::ui::Theme theme = forge::ui::Theme::forMode(mode);
  using T = forge::ui::ColorToken;
  ImGuiStyle& s = ImGui::GetStyle();
  s = ImGuiStyle();
  s.WindowRounding = 0.0f;
  s.ChildRounding = 2.0f;
  s.FrameRounding = 3.0f;
  s.GrabRounding = 3.0f;
  s.TabRounding = 3.0f;
  s.ScrollbarRounding = 3.0f;
  s.WindowBorderSize = 1.0f;
  s.FrameBorderSize = 0.0f;
  s.WindowPadding = ImVec2(8, 6);
  s.FramePadding = ImVec2(7, 4);
  s.ItemSpacing = ImVec2(7, 5);
  s.IndentSpacing = 16.0f;
  s.ScrollbarSize = kScrollbarSize;

  ImVec4* c = s.Colors;
  c[ImGuiCol_Text] = toImVec4(theme.color(T::Text));
  c[ImGuiCol_TextDisabled] = toImVec4(theme.color(T::TextDisabled));
  c[ImGuiCol_WindowBg] = toImVec4(theme.color(T::WindowBg));
  c[ImGuiCol_ChildBg] = toImVec4(theme.color(T::PanelBg));
  c[ImGuiCol_PopupBg] = toImVec4(theme.color(T::PanelHeaderBg));
  c[ImGuiCol_Border] = toImVec4(theme.color(T::Border));
  c[ImGuiCol_FrameBg] = toImVec4(theme.color(T::ButtonBg));
  c[ImGuiCol_FrameBgHovered] = toImVec4(theme.color(T::ButtonHover));
  c[ImGuiCol_FrameBgActive] = toImVec4(theme.color(T::ButtonActive));
  c[ImGuiCol_TitleBg] = toImVec4(theme.color(T::MenuBarBg));
  c[ImGuiCol_TitleBgActive] = toImVec4(theme.color(T::PanelHeaderBg));
  c[ImGuiCol_MenuBarBg] = toImVec4(theme.color(T::MenuBarBg));
  c[ImGuiCol_ScrollbarBg] = toImVec4(theme.color(T::ScrollbarBg));
  c[ImGuiCol_ScrollbarGrab] = toImVec4(theme.color(T::ScrollbarGrab));
  c[ImGuiCol_CheckMark] = toImVec4(theme.color(T::Accent));
  c[ImGuiCol_SliderGrab] = toImVec4(theme.color(T::Accent));
  c[ImGuiCol_SliderGrabActive] = toImVec4(theme.color(T::AccentHover));
  c[ImGuiCol_Button] = toImVec4(theme.color(T::ButtonBg));
  c[ImGuiCol_ButtonHovered] = toImVec4(theme.color(T::ButtonHover));
  c[ImGuiCol_ButtonActive] = toImVec4(theme.color(T::AccentActive));
  c[ImGuiCol_Header] = toImVec4(theme.color(T::PanelHeaderBg));
  c[ImGuiCol_HeaderHovered] = toImVec4(theme.color(T::ButtonHover));
  c[ImGuiCol_HeaderActive] = toImVec4(theme.color(T::Selection));
  c[ImGuiCol_Separator] = toImVec4(theme.color(T::Separator));
  c[ImGuiCol_Tab] = toImVec4(theme.color(T::TabInactive));
  c[ImGuiCol_TabHovered] = toImVec4(theme.color(T::TabHover));
  c[ImGuiCol_TabSelected] = toImVec4(theme.color(T::TabActive));
  c[ImGuiCol_TabSelectedOverline] = toImVec4(theme.color(T::Accent));
  c[ImGuiCol_TableHeaderBg] = toImVec4(theme.color(T::PanelHeaderBg));
  c[ImGuiCol_TableBorderStrong] = toImVec4(theme.color(T::Border));
  c[ImGuiCol_TableRowBgAlt] = toImVec4(theme.color(T::PanelHeaderBg));
  c[ImGuiCol_NavCursor] = toImVec4(theme.color(T::FocusRing));
  s.ScaleAllSizes(dpiScale);
}

// The dpi-only spelling every existing caller uses (main.cpp and four gates).
// It means DARK, which is exactly what they got before the palette became a
// value -- so no call site changes and no gate sees a different frame. There is
// only ONE palette now: this delegates rather than carrying a second copy of
// thirty colours that would drift from the audited one.
void applyForgeStyle(float dpiScale) {
  applyForgeStyle(dpiScale, forge::ui::ThemeMode::Dark);
}

// ── key names ───────────────────────────────────────────────────────────────
std::string canonicalKeyName(int imguiKey) {
  const ImGuiKey k = static_cast<ImGuiKey>(imguiKey);
  if (k >= ImGuiKey_A && k <= ImGuiKey_Z) {
    return std::string(1, static_cast<char>('A' + (k - ImGuiKey_A)));
  }
  if (k >= ImGuiKey_0 && k <= ImGuiKey_9) {
    return std::string(1, static_cast<char>('0' + (k - ImGuiKey_0)));
  }
  if (k >= ImGuiKey_F1 && k <= ImGuiKey_F12) {
    char buf[8];
    std::snprintf(buf, sizeof(buf), "F%d", 1 + (k - ImGuiKey_F1));
    return std::string(buf);
  }
  switch (k) {
    case ImGuiKey_Delete:     return "Delete";
    case ImGuiKey_Backspace:  return "Backspace";
    case ImGuiKey_Tab:        return "Tab";
    case ImGuiKey_Home:       return "Home";
    case ImGuiKey_End:        return "End";
    case ImGuiKey_Escape:     return "Escape";
    case ImGuiKey_Enter:      return "Enter";
    case ImGuiKey_Space:      return "Space";
    case ImGuiKey_LeftArrow:  return "Left";
    case ImGuiKey_RightArrow: return "Right";
    case ImGuiKey_UpArrow:    return "Up";
    case ImGuiKey_DownArrow:  return "Down";
    default: break;
  }
  return std::string();
}

// ── construction ────────────────────────────────────────────────────────────
ForgeFrame::ForgeFrame(forge::ui::ForgeShell& shell, KernelScene& scene)
    : shell_(shell), scene_(scene), treeSource_(scene, partDoc_), tree_(treeSource_, 256) {
  // partDoc_ is EMPTY here and the tree is therefore the bare document root:
  // wirePartCommands() seeds it and calls rebuildTree() again. That is the whole
  // sequence -- there is no row vector to push anywhere.
  rebuildTree();

  float c[3] = {0.0f, 0.0f, 0.0f};
  scene_.bounds().centre(c);
  camera_.setIsometric();
  camera_.frame(c, scene_.bounds().radius());
  note("Forge is ready");
  if (scene_.built()) {
    note("Part ready: " + std::to_string(scene_.faceCount()) + " faces");
    // The build path and its counts are an ENGINEER's sentence. It belongs in
    // the log's detail column, where it is kept and not drawn, and not in the
    // line a user reads on the way to their first sketch.
    shell_.log().info("Startup", "The part is ready to work on.", scene_.backend());
  } else {
    // The user reads what happened to THEIR part; the log keeps what happened
    // inside the program. Before this, both were the same string, and that
    // string named C++ functions.
    note(forge::ui::userFacingBuildFailure(scene_.error()));
    // Same reason as the failed rebuild below: startup with no kernel body is an
    // ERROR, and a user who opens the log looking for one must find it there
    // rather than in the untyped frame notes that the error filter hides.
    shell_.log().error("Startup",
                       forge::ui::userFacingBuildFailure(scene_.error()), scene_.error());
  }
}

void ForgeFrame::setViewportUnavailable(const std::string& internalDetail) {
  if (internalDetail.empty()) {
    viewportUnavailable_.clear();
    return;
  }
  viewportUnavailable_ = forge::ui::userFacingViewportFailure(internalDetail);
  shell_.log().error("3D view", viewportUnavailable_, internalDetail);
}

bool ForgeFrame::applyPendingFit() {
  const std::size_t want = shell_.document().fitCount;
  if (want == fitsApplied_) return false;
  fitsApplied_ = want;
  float c[3] = {0.0f, 0.0f, 0.0f};
  scene_.bounds().centre(c);
  // A body with no bounds has no sphere to frame; refusing is honest, and it
  // keeps the camera where the user left it instead of teleporting it to a
  // radius the geometry does not have.
  if (!scene_.bounds().valid) {
    note("Zoom to fit: there is nothing on screen to fit to");
    return false;
  }
  camera_.frame(c, scene_.bounds().radius());
  note("Zoomed to fit the part");
  return true;
}

// ── the standard views ──────────────────────────────────────────────────────
// Same pull contract as applyPendingFit: compare the shell's monotonic counter
// against this builder's watermark. The camera's angle table is
// forge::ui::namedViewAngles, which the headless camera gate asserts, so the
// corner button, the `view.top` command and the gate cannot disagree about
// where "Top" is.
bool ForgeFrame::applyPendingView() {
  const std::size_t want = shell_.document().viewOrientCount;
  if (want == viewsApplied_) return false;
  viewsApplied_ = want;
  const forge::ui::NamedView v = shell_.document().requestedView;
  camera_.setNamedView(v);
  note(std::string("View: ") + forge::ui::toString(v));
  return true;
}

// ── zoom to selection ───────────────────────────────────────────────────────
// Resolves the LIVE selection against the same triangle soup picking resolves
// to, then frames the union. The census that comes back is printed rather than
// discarded: "framed 2 of 3" and "framed 3 of 3" are different answers, and a
// user whose third pick silently did not count deserves to be told.
bool ForgeFrame::applyPendingSelectionFit() {
  const std::size_t want = shell_.document().selectionFitCount;
  if (want == selectionFitsApplied_) return false;
  selectionFitsApplied_ = want;

  const std::vector<forge::ui::EntityRef>& refs = shell_.selection().selection();
  if (refs.empty()) {
    note("Zoom to selection: nothing is picked");
    return false;
  }

  forge::ui::PickScene scene;
  scene.mesh = &measureMesh();
  scene.edges = &edges();
  // No VertexSet is cached by this builder yet, so a Vertex ref resolves to
  // nothing. That is REPORTED through the unresolved count below rather than
  // being silently folded into "empty selection".
  scene.bodyId = treeSource_.rootId();

  const forge::ui::FramingBounds b = forge::ui::selectionBounds(scene, refs);
  if (!b.usable()) {
    note("Zoom to selection: the " + std::to_string(b.unresolved) +
         " picked item(s) are not on the part that is on screen");
    return false;
  }

  // The desktop Camera is float-facing and frames a SPHERE, so the box becomes
  // its bounding sphere here -- half the DIAGONAL, not the largest half-extent,
  // which is what keeps a long thin selection fully on screen.
  double centre[3] = {0.0, 0.0, 0.0};
  b.box.centre(centre);
  const float c[3] = {static_cast<float>(centre[0]), static_cast<float>(centre[1]),
                      static_cast<float>(centre[2])};
  camera_.frame(c, static_cast<float>(b.box.diagonal() * 0.5));

  std::string msg = "Zoomed to " + std::to_string(b.resolved) + " of " +
                    std::to_string(refs.size()) + " picked";
  if (b.unresolved > 0) {
    msg += " (" + std::to_string(b.unresolved) + " are not on the part on screen)";
  }
  note(msg);
  return true;
}

void ForgeFrame::rebuildTree() {
  tree_.setExpanded(treeSource_.rootId(), true);
  const std::size_t n = treeSource_.featureCount();  // == partDoc_.records().size()
  for (std::size_t i = 0; i < n; ++i) {
    // Only the LAST feature owns the body's faces, so it is the only one worth
    // opening; the rest start collapsed exactly as a CAD history tree does.
    tree_.setExpanded(treeSource_.nodeForFeature(i), i + 1 == n);
  }
  tree_.rebuild();
}

bool ForgeFrame::seedDefaultPart(std::string& error) {
  for (const SeedStatement& st : defaultPartStatements()) {
    forge::ui::FeatureRecord rec;
    rec.irId = partDoc_.nextIrId();
    rec.commandId.clear();  // authored by the seed, not by a command
    rec.label = st.label;
    rec.line = st.line;
    rec.line.id = rec.irId;
    rec.produces = st.produces;
    if (!partDoc_.appendFeature(rec, {}, st.node)) {
      error = "the default part's statement %" + std::to_string(rec.irId) + " (" + st.line.op +
              ") was refused: " + forge::ui::toString(partDoc_.lastCheck());
      return false;
    }
  }
  error.clear();
  return true;
}

std::size_t ForgeFrame::wirePartCommands() {
  if (partWired_) return 0;
  // ── the document ────────────────────────────────────────────────────────
  // Seeded with the SAME statements KernelScene::build() compiled, from the SAME
  // table (defaultPartStatements). The old seed here was a SECOND, different
  // part -- `%1 = SKETCH(XY)` + `%2 = BOX(80, 50, 20)` -- and `SKETCH` is not in
  // the kernel's op table at all, so validateIr rejected it, seed() returned 0,
  // and "sketch.base" was never bound: every profile-consuming command in the
  // Part workspace was permanently unreachable, silently.
  std::string why;
  if (!seedDefaultPart(why)) note("The starting part could not be built — " + why);
  builtProgram_ = partDoc_.irProgram();
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);

  const std::size_t added =
      forge::ui::registerPartCommands(shell_.registry(), partDoc_, partUndo_);
  partWired_ = true;
  // THE SEAM: from here the shell's one file.new/open/save and edit.undo/redo
  // act on this document, and the status strip's counters are read from it.
  shell_.setDocumentHost(this);
  note("Part tools ready: " + std::to_string(added));

  // ── EVERY COMMAND GETS A KEY, and this is the only moment that can do it ──
  // defaultKeymaps() binds 13 commands. The registry now holds 45, so 32 of them
  // -- every primitive, every pattern, the booleans, the parameter edit -- had
  // no key sequence in ANY of the four input profiles: 128 of the 180
  // command/profile slots were empty. forge::ui shipped bindUnboundCommands()
  // to close exactly that gap and NOTHING CALLED IT.
  //
  // It has to be HERE rather than in ForgeShell's constructor because the
  // registry is not complete until the line above ran: the shell owns 14
  // commands and this function adds the other 31. Completing the map any earlier
  // would bind the shell's and leave the Part workspace's unreachable, which is
  // the state this call exists to end.
  const std::size_t bound = shell_.completeKeymap();
  note("Shortcuts ready: " + std::to_string(shell_.keymap().bindingCount()) +
       " over " + std::to_string(shell_.registry().size()) + " tools (" +
       std::to_string(bound) + " assigned automatically)");

  note("Starting part loaded: " + std::to_string(partDoc_.records().size()) + " features");
  reportKernelIsolation();
  rebuildTree();
  return added;
}

// ── THE SAFETY NET THE USER COULD NOT SEE ───────────────────────────────────
// main.cpp probes forge_kernel_worker at startup and, when it cannot be
// launched, turns isolation OFF and prints
//
//   [forge] kernel isolation: UNAVAILABLE (...) -- modelling runs IN PROCESS,
//   so an OCCT fault will take the app down. The app still starts.
//
// to STDERR. A user who launches Forge.app from the Finder or the Dock has no
// stderr: they get a window, and nothing in it ever says that the process is now
// one null Geom2d_Curve away from taking the document with it. That is the
// "errors surface to the user instead of vanishing" requirement failing on the
// single most consequential fact the startup path knows.
//
// It is reported here, into shell_.log(), because that is the log the console
// panel draws, filters by severity and COUNTS in the status strip -- so it is
// still there when the user goes looking, unlike a status line that the next
// note() overwrites. And it is read from the SCENE rather than passed in by
// main.cpp: the scene is what actually holds the worker, so the log cannot say
// "active" about a session that is not.
void ForgeFrame::reportKernelIsolation() {
  if (scene_.isolationConfigured()) {
    shell_.log().info("Modelling engine",
                      "Modelling runs on its own, apart from the rest of Forge. If one "
                      "operation fails badly, you lose that operation and nothing else — "
                      "your document and the part on screen are safe.",
                      "kernel crash isolation ACTIVE");
    note("Modelling engine: protected");
    return;
  }
  shell_.log().warning(
      "Modelling engine",
      "Modelling is NOT running apart from the rest of Forge on this machine. If one "
      "operation fails badly, Forge will close and unsaved work will be lost. Save often.",
      "kernel crash isolation UNAVAILABLE: forge_kernel_worker did not launch");
  note("Modelling engine: not protected — save often");
}

// ── the document -> geometry edge ───────────────────────────────────────────
bool ForgeFrame::syncSceneToDocument() {
  const std::string program = partDoc_.irProgram();
  if (program == builtProgram_) return false;

  // ── THE ONE OPERATION LONG ENOUGH TO REPORT ─────────────────────────────
  // Compiling the IR program through the kernel and tessellating the result is
  // the only thing this application does that a user can outwait, and on a
  // fourteen-statement part with a failing boolean it is seconds. TOTAL is the
  // statement count, so the strip says "Rebuilding 14 / 14" rather than an
  // indeterminate spinner: the count is genuinely known here.
  //
  // begin/end bracket the whole call because scene_.buildFromIr() is synchronous
  // -- a frame is not drawn while it runs, so this is not yet visible DURING the
  // rebuild. It is the seam, in the right place, reported by the same status
  // model a future out-of-process rebuild would report through; the kernel
  // worker that already exists is what makes that reachable.
  progress_.begin("Rebuilding", partDoc_.records().size());
  const std::size_t before = scene_.triangleCount();
  const bool ok = scene_.buildFromIr(program);
  progress_.step(partDoc_.records().size());
  progress_.end();
  builtProgram_ = program;
  ++rebuilds_;
  documentDirty_ = true;
  geometryDirty_ = true;
  rebuildTree();

  const IrBuildReport& r = scene_.lastBuild();
  if (ok) {
    rebuildError_.clear();
    note("Rebuilt: " + std::to_string(r.faceCount) + " faces, volume " +
         std::to_string(r.volume) + " mm3" +
         (r.valid ? "" : "  (not a watertight solid)") + "  [was " +
         std::to_string(before) + " triangles, now " +
         std::to_string(scene_.triangleCount()) + "]");
    // A body that BUILT but is not a valid solid is not a success, and it is the
    // failure a user is least able to see: the geometry appears in the viewport.
    // It is a warning rather than an error because there is something to look at.
    if (!r.valid) {
      shell_.log().warning("Rebuild",
                           "This part rebuilt, but the shape it produced is not a watertight "
                           "solid. It is on screen; it will not measure or export correctly "
                           "until it is fixed.",
                           r.error);
    }
  } else {
    rebuildError_ = r.error;
    // The previous body stays on screen -- what every history-based CAD system
    // does with a failed rebuild -- and the failure is stated, not swallowed.
    // The status strip is read at a glance, mid-task, by somebody who is not
    // debugging Forge. "REBUILD FAILED: parse failed: a non-std exception
    // escaped forge::ft::parse (showing the last good body)" was what it said.
    note(forge::ui::userFacingBuildFailure(r.error));
    // ...and stated WHERE SOMEONE LOOKING FOR AN ERROR WILL FIND IT.
    //
    // note() writes to the frame's own `log_` and to status_. The console panel
    // draws shell_.log() -- the severity-carrying, filterable, counted one --
    // and appended the frame notes only under `logLevel_ == 0`. So a failed
    // rebuild, which is THE most important failure this application can report,
    // was: a transient status line that the next note overwrites, plus a grey
    // undifferentiated string that DISAPPEARS the moment a user filters to
    // "Errors" -- which is exactly what someone whose feature just failed does.
    // They would have been shown "(nothing at this level)".
    //
    // r.error is the kernel verifier's own sentence, e.g. "first invalid solid
    // is produced by op %2 EXTRUDE (line 2): not closed" -- it names the op, the
    // statement index and the line. That is the message the brief means by
    // learning why without a debugger, and it now reaches the error log, the
    // error count badge and the status strip's severity colour.
    shell_.log().error("Rebuild",
                       "This part did not rebuild. The shape on screen is the last one that "
                       "did, and nothing you have drawn has been lost.",
                       r.error);
  }
  return true;
}

// ── forge::ui::DocumentHost ─────────────────────────────────────────────────
bool ForgeFrame::documentNew(std::string& error) {
  partDoc_.restore(forge::ui::PartDocument::Snapshot{});  // records -> 0, bindings cleared
  partUndo_.clear();
  if (!seedDefaultPart(error)) return false;
  documentPath_.clear();
  documentName_ = "untitled";
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  syncSceneToDocument();
  documentDirty_ = false;
  note("New part");
  return true;
}

// THE OVERRIDE THAT WAS NOT THERE, and what its absence did.
//
// `documentReset` was added to DocumentHost as a PURE virtual in the same change
// that introduced app.load_sample. ForgeFrame is the application's only
// DocumentHost and it did not implement it, so ForgeFrame became an abstract
// class marked `final` and forge-desktop DID NOT COMPILE AT ALL. Every headless
// forge::ui gate stayed green throughout — they build ui/src and ui/test and
// never touch this file. That is "a file nothing compiles cannot break",
// measured a second time in the same programme, and it is why the change that
// found it added a one-TU `-fsyntax-only` pass over ForgeFrame.cpp: 0.5 s and
// 151 MB, against the gigabytes a full desktop build costs.
//
// The BEHAVIOUR is the half a compiler could not have told us. Emptying the
// document is not documentNew(): New seeds the starter part, and a caller that
// is about to write its own statements — Load Sample — would then stack a
// sample's fourteen features on top of that seed and build a program that is
// neither part. So this clears and stops, and it deliberately leaves
// `documentPath_` alone: the sample is loaded INTO the open document, and
// forgetting where that document came from would turn the next Save into a
// silent Save As.
bool ForgeFrame::documentReset(std::string& error) {
  error.clear();
  partDoc_.restore(forge::ui::PartDocument::Snapshot{});  // records -> 0, bindings cleared
  partUndo_.clear();
  // The scene is rebuilt from an EMPTY program, so the viewport shows an empty
  // document rather than the last body it happened to be holding. Without this
  // the window would keep drawing geometry the document no longer contains.
  builtProgram_.clear();
  syncSceneToDocument();
  rebuildTree();
  documentDirty_ = true;
  note("Part emptied");
  return true;
}

namespace {

// The document's NAME is the basename of the file it lives in, minus the
// extension. One rule, applied on both save and open, so "Save As bracket.fpart"
// and reopening it agree about what the document is called -- and the tree root
// stops being a string literal.
std::string documentNameFromPath(const std::string& path) {
  const std::size_t slash = path.find_last_of('/');
  std::string leaf = slash == std::string::npos ? path : path.substr(slash + 1);
  const std::size_t dot = leaf.find_last_of('.');
  if (dot != std::string::npos && dot > 0) leaf = leaf.substr(0, dot);
  return leaf.empty() ? std::string("untitled") : leaf;
}

}  // namespace

bool ForgeFrame::documentOpen(const std::string& path, std::string& error) {
  if (path.empty()) {
    error = "Open needs a path";
    return false;
  }
  PartFileDoc file;
  if (!loadPartFile(path, file, error)) return false;
  // Restored into a FRESH document first: a file that is well-formed but not a
  // legal document must not half-replace the one that is open.
  forge::ui::PartDocument candidate;
  if (!restorePartDocument(file, candidate, error)) return false;

  partDoc_ = candidate;  // the command handlers captured this OBJECT by reference
  partUndo_.clear();
  ensureBodyBinding();
  documentPath_ = path;
  // The stored NAME is authoritative when it says something; the path names the
  // document otherwise, so a file written by another tool still opens as itself.
  documentName_ = (file.name.empty() || file.name == "untitled") ? documentNameFromPath(path)
                                                                 : file.name;
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  builtProgram_.clear();  // force the rebuild below
  syncSceneToDocument();
  documentDirty_ = false;
  note("Opened " + path + "  (" + std::to_string(partDoc_.records().size()) + " features)");
  return true;
}

bool ForgeFrame::documentSave(const std::string& path, std::string& error) {
  std::string target = path.empty() ? documentPath_ : path;
  if (target.empty()) {
    // Ctrl+S on a never-saved document must SAVE, and must say where. ~/.forge
    // is the directory the app already owns for its own state.
    const char* home = std::getenv("HOME");
    const std::string dir = (home != nullptr && home[0] != 0) ? std::string(home) + "/.forge" : ".";
    target = dir + "/" + documentName_ + kPartFileExtension;
  }
  documentName_ = documentNameFromPath(target);
  const PartFileDoc file = capturePartDocument(partDoc_, documentName_);
  if (!savePartFile(target, file, error)) return false;
  documentPath_ = target;
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  documentDirty_ = false;
  note("Saved " + target + "  (" + std::to_string(file.features.size()) + " features)");
  return true;
}

void ForgeFrame::documentChanged() { syncSceneToDocument(); }

bool ForgeFrame::documentUndo() {
  if (!partUndo_.undo(partDoc_)) return false;
  syncSceneToDocument();
  return true;
}

bool ForgeFrame::documentRedo() {
  if (!partUndo_.redo(partDoc_)) return false;
  syncSceneToDocument();
  return true;
}

std::string ForgeFrame::activeBodyNode() const {
  const std::vector<forge::ui::FeatureRecord>& records = partDoc_.records();
  if (records.empty()) return defaultPartBodyNode();
  const int lastId = records.back().irId;
  for (const auto& kv : partDoc_.snapshot().bindings) {
    if (kv.second == lastId) return kv.first;
  }
  return defaultPartBodyNode();
}

void ForgeFrame::ensureBodyBinding() {
  const std::vector<forge::ui::FeatureRecord>& records = partDoc_.records();
  if (records.empty()) return;
  const int lastId = records.back().irId;
  forge::ui::PartDocument::Snapshot snap = partDoc_.snapshot();
  for (const auto& kv : snap.bindings) {
    if (kv.second == lastId) return;  // something already names it
  }
  // restore() with an unchanged record count rewrites the binding table and
  // nothing else -- it is the document's own published way to set one, and it
  // is why this does not need a new mutation entry point on PartDocument.
  snap.bindings[defaultPartBodyNode()] = lastId;
  partDoc_.restore(snap);
}

std::size_t ForgeFrame::documentFeatureCount() const { return partDoc_.records().size(); }
std::size_t ForgeFrame::documentUndoDepth() const { return partUndo_.undoDepth(); }
std::size_t ForgeFrame::documentRedoDepth() const { return partUndo_.redoDepth(); }
bool ForgeFrame::documentDirty() const { return documentDirty_; }
std::string ForgeFrame::documentPath() const { return documentPath_; }

void ForgeFrame::note(const std::string& line) {
  log_.push_back(line);
  if (log_.size() > 400) log_.erase(log_.begin(), log_.begin() + 100);
  status_ = line;
}

// ── command invocation ──────────────────────────────────────────────────────
//
// ONE PARAMETER POLICY, AND IT IS THE SHELL'S.
//
// This function used to fill every REQUIRED parameter itself, from
// `ParamSpec::defaultNumber` and `defaultText`, IGNORING `hasDefault`. The
// shell's own interactive path -- ForgeShell::invoke(), which is what a keystroke
// goes through -- fills only the defaults a spec declares HONEST and reports the
// rest for the caller to prompt for. Two policies over one registry, which is
// precisely the "same command, two invokers, two outcomes" defect the single
// registry exists to prevent, and it was observable: with `hasDefault` false on
// twelve commands, a MENU CLICK on Rectangle worked (this function invented 40)
// and the R key died on missing_required_parameter.
//
// It was also inventing values that are not defaults at all. A required TEXT
// parameter with no declared default got the literal "untitled.fpart", so
// File > Open did not prompt for a path -- it silently tried to open a file
// named after a placeholder. `hasDefault` exists to say "" is not a path.
//
// Now: the shell decides, and this function contributes only the ONE thing it
// legitimately owns -- the live value the Properties panel is editing, as an
// OVERRIDE rather than as a default. Anything still required comes back in
// `promptFor`, and the app opens its parameter prompt instead of failing mute.
void ForgeFrame::invoke(const std::string& id) {
  forge::ui::CommandParams overrides;
  const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
  if (d != nullptr) {
    for (const forge::ui::ParamSpec& p : d->schema) {
      if (p.type != forge::ui::ParamType::Number) continue;
      if (p.name == "radius" || p.name == "distance" || p.name == "thickness") {
        overrides.setNumber(p.name, static_cast<double>(paramValue_));
      }
    }
  }
  // Values the user typed into the prompt for THIS command, if it is the one the
  // prompt is open on. Cleared by runPromptedCommand() once it has dispatched.
  if (promptCommand_ == id) {
    for (const PromptField& f : promptFields_) {
      if (f.text) {
        overrides.setText(f.name, std::string(f.value.data()));
      } else {
        overrides.setNumber(f.name, std::atof(f.value.data()));
      }
    }
  }
  // ── the path the user CHOSE IN A PANEL ──────────────────────────────────
  // The same shape as the prompt above, one line lower, and that is the point:
  // a path picked with a mouse and a path typed by hand become the same
  // CommandParams entry and travel the same dispatch. runPendingFileDialog()
  // sets these two and calls straight back into this function.
  if (dialogCommand_ == id && !dialogPath_.empty()) {
    overrides.setText("path", dialogPath_);
  }

  // ── A FILE COMMAND ASKS FOR ITS FILE ────────────────────────────────────
  // Recorded and deferred, never run here: this function is called from inside
  // BeginMainMenuBar(), from the ribbon, from the palette and from inside the
  // dock walk, and a modal panel runs a nested event loop before dispatching a
  // command that can replace the document and rebuild the feature tree. That is
  // the exact shape of the three crashes this class already carries deferral
  // machinery for. build() shows the panel after the walk has returned.
  if (wantsFileDialog(id, overrides)) {
    lastInvokeOk_ = false;
    pendingDialogId_ = id;
    return;
  }

  const forge::ui::InvokeOutcome outcome = shell_.invoke(id, overrides);

  // ── A COMMAND THAT NEEDS A VALUE OPENS A DIALOG; IT DOES NOT FAIL ────────
  // needsParameters() is NOT a refusal. It is the schema saying "no honest
  // default exists for this, ask" -- file.open's path, part.edit_feature's new
  // value. Treating it as a failure is what turns a prompt into a dead end.
  if (outcome.needsParameters()) {
    lastInvokeOk_ = false;
    openPrompt(id, outcome.promptFor);
    return;
  }

  const forge::ui::DispatchResult r = outcome.dispatch;
  // A file.* command reports refusal through the shell rather than through the
  // dispatch status, so "it ran" is BOTH conditions, not just the status.
  lastInvokeOk_ = r.ok() && shell_.lastDocumentError().empty();
  // THE LABEL, NOT THE ID. Every line below used to open with the command's
  // stable id -- "part.edit_feature  ->  ok" -- which is the name a macro
  // stores, not a name anybody has read on a button.
  const forge::ui::CommandDescriptor* invoked = shell_.registry().find(id);
  const std::string label =
      (invoked != nullptr && !invoked->label.empty()) ? invoked->label : id;
  if (r.ok()) {
    // A file.* command reports refusal through the shell, not through the
    // dispatch status: `execute` returns void, so "ok" only means it ran.
    if (shell_.lastDocumentError().empty()) {
      note(label + " — done");
    } else {
      note(label + " — " + shell_.lastDocumentError());
    }
  } else {
    // THE SENTENCE, NOT THE ENUM. ForgeShell::run() has already written this
    // dispatch into its activity log with the explanation forge::ui built --
    // which names the kind the command wanted, what is actually picked and what
    // to do about it. "selection_signature_mismatch" is a status code; "Edge
    // Fillet needs one or more edges, all of the same kind; nothing selected is
    // picked. Set the pick filter to edge and click one in the 3D view" is
    // something a user can act on without a debugger. Falling back to the
    // status only when there is somehow no entry, so this can never print
    // nothing -- and the fallback is userText, because the machine spelling is
    // what this line was reported for.
    const forge::ui::LogEntry* explained = shell_.log().last();
    if (explained != nullptr && explained->source == id && !explained->message.empty()) {
      note(explained->message);
    } else {
      note(label + " — " + forge::ui::userText(r.status));
    }
  }
  // NO sync here. ForgeShell::run() has already called documentChanged() on this
  // object if the command declared sideEffect == Document, so the viewport is
  // already rebuilt by the time this line runs -- and it is rebuilt the same way
  // for a macro, an Archie tool call or a gate, none of which come through here.
  if (id == "app.command_palette") togglePalette();
}

// ── the parameter prompt ────────────────────────────────────────────────────
void ForgeFrame::openPrompt(const std::string& id, const std::vector<std::string>& parameters) {
  const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
  promptCommand_ = id;
  promptOpen_ = true;
  promptFocus_ = false;
  promptFields_.clear();
  for (const std::string& name : parameters) {
    PromptField field;
    field.name = name;
    field.text = true;
    if (d != nullptr) {
      for (const forge::ui::ParamSpec& p : d->schema) {
        if (p.name != name) continue;
        field.text = (p.type != forge::ui::ParamType::Number);
        break;
      }
    }
    // SEEDED, never blank where the app knows a sensible starting point. The
    // schema declares no default for these -- that is why they are prompted --
    // but the APPLICATION does know where the open document lives, and a path
    // box that starts empty makes the user retype what the title bar is already
    // showing. Seeding is not defaulting: nothing dispatches until Run.
    //
    // ── AND ON A FRESH LAUNCH, THE LAST DOCUMENT ────────────────────────────
    // `documentPath_` is EMPTY every time the app starts, so before the fallback
    // below, Ctrl+O on a newly launched Forge opened a box with nothing in it and
    // the only way to reopen yesterday's part was to type its absolute path from
    // memory -- and a part saved with a bare Ctrl+S lives in ~/.forge, a
    // directory the user never chose and has no reason to guess. The shell's
    // recent list is restored from the session file before this object is built,
    // so it is exactly what the box should start on.
    const std::string pathSeed = (name == "path") ? pathPromptSeed() : std::string();
    if (!pathSeed.empty()) {
      std::snprintf(field.value.data(), field.value.size(), "%s", pathSeed.c_str());
    } else if (name == "value") {
      std::snprintf(field.value.data(), field.value.size(), "%g", editParamValue());
    }
    promptFields_.push_back(std::move(field));
  }
  const std::string label = (d != nullptr && !d->label.empty()) ? d->label : id;
  std::string names;
  for (std::size_t i = 0; i < parameters.size(); ++i) {
    if (i != 0) names += ", ";
    names += parameters[i];
  }
  note(label + " needs " + names + " — enter " +
       (parameters.size() == 1 ? std::string("it") : std::string("them")) + " and press Run");
}

std::string ForgeFrame::pathPromptSeed() const {
  if (!documentPath_.empty()) return documentPath_;
  return shell_.recentDocuments().mostRecent();
}

void ForgeFrame::requestOpenDocument(const std::string& path) {
  // Refused here rather than at dispatch: "" would reach file.open, which
  // declares its path REQUIRED, and come back as a prompt -- so a menu row that
  // somehow carried no path would silently turn into "type one", which reads as
  // a bug in the menu rather than as the empty row it is.
  if (path.empty()) return;
  pendingOpenPath_ = path;
}

void ForgeFrame::runPendingOpen() {
  const std::string path = pendingOpenPath_;
  pendingOpenPath_.clear();
  if (path.empty()) return;
  // THE SAME COMMAND, through the registry -- not documentOpen() directly. Going
  // straight to the host would skip the activity log, the document-error seam
  // and the shell's own counters, so a failed open from this menu would be the
  // one open in the app that leaves no record.
  forge::ui::CommandParams params;
  params.setText("path", path);
  const forge::ui::DispatchResult r = shell_.run("file.open", params);
  const std::string& why = shell_.lastDocumentError();
  lastInvokeOk_ = r.ok() && why.empty();
  if (lastInvokeOk_) {
    note("Opened " + path);
    return;
  }
  // A remembered path can stop opening -- the file moved, the volume is not
  // mounted -- and that must SAY SO where a user looks, not merely fail. The
  // entry is left in the list: this frame cannot tell "deleted" from "not
  // mounted today", and silently forgetting a part because a network share was
  // asleep is the worse of the two mistakes.
  const std::string reason =
      why.empty() ? std::string(forge::ui::userText(r.status)) : why;
  shell_.log().error("Open", "Forge could not open " + path + " — " + reason +
                                 ". The file may have moved, or the drive it is on may not be "
                                 "connected. Your current part is unchanged.",
                     std::string(forge::ui::machineName(r.status)) +
                         (r.detail.empty() ? std::string() : (": " + r.detail)));
  note("Could not open " + path + " — " + reason);
}

// ── the file panel ──────────────────────────────────────────────────────────
bool ForgeFrame::wantsFileDialog(const std::string& id,
                                 const forge::ui::CommandParams& overrides) const {
  // No panel installed: every headless build, and any platform this application
  // has no native picker for. The text prompt is what happens instead, exactly
  // as it did before this seam existed.
  if (fileDialog_ == nullptr) return false;
  // Already answering this command's panel. Without this the dispatch below
  // would raise another panel for the same command and never terminate.
  if (dialogCommand_ == id) return false;
  // The text prompt is open on this command: the user is typing a path by hand
  // and taking it away from them mid-edit would be worse than not offering the
  // panel at all.
  if (promptCommand_ == id) return false;
  // A caller that already supplied a path -- Open Recent, a macro, an Archie
  // tool call, --open on the command line -- is not asking a question.
  if (overrides.has("path")) return false;

  FileDialogPolicy policy;
  if (!fileDialogPolicyFor(id, policy)) return false;

  // ── WHAT THE REGISTRY SAYS, not a second opinion ────────────────────────
  // evaluate() runs the command's OWN enabled predicate and its OWN schema
  // without executing anything. Deciding here instead would mean this file
  // holding a copy of "a save is offered only when there is something to save",
  // and the copy would drift -- which is the one-registry rule this application
  // is built on.
  const forge::ui::DispatchResult pre =
      shell_.registry().evaluate(id, shell_.selection(), overrides);
  switch (policy.role) {
    case PathRole::Required:
      // The ONLY thing standing between this command and running is the path we
      // are about to ask for. A command that is disabled, or whose selection is
      // wrong, must not raise a panel it cannot use: the user would pick a file
      // and be told no afterwards.
      return pre.status == forge::ui::DispatchStatus::MissingRequiredParameter &&
             pre.detail == "path";
    case PathRole::SaveTarget:
      // Save is dispatchable with no path at all, so the registry says Ok. The
      // question here is a different one: does the APPLICATION know where to put
      // it? An untitled document has nowhere, and ForgeFrame::documentSave()
      // answers that today by writing ~/.forge/untitled.fpart -- a directory the
      // user never chose and has no reason to guess. That is the case the panel
      // is for, and it is the only one: a document that came from a file is
      // saved back to that file, silently, on every Ctrl+S.
      //
      // ── A LIMIT, STATED RATHER THAN HIDDEN ──────────────────────────────
      // This reaches the KEYBOARD for the four Required commands and it does
      // NOT reach Ctrl+S. onKey() can only intervene on a command the shell
      // refused for a missing parameter, and file.save's `path` is OPTIONAL by
      // design -- a required one would turn every keyboard save into
      // MissingRequiredParameter, which is why ForgeShell declares it that way.
      // So the shell DISPATCHES Ctrl+S before this frame builder ever sees the
      // resolution, and an untitled document saved with the keyboard still goes
      // to ~/.forge/<name>.fpart while File > Save asks. Closing that needs a
      // resolve-without-dispatch on ForgeShell::key, which is a forge::ui change
      // and a separate one. It is written here rather than left for someone to
      // discover, and forge_desktop_file_dialog_gate PINS both halves so the
      // behaviour cannot drift without a red check.
      return pre.ok() && documentPath_.empty();
  }
  return false;
}

std::string ForgeFrame::fileDialogSeed() const {
  const std::string known = pathPromptSeed();
  if (!known.empty()) return known;
  // Never saved and nothing remembered. The document's NAME is still a better
  // starting point than an empty name field, and fileDialogRequestFor() puts the
  // command's own suffix on it.
  return documentName_;
}

void ForgeFrame::runPendingFileDialog() {
  const std::string id = pendingDialogId_;
  pendingDialogId_.clear();
  if (id.empty() || fileDialog_ == nullptr) return;

  FileDialogRequest request;
  if (!fileDialogRequestFor(id, fileDialogSeed(), request)) return;

  ++dialogsShown_;
  const FileDialogResult chosen = fileDialog_->run(request);

  // ── CANCEL IS A NO-OP ───────────────────────────────────────────────────
  // Not an error, not a refusal, not a line in the activity log and not a
  // sentence in the status strip. The user opened a File menu and changed their
  // mind; there is nothing to report and nothing went wrong. An empty path is
  // treated the same way for the reason FileDialogResult spells out: "" is not a
  // file name, and dispatching it would reach the command's own "Open needs a
  // path" refusal and show the user a failure they did not cause.
  if (!chosen.accepted || chosen.path.empty()) {
    ++dialogsCancelled_;
    return;
  }

  // The chosen path reaches the command as an OVERRIDE on the next line, through
  // the one dispatch every other invoker uses. Cleared afterwards whatever
  // happened, so a second gesture on the same command asks again rather than
  // silently reusing yesterday's answer.
  dialogCommand_ = id;
  dialogPath_ = chosen.path;
  invoke(id);
  dialogCommand_.clear();
  dialogPath_.clear();
}

std::vector<std::string> ForgeFrame::promptParameters() const {
  std::vector<std::string> out;
  out.reserve(promptFields_.size());
  for (const PromptField& f : promptFields_) out.push_back(f.name);
  return out;
}

bool ForgeFrame::setPromptValue(const std::string& name, const std::string& value) {
  for (PromptField& f : promptFields_) {
    if (f.name != name) continue;
    std::snprintf(f.value.data(), f.value.size(), "%s", value.c_str());
    return true;
  }
  return false;  // no such field: creating one would pass an argument nothing reads
}

std::string ForgeFrame::promptValue(const std::string& name) const {
  for (const PromptField& f : promptFields_) {
    // .data() and not the array: the buffer is fixed-size and NUL-terminated by
    // snprintf, so constructing a std::string from the whole array would carry
    // the trailing NULs into the value and make every comparison fail.
    if (f.name == name) return std::string(f.value.data());
  }
  return std::string();
}

bool ForgeFrame::submitPrompt() {
  if (!promptOpen_ || promptCommand_.empty()) return false;
  const std::string id = promptCommand_;
  // invoke() reads promptFields_ while promptCommand_ still names this command,
  // so the collected values reach the dispatch.
  //
  // `ran` is read from lastInvokeOk_, which invoke() sets, and NOT from
  // journal().back() == id. The journal is a shared success log: another
  // invoker -- a keystroke, the CoPilot, a macro -- can append to it, and a
  // command that failed here while the previous entry happened to be the same id
  // would read as success. A witness taken from the thing itself, not from a
  // list that something else also writes to.
  invoke(id);
  const bool ran = lastInvokeOk_;
  // A command that STILL needs a parameter has reopened the prompt from inside
  // invoke(). Leave that one open: it is a correction, not a second prompt.
  if (!(promptOpen_ && promptCommand_ == id && !ran)) cancelPrompt();
  return ran;
}

void ForgeFrame::cancelPrompt() noexcept {
  promptOpen_ = false;
  promptFocus_ = false;
  promptCommand_.clear();
  promptFields_.clear();
}

// ── the feature PARAMETER editor ────────────────────────────────────────────
// The document was APPEND-ONLY until part.edit_feature existed, and the Properties
// panel said so: its one slider "feeds radius / distance / thickness on the NEXT
// command" and no control anywhere could change a number already in the program.
// These four methods are what the panel drives; every one of them resolves the
// target through the document itself rather than caching it, because undo, redo,
// New and Open all move records out from under a cached index.
//
// "The `index`-th NUMBER argument of a statement" was written out HERE and again
// in paramTarget() in PartCommands.cpp -- two copies of the rule that decides
// which slot a panel is editing. Both now call forge::ui::numericArgSlot(), so
// what this panel SHOWS and what part.edit_feature CHANGES cannot drift apart.

void ForgeFrame::setEditTarget(int irId, std::size_t paramIndex) {
  const std::size_t records = partDoc_.records().size();
  if (records == 0) {
    editFeatureId_ = 0;
    editParamIndex_ = 0;
    editValue_ = 0.0f;
    return;
  }
  if (irId <= 0 || static_cast<std::size_t>(irId) > records) {
    irId = static_cast<int>(records);  // 0 and out-of-range both mean the last
  }
  editFeatureId_ = irId;
  const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
  const std::size_t numbers = rec == nullptr ? 0 : forge::ui::numericArgCount(rec->line.args);
  editParamIndex_ = (numbers == 0 || paramIndex >= numbers) ? 0 : paramIndex;
  editValue_ = static_cast<float>(editParamValue());
}

std::size_t ForgeFrame::editParamCount() const {
  const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
  return rec == nullptr ? 0 : forge::ui::numericArgCount(rec->line.args);
}

double ForgeFrame::editParamValue() const {
  const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
  if (rec == nullptr) return 0.0;
  const std::size_t slot = forge::ui::numericArgSlot(rec->line.args, editParamIndex_);
  if (slot >= rec->line.args.size()) return 0.0;
  return rec->line.args[slot].number;
}

bool ForgeFrame::applyFeatureEdit(double value) {
  forge::ui::CommandParams p;
  p.setNumber("feature", static_cast<double>(editFeatureId_));
  p.setNumber("index", static_cast<double>(editParamIndex_));
  p.setNumber("value", value);
  // THE ONE REGISTRY. Not a private call into PartDocument: a panel that edited
  // the document directly would bypass the undo stack, the journal and the
  // enabled predicate, which is the whole reason the registry exists.
  const forge::ui::DispatchResult r = shell_.run("part.edit_feature", p);
  if (!r.ok()) {
    note(std::string("Feature value not changed — ") + forge::ui::userText(r.status));
    return false;
  }
  note("Feature value changed");
  syncSceneToDocument();
  editValue_ = static_cast<float>(editParamValue());
  return true;
}

// ── WHAT IS PICKED, AND HOW BIG IT IS ───────────────────────────────────────
// The measurement half of the status strip. Faces report area, edges report
// length, and a pair of either reports the distance between them -- which is the
// measure a machinist actually asks for. "-" when there is nothing measurable,
// never a fabricated zero: 0.000 mm² is a claim, and "-" is the truth.
std::string ForgeFrame::statusMeasurement() {
  char buf[160];
  const std::vector<std::size_t> edgeIds = selectedEdgeIndices();
  if (!edgeIds.empty()) {
    const forge::ui::EdgeMeasure m = edgeMeasure();
    if (m.hasPair) {
      std::snprintf(buf, sizeof(buf), "length %.3f mm   gap %.3f mm", m.length, m.centreDistance);
    } else {
      std::snprintf(buf, sizeof(buf), "length %.3f mm", m.length);
    }
    return buf;
  }
  if (!selectedFaceIds().empty()) {
    const forge::ui::SelectionMeasure m = selectionMeasure();
    if (m.hasPair) {
      std::snprintf(buf, sizeof(buf), "area %.3f mm²   gap %.3f mm   angle %.1f°", m.area,
                    m.centreDistance, m.angleDegrees);
    } else {
      std::snprintf(buf, sizeof(buf), "area %.3f mm²", m.area);
    }
    return buf;
  }
  return {};
}

forge::ui::SurfaceContext ForgeFrame::surfaceContext() const {
  forge::ui::SurfaceContext ctx;
  ctx.registry = &shell_.registry();
  ctx.selection = &shell_.selection();
  ctx.keymap = &shell_.keymap();
  ctx.input = shell_.inputProfile();
  return ctx;
}

void ForgeFrame::rebuildCommandSurfaces() {
  const forge::ui::SurfaceContext ctx = surfaceContext();
  menuSurface_ = forge::ui::buildMenuSurface(ctx);
  ribbonSurface_ = forge::ui::buildRibbonSurface(ctx, shell_.workspace());
  contextSurface_ = forge::ui::buildContextSurface(ctx);
}

// ── IS THIS ITEM CLICKABLE? ─────────────────────────────────────────────────
// Read off the menu surface, which holds EVERY registry command, so this is one
// lookup rather than another walk.
//
// TWO ANSWERS ARE YES, and conflating them was a defect. `enabled()` means
// dispatch would run it now. `opensDialog()` means a required parameter has no
// honest default -- file.open's path, part.edit_feature's value -- so an
// interactive invocation must ASK first. That is not a refusal, and greying the
// item out instead of prompting turns "type a path" into a dead end: File > Open
// would be permanently disabled in a CAD application.
//
// This function used to fabricate a value for every required parameter and ask
// evaluate() -- which answered `ok` for file.open because it had just been
// handed the literal "x" as a path. It got the right ANSWER for the wrong
// REASON, and the fabrication is what hid the fact that clicking it did not
// prompt.
bool ForgeFrame::commandEnabled(const std::string& id) const {
  const forge::ui::SurfaceItem* item = menuSurface_.find(id);
  if (item == nullptr) {
    // Before the first build(), or an id the registry does not hold. Fall back
    // to the dispatcher rather than guessing, and use the SCHEMA'S OWN defaults
    // -- applyDefaults is exactly what ForgeShell::invoke() applies, so this
    // answers the question the click will actually ask.
    const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
    if (d == nullptr) return false;
    const forge::ui::CommandParams filled =
        forge::ui::applyDefaults(*d, forge::ui::CommandParams{});
    if (!forge::ui::missingRequired(*d, filled).empty()) return true;  // it prompts
    return shell_.registry().evaluate(id, shell_.selection(), filled).ok();
  }
  return item->enabled() || item->opensDialog();
}

std::string ForgeFrame::shortcutText(const std::string& id) const {
  const std::vector<std::string> keys = shell_.keymap().shortcutsFor(shell_.inputProfile(), id);
  return keys.empty() ? std::string() : keys.front();
}

bool ForgeFrame::onKey(const std::string& key, forge::ui::ModMask mods) {
  if (key.empty()) return false;
  // No sync scope guard either: the keystroke dispatches through ForgeShell::key
  // -> invoke -> run, and run() calls documentChanged() on this object. The guard
  // that used to be here was the third copy of the same "remember to rebuild"
  // rule, and a fourth invoker would have needed a fourth copy.
  forge::ui::KeyStroke stroke;
  stroke.key = key;
  stroke.mods = mods;
  const forge::ui::KeyOutcome outcome = shell_.key(stroke);
  if (outcome.resolve == forge::ui::ResolveStatus::Pending) {
    note("Waiting for the rest of the shortcut: " +
         forge::ui::sequenceText(shell_.pendingSequence()) + " ...");
    return false;
  }
  if (outcome.resolve == forge::ui::ResolveStatus::Unbound) return false;
  if (outcome.commandId == "app.command_palette") togglePalette();
  // ── A KEYSTROKE THAT NEEDS A VALUE ASKS FOR IT ──────────────────────────
  //
  // WHAT THIS WAS, MEASURED. `KeyOutcome::promptFor` names the parameters the
  // command still needs, and this function READ NOTHING FROM IT. So Ctrl+O on
  // the shipped application resolved to file.open, came back
  // MissingRequiredParameter, and the entire user-visible result was a status
  // line reading "Ctrl+O  ->  file.open  missing_required_parameter". The menu
  // at least opened a text box; the keyboard opened nothing at all and named an
  // enum while doing it. Every binding of a command with an unfillable parameter
  // behaved that way -- Ctrl+O and the generated bindings for the two Imports and
  // the two Exports.
  //
  // It now asks the SAME WAY a menu click does: the native panel when there is
  // one and this is a file command, the text prompt otherwise. Nothing has
  // dispatched at this point -- ForgeShell::invoke returns before run() when a
  // required parameter is missing -- so raising the panel here starts the
  // command rather than repeating it.
  //
  // ★ MERGED WITH THE PROSE SWEEP, and the two halves fix the SAME status line
  //   from opposite ends. Raising the dialog removed the dead end; naming the
  //   command by its LABEL and translating the status with userText() removes
  //   the developer prose. `file.open` is an internal id and
  //   `missing_required_parameter` is an enum spelling -- neither belongs on a
  //   status line, so BOTH notes below use `what`, never outcome.commandId.
  const forge::ui::CommandDescriptor* bound = shell_.registry().find(outcome.commandId);
  const std::string what =
      (bound != nullptr && !bound->label.empty()) ? bound->label : outcome.commandId;
  if (outcome.needsParameters()) {
    const forge::ui::CommandParams none;
    if (wantsFileDialog(outcome.commandId, none)) {
      // Deferred like every other panel: onKey is called from the event pump,
      // which on the shipped path is inside the frame loop.
      pendingDialogId_ = outcome.commandId;
      note(stroke.toText() + " — " + what + " — asks which file");
    } else {
      openPrompt(outcome.commandId, outcome.promptFor);
    }
    return false;
  }
  note(stroke.toText() + " — " + what + " — " +
       (outcome.dispatch.ok() ? std::string("done")
                              : std::string(forge::ui::userText(outcome.dispatch.status))));
  return outcome.ran();
}

// ── selection ───────────────────────────────────────────────────────────────
void ForgeFrame::setPreselectedFace(std::uint32_t faceId) {
  hoverFace_ = faceId;
  // ONE hover at a time. Leaving the edge hover set would keep an edge lit under
  // the cursor while the HUD names a face, which is the disagreement the single
  // preselection slot in SelectionService exists to prevent.
  hoverEdge_ = forge::ui::kNoEdge;
  if (faceId == 0) {
    shell_.selection().clearPreselection();
    return;
  }
  forge::ui::EntityRef ref;
  ref.bodyId = activeBodyNode();
  ref.kind = forge::ui::EntityKind::Face;
  ref.persistentName = "face@" + std::to_string(faceId);
  shell_.selection().setPreselection(ref);
}

void ForgeFrame::clickFace(std::uint32_t faceId, bool additive) {
  if (faceId == 0) {
    if (!additive) {
      shell_.selection().clearSelection();
      syncSelectionToScene();
      note("Selection cleared");
    }
    return;
  }
  forge::ui::EntityRef ref;
  // activeBodyNode(), NOT the literal "body.bracket" this line used to hold.
  // setPreselectedFace two functions up already read it from the document; only
  // half the fix had landed, so hovering named the live body and CLICKING named
  // a node that stops existing the moment a command rebinds it or a .fpart
  // written by another tool names its body anything else -- and resolveValues()
  // maps EntityRef::bodyId through PartDocument::valueFor(), so every solid
  // command silently greys out. See this class's header: it says exactly that.
  ref.bodyId = activeBodyNode();
  ref.kind = forge::ui::EntityKind::Face;
  ref.persistentName = "face@" + std::to_string(faceId);
  if (!shell_.selection().accepts(ref.kind)) {
    note("The pick filter is not set to face, so this face was not picked");
    return;
  }
  if (additive) {
    shell_.selection().toggle(ref);
  } else {
    shell_.selection().replaceWith({ref});
  }
  shell_.selection().setFocus(ref);
  syncSelectionToScene();
  note("Picked face " + std::to_string(faceId) + "  (" +
       std::to_string(shell_.selection().count()) + " picked in all)");
}

// ── SELECTING A STATEMENT: the producer 28 commands were waiting for ────────
//
// THE DEFECT, MEASURED. Before this, ForgeFrame had exactly TWO producers of
// selection refs — clickFace (EntityKind::Face) and clickEdge
// (EntityKind::Edge). Nothing anywhere constructed a ref of any other kind, and
// SelectionSignature::satisfiedBy compares kinds EXACTLY, with no subsumption.
// So of the 80 commands in the registry, 28 named a kind the interface could
// never produce — 13 body, 5 sketchref, 4 surface, 2 sketch, 2 opensketch, 2
// wire — and every one of them was permanently greyed out. That set includes
// part.extrude and part.revolve, every boolean, every pattern, mirror, move,
// rotate, loft, skin, thicken and the whole sketch family: a user could not
// extrude a sketch in a CAD application. The Archie CoPilot COULD drive all 28,
// because ArchieCopilot::resolveSelection builds exactly these refs from the
// document. The agent could do what the person could not.
//
// Every gate stayed green because none of them was asking this question.
// app_surface_reachability_test proves each surface OFFERS every command and
// says so precisely — "enumeration, not pixels". Offering is not invoking.
//
// The feature tree is the right surface: its rows ARE the document's statements,
// and a statement is exactly what these signatures want. The kind comes from
// forge::ui::entityKindFor(), so the tree cannot invent a mapping of its own —
// ui/test/selection_reachability_test.cpp proves that function total, injective
// and sufficient for all 28.
void ForgeFrame::clickFeature(int irId, bool additive) {
  if (irId == 0) return;
  const forge::ui::EntityKind kind = forge::ui::entityKindFor(partDoc_.kindOf(irId));
  if (kind == forge::ui::EntityKind::None) {
    note("That row makes nothing a later feature can be built on, so it cannot be picked");
    return;
  }
  // The filter is the user's own instruction about what they are picking. A tree
  // click that ignored it would make "set the filter to edge" mean nothing in
  // half the window, and it would break the homogeneity every signature requires.
  //
  // Checked BEFORE the binding below, so a refused pick leaves the document
  // exactly as it was: a click the app declines must not still write to the
  // thing it declined to act on.
  if (!shell_.selection().accepts(kind)) {
    note(std::string("The pick filter is set to ") +
         forge::ui::userText(shell_.selection().filter()) + ", so a " +
         forge::ui::userText(kind) + " cannot be picked — set the filter to any, or to " +
         forge::ui::userText(kind));
    return;
  }

  // resolveValues() reads EntityRef::bodyId -> valueFor() -> kindOf(), so a
  // statement with no node binding cannot be resolved back to an IR value by ANY
  // route — the CoPilot's boundValues() skips it for the same reason. The
  // SEEDED statements of the starter part carry no node (only the last one
  // does), so without this the four rows a new document opens on would be the
  // ones that could not be picked. A statement whose node was CONSUMED by a
  // command is in the same position, and is re-bound here for the same reason.
  //
  // Binding here is not a document EDIT: bindings are not statements, so
  // irProgram() is unchanged, syncSceneToDocument() sees no difference and
  // nothing rebuilds. restore() with an unchanged record count rewrites the
  // binding table and nothing else — the document's own published way to set
  // one, which is why this needs no new mutation entry point (ensureBodyBinding
  // does the same thing for the body).
  std::string node = partDoc_.nodeFor(irId);
  if (node.empty()) {
    forge::ui::PartDocument::Snapshot snap = partDoc_.snapshot();
    // "pick_" and not one of PartCommands' own sketch_/wire_ prefixes: those
    // name values a COMMAND produced and are private to it, and kindOf() reads
    // the record's own `produces` field rather than the node's spelling, so the
    // name only has to be unique. A statement index is unique by construction.
    node = "pick_" + std::to_string(irId);
    snap.bindings[node] = irId;
    partDoc_.restore(snap);
  }

  forge::ui::EntityRef ref;
  ref.bodyId = node;
  ref.kind = kind;
  ref.persistentName = "feature@" + std::to_string(irId);
  if (additive) {
    shell_.selection().toggle(ref);
  } else {
    shell_.selection().replaceWith({ref});
  }
  shell_.selection().setFocus(ref);
  // The viewport highlights FACES; a statement is not a face, so the face
  // highlight is cleared rather than left showing the previous pick as though it
  // were still selected.
  syncSelectionToScene();
  note(std::string("Picked a ") + forge::ui::userText(kind) + "  (" +
       std::to_string(shell_.selection().count()) + " picked in all)");
}

std::vector<std::uint32_t> ForgeFrame::selectedFaceIds() const {
  std::vector<std::uint32_t> ids;
  for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
    if (r.kind != forge::ui::EntityKind::Face) continue;
    const std::size_t at = r.persistentName.find('@');
    if (at == std::string::npos) continue;
    ids.push_back(static_cast<std::uint32_t>(std::stoul(r.persistentName.substr(at + 1))));
  }
  return ids;
}

void ForgeFrame::syncSelectionToScene() {
  if (scene_.applySelection(selectedFaceIds()) > 0) viewportRequest_.selectionDirty = true;
}

// ── edge selection ──────────────────────────────────────────────────────────
bool ForgeFrame::edgePickMode() const {
  return shell_.selection().filter() == forge::ui::EntityKind::Edge;
}

const forge::ui::EdgeSet& ForgeFrame::edges() {
  const std::size_t builds = scene_.builds();
  if (edgesBuilt_ && edgeBuilds_ == builds) return edges_;
  edges_ = forge::ui::deriveEdges(measureMesh());
  edgeBuilds_ = builds;
  edgesBuilt_ = true;
  // An edge index is only meaningful against the set it came from, so a rebuild
  // must not leave a hover pointing into the old one.
  hoverEdge_ = forge::ui::kNoEdge;
  return edges_;
}

std::vector<std::size_t> ForgeFrame::selectedEdgeIndices() {
  std::vector<std::size_t> out;
  const forge::ui::EdgeSet& set = edges();
  for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
    if (r.kind != forge::ui::EntityKind::Edge) continue;
    const std::size_t idx = set.indexOf(r.persistentName);
    if (idx != forge::ui::kNoEdge) out.push_back(idx);
  }
  return out;
}

forge::ui::EdgeMeasure ForgeFrame::edgeMeasure() {
  return forge::ui::measureEdges(edges(), selectedEdgeIndices());
}

void ForgeFrame::setPreselectedEdge(std::size_t index) {
  const forge::ui::EdgeSet& set = edges();
  hoverFace_ = 0;  // ONE hover at a time; see setPreselectedFace.
  if (index >= set.size()) {
    hoverEdge_ = forge::ui::kNoEdge;
    shell_.selection().clearPreselection();
    return;
  }
  hoverEdge_ = index;
  forge::ui::EntityRef ref;
  ref.bodyId = activeBodyNode();
  ref.kind = forge::ui::EntityKind::Edge;
  ref.persistentName = set.edges[index].key();
  shell_.selection().setPreselection(ref);
}

void ForgeFrame::clickEdge(std::size_t index, bool additive) {
  const forge::ui::EdgeSet& set = edges();
  if (index >= set.size()) {
    if (!additive) {
      shell_.selection().clearSelection();
      syncSelectionToScene();
      note("selection cleared");
    }
    return;
  }
  forge::ui::EntityRef ref;
  ref.bodyId = activeBodyNode();
  ref.kind = forge::ui::EntityKind::Edge;
  ref.persistentName = set.edges[index].key();
  if (!shell_.selection().accepts(ref.kind)) {
    note("The pick filter is not set to edge, so this edge was not picked");
    return;
  }
  if (additive) {
    shell_.selection().toggle(ref);
  } else {
    shell_.selection().replaceWith({ref});
  }
  shell_.selection().setFocus(ref);
  // An edge selection flags no face, so the vertex stream must be cleared of any
  // face highlight left over from a face pick -- otherwise the viewport shows a
  // face lit while the status strip and every command say an edge is selected.
  syncSelectionToScene();
  note("Picked an edge  (" + std::to_string(shell_.selection().count()) +
       " picked in all)");
}

// ── dock ratio writeback ────────────────────────────────────────────────────
namespace {

forge::ui::DockNode* nodeAt(forge::ui::DockNode& root, const std::vector<std::size_t>& path) {
  forge::ui::DockNode* n = &root;
  for (std::size_t step : path) {
    if (n->kind != forge::ui::DockNodeKind::Split || n->children.size() != 2) return nullptr;
    n = &n->children[step];
  }
  return n;
}

}  // namespace

void ForgeFrame::setRatioAt(const std::vector<std::size_t>& path, double ratio) {
  // DockLayout hands out its windows const-only, so the layout is REBUILT from a
  // mutated copy rather than by reaching past the model's interface. The copy is
  // a handful of nodes; the alternative is a mutable accessor that would let any
  // caller desynchronise the tree from what serialize() writes.
  const forge::ui::DockLayout& live = shell_.layout();
  forge::ui::DockLayout rebuilt;
  bool changed = false;
  for (const forge::ui::DockWindow& w : live.windows()) {
    forge::ui::DockWindow copy = w;
    if (w.main) {
      if (forge::ui::DockNode* n = nodeAt(copy.root, path)) {
        if (n->kind == forge::ui::DockNodeKind::Split) {
          n->ratio = std::clamp(ratio, 0.08, 0.92);
          changed = true;
        }
      }
    }
    rebuilt.addWindow(std::move(copy));
  }
  if (changed && rebuilt.valid()) {
    // THE SAFETY NET. Re-seating while the draw is walking the tree destroys
    // every DockNode the recursion holds by const reference, and drawNode()
    // reads node.children[1] on the line AFTER the splitter is drawn. A caller
    // inside the walk gets its request DEFERRED to the end of the frame rather
    // than a use-after-free -- the same frame, just after the walk -- and the
    // violation is COUNTED so a gate can see the sloppy call site that the net
    // just caught. Loud in test, safe in production.
    if (walkDepth_ != 0) {
      ++reseatsDuringWalk_;
      pendingRatioValid_ = true;
      pendingRatioPath_ = path;
      pendingRatioValue_ = ratio;
      return;
    }
    shell_.layout() = std::move(rebuilt);
  }
}

void ForgeFrame::setActiveTabAt(const std::vector<std::size_t>& path, std::size_t active) {
  const forge::ui::DockLayout& live = shell_.layout();
  forge::ui::DockLayout rebuilt;
  bool changed = false;
  for (const forge::ui::DockWindow& w : live.windows()) {
    forge::ui::DockWindow copy = w;
    if (w.main) {
      if (forge::ui::DockNode* n = nodeAt(copy.root, path)) {
        if (n->kind == forge::ui::DockNodeKind::Tabs && active < n->panels.size() &&
            n->activeTab != active) {
          n->activeTab = active;
          changed = true;
        }
      }
    }
    rebuilt.addWindow(std::move(copy));
  }
  if (changed && rebuilt.valid()) {
    // The same safety net as setRatioAt above, for the gesture that actually
    // shipped broken: a tab button that called this from inside drawTabGroup
    // freed the node the loop was walking, and the next read faulted at 0x17.
    if (walkDepth_ != 0) {
      ++reseatsDuringWalk_;
      pendingTabValid_ = true;
      pendingTabPath_ = path;
      pendingTabIndex_ = active;
      return;
    }
    shell_.layout() = std::move(rebuilt);
    // WHICH PANELS THE KEYBOARD CAN REACH JUST CHANGED. A tab click hides one
    // panel and shows another, and FocusRing keeps only the VISIBLE stops --
    // it cannot observe a write through the mutable layout() accessor, which is
    // why refreshPanelFocus() exists and why leaving it uncalled would let
    // view.focus_next_panel walk to a panel that is now behind a tab.
    shell_.refreshPanelFocus();
  }
}

// ── the frame ───────────────────────────────────────────────────────────────
void ForgeFrame::build(std::uint64_t viewportTexture, float dpiScale) {
  // ── WHAT THE INTERFACE RECOVERED FROM LAST FRAME REACHES THE USER HERE ───
  //
  // The library raises a recoverable error from INSIDE EndFrame()/End(), which
  // is after this builder has returned, so the notice queued on frame N is
  // drained at the top of frame N+1. It is the first thing done, before any
  // panel is drawn, so a panel that erred every frame still gets its first
  // notice into the log before it errs again.
  //
  // TWO REGISTERS, deliberately, and they are the columns the log already has:
  // the user reads a sentence about their part, and the library's own words
  // ("Missing End()") are kept verbatim in the detail column beside it. Nothing
  // is suppressed and nothing developer-shaped is drawn.
  for (const ImGuiErrorNotice& notice : drainImGuiErrorNotices()) {
    shell_.log().error("interface", notice.userText, notice.detail);
  }
  // A queue that filled and dropped is itself a fact worth one line -- silence
  // there would make "3 notices" and "3 notices out of 900" read the same.
  if (const std::size_t dropped = imGuiErrorNoticesDropped(); dropped > 0) {
    shell_.log().error("interface",
                       "Forge is recovering from a repeating problem in one of its panels. "
                       "Your part is untouched. Save your work and restart Forge.",
                       "notices dropped past the queue cap: " + std::to_string(dropped));
    resetImGuiErrorNotices();
  }

  // THE EDGE, on the one path nothing can bypass. Every mutation of the document
  // -- a menu item, a shortcut, the palette, a macro, an Archie tool call, a
  // file.open -- is visible here before the frame that shows it is drawn.
  syncSceneToDocument();

  dpiScale_ = dpiScale > 0.1f ? dpiScale : 1.0f;
  panelsDrawn_ = 0;
  panelIdsDrawn_.clear();
  tabHits_.clear();
  splitterHits_.clear();
  // reseatsDuringWalk_ is deliberately NOT reset here. It is a LIFETIME total,
  // not a per-frame one: the violation happens during the frame that carries the
  // gesture, and every useful assertion about it is made after the FOLLOWING
  // frame -- which is precisely the frame a per-frame counter would have zeroed.
  // Measured: with the counter reset here, the click gate stayed green against
  // the reverted fix. A check that resets itself before anyone reads it is not a
  // check.
  treeRowsDrawn_ = 0;
  modelRowsDrawn_ = 0;
  modelFaceRowsDrawn_ = 0;
  sketchRowsDrawn_ = 0;
  treeExpanderRect_.valid = false;
  viewportRequest_ = ViewportRequest{};
  viewportRequest_.wireframe = shell_.document().wireframe;
  viewportRequest_.geometryDirty = geometryDirty_;
  geometryDirty_ = false;
  viewportRequest_.visibilityDirty = visibilityDirty_;
  visibilityDirty_ = false;

  // ── view.fit, ON THE SAME PATH AS view.wireframe ─────────────────────────
  // `view.fit`'s whole execute body is `++doc_.fitCount` (ForgeShell.cpp), and
  // camera_.frame() was called EXACTLY ONCE, in this class's constructor.
  // Nothing read the counter. So F / Ctrl+F / Alt+F / Home ran, journalled,
  // printed "view.fit -> ok" and DID NOT MOVE THE CAMERA -- the same
  // counter-that-nobody-reads defect the retired model.* stubs were removed for.
  // The line above is the pattern that already worked: the frame PULLS the
  // shell's view state every frame rather than a handler pushing it, so the fit
  // fires whoever asked for it -- menu, keystroke, palette, ribbon, macro or an
  // Archie tool call -- with no invoker having to remember.
  applyPendingFit();
  applyPendingSelectionFit();
  applyPendingView();

  const ImGuiIO& io = ImGui::GetIO();
  const float W = io.DisplaySize.x;
  const float H = io.DisplaySize.y;

  // ── THE THEME COMMAND CHANGES THE PICTURE ────────────────────────────────
  // app.toggle_theme is a registered command that flips ForgeShell::themeMode(),
  // and NOTHING WAS READING IT: the style was applied once at startup from
  // hard-coded literals, so the command moved a field, journalled, reported ok
  // and changed no pixel -- the same counter-nobody-reads shape as `view.fit`
  // before applyPendingFit() existed, and as the retired model.* stubs.
  //
  // Re-styled here, at the top of the frame, BEFORE any widget is drawn: ImGui
  // reads style.Colors as it goes, so changing them mid-frame would paint half
  // the window in each theme. Guarded on the mode actually having changed, since
  // applyForgeStyle rebuilds the whole ImGuiStyle.
  if (!styleApplied_ || appliedTheme_ != shell_.themeMode() || appliedDpi_ != dpiScale) {
    applyForgeStyle(dpiScale, shell_.themeMode());
    appliedTheme_ = shell_.themeMode();
    appliedDpi_ = dpiScale;
    styleApplied_ = true;
  }

  // ONE evaluation of the registry per frame, feeding the menu bar, the ribbon
  // and the context menu. They cannot disagree about what is available because
  // they are three views of the same value.
  rebuildCommandSurfaces();

  drawMenuBar();
  const float menuH = ImGui::GetFrameHeight();
  const float tabsH = kWorkspaceTabH * dpiScale_;
  const float toolH = kToolbarH * dpiScale_;
  const float statH = kStatusH * dpiScale_;

  drawWorkspaceTabs(menuH, W, tabsH);
  drawToolbar(menuH + tabsH, W, toolH);

  forge::ui::Rect dockArea;
  dockArea.x = 0.0;
  dockArea.y = static_cast<double>(menuH + tabsH + toolH);
  dockArea.w = static_cast<double>(W);
  dockArea.h = static_cast<double>(H - menuH - tabsH - toolH - statH);
  if (dockArea.h < 40.0) dockArea.h = 40.0;
  drawDockedPanels(dockArea, viewportTexture);

  drawStatusStrip(H - statH, W, statH);
  drawCommandPalette();
  drawParameterPrompt();

  // ── the deferred mutations ───────────────────────────────────────────────
  // The walk is over and no DockNode reference is live, so it is now safe to
  // re-seat the layout and to rebuild the tree. Doing any of these INSIDE the walk
  // is what crashed the shipped app: setActiveTabAt() ends in
  // `shell_.layout() = std::move(rebuilt)`, which frees the node drawTabGroup was
  // holding, and the next statement read node.panels[active] out of it.
  // drawSplitter() had the identical hazard on a drag -- drawNode() reads
  // node.children[1] on the line AFTER the splitter is drawn -- and the feature
  // tree had it a third time, where tree_.rebuild() resized rows_ mid-clipper.
  if (pendingTabValid_) {
    pendingTabValid_ = false;
    setActiveTabAt(pendingTabPath_, pendingTabIndex_);
  }
  if (pendingRatioValid_) {
    pendingRatioValid_ = false;
    setRatioAt(pendingRatioPath_, pendingRatioValue_);
  }
  if (pendingExpandValid_) {
    pendingExpandValid_ = false;
    tree_.setExpanded(pendingExpandId_, pendingExpandState_);
    tree_.rebuild();
  }
  // The CoPilot's buttons, in the order a user can only press them: an offer
  // must exist before it can be accepted or rejected, and Send is what makes one.
  if (pendingCopilotSubmit_) {
    pendingCopilotSubmit_ = false;
    runCopilotSubmit();
  }
  if (pendingCopilotApply_) {
    pendingCopilotApply_ = false;
    runCopilotApply();
  }
  if (pendingCopilotDiscard_) {
    pendingCopilotDiscard_ = false;
    runCopilotDiscard();
  }
  // Run on the parameter prompt, deferred for the same reason: it dispatches a
  // command that can replace the document (file.open, app.load_sample) and
  // rebuild the feature tree the walk was indexing.
  if (pendingPromptSubmit_) {
    pendingPromptSubmit_ = false;
    submitPrompt();
  }
  // A command asked for from inside a docked panel — the empty state's buttons.
  // Cleared BEFORE the dispatch, so a handler that somehow records another one
  // is honoured on the next frame instead of being wiped by this line.
  if (!pendingInvokeId_.empty()) {
    const std::string id = pendingInvokeId_;
    pendingInvokeId_.clear();
    invoke(id);
  }
  // The file panel, before Open Recent and after everything else: it runs a
  // MODAL nested event loop, so it must not start until the dock walk has
  // returned and every deferred mutation above has been applied -- the panel
  // blocks this thread until the user answers, and the frame it is standing in
  // front of is the one the walk just finished.
  runPendingFileDialog();
  // Open Recent, last: it REPLACES the document, so anything above that acts on
  // the document the user was looking at when they clicked must run first.
  runPendingOpen();
}

void ForgeFrame::drawMenuBar() {
  if (!ImGui::BeginMainMenuBar()) return;

  // ── THE MENU IS A VALUE, AND THIS LOOP JUST DRAWS IT ──────────────────────
  // Every decision below -- which groups exist, in what order, which items are
  // in them, whether each is greyed, which shortcut sits beside it and what its
  // tooltip says -- was computed by forge::ui::buildMenuSurface() from the ONE
  // registry, in the layer CI compiles and ui/test/command_surface_test.cpp
  // gates. There is no menu table anywhere: a group is a registry CATEGORY, an
  // item is a registry COMMAND, and its state is the dispatcher's own answer.
  // Register a command and it appears here, with no edit to this file -- which
  // is asserted, with its negative half, rather than claimed.
  const std::vector<std::string> wsCats = forge::ui::workspaceCategories(shell_.workspace());
  for (const forge::ui::SurfaceGroup& group : menuSurface_.groups) {
    if (!ImGui::BeginMenu(group.title.c_str())) continue;
    for (const forge::ui::SurfaceItem& item : group.items) {
      const bool clickable = item.enabled() || item.opensDialog();
      // A command that must ask for a value is offered with an ellipsis, the way
      // every menu since 1984 has said "this one opens a dialog".
      const std::string label = item.opensDialog() ? (item.label + "...") : item.label;
      if (ImGui::MenuItem(label.c_str(), item.shortcut.empty() ? nullptr : item.shortcut.c_str(),
                          false, clickable)) {
        invoke(item.commandId);
      }
      if (ImGui::IsItemHovered(ImGuiHoveredFlags_DelayNormal |
                               ImGuiHoveredFlags_AllowWhenDisabled)) {
        // `hint` is the SAME sentence the activity log prints when this command
        // refuses, from the same explainer, so a tooltip and a log line can
        // never tell the user two different stories about one command.
        // WHAT IT DOES AND WHY IT IS GREY. This tooltip, on every menu item in
        // the application, used to be a four-field dump of the command
        // descriptor: "id: part.fillet", "IR: FILLET", "parameters:
        // radius:number*=3". Three of those four fields name the program's own
        // objects; the fourth, `reason`, carried the status code. The id, the
        // op and the schema are still on the item -- the agent surface and the
        // capability manifest report all three -- and none of them belongs on a
        // machinist's screen.
        if (item.reason.empty()) {
          ImGui::SetTooltip("%s", item.hint.c_str());
        } else {
          ImGui::SetTooltip("%s\n\n%s", item.hint.c_str(), item.reason.c_str());
        }
      }
    }
    // ── File > Open Recent ────────────────────────────────────────────────
    // NOT a second enumeration of the registry, and not a second copy of the
    // menu: the rows are DOCUMENTS, they come from the shell's own recent list,
    // and clicking one dispatches the single `file.open` command that the item
    // loop above already offers. Drawn inside the File group so it sits where
    // every CAD application has put it, and appended after the derived items so
    // the derived surface still decides what File contains.
    if (group.title == "File") {
      const forge::ui::RecentDocuments& recent = shell_.recentDocuments();
      ImGui::Separator();
      if (ImGui::BeginMenu("Open Recent", !recent.empty())) {
        const std::vector<std::string>& paths = recent.paths();
        const std::vector<std::string> labels = recent.labels();
        for (std::size_t i = 0; i < paths.size() && i < labels.size(); ++i) {
          if (ImGui::MenuItem(labels[i].c_str())) requestOpenDocument(paths[i]);
          if (ImGui::IsItemHovered(ImGuiHoveredFlags_DelayNormal)) {
            // The FULL path, always: the row may be showing only a leaf, and
            // "which bracket.fpart is this" has to be answerable without
            // opening it.
            ImGui::SetTooltip("%s", paths[i].c_str());
          }
        }
        ImGui::EndMenu();
      }
      // A disabled "Open Recent" says the list is empty; nothing else in the
      // window does, and a menu that is simply absent reads as a missing feature.
      if (recent.empty() && ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
        ImGui::SetTooltip("No documents yet. Opening or saving one puts it here,\n"
                          "and it survives a relaunch.");
      }
    }
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Window")) {
    if (ImGui::MenuItem("Reset Workspace Layout")) {
      shell_.resetWorkspaceLayout();
      note("Workspace layout reset");
    }
    ImGui::Separator();
    for (forge::ui::WorkspaceProfile p : forge::ui::allWorkspaceProfiles()) {
      if (ImGui::MenuItem(forge::ui::userText(p), nullptr, p == shell_.workspace())) {
        shell_.setWorkspace(p);
        note(std::string("Workspace: ") + forge::ui::userText(p));
      }
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Quit")) quit_ = true;
    ImGui::EndMenu();
  }

  // ── Help: the ONE place a user learns a new version exists ──────────────────
  // A shipped copy of Forge is ad-hoc signed, so its FIRST launch costs a trip
  // through System Settings. Every launch after that is free ONLY if the app can
  // update itself, which is why this menu is not cosmetic.
  if (ImGui::BeginMenu("Help")) {
    if (!runningVersion_.empty()) {
      ImGui::MenuItem((std::string("Forge ") + runningVersion_).c_str(), nullptr, false, false);
      ImGui::Separator();
    }
    const bool checking = update_.state == UpdateState::Checking;
    const bool installing = update_.state == UpdateState::Installing;
    const bool busy = checking || installing;
    if (ImGui::MenuItem(checking ? "Checking for Updates..." : "Check for Updates...", nullptr,
                        false, !busy)) {
      updateCheckPending_ = true;
    }
    // ★ THE ACT, not just the news. An update the user is told about and cannot
    // install is the release chain stopping one inch short, on their machine,
    // for ever: they re-download a zip by hand and clear Gatekeeper again every
    // time. This item is the only place in the product that writes to the
    // installed bundle, so it is enabled ONLY when a check has actually offered
    // a version -- never as a speculative "try to update".
    if (update_.state == UpdateState::Available && !update_.version.empty()) {
      if (ImGui::MenuItem(("Install Forge " + update_.version + "...").c_str(), nullptr, false,
                          !busy)) {
        updateApplyPending_ = true;
      }
    } else if (installing) {
      ImGui::MenuItem("Installing...", nullptr, false, false);
    }
    if (!update_.message.empty()) {
      ImGui::Separator();
      ImGui::MenuItem(update_.message.c_str(), nullptr, false, false);
    }
    ImGui::EndMenu();
  }


  if (ImGui::BeginMenu("Input Profile")) {
    for (forge::ui::InputProfile p : forge::ui::allInputProfiles()) {
      if (ImGui::MenuItem(forge::ui::userText(p), nullptr, p == shell_.inputProfile())) {
        shell_.setInputProfile(p);
        note(std::string("Mouse and keyboard: ") + forge::ui::userText(p) + "  |  " +
             navHintFor(p));
      }
    }
    ImGui::EndMenu();
  }

  // Right-aligned: which workspace's ribbon is live, and how many commands the
  // one registry holds. Only the workspace's DISTINCTIVE category is named --
  // listing all of them overflowed the menu bar and was truncated mid-word.
  std::string distinctive = "Model";
  for (const std::string& c : wsCats) {
    if (c != "Application" && c != "Edit" && c != "File" && c != "View") distinctive = c;
  }
  char right[128];
  std::snprintf(right, sizeof(right), "%s ribbon   %zu commands", distinctive.c_str(),
                shell_.registry().size());
  const float tw = ImGui::CalcTextSize(right).x;
  ImGui::SameLine(std::max(ImGui::GetCursorPosX(),
                           ImGui::GetWindowWidth() - tw - 16.0f * dpiScale_));
  ImGui::TextColored(rgb(130, 137, 148), "%s", right);
  ImGui::EndMainMenuBar();
}

void ForgeFrame::drawWorkspaceTabs(float y, float width, float height) {
  ImGui::SetNextWindowPos(ImVec2(0, y));
  ImGui::SetNextWindowSize(ImVec2(width, height));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(6, 2));
  if (ImGui::Begin("##workspace_tabs", nullptr,
                   ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                       ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus |
                       ImGuiWindowFlags_NoScrollbar)) {
    for (forge::ui::WorkspaceProfile p : forge::ui::allWorkspaceProfiles()) {
      const bool active = (p == shell_.workspace());
      if (active) ImGui::PushStyleColor(ImGuiCol_Button, rgb(242, 158, 38, 0.85f));
      // userText, not a capitalised slug. This loop used to upper-case the
      // FIRST LETTER of toString(p) -- the saved-layout key -- so the tabs read
      // "Part", "Manufacturing" only because those slugs happen to be single
      // words. The name is data now, not a transformation of an identifier.
      const char* n = forge::ui::userText(p);
      if (ImGui::Button(n)) {
        shell_.setWorkspace(p);
        note(std::string("Workspace: ") + n);
      }
      if (active) ImGui::PopStyleColor();
      ImGui::SameLine();
    }
    ImGui::NewLine();
  }
  ImGui::End();
  ImGui::PopStyleVar();
}

void ForgeFrame::drawToolbar(float y, float width, float height) {
  ImGui::SetNextWindowPos(ImVec2(0, y));
  ImGui::SetNextWindowSize(ImVec2(width, height));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(6, 4));
  // NoDecoration is spelled out MINUS its NoScrollbar bit, plus a horizontal
  // scrollbar: the Part ribbon is 34 buttons wide and a single un-scrollable row
  // clips the tail silently — enumerated, dispatchable, and off the right edge.
  if (ImGui::Begin("##toolbar", nullptr,
                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                       ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                       ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus |
                       ImGuiWindowFlags_HorizontalScrollbar)) {
    // The ribbon: the commands whose CATEGORY this workspace claims, as a value
    // built by forge::ui::buildRibbonSurface() from the SAME registry and the
    // SAME enabled predicate the menu bar and the dispatcher use.
    //
    // ribbonCategories(), not workspaceCategories(), and that is inside the
    // model now: the hand-written claim list is made TOTAL over the categories
    // the registry actually holds. It claimed no "Part", so 21 of 34 commands --
    // every geometry-building one -- rendered on no ribbon in any workspace
    // while the menu bar showed all 34. ui/test/command_surface_test.cpp asserts
    // the union over all eight workspaces covers the registry, so that cannot
    // silently come back.
    bool first = true;
    for (const forge::ui::SurfaceGroup& group : ribbonSurface_.groups) {
      for (const forge::ui::SurfaceItem& item : group.items) {
        if (!first) ImGui::SameLine();
        first = false;
        const bool on = item.enabled() || item.opensDialog();
        ImGui::BeginDisabled(!on);
        const std::string label = item.opensDialog() ? (item.label + "...") : item.label;
        if (ImGui::Button(label.c_str())) invoke(item.commandId);
        ImGui::EndDisabled();
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
          ImGui::SetTooltip("%s   %s\n%s", item.label.c_str(), item.shortcut.c_str(),
                            item.hint.c_str());
        }
      }
    }
    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    if (ImGui::Button("Command Palette")) invoke("app.command_palette");
  }
  ImGui::End();
  ImGui::PopStyleVar();
}

void ForgeFrame::drawStatusStrip(float y, float width, float height) {
  ImGui::SetNextWindowPos(ImVec2(0, y));
  ImGui::SetNextWindowSize(ImVec2(width, height));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8, 3));
  ImGui::PushStyleColor(ImGuiCol_WindowBg, rgb(22, 25, 29));
  if (ImGui::Begin("##status", nullptr,
                   ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                       ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar)) {
    // ── the selection FILTER, the thing that makes "pick an edge" mean it ──
    const forge::ui::EntityKind kinds[] = {
        forge::ui::EntityKind::Any,    forge::ui::EntityKind::Face,
        forge::ui::EntityKind::Edge,   forge::ui::EntityKind::Vertex,
        forge::ui::EntityKind::Body,   forge::ui::EntityKind::Sketch,
        forge::ui::EntityKind::Feature};
    ImGui::TextColored(rgb(130, 137, 148), "Filter");
    ImGui::SameLine();
    ImGui::SetNextItemWidth(110.0f * dpiScale_);
    if (ImGui::BeginCombo("##filter", forge::ui::toString(shell_.selection().filter()))) {
      for (forge::ui::EntityKind k : kinds) {
        if (ImGui::Selectable(forge::ui::toString(k), k == shell_.selection().filter())) {
          shell_.selection().setFilter(k);
          note(std::string("Pick filter: ") + forge::ui::userText(k));
        }
      }
      ImGui::EndCombo();
    }
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
      ImGui::SetTooltip(
          "What a viewport click picks.\n"
          "face  — the default; feeds Hole, Shell, Counterbore\n"
          "edge  — feeds Edge Fillet, Edge Chamfer, Variable Fillet\n"
          "The filter also REFUSES a pick of any other kind, so a command can "
          "never run on the wrong topology.");
    }
    if (edgePickMode()) {
      ImGui::SameLine();
      ImGui::TextColored(rgb(90, 184, 242), "edge pick");
    }

    // ── THE STRIP IS A VALUE ──────────────────────────────────────────────
    // Selection, document counters, workspace, input profile, progress and the
    // last thing worth saying are all forge::ui::buildStatusSummary(), read from
    // the shell rather than accumulated here — so the strip cannot drift from
    // the state it is reporting, and ui/test/shell_ux_test.cpp gates the
    // derivation. What this function still owns is the pixels.
    const forge::ui::StatusSummary summary =
        forge::ui::buildStatusSummary(shell_, progress_, statusMeasurement());

    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    ImGui::Text("%s", summary.selection.c_str());

    // ── THE MEASUREMENT OF WHAT IS PICKED ─────────────────────────────────
    // A CAD status bar that names a selection and not its size is half a
    // readout. This is the SAME arithmetic the Measure panel prints, over the
    // same triangles and the same face ids, so the two cannot disagree.
    if (summary.measurement != "-") {
      ImGui::SameLine();
      ImGui::TextColored(rgb(122, 196, 108), "%s", summary.measurement.c_str());
    }

    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    ImGui::Text("%s", navHintFor(shell_.inputProfile()));

    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    ImGui::Text("%s", summary.document.c_str());

    // ── OPERATION PROGRESS ────────────────────────────────────────────────
    // Only while something is running. An indeterminate tracker prints
    // "(working)" rather than a fabricated percentage: a bar that lies about how
    // far along it is, is worse than no bar.
    if (!summary.progress.empty()) {
      ImGui::SameLine();
      ImGui::TextColored(rgb(120, 126, 137), "|");
      ImGui::SameLine();
      ImGui::TextColored(rgb(242, 158, 38), "%s", summary.progress.c_str());
    }

    // Right side: the last thing that happened. A status bar that never says
    // what failed is decoration.
    //
    // ELIDED to the space that is actually left. Right-aligning an unbounded
    // string does not fit it: MEASURED on a screenshot of the live window, an
    // "opened <absolute path>" status was wider than the strip and was drawn
    // straight through the navigation hints, so two messages occupied the same
    // pixels and neither was readable. The TAIL is kept, because that is where
    // both a path and a failure reason say what happened.
    // SameLine() FIRST. After a Text() the cursor has already wrapped to the next
    // line, so GetCursorPosX() returns the line indent (~8 px), not the end of
    // what was just drawn -- MEASURED: the first version of this elide computed
    // ~1660 px of "available" width on a strip with ~800 px left, decided the
    // status fitted, and right-aligned it straight back over the navigation
    // hints. SameLine() restores the cursor to the previous item's right edge,
    // which is the number this needs.
    ImGui::SameLine();
    const float pad = 14.0f * dpiScale_;
    const float used = ImGui::GetCursorPosX();
    const float avail = width - used - pad;
    // summary.message, not status_. status_ is the last line ANY note() wrote,
    // including "rebuilt: 1240 -> 1240 triangles"; summary.message is the last
    // WARNING OR ERROR if there has been one, and only falls back to the last
    // info line otherwise. A refusal that scrolls away behind six successful
    // rebuilds before the user has read it is the failure this prefers against.
    std::string shown = summary.message;
    if (avail > 0.0f && ImGui::CalcTextSize(shown.c_str()).x > avail) {
      // Binary search on the kept suffix: ~9 width queries for any status this
      // strip will ever hold, instead of one per dropped character.
      std::size_t lo = 0, hi = shown.size();
      while (lo < hi) {
        const std::size_t mid = lo + (hi - lo) / 2;  // keep the last size()-mid chars
        const std::string cand = "..." + shown.substr(mid);
        if (ImGui::CalcTextSize(cand.c_str()).x > avail) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      shown = "..." + shown.substr(lo);
    }
    const float tw = ImGui::CalcTextSize(shown.c_str()).x;
    ImGui::SameLine(std::max(used, width - tw - pad));
    // COLOURED BY SEVERITY, which the summary carries so this does not have to
    // re-derive it. A refusal drawn in the same grey as "rebuilt 1240 triangles"
    // is a refusal the eye slides off.
    ImVec4 messageColour = rgb(170, 176, 186);
    if (summary.severity == forge::ui::Severity::Warning) messageColour = rgb(242, 158, 38);
    if (summary.severity == forge::ui::Severity::Error) messageColour = rgb(235, 105, 95);
    ImGui::TextColored(messageColour, "%s", shown.c_str());
    if (ImGui::IsItemHovered() && shown != summary.message) {
      // The elide keeps the tail; the tooltip keeps everything.
      ImGui::SetTooltip("%s", summary.message.c_str());
    }
  }
  ImGui::End();
  ImGui::PopStyleColor();
  ImGui::PopStyleVar();
}

// ── the dock tree -> rectangles ─────────────────────────────────────────────
void ForgeFrame::drawDockedPanels(const forge::ui::Rect& area, std::uint64_t viewportTexture) {
  const forge::ui::DockWindow* main = shell_.layout().mainWindow();
  if (main == nullptr) return;
  // ImGui clamps EVERY window to style.WindowMinSize (32x32 by default), even one
  // whose size is set explicitly. MEASURED on the first screenshot: the 5 px
  // splitter windows came out 32 px and overpainted 27 px of the panel next to
  // them, hiding the right dock's tab strip and the bottom dock's entire tab row.
  // These windows are sized by the dock MODEL, never by the user, so the minimum
  // is a constraint with nothing to protect.
  ImGui::PushStyleVar(ImGuiStyleVar_WindowMinSize, ImVec2(1.0f, 1.0f));
  // THE WALK IS OPEN. From here until drawNode() returns, `main->root` and every
  // node reached from it is held by const reference across the whole recursion,
  // so nothing may re-seat shell_.layout() until the bracket closes. The write
  // API counts any violation into reseatsDuringWalk_, which the click gate
  // asserts is zero.
  //
  // Balanced by a scope guard, not by a matching statement: a throw out of a
  // panel body would otherwise leave walkDepth_ non-zero for ever, and every
  // later gesture would silently defer a frame and climb the counter. That is a
  // benign failure, but it is a failure nobody would ever be told about.
  struct WalkGuard {
    std::size_t& d;
    explicit WalkGuard(std::size_t& depth) : d(depth) { ++d; }
    ~WalkGuard() { --d; }
    WalkGuard(const WalkGuard&) = delete;
    WalkGuard& operator=(const WalkGuard&) = delete;
  };
  {
    WalkGuard walking(walkDepth_);
    drawNode(main->root, area, {}, viewportTexture);
  }
  ImGui::PopStyleVar();
}

void ForgeFrame::drawNode(const forge::ui::DockNode& node, const forge::ui::Rect& r,
                          const std::vector<std::size_t>& path, std::uint64_t viewportTexture) {
  if (r.w <= 2.0 || r.h <= 2.0) return;
  if (node.kind == forge::ui::DockNodeKind::Tabs) {
    drawTabGroup(node, r, path, viewportTexture);
    return;
  }
  if (node.children.size() != 2) return;

  const double s = static_cast<double>(kSplitter * dpiScale_);
  forge::ui::Rect a = r, b = r, split = r;
  if (node.axis == forge::ui::SplitAxis::Horizontal) {
    const double first = std::max(0.0, (r.w - s) * node.ratio);
    a.w = first;
    split.x = r.x + first;
    split.w = s;
    b.x = r.x + first + s;
    b.w = std::max(0.0, r.w - first - s);
  } else {
    const double first = std::max(0.0, (r.h - s) * node.ratio);
    a.h = first;
    split.y = r.y + first;
    split.h = s;
    b.y = r.y + first + s;
    b.h = std::max(0.0, r.h - first - s);
  }

  std::vector<std::size_t> pa = path, pb = path;
  pa.push_back(0);
  pb.push_back(1);
  drawNode(node.children[0], a, pa, viewportTexture);
  drawSplitter(split, node.axis == forge::ui::SplitAxis::Vertical, path, node.ratio,
               node.axis == forge::ui::SplitAxis::Horizontal ? (r.w - s) : (r.h - s));
  drawNode(node.children[1], b, pb, viewportTexture);
}

void ForgeFrame::drawSplitter(const forge::ui::Rect& r, bool vertical,
                              const std::vector<std::size_t>& path, double ratio,
                              double parentExtent) {
  char id[64];
  std::snprintf(id, sizeof(id), "##split_%zu_%d_%d", path.size(), static_cast<int>(r.x),
                static_cast<int>(r.y));
  ImGui::SetNextWindowPos(ImVec2(static_cast<float>(r.x), static_cast<float>(r.y)));
  ImGui::SetNextWindowSize(ImVec2(static_cast<float>(r.w), static_cast<float>(r.h)));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
  ImGui::PushStyleColor(ImGuiCol_WindowBg, rgb(20, 22, 26));
  if (ImGui::Begin(id, nullptr,
                   ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                       ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                       ImGuiWindowFlags_NoBringToFrontOnFocus)) {
    ImGui::InvisibleButton("grip", ImVec2(std::max(1.0f, static_cast<float>(r.w)),
                                          std::max(1.0f, static_cast<float>(r.h))));
    if (ImGui::IsItemHovered() || ImGui::IsItemActive()) {
      ImGui::SetMouseCursor(vertical ? ImGuiMouseCursor_ResizeNS : ImGuiMouseCursor_ResizeEW);
    }
    if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)) {
      // A pixel drag becomes a RATIO delta against the parent's usable extent --
      // the parent rect minus the splitter strip, which is exactly the quantity
      // drawNode() multiplied the ratio by. Dividing by anything else makes the
      // splitter drift away from the cursor as the window is resized.
      const float delta = vertical ? ImGui::GetIO().MouseDelta.y : ImGui::GetIO().MouseDelta.x;
      if (parentExtent > 1.0 && delta != 0.0f) {
        // RECORD, do not apply: setRatioAt() re-seats shell_.layout(), and the
        // caller drawNode() reads node.children[1] on the line after this one.
        // Applying it here was the same use-after-free the tab click had.
        pendingRatioValid_ = true;
        pendingRatioPath_ = path;
        pendingRatioValue_ = ratio + static_cast<double>(delta) / parentExtent;
      }
    }
  }
  splitterHits_.push_back(SplitterHit{path, vertical, static_cast<float>(r.x),
                                      static_cast<float>(r.y), static_cast<float>(r.w),
                                      static_cast<float>(r.h)});
  ImGui::End();
  ImGui::PopStyleColor();
  ImGui::PopStyleVar();
}

void ForgeFrame::drawTabGroup(const forge::ui::DockNode& node, const forge::ui::Rect& r,
                              const std::vector<std::size_t>& path,
                              std::uint64_t viewportTexture) {
  if (node.panels.empty()) return;
  const std::size_t active = std::min(node.activeTab, node.panels.size() - 1);

  char id[96];
  std::snprintf(id, sizeof(id), "##dock_%d_%d_%zu", static_cast<int>(r.x),
                static_cast<int>(r.y), node.panels.size());
  ImGui::SetNextWindowPos(ImVec2(static_cast<float>(r.x), static_cast<float>(r.y)));
  ImGui::SetNextWindowSize(ImVec2(static_cast<float>(r.w), static_cast<float>(r.h)));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
  if (ImGui::Begin(id, nullptr,
                   ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                       ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse |
                       ImGuiWindowFlags_NoSavedSettings |
                       ImGuiWindowFlags_NoBringToFrontOnFocus)) {
    // Tab strip: our tabs, driven by the DockNode's own activeTab index, so the
    // tab the user picks is the tab that gets serialized.
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(2, 0));
    for (std::size_t i = 0; i < node.panels.size(); ++i) {
      if (i > 0) ImGui::SameLine();
      const bool on = (i == active);
      // A COPY, taken before the button can fire. Everything after the button
      // must be reachable without touching `node` again, because a click used to
      // free it -- and the recorded hit box outlives this frame besides.
      const std::string panelId = node.panels[i];
      ImGui::PushStyleColor(ImGuiCol_Button, on ? rgb(52, 58, 68) : rgb(30, 33, 38));
      ImGui::PushStyleColor(ImGuiCol_Text, on ? rgb(240, 195, 120) : rgb(150, 157, 168));
      // RECORD, do not apply: setActiveTabAt() re-seats shell_.layout(), which
      // frees the DockNode `node` refers to. Applying it here made the next
      // read -- node.panels[active], four lines below -- a use-after-free, and
      // the shipped app SIGSEGV'd on the first tab click.
      if (ImGui::Button(prettyPanelName(panelId))) {
        pendingTabValid_ = true;
        pendingTabPath_ = path;
        pendingTabIndex_ = i;
      }
      const ImVec2 lo = ImGui::GetItemRectMin();
      const ImVec2 hi = ImGui::GetItemRectMax();
      tabHits_.push_back(TabHit{path, i, panelId, lo.x, lo.y, hi.x - lo.x, hi.y - lo.y});
      ImGui::PopStyleColor(2);
    }
    ImGui::PopStyleVar();
    ImGui::Separator();

    const float bodyH =
        std::max(1.0f, static_cast<float>(r.h) - kTabBarH * dpiScale_ - 8.0f * dpiScale_);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8, 6));
    if (ImGui::BeginChild("##body", ImVec2(0, bodyH), ImGuiChildFlags_None)) {
      drawPanel(node.panels[active], viewportTexture);
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();

    // ── THE KEYBOARD FOCUS, MADE VISIBLE ────────────────────────────────────
    // view.focus_next_panel and view.focus_previous_panel move
    // ForgeShell::panelFocus() and NOTHING DREW IT, so the two commands
    // journalled, reported ok and changed nothing a user could see — the same
    // shape as app.toggle_theme and as `view.fit` before applyPendingFit().
    //
    // Drawn as a border on the panel that holds the focus, from the theme's own
    // FocusRing token, which is contrast-audited like every other colour. A
    // focus indicator nobody can see is not a focus indicator.
    if (shell_.panelFocus().focused() == node.panels[active]) {
      ImGui::GetWindowDrawList()->AddRect(
          ImVec2(static_cast<float>(r.x) + 1.0f, static_cast<float>(r.y) + 1.0f),
          ImVec2(static_cast<float>(r.x + r.w) - 1.0f, static_cast<float>(r.y + r.h) - 1.0f),
          ImGui::GetColorU32(toImVec4(
              forge::ui::Theme::forMode(shell_.themeMode()).color(forge::ui::ColorToken::FocusRing))),
          0.0f, 0, 2.0f * dpiScale_);
    }
  }
  ImGui::End();
  ImGui::PopStyleVar();
}

void ForgeFrame::drawPanel(const std::string& panelId, std::uint64_t viewportTexture) {
  ++panelsDrawn_;
  panelIdsDrawn_.push_back(panelId);
  if (isViewportPanel(panelId)) {
    drawViewportPanel(viewportTexture);
  } else if (panelId == "feature_tree") {
    drawFeatureTreePanel();
  } else if (panelId == "model_browser") {
    // ── SEVEN TABS, ONE FUNCTION, AND WHAT REPLACED IT ────────────────────
    // This branch used to read
    //     panelId == "feature_tree" || panelId == "model_browser" ||
    //     panelId == "sketch_tree"  || panelId == "assembly_tree"  ||
    //     panelId == "operation_tree" || panelId == "study_tree"   ||
    //     panelId == "sheet_tree"
    // and dispatched all seven to drawFeatureTreePanel(). Whichever of them a
    // user clicked they got the build history, so six tabs were telling them
    // something untrue about what they were looking at -- and no gate could see
    // it, because the panel they shared was itself correct.
    //
    // Model and Sketch became REAL and DIFFERENT readings of the document (see
    // ModelTree.hpp). The remaining four were then dispatched NOWHERE, on the
    // reasoning that nothing in this application holds an assembly, a machining
    // setup, a study or a drawing sheet -- and the wrong half of that was
    // load-bearing. There is no SECOND document holding those things and there
    // does not need to be: all four are readings of the part document that
    // already exists, and each now has its own branch below and its own model in
    // forge/ui/WorkspaceTrees.hpp. Seven tabs, seven functions, seven questions.
    drawModelBrowserPanel();
  } else if (panelId == "sketch_tree") {
    drawSketchTreePanel();
  } else if (panelId == "assembly_tree") {
    drawAssemblyTreePanel();
  } else if (panelId == "operation_tree") {
    drawOperationTreePanel();
  } else if (panelId == "sheet_tree") {
    drawSheetTreePanel();
  } else if (panelId == "study_tree") {
    drawStudyTreePanel();
  } else if (panelId == "properties" || panelId == "operation_params") {
    drawPropertiesPanel();
  } else if (panelId == "console" || panelId == "archie_trace" || panelId == "solver_log" ||
             panelId == "simulation_log") {
    drawConsolePanel();
  } else if (panelId == "timeline") {
    drawTimelinePanel();
  } else if (panelId == "measure") {
    drawMeasurePanel();
  } else if (panelId == "appearance" || panelId == "materials") {
    // ONE panel behind both tabs. "What is this made of and what does it weigh"
    // is the same question from the Part workspace and from the Simulation
    // workspace, and two panels answering it would be two that drift.
    drawMaterialPanel();
  } else if (panelId == "curve_list") {
    drawCurveListPanel();
  } else if (panelId == "stock") {
    drawStockPanel();
  } else if (panelId == "verify_report") {
    drawVerifyReportPanel();
  } else if (panelId == "dimensions") {
    drawDimensionsPanel();
  } else if (panelId == "archie_tools") {
    drawToolsPanel();
  } else if (panelId == "bom") {
    drawBomPanel();
  } else if (panelId == "contacts") {
    drawContactsPanel();
  } else if (panelId == "component_filter") {
    drawComponentFilterPanel();
  } else if (panelId == "mates") {
    drawMatesPanel();
  } else if (panelId == "archie_copilot" || panelId == "archie_chat") {
    // ONE panel behind both tabs. The CoPilot IS the chat surface and the plan
    // surface: splitting them would put the transcript on one tab and the offer
    // it refers to on another, and a user would have to switch tabs to find out
    // what they were being asked to accept.
    drawCopilotPanel();
  } else {
    drawGenericPanel(panelId);
  }
}

// ── the 3D viewport ─────────────────────────────────────────────────────────
void ForgeFrame::drawViewportPanel(std::uint64_t viewportTexture) {
  const ImVec2 origin = ImGui::GetCursorScreenPos();
  const ImVec2 avail = ImGui::GetContentRegionAvail();
  const float w = std::max(16.0f, avail.x);
  const float h = std::max(16.0f, avail.y);

  viewportRequest_.visible = true;
  viewportRequest_.x = static_cast<int>(origin.x * dpiScale_);
  viewportRequest_.y = static_cast<int>(origin.y * dpiScale_);
  viewportRequest_.width = static_cast<int>(w * dpiScale_);
  viewportRequest_.height = static_cast<int>(h * dpiScale_);
  camera_.setAspect(w / h);

  if (viewportTexture != 0) {
    ImGui::Image(static_cast<ImTextureID>(viewportTexture), ImVec2(w, h));
  } else {
    // No GPU texture (headless, or before the first render): draw the frame the
    // geometry would occupy, so the layout is identical either way.
    ImGui::InvisibleButton("##viewport", ImVec2(w, h));
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(origin, ImVec2(origin.x + w, origin.y + h),
                      ImGui::GetColorU32(rgb(20, 23, 28)));
    dl->AddRect(origin, ImVec2(origin.x + w, origin.y + h),
                ImGui::GetColorU32(rgb(56, 61, 70)));
    // A black rectangle where the part should be, and the only explanation on a
    // console the user never opens, is the application failing silently. Say it
    // here, in the space the 3D view was going to occupy.
    if (!viewportUnavailable_.empty()) {
      const ImVec2 at(origin.x + 18.0f * dpiScale_, origin.y + 24.0f * dpiScale_);
      dl->AddText(at, ImGui::GetColorU32(rgb(235, 175, 95)), viewportUnavailable_.c_str());
    }
  }

  const bool hovered = ImGui::IsItemHovered();
  const ImVec2 mouse = ImGui::GetIO().MousePos;

  // ── navigation: the four profiles' drag verbs ─────────────────────────────
  NavInput nav;
  nav.left = ImGui::IsMouseDown(ImGuiMouseButton_Left);
  nav.middle = ImGui::IsMouseDown(ImGuiMouseButton_Middle);
  nav.right = ImGui::IsMouseDown(ImGuiMouseButton_Right);
  nav.shift = ImGui::GetIO().KeyShift;
  nav.ctrl = ImGui::GetIO().KeyCtrl;
  nav.alt = ImGui::GetIO().KeyAlt;
  const NavVerb verb = navVerbFor(shell_.inputProfile(), nav);

  if (hovered || verb != NavVerb::None) {
    const ImVec2 d = ImGui::GetIO().MouseDelta;
    switch (verb) {
      case NavVerb::Orbit:
        camera_.orbit(-d.x * 0.008f, d.y * 0.008f);
        break;
      case NavVerb::Pan:
        camera_.pan(d.x, d.y, h);
        break;
      case NavVerb::Zoom:
        camera_.zoom(-d.y * 0.05f);
        break;
      case NavVerb::None:
        break;
    }
  }
  if (hovered && ImGui::GetIO().MouseWheel != 0.0f) camera_.zoom(ImGui::GetIO().MouseWheel);

  // ── picking: hover preselects, click selects ──────────────────────────────
  // WHAT is picked follows the status strip's selection FILTER. Before edges
  // existed that control could only refuse: choosing "edge" left every ray hit
  // rejected by clickFace's accepts(Face) and the app unable to pick anything.
  if (hovered && verb == NavVerb::None && scene_.built()) {
    float ro[3], rd[3];
    camera_.ray(mouse.x - origin.x, mouse.y - origin.y, w, h, ro, rd);
    if (edgePickMode()) {
      // The tolerance is a PIXEL radius converted to world units at the eye
      // distance, so an edge stays as easy to hit zoomed out as zoomed in --
      // a fixed world tolerance would make a 200 mm-away edge unhittable and a
      // close one grab the whole screen.
      const double origin3[3] = {ro[0], ro[1], ro[2]};
      const double dir3[3] = {rd[0], rd[1], rd[2]};
      const double worldPerPixel =
          2.0 * static_cast<double>(camera_.distance()) *
          std::tan(0.5 * static_cast<double>(camera_.fovY())) /
          static_cast<double>(std::max(1.0f, h));
      const forge::ui::EdgePick p =
          forge::ui::pickEdge(edges(), origin3, dir3, kEdgePickPixels * worldPerPixel);
      setPreselectedEdge(p.hit() ? p.index : forge::ui::kNoEdge);
      if (ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
        clickEdge(p.hit() ? p.index : forge::ui::kNoEdge,
                  ImGui::GetIO().KeyShift || ImGui::GetIO().KeyCtrl);
      }
    } else {
      const PickResult pick = scene_.pick(ro, rd);
      setPreselectedFace(pick.faceId);
      if (ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
        clickFace(pick.faceId, ImGui::GetIO().KeyShift || ImGui::GetIO().KeyCtrl);
      }
    }
  } else if (!hovered && (hoverFace_ != 0 || hoverEdge_ != forge::ui::kNoEdge)) {
    if (edgePickMode()) {
      setPreselectedEdge(forge::ui::kNoEdge);
    } else {
      setPreselectedFace(0);
    }
  }
  viewportRequest_.hoverFace = hoverFace_;

  drawViewportOverlays(origin.x, origin.y, w, h);
  // AFTER the overlays: the empty state is the only thing worth reading when
  // there is no geometry, so it sits on top of the triad and the camera readout
  // rather than under them.
  drawEmptyState(origin.x, origin.y, w, h);
  drawContextMenu();
}

// Projects one recovered edge into the viewport rect and strokes it. Each
// SEGMENT is clipped independently on w > 0 (a segment with an endpoint behind
// the eye is dropped rather than smeared across the screen by a divide through a
// negative w, which is the classic wrong-side artefact).
void ForgeFrame::drawEdgePolyline(const forge::ui::MeshEdge& edge, float x, float y, float w,
                                  float h, std::uint32_t colour, float thickness) {
  ImDrawList* dl = ImGui::GetWindowDrawList();
  float vp[16];
  camera_.viewProj(vp);
  const auto project = [&vp, x, y, w, h](const double* p, ImVec2& out) {
    const float px = static_cast<float>(p[0]);
    const float py = static_cast<float>(p[1]);
    const float pz = static_cast<float>(p[2]);
    const float cx = vp[0] * px + vp[4] * py + vp[8] * pz + vp[12];
    const float cy = vp[1] * px + vp[5] * py + vp[9] * pz + vp[13];
    const float cw = vp[3] * px + vp[7] * py + vp[11] * pz + vp[15];
    if (!(cw > 1e-6f)) return false;
    // Vulkan NDC: x in [-1,1] left-to-right, y in [-1,1] TOP-to-bottom (the
    // projection already carries the Y flip), so the viewport map adds y
    // directly rather than subtracting it.
    out = ImVec2(x + (cx / cw * 0.5f + 0.5f) * w, y + (cy / cw * 0.5f + 0.5f) * h);
    return true;
  };
  for (std::size_t s = 0; s + 5 < edge.points.size(); s += 6) {
    ImVec2 a, b;
    if (!project(&edge.points[s], a)) continue;
    if (!project(&edge.points[s + 3], b)) continue;
    dl->AddLine(a, b, colour, thickness);
  }
}

// The whole latency argument for ImGui, made concrete: these composite into the
// SAME command buffer as the geometry, with no second context and no per-frame
// FBO copy (DECISION D-001, ground 2).
// ── ONBOARDING: THE EMPTY WINDOW A NEW USER MEETS ───────────────────────────
//
// A CAD application that opens on a dark rectangle and a menu bar tells a new
// user nothing. This panel appears when the document holds no features and says
// three things: what state the document is in, which commands are a legal FIRST
// step, and where a complete part can be seen.
//
// NOTHING HERE IS A LIST SOMEONE MAINTAINS. forge::ui::buildEmptyState() asks
// the registry for the commands that emit feature IR and need no selection --
// which is exactly what "a legal first step in an empty document" means -- so
// adding a primitive puts it on this screen with no edit to this file. The
// samples are COMMAND SEQUENCES replayed through the same registry, so a sample
// cannot drift from what the commands actually emit; ui/test/shell_ux_test.cpp
// replays all four and compares the IR they produce against the recorded text.
//
// Every button DEFERS. It is drawn inside a docked panel, so it is inside the
// dock walk, and dispatching here would rebuild the document, the feature tree
// and the scene while the walk still holds references into them.
void ForgeFrame::drawEmptyState(float x, float y, float w, float h) {
  const forge::ui::EmptyState state =
      forge::ui::buildEmptyState(shell_.registry(), partDoc_.records().size());
  if (!state.documentEmpty || state.empty()) return;

  const float cardW = std::min(560.0f * dpiScale_, w - 32.0f * dpiScale_);
  const float cardH = std::min(400.0f * dpiScale_, h - 32.0f * dpiScale_);
  if (cardW < 160.0f || cardH < 120.0f) return;  // too small to be readable; say nothing
  ImGui::SetCursorScreenPos(ImVec2(x + (w - cardW) * 0.5f, y + (h - cardH) * 0.5f));
  ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18, 16));
  ImGui::PushStyleColor(ImGuiCol_ChildBg, rgb(28, 32, 38, 0.96f));
  ImGui::PushStyleColor(ImGuiCol_Border, rgb(64, 70, 80));
  if (ImGui::BeginChild("##empty_state", ImVec2(cardW, cardH), ImGuiChildFlags_Borders)) {
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8, 6));
    ImGui::TextColored(rgb(242, 158, 38), "%s", state.headline.c_str());
    ImGui::Spacing();
    ImGui::TextWrapped("%s", state.body.c_str());
    ImGui::Spacing();
    ImGui::Separator();

    ImGui::TextColored(rgb(130, 137, 148), "Start with a shape");
    // Wrapped by measured width, not by a hard-coded column count: the card is
    // sized from the viewport and a fixed grid overflows on a narrow one.
    float used = 0.0f;
    const float room = ImGui::GetContentRegionAvail().x;
    for (std::size_t i = 0; i < state.creators.size(); ++i) {
      const forge::ui::EmptyStateAction& action = state.creators[i];
      const float bw = ImGui::CalcTextSize(action.label.c_str()).x +
                       ImGui::GetStyle().FramePadding.x * 2.0f;
      if (i != 0 && used + bw < room) {
        ImGui::SameLine();
      } else if (i != 0) {
        used = 0.0f;
      }
      used += bw + ImGui::GetStyle().ItemSpacing.x;
      ImGui::PushID(static_cast<int>(i));
      if (ImGui::Button(action.label.c_str())) pendingInvokeId_ = action.commandId;
      if (ImGui::IsItemHovered()) {
        // The shortcut is worth showing; the command id is not.
        const std::string keys = shortcutText(action.commandId);
        if (keys.empty()) {
          ImGui::SetTooltip("%s", action.description.c_str());
        } else {
          ImGui::SetTooltip("%s\n%s", action.description.c_str(), keys.c_str());
        }
      }
      ImGui::PopID();
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored(rgb(130, 137, 148), "Or open a sample part");
    for (const std::string& id : state.sampleIds) {
      const forge::ui::SampleDocument* sample = forge::ui::findSample(id);
      if (sample == nullptr) continue;
      ImGui::PushID(id.c_str());
      if (ImGui::Button(sample->title.c_str())) {
        // app.load_sample takes the sample id as a parameter, and it HAS an
        // honest default ("bracket"), so a bare invoke would silently load the
        // wrong one. The override is the whole point of the button.
        promptCommand_ = "app.load_sample";
        promptFields_.clear();
        PromptField field;
        field.name = "sample";
        field.text = true;
        std::snprintf(field.value.data(), field.value.size(), "%s", id.c_str());
        promptFields_.push_back(std::move(field));
        pendingInvokeId_ = "app.load_sample";
      }
      ImGui::PopID();
      ImGui::SameLine();
      ImGui::TextDisabled("%s", sample->summary.c_str());
      if (ImGui::IsItemHovered() && !sample->teaches.empty()) {
        std::string teaches;
        for (std::size_t i = 0; i < sample->teaches.size(); ++i) {
          if (i != 0) teaches += "\n";
          teaches += "- " + sample->teaches[i];
        }
        ImGui::SetTooltip("%zu features\nshows:\n%s", sample->steps.size(), teaches.c_str());
      }
    }

    if (!state.nextSteps.empty()) {
      ImGui::Spacing();
      ImGui::Separator();
      ImGui::TextColored(rgb(130, 137, 148), "Then");
      for (const std::string& step : state.nextSteps) ImGui::TextWrapped("%s", step.c_str());
    }
    ImGui::PopStyleVar();
  }
  ImGui::EndChild();
  ImGui::PopStyleColor(2);
  ImGui::PopStyleVar(2);
}

void ForgeFrame::drawViewportOverlays(float x, float y, float w, float h) {
  ImDrawList* dl = ImGui::GetWindowDrawList();
  const ImU32 ink = ImGui::GetColorU32(rgb(226, 229, 234));
  const ImU32 dim = ImGui::GetColorU32(rgb(150, 157, 168));

  // 1. Orientation triad, bottom-left. Drawn from the LIVE camera basis, so it
  //    is a readout of the camera and not a decorative sprite.
  const float cx = x + 52.0f * dpiScale_;
  const float cy = y + h - 52.0f * dpiScale_;
  const float len = 34.0f * dpiScale_;
  float vp[16];
  camera_.viewProj(vp);
  const float axes[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
  const ImU32 axisCols[3] = {ImGui::GetColorU32(rgb(232, 92, 84)),
                             ImGui::GetColorU32(rgb(122, 196, 108)),
                             ImGui::GetColorU32(rgb(96, 156, 240))};
  const char* axisNames[3] = {"X", "Y", "Z"};
  float vm[16];
  camera_.view(vm);
  for (int a = 0; a < 3; ++a) {
    // View-space direction: the rotation part of the view matrix times the axis.
    const float sx = vm[0] * axes[a][0] + vm[4] * axes[a][1] + vm[8] * axes[a][2];
    const float sy = vm[1] * axes[a][0] + vm[5] * axes[a][1] + vm[9] * axes[a][2];
    const ImVec2 tip(cx + sx * len, cy - sy * len);
    dl->AddLine(ImVec2(cx, cy), tip, axisCols[a], 2.0f * dpiScale_);
    dl->AddText(ImVec2(tip.x - 4.0f, tip.y - 8.0f), axisCols[a], axisNames[a]);
  }
  dl->AddCircleFilled(ImVec2(cx, cy), 3.0f * dpiScale_, dim);

  // 2. Camera readout, top-left.
  char buf[192];
  std::snprintf(buf, sizeof(buf), "az %.1f  el %.1f  dist %.1f  |  %zu tris  %u faces",
                camera_.azimuth() * 57.2957795f, camera_.elevation() * 57.2957795f,
                camera_.distance(), scene_.triangleCount(), scene_.faceCount());
  dl->AddRectFilled(ImVec2(x + 8, y + 8),
                    ImVec2(x + 16 + ImGui::CalcTextSize(buf).x, y + 10 + ImGui::GetTextLineHeight()),
                    ImGui::GetColorU32(ImVec4(0, 0, 0, 0.45f)), 3.0f);
  dl->AddText(ImVec2(x + 12, y + 9), ink, buf);

  // 2b. The picked and hovered EDGES, drawn as projected polylines. A face
  //     highlight rides in the vertex stream (scene_.applySelection flags the
  //     vertices of picked faces); an edge has no face to flag, so it is drawn
  //     here, over the geometry, from the same camera the renderer uses.
  //     The guard is not decoration: deriving the edges walks the whole triangle
  //     soup, and calling edges() unconditionally would force that work on the
  //     first frame after every rebuild even for a user who never picks an edge.
  //     It is answered from the SELECTION, which costs nothing.
  bool anyEdgeInPlay = hoverEdge_ != forge::ui::kNoEdge;
  if (!anyEdgeInPlay) {
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      if (r.kind == forge::ui::EntityKind::Edge) {
        anyEdgeInPlay = true;
        break;
      }
    }
  }
  if (anyEdgeInPlay) {
    const forge::ui::EdgeSet& set = edges();
    const ImU32 selCol = ImGui::GetColorU32(rgb(242, 158, 38));
    const ImU32 hovCol = ImGui::GetColorU32(rgb(90, 184, 242));
    for (std::size_t idx : selectedEdgeIndices()) {
      drawEdgePolyline(set.edges[idx], x, y, w, h, selCol, 2.6f * dpiScale_);
    }
    if (hoverEdge_ != forge::ui::kNoEdge && hoverEdge_ < set.size()) {
      drawEdgePolyline(set.edges[hoverEdge_], x, y, w, h, hovCol, 1.8f * dpiScale_);
    }
  }

  // 3. Preselection HUD, following the cursor — the CAD convention that tells
  //    you what a click is about to pick BEFORE you commit to it.
  if (hoverEdge_ != forge::ui::kNoEdge && hoverEdge_ < edges_.size()) {
    const forge::ui::MeshEdge& e = edges_.edges[hoverEdge_];
    const ImVec2 m = ImGui::GetIO().MousePos;
    char hud[96];
    std::snprintf(hud, sizeof(hud), "Edge %u|%u  %.3f mm", e.faceA, e.faceB, e.length);
    const ImVec2 ts = ImGui::CalcTextSize(hud);
    dl->AddRectFilled(ImVec2(m.x + 14, m.y + 12), ImVec2(m.x + 22 + ts.x, m.y + 16 + ts.y),
                      ImGui::GetColorU32(ImVec4(0.14f, 0.34f, 0.46f, 0.9f)), 3.0f);
    dl->AddText(ImVec2(m.x + 18, m.y + 14), ink, hud);
  } else if (hoverFace_ != 0) {
    const ImVec2 m = ImGui::GetIO().MousePos;
    char hud[64];
    std::snprintf(hud, sizeof(hud), "Face %u", hoverFace_);
    const ImVec2 ts = ImGui::CalcTextSize(hud);
    dl->AddRectFilled(ImVec2(m.x + 14, m.y + 12), ImVec2(m.x + 22 + ts.x, m.y + 16 + ts.y),
                      ImGui::GetColorU32(ImVec4(0.14f, 0.34f, 0.46f, 0.9f)), 3.0f);
    dl->AddText(ImVec2(m.x + 18, m.y + 14), ink, hud);
  }

  // 4. Standard-view buttons, top-right — an overlay that takes input, over the
  //    geometry, which is the thing a second GL context cannot do cheaply.
  // These used to call `camera_.*fn` DIRECTLY through a member-function pointer
  // table of four entries. That bypassed the registry, so the standard views
  // were not journalled, could not be bound to a key, did not appear in the
  // palette or the menu, and three of the seven simply did not exist. They now
  // DISPATCH `view.<suffix>` like every other invoker, and the camera moves on
  // the pull path in applyPendingView() -- one route to the camera, not two.
  const float bw = 34.0f * dpiScale_;
  const float bh = 22.0f * dpiScale_;
  const int nViews = static_cast<int>(forge::ui::kNamedViewCount);
  ImGui::SetCursorScreenPos(
      ImVec2(x + w - (bw + 4) * static_cast<float>(nViews) - 8, y + 8));
  // Short labels, in the enum's own order so the row cannot fall out of step
  // with the commands behind it.
  static const char* kShort[] = {"Fr", "Bk", "Lf", "Rt", "Tp", "Bt", "Iso"};
  static_assert(sizeof(kShort) / sizeof(kShort[0]) == forge::ui::kNamedViewCount,
                "one short label per NamedView");
  for (int i = 0; i < nViews; ++i) {
    if (i > 0) ImGui::SameLine();
    const auto v = static_cast<forge::ui::NamedView>(i);
    if (ImGui::Button(kShort[i], ImVec2(bw, bh))) {
      // invoke(), the same path the ribbon and the menu bar use. The CAMERA
      // is not touched here: the command only bumps the shell's counter, and
      // applyPendingView() reads it at the TOP of the next build(), before the
      // walk begins. So this interaction cannot mutate anything the walk is
      // holding, which is the invariant the click gate asserts.
      invoke(std::string("view.") + forge::ui::commandSuffix(v));
    }
  }
  if (!scene_.built()) {
    // Over the user's model, in red, is the WORST place for a sentence written
    // for a compiler. The technical cause is in the Console panel; this says
    // what happened to the part.
    const std::string said = forge::ui::userFacingBuildFailure(scene_.error());
    dl->AddText(ImVec2(x + 14, y + h * 0.5f), ImGui::GetColorU32(rgb(235, 105, 95)),
                said.c_str());
  }
}

void ForgeFrame::drawContextMenu() {
  if (!ImGui::BeginPopupContextItem("##viewport_ctx", ImGuiPopupFlags_MouseButtonRight)) return;
  // ── BANDED, NOT FILTERED ──────────────────────────────────────────────────
  // This menu used to HIDE every command the live selection did not satisfy. A
  // command that vanishes teaches a user nothing: the question they actually
  // have is "why can I not fillet this?", and the answer -- "needs 1..n edge;
  // 2 face is picked" -- was exactly what was being suppressed.
  //
  // forge::ui::buildContextSurface() bands instead: available now, needs a
  // selection or a value, unavailable. Same registry and same predicate as the
  // menu bar and the ribbon, so the three cannot disagree.
  ImGui::TextDisabled("Selection: %s",
                      forge::ui::describeSelection(shell_.selection()).c_str());
  ImGui::Separator();
  for (const forge::ui::SurfaceGroup& group : contextSurface_.groups) {
    const bool live = (group.enabledCount() != 0);
    ImGui::TextColored(live ? rgb(130, 137, 148) : rgb(105, 110, 120), "%s", group.title.c_str());
    for (const forge::ui::SurfaceItem& item : group.items) {
      const bool clickable = item.enabled() || item.opensDialog();
      const std::string label = item.opensDialog() ? (item.label + "...") : item.label;
      if (ImGui::MenuItem(label.c_str(), item.shortcut.c_str(), false, clickable)) {
        invoke(item.commandId);
      }
      if (!clickable && ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
        ImGui::SetTooltip("%s", item.hint.c_str());
      }
    }
    ImGui::Separator();
  }
  ImGui::Separator();
  if (ImGui::MenuItem("Clear Selection")) {
    shell_.selection().clearSelection();
    syncSelectionToScene();
  }
  ImGui::EndPopup();
}

// ── feature tree ────────────────────────────────────────────────────────────
void ForgeFrame::drawFeatureTreePanel() {
  // THE PART, NOT THE CACHE. This line read
  //   "1 rows | resident 1/512 | peak 1 | fetch 3"
  // -- the row cache's occupancy, its capacity, its high-water mark and a fetch
  // counter, at the top of the panel a user opens to see their features. Those
  // four numbers are how the virtualisation is gated and they are still asserted
  // in ui/test/feature_tree_virtualization_test.cpp, which is where they belong.
  ImGui::TextColored(rgb(130, 137, 148), "%zu row%s", tree_.rowCount(),
                     tree_.rowCount() == 1 ? "" : "s");
  ImGui::Separator();

  const float rowH = ImGui::GetTextLineHeightWithSpacing();
  const ImVec2 avail = ImGui::GetContentRegionAvail();
  if (ImGui::BeginChild("##tree_rows", avail, ImGuiChildFlags_None)) {
    // VIRTUALIZATION, driven by the model's own window(). ImGuiListClipper gives
    // the visible range; FeatureTreeModel::window() materializes exactly that
    // range and nothing else, so a 100k-row tree costs a screenful of fetches.
    ImGuiListClipper clipper;
    clipper.Begin(static_cast<int>(tree_.rowCount()), rowH);
    while (clipper.Step()) {
      const std::size_t first = static_cast<std::size_t>(clipper.DisplayStart);
      const std::size_t count =
          static_cast<std::size_t>(clipper.DisplayEnd - clipper.DisplayStart);
      if (count == 0) continue;
      const std::vector<forge::ui::FeatureNodeData> rows = tree_.window(first, count);
      for (std::size_t i = 0; i < rows.size(); ++i) {
        const std::size_t rowIndex = first + i;
        const forge::ui::Row& row = tree_.rowAt(rowIndex);
        const forge::ui::FeatureNodeData& d = rows[i];
        ++treeRowsDrawn_;

        ImGui::PushID(static_cast<int>(rowIndex));
        ImGui::Indent(static_cast<float>(row.depth) * 14.0f * dpiScale_);
        if (row.hasChildren) {
          const bool expanderClicked = ImGui::SmallButton(row.expanded ? "-" : "+");
          if (!treeExpanderRect_.valid) {
            const ImVec2 mn = ImGui::GetItemRectMin(), mx = ImGui::GetItemRectMax();
            treeExpanderRect_ = {mn.x, mn.y, mx.x, mx.y, true};
          }
          if (expanderClicked) {
            // RECORD, do not rebuild: the clipper is iterating a range sized from the
            // rowCount taken at Begin(), and rebuild() changes rows_.size() underneath it.
            // The next rowAt() then threw std::out_of_range and aborted the process.
            pendingExpandValid_ = true;
            pendingExpandId_ = row.id;
            pendingExpandState_ = !row.expanded;
          }
          ImGui::SameLine();
        } else {
          ImGui::Dummy(ImVec2(16.0f * dpiScale_, 1));
          ImGui::SameLine();
        }

        const std::uint32_t faceId = treeSource_.faceIdOf(d.id);
        bool selected = false;
        if (faceId != 0) {
          for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
            if (r.persistentName == "face@" + std::to_string(faceId)) selected = true;
          }
        }
        const int featureIrId = treeSource_.featureIrIdOf(d.id);
        if (faceId == 0 && featureIrId != 0 && featureIrId == editFeatureId_) selected = true;
        // A feature row now carries a real SELECTION, so it has to draw as
        // selected when it is one -- a row that is picked and looks unpicked is
        // how a user comes to believe a command refused for no reason.
        if (faceId == 0 && featureIrId != 0) {
          for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
            if (r.persistentName == "feature@" + std::to_string(featureIrId)) selected = true;
          }
        }
        if (ImGui::Selectable(d.label.c_str(), selected, ImGuiSelectableFlags_AllowOverlap)) {
          if (faceId != 0) {
            clickFace(faceId, ImGui::GetIO().KeyShift);
          } else if (featureIrId != 0) {
            // AND it becomes the typed SELECTION. This is the click that makes
            // Extrude, the booleans, the patterns, loft, thicken and the sketch
            // family reachable at all -- see clickFeature().
            clickFeature(featureIrId, ImGui::GetIO().KeyShift);
            // Clicking a FEATURE row used to do nothing at all. It is the row a
            // user reaches for to change that feature's numbers, so it is what
            // aims the parameter editor.
            setEditTarget(featureIrId, 0);
          }
        }
        if (ImGui::IsItemHovered() && faceId != 0) setPreselectedFace(faceId);
        // A feature row IS an IR statement, so hovering it shows the statement --
        // reachable only because the source hands back the document's own record.
        if (ImGui::IsItemHovered()) {
          if (const forge::ui::FeatureRecord* rec = treeSource_.recordAt(d.id)) {
            // The row's own LABEL and how it got here. It used to show the raw
            // feature-IR statement ("%3 EXTRUDE %1 10.000") and the command id
            // underneath it.
            const forge::ui::CommandDescriptor* by =
                rec->commandId.empty() ? nullptr : shell_.registry().find(rec->commandId);
            const std::string origin = (by != nullptr && !by->label.empty())
                                           ? ("added by " + by->label)
                                           : std::string("part of the starting part");
            ImGui::SetTooltip("%s\n%s", d.label.c_str(), origin.c_str());
          }
        }

        // Per-node STATUS badge — the thing that makes a feature tree a
        // diagnostic instead of a list.
        ImGui::SameLine(ImGui::GetContentRegionAvail().x - 54.0f * dpiScale_);
        ImGui::TextColored(featureStateColor(d.state), "%s", featureStateLabel(d.state));
        ImGui::Unindent(static_cast<float>(row.depth) * 14.0f * dpiScale_);
        ImGui::PopID();
      }
    }
    clipper.End();
  }
  ImGui::EndChild();
}

// ── the model browser ───────────────────────────────────────────────────────
//
// WHAT EXISTS NOW, as against the feature tree's WHAT WAS DONE. The rows are
// forge::ui::buildModelBrowser's, read off the live PartDocument -- including
// its binding table, which is the document's own answer to "can a user still
// pick this" -- and the numbers under a body are forge::ui::MeasureModel's, over
// the same triangles the viewport draws and the same face ids picking resolves
// to. Nothing in this function computes a geometric quantity of its own.
forge::ui::ModelBrowser ForgeFrame::modelBrowser() const {
  return forge::ui::buildModelBrowser(partDoc_);
}

forge::ui::SketchTree ForgeFrame::sketchTree() const {
  return forge::ui::buildSketchTree(partDoc_);
}

const forge::ui::FaceMeasure& ForgeFrame::faceMeasure(std::uint32_t faceId) {
  const forge::ui::MeasureMesh& mesh = measureMesh();
  if (!faceCacheBuilt_ || faceCacheBuilds_ != measureBuilds_) {
    faceCache_.clear();
    faceCached_.clear();
    faceCacheBuilds_ = measureBuilds_;
    faceCacheBuilt_ = true;
  }
  const std::size_t slot = static_cast<std::size_t>(faceId);
  if (faceCache_.size() <= slot) {
    faceCache_.resize(slot + 1);
    faceCached_.resize(slot + 1, 0);
  }
  if (faceCached_[slot] == 0) {
    forge::ui::measureFace(mesh, faceId, faceCache_[slot]);
    faceCache_[slot].faceId = faceId;
    faceCached_[slot] = 1;
  }
  return faceCache_[slot];
}

namespace {

// The word a person uses for one of the IR's value kinds. forge::ui's own
// toString() spells them for the vocabulary ("sketchref"), which is the right
// spelling for a manifest and the wrong one for a panel.
const char* valueKindWord(forge::ui::IrValueKind kind) {
  switch (kind) {
    case forge::ui::IrValueKind::Solid:     return "solid";
    case forge::ui::IrValueKind::Surface:   return "surface";
    case forge::ui::IrValueKind::Wire:      return "curve";
    case forge::ui::IrValueKind::Profile:   return "profile";
    case forge::ui::IrValueKind::Sketch:    return "sketch";
    case forge::ui::IrValueKind::SketchRef: return "sketch entity";
    case forge::ui::IrValueKind::None:      return "value";
  }
  return "value";
}

}  // namespace

void ForgeFrame::drawModelBrowserPanel() {
  modelRowsDrawn_ = 0;
  modelFaceRowsDrawn_ = 0;
  const forge::ui::ModelBrowser browser = modelBrowser();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();

  // EMPTY IS A STATE, NOT A GAP. A document with no statements has nothing to
  // browse, and the useful thing to say is what would put something here.
  if (browser.values.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("There is nothing in this document yet. Draw a shape from the toolbar, "
                       "or open a part, and every body, sketch and face it contains is listed "
                       "here.");
    ImGui::PopTextWrapPos();
    return;
  }

  ImGui::TextColored(rgb(130, 137, 148), "%zu bodies | %zu sketches | %zu profiles | %zu absorbed",
                     browser.bodies.size(), browser.sketches.size(), browser.profiles.size(),
                     browser.consumed.size());

  // One row for one value. Clicking it puts the value in the selection through
  // the SAME clickFeature() a feature-tree row uses, so a body picked here
  // satisfies a boolean's signature exactly as one picked in the history does --
  // this panel is a way to work, not a read-out.
  auto valueRow = [this](const forge::ui::ModelValue& v, const char* trailing) {
    ++modelRowsDrawn_;
    ImGui::PushID(v.irId);
    bool selected = false;
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      if (r.persistentName == "feature@" + std::to_string(v.irId)) selected = true;
    }
    if (v.irId == editFeatureId_) selected = true;
    if (ImGui::Selectable(v.label.c_str(), selected, ImGuiSelectableFlags_AllowOverlap)) {
      clickFeature(v.irId, ImGui::GetIO().KeyShift);
      setEditTarget(v.irId, 0);
    }
    if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", v.statement.c_str());
    if (trailing != nullptr && trailing[0] != 0) {
      ImGui::SameLine();
      ImGui::TextColored(rgb(130, 137, 148), "%s", trailing);
    }
    ImGui::PopID();
  };

  const forge::ui::MeshMeasure& m = modelMeasure();
  // The measured numbers describe EVERYTHING the program built, because the
  // kernel tessellates the finished program and not one value of it. They are
  // therefore printed under a body only when there is exactly one body to
  // attribute them to -- a second body would make "volume 71 234" a number about
  // something else, which is the failure mode this whole exercise is against.
  const bool oneBody = browser.bodies.size() == 1;

  // ── AND THE SECOND WAY THOSE NUMBERS COULD LIE ────────────────────────────
  // A failed rebuild leaves the LAST GOOD body on screen, which is what every
  // history-based modeller does and is the right behaviour. But the statements
  // listed above are the CURRENT document's, so without this the panel would
  // show a body the history no longer describes, measured, to three decimal
  // places, with nothing saying so.
  const bool stale = !scene_.lastBuild().ok();
  if (stale) {
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 175, 95), "%s", why.c_str());
    ImGui::PopTextWrapPos();
  }

  if (ImGui::TreeNodeEx("##bodies", ImGuiTreeNodeFlags_DefaultOpen, "Bodies (%zu)",
                        browser.bodies.size())) {
    if (browser.bodies.empty()) {
      ImGui::TextDisabled("No finished solid yet. Extrude or revolve a profile to make one.");
    }
    for (std::size_t i : browser.bodies) {
      const forge::ui::ModelValue& v = browser.values[i];
      valueRow(v, v.annotations > 0 ? "named" : "");
      ImGui::Indent();
      if (oneBody && m.triangles > 0) {
        if (stale) ImGui::TextDisabled("measured on the last part that built:");
        if (m.watertight) {
          ImGui::Text("volume    %.3f mm3", m.volume);
        } else {
          // A volume off an open surface is a number with no meaning, and
          // printing one anyway is exactly how a wrong solid passes unnoticed.
          ImGui::TextColored(rgb(235, 175, 95), "volume    not closed: %zu open edges",
                             m.boundaryEdges);
        }
        ImGui::Text("area      %.3f mm2", m.area);
        ImGui::Text("size      %.3f x %.3f x %.3f mm", m.box.size(0), m.box.size(1),
                    m.box.size(2));
        ImGui::Text("centre    %.3f  %.3f  %.3f", m.centroid[0], m.centroid[1], m.centroid[2]);
      }
      if (!v.operands.empty()) {
        std::string built;
        for (int op : v.operands) {
          const forge::ui::ModelValue* from = browser.find(op);
          if (from == nullptr) continue;
          if (!built.empty()) built += ", ";
          built += from->label;
        }
        if (!built.empty()) ImGui::TextColored(rgb(130, 137, 148), "built from %s", built.c_str());
      }
      ImGui::Unindent();
    }
    ImGui::TreePop();
  }

  // ── the faces ─────────────────────────────────────────────────────────────
  // The B-rep faces of what was built, each measured by forge::ui::measureFace
  // over the tessellation. Clicking one selects it, exactly as clicking it in
  // the 3D view does, which is what makes this a way to reach a face that is
  // hidden behind the part.
  const std::uint32_t faces = scene_.faceCount();
  if (faces > 0) {
    const bool open =
        stale ? ImGui::TreeNodeEx("##faces", ImGuiTreeNodeFlags_DefaultOpen,
                                  "Faces of the last part that built (%u)", faces)
              : ImGui::TreeNodeEx("##faces", ImGuiTreeNodeFlags_DefaultOpen, "Faces (%u)", faces);
    if (open) {
      if (!oneBody && browser.bodies.size() > 1) {
        ImGui::TextDisabled("These faces cover everything this document builds.");
      }
      const std::vector<std::uint32_t> picked = selectedFaceIds();
      const float rowH = ImGui::GetTextLineHeightWithSpacing();
      const float height = std::min(rowH * 12.0f, rowH * static_cast<float>(faces) + 4.0f);
      if (ImGui::BeginChild("##facelist", ImVec2(0, height), ImGuiChildFlags_None)) {
        // VIRTUALIZED for the same reason the feature tree is: an imported part
        // has thousands of faces, and measuring the ones nobody can see is work
        // done for nothing.
        ImGuiListClipper clipper;
        clipper.Begin(static_cast<int>(faces), rowH);
        while (clipper.Step()) {
          for (int row = clipper.DisplayStart; row < clipper.DisplayEnd; ++row) {
            const std::uint32_t faceId = static_cast<std::uint32_t>(row) + 1;
            const forge::ui::FaceMeasure& f = faceMeasure(faceId);
            ++modelFaceRowsDrawn_;
            ImGui::PushID(static_cast<int>(faceId));
            bool on = false;
            for (std::uint32_t p : picked) {
              if (p == faceId) on = true;
            }
            char label[64];
            std::snprintf(label, sizeof(label), "Face %u", faceId);
            if (ImGui::Selectable(label, on, ImGuiSelectableFlags_AllowOverlap)) {
              clickFace(faceId, ImGui::GetIO().KeyShift);
            }
            if (ImGui::IsItemHovered()) setPreselectedFace(faceId);
            ImGui::SameLine(120.0f * dpiScale_);
            // A FACE WITH NO TRIANGLES IS NOT A FACE WITH NO AREA. The kernel
            // defers a face it cannot mesh (the viewport says so: "1 face of 63
            // DEFERRED"), and the measurement of one is a zero -- which read as
            // "flat, 0.000 mm2" is two false statements about a real face.
            if (f.triangles == 0) {
              ImGui::TextColored(rgb(235, 175, 95), "this face could not be measured");
            } else {
              ImGui::TextColored(rgb(130, 137, 148), "%-6s %10.3f mm2  %zu triangles",
                                 f.planar ? "flat" : "curved", f.area, f.triangles);
            }
            ImGui::PopID();
          }
        }
        clipper.End();
      }
      ImGui::EndChild();
      ImGui::TreePop();
    }
  } else {
    // No triangles at all: the part did not build, and the reason belongs here
    // rather than in a console the user never opens.
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("%s", why.empty() ? "No faces have been built yet." : why.c_str());
    ImGui::PopTextWrapPos();
  }

  if (!browser.sketches.empty() || !browser.profiles.empty()) {
    if (ImGui::TreeNodeEx("##drawn", ImGuiTreeNodeFlags_DefaultOpen, "Sketches and profiles (%zu)",
                          browser.sketches.size() + browser.profiles.size())) {
      for (std::size_t i : browser.profiles) valueRow(browser.values[i], "ready to use");
      for (std::size_t i : browser.sketches) {
        valueRow(browser.values[i], valueKindWord(browser.values[i].kind));
      }
      ImGui::TreePop();
    }
  }
  if (!browser.wires.empty() || !browser.sheets.empty()) {
    if (ImGui::TreeNodeEx("##surfaces", ImGuiTreeNodeFlags_DefaultOpen, "Surfaces and curves (%zu)",
                          browser.wires.size() + browser.sheets.size())) {
      for (std::size_t i : browser.sheets) valueRow(browser.values[i], "surface");
      for (std::size_t i : browser.wires) valueRow(browser.values[i], "curve");
      ImGui::TreePop();
    }
  }

  // ABSORBED, not deleted. A boolean takes both its operands and the document
  // stops binding them; they are still in the history and a user who cannot see
  // where their plate went has lost it as far as they know.
  if (!browser.consumed.empty()) {
    if (ImGui::TreeNodeEx("##absorbed", 0, "Absorbed into later features (%zu)",
                          browser.consumed.size())) {
      for (std::size_t i : browser.consumed) {
        const forge::ui::ModelValue& v = browser.values[i];
        ++modelRowsDrawn_;
        ImGui::BulletText("%s  used by  %s", v.label.c_str(), v.consumedByLabel.c_str());
      }
      ImGui::TreePop();
    }
  }
  if (!browser.unnamed.empty()) {
    if (ImGui::TreeNodeEx("##unnamed", 0, "Built but not selectable (%zu)",
                          browser.unnamed.size())) {
      for (std::size_t i : browser.unnamed) {
        const forge::ui::ModelValue& v = browser.values[i];
        ++modelRowsDrawn_;
        ImGui::BulletText("%s  (%s)", v.label.c_str(), valueKindWord(v.kind));
      }
      ImGui::TreePop();
    }
  }
}

// ── the sketch tree ─────────────────────────────────────────────────────────
//
// WHAT WAS DRAWN. Two kinds of thing live here and they are genuinely different:
// a SKETCH is a set of entities held together by constraints and solved into a
// profile, while RECT / CIRCLE / SLOT / REGPOLY bake their shape as numbers.
// Both are the document's own statements; the dimensions under a baked profile
// are the arguments the statement carries, labelled with the kernel's own names
// for them (see ModelTree.hpp).
void ForgeFrame::drawSketchTreePanel() {
  sketchRowsDrawn_ = 0;
  const forge::ui::SketchTree tree = sketchTree();

  ImGui::TextColored(rgb(242, 158, 38), "Sketches and profiles");
  ImGui::Separator();

  if (tree.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("Nothing has been drawn in this document yet. Start a sketch, or place a "
                       "rectangle, circle or slot, and its entities and dimensions appear here.");
    ImGui::PopTextWrapPos();
    return;
  }

  ImGui::TextColored(rgb(130, 137, 148), "%zu sketches | %zu profiles", tree.sketches.size(),
                     tree.profiles.size());

  auto selectRow = [this](int irId, const char* label, const char* statement) {
    ImGui::PushID(irId);
    bool selected = false;
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      if (r.persistentName == "feature@" + std::to_string(irId)) selected = true;
    }
    const bool clicked = ImGui::Selectable(label, selected, ImGuiSelectableFlags_AllowOverlap);
    if (clicked) {
      clickFeature(irId, ImGui::GetIO().KeyShift);
      setEditTarget(irId, 0);
    }
    if (statement != nullptr && ImGui::IsItemHovered()) ImGui::SetTooltip("%s", statement);
    ImGui::PopID();
    return clicked;
  };

  for (const forge::ui::SketchGroup& g : tree.sketches) {
    ++sketchRowsDrawn_;
    ImGui::PushID(g.irId);
    const bool open = ImGui::TreeNodeEx("##sketch", ImGuiTreeNodeFlags_DefaultOpen, "%s",
                                        g.label.c_str());
    ImGui::SameLine();
    if (g.solvedBy != 0) {
      ImGui::TextColored(rgb(120, 200, 130), "solved");
    } else {
      ImGui::TextColored(rgb(235, 175, 95), "not solved yet");
    }
    if (open) {
      // The plane is the keyword the SKETCH statement carries. When it carries
      // none the clause is left out rather than filled with a guess: "on the XY
      // plane" is a fact about the document, and inventing one would be the
      // whole defect this panel exists to undo, in miniature.
      if (g.plane.empty()) {
        ImGui::TextColored(rgb(130, 137, 148), "%zu points | %zu curves | %zu constraints",
                           g.points, g.curves, g.constraints);
      } else {
        ImGui::TextColored(rgb(130, 137, 148),
                           "on the %s plane | %zu points | %zu curves | %zu constraints",
                           g.plane.c_str(), g.points, g.curves, g.constraints);
      }
      if (g.consumedBy != 0) {
        ImGui::TextColored(rgb(130, 137, 148), "used by %s", g.consumedByLabel.c_str());
      } else if (g.solvedBy != 0) {
        ImGui::TextColored(rgb(130, 137, 148), "ready to extrude or revolve");
      } else {
        ImGui::TextDisabled("Solve this sketch to turn it into a profile.");
      }
      for (const forge::ui::SketchEntity& e : g.entities) {
        ++sketchRowsDrawn_;
        ImGui::Indent();
        selectRow(e.irId, e.label.c_str(), nullptr);
        if (!e.operands.empty()) {
          ImGui::SameLine(150.0f * dpiScale_);
          ImGui::TextColored(rgb(130, 137, 148), "%s", e.operands.c_str());
        }
        ImGui::Unindent();
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }

  for (const forge::ui::ProfileShape& p : tree.profiles) {
    ++sketchRowsDrawn_;
    ImGui::PushID(p.irId);
    const bool open = ImGui::TreeNodeEx("##profile", ImGuiTreeNodeFlags_DefaultOpen, "%s",
                                        p.label.c_str());
    ImGui::SameLine();
    ImGui::TextColored(rgb(130, 137, 148), "%s", p.op.c_str());
    if (open) {
      if (p.dimensions.empty() && p.points > 0) {
        ImGui::Text("%zu points", p.points);
      }
      for (const forge::ui::ProfileDimension& d : p.dimensions) {
        ++sketchRowsDrawn_;
        const char* unit = "mm";
        if (d.unit == forge::ui::DimensionUnit::Angle) unit = "deg";
        if (d.unit == forge::ui::DimensionUnit::Count) unit = "";
        ImGui::Indent();
        ImGui::Text("%-10s %10.3f %s", d.display.c_str(), d.value, unit);
        if (d.defaulted) {
          ImGui::SameLine();
          // A number the USER chose and a number the kernel supplied are
          // different facts, and a panel that shows both the same way invites an
          // edit to a value that was never there.
          ImGui::TextDisabled("(not set; this is the standard value)");
        }
        ImGui::Unindent();
      }
      if (p.consumedBy != 0) {
        ImGui::TextColored(rgb(130, 137, 148), "used by %s", p.consumedByLabel.c_str());
      } else {
        ImGui::TextColored(rgb(130, 137, 148), "ready to extrude or revolve");
      }
      // The profile itself is selectable, which is what makes Extrude reachable
      // from this panel rather than only from the history.
      selectRow(p.irId, "Select this profile", nullptr);
      ImGui::TreePop();
    }
    ImGui::PopID();
  }

  if (!tree.unattached.empty()) {
    ImGui::Separator();
    ImGui::TextColored(rgb(235, 175, 95), "%zu drawn items are not part of any sketch",
                       tree.unattached.size());
    for (const forge::ui::SketchEntity& e : tree.unattached) {
      ++sketchRowsDrawn_;
      ImGui::BulletText("%s  %s", e.label.c_str(), e.operands.c_str());
    }
  }
}

// ── THE ASSEMBLY, THE OPERATIONS, THE SHEETS AND THE STUDIES ────────────────
//
// Four docked tabs that drew NOTHING. The reasoning written into the catalogue
// beside them was that "nothing in this application holds an assembly, a
// machining setup, a simulation study or a drawing sheet", and the wrong half of
// that is load-bearing: there is no SECOND document holding those things, and
// there does not need to be, because all four are readings of the part document
// that already exists. See forge/ui/WorkspaceTrees.hpp for what each one reads
// and why it is honest.
//
// Every number below comes from forge::ui::WorkspaceTrees and is asserted by
// ui/test/workspace_trees_test.cpp. This file lays them out and nothing else --
// which is the rule InspectionReport.hpp states, and the reason it exists: the
// frame builder is the one file CI compiles and never RUNS, so a number invented
// here is a number nothing can contradict.

forge::ui::AssemblyTree ForgeFrame::assemblyTree() const {
  return forge::ui::buildAssemblyTree(partDoc_);
}

forge::ui::MachiningPlan ForgeFrame::machiningPlan() const {
  return forge::ui::buildMachiningPlan(partDoc_);
}

forge::ui::DrawingSheetSet ForgeFrame::drawingSheets() {
  return forge::ui::buildDrawingSheets(modelMeasure().box);
}

forge::ui::StudyPlan ForgeFrame::studyPlan() {
  const forge::ui::MeshMeasure& m = modelMeasure();
  const IrBuildReport& r = scene_.lastBuild();
  // The kernel's exact volume when it has one, and 0 when it does not -- the
  // study says which instrument answered, because a number whose source is
  // unstated is a number nobody can check.
  const double exact = r.ok() && r.volume > 0.0 ? r.volume : 0.0;
  // The document carries no material choice yet, and that is a real state rather
  // than a gap: the Weight study names it as the one input it is waiting for and
  // says how much of an answer it is holding up.
  //
  // The LIVE selection goes in too, because the two inputs the stress study is
  // missing are both faces: what the user has picked is what they would hold or
  // load the part by, and a setup row that cannot see the selection can only ever
  // print the same sentence.
  return forge::ui::buildStudyPlan(m, exact, forge::ui::unassignedMaterial(),
                                   forge::ui::MassUnit::Gram, selectionMeasure());
}

// ── the assembly ────────────────────────────────────────────────────────────
//
// WHAT IS PLACED WHERE. Every body the program builds, nested under the body
// that absorbed it, and under each one the statements that place counted copies
// of it. Clicking a row selects that body through the SAME clickFeature() a
// feature-tree row uses, so a component picked here satisfies a boolean's
// signature exactly as one picked in the history does.
void ForgeFrame::drawAssemblyTreePanel() {
  assemblyRowsDrawn_ = 0;
  const forge::ui::AssemblyTree tree = assemblyTree();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();

  if (tree.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("There are no components in this document yet. Draw a shape from the "
                       "toolbar, or open a part, and every body it contains is listed here with "
                       "what went into it.");
    ImGui::PopTextWrapPos();
    return;
  }

  ImGui::TextColored(rgb(130, 137, 148), "%zu components | %zu you can still pick | %zu placed "
                                         "copies",
                     tree.components.size(), tree.liveComponents, tree.placedCopies);

  // A failed rebuild leaves the LAST GOOD body on screen while these rows come
  // from the CURRENT document, so the two can describe different things. Say so
  // here rather than in a console the user never opens.
  if (!scene_.lastBuild().ok()) {
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 175, 95), "%s", why.c_str());
    ImGui::PopTextWrapPos();
  }

  // The nesting, drawn from the depth the model computed. Indent and Unindent
  // are matched by tracking the depth of the PREVIOUS row, so a tree of any
  // shape closes exactly as many levels as it opened.
  std::size_t open = 0;
  for (const forge::ui::AssemblyComponent& c : tree.components) {
    while (open < c.depth) { ImGui::Indent(); ++open; }
    while (open > c.depth) { ImGui::Unindent(); --open; }

    ++assemblyRowsDrawn_;
    ImGui::PushID(c.irId);
    bool selected = false;
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      if (r.persistentName == "feature@" + std::to_string(c.irId)) selected = true;
    }
    if (c.irId == editFeatureId_) selected = true;
    if (ImGui::Selectable(c.label.c_str(), selected, ImGuiSelectableFlags_AllowOverlap)) {
      clickFeature(c.irId, ImGui::GetIO().KeyShift);
      setEditTarget(c.irId, 0);
    }
    if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", c.statement.c_str());
    ImGui::SameLine();
    // ABSORBED IS NOT DELETED. A boolean takes both its operands and the document
    // stops binding them; they are still part of what this body is made of, and a
    // user who cannot see where their plate went has lost it as far as they know.
    //
    // WHICH of the two things "not selectable" means is decided by the DEPTH, not
    // guessed: a nested row really does have its parent drawn immediately above
    // it, and a top-level one has nothing above it to have been built into.
    if (c.live) {
      ImGui::TextColored(rgb(130, 137, 148), "%s", valueKindWord(c.kind));
    } else if (c.depth > 0) {
      ImGui::TextColored(rgb(130, 137, 148), "%s, built into the one above",
                         valueKindWord(c.kind));
    } else {
      ImGui::TextColored(rgb(130, 137, 148), "%s, with no name to pick it by yet",
                         valueKindWord(c.kind));
    }
    // The placements that copy THIS component, with the statement's own count and
    // spacing in them.
    for (std::size_t p : c.placements) {
      const forge::ui::AssemblyPlacement& pl = tree.placements[p];
      ++assemblyRowsDrawn_;
      ImGui::Indent();
      if (pl.countKnown) {
        ImGui::BulletText("%s", pl.describe.c_str());
        if (ImGui::IsItemHovered()) {
          ImGui::SetTooltip("%s, from %s", forge::ui::placementWord(pl.kind),
                            pl.sourceLabel.c_str());
        }
      } else {
        // A count that is not a whole number is not a count. The statement plainly
        // makes copies, so the row still draws and refuses the number instead.
        ImGui::Bullet();
        ImGui::TextColored(rgb(235, 175, 95), "%s, and how many is not a whole number",
                           pl.describe.c_str());
      }
      ImGui::Unindent();
    }
    ImGui::PopID();
  }
  while (open > 0) { ImGui::Unindent(); --open; }
}

// ── the machining operations ────────────────────────────────────────────────
//
// WHAT MUST BE TAKEN AWAY, in the order the model takes it. Every row is a
// statement of this document that removes material, with the diameter, depth,
// radius or wall the statement itself carries. Read from the model, not from a
// posted toolpath: this says what the part NEEDS cut, and the numbers are the
// ones a shop asks for first.
void ForgeFrame::drawOperationTreePanel() {
  operationRowsDrawn_ = 0;
  const forge::ui::MachiningPlan plan = machiningPlan();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();

  if (plan.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    if (plan.shapingStatements == 0) {
      ImGui::TextWrapped("There is nothing to cut yet. Draw a shape from the toolbar, or open a "
                         "part, and every hole, pocket and edge it needs is listed here in the "
                         "order the model takes it away.");
    } else {
      ImGui::TextWrapped("Nothing is cut away in this part: all %zu of its steps add or shape "
                         "material. Drill a hole, cut a shape away or round an edge and it "
                         "appears here.",
                         plan.shapingStatements);
    }
    ImGui::PopTextWrapPos();
    return;
  }

  ImGui::TextColored(rgb(130, 137, 148), "%zu operations | %zu holes | %zu cut away | %zu edges",
                     plan.operations.size(), plan.holes, plan.cutouts, plan.edgeOperations);
  if (plan.smallestToolKnown) {
    // The tool that limits the job. A shop reads this line first: it decides
    // whether the part can be cut at all on the machine they have.
    ImGui::Text("smallest tool  %.3f mm across", plan.smallestToolMm);
  }
  ImGui::TextDisabled("read from the model, in the order it takes the material away");
  ImGui::Spacing();

  for (const forge::ui::MachiningOperation& o : plan.operations) {
    ++operationRowsDrawn_;
    ImGui::PushID(o.irId);
    bool selected = false;
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      if (r.persistentName == "feature@" + std::to_string(o.irId)) selected = true;
    }
    if (o.irId == editFeatureId_) selected = true;
    char head[160];
    std::snprintf(head, sizeof(head), "%zu.  %s", o.order, o.action.c_str());
    if (ImGui::Selectable(head, selected, ImGuiSelectableFlags_AllowOverlap)) {
      // The same selection every other panel makes, so picking an operation here
      // puts its feature in the selection and the Operation Settings tab beside
      // it shows that feature's numbers.
      clickFeature(o.irId, ImGui::GetIO().KeyShift);
      setEditTarget(o.irId, 0);
    }
    if (ImGui::IsItemHovered()) {
      ImGui::SetTooltip("%s  (%s)", o.label.c_str(), forge::ui::machiningWord(o.kind));
    }
    ImGui::Indent();
    ImGui::TextColored(rgb(130, 137, 148), "%s", o.evidence.c_str());
    if (o.toolDiameterMm > 0.0) {
      ImGui::TextColored(rgb(130, 137, 148), "needs a tool %.3f mm across", o.toolDiameterMm);
    }
    ImGui::Unindent();
    ImGui::PopID();
  }
}

// ── the drawing sheets ──────────────────────────────────────────────────────
//
// WHAT IT TAKES TO DRAW THIS PART. The sheet and the scale are worked out from
// the part's own measured size against two standards -- the A-series sheet sizes
// and the preferred series of scales -- so the answer changes when the part
// does. Clicking a view turns the 3D view to that direction through the SAME
// `view.` command the corner buttons and the menu use.
void ForgeFrame::drawSheetTreePanel() {
  sheetRowsDrawn_ = 0;
  const forge::ui::DrawingSheetSet set = drawingSheets();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();

  if (!set.known) {
    ImGui::PushTextWrapPos(0.0f);
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty()
                                 ? "There is nothing to draw yet. Draw a shape from the toolbar, "
                                   "or open a part, and the sheet it needs and the views on it "
                                   "are listed here."
                                 : why.c_str());
    ImGui::PopTextWrapPos();
    return;
  }

  for (const forge::ui::DrawingSheet& s : set.sheets) {
    ++sheetRowsDrawn_;
    ImGui::PushID(s.name.c_str());
    if (ImGui::TreeNodeEx("##sheet", ImGuiTreeNodeFlags_DefaultOpen, "%s   %s at %s",
                          s.name.c_str(), s.size.name.c_str(), s.scaleLabelText.c_str())) {
      ImGui::Text("sheet     %.0f x %.0f mm, %.0f mm border", s.size.widthMm, s.size.heightMm,
                  s.marginMm);
      ImGui::Text("views     %.1f x %.1f mm of the %.1f x %.1f mm inside the border",
                  s.usedWidthMm, s.usedHeightMm, s.drawableWidthMm, s.drawableHeightMm);
      if (!s.fits) {
        // Bigger than the largest sheet at the smallest standard reduction. Said
        // plainly, at the sheet that comes closest, rather than by inventing a
        // scale nobody draws at.
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextColored(rgb(235, 175, 95),
                           "This part is too big for the largest sheet at any standard scale.");
        ImGui::PopTextWrapPos();
      }
      ImGui::Spacing();
      ImGui::TextDisabled("each view, and how big it prints at this scale");
      for (const forge::ui::SheetView& v : s.views) {
        ++sheetRowsDrawn_;
        ImGui::PushID(static_cast<int>(v.view));
        char row[128];
        std::snprintf(row, sizeof(row), "%-10s %8.1f x %6.1f mm", v.name.c_str(), v.paperWidthMm,
                      v.paperHeightMm);
        if (ImGui::Selectable(row, false)) {
          // invoke(), the one route to the camera: the command bumps the shell's
          // counter and applyPendingView() moves the camera at the top of the
          // next frame, so this cannot mutate anything the walk is holding.
          invoke(std::string("view.") + forge::ui::commandSuffix(v.view));
        }
        if (ImGui::IsItemHovered()) {
          ImGui::SetTooltip("%s view: %.1f x %.1f mm full size. Click to turn the 3D view here.",
                            v.name.c_str(), v.widthMm, v.heightMm);
        }
        ImGui::PopID();
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }
}

// ── the simulation studies ──────────────────────────────────────────────────
//
// WHAT CAN BE SOLVED, AND WHAT IS STILL MISSING. One of these needs nothing but
// the shape and is therefore ANSWERED, with real numbers; the other two name the
// exact input the document does not carry yet. A study tree that listed three
// promises would be worth nothing; one that says which single thing is holding
// each answer up is what a user can act on.
void ForgeFrame::drawStudyTreePanel() {
  studyRowsDrawn_ = 0;
  const forge::ui::StudyPlan plan = studyPlan();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();
  ImGui::TextColored(rgb(130, 137, 148), "%zu studies | %zu answered now", plan.studies.size(),
                     plan.answered());

  for (std::size_t i = 0; i < plan.studies.size(); ++i) {
    const forge::ui::Study& st = plan.studies[i];
    ++studyRowsDrawn_;
    ImGui::PushID(static_cast<int>(i));
    if (ImGui::TreeNodeEx("##study", ImGuiTreeNodeFlags_DefaultOpen, "%s   %s", st.name.c_str(),
                          forge::ui::toString(st.state))) {
      ImGui::PushTextWrapPos(0.0f);
      ImGui::TextDisabled("solves for %s", st.solvesFor.c_str());
      ImGui::PopTextWrapPos();
      if (st.state == forge::ui::StudyState::Answered) {
        ImGui::TextColored(rgb(120, 200, 140), "%s", st.answer.c_str());
      }
      for (const forge::ui::StudySetupItem& item : st.setup) {
        ++studyRowsDrawn_;
        ImVec4 colour = rgb(130, 137, 148);
        if (item.state == forge::ui::StudyItemState::Ready) colour = rgb(120, 200, 140);
        if (item.state == forge::ui::StudyItemState::Blocked) colour = rgb(235, 105, 95);
        if (item.state == forge::ui::StudyItemState::Missing) colour = rgb(235, 175, 95);
        ImGui::Bullet();
        ImGui::TextColored(colour, "%-10s %s", item.name.c_str(), item.evidence.c_str());
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }
}

void ForgeFrame::drawPropertiesPanel() {
  ImGui::TextColored(rgb(242, 158, 38), "Document");
  ImGui::Separator();
  ImGui::Text("features        %zu", shell_.document().features);
  ImGui::Text("steps to undo   %zu", shell_.document().undoDepth);
  ImGui::Text("steps to redo   %zu", shell_.document().redoDepth);
  ImGui::Text("unsaved changes %s", shell_.document().dirty ? "yes" : "no");
  ImGui::Spacing();

  ImGui::TextColored(rgb(242, 158, 38), "Parameter");
  ImGui::Separator();
  ImGui::SetNextItemWidth(-1);
  ImGui::SliderFloat("##param", &paramValue_, 0.1f, 25.0f, "%.2f mm");
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::TextWrapped("feeds radius / distance / thickness on the next command");
  ImGui::PopStyleColor();
  ImGui::Spacing();

  // ── EDIT AN EXISTING FEATURE ──────────────────────────────────────────────
  // The control that makes the document parametric. Everything above appends;
  // this rewrites one number of a statement already in the program, through
  // part.edit_feature and the one registry.
  ImGui::TextColored(rgb(242, 158, 38), "Feature Parameter");
  ImGui::Separator();
  if (partDoc_.records().empty()) {
    ImGui::TextDisabled("(this part has no features yet)");
  } else {
    // Re-resolve every frame: undo, redo, New and Open all move records, and a
    // target cached across one of those would edit the wrong statement.
    if (partDoc_.featureAt(editFeatureId_) == nullptr) setEditTarget(0, 0);
    const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
    ImGui::SetNextItemWidth(-1);
    // THE FEATURE'S NAME, not its feature-IR statement. Both the closed combo
    // and every row in it drew rec->line.text() -- "%4 FILLET %3 2.000" -- which
    // is the compiler's rendering of the statement and the only name this panel
    // ever offered for a feature.
    if (ImGui::BeginCombo("##editfeature",
                          rec == nullptr ? "(none)" : forge::ui::featureDisplayName(*rec).c_str())) {
      for (const forge::ui::FeatureRecord& r2 : partDoc_.records()) {
        const bool isSel = r2.irId == editFeatureId_;
        if (ImGui::Selectable(forge::ui::featureDisplayName(r2).c_str(), isSel)) setEditTarget(r2.irId, 0);
        if (isSel) ImGui::SetItemDefaultFocus();
      }
      ImGui::EndCombo();
    }
    const std::size_t numbers = editParamCount();
    if (numbers == 0) {
      // CUT(%2, %3) has no number in it. Saying so is the honest answer; a
      // disabled field with a 0 in it would read as "this feature is 0 mm".
      ImGui::TextDisabled("%s has no number to change",
                          rec == nullptr ? "This feature"
                                         : forge::ui::featureDisplayName(*rec).c_str());
    } else {
      for (std::size_t i = 0; i < numbers; ++i) {
        if (i > 0) ImGui::SameLine();
        char tag[16];
        std::snprintf(tag, sizeof(tag), "#%zu", i + 1);
        if (ImGui::RadioButton(tag, editParamIndex_ == i)) setEditTarget(editFeatureId_, i);
      }
      ImGui::SetNextItemWidth(-1);
      ImGui::InputFloat("##editvalue", &editValue_, 0.5f, 5.0f, "%.3f");
      const bool changed =
          static_cast<double>(editValue_) != editParamValue();
      ImGui::BeginDisabled(!changed);
      // Refusing the no-op HERE as well as in the document is deliberate: the
      // document refuses it so no undo step is pushed, and the button greys out
      // so the user is never told "refused" for pressing Apply on an unchanged
      // number.
      if (ImGui::Button("Apply", ImVec2(-1, 0))) applyFeatureEdit(editValue_);
      ImGui::EndDisabled();
      if (!changed) {
        ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
        ImGui::TextWrapped("pick a feature row in the tree, then change its number");
        ImGui::PopStyleColor();
      }
    }
  }
  ImGui::Spacing();

  ImGui::TextColored(rgb(242, 158, 38), "Selection");
  ImGui::Separator();
  if (shell_.selection().count() == 0) {
    ImGui::TextDisabled("(nothing picked)");
  } else {
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      ImGui::BulletText("%s", forge::ui::userText(r.kind));
    }
    if (ImGui::Button("Keep this selection")) {
      shell_.selection().commit();
      note("Kept " + std::to_string(shell_.selection().committed().size()) +
           " picked item(s) for the next command");
    }
    ImGui::SameLine();
    if (ImGui::Button("Focus next")) shell_.selection().advanceFocus(1);
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Rebuild");
  ImGui::Separator();
  const IrBuildReport& r = scene_.lastBuild();
  // "ops 14 declared / 14 parsed / 14 compiled" was a compiler's progress
  // report in a properties panel. The counts a user can act on are how many
  // features were built and how many were not.
  ImGui::Text("features built  %zu of %zu", r.nCompiled, r.nDeclared);
  if (r.ok()) {
    ImGui::TextColored(r.valid ? rgb(120, 200, 130) : rgb(235, 175, 95), "%s",
                       r.valid ? "watertight solid"
                               : "built, but NOT a watertight solid");
    ImGui::Text("faces %ld   edges %ld", r.faceCount, r.edgeCount);
    ImGui::Text("volume %.3f mm3", r.volume);
    ImGui::Text("overall size   %.2f x %.2f x %.2f mm", r.bboxMax[0] - r.bboxMin[0],
                r.bboxMax[1] - r.bboxMin[1], r.bboxMax[2] - r.bboxMin[2]);
  } else {
    ImGui::TextColored(rgb(235, 105, 95), "This part did not rebuild");
    const std::string why = forge::ui::userFacingBuildFailure(r.error);
    ImGui::TextWrapped("%s", why.c_str());
    ImGui::TextDisabled("the viewport is showing the last body that built");
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "File");
  ImGui::Separator();
  ImGui::TextDisabled("%s%s", documentPath_.empty() ? "(not saved yet)" : documentPath_.c_str(),
                      documentDirty_ ? "  *" : "");
  // ── WHAT WAS HERE ────────────────────────────────────────────────────────
  // A section headed "Feature IR" that printed partDoc_.irProgram() -- the whole
  // feature-IR program, verbatim, in the Properties panel of a CAD application.
  // It is the document's internal form; the Feature Tree above is the same
  // information, named. It is NOT gone: drawConsolePanel() draws it under a
  // collapsed header, in the panel this application already treats as the
  // engineer's. Deleting a capability is not a way to pass a gate.
}

// ── THE ACTIVITY LOG: WHY A FEATURE FAILED, WITHOUT A DEBUGGER ──────────────
//
// This panel used to print two flat lists of strings: the frame's own `log_`
// notes and the shell's success-only journal. Neither carried a SEVERITY, so a
// refusal and a rebuild looked identical, and the journal cannot carry a failure
// at all -- it only records what ran. A user whose fillet did nothing had one
// line saying "part.fillet -> selection_signature_mismatch" and no way to learn
// what that meant.
//
// ForgeShell::log() records EVERY dispatch, refusals included, each with the
// sentence forge::ui built for it: the kind the command wanted, what is actually
// picked, what to do about it, and the feature-IR op. That is what this draws,
// severity-coloured and filterable, because "show me only the errors" is the
// first thing anyone asks a log.
void ForgeFrame::drawConsolePanel() {
  const forge::ui::ActivityLog& log = shell_.log();
  ImGui::TextColored(rgb(130, 137, 148), "activity: %zu entries", log.size());
  ImGui::SameLine();
  ImGui::TextColored(log.count(forge::ui::Severity::Error) != 0 ? rgb(235, 105, 95)
                                                                : rgb(120, 126, 137),
                     "%zu errors", log.count(forge::ui::Severity::Error));
  ImGui::SameLine();
  ImGui::TextColored(log.count(forge::ui::Severity::Warning) != 0 ? rgb(242, 158, 38)
                                                                 : rgb(120, 126, 137),
                     "%zu warnings", log.count(forge::ui::Severity::Warning));
  ImGui::SameLine();
  ImGui::SetNextItemWidth(120.0f * dpiScale_);
  const char* levels[] = {"all", "warnings+", "errors"};
  ImGui::Combo("##loglevel", &logLevel_, levels, 3);
  if (ImGui::IsItemHovered()) {
    ImGui::SetTooltip("What this panel shows. Everything is recorded whatever this says.");
  }
  ImGui::Separator();

  const forge::ui::Severity floorSeverity =
      logLevel_ >= 2 ? forge::ui::Severity::Error
                     : (logLevel_ == 1 ? forge::ui::Severity::Warning : forge::ui::Severity::Info);
  if (ImGui::BeginChild("##log", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    // The log admits what it threw away rather than quietly shortening history.
    if (log.dropped() != 0) {
      ImGui::TextDisabled("... %zu earlier entries dropped (the log holds %zu)", log.dropped(),
                          log.capacity());
    }
    std::size_t shown = 0;
    for (const forge::ui::LogEntry& e : log.entries()) {
      if (static_cast<int>(e.severity) < static_cast<int>(floorSeverity)) continue;
      ++shown;
      ImVec4 colour = rgb(170, 176, 186);
      const char* tag = "     ";
      if (e.severity == forge::ui::Severity::Warning) {
        colour = rgb(242, 158, 38);
        tag = "WARN ";
      } else if (e.severity == forge::ui::Severity::Error) {
        colour = rgb(235, 105, 95);
        tag = "ERROR";
      }
      ImGui::TextColored(colour, "%s", tag);
      ImGui::SameLine();
      ImGui::TextColored(rgb(130, 137, 148), "%-22s", e.source.c_str());
      ImGui::SameLine();
      // WRAPPED, because these sentences are long on purpose -- they are the
      // whole point -- and a message clipped at the panel edge is a message that
      // stops exactly where the useful half begins.
      ImGui::PushStyleColor(ImGuiCol_Text, colour);
      ImGui::TextWrapped("%s", e.message.c_str());
      ImGui::PopStyleColor();
      // ── THE ONE PLACE THE TECHNICAL DETAIL BELONGS ──────────────────────
      // Everywhere else in this application tells the user "the Console panel
      // has the technical detail". That sentence was FALSE: the detail column
      // was recorded and never drawn, so the panel we pointed at held nothing
      // extra. The Console is the engineer's surface -- dimmed, under the
      // sentence, out of the way of the model -- and it is the only surface
      // allowed to show a message the program wrote for itself.
      if (!e.detail.empty()) {
        ImGui::Indent(28.0f * dpiScale_);
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextDisabled("%s", e.detail.c_str());
        ImGui::PopTextWrapPos();
        ImGui::Unindent(28.0f * dpiScale_);
      }
    }
    if (shown == 0) {
      ImGui::TextDisabled("(nothing at this level — %zu entries hidden)", log.size());
    }
    // The frame builder's own rebuild/geometry notes, which are about the SCENE
    // rather than about a dispatch and so have no place in the command log.
    if (logLevel_ == 0 && !log_.empty()) {
      ImGui::Separator();
      ImGui::TextDisabled("frame notes");
      for (const std::string& l : log_) ImGui::TextUnformatted(l.c_str());
    }
    // ── THE FEATURE PROGRAM, MOVED RATHER THAN DELETED ────────────────────
    // The Properties panel used to carry a section headed "Feature IR" that
    // printed partDoc_.irProgram() verbatim -- the document's internal form, in
    // the panel a machinist opens to change a number. Deleting it would have
    // removed a real capability to make a gate green, so it is HERE instead:
    // collapsed, in the one panel this application has already declared to be
    // the engineer's, next to the detail column that carries the same kind of
    // thing. Nobody who did not go looking will read it.
    if (logLevel_ == 0) {
      ImGui::Separator();
      if (ImGui::CollapsingHeader("The program behind this part")) {
        const std::string ir = partDoc_.irProgram();
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextDisabled("%s", ir.empty() ? "(nothing yet)" : ir.c_str());
        ImGui::PopTextWrapPos();
      }
    }
    if (ImGui::GetScrollY() >= ImGui::GetScrollMaxY() - 4.0f) ImGui::SetScrollHereY(1.0f);
  }
  ImGui::EndChild();
}

void ForgeFrame::drawTimelinePanel() {
  // THE HISTORY IS THE DOCUMENT'S. Every column below is a field of the
  // FeatureRecord itself -- including the two a copied row could not carry: the
  // statement id the row IS, and the command that authored it ("seed" for a
  // statement the starting part contributed).
  const std::vector<forge::ui::FeatureRecord>& records = partDoc_.records();
  const IrBuildReport& r = scene_.lastBuild();
  ImGui::TextColored(rgb(130, 137, 148), "feature history: %zu feature%s", records.size(),
                     records.size() == 1 ? "" : "s");
  ImGui::Separator();
  for (std::size_t i = 0; i < records.size(); ++i) {
    const forge::ui::FeatureRecord& rec = records[i];
    const bool named = (r.failedOpId == rec.irId) || (r.failedLine == rec.irId);
    const bool ok = r.ok() || !named;
    ImGui::PushID(static_cast<int>(i));
    ImGui::TextColored(ok ? rgb(120, 200, 130) : rgb(235, 105, 95), "%s",
                       ok ? "OK " : "failed");
    ImGui::SameLine();
    // NAME, then WHERE IT CAME FROM. The two right-hand columns used to be the
    // command id ("part.fillet", or "seed") and the raw feature-IR statement.
    const forge::ui::CommandDescriptor* by =
        rec.commandId.empty() ? nullptr : shell_.registry().find(rec.commandId);
    const std::string origin = (by != nullptr && !by->label.empty())
                                   ? by->label
                                   : std::string("starting part");
    ImGui::Text("%-3zu %-24s %s", i + 1,
                forge::ui::featureDisplayName(rec).c_str(), origin.c_str());
    ImGui::PopID();
  }
}

// ── measure ─────────────────────────────────────────────────────────────────
// Everything here is arithmetic done by forge::ui::MeasureModel over the SAME
// triangles the viewport draws and the SAME face ids picking resolves to. The
// panel prints; it does not compute, which is why the numbers are gated headless.
const forge::ui::MeasureMesh& ForgeFrame::measureMesh() {
  // THE WITNESS IS THE BUILD COUNT, NOT THE TRIANGLE COUNT. See the member's
  // declaration: a parametric edit re-tessellates to the SAME triangle count
  // with different coordinates, and this cache used to hand the previous body's
  // measurements back for ever.
  const std::size_t builds = scene_.builds();
  if (measureBuilt_ && measureBuilds_ == builds) return measureMesh_;

  measureMesh_.clear();
  const std::vector<SceneVertex>& v = scene_.vertices();
  for (std::size_t i = 0; i + 2 < v.size(); i += 3) {
    const double a[3] = {v[i].px, v[i].py, v[i].pz};
    const double b[3] = {v[i + 1].px, v[i + 1].py, v[i + 1].pz};
    const double c[3] = {v[i + 2].px, v[i + 2].py, v[i + 2].pz};
    measureMesh_.addTriangle(a, b, c, v[i].faceId);
  }
  meshMeasure_ = forge::ui::measureMesh(measureMesh_);
  measureBuilds_ = builds;
  measureBuilt_ = true;
  return measureMesh_;
}

const forge::ui::MeshMeasure& ForgeFrame::modelMeasure() {
  measureMesh();  // builds the cache on first use
  return meshMeasure_;
}

forge::ui::SelectionMeasure ForgeFrame::selectionMeasure() {
  return forge::ui::measureFaces(measureMesh(), selectedFaceIds());
}

void ForgeFrame::drawMeasurePanel() {
  measureFaceRowsDrawn_ = 0;
  measureEdgeRowsDrawn_ = 0;
  const forge::ui::MeasureMesh& mesh = measureMesh();
  const forge::ui::MeshMeasure& m = meshMeasure_;

  ImGui::TextColored(rgb(242, 158, 38), "Model");
  ImGui::Separator();
  if (mesh.empty()) {
    ImGui::TextColored(rgb(235, 105, 95), "There is nothing to measure yet");
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty() ? "Draw or open a part and its size will appear here."
                                         : why.c_str());
    return;
  }
  // ★ WHAT IS BEING MEASURED, when it is not all of it. This panel measures the
  // triangles the viewport draws, and the Components tab can now take a body out
  // of that set. A size and a volume for three quarters of a model, printed with
  // no indication that a quarter is missing, is the exact shape of a plausible
  // wrong number -- so the panel says which it is. It is one line, and it only
  // appears when it is true.
  if (scene_.hiddenBodyCount() > 0) {
    ImGui::TextColored(rgb(235, 190, 95), "measuring what is shown: %zu bod%s hidden",
                       scene_.hiddenBodyCount(), scene_.hiddenBodyCount() == 1 ? "y" : "ies");
  }
  ImGui::Text("size      %.3f x %.3f x %.3f mm", m.box.size(0), m.box.size(1), m.box.size(2));
  ImGui::Text("min       %.3f  %.3f  %.3f", m.box.min[0], m.box.min[1], m.box.min[2]);
  ImGui::Text("max       %.3f  %.3f  %.3f", m.box.max[0], m.box.max[1], m.box.max[2]);
  ImGui::Text("diagonal  %.3f mm", m.box.diagonal());
  ImGui::Text("area      %.3f mm2", m.area);
  ImGui::Text("mesh      %zu triangles over %zu faces", m.triangles, m.faces);
  {
    // The recovered B-rep edges. The segment census is printed beside the count
    // because the count is a LOWER BOUND -- a seam edge has the same face on
    // both sides and cannot be recovered from face ids -- and a bound printed
    // without the evidence for it reads as an equality.
    const forge::ui::EdgeSet& es = edges();
    ImGui::Text("edges     %zu recovered from %zu face-boundary segments", es.size(),
                es.faceBoundarySegments);
  }
  if (m.watertight) {
    ImGui::Text("volume    %.3f mm3", m.volume);
    ImGui::Text("centroid  %.3f  %.3f  %.3f", m.centroid[0], m.centroid[1], m.centroid[2]);
    ImGui::TextColored(rgb(120, 200, 130), "closed surface, %s winding",
                       m.outward ? "outward" : "inward");
  } else {
    // A volume computed on a surface that does not close is a number with no
    // meaning. It is refused here rather than printed with a caveat nobody reads.
    ImGui::TextColored(rgb(230, 190, 90), "volume    not defined: the mesh does not close");
    ImGui::Text("          %zu boundary, %zu non-manifold, %zu reversed edges",
                m.boundaryEdges, m.nonManifoldEdges, m.reversedEdges);
    ImGui::Text("centroid  %.3f  %.3f  %.3f  (of area)", m.centroid[0], m.centroid[1],
                m.centroid[2]);
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Selection");
  ImGui::Separator();
  // An EDGE selection is a different report from a face selection, so it is
  // answered first and separately rather than folded into SelectionMeasure with
  // half its fields meaningless.
  const std::vector<std::size_t> pickedEdges = selectedEdgeIndices();
  if (!pickedEdges.empty()) {
    const forge::ui::EdgeSet& es = edges();
    const forge::ui::EdgeMeasure em = forge::ui::measureEdges(es, pickedEdges);
    for (std::size_t idx : pickedEdges) {
      const forge::ui::MeshEdge& e = es.edges[idx];
      // e.key() is the persistent name -- "e:12|34" -- which is how the
      // selection stores an edge, not how a user names one.
      ImGui::BulletText("Edge between faces %u and %u   %.4f mm   %zu segment%s%s", e.faceA,
                        e.faceB, e.length, e.segments, e.segments == 1 ? "" : "s",
                        e.closed ? "   closed" : "");
      ++measureEdgeRowsDrawn_;
    }
    ImGui::Text("total     %.4f mm over %zu edge%s", em.length, em.edges,
                em.edges == 1 ? "" : "s");
    ImGui::Text("extent    %.3f x %.3f x %.3f mm", em.box.size(0), em.box.size(1),
                em.box.size(2));
    if (em.hasPair) {
      ImGui::Spacing();
      ImGui::TextColored(rgb(120, 170, 230), "centre distance  %.3f mm", em.centreDistance);
    }
    return;
  }

  const forge::ui::SelectionMeasure s = selectionMeasure();
  if (s.faces == 0) {
    ImGui::TextDisabled(edgePickMode() ? "(pick an edge in the viewport)"
                                       : "(pick a face in the viewport)");
    return;
  }
  for (std::uint32_t id : selectedFaceIds()) {
    forge::ui::FaceMeasure f;
    if (!forge::ui::measureFace(measureMesh_, id, f)) continue;
    ImGui::BulletText("face %u   %.3f mm2   %zu tri%s", f.faceId, f.area, f.triangles,
                      f.planar ? "   planar" : "");
    ImGui::Text("     centre %.3f  %.3f  %.3f", f.centroid[0], f.centroid[1], f.centroid[2]);
    ImGui::Text("     normal %.3f  %.3f  %.3f", f.normal[0], f.normal[1], f.normal[2]);
    ++measureFaceRowsDrawn_;
  }
  ImGui::Text("total     %.3f mm2 over %zu face%s", s.area, s.faces, s.faces == 1 ? "" : "s");
  ImGui::Text("centroid  %.3f  %.3f  %.3f", s.centroid[0], s.centroid[1], s.centroid[2]);
  ImGui::Text("extent    %.3f x %.3f x %.3f mm", s.box.size(0), s.box.size(1), s.box.size(2));
  if (s.hasPair) {
    ImGui::Spacing();
    ImGui::TextColored(rgb(120, 170, 230), "centre distance  %.3f mm", s.centreDistance);
    ImGui::TextColored(rgb(120, 170, 230), "angle            %.2f deg%s", s.angleDegrees,
                       s.parallel ? "   (parallel)"
                                  : (s.perpendicular ? "   (perpendicular)" : ""));
  } else if (s.faces > 2) {
    ImGui::TextDisabled("(distance and angle need exactly two faces)");
  }
}


// ── MATERIAL AND MASS ───────────────────────────────────────────────────────
//
// The `appearance` and `materials` tabs. Both are the same question — what is
// this part made of and what does it weigh — asked from the Part workspace and
// from the Simulation workspace, so they are ONE panel and not two that will
// drift.
//
// EVERY NUMBER HERE IS MEASURED. The volume is the kernel's own, re-measured
// independently off the drawn surface; the densities are the material library's;
// each mass is the first times the second, computed by forge::ui::massTable().
// Nothing is filled in to make the layout look complete: when the drawn surface
// does not close there IS no volume, so there is no mass, and the panel says so
// instead of printing a plausible number.
//
// The document does not yet carry a material CHOICE — nothing in the file format
// can store one — so a single highlighted row would be an assignment the part
// never made. The whole table is the honest answer, and it is the answer an
// engineer actually wants at this stage: what the candidate materials weigh.
void ForgeFrame::drawMaterialPanel() {
  materialRowsDrawn_ = 0;
  const forge::ui::MeshMeasure& m = modelMeasure();
  const IrBuildReport& r = scene_.lastBuild();

  ImGui::TextColored(rgb(242, 158, 38), "This part");
  ImGui::Separator();
  if (m.triangles == 0) {
    ImGui::TextColored(rgb(235, 105, 95), "There is nothing to weigh yet");
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty() ? "Draw or open a part and its weight will appear here."
                                         : why.c_str());
    return;
  }
  ImGui::Text("size      %.3f x %.3f x %.3f mm", m.box.size(0), m.box.size(1), m.box.size(2));
  ImGui::Text("area      %.3f mm2", m.area);
  if (r.ok()) {
    ImGui::Text("volume    %.3f mm3", r.volume);
  }
  if (m.watertight) {
    ImGui::Text("as drawn  %.3f mm3", m.volume);
    ImGui::Text("centre    %.3f  %.3f  %.3f", m.centroid[0], m.centroid[1], m.centroid[2]);
  } else {
    // A weight computed from a surface that does not close is a weight with no
    // meaning. It is refused rather than printed with a caveat nobody reads.
    ImGui::TextColored(rgb(230, 190, 90), "volume    not defined: the shape does not close");
    ImGui::Text("          %zu open, %zu shared by more than two, %zu wound twice the same way",
                m.boundaryEdges, m.nonManifoldEdges, m.reversedEdges);
  }

  // The kernel's exact volume is preferred when it has one; the drawn surface
  // stands in when it does not, and the heading says which was used, because a
  // weight whose source is unstated is a weight nobody can check.
  const bool exact = r.ok() && r.volume > 0.0;
  const double volume = exact ? r.volume : (m.watertight ? m.volume : 0.0);

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What it would weigh");
  ImGui::Separator();
  const std::vector<forge::ui::MassRow> table = forge::ui::massTable(volume);
  if (table.empty()) {
    ImGui::TextWrapped("A weight needs a volume, and this shape does not have one yet.");
    return;
  }
  ImGui::TextDisabled(exact ? "from the exact volume above, lightest first"
                            : "from the volume of the shape as drawn, lightest first");
  ImGui::Spacing();
  if (ImGui::BeginChild("##mass_rows", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    for (std::size_t i = 0; i < table.size(); ++i) {
      const forge::ui::MassRow& row = table[i];
      const forge::ui::Appearance& a = row.material.appearance;
      // ONE ID PER ROW. Twenty swatches sharing the id "##swatch" is Dear ImGui's
      // "conflicting ID" defect, and this application has already shipped that
      // library's own error popup once.
      ImGui::PushID(static_cast<int>(i));
      // The material's OWN colour, so the table reads as the shading the part
      // would take rather than as a list of names.
      ImGui::ColorButton("##swatch",
                         ImVec4(static_cast<float>(a.red), static_cast<float>(a.green),
                                static_cast<float>(a.blue), 1.0f),
                         ImGuiColorEditFlags_NoTooltip | ImGuiColorEditFlags_NoDragDrop,
                         ImVec2(14.0f * dpiScale_, 14.0f * dpiScale_));
      ImGui::SameLine();
      ImGui::Text("%-22s %9.0f kg/m3   %s", row.material.name.c_str(),
                  row.material.densityKgPerM3,
                  forge::ui::describeMass(row.properties, forge::ui::MassUnit::Gram).c_str());
      if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("%s\n%s\nshading: %.0f%% metal, %.0f%% rough",
                          row.material.name.c_str(),
                          forge::ui::describeMass(row.properties,
                                                  forge::ui::MassUnit::Kilogram).c_str(),
                          a.metallic * 100.0, a.roughness * 100.0);
      }
      ImGui::PopID();
      ++materialRowsDrawn_;
    }
  }
  ImGui::EndChild();
}

// ── THE CURVES THIS SHAPE IS BUILT FROM ─────────────────────────────────────
//
// The `curve_list` tab. Every row is a recovered B-rep edge with its own
// measured length — the same edge set the viewport picks against and the Measure
// panel reports, so picking a row here and picking the curve in the 3D view
// produce the SAME selection through the same key vocabulary.
//
// The count is a LOWER BOUND and the panel says so with the evidence beside it:
// a seam has the same face on both sides and cannot be recovered from face ids.
// A bound printed without its evidence reads as an equality.
void ForgeFrame::drawCurveListPanel() {
  curveRowsDrawn_ = 0;
  const forge::ui::EdgeSet& es = edges();

  if (es.edges.empty()) {
    ImGui::TextColored(rgb(235, 105, 95), "There are no curves to list yet");
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty() ? "Draw or open a part and its curves will appear here."
                                         : why.c_str());
    return;
  }

  double total = 0.0;
  std::size_t closed = 0;
  for (const forge::ui::MeshEdge& e : es.edges) {
    total += e.length;
    if (e.closed) ++closed;
  }
  ImGui::TextColored(rgb(130, 137, 148), "%zu curves | %zu closed | %.3f mm in total",
                     es.size(), closed, total);
  ImGui::TextColored(rgb(130, 137, 148), "at least this many: a curve where one face meets "
                                         "itself cannot be told apart from the face");
  ImGui::Separator();

  const std::vector<std::size_t> picked = selectedEdgeIndices();
  const float rowH = ImGui::GetTextLineHeightWithSpacing();
  const std::size_t rows = es.size();
  if (ImGui::BeginChild("##curve_rows", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    // VIRTUALIZED. A tessellated part carries thousands of recovered curves and
    // a panel that walks all of them every frame is the cost the feature tree's
    // clipper exists to avoid.
    ImGuiListClipper clipper;
    clipper.Begin(static_cast<int>(rows), rowH);
    while (clipper.Step()) {
      for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; ++i) {
        const std::size_t index = static_cast<std::size_t>(i);
        // RE-FETCHED, never carried across the click below. edges() rebuilds and
        // REPLACES the set when the triangle count changes, and a reference held
        // across a button that can reach the scene is the use-after-free the tab
        // strip and the feature tree have each already shipped once.
        const forge::ui::EdgeSet& live = edges();
        if (index >= live.edges.size()) break;
        const forge::ui::MeshEdge& e = live.edges[index];
        bool on = false;
        for (std::size_t p : picked) {
          if (p == index) on = true;
        }
        ImGui::PushID(i);
        char row[192];
        std::snprintf(row, sizeof(row), "%-26s %10.4f mm   %2zu seg%s   faces %u/%u",
                      e.key().c_str(), e.length, e.segments, e.closed ? "   loop" : "       ",
                      e.faceA, e.faceB);
        if (ImGui::Selectable(row, on)) clickEdge(index, ImGui::GetIO().KeyShift);
        if (ImGui::IsItemHovered()) setPreselectedEdge(index);
        ImGui::PopID();
        ++curveRowsDrawn_;
      }
    }
    clipper.End();
  }
  ImGui::EndChild();
}

// ── WAS THE PART BUILT, AND IS THE PICTURE OF IT ────────────────────────────
//
// The `verify_report` tab. It answers with a VECTOR of observables rather than
// one number, because a single scalar cannot validate geometry: a volume can be
// right while the shape is wrong, and a box can be right while the volume is.
//
// The second instrument is the point. The modelling kernel reports its own
// verdict on the solid it built; the triangle soup on screen is measured
// independently, without asking the kernel whether it is happy, and the two are
// compared. That is the only check in this application that can catch a build
// reported as successful over geometry it did not produce.
//
// The arithmetic is forge::ui::buildInspectionReport(), which is asserted
// headless against closed forms — including every one of its failures.
void ForgeFrame::drawVerifyReportPanel() {
  verifyRowsDrawn_ = 0;
  const IrBuildReport& r = scene_.lastBuild();
  const forge::ui::MeshMeasure& m = modelMeasure();

  forge::ui::KernelSolidReport k;
  k.built = r.ok();
  k.valid = r.valid;
  k.faceCount = r.faceCount;
  k.edgeCount = r.edgeCount;
  k.volumeMm3 = r.volume;
  k.declared = r.nDeclared;
  k.parsed = r.nParsed;
  k.compiled = r.nCompiled;
  k.bboxKnown = r.ok();
  for (std::size_t a = 0; a < 3; ++a) {
    k.bboxMin[a] = r.bboxMin[a];
    k.bboxMax[a] = r.bboxMax[a];
  }
  const forge::ui::InspectionReport report =
      forge::ui::buildInspectionReport(k, m, partDoc_.records());

  if (report.failed != 0) {
    ImGui::TextColored(rgb(235, 105, 95), "%zu of %zu checks disagree", report.failed,
                       report.answered());
  } else if (report.answered() == 0) {
    ImGui::TextColored(rgb(230, 190, 90), "nothing could be checked yet");
  } else {
    ImGui::TextColored(rgb(120, 200, 130), "all %zu checks agree", report.answered());
  }
  ImGui::TextColored(rgb(130, 137, 148), "%zu could not be answered | %zu reported for reading",
                     report.unavailable, report.informational);
  ImGui::Separator();

  if (!r.ok()) {
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.c_str());
    ImGui::Spacing();
  }

  if (ImGui::BeginChild("##verify_rows", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    for (const forge::ui::InspectionCheck& c : report.checks) {
      ImVec4 colour = rgb(130, 137, 148);
      const char* mark = "-";
      switch (c.state) {
        case forge::ui::CheckState::Pass:
          colour = rgb(120, 200, 130); mark = "OK"; break;
        case forge::ui::CheckState::Fail:
          colour = rgb(235, 105, 95); mark = "NO"; break;
        case forge::ui::CheckState::Unavailable:
          colour = rgb(230, 190, 90); mark = "??"; break;
        case forge::ui::CheckState::Informational:
          colour = rgb(120, 170, 230); mark = "=="; break;
      }
      ImGui::TextColored(colour, "%s", mark);
      ImGui::SameLine();
      ImGui::Text("%s", c.name.c_str());
      ImGui::PushTextWrapPos(0.0f);
      ImGui::TextDisabled("      %s", c.evidence.c_str());
      ImGui::PopTextWrapPos();
      ++verifyRowsDrawn_;
    }

    // ── THE CHECKS THE USER WROTE THEMSELVES ────────────────────────────────
    // A VERIFY step is an assertion a person put into the part on purpose, so
    // it is listed even though this panel cannot yet say whether it held: the
    // build report carries one verdict for the whole program, not one per step.
    std::size_t asserted = 0;
    for (const forge::ui::FeatureRecord& rec : partDoc_.records()) {
      if (rec.line.op != "VERIFY") continue;
      if (asserted == 0) {
        ImGui::Spacing();
        ImGui::TextColored(rgb(242, 158, 38), "Checks written into this part");
        ImGui::Separator();
      }
      ImGui::BulletText("%s", forge::ui::featureDisplayName(rec).c_str());
      ++asserted;
      ++verifyRowsDrawn_;
    }
    if (asserted != 0) {
      ImGui::TextDisabled("these ran with the rebuild; a step that failed would have "
                          "stopped it above");
    }
  }
  ImGui::EndChild();
}

// ── THE NUMBERS THAT DRIVE THE SHAPE ────────────────────────────────────────
//
// The `dimensions` tab. Every numeric argument of every step, in one list, each
// row addressed by the SAME index part.edit_feature uses — so clicking a row
// aims the parameter editor at exactly the number the row shows. That identity
// is the whole reason forge::ui::collectDrivingDimensions() exists rather than a
// second walk written here: a panel that displays one slot and rewrites another
// is a panel that silently resizes the part.
//
// A step with no number contributes NO row, and the count of those steps is
// printed, so a short list reads as a fact about the model rather than as a
// panel that lost some.
void ForgeFrame::drawDimensionsPanel() {
  dimensionRowsDrawn_ = 0;
  const std::vector<forge::ui::FeatureRecord>& records = partDoc_.records();
  const std::vector<forge::ui::DimensionRow> rows = forge::ui::collectDrivingDimensions(records);
  const std::size_t plain = forge::ui::statementsWithoutDimensions(records);

  if (records.empty()) {
    ImGui::TextColored(rgb(235, 105, 95), "This part has no steps yet");
    ImGui::TextWrapped("Draw something and the numbers that drive it will appear here.");
    return;
  }
  ImGui::TextColored(rgb(130, 137, 148), "%zu numbers over %zu steps", rows.size(),
                     records.size());
  if (plain != 0) {
    ImGui::TextColored(rgb(130, 137, 148), "%zu %s no number to change", plain,
                       plain == 1 ? "step has" : "steps have");
  }
  ImGui::Separator();
  if (rows.empty()) {
    ImGui::TextWrapped("Nothing in this part is driven by a number you can change.");
    return;
  }
  ImGui::TextDisabled("pick a row, then change it in Properties");
  ImGui::Spacing();

  if (ImGui::BeginChild("##dim_rows", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    int lastId = 0;
    for (std::size_t i = 0; i < rows.size(); ++i) {
      const forge::ui::DimensionRow& row = rows[i];
      if (row.irId != lastId) {
        lastId = row.irId;
        const forge::ui::FeatureRecord* rec = partDoc_.featureAt(row.irId);
        // A raw IR statement ("%4 = FILLET(%3, 2.5, ALL)") is an identifier, not a
        // sentence. featureDisplayName() is what turns it into one.
        const std::string shown =
            rec == nullptr ? row.op : forge::ui::featureDisplayName(*rec);
        ImGui::TextColored(rgb(242, 158, 38), "%s", shown.c_str());
      }
      const bool on = row.irId == editFeatureId_ && row.numberIndex == editParamIndex_;
      ImGui::PushID(static_cast<int>(i));
      char text[128];
      std::snprintf(text, sizeof(text), "    %s #%zu    %.4f", row.op.c_str(),
                    row.numberIndex + 1, row.value);
      if (ImGui::Selectable(text, on)) {
        // The SAME entry point the feature tree uses, so the two panels cannot
        // aim the editor at different things.
        setEditTarget(row.irId, row.numberIndex);
      }
      if (ImGui::IsItemHovered() && !row.label.empty()) {
        ImGui::SetTooltip("%s", row.label.c_str());
      }
      ImGui::PopID();
      ++dimensionRowsDrawn_;
    }
  }
  ImGui::EndChild();
}


// ── THE BLOCK THIS PART COMES OUT OF ────────────────────────────────────────
//
// The `stock` tab. Two questions a shop asks before quoting anything: what
// billet does this need, and how much of it becomes swarf. Both are arithmetic
// over numbers this application has already measured — the part's own bounding
// box and its volume — so both are real, and forge::ui::stockEnvelope() is
// asserted headless against closed forms including every way it can be unknown.
//
// It is the SMALLEST block the part fits in and the panel says so. Real stock
// carries a machining allowance and comes in standard sizes; this is the floor
// those choices start from, not a claim about what anyone will order.
void ForgeFrame::drawStockPanel() {
  const forge::ui::MeshMeasure& m = modelMeasure();
  const IrBuildReport& r = scene_.lastBuild();

  if (m.triangles == 0) {
    ImGui::TextColored(rgb(235, 105, 95), "There is no part to cut yet");
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty() ? "Draw or open a part and the block it needs will "
                                           "appear here."
                                         : why.c_str());
    return;
  }

  // The kernel's exact volume when it has one, the drawn surface's when it does
  // not. Which was used is printed, because a ratio whose source is unstated is
  // a ratio nobody can check.
  const bool exact = r.ok() && r.volume > 0.0;
  const double volume = exact ? r.volume : (m.watertight ? m.volume : 0.0);
  const forge::ui::StockEnvelope s = forge::ui::stockEnvelope(m.box, volume);

  ImGui::TextColored(rgb(242, 158, 38), "Smallest block that holds this part");
  ImGui::Separator();
  ImGui::Text("block     %.3f x %.3f x %.3f mm", m.box.size(0), m.box.size(1), m.box.size(2));
  ImGui::TextDisabled("no machining allowance: add your own before ordering");
  if (!s.known) {
    ImGui::Spacing();
    ImGui::TextColored(rgb(230, 190, 90), "How much is cut away cannot be worked out yet");
    ImGui::TextWrapped("That needs the volume of the part as well as the size of the block, and "
                       "this shape does not have one.");
    return;
  }

  ImGui::Text("block     %.3f mm3", s.blockVolumeMm3);
  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What is left, and what is cut away");
  ImGui::Separator();
  ImGui::Text("part      %.3f mm3", s.partVolumeMm3);
  ImGui::Text("cut away  %.3f mm3   (%.2f%% of the block)", s.removedVolumeMm3,
              s.removedFraction * 100.0);
  ImGui::Text("ratio     %.3f to 1  block to part", s.buyToFly);
  ImGui::TextDisabled(exact ? "from the exact volume of the part"
                            : "from the volume of the shape as drawn");

  // A bar is worth more than the percentage beside it: the eye reads "most of
  // this billet is swarf" from a filled fraction faster than from a number.
  ImGui::Spacing();
  ImGui::ProgressBar(static_cast<float>(1.0 - s.removedFraction),
                     ImVec2(-1.0f, 14.0f * dpiScale_), "part");
  ImGui::TextDisabled("the filled part of the bar is the block that stays");
}

// ── archie tools ────────────────────────────────────────────────────────────
// The agent-callable surface of the running app, and an operable palette: the
// button dispatches through ForgeShell::run, so what the panel offers and what
// Archie can call are the same command reached the same way.
forge::ui::ToolCatalog ForgeFrame::toolCatalog() const {
  return forge::ui::buildToolCatalog(shell_.registry(), shell_.selection(), toolQuery_);
}

void ForgeFrame::drawToolsPanel() {
  toolRowsDrawn_ = 0;
  const forge::ui::ToolCatalog cat = toolCatalog();

  ImGui::TextColored(rgb(130, 137, 148), "%zu tools | %zu callable now", cat.size(),
                     cat.available);
  ImGui::TextColored(rgb(130, 137, 148), "%zu need a selection | %zu need parameters | %zu off",
                     cat.needsSelection, cat.needsParameters, cat.disabled);
  ImGui::SetNextItemWidth(-1);
  ImGui::InputTextWithHint("##toolq", "filter tools...", toolQuery_, sizeof(toolQuery_));
  ImGui::Separator();

  if (ImGui::BeginChild("##tool_rows", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    if (cat.entries.empty()) {
      ImGui::TextDisabled("no tool matches \"%s\"", toolQuery_);
    }
    std::string category;
    for (std::size_t i = 0; i < cat.entries.size(); ++i) {
      const forge::ui::ToolEntry& e = cat.entries[i];
      if (e.category != category) {
        category = e.category;
        ImGui::TextColored(rgb(242, 158, 38), "%s", category.c_str());
      }
      ImGui::PushID(static_cast<int>(i));
      ImGui::BeginDisabled(!e.callable());
      if (ImGui::Button(e.label.c_str())) invoke(e.id);
      ImGui::EndDisabled();
      ImGui::SameLine();
      ImGui::TextColored(e.callable() ? rgb(120, 200, 130) : rgb(150, 157, 168), "%s",
                         forge::ui::toString(e.availability));
      // ── WHAT WAS HERE ──────────────────────────────────────────────────
      // Three lines under every one of the 84 rows:
      //   "  part.counterbore   ir=CBORE   undo=single"
      //   "  needs 1..n face (homogeneous)"
      //   "  args  diameter:number*=6, cbore_diameter:number*=11, ..."
      // Every field on those lines is a field of the AGENT-facing tool
      // catalogue -- the stable id, the feature-IR op, the undo contract, the
      // signature notation, the parameter schema. They are all still on
      // ToolEntry, they are still what the capability manifest reports, and not
      // one of them is a sentence for the person clicking the button.
      const forge::ui::CommandDescriptor* d = shell_.registry().find(e.id);
      if (d != nullptr && d->signature.kind != forge::ui::EntityKind::None) {
        ImGui::TextDisabled("  works on %s", d->signature.describeForUser().c_str());
      }
      if (!e.reason.empty()) {
        ImGui::TextColored(rgb(230, 190, 90), "  %s", e.reason.c_str());
      }
      ImGui::PopID();
      ++toolRowsDrawn_;
    }
  }
  ImGui::EndChild();
}

// ── the Archie CoPilot ──────────────────────────────────────────────────────
//
// THE SEAM. forge::ui is headless and this frame builder opens no socket, so a
// request is RAISED and a response is DELIVERED; the transport between them is
// the host's. copilotAutoPlan_ answers in process with forge::ui::LocalPlanner
// so the panel is a working surface with no model configured.
const forge::ui::PlanRequest* ForgeFrame::copilotRequest() const noexcept {
  return copilot_.requestPending() ? &copilot_.request() : nullptr;
}

forge::ui::PlanCheck ForgeFrame::deliverCopilotPlan(const forge::ui::PlanResponse& response) {
  // The LIVE registry, not a copy: a plan is validated against the commands that
  // exist at the moment it is offered, and the CoPilot's own op-constraint
  // bridge rules on every value it states.
  return copilot_.deliver(response, shell_.registry());
}

void ForgeFrame::failCopilotRequest(const std::string& why) { copilot_.failRequest(why); }

void ForgeFrame::copilotType(const std::string& text) { copilotInput_ = text; }

// The three presses RECORD; build() runs them once the walk is over.
void ForgeFrame::copilotSubmit() {
  if (copilotInput_.empty() || copilot_.requestPending()) return;
  pendingCopilotSubmit_ = true;
}

void ForgeFrame::copilotApplyPlan() {
  if (!copilot_.hasPlan()) return;
  pendingCopilotApply_ = true;
}

void ForgeFrame::copilotDiscardPlan() {
  if (!copilot_.hasPlan()) return;
  pendingCopilotDiscard_ = true;
}

void ForgeFrame::runCopilotSubmit() {
  if (copilotInput_.empty()) return;

  // WHAT THE PLANNER IS TOLD ABOUT THE WORLD, read from the live objects each
  // time rather than cached: a summary that can go stale is a summary that can
  // describe a document the plan will not meet.
  std::string picked = std::to_string(shell_.selection().count()) + " picked";
  if (shell_.selection().count() > 0) {
    picked += " (";
    for (std::size_t i = 0; i < shell_.selection().selection().size(); ++i) {
      if (i != 0) picked += ", ";
      picked += forge::ui::toString(shell_.selection().selection()[i].kind);
    }
    picked += ")";
  }
  const std::string doc = documentName_ + ": " +
                          std::to_string(partDoc_.records().size()) + " statement(s), " +
                          std::to_string(partDoc_.featureCount()) + " command-authored";

  const std::uint64_t id =
      copilot_.submit(copilotInput_,
                      forge::ui::planTools(shell_.registry(), shell_.selection()), picked, doc);
  if (id == 0) return;  // blank, or a request already in flight
  copilotInput_.clear();
  // ANSWERED IN PROCESS, or left pending for the host to answer. Either way the
  // reply comes back through deliverCopilotPlan(), so there is one validation
  // path and not two.
  if (copilotAutoPlan_) deliverCopilotPlan(copilotPlanner_.plan(copilot_.request()));
}

void ForgeFrame::runCopilotApply() {
  if (!copilot_.hasPlan()) return;
  copilot_.apply(shell_, partDoc_);
  // A dispatch that changed the document already re-derived the geometry through
  // documentChanged(); a plan that was refused at the door changed nothing, and
  // rebuilding for it would report progress that did not happen.
}

void ForgeFrame::runCopilotDiscard() { copilot_.discardPlan(); }

void ForgeFrame::drawCopilotPanel() {
  copilotRowsDrawn_ = 0;
  copilotTranscriptRowsDrawn_ = 0;

  ImGui::TextColored(rgb(242, 158, 38), "Archie CoPilot");
  ImGui::TextColored(rgb(130, 137, 148),
                     "%zu accepted | %zu Forge would not build | %zu you rejected | %zu steps "
                     "applied",
                     copilot_.plansAccepted(), copilot_.plansRefused(),
                     copilot_.plansRejectedByUser(), copilot_.stepsApplied());
  // "planner: LocalPlanner (offline, deterministic) | 84 tools from the live
  // registry" -- a C++ class name and the name of an internal object, on the
  // header line of the panel a user talks to.
  ImGui::TextColored(rgb(130, 137, 148), "%s   |   %zu tools Archie can use",
                     copilotAutoPlan_ ? "Working offline, on this computer"
                                      : "Connected",
                     shell_.registry().size());
  ImGui::Separator();

  // ── the ask ───────────────────────────────────────────────────────────────
  char buf[256];
  const std::size_t copied = copilotInput_.copy(buf, sizeof(buf) - 1);
  buf[copied] = '\0';
  ImGui::SetNextItemWidth(-90.0f * dpiScale_);
  const bool entered = ImGui::InputTextWithHint("##copilot_in", "ask Archie for an edit...", buf,
                                                sizeof(buf),
                                                ImGuiInputTextFlags_EnterReturnsTrue);
  copilotInput_.assign(buf);
  ImGui::SameLine();
  ImGui::BeginDisabled(copilotInput_.empty() || copilot_.requestPending());
  const bool sent = ImGui::Button("Send");
  ImGui::EndDisabled();
  // RECORDED, not run: submit dispatches nothing itself, but the Apply below it
  // does, and one rule for all three is one rule to keep.
  // The widget goes through the SAME public control a host or a gate presses.
  // Two ways to press one button is two behaviours to keep in step.
  if (entered || sent) copilotSubmit();
  if (copilot_.requestPending()) {
    ImGui::TextColored(rgb(230, 190, 90), "Thinking...");
  }

  // ── the verdict, LINE BY LINE ─────────────────────────────────────────────
  // Shown whether the plan was accepted or refused. A user deciding whether to
  // accept is entitled to see what was checked, and a user whose plan was
  // refused is entitled to see WHICH line and by WHICH constraint -- an empty
  // panel is not a refusal, it is a silence.
  const forge::ui::PlanVerdict& verdict = copilot_.verdict();
  if (!verdict.steps.empty()) {
    ImGui::Separator();
    if (copilot_.hasPlan()) {
      const forge::ui::Plan& plan = copilot_.plan();
      ImGui::TextColored(rgb(120, 200, 130), "PLAN  %s",
                         plan.summary.empty() ? plan.intent.c_str() : plan.summary.c_str());
    } else {
      ImGui::TextColored(rgb(230, 120, 110), "NOT OFFERED  —  %s",
                         forge::ui::userText(verdict.check));
      if (!verdict.explanation.empty()) ImGui::TextWrapped("%s", verdict.explanation.c_str());
    }
  }

  if (ImGui::BeginChild("##copilot_rows", ImVec2(0.0f, -34.0f * dpiScale_),
                        ImGuiChildFlags_None)) {
    const forge::ui::Plan& plan = copilot_.plan();
    for (std::size_t i = 0; i < verdict.steps.size(); ++i) {
      const forge::ui::StepVerdict& sv = verdict.steps[i];
      ImGui::PushID(static_cast<int>(i));
      // The step number and the TOOL'S LABEL. This row was the step index, the
      // feature-IR op ("FILLET"), the word ACCEPT or REFUSE, and the command id
      // on the line below it.
      const forge::ui::CommandDescriptor* tool = shell_.registry().find(sv.commandId);
      const std::string toolName = (tool != nullptr && !tool->label.empty())
                                       ? tool->label
                                       : std::string("this step");
      ImGui::TextColored(sv.accepted() ? rgb(120, 200, 130) : rgb(230, 120, 110), "%zu  %s  %s",
                         sv.index, toolName.c_str(),
                         sv.accepted() ? "will run" : "will not run");
      // The step as it would run, when the plan is still on offer.
      if (i < plan.steps.size()) {
        if (!plan.steps[i].note.empty()) {
          ImGui::TextDisabled("  %s", plan.steps[i].note.c_str());
        }
        ImGui::TextDisabled("  works on: %s", forge::ui::toString(plan.steps[i].select));
      }
      if (!sv.accepted()) {
        // WHICH CONSTRAINT, and WHY. Both, always: the constraint's name is what
        // a planner can act on, and the reason is what a person can act on.
        if (sv.constraint != forge::ui::OpConstraint::Ok) {
          ImGui::TextColored(rgb(230, 120, 110), "  %s",
                             forge::ui::userText(sv.constraint));
        }
        if (!sv.parameter.empty()) {
          ImGui::TextColored(rgb(230, 190, 90), "  parameter: %s", sv.parameter.c_str());
        }
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextColored(rgb(230, 190, 90), "  %s", sv.reason.c_str());
        ImGui::PopTextWrapPos();
      }
      ImGui::PopID();
      ++copilotRowsDrawn_;
    }

    // ── the transcript ──────────────────────────────────────────────────────
    if (!copilot_.transcript().empty()) {
      ImGui::Separator();
      for (const forge::ui::TranscriptLine& line : copilot_.transcript()) {
        const ImVec4 colour = line.role == forge::ui::TranscriptRole::User    ? rgb(200, 208, 220)
                              : line.role == forge::ui::TranscriptRole::Copilot ? rgb(242, 158, 38)
                                                                              : rgb(150, 157, 168);
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextColored(colour, "%s: %s", forge::ui::toString(line.role), line.text.c_str());
        ImGui::PopTextWrapPos();
        ++copilotTranscriptRowsDrawn_;
      }
    }
    if (verdict.steps.empty() && copilot_.transcript().empty()) {
      ImGui::TextDisabled("Ask for an edit. Archie may only use tools you could use");
      ImGui::TextDisabled("yourself, and every step is checked against what Forge can");
      ImGui::TextDisabled("actually build — before it is offered, and again before it runs.");
    }
  }
  ImGui::EndChild();

  // ── ACCEPT / REJECT ───────────────────────────────────────────────────────
  ImGui::Separator();
  ImGui::BeginDisabled(!copilot_.hasPlan());
  if (ImGui::Button("Accept & Apply")) copilotApplyPlan();
  ImGui::SameLine();
  if (ImGui::Button("Reject")) copilotDiscardPlan();
  ImGui::EndDisabled();
  if (!copilot_.hasPlan()) {
    ImGui::SameLine();
    ImGui::TextDisabled("nothing on offer");
  }
}

// ── THE ASSEMBLY PANELS ─────────────────────────────────────────────────────
//
// Four tabs — Components, Mates, Contacts and BOM — that between them used to
// draw one apologetic sentence and nothing else. Every number they show now is
// measured by the kernel off the B-REP of the model that is on screen, at the
// moment it was built, and carried here in the build report: the volume and the
// surface area from the kernel's own integrators, the distance between two
// bodies from its exact distance solver, the shared volume from a real boolean.
// No LENGTH, AREA or VOLUME on these four tabs is measured on the display mesh —
// a meshed volume is wrong in the fourth digit for any curved body — nothing is
// estimated, and nothing is filled in to make a layout look finished. The one
// mesh number that does appear is a TRIANGLE COUNT, on the Components tab, and
// it is labelled as what it is.
//
// WHAT A "BODY" IS HERE, PRECISELY. A Forge document is one feature program,
// and that program can build more than one separate solid: two shapes 60 mm
// apart joined by a union stay two bodies, a linear pattern of a spaced part is
// four of them, and a file the document opens can carry a whole assembly. Two
// shapes that actually MEET over a face become one body, because that is what a
// union means. So "how many separate pieces is this, and how do they sit against
// each other" is a question the geometry already answers, and these four tabs
// are that answer.

std::string ForgeFrame::bodyLabel(std::uint32_t bodyIndex) {
  return "Body " + std::to_string(bodyIndex);
}

void ForgeFrame::setComponentFilterText(const std::string& text) {
  const std::size_t n = std::min(text.size(), sizeof(componentQuery_) - 1);
  std::memcpy(componentQuery_, text.data(), n);
  componentQuery_[n] = '\0';
}

// ── the Components panel's four verbs ───────────────────────────────────────
// Every one of them does TWO things, and the second is the one that is easy to
// forget: it latches visibilityDirty_ so the host re-uploads the vertex stream.
// A body hidden without that latch stays on screen until something unrelated
// happens to redraw, which is the worst kind of broken -- it works when you test
// it and not when you use it. There is one path, and the widgets take it.
bool ForgeFrame::showBody(std::uint32_t bodyIndex, bool visible) {
  if (!scene_.setBodyVisible(bodyIndex, visible)) return false;
  visibilityDirty_ = true;
  note(bodyLabel(bodyIndex) + (visible ? " is shown" : " is hidden"));
  return true;
}

void ForgeFrame::showEveryBody() {
  if (scene_.hiddenBodyCount() == 0) return;
  scene_.showAllBodies();
  visibilityDirty_ = true;
  note("every body is shown again");
}

void ForgeFrame::hideEveryBody() {
  bool moved = false;
  for (std::uint32_t i = 1; i <= scene_.bodyCount(); ++i) {
    if (scene_.setBodyVisible(i, false)) moved = true;
  }
  if (!moved) return;
  visibilityDirty_ = true;
  note("every body is hidden");
}

void ForgeFrame::showOnlyBody(std::uint32_t bodyIndex) {
  bool moved = false;
  for (std::uint32_t i = 1; i <= scene_.bodyCount(); ++i) {
    if (scene_.setBodyVisible(i, i == bodyIndex)) moved = true;
  }
  if (!moved) return;
  visibilityDirty_ = true;
  note("only " + bodyLabel(bodyIndex) + " is shown");
}

namespace {

// Case-insensitive substring, so a filter box behaves the way every other one
// the user has ever used behaves.
bool matchesFilter(const std::string& haystack, const char* needle) {
  if (needle == nullptr || needle[0] == '\0') return true;
  std::string lowHay = haystack;
  std::string lowNeedle = needle;
  for (char& c : lowHay) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  for (char& c : lowNeedle) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return lowHay.find(lowNeedle) != std::string::npos;
}

// Two bodies are the SAME ITEM when their measured volume, surface area and
// overall size all agree. That is a real test on real numbers, not a guess from
// the feature history: a pattern of four identical blocks reads as one item with
// a quantity of four, and four blocks that merely look alike do not.
//
// The tolerance is RELATIVE, because an absolute one would call two 5 m castings
// identical and two 0.2 mm pins different.
bool sameShape(const forge::desktop::SceneBody& a, const forge::desktop::SceneBody& b) {
  auto close = [](double x, double y) {
    const double scale = std::max(1.0, std::max(std::fabs(x), std::fabs(y)));
    return std::fabs(x - y) <= 1e-6 * scale;
  };
  return close(a.volume, b.volume) && close(a.area, b.area) && close(a.sizeX(), b.sizeX()) &&
         close(a.sizeY(), b.sizeY()) && close(a.sizeZ(), b.sizeZ());
}

}  // namespace

// The one answer all four tabs give when there is nothing to inventory. Three
// DIFFERENT situations, told apart, because a single "nothing here" for all
// three teaches a user to distrust the panel:
//
//   * the model has not been built at all       -> say what to draw
//   * it built, and holds no solid body         -> say what kind of shape it is
//   * it built solids the kernel could not walk -> say so, do NOT show an empty
//                                                  list for a model that plainly
//                                                  has bodies in it
bool ForgeFrame::drawAssemblyEmptyState() {
  const IrBuildReport& report = scene_.lastBuild();
  if (!report.ok()) {
    ImGui::TextColored(rgb(235, 175, 95), "There is no model to break down yet");
    ImGui::PushTextWrapPos(0.0f);
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped(
        "%s", why.empty() ? "Draw a shape, or open a file, and the bodies it is made of will be "
                            "listed here."
                          : why.c_str());
    ImGui::PopTextWrapPos();
    return true;
  }
  if (!report.bodiesAnalysed) {
    ImGui::TextColored(rgb(235, 175, 95), "This model has no solid bodies to list");
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped(
        "What was built is a surface or a faceted shape rather than solid material, so there is "
        "nothing to count, measure or compare. Build a solid — extrude a sketch, revolve one, or "
        "start from a box or a cylinder — and the bodies it is made of will be listed here.");
    ImGui::PopTextWrapPos();
    return true;
  }
  if (report.bodies.empty()) {
    ImGui::TextColored(rgb(235, 175, 95), "This model holds nothing solid");
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("Build a solid and it will appear here.");
    ImGui::PopTextWrapPos();
    return true;
  }
  return false;
}

void ForgeFrame::selectBody(std::uint32_t bodyIndex) {
  const IrBuildReport& report = scene_.lastBuild();
  if (!shell_.selection().accepts(forge::ui::EntityKind::Face)) {
    note("the selection filter is set to something other than faces, so a body cannot be picked");
    return;
  }
  std::vector<forge::ui::EntityRef> refs;
  for (std::uint32_t faceId = 1; faceId < report.bodyOfFace.size(); ++faceId) {
    if (report.bodyOfFace[faceId] != bodyIndex) continue;
    forge::ui::EntityRef ref;
    ref.bodyId = activeBodyNode();
    ref.kind = forge::ui::EntityKind::Face;
    ref.persistentName = "face@" + std::to_string(faceId);
    refs.push_back(ref);
  }
  if (refs.empty()) return;
  // Through the SAME selection service a viewport click goes through, so a row
  // click and a pick produce one selection and not two competing ones.
  shell_.selection().replaceWith(refs);
  shell_.selection().setFocus(refs.front());
  syncSelectionToScene();
  note(bodyLabel(bodyIndex) + " picked: " + std::to_string(refs.size()) + " faces");
}

// ── BOM: what this model is made of ─────────────────────────────────────────
// One row per DISTINCT item, with how many of it there are. Identical bodies
// are folded together by comparing three independent measurements — volume,
// surface area and overall size — so a pattern of four blocks reads as one item
// with a quantity of four. Volume alone would fold together two different shapes
// that happen to displace the same material, which this programme has measured
// happening more than once.
void ForgeFrame::drawBomPanel() {
  bomRowsDrawn_ = 0;
  ImGui::TextColored(rgb(242, 158, 38), "Parts list");
  ImGui::Separator();
  if (drawAssemblyEmptyState()) return;

  const IrBuildReport& report = scene_.lastBuild();
  // Fold identical bodies into items, keeping every member so a row can select
  // and count what it stands for.
  std::vector<std::vector<std::uint32_t>> items;  // 1-based body indices
  for (std::size_t i = 0; i < report.bodies.size(); ++i) {
    bool placed = false;
    for (std::vector<std::uint32_t>& item : items) {
      if (sameShape(report.bodies[item.front() - 1], report.bodies[i])) {
        item.push_back(static_cast<std::uint32_t>(i + 1));
        placed = true;
        break;
      }
    }
    if (!placed) items.push_back({static_cast<std::uint32_t>(i + 1)});
  }

  double totalVolume = 0.0;
  double totalArea = 0.0;
  for (const SceneBody& b : report.bodies) {
    totalVolume += b.volume;
    totalArea += b.area;
  }
  ImGui::TextColored(rgb(130, 137, 148), "%zu bod%s, %zu different one%s", report.bodies.size(),
                     report.bodies.size() == 1 ? "y" : "ies", items.size(),
                     items.size() == 1 ? "" : "s");
  ImGui::Spacing();
  ImGui::Text("%-6s %-4s %-16s %-14s %s", "Item", "Qty", "Volume each mm3", "Surface mm2",
              "Size mm");
  ImGui::Separator();
  for (std::size_t i = 0; i < items.size(); ++i) {
    const std::vector<std::uint32_t>& item = items[i];
    const SceneBody& body = report.bodies[item.front() - 1];
    ImGui::PushID(static_cast<int>(i));
    // ONE Selectable holding the whole row, not a Selectable with columns drawn
    // beside it: clicking anywhere on a row picks the bodies it stands for in the
    // 3D view, which is the whole reason to have a parts list beside a model
    // rather than on a sheet of paper.
    char line[224];
    std::snprintf(line, sizeof(line), "%-6zu %-4zu %-16.3f %-14.3f %.2f x %.2f x %.2f", i + 1,
                  item.size(), body.volume, body.area, body.sizeX(), body.sizeY(), body.sizeZ());
    if (ImGui::Selectable(line)) selectBody(item.front());
    if (ImGui::IsItemHovered()) {
      // WHICH bodies this item stands for. An item with a quantity of four is
      // four rows in the Components list, and a user picking one wants to know
      // which. Named, not counted.
      std::string which;
      for (std::uint32_t index : item) {
        if (!which.empty()) which += ", ";
        which += bodyLabel(index);
      }
      ImGui::SetTooltip("%s", which.c_str());
    }
    ImGui::PopID();
    ++bomRowsDrawn_;
  }
  ImGui::Separator();
  ImGui::Text("Total    %.3f mm3 of material, %.3f mm2 of surface", totalVolume, totalArea);
}

// ── CONTACTS: what is touching what ─────────────────────────────────────────
// Every distance on this tab is the exact minimum distance between two solids,
// from the kernel's own distance solver, and every overlap is the volume of a
// real boolean between them. EVERY pair the kernel measured is listed, in three
// groups -- overlapping, touching, and everything else closest-first -- so a 4
// mm clearance is as visible as a contact.
//
// A model with more pairs than can be measured while somebody works has the
// CLOSEST measured and the rest left out, and the panel says so rather than
// letting a short list read as a complete one. Which ones get left out is not a
// guess: they are ordered by bounding-box gap, and a box gap is a LOWER BOUND on
// the true gap, so the ones dropped are provably the furthest apart.
void ForgeFrame::drawContactsPanel() {
  contactRowsDrawn_ = 0;
  ImGui::TextColored(rgb(242, 158, 38), "Contacts");
  ImGui::Separator();
  if (drawAssemblyEmptyState()) return;

  const IrBuildReport& report = scene_.lastBuild();
  if (report.bodies.size() < 2) {
    ImGui::TextColored(rgb(130, 137, 148), "This model is a single body");
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped(
        "Nothing touches anything, because there is only one body. Add a second shape without "
        "merging it into the first — a pattern, a mirror, or a union of two shapes that do not "
        "meet — and where the two bodies touch will be measured here.");
    ImGui::PopTextWrapPos();
    return;
  }

  std::vector<const SceneBodyPair*> interfering;
  std::vector<const SceneBodyPair*> touching;
  std::vector<const SceneBodyPair*> apart;
  for (const SceneBodyPair& pair : report.bodyPairs) {
    if (pair.interfering()) {
      interfering.push_back(&pair);
    } else if (pair.touching()) {
      touching.push_back(&pair);
    } else {
      apart.push_back(&pair);
    }
  }
  std::stable_sort(apart.begin(), apart.end(),
                   [](const SceneBodyPair* l, const SceneBodyPair* r) { return l->gap < r->gap; });

  // How many pairs EXIST is arithmetic on the body count, not a second number
  // from the kernel: N bodies is N(N-1)/2 pairs. Printing it beside how many
  // were measured is what stops a truncated list reading as a complete one.
  const std::size_t possiblePairs = report.bodies.size() * (report.bodies.size() - 1) / 2;
  ImGui::TextColored(rgb(130, 137, 148), "%zu of %zu pair%s measured across %zu bodies",
                     report.pairsEvaluated, possiblePairs, possiblePairs == 1 ? "" : "s",
                     report.bodies.size());
  if (report.pairsTruncated) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 190, 95),
                       "This model has more pairs of bodies than can be measured while you work, "
                       "so the closest ones were measured and the rest were not. Everything listed "
                       "below is exact; everything missing was further apart than all of it.");
    ImGui::PopTextWrapPos();
  }
  ImGui::Spacing();

  if (!interfering.empty()) {
    ImGui::TextColored(rgb(235, 105, 95), "Overlapping — these bodies share the same space");
    for (const SceneBodyPair* pair : interfering) {
      ImGui::PushID(static_cast<int>(contactRowsDrawn_));
      char line[160];
      std::snprintf(line, sizeof(line), "%s and %s     %.4f mm3 of shared material",
                    bodyLabel(pair->a).c_str(), bodyLabel(pair->b).c_str(),
                    pair->overlapVolume);
      if (ImGui::Selectable(line)) selectBody(pair->a);
      ImGui::PopID();
      ++contactRowsDrawn_;
    }
    ImGui::Spacing();
  }
  if (!touching.empty()) {
    ImGui::TextColored(rgb(120, 200, 130), "Touching");
    for (const SceneBodyPair* pair : touching) {
      ImGui::PushID(static_cast<int>(1000 + contactRowsDrawn_));
      char line[160];
      std::snprintf(line, sizeof(line), "%s and %s     meeting, no gap",
                    bodyLabel(pair->a).c_str(), bodyLabel(pair->b).c_str());
      if (ImGui::Selectable(line)) selectBody(pair->a);
      ImGui::PopID();
      ++contactRowsDrawn_;
    }
    ImGui::Spacing();
  }
  if (!apart.empty()) {
    ImGui::TextColored(rgb(130, 137, 148), "Clearances, closest first");
    for (const SceneBodyPair* pair : apart) {
      ImGui::PushID(static_cast<int>(2000 + contactRowsDrawn_));
      char line[160];
      std::snprintf(line, sizeof(line), "%s and %s     %.4f mm apart",
                    bodyLabel(pair->a).c_str(), bodyLabel(pair->b).c_str(), pair->gap);
      if (ImGui::Selectable(line)) selectBody(pair->a);
      ImGui::PopID();
      ++contactRowsDrawn_;
    }
  }
  if (contactRowsDrawn_ == 0) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped(
        "No two bodies of this model are close enough to each other to have been measured.");
    ImGui::PopTextWrapPos();
  }
}

// ── COMPONENTS: showing and hiding bodies ───────────────────────────────────
// The checkbox is the feature. It does not grey a row out and it does not filter
// a list: it removes the body from what the 3D view draws, from what a picking
// ray can hit and from what the Measure panel adds up, all three at once,
// because any other reading of "hidden" lies to somebody. The text box narrows
// the LIST only, and says so by leaving the hidden count alone.
void ForgeFrame::drawComponentFilterPanel() {
  componentRowsDrawn_ = 0;
  ImGui::TextColored(rgb(242, 158, 38), "Components");
  ImGui::Separator();
  if (drawAssemblyEmptyState()) return;

  const IrBuildReport& report = scene_.lastBuild();
  const std::size_t hidden = scene_.hiddenBodyCount();
  ImGui::TextColored(rgb(130, 137, 148), "%zu bod%s, %zu hidden, %zu of %zu triangles drawn",
                     report.bodies.size(), report.bodies.size() == 1 ? "y" : "ies", hidden,
                     scene_.triangleCount(), scene_.totalTriangleCount());
  if (ImGui::Button("Show all")) showEveryBody();
  ImGui::SameLine();
  if (ImGui::Button("Hide all")) hideEveryBody();
  ImGui::SetNextItemWidth(-1);
  ImGui::InputTextWithHint("##componentq", "find a body...", componentQuery_,
                           sizeof(componentQuery_));
  ImGui::Separator();

  for (std::size_t i = 0; i < report.bodies.size(); ++i) {
    const std::uint32_t index = static_cast<std::uint32_t>(i + 1);
    const std::string label = bodyLabel(index);
    if (!matchesFilter(label, componentQuery_)) continue;
    const SceneBody& body = report.bodies[i];
    ImGui::PushID(static_cast<int>(i));
    bool shown = scene_.bodyVisible(index);
    if (ImGui::Checkbox("##shown", &shown)) showBody(index, shown);
    ImGui::SameLine();
    // "Only" comes BEFORE the row text, because a Selectable with no width given
    // takes the whole rest of the line -- anything placed after it on the same
    // line is drawn off the right edge where nobody can click it.
    if (ImGui::SmallButton("Only")) showOnlyBody(index);
    ImGui::SameLine();
    char line[192];
    std::snprintf(line, sizeof(line), "%-8s %10.3f mm3   %.2f x %.2f x %.2f mm   %u faces",
                  label.c_str(), body.volume, body.sizeX(), body.sizeY(), body.sizeZ(),
                  body.faceCount);
    if (ImGui::Selectable(line)) selectBody(index);
    ImGui::PopID();
    ++componentRowsDrawn_;
  }
  if (componentRowsDrawn_ == 0) {
    ImGui::TextDisabled("no body matches \"%s\"", componentQuery_);
  }
}

// ── MATES: how the bodies line up ───────────────────────────────────────────
//
// ★ READ THIS BEFORE CHANGING THE PANEL. What is listed here is MEASURED off the
// model, not stored in it. A Forge document holds a feature history; it does not
// hold assembly constraints, nothing in the application authors one, and this
// panel therefore does not pretend to list any. What it does instead is answer
// the question a mate is for — is my pin actually concentric with my hole, are
// these two plates actually flush — exactly, from the kernel's own surfaces: two
// round faces on different bodies turning about one axis, two flat faces on
// different bodies lying in one plane, and how far off each one really is.
//
// The panel says all of that IN THE PANEL, in the user's words, because a row
// that reads like a constraint the user set is a row they will try to delete.
void ForgeFrame::drawMatesPanel() {
  mateRowsDrawn_ = 0;
  ImGui::TextColored(rgb(242, 158, 38), "How the bodies line up");
  ImGui::Separator();
  if (drawAssemblyEmptyState()) return;

  const IrBuildReport& report = scene_.lastBuild();
  ImGui::PushTextWrapPos(0.0f);
  ImGui::TextColored(rgb(130, 137, 148),
                     "Measured from the model as it is now, not rules you have set. Nothing here "
                     "can be edited or deleted; change the model and it is measured again.");
  ImGui::PopTextWrapPos();
  ImGui::Spacing();

  if (report.bodies.size() < 2) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped(
        "This model is a single body, so there is nothing for it to line up with. Add a second "
        "shape without merging it into the first, and the axes and the faces the two of them "
        "share will be listed here.");
    ImGui::PopTextWrapPos();
    return;
  }

  for (const SceneBodyAlignment& al : report.alignments) {
    ImGui::PushID(static_cast<int>(mateRowsDrawn_));
    char line[256];
    if (al.kind == BodyAlignment::Concentric) {
      std::snprintf(line, sizeof(line),
                    "Concentric  %s with %s   axis (%.2f, %.2f, %.2f) through "
                    "(%.3f, %.3f, %.3f)   %.4f mm off",
                    bodyLabel(al.a).c_str(), bodyLabel(al.b).c_str(), al.direction[0],
                    al.direction[1], al.direction[2], al.point[0], al.point[1], al.point[2],
                    al.deviation);
    } else {
      std::snprintf(line, sizeof(line),
                    "Flush       %s with %s   faces normal to (%.2f, %.2f, %.2f) at "
                    "(%.3f, %.3f, %.3f)   %.4f mm apart",
                    bodyLabel(al.a).c_str(), bodyLabel(al.b).c_str(), al.direction[0],
                    al.direction[1], al.direction[2], al.point[0], al.point[1], al.point[2],
                    al.deviation);
    }
    if (ImGui::Selectable(line)) selectBody(al.a);
    ImGui::PopID();
    ++mateRowsDrawn_;
  }
  if (mateRowsDrawn_ == 0) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped(
        "None of the bodies in this model shares an axis or a plane with another one. Put a "
        "round face of one on the same axis as a round face of another, or two flat faces on the "
        "same plane, and it will be measured here.");
    ImGui::PopTextWrapPos();
  }
}

void ForgeFrame::drawGenericPanel(const std::string& panelId) {
  // ── WHAT THIS PANEL USED TO SAY, VERBATIM ─────────────────────────────────
  //
  //   Panel "mates" is docked and laid out by forge::ui::DockLayout, and its
  //   position, tab order and active tab persist across restart. Its content is
  //   not implemented in this segment.
  //
  // Twenty-seven tabs across the eight workspaces drew that, unchanged, in a
  // shipped build. It named a C++ class, described the program's serialisation
  // guarantees, and closed with a note about somebody's development schedule --
  // and in doing so it never once said what a Mates panel IS. A user who opens
  // a tab is asking one question and it answered a different one.
  //
  // What replaces it is DATA, from forge::ui::panelCatalog(): the panel's name
  // and one sentence, written for the person reading it, saying what this tab
  // will show them. ui/test/user_facing_text_test.cpp proves every panel the
  // shipped workspaces define has such a sentence, that the sentence names no
  // class and no library, and that the "not built yet" claim below matches this
  // function's own dispatch -- so a panel that GAINS content and forgets to say
  // so turns CI red rather than apologising to a user for work already done.
  const forge::ui::PanelInfo* info = forge::ui::findPanelInfo(panelId);
  const std::string title =
      info != nullptr ? info->name : forge::ui::panelDisplayName(panelId);
  ImGui::TextColored(rgb(242, 158, 38), "%s", title.c_str());
  ImGui::Separator();
  if (info != nullptr) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("%s", info->purpose.c_str());
    ImGui::PopTextWrapPos();
    ImGui::Spacing();
    ImGui::TextDisabled("Not built yet. This tab keeps its place in your layout, and your");
    ImGui::TextDisabled("work is unaffected by it being empty.");
  } else {
    // A layout saved by a newer build can name a panel this one has never heard
    // of. Saying so plainly beats inventing a description for it.
    ImGui::TextWrapped("This tab came from a saved layout and this version of Forge does not "
                       "know what it holds. You can close it, or open it again in the version "
                       "that made it.");
  }
  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "What you can do from this workspace now:");
  // ribbonSurface_, NOT a second walk of the registry. This function used to
  // call ribbonCategories(shell_.workspace(), registry().categories()) and then
  // registry().idsInCategory(cat) itself -- the same enumeration the ribbon
  // does, written a second time, in the file CI did not compile. It was a
  // SEPARATE COPY of the menu in every way that matters: it listed commands the
  // selection cannot run with no indication that it cannot, because it never
  // consulted the enabled predicate, and it would have kept listing a command
  // the ribbon had stopped showing.
  //
  // The no-second-enumeration gate did not catch it, and that is the more
  // interesting half: the gate checked four function names it held in a
  // hand-written list, and this is a fifth. Delegating in the four functions
  // someone remembered to list, while a fifth walks the registry, is exactly the
  // drift the gate exists to prevent. That list is now a CENSUS -- see
  // ui/test/app_surface_reachability_test.cpp.
  //
  // The panel is a docked surface with no content, so it shows availability
  // rather than acting: a button here would be a fourth invocation path into a
  // panel that explicitly says it is not implemented.
  for (const forge::ui::SurfaceGroup& group : ribbonSurface_.groups) {
    for (const forge::ui::SurfaceItem& item : group.items) {
      const bool on = item.enabled() || item.opensDialog();
      ImGui::BulletText("%s", item.label.c_str());
      if (!on && !item.hint.empty()) {
        ImGui::SameLine();
        ImGui::TextColored(rgb(130, 137, 148), "-- %s", item.reason.c_str());
      }
    }
  }
}

// ── command palette ─────────────────────────────────────────────────────────
// ── the parameter prompt ────────────────────────────────────────────────────
// A PLAIN WINDOW, not an ImGui modal, and deliberately so. A modal grabs input
// for as long as it is open, which would make every other surface in the app
// unreachable while it stands -- including the Command Palette a user would
// naturally reach for to do something else. It is drawn after the dock walk, in
// the same place and for the same reason as the palette.
//
// Run is DEFERRED like every other mutation in this class: it dispatches a
// command that can rebuild the document, the feature tree and the scene, and the
// feature tree is the container the walk indexes.
void ForgeFrame::drawParameterPrompt() {
  if (!promptOpen_) return;
  const forge::ui::CommandDescriptor* d = shell_.registry().find(promptCommand_);
  const std::string label = (d != nullptr && !d->label.empty()) ? d->label : promptCommand_;
  const ImGuiIO& io = ImGui::GetIO();
  const float w = std::min(520.0f * dpiScale_, io.DisplaySize.x * 0.6f);
  ImGui::SetNextWindowPos(ImVec2((io.DisplaySize.x - w) * 0.5f, io.DisplaySize.y * 0.28f),
                          ImGuiCond_Appearing);
  ImGui::SetNextWindowSize(ImVec2(w, 0));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12, 10));
  bool open = true;
  if (ImGui::Begin("Command needs a value", &open,
                   ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoCollapse |
                       ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::TextColored(rgb(242, 158, 38), "%s", label.c_str());
    ImGui::Separator();
    // WHY it is asking, in the schema's own terms. "There is no honest default
    // for this" is the whole reason a prompt exists rather than a default, and a
    // box with no explanation is a box a user guesses at.
    ImGui::TextWrapped(
        "There is no sensible default for the value%s below, so Forge cannot fill %s in "
        "for you. Type %s and press Run.",
        promptFields_.size() == 1 ? "" : "s", promptFields_.size() == 1 ? "it" : "them",
        promptFields_.size() == 1 ? "it" : "them");
    ImGui::Spacing();

    bool submitted = false;
    for (std::size_t i = 0; i < promptFields_.size(); ++i) {
      PromptField& f = promptFields_[i];
      ImGui::PushID(static_cast<int>(i));
      ImGui::TextUnformatted(f.name.c_str());
      ImGui::SameLine(150.0f * dpiScale_);
      ImGui::SetNextItemWidth(-1);
      if (!promptFocus_ && i == 0) {
        ImGui::SetKeyboardFocusHere();
        promptFocus_ = true;
      }
      if (ImGui::InputText("##v", f.value.data(), f.value.size(),
                           ImGuiInputTextFlags_EnterReturnsTrue)) {
        submitted = true;
      }
      ImGui::PopID();
    }

    ImGui::Spacing();
    if (ImGui::Button("Run")) submitted = true;
    ImGui::SameLine();
    if (ImGui::Button("Cancel")) open = false;
    if (ImGui::IsKeyPressed(ImGuiKey_Escape)) open = false;
    if (submitted) pendingPromptSubmit_ = true;
  }
  ImGui::End();
  ImGui::PopStyleVar();
  if (!open) cancelPrompt();
}

void ForgeFrame::drawCommandPalette() {
  if (!paletteOpen_) return;
  const ImGuiIO& io = ImGui::GetIO();
  const float w = std::min(680.0f * dpiScale_, io.DisplaySize.x * 0.7f);
  ImGui::SetNextWindowPos(ImVec2((io.DisplaySize.x - w) * 0.5f, io.DisplaySize.y * 0.16f));
  ImGui::SetNextWindowSize(ImVec2(w, 0));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12, 10));
  if (ImGui::Begin("Command Palette", &paletteOpen_,
                   ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoCollapse |
                       ImGuiWindowFlags_AlwaysAutoResize)) {
    if (!paletteFocus_) {
      ImGui::SetKeyboardFocusHere();
      paletteFocus_ = true;
    }
    ImGui::SetNextItemWidth(-1);
    ImGui::InputTextWithHint("##q", "search commands...", paletteQuery_, sizeof(paletteQuery_));

    // The registry's OWN ranked search, through the same surface builder as
    // every other view — not a second matcher. Whatever the palette can find, a
    // macro and an Archie tool call can find by the same ID, and it is ranked in
    // exactly the order CommandRegistry::search() returns.
    const forge::ui::CommandSurface hits =
        forge::ui::buildPaletteSurface(surfaceContext(), paletteQuery_, 14);
    // A query nothing matches produces a surface with NO groups, so the rows are
    // read out of a function-local empty vector rather than groups[0]. Not a
    // heap allocation: this runs once a frame while the palette is open, and a
    // `new` here would leak a vector per frame for as long as it stayed open.
    static const std::vector<forge::ui::SurfaceItem> kNoRows;
    const std::vector<forge::ui::SurfaceItem>& rows =
        hits.groups.empty() ? kNoRows : hits.groups[0].items;
    if (rows.empty()) {
      ImGui::TextDisabled("no command matches");
    } else {
      paletteIndex_ = std::clamp(paletteIndex_, 0, static_cast<int>(rows.size()) - 1);
      if (ImGui::IsKeyPressed(ImGuiKey_DownArrow)) ++paletteIndex_;
      if (ImGui::IsKeyPressed(ImGuiKey_UpArrow)) --paletteIndex_;
      paletteIndex_ = std::clamp(paletteIndex_, 0, static_cast<int>(rows.size()) - 1);
    }
    ImGui::Separator();
    for (std::size_t i = 0; i < rows.size(); ++i) {
      const forge::ui::SurfaceItem& item = rows[i];
      const bool on = item.enabled() || item.opensDialog();
      const bool cursor = (static_cast<int>(i) == paletteIndex_);
      ImGui::PushID(static_cast<int>(i));
      ImGui::BeginDisabled(!on);
      const std::string label = item.opensDialog() ? (item.label + "...") : item.label;
      if (ImGui::Selectable(label.c_str(), cursor) ||
          (cursor && ImGui::IsKeyPressed(ImGuiKey_Enter))) {
        invoke(item.commandId);
        paletteOpen_ = false;
      }
      ImGui::EndDisabled();
      // WHY a row is unavailable, in the row. A palette that lists a command and
      // greys it with no reason is a list of things that do not work.
      if (!on && ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
        ImGui::SetTooltip("%s", item.hint.c_str());
      }
      // The middle column used to be the command id ("part.counterbore") on
      // every row of the palette. The category is what a user is scanning for.
      ImGui::SameLine(ImGui::GetContentRegionAvail().x * 0.55f);
      ImGui::TextDisabled("%s", item.category.c_str());
      ImGui::SameLine(ImGui::GetContentRegionAvail().x * 0.85f);
      ImGui::TextColored(on ? rgb(120, 200, 130) : rgb(140, 140, 150), "%s",
                         on ? item.shortcut.c_str() : forge::ui::toString(item.availability));
      ImGui::PopID();
    }
    if (ImGui::IsKeyPressed(ImGuiKey_Escape)) paletteOpen_ = false;
  }
  ImGui::End();
  ImGui::PopStyleVar();
  if (!paletteOpen_) paletteFocus_ = false;
}

}  // namespace forge::desktop
