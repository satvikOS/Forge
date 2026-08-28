// ui/include/forge/ui/SelectionService.hpp
//
// The typed selection service required by Sacrosanct s19.2. FOUR states are kept
// SEPARATE, because collapsing any pair of them is the specific bug that makes a
// CAD selection model feel wrong:
//
//   preselection — what the cursor is over right now (highlight only). Moving
//                  the mouse must never disturb what the user has picked.
//   selection    — what the user has actually picked. The live working set.
//   focus        — the ONE member of the selection that is "current" (the edge a
//                  fillet radius field is editing, the row the keyboard is on).
//                  Focus follows selection, but arrowing focus does not reselect.
//   committed    — the snapshot a command took when it began. A dialog that is
//                  open must keep operating on the geometry it opened against,
//                  even as the user picks something else behind it.
//
// Everything resolves to a stable EntityRef, never a raw index.
#ifndef FORGE_UI_SELECTIONSERVICE_HPP
#define FORGE_UI_SELECTIONSERVICE_HPP

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "forge/ui/Types.hpp"

namespace forge::ui {

enum class SelectionChange : std::uint8_t {
  Preselection,
  Selection,
  Focus,
  Committed,
};

class SelectionService {
 public:
  using Listener = std::function<void(SelectionChange)>;

  SelectionService() = default;

  // ── preselection (hover) ────────────────────────────────────────────────
  void setPreselection(const EntityRef& ref);
  void clearPreselection();
  const std::optional<EntityRef>& preselection() const noexcept { return preselection_; }

  // ── selection ───────────────────────────────────────────────────────────
  // add() returns false if the ref is already selected (idempotent, not an error).
  bool add(const EntityRef& ref);
  bool remove(const EntityRef& ref);
  bool toggle(const EntityRef& ref);
  void replaceWith(const std::vector<EntityRef>& refs);
  void clearSelection();
  const std::vector<EntityRef>& selection() const noexcept { return selection_; }
  std::size_t count() const noexcept { return selection_.size(); }
  std::size_t countOf(EntityKind kind) const noexcept;
  bool contains(const EntityRef& ref) const noexcept;
  bool homogeneous() const noexcept;  // every selected ref has the same kind

  // ── focus ───────────────────────────────────────────────────────────────
  // Focus must be a member of the selection; setFocus on a non-member fails.
  bool setFocus(const EntityRef& ref);
  void clearFocus();
  const std::optional<EntityRef>& focus() const noexcept { return focus_; }
  bool advanceFocus(int delta);  // keyboard cycling through the selection

  // ── committed snapshot ──────────────────────────────────────────────────
  void commit();  // freeze the current selection as the committed set
  void clearCommitted();
  const std::vector<EntityRef>& committed() const noexcept { return committed_; }

  // ── filtering / observation ─────────────────────────────────────────────
  // A selection filter is how a CAD app makes "pick an edge" mean it: refs of a
  // disallowed kind are rejected outright rather than silently accepted.
  void setFilter(EntityKind kind) noexcept { filter_ = kind; }
  EntityKind filter() const noexcept { return filter_; }
  bool accepts(EntityKind kind) const noexcept;

  void addListener(Listener listener);
  std::size_t notificationCount() const noexcept { return notifications_; }

 private:
  void notify(SelectionChange what);
  std::vector<EntityRef>::const_iterator find(const EntityRef& ref) const noexcept;

  std::optional<EntityRef> preselection_;
  std::vector<EntityRef> selection_;
  std::optional<EntityRef> focus_;
  std::vector<EntityRef> committed_;
  EntityKind filter_ = EntityKind::Any;
  std::vector<Listener> listeners_;
  std::size_t notifications_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_SELECTIONSERVICE_HPP
