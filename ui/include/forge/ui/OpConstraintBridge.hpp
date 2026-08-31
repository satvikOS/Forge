// ui/include/forge/ui/OpConstraintBridge.hpp
//
// THE OP-CONSTRAINT BRIDGE -- the one place that answers "may this op be
// emitted?" against the generated vocabulary of USER-INVOCABLE ops.
//
// D-021 decided that forge::ui is the surface that defines "what a user can
// use", and implementation/sacrosanct/archie_op_vocabulary.json is the
// machine-readable form of that set. This class is that file made enforceable:
// it takes a PROPOSED OP PLAN -- the statements a planner (Archie, a macro
// recorder, a scripted test) would like the document to gain -- and accepts or
// REFUSES each one with a reason that names the op and says why.
//
// WHY IT IS NOT AN ALLOW-LIST IN THIS FILE
//   The table lives in ui/include/forge/ui/ArchieOpVocabulary.hpp, which is
//   GENERATED from the vocabulary by
//   implementation/sacrosanct/tools/gen_op_constraint_table.py. Nothing here
//   transcribes an op name. A hand-copied list would be a second source of
//   truth and the two would drift apart silently -- which is the exact failure
//   the vocabulary asset exists to prevent.
//
// WHY IT IS NOT THE KERNEL'S OP TABLE
//   forge::ui::irOpTable() has 40 ops and forge::ft::compile() will happily
//   build 40. Only 18 are reachable through a command a user can invoke. A
//   planner validated against the kernel table looks correct and emits programs
//   no user of the app could ever have produced -- exactly the gap the
//   constraint exists to close. `ForbiddenOp` is a SEPARATE verdict from
//   `UnknownOp` for that reason: "the kernel has it and the app does not expose
//   it" and "no such op anywhere" are different facts and must not look alike.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   It does not build geometry, does not touch a document, and does not
//   dispatch. Enforcement at the point of emission is PartDocument::appendFeature
//   and CommandRegistry::dispatch; this is the CHECK a caller runs BEFORE it
//   spends a dispatch, and the same check a gate runs over a corpus offline.
//
// HEADLESS: no ImGui, no GPU, no display, no sockets, no file I/O. The table is
// constexpr and the only allocation is the vector of rulings a caller asked for.
#ifndef FORGE_UI_OPCONSTRAINTBRIDGE_HPP
#define FORGE_UI_OPCONSTRAINTBRIDGE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── why an op was refused ───────────────────────────────────────────────────
// Every value below is a DIFFERENT FACT about the proposal, never a severity.
// Collapsing them into one "invalid" is how a planner learns nothing from a
// refusal: "BOX is not in the app" and "EXTRUDE with four arguments" need
// different fixes.
enum class OpConstraint : std::uint8_t {
  Ok = 0,
  EmptyOp,              // no op name at all
  UnknownOp,            // not a feature-IR op in any table, kernel included
  ForbiddenOp,          // a real kernel op that NO forge::ui command emits
  WrongArity,           // an argument count no user command can emit
  WrongSelectionKind,   // the stated selection is not one any emitting command takes
  WrongSelectionCount,  // right kind, wrong number picked
  BadStatementId,       // id <= 0, or not the next statement in the plan
  MissingValueRef,      // OP(%body, ...) and the first argument is not a %ref
  UnexpectedValueRef,   // a CREATOR (RECT/CIRCLE/RING) was given a leading %ref
  ForwardValueRef,      // %N names a later or equal statement; it can never resolve
  UnresolvedValueRef,   // %N names no statement in this plan or its prior values
  WrongValueKind,       // EXTRUDE was handed a SOLID where it consumes a PROFILE
};

const char* toString(OpConstraint check) noexcept;

// ── the proposal ────────────────────────────────────────────────────────────
// One statement a planner would like emitted, plus the selection the user would
// have had picked for it. `selection == EntityKind::Any` means the plan does not
// state a selection, and the bridge then checks everything EXCEPT the selection
// -- an absent claim is not a wrong claim.
struct ProposedOp {
  IrLine line;
  EntityKind selection = EntityKind::Any;
  std::size_t selectionCount = 0;
};

// ── one verdict ─────────────────────────────────────────────────────────────
struct OpRuling {
  OpConstraint verdict = OpConstraint::Ok;
  std::string op;       // the op the ruling is about, echoed so a log line stands alone
  std::string reason;   // names the op AND why; empty only when accepted
  int statementId = 0;

  bool accepted() const noexcept { return verdict == OpConstraint::Ok; }
};

// ── the verdict on a whole plan ─────────────────────────────────────────────
struct PlanRuling {
  std::vector<OpRuling> rulings;
  std::size_t accepted = 0;
  std::size_t rejected = 0;

  // FALSE for an EMPTY plan, deliberately: "nothing was refused" is not the same
  // claim as "a program was accepted", and a caller that treats an empty plan as
  // a pass would report success for a planner that emitted nothing at all.
  bool allAccepted() const noexcept { return rejected == 0 && !rulings.empty(); }
  const OpRuling* firstRejection() const noexcept;
  std::string report() const;  // one line per statement, in plan order
};

// ── the generated table, in runtime form ────────────────────────────────────
// A value type on purpose: a gate can copy it, PERTURB it and re-run the bridge
// against the perturbation. That is how the mutations in
// ui/test/op_constraint_bridge_test.cpp prove the checks can fail.
struct OpVocabulary {
  // An argument COUNT some user command can actually emit. Narrower than the
  // kernel arity by design: the kernel accepts EXTRUDE with 4 arguments and no
  // command in the app can produce that form.
  struct ArgCounts {
    std::size_t min = 0;
    std::size_t max = 0;  // kIrArgsUnbounded for LOFT
  };

  struct Op {
    std::string op;
    IrValueKind produces = IrValueKind::None;
    std::vector<IrValueKind> consumes;  // empty => a CREATOR
    std::size_t kernelMinArgs = 0;
    std::size_t kernelMaxArgs = 0;
    bool firstArgIsValueRef = false;
    std::vector<ArgCounts> emittedForms;
    std::vector<std::string> commands;  // the command ids that emit this op
  };

  struct Forbidden {
    std::string op;
    std::string reason;  // the vocabulary's own words, so a refusal quotes the source
  };

  struct Command {
    std::string id;
    std::string op;
    EntityKind selection = EntityKind::None;
    std::size_t selectionMin = 0;
    std::size_t selectionMax = 0;  // kIrArgsUnbounded when open-ended
    IrValueKind produces = IrValueKind::None;
  };

  std::vector<Op> ops;
  std::vector<Forbidden> forbidden;
  std::vector<Command> commands;
  std::size_t kernelOpCount = 0;
  std::size_t registryCommandCount = 0;
  std::size_t commandsEmittingIr = 0;
  std::string sourcePath;
  std::string sha256;
  std::string schema;

  // A value-kind or selection-kind spelling in the generated table that this
  // build could not map onto a forge::ui enum. Non-empty means the vocabulary
  // and the enums have diverged; the gate asserts it is empty rather than
  // letting an unmapped kind quietly become `None` and pass every check.
  std::vector<std::string> unmappedSpellings;

  const Op* find(const std::string& op) const noexcept;
  const Forbidden* findForbidden(const std::string& op) const noexcept;
  std::vector<std::string> opNames() const;
};

// The vocabulary exactly as generated. Built once, on first use, from the
// constexpr tables in ArchieOpVocabulary.hpp -- no file is read, ever.
const OpVocabulary& generatedVocabulary();

// ── is the allowed set even a LANGUAGE? ─────────────────────────────────────
// D-015 recorded that forge::ui had 31 commands, 14 that emit IR and NOT ONE
// that CREATES a value: every emitting command consumed a selection that had to
// exist already, so "emit only what users can invoke" described an EMPTY
// language -- there was nothing for EXTRUDE to extrude.
//
// This is that question COMPUTED rather than remembered. A CREATOR is an allowed
// op that takes no leading value reference AND has a command needing no
// selection, so it is reachable from an empty document. From the creators,
// `reachableKinds` is the fixpoint: add an op's produced kind once every kind it
// consumes is reachable. Any kind an allowed op consumes and the fixpoint never
// reaches is OWED -- a creator the UI does not have. It is reported, never
// papered over by widening the allowed set.
struct VocabularyClosure {
  std::vector<std::string> creatorOps;
  std::vector<IrValueKind> reachableKinds;
  std::vector<IrValueKind> requiredKinds;
  std::vector<IrValueKind> owedCreatorKinds;  // OWED: consumed, never producible
  std::vector<std::string> unreachableOps;    // allowed, but no legal program reaches them

  bool closed() const noexcept { return owedCreatorKinds.empty() && unreachableOps.empty(); }
  std::string report() const;
};

// ── the bridge ──────────────────────────────────────────────────────────────
class OpConstraintBridge {
 public:
  OpConstraintBridge();                                  // the generated vocabulary
  explicit OpConstraintBridge(OpVocabulary vocabulary);  // gates only

  const OpVocabulary& vocabulary() const noexcept { return vocabulary_; }
  const VocabularyClosure& closure() const noexcept { return closure_; }

  bool allows(const std::string& op) const noexcept;
  const std::vector<std::string>& allowedOps() const noexcept { return allowed_; }
  std::vector<std::string> forbiddenOps() const;
  IrValueKind produces(const std::string& op) const noexcept;
  std::vector<EntityKind> acceptedSelections(const std::string& op) const;

  // Context-free: membership, arity, leading value ref and the stated selection.
  // Value flow needs the plan, so a %ref is only shape-checked here.
  OpRuling check(const ProposedOp& proposal) const;

  // The whole plan, in order, with value flow. `priorValues[i]` is the kind of
  // statement id i+1 that ALREADY exists (a seeded profile, an opened file), so
  // the first proposal must be numbered priorValues.size() + 1.
  PlanRuling check(const std::vector<ProposedOp>& plan,
                   const std::vector<IrValueKind>& priorValues = {}) const;
  PlanRuling check(const std::vector<IrLine>& program,
                   const std::vector<IrValueKind>& priorValues = {}) const;

 private:
  OpRuling accept(const ProposedOp& proposal) const;
  OpRuling reject(const ProposedOp& proposal, OpConstraint verdict, std::string reason) const;

  OpVocabulary vocabulary_;
  VocabularyClosure closure_;
  std::vector<std::string> allowed_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_OPCONSTRAINTBRIDGE_HPP
