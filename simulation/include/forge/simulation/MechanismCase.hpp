#pragma once

// MechanismCase — the concrete animated cases, end to end.
//
// These are the two closed-loop planar mechanisms that
// forge-kernel/test/physics_validation_harness.mjs already validates against
// closed-form kinematics (gates 7a and 7b): a slider-crank and a Grashof
// crank-rocker four-bar. The body/constraint definitions here are the SAME
// system the harness drives -- same masses, same inertias, same joints, same
// integrator settings -- so that the animation is not a separate model that
// happens to look similar, and a regression in one shows up in the other.
//
// The analytic references are the same ones the harness uses:
//
//   slider-crank   x(theta) = r cos(theta) + sqrt(l^2 - r^2 sin^2(theta))
//                  (Norton, Design of Machinery; Shabana, Computational
//                  Dynamics -- the standard offset-free slider-crank relation)
//
//   four-bar       joint B from the two-circle loop closure at the measured
//                  crank angle, open branch (Freudenstein, "Approximate
//                  Synthesis of Four-Bar Linkages", 1955)
//
// Both checks read the MEASURED driven-link angle out of the EMITTED FRAMES
// and compare the EMITTED output-link coordinate against the closed form at
// that same angle. That decoupling matters: it tests the mechanism relation
// the animation is showing, not the crank's speed, so a small drift in angular
// rate cannot be mistaken for a kinematic error (or hide one).
//
// CONSISTENT INITIAL VELOCITIES
// -----------------------------
// The harness starts these mechanisms with the flywheel spinning and every
// other link at rest. That is a velocity-level INCONSISTENT initial condition:
// it violates d/dt Phi(q) = J qdot = 0, so the index-3 DAE's Baumgarte term has
// to absorb the mismatch impulsively over the first few milliseconds. The
// harness's own gate is unaffected (it compares position against the closed
// form at the MEASURED crank angle, which stays exact through the transient),
// but for an ANIMATION the transient is a visible artefact: on the slider-crank
// it costs 6.07% of the crank's kinetic energy and drops the crank from
// 6.000 to 5.636 rad/s inside the first 0.1 s, and it produces a constraint
// residual spike three orders of magnitude above the steady-state value
// (measured: 4.22e-4 m peak vs ~2e-9 m thereafter).
//
// `consistentInitialVelocities` (default true) therefore seeds every link from
// the mechanism's own velocity-loop equation at the initial crank angle, so
// the run is on the constraint manifold in position AND velocity from frame 0.
// Set it false to reproduce the harness's exact initial condition -- which the
// gate does deliberately, to show the transient surfacing as Degraded/Invalid
// frames rather than being smoothed away.

#include "forge/MultibodyDynamics.hpp"
#include "forge/simulation/AnimationFrame.hpp"
#include "forge/simulation/RealtimeLoop.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge {
namespace simulation {

// A complete multibody model: everything simulateMultibody needs except the
// time-stepping configuration.
struct MechanismModel {
    std::vector<MbdBody>       bodies;
    std::vector<MbdConstraint> constraints;
    std::vector<MbdLoad>       loads;
    MbdGravity                 gravity;
};

// --------------------------------------------------------------------------
// Slider-crank
// --------------------------------------------------------------------------
struct SliderCrankSpec {
    double crankRadius   = 0.10;  // r  (m)
    double conrodLength  = 0.30;  // l  (m)
    double crankOmega0   = 6.0;   // initial crank spin about +Z (rad/s)
    // Seed conrod and slider from the velocity-loop equation at theta = 0
    // instead of leaving them at rest. See the header note.
    bool   consistentInitialVelocities = true;
};

MechanismModel buildSliderCrank(const SliderCrankSpec& spec);

// x(theta) = r cos(theta) + sqrt(l^2 - r^2 sin^2(theta))
double sliderCrankAnalyticX(const SliderCrankSpec& spec, double theta);

// Probe names emitted for the slider-crank case.
void sliderCrankProbes(const MbdSample& s, std::vector<Probe>& out);

// --------------------------------------------------------------------------
// Four-bar (Grashof crank-rocker)
// --------------------------------------------------------------------------
struct FourBarSpec {
    double ground  = 0.40;  // r1
    double crank   = 0.10;  // r2
    double coupler = 0.35;  // r3
    double rocker  = 0.30;  // r4
    double crankOmega0 = 5.0;  // rad/s
    bool   consistentInitialVelocities = true;
};

MechanismModel buildFourBar(const FourBarSpec& spec);

// Open-branch loop closure. Returns false when the crank angle admits no
// assembly (|cos gamma| > 1), in which case `out` is untouched.
bool fourBarCouplerPin(const FourBarSpec& spec, double crankAngle,
                       std::array<double, 2>& out);

void fourBarProbes(const MbdSample& s, std::vector<Probe>& out);

// --------------------------------------------------------------------------
// Frame-level analytic verification
// --------------------------------------------------------------------------
// Every field is MEASURED off the emitted frames. `maxErrorPct` is normalised
// by the mechanism's own characteristic length (slider stroke r + l; rocker
// length r4) exactly as the physics harness normalises its 2% gates.
struct AnalyticCheck {
    std::size_t comparedFrames = 0;
    std::size_t skippedFrames  = 0;   // crank angles with no assembly (four-bar)
    double      maxAbsError    = 0.0; // metres
    double      maxErrorPct    = 0.0; // % of characteristic length
    double      sweptAngleRad  = 0.0; // |theta| at the last frame
    double      maxOffAxis     = 0.0; // slider-crank only: |y| of the slider
};

AnalyticCheck checkSliderCrankFrames(const SliderCrankSpec& spec,
                                     const std::vector<AnimationFrame>& frames);

AnalyticCheck checkFourBarFrames(const FourBarSpec& spec,
                                 const std::vector<AnimationFrame>& frames);

// --------------------------------------------------------------------------
// Deterministic CONFIRMATION counterpart
// --------------------------------------------------------------------------
// Re-runs the identical case at a refined timestep (dt / refinement, with
// stepsPerFrame * refinement so the frames land on the SAME simulated times)
// and reports the live-vs-confirmation deviation. This is the discretisation
// self-check: it answers "how much of what you are looking at is the timestep"
// without any reference to an analytic solution, and so applies to cases that
// have none.
struct ConfirmationReport {
    std::uint32_t refinement       = 2;
    double        liveDt           = 0.0;
    double        confirmationDt   = 0.0;
    std::size_t   comparedFrames   = 0;
    double        maxPositionDelta = 0.0;  // m, max over bodies and frames
    // Max |live - confirmation| over every named probe of every frame. This is
    // the mechanism's ACTUAL OUTPUT -- the slider travel, the rocker angle --
    // and it is gated, not merely measured: a case whose output-link probe
    // moved when the timestep halved is showing discretisation, and reporting
    // that number without a bound on it would let it move by anything at all.
    double        maxProbeDelta    = 0.0;
    std::string   maxProbeName;            // which probe attained maxProbeDelta
    double        declaredEnvelope      = 0.0;  // position bound (m)
    double        declaredProbeEnvelope = 0.0;  // probe bound (probe units)
    bool          withinEnvelope   = false;     // BOTH bounds met
    bool          bothRunsComplete = false;
    // NOT evidence of anything, and deliberately NOT asserted on: solverStep
    // is part of computeResultHash and the confirmation run's step ladder is
    // refinement times finer by construction, so these two hashes differ even
    // if the refined timestep never reached the integrator at all. What
    // actually proves the timestep reached it is maxPositionDelta being
    // STRICTLY BETWEEN zero and the declared envelope: zero would mean the two
    // runs are the same computation, and a timestep that was ignored would put
    // the confirmation's frame i at twice the simulated time and blow the
    // bound by five orders of magnitude.
    std::uint64_t liveSequenceHash         = 0;
    std::uint64_t confirmationSequenceHash = 0;
};

ConfirmationReport runConfirmation(const MechanismModel& model,
                                   const RealtimeLoopConfig& liveCfg,
                                   const ProbeFn& probeFn,
                                   std::uint32_t refinement,
                                   double declaredEnvelopeMetres,
                                   double declaredProbeEnvelope);

}  // namespace simulation
}  // namespace forge
