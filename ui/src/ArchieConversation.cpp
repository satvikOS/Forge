// ui/src/ArchieConversation.cpp — the conversation, its dispositions, and the
// per-query approval of a tool call.
#include "forge/ui/ArchieConversation.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartInventory.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {
namespace {

std::string trim(const std::string& s) {
  std::size_t a = 0;
  std::size_t b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\n' || s[a] == '\r')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\n' || s[b - 1] == '\r')) --b;
  return s.substr(a, b - a);
}

std::string plural(std::size_t n, const char* one, const char* many) {
  return std::to_string(n) + " " + (n == 1 ? one : many);
}

const ParamSpec* specFor(const CommandDescriptor& cmd, const std::string& name) {
  for (const ParamSpec& s : cmd.schema) {
    if (s.name == name) return &s;
  }
  return nullptr;
}

const char* paramTypeName(ParamType t) {
  switch (t) {
    case ParamType::Number: return "Number";
    case ParamType::Text: return "Text";
    case ParamType::Flag: return "Flag";
  }
  return "Number";
}

// What the user has picked, in words. The planner is told this because half the
// commands in the registry consume a selection and a plan written without
// knowing what is picked is a plan written for a different document.
std::string describeSelection(const SelectionService& selection) {
  const std::size_t n = selection.count();
  if (n == 0) return "nothing picked";
  std::string out = plural(n, "entity", "entities") + " picked";
  if (selection.homogeneous() && !selection.selection().empty()) {
    out += " (all " + std::string(toString(selection.selection().front().kind)) + ")";
  }
  out += ":";
  std::size_t shown = 0;
  for (const EntityRef& ref : selection.selection()) {
    if (shown == 8) {
      out += " …";
      break;
    }
    out += " " + std::string(toString(ref.kind)) + ":" + ref.bodyId;
    if (!ref.persistentName.empty()) out += "/" + ref.persistentName;
    ++shown;
  }
  return out;
}

// The document, as a planner should see it: how many features, the statements
// themselves (they ARE the part), and then everything that was MEASURED.
std::string describeDocument(const PartDocument& document, const PartInventory& inventory) {
  std::string out = plural(document.records().size(), "statement", "statements") + " (" +
                    plural(document.featureCount(), "command-authored feature",
                           "command-authored features") +
                    ")\n";
  const std::vector<FeatureRecord>& recs = document.records();
  constexpr std::size_t kMaxLines = 40;
  const std::size_t from = recs.size() > kMaxLines ? recs.size() - kMaxLines : 0;
  if (from != 0) {
    out += "  … " + std::to_string(from) + " earlier statement(s) not listed\n";
  }
  for (std::size_t i = from; i < recs.size(); ++i) {
    out += "  " + recs[i].line.text();
    if (!recs[i].commandId.empty()) out += "        [" + recs[i].commandId + "]";
    out += "\n";
  }
  out += inventory.contextBlock();
  return out;
}

}  // namespace

// ── small displays ──────────────────────────────────────────────────────────
const char* toString(RetrievalState state) noexcept {
  switch (state) {
    case RetrievalState::Proposed: return "proposed";
    case RetrievalState::Approved: return "approved";
    case RetrievalState::Declined: return "declined";
    case RetrievalState::Sent: return "sent";
    case RetrievalState::Failed: return "failed";
  }
  return "proposed";
}

const char* toString(Speaker who) noexcept {
  switch (who) {
    case Speaker::User: return "you";
    case Speaker::Archie: return "archie";
    case Speaker::App: return "forge";
  }
  return "forge";
}

const char* toString(TurnKind kind) noexcept {
  switch (kind) {
    case TurnKind::Question: return "question";
    case TurnKind::Answer: return "answer";
    case TurnKind::PlanOffer: return "plan";
    case TurnKind::PlanOutcome: return "outcome";
    case TurnKind::Retrieval: return "retrieval";
    case TurnKind::Note: return "note";
  }
  return "note";
}

const char* toString(StepState state) noexcept {
  switch (state) {
    case StepState::Pending: return "pending";
    case StepState::Rejected: return "rejected";
    case StepState::Applied: return "applied";
    case StepState::Failed: return "failed";
    case StepState::Blocked: return "blocked";
  }
  return "pending";
}

std::string ConversationTurn::display() const {
  return std::string(toString(who)) + " [" + toString(kind) + "] " + text;
}

std::string OfferStep::display() const {
  std::string out = std::string(toString(state));
  out += edited ? "  EDITED  " : "  ";
  out += current.display();
  out += verdict.refused ? "   REFUSE" : "   ACCEPT";
  if (verdict.refused) {
    if (verdict.constraint != OpConstraint::Ok) {
      out += " " + std::string(toString(verdict.constraint));
    }
    if (!verdict.reason.empty()) out += ": " + verdict.reason;
  }
  if (!outcome.empty()) out += "   -> " + outcome;
  return out;
}

std::string RedactionRemoval::display() const {
  // The ORIGINAL text is shown: this string is drawn locally for the person who
  // owns the data and is never part of the bytes. That is the whole point — a
  // redaction the approver cannot see is a redaction they cannot audit.
  return marker + "  " + kind + "  offset " + std::to_string(offset) + " len " +
         std::to_string(length) + "  \"" + removed + "\"";
}

// ── the preview, rendered for approval ──────────────────────────────────────
std::string RetrievalPreview::destinationBlock() const {
  std::string out = "DESTINATION\n";
  out += "  class:  " + (destinationClass.empty() ? std::string("(unstated)") : destinationClass) +
         "\n";
  out += "  origin: " + (destinationOrigin.empty() ? std::string("(unstated)") : destinationOrigin) +
         "\n";
  out += "  " + (method.empty() ? std::string("(no method)") : method) + " " +
         (path.empty() ? std::string("(no path)") : path) + "\n";
  out += "  status: " + (status.empty() ? std::string("(unstated)") : status);
  if (!statusDetail.empty()) out += " — " + statusDetail;
  out += sendable ? "  [SENDABLE]\n" : "  [NOT SENDABLE]\n";
  return out;
}

std::string RetrievalPreview::redactionDiff() const {
  std::string out = "REDACTION DIFF — " + plural(removals.size(), "removal", "removals") + "\n";
  out += "  KEPT (this is what leaves the machine):\n    " +
         (redactedQuery.empty() ? std::string("(nothing)") : redactedQuery) + "\n";
  out += "  MARKED (where each removal was):\n    " +
         (annotatedQuery.empty() ? std::string("(nothing)") : annotatedQuery) + "\n";
  if (removals.empty()) {
    out += "  REMOVED: nothing was stripped from this query.\n";
    return out;
  }
  out += "  REMOVED (never transmitted):\n";
  for (const RedactionRemoval& r : removals) out += "    " + r.display() + "\n";
  return out;
}

std::string RetrievalPreview::wireBlock() const {
  std::string out = "WIRE BYTES — verbatim, digest " + std::to_string(bodyDigest) + "\n";
  for (const auto& kv : fields) out += "  field  " + kv.first + " = " + kv.second + "\n";
  out += "  body:\n";
  out += encodedBody;
  out += "\n";
  return out;
}

std::string RetrievalPreview::renderForApproval() const {
  // Concatenated in the order a person reads them: WHERE it goes, WHAT was taken
  // out, and then the exact bytes. Passing this string back to
  // recordPreviewShown() satisfies every requirement by construction, which is
  // why it exists rather than leaving each panel to assemble its own.
  return destinationBlock() + redactionDiff() + wireBlock();
}

std::string RetrievalProposal::display() const {
  std::string out = "#" + std::to_string(id) + " " + toString(state) + "  \"" + question + "\"";
  if (!preview.redactedQuery.empty()) out += "  ->  q=" + preview.redactedQuery;
  if (!decision.empty()) out += "  (" + decision + ")";
  if (!resultStatus.empty()) out += "  [" + resultStatus + "]";
  return out;
}

// ── the offer ───────────────────────────────────────────────────────────────
std::size_t PlanOffer::pending() const noexcept {
  std::size_t n = 0;
  for (const OfferStep& s : steps) {
    if (s.state == StepState::Pending) ++n;
  }
  return n;
}

std::size_t PlanOffer::applied() const noexcept {
  std::size_t n = 0;
  for (const OfferStep& s : steps) {
    if (s.state == StepState::Applied) ++n;
  }
  return n;
}

std::size_t PlanOffer::rejected() const noexcept {
  std::size_t n = 0;
  for (const OfferStep& s : steps) {
    if (s.state == StepState::Rejected) ++n;
  }
  return n;
}

std::size_t PlanOffer::blocked() const noexcept {
  std::size_t n = 0;
  for (const OfferStep& s : steps) {
    if (s.state == StepState::Blocked) ++n;
  }
  return n;
}

std::size_t PlanOffer::refusedByGate() const noexcept {
  std::size_t n = 0;
  for (const OfferStep& s : steps) {
    if (s.verdict.refused) ++n;
  }
  return n;
}

std::string PlanOffer::report() const {
  std::string out = summary.empty() ? std::string() : (summary + "\n");
  for (std::size_t i = 0; i < steps.size(); ++i) {
    out += "  " + std::to_string(i + 1) + "  " + steps[i].display() + "\n";
  }
  out += "  " + std::to_string(steps.size() - refusedByGate()) + " of " +
         std::to_string(steps.size()) + " step(s) pass the op-constraint gate";
  if (check != PlanCheck::Ok) {
    out += "; the plan as a whole was refused: ";
    out += toString(check);
    if (!detail.empty()) out += " — " + detail;
  }
  out += "\n";
  return out;
}

// ── the context a planner is handed ─────────────────────────────────────────
std::string renderContext(const PlanRequest& request) {
  std::string out = "CONTEXT GIVEN TO THE PLANNER (request #" + std::to_string(request.id) + ")\n";
  out += "\nINTENT\n  " + request.intent + "\n";
  out += "\nSELECTION\n  " + request.selectionSummary + "\n";
  out += "\nDOCUMENT\n  " + request.documentSummary + "\n";
  out += "\nTOOLS (" + std::to_string(request.tools.size()) +
         " from the live registry; * = callable as the selection stands)\n";
  for (const PlanTool& t : request.tools) {
    out += std::string("  ") + (t.callableNow ? "* " : "  ") + t.id;
    if (!t.featureIrOp.empty()) out += "  " + t.featureIrOp;
    out += "  (";
    for (std::size_t i = 0; i < t.schema.size(); ++i) {
      if (i != 0) out += ", ";
      const ParamSpec& s = t.schema[i];
      out += s.name;
      out += ":";
      out += paramTypeName(s.type);
      if (s.required) out += " required";
      if (s.hasDefault) {
        out += "=";
        out += s.type == ParamType::Text ? s.defaultText : std::to_string(s.defaultNumber);
      }
    }
    out += ")";
    if (!t.signature.describe().empty()) out += "  needs " + t.signature.describe();
    if (!t.callableNow && !t.reason.empty()) out += "  — " + t.reason;
    out += "\n";
  }
  return out;
}

// ── the grounded planner ────────────────────────────────────────────────────
GroundedPlanner::GroundedPlanner(const PartInventory& inventory, const PartDocument& document,
                                 Planner& fallback) noexcept
    : inventory_(&inventory), document_(&document), fallback_(&fallback) {}

PlanResponse GroundedPlanner::plan(const PlanRequest& request) {
  lastEdit_ = GroundedEdit{};
  lastPhrase_ = parseBoreEditPhrase(request.intent);
  if (!lastPhrase_.recognised) {
    // NOT a refusal: the request simply is not the shape this planner grounds,
    // so it goes to the fallback untouched. A grounded planner that swallowed
    // everything it could not measure would be a narrower app, not a safer one.
    lastEdit_.why = lastPhrase_.why;
    return fallback_->plan(request);
  }

  lastEdit_ = groundBoreDiameterEdit(*inventory_, *document_, lastPhrase_.rank, lastPhrase_.delta,
                                     lastPhrase_.absolute, lastPhrase_.ordinal);
  PlanResponse out;
  out.id = request.id;
  if (!lastEdit_.ok) {
    // The request WAS understood and could not be grounded. Saying so — and
    // naming the missing measurement — is the answer; falling through to a
    // planner that would guess a number is not.
    out.ok = false;
    out.error = lastEdit_.why;
    return out;
  }
  out.ok = true;
  out.plan.intent = request.intent;
  out.plan.summary = "1 step, grounded — " + lastEdit_.grounding;
  out.plan.steps.push_back(lastEdit_.step);
  return out;
}

// ── the conversation ────────────────────────────────────────────────────────
void ArchieConversation::say(Speaker who, TurnKind kind, std::string text, std::size_t offer,
                             std::size_t proposal) {
  ConversationTurn turn;
  turn.id = nextTurnId_++;
  turn.who = who;
  turn.kind = kind;
  turn.text = std::move(text);
  turn.offer = offer;
  turn.proposal = proposal;
  turns_.push_back(std::move(turn));
}

void ArchieConversation::setInventory(PartInventory inventory) {
  inventory_ = std::move(inventory);
  say(Speaker::App, TurnKind::Note, "measured the part: " + inventory_.summary());
}

bool ArchieConversation::measureFrom(const std::string& verifyJson, std::string& why) {
  PartInventory parsed;
  if (!PartInventory::parseVerifyJson(verifyJson, parsed, why)) {
    // The previous inventory is KEPT. Replacing a good measurement with an empty
    // one on a parse failure would turn "the census is stale" into "the part has
    // no bores", which is a wrong answer rather than a missing one.
    say(Speaker::App, TurnKind::Note, "the census could not be read: " + why);
    return false;
  }
  setInventory(std::move(parsed));
  return true;
}

std::uint64_t ArchieConversation::ask(std::string intent, const CommandRegistry& registry,
                                      const SelectionService& selection,
                                      const PartDocument& document) {
  const std::string text = trim(intent);
  if (text.empty()) return 0;
  if (pending_) return 0;

  request_ = PlanRequest{};
  request_.id = nextRequestId_++;
  request_.intent = text;
  request_.selectionSummary = describeSelection(selection);
  request_.documentSummary = describeDocument(document, inventory_);
  request_.tools = planTools(registry, selection);
  context_ = renderContext(request_);
  raw_.clear();
  pending_ = true;

  say(Speaker::User, TurnKind::Question, text);
  return request_.id;
}

void ArchieConversation::failRequest(std::string why) {
  if (!pending_) return;
  pending_ = false;
  say(Speaker::App, TurnKind::Note,
      "the planner could not be reached: " + (why.empty() ? std::string("no reason given") : why));
}

void ArchieConversation::reruleStep(PlanOffer& offer, std::size_t step,
                                    const CommandRegistry& registry) {
  if (step >= offer.steps.size()) return;
  OfferStep& s = offer.steps[step];

  // ★THE SAME FUNCTION, on a one-step plan. There is no second implementation of
  // the op-constraint rule in this file, and archie_conversation_test asserts
  // that a whole-plan validatePlan() and these per-step rulings agree.
  Plan one;
  one.intent = offer.intent;
  one.steps.push_back(s.current);
  const PlanVerdict verdict = validatePlan(one, registry, bridge_);

  if (!verdict.steps.empty()) {
    s.verdict = verdict.steps.front();
  } else {
    // validatePlan() returns a row for every refusal it can name; the only way
    // here is an empty plan, which cannot happen with one step pushed. Refuse
    // rather than leave the previous ruling standing: a missing verdict is not
    // an acceptance.
    s.verdict = StepVerdict{};
    s.verdict.commandId = s.current.commandId;
    s.verdict.irOp = s.current.irOp;
    s.verdict.refused = true;
    s.verdict.reason = verdict.detail.empty()
                           ? std::string("the op-constraint gate returned no ruling")
                           : verdict.detail;
  }
  s.verdict.index = step + 1;  // the panel's numbering, not the one-step plan's
}

PlanCheck ArchieConversation::deliver(const PlanResponse& response,
                                      const CommandRegistry& registry,
                                      std::string rawModelOutput) {
  raw_ = std::move(rawModelOutput);

  if (!pending_ || response.id != request_.id) {
    say(Speaker::App, TurnKind::Note,
        "a reply arrived for request #" + std::to_string(response.id) + " and #" +
            std::to_string(request_.id) + " is the one in flight — discarded");
    return PlanCheck::StaleResponse;
  }
  pending_ = false;

  if (!response.ok) {
    ++plansRefused_;
    say(Speaker::Archie, TurnKind::Answer,
        response.error.empty() ? std::string("the planner failed and gave no reason")
                               : response.error);
    return PlanCheck::PlannerFailed;
  }
  if (response.plan.steps.empty()) {
    ++plansRefused_;
    say(Speaker::App, TurnKind::Note, "the planner returned a plan with no steps");
    return PlanCheck::EmptyPlan;
  }

  const PlanVerdict verdict = validatePlan(response.plan, registry, bridge_);

  PlanOffer offer;
  offer.requestId = request_.id;
  offer.intent = response.plan.intent.empty() ? request_.intent : response.plan.intent;
  offer.summary = response.plan.summary;
  offer.check = verdict.check;
  offer.detail = verdict.detail;
  for (const PlanStep& step : response.plan.steps) {
    OfferStep s;
    s.proposed = step;
    s.current = step;
    offer.steps.push_back(std::move(s));
  }

  offers_.push_back(std::move(offer));
  PlanOffer& live = offers_.back();
  // EVERY line gets a verdict, including the lines after the first refusal.
  // validatePlan() returns early — correctly, since a plan is a sequence — but a
  // user deciding line by line is entitled to a ruling on every line, and
  // accept-one makes those rulings actionable.
  for (std::size_t i = 0; i < live.steps.size(); ++i) reruleStep(live, i, registry);

  const std::size_t index = offers_.size() - 1;
  say(Speaker::Archie, TurnKind::PlanOffer, live.report(), index);
  if (verdict.check != PlanCheck::Ok) {
    ++plansRefused_;
    say(Speaker::App, TurnKind::Note,
        std::string("the plan as a whole was refused (") + toString(verdict.check) + "): " +
            (verdict.detail.empty() ? std::string("no detail") : verdict.detail) +
            ". Individual lines that pass the gate can still be accepted one at a time.",
        index);
  }
  return verdict.check;
}

bool ArchieConversation::editStep(std::size_t step, const std::string& parameter,
                                  const PlanArg& value, const CommandRegistry& registry,
                                  std::string& why) {
  why.clear();
  if (offers_.empty()) {
    why = "there is no plan on offer";
    return false;
  }
  PlanOffer& offer = offers_.back();
  if (step >= offer.steps.size()) {
    why = "there is no step " + std::to_string(step + 1);
    return false;
  }
  OfferStep& s = offer.steps[step];
  if (s.state != StepState::Pending) {
    why = "step " + std::to_string(step + 1) + " is already " + toString(s.state);
    return false;
  }
  const CommandDescriptor* cmd = registry.find(s.current.commandId);
  if (cmd == nullptr) {
    why = "no such command in the live registry: " + s.current.commandId;
    return false;
  }
  const ParamSpec* spec = specFor(*cmd, parameter);
  if (spec == nullptr) {
    why = "the schema of " + s.current.commandId + " declares no parameter \"" + parameter + "\"";
    return false;
  }
  if (spec->type != value.type) {
    why = "parameter \"" + parameter + "\" is declared " + paramTypeName(spec->type) +
          " and the edit is " + paramTypeName(value.type);
    return false;
  }

  PlanArg edited = value;
  edited.name = parameter;
  bool replaced = false;
  for (PlanArg& a : s.current.args) {
    if (a.name != parameter) continue;
    a = edited;
    replaced = true;
    break;
  }
  if (!replaced) s.current.args.push_back(edited);
  s.edited = true;

  // THE EDITED VALUE IS UNTRUSTED TOO. A user pasting a face selector is exactly
  // the path an injected op would take, so the new value goes through the SAME
  // op-constraint check the planner's value went through. A refusal is SHOWN and
  // the step becomes unacceptable; the keystroke itself is never refused, so the
  // user can see what is wrong with what they typed and fix it.
  reruleStep(offer, step, registry);
  std::string note = "edited step " + std::to_string(step + 1) + ": " + edited.display();
  if (s.verdict.refused) {
    note += " — the op-constraint gate now REFUSES this line: " + s.verdict.reason;
  }
  say(Speaker::User, TurnKind::Note, std::move(note), offers_.size() - 1);
  return true;
}

bool ArchieConversation::resetStep(std::size_t step, const CommandRegistry& registry,
                                   std::string& why) {
  why.clear();
  if (offers_.empty()) {
    why = "there is no plan on offer";
    return false;
  }
  PlanOffer& offer = offers_.back();
  if (step >= offer.steps.size()) {
    why = "there is no step " + std::to_string(step + 1);
    return false;
  }
  OfferStep& s = offer.steps[step];
  if (s.state != StepState::Pending) {
    why = "step " + std::to_string(step + 1) + " is already " + toString(s.state);
    return false;
  }
  s.current = s.proposed;
  s.edited = false;
  reruleStep(offer, step, registry);
  say(Speaker::User, TurnKind::Note,
      "reset step " + std::to_string(step + 1) + " to what the planner proposed",
      offers_.size() - 1);
  return true;
}

bool ArchieConversation::rejectStep(std::size_t step, std::string why) {
  if (offers_.empty()) return false;
  PlanOffer& offer = offers_.back();
  if (step >= offer.steps.size()) return false;
  OfferStep& s = offer.steps[step];
  if (s.state != StepState::Pending) return false;
  s.state = StepState::Rejected;
  s.outcome = why.empty() ? std::string("declined by you") : why;
  ++stepsRejected_;
  say(Speaker::User, TurnKind::Note,
      "rejected step " + std::to_string(step + 1) + " (" + s.current.display() + ")" +
          (why.empty() ? std::string() : ": " + why),
      offers_.size() - 1);
  return true;
}

void ArchieConversation::rejectOffer(std::string why) {
  if (offers_.empty()) return;
  PlanOffer& offer = offers_.back();
  std::size_t n = 0;
  for (OfferStep& s : offer.steps) {
    if (s.state != StepState::Pending) continue;
    s.state = StepState::Rejected;
    s.outcome = why.empty() ? std::string("declined by you") : why;
    ++stepsRejected_;
    ++n;
  }
  say(Speaker::User, TurnKind::Note,
      "rejected the plan (" + plural(n, "step", "steps") + " declined)" +
          (why.empty() ? std::string() : ": " + why),
      offers_.size() - 1);
}

void ArchieConversation::recordOutcome(PlanOffer& offer, const std::vector<std::size_t>& applied,
                                       const ApplyOutcome& outcome) {
  for (std::size_t k = 0; k < outcome.steps.size() && k < applied.size(); ++k) {
    const std::size_t index = applied[k];
    if (index >= offer.steps.size()) continue;
    OfferStep& s = offer.steps[index];
    const StepOutcome& so = outcome.steps[k];
    if (so.blocked()) {
      s.state = StepState::Blocked;
      s.outcome = "REFUSED BY THE OP-CONSTRAINT GATE, never dispatched";
      if (so.constraint != OpConstraint::Ok) {
        s.outcome += " (" + std::string(toString(so.constraint)) + ")";
      }
      if (!so.constraintReason.empty()) s.outcome += ": " + so.constraintReason;
      ++stepsBlocked_;
    } else if (so.ok()) {
      s.state = StepState::Applied;
      s.outcome = "applied on " + (so.selection.empty() ? std::string("nothing") : so.selection);
      ++stepsApplied_;
    } else {
      s.state = StepState::Failed;
      s.outcome = std::string(toString(so.dispatch.status));
      const std::string detail = so.detail.empty() ? so.dispatch.detail : so.detail;
      if (!detail.empty()) s.outcome += ": " + detail;
      ++stepsFailed_;
    }
  }
  // Steps that were handed to applyPlan() and never reached stay PENDING on
  // purpose: applyPlan stops at the first refusal, and a step that never ran has
  // not been ruled on by anything.
}

ApplyOutcome ArchieConversation::acceptStep(std::size_t step, ForgeShell& shell,
                                            const PartDocument& document) {
  ApplyOutcome out;
  if (offers_.empty()) {
    say(Speaker::App, TurnKind::Note, "there is no plan on offer to accept");
    return out;
  }
  PlanOffer& offer = offers_.back();
  if (step >= offer.steps.size()) {
    say(Speaker::App, TurnKind::Note, "there is no step " + std::to_string(step + 1));
    return out;
  }
  OfferStep& s = offer.steps[step];
  if (s.state != StepState::Pending) {
    say(Speaker::App, TurnKind::Note,
        "step " + std::to_string(step + 1) + " is already " + toString(s.state));
    return out;
  }
  if (s.verdict.refused) {
    // The gate already ruled on this line and the panel is showing that ruling.
    // Accepting it anyway would be the one thing the whole file exists to
    // prevent, so it is refused HERE as well as inside applyPlan().
    say(Speaker::App, TurnKind::Note,
        "step " + std::to_string(step + 1) + " cannot be accepted: " + s.verdict.reason,
        offers_.size() - 1);
    return out;
  }

  Plan one;
  one.intent = offer.intent;
  one.steps.push_back(s.current);
  out = applyPlan(one, shell, document, bridge_);
  recordOutcome(offer, {step}, out);
  say(Speaker::App, TurnKind::PlanOutcome,
      "step " + std::to_string(step + 1) + ": " + out.summary(), offers_.size() - 1);
  return out;
}

ApplyOutcome ArchieConversation::acceptAll(ForgeShell& shell, const PartDocument& document) {
  ApplyOutcome out;
  if (offers_.empty()) {
    say(Speaker::App, TurnKind::Note, "there is no plan on offer to accept");
    return out;
  }
  PlanOffer& offer = offers_.back();

  // Every line still PENDING, in plan order — including one the gate refused.
  // Skipping a refused line and running the rest would apply later steps to a
  // value the refused one never produced; applyPlan() stops there instead, and
  // the lines after it stay pending so accept-one can still rule on them.
  std::vector<std::size_t> chosen;
  Plan plan;
  plan.intent = offer.intent;
  for (std::size_t i = 0; i < offer.steps.size(); ++i) {
    if (offer.steps[i].state != StepState::Pending) continue;
    chosen.push_back(i);
    plan.steps.push_back(offer.steps[i].current);
  }
  if (plan.steps.empty()) {
    say(Speaker::App, TurnKind::Note, "no step is pending: there is nothing to accept",
        offers_.size() - 1);
    return out;
  }

  out = applyPlan(plan, shell, document, bridge_);
  recordOutcome(offer, chosen, out);
  say(Speaker::App, TurnKind::PlanOutcome, out.summary(), offers_.size() - 1);
  return out;
}

// ── retrieval ───────────────────────────────────────────────────────────────
RetrievalProposal* ArchieConversation::mutableProposal(std::uint64_t id) noexcept {
  for (RetrievalProposal& p : proposals_) {
    if (p.id == id) return &p;
  }
  return nullptr;
}

const RetrievalProposal* ArchieConversation::proposal(std::uint64_t id) const noexcept {
  for (const RetrievalProposal& p : proposals_) {
    if (p.id == id) return &p;
  }
  return nullptr;
}

std::uint64_t ArchieConversation::proposeRetrieval(std::string question, std::string rationale,
                                                   RetrievalPreview preview) {
  RetrievalProposal p;
  p.id = nextProposalId_++;
  p.question = std::move(question);
  p.rationale = std::move(rationale);
  p.preview = std::move(preview);
  p.state = RetrievalState::Proposed;
  proposals_.push_back(std::move(p));
  const std::size_t index = proposals_.size() - 1;

  say(Speaker::Archie, TurnKind::Retrieval,
      "proposes a web search: \"" + proposals_[index].question +
          "\" — nothing has been sent; the redacted query and its exact bytes are shown for "
          "your approval",
      kNoIndex, index);

  if (!operatorPresent_) {
    // ★THE HEADLESS DEFAULT. With no operator there is nobody to approve, so the
    // proposal is declined immediately and the run proceeds. This is not only a
    // safety property: a benchmark score obtained with web retrieval is not
    // comparable to one obtained without it.
    declineRetrieval(proposals_[index].id,
                     "no operator is present (headless): RETRIEVAL_UNAVAILABLE");
  }
  return proposals_[index].id;
}

bool ArchieConversation::recordPreviewShown(std::uint64_t proposalId,
                                            const std::string& renderedText, std::string& why) {
  why.clear();
  RetrievalProposal* p = mutableProposal(proposalId);
  if (p == nullptr) {
    why = "no such proposal";
    return false;
  }
  if (p->decided()) {
    why = "proposal #" + std::to_string(proposalId) + " is already " + toString(p->state);
    return false;
  }
  if (p->preview.encodedBody.empty()) {
    // find("") succeeds on every string, so an empty body would make the
    // verbatim check vacuous. A sendable preview with no bytes is not a preview.
    why = "the preview carries no body bytes to show";
    p->previewShown = false;
    p->shownProblem = why;
    return false;
  }
  if (renderedText.find(p->preview.encodedBody) == std::string::npos) {
    why =
        "what was drawn does not contain the exact bytes that would be sent — a paraphrased "
        "preview discards the digest guarantee search() re-checks";
    p->previewShown = false;
    p->shownProblem = why;
    return false;
  }
  for (std::size_t i = 0; i < p->preview.removals.size(); ++i) {
    const RedactionRemoval& r = p->preview.removals[i];
    if (r.removed.empty()) continue;
    if (renderedText.find(r.removed) != std::string::npos) continue;
    // Names the removal by KIND, MARKER and OFFSET and never repeats the removed
    // text: this string is a diagnostic and diagnostics end up in logs.
    why = "the redaction diff does not show removal " + std::to_string(i + 1) + " (" + r.kind +
          " " + r.marker + " at offset " + std::to_string(r.offset) +
          ") — an invisible redaction cannot be audited by whoever approves it";
    p->previewShown = false;
    p->shownProblem = why;
    return false;
  }
  p->previewShown = true;
  p->shownProblem.clear();
  return true;
}

RetrievalApprovalTicket ArchieConversation::approveRetrieval(std::uint64_t proposalId,
                                                             std::uint64_t digestTheUserSaw,
                                                             std::string& why) {
  RetrievalApprovalTicket ticket;  // invalid until every precondition holds
  why.clear();

  if (!operatorPresent_) {
    why =
        "no operator is present: a model may not approve its own query, so with nobody at the "
        "keyboard the answer is RETRIEVAL_UNAVAILABLE";
    return ticket;
  }
  RetrievalProposal* p = mutableProposal(proposalId);
  if (p == nullptr) {
    why = "no such proposal";
    return ticket;
  }
  if (p->decided()) {
    // SINGLE USE. Approval is per-query and never sticky: the proposal has left
    // the Proposed state, so there is no second ticket for it.
    why = "proposal #" + std::to_string(proposalId) + " is already " + toString(p->state);
    return ticket;
  }
  if (!p->preview.sendable) {
    why = "the preview is not sendable (" + p->preview.status + ")";
    if (!p->preview.statusDetail.empty()) why += ": " + p->preview.statusDetail;
    return ticket;
  }
  if (!p->previewShown) {
    why = "the exact bytes and the redaction diff have not been shown to you";
    if (!p->shownProblem.empty()) why += " — " + p->shownProblem;
    return ticket;
  }
  if (digestTheUserSaw != p->preview.bodyDigest) {
    why = "the digest you approved (" + std::to_string(digestTheUserSaw) +
          ") is not the digest of the bytes that would be sent (" +
          std::to_string(p->preview.bodyDigest) + ")";
    return ticket;
  }

  ticket.granted_ = true;
  ticket.proposalId_ = proposalId;
  ticket.digest_ = p->preview.bodyDigest;
  p->state = RetrievalState::Approved;
  p->decision = "approved by you, bound to digest " + std::to_string(p->preview.bodyDigest);
  ++retrievalApproved_;
  say(Speaker::User, TurnKind::Retrieval,
      "approved proposal #" + std::to_string(proposalId) + " — one query, this digest only",
      kNoIndex, static_cast<std::size_t>(p - proposals_.data()));
  return ticket;
}

bool ArchieConversation::declineRetrieval(std::uint64_t proposalId, std::string why) {
  RetrievalProposal* p = mutableProposal(proposalId);
  if (p == nullptr) return false;
  if (p->decided()) return false;
  p->state = RetrievalState::Declined;
  p->decision = why.empty() ? std::string("declined by you") : why;
  ++retrievalDeclined_;
  // ★NOTHING ELSE IS TOUCHED. No offer, no step, no counter that belongs to the
  // plan. A declined search is not a failed build, and a long feature tree must
  // survive one.
  say(Speaker::App, TurnKind::Retrieval,
      "proposal #" + std::to_string(proposalId) + " declined (" + p->decision +
          ") — RETRIEVAL_UNAVAILABLE. The plan on offer is unchanged.",
      kNoIndex, static_cast<std::size_t>(p - proposals_.data()));
  return true;
}

bool ArchieConversation::noteRetrievalResult(std::uint64_t proposalId, bool ok,
                                             std::string status, std::string detail) {
  RetrievalProposal* p = mutableProposal(proposalId);
  if (p == nullptr) return false;
  if (p->state == RetrievalState::Proposed) {
    // Nothing was approved, so nothing can have been sent. Recording a result
    // here would put a transmission in the record that never happened.
    say(Speaker::App, TurnKind::Note,
        "a retrieval result arrived for proposal #" + std::to_string(proposalId) +
            ", which has not been approved — discarded");
    return false;
  }
  p->resultStatus = std::move(status);
  p->resultDetail = std::move(detail);
  // A DECLINED proposal keeps its state: the fact that a human said no is not
  // overwritten by whatever the app layer reports afterwards.
  if (p->state == RetrievalState::Approved) {
    p->state = ok ? RetrievalState::Sent : RetrievalState::Failed;
  }
  say(Speaker::App, TurnKind::Retrieval,
      "proposal #" + std::to_string(proposalId) + " -> " + p->resultStatus +
          (p->resultDetail.empty() ? std::string() : (": " + p->resultDetail)),
      kNoIndex, static_cast<std::size_t>(p - proposals_.data()));
  return true;
}

// ── the transcript ──────────────────────────────────────────────────────────
std::string ArchieConversation::transcript() const {
  std::string out;
  for (const ConversationTurn& t : turns_) out += t.display() + "\n";
  return out;
}

void ArchieConversation::clear() {
  turns_.clear();
  offers_.clear();
  proposals_.clear();
  request_ = PlanRequest{};
  context_.clear();
  raw_.clear();
  pending_ = false;
  stepsApplied_ = 0;
  stepsRejected_ = 0;
  stepsBlocked_ = 0;
  stepsFailed_ = 0;
  plansRefused_ = 0;
  retrievalApproved_ = 0;
  retrievalDeclined_ = 0;
  // nextRequestId_, nextTurnId_ and nextProposalId_ deliberately KEEP counting:
  // a reply to a request from before the clear must not be able to match a
  // request issued after it, and a ticket must never bind to a recycled id.
}

}  // namespace forge::ui
