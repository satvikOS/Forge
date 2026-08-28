// ui/include/forge/ui/DockLayout.hpp
//
// Saveable dockable workspaces with deterministic default layouts and
// MULTI-MONITOR RECOVERY (Sacrosanct s19.2). This is the one capability
// KDDockWidgets would have supplied for free on the Qt path; D-001 chose Dear
// ImGui, so it is ours to build — and it is a first-class deliverable, not a
// library call.
//
// The model is an explicit tree, independent of any ImGui internal state:
//   DockLayout  = an ordered set of DockWindows (one main + N floating/torn-off)
//   DockWindow  = a monitor assignment, a rect, and a root DockNode
//   DockNode    = a Split (axis + ratio + children) or Tabs (panel IDs + active)
//
// Two properties are enforced by tests:
//   1. serialize -> parse -> serialize is byte-identical, and the parsed layout
//      compares equal to the original (a saved workspace really comes back);
//   2. reconcileMonitors() RECOVERS: when a monitor disappears — the docking
//      station is unplugged, the projector is unhooked — every window it held is
//      moved onto a surviving monitor and clamped into its work area, and NOT
//      ONE PANEL IS LOST. A layout stranded off-screen is indistinguishable from
//      a deleted layout to the user, so this is a data-loss bug, not cosmetics.
#ifndef FORGE_UI_DOCKLAYOUT_HPP
#define FORGE_UI_DOCKLAYOUT_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/Types.hpp"

namespace forge::ui {

using PanelId = std::string;

enum class DockNodeKind : std::uint8_t { Split, Tabs };
enum class SplitAxis : std::uint8_t { Horizontal, Vertical };

struct DockNode {
  DockNodeKind kind = DockNodeKind::Tabs;
  SplitAxis axis = SplitAxis::Horizontal;  // meaningful when kind == Split
  double ratio = 0.5;                      // first child's share, (0,1)
  std::vector<DockNode> children;          // exactly 2 when kind == Split
  std::vector<PanelId> panels;             // meaningful when kind == Tabs
  std::size_t activeTab = 0;

  static DockNode tabs(std::vector<PanelId> ids, std::size_t active = 0);
  static DockNode split(SplitAxis axis, double ratio, DockNode first, DockNode second);

  void collectPanels(std::vector<PanelId>& out) const;
  bool valid() const;
};

bool operator==(const DockNode& a, const DockNode& b);

struct DockWindow {
  std::int32_t id = 0;
  MonitorId monitor = kNoMonitor;
  Rect rect{};
  bool main = false;  // the main window is never destroyed by recovery
  DockNode root{};
};

bool operator==(const DockWindow& a, const DockWindow& b);

// What recovery actually did — returned so the shell can tell the user, and so a
// test can assert on it rather than on "it did not throw".
struct RecoveryReport {
  std::size_t windowsMoved = 0;    // were on a monitor that no longer exists
  std::size_t windowsClamped = 0;  // monitor survived but its work area shrank
  std::size_t panelsBefore = 0;
  std::size_t panelsAfter = 0;
  bool panelsPreserved() const noexcept { return panelsBefore == panelsAfter; }
};

class DockLayout {
 public:
  void addWindow(DockWindow window);
  const std::vector<DockWindow>& windows() const noexcept { return windows_; }
  std::size_t windowCount() const noexcept { return windows_.size(); }
  const DockWindow* mainWindow() const noexcept;

  // Every panel in every window, sorted — deterministic, order-independent.
  std::vector<PanelId> panels() const;
  bool hasPanel(const PanelId& id) const;
  std::size_t panelCount() const;

  bool valid() const;

  // Multi-monitor recovery. `available` must be non-empty; the primary (or, if
  // none is flagged, the lowest ID) is the fallback surface.
  RecoveryReport reconcileMonitors(const std::vector<MonitorInfo>& available);

  std::string serialize() const;
  static bool parse(const std::string& text, DockLayout& out);

 private:
  std::vector<DockWindow> windows_;
};

bool operator==(const DockLayout& a, const DockLayout& b);

}  // namespace forge::ui

#endif  // FORGE_UI_DOCKLAYOUT_HPP
