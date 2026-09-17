// ui/include/forge/ui/Parameters.hpp
//
// PARAMETERS AND EXPRESSIONS -- Forge's adapter from a part's feature tree onto an
// expression language.
//
// A part has named parameters (`wall = 3 mm`) and feature numbers driven by
// formulas (`Hole 5, dia = wall * 0.5 + 2 mm`). This file is what makes those
// records mean something:
//
//   1. RESOLVE. Every name a formula uses is a parameter, or a feature's number
//      written `<Op><id>.<argument>` (`Hole5.dia`, `Shell4.wall`) -- the op name in
//      title case, the statement id, and the kernel's own name for that argument,
//      read from the generated op vocabulary rather than transcribed here. Any
//      other name is refused, naming it.
//   2. ORDER. The parameters and bindings form a dependency graph. A cycle is
//      refused, and the refusal NAMES every member in order: "a -> b -> a".
//   3. EVALUATE, in dependency order, through the ExpressionEngine -- libforge_expr
//      in the application -- which does the unit-checked arithmetic: `3 mm + 2 kg`
//      is refused by the engine, not by a check here that could disagree with it.
//   4. CHECK every bound number's DIMENSION against what that argument IS. A HOLE's
//      `dia` is a length, a DRAFT's `angleDeg` an angle, a PATTERN's `n` a whole
//      count. A formula that yields a mass for a diameter is refused before any
//      statement is touched.
//   5. PROPAGATE. The result is the list of statement numbers that must change.
//      ParameterEdit applies all of them and the new parameter records as ONE
//      undoable step, or none of them: a change to one parameter that updates three
//      features is one Ctrl+Z, and a refusal leaves the document byte-identical.
//
// The kernel then rebuilds from the rewritten program exactly as it does after any
// other edit -- the parameters are not a second geometry path, they are a way of
// writing numbers into the one there is.
//
// ── Archie ──────────────────────────────────────────────────────────────────
// Every capability here is reachable ONLY through registered commands
// (registerParameterCommands, below): part.parameter_set, part.parameter_bind,
// part.parameter_unbind and part.parameter_remove. The Parameters panel dispatches
// the same commands, so a person and Archie cannot do different things.
#ifndef FORGE_UI_PARAMETERS_HPP
#define FORGE_UI_PARAMETERS_HPP

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ExpressionEngine.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ParameterSet.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── what kind of number an argument is ─────────────────────────────────────
// From the unit the op vocabulary derives for each kernel argument name
// (gen_archie_op_vocabulary.py UNIT_RULES / OP_ARG_OVERRIDES): "mm" is a Length,
// "deg" an Angle, "count" a whole Count, "dimensionless" a Plain number. An
// argument the vocabulary could not classify is Unknown and cannot be bound: a
// formula has nothing to be checked against.
enum class SlotUnit : std::uint8_t { Length, Angle, Plain, Count, Unknown };

const char* toString(SlotUnit unit) noexcept;
ExprDimensions dimensionsOf(SlotUnit unit) noexcept;

struct NumericSlot {
  bool found = false;
  // The op has several argument forms that disagree about this position (PATTERN's
  // fourth argument is a length for LINEAR and an angle for POLAR). Not bindable.
  bool ambiguous = false;
  std::size_t index = 0;  // position in the statement's argument list
  std::string name;       // the kernel's name: "dia"
  SlotUnit unit = SlotUnit::Unknown;
};

NumericSlot numericSlotByName(std::string_view op, std::string_view argument);
NumericSlot numericSlotAt(std::string_view op, std::size_t index);
// Every bindable number of `op` (found, not ambiguous, unit known), in argument order.
std::vector<NumericSlot> bindableSlotsOf(std::string_view op);

// "Hole 3", "Edge Fillet 4": the feature tree's name for a statement, with its
// statement number so two features with one label can be told apart.
std::string featureReferenceLabel(const FeatureRecord& record);

// "Hole5.dia" for argument `dia` of statement 5 = HOLE(...).
std::string slotReferenceName(const FeatureRecord& record, std::string_view argument);
// The inverse. False when `name` is not of that shape; it does not check the document.
bool parseSlotReference(const std::string& name, std::string& opTitle, int& irId, std::string& argument);

// ── why a change is refused ─────────────────────────────────────────────────
enum class ParameterProblem : std::uint8_t {
  None = 0,
  NoEngine,            // this build has no expression library
  InvalidName,         // not usable as a parameter name
  BadFormula,          // the text does not parse
  UnknownName,         // a formula uses a name that is nothing
  Cycle,               // the definitions depend on themselves
  Evaluation,          // the engine refused the arithmetic (unit mismatch, / 0, ...)
  WrongDimension,      // the formula's result is not the dimension the number is
  NotWholeNumber,      // a count that is not a whole number
  NoSuchFeature,       // a binding names a statement that is not there
  NoSuchArgument,      // ... or an argument that statement's op does not have
  AmbiguousArgument,   // ... or one whose meaning depends on the op's form
  UnitlessArgument,    // ... or one whose unit the vocabulary does not know
  ArgumentNotWritten,  // ... or an optional argument that statement omits
  NotBound,            // unbind of a number nothing drives
  NoSuchParameter,     // remove of a parameter that is not there
  StillUsed,           // remove of a parameter another formula uses
  EditRefused,         // the document refused a rewritten statement
};

const char* toString(ParameterProblem problem) noexcept;

// ── the result of recomputing a whole set ───────────────────────────────────
struct ParameterValue {
  std::string name;
  bool ok = false;
  ExprQuantity quantity;
  std::vector<std::string> uses;  // the names its formula uses
  ParameterProblem problem = ParameterProblem::None;
  // Why it has no value, AS A SENTENCE FOR A PERSON. Every reason this file
  // writes is prose a panel may show; forge-desktop/test/parameters_gate.cpp runs
  // each one it provokes through forge::ui::scanUserFacingProse().
  std::string reason;
};

struct BoundSlotValue {
  DimensionBinding binding;
  std::string reference;  // "Hole5.dia"
  std::string feature;    // "Hole 5" -- the tree's name for it
  SlotUnit unit = SlotUnit::Unknown;
  bool ok = false;
  ExprQuantity quantity;  // what the formula gives
  double current = 0.0;   // the number the statement holds now
  double target = 0.0;    // the number it must hold
  std::vector<std::string> uses;
  ParameterProblem problem = ParameterProblem::None;
  std::string reason;  // why it is not applied, as a sentence (see ParameterValue::reason)
};

struct ArgumentUpdate {
  int irId = 0;
  std::size_t slot = 0;
  double from = 0.0;
  double to = 0.0;
};

struct RecomputeResult {
  bool ok = false;
  ParameterProblem problem = ParameterProblem::None;  // the first refusal, in document order
  std::string reason;                                // ... as a sentence for a person
  std::vector<std::string> cycle;  // Cycle: the members in order, the first repeated last
  std::vector<ParameterValue> parameters;  // one per ParameterDef, document order
  std::vector<BoundSlotValue> bindings;    // one per DimensionBinding, document order
  std::vector<ArgumentUpdate> updates;     // the statement numbers that must change
};

RecomputeResult recomputeParameters(const PartDocument& doc, const ParameterSet& set,
                                    const ExpressionEngine& engine);

// ── the one undoable step ───────────────────────────────────────────────────
// Replaces the document's parameter set and rewrites every updated number, as one
// entry on the ONE undo stack. apply() is all-or-nothing: if the document refuses
// any rewritten statement, the statements already rewritten are put back and the
// edit is not pushed.
class ParameterEdit final : public UndoableEdit {
 public:
  // `failure`, when given, receives the reason apply() refused. It is shared
  // because UndoStack::perform() destroys an edit that refuses.
  ParameterEdit(ParameterSet after, std::vector<ArgumentUpdate> updates, std::string label,
                std::shared_ptr<std::string> failure = nullptr);

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

  const std::string& failure() const noexcept { return failure_; }

 private:
  void rollback(PartDocument& doc);

  ParameterSet after_;
  ParameterSet before_;
  std::vector<ArgumentUpdate> updates_;
  std::vector<std::pair<int, std::vector<IrArg>>> beforeArgs_;
  std::string label_;
  std::string failure_;
  std::shared_ptr<std::string> failureSink_;
};

// ── the commands ────────────────────────────────────────────────────────────
// How a command finds the engine. The APPLICATION supplies one that returns the
// libforge_expr host; a build without the library supplies one that returns
// nullptr, and every parameter command is then disabled rather than wrong.
using ExpressionEngineSource = std::function<const ExpressionEngine*()>;

// Adds part.parameter_set, part.parameter_bind, part.parameter_unbind and
// part.parameter_remove. Both references must outlive the registry.
std::size_t registerParameterCommands(CommandRegistry& registry, PartDocument& document,
                                      UndoStack& undoStack, ExpressionEngineSource engine);

// The stable IDs registerParameterCommands adds, sorted.
const std::vector<std::string>& parameterCommandIds();

}  // namespace forge::ui

#endif  // FORGE_UI_PARAMETERS_HPP
