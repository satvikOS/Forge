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
//
// ── AND A PARAMETER'S VALUE IS UNTRUSTED TOO ────────────────────────────────
// Those four checks read a parameter's NAME and its TYPE. None of them reads
// what it SAYS, and that was a hole with a name: `part.fillet` and
// `part.chamfer` take a `selector` TEXT parameter and put it straight into a
// feature-IR argument, and `part.mirror` does the same with `plane`. So a plan
// whose every step named an allowed op could still carry a REFUSED op inside an
// argument -- and, because `IrLine::text()` escapes nothing and forge::ft reads
// statements line by line, a selector holding a quote and a newline carries a
// WHOLE FURTHER STATEMENT.
//
// forge::ui::OpConstraintBridge::checkValue() is the rule that closes it, and
// validatePlan() runs it over every value a plan states. The bridge is passed
// IN rather than constructed here: the CoPilot enforces the constraint, it does
// not get to choose it.
#ifndef FORGE_UI_ARCHIECOPILOT_HPP
#define FORGE_UI_ARCHIECOPILOT_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
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
  // APPENDED, never inserted. The IR value model has THREE kinds -- PROFILE,
  // WIRE and SOLID -- and this enum named two of them, so the only op that
  // consumes a WIRE (LOFT) was unreachable from any plan however it was written:
  // resolveSelection read the target as "LatestProfile ? Profile : Solid" and
  // there was no third answer, while the LocalPlanner's own `loft` verb asked for
  // the newest PROFILE and handed it to a command whose signature is Wire. That
  // is a refusal by omission, and the constraint on this surface is REPRESENT /
  // REPAIR / TOLERATE, never refuse. MEASURED as unreachable by
  // ui/test/differential_gate_test.cpp before this value existed.
  LatestWire,     // the newest still-bound WIRE value (a RING / WIRE section)
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
  // HOW MANY of that kind. `select` names a value KIND and, until this field, a
  // step could not say a COUNT -- so `resolveSelection` took exactly
  // `signature.minCount` and an open-ended selection always got the MINIMUM. The
  // three-ring nozzle came out as `LOFT(%2, %3, RULED)`: a two-section loft, a
  // DIFFERENT SOLID, silently, from a plan that named three sections. MEASURED by
  // ui/test/differential_gate_test.cpp as the one corpus tree whose CoPilot arm
  // diverged from the planner's own text.
  //
  // 0 means "the signature's own minimum" -- exactly today's behaviour, so a plan
  // that does not care is unchanged and nothing silently widens. A step that means
  // three sections now says three, and gets three.
  std::size_t selectCount = 0;
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
  // The op-constraint gate refused a step. Which constraint, and why, is in that
  // step's StepVerdict -- collapsing every refusal into one value is how a
  // planner learns nothing it can act on, so this value is the CATEGORY and the
  // OpConstraint beside it is the fact.
  OpConstraintRefused,
};

const char* toString(PlanCheck check) noexcept;

// ── one step's op-constraint verdict ────────────────────────────────────────
// Kept PER STEP, and kept even when the step is accepted, because the panel has
// to show a verdict for every line rather than only for the first bad one: a
// user deciding whether to accept a plan is entitled to see what was checked.
struct StepVerdict {
  std::size_t index = 0;   // 1-based, as the panel numbers them
  std::string commandId;
  std::string irOp;        // the op the COMMAND declares, never the plan's claim
  bool refused = false;

  // The op-constraint fact, WHEN THAT IS WHAT REFUSED THE STEP. It stays `Ok` on
  // a refusal the bridge had no part in -- an undeclared parameter is a schema
  // fact, not an op-constraint fact, and labelling it with the nearest
  // OpConstraint value would put a wrong reason in front of a user. The
  // PlanVerdict's `check` names those.
  OpConstraint constraint = OpConstraint::Ok;
  std::string reason;      // why; empty only when accepted
  // The parameter whose VALUE was refused, when that is what happened. Empty
  // when the refusal was about the op itself.
  std::string parameter;

  bool accepted() const noexcept { return !refused; }
  std::string display() const;  // "3  FILLET  REFUSE forbidden_op_in_argument: ..."
};

// The verdict on a whole plan: the registry/schema check AND the op-constraint
// check, with one row per step either way.
struct PlanVerdict {
  PlanCheck check = PlanCheck::Ok;
  std::string detail;               // names the offending step, in words
  std::vector<StepVerdict> steps;   // one per plan step, in plan order

  bool accepted() const noexcept { return check == PlanCheck::Ok; }
  std::size_t refusedSteps() const noexcept;
  const StepVerdict* firstRefusal() const noexcept;
  std::string report() const;       // one line per step, for the transcript and a log
};

// Checks `plan` against the LIVE registry AND the op-constraint gate.
//
// The registry half rules on a parameter's NAME and TYPE. The gate half rules on
// its VALUE -- every Text parameter a step states is judged as the feature-IR
// argument the command will build from it, and every Number likewise. That is
// the difference between "the plan names only ops a user can invoke" and "the
// plan can only PRODUCE ops a user can invoke".
//
// WHAT IT CANNOT CHECK, STATED PLAINLY: a command builds its argument LIST
// inside its own execute() body, so this cannot know the arity or the operand
// order the step will emit -- only the op and the values. Arity and value flow
// are checked where the statement exists, by OpConstraintBridge::check() over
// PartDocument::records().
PlanVerdict validatePlan(const Plan& plan, const CommandRegistry& registry,
                         const OpConstraintBridge& bridge);

// ── applying ────────────────────────────────────────────────────────────────
struct StepOutcome {
  std::string commandId;
  // The op-constraint verdict this step was given BEFORE anything was
  // dispatched. A step whose constraint is not Ok WAS NEVER DISPATCHED: `ran`
  // stays false and `dispatch` keeps its default. That is why `ran` exists at
  // all -- a default-constructed DispatchResult reads as Ok, so without it a
  // step the gate blocked would be indistinguishable from a step that ran and
  // succeeded.
  // `gateRefused` is the fact; `constraint` is WHICH constraint, and it stays
  // `Ok` when the gate refused the step for something that is not an op
  // constraint at all (an unknown command id). Deriving "was it blocked" from
  // `constraint != Ok` would force every such refusal to borrow the nearest
  // op-constraint name and report a wrong reason.
  bool gateRefused = false;
  OpConstraint constraint = OpConstraint::Ok;
  std::string constraintReason;
  bool ran = false;

  DispatchResult dispatch{};
  std::string selection;  // what was picked for it, in words
  std::string detail;     // why the selection could not be resolved, when it could not

  bool blocked() const noexcept { return gateRefused; }
  bool ok() const noexcept { return ran && dispatch.ok(); }
};

struct ApplyOutcome {
  std::size_t requested = 0;
  std::size_t applied = 0;
  std::size_t blocked = 0;  // steps the op-constraint gate refused, never dispatched

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
//
// RE-RUNS THE OP-CONSTRAINT GATE, and refuses to dispatch a step it refuses.
// deliver() already ran it, so in the CoPilot's own flow this can only agree --
// and it is done anyway, for the reason the UnknownCommand branch below is done
// anyway: THIS FUNCTION IS THE DOOR, and a door that trusts its caller is not a
// door. Nothing forces a caller to have come through deliver(): a gate, a macro
// runner or a future transport can hand a Plan straight here. A blocked step
// STOPS THE PLAN, exactly as a failed dispatch does, because the steps after it
// were written to consume what it would have produced.
ApplyOutcome applyPlan(const Plan& plan, ForgeShell& shell, const PartDocument& document,
                       const OpConstraintBridge& bridge);

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

  // Hands the reply back. Refuses a stale id, or a plan that does not validate
  // against `registry` AND the op-constraint gate, records why in the transcript
  // either way, and closes the request. Returns what it decided.
  //
  // A REFUSED PLAN IS STILL SHOWN. `verdict()` keeps every step's ruling
  // afterwards, so the panel can display WHICH line was refused, by WHICH
  // constraint and WHY -- but `plan()` stays empty, so there is nothing to
  // accept. Refusing silently would leave a user watching a CoPilot that
  // answers nothing and says nothing about it.
  PlanCheck deliver(const PlanResponse& response, const CommandRegistry& registry);

  // The app layer's transport failed (no model configured, a timeout, a refusal).
  // Named separately from a bad plan because they are different problems.
  void failRequest(std::string why);

  bool hasPlan() const noexcept { return !plan_.empty(); }
  const Plan& plan() const noexcept { return plan_; }

  // The op-constraint ruling on the last plan delivered, accepted or refused --
  // one row per step, in plan order. This is what the panel renders beside each
  // line, and it is the ONLY thing that says which constraint refused a line.
  const PlanVerdict& verdict() const noexcept { return verdict_; }

  // REJECT. The user read the plan and said no. Separate from a refusal by the
  // gate, and separate from apply(): a plan a user declined is not a plan that
  // failed, and the transcript says which of the two happened.
  void discardPlan();

  // ACCEPT. Applies the plan on offer and CONSUMES it, whether or not every step
  // landed: the document has moved, so the plan that was made against the old
  // one is no longer the plan. Returns an all-zero outcome when there is nothing
  // on offer. Every step passes the op-constraint gate again on the way through
  // applyPlan(); a step the gate refuses is never dispatched.
  ApplyOutcome apply(ForgeShell& shell, const PartDocument& document);

  const std::vector<TranscriptLine>& transcript() const noexcept { return transcript_; }
  std::size_t plansAccepted() const noexcept { return accepted_; }
  std::size_t plansRefused() const noexcept { return refused_; }
  std::size_t plansRejectedByUser() const noexcept { return rejectedByUser_; }
  std::size_t stepsApplied() const noexcept { return stepsApplied_; }
  // Steps the op-constraint gate refused AT THE DOOR, counted separately from
  // steps that dispatched and failed. It is the number that answers "did the
  // CoPilot ever run something the gate had rejected", and the answer must be
  // that those steps were never dispatched at all.
  std::size_t stepsBlocked() const noexcept { return stepsBlocked_; }
  void clear();

  // The constraint this CoPilot enforces. Held by value and built from the
  // GENERATED vocabulary: there is no setter, because a CoPilot that could be
  // handed a wider constraint than the app's own would be a second answer to
  // "what may be emitted", which is the whole failure the bridge exists to
  // prevent. Gates that need a perturbed vocabulary call validatePlan() and
  // applyPlan() directly with one.
  const OpConstraintBridge& bridge() const noexcept { return bridge_; }

 private:
  void say(TranscriptRole role, std::string text);

  OpConstraintBridge bridge_;
  std::vector<TranscriptLine> transcript_;
  PlanRequest request_;
  Plan plan_;
  PlanVerdict verdict_;
  bool pending_ = false;
  std::uint64_t nextId_ = 1;
  std::size_t accepted_ = 0;
  std::size_t refused_ = 0;
  std::size_t rejectedByUser_ = 0;
  std::size_t stepsApplied_ = 0;
  std::size_t stepsBlocked_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_ARCHIECOPILOT_HPP
