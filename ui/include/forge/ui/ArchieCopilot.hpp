// ui/include/forge/ui/ArchieCopilot.hpp
//
// THE ARCHIE COPILOT — the agent surface of the running application, and the one
// place in this codebase where a MODEL's output becomes a CAD edit.
//
// The whole point of the s19.2 single-registry rule is that Archie can do what a
// user can do and NOTHING ELSE. That claim is only structural if the CoPilot is
// given no API but `(commandId, CommandParams)`:
//
//     intent text  ->  Planner  ->  Plan (ops + arguments)
//                                     |
//                                     |  the user reads it and presses Apply
//                                     v
//                   SelectionService  +  ForgeShell::run(id, params)
//                                     ->  CommandRegistry::dispatch
//                                     ->  the command's own handler
//                                     ->  PartDocument::appendFeature
//
// There is no second path. This header does not include the kernel, cannot name
// a feature-IR op except through a command's declared `featureIrOp`, and holds
// no reference to a document it could write to: `applyPlan` takes the document
// CONST, reads it only to resolve a selection target to a node id, and lets the
// registered handler do the writing under the undo stack. An unregistered id
// comes back UnknownCommand, so the reachable op set is by construction the set
// of ops the 18 Part commands declare.
//
// ── the network seam ────────────────────────────────────────────────────────
// forge::ui is HEADLESS and opens no socket, and neither does the ImGui frame
// builder. So the CoPilot does not "call a model": it RAISES A REQUEST and
// RENDERS A RESULT, exactly the shape the viewport already uses (ForgeFrame
// fills a plain ViewportRequest struct; the renderer reads it afterwards).
//
//     submit(...)        -> a PlanRequest is pending; plain data, no I/O
//     requestPending()   -> the app layer sees there is something to ask
//     deliver(response)  -> the reply comes back as plain data and is VALIDATED
//
// Whoever fills that gap is the app layer's business. `LocalPlanner` ships one
// today that is deterministic, offline and honest about its vocabulary, so the
// panel is testable and truthful before any model exists.
//
// ── a delivered plan is UNTRUSTED INPUT ─────────────────────────────────────
// The planner on the other side of that seam will eventually be a model. So
// `deliver()` refuses, and never renders as an offer, a plan that names a
// command the live registry does not hold, that labels a step with an op the
// command does not emit, that passes a parameter the schema does not declare,
// or that omits a required one. A tool list that lies is worse than none.
#ifndef FORGE_UI_ARCHIECOPILOT_HPP
#define FORGE_UI_ARCHIECOPILOT_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── what a step needs picked ────────────────────────────────────────────────
// A command's SELECTION SIGNATURE is part of its contract, so a plan step has to
// say what it will have picked when it runs. It cannot carry the refs themselves:
// step 2 usually operates on the body step 1 has not created yet. So the target
// is SYMBOLIC and resolved against the document at apply time.
enum class PlanSelect : std::uint8_t {
  Keep,           // whatever the user has picked right now — the CoPilot touches nothing
  None,           // clear the selection first (a command that must run on nothing)
  LatestProfile,  // the newest still-bound PROFILE value in the document
  LatestSolid,    // the newest still-bound SOLID value in the document
};

const char* toString(PlanSelect select) noexcept;

// ── one argument of one step ────────────────────────────────────────────────
struct PlanArg {
  std::string name;
  ParamType type = ParamType::Number;
  double number = 0.0;
  std::string text;
  bool flag = false;

  static PlanArg num(std::string name, double value);
  static PlanArg str(std::string name, std::string value);
  static PlanArg on(std::string name, bool value);

  std::string display() const;  // "radius=4"
};

// ── one step ────────────────────────────────────────────────────────────────
struct PlanStep {
  std::string commandId;  // a STABLE registry id; the only thing Apply may use
  // The feature-IR op this step will emit. It is DISPLAY, reconciled against the
  // command's declared featureIrOp by validatePlan(): the panel showing an op
  // other than the one that will run is the whole class of bug this field exists
  // to make impossible, not a second way to choose an operation.
  std::string irOp;
  std::vector<PlanArg> args;
  PlanSelect select = PlanSelect::Keep;
  std::string note;  // why the planner chose these values — shown in the panel

  CommandParams params() const;
  std::string display() const;  // "EXTRUDE  part.extrude(distance=20)"
};

struct Plan {
  std::string intent;
  std::string summary;
  std::vector<PlanStep> steps;

  bool empty() const noexcept { return steps.empty(); }
  std::size_t size() const noexcept { return steps.size(); }
};

// ── the request ─────────────────────────────────────────────────────────────
// The tools a planner may choose from, DERIVED FROM THE LIVE REGISTRY. A planner
// is handed this list rather than a documentation page, so it cannot name a
// command that does not exist, and it can read the declared parameter defaults
// instead of inventing numbers.
struct PlanTool {
  std::string id;
  std::string label;
  std::string featureIrOp;
  std::vector<ParamSpec> schema;
  SelectionSignature signature{};
  bool callableNow = false;  // CommandRegistry::evaluate() as the selection stands
  std::string reason;        // why not, when callableNow is false
};

std::vector<PlanTool> planTools(const CommandRegistry& registry,
                                const SelectionService& selection);

struct PlanRequest {
  std::uint64_t id = 0;  // monotonic; a reply that does not carry it is refused
  std::string intent;
  std::string selectionSummary;
  std::string documentSummary;
  std::vector<PlanTool> tools;
};

struct PlanResponse {
  std::uint64_t id = 0;
  bool ok = false;
  Plan plan;
  std::string error;  // required when ok == false: a silent empty plan is a lie
};

// ── the planner ─────────────────────────────────────────────────────────────
class Planner {
 public:
  virtual ~Planner() = default;
  virtual PlanResponse plan(const PlanRequest& request) = 0;
};

// The planner that ships today: DETERMINISTIC and OFFLINE. Same text, same
// tools, same plan, always — no network, no model, no clock, no randomness. It
// matches a small documented verb vocabulary and REFUSES everything else by
// name, because a planner that guesses is a planner that emits a wrong part.
class LocalPlanner final : public Planner {
 public:
  PlanResponse plan(const PlanRequest& request) override;

  // The verbs this planner understands, sorted. The panel prints them, so the
  // vocabulary a user is shown is the vocabulary the code actually matches.
  static const std::vector<std::string>& vocabulary();
};

// ── validation ──────────────────────────────────────────────────────────────
enum class PlanCheck : std::uint8_t {
  Ok = 0,
  StaleResponse,             // the id does not match the request in flight
  PlannerFailed,             // the planner itself said no
  EmptyPlan,                 // ok == true with nothing in it
  UnknownCommand,            // the plan names a command the registry does not hold
  OpMismatch,                // step.irOp != the command's declared featureIrOp
  UndeclaredParameter,       // an argument the command's schema does not declare
  WrongParameterType,        // declared, but as a different type
  MissingRequiredParameter,  // a required parameter the plan did not state
};

const char* toString(PlanCheck check) noexcept;

// Checks `plan` against the LIVE registry. `detail` names the offending step.
PlanCheck validatePlan(const Plan& plan, const CommandRegistry& registry, std::string& detail);

// ── applying ────────────────────────────────────────────────────────────────
struct StepOutcome {
  std::string commandId;
  DispatchResult dispatch{};
  std::string selection;  // what was picked for it, in words
  std::string detail;     // why the selection could not be resolved, when it could not
  bool ok() const noexcept { return dispatch.ok(); }
};

struct ApplyOutcome {
  std::size_t requested = 0;
  std::size_t applied = 0;
  std::vector<StepOutcome> steps;

  bool allOk() const noexcept { return requested > 0 && applied == requested; }
  std::string summary() const;
};

// APPLY. Every step goes through ForgeShell::run() -> CommandRegistry::dispatch,
// the SAME path a menu click, a keyboard shortcut and a macro step take, so the
// run lands in the same journal and under the same undo stack.
//
// STOPS AT THE FIRST REFUSAL. A plan is a sequence, not a set: step 2 operates on
// the body step 1 created, so continuing past a failure would apply later steps
// to the wrong value. The outcome reports exactly how far it got.
//
// `document` is CONST: it is read to resolve a symbolic selection target to a
// document node, never written. Only the command handler writes.
ApplyOutcome applyPlan(const Plan& plan, ForgeShell& shell, const PartDocument& document);

// ── the transcript ──────────────────────────────────────────────────────────
enum class TranscriptRole : std::uint8_t { User, Copilot, System };
const char* toString(TranscriptRole role) noexcept;

struct TranscriptLine {
  TranscriptRole role = TranscriptRole::System;
  std::string text;
};

// ── the panel's model ───────────────────────────────────────────────────────
// Headless. It owns the transcript, the request in flight and the plan on offer;
// it draws nothing and it performs no I/O.
class ArchieCopilot {
 public:
  // Opens a request for `intent`. Returns 0 and records NOTHING when the intent
  // is blank or a request is already in flight, so a double-press on Send cannot
  // queue two asks against one input line.
  std::uint64_t submit(std::string intent, std::vector<PlanTool> tools,
                       std::string selectionSummary, std::string documentSummary);

  bool requestPending() const noexcept { return pending_; }
  const PlanRequest& request() const noexcept { return request_; }

  // Hands the reply back. Refuses a stale id or a plan that does not validate
  // against `registry`, records why in the transcript either way, and closes the
  // request. Returns what it decided.
  PlanCheck deliver(const PlanResponse& response, const CommandRegistry& registry);

  // The app layer's transport failed (no model configured, a timeout, a refusal).
  // Named separately from a bad plan because they are different problems.
  void failRequest(std::string why);

  bool hasPlan() const noexcept { return !plan_.empty(); }
  const Plan& plan() const noexcept { return plan_; }
  void discardPlan();

  // Applies the plan on offer and CONSUMES it, whether or not every step landed:
  // the document has moved, so the plan that was made against the old one is no
  // longer the plan. Returns an all-zero outcome when there is nothing on offer.
  ApplyOutcome apply(ForgeShell& shell, const PartDocument& document);

  const std::vector<TranscriptLine>& transcript() const noexcept { return transcript_; }
  std::size_t plansAccepted() const noexcept { return accepted_; }
  std::size_t plansRefused() const noexcept { return refused_; }
  std::size_t stepsApplied() const noexcept { return stepsApplied_; }
  void clear();

 private:
  void say(TranscriptRole role, std::string text);

  std::vector<TranscriptLine> transcript_;
  PlanRequest request_;
  Plan plan_;
  bool pending_ = false;
  std::uint64_t nextId_ = 1;
  std::size_t accepted_ = 0;
  std::size_t refused_ = 0;
  std::size_t stepsApplied_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_ARCHIECOPILOT_HPP
