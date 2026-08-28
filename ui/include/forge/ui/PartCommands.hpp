// ui/include/forge/ui/PartCommands.hpp
//
// THE PART WORKSPACE'S PRODUCT COMMANDS — the first real content of the s19.2
// registry. Until this file existed, `CommandRegistry` was an empty mechanism:
// grep for `registerCommand|builtin|Builtin` in CommandRegistry.cpp printed
// nothing, every gate registered its own throwaway fixture, and no JS behavior
// could ever be retired against it. A high check count is not migration
// coverage; owning the commands is.
//
// ── the pattern, named ──────────────────────────────────────────────────────
// This is the GoF COMMAND pattern (Gamma, Helm, Johnson & Vlissides, *Design
// Patterns*, 1994, p.233) in its full form, with the MEMENTO variant (p.283)
// used for undo exactly as that chapter prescribes for a receiver whose inverse
// is not cheaply computable:
//
//   Command   = `CommandDescriptor` in the registry — the invoker-independent
//               request. A menu item, a keystroke, a palette pick, a macro step
//               and an Archie tool call are all *invokers* of the same object.
//   Receiver  = `PartDocument` — the feature-IR program being built.
//   ConcreteCommand = `AppendFeatureEdit` — one reversible mutation.
//   Caretaker = `UndoStack` — the explicit undo/redo stacks. `perform()` applies
//               and pushes; a new edit clears the redo stack, which is the
//               linear-undo contract every CAD system ships.
//   Memento   = `PartDocument::Snapshot` — the state the edit captured before it
//               ran. GoF's alternative ("store enough state to reverse") is
//               unusable here: a boolean ABSORBS both operands' name bindings,
//               so the inverse is not derivable from the command's arguments.
//
// ── what a command actually does ────────────────────────────────────────────
// It emits ONE LINE of feature-IR (see FeatureIr.hpp) into the document. It does
// not call the kernel, own a widget callback, or touch a renderer. That is what
// makes the same command reachable from a menu, a macro and Archie, and what
// makes it testable headless: the assertion is on the emitted IR text.
#ifndef FORGE_UI_PARTCOMMANDS_HPP
#define FORGE_UI_PARTCOMMANDS_HPP

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"

namespace forge::ui {

// The three value kinds forge::ft's IR model defines (FeatureTree.hpp, "IR VALUE
// MODEL"). A command's selection must resolve to the right one: EXTRUDE consumes
// a PROFILE, FILLET consumes a SOLID, and offering either on the other is the
// mis-selection a signature exists to refuse.
enum class IrValueKind : std::uint8_t { None, Profile, Wire, Solid };

const char* toString(IrValueKind kind) noexcept;

struct FeatureRecord {
  int irId = 0;                 // == line.id; also the 1-based document position
  std::string commandId;        // "" for a value seeded before any command ran
  std::string label;            // feature-tree row label
  IrLine line;                  // the emitted statement
  IrValueKind produces = IrValueKind::Solid;
};

// ── the receiver ────────────────────────────────────────────────────────────
// A headless feature-IR program plus the binding from a UI document-node id
// (EntityRef::bodyId) to the IR value that node currently IS. The binding is the
// whole point: a selection is a stable topology reference, and a command can only
// run if that reference resolves to a value the IR can name.
class PartDocument {
 public:
  // Seed a value that exists before any Part command ran: an imported body, or a
  // sketch authored in the Sketch workspace. `nodeId` is the EntityRef::bodyId
  // the UI will select it by.
  int seed(IrValueKind kind, const std::string& nodeId, const std::string& op,
           std::vector<IrArg> args);

  int nextIrId() const noexcept { return static_cast<int>(records_.size()) + 1; }
  int valueFor(const std::string& nodeId) const noexcept;  // 0 == not bound
  IrValueKind kindOf(int irId) const noexcept;

  const std::vector<FeatureRecord>& records() const noexcept { return records_; }
  std::size_t featureCount() const noexcept;   // command-authored records only
  const FeatureRecord* lastFeature() const noexcept;
  std::string irProgram() const;               // every statement, newline-joined
  IrCheck lastCheck() const noexcept { return lastCheck_; }

  // Refuses and mutates NOTHING when the statement fails validateIr() or is not
  // numbered nextIrId(). Only AppendFeatureEdit calls this.
  bool appendFeature(const FeatureRecord& record,
                     const std::vector<std::string>& consumedNodes,
                     const std::string& producedNode);

  // GoF Memento. Small by construction: a record count plus the binding table.
  struct Snapshot {
    std::size_t records = 0;
    std::map<std::string, int> bindings;
  };
  Snapshot snapshot() const;
  void restore(const Snapshot& state);

 private:
  std::vector<FeatureRecord> records_;
  std::map<std::string, int> bindings_;
  IrCheck lastCheck_ = IrCheck::Ok;
};

// ── the concrete command ────────────────────────────────────────────────────
class UndoableEdit {
 public:
  virtual ~UndoableEdit() = default;
  virtual const std::string& label() const noexcept = 0;
  virtual bool apply(PartDocument& doc) = 0;
  virtual void revert(PartDocument& doc) = 0;
};

class AppendFeatureEdit final : public UndoableEdit {
 public:
  AppendFeatureEdit(FeatureRecord record, std::vector<std::string> consumedNodes,
                    std::string producedNode);

  const std::string& label() const noexcept override { return record_.label; }
  bool apply(PartDocument& doc) override;
  void revert(PartDocument& doc) override;

 private:
  FeatureRecord record_;
  std::vector<std::string> consumed_;
  std::string produced_;
  PartDocument::Snapshot before_{};
};

// ── the caretaker ───────────────────────────────────────────────────────────
class UndoStack {
 public:
  // Applies the edit; pushes it only if it applied. A new edit clears redo.
  bool perform(PartDocument& doc, std::unique_ptr<UndoableEdit> edit);
  bool undo(PartDocument& doc);
  bool redo(PartDocument& doc);

  std::size_t undoDepth() const noexcept { return done_.size(); }
  std::size_t redoDepth() const noexcept { return undone_.size(); }
  std::string undoLabel() const;  // "" when the stack is empty
  std::string redoLabel() const;
  void clear() noexcept;

 private:
  std::vector<std::unique_ptr<UndoableEdit>> done_;
  std::vector<std::unique_ptr<UndoableEdit>> undone_;
};

// ── registration ────────────────────────────────────────────────────────────
// Adds the Part workspace core to `registry` and returns how many were added.
// Both references must outlive the registry: the handlers capture them.
std::size_t registerPartCommands(CommandRegistry& registry, PartDocument& document,
                                 UndoStack& undoStack);

// The stable IDs this function registers, sorted. Menus, keymaps, the manifest
// and Archie's tool list all read this rather than hard-coding strings.
const std::vector<std::string>& partCommandIds();

}  // namespace forge::ui

#endif  // FORGE_UI_PARTCOMMANDS_HPP
