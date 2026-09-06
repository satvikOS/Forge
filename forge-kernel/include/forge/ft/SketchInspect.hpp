// forge-kernel/include/forge/ft/SketchInspect.hpp
//
// WHAT A SKETCH ACTUALLY IS, RIGHT NOW — the read-only half of the 2D sketch +
// constraint family.
//
// forge::ft::compile() walks SKETCH / SPT / SLINE / SCIRC / SARC / CON / SOLVE
// into a solid and throws the sketch away: CompileResult carries a volume, a
// face count and a bounding box, and NOT ONE FACT about the constraint network
// that produced them. So an application could build a constrained sketch and
// then had no way to answer the four questions a sketcher exists to answer:
//
//     which constraints are on this sketch, and are they satisfied?
//     which dimensions drive it, and which of them can still be changed?
//     what is still free to move, and what moves with it?
//     what curves is it made of, and how big are they NOW?
//
// This header answers all four from the SOLVER, not from the drawing. Every
// number below is either read out of the planegcs parameter storage after the
// same solveOrRepair() the compiler runs, or comes from GCS::System's own
// diagnose (dofsNumber, getConflicting / getRedundant / getPartiallyRedundant /
// getDependentParamsGroups, calculateConstraintErrorByTag). NO numerics are
// added here and nothing is estimated: a field that could not be measured is
// flagged, never filled with a plausible value.
//
// ── it is OCCT-free ON PURPOSE ──────────────────────────────────────────────
// forge/Sketcher.hpp reaches TopoDS_Wire, so a UI that included it to read a
// constraint would pull the whole modelling kernel into its frame builder. This
// header is plain C++ over plain data, so the application's panels can include
// it and the ImGui frame builder still reaches no OCCT header.
//
// ── the strings here are IR KEYWORDS, never sentences ───────────────────────
// `keyword` is "DIST", the same token the IR spells. Turning that into words a
// person reads is the application's job and is deliberately NOT done here: the
// user-facing prose gate reads the application's sources, and prose written in
// the kernel would be prose nothing scans.
#ifndef FORGE_FT_SKETCHINSPECT_HPP
#define FORGE_FT_SKETCHINSPECT_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace ft {

// ── THE ONE CON KEYWORD TABLE ───────────────────────────────────────────────
// The compiler dispatched CON through a table private to FeatureTreeCompiler.cpp
// and nothing else could see it, so any second reader of the family had to write
// the same nineteen rows again — and a constraint the compiler applies while a
// panel calls it unknown is exactly the kind of disagreement that is invisible
// until a user reports a part that came out wrong. There is now ONE table and
// both read it.
//
// `kind` is the numeric value of the forge::SketchConstraintKind enumerator.
// It is carried as a number rather than as the enum because that enum lives in
// forge/Sketcher.hpp, which reaches OCCT; the two are pinned equal by a
// static_assert per row in SketchInspect.cpp, so they cannot drift apart
// silently — a renumbered enumerator is a compile error, not a wrong panel.
struct ConKeyword {
  const char* word = "";          // the IR spelling, e.g. "DIST"
  std::uint32_t kind = 0;         // forge::SketchConstraintKind's value
  bool dimensional = false;       // carries a driving VALUE
  bool angular = false;           // that value is an ANGLE, in DEGREES in the IR
};

// Every keyword the compiler dispatches, in the family census's own order
// (geometric first, then dimensional).
const std::vector<ConKeyword>& conKeywords();
// Nullptr for a spelling the compiler would skip.
const ConKeyword* findConKeyword(const std::string& word);

// ── what one entity IS ──────────────────────────────────────────────────────
enum class SketchCurveKind : std::uint8_t { Point = 0, Line = 1, Circle = 2, Arc = 3 };

// Which parameter of an entity is still free to move. Mirrors
// forge::SketchParamRole; spelled again here only because that enum lives in a
// header that reaches OCCT.
enum class SketchFreeRole : std::uint8_t {
  X = 0,
  Y = 1,
  Radius = 2,
  StartAngle = 3,
  EndAngle = 4,
  Other = 255,
};

// Whether a CON statement reached the solver, and if not, why not. The compiler
// tolerates all three failures (it skips the statement and keeps building), so
// all three are states a live sketch can be in.
enum class SketchConstraintState : std::uint8_t {
  Applied = 0,     // it is in the constraint network
  UnknownKind,     // the keyword is not one the solver knows
  BadOperand,      // a reference did not resolve, or names another sketch
  Rejected,        // the solver refused these operands for this kind
};

struct SketchEntityInfo {
  int irId = 0;                   // the SPT / SLINE / SCIRC / SARC statement id
  SketchCurveKind kind = SketchCurveKind::Point;
  // Live geometry, read back AFTER the program's own SOLVE (if it has one).
  double x0 = 0.0, y0 = 0.0;      // point; line start; arc start
  double x1 = 0.0, y1 = 0.0;      // line end; arc end
  double cx = 0.0, cy = 0.0;      // circle / arc centre
  double radius = 0.0;
  double length = 0.0;            // line length / arc length / circumference
  bool hasRadius = false;
  bool hasLength = false;
  // What the STATEMENT wrote, when the statement writes a radius (SCIRC). A
  // RADIUS / DIAM / EQUAL / TANG constraint moves it, so "drawn 10, now 12" is a
  // fact the drawing alone cannot tell you.
  bool hasWrittenRadius = false;
  double writtenRadius = 0.0;
  // The statements this entity is built out of (SLINE's two points, SCIRC's
  // centre, SARC's centre / start / end), in the order the statement names them.
  std::vector<int> parentIrIds;
  // The CON statements that reference it.
  std::vector<int> constraintIrIds;
  // WHICH of this entity's own parameters the solver still lists as free, each
  // named ONCE, and which coupling group(s) they fall in. Empty means the solver
  // has this entity fully determined — which is a stronger and more useful
  // statement than any count, and is why this is a list of roles rather than a
  // number.
  std::vector<SketchFreeRole> freeRoles;
  std::vector<int> freeGroups;
};

struct SketchConstraintInfo {
  int irId = 0;                   // the CON statement id
  std::string keyword;            // "DIST", "COINC", ... exactly as written
  SketchConstraintState state = SketchConstraintState::Applied;
  std::vector<int> operandIrIds;  // the entity statements it couples
  bool hasValue = false;
  double value = 0.0;             // as WRITTEN in the IR (DEGREES for ANGLE)
  bool dimensional = false;
  bool angular = false;
  int tag = 0;                    // the solver tag; 0 when it never reached one
  // From GCS::calculateConstraintErrorByTag — how far this constraint is from
  // satisfied at the CURRENT coordinates. Not available for a constraint that
  // never reached the solver, and not invented for one.
  bool hasResidual = false;
  double residual = 0.0;
  // From the solver's own diagnose, BEFORE any repair.
  bool conflicting = false;
  bool redundant = false;
  bool partiallyRedundant = false;
  // solveOrRepair dropped it to make the sketch solvable. `demotedForConflict`
  // separates the two reasons the repair has.
  bool demoted = false;
  bool demotedForConflict = false;
};

// One DRIVING NUMBER of the sketch: the thing a dimension panel edits.
enum class SketchDimensionSource : std::uint8_t {
  Constraint = 0,   // a dimensional CON — DIST / DISTX / DISTY / ANGLE / RADIUS / DIAM
  CircleRadius,     // SCIRC's own radius argument
};

struct SketchDimensionInfo {
  int irId = 0;                   // the statement whose NUMBER argument drives it
  SketchDimensionSource source = SketchDimensionSource::Constraint;
  std::string keyword;            // the CON spelling; empty for a circle radius
  double value = 0.0;             // as WRITTEN in the IR
  bool angular = false;           // degrees rather than millimetres
  std::vector<int> operandIrIds;
  // TRUE when this number is actually driving the model: it reached the solver
  // and the repair did not drop it. A circle's own radius is always driving —
  // it IS the parameter — but a RADIUS constraint on the same circle can move
  // it, which is why `solvedValue` is reported beside it.
  bool driving = false;
  // What the solver left the constrained quantity at. Reported only where it
  // can be MEASURED: a circle radius (read back from the entity) and a distance
  // (computed from the two solved points). Absent otherwise rather than guessed.
  bool hasSolvedValue = false;
  double solvedValue = 0.0;
  bool hasResidual = false;
  double residual = 0.0;
};

// One group of parameters the solver says are still free to move TOGETHER.
// Dragging any member moves the others; a group of one moves alone. There is
// exactly one group per remaining degree of freedom, and groups OVERLAP where a
// parameter is coupled to more than one freedom — that overlap is the coupling,
// not a defect, so it is preserved.
struct SketchFreeGroup {
  int group = -1;                 // the solver's own group index
  int paramCount = 0;             // free parameters in it, each counted ONCE
  std::vector<int> entityIrIds;   // the statements those parameters belong to
};

// How the whole sketch stands, straight out of GCS::System::diagnose.
enum class SketchHealth : std::uint8_t {
  Empty = 0,        // no driving constraints to diagnose
  UnderConstrained, // dof > 0
  FullyConstrained, // dof == 0, no conflicts, no redundancy
  OverConstrained,  // structurally inconsistent
  Redundant,        // consistent, but carries removable constraints
};

struct SketchInfo {
  int irId = 0;                   // the SKETCH statement id
  std::string plane;              // the keyword the statement wrote
  bool planeApplied = true;       // false when the kernel solved it on XY anyway
  int solveIrId = 0;              // the SOLVE statement that consumes it, 0 if none
  bool solved = false;
  // Of the FINAL state (after the program's own SOLVE, if it has one).
  SketchHealth health = SketchHealth::Empty;
  int dof = -1;                   // remaining degrees of freedom; -1 = not diagnosable
  bool converged = false;         // the solve reached its target
  int solvePasses = 0;
  double worstResidual = 0.0;
  bool hasWorstResidual = false;
  std::vector<SketchEntityInfo> entities;
  std::vector<SketchConstraintInfo> constraints;
  std::vector<SketchDimensionInfo> dimensions;
  std::vector<SketchFreeGroup> freeGroups;
};

struct SketchInspection {
  std::vector<SketchInfo> sketches;
  // False only when the PROGRAM could not be read at all. A statement this
  // family cannot make sense of is skipped and the rest is still reported —
  // the same never-refuse contract the compiler holds to.
  bool ok = true;
  std::string error;              // internal detail; for a log, never a panel
  // The SKETCH statement whose entities the given statement belongs to, 0 when
  // the statement is not part of any sketch. Follows the first operand exactly
  // as forge::ui does, so the two agree by construction.
  int sketchOf(int irId) const;
};

// Walk a parsed tree's sketch family and report it. Builds real sketches through
// the real facade, runs the real diagnose, and destroys every sketch it made
// before returning — the report is plain data and owns no kernel handle.
SketchInspection inspectSketches(const FeatureTree& ft);

// parse() + inspectSketches(). A parse failure comes back as ok=false with the
// parser's own message in `error`; it never throws.
SketchInspection inspectSketchesText(const std::string& irText);

}  // namespace ft
}  // namespace forge

#endif  // FORGE_FT_SKETCHINSPECT_HPP
