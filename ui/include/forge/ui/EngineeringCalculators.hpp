// ui/include/forge/ui/EngineeringCalculators.hpp
//
// THE ENGINEERING CALCULATIONS THE APPLICATION CAN REACH, AND THE ONE SEAM
// THROUGH WHICH IT REACHES THEM.
//
// ── the defect this exists for, measured ────────────────────────────────────
// forge-kernel compiles 147 engineering calculators whose inputs are plain
// numbers -- pipe flow, pump suction, beam capacity, pavement design. Every one
// of them is linked into the library this application loads. NONE of them was
// reachable from it: the C++ app included 20 kernel headers and not one was a
// calculator, while 28 of those calculators had a test and every one of those
// tests ran through the Node addon. JavaScript was the sole caller of the
// engineering the C++ kernel already computes.
//
// A calculator is not reachable because a handler exists. It is reachable when
// a command id resolves to it in the one registry every menu, palette, shortcut
// and agent tool call goes through -- which is what this file adds.
//
// ── why the form is not written out here ────────────────────────────────────
// A calculator's inputs are already declared, in order and with their types, by
// the kernel header that computes it. ui/include/forge/ui/CalculatorSchema.hpp
// is GENERATED from those headers by
// implementation/sacrosanct/tools/gen_calculator_schema.py, whose --check is a
// gate: a kernel field that is renamed and a label left behind is red, not
// silently wrong. This program has already shipped four divergent copies of one
// vocabulary; a second hand-written list of pipe diameters and densities is
// exactly how that happened, so there is not one here.
//
// ── why this file cannot see the kernel ─────────────────────────────────────
// Nothing under ui/ includes the geometry kernel, for the reason StudyModel.hpp
// gives: everything here is compiled AND RUN headlessly by every gate, and a
// number a panel prints is only trustworthy if something headless can assert
// it. So the arithmetic stays in the kernel, the bookkeeping stays here, and
// CalculatorEvaluator is the single function the one translation unit that may
// see the kernel (forge-desktop/src/CalculatorHost.cpp) installs.
#ifndef FORGE_UI_ENGINEERINGCALCULATORS_HPP
#define FORGE_UI_ENGINEERINGCALCULATORS_HPP

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

#include "forge/ui/CalculatorSchema.hpp"
#include "forge/ui/CommandRegistry.hpp"

namespace forge::ui {

// ── the schema, looked up ───────────────────────────────────────────────────
// nullptr when nothing by that name is compiled in -- a saved macro from a newer
// build can name a calculator this one does not carry, and refusing to answer is
// better than inventing one.
const CalculatorSchema* findCalculatorSchema(const std::string& calculatorId);
const CalculatorSchema* calculatorForCommand(const std::string& commandId);

// The command's parameter declaration, built from the kernel's own input list.
// Every number the calculation consumes is `required` with NO default: a
// calculator has no honest starting value for a pipe bore or a density, and
// applyDefaults() filling one in would put an invented number where a
// measurement belongs. The interactive path already handles that -- the sheet
// opens and asks -- because missingRequired() names exactly these.
std::vector<ParamSpec> calculatorParamSpecs(const CalculatorSchema& schema);

// Every calculator command id, sorted. The canonical list, so a menu, a gate or
// a manifest never spells one out.
const std::vector<std::string>& calculatorCommandIds();

// ── one number the calculation came back with ───────────────────────────────
// `label` and `unit` are the schema's, so a readout and a form box name the same
// quantity the same way. A boolean result carries `isFlag` and `flag`; `value`
// is then 1 or 0 and is what a gate compares.
struct CalculatorReading {
  std::string label;
  std::string unit;
  double value = 0.0;
  bool isFlag = false;
  bool flag = false;
};

// ── what the last calculation answered ──────────────────────────────────────
// `refusal` is a sentence addressed to the person, never the kernel's own
// message: those name symbols ("κ must be > 0") and a symbol is not something a
// user can act on. Empty iff `computed`.
struct CalculatorOutcome {
  bool computed = false;
  std::string calculatorId;
  std::string title;
  std::string refusal;
  std::vector<CalculatorReading> readings;
};

// ── THE SEAM ────────────────────────────────────────────────────────────────
// Given a calculator id and the numbers the command was dispatched with, fill
// `outputs` with one value per schema output, IN SCHEMA ORDER, and return true.
// Return false and write a sentence into `refusal` when the calculation cannot
// be made from those numbers. A boolean output is written as 1.0 or 0.0.
//
// The implementation lives in forge-desktop/src/CalculatorHost.cpp and calls the
// kernel's own entry point. It is passed in rather than linked so that this
// layer -- and every gate that runs it -- stays free of the kernel.
using CalculatorEvaluator = std::function<bool(const std::string& calculatorId,
                                               const CommandParams& inputs,
                                               std::vector<double>& outputs,
                                               std::string& refusal)>;

// The sentence a calculator refuses with when the numbers it was given are not
// ones the method is valid over. It is deliberately ONE sentence and it does not
// name which input: the kernel reports that in its own notation, and forwarding
// that notation to a user is the "echoed internal detail" defect the prose gate
// exists for.
const char* calculatorRefusalText() noexcept;

// ── the bench ───────────────────────────────────────────────────────────────
// Holds the seam and the last answer. One instance per application; the command
// handlers capture it, exactly as the Part commands capture their document.
class CalculatorBench {
 public:
  void bind(CalculatorEvaluator evaluator);
  bool bound() const noexcept { return static_cast<bool>(evaluator_); }

  // What the panel draws. Cleared only by forget().
  const CalculatorOutcome& lastOutcome() const noexcept { return last_; }
  void forget() noexcept;

  // How many calculations this bench has actually completed. A counter, not a
  // string: two runs of one calculator leave identical readings, so the text
  // alone cannot tell a fresh answer from a stale one.
  std::size_t completed() const noexcept { return completed_; }

  // Run one calculator. Returns true iff it answered; on false `refusal` holds
  // the sentence, and lastOutcome() holds it too so the surface can draw it.
  bool run(const CalculatorSchema& schema, const CommandParams& inputs, std::string& refusal);

 private:
  CalculatorEvaluator evaluator_;
  CalculatorOutcome last_;
  std::size_t completed_ = 0;
};

// Register one command per compiled calculator into `registry`, returning how
// many were added. The ids are the schema's, so the registry and the form
// surface cannot disagree about what exists.
std::size_t registerCalculatorCommands(CommandRegistry& registry, CalculatorBench& bench);

}  // namespace forge::ui

#endif  // FORGE_UI_ENGINEERINGCALCULATORS_HPP
