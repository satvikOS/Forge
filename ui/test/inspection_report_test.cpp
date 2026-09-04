// ui/test/inspection_report_test.cpp
//
// THE ARITHMETIC BEHIND FOUR PANELS THAT USED TO SHOW NOTHING.
//
// 27 of the 50 panels the eight default workspaces define drew no content. The
// obvious repair is to write numbers into the frame builder — which CI compiles
// and never RUNS, so a number invented there is a number nothing can contradict.
// forge::ui::InspectionReport exists so that cannot happen, and this file is the
// reason it cannot: every quantity those panels print is asserted here against a
// CLOSED FORM on a unit cube, not against whatever the code happened to return.
//
// The cases that matter most are the DISAGREEMENTS. A cross-check between the
// modelling kernel and the drawn surface is only worth having if it can say NO,
// so each of the five verdicts is driven to Fail with a mesh or a report that
// really is wrong — a lost face, a box that overhangs, an open surface, an
// inside-out one, a feature that never compiled.
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/InspectionReport.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

void corner(int index, double o, double s, double out[3]) {
  out[0] = o + ((index & 1) != 0 ? s : 0.0);
  out[1] = o + ((index & 2) != 0 ? s : 0.0);
  out[2] = o + ((index & 4) != 0 ? s : 0.0);
}

// The 12 outward-wound triangles of the axis-aligned box [o, o+s]^3, face ids
// 1..6. `skipFace` drops both triangles of one face (an open surface, and one
// face fewer than the kernel reported); `flipTriangle` reverses one winding.
MeasureMesh box(double o, double s, std::uint32_t skipFace = 0, int flipTriangle = -1) {
  static const int kQuads[6][4] = {
      {0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5},
  };
  MeasureMesh mesh;
  int written = 0;
  for (int f = 0; f < 6; ++f) {
    const std::uint32_t faceId = static_cast<std::uint32_t>(f + 1);
    if (faceId == skipFace) continue;
    const int tri[2][3] = {{kQuads[f][0], kQuads[f][1], kQuads[f][2]},
                           {kQuads[f][0], kQuads[f][2], kQuads[f][3]}};
    for (int t = 0; t < 2; ++t) {
      double p[3][3];
      for (int v = 0; v < 3; ++v) corner(tri[t][v], o, s, p[v]);
      if (written == flipTriangle) {
        mesh.addTriangle(p[0], p[2], p[1], faceId);
      } else {
        mesh.addTriangle(p[0], p[1], p[2], faceId);
      }
      ++written;
    }
  }
  return mesh;
}

// The kernel's report for that same unit cube, as the frame builder would fill
// it: 6 faces, 12 edges, volume 1, box [0,1]^3, three features all compiled.
KernelSolidReport cubeReport() {
  KernelSolidReport k;
  k.built = true;
  k.valid = true;
  k.faceCount = 6;
  k.edgeCount = 12;
  k.volumeMm3 = 1.0;
  k.bboxKnown = true;
  for (std::size_t a = 0; a < 3; ++a) {
    k.bboxMin[a] = 0.0;
    k.bboxMax[a] = 1.0;
  }
  k.declared = 3;
  k.parsed = 3;
  k.compiled = 3;
  return k;
}

const InspectionCheck* find(const InspectionReport& r, const std::string& name) {
  for (const InspectionCheck& c : r.checks) {
    if (c.name == name) return &c;
  }
  return nullptr;
}

CheckState stateOf(const InspectionReport& r, const std::string& name) {
  const InspectionCheck* c = find(r, name);
  // A missing check is NOT reported as Unavailable: that is the state a real
  // check takes when it cannot run, and conflating the two would let a check
  // this file asserts on quietly disappear.
  return c == nullptr ? CheckState::Fail : c->state;
}

FeatureRecord rec(int id, const char* op, std::vector<IrArg> args, const char* label = "") {
  FeatureRecord r;
  r.irId = id;
  r.label = label;
  r.line.id = id;
  r.line.op = op;
  r.line.args = std::move(args);
  return r;
}

const char* kAllChecks[] = {
    "Every feature was built", "The part rebuilt", "The solid is sound",
    "The surface on screen closes", "The surface faces outward",
    "The picture shows every face", "The drawn shape fits the reported size",
    "Volume, measured two ways", "Every step is well formed",
};

}  // namespace

int main() {
  Harness H("inspection_report");

  const std::vector<FeatureRecord> program = {
      rec(1, "BOX", {IrArg::num(80), IrArg::num(50), IrArg::num(20)}, "Box"),
      rec(2, "FILLET", {IrArg::valueRef(1), IrArg::num(2.5), IrArg::keyword("ALL")}, "Fillet"),
  };

  // ── 1. THE CLEAN CASE: two instruments, one shape, nothing contradicted ───
  {
    const MeasureMesh cube = box(0.0, 1.0);
    const MeshMeasure m = measureMesh(cube);
    // The reference the whole file rests on: the mesh really is a closed unit
    // cube. If this is wrong every verdict below is measuring the wrong thing.
    CHECK(m.watertight);
    CHECK(m.outward);
    CHECK_EQ_INT(m.faces, 6);
    CHECK_NEAR(m.volume, 1.0, 1e-12);

    const InspectionReport r = buildInspectionReport(cubeReport(), m, program);
    CHECK(r.clean());
    CHECK_EQ_INT(r.failed, 0);
    // Every named check is present. A report that silently stopped emitting one
    // would leave a panel row blank and this file green.
    for (const char* name : kAllChecks) CHECK(find(r, name) != nullptr);
    CHECK_EQ_INT(r.checks.size(), 9);
    CHECK_EQ_INT(r.passed + r.failed + r.unavailable + r.informational, r.checks.size());
    CHECK_EQ_INT(r.answered(), 8);
    CHECK_EQ_INT(r.informational, 1);
    CHECK(stateOf(r, "The surface on screen closes") == CheckState::Pass);
    CHECK(stateOf(r, "The picture shows every face") == CheckState::Pass);
    CHECK(stateOf(r, "The drawn shape fits the reported size") == CheckState::Pass);
    CHECK(stateOf(r, "Volume, measured two ways") == CheckState::Informational);
    // The exact volume and the drawn volume agree on a box, so the reported
    // difference is zero -- and it is printed WITHOUT a sign, because a
    // difference of -1e-14% shown as "-0.0000%" reads as a shortfall.
    const InspectionCheck* vol = find(r, "Volume, measured two ways");
    CHECK(vol != nullptr && vol->evidence.find("(0.0000%)") != std::string::npos);
  }

  // ── 2. A FACE THE PICTURE LOST ────────────────────────────────────────────
  // The kernel still says six faces; the drawing has five and does not close.
  // This is the failure a single reported number cannot expose, and BOTH the
  // independent closure check and the face-count cross-check must catch it.
  {
    const MeshMeasure m = measureMesh(box(0.0, 1.0, /*skipFace=*/3));
    CHECK(!m.watertight);
    CHECK_EQ_INT(m.faces, 5);
    const InspectionReport r = buildInspectionReport(cubeReport(), m, program);
    CHECK(!r.clean());
    CHECK(stateOf(r, "The surface on screen closes") == CheckState::Fail);
    CHECK(stateOf(r, "The picture shows every face") == CheckState::Fail);
    // The kernel said the solid was sound and it is still reported as sound:
    // the point of the second instrument is that it disagrees WITHOUT the
    // kernel's help, not that it rewrites the kernel's own claim.
    CHECK(stateOf(r, "The solid is sound") == CheckState::Pass);
    // An open surface has no volume, so the comparison must refuse rather than
    // print the meaningless number measureMesh() would still hold.
    CHECK(stateOf(r, "Volume, measured two ways") == CheckState::Unavailable);
    // The outward check is not answerable on an open surface and must not be
    // counted as a pass.
    CHECK(find(r, "The surface faces outward") == nullptr);
  }

  // ── 3. AN INSIDE-OUT SURFACE ──────────────────────────────────────────────
  {
    MeasureMesh flipped;
    const MeasureMesh cube = box(0.0, 1.0);
    // Reverse every triangle: still closed, still 6 faces, wound the wrong way.
    const std::vector<double>& xyz = cube.coords();
    const std::vector<std::uint32_t>& ids = cube.faceIds();
    for (std::size_t t = 0; t < ids.size(); ++t) {
      const double* p = &xyz[t * 9];
      const double a[3] = {p[0], p[1], p[2]};
      const double b[3] = {p[3], p[4], p[5]};
      const double c[3] = {p[6], p[7], p[8]};
      flipped.addTriangle(a, c, b, ids[t]);
    }
    const MeshMeasure m = measureMesh(flipped);
    CHECK(m.watertight);
    CHECK(!m.outward);
    const InspectionReport r = buildInspectionReport(cubeReport(), m, program);
    CHECK(!r.clean());
    CHECK(stateOf(r, "The surface faces outward") == CheckState::Fail);
    CHECK(stateOf(r, "The surface on screen closes") == CheckState::Pass);
  }

  // ── 4. THE DRAWING DOES NOT FIT THE REPORTED SIZE ─────────────────────────
  // Every drawn vertex is a point ON the shape, so the drawing may fall short of
  // the reported box but can never exceed it. A drawing that does is not the
  // shape that was reported.
  {
    const MeshMeasure m = measureMesh(box(0.0, 1.0));
    KernelSolidReport k = cubeReport();
    k.bboxMax[0] = 0.5;   // the kernel claims half the width the drawing has
    const InspectionReport r = buildInspectionReport(k, m, program);
    CHECK(stateOf(r, "The drawn shape fits the reported size") == CheckState::Fail);
    const InspectionCheck* c = find(r, "The drawn shape fits the reported size");
    CHECK(c != nullptr && c->evidence.find("0.500000 mm outside") != std::string::npos);
  }
  {
    // A drawing that falls SHORT by more than the slack is exactly what a curved
    // face does, and must stay a pass.
    const MeshMeasure m = measureMesh(box(0.0, 1.0));
    KernelSolidReport k = cubeReport();
    k.bboxMax[0] = 1.2;   // the kernel's box is larger than the chorded drawing
    const InspectionReport r = buildInspectionReport(k, m, program);
    CHECK(stateOf(r, "The drawn shape fits the reported size") == CheckState::Pass);
  }
  {
    // And the slack really is a slack: a hair over the reported box passes, a
    // hair under the tolerance being the whole point of stating it.
    const MeshMeasure m = measureMesh(box(0.0, 1.0));
    KernelSolidReport k = cubeReport();
    k.bboxMax[0] = 1.0 - 0.5 * kInspectionBoxSlackFraction;
    const InspectionReport r = buildInspectionReport(k, m, program);
    CHECK(stateOf(r, "The drawn shape fits the reported size") == CheckState::Pass);
  }

  // ── 5. A FEATURE THAT NEVER COMPILED ──────────────────────────────────────
  // The s0.4 failure: a statement declared and parsed but not built is a missing
  // feature reported as a built part.
  {
    const MeshMeasure m = measureMesh(box(0.0, 1.0));
    KernelSolidReport k = cubeReport();
    k.compiled = 2;   // three asked for, two built
    const InspectionReport r = buildInspectionReport(k, m, program);
    CHECK(!r.clean());
    CHECK(stateOf(r, "Every feature was built") == CheckState::Fail);
    const InspectionCheck* c = find(r, "Every feature was built");
    CHECK(c != nullptr && c->evidence.find("3 asked for") != std::string::npos);
  }

  // ── 6. NOTHING BUILT AT ALL ───────────────────────────────────────────────
  // Every check that cannot be answered must say Unavailable. A report of
  // "0 failures" over checks that never ran is the shape this state exists to
  // prevent, so `answered()` is asserted, not just `clean()`.
  {
    KernelSolidReport k;
    k.declared = 0;
    const MeshMeasure m{};
    const InspectionReport r = buildInspectionReport(k, m, {});
    CHECK_EQ_INT(r.failed, 1);          // "The part rebuilt" is a real failure
    CHECK_EQ_INT(r.passed, 0);
    CHECK(stateOf(r, "The part rebuilt") == CheckState::Fail);
    CHECK(find(r, "The solid is sound") == nullptr);
    CHECK(stateOf(r, "Every feature was built") == CheckState::Unavailable);
    CHECK(stateOf(r, "The surface on screen closes") == CheckState::Unavailable);
    CHECK(stateOf(r, "The picture shows every face") == CheckState::Unavailable);
    CHECK(stateOf(r, "Volume, measured two ways") == CheckState::Unavailable);
    CHECK(stateOf(r, "Every step is well formed") == CheckState::Unavailable);
  }

  // ── 7. A STATEMENT THE DOCUMENT CANNOT READ ───────────────────────────────
  {
    const MeshMeasure m = measureMesh(box(0.0, 1.0));
    std::vector<FeatureRecord> bad = program;
    // A forward reference: "%2 = FILLET(%3, ...)" can never resolve, which
    // validateIr() states as a rule of the grammar rather than a house style.
    bad[1].line.args[0] = IrArg::valueRef(3);
    CHECK(validateIr(bad[1].line) != IrCheck::Ok);
    const InspectionReport r = buildInspectionReport(cubeReport(), m, bad);
    CHECK(stateOf(r, "Every step is well formed") == CheckState::Fail);
  }

  // ── 8. THE DRIVING DIMENSIONS ─────────────────────────────────────────────
  // The index a row carries must be the index part.edit_feature means, or a
  // panel shows one number and rewrites another.
  {
    const std::vector<DimensionRow> rows = collectDrivingDimensions(program);
    CHECK_EQ_INT(rows.size(), 4);            // 3 from BOX, 1 from FILLET
    CHECK_EQ_INT(rows[0].irId, 1);
    CHECK_EQ_STR(rows[0].op, "BOX");
    CHECK_EQ_INT(rows[0].numberIndex, 0);
    CHECK_EQ_INT(rows[0].argSlot, 0);
    CHECK_NEAR(rows[0].value, 80.0, 1e-12);
    CHECK_NEAR(rows[2].value, 20.0, 1e-12);
    // FILLET's radius is its SECOND argument and its FIRST number. That gap is
    // the entire reason this rule exists in one place.
    CHECK_EQ_INT(rows[3].irId, 2);
    CHECK_EQ_STR(rows[3].op, "FILLET");
    CHECK_EQ_INT(rows[3].numberIndex, 0);
    CHECK_EQ_INT(rows[3].argSlot, 1);
    CHECK_NEAR(rows[3].value, 2.5, 1e-12);
    CHECK_EQ_STR(rows[3].label, "Fillet");
    CHECK_EQ_INT(statementsWithoutDimensions(program), 0);

    // A statement with no number contributes NO row. A row reading 0 would be a
    // dimension the document never had.
    std::vector<FeatureRecord> withCut = program;
    withCut.push_back(rec(3, "CUT", {IrArg::valueRef(2), IrArg::valueRef(1)}, "Cut"));
    CHECK_EQ_INT(collectDrivingDimensions(withCut).size(), 4);
    CHECK_EQ_INT(statementsWithoutDimensions(withCut), 1);
    CHECK_EQ_INT(collectDrivingDimensions({}).size(), 0);

    // The two shared helpers, on the same statement, in both directions.
    CHECK_EQ_INT(numericArgCount(program[1].line.args), 1);
    CHECK_EQ_INT(numericArgSlot(program[1].line.args, 0), 1);
    // Out of range answers args.size() and never wraps to a real slot.
    CHECK_EQ_INT(numericArgSlot(program[1].line.args, 1), program[1].line.args.size());
    CHECK_EQ_INT(numericArgSlot({}, 0), 0);
  }

  // ── 9. WHAT IT WOULD WEIGH ────────────────────────────────────────────────
  // Closed form: 1000 mm^3 of 2700 kg/m^3 aluminium is 2.7 g.
  {
    const std::vector<MassRow> table = massTable(1000.0);
    CHECK(!table.empty());
    // One row per library material that has a density, and no row for the one
    // that does not.
    std::size_t withDensity = 0;
    for (const Material& m : materialLibrary()) {
      if (m.hasDensity()) ++withDensity;
    }
    CHECK_EQ_INT(table.size(), withDensity);
    CHECK(withDensity + 1 == materialLibrary().size());

    bool sawAluminium = false;
    for (const MassRow& row : table) {
      CHECK(row.properties.known);
      // Every mass is the document's real volume times the row's real density.
      CHECK_NEAR(row.properties.massGrams,
                 massGrams(1000.0, row.material.densityKgPerM3), 1e-12);
      if (row.material.id == "aluminium-6061") {
        sawAluminium = true;
        CHECK_NEAR(row.properties.massGrams, 2.7, 1e-12);
      }
    }
    CHECK(sawAluminium);
    // Lightest first, deterministically.
    for (std::size_t i = 1; i < table.size(); ++i) {
      CHECK(table[i - 1].properties.massGrams <= table[i].properties.massGrams);
    }
    CHECK_EQ_STR(table.front().material.id, "hdpe");   // 950 kg/m^3, the lightest

    // A volume nobody measured yields NO table, not a column of zeroes.
    CHECK_EQ_INT(massTable(0.0).size(), 0);
    CHECK_EQ_INT(massTable(-1.0).size(), 0);
  }

  // ── 10. THE SMALLEST BLOCK THIS PART CAN BE CUT FROM ──────────────────────
  // Closed form on the unit cube: it fills its own block exactly, so nothing is
  // removed and the buy-to-fly ratio is 1.
  {
    const MeshMeasure m = measureMesh(box(0.0, 1.0));
    const StockEnvelope s = stockEnvelope(m.box, m.volume);
    CHECK(s.known);
    CHECK_NEAR(s.size[0], 1.0, 1e-12);
    CHECK_NEAR(s.blockVolumeMm3, 1.0, 1e-12);
    CHECK_NEAR(s.partVolumeMm3, 1.0, 1e-12);
    CHECK_NEAR(s.removedVolumeMm3, 0.0, 1e-12);
    CHECK_NEAR(s.removedFraction, 0.0, 1e-12);
    CHECK_NEAR(s.buyToFly, 1.0, 1e-12);
  }
  {
    // A 2 mm cube of which only 1 mm3 is part: 8 mm3 of block, 7 removed,
    // 87.5% swarf, buy-to-fly 8.
    MeasureBox b;
    b.valid = true;
    for (std::size_t a = 0; a < 3; ++a) { b.min[a] = 0.0; b.max[a] = 2.0; }
    const StockEnvelope s = stockEnvelope(b, 1.0);
    CHECK(s.known);
    CHECK_NEAR(s.blockVolumeMm3, 8.0, 1e-12);
    CHECK_NEAR(s.removedVolumeMm3, 7.0, 1e-12);
    CHECK_NEAR(s.removedFraction, 0.875, 1e-12);
    CHECK_NEAR(s.buyToFly, 8.0, 1e-12);
  }
  {
    // Every way this can be unknown, and none of them prints a number.
    CHECK(!stockEnvelope(MeasureBox{}, 1.0).known);          // no box measured
    MeasureBox flat;
    flat.valid = true;
    flat.max[0] = 5.0;
    flat.max[1] = 5.0;                                        // zero thickness
    CHECK(!stockEnvelope(flat, 1.0).known);
    MeasureBox b;
    b.valid = true;
    for (std::size_t a = 0; a < 3; ++a) { b.min[a] = 0.0; b.max[a] = 2.0; }
    CHECK(!stockEnvelope(b, 0.0).known);                      // no volume measured
    // A part bigger than the block that contains it is impossible, so it is a
    // fault in one of the two numbers -- refused, never shown as negative swarf.
    const StockEnvelope bad = stockEnvelope(b, 9.0);
    CHECK(!bad.known);
    CHECK_NEAR(bad.removedVolumeMm3, 0.0, 1e-12);
  }

  // ── 10. every state has a name ────────────────────────────────────────────
  {
    CHECK_EQ_STR(toString(CheckState::Pass), "pass");
    CHECK_EQ_STR(toString(CheckState::Fail), "fail");
    CHECK_EQ_STR(toString(CheckState::Unavailable), "unavailable");
    CHECK_EQ_STR(toString(CheckState::Informational), "reported");
  }

  return H.finish();
}
