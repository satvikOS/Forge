// ui/include/forge/ui/AssemblyCommands.hpp
//
// THE ASSEMBLY WORKSPACE'S COMMANDS -- insert a component, ground it, join two
// components, move a joint, remove an item -- and the one interpreter that turns
// each of their typed statements into an assembly edit.
//
// ── one path, three invokers ────────────────────────────────────────────────
// A person clicking a ribbon button, a macro and an Archie plan step all reach
// the SAME CommandDescriptor, and every handler below does the same four things
// in the same order:
//
//   1. write the typed statement (COMPONENT / GROUND / JOINT / DRIVE / REMOVE)
//      from the command's parameters,
//   2. interpret it against the document's assembly into a CANDIDATE
//      (applyAssemblyStatement -- nothing is changed yet),
//   3. solve the candidate and MEASURE the answer (assembly::solveAndVerify),
//   4. commit it as ONE undo step, or refuse with the reason and change nothing.
//
// That is Forge's transaction rule applied to assemblies: a joint that cannot
// hold is refused by name, and the document never shows a half-made edit.
//
// ── the solver seam ─────────────────────────────────────────────────────────
// forge::ui links no solver. The application installs one into the
// AssemblySolverSlot after it registers these commands; a headless build without
// one can still insert and ground components, and refuses any edit that needs
// placements computed, saying so.
#ifndef FORGE_UI_ASSEMBLYCOMMANDS_HPP
#define FORGE_UI_ASSEMBLYCOMMANDS_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/AssemblyModel.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// The seam. Commands read `solver` at the moment they run, so installing or
// replacing it after registration is honoured.
struct AssemblySolverSlot {
  assembly::AssemblySolver* solver = nullptr;
};

// ── the ConcreteCommand for every assembly edit ─────────────────────────────
// Its inverse is exactly the assembly it replaced, so it stores that and needs no
// Memento (Design Patterns p.235, the cheaper undo, as SetMaterialEdit does).
class AssemblyEdit final : public UndoableEdit {
 public:
  AssemblyEdit(assembly::Assembly after, std::string label);

  const std::string& label() const noexcept override { return label_; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  assembly::Assembly after_;
  assembly::Assembly before_{};
  std::string label_;
};

// ── the interpreter ─────────────────────────────────────────────────────────
// What one statement does to an assembly. Pure: `current` is not changed.
struct AssemblyStatementResult {
  bool ok = false;
  std::string reason;                    // why not, in words
  assembly::Assembly candidate;          // `current` with the statement applied
  std::vector<assembly::Drive> drives;   // DRIVE's move, for the solver
  int touchedComponent = 0;              // the component the statement made or changed
  int touchedJoint = 0;                  // the joint the statement made, moved or named
  std::string label;                     // the undo step's name: "Insert Base"
};

AssemblyStatementResult applyAssemblyStatement(const assembly::Assembly& current,
                                               const IrLine& statement,
                                               const PartDocument& document);

// Interpret, solve, measure and commit one statement: the whole transaction. The
// document and the undo stack are untouched unless it returns true.
bool performAssemblyStatement(PartDocument& document, UndoStack& undo,
                              assembly::AssemblySolver* solver, const IrLine& statement,
                              std::string& reason);

// ── registration ────────────────────────────────────────────────────────────
// All three references must outlive the registry: the handlers capture them.
std::size_t registerAssemblyCommands(CommandRegistry& registry, PartDocument& document,
                                     UndoStack& undoStack, AssemblySolverSlot& solver);

// The stable ids registerAssemblyCommands adds, sorted.
const std::vector<std::string>& assemblyCommandIds();

// ── what the Assembly tab draws ─────────────────────────────────────────────
// Every string here is final text for a person; the panel lays it out and adds
// nothing. ui/test/assembly_model_test.cpp pins it.
struct AssemblyTreeRow {
  int id = 0;
  std::string label;     // "Base plate"
  std::string detail;    // "Plate 3, grounded" / "revolute: Base plate to Arm"
  std::string statement; // the typed statement, for a tooltip
  bool grounded = false;
  bool problem = false;  // a joint that does not hold, a component whose body is gone
  // A joint's free coordinates, as they are now: what a Move gesture starts from.
  bool turns = false;
  bool slides = false;
  double turnDeg = 0.0;
  double slideMm = 0.0;
};

struct AssemblyTreeView {
  bool empty = true;
  std::string summary;   // "1 degree of freedom", "fully held: 0 degrees of freedom"
  bool trouble = false;  // the summary describes something wrong
  std::vector<AssemblyTreeRow> components;
  std::vector<AssemblyTreeRow> joints;
  std::vector<assembly::BomRow> bom;
  std::size_t rowCount() const noexcept { return components.size() + joints.size(); }
};

AssemblyTreeView buildAssemblyTreeView(const PartDocument& document);

}  // namespace forge::ui

#endif  // FORGE_UI_ASSEMBLYCOMMANDS_HPP
