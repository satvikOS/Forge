#include "forge/ui/ForgeShell.hpp"

#include <cstddef>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::ui {

ForgeShell::ForgeShell() { registerCommands(); }

// ── the command set ─────────────────────────────────────────────────────────
// Every one of these carries the full s19.2 contract: stable ID, label,
// category, selection signature, enabled predicate, parameter schema, preview
// policy, side-effect class, undo contract and the feature-IR op it maps to.
void ForgeShell::registerCommands() {
  const auto always = [](const CommandContext&) { return true; };

  {
    CommandDescriptor c;
    c.id = "file.new";
    c.label = "New Part";
    c.category = "File";
    c.sideEffect = SideEffectClass::Application;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) {
      doc_ = DocumentStats{};
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "file.open";
    c.label = "Open Document";
    c.category = "File";
    // A path has NO honest default: "" is not a document. Ctrl+O must prompt.
    c.schema.push_back(ParamSpec{.name = "path", .type = ParamType::Text, .required = true});
    c.sideEffect = SideEffectClass::Application;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { doc_.dirty = false; };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "file.save";
    c.label = "Save Document";
    c.category = "File";
    c.sideEffect = SideEffectClass::Application;
    c.undo = UndoContract::NotUndoable;
    // A save is offered only when there is something to save.
    c.enabled = [this](const CommandContext&) { return doc_.dirty; };
    c.execute = [this](CommandContext&) { doc_.dirty = false; };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "edit.undo";
    c.label = "Undo";
    c.category = "Edit";
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::NotUndoable;
    c.enabled = [this](const CommandContext&) { return doc_.undoDepth > 0; };
    c.execute = [this](CommandContext&) {
      --doc_.undoDepth;
      ++doc_.redoDepth;
      if (doc_.features > 0) --doc_.features;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "edit.redo";
    c.label = "Redo";
    c.category = "Edit";
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::NotUndoable;
    c.enabled = [this](const CommandContext&) { return doc_.redoDepth > 0; };
    c.execute = [this](CommandContext&) {
      --doc_.redoDepth;
      ++doc_.undoDepth;
      ++doc_.features;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "edit.delete";
    c.label = "Delete Selection";
    c.category = "Edit";
    c.featureIrOp = "DELETE";
    c.signature = SelectionSignature::atLeast(EntityKind::Any, 1);
    c.signature.requireHomogeneous = false;  // deleting a mixed bag is legitimate
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      doc_.deletedCount += ctx.selection().count();
      ++doc_.undoDepth;
      doc_.redoDepth = 0;
      doc_.dirty = true;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.fit";
    c.label = "Fit View";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { ++doc_.fitCount; };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.wireframe";
    c.label = "Wireframe Display";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { doc_.wireframe = !doc_.wireframe; };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "model.extrude";
    c.label = "Extrude";
    c.category = "Model";
    c.featureIrOp = "EXTRUDE";
    c.signature = SelectionSignature::atLeast(EntityKind::Sketch, 1);
    c.schema.push_back(ParamSpec{
        .name = "distance", .type = ParamType::Number, .required = true,
        .defaultNumber = 10.0, .hasDefault = true});
    c.preview = PreviewPolicy::Live;
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      doc_.lastFeatureSize = ctx.params().number("distance").value_or(0.0);
      ++doc_.features;
      ++doc_.undoDepth;
      doc_.redoDepth = 0;
      doc_.dirty = true;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "model.fillet";
    c.label = "Edge Fillet";
    c.category = "Model";
    c.featureIrOp = "FILLET";
    c.signature = SelectionSignature::atLeast(EntityKind::Edge, 1);
    c.schema.push_back(ParamSpec{
        .name = "radius", .type = ParamType::Number, .required = true,
        .defaultNumber = 1.0, .hasDefault = true});
    c.preview = PreviewPolicy::Live;
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      doc_.lastFeatureSize = ctx.params().number("radius").value_or(0.0);
      ++doc_.features;
      ++doc_.undoDepth;
      doc_.redoDepth = 0;
      doc_.dirty = true;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "model.shell";
    c.label = "Shell Body";
    c.category = "Model";
    c.featureIrOp = "SHELL";
    c.signature = SelectionSignature::atLeast(EntityKind::Face, 1);
    c.schema.push_back(ParamSpec{
        .name = "thickness", .type = ParamType::Number, .required = true,
        .defaultNumber = 2.0, .hasDefault = true});
    c.preview = PreviewPolicy::OnDemand;
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      doc_.lastFeatureSize = ctx.params().number("thickness").value_or(0.0);
      ++doc_.features;
      ++doc_.undoDepth;
      doc_.redoDepth = 0;
      doc_.dirty = true;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "app.command_palette";
    c.label = "Command Palette";
    c.category = "Application";
    c.sideEffect = SideEffectClass::Application;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [](CommandContext&) {};  // opening the palette changes no state
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "workspace.next";
    c.label = "Next Workspace";
    c.category = "Application";
    c.sideEffect = SideEffectClass::Application;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) {
      const std::vector<WorkspaceProfile> all = allWorkspaceProfiles();
      for (std::size_t i = 0; i < all.size(); ++i) {
        if (all[i] == workspace_) {
          setWorkspace(all[(i + 1) % all.size()]);
          return;
        }
      }
    };
    registry_.add(std::move(c));
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────
DispatchResult ForgeShell::run(const std::string& id, const CommandParams& params) {
  DispatchResult result = registry_.dispatch(id, selection_, params);
  if (result.ok()) journal_.push_back(id);
  return result;
}

InvokeOutcome ForgeShell::invoke(const std::string& id, const CommandParams& overrides) {
  InvokeOutcome outcome;
  const CommandDescriptor* cmd = registry_.find(id);
  if (cmd == nullptr) {
    outcome.dispatch = DispatchResult{DispatchStatus::UnknownCommand, id};
    return outcome;
  }
  // A gesture carries no arguments, so fill in every default the schema declares
  // and then say plainly what is still missing. Dispatching a default-constructed
  // CommandParams here is what made four of the thirteen shipped commands
  // unreachable from the keyboard in all four input profiles.
  const CommandParams params = applyDefaults(*cmd, overrides);
  outcome.promptFor = missingRequired(*cmd, params);
  if (!outcome.promptFor.empty()) {
    outcome.dispatch =
        DispatchResult{DispatchStatus::MissingRequiredParameter, outcome.promptFor.front()};
    return outcome;
  }
  outcome.dispatch = run(id, params);
  return outcome;
}

void ForgeShell::setInputProfile(InputProfile profile) noexcept {
  input_ = profile;
  pending_.clear();  // a half-typed sequence means nothing in the new profile
}

KeyOutcome ForgeShell::key(const KeyStroke& stroke) {
  pending_.push_back(stroke);
  const Resolution resolution = keymap_.resolve(input_, pending_);
  KeyOutcome outcome;
  outcome.resolve = resolution.status;
  switch (resolution.status) {
    case ResolveStatus::Pending:
      return outcome;  // keep collecting
    case ResolveStatus::Unbound:
      pending_.clear();
      return outcome;
    case ResolveStatus::Bound:
      break;
  }
  pending_.clear();
  outcome.commandId = resolution.commandId;
  const InvokeOutcome invoked = invoke(resolution.commandId);
  outcome.dispatch = invoked.dispatch;
  outcome.promptFor = invoked.promptFor;
  return outcome;
}

// ── workspaces ──────────────────────────────────────────────────────────────
bool ForgeShell::setWorkspace(WorkspaceProfile profile) {
  // Serialization IS the storage format for a saved workspace, so a layout that
  // does not survive its own round trip would come back changed — a torn-off
  // panel renamed or lost. Store it only if it really returns; otherwise drop
  // the entry so the workspace reopens at its deterministic default instead of
  // at a corrupted or stale one.
  const std::string outgoing = layout_.serialize();
  DockLayout probe;
  const bool faithful = DockLayout::parse(outgoing, probe) && probe == layout_;
  if (faithful) {
    savedLayouts_[toString(workspace_)] = outgoing;
  } else {
    savedLayouts_.erase(toString(workspace_));
  }

  workspace_ = profile;
  auto it = savedLayouts_.find(toString(profile));
  DockLayout restored;
  if (it != savedLayouts_.end() && DockLayout::parse(it->second, restored)) {
    layout_ = std::move(restored);
  } else {
    layout_ = defaultLayout(profile);
  }
  return faithful;
}

void ForgeShell::resetWorkspaceLayout() { layout_ = defaultLayout(workspace_); }

RecoveryReport ForgeShell::monitorsChanged(const std::vector<MonitorInfo>& available) {
  return layout_.reconcileMonitors(available);
}

// ── persistence ─────────────────────────────────────────────────────────────
std::string ForgeShell::saveState() const {
  std::ostringstream os;
  os << "forge-shell 1\n";
  os << "workspace " << toString(workspace_) << '\n';
  os << "input " << toString(input_) << '\n';

  std::map<std::string, std::string> layouts = savedLayouts_;
  {
    // Same rule as setWorkspace: never persist a layout that cannot be read
    // back, because loadState refuses the WHOLE session file on one bad record.
    const std::string current = layout_.serialize();
    DockLayout probe;
    if (DockLayout::parse(current, probe) && probe == layout_) {
      layouts[toString(workspace_)] = current;
    } else {
      layouts.erase(toString(workspace_));
    }
  }
  for (const auto& [name, text] : layouts) {
    os << "layout " << name << '\n' << text << ".\n";
  }
  os << "keymap\n" << keymap_.serialize() << ".\n";
  return os.str();
}

bool ForgeShell::loadState(const std::string& text) {
  std::istringstream is(text);
  std::string line;
  if (!std::getline(is, line) || line != "forge-shell 1") return false;

  WorkspaceProfile workspace = WorkspaceProfile::Part;
  InputProfile input = InputProfile::ForgeNative;
  bool haveWorkspace = false;
  bool haveInput = false;
  std::map<std::string, std::string> layouts;
  Keymap keymap;
  bool haveKeymap = false;

  while (std::getline(is, line)) {
    if (line.empty()) continue;
    if (line.rfind("workspace ", 0) == 0) {
      if (!workspaceFromString(line.substr(10), workspace)) return false;
      haveWorkspace = true;
    } else if (line.rfind("input ", 0) == 0) {
      const std::string name = line.substr(6);
      bool found = false;
      for (InputProfile p : allInputProfiles()) {
        if (name == toString(p)) {
          input = p;
          found = true;
          break;
        }
      }
      if (!found) return false;
      haveInput = true;
    } else if (line.rfind("layout ", 0) == 0 || line == "keymap") {
      const bool isKeymap = (line == "keymap");
      const std::string name = isKeymap ? std::string() : line.substr(7);
      std::string body;
      bool terminated = false;
      while (std::getline(is, line)) {
        if (line == ".") {
          terminated = true;
          break;
        }
        body += line;
        body += '\n';
      }
      if (!terminated) return false;
      if (isKeymap) {
        if (!Keymap::parse(body, keymap)) return false;
        haveKeymap = true;
      } else {
        DockLayout probe;
        if (!DockLayout::parse(body, probe)) return false;  // reject corrupt state
        layouts[name] = body;
      }
    } else {
      return false;  // unknown record: refuse rather than silently drop state
    }
  }
  if (!haveWorkspace || !haveInput || !haveKeymap) return false;

  workspace_ = workspace;
  input_ = input;
  savedLayouts_ = std::move(layouts);
  keymap_ = std::move(keymap);
  pending_.clear();

  DockLayout current;
  auto it = savedLayouts_.find(toString(workspace_));
  if (it != savedLayouts_.end() && DockLayout::parse(it->second, current)) {
    layout_ = std::move(current);
  } else {
    layout_ = defaultLayout(workspace_);
  }
  return true;
}

}  // namespace forge::ui
