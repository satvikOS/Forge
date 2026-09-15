// forge-desktop/test/assembly_solver_gate.cpp
//
// THE ASSEMBLY ACCEPTANCE GATE, through the headless forge::ui path and the real
// solver.
//
// Every edit below is a command dispatched through ForgeShell -- the same
// registry a ribbon button, a macro and an Archie plan step reach -- and every
// solve goes through Forge's adapter (AssemblySolverHost) into the shipped
// dynamic library, libforge_asmsolver. Nothing is called behind the registry's
// back.
//
// ── what must hold ───────────────────────────────────────────────────────────
//   A. two plates joined by a revolute joint have 1 degree of freedom, and the
//      joint TURNS: the arm lands exactly where arithmetic written here puts it,
//      at 30, 170 and -90 degrees, and never on the mirror branch;
//   B. adding a second, fixed joint to the grounded plate leaves 0 degrees of
//      freedom, and the hinge then refuses to turn, by name;
//   C. an over-constrained set -- a clamp that disagrees with the hinge -- is
//      refused, naming the joints, and the document is unchanged;
//   D. the bill of materials lists instances with their quantities.
//
// Each count of degrees of freedom is taken TWICE, by two instruments that share
// no code: the solver's own equation count (through the adapter) and Forge's rank
// count (forge::ui::assembly::countFreedom). Both must give the expected number.
//
// ── proving it can fail ──────────────────────────────────────────────────────
// Built with -DFORGE_ASM_GATE_MUTATION=N the solver is wrapped in a decorator
// that breaks one thing; run_assembly_solver_gate.sh requires every such build
// to exit non-zero. 1: moves are dropped. 2: the degrees of freedom are
// over-reported by one. 3: every revolute joint is handed to the solver as a
// ball joint.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "AssemblySolverHost.hpp"
#include "PartFile.hpp"
#include "forge/ui/AssemblyCommands.hpp"
#include "forge/ui/AssemblyModel.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge_asmsolver/AsmSolver.h"

#ifndef FORGE_ASM_GATE_MUTATION
#define FORGE_ASM_GATE_MUTATION 0
#endif

using namespace forge::ui;
namespace asmb = forge::ui::assembly;

namespace {

int g_checks = 0;
int g_failed = 0;

void check(bool ok, const std::string& what) {
  ++g_checks;
  if (!ok) ++g_failed;
  std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.c_str());
}

constexpr double kPi = 3.14159265358979323846;

// The seam a mutation build breaks. With FORGE_ASM_GATE_MUTATION == 0 it is a
// pure pass-through.
class GateSolver final : public asmb::AssemblySolver {
 public:
  forge::desktop::AssemblySolverHost host;
  asmb::SolveOutcome solve(const asmb::Assembly& a, const std::vector<asmb::Drive>& drives) override {
    asmb::Assembly sent = a;
    std::vector<asmb::Drive> moves = drives;
    if (FORGE_ASM_GATE_MUTATION == 1) moves.clear();
    if (FORGE_ASM_GATE_MUTATION == 3) {
      for (asmb::Joint& j : sent.joints) {
        if (j.kind == asmb::JointKind::Revolute) j.kind = asmb::JointKind::Ball;
      }
    }
    asmb::SolveOutcome out = host.solve(sent, moves);
    if (FORGE_ASM_GATE_MUTATION == 2) out.degreesOfFreedom += 1;
    return out;
  }
  std::string engineName() const override { return host.engineName(); }
};

struct Bench {
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  AssemblySolverSlot slot;
  GateSolver solver;
  int plate = 0;
  int pin = 0;

  Bench() {
    registerPartCommands(shell.registry(), doc, undo);
    registerAssemblyCommands(shell.registry(), doc, undo, slot);
    slot.solver = &solver;
    CommandParams box;
    box.setNumber("dx", 100.0);
    box.setNumber("dy", 20.0);
    box.setNumber("dz", 5.0);
    if (shell.run("part.primitive_box", box).ok()) plate = doc.records().back().irId;
    CommandParams cyl;
    cyl.setNumber("radius", 3.0);
    cyl.setNumber("height", 12.0);
    if (shell.run("part.primitive_cylinder", cyl).ok()) pin = doc.records().back().irId;
  }

  DispatchResult insert(int body, const std::string& name, double x, double y, double z) {
    EntityRef ref;
    ref.bodyId = doc.nodeFor(body);
    ref.kind = EntityKind::Body;
    ref.persistentName = "feature@" + std::to_string(body);
    shell.selection().clearSelection();
    shell.selection().replaceWith({ref});
    CommandParams p;
    p.setText("name", name);
    p.setNumber("x", x);
    p.setNumber("y", y);
    p.setNumber("z", z);
    const DispatchResult r = shell.run("assembly.insert_component", p);
    shell.selection().clearSelection();
    return r;
  }

  DispatchResult ground(const std::string& name) {
    CommandParams p;
    p.setText("component", name);
    return shell.run("assembly.ground", p);
  }

  DispatchResult joint(const std::string& kind, const std::string& name, double x, double y, double z) {
    CommandParams p;
    p.setText("kind", kind);
    p.setText("name", name);
    p.setText("first", "Base");
    p.setText("second", "Arm");
    p.setNumber("x", x);
    p.setNumber("y", y);
    p.setNumber("z", z);
    return shell.run("assembly.add_joint", p);
  }

  DispatchResult turn(const std::string& joint, double degrees) {
    CommandParams p;
    p.setText("joint", joint);
    p.setNumber("value", degrees);
    return shell.run("assembly.move_joint", p);
  }

  // Both instruments, independently.
  int solverDegrees() { return solver.solve(doc.assembly(), {}).degreesOfFreedom; }
  int rankDegrees() const { return asmb::countFreedom(doc.assembly()).degrees; }

  const asmb::Component* component(const std::string& name) const {
    return doc.assembly().componentNamed(name);
  }

  // Base grounded at the origin, Arm lying on it with its left end over Base's
  // right end, hinged at (40, 0, 5) about +z.
  bool hinged() {
    return plate > 0 && insert(plate, "Base", 0, 0, 0).ok() && insert(plate, "Arm", 80, 0, 5).ok() &&
           ground("Base").ok() && joint("REVOLUTE", "Hinge", 40, 0, 5).ok();
  }
};

// Where Arm must be after turning `deg` about the hinge at (40, 0, 5): its
// origin starts 40 mm along +x from the hinge and swings round with it.
bool armAt(const asmb::Component* arm, double deg, std::string& why) {
  if (arm == nullptr) {
    why = "no Arm";
    return false;
  }
  const double t = deg * kPi / 180.0;
  const double c = std::cos(t), s = std::sin(t);
  const double want[3] = {40.0 + 40.0 * c, 40.0 * s, 5.0};
  const double wantR[9] = {c, -s, 0, s, c, 0, 0, 0, 1};
  double worst = 0.0;
  for (int i = 0; i < 3; ++i) worst = std::max(worst, std::abs(arm->placement.t[static_cast<std::size_t>(i)] - want[i]));
  double worstR = 0.0;
  for (int i = 0; i < 9; ++i) worstR = std::max(worstR, std::abs(arm->placement.r[static_cast<std::size_t>(i)] - wantR[i]));
  char buf[200];
  std::snprintf(buf, sizeof(buf), "Arm origin (%.9f, %.9f, %.9f), position error %.2e mm, rotation error %.2e",
                arm->placement.t[0], arm->placement.t[1], arm->placement.t[2], worst, worstR);
  why = buf;
  return worst < 1e-6 && worstR < 1e-9;
}

}  // namespace

int main() {
  std::printf("[assembly-solver-gate] %s, mutation %d\n", forge_asmsolver::libraryVersion(),
              FORGE_ASM_GATE_MUTATION);
  check(forge_asmsolver::apiVersion() == forge_asmsolver::kApiVersion,
        "the loaded library's API version matches the header this was built with");

  // ── A ───────────────────────────────────────────────────────────────────────
  std::printf("[A] two plates, a revolute joint: 1 degree of freedom, and it turns\n");
  {
    Bench b;
    check(b.plate > 0, "a 100 x 20 x 5 plate body was built through part.primitive_box");
    check(b.hinged(), "Base inserted and grounded, Arm inserted, Hinge added -- all through the registry");
    check(b.solverDegrees() == 1, "the solver counts 1 degree of freedom (got " + std::to_string(b.solverDegrees()) + ")");
    check(b.rankDegrees() == 1, "Forge's rank count agrees: 1 (got " + std::to_string(b.rankDegrees()) + ")");
    check(buildAssemblyTreeView(b.doc).summary == "1 degree of freedom",
          "the Assembly tab says \"" + buildAssemblyTreeView(b.doc).summary + "\"");

    const asmb::Placement before = b.component("Arm")->placement;
    for (double deg : {30.0, 170.0, -90.0}) {
      const DispatchResult r = b.turn("Hinge", deg);
      check(r.ok(), "turn Hinge to " + std::to_string(static_cast<int>(deg)) + " degrees" +
                        (r.ok() ? std::string() : ": " + r.detail));
      std::string why;
      check(armAt(b.component("Arm"), deg, why), "Arm is where the arithmetic says: " + why);
      const asmb::Component* base = b.component("Base");
      check(base != nullptr && base->placement == asmb::Placement{}, "grounded Base did not move");
      check(b.solverDegrees() == 1 && b.rankDegrees() == 1, "still 1 degree of freedom");
    }
    check(!(b.component("Arm")->placement == before), "Arm really moved (the arms differ)");
    // Undo walks back one turn: Arm is at 170 again.
    check(b.undo.undo(b.doc), "undo the last turn");
    std::string why;
    check(armAt(b.component("Arm"), 170.0, why), "after undo Arm is back at 170 degrees: " + why);
    // 405 degrees is 45: the joint goes the short way and lands there.
    check(b.turn("Hinge", 405.0).ok(), "turn to 405 degrees");
    check(armAt(b.component("Arm"), 45.0, why), "405 degrees lands at 45: " + why);
  }

  // ── B ───────────────────────────────────────────────────────────────────────
  std::printf("[B] a second, fixed joint to the grounded plate: 0 degrees of freedom\n");
  {
    Bench b;
    check(b.hinged(), "the hinged plates");
    const DispatchResult lock = b.joint("FIXED", "Lock", 80, 0, 5);
    check(lock.ok(), "Lock (fixed, Base to Arm) added" + (lock.ok() ? std::string() : ": " + lock.detail));
    check(b.solverDegrees() == 0, "the solver counts 0 (got " + std::to_string(b.solverDegrees()) + ")");
    check(b.rankDegrees() == 0, "Forge's rank count agrees: 0 (got " + std::to_string(b.rankDegrees()) + ")");
    const AssemblyTreeView view = buildAssemblyTreeView(b.doc);
    check(view.summary == "fully held: 0 degrees of freedom", "the Assembly tab says \"" + view.summary + "\"");
    const asmb::Assembly held = b.doc.assembly();
    const std::size_t depth = b.undo.undoDepth();
    const DispatchResult r = b.turn("Hinge", 45.0);
    check(!r.ok(), "the held hinge refuses to turn");
    check(r.detail.find("\"Hinge\"") != std::string::npos, "and the refusal names Hinge: " + r.detail);
    check(b.doc.assembly() == held && b.undo.undoDepth() == depth, "nothing changed and nothing was recorded");

    Bench g;
    check(g.hinged() && g.ground("Arm").ok(), "the other way to hold it: ground Arm as well");
    check(g.solverDegrees() == 0 && g.rankDegrees() == 0, "0 degrees of freedom, by both instruments");
  }

  // ── C ───────────────────────────────────────────────────────────────────────
  std::printf("[C] an over-constrained set is refused, naming the joints\n");
  {
    Bench b;
    check(b.hinged(), "the hinged plates");
    const asmb::Assembly before = b.doc.assembly();
    const std::size_t depth = b.undo.undoDepth();
    // Clamp holds Arm's hinge end at Base (30, 0, 5), ten millimetres from where
    // the hinge holds it. No placement satisfies both.
    CommandParams clamp;
    clamp.setText("kind", "FIXED");
    clamp.setText("name", "Clamp");
    clamp.setText("first", "Base");
    clamp.setText("second", "Arm");
    clamp.setNumber("first_x", 30);
    clamp.setNumber("first_y", 0);
    clamp.setNumber("first_z", 5);
    clamp.setNumber("second_x", -40);
    clamp.setNumber("second_y", 0);
    clamp.setNumber("second_z", 0);
    const DispatchResult r = b.shell.run("assembly.mate", clamp);
    check(!r.ok() && r.status == DispatchStatus::EditRefused, "Clamp is refused");
    check(r.detail.find("\"Clamp\"") != std::string::npos, "the refusal names Clamp: " + r.detail);
    check(r.detail.find("\"Hinge\"") != std::string::npos, "and names Hinge, which it fights");
    check(b.doc.assembly() == before && b.undo.undoDepth() == depth, "the document is unchanged");

    // ...and a mate that CAN hold moves the part into place: Arm inserted on top
    // of Base, mated end to end.
    Bench m;
    check(m.insert(m.plate, "Base", 0, 0, 0).ok() && m.insert(m.plate, "Arm", 0, 0, 0).ok() &&
              m.ground("Base").ok(),
          "Base and Arm both inserted at the origin, Base grounded");
    CommandParams hinge = clamp;
    hinge.setText("kind", "REVOLUTE");
    hinge.setText("name", "Hinge");
    hinge.setNumber("first_x", 40);
    const DispatchResult mr = m.shell.run("assembly.mate", hinge);
    check(mr.ok(), "the hinge mate is accepted" + (mr.ok() ? std::string() : ": " + mr.detail));
    const asmb::Component* arm = m.component("Arm");
    if (arm != nullptr) {
      const asmb::Vec3 end = arm->placement.point({-40.0, 0.0, 0.0});
      const asmb::Vec3 up = arm->placement.axis(2);
      check(std::abs(end[0] - 40.0) < 1e-6 && std::abs(end[1]) < 1e-6 && std::abs(end[2] - 5.0) < 1e-6,
            "Arm's hinge end was moved onto Base's hinge point");
      check(std::abs(up[2] - 1.0) < 1e-9, "Arm's axis points up, the branch that was asked for");
    }
    check(m.solverDegrees() == 1 && m.rankDegrees() == 1, "the mated pair has 1 degree of freedom");
  }

  // ── D ───────────────────────────────────────────────────────────────────────
  std::printf("[D] the bill of materials lists instances with quantities\n");
  {
    Bench b;
    check(b.insert(b.plate, "Left plate", 0, 0, 0).ok() && b.insert(b.plate, "Right plate", 0, 30, 0).ok() &&
              b.insert(b.pin, "Pin", 0, 15, 5).ok(),
          "two plates and a pin inserted");
    const std::vector<asmb::BomRow> bom = asmb::billOfMaterials(b.doc.assembly(), b.doc);
    check(bom.size() == 2, "two distinct parts");
    if (bom.size() == 2) {
      check(bom[0].part == "Box 1" && bom[0].quantity == 2, "Box 1 x 2 (got " + bom[0].part + " x " +
                                                                std::to_string(bom[0].quantity) + ")");
      check(bom[0].instances.size() == 2 && bom[0].instances[1] == "Right plate", "its instances are named");
      check(bom[1].part == "Cylinder 2" && bom[1].quantity == 1, "Cylinder 2 x 1");
    }
    check(buildAssemblyTreeView(b.doc).bom.size() == 2, "the Assembly tab carries the same list");
  }

  // ── E ───────────────────────────────────────────────────────────────────────
  std::printf("[E] a slider slides\n");
  {
    Bench b;
    check(b.plate > 0 && b.insert(b.plate, "Base", 0, 0, 0).ok() && b.insert(b.plate, "Arm", 80, 0, 5).ok() &&
              b.ground("Base").ok() && b.joint("SLIDER", "Rail", 40, 0, 5).ok(),
          "Arm on a slider along +z");
    check(b.solverDegrees() == 1 && b.rankDegrees() == 1, "a slider leaves 1 degree of freedom");
    CommandParams p;
    p.setText("joint", "Rail");
    p.setNumber("value", 25.0);
    const DispatchResult r = b.shell.run("assembly.move_joint", p);
    check(r.ok(), "slide Rail to 25 mm" + (r.ok() ? std::string() : ": " + r.detail));
    const asmb::Component* arm = b.component("Arm");
    check(arm != nullptr && std::abs(arm->placement.t[0] - 80.0) < 1e-6 && std::abs(arm->placement.t[1]) < 1e-6 &&
              std::abs(arm->placement.t[2] - 30.0) < 1e-6,
          "Arm rose from z = 5 to z = 30 and moved nowhere else");
  }

  // ── F ───────────────────────────────────────────────────────────────────────
  std::printf("[F] the assembly survives Save and Open, exactly\n");
  {
    Bench b;
    check(b.hinged() && b.turn("Hinge", 30.0).ok(), "the hinged plates, turned to 30 degrees");
    const std::string text = forge::desktop::writePartFile(
        forge::desktop::capturePartDocument(b.doc, "hinge", forge::ui::DrawingModel{}, std::string()));
    check(text.rfind("FORGE-PART 5\n", 0) == 0, "the file is format version 5");
    forge::desktop::PartFileDoc file;
    std::string why;
    check(forge::desktop::readPartFile(text, file, why), "it reads back" + (why.empty() ? "" : ": " + why));
    PartDocument reopened;
    check(forge::desktop::restorePartDocument(file, reopened, why), "it restores" + (why.empty() ? "" : ": " + why));
    check(reopened.assembly() == b.doc.assembly(),
          "the reopened assembly is bit-identical: placements, frames, names, ids, ground");
    check(asmb::countFreedom(reopened.assembly()).degrees == 1, "and still has 1 degree of freedom");
    std::string at30;
    check(armAt(reopened.assembly().componentNamed("Arm"), 30.0, at30), "Arm is still at 30 degrees: " + at30);

    // A version-4 file carrying an assembly is hand-edited, and refused.
    std::string v4 = text;
    v4.replace(0, 12, "FORGE-PART 4");
    check(!forge::desktop::readPartFile(v4, file, why) && why.find("version 5") != std::string::npos,
          "a version-4 file with an assembly is refused: " + why);
    // An assembly whose component names a body the file does not build is refused.
    const std::string badBody = "BODY " + std::to_string(b.plate);
    std::string orphan = text;
    const std::size_t at = orphan.find(badBody + "\n");
    if (at != std::string::npos) orphan.replace(at, badBody.size(), "BODY 99");
    forge::desktop::PartFileDoc orphanFile;
    PartDocument orphanDoc;
    check(forge::desktop::readPartFile(orphan, orphanFile, why) &&
              !forge::desktop::restorePartDocument(orphanFile, orphanDoc, why) &&
              why.find("no longer in this part") != std::string::npos,
          "an assembly naming a body the part does not build is refused: " + why);
  }

  std::printf("[assembly-solver-gate] %d checks, %d failed -- %s\n", g_checks, g_failed,
              g_failed == 0 ? "GREEN" : "RED");
  return g_failed == 0 ? 0 : 1;
}
