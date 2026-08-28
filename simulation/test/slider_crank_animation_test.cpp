// slider_crank_animation_test — a concrete animated case, end to end.
//
// Runs the slider-crank through a FULL crank rotation as a real-time frame
// sequence and proves the animation is physical WITHOUT looking at it:
//
//   1. every emitted frame satisfies the frame contract and the declared envelope
//   2. the emitted slider travel matches x(theta) = r cos(theta)
//      + sqrt(l^2 - r^2 sin^2(theta)) at the emitted crank angle
//   3. the sequence is genuinely MOVING (SR-4): the crank angle advances
//      monotonically past 360 degrees and the slider sweeps its full 2r stroke
//   4. replaying the same initial state and input reproduces a byte-identical
//      frame sequence
//   5. a confirmation run at half the timestep agrees inside a declared bound
//   6. the frames are the integrator's own trajectory, not a resampling of it:
//      the chunked real-time run matches a single monolithic solver call
//
// Check 3 is the one a keyframe animator would fail on purpose and a broken
// solver would fail by accident, which is why it is stated as a value gate on
// the measured stroke rather than as "the numbers changed".

#include "forge/MultibodyDynamics.hpp"
#include "forge/simulation/MechanismCase.hpp"
#include "forge/simulation/RealtimeLoop.hpp"
#include "TestHarness.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

using namespace forge::simulation;
using forge::MbdConfig;
using forge::MbdResult;
using forge::simulateMultibody;

namespace {

constexpr double kPi = 3.14159265358979323846;

// DECLARED envelope — see realtime_loop_test.cpp for how each bound is derived
// from the physics rather than fitted to the run.
RealtimeLoopConfig animationConfig(const MechanismModel& m) {
    RealtimeLoopConfig cfg;
    cfg.solverDt       = 1e-4;
    cfg.stepsPerFrame  = 200;    // 0.02 s of simulated time per frame
    cfg.frameCount     = 61;     // frame 0 + 60 stepped frames = 1.2 s
    cfg.alpha          = -0.02;
    cfg.baumgarteOmega = 150.0;
    cfg.baumgarteZeta  = 1.0;
    cfg.envelope.targetFrameRateHz      = 50.0;
    cfg.envelope.warnConstraintResidual = 1e-7;
    cfg.envelope.maxConstraintResidual  = 1e-6;
    cfg.envelope.maxEnergyDrift         = 1e-5;
    cfg.envelope.maxWallOverrunRatio    = 1.0;
    cfg.geometryRevision = geometryRevisionOf(m.bodies, m.constraints);
    return cfg;
}

double probe(const AnimationFrame& f, const char* name) {
    for (const auto& p : f.probes) {
        if (p.name == name) return p.value;
    }
    return std::nan("");
}

// Exact equality of every hashed (physical) field of two frames.
bool physicallyIdentical(const AnimationFrame& a, const AnimationFrame& b) {
    if (a.frameIndex != b.frameIndex || a.simTime != b.simTime ||
        a.geometryRevision != b.geometryRevision || a.solverStep != b.solverStep ||
        a.resultHash != b.resultHash || a.bodies.size() != b.bodies.size() ||
        a.probes.size() != b.probes.size()) {
        return false;
    }
    for (std::size_t i = 0; i < a.bodies.size(); ++i) {
        if (a.bodies[i].body != b.bodies[i].body) return false;
        if (a.bodies[i].position        != b.bodies[i].position)        return false;
        if (a.bodies[i].rotation        != b.bodies[i].rotation)        return false;
        if (a.bodies[i].linearVelocity  != b.bodies[i].linearVelocity)  return false;
        if (a.bodies[i].angularVelocity != b.bodies[i].angularVelocity) return false;
    }
    for (std::size_t i = 0; i < a.probes.size(); ++i) {
        if (a.probes[i].name != b.probes[i].name) return false;
        if (a.probes[i].value != b.probes[i].value) return false;
    }
    return true;
}

}  // namespace

int main() {
    forge::simtest::TestRun t("slider_crank_animation");

    const SliderCrankSpec spec;                 // r = 0.10 m, l = 0.30 m, w0 = 6 rad/s
    const MechanismModel model = buildSliderCrank(spec);
    const RealtimeLoopConfig cfg = animationConfig(model);

    FrameSink sink;
    const RealtimeRun run = driveRealtime(model.bodies, model.constraints, model.loads,
                                          model.gravity, cfg, sliderCrankProbes, sink);

    // ---- 1. the sequence exists and is inside the declared envelope -------
    t.predicate("animation ran to completion", run.completed,
                "abortReason=\"" + run.abortReason + "\"");
    t.equalU64("all declared frames emitted and accepted", run.framesAccepted, cfg.frameCount);
    t.equalU64("no frame rejected by the contract", run.framesRejected, 0);
    t.equalU64("no frame flagged Invalid", run.invalidFrames, 0);
    t.equalU64("integrator steps == (frames-1) * stepsPerFrame",
               run.totalSolverSteps,
               static_cast<std::uint64_t>(cfg.frameCount - 1) * cfg.stepsPerFrame);
    t.atMost("max constraint residual inside declared hard bound (1e-6 m)",
             run.maxConstraintResidual, 1e-6);
    t.atMost("max energy drift inside declared bound (1e-5)",
             run.maxEnergyDrift, 1e-5);
    t.near("simulated duration", sink.frames().back().simTime, 1.2, 1e-12);
    t.note("wall time is NOT gated: this machine is under concurrent load. "
           "achieved=" + std::to_string(run.achievedFrameRateHz) + " Hz, declared=" +
           std::to_string(cfg.envelope.targetFrameRateHz) + " Hz");

    // ---- 2. the animation is PHYSICAL: frames vs the closed form ----------
    const AnalyticCheck ac = checkSliderCrankFrames(spec, sink.frames());
    t.equalU64("every frame carried the probes the check needs",
               static_cast<std::uint64_t>(ac.comparedFrames), cfg.frameCount);
    t.equalU64("no frame skipped by the analytic check",
               static_cast<std::uint64_t>(ac.skippedFrames), 0);
    // The physics harness gates this mechanism at 2% of stroke. The frame
    // sequence is held to 1e-6 m absolute, ~4e-4 % of stroke: 4 orders of
    // magnitude tighter, which is affordable only because the run starts from a
    // velocity-consistent initial condition.
    t.atMost("max |x_slider(measured) - x_slider(theta)| vs Norton/Shabana closed form",
             ac.maxAbsError, 1e-6);
    t.atMost("...expressed as % of stroke (harness gate is 2%)", ac.maxErrorPct, 2.0);
    t.atMost("slider stays on its rail (off-axis |y|)", ac.maxOffAxis, 1e-9);

    // ---- 3. SR-4: the sequence really MOVES, through a full cycle ---------
    {
        const double swept = ac.sweptAngleRad;
        t.atLeast("crank swept more than a full rotation (rad)", swept, 2.0 * kPi);
        t.note("crank swept " + std::to_string(swept * 180.0 / kPi) + " degrees");

        bool monotonic = true;
        double prev = -1e300;
        double xmin = 1e300, xmax = -1e300, maxSpeed = 0.0;
        double axmin = 1e300, axmax = -1e300;   // closed form at the SAME angles
        double maxDTheta = 0.0;
        bool first = true;
        for (const auto& f : sink.frames()) {
            const double th = probe(f, "crank_theta_rad");
            const double x  = probe(f, "slider_x_m");
            if (!first) maxDTheta = std::max(maxDTheta, th - prev);
            if (!first && th < prev) monotonic = false;
            first = false;
            prev = th;
            xmin = std::min(xmin, x);
            xmax = std::max(xmax, x);
            const double ax = sliderCrankAnalyticX(spec, th);
            axmin = std::min(axmin, ax);
            axmax = std::max(axmax, ax);
            maxSpeed = std::max(maxSpeed, std::abs(f.bodies[2].linearVelocity[0]));
        }
        t.predicate("crank angle advances monotonically (no reversal, no stall)",
                    monotonic, "final theta=" + std::to_string(prev) + " rad");

        // The extremes the ANIMATION shows are the extremes of the closed form
        // over the angles the animation actually sampled. This is the exact
        // comparison; it holds to solver precision.
        t.near("sampled slider maximum == closed form over the same angles",
               xmax, axmax, 1e-6);
        t.near("sampled slider minimum == closed form over the same angles",
               xmin, axmin, 1e-6);

        // Approaching the TRUE dead centres is a separate, weaker claim: a
        // 50 Hz sample of a ~6 rad/s crank steps ~0.12 rad per frame, so no
        // frame need land on theta = pi exactly. Near the crank-end dead centre
        //     x(pi + u) - (l - r) = (r/2)(1 - r/l) u^2 + O(u^4),
        // and the worst-case miss is |u| <= maxDTheta/2. That quantisation is
        // DERIVED here from the measured frame spacing, not chosen to fit.
        const double r = spec.crankRadius, l = spec.conrodLength;
        const double u = maxDTheta / 2.0;
        const double quantMin = 0.5 * r * (1.0 - r / l) * u * u;
        const double quantMax = 0.5 * r * (1.0 + r / l) * u * u;
        t.note("frame spacing maxDTheta=" + std::to_string(maxDTheta) +
               " rad -> dead-centre quantisation <= " + std::to_string(quantMin) +
               " m (crank end), " + std::to_string(quantMax) + " m (head end)");

        // Frame 0 sits exactly on theta = 0, so the head dead centre IS sampled.
        t.near("slider reaches the head dead centre x = r + l", xmax, r + l, 1e-9);
        t.near("slider reaches the crank dead centre x = l - r within the "
               "derived frame quantisation", xmin, l - r, quantMin);
        t.near("measured stroke == 2r within the derived frame quantisation",
               xmax - xmin, 2.0 * r, quantMin + quantMax);
        // A keyframed or frozen sequence would fail this: the slider must
        // actually be moving, at the speed the crank implies.
        t.atLeast("slider attains a real speed (m/s)", maxSpeed, 0.5);
        t.note("slider travel " + std::to_string(xmin) + " .. " + std::to_string(xmax) +
               " m, peak |vx| = " + std::to_string(maxSpeed) + " m/s");
    }

    // ---- 4. deterministic replay -----------------------------------------
    {
        // Rebuild the model from the spec so the replay exercises model
        // construction too, not just the integrator.
        const MechanismModel replayModel = buildSliderCrank(spec);
        const RealtimeLoopConfig replayCfg = animationConfig(replayModel);
        t.equalU64("replay resolves the same geometry revision",
                   replayCfg.geometryRevision, cfg.geometryRevision);

        FrameSink replaySink;
        const RealtimeRun replay =
            driveRealtime(replayModel.bodies, replayModel.constraints, replayModel.loads,
                          replayModel.gravity, replayCfg, sliderCrankProbes, replaySink);

        t.predicate("replay ran to completion", replay.completed,
                    "abortReason=\"" + replay.abortReason + "\"");
        t.equalU64("replay sequence hash is byte-identical",
                   replay.sequenceHash, run.sequenceHash);

        bool identical = (replaySink.frames().size() == sink.frames().size());
        std::size_t firstDiff = sink.frames().size();
        for (std::size_t i = 0; i < sink.frames().size() && i < replaySink.frames().size(); ++i) {
            if (!physicallyIdentical(sink.frames()[i], replaySink.frames()[i])) {
                identical = false;
                firstDiff = i;
                break;
            }
        }
        t.predicate("every frame is field-for-field identical on replay", identical,
                    "frames=" + std::to_string(sink.frames().size()) + " firstDiff=" +
                    (firstDiff == sink.frames().size() ? std::string("none")
                                                       : std::to_string(firstDiff)));

        // A replay from a DIFFERENT initial state must NOT match -- otherwise
        // the determinism check above would be vacuous.
        SliderCrankSpec nudged = spec;
        nudged.crankOmega0 = 6.000001;   // 1 part in 6e6
        const MechanismModel nudgedModel = buildSliderCrank(nudged);
        RealtimeLoopConfig nudgedCfg = animationConfig(nudgedModel);
        FrameSink nudgedSink;
        const RealtimeRun nudgedRun =
            driveRealtime(nudgedModel.bodies, nudgedModel.constraints, nudgedModel.loads,
                          nudgedModel.gravity, nudgedCfg, sliderCrankProbes, nudgedSink);
        t.differU64("a 1e-6 rad/s change of initial spin changes the sequence hash",
                    nudgedRun.sequenceHash, run.sequenceHash);
    }

    // ---- 5. deterministic CONFIRMATION counterpart ------------------------
    {
        // The declared bound: 1e-6 m, the same 1-micron linear tolerance the
        // constraint envelope uses. If halving the timestep moved the animation
        // by more than a micron, the live timestep would not be resolving the
        // motion and the frames would be showing discretisation, not mechanism.
        const double kConfirmationEnvelope = 1e-6;
        const ConfirmationReport rep =
            runConfirmation(model, cfg, sliderCrankProbes, 2, kConfirmationEnvelope);

        t.predicate("both live and confirmation runs completed", rep.bothRunsComplete,
                    "compared " + std::to_string(rep.comparedFrames) + " frames");
        t.equalU64("confirmation compared every frame",
                   static_cast<std::uint64_t>(rep.comparedFrames), cfg.frameCount);
        t.near("confirmation timestep is exactly half the live timestep",
               rep.confirmationDt, cfg.solverDt / 2.0, 0.0);
        t.atMost("live-vs-confirmation max position delta (declared bound 1e-6 m)",
                 rep.maxPositionDelta, kConfirmationEnvelope);
        t.atMost("live-vs-confirmation max probe delta", rep.maxProbeDelta, 1e-5);
        t.predicate("confirmation verdict is inside the declared envelope",
                    rep.withinEnvelope,
                    "maxPositionDelta=" + std::to_string(rep.maxPositionDelta) +
                    " envelope=" + std::to_string(rep.declaredEnvelope));
        // Halving dt MUST change the answer at some digit. Identical hashes
        // would mean the timestep never reached the integrator.
        t.differU64("the refined run is a genuinely different computation",
                    rep.confirmationSequenceHash, rep.liveSequenceHash);
        t.equalU64("the confirmation's live half reproduces the main run's hash",
                   rep.liveSequenceHash, run.sequenceHash);
        t.note("confirmation: dt " + std::to_string(rep.liveDt) + " -> " +
               std::to_string(rep.confirmationDt) + ", maxPosDelta=" +
               std::to_string(rep.maxPositionDelta) + " m");
    }

    // ---- 6. the frames ARE the integrator's trajectory --------------------
    {
        // One monolithic solver call over the same 12000 steps, sampled at the
        // same stride. If the real-time driver were resampling, smoothing or
        // re-timing anything, this would diverge.
        MbdConfig mono;
        mono.dt             = cfg.solverDt;
        mono.steps          = (cfg.frameCount - 1) * cfg.stepsPerFrame;
        mono.alpha          = cfg.alpha;
        mono.baumgarteOmega = cfg.baumgarteOmega;
        mono.baumgarteZeta  = cfg.baumgarteZeta;
        mono.sampleStride   = cfg.stepsPerFrame;
        const MbdResult mr = simulateMultibody(model.bodies, model.constraints,
                                               model.loads, model.gravity, mono);

        t.predicate("monolithic reference run is stable", mr.stable,
                    "stepsTaken=" + std::to_string(mr.stepsTaken) +
                    " samples=" + std::to_string(mr.samples.size()));
        t.equalU64("monolithic run produced one sample per frame",
                   static_cast<std::uint64_t>(mr.samples.size()), cfg.frameCount);

        double maxDev = 0.0;
        const std::size_t n = std::min(mr.samples.size(), sink.frames().size());
        for (std::size_t i = 0; i < n; ++i) {
            for (std::size_t b = 0; b < mr.samples[i].position.size(); ++b) {
                for (int k = 0; k < 3; ++k) {
                    maxDev = std::max(maxDev,
                        std::abs(mr.samples[i].position[b][k] - sink.frames()[i].bodies[b].position[k]));
                }
            }
        }
        // The only difference is the per-chunk re-projection of the
        // acceleration onto the constraint manifold; it is O(dt) and is
        // measured here rather than assumed.
        t.atMost("chunked real-time frames match the monolithic solve (m)", maxDev, 1e-6);
        t.note("chunked-vs-monolithic max position deviation = " +
               std::to_string(maxDev) + " m over " + std::to_string(n) + " frames");
    }

    return t.exitCode();
}
