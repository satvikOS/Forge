#include "ForgeFrame.hpp"

#include "PartFile.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include <sys/stat.h>
// getpid(), for the recovery SESSION ID. A marker is evidence of a live process,
// so its name has to be unique to one -- see beginRecoverySession().
#include <unistd.h>

#include "imgui.h"

#include "Camera.hpp"
// For inputFileState: whether the file a saved document names can still be read
// AS A MODEL. It is answered in the translation unit that owns the content sniff
// the kernel itself performs, so the Open and the rebuild cannot disagree about
// what a STEP file is. The header declares no kernel type.
#include "FileExchangeHost.hpp"
#include "ImGuiErrorPolicy.hpp"
#include "KernelScene.hpp"
#include "StudyHost.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/Drawing.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/InspectionReport.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PanelCatalog.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/RecentDocuments.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"
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

  camera_.setIsometric();
  // THE FIRST BUILD -- the one framing this application performs without being
  // asked for it. It is a framing ONLY IF THERE WAS A BODY. A window that opens
  // on a kernel failure has an INVALID bounding box, and Camera::frame() on that
  // puts the camera at the origin at a default distance, which is not a framing
  // of anything -- yet it was COUNTED as one: cameraRefits_ read 1 for a window
  // that had framed nothing, and then 2 when the first real body arrived and was
  // framed for the first and only time. That count is the instrument every check
  // in camera_stability_gate reads, so a count including a framing that did not
  // happen is an instrument lying about the one thing it measures.
  //
  // What did not happen here is OWED to the first build that does produce
  // geometry, and the latch below is what carries it into syncSceneToDocument().
  if (scene_.bounds().valid) {
    float c[3] = {0.0f, 0.0f, 0.0f};
    scene_.bounds().centre(c);
    camera_.frame(c, scene_.bounds().radius());
    ++cameraRefits_;
  }
  refitCameraPending_ = !scene_.bounds().valid;
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
  //
  // ★ MEASURED DEFECT, fixed here. This line read
  //
  //     scene.bodyId = treeSource_.rootId();
  //
  // and it COMPILED, warning-clean under -Wall -Wextra -Werror, because
  // forge::ui::NodeId is a std::uint64_t and PickScene::bodyId is a std::string:
  // the assignment binds std::string::operator=(char) through an integral
  // conversion, so the root node id 1 became the ONE-CHARACTER string "\x01".
  // Every ref this application produces carries a DOCUMENT NODE name in bodyId
  // (clickFace, clickEdge and clickFeature all set it from activeBodyNode() or
  // from PartDocument::nodeFor), so selectionBounds' body check compared
  // "body.bracket" against "\x01", found them different, and counted EVERY
  // picked entity unresolved. `view.selection` therefore refused every real
  // selection with "the N picked item(s) are not on the part that is on screen"
  // and the camera never moved -- for faces, edges and bodies alike.
  //
  // It is the node the refs are actually stamped with, and NOT the empty string:
  // an empty scene id disables the body check altogether, which would frame a
  // ref belonging to some other body rather than refusing it, and framing the
  // wrong body is worse than refusing.
  scene.bodyId = activeBodyNode();

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
  // AND THE SECOND ONE THIS OBJECT IS: the source of the posted machine program,
  // so file.export_gcode can write what the Post Output tab shows. Installed HERE
  // rather than in main.cpp -- unlike FileExchangeHost, which is a separate
  // object the application owns, this source IS the frame, so every build that
  // has a frame has it, including every headless gate. A seam wired only in
  // main.cpp is a seam no gate exercises.
  shell_.setMachineProgramSource(this);
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

// ── THE ONE PLACE A DOCUMENT EVENT REACHES THE CAMERA ───────────────────────
//
// Framing is a DOCUMENT event, not a mesh event. documentNew(), documentOpen()
// and documentReset() raise refitCameraPending_; this is the only thing that
// lowers it, and syncSceneToDocument() calls it on BOTH of its exits.
//
// That "both" is the repair. The first version consumed the latch only on the
// rebuild path, and syncSceneToDocument() returns EARLY whenever the program it
// is handed equals the one already built. Re-opening the file that is already
// open produces exactly that, and so does File > New on an untouched starter
// part: the framing the open asked for never happened, the request stayed armed,
// and the user's NEXT PLAIN EDIT collected it and threw their pan and zoom away.
// MEASURED before this: open, open the same file again, nudge one dimension ->
// target (-1.099, 11.116, 51.765) -> (0, 0, 45), distance 189.48 -> 813.18. The
// original defect, surviving on the one path that skipped the rule.
//
// THE REQUEST IS KEPT, NOT CONSUMED, WHEN THERE ARE NO BOUNDS. An empty document
// has no sphere to frame -- applyPendingFit() refuses for the same reason -- and
// File > Import STEP depends on it: runImport calls documentReset(), which
// empties the document and builds nothing, and only THEN writes the INPUT()
// statement that produces the body the camera is supposed to land on.
void ForgeFrame::applyDocumentRefit(bool sceneShowsTheDocument) {
  if (!refitCameraPending_ || !sceneShowsTheDocument || !scene_.bounds().valid) return;
  float centre[3] = {0.0f, 0.0f, 0.0f};
  scene_.bounds().centre(centre);
  camera_.frame(centre, scene_.bounds().radius());
  refitCameraPending_ = false;
  ++cameraRefits_;
}

// ── the document -> geometry edge ───────────────────────────────────────────
bool ForgeFrame::syncSceneToDocument() {
  const std::string program = partDoc_.irProgram();
  // Guard on what was last ATTEMPTED, not on what last BUILT. A program the kernel
  // refused is still "already tried", and retrying it every frame is a spin.
  if (program == lastAttemptedProgram_) {
    // ...but A DOCUMENT EVENT THAT LANDS ON AN IDENTICAL PROGRAM IS STILL A
    // DOCUMENT EVENT. The rebuild is correctly skipped -- the scene already
    // shows this exact body -- while the FRAMING that event asked for has not
    // happened yet, and applyDocumentRefit() is the only thing that performs it.
    // Not calling it here is what kept the original defect alive: the request
    // stayed armed and the user's next plain edit collected it.
    //
    // The scene shows this document only if the last attempt at this same
    // program SUCCEEDED, and rebuildError_ is that record. Asking the BOUNDS
    // instead would be wrong in the one case that matters: documentReset()
    // empties the document, the empty program does not build, and the viewport
    // goes on holding the previous body -- valid bounds, radius 269.26 mm,
    // belonging to the part just thrown away. MEASURED: framing on bounds alone
    // re-framed an EMPTIED document onto its predecessor.
    //
    // WHERE THIS RUNS, stated exactly, because the sentence that stood here
    // ("costs nothing ... every frame but a handful") implied it was cheap by
    // implying it was rare, and it is neither rare nor the only cost.
    // syncSceneToDocument() is called once per FRAME from build() and again from
    // every document-event path, and this branch -- taken whenever the document
    // has not changed -- is the frame loop's NORMAL case. What the call below
    // adds there is one std::string::empty() and a function that returns on its
    // first test of refitCameraPending_. What dominates this function on those
    // same frames is the irProgram() rebuild at the top of it, which predates
    // this change and is untouched by it.
    applyDocumentRefit(rebuildError_.empty());
    return false;
  }

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

  // ── THE TRANSACTION BOUNDARY (doc 00 stage 4, doc 04's rollback rule) ────
  // builtProgram_ is the answer to "what is the scene showing", and on a failed
  // rebuild the scene is still showing the LAST GOOD body -- the branch below says
  // so itself: "The previous body stays on screen". Assigning it unconditionally
  // made it name a program that never built, so the staleness witness, the quality
  // report and the next edit all compared against something that does not exist.
  //
  // The failing statement STAYS in the document, deliberately. That is what every
  // history-based CAD system does with a failed feature, and this file already
  // says so. Rolling the document back was my first attempt and it is wrong: it
  // deletes the user's edit instead of letting them fix it, and it breaks the one
  // property doc 04 actually asks for -- the USER-VISIBLE MODEL must not be
  // partially mutated, which it is not, because the viewport keeps the last good
  // body either way.
  lastAttemptedProgram_ = program;
  if (ok) {
    builtProgram_ = program;
  }
  ++rebuilds_;
  documentDirty_ = true;
  // STILL UNCONDITIONAL, and deliberately: this is the host's "re-upload the
  // vertex buffer" latch, and the tessellation it describes has been replaced
  // whether or not the kernel liked the result. What was WRONG was the second
  // duty main.cpp hung off this same flag -- see below.
  geometryDirty_ = true;

  // ── FRAMING IS A DOCUMENT EVENT, NOT A REBUILD EVENT ─────────────────────
  // main.cpp's frame loop read geometryDirty and re-framed the camera, so every
  // rebuild -- a fillet radius nudged by 0.5 mm, an undo, a FAILED rebuild that
  // left the screen untouched -- threw the user's pan and zoom away. Measured:
  // target (-1.457, -3.397, 12.106) -> (0, 0, 10), distance 108.87 -> 144.90,
  // on a rebuild that changed one number, and again on one that built nothing.
  //
  // Three conditions, all three still required. `ok` is answered HERE, because
  // it is about the rebuild that just ran; the other two are answered inside
  // applyDocumentRefit(), which the identical-program exit above also calls --
  // and that shared call site is the repair, because the two exits differing was
  // the whole defect.
  //   ok                      a rebuild that FAILED has not changed what is on
  //                           screen, so there is nothing new to frame and
  //                           moving the camera is pure loss.
  //   refitCameraPending_     only the first build, an open, a New, or a reset
  //                           (the Import path) raises it. A plain edit never
  //                           does -- and nothing but applyDocumentRefit() ever
  //                           lowers it, which is the property that was broken.
  //   bounds().valid          an empty document has no sphere to frame.
  applyDocumentRefit(ok);
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

// One snapshot, taken by a gesture that is ABOUT to throw a document away
// without asking. `what` names the gesture in the log, so a user reading it
// afterwards can tell which click cost them the work.
void ForgeFrame::autosaveDiscardedWork(const char* what) {
  if (!documentDirty_) return;
  if (recovery_ == nullptr || !recovery_->active()) return;
  if (!autosaveNow()) return;
  shell_.log().info("Autosave",
                    "Forge kept a spare copy of the part you had open before this one, in "
                    "case you did not mean to leave it.",
                    std::string(what) + " replaced a document with unsaved changes; the copy is " +
                        recovery_->autosavePath());
}

// ── THE SNAPSHOT NEW AND OPEN TAKE ON THE WAY PAST ──────────────────────────
//
// ★ STATED PLAINLY, BECAUSE IT IS A HOLE AND NOT A FIX: File > New and File >
//   Open REPLACE a document with unsaved changes and NEITHER ASKS. That is the
//   same silent discard the quit guard exists for, one gesture over, and this
//   change does not close it -- there is no prompt here.
//
// What there IS, from this line, is the snapshot. Both replacements take one
// FIRST, so the discarded work is on disk rather than gone at the instant of the
// click. The promise is smaller than a prompt and it is worth stating EXACTLY,
// because the first version of this sentence overstated it. The window closes in
// TWO ways, not one:
//   * the replacement document is itself edited and the fifteen-second cadence
//     writes over the same autosave; and
//   * ANY CLEAN QUIT. grantQuit() calls endRecoverySession(), which removes the
//     marker, the autosave AND the drawing beside it, and requestQuit() runs
//     autosaveNow() before it -- which does nothing on a document that is not
//     dirty. So New, then close the window: NOTHING IS LEFT AT ALL.
// It is a window, not a guarantee, and section 14 of the quit gate now measures
// both of its edges rather than stating one of them.
bool ForgeFrame::documentNew(std::string& error) {
  autosaveDiscardedWork("New");
  partDoc_.restore(forge::ui::PartDocument::Snapshot{});  // records -> 0, bindings cleared
  // A NEW part came from no file. Without this the scene kept whatever the last
  // import bound, and a Save that stated an imported solid wrote that path into
  // a document which had never seen it -- MEASURED.
  bindInputFile(std::string());
  // Snapshot does NOT carry the material -- deliberately, so undoing a fillet
  // cannot change what the part is made of -- which means restore() leaves the
  // old one behind. A NEW document has not been given a material, and saying it
  // is aluminium because the last one was would put a weight on it that nobody
  // chose.
  partDoc_.setMaterial(forge::ui::unassignedMaterial());
  partUndo_.clear();
  if (!seedDefaultPart(error)) return false;
  documentPath_.clear();
  documentName_ = "untitled";
  // The refused-path memory belongs to the RECOVERED document, and this gesture
  // has just thrown that document away. Dropping it here costs nothing: the
  // untitled fallback still will not write over a file that exists, and this new
  // part has no claim on a name a previous document was refused.
  refusedSavePath_.clear();
  // A new document gets a new drawing: keeping the last one's title block would
  // put somebody else's part number and revision on a part that has neither.
  drawing_ = forge::ui::DrawingModel{};
  drawingLayoutBuilt_ = false;
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  // A DIFFERENT PART. The camera was framed on the one being thrown away, and
  // its distance has nothing to do with the starter part's size.
  refitCameraPending_ = true;
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
// ── THE DOCUMENT'S INPUT BINDING, SET IN ONE PLACE ──────────────────────────
//
// BOTH holders are told, and neither line is redundant. The scene's copy is what
// the viewport rebuild compiles with, and it is set DIRECTLY because the
// exchange is optional: main.cpp installs it after wirePartCommands, and a
// headless configuration runs with none at all. The exchange keeps its own copy
// and that is the one "Save a Copy as STEP" compiles with, so telling only the
// scene is a fix that draws the right part and cannot export it.
//
// ★ IT HAS A LIFETIME, AND THAT IS THE POINT. The binding is a fact about THE
//   DOCUMENT NOW OPEN, so everything that replaces or empties the document
//   passes through here -- an open, an import, File > New, a reset. MEASURED
//   when it did not: import a part, File > New, state an imported solid, Save,
//   and the .fpart named the file the FIRST part was built from, because the
//   scene was still holding it and nothing had ever cleared it.
void ForgeFrame::bindInputFile(const std::string& path) {
  scene_.setInputFile(path);
  if (shell_.fileExchange() != nullptr) shell_.fileExchange()->bindInputFile(path);
}

bool ForgeFrame::documentReset(std::string& error) {
  error.clear();
  partDoc_.restore(forge::ui::PartDocument::Snapshot{});  // records -> 0, bindings cleared
  partUndo_.clear();
  // The emptied document is bound to nothing. ForgeShell::runImport re-binds
  // immediately after this returns, because an import BINDS A FILE and then
  // empties the document to state it -- the binding belongs to the document it
  // is about to build, not to the one being thrown away.
  bindInputFile(std::string());
  // ── MERGE 2026-09-12: the two parents DISAGREED about `builtProgram_.clear()`
  //    here, and one of them had MEASURED it. The import parent added it saying
  //    "the scene is rebuilt from an EMPTY program, so the viewport shows an
  //    empty document"; the camera parent answered that the empty program does
  //    not build, the viewport goes on holding the previous body, and clearing
  //    the name therefore made builtProgram_ -- the answer to "what is the scene
  //    showing" -- say nothing while the scene showed something. It forced no
  //    rebuild either way: syncSceneToDocument() guards on lastAttemptedProgram_.
  //    The measured side wins and the line is GONE. The binding clear above is
  //    the import parent's actual fix and is untouched.
  refitCameraPending_ = true;
  // Raised here and NOT consumed by the empty build that follows -- an empty
  // document has no bounds to frame. It is the caller's next statement that
  // collects it, which is what File > Import STEP needs: runImport resets the
  // document and then writes an INPUT() naming a body this window has never
  // seen. app.load_sample takes the same route.
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

// A Flag parameter, as a person types it. "off", "no", "false", "0" and an empty
// box are off; anything else is on. Accepting only "1" would make every other
// spelling of yes read as OFF, silently, which is the failure mode a checkbox
// exists to avoid -- and the sheet writes these back through setFlag, so the
// handler's params().flag() sees a real bool either way.
bool flagFromText(const char* text) {
  if (text == nullptr) return false;
  std::string v;
  for (const char* p = text; *p != '\0'; ++p) {
    if (std::isspace(static_cast<unsigned char>(*p)) != 0) continue;
    v.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(*p))));
  }
  if (v.empty()) return false;
  return !(v == "0" || v == "off" || v == "no" || v == "false");
}

// A number in the SHORTEST form that reads back as the same number. %g and not
// %f, because "40.000000" in a dimension box is six characters of noise a user
// has to delete before typing 11.
std::string numberForBox(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%g", v);
  return buf;
}

// Is an EMPTY box for this parameter the same as not mentioning it at all?
// `required = false, hasDefault = false` is the schema's way of saying the
// handler carries its own fallback and the emitted statement OMITS the argument
// -- a box's centre, a cylinder's axis, a chamfer's selector. Without this, a
// sheet that offers those boxes (and it must, they were unreachable) would write
// a 0 into every one of them and BOX(40,30,20) would become BOX(40,30,20,0,0,0)
// on every click, which is a different statement from the one the op vocabulary
// records as this command's minimal form.
//
// It deliberately does NOT cover required parameters. `path` and `value` are
// required with no default; an empty box there is a value the user cleared, and
// dropping it silently would re-open the sheet instead of reporting the refusal.
bool omittableWhenBlank(const forge::ui::CommandDescriptor* d, const std::string& name) {
  if (d == nullptr) return false;
  for (const forge::ui::ParamSpec& p : d->schema) {
    if (p.name != name) continue;
    return !p.required && !p.hasDefault;
  }
  return false;
}

// The folder a path lives in, and the name inside it. "" when the path names no
// folder, which is what a bare file name does.
std::string folderOf(const std::string& path) {
  const std::size_t slash = path.find_last_of('/');
  if (slash == std::string::npos) return std::string();
  return slash == 0 ? std::string("/") : path.substr(0, slash);
}

std::string leafOf(const std::string& path) {
  const std::size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

// ── WHERE TO LOOK FOR A DOCUMENT'S SOURCE FILE ──────────────────────────────
//
// In order, and never more than two places:
//
//   1. the path the file records. Absolute since format version 4; a relative
//      one predates that or was hand-written, and the only directory a path
//      INSIDE a document can sensibly be relative to is the document's own.
//   2. ★ THE SAME NAME, BESIDE THE DOCUMENT. This is the ordinary case, not a
//      recovery: people copy a job folder, or rename it, or take it home on a
//      stick, and the .step travels with the .fpart because they are in the
//      same folder. MEASURED before this existed: renaming the folder made the
//      part refuse to open, naming its OLD absolute path, while the file it
//      wanted sat right beside the document it was refusing.
//
// It is a SEARCH OF TWO NAMED PLACES and deliberately not a search: guessing at
// any file of the right type nearby is how a part quietly opens against the
// wrong solid.
//
// ★ A DOCUMENT PATH THAT NAMES NO FOLDER IS NOT A DOCUMENT WITH NO FOLDER.
//   folderOf("part.fpart") is "", and the first version of this function read
//   that as "there is nowhere beside this document to look" -- so it skipped
//   place 2 entirely for a BARE RELATIVE NAME. That is not a corner: main.cpp
//   dispatches a command-line path AS TYPED, so `forge part.fpart` arrives here
//   exactly that way, and it is the natural way to open a job folder you have
//   just cd'd into. MEASURED with "" left as "no folder": rename a job folder,
//   cd in, open "part.fpart" -- REFUSED, with part.step sitting in the working
//   directory, while the SAME part opened by absolute path worked. The folder a
//   bare name lives in is the working directory, and its name is ".".
std::vector<std::string> inputFileCandidates(const std::string& recorded,
                                             const std::string& documentPath) {
  std::vector<std::string> out;
  if (recorded.empty()) return out;
  const std::string named = folderOf(documentPath);
  const std::string folder = named.empty() ? std::string(".") : named;
  if (recorded[0] == '/') {
    out.push_back(recorded);
  } else {
    out.push_back(folder == "/" ? "/" + recorded : folder + "/" + recorded);
  }
  const std::string beside =
      folder == "/" ? "/" + leafOf(recorded) : folder + "/" + leafOf(recorded);
  if (std::find(out.begin(), out.end(), beside) == out.end()) out.push_back(beside);
  return out;
}

// ── THE UNTITLED FALLBACK MAY ONLY EVER CREATE A FILE ───────────────────────
//
// ★ WHAT THIS EXISTS FOR, MEASURED ON RAW BYTES. documentSave() with no path of
//   its own rebuilds a target out of the document's NAME, and documentNew() sets
//   that name back to "untitled" for every new part -- so the SECOND bare Ctrl+S
//   of a session reconstructs the FIRST one's path exactly, and savePartFile()
//   had no existence check of any kind. Ctrl+S, Ctrl+N, model, Ctrl+S took a
//   file holding 1 NOTE / 6 FEATURE / 764 bytes to 0 NOTE / 7 FEATURE / 801
//   bytes -- a DIFFERENT PART, under the first one's name, with "PART ONE -- DO
//   NOT DELETE" gone out of it. No panel, no prompt, no line in the log at all.
//   Both keys are bound in all four keymap
//   profiles and forge_desktop_file_dialog_gate section 5 pins that Ctrl+S
//   raises nothing, so there was never anything in the way.
//
//   The same arithmetic is why a recovery's staleness guard did not pay:
//   recoverFromAutosave() clears the PATH and keeps the NAME, and this function
//   rebuilt, out of that name, the very path the guard had just refused.
//
// WHY A FREE NAME AND NOT A REFUSAL. A refusal was the other candidate and it is
// the wrong one here: a bare Ctrl+S must always finish. Save and Close routes
// through this exact call with nowhere to put the part (quit_guard section 13),
// so a save that declines leaves the work in memory on the way out of the
// application; and raising a panel instead is pinned shut by the file-dialog
// gate, deliberately, because Ctrl+S is not allowed to become a modal. Picking
// the first FREE name costs nothing and loses nothing: the part is written, no
// existing file is touched, and note() names the file it actually wrote so the
// user is not left guessing which one it is.
//
// `forbidden` is a path that must be skipped even when nothing is sitting on it
// -- see refusedSavePath_. A user told to keep their own file while they compare
// it will move that file aside, and a fallback that only asked "is there a file
// here?" would hand the refused name straight back the moment they did.
// `swerved` is set when the FIRST name in the series was not the one returned --
// i.e. when something really was in the way. It is what the warning below is
// conditioned on, and it is NOT the same question as "is this the name the
// document was called": a document called "untitled-4" whose own file is gone
// is written as untitled.fpart, which is the series behaving, not a collision.
std::string firstFreeFallbackPath(const std::string& directory, const std::string& stem,
                                  const std::string& forbidden, bool& swerved,
                                  std::string& firstChoice) {
  std::string base = stem.empty() ? std::string("untitled") : stem;
  // A name this function itself produced goes back into the SERIES it came from
  // rather than growing a second tail: "untitled-4" asks for "untitled-5", not
  // "untitled-4-2". A document can only reach here with a name ending in -<n>
  // by having been given one here or by a recovery carrying one, so nothing a
  // user typed is trimmed -- Save As and an opened file both arrive with a path
  // and never reach this function at all.
  {
    const std::size_t dash = base.find_last_of('-');
    if (dash != std::string::npos && dash > 0 && dash + 1 < base.size() &&
        base.find_first_not_of("0123456789", dash + 1) == std::string::npos) {
      base.erase(dash);
    }
  }
  swerved = false;
  firstChoice = directory + "/" + base + kPartFileExtension;
  std::error_code ec;
  for (int n = 1; n <= 1000; ++n) {
    const std::string candidate = n == 1 ? firstChoice
                                         : directory + "/" + base + "-" + std::to_string(n) +
                                               kPartFileExtension;
    if (!forbidden.empty() && candidate == forbidden) continue;
    if (!std::filesystem::exists(candidate, ec)) {
      swerved = candidate != firstChoice;
      return candidate;
    }
  }
  // A thousand untitled parts in one directory is not a state to guess at.
  return std::string();
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

  // ── THE FILE AN IMPORTED BODY CAME FROM ─────────────────────────────────
  //
  // THE DEFECT THIS BLOCK EXISTS FOR. A document whose program is `%1 = INPUT()`
  // is a STEP somebody imported, and `INPUT()` carries no path: it reads the one
  // file the compiler was handed. Nothing here used to hand it one, so the open
  // SUCCEEDED, the rebuild answered "INPUT() used but no input STEP was supplied
  // to the compiler", and the user got an empty viewport and no sentence -- from
  // a Save that had reported success. Import, save, reopen is the most common
  // workflow in CAD and it did not survive the process.
  //
  // ── THE THREE ANSWERS, AND WHY THEY ARE DIFFERENT ───────────────────────
  //
  //   the file NAMES NO SOURCE     it OPENS, with a warning. Every .fpart the
  //                                shipped app ever wrote for an imported part
  //                                is this file: version 3 recorded `OP INPUT`
  //                                and no path at all. Refusing it -- which this
  //                                change did in its first form, MEASURED --
  //                                makes an existing class of user documents
  //                                permanently unopenable, and a format that
  //                                predates a key is not a corrupt file.
  //   the source is FOUND          it opens, bound to what was found: the
  //                                recorded path, or the same name beside the
  //                                document (see inputFileCandidates).
  //   the source is NAMED AND      it is REFUSED, by name and with the reason,
  //   CANNOT BE USED               leaving the document that was already open
  //                                exactly as it was. There is nothing to show
  //                                and nothing to edit, so opening "successfully"
  //                                into an empty part would tell the user their
  //                                work is gone -- and the remedy the refusal
  //                                names costs nothing: put the file back, or
  //                                put a copy of it beside the part, which is
  //                                the second place looked in above.
  //
  // ★ THE REMEDY IS NOT "IMPORT IT AGAIN". That is what the first version of
  //   this refusal told the user to do, and MEASURED: file.import_step empties
  //   the document first (ForgeShell::runImport -> documentReset, which the
  //   graph-quality gate forces), so `%1 = INPUT()` + `%2 = FILLET(%1, 1)`
  //   became `%1 = INPUT()` and the fillet was gone. A refusal must not
  //   prescribe a step that destroys the work it is protecting.
  std::string boundInput;
  // ★ DID THE SOURCE MOVE? Not "is the bound path spelled differently from the
  //   recorded one" -- that was the old test and it is a DIFFERENT question. A
  //   relative record resolved against the document's own folder is spelled
  //   differently and is the same file, found in the first place looked. This
  //   is the index of the candidate that answered, and only a later one means
  //   the part is now built from somewhere else.
  bool foundBeside = false;
  if (partFileBindsInput(file)) {
    if (file.inputFile.empty()) {
      shell_.log().warning(
          "document.open",
          "This part has an imported body and the file does not say which file it came "
          "from, so that body is empty. Import the file again to put it back -- but "
          "importing replaces everything in the part, so save a copy first if you have "
          "added anything since.",
          "no INPUT-FILE record in " + path);
    } else {
      // The reason quoted is the FIRST place looked in -- which for the
      // absolute path a version-4 file records is the file itself. The message
      // always names the RECORDED path, because that is the name the user knows
      // and the one they can put back.
      InputFileState state = InputFileState::Missing;
      std::size_t index = 0;
      for (const std::string& candidate : inputFileCandidates(file.inputFile, path)) {
        const InputFileState found = inputFileState(candidate);
        if (index == 0) state = found;
        if (found == InputFileState::Usable) {
          boundInput = candidate;
          foundBeside = index > 0;
          break;
        }
        ++index;
      }
      if (boundInput.empty()) {
        // The REMEDY travels with the problem. It used to be one sentence
        // written here for every state, and MEASURED it told a user whose file
        // was merely unreadable to "put that file back where it was" -- about a
        // file that had never left. See inputFileRemedy.
        error = "This part is built from the file \"" + file.inputFile +
                "\", and Forge cannot use it: " + inputFileProblem(state) + ". " +
                inputFileRemedy(state);
        return false;
      }
      if (foundBeside) {
        // ★ AND IT SAYS WHAT IS ACTUALLY WRONG WITH THE RECORDED FILE.
        //   This sentence used to read "which is not there now" whatever had
        //   happened, because it fired on `boundInput != file.inputFile` and the
        //   loop above falls through to the sibling for NotAModel, Nothing and
        //   Truncated as well as Missing. MEASURED: overwrite the recorded
        //   source with junk, leave a good copy beside the part -- it opened
        //   bound to the sibling and said the junk file "is not there now". It
        //   was there. It was junk. inputFileProblem already has the right
        //   words for all five cases, so they are used here too.
        const std::string what = state == InputFileState::Missing
                                     ? std::string("which is not there now")
                                     : "and Forge cannot use that file: " + inputFileProblem(state);
        shell_.log().warning("document.open",
                             "This part was built from \"" + file.inputFile + "\", " + what +
                                 ". Forge is using the file of the same name in the folder "
                                 "this part is in. Save the part to record where it is now.",
                             "input file resolved beside the document: " + boundInput);
      }
    }
  }

  // ── THE UNIT THE FILE CLAIMS ────────────────────────────────────────────
  // This field has been written since the format existed and NEVER READ. Every
  // number in a .fpart is a millimetre by the rule forge/ui/Units.hpp states,
  // and a file that says otherwise is one whose lengths this build is about to
  // treat as millimetres anyway -- a part silently 25.4 times the wrong size,
  // which is the exact failure that header exists to prevent. It cannot be
  // converted (the statements are already in the file's own numbers and the
  // kernel has no unit token), so the honest move is to SAY so rather than to
  // carry on quietly.
  {
    const std::string expected = forge::ui::toString(forge::ui::kInternalLengthUnit);
    forge::ui::LengthUnit claimed = forge::ui::kInternalLengthUnit;
    const bool named = forge::ui::lengthUnitFromName(file.units, claimed);
    if (!file.units.empty() && (!named || claimed != forge::ui::kInternalLengthUnit)) {
      shell_.log().warning("document.open",
                           "This file says its sizes are in a different unit. Forge is opening it "
                           "as millimetres, so check the part against your drawing before you "
                           "machine from it.",
                           "file UNITS=" + file.units + " expected " + expected);
    }
  }
  // The document about to be replaced still holds whatever the user had not
  // saved; see autosaveDiscardedWork(). Taken HERE rather than at the top of the
  // function, because a file that turns out not to be a legal document must not
  // cost a snapshot of a document that is not going anywhere.
  autosaveDiscardedWork("Open");
  partDoc_ = candidate;  // the command handlers captured this OBJECT by reference
  // ── AND BIND WHAT WAS ACTUALLY FOUND, BEFORE THE REBUILD BELOW ──────────
  // `boundInput`, not the recorded path: when the source was found beside the
  // document, that is the file this part is now built from, and the next Save
  // records it. Set UNCONDITIONALLY, including to "": a document that binds no
  // input must CLEAR whatever an earlier import in this session left behind, or
  // the next Save would record a path this part never came from.
  bindInputFile(boundInput);
  drawing_ = file.drawing;
  drawingLayoutBuilt_ = false;
  partUndo_.clear();
  ensureBodyBinding();
  documentPath_ = path;
  // The stored NAME is authoritative when it says something; the path names the
  // document otherwise, so a file written by another tool still opens as itself.
  documentName_ = (file.name.empty() || file.name == "untitled") ? documentNameFromPath(path)
                                                                 : file.name;
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  // ── ★ AND THE REBUILD IS REALLY FORCED ──────────────────────────────────
  // This line used to be `builtProgram_.clear();  // force the rebuild below`
  // and it forced nothing: syncSceneToDocument's guard is
  // `program == lastAttemptedProgram_`, not builtProgram_, and has been since
  // the guard moved to "what was last ATTEMPTED". So an Open whose program text
  // matched the document already open SKIPPED THE REBUILD ENTIRELY.
  //
  // MEASURED, and it is the same user-visible failure as a stale binding: open a
  // version-4 part built from X.step, then open a LEGACY version-3 part that
  // names no source. Both programs are the single line `%1 = INPUT()`, so no
  // rebuild ran, and the viewport went on showing X's solid -- compiled=1,
  // volume 31865.840840 -- inside a document that names no file at all. Clearing
  // the binding correctly is not enough if nothing rebuilds against it.
  //
  // A DIFFERENT DOCUMENT IS A DIFFERENT BUILD even when its text is identical,
  // because the input file, and therefore the solid, is document state beside
  // the program.
  //
  // ── MERGE 2026-09-12, and BOTH PARENTS WERE RIGHT ABOUT A REAL DEFECT. The
  //    camera parent deleted `builtProgram_.clear()` from this function because
  //    on the one path where an open SKIPS the rebuild -- re-open the file that
  //    is already open -- it left builtProgram_ naming nothing while the scene
  //    showed a body, and the Study panel blocks Run study on exactly that
  //    comparison. The import parent kept it and added the line that makes the
  //    skip impossible.
  //
  //    I first resolved this by dropping the clear, and the import/reopen gate
  //    said no: open a v4 part built from X.step, then a LEGACY v3 part naming
  //    no source. The legacy program is the same text, its rebuild FAILS
  //    (compiled=0), and builtProgram_ goes on naming the identical text from
  //    the PREVIOUS document -- so the app believes the viewport is showing this
  //    document while it is showing the last one. That is the SAME lie the
  //    camera parent objected to, pointing the other way.
  //
  //    Both lines are here because neither alone is the invariant. The invariant
  //    is e5419952's: builtProgram_ may only ever name a program that really
  //    built. Clearing it is safe HERE and only here, because the line below
  //    guarantees the rebuild that re-establishes it actually runs -- which is
  //    what the old "force the rebuild below" comment claimed and never did. It
  //    is NOT restored in documentReset(), where the camera parent's measurement
  //    stands: the empty program does not build, the viewport keeps the previous
  //    body, and emptying the name there would make it lie.
  builtProgram_.clear();
  lastAttemptedProgram_.clear();
  // A PART THIS WINDOW HAS NEVER SEEN. It may be ten times the size of the one
  // that was open, so the camera distance that suited the last document would
  // put this one off screen or fill it with one corner.
  refitCameraPending_ = true;
  syncSceneToDocument();
  // ── ★ AND A PART WHOSE SOURCE MOVED OPENS *DIRTY* ───────────────────────
  // The warning above ends "Save the part to record where it is now", and
  // MEASURED with this line as a flat `false`: file.save answered `disabled`
  // ("Save Document is not available now") the moment the part opened, because
  // its `enabled` predicate is `doc_.dirty` and there is no Save As. The
  // sentence prescribed a step the app refused, and the .fpart went on naming
  // the old path until the user happened to make an unrelated edit.
  //
  // Dirty is also simply TRUE here: what is in memory is bound to a file the
  // document on disk does not name, so closing without saving loses that fact
  // and the next open warns again. `foundBeside` is false on every ordinary
  // open, so this is not "every Open is now dirty".
  documentDirty_ = foundBeside;
  note("Opened " + path + "  (" + std::to_string(partDoc_.records().size()) + " features)");
  return true;
}

bool ForgeFrame::documentSave(const std::string& path, std::string& error) {
  std::string target = path.empty() ? documentPath_ : path;
  if (target.empty()) {
    // Ctrl+S on a never-saved document must SAVE, and must say where. ~/.forge
    // is the directory the app already owns for its own state.
    //
    // ★ AND IT MAY NOT LAND ON A FILE THAT IS ALREADY THERE. This target is
    //   built out of a NAME, and "untitled" is the name of every new document,
    //   so the same path comes back for the second part of a session and for a
    //   recovery whose path the staleness guard has just refused. Neither of
    //   those is the user asking to replace anything. See
    //   firstFreeFallbackPath() above for what was measured and why the answer
    //   is a free name rather than a refusal or a panel.
    //
    //   A target the CALLER gave (`path`), or one this document already owns
    //   (`documentPath_`), is left exactly alone: replacing the file you chose
    //   is what Save means, and only the invented name is guarded here.
    const char* home = std::getenv("HOME");
    const std::string dir = (home != nullptr && home[0] != 0) ? std::string(home) + "/.forge" : ".";
    bool swerved = false;
    std::string wanted;
    target = firstFreeFallbackPath(dir, documentName_, refusedSavePath_, swerved, wanted);
    if (target.empty()) {
      error = "Forge could not find a free name for this part in " + dir +
              ". Use Save As and choose where it should go.";
      return false;
    }
    if (swerved) {
      // NOT a silent swerve. The user pressed a key expecting a file they could
      // guess the name of, and got a different one; the log says which, and why
      // the obvious name was not used.
      shell_.log().warning("document.save",
                           "This part had no file of its own, so Forge made one for it under "
                           "the next free name. The name it would normally use belongs to "
                           "another part, and Forge will not write over a file you did not "
                           "choose.",
                           "wanted " + wanted + ", wrote " + target);
    }
  }
  documentName_ = documentNameFromPath(target);
  // The scene's binding is the one the viewport was built with, so what the file
  // records is the file the part on screen was made from -- the same "save what
  // you see" rule the STEP export follows.
  const PartFileDoc file =
      capturePartDocument(partDoc_, documentName_, drawing_, scene_.inputFile());
  if (!savePartFile(target, file, error)) return false;
  documentPath_ = target;
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  documentDirty_ = false;
  note("Saved " + target + "  (" + std::to_string(file.features.size()) + " features)");
  return true;
}

// ── AUTOSAVE: the engine that was written and never switched on ─────────────
//
// forge::ui::RecoveryService is complete, gated (ui/test/document_store_test.cpp)
// and, until this wiring, CONSTRUCTED ZERO TIMES by the application -- measured
// with `grep -rn RecoveryService forge-desktop`, which returned nothing at all.
// Nothing below re-implements any of it: the session marker, the atomic write,
// the "has it actually changed" test and the cadence are the service's, and this
// file contributes the three things only the application knows -- WHERE the
// document is, WHAT it currently contains, and WHEN a frame went by.
forge::ui::DocumentModel ForgeFrame::autosaveSnapshot() const {
  forge::ui::DocumentModel model;
  // The two document layers share forge::ui::PartDocument, so the feature tree
  // crosses WHOLE rather than being re-encoded through a second format.
  model.tree() = partDoc_;
  model.setName(documentName_);
  // ── THE MATERIAL, WHICH TRAVELS IN NEITHER OF THOSE TWO LINES ───────────
  // MEASURED, on the first version of this change: DocumentModel::capture()
  // writes the MODEL's own `material_`, not `tree().material()`, and nothing
  // here set it -- so every autosave claimed the part was made of nothing. Then
  // recoverFromAutosave() installed that document over the user's own file path
  // and one Ctrl+S wrote "unassigned" into a file that said 6061-T6, taking the
  // density, and therefore every mass the part had, with it.
  model.setMaterial(partDoc_.material());
  // The DRAWING is not here because it CANNOT be: a forge::ui::DocumentModel has
  // no drawing and the ui dialect cannot express one without colliding with
  // forge::desktop's own FORGE-PART 3. It rides beside the autosave instead --
  // writeAutosaveDrawing(), called by both autosave paths below.
  return model;
}

std::string autosaveDrawingPath(const std::string& autosavePath) {
  if (autosavePath.empty()) return std::string();
  // The autosave's own suffix is REPLACED rather than appended to, so the result
  // cannot be counted by anything scanning for autosaves.
  const std::string suffix = forge::ui::kAutosaveSuffix;
  std::string stem = autosavePath;
  if (stem.size() >= suffix.size() &&
      stem.compare(stem.size() - suffix.size(), suffix.size(), suffix) == 0) {
    stem.erase(stem.size() - suffix.size());
  }
  return stem + kAutosaveDrawingSuffix;
}

// ── THE DRAWING'S SNAPSHOT ──────────────────────────────────────────────────
//
// ★ WHAT THIS EXISTS FOR, MEASURED. documentSave() writes
//   capturePartDocument(partDoc_, documentName_, drawing_) and autosaveSnapshot()
//   carried the tree and the name. The title block, the datums, the geometric
//   tolerances and every note were therefore absent from every autosave, while
//   ELEVEN document operations in this file mark a document dirty by touching
//   nothing else -- five title-block controls in drawTitleBlockPanel(), plus add
//   and remove for datums, tolerance frames and notes. Counted by attributing
//   every `documentDirty_ = true` in this file to the function it sits in. So
//   the state the autosave was most likely to be holding was exactly the state
//   it could not keep.
//
// It is written by writePartFile(), the function documentSave() itself uses, so
// there is no second serialiser for a drawing and no second thing to drift. It
// carries NO FEATURES deliberately: a second copy of the feature tree could
// disagree with the autosave's, and a drawing stitched onto the wrong part is
// worse than a drawing that is late.
bool ForgeFrame::writeAutosaveDrawing() {
  if (recovery_ == nullptr || !recovery_->active()) return false;
  const std::string path = autosaveDrawingPath(recovery_->autosavePath());
  if (path.empty()) return false;
  PartFileDoc sidecar;
  sidecar.name = documentName_;
  sidecar.drawing = drawing_;
  const std::string text = writePartFile(sidecar);
  // The service's own rule, applied to the piece the service cannot see: an
  // unchanged drawing is not rewritten every fifteen seconds.
  if (text == lastAutosavedDrawing_) return false;
  std::string error;
  if (!recoveryStorage_.write(path, text, error)) {
    shell_.log().error("Autosave",
                       "Forge could not write a spare copy of this part's drawing. Save your "
                       "work somewhere you choose.",
                       error);
    return false;
  }
  lastAutosavedDrawing_ = text;
  return true;
}

bool ForgeFrame::beginRecoverySession(const std::string& directory) {
  if (directory.empty()) return false;
  recovery_ = std::make_unique<forge::ui::RecoveryService>(recoveryStorage_, directory);

  forge::ui::AutosavePolicy policy;
  policy.intervalMillis = 15000;
  // ── everyNEdits IS ZERO ON PURPOSE, and this is the honest half ─────────
  // The service's edit trigger reads `model.undo().undoDepth()`, and the model
  // it is handed here is a SNAPSHOT built by autosaveSnapshot(); the undo stack
  // a user actually fills is ForgeFrame::partUndo_ and does not travel with it.
  // Declaring `everyNEdits = 20` would therefore be a trigger that can never
  // fire -- a number in a struct that nothing reads, which is the exact defect
  // shape this file already carries three post-mortems for (view.fit, the theme
  // command, the retired model.* stubs). The time cadence is halved instead,
  // and requestQuit() snapshots unconditionally on the way out.
  policy.everyNEdits = 0;
  recovery_->setPolicy(policy);

  // Unique per LIVE SESSION, which is what makes a marker left behind mean a
  // session that died rather than this one. Pid plus start time is the pairing
  // the service's header names...
  //
  // ...and the COUNTER is the half that pairing does not cover. Two sessions
  // opened by ONE process inside the same second mint the same id, and
  // RecoveryService::beginSession writes its marker at a path derived from the
  // id -- so the second session overwrites the first one's marker and scan()
  // then skips the dead session as "our own, still live". MEASURED while writing
  // this change's own gate: two sessions a few milliseconds apart produced ZERO
  // recoverable candidates where one was owed. The live application opens one
  // session per launch and would not have hit it; a harness, and a future
  // document-per-window build, both would.
  static unsigned long long sessionSerial = 0;
  ++sessionSerial;
  const std::string sessionId =
      "forge-" + std::to_string(static_cast<long long>(::getpid())) + "-" +
      std::to_string(static_cast<long long>(std::time(nullptr))) + "-" +
      std::to_string(sessionSerial);
  std::string error;
  if (!recovery_->beginSession(sessionId, autosaveClockMillis_, error)) {
    shell_.log().error("Autosave",
                       "Forge cannot keep a spare copy of your work in this session, so save "
                       "it yourself before you stop for the day.",
                       "recovery session refused: " + error);
    recovery_.reset();
    return false;
  }
  shell_.log().info("Autosave",
                    "Forge is keeping a spare copy of this part while you work, and will ask "
                    "before it closes with changes you have not saved.",
                    "recovery session " + sessionId + " in " + directory);
  return true;
}

bool ForgeFrame::autosaveNow() {
  if (recovery_ == nullptr || !recovery_->active()) return false;
  // A document that matches its file has nothing to recover THAT THE FILE DOES
  // NOT ALREADY HOLD. This is the application's fact, not the service's.
  if (!documentDirty_) return false;
  std::string error;
  // THE DRAWING FIRST, and the order is deliberate. The marker a scan reads is
  // written by the service at the END of its own autosave, so a process that
  // dies between these two lines leaves a drawing with no marker -- invisible,
  // and harmless. The other order would leave a marker advertising an autosave
  // whose drawing is a version behind.
  writeAutosaveDrawing();
  // A snapshot NOW restarts the drawing's cadence, exactly as the service
  // restarts its own: what was just written is not due again for a full interval.
  autosaveDrawingDueAtMillis_ = autosaveClockMillis_ + recovery_->policy().intervalMillis;
  const bool wrote =
      recovery_->autosaveNow(autosaveClockMillis_, autosaveSnapshot(), documentPath_, error);
  if (!wrote && !error.empty()) {
    // Stated, not swallowed: the whole point of an autosave is what happens when
    // the write fails, and a failure nobody is told about is silent again.
    shell_.log().error("Autosave",
                       "Forge could not write its spare copy of this part. Save your work "
                       "somewhere you choose.",
                       error);
  }
  return wrote;
}

bool ForgeFrame::autosaveTick(double deltaSeconds) {
  if (recovery_ == nullptr || !recovery_->active()) return false;
  if (deltaSeconds > 0.0) {
    autosaveClockMillis_ += static_cast<std::uint64_t>(deltaSeconds * 1000.0);
  }
  if (!documentDirty_) return false;
  if (autosaveClockMillis_ < autosaveProbeAtMillis_) return false;
  autosaveProbeAtMillis_ = autosaveClockMillis_ + 250;
  std::string error;
  // ── THE DRAWING RIDES ON THE CADENCE TOO, AND ON ITS OWN CLOCK ──────────
  // Eleven document operations here mark a document dirty by touching the
  // drawing and nothing else, so a cadence that skipped it would keep a spare
  // copy of everything the user had NOT been editing.
  //
  // The clock is separate because the two writes are due for different reasons:
  // the SERVICE decides when the tree is due, from a digest this class cannot
  // see, and the line above only bounds how often it is ASKED (every 250 ms). A
  // drawing written on that probe would be rewritten four times a second while
  // somebody types into a title block. The policy's own interval is used, so
  // there is one cadence in the application and not two numbers to drift.
  if (autosaveClockMillis_ >= autosaveDrawingDueAtMillis_) {
    autosaveDrawingDueAtMillis_ = autosaveClockMillis_ + recovery_->policy().intervalMillis;
    writeAutosaveDrawing();
  }
  const bool wrote =
      recovery_->tick(autosaveClockMillis_, autosaveSnapshot(), documentPath_, error);
  if (!wrote && !error.empty()) {
    shell_.log().error("Autosave",
                       "Forge could not write its spare copy of this part. Save your work "
                       "somewhere you choose.",
                       error);
  }
  return wrote;
}

bool ForgeFrame::endRecoverySession() {
  if (recovery_ == nullptr) return true;
  // READ BEFORE the session is closed: endSession() clears the session id, and
  // autosavePath() is empty without one -- so naming the file afterwards would
  // report the failure with a blank where the file is.
  const std::string leftover = recovery_->autosavePath();
  // The drawing goes with it. A clean exit removes the marker and the autosave;
  // a drawing left behind would be an orphan nothing scans for and nothing ever
  // deletes -- one file per session, for ever, in the user's ~/.forge.
  {
    const std::string drawingPath = autosaveDrawingPath(leftover);
    std::string why;
    if (!drawingPath.empty() && recoveryStorage_.exists(drawingPath)) {
      recoveryStorage_.remove(drawingPath, why);
    }
  }
  lastAutosavedDrawing_.clear();
  std::string error;
  const bool ok = recovery_->endSession(error);
  if (!ok) {
    // NOT "Forge will offer it to you next time": there is no recovery prompt at
    // startup yet, and a sentence that promises one is a sentence that lies to
    // the one user who will read it. What is true is the path, so the path is
    // what it says.
    shell_.log().warning("Autosave",
                         "Forge left a spare copy of this part behind. It is harmless, and "
                         "the file it is in is named beside this message.",
                         "leftover autosave: " + leftover + " (endSession: " + error + ")");
  }
  return ok;
}

std::vector<forge::ui::RecoveryCandidate> ForgeFrame::recoverableSessions() const {
  if (recovery_ == nullptr) return {};
  return recovery_->scan();
}

// ── THE DRAWING A RECOVERY IS ALLOWED TO INSTALL ────────────────────────────
//
// THIS IS THE FIRST OF THE TWO QUESTIONS A RECOVERY HAS TO ANSWER BEFORE IT MAY
// TAKE A FILE'S NAME, and on its own it is NOT enough: see
// fileIsNewerThanSnapshot() below for the second one, which is about the file's
// AGE and is not about the drawing at all.
//
// THREE ANSWERS, IN ORDER, AND THE THIRD ONE REFUSES THE FILE.
//
//   1. the snapshot beside the autosave -- the drawing as it was when the
//      session died. This is the answer in every case the application controls.
//   2. the USER'S OWN FILE, when there is no snapshot: an autosave written by a
//      build that had none, a half-deleted recovery directory, a disk that
//      filled between two writes. The last SAVED drawing is not the newest, but
//      it is the user's, and an empty one is nobody's.
//   3. nothing -- and then `adoptPath` is FALSE. A document whose drawing cannot
//      be accounted for must not be one keystroke away from overwriting the file
//      that still has it, so the recovery keeps the work and gives up the path.
bool ForgeFrame::recoverDrawingFor(const forge::ui::RecoveryCandidate& candidate,
                                   forge::ui::DrawingModel& out, bool& adoptPath,
                                   std::string& why) const {
  out = forge::ui::DrawingModel{};
  adoptPath = true;
  why.clear();

  const std::string path = autosaveDrawingPath(candidate.autosavePath);
  if (!path.empty() && recoveryStorage_.exists(path)) {
    std::string text;
    std::string readError;
    if (recoveryStorage_.read(path, text, readError)) {
      PartFileDoc snapshot;
      std::string parseError;
      // The SAME reader File > Open uses, for the same reason the service reads
      // its autosave through the document reader: a recovered drawing is a
      // drawing and not a special case.
      if (readPartFile(text, snapshot, parseError)) {
        out = snapshot.drawing;
        return true;
      }
      why = "the drawing beside that autosave could not be read: " + parseError;
    } else {
      why = readError;
    }
  }

  if (candidate.documentPath.empty()) {
    // Never saved: there is no file to lose a drawing from, so an empty one is
    // the truth rather than a loss, and the path there is nothing to give up.
    return false;
  }

  PartFileDoc onDisk;
  std::string loadError;
  if (loadPartFile(candidate.documentPath, onDisk, loadError)) {
    out = onDisk.drawing;
    if (why.empty()) why = "no drawing was saved beside that autosave";
    return false;
  }

  // Nothing knows what the drawing was. THE PATH IS REFUSED.
  adoptPath = false;
  why = "no drawing was saved beside that autosave, and " + candidate.documentPath +
        " could not be read to take one from it (" + loadError + ")";
  return false;
}

namespace {

// The modification time of a real file, or nothing at all. `std::nullopt` covers
// BOTH "there is no such file" and "the platform would not say", and the caller
// is required to treat those as different from "it is old" -- see
// ForgeFrame::fileIsNewerThanSnapshot(), which refuses rather than guesses.
//
// file_time_type is returned rather than a count of milliseconds on purpose: two
// of these are only ever COMPARED WITH EACH OTHER, and converting to a unit
// invites a truncation that would make a file written half a millisecond after a
// snapshot read as written at the same moment.
std::optional<std::filesystem::file_time_type> fileModifiedAt(const std::string& path) {
  if (path.empty()) return std::nullopt;
  std::error_code ec;
  const std::filesystem::file_time_type at = std::filesystem::last_write_time(path, ec);
  if (ec) return std::nullopt;
  return at;
}

}  // namespace

// ── THE SECOND QUESTION: IS THE FILE NEWER THAN THE SNAPSHOT? ───────────────
//
// ★ MEASURED TWICE ON THE VERSION OF THIS FILE THAT SHIPPED THE LADDER ABOVE,
//   with a probe reading the RAW BYTES of the user's .fpart:
//     (a) a note typed and SAVED after the last fifteen-second autosave, then a
//         dead session, then a recovery and ONE bare Ctrl+S -- and the user's
//         own file went from 1 annotation block to 0.
//     (b) a feature modelled AND SAVED after the last autosave -- and the same
//         keystroke took the file from 9 feature blocks to 8.
//
//   Neither is about a drawing, which is exactly why the ladder above could not
//   be the fix for it. recoverDrawingFor() answers "can I account for the
//   drawing?" and then the recovery adopted candidate.documentPath WITHOUT EVER
//   COMPARING the autosave against the file whose name it was taking. The
//   snapshot is written on a cadence; Ctrl+S is instant; so the ordinary state
//   of the world is a snapshot that is SECONDS OLDER than the user's file, and
//   handing that document the file's identity is handing it a licence to delete
//   whatever the user saved in between.
//
// THE COMPARISON IS THE FILESYSTEM'S OWN MODIFICATION TIME, on both files, from
// one clock. Not the marker's `savedAtMillis`: that is the APPLICATION's clock,
// which a gate steps by a value and which has no relationship to the clock that
// stamped the user's file.
//
// WHEN THE SNAPSHOT HAS A DRAWING BESIDE IT the pair is only as fresh as its
// OLDER half, so the EARLIER of the two times is the snapshot's. When there is
// no drawing beside it, rung (b) above reads the drawing out of the user's own
// file, so the drawing is fresh by construction and only the tree's time counts.
//
// AN UNREADABLE TIME IS A REFUSAL, not a pass. "I could not tell whether your
// file is newer" and "your file is not newer" are different answers and only one
// of them is safe to act on -- the same rule rung (c) above already follows.
//
// IT IS DELIBERATELY CONSERVATIVE. A user who saves and then crashes before the
// next cadence has a file that is newer than a snapshot holding the same work,
// and this refuses the name there too: the recovery costs them a Save As. The
// other way round costs them the work already on their disk, and those are not
// the same size of mistake.
bool ForgeFrame::fileIsNewerThanSnapshot(const forge::ui::RecoveryCandidate& candidate,
                                         std::string& why) const {
  why.clear();
  // Never saved: there is no file to be newer than anything, and nothing a
  // keystroke could overwrite.
  if (candidate.documentPath.empty()) return false;

  const std::optional<std::filesystem::file_time_type> fileAt =
      fileModifiedAt(candidate.documentPath);
  // No file there at all -- it was moved, renamed or deleted since the session
  // died. Nothing to destroy, so this question has no opinion; the drawing
  // ladder's rung (c) is what decides that case.
  if (!fileAt.has_value()) return false;

  std::optional<std::filesystem::file_time_type> snapshotAt =
      fileModifiedAt(candidate.autosavePath);
  if (!snapshotAt.has_value()) {
    why = "the age of " + candidate.autosavePath +
          " could not be read, so it could not be shown to be at least as new as " +
          candidate.documentPath;
    return true;
  }
  const std::string drawingPath = autosaveDrawingPath(candidate.autosavePath);
  if (!drawingPath.empty() && recoveryStorage_.exists(drawingPath)) {
    const std::optional<std::filesystem::file_time_type> drawingAt = fileModifiedAt(drawingPath);
    if (!drawingAt.has_value()) {
      why = "the age of " + drawingPath + " could not be read";
      return true;
    }
    if (*drawingAt < *snapshotAt) snapshotAt = drawingAt;
  }

  if (!(*snapshotAt < *fileAt)) return false;
  const long long seconds = static_cast<long long>(
      std::chrono::duration_cast<std::chrono::seconds>(*fileAt - *snapshotAt).count());
  why = candidate.documentPath + " was written " + std::to_string(seconds) +
        " s after the spare copy this recovery came from, so it holds work the spare copy "
        "does not";
  return true;
}

bool ForgeFrame::recoverFromAutosave(const forge::ui::RecoveryCandidate& candidate,
                                     std::string& error) {
  error.clear();
  // ── CLEARED HERE, BEFORE EITHER EARLY RETURN, AND THAT IS THE FIX ───────
  // These two were written only on the success path, while the header said
  // recoveryRefusedStalePath_ was "set every time this runs". It was not: a
  // recovery that fell out at one of the two returns below left the PREVIOUS
  // recovery's answer standing, so the accessor could report "your file was
  // newer" about a recovery that never got as far as looking at a file -- and
  // the refused-path memory could go on refusing a name for a document that had
  // nothing to do with it. Both now mean "the LAST recovery that ran", which is
  // what they are read as.
  recoveryRefusedStalePath_ = false;
  refusedSavePath_.clear();
  if (recovery_ == nullptr) {
    error = "no recovery session is open";
    return false;
  }
  forge::ui::DocumentModel recovered;
  forge::ui::DocumentIoError why;
  // The SAME reader a normal Open uses, which is the service's own rule: a
  // recovered document is a document and not a special case.
  if (!recovery_->recover(candidate, recovered, why)) {
    error = why.describe();
    return false;
  }

  // ── WHAT THIS FUNCTION IS ABOUT TO POINT AT, AND WHY THE DRAWING COMES
  //    BEFORE IT ──────────────────────────────────────────────────────────
  // The lines below install a document AND point documentPath_ at the dead
  // session's own .fpart, dirty. One Ctrl+S after that -- no panel, no
  // confirmation -- writes this document OVER the user's file. So anything this
  // function fails to restore is not merely missing from the screen: it is
  // DELETED FROM DISK by the next keystroke, by the feature that exists to
  // prevent loss. MEASURED on the first version of this change: a file holding 6
  // features and 1 annotation recovered with 0 annotations, and a bare Ctrl+S
  // made that permanent. The drawing and the material are therefore resolved
  // FIRST, and a drawing that cannot be resolved costs the PATH rather than the
  // user's work.
  //
  // ★ AND THAT WAS STILL ONE QUESTION SHORT. Accounting for everything the
  // SNAPSHOT holds says nothing about what the FILE holds. MEASURED on the
  // version that shipped the ladder: a note saved after the last cadence (1
  // annotation block -> 0) and a feature saved after it (9 blocks -> 8), both
  // destroyed by one bare Ctrl+S after a recovery that had accounted for its own
  // drawing perfectly well. So the path is now refused for EITHER reason, and
  // the second one -- the file is newer than the snapshot -- is asked of the
  // candidate rather than of the drawing.
  forge::ui::DrawingModel drawing;
  bool adoptPath = true;
  std::string drawingNote;
  const bool fromSnapshot = recoverDrawingFor(candidate, drawing, adoptPath, drawingNote);

  // ── AND THE SECOND QUESTION, WHICH IS NOT THE DRAWING'S ─────────────────
  // "Can I account for the drawing?" is answered above. It is not enough, and
  // MEASURED that it is not: a snapshot that accounts for everything it holds
  // can still be OLDER THAN THE FILE it is about to be named after, and then the
  // keystroke deletes whatever the user saved in between -- a note (1 annotation
  // block -> 0) or a feature (9 blocks -> 8), both reproduced in the raw bytes.
  // So the freshness question is asked SEPARATELY, of the candidate, whatever
  // the drawing's provenance turned out to be.
  std::string staleNote;
  recoveryRefusedStalePath_ = adoptPath && fileIsNewerThanSnapshot(candidate, staleNote);
  if (recoveryRefusedStalePath_) adoptPath = false;
  // ── AND THE PATH IS REMEMBERED, NOT MERELY DROPPED ──────────────────────
  // MEASURED: clearing documentPath_ was not enough. The lines below keep the
  // recovered document's NAME, and documentSave() built its fallback target out
  // of exactly that name -- so one bare Ctrl+S reconstructed the path this guard
  // had just refused, and wrote the older document over the user's newer file.
  // On the raw bytes: 1 NOTE / 883 bytes -> 0 NOTE / 801 bytes, identical with
  // this guard and without it. The collision test in firstFreeFallbackPath()
  // catches that on its own while the file is there; this is what still catches
  // it after the user does what the warning below tells them to and moves their
  // own file aside.
  //
  // It is asked of `adoptPath` and not of the staleness flag on purpose: rung
  // (c) of the drawing ladder refuses a path too, for a different reason, and a
  // refusal is a refusal. An empty documentPath -- a dead session that had never
  // saved -- remembers nothing, which is correct: there is no file to protect.
  if (!adoptPath) refusedSavePath_ = candidate.documentPath;

  partDoc_ = recovered.tree();
  // DocumentModel::restore() installs a FRESH PartDocument and puts the file's
  // material on the MODEL, not on that tree -- so `recovered.tree().material()`
  // is "unassigned" whatever the autosave said. Taking it from the model is what
  // keeps a recovered part made of what it was made of.
  partDoc_.setMaterial(recovered.material());
  drawing_ = drawing;
  drawingLayoutBuilt_ = false;
  partUndo_.clear();
  ensureBodyBinding();
  // Where the user's OWN file is, if the dead session had one AND this recovery
  // can account for everything that file holds. The recovered work is NOT that
  // file's content, which is why the document stays dirty.
  documentPath_ = adoptPath ? candidate.documentPath : std::string();
  documentName_ = recovered.name().empty() ? std::string("untitled") : recovered.name();
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);
  builtProgram_.clear();
  lastAttemptedProgram_.clear();
  syncSceneToDocument();
  rebuildTree();
  documentDirty_ = true;
  note("Recovered " + std::to_string(partDoc_.records().size()) + " features from an autosave");
  if (recoveryRefusedStalePath_) {
    // NOT a silent untitling. The user asked for their work back and is not
    // getting the file's name with it, and the reason is the one thing they
    // could not have guessed: the file on their disk is NEWER than what Forge
    // kept. The sentence says what is true and what to do about it.
    shell_.log().warning("Recovery",
                         "Forge recovered your work, but the file you saved is NEWER than the "
                         "spare copy this came from -- so it has NOT pointed the document at "
                         "that file. Use Save As, and keep your own file until you have "
                         "compared the two.",
                         staleNote + " (the document was left untitled on purpose)");
    note("Recovered work, but your saved file is newer — use Save As");
  }
  if (!fromSnapshot && !drawingNote.empty()) {
    if (adoptPath || recoveryRefusedStalePath_) {
      // The drawing came from the user's own file (rung b). Whether the NAME was
      // kept is the other question's business and its own sentence is already in
      // the log, so this one says only what is true of the drawing.
      shell_.log().warning("Recovery",
                           "Forge recovered this part, and took its drawing from the last "
                           "version you saved -- so any change to the title block, the datums "
                           "or the notes since then is not in it. Check the drawing before you "
                           "save over your file.",
                           drawingNote);
    } else {
      // NOT a silent fallback: the user asked for their file back and is not
      // getting the name with it, so the sentence says what to do instead.
      shell_.log().warning("Recovery",
                           "Forge recovered your work, but it could not tell what this part's "
                           "drawing looked like -- so it has NOT pointed the document at your "
                           "original file. Use Save As, and keep the old file until you have "
                           "checked the new one.",
                           drawingNote + " (the document was left untitled on purpose)");
      note("Recovered work, but not the file it came from — use Save As");
    }
  }
  return true;
}

// ── THE QUIT GUARD ──────────────────────────────────────────────────────────
//
// MEASURED before this existed, with a headless probe driving this exact API: a
// document holding an unsaved part.fillet, `requestQuit()`, and `wantsQuit()`
// answered TRUE on the next line while `documentDirty()` was still true and
// there were zero autosaves and zero session markers anywhere on disk. The menu
// item's whole body was `quit_ = true;`.
void ForgeFrame::requestQuit() {
  // THE SNAPSHOT COMES FIRST, before the question is even asked. Whatever the
  // user answers -- and whether or not they ever answer -- the work is on disk
  // from this line onward, including if the process dies while the prompt is up.
  autosaveNow();
  if (!documentDirty_) {
    grantQuit();
    return;
  }
  if (quitPrompt_) return;  // already asking; a second gesture is not a second question
  quitPrompt_ = true;
  ++quitPromptsRaised_;
  note("This part has changes you have not saved — Forge is asking before it closes");
}

void ForgeFrame::grantQuit() {
  // A CLEAN exit removes the marker AND the autosave. Whatever is left in the
  // recovery directory after this is, by definition, a session that died.
  endRecoverySession();
  quit_ = true;
}

void ForgeFrame::answerQuitSave() {
  if (quitPrompt_) pendingQuitAnswer_ = QuitAnswer::Save;
}
void ForgeFrame::answerQuitDiscard() {
  if (quitPrompt_) pendingQuitAnswer_ = QuitAnswer::Discard;
}
void ForgeFrame::answerQuitCancel() {
  if (quitPrompt_) pendingQuitAnswer_ = QuitAnswer::Cancel;
}

void ForgeFrame::applyPendingQuitAnswer() {
  const QuitAnswer answer = pendingQuitAnswer_;
  pendingQuitAnswer_ = QuitAnswer::None;
  if (answer == QuitAnswer::None || !quitPrompt_) return;
  switch (answer) {
    case QuitAnswer::None:
      return;
    case QuitAnswer::Cancel:
      quitPrompt_ = false;
      note("Closing cancelled — your part is still open");
      return;
    case QuitAnswer::Discard:
      // The ONE path in this application that throws work away, and it is the
      // one the user asked for by name, on a button that says so.
      quitPrompt_ = false;
      note("Closed without saving — the changes were discarded as you asked");
      grantQuit();
      return;
    case QuitAnswer::Save:
      // Through the ONE registry, so this is the same Save as Ctrl+S: it
      // remembers the path, feeds Open Recent and clears the dirty flag. An
      // untitled document raises the file panel from inside invoke(), which is
      // why the outcome is resolved at the end of the frame rather than here.
      quitPrompt_ = false;
      quitAfterSave_ = true;
      invoke("file.save");
      return;
  }
}

// ── THE QUESTION HAS TO KEEP BEING TRUE ─────────────────────────────────────
//
// MEASURED: with the question up, a manual Ctrl+S left the application holding
// dirty=0 and prompt=1 -- a window insisting on unsaved changes that no longer
// existed, and one whose "Close Without Saving" button offered to throw away
// nothing. It is a plain window and NOT a modal, deliberately (the user may want
// to look at the part they are being asked about), so every other gesture still
// works while it stands and nothing re-read the condition it was raised on.
//
// It WITHDRAWS rather than closing the application. The user's quit gesture is
// on record, but this window is not modal: the same user may have saved and gone
// back to work minutes ago, and an application that closes itself under them
// because of a click they made before lunch is a worse failure than the one
// being fixed. Quitting again is one gesture, and on a clean document it is now
// immediate.
void ForgeFrame::refreshQuitPrompt() {
  if (!quitPrompt_ || documentDirty_) return;
  // "Save and Close" is in flight: quitAfterSave_ owns the outcome, and
  // resolveQuitAfterSave() is the one line allowed to decide it.
  if (quitAfterSave_) return;
  quitPrompt_ = false;
  pendingQuitAnswer_ = QuitAnswer::None;
  ++quitPromptsWithdrawn_;
  note("Your part is saved — Forge took the unsaved-changes question back down");
}

void ForgeFrame::resolveQuitAfterSave() {
  if (!quitAfterSave_) return;
  // Still being asked WHERE -- a file panel is owed, or the parameter prompt is
  // standing on this command. Neither is an answer yet.
  if (!pendingDialogId_.empty() || (promptOpen_ && promptCommand_ == "file.save")) return;
  quitAfterSave_ = false;
  if (!documentDirty_) {
    grantQuit();
    return;
  }
  // The save was refused, or the panel was cancelled. Staying open is the only
  // safe answer: closing here would be the defect this guard exists for, with
  // an extra click in front of it.
  quitPrompt_ = true;
  note("Your part was not saved, so Forge did not close");
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
  // ── A SHEET THAT IS ALREADY STANDING IS NOT A REQUEST TO RUN ────────────
  // The parameter sheet is a PLAIN WINDOW and not an ImGui modal -- deliberately,
  // so the Command Palette and everything else stay reachable behind it -- which
  // means the menu row and the ribbon button that opened it are still live. A
  // second click on them is an ordinary thing for a user to do, and it used to
  // read as "the values are in hand" (promptCommand_ == id was the only witness)
  // and DISPATCH BEHIND THE SHEET: click Box, click Box again, press Run once,
  // and TWO boxes came out. MEASURED, not supposed.
  //
  // The gizmo and the file panel are excluded because those genuinely are
  // invoke() being re-entered with an answer for this same command.
  if (promptOpen_ && promptCommand_ == id && !promptSubmitting_ && handleCommand_ != id &&
      dialogCommand_ != id) {
    lastInvokeOk_ = false;
    // Put the cursor back in the first box. The user reached for this command
    // again; the useful thing to do is hand them the sheet, not run it.
    promptFocus_ = false;
    return;
  }
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
      // A blank box on a parameter the statement may omit contributes nothing,
      // so the minimal emitted form survives a sheet that offers every argument.
      if (f.value[0] == '\0' && omittableWhenBlank(d, f.name)) continue;
      switch (f.type) {
        case forge::ui::ParamType::Number:
          overrides.setNumber(f.name, std::atof(f.value.data()));
          break;
        case forge::ui::ParamType::Flag:
          // A box a person types into, so anything that is not an explicit "off"
          // reads as on -- and an EMPTY box is off, not on, because a field the
          // user cleared must not turn a flag the command did not have.
          overrides.setFlag(f.name, flagFromText(f.value.data()));
          break;
        case forge::ui::ParamType::Text:
          overrides.setText(f.name, std::string(f.value.data()));
          break;
      }
    }
  }
  // ── the numbers a DRAG produced ─────────────────────────────────────────
  // Read through the command's OWN schema rather than copied by hand, so a
  // parameter the gizmo does not carry is left to its default and one it does
  // carry cannot be mis-spelled into silence.
  if (d != nullptr && !handleCommand_.empty() && handleCommand_ == id) {
    for (const forge::ui::ParamSpec& p : d->schema) {
      if (p.type != forge::ui::ParamType::Number) continue;
      if (const std::optional<double> v = handleParams_.number(p.name)) {
        overrides.setNumber(p.name, *v);
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

  // ── A COMMAND THAT HAS PARAMETERS ASKS FOR THEM ─────────────────────────
  //
  // MEASURED on this registry, not inferred: 71 Part commands declare 179
  // parameters, and exactly 2 of them could ever be typed. The mechanism is NOT
  // applyDefaults() -- that function refuses to invent a value for a spec with
  // no honest default, which is correct. It is that the ONLY thing that ever
  // opened a box was `missingRequired()`, whose whole job is to name parameters
  // the command CANNOT RUN WITHOUT:
  //   * 86 required parameters declare an honest default, so applyDefaults()
  //     fills them and missingRequired() returns nothing -- Box built 40x30x20
  //     and nothing in the application could be told otherwise;
  //   * 84 are optional positional arguments (a box's centre, a cylinder's
  //     axis) and are not required at all, so missingRequired() could never have
  //     named them whatever the defaults said. They were unreachable by
  //     construction, not by oversight.
  // The remaining 18 (radius / distance / thickness) had one global slider
  // between them, and everything else had to be built wrong and then corrected
  // one number at a time in the Properties panel.
  //
  // So the sheet is driven by editableParameters() -- the command's OWN spec
  // list -- and seeded with `applyDefaults(...)`, which is precisely the
  // CommandParams the next line would have dispatched. Run with nothing typed
  // is therefore byte-identical to the old behaviour, and the same prompt
  // window, the same fields and the same Run are reused: there is no second
  // parameter path to keep in step with this one.
  if (wantsParameterSheet(id)) {
    lastInvokeOk_ = false;
    const forge::ui::CommandParams seeded = forge::ui::applyDefaults(*d, overrides);
    openPrompt(id, forge::ui::editableParameters(*d), &seeded);
    return;
  }

  // ── THE WITNESS FOR "DID THIS ONE FAIL", TAKEN BEFORE IT RUNS ───────────
  // shell_.lastDocumentError() is STICKY: only the file, undo/redo and reset
  // commands clear it. Testing it for emptiness afterwards therefore answers
  // "has anything ever failed", not "did this fail" -- so after one refused
  // import every later command reported lastInvokeOk_ = false. That is the
  // witness submitPrompt() reads to decide whether to close the sheet, so the
  // box stayed open on a command that had just run and the NEXT gesture on it
  // dispatched twice: two sketch points where the user asked for one, MEASURED
  // in frame_gate. The counter is the same discriminator ForgeShell::run's own
  // recordDispatch() uses, for the same reason it gives: two failed opens of one
  // path leave identical text, so the string alone cannot tell them apart.
  const std::size_t documentErrorsBefore = shell_.documentErrorSeq();
  const forge::ui::InvokeOutcome outcome = shell_.invoke(id, overrides);
  const bool documentRefusedThis = shell_.documentErrorSeq() != documentErrorsBefore &&
                                   !shell_.lastDocumentError().empty();

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
  lastInvokeOk_ = r.ok() && !documentRefusedThis;
  // THE LABEL, NOT THE ID. Every line below used to open with the command's
  // stable id -- "part.edit_feature  ->  ok" -- which is the name a macro
  // stores, not a name anybody has read on a button.
  const forge::ui::CommandDescriptor* invoked = shell_.registry().find(id);
  const std::string label =
      (invoked != nullptr && !invoked->label.empty()) ? invoked->label : id;
  if (r.ok()) {
    // A file.* command reports refusal through the shell, not through the
    // dispatch status: `execute` returns void, so "ok" only means it ran. The
    // counter, not the string: an old sentence from a previous command must not
    // be printed against this one.
    if (!documentRefusedThis) {
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

// ── does this invocation ask first? ─────────────────────────────────────────
bool ForgeFrame::wantsParameterSheet(const std::string& id) const {
  const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
  if (d == nullptr) return false;
  // Nothing to ask about. view.*, edit.undo, file.new and the rest run on the
  // click, exactly as they did -- a sheet with no fields in it is a speed bump.
  if (forge::ui::editableParameters(*d).empty()) return false;
  // ── THE FILE PANEL IS ALREADY THIS COMMAND'S WAY OF ASKING ──────────────
  // The six commands in the policy table declare exactly ONE parameter between
  // them -- `path`, measured -- and the application asks for it with a native
  // panel, or (when there is no panel to show) with this same prompt reached
  // through the shell's own MissingRequiredParameter answer. Offering a text
  // sheet here as well is not a second chance to type, it is a SECOND POLICY
  // over one command, and it broke the one case where the right answer is to
  // ask nothing at all:
  //
  //   File > Save on a document that already has a path must SAVE IT, silently.
  //   wantsFileDialog() returns false for exactly that case, by design and with
  //   a comment saying so -- so control fell through to here and Save put a TEXT
  //   BOX on screen and wrote nothing. MEASURED with a panel installed (the
  //   shipping configuration): first Save wrote 706 bytes; a second Save after an
  //   edit left the file at 706 bytes and the document dirty, while Ctrl+S on the
  //   identical state wrote 821. Two invokers, two outcomes -- which is the
  //   defect this function's own header comment names as the reason the single
  //   registry exists.
  FileDialogPolicy filePolicy;
  if (fileDialogPolicyFor(id, filePolicy)) return false;
  // THE THREE RE-ENTRIES. Each of these is invoke() being called a SECOND time
  // for the same command by something that has already collected the values:
  // the sheet's own Run, a finished gizmo drag, a path chosen in the file panel.
  // invoke() reads all three into `overrides` a few lines above; asking again
  // here would re-open the box over the answer and the command would never run.
  // (A sheet STANDING on this command is a different question and is answered at
  // the top of invoke(); what is left here is the spent one-shot the empty
  // state's sample buttons plant, which carries its answer with it.)
  if (promptCommand_ == id) return false;
  if (handleCommand_ == id) return false;
  if (dialogCommand_ == id) return false;
  return true;
}

// ── the parameter prompt ────────────────────────────────────────────────────
void ForgeFrame::openPrompt(const std::string& id, const std::vector<std::string>& parameters,
                            const forge::ui::CommandParams* seed) {
  const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
  promptCommand_ = id;
  promptOpen_ = true;
  promptFocus_ = false;
  // The witness submitPrompt() reads across its own dispatch. Incremented on
  // every raise, including a re-raise of the same command, because "the command
  // came back still needing a parameter" is exactly a re-raise of the same id.
  ++promptOpens_;
  promptFields_.clear();
  for (const std::string& name : parameters) {
    PromptField field;
    field.name = name;
    field.type = forge::ui::ParamType::Text;
    if (d != nullptr) {
      for (const forge::ui::ParamSpec& p : d->schema) {
        if (p.name != name) continue;
        field.type = p.type;
        break;
      }
    }
    // ── THE VALUE THIS INVOCATION WAS ABOUT TO USE ──────────────────────────
    // `seed` is the merged CommandParams the dispatch would have carried -- the
    // schema's own defaults, with the Properties slider and a drag's numbers
    // already layered on top. Reading the box back out therefore reproduces the
    // old behaviour exactly, which is the property that lets a sheet open on
    // EVERY parameterised command without making any of them slower: Run, and
    // you get what the click used to give you.
    if (seed != nullptr) {
      switch (field.type) {
        case forge::ui::ParamType::Number:
          if (const std::optional<double> v = seed->number(name)) {
            std::snprintf(field.value.data(), field.value.size(), "%s",
                          numberForBox(*v).c_str());
          }
          break;
        case forge::ui::ParamType::Flag:
          if (const std::optional<bool> v = seed->flag(name)) {
            std::snprintf(field.value.data(), field.value.size(), "%s", *v ? "on" : "off");
          }
          break;
        case forge::ui::ParamType::Text:
          if (const std::optional<std::string> v = seed->text(name)) {
            std::snprintf(field.value.data(), field.value.size(), "%s", v->c_str());
          }
          break;
      }
    }
    // ── A BOOLEAN IS NEVER "BLANK" ──────────────────────────────────────────
    // All four Flag parameters are optional with no declared default, so the
    // seed has nothing to say about them and the box opened EMPTY -- a checkbox
    // with no state, or (before this) a free-text box in which the user had to
    // guess the spelling of yes. Off is not an invention here: `flagOn()` is what
    // the handlers ask, and an absent flag is already off, so the box now shows
    // the state the command was going to use either way.
    if (field.type == forge::ui::ParamType::Flag && field.value[0] == '\0') {
      std::snprintf(field.value.data(), field.value.size(), "off");
    }
    if (field.value[0] != '\0') {
      promptFields_.push_back(std::move(field));
      continue;  // the seed answered it; the two app-knowledge seeds below are
                 // for the parameters no default can answer
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
  // WHAT THIS LINE SAYS NOW DEPENDS ON WHETHER THE BOXES ARE FULL. "<command>
  // needs width, height" was true while the only prompt in the application was a
  // dead-end rescue for a value nothing could supply. It is false of a sheet that
  // opens holding 40 and 30, and a status line that reports a value missing while
  // it is on screen in front of the user is how people learn to stop reading the
  // status line. So the empty boxes are named, and when there are none the line
  // says what is actually true.
  std::string blank;
  for (const PromptField& f : promptFields_) {
    if (f.value[0] != '\0') continue;
    if (!blank.empty()) blank += ", ";
    blank += f.name;
  }
  if (blank.empty()) {
    note(label + " — set the values and press Run");
  } else {
    note(label + " — type " + blank + ", then press Run");
  }
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
      // answers that today by writing into ~/.forge -- a directory the user
      // never chose and has no reason to guess -- under the first FREE name in
      // the untitled series (see firstFreeFallbackPath(): it may only ever
      // CREATE a file, never replace one). That is the case the panel is for,
      // and it is the only one: a document that came from a file is saved back
      // to that file, silently, on every Ctrl+S.
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

forge::ui::ParamType ForgeFrame::promptFieldType(const std::string& name) const {
  for (const PromptField& f : promptFields_) {
    if (f.name == name) return f.type;
  }
  return forge::ui::ParamType::Text;
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
  //
  // `promptSubmitting_` is what tells invoke() that THIS re-entry carries the
  // answers. Without it the flag's job was being done by `promptCommand_ == id`,
  // which is equally true of an ordinary click on the menu row behind the sheet.
  const std::size_t opensBefore = promptOpens_;
  promptSubmitting_ = true;
  invoke(id);
  promptSubmitting_ = false;
  const bool ran = lastInvokeOk_;
  // ── THE SHEET STAYS UP ONLY WHEN invoke() PUT A NEW ONE THERE ───────────
  // A command that still needs a parameter re-raises the prompt from inside
  // invoke(), and that one must survive: it is a correction the user can make in
  // the box in front of them.
  //
  // The test this replaces was `promptOpen_ && promptCommand_ == id && !ran`,
  // which is ALSO true when nothing re-raised anything and the sheet the user
  // pressed Run on is simply still there. So every refusal a sheet cannot fix
  // left it standing for ever -- MEASURED: Edge Fillet with nothing selected
  // opens a sheet, Run refuses it, and the sheet was still on screen with no way
  // to make it go. The counter distinguishes a NEW sheet from the old one; the
  // string could not.
  const bool reRaised = promptOpens_ != opensBefore && promptOpen_ && promptCommand_ == id;
  if (!reRaised) cancelPrompt();
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
// ONE place builds a face reference. setPreselectedFace and clickFace each held
// a copy of these three lines, and the bodyId half of one of them was a literal
// for a while after the other had been fixed -- so hovering named the live body
// and clicking named a node that had stopped existing. The drawing panels need
// the same reference to attach a note or a datum to a face, which would have
// made it three copies.
forge::ui::EntityRef ForgeFrame::faceRefFor(std::uint32_t faceId) const {
  forge::ui::EntityRef ref;
  ref.bodyId = activeBodyNode();
  ref.kind = forge::ui::EntityKind::Face;
  ref.persistentName = "face@" + std::to_string(faceId);
  return ref;
}

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
  shell_.selection().setPreselection(faceRefFor(faceId));
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
  const forge::ui::EntityRef ref = faceRefFor(faceId);
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

std::vector<std::uint32_t> ForgeFrame::highlightFaceIds() const {
  std::vector<std::uint32_t> ids = selectedFaceIds();
  bool wholeBody = false;
  for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
    if (r.kind == forge::ui::EntityKind::Body) wholeBody = true;
  }
  if (!wholeBody) return ids;
  // A selected body lights every face it has. Without this a body selection
  // highlighted NOTHING -- the viewport looked exactly as it does with an empty
  // selection while the status strip said one entity was picked, and the only
  // way to tell was to read the strip.
  const std::uint32_t faces = scene_.faceCount();
  ids.clear();
  ids.reserve(faces);
  for (std::uint32_t f = 1; f <= faces; ++f) ids.push_back(f);
  return ids;
}

void ForgeFrame::syncSelectionToScene() {
  if (scene_.applySelection(highlightFaceIds()) > 0) viewportRequest_.selectionDirty = true;
}

// ── edge selection ──────────────────────────────────────────────────────────
bool ForgeFrame::edgePickMode() const {
  return shell_.selection().filter() == forge::ui::EntityKind::Edge;
}

// ── PICKING THE BODY IN THE VIEWPORT ────────────────────────────────────────
//
// ★ MEASURED DEFECT, closed here. The status strip has always offered SEVEN
// values in its pick filter -- any, face, edge, vertex, body, sketch, feature --
// and the viewport could produce exactly TWO kinds of reference: Face and Edge.
// Choosing `body` therefore left the application unable to pick ANYTHING: every
// ray hit went down the face branch, clickFace built a Face ref, and
// SelectionService::accepts(Face) refused it under a Body filter, so every click
// printed "The pick filter is not set to face, so this face was not picked" and
// nothing was ever selected. THIRTEEN registry commands declare a Body signature
// -- part.move, part.rotate, the three patterns, part.mirror, the three
// booleans, part.heal, part.verify, part.fold_flange and part.section_curve --
// and the ONLY way to satisfy any of them was to find the right row in the
// feature tree. A CAD user selects a body by clicking the body.
bool ForgeFrame::bodyPickMode() const {
  return shell_.selection().filter() == forge::ui::EntityKind::Body;
}

bool ForgeFrame::activeBodyRef(forge::ui::EntityRef& out) const {
  const std::vector<forge::ui::FeatureRecord>& records = partDoc_.records();
  if (records.empty()) return false;
  const int irId = records.back().irId;
  if (forge::ui::entityKindFor(partDoc_.kindOf(irId)) != forge::ui::EntityKind::Body) {
    return false;
  }
  const std::string node = partDoc_.nodeFor(irId);
  if (node.empty()) return false;
  out = forge::ui::EntityRef{};
  out.bodyId = node;
  out.kind = forge::ui::EntityKind::Body;
  // The SAME spelling clickFeature uses. See the header: two spellings of one
  // selection make toggle() add where it should remove.
  out.persistentName = "feature@" + std::to_string(irId);
  return true;
}

void ForgeFrame::setPreselectedBody(bool under) {
  // No single face lights up for a body hover: the body is the thing under the
  // cursor, and lighting one of its faces would say the opposite.
  hoverFace_ = 0;
  hoverEdge_ = forge::ui::kNoEdge;
  forge::ui::EntityRef ref;
  if (!under || !activeBodyRef(ref)) {
    shell_.selection().clearPreselection();
    return;
  }
  shell_.selection().setPreselection(ref);
}

void ForgeFrame::clickBody(bool under, bool additive) {
  forge::ui::EntityRef ref;
  if (!under || !activeBodyRef(ref)) {
    if (!additive) {
      shell_.selection().clearSelection();
      syncSelectionToScene();
      note("Selection cleared");
    }
    return;
  }
  if (!shell_.selection().accepts(ref.kind)) {
    note("The pick filter is not set to body, so this body was not picked");
    return;
  }
  if (additive) {
    shell_.selection().toggle(ref);
  } else {
    shell_.selection().replaceWith({ref});
  }
  shell_.selection().setFocus(ref);
  syncSelectionToScene();
  note("Picked the body  (" + std::to_string(shell_.selection().count()) + " picked in all)");
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
  // ...and BEFORE the question is drawn, the condition it asks about is re-read.
  // Everything that can save the document -- Ctrl+S, the file panel, a menu
  // click, Archie -- has had its turn by this point in the previous frame, so
  // the question is never DRAWN claiming unsaved changes that are already saved.
  refreshQuitPrompt();
  // The unsaved-changes question, drawn last of the three so it sits in front of
  // them: it is the one the user has to answer before the application will go.
  drawQuitPrompt();

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
  // The Dimensions panel's Apply, deferred for the reason every mutation in this
  // class is: it rewrites a statement, which rebuilds the document, the feature
  // tree and the scene, and the walk that drew the button was indexing the tree.
  if (pendingSketchEditValid_) {
    pendingSketchEditValid_ = false;
    applySketchDimensionEdit(pendingSketchEditIrId_, pendingSketchEditValue_);
  }
  // Run on the parameter prompt, deferred for the same reason: it dispatches a
  // command that can replace the document (file.open, app.load_sample) and
  // rebuild the feature tree the walk was indexing.
  if (pendingPromptSubmit_) {
    pendingPromptSubmit_ = false;
    submitPrompt();
  }
  // The answer to the unsaved-changes question, deferred for the same reason:
  // "Save and Close" dispatches file.save, which can raise a file panel and
  // rebuild the document and the feature tree the walk was indexing. It runs
  // BEFORE runPendingFileDialog() below so a Save that is owed a panel gets it
  // in this frame rather than the next one.
  applyPendingQuitAnswer();
  // A FINISHED HANDLE DRAG. Same deferral, same reason: the gizmo lives in the
  // viewport, the viewport is a docked panel, and part.move / part.rotate
  // rebuild the document and the feature tree the walk was indexing. The flag
  // is cleared BEFORE the dispatch; handleCommand_ is NOT, because invoke()
  // reads it (and handleParams_) as the override for exactly this command --
  // the same mechanism promptCommand_/promptFields_ and dialogCommand_/
  // dialogPath_ already use, so a value from a DRAG and a value typed by hand
  // travel one route into CommandParams and there is no second dispatch path.
  if (pendingHandleDispatch_) {
    pendingHandleDispatch_ = false;
    const std::string id = handleCommand_;
    invoke(id);
    handleCommand_.clear();
  }
  // A command asked for from inside a docked panel — the empty state's buttons.
  // Cleared BEFORE the dispatch, so a handler that somehow records another one
  // is honoured on the next frame instead of being wiped by this line.
  if (!pendingInvokeId_.empty()) {
    const std::string id = pendingInvokeId_;
    pendingInvokeId_.clear();
    invoke(id);
    // ── THE ONE-SHOT FIELD SET IS SPENT ─────────────────────────────────────
    // The empty state's sample buttons plant promptCommand_ + promptFields_
    // WITHOUT opening a box -- that is how "load THIS sample" overrides
    // app.load_sample's honest default of "bracket". Left behind, that planted
    // set is indistinguishable from a sheet the user is answering, so the next
    // gesture on the same command would skip its sheet and silently reuse
    // yesterday's answer. Cleared only when nothing is on screen: a dispatch
    // that OPENED a sheet must keep it.
    if (!promptOpen_) cancelPrompt();
  }
  // The file panel, before Open Recent and after everything else: it runs a
  // MODAL nested event loop, so it must not start until the dock walk has
  // returned and every deferred mutation above has been applied -- the panel
  // blocks this thread until the user answers, and the frame it is standing in
  // front of is the one the walk just finished.
  runPendingFileDialog();
  // The Materials picker, on the same one-slot deferral: part.set_material
  // touches the document, and the combo that asks for it is drawn inside the
  // dock walk.
  runPendingMaterial();
  // The quality check, deferred like every other mutation: it runs the kernel
  // (in the worker, when one is configured), can take seconds and pumps this
  // host while it waits, so it must not run with a dock node held open.
  if (pendingQualityCheck_) {
    pendingQualityCheck_ = false;
    runQualityCheck();
  }
  // Open Recent, last: it REPLACES the document, so anything above that acts on
  // the document the user was looking at when they clicked must run first.
  runPendingOpen();

  // ── did the Save the user asked for on the way out actually happen? ──────
  // After the file panel, because that is where an untitled document's name
  // comes from, and after the open, because a document replaced in this frame
  // is the one the answer applies to.
  resolveQuitAfterSave();

  // ── the autosave cadence ────────────────────────────────────────────────
  // The application's own clock, taken from the frame time rather than from a
  // wall clock, so a headless gate steps it deterministically and the cadence is
  // a value rather than a wait. A no-op in every build that never called
  // beginRecoverySession(), which is every gate that is not about autosave.
  autosaveTick(static_cast<double>(ImGui::GetIO().DeltaTime));
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
    // requestQuit(), NOT `quit_ = true`. That assignment was the whole of this
    // application's shutdown path and it discarded every unsaved edit without a
    // word; the guard is what turns it into a question.
    if (ImGui::MenuItem("Quit")) requestQuit();
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
          "body  — feeds Move, Rotate, the patterns, Mirror and the booleans, "
          "and puts the drag handles on the part\n"
          "The filter also REFUSES a pick of any other kind, so a command can "
          "never run on the wrong topology.");
    }
    if (edgePickMode()) {
      ImGui::SameLine();
      ImGui::TextColored(rgb(90, 184, 242), "edge pick");
    } else if (bodyPickMode()) {
      ImGui::SameLine();
      ImGui::TextColored(rgb(90, 184, 242), "body pick");
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

// ── "show me that panel" ────────────────────────────────────────────────────
// A depth-first walk of the main window's tree for the tab group that holds the
// named panel, answered as the SAME (path, index) pair the tab strip records. It
// goes through setActiveTabAt so the choice is serialized exactly like a click,
// which is what keeps "show this panel" and "the user clicked this tab" one
// mechanism rather than two.
bool ForgeFrame::focusPanel(const std::string& panelId) {
  const forge::ui::DockWindow* window = shell_.layout().mainWindow();
  if (window == nullptr) return false;
  std::vector<std::size_t> path;
  std::vector<std::size_t> found;
  std::size_t index = 0;
  bool hit = false;
  // An explicit stack rather than recursion into a lambda: the node references
  // are read-only here and never outlive the walk, and setActiveTabAt (which
  // re-seats the whole layout) is called only AFTER it finishes.
  std::function<void(const forge::ui::DockNode&)> walk =
      [&](const forge::ui::DockNode& node) {
        if (hit) return;
        if (node.kind == forge::ui::DockNodeKind::Tabs) {
          for (std::size_t i = 0; i < node.panels.size(); ++i) {
            if (node.panels[i] != panelId) continue;
            found = path;
            index = i;
            hit = true;
            return;
          }
          return;
        }
        for (std::size_t c = 0; c < node.children.size(); ++c) {
          path.push_back(c);
          walk(node.children[c]);
          path.pop_back();
          if (hit) return;
        }
      };
  walk(window->root);
  if (!hit) return false;
  setActiveTabAt(found, index);
  return true;
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
  } else if (panelId == "constraints") {
    drawConstraintsPanel();
    drawSketchConstraintsPanel();
  } else if (panelId == "relations") {
    drawRelationsPanel();
    drawSketchRelationsPanel();
  } else if (panelId == "solver_status") {
    drawSolverStatusPanel();
  } else if (panelId == "isocline") {
    drawIsoclinePanel();
  } else if (panelId == "continuity") {
    drawContinuityPanel();
  } else if (panelId == "tool_library") {
    drawToolLibraryPanel();
  } else if (panelId == "properties" || panelId == "operation_params") {
    drawPropertiesPanel();
  } else if (panelId == "dimensions") {
    drawDimensionsPanel();
    drawSketchDimensionsPanel();
  } else if (panelId == "curve_list") {
    drawCurveListPanel();
    drawSketchCurvesPanel();
  } else if (panelId == "console" || panelId == "archie_trace" || panelId == "solver_log" ||
             panelId == "simulation_log") {
    drawConsolePanel();
  } else if (panelId == "title_block") {
    drawTitleBlockPanel();
  } else if (panelId == "view_list") {
    drawViewListPanel();
  } else if (panelId == "gdt") {
    drawGdtPanel();
  } else if (panelId == "annotation") {
    drawAnnotationPanel();
  } else if (panelId == "timeline") {
    drawTimelinePanel();
  } else if (panelId == "measure") {
    drawMeasurePanel();
  } else if (panelId == "appearance") {
    drawMaterialPanel();
  } else if (panelId == "materials") {
    drawMaterialsPanel();
  } else if (panelId == "curve_list") {
    drawCurveListPanel();
  } else if (panelId == "stock") {
    drawStockPanel();
  } else if (panelId == "verify_report") {
    drawVerifyReportPanel();
  } else if (panelId == "dimensions") {
    drawDimensionsPanel();
  } else if (panelId == "restraints") {
    drawRestraintsPanel();
  } else if (panelId == "loads") {
    drawLoadsPanel();
  } else if (panelId == "archie_tools") {
    drawToolsPanel();
  } else if (panelId == "tool_library") {
    drawToolLibraryPanel();
  } else if (panelId == "post_output") {
    drawPostOutputPanel();
  } else if (panelId == "bom") {
    drawBomPanel();
  } else if (panelId == "contacts") {
    drawContactsPanel();
  } else if (panelId == "component_filter") {
    drawComponentFilterPanel();
  } else if (panelId == "mates") {
    drawMatesPanel();
  } else if (panelId == "interference") {
    drawInterferencePanel();
  } else if (panelId == "continuity") {
    drawContinuityPanel();
  } else if (panelId == "isocline") {
    drawIsoclinePanel();
  } else if (panelId == "zebra_analysis") {
    drawZebraPanel();
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

  // ── the drag handles get the pointer FIRST ────────────────────────────────
  // Before navigation and before picking, because a click that grabs a handle
  // must not also orbit the camera and must not also select the face behind the
  // handle. `handlesOwnPointer` is true whenever the cursor is on a handle or a
  // drag is in flight, and it is what silences the two below.
  const bool handlesOwnPointer = updateManipulator(origin.x, origin.y, w, h, hovered);

  // ── navigation: the four profiles' drag verbs ─────────────────────────────
  NavInput nav;
  nav.left = ImGui::IsMouseDown(ImGuiMouseButton_Left);
  nav.middle = ImGui::IsMouseDown(ImGuiMouseButton_Middle);
  nav.right = ImGui::IsMouseDown(ImGuiMouseButton_Right);
  nav.shift = ImGui::GetIO().KeyShift;
  nav.ctrl = ImGui::GetIO().KeyCtrl;
  nav.alt = ImGui::GetIO().KeyAlt;
  const NavVerb verb =
      handlesOwnPointer ? NavVerb::None : navVerbFor(shell_.inputProfile(), nav);

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
  if (hovered && verb == NavVerb::None && !handlesOwnPointer && scene_.built()) {
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
    } else if (bodyPickMode()) {
      // The ray still strikes a FACE -- that is what the triangle soup can
      // answer -- but what the click NAMES is the solid that face belongs to.
      const PickResult pick = scene_.pick(ro, rd);
      setPreselectedBody(pick.hit());
      if (ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
        clickBody(pick.hit(), ImGui::GetIO().KeyShift || ImGui::GetIO().KeyCtrl);
      }
    } else {
      const PickResult pick = scene_.pick(ro, rd);
      setPreselectedFace(pick.faceId);
      if (ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
        clickFace(pick.faceId, ImGui::GetIO().KeyShift || ImGui::GetIO().KeyCtrl);
      }
    }
  } else if (!hovered && (hoverFace_ != 0 || hoverEdge_ != forge::ui::kNoEdge ||
                          shell_.selection().preselection().has_value())) {
    if (edgePickMode()) {
      setPreselectedEdge(forge::ui::kNoEdge);
    } else if (bodyPickMode()) {
      setPreselectedBody(false);
    } else {
      setPreselectedFace(0);
    }
  }
  viewportRequest_.hoverFace = hoverFace_;

  drawViewportOverlays(origin.x, origin.y, w, h);
  // AFTER the overlays and over them: a handle the triad or the camera readout
  // is drawn on top of is a handle a user cannot see to grab.
  drawManipulator(origin.x, origin.y, w, h);
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


// ── THE VIEWPORT DRAG HANDLES ───────────────────────────────────────────────
//
// WHAT THIS CLOSES, MEASURED. forge::ui::Manipulator (Manipulator.hpp/.cpp, 671
// lines, proved ray-for-ray by ui/test/manipulator_test.cpp) was compiled into
// this application by the forge_ui glob and CALLED BY NOTHING: `git grep -n
// Manipulator -- forge-desktop/src` returned no line. Its own header says the
// desktop click gate asserts the agreement between its reference camera and the
// real one; that gate did not mention it either. So the application had NO
// direct manipulation of any kind -- not a translate arrow, not a rotate ring,
// nothing in the viewport that could be dragged -- and the two commands that
// place a body, part.move (TRANSLATE) and part.rotate (ROTATE), were reachable
// only by picking a body row in the feature tree and TYPING six numbers into a
// parameter prompt. No CAD system asks a user to type a distance to move a part.
//
// Everything below is wiring. The arithmetic is not repeated here: the pivot,
// the arm, the ring, the hit test, the world-space drag solution and the
// emitted CommandParams all come from forge::ui, and the ONE thing this file
// adds is the projection, which is the SAME matrix Camera::viewProj() hands the
// renderer. That is deliberate -- a gizmo drawn through a second projection is a
// gizmo drawn where the hit test does not look.

bool ForgeFrame::manipulatorTarget(double pivot[3], double& armLength,
                                   forge::ui::MeasureBox& box) {
  armLength = 0.0;
  box = forge::ui::MeasureBox{};
  if (!scene_.built()) return false;

  // EXACTLY ONE BODY. Not "at least one": part.move and part.rotate both declare
  // SelectionSignature::exactly(EntityKind::Body, 1), so a gizmo offered on two
  // bodies would be a handle whose command the registry refuses -- which is the
  // "the button did nothing" failure a shared enabled-predicate exists to
  // prevent. A face or an edge selection puts no gizmo up either: those pick
  // sub-topology, and moving a body because one of its faces is lit is not what
  // anybody means.
  const std::vector<forge::ui::EntityRef>& refs = shell_.selection().selection();
  if (refs.size() != 1 || refs[0].kind != forge::ui::EntityKind::Body) return false;

  const forge::ui::MeasureMesh& mesh = measureMesh();
  if (mesh.empty()) return false;

  forge::ui::PickScene scene;
  scene.mesh = &mesh;
  // NO EdgeSet on purpose: a Body ref resolves through the triangle soup alone,
  // and calling edges() here would derive the whole edge set every frame for a
  // user who has not asked for an edge.
  // activeBodyNode(), for the reason spelled out in applyPendingSelectionFit:
  // NodeId is an integer and bodyId is a string, so the tree's root id silently
  // becomes a one-character string that matches no ref this app ever produces.
  scene.bodyId = activeBodyNode();
  const forge::ui::FramingBounds b = forge::ui::selectionBounds(scene, refs);
  if (!b.usable()) return false;

  box = b.box;
  box.centre(pivot);
  // The arm is a fraction of the HALF DIAGONAL, so a long thin part gets a
  // gizmo it can be seen against rather than one that vanishes inside it. The
  // rings are drawn larger still (see updateManipulator) so the arrow tip never
  // lands on a ring and makes the pick ambiguous.
  armLength = 0.62 * 0.5 * box.diagonal();
  if (!(armLength > 1e-6)) return false;
  return true;
}

bool ForgeFrame::updateManipulator(float x, float y, float w, float h, bool hovered) {
  handleHits_.clear();
  handlesVisible_ = false;

  // A drag ALREADY IN FLIGHT owns the pointer whatever the selection now says.
  // Recomputing the pivot mid-drag would move the thing the drag is measured
  // from, which turns a steady gesture into a runaway.
  const bool dragging = moveHandles_.dragging() || turnHandles_.dragging();

  double pivot[3] = {0.0, 0.0, 0.0};
  double arm = 0.0;
  forge::ui::MeasureBox box{};
  if (!dragging) {
    if (!manipulatorTarget(pivot, arm, box)) {
      moveHandles_.setMode(forge::ui::ManipulatorMode::Off);
      turnHandles_.setMode(forge::ui::ManipulatorMode::Off);
      return false;
    }
    handleBox_ = box;
    moveHandles_.setMode(forge::ui::ManipulatorMode::Translate);
    turnHandles_.setMode(forge::ui::ManipulatorMode::Rotate);
    moveHandles_.setPivot(pivot);
    turnHandles_.setPivot(pivot);
    moveHandles_.setSize(arm);
    turnHandles_.setSize(arm * 1.45);
  }

  float vp[16];
  camera_.viewProj(vp);
  if (!handleView_.set(vp, static_cast<double>(x), static_cast<double>(y),
                       static_cast<double>(w), static_cast<double>(h))) {
    // A camera whose view-projection does not invert cannot be dragged through.
    // Refuse rather than solve a singular system: a handle that answers a
    // degenerate matrix answers a number nobody can predict.
    moveHandles_.cancel();
    turnHandles_.cancel();
    return false;
  }
  handlesVisible_ = true;

  // WHERE EACH HANDLE IS, recorded from the SAME geometry the hit test walks.
  const forge::ui::HandleAxis axes[3] = {forge::ui::HandleAxis::X, forge::ui::HandleAxis::Y,
                                         forge::ui::HandleAxis::Z};
  double centre2[2] = {0.0, 0.0};
  const bool centreOk = handleView_.project(moveHandles_.pivot(), centre2);
  for (int k = 0; k < 3; ++k) {
    double tip[3], s[2];
    if (moveHandles_.axisTip(axes[k], tip) && handleView_.project(tip, s)) {
      HandleHit hit;
      hit.mode = forge::ui::ManipulatorMode::Translate;
      hit.axis = axes[k];
      hit.x = static_cast<float>(s[0]);
      hit.y = static_cast<float>(s[1]);
      handleHits_.push_back(hit);
    }
    // The ring sample FARTHEST from the projected pivot: a ring seen near
    // edge-on projects to a sliver, and its point 0 can land on top of the
    // centre. The far point is the one with screen extent, so it is the one a
    // pointer can reach and the one worth publishing.
    if (!centreOk) continue;
    double best2 = -1.0;
    HandleHit far;
    far.mode = forge::ui::ManipulatorMode::Rotate;
    far.axis = axes[k];
    bool haveFar = false;
    for (int i = 0; i < forge::ui::kManipulatorRingSegments; ++i) {
      double rp[3], rs[2];
      if (!turnHandles_.ringPoint(axes[k], i, rp)) break;
      if (!handleView_.project(rp, rs)) continue;
      const double dx = rs[0] - centre2[0];
      const double dy = rs[1] - centre2[1];
      const double d2 = dx * dx + dy * dy;
      if (d2 > best2) {
        best2 = d2;
        far.x = static_cast<float>(rs[0]);
        far.y = static_cast<float>(rs[1]);
        haveFar = true;
      }
    }
    if (haveFar) handleHits_.push_back(far);
  }

  const ImGuiIO& io = ImGui::GetIO();
  const double mx = static_cast<double>(io.MousePos.x);
  const double my = static_cast<double>(io.MousePos.y);
  // SNAP WHILE SHIFT IS HELD, applied to the RESULT and not to the cursor, so
  // the handle keeps tracking smoothly while the value that lands in the
  // history is on the grid. 1 mm and 15 degrees are the increments a mechanical
  // part is actually dimensioned in.
  const double tSnap = io.KeyShift ? 1.0 : 0.0;
  const double rSnap = io.KeyShift ? 15.0 : 0.0;
  moveHandles_.setSnap(tSnap, 0.0);
  turnHandles_.setSnap(0.0, rSnap);

  if (dragging) {
    forge::ui::Manipulator& g = moveHandles_.dragging() ? moveHandles_ : turnHandles_;
    g.dragTo(handleView_, mx, my);
    if (ImGui::IsMouseReleased(ImGuiMouseButton_Left)) {
      const forge::ui::ManipulatorEmission e = g.release();
      if (e.valid) {
        // DEFERRED, never dispatched here: this runs inside drawNode()'s
        // recursion and part.move rebuilds the document, the feature tree and
        // the scene the walk still holds references into. build() dispatches it
        // once the walk has returned, on the same one-slot deferral the empty
        // state's buttons use.
        handleCommand_ = e.commandId;
        handleParams_ = e.params;
        pendingHandleDispatch_ = true;
        ++handleEmissions_;
      } else {
        // A drag that moved nothing records nothing. Saying so is not noise:
        // the alternative is a gesture that looks like it worked and left no
        // feature behind.
        note("The handle was released without moving, so nothing was changed");
      }
    }
    return true;
  }

  const double tol = 9.0 * static_cast<double>(dpiScale_);
  moveHandles_.clearHover();
  turnHandles_.clearHover();
  forge::ui::ManipulatorHandle handle = moveHandles_.hitTest(handleView_, mx, my, tol);
  forge::ui::Manipulator* owner = &moveHandles_;
  if (!handle.valid()) {
    handle = turnHandles_.hitTest(handleView_, mx, my, tol);
    owner = &turnHandles_;
  }
  if (!handle.valid() || !hovered) return false;

  owner->setHover(handle);
  // Alt+LMB ORBITS in the Blender profile. A gizmo that swallowed that chord
  // would take a navigation gesture away from the one profile whose users
  // reach for it by habit, so the grab requires a PLAIN left button.
  if (ImGui::IsMouseClicked(ImGuiMouseButton_Left) && !io.KeyAlt) {
    owner->begin(handleView_, handle, mx, my);
  }
  return true;
}

void ForgeFrame::drawManipulator(float x, float y, float w, float h) {
  if (!handlesVisible_) return;
  ImDrawList* dl = ImGui::GetWindowDrawList();

  const ImU32 axisCols[3] = {ImGui::GetColorU32(rgb(232, 92, 84)),
                             ImGui::GetColorU32(rgb(122, 196, 108)),
                             ImGui::GetColorU32(rgb(96, 156, 240))};
  const ImU32 live = ImGui::GetColorU32(rgb(255, 214, 92));
  const char* axisNames[3] = {"X", "Y", "Z"};
  const forge::ui::HandleAxis axes[3] = {forge::ui::HandleAxis::X, forge::ui::HandleAxis::Y,
                                         forge::ui::HandleAxis::Z};

  const auto project = [this](const double* p, ImVec2& out) {
    double s[2];
    if (!handleView_.project(p, s)) return false;
    out = ImVec2(static_cast<float>(s[0]), static_cast<float>(s[1]));
    return true;
  };

  const forge::ui::ManipulatorHandle activeMove =
      moveHandles_.dragging() ? moveHandles_.active() : moveHandles_.hover();
  const forge::ui::ManipulatorHandle activeTurn =
      turnHandles_.dragging() ? turnHandles_.active() : turnHandles_.hover();

  ImVec2 centre;
  const bool centreOk = project(moveHandles_.pivot(), centre);

  // ── the three rotate rings, drawn as the SAME 48 chords the hit test walks ─
  for (int k = 0; k < 3; ++k) {
    const bool lit = activeTurn.axis == axes[k];
    const float thick = (lit ? 3.0f : 1.6f) * dpiScale_;
    const ImU32 col = lit ? live : axisCols[k];
    ImVec2 prev;
    bool havePrev = false;
    for (int i = 0; i <= forge::ui::kManipulatorRingSegments; ++i) {
      double rp[3];
      if (!turnHandles_.ringPoint(axes[k], i % forge::ui::kManipulatorRingSegments, rp)) break;
      ImVec2 s;
      if (!project(rp, s)) { havePrev = false; continue; }
      if (havePrev) dl->AddLine(prev, s, col, thick);
      prev = s;
      havePrev = true;
    }
  }

  // ── the three translate arrows ────────────────────────────────────────────
  if (centreOk) {
    for (int k = 0; k < 3; ++k) {
      double tip[3];
      ImVec2 t;
      if (!moveHandles_.axisTip(axes[k], tip) || !project(tip, t)) continue;
      const bool lit = activeMove.axis == axes[k];
      const ImU32 col = lit ? live : axisCols[k];
      dl->AddLine(centre, t, col, (lit ? 3.4f : 2.2f) * dpiScale_);
      // The head is drawn in SCREEN space so it stays the same size at any zoom.
      const float dx = t.x - centre.x;
      const float dy = t.y - centre.y;
      const float len = std::sqrt(dx * dx + dy * dy);
      if (len > 1.0f) {
        const float ux = dx / len;
        const float uy = dy / len;
        const float head = 11.0f * dpiScale_;
        const ImVec2 base(t.x - ux * head, t.y - uy * head);
        dl->AddTriangleFilled(t, ImVec2(base.x - uy * head * 0.42f, base.y + ux * head * 0.42f),
                              ImVec2(base.x + uy * head * 0.42f, base.y - ux * head * 0.42f), col);
      }
      dl->AddText(ImVec2(t.x + 6.0f * dpiScale_, t.y - 7.0f * dpiScale_), col, axisNames[k]);
    }
    dl->AddCircleFilled(centre, 3.5f * dpiScale_, ImGui::GetColorU32(rgb(226, 229, 234)));
  }

  // ── the drag in flight: the moved box, and the value ──────────────────────
  const bool movingNow = moveHandles_.dragging();
  const bool turningNow = turnHandles_.dragging();
  if ((movingNow || turningNow) && handleBox_.valid) {
    double off[3] = {0.0, 0.0, 0.0};
    double axis[3] = {0.0, 0.0, 1.0};
    double c = 1.0, s = 0.0;
    if (movingNow) {
      moveHandles_.previewOffset(off);
    } else {
      forge::ui::Manipulator::axisVector(turnHandles_.active().axis, axis);
      const double r = turnHandles_.rotationDegrees() * 0.017453292519943295;
      c = std::cos(r);
      s = std::sin(r);
    }
    const double* pv = turnHandles_.pivot();
    ImVec2 corner[8];
    bool ok[8];
    for (int i = 0; i < 8; ++i) {
      double p[3] = {(i & 1) ? handleBox_.max[0] : handleBox_.min[0],
                     (i & 2) ? handleBox_.max[1] : handleBox_.min[1],
                     (i & 4) ? handleBox_.max[2] : handleBox_.min[2]};
      if (movingNow) {
        for (int a = 0; a < 3; ++a) p[a] += off[a];
      } else {
        // Rodrigues about the ring's axis through the pivot -- the same rigid
        // motion ROTATE(%body, angle, ax, ay, az, ox, oy, oz) applies, so the
        // ghost is a preview of the statement and not an approximation of it.
        const double v[3] = {p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]};
        const double d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
        const double cr[3] = {axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2],
                              axis[0] * v[1] - axis[1] * v[0]};
        for (int a = 0; a < 3; ++a) {
          p[a] = pv[a] + v[a] * c + cr[a] * s + axis[a] * d * (1.0 - c);
        }
      }
      ok[i] = project(p, corner[i]);
    }
    const int edgesIdx[12][2] = {{0, 1}, {2, 3}, {4, 5}, {6, 7}, {0, 2}, {1, 3},
                                 {4, 6}, {5, 7}, {0, 4}, {1, 5}, {2, 6}, {3, 7}};
    for (const auto& e : edgesIdx) {
      if (ok[e[0]] && ok[e[1]]) dl->AddLine(corner[e[0]], corner[e[1]], live, 1.3f * dpiScale_);
    }

    char hud[96];
    if (movingNow) {
      std::snprintf(hud, sizeof(hud), "%s  %+.3f mm",
                    forge::ui::toString(moveHandles_.active().axis),
                    moveHandles_.translation());
    } else {
      std::snprintf(hud, sizeof(hud), "%s  %+.2f deg",
                    forge::ui::toString(turnHandles_.active().axis),
                    turnHandles_.rotationDegrees());
    }
    const ImVec2 m = ImGui::GetIO().MousePos;
    const ImVec2 ts = ImGui::CalcTextSize(hud);
    dl->AddRectFilled(ImVec2(m.x + 14, m.y - 30), ImVec2(m.x + 22 + ts.x, m.y - 26 + ts.y),
                      ImGui::GetColorU32(ImVec4(0.20f, 0.16f, 0.04f, 0.92f)), 3.0f);
    dl->AddText(ImVec2(m.x + 18, m.y - 28), live, hud);
  } else {
    // A gesture nobody knows about is a gesture nobody makes. One line, only
    // while the handles are up and nothing is being dragged, along the bottom
    // of the viewport where neither the triad nor the camera readout sits.
    const char* hint =
        "Drag an arrow to move this body, a ring to turn it. Hold Shift to snap to 1 mm "
        "and 15 degrees.";
    const ImVec2 ts = ImGui::CalcTextSize(hint);
    const ImVec2 at(x + 0.5f * (w - ts.x), y + h - ts.y - 14.0f * dpiScale_);
    dl->AddRectFilled(ImVec2(at.x - 8.0f, at.y - 4.0f),
                      ImVec2(at.x + ts.x + 8.0f, at.y + ts.y + 4.0f),
                      ImGui::GetColorU32(ImVec4(0.0f, 0.0f, 0.0f, 0.45f)), 3.0f);
    dl->AddText(at, ImGui::GetColorU32(rgb(198, 204, 214)), hint);
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
        field.type = forge::ui::ParamType::Text;
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

// ── THE SIX THAT STOPPED BEING EMPTY NEXT ───────────────────────────────────
//
// Three readings of the sketch family (forge/ui/SketchDiagnosis.hpp), two of the
// tessellation (forge/ui/SurfaceAnalysis.hpp), and one of what the cuts call for
// (forge/ui/ToolLibrary.hpp). Every number below is computed in forge::ui and
// asserted headless; this file arranges it and nothing more.

forge::ui::SketchDiagnosisSet ForgeFrame::sketchDiagnosis() const {
  return forge::ui::buildSketchDiagnosis(partDoc_);
}

forge::ui::DraftReport ForgeFrame::draftReport() {
  return forge::ui::buildDraftReport(measureMesh(), draftPull_, draftRequiredDeg_);
}

forge::ui::ContinuityReport ForgeFrame::continuityReport() {
  return forge::ui::buildContinuityReport(measureMesh(), modelMeasure());
}

forge::ui::ToolList ForgeFrame::toolList() const {
  return forge::ui::buildToolList(forge::ui::buildMachiningPlan(partDoc_));
}

void ForgeFrame::setRequiredDraft(double degrees) noexcept {
  if (!(degrees >= 0.0)) degrees = 0.0;   // also catches a NaN
  if (degrees > 45.0) degrees = 45.0;
  draftRequiredDeg_ = degrees;
}

namespace {

// The colour a constraint's state is drawn in. One place, so the three sketch
// panels can never disagree about what red means.
ImVec4 faultColour(forge::ui::ConstraintFault fault) {
  switch (fault) {
    case forge::ui::ConstraintFault::None:              return rgb(120, 200, 140);
    case forge::ui::ConstraintFault::UnknownKind:       return rgb(235, 105, 95);
    case forge::ui::ConstraintFault::OperandUnresolved: return rgb(235, 105, 95);
    case forge::ui::ConstraintFault::OperandCount:      return rgb(235, 105, 95);
    case forge::ui::ConstraintFault::Repeated:          return rgb(235, 175, 95);
    case forge::ui::ConstraintFault::Contradicts:       return rgb(235, 175, 95);
  }
  return rgb(130, 137, 148);
}

ImVec4 definitionColour(forge::ui::SketchDefinition definition) {
  switch (definition) {
    case forge::ui::SketchDefinition::Empty: return rgb(130, 137, 148);
    case forge::ui::SketchDefinition::Under: return rgb(235, 175, 95);
    case forge::ui::SketchDefinition::Fully: return rgb(120, 200, 140);
    case forge::ui::SketchDefinition::Over:  return rgb(235, 105, 95);
  }
  return rgb(130, 137, 148);
}

// What every sketch panel draws when the document holds no sketch at all. One
// sentence, in the user's words, saying what would put something here.
void drawNoSketchYet(const char* what) {
  ImGui::PushTextWrapPos(0.0f);
  ImGui::TextWrapped("No sketch has been drawn yet. Start one from the Sketch tools, put points, "
                     "lines, circles and arcs in it, and %s appears here.", what);
  ImGui::PopTextWrapPos();
}

}  // namespace

// ── the sketch's constraints ────────────────────────────────────────────────
//
// WHAT IS HELD, and -- the half a user actually opens this for -- what is NOT.
// A constraint the kernel skips is drawn in the colour of a problem, with the
// reason beside it, because a constraint that silently holds nothing is how a
// sketch moves when the user is sure it cannot.
void ForgeFrame::drawConstraintsPanel() {
  constraintRowsDrawn_ = 0;
  const forge::ui::SketchDiagnosisSet set = sketchDiagnosis();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();
  if (set.empty()) {
    drawNoSketchYet("every constraint holding it");
    return;
  }
  ImGui::TextColored(rgb(130, 137, 148), "%zu constraints over %zu sketches | %zu hold nothing",
                     set.constraintCount(), set.sketches.size(), set.faultCount());

  for (const forge::ui::SketchDiagnosis& d : set.sketches) {
    ++constraintRowsDrawn_;
    ImGui::PushID(d.irId);
    if (ImGui::TreeNodeEx("##sketch", ImGuiTreeNodeFlags_DefaultOpen, "%s   on %s   %zu",
                          d.label.c_str(), d.plane.empty() ? "its plane" : d.plane.c_str(),
                          d.constraints.size())) {
      if (d.constraints.empty()) {
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextWrapped("Nothing holds this sketch yet. Pick two things in it and add a "
                           "constraint, and it appears here.");
        ImGui::PopTextWrapPos();
      }
      for (const forge::ui::SketchConstraintRow& c : d.constraints) {
        ++constraintRowsDrawn_;
        ImGui::PushID(c.irId);
        ImGui::Bullet();
        ImGui::TextColored(faultColour(c.fault), "%-14s %s", c.name.c_str(), c.evidence.c_str());
        if (c.fault != forge::ui::ConstraintFault::None) {
          ImGui::SameLine();
          ImGui::TextColored(rgb(130, 137, 148), "-- %s", forge::ui::toString(c.fault));
        }
        if (ImGui::IsItemHovered()) {
          if (c.fault == forge::ui::ConstraintFault::None) {
            ImGui::SetTooltip("%s: holds %zu of the numbers this sketch is free in.",
                              c.name.c_str(), c.holds);
          } else {
            ImGui::SetTooltip("%s holds nothing: %s.", c.name.c_str(),
                              forge::ui::toString(c.fault));
          }
        }
        ImGui::PopID();
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }
}

// ── what moves with what ────────────────────────────────────────────────────
//
// Drag one thing in a sketch and a set of others follow it. That set is the
// group of geometry reachable through the lines built on it and the constraints
// holding it, and two groups that share nothing are independent -- which is the
// other half of the same answer and the reason a sketch sometimes will not close.
void ForgeFrame::drawRelationsPanel() {
  relationRowsDrawn_ = 0;
  const forge::ui::SketchDiagnosisSet set = sketchDiagnosis();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();
  if (set.empty()) {
    drawNoSketchYet("what moves with what");
    return;
  }

  for (const forge::ui::SketchDiagnosis& d : set.sketches) {
    ++relationRowsDrawn_;
    ImGui::PushID(d.irId);
    // The links that touch each row, gathered ONCE. Scanning every link inside
    // the member loop is quadratic in the size of the sketch, and a sketch is
    // the one thing in this application a user makes hundreds of rows long --
    // which is why the feature tree beside it is virtualized.
    std::vector<std::vector<std::size_t>> linksOf(d.geometry.size());
    for (std::size_t li = 0; li < d.links.size(); ++li) {
      const forge::ui::SketchLink& link = d.links[li];
      if (link.from < linksOf.size()) linksOf[link.from].push_back(li);
      if (link.to < linksOf.size()) linksOf[link.to].push_back(li);
    }
    if (ImGui::TreeNodeEx("##sketch", ImGuiTreeNodeFlags_DefaultOpen, "%s   %zu groups",
                          d.label.c_str(), d.clusters.size())) {
      if (d.clusters.size() > 1) {
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextColored(rgb(235, 175, 95),
                           "These groups move independently. Nothing ties them to each other, "
                           "so dragging one leaves the rest where they are.");
        ImGui::PopTextWrapPos();
      }
      for (std::size_t g = 0; g < d.clusters.size(); ++g) {
        const forge::ui::SketchCluster& cluster = d.clusters[g];
        ++relationRowsDrawn_;
        ImGui::PushID(static_cast<int>(g));
        char header[96];
        std::snprintf(header, sizeof(header), "Group %zu   %zu things, %zu of %zu numbers held",
                      g + 1, cluster.members.size(), cluster.held, cluster.freedoms);
        if (ImGui::TreeNodeEx("##group", ImGuiTreeNodeFlags_DefaultOpen, "%s", header)) {
          if (cluster.pinned) {
            ImGui::TextColored(rgb(120, 200, 140), "pinned in place");
          }
          for (std::size_t m : cluster.members) {
            if (m >= d.geometry.size()) continue;
            const forge::ui::SketchGeometryRow& row = d.geometry[m];
            ++relationRowsDrawn_;
            ImGui::Bullet();
            ImGui::Text("%-8s %-16s %s", forge::ui::sketchGeometryWord(row.kind),
                        row.label.c_str(), row.evidence.c_str());
            // What ties this one to the rest: the things it is built on, and
            // the constraints that name it.
            std::string ties;
            for (std::size_t li : linksOf[m]) {
              const forge::ui::SketchLink& link = d.links[li];
              const std::size_t other = link.from == m ? link.to : link.from;
              if (other >= d.geometry.size()) continue;
              if (!ties.empty()) ties += ", ";
              ties += std::string(forge::ui::toString(link.kind)) + " " +
                      d.geometry[other].label;
            }
            if (!ties.empty() && ImGui::IsItemHovered()) {
              ImGui::SetTooltip("%s: %s", row.label.c_str(), ties.c_str());
            }
            if (ties.empty()) {
              ImGui::SameLine();
              ImGui::TextColored(rgb(235, 175, 95), "nothing ties this to anything else");
            }
          }
          ImGui::TreePop();
        }
        ImGui::PopID();
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }
}

// ── whether the sketch is pinned down ───────────────────────────────────────
//
// The one question a sketcher has. What is drawn is the count from the sketch's
// own geometry and constraints, and the panel SAYS that is what it is: the exact
// answer is a rank analysis the kernel does when the sketch is solved, and this
// is what every sketcher shows before that.
void ForgeFrame::drawSolverStatusPanel() {
  solverRowsDrawn_ = 0;
  const forge::ui::SketchDiagnosisSet set = sketchDiagnosis();

  ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
  ImGui::Separator();
  if (set.empty()) {
    drawNoSketchYet("whether it is pinned down");
    return;
  }
  ImGui::TextColored(rgb(130, 137, 148), "%zu of %zu sketches are not fully held yet",
                     set.unresolved(), set.sketches.size());

  for (const forge::ui::SketchDiagnosis& d : set.sketches) {
    ++solverRowsDrawn_;
    ImGui::PushID(d.irId);
    if (ImGui::TreeNodeEx("##sketch", ImGuiTreeNodeFlags_DefaultOpen, "%s", d.label.c_str())) {
      ImGui::TextColored(definitionColour(d.definition), "%s",
                         forge::ui::toString(d.definition));
      ++solverRowsDrawn_;
      ImGui::Text("free numbers   %zu", d.freedoms);
      ++solverRowsDrawn_;
      ImGui::Text("held           %zu", d.held);
      ++solverRowsDrawn_;
      if (d.stillFree > 0) {
        ImGui::TextColored(rgb(235, 175, 95), "still free     %d", d.stillFree);
      } else if (d.stillFree < 0) {
        ImGui::TextColored(rgb(235, 105, 95), "held more than needed by   %d", -d.stillFree);
      } else {
        ImGui::TextColored(rgb(120, 200, 140), "still free     0");
      }
      ++solverRowsDrawn_;

      if (d.untouched > 0) {
        ImGui::PushTextWrapPos(0.0f);
        ImGui::TextColored(rgb(235, 175, 95),
                           "%zu things in this sketch are held by nothing at all:", d.untouched);
        ImGui::PopTextWrapPos();
        for (const forge::ui::SketchGeometryRow& row : d.geometry) {
          if (row.freedoms == 0) continue;
          bool touched = false;
          for (std::size_t ci : row.constraints) {
            if (ci < d.constraints.size() &&
                d.constraints[ci].fault == forge::ui::ConstraintFault::None) {
              touched = true;
            }
          }
          if (touched) continue;
          ++solverRowsDrawn_;
          ImGui::Bullet();
          ImGui::TextColored(rgb(235, 175, 95), "%-8s %s",
                             forge::ui::sketchGeometryWord(row.kind), row.label.c_str());
        }
      }
      if (d.faults > 0) {
        ++solverRowsDrawn_;
        ImGui::TextColored(rgb(235, 105, 95), "%zu constraints hold nothing -- see Constraints",
                           d.faults);
      }
      if (d.clusters.size() > 1) {
        ++solverRowsDrawn_;
        ImGui::TextColored(rgb(235, 175, 95), "%zu groups move independently -- see Relations",
                           d.clusters.size());
      }
      if (d.solvedBy != 0) {
        ++solverRowsDrawn_;
        ImGui::TextColored(rgb(120, 200, 140), "solved, and its shape is in use");
      }
      ImGui::TreePop();
    }
    ImGui::PopID();
  }

  ImGui::Separator();
  ImGui::PushTextWrapPos(0.0f);
  ImGui::TextDisabled("Counted from the points, radii and constraints of the sketch itself. "
                      "Two constraints that happen to say the same thing are counted twice "
                      "here and once when the sketch is solved.");
  ImGui::PopTextWrapPos();
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
    // ── THE SAME WEIGHT THE MATERIALS TAB REPORTS ─────────────────────────
    // partMass() is ONE call over the document's material and the volume
    // printed on the line above, so these two panels cannot answer "what does
    // it weigh" differently. Two readouts of one physical quantity that can
    // disagree will, and a user who found them disagreeing would be right to
    // stop trusting both.
    ImGui::Text("made of %s", partDoc_.material().name.c_str());
    ImGui::Text("weight %s",
                forge::ui::describeMass(partMass(), forge::ui::MassUnit::Gram).c_str());
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



// ── the simulation study: what holds the part, what pushes on it ────────────
//
// TWO PANELS AND ONE STUDY. Restraints and Loads are two views of one set-up, so
// they share the footer that carries the material, the mesh density, the Run
// button and the answer -- and they share it as one FUNCTION, not as two copies
// that have to be kept saying the same thing.
//
// ★ EVERY NUMBER BELOW IS MEASURED. The extent comes from the same triangle soup
// the Measure panel reports; the mesh point counts, the peak movement, the peak
// stress, the out-of-balance force and the elapsed time all come back from a
// real solve of the real part, through forge::desktop::runStudy. Where a number
// does not exist yet -- before the first run, or after an edit -- it is NOT
// shown. A panel that keeps printing the answer to a part the user has since
// changed is worse than one that prints nothing, because the number looks alive.

bool ForgeFrame::setStudyMaterial(const std::string& id) {
  const forge::ui::Material* m = forge::ui::findMaterial(id);
  if (m == nullptr) return false;
  study_.materialId = m->id;
  study_.materialName = m->name;
  study_.densityKgPerM3 = m->densityKgPerM3;
  // The answer was computed with the OLD material. Dropping it is the same rule
  // the staleness witness applies to a geometry edit.
  studyOutcome_ = forge::ui::StudyOutcome{};
  studyProgram_.clear();
  return true;
}

bool ForgeFrame::studyOutcomeIsStale() const {
  if (!studyOutcome_.solved) return false;
  return studyProgram_ != partDoc_.irProgram();
}

bool ForgeFrame::runStudy() {
  StudyRequest request;
  request.irProgram = partDoc_.irProgram();
  request.inputFile = scene_.inputFile();
  request.study = study_;
  std::string detail;
  studyOutcome_ = forge::desktop::runStudy(request, detail);
  studyProgram_ = request.irProgram;
  ++studyRuns_;
  if (studyOutcome_.solved) {
    char line[192];
    std::snprintf(line, sizeof(line),
                  "study solved: %zu mesh points, largest movement %.4f mm, highest stress "
                  "%.2f MPa",
                  studyOutcome_.meshNodes, studyOutcome_.maxDisplacementMm,
                  studyOutcome_.maxStressMPa);
    note(line);
    shell_.log().info("simulation", line, detail);
  } else {
    // The SENTENCE goes to the user; the cause goes to the log's detail field,
    // which is the one place in this application that is meant to carry it.
    note(studyOutcome_.blocker);
    shell_.log().warning("simulation", studyOutcome_.blocker, detail);
  }
  return studyOutcome_.solved;
}

namespace {

// The extent of the part along one axis, in millimetres, or 0 when there is no
// part. Read off the SAME measured box the Measure panel prints, so the two
// panels cannot report different sizes for one model.
const char* kAxisNames[3] = {"x", "y", "z"};

}  // namespace

void ForgeFrame::drawStudyFooter(const char* scopeId) {
  ImGui::PushID(scopeId);
  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Study");
  ImGui::Separator();

  // ── the material ────────────────────────────────────────────────────────
  // The picker is here rather than on a Materials tab because the study cannot
  // run without one, and a control the user has to go and find is a control that
  // makes a panel look broken.
  const forge::ui::ElasticProperties* elastic =
      study_.materialId.empty() ? nullptr : forge::ui::elasticPropertiesFor(study_.materialId);
  ImGui::Text("Material");
  ImGui::SetNextItemWidth(-1);
  const std::string current = study_.materialName.empty() ? std::string("(none chosen)")
                                                          : study_.materialName;
  if (ImGui::BeginCombo("##studymaterial", current.c_str())) {
    for (const forge::ui::Material& m : forge::ui::materialLibrary()) {
      // A material with no weight cannot be stretched either: offering it would
      // be offering a choice that can only refuse.
      if (!m.hasDensity()) continue;
      if (forge::ui::elasticPropertiesFor(m.id) == nullptr) continue;
      const bool isSel = m.id == study_.materialId;
      if (ImGui::Selectable(m.name.c_str(), isSel)) setStudyMaterial(m.id);
      if (isSel) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  if (elastic != nullptr) {
    ImGui::Text("           stiffness %.1f GPa, sideways spread %.2f, density %.0f kg/m3",
                elastic->youngsModulusPa / 1.0e9, elastic->poissonRatio, study_.densityKgPerM3);
  }

  // ── the mesh ────────────────────────────────────────────────────────────
  const forge::ui::MeshMeasure& mm = modelMeasure();
  double longest = 0.0;
  for (std::size_t axis = 0; axis < 3; ++axis) longest = std::max(longest, mm.box.size(axis));
  ImGui::Spacing();
  ImGui::Text("Pieces across the part");
  ImGui::SetNextItemWidth(-1);
  int divisions = study_.divisions;
  if (ImGui::SliderInt("##studydiv", &divisions, forge::ui::kMinStudyDivisions,
                       forge::ui::kMaxStudyDivisions)) {
    if (divisions != study_.divisions) {
      study_.divisions = divisions;
      studyOutcome_ = forge::ui::StudyOutcome{};
      studyProgram_.clear();
    }
  }
  if (longest > 0.0) {
    ImGui::Text("           %d across %.3f mm, so about %.3f mm each", study_.divisions, longest,
                studyElementSizeMm(longest, study_.divisions));
  }

  // ── running it ──────────────────────────────────────────────────────────
  ImGui::Spacing();
  const bool bodyReady = scene_.built() && !partDoc_.irProgram().empty();
  std::string blocker = forge::ui::studyBlocker(study_, bodyReady);
  if (blocker.empty() && builtProgram_ != partDoc_.irProgram()) {
    blocker = "The part is still rebuilding. The study runs on the shape you can see, so it "
              "waits for that to finish.";
  }
  ImGui::BeginDisabled(!blocker.empty());
  if (ImGui::Button("Run study", ImVec2(-1, 0))) runStudy();
  ImGui::EndDisabled();
  if (!blocker.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("%s", blocker.c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopID();
    return;
  }

  // ── the answer ──────────────────────────────────────────────────────────
  if (studyRuns_ == 0) {
    ImGui::TextDisabled("(this study has not been run yet)");
    ImGui::PopID();
    return;
  }
  if (!studyOutcome_.solved) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 105, 95), "The study did not run.");
    ImGui::TextWrapped("%s", studyOutcome_.blocker.c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopID();
    return;
  }
  if (studyOutcomeIsStale()) {
    // The witness has fired. Printing the old peak stress here is precisely the
    // number a user would act on and precisely the one that is no longer true.
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(230, 190, 90),
                       "This part has changed since the study ran, so the last answer no longer "
                       "describes it. Run it again.");
    ImGui::PopTextWrapPos();
    ImGui::PopID();
    return;
  }

  const forge::ui::StudyOutcome& o = studyOutcome_;
  ImGui::Text("mesh       %zu points, %zu pieces, %.3f mm each", o.meshNodes, o.meshElements,
              o.elementSizeMm);
  ImGui::Text("freedoms   %zu, of which %zu are held", o.freedoms, o.heldFreedoms);
  ImGui::Text("push       %.3f N over %zu points", forge::ui::appliedForceMagnitudeN(o),
              o.loadedNodes);
  ImGui::TextColored(rgb(120, 200, 130), "movement   %.4f mm at the furthest point",
                     o.maxDisplacementMm);
  ImGui::TextColored(rgb(120, 200, 130), "stress     %.3f MPa at its highest", o.maxStressMPa);
  ImGui::Text("took       %.0f ms", o.solveMs);
  // The out-of-balance force is the honest check on the answer: it is what is
  // left over of the push after the part has taken it up. Printed with the force
  // it is compared against, because a residual on its own has no scale.
  if (forge::ui::studyConverged(o)) {
    ImGui::Text("settled    %.3g N left over against %.3f N applied", o.residualN,
                forge::ui::appliedForceMagnitudeN(o));
  } else {
    ImGui::TextColored(rgb(230, 190, 90),
                       "not settled: %.3g N left over against %.3f N applied", o.residualN,
                       forge::ui::appliedForceMagnitudeN(o));
  }
  ImGui::PopID();
}

// ── restraints ──────────────────────────────────────────────────────────────
void ForgeFrame::drawRestraintsPanel() {
  restraintRowsDrawn_ = 0;
  ImGui::TextColored(rgb(242, 158, 38), "Restraints");
  ImGui::Separator();

  const forge::ui::MeshMeasure& mm = modelMeasure();
  if (measureMesh().empty()) {
    ImGui::TextColored(rgb(235, 105, 95), "There is nothing to hold yet");
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty()
                                 ? "Draw or open a part, then come back to hold one of its sides."
                                 : why.c_str());
    return;
  }
  ImGui::Text("This part spans %.3f x %.3f x %.3f mm", mm.box.size(0), mm.box.size(1),
              mm.box.size(2));
  ImGui::Spacing();

  if (study_.restraints.empty()) {
    ImGui::TextDisabled("Nothing is holding this part yet. Until one side is held it is free");
    ImGui::TextDisabled("to drift, and the study has no answer to give. Pick a side below.");
  }
  std::size_t removeAt = study_.restraints.size();
  for (std::size_t i = 0; i < study_.restraints.size(); ++i) {
    const forge::ui::Restraint& r = study_.restraints[i];
    ImGui::PushID(static_cast<int>(i));
    ImGui::BulletText("%s   %s", forge::ui::studyFaceName(r.face), r.describeHold().c_str());
    // The mesh point count and the plane are only real once the solver has built
    // the mesh, so they appear only when they exist -- and only while the answer
    // they came from still describes this part.
    const forge::ui::FaceCensus* census =
        (studyOutcome_.solved && !studyOutcomeIsStale()) ? studyOutcome_.censusFor(r.face)
                                                         : nullptr;
    if (census != nullptr) {
      ImGui::Text("     %zu mesh points at %s = %.3f mm", census->meshNodes,
                  kAxisNames[forge::ui::studyFaceAxis(r.face)], census->planeMm);
    }
    ImGui::SameLine();
    if (ImGui::SmallButton("Remove")) removeAt = i;
    ImGui::PopID();
    ++restraintRowsDrawn_;
  }
  if (removeAt < study_.restraints.size()) {
    study_.restraints.erase(study_.restraints.begin() + static_cast<std::ptrdiff_t>(removeAt));
    studyOutcome_ = forge::ui::StudyOutcome{};
    studyProgram_.clear();
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "Hold a side");
  const std::vector<forge::ui::StudyFace>& faces = forge::ui::allStudyFaces();
  if (restraintFacePick_ < 0 || restraintFacePick_ >= static_cast<int>(faces.size())) {
    restraintFacePick_ = 0;
  }
  ImGui::SetNextItemWidth(-1);
  if (ImGui::BeginCombo("##holdface",
                        forge::ui::studyFaceName(faces[static_cast<std::size_t>(restraintFacePick_)]))) {
    for (std::size_t i = 0; i < faces.size(); ++i) {
      const bool isSel = static_cast<int>(i) == restraintFacePick_;
      if (ImGui::Selectable(forge::ui::studyFaceName(faces[i]), isSel)) {
        restraintFacePick_ = static_cast<int>(i);
      }
      if (isSel) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  ImGui::Checkbox("X", &restraintHold_[0]);
  ImGui::SameLine();
  ImGui::Checkbox("Y", &restraintHold_[1]);
  ImGui::SameLine();
  ImGui::Checkbox("Z", &restraintHold_[2]);
  const bool anyDirection = restraintHold_[0] || restraintHold_[1] || restraintHold_[2];
  ImGui::BeginDisabled(!anyDirection);
  if (ImGui::Button("Hold this side", ImVec2(-1, 0))) {
    forge::ui::Restraint r;
    r.face = faces[static_cast<std::size_t>(restraintFacePick_)];
    r.holdX = restraintHold_[0];
    r.holdY = restraintHold_[1];
    r.holdZ = restraintHold_[2];
    study_.restraints.push_back(r);
    studyOutcome_ = forge::ui::StudyOutcome{};
    studyProgram_.clear();
    note(std::string("holding the ") + forge::ui::studyFaceName(r.face));
  }
  ImGui::EndDisabled();
  if (!anyDirection) {
    ImGui::TextDisabled("(tick at least one direction to hold)");
  }

  drawStudyFooter("restraints");
}

// ── loads ───────────────────────────────────────────────────────────────────
void ForgeFrame::drawLoadsPanel() {
  loadRowsDrawn_ = 0;
  ImGui::TextColored(rgb(242, 158, 38), "Forces");
  ImGui::Separator();

  const forge::ui::MeshMeasure& mm = modelMeasure();
  if (measureMesh().empty()) {
    ImGui::TextColored(rgb(235, 105, 95), "There is nothing to push on yet");
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    ImGui::TextWrapped("%s", why.empty()
                                 ? "Draw or open a part, then come back to push on one of its sides."
                                 : why.c_str());
    return;
  }
  ImGui::Text("This part spans %.3f x %.3f x %.3f mm", mm.box.size(0), mm.box.size(1),
              mm.box.size(2));
  ImGui::Spacing();

  if (study_.loads.empty()) {
    ImGui::TextDisabled("Nothing is pushing on this part yet, so it would stay exactly where");
    ImGui::TextDisabled("it is. Pick a side below and give the force a size in newtons.");
  }
  std::size_t removeAt = study_.loads.size();
  for (std::size_t i = 0; i < study_.loads.size(); ++i) {
    const forge::ui::Load& l = study_.loads[i];
    ImGui::PushID(static_cast<int>(i));
    ImGui::BulletText("%s on the %s", l.describeDirection().c_str(),
                      forge::ui::studyFaceName(l.face));
    const forge::ui::FaceCensus* census =
        (studyOutcome_.solved && !studyOutcomeIsStale()) ? studyOutcome_.censusFor(l.face)
                                                         : nullptr;
    if (census != nullptr && census->meshNodes > 0) {
      // Spread EQUALLY over the points on that side, and said so: the total is
      // exactly what was typed, and how it is shared out is a choice the user is
      // entitled to know about rather than a detail hidden behind a total.
      ImGui::Text("     spread over %zu mesh points, %.4f N each, at %s = %.3f mm",
                  census->meshNodes, l.magnitudeN() / static_cast<double>(census->meshNodes),
                  kAxisNames[forge::ui::studyFaceAxis(l.face)], census->planeMm);
    }
    ImGui::SameLine();
    if (ImGui::SmallButton("Remove")) removeAt = i;
    ImGui::PopID();
    ++loadRowsDrawn_;
  }
  if (removeAt < study_.loads.size()) {
    study_.loads.erase(study_.loads.begin() + static_cast<std::ptrdiff_t>(removeAt));
    studyOutcome_ = forge::ui::StudyOutcome{};
    studyProgram_.clear();
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "Push on a side");
  const std::vector<forge::ui::StudyFace>& faces = forge::ui::allStudyFaces();
  if (loadFacePick_ < 0 || loadFacePick_ >= static_cast<int>(faces.size())) loadFacePick_ = 0;
  ImGui::SetNextItemWidth(-1);
  if (ImGui::BeginCombo("##loadface",
                        forge::ui::studyFaceName(faces[static_cast<std::size_t>(loadFacePick_)]))) {
    for (std::size_t i = 0; i < faces.size(); ++i) {
      const bool isSel = static_cast<int>(i) == loadFacePick_;
      if (ImGui::Selectable(forge::ui::studyFaceName(faces[i]), isSel)) {
        loadFacePick_ = static_cast<int>(i);
      }
      if (isSel) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  ImGui::SetNextItemWidth(-1);
  ImGui::InputFloat3("##loadxyz", loadForce_, "%.2f N");
  const bool anyForce =
      loadForce_[0] != 0.0f || loadForce_[1] != 0.0f || loadForce_[2] != 0.0f;
  ImGui::BeginDisabled(!anyForce);
  if (ImGui::Button("Add this force", ImVec2(-1, 0))) {
    forge::ui::Load l;
    l.face = faces[static_cast<std::size_t>(loadFacePick_)];
    l.fx = static_cast<double>(loadForce_[0]);
    l.fy = static_cast<double>(loadForce_[1]);
    l.fz = static_cast<double>(loadForce_[2]);
    study_.loads.push_back(l);
    studyOutcome_ = forge::ui::StudyOutcome{};
    studyProgram_.clear();
    note(l.describeDirection() + " on the " + forge::ui::studyFaceName(l.face));
  }
  ImGui::EndDisabled();
  if (!anyForce) {
    ImGui::TextDisabled("(type a force in newtons along at least one direction)");
  }

  drawStudyFooter("loads");
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
// Ask the model-backed planner first when one is installed; fall back to the
// deterministic one when it refuses, and SAY SO in the summary. A silent fallback
// is the worst of both: the user believes Archie answered, and the plan they are
// reading came from somewhere else.
forge::ui::PlanResponse ForgeFrame::planWithFallback(const forge::ui::PlanRequest& request) {
  // Show the model the part, not just a sentence about it. Archie is a VLM and
  // until PlanRequest carried an image the app could only ever send it text;
  // T-084 measured both arms of an image ablation and the missing input is the
  // IMAGE. A planner that ignores the field is still correct -- LocalPlanner is
  // deterministic and does -- so this is attached once, for whoever answers.
  forge::ui::PlanRequest req = request;
  if (!copilotFramePath_.empty()) req.imagePath = copilotFramePath_;
  if (copilotRemote_ != nullptr) {
    forge::ui::PlanResponse remote = copilotRemote_->plan(req);
    if (remote.ok) return remote;
    forge::ui::PlanResponse local = copilotPlanner_.plan(req);
    const std::string why = remote.error.empty() ? std::string("no reason given")
                                                 : remote.error;
    if (local.ok) {
      local.plan.summary += (local.plan.summary.empty() ? "" : "  ");
      local.plan.summary += "[deterministic fallback: Archie " + why + "]";
    } else if (local.error.empty()) {
      local.error = "Archie " + why + ", and the deterministic planner also declined";
    }
    return local;
  }
  return copilotPlanner_.plan(req);
}

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
  if (copilotAutoPlan_) deliverCopilotPlan(planWithFallback(copilot_.request()));
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
  // GROW THE STRING, do not round-trip it through a fixed buffer.
  //
  // This was a `char buf[256]` that copied at most 255 bytes OUT of copilotInput_,
  // handed the buffer to ImGui, and assigned it straight BACK -- so every frame the
  // panel drew silently shortened the request to 255 bytes. copilotInput_ is a
  // std::string and always was, which is precisely why this was easy to miss: the
  // cap was never the type, it was the round trip.
  //
  // MEASURED before the change: a 271-byte request became 255 after ONE frame; 254
  // and 255 survived, 256, 257 and 1024 all clamped to 255. And 255 bytes is
  // shorter than the requests doc 03 is written around -- "make the wall 20%
  // thicker without moving the mounting-hole centres..." is the SHAPE of the input.
  //
  // ImGuiInputTextFlags_CallbackResize is the documented way to back an InputText
  // with a std::string (imgui.h: "see misc/cpp/imgui_stdlib.h for an example").
  // The callback MUST honour the BufSize ImGui provides.
  ImGui::SetNextItemWidth(-90.0f * dpiScale_);
  if (copilotInput_.capacity() < 256) copilotInput_.reserve(256);
  const bool entered = ImGui::InputTextWithHint(
      "##copilot_in", "ask Archie for an edit...", copilotInput_.data(),
      copilotInput_.capacity() + 1,
      ImGuiInputTextFlags_EnterReturnsTrue | ImGuiInputTextFlags_CallbackResize,
      [](ImGuiInputTextCallbackData* data) -> int {
        if (data->EventFlag == ImGuiInputTextFlags_CallbackResize) {
          auto* str = static_cast<std::string*>(data->UserData);
          // BufSize includes the terminator; resize to the text length and hand
          // ImGui the (possibly reallocated) storage back.
          str->resize(static_cast<std::size_t>(data->BufTextLen));
          data->Buf = str->data();
        }
        return 0;
      },
      &copilotInput_);
  // InputText writes through data() and terminates at the typed length, so the
  // std::string's own size must be brought back into agreement with it.
  copilotInput_.resize(std::strlen(copilotInput_.c_str()));
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

// ════════════════════════════════════════════════════════════════════════════
// THE DRAWING PANELS
//
// Four tabs that used to fall through to the generic fallback. Every value they
// print is read from the document, or measured from the part that is built right
// now; nothing here has a default that reads as data, and the two places where
// the display tessellation cannot answer a question honestly SAY SO instead of
// printing the answer the mesh would give.
// ════════════════════════════════════════════════════════════════════════════

// The layout every drawing panel derives from. Cached on FOUR witnesses -- the
// triangle count, the sheet, the projection and the scale choice -- because all
// four are inputs to the answer. A cache keyed on fewer of them would print a
// scale that was chosen for a different sheet or a different part, which is the
// one failure mode a drawing must not have.
const ForgeFrame::DrawingLayout& ForgeFrame::drawingLayout() {
  const forge::ui::TitleBlockData& t = drawing_.titleBlock();
  const std::size_t tris = scene_.triangleCount();
  if (drawingLayoutBuilt_ && drawingTriangles_ == tris && drawingSheetId_ == t.sheetId &&
      drawingProjection_ == t.projection && drawingScaleMode_ == t.scaleMode &&
      drawingFixedScale_ == t.fixedScale) {
    return drawingLayout_;
  }

  DrawingLayout out;
  out.sheet = forge::ui::findSheetSize(t.sheetId);
  const forge::ui::MeasureMesh& mesh = measureMesh();
  out.box = meshMeasure_.box;
  out.modelBuilt = mesh.triangleCount() > 0 && out.box.valid;

  double groupW = 0.0;
  double groupH = 0.0;
  if (out.modelBuilt) {
    out.modelBuilt = forge::ui::projectionGroupSize(mesh, t.projection, groupW, groupH);
  }
  out.groupWidthMm = groupW;
  out.groupHeightMm = groupH;

  if (out.sheet != nullptr) {
    if (t.scaleMode == forge::ui::ScaleMode::Fixed) {
      out.scale = forge::ui::applyScale(t.fixedScale, groupW, groupH, *out.sheet);
    } else {
      out.scale = forge::ui::fitScale(groupW, groupH, *out.sheet);
    }
    out.views = forge::ui::buildViewList(mesh, out.scale.scale, t.projection, *out.sheet);
  }

  drawingLayout_ = std::move(out);
  drawingLayoutBuilt_ = true;
  drawingTriangles_ = tris;
  drawingSheetId_ = t.sheetId;
  drawingProjection_ = t.projection;
  drawingScaleMode_ = t.scaleMode;
  drawingFixedScale_ = t.fixedScale;
  return drawingLayout_;
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

// When the open document was last written, from the file itself. Empty for a
// document that has never been saved -- which is the honest answer, and is why
// the title block's Date row can read as unset.
std::string fileModifiedText(const std::string& path) {
  if (path.empty()) return std::string();
  struct stat st {};
  if (::stat(path.c_str(), &st) != 0) return std::string();
  const std::time_t when = static_cast<std::time_t>(st.st_mtime);
  std::tm parts{};
  if (::localtime_r(&when, &parts) == nullptr) return std::string();
  char buf[32];
  if (std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", &parts) == 0) return std::string();
  return std::string(buf);
}

const char* sourceTag(forge::ui::FieldSource s) {
  switch (s) {
    case forge::ui::FieldSource::Unset: return "";
    case forge::ui::FieldSource::Document: return "typed";
    case forge::ui::FieldSource::Model: return "measured";
    case forge::ui::FieldSource::File: return "from the file";
  }
  return "";
}

// ── THE SKETCH PANELS ───────────────────────────────────────────────────────
//
// Four tabs — Constraints, Dimensions, Relations and Curves — over ONE reading
// of the live constraint solver. Every number any of them prints was read back
// out of planegcs after the same solve the part was built with: a coordinate
// comes from the solver's own parameter storage, an error comes from its own
// residual function, "still free to move" comes from its own Jacobian rank. Not
// one of them is carried over from the statement that drew the sketch, because
// the whole point of a solver is that the drawing stops being true the moment it
// runs — a circle drawn at r4 with a Radius constraint of 6 IS 6, and a panel
// that showed 4 would be showing the request instead of the part.
//
// WHAT IS DELIBERATELY NOT HERE. Nothing invents a number to fill a column. A
// residual that the solver cannot give (because the constraint never reached it,
// or was dropped to make the rest solvable) prints as "-", and a dimension whose
// statement has no single number to edit is READ-ONLY and says so, rather than
// offering a field that quietly does nothing.

// How far a constraint may be from satisfied and still be called satisfied. One
// nanometre: six orders of magnitude below anything a machine shop can hold, so
// a row this calls "holding" is holding by any standard a user has. It exists at
// all because a converged solve leaves rounding, not zero, and labelling 1e-16
// as "not met" would make every well-solved sketch look broken.
constexpr double kSketchSatisfiedTolerance = 1.0e-6;

// The words a person reads for each constraint the solver dispatches.
//
// The IR spells "DIST" and the kernel hands that spelling straight through,
// deliberately: the prose gate reads THIS file, so a sentence written in the
// kernel would be a sentence nothing scans. The mapping therefore lives here,
// where it is checked. A keyword with no row is drawn AS WRITTEN rather than
// dropped — "DIST" is a word a machinist can read, and hiding a constraint would
// be worse than naming it tersely. The sketch panel gate requires a row for every
// keyword the kernel dispatches, so the terse path is a backstop and not the
// normal case.
struct SketchConstraintLabel {
  const char* keyword;
  const char* label;
};
const SketchConstraintLabel kSketchConstraintLabels[] = {
    {"COINC", "Coincident"},  {"PARA", "Parallel"},   {"PERP", "Perpendicular"},
    {"TANG", "Tangent"},      {"EQUAL", "Equal"},     {"CONC", "Concentric"},
    {"COLL", "Collinear"},    {"SYMM", "Symmetric"},  {"MIDPT", "Midpoint"},
    {"HORIZ", "Horizontal"},  {"VERT", "Vertical"},   {"PTON", "Point on curve"},
    {"FIX", "Fixed in place"},{"DIST", "Distance"},   {"DISTX", "Horizontal distance"},
    {"DISTY", "Vertical distance"}, {"ANGLE", "Angle"}, {"RADIUS", "Radius"},
    {"DIAM", "Diameter"},
};

const char* sketchFreeRoleWord(forge::ft::SketchFreeRole role) {
  switch (role) {
    case forge::ft::SketchFreeRole::X: return "left and right";
    case forge::ft::SketchFreeRole::Y: return "up and down";
    case forge::ft::SketchFreeRole::Radius: return "its radius";
    case forge::ft::SketchFreeRole::StartAngle: return "where it starts";
    case forge::ft::SketchFreeRole::EndAngle: return "where it ends";
    case forge::ft::SketchFreeRole::Other: break;
  }
  return "one of its values";
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

std::vector<forge::ui::TitleBlockField> ForgeFrame::titleBlockRows() {
  const DrawingLayout& layout = drawingLayout();
  forge::ui::TitleBlockContext ctx;
  ctx.documentName = documentName_;
  ctx.documentPath = documentPath_;
  ctx.savedOn = fileModifiedText(documentPath_);
  // THE UNIT, from the one place that owns it. forge/ui/Units.hpp states the
  // rule for the whole application -- every stored length is a millimetre -- and
  // this reads the name out of that header rather than printing the letters
  // "mm" as a literal in a title block.
  ctx.units = std::string(forge::ui::unitLabel(forge::ui::kInternalLengthUnit)) + " (" +
              forge::ui::toString(forge::ui::kInternalLengthUnit) + ")";
  ctx.featureCount = partDoc_.records().size();
  ctx.modelBuilt = layout.modelBuilt;
  ctx.scale = layout.scale;
  ctx.sheet = layout.sheet;
  if (layout.box.valid) {
    ctx.extentXmm = layout.box.size(0);
    ctx.extentYmm = layout.box.size(1);
    ctx.extentZmm = layout.box.size(2);
  }
  return forge::ui::titleBlockRows(drawing_.titleBlock(), ctx);
}

bool ForgeFrame::editTextField(const char* id, std::string& value, char* buffer,
                               std::size_t size) {
  bool changed = false;
  ImGui::SetNextItemWidth(-1);
  if (ImGui::InputText(id, buffer, size)) {
    value = buffer;
    changed = true;
  }
  // Refresh from the document whenever the box is NOT being typed in, so undo,
  // Open and New are visible immediately and a half-typed value is never
  // overwritten under the cursor.
  if (!ImGui::IsItemActive()) std::snprintf(buffer, size, "%s", value.c_str());
  return changed;
}

// ── the title block ─────────────────────────────────────────────────────────
void ForgeFrame::drawTitleBlockPanel() {
  titleBlockRowsDrawn_ = 0;
  const DrawingLayout& layout = drawingLayout();
  forge::ui::TitleBlockData& t = drawing_.titleBlock();

  ImGui::TextColored(rgb(242, 158, 38), "Title block");
  ImGui::SameLine();
  ImGui::TextDisabled("%s%s", documentName_.c_str(), documentDirty_ ? "  (unsaved changes)" : "");
  ImGui::Separator();

  const std::vector<forge::ui::TitleBlockField> rows = titleBlockRows();
  const float labelWidth = 132.0f * dpiScale_;
  std::size_t editSlot = 0;
  for (const forge::ui::TitleBlockField& row : rows) {
    ++titleBlockRowsDrawn_;
    ImGui::PushID(row.key.c_str());
    ImGui::TextColored(rgb(150, 157, 168), "%s", row.label.c_str());
    ImGui::SameLine(labelWidth);
    if (row.editable && editSlot < kTitleFieldCount) {
      std::string* field = forge::ui::titleBlockFieldByKey(t, row.key);
      char* buffer = titleFields_[editSlot];
      ++editSlot;
      if (field != nullptr && editTextField("##value", *field, buffer, kTitleFieldSize)) {
        documentDirty_ = true;
      }
    } else if (row.value.empty()) {
      // NOT a fabricated default. A title block row the document has no value
      // for stays empty, and says what would fill it.
      ImGui::TextDisabled("--");
      if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", row.origin.c_str());
    } else {
      const ImVec4 colour = row.source == forge::ui::FieldSource::Model ? rgb(120, 200, 130)
                                                                       : rgb(210, 216, 226);
      ImGui::TextColored(colour, "%s", row.value.c_str());
      ImGui::SameLine();
      ImGui::TextDisabled("%s", sourceTag(row.source));
      if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", row.origin.c_str());
    }
    ImGui::PopID();
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Sheet and scale");
  ImGui::Separator();

  ImGui::TextColored(rgb(150, 157, 168), "Sheet size");
  ImGui::SameLine(labelWidth);
  ImGui::SetNextItemWidth(-1);
  const std::string sheetLabel = layout.sheet != nullptr ? layout.sheet->label : t.sheetId;
  if (ImGui::BeginCombo("##sheet", sheetLabel.c_str())) {
    for (const forge::ui::SheetSize& s : forge::ui::sheetSizes()) {
      const bool on = s.id == t.sheetId;
      if (ImGui::Selectable(s.label.c_str(), on)) {
        t.sheetId = s.id;
        documentDirty_ = true;
      }
      if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", s.family.c_str());
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }

  ImGui::TextColored(rgb(150, 157, 168), "Projection");
  ImGui::SameLine(labelWidth);
  ImGui::SetNextItemWidth(-1);
  if (ImGui::BeginCombo("##projection", forge::ui::projectionLabel(t.projection))) {
    for (const forge::ui::ProjectionAngle a :
         {forge::ui::ProjectionAngle::First, forge::ui::ProjectionAngle::Third}) {
      const bool on = a == t.projection;
      if (ImGui::Selectable(forge::ui::projectionLabel(a), on)) {
        t.projection = a;
        documentDirty_ = true;
      }
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }

  ImGui::TextColored(rgb(150, 157, 168), "Scale");
  ImGui::SameLine(labelWidth);
  bool automatic = t.scaleMode == forge::ui::ScaleMode::Automatic;
  if (ImGui::Checkbox("choose it to fit the sheet", &automatic)) {
    // Pinning starts from the scale the fit had already chosen, so switching
    // the control does not silently change the drawing.
    if (!automatic && layout.scale.ok) t.fixedScale = layout.scale.scale;
    t.scaleMode = automatic ? forge::ui::ScaleMode::Automatic : forge::ui::ScaleMode::Fixed;
    documentDirty_ = true;
  }
  if (!automatic) {
    ImGui::SameLine();
    ImGui::SetNextItemWidth(90.0f * dpiScale_);
    if (ImGui::BeginCombo("##fixedscale", t.fixedScale.text().c_str())) {
      for (const forge::ui::Scale& s : forge::ui::standardScales()) {
        const bool on = s == t.fixedScale;
        if (ImGui::Selectable(s.text().c_str(), on)) {
          t.fixedScale = s;
          documentDirty_ = true;
        }
        if (on) ImGui::SetItemDefaultFocus();
      }
      ImGui::EndCombo();
    }
  }

  // ── THE WORKING, SHOWN ──────────────────────────────────────────────────
  // A scale a user cannot check is a scale a user has to trust. These four
  // numbers are the whole calculation, so anyone can do the division.
  ImGui::Spacing();
  if (layout.sheet == nullptr) {
    ImGui::TextWrapped("This document names a sheet size this version does not have. Pick one "
                       "from the list above.");
  } else if (!layout.modelBuilt) {
    ImGui::TextWrapped("Nothing is built yet, so there is no size to scale. Add a feature to the "
                       "part and the scale will follow it.");
  } else {
    ImGui::TextDisabled("paper      %.0f x %.0f mm", layout.sheet->widthMm,
                        layout.sheet->heightMm);
    ImGui::TextDisabled("inside the frame  %.0f x %.0f mm  (%.0f mm border, %.0f mm filing edge)",
                        layout.sheet->drawableWidthMm(), layout.sheet->drawableHeightMm(),
                        layout.sheet->borderMm, layout.sheet->filingMm);
    ImGui::TextDisabled("the views  %.2f x %.2f mm at full size", layout.groupWidthMm,
                        layout.groupHeightMm);
    if (layout.scale.ok) {
      ImGui::TextColored(layout.scale.fits ? rgb(120, 200, 130) : rgb(235, 175, 95),
                         "at %s that is %.1f x %.1f mm on the paper",
                         layout.scale.scale.text().c_str(), layout.scale.paperWidthMm,
                         layout.scale.paperHeightMm);
    }
    if (!layout.scale.reason.empty()) {
      ImGui::PushTextWrapPos(0.0f);
      ImGui::TextColored(rgb(235, 175, 95), "%s", layout.scale.reason.c_str());
      ImGui::PopTextWrapPos();
    }
    ImGui::TextDisabled("The figure is the front, top and side views side by side. It does not "
                        "reserve room between them or for this block.");
  }
}

// ── the view list ───────────────────────────────────────────────────────────
void ForgeFrame::drawViewListPanel() {
  viewListRowsDrawn_ = 0;
  const DrawingLayout& layout = drawingLayout();
  const forge::ui::TitleBlockData& t = drawing_.titleBlock();

  ImGui::TextColored(rgb(242, 158, 38), "Views on this sheet");
  ImGui::Separator();
  if (layout.sheet == nullptr) {
    ImGui::TextWrapped("Choose a sheet size in the Title Block tab and the views will be laid out "
                       "on it.");
    return;
  }
  if (!layout.modelBuilt) {
    ImGui::TextWrapped("There is nothing built to draw yet. Add a feature to the part and every "
                       "view will appear here with its real size.");
    return;
  }

  ImGui::TextDisabled("%s   %s   %s", layout.sheet->label.c_str(),
                      layout.scale.scale.text().c_str(),
                      forge::ui::projectionLabel(t.projection));
  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "%-11s %-13s %-19s %-19s %s", "view", "looking along",
                     "part size", "on the paper", "where");
  ImGui::Separator();

  for (const forge::ui::DrawingView& v : layout.views) {
    ++viewListRowsDrawn_;
    ImGui::PushID(static_cast<int>(v.view));
    char where[48];
    if (!v.cell.placedByProjection) {
      std::snprintf(where, sizeof(where), "a free corner");
    } else if (v.cell.column == 0 && v.cell.row == 0) {
      std::snprintf(where, sizeof(where), "the main view");
    } else {
      const char* across = v.cell.column == 0 ? "" : (v.cell.column < 0 ? "left" : "right");
      const char* down = v.cell.row == 0 ? "" : (v.cell.row < 0 ? "below" : "above");
      if (v.cell.column != 0 && v.cell.row == 0) {
        std::snprintf(where, sizeof(where), "%d %s of the front", std::abs(v.cell.column), across);
      } else {
        std::snprintf(where, sizeof(where), "%d %s the front", std::abs(v.cell.row), down);
      }
    }
    ImGui::TextColored(v.fitsSheet ? rgb(210, 216, 226) : rgb(235, 175, 95), "%-11s",
                       forge::ui::toString(v.view));
    ImGui::SameLine();
    ImGui::TextDisabled("%5.2f %5.2f %5.2f", v.axes.normal[0], v.axes.normal[1], v.axes.normal[2]);
    ImGui::SameLine();
    ImGui::Text("%7.2f x %-7.2f", v.extent.widthMm, v.extent.heightMm);
    ImGui::SameLine();
    ImGui::Text("%7.2f x %-7.2f", v.paperWidthMm, v.paperHeightMm);
    ImGui::SameLine();
    ImGui::TextDisabled("%s", where);
    if (ImGui::IsItemHovered()) {
      ImGui::SetTooltip("%zu points projected, %.2f mm deep along the line of sight",
                        v.extent.points, v.extent.depthMm);
    }
    ImGui::PopID();
  }

  ImGui::Spacing();
  ImGui::TextDisabled("Sizes are in %s. The part size is what the view really measures; the "
                      "paper size is that at %s.",
                      forge::ui::toString(forge::ui::kInternalLengthUnit),
                      layout.scale.scale.text().c_str());
  ImGui::TextDisabled("The isometric view is not one of the projected views: it is placed wherever "
                      "there is room.");
}

// ── geometric tolerances ────────────────────────────────────────────────────
GdtVerdict ForgeFrame::gdtVerdict(const forge::ui::FeatureControlFrame& frame) {
  return evaluateFrame(frame, drawing_, measureMesh());
}

void ForgeFrame::drawGdtPanel() {
  gdtRowsDrawn_ = 0;
  const forge::ui::MeasureMesh& mesh = measureMesh();
  const std::vector<std::uint32_t> picked = selectedFaceIds();

  // ── datums ──────────────────────────────────────────────────────────────
  ImGui::TextColored(rgb(242, 158, 38), "Datums");
  ImGui::Separator();
  if (drawing_.datums().empty()) {
    ImGui::TextWrapped("A geometric tolerance is measured from a datum. Pick a flat face in the "
                       "3D view and add it as datum A.");
  }
  // DEFERRED, like every other structural edit in this class: removing a datum
  // rewrites the vector this loop is walking AND drops the controls that
  // reference it, so the click is recorded and applied after the walk.
  char removeDatum = 0;
  for (const forge::ui::DatumFeature& d : drawing_.datums()) {
    ++gdtRowsDrawn_;
    ImGui::PushID(static_cast<int>(d.letter));
    forge::ui::FaceMeasure face{};
    const std::uint32_t faceId = faceIdOfRef(d.target);
    const bool live = faceId != 0 && forge::ui::measureFace(mesh, faceId, face);
    ImGui::TextColored(rgb(242, 158, 38), "%c", d.letter);
    ImGui::SameLine();
    ImGui::Text("%s", d.targetLabel.c_str());
    ImGui::SameLine();
    if (!live) {
      ImGui::TextColored(rgb(235, 105, 95), "not in the part that is built now");
    } else if (!face.planar) {
      ImGui::TextColored(rgb(235, 175, 95), "this face is curved, so it cannot be a datum plane");
    } else {
      ImGui::TextDisabled("%.2f mm2,  normal %.3f %.3f %.3f", face.area, face.normal[0],
                          face.normal[1], face.normal[2]);
    }
    ImGui::SameLine();
    if (ImGui::SmallButton("Remove")) removeDatum = d.letter;
    ImGui::PopID();
  }

  // The next free letter, from the letters ASME Y14.5 allows.
  char freeLetter = 0;
  for (char c = 'A'; c <= 'Z' && freeLetter == 0; ++c) {
    if (c == 'I' || c == 'O' || c == 'Q') continue;
    if (drawing_.datum(c) == nullptr) freeLetter = c;
  }
  ImGui::BeginDisabled(picked.size() != 1 || freeLetter == 0);
  char addLabel[48];
  std::snprintf(addLabel, sizeof(addLabel), "Add the picked face as datum %c",
                freeLetter == 0 ? '-' : freeLetter);
  const bool addDatum = ImGui::Button(addLabel);
  ImGui::EndDisabled();
  if (picked.size() != 1) {
    ImGui::SameLine();
    ImGui::TextDisabled("pick exactly one face");
  }

  // ── the controls ────────────────────────────────────────────────────────
  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Geometric tolerances");
  ImGui::Separator();
  if (drawing_.frames().empty()) {
    ImGui::TextWrapped("No geometric tolerances on this drawing yet. Add one below and it will be "
                       "checked against the part as it is built.");
  }
  std::string removeFrame;
  for (const forge::ui::FeatureControlFrame& f : drawing_.frames()) {
    ++gdtRowsDrawn_;
    ImGui::PushID(f.id.c_str());
    const GdtVerdict v = gdtVerdict(f);
    ImGui::TextColored(rgb(210, 216, 226), "%s", forge::ui::describeFcf(f).c_str());
    ImGui::SameLine();
    ImGui::TextDisabled("on %s", f.targetLabel.c_str());
    ImGui::SameLine();
    if (ImGui::SmallButton("Remove")) removeFrame = f.id;

    ImGui::Indent(16.0f * dpiScale_);
    ImGui::PushTextWrapPos(0.0f);
    if (!v.legal) {
      ImGui::TextColored(rgb(235, 105, 95), "%s", v.legality.c_str());
    }
    if (v.haveAngle) {
      ImGui::TextDisabled("as modelled this face is %.2f degrees to datum %c; the control calls "
                          "for %.2f",
                          v.nominalAngleDeg, f.datumRefs.empty() ? '-' : f.datumRefs.front(),
                          v.basicAngleDeg);
    }
    if (v.measured) {
      // ── WHAT THIS NUMBER IS, AND WHAT IT IS NOT ──────────────────────────
      // It is measured on the part AS MODELLED. A modelled flat face is
      // perfectly flat, so a form call-out the model satisfies reads as zero and
      // will always read as zero. That is the truth about the model and it is
      // worth knowing -- it says the call-out and the shape agree -- but it is
      // NOT an inspection result, and a panel that let it be mistaken for one
      // would be the most expensive kind of wrong. So every row says which it
      // is, in the row, not in a footnote somewhere else.
      ImGui::TextColored(v.pass ? rgb(120, 200, 130) : rgb(235, 105, 95),
                         "as modelled: %s   %.4f mm against %.4f mm allowed, over %zu points",
                         v.pass ? "within tolerance" : "outside tolerance", v.deviationMm,
                         v.allowedMm, v.samples);
    } else if (!v.refusal.empty()) {
      ImGui::TextColored(rgb(235, 175, 95), "%s", v.refusal.c_str());
    }
    ImGui::PopTextWrapPos();
    ImGui::Unindent(16.0f * dpiScale_);
    ImGui::PopID();
  }

  // ── the form that adds one ──────────────────────────────────────────────
  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "Add a control to the picked face");
  const std::vector<forge::ui::GdtCharacteristic>& chars = forge::ui::allGdtCharacteristics();
  if (gdtCharIndex_ < 0 || gdtCharIndex_ >= static_cast<int>(chars.size())) gdtCharIndex_ = 0;
  ImGui::SetNextItemWidth(200.0f * dpiScale_);
  if (ImGui::BeginCombo("##char", forge::ui::gdtLabel(chars[static_cast<std::size_t>(gdtCharIndex_)]))) {
    for (std::size_t i = 0; i < chars.size(); ++i) {
      const bool on = static_cast<int>(i) == gdtCharIndex_;
      if (ImGui::Selectable(forge::ui::gdtLabel(chars[i]), on)) gdtCharIndex_ = static_cast<int>(i);
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  const forge::ui::GdtCharacteristic chosen = chars[static_cast<std::size_t>(gdtCharIndex_)];
  ImGui::SameLine();
  ImGui::SetNextItemWidth(110.0f * dpiScale_);
  ImGui::InputFloat("mm", &gdtTolerance_, 0.005f, 0.05f, "%.4f");
  if (chosen == forge::ui::GdtCharacteristic::Angularity) {
    ImGui::SameLine();
    ImGui::SetNextItemWidth(110.0f * dpiScale_);
    ImGui::InputFloat("deg", &gdtBasicAngle_, 1.0f, 5.0f, "%.2f");
  }

  const std::vector<forge::ui::ControlledFeatureKind>& feats =
      forge::ui::allControlledFeatureKinds();
  if (gdtFeatureIndex_ < 0 || gdtFeatureIndex_ >= static_cast<int>(feats.size())) {
    gdtFeatureIndex_ = 0;
  }
  ImGui::SetNextItemWidth(200.0f * dpiScale_);
  if (ImGui::BeginCombo("##feat",
                        forge::ui::controlledFeatureLabel(
                            feats[static_cast<std::size_t>(gdtFeatureIndex_)]))) {
    for (std::size_t i = 0; i < feats.size(); ++i) {
      const bool on = static_cast<int>(i) == gdtFeatureIndex_;
      if (ImGui::Selectable(forge::ui::controlledFeatureLabel(feats[i]), on)) {
        gdtFeatureIndex_ = static_cast<int>(i);
      }
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  const std::vector<forge::ui::MaterialModifier>& mods = forge::ui::allMaterialModifiers();
  if (gdtModifierIndex_ < 0 || gdtModifierIndex_ >= static_cast<int>(mods.size())) {
    gdtModifierIndex_ = 0;
  }
  ImGui::SameLine();
  ImGui::SetNextItemWidth(220.0f * dpiScale_);
  if (ImGui::BeginCombo("##mod", forge::ui::materialModifierLabel(
                                     mods[static_cast<std::size_t>(gdtModifierIndex_)]))) {
    for (std::size_t i = 0; i < mods.size(); ++i) {
      const bool on = static_cast<int>(i) == gdtModifierIndex_;
      if (ImGui::Selectable(forge::ui::materialModifierLabel(mods[i]), on)) {
        gdtModifierIndex_ = static_cast<int>(i);
      }
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }

  const std::vector<char> letters = drawing_.datumLetters();
  const char* const slotName[3] = {"primary", "secondary", "tertiary"};
  for (int slot = 0; slot < 3; ++slot) {
    if (gdtDatumSlot_[slot] < 0 || gdtDatumSlot_[slot] > static_cast<int>(letters.size())) {
      gdtDatumSlot_[slot] = 0;
    }
    if (slot > 0) ImGui::SameLine();
    ImGui::PushID(slot);
    ImGui::SetNextItemWidth(110.0f * dpiScale_);
    char current[24];
    if (gdtDatumSlot_[slot] == 0) {
      std::snprintf(current, sizeof(current), "%s: none", slotName[slot]);
    } else {
      std::snprintf(current, sizeof(current), "%s: %c", slotName[slot],
                    letters[static_cast<std::size_t>(gdtDatumSlot_[slot] - 1)]);
    }
    if (ImGui::BeginCombo("##datumslot", current)) {
      if (ImGui::Selectable("none", gdtDatumSlot_[slot] == 0)) gdtDatumSlot_[slot] = 0;
      for (std::size_t i = 0; i < letters.size(); ++i) {
        char one[4] = {letters[i], 0, 0, 0};
        if (ImGui::Selectable(one, gdtDatumSlot_[slot] == static_cast<int>(i) + 1)) {
          gdtDatumSlot_[slot] = static_cast<int>(i) + 1;
        }
      }
      ImGui::EndCombo();
    }
    ImGui::PopID();
  }

  ImGui::BeginDisabled(picked.size() != 1);
  const bool addFrame = ImGui::Button("Add this control");
  ImGui::EndDisabled();
  if (picked.size() != 1) {
    ImGui::SameLine();
    ImGui::TextDisabled("pick exactly one face in the 3D view");
  }
  if (!gdtAddRefusal_.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 105, 95), "%s", gdtAddRefusal_.c_str());
    ImGui::PopTextWrapPos();
  }

  ImGui::Spacing();
  ImGui::PushTextWrapPos(0.0f);
  ImGui::TextDisabled("Every result above is measured on this part as you have modelled it, not on "
                      "a part that has been made. A modelled surface is exact, so a call-out the "
                      "shape already satisfies reads as zero; what these checks catch is a "
                      "call-out that the shape does NOT satisfy, and a control that cannot be "
                      "checked at all.");
  ImGui::PopTextWrapPos();

  // ── the deferred edits, applied AFTER the walk ──────────────────────────
  // MID-WALK CONTAINER MUTATION, again: removing a datum rewrites the vector
  // this function has just finished iterating AND drops the controls that
  // reference it. The click is recorded above and applied here, which is the
  // same discipline DocumentModel's walk guard enforces for the feature tree.
  if (removeDatum != 0) drawingRemoveDatum(removeDatum);
  if (!removeFrame.empty()) drawingRemoveControl(removeFrame);
  if (addDatum) drawingAddDatum();
  if (addFrame) {
    std::vector<char> refs;
    for (int slot = 0; slot < 3; ++slot) {
      if (gdtDatumSlot_[slot] > 0) {
        refs.push_back(letters[static_cast<std::size_t>(gdtDatumSlot_[slot] - 1)]);
      }
    }
    drawingAddControl(chosen, static_cast<double>(gdtTolerance_),
                      static_cast<double>(gdtBasicAngle_),
                      feats[static_cast<std::size_t>(gdtFeatureIndex_)],
                      mods[static_cast<std::size_t>(gdtModifierIndex_)], refs);
  }
}

// ── the drawing's edits, in ONE body each ───────────────────────────────────
// The panel's button and the mouseless control above both end here. Two bodies
// would be two behaviours: the one a user gets and the one a gate proves.
bool ForgeFrame::drawingAddDatum() {
  const std::vector<std::uint32_t> picked = selectedFaceIds();
  if (picked.size() != 1) {
    gdtAddRefusal_ = "Pick exactly one face in the 3D view first.";
    return false;
  }
  char freeLetter = 0;
  for (char c = 'A'; c <= 'Z' && freeLetter == 0; ++c) {
    if (c == 'I' || c == 'O' || c == 'Q') continue;
    if (drawing_.datum(c) == nullptr) freeLetter = c;
  }
  if (freeLetter == 0) {
    gdtAddRefusal_ = "Every datum letter is already used on this part.";
    return false;
  }
  forge::ui::DatumFeature d;
  d.letter = freeLetter;
  d.target = faceRefFor(picked.front());
  d.targetLabel = "face " + std::to_string(picked.front());
  std::string why;
  if (!drawing_.addDatum(d, why)) {
    gdtAddRefusal_ = why;
    return false;
  }
  documentDirty_ = true;
  gdtAddRefusal_.clear();
  note(std::string("datum ") + freeLetter + " is now " + d.targetLabel);
  return true;
}

bool ForgeFrame::drawingRemoveDatum(char letter) {
  if (!drawing_.removeDatum(letter)) return false;
  documentDirty_ = true;
  note(std::string("removed datum ") + letter);
  return true;
}

bool ForgeFrame::drawingAddControl(forge::ui::GdtCharacteristic characteristic, double toleranceMm,
                                   double basicAngleDeg,
                                   forge::ui::ControlledFeatureKind feature,
                                   forge::ui::MaterialModifier modifier,
                                   const std::vector<char>& datumRefs) {
  const std::vector<std::uint32_t> picked = selectedFaceIds();
  if (picked.size() != 1) {
    gdtAddRefusal_ = "Pick exactly one face in the 3D view first.";
    return false;
  }
  forge::ui::FeatureControlFrame f;
  f.characteristic = characteristic;
  f.toleranceMm = toleranceMm;
  f.basicAngleDeg = basicAngleDeg;
  f.feature = feature;
  f.modifier = modifier;
  f.datumRefs = datumRefs;
  f.target = faceRefFor(picked.front());
  f.targetLabel = "face " + std::to_string(picked.front());
  std::string why;
  if (!drawing_.addFrame(f, why)) {
    gdtAddRefusal_ = why;
    return false;
  }
  documentDirty_ = true;
  gdtAddRefusal_.clear();
  const GdtVerdict v = gdtVerdict(drawing_.frames().back());
  // The evaluator's own wording goes to the console, where an engineer can read
  // it, and never into the panel.
  if (!v.internalDetail.empty()) {
    shell_.log().info("drawing.gdt", forge::ui::describeFcf(f), v.internalDetail);
  } else {
    note("added " + forge::ui::describeFcf(f));
  }
  return true;
}

bool ForgeFrame::drawingRemoveControl(const std::string& id) {
  if (!drawing_.removeFrame(id)) return false;
  documentDirty_ = true;
  note("removed a geometric tolerance");
  return true;
}

bool ForgeFrame::drawingAddNote(const std::string& text, forge::ui::AnnotationKind kind,
                                forge::ui::NamedView view, bool attachToPickedFace) {
  const std::vector<std::uint32_t> picked = selectedFaceIds();
  forge::ui::Annotation a;
  a.kind = kind;
  a.view = view;
  a.text = text;
  if (attachToPickedFace && picked.size() == 1) a.target = faceRefFor(picked.front());
  std::string why;
  if (!drawing_.addAnnotation(a, why)) {
    noteRefusal_ = why;
    return false;
  }
  documentDirty_ = true;
  noteRefusal_.clear();
  note("added a note");
  return true;
}

bool ForgeFrame::drawingRemoveNote(const std::string& id) {
  if (!drawing_.removeAnnotation(id)) return false;
  documentDirty_ = true;
  note("removed a note");
  return true;
}

// ── annotations ─────────────────────────────────────────────────────────────
void ForgeFrame::drawAnnotationPanel() {
  annotationRowsDrawn_ = 0;
  const forge::ui::MeasureMesh& mesh = measureMesh();
  const std::vector<std::uint32_t> picked = selectedFaceIds();

  ImGui::TextColored(rgb(242, 158, 38), "Notes on this drawing");
  ImGui::Separator();
  if (drawing_.annotations().empty()) {
    ImGui::TextWrapped("Nothing is noted on this drawing yet. Type a note below; pick a face in "
                       "the 3D view first and the note will point at it.");
  }

  std::string removeNote;
  for (const forge::ui::Annotation& a : drawing_.annotations()) {
    ++annotationRowsDrawn_;
    ImGui::PushID(a.id.c_str());
    ImGui::TextColored(rgb(150, 157, 168), "%-13s", forge::ui::annotationLabel(a.kind));
    ImGui::SameLine();
    ImGui::TextDisabled("%s view", forge::ui::toString(a.view));
    ImGui::SameLine();
    if (ImGui::SmallButton("Remove")) removeNote = a.id;
    ImGui::Indent(16.0f * dpiScale_);
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("%s", a.text.c_str());
    if (a.attached()) {
      forge::ui::FaceMeasure face{};
      const std::uint32_t faceId = faceIdOfRef(a.target);
      if (faceId != 0 && forge::ui::measureFace(mesh, faceId, face)) {
        ImGui::TextDisabled("points at face %u  (%.2f mm2, centre %.2f %.2f %.2f)", faceId,
                            face.area, face.centroid[0], face.centroid[1], face.centroid[2]);
      } else {
        ImGui::TextColored(rgb(235, 175, 95),
                           "the face this note pointed at is not in the part that is built now");
      }
    } else {
      ImGui::TextDisabled("on the sheet, not attached to the part");
    }
    ImGui::PopTextWrapPos();
    ImGui::Unindent(16.0f * dpiScale_);
    ImGui::PopID();
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "Add a note");
  const std::vector<forge::ui::AnnotationKind>& kinds = forge::ui::allAnnotationKinds();
  if (noteKindIndex_ < 0 || noteKindIndex_ >= static_cast<int>(kinds.size())) noteKindIndex_ = 0;
  ImGui::SetNextItemWidth(150.0f * dpiScale_);
  if (ImGui::BeginCombo("##notekind",
                        forge::ui::annotationLabel(kinds[static_cast<std::size_t>(noteKindIndex_)]))) {
    for (std::size_t i = 0; i < kinds.size(); ++i) {
      const bool on = static_cast<int>(i) == noteKindIndex_;
      if (ImGui::Selectable(forge::ui::annotationLabel(kinds[i]), on)) {
        noteKindIndex_ = static_cast<int>(i);
      }
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  ImGui::SameLine();
  if (noteViewIndex_ < 0 || noteViewIndex_ >= static_cast<int>(forge::ui::kNamedViewCount)) {
    noteViewIndex_ = 0;
  }
  const forge::ui::NamedView noteView =
      static_cast<forge::ui::NamedView>(static_cast<std::uint8_t>(noteViewIndex_));
  ImGui::SetNextItemWidth(120.0f * dpiScale_);
  if (ImGui::BeginCombo("##noteview", forge::ui::toString(noteView))) {
    for (std::size_t i = 0; i < forge::ui::kNamedViewCount; ++i) {
      const forge::ui::NamedView v = static_cast<forge::ui::NamedView>(static_cast<std::uint8_t>(i));
      const bool on = static_cast<int>(i) == noteViewIndex_;
      if (ImGui::Selectable(forge::ui::toString(v), on)) noteViewIndex_ = static_cast<int>(i);
      if (on) ImGui::SetItemDefaultFocus();
    }
    ImGui::EndCombo();
  }
  ImGui::SameLine();
  ImGui::BeginDisabled(picked.size() != 1);
  ImGui::Checkbox("point it at the picked face", &noteAttach_);
  ImGui::EndDisabled();

  ImGui::SetNextItemWidth(-1);
  const bool entered = ImGui::InputText("##notetext", noteText_, sizeof(noteText_),
                                        ImGuiInputTextFlags_EnterReturnsTrue);
  const bool pressed = ImGui::Button("Add note");
  if (!noteRefusal_.empty()) {
    ImGui::SameLine();
    ImGui::TextColored(rgb(235, 105, 95), "%s", noteRefusal_.c_str());
  }

  // Deferred past the loop above, for the same reason every other structural
  // edit in this class is.
  if (!removeNote.empty()) drawingRemoveNote(removeNote);
  if (entered || pressed) {
    if (drawingAddNote(noteText_, kinds[static_cast<std::size_t>(noteKindIndex_)], noteView,
                       noteAttach_)) {
      noteText_[0] = 0;
    }
  }
}

// ── THE MANUFACTURING PANELS ────────────────────────────────────────────────
//
// WHAT THESE FOUR TABS USED TO DRAW. Tool Library, Stock, Post Output and
// Materials all fell through to drawGenericPanel and printed one sentence saying
// what they WOULD show. A machinist opening the Tool Library got a paragraph
// about the dock layout.
//
// The kernel underneath them was never the problem: forge::camx has held a
// cutting-tool catalogue with real geometry and real chip loads, a 2.5-axis
// contour generator, three post-processors and a cycle-time estimator, and
// forge::cam has held a voxel stock simulation, throughout. NONE of it was
// reachable from the application. What was missing was the ONE input those
// generators need and the app did not have -- a planar boundary polygon -- and
// CamHost.hpp takes it from the tessellation the viewport already draws.
//
// EVERY NUMBER ON THESE FOUR TABS COMES BACK FROM A KERNEL CALL. The tools are
// forge::camx::listTools(). The passes are forge::camx::contourToolpath(). The
// program is forge::camx::postProcess(). The cutting time is
// forge::camx::estimateCycleTime(). What is left over is
// forge::cam::simulateStock(). The part's volume and bounding box are the
// compiler's own, off the last rebuild. The densities are the document's
// material. Nothing here is filled in to complete a layout.
//
// The ONE derivation this file performs is arithmetic whose formula is printed
// beside the answer -- feed from speed, flutes and chip load; mass from volume
// and density -- so a reader can check it rather than believe it.

// Rapid moves stay this far above the top of the block. It is a SETTING, not a
// measurement, and the Post Output panel says so in the same words.
namespace {
constexpr double kCamSafeZMm = 5.0;
// Said in one place because three panels say it.
const char* const kCamNoPart =
    "There is no part in this document yet. Draw or open one and this fills in.";
}  // namespace

void ForgeFrame::ensureCamPlan() {
  namespace cam = forge::desktop::cam;
  const IrBuildReport& r = scene_.lastBuild();
  const bool haveBody = scene_.built() && r.ok() && !scene_.vertices().empty();

  if (!camSectionSeeded_ && haveBody) {
    camSectionZ_ = static_cast<float>(0.5 * (r.bboxMin[2] + r.bboxMax[2]));
    camSectionSeeded_ = true;
  }

  CamControls now;
  now.toolId = camToolId_;
  now.side = camSideIndex_;
  now.post = camPostIndex_;
  now.sectionZ = camSectionZ_;
  now.stockSide = camStockSideMm_;
  now.stockTop = camStockTopMm_;
  now.spindlePercent = camSpindlePercent_;
  now.stepdown = camStepdownMm_;
  now.builds = scene_.builds();
  now.triangles = scene_.triangleCount();
  if (camPlanValid_ && now == camControls_) return;
  camControls_ = now;
  camPlanValid_ = true;
  ++camRecomputes_;

  camOutline_ = cam::PartOutline{};
  camStock_ = cam::StockBlock{};
  camPlan_ = cam::CamPlan{};
  camCut_ = cam::StockCutReport{};
  if (!haveBody) {
    camOutline_.advice = kCamNoPart;
    camPlan_.advice = kCamNoPart;
    camCut_.advice = kCamNoPart;
    return;
  }

  camOutline_ = cam::sectionOutline(scene_.vertices(), static_cast<double>(camSectionZ_));
  camStock_ = cam::stockAround(r.bboxMin, r.bboxMax, static_cast<double>(camStockSideMm_),
                               static_cast<double>(camStockTopMm_));

  cam::CutParameters p;
  p.toolId = camToolId_;
  const cam::CuttingTool* tool = cam::findTool(camToolId_);
  p.spindleRpm =
      tool == nullptr ? 0.0 : tool->maxSpindleRpm * (static_cast<double>(camSpindlePercent_) / 100.0);
  p.stepdownMm = static_cast<double>(camStepdownMm_);
  // From the top of the block to the underside of the part: the whole of what
  // this setup has to cut through, measured rather than chosen.
  p.depthMm = camStock_.ok ? camStock_.maxMm[2] - r.bboxMin[2] : 0.0;
  p.safeZMm = kCamSafeZMm;
  p.side = camSideIndex_ == 0   ? cam::ContourSide::Inside
           : camSideIndex_ == 2 ? cam::ContourSide::On
                                : cam::ContourSide::Outside;
  p.post = camPostIndex_ == 1   ? cam::PostFlavour::Heidenhain
           : camPostIndex_ == 2 ? cam::PostFlavour::Siemens
                                : cam::PostFlavour::Fanuc;

  if (camOutline_.outer() != nullptr) {
    camPlan_ = cam::planContour(*camOutline_.outer(), p);
  } else {
    camPlan_.params = p;
    if (tool != nullptr) camPlan_.tool = *tool;
    camPlan_.advice = camOutline_.advice;
  }
  camCut_ = cam::simulateCut(camStock_, camPlan_);
}

// ── THE WAY OUT OF THE MANUFACTURING WORKSPACE ──────────────────────────────
// forge::ui::MachineProgramSource, implemented on the plan the Post Output tab
// already draws. Nothing here posts machine code: camPlan_.program is
// forge::camx::postProcess's own output, and forge_desktop_cam_panels_gate
// re-posts the same toolpath and requires the two to match byte for byte.
//
// Before this pair existed the ONLY egress was ImGui::SetClipboardText behind the
// Copy button in drawPostOutputPanel. A shop cannot paste a clipboard into a
// machine.
bool ForgeFrame::hasMachineProgram() {
  // NO ensureCamPlan() HERE, and that is the contract, not an oversight: the
  // shell asks this from file.export_gcode's enabled predicate, which the menu,
  // the ribbon and the palette evaluate for every command on every frame. Running
  // the contour generator and the voxel stock simulation from there would put a
  // CAM run in the File menu of a user who has never opened the Manufacturing
  // workspace. So it reports what the panels have already computed, and the
  // command is greyed until an operation has actually been set up.
  return camPlan_.ok && !camPlan_.program.empty();
}

bool ForgeFrame::machineProgram(forge::ui::MachineProgram& out) {
  out = forge::ui::MachineProgram{};
  // THIS one does refresh, for the reason FileExchangeHost refuses a cached
  // handle: a file that is not what is on screen is the worst defect a Save can
  // have. It is the cached path in every ordinary case -- the panel that made the
  // command available drew this same plan -- and it costs a control comparison.
  ensureCamPlan();
  if (!camPlan_.ok || camPlan_.program.empty()) {
    // The panel's OWN sentence, not a second wording of it. When there is no part
    // at all this is kCamNoPart, which is what the three Manufacturing tabs draw.
    out.advice = camPlan_.advice;
    return false;
  }
  out.text = camPlan_.program;
  out.lines = camPlan_.programLines;
  // The dialect as the kernel's own enum names it, through the one toString the
  // Post Output tab's chooser is indexed against.
  out.dialect = forge::desktop::cam::toString(camPlan_.params.post);
  return true;
}

bool ForgeFrame::setCamToolId(std::uint32_t id) {
  if (forge::desktop::cam::findTool(id) == nullptr) return false;
  camToolId_ = id;
  return true;
}

void ForgeFrame::setCamSectionZ(float z) {
  camSectionZ_ = z;
  // Set by hand means set: the one-time seeding must not overwrite it on the
  // next rebuild.
  camSectionSeeded_ = true;
}

forge::ui::MassProperties ForgeFrame::partMass() const {
  // The KERNEL's volume, off the last rebuild -- not the tessellation's. The
  // Measure panel reports the mesh's volume and labels it as the mesh's; a mass
  // is a property of the solid, so it is computed from the solid's.
  return partDoc_.massProperties(scene_.lastBuild().volume);
}

void ForgeFrame::runPendingMaterial() {
  const std::string id = pendingMaterialId_;
  pendingMaterialId_.clear();
  if (id.empty()) return;
  // THROUGH THE REGISTRY, not partDoc_.setMaterial() directly. Going straight to
  // the document would skip the undo stack, the activity log and the shell's
  // counters -- so Ctrl+Z would not put the old material back and nothing would
  // record that the part's weight had changed.
  forge::ui::CommandParams params;
  params.setText("material", id);
  const forge::ui::DispatchResult r = shell_.run("part.set_material", params);
  lastInvokeOk_ = r.ok();
  if (!r.ok()) {
    note("Set material — " + std::string(forge::ui::userText(r.status)));
    return;
  }
  // A material change alters what the part WEIGHS, so the document has changed
  // even though not one statement did. Without this line the change would be
  // lost on close with no prompt.
  documentDirty_ = true;
  note("Material: " + partDoc_.material().name);
}

// ── TOOL LIBRARY ────────────────────────────────────────────────────────────
void ForgeFrame::drawToolLibraryPanel() {
  namespace cam = forge::desktop::cam;
  ensureCamPlan();
  camToolRowsDrawn_ = 0;
  toolLibraryRowsDrawn_ = 0;
  const std::vector<cam::CuttingTool>& tools = cam::toolLibrary();

  ImGui::TextColored(rgb(242, 158, 38), "Cutting tools");
  ImGui::SameLine();
  ImGui::TextColored(rgb(130, 137, 148), "%zu available", tools.size());
  ImGui::Separator();
  if (tools.empty()) {
    ImGui::TextWrapped("This build has no cutting tools, so nothing can be machined from it yet.");
    return;
  }

  for (const cam::CuttingTool& t : tools) {
    const bool chosen = t.id == camToolId_;
    char head[160];
    std::snprintf(head, sizeof(head), "%-22s  %6.2f mm  %d flute  %s", t.name.c_str(),
                  t.diameterMm, t.flutes, t.toolMaterial.c_str());
    if (ImGui::Selectable(head, chosen)) camToolId_ = t.id;
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
    ImGui::Text("      cutting length %.1f mm   overall %.1f mm   up to %.0f rev/min   "
                "%.3f mm per tooth",
                t.fluteLengthMm, t.totalLengthMm, t.maxSpindleRpm, t.chipLoadMm);
    ImGui::PopStyleColor();
    ++camToolRowsDrawn_;
    ++toolLibraryRowsDrawn_;
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Speeds and feeds");
  ImGui::Separator();
  const cam::CuttingTool* t = cam::findTool(camToolId_);
  if (t == nullptr) {
    ImGui::TextWrapped("Pick a tool above and its speeds and feeds appear here.");
    return;
  }
  ImGui::SetNextItemWidth(-1);
  ImGui::SliderFloat("##camspindle", &camSpindlePercent_, 10.0f, 100.0f,
                     "spindle at %.0f%% of this tool's maximum");
  const double rpm = t->maxSpindleRpm * static_cast<double>(camSpindlePercent_) / 100.0;
  ImGui::Text("speed          %.0f rev/min", rpm);
  ImGui::Text("feed           %.0f mm/min", t->feedAt(rpm));
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::Text("               speed x %d flutes x %.3f mm per tooth", t->flutes, t->chipLoadMm);
  ImGui::PopStyleColor();
  ImGui::Text("surface speed  %.1f m/min", t->surfaceSpeedAt(rpm));
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::Text("               3.1416 x %.2f mm x speed / 1000", t->diameterMm);
  ImGui::PopStyleColor();
  ImGui::Spacing();
  ImGui::TextWrapped("The Post Output and Stock tabs cut with the tool chosen here.");
}

// ── POST OUTPUT ─────────────────────────────────────────────────────────────
void ForgeFrame::drawPostOutputPanel() {
  namespace cam = forge::desktop::cam;
  ensureCamPlan();
  camProgramRowsDrawn_ = 0;
  const IrBuildReport& r = scene_.lastBuild();

  ImGui::TextColored(rgb(242, 158, 38), "Operation");
  ImGui::Separator();
  const bool haveBody = scene_.built() && r.ok();
  if (!haveBody) {
    ImGui::TextWrapped("%s", kCamNoPart);
    return;
  }

  // ── the controls ─────────────────────────────────────────────────────────
  const float zLo = static_cast<float>(r.bboxMin[2]);
  const float zHi = static_cast<float>(r.bboxMax[2]);
  ImGui::SetNextItemWidth(-1);
  if (ImGui::SliderFloat("##camz", &camSectionZ_, zLo, zHi, "outline taken at z = %.3f mm")) {
    camSectionSeeded_ = true;
  }
  ImGui::SetNextItemWidth(-1);
  const char* sides[] = {"cut inside the outline", "cut outside the outline",
                         "cut on the outline"};
  ImGui::Combo("##camside", &camSideIndex_, sides, 3);
  ImGui::SetNextItemWidth(-1);
  const char* posts[] = {"Fanuc", "Heidenhain", "Siemens"};
  ImGui::Combo("##campost", &camPostIndex_, posts, 3);
  ImGui::SetNextItemWidth(-1);
  ImGui::SliderFloat("##camstep", &camStepdownMm_, 0.0f, 20.0f,
                     camStepdownMm_ <= 0.0f ? "depth per pass: half the tool"
                                            : "depth per pass %.2f mm");

  ImGui::Spacing();
  if (!camPlan_.ok) {
    ImGui::TextColored(rgb(235, 175, 95), "Nothing is being cut");
    ImGui::TextWrapped("%s", camPlan_.advice.empty()
                                 ? "Move the outline height and this operation will appear."
                                 : camPlan_.advice.c_str());
    return;
  }

  ImGui::Text("tool           %s", camPlan_.tool.name.c_str());
  ImGui::Text("passes         %zu down to %.2f mm, %.2f mm at a time", camPlan_.passes,
              camPlan_.params.depthMm, camPlan_.stepdownMm);
  ImGui::Text("cutting        %.1f mm at %.0f mm/min", camPlan_.pathLengthMm,
              camPlan_.feedMmPerMin);
  ImGui::Text("cutting time   %d min %02d s", static_cast<int>(camPlan_.cutSeconds) / 60,
              static_cast<int>(camPlan_.cutSeconds) % 60);
  ImGui::Text("spindle        %.0f rev/min", camPlan_.spindleRpm);
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::TextWrapped("Zero is the top of the block, so every depth is a distance below it, and "
                     "rapid moves stay %.1f mm clear of it.", kCamSafeZMm);
  ImGui::TextWrapped("The outline follows the shape on screen, which is drawn to within %.2f mm "
                     "of the true surface.", forge::desktop::cam::kOutlineChordToleranceMm);
  ImGui::PopStyleColor();
  if (camOutline_.islands() != 0) {
    ImGui::TextColored(rgb(235, 175, 95),
                       "%zu more boundaries lie inside this outline and are not cut here.",
                       camOutline_.islands());
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "%s program", posts[camPostIndex_]);
  ImGui::SameLine();
  ImGui::TextColored(rgb(130, 137, 148), "%zu lines", camPlan_.programLines);
  ImGui::SameLine();
  if (ImGui::SmallButton("Copy")) {
    ImGui::SetClipboardText(camPlan_.program.c_str());
    note("copied the machine program to the clipboard");
  }
  ImGui::Separator();
  // The WHOLE program, unformatted and in the panel's own scroll region rather
  // than a nested one. It is machine code: reflowing it would change what it
  // means, and a nested child would hide it entirely whenever the tab is shorter
  // than the summary above -- which is a layout the docked bottom strip
  // routinely produces. TextUnformatted takes the string as one block, so a long
  // program costs one draw call rather than one per line.
  ImGui::TextUnformatted(camPlan_.program.c_str());
  camProgramRowsDrawn_ = camPlan_.programLines;
}

// ── STOCK ───────────────────────────────────────────────────────────────────
void ForgeFrame::drawStockPanel() {
  ensureCamPlan();
  camStockRowsDrawn_ = 0;
  const IrBuildReport& r = scene_.lastBuild();

  ImGui::TextColored(rgb(242, 158, 38), "The block");
  ImGui::Separator();
  if (!camStock_.ok) {
    ImGui::TextWrapped("%s", kCamNoPart);
    return;
  }
  ImGui::Text("size      %.2f x %.2f x %.2f mm", camStock_.sizeMm[0], camStock_.sizeMm[1],
              camStock_.sizeMm[2]);
  ImGui::Text("volume    %.3f mm3", camStock_.volumeMm3);
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::Text("          the part measures %.2f x %.2f x %.2f mm", r.bboxMax[0] - r.bboxMin[0],
              r.bboxMax[1] - r.bboxMin[1], r.bboxMax[2] - r.bboxMin[2]);
  ImGui::TextWrapped("The block is squared up around the part. Nothing is added underneath: the "
                     "underside of the part sits on the table.");
  ImGui::PopStyleColor();
  ImGui::SetNextItemWidth(-1);
  ImGui::SliderFloat("##camside_all", &camStockSideMm_, 0.0f, 30.0f, "%.2f mm spare all round");
  ImGui::SetNextItemWidth(-1);
  ImGui::SliderFloat("##camtop", &camStockTopMm_, 0.0f, 30.0f, "%.2f mm spare on top");
  camStockRowsDrawn_ += 2;

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What has to come off");
  ImGui::Separator();
  const double waste = camStock_.volumeMm3 - r.volume;
  ImGui::Text("part      %.3f mm3", r.volume);
  ImGui::Text("to remove %.3f mm3", waste);
  if (camStock_.volumeMm3 > 0.0) {
    ImGui::SameLine();
    ImGui::TextColored(rgb(130, 137, 148), "  %.1f%% of the block",
                       100.0 * waste / camStock_.volumeMm3);
  }
  camStockRowsDrawn_ += 2;
  const forge::ui::Material& material = partDoc_.material();
  if (material.hasDensity()) {
    const forge::ui::MassProperties block =
        forge::ui::massPropertiesOf(material, camStock_.volumeMm3);
    const forge::ui::MassProperties part = partMass();
    ImGui::Text("block     %s of %s",
                forge::ui::describeMass(block, forge::ui::MassUnit::Gram).c_str(),
                material.name.c_str());
    ImGui::Text("finished  %s",
                forge::ui::describeMass(part, forge::ui::MassUnit::Gram).c_str());
    ImGui::Text("swarf     %.3f g", block.massGrams - part.massGrams);
    camStockRowsDrawn_ += 3;
  } else {
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
    ImGui::TextWrapped("Choose a material on the Materials tab and this block gets a weight too.");
    ImGui::PopStyleColor();
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What this operation takes out");
  ImGui::Separator();
  if (!camCut_.ok) {
    ImGui::TextWrapped("%s", camCut_.advice.empty()
                                 ? "Set up an operation on the Post Output tab and its effect on "
                                   "the block appears here."
                                 : camCut_.advice.c_str());
    return;
  }
  ImGui::Text("removed   %.3f mm3", camCut_.removedVolumeMm3);
  if (camCut_.startVolumeMm3 > 0.0) {
    ImGui::SameLine();
    ImGui::TextColored(rgb(130, 137, 148), "  %.1f%% of the block",
                       100.0 * camCut_.removedVolumeMm3 / camCut_.startVolumeMm3);
  }
  ImGui::Text("left      %.3f mm3", camCut_.leftVolumeMm3);
  ImGui::Text("deepest   %.2f mm below the top", camCut_.deepestCutMm);
  camStockRowsDrawn_ += 3;
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::TextWrapped("Worked out by filling the block with %u by %u by %u cells of %.2f x %.2f x "
                     "%.2f mm and sweeping the tool through them, so it is that precise and no "
                     "more.",
                     camCut_.gridCells, camCut_.gridCells, camCut_.gridCells,
                     camCut_.cellSizeMm[0], camCut_.cellSizeMm[1], camCut_.cellSizeMm[2]);
  ImGui::TextWrapped("This setup has one operation in it, so the rest of the block is still "
                     "standing.");
  ImGui::PopStyleColor();
}

// ── MATERIALS ───────────────────────────────────────────────────────────────
void ForgeFrame::drawMaterialsPanel() {
  camMaterialRowsDrawn_ = 0;
  materialRowsDrawn_ = 0;
  for (const forge::ui::Material& mtl : forge::ui::materialLibrary()) {
    if (mtl.hasDensity()) ++materialRowsDrawn_;
  }
  const forge::ui::Material& material = partDoc_.material();
  const IrBuildReport& r = scene_.lastBuild();

  ImGui::TextColored(rgb(242, 158, 38), "This part is made of");
  ImGui::Separator();
  if (material.hasDensity()) {
    ImGui::Text("%s", material.name.c_str());
    ImGui::Text("density   %.0f kg per cubic metre", material.densityKgPerM3);
    camMaterialRowsDrawn_ += 2;
  } else {
    ImGui::TextWrapped("Nothing yet, so Forge cannot say what this part weighs. Choose one "
                       "below and its weight appears everywhere the part is described.");
  }

  ImGui::Spacing();
  ImGui::SetNextItemWidth(-1);
  if (ImGui::BeginCombo("##campickmaterial", material.name.c_str())) {
    for (const forge::ui::Material& m : forge::ui::materialLibrary()) {
      const bool chosen = m.id == material.id;
      char row[96];
      if (m.hasDensity()) {
        std::snprintf(row, sizeof(row), "%-24s %6.0f kg/m3", m.name.c_str(), m.densityKgPerM3);
      } else {
        std::snprintf(row, sizeof(row), "%-24s", m.name.c_str());
      }
      // RECORD, do not apply. This combo is drawn inside the dock walk, and
      // dispatching here would rebuild the document while the walk still holds
      // references into it -- the shape that has already shipped three crashes
      // in this class.
      if (ImGui::Selectable(row, chosen)) pendingMaterialId_ = m.id;
      if (chosen) ImGui::SetItemDefaultFocus();
      ++camMaterialRowsDrawn_;
    }
    ImGui::EndCombo();
  }
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::TextWrapped("Densities are typical handbook values for the alloy, not certified figures "
                     "for a particular batch.");
  ImGui::PopStyleColor();

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What it weighs");
  ImGui::Separator();
  if (!scene_.built() || !r.ok()) {
    ImGui::TextWrapped("%s", kCamNoPart);
    return;
  }
  const forge::ui::MassProperties mass = partMass();
  ImGui::Text("volume    %.3f mm3", mass.volumeMm3);
  if (mass.known) {
    ImGui::Text("weight    %s",
                forge::ui::describeMass(mass, forge::ui::MassUnit::Gram).c_str());
    ImGui::Text("          %s",
                forge::ui::describeMass(mass, forge::ui::MassUnit::Kilogram).c_str());
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
    ImGui::Text("          volume x %.0f kg per cubic metre", mass.densityKgPerM3);
    ImGui::PopStyleColor();
    camMaterialRowsDrawn_ += 3;
  } else {
    ImGui::TextColored(rgb(235, 175, 95), "weight    %s",
                       forge::ui::describeMass(mass, forge::ui::MassUnit::Gram).c_str());
    camMaterialRowsDrawn_ += 1;
  }
  ImGui::PushStyleColor(ImGuiCol_Text, ImGui::GetStyle().Colors[ImGuiCol_TextDisabled]);
  ImGui::TextWrapped("The Properties tab reports the same weight from the same measurement.");
  ImGui::PopStyleColor();
}

std::string sketchConstraintLabel(const std::string& keyword) {
  for (const SketchConstraintLabel& row : kSketchConstraintLabels) {
    if (keyword == row.keyword) return row.label;
  }
  return keyword;
}

const forge::ft::SketchInspection& ForgeFrame::sketchInspection() {
  // THE WITNESS IS THE PROGRAM ITSELF, compared, exactly as builtProgram_ is the
  // witness for the scene. A dirty FLAG here would have to be set by every path
  // that can change the document — the menu, the keyboard, the palette, undo,
  // redo, file.open, the CoPilot — and the one that forgot would leave these
  // four panels describing a sketch the user has already edited.
  const std::string program = partDoc_.irProgram();
  if (sketchInspected_ && program == sketchProgram_) return sketchInspection_;
  sketchInspection_ = forge::ft::inspectSketchesText(program);
  sketchProgram_ = program;
  sketchInspected_ = true;
  if (!sketchInspection_.ok && !sketchInspection_.error.empty()) {
    // A program the sketch reader cannot parse is a program the SCENE cannot
    // compile either, so this is the same failure the rebuild path already
    // translates — and it is translated the same way, through the one
    // translator, with the internal cause going to the log's detail channel
    // where an engineer can read it and a user never has to. Handing the raw
    // cause to note() would put it straight into the panel the console draws,
    // which is the leak this whole translator exists for.
    shell_.log().error("sketch", forge::ui::userFacingBuildFailure(sketchInspection_.error),
                       sketchInspection_.error);
  }
  return sketchInspection_;
}

int ForgeFrame::activeSketchIrId() {
  const forge::ft::SketchInspection& insp = sketchInspection();
  if (insp.sketches.empty()) return 0;
  // 1. THE SKETCH THE SELECTION IS IN. forge::ui::sketchRootOf is the same walk
  //    the command predicates use to decide whether a pair of picked entities
  //    belongs to one sketch, so the panel and the menu cannot disagree about
  //    which sketch the user is working in.
  for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
    const int irId = partDoc_.valueFor(r.bodyId);
    if (irId == 0) continue;
    const int root = forge::ui::sketchRootOf(partDoc_, irId);
    if (root == 0) continue;
    for (const forge::ft::SketchInfo& s : insp.sketches) {
      if (s.irId == root) return root;
    }
  }
  // 2. Otherwise the most recent sketch in the document, which is the one a user
  //    who just drew something is looking at.
  return insp.sketches.back().irId;
}

const forge::ft::SketchInfo* ForgeFrame::activeSketch() {
  const int id = activeSketchIrId();
  if (id == 0) return nullptr;
  for (const forge::ft::SketchInfo& s : sketchInspection().sketches) {
    if (s.irId == id) return &s;
  }
  return nullptr;
}

std::string ForgeFrame::sketchEntityName(const forge::ft::SketchInfo& s, int irId) const {
  for (const forge::ft::SketchEntityInfo& e : s.entities) {
    if (e.irId != irId) continue;
    switch (e.kind) {
      case forge::ft::SketchCurveKind::Point: return "Point " + std::to_string(irId);
      case forge::ft::SketchCurveKind::Line: return "Line " + std::to_string(irId);
      case forge::ft::SketchCurveKind::Circle: return "Circle " + std::to_string(irId);
      case forge::ft::SketchCurveKind::Arc: return "Arc " + std::to_string(irId);
    }
  }
  return "Item " + std::to_string(irId);
}

int ForgeFrame::sketchDimensionNumberIndex(int statementIrId) const {
  const forge::ui::FeatureRecord* rec = partDoc_.featureAt(statementIrId);
  if (rec == nullptr) return -1;
  // The index part.edit_feature counts by is the position among the statement's
  // NUMBER arguments. A dimension statement carries exactly one — a constrained
  // distance, an angle, a radius — so a statement with two would be one this
  // function cannot aim at, and it refuses rather than editing whichever came
  // first. A refusal makes the row read-only; a guess would silently rewrite the
  // wrong number of somebody's part.
  int numbers = 0;
  int firstIndex = -1;
  for (const forge::ui::IrArg& a : rec->line.args) {
    if (a.kind != forge::ui::IrArgKind::Number) continue;
    if (firstIndex < 0) firstIndex = numbers;
    ++numbers;
  }
  return numbers == 1 ? firstIndex : -1;
}

bool ForgeFrame::applySketchDimensionEdit(int statementIrId, double value) {
  const int index = sketchDimensionNumberIndex(statementIrId);
  if (index < 0) {
    note("Feature %" + std::to_string(statementIrId) +
         " has no single number to change, so the dimension was not edited");
    return false;
  }
  forge::ui::CommandParams p;
  p.setNumber("feature", static_cast<double>(statementIrId));
  p.setNumber("index", static_cast<double>(index));
  p.setNumber("value", value);
  // THE ONE REGISTRY, for the same reason the Properties panel uses it: a panel
  // that wrote to the document itself would bypass the undo stack, the activity
  // log and the enabled predicate.
  const forge::ui::DispatchResult r = shell_.run("part.edit_feature", p);
  if (!r.ok()) {
    note("Edit feature — " + std::string(forge::ui::userText(r.status)));
    return false;
  }
  note("Edit feature — done");
  // The document changed, so the part is rebuilt from it AND the field is
  // released: sketchInspection() will re-read the solver on the next call
  // because the program text it compares against has moved.
  syncSceneToDocument();
  sketchEditIrId_ = 0;
  return true;
}

const forge::ft::SketchInfo* ForgeFrame::drawSketchHeader(const char* title,
                                                          const char* emptyLine1,
                                                          const char* emptyLine2) {
  ImGui::TextColored(rgb(242, 158, 38), "%s", title);
  ImGui::Separator();
  const forge::ft::SketchInfo* s = activeSketch();
  if (s == nullptr) {
    // AN EMPTY STATE IS A FEATURE. It says what the user has to do to fill this
    // tab, which is the one thing a panel with nothing in it can usefully say.
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("%s", emptyLine1);
    ImGui::Spacing();
    ImGui::TextWrapped("%s", emptyLine2);
    ImGui::PopTextWrapPos();
    return nullptr;
  }

  std::size_t curves = 0;
  for (const forge::ft::SketchEntityInfo& e : s->entities) {
    if (e.kind != forge::ft::SketchCurveKind::Point) ++curves;
  }
  ImGui::Text("Sketch %d   %zu curves, %zu constraints", s->irId, curves,
              s->constraints.size());

  // THE HEALTH LINE, from the solver's own verdict — not from counting.
  // Counting entities against constraints is the estimate every sketcher starts
  // with and it is wrong for any coupled sketch; this is the Jacobian rank.
  switch (s->health) {
    case forge::ft::SketchHealth::FullyConstrained:
      ImGui::TextColored(rgb(120, 200, 130), "Fully constrained. Nothing in it can move.");
      break;
    case forge::ft::SketchHealth::UnderConstrained:
      if (s->dof > 0) {
        ImGui::TextColored(rgb(235, 175, 95), "%d %s of movement left.", s->dof,
                           s->dof == 1 ? "direction" : "directions");
      } else {
        ImGui::TextColored(rgb(235, 175, 95), "Parts of this sketch can still move.");
      }
      break;
    case forge::ft::SketchHealth::OverConstrained:
      ImGui::TextColored(rgb(235, 105, 95),
                         "Too many constraints: some of them contradict each other.");
      break;
    case forge::ft::SketchHealth::Redundant:
      ImGui::TextColored(rgb(235, 175, 95),
                         "Solved, but some constraints repeat what others already say.");
      break;
    case forge::ft::SketchHealth::Empty:
      ImGui::TextColored(rgb(235, 175, 95),
                         "Nothing constrains this sketch yet, so all of it can move.");
      break;
  }
  if (s->solveIrId == 0) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextDisabled("Not solved yet. Use Solve Sketch to turn it into a profile you can "
                        "extrude or revolve.");
    ImGui::PopTextWrapPos();
  } else if (s->solved && !s->converged) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 105, 95),
                       "The solver could not meet every constraint, so the sketch kept the "
                       "positions it was drawn with.");
    ImGui::PopTextWrapPos();
  }
  if (!s->planeApplied) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(rgb(235, 175, 95),
                       "This sketch asked for a different plane. Forge builds it flat, so the "
                       "positions below are the ones the part actually has.");
    ImGui::PopTextWrapPos();
  }
  return s;
}

// ── Constraints ─────────────────────────────────────────────────────────────
void ForgeFrame::drawSketchConstraintsPanel() {
  sketchConstraintRows_ = 0;
  constraintRowsDrawn_ = 0;
  const forge::ft::SketchInfo* s = drawSketchHeader(
      "Constraints", "There is no sketch in this part yet.",
      "Start one with New Sketch, then place points and lines in it. Everything you constrain "
      "shows up here with the solver's own verdict on it.");
  if (s == nullptr) return;
  ++constraintRowsDrawn_;
  ImGui::Spacing();
  if (s->constraints.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("Nothing constrains this sketch yet. Pick one line and use Constrain "
                       "Entity, or two points and Constrain Entity Pair.");
    ImGui::PopTextWrapPos();
    return;
  }

  ImGui::TextDisabled("The number on each row is how far this sketch is from satisfying it.");
  ImGui::Separator();
  for (const forge::ft::SketchConstraintInfo& c : s->constraints) {
    ++sketchConstraintRows_;
    ++constraintRowsDrawn_;
    ImGui::PushID(c.irId);

    // The verdict, in the order the solver decides it: whether it reached the
    // solver at all, then whether the repair had to drop it, then what the
    // diagnosis said about it, and only then its numeric error.
    const char* verdict = "holding";
    ImVec4 colour = rgb(120, 200, 130);
    std::string because;
    switch (c.state) {
      case forge::ft::SketchConstraintState::UnknownKind:
        verdict = "not applied";
        colour = rgb(235, 175, 95);
        because = "Forge has no constraint called " + c.keyword + ".";
        break;
      case forge::ft::SketchConstraintState::BadOperand:
        verdict = "not applied";
        colour = rgb(235, 175, 95);
        because = "It names something that is not part of this sketch.";
        break;
      case forge::ft::SketchConstraintState::Rejected:
        verdict = "not applied";
        colour = rgb(235, 175, 95);
        because = "This kind of constraint cannot be put on what it names.";
        break;
      case forge::ft::SketchConstraintState::Applied:
        if (c.demoted) {
          verdict = "dropped";
          colour = rgb(235, 105, 95);
          because = c.demotedForConflict
                        ? "Dropped so the rest could solve: it contradicts another constraint."
                        : "Dropped so the rest could solve: it could not be met.";
        } else if (c.conflicting) {
          verdict = "conflicts";
          colour = rgb(235, 105, 95);
          because = "It contradicts another constraint on this sketch.";
        } else if (c.redundant || c.partiallyRedundant) {
          verdict = "repeats";
          colour = rgb(235, 175, 95);
          because = "It adds nothing the other constraints do not already say.";
        } else if (c.hasResidual && std::fabs(c.residual) > kSketchSatisfiedTolerance) {
          verdict = "not met";
          colour = rgb(235, 175, 95);
          because = "The sketch does not satisfy it as it stands.";
        }
        break;
    }

    ImGui::TextColored(colour, "%-12s", verdict);
    ImGui::SameLine();
    ImGui::Text("%-20s", sketchConstraintLabel(c.keyword).c_str());
    ImGui::SameLine();

    std::string on;
    for (const int operand : c.operandIrIds) {
      if (!on.empty()) on += " and ";
      on += sketchEntityName(*s, operand);
    }
    ImGui::Text("%s", on.c_str());

    if (c.hasValue) {
      ImGui::SameLine();
      ImGui::TextColored(rgb(150, 157, 168), c.angular ? "  %.3f°" : "  %.3f mm", c.value);
    }
    if (c.hasResidual) {
      ImGui::SameLine();
      // THE SOLVER'S OWN RESIDUAL, always printed when it can give one. A column
      // that appeared only on failures would leave a user unable to tell
      // "satisfied" from "never measured", and those are very different things.
      // It carries no unit on purpose: the residual of a Distance is in
      // millimetres and the residual of an Angle is not, so a unit here would be
      // wrong on one of them.
      ImGui::TextColored(rgb(130, 137, 148), "   error %.6f", c.residual);
    }
    if (!because.empty()) {
      ImGui::Indent();
      ImGui::PushTextWrapPos(0.0f);
      ImGui::TextColored(rgb(150, 157, 168), "%s", because.c_str());
      ImGui::PopTextWrapPos();
      ImGui::Unindent();
    }
    ImGui::PopID();
  }
}

// ── Dimensions ──────────────────────────────────────────────────────────────
void ForgeFrame::drawSketchDimensionsPanel() {
  sketchDimensionRows_ = 0;
  const forge::ft::SketchInfo* s = drawSketchHeader(
      "Dimensions", "There is no sketch in this part yet.",
      "Start one with New Sketch. Radii and constrained distances then appear here, and "
      "changing one of them here changes the part.");
  if (s == nullptr) return;
  ImGui::Spacing();
  if (s->dimensions.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("This sketch has no dimensions yet. Add a Distance between two points, or "
                       "a circle, and its number shows up here.");
    ImGui::PopTextWrapPos();
    return;
  }
  ImGui::TextDisabled("Change a number and the part is rebuilt from it.");
  ImGui::Separator();

  for (const forge::ft::SketchDimensionInfo& d : s->dimensions) {
    ++sketchDimensionRows_;
    ImGui::PushID(d.irId);

    std::string what;
    if (d.source == forge::ft::SketchDimensionSource::CircleRadius) {
      what = "Radius of " + sketchEntityName(*s, d.irId);
    } else {
      what = sketchConstraintLabel(d.keyword);
      for (const int operand : d.operandIrIds) {
        what += (operand == d.operandIrIds.front() ? "  " : " and ");
        what += sketchEntityName(*s, operand);
      }
    }
    ImGui::Text("%s", what.c_str());
    ImGui::SameLine();
    ImGui::TextColored(rgb(130, 137, 148), "%s", d.angular ? "deg" : "mm");

    const int index = sketchDimensionNumberIndex(d.irId);
    if (index < 0) {
      // READ-ONLY, AND SAID SO. A field that cannot drive the model is a lie
      // whether or not it looks editable, so this one is not a field at all.
      ImGui::SameLine();
      ImGui::TextDisabled("   %.3f  (this one cannot be changed here)", d.value);
    } else {
      float v = (sketchEditIrId_ == d.irId) ? sketchEditValue_ : static_cast<float>(d.value);
      ImGui::SetNextItemWidth(140.0f * dpiScale_);
      if (ImGui::InputFloat("##dimvalue", &v, 0.0f, 0.0f, "%.3f")) {
        sketchEditIrId_ = d.irId;
        sketchEditValue_ = v;
      }
      ImGui::SameLine();
      const bool changed =
          sketchEditIrId_ == d.irId && static_cast<double>(sketchEditValue_) != d.value;
      ImGui::BeginDisabled(!changed);
      if (ImGui::Button("Apply")) {
        // RECORDED, not applied: this dispatches part.edit_feature, which
        // rewrites the document and rebuilds the feature tree the dock walk is
        // indexing. Every other mutation reachable from inside a panel is
        // deferred for exactly this reason, and the three crashes that taught
        // this class the rule were all the same shape.
        pendingSketchEditValid_ = true;
        pendingSketchEditIrId_ = d.irId;
        pendingSketchEditValue_ = static_cast<double>(sketchEditValue_);
      }
      ImGui::EndDisabled();
    }

    ImGui::Indent();
    if (!d.driving) {
      ImGui::TextColored(rgb(235, 105, 95),
                         "Not driving the part: the solver could not use it.");
    } else if (d.hasSolvedValue &&
               std::fabs(d.solvedValue - d.value) > kSketchSatisfiedTolerance) {
      // THE MOST USEFUL LINE IN THIS PANEL. A circle drawn at 4 with a Radius
      // constraint of 6 IS 6, and only a readback can say so.
      ImGui::TextColored(rgb(235, 175, 95), "The part uses %.3f — something else drives it.",
                         d.solvedValue);
    } else if (d.hasSolvedValue) {
      ImGui::TextColored(rgb(130, 137, 148), "The part measures %.3f here.", d.solvedValue);
    }
    ImGui::Unindent();
    ImGui::PopID();
  }
}

// ── Relations ───────────────────────────────────────────────────────────────
void ForgeFrame::drawSketchRelationsPanel() {
  sketchRelationRows_ = 0;
  relationRowsDrawn_ = 0;
  const forge::ft::SketchInfo* s = drawSketchHeader(
      "Relations", "There is no sketch in this part yet.",
      "Start one with New Sketch. Once it has constraints on it, this tab shows what moves "
      "when you drag something and what is holding everything else still.");
  if (s == nullptr) return;
  ++relationRowsDrawn_;
  ImGui::Spacing();

  // ── WHAT MOVES TOGETHER ────────────────────────────────────────────────
  // One group per remaining direction of movement, straight out of the solver's
  // own coupling analysis. Groups OVERLAP where a curve is coupled to more than
  // one direction, and that overlap is the answer to "what will move when you
  // drag this" rather than an artefact.
  ImGui::TextColored(rgb(242, 158, 38), "What moves together");
  ImGui::Separator();
  if (s->freeGroups.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("Nothing can move: the constraints on this sketch hold every curve in it.");
    ImGui::PopTextWrapPos();
  } else {
    for (const forge::ft::SketchFreeGroup& g : s->freeGroups) {
      ++sketchRelationRows_;
      ++relationRowsDrawn_;
      std::string members;
      for (const int irId : g.entityIrIds) {
        if (!members.empty()) members += ", ";
        members += sketchEntityName(*s, irId);
      }
      if (members.empty()) members = "part of this sketch";
      ImGui::BulletText("%s", members.c_str());
    }
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What each curve is free to do");
  ImGui::Separator();
  std::size_t movable = 0;
  for (const forge::ft::SketchEntityInfo& e : s->entities) {
    if (e.freeRoles.empty()) continue;
    ++movable;
    ++sketchRelationRows_;
    ++relationRowsDrawn_;
    std::string ways;
    for (const forge::ft::SketchFreeRole role : e.freeRoles) {
      if (!ways.empty()) ways += ", ";
      ways += sketchFreeRoleWord(role);
    }
    ImGui::BulletText("%s   moves %s", sketchEntityName(*s, e.irId).c_str(), ways.c_str());
  }
  if (movable == 0) {
    ImGui::TextDisabled("Every curve is held in place.");
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "What is holding each curve");
  ImGui::Separator();
  std::size_t held = 0;
  for (const forge::ft::SketchEntityInfo& e : s->entities) {
    if (e.constraintIrIds.empty()) continue;
    ++held;
    ++sketchRelationRows_;
    ++relationRowsDrawn_;
    std::string by;
    for (const int conIrId : e.constraintIrIds) {
      for (const forge::ft::SketchConstraintInfo& c : s->constraints) {
        if (c.irId != conIrId) continue;
        if (!by.empty()) by += ", ";
        by += sketchConstraintLabel(c.keyword);
        // The OTHER end of the constraint, which is the relation itself: this
        // curve is tied to that one.
        for (const int operand : c.operandIrIds) {
          if (operand == e.irId) continue;
          by += " to " + sketchEntityName(*s, operand);
        }
      }
    }
    ImGui::BulletText("%s   %s", sketchEntityName(*s, e.irId).c_str(), by.c_str());
  }
  if (held == 0) {
    ImGui::TextDisabled("No curve in this sketch carries a constraint yet.");
  }
}

// ── Curves ──────────────────────────────────────────────────────────────────
void ForgeFrame::drawSketchCurvesPanel() {
  sketchCurveRows_ = 0;
  const forge::ft::SketchInfo* s = drawSketchHeader(
      "Curves", "There is no sketch in this part yet.",
      "Start one with New Sketch and draw in it. Every point, line, circle and arc it holds is "
      "listed here at the size the solver gave it, and picking a row here picks it in the model.");
  if (s == nullptr) return;

  std::size_t points = 0, lines = 0, circles = 0, arcs = 0;
  for (const forge::ft::SketchEntityInfo& e : s->entities) {
    switch (e.kind) {
      case forge::ft::SketchCurveKind::Point: ++points; break;
      case forge::ft::SketchCurveKind::Line: ++lines; break;
      case forge::ft::SketchCurveKind::Circle: ++circles; break;
      case forge::ft::SketchCurveKind::Arc: ++arcs; break;
    }
  }
  ImGui::Text("%zu points, %zu lines, %zu circles, %zu arcs", points, lines, circles, arcs);
  ImGui::Separator();
  if (s->entities.empty()) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("This sketch is empty. Add a Sketch Point to it, then join two points "
                       "with a Sketch Line.");
    ImGui::PopTextWrapPos();
    return;
  }

  for (const forge::ft::SketchEntityInfo& e : s->entities) {
    ++sketchCurveRows_;
    ImGui::PushID(e.irId);
    char row[224];
    switch (e.kind) {
      case forge::ft::SketchCurveKind::Point:
        std::snprintf(row, sizeof(row), "Point %-4d  (%.3f, %.3f)", e.irId, e.x0, e.y0);
        break;
      case forge::ft::SketchCurveKind::Line:
        std::snprintf(row, sizeof(row), "Line %-5d  (%.3f, %.3f) to (%.3f, %.3f)   %.3f mm long",
                      e.irId, e.x0, e.y0, e.x1, e.y1, e.length);
        break;
      case forge::ft::SketchCurveKind::Circle:
        std::snprintf(row, sizeof(row), "Circle %-3d  centre (%.3f, %.3f)   radius %.3f mm",
                      e.irId, e.cx, e.cy, e.radius);
        break;
      case forge::ft::SketchCurveKind::Arc:
        std::snprintf(row, sizeof(row),
                      "Arc %-6d  centre (%.3f, %.3f)   radius %.3f mm   %.3f mm long", e.irId,
                      e.cx, e.cy, e.radius, e.length);
        break;
    }
    bool selected = false;
    for (const forge::ui::EntityRef& r : shell_.selection().selection()) {
      if (r.persistentName == "feature@" + std::to_string(e.irId)) selected = true;
    }
    // Picking a row picks the entity, through the SAME clickFeature the feature
    // tree uses — which is what makes the sketch commands (a line needs two
    // points, an arc needs three) reachable from this list.
    if (ImGui::Selectable(row, selected)) {
      clickFeature(e.irId, ImGui::GetIO().KeyShift || ImGui::GetIO().KeyCtrl);
    }
    if (e.hasWrittenRadius && e.hasRadius &&
        std::fabs(e.writtenRadius - e.radius) > kSketchSatisfiedTolerance) {
      ImGui::Indent();
      ImGui::TextColored(rgb(235, 175, 95), "drawn at %.3f mm; a constraint moved it",
                         e.writtenRadius);
      ImGui::Unindent();
    }
    ImGui::PopID();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TRUST PANELS — "is this part actually good?"
//
// Five tabs, one check. Interference, Verification, Continuity, Draft and Zebra
// are the surfaces a mechanical engineer opens before they commit to a model,
// and every number on all five comes from a kernel query run against the solid
// the viewport is drawing — the interference query, the shape and closure
// checks, the mass and topology measurements, the Class-A continuity pass, the
// mould draft pass and the zebra-stripe pass. See ModelQuality.hpp for which
// query fills which field.
//
// ── why there is a button ─────────────────────────────────────────────────
// The check is NOT part of a rebuild. The continuity pass alone projects a
// point onto two surfaces at every sample of every shared edge, so its cost is
// proportional to the model and putting it on every keystroke would make
// editing slower for everyone who never opens these tabs. A person asks; the
// check runs; the answer stays on screen and SAYS SO when the model has moved
// on underneath it.
//
// ── what is deliberately absent ───────────────────────────────────────────
// The Class-A pass also returns a fourth continuity term. The kernel's own
// header states, with the measurement, that it is identically zero for every
// join it has ever been run on — including a forty-fold curvature jump —
// because of what it projects onto what. A column that reads zero whatever the
// geometry does would be read as "this join is perfect". It is not drawn.
// ═══════════════════════════════════════════════════════════════════════════

bool ForgeFrame::qualityStale() const {
  if (!qualityRan_) return false;
  return qualityProgram_ != builtProgram_;
}

void ForgeFrame::runQualityCheck() {
  ++qualityChecksRun_;
  scene_.analyseQuality(qualitySettings_);
  qualityRan_ = true;
  qualityProgram_ = builtProgram_;
  // The check READS geometry and produces none: no rebuild is triggered, no
  // vertex buffer is re-uploaded, and the document is untouched.
}

// The shared top of the five panels. Returns true when there is an answer to
// draw below it.
//
// The heading is the panel's OWN name out of the catalogue, so the tab a person
// clicked and the heading they land on are the same words. A literal here would
// be a second name for one panel, free to drift from the tab.
bool ForgeFrame::beginQualityPanel(const char* panelId) {
  const forge::ui::PanelInfo* info = forge::ui::findPanelInfo(panelId);
  const std::string title =
      info != nullptr ? info->name : forge::ui::panelDisplayName(panelId);
  ImGui::TextColored(rgb(242, 158, 38), "%s", title.c_str());
  ImGui::Separator();

  const ModelQualityReport& q = quality();
  if (ImGui::Button(qualityRan_ ? "Check again" : "Check this model")) {
    pendingQualityCheck_ = true;
  }
  ImGui::SameLine();
  if (!qualityRan_) {
    ImGui::TextDisabled("nothing checked yet");
  } else if (qualityStale()) {
    ImGui::TextColored(rgb(230, 190, 90), "the model has changed since this was checked");
  } else {
    ImGui::TextColored(rgb(120, 200, 130), "up to date with the model on screen");
  }
  ImGui::Spacing();

  if (!qualityRan_) {
    ImGui::TextWrapped("Press the button above and every measurement on this tab will be "
                       "taken from your model.");
    return false;
  }
  if (!q.ran) {
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextWrapped("%s", q.unavailable.empty()
                                 ? "The check did not reach this model."
                                 : q.unavailable.c_str());
    ImGui::PopTextWrapPos();
    return false;
  }
  return true;
}

// ── interference: which solids occupy the same space ───────────────────────
void ForgeFrame::drawInterferencePanel() {
  clashRowsDrawn_ = 0;
  if (!beginQualityPanel("interference")) return;
  const ModelQualityReport& q = quality();

  if (!q.checkedClashes) {
    ImGui::TextWrapped("The solids in this model could not be separated out, so they could "
                       "not be compared with each other.");
    return;
  }

  ImGui::Text("%zu solid%s in this model", q.solids.size(), q.solids.size() == 1 ? "" : "s");
  if (q.solids.empty()) {
    // NOT the same answer as "one solid", and saying so matters: a model whose
    // faces never close into a solid body cannot be compared with anything, and
    // that is a fact about the model rather than a fact about the check.
    ImGui::Spacing();
    ImGui::TextWrapped("This model's faces do not close into a solid body, so there is nothing "
                       "here that could overlap. The Verify Report tab says which edges are "
                       "still open.");
    return;
  }
  if (q.solids.size() < 2) {
    ImGui::Spacing();
    ImGui::TextWrapped("One solid cannot overlap itself, so there is nothing to report here. "
                       "Open a file that holds several parts and each pair will be compared, "
                       "with the size and the position of every overlap.");
    return;
  }

  if (q.clashes.empty()) {
    ImGui::TextColored(rgb(120, 200, 130), "no two solids overlap");
  } else {
    ImGui::TextColored(rgb(235, 105, 95), "%zu overlap%s found", q.clashes.size(),
                       q.clashes.size() == 1 ? "" : "s");
  }
  ImGui::Spacing();

  for (const QualityClash& c : q.clashes) {
    ImGui::BulletText("solid %d and solid %d share %.4f mm3", c.solidA, c.solidB, c.volume);
    if (c.located) {
      ImGui::Text("     centre of the shared material  %.3f  %.3f  %.3f", c.com[0], c.com[1],
                  c.com[2]);
      ImGui::Text("     it reaches from  %.3f %.3f %.3f  to  %.3f %.3f %.3f", c.bboxMin[0],
                  c.bboxMin[1], c.bboxMin[2], c.bboxMax[0], c.bboxMax[1], c.bboxMax[2]);
      // TWO INSTRUMENTS ON ONE OVERLAP. The first number is the interference
      // query's; the second is the shared solid built and weighed on its own.
      // They are printed together only when they DISAGREE, because two numbers
      // that always match teach a reader to stop looking at either.
      const double reference = std::max(1e-9, std::fabs(c.volume));
      if (std::fabs(c.commonVolume - c.volume) > 1e-6 * reference) {
        ImGui::TextColored(rgb(230, 190, 90),
                           "     measured twice and the two answers differ: %.4f and %.4f mm3",
                           c.volume, c.commonVolume);
      }
    } else {
      ImGui::TextDisabled("     the shared material could not be measured on its own");
    }
    ++clashRowsDrawn_;
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "The solids");
  ImGui::Separator();
  for (const QualitySolid& s : q.solids) {
    if (s.measured) {
      ImGui::BulletText("solid %d   %.3f mm3   %.3f mm2   centre %.3f %.3f %.3f", s.index,
                        s.volume, s.area, s.com[0], s.com[1], s.com[2]);
    } else {
      ImGui::BulletText("solid %d   could not be weighed", s.index);
    }
  }
}

// ── verification: what passed, what failed, and why ────────────────────────
void ForgeFrame::drawVerifyReportPanel() {
  verifyRowsDrawn_ = 0;
  // The controls come FIRST, so the heading appears once and the Check button is
  // where it is on the other four tabs. What follows them is drawn WHETHER OR
  // NOT a check has been run, which is why the return value is held rather than
  // acted on here.
  const bool haveAnswer = beginQualityPanel("verify_report");

  // ── the part of this panel that needs no button ─────────────────────────
  // Whether the features read, built and drew is known after every rebuild, and
  // so is what the part asserts about itself. Making a person press Check to see
  // that their last edit failed would be the panel withholding the one thing it
  // is for.
  const IrBuildReport& r = scene_.lastBuild();
  ImGui::TextColored(rgb(242, 158, 38), "Building");
  const char* const kStages[] = {"features read", "shape built", "surface drawn"};
  const bool done[] = {r.parsed, r.compiled, r.tessellated};
  for (int i = 0; i < 3; ++i) {
    if (done[i]) {
      ImGui::TextColored(rgb(120, 200, 130), "   %s", kStages[i]);
    } else {
      ImGui::TextColored(rgb(235, 105, 95), "   %s  -  did not finish", kStages[i]);
    }
    ++verifyRowsDrawn_;
  }
  if (!r.ok()) {
    if (r.failedOpId > 0) {
      const forge::ui::FeatureRecord* rec = partDoc_.featureAt(r.failedOpId);
      if (rec != nullptr && !rec->label.empty()) {
        ImGui::TextColored(rgb(235, 105, 95), "   it stopped at  %s", rec->label.c_str());
      } else {
        ImGui::TextColored(rgb(235, 105, 95), "   it stopped at feature %d", r.failedOpId);
      }
    } else if (r.failedLine > 0) {
      ImGui::TextColored(rgb(235, 105, 95), "   it stopped at feature %d", r.failedLine);
    }
    const std::string why = forge::ui::userFacingBuildFailure(scene_.error());
    if (!why.empty()) {
      ImGui::PushTextWrapPos(0.0f);
      ImGui::TextWrapped("   %s", why.c_str());
      ImGui::PopTextWrapPos();
    }
  }
  ImGui::Text("   %zu of %zu features built", r.nCompiled, r.nDeclared);
  ++verifyRowsDrawn_;

  // ── the checks the part carries ─────────────────────────────────────────
  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Checks written into the part");
  if (r.checks.empty()) {
    ImGui::TextDisabled("   this part carries none");
  }
  for (const std::string& line : r.checks) {
    if (line.rfind("PASS ", 0) == 0) {
      ImGui::TextColored(rgb(120, 200, 130), "   met      %s", line.c_str() + 5);
    } else if (line.rfind("FAIL ", 0) == 0) {
      ImGui::TextColored(rgb(235, 105, 95), "   NOT met  %s", line.c_str() + 5);
    } else if (forge::ui::userFacingProseIsClean(line)) {
      // A surface check writes a summary line rather than a met/not-met verdict.
      // It is the kernel's wording, not this application's, so it is SCANNED
      // before it is shown -- the same rule the shape-fault list below follows,
      // and the reason a line this version cannot put in a user's words is
      // summarised instead of pasted.
      ImGui::Text("   %s", line.c_str());
    } else {
      ImGui::TextDisabled("   a check this version cannot describe in plain words");
    }
    ++verifyRowsDrawn_;
  }

  if (!haveAnswer) {
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
    for (const forge::ui::InspectionCheck& c : report.checks) {
      ImGui::Text("   %s", c.name.c_str());
      ++verifyRowsDrawn_;
    }
    return;
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Measured");
  ImGui::Separator();
  const ModelQualityReport& q = quality();

  if (q.checkedMass) {
    ImGui::Text("volume    %.4f mm3", q.volume);
    ImGui::Text("surface   %.4f mm2", q.area);
    ImGui::Text("centre    %.4f  %.4f  %.4f", q.com[0], q.com[1], q.com[2]);
    verifyRowsDrawn_ += 3;
  } else {
    ImGui::TextColored(rgb(230, 190, 90), "volume    could not be measured on this model");
  }
  if (q.checkedBox) {
    ImGui::Text("size      %.4f x %.4f x %.4f mm", q.bboxMax[0] - q.bboxMin[0],
                q.bboxMax[1] - q.bboxMin[1], q.bboxMax[2] - q.bboxMin[2]);
    ++verifyRowsDrawn_;
  }
  if (q.checkedCounts) {
    ImGui::Text("faces %ld   edges %ld", q.faceCount, q.edgeCount);
    ++verifyRowsDrawn_;
  }
  if (q.checkedTopology) {
    ImGui::Text("%ld separate bod%s, %ld opening%s straight through", q.shells,
                q.shells == 1 ? "y" : "ies", q.genus, q.genus == 1 ? "" : "s");
    ++verifyRowsDrawn_;
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Sound shape");
  ImGui::Separator();
  if (q.checkedClosure) {
    if (q.closed && q.manifold && q.oriented) {
      ImGui::TextColored(rgb(120, 200, 130),
                         "closed, every edge shared by two faces, facing outward");
    } else {
      if (!q.closed) ImGui::TextColored(rgb(235, 105, 95), "the surface does not close");
      if (!q.manifold) {
        ImGui::TextColored(rgb(235, 105, 95), "some edges are shared by more than two faces");
      }
      if (!q.oriented) ImGui::TextColored(rgb(235, 105, 95), "some faces point inward");
    }
    if (q.selfIntersecting) {
      ImGui::TextColored(rgb(235, 105, 95), "the shape passes through itself");
    }
    if (q.badFaces > 0 || q.badEdges > 0) {
      ImGui::Text("%zu face%s and %zu edge%s need attention", q.badFaces,
                  q.badFaces == 1 ? "" : "s", q.badEdges, q.badEdges == 1 ? "" : "s");
    }
    ++verifyRowsDrawn_;
  } else {
    ImGui::TextColored(rgb(230, 190, 90), "the surface could not be checked for closure");
  }
  if (q.checkedShape) {
    if (q.shapeValid) {
      ImGui::TextColored(rgb(120, 200, 130), "the full shape check found nothing wrong");
    } else {
      ImGui::TextColored(rgb(235, 105, 95), "the full shape check found %ld faulty piece%s",
                         q.faultyCount, q.faultyCount == 1 ? "" : "s");
      for (const std::string& f : q.faults) {
        // The kernel's own wording for what it found. Scanned before it is
        // drawn, because it is text this application did not write: a phrase
        // that would leak the program's internals is summarised instead.
        if (forge::ui::userFacingProseIsClean(f)) {
          ImGui::BulletText("%s", f.c_str());
        } else {
          ImGui::BulletText("a fault this version cannot describe in plain words");
        }
      }
    }
    ++verifyRowsDrawn_;
  }

  // ── two instruments on one model ────────────────────────────────────────
  // The shape's own volume and the volume of the SURFACE THE VIEWPORT DRAWS are
  // independent measurements of the same body. A wrong solid reproducing a right
  // volume has been measured repeatedly in this programme; two measurements that
  // disagree is the cheapest way to see it.
  const forge::ui::MeshMeasure& m = modelMeasure();
  if (q.checkedMass && m.watertight && m.volume > 0.0) {
    ImGui::Spacing();
    ImGui::TextColored(rgb(242, 158, 38), "Measured twice");
    ImGui::Separator();
    ImGui::Text("from the shape     %.4f mm3", q.volume);
    ImGui::Text("from the surface   %.4f mm3", m.volume);
    const double gap = std::fabs(q.volume - m.volume) / std::max(1e-9, std::fabs(q.volume));
    if (gap <= 0.01) {
      ImGui::TextColored(rgb(120, 200, 130), "they agree to %.4f%%", gap * 100.0);
    } else {
      ImGui::TextColored(rgb(235, 105, 95), "they differ by %.4f%%", gap * 100.0);
    }
    if (q.checkedCounts) {
      const long drawn = static_cast<long>(m.faces);
      if (drawn == q.faceCount) {
        ImGui::TextColored(rgb(120, 200, 130), "both count %ld faces", q.faceCount);
      } else {
        ImGui::TextColored(rgb(230, 190, 90), "the shape has %ld faces, %ld were drawn",
                           q.faceCount, drawn);
      }
    }
    verifyRowsDrawn_ += 2;
  }
}

// ── continuity: how neighbouring faces meet ────────────────────────────────
void ForgeFrame::drawContinuityPanel() {
  continuityRowsDrawn_ = 0;
  if (!qualityRan_) {
    const forge::ui::ContinuityReport report = continuityReport();
    ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
    ImGui::Separator();
    if (!report.known) {
      ImGui::TextWrapped("There is nothing on screen to measure yet.");
      return;
    }
    ImGui::TextColored(report.sharp == 0 ? rgb(120, 200, 140) : rgb(130, 137, 148),
                       "%zu joins run in smoothly, %zu break", report.smooth, report.sharp);
    ImGui::Separator();
    for (const forge::ui::SurfaceJoin& j : report.joins) {
      ImGui::Text("faces %d and %d: %.2f deg", j.faceA, j.faceB, j.maxBreakDeg);
      ++continuityRowsDrawn_;
    }
    return;
  }
  if (!beginQualityPanel("continuity")) return;
  const ModelQualityReport& q = quality();

  if (!q.checkedContinuity) {
    ImGui::TextWrapped("The joins between this model's faces could not be found.");
    return;
  }
  if (q.joins.empty()) {
    ImGui::TextWrapped("No two faces in this model share an edge, so there is no join to "
                       "report on.");
    return;
  }

  // The thresholds are the ones the surface module itself uses to call a join
  // smooth. They are named here in the words a reviewer uses at the bench.
  std::size_t apart = 0, angled = 0, tangent = 0, smooth = 0, unmeasured = 0;
  for (const QualityJoin& j : q.joins) {
    if (!j.measured) { ++unmeasured; continue; }
    if (j.g0mm >= 1.0e-3) ++apart;
    else if (j.g1deg >= 1.0) ++angled;
    else if (j.g2pct >= 5.0) ++tangent;
    else ++smooth;
  }
  ImGui::Text("%zu join%s between neighbouring faces", q.sharedEdges,
              q.sharedEdges == 1 ? "" : "s");
  ImGui::TextColored(rgb(120, 200, 130), "   %zu flow through with no change of curvature",
                     smooth);
  ImGui::TextColored(rgb(150, 200, 230), "   %zu meet smoothly but the curvature steps", tangent);
  ImGui::Text("   %zu meet at a visible angle", angled);
  if (apart > 0) {
    ImGui::TextColored(rgb(235, 105, 95), "   %zu leave a gap between the two faces", apart);
  }
  if (unmeasured > 0) ImGui::TextDisabled("   %zu could not be measured", unmeasured);
  if (q.continuityCapped) {
    ImGui::TextColored(rgb(230, 190, 90),
                       "This model has more joins than one check reports on; the %zu listed "
                       "below are the ones that were measured.",
                       q.joins.size());
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Roughest first");
  ImGui::Separator();

  // Sorted by what a reviewer looks for, in order: a gap first, then a crease,
  // then a curvature step. Sorting a COPY of the indices leaves the report the
  // check produced untouched.
  std::vector<std::size_t> order(q.joins.size());
  for (std::size_t i = 0; i < order.size(); ++i) order[i] = i;
  std::sort(order.begin(), order.end(), [&q](std::size_t a, std::size_t b) {
    const QualityJoin& x = q.joins[a];
    const QualityJoin& y = q.joins[b];
    if ((x.g0mm >= 1.0e-3) != (y.g0mm >= 1.0e-3)) return x.g0mm >= 1.0e-3;
    if (x.g1deg != y.g1deg) return x.g1deg > y.g1deg;
    if (x.g2pct != y.g2pct) return x.g2pct > y.g2pct;
    return a < b;
  });

  if (ImGui::BeginChild("##joins", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    for (std::size_t idx : order) {
      const QualityJoin& j = q.joins[idx];
      if (!j.measured) {
        ImGui::BulletText("faces %d and %d   could not be measured", j.faceA, j.faceB);
        ++continuityRowsDrawn_;
        continue;
      }
      const char* verdict = "flows through";
      ImVec4 colour = rgb(120, 200, 130);
      if (j.g0mm >= 1.0e-3) {
        verdict = "leaves a gap";
        colour = rgb(235, 105, 95);
      } else if (j.g1deg >= 1.0) {
        verdict = "meets at an angle";
        colour = rgb(190, 195, 205);
      } else if (j.g2pct >= 5.0) {
        verdict = "smooth, curvature steps";
        colour = rgb(150, 200, 230);
      }
      ImGui::TextColored(colour, "faces %d and %d   %s", j.faceA, j.faceB, verdict);
      ImGui::Text("     gap %.6f mm   angle %.4f deg   curvature step %.2f%%   over %u points",
                  j.g0mm, j.g1deg, j.g2pct, j.samples);
      ++continuityRowsDrawn_;
    }
  }
  ImGui::EndChild();
}

// ── draft: where a surface tips past the pull direction ────────────────────
void ForgeFrame::drawIsoclinePanel() {
  draftRowsDrawn_ = 0;
  if (!qualityRan_) {
    const forge::ui::DraftReport report = draftReport();
    ImGui::TextColored(rgb(242, 158, 38), "%s", documentName_.c_str());
    ImGui::Separator();
    if (!report.known) {
      ImGui::TextWrapped("There is nothing on screen to measure yet.");
      return;
    }
    ImGui::TextDisabled("pull it out along");
    for (forge::ui::PullAxis axis : forge::ui::allPullAxes()) {
      ImGui::SameLine();
      const bool on = axis == draftPull_;
      if (on) ImGui::PushStyleColor(ImGuiCol_Button, rgb(242, 158, 38, 0.55f));
      if (ImGui::SmallButton(forge::ui::pullAxisWord(axis))) setDraftPull(axis);
      if (on) ImGui::PopStyleColor();
    }
    ImGui::TextDisabled("taper the job asks for");
    const double kOffered[] = {0.0, 1.0, 2.0, 3.0, 5.0};
    for (double degrees : kOffered) {
      ImGui::SameLine();
      char label[24];
      std::snprintf(label, sizeof(label), "%.0f deg", degrees);
      const bool on = std::fabs(degrees - report.requiredDeg) < 1e-9;
      if (on) ImGui::PushStyleColor(ImGuiCol_Button, rgb(242, 158, 38, 0.55f));
      ImGui::PushID(label);
      if (ImGui::SmallButton(label)) setRequiredDraft(degrees);
      ImGui::PopID();
      if (on) ImGui::PopStyleColor();
    }
    ImGui::Separator();
    for (const forge::ui::DraftFace& f : report.faces) {
      ImGui::Text("face %d: %.2f deg", f.faceId, f.draftDeg);
      ++draftRowsDrawn_;
    }
    return;
  }
  if (!beginQualityPanel("isocline")) return;
  const ModelQualityReport& q = quality();

  // The pull direction is a SETTING of the check, so changing it asks for a new
  // one rather than re-labelling the old answer.
  ImGui::Text("Pull direction");
  ImGui::SameLine();
  const char* const kNames[] = {"+X", "-X", "+Y", "-Y", "+Z", "-Z"};
  const double kDirs[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
  for (int i = 0; i < 6; ++i) {
    if (i > 0) ImGui::SameLine();
    const bool on = std::fabs(qualitySettings_.pull[0] - kDirs[i][0]) < 1e-9 &&
                    std::fabs(qualitySettings_.pull[1] - kDirs[i][1]) < 1e-9 &&
                    std::fabs(qualitySettings_.pull[2] - kDirs[i][2]) < 1e-9;
    ImGui::PushStyleColor(ImGuiCol_Button, on ? rgb(70, 78, 92) : rgb(38, 42, 50));
    if (ImGui::Button(kNames[i])) {
      for (int k = 0; k < 3; ++k) qualitySettings_.pull[k] = kDirs[i][k];
      pendingQualityCheck_ = true;
    }
    ImGui::PopStyleColor();
  }
  ImGui::Text("checked along  %.0f  %.0f  %.0f   with %.1f deg counted as standing along it",
              q.pull[0], q.pull[1], q.pull[2], q.draftThresholdDeg);

  if (!q.checkedDraft) {
    ImGui::Spacing();
    ImGui::TextWrapped("The faces of this model could not be measured against that direction.");
    return;
  }

  // ── the caveat, before the counts it qualifies ──────────────────────────
  // Each face is measured at ONE point, at the middle of the face. On a flat
  // face that point IS the face. On a curved one the angle changes across the
  // surface, so the row below is a reading at the middle and not a verdict on
  // the whole of it -- said here once, and marked again on every row it applies
  // to.
  std::size_t curved = 0, unknownShape = 0;
  for (const QualityDraftFace& d : q.draft) {
    if (!d.curvatureMeasured) ++unknownShape;
    else if (!d.flat) ++curved;
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(120, 200, 130), "%zu face%s release", q.releasing,
                     q.releasing == 1 ? "" : "s");
  if (q.undercutting > 0) {
    ImGui::TextColored(rgb(235, 105, 95), "%zu face%s hold the part in", q.undercutting,
                       q.undercutting == 1 ? "" : "s");
  } else {
    ImGui::TextColored(rgb(120, 200, 130), "no face holds the part in");
  }
  ImGui::Text("%zu face%s stand along the pull with no draft either way", q.standingVertical,
              q.standingVertical == 1 ? "" : "s");
  if (curved > 0) {
    ImGui::TextColored(rgb(230, 190, 90),
                       "%zu of those %s curved: each is read at the middle of the face, and the "
                       "angle changes across it.",
                       curved, curved == 1 ? "is" : "are");
  }
  if (unknownShape > 0) {
    ImGui::TextDisabled("%zu face%s could not be told flat from curved", unknownShape,
                        unknownShape == 1 ? "" : "s");
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "The faces that hold it in, first");
  ImGui::Separator();

  std::vector<std::size_t> order(q.draft.size());
  for (std::size_t i = 0; i < order.size(); ++i) order[i] = i;
  std::sort(order.begin(), order.end(), [&q](std::size_t a, std::size_t b) {
    const QualityDraftFace& x = q.draft[a];
    const QualityDraftFace& y = q.draft[b];
    const int rx = x.verdict == DraftVerdict::Undercut ? 0
                                                       : (x.verdict == DraftVerdict::Vertical ? 1 : 2);
    const int ry = y.verdict == DraftVerdict::Undercut ? 0
                                                       : (y.verdict == DraftVerdict::Vertical ? 1 : 2);
    if (rx != ry) return rx < ry;
    if (x.area != y.area) return x.area > y.area;
    return a < b;
  });

  if (ImGui::BeginChild("##draft", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    for (std::size_t idx : order) {
      const QualityDraftFace& d = q.draft[idx];
      const char* verdict = "releases";
      ImVec4 colour = rgb(120, 200, 130);
      if (d.verdict == DraftVerdict::Undercut) {
        verdict = "holds the part in";
        colour = rgb(235, 105, 95);
      } else if (d.verdict == DraftVerdict::Vertical) {
        verdict = "stands along the pull";
        colour = rgb(190, 195, 205);
      }
      ImGui::TextColored(colour, "face %d   %s", d.face, verdict);
      if (d.area > 0.0) {
        ImGui::Text("     %s   %.3f mm2   %.3f deg from the pull",
                    d.kind.empty() ? "surface" : d.kind.c_str(), d.area, d.angleDeg);
      } else {
        ImGui::Text("     %.3f deg from the pull", d.angleDeg);
      }
      // The caveat travels WITH the number it qualifies. A reader who scrolls
      // past the summary above must still be able to tell a whole-face verdict
      // from a reading at one point.
      if (!d.curvatureMeasured) {
        ImGui::TextDisabled("     this face could not be told flat from curved");
      } else if (!d.flat) {
        ImGui::TextColored(rgb(230, 190, 90),
                           "     curved: read at the middle, and the angle changes across it");
      }
      ++draftRowsDrawn_;
    }
  }
  ImGui::EndChild();
}

// ── zebra: the stripe pattern a surface reflects ───────────────────────────
void ForgeFrame::drawZebraPanel() {
  zebraCellsDrawn_ = 0;
  if (!beginQualityPanel("zebra_analysis")) return;
  const ModelQualityReport& q = quality();

  if (!q.checkedZebra || q.zebra.empty()) {
    ImGui::TextWrapped("The stripe pattern could not be taken from this model's faces.");
    return;
  }

  ImGui::Text("%zu face%s striped, %u bands, light from  %.2f  %.2f  %.2f", q.zebra.size(),
              q.zebra.size() == 1 ? "" : "s", q.stripeCount, q.light[0], q.light[1], q.light[2]);
  if (q.zebraCapped) {
    ImGui::TextColored(rgb(230, 190, 90),
                       "This model has more faces than one check stripes; the first %zu are "
                       "listed.",
                       q.zebra.size());
  }

  // A face the user has picked in the 3D view wins: they asked about THAT one.
  const std::vector<std::uint32_t> picked = selectedFaceIds();
  if (picked.size() == 1) zebraFace_ = static_cast<int>(picked.front());

  const QualityZebraFace* shown = nullptr;
  for (const QualityZebraFace& z : q.zebra) {
    if (z.face == zebraFace_) { shown = &z; break; }
  }
  if (shown == nullptr) shown = &q.zebra.front();

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Face %d, laid out flat", shown->face);
  ImGui::Separator();
  ImGui::Text("%u band%s cross this face", shown->bands, shown->bands == 1 ? "" : "s");

  // ── THE STRIPES THEMSELVES ────────────────────────────────────────────────
  // One cell per sample the check took, in the face's own surface coordinates.
  // The stripe number IS the value the check recorded; the only thing done to it
  // here is turning an odd number dark and an even number light, which is what
  // makes a stripe a stripe. A band that wanders, splits or reverses across the
  // patch is the defect this view exists to show.
  {
    const float cell = std::max(3.0f, 8.0f * dpiScale_);
    const ImVec2 origin = ImGui::GetCursorScreenPos();
    ImDrawList* dl = ImGui::GetWindowDrawList();
    for (std::uint32_t row = 0; row < shown->gridH; ++row) {
      for (std::uint32_t col = 0; col < shown->gridW; ++col) {
        const std::size_t at = static_cast<std::size_t>(row) * shown->gridW + col;
        if (at >= shown->stripes.size()) continue;
        const bool dark = (shown->stripes[at] % 2u) == 0u;
        const ImVec2 lo(origin.x + static_cast<float>(col) * cell,
                        origin.y + static_cast<float>(row) * cell);
        const ImVec2 hi(lo.x + cell, lo.y + cell);
        dl->AddRectFilled(lo, hi, ImGui::GetColorU32(dark ? rgb(26, 29, 34) : rgb(222, 226, 232)));
        ++zebraCellsDrawn_;
      }
    }
    const float side = cell * static_cast<float>(std::max(shown->gridW, 1u));
    const float tall = cell * static_cast<float>(std::max(shown->gridH, 1u));
    dl->AddRect(origin, ImVec2(origin.x + side, origin.y + tall),
                ImGui::GetColorU32(rgb(90, 96, 106)));
    ImGui::Dummy(ImVec2(side, tall));
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Every face");
  ImGui::Separator();
  if (ImGui::BeginChild("##zebrafaces", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    for (const QualityZebraFace& z : q.zebra) {
      char label[64];
      std::snprintf(label, sizeof(label), "face %d   %u band%s##zebra%d", z.face, z.bands,
                    z.bands == 1 ? "" : "s", z.face);
      if (ImGui::Selectable(label, z.face == shown->face)) zebraFace_ = z.face;
    }
  }
  ImGui::EndChild();
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
  if (ImGui::Begin("Set the values", &open,
                   ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoCollapse |
                       ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::TextColored(rgb(242, 158, 38), "%s", label.c_str());
    ImGui::Separator();
    // WHAT THE USER IS LOOKING AT, and it is no longer one thing. This window
    // used to open only when nothing could fill a box, so it said so. It is now
    // also how every command with a size, a position or an option is set up, and
    // those boxes open ALREADY HOLDING the values the command will use -- so the
    // line has to tell the truth about which of the two is on screen, or it is
    // telling a user a value is missing while they are reading it.
    std::size_t blank = 0;
    for (const PromptField& f : promptFields_) {
      if (f.value[0] == '\0') ++blank;
    }
    if (blank == 0) {
      ImGui::TextWrapped(
          "These are the values Forge will use. Change any of them, then press Run.");
    } else if (blank == promptFields_.size()) {
      ImGui::TextWrapped(
          "Forge has no starting value for %s below, so type %s and press Run.",
          blank == 1 ? "the box" : "these boxes", blank == 1 ? "it" : "them");
    } else {
      ImGui::TextWrapped(
          "These are the values Forge will use. The %zu empty %s no starting value, so "
          "fill %s in, then press Run.",
          blank, blank == 1 ? "box has" : "boxes have", blank == 1 ? "it" : "them");
    }
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
      if (f.type == forge::ui::ParamType::Flag) {
        // ── A BOOLEAN GETS A CHECKBOX ───────────────────────────────────────
        // part.loft's `ruled` and `open`, part.skin's `ruled` and
        // part.variable_fillet's `smooth` are the four, and as text boxes they
        // asked the user to guess a spelling: "on", "yes", "true" and "1" all
        // work, everything else is off, and NONE of that is written anywhere a
        // user reads. A checkbox has one state, shows it, and cannot be typed
        // wrong. What it writes back is still the same "on"/"off" text the
        // dispatch reads through flagFromText(), so there is one representation
        // and not two.
        bool on = flagFromText(f.value.data());
        if (ImGui::Checkbox("##v", &on)) {
          std::snprintf(f.value.data(), f.value.size(), "%s", on ? "on" : "off");
        }
      } else if (ImGui::InputText("##v", f.value.data(), f.value.size(),
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

// ── the unsaved-changes question ────────────────────────────────────────────
// A plain window rather than an ImGui modal, for the reason stated over
// drawParameterPrompt(): a modal grabs input for as long as it stands, and the
// user may well want to look at the part they are being asked about. The
// application does not close while this is up, which is what makes it a guard
// rather than a notice.
//
// THREE buttons, and the destructive one says what it destroys. "Don't Save" is
// what every other application writes there and it is the one word in the
// sentence a hurried user does not read; "Close Without Saving" cannot be
// misread as the safe choice.
void ForgeFrame::drawQuitPrompt() {
  if (!quitPrompt_) return;
  const ImGuiIO& io = ImGui::GetIO();
  const float w = std::min(560.0f * dpiScale_, io.DisplaySize.x * 0.6f);
  ImGui::SetNextWindowPos(ImVec2((io.DisplaySize.x - w) * 0.5f, io.DisplaySize.y * 0.24f),
                          ImGuiCond_Appearing);
  ImGui::SetNextWindowSize(ImVec2(w, 0));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12, 10));
  bool open = true;
  if (ImGui::Begin("Close Forge?", &open,
                   ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoCollapse |
                       ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::TextColored(rgb(242, 158, 38), "%s", (documentName_ + kPartFileExtension).c_str());
    ImGui::Separator();
    // WHERE the work would go, in the user's terms. A part that has never been
    // saved and one that has are different situations and the sentence says so,
    // because "Save" means "pick a name" in the first and "write the file you
    // already have" in the second.
    if (documentPath_.empty()) {
      ImGui::TextWrapped("This part has changes you have not saved, and it has never been "
                         "saved anywhere. Close it now and the changes are gone. Saving will "
                         "ask you where to put it.");
    } else {
      ImGui::TextWrapped("This part has changes you have not saved. Close it now and the "
                         "changes are gone; saving writes them back to the file you opened.");
      ImGui::Spacing();
      ImGui::TextDisabled("%s", documentPath_.c_str());
    }
    ImGui::Spacing();
    if (ImGui::Button("Save and Close")) answerQuitSave();
    ImGui::SameLine();
    if (ImGui::Button("Close Without Saving")) answerQuitDiscard();
    ImGui::SameLine();
    if (ImGui::Button("Keep Working")) answerQuitCancel();
    // Escape is the SAFE answer, always. The window's own close box is the same
    // answer, which is why `open` going false is a cancel and not a quit.
    if (ImGui::IsKeyPressed(ImGuiKey_Escape)) open = false;
  }
  ImGui::End();
  ImGui::PopStyleVar();
  if (!open) answerQuitCancel();
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
