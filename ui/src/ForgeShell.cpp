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
    c.schema.push_back(ParamSpec{"path", ParamType::Text, true, 0.0, ""});
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
    c.schema.push_back(ParamSpec{"distance", ParamType::Number, true, 10.0, ""});
    c.preview = PreviewPolicy::Live;
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext&) {
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
    c.schema.push_back(ParamSpec{"radius", ParamType::Number, true, 1.0, ""});
    c.preview = PreviewPolicy::Live;
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext&) {
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
    c.schema.push_back(ParamSpec{"thickness", ParamType::Number, true, 2.0, ""});
    c.preview = PreviewPolicy::OnDemand;
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::Transaction;
    c.enabled = always;
    c.execute = [this](CommandContext&) {
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
  outcome.dispatch = run(resolution.commandId);
  return outcome;
}

// ── workspaces ──────────────────────────────────────────────────────────────
void ForgeShell::setWorkspace(WorkspaceProfile profile) {
  savedLayouts_[toString(workspace_)] = layout_.serialize();
  workspace_ = profile;
  auto it = savedLayouts_.find(toString(profile));
  DockLayout restored;
  if (it != savedLayouts_.end() && DockLayout::parse(it->second, restored)) {
    layout_ = std::move(restored);
  } else {
    layout_ = defaultLayout(profile);
  }
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
  layouts[toString(workspace_)] = layout_.serialize();
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
