// ui/test/archie_conversation_test.cpp — the conversation, and its approval flow.
//
// Six properties, and every one of them is a thing that could ship broken:
//
//   1. THE PER-STEP RULING IS validatePlan()'s RULING. Not a second
//      implementation that agrees today. The gate compares them row for row.
//   2. ACCEPT-ONE / REJECT-ONE / EDIT-THEN-ACCEPT DO WHAT THEY SAY, and an
//      edited value is judged by the SAME op-constraint check the planner's
//      value was — an injected op pasted into a selector must never dispatch.
//   3. THE GROUNDED PLANNER MEASURES. "Shrink the diameter of the largest bore
//      by 5 mm" becomes part.edit_feature against the statement that made that
//      bore, and the POSITIVE CONTROL is that the ungrounded planner answers the
//      same sentence differently — a null result here would mean the grounding
//      arm never ran.
//   4. ★A MODEL CANNOT APPROVE ITS OWN QUERY. proposeRetrieval() cannot produce
//      a ticket; approveRetrieval() refuses without an operator, without the
//      exact bytes having been shown, without the redaction diff having been
//      shown, and on a digest that is not the digest of what would be sent.
//   5. ★APPROVAL IS PER-QUERY AND NEVER STICKY. One ticket, one proposal, one
//      digest; a second approval of the same proposal fails and a later proposal
//      starts undecided.
//   6. ★A DECLINED SEARCH DOES NOT ABORT THE FEATURE TREE. The plan on offer is
//      byte-identical after a decline and still applies.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/ArchieConversation.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartInventory.hpp"
#include "forge/ui/SelectionService.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// The app's starting document, plus three real holes so the ground-truth edit
// has something measured to point at.
struct Fixture {
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;

  Fixture() {
    doc.seed(IrValueKind::Profile, "sketch.base", "RECT", {IrArg::num(120.0), IrArg::num(60.0)});
    doc.seed(IrValueKind::Solid, "body.plate", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(40.0)});
    doc.seed(IrValueKind::Solid, "body.h1", "HOLE",
             {IrArg::valueRef(2), IrArg::num(8.0), IrArg::num(0.0), IrArg::num(0.0),
              IrArg::num(0.0)});
    doc.seed(IrValueKind::Solid, "body.h2", "HOLE",
             {IrArg::valueRef(3), IrArg::num(12.0), IrArg::num(30.0), IrArg::num(0.0),
              IrArg::num(0.0)});
    doc.seed(IrValueKind::Solid, "body.h3", "HOLE",
             {IrArg::valueRef(4), IrArg::num(6.0), IrArg::num(-30.0), IrArg::num(0.0),
              IrArg::num(0.0)});
    registerPartCommands(shell.registry(), doc, undo);
  }
};

const char* kCensus =
    "{\"ok\":true,"
    "\"bores\":[{\"r\":4,\"span\":40,\"at\":[0,0,0],\"axis\":[0,0,1],\"faces\":1},"
    "{\"r\":6,\"span\":40,\"at\":[30,0,0],\"axis\":[0,0,1],\"faces\":1},"
    "{\"r\":3,\"span\":40,\"at\":[-30,0,0],\"axis\":[0,0,1],\"faces\":1}],"
    "\"census\":{\"faceCount\":9,\"kind_histogram\":{\"cylinder\":3,\"plane\":6},"
    "\"bbox\":{\"min\":[-60,-30,0],\"max\":[60,30,40]}}}";

// Runs one round trip through the seam: ask, plan with `planner`, deliver.
PlanCheck roundTrip(Fixture& fx, ArchieConversation& conv, Planner& planner,
                    const std::string& intent) {
  const std::uint64_t id = conv.ask(intent, fx.shell.registry(), fx.shell.selection(), fx.doc);
  if (id == 0) return PlanCheck::StaleResponse;
  const PlanResponse response = planner.plan(conv.request());
  return conv.deliver(response, fx.shell.registry(), "<<raw planner output for: " + intent + ">>");
}

// ── 1. the per-step ruling IS validatePlan()'s ruling ───────────────────────
int testOneRule() {
  Harness H("archie_conversation:one-rule");

  Fixture fx;
  ArchieConversation conv;
  LocalPlanner planner;

  CHECK(conv.ask("", fx.shell.registry(), fx.shell.selection(), fx.doc) == 0);
  CHECK(conv.turns().empty());

  const std::uint64_t id = conv.ask("extrude 20 then fillet 2", fx.shell.registry(),
                                    fx.shell.selection(), fx.doc);
  CHECK(id != 0);
  CHECK(conv.pending());
  // A second ask while one is in flight is refused, so a double-press cannot
  // queue two asks against one input line.
  CHECK(conv.ask("extrude 20", fx.shell.registry(), fx.shell.selection(), fx.doc) == 0);

  const PlanResponse response = planner.plan(conv.request());
  CHECK(response.ok);
  const PlanCheck check = conv.deliver(response, fx.shell.registry(), "RAW-TEXT");
  CHECK(check == PlanCheck::Ok);
  CHECK(!conv.pending());
  CHECK(conv.hasOffer());

  const PlanOffer& offer = conv.offer();
  CHECK_EQ_INT(offer.steps.size(), 2);
  CHECK_EQ_INT(offer.pending(), 2);
  CHECK_EQ_INT(offer.refusedByGate(), 0);

  // ★THE EQUALITY. Every row the conversation shows is the row validatePlan()
  // produces for the same plan, over the same bridge.
  const PlanVerdict direct = validatePlan(response.plan, fx.shell.registry(), conv.bridge());
  CHECK(direct.check == PlanCheck::Ok);
  CHECK_EQ_INT(direct.steps.size(), offer.steps.size());
  for (std::size_t i = 0; i < offer.steps.size() && i < direct.steps.size(); ++i) {
    CHECK_EQ_STR(offer.steps[i].verdict.commandId, direct.steps[i].commandId);
    CHECK_EQ_STR(offer.steps[i].verdict.irOp, direct.steps[i].irOp);
    CHECK(offer.steps[i].verdict.refused == direct.steps[i].refused);
    CHECK_EQ_INT(offer.steps[i].verdict.index, i + 1);
    CHECK(offer.steps[i].state == StepState::Pending);
    CHECK(!offer.steps[i].edited);
  }

  // TRANSPARENCY. What the planner was given, and what came back, both kept.
  CHECK_EQ_STR(conv.rawResponse(), "RAW-TEXT");
  const std::string& ctx = conv.contextGiven();
  CHECK(ctx.find("CONTEXT GIVEN TO THE PLANNER") != std::string::npos);
  CHECK(ctx.find("extrude 20 then fillet 2") != std::string::npos);
  CHECK(ctx.find("part.extrude") != std::string::npos);
  CHECK(ctx.find("SELECTION") != std::string::npos);
  CHECK(ctx.find("%1 = RECT") != std::string::npos);
  // The tool list is the LIVE registry's, with schemas and callability.
  CHECK(ctx.find("distance:Number") != std::string::npos);
  CHECK_EQ_INT(conv.request().tools.size(), fx.shell.registry().ids().size());

  // A stale reply is discarded and does not become an offer.
  PlanResponse stale = response;
  stale.id = 999;
  CHECK(conv.deliver(stale, fx.shell.registry()) == PlanCheck::StaleResponse);
  CHECK_EQ_INT(conv.offers().size(), 1);
  return H.finish();
}

// ── 2a. accept-all, accept-one, reject ──────────────────────────────────────
int testDispositions() {
  Harness H("archie_conversation:dispositions");

  {
    Fixture fx;
    ArchieConversation conv;
    LocalPlanner planner;
    CHECK(roundTrip(fx, conv, planner, "extrude 20 then fillet 2") == PlanCheck::Ok);

    const std::size_t before = fx.doc.records().size();
    const std::size_t journal = fx.shell.journal().size();
    const ApplyOutcome out = conv.acceptAll(fx.shell, fx.doc);
    CHECK_EQ_INT(out.requested, 2);
    CHECK_EQ_INT(out.applied, 2);
    CHECK_EQ_INT(conv.stepsApplied(), 2);
    CHECK_EQ_INT(fx.doc.records().size(), before + 2);
    CHECK_EQ_INT(fx.shell.journal().size(), journal + 2);
    CHECK_EQ_INT(conv.offer().pending(), 0);
    CHECK(!conv.hasOffer());
    for (const OfferStep& s : conv.offer().steps) CHECK(s.state == StepState::Applied);
    // Nothing left to accept, and saying so is not an error.
    const ApplyOutcome again = conv.acceptAll(fx.shell, fx.doc);
    CHECK_EQ_INT(again.requested, 0);
  }

  {
    // ACCEPT-ONE. Exactly one statement is added and exactly one id is
    // journalled; the other line stays pending and can still be ruled on.
    Fixture fx;
    ArchieConversation conv;
    LocalPlanner planner;
    CHECK(roundTrip(fx, conv, planner, "extrude 20 then fillet 2") == PlanCheck::Ok);

    const std::size_t before = fx.doc.records().size();
    const ApplyOutcome one = conv.acceptStep(0, fx.shell, fx.doc);
    CHECK_EQ_INT(one.requested, 1);
    CHECK_EQ_INT(one.applied, 1);
    CHECK_EQ_INT(fx.doc.records().size(), before + 1);
    CHECK(conv.offer().steps[0].state == StepState::Applied);
    CHECK(conv.offer().steps[1].state == StepState::Pending);
    CHECK_EQ_INT(conv.offer().pending(), 1);
    CHECK(conv.hasOffer());
    // A step already applied cannot be applied twice.
    const ApplyOutcome twice = conv.acceptStep(0, fx.shell, fx.doc);
    CHECK_EQ_INT(twice.requested, 0);
    CHECK_EQ_INT(fx.doc.records().size(), before + 1);

    // REJECT-ONE. The user said no; nothing ran and nothing failed.
    CHECK(conv.rejectStep(1, "I want a bigger radius first"));
    CHECK(conv.offer().steps[1].state == StepState::Rejected);
    CHECK_EQ_INT(conv.stepsRejected(), 1);
    CHECK_EQ_INT(conv.stepsFailed(), 0);
    CHECK_EQ_INT(fx.doc.records().size(), before + 1);
    CHECK(!conv.rejectStep(1));  // already ruled on
    CHECK(!conv.hasOffer());
  }

  {
    // REJECT-ALL rules on every pending line at once, and is recorded as the
    // user's decision rather than as a failure.
    Fixture fx;
    ArchieConversation conv;
    LocalPlanner planner;
    CHECK(roundTrip(fx, conv, planner, "extrude 20 then fillet 2") == PlanCheck::Ok);
    const std::size_t before = fx.doc.records().size();
    conv.rejectOffer("not what I meant");
    CHECK_EQ_INT(conv.stepsRejected(), 2);
    CHECK_EQ_INT(conv.offer().rejected(), 2);
    CHECK_EQ_INT(fx.doc.records().size(), before);
    CHECK_EQ_INT(conv.stepsApplied(), 0);
    const ApplyOutcome nothing = conv.acceptAll(fx.shell, fx.doc);
    CHECK_EQ_INT(nothing.requested, 0);
    CHECK(conv.transcript().find("not what I meant") != std::string::npos);
  }
  return H.finish();
}

// ── 2b. edit-then-accept, and the edited value is untrusted too ─────────────
int testEditing() {
  Harness H("archie_conversation:editing");

  {
    Fixture fx;
    ArchieConversation conv;
    LocalPlanner planner;
    CHECK(roundTrip(fx, conv, planner, "extrude 20") == PlanCheck::Ok);
    CHECK_EQ_INT(conv.offer().steps.size(), 1);

    std::string why;
    // A parameter the schema does not declare is refused BEFORE anything is
    // mutated: the step is unchanged and still acceptable.
    CHECK(!conv.editStep(0, "nosuchparam", PlanArg::num("nosuchparam", 3.0),
                         fx.shell.registry(), why));
    CHECK(why.find("declares no parameter") != std::string::npos);
    CHECK(!conv.offer().steps[0].edited);
    // The wrong TYPE is refused too, and says which type was declared.
    CHECK(!conv.editStep(0, "distance", PlanArg::str("distance", "twenty"),
                         fx.shell.registry(), why));
    CHECK(why.find("declared Number") != std::string::npos);
    CHECK(!conv.offer().steps[0].edited);

    CHECK(conv.editStep(0, "distance", PlanArg::num("distance", 35.0), fx.shell.registry(), why));
    CHECK_EQ_STR(why, "");
    CHECK(conv.offer().steps[0].edited);
    CHECK(!conv.offer().steps[0].verdict.refused);
    // The PROPOSED step is kept beside the edited one, so the panel can show
    // both and a reader can see what the model actually said.
    CHECK(conv.offer().steps[0].proposed.display() !=
          conv.offer().steps[0].current.display());

    const ApplyOutcome out = conv.acceptAll(fx.shell, fx.doc);
    CHECK_EQ_INT(out.applied, 1);
    const FeatureRecord* last = fx.doc.lastFeature();
    CHECK(last != nullptr);
    if (last != nullptr) {
      // THE EDITED VALUE IS WHAT RAN — 35, not the planner's 20.
      CHECK(last->line.text().find("35") != std::string::npos);
      CHECK(last->line.text().find("EXTRUDE") != std::string::npos);
    }
  }

  {
    // RESET puts the planner's own value back.
    Fixture fx;
    ArchieConversation conv;
    LocalPlanner planner;
    CHECK(roundTrip(fx, conv, planner, "extrude 20") == PlanCheck::Ok);
    std::string why;
    CHECK(conv.editStep(0, "distance", PlanArg::num("distance", 35.0), fx.shell.registry(), why));
    CHECK(conv.resetStep(0, fx.shell.registry(), why));
    CHECK(!conv.offer().steps[0].edited);
    CHECK_EQ_STR(conv.offer().steps[0].current.display(),
                 conv.offer().steps[0].proposed.display());
  }

  {
    // ★AN INJECTED OP PASTED INTO A SELECTOR. The edit is accepted as a
    // KEYSTROKE — refusing input is a capability gate — but the op-constraint
    // gate REFUSES the line, acceptStep refuses to dispatch it, and the journal
    // does not grow. Two doors, and the second one is applyPlan's own.
    Fixture fx;
    ArchieConversation conv;
    LocalPlanner planner;
    CHECK(roundTrip(fx, conv, planner, "fillet 2") == PlanCheck::Ok);
    CHECK(!conv.offer().steps[0].verdict.refused);

    std::string why;
    const std::string injected = "bore\"\n%9 = SWEEP(%1, %2)\n\"";
    CHECK(conv.editStep(0, "selector", PlanArg::str("selector", injected), fx.shell.registry(),
                        why));
    CHECK(conv.offer().steps[0].edited);
    CHECK(conv.offer().steps[0].verdict.refused);
    CHECK(conv.offer().steps[0].verdict.constraint == OpConstraint::MalformedArgumentValue);
    CHECK(!conv.offer().steps[0].acceptable());

    const std::size_t journal = fx.shell.journal().size();
    const std::size_t records = fx.doc.records().size();
    const ApplyOutcome refused = conv.acceptStep(0, fx.shell, fx.doc);
    CHECK_EQ_INT(refused.requested, 0);  // never even handed to applyPlan
    CHECK_EQ_INT(fx.shell.journal().size(), journal);
    CHECK_EQ_INT(fx.doc.records().size(), records);
    CHECK(conv.offer().steps[0].state == StepState::Pending);

    // accept-ALL hands it to applyPlan, which re-runs the gate at the door: the
    // step is BLOCKED and was never dispatched.
    const ApplyOutcome all = conv.acceptAll(fx.shell, fx.doc);
    CHECK_EQ_INT(all.requested, 1);
    CHECK_EQ_INT(all.applied, 0);
    CHECK_EQ_INT(all.blocked, 1);
    CHECK_EQ_INT(conv.stepsBlocked(), 1);
    CHECK_EQ_INT(fx.shell.journal().size(), journal);
    CHECK_EQ_INT(fx.doc.records().size(), records);
    CHECK(conv.offer().steps[0].state == StepState::Blocked);

    // A BARE KEYWORD that spells an op is a different fact and gets a different
    // verdict — the two are not collapsed into one "invalid".
    Fixture fx2;
    ArchieConversation conv2;
    LocalPlanner planner2;
    CHECK(roundTrip(fx2, conv2, planner2, "fillet 2") == PlanCheck::Ok);
    CHECK(conv2.editStep(0, "selector", PlanArg::str("selector", "SWEEP"), fx2.shell.registry(),
                         why));
    CHECK(conv2.offer().steps[0].verdict.refused);
    CHECK(conv2.offer().steps[0].verdict.constraint == OpConstraint::ForbiddenOpInArgument ||
          conv2.offer().steps[0].verdict.constraint == OpConstraint::OpNameInArgument);
  }
  return H.finish();
}

// ── 2c. a refused plan is still SHOWN, line by line ─────────────────────────
int testRefusedPlanIsShown() {
  Harness H("archie_conversation:refused-plan");

  Fixture fx;
  ArchieConversation conv;
  LocalPlanner planner;

  const std::uint64_t id = conv.ask("extrude 20 then fillet 2", fx.shell.registry(),
                                    fx.shell.selection(), fx.doc);
  CHECK(id != 0);
  PlanResponse response = planner.plan(conv.request());
  CHECK_EQ_INT(response.plan.steps.size(), 2);
  // Poison the FIRST step with a command the registry does not hold. Everything
  // after it is still a real step and still deserves a ruling.
  response.plan.steps[0].commandId = "part.not_a_command";
  const PlanCheck check = conv.deliver(response, fx.shell.registry());
  CHECK(check == PlanCheck::UnknownCommand);
  CHECK_EQ_INT(conv.plansRefused(), 1);

  // ★THE PLAN IS STILL ON THE TABLE, with a row for EVERY line — including the
  // second, which validatePlan() never reached because it returns early.
  CHECK_EQ_INT(conv.offers().size(), 1);
  const PlanOffer& offer = conv.offer();
  CHECK_EQ_INT(offer.steps.size(), 2);
  CHECK(offer.steps[0].verdict.refused);
  CHECK(offer.steps[0].verdict.reason.find("no such command") != std::string::npos);
  CHECK(!offer.steps[1].verdict.refused);
  CHECK(offer.check == PlanCheck::UnknownCommand);
  CHECK(offer.report().find("REFUSE") != std::string::npos);
  CHECK(offer.report().find("refused") != std::string::npos);

  // The refused line cannot be accepted; the good one still can. That is what
  // per-line rulings BUY — a whole-plan model would lose the second step.
  const std::size_t records = fx.doc.records().size();
  CHECK_EQ_INT(conv.acceptStep(0, fx.shell, fx.doc).requested, 0);
  CHECK_EQ_INT(fx.doc.records().size(), records);
  const ApplyOutcome good = conv.acceptStep(1, fx.shell, fx.doc);
  CHECK_EQ_INT(good.applied, 1);
  CHECK_EQ_INT(fx.doc.records().size(), records + 1);

  // A planner that FAILED is a different fact from a plan that was refused.
  ArchieConversation c2;
  CHECK(c2.ask("do a thing", fx.shell.registry(), fx.shell.selection(), fx.doc) != 0);
  PlanResponse failed;
  failed.id = c2.request().id;
  failed.ok = false;
  failed.error = "no model is configured";
  CHECK(c2.deliver(failed, fx.shell.registry()) == PlanCheck::PlannerFailed);
  CHECK(c2.offers().empty());
  CHECK(c2.transcript().find("no model is configured") != std::string::npos);

  // And a transport failure is a third fact.
  ArchieConversation c3;
  CHECK(c3.ask("extrude 20", fx.shell.registry(), fx.shell.selection(), fx.doc) != 0);
  c3.failRequest("the sidecar is not running");
  CHECK(!c3.pending());
  CHECK(c3.transcript().find("the sidecar is not running") != std::string::npos);
  return H.finish();
}

// ── 3. the grounded planner measures, and the arms differ ───────────────────
int testGrounding() {
  Harness H("archie_conversation:grounding");

  Fixture fx;
  ArchieConversation conv;
  std::string why;
  CHECK(conv.measureFrom(kCensus, why));
  CHECK_EQ_STR(why, "");
  CHECK(conv.inventory().measured);
  CHECK_EQ_INT(conv.inventory().bores.size(), 3);
  // A bad census does NOT wipe a good one.
  CHECK(!conv.measureFrom("{\"ok\":true}", why));
  CHECK_EQ_INT(conv.inventory().bores.size(), 3);

  const std::string intent = "shrink the diameter of the largest bore by 5 mm";

  // ★THE POSITIVE CONTROL. The ungrounded planner answers this sentence too —
  // it has a "bore" verb — and answers it WRONG, with part.hole(diameter=5).
  // If the two arms produced the same plan, this gate would be comparing the
  // grounding arm to itself.
  LocalPlanner bare;
  ArchieConversation control;
  CHECK(roundTrip(fx, control, bare, intent) == PlanCheck::Ok);
  CHECK_EQ_INT(control.offer().steps.size(), 1);
  CHECK_EQ_STR(control.offer().steps[0].current.commandId, "part.hole");

  LocalPlanner fallback;
  GroundedPlanner grounded(conv.inventory(), fx.doc, fallback);
  CHECK(roundTrip(fx, conv, grounded, intent) == PlanCheck::Ok);
  CHECK_EQ_INT(conv.offer().steps.size(), 1);
  const OfferStep& step = conv.offer().steps[0];
  CHECK_EQ_STR(step.current.commandId, "part.edit_feature");
  CHECK(!step.verdict.refused);
  CHECK(step.current.note.find("⌀12.000") != std::string::npos);
  CHECK(grounded.lastPhrase().recognised);
  CHECK(grounded.lastEdit().ok);
  CHECK_NEAR(grounded.lastEdit().toDiameter, 7.0, 1e-9);

  // The context the planner was handed carried the MEASUREMENT, not just the
  // sentence — that is what makes the answer grounded rather than guessed.
  CHECK(conv.contextGiven().find("MEASURED PART INVENTORY") != std::string::npos);
  CHECK(conv.contextGiven().find("[largest]") != std::string::npos);

  // APPLY IT. The statement that made the ⌀12 bore becomes ⌀7, through the same
  // registry every menu click goes through.
  const std::string before = fx.doc.records()[3].line.text();
  CHECK(before.find("12") != std::string::npos);
  const std::size_t journal = fx.shell.journal().size();
  const ApplyOutcome out = conv.acceptAll(fx.shell, fx.doc);
  CHECK_EQ_INT(out.applied, 1);
  CHECK_EQ_INT(fx.shell.journal().size(), journal + 1);
  const std::string after = fx.doc.records()[3].line.text();
  CHECK(after.find("HOLE") != std::string::npos);
  CHECK(after.find("7") != std::string::npos);
  CHECK(after.find("12") == std::string::npos);
  // A parameter edit REWRITES a statement; it does not append one.
  CHECK_EQ_INT(fx.doc.records().size(), 5);

  // A REQUEST THAT IS UNDERSTOOD BUT CANNOT BE GROUNDED is answered with the
  // missing measurement named, not with a guessed number.
  ArchieConversation dry;
  LocalPlanner fb2;
  PartInventory none;
  GroundedPlanner ungroundable(none, fx.doc, fb2);
  CHECK(roundTrip(fx, dry, ungroundable, intent) == PlanCheck::PlannerFailed);
  CHECK(dry.transcript().find("census") != std::string::npos);
  CHECK(dry.offers().empty());

  // A request this planner does not ground goes to the FALLBACK unchanged.
  ArchieConversation pass;
  LocalPlanner fb3;
  GroundedPlanner mixed(conv.inventory(), fx.doc, fb3);
  CHECK(roundTrip(fx, pass, mixed, "extrude 20") == PlanCheck::Ok);
  CHECK_EQ_STR(pass.offer().steps[0].current.commandId, "part.extrude");
  CHECK(!mixed.lastPhrase().recognised);
  return H.finish();
}

// ── the retrieval fixture ───────────────────────────────────────────────────
// Shaped exactly like a forge::retrieval::QueryPreview: a redacted q=, an
// annotated form, the removals, and the EXACT encoded body with its digest.
RetrievalPreview samplePreview() {
  RetrievalPreview p;
  p.sendable = true;
  p.status = "Ok";
  p.destinationClass = "same-Mac SearXNG sidecar";
  p.destinationOrigin = "http://127.0.0.1:8888";
  p.method = "POST";
  p.path = "/search";
  p.redactedQuery = "tap drill diameter M12 x 1.75";
  p.annotatedQuery = "[CUSTOMER] tap drill diameter M12 x 1.75 flange bore [DIM]";
  p.removals.push_back(RedactionRemoval{"RegisteredCustomer", "Northwind Aero", "[CUSTOMER]", 0, 14});
  p.removals.push_back(RedactionRemoval{"DimensionLiteral", "96.85", "[DIM]", 52, 5});
  p.fields.push_back({"q", "tap+drill+diameter+M12+x+1.75"});
  p.fields.push_back({"format", "json"});
  p.encodedBody = "q=tap+drill+diameter+M12+x+1.75&format=json&pageno=1";
  p.bodyDigest = 0x9E3779B97F4A7C15ULL;
  return p;
}

// ── 4/5. a model cannot approve its own query ───────────────────────────────
int testApproval() {
  Harness H("archie_conversation:approval");

  {
    // THE HEADLESS DEFAULT. No operator, so the proposal is recorded — the
    // transparency is kept — and immediately declined RETRIEVAL_UNAVAILABLE.
    ArchieConversation conv;
    CHECK(!conv.operatorPresent());
    const std::uint64_t id = conv.proposeRetrieval("what is the M12 tap drill?", "no local table",
                                                   samplePreview());
    CHECK(id != 0);
    const RetrievalProposal* p = conv.proposal(id);
    CHECK(p != nullptr);
    if (p != nullptr) {
      CHECK(p->state == RetrievalState::Declined);
      CHECK(p->decision.find("RETRIEVAL_UNAVAILABLE") != std::string::npos);
    }
    CHECK_EQ_INT(conv.retrievalDeclined(), 1);
    CHECK_EQ_INT(conv.retrievalApproved(), 0);
    // And no ticket can be had for it, even if an operator arrives afterwards.
    conv.setOperatorPresent(true);
    std::string why;
    const RetrievalApprovalTicket ticket = conv.approveRetrieval(id, samplePreview().bodyDigest, why);
    CHECK(!ticket.valid());
    CHECK(why.find("already declined") != std::string::npos);
  }

  {
    ArchieConversation conv;
    conv.setOperatorPresent(true);
    const RetrievalPreview preview = samplePreview();
    const std::uint64_t id = conv.proposeRetrieval("what is the M12 tap drill?", "no local table",
                                                   preview);
    const RetrievalProposal* p = conv.proposal(id);
    CHECK(p != nullptr);
    if (p == nullptr) return H.finish();
    CHECK(p->state == RetrievalState::Proposed);
    // ★PROPOSING IS NOT APPROVING. Nothing about proposeRetrieval() produced a
    // ticket, and the transcript says nothing was sent.
    CHECK(conv.transcript().find("nothing has been sent") != std::string::npos);

    std::string why;
    // (a) approval BEFORE the bytes were shown is refused.
    CHECK(!conv.approveRetrieval(id, preview.bodyDigest, why).valid());
    CHECK(why.find("have not been shown") != std::string::npos);
    CHECK(conv.proposal(id)->state == RetrievalState::Proposed);

    // (b) a PARAPHRASED preview is refused: it does not carry the exact bytes.
    CHECK(!conv.recordPreviewShown(id, "Archie would like to search for the M12 tap drill size.",
                                   why));
    CHECK(why.find("exact bytes") != std::string::npos);
    CHECK(!conv.proposal(id)->previewShown);

    // (c) the exact bytes WITHOUT the redaction diff are refused: an invisible
    // redaction cannot be audited by whoever approves it.
    CHECK(!conv.recordPreviewShown(id, "BODY: " + preview.encodedBody, why));
    CHECK(why.find("redaction diff") != std::string::npos);
    CHECK(why.find("[CUSTOMER]") != std::string::npos);
    // The diagnostic names the removal by KIND and MARKER and never repeats the
    // removed text — a residue report is exactly the string that ends up in a log.
    CHECK(why.find("Northwind Aero") == std::string::npos);

    // (d) showing the bytes and only SOME of the removals is still refused.
    CHECK(!conv.recordPreviewShown(id, preview.encodedBody + " removed: Northwind Aero", why));
    CHECK(why.find("removal 2") != std::string::npos);

    // (e) the canonical rendering satisfies all of it — bytes verbatim, every
    // removal visible, the destination named.
    const std::string rendered = preview.renderForApproval();
    CHECK(rendered.find(preview.encodedBody) != std::string::npos);
    CHECK(rendered.find("Northwind Aero") != std::string::npos);
    CHECK(rendered.find("96.85") != std::string::npos);
    CHECK(rendered.find("[CUSTOMER]") != std::string::npos);
    CHECK(rendered.find("127.0.0.1:8888") != std::string::npos);
    CHECK(rendered.find(std::to_string(preview.bodyDigest)) != std::string::npos);
    CHECK(conv.recordPreviewShown(id, rendered, why));
    CHECK_EQ_STR(why, "");
    CHECK(conv.proposal(id)->previewShown);

    // (f) approving the WRONG DIGEST is refused — approval is bound to the bytes.
    CHECK(!conv.approveRetrieval(id, preview.bodyDigest + 1, why).valid());
    CHECK(why.find("digest") != std::string::npos);
    CHECK(conv.proposal(id)->state == RetrievalState::Proposed);

    // (g) the real thing.
    const RetrievalApprovalTicket ticket = conv.approveRetrieval(id, preview.bodyDigest, why);
    CHECK(ticket.valid());
    CHECK_EQ_STR(why, "");
    CHECK_EQ_INT(ticket.proposalId(), id);
    CHECK(ticket.digest() == preview.bodyDigest);
    CHECK(ticket.bindsTo(id, preview.bodyDigest));
    CHECK(conv.proposal(id)->state == RetrievalState::Approved);
    CHECK_EQ_INT(conv.retrievalApproved(), 1);

    // ★NEVER STICKY (1): the same proposal cannot be approved twice.
    CHECK(!conv.approveRetrieval(id, preview.bodyDigest, why).valid());
    CHECK(why.find("already approved") != std::string::npos);

    // ★NEVER STICKY (2): the ticket binds to ONE proposal and ONE digest.
    CHECK(!ticket.bindsTo(id + 1, preview.bodyDigest));
    CHECK(!ticket.bindsTo(id, preview.bodyDigest + 1));
    CHECK(!ticket.bindsTo(0, preview.bodyDigest));

    // ★NEVER STICKY (3): a SECOND, byte-identical query starts undecided and
    // needs its own approval. Approving once does not open a channel.
    const std::uint64_t second = conv.proposeRetrieval("what is the M12 tap drill?",
                                                       "no local table", preview);
    CHECK(second != id);
    CHECK(conv.proposal(second)->state == RetrievalState::Proposed);
    CHECK(!conv.proposal(second)->previewShown);
    CHECK(!ticket.bindsTo(second, preview.bodyDigest));

    // A DEFAULT-CONSTRUCTED ticket — the only one anyone outside the
    // conversation can make — is invalid and binds to nothing.
    const RetrievalApprovalTicket blank;
    CHECK(!blank.valid());
    CHECK(!blank.bindsTo(id, preview.bodyDigest));

    // The app layer reports what its client returned; the status is quoted, not
    // re-spelled here.
    CHECK(conv.noteRetrievalResult(id, true, "Ok", "3 publishers"));
    CHECK(conv.proposal(id)->state == RetrievalState::Sent);
    CHECK_EQ_STR(conv.proposal(id)->resultStatus, "Ok");
  }

  {
    // A preview the redactor refused is not approvable at all.
    ArchieConversation conv;
    conv.setOperatorPresent(true);
    RetrievalPreview bad = samplePreview();
    bad.sendable = false;
    bad.status = "RedactionResidueDetected";
    bad.statusDetail = "a registered secret survived";
    const std::uint64_t id = conv.proposeRetrieval("q", "r", bad);
    std::string why;
    CHECK(conv.recordPreviewShown(id, bad.renderForApproval(), why));
    CHECK(!conv.approveRetrieval(id, bad.bodyDigest, why).valid());
    CHECK(why.find("not sendable") != std::string::npos);
    CHECK(why.find("RedactionResidueDetected") != std::string::npos);

    // A result cannot be recorded for something nobody approved.
    ArchieConversation conv2;
    conv2.setOperatorPresent(true);
    const std::uint64_t id2 = conv2.proposeRetrieval("q", "r", samplePreview());
    CHECK(!conv2.noteRetrievalResult(id2, true, "Ok", ""));
    CHECK(conv2.proposal(id2)->state == RetrievalState::Proposed);

    // A DECLINED proposal keeps its state even when a status arrives afterwards:
    // the fact that a human said no is not overwritten by the transport.
    CHECK(conv2.declineRetrieval(id2, "I do not want that leaving the machine"));
    CHECK(conv2.proposal(id2)->state == RetrievalState::Declined);
    CHECK(conv2.noteRetrievalResult(id2, false, "RETRIEVAL_UNAVAILABLE", ""));
    CHECK(conv2.proposal(id2)->state == RetrievalState::Declined);
    CHECK_EQ_STR(conv2.proposal(id2)->resultStatus, "RETRIEVAL_UNAVAILABLE");
  }
  return H.finish();
}

// ── 6. a declined search does not abort the feature tree ────────────────────
int testDeclineDoesNotAbort() {
  Harness H("archie_conversation:decline-tolerates");

  Fixture fx;
  ArchieConversation conv;
  conv.setOperatorPresent(true);
  LocalPlanner planner;
  CHECK(roundTrip(fx, conv, planner, "extrude 20 then fillet 2") == PlanCheck::Ok);

  // Snapshot the plan on the table, exactly.
  std::string beforeReport = conv.offer().report();
  const std::size_t beforeSteps = conv.offer().steps.size();
  const std::size_t beforePending = conv.offer().pending();
  const std::size_t beforeOffers = conv.offers().size();

  const std::uint64_t id = conv.proposeRetrieval("standard bore for an M12 flange",
                                                 "no local standards table", samplePreview());
  CHECK(conv.declineRetrieval(id, "not from this machine"));
  CHECK(conv.proposal(id)->state == RetrievalState::Declined);
  CHECK_EQ_INT(conv.retrievalDeclined(), 1);

  // ★NOTHING ABOUT THE PLAN MOVED. Not a step, not a state, not a verdict.
  CHECK_EQ_STR(conv.offer().report(), beforeReport);
  CHECK_EQ_INT(conv.offer().steps.size(), beforeSteps);
  CHECK_EQ_INT(conv.offer().pending(), beforePending);
  CHECK_EQ_INT(conv.offers().size(), beforeOffers);
  CHECK_EQ_INT(conv.stepsRejected(), 0);
  CHECK_EQ_INT(conv.stepsBlocked(), 0);
  CHECK_EQ_INT(conv.plansRefused(), 0);

  // ★AND IT STILL BUILDS. A long tree survives a refused lookup.
  const std::size_t records = fx.doc.records().size();
  const ApplyOutcome out = conv.acceptAll(fx.shell, fx.doc);
  CHECK_EQ_INT(out.requested, 2);
  CHECK_EQ_INT(out.applied, 2);
  CHECK_EQ_INT(fx.doc.records().size(), records + 2);

  // The transcript records the refusal as an ordinary event, in the retrieval
  // lane, next to the plan it did not disturb.
  std::size_t retrievalTurns = 0;
  std::size_t planTurns = 0;
  for (const ConversationTurn& t : conv.turns()) {
    if (t.kind == TurnKind::Retrieval) ++retrievalTurns;
    if (t.kind == TurnKind::PlanOffer) ++planTurns;
  }
  CHECK(retrievalTurns >= 2);
  CHECK_EQ_INT(planTurns, 1);
  CHECK(conv.transcript().find("The plan on offer is unchanged") != std::string::npos);

  // clear() resets the conversation but NOT the id counters: a reply to a
  // pre-clear request must not be able to match a post-clear one.
  const std::uint64_t lastRequest = conv.request().id;
  conv.clear();
  CHECK(conv.turns().empty());
  CHECK(conv.offers().empty());
  CHECK(conv.proposals().empty());
  const std::uint64_t next =
      conv.ask("extrude 20", fx.shell.registry(), fx.shell.selection(), fx.doc);
  CHECK(next > lastRequest);
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testOneRule();
  rc |= testDispositions();
  rc |= testEditing();
  rc |= testRefusedPlanIsShown();
  rc |= testGrounding();
  rc |= testApproval();
  rc |= testDeclineDoesNotAbort();
  return rc;
}
