#include "forge/ui/EngineeringCalculators.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CalculatorSchema.hpp"
#include "forge/ui/CommandRegistry.hpp"

namespace forge::ui {

namespace {

// The category the Simulation workspace already claims. It was claimed and
// EMPTY: workspaceCategories() has named "Simulation" since the eight
// workspaces were written and no command had ever been filed under it, so the
// Simulation ribbon rendered nothing. Filing these here puts them on it without
// inventing a second taxonomy.
constexpr const char* kCategory = "Simulation";

}  // namespace

const CalculatorSchema* findCalculatorSchema(const std::string& calculatorId) {
  for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
    if (calculatorId == kCalculatorSchemas[i].id) return &kCalculatorSchemas[i];
  }
  return nullptr;
}

const CalculatorSchema* calculatorForCommand(const std::string& commandId) {
  for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
    if (commandId == kCalculatorSchemas[i].commandId) return &kCalculatorSchemas[i];
  }
  return nullptr;
}

std::vector<ParamSpec> calculatorParamSpecs(const CalculatorSchema& schema) {
  std::vector<ParamSpec> specs;
  specs.reserve(schema.inputCount);
  for (std::size_t i = 0; i < schema.inputCount; ++i) {
    const CalculatorFieldSchema& field = schema.inputs[i];
    ParamSpec spec;
    spec.name = field.name;
    // The kernel reads a bool as a two-state switch, so a Flag input is never
    // absent -- unchecked IS a value. A Number has no such state: there is no
    // honest starting value for a pipe bore, so it is required with no default
    // and the sheet asks for it.
    spec.type = (field.kind == CalculatorValueKind::Flag) ? ParamType::Flag : ParamType::Number;
    if (spec.type == ParamType::Flag) {
      spec.required = false;
      spec.hasDefault = true;
      spec.defaultText = "off";
    } else {
      spec.required = true;
      spec.hasDefault = false;
    }
    specs.push_back(std::move(spec));
  }
  return specs;
}

const char* calculatorRefusalText() noexcept {
  return "Forge could not work this out from the numbers given. Each one has to be a real "
         "measurement the method covers, so check them over and run it again.";
}

void CalculatorBench::bind(CalculatorEvaluator evaluator) { evaluator_ = std::move(evaluator); }

void CalculatorBench::forget() noexcept {
  last_ = CalculatorOutcome{};
}

bool CalculatorBench::run(const CalculatorSchema& schema, const CommandParams& inputs,
                          std::string& refusal) {
  // The outcome is replaced WHOLE on every run, success or refusal. Leaving the
  // previous answer's readings standing beside a new refusal is how a reader is
  // shown numbers that belong to a calculation that is no longer on screen.
  CalculatorOutcome outcome;
  outcome.calculatorId = schema.id;
  outcome.title = schema.label;

  if (!evaluator_) {
    // Not a defect a user caused and not one they can fix by retyping, so it
    // says what is true rather than blaming the numbers.
    outcome.refusal = "This build of Forge cannot run engineering calculations.";
    refusal = outcome.refusal;
    last_ = std::move(outcome);
    return false;
  }

  std::vector<double> values;
  std::string why;
  const bool ok = evaluator_(schema.id, inputs, values, why);
  if (!ok) {
    outcome.refusal = why.empty() ? std::string(calculatorRefusalText()) : why;
    refusal = outcome.refusal;
    last_ = std::move(outcome);
    return false;
  }
  if (values.size() != schema.outputCount) {
    // The seam answered with a different number of values than the kernel
    // header declares. That is a wiring fault, not a user's arithmetic, and
    // publishing the values anyway would pair each reading with the wrong label
    // -- the failure would then look like a wrong ANSWER rather than a wrong
    // WIRE, which is the harder one to find.
    outcome.refusal = calculatorRefusalText();
    refusal = outcome.refusal;
    last_ = std::move(outcome);
    return false;
  }

  outcome.readings.reserve(schema.outputCount);
  for (std::size_t i = 0; i < schema.outputCount; ++i) {
    const CalculatorFieldSchema& field = schema.outputs[i];
    CalculatorReading reading;
    reading.label = field.label;
    reading.unit = field.unit;
    reading.value = values[i];
    reading.isFlag = (field.kind == CalculatorValueKind::Flag);
    reading.flag = reading.isFlag && values[i] != 0.0;
    outcome.readings.push_back(std::move(reading));
  }
  outcome.computed = true;
  refusal.clear();
  last_ = std::move(outcome);
  ++completed_;
  return true;
}

const std::vector<std::string>& calculatorCommandIds() {
  static const std::vector<std::string> ids = [] {
    std::vector<std::string> out;
    out.reserve(kCalculatorSchemaCount);
    for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
      out.emplace_back(kCalculatorSchemas[i].commandId);
    }
    std::sort(out.begin(), out.end());
    return out;
  }();
  return ids;
}

std::size_t registerCalculatorCommands(CommandRegistry& registry, CalculatorBench& bench) {
  CalculatorBench* b = &bench;
  std::size_t added = 0;
  for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
    const CalculatorSchema* schema = &kCalculatorSchemas[i];
    CommandDescriptor c;
    c.id = schema->commandId;
    c.label = schema->label;
    c.category = kCategory;
    // No feature-IR operation, and that is a statement rather than an omission:
    // a calculation READS numbers a person typed and writes nothing into the
    // part, so there is no statement for it to emit and nothing for Archie to
    // replay into a feature tree.
    c.featureIrOp.clear();
    c.signature = SelectionSignature::none();
    c.schema = calculatorParamSpecs(*schema);
    c.preview = PreviewPolicy::None;
    // It changes no document, so it takes no undo step and puts bytes on no
    // path. Declaring Document here would make every calculation dirty the part
    // and rebuild the viewport for an answer that touched neither.
    c.sideEffect = SideEffectClass::ViewOnly;
    c.writes = WriteIntent::None;
    c.undo = UndoContract::NotUndoable;
    c.version = 1;
    c.execute = [b, schema](CommandContext& ctx) {
      std::string refusal;
      if (!b->run(*schema, ctx.params(), refusal)) ctx.fail(refusal);
    };
    if (registry.add(std::move(c))) ++added;
  }
  return added;
}

}  // namespace forge::ui
