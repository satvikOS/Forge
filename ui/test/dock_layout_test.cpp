// ui/test/dock_layout_test.cpp
//
// CONTRACT 4 — a dock layout round-trips through serialization and RECOVERS when
// a monitor disappears.
//
// The recovery half is the one KDDockWidgets would have supplied on the Qt path;
// D-001 chose Dear ImGui, so it is ours. The failure it prevents is not
// cosmetic: a window left on a monitor that no longer exists is unreachable, and
// an unreachable panel and a deleted panel are the same thing to the user. The
// test therefore asserts on PANEL PRESERVATION and on rects landing inside a
// live work area, not on "reconcile did not throw".
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/DockLayout.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// A three-monitor workstation: the laptop panel plus two externals.
std::vector<MonitorInfo> threeMonitors() {
  return {
      MonitorInfo{1, Rect{0.0, 0.0, 2560.0, 1440.0}, true, 2.0},
      MonitorInfo{2, Rect{2560.0, 0.0, 1920.0, 1080.0}, false, 1.0},
      MonitorInfo{3, Rect{4480.0, 0.0, 1920.0, 1080.0}, false, 1.0},
  };
}

DockLayout threeScreenLayout() {
  DockLayout layout = defaultLayout(WorkspaceProfile::Part);  // main window on monitor 1

  DockWindow torn;
  torn.id = 2;
  torn.monitor = 2;
  torn.rect = Rect{2600.0, 40.0, 800.0, 900.0};
  torn.root = DockNode::split(SplitAxis::Vertical, 0.6, DockNode::tabs({"archie_chat"}, 0),
                              DockNode::tabs({"archie_trace", "verify_report"}, 1));
  layout.addWindow(std::move(torn));

  DockWindow drawing;
  drawing.id = 3;
  drawing.monitor = 3;
  drawing.rect = Rect{4500.0, 100.0, 1200.0, 800.0};
  drawing.root = DockNode::tabs({"sheet_canvas", "title_block"}, 0);
  layout.addWindow(std::move(drawing));
  return layout;
}

bool allWindowsInside(const DockLayout& layout, const std::vector<MonitorInfo>& monitors) {
  for (const DockWindow& w : layout.windows()) {
    bool ok = false;
    for (const MonitorInfo& m : monitors) {
      if (m.id == w.monitor && m.workArea.contains(w.rect)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

}  // namespace

int main() {
  Harness H("dock_layout");

  // ── the shipped defaults are valid and deterministic ────────────────────
  CHECK_EQ_INT(allWorkspaceProfiles().size(), 8);
  for (WorkspaceProfile p : allWorkspaceProfiles()) {
    const DockLayout a = defaultLayout(p);
    const DockLayout b = defaultLayout(p);
    CHECK(a.valid());
    CHECK_EQ_STR(a.serialize(), b.serialize());  // byte-identical every call
    CHECK_EQ_INT(a.windowCount(), 1);
    CHECK_EQ_INT(a.panelCount(), 8);
    CHECK(a.mainWindow() != nullptr);
  }
  CHECK(defaultLayout(WorkspaceProfile::Part).hasPanel("feature_tree"));
  CHECK(defaultLayout(WorkspaceProfile::Archie).hasPanel("archie_chat"));
  CHECK(!defaultLayout(WorkspaceProfile::Part).hasPanel("archie_chat"));

  // ── round trip ──────────────────────────────────────────────────────────
  const DockLayout original = threeScreenLayout();
  CHECK(original.valid());
  CHECK_EQ_INT(original.windowCount(), 3);
  CHECK_EQ_INT(original.panelCount(), 13);

  const std::string text = original.serialize();
  DockLayout reloaded;
  CHECK(DockLayout::parse(text, reloaded));
  CHECK_EQ_STR(reloaded.serialize(), text);  // serialize -> parse -> serialize
  CHECK(reloaded == original);               // and structurally equal
  CHECK_EQ_INT(reloaded.panelCount(), 13);
  CHECK(reloaded.valid());

  // deep structure really survived, not just the panel names
  const DockWindow& torn = reloaded.windows()[1];
  CHECK_EQ_INT(torn.id, 2);
  CHECK_EQ_INT(torn.monitor, 2);
  CHECK_EQ_INT(static_cast<int>(torn.root.kind), static_cast<int>(DockNodeKind::Split));
  CHECK_EQ_INT(static_cast<int>(torn.root.axis), static_cast<int>(SplitAxis::Vertical));
  CHECK_NEAR(torn.root.ratio, 0.6, 1e-9);
  CHECK_EQ_INT(torn.root.children.size(), 2);
  CHECK_EQ_INT(torn.root.children[1].activeTab, 1);  // the active tab is state too
  CHECK_NEAR(torn.rect.w, 800.0, 1e-9);

  // corrupt or foreign state is REFUSED, not half-applied
  DockLayout rejected;
  CHECK(!DockLayout::parse("", rejected));
  CHECK(!DockLayout::parse("forge-dock 2 1\n", rejected));
  CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 1 0 0 100 100 1 Q 0 1 x\n", rejected));
  CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 1 0 0 100 100 1 T 0 3 a b\n", rejected));

  // an invalid layout is reported invalid rather than quietly used
  {
    DockLayout twoMains = threeScreenLayout();
    CHECK(twoMains.valid());
    DockWindow extraMain;
    extraMain.id = 9;
    extraMain.monitor = 1;
    extraMain.main = true;
    extraMain.rect = Rect{0.0, 0.0, 100.0, 100.0};
    extraMain.root = DockNode::tabs({"stray"}, 0);
    twoMains.addWindow(std::move(extraMain));
    CHECK(!twoMains.valid());
  }
  {
    DockLayout duplicated = threeScreenLayout();
    DockWindow dupPanel;
    dupPanel.id = 9;
    dupPanel.monitor = 1;
    dupPanel.rect = Rect{0.0, 0.0, 100.0, 100.0};
    dupPanel.root = DockNode::tabs({"feature_tree"}, 0);  // already docked in the main window
    duplicated.addWindow(std::move(dupPanel));
    CHECK(!duplicated.valid());
  }

  // ── RECOVERY: two monitors are unplugged ────────────────────────────────
  DockLayout live = threeScreenLayout();
  const std::size_t panelsBefore = live.panelCount();
  CHECK(allWindowsInside(live, threeMonitors()));

  const std::vector<MonitorInfo> laptopOnly = {
      MonitorInfo{1, Rect{0.0, 0.0, 2560.0, 1440.0}, true, 2.0}};
  RecoveryReport report = live.reconcileMonitors(laptopOnly);

  CHECK_EQ_INT(report.windowsMoved, 2);      // the two external windows came home
  CHECK_EQ_INT(report.panelsBefore, panelsBefore);
  CHECK_EQ_INT(report.panelsAfter, panelsBefore);
  CHECK(report.panelsPreserved());           // NOT ONE PANEL LOST
  CHECK_EQ_INT(live.panelCount(), panelsBefore);
  CHECK(live.hasPanel("archie_chat"));
  CHECK(live.hasPanel("sheet_canvas"));
  CHECK(live.hasPanel("verify_report"));
  CHECK_EQ_INT(live.windowCount(), 3);
  CHECK(live.valid());

  // every window is now on a monitor that exists, and fully on-screen
  for (const DockWindow& w : live.windows()) {
    CHECK_EQ_INT(w.monitor, 1);
  }
  CHECK(allWindowsInside(live, laptopOnly));

  // and the torn-off windows did NOT land on top of each other
  CHECK(live.windows()[1].rect != live.windows()[2].rect);

  // recovery is IDEMPOTENT: running it again changes nothing
  report = live.reconcileMonitors(laptopOnly);
  CHECK_EQ_INT(report.windowsMoved, 0);
  CHECK_EQ_INT(report.windowsClamped, 0);
  CHECK(report.panelsPreserved());

  // ── RECOVERY: the monitor survives but its work area shrinks ────────────
  DockLayout shrunk = threeScreenLayout();
  const std::vector<MonitorInfo> smaller = {
      MonitorInfo{1, Rect{0.0, 0.0, 1280.0, 800.0}, true, 1.0},
      MonitorInfo{2, Rect{1280.0, 0.0, 800.0, 600.0}, false, 1.0},
      MonitorInfo{3, Rect{2080.0, 0.0, 1920.0, 1080.0}, false, 1.0},
  };
  report = shrunk.reconcileMonitors(smaller);
  CHECK_EQ_INT(report.windowsMoved, 0);   // no monitor vanished
  CHECK_EQ_INT(report.windowsClamped, 3); // all three had to be pulled back in
  CHECK(report.panelsPreserved());
  CHECK(allWindowsInside(shrunk, smaller));
  CHECK_NEAR(shrunk.windows()[1].rect.w, 800.0, 1e-9);   // clamped to the work area width
  CHECK_NEAR(shrunk.windows()[1].rect.h, 600.0, 1e-9);

  // ── an empty monitor list must not destroy the layout ───────────────────
  DockLayout blind = threeScreenLayout();
  report = blind.reconcileMonitors({});
  CHECK_EQ_INT(report.windowsMoved, 0);
  CHECK(report.panelsPreserved());
  CHECK(blind == threeScreenLayout());  // untouched, not emptied

  // ── recovered state still round-trips ───────────────────────────────────
  const std::string recoveredText = live.serialize();
  DockLayout recoveredBack;
  CHECK(DockLayout::parse(recoveredText, recoveredBack));
  CHECK(recoveredBack == live);

  // ── REGRESSION: a TRUNCATED layout must not load as success ─────────────
  // The header declares how many windows follow. parse() read that number and
  // never compared it to what it actually built, so a file cut short — a disk
  // full mid-write, a truncated sync — came back as a smaller layout reported
  // as a clean load, and the missing windows' panels were silently gone.
  {
    DockLayout truncated;
    CHECK(!DockLayout::parse("forge-dock 1 3\nw 1 1 0 0 100 100 1 T 0 1 a\n", truncated));
    CHECK(!DockLayout::parse(
        "forge-dock 1 1\nw 1 1 0 0 100 100 1 T 0 1 a\nw 2 1 0 0 100 100 0 T 0 1 b\n",
        truncated));
    // the honest count still loads
    DockLayout whole;
    CHECK(DockLayout::parse(
        "forge-dock 1 2\nw 1 1 0 0 100 100 1 T 0 1 a\nw 2 1 0 0 100 100 0 T 0 1 b\n", whole));
    CHECK_EQ_INT(whole.windowCount(), 2);
    // and every layout this code writes declares its own count truthfully
    const std::string wholeText = whole.serialize();
    CHECK_EQ_STR(wholeText.substr(0, wholeText.find('\n')), "forge-dock 1 2");
  }

  // ── REGRESSION: parse() must validate before reporting success ──────────
  // activeTab == 5 over a one-element tab vector is an out-of-range index that
  // the ImGui frame builder would index with. valid() catches it; parse() never
  // asked, so it returned true on a layout whose mainWindow() was nullptr.
  {
    DockLayout bad;
    CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 1 0 0 100 100 1 T 5 1 a\n", bad));
    CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 1 0 0 100 100 0 T 0 1 a\n", bad));  // no main
    CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 1 0 0 0 0 1 T 0 1 a\n", bad));      // empty rect
    CHECK(!DockLayout::parse(
        "forge-dock 1 2\nw 1 1 0 0 100 100 1 T 0 1 a\nw 1 1 0 0 100 100 0 T 0 1 b\n",
        bad));  // duplicate window id
    CHECK(!DockLayout::parse(
        "forge-dock 1 2\nw 1 1 0 0 100 100 1 T 0 1 a\nw 2 1 0 0 100 100 0 T 0 1 a\n",
        bad));  // the same panel docked twice
    CHECK(!DockLayout::parse("forge-dock 1 1\nw 1 1 0 0 100 100 1 S h 0 T 0 1 a T 0 1 b\n",
                             bad));  // ratio 0 is not a split
  }

  // ── REGRESSION: a panel ID with a space must round-trip ─────────────────
  // Panel IDs were emitted space-separated and unquoted, so "Scratch Notes"
  // parsed back as "Scratch" and the leftover token desynchronised the stream.
  {
    DockLayout named = defaultLayout(WorkspaceProfile::Part);
    DockWindow note;
    note.id = 42;
    note.monitor = 1;
    note.rect = Rect{10.0, 10.0, 400.0, 300.0};
    note.root = DockNode::split(SplitAxis::Vertical, 0.5,
                                DockNode::tabs({"Scratch Notes", "100% Zoom"}, 1),
                                DockNode::tabs({"a b  c"}, 0));
    named.addWindow(std::move(note));
    CHECK(named.valid());  // a space in a user-facing panel name is legal
    const std::string namedText = named.serialize();
    DockLayout namedBack;
    CHECK(DockLayout::parse(namedText, namedBack));
    CHECK(namedBack == named);
    CHECK_EQ_STR(namedBack.serialize(), namedText);
    CHECK(namedBack.hasPanel("Scratch Notes"));
    CHECK(namedBack.hasPanel("100% Zoom"));
    CHECK(namedBack.hasPanel("a b  c"));
    CHECK_EQ_INT(namedBack.panelCount(), named.panelCount());
    // the encoding is on the wire, so the stream stays token-aligned
    CHECK(namedText.find("Scratch Notes") == std::string::npos);
  }

  return H.finish();
}
