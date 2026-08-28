// ui/test/input_profile_parity_test.cpp
//
// CONTRACT 2 — the SAME command ID is reachable from at least two different
// input profiles, and reaching it runs ONE implementation, not two.
//
// The proof is not "both resolve to the same string". It is stronger: the NX-like
// chord and the Blender-like chord are pressed against a live shell, and the
// SINGLE registered handler's side effect is observed to increment once per
// press, while the registry is confirmed to hold exactly one descriptor for that
// ID. If someone forked the command into a per-profile implementation, the
// registry count or the shared counter would disagree.
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/Keymap.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::at;
using forge::uitest::Harness;

namespace {

KeyStroke k(const std::string& key) { return KeyStroke{key, 0}; }
KeyStroke k(const std::string& key, Mod m) { return KeyStroke{key, maskOf(m)}; }
KeyStroke k(const std::string& key, ModMask mods) { return KeyStroke{key, mods}; }

// How many descriptors in the ONE registry carry this stable ID. Two profiles
// reaching "one command" is only meaningful if this is exactly 1.
std::size_t descriptorsWithId(const CommandRegistry& registry, const std::string& id) {
  std::size_t n = 0;
  for (const std::string& known : registry.ids()) {
    if (known == id) ++n;
  }
  return n;
}

}  // namespace

int main() {
  Harness H("input_profile_parity");

  const Keymap map = defaultKeymaps();
  CHECK_EQ_INT(allInputProfiles().size(), 4);

  // ── every profile binds the same command IDs ────────────────────────────
  const std::vector<std::string> nxIds = map.boundCommandIds(InputProfile::NXLike);
  const std::vector<std::string> blenderIds = map.boundCommandIds(InputProfile::BlenderLike);
  const std::vector<std::string> forgeIds = map.boundCommandIds(InputProfile::ForgeNative);
  const std::vector<std::string> catiaIds = map.boundCommandIds(InputProfile::CATIALike);
  CHECK_EQ_INT(nxIds.size(), 13);
  CHECK(nxIds == blenderIds);
  CHECK(nxIds == forgeIds);
  CHECK(nxIds == catiaIds);

  // ── and they bind them to DIFFERENT keys ────────────────────────────────
  // If the profiles were identical this test would be vacuous, so assert they
  // really do differ where CAD culture differs.
  const std::vector<std::string> nxFit = map.shortcutsFor(InputProfile::NXLike, "view.fit");
  const std::vector<std::string> blFit = map.shortcutsFor(InputProfile::BlenderLike, "view.fit");
  const std::vector<std::string> caFit = map.shortcutsFor(InputProfile::CATIALike, "view.fit");
  const std::vector<std::string> fnFit = map.shortcutsFor(InputProfile::ForgeNative, "view.fit");
  CHECK_EQ_INT(nxFit.size(), 1);
  CHECK_EQ_STR(at(nxFit, 0), "Ctrl+F");
  CHECK_EQ_STR(at(blFit, 0), "Home");
  CHECK_EQ_STR(at(caFit, 0), "Alt+F");
  CHECK_EQ_STR(at(fnFit, 0), "F");

  // resolve() agrees from both directions
  CHECK_EQ_INT(static_cast<int>(map.resolve(InputProfile::NXLike, {k("F", Mod::Ctrl)}).status),
               static_cast<int>(ResolveStatus::Bound));
  CHECK_EQ_STR(map.resolve(InputProfile::NXLike, {k("F", Mod::Ctrl)}).commandId, "view.fit");
  CHECK_EQ_STR(map.resolve(InputProfile::BlenderLike, {k("Home")}).commandId, "view.fit");
  // and the same keys mean DIFFERENT things in different profiles, as they must
  CHECK_EQ_STR(map.resolve(InputProfile::NXLike, {k("X")}).commandId, "model.extrude");
  CHECK_EQ_STR(map.resolve(InputProfile::BlenderLike, {k("X")}).commandId, "edit.delete");

  // ── the load-bearing proof: ONE implementation behind both bindings ─────
  ForgeShell shell;

  // exactly one descriptor carries this ID
  CHECK_EQ_INT(descriptorsWithId(shell.registry(), "view.fit"), 1);

  CHECK_EQ_INT(shell.document().fitCount, 0);

  shell.setInputProfile(InputProfile::NXLike);
  KeyOutcome outcome = shell.key(k("F", Mod::Ctrl));
  CHECK(outcome.ran());
  CHECK_EQ_STR(outcome.commandId, "view.fit");
  CHECK_EQ_INT(shell.document().fitCount, 1);

  shell.setInputProfile(InputProfile::BlenderLike);
  outcome = shell.key(k("Home"));
  CHECK(outcome.ran());
  CHECK_EQ_STR(outcome.commandId, "view.fit");
  CHECK_EQ_INT(shell.document().fitCount, 2);  // the SAME counter advanced

  shell.setInputProfile(InputProfile::CATIALike);
  outcome = shell.key(k("F", Mod::Alt));
  CHECK(outcome.ran());
  CHECK_EQ_INT(shell.document().fitCount, 3);

  shell.setInputProfile(InputProfile::ForgeNative);
  outcome = shell.key(k("F"));
  CHECK(outcome.ran());
  CHECK_EQ_INT(shell.document().fitCount, 4);

  // Four presses, four profiles, ONE command ID in the journal every time.
  CHECK_EQ_INT(shell.journal().size(), 4);
  for (const std::string& entry : shell.journal()) {
    CHECK_EQ_STR(entry, "view.fit");
  }

  // ── every binding names a command the one registry actually holds ───────
  // An orphan binding is a shortcut that silently does nothing.
  std::size_t orphans = 0;
  for (const std::string& id : map.allBoundCommandIds()) {
    if (!shell.registry().contains(id)) ++orphans;
  }
  CHECK_EQ_INT(orphans, 0);

  // ── key SEQUENCES: a live prefix is Pending, not Unbound ────────────────
  shell.setInputProfile(InputProfile::ForgeNative);
  outcome = shell.key(k("K", Mod::Ctrl));
  CHECK_EQ_INT(static_cast<int>(outcome.resolve), static_cast<int>(ResolveStatus::Pending));
  CHECK_EQ_INT(shell.pendingSequence().size(), 1);
  outcome = shell.key(k("P", Mod::Ctrl));
  CHECK_EQ_INT(static_cast<int>(outcome.resolve), static_cast<int>(ResolveStatus::Bound));
  CHECK_EQ_STR(outcome.commandId, "app.command_palette");
  CHECK_EQ_INT(shell.pendingSequence().size(), 0);

  // an unbound continuation abandons the sequence rather than eating keys
  outcome = shell.key(k("K", Mod::Ctrl));
  CHECK_EQ_INT(static_cast<int>(outcome.resolve), static_cast<int>(ResolveStatus::Pending));
  outcome = shell.key(k("Q"));
  CHECK_EQ_INT(static_cast<int>(outcome.resolve), static_cast<int>(ResolveStatus::Unbound));
  CHECK_EQ_INT(shell.pendingSequence().size(), 0);

  // switching profile mid-sequence drops the half-typed prefix
  shell.key(k("K", Mod::Ctrl));
  CHECK_EQ_INT(shell.pendingSequence().size(), 1);
  shell.setInputProfile(InputProfile::NXLike);
  CHECK_EQ_INT(shell.pendingSequence().size(), 0);

  // ── binding conflicts are refused at bind time ──────────────────────────
  Keymap m;
  CHECK(m.bind(InputProfile::NXLike, {k("K", Mod::Ctrl), k("P", Mod::Ctrl)}, "a.one"));
  CHECK(!m.bind(InputProfile::NXLike, {k("K", Mod::Ctrl), k("P", Mod::Ctrl)}, "a.two"));  // dup
  CHECK(!m.bind(InputProfile::NXLike, {k("K", Mod::Ctrl)}, "a.three"));  // prefix shadows it
  CHECK(!m.bind(InputProfile::NXLike, {k("K", Mod::Ctrl), k("P", Mod::Ctrl), k("Z")}, "a.four"));
  CHECK_EQ_INT(m.bindingCount(InputProfile::NXLike), 1);
  // the SAME sequence in a DIFFERENT profile is not a conflict
  CHECK(m.bind(InputProfile::BlenderLike, {k("K", Mod::Ctrl), k("P", Mod::Ctrl)}, "a.two"));
  CHECK_EQ_INT(m.bindingCount(), 2);
  CHECK(!m.bind(InputProfile::NXLike, {}, "a.five"));          // empty sequence
  CHECK(!m.bind(InputProfile::NXLike, {k("Y")}, ""));          // empty command id
  CHECK_EQ_INT(m.bindingCount(), 2);

  // ── the user's edited keymap round-trips ────────────────────────────────
  const std::string text = map.serialize();
  Keymap reloaded;
  CHECK(Keymap::parse(text, reloaded));
  CHECK_EQ_INT(reloaded.bindingCount(), map.bindingCount());
  CHECK_EQ_STR(reloaded.serialize(), text);
  CHECK_EQ_STR(reloaded.resolve(InputProfile::CATIALike, {k("F", Mod::Alt)}).commandId, "view.fit");
  Keymap rejected;
  CHECK(!Keymap::parse("not-a-keymap\n", rejected));
  CHECK(!Keymap::parse("forge-keymap 1\nbogus-profile\tF\tview.fit\n", rejected));

  // ── stroke text is canonical and stable ─────────────────────────────────
  CHECK_EQ_STR(k("K", Mod::Ctrl | Mod::Shift).toText(), "Ctrl+Shift+K");
  CHECK_EQ_STR(sequenceText({k("K", Mod::Ctrl), k("P")}), "Ctrl+K P");

  // ── REGRESSION: serialize() must never emit text parse() rejects ────────
  // bind() accepted a key NAME containing '+', but parseStroke() reads every
  // '+' as a modifier separator: "Ctrl++" serialized fine and then failed to
  // parse, and ForgeShell::loadState() throws away the WHOLE keymap on a single
  // bad line. The same holds for a tab, which is the field separator itself.
  Keymap hostile;
  CHECK(!hostile.bind(InputProfile::NXLike, {k("+")}, "a.plus"));
  CHECK(!hostile.bind(InputProfile::NXLike, {k("Num+", Mod::Ctrl)}, "a.numplus"));
  CHECK(!hostile.bind(InputProfile::NXLike, {k("A\tB")}, "a.tabkey"));
  CHECK(!hostile.bind(InputProfile::NXLike, {k("A\nB")}, "a.newlinekey"));
  CHECK(!hostile.bind(InputProfile::NXLike, {k("A")}, "a\tb"));   // id breaks the record format
  CHECK(!hostile.bind(InputProfile::NXLike, {k("A")}, "a\nb"));
  CHECK_EQ_INT(hostile.bindingCount(), 0);

  // whatever DOES bind round-trips, including the canonical names for those keys
  Keymap corpus;
  CHECK(corpus.bind(InputProfile::NXLike, {k("Plus")}, "a.plus"));
  CHECK(corpus.bind(InputProfile::NXLike, {k("Equal", Mod::Ctrl)}, "a.equal"));
  CHECK(corpus.bind(InputProfile::BlenderLike, {k("NumpadAdd", Mod::Ctrl | Mod::Shift)}, "a.add"));
  CHECK(corpus.bind(InputProfile::CATIALike, {k("F12"), k("Slash")}, "a.seq"));
  const std::string corpusText = corpus.serialize();
  Keymap corpusBack;
  CHECK(Keymap::parse(corpusText, corpusBack));
  CHECK_EQ_STR(corpusBack.serialize(), corpusText);
  CHECK_EQ_INT(corpusBack.bindingCount(), corpus.bindingCount());
  CHECK_EQ_STR(corpusBack.resolve(InputProfile::NXLike, {k("Plus")}).commandId, "a.plus");

  // and a shell whose keymap contains such a binding still loads its state
  ForgeShell keyed;
  const std::string keyedState = keyed.saveState();
  ForgeShell keyedBack;
  CHECK(keyedBack.loadState(keyedState));
  CHECK_EQ_STR(keyedBack.saveState(), keyedState);

  return H.finish();
}
