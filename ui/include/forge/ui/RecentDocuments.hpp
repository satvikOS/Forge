// ui/include/forge/ui/RecentDocuments.hpp
//
// WHERE DID I LEAVE MY PART? — the documents this installation has opened or
// saved, most recent first.
//
// ── the defect this closes, measured on the shipped path ────────────────────
// `file.open` declares its `path` parameter REQUIRED with no default, and it is
// right to: "" is not a document. So Ctrl+O opens the parameter prompt, and the
// prompt seeds the box from `documentPath_` — the document that is already open.
// On a FRESH LAUNCH there is no open document, so the box is EMPTY, and the only
// way to reopen yesterday's part is to type its absolute path from memory.
//
// That breaks the exact loop the product is judged on: open, model, save,
// reopen. It is worse than it looks, because `file.save` with no path writes to
// ~/.forge/<name>.fpart — a directory the user never chose, never sees and has
// no reason to guess. A user could therefore save successfully and be unable to
// find the file again, with nothing anywhere reporting a failure.
//
// This is the model that fixes it: a bounded most-recently-used list, owned by
// ForgeShell, persisted in the session file beside the workspace and the keymap,
// and written by the SAME `file.open` / `file.save` handlers a menu click, a
// keystroke, `--open` on the command line and an Archie tool call all dispatch.
// One writer, so a path can never be remembered by one invoker and not another.
//
// ── what it deliberately is NOT ─────────────────────────────────────────────
// It is not a file existence check and it never touches the filesystem. A part
// on an unmounted volume is still the part the user last worked on, and a list
// that silently dropped it would be a list that forgets things for reasons it
// cannot explain. `file.open` already reports a missing file as a refusal the
// user can read; that is the right place for that answer, and it is why
// remembering happens only AFTER a successful open or save.
#ifndef FORGE_UI_RECENTDOCUMENTS_HPP
#define FORGE_UI_RECENTDOCUMENTS_HPP

#include <cstddef>
#include <string>
#include <vector>

namespace forge::ui {

class RecentDocuments {
 public:
  // Ten, matching the length every desktop application's File > Open Recent has
  // settled on. Bounded because this is persisted into the session file and an
  // unbounded list is a file that grows for ever.
  static constexpr std::size_t kDefaultCapacity = 10;

  explicit RecentDocuments(std::size_t capacity = kDefaultCapacity);

  // Can this path be stored AT ALL? Two refusals, and the second is not
  // hypothetical: a POSIX path may legally contain a newline, and the session
  // file is line-oriented, so writing one would emit a `recent` record whose
  // remainder parses as a further record — silently corrupting the workspace,
  // the layouts or the keymap that follow it. Refusing to remember such a path
  // costs a menu entry; writing it costs the user their session.
  static bool isStorable(const std::string& path) noexcept;

  // Records `path` as the most recent. A path already in the list MOVES to the
  // front rather than appearing twice, so reopening the same part repeatedly
  // does not evict everything else. Returns false — and changes nothing — when
  // isStorable() refuses the path.
  bool remember(const std::string& path);

  // Removes `path`. Returns whether it was there. Nothing in the app calls this
  // on the user's behalf: it exists so a surface can offer "remove from this
  // list" without reaching into the vector.
  bool forget(const std::string& path);
  void clear() noexcept;

  // Index 0 is the most recent.
  const std::vector<std::string>& paths() const noexcept { return paths_; }
  std::size_t size() const noexcept { return paths_.size(); }
  std::size_t capacity() const noexcept { return capacity_; }
  bool empty() const noexcept { return paths_.empty(); }
  bool contains(const std::string& path) const noexcept;

  // "" when nothing has ever been remembered. This is what the parameter prompt
  // seeds an empty path box from, which is the whole point of the class.
  const std::string& mostRecent() const noexcept;

  // Replaces the entire list, in order, index 0 being the most recent. Entries
  // isStorable() refuses and duplicates are dropped, and the result is truncated
  // to capacity. Returns how many entries were KEPT.
  //
  // Restoring in order rather than replaying remember() over the file is not a
  // style choice: remember() pushes to the FRONT, so replaying a most-recent-
  // first file through it would load the list REVERSED, and the session file
  // would silently invert the user's history on every launch.
  std::size_t restore(const std::vector<std::string>& paths);

  // The basename, extension included. "" for a path that ends in '/'.
  static std::string leafName(const std::string& path);

  // One label per entry, index-aligned with paths(). The leaf alone where that
  // leaf is unique in the list; the WHOLE PATH where it is not — two files both
  // called bracket.fpart in different directories must not present as two
  // identical menu items, because then the menu cannot say which is which.
  std::vector<std::string> labels() const;

 private:
  std::vector<std::string> paths_;
  std::size_t capacity_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_RECENTDOCUMENTS_HPP
