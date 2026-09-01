// ui/include/forge/ui/CommandSurface.hpp
//
// THE MENU, THE RIBBON, THE PALETTE AND THE CONTEXT MENU — as data, DERIVED from
// the command registry, in the layer CI compiles.
//
// ── what was wrong with where this lived ────────────────────────────────────
// ForgeFrame::drawMenuBar() and drawToolbar() already enumerated the registry,
// and app_surface_reachability_test.cpp proved they did by READING THEIR SOURCE
// as text. That gate is real and it stays. But it can only assert that a call
// APPEARS in a function body: the grouping, the ordering, the enabled state, the
// shortcut lookup and the tooltip text were all computed inline in
// forge-desktop/, which CI does not compile. "A file nothing compiles cannot
// break" — and two shipped defects came through exactly that door.
//
// So the DECISIONS move here and forge-desktop keeps the drawing. What a menu
// contains, in what order, greyed out or not, with which shortcut beside it and
// which sentence in its tooltip, is now a value a headless gate can hold in its
// hand and compare — and the frame builder's job is reduced to walking a vector
// and calling ImGui::MenuItem.
//
// ── "generated from the registry" means this, exactly ───────────────────────
// There is no table of menu names in this file. A group is a registry CATEGORY;
// an item is a registry COMMAND; its state is CommandRegistry::evaluate()'s own
// answer, which is the same call dispatch makes, so a greyed-out item and the
// dispatcher can never disagree. Register a command and it appears; that claim
// is a POSITIVE CONTROL in ui/test/command_surface_test.cpp, which fabricates a
// command, rebuilds the surfaces, and requires it to be there.
#ifndef FORGE_UI_COMMANDSURFACE_HPP
#define FORGE_UI_COMMANDSURFACE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::ui {

// Which surface a build produced. Carried on the surface so a renderer that
// receives one cannot mistake a ribbon for a menu bar, and so a log line can say
// where a click came from.
enum class SurfaceKind : std::uint8_t { MenuBar, Ribbon, Palette, ContextMenu };

const char* toString(SurfaceKind kind) noexcept;

struct SurfaceItem {
  std::string commandId;
  std::string label;
  std::string category;
  std::string featureIrOp;              // "-" when the command emits no IR
  std::string parameters;               // describeParameters(), "-" when none
  std::string shortcut;                 // "" when unbound in this input profile
  std::vector<std::string> shortcuts;   // every binding, sorted; may be empty

  // ToolAvailability is REUSED rather than re-declared. It already maps
  // DispatchStatus onto the five answers a UI can act on, and a second enum
  // meaning the same thing is how a menu and a tool panel come to disagree.
  ToolAvailability availability = ToolAvailability::Unavailable;
  DispatchStatus status = DispatchStatus::Ok;
  std::string reason;   // the dispatcher's own words; "" exactly when Available
  std::string hint;     // ONE sentence a user can act on; never empty

  // Required parameters with no honest default. Non-empty means an interactive
  // invocation must OPEN A DIALOG first — it is not a refusal, and a UI that
  // greys the item out instead of prompting has turned a prompt into a dead end.
  std::vector<std::string> prompts;

  bool enabled() const noexcept { return availability == ToolAvailability::Available; }
  bool opensDialog() const noexcept { return !prompts.empty(); }
};

struct SurfaceGroup {
  std::string title;                 // a registry category, or an availability band
  std::vector<SurfaceItem> items;
  std::size_t enabledCount() const noexcept;
};

struct CommandSurface {
  SurfaceKind kind = SurfaceKind::MenuBar;
  std::string context;               // the workspace name, or the palette query
  std::vector<SurfaceGroup> groups;

  std::size_t itemCount() const noexcept;
  std::size_t enabledCount() const noexcept;
  const SurfaceItem* find(const std::string& commandId) const noexcept;
  std::vector<std::string> commandIds() const;  // sorted, unique
};

// Everything a build reads, in one value. Passed by const reference so a builder
// cannot mutate the shell, and holding POINTERS rather than references so the
// struct stays assignable and a caller can build one incrementally.
//
// `keymap` may be null: a surface with no shortcut column is a legitimate
// request (a context menu), and requiring a keymap to build one would force a
// caller to fabricate an empty one.
struct SurfaceContext {
  const CommandRegistry* registry = nullptr;
  const SelectionService* selection = nullptr;
  const Keymap* keymap = nullptr;
  InputProfile input = InputProfile::ForgeNative;

  bool valid() const noexcept { return registry != nullptr && selection != nullptr; }
};

// ── the four surfaces ───────────────────────────────────────────────────────
// The menu bar: one group per registry category, categories in the registry's
// own deterministic order, items sorted by ID within a category. Every command
// the registry holds appears EXACTLY ONCE.
CommandSurface buildMenuSurface(const SurfaceContext& ctx);

// The ribbon for one workspace: the categories ribbonCategories() gives that
// workspace, which is the hand-written claim list made TOTAL over the registry.
// The union over all eight workspaces covers every command — asserted, not
// assumed, by ribbonCoverage() below.
CommandSurface buildRibbonSurface(const SurfaceContext& ctx, WorkspaceProfile workspace);

// The palette: CommandRegistry::search() — the registry's OWN ranked matcher, so
// the palette and every other filtered view agree about what a query matches.
// An empty query lists everything, capped at `limit`.
CommandSurface buildPaletteSurface(const SurfaceContext& ctx, const std::string& query,
                                   std::size_t limit = 20);

// The context menu: every command, banded by whether it can run RIGHT NOW.
// Banding rather than hiding is deliberate — a command that vanishes when the
// selection is wrong teaches a user nothing, and "needs 1..n Edge" is exactly
// what they needed to read.
CommandSurface buildContextSurface(const SurfaceContext& ctx);

// ── totality ────────────────────────────────────────────────────────────────
struct SurfaceCoverage {
  std::size_t registryCommands = 0;
  std::size_t offered = 0;
  std::vector<std::string> missing;    // registry commands this surface does not offer
  std::vector<std::string> duplicated; // commands offered by more than one group
  std::vector<std::string> unknown;    // offered ids the registry does not hold

  bool total() const noexcept { return missing.empty() && unknown.empty(); }
};

SurfaceCoverage coverage(const CommandSurface& surface, const CommandRegistry& registry);

// The union of every workspace's ribbon, measured against the registry. This is
// the property that broke once already: 21 of 34 commands were on no ribbon in
// any workspace while every other surface showed them.
SurfaceCoverage ribbonCoverage(const SurfaceContext& ctx);

// ── one item, on its own ────────────────────────────────────────────────────
// Exposed because a renderer sometimes needs a single item (a named button, a
// re-query after the selection changed) and re-building a whole surface for one
// row is how a frame builder ends up with its own copy of this logic.
SurfaceItem buildSurfaceItem(const SurfaceContext& ctx, const std::string& commandId);

}  // namespace forge::ui

#endif  // FORGE_UI_COMMANDSURFACE_HPP
