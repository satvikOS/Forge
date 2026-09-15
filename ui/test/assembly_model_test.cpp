// ui/test/assembly_model_test.cpp
//
// THE ASSEMBLY MODEL, WITHOUT A SOLVER.
//
// What this proves is the half of an assembly edit that is Forge's own and
// runs headless: the typed statements, the transaction, undo, the bill of
// materials, the Assembly tab's text -- and, the part that matters most, that
// Forge's OWN MEASUREMENT refuses a wrong answer. A scripted solver below lies
// in three different ways and every lie must be refused by name; a solver that
// is trusted is a solver whose bugs ship.
//
// The real solver (libforge_asmsolver) is exercised end to end by
// forge-desktop/test/assembly_solver_gate.cpp, which links it.
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/AssemblyCommands.hpp"
#include "forge/ui/AssemblyModel.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
namespace asmb = forge::ui::assembly;

namespace {

constexpr double kPi = 3.14159265358979323846;

class ScriptedSolver final : public asmb::AssemblySolver {
 public:
  std::function<asmb::SolveOutcome(const asmb::Assembly&, const std::vector<asmb::Drive>&)> answer;
  std::size_t calls = 0;
  asmb::SolveOutcome solve(const asmb::Assembly& a, const std::vector<asmb::Drive>& d) override {
    ++calls;
    return answer(a, d);
  }
  std::string engineName() const override { return "scripted"; }
};

std::vector<asmb::Placement> placementsOf(const asmb::Assembly& a) {
  std::vector<asmb::Placement> out;
  for (const asmb::Component& c : a.components) out.push_back(c.placement);
  return out;
}

struct Bench {
  CommandRegistry registry;
  SelectionService selection;
  PartDocument doc;
  UndoStack undo;
  AssemblySolverSlot slot;

  Bench() {
    registerPartCommands(registry, doc, undo);
    registerAssemblyCommands(registry, doc, undo, slot);
  }

  DispatchResult run(const std::string& id, const CommandParams& p = {}) {
    return registry.dispatch(id, selection, p);
  }

  // A 100 x 20 x 5 plate: BOX centres it in XY and puts its base on z = 0.
  int plate() {
    CommandParams p;
    p.setNumber("dx", 100.0);
    p.setNumber("dy", 20.0);
    p.setNumber("dz", 5.0);
    selection.clearSelection();
    const DispatchResult r = run("part.primitive_box", p);
    return r.ok() ? doc.records().back().irId : 0;
  }

  void pick(int irId) {
    EntityRef ref;
    ref.bodyId = doc.nodeFor(irId);
    ref.kind = EntityKind::Body;
    ref.persistentName = "feature@" + std::to_string(irId);
    selection.clearSelection();
    selection.replaceWith({ref});
  }

  DispatchResult insert(int body, const std::string& name, double x, double y, double z) {
    pick(body);
    CommandParams p;
    p.setText("name", name);
    p.setNumber("x", x);
    p.setNumber("y", y);
    p.setNumber("z", z);
    const DispatchResult r = run("assembly.insert_component", p);
    selection.clearSelection();
    return r;
  }

  DispatchResult ground(const std::string& name, bool on = true) {
    CommandParams p;
    p.setText("component", name);
    p.setFlag("grounded", on);
    return run("assembly.ground", p);
  }

  DispatchResult joint(const std::string& kind, const std::string& name, const std::string& a,
                       const std::string& b, double x, double y, double z) {
    CommandParams p;
    p.setText("kind", kind);
    p.setText("name", name);
    p.setText("first", a);
    p.setText("second", b);
    p.setNumber("x", x);
    p.setNumber("y", y);
    p.setNumber("z", z);
    return run("assembly.add_joint", p);
  }
};

}  // namespace

int main() {
  forge::uitest::Harness H("assembly_model_test");

  // ── 1. placements ──────────────────────────────────────────────────────────
  {
    const asmb::Placement p = asmb::Placement::fromAngles(1, 2, 3, 10, -20, 30);
    double rx = 0, ry = 0, rz = 0;
    p.angles(rx, ry, rz);
    CHECK_NEAR(rx, 10.0, 1e-9);
    CHECK_NEAR(ry, -20.0, 1e-9);
    CHECK_NEAR(rz, 30.0, 1e-9);
    CHECK(asmb::isProperRotation(p.r));
    const asmb::Placement id = p.then(p.inverse());
    for (int i = 0; i < 3; ++i) CHECK_NEAR(id.t[static_cast<std::size_t>(i)], 0.0, 1e-12);
    CHECK_NEAR(id.r[0], 1.0, 1e-12);
    CHECK_NEAR(id.r[4], 1.0, 1e-12);
    CHECK_NEAR(id.r[8], 1.0, 1e-12);
    // Rz(90): world x goes to world y.
    const asmb::Vec3 x = asmb::Placement::fromAngles(0, 0, 0, 0, 0, 90).direction({1, 0, 0});
    CHECK_NEAR(x[0], 0.0, 1e-12);
    CHECK_NEAR(x[1], 1.0, 1e-12);
    asmb::Placement f;
    CHECK(asmb::frameFromAxis({5, 6, 7}, {0, 0, 2}, f));
    CHECK(asmb::isProperRotation(f.r));
    CHECK_NEAR(f.axis(2)[2], 1.0, 1e-12);
    CHECK(!asmb::frameFromAxis({0, 0, 0}, {0, 0, 0}, f));
    asmb::Mat3 mirror{-1, 0, 0, 0, 1, 0, 0, 0, 1};
    CHECK(!asmb::isProperRotation(mirror));  // a reflection is not a placement
  }

  // ── 2. names ───────────────────────────────────────────────────────────────
  CHECK(asmb::isValidName("Base plate (2)"));
  CHECK(!asmb::isValidName(""));
  CHECK(!asmb::isValidName("   "));
  CHECK(!asmb::isValidName("say \"hi\""));
  CHECK(!asmb::isValidName("a\nb"));
  CHECK(!asmb::isValidName(std::string(65, 'x')));

  // ── 3. two plates, a hinge: 1 degree of freedom by RANK, no solver ────────
  {
    Bench b;
    const int plate = b.plate();
    CHECK(plate > 0);
    CHECK(b.insert(plate, "Base", 0, 0, 0).ok());
    CHECK(b.insert(plate, "Arm", 80, 0, 5).ok());
    CHECK_EQ_INT(b.doc.assembly().components.size(), 2);
    CHECK_EQ_INT(b.undo.undoDepth(), 3);  // the box and two inserts

    // Floating: 12 degrees before anything is grounded.
    CHECK_EQ_INT(asmb::countFreedom(b.doc.assembly()).degrees, 12);
    CHECK(asmb::countFreedom(b.doc.assembly()).floating);

    CHECK(b.ground("Base").ok());
    CHECK_EQ_INT(asmb::countFreedom(b.doc.assembly()).degrees, 6);

    // A joint stated at one world point holds as created, so with NO solver the
    // edit is still a correct assembly and is accepted.
    DispatchResult r = b.joint("REVOLUTE", "Hinge", "Base", "Arm", 40, 0, 5);
    CHECK(r.ok());
    if (!r.ok()) std::printf("  hinge refused: %s\n", r.detail.c_str());
    const asmb::Freedom f = asmb::countFreedom(b.doc.assembly());
    CHECK_EQ_INT(f.degrees, 1);
    CHECK_EQ_INT(f.equations, 11);  // 6 ground + 5 revolute
    CHECK_EQ_INT(f.redundantEquations(), 0);

    AssemblyTreeView view = buildAssemblyTreeView(b.doc);
    CHECK_EQ_STR(view.summary, std::string("1 degree of freedom"));
    CHECK(!view.trouble);
    CHECK_EQ_INT(view.components.size(), 2);
    CHECK_EQ_INT(view.joints.size(), 1);
    if (view.joints.size() == 1) {
      CHECK_EQ_STR(view.joints[0].label, std::string("Hinge"));
      CHECK_EQ_STR(view.joints[0].detail, std::string("revolute: Base to Arm"));
      CHECK_EQ_STR(view.joints[0].statement,
                   std::string("JOINT(REVOLUTE, \"Hinge\", \"Base\", \"Arm\", 40, 0, 5, 0, 0, 1)"));
    }
    if (view.components.size() == 2) {
      CHECK(view.components[0].grounded);
      CHECK_EQ_STR(view.components[0].detail, std::string("Box 1, grounded"));
      CHECK_EQ_STR(view.components[1].statement, std::string("COMPONENT(%1, \"Arm\", 80, 0, 5)"));
    }

    // Turning needs placements computed, and there is no solver: REFUSED, by
    // reason, with nothing changed and nothing pushed.
    const std::size_t depth = b.undo.undoDepth();
    const asmb::Assembly before = b.doc.assembly();
    CommandParams turn;
    turn.setText("joint", "Hinge");
    turn.setNumber("value", 30.0);
    r = b.run("assembly.move_joint", turn);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("no assembly solver") != std::string::npos);
    CHECK(b.doc.assembly() == before);
    CHECK_EQ_INT(b.undo.undoDepth(), depth);

    // ── 4. a second fixed joint: 0 degrees, and the LATER joint is redundant ──
    r = b.joint("FIXED", "Lock", "Base", "Arm", 80, 0, 5);
    CHECK(r.ok());
    const asmb::Freedom g = asmb::countFreedom(b.doc.assembly());
    CHECK_EQ_INT(g.degrees, 0);
    CHECK_EQ_INT(g.redundantEquations(), 5);
    bool lockRedundant = false;
    bool heldByHinge = false;
    for (const asmb::Freedom::Redundancy& red : g.redundancies) {
      const asmb::Joint* lock = b.doc.assembly().jointNamed("Lock");
      const asmb::Joint* hinge = b.doc.assembly().jointNamed("Hinge");
      if (lock != nullptr && red.jointId == lock->id) {
        lockRedundant = red.redundantEquations == 5;
        for (int h : red.heldBy) heldByHinge = heldByHinge || (hinge != nullptr && h == hinge->id);
      }
    }
    CHECK(lockRedundant);
    CHECK(heldByHinge);
    view = buildAssemblyTreeView(b.doc);
    CHECK_EQ_STR(view.summary, std::string("fully held: 0 degrees of freedom"));
    if (view.joints.size() == 2) {
      CHECK(view.joints[1].detail.find("adds nothing") != std::string::npos);
    }

    // ── 5. undo and redo walk the assembly back and forth exactly ────────────
    const asmb::Assembly withLock = b.doc.assembly();
    CHECK(b.undo.undo(b.doc));
    CHECK(b.doc.assembly().jointNamed("Lock") == nullptr);
    CHECK_EQ_INT(asmb::countFreedom(b.doc.assembly()).degrees, 1);
    CHECK(b.undo.redo(b.doc));
    CHECK(b.doc.assembly() == withLock);

    // A snapshot round-trips the assembly; an EMPTY snapshot empties it.
    PartDocument::Snapshot snap = b.doc.snapshot();
    b.doc.restore(snap);
    CHECK(b.doc.assembly() == withLock);
    PartDocument copy = b.doc;
    copy.restore(PartDocument::Snapshot{});
    CHECK(copy.assembly().empty());
    CHECK(copy.records().empty());

    // ── 6. removal refuses to orphan a joint, and names what holds it ────────
    CommandParams rm;
    rm.setText("name", "Arm");
    r = b.run("assembly.remove", rm);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("\"Hinge\"") != std::string::npos);
    CHECK(r.detail.find("\"Lock\"") != std::string::npos);
  }

  // ── 7. every joint kind's degrees of freedom, by rank ─────────────────────
  {
    const struct {
      const char* kind;
      int dof;
    } kinds[] = {{"FIXED", 0}, {"REVOLUTE", 1}, {"SLIDER", 1}, {"CYLINDRICAL", 2},
                 {"BALL", 3},  {"PLANAR", 3}};
    for (const auto& k : kinds) {
      Bench b;
      const int plate = b.plate();
      b.insert(plate, "A", 0, 0, 0);
      b.insert(plate, "B", 0, 30, 0);
      b.ground("A");
      const DispatchResult r = b.joint(k.kind, "J", "A", "B", 10, 15, 2);
      CHECK(r.ok());
      const int got = asmb::countFreedom(b.doc.assembly()).degrees;
      if (got != k.dof) std::printf("  %s gave %d degrees, want %d\n", k.kind, got, k.dof);
      CHECK_EQ_INT(got, k.dof);
    }
    // DISTANCE and ANGLE take a value and hold as created.
    for (const char* kind : {"DISTANCE", "ANGLE"}) {
      Bench b;
      const int plate = b.plate();
      b.insert(plate, "A", 0, 0, 0);
      b.insert(plate, "B", 0, 30, 0);
      b.ground("A");
      CommandParams p;
      p.setText("kind", kind);
      p.setText("name", "J");
      p.setText("first", "A");
      p.setText("second", "B");
      p.setNumber("x", 3);
      p.setNumber("y", 4);
      p.setNumber("z", 5);
      p.setNumber("value", 25.0);
      const DispatchResult r = b.run("assembly.add_joint", p);
      CHECK(r.ok());
      if (!r.ok()) std::printf("  %s refused: %s\n", kind, r.detail.c_str());
      const std::vector<asmb::JointMeasure> m = asmb::measureJoints(b.doc.assembly());
      CHECK(m.size() == 1 && m[0].holds);
      CHECK_EQ_INT(asmb::countFreedom(b.doc.assembly()).degrees, 5);
      // A zero distance is not a joint this can state.
      p.setText("name", "Zero");
      p.setNumber("value", 0.0);
      CHECK_EQ_INT(static_cast<int>(b.run("assembly.add_joint", p).status),
                   static_cast<int>(DispatchStatus::EditRefused));
    }
  }

  // ── 8. FORGE'S MEASUREMENT REFUSES A LYING SOLVER ─────────────────────────
  {
    Bench b;
    const int plate = b.plate();
    b.insert(plate, "Base", 0, 0, 0);
    b.insert(plate, "Arm", 0, 0, 0);  // on top of Base: the mate must move it
    b.ground("Base");
    ScriptedSolver liar;
    b.slot.solver = &liar;

    CommandParams mate;
    mate.setText("kind", "REVOLUTE");
    mate.setText("name", "Hinge");
    mate.setText("first", "Base");
    mate.setText("second", "Arm");
    mate.setNumber("first_x", 40);
    mate.setNumber("first_y", 0);
    mate.setNumber("first_z", 5);
    mate.setNumber("second_x", -40);
    mate.setNumber("second_y", 0);
    mate.setNumber("second_z", 0);

    // (a) claims solved, moves nothing: the hinge does not hold.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);
      o.degreesOfFreedom = 1;
      return o;
    };
    const asmb::Assembly before = b.doc.assembly();
    DispatchResult r = b.run("assembly.mate", mate);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("\"Hinge\"") != std::string::npos);
    CHECK(b.doc.assembly() == before);

    // (b) the right placement, but it moves the GROUNDED base along with it.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);
      o.placements[0].t[0] -= 80.0;  // Base shoved so the frames meet
      o.degreesOfFreedom = 1;
      return o;
    };
    r = b.run("assembly.mate", mate);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("grounded") != std::string::npos);

    // (c) the right placement, the wrong count of degrees of freedom.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);
      o.placements[1].t = {80.0, 0.0, 5.0};
      o.degreesOfFreedom = 2;
      return o;
    };
    r = b.run("assembly.mate", mate);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("disagree") != std::string::npos);

    // (d) the axis on the wrong BRANCH: Arm flipped over, which satisfies every
    // direction-cosine equation of a hinge and is not the hinge that was asked.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);
      // Turned half a turn about x through its hinge point (-40, 0, 0)... placed so
      // that point lands on (40, 0, 5): origin at (80, 0, 5), y and z reversed.
      o.placements[1].t = {80.0, 0.0, 5.0};
      o.placements[1].r = {1, 0, 0, 0, -1, 0, 0, 0, -1};
      o.degreesOfFreedom = 1;
      return o;
    };
    r = b.run("assembly.mate", mate);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));

    // (e) the honest answer is accepted: Arm at (80, 0, 5), 1 degree.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);
      o.placements[1].t = {80.0, 0.0, 5.0};
      o.degreesOfFreedom = 1;
      return o;
    };
    r = b.run("assembly.mate", mate);
    CHECK(r.ok());
    if (!r.ok()) std::printf("  honest mate refused: %s\n", r.detail.c_str());
    const asmb::Component* arm = b.doc.assembly().componentNamed("Arm");
    CHECK(arm != nullptr && std::abs(arm->placement.t[0] - 80.0) < 1e-12);
    CHECK_EQ_INT(liar.calls, 5);

    // (f) a drive that does not land where it was asked is refused.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);  // did not turn at all
      o.degreesOfFreedom = 1;
      return o;
    };
    CommandParams turn;
    turn.setText("joint", "Hinge");
    turn.setNumber("value", 30.0);
    r = b.run("assembly.move_joint", turn);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("could not be turned to 30 degrees") != std::string::npos);

    // (g) the honest turn: Arm rotated 30 degrees about the hinge at (40, 0, 5).
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.solved = true;
      o.placements = placementsOf(a);
      const double c = std::cos(kPi / 6), s = std::sin(kPi / 6);
      o.placements[1].r = {c, -s, 0, s, c, 0, 0, 0, 1};
      o.placements[1].t = {40.0 + 40.0 * c, 40.0 * s, 5.0};
      o.degreesOfFreedom = 1;
      return o;
    };
    r = b.run("assembly.move_joint", turn);
    CHECK(r.ok());
    const asmb::Joint* hinge = b.doc.assembly().jointNamed("Hinge");
    double turned = 0.0, slid = 0.0;
    CHECK(hinge != nullptr && asmb::jointCoordinates(b.doc.assembly(), *hinge, turned, slid));
    CHECK_NEAR(turned, 30.0, 1e-9);

    // (h) the engine's own refusal reaches the user, with the joints it named.
    liar.answer = [](const asmb::Assembly& a, const std::vector<asmb::Drive>&) {
      asmb::SolveOutcome o;
      o.reason = "these joints cannot all hold at once: \"Clamp\"";
      for (const asmb::Joint& j : a.joints) {
        if (j.name == "Clamp") o.conflictingJoints.push_back(j.id);
      }
      return o;
    };
    CommandParams clamp = mate;
    clamp.setText("kind", "FIXED");
    clamp.setText("name", "Clamp");
    clamp.setNumber("first_x", 30);
    r = b.run("assembly.mate", clamp);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("\"Clamp\"") != std::string::npos);
    // And the rank count names what Clamp collides with: the hinge, and the ground.
    CHECK(r.detail.find("\"Hinge\"") != std::string::npos);
    CHECK(r.detail.find("grounded \"Base\"") != std::string::npos);
    CHECK(b.doc.assembly().jointNamed("Clamp") == nullptr);
  }

  // ── 9. the bill of materials counts instances ─────────────────────────────
  {
    Bench b;
    const int plate = b.plate();
    CommandParams pin;
    pin.setNumber("radius", 3.0);
    pin.setNumber("height", 12.0);
    b.selection.clearSelection();
    CHECK(b.run("part.primitive_cylinder", pin).ok());
    const int rod = b.doc.records().back().irId;
    b.insert(plate, "Plate A", 0, 0, 0);
    b.insert(plate, "Plate B", 0, 0, 10);
    b.insert(plate, "Plate C", 0, 0, 20);
    b.insert(rod, "Pin", 0, 0, 0);
    const std::vector<asmb::BomRow> bom = asmb::billOfMaterials(b.doc.assembly(), b.doc);
    CHECK_EQ_INT(bom.size(), 2);
    if (bom.size() == 2) {
      CHECK_EQ_INT(bom[0].body, plate);
      CHECK_EQ_INT(bom[0].quantity, 3);
      CHECK_EQ_STR(bom[0].part, std::string("Box 1"));
      CHECK_EQ_STR(forge::uitest::at(bom[0].instances, 2), std::string("Plate C"));
      CHECK_EQ_INT(bom[1].quantity, 1);
      CHECK_EQ_STR(bom[1].part, std::string("Cylinder 2"));
    }
    // A default name follows the body, then counts.
    b.pick(plate);
    CHECK(b.run("assembly.insert_component").ok());
    b.pick(plate);
    CHECK(b.run("assembly.insert_component").ok());
    CHECK(b.doc.assembly().componentNamed("Box 1") != nullptr);
    CHECK(b.doc.assembly().componentNamed("Box 1 (2)") != nullptr);
    // A duplicate name is refused, and so is a quote in one.
    CHECK_EQ_INT(static_cast<int>(b.insert(plate, "Pin", 0, 0, 0).status),
                 static_cast<int>(DispatchStatus::EditRefused));
    CHECK_EQ_INT(static_cast<int>(b.insert(plate, "a \"b\"", 0, 0, 0).status),
                 static_cast<int>(DispatchStatus::EditRefused));
    // Inserting needs a SOLID picked: the signature refuses anything else.
    b.selection.clearSelection();
    CHECK_EQ_INT(static_cast<int>(b.run("assembly.insert_component").status),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  }

  // ── 10. validation names a component whose body has gone ──────────────────
  {
    Bench b;
    const int plate = b.plate();
    b.insert(plate, "A", 0, 0, 0);
    asmb::Assembly broken = b.doc.assembly();
    broken.components[0].body = 99;
    const asmb::AsmVerdict v = asmb::validate(broken, &b.doc);
    CHECK_EQ_INT(static_cast<int>(v.check), static_cast<int>(asmb::AsmCheck::NoSuchBody));
    CHECK(v.reason.find("\"A\"") != std::string::npos);
    CHECK(b.doc.setAssembly(broken));
    const AssemblyTreeView view = buildAssemblyTreeView(b.doc);
    CHECK(view.trouble);
    CHECK(view.components.size() == 1 && view.components[0].problem);
  }

  // ── 11. the typed IR table is the one the commands emit ───────────────────
  {
    const std::vector<std::string> ids = assemblyCommandIds();
    CHECK_EQ_INT(ids.size(), 6);
    Bench b;
    for (const std::string& id : ids) {
      const CommandDescriptor* c = b.registry.find(id);
      CHECK(c != nullptr);
      if (c == nullptr) continue;
      CHECK_EQ_STR(c->category, std::string("Assembly"));
      CHECK(asmb::findAssemblyOp(c->featureIrOp) != nullptr);
    }
    CHECK_EQ_INT(asmb::assemblyOpTable().size(), 6);
  }

  return H.finish();
}
