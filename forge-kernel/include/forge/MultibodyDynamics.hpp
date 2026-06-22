#pragma once

// MultibodyDynamics — constrained inertial multibody time integrator.
//
// This is the REAL dynamics solver that the FORGE_PHYSICS_VERIFICATION report
// (§5c) flagged as the upgrade from the kinematic "motion study". Where
// MotionStudy.cpp sweeps a driving-mate value and re-solves the *static*
// assembly constraints frame-by-frame (no mass, no inertia), this module
// integrates Newton-Euler equations of motion
//
//        M q̈ + C q̇ + Φ_qᵀ λ = F(q, q̇, t)
//        Φ(q) = 0                         (holonomic mate constraints)
//
// as an index-3 differential-algebraic system, time-marched with a
// stabilized scheme so the constraint manifold does not drift.
//
// ----------------------------------------------------------------------------
// State parameterisation
// ----------------------------------------------------------------------------
// Each body carries 6 generalised coordinates: 3 translation of the centre of
// mass (x, y, z) and a 3-component rotation vector (axis-angle, world frame),
// mirroring the AssemblySolver 6-DOF convention so the same constraint
// Jacobian machinery applies. For the verified benchmark cases the angular
// motion is about a single fixed axis, where the rotation vector reduces to a
// scalar θ·n̂ and the inertia term M_rot q̈_rot = I·θ̈ is exact. (General 3-D
// large-rotation gyroscopic coupling — the ω×(Iω) term — is included as an
// explicit Coriolis/centrifugal contribution in C·q̇; see notes in the .cpp.)
//
// ----------------------------------------------------------------------------
// Mass matrix
// ----------------------------------------------------------------------------
// M = blkdiag(m·I₃, J) per body, where m is the body mass and J its 3×3
// inertia tensor about the centre of mass. Both may be supplied directly or
// derived from geometry (volume × density via MassProps + a solid-body inertia
// estimate). M is constant (block-diagonal, lumped at the COM) which keeps the
// effective-mass factorisation cheap and is exact for rigid bodies.
//
// ----------------------------------------------------------------------------
// Constraints
// ----------------------------------------------------------------------------
// A constraint is one scalar holonomic equation g(q) = 0 of one of a small set
// of kinds, evaluated and differentiated exactly the way AssemblySolver does
// (forward-difference Jacobian Φ_q). Supported here:
//   * BallJoint   — pin a body point to a fixed world anchor (3 eqs): the
//                   pendulum / rotor pivot.
//   * AxisLock    — pin a body's rotation to a single allowed axis (2 eqs):
//                   confine spin to one axis (rotor / hinge).
//   * Distance    — keep two body points a fixed distance apart (1 eq).
//   * Spherical   — coincide a point on bodyA with a point on bodyB (3 eqs):
//                   a TWO-MOVING-BODY ball joint. This is the joint that closes
//                   a kinematic loop (four-bar / slider-crank), turning the set
//                   of constraints into a cyclic graph. C(q) = (r_A + R_A s_A)
//                   − (r_B + R_B s_B) = 0  (Shabana, Computational Dynamics,
//                   §3, eq. of the spherical/ball pair). The constraint enters
//                   the index-3 DAE through the SAME multiplier/Baumgarte path
//                   as the single-body joints — the only difference is its
//                   Jacobian spans the 6 DOFs of BOTH bodies.
//
// ----------------------------------------------------------------------------
// Integrator
// ----------------------------------------------------------------------------
// HHT-α (Hilber–Hughes–Taylor) with a Newmark predictor and Baumgarte
// constraint stabilisation. HHT-α is the workhorse implicit scheme for
// constrained multibody DAEs (used by MSC ADAMS, Simscape Multibody): it is
// second-order accurate and adds controllable numerical damping of the
// unresolved high-frequency constraint modes via a single parameter
// α ∈ [-1/3, 0]. With α = 0 it degenerates to trapezoidal Newmark
// (β = 1/4, γ = 1/2), the energy-conserving constant-average-acceleration
// rule already used by the Fea transient path. Constraint drift is suppressed
// with Baumgarte feedback Φ̈ + 2ξω Φ̇ + ω² Φ = 0 folded into the acceleration
// solve. The coupled (q̈, λ) system is solved each step by a saddle-point
// (KKT) linear solve.

#include "forge/AssemblySolver.hpp"   // Transform4x4, makeTransform, frameFor helpers

#include <array>
#include <cstdint>
#include <vector>

namespace forge {

// --- inertia / body description -------------------------------------------

struct MbdBody {
    double mass = 1.0;                       // kg
    // Inertia tensor about the COM, body frame, row-major 3×3.
    std::array<double, 9> inertia{
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
    };
    // Initial generalised coordinates: COM position + axis-angle rotation.
    std::array<double, 3> position{0, 0, 0};
    std::array<double, 3> orientation{0, 0, 0}; // axis-angle (rad)
    // Initial generalised velocities: linear (m/s) + angular (rad/s, world).
    std::array<double, 3> linVel{0, 0, 0};
    std::array<double, 3> angVel{0, 0, 0};
};

// --- applied loads (constant in body- or world-frame over the run) ---------

struct MbdLoad {
    std::uint32_t body = 0;                  // index into the body array
    std::array<double, 3> force{0, 0, 0};    // world-frame force at COM (N)
    std::array<double, 3> torque{0, 0, 0};   // world-frame torque (N·m)
};

// Uniform gravity acceleration applied to every body (m/s²).
struct MbdGravity {
    std::array<double, 3> g{0, 0, 0};
};

// --- constraints ------------------------------------------------------------

enum class MbdConstraintKind : std::uint32_t {
    BallJoint  = 0,  // body point pinned to world anchor (3 scalar eqs)
    AxisLock   = 1,  // body spin confined to a single world axis (2 eqs)
    Distance   = 2,  // two body points a fixed distance apart (1 eq)
    Spherical  = 3,  // TWO moving bodies: point on A coincides with point on
                     // B — the closed-loop ball/revolute joint (3 scalar eqs)
    PointOnLine = 4, // body point confined to a world line through `anchor`
                     // along unit `axis` (2 eqs) — the prismatic/slider rail
                     // that completes a slider-crank loop.
};

struct MbdConstraint {
    MbdConstraintKind kind = MbdConstraintKind::BallJoint;
    std::uint32_t bodyA = 0;
    std::uint32_t bodyB = 0;               // ignored for BallJoint / AxisLock
    // Local attachment point on bodyA (BallJoint, Distance, Spherical) — body frame.
    std::array<double, 3> pointA{0, 0, 0};
    // Local attachment point on bodyB (Distance, Spherical) — body frame.
    std::array<double, 3> pointB{0, 0, 0};
    // World anchor (BallJoint) or allowed spin axis (AxisLock, unit) or
    // target separation magnitude in `value` (Distance).
    std::array<double, 3> anchor{0, 0, 0};
    std::array<double, 3> axis{0, 0, 1};
    double value = 0.0;
};

// --- run configuration + output --------------------------------------------

struct MbdConfig {
    double dt = 1e-3;                        // step size (s)
    std::uint32_t steps = 1000;              // number of steps
    double alpha = -0.05;                    // HHT-α numerical damping (∈[-1/3,0])
    double baumgarteOmega = 20.0;            // Baumgarte stabilisation freq (rad/s)
    double baumgarteZeta  = 1.0;             // Baumgarte damping ratio
    std::uint32_t sampleStride = 1;          // record every Nth step
};

struct MbdSample {
    double t = 0.0;
    std::vector<std::array<double, 3>> position;     // per body
    std::vector<std::array<double, 3>> orientation;  // per body, axis-angle
    std::vector<std::array<double, 3>> linVel;       // per body
    std::vector<std::array<double, 3>> angVel;       // per body
    double constraintResidual = 0.0;                 // ‖Φ(q)‖ at this sample
    double energy = 0.0;                             // total kinetic+potential (J)
};

struct MbdResult {
    std::vector<MbdSample> samples;
    double maxConstraintDrift = 0.0;         // max ‖Φ‖ over the whole run
    double energyDrift = 0.0;                // |E_end − E_0| / |E_0|
    std::uint32_t stepsTaken = 0;
    bool   stable = true;                    // false if any NaN/blow-up detected
};

// Integrate the constrained multibody system forward in time.
MbdResult simulateMultibody(const std::vector<MbdBody>& bodies,
                            const std::vector<MbdConstraint>& constraints,
                            const std::vector<MbdLoad>& loads,
                            const MbdGravity& gravity,
                            const MbdConfig& cfg);

} // namespace forge
