#include "forge/ui/Onboarding.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {
namespace {

SampleSelection pick(const char* node, EntityKind kind) {
  SampleSelection s;
  s.node = node;
  s.kind = kind;
  return s;
}

SampleStep step(const char* command, std::vector<SampleSelection> select,
                std::vector<std::pair<std::string, double>> numbers,
                std::vector<std::pair<std::string, std::string>> texts = {}) {
  SampleStep s;
  s.commandId = command;
  s.select = std::move(select);
  s.numbers = std::move(numbers);
  s.texts = std::move(texts);
  return s;
}

// The node a Part command binds its result to is derived from the statement's
// creation id: a profile becomes `sketch_<id>`, a 3D section `wire_<id>`, a new
// solid `body_<id>`, and a command that EDITS a solid keeps the node it was
// given. The samples below name those nodes literally, which is deliberate:
// writing them out is what makes the sample a statement about the document's
// structure that replaySample() can falsify.
std::vector<SampleDocument> buildSamples() {
  std::vector<SampleDocument> out;

  {
    SampleDocument s;
    s.id = "bracket";
    s.title = "Plate Bracket";
    s.summary = "A filleted plate with a patterned bolt hole, shelled to a 2 mm wall.";
    s.teaches = {"profile -> solid", "edge fillet", "hole", "linear pattern", "shell"};
    s.steps = {
        step("part.sketch_rect", {}, {{"width", 80.0}, {"height", 50.0}}),
        step("part.extrude", {pick("sketch_1", EntityKind::Sketch)}, {{"distance", 12.0}}),
        step("part.fillet", {pick("body_2", EntityKind::Edge)}, {{"radius", 4.0}}),
        step("part.hole", {pick("body_2", EntityKind::Face)}, {{"diameter", 8.0}, {"x", 25.0}}),
        step("part.pattern_linear", {pick("body_2", EntityKind::Body)},
             {{"count", 3.0}, {"dx", 20.0}}),
        step("part.shell", {pick("body_2", EntityKind::Face)}, {{"thickness", 2.0}}),
    };
    s.expectedIr =
        "%1 = RECT(80, 50)\n"
        "%2 = EXTRUDE(%1, 12)\n"
        "%3 = FILLET(%2, 4, ALL)\n"
        "%4 = HOLE(%3, 8, 25, 0, 0)\n"
        "%5 = PATTERN(%4, LINEAR, 3, 20)\n"
        "%6 = SHELL(%5, 2)\n";
    out.push_back(std::move(s));
  }

  {
    SampleDocument s;
    s.id = "flange";
    s.title = "Round Flange";
    s.summary = "A disc with six bolt holes on a polar pattern and a chamfered rim.";
    s.teaches = {"circular profile", "polar pattern", "chamfer"};
    s.steps = {
        step("part.sketch_circle", {}, {{"radius", 30.0}}),
        step("part.extrude", {pick("sketch_1", EntityKind::Sketch)}, {{"distance", 8.0}}),
        step("part.hole", {pick("body_2", EntityKind::Face)}, {{"diameter", 6.0}, {"x", 20.0}}),
        step("part.pattern_circular", {pick("body_2", EntityKind::Body)}, {{"count", 6.0}}),
        step("part.chamfer", {pick("body_2", EntityKind::Edge)}, {{"distance", 1.0}}),
    };
    s.expectedIr =
        "%1 = CIRCLE(30)\n"
        "%2 = EXTRUDE(%1, 8)\n"
        "%3 = HOLE(%2, 6, 20, 0, 0)\n"
        "%4 = PATTERN(%3, POLAR, 6, 360)\n"
        "%5 = CHAMFER(%4, 1, ALL)\n";
    out.push_back(std::move(s));
  }

  {
    SampleDocument s;
    s.id = "transition";
    s.title = "Lofted Transition";
    s.summary = "Two 3D section rings lofted into a tapered duct, then shelled.";
    s.teaches = {"section outlines are not sketches", "loft", "shell"};
    s.steps = {
        step("part.section_ring", {}, {{"rx", 25.0}, {"ry", 25.0}, {"z", 0.0}}),
        step("part.section_ring", {}, {{"rx", 12.0}, {"ry", 12.0}, {"z", 40.0}}),
        step("part.loft", {pick("wire_1", EntityKind::Wire), pick("wire_2", EntityKind::Wire)}, {}),
        step("part.shell", {pick("body_3", EntityKind::Face)}, {{"thickness", 2.0}}),
    };
    s.expectedIr =
        "%1 = RING(25, 25, 0)\n"
        "%2 = RING(12, 12, 40)\n"
        "%3 = LOFT(%1, %2)\n"
        "%4 = SHELL(%3, 2)\n";
    out.push_back(std::move(s));
  }

  {
    // The one that matters. The ground-truth parts this application is aimed at
    // are 14-op trees over hundreds of faces; a sample set of three-step cubes
    // would say nothing about whether the shell can drive one.
    SampleDocument s;
    s.id = "housing";
    s.title = "Gearbox Housing";
    s.summary =
        "Fourteen features: a shelled box, a grid of mounting holes, a counterbored boss "
        "fused on, and the whole thing mirrored.";
    s.teaches = {"14-feature history", "grid pattern", "counterbore",
                 "boolean union consumes the tool body", "mirror"};
    s.steps = {
        step("part.sketch_rect", {}, {{"width", 120.0}, {"height", 80.0}}),
        step("part.extrude", {pick("sketch_1", EntityKind::Sketch)}, {{"distance", 30.0}}),
        step("part.fillet", {pick("body_2", EntityKind::Edge)}, {{"radius", 6.0}}),
        step("part.hole", {pick("body_2", EntityKind::Face)},
             {{"diameter", 10.0}, {"x", 45.0}, {"y", 28.0}}),
        step("part.pattern_grid", {pick("body_2", EntityKind::Body)},
             {{"nx", 2.0}, {"ny", 2.0}, {"dx", 90.0}, {"dy", 56.0}}),
        step("part.counterbore", {pick("body_2", EntityKind::Face)},
             {{"diameter", 6.0}, {"cbore_diameter", 11.0}, {"cbore_depth", 4.0}}),
        step("part.shell", {pick("body_2", EntityKind::Face)}, {{"thickness", 3.0}}),
        step("part.sketch_circle", {}, {{"radius", 18.0}}),
        step("part.extrude", {pick("sketch_8", EntityKind::Sketch)}, {{"distance", 46.0}}),
        // Selection ORDER decides which body survives: the first pick is the
        // target and keeps its node, the second is the tool and is consumed.
        step("part.boolean_union",
             {pick("body_2", EntityKind::Body), pick("body_9", EntityKind::Body)}, {}),
        step("part.fillet", {pick("body_2", EntityKind::Edge)}, {{"radius", 2.0}}),
        step("part.hole", {pick("body_2", EntityKind::Face)}, {{"diameter", 12.0}}),
        step("part.chamfer", {pick("body_2", EntityKind::Edge)}, {{"distance", 1.0}}),
        step("part.mirror", {pick("body_2", EntityKind::Body)}, {}, {{"plane", "YZ"}}),
    };
    s.expectedIr =
        "%1 = RECT(120, 80)\n"
        "%2 = EXTRUDE(%1, 30)\n"
        "%3 = FILLET(%2, 6, ALL)\n"
        "%4 = HOLE(%3, 10, 45, 28, 0)\n"
        "%5 = PATTERN(%4, GRID, 2, 2, 90, 56)\n"
        "%6 = CBORE(%5, 6, 11, 4, 0, 0, 0)\n"
        "%7 = SHELL(%6, 3)\n"
        "%8 = CIRCLE(18)\n"
        "%9 = EXTRUDE(%8, 46)\n"
        "%10 = FUSE(%7, %9)\n"
        "%11 = FILLET(%10, 2, ALL)\n"
        "%12 = HOLE(%11, 12, 0, 0, 0)\n"
        "%13 = CHAMFER(%12, 1, ALL)\n"
        "%14 = MIRROR(%13, YZ)\n";
    out.push_back(std::move(s));
  }

  return out;
}

}  // namespace

const std::vector<SampleDocument>& sampleDocuments() {
  static const std::vector<SampleDocument> kSamples = buildSamples();
  return kSamples;
}

const SampleDocument* findSample(const std::string& id) {
  for (const SampleDocument& s : sampleDocuments()) {
    if (s.id == id) return &s;
  }
  return nullptr;
}

std::vector<std::string> sampleIds() {
  std::vector<std::string> out;
  for (const SampleDocument& s : sampleDocuments()) out.push_back(s.id);
  return out;
}

std::string SampleOutcome::describe() const {
  std::ostringstream os;
  if (ok) {
    os << "built " << stepsRun << " step(s)";
    return os.str();
  }
  // machineName, not userText: SampleOutcome::describe() is the DIAGNOSTIC
  // rendering -- it is what a gate prints and what the log's detail column
  // carries. The sentence a user reads when a sample will not load is built in
  // ForgeShell, from userText.
  os << "stopped after " << stepsRun << " step(s) at " << failedCommand << ": "
     << machineName(status);
  if (!detail.empty()) os << " (" << detail << ')';
  return os.str();
}

SampleOutcome replaySample(const SampleDocument& sample, const CommandRegistry& registry,
                           SelectionService& selection, const PartDocument* document) {
  SampleOutcome outcome;
  for (const SampleStep& s : sample.steps) {
    // The selection filter would refuse a pick of a kind it does not accept, and
    // a sample must not be defeated by whatever the user last set it to. Widen
    // it for the replay and put it back afterwards.
    const EntityKind savedFilter = selection.filter();
    selection.setFilter(EntityKind::Any);
    std::vector<EntityRef> refs;
    for (const SampleSelection& p : s.select) {
      EntityRef ref;
      ref.bodyId = p.node;
      ref.kind = p.kind;
      refs.push_back(ref);
    }
    selection.replaceWith(refs);
    selection.setFilter(savedFilter);

    CommandParams params;
    for (const auto& [name, value] : s.numbers) params.setNumber(name, value);
    for (const auto& [name, value] : s.texts) params.setText(name, value);

    const DispatchResult r = registry.dispatch(s.commandId, selection, params);
    if (!r.ok()) {
      outcome.failedCommand = s.commandId;
      outcome.status = r.status;
      outcome.detail = r.detail;
      if (document != nullptr) outcome.irProgram = document->irProgram();
      return outcome;
    }
    ++outcome.stepsRun;
  }
  outcome.ok = true;
  if (document != nullptr) outcome.irProgram = document->irProgram();
  return outcome;
}

// ── the empty state ─────────────────────────────────────────────────────────
namespace {

std::size_t countConsumers(const CommandRegistry& registry, EntityKind kind) {
  std::size_t n = 0;
  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* d = registry.find(id);
    if (d != nullptr && d->signature.kind == kind) ++n;
  }
  return n;
}

std::vector<std::string> consumerIds(const CommandRegistry& registry, EntityKind kind) {
  std::vector<std::string> out;
  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* d = registry.find(id);
    if (d != nullptr && d->signature.kind == kind) out.push_back(id);
  }
  return out;
}

// Names, capped, with an honest "and N more" rather than an ellipsis that
// hides how many were dropped. Renamed from joinIds when the thing being joined
// stopped being ids: the old name would have made the next caller reach for the
// ids again.
std::string joinNames(const std::vector<std::string>& names, std::size_t limit) {
  std::string out;
  for (std::size_t i = 0; i < names.size() && i < limit; ++i) {
    if (i != 0) out += ", ";
    out += names[i];
  }
  if (names.size() > limit) {
    out += " and " + std::to_string(names.size() - limit) + " more";
  }
  return out;
}

}  // namespace

EmptyState buildEmptyState(const CommandRegistry& registry, std::size_t featureCount) {
  EmptyState state;
  state.documentEmpty = featureCount == 0;

  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* d = registry.find(id);
    if (d == nullptr) continue;
    // A CREATOR: needs nothing picked and emits feature IR. That pair is the
    // whole definition, and it is what makes this list grow by itself — the
    // solid primitives being added on another branch land here for free.
    if (d->signature.kind != EntityKind::None) continue;
    if (d->featureIrOp.empty()) continue;
    if (d->sideEffect != SideEffectClass::Document) continue;
    EmptyStateAction action;
    action.commandId = d->id;
    action.label = d->label;
    // WHAT PRESSING IT DOES, not which token it emits. This is the tooltip on
    // the very first thing a new user hovers, and it used to say
    // "emits BOX — nothing needs to be selected".
    action.description = "Starts a new shape. Nothing has to be selected first.";
    state.creators.push_back(std::move(action));
  }

  state.sampleIds = sampleIds();

  if (state.documentEmpty) {
    state.headline = "No features yet";
    state.body =
        "This document has no geometry. Every command below runs with nothing selected, so "
        "any of them is a legal first step; or open one of the sample parts to see a "
        "complete feature tree.";
  } else {
    state.headline = std::to_string(featureCount) + " feature" +
                     (featureCount == 1 ? "" : "s") + " in this document";
    state.body =
        "Select geometry in the viewport to see which commands become available. The status "
        "strip's filter decides what a click picks: face, edge, or body.";
  }

  // ── THE THREE STEPS, IN LABELS, NOT IDS ─────────────────────────────────
  // These lines used to end with a comma-separated list of COMMAND IDS --
  // "part.input_solid, part.primitive_box, part.primitive_cone, ..." -- on the
  // card that a user with an empty document reads first. The counts are the
  // useful half and they are derived, so they still grow by themselves; the
  // names are the ones on the buttons directly above.
  const std::vector<std::string> profileConsumers = consumerIds(registry, EntityKind::Sketch);
  std::vector<std::string> creatorLabels;
  for (const EmptyStateAction& a : state.creators) creatorLabels.push_back(a.label);

  state.nextSteps.push_back(
      "1. Start a shape — any of the " + std::to_string(state.creators.size()) +
      " buttons above works with nothing selected: " + joinNames(creatorLabels, 4) + ".");
  state.nextSteps.push_back(
      "2. Pick what it made, then build on it — " + std::to_string(profileConsumers.size()) +
      " tools work on a sketch.");
  state.nextSteps.push_back(
      "3. Refine the solid — " + std::to_string(countConsumers(registry, EntityKind::Edge)) +
      " tools work on edges, " + std::to_string(countConsumers(registry, EntityKind::Face)) +
      " on faces, and " + std::to_string(countConsumers(registry, EntityKind::Body)) +
      " on the whole body.");
  return state;
}

}  // namespace forge::ui
