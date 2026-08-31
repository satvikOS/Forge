// forge-desktop/ui_ir_probe.cpp — THE s3.2 BAR, CLOSED.
//
// ── what was missing before this file ───────────────────────────────────────
// Track UICMD (ZERO_JS_MIGRATION_MANIFEST.md §6.4) stated its own blocker
// exactly:
//
//   "No runtime path from a dispatched command to forge::ft::compile().
//    PartDocument holds the IR text; nothing in a shipped binary feeds it to
//    the compiler. Until it does, part.fillet cannot replace filletEdges — it
//    can only DESCRIBE it."
//
// So every forge::ui gate asserted the STATEMENT the kernel would be given, and
// none asserted the SOLID the kernel returns. A statement-level assertion cannot
// authorise deleting the JavaScript that produced a body, because the two claims
// are different: "the right text was emitted" is not "the right geometry exists".
//
// This probe is the missing runtime path, as a shipped CMake target:
//
//   a UI command dispatch through forge::ui::CommandRegistry
//        -> forge::ui::PartDocument::irProgram()          (the feature-IR text)
//        -> forge::ft::compileText()                      (parse + native walk)
//        -> a real B-rep solid in forge_kernel_core
//        -> forge::massProperties / forge::direct::{faceCount,edgeCount}
//        -> asserted against a CLOSED FORM computed here from first principles.
//
// No N-API, no Node, no JS: it links libforge_kernel_core.dylib, the node-free
// core (FORGE_BUILD_NODE_ADDON=OFF), and the forge::ui sources directly.
//
// ── SR-3: every check asserts a value against a reference ───────────────────
// Every volume below is a hand-derived closed form written next to the check:
//   plate            w*h*t
//   corner fillet    -4 * (r^2 - pi*r^2/4) * t          (square corner -> quarter disc)
//   through bore     -pi*(d/2)^2 * t
//   counterbore      -pi*(d/2)^2*t - pi*((D/2)^2-(d/2)^2)*depth
//   45-deg chamfer   -4 * (c^2/2) * t
//   shell            outer - (dx-2w)(dy-2w)(dz-w)       (one face open)
//   boolean          inclusion-exclusion on two axis-aligned boxes
//   pattern/mirror   n * V   for disjoint instances (PATTERN/MIRROR both FUSE)
//   revolve          Pappus: pi*(ro^2 - ri^2)*h
// Face and edge counts are derived by naming the faces and the loops, never
// copied from a run. Topology is asserted alongside volume because a volume
// alone cannot validate geometry: a wrong solid can match the right number.
//
// Exit code 0 iff every check passes. A non-zero exit is a red gate.
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using forge::uitest::Harness;
using namespace forge::ui;

namespace {

constexpr double kPi = 3.14159265358979323846;

// Volume tolerance: 1 part in 10^6 of the value under test. OCCT's BRepGProp
// integrates analytic faces to ~1e-10 relative, so this is loose enough to be
// robust and tight enough that no wrong construction survives — the FILLET
// radius-fallback path (FeatureTreeCompiler.cpp opFillet retries at 0.75r,
// 0.5r, ...) changes the blend volume by tens of percent and is caught here.
double volTol(double v) { return std::fabs(v) * 1e-6 + 1e-9; }

// Planar faces tessellate to their exact corner vertices, so a bbox spanned by
// planar geometry is exact. Any bbox extreme lying on a CURVED face is
// chord-approximated inward by the 0.3/0.6 deflection compile() measures with,
// so those are given a deflection-sized tolerance instead.
constexpr double kPlanarBboxTol = 1e-9;

EntityRef ent(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

// One UI document + its registry, wired exactly as a Part workspace would be.
struct Fixture {
  CommandRegistry registry;
  PartDocument doc;
  UndoStack undo;
  SelectionService sel;

  Fixture() { registerPartCommands(registry, doc, undo); }

  Fixture(const Fixture&) = delete;  // the handlers capture &doc / &undo
  Fixture& operator=(const Fixture&) = delete;

  void select(const std::vector<EntityRef>& refs) { sel.replaceWith(refs); }
};

CommandParams noParams() { return CommandParams{}; }

CommandParams oneParam(const char* a, double av) {
  CommandParams p;
  p.setNumber(a, av);
  return p;
}

CommandParams twoParams(const char* a, double av, const char* b, double bv) {
  CommandParams p;
  p.setNumber(a, av);
  p.setNumber(b, bv);
  return p;
}

// ── THE SEAM ────────────────────────────────────────────────────────────────
// This function is the whole point of the file: the UI document's text goes
// into the kernel's one compile entry and a measured solid comes back.
struct Chain {
  std::string program;
  forge::ft::CompileResult result;
};

Chain compileDocument(const PartDocument& doc, const std::string& stepOut = std::string()) {
  Chain c;
  c.program = doc.irProgram();                            // forge::ui  ->  text
  c.result = forge::ft::compileText(c.program, stepOut);  // text -> forge::ft -> B-rep
  return c;
}

void report(const char* name, const Chain& c) {
  std::printf("\n-- %s ---------------------------------------\n", name);
  std::printf("%s", c.program.c_str());
  const forge::ft::CompileResult& r = c.result;
  std::printf("  -> ok=%d valid=%d  volume=%.10g  faces=%ld edges=%ld\n"
              "     bbox=[%.6g %.6g %.6g] .. [%.6g %.6g %.6g]  d/p/c=%zu/%zu/%zu\n",
              r.ok ? 1 : 0, r.valid ? 1 : 0, r.volume, r.faceCount, r.edgeCount, r.bboxMin[0],
              r.bboxMin[1], r.bboxMin[2], r.bboxMax[0], r.bboxMax[1], r.bboxMax[2], r.nDeclared,
              r.nParsed, r.nCompiled);
  if (!r.ok) std::printf("     ERROR: %s\n", r.error.c_str());
}

int st(const DispatchResult& r) { return static_cast<int>(r.status); }
constexpr int kOk = static_cast<int>(DispatchStatus::Ok);

// ===========================================================================
// 1. EXTRUDE -> FILLET -> HOLE, one progressive document, each step measured.
//    This is the shape a real modelling session has: one body that gains
//    history, and the SAME document node ("body_2") keeps its identity across
//    the fillet and the hole exactly as it does in every parametric modeller.
// ===========================================================================
void scenarioPlate(Harness& H) {
  Fixture F;

  // A sketch authored in the Sketch workspace, before any Part command ran.
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Profile, "sketch_1", "RECT",
                          {IrArg::num(80), IrArg::num(60)}),
               1);

  // ---- EXTRUDE ------------------------------------------------------------
  F.select({ent("sketch_1", EntityKind::Sketch, "s1")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.extrude", F.sel, oneParam("distance", 20))), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = RECT(80, 60)\n%2 = EXTRUDE(%1, 20)\n");

  const Chain c1 = compileDocument(F.doc);
  report("part.extrude  RECT(80,60) x 20", c1);
  CHECK(c1.result.ok);
  CHECK(c1.result.valid);
  const double vPlate = 80.0 * 60.0 * 20.0;  // 96000
  CHECK_NEAR(c1.result.volume, vPlate, volTol(vPlate));
  CHECK_EQ_INT(c1.result.faceCount, 6);  // a box
  CHECK_EQ_INT(c1.result.edgeCount, 12);
  // RECT is centred on the origin; EXTRUDE runs +Z from the sketch plane.
  CHECK_NEAR(c1.result.bboxMin[0], -40.0, kPlanarBboxTol);
  CHECK_NEAR(c1.result.bboxMax[0], 40.0, kPlanarBboxTol);
  CHECK_NEAR(c1.result.bboxMin[1], -30.0, kPlanarBboxTol);
  CHECK_NEAR(c1.result.bboxMax[1], 30.0, kPlanarBboxTol);
  CHECK_NEAR(c1.result.bboxMin[2], 0.0, kPlanarBboxTol);
  CHECK_NEAR(c1.result.bboxMax[2], 20.0, kPlanarBboxTol);
  // s0.4 ledger: two executable statements, two ops parsed, two compiled.
  CHECK_EQ_INT(c1.result.nDeclared, 2);
  CHECK_EQ_INT(c1.result.nParsed, 2);
  CHECK_EQ_INT(c1.result.nCompiled, 2);

  // ---- FILLET (the 4 vertical corners) ------------------------------------
  // The extruded plate is document node "body_2"; the user picks its corners.
  CommandParams pf;
  pf.setNumber("radius", 10);
  pf.setText("selector", "VERTICAL");
  F.select({ent("body_2", EntityKind::Edge, "e1"), ent("body_2", EntityKind::Edge, "e2")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.fillet", F.sel, pf)), kOk);
  CHECK_EQ_STR(F.doc.irProgram(),
               "%1 = RECT(80, 60)\n%2 = EXTRUDE(%1, 20)\n%3 = FILLET(%2, 10, VERTICAL)\n");

  const Chain c2 = compileDocument(F.doc);
  report("part.fillet  r=10 VERTICAL", c2);
  CHECK(c2.result.ok);
  CHECK(c2.result.valid);
  // Each square corner (area r^2) becomes a quarter disc (area pi*r^2/4) over
  // the full 20 mm thickness; 4 corners.
  const double vFillet = vPlate - 4.0 * (100.0 - kPi * 100.0 / 4.0) * 20.0;
  CHECK_NEAR(c2.result.volume, vFillet, volTol(vFillet));
  // faces: 4 planar sides + 4 corner cylinders + top + bottom
  CHECK_EQ_INT(c2.result.faceCount, 10);
  // edges: top loop 8 (4 lines + 4 arcs), bottom loop 8, 8 vertical joins
  CHECK_EQ_INT(c2.result.edgeCount, 24);
  // Rounding the corners cannot move the bounding box.
  CHECK_NEAR(c2.result.bboxMin[0], -40.0, kPlanarBboxTol);
  CHECK_NEAR(c2.result.bboxMax[2], 20.0, kPlanarBboxTol);

  // ---- HOLE (through) -----------------------------------------------------
  CommandParams ph;
  ph.setNumber("diameter", 12);
  ph.setNumber("x", 20);
  ph.setNumber("y", 10);
  ph.setNumber("z", 0);
  F.select({ent("body_2", EntityKind::Face, "top")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.hole", F.sel, ph)), kOk);
  CHECK_EQ_STR(F.doc.irProgram(),
               "%1 = RECT(80, 60)\n%2 = EXTRUDE(%1, 20)\n%3 = FILLET(%2, 10, VERTICAL)\n"
               "%4 = HOLE(%3, 12, 20, 10, 0)\n");

  const Chain c3 = compileDocument(F.doc);
  report("part.hole  dia 12 through at (20,10)", c3);
  CHECK(c3.result.ok);
  CHECK(c3.result.valid);
  const double vHole = vFillet - kPi * 6.0 * 6.0 * 20.0;
  CHECK_NEAR(c3.result.volume, vHole, volTol(vHole));
  CHECK_EQ_INT(c3.result.faceCount, 11);  // + the bore's cylindrical face
  CHECK_EQ_INT(c3.result.edgeCount, 27);  // + 2 circles + 1 cylinder seam
  CHECK_EQ_INT(c3.result.nDeclared, 4);
  CHECK_EQ_INT(c3.result.nCompiled, 4);

  // ---- UNDO / REDO, measured on the SOLID ---------------------------------
  // The undo contract was previously asserted on the program text. Here it is
  // asserted on geometry: undo must give back the pre-hole SOLID in volume and
  // topology, and redo must rebuild the same body.
  CHECK_EQ_INT(st(F.registry.dispatch("part.undo", F.sel, noParams())), kOk);
  const Chain c4 = compileDocument(F.doc);
  report("part.undo  (the hole is gone)", c4);
  CHECK(c4.result.ok);
  CHECK_NEAR(c4.result.volume, vFillet, volTol(vFillet));
  CHECK_EQ_INT(c4.result.faceCount, 10);
  CHECK_EQ_INT(c4.result.edgeCount, 24);

  CHECK_EQ_INT(st(F.registry.dispatch("part.redo", F.sel, noParams())), kOk);
  const Chain c5 = compileDocument(F.doc);
  report("part.redo  (the hole is back)", c5);
  CHECK(c5.result.ok);
  CHECK_NEAR(c5.result.volume, vHole, volTol(vHole));
  CHECK_EQ_INT(c5.result.faceCount, 11);
  CHECK_EQ_INT(c5.result.edgeCount, 27);
}

// ===========================================================================
// 2. COUNTERBORE — two coaxial cylinders removed, one closed form.
// ===========================================================================
void scenarioCounterbore(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(60), IrArg::num(60), IrArg::num(30)}),
               1);
  CommandParams p;
  p.setNumber("diameter", 10);
  p.setNumber("cbore_diameter", 20);
  p.setNumber("cbore_depth", 8);
  p.setNumber("x", 0);
  p.setNumber("y", 0);
  p.setNumber("z", 30);  // the counterbore opens on the TOP face (z = 30)
  F.select({ent("body_a", EntityKind::Face, "top")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.counterbore", F.sel, p)), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = BOX(60, 60, 30)\n%2 = CBORE(%1, 10, 20, 8, 0, 0, 30)\n");

  const Chain c = compileDocument(F.doc);
  report("part.counterbore  10 / 20 x 8 deep", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  // pilot: pi*5^2 over the full 30 mm; recess: the extra annulus over 8 mm.
  const double v = 60.0 * 60.0 * 30.0 - kPi * 25.0 * 30.0 - kPi * (100.0 - 25.0) * 8.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  // faces: 6 box + pilot cylinder + counterbore cylinder + annular shoulder
  CHECK_EQ_INT(c.result.faceCount, 9);
}

// ===========================================================================
// 3. CHAMFER — a 45-degree cut on the 4 vertical edges.
// ===========================================================================
void scenarioChamfer(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(50), IrArg::num(40), IrArg::num(15)}),
               1);
  CommandParams p;
  p.setNumber("distance", 6);
  p.setText("selector", "VERTICAL");
  F.select({ent("body_a", EntityKind::Edge, "e1")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.chamfer", F.sel, p)), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = BOX(50, 40, 15)\n%2 = CHAMFER(%1, 6, VERTICAL)\n");

  const Chain c = compileDocument(F.doc);
  report("part.chamfer  6 mm VERTICAL", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  // A symmetric 45-degree chamfer removes a right isoceles prism per corner:
  // cross-section c^2/2, height 15.
  const double v = 50.0 * 40.0 * 15.0 - 4.0 * (6.0 * 6.0 / 2.0) * 15.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  CHECK_EQ_INT(c.result.faceCount, 10);  // 6 + 4 chamfer planes
  CHECK_EQ_INT(c.result.edgeCount, 24);
}

// ===========================================================================
// 4. SHELL — hollow the body, opening the face the open axis names.
// ===========================================================================
void scenarioShell(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(60), IrArg::num(40), IrArg::num(30)}),
               1);
  F.select({ent("body_a", EntityKind::Face, "bottom")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.shell", F.sel, oneParam("thickness", 3))), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = BOX(60, 40, 30)\n%2 = SHELL(%1, 3)\n");

  const Chain c = compileDocument(F.doc);
  report("part.shell  wall 3, open -Z", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  // The default open axis is -Z, so the bottom face is removed and the cavity
  // is walled on 5 sides: (60-6) x (40-6) x (30-3).
  const double v = 60.0 * 40.0 * 30.0 - 54.0 * 34.0 * 27.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  // faces: 5 outer (4 walls + top) + 5 inner + 1 annular rim at the opening
  CHECK_EQ_INT(c.result.faceCount, 11);
  CHECK_EQ_INT(c.result.edgeCount, 24);  // 12 outer + 12 inner
  // Shelling INWARD cannot change the outer bounding box.
  CHECK_NEAR(c.result.bboxMin[0], -30.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[0], 30.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[2], 30.0, kPlanarBboxTol);
}

// ===========================================================================
// 5. BOOLEANS — all three, on the same pair of boxes, by inclusion-exclusion.
//    A = BOX(40,40,40)            occupies x,y in [-20,20], z in [0,40]
//    B = BOX(20,20,60, 0,0,-10)   occupies x,y in [-10,10], z in [-10,50]
//    B passes clean through A, so |A n B| = 20*20*40 = 16000.
// ===========================================================================
constexpr double kVa = 40.0 * 40.0 * 40.0;        // 64000
constexpr double kVb = 20.0 * 20.0 * 60.0;        // 24000
constexpr double kVoverlap = 20.0 * 20.0 * 40.0;  // 16000

void seedTwoBoxes(Harness& H, Fixture& F) {
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(40), IrArg::num(40), IrArg::num(40)}),
               1);
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_b", "BOX",
                          {IrArg::num(20), IrArg::num(20), IrArg::num(60), IrArg::num(0),
                           IrArg::num(0), IrArg::num(-10)}),
               2);
}

void scenarioBooleanSubtract(Harness& H) {
  Fixture F;
  seedTwoBoxes(H, F);
  // Selection ORDER is load-bearing: first pick is the target, second the tool.
  F.select({ent("body_a", EntityKind::Body, ""), ent("body_b", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.boolean_subtract", F.sel, noParams())), kOk);
  CHECK_EQ_STR(F.doc.irProgram(),
               "%1 = BOX(40, 40, 40)\n%2 = BOX(20, 20, 60, 0, 0, -10)\n%3 = CUT(%1, %2)\n");

  const Chain c = compileDocument(F.doc);
  report("part.boolean_subtract  A - B", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  const double v = kVa - kVoverlap;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  // A square through-pocket: 4 outer walls + top and bottom (each with an inner
  // loop) + 4 pocket walls.
  CHECK_EQ_INT(c.result.faceCount, 10);
  CHECK_EQ_INT(c.result.edgeCount, 24);
}

void scenarioBooleanUnion(Harness& H) {
  Fixture F;
  seedTwoBoxes(H, F);
  F.select({ent("body_a", EntityKind::Body, ""), ent("body_b", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.boolean_union", F.sel, noParams())), kOk);
  CHECK_EQ_STR(F.doc.irProgram(),
               "%1 = BOX(40, 40, 40)\n%2 = BOX(20, 20, 60, 0, 0, -10)\n%3 = FUSE(%1, %2)\n");

  const Chain c = compileDocument(F.doc);
  report("part.boolean_union  A u B", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  const double v = kVa + kVb - kVoverlap;  // inclusion-exclusion
  CHECK_NEAR(c.result.volume, v, volTol(v));
  // The union spans B's full height and A's full width.
  CHECK_NEAR(c.result.bboxMin[2], -10.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[2], 50.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMin[0], -20.0, kPlanarBboxTol);
}

void scenarioBooleanIntersect(Harness& H) {
  Fixture F;
  seedTwoBoxes(H, F);
  F.select({ent("body_a", EntityKind::Body, ""), ent("body_b", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.boolean_intersect", F.sel, noParams())), kOk);
  CHECK_EQ_STR(F.doc.irProgram(),
               "%1 = BOX(40, 40, 40)\n%2 = BOX(20, 20, 60, 0, 0, -10)\n%3 = COMMON(%1, %2)\n");

  const Chain c = compileDocument(F.doc);
  report("part.boolean_intersect  A n B", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  CHECK_NEAR(c.result.volume, kVoverlap, volTol(kVoverlap));
  CHECK_EQ_INT(c.result.faceCount, 6);  // the intersection is a 20 x 20 x 40 box
  CHECK_EQ_INT(c.result.edgeCount, 12);
  CHECK_NEAR(c.result.bboxMin[2], 0.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[2], 40.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[0], 10.0, kPlanarBboxTol);
}

// ===========================================================================
// 6. PATTERNS — LINEAR, GRID and POLAR. Every instance is placed clear of the
//    others, so the fused result's volume is exactly n * V and its face count
//    exactly n * 6: a pattern that silently dropped or overlapped an instance
//    fails both.
// ===========================================================================
void scenarioPatternLinear(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(20), IrArg::num(20), IrArg::num(10)}),
               1);
  F.select({ent("body_a", EntityKind::Body, "")});
  CHECK_EQ_INT(
      st(F.registry.dispatch("part.pattern_linear", F.sel, twoParams("count", 3, "dx", 50))), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = BOX(20, 20, 10)\n%2 = PATTERN(%1, LINEAR, 3, 50)\n");

  const Chain c = compileDocument(F.doc);
  report("part.pattern_linear  n=3 dx=50", c);
  CHECK(c.result.ok);
  const double v = 3.0 * 20.0 * 20.0 * 10.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  CHECK_EQ_INT(c.result.faceCount, 18);  // 3 disjoint boxes
  CHECK_EQ_INT(c.result.edgeCount, 36);
  // instance i sits at x in [-10 + 50i, 10 + 50i]
  CHECK_NEAR(c.result.bboxMin[0], -10.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[0], 110.0, kPlanarBboxTol);
}

void scenarioPatternGrid(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(10), IrArg::num(10), IrArg::num(10)}),
               1);
  CommandParams p;
  p.setNumber("nx", 3);
  p.setNumber("ny", 2);
  p.setNumber("dx", 40);
  p.setNumber("dy", 40);
  F.select({ent("body_a", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.pattern_grid", F.sel, p)), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = BOX(10, 10, 10)\n%2 = PATTERN(%1, GRID, 3, 2, 40, 40)\n");

  const Chain c = compileDocument(F.doc);
  report("part.pattern_grid  3 x 2 at 40 mm pitch", c);
  CHECK(c.result.ok);
  const double v = 6.0 * 1000.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  CHECK_EQ_INT(c.result.faceCount, 36);
  CHECK_NEAR(c.result.bboxMax[0], 85.0, kPlanarBboxTol);  // -5 + 2*40 + 10
  CHECK_NEAR(c.result.bboxMax[1], 45.0, kPlanarBboxTol);  // -5 + 1*40 + 10
}

void scenarioPatternCircular(Harness& H) {
  Fixture F;
  // A 10-cube standing off the Z axis at x = 40, so the four polar instances
  // land at 0/90/180/270 degrees and never touch.
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(10), IrArg::num(10), IrArg::num(10), IrArg::num(40),
                           IrArg::num(0), IrArg::num(0)}),
               1);
  F.select({ent("body_a", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.pattern_circular", F.sel,
                                      twoParams("count", 4, "total_angle", 360))),
               kOk);
  CHECK_EQ_STR(F.doc.irProgram(),
               "%1 = BOX(10, 10, 10, 40, 0, 0)\n%2 = PATTERN(%1, POLAR, 4, 360)\n");

  const Chain c = compileDocument(F.doc);
  report("part.pattern_circular  n=4 over 360 deg", c);
  CHECK(c.result.ok);
  const double v = 4.0 * 1000.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  CHECK_EQ_INT(c.result.faceCount, 24);
  // 90-degree steps put instance 2 at x = -40 and instances 1/3 at y = +-40.
  CHECK_NEAR(c.result.bboxMin[0], -45.0, 1e-6);
  CHECK_NEAR(c.result.bboxMax[0], 45.0, 1e-6);
  CHECK_NEAR(c.result.bboxMin[1], -45.0, 1e-6);
}

// ===========================================================================
// 7. MIRROR — reflect + FUSE across a principal plane.
// ===========================================================================
void scenarioMirror(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(20), IrArg::num(20), IrArg::num(10), IrArg::num(30),
                           IrArg::num(0), IrArg::num(0)}),
               1);
  CommandParams p;
  p.setText("plane", "YZ");
  F.select({ent("body_a", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.mirror", F.sel, p)), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = BOX(20, 20, 10, 30, 0, 0)\n%2 = MIRROR(%1, YZ)\n");

  const Chain c = compileDocument(F.doc);
  report("part.mirror  across YZ", c);
  CHECK(c.result.ok);
  // The body sits at x in [20,40]; its reflection at x in [-40,-20]. Disjoint,
  // so the fused result is exactly twice the volume.
  const double v = 2.0 * 20.0 * 20.0 * 10.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  CHECK_EQ_INT(c.result.faceCount, 12);
  CHECK_NEAR(c.result.bboxMin[0], -40.0, kPlanarBboxTol);
  CHECK_NEAR(c.result.bboxMax[0], 40.0, kPlanarBboxTol);
}

// ===========================================================================
// 8. REVOLVE — Pappus's centroid theorem as the closed form, and a STEP file
//    written from the same result so the artefact is measurable independently.
// ===========================================================================
void scenarioRevolve(Harness& H, const std::string& stepOut) {
  Fixture F;
  // A 20 x 10 rectangle centred at (30, 0) on the sketch plane: x in [20,40].
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Profile, "sketch_1", "RECT",
                          {IrArg::num(20), IrArg::num(10), IrArg::num(30), IrArg::num(0)}),
               1);
  F.select({ent("sketch_1", EntityKind::Sketch, "s1")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.revolve", F.sel, oneParam("angle", 360))), kOk);
  CHECK_EQ_STR(F.doc.irProgram(), "%1 = RECT(20, 10, 30, 0)\n%2 = REVOLVE(%1, 360)\n");

  const Chain c = compileDocument(F.doc, stepOut);
  report("part.revolve  360 deg about +Y", c);
  CHECK(c.result.ok);
  CHECK(c.result.valid);
  // Revolved about the default +Y axis through the origin: an annulus of inner
  // radius 20 and outer radius 40, 10 tall along Y. Pappus gives the same
  // number: 2*pi*R_centroid * A = 2*pi*30 * (20*10) = 12000*pi.
  const double v = kPi * (40.0 * 40.0 - 20.0 * 20.0) * 10.0;
  CHECK_NEAR(c.result.volume, v, volTol(v));
  CHECK_EQ_INT(c.result.faceCount, 4);  // outer + inner cylinder, 2 annular caps
  // The compile entry wrote the solid to STEP from the same handle it measured.
  CHECK(c.result.exported);
  std::FILE* f = std::fopen(stepOut.c_str(), "rb");
  CHECK(f != nullptr);
  long bytes = 0;
  if (f != nullptr) {
    std::fseek(f, 0, SEEK_END);
    bytes = std::ftell(f);
    std::fclose(f);
  }
  std::printf("     STEP written: %s (%ld bytes)\n", stepOut.c_str(), bytes);
  CHECK(bytes > 1000);
}

// ===========================================================================
// 9. THE REFUSAL PATH — a command the registry declines must leave the
//    document, and therefore the SOLID, completely unchanged. Without this the
//    scenarios above would still pass if every gate were deleted.
// ===========================================================================
void scenarioRefusalsDoNotChangeTheSolid(Harness& H) {
  Fixture F;
  CHECK_EQ_INT(F.doc.seed(IrValueKind::Solid, "body_a", "BOX",
                          {IrArg::num(30), IrArg::num(30), IrArg::num(30)}),
               1);
  const Chain before = compileDocument(F.doc);
  CHECK(before.result.ok);
  CHECK_NEAR(before.result.volume, 27000.0, volTol(27000.0));

  // a zero radius is not a fillet
  CommandParams pf;
  pf.setNumber("radius", 0);
  F.select({ent("body_a", EntityKind::Edge, "e1")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.fillet", F.sel, pf)),
               static_cast<int>(DispatchStatus::Disabled));

  // a boolean needs two bodies
  F.select({ent("body_a", EntityKind::Body, "")});
  CHECK_EQ_INT(st(F.registry.dispatch("part.boolean_subtract", F.sel, noParams())),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

  // an extrude is not offered on a solid
  CHECK_EQ_INT(st(F.registry.dispatch("part.extrude", F.sel, oneParam("distance", 10))),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

  const Chain after = compileDocument(F.doc);
  report("refused commands leave the solid untouched", after);
  CHECK_EQ_STR(after.program, before.program);
  CHECK(after.result.ok);
  CHECK_NEAR(after.result.volume, before.result.volume, 1e-9);
  CHECK_EQ_INT(after.result.faceCount, before.result.faceCount);
  CHECK_EQ_INT(after.result.edgeCount, before.result.edgeCount);
}

}  // namespace

int main(int argc, char** argv) {
  const std::string stepOut =
      argc > 1 ? std::string(argv[1]) : std::string("/tmp/forge_ui_ir_probe_revolve.step");

  std::printf("forge_ui_ir_probe — forge::ui command -> feature-IR -> forge::ft::compile\n");
  std::printf("                    -> B-rep solid -> measured against a closed form.\n");
  std::printf("                    linked library: forge_kernel_core (N-API EXCLUDED)\n");

  Harness H("ui_ir");
  scenarioPlate(H);
  scenarioCounterbore(H);
  scenarioChamfer(H);
  scenarioShell(H);
  scenarioBooleanSubtract(H);
  scenarioBooleanUnion(H);
  scenarioBooleanIntersect(H);
  scenarioPatternLinear(H);
  scenarioPatternGrid(H);
  scenarioPatternCircular(H);
  scenarioMirror(H);
  scenarioRevolve(H, stepOut);
  scenarioRefusalsDoNotChangeTheSolid(H);

  std::printf("\n");
  return H.finish();
}
