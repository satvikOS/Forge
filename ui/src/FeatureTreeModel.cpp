#include "forge/ui/FeatureTreeModel.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <list>
#include <optional>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace forge::ui {

FeatureTreeModel::FeatureTreeModel(const FeatureTreeSource& source, std::size_t cacheCapacity)
    : source_(source), capacity_(std::max<std::size_t>(cacheCapacity, 1)) {
  expanded_.insert(source_.rootId());
  rebuild();
}

bool FeatureTreeModel::isExpanded(NodeId id) const {
  if (expandAllMode_) return true;
  return expanded_.find(id) != expanded_.end();
}

void FeatureTreeModel::setExpanded(NodeId id, bool expanded) {
  if (expanded) {
    expanded_.insert(id);
  } else {
    expandAllMode_ = false;  // an explicit collapse leaves "everything open" mode
    expanded_.erase(id);
  }
  rebuild();
}

void FeatureTreeModel::expandAll() {
  // A flag, not a 100,000-entry set: "expanded" is the default state, and the
  // exception set stays empty until the user actually collapses something.
  expandAllMode_ = true;
  rebuild();
}

void FeatureTreeModel::collapseAll() {
  expandAllMode_ = false;
  expanded_.clear();
  expanded_.insert(source_.rootId());
  rebuild();
}

void FeatureTreeModel::rebuild() {
  rows_.clear();

  struct Frame {
    NodeId node;
    std::size_t next;
    std::uint32_t depth;
  };
  std::vector<Frame> stack;

  const auto pushNode = [&](NodeId id, std::uint32_t depth) {
    const std::size_t childCount = source_.childCount(id);
    Row row;
    row.id = id;
    row.depth = depth;
    row.hasChildren = childCount != 0;
    row.expanded = row.hasChildren && isExpanded(id);
    rows_.push_back(row);
    if (row.expanded) stack.push_back(Frame{id, 0, depth});
  };

  const NodeId root = source_.rootId();
  if (root == kInvalidNode) return;
  pushNode(root, 0);

  while (!stack.empty()) {
    const std::size_t top = stack.size() - 1;
    const NodeId node = stack[top].node;
    const std::uint32_t depth = stack[top].depth;
    const std::size_t childCount = source_.childCount(node);
    if (stack[top].next >= childCount) {
      stack.pop_back();
      continue;
    }
    const NodeId child = source_.childAt(node, stack[top].next);
    ++stack[top].next;
    pushNode(child, depth + 1);  // may push a frame; `top` is no longer used
  }
}

const Row& FeatureTreeModel::rowAt(std::size_t index) const {
  if (index >= rows_.size()) throw std::out_of_range("FeatureTreeModel::rowAt");
  return rows_[index];
}

void FeatureTreeModel::evictIfNeeded() {
  while (cache_.size() > capacity_) {
    const NodeId victim = lru_.back().id;
    lru_.pop_back();
    cache_.erase(victim);
  }
}

const FeatureNodeData& FeatureTreeModel::fetch(NodeId id) {
  auto it = cache_.find(id);
  if (it != cache_.end()) {
    ++hits_;
    lru_.splice(lru_.begin(), lru_, it->second);  // most-recently used
    return *it->second;
  }
  ++misses_;
  lru_.push_front(source_.data(id));  // the one expensive call
  cache_[id] = lru_.begin();
  evictIfNeeded();
  peak_ = std::max(peak_, cache_.size());
  return lru_.front();
}

std::vector<FeatureNodeData> FeatureTreeModel::window(std::size_t first, std::size_t count) {
  std::vector<FeatureNodeData> out;
  if (first >= rows_.size() || count == 0) return out;
  const std::size_t last = std::min(rows_.size(), first + count);
  out.reserve(last - first);
  for (std::size_t i = first; i < last; ++i) {
    out.push_back(fetch(rows_[i].id));  // copied out immediately; eviction-safe
  }
  return out;
}

std::optional<FeatureNodeData> FeatureTreeModel::rowData(std::size_t index) {
  if (index >= rows_.size()) return std::nullopt;
  return fetch(rows_[index].id);
}

std::optional<std::size_t> FeatureTreeModel::rowOf(NodeId id) const {
  for (std::size_t i = 0; i < rows_.size(); ++i) {
    if (rows_[i].id == id) return i;
  }
  return std::nullopt;
}

void FeatureTreeModel::resetCounters() noexcept {
  hits_ = 0;
  misses_ = 0;
  peak_ = cache_.size();
}

}  // namespace forge::ui
