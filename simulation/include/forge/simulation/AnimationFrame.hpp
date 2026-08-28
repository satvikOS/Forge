#pragma once

// AnimationFrame — the motion/animation FRAME CONTRACT (SR-4, sacrosanct §14.5).
//
// WHY A CONTRACT AND NOT A STRUCT
// -------------------------------
// SR-4 forbids static or scripted motion: every frame the user sees must be the
// output of an integrator stepping real equations over a NAMED revision of a
// NAMED model. A frame that cannot say
//
//     * WHICH geometry it belongs to   (geometryRevision)
//     * WHICH integrator step produced it (solverStep)
//     * WHAT its content hashes to     (resultHash)
//
// is not evidence — it is a picture. This header therefore ships the frame
// TOGETHER with the predicate that rejects such a frame (`checkFrame`) and a
// sink (`FrameSink`) that refuses to accumulate one. The rejection path is the
// point of the module: `forge::animation` (the pre-existing keyframe kernel in
// forge-kernel/src/Animation.cpp) can produce a perfectly smooth curve with no
// physics behind it at all, and nothing in its type would object. Here it is a
// hard error.
//
// HASHING
// -------
// `computeResultHash` is FNV-1a/64 over a CANONICAL byte serialisation of the
// frame's PHYSICAL content only:
//     frameIndex, simTime, geometryRevision, solverStep,
//     bodies[] (index, position, rotation, linear/angular velocity),
//     nodalDisplacement[], probes[] (name, value)
// Deliberately EXCLUDED: validity, constraintResidual, energyDrift,
// solverWallSeconds, frameBudgetSeconds. Those describe the RUN (how hard the
// machine was pushed, how close to the envelope the answer landed), not the
// trajectory. Excluding them is what makes the determinism gate meaningful: two
// runs of the same initial state and input must produce the same trajectory
// hash even when one of them was driven past its real-time budget and is
// therefore flagged Degraded. If wall-clock were hashed, the hash would only
// ever prove that the machine was idle.
//
// Doubles are hashed by their IEEE-754 bit pattern with -0.0 normalised to +0.0
// (they compare equal, so they must hash equal). Non-finite values never reach
// the hash: `checkFrame` rejects the frame first.

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace forge {
namespace simulation {

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------
// Valid    — every declared envelope term is inside budget.
// Degraded — the run is behind its real-time budget, or a soft (warn) envelope
//            term was crossed. The PHYSICS IS UNCHANGED: the driver is
//            forbidden from enlarging its timestep or dropping a step to catch
//            up, so a Degraded frame carries the same trajectory a Valid one
//            would have. The degradation is visible here and nowhere else.
// Invalid  — a HARD envelope term was breached (constraint residual / energy
//            drift out of the declared bound). The frame is still emitted —
//            hiding it would be the failure mode this contract exists to
//            prevent — but it is counted and must not be read as evidence.
// Diverged — the integrator produced a non-finite or unstable state. Rejected
//            outright by `checkFrame`: there is no trajectory to show.
enum class ValidityState : std::uint8_t {
    Valid    = 0,
    Degraded = 1,
    Invalid  = 2,
    Diverged = 3,
};

const char* toString(ValidityState s);

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

// Rigid-body pose + twist at the instant of the frame. `rotation` is the
// row-major 3x3 world rotation matrix (Rodrigues of the solver's axis-angle
// generalised coordinate), so a consumer needs no knowledge of the solver's
// rotation parameterisation.
struct BodyTransform {
    std::uint32_t body = 0;
    std::array<double, 3> position{0, 0, 0};
    std::array<double, 9> rotation{1, 0, 0, 0, 1, 0, 0, 0, 1};
    std::array<double, 3> linearVelocity{0, 0, 0};
    std::array<double, 3> angularVelocity{0, 0, 0};
};

// A named scalar read off the state at the frame instant — the quantity a gate
// or a plot actually compares against a reference (crank angle, slider travel,
// probe displacement). Probes are hashed, so a probe drift is a hash drift.
struct Probe {
    std::string name;
    double value = 0.0;
};

struct AnimationFrame {
    std::uint64_t frameIndex = 0;
    double        simTime    = 0.0;   // seconds of SIMULATED time

    // --- provenance: SR-4 requires all three, and all three are checked ---
    std::uint64_t geometryRevision = 0;  // must be non-zero
    std::uint64_t solverStep       = 0;  // integrator steps consumed at emit
    std::uint64_t resultHash       = 0;  // must equal computeResultHash(*this)

    // --- state ---
    std::vector<BodyTransform> bodies;
    // Nodal displacement field for a deforming part, packed x,y,z per node
    // (size must be a multiple of 3). Empty for a pure rigid-body frame.
    std::vector<double> nodalDisplacement;
    std::vector<Probe>  probes;

    // --- envelope diagnostics (NOT hashed; see header note) ---
    ValidityState validity = ValidityState::Valid;
    double constraintResidual  = 0.0;
    double energyDrift         = 0.0;
    double solverWallSeconds   = 0.0;  // measured cost of producing this frame
    double frameBudgetSeconds  = 0.0;  // declared budget it was measured against
};

// Canonical content hash. See header note for exactly which fields participate.
std::uint64_t computeResultHash(const AnimationFrame& f);

// ---------------------------------------------------------------------------
// The rejection predicate
// ---------------------------------------------------------------------------
struct FrameCheck {
    bool        accepted = false;
    std::string reason;   // empty iff accepted
};

// Rejects, with a reason:
//   * geometryRevision == 0            (frame does not name its geometry)
//   * resultHash == 0                  (frame does not name its content)
//   * resultHash != computeResultHash  (frame's content was altered after hashing)
//   * simTime non-finite or negative
//   * no state at all (no bodies AND no nodal field)
//   * nodalDisplacement.size() % 3 != 0
//   * any non-finite number anywhere in the payload
//   * validity == Diverged
FrameCheck checkFrame(const AnimationFrame& f);

// ---------------------------------------------------------------------------
// FrameSink — the only sanctioned way to accumulate a frame sequence.
// ---------------------------------------------------------------------------
// Enforces `checkFrame` PLUS the sequence invariants a real-time producer must
// hold: frameIndex increments by exactly one, solverStep is strictly
// increasing, and simTime is non-decreasing. A producer that silently dropped a
// frame to catch up would break the frameIndex chain here, which is why the
// no-adaptation gate can be written as an assertion on the sink rather than as
// trust in the driver.
class FrameSink {
public:
    // Returns true iff the frame was accepted and stored. A rejected frame is
    // NEVER stored and its reason is appended to `rejections()`.
    bool accept(const AnimationFrame& f);

    const std::vector<AnimationFrame>& frames() const { return frames_; }
    const std::vector<std::string>& rejections() const { return rejections_; }
    std::size_t acceptedCount() const { return frames_.size(); }
    std::size_t rejectedCount() const { return rejections_.size(); }

    // Rolling FNV-1a/64 over the accepted frames' resultHash values.
    std::uint64_t sequenceHash() const { return seqHash_; }

    void clear();

private:
    std::vector<AnimationFrame> frames_;
    std::vector<std::string>    rejections_;
    std::uint64_t seqHash_ = 1469598103934665603ULL;  // FNV-1a/64 offset basis
};

// Standalone sequence hash (same fold as FrameSink::sequenceHash), for
// comparing a stored sequence against a live one.
std::uint64_t sequenceHash(const std::vector<AnimationFrame>& frames);

}  // namespace simulation
}  // namespace forge
