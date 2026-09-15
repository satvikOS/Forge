// forge-kernel/include/forge/ft/SketchAdmission.hpp
//
// SHOULD THIS SKETCH CHANGE BE ALLOWED? — the transaction check for a user's or
// Archie's edit to a constrained sketch.
//
// ── two contracts, and why they do not contradict each other ────────────────
// The COMPILER never refuses a sketch: a contradictory dimension in a 200-statement
// tree Archie generated is demoted, named on the verify channel, and the other 199
// statements still build (forge/Sketcher.hpp, "DIAGNOSE, NEVER REFUSE"). That is
// right for a whole program that already exists.
//
// It is wrong for ONE CHANGE a person is making to a document. A user who adds a
// 70 mm width to a rectangle that already has a 60 mm width, and is told "done",
// has been told something false: the solver will drop one of the two, the part
// will not be what they asked for, and nothing on screen says so at the moment
// they did it. For a single interactive edit a refusal that names the constraint
// it contradicts is the correct answer, and a wrong result reported as success is
// the worst one. This header is that check; the command layer consults it before
// the edit is committed (dry run -> validate semantics -> commit or refuse), and
// nothing it does changes what compile() builds.
//
// ── what it decides ─────────────────────────────────────────────────────────
// It compares the sketch as it was with the sketch as the change would leave it,
// both read back from the real solver (inspectSketches), and refuses ONLY what the
// change itself introduced:
//
//   Conflicts    the changed constraint is structurally inconsistent with others
//                (the solver's rank analysis), and was not before. The verdict
//                names every CON statement in its conflict group(s).
//   NotApplied   the changed constraint cannot hold at all: an unknown kind, an
//                operand from another sketch, or operands the kind cannot take.
//   Unsolvable   the change leaves the sketch numerically unsolvable -- the solve
//                no longer converges or has to drop a constraint -- where before
//                it solved cleanly (a triangle whose sides violate the triangle
//                inequality; a rank analysis cannot see that).
//
// A sketch that already carried a conflict before the change is judged only on
// what the change added, so an old problem never blocks an unrelated fix. A change
// that is not to a constraint (a new point, a circle's radius, a SOLVE) is admitted
// here; it is still subject to every other check the document applies.
//
// Plain data, no OCCT: the application's command layer includes this.
#ifndef FORGE_FT_SKETCHADMISSION_HPP
#define FORGE_FT_SKETCHADMISSION_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "forge/ft/SketchInspect.hpp"

namespace forge {
namespace ft {

enum class SketchChangeRefusal : std::uint8_t {
  None = 0,
  Conflicts,
  NotApplied,
  Unsolvable,
};

const char* toString(SketchChangeRefusal refusal) noexcept;

struct SketchChangeVerdict {
  bool admitted = true;
  SketchChangeRefusal refusal = SketchChangeRefusal::None;
  int sketchIrId = 0;              // the SKETCH statement the change belongs to; 0 = none
  int statementIrId = 0;           // the statement being added or edited
  bool isConstraint = false;       // the statement is a CON
  std::string keyword;             // its CON keyword, when it is one
  std::vector<int> conflictsWith;  // Conflicts: the CON statements it contradicts
  std::vector<int> dropped;        // Unsolvable: what the solve had to drop
  int dofBefore = -1;              // the sketch's degrees of freedom before / after
  int dofAfter = -1;
  bool fullyConstrainedAfter = false;
  // One line for a log, in IR terms ("CON %12 DISTX conflicts with %9"). Words a
  // person reads are the application's job; see SketchInspect.hpp for why.
  std::string detail;
  // The sketch as the change WOULD leave it, read back from the solver -- so the
  // application can name the constraints above in words without reading the
  // program a third time. Empty (irId 0) when the change is not to a sketch.
  SketchInfo sketchAfter;
};

// Judge the change that turns `programBefore` into `programAfter`, where
// `changedIrId` is the statement appended or edited. Never throws: a program that
// cannot be read is ADMITTED here, because refusing grammar is the document's
// validator's job and it gives its own reason.
SketchChangeVerdict judgeSketchChange(const std::string& programBefore,
                                      const std::string& programAfter, int changedIrId);

}  // namespace ft
}  // namespace forge

#endif  // FORGE_FT_SKETCHADMISSION_HPP
