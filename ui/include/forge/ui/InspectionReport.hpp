// ui/include/forge/ui/InspectionReport.hpp
//
// WHAT A PANEL IS ALLOWED TO PRINT — the arithmetic behind the inspection tabs,
// kept out of the frame builder for the same reason MeasureModel is.
//
// THE DEFECT THIS EXISTS FOR, MEASURED. Of the 50 panels the eight default
// workspaces define, 27 drew no content at all: they named the tab, said what it
// would one day show, and stopped. The obvious repair is to write numbers into
// the frame builder — and the frame builder is the one file CI compiles but
// never RUNS, so a number invented there is a number nothing can contradict.
//
// So the rule this file exists to keep is: A PANEL MAY ONLY PRINT WHAT SOMETHING
// HEADLESS HAS ALREADY ASSERTED. Every quantity a new panel draws is computed
// here, from data the application already measured, and pinned by
// ui/test/inspection_report_test.cpp. Nothing here includes ImGui, OCCT or a
// forge-kernel header.
//
// ── the three questions, and why they are one file ──────────────────────────
//
//   1. IS THE BODY ON SCREEN THE BODY THE KERNEL SAID IT BUILT?
//      The kernel reports its own volume, face count and box. The viewport's
//      triangle soup is a SECOND, INDEPENDENT instrument over the same solid.
//      Comparing them is the only check in this application that can catch a
//      kernel that reports success over geometry it did not produce.
//
//      This is written against a lesson that cost real work: a single scalar
//      cannot validate geometry. A volume can be right while the shape is
//      wrong, and a box can be right while the volume is. So the report is a
//      VECTOR of observables, and a check that cannot be answered says
//      Unavailable rather than passing by default.
//
//   2. WHAT NUMBERS DRIVE THIS MODEL?
//      Every numeric argument of every statement, addressed the way the edit
//      command addresses it, so a panel row and the command that changes it
//      cannot disagree about which slot is meant.
//
//   3. WHAT WOULD THIS PART WEIGH?
//      Real volume times real handbook density. The document does not yet carry
//      a material choice, so the honest answer is the whole table rather than
//      one invented row.
#ifndef FORGE_UI_INSPECTIONREPORT_HPP
#define FORGE_UI_INSPECTIONREPORT_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── the nth NUMERIC argument ────────────────────────────────────────────────
// "Index 0 of CYL(6, 40, 0, 0, -10) is the radius, and index 0 of
// FILLET(%4, 3, VERTICAL) is the radius too" — the caller never has to know that
// one statement leads with a %ref and the other does not.
//
// It lived TWICE before this: once in PartCommands.cpp's paramTarget (what the
// edit command changes) and once in ForgeFrame.cpp's numberArgAt (what the panel
// shows). Two copies of the rule that decides WHICH NUMBER IS BEING EDITED is
// how a panel comes to display one slot and rewrite another. Both now call this.
std::size_t numericArgCount(const std::vector<IrArg>& args) noexcept;
// The position in `args` of the `index`th numeric argument, or args.size() when
// there is no such argument. Out of range is not an error and never wraps.
std::size_t numericArgSlot(const std::vector<IrArg>& args, std::size_t index) noexcept;

// ── 1. the two instruments ──────────────────────────────────────────────────

// What the modelling kernel said about the solid it built. A plain value type:
// the frame builder fills it from its own build report, so this module needs no
// kernel header and the whole comparison runs headless.
struct KernelSolidReport {
  bool built = false;   // parsed AND compiled AND tessellated
  bool valid = false;   // the kernel's own watertight / manifold / oriented claim
  long faceCount = -1;  // negative when the kernel did not answer
  long edgeCount = -1;
  double volumeMm3 = 0.0;
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  bool bboxKnown = false;
  std::size_t declared = 0;
  std::size_t parsed = 0;
  std::size_t compiled = 0;
};

enum class CheckState : std::uint8_t {
  // The check was answerable and the answer is right.
  Pass,
  // The check was answerable and the answer is wrong. Something on screen is not
  // what it claims to be.
  Fail,
  // Neither instrument could answer. NOT a pass: a check that quietly passes
  // when it could not run is how an unverified build reads as a verified one.
  Unavailable,
  // A real, reported number that is not a verdict — the two instruments are
  // expected to differ and by how much is the interesting part.
  Informational,
};

const char* toString(CheckState state) noexcept;

struct InspectionCheck {
  std::string name;    // what was checked, in a user's words
  std::string detail;  // the evidence, with its numbers
  CheckState state = CheckState::Unavailable;
};

struct InspectionReport {
  std::vector<InspectionCheck> checks;
  std::size_t passed = 0;
  std::size_t failed = 0;
  std::size_t unavailable = 0;
  std::size_t informational = 0;

  // Nothing contradicted. Deliberately NOT "everything passed": a report of six
  // Unavailable checks is not a verified part, and `answered` is what says so.
  bool clean() const noexcept { return failed == 0; }
  std::size_t answered() const noexcept { return passed + failed; }
};

// ── the tolerances, stated rather than buried ──────────────────────────────
//
// The vertex stream the viewport draws is float32 and its coordinates are EXACT
// POINTS ON THE B-REP: a tessellator emits surface points and joins them with
// chords. Two consequences are used below and neither is a guess:
//
//   * the mesh's bounding box can never EXCEED the kernel's, because every mesh
//     vertex lies on the solid. It may fall short of it, by at most the chord
//     height of a curved face. So containment is a real verdict and equality is
//     not.
//   * the mesh's volume is a CHORD approximation of an exact one, so the two
//     volumes are expected to differ. That difference is REPORTED, never graded:
//     a convex face loses volume to its chords and a concave one gains, so there
//     is no signed bound this module could assert without knowing the surface.
//
// The box slack is relative to the box's own diagonal because float32 carries
// ~7 significant digits, so the absolute error of a coordinate grows with the
// part. 1e-5 of the diagonal is ~100x that resolution — loose enough that a
// clean part never fails, tight enough that a mesh from a DIFFERENT solid does.
inline constexpr double kInspectionBoxSlackFraction = 1.0e-5;

// `mesh` is what measureMesh() returned for the triangle soup on screen;
// `records` is the document's statements, in order.
InspectionReport buildInspectionReport(const KernelSolidReport& kernel, const MeshMeasure& mesh,
                                       const std::vector<FeatureRecord>& records);

// ── 2. the driving dimensions ───────────────────────────────────────────────
// One row per numeric argument of one statement. `numberIndex` is what
// part.edit_feature's `index` parameter means, so a panel row IS an edit target.
struct DimensionRow {
  int irId = 0;               // the statement's 1-based creation id
  std::string op;             // "FILLET"
  std::string label;          // the document's own row label, "" when it has none
  std::size_t numberIndex = 0;
  std::size_t argSlot = 0;    // position within the statement's full argument list
  double value = 0.0;
};

// Every numeric argument of every statement, in document order then argument
// order. A statement with no numeric argument contributes no row — CUT(%1, %2)
// has nothing to drive, and a row reading 0 would be a dimension the document
// never had.
std::vector<DimensionRow> collectDrivingDimensions(const std::vector<FeatureRecord>& records);

// How many statements carry no number at all. Printed beside the rows so a short
// list reads as a fact about the model rather than as a panel that lost some.
std::size_t statementsWithoutDimensions(const std::vector<FeatureRecord>& records) noexcept;

// ── 4. the smallest block this part can be cut from ─────────────────────────
//
// A machinist's first two questions about a part are "what billet do I buy" and
// "how much of it ends up as swarf", and both are arithmetic over numbers this
// application has already measured: the block is the part's own bounding box,
// and what is left is its volume against the block's.
//
// It is the SMALLEST enclosing block and it says so. Real stock carries a
// machining allowance and is bought in standard sizes; this is the floor those
// choices start from, not a claim about what anyone will order.
struct StockEnvelope {
  // False when either measurement is missing, or when the part's volume exceeds
  // the block that contains it -- which cannot happen and therefore means one of
  // the two numbers is wrong. Printing a negative amount of swarf would be the
  // panel reporting a fault as a measurement.
  bool known = false;
  double size[3] = {0.0, 0.0, 0.0};
  double blockVolumeMm3 = 0.0;
  double partVolumeMm3 = 0.0;
  double removedVolumeMm3 = 0.0;
  double removedFraction = 0.0;  // 0..1
  // Block volume divided by part volume — the ratio a shop quotes as buy-to-fly.
  // 1.0 for a part that fills its block; larger the more there is to cut away.
  double buyToFly = 0.0;
};

StockEnvelope stockEnvelope(const MeasureBox& box, double partVolumeMm3) noexcept;

// ── 3. what it would weigh ──────────────────────────────────────────────────
struct MassRow {
  Material material{};
  MassProperties properties{};
};

// One row per library material that HAS a density, ordered by the mass this part
// would have, lightest first, ties broken by id so the order is deterministic.
//
// `volumeMm3` must be a volume the caller has established is real — an open mesh
// has no volume, and this returns an EMPTY table for a non-positive one rather
// than a column of zeroes.
std::vector<MassRow> massTable(double volumeMm3);

}  // namespace forge::ui

#endif  // FORGE_UI_INSPECTIONREPORT_HPP
