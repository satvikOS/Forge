#include "forge/ui/Keymap.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace forge::ui {

const char* toString(InputProfile profile) noexcept {
  switch (profile) {
    case InputProfile::ForgeNative: return "forge-native";
    case InputProfile::NXLike:      return "nx-like";
    case InputProfile::CATIALike:   return "catia-like";
    case InputProfile::BlenderLike: return "blender-like";
  }
  return "forge-native";
}

std::vector<InputProfile> allInputProfiles() {
  return {InputProfile::ForgeNative, InputProfile::NXLike, InputProfile::CATIALike,
          InputProfile::BlenderLike};
}

std::string KeyStroke::toText() const {
  std::string out;
  if (mods & static_cast<std::uint8_t>(Mod::Ctrl)) out += "Ctrl+";
  if (mods & static_cast<std::uint8_t>(Mod::Alt)) out += "Alt+";
  if (mods & static_cast<std::uint8_t>(Mod::Shift)) out += "Shift+";
  if (mods & static_cast<std::uint8_t>(Mod::Super)) out += "Super+";
  out += key;
  return out;
}

bool operator==(const KeyStroke& a, const KeyStroke& b) noexcept {
  return a.key == b.key && a.mods == b.mods;
}

std::string sequenceText(const KeySequence& seq) {
  std::string out;
  for (std::size_t i = 0; i < seq.size(); ++i) {
    if (i != 0) out += ' ';
    out += seq[i].toText();
  }
  return out;
}

const Keymap::Table& Keymap::table(InputProfile profile) const {
  return profiles_[static_cast<std::size_t>(profile)];
}

Keymap::Table& Keymap::table(InputProfile profile) {
  return profiles_[static_cast<std::size_t>(profile)];
}

namespace {
// `a` is a STRICT prefix of `b` when b continues with another whole stroke.
bool isStrictPrefix(const std::string& a, const std::string& b) {
  return b.size() > a.size() + 1 && b.compare(0, a.size(), a) == 0 && b[a.size()] == ' ';
}

// A serialized record is `profile \t sequence \t command-id \n`, split into
// strokes on spaces. Any whitespace or control byte in a field therefore writes
// a line the parser reads as a DIFFERENT record, or as no record at all.
bool hasControlOrSpace(const std::string& s) {
  for (unsigned char c : s) {
    if (c <= ' ' || c == 0x7F) return true;
  }
  return false;
}
}  // namespace

bool Keymap::bind(InputProfile profile, const KeySequence& sequence,
                  const std::string& commandId) {
  if (sequence.empty() || commandId.empty()) return false;
  if (hasControlOrSpace(commandId)) return false;
  for (const KeyStroke& s : sequence) {
    if (s.key.empty() || hasControlOrSpace(s.key)) return false;
    // '+' separates the modifiers from the key in the canonical stroke text, so
    // a key NAME containing one serializes to something parse() cannot read
    // back: "Ctrl++" is read as Ctrl, then an empty modifier token, and fails.
    // serialize() must never emit text parse() rejects, so refuse it HERE —
    // ForgeShell::loadState discards the entire keymap on one unparseable line.
    // The canonical names for those keys are "Plus" and "NumpadAdd".
    if (s.key.find('+') != std::string::npos) return false;
  }
  const std::string text = sequenceText(sequence);
  Table& t = table(profile);
  if (t.count(text) != 0) return false;  // already bound in this profile
  for (const auto& [existing, id] : t) {
    (void)id;
    // Either direction of prefix overlap makes one of the two unreachable.
    if (isStrictPrefix(text, existing) || isStrictPrefix(existing, text)) return false;
  }
  t.emplace(text, commandId);
  return true;
}

bool Keymap::unbind(InputProfile profile, const KeySequence& sequence) {
  return table(profile).erase(sequenceText(sequence)) != 0;
}

Resolution Keymap::resolve(InputProfile profile, const KeySequence& sequence) const {
  if (sequence.empty()) return Resolution{};
  const std::string text = sequenceText(sequence);
  const Table& t = table(profile);
  auto exact = t.find(text);
  if (exact != t.end()) return Resolution{ResolveStatus::Bound, exact->second};
  for (const auto& [existing, id] : t) {
    (void)id;
    if (isStrictPrefix(text, existing)) return Resolution{ResolveStatus::Pending, {}};
  }
  return Resolution{};
}

std::vector<std::string> Keymap::shortcutsFor(InputProfile profile,
                                              const std::string& commandId) const {
  std::vector<std::string> out;
  for (const auto& [text, id] : table(profile)) {
    if (id == commandId) out.push_back(text);
  }
  return out;  // std::map order: sorted, deterministic
}

std::size_t Keymap::bindingCount(InputProfile profile) const { return table(profile).size(); }

std::size_t Keymap::bindingCount() const {
  std::size_t n = 0;
  for (const Table& t : profiles_) n += t.size();
  return n;
}

std::vector<std::string> Keymap::boundCommandIds(InputProfile profile) const {
  std::vector<std::string> out;
  for (const auto& [text, id] : table(profile)) {
    (void)text;
    if (std::find(out.begin(), out.end(), id) == out.end()) out.push_back(id);
  }
  std::sort(out.begin(), out.end());
  return out;
}

std::vector<std::string> Keymap::allBoundCommandIds() const {
  std::vector<std::string> out;
  for (const Table& t : profiles_) {
    for (const auto& [text, id] : t) {
      (void)text;
      if (std::find(out.begin(), out.end(), id) == out.end()) out.push_back(id);
    }
  }
  std::sort(out.begin(), out.end());
  return out;
}

std::string Keymap::serialize() const {
  std::ostringstream os;
  os << "forge-keymap 1\n";
  for (InputProfile p : allInputProfiles()) {
    for (const auto& [text, id] : table(p)) {
      os << toString(p) << '\t' << text << '\t' << id << '\n';
    }
  }
  return os.str();
}

namespace {

bool parseStroke(const std::string& text, KeyStroke& out) {
  KeyStroke s;
  std::size_t at = 0;
  while (true) {
    const std::size_t plus = text.find('+', at);
    if (plus == std::string::npos) break;
    const std::string mod = text.substr(at, plus - at);
    if (mod == "Ctrl") {
      s.mods = s.mods | Mod::Ctrl;
    } else if (mod == "Alt") {
      s.mods = s.mods | Mod::Alt;
    } else if (mod == "Shift") {
      s.mods = s.mods | Mod::Shift;
    } else if (mod == "Super") {
      s.mods = s.mods | Mod::Super;
    } else {
      return false;  // an unknown token before a '+' is a corrupt file, not a key
    }
    at = plus + 1;
  }
  s.key = text.substr(at);
  if (s.key.empty()) return false;
  out = s;
  return true;
}

bool parseSequence(const std::string& text, KeySequence& out) {
  KeySequence seq;
  std::istringstream is(text);
  std::string tok;
  while (is >> tok) {
    KeyStroke s;
    if (!parseStroke(tok, s)) return false;
    seq.push_back(s);
  }
  if (seq.empty()) return false;
  out = seq;
  return true;
}

bool parseProfile(const std::string& name, InputProfile& out) {
  for (InputProfile p : allInputProfiles()) {
    if (name == toString(p)) {
      out = p;
      return true;
    }
  }
  return false;
}

}  // namespace

bool Keymap::parse(const std::string& text, Keymap& out) {
  Keymap built;
  std::istringstream is(text);
  std::string line;
  if (!std::getline(is, line) || line != "forge-keymap 1") return false;
  while (std::getline(is, line)) {
    if (line.empty()) continue;
    const std::size_t t1 = line.find('\t');
    if (t1 == std::string::npos) return false;
    const std::size_t t2 = line.find('\t', t1 + 1);
    if (t2 == std::string::npos) return false;

    InputProfile profile{};
    if (!parseProfile(line.substr(0, t1), profile)) return false;
    KeySequence seq;
    if (!parseSequence(line.substr(t1 + 1, t2 - t1 - 1), seq)) return false;
    const std::string id = line.substr(t2 + 1);
    if (!built.bind(profile, seq, id)) return false;
  }
  out = std::move(built);
  return true;
}

// ── the shipped default maps ────────────────────────────────────────────────
namespace {

KeyStroke k(const std::string& key, ModMask mods = 0) { return KeyStroke{key, mods}; }

}  // namespace

Keymap defaultKeymaps() {
  Keymap m;
  const ModMask ctrl = maskOf(Mod::Ctrl);
  const ModMask ctrlShift = Mod::Ctrl | Mod::Shift;
  const ModMask shift = maskOf(Mod::Shift);
  const ModMask alt = maskOf(Mod::Alt);

  // Forge-native — modern, modifier-led, VS Code style chords for the palette.
  m.bind(InputProfile::ForgeNative, {k("N", ctrl)}, "file.new");
  m.bind(InputProfile::ForgeNative, {k("O", ctrl)}, "file.open");
  m.bind(InputProfile::ForgeNative, {k("S", ctrl)}, "file.save");
  m.bind(InputProfile::ForgeNative, {k("Z", ctrl)}, "edit.undo");
  m.bind(InputProfile::ForgeNative, {k("Z", ctrlShift)}, "edit.redo");
  m.bind(InputProfile::ForgeNative, {k("Delete")}, "edit.delete");
  m.bind(InputProfile::ForgeNative, {k("F")}, "view.fit");
  m.bind(InputProfile::ForgeNative, {k("W")}, "view.wireframe");
  m.bind(InputProfile::ForgeNative, {k("E")}, "model.extrude");
  m.bind(InputProfile::ForgeNative, {k("R")}, "model.fillet");
  m.bind(InputProfile::ForgeNative, {k("H", ctrlShift)}, "model.shell");
  m.bind(InputProfile::ForgeNative, {k("K", ctrl), k("P", ctrl)}, "app.command_palette");
  m.bind(InputProfile::ForgeNative, {k("Tab", ctrl)}, "workspace.next");

  // NX-like — NX's Fit is Ctrl+F; Extrude is X; Sketch is S.
  m.bind(InputProfile::NXLike, {k("N", ctrl)}, "file.new");
  m.bind(InputProfile::NXLike, {k("O", ctrl)}, "file.open");
  m.bind(InputProfile::NXLike, {k("S", ctrl)}, "file.save");
  m.bind(InputProfile::NXLike, {k("Z", ctrl)}, "edit.undo");
  m.bind(InputProfile::NXLike, {k("Y", ctrl)}, "edit.redo");
  m.bind(InputProfile::NXLike, {k("Delete")}, "edit.delete");
  m.bind(InputProfile::NXLike, {k("F", ctrl)}, "view.fit");
  m.bind(InputProfile::NXLike, {k("W", ctrl)}, "view.wireframe");
  m.bind(InputProfile::NXLike, {k("X")}, "model.extrude");
  m.bind(InputProfile::NXLike, {k("B", ctrl)}, "model.fillet");
  m.bind(InputProfile::NXLike, {k("H", ctrl)}, "model.shell");
  m.bind(InputProfile::NXLike, {k("F3")}, "app.command_palette");
  m.bind(InputProfile::NXLike, {k("Tab", ctrl)}, "workspace.next");

  // CATIA-like — function-key led, as the V5 keyboard culture is.
  m.bind(InputProfile::CATIALike, {k("N", ctrl)}, "file.new");
  m.bind(InputProfile::CATIALike, {k("O", ctrl)}, "file.open");
  m.bind(InputProfile::CATIALike, {k("S", ctrl)}, "file.save");
  m.bind(InputProfile::CATIALike, {k("Z", ctrl)}, "edit.undo");
  m.bind(InputProfile::CATIALike, {k("Y", ctrl)}, "edit.redo");
  m.bind(InputProfile::CATIALike, {k("Delete")}, "edit.delete");
  m.bind(InputProfile::CATIALike, {k("F", alt)}, "view.fit");
  m.bind(InputProfile::CATIALike, {k("F9")}, "view.wireframe");
  m.bind(InputProfile::CATIALike, {k("P", ctrl)}, "model.extrude");
  m.bind(InputProfile::CATIALike, {k("F", ctrlShift)}, "model.fillet");
  m.bind(InputProfile::CATIALike, {k("F8")}, "model.shell");
  m.bind(InputProfile::CATIALike, {k("F1")}, "app.command_palette");
  m.bind(InputProfile::CATIALike, {k("F2")}, "workspace.next");

  // Blender-like — bare letters, no modifier, and Home fits the view.
  m.bind(InputProfile::BlenderLike, {k("N", ctrl)}, "file.new");
  m.bind(InputProfile::BlenderLike, {k("O", ctrl)}, "file.open");
  m.bind(InputProfile::BlenderLike, {k("S", ctrl)}, "file.save");
  m.bind(InputProfile::BlenderLike, {k("Z", ctrl)}, "edit.undo");
  m.bind(InputProfile::BlenderLike, {k("Z", ctrlShift)}, "edit.redo");
  m.bind(InputProfile::BlenderLike, {k("X")}, "edit.delete");
  m.bind(InputProfile::BlenderLike, {k("Home")}, "view.fit");
  m.bind(InputProfile::BlenderLike, {k("Z")}, "view.wireframe");
  m.bind(InputProfile::BlenderLike, {k("E")}, "model.extrude");
  m.bind(InputProfile::BlenderLike, {k("B", ctrl)}, "model.fillet");
  m.bind(InputProfile::BlenderLike, {k("I", alt)}, "model.shell");
  m.bind(InputProfile::BlenderLike, {k("F3", shift)}, "app.command_palette");
  m.bind(InputProfile::BlenderLike, {k("Tab", ctrl)}, "workspace.next");
  return m;
}

}  // namespace forge::ui
