#pragma once

// AssemblySolver — mate-constraint solver layered on ComponentRegistry.
//
// An "assembly" in Forge is the world view of ComponentRegistry: every
// instance carries a 4×4 transform. The solver moves those transforms so
// that a set of declared mate constraints are simultaneously satisfied
// (residual < 1e-6) — e.g. "instance 2's axis is colinear with instance
// 1's axis AND instance 2's origin is 5 mm away from instance 1's origin".
//
// Design choices for slice Forge-7:
//
//  * 6-DOF per instance (3 translation + axis-angle rotation); axis-angle
//    is the rotation parameterisation that survives numerical Jacobian
//    estimation without gimbal lock for small steps. We pass it through
//    Rodrigues' formula to build a 3×3 rotation block on every residual
//    evaluation. Quaternions would also work but make the renormalisation
//    step awkward inside the solver loop — axis-angle is a flat R³.
//
//  * Numerical Jacobian via forward differences (h ≈ 1e-7 × max(|x|,1)).
//    Analytic Jacobians for the eight mate kinds are not free; for the
//    10-mate × 50-instance scale target a forward-diff fits the <100 ms
//    budget comfortably (≤ 100 iterations × 6N matvecs ≈ 30k mate evals).
//
//  * Sparse Jacobian (Eigen SparseMatrix<double>): each mate touches at
//    most 12 columns (6 DOFs × 2 instances) regardless of N. The LSQR
//    least-squares solve scales with the non-zero count, not N². For
//    Forge-7 we use Eigen's SparseQR for robustness with rank-deficient
//    Jacobians (over-constrained mate sets are common when sketching).
//
//  * topoId is intentionally schematic for Forge-7:
//        0 = origin / coordinate system
//        1 = primary axis (component +Z by convention)
//        2 = primary face (component XY plane normal +Z)
//        3 = secondary axis (component +X)
//    A future slice will replace this with a real OCCT subshape index.
//
//  * Fixed instances pin all 6 DOFs to whatever transform the registry
//    holds when setFixed() is called. The solver never writes to them.

#include "forge/ComponentRegistry.hpp"

#include <array>
#include <cstdint>
#include <mutex>
#include <vector>

namespace forge {

enum class MateKind : std::uint32_t {
    Coincident    = 0, // mates two origins (and faces) to be coincident
    Concentric    = 1, // aligns two axes (collinear, same orientation)
    Parallel      = 2, // axes parallel (any sign — uses cross product)
    Perpendicular = 3, // axes perpendicular (dot = 0)
    Distance      = 4, // origins separated by `value`
    Angle         = 5, // axes form angle `value` (radians)
    Tangent       = 6, // primary face of A is tangent to primary axis of B
    Fixed         = 7, // pin a single instance's pose (handled via setFixed)
};

struct MateRef {
    InstanceId   inst;   // ComponentRegistry instance id
    std::uint32_t topoId; // 0=origin, 1=axis, 2=face, 3=secondary axis (see header note)
};

struct Mate {
    MateKind kind;
    MateRef  a;
    MateRef  b;
    double   value;  // used by Distance (mm) and Angle (radians)
    bool     active;
};

using MateId = std::uint32_t;
constexpr MateId kInvalidMate = 0;

struct SolveReport {
    bool        converged;
    std::uint32_t iterations;
    double      residual; // final L2 residual norm
};

class AssemblySolver {
public:
    static AssemblySolver& instance();

    // ---- mate lifecycle ----
    MateId addMate(MateKind kind, MateRef a, MateRef b, double value);
    void   removeMate(MateId id);
    void   setActive(MateId id, bool active);
    bool   exists(MateId id) const;
    std::size_t mateCount() const;

    // ---- instance pinning ----
    void setFixed(InstanceId id, bool fixed);
    bool isFixed(InstanceId id) const;

    // ---- main entry point ----
    // Resolves all active mates, writes back to ComponentRegistry on
    // convergence. Returns iteration count and final residual.
    SolveReport solve();

    // Last-solve diagnostics (also returned by solve()).
    std::uint32_t iterations() const;
    double        residual()   const;

    // Test helper: clear every mate and pin. Used by smoke tests so
    // successive runs in the same process start fresh.
    void clearAll();

    // ---- Forge-35: motion-study introspection ----
    // Lists every active mate in stable insertion order. Used by the
    // motion-study driver to find / mutate a driver mate's `value`.
    std::vector<Mate> listMates() const;
    // Look up a mate's parameters by id.
    Mate getMate(MateId id) const;
    // Update a mate's `value` (Distance mm, Angle radians). No-op on
    // mate kinds that ignore `value`.
    void setMateValue(MateId id, double value);
    // Find the first active mate whose schema references the given
    // (inst, topoId) and whose kind is Distance or Angle. Returns
    // kInvalidMate if none. Preference order: Distance, then Angle.
    MateId findDrivingMate(InstanceId inst, std::uint32_t topoId) const;

private:
    AssemblySolver() = default;

    struct MateSlot {
        Mate mate;
        bool alive;
    };

    mutable std::mutex            mtx_;
    std::vector<MateSlot>         mates_;
    std::vector<std::uint32_t>    freeList_;
    std::vector<InstanceId>       fixedInstances_; // sorted, deduped
    std::uint32_t                 lastIterations_ = 0;
    double                        lastResidual_   = 0.0;
};

// ----------------------------------------------------------------
// Geometry helpers exposed for the binding's smoke assertions.
// All operate in row-major 4×4 transforms identical to Transform4x4.
// ----------------------------------------------------------------

// Build a rotation matrix from an axis-angle (Rodrigues' formula).
std::array<double, 9> rodrigues(double rx, double ry, double rz);

// Compose a Transform4x4 from (translation, axis-angle).
Transform4x4 makeTransform(double tx, double ty, double tz,
                           double rx, double ry, double rz);

// Apply the transform to the world-frame canonical vectors associated
// with a topoId (0=origin → (0,0,0); 1=+Z axis; 2=+Z face normal;
// 3=+X axis).
struct TopoFrame {
    std::array<double, 3> point;     // world point
    std::array<double, 3> direction; // world direction (unit-length when applicable)
};
TopoFrame frameFor(const Transform4x4& x, std::uint32_t topoId);

} // namespace forge
