// ui/include/forge/ui/PanelFocus.hpp
//
// KEYBOARD NAVIGATION AND ACCESSIBLE NAMES — where "focus" is, and what the
// thing under it is called.
//
// A CAD workstation that can only be driven by pointing is not accessible and is
// not fast. Every professional shell has a key that moves focus panel to panel
// (F6 in the GNOME/Windows convention, Ctrl+` in others) and a name for each
// panel that is spoken, shown in a tooltip, and used by UI automation. Neither
// existed here: DockLayout knows the panel IDs — "feature_tree", "zebra_analysis"
// — and nothing turned them into either an ORDER or a NAME.
//
// ── the order is DERIVED from the dock tree ─────────────────────────────────
// Not a list. focusStops() walks the layout in the same depth-first order the
// frame builder draws it, so tab order matches reading order on screen; a user
// who splits a panel gets the new panel in the ring with no code change. The
// main window comes first and floating windows follow in their layout order,
// which is the order a window manager would cycle them.
//
// ── the name is TOTAL ───────────────────────────────────────────────────────
// panelDisplayName() answers for every string, always. Curated names for the
// panels the eight default layouts define, and a title-cased fallback for
// anything else — because a panel that arrives from a saved layout written by a
// newer build must still be nameable. Refusing to name it would be a gate on
// input, and the fallback is the repair.
#ifndef FORGE_UI_PANELFOCUS_HPP
#define FORGE_UI_PANELFOCUS_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/DockLayout.hpp"

namespace forge::ui {

// One place the keyboard can land.
struct FocusStop {
  PanelId panelId;
  std::string displayName;         // the accessible name
  std::size_t windowIndex = 0;     // index into DockLayout::windows()
  std::vector<std::size_t> path;   // node address from that window's root
  std::size_t tabIndex = 0;        // which tab within the Tabs node
  // FALSE when the panel is behind another tab in its group. Such a panel is
  // still a stop the ring can be asked for — "show me the Measure panel" has to
  // work — but it is not in the default cycle, because focusing something the
  // user cannot see is how a keyboard user gets lost.
  bool visible = true;
};

// Every panel in the layout, in draw order. Deterministic.
std::vector<FocusStop> focusStops(const DockLayout& layout);

// The human name of a panel ID. Total: never empty, for any input.
std::string panelDisplayName(const PanelId& id);

// TRUE when this ID has a curated name rather than the derived fallback. The
// gate uses it to require that every panel the shipped layouts define is named
// by a human, not by string surgery.
bool hasCuratedPanelName(const PanelId& id);

// ── the ring ────────────────────────────────────────────────────────────────
class FocusRing {
 public:
  FocusRing() = default;
  explicit FocusRing(const DockLayout& layout) { rebuild(layout); }

  // Re-derives the stops. KEEPS the focused panel if it still exists, so a
  // splitter drag or a tab switch does not throw the keyboard back to the first
  // panel — that is the specific annoyance a naive rebuild causes.
  void rebuild(const DockLayout& layout);

  const std::vector<FocusStop>& stops() const noexcept { return stops_; }
  std::size_t size() const noexcept { return stops_.size(); }        // visible stops
  std::size_t hidden() const noexcept { return hidden_; }            // behind a tab

  // "" when the ring is empty.
  const std::string& focused() const noexcept { return focused_; }
  const FocusStop* focusedStop() const noexcept;

  // Moves focus to a named panel. False (and no change) when the layout has no
  // such panel — a caller asking for a panel that is not there is a bug in the
  // caller, and silently focusing something else would hide it.
  bool focus(const PanelId& panelId);

  // Cycle. Wrap around, because a ring that stops at the end strands a user who
  // over-shot. Both return the panel now focused, "" when the ring is empty.
  const std::string& next();
  const std::string& previous();

  // How many times focus has actually moved. A gate asserts on it: "next()
  // returned a string" does not prove focus changed.
  std::size_t moves() const noexcept { return moves_; }

 private:
  std::vector<FocusStop> stops_;   // visible stops, in order
  std::size_t hidden_ = 0;
  std::string focused_;
  std::size_t moves_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_PANELFOCUS_HPP
