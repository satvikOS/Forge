#pragma once

// InterferenceDetection — pairwise solid-intersection check for an
// assembly subset.
//
// Algorithm (Forge-35):
//   1. Compute per-instance world-space AABBs.
//   2. Use a broad-phase BVH-style sweep (O(N log N) build, O(N + k)
//      query) to enumerate candidate pairs whose AABBs overlap with a
//      `tolerance` inflation.
//   3. For every candidate pair, transform the BREP shapes into world
//      space and run `BRepAlgoAPI_Common`. If the result has non-zero
//      volume, record the pair and the volume of intersection.
//
// Returned pairs are deduplicated (instA < instB) and sorted by the first
// instance id then the second so the smoke can assert a deterministic
// order.

#include "forge/ComponentRegistry.hpp"

#include <cstdint>
#include <vector>

namespace forge {

struct InterferencePair {
    InstanceId instA;
    InstanceId instB;
    double     volume;   // volume of the solid intersection, mm³
};

// `tolerance` mm — applied as a symmetric AABB inflation so near-misses
// inside the tolerance are also evaluated by the exact boolean. Pairs
// whose boolean result is empty (or whose volume is below
// kInterferenceMinVolume) are dropped.
std::vector<InterferencePair> detectInterference(
    const std::vector<InstanceId>& instances,
    double tolerance);

constexpr double kInterferenceMinVolume = 1e-9;

} // namespace forge
