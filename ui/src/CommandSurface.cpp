#include "forge/ui/CommandSurface.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::ui {
namespace {

// The three availability bands a context menu groups by. An ENUM rather than
// three `const char*` compared by pointer: two string literals with the same
// contents may or may not share an address, so a pointer comparison is a
// coin-flip the optimiser gets to call.
enum class Band { Available, NeedsInput, Unavailable };

const char* bandTitle(Band band) noexcept {
  switch (band) {
    case Band::Available:   return "Available now";
    case Band::NeedsInput:  return "Needs a selection or a value";
    case Band::Unavailable: return "Unavailable";
  }
  return "Unavailable";
}

Band bandFor(ToolAvailability availability) noexcept {
  switch (availability) {
    case ToolAvailability::Available:
      return Band::Available;
    case ToolAvailability::NeedsSelection:
    case ToolAvailability::NeedsParameters:
      return Band::NeedsInput;
    case ToolAvailability::Disabled:
    case ToolAvailability::Unavailable:
      return Band::Unavailable;
  }
  return Band::Unavailable;
}

// The one sentence an item shows when the user asks why. Built from the SAME
// facts the dispatcher used, through the SAME explainer the activity log uses,
// so a tooltip and a log line can never tell two different stories.
std::string hintFor(const std::string& id, const CommandDescriptor* command,
                    const ToolEntry& entry, const SelectionService* selection) {
  if (entry.availability == ToolAvailability::Available) {
    // WHAT IT DOES, or nothing. This used to append " — emits FILLET": the
    // feature-IR op name, on the tooltip of every one of the 18 commands that
    // have one, in a sentence that told the user which token the modelling
    // engine would receive. "emits" is the compiler's word and the op is the
    // compiler's name for the operation the button is already labelled with.
    const std::string label = command != nullptr && !command->label.empty() ? command->label : id;
    if (command == nullptr || command->signature.kind == EntityKind::None) return label;
    // What it will act on, in the same words the refusal above uses, so the
    // available and the unavailable tooltip read as one voice.
    return label + " — works on " + command->signature.describeForUser();
  }
  return explainUnavailable(id, command, entry.status, entry.reason, entry.missing, selection);
}

SurfaceItem itemFrom(const SurfaceContext& ctx, const ToolEntry& entry) {
  SurfaceItem item;
  const CommandDescriptor* d = ctx.registry->find(entry.id);
  item.commandId = entry.id;
  item.label = entry.label;
  item.category = entry.category;
  item.featureIrOp = entry.featureIrOp;
  item.parameters = entry.parameters;
  item.availability = entry.availability;
  item.status = entry.status;
  item.reason = entry.reason;
  item.prompts = entry.missing;
  item.hint = hintFor(entry.id, d, entry, ctx.selection);
  if (ctx.keymap != nullptr) {
    item.shortcuts = ctx.keymap->shortcutsFor(ctx.input, entry.id);
    if (!item.shortcuts.empty()) item.shortcut = item.shortcuts.front();
  }
  return item;
}

// Build every item once, keyed by ID, so a surface that groups the same command
// into several places still evaluates it exactly once. evaluate() runs a user
// predicate; running it twice per frame per command is the kind of cost that is
// invisible until a registry has three hundred commands in it.
struct ItemIndex {
  std::vector<SurfaceItem> items;  // sorted by commandId

  const SurfaceItem* find(const std::string& id) const {
    const auto it = std::lower_bound(
        items.begin(), items.end(), id,
        [](const SurfaceItem& a, const std::string& key) { return a.commandId < key; });
    if (it == items.end() || it->commandId != id) return nullptr;
    return &*it;
  }
};

ItemIndex buildIndex(const SurfaceContext& ctx, const std::string& query, std::size_t limit) {
  ItemIndex index;
  const ToolCatalog catalog = buildToolCatalog(*ctx.registry, *ctx.selection, query);
  index.items.reserve(catalog.entries.size());
  std::size_t taken = 0;
  for (const ToolEntry& e : catalog.entries) {
    if (limit != 0 && taken >= limit) break;
    index.items.push_back(itemFrom(ctx, e));
    ++taken;
  }
  std::sort(index.items.begin(), index.items.end(),
            [](const SurfaceItem& a, const SurfaceItem& b) { return a.commandId < b.commandId; });
  return index;
}

CommandSurface emptySurface(SurfaceKind kind) {
  CommandSurface s;
  s.kind = kind;
  return s;
}

}  // namespace

const char* toString(SurfaceKind kind) noexcept {
  switch (kind) {
    case SurfaceKind::MenuBar:     return "menu-bar";
    case SurfaceKind::Ribbon:      return "ribbon";
    case SurfaceKind::Palette:     return "palette";
    case SurfaceKind::ContextMenu: return "context-menu";
  }
  return "menu-bar";
}

std::size_t SurfaceGroup::enabledCount() const noexcept {
  std::size_t n = 0;
  for (const SurfaceItem& i : items) {
    if (i.enabled()) ++n;
  }
  return n;
}

std::size_t CommandSurface::itemCount() const noexcept {
  std::size_t n = 0;
  for (const SurfaceGroup& g : groups) n += g.items.size();
  return n;
}

std::size_t CommandSurface::enabledCount() const noexcept {
  std::size_t n = 0;
  for (const SurfaceGroup& g : groups) n += g.enabledCount();
  return n;
}

const SurfaceItem* CommandSurface::find(const std::string& commandId) const noexcept {
  for (const SurfaceGroup& g : groups) {
    for (const SurfaceItem& i : g.items) {
      if (i.commandId == commandId) return &i;
    }
  }
  return nullptr;
}

std::vector<std::string> CommandSurface::commandIds() const {
  std::vector<std::string> out;
  for (const SurfaceGroup& g : groups) {
    for (const SurfaceItem& i : g.items) out.push_back(i.commandId);
  }
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

// ── the surfaces ────────────────────────────────────────────────────────────
SurfaceItem buildSurfaceItem(const SurfaceContext& ctx, const std::string& commandId) {
  SurfaceItem item;
  item.commandId = commandId;
  if (!ctx.valid()) {
    // Reachable only from a caller that has not finished wiring itself up, but
    // the string is drawn like any other hint, so it says something a user could
    // act on rather than naming the object that was missing.
    item.hint = "Forge is still starting up. Try this again in a moment.";
    return item;
  }
  const CommandDescriptor* d = ctx.registry->find(commandId);
  if (d == nullptr) {
    item.status = DispatchStatus::UnknownCommand;
    item.availability = ToolAvailability::Unavailable;
    item.label = commandId;
    item.reason = "This tool is not part of this version of Forge.";
    item.hint = explainUnavailable(commandId, nullptr, DispatchStatus::UnknownCommand, {}, {},
                                   ctx.selection);
    return item;
  }
  // buildToolCatalog's matcher is a SUBSTRING search, so querying the ID can
  // return several rows; take the exact one. Going through the catalog rather
  // than calling evaluate() here is the point — one mapping from DispatchStatus
  // to availability, not two.
  const ToolCatalog catalog = buildToolCatalog(*ctx.registry, *ctx.selection, commandId);
  const ToolEntry* entry = catalog.find(commandId);
  if (entry == nullptr) {
    item.label = d->label;
    item.category = d->category;
    item.status = DispatchStatus::UnknownCommand;
    item.hint = "Forge could not work out whether this tool can be used right now. "
                "Try it, or restart Forge if it keeps happening.";
    return item;
  }
  return itemFrom(ctx, *entry);
}

CommandSurface buildMenuSurface(const SurfaceContext& ctx) {
  CommandSurface surface = emptySurface(SurfaceKind::MenuBar);
  if (!ctx.valid()) return surface;
  const ItemIndex index = buildIndex(ctx, {}, 0);
  for (const std::string& category : ctx.registry->categories()) {
    SurfaceGroup group;
    group.title = category;
    for (const std::string& id : ctx.registry->idsInCategory(category)) {
      const SurfaceItem* item = index.find(id);
      if (item != nullptr) group.items.push_back(*item);
    }
    // A category with no items cannot happen through categories() — it is
    // derived from the commands — but an empty menu title is a UI defect if it
    // ever does, so it is dropped rather than drawn.
    if (!group.items.empty()) surface.groups.push_back(std::move(group));
  }
  return surface;
}

CommandSurface buildRibbonSurface(const SurfaceContext& ctx, WorkspaceProfile workspace) {
  CommandSurface surface = emptySurface(SurfaceKind::Ribbon);
  surface.context = toString(workspace);
  if (!ctx.valid()) return surface;
  const ItemIndex index = buildIndex(ctx, {}, 0);
  for (const std::string& category : ribbonCategories(workspace, ctx.registry->categories())) {
    SurfaceGroup group;
    group.title = category;
    for (const std::string& id : ctx.registry->idsInCategory(category)) {
      const SurfaceItem* item = index.find(id);
      if (item != nullptr) group.items.push_back(*item);
    }
    if (!group.items.empty()) surface.groups.push_back(std::move(group));
  }
  return surface;
}

CommandSurface buildPaletteSurface(const SurfaceContext& ctx, const std::string& query,
                                   std::size_t limit) {
  CommandSurface surface = emptySurface(SurfaceKind::Palette);
  surface.context = query;
  if (!ctx.valid()) return surface;

  // RANK ORDER, not category order. The palette's whole value is that the best
  // match is first; regrouping it by category would throw the ranking away.
  std::vector<std::string> ranked;
  if (query.empty()) {
    ranked = ctx.registry->ids();
    if (limit != 0 && ranked.size() > limit) ranked.resize(limit);
  } else if (ctx.registry->size() != 0) {
    ranked = ctx.registry->search(query, limit == 0 ? ctx.registry->size() : limit);
  }
  if (ranked.empty()) return surface;

  const ItemIndex index = buildIndex(ctx, {}, 0);
  SurfaceGroup group;
  group.title = query.empty() ? std::string("All commands") : ("Matching \"" + query + "\"");
  for (const std::string& id : ranked) {
    const SurfaceItem* item = index.find(id);
    if (item != nullptr) group.items.push_back(*item);
  }
  if (!group.items.empty()) surface.groups.push_back(std::move(group));
  return surface;
}

CommandSurface buildContextSurface(const SurfaceContext& ctx) {
  CommandSurface surface = emptySurface(SurfaceKind::ContextMenu);
  if (!ctx.valid()) return surface;
  const ItemIndex index = buildIndex(ctx, {}, 0);

  SurfaceGroup available;
  available.title = bandTitle(Band::Available);
  SurfaceGroup needsInput;
  needsInput.title = bandTitle(Band::NeedsInput);
  SurfaceGroup unavailable;
  unavailable.title = bandTitle(Band::Unavailable);

  for (const SurfaceItem& item : index.items) {
    switch (bandFor(item.availability)) {
      case Band::Available:   available.items.push_back(item); break;
      case Band::NeedsInput:  needsInput.items.push_back(item); break;
      case Band::Unavailable: unavailable.items.push_back(item); break;
    }
  }
  for (SurfaceGroup* g : {&available, &needsInput, &unavailable}) {
    if (!g->items.empty()) surface.groups.push_back(std::move(*g));
  }
  return surface;
}

// ── totality ────────────────────────────────────────────────────────────────
SurfaceCoverage coverage(const CommandSurface& surface, const CommandRegistry& registry) {
  SurfaceCoverage out;
  out.registryCommands = registry.size();

  std::vector<std::string> offered;
  for (const SurfaceGroup& g : surface.groups) {
    for (const SurfaceItem& i : g.items) offered.push_back(i.commandId);
  }
  std::sort(offered.begin(), offered.end());
  for (std::size_t i = 0; i < offered.size(); ++i) {
    if (i != 0 && offered[i] == offered[i - 1]) {
      if (out.duplicated.empty() || out.duplicated.back() != offered[i]) {
        out.duplicated.push_back(offered[i]);
      }
    }
  }
  offered.erase(std::unique(offered.begin(), offered.end()), offered.end());
  out.offered = offered.size();

  for (const std::string& id : registry.ids()) {
    if (!std::binary_search(offered.begin(), offered.end(), id)) out.missing.push_back(id);
  }
  for (const std::string& id : offered) {
    if (!registry.contains(id)) out.unknown.push_back(id);
  }
  return out;
}

SurfaceCoverage ribbonCoverage(const SurfaceContext& ctx) {
  SurfaceCoverage out;
  if (!ctx.valid()) return out;
  out.registryCommands = ctx.registry->size();

  std::vector<std::string> offered;
  for (WorkspaceProfile p : allWorkspaceProfiles()) {
    const CommandSurface s = buildRibbonSurface(ctx, p);
    for (const std::string& id : s.commandIds()) offered.push_back(id);
  }
  std::sort(offered.begin(), offered.end());
  offered.erase(std::unique(offered.begin(), offered.end()), offered.end());
  out.offered = offered.size();
  for (const std::string& id : ctx.registry->ids()) {
    if (!std::binary_search(offered.begin(), offered.end(), id)) out.missing.push_back(id);
  }
  for (const std::string& id : offered) {
    if (!ctx.registry->contains(id)) out.unknown.push_back(id);
  }
  // `duplicated` is left empty on purpose: a command appearing on two
  // workspaces' ribbons is CORRECT (View is on all eight), so counting it as a
  // duplicate here would report the design as a defect.
  return out;
}

}  // namespace forge::ui
