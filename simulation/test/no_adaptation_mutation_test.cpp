// no_adaptation_mutation_test — the mutation the no-adaptation rule exists to
// catch, actually inserted, and the gate actually going red.
//
// THE MUTATION
// ------------
// `chunk.dt = cfg.solverDt * 1.25` immediately before the integrator call:
// precisely the "quietly enlarge the timestep to catch up" that
// RealtimeLoop.hpp outlaws, and precisely the failure SR-4 forbids, because it
// changes the physics while the animation keeps looking smooth.
//
// WHY THIS GATE EXISTS
// --------------------
// Until the driver read its evidence back OUT of the integrator, this mutation
// was INVISIBLE to every assertion in the suite. `solverDtFirst`,
// `solverDtLast`, `stepsPerFrameMin/Max` and each frame's `simTime` were all
// derived from the MbdConfig handed IN, so every one of them kept reporting the
// declared timestep while the solver marched at a different one. The
// determinism gate could not see it either: it compares two runs of the same
// code, and the mutation moves both identically. An evidence chain nobody can
// break is not evidence, so the fix has to come with a gate that breaks the
// UNFIXED chain -- this one.
//
// HOW IT IS INSERTED WITHOUT TOUCHING PRODUCTION SOURCE
// ----------------------------------------------------
// A SECOND copy of the driver is compiled from the very same
// simulation/src/RealtimeLoop.cpp, with its integrator call macro-redirected
// through a wrapper that enlarges the timestep by 25%, and its two entry points
// renamed so both copies link into one binary. Nothing in simulation/src is
// modified, the other three gates keep running the unmutated driver, and the
// mutated and unmutated drivers here are the same source text by construction
// -- so a future edit that reintroduces the defect is mutated too, and this
// gate goes red again.

#include "forge/simulation/MechanismCase.hpp"
#include "forge/simulation/RealtimeLoop.hpp"
#include "TestHarness.hpp"

// Everything RealtimeLoop.cpp includes, pulled in BEFORE the macros below so
// that no header text is ever seen through them.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace forge {
namespace simulation {

// The mutation itself. Chunk calls only (steps > 1): the initial-state probe
// is left honest so the enlargement lands exactly where the reviewer put it --
// on the stepping call inside the frame loop.
inline MbdResult inflatedSimulateMultibody(const std::vector<MbdBody>& bodies,
                                           const std::vector<MbdConstraint>& constraints,
                                           const std::vector<MbdLoad>& loads,
                                           const MbdGravity& gravity,
                                           const MbdConfig& cfg) {
    MbdConfig mutated = cfg;
    if (cfg.steps > 1) mutated.dt = cfg.dt * 1.25;
    return ::forge::simulateMultibody(bodies, constraints, loads, gravity, mutated);
}

}  // namespace simulation
}  // namespace forge

#define simulateMultibody  inflatedSimulateMultibody
#define driveRealtime      driveRealtimeMutated
#define geometryRevisionOf geometryRevisionOfMutated
#define observedSolverDt   observedSolverDtMutated
#include "../src/RealtimeLoop.cpp"
#undef observedSolverDt
#undef geometryRevisionOf
#undef driveRealtime
#undef simulateMultibody

using namespace forge::simulation;

namespace {

constexpr double kDeclaredDt   = 1e-4;
constexpr double kInflation    = 1.25;
constexpr std::uint32_t kSteps = 200;

RealtimeLoopConfig gateConfig(const MechanismModel& m) {
    RealtimeLoopConfig cfg;
    cfg.solverDt         = kDeclaredDt;
    cfg.stepsPerFrame    = kSteps;
    cfg.frameCount       = 6;
    cfg.alpha            = -0.02;
    cfg.baumgarteOmega   = 150.0;
    cfg.baumgarteZeta    = 1.0;
    cfg.envelope.targetFrameRateHz      = 1.0;   // a budget nothing can miss
    cfg.envelope.warnConstraintResidual = 1e-7;
    cfg.envelope.maxConstraintResidual  = 1e-6;
    cfg.envelope.maxEnergyDrift         = 1e-5;
    cfg.envelope.maxWallOverrunRatio    = 1.0;
    cfg.geometryRevision = geometryRevisionOf(m.bodies, m.constraints, m.loads, m.gravity);
    return cfg;
}

forge::MbdConfig chunkOf(const RealtimeLoopConfig& cfg) {
    forge::MbdConfig c;
    c.dt             = cfg.solverDt;
    c.steps          = cfg.stepsPerFrame;
    c.alpha          = cfg.alpha;
    c.baumgarteOmega = cfg.baumgarteOmega;
    c.baumgarteZeta  = cfg.baumgarteZeta;
    c.sampleStride   = cfg.stepsPerFrame;
    return c;
}

}  // namespace

int main() {
    forge::simtest::TestRun t("no_adaptation_mutation");

    const SliderCrankSpec spec;
    const MechanismModel model = buildSliderCrank(spec);
    const RealtimeLoopConfig cfg = gateConfig(model);

    // ---- 1. the control: the real driver, unmutated -----------------------
    FrameSink controlSink;
    const RealtimeRun control =
        driveRealtime(model.bodies, model.constraints, model.loads, model.gravity,
                      cfg, sliderCrankProbes, controlSink);

    t.predicate("control run (unmutated driver) completed", control.completed,
                "abortReason=\"" + control.abortReason + "\" accepted=" +
                std::to_string(control.framesAccepted));
    t.equalU64("control emitted every declared frame", control.framesAccepted, cfg.frameCount);
    t.near("control: measured dt never fell below the declared one",
           control.solverDtMin, cfg.solverDt, 0.0);
    t.near("control: measured dt never rose above the declared one",
           control.solverDtMax, cfg.solverDt, 0.0);
    t.near("control: simulated seconds == steps * declared dt",
           control.simulatedSeconds,
           static_cast<double>(cfg.frameCount - 1) * kSteps * cfg.solverDt, 1e-12);

    // ---- 2. the same driver with the timestep enlarged 25% behind its back -
    FrameSink mutatedSink;
    const RealtimeRun mutated =
        driveRealtimeMutated(model.bodies, model.constraints, model.loads, model.gravity,
                             cfg, sliderCrankProbes, mutatedSink);

    t.predicate("MUTATED run is refused, not shipped", !mutated.completed,
                "completed=" + std::string(mutated.completed ? "true" : "false") +
                " abortReason=\"" + mutated.abortReason + "\"");
    t.equalStr("...and it says exactly what it caught", mutated.abortReason,
               "integrator used dt=0.000125 s in frame 1 where the run "
               "declared dt=0.0001 s (silent timestep adaptation)");
    t.atMost("...having emitted no stepped frame at all",
             static_cast<double>(mutated.framesAccepted), 1.0);
    t.near("...and the dt it MEASURED is the enlarged one, not the declared one",
           mutated.solverDtMax, kDeclaredDt * kInflation, 1e-18);
    t.atLeast("...i.e. 25% away from declared, vastly outside the 1e-9 match tolerance",
              std::abs(mutated.solverDtMax - cfg.solverDt) / cfg.solverDt, 0.249);

    // ---- 3. WHY the old evidence could not catch it -----------------------
    // The mutated chunk still takes exactly the number of steps it was asked
    // for, so the step count -- the only quantity the driver used to read back
    // from the integrator -- is bit-identical. Everything else the run used to
    // report was arithmetic on the config. The trajectory, meanwhile, has
    // visibly moved. Only the timestep readback separates the two.
    {
        const forge::MbdConfig chunk = chunkOf(cfg);
        const forge::MbdResult honest =
            forge::simulateMultibody(model.bodies, model.constraints, model.loads,
                                     model.gravity, chunk);
        const forge::MbdResult inflated =
            inflatedSimulateMultibody(model.bodies, model.constraints, model.loads,
                                      model.gravity, chunk);

        t.equalU64("the mutation leaves stepsTaken bit-identical",
                   inflated.stepsTaken, honest.stepsTaken);
        t.equalU64("...and leaves the config-derived step ladder bit-identical",
                   static_cast<std::uint64_t>(chunk.steps), kSteps);

        double maxMove = 0.0;
        const auto& a = honest.samples.back();
        const auto& b = inflated.samples.back();
        for (std::size_t i = 0; i < a.position.size() && i < b.position.size(); ++i) {
            for (int k = 0; k < 3; ++k) {
                maxMove = std::max(maxMove, std::abs(a.position[i][k] - b.position[i][k]));
            }
        }
        t.atLeast("...while the state after one chunk really did move (m)", maxMove, 1e-4);

        t.near("readback of the honest chunk reports the declared timestep",
               observedSolverDt(honest), cfg.solverDt, 0.0);
        t.near("readback of the mutated chunk reports the ENLARGED timestep",
               observedSolverDt(inflated), kDeclaredDt * kInflation, 1e-18);
        t.note("one chunk: honest dt=" + std::to_string(observedSolverDt(honest)) +
               " mutated dt=" + std::to_string(observedSolverDt(inflated)) +
               " maxPositionMove=" + std::to_string(maxMove) + " m");
    }

    return t.exitCode();
}
