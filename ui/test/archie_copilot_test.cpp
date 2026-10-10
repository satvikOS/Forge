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
#include <unistd.h>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/ParameterSet.hpp"
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

  // The same document PLUS the two value kinds a profile and a solid cannot stand
  // in for. Seeded on demand rather than always, so the existing refusal cases
  // keep refusing for the reason they were written to test.
  void seedWiresAndSheets() {
    doc.seed(IrValueKind::Wire, "wire.a", "RING",
             {IrArg::num(20.0), IrArg::num(20.0), IrArg::num(0.0)});
    doc.seed(IrValueKind::Wire, "wire.b", "RING",
             {IrArg::num(12.0), IrArg::num(12.0), IrArg::num(30.0)});
    doc.seed(IrValueKind::Surface, "surface.a", "FACES",
             {IrArg::valueRef(2), IrArg::text("all")});
  }

  std::vector<PlanTool> tools() { return planTools(shell.registry(), shell.selection()); }
};

PlanResponse ask(Fixture& fx, ArchieCopilot& cp, const std::string& intent) {
  LocalPlanner planner;
  cp.submit(intent, fx.tools(), "nothing picked", "seeded", fx.doc.revision());
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
    CHECK_EQ_STR(std::string(machineName(got)) + " for " + c.what,
                 std::string(machineName(c.want)) + " for " + c.what);
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
    const std::uint64_t first = busy.submit("extrude 20", fx.tools(), "", "", fx.doc.revision());
    const std::uint64_t second = busy.submit("fillet 4", fx.tools(), "", "", fx.doc.revision());
    CHECK(first != 0);
    CHECK_EQ_INT(second, 0);
    CHECK_EQ_STR(busy.request().intent, "extrude 20");
  }

  // A blank line is not an intent.
  {
    ArchieCopilot blank;
    CHECK_EQ_INT(blank.submit("   \t ", fx.tools(), "", "", fx.doc.revision()), 0);
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

// ── the CoPilot must bind the kind the COMMAND consumes ─────────────────────
// A command that consumes a WIRE or a SURFACE was undrivable by the CoPilot, and
// the cause was one line: resolveSelection() chose between exactly two kinds,
//     want = (select == LatestProfile) ? Profile : Solid
// so a Wire- or Surface-signature command got a ref whose bodyId names a SOLID.
// resolveValues() then reads kindOf() through that node, gets Solid, returns {},
// and the command greys out -- a plan that reports a selection mismatch on a
// document that HOLDS exactly the value the step needed.
//
// This is the same defect D-023 records for part.loft itself ("part.loft was
// resolving PROFILE values"), left standing in the CoPilot's copy of the
// decision. The phrase table still said `{"loft", part.loft, LatestProfile}` and
// the old test above still called two wires "two profiles".
//
// The document below HOLDS two wires and a sheet, so a refusal here cannot be
// blamed on a missing value -- which is what makes this a measurement of the
// binder and not of the fixture.
int testValueKindBinding() {
  Harness H("archie_copilot:value-kind binding");

  struct Case {
    const char* intent;
    const char* commandId;
  };
  const Case cases[] = {
      {"loft", "part.loft"},         {"skin", "part.skin"},
      {"thicken", "part.thicken"},   {"cap", "part.cap"},
      {"sew", "part.sew"},           {"surfcheck", "part.surfcheck"},
      {"faces", "part.extract_faces"},
  };

  for (const Case& c : cases) {
    Fixture fx;
    fx.seedWiresAndSheets();
    ArchieCopilot cp;
    const PlanResponse r = ask(fx, cp, c.intent);
    CHECK(r.ok);
    if (!r.ok) continue;
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::Ok));
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    // The step must APPLY. Before the binder consulted the signature every one of
    // these came back SelectionSignatureMismatch on a document that held the value.
    CHECK_EQ_INT(out.applied, 1);
    CHECK(out.allOk());
    if (out.steps.size() == 1) {
      CHECK_EQ_STR(out.steps[0].commandId, c.commandId);
    }
  }

  return H.finish();
}

// ── 4. a refusal stops the plan and says which step and why ─────────────────
int testRefusal() {
  Harness H("archie_copilot:refusal");

  // A LOFT needs two WIRES -- not two profiles, which is what this comment said
  // while the binder could only ever ask for a profile or a solid. The seeded
  // document has NEITHER (one profile, one solid, no wire), so the step still
  // refuses; what changed is that it now refuses for the reason stated. The step
  // must refuse BEFORE dispatch, naming the shortfall, and nothing may be written.
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
    cp.submit("extrude 20 then counterbore 30 then fillet 2", fx.tools(), "", "", fx.doc.revision());
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
    const OpConstraintBridge bridge;
    const ApplyOutcome out = applyPlan(forged, fx.shell, fx.doc, bridge);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(out.steps.size(), 1);
    if (out.steps.size() == 1) {
      // The GATE stops it now, one door before dispatch, so the step never runs
      // at all -- which is a stronger statement than "dispatch said unknown".
      CHECK(out.steps[0].blocked());
      CHECK(!out.steps[0].ran);
      CHECK_EQ_INT(out.blocked, 1);
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

// -- 4b. THE OP-CONSTRAINT GATE, AND THE VALUE THAT HID BEHIND IT ------------
//
// Section 2 refuses a plan whose parameter NAME or TYPE is wrong. Neither reads
// what a parameter SAYS -- and `part.fillet` puts its `selector` TEXT parameter
// straight into a feature-IR argument, so a value is an emission path.
//
// What is proved here, in order:
//   a. a plan carrying a refused op inside a `selector` VALUE is refused, and
//      the verdict names WHICH constraint and WHY, per line;
//   b. the SAME plan with a legitimate selector is accepted and applies --
//      the positive control, without which (a) proves only that something is
//      broken;
//   c. a refused step is NEVER DISPATCHED: no journal entry, no document
//      record, and the registry's own dispatch counter does not move.
int testOpConstraintGate() {
  Harness H("archie_copilot:op_constraint");

  // One plan builder, so the accepted and the refused case differ in EXACTLY
  // one thing: the selector's value.
  const auto filletPlan = [](const std::string& selector) {
    Plan p;
    p.intent = "fillet the body";
    PlanStep step;
    step.commandId = "part.fillet";
    step.irOp = "FILLET";
    step.select = PlanSelect::LatestSolid;
    step.args.push_back(PlanArg::num("radius", 2.0));
    step.args.push_back(PlanArg::str("selector", selector));
    p.steps.push_back(std::move(step));
    p.summary = "1 op: FILLET";
    return p;
  };

  const OpConstraintBridge bridge;

  // -- b. THE POSITIVE CONTROL, FIRST ---------------------------------------
  // "VERTICAL" is one of the four bare keywords part.fillet emits, and it is a
  // value ui/src/PartCommands.cpp itself produces. It must pass, apply, and
  // reach the document.
  std::size_t appliedRecords = 0;
  {
    Fixture fx;
    const PlanVerdict v = validatePlan(filletPlan("VERTICAL"), fx.shell.registry(), bridge);
    if (!v.accepted()) std::printf("  [control] refused: %s", v.report().c_str());
    CHECK(v.accepted());
    CHECK_EQ_INT(v.refusedSteps(), 0);
    CHECK_EQ_INT(v.steps.size(), 1);
    if (v.steps.size() == 1) CHECK_EQ_STR(v.steps[0].irOp, "FILLET");

    const ApplyOutcome out = applyPlan(filletPlan("VERTICAL"), fx.shell, fx.doc, bridge);
    CHECK_EQ_INT(out.applied, 1);
    CHECK_EQ_INT(out.blocked, 0);
    CHECK_EQ_INT(fx.shell.journal().size(), 1);
    CHECK_EQ_INT(fx.doc.featureCount(), 1);
    appliedRecords = fx.doc.records().size();
    CHECK_EQ_INT(appliedRecords, 3);  // two seeds + the FILLET
  }

  // -- a. THE SAME PLAN, ONE VALUE CHANGED ----------------------------------
  // SLOT is a kernel op the vocabulary FORBIDS: no forge::ui command emits it.
  // Nothing else about this plan differs from the control above.
  {
    Fixture fx;
    const PlanVerdict v = validatePlan(filletPlan("SLOT"), fx.shell.registry(), bridge);
    CHECK(!v.accepted());
    CHECK_EQ_INT(static_cast<int>(v.check), static_cast<int>(PlanCheck::OpConstraintRefused));
    CHECK_EQ_INT(v.refusedSteps(), 1);
    // WHICH line, WHICH constraint, WHICH parameter, and why -- all four, because
    // "the plan was refused" is not something a user or a planner can act on.
    const StepVerdict* first = v.firstRefusal();
    CHECK(first != nullptr);
    if (first != nullptr) {
      CHECK_EQ_INT(first->index, 1);
      CHECK_EQ_STR(first->commandId, "part.fillet");
      CHECK_EQ_STR(first->irOp, "FILLET");
      CHECK_EQ_STR(first->parameter, "selector");
      CHECK_EQ_INT(static_cast<int>(first->constraint),
                   static_cast<int>(OpConstraint::ForbiddenOpInArgument));
      CHECK(first->reason.find("SLOT") != std::string::npos);
      // The refusal quotes the vocabulary's own words rather than paraphrasing.
      CHECK(first->reason.find("no command in Forge produces it") !=
            std::string::npos);
      // ...and the rendered row a panel prints carries all of it.
      const std::string row = first->display();
      CHECK(row.find("forbidden_op_in_argument") != std::string::npos);
      CHECK(row.find("selector") != std::string::npos);
      CHECK(row.find("FILLET") != std::string::npos);
    }

    // -- c. AND IT IS NEVER EXECUTED ----------------------------------------
    const std::size_t dispatchesBefore = fx.shell.registry().dispatchCount();
    const ApplyOutcome out = applyPlan(filletPlan("SLOT"), fx.shell, fx.doc, bridge);
    CHECK_EQ_INT(out.requested, 1);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(out.blocked, 1);
    CHECK_EQ_INT(out.steps.size(), 1);
    if (out.steps.size() == 1) {
      CHECK(out.steps[0].blocked());
      CHECK(!out.steps[0].ran);          // it never reached ForgeShell::run
      CHECK(!out.steps[0].ok());
      CHECK_EQ_INT(static_cast<int>(out.steps[0].constraint),
                   static_cast<int>(OpConstraint::ForbiddenOpInArgument));
    }
    // FOUR independent observables, because one of them alone can be true for
    // the wrong reason: an empty journal would also follow from a plan that was
    // never handed over at all.
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
    CHECK_EQ_INT(fx.doc.featureCount(), 0);
    CHECK_EQ_INT(fx.doc.records().size(), 2);  // the two seeds, untouched
    CHECK_EQ_INT(fx.shell.registry().dispatchCount() - dispatchesBefore, 0);
    // And the control DID move all of them, so the four are not simply inert.
    CHECK(appliedRecords > fx.doc.records().size());
    // The summary says the step was not built, and says it WITHOUT naming the
    // internal gate, the command id or the constraint's enum spelling -- it is
    // spoken into the CoPilot transcript, which is a conversation surface.
    CHECK(out.summary().find("was not something Forge could build") != std::string::npos);
    CHECK(out.summary().find("OP-CONSTRAINT") == std::string::npos);
    CHECK(out.summary().find("part.") == std::string::npos);
  }

  // -- the injection form: a value that carries a whole further STATEMENT ----
  // `IrLine::text()` escapes nothing and forge::ft reads statements line by
  // line, so a selector holding a quote and a newline is not a selector.
  {
    Fixture fx;
    const std::string smuggler = "ALL\")\n%4 = SLOT(50, 20)\n#";
    const PlanVerdict v = validatePlan(filletPlan(smuggler), fx.shell.registry(), bridge);
    CHECK(!v.accepted());
    const StepVerdict* first = v.firstRefusal();
    CHECK(first != nullptr);
    if (first != nullptr) {
      CHECK_EQ_INT(static_cast<int>(first->constraint),
                   static_cast<int>(OpConstraint::MalformedArgumentValue));
      CHECK_EQ_STR(first->parameter, "selector");
    }
    const ApplyOutcome out = applyPlan(filletPlan(smuggler), fx.shell, fx.doc, bridge);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(out.blocked, 1);
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
    CHECK_EQ_INT(fx.doc.records().size(), 2);
  }

  // -- the whole surface: deliver() refuses it too, and SHOWS why ------------
  // A user pressing Send must see the refusal, not an empty panel.
  {
    Fixture fx;
    ArchieCopilot cp;
    cp.submit("fillet the body", fx.tools(), "nothing picked", "seeded", fx.doc.revision());
    PlanResponse r;
    r.id = cp.request().id;
    r.ok = true;
    r.plan = filletPlan("SLOT");
    const PlanCheck got = cp.deliver(r, fx.shell.registry());
    CHECK_EQ_INT(static_cast<int>(got), static_cast<int>(PlanCheck::OpConstraintRefused));
    CHECK(!cp.hasPlan());          // there is nothing to accept
    CHECK_EQ_INT(cp.plansRefused(), 1);
    CHECK_EQ_INT(cp.plansAccepted(), 0);
    // ...but the verdict is KEPT, so the panel can render the refusal per line.
    CHECK_EQ_INT(cp.verdict().steps.size(), 1);
    CHECK_EQ_INT(cp.verdict().refusedSteps(), 1);
    CHECK(cp.verdict().report().find("forbidden_op_in_argument") != std::string::npos);
    // The transcript names WHICH constraint, not just "refused" -- but in the
    // words userText gives it. The enum spelling stays in report(), asserted
    // three lines above, which is what a gate and a log read.
    bool said = false;
    bool leaked = false;
    for (const TranscriptLine& line : cp.transcript()) {
      if (line.text.find(userText(OpConstraint::ForbiddenOpInArgument)) != std::string::npos) {
        said = true;
      }
      if (line.text.find("forbidden_op_in_argument") != std::string::npos) leaked = true;
    }
    CHECK(said);
    CHECK(!leaked);
    // Applying now does nothing: there is no plan on offer.
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK_EQ_INT(out.requested, 0);
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
  }

  // -- ACCEPT and REJECT, the two things a user may do -----------------------
  {
    Fixture fx;
    ArchieCopilot cp;
    cp.submit("fillet the body", fx.tools(), "nothing picked", "seeded", fx.doc.revision());
    PlanResponse r;
    r.id = cp.request().id;
    r.ok = true;
    r.plan = filletPlan("VERTICAL");
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::Ok));
    CHECK(cp.hasPlan());
    CHECK_EQ_INT(cp.verdict().steps.size(), 1);
    CHECK(cp.verdict().accepted());

    // REJECT: the offer goes away and NOTHING is dispatched.
    cp.discardPlan();
    CHECK(!cp.hasPlan());
    CHECK_EQ_INT(cp.plansRejectedByUser(), 1);
    CHECK_EQ_INT(fx.shell.journal().size(), 0);
    CHECK_EQ_INT(fx.doc.featureCount(), 0);

    // ACCEPT: a second offer, applied.
    cp.submit("fillet the body", fx.tools(), "nothing picked", "seeded", fx.doc.revision());
    PlanResponse r2;
    r2.id = cp.request().id;
    r2.ok = true;
    r2.plan = filletPlan("VERTICAL");
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r2, fx.shell.registry())),
                 static_cast<int>(PlanCheck::Ok));
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK_EQ_INT(out.applied, 1);
    CHECK_EQ_INT(cp.stepsApplied(), 1);
    CHECK_EQ_INT(cp.stepsBlocked(), 0);
    CHECK_EQ_INT(fx.doc.featureCount(), 1);
    CHECK(!cp.hasPlan());  // the plan is CONSUMED: the document has moved
  }

  // -- the app's OWN emitted values are not refused --------------------------
  // A gate that refuses the product's own output is a bug, so the four selector
  // keywords part.fillet emits and a real quoted face selector are all checked.
  {
    Fixture fx;
    for (const char* sel : {"ALL", "VERTICAL", "RIM", "CONVEX", "bore:r=6", "hole:at=21.75,0"}) {
      const PlanVerdict v = validatePlan(filletPlan(sel), fx.shell.registry(), bridge);
      if (!v.accepted()) std::printf("  [regression] selector %s refused: %s", sel,
                                     v.report().c_str());
      CHECK(v.accepted());
    }
  }

  return H.finish();
}

// ── 5. the tool list handed to a planner is the LIVE registry ───────────────
int testTools() {
  Harness H("archie_copilot:tools");
  Fixture fx;
  const std::vector<PlanTool> tools = planTools(fx.shell.registry(), fx.shell.selection());
  // Every command the undo stack can revert, and none it cannot (T-181): file I/O,
  // export, undo/redo, app and view commands are not edits a planner may propose.
  std::size_t plannable = 0;
  for (const std::string& id : fx.shell.registry().ids()) {
    const CommandDescriptor* d = fx.shell.registry().find(id);
    if (d != nullptr && d->undo != UndoContract::NotUndoable) ++plannable;
  }
  CHECK_EQ_INT(tools.size(), plannable);
  CHECK(plannable < fx.shell.registry().size());   // the filter is not vacuous here

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

// ── T-181: a plan is an edit OF ONE DOCUMENT, and only an edit ─────────────
// Two silent-mutation paths, both reachable from a model reply before this:
//   1. the plan was not bound to a document revision, so an answer that arrived
//      after the user edited the part (a 30B model takes ~20 s) was applied to a
//      document it was never made for;
//   2. any registry command could be named, including file.export_stl with a path,
//      file.new and edit.undo -- writes outside the document and history rewrites
//      that the plan's own rollback cannot take back.
int testPlanBinding() {
  Harness H("archie_copilot:t181");
  const auto filletPlan = []() {
    Plan p;
    p.intent = "fillet the body";
    PlanStep step;
    step.commandId = "part.fillet";
    step.irOp = "FILLET";
    step.select = PlanSelect::LatestSolid;
    step.args.push_back(PlanArg::num("radius", 2.0));
    step.args.push_back(PlanArg::str("selector", "VERTICAL"));
    p.steps.push_back(std::move(step));
    p.summary = "1 op: FILLET";
    return p;
  };

  // -- the revision itself ---------------------------------------------------
  {
    PartDocument a;
    PartDocument b;
    CHECK(a.revision() != b.revision());          // unique across documents
    const std::uint64_t r0 = a.revision();
    CHECK(a.seed(IrValueKind::Profile, "s", "RECT", {IrArg::num(10.0), IrArg::num(5.0)}) != 0);
    CHECK(a.revision() != r0);                    // an append is a new state
    const std::uint64_t r1 = a.revision();
    const PartDocument::Snapshot one = a.snapshot();
    CHECK(a.revision() == r1);                    // a snapshot is not a mutation
    PartDocument::Snapshot named = one;           // NAMING an existing value...
    named.bindings["pick_1"] = 1;
    a.restore(named);
    CHECK(a.revision() == r1);                    // ...is not a new state (ForgeFrame does it every frame)
    CHECK(a.seed(IrValueKind::Profile, "t", "RECT", {IrArg::num(4.0), IrArg::num(2.0)}) != 0);
    const std::uint64_t r1b = a.revision();
    a.restore(one);                               // UNDO: records cut back
    CHECK(a.revision() != r1b);                   // IS a new state
    const std::uint64_t r2 = a.revision();
    a.setParameters(a.parameters());              // the same parameters again
    CHECK(a.revision() == r2);                    // a no-op set is not a new state
    CHECK(!a.setMaterial(a.material()));          // a no-op is refused...
    CHECK(a.revision() == r2);                    // ...and does not invalidate a plan
  }

  // -- 1. the part changed after the ask: NOTHING is dispatched --------------
  {
    Fixture fx;
    ArchieCopilot cp;
    cp.submit("fillet the body", fx.tools(), "nothing picked", "seeded", fx.doc.revision());
    PlanResponse r;
    r.id = cp.request().id;
    r.ok = true;
    r.plan = filletPlan();
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())), static_cast<int>(PlanCheck::Ok));
    const std::size_t journalBefore = fx.shell.journal().size();
    const std::size_t featuresBefore = fx.doc.featureCount();
    // The user edits the part meanwhile: a new statement in the document.
    CHECK(fx.doc.seed(IrValueKind::Profile, "user.sketch", "RECT", {IrArg::num(5.0), IrArg::num(5.0)}) != 0);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK(out.staleDocument);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(fx.shell.journal().size(), journalBefore);
    CHECK_EQ_INT(fx.doc.featureCount(), featuresBefore);
    CHECK(!cp.hasPlan());                         // consumed: it was for another document
  }
  // ...and the control: the same sequence with no edit in between applies.
  {
    Fixture fx;
    ArchieCopilot cp;
    cp.submit("fillet the body", fx.tools(), "nothing picked", "seeded", fx.doc.revision());
    PlanResponse r;
    r.id = cp.request().id;
    r.ok = true;
    r.plan = filletPlan();
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())), static_cast<int>(PlanCheck::Ok));
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK(!out.staleDocument);
    CHECK_EQ_INT(out.applied, 1);
  }

  // -- 2. only edits the undo stack can take back ----------------------------
  {
    Fixture fx;
    // The shell's REAL file.export_stl, not a stand-in: the property is about
    // the command the application ships.
    const CommandDescriptor* real = fx.shell.registry().find("file.export_stl");
    CHECK(real != nullptr && real->undo == UndoContract::NotUndoable);
    const std::size_t journalBefore = fx.shell.journal().size();
    char path[] = "/tmp/archie_t181_export.XXXXXX";
    const int tmpfd = mkstemp(path);
    if (tmpfd >= 0) { close(tmpfd); std::remove(path); }   // a path that does not exist

    for (const PlanTool& t : fx.tools()) {
      const CommandDescriptor* d = fx.shell.registry().find(t.id);
      CHECK(d != nullptr && d->undo != UndoContract::NotUndoable);   // never offered
    }
    bool sawFillet = false;
    for (const PlanTool& t : fx.tools()) sawFillet = sawFillet || t.id == "part.fillet";
    CHECK(sawFillet);                             // part edits still are

    Plan bad;
    bad.intent = "save it";
    PlanStep step;
    step.commandId = "file.export_stl";
    step.args.push_back(PlanArg::str("path", path));
    bad.steps.push_back(step);
    bad.summary = "1 step";
    const OpConstraintBridge bridge;
    CHECK_EQ_INT(static_cast<int>(validatePlan(bad, fx.shell.registry(), bridge).check),
                 static_cast<int>(PlanCheck::NotPlannable));

    ArchieCopilot cp;
    cp.submit("save it", fx.tools(), "nothing picked", "seeded", fx.doc.revision());
    PlanResponse r;
    r.id = cp.request().id;
    r.ok = true;
    r.plan = bad;
    CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
                 static_cast<int>(PlanCheck::NotPlannable));
    CHECK(!cp.hasPlan());
    // The door refuses it too, for a caller that skipped deliver().
    const ApplyOutcome out = applyPlan(bad, fx.shell, fx.doc, bridge);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(fx.shell.journal().size(), journalBefore);   // nothing was dispatched
    CHECK(access(path, F_OK) != 0);                            // and nothing was written
  }
  return H.finish();
}

// ── 6. T-189: AN APPLIED PLAN IS ONE EDIT ────────────────────────────────────
// A user accepts a plan WHOLE. Before T-189 the undo stack held one record per
// step, so:
//   * one Undo after a 3-step plan left two of its steps in the part;
//   * the application's rollback of a failed plan undid one record per step that
//     REPORTED success -- so a step whose handler wrote and then refused stayed
//     in the part, and every step it did take back went onto the REDO branch,
//     where Redo put the half-plan back.
// Asserted here, through the same registry and undo stack the app uses:
//   a. a 3-step plan is ONE undo record ("the journal shows one transaction"),
//      ONE Undo restores the pre-plan document exactly, ONE Redo puts all three
//      back with their ids;
//   b. a fault injected at step 2 of 3 -- refused before writing, written THEN
//      refused, or thrown after writing -- leaves the document byte-identical to
//      before Apply AND the undo/redo history exactly as it was;
//   c. the same for a step the op-constraint gate blocks and a step the command's
//      own enabled predicate refuses (no injection);
//   d. a plan cannot run inside a transaction it does not own.

// EVERYTHING a document holds that a user or a file could see: every record (id,
// command, label, kind, statement), every name binding, the material and the
// parameters. The revision is NOT here: it moves on every mutation, a rollback
// included, and is not content.
std::string documentBytes(const PartDocument& doc) {
  std::string out;
  for (const FeatureRecord& r : doc.records()) {
    out += std::to_string(r.irId) + "|" + r.commandId + "|" + r.label + "|" +
           toString(r.produces) + "|" + r.line.text() + "\n";
  }
  for (const auto& kv : doc.snapshot().bindings) {
    out += "bind " + kv.first + "=" + std::to_string(kv.second) + "\n";
  }
  const Material& m = doc.material();
  out += "material " + m.id + "|" + m.name + "|" + std::to_string(m.densityKgPerM3) + "\n";
  for (const ParameterDef& p : doc.parameters().parameters()) {
    out += "param " + p.name + "=" + p.expression + "|" + p.comment + "\n";
  }
  for (const DimensionBinding& b : doc.parameters().bindings()) {
    out += "drive " + std::to_string(b.irId) + ":" + b.argument + ":" +
           std::to_string(b.slot) + "=" + b.expression + "\n";
  }
  return out;
}

enum class Fault : std::uint8_t {
  None,
  RefuseBeforeWrite,  // the handler refuses and writes nothing
  WriteThenRefuse,    // the handler's edit lands, THEN it refuses (dispatch != Ok)
  ThrowAfterWrite,    // the handler's edit lands, THEN it throws
  // The handler changes the document BEHIND the undo stack (a direct write no
  // UndoableEdit records), then refuses. No rollback can take that back -- the
  // case exists to prove `restored` is MEASURED: it must come back false here.
  WriteBehindStackThenRefuse,
};

// The app's own Part commands, through the shell's own registry -- with ONE
// handler wrapped to fail on cue. CommandRegistry::add refuses a duplicate id, so
// the commands are registered into a SOURCE registry first and copied across,
// the chosen one wrapped on the way: the registry under test never holds the
// unwrapped handler for that id. Every other command is the shipped one.
struct FaultFixture {
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  CommandRegistry source;
  std::size_t faultCalls = 0;

  FaultFixture(const std::string& faultId, Fault fault) {
    doc.seed(IrValueKind::Profile, "sketch.base", "RECT", {IrArg::num(80.0), IrArg::num(50.0)});
    doc.seed(IrValueKind::Solid, "body.bracket", "EXTRUDE",
             {IrArg::valueRef(1), IrArg::num(20.0)});
    registerPartCommands(source, doc, undo);
    for (const std::string& id : source.ids()) {
      CommandDescriptor d = *source.find(id);
      if (id == faultId && fault != Fault::None) {
        std::function<void(CommandContext&)> real = d.execute;
        d.execute = [this, real, fault](CommandContext& ctx) {
          ++faultCalls;
          if (fault == Fault::RefuseBeforeWrite) {
            ctx.fail("injected fault: refused before writing");
            return;
          }
          if (fault == Fault::WriteBehindStackThenRefuse) {
            const Material* ti = findMaterial("titanium-ti6al4v");
            if (ti != nullptr) doc.setMaterial(*ti);
            ctx.fail("injected fault: wrote behind the undo stack, then refused");
            return;
          }
          real(ctx);
          if (fault == Fault::WriteThenRefuse) {
            ctx.fail("injected fault: refused after its edit was recorded");
            return;
          }
          throw std::runtime_error("injected fault: threw after its edit was recorded");
        };
      }
      shell.registry().add(std::move(d));
    }
  }

  // A user's own history BEFORE the plan: two edits, the second undone, so the
  // stack holds one undo record AND one redo record. A plan that leaves either
  // side different from this has rewritten the user's history.
  void userHistory() {
    shell.selection().replaceWith({EntityRef{"body.bracket", EntityKind::Edge, "e1", 1}});
    CommandParams chamfer;
    chamfer.setNumber("distance", 1.0);
    chamfer.setText("selector", "VERTICAL");
    userEdits += shell.run("part.chamfer", chamfer).ok() ? 1 : 0;
    CommandParams sketch;
    sketch.setNumber("width", 10.0);
    sketch.setNumber("height", 6.0);
    shell.selection().clearSelection();
    userEdits += shell.run("part.sketch_rect", sketch).ok() ? 1 : 0;
    userEdits += undo.undo(doc) ? 1 : 0;
    shell.selection().clearSelection();
  }
  int userEdits = 0;
};

void planOnOffer(FaultFixture& fx, ArchieCopilot& cp, const std::string& intent, Harness& H) {
  LocalPlanner planner;
  cp.submit(intent, planTools(fx.shell.registry(), fx.shell.selection()), "nothing picked",
            "seeded", fx.doc.revision());
  const PlanResponse r = planner.plan(cp.request());
  CHECK(r.ok);
  CHECK_EQ_INT(static_cast<int>(cp.deliver(r, fx.shell.registry())),
               static_cast<int>(PlanCheck::Ok));
}

const char* const kThreeSteps = "extrude 20 then fillet 4 then shell 2";

// The document's owner, as the shell sees one: Ctrl+Z is `edit.undo` -> here, and
// every Document-side-effect dispatch calls documentChanged(), which is when the
// application re-derives its geometry. It records what the document read THE LAST
// TIME it was told to re-derive -- the picture the app would be showing.
struct RecordingHost final : DocumentHost {
  PartDocument& doc;
  UndoStack& undo;
  std::size_t changed = 0;
  std::string derivedFrom;
  RecordingHost(PartDocument& d, UndoStack& u) : doc(d), undo(u) {}
  bool documentNew(std::string& error) override { error = "test host"; return false; }
  bool documentReset(std::string& error) override { error = "test host"; return false; }
  bool documentOpen(const std::string&, std::string& error) override {
    error = "test host";
    return false;
  }
  bool documentSave(const std::string&, std::string& error) override {
    error = "test host";
    return false;
  }
  bool documentUndo() override {
    if (!undo.undo(doc)) return false;
    documentChanged();
    return true;
  }
  bool documentRedo() override {
    if (!undo.redo(doc)) return false;
    documentChanged();
    return true;
  }
  void documentChanged() override {
    ++changed;
    derivedFrom = documentBytes(doc);
  }
  std::size_t documentFeatureCount() const override { return doc.featureCount(); }
  std::size_t documentUndoDepth() const override { return undo.undoDepth(); }
  std::size_t documentRedoDepth() const override { return undo.redoDepth(); }
  bool documentDirty() const override { return false; }
  std::string documentPath() const override { return std::string(); }
  std::vector<std::string> documentBoundFiles() const override { return {}; }
};

int testPlanTransaction() {
  Harness H("archie_copilot:t189");

  // ── a. ONE RECORD; ONE UNDO RESTORES; ONE REDO REPLAYS ─────────────────────
  {
    FaultFixture fx("", Fault::None);
    fx.userHistory();
    CHECK_EQ_INT(fx.userEdits, 3);
    CHECK_EQ_INT(fx.undo.undoDepth(), 1);
    CHECK_EQ_INT(fx.undo.redoDepth(), 1);
    const std::string userUndoLabel = fx.undo.undoLabel();
    const std::string before = documentBytes(fx.doc);
    const std::size_t journalBefore = fx.shell.journal().size();

    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK(out.transaction);
    CHECK(out.allOk());
    CHECK_EQ_INT(out.applied, 3);
    CHECK(!out.rolledBack);
    CHECK_EQ_INT(out.undoRecords, 1);
    CHECK(!fx.undo.groupOpen());

    // THE JOURNAL SHOWS ONE TRANSACTION: three dispatches went through the one
    // door (the shell's journal lists each, unchanged contract) and the undo
    // history -- the record of what can be taken back -- gained exactly ONE
    // record, named for the plan the user accepted.
    CHECK_EQ_INT(fx.shell.journal().size(), journalBefore + 3);
    CHECK_EQ_INT(fx.undo.undoDepth(), 2);
    CHECK_EQ_STR(fx.undo.undoLabel(), std::string("Archie: ") + kThreeSteps);
    CHECK_EQ_INT(fx.undo.redoDepth(), 0);   // a new edit abandons redo, once
    const std::string after = documentBytes(fx.doc);
    CHECK(after != before);
    CHECK_EQ_INT(fx.doc.records().size(), 6);  // 2 seeds + the user's chamfer + 3

    // ONE Undo: the pre-plan document, byte for byte -- and the user's own
    // chamfer, which is not the plan's, is still there.
    CHECK(fx.undo.undo(fx.doc));
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_INT(fx.undo.undoDepth(), 1);
    CHECK_EQ_STR(fx.undo.undoLabel(), userUndoLabel);
    // ONE Redo: all three, with the ids they had.
    CHECK_EQ_INT(fx.undo.redoDepth(), 1);
    CHECK(fx.undo.redo(fx.doc));
    CHECK_EQ_STR(documentBytes(fx.doc), after);
    CHECK(fx.undo.undo(fx.doc));
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    // The panel counted three steps applied and said so.
    CHECK_EQ_INT(cp.stepsApplied(), 3);
    CHECK(cp.lastOutcome().transaction);
  }

  // ── b. A FAULT AT STEP 2 OF 3, THREE WAYS ──────────────────────────────────
  struct FaultCase {
    Fault fault;
    const char* name;
    std::size_t reverted;  // edits the rollback must revert: step 1, plus step 2's own write
  };
  const FaultCase faults[] = {
      {Fault::RefuseBeforeWrite, "refuse before write", 1},
      {Fault::WriteThenRefuse, "write then refuse", 2},
      {Fault::ThrowAfterWrite, "throw after write", 2},
  };
  for (const FaultCase& fc : faults) {
    std::printf("  [t189] fault at step 2 of 3: %s\n", fc.name);
    FaultFixture fx("part.fillet", fc.fault);
    fx.userHistory();
    CHECK_EQ_INT(fx.userEdits, 3);
    const std::string before = documentBytes(fx.doc);
    const std::size_t undoBefore = fx.undo.undoDepth();
    const std::size_t redoBefore = fx.undo.redoDepth();
    const std::string undoLabel = fx.undo.undoLabel();
    const std::string redoLabel = fx.undo.redoLabel();
    CHECK_EQ_INT(undoBefore, 1);
    CHECK_EQ_INT(redoBefore, 1);

    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const std::size_t faultCallsBefore = fx.faultCalls;
    ApplyOutcome out;
    bool threw = false;
    try {
      out = cp.apply(fx.shell, fx.doc, fx.undo);
    } catch (const std::runtime_error& e) {
      threw = true;
      CHECK(std::string(e.what()).find("injected fault") != std::string::npos);
    }
    CHECK_EQ_INT(threw ? 1 : 0, fc.fault == Fault::ThrowAfterWrite ? 1 : 0);
    CHECK(!cp.hasPlan());   // consumed, thrown or not: a failed plan is not offered again
    CHECK_EQ_INT(fx.faultCalls, faultCallsBefore + 1);   // step 2 really ran

    // THE ACCEPTANCE: the document is byte-identical to before Apply...
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    // ...and so is the history: nothing pushed, nothing lost, nothing on redo
    // that the user did not put there.
    CHECK_EQ_INT(fx.undo.undoDepth(), undoBefore);
    CHECK_EQ_INT(fx.undo.redoDepth(), redoBefore);
    CHECK_EQ_STR(fx.undo.undoLabel(), undoLabel);
    CHECK_EQ_STR(fx.undo.redoLabel(), redoLabel);
    CHECK(!fx.undo.groupOpen());
    // The user's Redo still brings back THEIR edit, and not a step of the plan.
    CHECK(fx.undo.redo(fx.doc));
    CHECK(fx.doc.lastFeature() != nullptr &&
          fx.doc.lastFeature()->commandId == "part.sketch_rect");
    CHECK(fx.undo.undo(fx.doc));
    CHECK_EQ_STR(documentBytes(fx.doc), before);

    if (!threw) {
      CHECK(out.transaction);
      CHECK(out.rolledBack);
      CHECK(out.restored);
      CHECK_EQ_INT(out.undoRecords, 0);
      CHECK_EQ_INT(out.applied, 1);                // how far it got...
      CHECK_EQ_INT(out.revertedEdits, fc.reverted);  // ...and what was taken back
      CHECK_EQ_INT(out.steps.size(), 2);           // step 3 never ran
      if (out.steps.size() == 2) {
        CHECK_EQ_INT(static_cast<int>(out.steps[1].dispatch.status),
                     static_cast<int>(DispatchStatus::EditRefused));
      }
      CHECK_EQ_INT(cp.stepsApplied(), 0);          // nothing of it is in the part
      // The transcript says what happened in words, and does not claim the steps
      // before the failure are still applied.
      const std::string said = cp.transcript().empty() ? std::string()
                                                        : cp.transcript().back().text;
      CHECK(said.find("your part is as it was") != std::string::npos);
      CHECK(said.find("still applied") == std::string::npos);
      CHECK(said.find("Applied 0 of 3") != std::string::npos);
    }
  }

  // ── a FAULT AT THE LAST STEP: two whole steps and the third's write go back ─
  {
    FaultFixture fx("part.shell", Fault::WriteThenRefuse);
    const std::string before = documentBytes(fx.doc);
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK(out.rolledBack);
    CHECK(out.restored);
    CHECK_EQ_INT(out.applied, 2);
    CHECK_EQ_INT(out.revertedEdits, 3);
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_INT(fx.undo.undoDepth(), 0);
    CHECK_EQ_INT(fx.undo.redoDepth(), 0);
  }

  // ── `restored` is MEASURED, not assumed ────────────────────────────────────
  // A handler that writes behind the stack leaves something no rollback can
  // revert. The outcome must then say the part does NOT read as it did, and the
  // panel must not tell the user it does.
  {
    FaultFixture fx("part.fillet", Fault::WriteBehindStackThenRefuse);
    const std::string before = documentBytes(fx.doc);
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK(out.rolledBack);
    CHECK_EQ_INT(out.revertedEdits, 1);           // step 1 was taken back...
    CHECK(!out.restored);                          // ...and the part still differs
    CHECK(documentBytes(fx.doc) != before);
    CHECK_EQ_STR(fx.doc.material().id, "titanium-ti6al4v");
    CHECK_EQ_INT(fx.doc.records().size(), 2);      // the statements are back to the seeds
    const std::string said = cp.transcript().empty() ? std::string()
                                                      : cp.transcript().back().text;
    CHECK(said.find("your part is as it was") == std::string::npos);
    CHECK(said.find("does not read as it did before") != std::string::npos);
  }

  // ── c. NO INJECTION: the command's own predicate, and the op-constraint gate ─
  // The counterbore narrower than its hole is refused by part.counterbore's own
  // enabled predicate (testRefusal measures it) -- a real step-2 failure.
  {
    FaultFixture fx("", Fault::None);
    const std::string before = documentBytes(fx.doc);
    ArchieCopilot cp;
    planOnOffer(fx, cp, "extrude 20 then counterbore 30 then fillet 2", H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK_EQ_INT(out.applied, 1);
    CHECK_EQ_INT(out.steps.size(), 2);
    if (out.steps.size() == 2) {
      CHECK_EQ_INT(static_cast<int>(out.steps[1].dispatch.status),
                   static_cast<int>(DispatchStatus::Disabled));
    }
    CHECK(out.rolledBack);
    CHECK(out.restored);
    CHECK_EQ_INT(out.revertedEdits, 1);
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_INT(fx.undo.undoDepth(), 0);
  }
  // A plan handed straight to the door whose step 2 the op-constraint gate
  // blocks: step 1 has already run when the gate stops step 2.
  {
    FaultFixture fx("", Fault::None);
    const std::string before = documentBytes(fx.doc);
    Plan p;
    p.intent = "extrude, then a fillet that smuggles a SLOT";
    PlanStep extrude;
    extrude.commandId = "part.extrude";
    extrude.irOp = "EXTRUDE";
    extrude.select = PlanSelect::LatestProfile;
    extrude.args.push_back(PlanArg::num("distance", 20.0));
    p.steps.push_back(extrude);
    PlanStep fillet;
    fillet.commandId = "part.fillet";
    fillet.irOp = "FILLET";
    fillet.select = PlanSelect::LatestSolid;
    fillet.args.push_back(PlanArg::num("radius", 2.0));
    fillet.args.push_back(PlanArg::str("selector", "SLOT"));
    p.steps.push_back(fillet);
    PlanStep shell;
    shell.commandId = "part.shell";
    shell.irOp = "SHELL";
    shell.select = PlanSelect::LatestSolid;
    shell.args.push_back(PlanArg::num("thickness", 2.0));
    p.steps.push_back(shell);
    const OpConstraintBridge bridge;
    const ApplyOutcome out = applyPlanAsOneEdit(p, fx.shell, fx.doc, fx.undo, bridge);
    CHECK_EQ_INT(out.applied, 1);
    CHECK_EQ_INT(out.blocked, 1);
    CHECK(out.rolledBack);
    CHECK(out.restored);
    CHECK_EQ_INT(out.revertedEdits, 1);
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_INT(fx.undo.undoDepth(), 0);
    CHECK_EQ_INT(fx.shell.journal().size(), 1);   // the extrude did dispatch
  }

  // ── e. THROUGH THE SHELL'S OWN UNDO, WITH A HOST THAT DERIVES GEOMETRY ─────
  // The application's Ctrl+Z is `edit.undo` through the shell to its document
  // host. ONE of them takes a 3-step plan back. And after a rolled-back plan the
  // host's LAST re-derivation must be of the restored document: every step that
  // dispatched OK told it the document had moved, so the rollback must tell it
  // too, or the viewport keeps drawing a part that is no longer the document.
  {
    FaultFixture fx("", Fault::None);
    RecordingHost host(fx.doc, fx.undo);
    fx.shell.setDocumentHost(&host);
    const std::string before = documentBytes(fx.doc);
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK(out.allOk());
    CHECK_EQ_INT(fx.shell.document().undoDepth, 1);   // what the status strip reads
    CHECK(fx.shell.run("edit.undo").ok());
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_STR(host.derivedFrom, before);
    CHECK_EQ_INT(fx.shell.document().undoDepth, 0);
    CHECK(fx.shell.run("edit.redo").ok());
    CHECK_EQ_INT(fx.doc.records().size(), 5);
    fx.shell.setDocumentHost(nullptr);
  }
  {
    FaultFixture fx("part.fillet", Fault::WriteThenRefuse);
    RecordingHost host(fx.doc, fx.undo);
    fx.shell.setDocumentHost(&host);
    const std::string before = documentBytes(fx.doc);
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const std::size_t changedBefore = host.changed;
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK(out.rolledBack);
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_INT(host.changed, changedBefore + 2);  // step 1's dispatch, then the rollback
    CHECK_EQ_STR(host.derivedFrom, before);         // the picture is the restored part
    CHECK_EQ_INT(fx.shell.document().undoDepth, 0);
    fx.shell.setDocumentHost(nullptr);
  }
  {
    // ...and when a handler THROWS, the host is told before the exception leaves.
    FaultFixture fx("part.fillet", Fault::ThrowAfterWrite);
    RecordingHost host(fx.doc, fx.undo);
    fx.shell.setDocumentHost(&host);
    const std::string before = documentBytes(fx.doc);
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    bool threw = false;
    try {
      cp.apply(fx.shell, fx.doc, fx.undo);
    } catch (const std::runtime_error&) {
      threw = true;
    }
    CHECK(threw);
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK_EQ_STR(host.derivedFrom, before);
    fx.shell.setDocumentHost(nullptr);
  }

  // ── d. NOT INSIDE A TRANSACTION IT DOES NOT OWN ─────────────────────────────
  {
    FaultFixture fx("", Fault::None);
    const std::string before = documentBytes(fx.doc);
    UndoTransaction outer(fx.undo, fx.doc, "someone else's edit");
    CHECK(outer.active());
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc, fx.undo);
    CHECK_EQ_INT(out.applied, 0);
    CHECK_EQ_INT(out.blocked, 3);
    CHECK(!out.transaction);
    CHECK_EQ_INT(fx.shell.journal().size(), 0);   // nothing dispatched
    CHECK_EQ_STR(documentBytes(fx.doc), before);
    CHECK(fx.undo.groupOpen());                   // and the owner's group is still open
    CHECK_EQ_INT(outer.rollback(), 0);
  }

  // ── the per-step form is unchanged: what ForgeFrame calls until it passes its
  //    stack. It records one undo step per step, and is NOT a transaction.
  {
    FaultFixture fx("", Fault::None);
    ArchieCopilot cp;
    planOnOffer(fx, cp, kThreeSteps, H);
    const ApplyOutcome out = cp.apply(fx.shell, fx.doc);
    CHECK(!out.transaction);
    CHECK_EQ_INT(out.applied, 3);
    CHECK_EQ_INT(fx.undo.undoDepth(), 3);
  }
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testPlanner();
  rc |= testValidation();
  rc |= testApply();
  rc |= testValueKindBinding();
  rc |= testRefusal();
  rc |= testOpConstraintGate();
  rc |= testTools();
  rc |= testPlanBinding();
  rc |= testPlanTransaction();
  return rc;
}
