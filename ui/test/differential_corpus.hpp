// ui/test/differential_corpus.hpp
//
// THE ONE CORPUS BOTH EXECUTION PATHS READ.
//
// A feature tree can reach the kernel two ways, and until this file existed
// NOTHING compared them:
//
//   headless : IR text -> forge::ft::compileText  (this is what
//              forge-kernel/src/tools/forge_verify.cpp does, and every benchmark
//              number in this programme comes out of it)
//   in-app   : a user invokes commands -> OpConstraintBridge rules on the plan
//              -> PartDocument::appendFeature -> PartDocument::irProgram()
//              -> forge::ft::parse + forge::ft::compile (KernelScene.cpp)
//
// Two artifacts from one source with no gate tying them together is the defect
// class that has bitten this repo nine times (the vocabulary/header desync). A
// tree that builds headless and fails in the app -- or worse, builds
// DIFFERENTLY -- is found by a user, not by CI.
//
// -- why the corpus lives in a HEADER and not in each gate --------------------
// There are two consumers: ui/test/differential_gate_test.cpp (kernel-free, runs
// on every PR in the ubuntu `ui` job) and
// forge-desktop/test/differential_solid_gate.cpp (kernel-linked, runs in the
// macOS `kernel` job that already builds forge_kernel_core). If each carried its
// own copy of the trees, THIS FILE would be the ninth desync it is meant to
// prevent. One corpus, two readers, and the kernel-linked reader asserts the
// corpus it compiled against is the same size the kernel-free one saw.
//
// -- why `headlessIr` is a hand-written literal -------------------------------
// It is the text a planner (Archie, a macro, a corpus row) hands to forge_verify.
// It is deliberately NOT generated from the app path: a comparison whose two arms
// come from one source is one binary compared to itself, which has produced a
// confident "0 differences" in this programme before. The app path must
// REPRODUCE this text, not define it.
#ifndef FORGE_UI_TEST_DIFFERENTIAL_CORPUS_HPP
#define FORGE_UI_TEST_DIFFERENTIAL_CORPUS_HPP

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge {
namespace difftest {

// -- a value the document already holds before any Part command runs ----------
// A sketch authored in the Sketch workspace, or an imported body. `seed()` is
// how ForgeFrame puts the starting part in a new document.
struct Seed {
  forge::ui::IrValueKind kind = forge::ui::IrValueKind::Solid;
  std::string node;                     // the EntityRef::bodyId the UI selects it by
  std::string op;
  std::vector<forge::ui::IrArg> args;
};

// -- one user action ---------------------------------------------------------
// A command id, the selection the user would have picked, and the parameters the
// dialog would have carried. Nothing here writes IR: the registered command does.
struct Step {
  std::string command;
  forge::ui::EntityKind selectionKind = forge::ui::EntityKind::None;
  std::vector<std::string> selectionNodes;
  std::vector<std::pair<std::string, double>> numbers;
  std::vector<std::pair<std::string, std::string>> texts;
  std::vector<std::string> flags;
};

struct Tree {
  std::string id;
  std::string what;
  std::vector<Seed> seeds;
  std::vector<Step> steps;
  std::string headlessIr;   // INDEPENDENT of the app path, on purpose
};

// -- the app path, driven ONCE, here -----------------------------------------
struct AppRun {
  bool ok = false;              // every step dispatched
  std::string failure;          // the first step that did not, and why
  std::string ir;               // PartDocument::irProgram()
  std::vector<forge::ui::IrLine> commandLines;          // command-authored only
  std::vector<forge::ui::IrValueKind> priorValues;      // the seeds, in order
  std::vector<forge::ui::EntityKind> selectionKinds;    // per command line
  std::vector<std::size_t> selectionCounts;
  std::size_t dispatched = 0;
};

// A MUTATION is injected into ONE arm on purpose, so the gate can be shown to
// fail. Every value here must be caught by the comparison; a gate never proven
// to fail is decoration.
enum class Mutation : int {
  None = 0,
  AppDropsLastStep,        // the app path stops one command short
  AppSwapsBooleanOrder,    // CUT(%a,%b) becomes CUT(%b,%a) -- same ops, other solid
  AppPerturbsOneNumber,    // one parameter moves by 0.5 mm
  HeadlessDropsAStatement, // the planner's text loses a line
  HeadlessPerturbsNumber,  // the planner's text moves one number
  HeadlessReordersOps,     // the last two statements swap
  AppSkipsBridgeCheck,     // the bridge is asked about an op no command emits
  Count_
};

inline const char* mutationName(Mutation m) {
  switch (m) {
    case Mutation::None:                    return "none";
    case Mutation::AppDropsLastStep:        return "app-drops-last-step";
    case Mutation::AppSwapsBooleanOrder:    return "app-swaps-boolean-operand-order";
    case Mutation::AppPerturbsOneNumber:    return "app-perturbs-one-number";
    case Mutation::HeadlessDropsAStatement: return "headless-drops-a-statement";
    case Mutation::HeadlessPerturbsNumber:  return "headless-perturbs-one-number";
    case Mutation::HeadlessReordersOps:     return "headless-reorders-two-ops";
    case Mutation::AppSkipsBridgeCheck:     return "app-hands-the-bridge-an-op-no-command-emits";
    case Mutation::Count_:                  return "count";
  }
  return "unknown";
}

// EXACT pin. A Mutation added above must move this number in the SAME change or
// the sweep in run_differential_gate.sh silently stops covering it.
inline constexpr int kMutationCount = static_cast<int>(Mutation::Count_) - 1;

// ----------------------------------------------------------------------------
// THE TREES
//
// Chosen to span the value model (PROFILE, WIRE, SOLID), every command family
// that emits IR (creators, sketch->solid, booleans, features, transforms,
// replication) and both the seeded-sketch and the pure-primitive way of starting
// a document. They are geometrically ordinary on purpose: this gate measures
// AGREEMENT between two paths, and an exotic part that fails to build in both
// arms proves agreement on a failure, which is a weaker fact.
// ----------------------------------------------------------------------------
inline const std::vector<Tree>& trees() {
  using forge::ui::EntityKind;
  using forge::ui::IrArg;
  using forge::ui::IrValueKind;
  static const std::vector<Tree> corpus = {
      // -- 1. the seeded-sketch path: a plate with a rim and a bore ----------
      {"plate_rim_bore",
       "a sketch authored in the Sketch workspace, extruded, filleted and bored",
       {{IrValueKind::Profile, "sketch_1", "RECT", {IrArg::num(80), IrArg::num(60)}}},
       {
           {"part.extrude", EntityKind::Sketch, {"sketch_1"}, {{"distance", 20}}, {}, {}},
           {"part.fillet", EntityKind::Edge, {"body_2"}, {{"radius", 4}}, {}, {}},
           {"part.hole", EntityKind::Face, {"body_2"}, {{"diameter", 10}}, {}, {}},
       },
       "%1 = RECT(80, 60)\n"
       "%2 = EXTRUDE(%1, 20)\n"
       "%3 = FILLET(%2, 4, ALL)\n"
       "%4 = HOLE(%3, 10, 0, 0, 0)\n"},

      // -- 2. the pure-primitive path: no sketch anywhere, D-038's ten ops ---
      {"block_bore_chamfer",
       "a block a user made from the primitive palette, bored by a boolean and chamfered",
       {},
       {
           {"part.primitive_box", EntityKind::None, {}, {{"dx", 40}, {"dy", 30}, {"dz", 20}}, {}, {}},
           {"part.primitive_cylinder", EntityKind::None, {}, {{"radius", 6}, {"height", 40}}, {}, {}},
           {"part.boolean_subtract", EntityKind::Body, {"body_1", "body_2"}, {}, {}, {}},
           {"part.chamfer", EntityKind::Edge, {"body_1"}, {{"distance", 1}}, {}, {}},
       },
       "%1 = BOX(40, 30, 20)\n"
       "%2 = CYL(6, 40)\n"
       "%3 = CUT(%1, %2)\n"
       "%4 = CHAMFER(%3, 1, ALL)\n"},

      // -- 3. the WIRE kind, which only LOFT consumes ------------------------
      {"lofted_nozzle",
       "three section rings lofted -- the only path through the WIRE value kind",
       {},
       {
           {"part.section_ring", EntityKind::None, {}, {{"rx", 20}, {"ry", 20}, {"z", 0}}, {}, {}},
           {"part.section_ring", EntityKind::None, {}, {{"rx", 12}, {"ry", 12}, {"z", 30}}, {}, {}},
           {"part.section_ring", EntityKind::None, {}, {{"rx", 6}, {"ry", 6}, {"z", 60}}, {}, {}},
           {"part.loft", EntityKind::Wire, {"wire_1", "wire_2", "wire_3"}, {}, {}, {"ruled"}},
       },
       "%1 = RING(20, 20, 0)\n"
       "%2 = RING(12, 12, 30)\n"
       "%3 = RING(6, 6, 60)\n"
       "%4 = LOFT(%1, %2, %3, RULED)\n"},

      // -- 4. transforms and replication, the derived-placement family -------
      {"moved_rotated_patterned",
       "TRANSLATE / ROTATE / MIRROR / PATTERN over one primitive",
       {},
       {
           {"part.primitive_box", EntityKind::None, {}, {{"dx", 20}, {"dy", 10}, {"dz", 5}}, {}, {}},
           {"part.move", EntityKind::Body, {"body_1"}, {{"dx", 15}, {"dy", 0}, {"dz", 0}}, {}, {}},
           {"part.rotate", EntityKind::Body, {"body_1"}, {{"angle", 90}, {"axz", 1}}, {}, {}},
           {"part.mirror", EntityKind::Body, {"body_1"}, {}, {{"plane", "YZ"}}, {}},
           {"part.pattern_linear", EntityKind::Body, {"body_1"}, {{"count", 3}, {"dx", 30}}, {}, {}},
       },
       "%1 = BOX(20, 10, 5)\n"
       "%2 = TRANSLATE(%1, 15, 0, 0)\n"
       "%3 = ROTATE(%2, 90, 0, 0, 1)\n"
       "%4 = MIRROR(%3, YZ)\n"
       "%5 = PATTERN(%4, LINEAR, 3, 30)\n"},

      // -- 5. a revolve, and a shelled result --------------------------------
      {"revolved_shell",
       "a profile revolved about the Y axis and hollowed",
       {},
       {
           {"part.sketch_rect", EntityKind::None, {},
            {{"width", 10}, {"height", 40}, {"cx", 30}, {"cy", 0}}, {}, {}},
           {"part.revolve", EntityKind::Sketch, {"sketch_1"}, {{"angle", 360}}, {}, {}},
           {"part.shell", EntityKind::Face, {"body_2"}, {{"thickness", 2}}, {}, {}},
       },
       "%1 = RECT(10, 40, 30, 0)\n"
       "%2 = REVOLVE(%1, 360)\n"
       "%3 = SHELL(%2, 2)\n"},

      // -- 6. the counterbore + variable-fillet feature family ---------------
      {"cbore_and_blend",
       "a counterbored, variable-filleted plate -- CBORE and BLEND, the 7- and 5-arg forms",
       {},
       {
           {"part.primitive_box", EntityKind::None, {}, {{"dx", 60}, {"dy", 60}, {"dz", 12}}, {}, {}},
           {"part.counterbore", EntityKind::Face, {"body_1"},
            {{"diameter", 6}, {"cbore_diameter", 11}, {"cbore_depth", 4}}, {}, {}},
           {"part.variable_fillet", EntityKind::Edge, {"body_1"},
            {{"radius_start", 1}, {"radius_end", 3}}, {}, {"smooth"}},
       },
       "%1 = BOX(60, 60, 12)\n"
       "%2 = CBORE(%1, 6, 11, 4, 0, 0, 0)\n"
       "%3 = BLEND(%2, 1, 3, ALL, SMOOTH)\n"},

      // -- 7. a fuse, and a circle profile: the second creator of PROFILE ----
      {"boss_on_plate",
       "a circular boss fused onto an extruded plate -- CIRCLE, EXTRUDE, FUSE",
       {},
       {
           {"part.sketch_rect", EntityKind::None, {}, {{"width", 50}, {"height", 50}}, {}, {}},
           {"part.extrude", EntityKind::Sketch, {"sketch_1"}, {{"distance", 8}}, {}, {}},
           {"part.sketch_circle", EntityKind::None, {}, {{"radius", 12}}, {}, {}},
           {"part.extrude", EntityKind::Sketch, {"sketch_3"}, {{"distance", 20}}, {}, {}},
           {"part.boolean_union", EntityKind::Body, {"body_2", "body_4"}, {}, {}, {}},
       },
       "%1 = RECT(50, 50)\n"
       "%2 = EXTRUDE(%1, 8)\n"
       "%3 = CIRCLE(12)\n"
       "%4 = EXTRUDE(%3, 20)\n"
       "%5 = FUSE(%2, %4)\n"},

      // -- 8. the rest of the primitive palette, intersected ------------------
      {"prism_meets_tube",
       "PRISM / TUBE / SPHERE -- three more of the ten primitives D-038 added",
       {},
       {
           {"part.primitive_prism", EntityKind::None, {},
            {{"sides", 6}, {"radius", 15}, {"height", 20}}, {}, {}},
           {"part.primitive_tube", EntityKind::None, {},
            {{"outer_radius", 12}, {"inner_radius", 8}, {"height", 30}}, {}, {}},
           {"part.boolean_union", EntityKind::Body, {"body_1", "body_2"}, {}, {}, {}},
           {"part.primitive_sphere", EntityKind::None, {}, {{"radius", 10}}, {}, {}},
           {"part.boolean_intersect", EntityKind::Body, {"body_1", "body_4"}, {}, {}, {}},
       },
       "%1 = PRISM(6, 15, 20)\n"
       "%2 = TUBE(12, 8, 30)\n"
       "%3 = FUSE(%1, %2)\n"
       "%4 = SPHERE(10)\n"
       "%5 = COMMON(%3, %4)\n"},
  };
  return corpus;
}

// -- the headless arm's text, with a mutation optionally applied --------------
// Splitting on '\n' and re-joining is deliberate: a mutation that changes the
// number of statements must change what forge::ft's s0.4 census reports, and a
// mutation that changes a number must not change anything else.
inline std::vector<std::string> irLinesOf(const std::string& program) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : program) {
    if (c == '\n') {
      if (!cur.empty()) out.push_back(cur);
      cur.clear();
    } else {
      cur.push_back(c);
    }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

inline std::string joinIr(const std::vector<std::string>& lines) {
  std::string out;
  for (const std::string& l : lines) {
    out += l;
    out += '\n';
  }
  return out;
}

inline std::string headlessProgram(const Tree& t, Mutation m) {
  std::vector<std::string> lines = irLinesOf(t.headlessIr);
  if (lines.empty()) return t.headlessIr;
  switch (m) {
    case Mutation::HeadlessDropsAStatement:
      lines.pop_back();
      break;
    case Mutation::HeadlessPerturbsNumber: {
      // Move the first digit of the first statement. A planner that emits 90
      // where the app emitted 80 is the whole point of this gate.
      std::string& first = lines.front();
      for (std::size_t i = 0; i < first.size(); ++i) {
        if (first[i] >= '1' && first[i] <= '8') {
          first[i] = static_cast<char>(first[i] + 1);
          break;
        }
      }
      break;
    }
    case Mutation::HeadlessReordersOps:
      if (lines.size() >= 2) std::swap(lines[lines.size() - 1], lines[lines.size() - 2]);
      break;
    default:
      break;
  }
  return joinIr(lines);
}

// -- drive the REAL registry, exactly as the application does -----------------
inline forge::ui::EntityRef makeRef(const std::string& node, forge::ui::EntityKind kind) {
  forge::ui::EntityRef r;
  r.bodyId = node;
  r.kind = kind;
  r.persistentName = node;
  r.generation = 1;
  return r;
}

inline AppRun runInApp(const Tree& t, Mutation m = Mutation::None) {
  using forge::ui::CommandParams;
  using forge::ui::CommandRegistry;
  using forge::ui::DispatchResult;
  using forge::ui::EntityRef;
  using forge::ui::PartDocument;
  using forge::ui::SelectionService;
  using forge::ui::UndoStack;

  AppRun run;
  PartDocument doc;
  UndoStack undo;
  CommandRegistry registry;
  SelectionService sel;
  if (registerPartCommands(registry, doc, undo) == 0) {
    run.failure = "registerPartCommands added nothing";
    return run;
  }

  for (const Seed& s : t.seeds) {
    const int id = doc.seed(s.kind, s.node, s.op, s.args);
    if (id == 0) {
      run.failure = "seed refused: " + s.op;
      return run;
    }
    run.priorValues.push_back(s.kind);
  }

  std::size_t stepCount = t.steps.size();
  if (m == Mutation::AppDropsLastStep && stepCount > 0) --stepCount;

  for (std::size_t i = 0; i < stepCount; ++i) {
    Step step = t.steps[i];

    if (m == Mutation::AppSwapsBooleanOrder && step.selectionNodes.size() == 2) {
      std::swap(step.selectionNodes[0], step.selectionNodes[1]);
    }
    if (m == Mutation::AppPerturbsOneNumber && !step.numbers.empty()) {
      step.numbers.front().second += 0.5;
    }

    std::vector<EntityRef> refs;
    refs.reserve(step.selectionNodes.size());
    for (const std::string& n : step.selectionNodes) refs.push_back(makeRef(n, step.selectionKind));
    sel.replaceWith(refs);

    CommandParams params;
    for (const auto& kv : step.numbers) params.setNumber(kv.first, kv.second);
    for (const auto& kv : step.texts) params.setText(kv.first, kv.second);
    for (const std::string& f : step.flags) params.setFlag(f, true);

    const std::size_t before = doc.records().size();
    const DispatchResult r = registry.dispatch(step.command, sel, params);
    if (!r.ok()) {
      run.failure = t.id + " step " + std::to_string(i + 1) + " (" + step.command +
                    ") did not dispatch: status=" + std::to_string(static_cast<int>(r.status)) +
                    " " + r.detail;
      return run;
    }
    if (doc.records().size() != before + 1) {
      run.failure = t.id + " step " + std::to_string(i + 1) + " (" + step.command +
                    ") dispatched but emitted no statement";
      return run;
    }
    ++run.dispatched;
    run.commandLines.push_back(doc.records().back().line);
    run.selectionKinds.push_back(step.selectionKind);
    run.selectionCounts.push_back(step.selectionNodes.size());
  }

  run.ok = true;
  run.ir = doc.irProgram();
  return run;
}

// -- what the app path proposes, in the form the bridge rules on --------------
inline std::vector<forge::ui::ProposedOp> proposalOf(const AppRun& run,
                                                     Mutation m = Mutation::None) {
  std::vector<forge::ui::ProposedOp> plan;
  plan.reserve(run.commandLines.size());
  for (std::size_t i = 0; i < run.commandLines.size(); ++i) {
    forge::ui::ProposedOp p;
    p.line = run.commandLines[i];
    p.selection = run.selectionKinds[i];
    p.selectionCount = run.selectionCounts[i];
    plan.push_back(p);
  }
  if (m == Mutation::AppSkipsBridgeCheck && !plan.empty()) {
    // Hand the bridge an op the KERNEL builds and NO command emits. If the gate
    // does not go red here, its bridge arm is not connected to anything.
    plan.front().line.op = "SWEEP";
  }
  return plan;
}

}  // namespace difftest
}  // namespace forge

#endif  // FORGE_UI_TEST_DIFFERENTIAL_CORPUS_HPP
