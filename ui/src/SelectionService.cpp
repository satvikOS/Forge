#include "forge/ui/SelectionService.hpp"

#include <algorithm>
#include <cstddef>
#include <utility>
#include <vector>

#include "forge/ui/Types.hpp"

namespace forge::ui {

std::vector<EntityRef>::const_iterator SelectionService::find(const EntityRef& ref) const noexcept {
  return std::find(selection_.begin(), selection_.end(), ref);
}

bool SelectionService::accepts(EntityKind kind) const noexcept {
  if (kind == EntityKind::None) return false;
  return filter_ == EntityKind::Any || filter_ == kind;
}

void SelectionService::notify(SelectionChange what) {
  ++notifications_;
  for (const Listener& l : listeners_) {
    if (l) l(what);
  }
}

void SelectionService::addListener(Listener listener) { listeners_.push_back(std::move(listener)); }

// ── preselection ────────────────────────────────────────────────────────────
void SelectionService::setPreselection(const EntityRef& ref) {
  if (!ref.valid() || !accepts(ref.kind)) {
    clearPreselection();
    return;
  }
  if (preselection_.has_value() && *preselection_ == ref) return;
  preselection_ = ref;
  notify(SelectionChange::Preselection);
}

void SelectionService::clearPreselection() {
  if (!preselection_.has_value()) return;
  preselection_.reset();
  notify(SelectionChange::Preselection);
}

// ── selection ───────────────────────────────────────────────────────────────
bool SelectionService::contains(const EntityRef& ref) const noexcept {
  return find(ref) != selection_.end();
}

bool SelectionService::add(const EntityRef& ref) {
  if (!ref.valid() || !accepts(ref.kind)) return false;
  if (contains(ref)) return false;
  selection_.push_back(ref);
  if (!focus_.has_value()) focus_ = ref;
  notify(SelectionChange::Selection);
  return true;
}

bool SelectionService::remove(const EntityRef& ref) {
  auto it = find(ref);
  if (it == selection_.end()) return false;
  const std::size_t index = static_cast<std::size_t>(it - selection_.begin());
  selection_.erase(selection_.begin() + static_cast<std::ptrdiff_t>(index));
  if (focus_.has_value() && *focus_ == ref) {
    if (selection_.empty()) {
      focus_.reset();
    } else {
      focus_ = selection_[std::min(index, selection_.size() - 1)];
    }
  }
  notify(SelectionChange::Selection);
  return true;
}

bool SelectionService::toggle(const EntityRef& ref) {
  if (contains(ref)) {
    remove(ref);
    return false;
  }
  return add(ref);
}

void SelectionService::replaceWith(const std::vector<EntityRef>& refs) {
  selection_.clear();
  focus_.reset();
  for (const EntityRef& r : refs) {
    if (!r.valid() || !accepts(r.kind)) continue;
    if (std::find(selection_.begin(), selection_.end(), r) == selection_.end()) {
      selection_.push_back(r);
    }
  }
  if (!selection_.empty()) focus_ = selection_.front();
  notify(SelectionChange::Selection);
}

void SelectionService::clearSelection() {
  if (selection_.empty() && !focus_.has_value()) return;
  selection_.clear();
  focus_.reset();
  notify(SelectionChange::Selection);
}

std::size_t SelectionService::countOf(EntityKind kind) const noexcept {
  std::size_t n = 0;
  for (const EntityRef& r : selection_) {
    if (r.kind == kind) ++n;
  }
  return n;
}

bool SelectionService::homogeneous() const noexcept {
  if (selection_.size() <= 1) return true;
  const EntityKind k = selection_.front().kind;
  for (const EntityRef& r : selection_) {
    if (r.kind != k) return false;
  }
  return true;
}

// ── focus ───────────────────────────────────────────────────────────────────
bool SelectionService::setFocus(const EntityRef& ref) {
  if (!contains(ref)) return false;  // focus is always a member of the selection
  if (focus_.has_value() && *focus_ == ref) return true;
  focus_ = ref;
  notify(SelectionChange::Focus);
  return true;
}

void SelectionService::clearFocus() {
  if (!focus_.has_value()) return;
  focus_.reset();
  notify(SelectionChange::Focus);
}

bool SelectionService::advanceFocus(int delta) {
  if (selection_.empty() || delta == 0) return false;
  const std::ptrdiff_t n = static_cast<std::ptrdiff_t>(selection_.size());
  std::ptrdiff_t at = 0;
  if (focus_.has_value()) {
    auto it = find(*focus_);
    if (it != selection_.end()) at = it - selection_.begin();
  }
  std::ptrdiff_t next = (at + static_cast<std::ptrdiff_t>(delta)) % n;
  if (next < 0) next += n;
  focus_ = selection_[static_cast<std::size_t>(next)];
  notify(SelectionChange::Focus);
  return true;
}

// ── committed ───────────────────────────────────────────────────────────────
void SelectionService::commit() {
  committed_ = selection_;  // a copy: later selection edits must not reach it
  notify(SelectionChange::Committed);
}

void SelectionService::clearCommitted() {
  if (committed_.empty()) return;
  committed_.clear();
  notify(SelectionChange::Committed);
}

}  // namespace forge::ui
