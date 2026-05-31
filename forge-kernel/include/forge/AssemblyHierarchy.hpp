#pragma once

// AssemblyHierarchy — sub-assembly tree layered on ComponentRegistry.
//
// The base registry stores a flat list of instances. Real assemblies are
// trees: a "transmission" sub-assembly contains "input shaft" + "output
// shaft" sub-assemblies, each containing actual fastener / gear leaves.
//
// Forge-35 adds a parallel `parentInstanceId` table keyed by the same
// InstanceId so the existing flat queries (queryAABB, queryRay, etc.)
// keep working unchanged. The hierarchy is consulted only by the new
// world-transform composition (local × parent recursively) and by helpers
// like BomRollup that walk children.
//
// Default parent for every freshly-added instance is 0 (root / world).
// setParent() is idempotent; cycles are rejected at insertion time.
//
// Thread-safety mirrors ComponentRegistry: a single mutex serialises all
// mutations + reads. The tree is small enough (≤ thousands of nodes) that
// the lock contention is not a bottleneck even during interactive solves.

#include "forge/ComponentRegistry.hpp"

#include <cstdint>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace forge {

class AssemblyHierarchy {
public:
    static AssemblyHierarchy& instance();

    // Establish or change an instance's parent.
    //   parent == 0     → instance becomes a root child of the world frame.
    //   parent == child → throws (cycles are illegal).
    //   any ancestor of parent == child → throws (cycles are illegal).
    void setParent(InstanceId child, InstanceId parent);

    // 0 = root. Stable even if the instance never had setParent() called.
    InstanceId getParent(InstanceId child) const;

    // Immediate children (one level). Order matches insertion.
    std::vector<InstanceId> getChildren(InstanceId parent) const;

    // World transform = local × parent × … recursive up to root.
    // For instances with parent == 0 this equals ComponentRegistry's local
    // transform verbatim.
    Transform4x4 worldTransform(InstanceId instance) const;

    // Wipe every parent assignment. Smoke-test helper.
    void clearAll();

    // For diagnostics — total parent entries (children with parent != 0).
    std::size_t edgeCount() const;

private:
    AssemblyHierarchy() = default;

    bool wouldCreateCycle(InstanceId child, InstanceId proposedParent) const;

    mutable std::mutex mtx_;
    // child → parent. Missing entries imply parent == 0 (root).
    std::unordered_map<InstanceId, InstanceId> parentOf_;
    // parent → ordered children list. Mirrors parentOf_ for fast walks.
    std::unordered_map<InstanceId, std::vector<InstanceId>> childrenOf_;
};

// Multiply two row-major 4×4 transforms: out = a × b.
Transform4x4 multiplyTransforms(const Transform4x4& a, const Transform4x4& b);

} // namespace forge
