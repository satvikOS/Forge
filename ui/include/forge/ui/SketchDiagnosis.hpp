// ui/include/forge/ui/SketchDiagnosis.hpp
//
// THE THREE QUESTIONS A SKETCH WORKSPACE ASKS ABOUT ONE SKETCH — what is
// holding it, what moves with what, and what is still free.
//
// ── the defect this file exists for ─────────────────────────────────────────
// The Sketch workspace ships eight docked tabs. Five of them draw the user's
// work; the other three -- Constraints, Relations and Solver -- named
// themselves, said in one sentence what they would one day show, and drew
// NOTHING. That is three of the eight tabs of the workspace where a mechanical
// designer spends most of their day, and the three that answer the only question
// a sketcher really has: is this shape pinned down yet, and if not, what is
// still loose.
//
// There is no second document holding constraints. The part document already
// carries the whole sketch family -- an opening SKETCH, the points, lines,
// circles and arcs inside it, the CON records that constrain them and the SOLVE
// that closes it -- so all three tabs are readings of what is already there:
//
//   Constraints  WHAT IS HELD. Every CON record in the sketch, what it holds,
//                the number it carries when it is a dimension, and the ones that
//                hold NOTHING -- a keyword the kernel does not know, an operand
//                that resolves to no geometry of this sketch, too few operands
//                for the kind, or a repeat of a constraint already made.
//   Relations    WHAT MOVES WITH WHAT. Two geometry rows are linked when one is
//                built on the other (a line is built on its two points) or when
//                a constraint names them both. The linked groups are what a user
//                means by "if I drag this, what follows" -- and two rows in
//                different groups are independent, which is the other half of
//                the same answer.
//   Solver       WHAT IS STILL FREE. The free numbers the sketch's own geometry
//                carries, minus the ones its sound constraints hold, plus the
//                geometry no constraint reaches at all.
//
// ── WHERE EVERY NUMBER BELOW COMES FROM, AND WHY IT IS NOT INVENTED ─────────
// A degrees-of-freedom table is exactly the kind of thing a UI invents and then
// tells a user with a straight face. Both halves of this one are TRANSCRIBED
// from the kernel that actually solves the sketch, and ui/test/sketch_diagnosis_test.cpp
// RE-DERIVES both by reading those sources AS DATA -- the same way
// ui/test/feature_ir_test.cpp re-derives the IR op table.
//
//   the geometry side   forge-kernel/src/Sketcher.cpp, Sketch::collectUnknowns().
//                       That function is the definition: it is what hands the
//                       solver its unknowns. It pushes x and y for every POINT,
//                       `rad` for every CIRCLE, and `rad`, `startAngle`,
//                       `endAngle` for every ARC. A LINE pushes nothing -- it is
//                       two points that already counted themselves.
//
//     ★ THIS DISAGREES WITH forge-kernel/src/SketchDof.cpp AND THE DISAGREEMENT
//       IS THE POINT. That older counting table reads point 2, line 4, circle 3,
//       arc 5, because it assumes an entity OWNS its endpoints. The IR's sketch
//       family does not: `SLINE(%p0, %p1)` names two points that are already
//       rows of their own, so charging a line 4 would count those two points
//       twice and report a sketch as free in numbers that do not exist. Where
//       the two disagree the authority is the function that feeds the solver.
//
//   the constraint side forge-kernel/src/Sketcher.cpp, addConstraint(). Each arm
//                       of that switch is a call into the vendored solver, and
//                       the count below is HOW MANY OF THE SOLVER'S OWN
//                       EQUATIONS the arm adds:
//
//                         2  COINC CONC   one call to addConstraintP2PCoincident,
//                                         which is x and y (GCS.cpp:924)
//                         2  SYMM  MIDPT  one call to addConstraintP2PSymmetric,
//                                         which is two constraints (GCS.cpp:1259)
//                         2  COLL         two calls: parallel, plus an endpoint on
//                                         the other line
//                         2  FIX          two calls: an x coordinate and a y
//                         1  everything else -- one call, one equation
//
//                       On the fifteen kinds forge-kernel/src/SketchDof.cpp also
//                       names, this table AGREES with it, row for row, and the
//                       gate asserts that agreement rather than asking to be
//                       believed.
//
// ── WHAT THIS IS NOT, SAID PLAINLY ─────────────────────────────────────────
// This is the count from the sketch's own geometry and constraints. It is not
// the solver's rank analysis. The kernel HAS one -- forge::diagnoseSketch()
// returns a Jacobian-rank degrees-of-freedom number and the exact constraint
// tags that conflict -- and the two can differ: the rank analysis sees that two
// separately sound constraints say the same thing, and arithmetic cannot.
//
// Reaching it from here would mean carrying a solver report across the process
// boundary the shipped application runs its modelling behind, and nothing in the
// build report carries one today. So this file counts, the panels say they are
// counting, and the count is exactly what every sketcher shows before a solve.
// What arithmetic CAN do exactly is done exactly, and it is most of the answer:
// geometry no constraint reaches is free with no rank analysis required, a
// keyword the kernel does not know holds nothing, and a repeat of a constraint
// already made is redundant by inspection.
//
// Nothing here includes a drawing header, a kernel header or a solver.
#ifndef FORGE_UI_SKETCHDIAGNOSIS_HPP
#define FORGE_UI_SKETCHDIAGNOSIS_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── the geometry a sketch can hold ──────────────────────────────────────────
enum class SketchGeometryKind : std::uint8_t {
  Point,   // SPT
  Line,    // SLINE
  Circle,  // SCIRC
  Arc,     // SARC
};

const char* sketchGeometryWord(SketchGeometryKind kind) noexcept;

// The free numbers this kind adds to the sketch. See the header note: point 2,
// circle 1, arc 3, line 0, transcribed from Sketch::collectUnknowns().
std::size_t sketchFreedoms(SketchGeometryKind kind) noexcept;

// TRUE for the four ops above and nothing else; `kind` is filled on a hit.
bool isSketchGeometryOp(const std::string& op, SketchGeometryKind& kind);

// ── the constraint kinds ────────────────────────────────────────────────────
// The nineteen keywords CON dispatches, and for each one the number of the
// solver's equations it adds and the number of %refs it takes. `known` is FALSE
// for a keyword the kernel does not dispatch -- it skips such a statement and
// names it, and so does this.
std::size_t constraintFreedomsHeld(const std::string& keyword, bool& known);
// The number of %refs the kind takes in its ordinary form.
std::size_t constraintOperandCount(const std::string& keyword, bool& known);
// TRUE for the two kinds with a SECOND, shorter form. HORIZ and VERT take ONE
// operand when it is a line and TWO when they are two points, and the kernel
// dispatches on the operand's own kind rather than on the count
// (Sketcher.cpp, `if (refs.size() >= 1 && isEntity(refs[0]))`). A rule that read
// one number here would report every horizontal line in every sketch as a
// constraint that was not given enough to hold.
bool constraintHasLineForm(const std::string& keyword);
// The six dimensional kinds carry a number; the thirteen geometric ones do not.
bool constraintIsDimensional(const std::string& keyword);

// Why a constraint holds nothing. Every one of these is decidable by reading the
// document, and every one is a thing the kernel itself skips or double-counts.
enum class ConstraintFault : std::uint8_t {
  None,
  // A keyword outside the set CON dispatches. The kernel skips it and names it.
  UnknownKind,
  // A %ref that names no geometry of THIS sketch -- a mis-typed reference, or an
  // operand belonging to another sketch, both of which the kernel skips.
  OperandUnresolved,
  // Fewer operands than the kind takes: FIX, RADIUS and DIAM take one, SYMM and
  // MIDPT take three, the other fourteen take two.
  OperandCount,
  // An earlier constraint of the SAME kind over the SAME geometry, carrying the
  // SAME number. The second one holds nothing the first did not, which is
  // redundancy by inspection and needs no rank analysis to see.
  Repeated,
  // The same kind over the same geometry, carrying a DIFFERENT number: two
  // points cannot be both 40 and 55 apart. NOT folded in with Repeated, because
  // the two are different things to a user -- one is tidying, the other is a
  // decision about which number is right -- and because it is what the kernel
  // itself does about it that decides how it is counted here. Its solve contract
  // is REPRESENT / REPAIR / TOLERATE: it demotes the conflicting constraint and
  // keeps going. So this one holds nothing, is NAMED, and does not make the
  // sketch read as over-held on the strength of a constraint that will be
  // dropped.
  Contradicts,
};

const char* toString(ConstraintFault fault) noexcept;

struct SketchConstraintRow {
  int irId = 0;
  std::string keyword;                    // "COINC", as the document carries it
  std::string name;                       // "Coincident"
  std::string label;                      // the record's own row label
  bool dimensional = false;
  bool hasValue = false;
  double value = 0.0;
  std::vector<int> operands;              // the %refs, in argument order
  std::vector<std::string> operandLabels;
  // The freedoms this constraint takes away. ZERO when `fault` is not None: a
  // constraint the kernel skips holds nothing, and counting it would make a
  // broken sketch read as a tighter one.
  std::size_t holds = 0;
  ConstraintFault fault = ConstraintFault::None;
  int repeatOf = 0;                       // the earlier constraint, when Repeated
  // What this constraint does, in a user's words, with its OWN numbers in it.
  // `evidence`, never `detail`: in this codebase `.detail` names the program's
  // own untranslated failure text and may only be drawn in the Console.
  std::string evidence;
};

struct SketchGeometryRow {
  int irId = 0;
  SketchGeometryKind kind = SketchGeometryKind::Point;
  std::string op;                         // "SPT"
  std::string label;                      // the record's own row label
  std::string evidence;                   // "at 10, 20 mm"
  std::size_t freedoms = 0;
  std::vector<int> builtOn;               // the geometry this row is built from
  std::vector<std::size_t> constraints;   // indices into SketchDiagnosis::constraints
  // Which cluster of geometry this row moves with. Clusters are numbered from 0
  // in the order their lowest-indexed member appears.
  std::size_t cluster = 0;
  // A FIX names this row. Pinned geometry is the one thing in a sketch that
  // certainly does not move, and it is worth saying separately from the count.
  bool pinned = false;
};

// How a link between two geometry rows was made.
enum class SketchLinkKind : std::uint8_t {
  BuiltOn,      // a line is built on its two points; a circle on its centre
  Constrained,  // a constraint names them both
};

const char* toString(SketchLinkKind kind) noexcept;

struct SketchLink {
  std::size_t from = 0;   // indices into SketchDiagnosis::geometry
  std::size_t to = 0;
  SketchLinkKind kind = SketchLinkKind::BuiltOn;
  int irId = 0;           // the record that makes the link
  std::string name;       // "built on", or the constraint's own name
};

// A cluster of geometry that moves together, and what it costs. NOT called a
// group: forge::ui::SketchGroup already names one SKETCH and everything the
// document attaches to it (ModelTree.hpp), and two structures one word apart in
// one namespace is how a caller ends up reading the wrong one.
struct SketchCluster {
  std::vector<std::size_t> members;  // indices into SketchDiagnosis::geometry
  std::size_t freedoms = 0;
  std::size_t held = 0;
  bool pinned = false;               // a FIX reaches some member of it
};

enum class SketchDefinition : std::uint8_t {
  // Nothing has been drawn in it yet.
  Empty,
  // Something is still free to move.
  Under,
  // Every free number is held exactly once.
  Fully,
  // The constraints hold more than the geometry has to give.
  Over,
};

const char* toString(SketchDefinition definition) noexcept;

struct SketchDiagnosis {
  int irId = 0;                                 // the SKETCH record
  std::string label;
  std::string plane;                            // the PLANE keyword it carries
  std::vector<SketchGeometryRow> geometry;
  std::vector<SketchConstraintRow> constraints;
  std::vector<SketchLink> links;
  std::vector<SketchCluster> clusters;

  std::size_t freedoms = 0;   // over the geometry
  std::size_t held = 0;       // over the constraints with no fault
  // freedoms - held, and NEGATIVE when the constraints hold more than there is.
  int stillFree = 0;
  SketchDefinition definition = SketchDefinition::Empty;
  std::size_t faults = 0;         // constraints holding nothing
  // Geometry rows that carry freedoms and that no sound constraint reaches. This
  // one is EXACT and needs no arithmetic about ranks: nothing holds them.
  std::size_t untouched = 0;
  std::size_t points = 0;
  std::size_t curves = 0;
  int solvedBy = 0;               // the SOLVE record, 0 while unsolved

  std::size_t rowCount() const noexcept { return geometry.size() + constraints.size(); }
};

struct SketchDiagnosisSet {
  std::vector<SketchDiagnosis> sketches;
  // CON records whose owning SKETCH is not in this document, and geometry in the
  // same position. Reported rather than dropped: a row that vanishes is a row a
  // user cannot ask about.
  std::size_t unattached = 0;

  bool empty() const noexcept { return sketches.empty(); }
  std::size_t rowCount() const noexcept;
  std::size_t constraintCount() const noexcept;
  std::size_t faultCount() const noexcept;
  // The sketches that are not Fully defined. The one number the Solver tab leads
  // with, computed rather than counted by a panel.
  std::size_t unresolved() const noexcept;
  const SketchDiagnosis* find(int irId) const noexcept;
};

SketchDiagnosisSet buildSketchDiagnosis(const PartDocument& document);

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHDIAGNOSIS_HPP
