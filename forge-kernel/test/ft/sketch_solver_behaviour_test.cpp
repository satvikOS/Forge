// forge-kernel/test/ft/sketch_solver_behaviour_test.cpp
//
// THE SOLVER BEHAVIOURS FreeCAD's OWN TESTS CHECK, RESTATED AGAINST FORGE.
//
// Forge's sketch solver is libforge_gcs -- FreeCAD's planegcs, modified and built
// as a separate LGPL shared library -- reached through Forge's adapter
// (forge::Sketcher, forge::ft). FreeCAD's Sketcher test suite checks the solver
// through FreeCAD's document model; the same behaviours are checked here through
// Forge's, in Forge's own code:
//
//   TestSketcherSolver.py  CreateRectangleSketch / testBoxCase
//        a rectangle of four lines joined by Coincident corners, Horizontal /
//        Vertical sides and two dimensions still slides; pinning a corner with
//        DistanceX / DistanceY leaves it with no freedom, and it solves.
//   TestSketcherSolver.py  CreateRectangleSketch (square form)
//        Equal plus one Distance fixes a square the same way.
//   TestSketcherSolver.py  CreateCircleSketch
//        a Radius plus DistanceX / DistanceY of the centre pins a circle.
//   TestSketcherSolver.py  CreateSlotPlateSet / testSlotCase
//        lines and an arc held by Tangent, Angle, Distance and Radius solve.
//   planegcs GCS.cpp test  clearConstraints
//        a removed constraint leaves nothing behind (the repair's demotion).
//
// and the three things Forge adds on top, which no FreeCAD test covers:
//
//   * the conflict GROUPS the modified library keeps -- a contradiction is named
//     as the pair that contradicts, not as a flattened list;
//   * judgeSketchChange -- the transaction check that refuses a conflicting,
//     inapplicable or unsolvable change and admits a harmless one;
//   * the library is a separate dynamic dependency of this very binary (checked
//     by the build script with otool / nm, not here).
//
// usage: sketch_solver_behaviour [--mutate N]   exit 0 = every check held
//   --mutate 1  read the flattened conflict list instead of the groups -> the
//               "names exactly the pair" checks go red
//   --mutate 2  judge the change against the program it came FROM   -> every
//               refusal check goes red
//   --mutate 3  leave the corner of the box unpinned                  -> "0 dof" red
#include "forge/Sketcher.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/ft/SketchAdmission.hpp"
#include "forge/ft/SketchInspect.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

// The ONE link seam, shared with sketch_solve_test.cpp and declared the same way:
// compile() resets the boolean hang-guard budget, which lives in the OCCT boolean
// TU this gate does not link. It performs no boolean, so resetting is a no-op.
namespace forge {
void resetBooleanBudget();
void resetBooleanBudget() {}
}  // namespace forge

namespace {

int g_checks = 0;
int g_fails = 0;
int g_mutation = 0;
constexpr double kPi = 3.14159265358979323846;

void check(bool ok, const std::string& what) {
    ++g_checks;
    if (!ok) {
        ++g_fails;
        std::printf("  FAIL: %s\n", what.c_str());
    }
}

bool near(double a, double b, double eps) { return std::fabs(a - b) < eps; }

using K = forge::SketchConstraintKind;

struct Sk {
    forge::SketchHandle h = forge::createSketch();
    ~Sk() { forge::destroySketch(h); }
};

const forge::ft::SketchInfo* only(const forge::ft::SketchInspection& insp) {
    return insp.sketches.size() == 1 ? &insp.sketches.front() : nullptr;
}

const forge::ft::SketchConstraintInfo* con(const forge::ft::SketchInfo& s, int irId) {
    for (const auto& c : s.constraints)
        if (c.irId == irId) return &c;
    return nullptr;
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
    if (g_mutation != 0) std::printf("[behaviour] MUTATION %d ACTIVE\n", g_mutation);

    // ── testBoxCase: four lines, coincident corners, H/V, two dimensions ─────
    {
        Sk s;
        // FreeCAD's CreateBoxSketchSet coordinates, each line with its OWN two
        // endpoints so the corners are held by Coincident, as there.
        const double X0 = -99.230339, X1 = 69.432587, Y0 = -53.196629, Y1 = 36.960674;
        auto P = [&](double x, double y) { return forge::addPoint(s.h, x, y); };
        const auto a0 = P(X0, Y1), a1 = P(X1, Y1);   // top
        const auto b0 = P(X1, Y1), b1 = P(X1, Y0);   // right
        const auto c0 = P(X1, Y0), c1 = P(X0, Y0);   // bottom
        const auto d0 = P(X0, Y0), d1 = P(X0, Y1);   // left
        const auto top = forge::addLine(s.h, a0, a1);
        const auto rgt = forge::addLine(s.h, b0, b1);
        const auto bot = forge::addLine(s.h, c0, c1);
        const auto lft = forge::addLine(s.h, d0, d1);
        forge::addConstraint(s.h, K::Coincident, {a1, b0}, 0);
        forge::addConstraint(s.h, K::Coincident, {b1, c0}, 0);
        forge::addConstraint(s.h, K::Coincident, {c1, d0}, 0);
        forge::addConstraint(s.h, K::Coincident, {d1, a0}, 0);
        forge::addConstraint(s.h, K::Horizontal, {top}, 0);
        forge::addConstraint(s.h, K::Horizontal, {bot}, 0);
        forge::addConstraint(s.h, K::Vertical, {rgt}, 0);
        forge::addConstraint(s.h, K::Vertical, {lft}, 0);
        forge::addConstraint(s.h, K::Distance, {b0, b1}, 81.370787);
        forge::addConstraint(s.h, K::Distance, {a0, a1}, 187.573036);
        const forge::SketchDiagnostics loose = forge::diagnoseSketch(s.h);
        check(loose.dof == 2, "box: dimensioned but unpinned, it can still slide in x and y (dof 2, got " +
                                  std::to_string(loose.dof) + ")");
        check(!loose.hasConflicting && !loose.hasRedundant, "box: nothing conflicts or repeats");

        // "fully constrain": DistanceX / DistanceY of a corner from the origin.
        // Forge spells a coordinate dimension from a fixed origin point.
        if (g_mutation != 3) {
            const auto origin = P(0.0, 0.0);
            forge::addConstraint(s.h, K::Fix, {origin}, 0);
            forge::addConstraint(s.h, K::DistanceX, {origin, b1}, 90.0);
            forge::addConstraint(s.h, K::DistanceY, {origin, b1}, -50.0);
        }
        const forge::SketchDiagnostics held = forge::diagnoseSketch(s.h);
        check(held.dof == 0, "box: pinned by a corner it has 0 degrees of freedom (got " +
                                 std::to_string(held.dof) + ")");
        check(held.classification == "well", "box: classified fully constrained (" + held.classification + ")");
        const forge::SketchSolveResult r = forge::solve(s.h);
        check(r.status == forge::SketchSolveStatus::Success, "box: it solves");
        const forge::SketchPoint far = forge::readPoint(s.h, a0);
        check(near(far.x, 90.0 - 187.573036, 1e-6) && near(far.y, -50.0 + 81.370787, 1e-6),
              "box: the opposite corner lands where the dimensions put it");
    }

    // ── CreateRectangleSketch, square form: Equal + one Distance ─────────────
    {
        Sk s;
        const auto o = forge::addPoint(s.h, 0, 0);
        const auto p1 = forge::addPoint(s.h, 9, 1), p2 = forge::addPoint(s.h, 11, 12),
                   p3 = forge::addPoint(s.h, -1, 8);
        const auto bot = forge::addLine(s.h, o, p1), rgt = forge::addLine(s.h, p1, p2),
                   top = forge::addLine(s.h, p2, p3), lft = forge::addLine(s.h, p3, o);
        forge::addConstraint(s.h, K::Fix, {o}, 0);
        forge::addConstraint(s.h, K::Horizontal, {bot}, 0);
        forge::addConstraint(s.h, K::Horizontal, {top}, 0);
        forge::addConstraint(s.h, K::Vertical, {rgt}, 0);
        forge::addConstraint(s.h, K::Vertical, {lft}, 0);
        forge::addConstraint(s.h, K::Equal, {bot, lft}, 0);
        forge::addConstraint(s.h, K::Distance, {o, p1}, 25.0);
        const forge::SketchDiagnostics d = forge::diagnoseSketch(s.h);
        check(d.dof == 0 && d.classification == "well", "square: Equal + one Distance fixes it (dof " +
                                                            std::to_string(d.dof) + ")");
        forge::solve(s.h);
        const auto q = forge::readPoint(s.h, p2);
        check(near(q.x, 25.0, 1e-6) && near(q.y, 25.0, 1e-6), "square: the far corner is at (25, 25)");
    }

    // ── CreateCircleSketch: Radius + DistanceX / DistanceY of the centre ────
    {
        Sk s;
        const auto o = forge::addPoint(s.h, 0, 0);
        const auto c = forge::addPoint(s.h, 7, 3);
        const auto circle = forge::addCircle(s.h, c, 2.0);
        forge::addConstraint(s.h, K::Fix, {o}, 0);
        forge::addConstraint(s.h, K::Radius, {circle}, 6.0);
        forge::addConstraint(s.h, K::DistanceX, {o, c}, 10.0);
        forge::addConstraint(s.h, K::DistanceY, {o, c}, 5.0);
        const forge::SketchDiagnostics d = forge::diagnoseSketch(s.h);
        check(d.dof == 0, "circle: a radius and a placed centre leave nothing free (dof " + std::to_string(d.dof) + ")");
        check(forge::solve(s.h).status == forge::SketchSolveStatus::Success, "circle: it solves");
        const auto g = forge::readEntity(s.h, circle);
        check(near(g.radius, 6.0, 1e-9) && near(g.cx, 10.0, 1e-9) && near(g.cy, 5.0, 1e-9),
              "circle: r 6 centred at (10, 5)");
    }

    // ── CreateSlotPlateSet: lines + arc, Tangent / Angle / Distance / Radius ─
    {
        Sk s;
        auto P = [&](double x, double y) { return forge::addPoint(s.h, x, y); };
        const auto l0a = P(60.029362, -30.279360), l0b = P(-120.376335, -30.279360);
        const auto l1a = P(-120.376335, -30.279360), l1b = P(-70.193062, 38.113884);
        const auto l2a = P(-70.193062, 38.113884), l2b = P(60.241116, 37.478645);
        const auto ac = P(60.039921, 3.811391);
        const double r0 = 35.127132;
        const auto as = P(60.039921 + r0 * std::cos(-1.403763), 3.811391 + r0 * std::sin(-1.403763));
        const auto ae = P(60.039921 + r0 * std::cos(1.419522), 3.811391 + r0 * std::sin(1.419522));
        const auto l0 = forge::addLine(s.h, l0a, l0b);
        const auto l1 = forge::addLine(s.h, l1a, l1b);
        const auto l2 = forge::addLine(s.h, l2a, l2b);
        const auto arc = forge::addArc(s.h, ac, as, ae);
        forge::addConstraint(s.h, K::Horizontal, {l0}, 0);
        forge::addConstraint(s.h, K::Coincident, {l0b, l1a}, 0);
        forge::addConstraint(s.h, K::Coincident, {l1b, l2a}, 0);
        forge::addConstraint(s.h, K::Horizontal, {l2}, 0);
        forge::addConstraint(s.h, K::Tangent, {l2, arc}, 0);
        forge::addConstraint(s.h, K::Tangent, {l0, arc}, 0);
        forge::addConstraint(s.h, K::Angle, {l0, l1}, 0.872665);   // 50 degrees, as setDatum(6)
        forge::addConstraint(s.h, K::Distance, {l0a, l0b}, 200.0);
        forge::addConstraint(s.h, K::Radius, {arc}, 40.0);
        const forge::SketchSolveReport rep = forge::solveOrRepair(s.h);
        check(rep.status == forge::SketchSolveStatus::Success && rep.demoted.empty(),
              "slot: tangent / angle / distance / radius solve with nothing dropped (" + rep.classification + ")");
        check(near(forge::readEntity(s.h, arc).radius, 40.0, 1e-6), "slot: the arc takes its radius of 40");
        check(rep.worstResidual < 1e-6, "slot: every constraint is met");
    }

    // ── clearConstraints: a removed tag holds nothing afterwards ─────────────
    {
        Sk s;
        const auto a = forge::addPoint(s.h, 0, 0), b = forge::addPoint(s.h, 3, 4);
        const int t = static_cast<int>(forge::addConstraint(s.h, K::Distance, {a, b}, 10.0));
        check(std::isfinite(forge::constraintResidual(s.h, t)), "clear: the constraint has an error to report");
        forge::removeConstraintsByTag(s.h, t);
        check(std::isnan(forge::constraintResidual(s.h, t)), "clear: after removal nothing carries the tag");
        check(forge::diagnoseSketch(s.h).dof == 4, "clear: and the two points are free again");
    }

    // ── THE CONFLICT GROUPS the modified library keeps ───────────────────────
    {
        Sk s;
        const auto o = forge::addPoint(s.h, 0, 0), p = forge::addPoint(s.h, 60, 2);
        const auto q = forge::addPoint(s.h, 10, 30), r = forge::addPoint(s.h, 50, 31);
        const int fix = static_cast<int>(forge::addConstraint(s.h, K::Fix, {o}, 0));
        const int w60 = static_cast<int>(forge::addConstraint(s.h, K::DistanceX, {o, p}, 60.0));
        const int h0 = static_cast<int>(forge::addConstraint(s.h, K::DistanceY, {o, p}, 0.0));
        // an UNRELATED contradiction on two other points
        const int d20 = static_cast<int>(forge::addConstraint(s.h, K::Distance, {q, r}, 20.0));
        const int w70 = static_cast<int>(forge::addConstraint(s.h, K::DistanceX, {o, p}, 70.0));
        const int d25 = static_cast<int>(forge::addConstraint(s.h, K::Distance, {q, r}, 25.0));
        (void)fix;
        (void)h0;
        const forge::SketchDiagnostics d = forge::diagnoseSketch(s.h);
        check(d.hasConflicting, "groups: two contradictions are found");
        std::vector<std::vector<int>> groups = d.conflictingGroups;
        if (g_mutation == 1) groups = {d.conflicting};
        auto hasGroup = [&](std::vector<int> want) {
            std::sort(want.begin(), want.end());
            for (auto g : groups) {
                std::sort(g.begin(), g.end());
                if (g == want) return true;
            }
            return false;
        };
        check(hasGroup({w60, w70}), "groups: the two widths are ONE group, and only they are in it");
        check(hasGroup({d20, d25}), "groups: the two distances are ANOTHER group");
        check(groups.size() == 2, "groups: two contradictions are two groups, not one list of four (" +
                                      std::to_string(groups.size()) + ")");
        check(std::find(d.proposedRemovals.begin(), d.proposedRemovals.end(), w70) != d.proposedRemovals.end() &&
                  std::find(d.proposedRemovals.begin(), d.proposedRemovals.end(), d25) != d.proposedRemovals.end(),
              "groups: the solver proposes dropping the NEWER of each pair");
        check(d.conflicting.size() == 4, "groups: and the flattened list still carries all four");
    }

    // ── judgeSketchChange: refuse what the change introduced, admit the rest ─
    {
        const std::string base =
            "%1 = SKETCH(XY)\n"
            "%2 = SPT(%1, 0, 0)\n"
            "%3 = SPT(%1, 58, 1)\n"
            "%4 = SPT(%1, 20, 30)\n"
            "%5 = SLINE(%2, %3)\n"
            "%6 = CON(%2, FIX)\n"
            "%7 = CON(%5, HORIZ)\n"
            "%8 = CON(%2, DISTX, %3, 60)\n";
        auto judge = [&](const std::string& after, int changed) {
            return forge::ft::judgeSketchChange(g_mutation == 2 ? after : base, after, changed);
        };

        // (a) a contradicting width
        const forge::ft::SketchChangeVerdict conflict = judge(base + "%9 = CON(%2, DISTX, %3, 70)\n", 9);
        check(!conflict.admitted && conflict.refusal == forge::ft::SketchChangeRefusal::Conflicts,
              "judge: a second, different width is refused as a conflict (" + conflict.detail + ")");
        check(conflict.conflictsWith == std::vector<int>{8},
              "judge: and it names exactly the width it contradicts, %8");
        check(conflict.sketchIrId == 1 && conflict.sketchAfter.irId == 1,
              "judge: the verdict carries the sketch it read");

        // (b) the same width again, agreeing: a repeat, admitted
        const forge::ft::SketchChangeVerdict repeat = judge(base + "%9 = CON(%2, DISTX, %3, 60)\n", 9);
        check(repeat.admitted, "judge: a repeated width that agrees is admitted (" + repeat.detail + ")");
        const auto* rc = con(repeat.sketchAfter, 9);
        check(rc != nullptr && (rc->redundant || rc->partiallyRedundant) && !rc->conflicting,
              "judge: and it is reported as a repeat, not a conflict");

        // (c) a kind that cannot hold on what it names
        const forge::ft::SketchChangeVerdict para = judge(base + "%9 = CON(%2, PARA, %3)\n", 9);
        check(!para.admitted && para.refusal == forge::ft::SketchChangeRefusal::NotApplied,
              "judge: Parallel on two points is refused as holding nothing (" + para.detail + ")");

        // (d) a harmless addition
        const forge::ft::SketchChangeVerdict fine = judge(base + "%9 = CON(%2, DISTY, %4, 30)\n", 9);
        check(fine.admitted, "judge: an independent dimension is admitted (" + fine.detail + ")");

        // (e) a change that is not a constraint
        check(judge(base + "%9 = SPT(%1, 5, 5)\n", 9).admitted, "judge: a new point is not the judge's to refuse");

        // (f) the triangle a rank analysis cannot see: 10, 10 and then 100
        const std::string tri =
            "%1 = SKETCH(XY)\n%2 = SPT(%1, 0, 0)\n%3 = SPT(%1, 10, 0)\n%4 = SPT(%1, 5, 8)\n"
            "%5 = CON(%2, DIST, %3, 10)\n%6 = CON(%3, DIST, %4, 10)\n%7 = CON(%2, DIST, %4, 12)\n";
        const std::string triBad =
            "%1 = SKETCH(XY)\n%2 = SPT(%1, 0, 0)\n%3 = SPT(%1, 10, 0)\n%4 = SPT(%1, 5, 8)\n"
            "%5 = CON(%2, DIST, %3, 10)\n%6 = CON(%3, DIST, %4, 10)\n%7 = CON(%2, DIST, %4, 100)\n";
        const forge::ft::SketchChangeVerdict unsolvable =
            forge::ft::judgeSketchChange(g_mutation == 2 ? triBad : tri, triBad, 7);
        check(!unsolvable.admitted && unsolvable.refusal == forge::ft::SketchChangeRefusal::Unsolvable,
              "judge: editing a side to 100 is refused as unsolvable (" + unsolvable.detail + ")");
        check(!unsolvable.dropped.empty(), "judge: and says what the solve would have had to drop");

        // (g) an OLD problem does not block an unrelated change
        const std::string broken = base + "%9 = CON(%2, DISTX, %3, 70)\n";
        const forge::ft::SketchChangeVerdict unrelated =
            forge::ft::judgeSketchChange(broken, broken + "%10 = CON(%2, DISTY, %4, 30)\n", 10);
        check(unrelated.admitted, "judge: a sketch that already conflicts can still take an unrelated dimension (" +
                                      unrelated.detail + ")");
    }

    // ── the whole-sketch reading carries the groups to the application ───────
    {
        const forge::ft::SketchInspection insp = forge::ft::inspectSketchesText(
            "%1 = SKETCH(XY)\n%2 = SPT(%1, 0, 0)\n%3 = SPT(%1, 5, 0)\n"
            "%4 = CON(%2, COINC, %3)\n%5 = CON(%2, DIST, %3, 10)\n%6 = SOLVE(%1)\n");
        const forge::ft::SketchInfo* s = only(insp);
        check(s != nullptr, "inspect: the contradictory sketch reads back");
        if (s != nullptr) {
            check(s->conflictGroups.size() == 1 && s->conflictGroups.front() == std::vector<int>{4, 5},
                  "inspect: one group, holding the coincidence and the distance");
            const auto* c5 = con(*s, 5);
            check(c5 != nullptr && c5->conflictsWith == std::vector<int>{4},
                  "inspect: the distance knows it contradicts %4");
            check(s->dofBeforeRepair >= 0, "inspect: the freedom before the repair is reported");
        }
    }

    (void)kPi;
    std::printf("=== sketch solver behaviour: %d checks, %d failed ===\n", g_checks, g_fails);
    return g_fails == 0 ? 0 : 1;
}
