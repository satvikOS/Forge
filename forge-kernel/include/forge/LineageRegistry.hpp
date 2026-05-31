#pragma once

// Forge-60 — Lineage registry.
//
// JS-side ForgeTopoIdRegistry consumes a list of survivor / split /
// merge / birth / death entries. Native ops (Booleans, Fillet, Hole,
// Shell, Extrude, …) build that list by walking
//   BRepAlgoAPI_*::Modified(faceInA)
//   BRepAlgoAPI_*::Generated(faceInA)
//   BRepAlgoAPI_*::IsDeleted(faceInA)
// and store the result keyed by the OUTPUT shape handle. The binding
// (binding.cpp) exposes `forge.lineageFor(handle)` which returns the
// list as a JS Array.
//
// The registry is a thread-safe singleton, mirroring ShapeRegistry.

#include <cstdint>
#include <mutex>
#include <unordered_map>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge {

struct LineageEntry {
  enum class Kind : uint8_t {
    Survivor, Split, Merge, Birth, Death,
  };
  Kind kind;
  // For each kind:
  //   Survivor : oldIndices=[oldIdx], newIndices=[newIdx]
  //   Split    : oldIndices=[oldIdx], newIndices=[newIdx, …]
  //   Merge    : oldIndices=[oldIdx, …], newIndices=[newIdx]
  //   Birth    : oldIndices=[],         newIndices=[newIdx], originOp set
  //   Death    : oldIndices=[oldIdx],   newIndices=[]
  std::vector<uint32_t> oldIndices;
  std::vector<uint32_t> newIndices;
  std::string entityKind;     // "face" | "edge" | "vertex"
  std::string originOp;       // op name (e.g. "cut", "fillet", "extrude")
};

class LineageRegistry {
 public:
  static LineageRegistry& instance();

  /** Stash the lineage list for an output shape handle. Overwrites
   *  any prior entry for that handle. */
  void put(ShapeHandle out, std::vector<LineageEntry> entries);

  /** Copy out the lineage list (empty if none recorded). */
  std::vector<LineageEntry> get(ShapeHandle out) const;

  /** True iff an entry exists for `out`. */
  bool has(ShapeHandle out) const;

  /** Drop the entry for `out`. */
  void erase(ShapeHandle out);

 private:
  LineageRegistry() = default;
  mutable std::mutex mu_;
  std::unordered_map<ShapeHandle, std::vector<LineageEntry>> store_;
};

}  // namespace forge
