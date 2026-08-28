// ui/test/forge_shell_test.cpp
//
// The whole workstation shell, headless: the registry, the typed selection, the
// keymap, the workspaces and the dock layouts driven together the way a session
// drives them. This is where the five contracts are exercised as ONE system
// rather than five units — a menu click, a shortcut and a macro step landing in
// the same journal, a workspace switch keeping the user's picked geometry, and a
// projector being unplugged mid-session without losing a panel.
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::at;
using forge::uitest::Harness;

namespace {

EntityRef sketchRef(const std::string& name) {
  return EntityRef{"body_1", EntityKind::Sketch, name, 1};
}
EntityRef edgeRef(const std::string& name) {
  return EntityRef{"body_1", EntityKind::Edge, name, 1};
}
EntityRef faceRef(const std::string& name) {
  return EntityRef{"body_1", EntityKind::Face, name, 1};
}

}  // namespace

int main() {
  Harness H("forge_shell");

  ForgeShell shell;

  // ── the shipped command set carries the full s19.2 contract ─────────────
  CHECK_EQ_INT(shell.registry().size(), 13);
  const CommandDescriptor* extrude = shell.registry().find("model.extrude");
  CHECK(extrude != nullptr);
  CHECK_EQ_STR(extrude->featureIrOp, "EXTRUDE");
  CHECK_EQ_STR(extrude->category, "Model");
  CHECK_EQ_INT(static_cast<int>(extrude->preview), static_cast<int>(PreviewPolicy::Live));
  CHECK_EQ_INT(static_cast<int>(extrude->undo), static_cast<int>(UndoContract::Transaction));
  CHECK_EQ_INT(static_cast<int>(extrude->sideEffect), static_cast<int>(SideEffectClass::Document));
  CHECK_EQ_INT(extrude->schema.size(), 1);
  CHECK_EQ_STR(extrude->schema[0].name, "distance");
  CHECK(extrude->schema[0].required);
  CHECK_EQ_STR(extrude->signature.describe(), "1..n sketch (homogeneous)");

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
  CHECK_EQ_INT(documentCommands, 4);
  CHECK_EQ_INT(documentCommandsWithIr, 4);

  // ── one dispatch path: shortcut, palette pick and macro step all land ───
  // in the SAME journal, because they all go through run().
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

  // a macro / Archie tool call, by stable ID
  shell.selection().add(sketchRef("Sketch1"));
  CHECK(shell.run("model.extrude", distance).ok());
  CHECK_EQ_INT(shell.document().features, 1);

  CHECK_EQ_INT(shell.journal().size(), 3);
  CHECK_EQ_STR(at(shell.journal(), 0), "view.fit");
  CHECK_EQ_STR(at(shell.journal(), 1), "view.wireframe");
  CHECK_EQ_STR(at(shell.journal(), 2), "model.extrude");

  // ── the gates hold end to end ───────────────────────────────────────────
  // wrong selection kind for a fillet
  DispatchResult r = shell.run("model.fillet", distance);
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  CHECK_EQ_INT(shell.journal().size(), 3);  // a refused command is NOT journalled

  // right kind, missing the required radius
  shell.selection().replaceWith({edgeRef("E1")});
  r = shell.run("model.fillet");
  CHECK_EQ_INT(static_cast<int>(r.status),
               static_cast<int>(DispatchStatus::MissingRequiredParameter));

  CommandParams radius;
  radius.setNumber("radius", 3.0);
  CHECK(shell.run("model.fillet", radius).ok());
  CHECK_EQ_INT(shell.document().features, 2);
  CHECK_EQ_INT(shell.document().undoDepth, 2);

  // undo is gated by the enabled predicate, all the way down to zero
  CHECK(shell.run("edit.undo").ok());
  CHECK(shell.run("edit.undo").ok());
  CHECK_EQ_INT(shell.document().undoDepth, 0);
  CHECK_EQ_INT(shell.document().features, 0);
  r = shell.run("edit.undo");
  CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_INT(shell.document().redoDepth, 2);
  CHECK(shell.run("edit.redo").ok());
  CHECK_EQ_INT(shell.document().features, 1);

  // save is offered only when the document is dirty
  ForgeShell fresh;
  CHECK_EQ_INT(static_cast<int>(fresh.run("file.save").status),
               static_cast<int>(DispatchStatus::Disabled));
  fresh.selection().add(sketchRef("S1"));
  CHECK(fresh.run("model.extrude", distance).ok());
  CHECK(fresh.document().dirty);
  CHECK(fresh.run("file.save").ok());
  CHECK(!fresh.document().dirty);
  CHECK_EQ_INT(static_cast<int>(fresh.run("file.save").status),
               static_cast<int>(DispatchStatus::Disabled));

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
  // ForgeShell::key() used to dispatch with a default-constructed CommandParams,
  // so every shortcut whose command declares a required parameter died on
  // missing_required_parameter before the handler was ever called. Four of the
  // thirteen shipped commands are in that class, in all four input profiles.
  // These checks assert the DOCUMENT MUTATED, not that the command is registered.
  {
    ForgeShell nx;
    nx.setInputProfile(InputProfile::NXLike);
    nx.selection().add(sketchRef("Sketch1"));
    const KeyOutcome pressX = nx.key(KeyStroke{"X"});  // NX-like Extrude
    CHECK_EQ_INT(static_cast<int>(pressX.resolve), static_cast<int>(ResolveStatus::Bound));
    CHECK_EQ_STR(pressX.commandId, "model.extrude");
    CHECK_EQ_INT(static_cast<int>(pressX.dispatch.status), static_cast<int>(DispatchStatus::Ok));
    CHECK(pressX.ran());
    CHECK_EQ_INT(nx.document().features, 1);
    CHECK_EQ_INT(nx.document().undoDepth, 1);
    CHECK(nx.document().dirty);
    CHECK_EQ_INT(nx.journal().size(), 1);
    CHECK_EQ_STR(at(nx.journal(), 0), "model.extrude");
    // the schema default really reached the handler, it was not merely skipped
    CHECK_NEAR(nx.document().lastFeatureSize, 10.0, 1e-9);
    CHECK(!pressX.needsParameters());

    nx.selection().replaceWith({edgeRef("E1")});
    const KeyOutcome pressB = nx.key(KeyStroke{"B", maskOf(Mod::Ctrl)});  // NX-like Fillet
    CHECK(pressB.ran());
    CHECK_EQ_INT(nx.document().features, 2);
    CHECK_NEAR(nx.document().lastFeatureSize, 1.0, 1e-9);

    nx.selection().replaceWith({faceRef("F1")});
    const KeyOutcome pressH = nx.key(KeyStroke{"H", maskOf(Mod::Ctrl)});  // NX-like Shell
    CHECK(pressH.ran());
    CHECK_EQ_INT(nx.document().features, 3);
    CHECK_NEAR(nx.document().lastFeatureSize, 2.0, 1e-9);
    // an EXPLICIT argument still wins over the default
    nx.selection().replaceWith({edgeRef("E2")});
    CHECK(nx.invoke("model.fillet", [] {
                CommandParams p;
                p.setNumber("radius", 7.5);
                return p;
              }())
              .ran());
    CHECK_NEAR(nx.document().lastFeatureSize, 7.5, 1e-9);

    // three shortcuts and one explicit invocation, all in the SAME journal
    CHECK_EQ_INT(nx.journal().size(), 4);
    CHECK_EQ_STR(at(nx.journal(), 1), "model.fillet");
    CHECK_EQ_STR(at(nx.journal(), 2), "model.shell");
    CHECK_EQ_STR(at(nx.journal(), 3), "model.fillet");
  }
  // the same four commands, reached from every profile's own chord
  {
    struct Case {
      InputProfile profile;
      KeyStroke stroke;
      const char* id;
    };
    const std::vector<Case> cases = {
        {InputProfile::ForgeNative, KeyStroke{"E", 0}, "model.extrude"},
        {InputProfile::ForgeNative, KeyStroke{"R", 0}, "model.fillet"},
        {InputProfile::ForgeNative, KeyStroke{"H", Mod::Ctrl | Mod::Shift}, "model.shell"},
        {InputProfile::NXLike, KeyStroke{"X", 0}, "model.extrude"},
        {InputProfile::NXLike, KeyStroke{"B", maskOf(Mod::Ctrl)}, "model.fillet"},
        {InputProfile::NXLike, KeyStroke{"H", maskOf(Mod::Ctrl)}, "model.shell"},
        {InputProfile::CATIALike, KeyStroke{"P", maskOf(Mod::Ctrl)}, "model.extrude"},
        {InputProfile::CATIALike, KeyStroke{"F", Mod::Ctrl | Mod::Shift}, "model.fillet"},
        {InputProfile::CATIALike, KeyStroke{"F8", 0}, "model.shell"},
        {InputProfile::BlenderLike, KeyStroke{"E", 0}, "model.extrude"},
        {InputProfile::BlenderLike, KeyStroke{"B", maskOf(Mod::Ctrl)}, "model.fillet"},
        {InputProfile::BlenderLike, KeyStroke{"I", maskOf(Mod::Alt)}, "model.shell"},
    };
    for (const Case& c : cases) {
      ForgeShell s;
      s.setInputProfile(c.profile);
      if (std::string(c.id) == "model.extrude") {
        s.selection().replaceWith({sketchRef("S1")});
      } else if (std::string(c.id) == "model.fillet") {
        s.selection().replaceWith({edgeRef("E1")});
      } else {
        s.selection().replaceWith({faceRef("F1")});
      }
      const KeyOutcome o = s.key(c.stroke);
      CHECK_EQ_STR(o.commandId, c.id);
      CHECK_EQ_INT(static_cast<int>(o.dispatch.status), static_cast<int>(DispatchStatus::Ok));
      CHECK_EQ_INT(s.document().features, 1);
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
