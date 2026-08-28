#include "forge/simulation/RealtimeLoop.hpp"

#include "forge/AssemblySolver.hpp"  // forge::rodrigues (axis-angle -> 3x3)

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace forge {
namespace simulation {
namespace {

constexpr std::uint64_t kFnvOffset = 1469598103934665603ULL;
constexpr std::uint64_t kFnvPrime  = 1099511628211ULL;

inline void mixU64(std::uint64_t& h, std::uint64_t v) {
    for (int i = 0; i < 8; ++i) {
        h ^= static_cast<std::uint64_t>((v >> (8 * i)) & 0xFF);
        h *= kFnvPrime;
    }
}

inline void mixDouble(std::uint64_t& h, double d) {
    if (d == 0.0) d = 0.0;
    std::uint64_t bits = 0;
    std::memcpy(&bits, &d, sizeof(bits));
    mixU64(h, bits);
}

using Clock = std::chrono::steady_clock;

double secondsSince(const Clock::time_point& t0) {
    return std::chrono::duration<double>(Clock::now() - t0).count();
}

bool sampleFinite(const MbdSample& s) {
    for (std::size_t b = 0; b < s.position.size(); ++b) {
        for (int i = 0; i < 3; ++i) {
            if (!std::isfinite(s.position[b][i]) || !std::isfinite(s.orientation[b][i]) ||
                !std::isfinite(s.linVel[b][i])   || !std::isfinite(s.angVel[b][i])) {
                return false;
            }
        }
    }
    return std::isfinite(s.energy) && std::isfinite(s.constraintResidual);
}

// Copy a solver sample into the frame's body-transform payload, converting the
// solver's axis-angle generalised coordinate to an explicit world rotation
// matrix via the kernel's own Rodrigues routine (no second implementation).
void fillBodies(const MbdSample& s, std::vector<BodyTransform>& out) {
    out.clear();
    out.reserve(s.position.size());
    for (std::size_t b = 0; b < s.position.size(); ++b) {
        BodyTransform t;
        t.body = static_cast<std::uint32_t>(b);
        t.position        = s.position[b];
        t.linearVelocity  = s.linVel[b];
        t.angularVelocity = s.angVel[b];
        t.rotation = forge::rodrigues(s.orientation[b][0], s.orientation[b][1],
                                      s.orientation[b][2]);
        out.push_back(std::move(t));
    }
}

// Feed a solver sample back in as the next chunk's initial condition. Position
// and velocity are carried EXACTLY; mass and inertia are unchanged.
void carryState(const MbdSample& s, std::vector<MbdBody>& bodies) {
    for (std::size_t b = 0; b < bodies.size() && b < s.position.size(); ++b) {
        bodies[b].position    = s.position[b];
        bodies[b].orientation = s.orientation[b];
        bodies[b].linVel      = s.linVel[b];
        bodies[b].angVel      = s.angVel[b];
    }
}

}  // namespace

std::uint64_t geometryRevisionOf(const std::vector<MbdBody>& bodies,
                                 const std::vector<MbdConstraint>& constraints) {
    std::uint64_t h = kFnvOffset;
    mixU64(h, static_cast<std::uint64_t>(bodies.size()));
    for (const auto& b : bodies) {
        mixDouble(h, b.mass);
        for (double v : b.inertia)     mixDouble(h, v);
        for (double v : b.position)    mixDouble(h, v);
        for (double v : b.orientation) mixDouble(h, v);
        for (double v : b.linVel)      mixDouble(h, v);
        for (double v : b.angVel)      mixDouble(h, v);
    }
    mixU64(h, static_cast<std::uint64_t>(constraints.size()));
    for (const auto& c : constraints) {
        mixU64(h, static_cast<std::uint64_t>(c.kind));
        mixU64(h, c.bodyA);
        mixU64(h, c.bodyB);
        for (double v : c.pointA) mixDouble(h, v);
        for (double v : c.pointB) mixDouble(h, v);
        for (double v : c.anchor) mixDouble(h, v);
        for (double v : c.axis)   mixDouble(h, v);
        mixDouble(h, c.value);
    }
    // The contract rejects revision 0; the fold reaching exactly 0 is
    // astronomically unlikely but it is not impossible, so map it away rather
    // than emit a frame that the contract would reject for a hash collision.
    return h == 0 ? kFnvPrime : h;
}

RealtimeRun driveRealtime(const std::vector<MbdBody>& bodies,
                          const std::vector<MbdConstraint>& constraints,
                          const std::vector<MbdLoad>& loads,
                          const MbdGravity& gravity,
                          const RealtimeLoopConfig& cfg,
                          const ProbeFn& probeFn,
                          FrameSink& sink) {
    RealtimeRun run;

    // --- reject a configuration that cannot produce evidence ---------------
    if (cfg.geometryRevision == 0) {
        run.abortReason = "config names no geometry revision (geometryRevision == 0)";
        return run;
    }
    if (!(cfg.solverDt > 0.0) || !std::isfinite(cfg.solverDt)) {
        run.abortReason = "solverDt must be a positive finite timestep";
        return run;
    }
    if (cfg.stepsPerFrame == 0) {
        run.abortReason = "stepsPerFrame must be >= 1";
        return run;
    }
    if (cfg.frameCount == 0) {
        run.abortReason = "frameCount must be >= 1";
        return run;
    }
    if (!(cfg.envelope.targetFrameRateHz > 0.0)) {
        run.abortReason = "envelope.targetFrameRateHz must be positive";
        return run;
    }
    if (bodies.empty()) {
        run.abortReason = "model has no bodies";
        return run;
    }

    run.declaredFrameBudgetSeconds = 1.0 / cfg.envelope.targetFrameRateHz;
    run.solverDtFirst    = cfg.solverDt;
    run.solverDtLast     = cfg.solverDt;
    run.stepsPerFrameMin = cfg.stepsPerFrame;
    run.stepsPerFrameMax = cfg.stepsPerFrame;

    // Working copy of the model state; only position/orientation/velocity are
    // ever written, and only from the previous chunk's final solver sample.
    std::vector<MbdBody> state = bodies;

    // Chunk configuration. Both fields are written ONCE, here, and are never
    // recomputed inside the loop -- that is the structural guarantee behind
    // the no-adaptation rule, not merely a promise in a comment.
    MbdConfig chunk;
    chunk.dt              = cfg.solverDt;
    chunk.steps           = cfg.stepsPerFrame;
    chunk.alpha           = cfg.alpha;
    chunk.baumgarteOmega  = cfg.baumgarteOmega;
    chunk.baumgarteZeta   = cfg.baumgarteZeta;
    chunk.sampleStride    = cfg.stepsPerFrame;  // record only the chunk end

    // Frame 0 is the initial state at t = 0. It consumes zero integrator steps,
    // so it is produced by a zero-length probe of the model rather than by a
    // step: a single-step run whose FIRST sample (which simulateMultibody
    // always records at t = 0) is the untouched initial condition.
    MbdConfig probeCfg = chunk;
    probeCfg.steps        = 1;
    probeCfg.sampleStride = 1;

    const Clock::time_point runStart = Clock::now();

    MbdSample initial;
    double initialProbeSeconds = 0.0;
    {
        const Clock::time_point probeStart = Clock::now();
        const MbdResult r0 = simulateMultibody(state, constraints, loads, gravity, probeCfg);
        initialProbeSeconds = secondsSince(probeStart);
        if (r0.samples.empty()) {
            run.abortReason = "integrator returned no samples for the initial state";
            return run;
        }
        initial = r0.samples.front();  // t == 0, untouched initial condition
    }
    if (!sampleFinite(initial)) {
        run.abortReason = "initial state is not finite";
        return run;
    }
    run.initialEnergy = initial.energy;
    const double E0 = initial.energy;

    std::uint64_t solverStep = 0;
    double simTime = 0.0;

    for (std::uint32_t fi = 0; fi < cfg.frameCount; ++fi) {
        const Clock::time_point frameStart = Clock::now();

        MbdSample sample;
        bool diverged = false;

        if (fi == 0) {
            sample = initial;
        } else {
            const MbdResult r =
                simulateMultibody(state, constraints, loads, gravity, chunk);

            // A short chunk means the integrator bailed out. That is a skipped
            // step, and it is reported -- never absorbed.
            if (r.stepsTaken != cfg.stepsPerFrame || r.samples.size() < 2) {
                run.abortReason = "integrator advanced " + std::to_string(r.stepsTaken) +
                                  " of " + std::to_string(cfg.stepsPerFrame) +
                                  " requested steps in frame " + std::to_string(fi);
                run.framesEmitted = fi;
                run.sequenceHash = sink.sequenceHash();
                return run;
            }
            sample = r.samples.back();
            if (!r.stable || !sampleFinite(sample)) diverged = true;

            solverStep += cfg.stepsPerFrame;
            run.totalSolverSteps += cfg.stepsPerFrame;
            simTime = static_cast<double>(solverStep) * cfg.solverDt;
            if (!diverged) carryState(sample, state);
            run.maxConstraintResidual =
                std::max(run.maxConstraintResidual, r.maxConstraintDrift);
        }

        AnimationFrame f;
        f.frameIndex       = fi;
        f.simTime          = simTime;
        f.geometryRevision = cfg.geometryRevision;
        f.solverStep       = solverStep;
        fillBodies(sample, f.bodies);
        if (probeFn) probeFn(sample, f.probes);

        f.constraintResidual = sample.constraintResidual;
        f.energyDrift = (std::abs(E0) > 1e-12) ? std::abs(sample.energy - E0) / std::abs(E0)
                                               : std::abs(sample.energy - E0);
        run.maxEnergyDrift = std::max(run.maxEnergyDrift, f.energyDrift);
        run.maxConstraintResidual =
            std::max(run.maxConstraintResidual, sample.constraintResidual);

        // Frame 0's real cost includes the initial-state probe taken before the
        // loop; charging it here keeps the wall-clock accounting honest rather
        // than making the first frame look free.
        const double wall = secondsSince(frameStart) + (fi == 0 ? initialProbeSeconds : 0.0);
        f.solverWallSeconds  = wall;
        f.frameBudgetSeconds = run.declaredFrameBudgetSeconds;
        const double overrun = wall / run.declaredFrameBudgetSeconds;
        run.maxWallOverrunRatio = std::max(run.maxWallOverrunRatio, overrun);
        run.totalSolverWallSeconds += wall;

        // --- validity, in strictly decreasing severity -----------------------
        if (diverged) {
            f.validity = ValidityState::Diverged;
        } else if (f.constraintResidual > cfg.envelope.maxConstraintResidual ||
                   f.energyDrift > cfg.envelope.maxEnergyDrift) {
            f.validity = ValidityState::Invalid;
        } else if (overrun > cfg.envelope.maxWallOverrunRatio ||
                   f.constraintResidual > cfg.envelope.warnConstraintResidual) {
            f.validity = ValidityState::Degraded;
        } else {
            f.validity = ValidityState::Valid;
        }

        f.resultHash = computeResultHash(f);

        ++run.framesEmitted;
        if (f.validity == ValidityState::Degraded) ++run.degradedFrames;
        if (f.validity == ValidityState::Invalid)  ++run.invalidFrames;

        if (sink.accept(f)) {
            ++run.framesAccepted;
        } else {
            ++run.framesRejected;
        }

        if (diverged) {
            run.abortReason = "integrator diverged at frame " + std::to_string(fi);
            run.sequenceHash = sink.sequenceHash();
            return run;
        }

        // Real-time pacing. Sleeping the REMAINDER of the budget is the only
        // adaptation permitted: it changes when the frame is handed over, never
        // what is in it. When the budget is already spent there is no sleep and
        // the frame is already marked Degraded above.
        if (cfg.paceToRealtime && wall < run.declaredFrameBudgetSeconds) {
            std::this_thread::sleep_for(
                std::chrono::duration<double>(run.declaredFrameBudgetSeconds - wall));
        }
    }

    const double totalWall = secondsSince(runStart);
    run.achievedFrameRateHz =
        totalWall > 0.0 ? static_cast<double>(run.framesEmitted) / totalWall : 0.0;
    run.sequenceHash = sink.sequenceHash();
    run.completed = (run.framesAccepted == cfg.frameCount) && (run.framesRejected == 0);
    if (!run.completed && run.abortReason.empty()) {
        run.abortReason = std::to_string(run.framesRejected) +
                          " frame(s) rejected by the frame contract";
    }
    return run;
}

}  // namespace simulation
}  // namespace forge
