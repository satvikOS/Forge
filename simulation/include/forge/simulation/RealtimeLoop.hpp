#pragma once

// RealtimeLoop — the real-time ANIMATION PRODUCER (SR-4, sacrosanct §14.5).
//
// WHAT IT IS
// ----------
// A loop that drives the EXISTING constrained multibody DAE integrator
// (forge::simulateMultibody — index-3 HHT-alpha with Baumgarte stabilisation,
// forge-kernel/src/MultibodyDynamics.cpp) in fixed-size chunks and emits one
// AnimationFrame per chunk at a DECLARED target frame rate, inside a DECLARED
// validity envelope.
//
// It is NOT a renderer and NOT an interpolator. Every number in every frame
// came out of the integrator; nothing is keyframed, eased, or resampled. That
// distinction is the whole reason this module exists next to
// forge-kernel/src/Animation.cpp, which is a keyframe evaluator and therefore
// cannot, by construction, satisfy SR-4.
//
// THE NO-ADAPTATION RULE
// ----------------------
// A real-time loop that falls behind has exactly two honest options: run slower
// than real time, or drop what it shows. It must NEVER take the third one --
// quietly enlarging the timestep or skipping integrator steps -- because that
// changes the physics while continuing to look smooth, which is the precise
// failure SR-4 outlaws. This driver therefore:
//
//   * holds `solverDt` and `stepsPerFrame` CONSTANT for the entire run, and
//     reports the first/last/min/max dt and the min/max stepsPerFrame actually
//     used so a test can assert they never moved;
//   * takes exactly (frameCount - 1) * stepsPerFrame integrator steps and
//     reports the total, so a skipped step is arithmetically detectable;
//   * signals lateness ONLY through AnimationFrame::validity == Degraded.
//
// WHERE THE EVIDENCE COMES FROM (and why that is the whole point)
// --------------------------------------------------------------
// Every no-adaptation number in RealtimeRun -- and every frame's simTime -- is
// READ BACK OUT OF THE INTEGRATOR'S OWN RESULT, never copied from the config
// that was handed to it. The measured timestep is MbdResult::samples.back().t
// divided by MbdResult::stepsTaken: the simulated time the integrator says it
// covered, over the steps it says it took. Echoing `cfg.solverDt` back as
// "the dt that was used" would make the no-adaptation claim unfalsifiable --
// enlarging the timestep on the way INTO the integrator would change the
// physics while every reported quantity kept saying the declared value. The
// driver goes further and REFUSES the run: a measured dt that differs from the
// declared one by more than float rounding aborts with a "silent timestep
// adaptation" reason rather than emitting frames.
//
// Consequence, and the property the gate tests: a run driven far past its
// real-time budget and a run given a generous budget produce BYTE-IDENTICAL
// trajectories -- identical frame result hashes and identical sequence hash --
// and differ only in `validity` and the (unhashed) wall-clock fields.
//
// CHUNKED INTEGRATION AND WHAT IT COSTS
// -------------------------------------
// simulateMultibody has no per-step callback, so the driver re-enters it once
// per frame, handing the previous chunk's final (q, qdot) back in as the next
// chunk's initial condition. Position and velocity are carried EXACTLY. The
// acceleration is not: on entry the solver re-derives a consistent qddot from
// the KKT system at (q, qdot), whereas a monolithic run would carry the
// corrector's qddot from the alpha-weighted state. The difference is O(dt) and
// is a re-projection onto the constraint manifold rather than an error, but it
// is a real difference and this module does not hide it: SliderCrankGate
// measures the chunked-vs-monolithic deviation and reports it. Physical
// correctness is gated against the ANALYTIC reference, not against the
// monolithic run.

#include "forge/MultibodyDynamics.hpp"
#include "forge/simulation/AnimationFrame.hpp"

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace forge {
namespace simulation {

// ---------------------------------------------------------------------------
// The declared envelope. Every term is a number the caller states UP FRONT;
// nothing here is discovered from the run and widened to fit it.
// ---------------------------------------------------------------------------
struct RealtimeEnvelope {
    double targetFrameRateHz = 50.0;   // declared emission rate

    // Soft bound: crossing it means the answer is drifting but still usable.
    double warnConstraintResidual = 1e-7;
    // Hard bound: crossing it means the frame is NOT evidence.
    double maxConstraintResidual  = 1e-4;
    // Hard bound on |E - E0| / |E0| accumulated since frame 0.
    double maxEnergyDrift         = 1e-3;
    // wall/budget above this marks the frame Degraded (1.0 == exactly on time).
    double maxWallOverrunRatio    = 1.0;
};

struct RealtimeLoopConfig {
    double        solverDt      = 1e-4;  // FIXED for the whole run
    std::uint32_t stepsPerFrame = 200;   // FIXED for the whole run
    // Total frames emitted INCLUDING frame 0, which is the initial state at
    // t = 0 and consumes zero integrator steps.
    std::uint32_t frameCount = 61;

    // Integrator settings, passed straight through to simulateMultibody.
    double alpha           = -0.02;
    double baumgarteOmega  = 150.0;
    double baumgarteZeta   = 1.0;

    // The declared validity/error envelope this run is judged against.
    RealtimeEnvelope envelope;

    // Must be non-zero: the frame contract rejects a frame that cannot name
    // the geometry it belongs to. Use geometryRevisionOf() to derive one from
    // the model itself -- from bodies, constraints, loads AND gravity -- so
    // that changing anything the integrator reads changes the revision.
    std::uint64_t geometryRevision = 0;

    // When true the loop sleeps out the remainder of each frame budget, so the
    // producer runs at wall-clock rate. Off in gates (they measure, not wait);
    // on for a live viewport feed.
    bool paceToRealtime = false;
};

// Probe extractor: reads named scalars off the solver sample that ends a frame.
// Probes are part of the hashed frame content, so this must be a pure function
// of the sample.
using ProbeFn = std::function<void(const MbdSample&, std::vector<Probe>&)>;

struct RealtimeRun {
    std::uint64_t sequenceHash = 0;
    std::uint32_t framesEmitted   = 0;
    std::uint32_t framesAccepted  = 0;
    std::uint32_t framesRejected  = 0;
    std::uint32_t degradedFrames  = 0;
    std::uint32_t invalidFrames   = 0;

    // --- no-adaptation evidence: MEASURED, never echoed from the config ---
    // Each is derived from MbdResult (elapsed simulated time / steps taken),
    // so a timestep enlarged on the way into the integrator moves these
    // numbers instead of being reflected back unchanged. All zero if no
    // integrator call in the run produced a usable time base.
    double        solverDtFirst    = 0.0;   // first integrator call
    double        solverDtLast     = 0.0;   // last integrator call
    double        solverDtMin      = 0.0;   // min over every integrator call
    double        solverDtMax      = 0.0;   // max over every integrator call
    std::uint32_t stepsPerFrameMin = 0;     // min MbdResult::stepsTaken per chunk
    std::uint32_t stepsPerFrameMax = 0;     // max MbdResult::stepsTaken per chunk
    std::uint64_t totalSolverSteps = 0;     // sum of MbdResult::stepsTaken
    // Simulated seconds covered, accumulated from the integrator's own reported
    // elapsed time per chunk. This is the value the last frame's simTime holds.
    double        simulatedSeconds = 0.0;

    // --- realtime accounting ---
    double declaredFrameBudgetSeconds = 0.0;
    double maxWallOverrunRatio        = 0.0;
    double totalSolverWallSeconds     = 0.0;
    double achievedFrameRateHz        = 0.0;  // frames / total wall seconds

    // --- physics accounting ---
    // Max over every frame of AnimationFrame::maxConstraintResidual, i.e. the
    // largest ‖Φ‖ the integrator passed through ANYWHERE in the run -- not
    // merely at the instants the frames sampled.
    double maxConstraintResidual = 0.0;
    double maxEnergyDrift        = 0.0;
    double initialEnergy         = 0.0;

    bool        completed = false;   // all frameCount frames emitted and accepted
    std::string abortReason;         // empty iff completed
};

// Content-derived revision id for a model: FNV-1a/64 over EVERY input that
// changes the trajectory -- bodies, constraints, applied loads AND gravity.
// Non-zero by construction (the offset basis is non-zero and the prime is odd,
// and a model with at least one body always mixes in a length).
//
// The load and gravity terms are not decoration. SR-4 requires each frame to
// name the revision it belongs to, and a revision that ignores an input which
// changes the answer does not identify the run: two runs under different
// gravity would carry the SAME revision and DIFFERENT trajectories, so a
// consumer holding a stored sequence could not tell that it no longer
// describes the model in front of it. Every argument driveRealtime integrates
// is hashed here, and the argument list is deliberately the same one.
std::uint64_t geometryRevisionOf(const std::vector<MbdBody>& bodies,
                                 const std::vector<MbdConstraint>& constraints,
                                 const std::vector<MbdLoad>& loads,
                                 const MbdGravity& gravity);

// The timestep the integrator ACTUALLY used, read back out of its result:
// elapsed simulated time (samples.back().t) divided by steps actually taken
// (stepsTaken). Returns 0.0 when the result carries no usable time base (no
// step taken, fewer than two samples, or a non-finite/non-positive quotient).
//
// This is the whole no-adaptation mechanism in one function, and it is public
// so a gate can assert directly that it SEES a timestep that was changed
// behind the driver's back rather than having to trust the driver's own
// report. Valid only when stepsTaken is a whole multiple of the sample stride
// -- which driveRealtime guarantees for every call it makes.
double observedSolverDt(const MbdResult& r);

// Drive the mechanism and push every frame through `sink`. The sink is the
// enforcement point: a frame that violates the contract is rejected there and
// the run reports it rather than pretending it was emitted.
RealtimeRun driveRealtime(const std::vector<MbdBody>& bodies,
                          const std::vector<MbdConstraint>& constraints,
                          const std::vector<MbdLoad>& loads,
                          const MbdGravity& gravity,
                          const RealtimeLoopConfig& cfg,
                          const ProbeFn& probeFn,
                          FrameSink& sink);

}  // namespace simulation
}  // namespace forge
