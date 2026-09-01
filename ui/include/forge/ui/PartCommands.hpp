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
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"

namespace forge::ui {

// The three value kinds forge::ft's IR model defines (FeatureTree.hpp, "IR VALUE
// MODEL"). A command's selection must resolve to the right one: EXTRUDE consumes
// a PROFILE, FILLET consumes a SOLID, and offering either on the other is the
// mis-selection a signature exists to refuse.
enum class IrValueKind : std::uint8_t { None, Profile, Wire, Solid };

const char* toString(IrValueKind kind) noexcept;

// ── the document's NON-GEOMETRIC state ──────────────────────────────────────
//
// A NAMED PARAMETER. Feature-IR arguments are LITERALS -- the grammar in
// FeatureTree.hpp has no expressions and this layer may not invent one -- so a
// dimension that two statements have to agree about was, until this existed,
// two independently editable numbers with nothing joining them. A Parameter is
// the one place that value lives; `FeatureRecord::argParams` binds an argument
// SLOT to it, and PartDocument::setParameter rewrites every bound slot through
// the SAME editFeatureArgs() a hand edit goes through -- so a parameter change
// obeys the same ref-pinning and arity rules the header documents above.
// Nothing new reaches the kernel: the emitted IR is still literals.
struct Parameter {
  std::string name;      // [A-Za-z_][A-Za-z0-9_]* -- enforced by setParameter
  double value = 0.0;
  std::string unit;      // "" == the document's own unit
  std::string comment;
};

// A MATERIAL. Held per document and ASSIGNED per body node, not per feature: a
// feature is a step in a program, a body is a thing that has a density. Density
// is what a mass readout needs and `standard` is what a BOM needs; both are
// stored, because a document that knows "aluminium" but not WHICH aluminium is
// not a manufacturing document.
struct Material {
  std::string name;        // "AL6061"
  double density = 0.0;    // kg/m^3
  std::string standard;    // "ASTM B209"
  std::string appearance;  // "#B8BCC0"
};

// One argument SLOT driven by a parameter. Positional on purpose: the slot is
// what the op's arity names, and a name would need a second table mapping op
// arguments to names that FeatureTree.hpp does not publish.
struct ArgParamBinding {
  std::size_t argIndex = 0;
  std::string parameter;
};

// WHAT A FEATURE-TREE ROW IS RIGHT NOW.
//
// Ok         - it validates and every input it names is itself built.
// Suppressed - the user turned it off. Deliberate, not a defect.
// RolledBack - it sits after the rollback bar, so this build stops before it.
// Blocked    - it is well-formed, but an input is suppressed, rolled back or in
//              error, so it cannot build. THE CONSEQUENCE OF SOMEONE ELSE'S
//              EDIT, named -- rather than an edit refused up front.
// Error      - it does not validate (IrCheck), or the kernel verifier rejected
//              it and handed us its own message.
enum class FeatureStatus : std::uint8_t {
  Ok = 0,
  Suppressed,
  RolledBack,
  Blocked,
  Error,
};

const char* toString(FeatureStatus status) noexcept;

// One row's state plus the REASON, which is the whole point: "3 features are in
// error" is a status bar; "%17 SHELL cannot build: its input %14 FILLET is
// suppressed" is a document a user can repair.
struct FeatureDiagnostic {
  int irId = 0;
  FeatureStatus status = FeatureStatus::Ok;
  std::string message;        // "" if and only if status == Ok
  bool fromVerifier = false;  // true == the kernel's own text, not ours
};

struct FeatureRecord {
  int irId = 0;                 // == line.id; also the 1-based document position
  std::string commandId;        // "" for a value seeded before any command ran
  std::string label;            // feature-tree row label
  IrLine line;                  // the emitted statement
  IrValueKind produces = IrValueKind::Solid;

  // ── state a REORDER must not destroy ──────────────────────────────────────
  // irId is POSITIONAL: moving a feature renumbers it and every `%N` that names
  // it. `persistentName` is the L4 TAG "@name" -- the same spelling the kernel
  // binds with TAG(%body, "@name", "sel") (FeatureTree.hpp, OpCode::Tag), which
  // exists precisely because "every edit renumbers faces". It is stored WITH the
  // leading '@', so the string in the document IS the string a selector would
  // use: there is no second naming scheme and no translation step.
  std::string persistentName;

  bool suppressed = false;
  std::vector<ArgParamBinding> argParams;

  // The kernel verifier's OWN last message about this statement, or "".
  // Derived state, persisted deliberately: a document saved broken must reopen
  // broken, or the user loses the only account of what went wrong. Cleared by
  // PartDocument::clearVerifierDiagnostics() at the start of every rebuild, so a
  // stale message cannot outlive the build that produced it.
  std::string verifierMessage;
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

  // ── identity and units ────────────────────────────────────────────────────
  const std::string& name() const noexcept { return name_; }
  void setName(std::string value);
  const std::string& units() const noexcept { return units_; }
  // Any non-empty token is accepted. A closed list here would be a SECOND unit
  // authority alongside whatever the kernel and the drawing layer use, and the
  // one with fewer users is the one that drifts. Empty is refused, because ""
  // silently means "millimetres" to every reader and nothing to a human.
  bool setUnits(std::string value);

  // ── parameters ────────────────────────────────────────────────────────────
  const std::vector<Parameter>& parameters() const noexcept { return params_; }
  const Parameter* parameter(const std::string& name) const noexcept;
  // Adds or updates. On update, EVERY bound argument slot is rewritten through
  // editFeatureArgs(), so the emitted literals and the parameter cannot drift.
  // Refuses a name that is not an identifier, and refuses a value that no bound
  // slot would accept -- reporting how many slots it moved via drivenArgCount().
  bool setParameter(const Parameter& p);
  // Drops the parameter and UNBINDS every slot it drove. The literals stay where
  // they are: deleting a parameter is not a request to change the geometry.
  bool removeParameter(const std::string& name);
  bool bindArgToParameter(int irId, std::size_t argIndex, const std::string& parameter);
  bool unbindArg(int irId, std::size_t argIndex);
  std::size_t drivenArgCount() const noexcept;

  // ── materials ─────────────────────────────────────────────────────────────
  const std::vector<Material>& materials() const noexcept { return materials_; }
  const Material* material(const std::string& name) const noexcept;
  bool setMaterial(const Material& m);
  bool removeMaterial(const std::string& name);   // also clears every assignment to it
  // Assigns a KNOWN material to a body node. An unknown material name is refused:
  // an assignment naming nothing is how a BOM gets a blank row.
  bool assignMaterial(const std::string& node, const std::string& materialName);
  bool clearMaterial(const std::string& node);
  std::string materialOf(const std::string& node) const;
  const std::map<std::string, std::string>& materialAssignments() const noexcept {
    return materialOfNode_;
  }

  // ── named entities ────────────────────────────────────────────────────────
  // The node -> value table, published. It was previously reachable ONLY through
  // snapshot(), so the .fpart writer had to take a Memento to find out what the
  // document called its own bodies -- and, taking the first match per value,
  // dropped every SECOND name bound to the same value.
  const std::map<std::string, int>& bindings() const noexcept { return bindings_; }
  // The L4 persistent name, stored with its '@'. A leading '@' is added if the
  // caller omitted it, so "@rim" and "rim" cannot become two different names for
  // one feature. Refuses a name already used by another feature.
  bool setPersistentName(int irId, const std::string& name);
  int featureNamed(const std::string& persistentName) const noexcept;

  // ── suppression, rollback, reorder ────────────────────────────────────────
  bool setSuppressed(int irId, bool suppressed);

  // The rollback bar. `kRollbackEnd` means "at the end -- build everything";
  // 0 means "above the first statement -- build nothing". It is DOCUMENT state
  // (it is saved with the file, as every history modeller saves it) but it is
  // not an undoable EDIT: rolling the bar changes what is built, not what the
  // document says, and a Ctrl+Z that moved a rollback bar instead of undoing the
  // user's last real change is the undo bug every CAD system has shipped once.
  static constexpr int kRollbackEnd = -1;
  int rollbackAfter() const noexcept { return rollback_; }
  bool setRollbackAfter(int irId);

  // ── REORDER ───────────────────────────────────────────────────────────────
  // Moves the statement at `irId` to 1-based `newPosition`, RENUMBERS every
  // statement to its new position, and rewrites every `%N` so each reference
  // still names the same STATEMENT it named before. Bindings and persistent
  // names are carried across; the persistent name is what survives, which is why
  // FeatureRecord has one.
  //
  // IT DOES NOT REFUSE A MOVE THAT BREAKS THE DOCUMENT. Dragging a fillet above
  // the body it fillets produces a forward reference, which is illegal IR -- and
  // this returns true, applies the move, and marks that row Error with
  // validateIr's own reason, plus Blocked on everything downstream of it. The
  // owner's constraint is REPRESENT / REPAIR / TOLERATE, never refuse: a modeller
  // that rejects the drag leaves the user with no way to see WHY it was wrong,
  // and an ultra-long generated tree with one bad edge is not a tree to throw
  // away. What is refused is only what is meaningless: an unknown irId, or a
  // position outside [1, size].
  bool moveFeature(int irId, int newPosition);

  // ── diagnostics ───────────────────────────────────────────────────────────
  const std::vector<FeatureDiagnostic>& diagnostics() const noexcept { return diags_; }
  FeatureStatus statusOf(int irId) const noexcept;
  std::string diagnosticOf(int irId) const;
  // The kernel verifier's OWN message for one statement. The app calls this with
  // the text forge::ft handed it -- this layer never invents a kernel message,
  // because a paraphrase of a compiler error is a second error message that
  // drifts from the first.
  void setVerifierDiagnostic(int irId, const std::string& message);
  void clearVerifierDiagnostics();
  std::size_t errorCount() const noexcept;
  std::size_t builtCount() const noexcept;

  // ── what actually BUILDS ──────────────────────────────────────────────────
  // irProgram() is every statement, always -- the document as written. This is
  // the document as BUILT: suppressed, rolled-back and un-buildable statements
  // removed, remaining references HEALED (a suppressed pass-through hands its
  // own first value ref down to its consumers, which is what makes suppressing
  // one fillet in a chain of forty a no-op on the rest), and the survivors
  // renumbered 1..m so the result is a legal standalone program.
  std::string activeIrProgram() const;
  // The statements activeIrProgram() left out, in document order, with the
  // reason each was dropped. A UI that shows the program must be able to say
  // what is missing from it.
  std::vector<FeatureDiagnostic> blockedFeatures() const;

  // ── the TOLERANT append, for loading a file ───────────────────────────────
  // appendFeature() REFUSES an invalid statement, which is right for a live
  // command: nothing should be able to author illegal IR. It is wrong for a
  // LOAD. A document that was saved with a broken reorder in it would then be
  // unopenable -- the user's file, refused by the only program that can repair
  // it. adoptFeature() keeps the structural rule that ids arrive in creation
  // order (violate that and every later `%N` means something else, so the file
  // is not recoverable anyway) and TOLERATES everything else, recording the
  // failure as this row's diagnostic. Such a statement never reaches the kernel:
  // activeIrProgram() drops it and names it in blockedFeatures().
  bool adoptFeature(const FeatureRecord& record, const std::vector<std::string>& nodes);

  // Recomputes every row's status. Called after each mutation; public so a host
  // that pushed verifier messages in a batch can settle the document once.
  void recompute();

  // Holds the recompute until the guard goes out of scope, then runs it ONCE.
  //
  // Every mutation recomputes by default, which is the property that makes a
  // stale diagnostic unreachable -- there is no call to forget. The cost is
  // O(statements) per mutation, so a bulk load of a 70-statement tree is fine
  // and a bulk load of a 100,000-statement one is not. This makes the fast path
  // opt-IN: forgetting the guard costs time, never correctness, which is the
  // only direction that trade may run.
  class BatchEdit {
   public:
    explicit BatchEdit(PartDocument& doc) : doc_(doc) { ++doc_.holdRecompute_; }
    ~BatchEdit() {
      if (--doc_.holdRecompute_ == 0) doc_.recompute();
    }
    BatchEdit(const BatchEdit&) = delete;
    BatchEdit& operator=(const BatchEdit&) = delete;

   private:
    PartDocument& doc_;
  };

  // GoF Memento. Small by construction: a record count plus the binding table.
  struct Snapshot {
    std::size_t records = 0;
    std::map<std::string, int> bindings;
  };
  Snapshot snapshot() const;
  void restore(const Snapshot& state);

 private:
  // ONE WALK, TWO ANSWERS. What the tree shows and what the kernel is asked to
  // build are derived from the SAME resolution, because a row shown green whose
  // statement was silently dropped from the build is the defect the whole
  // diagnostic layer exists to prevent. Indexed 1..n by irId; index 0 is unused
  // so the arrays can be addressed by statement id directly.
  struct GraphResolution {
    std::vector<FeatureStatus> status;
    std::vector<std::string> message;
    std::vector<bool> fromVerifier;
    // resolved[i] = the id whose VALUE a consumer of %i must use: i when %i
    // builds, what %i passes through when suppressed, 0 when there is nothing.
    std::vector<int> resolved;
    std::vector<int> emitted;  // ids that reach the kernel, in document order
  };
  GraphResolution resolveGraph() const;
  std::vector<bool> reachable(const std::vector<int>& emitted,
                              const std::vector<int>& resolved) const;
  std::vector<bool> reachableFull() const;

  // Rewrites the argument at `argIndex` of `irId` to `value` WITHOUT going
  // through EditCheck::NoChange -- setParameter must be able to set a slot that
  // already holds the right number without that counting as a failure.
  bool driveArg(int irId, std::size_t argIndex, double value);
  void reindexAfterMove();

  std::vector<FeatureRecord> records_;
  std::map<std::string, int> bindings_;
  IrCheck lastCheck_ = IrCheck::Ok;
  EditCheck lastEdit_ = EditCheck::Ok;

  std::string name_ = "untitled";
  std::string units_ = "mm";
  std::vector<Parameter> params_;
  std::vector<Material> materials_;
  std::map<std::string, std::string> materialOfNode_;
  int rollback_ = kRollbackEnd;
  std::vector<FeatureDiagnostic> diags_;
  int holdRecompute_ = 0;
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

// ── three more ConcreteCommands, all self-inverse ───────────────────────────
//
// Each is GoF's CHEAPER undo alternative ("store enough state to reverse the
// effect", Design Patterns p.235) for the same reason EditFeatureArgsEdit is:
// none of them absorbs a binding, so the inverse IS derivable from the change.
// PartDocument::Snapshot could not have served any of them anyway -- it is a
// record COUNT plus the binding table, so restore() truncates, and truncation
// puts back neither a suppression flag, nor a moved statement, nor a parameter.

// Toggle one feature's suppression. Inverse: toggle it back.
class SetSuppressedEdit final : public UndoableEdit {
 public:
  SetSuppressedEdit(int irId, bool suppressed, std::string label);

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  int irId_;
  bool after_;
  bool before_ = false;
  std::string label_;
};

// Move one feature to a new position. Inverse: move it back to the one it left.
//
// The stored ids are POSITIONS, and that is safe only because undo is LINEAR:
// UndoStack::perform clears the redo branch, so nothing can be applied between
// this edit and its own revert that would renumber the document underneath it.
// The same property is what lets AppendFeatureEdit hold a record count.
class MoveFeatureEdit final : public UndoableEdit {
 public:
  MoveFeatureEdit(int irId, int newPosition, std::string label);

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  int from_;
  int to_;
  std::string label_;
};

// Set a parameter's value. Inverse: the value it had. Adding a parameter that
// did not exist is reverted by REMOVING it, so undo does not leave a stray name
// behind that the next Save would write into the file.
class SetParameterEdit final : public UndoableEdit {
 public:
  SetParameterEdit(Parameter after, std::string label);

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  Parameter after_;
  Parameter before_{};
  bool existed_ = false;
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
