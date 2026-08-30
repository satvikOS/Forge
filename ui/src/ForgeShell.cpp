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
      documentError_.clear();
      if (documentHost_ != nullptr && !documentHost_->documentNew(documentError_)) return;
      doc_ = DocumentStats{};
      syncDocumentStats();
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
    // The path argument is READ now. Before the document seam existed this body
    // was `doc_.dirty = false;` and Open was indistinguishable from a no-op.
    c.execute = [this](CommandContext& ctx) {
      documentError_.clear();
      const std::string path = ctx.params().text("path").value_or(std::string());
      if (documentHost_ != nullptr) {
        if (!documentHost_->documentOpen(path, documentError_)) return;
        syncDocumentStats();
        doc_.dirty = false;
        return;
      }
      doc_.dirty = false;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "file.save";
    c.label = "Save Document";
    c.category = "File";
    c.sideEffect = SideEffectClass::Application;
    c.undo = UndoContract::NotUndoable;
    // OPTIONAL, so a bare Ctrl+S still dispatches: a Save With No Path is Save,
    // and the host answers where. A required parameter here would turn every
    // keyboard save into MissingRequiredParameter.
    c.schema.push_back(ParamSpec{.name = "path", .type = ParamType::Text, .required = false});
    // A save is offered only when there is something to save.
    c.enabled = [this](const CommandContext&) { return doc_.dirty; };
    c.execute = [this](CommandContext& ctx) {
      documentError_.clear();
      const std::string path = ctx.params().text("path").value_or(std::string());
      if (documentHost_ != nullptr) {
        if (!documentHost_->documentSave(path, documentError_)) return;
        syncDocumentStats();
        doc_.dirty = false;
        return;
      }
      doc_.dirty = false;
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "edit.undo";
    c.label = "Undo";
    c.category = "Edit";
    c.sideEffect = SideEffectClass::Document;
    c.undo = UndoContract::NotUndoable;
    // ONE UNDO STACK. This used to fall back to `--doc_.undoDepth;
    // ++doc_.redoDepth; if (doc_.features > 0) --doc_.features;` when no host was
    // installed -- a second, private undo model that could only ever move
    // counters, and that hid the "nothing here can undo anything" case behind an
    // Ok. Undo now REQUIRES the document's own memento stack: with no host there
    // is nothing to unwind, and the command says so by being disabled.
    c.enabled = [this](const CommandContext&) {
      return documentHost_ != nullptr && doc_.undoDepth > 0;
    };
    c.execute = [this](CommandContext&) {
      documentError_.clear();
      if (documentHost_ == nullptr) {
        documentError_ = "no document is open";
        return;
      }
      if (!documentHost_->documentUndo()) {
        documentError_ = "nothing to undo";
        return;
      }
      syncDocumentStats();
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
    c.enabled = [this](const CommandContext&) {
      return documentHost_ != nullptr && doc_.redoDepth > 0;
    };
    c.execute = [this](CommandContext&) {
      documentError_.clear();
      if (documentHost_ == nullptr) {
        documentError_ = "no document is open";
        return;
      }
      if (!documentHost_->documentRedo()) {
        documentError_ = "nothing to redo";
        return;
      }
      syncDocumentStats();
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
  // ── THERE ARE NO MODELLING COMMANDS HERE ──────────────────────────────────
  //
  // `model.extrude`, `model.fillet` and `model.shell` used to sit at this point
  // in the list, and the shipped keymap bound E / R / Ctrl+Shift+H (and the NX,
  // CATIA and Blender equivalents) to them in all four input profiles. Their
  // whole execute body was:
  //
  //     doc_.lastFeatureSize = ctx.params().number("distance").value_or(0.0);
  //     ++doc_.features; ++doc_.undoDepth; doc_.redoDepth = 0; doc_.dirty = true;
  //
  // -- four counters. They emitted no feature-IR, so the document gained no
  // statement and the viewport could not change; and once a DocumentHost is
  // installed, syncDocumentStats() overwrites all four counters from the real
  // document on the way out of run(), so in the running application pressing R
  // changed NOTHING AT ALL while the console printed "model.fillet -> ok".
  // ARCHIE_OP_VOCABULARY.md recorded them as "commands that declare an op they
  // never emit"; the op vocabulary gate dispatched all three and asserted the
  // document gained nothing.
  //
  // Modelling belongs to whoever owns the document. It is
  // forge::ui::registerPartCommands (PartCommands.cpp) that adds part.extrude,
  // part.fillet, part.shell and thirteen more, each of which appends ONE line of
  // feature-IR to a PartDocument, into THIS SAME registry -- and the keymap now
  // names those. A modelling command that cannot reach a document has nothing to
  // do, and a shell with no document must not pretend otherwise.
  //
  // What the shell keeps is what it can honestly do without one: files (through
  // the DocumentHost seam), view state, selection-delete, the palette and the
  // workspaces.
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
void ForgeShell::setDocumentHost(DocumentHost* host) noexcept {
  documentHost_ = host;
  documentError_.clear();
  syncDocumentStats();
}

void ForgeShell::syncDocumentStats() {
  if (documentHost_ == nullptr) return;
  // PULLED, never accumulated. The counters were previously incremented by each
  // handler, which is how the status strip came to read "features 0" over a
  // document holding real features: two tallies of one thing, and only one of
  // them was the document.
  doc_.features = documentHost_->documentFeatureCount();
  doc_.undoDepth = documentHost_->documentUndoDepth();
  doc_.redoDepth = documentHost_->documentRedoDepth();
  doc_.dirty = documentHost_->documentDirty();
}

DispatchResult ForgeShell::run(const std::string& id, const CommandParams& params) {
  DispatchResult result = registry_.dispatch(id, selection_, params);
  if (result.ok()) journal_.push_back(id);
  // EVERY command, not just the file ones: a Part command mutates the document
  // through its own receiver, and the shell's view of it must follow the same
  // dispatch rather than a separate notification nobody remembers to send.
  syncDocumentStats();
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
