// realtime_loop_test — the NO-ADAPTATION rule and the visibility of degradation.
//
// The claim under test is the one that makes a real-time animation trustworthy:
// pushing the producer past its wall-clock budget changes WHAT IT SAYS ABOUT
// ITSELF and nothing else. The trajectory is bit-for-bit the same.
//
// The test proves it by running the same mechanism twice -- once with a 1 s
// frame budget it cannot possibly miss, once with a 1 us budget it cannot
// possibly meet -- and requiring:
//   * identical per-frame result hashes and identical sequence hash
//   * identical solverStep and simTime sequences
//   * identical total integrator step count, timestep, and steps-per-frame
//   * every frame of the pressured run flagged Degraded, none of the relaxed one
//
// It then shows the other half of the rule on real physics: a genuinely
// out-of-envelope run (the harness's velocity-inconsistent initial condition)
// surfaces as Invalid frames rather than being absorbed.
//
// Two of the checks below are worth naming, because each replaced an assertion
// that could not fail:
//
//   * §4 compares the timestep and step count the INTEGRATOR reported against
//     the ones the run DECLARED. Those used to be the same number read twice
//     out of the config, so no mangling of the timestep could move them.
//     no_adaptation_mutation_test drives the same readback through an actual
//     inserted mutation.
//
//   * §8 requires gravity and applied loads to move the geometry revision. A
//     revision folded from bodies and constraints alone gave three models --
//     no gravity, gravity on, a torque applied -- ONE revision id and three
//     different trajectories.
//
//   * §9 requires a constraint spike that recovers between two frame instants
//     to be visible. Classified on the closing instant alone, a frame whose
//     joints opened to 1.04 mm mid-interval -- 1040x the declared hard bound --
//     reported Valid.

#include "forge/simulation/MechanismCase.hpp"
#include "forge/simulation/RealtimeLoop.hpp"
#include "TestHarness.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

using namespace forge::simulation;

namespace {

// ---------------------------------------------------------------------------
// DECLARED ENVELOPE for the slider-crank at dt = 1e-4, HHT alpha = -0.02,
// Baumgarte omega = 150 rad/s. Both bounds are stated from the physics, not
// fitted to the run:
//
//   constraint residual — Phi is a joint-closure LENGTH in metres. 1e-6 m is
//     the tightest linear tolerance the kernel's own geometry layer works to
//     (1 micron), so a joint that closes to better than that is exact for any
//     purpose an animation serves. Warn at 1e-7 m. MEASURED peak: 4.79e-9 m,
//     i.e. 20x inside the warn bound and 200x inside the hard bound.
//
//   energy drift — the mechanism is frictionless and gravity-free, so the
//     exact solution conserves energy identically and the only correct bound
//     is "as near zero as the discretisation allows". 1e-5 (0.001%) is a
//     round bound comfortably below anything visible in motion. MEASURED
//     peak: 1.92e-7, i.e. 52x inside it.
// ---------------------------------------------------------------------------
RealtimeEnvelope declaredEnvelope(double targetHz) {
    RealtimeEnvelope e;
    e.targetFrameRateHz       = targetHz;
    e.warnConstraintResidual  = 1e-7;
    e.maxConstraintResidual   = 1e-6;
    e.maxEnergyDrift          = 1e-5;
    e.maxWallOverrunRatio     = 1.0;
    return e;
}

RealtimeLoopConfig baseConfig(const MechanismModel& m, double targetHz,
                              std::uint32_t frames) {
    RealtimeLoopConfig cfg;
    cfg.solverDt         = 1e-4;
    cfg.stepsPerFrame    = 200;      // 200 * 1e-4 s = 0.02 s => 50 Hz of sim time
    cfg.frameCount       = frames;
    cfg.alpha            = -0.02;
    cfg.baumgarteOmega   = 150.0;
    cfg.baumgarteZeta    = 1.0;
    cfg.envelope         = declaredEnvelope(targetHz);
    cfg.geometryRevision = geometryRevisionOf(m.bodies, m.constraints, m.loads, m.gravity);
    return cfg;
}

}  // namespace

int main() {
    forge::simtest::TestRun t("realtime_loop");

    const SliderCrankSpec spec;                 // consistent initial velocities
    const MechanismModel model = buildSliderCrank(spec);
    const std::uint32_t kFrames = 11;           // 10 stepped frames = 2000 steps
    const std::uint64_t kExpectedSteps = 2000;

    // ---- 1. relaxed budget: the reference run -----------------------------
    FrameSink relaxedSink;
    const RealtimeLoopConfig relaxedCfg = baseConfig(model, 1.0, kFrames);
    const RealtimeRun relaxed =
        driveRealtime(model.bodies, model.constraints, model.loads, model.gravity,
                      relaxedCfg, sliderCrankProbes, relaxedSink);

    t.predicate("relaxed run completed", relaxed.completed,
                "abortReason=\"" + relaxed.abortReason + "\" accepted=" +
                std::to_string(relaxed.framesAccepted));
    t.equalU64("relaxed run emitted every declared frame",
               relaxed.framesAccepted, kFrames);
    t.equalU64("relaxed run rejected nothing", relaxed.framesRejected, 0);
    t.equalU64("relaxed run: no frame Degraded", relaxed.degradedFrames, 0);
    t.equalU64("relaxed run: no frame Invalid", relaxed.invalidFrames, 0);
    t.atMost("relaxed run: constraint residual inside declared hard bound",
             relaxed.maxConstraintResidual, 1e-6);
    t.atMost("relaxed run: energy drift inside declared bound",
             relaxed.maxEnergyDrift, 1e-5);

    // ---- 2. impossible budget: the pressured run --------------------------
    // 1 MHz declared rate => a 1 us frame budget. A single frame is 200 implicit
    // DAE steps with a KKT solve each, so this cannot be met on any machine.
    FrameSink pressuredSink;
    const RealtimeLoopConfig pressuredCfg = baseConfig(model, 1.0e6, kFrames);
    const RealtimeRun pressured =
        driveRealtime(model.bodies, model.constraints, model.loads, model.gravity,
                      pressuredCfg, sliderCrankProbes, pressuredSink);

    t.predicate("pressured run completed", pressured.completed,
                "abortReason=\"" + pressured.abortReason + "\"");
    t.equalU64("pressured run emitted every declared frame",
               pressured.framesAccepted, kFrames);
    // Frame 0 is the initial state: it consumes ONE integrator step, not 200,
    // so its cost is not comparable and on a fast machine it can land inside
    // even a 1 us budget. The deterministic claim is about the STEPPED frames,
    // each of which is 200 implicit DAE steps with a KKT solve apiece --
    // measured at ~9 ms, four orders of magnitude over the budget.
    {
        std::size_t steppedDegraded = 0, steppedTotal = 0;
        for (std::size_t i = 1; i < pressuredSink.frames().size(); ++i) {
            ++steppedTotal;
            if (pressuredSink.frames()[i].validity == ValidityState::Degraded) ++steppedDegraded;
        }
        t.equalU64("pressured run: EVERY stepped frame flagged Degraded",
                   static_cast<std::uint64_t>(steppedDegraded),
                   static_cast<std::uint64_t>(steppedTotal));
        t.equalU64("...over the expected number of stepped frames",
                   static_cast<std::uint64_t>(steppedTotal), kFrames - 1);
    }
    t.equalU64("pressured run: no frame flagged Invalid (physics is unchanged)",
               pressured.invalidFrames, 0);
    t.atLeast("pressured run really did overrun its budget",
              pressured.maxWallOverrunRatio, 1.0);
    t.atMost("relaxed run really did meet its budget",
             relaxed.maxWallOverrunRatio, 1.0);

    // ---- 3. THE RULE: pressure changed nothing physical -------------------
    t.equalU64("sequence hash identical under real-time pressure",
               pressured.sequenceHash, relaxed.sequenceHash);
    t.equalU64("sink sequence hashes agree",
               pressuredSink.sequenceHash(), relaxedSink.sequenceHash());

    {
        const auto& A = relaxedSink.frames();
        const auto& B = pressuredSink.frames();
        bool hashesMatch = (A.size() == B.size());
        bool stepsMatch  = hashesMatch;
        bool timesMatch  = hashesMatch;
        bool validityDiffers = hashesMatch;
        std::size_t firstMismatch = A.size();
        for (std::size_t i = 0; i < A.size() && i < B.size(); ++i) {
            if (A[i].resultHash != B[i].resultHash) {
                hashesMatch = false;
                firstMismatch = std::min(firstMismatch, i);
            }
            if (A[i].solverStep != B[i].solverStep) stepsMatch = false;
            if (A[i].simTime    != B[i].simTime)    timesMatch = false;
            // Stepped frames only, for the reason given above.
            if (i > 0 && A[i].validity == B[i].validity) validityDiffers = false;
        }
        t.predicate("every frame's result hash is identical", hashesMatch,
                    "frames=" + std::to_string(A.size()) + " firstMismatch=" +
                    (firstMismatch == A.size() ? std::string("none")
                                               : std::to_string(firstMismatch)));
        t.predicate("every frame's solverStep is identical", stepsMatch,
                    "compared " + std::to_string(A.size()) + " frames");
        t.predicate("every frame's simTime is identical", timesMatch,
                    "compared " + std::to_string(A.size()) + " frames");
        t.predicate("...while EVERY stepped frame's validity_state differs", validityDiffers,
                    std::string("relaxed=") + toString(A.back().validity) +
                    " pressured=" + toString(B.back().validity));
    }

    // ---- 4. no silent adaptation: dt, stride and step count never moved ----
    for (int which = 0; which < 2; ++which) {
        const RealtimeRun& r   = which ? pressured : relaxed;
        const RealtimeLoopConfig& c = which ? pressuredCfg : relaxedCfg;
        const FrameSink& s     = which ? pressuredSink : relaxedSink;
        const char* tag = which ? "pressured" : "relaxed";

        // Every value on the left is MEASURED out of the integrator's own
        // result (elapsed simulated time / steps taken); every value on the
        // right is what the run DECLARED. Before the readback existed these
        // were the same number copied twice, so the comparison could not fail
        // however the timestep was mangled on the way to the integrator.
        t.near((std::string(tag) + ": measured solverDt at the first call == declared").c_str(),
               r.solverDtFirst, c.solverDt, 0.0);
        t.near((std::string(tag) + ": measured solverDt at the last call == declared").c_str(),
               r.solverDtLast, c.solverDt, 0.0);
        t.near((std::string(tag) + ": measured solverDt never shrank, anywhere").c_str(),
               r.solverDtMin, c.solverDt, 0.0);
        t.near((std::string(tag) + ": measured solverDt never grew, anywhere").c_str(),
               r.solverDtMax, c.solverDt, 0.0);
        t.equalU64((std::string(tag) + ": stepsPerFrame never shrank").c_str(),
                   r.stepsPerFrameMin, c.stepsPerFrame);
        t.equalU64((std::string(tag) + ": stepsPerFrame never grew").c_str(),
                   r.stepsPerFrameMax, c.stepsPerFrame);
        t.equalU64((std::string(tag) + ": total integrator steps == (frames-1)*stride").c_str(),
                   r.totalSolverSteps, kExpectedSteps);
        t.near((std::string(tag) + ": simulated seconds == steps * declared dt").c_str(),
               r.simulatedSeconds,
               static_cast<double>(kExpectedSteps) * c.solverDt, 1e-12);

        // The step ladder itself: frame i must sit exactly i*stride steps in.
        // Step counts are integers read back from the integrator, so this half
        // is EXACT.
        bool stepLadderExact = true;
        std::size_t badStepFrame = 0;
        for (std::size_t i = 0; i < s.frames().size(); ++i) {
            const std::uint64_t want = static_cast<std::uint64_t>(i) * c.stepsPerFrame;
            if (s.frames()[i].solverStep != want) {
                stepLadderExact = false;
                badStepFrame = i;
                break;
            }
        }
        t.predicate((std::string(tag) + ": no step skipped or repeated in the ladder").c_str(),
                    stepLadderExact,
                    "frames=" + std::to_string(s.frames().size()) +
                    (stepLadderExact ? " ladder exact"
                                     : " first bad frame=" + std::to_string(badStepFrame)));

        // The TIME ladder. simTime is now the integrator's own elapsed time
        // summed chunk by chunk, so it is not bit-identical to the closed-form
        // i*stride*dt -- summing eleven copies of 200*1e-4 and multiplying
        // 2000 by 1e-4 differ in the last few bits, and the compiler may
        // contract either expression. The stated tolerance is 1e-12 s, one
        // ten-millionth of a single timestep: far below any real drift and
        // twelve orders below the 25% enlargement this ladder exists to catch.
        double worstTimeError = 0.0;
        std::size_t worstTimeFrame = 0;
        bool monotonic = true;
        for (std::size_t i = 0; i < s.frames().size(); ++i) {
            const double wantT =
                static_cast<double>(i) * static_cast<double>(c.stepsPerFrame) * c.solverDt;
            const double err = std::abs(s.frames()[i].simTime - wantT);
            if (err > worstTimeError) { worstTimeError = err; worstTimeFrame = i; }
            if (i > 0 && !(s.frames()[i].simTime > s.frames()[i - 1].simTime)) monotonic = false;
        }
        t.atMost((std::string(tag) + ": measured simTime ladder == i*stride*declared dt (s)").c_str(),
                 worstTimeError, 1e-12);
        t.predicate((std::string(tag) + ": simTime strictly advances every frame").c_str(),
                    monotonic,
                    "worst |simTime - reference| = " + std::to_string(worstTimeError) +
                    " s at frame " + std::to_string(worstTimeFrame));
    }

    // ---- 5. pacing slows the producer down, never the physics -------------
    {
        const double paceHz = 30.0;
        const std::uint32_t paceFrames = 6;
        MechanismModel pm = buildSliderCrank(spec);
        RealtimeLoopConfig pcfg = baseConfig(pm, paceHz, paceFrames);
        pcfg.paceToRealtime = true;

        FrameSink pacedSink;
        const RealtimeRun paced =
            driveRealtime(pm.bodies, pm.constraints, pm.loads, pm.gravity, pcfg,
                          sliderCrankProbes, pacedSink);

        RealtimeLoopConfig ucfg = pcfg;
        ucfg.paceToRealtime = false;
        FrameSink unpacedSink;
        const RealtimeRun unpaced =
            driveRealtime(pm.bodies, pm.constraints, pm.loads, pm.gravity, ucfg,
                          sliderCrankProbes, unpacedSink);

        t.predicate("paced run completed", paced.completed,
                    "abortReason=\"" + paced.abortReason + "\"");
        t.equalU64("pacing does not change the trajectory",
                   paced.sequenceHash, unpaced.sequenceHash);
        // The one-sided claim is the robust one: a paced producer can be late
        // (the machine is shared) but must never run FASTER than declared.
        t.atMost("paced producer never exceeds its declared frame rate",
                 paced.achievedFrameRateHz, paceHz * 1.05);
        t.atLeast("unpaced producer is faster than the paced one",
                  unpaced.achievedFrameRateHz, paced.achievedFrameRateHz);
        t.note("achieved: paced=" + std::to_string(paced.achievedFrameRateHz) +
               " Hz, unpaced=" + std::to_string(unpaced.achievedFrameRateHz) +
               " Hz (declared " + std::to_string(paceHz) + " Hz)");
    }

    // ---- 6. a genuine envelope breach is VISIBLE, not absorbed ------------
    {
        // Same mechanism, same declared envelope, but started from the
        // harness's velocity-INCONSISTENT initial condition. The Baumgarte term
        // absorbs the mismatch impulsively; the run stays numerically stable and
        // still tracks the closed-form position, so nothing would stop a naive
        // producer from shipping it as clean animation. The envelope catches it.
        SliderCrankSpec harnessSpec;
        harnessSpec.consistentInitialVelocities = false;
        const MechanismModel hm = buildSliderCrank(harnessSpec);
        RealtimeLoopConfig hcfg = baseConfig(hm, 1.0, kFrames);
        hcfg.geometryRevision = geometryRevisionOf(hm.bodies, hm.constraints, hm.loads, hm.gravity);

        FrameSink hsink;
        const RealtimeRun h =
            driveRealtime(hm.bodies, hm.constraints, hm.loads, hm.gravity, hcfg,
                          sliderCrankProbes, hsink);

        t.predicate("out-of-envelope run still runs to completion", h.completed,
                    "abortReason=\"" + h.abortReason + "\" accepted=" +
                    std::to_string(h.framesAccepted));
        t.atLeast("...but frames are flagged Invalid",
                  static_cast<double>(h.invalidFrames), 1.0);
        t.equalU64("...whereas the consistent-IC run flagged none",
                   relaxed.invalidFrames, 0);
        t.atLeast("...and the measured energy drift really is out of bound",
                  h.maxEnergyDrift, 1e-5);
        t.differU64("...and it is a different trajectory from the clean run",
                    h.sequenceHash, relaxed.sequenceHash);

        std::size_t firstInvalid = h.framesAccepted;
        for (std::size_t i = 0; i < hsink.frames().size(); ++i) {
            if (hsink.frames()[i].validity == ValidityState::Invalid) { firstInvalid = i; break; }
        }
        t.atMost("the breach is flagged within the first two stepped frames",
                 static_cast<double>(firstInvalid), 2.0);
        t.note("harness-IC run: maxRes=" + std::to_string(h.maxConstraintResidual) +
               " maxEnergyDrift=" + std::to_string(h.maxEnergyDrift) +
               " invalidFrames=" + std::to_string(h.invalidFrames) + "/" +
               std::to_string(h.framesAccepted));
    }

    // ---- 7. a configuration that cannot produce evidence is refused -------
    {
        RealtimeLoopConfig bad = baseConfig(model, 50.0, 4);
        bad.geometryRevision = 0;
        FrameSink s;
        const RealtimeRun r = driveRealtime(model.bodies, model.constraints, model.loads,
                                            model.gravity, bad, sliderCrankProbes, s);
        t.equalStr("geometryRevision == 0 is refused before any frame", r.abortReason,
                   "config names no geometry revision (geometryRevision == 0)");
        t.equalU64("...and nothing was emitted",
                   static_cast<std::uint64_t>(s.acceptedCount()), 0);
    }
    {
        RealtimeLoopConfig bad = baseConfig(model, 50.0, 4);
        bad.stepsPerFrame = 0;
        FrameSink s;
        const RealtimeRun r = driveRealtime(model.bodies, model.constraints, model.loads,
                                            model.gravity, bad, sliderCrankProbes, s);
        t.equalStr("stepsPerFrame == 0 is refused", r.abortReason,
                   "stepsPerFrame must be >= 1");
    }
    {
        RealtimeLoopConfig bad = baseConfig(model, 50.0, 4);
        bad.solverDt = 0.0;
        FrameSink s;
        const RealtimeRun r = driveRealtime(model.bodies, model.constraints, model.loads,
                                            model.gravity, bad, sliderCrankProbes, s);
        t.equalStr("a zero timestep is refused", r.abortReason,
                   "solverDt must be a positive finite timestep");
    }

    // ---- 8. geometryRevision genuinely names the model --------------------
    {
        SliderCrankSpec longer = spec;
        longer.conrodLength = 0.31;    // a 10 mm longer conrod: different geometry
        const MechanismModel lm = buildSliderCrank(longer);
        t.differU64("a changed link length changes the geometry revision",
                    geometryRevisionOf(lm.bodies, lm.constraints, lm.loads, lm.gravity),
                    geometryRevisionOf(model.bodies, model.constraints, model.loads, model.gravity));
        const MechanismModel same = buildSliderCrank(spec);
        t.equalU64("the same model yields the same geometry revision",
                   geometryRevisionOf(same.bodies, same.constraints, same.loads, same.gravity),
                   geometryRevisionOf(model.bodies, model.constraints, model.loads, model.gravity));

        // Bodies and constraints are not the whole model. Gravity and applied
        // loads are handed to the same integrator and change the same
        // trajectory, so a revision that ignored them would let two runs that
        // move differently claim to be the same geometry -- and SR-4's "every
        // frame names the revision it belongs to" would name nothing.
        const std::uint64_t rev0 =
            geometryRevisionOf(model.bodies, model.constraints, model.loads, model.gravity);

        MechanismModel gm = buildSliderCrank(spec);
        gm.gravity.g = {0.0, -9.81, 0.0};
        const std::uint64_t revG =
            geometryRevisionOf(gm.bodies, gm.constraints, gm.loads, gm.gravity);
        t.differU64("switching gravity on changes the geometry revision", revG, rev0);

        MechanismModel lmod = buildSliderCrank(spec);
        forge::MbdLoad torque;                       // 1 N.m about +Z on the crank
        torque.body   = 0;
        torque.torque = {0.0, 0.0, 1.0};
        lmod.loads.push_back(torque);
        const std::uint64_t revL =
            geometryRevisionOf(lmod.bodies, lmod.constraints, lmod.loads, lmod.gravity);
        t.differU64("adding an applied load changes the geometry revision", revL, rev0);
        t.differU64("...and a load is not the same change as gravity", revL, revG);

        // The revisions above are only worth having if those inputs really do
        // move the mechanism. Both are driven through the loop and compared.
        RealtimeLoopConfig gcfg = baseConfig(gm, 1.0, 6);
        gcfg.geometryRevision = revG;
        FrameSink gsink;
        const RealtimeRun grun = driveRealtime(gm.bodies, gm.constraints, gm.loads,
                                               gm.gravity, gcfg, sliderCrankProbes, gsink);
        RealtimeLoopConfig lcfg = baseConfig(lmod, 1.0, 6);
        lcfg.geometryRevision = revL;
        FrameSink lsink;
        const RealtimeRun lrun = driveRealtime(lmod.bodies, lmod.constraints, lmod.loads,
                                               lmod.gravity, lcfg, sliderCrankProbes, lsink);
        RealtimeLoopConfig bcfg = baseConfig(model, 1.0, 6);
        FrameSink bsink;
        const RealtimeRun brun = driveRealtime(model.bodies, model.constraints, model.loads,
                                               model.gravity, bcfg, sliderCrankProbes, bsink);

        t.predicate("gravity / load / baseline runs all completed",
                    grun.completed && lrun.completed && brun.completed,
                    "gravity=\"" + grun.abortReason + "\" load=\"" + lrun.abortReason +
                    "\" baseline=\"" + brun.abortReason + "\"");
        t.differU64("gravity really does change the trajectory",
                    grun.sequenceHash, brun.sequenceHash);
        t.differU64("an applied load really does change the trajectory",
                    lrun.sequenceHash, brun.sequenceHash);
    }

    // ---- 9. a residual spike that recovers INSIDE a frame is not invisible -
    {
        // The harness's velocity-inconsistent initial condition drives a
        // constraint-residual spike (MechanismCase.hpp records the measured
        // peak: 4.22e-4 m, against ~2e-9 m thereafter) which the Baumgarte
        // term damps out inside the first few milliseconds. Give the producer
        // a frame LONGER than that transient -- 2000 steps = 0.2 s of the
        // mechanism -- and by the time the frame closes the state is back on
        // the manifold. Classify on that closing instant alone and the frame
        // reports clean, for an interval the joints spent hundreds of times
        // outside the declared hard bound.
        //
        // The energy bound is deliberately relaxed to 1.0 here. The same
        // initial condition also breaks the energy term, and leaving it armed
        // would flag the frame Invalid for the other reason and make this
        // check unfalsifiable -- the residual has to be the only thing that
        // can move the verdict.
        SliderCrankSpec spikeSpec;
        spikeSpec.consistentInitialVelocities = false;
        const MechanismModel sm = buildSliderCrank(spikeSpec);
        RealtimeLoopConfig scfg = baseConfig(sm, 1.0, 4);
        scfg.stepsPerFrame           = 2000;   // 0.2 s per frame
        scfg.envelope.maxEnergyDrift = 1.0;    // isolate the residual term
        scfg.geometryRevision =
            geometryRevisionOf(sm.bodies, sm.constraints, sm.loads, sm.gravity);

        FrameSink ssink;
        const RealtimeRun srun = driveRealtime(sm.bodies, sm.constraints, sm.loads,
                                               sm.gravity, scfg, sliderCrankProbes, ssink);
        t.predicate("spike run ran to completion", srun.completed,
                    "abortReason=\"" + srun.abortReason + "\" accepted=" +
                    std::to_string(srun.framesAccepted));

        std::size_t hidden = ssink.frames().size();
        for (std::size_t i = 0; i < ssink.frames().size(); ++i) {
            const AnimationFrame& f = ssink.frames()[i];
            if (f.constraintResidual <= scfg.envelope.maxConstraintResidual &&
                f.maxConstraintResidual > scfg.envelope.maxConstraintResidual) {
                hidden = i;
                break;
            }
        }
        t.predicate("a frame exists whose closing instant is clean and whose interval is not",
                    hidden < ssink.frames().size(),
                    "frames=" + std::to_string(ssink.frames().size()) +
                    " index=" + (hidden < ssink.frames().size() ? std::to_string(hidden)
                                                                : std::string("none")));
        if (hidden < ssink.frames().size()) {
            const AnimationFrame& f = ssink.frames()[hidden];
            t.atMost("...its END-of-frame residual is inside the declared hard bound (m)",
                     f.constraintResidual, scfg.envelope.maxConstraintResidual);
            t.atLeast("...while the residual MAXIMUM inside the frame breaches it (m)",
                      f.maxConstraintResidual, scfg.envelope.maxConstraintResidual);
            t.equalU64("...and the frame is classified Invalid, not Valid",
                       static_cast<std::uint64_t>(f.validity),
                       static_cast<std::uint64_t>(ValidityState::Invalid));
            t.atLeast("...the excursion is orders of magnitude, not rounding",
                      f.maxConstraintResidual / f.constraintResidual, 100.0);
            t.note("frame " + std::to_string(hidden) + ": end residual=" +
                   std::to_string(f.constraintResidual) + " m, intra-frame max=" +
                   std::to_string(f.maxConstraintResidual) + " m, hard bound=" +
                   std::to_string(scfg.envelope.maxConstraintResidual) + " m");
        }

        // The run-level total must carry the same excursion: reporting a peak
        // that no frame is allowed to name would put the number out of reach
        // of the classifier that is supposed to act on it.
        t.atLeast("the run's reported peak residual includes the intra-frame excursion",
                  srun.maxConstraintResidual, scfg.envelope.maxConstraintResidual);
    }

    return t.exitCode();
}
