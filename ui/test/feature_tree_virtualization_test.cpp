// ui/test/feature_tree_virtualization_test.cpp
//
// CONTRACT 5 — the feature-tree model VIRTUALIZES: it presents a 100,000-node
// tree without materializing all nodes.
//
// The source below is a real 100,101-node assembly graph (100 subassemblies x
// 100 parts x 9 features). It COUNTS every expensive data() fetch, so the gate is
// a measurement, not an assertion of intent:
//
//   * scrolling to row 99,000 of 100,101 costs exactly as many fetches as the
//     window has rows — not 99,000, and not 100,101;
//   * simultaneous materialization never exceeds the LRU capacity, proven by a
//     peak watermark taken across a full end-to-end scroll of the whole tree;
//   * the flattened index is a HANDLE table: 16 bytes a row against a ~117-byte
//     record (MEASURED below and printed on every run), and what is actually
//     resident at any instant is under 1% of the whole tree's record cost.
//
// Remove the LRU bound, or make the model fetch data() while flattening, and
// these numbers move immediately.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <vector>

#include "forge/ui/FeatureTreeModel.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

constexpr std::size_t kAssemblies = 100;
constexpr std::size_t kPartsPerAssembly = 100;
constexpr std::size_t kFeaturesPerPart = 9;
constexpr std::size_t kParts = kAssemblies * kPartsPerAssembly;              // 10,000
constexpr std::size_t kFeatures = kParts * kFeaturesPerPart;                 // 90,000
constexpr std::size_t kTotalNodes = 1 + kAssemblies + kParts + kFeatures;    // 100,101

constexpr NodeId kRoot = 1;
constexpr NodeId kAssemblyBase = 2;        // 2 .. 101
constexpr NodeId kPartBase = 1000;         // 1000 .. 10999
constexpr NodeId kFeatureBase = 200000;    // 200000 .. 289999

std::string decimal(std::size_t n) {
  std::string out;
  if (n == 0) return "0";
  while (n > 0) {
    out.insert(out.begin(), static_cast<char>('0' + static_cast<int>(n % 10)));
    n /= 10;
  }
  return out;
}

// A synthetic document of the size a real machine tool or airframe assembly
// reaches. Structure is cheap; data() is deliberately expensive and counted.
class BigAssemblySource final : public FeatureTreeSource {
 public:
  NodeId rootId() const override { return kRoot; }

  std::size_t childCount(NodeId parent) const override {
    ++structureCalls_;
    if (parent == kRoot) return kAssemblies;
    if (parent >= kAssemblyBase && parent < kAssemblyBase + kAssemblies) return kPartsPerAssembly;
    if (parent >= kPartBase && parent < kPartBase + kParts) return kFeaturesPerPart;
    return 0;
  }

  NodeId childAt(NodeId parent, std::size_t index) const override {
    ++structureCalls_;
    if (parent == kRoot) return kAssemblyBase + static_cast<NodeId>(index);
    if (parent >= kAssemblyBase && parent < kAssemblyBase + kAssemblies) {
      const std::size_t assembly = static_cast<std::size_t>(parent - kAssemblyBase);
      return kPartBase + static_cast<NodeId>(assembly * kPartsPerAssembly + index);
    }
    if (parent >= kPartBase && parent < kPartBase + kParts) {
      const std::size_t part = static_cast<std::size_t>(parent - kPartBase);
      return kFeatureBase + static_cast<NodeId>(part * kFeaturesPerPart + index);
    }
    return kInvalidNode;
  }

  FeatureNodeData data(NodeId id) const override {
    ++dataCalls_;  // THE call virtualization exists to avoid making 100,101 times
    FeatureNodeData d;
    d.id = id;
    if (id == kRoot) {
      d.label = "Airframe (top level)";
      d.iconKey = "icon.assembly.root";
      d.featureIrOp = "ROOT";
    } else if (id < kPartBase) {
      d.label = "Subassembly " + decimal(static_cast<std::size_t>(id - kAssemblyBase));
      d.iconKey = "icon.assembly";
      d.featureIrOp = "COMPONENT";
    } else if (id < kFeatureBase) {
      d.label = "Part " + decimal(static_cast<std::size_t>(id - kPartBase));
      d.iconKey = "icon.part";
      d.featureIrOp = "BODY";
    } else {
      const std::size_t f = static_cast<std::size_t>(id - kFeatureBase);
      d.label = "Feature " + decimal(f);
      d.iconKey = "icon.feature";
      d.featureIrOp = (f % 3 == 0) ? "EXTRUDE" : ((f % 3 == 1) ? "FILLET" : "HOLE");
      d.state = (f % 997 == 0) ? FeatureState::Warning : FeatureState::Ok;
    }
    return d;
  }

  std::size_t dataCalls() const noexcept { return dataCalls_; }
  std::size_t structureCalls() const noexcept { return structureCalls_; }
  void resetCounts() const noexcept {
    dataCalls_ = 0;
    structureCalls_ = 0;
  }

  // What ONE materialized record actually costs, heap included.
  static std::size_t recordBytes(const FeatureNodeData& d) {
    return sizeof(FeatureNodeData) + d.label.size() + d.iconKey.size() + d.featureIrOp.size();
  }

 private:
  mutable std::size_t dataCalls_ = 0;
  mutable std::size_t structureCalls_ = 0;
};

}  // namespace

int main() {
  Harness H("feature_tree_virtualization");

  const BigAssemblySource source;
  const std::size_t cacheCapacity = 256;
  FeatureTreeModel model(source, cacheCapacity);

  // ── construction touches structure only, never a record ─────────────────
  CHECK_EQ_INT(source.dataCalls(), 0);
  CHECK_EQ_INT(model.rowCount(), 1 + kAssemblies);  // root + its children, collapsed below
  CHECK_EQ_INT(model.materialized(), 0);

  // ── a 100,101-node tree, fully expanded ─────────────────────────────────
  model.expandAll();
  CHECK_EQ_INT(model.rowCount(), kTotalNodes);
  CHECK(model.rowCount() > 100000);
  CHECK_EQ_INT(source.dataCalls(), 0);  // flattening 100,101 nodes fetched NOTHING
  CHECK_EQ_INT(model.materialized(), 0);

  // depth is right: root 0, assembly 1, part 2, feature 3
  CHECK_EQ_INT(model.rowAt(0).depth, 0);
  CHECK_EQ_INT(model.rowAt(1).depth, 1);
  CHECK_EQ_INT(model.rowAt(2).depth, 2);
  CHECK_EQ_INT(model.rowAt(3).depth, 3);
  CHECK(model.rowAt(0).hasChildren);
  CHECK(!model.rowAt(3).hasChildren);
  CHECK_EQ_INT(source.dataCalls(), 0);  // and reading structure still fetches nothing

  // ── one viewport-sized window deep in the tree ──────────────────────────
  source.resetCounts();
  const std::size_t rowsOnScreen = 50;
  const std::vector<FeatureNodeData> page = model.window(99000, rowsOnScreen);
  CHECK_EQ_INT(page.size(), rowsOnScreen);
  CHECK_EQ_INT(source.dataCalls(), rowsOnScreen);  // exactly the visible rows. Not 99,050.
  CHECK_EQ_INT(model.materialized(), rowsOnScreen);
  CHECK_LE_INT(model.peakMaterialized(), cacheCapacity);

  // and the rows are CORRECT, not merely cheap
  const Row& deep = model.rowAt(99000);
  const FeatureNodeData direct = source.data(deep.id);
  CHECK_EQ_STR(page[0].label, direct.label);
  CHECK_EQ_INT(page[0].id, deep.id);
  CHECK_EQ_STR(page[0].featureIrOp, direct.featureIrOp);

  // re-requesting the same window is served entirely from the cache
  source.resetCounts();
  const std::vector<FeatureNodeData> again = model.window(99000, rowsOnScreen);
  CHECK_EQ_INT(source.dataCalls(), 0);
  CHECK_EQ_INT(again.size(), rowsOnScreen);
  CHECK_EQ_STR(again[10].label, page[10].label);

  // the last row of the tree resolves correctly
  const std::optional<FeatureNodeData> last = model.rowData(model.rowCount() - 1);
  CHECK(last.has_value());
  CHECK_EQ_STR(last->label, "Feature " + decimal(kFeatures - 1));
  CHECK_EQ_STR(last->iconKey, "icon.feature");

  // ── scroll the ENTIRE 100,101-row tree end to end ───────────────────────
  // Every row is presented; simultaneous materialization still never exceeds
  // the cache. This is the distinction that matters: presenting all of them is
  // fine, holding all of them is not.
  source.resetCounts();
  model.resetCounters();
  std::size_t rowsSeen = 0;
  for (std::size_t first = 0; first < model.rowCount(); first += rowsOnScreen) {
    const std::vector<FeatureNodeData> chunk = model.window(first, rowsOnScreen);
    rowsSeen += chunk.size();
    CHECK_LE_INT(model.materialized(), cacheCapacity);
  }
  CHECK_EQ_INT(rowsSeen, kTotalNodes);
  CHECK_LE_INT(model.peakMaterialized(), cacheCapacity);
  CHECK_LE_INT(model.materialized(), cacheCapacity);
  CHECK_LE_INT(source.dataCalls(), kTotalNodes);
  // ...and no fewer than that minus what was already resident: every row really
  // was presented, so this is virtualization, not a silent skip.
  CHECK(source.dataCalls() + cacheCapacity >= kTotalNodes);

  // ── the flattened index is a HANDLE table, not a record table ───────────
  CHECK_EQ_INT(sizeof(Row), 16);
  const std::size_t indexBytes = model.indexFootprintBytes();
  CHECK_EQ_INT(indexBytes, kTotalNodes * sizeof(Row));

  // measure what materializing every record would actually cost, from a sample
  std::size_t sampleBytes = 0;
  const std::size_t sampleCount = 256;
  for (std::size_t i = 0; i < sampleCount; ++i) {
    const std::size_t row = (model.rowCount() / sampleCount) * i;
    sampleBytes += BigAssemblySource::recordBytes(source.data(model.rowAt(row).id));
  }
  const std::size_t avgRecordBytes = sampleBytes / sampleCount;
  const std::size_t fullMaterializationBytes = avgRecordBytes * kTotalNodes;
  CHECK(avgRecordBytes > sizeof(Row));
  // MEASURED on Apple clang 21 / libc++: 117 B a record against 16 B a handle,
  // i.e. 7.3x. The bound is 5x rather than the order of magnitude one might
  // guess, because libc++'s small-string optimisation keeps these short labels
  // inside the record instead of on the heap. A real document's localized
  // labels and tooltips are longer, so the true ratio only grows.
  CHECK(indexBytes * 5 < fullMaterializationBytes);
  std::printf("  [info] index %zu B for %zu rows; full materialization ~%zu B (%.1fx)\n",
              indexBytes, kTotalNodes, fullMaterializationBytes,
              static_cast<double>(fullMaterializationBytes) / static_cast<double>(indexBytes));

  // resident bytes are bounded by the cache, not by the tree: after presenting
  // every one of the 100,101 rows, under 1% of the full cost is still held.
  const std::size_t residentBytes = model.materialized() * avgRecordBytes;
  CHECK(residentBytes * 100 < fullMaterializationBytes);

  // ── expansion state drives the index, and stays cheap ───────────────────
  model.collapseAll();
  CHECK_EQ_INT(model.rowCount(), 1 + kAssemblies);
  model.setExpanded(kAssemblyBase, true);
  CHECK_EQ_INT(model.rowCount(), 1 + kAssemblies + kPartsPerAssembly);
  model.setExpanded(kPartBase, true);
  CHECK_EQ_INT(model.rowCount(), 1 + kAssemblies + kPartsPerAssembly + kFeaturesPerPart);
  model.setExpanded(kAssemblyBase, false);
  CHECK_EQ_INT(model.rowCount(), 1 + kAssemblies);
  CHECK(!model.isExpanded(kAssemblyBase));

  // rowOf finds a node's position without materializing anything
  source.resetCounts();
  model.expandAll();
  const std::optional<std::size_t> where = model.rowOf(kFeatureBase + 12345);
  CHECK(where.has_value());
  CHECK_EQ_INT(model.rowAt(*where).id, kFeatureBase + 12345);
  CHECK_EQ_INT(source.dataCalls(), 0);
  CHECK(!model.rowOf(999999999).has_value());

  // out-of-range access is answered, not crashed into
  CHECK(!model.rowData(model.rowCount()).has_value());
  CHECK_EQ_INT(model.window(model.rowCount(), 10).size(), 0);
  CHECK_EQ_INT(model.window(0, 0).size(), 0);
  CHECK_EQ_INT(model.window(model.rowCount() - 3, 100).size(), 3);  // clipped at the end

  return H.finish();
}
