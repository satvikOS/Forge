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

// ── the view seam ───────────────────────────────────────────────────────────
void ForgeShell::setDisplayMode(DisplayMode mode) noexcept {
  if (mode != DisplayMode::Wireframe) {
    // Remember where a wireframe toggle should come BACK to. Recording it only
    // for non-wireframe modes is what stops "wireframe, wireframe" from making
    // wireframe its own restore target and stranding the user there.
    view_.restoreMode = mode;
  }
  if (view_.mode == mode) return;
  view_.mode = mode;
  // The one boolean the status strip and ViewportRequest have always read. It is
  // DERIVED here rather than set alongside, so the two cannot disagree about
  // whether the viewport is in wireframe.
  doc_.wireframe = mode == DisplayMode::Wireframe;
  ++view_.styleCount;
}

void ForgeShell::setSectionPlane(const SectionPlane& plane) noexcept {
  view_.section = plane;
  ++view_.styleCount;
}

void ForgeShell::requestView(StandardViewId id) noexcept {
  view_.orientation = orientationForStandardView(id);
  ++view_.orientationCount;
}

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
    // Still a TOGGLE, and still the id every input profile's keymap binds --
    // renaming a stable id would break every recorded macro. What changed is
    // what it toggles: the display MODE, of which wireframe is one of five,
    // rather than the one boolean that used to be the whole display model.
    // `doc_.wireframe` is kept in step because the status strip and the
    // renderer's ViewportRequest both read it.
    c.execute = [this](CommandContext&) {
      setDisplayMode(view_.mode == DisplayMode::Wireframe ? view_.restoreMode
                                                          : DisplayMode::Wireframe);
    };
    registry_.add(std::move(c));
  }
  // ── the other four display modes ──────────────────────────────────────────
  // Shaded, shaded-with-edges, hidden-line and transparent. Each id below is
  // ALSO a row in the ONE table in ViewStyle.hpp, which the View menu, the
  // status strip and a saved workspace all read; forge_shell_test asserts the
  // two agree in both directions, so a mode with no command and a command with
  // no mode are both caught. They are written out one block apiece, not looped,
  // because a stable command id must be a greppable literal -- and because the
  // Archie op-vocabulary derivation reads THIS FUNCTION as its source of truth
  // for what the registry holds.
  //
  // view.wireframe is not here: it exists above with its toggle semantics.
  {
    CommandDescriptor c;
    c.id = "view.shaded";
    c.label = "Shaded";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    // Selecting the mode you are already in is a no-op, not an error: greying it
    // out would make the View menu unable to SHOW which mode is active.
    c.enabled = always;
    c.execute = [this](CommandContext&) { setDisplayMode(DisplayMode::Shaded); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.shaded_edges";
    c.label = "Shaded with Edges";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { setDisplayMode(DisplayMode::ShadedEdges); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.hidden_line";
    c.label = "Hidden Line";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { setDisplayMode(DisplayMode::HiddenLine); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.transparent";
    c.label = "Transparent";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { setDisplayMode(DisplayMode::Transparent); };
    registry_.add(std::move(c));
  }
  // ── the seven standard views ──────────────────────────────────────────────
  // Front, back, left, right, top, bottom and isometric. Not one angle is typed
  // here: every pose is DERIVED from its view-cube zone (ViewOrientation.hpp),
  // so clicking the cube's top face and picking View > Top are one pose and
  // cannot drift apart. Before this the app had FOUR views and no way to reach
  // any of them but an orbit drag -- Camera::setFront/setTop/setRight/
  // setIsometric existed and no command called them, and there was no back, left
  // or bottom view at all.
  {
    CommandDescriptor c;
    c.id = "view.front";
    c.label = "Front";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Front); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.back";
    c.label = "Back";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Back); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.left";
    c.label = "Left";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Left); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.right";
    c.label = "Right";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Right); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.top";
    c.label = "Top";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Top); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.bottom";
    c.label = "Bottom";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Bottom); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.iso";
    c.label = "Isometric";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) { requestView(StandardViewId::Isometric); };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.zoom_selection";
    c.label = "Zoom to Selection";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    // It needs SOMETHING picked. Offering it on an empty selection would either
    // do nothing while reporting Ok, or fly the camera to the world origin and
    // lose the part -- both worse than a greyed-out menu item that says why.
    c.enabled = [](const CommandContext& ctx) { return ctx.selection().count() > 0; };
    c.execute = [this](CommandContext&) { ++view_.zoomSelectionCount; };
    registry_.add(std::move(c));
  }
  // ── the section plane ─────────────────────────────────────────────────────
  // A section is the only way to see a bore's wall thickness, and on the
  // 329-430-face parts this app targets the inside of the model is otherwise
  // unreachable. It is a plane ACROSS the modes, not a sixth mode: sectioned
  // wireframe and sectioned shaded are both real and both used.
  {
    CommandDescriptor c;
    c.id = "view.section_toggle";
    c.label = "Section View";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.enabled = always;
    c.execute = [this](CommandContext&) {
      SectionPlane p = view_.section;
      p.enabled = !p.enabled;
      // A plane with a zero normal cuts nothing and would report `enabled` while
      // doing nothing at all. Turning one on always gives it a real normal.
      if (p.enabled && !p.valid()) p = axisSectionPlane(0, p.offset);
      setSectionPlane(p);
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.section_axis";
    c.label = "Section Plane Axis";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.schema.push_back(ParamSpec{.name = "axis",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 0.0,
                                 .hasDefault = true});
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      const double a = ctx.params().number("axis").value_or(0.0);
      if (!(a >= 0.0 && a <= 2.0)) {
        ctx.fail("section axis must be 0 (X), 1 (Y) or 2 (Z)");
        return;
      }
      setSectionPlane(axisSectionPlane(static_cast<int>(a), view_.section.offset));
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.section_offset";
    c.label = "Section Plane Offset";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    c.schema.push_back(ParamSpec{.name = "offset",
                                 .type = ParamType::Number,
                                 .required = true,
                                 .defaultNumber = 0.0,
                                 .hasDefault = true});
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      SectionPlane p = view_.section;
      p.offset = ctx.params().number("offset").value_or(0.0);
      setSectionPlane(p);
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "view.section_flip";
    c.label = "Flip Section";
    c.category = "View";
    c.sideEffect = SideEffectClass::ViewOnly;
    c.undo = UndoContract::NotUndoable;
    // Flipping a plane that is off changes nothing a user can see, and a menu
    // item that does nothing is how a control stops being trusted.
    c.enabled = [this](const CommandContext&) { return view_.section.enabled; };
    c.execute = [this](CommandContext&) {
      SectionPlane p = view_.section;
      p.flip();
      setSectionPlane(p);
    };
    registry_.add(std::move(c));
  }
  // ── the selection filter, as a COMMAND ────────────────────────────────────
  // The filter is what makes "pick an edge" mean it, and it already exists on
  // SelectionService and in the status strip's combo. What it did not have was a
  // dispatchable id: a macro, a keystroke and an Archie tool call could not
  // change it, so a recorded workflow that fillets an edge could not put the app
  // into edge-picking mode first and would fail on whatever the user had left
  // selected.
  {
    CommandDescriptor c;
    c.id = "select.filter";
    c.label = "Selection Filter";
    c.category = "Selection";
    c.sideEffect = SideEffectClass::Selection;
    c.undo = UndoContract::NotUndoable;
    c.schema.push_back(ParamSpec{.name = "kind",
                                 .type = ParamType::Text,
                                 .required = true,
                                 .defaultText = "any",
                                 .hasDefault = true});
    c.enabled = always;
    c.execute = [this](CommandContext& ctx) {
      const std::string want = ctx.params().text("kind").value_or(std::string("any"));
      const EntityKind kinds[] = {EntityKind::Any,    EntityKind::Vertex, EntityKind::Edge,
                                  EntityKind::Face,   EntityKind::Body,   EntityKind::Sketch,
                                  EntityKind::Wire,   EntityKind::Feature};
      for (EntityKind k : kinds) {
        if (want == toString(k)) {
          selection_.setFilter(k);
          return;
        }
      }
      // NAME the refusal. "something failed" is not actionable by a UI or by a
      // repair loop; the offending spelling is.
      ctx.fail("no selection filter named \"" + want + "\"");
    };
    registry_.add(std::move(c));
  }
  {
    CommandDescriptor c;
    c.id = "select.clear";
    c.label = "Clear Selection";
    c.category = "Selection";
    c.sideEffect = SideEffectClass::Selection;
    c.undo = UndoContract::NotUndoable;
    c.enabled = [this](const CommandContext&) { return selection_.count() > 0; };
    c.execute = [this](CommandContext&) { selection_.clearSelection(); };
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
  if (result.ok()) {
    journal_.push_back(id);
    // ── A COMMAND CHANGES THE PICTURE ───────────────────────────────────────
    // The descriptor already declares whether it touches the document, so the
    // one dispatch path can tell the document's owner to re-derive. A command
    // that only moved the camera or opened a palette must NOT trigger a rebuild,
    // which is why this reads sideEffect rather than firing on every dispatch.
    const CommandDescriptor* d = registry_.find(id);
    if (d != nullptr && d->sideEffect == SideEffectClass::Document &&
        documentHost_ != nullptr) {
      documentHost_->documentChanged();
    }
  }
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
