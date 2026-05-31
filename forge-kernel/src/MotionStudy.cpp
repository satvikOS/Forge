#include "forge/MotionStudy.hpp"

#include <algorithm>
#include <stdexcept>
#include <unordered_set>

namespace forge {

MotionRun runMotionStudy(
    InstanceId motorInstanceId,
    std::uint32_t motorAxis,
    double totalAngleRad,
    std::uint32_t timeSteps) {
    if (timeSteps == 0) {
        throw std::invalid_argument("runMotionStudy: timeSteps must be ≥ 1");
    }
    if (!ComponentRegistry::instance().exists(motorInstanceId)) {
        throw std::invalid_argument("runMotionStudy: motor instance does not exist");
    }

    auto& solver = AssemblySolver::instance();
    const MateId driver = solver.findDrivingMate(motorInstanceId, motorAxis);
    if (driver == kInvalidMate) {
        throw std::invalid_argument(
            "runMotionStudy: no Distance/Angle mate references the motor instance");
    }

    const Mate originalMate = solver.getMate(driver);
    const double startValue = originalMate.value;

    // Snapshot every active mate's instance set — these are the ones the
    // solver moves; we capture their transforms each frame.
    std::unordered_set<InstanceId> tracked;
    for (const auto& m : solver.listMates()) {
        if (!m.active) continue;
        tracked.insert(m.a.inst);
        tracked.insert(m.b.inst);
    }
    tracked.insert(motorInstanceId);

    // Snapshot the original world transforms so we can restore them at
    // the end of the run (a motion study should leave the assembly state
    // exactly as it was found).
    std::unordered_map<InstanceId, Transform4x4> originals;
    originals.reserve(tracked.size());
    for (auto id : tracked) {
        originals[id] = ComponentRegistry::instance().getTransform(id);
    }

    MotionRun run;
    run.frames.reserve(timeSteps);
    run.allConverged = true;
    run.maxResidual = 0.0;

    for (std::uint32_t step = 0; step < timeSteps; ++step) {
        const double t = (timeSteps == 1) ? 1.0
            : static_cast<double>(step) / static_cast<double>(timeSteps - 1);
        const double value = startValue + t * totalAngleRad;
        solver.setMateValue(driver, value);
        SolveReport rep = solver.solve();
        if (!rep.converged) run.allConverged = false;
        if (rep.residual > run.maxResidual) run.maxResidual = rep.residual;

        MotionFrame frame;
        frame.t = t;
        frame.value = value;
        frame.converged = rep.converged;
        frame.transforms.reserve(tracked.size());
        for (auto id : tracked) {
            frame.transforms[id] = ComponentRegistry::instance().getTransform(id);
        }
        run.frames.push_back(std::move(frame));
    }

    // Restore mate value + instance transforms + re-solve once so the
    // assembly is left at its starting pose.
    solver.setMateValue(driver, startValue);
    for (auto& [id, xform] : originals) {
        ComponentRegistry::instance().updateTransform(id, xform);
    }
    // Re-solve to ensure constraints hold against the restored state.
    solver.solve();

    return run;
}

} // namespace forge
