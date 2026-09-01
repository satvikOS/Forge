#include "forge/ui/KeymapAudit.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Keymap.hpp"

namespace forge::ui {
namespace {

// The terminal symbols a generated chord may end on, and the ESCAPE that is
// never a terminal. Keeping one symbol out of the terminal set is what makes the
// generated family prefix-free at every depth: `Ctrl+K 9` is only ever a prefix,
// never a binding, so `Ctrl+K 9 A` cannot collide with it.
constexpr char kTerminals[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678";  // 35, no '9'
constexpr std::size_t kTerminalCount = sizeof(kTerminals) - 1;
constexpr const char* kEscape = "9";
// 8 levels of escape is 280 candidate sequences; a registry needing more than
// that has other problems, and an unbounded search would hang instead of saying
// so.
constexpr std::size_t kMaxCandidates = kTerminalCount * 8;

KeySequence candidateAt(InputProfile profile, std::size_t index) {
  KeySequence seq;
  seq.push_back(chordLeader(profile));
  const std::size_t depth = index / kTerminalCount;
  const std::size_t pos = index % kTerminalCount;
  for (std::size_t i = 0; i < depth; ++i) seq.push_back(KeyStroke{kEscape, 0});
  seq.push_back(KeyStroke{std::string(1, kTerminals[pos]), 0});
  return seq;
}

std::string firstShortcut(const Keymap& keymap, InputProfile profile, const std::string& id) {
  const std::vector<std::string> all = keymap.shortcutsFor(profile, id);
  return all.empty() ? std::string() : all.front();
}

}  // namespace

const char* toString(BindingIssueKind kind) noexcept {
  switch (kind) {
    case BindingIssueKind::UnknownCommand: return "unknown_command";
    case BindingIssueKind::Unbound:        return "unbound";
    case BindingIssueKind::GestureBlocked: return "gesture_blocked";
    case BindingIssueKind::ProfileGap:     return "profile_gap";
  }
  return "unbound";
}

std::string BindingIssue::describe() const {
  std::ostringstream os;
  os << toString(kind) << "  " << toString(profile) << "  " << commandId;
  if (!sequence.empty()) os << "  [" << sequence << ']';
  if (!detail.empty()) os << "  — " << detail;
  return os.str();
}

std::size_t KeymapReport::count(BindingIssueKind kind) const noexcept {
  std::size_t n = 0;
  for (const BindingIssue& i : issues) {
    if (i.kind == kind) ++n;
  }
  return n;
}

std::vector<BindingIssue> KeymapReport::of(BindingIssueKind kind) const {
  std::vector<BindingIssue> out;
  for (const BindingIssue& i : issues) {
    if (i.kind == kind) out.push_back(i);
  }
  return out;
}

bool KeymapReport::complete() const noexcept {
  return count(BindingIssueKind::UnknownCommand) == 0 && count(BindingIssueKind::Unbound) == 0 &&
         count(BindingIssueKind::ProfileGap) == 0;
}

std::string KeymapReport::render() const {
  std::ostringstream os;
  os << "keymap: " << bindings << " bindings over " << registryCommands << " commands; "
     << boundEverywhere << " bound in every profile\n";
  for (const BindingIssue& i : issues) os << "  " << i.describe() << '\n';
  return os.str();
}

// ── the gesture question ────────────────────────────────────────────────────
std::vector<std::string> unfillableParameters(const CommandDescriptor& command) {
  // Exactly ForgeShell::invoke()'s arithmetic: fill every declared default, then
  // ask what is still required. Written through applyDefaults/missingRequired
  // rather than re-implemented, so this answer and the dispatcher's cannot drift.
  const CommandParams filled = applyDefaults(command, CommandParams{});
  return missingRequired(command, filled);
}

bool keyboardInvocable(const CommandDescriptor& command) {
  return unfillableParameters(command).empty();
}

std::vector<std::string> gestureBlockedCommands(const CommandRegistry& registry) {
  std::vector<std::string> out;
  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* d = registry.find(id);
    if (d != nullptr && !keyboardInvocable(*d)) out.push_back(id);
  }
  std::sort(out.begin(), out.end());
  return out;
}

// ── the audit ───────────────────────────────────────────────────────────────
KeymapReport auditKeymap(const Keymap& keymap, const CommandRegistry& registry) {
  KeymapReport report;
  report.registryCommands = registry.size();
  report.bindings = keymap.bindingCount();

  const std::vector<InputProfile> profiles = allInputProfiles();
  const std::vector<std::string> commands = registry.ids();

  // Dead bindings first: a key that resolves to nothing is the failure a user
  // notices soonest and can do the least about.
  for (InputProfile p : profiles) {
    for (const std::string& id : keymap.boundCommandIds(p)) {
      if (registry.contains(id)) continue;
      BindingIssue issue;
      issue.kind = BindingIssueKind::UnknownCommand;
      issue.profile = p;
      issue.commandId = id;
      issue.sequence = firstShortcut(keymap, p, id);
      issue.detail = "the key resolves, dispatch answers unknown_command, and nothing happens; "
                     "rebind it or register the command";
      report.issues.push_back(issue);
    }
  }

  for (const std::string& id : commands) {
    std::size_t boundIn = 0;
    for (InputProfile p : profiles) {
      if (!keymap.shortcutsFor(p, id).empty()) ++boundIn;
    }
    if (boundIn == profiles.size()) ++report.boundEverywhere;

    for (InputProfile p : profiles) {
      if (!keymap.shortcutsFor(p, id).empty()) continue;
      BindingIssue issue;
      issue.profile = p;
      issue.commandId = id;
      if (boundIn > 0) {
        issue.kind = BindingIssueKind::ProfileGap;
        issue.detail = "bound in another input profile but not in this one; a user switching "
                       "profiles loses the shortcut";
      } else {
        issue.kind = BindingIssueKind::Unbound;
        issue.detail = "no key sequence reaches this command in any profile; "
                       "bindUnboundCommands() will assign one";
      }
      report.issues.push_back(issue);
    }

    const CommandDescriptor* d = registry.find(id);
    if (d == nullptr) continue;
    const std::vector<std::string> unfillable = unfillableParameters(*d);
    if (unfillable.empty()) continue;
    BindingIssue issue;
    issue.kind = BindingIssueKind::GestureBlocked;
    issue.commandId = id;
    issue.profile = profiles.front();
    for (InputProfile p : profiles) {
      const std::string sc = firstShortcut(keymap, p, id);
      if (sc.empty()) continue;
      issue.profile = p;
      issue.sequence = sc;
      break;
    }
    std::string names;
    for (std::size_t i = 0; i < unfillable.size(); ++i) {
      if (i != 0) names += ", ";
      names += unfillable[i];
    }
    issue.detail = "a gesture cannot supply " + names +
                   "; the invoker must open a dialog first, or the parameter needs "
                   "hasDefault = true on an honest default";
    report.issues.push_back(issue);
  }
  return report;
}

// ── completing a map ────────────────────────────────────────────────────────
KeyStroke chordLeader(InputProfile profile) {
  // ONE leader for all four profiles, and that uniformity is the product
  // decision: a generated shortcut is not part of any vendor's keyboard culture,
  // so pretending it is by giving each profile a different leader would make the
  // generated half of the map harder to learn, not easier. `Ctrl+K` is free as a
  // whole sequence in all four shipped defaults.
  (void)profile;
  return KeyStroke{"K", maskOf(Mod::Ctrl)};
}

std::size_t bindUnboundCommands(Keymap& keymap, const CommandRegistry& registry,
                                InputProfile profile) {
  std::size_t added = 0;
  std::size_t cursor = 0;
  for (const std::string& id : registry.ids()) {  // sorted: deterministic assignment
    if (!keymap.shortcutsFor(profile, id).empty()) continue;
    while (cursor < kMaxCandidates) {
      const KeySequence candidate = candidateAt(profile, cursor);
      ++cursor;
      if (keymap.bind(profile, candidate, id)) {
        ++added;
        break;
      }
      // bind() refused: the sequence is taken, or it conflicts with a
      // hand-written chord. Try the next one -- never displace what is there.
    }
  }
  return added;
}

std::size_t bindUnboundCommands(Keymap& keymap, const CommandRegistry& registry) {
  std::size_t added = 0;
  for (InputProfile p : allInputProfiles()) added += bindUnboundCommands(keymap, registry, p);
  return added;
}

}  // namespace forge::ui
