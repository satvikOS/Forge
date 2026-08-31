// four_bar_animation_test — the second concrete animated case.
//
// A Grashof crank-rocker four-bar driven through a full crank rotation as a
// real-time frame sequence, gated against the Freudenstein loop closure at the
// crank angle each frame actually reports.
//
// The four-bar is the harder of the two cases: its output link OSCILLATES
// rather than advancing, so a sequence that merely drifted would be caught by
// the rocker never reversing, and its loop closure is a two-circle
// intersection whose branch a wrong solve would silently swap.

#include "forge/simulation/MechanismCase.hpp"
#include "forge/simulation/RealtimeLoop.hpp"
#include "TestHarness.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

using namespace forge::simulation;

namespace {

constexpr double kPi = 3.14159265358979323846;

RealtimeLoopConfig animationConfig(const MechanismModel& m) {
    RealtimeLoopConfig cfg;
    cfg.solverDt       = 1e-4;
    cfg.stepsPerFrame  = 200;
    cfg.frameCount     = 71;     // frame 0 + 70 stepped frames = 1.4 s
    cfg.alpha          = -0.02;
    cfg.baumgarteOmega = 150.0;
    cfg.baumgarteZeta  = 1.0;
    cfg.envelope.targetFrameRateHz      = 50.0;
    cfg.envelope.warnConstraintResidual = 1e-7;
    cfg.envelope.maxConstraintResidual  = 1e-6;
    cfg.envelope.maxEnergyDrift         = 1e-5;
    cfg.envelope.maxWallOverrunRatio    = 1.0;
    cfg.geometryRevision = geometryRevisionOf(m.bodies, m.constraints, m.loads, m.gravity);
    return cfg;
}

double probe(const AnimationFrame& f, const char* name) {
    for (const auto& p : f.probes) {
        if (p.name == name) return p.value;
    }
    return std::nan("");
}

}  // namespace

int main() {
    forge::simtest::TestRun t("four_bar_animation");

    const FourBarSpec spec;      // r1=0.40 r2=0.10 r3=0.35 r4=0.30, w0 = 5 rad/s
    const MechanismModel model = buildFourBar(spec);
    t.equalU64("four-bar assembles at theta2 = 0",
               static_cast<std::uint64_t>(model.bodies.size()), 3);

    const RealtimeLoopConfig cfg = animationConfig(model);
    FrameSink sink;
    const RealtimeRun run = driveRealtime(model.bodies, model.constraints, model.loads,
                                          model.gravity, cfg, fourBarProbes, sink);

    // ---- 1. sequence and envelope ----------------------------------------
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
    t.atMost("max energy drift inside declared bound (1e-5)", run.maxEnergyDrift, 1e-5);
    t.near("simulated duration", sink.frames().back().simTime, 1.4, 1e-12);

    // ---- 2. Freudenstein loop closure, frame by frame ---------------------
    const AnalyticCheck ac = checkFourBarFrames(spec, sink.frames());
    t.equalU64("every frame compared against the loop closure",
               static_cast<std::uint64_t>(ac.comparedFrames), cfg.frameCount);
    t.equalU64("no crank angle failed to assemble",
               static_cast<std::uint64_t>(ac.skippedFrames), 0);
    t.atLeast("crank swept more than a full rotation (rad)", ac.sweptAngleRad, 2.0 * kPi);
    // Harness gate for this mechanism is 2% of r4; the frame sequence is held
    // to 1e-6 m absolute.
    t.atMost("max |B_measured - B_Freudenstein| over the whole cycle (m)",
             ac.maxAbsError, 1e-6);
    t.atMost("...expressed as % of r4 (harness gate is 2%)", ac.maxErrorPct, 2.0);
    t.note("crank swept " + std::to_string(ac.sweptAngleRad * 180.0 / kPi) +
           " degrees, max B error = " + std::to_string(ac.maxAbsError) + " m");

    // ---- 3. SR-4: the ROCKER oscillates, and stays on its branch ----------
    {
        double thRmin = 1e300, thRmax = -1e300;
        int reversals = 0;
        double prevRate = 0.0;
        bool firstRate = true;
        double prevTh = 0.0;
        bool firstFrame = true;
        double maxPinRadius = 0.0, minPinRadius = 1e300;

        for (const auto& f : sink.frames()) {
            const double thR = probe(f, "rocker_theta_rad");
            thRmin = std::min(thRmin, thR);
            thRmax = std::max(thRmax, thR);
            if (!firstFrame) {
                const double rate = thR - prevTh;
                if (!firstRate && rate * prevRate < 0.0) ++reversals;
                prevRate = rate;
                firstRate = false;
            }
            prevTh = thR;
            firstFrame = false;

            // Joint B must stay exactly r4 from the ground pin O4 = (r1, 0):
            // that is the rocker's rigidity, and it is what a branch flip or a
            // drifting loop closure would violate.
            const double cx = probe(f, "rocker_cx_m"), cy = probe(f, "rocker_cy_m");
            const double bx = cx + (spec.rocker / 2.0) * std::cos(thR);
            const double by = cy + (spec.rocker / 2.0) * std::sin(thR);
            const double rad = std::hypot(bx - spec.ground, by);
            maxPinRadius = std::max(maxPinRadius, rad);
            minPinRadius = std::min(minPinRadius, rad);
        }

        t.atLeast("the rocker actually oscillates (direction reversals per cycle)",
                  static_cast<double>(reversals), 2.0);
        t.atLeast("rocker angular travel is a real swing (rad)",
                  thRmax - thRmin, 0.3);
        t.atMost("joint B never leaves the rocker circle (max |O4B| - r4)",
                 std::abs(maxPinRadius - spec.rocker), 1e-6);
        t.atMost("joint B never leaves the rocker circle (min |O4B| - r4)",
                 std::abs(minPinRadius - spec.rocker), 1e-6);
        t.note("rocker swing = " + std::to_string((thRmax - thRmin) * 180.0 / kPi) +
               " degrees over " + std::to_string(reversals) + " reversals; |O4B| in [" +
               std::to_string(minPinRadius) + ", " + std::to_string(maxPinRadius) + "] m");
    }

    // ---- 4. deterministic replay -----------------------------------------
    {
        const MechanismModel m2 = buildFourBar(spec);
        const RealtimeLoopConfig c2 = animationConfig(m2);
        FrameSink s2;
        const RealtimeRun r2 = driveRealtime(m2.bodies, m2.constraints, m2.loads,
                                             m2.gravity, c2, fourBarProbes, s2);
        t.predicate("replay ran to completion", r2.completed,
                    "abortReason=\"" + r2.abortReason + "\"");
        t.equalU64("replay sequence hash is byte-identical", r2.sequenceHash, run.sequenceHash);

        FourBarSpec longer = spec;
        longer.coupler = 0.3501;    // 0.1 mm longer coupler
        const MechanismModel m3 = buildFourBar(longer);
        const RealtimeLoopConfig c3 = animationConfig(m3);
        FrameSink s3;
        const RealtimeRun r3 = driveRealtime(m3.bodies, m3.constraints, m3.loads,
                                             m3.gravity, c3, fourBarProbes, s3);
        t.differU64("a 0.1 mm longer coupler changes the sequence hash",
                    r3.sequenceHash, run.sequenceHash);
        t.differU64("...and its geometry revision", c3.geometryRevision, cfg.geometryRevision);
    }

    // ---- 5. deterministic CONFIRMATION counterpart ------------------------
    {
        const double kConfirmationEnvelope = 1e-6;
        // Probe bound, in the units of the four-bar's OWN OUTPUT: the rocker
        // angle (rad), the rocker centre (m) and the crank angle/rate. The
        // rocker angle is the thing this mechanism exists to produce, so it is
        // the one that must not move when the timestep halves. 1e-5 rad is
        // 0.00057 deg -- roughly a hundredth of what is visible on a rocker
        // 0.3 m long at any screen resolution.
        // MEASURED worst probe: 3.27e-7 (crank_omega_rad_s), 31x inside it.
        const double kProbeEnvelope = 1e-5;
        const ConfirmationReport rep =
            runConfirmation(model, cfg, fourBarProbes, 2, kConfirmationEnvelope,
                            kProbeEnvelope);
        t.predicate("both live and confirmation runs completed", rep.bothRunsComplete,
                    "compared " + std::to_string(rep.comparedFrames) + " frames");
        t.equalU64("confirmation compared every frame",
                   static_cast<std::uint64_t>(rep.comparedFrames), cfg.frameCount);
        t.atMost("live-vs-confirmation max position delta (declared bound 1e-6 m)",
                 rep.maxPositionDelta, kConfirmationEnvelope);
        t.atMost("live-vs-confirmation max probe delta (declared bound 1e-5)",
                 rep.maxProbeDelta, kProbeEnvelope);
        t.predicate("confirmation verdict is inside BOTH declared envelopes",
                    rep.withinEnvelope,
                    "maxPositionDelta=" + forge::simtest::fmtG(rep.maxPositionDelta) +
                    " maxProbeDelta=" + forge::simtest::fmtG(rep.maxProbeDelta) +
                    " (worst probe \"" + rep.maxProbeName + "\")");
        // NOT a hash comparison: see the ConfirmationReport note. solverStep is
        // hashed and the refined ladder is twice as fine, so the hashes differ
        // whether or not the refined timestep reached the integrator. The
        // falsifiable statement is that the deviation is strictly inside
        // (0, envelope] -- zero would mean one computation, and an ignored dt
        // would put frame i at twice the simulated time and miss by ~0.1 m.
        t.predicate("the refinement genuinely moved the trajectory (delta > 0)",
                    rep.maxPositionDelta > 0.0,
                    "maxPositionDelta=" + forge::simtest::fmtG(rep.maxPositionDelta) +
                    " must be > 0 and <= " + forge::simtest::fmtG(rep.declaredEnvelope));
        t.note("confirmation: dt " + forge::simtest::fmtG(rep.liveDt) + " -> " +
               forge::simtest::fmtG(rep.confirmationDt) + ", maxPosDelta=" +
               forge::simtest::fmtG(rep.maxPositionDelta) + " m, worst probe \"" +
               rep.maxProbeName + "\" delta=" + forge::simtest::fmtG(rep.maxProbeDelta));
    }

    // ---- 6. the closed form itself is the open branch we build from -------
    {
        // Guards the reference, not the solver: if fourBarCouplerPin ever
        // returned the crossed branch, every gate above would still "pass"
        // against a wrong mechanism.
        std::array<double, 2> B{0, 0};
        const bool ok = fourBarCouplerPin(spec, 0.0, B);
        t.predicate("loop closure solves at theta2 = 0", ok,
                    "B=(" + std::to_string(B[0]) + ", " + std::to_string(B[1]) + ")");
        t.near("|A B| == the coupler length r3",
               std::hypot(B[0] - spec.crank, B[1]), spec.coupler, 1e-12);
        t.near("|O4 B| == the rocker length r4",
               std::hypot(B[0] - spec.ground, B[1]), spec.rocker, 1e-12);

        // The two-circle intersection has two branches. Which one this
        // mechanism sits on is a property of the assembly, not a preference --
        // here it is the one with B BELOW the ground line at theta2 = 0. What
        // must hold is that the branch never SWAPS: the sign of
        // (A - O4) x (B - O4) is invariant for a linkage that stays assembled.
        // A silent branch flip is the failure that would let every gate above
        // pass while showing the wrong mechanism.
        auto branchSign = [&](double th2, const std::array<double, 2>& b) {
            const double ax = spec.crank * std::cos(th2) - spec.ground;
            const double ay = spec.crank * std::sin(th2);
            const double bx = b[0] - spec.ground, by = b[1];
            return ax * by - ay * bx;
        };
        const double refSign = branchSign(0.0, B);
        t.predicate("the branch at theta2 = 0 is the below-ground one",
                    B[1] < 0.0, "B_y=" + std::to_string(B[1]));

        int analyticSamples = 0, analyticFlips = 0;
        for (int i = 0; i <= 720; ++i) {
            const double th2 = 2.0 * kPi * i / 720.0;
            std::array<double, 2> b{0, 0};
            if (!fourBarCouplerPin(spec, th2, b)) continue;
            ++analyticSamples;
            if (branchSign(th2, b) * refSign <= 0.0) ++analyticFlips;
        }
        t.equalU64("closed form assembles at every crank angle of a full turn",
                   static_cast<std::uint64_t>(analyticSamples), 721);
        t.equalU64("closed form never swaps branch over a full turn",
                   static_cast<std::uint64_t>(analyticFlips), 0);

        int frameFlips = 0;
        for (const auto& f : sink.frames()) {
            const double th2 = probe(f, "crank_theta_rad");
            const double thR = probe(f, "rocker_theta_rad");
            const double cx  = probe(f, "rocker_cx_m"), cy = probe(f, "rocker_cy_m");
            const std::array<double, 2> bm{cx + (spec.rocker / 2.0) * std::cos(thR),
                                           cy + (spec.rocker / 2.0) * std::sin(thR)};
            if (branchSign(th2, bm) * refSign <= 0.0) ++frameFlips;
        }
        t.equalU64("the ANIMATION never swaps branch either",
                   static_cast<std::uint64_t>(frameFlips), 0);
    }

    return t.exitCode();
}
