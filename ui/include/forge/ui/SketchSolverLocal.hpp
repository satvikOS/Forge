// ui/include/forge/ui/SketchSolverLocal.hpp
//
// THE IN-TREE IMPLEMENTATION OF `SketchSolver` — the thing that makes the DOF
// readout a measurement rather than a label.
//
// ── what it computes, and why that is the honest formulation ────────────────
// A sketch's degrees of freedom are not "entities times 2 minus constraints".
// That arithmetic is wrong the moment any constraint is redundant, which is the
// exact moment a user needs to be told something. The real statement is linear
// algebra:
//
//     unknowns = the packed variable vector (SketchScene's column order)
//     J        = the Jacobian of every DRIVING constraint's equations, at the
//                sketch's current configuration
//     dof      = unknowns - rank(J)
//
// and over-constraint is precisely a constraint whose rows are LINEARLY
// DEPENDENT on the rows already present: it moves nothing that was not already
// pinned. So this class builds J and runs a modified Gram-Schmidt pass over its
// rows, in constraint order, carrying each row's RESIDUAL through the same
// orthogonalisation. That one extra column of bookkeeping is what separates the
// two answers a user needs to tell apart:
//
//   REDUNDANT   the dependent row's carried residual is ~0: it agrees with the
//               set (two horizontals on one line). The sketch still solves; drop
//               either constraint.
//   CONFLICTING the carried residual is not ~0: no configuration satisfies both
//               (10 mm and 20 mm across the same pair of points). This is the
//               one to say loudly, and it is why the report can name the SET
//               rather than blaming whichever constraint happened to be last.
//
// ── what it is NOT ──────────────────────────────────────────────────────────
// It does not MOVE geometry. Dragging a constrained sketch back onto its
// constraints is a Newton iteration the sketcher CORE owns; this is the analysis
// the interaction layer needs in order to report state and to keep the
// auto-constrainer from over-helping. Both live behind the same port, so when
// the core arrives it can answer `analyse()` too and this file stops being
// constructed.
//
// ── stated limits, not hidden ones ──────────────────────────────────────────
//   * The Jacobian is evaluated AT THE CURRENT CONFIGURATION. Rank is a local
//     property: a configuration that is accidentally degenerate (two coincident
//     lines) can report a rank one lower than the generic one. `probes` runs the
//     analysis at small random perturbations as well and keeps the HIGHEST rank
//     seen, which removes the common accidental degeneracies; it cannot remove
//     all of them, and that is a property of the question, not of this code.
//   * Derivatives are CENTRAL DIFFERENCES, error O(h^2) ~ 1e-10 relative, which
//     is four orders below the rank tolerance. Analytic derivatives would be
//     faster, not more correct, and would have to be re-derived for every new
//     constraint kind.
//   * Cost is O(equations^2 * unknowns) in the orthogonalisation. A sketch is
//     tens of entities, not a 430-face part, and `SketchSession` caches the
//     report and recomputes it only when the scene changes.
#ifndef FORGE_UI_SKETCHSOLVERLOCAL_HPP
#define FORGE_UI_SKETCHSOLVERLOCAL_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/SketchScene.hpp"

namespace forge::ui {

// The equations of ONE constraint at the scene's current configuration, in the
// order `equationCountFor` counts them. Empty for a driven dimension or a
// malformed constraint. Public because a gate that cannot see the equations
// cannot prove the DOF number means anything: the residual of a satisfied
// constraint must be zero, and that is directly assertable.
std::vector<double> sketchConstraintResiduals(const SketchScene& scene,
                                              const SketchConstraint& c);

class SketchSolverLocal final : public SketchSolver {
 public:
  struct Tuning {
    // A row whose component orthogonal to everything before it is shorter than
    // this (the rows are unit-normalised first) adds no rank.
    double rankTolerance = 1.0e-7;
    // How far a dependent row's carried residual may sit from zero and still be
    // called AGREEMENT rather than contradiction. In the row's own normalised
    // units, so a distance in mm and an angle in degrees are comparable.
    double residualTolerance = 1.0e-6;
    // Central-difference step, relative to the variable's magnitude and floored
    // so a variable sitting at exactly 0 still gets a usable step.
    double step = 1.0e-6;
    // Extra analyses at perturbed configurations, to see past an accidentally
    // degenerate one. 0 disables; the report then says so.
    std::size_t probes = 2;
    // How far a probe moves each variable.
    double probeAmplitude = 1.0e-3;
  };

  SketchSolverLocal() = default;
  explicit SketchSolverLocal(const Tuning& tuning) : tuning_(tuning) {}

  SketchDofReport analyse(const SketchScene& scene) const override;

  const Tuning& tuning() const noexcept { return tuning_; }

 private:
  SketchDofReport analyseAt(const SketchScene& scene) const;
  Tuning tuning_{};
};

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHSOLVERLOCAL_HPP
