// ui/test/workspace_trees_test.cpp
//
// WHAT THE ASSEMBLY, OPERATIONS, SHEETS AND STUDIES TABS SHOW.
//
// THE DEFECT THESE FOUR PANELS EXIST FOR. Seven docked tabs were dispatched to
// ONE function and all seven drew the feature history. Three of them became real
// (ModelTree.hpp). The other four were left drawing NOTHING, and a workspace tab
// that draws nothing is not a feature -- ui/test/panel_content_ratchet_test.cpp
// is the standing measurement of how many there still are.
//
// The rule this file enforces is InspectionReport.hpp's: A PANEL MAY ONLY PRINT
// WHAT SOMETHING HEADLESS HAS ALREADY ASSERTED. Every number the four panels put
// on screen is computed in forge::ui::WorkspaceTrees and checked here, against
// the document that produced it or against arithmetic written out in full.
//
// Three kinds of check, and the third is the one that matters:
//
//   A. THE ARGUMENT POSITIONS ARE RE-DERIVED FROM THE KERNEL HEADER. "the second
//      number of a CBORE is the counterbore diameter" is a fact about
//      forge-kernel/include/forge/ft/FeatureTree.hpp, not about this repository's
//      memory of it. Reading it as data is what stops a panel labelling a hole's
//      depth as its diameter after a kernel change nothing in ui/ would notice.
//   B. the census is TOTAL -- every statement is an operation, a shaping
//      statement or a pass-through, and every component sits in exactly one
//      place in the nesting.
//   C. POSITIVE CONTROLS. A panel showing a plausible constant passes any check
//      that only asks "is there a number here". So the fixtures are EDITED and
//      the answers must move: change a pattern's count and the instance count
//      moves; grow the part and the drawing's sheet and scale move; give the
//      document a material and a study stops waiting and answers.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Units.hpp"
#include "forge/ui/WorkspaceTrees.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string repoRoot() {
#ifdef FORGE_UI_REPO_ROOT
  return std::string(FORGE_UI_REPO_ROOT);
#else
  return std::string(".");
#endif
}

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) { ok = false; return {}; }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

// Appends one statement through the REAL receiver, with the real consumed /
// produced bookkeeping a command does, so a malformed fixture fails as a fixture
// rather than as a mysteriously empty answer.
bool append(PartDocument& doc, const char* op, std::vector<IrArg> args, IrValueKind kind,
            const char* label, const std::vector<std::string>& consumed,
            const std::string& produced) {
  FeatureRecord r;
  r.irId = doc.nextIrId();
  r.label = label;
  r.produces = kind;
  r.line.id = r.irId;
  r.line.op = op;
  r.line.args = std::move(args);
  return doc.appendFeature(r, consumed, produced);
}

bool contains(const std::string& hay, const std::string& needle) {
  return hay.find(needle) != std::string::npos;
}

// The FIRST documented form of `NAME(` in the kernel header, as written, with
// the brackets and defaults intact: "HOLE(%body, dia, cx, cy, cz [, axx=0, ...])".
// The header's op table writes one per line as a trailing comment.
std::string documentedForm(const std::string& src, const std::string& op) {
  const std::string needle = op + "(";
  std::size_t at = 0;
  while ((at = src.find(needle, at)) != std::string::npos) {
    // The op table's forms are inside a `//` comment, which is what separates a
    // documented form from a call in the code below it.
    const std::size_t lineStart = src.rfind('\n', at);
    const std::size_t from = lineStart == std::string::npos ? 0 : lineStart + 1;
    const std::size_t slashes = src.find("//", from);
    if (slashes == std::string::npos || slashes > at) { at += needle.size(); continue; }
    // A name is a whole token, so `RESIZEBORE(` must not match inside another.
    if (at > 0) {
      const char before = src[at - 1];
      const bool wordChar = (before >= 'A' && before <= 'Z') || (before >= 'a' && before <= 'z') ||
                            (before >= '0' && before <= '9') || before == '_';
      if (wordChar) { at += needle.size(); continue; }
    }
    const std::size_t close = src.find(')', at);
    if (close == std::string::npos) return {};
    return src.substr(at, close - at + 1);
  }
  return {};
}

}  // namespace

int main() {
  Harness H("workspace_trees");

  // ── A. THE ARGUMENT POSITIONS COME FROM THE KERNEL HEADER ─────────────────
  //
  // Every index WorkspaceTrees.cpp reads is a claim about a documented form. The
  // claims are checked against the form itself, so a kernel change that moves an
  // argument turns this red instead of silently relabelling a user's dimension.
  {
    bool ok = false;
    const std::string header =
        readFile(repoRoot() + "/forge-kernel/include/forge/ft/FeatureTree.hpp", ok);
    if (!ok) std::printf("  cannot read the kernel feature-tree header -- section A cannot run\n");
    CHECK(ok);
    if (ok) {
      // The two numbers a drilled hole is: the FIRST is the diameter and the
      // EIGHTH is the depth, which is what makes `n[7]` in the reader correct.
      const std::string hole = documentedForm(header, "HOLE");
      CHECK(contains(hole, "HOLE(%body, dia, cx, cy, cz"));
      CHECK(contains(hole, "axx=0, axy=0, axz=1, depth"));
      CHECK(contains(hole, "depth<=0 => through"));

      const std::string cbore = documentedForm(header, "CBORE");
      CHECK(contains(cbore, "CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz"));

      CHECK(contains(documentedForm(header, "FILLET"), "FILLET(%body, radius"));
      CHECK(contains(documentedForm(header, "CHAMFER"), "CHAMFER(%body, dist"));
      CHECK(contains(documentedForm(header, "SHELL"), "SHELL(%body, wall"));
      CHECK(contains(documentedForm(header, "RESIZEBORE"), "RESIZEBORE(%body, \"sel\", newRadius"));
      CHECK(contains(documentedForm(header, "CUT"), "CUT(%a, %b)"));

      // The replication family, and the three PATTERN forms whose counts this
      // file reads. Each is pinned as the header spells it.
      CHECK(contains(documentedForm(header, "TRANSLATE"), "TRANSLATE(%a, dx, dy, dz)"));
      CHECK(contains(documentedForm(header, "ROTATE"), "ROTATE(%a, angleDeg, axx, axy, axz"));
      CHECK(contains(header, "PATTERN(%a, LINEAR, n, dx"));
      CHECK(contains(header, "PATTERN(%a, POLAR, n, totalAngleDeg"));
      CHECK(contains(header, "PATTERN(%a, GRID, nx, ny, dx, dy)"));
      CHECK(contains(header, "MIRROR(%a, PLANE)"));
    }

    // Every op either classifier names must EXIST. A typo would classify nothing
    // and the panel would quietly show an empty plan over a part full of holes.
    const char* const kNamed[] = {"TRANSLATE", "ROTATE",  "MIRROR",  "PATTERN", "HOLE",
                                  "CBORE",     "RESIZEBORE", "CUT",  "SHELL",   "FILLET",
                                  "CHAMFER"};
    for (const char* op : kNamed) {
      const std::string name(op);
      CHECK(findIrOp(name) != nullptr);
      CHECK(isPlacementOp(name) || isMaterialRemovalOp(name));
      // The two families are disjoint: a statement is a placement or a cut, never
      // both, or it would be counted twice.
      CHECK(!(isPlacementOp(name) && isMaterialRemovalOp(name)));
    }
    CHECK(!isPlacementOp("EXTRUDE"));
    CHECK(!isMaterialRemovalOp("EXTRUDE"));
    CHECK(!isMaterialRemovalOp("PUSHFACE"));   // it can add material as readily
    CHECK(!isMaterialRemovalOp("DEFEATURE"));  // it heals the wound it makes
  }

  // ── B. THE ASSEMBLY READING ───────────────────────────────────────────────
  {
    PartDocument doc;
    CHECK(append(doc, "RECT", {IrArg::num(80), IrArg::num(50)}, IrValueKind::Profile, "Rectangle",
                 {}, "profile1"));
    CHECK(append(doc, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(10)}, IrValueKind::Solid, "Plate",
                 {"profile1"}, "plate"));
    CHECK(append(doc, "HOLE",
                 {IrArg::valueRef(2), IrArg::num(6), IrArg::num(20), IrArg::num(20), IrArg::num(0),
                  IrArg::num(0), IrArg::num(0), IrArg::num(1), IrArg::num(8)},
                 IrValueKind::Solid, "Hole", {"plate"}, "drilled"));
    CHECK(append(doc, "PATTERN",
                 {IrArg::valueRef(3), IrArg::keyword("LINEAR"), IrArg::num(4), IrArg::num(25)},
                 IrValueKind::Solid, "Row of holes", {"drilled"}, "patterned"));
    CHECK(append(doc, "FILLET", {IrArg::valueRef(4), IrArg::num(2), IrArg::keyword("ALL")},
                 IrValueKind::Solid, "Rounds", {"patterned"}, "rounded"));
    CHECK(append(doc, "CHAMFER", {IrArg::valueRef(5), IrArg::num(1)}, IrValueKind::Solid,
                 "Chamfer", {"rounded"}, "final"));

    const AssemblyTree tree = buildAssemblyTree(doc);
    // Five bodies; the rectangle is a PROFILE and belongs to the sketch tree. A
    // parts list with a rectangle in it is a parts list nobody can order from.
    CHECK_EQ_INT(tree.components.size(), 5);
    CHECK_EQ_INT(tree.roots.size(), 1);
    CHECK(!tree.empty());
    for (const AssemblyComponent& c : tree.components) CHECK(c.op != "RECT");

    // The nesting is the chain the document actually built: the chamfer absorbed
    // the fillet, which absorbed the pattern, and so on down to the plate.
    CHECK_EQ_INT(tree.components[tree.roots[0]].irId, 6);
    CHECK_EQ_INT(tree.components[tree.roots[0]].depth, 0);
    CHECK(tree.components[tree.roots[0]].live);
    for (std::size_t i = 0; i + 1 < tree.components.size(); ++i) {
      // Depth-first with one child each: every next row is one deeper and is the
      // previous row's only child.
      CHECK_EQ_INT(tree.components[i].children.size(), 1);
      CHECK_EQ_INT(tree.components[i].children[0], i + 1);
      CHECK_EQ_INT(tree.components[i + 1].depth, tree.components[i].depth + 1);
      CHECK(tree.components[i + 1].irId < tree.components[i].irId);
    }
    // Exactly one is still selectable: a boolean or a feature absorbs its operand
    // and the document stops binding it.
    CHECK_EQ_INT(tree.liveComponents, 1);
    // Every component the tree calls live round-trips through the document's OWN
    // binding table, never through this file's memory of it.
    for (const AssemblyComponent& c : tree.components) {
      if (!c.live) continue;
      CHECK(!c.node.empty());
      CHECK_EQ_INT(doc.valueFor(c.node), c.irId);
    }

    // THE PLACEMENT, with the statement's own count and spacing in it.
    CHECK_EQ_INT(tree.placements.size(), 1);
    CHECK_EQ_INT(tree.placedCopies, 4);
    CHECK_EQ_INT(tree.placements[0].copies, 4);
    CHECK(tree.placements[0].countKnown);
    CHECK_EQ_STR(tree.placements[0].op, "PATTERN");
    CHECK(tree.placements[0].kind == PlacementKind::RepeatedInLine);
    CHECK_EQ_INT(tree.placements[0].source, 3);
    CHECK_EQ_STR(tree.placements[0].sourceLabel, "Hole");
    CHECK(contains(tree.placements[0].describe, "4 copies"));
    CHECK(contains(tree.placements[0].describe, "25 mm apart"));
    // and it hangs off the component it COPIES, which is what a user is asking
    // about when they ask how many there are.
    const AssemblyComponent* source = tree.find(3);
    CHECK(source != nullptr);
    if (source != nullptr) CHECK_EQ_INT(source->placements.size(), 1);

    // ── POSITIVE CONTROL: the count is READ, not remembered ────────────────
    CHECK(doc.editFeatureArgs(4, {IrArg::valueRef(3), IrArg::keyword("LINEAR"), IrArg::num(7),
                                  IrArg::num(25)}));
    const AssemblyTree after = buildAssemblyTree(doc);
    CHECK_EQ_INT(after.placedCopies, 7);
    CHECK(contains(after.placements[0].describe, "7 copies"));

    // A count that is not a whole number is not a count. The statement plainly
    // makes some copies, so the row still draws and says the number is not one
    // it can report -- reporting 0 instances of a real pattern would be worse.
    CHECK(doc.editFeatureArgs(4, {IrArg::valueRef(3), IrArg::keyword("LINEAR"), IrArg::num(2.5),
                                  IrArg::num(25)}));
    const AssemblyTree odd = buildAssemblyTree(doc);
    CHECK(!odd.placements[0].countKnown);
    CHECK_EQ_INT(odd.placements[0].copies, 1);
  }

  // A second shape, for the branch a boolean makes: two components under one.
  {
    PartDocument doc;
    CHECK(doc.seed(IrValueKind::Solid, "block", "BOX",
                   {IrArg::num(50), IrArg::num(50), IrArg::num(20)}) == 1);
    CHECK(doc.seed(IrValueKind::Solid, "pin", "CYL", {IrArg::num(5), IrArg::num(30)}) == 2);
    CHECK(append(doc, "CUT", {IrArg::valueRef(1), IrArg::valueRef(2)}, IrValueKind::Solid,
                 "Bore", {"block", "pin"}, "bored"));
    CHECK(append(doc, "SHELL", {IrArg::valueRef(3), IrArg::num(2)}, IrValueKind::Solid, "Hollow",
                 {"bored"}, "hollow"));

    const AssemblyTree tree = buildAssemblyTree(doc);
    CHECK_EQ_INT(tree.components.size(), 4);
    CHECK_EQ_INT(tree.roots.size(), 1);
    CHECK_EQ_INT(tree.components[0].irId, 4);       // the shell, at the top
    CHECK_EQ_INT(tree.components[1].irId, 3);       // the cut it absorbed
    CHECK_EQ_INT(tree.components[1].children.size(), 2);
    CHECK_EQ_INT(tree.components[2].irId, 1);       // both operands, ids ascending
    CHECK_EQ_INT(tree.components[3].irId, 2);
    CHECK_EQ_INT(tree.components[2].depth, 2);
    CHECK_EQ_INT(tree.components[3].depth, 2);
    CHECK_EQ_INT(tree.placements.size(), 0);
    // THE CENSUS IS TOTAL: every component appears exactly once, and every one
    // is either a root or a child of exactly one other.
    std::size_t asChild = 0;
    for (const AssemblyComponent& c : tree.components) asChild += c.children.size();
    CHECK_EQ_INT(asChild + tree.roots.size(), tree.components.size());

    // ── THE MACHINING READING of the same document ─────────────────────────
    const MachiningPlan plan = buildMachiningPlan(doc);
    CHECK_EQ_INT(plan.operations.size(), 2);
    CHECK_EQ_INT(plan.cutouts, 2);
    CHECK_EQ_INT(plan.holes, 0);
    CHECK_EQ_INT(plan.shapingStatements, 2);   // the two seeded primitives
    CHECK_EQ_INT(plan.operations[0].order, 1);
    CHECK(plan.operations[0].kind == MachiningKind::Cutout);
    // A CUT names the body it takes away, because a boolean carries no dimension
    // and the name is the only useful thing the row can say.
    CHECK(contains(plan.operations[0].evidence, "takes away Hollow") == false);
    CHECK(contains(plan.operations[0].evidence, "takes away"));
    CHECK(plan.operations[1].kind == MachiningKind::Hollow);
    CHECK(contains(plan.operations[1].evidence, "2 mm thick"));
    CHECK(!plan.smallestToolKnown);   // neither statement names a tool
  }

  // ── C. THE MACHINING READING, over the ops that carry numbers ─────────────
  {
    PartDocument doc;
    CHECK(doc.seed(IrValueKind::Solid, "blank", "BOX",
                   {IrArg::num(80), IrArg::num(50), IrArg::num(20)}) == 1);
    CHECK(append(doc, "HOLE",
                 {IrArg::valueRef(1), IrArg::num(6), IrArg::num(20), IrArg::num(20), IrArg::num(0),
                  IrArg::num(0), IrArg::num(0), IrArg::num(1), IrArg::num(8)},
                 IrValueKind::Solid, "Blind hole", {"blank"}, "h1"));
    CHECK(append(doc, "HOLE",
                 {IrArg::valueRef(2), IrArg::num(10), IrArg::num(60), IrArg::num(20),
                  IrArg::num(0)},
                 IrValueKind::Solid, "Through hole", {"h1"}, "h2"));
    CHECK(append(doc, "CBORE",
                 {IrArg::valueRef(3), IrArg::num(5), IrArg::num(9), IrArg::num(4), IrArg::num(40),
                  IrArg::num(25), IrArg::num(0)},
                 IrValueKind::Solid, "Cap screw", {"h2"}, "h3"));
    CHECK(append(doc, "FILLET", {IrArg::valueRef(4), IrArg::num(3), IrArg::keyword("VERTICAL")},
                 IrValueKind::Solid, "Corners", {"h3"}, "h4"));
    CHECK(append(doc, "CHAMFER", {IrArg::valueRef(5), IrArg::num(1)}, IrValueKind::Solid, "Break",
                 {"h4"}, "h5"));
    CHECK(append(doc, "TAG", {IrArg::valueRef(6), IrArg::text("@face"), IrArg::text("+z")},
                 IrValueKind::Solid, "Name", {}, ""));

    const MachiningPlan plan = buildMachiningPlan(doc);
    CHECK_EQ_INT(plan.operations.size(), 5);
    CHECK_EQ_INT(plan.holes, 3);
    CHECK_EQ_INT(plan.edgeOperations, 2);
    CHECK_EQ_INT(plan.cutouts, 0);
    // THE CENSUS IS TOTAL: every statement is an operation, a shaping statement
    // or a pass-through. A plan that silently drops one is a plan a machinist
    // cannot cost.
    std::size_t passThrough = 0;
    for (const FeatureRecord& r : doc.records()) {
      if (isPassThroughOp(r.line.op)) ++passThrough;
    }
    CHECK_EQ_INT(passThrough, 1);
    CHECK_EQ_INT(plan.operations.size() + plan.shapingStatements + passThrough,
                 doc.records().size());

    // The blind hole: eight numbers, so the eighth is a real depth.
    CHECK(plan.operations[0].kind == MachiningKind::Drill);
    CHECK(!plan.operations[0].through);
    CHECK_NEAR(plan.operations[0].depthMm, 8.0, 1e-12);
    CHECK_NEAR(plan.operations[0].toolDiameterMm, 6.0, 1e-12);
    CHECK(contains(plan.operations[0].evidence, "6 mm across"));
    CHECK(contains(plan.operations[0].evidence, "8 mm deep"));

    // The through hole: the depth argument is ABSENT, which the kernel documents
    // as through. "0 mm deep" would be a hole that is not there.
    CHECK(plan.operations[1].through);
    CHECK_NEAR(plan.operations[1].depthMm, 0.0, 1e-12);
    CHECK(contains(plan.operations[1].evidence, "right through"));
    CHECK_NEAR(plan.operations[1].toolDiameterMm, 10.0, 1e-12);

    // The counterbore: the FIRST number is the hole and the SECOND is the
    // counterbore. Getting those two the wrong way round is the exact defect
    // section A's re-derivation exists to stop.
    CHECK(plan.operations[2].kind == MachiningKind::Counterbore);
    CHECK_NEAR(plan.operations[2].toolDiameterMm, 5.0, 1e-12);
    CHECK(contains(plan.operations[2].evidence, "5 mm through"));
    CHECK(contains(plan.operations[2].evidence, "opened to 9 mm for 4 mm"));

    // A rounded internal corner of radius r is cut by a tool of diameter 2r.
    CHECK(plan.operations[3].kind == MachiningKind::EdgeRound);
    CHECK_NEAR(plan.operations[3].toolDiameterMm, 6.0, 1e-12);
    CHECK(contains(plan.operations[3].evidence, "3 mm radius"));
    CHECK(contains(plan.operations[3].evidence, "VERTICAL"));
    CHECK(plan.operations[4].kind == MachiningKind::EdgeBreak);
    CHECK_NEAR(plan.operations[4].toolDiameterMm, 0.0, 1e-12);

    // The tool that limits the job is the smallest diameter any operation names.
    CHECK(plan.smallestToolKnown);
    CHECK_NEAR(plan.smallestToolMm, 5.0, 1e-12);
    for (std::size_t i = 0; i < plan.operations.size(); ++i) {
      CHECK_EQ_INT(plan.operations[i].order, i + 1);
    }

    // ── POSITIVE CONTROL: shrink the counterbore's pilot and the limiting tool
    // moves with it. A panel printing a plausible constant cannot survive this.
    CHECK(doc.editFeatureArgs(4, {IrArg::valueRef(3), IrArg::num(3), IrArg::num(9), IrArg::num(4),
                                  IrArg::num(40), IrArg::num(25), IrArg::num(0)}));
    const MachiningPlan after = buildMachiningPlan(doc);
    CHECK_NEAR(after.smallestToolMm, 3.0, 1e-12);

    // A document with nothing taken away has NO operations, and says so by being
    // empty rather than by drawing a row about nothing.
    PartDocument plain;
    CHECK(plain.seed(IrValueKind::Solid, "b", "BOX",
                     {IrArg::num(10), IrArg::num(10), IrArg::num(10)}) == 1);
    const MachiningPlan none = buildMachiningPlan(plain);
    CHECK(none.empty());
    CHECK_EQ_INT(none.shapingStatements, 1);
    CHECK(!none.smallestToolKnown);
  }

  // ── D. THE DRAWING READING ────────────────────────────────────────────────
  {
    // Every label in the preferred series reads back as a ratio, and 1:1 is the
    // one a full-size drawing carries.
    CHECK_EQ_STR(scaleLabel(1.0), "1:1");
    CHECK_EQ_STR(scaleLabel(0.5), "1:2");
    CHECK_EQ_STR(scaleLabel(0.02), "1:50");
    CHECK_EQ_STR(scaleLabel(2.0), "2:1");
    CHECK(sheetSizeLibrary().size() >= 5);
    for (std::size_t i = 1; i < sheetSizeLibrary().size(); ++i) {
      // Smallest first, landscape, and each A-size is twice the area of the last.
      CHECK(sheetSizeLibrary()[i].widthMm > sheetSizeLibrary()[i - 1].widthMm);
      CHECK(sheetSizeLibrary()[i].widthMm >= sheetSizeLibrary()[i].heightMm);
      CHECK_NEAR(sheetSizeLibrary()[i].heightMm, sheetSizeLibrary()[i - 1].widthMm, 1.0);
    }
    for (std::size_t i = 1; i < drawingScaleLibrary().size(); ++i) {
      CHECK(drawingScaleLibrary()[i] < drawingScaleLibrary()[i - 1]);
      CHECK(!scaleLabel(drawingScaleLibrary()[i]).empty());
    }

    // NO PART, NO SHEET. A document that has built nothing has no views to lay
    // out, and saying so is the honest answer rather than an empty A4.
    MeasureBox nothing;
    CHECK(!buildDrawingSheets(nothing).known);
    CHECK_EQ_INT(buildDrawingSheets(nothing).rowCount(), 0);
    MeasureBox degenerate;
    degenerate.valid = true;
    CHECK(!buildDrawingSheets(degenerate).known);

    // A 100 x 50 x 20 plate. The arithmetic is written out so the answer is
    // checked against the geometry and not against the function that produced it.
    MeasureBox box;
    box.valid = true;
    box.min[0] = 0.0; box.min[1] = 0.0; box.min[2] = 0.0;
    box.max[0] = 100.0; box.max[1] = 50.0; box.max[2] = 20.0;
    const DrawingSheetSet set = buildDrawingSheets(box);
    CHECK(set.known);
    CHECK_EQ_INT(set.sheets.size(), 1);
    const DrawingSheet& s = set.sheets[0];
    CHECK_EQ_INT(s.views.size(), 4);
    CHECK_EQ_INT(set.rowCount(), 5);
    CHECK(s.fits);
    // Full size on the smallest sheet that holds it: 244.9 x 130 fits inside
    // A4's 277 x 190 drawable area.
    CHECK_EQ_STR(s.size.name, "A4");
    CHECK_NEAR(s.scale, 1.0, 1e-12);
    CHECK_EQ_STR(s.scaleLabelText, "1:1");
    CHECK_NEAR(s.drawableWidthMm, 277.0, 1e-12);
    CHECK_NEAR(s.drawableHeightMm, 190.0, 1e-12);

    // The views are the part's own extents, axis by axis.
    CHECK_EQ_STR(s.views[0].name, "Front");
    CHECK(s.views[0].view == NamedView::Front);
    CHECK_NEAR(s.views[0].widthMm, 100.0, 1e-12);   // X across, Z up
    CHECK_NEAR(s.views[0].heightMm, 20.0, 1e-12);
    CHECK_NEAR(s.views[1].widthMm, 100.0, 1e-12);   // the plan: X across, Y up
    CHECK_NEAR(s.views[1].heightMm, 50.0, 1e-12);
    CHECK_NEAR(s.views[2].widthMm, 50.0, 1e-12);    // the end view: Y across, Z up
    CHECK_NEAR(s.views[2].heightMm, 20.0, 1e-12);
    const double c30 = 0.86602540378443864676;
    CHECK_NEAR(s.views[3].widthMm, 150.0 * c30, 1e-9);
    CHECK_NEAR(s.views[3].heightMm, 150.0 * 0.5 + 20.0, 1e-9);
    for (const SheetView& v : s.views) {
      CHECK_NEAR(v.paperWidthMm, v.widthMm * s.scale, 1e-9);
      CHECK_NEAR(v.paperHeightMm, v.heightMm * s.scale, 1e-9);
    }
    // The arrangement really does fit in the space the sheet leaves.
    CHECK_NEAR(s.usedWidthMm, 100.0 + 15.0 + 150.0 * c30, 1e-9);
    CHECK_NEAR(s.usedHeightMm, (150.0 * 0.5 + 20.0) + 15.0 + 20.0, 1e-9);
    CHECK(s.usedWidthMm <= s.drawableWidthMm);
    CHECK(s.usedHeightMm <= s.drawableHeightMm);

    // ── POSITIVE CONTROL: a bigger part gets a bigger sheet AND a smaller
    // scale. The rule is scale first -- a two-metre casting is not drawn at 1:20
    // on A4 because A4 happened to come first in the table.
    MeasureBox big;
    big.valid = true;
    big.max[0] = 2000.0; big.max[1] = 1000.0; big.max[2] = 500.0;
    const DrawingSheetSet bigSet = buildDrawingSheets(big);
    CHECK(bigSet.known);
    const DrawingSheet& b = bigSet.sheets[0];
    CHECK(b.fits);
    CHECK(b.scale < s.scale);
    CHECK(b.size.widthMm > s.size.widthMm);
    CHECK_EQ_STR(b.size.name, "A0");
    CHECK_EQ_STR(b.scaleLabelText, "1:5");
    CHECK(b.usedWidthMm <= b.drawableWidthMm);
    CHECK(b.usedHeightMm <= b.drawableHeightMm);
    // and the scale chosen is the largest in the series that would fit at all:
    // one step up, nothing in the library holds it.
    const double biggerW = b.usedWidthMm / b.scale * 0.5;
    CHECK(biggerW > sheetSizeLibrary().back().widthMm - 2.0 * kSheetMarginMm);

    // Bigger than the largest sheet at the smallest preferred reduction: the
    // sheet says it does not fit rather than inventing a scale nobody draws at.
    MeasureBox vast;
    vast.valid = true;
    vast.max[0] = 4.0e7; vast.max[1] = 4.0e7; vast.max[2] = 4.0e7;
    const DrawingSheetSet vastSet = buildDrawingSheets(vast);
    CHECK(vastSet.known);
    CHECK(!vastSet.sheets[0].fits);
    CHECK_EQ_STR(vastSet.sheets[0].size.name, "A0");
  }

  // ── E. THE SIMULATION READING ─────────────────────────────────────────────
  {
    // NOTHING PICKED, and nothing built. Every study is waiting, none is answered,
    // and the shape row says what would fill it.
    const SelectionMeasure noPick;
    MeshMeasure nothing;
    const StudyPlan none = buildStudyPlan(nothing, 0.0, unassignedMaterial(), MassUnit::Gram, noPick);
    CHECK_EQ_INT(none.studies.size(), 3);
    CHECK_EQ_INT(none.answered(), 0);
    CHECK(none.rowCount() > none.studies.size());
    for (const Study& st : none.studies) {
      CHECK(st.state == StudyState::Waiting);
      CHECK(st.answer.empty());
      CHECK(st.missing >= 1);
      CHECK(!st.solvesFor.empty());
      CHECK(st.setup[0].state == StudyItemState::Missing);
    }

    // AN OPEN SURFACE IS NOT A MISSING ONE. Something is there and it cannot be
    // used, and the difference is what a user has to do next.
    MeshMeasure open;
    open.triangles = 40;
    open.watertight = false;
    open.boundaryEdges = 6;
    open.nonManifoldEdges = 1;
    const StudyPlan stopped = buildStudyPlan(open, 0.0, unassignedMaterial(), MassUnit::Gram, noPick);
    for (const Study& st : stopped.studies) {
      CHECK(st.state == StudyState::Stopped);
      CHECK_EQ_INT(st.blocked, 1);
      CHECK(st.setup[0].state == StudyItemState::Blocked);
      CHECK(contains(st.setup[0].evidence, "6 edges are used once"));
    }
    CHECK_EQ_INT(stopped.answered(), 0);

    // A CLOSED SHAPE. The balance point of a homogeneous body is its volume
    // centroid and needs no material at all, so THAT study is answered while the
    // two that need a material are still waiting.
    MeshMeasure solid;
    solid.triangles = 12;
    solid.faces = 6;
    solid.watertight = true;
    solid.volume = 8000.0;
    solid.centroid[0] = 10.0;
    solid.centroid[1] = 20.0;
    solid.centroid[2] = 5.0;
    const StudyPlan geo = buildStudyPlan(solid, 0.0, unassignedMaterial(), MassUnit::Gram, noPick);
    CHECK_EQ_INT(geo.answered(), 1);
    CHECK(geo.studies[0].state == StudyState::Answered);
    CHECK(contains(geo.studies[0].answer, "10.000, 20.000, 5.000 mm"));
    CHECK(contains(geo.studies[0].answer, "8000.000 mm3"));
    CHECK(contains(geo.studies[0].setup[0].evidence, "measured from the shape as drawn"));
    CHECK(geo.studies[1].state == StudyState::Waiting);
    CHECK_EQ_INT(geo.studies[1].missing, 1);
    // "not set" carries the size of the answer it is holding up, from the library
    // this application already ships.
    CHECK(contains(geo.studies[1].setup[1].evidence, "no material chosen yet"));
    CHECK(contains(geo.studies[1].setup[1].evidence, "kg/m3"));
    CHECK(geo.studies[2].state == StudyState::Waiting);
    CHECK_EQ_INT(geo.studies[2].missing, 3);

    // ── POSITIVE CONTROL: name a material and the study stops waiting and
    // answers, with the weight that material and this volume actually give.
    const Material* alu = findMaterial("aluminium-6061");
    CHECK(alu != nullptr);
    if (alu != nullptr) {
      const StudyPlan weighed = buildStudyPlan(solid, 0.0, *alu, MassUnit::Gram, noPick);
      CHECK_EQ_INT(weighed.answered(), 2);
      CHECK(weighed.studies[1].state == StudyState::Answered);
      CHECK_EQ_INT(weighed.studies[1].missing, 0);
      CHECK_EQ_STR(weighed.studies[1].answer,
                   describeMass(massPropertiesOf(*alu, 8000.0), MassUnit::Gram));
      CHECK(contains(weighed.studies[1].setup[1].evidence, alu->name));
      // The stress study is still waiting on three inputs no material supplies.
      CHECK(weighed.studies[2].state == StudyState::Waiting);
      CHECK_EQ_INT(weighed.studies[2].missing, 3);
    }

    // The KERNEL's exact volume is preferred when it has one, and the row says
    // which instrument answered -- a number whose source is unstated is a number
    // nobody can check.
    const StudyPlan exact = buildStudyPlan(solid, 7999.5, unassignedMaterial(), MassUnit::Gram, noPick);
    CHECK(contains(exact.studies[0].answer, "7999.500 mm3"));
    CHECK(contains(exact.studies[0].setup[0].evidence, "measured exactly"));

    // ── POSITIVE CONTROL: the two face inputs READ THE LIVE SELECTION ─────
    // Nothing is applied either way -- both rows stay Missing -- but "nothing
    // holds this part still" and "two faces are picked and none of them is
    // holding it" are different sentences, and only the second tells a user what
    // to do next. A row that printed one constant could not pass this.
    SelectionMeasure twoFaces;
    twoFaces.faces = 2;
    twoFaces.area = 1250.0;
    const StudyPlan withPick = buildStudyPlan(solid, 0.0, unassignedMaterial(), MassUnit::Gram,
                                              twoFaces);
    CHECK_EQ_INT(withPick.studies.size(), 3);
    CHECK(withPick.studies[2].state == StudyState::Waiting);
    CHECK_EQ_INT(withPick.studies[2].missing, 3);
    CHECK_EQ_INT(withPick.studies[2].setup.size(), 4);
    CHECK(withPick.studies[2].setup[2].state == StudyItemState::Missing);
    CHECK(contains(withPick.studies[2].setup[2].evidence, "2 faces are picked"));
    CHECK(contains(withPick.studies[2].setup[2].evidence, "1250.000 mm2"));
    CHECK(contains(withPick.studies[2].setup[3].evidence, "2 faces are picked"));
    CHECK(withPick.studies[2].setup[2].evidence != geo.studies[2].setup[2].evidence);
    // One face is one face, not "1 faces".
    SelectionMeasure oneFace;
    oneFace.faces = 1;
    oneFace.area = 40.0;
    const StudyPlan single = buildStudyPlan(solid, 0.0, unassignedMaterial(), MassUnit::Gram,
                                            oneFace);
    CHECK(contains(single.studies[2].setup[2].evidence, "1 face is picked"));

    // Every state has a reading, and none of them is empty.
    CHECK(std::string(toString(StudyItemState::Ready)) != "");
    CHECK(std::string(toString(StudyItemState::Missing)) != "");
    CHECK(std::string(toString(StudyItemState::Blocked)) != "");
    CHECK(std::string(toString(StudyState::Answered)) != "");
    CHECK(std::string(toString(StudyState::Waiting)) != "");
    CHECK(std::string(toString(StudyState::Stopped)) != "");
    CHECK(std::string(placementWord(PlacementKind::RepeatedInGrid)) != "");
    CHECK(std::string(machiningWord(MachiningKind::Counterbore)) != "");
  }

  return H.finish();
}
