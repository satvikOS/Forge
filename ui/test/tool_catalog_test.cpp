// ui/test/tool_catalog_test.cpp
//
// The Archie Tools panel's model.
//
// The load-bearing claim is that the panel CANNOT DISAGREE WITH THE DISPATCHER:
// every entry's availability is re-derived here from CommandRegistry::evaluate()
// over the same defaulted parameters ForgeShell::invoke() would supply, and each
// one must match. That is checked for every command in the registry, not for a
// sampled few, because a tool list that says "available" about a command that
// then refuses is precisely the failure an agent cannot recover from.
//
// Around it: the availability must be LIVE (the same command changes verdict
// when the selection changes), the four refusal reasons must stay distinguishable
// (a command missing a parameter must not read as disabled), and the query filter
// must be the palette's own matcher rather than a second one.
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

EntityRef ref(EntityKind kind, const std::string& body, const std::string& name) {
  EntityRef r;
  r.bodyId = body;
  r.kind = kind;
  r.persistentName = name;
  return r;
}

ToolAvailability availabilityOf(const ToolCatalog& c, const std::string& id) {
  const ToolEntry* e = c.find(id);
  return e == nullptr ? ToolAvailability::Unavailable : e->availability;
}

}  // namespace

int main() {
  Harness H("tool_catalog");

  // The two values a Part command consumes: a profile to extrude, a solid to modify.
  // The seeds are CHECKED. They used to be `SKETCH(XY)` + `BOX(...)`, and `SKETCH` is in
  // no op table, so validateIr rejected it and seed() returned 0 -- "sketch.base" was
  // never bound and every profile-consuming command in this gate evaluated `disabled`
  // for a reason the gate never reported. ForgeFrame hit the same bug and was fixed;
  // these seeds were left behind. Checking the return is what makes that class of
  // defect impossible to reintroduce silently.
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  // RECT, not "SKETCH": forge::ft has no SKETCH op, so validateIr answered
  // unknown_op, the seed bound NO value, and every profile-consuming command was
  // permanently unresolvable in this fixture -- the same defect the shipped app
  // had until defaultPartStatements() replaced it. A fixture that claims to be
  // "exactly what ForgeFrame::wirePartCommands() builds" has to seed what it
  // seeds.
  CHECK_EQ_INT(doc.seed(IrValueKind::Profile, "sketch.base", "RECT",
                        {IrArg::num(80.0), IrArg::num(50.0)}), 1);
  CHECK_EQ_INT(doc.seed(IrValueKind::Solid, "body.bracket", "BOX",
                        {IrArg::num(80.0), IrArg::num(50.0), IrArg::num(20.0)}), 2);
  registerPartCommands(shell.registry(), doc, undo);
  const CommandRegistry& reg = shell.registry();

  // ── 1. the catalog IS the registry ────────────────────────────────────────
  {
    const ToolCatalog c = buildToolCatalog(reg, shell.selection());
    CHECK_EQ_INT(c.size(), reg.size());
    CHECK_EQ_INT(c.available + c.needsSelection + c.needsParameters + c.disabled + c.unavailable,
                 c.size());
    CHECK_EQ_INT(c.categories.size(), reg.categories().size());
    for (std::size_t i = 0; i < c.categories.size() && i < reg.categories().size(); ++i) {
      CHECK_EQ_STR(c.categories[i], reg.categories()[i]);
    }
    // Sorted by category, then id — a panel that re-sorted every frame would
    // move a row out from under the cursor.
    for (std::size_t i = 1; i < c.entries.size(); ++i) {
      const bool ordered = c.entries[i - 1].category < c.entries[i].category ||
                           (c.entries[i - 1].category == c.entries[i].category &&
                            c.entries[i - 1].id < c.entries[i].id);
      CHECK(ordered);
    }
    // Every field is the registry's, not a copy that can drift.
    for (const ToolEntry& e : c.entries) {
      const CommandDescriptor* d = reg.find(e.id);
      CHECK(d != nullptr);
      if (d == nullptr) continue;
      CHECK_EQ_STR(e.label, d->label);
      CHECK_EQ_STR(e.category, d->category);
      CHECK_EQ_STR(e.featureIrOp, d->featureIrOp.empty() ? std::string("-") : d->featureIrOp);
      CHECK_EQ_STR(e.selection, d->signature.describe());
      CHECK_EQ_INT(e.version, d->version);
    }
    CHECK(c.find("part.fillet") != nullptr);
    CHECK(c.find("no.such.command") == nullptr);
  }

  // ── 2. THE invariant: availability == what the dispatcher would say ───────
  // Re-derived independently for three different selections, over every command.
  {
    struct Case { const char* name; std::vector<EntityRef> picks; };
    const std::vector<Case> cases = {
        {"nothing", {}},
        {"one face", {ref(EntityKind::Face, "body.bracket", "face@1")}},
        {"one sketch", {ref(EntityKind::Sketch, "sketch.base", "")}},
        {"two bodies",
         {ref(EntityKind::Body, "body.a", ""), ref(EntityKind::Body, "body.b", "")}},
    };
    for (const Case& k : cases) {
      shell.selection().clearSelection();
      shell.selection().replaceWith(k.picks);
      const ToolCatalog c = buildToolCatalog(reg, shell.selection());
      std::size_t reDerivedAvailable = 0;
      for (const std::string& id : reg.ids()) {
        const CommandDescriptor* d = reg.find(id);
        if (d == nullptr) continue;
        const CommandParams filled = applyDefaults(*d, CommandParams{});
        const DispatchResult verdict = reg.evaluate(id, shell.selection(), filled);
        const ToolEntry* e = c.find(id);
        CHECK(e != nullptr);
        if (e == nullptr) continue;
        CHECK_EQ_INT(e->callable() ? 1 : 0, verdict.ok() ? 1 : 0);
        // A reason is present exactly when the tool cannot be called.
        CHECK_EQ_INT(e->reason.empty() ? 1 : 0, verdict.ok() ? 1 : 0);
        CHECK_EQ_INT(e->missing.size(), missingRequired(*d, filled).size());
        if (verdict.ok()) ++reDerivedAvailable;
      }
      CHECK_EQ_INT(c.available, reDerivedAvailable);
    }
    shell.selection().clearSelection();
  }

  // ── 3. the four refusals stay distinguishable ─────────────────────────────
  // With nothing picked. These are semantic claims about specific commands, so
  // a command whose gating changed cannot slip past as "some count moved".
  {
    const ToolCatalog c = buildToolCatalog(reg, shell.selection());
    CHECK(availabilityOf(c, "view.fit") == ToolAvailability::Available);
    CHECK(availabilityOf(c, "part.fillet") == ToolAvailability::NeedsSelection);
    CHECK(availabilityOf(c, "file.open") == ToolAvailability::NeedsParameters);
    CHECK(availabilityOf(c, "edit.undo") == ToolAvailability::Disabled);

    const ToolEntry* open = c.find("file.open");
    CHECK(open != nullptr);
    if (open != nullptr) {
      CHECK_EQ_INT(open->missing.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(open->missing, 0), "path");
    }
    const ToolEntry* fit = c.find("view.fit");
    CHECK(fit != nullptr);
    if (fit != nullptr) {
      CHECK_EQ_INT(fit->missing.size(), 0);
      CHECK_EQ_STR(fit->reason, "");
      CHECK_EQ_STR(fit->sideEffect, "view");
      CHECK_EQ_STR(fit->undo, "none");
    }
    const ToolEntry* fil = c.find("part.fillet");
    CHECK(fil != nullptr);
    if (fil != nullptr) {
      CHECK_EQ_STR(fil->sideEffect, "document");
      CHECK_EQ_STR(fil->undo, "transaction");
      CHECK_EQ_STR(fil->featureIrOp, "FILLET");
      CHECK_EQ_STR(fil->selection, "1..n edge (homogeneous)");
    }
  }

  // ── 4. availability is LIVE, and the reasons are not interchangeable ──────
  // Picking a face must move some commands and not others, and a command that
  // becomes selectable but still lacks a parameter must say THAT, not "disabled".
  {
    shell.selection().replaceWith({ref(EntityKind::Face, "body.bracket", "face@1")});
    const ToolCatalog c = buildToolCatalog(reg, shell.selection());
    CHECK(availabilityOf(c, "edit.delete") == ToolAvailability::Available);
    // thickness carries a declared default, so a face is all it was waiting for
    CHECK(availabilityOf(c, "part.shell") == ToolAvailability::Available);
    // diameter carries an honest default (6 mm) now, so a picked face is all the
    // hole was waiting for. It used to stand here as the NeedsParameters
    // exemplar because its ParamSpec was written in the braced-positional form
    // that stops before `hasDefault` -- the value was sitting in defaultNumber
    // and applyDefaults() was forbidden to read it.
    CHECK(availabilityOf(c, "part.hole") == ToolAvailability::Available);
    // The exemplar moves to a command whose required parameter has no honest
    // value at all: there is no default NEW VALUE for a feature parameter, and
    // inventing one would let a menu click silently resize the part. Its
    // signature is none(), so this is a PARAMETER refusal at every selection --
    // which is the property the next block leans on.
    CHECK(availabilityOf(c, "part.edit_feature") == ToolAvailability::NeedsParameters);
    const ToolEntry* edit = c.find("part.edit_feature");
    CHECK(edit != nullptr);
    if (edit != nullptr) {
      CHECK_EQ_INT(edit->missing.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(edit->missing, 0), "value");
    }
    // a face is not an edge, so the fillet is still waiting for a selection
    CHECK(availabilityOf(c, "part.fillet") == ToolAvailability::NeedsSelection);

    shell.selection().replaceWith({ref(EntityKind::Sketch, "sketch.base", "")});
    const ToolCatalog s = buildToolCatalog(reg, shell.selection());
    // distance carries a declared default too, so a picked sketch is enough
    CHECK(availabilityOf(s, "part.extrude") == ToolAvailability::Available);
    CHECK(availabilityOf(s, "part.shell") == ToolAvailability::NeedsSelection);
    // and the two refusals stay distinguishable rather than collapsing into one:
    // a sketch is not a face, so the hole is waiting for a SELECTION, while
    // part.edit_feature -- which needs no selection at all -- is waiting for a
    // PARAMETER. Same instant, same catalog, two different answers.
    CHECK(availabilityOf(s, "part.hole") == ToolAvailability::NeedsSelection);
    CHECK(availabilityOf(s, "part.edit_feature") == ToolAvailability::NeedsParameters);
    shell.selection().clearSelection();
  }

  // ── 5. the parameter description ──────────────────────────────────────────
  {
    const ToolCatalog c = buildToolCatalog(reg, shell.selection());
    const ToolEntry* fil = c.find("part.fillet");
    const ToolEntry* hole = c.find("part.hole");
    const ToolEntry* loft = c.find("part.loft");
    const ToolEntry* fit = c.find("view.fit");
    CHECK(fil != nullptr && hole != nullptr && loft != nullptr && fit != nullptr);
    // * AND a default: required, but a gesture can still run it
    if (fil != nullptr) CHECK_EQ_STR(fil->parameters, "radius:number*=1, selector:text");
    // * AND a default here too, now that the hole's diameter declares one
    if (hole != nullptr) {
      CHECK_EQ_STR(hole->parameters,
                   "diameter:number*=6, x:number, y:number, z:number, depth:number");
    }
    // * and NO default: required, and an interactive caller must prompt. Together
    // with file.open that is the whole remaining population of this shape --
    // ui/test/keymap_audit_test.cpp pins the list.
    const ToolEntry* editEntry = c.find("part.edit_feature");
    CHECK(editEntry != nullptr);
    if (editEntry != nullptr) {
      CHECK_EQ_STR(editEntry->parameters, "feature:number=0, index:number=0, value:number*");
    }
    if (loft != nullptr) CHECK_EQ_STR(loft->parameters, "ruled:flag, open:flag");
    if (fit != nullptr) CHECK_EQ_STR(fit->parameters, "-");

    // describeParameters is the same function the panel prints, called directly.
    const CommandDescriptor* cbore = reg.find("part.counterbore");
    CHECK(cbore != nullptr);
    if (cbore != nullptr) {
      CHECK_EQ_STR(describeParameters(*cbore),
                   "diameter:number*=6, cbore_diameter:number*=11, cbore_depth:number*=6, "
                   "x:number, y:number, z:number");
    }
  }

  // ── 6. the query filter is the palette's matcher, not a second one ────────
  {
    const std::vector<std::string> hits = reg.search("fillet", reg.size());
    const ToolCatalog c = buildToolCatalog(reg, shell.selection(), "fillet");
    CHECK_EQ_INT(c.size(), hits.size());
    CHECK_EQ_INT(c.size(), 2);  // part.fillet + part.variable_fillet
    for (const ToolEntry& e : c.entries) {
      bool found = false;
      for (const std::string& h : hits) found = found || h == e.id;
      CHECK(found);
    }
    CHECK(c.find("part.fillet") != nullptr);
    CHECK(c.find("part.variable_fillet") != nullptr);
    CHECK(c.find("model.fillet") == nullptr);  // the counter stub is retired
    CHECK(c.find("view.fit") == nullptr);
    // Uncapped: the palette shows the top 14, the catalog must show them all.
    const ToolCatalog wide = buildToolCatalog(reg, shell.selection(), "p");
    CHECK_EQ_INT(wide.size(), reg.search("p", reg.size()).size());
    CHECK(wide.size() > 14);

    const ToolCatalog nothing = buildToolCatalog(reg, shell.selection(), "no_such_token");
    CHECK_EQ_INT(nothing.size(), 0);
    CHECK_EQ_INT(nothing.categories.size(), 0);
    CHECK_EQ_INT(nothing.available, 0);
    CHECK_EQ_INT(nothing.needsSelection, 0);
  }

  // ── 7. an empty registry produces an empty catalog, not a crash ───────────
  {
    CommandRegistry bare;
    SelectionService sel;
    const ToolCatalog c = buildToolCatalog(bare, sel);
    CHECK_EQ_INT(c.size(), 0);
    CHECK(c.find("anything") == nullptr);
    const ToolCatalog q = buildToolCatalog(bare, sel, "fillet");
    CHECK_EQ_INT(q.size(), 0);
  }

  // ── 8. the availability names are stable strings a panel prints ───────────
  {
    CHECK_EQ_STR(toString(ToolAvailability::Available), "available");
    CHECK_EQ_STR(toString(ToolAvailability::NeedsSelection), "needs selection");
    CHECK_EQ_STR(toString(ToolAvailability::NeedsParameters), "needs parameters");
    CHECK_EQ_STR(toString(ToolAvailability::Disabled), "disabled");
    CHECK_EQ_STR(toString(ToolAvailability::Unavailable), "unavailable");
  }

  return H.finish();
}
