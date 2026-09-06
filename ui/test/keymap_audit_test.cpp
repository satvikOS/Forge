// ui/test/keymap_audit_test.cpp — CAN THE KEYBOARD REACH EVERY COMMAND?
//
// Two separate questions, and conflating them is how the defect below survived:
//
//   1. Is there a KEY SEQUENCE for this command?  (a property of the map)
//   2. Can a bare GESTURE dispatch it?            (a property of the schema)
//
// A command can fail (2) while passing (1), and that is the silent case: the key
// is bound, the user presses it, the shell resolves it, and dispatch dies on
// missing_required_parameter with the handler never called. `ParamSpec` is an
// aggregate whose braced-positional form — ParamSpec{"width", Number, true,
// 40.0, ""} — stops at defaultText, one member short of `hasDefault`, so twelve
// commands declared a perfectly good default in `defaultNumber` that
// applyDefaults() was forbidden to read. They are fixed; this gate is what stops
// the thirteenth, because gestureBlockedCommands() is DERIVED and a command that
// grows a defaultless required parameter joins the pinned list by itself.
//
// Question (1) had its own hole. bindUnboundCommands() was written to close it
// and NOTHING CALLED IT — 128 of the 180 command/profile slots were empty in the
// shipped map. Block (d) drives ForgeShell::completeKeymap(), the invoker, and
// block (e) proves the generated chord actually DISPATCHES rather than merely
// resolving: a symbol reference is not a call path, and a binding is not a
// keystroke that works.
#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "forge/ui/KeymapAudit.hpp"
#include "forge/ui/PartCommands.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

struct App {
  ForgeShell shell;
  PartDocument document;
  UndoStack stack;
  App() { registerPartCommands(shell.registry(), document, stack); }
};

bool contains(const std::vector<std::string>& v, const std::string& s) {
  return std::find(v.begin(), v.end(), s) != v.end();
}

// Every profile/command slot that has at least one binding.
std::size_t boundSlots(const Keymap& keymap, const CommandRegistry& registry) {
  std::size_t n = 0;
  for (InputProfile p : allInputProfiles()) {
    for (const std::string& id : registry.ids()) {
      if (!keymap.shortcutsFor(p, id).empty()) ++n;
    }
  }
  return n;
}

}  // namespace

int main() {
  forge::uitest::Harness H("keymap_audit");

  // ── (a) THE GESTURE-BLOCKED LIST, PINNED ─────────────────────────────────
  // Exactly six commands in the whole application registry cannot be run by a
  // bare keystroke or menu click, and every one of them is honest: a file path
  // has no default ("" is not a document), and "the new value of this parameter"
  // has none either — inventing one would let a menu click silently resize the
  // part. Pinned by NAME, deliberately: a count would go on passing while the
  // identity of the blocked command changed underneath it.
  //
  // FOUR of the six arrived with file exchange (file.import_step / .import_brep,
  // file.export_step / .export_brep) and they are blocked for the SAME reason
  // file.open always has been: each takes a required `path` of type Text whose
  // ParamSpec declares hasDefault=false, which the header defines as "a fillet
  // radius has an honest default; a file path does not". There is no native file
  // dialog in Forge yet, so a path parameter is the honest interim and being
  // reported here is exactly the right outcome -- GestureBlocked is a FACT ABOUT
  // A SCHEMA, not a defect in the keymap, and this gate exists to say so.
  {
    App app;
    const std::vector<std::string> blocked = gestureBlockedCommands(app.shell.registry());
    CHECK_EQ_INT(blocked.size(), 7);
    CHECK_EQ_STR(forge::uitest::at(blocked, 0), "file.export_brep");
    CHECK_EQ_STR(forge::uitest::at(blocked, 1), "file.export_step");
    CHECK_EQ_STR(forge::uitest::at(blocked, 2), "file.import_brep");
    CHECK_EQ_STR(forge::uitest::at(blocked, 3), "file.import_step");
    CHECK_EQ_STR(forge::uitest::at(blocked, 4), "file.open");
    CHECK_EQ_STR(forge::uitest::at(blocked, 5), "part.edit_feature");
    // The SEVENTH is part.set_material, blocked for the third distinct honest
    // reason on this list: a part being designed has no default material, and
    // filling one in would let a bare keystroke decide the part is aluminium and
    // change what it weighs. The Materials panel names the choice; the keyboard
    // asks for it.
    CHECK_EQ_STR(forge::uitest::at(blocked, 6), "part.set_material");
    // And each of the four names its own unfillable parameter, so the list is
    // not four ids that merely happen to sort into place.
    for (const char* id : {"file.import_step", "file.import_brep", "file.export_step",
                           "file.export_brep"}) {
      const CommandDescriptor* d = app.shell.registry().find(id);
      CHECK(d != nullptr);
      if (d == nullptr) continue;
      const std::vector<std::string> unfillable = unfillableParameters(*d);
      CHECK_EQ_INT(unfillable.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(unfillable, 0), "path");
      CHECK(!keyboardInvocable(*d));
    }

    // And the reason is the PARAMETER, named — a list of ids with no cause is
    // not something a reader can act on.
    const CommandDescriptor* open = app.shell.registry().find("file.open");
    CHECK(open != nullptr);
    if (open != nullptr) {
      const std::vector<std::string> unfillable = unfillableParameters(*open);
      CHECK_EQ_INT(unfillable.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(unfillable, 0), "path");
      CHECK(!keyboardInvocable(*open));
    }
    const CommandDescriptor* edit = app.shell.registry().find("part.edit_feature");
    CHECK(edit != nullptr);
    if (edit != nullptr) {
      const std::vector<std::string> unfillable = unfillableParameters(*edit);
      CHECK_EQ_INT(unfillable.size(), 1);
      CHECK_EQ_STR(forge::uitest::at(unfillable, 0), "value");
    }

    // Everything else IS gesture-invocable, and that is asserted over the whole
    // registry rather than sampled.
    for (const std::string& id : app.shell.registry().ids()) {
      const CommandDescriptor* d = app.shell.registry().find(id);
      if (d == nullptr) continue;
      CHECK_EQ_INT(static_cast<int>(keyboardInvocable(*d)),
                   static_cast<int>(!contains(blocked, id)));
    }
  }

  // ── (b) the audit answers with the DISPATCHER'S arithmetic ───────────────
  // unfillableParameters() must be applyDefaults()/missingRequired() and not a
  // re-implementation of them, or the audit and the shell drift and the audit
  // becomes the more convincing of the two. Driven over every command.
  {
    App app;
    for (const std::string& id : app.shell.registry().ids()) {
      const CommandDescriptor* d = app.shell.registry().find(id);
      if (d == nullptr) continue;
      const CommandParams filled = applyDefaults(*d, CommandParams{});
      const std::vector<std::string> want = missingRequired(*d, filled);
      const std::vector<std::string> got = unfillableParameters(*d);
      CHECK_EQ_INT(got.size(), want.size());
      for (std::size_t i = 0; i < got.size() && i < want.size(); ++i) {
        CHECK_EQ_STR(got[i], want[i]);
      }
      // And the shell's own interactive path agrees, end to end.
      const InvokeOutcome outcome = app.shell.invoke(id);
      CHECK_EQ_INT(outcome.promptFor.size(), want.size());
      CHECK_EQ_INT(static_cast<int>(outcome.needsParameters()), static_cast<int>(!want.empty()));
    }
  }

  // ── (c) the SHIPPED map is incomplete, and the audit says exactly how ─────
  // Measured, not assumed: this is the state a user actually gets before
  // completeKeymap() runs, and it is what makes block (d) a change rather than a
  // restatement.
  {
    App app;
    const KeymapReport rep = app.shell.keymapReport();
    CHECK_EQ_INT(rep.registryCommands, app.shell.registry().size());
    CHECK_EQ_INT(rep.bindings, app.shell.keymap().bindingCount());
    CHECK(!rep.complete());
    CHECK(rep.count(BindingIssueKind::Unbound) > 0);
    // No DEAD keys: every binding in every shipped profile names a command the
    // application registry really holds. This is the check that caught the
    // model.* -> part.* rename when the stubs were retired.
    CHECK_EQ_INT(rep.count(BindingIssueKind::UnknownCommand), 0);
    CHECK_EQ_INT(rep.count(BindingIssueKind::GestureBlocked), 7);
    // The shipped defaults bind the same 13 commands in all four profiles, so
    // there is no ProfileGap yet: a gap needs a command bound HERE and not
    // THERE. Unbound and ProfileGap are raised instead of each other, never
    // both, or every hole would be counted twice.
    CHECK_EQ_INT(rep.count(BindingIssueKind::ProfileGap), 0);
    CHECK_EQ_INT(rep.boundEverywhere, 13);
    CHECK_EQ_INT(rep.count(BindingIssueKind::Unbound) + rep.boundEverywhere * 4,
                 app.shell.registry().size() * 4);
    CHECK(!rep.render().empty());
    // Each issue says what to do about it. A report of bare ids is a list, not
    // an audit.
    for (const BindingIssue& issue : rep.issues) {
      CHECK(!issue.detail.empty());
      CHECK(!issue.describe().empty());
      CHECK(!issue.commandId.empty());
    }
  }

  // ── (d) completeKeymap() FINISHES it, and the audit agrees ───────────────
  {
    App app;
    const std::size_t before = app.shell.keymap().bindingCount();
    const std::size_t commands = app.shell.registry().size();
    const std::size_t added = app.shell.completeKeymap();

    CHECK(added > 0);
    CHECK_EQ_INT(app.shell.keymap().bindingCount(), before + added);
    // The target: every command, in every profile.
    CHECK_EQ_INT(app.shell.keymap().bindingCount(), commands * allInputProfiles().size());
    CHECK_EQ_INT(boundSlots(app.shell.keymap(), app.shell.registry()),
                 commands * allInputProfiles().size());

    const KeymapReport rep = app.shell.keymapReport();
    CHECK(rep.complete());
    CHECK_EQ_INT(rep.boundEverywhere, commands);
    CHECK_EQ_INT(rep.count(BindingIssueKind::Unbound), 0);
    CHECK_EQ_INT(rep.count(BindingIssueKind::ProfileGap), 0);
    CHECK_EQ_INT(rep.count(BindingIssueKind::UnknownCommand), 0);
    // complete() must NOT be cleared by GestureBlocked: that is a property of a
    // schema and no rebinding can fix it, so treating it as an incomplete map
    // would make the flag permanently unreachable.
    CHECK_EQ_INT(rep.count(BindingIssueKind::GestureBlocked), 7);

    // IDEMPOTENT. Running it again adds nothing and changes nothing — a startup
    // that calls it after registration AND after loadState must not double-bind.
    const std::string once = app.shell.keymap().serialize();
    CHECK_EQ_INT(app.shell.completeKeymap(), 0);
    CHECK_EQ_STR(app.shell.keymap().serialize(), once);

    // NON-DESTRUCTIVE. The hand-written shortcuts are exactly where they were;
    // a completion that displaced Ctrl+Z would be a regression disguised as a
    // feature.
    CHECK_EQ_STR(forge::uitest::at(
                     app.shell.keymap().shortcutsFor(InputProfile::ForgeNative, "edit.undo"), 0),
                 "Ctrl+Z");
    CHECK_EQ_STR(
        forge::uitest::at(app.shell.keymap().shortcutsFor(InputProfile::ForgeNative, "part.fillet"),
                          0),
        "R");
    CHECK_EQ_STR(
        forge::uitest::at(app.shell.keymap().shortcutsFor(InputProfile::NXLike, "part.extrude"), 0),
        "X");

    // DETERMINISTIC across processes and across two independently built shells:
    // a keymap that differs run to run cannot be documented or taught.
    App other;
    other.shell.completeKeymap();
    CHECK_EQ_STR(other.shell.keymap().serialize(), app.shell.keymap().serialize());

    // The completed map is still a legal keymap: it survives its own
    // serialize/parse round trip, which is the storage format a session file
    // uses. bind() is what refuses conflicts, and parse() re-binds every line,
    // so a completed map that parses is a completed map with no conflicts.
    Keymap back;
    CHECK(Keymap::parse(app.shell.keymap().serialize(), back));
    CHECK_EQ_STR(back.serialize(), app.shell.keymap().serialize());
    CHECK_EQ_INT(back.bindingCount(), app.shell.keymap().bindingCount());
  }

  // ── (e) a generated chord really DISPATCHES ──────────────────────────────
  // The half a binding count cannot prove. Every generated sequence is fed to
  // ForgeShell::key() stroke by stroke, and the last stroke must resolve Bound
  // to the command it was generated for — with the intermediate strokes
  // reporting Pending rather than eating the key.
  {
    App app;
    app.shell.completeKeymap();
    std::size_t dispatched = 0;
    std::size_t chords = 0;
    for (const std::string& id : app.shell.registry().ids()) {
      const std::vector<std::string> keys =
          app.shell.keymap().shortcutsFor(InputProfile::ForgeNative, id);
      CHECK(!keys.empty());
      if (keys.empty()) continue;
      // Re-parse the stored text into strokes the way a real key press arrives.
      KeySequence sequence;
      std::string token;
      std::string text = keys.front() + " ";
      for (char c : text) {
        if (c != ' ') {
          token.push_back(c);
          continue;
        }
        if (token.empty()) continue;
        KeyStroke stroke;
        std::size_t at = 0;
        while (true) {
          const std::size_t plus = token.find('+', at);
          if (plus == std::string::npos) break;
          const std::string mod = token.substr(at, plus - at);
          if (mod == "Ctrl") stroke.mods = stroke.mods | Mod::Ctrl;
          if (mod == "Alt") stroke.mods = stroke.mods | Mod::Alt;
          if (mod == "Shift") stroke.mods = stroke.mods | Mod::Shift;
          if (mod == "Super") stroke.mods = stroke.mods | Mod::Super;
          at = plus + 1;
        }
        stroke.key = token.substr(at);
        sequence.push_back(stroke);
        token.clear();
      }
      CHECK(!sequence.empty());
      if (sequence.size() > 1) ++chords;
      app.shell.cancelPendingSequence();
      bool reached = false;
      for (std::size_t i = 0; i < sequence.size(); ++i) {
        const KeyOutcome outcome = app.shell.key(sequence[i]);
        if (i + 1 < sequence.size()) {
          // A prefix must be HELD, not swallowed and not fired.
          CHECK(outcome.resolve == ResolveStatus::Pending);
          CHECK_EQ_STR(outcome.commandId, "");
        } else {
          CHECK(outcome.resolve == ResolveStatus::Bound);
          CHECK_EQ_STR(outcome.commandId, id);
          reached = true;
        }
      }
      if (reached) ++dispatched;
    }
    CHECK_EQ_INT(dispatched, app.shell.registry().size());
    // The generated half really is a chord family, not extra single keys that
    // would have collided with the vendor cultures.
    CHECK(chords > 0);
  }

  // ── (f) a SESSION FILE cannot leave a command unreachable ────────────────
  // loadState() installs whatever map the file held, and a file written by an
  // older build predates half the registry. The startup contract is therefore
  // "complete AFTER loading", and this is the proof that the second call is not
  // redundant.
  {
    App app;
    const std::string stale = app.shell.saveState();  // the SHIPPED, incomplete map
    App fresh;
    const ForgeShell::StateLoadReport report = fresh.shell.loadStateReport(stale);
    CHECK(report.ok);
    CHECK(!fresh.shell.keymapReport().complete());
    const std::size_t added = fresh.shell.completeKeymap();
    CHECK(added > 0);
    CHECK(fresh.shell.keymapReport().complete());
  }

  // ── (g) a command registered LATER still gets a key ──────────────────────
  // The positive control for the completion, with its negative half: absent,
  // then registered, then bound in all four profiles — with no table edited.
  {
    App app;
    app.shell.completeKeymap();
    const std::string probeId = "probe.late_command";
    for (InputProfile p : allInputProfiles()) {
      CHECK(app.shell.keymap().shortcutsFor(p, probeId).empty());
    }
    CommandDescriptor c;
    c.id = probeId;
    c.label = "Late Probe";
    c.category = "View";
    c.enabled = [](const CommandContext&) { return true; };
    c.execute = [](CommandContext&) {};
    CHECK(app.shell.registry().add(std::move(c)));

    CHECK(!app.shell.keymapReport().complete());
    CHECK_EQ_INT(app.shell.completeKeymap(), allInputProfiles().size());
    CHECK(app.shell.keymapReport().complete());
    for (InputProfile p : allInputProfiles()) {
      CHECK(!app.shell.keymap().shortcutsFor(p, probeId).empty());
    }
  }

  // ── (h) a DEAD binding is reported, not silently tolerated ───────────────
  // The negative control for BindingIssueKind::UnknownCommand: block (c)
  // asserts the shipped map has none, which is only meaningful if the check can
  // fire at all.
  {
    App app;
    Keymap map;
    CHECK(map.bind(InputProfile::ForgeNative, {KeyStroke{"F12", 0}}, "no.such.command"));
    const KeymapReport rep = auditKeymap(map, app.shell.registry());
    CHECK_EQ_INT(rep.count(BindingIssueKind::UnknownCommand), 1);
    CHECK(!rep.complete());
    const std::vector<BindingIssue> dead = rep.of(BindingIssueKind::UnknownCommand);
    CHECK_EQ_INT(dead.size(), 1);
    if (!dead.empty()) {
      CHECK_EQ_STR(dead[0].commandId, "no.such.command");
      CHECK_EQ_STR(dead[0].sequence, "F12");
      CHECK(!dead[0].detail.empty());
    }
  }

  // ── (i) a PROFILE GAP is reported instead of Unbound, never as well as ───
  // Bound in one profile and not another is a different failure from bound
  // nowhere — it is the shape of "it worked yesterday" — and double-counting it
  // would inflate every hole in the report.
  {
    CommandRegistry registry;
    CommandDescriptor c;
    c.id = "probe.one_profile";
    c.label = "One Profile";
    c.category = "View";
    c.enabled = [](const CommandContext&) { return true; };
    c.execute = [](CommandContext&) {};
    CHECK(registry.add(std::move(c)));

    Keymap map;
    CHECK(map.bind(InputProfile::ForgeNative, {KeyStroke{"F9", 0}}, "probe.one_profile"));
    const KeymapReport rep = auditKeymap(map, registry);
    CHECK_EQ_INT(rep.registryCommands, 1);
    CHECK_EQ_INT(rep.boundEverywhere, 0);
    CHECK_EQ_INT(rep.count(BindingIssueKind::ProfileGap), 3);
    CHECK_EQ_INT(rep.count(BindingIssueKind::Unbound), 0);
    CHECK(!rep.complete());

    // Fill it and the gap closes.
    Keymap full = map;
    CHECK_EQ_INT(bindUnboundCommands(full, registry), 3);
    const KeymapReport after = auditKeymap(full, registry);
    CHECK(after.complete());
    CHECK_EQ_INT(after.boundEverywhere, 1);
    // ForgeNative kept its hand-written F9.
    CHECK_EQ_STR(
        forge::uitest::at(full.shortcutsFor(InputProfile::ForgeNative, "probe.one_profile"), 0),
        "F9");
  }

  // ── (j) the chord leader is RESERVED in every shipped profile ────────────
  // A generated chord hangs off it, so a hand-written binding on the leader as a
  // WHOLE sequence would make the entire generated family unreachable. Keymap
  // would refuse the collision at bind time, which is worse: the completion
  // would silently skip commands.
  {
    App app;
    for (InputProfile p : allInputProfiles()) {
      const KeyStroke leader = chordLeader(p);
      CHECK_EQ_STR(leader.toText(), "Ctrl+K");
      const Resolution r = app.shell.keymap().resolve(p, {leader});
      // Pending (ForgeNative has Ctrl+K Ctrl+P) or Unbound — never Bound.
      CHECK(r.status != ResolveStatus::Bound);
    }
    app.shell.completeKeymap();
    for (InputProfile p : allInputProfiles()) {
      // After completion the leader is a live prefix in every profile.
      CHECK(app.shell.keymap().resolve(p, {chordLeader(p)}).status == ResolveStatus::Pending);
    }
    // And the hand-written chord that already used the leader survives.
    CHECK_EQ_STR(forge::uitest::at(app.shell.keymap().shortcutsFor(InputProfile::ForgeNative,
                                                                  "app.command_palette"),
                                  0),
                 "Ctrl+K Ctrl+P");
  }

  return H.finish();
}
