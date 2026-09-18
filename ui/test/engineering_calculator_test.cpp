// ui/test/engineering_calculator_test.cpp
//
// THE GATE ON THE ONE THING T-169 CLAIMS: that an engineering calculation the
// C++ kernel already computes is now reachable from the C++ application through
// a command id, with a form that names every number the KERNEL declares and no
// string a developer wrote.
//
// It checks five things, and each one is here because it can fail on its own:
//
//   A. THE SECOND DERIVATION. The compiled schema is generated from the kernel
//      headers by a Python tool. A generator's output is a PROMISE until
//      something else derives the same fact and the two are required to agree,
//      so this gate OPENS THE KERNEL HEADER ITSELF and re-derives the member
//      list in C++ -- names, order and count, for Input and for Result. A
//      generator that silently dropped a field, reordered two, or was simply
//      never re-run is red here.
//   B. THE COMMANDS EXIST AND DISPATCH. Registered into a real registry under
//      real ids, found by id, and run.
//   C. THE SEAM CARRIES THE ANSWER. Every declared output reaches a reading, in
//      declaration order, with the schema's label and unit on it.
//   D. NO DEVELOPER PROSE REACHES A PERSON. Every string this subsystem can put
//      on screen goes through the application's OWN scanner, and the machine
//      keys are asserted to be strings that scanner REJECTS -- so the check has
//      teeth rather than a clean list to walk.
//   E. A CALCULATION IS NEVER MADE UP. A missing number is refused by the
//      registry, an unbound seam refuses in the user's words, and a seam that
//      answers with the wrong number of values is refused rather than read out
//      against the wrong labels.
//
// The value a dispatch returns is NOT compared against the kernel here, and the
// reason is structural: nothing under ui/ links the kernel, which is what lets
// this whole suite run headless. That comparison is the value gate run by
// forge-desktop/test/run_calculator_gate.sh,
// which links both and runs them side by side.
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/CalculatorSchema.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/EngineeringCalculators.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

#ifndef FORGE_UI_REPO_ROOT
#error "FORGE_UI_REPO_ROOT must be defined: this gate reads kernel headers as data"
#endif

std::string repoRoot() { return std::string(FORGE_UI_REPO_ROOT); }

std::string slurp(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    ok = false;
    return std::string();
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

// ── the SECOND derivation ───────────────────────────────────────────────────
// A deliberately small, deliberately BRITTLE reader of `struct <name> { ... };`
// that returns the member names in declaration order. It understands exactly the
// shape the kernel's calculator headers use -- one `<type> <name>;` per line with
// an optional trailing comment -- and returns nothing at all for anything else,
// so a header it cannot read fails the comparison instead of passing it empty.
std::vector<std::string> membersOf(const std::string& header, const std::string& structName) {
  std::vector<std::string> out;
  const std::string open = "struct " + structName + " {";
  const std::size_t at = header.find(open);
  if (at == std::string::npos) return out;

  // One accumulated line: strip a trailing comment, then read `<type> <name>;`.
  const auto take = [&out](const std::string& line) {
    const std::size_t slashes = line.find("//");
    std::string code = (slashes == std::string::npos) ? line : line.substr(0, slashes);
    const std::size_t semi = code.find(';');
    if (semi == std::string::npos) return;
    code = code.substr(0, semi);
    // the last whitespace-separated token is the member name
    std::istringstream words(code);
    std::string token, last;
    while (words >> token) last = token;
    if (!last.empty()) out.push_back(last);
  };

  std::size_t i = at + open.size();
  int depth = 1;
  std::string line;
  for (; i < header.size(); ++i) {
    const char ch = header[i];
    if (ch == '{') ++depth;
    if (ch == '}') {
      --depth;
      // THE PENDING LINE IS TAKEN, NOT DROPPED. A one-line struct puts its
      // whole body before the closing brace and never emits a newline; the
      // first version of this reader broke out here and returned nothing for
      // it, which its own self-test caught.
      if (depth == 0) {
        take(line);
        break;
      }
    }
    if (ch != '\n') {
      line.push_back(ch);
      continue;
    }
    take(line);
    line.clear();
  }
  return out;
}

// An evaluator that answers with a value this test chose, so C can tell a
// reading that carried the seam's answer from one that carried a coincidence.
CalculatorEvaluator countingEvaluator(double first, double step) {
  return [first, step](const std::string& id, const CommandParams&, std::vector<double>& out,
                       std::string&) -> bool {
    const CalculatorSchema* schema = findCalculatorSchema(id);
    if (schema == nullptr) return false;
    out.clear();
    for (std::size_t i = 0; i < schema->outputCount; ++i) {
      out.push_back(first + step * static_cast<double>(i));
    }
    return true;
  };
}

// Fill every declared input with a value, so the registry's required-parameter
// gate is satisfied and the handler is actually reached.
CommandParams everyInput(const CalculatorSchema& schema, double value) {
  CommandParams p;
  for (std::size_t i = 0; i < schema.inputCount; ++i) {
    const CalculatorFieldSchema& f = schema.inputs[i];
    if (f.kind == CalculatorValueKind::Flag) {
      p.setFlag(f.name, false);
    } else {
      p.setNumber(f.name, value);
    }
  }
  return p;
}

}  // namespace

int main() {
  forge::uitest::Harness H("engineering_calculator");

  // This gate is worth nothing if the family is empty.
  CHECK(kCalculatorSchemaCount >= 1);
  std::printf("[calc] %zu calculators compiled in, %zu command ids\n", kCalculatorSchemaCount,
              calculatorCommandIds().size());
  CHECK_EQ_INT(calculatorCommandIds().size(), kCalculatorSchemaCount);

  // ── A. the schema is the KERNEL'S declaration, re-derived here ────────────
  {
    std::size_t fieldsCompared = 0;
    for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
      const CalculatorSchema& schema = kCalculatorSchemas[i];
      bool ok = false;
      const std::string text = slurp(repoRoot() + "/" + schema.kernelHeaderPath, ok);
      if (!ok) std::printf("[calc] cannot read %s\n", schema.kernelHeaderPath);
      CHECK(ok);
      if (!ok) continue;

      // The header must actually declare the entry point. A header that only
      // declares structs computes nothing, and a form in front of it would be
      // the placeholder this ticket forbids.
      CHECK(text.find("Result analyse(const Input&") != std::string::npos);

      const std::vector<std::string> inputs = membersOf(text, "Input");
      const std::vector<std::string> outputs = membersOf(text, "Result");
      if (inputs.size() != schema.inputCount || outputs.size() != schema.outputCount) {
        std::printf("[calc] %s: header declares %zu in / %zu out, schema carries %zu / %zu\n",
                    schema.id, inputs.size(), outputs.size(), schema.inputCount,
                    schema.outputCount);
      }
      CHECK_EQ_INT(inputs.size(), schema.inputCount);
      CHECK_EQ_INT(outputs.size(), schema.outputCount);

      for (std::size_t f = 0; f < schema.inputCount && f < inputs.size(); ++f) {
        if (forge::uitest::at(inputs, f) != schema.inputs[f].name) {
          std::printf("[calc] %s input %zu: header says %s, schema says %s\n", schema.id, f,
                      forge::uitest::at(inputs, f).c_str(), schema.inputs[f].name);
        }
        CHECK_EQ_STR(forge::uitest::at(inputs, f), schema.inputs[f].name);
        ++fieldsCompared;
      }
      for (std::size_t f = 0; f < schema.outputCount && f < outputs.size(); ++f) {
        if (forge::uitest::at(outputs, f) != schema.outputs[f].name) {
          std::printf("[calc] %s output %zu: header says %s, schema says %s\n", schema.id, f,
                      forge::uitest::at(outputs, f).c_str(), schema.outputs[f].name);
        }
        CHECK_EQ_STR(forge::uitest::at(outputs, f), schema.outputs[f].name);
        ++fieldsCompared;
      }
    }
    // The comparison above walks nothing if the parser returned empty lists and
    // the counts happened to match at zero. Printing and pinning the number is
    // what stops this check from passing by doing nothing.
    std::printf("[calc] re-derived %zu field names from the kernel headers\n", fieldsCompared);
    CHECK(fieldsCompared >= kCalculatorSchemaCount * 2);
  }

  // ── A'. the parser can FAIL. Otherwise A is a walk over empty lists ───────
  {
    CHECK(membersOf("struct Input { double a; };", "Input").size() == 1);
    CHECK(membersOf("struct Nothing { double a; };", "Input").empty());
  }

  // ── B. the commands exist, and dispatch reaches the seam ─────────────────
  {
    CommandRegistry registry;
    CalculatorBench bench;
    bench.bind(countingEvaluator(10.0, 1.0));
    const std::size_t added = registerCalculatorCommands(registry, bench);
    CHECK_EQ_INT(added, kCalculatorSchemaCount);
    CHECK_EQ_INT(registry.size(), kCalculatorSchemaCount);

    // Registering twice must add nothing: two handlers behind one id is the
    // failure the single registry exists to prevent.
    CHECK_EQ_INT(registerCalculatorCommands(registry, bench), 0u);
    CHECK_EQ_INT(registry.size(), kCalculatorSchemaCount);

    SelectionService selection;
    for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
      const CalculatorSchema& schema = kCalculatorSchemas[i];
      const CommandDescriptor* d = registry.find(schema.commandId);
      CHECK(d != nullptr);
      if (d == nullptr) continue;
      // Every input the kernel declares is a box the sheet can offer.
      CHECK_EQ_INT(editableParameters(*d).size(), schema.inputCount);
      CHECK_EQ_STR(d->label, std::string(schema.label));
      // A calculation reads numbers and writes nothing into the part.
      CHECK(d->sideEffect == SideEffectClass::ViewOnly);
      CHECK(d->undo == UndoContract::NotUndoable);
      CHECK(d->writes == WriteIntent::None);
      CHECK(d->featureIrOp.empty());
      // It needs nothing picked: a pipe bore is typed, not selected.
      CHECK(d->signature.kind == EntityKind::None);

      const DispatchResult r = registry.dispatch(schema.commandId, selection,
                                                 everyInput(schema, 1.0));
      if (!r.ok()) std::printf("[calc] %s refused: %s\n", schema.commandId, r.detail.c_str());
      CHECK(r.ok());

      // ── C. the answer is the seam's, laid against the schema's labels ────
      const CalculatorOutcome& outcome = bench.lastOutcome();
      CHECK(outcome.computed);
      CHECK_EQ_STR(outcome.calculatorId, std::string(schema.id));
      CHECK_EQ_STR(outcome.title, std::string(schema.label));
      CHECK(outcome.refusal.empty());
      CHECK_EQ_INT(outcome.readings.size(), schema.outputCount);
      for (std::size_t f = 0; f < schema.outputCount && f < outcome.readings.size(); ++f) {
        // The loop condition already bounds f against both sizes, so this index
        // is guarded by the same test that decided to read it.
        const CalculatorReading& reading = outcome.readings[f];
        CHECK_EQ_STR(reading.label, std::string(schema.outputs[f].label));
        CHECK_EQ_STR(reading.unit, std::string(schema.outputs[f].unit));
        // The value the seam put at position f, at position f. A readings list
        // built in any other order pairs a number with the wrong name, which is
        // the one failure a reader cannot see.
        CHECK_NEAR(reading.value, 10.0 + static_cast<double>(f), 1e-12);
        CHECK(reading.isFlag == (schema.outputs[f].kind == CalculatorValueKind::Flag));
      }
    }
    CHECK_EQ_INT(bench.completed(), kCalculatorSchemaCount);
  }

  // ── D. nothing a person reads is a developer's string ────────────────────
  {
    std::size_t scanned = 0;
    for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
      const CalculatorSchema& schema = kCalculatorSchemas[i];
      const std::string drawn[] = {schema.label, schema.summary};
      for (const std::string& text : drawn) {
        const std::vector<ProseFinding> f = scanUserFacingProse(text);
        if (!f.empty()) {
          std::printf("[calc] %s shows \"%s\": %s\n", schema.id, text.c_str(),
                      describeProseFindings(f).c_str());
        }
        CHECK(f.empty());
        ++scanned;
      }
      for (std::size_t k = 0; k < schema.inputCount + schema.outputCount; ++k) {
        const CalculatorFieldSchema& field = (k < schema.inputCount)
                                                 ? schema.inputs[k]
                                                 : schema.outputs[k - schema.inputCount];
        const std::string fields[] = {std::string(field.label), std::string(field.unit)};
        for (const std::string& text : fields) {
          const std::vector<ProseFinding> f = scanUserFacingProse(text);
          if (!f.empty()) {
            std::printf("[calc] %s field \"%s\" shows \"%s\": %s\n", schema.id, field.name,
                        text.c_str(), describeProseFindings(f).c_str());
          }
          CHECK(f.empty());
          ++scanned;
        }
        // A label is not allowed to BE the machine key. Equality is the cheapest
        // way this subsystem could regress into drawing identifiers, and the
        // scanner alone would not always catch it -- `slope` is a machine key
        // and an English word at once.
        CHECK(std::string(field.label) != std::string(field.name));
      }
    }
    // The refusal sentence is read by a user who typed a number the method
    // cannot use, so it is held to the same standard as a label.
    CHECK(scanUserFacingProse(calculatorRefusalText()).empty());
    ++scanned;
    std::printf("[calc] %zu user-facing strings scanned clean\n", scanned);
    CHECK(scanned >= kCalculatorSchemaCount * 4);

    // ── THE SCANNER FIRES ON OUR OWN DATA ──────────────────────────────────
    // Every check above is an application of scanUserFacingProse(). If it came
    // back empty unconditionally they would all pass and this section would be
    // decoration. The schema carries a real file path for exactly this reason,
    // and it is the string that must NOT be clean.
    for (std::size_t i = 0; i < kCalculatorSchemaCount; ++i) {
      const std::vector<ProseFinding> f =
          scanUserFacingProse(kCalculatorSchemas[i].kernelHeaderPath);
      CHECK(!f.empty());
    }
    CHECK(!scanUserFacingProse("forge::circpipe::analyse threw").empty());
  }

  // ── E. a calculation is refused, never invented ──────────────────────────
  {
    CommandRegistry registry;
    CalculatorBench bench;
    bench.bind(countingEvaluator(1.0, 1.0));
    registerCalculatorCommands(registry, bench);
    SelectionService selection;
    const CalculatorSchema& first = kCalculatorSchemas[0];

    // a number the user has not given yet: the registry asks, it does not guess
    CommandParams short_ = everyInput(first, 2.0);
    {
      CommandParams missing;
      for (std::size_t i = 1; i < first.inputCount; ++i) {
        const CalculatorFieldSchema& f = first.inputs[i];
        if (f.kind == CalculatorValueKind::Flag) {
          missing.setFlag(f.name, false);
        } else {
          missing.setNumber(f.name, 2.0);
        }
      }
      const DispatchResult r = registry.dispatch(first.commandId, selection, missing);
      CHECK(r.status == DispatchStatus::MissingRequiredParameter);
      // and it names the one it is short of, so a sheet can open on it
      const CommandDescriptor* d = registry.find(first.commandId);
      CHECK(d != nullptr);
      if (d != nullptr) CHECK_EQ_INT(missingRequired(*d, missing).size(), 1u);
    }
    // applyDefaults must NOT fill a measurement in. A calculator that ran on
    // invented numbers would answer, confidently, about a part nobody has.
    {
      const CommandDescriptor* d = registry.find(first.commandId);
      CHECK(d != nullptr);
      if (d != nullptr) {
        const CommandParams filled = applyDefaults(*d, CommandParams{});
        CHECK_EQ_INT(missingRequired(*d, filled).size(), first.inputCount);
      }
    }

    // an unbound seam refuses in the user's words and publishes no readings
    {
      CommandRegistry bare;
      CalculatorBench unbound;
      registerCalculatorCommands(bare, unbound);
      CHECK(!unbound.bound());
      const DispatchResult r = bare.dispatch(first.commandId, selection, short_);
      CHECK(r.status == DispatchStatus::EditRefused);
      CHECK(!unbound.lastOutcome().computed);
      CHECK(unbound.lastOutcome().readings.empty());
      CHECK(!unbound.lastOutcome().refusal.empty());
      CHECK(scanUserFacingProse(unbound.lastOutcome().refusal).empty());
      CHECK_EQ_INT(unbound.completed(), 0u);
    }

    // a seam that answers with the wrong number of values is refused, not read
    // out against labels it does not line up with
    {
      CommandRegistry wired;
      CalculatorBench wrong;
      wrong.bind([](const std::string&, const CommandParams&, std::vector<double>& out,
                    std::string&) -> bool {
        out.assign(1, 42.0);  // one value, whatever the schema declares
        return true;
      });
      registerCalculatorCommands(wired, wrong);
      const DispatchResult r = wired.dispatch(first.commandId, selection, short_);
      CHECK(r.status == DispatchStatus::EditRefused);
      CHECK(!wrong.lastOutcome().computed);
      CHECK(wrong.lastOutcome().readings.empty());
      CHECK_EQ_INT(wrong.completed(), 0u);
    }

    // A seam that refuses leaves NO readings from the run before it standing.
    // Numbers that belong to a calculation which is no longer on screen are the
    // worst thing a readout can hold: they are plausible, they are labelled, and
    // they are about something else.
    {
      std::string why;
      CHECK(bench.run(first, short_, why));
      CHECK(!bench.lastOutcome().readings.empty());
      bench.bind([](const std::string&, const CommandParams&, std::vector<double>&,
                    std::string& refusal) -> bool {
        refusal = "This calculation needs a pipe that water can flow along.";
        return false;
      });
      CHECK(!bench.run(first, short_, why));
      CHECK(bench.lastOutcome().readings.empty());
      CHECK(!bench.lastOutcome().computed);
      CHECK_EQ_STR(bench.lastOutcome().refusal, why);
    }
  }

  return H.finish();
}
