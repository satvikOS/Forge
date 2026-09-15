// forge-desktop/test/parameters_gate.cpp
//
// THE PARAMETERS LAYER, END TO END, THROUGH THE ONE REGISTRY.
//
// Every edit below is a command dispatched through forge::ui::ForgeShell -- the
// path a menu, a keystroke, the Parameters panel and Archie all take -- against a
// part document built by the real Part commands, evaluated by the REAL expression
// library (libforge_expr, loaded as a shared library through
// forge::desktop::ExpressionHost). Nothing is stubbed: a fake engine would prove
// the adapter agrees with itself.
//
// The three acceptance behaviours are the first three sections:
//   A. change ONE parameter and THREE dependent features update, in one undo step
//   B. a unit mismatch (mm + kg) is REFUSED, and the part is byte-identical after
//   C. a cycle a -> b -> a is REFUSED, and the refusal NAMES both
// followed by what makes those trustworthy:
//   D. a formula whose dimension is wrong for the number it drives is refused
//   E. Archie: a plan of parameter commands passes the CoPilot's validator and
//      applies through applyPlan(), and a plan step the schema does not allow is
//      refused before it runs
//   F. a build with no expression library DISABLES the commands, never runs them
//   G. references to other features' numbers, removal refused while used,
//      unbind, and undo/redo of every step
//
// run_parameters_gate.sh builds libforge_expr from third_party/freecad-derived,
// links this test against it DYNAMICALLY and asserts that on the binary too.
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

#include "ExpressionHost.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ExpressionEngine.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/ParameterSet.hpp"
#include "forge/ui/Parameters.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

using namespace forge::ui;

// ── the check harness ───────────────────────────────────────────────────────
// ui/test/ui_test_util.hpp's contract, local to this file: forge-desktop's syntax
// gate type-checks every forge-desktop/test translation unit with forge-desktop's
// include path, and this gate should not be the one that needs ui/test on it.
namespace {

struct Harness {
  const char* name;
  std::size_t checks = 0;
  std::size_t failures = 0;
  explicit Harness(const char* n) : name(n) {}
  int finish() const {
    std::printf("[%s] %zu checks, %zu failures — %s\n", name, checks, failures,
                failures == 0 ? "PASS" : "FAIL");
    return failures == 0 ? 0 : 1;
  }
};

void checkTrue(Harness& h, bool value, const char* expr, const char* file, int line) {
  ++h.checks;
  if (value) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  expected true: %s\n", file, line, expr);
}

void checkEqInt(Harness& h, long long got, long long want, const char* expr, const char* file,
                int line) {
  ++h.checks;
  if (got == want) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %lld, want %lld\n", file, line, expr, got, want);
}

void checkEqStr(Harness& h, const std::string& got, const std::string& want, const char* expr,
                const char* file, int line) {
  ++h.checks;
  if (got == want) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got \"%s\", want \"%s\"\n", file, line, expr, got.c_str(),
              want.c_str());
}

void checkNear(Harness& h, double got, double want, double tol, const char* expr, const char* file,
               int line) {
  ++h.checks;
  if (std::fabs(got - want) <= tol) return;
  ++h.failures;
  std::printf("  FAIL %s:%d  %s\n        got %.9g, want %.9g (tol %.3g)\n", file, line, expr, got,
              want, tol);
}

}  // namespace

#define CHECK(expr) checkTrue(H, (expr), #expr, __FILE__, __LINE__)
#define CHECK_EQ_INT(got, want) \
  checkEqInt(H, static_cast<long long>(got), static_cast<long long>(want), #got " == " #want, \
             __FILE__, __LINE__)
#define CHECK_EQ_STR(got, want) checkEqStr(H, (got), (want), #got " == " #want, __FILE__, __LINE__)
#define CHECK_NEAR(got, want, tol) \
  checkNear(H, (got), (want), (tol), #got " ~= " #want, __FILE__, __LINE__)

namespace {

CommandParams texts(std::initializer_list<std::pair<const char*, const char*>> kv) {
  CommandParams p;
  for (const auto& [k, v] : kv) p.setText(k, v);
  return p;
}

CommandParams bindParams(int feature, const char* argument, const char* expression) {
  CommandParams p;
  p.setNumber("feature", feature);
  p.setText("argument", argument);
  p.setText("expression", expression);
  return p;
}

double argNumber(const PartDocument& doc, int irId, std::size_t slot) {
  const FeatureRecord* rec = doc.featureAt(irId);
  if (rec == nullptr || slot >= rec->line.args.size()) return std::nan("");
  return rec->line.args[slot].kind == IrArgKind::Number ? rec->line.args[slot].number : std::nan("");
}

bool contains(const std::string& haystack, const std::string& needle) {
  return haystack.find(needle) != std::string::npos;
}

// Everything that identifies the document's state: the program AND the parameter
// records. A refusal must leave both exactly as they were.
std::string fingerprint(const PartDocument& doc) {
  std::string out = doc.irProgram();
  for (const ParameterDef& p : doc.parameters().parameters()) {
    out += "\nP " + p.name + " = " + p.expression + " # " + p.comment;
  }
  for (const DimensionBinding& b : doc.parameters().bindings()) {
    out += "\nB " + std::to_string(b.irId) + "." + b.argument + "@" + std::to_string(b.slot) +
           " = " + b.expression;
  }
  return out;
}

}  // namespace

int main() {
  Harness H("parameters_gate");

  forge::desktop::ExpressionHost host;
  std::printf("[parameters_gate] engine: %s\n", host.identity().c_str());
  CHECK(contains(host.identity(), "libforge_expr"));
  CHECK(contains(host.identity(), "LGPL-2.1-or-later"));

  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  CHECK(registerPartCommands(shell.registry(), doc, undo) > 0);
  const std::size_t added =
      registerParameterCommands(shell.registry(), doc, undo, [&host]() -> const ExpressionEngine* {
        return &host;
      });
  CHECK_EQ_INT(added, 4);
  for (const std::string& id : parameterCommandIds()) {
    const CommandDescriptor* c = shell.registry().find(id);
    CHECK(c != nullptr);
    if (c == nullptr) continue;
    CHECK_EQ_STR(c->category, "Part");
    CHECK(c->featureIrOp.empty());  // they rewrite numbers; they emit no statement
    CHECK(c->undo == UndoContract::Transaction);
  }

  // ── build a real part through the registry ────────────────────────────────
  //   %1 = BOX(60, 40, 20)
  //   %2 = SHELL(%1, 2)          the wall
  //   %3 = HOLE(%2, 6, 0, 0, 20) a hole through the top
  //   %4 = FILLET(%3, 1, ALL)    the edges
  {
    CommandParams box;
    box.setNumber("dx", 60);
    box.setNumber("dy", 40);
    box.setNumber("dz", 20);
    CHECK(shell.run("part.primitive_box", box).ok());
    shell.selection().replaceWith({EntityRef{doc.nodeFor(1), EntityKind::Face, "top", 1}});
    CommandParams sh;
    sh.setNumber("thickness", 2);
    CHECK(shell.run("part.shell", sh).ok());
    shell.selection().replaceWith({EntityRef{doc.nodeFor(2), EntityKind::Face, "top", 1}});
    CommandParams hole;
    hole.setNumber("diameter", 6);
    hole.setNumber("x", 0);
    hole.setNumber("y", 0);
    hole.setNumber("z", 20);
    CHECK(shell.run("part.hole", hole).ok());
    shell.selection().replaceWith({EntityRef{doc.nodeFor(3), EntityKind::Edge, "e1", 1}});
    CommandParams fillet;
    fillet.setNumber("radius", 1);
    CHECK(shell.run("part.fillet", fillet).ok());
    shell.selection().clearSelection();
  }
  CHECK_EQ_INT(doc.records().size(), 4);
  CHECK_EQ_STR(doc.irProgram(), "%1 = BOX(60, 40, 20)\n%2 = SHELL(%1, 2)\n"
                                "%3 = HOLE(%2, 6, 0, 0, 20)\n%4 = FILLET(%3, 1, ALL)\n");
  const std::size_t modelSteps = undo.undoDepth();

  // ── A. ONE PARAMETER, THREE FEATURES ──────────────────────────────────────
  {
    DispatchResult r = shell.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "3 mm"}}));
    CHECK(r.ok());
    r = shell.run("part.parameter_bind", bindParams(2, "wall", "wall"));
    CHECK(r.ok());
    if (!r.ok()) std::printf("  bind shell: %s\n", r.detail.c_str());
    r = shell.run("part.parameter_bind", bindParams(3, "dia", "wall * 0.5 + 2 mm"));
    CHECK(r.ok());
    if (!r.ok()) std::printf("  bind hole: %s\n", r.detail.c_str());
    r = shell.run("part.parameter_bind", bindParams(4, "radius", "wall / 2"));
    CHECK(r.ok());
    if (!r.ok()) std::printf("  bind fillet: %s\n", r.detail.c_str());

    // The bindings wrote the formulas' values into the statements themselves.
    CHECK_EQ_STR(doc.irProgram(), "%1 = BOX(60, 40, 20)\n%2 = SHELL(%1, 3)\n"
                                  "%3 = HOLE(%2, 3.5, 0, 0, 20)\n%4 = FILLET(%3, 1.5, ALL)\n");
    CHECK_EQ_INT(undo.undoDepth(), modelSteps + 4);

    // THE ACCEPTANCE STEP: one command.
    const std::size_t before = undo.undoDepth();
    r = shell.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "4 mm"}}));
    CHECK(r.ok());
    CHECK_NEAR(argNumber(doc, 2, 1), 4.0, 1e-12);  // SHELL wall   = wall
    CHECK_NEAR(argNumber(doc, 3, 1), 4.0, 1e-12);  // HOLE dia     = wall * 0.5 + 2 mm
    CHECK_NEAR(argNumber(doc, 4, 1), 2.0, 1e-12);  // FILLET radius = wall / 2
    CHECK_NEAR(argNumber(doc, 1, 0), 60.0, 1e-12); // BOX untouched: nothing drives it
    CHECK_EQ_STR(doc.irProgram(), "%1 = BOX(60, 40, 20)\n%2 = SHELL(%1, 4)\n"
                                  "%3 = HOLE(%2, 4, 0, 0, 20)\n%4 = FILLET(%3, 2, ALL)\n");
    CHECK_EQ_INT(undo.undoDepth(), before + 1);  // ONE undo step for all three
    CHECK_EQ_STR(undo.undoLabel(), "Set wall");

    // Units convert, they do not merely pass through: 0.25 in is 6.35 mm.
    r = shell.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "0.25 in"}}));
    CHECK(r.ok());
    CHECK_NEAR(argNumber(doc, 2, 1), 6.35, 1e-9);
    CHECK_NEAR(argNumber(doc, 3, 1), 5.175, 1e-9);
    CHECK_NEAR(argNumber(doc, 4, 1), 3.175, 1e-9);

    // Undo puts all three back together, and redo replays all three.
    CHECK(undo.undo(doc));
    CHECK_EQ_STR(doc.irProgram(), "%1 = BOX(60, 40, 20)\n%2 = SHELL(%1, 4)\n"
                                  "%3 = HOLE(%2, 4, 0, 0, 20)\n%4 = FILLET(%3, 2, ALL)\n");
    CHECK_EQ_STR(doc.parameters().find("wall") != nullptr ? doc.parameters().find("wall")->expression
                                                         : std::string("<none>"),
                 "4 mm");
    CHECK(undo.redo(doc));
    CHECK_NEAR(argNumber(doc, 3, 1), 5.175, 1e-9);
    CHECK(undo.undo(doc));  // back to wall = 4 mm for the sections below
  }

  // ── B. mm + kg IS REFUSED ─────────────────────────────────────────────────
  {
    const std::string was = fingerprint(doc);
    const std::size_t depth = undo.undoDepth();
    DispatchResult r =
        shell.run("part.parameter_set", texts({{"name", "bad"}, {"expression", "3 mm + 2 kg"}}));
    CHECK(!r.ok());
    CHECK(r.status == DispatchStatus::EditRefused);
    CHECK(contains(r.detail, "Unit mismatch"));
    std::printf("  refusal (mm + kg): %s\n", r.detail.c_str());
    CHECK_EQ_STR(fingerprint(doc), was);
    CHECK_EQ_INT(undo.undoDepth(), depth);
    CHECK(doc.parameters().find("bad") == nullptr);

    // ... and a mismatch reached THROUGH names, into a parameter that already drives
    // three features, is refused without touching any of them.
    r = shell.run("part.parameter_set", texts({{"name", "mass"}, {"expression", "2 kg"}}));
    CHECK(r.ok());
    const std::string withMass = fingerprint(doc);
    r = shell.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "3 mm + mass"}}));
    CHECK(!r.ok());
    CHECK(contains(r.detail, "Unit mismatch"));
    CHECK_EQ_STR(fingerprint(doc), withMass);
    CHECK_NEAR(argNumber(doc, 2, 1), 4.0, 1e-12);
  }

  // ── C. a -> b -> a IS REFUSED, NAMING BOTH ────────────────────────────────
  {
    CHECK(shell.run("part.parameter_set", texts({{"name", "a"}, {"expression", "1 mm"}})).ok());
    CHECK(shell.run("part.parameter_set", texts({{"name", "b"}, {"expression", "a * 2"}})).ok());
    const std::string was = fingerprint(doc);
    const std::size_t depth = undo.undoDepth();
    DispatchResult r =
        shell.run("part.parameter_set", texts({{"name", "a"}, {"expression", "b + 1 mm"}}));
    CHECK(!r.ok());
    CHECK(r.status == DispatchStatus::EditRefused);
    CHECK(contains(r.detail, "a -> b -> a"));
    std::printf("  refusal (cycle): %s\n", r.detail.c_str());
    CHECK_EQ_STR(fingerprint(doc), was);
    CHECK_EQ_INT(undo.undoDepth(), depth);
    CHECK_EQ_STR(doc.parameters().find("a")->expression, "1 mm");

    // The recompute API names the members as data, not only in a sentence.
    ParameterSet candidate = doc.parameters();
    candidate.upsertParameter(ParameterDef{"a", "b + 1 mm", ""});
    const RecomputeResult rc = recomputeParameters(doc, candidate, host);
    CHECK(!rc.ok);
    CHECK(rc.problem == ParameterProblem::Cycle);
    CHECK_EQ_INT(rc.cycle.size(), 3);
    if (rc.cycle.size() == 3) {
      CHECK_EQ_STR(rc.cycle[0], "a");
      CHECK_EQ_STR(rc.cycle[1], "b");
      CHECK_EQ_STR(rc.cycle[2], "a");
    }
    CHECK(rc.updates.empty());

    // A self-reference is a cycle of one, and a longer one names every member.
    r = shell.run("part.parameter_set", texts({{"name", "b"}, {"expression", "b"}}));
    CHECK(!r.ok() && contains(r.detail, "b -> b"));
    CHECK(shell.run("part.parameter_set", texts({{"name", "c"}, {"expression", "b"}})).ok());
    r = shell.run("part.parameter_set", texts({{"name", "a"}, {"expression", "c"}}));
    CHECK(!r.ok() && contains(r.detail, "a -> c -> b -> a"));
    std::printf("  refusal (3-cycle): %s\n", r.detail.c_str());
  }

  // ── D. THE WRONG DIMENSION FOR THE NUMBER ─────────────────────────────────
  {
    const std::string was = fingerprint(doc);
    DispatchResult r = shell.run("part.parameter_bind", bindParams(3, "dia", "mass"));
    CHECK(!r.ok());
    CHECK(contains(r.detail, "length"));
    CHECK(contains(r.detail, "mass"));
    std::printf("  refusal (dimension): %s\n", r.detail.c_str());
    r = shell.run("part.parameter_bind", bindParams(3, "dia", "5"));
    CHECK(!r.ok() && contains(r.detail, "mm"));  // says how to write it
    r = shell.run("part.parameter_bind", bindParams(3, "diameter", "5 mm"));
    CHECK(!r.ok() && contains(r.detail, "dia"));  // names the numbers HOLE does have
    r = shell.run("part.parameter_bind", bindParams(9, "dia", "5 mm"));
    CHECK(!r.ok() && contains(r.detail, "no feature 9"));
    r = shell.run("part.parameter_bind", bindParams(3, "depth", "5 mm"));
    CHECK(!r.ok() && contains(r.detail, "without"));  // HOLE 3 was made with no depth
    r = shell.run("part.parameter_set", texts({{"name", "mm"}, {"expression", "5 mm"}}));
    CHECK(!r.ok());  // a unit's spelling is not a name
    r = shell.run("part.parameter_set", texts({{"name", "gap"}, {"expression", "nowhere * 2"}}));
    CHECK(!r.ok() && contains(r.detail, "nowhere"));
    r = shell.run("part.parameter_set", texts({{"name", "gap"}, {"expression", "4 mm / 0"}}));
    CHECK(!r.ok() && contains(r.detail, "zero"));
    CHECK_EQ_STR(fingerprint(doc), was);
  }

  // ── E. ARCHIE DRIVES IT THROUGH THE COPILOT'S OWN PATH ────────────────────
  {
    const OpConstraintBridge bridge;
    Plan plan;
    plan.intent = "make the box length ten walls and the hole a third of that";
    PlanStep p1;
    p1.commandId = "part.parameter_set";
    p1.args = {PlanArg::str("name", "length"), PlanArg::str("expression", "wall * 10")};
    p1.select = PlanSelect::None;
    PlanStep p2;
    p2.commandId = "part.parameter_bind";
    p2.args = {PlanArg::num("feature", 1), PlanArg::str("argument", "dx"),
               PlanArg::str("expression", "length")};
    p2.select = PlanSelect::None;
    PlanStep p3;
    p3.commandId = "part.parameter_bind";
    p3.args = {PlanArg::num("feature", 3), PlanArg::str("argument", "dia"),
               PlanArg::str("expression", "Box1.dx / 3")};
    p3.select = PlanSelect::None;
    plan.steps = {p1, p2, p3};

    const PlanVerdict verdict = validatePlan(plan, shell.registry(), bridge);
    CHECK(verdict.accepted());
    if (!verdict.accepted()) std::printf("  plan refused: %s\n", verdict.report().c_str());
    const ApplyOutcome out = applyPlan(plan, shell, doc, bridge);
    CHECK(out.allOk());
    if (!out.allOk()) std::printf("  apply: %s\n", out.summary().c_str());
    CHECK_NEAR(argNumber(doc, 1, 0), 40.0, 1e-12);          // BOX dx = 10 * 4 mm
    CHECK_NEAR(argNumber(doc, 3, 1), 40.0 / 3.0, 1e-9);     // HOLE dia = Box1.dx / 3

    // One parameter now moves FOUR numbers, two of them through another feature.
    CHECK(shell.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "5 mm"}})).ok());
    CHECK_NEAR(argNumber(doc, 1, 0), 50.0, 1e-12);
    CHECK_NEAR(argNumber(doc, 2, 1), 5.0, 1e-12);
    CHECK_NEAR(argNumber(doc, 3, 1), 50.0 / 3.0, 1e-9);
    CHECK_NEAR(argNumber(doc, 4, 1), 2.5, 1e-12);

    // A plan that invents a parameter the command does not declare never runs.
    Plan bad;
    PlanStep b1;
    b1.commandId = "part.parameter_set";
    b1.args = {PlanArg::str("name", "x"), PlanArg::str("expression", "1 mm"),
               PlanArg::str("unit", "mm")};
    bad.steps = {b1};
    CHECK(!validatePlan(bad, shell.registry(), bridge).accepted());
    // And a plan whose formula is wrong runs, is REFUSED by the command, and says why.
    Plan wrong;
    PlanStep w1;
    w1.commandId = "part.parameter_set";
    w1.args = {PlanArg::str("name", "wall"), PlanArg::str("expression", "5 kg")};
    wrong.steps = {w1};
    const ApplyOutcome wo = applyPlan(wrong, shell, doc, bridge);
    CHECK(!wo.allOk());
    CHECK(wo.steps.size() == 1 && !wo.steps[0].ok() && contains(wo.steps[0].dispatch.detail, "mass"));
    CHECK_NEAR(argNumber(doc, 2, 1), 5.0, 1e-12);
  }

  // ── F. NO LIBRARY, NO PARAMETERS -- DISABLED, NOT WRONG ───────────────────
  {
    ForgeShell bare;
    PartDocument bareDoc;
    UndoStack bareUndo;
    registerPartCommands(bare.registry(), bareDoc, bareUndo);
    CHECK_EQ_INT(registerParameterCommands(bare.registry(), bareDoc, bareUndo,
                                           []() -> const ExpressionEngine* { return nullptr; }),
                 4);
    const DispatchResult r =
        bare.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "3 mm"}}));
    CHECK(r.status == DispatchStatus::Disabled);
    CHECK(bareDoc.parameters().empty());
  }

  // ── G. REFERENCES, REMOVAL, UNBIND, UNDO OF EVERYTHING ────────────────────
  {
    // Removing a parameter something uses is refused, naming every user.
    DispatchResult r = shell.run("part.parameter_remove", texts({{"name", "wall"}}));
    CHECK(!r.ok());
    CHECK(contains(r.detail, "length") && contains(r.detail, "Shell Body 2") &&
          contains(r.detail, "Edge Fillet 4"));
    std::printf("  refusal (still used): %s\n", r.detail.c_str());

    // Unbinding keeps the number and drops only the link.
    r = shell.run("part.parameter_unbind", bindParams(4, "radius", ""));
    CHECK(r.ok());
    CHECK_NEAR(argNumber(doc, 4, 1), 2.5, 1e-12);
    CHECK(shell.run("part.parameter_set", texts({{"name", "wall"}, {"expression", "6 mm"}})).ok());
    CHECK_NEAR(argNumber(doc, 4, 1), 2.5, 1e-12);  // no longer driven
    CHECK_NEAR(argNumber(doc, 2, 1), 6.0, 1e-12);  // still driven
    r = shell.run("part.parameter_unbind", bindParams(4, "radius", ""));
    CHECK(!r.ok() && contains(r.detail, "not driven"));

    // An unused parameter can go.
    CHECK(shell.run("part.parameter_remove", texts({{"name", "mass"}})).ok());
    CHECK(doc.parameters().find("mass") == nullptr);

    // The recompute view the panel draws agrees with the document.
    const RecomputeResult view = recomputeParameters(doc, doc.parameters(), host);
    CHECK(view.ok);
    CHECK(view.updates.empty());  // nothing is stale
    bool sawHole = false;
    for (const BoundSlotValue& b : view.bindings) {
      if (b.binding.irId == 3) {
        sawHole = true;
        CHECK_EQ_STR(b.reference, "Hole3.dia");
        CHECK_EQ_STR(b.feature, "Hole 3");
        CHECK(b.unit == SlotUnit::Length);
        CHECK_NEAR(b.current, 20.0, 1e-9);
        CHECK_EQ_STR(host.describe(b.quantity), "20 mm");
      }
    }
    CHECK(sawHole);

    // Undo EVERY parameter step and the part is exactly what the modelling
    // commands made -- the parameters layer left nothing behind.
    while (undo.undoDepth() > modelSteps) CHECK(undo.undo(doc));
    CHECK_EQ_STR(doc.irProgram(), "%1 = BOX(60, 40, 20)\n%2 = SHELL(%1, 2)\n"
                                  "%3 = HOLE(%2, 6, 0, 0, 20)\n%4 = FILLET(%3, 1, ALL)\n");
    CHECK(doc.parameters().empty());
  }

  return H.finish();
}
