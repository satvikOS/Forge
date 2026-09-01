#include "forge/ui/PanelFocus.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/DockLayout.hpp"

namespace forge::ui {
namespace {

struct NameRow {
  const char* id;
  const char* name;
};

// Every panel the eight default layouts define. Curated because a derived name
// is right for "feature_tree" and wrong for "gdt" (Geometric Dimensioning and
// Tolerancing) and "bom" (Bill of Materials) — an accessible name that expands
// no acronym is not an accessible name.
constexpr NameRow kCuratedNames[] = {
    {"annotation", "Annotation"},
    {"appearance", "Appearance"},
    {"archie_chat", "Archie Chat"},
    {"archie_plan", "Archie Plan"},
    {"archie_tools", "Archie Tools"},
    {"archie_trace", "Archie Trace"},
    {"assembly_tree", "Assembly Tree"},
    {"bom", "Bill of Materials"},
    {"component_filter", "Component Filter"},
    {"console", "Console"},
    {"constraints", "Sketch Constraints"},
    {"continuity", "Surface Continuity"},
    {"contacts", "Contacts"},
    {"convergence", "Solver Convergence"},
    {"curve_list", "Curve List"},
    {"dimensions", "Dimensions"},
    {"feature_tree", "Feature Tree"},
    {"fixtures", "Fixtures"},
    {"gdt", "Geometric Dimensioning and Tolerancing"},
    {"interference", "Interference Check"},
    {"isocline", "Isocline Analysis"},
    {"loads", "Loads"},
    {"materials", "Materials"},
    {"mates", "Mates"},
    {"measure", "Measure"},
    {"model_browser", "Model Browser"},
    {"operation_params", "Operation Parameters"},
    {"operation_tree", "Operation Tree"},
    {"post_output", "Post-processor Output"},
    {"properties", "Properties"},
    {"relations", "Sketch Relations"},
    {"restraints", "Restraints"},
    {"sheet_canvas", "Sheet Canvas"},
    {"sheet_tree", "Sheet Tree"},
    {"simulation_log", "Simulation Log"},
    {"sketch_tree", "Sketch Tree"},
    {"solver_log", "Solver Log"},
    {"solver_status", "Solver Status"},
    {"stock", "Stock"},
    {"study_tree", "Study Tree"},
    {"timeline", "Timeline"},
    {"title_block", "Title Block"},
    {"tool_library", "Tool Library"},
    {"verify_report", "Verify Report"},
    {"view_list", "View List"},
    {"viewport_3d", "3D Viewport"},
    {"viewport_results", "Results Viewport"},
    {"viewport_sketch", "Sketch Viewport"},
    {"viewport_toolpath", "Toolpath Viewport"},
    {"zebra_analysis", "Zebra Analysis"},
};

const NameRow* findCurated(const PanelId& id) {
  for (const NameRow& row : kCuratedNames) {
    if (id == row.id) return &row;
  }
  return nullptr;
}

// "zebra_analysis" -> "Zebra Analysis". Underscores and hyphens become spaces,
// each word is capitalised, runs of separators collapse.
std::string titleCase(const std::string& id) {
  std::string out;
  bool startOfWord = true;
  for (char c : id) {
    if (c == '_' || c == '-' || c == '.' || c == ' ') {
      if (!out.empty() && out.back() != ' ') out += ' ';
      startOfWord = true;
      continue;
    }
    const unsigned char u = static_cast<unsigned char>(c);
    out += startOfWord ? static_cast<char>(std::toupper(u)) : c;
    startOfWord = false;
  }
  while (!out.empty() && out.back() == ' ') out.pop_back();
  return out;
}

void collect(const DockNode& node, std::size_t windowIndex, std::vector<std::size_t>& path,
             std::vector<FocusStop>& out) {
  if (node.kind == DockNodeKind::Tabs) {
    for (std::size_t i = 0; i < node.panels.size(); ++i) {
      FocusStop stop;
      stop.panelId = node.panels[i];
      stop.displayName = panelDisplayName(stop.panelId);
      stop.windowIndex = windowIndex;
      stop.path = path;
      stop.tabIndex = i;
      stop.visible = (i == node.activeTab);
      out.push_back(std::move(stop));
    }
    return;
  }
  for (std::size_t i = 0; i < node.children.size(); ++i) {
    path.push_back(i);
    collect(node.children[i], windowIndex, path, out);
    path.pop_back();
  }
}

}  // namespace

std::string panelDisplayName(const PanelId& id) {
  const NameRow* row = findCurated(id);
  if (row != nullptr) return row->name;
  const std::string derived = titleCase(id);
  // A panel whose ID is empty or all separators still needs SOMETHING a user can
  // read; an unnamed row in a focus list is indistinguishable from a broken one.
  return derived.empty() ? std::string("Unnamed Panel") : derived;
}

bool hasCuratedPanelName(const PanelId& id) { return findCurated(id) != nullptr; }

std::vector<FocusStop> focusStops(const DockLayout& layout) {
  std::vector<FocusStop> out;
  // The main window first, whatever its index: a keyboard cycle that starts in a
  // torn-off palette is disorienting, and DockLayout does not promise the main
  // window is windows()[0].
  std::vector<std::size_t> order;
  const std::vector<DockWindow>& windows = layout.windows();
  for (std::size_t i = 0; i < windows.size(); ++i) {
    if (windows[i].main) order.push_back(i);
  }
  for (std::size_t i = 0; i < windows.size(); ++i) {
    if (!windows[i].main) order.push_back(i);
  }
  for (std::size_t index : order) {
    std::vector<std::size_t> path;
    collect(windows[index].root, index, path, out);
  }
  return out;
}

// ── FocusRing ───────────────────────────────────────────────────────────────
void FocusRing::rebuild(const DockLayout& layout) {
  const std::vector<FocusStop> all = focusStops(layout);
  stops_.clear();
  hidden_ = 0;
  for (const FocusStop& s : all) {
    if (s.visible) {
      stops_.push_back(s);
    } else {
      ++hidden_;
    }
  }
  if (stops_.empty()) {
    focused_.clear();
    return;
  }
  // Keep the focus if the panel survived the rebuild.
  for (const FocusStop& s : stops_) {
    if (s.panelId == focused_) return;
  }
  focused_ = stops_.front().panelId;
}

const FocusStop* FocusRing::focusedStop() const noexcept {
  for (const FocusStop& s : stops_) {
    if (s.panelId == focused_) return &s;
  }
  return nullptr;
}

bool FocusRing::focus(const PanelId& panelId) {
  for (const FocusStop& s : stops_) {
    if (s.panelId != panelId) continue;
    if (focused_ != panelId) {
      focused_ = panelId;
      ++moves_;
    }
    return true;
  }
  return false;
}

const std::string& FocusRing::next() {
  if (stops_.empty()) return focused_;
  std::size_t at = 0;
  for (std::size_t i = 0; i < stops_.size(); ++i) {
    if (stops_[i].panelId == focused_) {
      at = i;
      break;
    }
  }
  focused_ = stops_[(at + 1) % stops_.size()].panelId;
  ++moves_;
  return focused_;
}

const std::string& FocusRing::previous() {
  if (stops_.empty()) return focused_;
  std::size_t at = 0;
  for (std::size_t i = 0; i < stops_.size(); ++i) {
    if (stops_[i].panelId == focused_) {
      at = i;
      break;
    }
  }
  focused_ = stops_[(at + stops_.size() - 1) % stops_.size()].panelId;
  ++moves_;
  return focused_;
}

}  // namespace forge::ui
