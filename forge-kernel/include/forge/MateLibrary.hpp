#pragma once

// MateLibrary — assembly mate solver for the 12 SolidWorks-equivalent
// mate kinds. PUSH-04.
//
// This module is intentionally independent of ComponentRegistry /
// AssemblySolver: callers pass in a vector of ComponentPose values
// (translation + quaternion + fixed flag) and a vector of Mate records;
// the solver returns the converged poses. The reason for the split is
// that the registry-bound solver (forge::AssemblySolver) treats topoIds
// as schematic (0=origin, 1=+Z, 2=face, …); the matelib solver works
// directly with arbitrary 3D points and axes specified per mate, which
// is the shape that frontend tools and motion-study scripts actually
// produce. The two solvers can coexist.
//
// Algorithm: damped Gauss-Seidel.
//   * Each outer iteration walks every active mate in declaration order.
//   * For each mate, the solver evaluates the geometric residual using
//     the *current* world-frame point/axis pair (translation + quaternion
//     rotation applied to the local mate reference).
//   * The solver then computes a per-side correction (Δt + Δq via small-
//     angle axis-angle) and applies a damped step (gain ≈ 0.5 for
//     translations, 0.5 for rotations) to whichever side is not fixed.
//     If both sides are free, the correction is split 50/50.
//     If both sides are fixed, the mate contributes residual but no
//     correction (over-constrained — reported in the log).
//   * The iteration stops when the maximum scalar correction across all
//     mates falls below `tolerance`, or `maxIterations` is reached.
//   * The total L2 residual norm is recorded for the caller.
//
// Notes / caveats (read these honestly):
//   * Gimbal singularity: quaternion rotations are renormalised at every
//     step so we never hit gimbal lock in the parameterisation. However,
//     a mate that asks to align two near-antiparallel axes can pick
//     either of two valid rotation axes — the solver picks the one with
//     the smaller magnitude cross-product, which can stall. Solution:
//     start poses that aren't 180° apart. We log the case when it
//     happens.
//   * Distance / angle / gear mates are "coupling" residuals — they
//     don't directly say "move A here" so we project the error onto the
//     mate's geometric direction (line AB, or axis cross-product). This
//     is the simple analytic shortcut; not analytic-perfect for very
//     large initial offsets but converges geometrically nonetheless.
//   * The solver does not enforce non-penetration or interference — those
//     are downstream concerns handled by InterferenceDetection.

#include <cstdint>
#include <string>
#include <vector>

namespace forge {
namespace matelib {

// Reference into one side of a mate. `point` is the local-frame point
// (mm) on the component used by mates that need a point (coincident,
// distance, slot, …). `axis` is the local-frame unit direction used by
// mates that need a direction (concentric, parallel, …); for tangent
// the axis is reused as the plane normal. `extra` carries auxiliary
// scalar data:
//   * tangent: radius of the sphere/cylinder if A is one
//   * gear:    tooth count z (A or B)
//   * cam:     unused (table comes from outside)
//   * rack-pinion: pinion pitch radius (on A) or rack direction's
//                  travel-per-radian (on B)
//   * slot:    half-length of the slot segment along `axis` (on B)
//   * width:   distance from the centre-plane to each side plane (on B)
struct MateRef {
    int    component_id;
    double point[3];
    double axis[3];
    double extra;
};

// One mate constraint.
//   kind:  one of the 12 strings below.
//   value: mate-specific scalar (distance mm, angle radians, gear ratio
//          override if non-zero, cam target if it's a single-point
//          parametric driver, …). For most mates this is 0 and ignored.
//
// Supported kinds (lower-case):
//   "coincident", "concentric", "distance", "angle", "parallel",
//   "perpendicular", "tangent", "gear", "rack-pinion", "cam",
//   "slot", "width"
struct Mate {
    std::string kind;
    MateRef     A;
    MateRef     B;
    double      value;
};

// 6-DOF rigid-body pose. Quaternion is (w,x,y,z) and is renormalised on
// every iteration so callers can pass any non-zero quaternion in.
struct ComponentPose {
    int    id;
    double t[3];
    double q[4]; // (w,x,y,z), unit-normalised on entry/exit
    int    fixed; // 0 = free, non-zero = grounded
};

struct SolveResult {
    std::vector<ComponentPose> poses;
    bool   converged;
    int    iterations;
    double residual;            // final L2 norm of mate residuals
    std::vector<std::string> log; // per-mate notes (anomalies)
};

// Main entry point. Returns the converged poses (same order as input).
//
// Pre-conditions:
//   * Each pose has a unique `id`.
//   * Each Mate's A.component_id and B.component_id reference some pose.
//   * If `mates` is empty the solver returns the input poses unchanged.
//
// Behaviour:
//   * Runs at least 1 iteration even if the initial residual is below
//     tolerance, so callers can verify the solver was actually invoked.
//   * `maxIterations` is an upper cap; the solver returns early on
//     convergence (`max-correction < tolerance`).
//   * Residual reported is the L2 norm at the *final* iteration.
SolveResult solve(const std::vector<ComponentPose>& initialPoses,
                  const std::vector<Mate>&          mates,
                  int    maxIterations = 200,
                  double tolerance     = 1e-6);

}} // namespace forge::matelib
