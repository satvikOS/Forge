#include "forge/simulation/RealtimeLoop.hpp"

#include "forge/AssemblySolver.hpp"  // forge::rodrigues (axis-angle -> 3x3)

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

// Relative tolerance on measured-vs-declared timestep. The readback computes
// (steps * dt) / steps, so the only discrepancy a faithful integrator can
// introduce is float rounding -- a couple of ULP, ~4e-16 relative. 1e-9 sits
// seven orders above that and far below any adaptation worth making.
constexpr double kDtMatchRelTol = 1e-9;

// Full-precision rendering, so an abort reason names the timestep exactly
// rather than rounding two different values onto the same six decimals.
std::string fmtG(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.17g", v);
    return std::string(buf);
}

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

double observedSolverDt(const MbdResult& r) {
    if (r.stepsTaken == 0 || r.samples.size() < 2) return 0.0;
    const double dtUsed = r.samples.back().t / static_cast<double>(r.stepsTaken);
    if (!std::isfinite(dtUsed) || !(dtUsed > 0.0)) return 0.0;
    return dtUsed;
}

std::uint64_t geometryRevisionOf(const std::vector<MbdBody>& bodies,
                                 const std::vector<MbdConstraint>& constraints,
                                 const std::vector<MbdLoad>& loads,
                                 const MbdGravity& gravity) {
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
    // Loads and gravity change the trajectory exactly as much as a joint does,
    // so a revision that omitted them would name two different runs the same.
    mixU64(h, static_cast<std::uint64_t>(loads.size()));
    for (const auto& l : loads) {
        mixU64(h, l.body);
        for (double v : l.force)  mixDouble(h, v);
        for (double v : l.torque) mixDouble(h, v);
    }
    for (double v : gravity.g) mixDouble(h, v);
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

    // --- the no-adaptation READBACK ----------------------------------------
    // Nothing below copies cfg.solverDt into the run report. Every dt recorded
    // is observedSolverDt() of the result the integrator just handed back, so
    // a timestep changed between here and the integrator moves the evidence.
    bool sawSolverDt = false;
    auto observeDt = [&](const MbdResult& r) -> double {
        const double dtUsed = observedSolverDt(r);
        if (dtUsed == 0.0) return 0.0;
        if (!sawSolverDt) {
            run.solverDtFirst = dtUsed;
            run.solverDtMin   = dtUsed;
            run.solverDtMax   = dtUsed;
            sawSolverDt = true;
        } else {
            run.solverDtMin = std::min(run.solverDtMin, dtUsed);
            run.solverDtMax = std::max(run.solverDtMax, dtUsed);
        }
        run.solverDtLast = dtUsed;
        return dtUsed;
    };
    auto adaptationReason = [&](double dtUsed, const std::string& where) {
        return "integrator used dt=" + fmtG(dtUsed) + " s in " + where +
               " where the run declared dt=" + fmtG(cfg.solverDt) +
               " s (silent timestep adaptation)";
    };

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
        // The probe is a real integrator call at the run's declared timestep,
        // so it is the run's FIRST piece of no-adaptation evidence.
        const double probeDt = observeDt(r0);
        if (probeDt == 0.0) {
            run.abortReason = "integrator reported no usable time base for the initial state";
            return run;
        }
        if (std::abs(probeDt - cfg.solverDt) > kDtMatchRelTol * cfg.solverDt) {
            run.abortReason = adaptationReason(probeDt, "the initial-state probe");
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
        // Largest ‖Φ‖ the integrator passed through INSIDE this frame's
        // interval. Frame 0 closes no interval, so it stays 0 and the frame's
        // reported maximum collapses onto its instantaneous residual.
        double intraFrameMaxResidual = 0.0;

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

            // What the integrator SAYS it did, before anything is believed
            // about what it was asked to do.
            const double dtUsed = observeDt(r);
            if (dtUsed == 0.0) {
                run.abortReason = "integrator reported no usable time base in frame " +
                                  std::to_string(fi);
                run.framesEmitted = fi;
                run.sequenceHash = sink.sequenceHash();
                return run;
            }
            if (std::abs(dtUsed - cfg.solverDt) > kDtMatchRelTol * cfg.solverDt) {
                run.abortReason = adaptationReason(dtUsed, "frame " + std::to_string(fi));
                run.framesEmitted = fi;
                run.sequenceHash = sink.sequenceHash();
                return run;
            }

            sample = r.samples.back();
            if (!r.stable || !sampleFinite(sample) || !std::isfinite(r.maxConstraintDrift))
                diverged = true;

            const std::uint32_t stepsUsed = r.stepsTaken;
            if (run.stepsPerFrameMin == 0 || stepsUsed < run.stepsPerFrameMin)
                run.stepsPerFrameMin = stepsUsed;
            run.stepsPerFrameMax = std::max(run.stepsPerFrameMax, stepsUsed);

            solverStep           += stepsUsed;
            run.totalSolverSteps += stepsUsed;
            // Simulated time comes from the integrator's own clock, summed
            // chunk by chunk -- not from stepCount * declared dt, which would
            // report the same seconds no matter what the integrator did.
            run.simulatedSeconds += r.samples.back().t;
            simTime = run.simulatedSeconds;

            if (!diverged) carryState(sample, state);
            intraFrameMaxResidual = r.maxConstraintDrift;
        }

        AnimationFrame f;
        f.frameIndex       = fi;
        f.simTime          = simTime;
        f.geometryRevision = cfg.geometryRevision;
        f.solverStep       = solverStep;
        fillBodies(sample, f.bodies);
        if (probeFn) probeFn(sample, f.probes);

        f.constraintResidual = sample.constraintResidual;
        // The classifier's input. A residual that spikes and recovers between
        // two frame instants is a real excursion off the constraint manifold;
        // reading only the instant would ship it as a clean frame.
        f.maxConstraintResidual =
            std::max(intraFrameMaxResidual, sample.constraintResidual);
        f.energyDrift = (std::abs(E0) > 1e-12) ? std::abs(sample.energy - E0) / std::abs(E0)
                                               : std::abs(sample.energy - E0);
        run.maxEnergyDrift = std::max(run.maxEnergyDrift, f.energyDrift);
        run.maxConstraintResidual =
            std::max(run.maxConstraintResidual, f.maxConstraintResidual);

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
        } else if (f.maxConstraintResidual > cfg.envelope.maxConstraintResidual ||
                   f.energyDrift > cfg.envelope.maxEnergyDrift) {
            f.validity = ValidityState::Invalid;
        } else if (overrun > cfg.envelope.maxWallOverrunRatio ||
                   f.maxConstraintResidual > cfg.envelope.warnConstraintResidual) {
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
