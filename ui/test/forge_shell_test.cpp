// ui/test/forge_shell_test.cpp
//
// The whole workstation shell, headless: the registry, the typed selection, the
// keymap, the workspaces and the dock layouts driven together the way a session
// drives them. This is where the five contracts are exercised as ONE system
// rather than five units — a menu click, a shortcut and a macro step landing in
// the same journal, a workspace switch keeping the user's picked geometry, and a
// projector being unplugged mid-session without losing a panel.
#include <cstddef>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::at;
using forge::uitest::Harness;

namespace {

// The three seeded document nodes every modelling assertion below selects
// against. They are bound in App::App(), so a selection carrying one of them
// resolves to a real feature-IR value.
constexpr const char* kSketchNode = "sketch_1";
constexpr const char* kSolidNode = "body_1";

EntityRef sketchRef(const std::string& name) {
  return EntityRef{kSketchNode, EntityKind::Sketch, name, 1};
}
EntityRef edgeRef(const std::string& name) {
  return EntityRef{kSolidNode, EntityKind::Edge, name, 1};
}
EntityRef faceRef(const std::string& name) {
  return EntityRef{kSolidNode, EntityKind::Face, name, 1};
}

// ── THE APPLICATION'S SHELL, not a bare one ─────────────────────────────────
//
// ForgeShell on its own registers no modelling command and owns no document:
// that is the point of the DocumentHost seam. The registry the APPLICATION
// builds is ForgeShell's commands PLUS registerPartCommands() over a real
// PartDocument and UndoStack, with the frame installed as the host -- exactly
// what ForgeFrame::wirePartCommands() does. Every assertion about a modelling
// shortcut, about undo, and about "dirty" needs that registry, because the
// counter stubs those assertions used to run against are gone.
//
// This host is the headless equivalent of ForgeFrame: no kernel, no ImGui.
class TestDocumentHost final : public DocumentHost {
 public:
  TestDocumentHost(PartDocument& doc, UndoStack& stack) : doc_(doc), stack_(stack) {}

  bool documentNew(std::string&) override {
    doc_.restore(PartDocument::Snapshot{});
    stack_.clear();
    savedRecords_ = 0;
    path_.clear();
    return true;
  }
  // This stub has no starter part, so New and Reset happen to do the same thing.
  // They are still SEPARATE overrides: a host where they coincide must say so by
  // implementing both, not by inheriting one.
  bool documentReset(std::string& error) override {
    ++resets_;
    return documentNew(error);
  }
  bool documentOpen(const std::string& path, std::string& error) override {
    if (path.empty()) {
      error = "Open needs a path";
      return false;
    }
    path_ = path;
    savedRecords_ = doc_.records().size();
    ++opens_;
    return true;
  }
  bool documentSave(const std::string& path, std::string&) override {
    if (!path.empty()) path_ = path;
    savedRecords_ = doc_.records().size();
    ++saves_;
    return true;
  }
  bool documentUndo() override { return stack_.undo(doc_); }
  bool documentRedo() override { return stack_.redo(doc_); }
  // What ForgeFrame does here is "re-emit the IR, compile it, re-tessellate".
  // Headless, the observable is that it was CALLED, and with what document.
  void documentChanged() override {
    ++changes_;
    seenProgram_ = doc_.irProgram();
  }

  std::size_t documentFeatureCount() const override { return doc_.records().size(); }
  std::size_t documentUndoDepth() const override { return stack_.undoDepth(); }
  std::size_t documentRedoDepth() const override { return stack_.redoDepth(); }
  // A document is modified when it holds statements the last save did not: a
  // witness taken from the document, not a flag somebody has to remember to set.
  bool documentDirty() const override { return doc_.records().size() != savedRecords_; }
  std::string documentPath() const override { return path_; }

  std::size_t changes() const noexcept { return changes_; }
  const std::string& seenProgram() const noexcept { return seenProgram_; }
  // "the document as opened" -- what a freshly seeded document is.
  void markClean() noexcept { savedRecords_ = doc_.records().size(); }
  std::size_t saves() const noexcept { return saves_; }
  std::size_t opens() const noexcept { return opens_; }
  std::size_t resets() const noexcept { return resets_; }

 private:
  std::size_t resets_ = 0;
  PartDocument& doc_;
  UndoStack& stack_;
  std::size_t savedRecords_ = 0;
  std::size_t saves_ = 0;
  std::size_t opens_ = 0;
  std::size_t changes_ = 0;
  std::string seenProgram_;
  std::string path_;
};

struct App {
  PartDocument doc;
  UndoStack stack;
  ForgeShell shell;
  TestDocumentHost host{doc, stack};
  std::size_t shellCommands = 0;
  std::size_t partCommands = 0;

  App() {
    shellCommands = shell.registry().size();
    partCommands = registerPartCommands(shell.registry(), doc, stack);
    // Two values that exist before any command ran, exactly as the Sketch
    // workspace and an import would leave them. Without them no modelling
    // command can resolve a selection, which is the honest state of a shell that
    // has not been given a document.
    doc.seed(IrValueKind::Profile, kSketchNode, "RECT", {IrArg::num(80), IrArg::num(50)});
    doc.seed(IrValueKind::Solid, kSolidNode, "BOX",
             {IrArg::num(80), IrArg::num(50), IrArg::num(20)});
    host.markClean();               // opened, not edited
    shell.setDocumentHost(&host);   // AFTER the seed, so the counters sync to it
  }

  std::size_t features() const { return doc.records().size(); }
  std::string lastLine() const {
    const FeatureRecord* f = doc.lastFeature();
    return f == nullptr ? std::string("<none>") : f->line.text();
  }
};

}  // namespace

int main() {
  Harness H("forge_shell");

  App app;
  ForgeShell& shell = app.shell;

  // ── the SHELL registers no modelling command ────────────────────────────
  // It used to ship model.extrude / model.fillet / model.shell: descriptors with
  // a featureIrOp, a Transaction undo contract and an execute body of four
  // counter increments. The keymap bound every profile's Extrude/Fillet/Shell
  // chord to them, so those keys reported Ok and changed nothing -- and with a
  // DocumentHost installed even the counters were overwritten on the way out of
  // run(). They are retired; the real commands come from the workspace.
  // 22, not 10: the shell also registers app.toggle_theme, app.load_sample and
  // the two view.focus_*_panel commands, and now the seven standard views plus
  // view.selection. Each is a REGISTRY command on purpose -- that is what puts it
  // in the menu, the palette, the keymap and Archie's tool list at once, and a
  // preference, a sample or a camera angle reachable only from a bespoke widget
  // is reachable by exactly one invoker. MEASURED on the merged tree: the two
  // sides of this merge pinned 14 and 18, each having counted only its own half.
  // This count rising does NOT mean a modelling command crept back in -- the
  // four checks below are what assert that, and they are the ones that matter.
  CHECK_EQ_INT(app.shellCommands, 22);
  CHECK(!shell.registry().contains("model.extrude"));
  CHECK(!shell.registry().contains("model.fillet"));
  CHECK(!shell.registry().contains("model.shell"));
  for (const std::string& id : shell.registry().ids()) {
    CHECK(id.rfind("model.", 0) != 0);
  }

  // ── the standard views cannot drift from the enum ────────────────────────
  // ForgeShell registers seven view descriptors with LITERAL ids, because the
  // op-vocabulary generator reads that file as data and refuses an id it cannot
  // read. A hand-written list is only safe if something checks it BOTH WAYS, so:
  // every NamedView has a command, and every `view.<x>` command that is not one
  // of the two framing verbs names a real NamedView.
  for (std::size_t i = 0; i < forge::ui::kNamedViewCount; ++i) {
    const auto v = static_cast<forge::ui::NamedView>(i);
    const std::string id = std::string("view.") + forge::ui::commandSuffix(v);
    CHECK(shell.registry().contains(id));
    const forge::ui::CommandDescriptor* d = shell.registry().find(id);
    CHECK(d != nullptr);
    if (d != nullptr) {
      CHECK_EQ_STR(d->category, "View");
      // A view command must not claim to emit feature-IR: orienting a camera
      // changes no geometry, and a featureIrOp here would make the op
      // vocabulary offer Archie a modelling op that builds nothing.
      CHECK(d->featureIrOp.empty());
      CHECK(d->undo == forge::ui::UndoContract::NotUndoable);
      CHECK(d->sideEffect == forge::ui::SideEffectClass::ViewOnly);
    }
  }
  {
    std::size_t viewCommands = 0;
    for (const std::string& id : shell.registry().ids()) {
      if (id.rfind("view.", 0) != 0) continue;
      ++viewCommands;
      // The `view.*` ids that are NOT camera ORIENTATIONS, and so have no
      // NamedView to round-trip through: three framing/display verbs, plus the
      // two panel-focus commands the shell registers. Named individually rather
      // than skipped by a prefix -- an exemption that matched a pattern would
      // also swallow a genuinely orphaned orientation, which is the one thing
      // this loop exists to catch.
      if (id == "view.fit" || id == "view.selection" || id == "view.wireframe" ||
          id == "view.focus_next_panel" || id == "view.focus_previous_panel") continue;
      forge::ui::NamedView v = forge::ui::NamedView::Front;
      // The reverse direction: no orphan `view.*` orientation command.
      CHECK(forge::ui::namedViewFromSuffix(id.substr(5), v));
      CHECK_EQ_STR(std::string("view.") + forge::ui::commandSuffix(v), id);
    }
    CHECK_EQ_INT(viewCommands, forge::ui::kNamedViewCount + 5);
  }

  // Zoom-to-selection is offered only when something is selected -- it declares
  // a selection signature rather than running and quietly framing nothing.
  {
    const forge::ui::CommandDescriptor* d = shell.registry().find("view.selection");
    CHECK(d != nullptr);
    if (d != nullptr) {
      CHECK(d->signature.kind != forge::ui::EntityKind::None);
      CHECK(d->sideEffect == forge::ui::SideEffectClass::ViewOnly);
    }
  }

  // Each view command bumps the orient counter AND records which view was asked
  // for -- the pull pattern the frame builder reads. A repeat must not be
  // swallowed: pressing Top twice is two requests.
  //
  // Run on a SEPARATE shell. The journal is asserted verbatim further down, and
  // a check that dispatches commands into the shared one would be writing the
  // input to a later assertion -- which is how a test starts passing because of
  // what an earlier test did rather than because of what it claims.
  {
    App viewApp;
    ForgeShell& vs = viewApp.shell;
    CHECK_EQ_INT(vs.document().viewOrientCount, 0);
    CHECK(vs.run("view.top").ok());
    CHECK_EQ_INT(vs.document().viewOrientCount, 1);
    CHECK_EQ_INT(static_cast<int>(vs.document().requestedView),
                 static_cast<int>(forge::ui::NamedView::Top));
    // A REPEAT is a second request, not a swallowed no-op -- the reason this is
    // a counter and not a boolean.
    CHECK(vs.run("view.top").ok());
    CHECK_EQ_INT(vs.document().viewOrientCount, 2);
    CHECK(vs.run("view.back").ok());
    CHECK_EQ_INT(vs.document().viewOrientCount, 3);
    CHECK_EQ_INT(static_cast<int>(vs.document().requestedView),
                 static_cast<int>(forge::ui::NamedView::Back));
    // view.selection rides its OWN counter, so orienting never consumes a
    // pending frame-the-selection request.
    CHECK_EQ_INT(vs.document().selectionFitCount, 0);
    vs.selection().add(sketchRef("Sketch1"));
    CHECK(vs.run("view.selection").ok());
    CHECK_EQ_INT(vs.document().selectionFitCount, 1);
    CHECK_EQ_INT(vs.document().viewOrientCount, 3);
    CHECK_EQ_INT(vs.document().fitCount, 0);
  }
  // and the Part workspace's ribbon category is the one they are filed under
  const std::vector<std::string> partCats = workspaceCategories(WorkspaceProfile::Part);
  bool ribbonHasPart = false;
  for (const std::string& cat : partCats) ribbonHasPart = ribbonHasPart || cat == "Part";
  CHECK(ribbonHasPart);
  CHECK_EQ_INT(shell.registry().idsInCategory("Model").size(), 0);
  CHECK_EQ_INT(shell.registry().idsInCategory("Part").size(), app.partCommands);

  // ── the shipped command set carries the full s19.2 contract ─────────────
  CHECK_EQ_INT(app.partCommands, partCommandIds().size());
  CHECK_EQ_INT(shell.registry().size(), app.shellCommands + app.partCommands);
  const CommandDescriptor* extrude = shell.registry().find("part.extrude");
  CHECK(extrude != nullptr);
  CHECK_EQ_STR(extrude->featureIrOp, "EXTRUDE");
  CHECK_EQ_STR(extrude->category, "Part");
  CHECK_EQ_INT(static_cast<int>(extrude->preview), static_cast<int>(PreviewPolicy::Live));
  CHECK_EQ_INT(static_cast<int>(extrude->undo), static_cast<int>(UndoContract::Transaction));
  CHECK_EQ_INT(static_cast<int>(extrude->sideEffect), static_cast<int>(SideEffectClass::Document));
  CHECK_EQ_INT(extrude->schema.size(), 4);
  CHECK_EQ_STR(extrude->schema[0].name, "distance");
  CHECK(extrude->schema[0].required);
  CHECK_EQ_STR(extrude->signature.describe(), "1..1 sketch (homogeneous)");

  // Every command that edits geometry names the feature-IR op it maps to; a
  // view-only command has none. Archie replays the IR, so a missing mapping is
  // a command Archie cannot use.
  std::size_t documentCommands = 0;
  std::size_t documentCommandsWithIr = 0;
  for (const std::string& id : shell.registry().ids()) {
    const CommandDescriptor* c = shell.registry().find(id);
    if (c->undo == UndoContract::Transaction) {
      ++documentCommands;
      if (!c->featureIrOp.empty()) ++documentCommandsWithIr;
    }
  }
  CHECK_EQ_INT(documentCommands, app.partCommands + 1);  // + edit.delete
  // Every document command emits feature IR EXCEPT the ones that change an EXISTING
  // statement, or the history around it, rather than appending a new one. Each exemption
  // is structural rather than an oversight: part.edit_feature MUTATES one statement's
  // arguments in place, and the seven history operations change WHICH statements the
  // document emits (and in the reorder's case, in what order) -- the statements they act
  // on already carry their own ops. Naming the exemptions INDIVIDUALLY keeps this as
  // strong as the equality it replaces: an op-less document command outside this list
  // still fails here, and so does a listed one that disappears.
  static const char* const kOpLessDocumentCommands[] = {
      "part.delete_feature",  "part.edit_feature",     "part.rename_feature",
      "part.reorder_feature", "part.rollback_end",     "part.rollback_to",
      "part.suppress_feature", "part.unsuppress_feature",
  };
  const std::size_t kOpLessCount =
      sizeof(kOpLessDocumentCommands) / sizeof(kOpLessDocumentCommands[0]);
  std::size_t documentCommandsWithoutIr = 0;
  std::set<std::string> opLessSeen;
  for (const std::string& id : shell.registry().ids()) {
    const CommandDescriptor* c = shell.registry().find(id);
    if (c->undo == UndoContract::Transaction && c->featureIrOp.empty()) {
      ++documentCommandsWithoutIr;
      bool listed = false;
      for (std::size_t k = 0; k < kOpLessCount; ++k) {
        if (id == kOpLessDocumentCommands[k]) listed = true;
      }
      if (!listed) std::printf("  [shell] op-less document command not exempted: %s\n", id.c_str());
      CHECK(listed);
      opLessSeen.insert(id);
    }
  }
  CHECK_EQ_INT(documentCommandsWithoutIr, kOpLessCount);
  CHECK_EQ_INT(opLessSeen.size(), kOpLessCount);
  CHECK_EQ_INT(documentCommandsWithIr, documentCommands - kOpLessCount);

  // ── one dispatch path: shortcut, palette pick and macro step all land ───
  // in the SAME journal, because they all go through run().
  const std::size_t seeded = app.features();
  CHECK_EQ_INT(seeded, 2);
  CommandParams distance;
  distance.setNumber("distance", 25.0);

  // a shortcut
  shell.setInputProfile(InputProfile::NXLike);
  CHECK(shell.key(KeyStroke{"F", maskOf(Mod::Ctrl)}).ran());

  // a palette pick, resolved through the registry's search
  const std::vector<std::string> hits = shell.registry().search("wirefr");
  CHECK_EQ_INT(hits.size(), 1);
  CHECK(shell.run(at(hits, 0)).ok());
  CHECK(shell.document().wireframe);

  // a macro / Archie tool call, by stable ID. The assertion is the STATEMENT the
  // document recorded, not a counter: a command that reported Ok and emitted no
  // IR is exactly what this file used to be asserting on.
  shell.selection().add(sketchRef("Sketch1"));
  CHECK(shell.run("part.extrude", distance).ok());
  CHECK_EQ_INT(app.features(), seeded + 1);
  CHECK_EQ_STR(app.lastLine(), "%3 = EXTRUDE(%1, 25)");
  // and the status strip is READ from that document, not accumulated
  CHECK_EQ_INT(shell.document().features, app.features());

  CHECK_EQ_INT(shell.journal().size(), 3);
  CHECK_EQ_STR(at(shell.journal(), 0), "view.fit");
  CHECK_EQ_STR(at(shell.journal(), 1), "view.wireframe");
  CHECK_EQ_STR(at(shell.journal(), 2), "part.extrude");

  // ── A COMMAND CHANGES THE PICTURE, and only the right ones ──────────────
  // run() calls DocumentHost::documentChanged() after any command that ran and
  // declares sideEffect == Document. The host is the only place that re-derives
  // geometry, so no invoker has a rebuild call to forget -- and view.fit and
  // view.wireframe, which ran just above, must NOT have triggered one.
  CHECK_EQ_INT(app.host.changes(), 1);            // part.extrude, not the two views
  CHECK_EQ_STR(app.host.seenProgram(), app.doc.irProgram());  // and with the NEW program
  CHECK(app.shell.run("view.fit").ok());
  CHECK_EQ_INT(app.host.changes(), 1);            // a view command re-derives nothing
  {
    // A command that dispatches but is REFUSED must not notify either.
    SelectionService saved;
    saved.replaceWith(shell.selection().selection());
    shell.selection().clearSelection();
    const DispatchResult refused = shell.run("part.shell");
    CHECK(!refused.ok());
    CHECK_EQ_INT(app.host.changes(), 1);
    shell.selection().replaceWith(saved.selection());
  }

  // ── the gates hold end to end ───────────────────────────────────────────
  // wrong selection kind for a fillet
  DispatchResult r = shell.run("part.fillet", distance);
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  CHECK_EQ_INT(shell.journal().size(), 4);  // a refused command is NOT journalled
  CHECK_EQ_INT(app.features(), seeded + 1);  // and it recorded nothing

  // right kind, missing the required radius
  shell.selection().replaceWith({edgeRef("E1")});
  r = shell.run("part.fillet");
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::MissingRequiredParameter));

  CommandParams radius;
  radius.setNumber("radius", 3.0);
  CHECK(shell.run("part.fillet", radius).ok());
  CHECK_EQ_INT(app.features(), seeded + 2);
  CHECK_EQ_STR(app.lastLine(), "%4 = FILLET(%2, 3, ALL)");
  CHECK_EQ_INT(shell.document().features, app.features());
  CHECK_EQ_INT(shell.document().undoDepth, 2);

  // undo is gated by the enabled predicate, all the way down to zero -- and it
  // unwinds the DOCUMENT, so the statement really leaves the program.
  CHECK(shell.run("edit.undo").ok());
  CHECK_EQ_STR(app.lastLine(), "%3 = EXTRUDE(%1, 25)");
  CHECK(shell.run("edit.undo").ok());
  CHECK_EQ_INT(shell.document().undoDepth, 0);
  CHECK_EQ_INT(app.features(), seeded);
  r = shell.run("edit.undo");
  CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_INT(shell.document().redoDepth, 2);
  CHECK(shell.run("edit.redo").ok());
  CHECK_EQ_INT(app.features(), seeded + 1);
  CHECK_EQ_STR(app.lastLine(), "%3 = EXTRUDE(%1, 25)");

  // ── with NO document there is nothing to undo, and it says so ───────────
  // This used to run a private counter fallback and answer Ok.
  {
    ForgeShell bare;
    CHECK(bare.documentHost() == nullptr);
    CHECK_EQ_INT(static_cast<int>(bare.run("edit.undo").status),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(static_cast<int>(bare.run("edit.redo").status),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(bare.journal().size(), 0);
  }

  // save is offered only when the document is dirty
  {
    App fresh;
    CHECK_EQ_INT(static_cast<int>(fresh.shell.run("file.save").status),
                 static_cast<int>(DispatchStatus::Disabled));
    fresh.shell.selection().add(sketchRef("S1"));
    CHECK(fresh.shell.run("part.extrude", distance).ok());
    CHECK(fresh.shell.document().dirty);
    CHECK(fresh.shell.run("file.save").ok());
    CHECK_EQ_INT(fresh.host.saves(), 1);
    CHECK(!fresh.shell.document().dirty);
    CHECK_EQ_INT(static_cast<int>(fresh.shell.run("file.save").status),
                 static_cast<int>(DispatchStatus::Disabled));
  }

  // ── workspaces ──────────────────────────────────────────────────────────
  CHECK_EQ_INT(static_cast<int>(shell.workspace()), static_cast<int>(WorkspaceProfile::Part));
  CHECK(shell.layout().hasPanel("feature_tree"));
  CHECK(!shell.layout().hasPanel("archie_chat"));

  // the user tears a panel off onto a second monitor
  DockWindow torn;
  torn.id = 7;
  torn.monitor = 2;
  torn.rect = Rect{2600.0, 60.0, 900.0, 700.0};
  torn.root = DockNode::tabs({"scratch_notes"}, 0);
  shell.layout().addWindow(torn);
  CHECK_EQ_INT(shell.layout().windowCount(), 2);
  CHECK(shell.layout().valid());

  // switching workspace swaps the layout but keeps the user's picked geometry
  const std::size_t selectedBefore = shell.selection().count();
  CHECK_EQ_INT(selectedBefore, 1);
  shell.setWorkspace(WorkspaceProfile::Archie);
  CHECK_EQ_INT(static_cast<int>(shell.workspace()), static_cast<int>(WorkspaceProfile::Archie));
  CHECK(shell.layout().hasPanel("archie_chat"));
  CHECK(!shell.layout().hasPanel("scratch_notes"));
  CHECK_EQ_INT(shell.layout().windowCount(), 1);
  CHECK_EQ_INT(shell.selection().count(), selectedBefore);  // selection is NOT a layout concern

  // coming back restores the torn-off window, not the factory default
  shell.setWorkspace(WorkspaceProfile::Part);
  CHECK_EQ_INT(shell.layout().windowCount(), 2);
  CHECK(shell.layout().hasPanel("scratch_notes"));

  // and reset really does go back to the deterministic default
  shell.resetWorkspaceLayout();
  CHECK_EQ_INT(shell.layout().windowCount(), 1);
  CHECK(!shell.layout().hasPanel("scratch_notes"));
  CHECK_EQ_STR(shell.layout().serialize(), defaultLayout(WorkspaceProfile::Part).serialize());

  // workspace.next walks the eight profiles through the SAME command path
  shell.setWorkspace(WorkspaceProfile::Part);
  for (std::size_t i = 0; i < allWorkspaceProfiles().size(); ++i) {
    CHECK(shell.run("workspace.next").ok());
  }
  CHECK_EQ_INT(static_cast<int>(shell.workspace()), static_cast<int>(WorkspaceProfile::Part));

  // ── a monitor is unplugged mid-session ──────────────────────────────────
  ForgeShell docked;
  DockWindow second;
  second.id = 2;
  second.monitor = 2;
  second.rect = Rect{2600.0, 40.0, 1000.0, 900.0};
  second.root = DockNode::tabs({"archie_chat", "archie_trace"}, 0);
  docked.layout().addWindow(second);
  const std::size_t panelsBefore = docked.layout().panelCount();

  const RecoveryReport report = docked.monitorsChanged(
      {MonitorInfo{1, Rect{0.0, 0.0, 1920.0, 1080.0}, true, 1.0}});
  CHECK_EQ_INT(report.windowsMoved, 1);
  CHECK(report.panelsPreserved());
  CHECK_EQ_INT(docked.layout().panelCount(), panelsBefore);
  CHECK(docked.layout().hasPanel("archie_chat"));
  const Rect survivingWorkArea{0.0, 0.0, 1920.0, 1080.0};
  for (const DockWindow& w : docked.layout().windows()) {
    CHECK_EQ_INT(w.monitor, 1);
    CHECK(survivingWorkArea.contains(w.rect));
  }

  // ── the whole session state round-trips ─────────────────────────────────
  ForgeShell session;
  session.setInputProfile(InputProfile::BlenderLike);
  session.setWorkspace(WorkspaceProfile::Manufacturing);
  DockWindow extra;
  extra.id = 5;
  extra.monitor = 2;
  extra.rect = Rect{2600.0, 0.0, 600.0, 400.0};
  extra.root = DockNode::tabs({"probe_results"}, 0);
  session.layout().addWindow(extra);

  const std::string state = session.saveState();
  ForgeShell restored;
  CHECK(restored.loadState(state));
  CHECK_EQ_INT(static_cast<int>(restored.workspace()),
               static_cast<int>(WorkspaceProfile::Manufacturing));
  CHECK_EQ_INT(static_cast<int>(restored.inputProfile()),
               static_cast<int>(InputProfile::BlenderLike));
  CHECK(restored.layout() == session.layout());
  CHECK(restored.layout().hasPanel("probe_results"));
  CHECK_EQ_STR(restored.saveState(), state);  // byte-identical second time round

  // the restored session's shortcuts still reach the one registry
  CHECK(restored.key(KeyStroke{"Home"}).ran());
  CHECK_EQ_INT(restored.document().fitCount, 1);

  // corrupt state is refused outright rather than half-applied
  ForgeShell guard;
  guard.setWorkspace(WorkspaceProfile::Drawing);
  const std::string before = guard.saveState();
  CHECK(!guard.loadState("forge-shell 2\n"));
  CHECK(!guard.loadState("forge-shell 1\nworkspace not_a_workspace\n"));
  CHECK(!guard.loadState("forge-shell 1\nworkspace part\ninput nx-like\nlayout part\ngarbage\n.\n"));
  CHECK(!guard.loadState("forge-shell 1\nworkspace part\ninput nx-like\n"));  // no keymap section
  CHECK_EQ_STR(guard.saveState(), before);  // nothing moved

  // ── REGRESSION: a keyboard-bound command with a REQUIRED parameter RUNS ──
  // Two defects meet here, and both were invisible from the keyboard.
  //
  //   (1) ForgeShell::key() used to dispatch with a default-constructed
  //       CommandParams, so every shortcut whose command declares a required
  //       parameter died on missing_required_parameter before the handler ran.
  //   (2) The Extrude/Fillet/Shell chords named model.* -- ForgeShell counter
  //       stubs -- so even after (1) was fixed the keys emitted no feature-IR.
  //
  // The chords now name the Part workspace's real commands, and the assertion is
  // THE STATEMENT THE DOCUMENT RECORDED. A counter cannot satisfy it.
  {
    App nx;
    nx.shell.setInputProfile(InputProfile::NXLike);
    const std::size_t base = nx.features();
    nx.shell.selection().add(sketchRef("Sketch1"));
    const KeyOutcome pressX = nx.shell.key(KeyStroke{"X"});  // NX-like Extrude
    CHECK_EQ_INT(static_cast<int>(pressX.resolve), static_cast<int>(ResolveStatus::Bound));
    CHECK_EQ_STR(pressX.commandId, "part.extrude");
    CHECK_EQ_INT(static_cast<int>(pressX.dispatch.status), static_cast<int>(DispatchStatus::Ok));
    CHECK(pressX.ran());
    CHECK_EQ_INT(nx.features(), base + 1);
    // the schema default really reached the handler, it was not merely skipped:
    // distance 10 is in the emitted statement
    CHECK_EQ_STR(nx.lastLine(), "%3 = EXTRUDE(%1, 10)");
    CHECK_EQ_INT(nx.shell.document().features, nx.features());
    CHECK_EQ_INT(nx.shell.document().undoDepth, 1);
    CHECK(nx.shell.document().dirty);
    CHECK_EQ_INT(nx.shell.journal().size(), 1);
    CHECK_EQ_STR(at(nx.shell.journal(), 0), "part.extrude");
    CHECK(!pressX.needsParameters());

    nx.shell.selection().replaceWith({edgeRef("E1")});
    const KeyOutcome pressB = nx.shell.key(KeyStroke{"B", maskOf(Mod::Ctrl)});  // NX Fillet
    CHECK(pressB.ran());
    CHECK_EQ_INT(nx.features(), base + 2);
    CHECK_EQ_STR(nx.lastLine(), "%4 = FILLET(%2, 1, ALL)");

    nx.shell.selection().replaceWith({faceRef("F1")});
    const KeyOutcome pressH = nx.shell.key(KeyStroke{"H", maskOf(Mod::Ctrl)});  // NX Shell
    CHECK(pressH.ran());
    CHECK_EQ_INT(nx.features(), base + 3);
    CHECK_EQ_STR(nx.lastLine(), "%5 = SHELL(%4, 2)");

    // an EXPLICIT argument still wins over the default
    nx.shell.selection().replaceWith({edgeRef("E2")});
    CHECK(nx.shell
              .invoke("part.fillet",
                      [] {
                        CommandParams p;
                        p.setNumber("radius", 7.5);
                        return p;
                      }())
              .ran());
    CHECK_EQ_STR(nx.lastLine(), "%6 = FILLET(%5, 7.5, ALL)");

    // three shortcuts and one explicit invocation, all in the SAME journal
    CHECK_EQ_INT(nx.shell.journal().size(), 4);
    CHECK_EQ_STR(at(nx.shell.journal(), 1), "part.fillet");
    CHECK_EQ_STR(at(nx.shell.journal(), 2), "part.shell");
    CHECK_EQ_STR(at(nx.shell.journal(), 3), "part.fillet");
  }
  // the same three commands, reached from every profile's own chord, each one
  // emitting a real statement into a real document
  {
    struct Case {
      InputProfile profile;
      KeyStroke stroke;
      const char* id;
      const char* statement;
    };
    const std::vector<Case> cases = {
        {InputProfile::ForgeNative, KeyStroke{"E", 0}, "part.extrude", "%3 = EXTRUDE(%1, 10)"},
        {InputProfile::ForgeNative, KeyStroke{"R", 0}, "part.fillet", "%3 = FILLET(%2, 1, ALL)"},
        {InputProfile::ForgeNative, KeyStroke{"H", Mod::Ctrl | Mod::Shift}, "part.shell", "%3 = SHELL(%2, 2)"},
        {InputProfile::NXLike, KeyStroke{"X", 0}, "part.extrude", "%3 = EXTRUDE(%1, 10)"},
        {InputProfile::NXLike, KeyStroke{"B", maskOf(Mod::Ctrl)}, "part.fillet", "%3 = FILLET(%2, 1, ALL)"},
        {InputProfile::NXLike, KeyStroke{"H", maskOf(Mod::Ctrl)}, "part.shell", "%3 = SHELL(%2, 2)"},
        {InputProfile::CATIALike, KeyStroke{"P", maskOf(Mod::Ctrl)}, "part.extrude", "%3 = EXTRUDE(%1, 10)"},
        {InputProfile::CATIALike, KeyStroke{"F", Mod::Ctrl | Mod::Shift}, "part.fillet", "%3 = FILLET(%2, 1, ALL)"},
        {InputProfile::CATIALike, KeyStroke{"F8", 0}, "part.shell", "%3 = SHELL(%2, 2)"},
        {InputProfile::BlenderLike, KeyStroke{"E", 0}, "part.extrude", "%3 = EXTRUDE(%1, 10)"},
        {InputProfile::BlenderLike, KeyStroke{"B", maskOf(Mod::Ctrl)}, "part.fillet", "%3 = FILLET(%2, 1, ALL)"},
        {InputProfile::BlenderLike, KeyStroke{"I", maskOf(Mod::Alt)}, "part.shell", "%3 = SHELL(%2, 2)"},
    };
    for (const Case& c : cases) {
      App a;
      a.shell.setInputProfile(c.profile);
      const std::size_t base = a.features();
      if (std::string(c.id) == "part.extrude") {
        a.shell.selection().replaceWith({sketchRef("S1")});
      } else if (std::string(c.id) == "part.fillet") {
        a.shell.selection().replaceWith({edgeRef("E1")});
      } else {
        a.shell.selection().replaceWith({faceRef("F1")});
      }
      const KeyOutcome o = a.shell.key(c.stroke);
      CHECK_EQ_STR(o.commandId, c.id);
      CHECK_EQ_INT(static_cast<int>(o.dispatch.status), static_cast<int>(DispatchStatus::Ok));
      CHECK_EQ_INT(a.features(), base + 1);
      CHECK_EQ_STR(a.lastLine(), c.statement);
    }
  }
  // A required parameter with NO honest default is not invented: Ctrl+O reports
  // what the UI must prompt for instead of opening the empty path.
  {
    ForgeShell open;
    open.setInputProfile(InputProfile::ForgeNative);
    const KeyOutcome o = open.key(KeyStroke{"O", maskOf(Mod::Ctrl)});
    CHECK_EQ_STR(o.commandId, "file.open");
    CHECK(!o.ran());
    CHECK_EQ_INT(static_cast<int>(o.dispatch.status),
                 static_cast<int>(DispatchStatus::MissingRequiredParameter));
    CHECK_EQ_INT(open.journal().size(), 0);
    // ...and it says WHAT to ask for, which is what a UI can act on
    CHECK(o.needsParameters());
    CHECK_EQ_INT(o.promptFor.size(), 1);
    CHECK_EQ_STR(at(o.promptFor, 0), "path");
    // supplying it makes the same command run through the same path
    CommandParams path;
    path.setText("path", "/tmp/part.forge");
    const InvokeOutcome ok = open.invoke("file.open", path);
    CHECK(ok.ran());
    CHECK(!ok.needsParameters());
    CHECK_EQ_INT(open.journal().size(), 1);
  }

  // ── REGRESSION: a workspace switch must not corrupt a panel ID ──────────
  // setWorkspace() round-trips the outgoing layout through serialize/parse.
  // Panel IDs were written space-separated with no quoting, so "Scratch Notes"
  // came back as "Scratch" and the rest of the stream desynchronised.
  {
    ForgeShell named;
    DockWindow note;
    note.id = 4;
    note.monitor = 1;
    note.rect = Rect{10.0, 10.0, 400.0, 300.0};
    note.root = DockNode::tabs({"Scratch Notes"}, 0);
    named.layout().addWindow(note);
    CHECK(named.layout().valid());
    const DockLayout saved = named.layout();
    CHECK(named.setWorkspace(WorkspaceProfile::Sketch));  // the round trip is CHECKED
    CHECK(named.setWorkspace(WorkspaceProfile::Part));
    CHECK_EQ_INT(named.layout().windowCount(), 2);
    CHECK(named.layout().hasPanel("Scratch Notes"));
    CHECK(named.layout() == saved);
  }

  return H.finish();
}
