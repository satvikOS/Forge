// ui/include/forge/ui/PartCommands.hpp
//
// THE PART WORKSPACE'S PRODUCT COMMANDS — the first real content of the s19.2
// registry. Until this file existed, `CommandRegistry` was an empty mechanism:
// grep for `registerCommand|builtin|Builtin` in CommandRegistry.cpp printed
// nothing, every gate registered its own throwaway fixture, and no JS behavior
// could ever be retired against it. A high check count is not migration
// coverage; owning the commands is.
//
// ── the pattern, named ──────────────────────────────────────────────────────
// This is the GoF COMMAND pattern (Gamma, Helm, Johnson & Vlissides, *Design
// Patterns*, 1994, p.233) in its full form, with the MEMENTO variant (p.283)
// used for undo exactly as that chapter prescribes for a receiver whose inverse
// is not cheaply computable:
//
//   Command   = `CommandDescriptor` in the registry — the invoker-independent
//               request. A menu item, a keystroke, a palette pick, a macro step
//               and an Archie tool call are all *invokers* of the same object.
//   Receiver  = `PartDocument` — the feature-IR program being built.
//   ConcreteCommand = `AppendFeatureEdit` — one reversible mutation.
//   Caretaker = `UndoStack` — the explicit undo/redo stacks. `perform()` applies
//               and pushes; a new edit clears the redo stack, which is the
//               linear-undo contract every CAD system ships.
//   Memento   = `PartDocument::Snapshot` — the state the edit captured before it
//               ran. GoF's alternative ("store enough state to reverse") is
//               unusable here: a boolean ABSORBS both operands' name bindings,
//               so the inverse is not derivable from the command's arguments.
//
// ── what a command actually does ────────────────────────────────────────────
// It emits ONE LINE of feature-IR (see FeatureIr.hpp) into the document. It does
// not call the kernel, own a widget callback, or touch a renderer. That is what
// makes the same command reachable from a menu, a macro and Archie, and what
// makes it testable headless: the assertion is on the emitted IR text.
#ifndef FORGE_UI_PARTCOMMANDS_HPP
#define FORGE_UI_PARTCOMMANDS_HPP

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"

namespace forge::ui {

// The value kinds forge::ft's IR model defines (FeatureTree.hpp, "IR VALUE
// MODEL"). A command's selection must resolve to the right one: EXTRUDE consumes
// a PROFILE, FILLET consumes a SOLID, and offering either on the other is the
// mis-selection a signature exists to refuse.
//
// THIS ENUM AND THE KERNEL'S ARE SEPARATE, AND NOTHING IN THE COMPILER RELATES
// THEM. `forge::ft`'s Val::Kind (FeatureTreeCompiler.cpp) is the kernel's answer;
// this is the app's. They are joined only by the vocabulary derivation, which
// since the SKETCH family REFUSES TO PUBLISH when the two disagree
// (gen_archie_op_vocabulary.py, "value-kind disagreement"). Adding a kind here
// without adding it there -- or naming it differently -- is caught there, not
// silently averaged into `None`.
//
// Sketch / SketchRef arrived with the constraint-solver family and are NOT a
// second spelling of Profile:
//
//   * Sketch    -- a sketch still under construction: mutable, constrainable,
//                  NOT yet solved. SKETCH and CON carry it (CON is pass-through).
//   * SketchRef -- a point or curve INSIDE a sketch. A constraint has to name two
//                  entities and the IR addresses every value by its %N creation
//                  id, so an entity has to BE a value. SPT/SLINE/SCIRC/SARC.
//   * Profile   -- what a SOLVEd sketch becomes. The exit is free: the kernel's
//                  refProfile() already returns a SketchHandle, so a solved
//                  sketch IS a profile and EXTRUDE consumes it unchanged.
//
// That last line is the whole reason the kind is not decorative, and it is why
// SOLVE must produce Profile here and not Sketch.
//
//   * Surface   -- a SHEET BODY: a set of faces not required to be closed, sewn,
//                  manifold or even non-empty. It is the kind free-form geometry
//                  lives in, and its absence was structural rather than
//                  incidental -- with only three kinds there was no value a NURBS
//                  patch or an extracted face set could be held in, so no op
//                  could produce or consume one and the whole surfacing half of
//                  the kernel was unreachable from the IR.
//
// Kinds are APPENDED, never inserted. Every use in this codebase is an equality
// test or a name lookup, never an ordering or a numeric cast to a fixed set, so
// adding one at the end cannot change what an existing comparison means. The one
// place that must be updated by hand is the enumeration in OpConstraintBridge's
// mapValueKind, and ui/test/op_constraint_bridge_test.cpp proves that mapping is
// TOTAL by round-tripping every kind through toString.
enum class IrValueKind : std::uint8_t {
    None, Profile, Wire, Solid, Sketch, SketchRef, Surface };

const char* toString(IrValueKind kind) noexcept;

// EVERY IrValueKind, once. Two call sites turn a STRING back into a kind -- the
// vocabulary reader (OpConstraintBridge's mapValueKind) and the .fpart document
// reader (forge-desktop's kindFromName) -- and each used to carry its own list of
// the kinds it knew. The desktop one was an if-chain over four literals, so
// -Wswitch could not see it: the writer emits toString(kind) for ANY kind, and a
// kind missing from that chain writes a file that cannot be read back. An
// asymmetric round-trip is not a compile error in either half.
//
// One list, both consumers, and the spelling still comes from toString() rather
// than a literal, so a kind added to the enum is a compile error here (the array
// size) instead of a file that saves and will not open.
inline constexpr IrValueKind kAllIrValueKinds[] = {
    IrValueKind::None,   IrValueKind::Profile,   IrValueKind::Wire,
    IrValueKind::Solid,  IrValueKind::Sketch,    IrValueKind::SketchRef,
    IrValueKind::Surface,
};

// Turn a kind's toString() spelling back into the kind. Case-sensitive: callers
// that accept the vocabulary's upper-case spellings lower them first.
bool irValueKindFromName(std::string_view name, IrValueKind& out) noexcept;

struct FeatureRecord {
  int irId = 0;                 // == line.id; also the 1-based document position
  std::string commandId;        // "" for a value seeded before any command ran
  std::string label;            // feature-tree row label
  IrLine line;                  // the emitted statement
  IrValueKind produces = IrValueKind::Solid;

  // ── history state (a history modeller, not an append-only log) ───────────
  // `uid` is the statement's IDENTITY, and it is the only thing here that is
  // not user-visible. `irId` is a POSITION -- reordering renumbers it, and every
  // `%N` in every later statement means something different afterwards -- so a
  // remap needs a key that does not move. It is assigned once, at append, and
  // never reused within a document.
  std::uint64_t uid = 0;
  // SUPPRESSED: skipped by emission, kept in the tree and in the file. This is
  // the CAD meaning, not a delete: the feature is still there, still editable,
  // and unsuppressing it puts the geometry back.
  bool suppressed = false;
  // DELETED: a tombstone. The row leaves the tree and the statement leaves the
  // emitted program, but the RECORD stays, so `irId` never has to compact and no
  // surviving `%N` can be left dangling by a delete. Emission renumbers anyway
  // (see EmissionPlan), so a tombstone costs the kernel nothing.
  bool deleted = false;
};

// Why an EDIT needs its own result type and may not reuse IrCheck: IrCheck is
// the FeatureTree.hpp grammar, rule for rule ("Ops reference prior ids by %N",
// the per-op arg list). "you moved an operand" is not a grammar rule -- the
// rewritten statement is perfectly legal IR -- it is a DOCUMENT rule about what
// a parameter edit is allowed to be. Folding it into IrCheck would make the
// header's claim that every value there is a kernel rule false.
enum class EditCheck : std::uint8_t {
  Ok = 0,
  NoSuchFeature,     // irId names no statement in this document
  OperandChanged,    // a %ref moved: that is a reparent, not a parameter edit
  NoChange,          // identical args -- refused, so undo never holds a no-op step
  InvalidStatement,  // the rewritten line fails validateIr(); lastCheck() says which rule
};

const char* toString(EditCheck check) noexcept;

// ── the receiver ────────────────────────────────────────────────────────────
// A headless feature-IR program plus the binding from a UI document-node id
// (EntityRef::bodyId) to the IR value that node currently IS. The binding is the
// whole point: a selection is a stable topology reference, and a command can only
// run if that reference resolves to a value the IR can name.
class PartDocument {
 public:
  // Seed a value that exists before any Part command ran: an imported body, or a
  // sketch authored in the Sketch workspace. `nodeId` is the EntityRef::bodyId
  // the UI will select it by.
  int seed(IrValueKind kind, const std::string& nodeId, const std::string& op,
           std::vector<IrArg> args);

  int nextIrId() const noexcept { return static_cast<int>(records_.size()) + 1; }
  int valueFor(const std::string& nodeId) const noexcept;  // 0 == not bound
  // The inverse: the document node currently bound to `irId`, "" when none is.
  // A caller that must SELECT a value needs this, because a selection names
  // NODES and never IR ids. "" also means CONSUMED — a boolean absorbs its tool
  // body, and the node stops resolving — which is exactly what a caller must not
  // then go and select.
  std::string nodeFor(int irId) const;
  IrValueKind kindOf(int irId) const noexcept;

  const std::vector<FeatureRecord>& records() const noexcept { return records_; }
  std::size_t featureCount() const noexcept;   // command-authored records only
  const FeatureRecord* lastFeature() const noexcept;
  std::string irProgram() const;               // every statement, newline-joined
  IrCheck lastCheck() const noexcept { return lastCheck_; }

  // Refuses and mutates NOTHING when the statement fails validateIr() or is not
  // numbered nextIrId(). Only AppendFeatureEdit calls this.
  bool appendFeature(const FeatureRecord& record,
                     const std::vector<std::string>& consumedNodes,
                     const std::string& producedNode);

  // ── in-place PARAMETER EDIT ───────────────────────────────────────────────
  // Until this existed the document was APPEND-ONLY: appendFeature() refuses any
  // statement not numbered nextIrId(), so the ONLY way to change a fillet from
  // r3 to r6 was to undo every feature back to it and redo them all by hand. A
  // history-based modeller whose history cannot be edited is not parametric, and
  // the starting part is worse off than an authored one -- its five statements
  // are seeds, so not even undo reaches them.
  //
  // Deliberately NARROW, and the narrowness is the safety property:
  //
  //   * the statement's ID is pinned. Renumbering would change what every later
  //     `%N` means.
  //   * the statement's OP is pinned. A different op is a different feature with
  //     a different produces-kind, and swapping it under a live node binding is
  //     how a UI silently turns a CUT into a FUSE.
  //   * every `%ref` is pinned, BY POSITION. Moving a ref rewires the dependency
  //     graph; that is a reparent, not a parameter edit, and it has different
  //     undo and binding consequences. A "change the radius" control that can
  //     reparent a feature is the bug this rule exists to make impossible.
  //
  // What MAY change is every non-ref argument: numbers, and the bare keyword /
  // quoted selector an op takes. The arg COUNT may change within the op's
  // documented arity, which is what lets `FILLET(%4, 3, VERTICAL)` become
  // `FILLET(%4, 3)`; validateIr() enforces the arity, so the op table stays the
  // single authority on it.
  //
  // Bindings are untouched by construction: an arg edit changes no statement id
  // and no produces-kind, so every nodeId -> value binding still names the same
  // value it did before.
  bool editFeatureArgs(int irId, const std::vector<IrArg>& args);
  const FeatureRecord* featureAt(int irId) const noexcept;
  EditCheck lastEdit() const noexcept { return lastEdit_; }

  // ── HISTORY STATE ─────────────────────────────────────────────────────────
  // The three things that turn a list of statements into a history: a feature
  // can be SUPPRESSED, a feature can be DELETED, and the whole tree can be
  // ROLLED BACK to a point. All three are properties of the DOCUMENT; none of
  // them rewrites a statement, so every `%N` keeps meaning what it meant.
  //
  // Each of these is a primitive mutator: it does the thing and answers whether
  // it found the feature. The UNDOABLE forms live in FeatureHistory.hpp, beside
  // the consequence analysis, for the same reason AppendFeatureEdit lives beside
  // appendFeature() -- the receiver does the work, the ConcreteCommand owns the
  // memento.
  bool setSuppressed(int irId, bool on);
  bool setDeleted(int irId, bool on);
  bool setLabel(int irId, const std::string& label);   // RENAME, the tree-row name

  // The ROLLBACK BAR. 0 == none: every statement is live. N == "build the tree
  // up to and including statement N"; everything after it is ROLLED, not lost.
  // Clamps into [0, records()] rather than refusing, because a bar dropped past
  // the end of a tree means "the end of the tree" in every modeller that has one.
  void setRollback(int irId) noexcept;
  int rollback() const noexcept { return rollback_; }

  // ── REORDER ───────────────────────────────────────────────────────────────
  // The one history operation that MUST renumber, because creation order IS
  // evaluation order: a statement's position in `records_` is its `%N`.
  //
  // It never refuses a direction. `newPosition` is CLAMPED into the window the
  // dependency graph allows -- after the last operand this statement reads,
  // before the first statement that reads it -- and `clampedTo` reports where it
  // actually landed and `blockedBy` names the statement that stopped it, so a UI
  // (or a repair loop) can say WHY rather than appearing to ignore the drag.
  // Returns false only when `irId` names no statement.
  bool moveFeature(int irId, int newPosition, int& clampedTo, int& blockedBy);
  // The legal window for a move, as 1-based positions. Both are inclusive.
  void moveWindow(int irId, int& first, int& last) const;

  // ── EMISSION ──────────────────────────────────────────────────────────────
  // The emitted program is DERIVED from the records plus the history state, and
  // it is renumbered: a document statement's `irId` is its identity here, and the
  // kernel gets a dense 1..N program with every `%ref` remapped.
  //
  // WHY RENUMBER. Without it, suppression and deletion are unimplementable
  // without either compacting `irId` (which rewrites what every later `%N` means
  // in the DOCUMENT, breaking undo and every stored selection) or emitting a
  // program with holes in its numbering (which forge::ft::parse refuses). With
  // it, both are free, and the mapping back is what lets a kernel error that
  // names op %7 be shown on the row the user is looking at.
  enum class OmitReason : std::uint8_t {
    None = 0,
    Suppressed,          // the user suppressed this feature
    Deleted,             // the user deleted it
    RolledBack,          // it is after the rollback bar
    OperandUnavailable,  // a value it consumes is not emitted, and cannot be rebased
    Orphaned,            // nothing consumes it any more, because its consumer went
  };
  static const char* toString(OmitReason reason) noexcept;

  struct Emitted {
    int documentId = 0;   // the record
    int emittedId = 0;    // its %N in the emitted program
  };
  struct Omitted {
    int documentId = 0;
    OmitReason reason = OmitReason::None;
    // For OperandUnavailable: the DOCUMENT id of the operand that could not be
    // resolved. For Orphaned: 0. Naming it is the difference between "this
    // feature failed" and "this feature failed because %4 is suppressed".
    int blockingId = 0;
  };

  class EmissionPlan {
   public:
    // ref-qualified, and the rvalue overloads are DELETED on purpose. The
    // natural spelling `for (const Omitted& o : doc.emissionPlan().omitted())`
    // binds a reference into a TEMPORARY plan that dies at the end of the
    // init-statement, and the loop then walks freed memory -- undefined
    // behaviour that reads as a plausible wrong answer, not a crash. MEASURED
    // while writing feature_history_test.cpp: it reported 0 omissions on a
    // document with two, and corrupted an unrelated later check. Deleting the
    // rvalue overloads turns that into a compile error at the call site, so the
    // caller has to hold the plan -- which is what it wanted anyway, since every
    // query below is a scan.
    const std::string& program() const& noexcept { return program_; }
    const std::vector<Emitted>& emitted() const& noexcept { return emitted_; }
    const std::vector<Omitted>& omitted() const& noexcept { return omitted_; }
    const std::string& program() const&& = delete;
    const std::vector<Emitted>& emitted() const&& = delete;
    const std::vector<Omitted>& omitted() const&& = delete;
    int emittedIdFor(int documentId) const noexcept;   // 0 == not emitted
    int documentIdFor(int emittedId) const noexcept;   // 0 == no such emitted op
    OmitReason omitReasonFor(int documentId) const noexcept;
    int blockingFor(int documentId) const noexcept;
    std::size_t emittedCount() const noexcept { return emitted_.size(); }

   private:
    friend class PartDocument;
    std::string program_;
    std::vector<Emitted> emitted_;
    std::vector<Omitted> omitted_;
  };

  EmissionPlan emissionPlan() const;

  // ── the whole document, for STRUCTURAL undo ───────────────────────────────
  // `Snapshot` above is a record COUNT plus the bindings: it is exactly enough to
  // reverse an APPEND and nothing else. A delete, a suppress, a rename, a
  // rollback and a reorder each change state inside the records, and a reorder
  // renumbers all of them, so their memento is the document. It is small -- a
  // 71-statement tree is a few kilobytes -- and being the whole state, it cannot
  // be a PARTIAL restore, which is the failure mode a hand-written inverse has.
  struct History {
    std::vector<FeatureRecord> records;
    std::map<std::string, int> bindings;
    int rollback = 0;
    std::uint64_t nextUid = 1;
  };
  History captureHistory() const;
  void restoreHistory(const History& state);

  // Statement identity, the key a renumbering remaps through.
  std::uint64_t uidOf(int irId) const noexcept;
  int idOfUid(std::uint64_t uid) const noexcept;   // 0 == gone

  // GoF Memento. Small by construction: a record count plus the binding table.
  struct Snapshot {
    std::size_t records = 0;
    std::map<std::string, int> bindings;
  };
  Snapshot snapshot() const;
  void restore(const Snapshot& state);

 private:
  std::vector<FeatureRecord> records_;
  std::map<std::string, int> bindings_;
  IrCheck lastCheck_ = IrCheck::Ok;
  EditCheck lastEdit_ = EditCheck::Ok;
  int rollback_ = 0;               // 0 == the bar is at the end of the tree
  std::uint64_t nextUid_ = 1;      // never reused within a document
};

// ── the concrete command ────────────────────────────────────────────────────
class UndoableEdit {
 public:
  virtual ~UndoableEdit() = default;
  virtual const std::string& label() const noexcept = 0;
  virtual bool apply(PartDocument& doc) = 0;
  virtual void revert(PartDocument& doc) = 0;
};

class AppendFeatureEdit final : public UndoableEdit {
 public:
  AppendFeatureEdit(FeatureRecord record, std::vector<std::string> consumedNodes,
                    std::string producedNode);

  const std::string& label() const noexcept override { return record_.label; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  FeatureRecord record_;
  std::vector<std::string> consumed_;
  std::string produced_;
  PartDocument::Snapshot before_{};
};

// The second ConcreteCommand, and the one place GoF's CHEAPER undo alternative
// is the right one. AppendFeatureEdit must carry a Memento because a boolean
// ABSORBS both operands' node bindings, so its inverse is not derivable from its
// arguments. An arg edit absorbs nothing: it touches one statement's argument
// list and no binding at all, so "store enough state to reverse the effect"
// (Design Patterns, p.235) is exactly the old argument list. PartDocument's
// Snapshot could not have served here anyway -- it is a record COUNT plus the
// binding table, so restore() truncates and would not put a changed argument
// back.
class EditFeatureArgsEdit final : public UndoableEdit {
 public:
  EditFeatureArgsEdit(int irId, std::vector<IrArg> args, std::string label);

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  int irId_;
  std::vector<IrArg> after_;
  std::vector<IrArg> before_;
  std::string label_;
};

// ── the caretaker ───────────────────────────────────────────────────────────
class UndoStack {
 public:
  // Applies the edit; pushes it only if it applied. A new edit clears redo.
  bool perform(PartDocument& doc, std::unique_ptr<UndoableEdit> edit);
  bool undo(PartDocument& doc);
  bool redo(PartDocument& doc);

  std::size_t undoDepth() const noexcept { return done_.size(); }
  std::size_t redoDepth() const noexcept { return undone_.size(); }
  std::string undoLabel() const;  // "" when the stack is empty
  std::string redoLabel() const;
  void clear() noexcept;

 private:
  std::vector<std::unique_ptr<UndoableEdit>> done_;
  std::vector<std::unique_ptr<UndoableEdit>> undone_;
};

// ── registration ────────────────────────────────────────────────────────────
// Adds the Part workspace core to `registry` and returns how many were added.
// Both references must outlive the registry: the handlers capture them.
//
// UNDO IS NOT IN THIS SET. The stack above is driven by ForgeShell's ONE
// `edit.undo` / `edit.redo` through forge::ui::DocumentHost -- the commands that
// carry Ctrl+Z, feed the status strip and make the viewport rebuild. A second
// pair of Part-workspace undo commands over the same stack was two menu entries
// for one operation, and only one of them did the whole job.
std::size_t registerPartCommands(CommandRegistry& registry, PartDocument& document,
                                 UndoStack& undoStack);

// The stable IDs this function registers, sorted. Menus, keymaps, the manifest
// and Archie's tool list all read this rather than hard-coding strings.
const std::vector<std::string>& partCommandIds();

}  // namespace forge::ui

#endif  // FORGE_UI_PARTCOMMANDS_HPP
