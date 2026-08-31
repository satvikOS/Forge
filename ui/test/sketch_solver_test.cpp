// ui/test/sketch_solver_test.cpp
//
// THE SOLVER, against configurations whose answers are written down first.
//
// A constraint solver is the one component in a sketcher that cannot be checked
// by inspection: it either lands on the geometry the constraints describe or it
// lands somewhere plausible. So every convergence case below is a configuration
// with a CLOSED FORM — a circle inscribed in the corner of two axis lines has
// its centre at (r, r), a 30-degree line of length 30 ends at (30cos30,
// 30sin30), two externally tangent equal circles have their centres 2r apart —
// and the check is on the coordinate, not on "it converged".
//
// That is also what proves the NUMERIC JACOBIAN. Nothing here inspects a
// derivative; a wrong derivative shows up as a solve that stops somewhere else,
// which is exactly what these references catch. (MEMORY: "Volume cannot validate
// geometry" — one plausible scalar is how wrong geometry passes. Every case
// below checks a VECTOR of coordinates, not a single number.)
//
// The second half is the part the binding constraint demands: an over-constrained
// sketch must say WHICH constraint is redundant, a conflicting one must say WHICH
// constraints conflict, a malformed one must name the constraint and still solve
// the rest, and a solve that fails must hand back the best iterate rather than
// the sketch the user drew being thrown away.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/Sketch.hpp"
#include "forge/ui/SketchSolver.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

constexpr double kPi = 3.14159265358979323846;

bool contains(const std::vector<std::size_t>& v, std::size_t k) {
  return std::find(v.begin(), v.end(), k) != v.end();
}

double px(const Sketch& s, int entity, SketchPointRole role) {
  double x = 0.0, y = 0.0;
  return resolvePoint(s, s.parameters(), sketchRef(entity, role), x, y) ? x : 1e300;
}

double py(const Sketch& s, int entity, SketchPointRole role) {
  double x = 0.0, y = 0.0;
  return resolvePoint(s, s.parameters(), sketchRef(entity, role), x, y) ? y : 1e300;
}

}  // namespace

int main() {
  Harness H("sketch_solver");

  // ── 1. a rectangle, from four lines drawn by hand ─────────────────────────
  // The canonical first sketch. Four lines with sloppy endpoints, joined by
  // coincidence, squared by horizontal/vertical, anchored by one fix and sized
  // by two dimensions. 16 parameters, 16 residuals, and the answer is exactly
  // the 40 x 25 rectangle at the origin.
  {
    Sketch s;
    const int b = s.addLine("bottom", 0.1, 0.2, 39.0, -0.3);
    const int r = s.addLine("right", 39.0, -0.3, 41.0, 19.0);
    const int t = s.addLine("top", 41.0, 19.0, 0.5, 20.4);
    const int l = s.addLine("left", 0.5, 20.4, 0.1, 0.2);
    std::vector<SketchConstraint> k = {
        coincident(sketchRef(b, SketchPointRole::End), sketchRef(r, SketchPointRole::Start)),
        coincident(sketchRef(r, SketchPointRole::End), sketchRef(t, SketchPointRole::Start)),
        coincident(sketchRef(t, SketchPointRole::End), sketchRef(l, SketchPointRole::Start)),
        coincident(sketchRef(l, SketchPointRole::End), sketchRef(b, SketchPointRole::Start)),
        horizontal(sketchRef(b), SketchRef{}),
        horizontal(sketchRef(t), SketchRef{}),
        vertical(sketchRef(l), SketchRef{}),
        vertical(sketchRef(r), SketchRef{}),
        fixPoint(sketchRef(b, SketchPointRole::Start), 0.0, 0.0),
        distance(sketchRef(b, SketchPointRole::Start), sketchRef(b, SketchPointRole::End), 40.0),
        distance(sketchRef(r, SketchPointRole::Start), sketchRef(r, SketchPointRole::End), 25.0),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(static_cast<int>(res.status), static_cast<int>(SketchStatus::FullyConstrained));
    CHECK_EQ_INT(res.freeParameters, 16);
    CHECK_EQ_INT(res.residuals, 16);
    CHECK_EQ_INT(res.rank, 16);
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK(res.maxResidual <= 1e-9);
    CHECK_EQ_INT(res.redundant.size(), 0);
    CHECK_EQ_INT(res.conflicting.size(), 0);
    CHECK_EQ_INT(res.malformed.size(), 0);

    // Every corner, not just one: a solver that got the width right and the
    // height wrong would pass a single-number check.
    CHECK_NEAR(px(s, b, SketchPointRole::Start), 0.0, 1e-8);
    CHECK_NEAR(py(s, b, SketchPointRole::Start), 0.0, 1e-8);
    CHECK_NEAR(px(s, b, SketchPointRole::End), 40.0, 1e-8);
    CHECK_NEAR(py(s, b, SketchPointRole::End), 0.0, 1e-8);
    CHECK_NEAR(px(s, r, SketchPointRole::End), 40.0, 1e-8);
    CHECK_NEAR(py(s, r, SketchPointRole::End), 25.0, 1e-8);
    CHECK_NEAR(px(s, t, SketchPointRole::End), 0.0, 1e-8);
    CHECK_NEAR(py(s, t, SketchPointRole::End), 25.0, 1e-8);
    CHECK_EQ_STR(toString(res.status), "fully_constrained");

    // Solving again from the answer is a no-op, and solving twice from the same
    // start gives the same numbers: a solver whose output depends on iteration
    // history cannot be the basis of a parametric rebuild.
    const std::vector<double> once = s.parameters();
    const SketchSolveResult again = solveSketch(s, k);
    CHECK(again.converged);
    const std::vector<double> twice = s.parameters();
    CHECK_EQ_INT(once.size(), twice.size());
    double drift = 0.0;
    for (std::size_t i = 0; i < once.size(); ++i) {
      drift = std::max(drift, std::fabs(once[i] - twice[i]));
    }
    CHECK(drift <= 1e-9);
  }

  // ── 2. a circle inscribed in a corner: TANGENT, twice ─────────────────────
  // Closed form: a circle of radius r tangent to both axes sits at (r, r).
  {
    Sketch s;
    const int h = s.addLine("h", 0, 0, 100, 0);
    const int v = s.addLine("v", 0, 0, 0, 100);
    const int c = s.addCircle("c", 30, 20, 8);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(h, SketchPointRole::Start), 0, 0),
        fixPoint(sketchRef(h, SketchPointRole::End), 100, 0),
        fixPoint(sketchRef(v, SketchPointRole::Start), 0, 0),
        fixPoint(sketchRef(v, SketchPointRole::End), 0, 100),
        radius(c, 12.0),
        tangent(c, h),
        tangent(c, v),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK_NEAR(s.entity(c)->params[0], 12.0, 1e-7);
    CHECK_NEAR(s.entity(c)->params[1], 12.0, 1e-7);
    CHECK_NEAR(s.entity(c)->params[2], 12.0, 1e-9);
  }

  // ── 3. two externally tangent circles of equal radius ─────────────────────
  // Closed form: |c1 - c2| = r1 + r2 = 2r. EQUAL on curves compares radii.
  {
    Sketch s;
    const int a = s.addCircle("a", 0, 0, 6);
    const int b = s.addCircle("b", 15, 3, 4);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(a, SketchPointRole::Center), 0, 0),
        radius(a, 10.0),
        equal(a, b),
        tangent(a, b),
        horizontal(sketchRef(a, SketchPointRole::Center), sketchRef(b, SketchPointRole::Center)),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(res.freeParameters, 6);
    CHECK_EQ_INT(res.residuals, 6);
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK_NEAR(s.entity(b)->params[2], 10.0, 1e-7);   // equal radii
    CHECK_NEAR(s.entity(b)->params[0], 20.0, 1e-7);   // 2r along +u
    CHECK_NEAR(s.entity(b)->params[1], 0.0, 1e-7);
  }

  // ── 4. internal tangency is a DIFFERENT constraint, and says so ───────────
  // |c1 - c2| = |r1 - r2|: a 4 mm circle inside a 10 mm one touches at 6 mm.
  {
    Sketch s;
    const int a = s.addCircle("a", 0, 0, 10);
    const int b = s.addCircle("b", 3, 0, 4);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(a, SketchPointRole::Center), 0, 0),
        radius(a, 10.0),
        radius(b, 4.0),
        tangent(a, b, /*internal=*/true),
        horizontal(sketchRef(a, SketchPointRole::Center), sketchRef(b, SketchPointRole::Center)),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_NEAR(s.entity(b)->params[0], 6.0, 1e-7);
    CHECK_NEAR(s.entity(b)->params[1], 0.0, 1e-7);
  }

  // ── 5. an angular dimension ───────────────────────────────────────────────
  {
    Sketch s;
    const int a = s.addLine("a", 0, 0, 50, 0);
    const int b = s.addLine("b", 0, 0, 40, 5);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(a, SketchPointRole::Start), 0, 0),
        fixPoint(sketchRef(a, SketchPointRole::End), 50, 0),
        coincident(sketchRef(b, SketchPointRole::Start), sketchRef(a, SketchPointRole::Start)),
        distance(sketchRef(b, SketchPointRole::Start), sketchRef(b, SketchPointRole::End), 30.0),
        angleBetween(a, b, 30.0),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK_NEAR(px(s, b, SketchPointRole::End), 30.0 * std::cos(kPi / 6.0), 1e-7);
    CHECK_NEAR(py(s, b, SketchPointRole::End), 30.0 * std::sin(kPi / 6.0), 1e-7);
  }

  // ── 6. symmetry about a construction axis ─────────────────────────────────
  // The axis is CONSTRUCTION geometry, which is the whole reason construction
  // geometry exists: it constrains the profile without being part of it.
  {
    Sketch s;
    const int axis = s.addLine("axis", 0, 0, 0, 50, /*construction=*/true);
    const int p1 = s.addPoint("p1", -10, 5);
    const int p2 = s.addPoint("p2", 7, 2);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(axis, SketchPointRole::Start), 0, 0),
        fixPoint(sketchRef(axis, SketchPointRole::End), 0, 50),
        fixPoint(sketchRef(p1), -10, 5),
        symmetric(sketchRef(p1), sketchRef(p2), axis),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK_NEAR(s.entity(p2)->params[0], 10.0, 1e-8);
    CHECK_NEAR(s.entity(p2)->params[1], 5.0, 1e-8);
    CHECK(s.entity(axis)->construction);
  }

  // ── 7. PERPENDICULAR, PARALLEL, COLLINEAR, CONCENTRIC, point-to-line ──────
  {
    Sketch s;
    const int base = s.addLine("base", 0, 0, 60, 0);
    const int up = s.addLine("up", 0, 0, 3, 20);
    const int far = s.addLine("far", 100, 4, 160, 9);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(base, SketchPointRole::Start), 0, 0),
        fixPoint(sketchRef(base, SketchPointRole::End), 60, 0),
        coincident(sketchRef(up, SketchPointRole::Start), sketchRef(base, SketchPointRole::Start)),
        perpendicular(base, up),
        distance(sketchRef(up, SketchPointRole::Start), sketchRef(up, SketchPointRole::End), 20.0),
        parallel(base, far),
        // A point-to-LINE dimension: the far line sits 12 mm off the base.
        distance(sketchRef(far, SketchPointRole::Start), sketchRef(base), 12.0),
        fixPoint(sketchRef(far, SketchPointRole::Start), 100, 12),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_NEAR(px(s, up, SketchPointRole::End), 0.0, 1e-7);
    CHECK_NEAR(py(s, up, SketchPointRole::End), 20.0, 1e-7);
    CHECK_NEAR(py(s, far, SketchPointRole::End), 12.0, 1e-7);   // parallel to the base
    CHECK_NEAR(py(s, far, SketchPointRole::Start), 12.0, 1e-7);

    // COLLINEAR is stronger than parallel: same direction AND the same line. It
    // takes both of w's endpoints onto the base line and leaves exactly one
    // freedom — where along that line the 20 mm segment sits.
    Sketch t;
    const int u = t.addLine("u", 0, 0, 50, 0);
    const int w = t.addLine("w", 10, 7, 40, 9);
    std::vector<SketchConstraint> tk = {
        fixPoint(sketchRef(u, SketchPointRole::Start), 0, 0),
        fixPoint(sketchRef(u, SketchPointRole::End), 50, 0),
        collinear(u, w),
        distance(sketchRef(w, SketchPointRole::Start), sketchRef(w, SketchPointRole::End), 20.0),
    };
    const SketchSolveResult tres = solveSketch(t, tk);
    CHECK(tres.converged);
    CHECK_EQ_INT(tres.freeParameters, 8);
    CHECK_EQ_INT(tres.residuals, 7);
    CHECK_EQ_INT(tres.rank, 7);
    CHECK_EQ_INT(tres.degreesOfFreedom, 1);   // slide along the line
    CHECK_NEAR(py(t, w, SketchPointRole::Start), 0.0, 1e-7);
    CHECK_NEAR(py(t, w, SketchPointRole::End), 0.0, 1e-7);
    CHECK_NEAR(std::fabs(px(t, w, SketchPointRole::End) - px(t, w, SketchPointRole::Start)), 20.0,
               1e-7);

    // CONCENTRIC pins two centres together and nothing else.
    Sketch c;
    const int outer = c.addCircle("outer", 0, 0, 20);
    const int bore = c.addCircle("bore", 4, -3, 5);
    std::vector<SketchConstraint> ck = {
        fixPoint(sketchRef(outer, SketchPointRole::Center), 30, 40),
        concentric(outer, bore),
    };
    const SketchSolveResult cres = solveSketch(c, ck);
    CHECK(cres.converged);
    CHECK_NEAR(c.entity(bore)->params[0], 30.0, 1e-8);
    CHECK_NEAR(c.entity(bore)->params[1], 40.0, 1e-8);
    CHECK_NEAR(c.entity(bore)->params[2], 5.0, 1e-12);   // the radius did NOT move
    CHECK_EQ_INT(cres.freeParameters, 6);
    CHECK_EQ_INT(cres.residuals, 4);
    CHECK_EQ_INT(cres.rank, 4);
    CHECK_EQ_INT(cres.degreesOfFreedom, 2);              // both radii are free
    CHECK_EQ_INT(static_cast<int>(cres.status), static_cast<int>(SketchStatus::UnderConstrained));
  }

  // ── 8. DEGREES OF FREEDOM, counted down one constraint at a time ──────────
  // The DOF report is the sketcher's whole feedback loop, so it is checked as a
  // SEQUENCE: each constraint must remove exactly the freedom it describes.
  {
    Sketch s;
    const int l = s.addLine("l", 0, 0, 10, 3);
    std::vector<SketchConstraint> k;

    SketchSolveResult r0 = solveSketch(s, k);
    CHECK_EQ_INT(r0.freeParameters, 4);
    CHECK_EQ_INT(r0.residuals, 0);
    CHECK_EQ_INT(r0.rank, 0);
    CHECK_EQ_INT(r0.degreesOfFreedom, 4);
    CHECK_EQ_INT(static_cast<int>(r0.status), static_cast<int>(SketchStatus::UnderConstrained));

    k.push_back(horizontal(sketchRef(l), SketchRef{}));
    SketchSolveResult r1 = solveSketch(s, k);
    CHECK_EQ_INT(r1.rank, 1);
    CHECK_EQ_INT(r1.degreesOfFreedom, 3);

    k.push_back(fixPoint(sketchRef(l, SketchPointRole::Start), 0, 0));
    SketchSolveResult r2 = solveSketch(s, k);
    CHECK_EQ_INT(r2.rank, 3);
    CHECK_EQ_INT(r2.degreesOfFreedom, 1);

    k.push_back(distance(sketchRef(l, SketchPointRole::Start), sketchRef(l, SketchPointRole::End),
                         25.0));
    SketchSolveResult r3 = solveSketch(s, k);
    CHECK_EQ_INT(r3.rank, 4);
    CHECK_EQ_INT(r3.degreesOfFreedom, 0);
    CHECK_EQ_INT(static_cast<int>(r3.status), static_cast<int>(SketchStatus::FullyConstrained));
    CHECK_NEAR(px(s, l, SketchPointRole::End), 25.0, 1e-8);
    CHECK_NEAR(py(s, l, SketchPointRole::End), 0.0, 1e-8);

    // A circle: 3 parameters, and each of radius / centre removes what it owns.
    Sketch c;
    const int ci = c.addCircle("c", 1, 2, 3);
    std::vector<SketchConstraint> ck;
    CHECK_EQ_INT(solveSketch(c, ck).degreesOfFreedom, 3);
    ck.push_back(radius(ci, 8.0));
    CHECK_EQ_INT(solveSketch(c, ck).degreesOfFreedom, 2);
    ck.push_back(fixPoint(sketchRef(ci, SketchPointRole::Center), 5, 5));
    const SketchSolveResult cr = solveSketch(c, ck);
    CHECK_EQ_INT(cr.degreesOfFreedom, 0);
    CHECK_NEAR(c.entity(ci)->params[2], 8.0, 1e-9);
  }

  // ── 9. OVER-CONSTRAINED, consistent: name the redundant constraint ────────
  {
    Sketch s;
    const int c = s.addCircle("c", 0, 0, 5);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(c, SketchPointRole::Center), 0, 0),
        radius(c, 10.0),
        diameter(c, 20.0),   // says the same thing
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);                       // consistent, so it still solves
    CHECK_EQ_INT(static_cast<int>(res.status), static_cast<int>(SketchStatus::OverConstrained));
    CHECK_EQ_STR(toString(res.status), "over_constrained");
    CHECK_EQ_INT(res.residuals, 4);
    CHECK_EQ_INT(res.rank, 3);                  // one row adds nothing
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK_EQ_INT(res.redundant.size(), 1);
    CHECK(contains(res.redundant, 2));          // the DIAMETER, by index
    CHECK_EQ_INT(res.conflicting.size(), 0);
    CHECK_NEAR(s.entity(c)->params[2], 10.0, 1e-8);
  }

  // ── 10. CONFLICTING: name the constraints, and keep the geometry ──────────
  // radius 10 and diameter 30 cannot both hold. The solver must NOT throw the
  // sketch away: it returns the least-squares compromise, which for residuals
  // (r - 10) and (2r - 30) is r = 14 — a number that can be written down before
  // the run, so this checks the "best iterate" claim rather than assuming it.
  {
    Sketch s;
    const int c = s.addCircle("c", 0, 0, 5);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(c, SketchPointRole::Center), 0, 0),
        radius(c, 10.0),
        diameter(c, 30.0),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(!res.converged);
    CHECK_EQ_INT(static_cast<int>(res.status), static_cast<int>(SketchStatus::Conflicting));
    CHECK_EQ_STR(toString(res.status), "conflicting");
    CHECK(res.maxResidual > 1.0);
    CHECK_EQ_INT(res.conflicting.size(), 2);
    CHECK(contains(res.conflicting, 1));
    CHECK(contains(res.conflicting, 2));
    CHECK(!contains(res.conflicting, 0));       // the fix is not part of it
    // The best iterate is REAL geometry, and it is in the sketch.
    CHECK_EQ_INT(res.parameters.size(), 3);
    CHECK_NEAR(res.parameters[2], 14.0, 1e-6);
    CHECK_NEAR(s.entity(c)->params[2], 14.0, 1e-6);
    CHECK(res.detail.find("conflicting") == 0);

    // Dropping either named constraint solves it — which is what "these are the
    // constraints in conflict" has to MEAN to be worth printing.
    for (std::size_t drop : res.conflicting) {
      Sketch probe;
      const int pc = probe.addCircle("c", 0, 0, 5);
      (void)pc;
      std::vector<SketchConstraint> reduced;
      for (std::size_t i = 0; i < k.size(); ++i) {
        if (i != drop) reduced.push_back(k[i]);
      }
      CHECK(solveSketch(probe, reduced).converged);
    }
  }

  // ── 11. a conflict a single removal does NOT fix, still reported ──────────
  // Horizontal AND vertical on one line is satisfiable (the line collapses);
  // adding a length of 40 makes it impossible, and no single removal is enough
  // to make the remaining pair contradictory-free in one step. The solver must
  // still name the unsatisfied constraints rather than reporting nothing.
  {
    Sketch s;
    const int l = s.addLine("l", 0, 0, 30, 1);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(l, SketchPointRole::Start), 0, 0),
        horizontal(sketchRef(l), SketchRef{}),
        vertical(sketchRef(l), SketchRef{}),
        distance(sketchRef(l, SketchPointRole::Start), sketchRef(l, SketchPointRole::End), 40.0),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(!res.converged);
    CHECK_EQ_INT(static_cast<int>(res.status), static_cast<int>(SketchStatus::Conflicting));
    CHECK(!res.conflicting.empty());
    CHECK_EQ_INT(res.parameters.size(), 4);     // the geometry survives regardless
  }

  // ── 12. MALFORMED constraints are named and SKIPPED, never fatal ──────────
  // One constraint that cannot mean anything must not cost the user the others.
  {
    Sketch s;
    const int l = s.addLine("l", 0, 0, 10, 3);
    const int c = s.addCircle("c", 40, 40, 5);
    std::vector<SketchConstraint> k = {
        radius(l, 5.0),            // 0: a line has no radius
        parallel(c, l),            // 1: a circle has no direction
        equal(c, l),               // 2: a radius is not a length
        coincident(sketchRef(c, SketchPointRole::Start), sketchRef(l, SketchPointRole::Start)),
                                   // 3: a circle has no start point
        distance(sketchRef(999), sketchRef(l, SketchPointRole::Start), 5.0),
                                   // 4: no such entity
        fixPoint(sketchRef(l, SketchPointRole::Start), 0, 0),      // 5: fine
        distance(sketchRef(l, SketchPointRole::Start), sketchRef(l, SketchPointRole::End), 50.0),
                                   // 6: fine
        horizontal(sketchRef(l), SketchRef{}),                     // 7: fine
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK_EQ_INT(static_cast<int>(res.status), static_cast<int>(SketchStatus::Malformed));
    CHECK_EQ_STR(toString(res.status), "malformed");
    CHECK_EQ_INT(res.malformed.size(), 5);
    for (std::size_t i = 0; i < 5; ++i) CHECK(contains(res.malformed, i));
    CHECK(!contains(res.malformed, 5));
    CHECK(!contains(res.malformed, 6));
    CHECK(!contains(res.malformed, 7));
    // The three well-formed constraints were solved anyway.
    CHECK(res.converged);
    CHECK_EQ_INT(res.residuals, 4);
    CHECK_NEAR(px(s, l, SketchPointRole::End), 50.0, 1e-8);
    CHECK_NEAR(py(s, l, SketchPointRole::End), 0.0, 1e-8);
    // And a per-constraint count is available on its own, so a UI can grey out
    // the bad row before anybody presses solve.
    CHECK_EQ_INT(sketchResidualCount(s, k[0]), 0);
    CHECK_EQ_INT(sketchResidualCount(s, k[5]), 2);
    CHECK_EQ_INT(sketchResidualCount(s, k[6]), 1);
  }

  // ── 13. residuals and the Jacobian, read directly ─────────────────────────
  {
    Sketch s;
    const int l = s.addLine("l", 0, 0, 3, 4);
    std::vector<SketchConstraint> k = {
        distance(sketchRef(l, SketchPointRole::Start), sketchRef(l, SketchPointRole::End), 5.0),
        horizontal(sketchRef(l), SketchRef{}),
    };
    std::vector<double> r;
    CHECK(evaluateSketchResiduals(s, k, s.parameters(), r));
    CHECK_EQ_INT(r.size(), 2);
    CHECK_NEAR(r[0], 0.0, 1e-12);     // 3-4-5: the length is already 5
    CHECK_NEAR(r[1], -4.0, 1e-12);    // y0 - y1

    std::vector<double> jac;
    std::size_t rows = 0, cols = 0;
    CHECK(sketchJacobian(s, k, s.parameters(), 1e-6, jac, rows, cols));
    CHECK_EQ_INT(rows, 2);
    CHECK_EQ_INT(cols, 4);
    // d|p1-p0|/dx0 = -(x1-x0)/|d| = -3/5, and the horizontal row is (0,1,0,-1).
    CHECK_NEAR(jac[0], -0.6, 1e-6);
    CHECK_NEAR(jac[1], -0.8, 1e-6);
    CHECK_NEAR(jac[2], 0.6, 1e-6);
    CHECK_NEAR(jac[3], 0.8, 1e-6);
    CHECK_NEAR(jac[4], 0.0, 1e-9);
    CHECK_NEAR(jac[5], 1.0, 1e-9);
    CHECK_NEAR(jac[6], 0.0, 1e-9);
    CHECK_NEAR(jac[7], -1.0, 1e-9);

    // A wrong-length parameter vector produces nothing rather than garbage.
    std::vector<double> bad(3, 0.0);
    std::vector<double> out;
    CHECK(!evaluateSketchResiduals(s, k, bad, out));
  }

  // ── 14. the rank routine, on matrices whose rank is obvious ───────────────
  {
    std::vector<std::size_t> dep;
    const std::vector<double> identity = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    CHECK_EQ_INT(matrixRank(identity, 3, 3, 1e-7, dep), 3);
    CHECK_EQ_INT(dep.size(), 0);

    // Row 2 is row 0 doubled: rank 2, and the DEPENDENT ROW is named — that name
    // is what becomes "constraint 2 is redundant".
    const std::vector<double> dup = {1, 0, 0, 0, 1, 0, 2, 0, 0};
    CHECK_EQ_INT(matrixRank(dup, 3, 3, 1e-7, dep), 2);
    CHECK_EQ_INT(dep.size(), 1);
    CHECK_EQ_INT(dep[0], 2);

    // Row 2 = row 0 + row 1.
    const std::vector<double> sum = {1, 1, 0, 0, 1, 1, 1, 2, 1};
    CHECK_EQ_INT(matrixRank(sum, 3, 3, 1e-7, dep), 2);
    CHECK_EQ_INT(dep.size(), 1);
    CHECK_EQ_INT(dep[0], 2);

    // A zero row is dependent, and row SCALING must not change the verdict: the
    // 1e-12 row is a real direction, not noise.
    const std::vector<double> mixed = {1e-12, 0, 0, 0, 0, 0, 0, 1, 0};
    CHECK_EQ_INT(matrixRank(mixed, 3, 3, 1e-7, dep), 2);
    CHECK_EQ_INT(dep.size(), 1);
    CHECK_EQ_INT(dep[0], 1);

    CHECK_EQ_INT(matrixRank({}, 0, 0, 1e-7, dep), 0);
  }

  // ── 15. an under-constrained sketch still solves what it can ──────────────
  // The half-drawn state is the state a sketcher spends most of its life in, and
  // it must be a first-class answer: converged, with the remaining freedom
  // counted, not an error.
  {
    Sketch s;
    const int a = s.addLine("a", 0, 0, 10, 0);
    const int b = s.addLine("b", 10, 0, 12, 9);
    std::vector<SketchConstraint> k = {
        coincident(sketchRef(a, SketchPointRole::End), sketchRef(b, SketchPointRole::Start)),
        perpendicular(a, b),
        horizontal(sketchRef(a), SketchRef{}),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(static_cast<int>(res.status), static_cast<int>(SketchStatus::UnderConstrained));
    CHECK_EQ_INT(res.freeParameters, 8);
    CHECK_EQ_INT(res.residuals, 4);
    CHECK_EQ_INT(res.rank, 4);
    CHECK_EQ_INT(res.degreesOfFreedom, 4);
    // Perpendicular really holds: b is vertical because a is horizontal.
    CHECK_NEAR(px(s, b, SketchPointRole::End), px(s, b, SketchPointRole::Start), 1e-7);
  }

  // ── 16. a 200 mm sketch: the tolerance is absolute, so scale is a real test ─
  {
    Sketch s;
    const int c = s.addCircle("c", 190.0, 210.0, 3.0);
    const int l = s.addLine("l", 0, 200, 400, 200);
    std::vector<SketchConstraint> k = {
        fixPoint(sketchRef(l, SketchPointRole::Start), 0, 200),
        fixPoint(sketchRef(l, SketchPointRole::End), 400, 200),
        radius(c, 47.5),
        tangent(c, l),
        vertical(sketchRef(c, SketchPointRole::Center), sketchRef(l, SketchPointRole::Start)),
    };
    const SketchSolveResult res = solveSketch(s, k);
    CHECK(res.converged);
    CHECK_EQ_INT(res.degreesOfFreedom, 0);
    CHECK_NEAR(s.entity(c)->params[0], 0.0, 1e-6);      // vertical pins u to the line's start
    CHECK_NEAR(s.entity(c)->params[1], 247.5, 1e-6);    // tangent from above
    CHECK_NEAR(s.entity(c)->params[2], 47.5, 1e-9);
  }

  // ── 17. the spellings a status strip prints ───────────────────────────────
  {
    CHECK_EQ_STR(toString(SketchConstraintKind::Coincident), "coincident");
    CHECK_EQ_STR(toString(SketchConstraintKind::Perpendicular), "perpendicular");
    CHECK_EQ_STR(toString(SketchConstraintKind::Symmetric), "symmetric");
    CHECK_EQ_STR(toString(SketchConstraintKind::Diameter), "diameter");
    CHECK_EQ_STR(toString(SketchStatus::UnderConstrained), "under_constrained");
    CHECK_EQ_STR(toString(SketchStatus::FullyConstrained), "fully_constrained");
  }

  return H.finish();
}
