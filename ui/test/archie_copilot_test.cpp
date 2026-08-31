// ui/test/archie_copilot_test.cpp — the CoPilot's headless contract.
//
// What is asserted here is not "a plan came back". It is the four properties
// that make an agent surface safe to ship:
//
//   1. THE PLANNER IS DETERMINISTIC. Same text, same tools -> byte-identical
//      plan. A planner that drifts cannot be gated at all.
//   2. A DELIVERED PLAN IS UNTRUSTED. deliver() refuses an unknown command, an
//      op that disagrees with the command's own featureIrOp, an undeclared
//      parameter and a missing required one — because the thing on the far side
//      of that seam will one day be a model.
//   3. APPLY GOES THROUGH THE REGISTRY AND NOWHERE ELSE. The journal grows by
//      exactly the dispatched ids, the document's command-authored statements
//      match them one for one, and every op that reaches the document is an op
//      some registered command declares.
//   4. A REFUSAL IS A REFUSAL. A step that cannot resolve its selection, or that
//      the command's own enabled predicate rejects, stops the plan and is
//      reported by name — it does not half-apply.
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// The app's own starting document: a profile, and the solid that is its
// extrusion — seeded exactly as ForgeFrame::wirePartCommands() seeds them, so
// what this gate proves is what the application does.
struct Fixture {
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  std::size_t partCommands = 0;

  Fixture() {
    doc.seed(IrValueKind::Profile, "sketch.base", "RECT", {IrArg::num(80.0), IrArg::num(50.0)});
    doc.seed(IrValueKind::Solid, "body.bracket", "EXTRUDE",
             {IrArg::valueRef(1), IrArg::num(20.0)});
    partCommands = registerPartCommands(shell.registry(), doc, undo);
  }

  std::vector<PlanTool> tools() { return planTools(shell.registry(), shell.selection()); }
};

PlanResponse ask(Fixture& fx, ArchieCopilot& cp, const std::string& intent) {
  LocalPlanner planner;
  cp.submit(intent, fx.tools(), "nothing picked", "seeded");
  return planner.plan(cp.request());
}

std::string planText(const Plan& p) {
  std::string out = p.summary;
  for (const PlanStep& s : p.steps) {
    out += "\n";
    out += s.display();
    out += " | ";
    out += toString(s.select);
    out += " | ";
    out += s.note;
  }
  return out;
}

// The set of ops the LIVE registry can reach: every command's declared
// featureIrOp. Nothing else may appear in the document under a commandId.
bool opIsCommandReachable(const CommandRegistry& registry, const std::string& op) {
  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* d = registry.find(id);
    if (d != nullptr && !d->featureIrOp.empty() && d->featureIrOp == op) return true;
  }
  return false;
}

// ── 1. the local planner is deterministic and honest about its vocabulary ───
int testPlanner() {
  Harness H("archie_copilot:planner");
  Fixture fx;
  ArchieCopilot a;
  ArchieCopilot b;

  const PlanResponse ra = ask(fx, a, "extrude 20 then fillet 4");
  const PlanResponse rb = ask(fx, b, "extrude 20 then fillet 4");
  CHECK(ra.ok);
  CHECK(rb.ok);
  CHECK_EQ_STR(planText(ra.plan), planText(rb.plan));
  CHECK_EQ_INT(ra.plan.size(), 2);
  CHECK_EQ_STR(ra.plan.steps.empty() ? std::string() : ra.plan.steps[0].commandId,
               "part.extrude");
  CHECK_EQ_STR(ra.plan.steps.empty() ? std::string() : ra.plan.steps[0].irOp, "EXTRUDE");
  CHECK_EQ_STR(ra.plan.size() < 2 ? std::string() : ra.plan.steps[1].commandId, "part.fillet");
  CHECK_EQ_STR(ra.plan.size() < 2 ? std::string() : ra.plan.steps[1].irOp, "FILLET");

  // The numbers in the sentence reached the right parameters, and the step
  // selects the value the op consumes rather than "whatever is picked".
  if (ra.plan.size() == 2) {
    CHECK_EQ_INT(static_cast<int>(ra.plan.steps[0].select),
                 static_cast<int>(PlanSelect::LatestProfile));
    CHECK_EQ_INT(static_cast<int>(ra.plan.steps[1].select),
                 static_cast<int>(PlanSelect::LatestSolid));
    CHECK_NEAR(ra.plan.steps[0].params().number("distance").value_or(-1.0), 20.0, 1e-12);
    CHECK_NEAR(ra.plan.steps[1].params().number("radius").value_or(-1.0), 4.0, 1e-12);
  }

  // A unit suffix is a unit, not a different number.
  {
    ArchieCopilot c;
    const PlanResponse r = ask(fx, c, "shell 2.5mm");
    CHECK(r.ok);
    CHECK_EQ_INT(r.plan.size(), 1);
    if (r.plan.size() == 1) {
      CHECK_EQ_STR(r.plan.steps[0].commandId, "part.shell");
      CHECK_NEAR(r.plan.steps[0].params().number("thickness").value_or(-1.0), 2.5, 1e-12);
    }
  }

  // EVERY required parameter is stated, for every verb the planner knows. Apply
  // is the RAW dispatch path, so an unstated required parameter can never be
  // filled in later — this is the property that makes the plan runnable at all.
  for (const std::string& word : LocalPlanner::vocabulary()) {
    ArchieCopilot c;
    const PlanResponse r = ask(fx, c, word + " 3 4 5 6");
    CHECK(r.ok);
    for (const PlanStep& s : r.plan.steps) {
      const CommandDescriptor* d = fx.shell.registry().find(s.commandId);
      CHECK(d != nullptr);
      if (d == nullptr) continue;
      CHECK_EQ_INT(missingRequired(*d, s.params()).size(), 0);
      CHECK_EQ_STR(s.irOp, d->featureIrOp);
    }
  }

  // A request outside the vocabulary is REFUSED BY NAME, not answered with an
  // empty plan that reads like agreement.
  {
    ArchieCopilot c;
    const PlanResponse r = ask(fx, c, "make it look nicer please");
    CHECK(!r.ok);
    CHECK(!r.error.empty());
    CHECK(r.plan.empty());
  }
  return H.finish();
}

// ── 2. a delivered plan is validated against the LIVE registry ──────────────
int testValidation() {
  Harness H("archie_copilot:validation");
  Fixture fx;

  ArchieCopilot cp;
  const PlanResponse good = ask(fx, cp, "extrude 20");
  CHECK(good.ok);
  CHECK_EQ_INT(static_cast<int>(cp.deliver(good, fx.shell.registry())),
               static_cast<int>(PlanCheck::Ok));
  CHECK(cp.hasPlan());
  CHECK_EQ_INT(cp.plansAccepted(), 1);

  // Each of the four ways a plan can lie, refused by name.
  struct Case {
    const char* what;
    PlanCheck want;
  };
  const Case cases[] = {
      {"unknown command", PlanCheck::UnknownCommand},
      {"op mismatch", PlanCheck::OpMismatch},
      {"undeclared parameter", PlanCheck::UndeclaredParameter},
      {"missing required parameter", PlanCheck::MissingRequiredParameter},
  };
  for (const Case& c : cases) {
    ArchieCopilot bad;
    PlanResponse r = ask(fx, bad, "extrude 20");
    CHECK(r.ok && r.plan.size() == 1);
    if (!r.ok || r.plan.size() != 1) continue;
    switch (c.want) {
      case PlanCheck::UnknownCommand:
        r.plan.steps[0].commandId = "part.emboss";
        break;
      case PlanCheck::OpMismatch:
        r.plan.steps[0].irOp = "CUT";
        break;
      case PlanCheck::UndeclaredParameter:
        r.plan.steps[0].args.push_back(PlanArg::num("wall_thickness", 2.0));
        break;
      case PlanCheck::MissingRequiredParameter:
        r.plan.steps[0].args.clear();
        break;
      default:
        break;
    }
    const PlanCheck got = bad.deliver(r, fx.shell.registry());
    CHECK_EQ_STR(std::string(toString(got)) + " for " + c.what,
                 std::string(toString(c.want)) + " for " + c.what);
    CHECK(!bad.hasPlan());
    CHECK_EQ_INT(bad.plansRefused(), 1);
  }

  // A reply for a request that is not in flight is refused rather than shown.
  {
    ArchieCopilot stale;
    PlanResponse r = ask(fx, stale, "extrude 20");
    r.id += 99;
    CHECK_EQ_INT(static_cast<int>(stale.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::StaleResponse));
    CHECK(!stale.hasPlan());
  }

  // One ask per input line: a second submit while a request is in flight is
  // dropped, so a double press cannot queue two plans against one document.
  {
    ArchieCopilot busy;
    const std::uint64_t first = busy.submit("extrude 20", fx.tools(), "", "");
    const std::uint64_t second = busy.submit("fillet 4", fx.tools(), "", "");
    CHECK(first != 0);
    CHECK_EQ_INT(second, 0);
    CHECK_EQ_STR(busy.request().intent, "extrude 20");
  }

  // A blank line is not an intent.
  {
    ArchieCopilot blank;
    CHECK_EQ_INT(blank.submit("   \t ", fx.tools(), "", ""), 0);
    CHECK(!blank.requestPending());
  }
  return H.finish();
}

// ── 3. apply routes through the registry, and only through it ───────────────
int testApply() {
  Harness H("archie_copilot:apply");
  Fixture fx;
  ArchieCopilot cp;

  const std::size_t journalBefore = fx.shell.journal().size();
  const std::size_t recordsBefore = fx.doc.records().size();

  const PlanResponse r = ask(fx, cp, "extrude 20 then fillet 4 then shell 2");
  CHECK(r.ok);
  CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
               static_cast<int>(PlanCheck::Ok));
  CHECK_EQ_INT(cp.plan().size(), 3);

  const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
  CHECK_EQ_INT(out.requested, 3);
  CHECK_EQ_INT(out.applied, 3);
  CHECK(out.allOk());
  // The plan is CONSUMED: it was made against a document that has now moved.
  CHECK(!cp.hasPlan());

  // The journal grew by exactly the dispatched ids, in order. This is the whole
  // claim: the CoPilot went through ForgeShell::run like every other invoker.
  CHECK_EQ_INT(fx.shell.journal().size(), journalBefore + 3);
  const std::vector<std::string>& j = fx.shell.journal();
  CHECK_EQ_STR(forge::uitest::at(j, journalBefore + 0), "part.extrude");
  CHECK_EQ_STR(forge::uitest::at(j, journalBefore + 1), "part.fillet");
  CHECK_EQ_STR(forge::uitest::at(j, journalBefore + 2), "part.shell");

  // The document grew by exactly three statements, and every command-authored
  // statement names an op some registered command declares. A back door would
  // put an op here that no descriptor claims.
  CHECK_EQ_INT(fx.doc.records().size(), recordsBefore + 3);
  std::size_t authored = 0;
  for (const FeatureRecord& rec : fx.doc.records()) {
    if (rec.commandId.empty()) continue;  // a seed, deliberately unattributed
    ++authored;
    CHECK(opIsCommandReachable(fx.shell.registry(), rec.line.op));
    const CommandDescriptor* d = fx.shell.registry().find(rec.commandId);
    CHECK(d != nullptr);
    if (d != nullptr) CHECK_EQ_STR(rec.line.op, d->featureIrOp);
  }
  CHECK_EQ_INT(authored, 3);
  CHECK_EQ_INT(fx.doc.featureCount(), 3);

  // The emitted program is the one the ops imply, in order.
  CHECK_EQ_STR(fx.doc.irProgram(),
               "%1 = RECT(80, 50)\n"
               "%2 = EXTRUDE(%1, 20)\n"
               "%3 = EXTRUDE(%1, 20)\n"
               "%4 = FILLET(%3, 4, ALL)\n"
               "%5 = SHELL(%4, 2)\n");

  // Undo is real: the CoPilot's edits went onto the SAME stack a menu click uses.
  CHECK_EQ_INT(fx.undo.undoDepth(), 3);
  CHECK(fx.undo.undo(fx.doc));
  CHECK_EQ_INT(fx.doc.records().size(), recordsBefore + 2);
  return H.finish();
}

// ── 4. a refusal stops the plan and says which step and why ─────────────────
int testRefusal() {
  Harness H("archie_copilot:refusal");

  // A LOFT needs two profiles; the seeded document has one. The step must refuse
  // BEFORE dispatch, naming the shortfall, and nothing may be written.
  {
    Fixture fx;
    ArchieCopilot cp;
    const PlanResponse r = ask(fx, cp, "loft");
    CHECK(r.ok);
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::Ok));
    const std::size_t before = fx.doc.records().size();
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK_EQ_INT(out.applied, 0);
    CHECK(!out.allOk());
    CHECK_EQ_INT(out.steps.size(), 1);
    if (out.steps.size() == 1) {
      CHECK_EQ_INT(static_cast<int>(out.steps[0].dispatch.status),
                   static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
      CHECK(!out.steps[0].detail.empty());
    }
    CHECK_EQ_INT(fx.doc.records().size(), before);
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
  }

  // A plan STOPS at its first refusal: step 3 operates on what step 2 would have
  // made, so running it anyway would apply it to the wrong body. Here the
  // counterbore is refused by the command's own enabled predicate (a counterbore
  // narrower than its through-hole), and the fillet after it must not run.
  {
    Fixture fx;
    ArchieCopilot cp;
    LocalPlanner planner;
    cp.submit("extrude 20 then counterbore 30 then fillet 2", fx.tools(), "", "");
    PlanResponse r = planner.plan(cp.request());
    CHECK(r.ok);
    CHECK_EQ_INT(r.plan.size(), 3);
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::Ok));
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK_EQ_INT(out.requested, 3);
    CHECK_EQ_INT(out.applied, 1);
    CHECK_EQ_INT(out.steps.size(), 2);  // the third never ran
    if (out.steps.size() == 2) {
      CHECK(out.steps[0].ok());
      CHECK_EQ_INT(static_cast<int>(out.steps[1].dispatch.status),
                   static_cast<int>(DispatchStatus::Disabled));
    }
    CHECK_EQ_INT(fx.shell.journal().size(), 1);
    CHECK_EQ_INT(fx.doc.featureCount(), 1);
  }

  // An id the registry does not hold is refused AT THE DOOR even when it is
  // handed straight to applyPlan, which deliver() would never have passed.
  {
    Fixture fx;
    Plan forged;
    PlanStep step;
    step.commandId = "part.emboss";
    step.irOp = "EMBOSS";
    forged.steps.push_back(step);
    const ApplyOutcome out = applyPlan(forged, fx.shell, fx.doc);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(out.steps.size(), 1);
    if (out.steps.size() == 1) {
      CHECK_EQ_INT(static_cast<int>(out.steps[0].dispatch.status),
                   static_cast<int>(DispatchStatus::UnknownCommand));
    }
    CHECK_EQ_INT(fx.doc.records().size(), 2);  // the two seeds, untouched
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
  }

  // The selection FILTER still governs the CoPilot: it picks through the same
  // SelectionService a viewport click writes to, so a filter that refuses a
  // Sketch refuses the CoPilot too.
  {
    Fixture fx;
    ArchieCopilot cp;
    const PlanResponse r = ask(fx, cp, "extrude 20");
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::Ok));
    fx.shell.selection().setFilter(EntityKind::Edge);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
  }
  return H.finish();
}

// ── 5. the tool list handed to a planner is the LIVE registry ───────────────
int testTools() {
  Harness H("archie_copilot:tools");
  Fixture fx;
  const std::vector<PlanTool> tools = planTools(fx.shell.registry(), fx.shell.selection());
  CHECK_EQ_INT(tools.size(), fx.shell.registry().size());

  for (const PlanTool& t : tools) {
    const CommandDescriptor* d = fx.shell.registry().find(t.id);
    CHECK(d != nullptr);
    if (d == nullptr) continue;
    CHECK_EQ_STR(t.featureIrOp, d->featureIrOp);
    CHECK_EQ_INT(t.schema.size(), d->schema.size());
    // callableNow comes from the SAME evaluate() dispatch uses, so the two can
    // never disagree about a tool's availability.
    CommandParams probe;
    for (const ParamSpec& p : d->schema) {
      switch (p.type) {
        case ParamType::Number: probe.setNumber(p.name, p.defaultNumber); break;
        case ParamType::Text:   probe.setText(p.name, p.defaultText); break;
        case ParamType::Flag:   probe.setFlag(p.name, p.defaultNumber != 0.0); break;
      }
    }
    CHECK_EQ_INT(t.callableNow ? 1 : 0,
                 fx.shell.registry().evaluate(t.id, fx.shell.selection(), probe).ok() ? 1 : 0);
  }
  CHECK_EQ_INT(fx.partCommands, partCommandIds().size());
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testPlanner();
  rc |= testValidation();
  rc |= testApply();
  rc |= testRefusal();
  rc |= testTools();
  return rc;
}
