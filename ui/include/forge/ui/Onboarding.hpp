// ui/include/forge/ui/Onboarding.hpp
//
// THE EMPTY STATE AND THE SAMPLE DOCUMENTS — what the application says to
// somebody who has just opened it, and the parts it can build to show them.
//
// ── the empty state is DERIVED ──────────────────────────────────────────────
// "Draw a rectangle, then extrude it" is a sentence that goes stale the moment a
// command is added or renamed. buildEmptyState() therefore asks the registry
// which commands need NO SELECTION and emit feature IR — those are the ones a
// user with an empty document can actually run — and names them. Add a solid
// primitive and it appears in the empty state with no edit here, which is the
// same rule the ribbon lives by.
//
// ── the samples are PROVED, not pasted ──────────────────────────────────────
// A sample is not a blob of IR text. It is a list of steps, each naming a
// command in the ONE registry, the selection it needs, and its parameters —
// exactly what a user would do. replaySample() runs them through
// CommandRegistry::dispatch, so a sample that has drifted from the commands
// FAILS TO BUILD rather than shipping a program the app can no longer author.
// ui/test/onboarding_test.cpp replays every sample and compares the resulting IR
// against `expectedIr`, character for character.
//
// That is also why the samples are worth their weight: `housing` is a FOURTEEN
// statement tree with a boolean, a grid pattern, a counterbore and a mirror in
// it — the shape of the ground-truth parts this application exists to build, not
// a demo cube.
#ifndef FORGE_UI_ONBOARDING_HPP
#define FORGE_UI_ONBOARDING_HPP

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// One entity a step needs picked before its command will run. `node` is the
// document node ID a Part command resolves to an IR value (EntityRef::bodyId);
// `kind` is what the command's selection signature demands — Face for a hole,
// Edge for a fillet, Body for a pattern, Sketch for an extrude. Both are needed:
// the kind satisfies the signature, the node resolves the value.
struct SampleSelection {
  std::string node;
  EntityKind kind = EntityKind::Body;
};

struct SampleStep {
  std::string commandId;
  std::vector<SampleSelection> select;  // replaces the selection before dispatch
  std::vector<std::pair<std::string, double>> numbers;
  std::vector<std::pair<std::string, std::string>> texts;
};

struct SampleDocument {
  std::string id;       // stable, referenced by app.load_sample's parameter
  std::string title;
  std::string summary;  // one line, shown in the empty state
  std::vector<std::string> teaches;  // the concepts this part demonstrates
  std::vector<SampleStep> steps;
  // The feature-IR program the steps must produce, exactly. Declared here so the
  // gate compares against an INTENT rather than against whatever came out.
  std::string expectedIr;

  std::size_t statementCount() const noexcept { return steps.size(); }
};

const std::vector<SampleDocument>& sampleDocuments();
const SampleDocument* findSample(const std::string& id);
std::vector<std::string> sampleIds();

struct SampleOutcome {
  bool ok = false;
  std::size_t stepsRun = 0;
  std::string failedCommand;      // "" when ok
  DispatchStatus status = DispatchStatus::Ok;
  std::string detail;
  std::string irProgram;          // the document's program after the last step

  std::string describe() const;
};

// Replays `sample` through `registry`, mutating whatever document the registry's
// Part commands were registered against. `selection` is written on every step —
// it IS the user's picking, performed by the sample.
//
// STOPS AT THE FIRST FAILURE and reports which command and why. A sample that
// half-builds is worse than one that refuses: the user is left with a part that
// is not the one the description promised.
// `document` is READ-ONLY and OPTIONAL: pass it to have `irProgram` filled in
// (a gate wants the text), pass nullptr when the caller does not own the
// document it is driving (the shell does not -- the registry's handlers do).
SampleOutcome replaySample(const SampleDocument& sample, const CommandRegistry& registry,
                           SelectionService& selection,
                           const PartDocument* document = nullptr);

// ── the empty state ─────────────────────────────────────────────────────────
struct EmptyStateAction {
  std::string commandId;
  std::string label;
  std::string description;   // derived: what it emits and what it needs
};

struct EmptyState {
  bool documentEmpty = true;
  std::string headline;
  std::string body;
  // Commands that need NO selection and emit feature IR — everything a user can
  // do from nothing. Derived from the registry, sorted by ID.
  std::vector<EmptyStateAction> creators;
  std::vector<std::string> sampleIds;
  std::vector<std::string> nextSteps;  // sentences, each naming real command IDs

  bool empty() const noexcept { return creators.empty() && sampleIds.empty(); }
};

EmptyState buildEmptyState(const CommandRegistry& registry, std::size_t featureCount);

}  // namespace forge::ui

#endif  // FORGE_UI_ONBOARDING_HPP
