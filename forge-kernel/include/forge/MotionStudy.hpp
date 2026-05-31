#pragma once

// MotionStudy — drive a configured mate (Distance / Angle) through a
// parametric sweep and capture per-step world transforms.
//
// Algorithm:
//   * Locate a driving mate that references the motor instance + axis.
//     Preference: Distance, then Angle. Forge-35 sweeps `value` from its
//     current setting through `+totalAngleRad` over `timeSteps` evenly-
//     spaced positions.
//   * Each step: temporarily mutate that mate's `value`, re-solve via
//     AssemblySolver, snapshot every solver-touched instance's transform.
//   * After the run, the mate is restored to its original value and the
//     solver is re-run once so callers see no net state change.
//
// Each frame is `{ t (0..1), transforms[id → Transform4x4] }`. The
// `transforms` map is keyed by every instance id that participates in
// any active mate plus the motor itself.

#include "forge/AssemblySolver.hpp"
#include "forge/ComponentRegistry.hpp"

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace forge {

struct MotionFrame {
    double t;            // 0..1 normalised time
    double value;        // mate-value at this step
    bool   converged;    // solver convergence flag
    std::unordered_map<InstanceId, Transform4x4> transforms;
};

struct MotionRun {
    std::vector<MotionFrame> frames;
    bool   allConverged;
    double maxResidual;
};

// `motorInstanceId` — the moving driver. `motorAxis` — the schematic topo
// id (matches MateRef::topoId; typically 1 = primary axis or 0 = origin).
// We pick the first active mate whose `a.inst == motorInstanceId` or
// `b.inst == motorInstanceId` and matching `topoId`, preferring Distance
// then Angle. Throws if no driving mate is found.
MotionRun runMotionStudy(
    InstanceId motorInstanceId,
    std::uint32_t motorAxis,
    double totalAngleRad,
    std::uint32_t timeSteps);

} // namespace forge
