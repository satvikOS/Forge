// ui/include/forge/ui/FeatureHistory.hpp
//
// THE FEATURE TREE AS A HISTORY MODELLER — the dependency graph a PartDocument
// implies, the CONSEQUENCE of a history edit computed before it happens, and the
// undoable commands that perform one.
//
// ── why this is a separate header ───────────────────────────────────────────
// PartCommands.hpp owns the RECEIVER: PartDocument holds the statements and the
// primitive mutators (setSuppressed, setDeleted, setLabel, setRollback,
// moveFeature) that change them. It deliberately knows nothing about what a
// change MEANS to the rest of the tree. Everything here is derived from those
// statements and adds no state of its own, which is what keeps "what will this
// break?" answerable without a second model of the document to fall out of date.
//
// ── the consequence preview is not a model, it is the answer ────────────────
// `previewDelete()` does not reason about what a delete would do. It COPIES the
// document, performs the delete on the copy, and diffs the two emission plans.
// The preview and the outcome are therefore the same computation, and a preview
// that disagrees with what happens is not expressible. That matters more here
// than anywhere else in this layer: a "what breaks" dialog that is wrong is
// worse than no dialog, because the user acts on it.
//
// ── THE BINDING CONSTRAINT ──────────────────────────────────────────────────
// "dont gate anything if you do that then how will Archie generate ultra long
// feature trees for Kernel to execute."  Nothing here REFUSES a history edit.
//
//   * deleting a feature that later features consume is ALLOWED. What happens is
//     REPRESENTED: a pass-through feature (fillet, hole, pattern, boolean, tag)
//     rebases its consumers onto its own operand, and a value-producing one
//     (extrude, loft) reports every consumer as broken, BY NAME, with the
//     statement that broke it named too.
//   * suppressing is the same, and reversible.
//   * reordering above an operand is not representable in an SSA IR at all --
//     `%N` must resolve backwards -- so the move is CLAMPED to the largest legal
//     one and the statement that stopped it is named. The gesture is never
//     ignored and never refused; it does as much as it can and says why not
//     more.
//   * rolling back past the ends of the tree clamps to the ends.
//
// The one place a refusal survives is a renumbering whose result would not
// validate, which the window arithmetic makes unreachable; it names the offending
// statement so a repair loop has something to act on.
#ifndef FORGE_UI_FEATUREHISTORY_HPP
#define FORGE_UI_FEATUREHISTORY_HPP

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── the dependency graph ────────────────────────────────────────────────────
// Derived from the `%ref` arguments, which are the ONLY way one statement can
// depend on another in this IR. Every list is ascending and duplicate-free.
std::vector<int> featureOperands(const PartDocument& doc, int irId);
std::vector<int> featureDependents(const PartDocument& doc, int irId);
std::vector<int> featureDependentClosure(const PartDocument& doc, int irId);

// ── PERSISTENT NAMING (the L4 TAG/@name mechanism) ──────────────────────────
// The kernel already solves the hard half. `TAG(%body, "@name", "declaring-sel")`
// is a PASS-THROUGH op (FeatureTree.hpp: "it returns %body unchanged. A naming
// mechanism that can alter the solid is a defect generator") that binds @name to
// the face signature the declaring selector resolves to, and afterwards "@name"
// is legal anywhere a selector is legal and "survives ops that renumber faces —
// which every edit does". FeatureTreeCompiler.cpp::resolveSelector implements it:
// it re-finds the face by SIGNATURE (kind, concavity, axis position, direction,
// radius), refuses a match that has moved further than its own diameter rather
// than silently retargeting to a different hole, refuses an ambiguous match, and
// — with the `@name|witness` form — checks the name against an independent
// predicate and reports a retarget instead of returning one.
//
// So the UI does NOT invent a naming scheme. It reads the TAG statements the
// document already holds, and renaming is an ARGUMENT EDIT of the TAG statement,
// which goes through PartDocument::editFeatureArgs and the existing undo stack.
struct PersistentName {
  int irId = 0;             // the TAG statement itself
  int taggedId = 0;         // the value it names (its %body operand)
  std::string name;         // "@bore_main", exactly as emitted
  std::string declaredBy;   // the declaring selector, e.g. "bore:max"
};
std::vector<PersistentName> persistentNames(const PartDocument& doc);
// The persistent name that names the value produced by `irId`, or an empty
// string. A TAG names its OPERAND, so this looks for a TAG whose %body is irId.
std::string persistentNameOf(const PartDocument& doc, int irId);

// Why the kernel would refuse this name, or nullptr when it would not. The rules
// are opTag()'s, not house style: it must start with '@', it must not be empty,
// and every remaining character must be [A-Za-z0-9_] because the kernel
// lowercases the key and requires it to survive that.
const char* persistentNameProblem(const std::string& name) noexcept;
// "bore_main" -> "@bore_main"; already-prefixed input is left alone.
std::string toPersistentName(const std::string& raw);

// ── consequence preview ─────────────────────────────────────────────────────
// One statement whose EMISSION STATUS the proposed edit changes. Statements the
// edit does not touch are not listed: a dialog that lists a 71-statement tree to
// report one change is a dialog nobody reads.
struct ImpactRow {
  int irId = 0;
  std::string op;
  std::string label;
  bool wasEmitted = false;
  bool willEmit = false;
  PartDocument::OmitReason before = PartDocument::OmitReason::None;
  PartDocument::OmitReason after = PartDocument::OmitReason::None;
  // For OperandUnavailable: the statement whose value went missing. This is the
  // "name the op so a repair loop can act" half of the binding constraint.
  int blockingId = 0;
  // True when the statement still builds but now consumes a DIFFERENT value --
  // the pass-through rebase. Nothing breaks; the history just got shorter.
  bool rebased = false;
};

struct Impact {
  // False only when `irId` names no statement at all. It is NOT a veto: an edit
  // that breaks half the tree still reports possible == true, with every break
  // listed. Refusing here is the capability gate the owner's constraint forbids.
  bool possible = false;
  std::vector<ImpactRow> rows;
  std::size_t stops = 0;      // statements that were emitted and will not be
  std::size_t resumes = 0;    // statements that were not emitted and now will be
  std::size_t rebasedCount = 0;
  // The program the document WILL emit if this edit is applied -- the same text
  // the kernel would receive, produced by the same code that will produce it.
  std::string program;
  // Reorder only: where the move actually lands, and the statement that stopped
  // it from going further. clampedTo == irId means it does not move.
  int clampedTo = 0;
  int blockedBy = 0;
  // One line a UI can put in front of a user without composing it itself.
  std::string summary;
};

Impact previewSuppress(const PartDocument& doc, int irId, bool on);
Impact previewDelete(const PartDocument& doc, int irId);
Impact previewRollback(const PartDocument& doc, int irId);
Impact previewMove(const PartDocument& doc, int irId, int newPosition);

// ── per-node error surfacing ────────────────────────────────────────────────
// What the tree shows on one row. `Ok` and `Suppressed` and `Rolled` come from
// the document; `Error` comes from the KERNEL, whose failure is reported in
// EMITTED ids ("first invalid solid is produced by op %2 EXTRUDE (line 2)") and
// has to be mapped back through the emission plan before a row can be blamed.
// Doing that mapping anywhere else is how a renumbering silently blames the
// wrong feature.
enum class FeatureIssue : std::uint8_t {
  None = 0,
  Suppressed,
  Deleted,
  RolledBack,
  BrokenOperand,   // an operand it consumes is not emitted
  Orphaned,        // nothing consumes it any more
  BuildFailed,     // the kernel named THIS statement
};

const char* toString(FeatureIssue issue) noexcept;

struct FeatureDiagnosis {
  int irId = 0;
  FeatureIssue issue = FeatureIssue::None;
  int blockingId = 0;
  // Human, and specific: "operand %4 (EXTRUDE) is suppressed", or the verifier's
  // own words when the kernel is the one complaining.
  std::string detail;
};

// The whole tree's diagnosis in one pass over one emission plan.
// `failedEmittedId` and `kernelError` are the build report: the emitted op the
// kernel blamed (<= 0 when it did not blame one) and what it said. The verifier's
// message is carried VERBATIM -- "VERIFY failed: holes=36 (got 30)" is the
// actionable thing, and paraphrasing it loses the numbers.
std::vector<FeatureDiagnosis> diagnoseFeatures(const PartDocument& doc,
                                               int failedEmittedId,
                                               const std::string& kernelError);
FeatureDiagnosis diagnoseFeature(const PartDocument& doc, int irId, int failedEmittedId,
                                 const std::string& kernelError);

// ── the ConcreteCommands (GoF), sharing ONE memento ─────────────────────────
// PartDocument::Snapshot is a record COUNT plus the bindings: exactly enough to
// reverse an APPEND, and nothing else. Every operation here changes state INSIDE
// the records, and a reorder renumbers all of them, so their memento is the whole
// document (PartDocument::History). It is small -- a 71-statement tree is a few
// kilobytes -- and being the whole state it cannot be a PARTIAL restore, which is
// the failure mode a hand-written inverse has.
class HistoryEdit : public UndoableEdit {
 public:
  const std::string& label() const noexcept final { return label_; }
  bool apply(PartDocument& doc) final;
  void revert(PartDocument& doc) final;

 protected:
  explicit HistoryEdit(std::string label) : label_(std::move(label)) {}
  // Returns false for "nothing to do", so an edit that changes nothing is never
  // pushed and Ctrl+Z never lands on a step that does nothing.
  virtual bool mutate(PartDocument& doc) = 0;

 private:
  std::string label_;
  PartDocument::History before_{};
};

class SuppressFeatureEdit final : public HistoryEdit {
 public:
  SuppressFeatureEdit(int irId, bool on, std::string label);

 protected:
  bool mutate(PartDocument& doc) override;

 private:
  int irId_;
  bool on_;
};

class DeleteFeatureEdit final : public HistoryEdit {
 public:
  DeleteFeatureEdit(int irId, std::string label);

 protected:
  bool mutate(PartDocument& doc) override;

 private:
  int irId_;
};

class RenameFeatureEdit final : public HistoryEdit {
 public:
  RenameFeatureEdit(int irId, std::string name, std::string label);

 protected:
  bool mutate(PartDocument& doc) override;

 private:
  int irId_;
  std::string name_;
};

class RollbackEdit final : public HistoryEdit {
 public:
  RollbackEdit(int position, std::string label);

 protected:
  bool mutate(PartDocument& doc) override;

 private:
  int position_;
};

class MoveFeatureEdit final : public HistoryEdit {
 public:
  MoveFeatureEdit(int irId, int newPosition, std::string label);

  // Where it actually landed, and what stopped it going further. Read after
  // UndoStack::perform() to tell the user the drag was clamped rather than
  // ignored.
  int clampedTo() const noexcept { return clampedTo_; }
  int blockedBy() const noexcept { return blockedBy_; }

 protected:
  bool mutate(PartDocument& doc) override;

 private:
  int irId_;
  int newPosition_;
  int clampedTo_ = 0;
  int blockedBy_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_FEATUREHISTORY_HPP
