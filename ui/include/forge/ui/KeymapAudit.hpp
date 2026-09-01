// ui/include/forge/ui/KeymapAudit.hpp
//
// IS EVERY COMMAND REACHABLE FROM THE KEYBOARD? — the audit, and the completion.
//
// Keymap already refuses the two conflicts it can see at bind time: the same
// sequence twice in one profile, and a sequence that is a strict prefix of
// another. What it cannot see is the registry. It does not know that a binding
// names a command nobody registered, that thirty-one commands have no binding at
// all, or that a bound command will DIE BEFORE ITS HANDLER RUNS because a
// required parameter has no honest default.
//
// ── the defect this was written to find, and the measurement ────────────────
// ForgeShell::invoke() is the interactive path: it fills in every schema default
// whose spec says `hasDefault`, then reports anything still required for the UI
// to prompt for. `ParamSpec` is an aggregate whose braced-positional form —
// `ParamSpec{"width", ParamType::Number, true, 40.0, ""}` — stops at
// defaultText, so `hasDefault` stayed FALSE on every parameter written that way.
// Measured on the registry before this change: 23 required parameters across 13
// of the 31 commands had a perfectly good default value sitting in
// `defaultNumber` that applyDefaults() was forbidden to use, so a keystroke or a
// menu click on any of them returned missing_required_parameter with the handler
// never called. The shipped default keymap happened to bind only the three
// commands that had been fixed by hand, which is why it was invisible.
//
// gestureBlockedCommands() is that measurement, as a function. It must return
// only commands whose parameter genuinely has no honest default — a file path is
// one, "the new value of this parameter" is another — and the gate names them.
//
// ── completion, not refusal ─────────────────────────────────────────────────
// bindUnboundCommands() gives EVERY command a binding, deterministically, under
// a reserved chord leader. It never displaces an existing binding and never
// invents a conflict; it fills the gap. That is the owner's constraint applied
// to input: a command with no shortcut is a capability the keyboard cannot
// reach, and the answer is to bind it, not to declare it unbindable.
#ifndef FORGE_UI_KEYMAPAUDIT_HPP
#define FORGE_UI_KEYMAPAUDIT_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Keymap.hpp"

namespace forge::ui {

enum class BindingIssueKind : std::uint8_t {
  // A binding names a command the registry does not hold. The key is dead: the
  // shell resolves it, dispatch answers unknown_command, nothing happens.
  UnknownCommand,
  // A registry command has no binding in this profile.
  Unbound,
  // A bare gesture cannot run this command: a REQUIRED parameter has no
  // declared default, so ForgeShell::invoke() must prompt before dispatching.
  // Raised ONCE per command (the profile field names the first profile that
  // binds it, or ForgeNative when nothing does), because it is a property of the
  // command and repeating it four times would bury the map's real holes.
  // Not necessarily a defect — `file.open` needs a path and "" is not one — but
  // it must be a KNOWN one, because the alternative is a key that looks bound
  // and does nothing.
  GestureBlocked,
  // Bound in at least one profile and unbound in this one. A user who switches
  // profiles loses a shortcut they had, which is the shape of "it worked
  // yesterday". Raised INSTEAD OF Unbound, never as well as it: one gap, one
  // issue, or the report double-counts every hole in the map.
  ProfileGap,
};

const char* toString(BindingIssueKind kind) noexcept;

struct BindingIssue {
  BindingIssueKind kind = BindingIssueKind::Unbound;
  InputProfile profile = InputProfile::ForgeNative;
  std::string commandId;
  std::string sequence;  // "" when the issue is that there is no sequence
  std::string detail;    // always a sentence naming what to do about it

  std::string describe() const;
};

struct KeymapReport {
  std::size_t registryCommands = 0;
  std::size_t bindings = 0;
  // Commands bound in EVERY profile. The interesting number: a command bound in
  // one profile is still unreachable for three quarters of the users.
  std::size_t boundEverywhere = 0;
  std::vector<BindingIssue> issues;

  std::size_t count(BindingIssueKind kind) const noexcept;
  std::vector<BindingIssue> of(BindingIssueKind kind) const;
  // Every registry command is bound in every profile, and no binding names a
  // command that does not exist. GestureBlocked does NOT clear this flag: it is
  // a property of the COMMAND'S SCHEMA, not of the map, and no rebinding can fix
  // it — `file.open` needs a path however it is invoked.
  bool complete() const noexcept;
  std::string render() const;
};

KeymapReport auditKeymap(const Keymap& keymap, const CommandRegistry& registry);

// ── the gesture question, on one command ────────────────────────────────────
// TRUE when a bare gesture — a keystroke, a menu click, a toolbar button — can
// dispatch this command with no dialog: every REQUIRED parameter either is
// already supplied or declares an honest default.
bool keyboardInvocable(const CommandDescriptor& command);

// Required parameters this command cannot fill in on the user's behalf, in
// schema order. Empty exactly when keyboardInvocable() is true.
std::vector<std::string> unfillableParameters(const CommandDescriptor& command);

// Every command in the registry a bare gesture cannot run, sorted. This is the
// list the track's brief asks to be reported, and it is derived, never written
// down: a command that grows a defaultless required parameter joins it by itself.
std::vector<std::string> gestureBlockedCommands(const CommandRegistry& registry);

// ── completing a map ────────────────────────────────────────────────────────
// The leader stroke a generated chord hangs off, per profile. Reserved: the
// shipped defaults bind nothing to it as a whole sequence, and a generated chord
// is always leader + at least one more stroke, so a generated binding can never
// collide with a hand-written single-stroke shortcut.
KeyStroke chordLeader(InputProfile profile);

// Binds every command the registry holds that has no binding in `profile`.
// Deterministic: the same registry gives the same sequences, in sorted command
// order, on every run and in every process. Returns how many it added.
//
// Never touches an existing binding, and skips any candidate sequence Keymap
// refuses — so it cannot create the prefix conflicts Keymap exists to prevent.
std::size_t bindUnboundCommands(Keymap& keymap, const CommandRegistry& registry,
                                InputProfile profile);
std::size_t bindUnboundCommands(Keymap& keymap, const CommandRegistry& registry);

}  // namespace forge::ui

#endif  // FORGE_UI_KEYMAPAUDIT_HPP
