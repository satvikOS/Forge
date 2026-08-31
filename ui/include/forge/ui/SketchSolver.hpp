// ui/include/forge/ui/SketchSolver.hpp
//
// THE CONSTRAINT SOLVER. This is the part that does not exist in Forge, and the
// reason a sketcher is hard rather than tedious.
//
// ── the formulation ─────────────────────────────────────────────────────────
// Every constraint is written as a RESIDUAL VECTOR r_i(x) that is zero exactly
// when the constraint holds, where x is the sketch's flat parameter vector
// (Sketch.hpp). Solving the sketch is then the least-squares problem
//
//     minimise  ||r(x)||^2      over x in R^n
//
// which is solved by LEVENBERG–MARQUARDT: repeatedly take
//
//     (J^T J + lambda * diag(J^T J)) * delta = -J^T r
//
// and accept `delta` when it reduces ||r||, shrinking lambda towards a Gauss–
// Newton step when progress is good and growing it towards gradient descent when
// it is not. Marquardt's own diagonal scaling is used rather than lambda*I so
// that a radius in millimetres and an angle in radians — parameters whose
// natural scales differ by two orders of magnitude — are damped proportionally.
//
// The Jacobian is NUMERIC (central differences). That is a deliberate first
// choice, not a shortcut deferred: an analytic Jacobian is a second, silent
// transcription of every residual, and a wrong derivative does not fail loudly —
// it converges slowly to the right answer and hides. The step size is scaled per
// parameter (h = eps * max(1, |x_j|)), central differences give O(h^2) error,
// and `sketch_solver_test` pins convergence on configurations with closed-form
// answers, which is what actually proves the derivatives.
//
// ── why Newton alone is not enough ──────────────────────────────────────────
// A sketch is almost never square. It is under-constrained while it is being
// drawn (m < n), and it is over-constrained the moment a user adds a dimension
// the geometry already implied (m > n, or m <= n with a rank-deficient J). Plain
// Newton needs a square non-singular system and has nothing to say about either.
// Least-squares plus damping handles both, and the RANK of J is what tells them
// apart afterwards.
//
// ── DIAGNOSE, NEVER REFUSE ──────────────────────────────────────────────────
// The binding constraint on this whole app is that nothing may refuse input.
// This solver never throws away a sketch:
//
//   * it always returns the BEST ITERATE it found, with its residual, even when
//     it did not converge — so an unsolvable sketch keeps the geometry the user
//     drew rather than being reset,
//   * an OVER-CONSTRAINED sketch reports WHICH constraints are redundant (they
//     add no rank to J) by index,
//   * a CONFLICTING sketch reports WHICH constraints conflict, found by removing
//     each in turn and re-solving: a constraint whose removal lets the rest
//     converge is a member of a minimal conflicting set,
//   * a MALFORMED constraint (an entity that does not exist, `radius` on a line,
//     `parallel` on a circle) is listed by index and SKIPPED, so one bad
//     constraint does not cost the user the other forty.
//
// Every report is by CONSTRAINT INDEX, which is what a repair loop can act on.
#ifndef FORGE_UI_SKETCHSOLVER_HPP
#define FORGE_UI_SKETCHSOLVER_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/Sketch.hpp"

namespace forge::ui {

// ── the constraint set ──────────────────────────────────────────────────────
// Eleven geometric and four dimensional constraints. Each names the operands it
// uses; every other operand is ignored and must be left default.
//
//   kind          a                 b                 c            value
//   ------------- ----------------- ----------------- ------------ ---------
//   Coincident    point             point             -            -
//   Collinear     line              line              -            -
//   Parallel      line/spline       line/spline       -            -
//   Perpendicular line/spline       line/spline       -            -
//   Tangent       circle/arc        line OR circle/arc -           -
//   Concentric    circle/arc        circle/arc        -            -
//   Equal         two lines OR two circles/arcs       -            -
//   Horizontal    point             point (or line via Start/End)  -
//   Vertical      point             point                          -
//   Symmetric     point             point             line         -
//   Fix           point             -                 -            (target in
//                                                                   fixX/fixY)
//   Distance      point             point             -            mm
//   Angle         line              line              -            degrees
//   Radius        circle/arc        -                 -            mm
//   Diameter      circle/arc        -                 -            mm
enum class SketchConstraintKind : std::uint8_t {
  Coincident = 0,
  Collinear,
  Parallel,
  Perpendicular,
  Tangent,
  Concentric,
  Equal,
  Horizontal,
  Vertical,
  Symmetric,
  Fix,
  Distance,
  Angle,
  Radius,
  Diameter,
};

const char* toString(SketchConstraintKind kind) noexcept;

struct SketchConstraint {
  SketchConstraintKind kind = SketchConstraintKind::Coincident;
  std::string name;          // optional human label, echoed in diagnostics
  SketchRef a{};
  SketchRef b{};
  SketchRef c{};
  double value = 0.0;        // dimensional value: mm, or DEGREES for Angle
  double fixX = 0.0;         // Fix only: the position the point is pinned to
  double fixY = 0.0;

  // Tangent between a circle and another circle can mean two different things
  // and a solver that picks one silently is guessing. `internal` selects the
  // internally-tangent branch (|c1-c2| = |r1-r2|); the default is external
  // (|c1-c2| = r1+r2). Ignored for circle-line tangency, which has one meaning.
  bool internalTangent = false;
};

// The factories. They exist so a caller cannot leave `value` set on a geometric
// constraint or forget `c` on a symmetry, both of which produce a constraint
// that solves to something nobody asked for.
SketchConstraint coincident(SketchRef a, SketchRef b, std::string name = {});
SketchConstraint collinear(int lineA, int lineB, std::string name = {});
SketchConstraint parallel(int a, int b, std::string name = {});
SketchConstraint perpendicular(int a, int b, std::string name = {});
SketchConstraint tangent(int curve, int other, bool internal = false, std::string name = {});
SketchConstraint concentric(int a, int b, std::string name = {});
SketchConstraint equal(int a, int b, std::string name = {});
SketchConstraint horizontal(SketchRef a, SketchRef b, std::string name = {});
SketchConstraint vertical(SketchRef a, SketchRef b, std::string name = {});
SketchConstraint symmetric(SketchRef a, SketchRef b, int axisLine, std::string name = {});
SketchConstraint fixPoint(SketchRef a, double x, double y, std::string name = {});
SketchConstraint distance(SketchRef a, SketchRef b, double mm, std::string name = {});
SketchConstraint angleBetween(int lineA, int lineB, double degrees, std::string name = {});
SketchConstraint radius(int curve, double mm, std::string name = {});
SketchConstraint diameter(int curve, double mm, std::string name = {});

// How many scalar residuals this constraint contributes. 0 means MALFORMED for
// the given sketch — the operands do not name the quantities the kind needs.
std::size_t sketchResidualCount(const Sketch& sketch, const SketchConstraint& constraint);

// ── the verdict ─────────────────────────────────────────────────────────────
enum class SketchStatus : std::uint8_t {
  // Converged, and the remaining freedom is real: dof > 0 with no redundancy.
  UnderConstrained = 0,
  // Converged, dof == 0, no redundant constraint. Exactly one solution nearby.
  FullyConstrained,
  // Converged, but at least one constraint adds no rank: it is implied by the
  // others. Consistent, so the sketch is still solved — and still worth saying,
  // because the redundant one cannot be edited to change anything.
  OverConstrained,
  // Did NOT converge: the residual cannot be driven to zero. The constraints
  // disagree. `conflicting` names them.
  Conflicting,
  // At least one constraint is malformed for this sketch. The others were still
  // solved; `malformed` names the ones that were skipped.
  Malformed,
};

const char* toString(SketchStatus status) noexcept;

struct SketchSolveResult {
  bool converged = false;
  SketchStatus status = SketchStatus::UnderConstrained;
  std::size_t iterations = 0;
  std::size_t freeParameters = 0;   // n
  std::size_t residuals = 0;        // m, malformed constraints excluded
  std::size_t rank = 0;             // numeric rank of J at the returned iterate
  std::size_t degreesOfFreedom = 0; // n - rank
  double residualNorm = 0.0;        // L2
  double maxResidual = 0.0;         // L-infinity, the number `tolerance` gates
  // ALWAYS populated, converged or not: the best iterate seen. This is the
  // "return the best iterate with a residual, not nothing" rule.
  std::vector<double> parameters;
  std::vector<std::size_t> conflicting;  // constraint indices
  std::vector<std::size_t> redundant;    // constraint indices
  std::vector<std::size_t> malformed;    // constraint indices
  std::string detail;                    // human summary; never the only report
};

struct SketchSolverOptions {
  std::size_t maxIterations = 200;
  double tolerance = 1e-9;        // on max |residual|
  double stepTolerance = 1e-14;   // on ||delta||
  double initialLambda = 1e-3;
  // eps in h = eps * max(1, |x_j|). 1e-6 rather than the textbook cube-root of
  // machine epsilon because the DOF count depends on this: a central difference
  // carries roundoff ~ eps_mach/h and truncation ~ h^2, so h = 1e-6 puts the
  // Jacobian's own noise near 1e-10 — three orders below `rankTolerance`. At
  // h = 1e-7 the noise floor and the rank tolerance meet, and the reported
  // degrees of freedom start depending on rounding.
  double jacobianStep = 1e-6;
  // The threshold at which a row of J, after row-scaling and elimination against
  // the rows before it, counts as a linear combination of them. Above the
  // Jacobian's noise floor, far below the O(0.1..1) a genuinely independent
  // direction leaves behind.
  double rankTolerance = 1e-7;
  // Conflict diagnosis costs one re-solve per constraint. It is on by default
  // because a conflict the user cannot locate is a sketch they must delete, but
  // it is skipped above `diagnosisLimit` constraints so a large sketch cannot
  // turn one failed solve into a quadratic amount of work.
  bool diagnoseConflicts = true;
  std::size_t diagnosisLimit = 64;
};

// Solves in place: on return the sketch holds `result.parameters` — the solution
// when it converged, the best iterate when it did not. It never holds a
// half-applied step.
SketchSolveResult solveSketch(Sketch& sketch, const std::vector<SketchConstraint>& constraints,
                              const SketchSolverOptions& options = SketchSolverOptions{});

// Evaluate every residual at `params`, in constraint order. Malformed
// constraints contribute nothing. Exposed because a gate that can only see the
// solver's verdict cannot tell a converged solve from a lucky one.
bool evaluateSketchResiduals(const Sketch& sketch,
                             const std::vector<SketchConstraint>& constraints,
                             const std::vector<double>& params, std::vector<double>& out);

// The numeric Jacobian at `params`, row-major, m x n. Exposed for the same
// reason, and used by the DOF count.
bool sketchJacobian(const Sketch& sketch, const std::vector<SketchConstraint>& constraints,
                    const std::vector<double>& params, double step, std::vector<double>& out,
                    std::size_t& rows, std::size_t& cols);

// Numeric rank of a row-major matrix by Gaussian elimination with partial
// pivoting, plus the indices of the rows that turned out to be linear
// combinations of earlier ones. That row list is what makes "which constraint is
// redundant" answerable rather than just "something is".
std::size_t matrixRank(const std::vector<double>& m, std::size_t rows, std::size_t cols,
                       double tolerance, std::vector<std::size_t>& dependentRows);

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHSOLVER_HPP
