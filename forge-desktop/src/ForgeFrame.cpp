#include "ForgeFrame.hpp"

#include "PartFile.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "Camera.hpp"
#include "KernelScene.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureTreeModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

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
      {"archie_plan", "Plan"},            {"archie_tools", "Tools"},
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
    case forge::ui::FeatureState::Ok:         return "OK";
    case forge::ui::FeatureState::Warning:    return "WARN";
    case forge::ui::FeatureState::Error:      return "ERROR";
    case forge::ui::FeatureState::Suppressed: return "SUPPR";
    case forge::ui::FeatureState::Rolled:     return "ROLLED";
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
void applyForgeStyle(float dpiScale) {
  ImGuiStyle& s = ImGui::GetStyle();
  s = ImGuiStyle();
  s.WindowRounding = 0.0f;   // a CAD shell is rectangular; rounded docks read as toys
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
  c[ImGuiCol_Text] = rgb(226, 229, 234);
  c[ImGuiCol_TextDisabled] = rgb(115, 121, 132);
  c[ImGuiCol_WindowBg] = rgb(30, 33, 38);
  c[ImGuiCol_ChildBg] = rgb(30, 33, 38);
  c[ImGuiCol_PopupBg] = rgb(38, 42, 49);
  c[ImGuiCol_Border] = rgb(56, 61, 70);
  c[ImGuiCol_FrameBg] = rgb(44, 48, 56);
  c[ImGuiCol_FrameBgHovered] = rgb(56, 62, 72);
  c[ImGuiCol_FrameBgActive] = rgb(66, 73, 85);
  c[ImGuiCol_TitleBg] = rgb(24, 27, 31);
  c[ImGuiCol_TitleBgActive] = rgb(34, 38, 44);
  c[ImGuiCol_MenuBarBg] = rgb(24, 27, 31);
  c[ImGuiCol_ScrollbarBg] = rgb(26, 29, 34);
  c[ImGuiCol_ScrollbarGrab] = rgb(62, 68, 78);
  c[ImGuiCol_CheckMark] = rgb(242, 158, 38);
  c[ImGuiCol_SliderGrab] = rgb(232, 150, 40);
  c[ImGuiCol_SliderGrabActive] = rgb(255, 176, 60);
  c[ImGuiCol_Button] = rgb(48, 53, 62);
  c[ImGuiCol_ButtonHovered] = rgb(64, 71, 83);
  c[ImGuiCol_ButtonActive] = rgb(242, 158, 38, 0.85f);
  c[ImGuiCol_Header] = rgb(52, 58, 68);
  c[ImGuiCol_HeaderHovered] = rgb(66, 74, 87);
  c[ImGuiCol_HeaderActive] = rgb(242, 158, 38, 0.65f);
  c[ImGuiCol_Separator] = rgb(56, 61, 70);
  c[ImGuiCol_Tab] = rgb(34, 38, 44);
  c[ImGuiCol_TabHovered] = rgb(66, 74, 87);
  c[ImGuiCol_TabSelected] = rgb(52, 58, 68);
  c[ImGuiCol_TabSelectedOverline] = rgb(242, 158, 38);
  c[ImGuiCol_TableHeaderBg] = rgb(40, 44, 51);
  c[ImGuiCol_TableBorderStrong] = rgb(56, 61, 70);
  c[ImGuiCol_TableRowBgAlt] = rgb(34, 37, 43);
  s.ScaleAllSizes(dpiScale);
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
  note("Forge desktop shell started");
  if (scene_.built()) {
    note("kernel body: " + std::to_string(scene_.triangleCount()) + " triangles, " +
         std::to_string(scene_.faceCount()) + " faces  [" + scene_.backend() + "]");
  } else {
    note("kernel body UNAVAILABLE: " + scene_.error());
  }
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
    note("view.fit: nothing to frame");
    return false;
  }
  camera_.frame(c, scene_.bounds().radius());
  note("view.fit: framed the body");
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
  if (!seedDefaultPart(why)) note("document seed FAILED: " + why);
  builtProgram_ = partDoc_.irProgram();
  scene_.setDocumentLabel(documentName_ + kPartFileExtension);

  const std::size_t added =
      forge::ui::registerPartCommands(shell_.registry(), partDoc_, partUndo_);
  partWired_ = true;
  // THE SEAM: from here the shell's one file.new/open/save and edit.undo/redo
  // act on this document, and the status strip's counters are read from it.
  shell_.setDocumentHost(this);
  note("registered " + std::to_string(added) + " Part commands into the shell registry");
  note("document seeded: " + std::to_string(partDoc_.records().size()) + " statements");
  rebuildTree();
  return added;
}

// ── the document -> geometry edge ───────────────────────────────────────────
bool ForgeFrame::syncSceneToDocument() {
  const std::string program = partDoc_.irProgram();
  if (program == builtProgram_) return false;

  const std::size_t before = scene_.triangleCount();
  const bool ok = scene_.buildFromIr(program);
  builtProgram_ = program;
  ++rebuilds_;
  documentDirty_ = true;
  geometryDirty_ = true;
  rebuildTree();

  const IrBuildReport& r = scene_.lastBuild();
  if (ok) {
    rebuildError_.clear();
    note("rebuilt: " + std::to_string(before) + " -> " + std::to_string(scene_.triangleCount()) +
         " triangles, " + std::to_string(r.faceCount) + " faces, V=" + std::to_string(r.volume) +
         (r.valid ? "  [valid]" : "  [INVALID SOLID]"));
  } else {
    rebuildError_ = r.error;
    // The previous body stays on screen -- what every history-based CAD system
    // does with a failed rebuild -- and the failure is stated, not swallowed.
    note("REBUILD FAILED: " + r.error + "  (showing the last good body)");
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
  note("new document");
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
  note("opened " + path + "  (" + std::to_string(partDoc_.records().size()) + " statements)");
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
  note("saved " + target + "  (" + std::to_string(file.features.size()) + " statements)");
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
void ForgeFrame::invoke(const std::string& id) {
  forge::ui::CommandParams params;
  const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
  if (d != nullptr) {
    // Fill every REQUIRED parameter from its schema default, overridden by the
    // live value the Properties panel is editing. A menu click that fails the
    // parameter gate would otherwise be indistinguishable from a broken command.
    for (const forge::ui::ParamSpec& p : d->schema) {
      if (!p.required) continue;
      switch (p.type) {
        case forge::ui::ParamType::Number:
          params.setNumber(p.name, p.name == "radius" || p.name == "distance" ||
                                           p.name == "thickness"
                                       ? static_cast<double>(paramValue_)
                                       : p.defaultNumber);
          break;
        case forge::ui::ParamType::Text:
          params.setText(p.name, p.defaultText.empty() ? std::string("untitled.fpart")
                                                       : p.defaultText);
          break;
        case forge::ui::ParamType::Flag:
          params.setFlag(p.name, false);
          break;
      }
    }
  }
  const forge::ui::DispatchResult r = shell_.run(id, params);
  if (r.ok()) {
    // A file.* command reports refusal through the shell, not through the
    // dispatch status: `execute` returns void, so "ok" only means it ran.
    if (shell_.lastDocumentError().empty()) {
      note(id + "  ->  ok");
    } else {
      note(id + "  ->  REFUSED: " + shell_.lastDocumentError());
    }
  } else {
    note(id + "  ->  " + forge::ui::toString(r.status) +
         (r.detail.empty() ? std::string() : ("  (" + r.detail + ")")));
  }
  // NO sync here. ForgeShell::run() has already called documentChanged() on this
  // object if the command declared sideEffect == Document, so the viewport is
  // already rebuilt by the time this line runs -- and it is rebuilt the same way
  // for a macro, an Archie tool call or a gate, none of which come through here.
  if (id == "app.command_palette") togglePalette();
}

// ── the feature PARAMETER editor ────────────────────────────────────────────
// The document was APPEND-ONLY until part.edit_feature existed, and the Properties
// panel said so: its one slider "feeds radius / distance / thickness on the NEXT
// command" and no control anywhere could change a number already in the program.
// These four methods are what the panel drives; every one of them resolves the
// target through the document itself rather than caching it, because undo, redo,
// New and Open all move records out from under a cached index.
namespace {

// The `index`-th NUMBER argument of a statement, or args.size() when there is no
// such argument. Written once and used by all four methods below AND matching
// paramTarget() in PartCommands.cpp -- if these two disagreed the panel would
// edit a different slot than the command it dispatches.
std::size_t numberArgAt(const std::vector<forge::ui::IrArg>& args, std::size_t index) {
  std::size_t seen = 0;
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (args[i].kind != forge::ui::IrArgKind::Number) continue;
    if (seen == index) return i;
    ++seen;
  }
  return args.size();
}

std::size_t numberArgCount(const std::vector<forge::ui::IrArg>& args) {
  std::size_t n = 0;
  for (const forge::ui::IrArg& a : args) {
    if (a.kind == forge::ui::IrArgKind::Number) ++n;
  }
  return n;
}

}  // namespace

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
  const std::size_t numbers = rec == nullptr ? 0 : numberArgCount(rec->line.args);
  editParamIndex_ = (numbers == 0 || paramIndex >= numbers) ? 0 : paramIndex;
  editValue_ = static_cast<float>(editParamValue());
}

std::size_t ForgeFrame::editParamCount() const {
  const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
  return rec == nullptr ? 0 : numberArgCount(rec->line.args);
}

double ForgeFrame::editParamValue() const {
  const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
  if (rec == nullptr) return 0.0;
  const std::size_t slot = numberArgAt(rec->line.args, editParamIndex_);
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
    note("part.edit_feature  ->  " + std::string(forge::ui::toString(r.status)) +
         (r.detail.empty() ? std::string() : ("  (" + r.detail + ")")));
    return false;
  }
  note("part.edit_feature  ->  ok");
  syncSceneToDocument();
  editValue_ = static_cast<float>(editParamValue());
  return true;
}

bool ForgeFrame::commandEnabled(const std::string& id) const {
  forge::ui::CommandParams params;
  const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
  if (d != nullptr) {
    for (const forge::ui::ParamSpec& p : d->schema) {
      if (!p.required) continue;
      switch (p.type) {
        case forge::ui::ParamType::Number: params.setNumber(p.name, p.defaultNumber); break;
        case forge::ui::ParamType::Text:   params.setText(p.name, "x"); break;
        case forge::ui::ParamType::Flag:   params.setFlag(p.name, false); break;
      }
    }
  }
  // The SAME path dispatch takes. A greyed menu item can therefore never
  // disagree with the dispatcher about availability.
  return shell_.registry().evaluate(id, shell_.selection(), params).ok();
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
    note("pending: " + forge::ui::sequenceText(shell_.pendingSequence()) + " ...");
    return false;
  }
  if (outcome.resolve == forge::ui::ResolveStatus::Unbound) return false;
  if (outcome.commandId == "app.command_palette") togglePalette();
  note(stroke.toText() + "  ->  " + outcome.commandId + "  " +
       (outcome.dispatch.ok() ? "ok" : forge::ui::toString(outcome.dispatch.status)));
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
      note("selection cleared");
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
    note("selection filter rejects a Face");
    return;
  }
  if (additive) {
    shell_.selection().toggle(ref);
  } else {
    shell_.selection().replaceWith({ref});
  }
  shell_.selection().setFocus(ref);
  syncSelectionToScene();
  note("selected face " + std::to_string(faceId) + "  (" +
       std::to_string(shell_.selection().count()) + " picked)");
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
  const std::size_t tris = scene_.triangleCount();
  if (edgesBuilt_ && edgeTriangles_ == tris) return edges_;
  edges_ = forge::ui::deriveEdges(measureMesh());
  edgeTriangles_ = tris;
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
    note("selection filter rejects an Edge");
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
  note("selected " + ref.persistentName + "  (" +
       std::to_string(shell_.selection().count()) + " picked)");
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
      pendingRatio_ = ratio;
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
  }
}

// ── the frame ───────────────────────────────────────────────────────────────
void ForgeFrame::build(std::uint64_t viewportTexture, float dpiScale) {
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
  viewportRequest_ = ViewportRequest{};
  viewportRequest_.wireframe = shell_.document().wireframe;
  viewportRequest_.geometryDirty = geometryDirty_;
  geometryDirty_ = false;

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

  const ImGuiIO& io = ImGui::GetIO();
  const float W = io.DisplaySize.x;
  const float H = io.DisplaySize.y;

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

  // ── the deferred dock mutations ──────────────────────────────────────────
  // The walk is over and no DockNode reference is live, so it is now safe to
  // re-seat the layout. Doing either of these INSIDE the walk is what crashed
  // the shipped app on the first tab click: setActiveTabAt() ends in
  // `shell_.layout() = std::move(rebuilt)`, which frees the node drawTabGroup
  // was holding, and the next statement read node.panels[active] out of it.
  // drawSplitter() had the identical hazard on a drag -- drawNode() reads
  // node.children[1] on the line AFTER the splitter is drawn.
  if (pendingTabValid_) {
    pendingTabValid_ = false;
    setActiveTabAt(pendingTabPath_, pendingTabIndex_);
  }
  if (pendingRatioValid_) {
    pendingRatioValid_ = false;
    setRatioAt(pendingRatioPath_, pendingRatio_);
  }
}

void ForgeFrame::drawMenuBar() {
  if (!ImGui::BeginMainMenuBar()) return;

  // Menus are BUILT FROM THE REGISTRY. There is no hand-written menu table: a
  // command that exists is offered, and the enabled state is the dispatcher's
  // own answer. Categories are the registry's, in its deterministic order.
  const std::vector<std::string> cats = shell_.registry().categories();
  const std::vector<std::string> wsCats = forge::ui::workspaceCategories(shell_.workspace());
  for (const std::string& cat : cats) {
    // The workspace's ribbon categories first-class; others still reachable.
    if (!ImGui::BeginMenu(cat.c_str())) continue;
    for (const std::string& id : shell_.registry().idsInCategory(cat)) {
      const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
      if (d == nullptr) continue;
      const std::string sc = shortcutText(id);
      if (ImGui::MenuItem(d->label.c_str(), sc.empty() ? nullptr : sc.c_str(), false,
                          commandEnabled(id))) {
        invoke(id);
      }
      if (ImGui::IsItemHovered(ImGuiHoveredFlags_DelayNormal)) {
        ImGui::SetTooltip("%s\nid: %s\nneeds: %s\nIR: %s", d->label.c_str(), d->id.c_str(),
                          d->signature.describe().c_str(),
                          d->featureIrOp.empty() ? "(ui only)" : d->featureIrOp.c_str());
      }
    }
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Window")) {
    if (ImGui::MenuItem("Reset Workspace Layout")) {
      shell_.resetWorkspaceLayout();
      note("workspace layout reset to the deterministic default");
    }
    ImGui::Separator();
    for (forge::ui::WorkspaceProfile p : forge::ui::allWorkspaceProfiles()) {
      if (ImGui::MenuItem(forge::ui::toString(p), nullptr, p == shell_.workspace())) {
        shell_.setWorkspace(p);
        note(std::string("workspace -> ") + forge::ui::toString(p));
      }
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Quit")) quit_ = true;
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Input Profile")) {
    for (forge::ui::InputProfile p : forge::ui::allInputProfiles()) {
      if (ImGui::MenuItem(forge::ui::toString(p), nullptr, p == shell_.inputProfile())) {
        shell_.setInputProfile(p);
        note(std::string("input profile -> ") + forge::ui::toString(p) + "  |  " +
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
      char label[64];
      const char* n = forge::ui::toString(p);
      std::snprintf(label, sizeof(label), "%c%s", static_cast<char>(std::toupper(n[0])), n + 1);
      if (ImGui::Button(label)) {
        shell_.setWorkspace(p);
        note(std::string("workspace -> ") + n);
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
    // The ribbon: the commands whose CATEGORY this workspace claims. Same
    // registry, same enabled predicate as the menu — one command, one truth.
    //
    // ribbonCategories(), not workspaceCategories(): the hand-written claim list
    // made TOTAL over the categories the registry actually holds. It claimed no
    // "Part", so 21 of 34 commands — every geometry-building one — rendered on
    // no ribbon in any workspace while the menu bar showed all 34.
    const std::vector<std::string> cats =
        forge::ui::ribbonCategories(shell_.workspace(), shell_.registry().categories());
    bool first = true;
    for (const std::string& cat : cats) {
      for (const std::string& id : shell_.registry().idsInCategory(cat)) {
        const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
        if (d == nullptr) continue;
        if (!first) ImGui::SameLine();
        first = false;
        const bool on = commandEnabled(id);
        ImGui::BeginDisabled(!on);
        if (ImGui::Button(d->label.c_str())) invoke(id);
        ImGui::EndDisabled();
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
          const std::string sc = shortcutText(id);
          ImGui::SetTooltip("%s   %s\n%s\nrequires: %s", d->label.c_str(), sc.c_str(),
                            on ? "available" : "unavailable with the current selection",
                            d->signature.describe().c_str());
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
          note(std::string("selection filter -> ") + forge::ui::toString(k));
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

    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    ImGui::Text("sel %zu", shell_.selection().count());
    ImGui::SameLine();
    if (shell_.selection().focus().has_value()) {
      ImGui::TextColored(rgb(242, 158, 38), "focus %s",
                         shell_.selection().focus()->persistentName.c_str());
    } else {
      ImGui::TextDisabled("focus  -");
    }
    ImGui::SameLine();
    if (shell_.selection().preselection().has_value()) {
      ImGui::TextColored(rgb(90, 184, 242), "hover %s",
                         shell_.selection().preselection()->persistentName.c_str());
    } else {
      ImGui::TextDisabled("hover -");
    }

    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    ImGui::Text("%s", navHintFor(shell_.inputProfile()));

    ImGui::SameLine();
    ImGui::TextColored(rgb(120, 126, 137), "|");
    ImGui::SameLine();
    ImGui::Text("features %zu  undo %zu  redo %zu%s", shell_.document().features,
                shell_.document().undoDepth, shell_.document().redoDepth,
                shell_.document().dirty ? "  *" : "");

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
    std::string shown = status_;
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
    ImGui::TextColored(rgb(170, 176, 186), "%s", shown.c_str());
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
        pendingRatio_ = ratio + static_cast<double>(delta) / parentExtent;
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
  }
  ImGui::End();
  ImGui::PopStyleVar();
}

void ForgeFrame::drawPanel(const std::string& panelId, std::uint64_t viewportTexture) {
  ++panelsDrawn_;
  panelIdsDrawn_.push_back(panelId);
  if (isViewportPanel(panelId)) {
    drawViewportPanel(viewportTexture);
  } else if (panelId == "feature_tree" || panelId == "model_browser" ||
             panelId == "sketch_tree" || panelId == "assembly_tree" ||
             panelId == "operation_tree" || panelId == "study_tree" ||
             panelId == "sheet_tree") {
    drawFeatureTreePanel();
  } else if (panelId == "properties" || panelId == "operation_params") {
    drawPropertiesPanel();
  } else if (panelId == "console" || panelId == "archie_trace" || panelId == "solver_log" ||
             panelId == "simulation_log") {
    drawConsolePanel();
  } else if (panelId == "timeline") {
    drawTimelinePanel();
  } else if (panelId == "measure") {
    drawMeasurePanel();
  } else if (panelId == "archie_tools") {
    drawToolsPanel();
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
  const float bw = 34.0f * dpiScale_;
  const float bh = 22.0f * dpiScale_;
  ImGui::SetCursorScreenPos(ImVec2(x + w - (bw + 4) * 4 - 8, y + 8));
  struct { const char* name; void (Camera::*fn)() noexcept; } views[] = {
      {"Iso", &Camera::setIsometric}, {"Fr", &Camera::setFront},
      {"Tp", &Camera::setTop},        {"Rt", &Camera::setRight}};
  for (int i = 0; i < 4; ++i) {
    if (i > 0) ImGui::SameLine();
    if (ImGui::Button(views[i].name, ImVec2(bw, bh))) {
      (camera_.*views[i].fn)();
      note(std::string("view -> ") + views[i].name);
    }
  }
  if (!scene_.built()) {
    dl->AddText(ImVec2(x + 14, y + h * 0.5f), ImGui::GetColorU32(rgb(235, 105, 95)),
                scene_.error().c_str());
  }
}

void ForgeFrame::drawContextMenu() {
  if (!ImGui::BeginPopupContextItem("##viewport_ctx", ImGuiPopupFlags_MouseButtonRight)) return;
  // The context menu is the registry filtered by what the LIVE selection
  // satisfies. Same source as the menu bar, the toolbar and the palette.
  ImGui::TextDisabled("Selection: %zu", shell_.selection().count());
  ImGui::Separator();
  std::size_t offered = 0;
  for (const std::string& id : shell_.registry().ids()) {
    const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
    if (d == nullptr) continue;
    if (d->signature.kind == forge::ui::EntityKind::None) continue;  // needs no selection
    if (!commandEnabled(id)) continue;
    if (ImGui::MenuItem(d->label.c_str(), shortcutText(id).c_str())) invoke(id);
    ++offered;
  }
  if (offered == 0) ImGui::TextDisabled("(nothing applies to this selection)");
  ImGui::Separator();
  if (ImGui::MenuItem("Clear Selection")) {
    shell_.selection().clearSelection();
    syncSelectionToScene();
  }
  ImGui::EndPopup();
}

// ── feature tree ────────────────────────────────────────────────────────────
void ForgeFrame::drawFeatureTreePanel() {
  ImGui::TextColored(rgb(130, 137, 148),
                     "%zu rows | resident %zu/%zu | peak %zu | fetch %zu",
                     tree_.rowCount(), tree_.materialized(), tree_.cacheCapacity(),
                     tree_.peakMaterialized(), treeSource_.fetches());
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
          if (ImGui::SmallButton(row.expanded ? "-" : "+")) {
            tree_.setExpanded(row.id, !row.expanded);
            tree_.rebuild();
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
        if (ImGui::Selectable(d.label.c_str(), selected, ImGuiSelectableFlags_AllowOverlap)) {
          if (faceId != 0) {
            clickFace(faceId, ImGui::GetIO().KeyShift);
          } else if (featureIrId != 0) {
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
            ImGui::SetTooltip("%s\n%s", rec->line.text().c_str(),
                              rec->commandId.empty() ? "(starting part)" : rec->commandId.c_str());
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

void ForgeFrame::drawPropertiesPanel() {
  ImGui::TextColored(rgb(242, 158, 38), "Document");
  ImGui::Separator();
  ImGui::Text("features   %zu", shell_.document().features);
  ImGui::Text("undo/redo  %zu / %zu", shell_.document().undoDepth, shell_.document().redoDepth);
  ImGui::Text("modified   %s", shell_.document().dirty ? "yes" : "no");
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
    ImGui::TextDisabled("(the document has no statements)");
  } else {
    // Re-resolve every frame: undo, redo, New and Open all move records, and a
    // target cached across one of those would edit the wrong statement.
    if (partDoc_.featureAt(editFeatureId_) == nullptr) setEditTarget(0, 0);
    const forge::ui::FeatureRecord* rec = partDoc_.featureAt(editFeatureId_);
    ImGui::SetNextItemWidth(-1);
    if (ImGui::BeginCombo("##editfeature",
                          rec == nullptr ? "(none)" : rec->line.text().c_str())) {
      for (const forge::ui::FeatureRecord& r2 : partDoc_.records()) {
        const bool isSel = r2.irId == editFeatureId_;
        if (ImGui::Selectable(r2.line.text().c_str(), isSel)) setEditTarget(r2.irId, 0);
        if (isSel) ImGui::SetItemDefaultFocus();
      }
      ImGui::EndCombo();
    }
    const std::size_t numbers = editParamCount();
    if (numbers == 0) {
      // CUT(%2, %3) has no number in it. Saying so is the honest answer; a
      // disabled field with a 0 in it would read as "this feature is 0 mm".
      ImGui::TextDisabled("%s takes no numeric parameter",
                          rec == nullptr ? "this statement" : rec->line.op.c_str());
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
      ImGui::BulletText("%s  %s", forge::ui::toString(r.kind), r.persistentName.c_str());
    }
    if (ImGui::Button("Commit snapshot")) {
      shell_.selection().commit();
      note("committed " + std::to_string(shell_.selection().committed().size()) + " refs");
    }
    ImGui::SameLine();
    if (ImGui::Button("Focus next")) shell_.selection().advanceFocus(1);
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Rebuild");
  ImGui::Separator();
  const IrBuildReport& r = scene_.lastBuild();
  ImGui::Text("rebuilds   %zu", rebuilds_);
  ImGui::Text("ops        %zu declared / %zu parsed / %zu compiled", r.nDeclared, r.nParsed,
              r.nCompiled);
  if (r.ok()) {
    ImGui::TextColored(r.valid ? rgb(120, 200, 130) : rgb(235, 175, 95), "%s",
                       r.valid ? "solid is valid" : "solid compiled but is NOT valid");
    ImGui::Text("faces %ld   edges %ld", r.faceCount, r.edgeCount);
    ImGui::Text("volume %.3f mm3", r.volume);
    ImGui::Text("bbox   %.2f x %.2f x %.2f", r.bboxMax[0] - r.bboxMin[0],
                r.bboxMax[1] - r.bboxMin[1], r.bboxMax[2] - r.bboxMin[2]);
  } else {
    ImGui::TextColored(rgb(235, 105, 95), "REBUILD FAILED");
    ImGui::TextWrapped("%s", r.error.c_str());
    ImGui::TextDisabled("the viewport is showing the last body that built");
  }

  ImGui::Spacing();
  ImGui::TextColored(rgb(242, 158, 38), "Feature IR");
  ImGui::Separator();
  ImGui::TextDisabled("%s%s", documentPath_.empty() ? "(unsaved)" : documentPath_.c_str(),
                      documentDirty_ ? "  *" : "");
  const std::string ir = partDoc_.irProgram();
  ImGui::TextWrapped("%s", ir.empty() ? "(no statements yet)" : ir.c_str());
}

void ForgeFrame::drawConsolePanel() {
  ImGui::TextColored(rgb(130, 137, 148), "dispatch journal (%zu) + shell log",
                     shell_.journal().size());
  ImGui::Separator();
  if (ImGui::BeginChild("##log", ImGui::GetContentRegionAvail(), ImGuiChildFlags_None)) {
    for (const std::string& l : log_) ImGui::TextUnformatted(l.c_str());
    for (const std::string& j : shell_.journal()) {
      ImGui::TextColored(rgb(120, 200, 130), "dispatched  %s", j.c_str());
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
  ImGui::TextColored(rgb(130, 137, 148), "feature history: %zu statements", records.size());
  ImGui::Separator();
  for (std::size_t i = 0; i < records.size(); ++i) {
    const forge::ui::FeatureRecord& rec = records[i];
    const bool named = (r.failedOpId == rec.irId) || (r.failedLine == rec.irId);
    const bool ok = r.ok() || !named;
    ImGui::PushID(static_cast<int>(i));
    ImGui::TextColored(ok ? rgb(120, 200, 130) : rgb(235, 105, 95), "%s", ok ? "OK " : "ERR");
    ImGui::SameLine();
    ImGui::Text("%%%-3d %-22s %-18s %s", rec.irId,
                (rec.label.empty() ? rec.line.op : rec.label).c_str(),
                rec.commandId.empty() ? "seed" : rec.commandId.c_str(), rec.line.text().c_str());
    ImGui::PopID();
  }
}

// ── measure ─────────────────────────────────────────────────────────────────
// Everything here is arithmetic done by forge::ui::MeasureModel over the SAME
// triangles the viewport draws and the SAME face ids picking resolves to. The
// panel prints; it does not compute, which is why the numbers are gated headless.
const forge::ui::MeasureMesh& ForgeFrame::measureMesh() {
  const std::size_t tris = scene_.triangleCount();
  if (measureBuilt_ && measureTriangles_ == tris) return measureMesh_;

  measureMesh_.clear();
  const std::vector<SceneVertex>& v = scene_.vertices();
  for (std::size_t i = 0; i + 2 < v.size(); i += 3) {
    const double a[3] = {v[i].px, v[i].py, v[i].pz};
    const double b[3] = {v[i + 1].px, v[i + 1].py, v[i + 1].pz};
    const double c[3] = {v[i + 2].px, v[i + 2].py, v[i + 2].pz};
    measureMesh_.addTriangle(a, b, c, v[i].faceId);
  }
  meshMeasure_ = forge::ui::measureMesh(measureMesh_);
  measureTriangles_ = tris;
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
    ImGui::TextColored(rgb(235, 105, 95), "no tessellation to measure");
    ImGui::TextWrapped("%s", scene_.error().empty() ? "(the scene is empty)"
                                                    : scene_.error().c_str());
    return;
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
      ImGui::BulletText("%s   %.4f mm   %zu seg%s", e.key().c_str(), e.length, e.segments,
                        e.closed ? "   closed" : "");
      ImGui::Text("     between faces %u and %u", e.faceA, e.faceB);
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
      ImGui::TextDisabled("  %s   ir=%s   undo=%s", e.id.c_str(), e.featureIrOp.c_str(),
                          e.undo.c_str());
      ImGui::TextDisabled("  needs %s", e.selection.c_str());
      if (e.parameters != "-") ImGui::TextDisabled("  args  %s", e.parameters.c_str());
      if (!e.reason.empty()) {
        ImGui::TextColored(rgb(230, 190, 90), "  %s", e.reason.c_str());
      }
      ImGui::PopID();
      ++toolRowsDrawn_;
    }
  }
  ImGui::EndChild();
}

void ForgeFrame::drawGenericPanel(const std::string& panelId) {
  ImGui::TextColored(rgb(242, 158, 38), "%s", prettyPanelName(panelId));
  ImGui::Separator();
  // Honest: this panel is a docked surface with no content yet. It says so, and
  // it still offers the commands its workspace owns, so it is not a dead tab.
  ImGui::TextWrapped(
      "Panel \"%s\" is docked and laid out by forge::ui::DockLayout, and its position, "
      "tab order and active tab persist across restart. Its content is not implemented "
      "in this segment.",
      panelId.c_str());
  ImGui::Spacing();
  ImGui::TextColored(rgb(130, 137, 148), "Commands this workspace owns:");
  for (const std::string& cat :
       forge::ui::ribbonCategories(shell_.workspace(), shell_.registry().categories())) {
    for (const std::string& id : shell_.registry().idsInCategory(cat)) {
      const forge::ui::CommandDescriptor* d = shell_.registry().find(id);
      if (d == nullptr) continue;
      ImGui::BulletText("%s  (%s)", d->label.c_str(), d->id.c_str());
    }
  }
}

// ── command palette ─────────────────────────────────────────────────────────
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

    // The registry's OWN ranked search — not a second matcher. Whatever the
    // palette can find, a macro and an Archie tool call can find by the same ID.
    const std::vector<std::string> hits = shell_.registry().search(paletteQuery_, 14);
    if (hits.empty()) {
      ImGui::TextDisabled("no command matches");
    } else {
      paletteIndex_ = std::clamp(paletteIndex_, 0, static_cast<int>(hits.size()) - 1);
      if (ImGui::IsKeyPressed(ImGuiKey_DownArrow)) ++paletteIndex_;
      if (ImGui::IsKeyPressed(ImGuiKey_UpArrow)) --paletteIndex_;
      paletteIndex_ = std::clamp(paletteIndex_, 0, static_cast<int>(hits.size()) - 1);
    }
    ImGui::Separator();
    for (std::size_t i = 0; i < hits.size(); ++i) {
      const forge::ui::CommandDescriptor* d = shell_.registry().find(hits[i]);
      if (d == nullptr) continue;
      const bool on = commandEnabled(hits[i]);
      const bool cursor = (static_cast<int>(i) == paletteIndex_);
      ImGui::PushID(static_cast<int>(i));
      ImGui::BeginDisabled(!on);
      if (ImGui::Selectable(d->label.c_str(), cursor) ||
          (cursor && ImGui::IsKeyPressed(ImGuiKey_Enter))) {
        invoke(hits[i]);
        paletteOpen_ = false;
      }
      ImGui::EndDisabled();
      ImGui::SameLine(ImGui::GetContentRegionAvail().x * 0.55f);
      ImGui::TextDisabled("%s", d->id.c_str());
      ImGui::SameLine(ImGui::GetContentRegionAvail().x * 0.85f);
      ImGui::TextColored(on ? rgb(120, 200, 130) : rgb(140, 140, 150), "%s",
                         on ? shortcutText(hits[i]).c_str() : "unavailable");
      ImGui::PopID();
    }
    if (ImGui::IsKeyPressed(ImGuiKey_Escape)) paletteOpen_ = false;
  }
  ImGui::End();
  ImGui::PopStyleVar();
  if (!paletteOpen_) paletteFocus_ = false;
}

}  // namespace forge::desktop
