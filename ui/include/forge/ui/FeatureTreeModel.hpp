// ui/include/forge/ui/FeatureTreeModel.hpp
//
// The feature-tree UI that virtualizes enormous graphs (Sacrosanct s19.4). NX's
// assembly navigator and Blender's outliner both survive six-figure trees the
// same way, and it is the only way that works: the flattened index holds
// HANDLES, and the expensive per-row RECORD — label, icon, badges, validation
// state, suppression, the feature-IR op behind the row — is materialized only
// for rows the viewport can actually show, behind a bounded LRU.
//
// The contract this header exists to make testable:
//   * rowCount() may be 100,000 while materialized() never exceeds the cache
//     capacity (a few hundred), and peakMaterialized() proves it never did;
//   * the source's expensive fetch is called at most once per row entering the
//     window — scrolling the whole tree twice must not double the fetch count
//     for rows still resident;
//   * a row's data is CORRECT: row 99,999 returns exactly what the source holds.
//
// FeatureTreeSource is the seam onto the real document. It is deliberately
// handle-based: the model never needs the document to build a node object.
#ifndef FORGE_UI_FEATURETREEMODEL_HPP
#define FORGE_UI_FEATURETREEMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <list>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge::ui {

using NodeId = std::uint64_t;
inline constexpr NodeId kInvalidNode = 0;

enum class FeatureState : std::uint8_t { Ok, Warning, Error, Suppressed, Rolled };

// The EXPENSIVE record. Every field here costs the document work to produce:
// a localized label, an icon lookup, a validation state, the IR op behind it.
struct FeatureNodeData {
  NodeId id = kInvalidNode;
  std::string label;
  std::string iconKey;
  std::string featureIrOp;
  FeatureState state = FeatureState::Ok;
  bool visible = true;
};

class FeatureTreeSource {
 public:
  virtual ~FeatureTreeSource() = default;

  // CHEAP: pure structure. The model may call these while building the index.
  virtual NodeId rootId() const = 0;
  virtual std::size_t childCount(NodeId parent) const = 0;
  virtual NodeId childAt(NodeId parent, std::size_t index) const = 0;

  // EXPENSIVE: this is what virtualization exists to avoid calling 100,000 times.
  virtual FeatureNodeData data(NodeId id) const = 0;
};

struct Row {
  NodeId id = kInvalidNode;
  std::uint32_t depth = 0;
  bool hasChildren = false;
  bool expanded = false;
};
static_assert(sizeof(Row) <= 16, "the flattened index must stay a handle table");

class FeatureTreeModel {
 public:
  explicit FeatureTreeModel(const FeatureTreeSource& source, std::size_t cacheCapacity = 256);

  // Structure. rebuild() re-flattens from the expansion set; it touches only the
  // cheap structural calls, never data().
  void rebuild();
  std::size_t rowCount() const noexcept { return rows_.size(); }
  const Row& rowAt(std::size_t index) const;

  void setExpanded(NodeId id, bool expanded);
  bool isExpanded(NodeId id) const;
  void expandAll();     // marks every node with children expanded, then re-flattens
  void collapseAll();   // back to the root's children only

  // The virtualized read. Returns the rows in [first, first+count), fetching the
  // expensive record only for rows not already resident.
  std::vector<FeatureNodeData> window(std::size_t first, std::size_t count);
  std::optional<FeatureNodeData> rowData(std::size_t index);

  // Instrumentation the virtualization gate asserts on.
  std::size_t materialized() const noexcept { return cache_.size(); }
  std::size_t peakMaterialized() const noexcept { return peak_; }
  std::size_t cacheCapacity() const noexcept { return capacity_; }
  std::size_t cacheHits() const noexcept { return hits_; }
  std::size_t cacheMisses() const noexcept { return misses_; }
  // Bytes the flattened index costs — handles only, no strings.
  std::size_t indexFootprintBytes() const noexcept { return rows_.size() * sizeof(Row); }
  void resetCounters() noexcept;

  // Search over structure without materializing: finds the row index of a node.
  std::optional<std::size_t> rowOf(NodeId id) const;

 private:
  void flattenFrom(NodeId parent, std::uint32_t depth);
  const FeatureNodeData& fetch(NodeId id);
  void evictIfNeeded();

  const FeatureTreeSource& source_;
  std::size_t capacity_;
  std::vector<Row> rows_;
  std::unordered_set<NodeId> expanded_;
  bool expandAllMode_ = false;

  // LRU: list holds the records, map indexes into it.
  std::list<FeatureNodeData> lru_;
  std::unordered_map<NodeId, std::list<FeatureNodeData>::iterator> cache_;
  std::size_t peak_ = 0;
  std::size_t hits_ = 0;
  std::size_t misses_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_FEATURETREEMODEL_HPP
