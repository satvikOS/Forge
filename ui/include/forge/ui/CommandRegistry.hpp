// ui/include/forge/ui/CommandRegistry.hpp
//
// ONE versioned command registry (Sacrosanct s19.2). Menus, toolbars, the command
// palette, context and radial menus, every input profile's shortcuts, macros AND
// Archie's tool calls all resolve a stable string ID here and dispatch through
// this one path. The UI is never wired directly to a widget callback — that is
// the rule this class exists to make structurally enforceable, because a widget
// callback is invisible to Archie, to macros, and to the shortcut editor.
//
// Every dispatch passes three gates before the handler runs:
//   1. the command exists under that stable ID,
//   2. its REQUIRED SELECTION SIGNATURE is satisfied by the live selection,
//   3. its ENABLED PREDICATE returns true,
// plus a parameter-schema check for required parameters. Each gate has its own
// DispatchStatus so a disabled command and a mis-selected one never look alike.
#ifndef FORGE_UI_COMMANDREGISTRY_HPP
#define FORGE_UI_COMMANDREGISTRY_HPP

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── selection signature ─────────────────────────────────────────────────────
// What a command needs picked before it can run. `Extrude` needs 1..n sketches;
// `Fillet` needs 1..n edges; `Undo` needs nothing.
struct SelectionSignature {
  EntityKind kind = EntityKind::None;   // None => the command needs no selection
  std::size_t minCount = 0;
  std::size_t maxCount = static_cast<std::size_t>(-1);
  bool requireHomogeneous = true;

  static SelectionSignature none() noexcept { return SelectionSignature{}; }
  static SelectionSignature exactly(EntityKind k, std::size_t n) noexcept {
    return SelectionSignature{k, n, n, true};
  }
  static SelectionSignature atLeast(EntityKind k, std::size_t n) noexcept {
    return SelectionSignature{k, n, static_cast<std::size_t>(-1), true};
  }
  static SelectionSignature range(EntityKind k, std::size_t lo, std::size_t hi) noexcept {
    return SelectionSignature{k, lo, hi, true};
  }

  bool satisfiedBy(const SelectionService& sel) const noexcept;
  std::string describe() const;
};

// ── parameter schema ────────────────────────────────────────────────────────
enum class ParamType : std::uint8_t { Number, Text, Flag };

struct ParamSpec {
  std::string name;
  ParamType type = ParamType::Number;
  bool required = false;
  double defaultNumber = 0.0;
  std::string defaultText;
};

class CommandParams {
 public:
  void setNumber(const std::string& name, double v) { numbers_[name] = v; }
  void setText(const std::string& name, std::string v) { texts_[name] = std::move(v); }
  void setFlag(const std::string& name, bool v) { flags_[name] = v; }

  std::optional<double> number(const std::string& name) const;
  std::optional<std::string> text(const std::string& name) const;
  std::optional<bool> flag(const std::string& name) const;
  bool has(const std::string& name) const;
  std::size_t size() const noexcept { return numbers_.size() + texts_.size() + flags_.size(); }

 private:
  std::map<std::string, double> numbers_;
  std::map<std::string, std::string> texts_;
  std::map<std::string, bool> flags_;
};

// ── the rest of the s19.2 command contract ──────────────────────────────────
enum class PreviewPolicy : std::uint8_t { None, OnDemand, Live };
enum class SideEffectClass : std::uint8_t { ViewOnly, Selection, Document, Application };
enum class UndoContract : std::uint8_t { NotUndoable, SingleStep, Transaction };

// Non-owning view of the state a handler may read. Handlers capture whatever
// document they mutate in their own closure, so the registry stays decoupled
// from the modeller and there is no global mutable state anywhere in this layer.
class CommandContext {
 public:
  CommandContext(const SelectionService& selection, CommandParams params)
      : selection_(selection), params_(std::move(params)) {}

  const SelectionService& selection() const noexcept { return selection_; }
  const CommandParams& params() const noexcept { return params_; }

 private:
  const SelectionService& selection_;
  CommandParams params_;
};

struct CommandDescriptor {
  std::string id;        // STABLE. Never renamed; it is what macros and Archie store.
  std::string label;     // human, localizable
  std::string category;  // "Model", "Sketch", "View", "Edit", "Assembly", ...
  std::string featureIrOp;  // equivalent feature-IR operation, "" for pure-UI commands
  SelectionSignature signature{};
  std::vector<ParamSpec> schema;
  PreviewPolicy preview = PreviewPolicy::None;
  SideEffectClass sideEffect = SideEffectClass::Document;
  UndoContract undo = UndoContract::SingleStep;
  std::uint32_t version = 1;

  // The enabled predicate. Default = always enabled. It GATES execution: if this
  // returns false the handler is not called, however the command was invoked.
  std::function<bool(const CommandContext&)> enabled;
  std::function<void(CommandContext&)> execute;
};

enum class DispatchStatus : std::uint8_t {
  Ok = 0,
  UnknownCommand,
  SelectionSignatureMismatch,
  Disabled,
  MissingRequiredParameter,
  NoHandler,
};

const char* toString(DispatchStatus status) noexcept;

struct DispatchResult {
  DispatchStatus status = DispatchStatus::Ok;
  std::string detail;
  bool ok() const noexcept { return status == DispatchStatus::Ok; }
};

class CommandRegistry {
 public:
  // Registration fails (returns false) on an empty ID, a missing handler, or a
  // DUPLICATE ID — two implementations behind one ID is precisely the "same
  // command, two code paths" failure the single registry exists to prevent.
  bool add(CommandDescriptor descriptor);

  const CommandDescriptor* find(const std::string& id) const noexcept;
  bool contains(const std::string& id) const noexcept { return find(id) != nullptr; }
  std::size_t size() const noexcept { return order_.size(); }

  // Deterministic, sorted-by-ID listing — order-independent tests, stable menus.
  std::vector<std::string> ids() const;
  std::vector<std::string> idsInCategory(const std::string& category) const;
  std::vector<std::string> categories() const;

  // Command palette: case-insensitive substring over ID and label, ranked by
  // match position then ID, so the result is deterministic.
  std::vector<std::string> search(const std::string& query, std::size_t limit = 20) const;

  // Would this command run right now? Menus grey out on exactly this answer, so
  // it is the SAME code path dispatch uses — a menu can never disagree with the
  // dispatcher about whether a command is available.
  DispatchResult evaluate(const std::string& id, const SelectionService& selection,
                          const CommandParams& params = {}) const;

  DispatchResult dispatch(const std::string& id, const SelectionService& selection,
                          const CommandParams& params = {}) const;

  std::size_t dispatchCount() const noexcept { return dispatches_; }

 private:
  std::map<std::string, CommandDescriptor> byId_;
  std::vector<std::string> order_;
  mutable std::size_t dispatches_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_COMMANDREGISTRY_HPP
