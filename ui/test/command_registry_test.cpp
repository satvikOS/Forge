// ui/test/command_registry_test.cpp
//
// CONTRACT 1 — one command registry:
//   * a command is resolvable by its STABLE ID,
//   * its ENABLED PREDICATE gates execution,
//   * its REQUIRED SELECTION SIGNATURE is enforced,
//   * its required parameters are enforced,
//   * and the menu's grey-out answer (evaluate) is the SAME answer dispatch uses.
// Each of these fails loudly if the gate is removed.
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::at;
using forge::uitest::Harness;

namespace {

EntityRef edgeRef(const std::string& name) {
  return EntityRef{"body_1", EntityKind::Edge, name, 1};
}
EntityRef faceRef(const std::string& name) {
  return EntityRef{"body_1", EntityKind::Face, name, 1};
}

}  // namespace

int main() {
  Harness H("command_registry");

  CommandRegistry registry;
  SelectionService selection;

  std::size_t filletRuns = 0;
  std::size_t undoRuns = 0;
  bool undoAvailable = false;

  // ── registration ────────────────────────────────────────────────────────
  {
    CommandDescriptor c;
    c.id = "model.fillet";
    c.label = "Edge Fillet";
    c.category = "Model";
    c.featureIrOp = "FILLET";
    c.signature = SelectionSignature::atLeast(EntityKind::Edge, 1);
    c.schema.push_back(ParamSpec{"radius", ParamType::Number, true, 1.0, ""});
    c.execute = [&filletRuns](CommandContext&) { ++filletRuns; };
    CHECK(registry.add(std::move(c)));
  }
  {
    CommandDescriptor c;
    c.id = "edit.undo";
    c.label = "Undo";
    c.category = "Edit";
    c.enabled = [&undoAvailable](const CommandContext&) { return undoAvailable; };
    c.execute = [&undoRuns](CommandContext&) { ++undoRuns; };
    CHECK(registry.add(std::move(c)));
  }
  {
    CommandDescriptor c;
    c.id = "model.chamfer";
    c.label = "Chamfer";
    c.category = "Model";
    c.signature = SelectionSignature::exactly(EntityKind::Face, 2);
    c.execute = [](CommandContext&) {};
    CHECK(registry.add(std::move(c)));
  }
  CHECK_EQ_INT(registry.size(), 3);

  // A duplicate stable ID is REFUSED — two implementations behind one ID is the
  // exact failure a single registry exists to prevent.
  {
    CommandDescriptor dup;
    dup.id = "model.fillet";
    dup.label = "A Second Fillet";
    dup.execute = [](CommandContext&) {};
    CHECK(!registry.add(std::move(dup)));
  }
  CHECK_EQ_INT(registry.size(), 3);

  // A command with no handler cannot be registered — an ID that resolves to
  // nothing would grey in as available and then do nothing.
  {
    CommandDescriptor headless;
    headless.id = "model.nothing";
    CHECK(!registry.add(std::move(headless)));
  }
  CHECK_EQ_INT(registry.size(), 3);

  // ── resolvable by stable ID ─────────────────────────────────────────────
  CHECK(registry.contains("model.fillet"));
  CHECK(registry.find("model.does_not_exist") == nullptr);
  CHECK_EQ_STR(registry.find("model.fillet")->featureIrOp, "FILLET");
  CHECK_EQ_INT(static_cast<int>(registry.dispatch("model.nope", selection).status),
               static_cast<int>(DispatchStatus::UnknownCommand));

  // Deterministic, order-independent listing.
  const std::vector<std::string> ids = registry.ids();
  CHECK_EQ_INT(ids.size(), 3);
  CHECK_EQ_STR(at(ids, 0), "edit.undo");
  CHECK_EQ_STR(at(ids, 1), "model.chamfer");
  CHECK_EQ_STR(at(ids, 2), "model.fillet");

  // ── the enabled predicate GATES execution ───────────────────────────────
  undoAvailable = false;
  DispatchResult r = registry.dispatch("edit.undo", selection);
  CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_INT(undoRuns, 0);  // the handler must NOT have run
  CHECK_EQ_INT(registry.dispatchCount(), 0);

  undoAvailable = true;
  r = registry.dispatch("edit.undo", selection);
  CHECK(r.ok());
  CHECK_EQ_INT(undoRuns, 1);
  CHECK_EQ_INT(registry.dispatchCount(), 1);

  // The menu's answer and the dispatcher's answer come from one code path.
  undoAvailable = false;
  CHECK_EQ_INT(static_cast<int>(registry.evaluate("edit.undo", selection).status),
               static_cast<int>(DispatchStatus::Disabled));
  undoAvailable = true;
  CHECK(registry.evaluate("edit.undo", selection).ok());

  // ── the selection signature is ENFORCED ─────────────────────────────────
  CommandParams radius;
  radius.setNumber("radius", 2.5);

  // nothing selected
  r = registry.dispatch("model.fillet", selection, radius);
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  CHECK_EQ_INT(filletRuns, 0);

  // wrong KIND selected: a face is not an edge
  selection.add(faceRef("F1"));
  r = registry.dispatch("model.fillet", selection, radius);
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  CHECK_EQ_INT(filletRuns, 0);

  // right kind, right count
  selection.clearSelection();
  selection.add(edgeRef("E1"));
  selection.add(edgeRef("E2"));
  r = registry.dispatch("model.fillet", selection, radius);
  CHECK(r.ok());
  CHECK_EQ_INT(filletRuns, 1);

  // MIXED selection must not satisfy a homogeneous edge signature
  selection.add(faceRef("F1"));
  CHECK_EQ_INT(selection.count(), 3);
  r = registry.dispatch("model.fillet", selection, radius);
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  CHECK_EQ_INT(filletRuns, 1);  // unchanged

  // exact-count signature: 1 is too few, 2 is right, 3 is too many
  selection.clearSelection();
  selection.add(faceRef("F1"));
  CHECK_EQ_INT(static_cast<int>(registry.evaluate("model.chamfer", selection).status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  selection.add(faceRef("F2"));
  CHECK(registry.evaluate("model.chamfer", selection).ok());
  selection.add(faceRef("F3"));
  CHECK_EQ_INT(static_cast<int>(registry.evaluate("model.chamfer", selection).status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

  // ── required parameters are enforced ────────────────────────────────────
  selection.clearSelection();
  selection.add(edgeRef("E9"));
  r = registry.dispatch("model.fillet", selection, CommandParams{});
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::MissingRequiredParameter));
  CHECK_EQ_STR(r.detail, "radius");
  CHECK_EQ_INT(filletRuns, 1);  // still not run

  r = registry.dispatch("model.fillet", selection, radius);
  CHECK(r.ok());
  CHECK_EQ_INT(filletRuns, 2);

  // Gate ORDER is observable and deliberate: a selection mismatch is reported as
  // a selection mismatch even when a required parameter is also absent, so the
  // status a caller sees always names the first thing to fix.
  selection.clearSelection();
  r = registry.dispatch("model.fillet", selection, CommandParams{});
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

  // ── command palette search ──────────────────────────────────────────────
  const std::vector<std::string> hits = registry.search("fillet");
  CHECK_EQ_INT(hits.size(), 1);
  CHECK_EQ_STR(at(hits, 0), "model.fillet");
  CHECK_EQ_INT(registry.search("model.").size(), 2);
  CHECK_EQ_INT(registry.search("zzz").size(), 0);
  CHECK_EQ_INT(registry.search("").size(), 0);
  CHECK_EQ_INT(registry.search("UNDO").size(), 1);  // case-insensitive

  CHECK_EQ_INT(registry.categories().size(), 2);
  CHECK_EQ_INT(registry.idsInCategory("Model").size(), 2);

  // dispatchCount only ever counts commands that actually ran.
  CHECK_EQ_INT(registry.dispatchCount(), 1 + filletRuns);

  // ── CONTRACT 6 — a handler that RAN and refused must not report Ok ─────────
  // Every other DispatchStatus is decided BEFORE execute() is called. Without a
  // failure channel, dispatch returned Ok unconditionally once execution began, so a
  // command whose edit was rejected reported success and did nothing. MEASURED before
  // the fix: making the UI emit an unknown op name gave part.fillet -> Ok with its
  // statement absent from the document, caught only because the compiled solid's volume
  // equalled the un-filleted prism exactly. A status is not allowed to be that quiet.
  {
    CommandRegistry r2;
    CommandDescriptor refuses;
    refuses.id = "test.refuses";
    refuses.label = "Refuses";
    refuses.category = "Model";
    refuses.execute = [](CommandContext& c) { c.fail("the document refused the statement: BadStatementId"); };
    CHECK(r2.add(std::move(refuses)));

    CommandDescriptor accepts;
    accepts.id = "test.accepts";
    accepts.label = "Accepts";
    accepts.category = "Model";
    accepts.execute = [](CommandContext&) {};
    CHECK(r2.add(std::move(accepts)));

    SelectionService s2;
    const DispatchResult bad = r2.dispatch("test.refuses", s2, {});
    CHECK_EQ_INT(static_cast<int>(bad.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(!bad.ok());
    // The reason travels with the status: "something failed" is not actionable by a UI
    // or by Archie, so the detail must name what refused.
    CHECK_EQ_STR(bad.detail, "the document refused the statement: BadStatementId");

    // ...and a handler that does NOT fail still reports Ok, so the channel cannot be
    // stuck on. A check that can only go one way is not a check.
    const DispatchResult good = r2.dispatch("test.accepts", s2, {});
    CHECK_EQ_INT(static_cast<int>(good.status), static_cast<int>(DispatchStatus::Ok));
    CHECK(good.ok());
    CHECK_EQ_STR(good.detail, "");

    // Both RAN: a refusal is a dispatch, not a pre-flight rejection.
    CHECK_EQ_INT(r2.dispatchCount(), 2);
  }

  return H.finish();
}
