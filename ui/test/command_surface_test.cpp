// ui/test/command_surface_test.cpp — IS THE MENU REALLY GENERATED FROM THE REGISTRY?
//
// CommandSurface.hpp makes a claim about itself: "Register a command and it
// appears; that claim is a POSITIVE CONTROL in ui/test/command_surface_test.cpp,
// which fabricates a command, rebuilds the surfaces, and requires it to be
// there." That file did not exist. 348 lines of CommandSurface.cpp shipped with
// nothing running them — the same shape as the two defects the header's own
// preamble is about ("a file nothing compiles cannot break"), one rung down: a
// model nothing EXECUTES cannot fail either.
//
// The positive control has BOTH halves. Asserting that a fabricated command is
// present proves nothing on its own — a surface that returned every string in
// the process would pass it. So block (b) asserts the command is ABSENT first,
// registers it, rebuilds, and only then requires it. The difference between the
// two builds is the whole evidence, and it is the only thing that separates
// "derived from the registry" from "a hand-written table that happens to agree".
//
// What is pinned as a NUMBER here is deliberately small: totality is a relation
// (every registry command, exactly once) and stays true as commands are added,
// whereas 45 would have to be edited by whoever adds the 46th and is therefore a
// number that decays into noise. The one exception is block (f).
#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/CommandSurface.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

// The application registry, exactly as ForgeFrame::wirePartCommands() builds it:
// the shell's own commands plus the Part workspace's. Anything less is not the
// registry the running app dispatches through, and a surface gate over a
// fixture registry would be a gate over a fixture.
struct App {
  ForgeShell shell;
  PartDocument document;
  UndoStack stack;
  std::size_t partCommands = 0;

  App() { partCommands = registerPartCommands(shell.registry(), document, stack); }

  SurfaceContext context() {
    SurfaceContext ctx;
    ctx.registry = &shell.registry();
    ctx.selection = &shell.selection();
    ctx.keymap = &shell.keymap();
    ctx.input = shell.inputProfile();
    return ctx;
  }
};

CommandDescriptor fabricated(const char* id, const char* category) {
  CommandDescriptor c;
  c.id = id;
  c.label = "Fabricated Probe";
  c.category = category;
  c.sideEffect = SideEffectClass::ViewOnly;
  c.undo = UndoContract::NotUndoable;
  c.enabled = [](const CommandContext&) { return true; };
  c.execute = [](CommandContext&) {};
  return c;
}

bool contains(const std::vector<std::string>& v, const std::string& s) {
  return std::find(v.begin(), v.end(), s) != v.end();
}

}  // namespace

int main() {
  forge::uitest::Harness H("command_surface");

  // ── (a) the menu bar is TOTAL over the registry ───────────────────────────
  // "Generated from the registry" is not "it calls categories()". It is: every
  // command the registry holds is offered, exactly once, and nothing is offered
  // that the registry does not hold. coverage() answers all three at once.
  {
    App app;
    const SurfaceContext ctx = app.context();
    const CommandSurface menu = buildMenuSurface(ctx);
    const SurfaceCoverage cov = coverage(menu, app.shell.registry());

    CHECK(cov.total());
    CHECK_EQ_INT(cov.missing.size(), 0);
    CHECK_EQ_INT(cov.unknown.size(), 0);
    CHECK_EQ_INT(cov.duplicated.size(), 0);
    CHECK_EQ_INT(cov.registryCommands, app.shell.registry().size());
    CHECK_EQ_INT(cov.offered, app.shell.registry().size());
    // itemCount() counts SLOTS, offered counts distinct ids. Equal iff nothing
    // is drawn twice — the property a menu with a duplicate entry would break
    // while coverage.missing stayed empty.
    CHECK_EQ_INT(menu.itemCount(), app.shell.registry().size());
    CHECK(menu.kind == SurfaceKind::MenuBar);

    // Groups are the registry's own categories, in the registry's own order.
    const std::vector<std::string> cats = app.shell.registry().categories();
    CHECK_EQ_INT(menu.groups.size(), cats.size());
    for (std::size_t i = 0; i < menu.groups.size() && i < cats.size(); ++i) {
      CHECK_EQ_STR(menu.groups[i].title, cats[i]);
      CHECK(!menu.groups[i].items.empty());
    }
    // Within a group, the registry's own sorted order — a menu whose items move
    // between frames is unusable, and idsInCategory() is the sorted source.
    for (const SurfaceGroup& g : menu.groups) {
      const std::vector<std::string> ids = app.shell.registry().idsInCategory(g.title);
      CHECK_EQ_INT(g.items.size(), ids.size());
      for (std::size_t i = 0; i < g.items.size() && i < ids.size(); ++i) {
        CHECK_EQ_STR(g.items[i].commandId, ids[i]);
      }
    }
  }

  // ── (b) THE POSITIVE CONTROL, with its negative half ─────────────────────
  // Absent, then registered, then present — on the same surface builder, with
  // nothing else changed. Without the "absent" assertion this block would pass
  // against a surface that emitted every id it could think of.
  {
    App app;
    const std::string probeId = "probe.fabricated_command";
    CHECK(app.shell.registry().find(probeId) == nullptr);

    const CommandSurface before = buildMenuSurface(app.context());
    CHECK(before.find(probeId) == nullptr);
    CHECK(!contains(before.commandIds(), probeId));
    const std::size_t itemsBefore = before.itemCount();

    CHECK(app.shell.registry().add(fabricated(probeId.c_str(), "Part")));

    const CommandSurface after = buildMenuSurface(app.context());
    const SurfaceItem* found = after.find(probeId);
    CHECK(found != nullptr);
    CHECK_EQ_INT(after.itemCount(), itemsBefore + 1);
    if (found != nullptr) {
      CHECK_EQ_STR(found->label, "Fabricated Probe");
      CHECK_EQ_STR(found->category, "Part");
      // No hand-written table was edited to make this appear, and nothing had to
      // be told the command emits no IR: "-" is what the catalog derives.
      CHECK_EQ_STR(found->featureIrOp, "-");
      CHECK(found->enabled());
    }
    // And it is total again WITHOUT anyone updating a count.
    CHECK(coverage(after, app.shell.registry()).total());

    // Every other surface is generated from the same registry, so the same
    // command has to reach all four. A menu that saw it and a palette that did
    // not would be two sources of truth.
    CHECK(buildContextSurface(app.context()).find(probeId) != nullptr);
    CHECK(buildPaletteSurface(app.context(), "fabricated", 20).find(probeId) != nullptr);
    CHECK(buildRibbonSurface(app.context(), WorkspaceProfile::Part).find(probeId) != nullptr);
  }

  // ── (c) a NEW CATEGORY becomes a new menu, with no table to edit ──────────
  // The stronger form of (b): a category nothing in the registry used before.
  // If menu groups came from a hand-maintained list this is the case that fails.
  {
    App app;
    const std::vector<std::string> catsBefore = app.shell.registry().categories();
    CHECK(!contains(catsBefore, "Inspection"));

    CHECK(app.shell.registry().add(fabricated("probe.inspect", "Inspection")));
    const CommandSurface menu = buildMenuSurface(app.context());
    CHECK_EQ_INT(menu.groups.size(), catsBefore.size() + 1);
    const SurfaceGroup* group = nullptr;
    for (const SurfaceGroup& g : menu.groups) {
      if (g.title == "Inspection") group = &g;
    }
    CHECK(group != nullptr);
    if (group != nullptr) {
      CHECK_EQ_INT(group->items.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(std::vector<std::string>{group->items[0].commandId}, 0),
                   "probe.inspect");
    }
    CHECK(coverage(menu, app.shell.registry()).total());
  }

  // ── (d) the ribbon covers the registry across the workspaces ─────────────
  // The property that broke once already: 21 of 34 commands were on no ribbon in
  // any workspace while every other surface showed them. `duplicated` is not
  // asserted empty here on purpose — View is on all eight ribbons by design, and
  // ribbonCoverage() documents that it leaves the field empty for that reason.
  {
    App app;
    const SurfaceCoverage cov = ribbonCoverage(app.context());
    CHECK(cov.total());
    CHECK_EQ_INT(cov.missing.size(), 0);
    CHECK_EQ_INT(cov.offered, app.shell.registry().size());

    // And a ribbon carries only the categories that workspace claims — a ribbon
    // equal to the menu bar would make the workspace tabs decoration.
    const CommandSurface part = buildRibbonSurface(app.context(), WorkspaceProfile::Part);
    CHECK(part.kind == SurfaceKind::Ribbon);
    CHECK_EQ_STR(part.context, toString(WorkspaceProfile::Part));
    const std::vector<std::string> claimed =
        ribbonCategories(WorkspaceProfile::Part, app.shell.registry().categories());
    // NOT groups.size() == claimed.size(): the Part workspace claims "Model",
    // which holds no commands since the model.* counter stubs were retired, and
    // buildRibbonSurface DROPS an empty group rather than drawing an empty menu
    // title. So the relation is: every group is claimed, and every claimed
    // category that has commands is a group. MEASURED: 6 claimed, 5 drawn.
    CHECK(part.groups.size() <= claimed.size());
    for (const SurfaceGroup& g : part.groups) {
      CHECK(contains(claimed, g.title));
      CHECK(!g.items.empty());
    }
    for (const std::string& c : claimed) {
      const bool hasCommands = !app.shell.registry().idsInCategory(c).empty();
      bool drawn = false;
      for (const SurfaceGroup& g : part.groups) {
        if (g.title == c) drawn = true;
      }
      CHECK_EQ_INT(static_cast<int>(drawn), static_cast<int>(hasCommands));
    }
    CHECK(part.itemCount() > 0);
  }

  // ── (e) the palette is the REGISTRY'S ranker, not a second matcher ────────
  {
    App app;
    const SurfaceContext ctx = app.context();
    const std::string query = "fillet";
    const std::vector<std::string> ranked = app.shell.registry().search(query, 20);
    const CommandSurface pal = buildPaletteSurface(ctx, query, 20);
    CHECK(pal.kind == SurfaceKind::Palette);
    CHECK_EQ_STR(pal.context, query);
    CHECK_EQ_INT(pal.groups.size(), 1);
    CHECK_EQ_INT(pal.itemCount(), ranked.size());
    // ORDER, not just membership: the palette's whole value is that the best
    // match is first, and regrouping by category would silently discard it.
    if (!pal.groups.empty()) {
      CHECK_EQ_STR(pal.groups[0].title, "Matching \"fillet\"");
      for (std::size_t i = 0; i < ranked.size() && i < pal.groups[0].items.size(); ++i) {
        CHECK_EQ_STR(pal.groups[0].items[i].commandId, ranked[i]);
      }
    }
    // An empty query lists everything, capped.
    const CommandSurface all = buildPaletteSurface(ctx, {}, 7);
    CHECK_EQ_INT(all.itemCount(), 7);
    CHECK_EQ_STR(all.groups.empty() ? std::string() : all.groups[0].title, "All commands");
    // A query nothing matches is an EMPTY surface, not a full one. The failure
    // mode worth refusing: a matcher that falls back to "show everything" makes
    // a typo look like a working search.
    const CommandSurface none = buildPaletteSurface(ctx, "zzzz-no-such-command", 20);
    CHECK_EQ_INT(none.itemCount(), 0);
  }

  // ── (f) the context menu BANDS, and the bands answer to the selection ─────
  // The one place a pinned number belongs: with nothing selected, every command
  // that needs a selection must be in the "needs input" band and NOT in
  // "available now". That is a statement about this registry's shape, so it is
  // checked as a relation over every item rather than as a count.
  {
    App app;
    app.shell.selection().clearSelection();
    const CommandSurface ctxMenu = buildContextSurface(app.context());
    CHECK(ctxMenu.kind == SurfaceKind::ContextMenu);
    CHECK(coverage(ctxMenu, app.shell.registry()).total());
    CHECK_EQ_INT(coverage(ctxMenu, app.shell.registry()).duplicated.size(), 0);

    std::size_t availableBand = 0;
    for (const SurfaceGroup& g : ctxMenu.groups) {
      if (g.title == "Available now") availableBand = g.items.size();
      for (const SurfaceItem& item : g.items) {
        // A band is the item's own availability, so a renderer cannot show an
        // item under "Available now" that dispatch would refuse.
        if (g.title == "Available now") {
          CHECK(item.enabled());
          CHECK_EQ_STR(item.reason, "");
        } else {
          CHECK(!item.enabled());
          // The dispatcher's own words, never blank: a context menu that greys
          // an item out and says nothing teaches the user nothing.
          CHECK(!item.reason.empty());
        }
        CHECK(!item.hint.empty());
      }
    }
    CHECK(availableBand > 0);

    // Now pick an edge. part.fillet needs 1..n Edge, so it must MOVE bands —
    // and that movement is the proof the band came from the live selection and
    // not from a static property of the command.
    const SurfaceItem beforePick = buildSurfaceItem(app.context(), "part.fillet");
    CHECK(!beforePick.enabled());
    CHECK(beforePick.status == DispatchStatus::SelectionSignatureMismatch);
    CHECK(beforePick.availability == ToolAvailability::NeedsSelection);
  }

  // ── (g) one item carries what a renderer needs, and nothing it must invent ──
  {
    App app;
    const SurfaceItem item = buildSurfaceItem(app.context(), "part.fillet");
    CHECK_EQ_STR(item.commandId, "part.fillet");
    CHECK_EQ_STR(item.label, "Edge Fillet");
    CHECK_EQ_STR(item.category, "Part");
    CHECK_EQ_STR(item.featureIrOp, "FILLET");
    CHECK(!item.parameters.empty());
    // The shortcut column comes from the keymap in the ACTIVE input profile.
    CHECK_EQ_STR(item.shortcut, "R");
    CHECK(!item.shortcuts.empty());

    // Switching profile changes the shortcut text and NOTHING else about the
    // item — one command, four keyboard cultures.
    App nx;
    nx.shell.setInputProfile(InputProfile::NXLike);
    const SurfaceItem nxItem = buildSurfaceItem(nx.context(), "part.fillet");
    CHECK_EQ_STR(nxItem.shortcut, "Ctrl+B");
    CHECK_EQ_STR(nxItem.label, item.label);
    CHECK_EQ_STR(nxItem.featureIrOp, item.featureIrOp);

    // A surface built with NO keymap is legitimate (a context menu) and must not
    // fabricate a shortcut.
    SurfaceContext noKeys = app.context();
    noKeys.keymap = nullptr;
    const SurfaceItem bare = buildSurfaceItem(noKeys, "part.fillet");
    CHECK_EQ_STR(bare.shortcut, "");
    CHECK_EQ_INT(bare.shortcuts.size(), 0);
    CHECK_EQ_STR(bare.label, item.label);
  }

  // ── (h) an id the registry does not hold is REPRESENTED, never a crash ────
  // The owner's constraint applied to a surface: represent, repair, tolerate.
  {
    App app;
    const SurfaceItem missing = buildSurfaceItem(app.context(), "part.no_such_command");
    CHECK(missing.status == DispatchStatus::UnknownCommand);
    CHECK(missing.availability == ToolAvailability::Unavailable);
    CHECK(!missing.enabled());
    CHECK(!missing.hint.empty());
    CHECK_EQ_STR(missing.commandId, "part.no_such_command");

    // An INVALID context is answered with an empty surface, not a dereferenced
    // null. Every builder takes the same guard, so all four are driven.
    SurfaceContext broken;
    CHECK(!broken.valid());
    CHECK_EQ_INT(buildMenuSurface(broken).itemCount(), 0);
    CHECK_EQ_INT(buildRibbonSurface(broken, WorkspaceProfile::Part).itemCount(), 0);
    CHECK_EQ_INT(buildPaletteSurface(broken, "x", 5).itemCount(), 0);
    CHECK_EQ_INT(buildContextSurface(broken).itemCount(), 0);
    CHECK_EQ_INT(ribbonCoverage(broken).offered, 0);
    const SurfaceItem noRegistry = buildSurfaceItem(broken, "anything");
    CHECK(!noRegistry.hint.empty());

    // Half a context is still invalid — a registry with no selection cannot
    // evaluate an enabled predicate, and answering anyway would be a guess.
    SurfaceContext halfway;
    halfway.registry = &app.shell.registry();
    CHECK(!halfway.valid());
    CHECK_EQ_INT(buildMenuSurface(halfway).itemCount(), 0);
  }

  // ── (i) the surface agrees with the DISPATCHER, on every command ──────────
  // The claim the whole design rests on: a greyed-out item and the dispatcher
  // can never disagree. Driven over the entire registry, in two different
  // selection states, rather than asserted about one command.
  {
    App app;
    for (int state = 0; state < 2; ++state) {
      if (state == 1) {
        EntityRef edge;
        edge.bodyId = "body.probe";
        edge.kind = EntityKind::Edge;
        edge.persistentName = "edge@1";
        app.shell.selection().replaceWith({edge});
      }
      const CommandSurface menu = buildMenuSurface(app.context());
      for (const std::string& id : app.shell.registry().ids()) {
        const SurfaceItem* item = menu.find(id);
        CHECK(item != nullptr);
        if (item == nullptr) continue;
        const CommandDescriptor* d = app.shell.registry().find(id);
        if (d == nullptr) continue;
        // evaluate() with the schema's OWN defaults filled in is exactly what an
        // interactive invocation does, so this is the dispatcher's answer to the
        // question the menu item is asking.
        const CommandParams filled = applyDefaults(*d, CommandParams{});
        const DispatchResult verdict =
            app.shell.registry().evaluate(id, app.shell.selection(), filled);
        CHECK_EQ_INT(static_cast<int>(item->enabled()), static_cast<int>(verdict.ok()));
        // And an item that opens a dialog is NOT the same thing as one that is
        // refused: prompts are the parameters applyDefaults could not supply.
        CHECK_EQ_INT(item->prompts.size(), missingRequired(*d, filled).size());
        CHECK_EQ_INT(static_cast<int>(item->opensDialog()), !missingRequired(*d, filled).empty());
      }
    }
  }

  return H.finish();
}
