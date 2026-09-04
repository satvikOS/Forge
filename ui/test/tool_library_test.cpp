// ui/test/tool_library_test.cpp
//
// WHAT THE TOOLS TAB SHOWS, AND WHAT IT REFUSES TO SHOW.
//
// The Manufacturing workspace's Tools tab drew nothing, and the sentence beside
// it promised "diameters, flute counts and holders" -- two of which nothing in
// this repository knows. So the panel answers the third, which is the one that
// decides the job, and the catalogue sentence was corrected to say so.
//
// Every number here is arithmetic on the document's own arguments, through
// MachiningPlan. The checks are of three kinds:
//
//   A. THE ARGUMENT POSITIONS ARE RE-DERIVED FROM THE KERNEL HEADER, so "the
//      second number of a counterbore is the opened diameter" stays a fact about
//      forge-kernel/include/forge/ft/FeatureTree.hpp rather than this file's
//      memory of it.
//   B. the census is TOTAL: every operation either names a cutter or is counted
//      as naming none.
//   C. POSITIVE CONTROLS: edit the document and the tools must follow.
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
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/ToolLibrary.hpp"
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

bool contains(const std::string& hay, const std::string& needle) {
  return hay.find(needle) != std::string::npos;
}

int append(PartDocument& doc, const char* op, std::vector<IrArg> args, IrValueKind kind,
           const char* label, const std::vector<std::string>& consumed) {
  FeatureRecord r;
  r.irId = doc.nextIrId();
  r.label = label;
  r.produces = kind;
  r.line.id = r.irId;
  r.line.op = op;
  r.line.args = std::move(args);
  return doc.appendFeature(r, consumed, std::string()) ? r.irId : 0;
}

// Rewrites ONE numeric argument through the receiver's own edit path, so a
// fixture that violates a document rule fails as a fixture rather than as an
// unexplained answer.
bool editNumber(PartDocument& doc, int irId, std::size_t at, double value) {
  const FeatureRecord* rec = doc.featureAt(irId);
  if (rec == nullptr || at >= rec->line.args.size()) return false;
  std::vector<IrArg> args = rec->line.args;
  if (args[at].kind != IrArgKind::Number) return false;
  args[at] = IrArg::num(value);
  return doc.editFeatureArgs(irId, args);
}

const RequiredTool* toolOf(const ToolList& list, CutterKind kind, double diameter) {
  for (const RequiredTool& t : list.tools) {
    if (t.kind != kind) continue;
    if (!t.diameterKnown) continue;
    if (std::fabs(t.diameterMm - diameter) > 1e-6) continue;
    return &t;
  }
  return nullptr;
}

}  // namespace

int main() {
  Harness H("tool_library");
  const std::string root = repoRoot();

  // ── A. THE COUNTERBORE'S TWO DIAMETERS ARE THE KERNEL'S OWN ARGUMENTS ────
  {
    bool ok = false;
    const std::string kernel =
        readFile(root + "/forge-kernel/include/forge/ft/FeatureTree.hpp", ok);
    if (!ok) std::printf("  cannot read the kernel op table -- nothing to derive from\n");
    CHECK(ok);
    if (ok) {
      // The documented form is written as a trailing comment on the op table
      // row. A counterbore's FIRST number is the pilot and its SECOND is the
      // opened diameter, and that order is what this file relies on.
      const std::size_t at = kernel.find("CBORE(%body,");
      if (at == std::string::npos) {
        std::printf("  the kernel header no longer documents a counterbore in the form this "
                    "reading assumes\n");
      }
      CHECK(at != std::string::npos);
      if (at != std::string::npos) {
        const std::size_t eol = kernel.find('\n', at);
        const std::string form = kernel.substr(at, eol - at);
        const std::size_t dia = form.find("dia");
        const std::size_t cdia = form.find("cboreDia");
        const std::size_t cdepth = form.find("cboreDepth");
        CHECK(dia != std::string::npos);
        CHECK(cdia != std::string::npos);
        CHECK(cdepth != std::string::npos);
        CHECK(dia < cdia);
        CHECK(cdia < cdepth);
      }
    }
  }

  // ── A PART WITH SOMETHING TO CUT ────────────────────────────────────────
  //
  //   RECT + EXTRUDE            shaping, no cutter
  //   HOLE  10 mm, 12 deep      a 10 mm drill
  //   HOLE  10 mm, through      the SAME drill, and it cuts through
  //   HOLE   6 mm, 8 deep       a 6 mm drill
  //   CBORE 10 through, opened to 18 for 5    the same 10 mm drill AND an 18 mm end mill
  //   FILLET r3                 a 6 mm end mill (an internal corner of r is cut by 2r)
  //   CHAMFER 1                 a chamfer tool, and it names no size
  //   SHELL 2                   no cutter named at all
  {
    PartDocument doc;
    const int profile = append(doc, "RECT", {IrArg::num(80.0), IrArg::num(50.0)},
                               IrValueKind::Profile, "Base", {});
    const int body = append(doc, "EXTRUDE", {IrArg::valueRef(profile), IrArg::num(20.0)},
                            IrValueKind::Solid, "Plate", {});
    CHECK(profile != 0 && body != 0);
    const int h1 = append(doc, "HOLE",
                          {IrArg::valueRef(body), IrArg::num(10.0), IrArg::num(0.0),
                           IrArg::num(0.0), IrArg::num(0.0), IrArg::num(0.0), IrArg::num(0.0),
                           IrArg::num(1.0), IrArg::num(12.0)},
                          IrValueKind::Solid, "Blind Hole", {});
    const int h2 = append(doc, "HOLE",
                          {IrArg::valueRef(h1), IrArg::num(10.0), IrArg::num(20.0),
                           IrArg::num(0.0), IrArg::num(0.0)},
                          IrValueKind::Solid, "Through Hole", {});
    const int h3 = append(doc, "HOLE",
                          {IrArg::valueRef(h2), IrArg::num(6.0), IrArg::num(-20.0),
                           IrArg::num(0.0), IrArg::num(0.0), IrArg::num(0.0), IrArg::num(0.0),
                           IrArg::num(1.0), IrArg::num(8.0)},
                          IrValueKind::Solid, "Small Hole", {});
    const int cb = append(doc, "CBORE",
                          {IrArg::valueRef(h3), IrArg::num(10.0), IrArg::num(18.0),
                           IrArg::num(5.0), IrArg::num(0.0), IrArg::num(20.0), IrArg::num(0.0)},
                          IrValueKind::Solid, "Counterbore", {});
    const int fil = append(doc, "FILLET", {IrArg::valueRef(cb), IrArg::num(3.0)},
                           IrValueKind::Solid, "Corner Fillet", {});
    const int cha = append(doc, "CHAMFER", {IrArg::valueRef(fil), IrArg::num(1.0)},
                           IrValueKind::Solid, "Edge Break", {});
    const int sh = append(doc, "SHELL", {IrArg::valueRef(cha), IrArg::num(2.0)},
                          IrValueKind::Solid, "Hollow", {});
    CHECK(h1 != 0 && h2 != 0 && h3 != 0 && cb != 0 && fil != 0 && cha != 0 && sh != 0);

    const MachiningPlan plan = buildMachiningPlan(doc);
    CHECK_EQ_INT(plan.operations.size(), 7);
    CHECK_EQ_INT(plan.shapingStatements, 2);
    const ToolList list = buildToolList(plan);
    CHECK(list.known);

    // THE CENSUS IS TOTAL. Every operation is either recorded against a cutter
    // or counted as naming none, and no operation is recorded twice against the
    // same cutter.
    std::size_t recorded = 0;
    for (const RequiredTool& t : list.tools) recorded += t.uses();
    // The counterbore is recorded against TWO cutters, which is why this is not
    // a plain equality: it is one operation and two tools.
    CHECK_EQ_INT(recorded, plan.operations.size() - list.operationsWithNoCutter + 1);
    // SHELL is the only cut here that names no cutter at all.
    CHECK_EQ_INT(list.operationsWithNoCutter, 1);
    for (const RequiredTool& t : list.tools) {
      CHECK(t.uses() >= 1);
      for (std::size_t at : t.operations) CHECK(at < plan.operations.size());
    }

    // Four cutters: a 6 mm drill, a 10 mm drill, a 6 mm end mill, an 18 mm end
    // mill, and a chamfer tool with no size.
    CHECK_EQ_INT(list.tools.size(), 5);
    CHECK_EQ_INT(list.sizedTools, 4);

    const RequiredTool* drill10 = toolOf(list, CutterKind::Drill, 10.0);
    CHECK(drill10 != nullptr);
    if (drill10 != nullptr) {
      // Two holes and the counterbore's pilot all take the same drill, which is
      // the whole point of a tool list.
      CHECK_EQ_INT(drill10->uses(), 3);
      CHECK(drill10->cutsThrough);
      // The deepest it must reach is the 12 mm blind hole; the through hole and
      // the counterbore's pilot give no depth at all and must not be read as
      // zero.
      CHECK(drill10->depthKnown);
      CHECK_NEAR(drill10->deepestCutMm, 12.0, 1e-9);
      CHECK(contains(drill10->name, "drill"));
      CHECK(contains(drill10->name, "10"));
    }
    const RequiredTool* drill6 = toolOf(list, CutterKind::Drill, 6.0);
    CHECK(drill6 != nullptr);
    if (drill6 != nullptr) {
      CHECK_EQ_INT(drill6->uses(), 1);
      CHECK(!drill6->cutsThrough);
      CHECK(drill6->depthKnown);
      CHECK_NEAR(drill6->deepestCutMm, 8.0, 1e-9);
    }
    // An internal corner of radius 3 is cut by a tool of diameter 6.
    const RequiredTool* endMill6 = toolOf(list, CutterKind::EndMill, 6.0);
    CHECK(endMill6 != nullptr);
    if (endMill6 != nullptr) {
      CHECK_EQ_INT(endMill6->uses(), 1);
      CHECK(contains(endMill6->name, "end mill"));
    }
    // The counterbore's OWN second diameter, which is the one a setup sheet
    // without it would be short by.
    const RequiredTool* endMill18 = toolOf(list, CutterKind::EndMill, 18.0);
    CHECK(endMill18 != nullptr);
    if (endMill18 != nullptr) {
      CHECK_EQ_INT(endMill18->uses(), 1);
      CHECK(endMill18->depthKnown);
      CHECK_NEAR(endMill18->deepestCutMm, 5.0, 1e-9);
    }
    // A 6 mm drill and a 6 mm end mill are two different tools at one size, and
    // a list that merged them would send a machinist one cutter short.
    CHECK(drill6 != endMill6);

    // The chamfer names a TOOL and no size, which is a different fact from
    // naming neither.
    bool sawChamfer = false;
    for (const RequiredTool& t : list.tools) {
      if (t.kind != CutterKind::ChamferTool) continue;
      sawChamfer = true;
      CHECK(!t.diameterKnown);
      CHECK_EQ_INT(t.uses(), 1);
    }
    CHECK(sawChamfer);

    // SMALLEST FIRST, and the unsized one last.
    CHECK(list.smallestKnown);
    CHECK_NEAR(list.smallestMm, 6.0, 1e-9);
    CHECK(list.largestKnown);
    CHECK_NEAR(list.largestMm, 18.0, 1e-9);
    CHECK(list.deepestKnown);
    CHECK_NEAR(list.deepestMm, 12.0, 1e-9);
    for (std::size_t i = 1; i < list.tools.size(); ++i) {
      const RequiredTool& a = list.tools[i - 1];
      const RequiredTool& b = list.tools[i];
      if (a.diameterKnown && b.diameterKnown) CHECK(a.diameterMm <= b.diameterMm);
      if (!a.diameterKnown) CHECK(!b.diameterKnown);
    }
    // The smallest cutter the list names is the one the whole plan is limited
    // by, and MachiningPlan computes that independently. The two instruments
    // must agree.
    CHECK(plan.smallestToolKnown);
    CHECK_NEAR(list.smallestMm, plan.smallestToolMm, 1e-9);

    // ── C. THE POSITIVE CONTROLS ───────────────────────────────────────────
    // 1. Grow the fillet and the end mill it calls for grows with it. Nothing
    //    that printed a constant survives this.
    {
      PartDocument again = doc;
      CHECK(editNumber(again, fil, 1, 5.0));
      const ToolList after = buildToolList(buildMachiningPlan(again));
      CHECK(toolOf(after, CutterKind::EndMill, 6.0) == nullptr);
      const RequiredTool* grown = toolOf(after, CutterKind::EndMill, 10.0);
      CHECK(grown != nullptr);
      // and the limiting tool is now the 6 mm drill, which did not move.
      CHECK(after.smallestKnown);
      CHECK_NEAR(after.smallestMm, 6.0, 1e-9);
    }

    // 2. Shrink the small hole below every other cutter and the limiting tool
    //    follows it.
    {
      PartDocument again = doc;
      CHECK(editNumber(again, h3, 1, 3.0));
      const ToolList after = buildToolList(buildMachiningPlan(again));
      CHECK(after.smallestKnown);
      CHECK_NEAR(after.smallestMm, 3.0, 1e-9);
      CHECK(toolOf(after, CutterKind::Drill, 3.0) != nullptr);
      CHECK(toolOf(after, CutterKind::Drill, 6.0) == nullptr);
    }

    // 3. Make the second hole the same size as the small one and the two drills
    //    become ONE row used twice. A list that keyed on the operation rather
    //    than the size would still show two.
    {
      PartDocument again = doc;
      CHECK(editNumber(again, h2, 1, 6.0));
      const ToolList after = buildToolList(buildMachiningPlan(again));
      const RequiredTool* merged = toolOf(after, CutterKind::Drill, 6.0);
      CHECK(merged != nullptr);
      if (merged != nullptr) {
        CHECK_EQ_INT(merged->uses(), 2);
        CHECK(merged->cutsThrough);
        CHECK(merged->depthKnown);
        CHECK_NEAR(merged->deepestCutMm, 8.0, 1e-9);
      }
      // The 10 mm drill is still there -- the blind hole and the counterbore's
      // pilot still need it -- so the list is the same length with one row used
      // twice, which is exactly the merge and not a lost tool.
      CHECK_EQ_INT(after.tools.size(), 5);
      const RequiredTool* stillTen = toolOf(after, CutterKind::Drill, 10.0);
      CHECK(stillTen != nullptr);
      if (stillTen != nullptr) CHECK_EQ_INT(stillTen->uses(), 2);
    }
  }

  // ── A PART WITH NOTHING TO CUT NEEDS NO CUTTERS, AND SAYS SO ────────────
  {
    PartDocument doc;
    const int profile = append(doc, "RECT", {IrArg::num(10.0), IrArg::num(10.0)},
                               IrValueKind::Profile, "Base", {});
    const int body = append(doc, "EXTRUDE", {IrArg::valueRef(profile), IrArg::num(5.0)},
                            IrValueKind::Solid, "Block", {});
    CHECK(profile != 0 && body != 0);
    const ToolList list = buildToolList(buildMachiningPlan(doc));
    CHECK(!list.known);
    CHECK_EQ_INT(list.tools.size(), 0);
    CHECK(!list.smallestKnown);
    CHECK(!list.deepestKnown);
  }

  // ── A BOOLEAN CUT NAMES NO CUTTER, AND IS COUNTED RATHER THAN DROPPED ───
  {
    PartDocument doc;
    const int profile = append(doc, "RECT", {IrArg::num(20.0), IrArg::num(20.0)},
                               IrValueKind::Profile, "Base", {});
    const int body = append(doc, "EXTRUDE", {IrArg::valueRef(profile), IrArg::num(10.0)},
                            IrValueKind::Solid, "Block", {});
    const int tool = append(doc, "CYL",
                            {IrArg::num(3.0), IrArg::num(20.0), IrArg::num(0.0), IrArg::num(0.0),
                             IrArg::num(-5.0)},
                            IrValueKind::Solid, "Bore Tool", {});
    const int cut = append(doc, "CUT", {IrArg::valueRef(body), IrArg::valueRef(tool)},
                           IrValueKind::Solid, "Bore", {});
    CHECK(profile != 0 && body != 0 && tool != 0 && cut != 0);
    const MachiningPlan plan = buildMachiningPlan(doc);
    CHECK_EQ_INT(plan.operations.size(), 1);
    const ToolList list = buildToolList(plan);
    CHECK(list.known);
    CHECK_EQ_INT(list.tools.size(), 0);
    CHECK_EQ_INT(list.operationsWithNoCutter, 1);
    CHECK(!list.smallestKnown);
  }

  return H.finish();
}
