// ui/include/forge/ui/Keymap.hpp
//
// Input-map profiles — Forge-native, NX-like, CATIA-like, Blender-like — over
// the SAME command IDs (Sacrosanct s19.2). A profile is a pure binding table; it
// owns no behaviour. That is the whole point: an NX user pressing Ctrl+Shift+K
// and a Blender user pressing Shift+C must reach ONE command implementation, not
// two, so a fix to that command fixes it for every profile at once.
//
// Bindings are key SEQUENCES, not single chords, because Blender-like and
// CATIA-like maps both use them (Blender: `G` then axis; NX: Ctrl+K then a
// letter). resolve() therefore reports Pending for a live prefix, which is what
// lets the shell hold a partially typed sequence without eating unrelated keys.
#ifndef FORGE_UI_KEYMAP_HPP
#define FORGE_UI_KEYMAP_HPP

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace forge::ui {

enum class InputProfile : std::uint8_t {
  ForgeNative = 0,
  NXLike,
  CATIALike,
  BlenderLike,
};

inline constexpr std::size_t kInputProfileCount = 4;
// The slug: "nx-like". A settings key, not a menu label.
const char* toString(InputProfile profile) noexcept;
// The name in the menu.
const char* userText(InputProfile profile) noexcept;
std::vector<InputProfile> allInputProfiles();

enum class Mod : std::uint8_t {
  None = 0,
  Shift = 1 << 0,
  Ctrl = 1 << 1,
  Alt = 1 << 2,
  Super = 1 << 3,
};

using ModMask = std::uint8_t;
constexpr ModMask maskOf(Mod m) noexcept { return static_cast<ModMask>(m); }
constexpr ModMask operator|(Mod a, Mod b) noexcept {
  return static_cast<ModMask>(static_cast<std::uint8_t>(a) | static_cast<std::uint8_t>(b));
}
constexpr ModMask operator|(ModMask a, Mod b) noexcept {
  return static_cast<ModMask>(a | static_cast<std::uint8_t>(b));
}

struct KeyStroke {
  std::string key;  // canonical key name: "A", "F5", "Escape", "MouseMiddle", ...
  ModMask mods = 0;

  std::string toText() const;  // "Ctrl+Shift+K" — deterministic, round-trippable
};

bool operator==(const KeyStroke& a, const KeyStroke& b) noexcept;

using KeySequence = std::vector<KeyStroke>;
std::string sequenceText(const KeySequence& seq);  // strokes joined with a space

enum class ResolveStatus : std::uint8_t {
  Unbound = 0,  // no binding and no binding starts this way
  Pending,      // a strict prefix of at least one binding — keep collecting
  Bound,        // exact match
};

struct Resolution {
  ResolveStatus status = ResolveStatus::Unbound;
  std::string commandId;  // set iff status == Bound
};

class Keymap {
 public:
  // Binding fails on an empty sequence, an empty command ID, or a CONFLICT: the
  // same sequence already bound in that profile, or a sequence that is a strict
  // prefix of (or extended by) an existing binding — an unreachable binding is a
  // silent bug, so it is refused at bind time rather than discovered in use.
  bool bind(InputProfile profile, const KeySequence& sequence, const std::string& commandId);
  bool unbind(InputProfile profile, const KeySequence& sequence);

  Resolution resolve(InputProfile profile, const KeySequence& sequence) const;

  // Reverse lookup for menus and tooltips: every shortcut bound to this command
  // in this profile, deterministically ordered.
  std::vector<std::string> shortcutsFor(InputProfile profile, const std::string& commandId) const;

  std::size_t bindingCount(InputProfile profile) const;
  std::size_t bindingCount() const;
  std::vector<std::string> boundCommandIds(InputProfile profile) const;

  // Every command ID bound in ANY profile — used to prove that a profile's
  // bindings only ever name commands the one registry actually holds.
  std::vector<std::string> allBoundCommandIds() const;

  // Serialization for user-editable shortcut files.
  std::string serialize() const;
  static bool parse(const std::string& text, Keymap& out);

 private:
  using Table = std::map<std::string, std::string>;  // sequence text -> command id
  const Table& table(InputProfile profile) const;
  Table& table(InputProfile profile);

  std::vector<Table> profiles_{kInputProfileCount, Table{}};
};

// The shipped default maps. Each takes the SAME set of command IDs and binds them
// the way that CAD culture expects; none of them introduces a command of its own.
Keymap defaultKeymaps();

}  // namespace forge::ui

#endif  // FORGE_UI_KEYMAP_HPP
