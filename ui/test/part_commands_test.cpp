// ui/test/part_commands_test.cpp
//
// CONTRACT — the Part workspace commands are asserted on BEHAVIOUR, never on
// registration. `registry.size() == 18` proves nothing: the ZEROJS track's
// finding was that 2,421 green checks can sit on top of a registry that owns no
// product commands at all, and a gate that only counts descriptors reproduces
// exactly that mistake one level up.
//
// So every check below is one of four kinds:
//   (a) the ENABLED PREDICATE actually gates execution — a command refused for a
//       radius of 0, or for a selection naming a body this document does not
//       hold, must leave the document byte-identical;
//   (b) the SELECTION SIGNATURE is enforced — a fillet offered on faces, an
//       extrude offered on a solid, a boolean offered on one body;
//   (c) the EMITTED FEATURE-IR is exactly the statement the kernel would accept
//       — asserted as text, and validated against the op table that
//       feature_ir_test.cpp proves is the kernel's own;
//   (d) the UNDO CONTRACT holds — undo restores the program, redo replays it
//       with the SAME statement ids, and a new edit abandons the redo branch.
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::at;
using forge::uitest::Harness;

namespace {

EntityRef ref(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

CommandParams params1(const std::string& n, double v) {
  CommandParams p;
  p.setNumber(n, v);
  return p;
}

CommandParams params2(const std::string& n1, double v1, const std::string& n2, double v2) {
  CommandParams p;
  p.setNumber(n1, v1);
  p.setNumber(n2, v2);
  return p;
}

void selectOnly(SelectionService& sel, const std::vector<EntityRef>& refs) {
  sel.replaceWith(refs);
}

int statusOf(const DispatchResult& r) { return static_cast<int>(r.status); }

std::string lastLine(const PartDocument& doc) {
  const FeatureRecord* f = doc.lastFeature();
  return f == nullptr ? std::string("<no feature>") : f->line.text();
}

}  // namespace

int main() {
  Harness H("part_commands");

  CommandRegistry registry;
  PartDocument doc;
  UndoStack undoStack;
  SelectionService sel;

  // ── registration is the PRECONDITION, not the assertion ───────────────────
  const std::size_t added = registerPartCommands(registry, doc, undoStack);
  CHECK_EQ_INT(added, 44);
  CHECK_EQ_INT(registry.size(), 44);
  CHECK_EQ_INT(registry.ids().size(), partCommandIds().size());
  for (std::size_t i = 0; i < partCommandIds().size(); ++i) {
    CHECK_EQ_STR(at(registry.ids(), i), at(partCommandIds(), i));
  }
  // Re-registering must be refused wholesale: two implementations behind one
  // stable ID is the failure the single registry exists to prevent.
  CHECK_EQ_INT(registerPartCommands(registry, doc, undoStack), 0);
  CHECK_EQ_INT(registry.size(), 44);

  // every descriptor carries the whole s19.2 contract, and every modelling
  // command names an op the kernel actually has
  std::size_t withIrOp = 0;
  for (const std::string& id : registry.ids()) {
    const CommandDescriptor* c = registry.find(id);
    CHECK(c != nullptr);
    if (c == nullptr) continue;
    CHECK(!c->label.empty());
    CHECK_EQ_STR(c->category, "Part");
    CHECK(static_cast<bool>(c->execute));
    CHECK(static_cast<bool>(c->enabled));
    CHECK_EQ_INT(c->version, 1);
    if (!c->featureIrOp.empty()) {
      ++withIrOp;
      CHECK(findIrOp(c->featureIrOp) != nullptr);
    }
  }
  CHECK_EQ_INT(withIrOp, 43);  // every registered Part command emits an IR op

  // ── the document seed ─────────────────────────────────────────────────────
  // Three values that exist before any Part command ran: two sketches from the
  // Sketch workspace and one imported solid.
  CHECK_EQ_INT(doc.seed(IrValueKind::Profile, "sketch_1", "RECT",
                        {IrArg::num(80), IrArg::num(60)}),
               1);
  CHECK_EQ_INT(doc.seed(IrValueKind::Profile, "sketch_2", "CIRCLE", {IrArg::num(12)}), 2);
  CHECK_EQ_INT(doc.seed(IrValueKind::Solid, "body_x", "BOX",
                        {IrArg::num(5), IrArg::num(5), IrArg::num(5)}),
               3);
  CHECK_EQ_INT(static_cast<int>(doc.lastCheck()), static_cast<int>(IrCheck::Ok));
  CHECK_EQ_INT(doc.featureCount(), 0);  // seeds are not features

  // ── (b) SELECTION SIGNATURE ───────────────────────────────────────────────
  // extrude wants a sketch; a face is refused before the predicate is consulted
  selectOnly(sel, {ref("sketch_1", EntityKind::Face, "f1")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.extrude", sel, params1("distance", 20))),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  // ... and a mixed selection is refused even when one member would do
  selectOnly(sel, {ref("sketch_1", EntityKind::Sketch, "s1"),
                   ref("sketch_1", EntityKind::Edge, "e1")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.extrude", sel, params1("distance", 20))),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  // an empty selection is refused too
  sel.clearSelection();
  CHECK_EQ_INT(statusOf(registry.evaluate("part.extrude", sel, params1("distance", 20))),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

  // ── required parameters ───────────────────────────────────────────────────
  selectOnly(sel, {ref("sketch_1", EntityKind::Sketch, "s1")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.extrude", sel)),
               static_cast<int>(DispatchStatus::MissingRequiredParameter));
  CHECK_EQ_STR(registry.evaluate("part.extrude", sel).detail, "distance");

  // ── (a) ENABLED PREDICATE gates execution ─────────────────────────────────
  // a zero-height extrude is signature-legal and parameter-complete, and still
  // must not run
  CHECK_EQ_INT(statusOf(registry.dispatch("part.extrude", sel, params1("distance", 0))),
               static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_INT(doc.featureCount(), 0);
  CHECK_EQ_INT(doc.records().size(), 3);
  CHECK_EQ_INT(undoStack.undoDepth(), 0);

  // ── (c) the first real emission ───────────────────────────────────────────
  CHECK(registry.dispatch("part.extrude", sel, params1("distance", 20)).ok());
  CHECK_EQ_INT(doc.featureCount(), 1);
  CHECK_EQ_INT(static_cast<int>(doc.lastCheck()), static_cast<int>(IrCheck::Ok));
  CHECK_EQ_STR(lastLine(doc), "%4 = EXTRUDE(%1, 20)");
  // the extrude introduced a NEW selectable solid
  CHECK_EQ_INT(doc.valueFor("body_4"), 4);
  CHECK_EQ_INT(static_cast<int>(doc.kindOf(4)), static_cast<int>(IrValueKind::Solid));
  // and the sketch is still a profile, not silently retyped
  CHECK_EQ_INT(static_cast<int>(doc.kindOf(1)), static_cast<int>(IrValueKind::Profile));

  // ── the predicate reads the SELECTION, not just the parameters ────────────
  // Edges of a body this document does not hold: signature satisfied, every
  // required parameter present, and still refused — because "body_99" resolves
  // to no feature-IR value, so there is no `%N` to write into the statement.
  selectOnly(sel, {ref("body_99", EntityKind::Edge, "e1")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.fillet", sel, params1("radius", 4))),
               static_cast<int>(DispatchStatus::Disabled));
  // Edges of a SKETCH: the value resolves, but it is a PROFILE, and FILLET
  // consumes a SOLID.
  selectOnly(sel, {ref("sketch_1", EntityKind::Edge, "e1")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.fillet", sel, params1("radius", 4))),
               static_cast<int>(DispatchStatus::Disabled));
  // Edges spanning TWO bodies: one FILLET op takes one %body, so this is not one
  // command.
  selectOnly(sel, {ref("body_4", EntityKind::Edge, "e1"), ref("body_x", EntityKind::Edge, "e2")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.fillet", sel, params1("radius", 4))),
               static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_INT(doc.records().size(), 4);  // nothing above mutated the document

  // ── fillet, for real ──────────────────────────────────────────────────────
  selectOnly(sel, {ref("body_4", EntityKind::Edge, "e1"), ref("body_4", EntityKind::Edge, "e2")});
  CHECK_EQ_INT(statusOf(registry.dispatch("part.fillet", sel, params1("radius", 0))),
               static_cast<int>(DispatchStatus::Disabled));  // a zero fillet is not a fillet
  CHECK(registry.dispatch("part.fillet", sel, params1("radius", 4)).ok());
  CHECK_EQ_STR(lastLine(doc), "%5 = FILLET(%4, 4, ALL)");
  // the body KEPT its identity and gained history — body_4 now names %5
  CHECK_EQ_INT(doc.valueFor("body_4"), 5);

  // a non-keyword selector is emitted as a QUOTED selector string, not a bare
  // token the parser would read as a keyword
  {
    CommandParams p = params1("radius", 2);
    p.setText("selector", "bore:r=6");
    CHECK(registry.dispatch("part.fillet", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%6 = FILLET(%5, 2, \"bore:r=6\")");
    CHECK(undoStack.undo(doc));  // roll it back; it was a demonstration
    CHECK_EQ_INT(doc.valueFor("body_4"), 5);
    CHECK_EQ_INT(doc.records().size(), 5);
  }

  // ── hole, counterbore, shell, patterns, mirror ────────────────────────────
  selectOnly(sel, {ref("body_4", EntityKind::Face, "top")});
  {
    CHECK(registry.dispatch("part.hole", sel, params1("diameter", 10)).ok());
    CHECK_EQ_STR(lastLine(doc), "%6 = HOLE(%5, 10, 0, 0, 0)");
  }
  {
    CommandParams p = params1("diameter", 10);
    p.setNumber("x", 25);
    p.setNumber("y", -15);
    p.setNumber("depth", 8);
    CHECK(registry.dispatch("part.hole", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%7 = HOLE(%6, 10, 25, -15, 0, 0, 0, 1, 8)");
  }
  {
    // a counterbore narrower than its own through-hole is geometric nonsense
    CommandParams p;
    p.setNumber("diameter", 11);
    p.setNumber("cbore_diameter", 6);
    p.setNumber("cbore_depth", 6);
    CHECK_EQ_INT(statusOf(registry.evaluate("part.counterbore", sel, p)),
                 static_cast<int>(DispatchStatus::Disabled));
    p.setNumber("cbore_diameter", 18);
    CHECK(registry.dispatch("part.counterbore", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%8 = CBORE(%7, 11, 18, 6, 0, 0, 0)");
  }
  {
    CHECK_EQ_INT(statusOf(registry.evaluate("part.shell", sel, params1("thickness", -2))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK(registry.dispatch("part.shell", sel, params1("thickness", 2)).ok());
    CHECK_EQ_STR(lastLine(doc), "%9 = SHELL(%8, 2)");
  }

  selectOnly(sel, {ref("body_4", EntityKind::Body, "")});
  {
    // a 1-instance pattern is a no-op feature; a fractional count is not a count
    CommandParams p = params1("count", 1);
    p.setNumber("dx", 30);
    CHECK_EQ_INT(statusOf(registry.evaluate("part.pattern_linear", sel, p)),
                 static_cast<int>(DispatchStatus::Disabled));
    p.setNumber("count", 2.5);
    CHECK_EQ_INT(statusOf(registry.evaluate("part.pattern_linear", sel, p)),
                 static_cast<int>(DispatchStatus::Disabled));
    p.setNumber("count", 4);
    CHECK(registry.dispatch("part.pattern_linear", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%10 = PATTERN(%9, LINEAR, 4, 30)");
  }
  {
    CommandParams p = params1("count", 6);
    p.setNumber("total_angle", 400);  // outside the documented 0 < a <= 360
    CHECK_EQ_INT(statusOf(registry.evaluate("part.pattern_circular", sel, p)),
                 static_cast<int>(DispatchStatus::Disabled));
    p.setNumber("total_angle", 360);
    CHECK(registry.dispatch("part.pattern_circular", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%11 = PATTERN(%10, POLAR, 6, 360)");
  }
  {
    CommandParams p;
    p.setText("plane", "ZZ");  // not a principal plane
    CHECK_EQ_INT(statusOf(registry.evaluate("part.mirror", sel, p)),
                 static_cast<int>(DispatchStatus::Disabled));
    p.setText("plane", "YZ");
    CHECK(registry.dispatch("part.mirror", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%12 = MIRROR(%11, YZ)");
  }

  // ── booleans: arity, order, and the consumed operand ──────────────────────
  selectOnly(sel, {ref("sketch_2", EntityKind::Sketch, "s2")});
  CHECK(registry.dispatch("part.extrude", sel, params1("distance", 30)).ok());
  CHECK_EQ_STR(lastLine(doc), "%13 = EXTRUDE(%2, 30)");
  CHECK_EQ_INT(doc.valueFor("body_13"), 13);

  // one body is not a boolean
  selectOnly(sel, {ref("body_4", EntityKind::Body, "")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.boolean_subtract", sel)),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
  // three is not either
  selectOnly(sel, {ref("body_4", EntityKind::Body, ""), ref("body_13", EntityKind::Body, ""),
                   ref("body_x", EntityKind::Body, "")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.boolean_subtract", sel)),
               static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

  // selection ORDER decides which body is the target
  selectOnly(sel, {ref("body_4", EntityKind::Body, ""), ref("body_13", EntityKind::Body, "")});
  CHECK(registry.dispatch("part.boolean_subtract", sel).ok());
  CHECK_EQ_STR(lastLine(doc), "%14 = CUT(%12, %13)");
  CHECK_EQ_INT(doc.valueFor("body_4"), 14);  // the target survives, with history
  CHECK_EQ_INT(doc.valueFor("body_13"), 0);  // the tool was CONSUMED
  // and a command on the consumed body is now refused, not silently wrong
  selectOnly(sel, {ref("body_13", EntityKind::Edge, "e1")});
  CHECK_EQ_INT(statusOf(registry.evaluate("part.fillet", sel, params1("radius", 1))),
               static_cast<int>(DispatchStatus::Disabled));

  // ── (c) the whole emitted program is kernel-legal ─────────────────────────
  const std::string program = doc.irProgram();
  CHECK_EQ_STR(program,
               "%1 = RECT(80, 60)\n"
               "%2 = CIRCLE(12)\n"
               "%3 = BOX(5, 5, 5)\n"
               "%4 = EXTRUDE(%1, 20)\n"
               "%5 = FILLET(%4, 4, ALL)\n"
               "%6 = HOLE(%5, 10, 0, 0, 0)\n"
               "%7 = HOLE(%6, 10, 25, -15, 0, 0, 0, 1, 8)\n"
               "%8 = CBORE(%7, 11, 18, 6, 0, 0, 0)\n"
               "%9 = SHELL(%8, 2)\n"
               "%10 = PATTERN(%9, LINEAR, 4, 30)\n"
               "%11 = PATTERN(%10, POLAR, 6, 360)\n"
               "%12 = MIRROR(%11, YZ)\n"
               "%13 = EXTRUDE(%2, 30)\n"
               "%14 = CUT(%12, %13)\n");
  for (const FeatureRecord& r : doc.records()) {
    CHECK_EQ_INT(static_cast<int>(validateIr(r.line)), static_cast<int>(IrCheck::Ok));
  }
  CHECK_EQ_INT(doc.records().size(), 14);
  CHECK_EQ_INT(doc.featureCount(), 11);  // 14 statements - 3 seeds

  // ── (d) UNDO CONTRACT ─────────────────────────────────────────────────────
  CHECK_EQ_INT(undoStack.undoDepth(), 11);
  CHECK_EQ_STR(undoStack.undoLabel(), "Subtract");

  // Driven through the CARETAKER, because the Part workspace no longer registers
  // an undo command of its own: ForgeShell's ONE edit.undo owns that, through
  // forge::ui::DocumentHost, and forge-desktop's document gate asserts the whole
  // path (command -> host -> this stack -> re-tessellated viewport).
  CHECK(undoStack.undo(doc));
  CHECK_EQ_INT(doc.records().size(), 13);
  CHECK_EQ_INT(doc.valueFor("body_4"), 12);   // the pre-CUT binding is BACK
  CHECK_EQ_INT(doc.valueFor("body_13"), 13);  // and so is the consumed tool
  CHECK_EQ_INT(undoStack.redoDepth(), 1);
  CHECK_EQ_STR(undoStack.redoLabel(), "Subtract");

  CHECK(undoStack.redo(doc));
  CHECK_EQ_INT(doc.records().size(), 14);
  // redo replays the SAME statement id — an id that drifted would silently
  // rewrite every later `%N` in the program
  CHECK_EQ_STR(doc.irProgram(), program);
  CHECK_EQ_INT(undoStack.redoDepth(), 0);

  // redo is refused when there is nothing to redo
  CHECK(!undoStack.redo(doc));
  CHECK_EQ_INT(undoStack.redoDepth(), 0);

  // a NEW edit after an undo abandons the redo branch (linear undo)
  CHECK(undoStack.undo(doc));
  CHECK_EQ_INT(undoStack.redoDepth(), 1);
  selectOnly(sel, {ref("body_4", EntityKind::Edge, "e9")});
  CHECK(registry.dispatch("part.chamfer", sel, params1("distance", 1.5)).ok());
  CHECK_EQ_INT(undoStack.redoDepth(), 0);
  CHECK(!undoStack.redo(doc));
  CHECK_EQ_STR(lastLine(doc), "%14 = CHAMFER(%12, 1.5, ALL)");

  // undo all the way down, then check undo is refused at the floor
  while (undoStack.undoDepth() > 0) {
    CHECK(undoStack.undo(doc));
  }
  CHECK_EQ_INT(doc.records().size(), 3);  // only the three seeds remain
  CHECK_EQ_INT(doc.featureCount(), 0);
  CHECK(!undoStack.undo(doc));
  // ONE UNDO STACK, ONE UNDO COMMAND: the registry must not carry a second
  // Undo over this same caretaker.
  CHECK(!registry.contains("part.undo"));
  CHECK(!registry.contains("part.redo"));
  for (const std::string& id : partCommandIds()) {
    CHECK(id != "part.undo" && id != "part.redo");
  }
  CHECK_EQ_INT(doc.valueFor("body_4"), 0);  // the extruded body went with it
  CHECK_EQ_INT(doc.valueFor("sketch_1"), 1);  // the seeds did not

  // ── LOFT, REVOLVE, BLEND — on a separate document ─────────────────────────
  {
    CommandRegistry reg2;
    PartDocument doc2;
    UndoStack stack2;
    SelectionService sel2;
    CHECK_EQ_INT(registerPartCommands(reg2, doc2, stack2), 44);
    doc2.seed(IrValueKind::Profile, "sk_a", "CIRCLE", {IrArg::num(20)});
    doc2.seed(IrValueKind::Profile, "sk_b", "CIRCLE", {IrArg::num(12)});
    doc2.seed(IrValueKind::Profile, "sk_c", "CIRCLE", {IrArg::num(6)});
    // LOFT's sections are WIRE values, not PROFILE ones: the kernel's opLoft() puts every
    // %ref through refWire(). Seeded at three DIFFERENT heights, because that is the thing
    // a Z=0 sketch cannot express and the reason forge::ft has a separate WIRE kind at all.
    doc2.seed(IrValueKind::Wire, "wr_a", "RING", {IrArg::num(20), IrArg::num(20), IrArg::num(0)});
    doc2.seed(IrValueKind::Wire, "wr_b", "RING", {IrArg::num(12), IrArg::num(12), IrArg::num(30)});
    doc2.seed(IrValueKind::Wire, "wr_c", "RING", {IrArg::num(6), IrArg::num(6), IrArg::num(60)});

    // one section is not a loft
    selectOnly(sel2, {ref("wr_a", EntityKind::Wire, "a")});
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.loft", sel2)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

    // TWO PROFILES is the statement this command used to write, and forge::ft refuses it:
    // "LOFT: %1 is not a WIRE section (use RING(...) or WIRE([...]))". The app must not be
    // the thing that authors it, so the selection is not even signature-legal now.
    selectOnly(sel2, {ref("sk_a", EntityKind::Sketch, "a"), ref("sk_b", EntityKind::Sketch, "b")});
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.loft", sel2)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

    selectOnly(sel2, {ref("wr_a", EntityKind::Wire, "a"), ref("wr_b", EntityKind::Wire, "b"),
                      ref("wr_c", EntityKind::Wire, "c")});
    CommandParams p;
    p.setFlag("ruled", true);
    CHECK(reg2.dispatch("part.loft", sel2, p).ok());
    CHECK_EQ_STR(lastLine(doc2), "%7 = LOFT(%4, %5, %6, RULED)");
    CHECK_EQ_INT(static_cast<int>(doc2.lastCheck()), static_cast<int>(IrCheck::Ok));

    // revolve's documented domain is 0 < angle <= 360
    selectOnly(sel2, {ref("sk_a", EntityKind::Sketch, "a")});
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.revolve", sel2, params1("angle", 0))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.revolve", sel2, params1("angle", 361))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK(reg2.dispatch("part.revolve", sel2, params1("angle", 270)).ok());
    CHECK_EQ_STR(lastLine(doc2), "%8 = REVOLVE(%1, 270)");

    // variable fillet: SMOOTH is positional, so the selector slot before it has
    // to be written or the kernel reads SMOOTH as the selector
    selectOnly(sel2, {ref("body_7", EntityKind::Edge, "e1")});
    CommandParams vf;
    vf.setNumber("radius_start", 1);
    vf.setNumber("radius_end", 4);
    vf.setFlag("smooth", true);
    CHECK(reg2.dispatch("part.variable_fillet", sel2, vf).ok());
    CHECK_EQ_STR(lastLine(doc2), "%9 = BLEND(%7, 1, 4, ALL, SMOOTH)");

    // grid pattern, and a 1x1 grid refused
    selectOnly(sel2, {ref("body_7", EntityKind::Body, "")});
    CommandParams g;
    g.setNumber("nx", 1);
    g.setNumber("ny", 1);
    g.setNumber("dx", 10);
    g.setNumber("dy", 10);
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.pattern_grid", sel2, g)),
                 static_cast<int>(DispatchStatus::Disabled));
    g.setNumber("nx", 3);
    CHECK(reg2.dispatch("part.pattern_grid", sel2, g).ok());
    CHECK_EQ_STR(lastLine(doc2), "%10 = PATTERN(%9, GRID, 3, 1, 10, 10)");

    // union and intersect, on two live bodies
    selectOnly(sel2, {ref("sk_b", EntityKind::Sketch, "b")});
    CHECK(reg2.dispatch("part.extrude", sel2, params1("distance", 5)).ok());
    CHECK_EQ_STR(lastLine(doc2), "%11 = EXTRUDE(%2, 5)");
    selectOnly(sel2, {ref("body_7", EntityKind::Body, ""), ref("body_11", EntityKind::Body, "")});
    CHECK(reg2.dispatch("part.boolean_union", sel2).ok());
    CHECK_EQ_STR(lastLine(doc2), "%12 = FUSE(%10, %11)");

    selectOnly(sel2, {ref("sk_c", EntityKind::Sketch, "c")});
    CHECK(reg2.dispatch("part.extrude", sel2, params1("distance", 5)).ok());
    selectOnly(sel2, {ref("body_7", EntityKind::Body, ""), ref("body_13", EntityKind::Body, "")});
    CHECK(reg2.dispatch("part.boolean_intersect", sel2).ok());
    CHECK_EQ_STR(lastLine(doc2), "%14 = COMMON(%12, %13)");

    for (const FeatureRecord& r : doc2.records()) {
      CHECK_EQ_INT(static_cast<int>(validateIr(r.line)), static_cast<int>(IrCheck::Ok));
    }
    CHECK_EQ_INT(doc2.records().size(), 14);
  }

  // ── the document refuses a statement it cannot number or validate ─────────
  {
    PartDocument doc3;
    FeatureRecord bad;
    bad.irId = 7;  // not nextIrId()
    bad.commandId = "x";
    bad.line = IrLine{7, "HEAL", {IrArg::valueRef(1)}};
    CHECK(!doc3.appendFeature(bad, {}, "b"));
    CHECK_EQ_INT(static_cast<int>(doc3.lastCheck()), static_cast<int>(IrCheck::BadStatementId));
    CHECK_EQ_INT(doc3.records().size(), 0);

    FeatureRecord bad2;
    bad2.irId = 1;
    bad2.commandId = "x";
    bad2.line = IrLine{1, "FILLET", {IrArg::valueRef(0)}};  // too few args
    CHECK(!doc3.appendFeature(bad2, {}, "b"));
    CHECK_EQ_INT(static_cast<int>(doc3.lastCheck()), static_cast<int>(IrCheck::TooFewArgs));
    CHECK_EQ_INT(doc3.records().size(), 0);
    CHECK_EQ_INT(doc3.valueFor("b"), 0);  // a refused append binds nothing
  }


  // ── a REFUSED REDO must not destroy the edit ──────────────────────────────
  // redo() pops from undone_ BEFORE it knows whether apply() will succeed. When
  // apply() is refused the popped unique_ptr must go back, or the redo entry is
  // destructed and that step of the user's history is gone with no message.
  // apply() really can be refused: AppendFeatureEdit keeps its ORIGINAL ir id by
  // design, and PartDocument::seed is public and appends WITHOUT going through
  // the stack — so perform -> undo -> seed -> redo makes the id stale.
  {
    CommandRegistry regR;
    PartDocument docR;
    UndoStack stackR;
    SelectionService selR;
    CHECK_EQ_INT(registerPartCommands(regR, docR, stackR), 44);
    CHECK_EQ_INT(docR.seed(IrValueKind::Profile, "sk_r", "RECT", {IrArg::num(8), IrArg::num(6)}),
                 1);
    selectOnly(selR, {ref("sk_r", EntityKind::Sketch, "")});
    CHECK(regR.dispatch("part.extrude", selR, params1("distance", 5)).ok());
    CHECK_EQ_STR(lastLine(docR), "%2 = EXTRUDE(%1, 5)");
    CHECK(stackR.undo(docR));
    CHECK_EQ_INT(docR.records().size(), 1);
    CHECK_EQ_INT(stackR.redoDepth(), 1);

    // A mutation outside the stack takes the id the pending redo owns.
    CHECK_EQ_INT(docR.seed(IrValueKind::Profile, "sk_r2", "CIRCLE", {IrArg::num(3)}), 2);
    CHECK(!stackR.redo(docR));  // %2 is taken, so the statement cannot be replayed
    CHECK_EQ_INT(static_cast<int>(docR.lastCheck()), static_cast<int>(IrCheck::BadStatementId));
    CHECK_EQ_INT(docR.records().size(), 2);  // the refusal mutated nothing
    // THE CONTRACT: a refused redo leaves the stack exactly as it found it.
    CHECK_EQ_INT(stackR.redoDepth(), 1);
    CHECK_EQ_STR(stackR.redoLabel(), "Extrude");
    // and it is still refused for the same reason, not silently gone
    CHECK(!stackR.redo(docR));
    CHECK_EQ_INT(stackR.redoDepth(), 1);
  }

  // ── a fractional count is not a count — for EVERY pattern ─────────────────
  // LINEAR and CIRCULAR both refuse a non-integral count. GRID must too, or the
  // one pattern that takes two counts is the one that ships `PATTERN(GRID, 1.5,
  // 2, ...)` to a kernel whose instance count is an integer.
  {
    CommandRegistry regP;
    PartDocument docP;
    UndoStack stackP;
    SelectionService selP;
    CHECK_EQ_INT(registerPartCommands(regP, docP, stackP), 44);
    docP.seed(IrValueKind::Solid, "solid_p", "BOX",
              {IrArg::num(10), IrArg::num(10), IrArg::num(10)});
    selectOnly(selP, {ref("solid_p", EntityKind::Body, "")});

    CommandParams g;
    g.setNumber("dx", 10);
    g.setNumber("dy", 10);
    const int disabled = static_cast<int>(DispatchStatus::Disabled);
    g.setNumber("nx", 1.5);
    g.setNumber("ny", 2);
    CHECK_EQ_INT(statusOf(regP.evaluate("part.pattern_grid", selP, g)), disabled);
    g.setNumber("nx", 2);
    g.setNumber("ny", 2.5);
    CHECK_EQ_INT(statusOf(regP.evaluate("part.pattern_grid", selP, g)), disabled);
    // the same input shape LINEAR and CIRCULAR already refuse
    CHECK_EQ_INT(statusOf(regP.evaluate("part.pattern_linear", selP,
                                        [] { CommandParams p; p.setNumber("count", 2.5);
                                             p.setNumber("dx", 10); return p; }())),
                 disabled);
    CHECK_EQ_INT(statusOf(regP.evaluate("part.pattern_circular", selP, params1("count", 2.5))),
                 disabled);
    // NOT ASSERTED, deliberately: wholeCount() also refuses |v| >= 2^63 so its
    // static_cast<long long> is DEFINED. That guard was mutation-tested and the
    // 1e300 checks stayed GREEN with it removed -- on clang 17 / arm64 -O2 the
    // out-of-range cast happens to round-trip to something != 1e300, so the
    // verdict is identical and the check could not fail. A check that cannot fail
    // is not coverage, so it was deleted. GAP: the guard is unproven here and
    // only a UBSan build (-fsanitize=undefined) can prove it.

    // integral counts still pass, so the check is not simply "always off"
    g.setNumber("nx", 2);
    g.setNumber("ny", 3);
    CHECK(regP.dispatch("part.pattern_grid", selP, g).ok());
    CHECK_EQ_STR(lastLine(docP), "%2 = PATTERN(%1, GRID, 2, 3, 10, 10)");
    CHECK_EQ_INT(docP.records().size(), 2);
  }


  // ── execute() must fail closed when it is called OUTSIDE dispatch() ───────
  // dispatch() runs the enabled predicate first, so through THAT door the
  // handlers can never see a selection their predicate rejected. But
  // CommandRegistry::find() returns the descriptor with its public `execute`,
  // so the predicate is a convention and not an enforcement, and the three
  // handlers that indexed a selection-derived vector CRASHED rather than
  // refusing: measured exit 139 (SIGSEGV) on an empty selection, because
  // resolveValues returns a default-constructed vector whose data pointer is
  // null and front() dereferences it.
  {
    CommandRegistry regX;
    PartDocument docX;
    UndoStack stackX;
    SelectionService selX;  // EMPTY, and never populated
    CHECK_EQ_INT(registerPartCommands(regX, docX, stackX), 44);
    docX.seed(IrValueKind::Profile, "sk_x", "RECT", {IrArg::num(4), IrArg::num(4)});

    const std::vector<std::string> indexing = {"part.extrude", "part.revolve",
                                               "part.boolean_union", "part.boolean_subtract",
                                               "part.boolean_intersect"};
    for (const std::string& id : indexing) {
      const CommandDescriptor* c = regX.find(id);
      CHECK(c != nullptr);
      if (c == nullptr) continue;
      CommandParams p;
      p.setNumber("distance", 5);
      p.setNumber("angle", 90);
      CommandContext ctx(selX, p);
      c->execute(ctx);                        // deliberately bypassing dispatch()
      CHECK(ctx.failed());                    // refused, in words
      CHECK(!ctx.failureDetail().empty());
    }
    CHECK_EQ_INT(docX.records().size(), 1);   // the seed, and nothing else
    // and the same commands still WORK through the front door
    selectOnly(selX, {ref("sk_x", EntityKind::Sketch, "")});
    CHECK(regX.dispatch("part.extrude", selX, params1("distance", 5)).ok());
    CHECK_EQ_STR(lastLine(docX), "%2 = EXTRUDE(%1, 5)");
  }

  // ── GENERATION FROM AN EMPTY DOCUMENT ─────────────────────────────────────
  // The point of part.sketch_rect, and the only assertion that proves it.
  //
  // archie_op_vocabulary.json computes `value_kind_closure` about itself and used to
  // report a PROFILE gap: EXTRUDE and REVOLVE consume PROFILE, every one of the allowed
  // ops takes a value reference as its first argument, and the only kind any of them
  // produced was SOLID. From an empty document NO legal program existed -- so the
  // constraint "Archie may emit only what a user can invoke" described an EMPTY LANGUAGE,
  // and every earlier test in this file had to SEED a profile the user could not create.
  //
  // Nothing is seeded here. Not one value. If this section can build a solid, the
  // constraint is satisfiable; if it cannot, no amount of training makes it so.
  {
    CommandRegistry regE;
    PartDocument docE;
    UndoStack stackE;
    SelectionService selE;
    registerPartCommands(regE, docE, stackE);
    CHECK_EQ_INT(docE.records().size(), 0);   // EMPTY. no seed.

    // a creator takes no selection, and must be callable with none
    selE.clearSelection();
    CHECK(regE.dispatch("part.sketch_rect", selE,
                        params2("width", 40, "height", 30)).ok());
    CHECK_EQ_STR(lastLine(docE), "%1 = RECT(40, 30)");
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(1)), static_cast<int>(IrValueKind::Profile));
    CHECK_EQ_INT(docE.valueFor("sketch_1"), 1);

    // a degenerate rectangle is refused by the predicate, not built and thrown away
    CHECK_EQ_INT(statusOf(regE.dispatch("part.sketch_rect", selE,
                                        params2("width", 0, "height", 30))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(docE.records().size(), 1);

    // the created profile is SELECTABLE, which is what makes it usable downstream
    selectOnly(selE, {ref("sketch_1", EntityKind::Sketch, "s")});
    CHECK(regE.dispatch("part.extrude", selE, params1("distance", 20)).ok());
    CHECK_EQ_STR(lastLine(docE), "%2 = EXTRUDE(%1, 20)");
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(2)), static_cast<int>(IrValueKind::Solid));

    // and the solid drives a solid-editing command, closing the loop
    selectOnly(selE, {ref("body_2", EntityKind::Edge, "e")});
    CHECK(regE.dispatch("part.fillet", selE, params1("radius", 2)).ok());
    CHECK_EQ_STR(lastLine(docE), "%3 = FILLET(%2, 2, ALL)");

    // three statements, none seeded, all user-invocable
    CHECK_EQ_INT(docE.records().size(), 3);
    CHECK_EQ_INT(docE.featureCount(), 3);
    CHECK_EQ_INT(static_cast<int>(docE.lastCheck()), static_cast<int>(IrCheck::Ok));

    // ── the SECOND profile producer ─────────────────────────────────────────
    selE.clearSelection();
    CHECK(regE.dispatch("part.sketch_circle", selE, params1("radius", 10)).ok());
    CHECK_EQ_STR(lastLine(docE), "%4 = CIRCLE(10)");
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(4)), static_cast<int>(IrValueKind::Profile));

    // ── POSITIONING, and why it is not a nicety ─────────────────────────────
    // TRANSLATE was orphan, so every boolean in this registry could only ever operate on
    // bodies coincident at the origin. Build a second body, MOVE it, and subtract: that
    // sequence was unreachable before part.move existed, which made the booleans
    // reachable but not useful.
    selectOnly(selE, {ref("sketch_4", EntityKind::Sketch, "s2")});
    CHECK(regE.dispatch("part.extrude", selE, params1("distance", 30)).ok());
    CHECK_EQ_STR(lastLine(docE), "%5 = EXTRUDE(%4, 30)");

    selectOnly(selE, {ref("body_5", EntityKind::Body, "")});
    CHECK(regE.dispatch("part.move", selE, params2("dx", 15, "dy", 5)).ok());
    CHECK_EQ_STR(lastLine(docE), "%6 = TRANSLATE(%5, 15, 5, 0)");
    // the body keeps its IDENTITY -- history, not a new body
    CHECK_EQ_INT(docE.valueFor("body_5"), 6);
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(6)), static_cast<int>(IrValueKind::Solid));

    // a zero move is refused rather than recorded as a no-op statement
    CHECK_EQ_INT(statusOf(regE.dispatch("part.move", selE, params2("dx", 0, "dy", 0))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(docE.records().size(), 6);

    // and now a boolean between two bodies that are NOT coincident
    selectOnly(selE, {ref("body_2", EntityKind::Body, ""), ref("body_5", EntityKind::Body, "")});
    CHECK(regE.dispatch("part.boolean_subtract", selE).ok());
    CHECK_EQ_STR(lastLine(docE), "%7 = CUT(%3, %6)");
    CHECK_EQ_INT(docE.records().size(), 7);
    CHECK_EQ_INT(static_cast<int>(docE.lastCheck()), static_cast<int>(IrCheck::Ok));

    // ── the WIRE producer, and the loft it makes reachable ──────────────────
    // WIRE was the last open value-kind gap: LOFT consumed it and no user-invocable op
    // produced one. Closing it needed BOTH halves -- a producer, and part.loft resolving
    // the kind the kernel's refWire() actually demands. Two sections at DIFFERENT heights
    // and a loft between them is the sequence that could not be authored before.
    selE.clearSelection();
    CommandParams r0;
    r0.setNumber("rx", 20);
    r0.setNumber("ry", 20);
    r0.setNumber("z", 0);
    CHECK(regE.dispatch("part.section_ring", selE, r0).ok());
    CHECK_EQ_STR(lastLine(docE), "%8 = RING(20, 20, 0)");
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(8)), static_cast<int>(IrValueKind::Wire));
    CHECK_EQ_INT(docE.valueFor("wire_8"), 8);

    // the four optional arguments are POSITIONAL, so supplying ONE emits the whole group
    // with the kernel's own defaults in the slots before it. Emitting p alone would put
    // the superellipse exponent in cx and build a different ring.
    CommandParams r1;
    r1.setNumber("rx", 12);
    r1.setNumber("ry", 12);
    r1.setNumber("z", 40);
    r1.setNumber("p", 4);
    CHECK(regE.dispatch("part.section_ring", selE, r1).ok());
    CHECK_EQ_STR(lastLine(docE), "%9 = RING(12, 12, 40, 0, 0, 4, 48)");
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(9)), static_cast<int>(IrValueKind::Wire));

    // wireRing() throws on rx <= 0, and SILENTLY CLAMPS p < 2 and seg < 8. Both are
    // refused here: a recorded statement that the kernel reads as different numbers is
    // worse than no statement, because nothing downstream can see the substitution.
    CommandParams rBad = r0;
    rBad.setNumber("rx", 0);
    CHECK_EQ_INT(statusOf(regE.dispatch("part.section_ring", selE, rBad)),
                 static_cast<int>(DispatchStatus::Disabled));
    rBad = r0;
    rBad.setNumber("p", 1);
    CHECK_EQ_INT(statusOf(regE.dispatch("part.section_ring", selE, rBad)),
                 static_cast<int>(DispatchStatus::Disabled));
    rBad = r0;
    rBad.setNumber("seg", 4);
    CHECK_EQ_INT(statusOf(regE.dispatch("part.section_ring", selE, rBad)),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(docE.records().size(), 9);

    // a PROFILE pair does not enable LOFT -- that is the emission the kernel refuses
    selectOnly(selE, {ref("sketch_1", EntityKind::Sketch, "s"),
                      ref("sketch_4", EntityKind::Sketch, "s2")});
    CHECK_EQ_INT(statusOf(regE.evaluate("part.loft", selE)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

    // the two created sections are SELECTABLE, and the loft closes the loop
    selectOnly(selE, {ref("wire_8", EntityKind::Wire, "w1"),
                      ref("wire_9", EntityKind::Wire, "w2")});
    CHECK(regE.dispatch("part.loft", selE).ok());
    CHECK_EQ_STR(lastLine(docE), "%10 = LOFT(%8, %9)");
    CHECK_EQ_INT(static_cast<int>(docE.kindOf(10)), static_cast<int>(IrValueKind::Solid));
    CHECK_EQ_INT(docE.records().size(), 10);
    CHECK_EQ_INT(docE.featureCount(), 10);
    CHECK_EQ_INT(static_cast<int>(docE.lastCheck()), static_cast<int>(IrCheck::Ok));

    // ten statements, none seeded, every one authored by a command a user can invoke
    for (const FeatureRecord& r : docE.records()) {
      CHECK_EQ_INT(static_cast<int>(validateIr(r.line)), static_cast<int>(IrCheck::Ok));
      CHECK(!r.commandId.empty());
    }
  }

  // ── (d2) THE KERNEL PRIMITIVES ────────────────────────────────────────────
  // Ten ops the kernel implemented, forge::ui::irOpTable() knew, and NO COMMAND
  // EMITTED, so `archie_op_vocabulary.json` listed every one under `forbidden_ops`
  // with the same reason: "no command in the forge::ui registry emits it, so no user
  // can produce it". A CAD application with no cylinder primitive. The app even
  // SEEDED a BOX into every document (see block (e) below, which does exactly that)
  // while giving the user no way to author one.
  //
  // Two things are asserted per command, and neither is decoration:
  //
  //   THE EMITTED TEXT, because argument order is where a primitive goes wrong
  //   SILENTLY. `REGPOLY(r, n)` takes the radius first and `PRISM(nSides, R, h)`
  //   takes the count first -- opposite orders for the same two numbers -- and both
  //   spellings compile either way. Every string below was measured against closed
  //   form through the native kernel before the command was written (D-038).
  //
  //   THE REFUSAL of degenerate input, because Primitives.cpp THROWS on it
  //   (requirePositive, "tube.rInner must be < rOuter", "torus.minorR must be <
  //   majorR (self-intersecting otherwise)", "prism.nSides must be >= 3"). A command
  //   that offers itself as callable where the kernel will throw is a menu item that
  //   cannot work, so each predicate is driven to Disabled here rather than assumed.
  //
  // Nothing is seeded. These are creators: they take no selection, which is what
  // makes them reachable from an empty document.
  {
    CommandRegistry regN;
    PartDocument docN;
    UndoStack stackN;
    SelectionService selN;
    CHECK_EQ_INT(registerPartCommands(regN, docN, stackN), 44);
    CHECK_EQ_INT(docN.records().size(), 0);  // EMPTY. no seed.

    // ── the minimal form of each: required parameters only ──────────────────
    CommandParams p;
    p.setNumber("dx", 40); p.setNumber("dy", 30); p.setNumber("dz", 20);
    CHECK(regN.dispatch("part.primitive_box", selN, p).ok());
    CHECK_EQ_STR(lastLine(docN), "%1 = BOX(40, 30, 20)");
    CHECK_EQ_INT(static_cast<int>(docN.kindOf(1)), static_cast<int>(IrValueKind::Solid));
    CHECK_EQ_INT(docN.valueFor("body_1"), 1);

    CHECK(regN.dispatch("part.primitive_cylinder", selN,
                        params2("radius", 10, "height", 25)).ok());
    CHECK_EQ_STR(lastLine(docN), "%2 = CYL(10, 25)");

    CommandParams cone;
    cone.setNumber("radius_base", 10); cone.setNumber("radius_top", 4);
    cone.setNumber("height", 25);
    CHECK(regN.dispatch("part.primitive_cone", selN, cone).ok());
    CHECK_EQ_STR(lastLine(docN), "%3 = CONE(10, 4, 25)");

    CHECK(regN.dispatch("part.primitive_sphere", selN, params1("radius", 10)).ok());
    CHECK_EQ_STR(lastLine(docN), "%4 = SPHERE(10)");

    CHECK(regN.dispatch("part.primitive_torus", selN,
                        params2("major_radius", 30, "minor_radius", 8)).ok());
    CHECK_EQ_STR(lastLine(docN), "%5 = TORUS(30, 8)");

    CommandParams prism;
    prism.setNumber("sides", 6); prism.setNumber("radius", 15); prism.setNumber("height", 20);
    CHECK(regN.dispatch("part.primitive_prism", selN, prism).ok());
    CHECK_EQ_STR(lastLine(docN), "%6 = PRISM(6, 15, 20)");  // COUNT first

    CommandParams tube;
    tube.setNumber("outer_radius", 12); tube.setNumber("inner_radius", 8);
    tube.setNumber("height", 30);
    CHECK(regN.dispatch("part.primitive_tube", selN, tube).ok());
    CHECK_EQ_STR(lastLine(docN), "%7 = TUBE(12, 8, 30)");

    CommandParams rr;
    rr.setNumber("width", 40); rr.setNumber("height", 30); rr.setNumber("corner_radius", 5);
    CHECK(regN.dispatch("part.sketch_rounded_rect", selN, rr).ok());
    CHECK_EQ_STR(lastLine(docN), "%8 = RRECT(40, 30, 5)");
    CHECK_EQ_INT(static_cast<int>(docN.kindOf(8)), static_cast<int>(IrValueKind::Profile));
    CHECK_EQ_INT(docN.valueFor("sketch_8"), 8);  // a PROFILE node, not a body node

    CHECK(regN.dispatch("part.sketch_polygon", selN,
                        params2("radius", 20, "sides", 6)).ok());
    CHECK_EQ_STR(lastLine(docN), "%9 = REGPOLY(20, 6)");  // RADIUS first -- the other order
    CHECK_EQ_INT(static_cast<int>(docN.kindOf(9)), static_cast<int>(IrValueKind::Profile));

    CHECK_EQ_INT(docN.records().size(), 9);

    // ── the optional tail is ONE positional group ───────────────────────────
    // Every kernel primitive reads its optional arguments through
    // `numOpt(op, i, default)`, so a partial group SHIFTS them: emitting `axx` without
    // the centre would put the axis x-component in the `cx` slot and build a different
    // solid that compiles cleanly. Supplying ONE member must emit the WHOLE group with
    // the kernel's own defaults in the slots before it -- including CYL's `axz = 1`,
    // which is the +Z the primitive is built along.
    CommandParams cz;
    cz.setNumber("radius", 6); cz.setNumber("height", 40); cz.setNumber("cz", -10);
    CHECK(regN.dispatch("part.primitive_cylinder", selN, cz).ok());
    CHECK_EQ_STR(lastLine(docN), "%10 = CYL(6, 40, 0, 0, -10, 0, 0, 1)");

    CommandParams ax;
    ax.setNumber("radius", 6); ax.setNumber("height", 40); ax.setNumber("axx", 1);
    ax.setNumber("axz", 0);
    CHECK(regN.dispatch("part.primitive_cylinder", selN, ax).ok());
    CHECK_EQ_STR(lastLine(docN), "%11 = CYL(6, 40, 0, 0, 0, 1, 0, 0)");  // re-aimed onto +X

    CommandParams boxAt = p;
    boxAt.setNumber("cy", 12);
    CHECK(regN.dispatch("part.primitive_box", selN, boxAt).ok());
    CHECK_EQ_STR(lastLine(docN), "%12 = BOX(40, 30, 20, 0, 12, 0)");

    CommandParams ngonAt;
    ngonAt.setNumber("radius", 20); ngonAt.setNumber("sides", 5);
    ngonAt.setNumber("rotation", 18);
    CHECK(regN.dispatch("part.sketch_polygon", selN, ngonAt).ok());
    CHECK_EQ_STR(lastLine(docN), "%13 = REGPOLY(20, 5, 0, 0, 18)");

    CHECK_EQ_INT(docN.records().size(), 13);

    // ── degenerate input is REFUSED, not built and thrown away ──────────────
    // One term per kernel guard, each driven to Disabled. `records()` is re-checked
    // after the sweep: a predicate that returned true and failed later would show up
    // as a statement in the document rather than as a wrong status.
    CommandParams bad;

    bad = p; bad.setNumber("dx", 0);                       // makeBox requirePositive
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_box", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = p; bad.setNumber("dz", -5);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_box", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));

    // a zero-radius cylinder is not a solid -- makeCylinder throws on it
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_cylinder", selN,
                                        params2("radius", 0, "height", 25))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_cylinder", selN,
                                        params2("radius", 10, "height", 0))),
                 static_cast<int>(DispatchStatus::Disabled));

    // CONE accepts a zero radius at ONE end -- that is the apex, and the ordinary cone
    bad = cone; bad.setNumber("radius_top", 0);
    CHECK(regN.dispatch("part.primitive_cone", selN, bad).ok());
    CHECK_EQ_STR(lastLine(docN), "%14 = CONE(10, 0, 25)");
    // ... and not at BOTH: makeCone shims equal radii to makeCylinder, which then throws
    bad = cone; bad.setNumber("radius_base", 0); bad.setNumber("radius_top", 0);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_cone", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = cone; bad.setNumber("radius_base", -1);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_cone", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));

    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_sphere", selN, params1("radius", 0))),
                 static_cast<int>(DispatchStatus::Disabled));

    // "torus.minorR must be < majorR (self-intersecting otherwise)" -- and a
    // self-intersecting torus is exactly the shape whose VOLUME still looks plausible
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_torus", selN,
                                        params2("major_radius", 10, "minor_radius", 10))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_torus", selN,
                                        params2("major_radius", 10, "minor_radius", 12))),
                 static_cast<int>(DispatchStatus::Disabled));

    // "prism.nSides must be >= 3", and a count that is not WHOLE is not a count:
    // primPrism reads it through static_cast<int>, which would record 5.9 and build 5
    bad = prism; bad.setNumber("sides", 2);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_prism", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = prism; bad.setNumber("sides", 5.9);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_prism", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = prism; bad.setNumber("radius", 0);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_prism", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));

    // "tube.rInner must be < rOuter"
    bad = tube; bad.setNumber("inner_radius", 12);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_tube", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = tube; bad.setNumber("inner_radius", 0);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.primitive_tube", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));

    // REGPOLY's own n >= 3 and whole-number rules
    CHECK_EQ_INT(statusOf(regN.dispatch("part.sketch_polygon", selN,
                                        params2("radius", 20, "sides", 2))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(statusOf(regN.dispatch("part.sketch_polygon", selN,
                                        params2("radius", 20, "sides", 6.5))),
                 static_cast<int>(DispatchStatus::Disabled));

    // RRECT does not throw -- it CLAMPS, `rr = max(0.1, min(r, min(hw, hh) - 0.1))`, so
    // RRECT(40, 30, 40) would be RECORDED as a 40 mm corner and BUILT as a 14.9 mm one.
    // A statement the kernel reads as different numbers is worse than no statement, so
    // the predicate refuses everything the clamp would touch -- the same rule
    // part.section_ring applies to RING's silently clamped p and seg.
    bad = rr; bad.setNumber("corner_radius", 40);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.sketch_rounded_rect", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = rr; bad.setNumber("corner_radius", 15);   // exactly height/2: still clamped
    CHECK_EQ_INT(statusOf(regN.dispatch("part.sketch_rounded_rect", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = rr; bad.setNumber("corner_radius", 0.05);  // below the 0.1 floor
    CHECK_EQ_INT(statusOf(regN.dispatch("part.sketch_rounded_rect", selN, bad)),
                 static_cast<int>(DispatchStatus::Disabled));
    bad = rr; bad.setNumber("corner_radius", 14.5);  // inside the band: accepted
    CHECK(regN.dispatch("part.sketch_rounded_rect", selN, bad).ok());
    CHECK_EQ_STR(lastLine(docN), "%15 = RRECT(40, 30, 14.5)");

    // 13 + the two accepted rows above; every refusal left the document alone
    CHECK_EQ_INT(docN.records().size(), 15);

    // ── ROTATE, the other half of placement ─────────────────────────────────
    // part.move made TRANSLATE reachable and left ROTATE orphaned, so every solid a
    // user could author was axis-aligned. Like part.move it keeps the body's IDENTITY:
    // the node is consumed and reproduced, so the body gains history.
    selectOnly(selN, {ref("body_1", EntityKind::Body, "")});
    CommandParams rot;
    rot.setNumber("angle", 90);
    rot.setNumber("axy", 1);
    rot.setNumber("axz", 0);
    CHECK(regN.dispatch("part.rotate", selN, rot).ok());
    CHECK_EQ_STR(lastLine(docN), "%16 = ROTATE(%1, 90, 0, 1, 0)");
    CHECK_EQ_INT(docN.valueFor("body_1"), 16);  // identity kept, not a new body
    CHECK_EQ_INT(static_cast<int>(docN.kindOf(16)), static_cast<int>(IrValueKind::Solid));

    // the pivot is the ONE optional group; the axis triple is required (arity 5..8).
    // Note the operand: `%16`, not `%1`. The SAME selection now resolves to the value
    // the first rotation produced, which is what "the body keeps its identity and gains
    // history" means at the IR level -- a second rotation composes with the first
    // instead of silently re-rotating the original.
    CommandParams about = rot;
    about.setNumber("ox", 10);
    CHECK(regN.dispatch("part.rotate", selN, about).ok());
    CHECK_EQ_STR(lastLine(docN), "%17 = ROTATE(%16, 90, 0, 1, 0, 10, 0, 0)");
    CHECK_EQ_INT(docN.valueFor("body_1"), 17);

    // a zero rotation is a no-op statement -- refused, as part.move refuses a zero move
    CommandParams zero = rot;
    zero.setNumber("angle", 0);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.rotate", selN, zero)),
                 static_cast<int>(DispatchStatus::Disabled));
    // and a ZERO AXIS is worse than a no-op: unlike place(), which re-defaults a
    // degenerate axis to +Z, opRotate hands the vector straight to forge::rotate, which
    // throws "zero axis" natively and builds a gp_Dir from a null vector under OCCT.
    CommandParams noAxis;
    noAxis.setNumber("angle", 90);
    noAxis.setNumber("axx", 0); noAxis.setNumber("axy", 0); noAxis.setNumber("axz", 0);
    CHECK_EQ_INT(statusOf(regN.dispatch("part.rotate", selN, noAxis)),
                 static_cast<int>(DispatchStatus::Disabled));
    // a creator needs no selection; ROTATE needs exactly one BODY
    selN.clearSelection();
    CHECK_EQ_INT(statusOf(regN.evaluate("part.rotate", selN, rot)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

    // ── every statement is legal IR and command-authored, none seeded ───────
    CHECK_EQ_INT(docN.records().size(), 17);
    CHECK_EQ_INT(docN.featureCount(), 17);
    for (const FeatureRecord& r : docN.records()) {
      CHECK_EQ_INT(static_cast<int>(validateIr(r.line)), static_cast<int>(IrCheck::Ok));
      CHECK(!r.commandId.empty());
    }

    // ── and SLOT has no command, ON PURPOSE ─────────────────────────────────
    // SLOT is the fifth kernel profile and the one deliberately left out: measured
    // through the native kernel, SLOT(len, wid) extruded 10 mm has area exactly
    // |(len - wid)*wid - pi*(wid/2)^2| at every size and a bbox spanning
    // +/-(len - wid)/2 rather than +/-len/2 -- both semicircular caps bow INWARD,
    // -50.4% of the promised volume on SLOT(40, 12). See D-038. This asserts the
    // ABSENCE so that adding a command later cannot slip past the decision.
    CHECK(regN.find("part.sketch_slot") == nullptr);
    for (const std::string& id : partCommandIds()) {
      const CommandDescriptor* c = regN.find(id);
      CHECK(c != nullptr);
      if (c != nullptr) CHECK(c->featureIrOp != "SLOT");
    }
  }

  // ── (d2) THE EIGHT EDIT-OP COMMANDS, AND THEIR ARGUMENT ORDER ─────────────
  // Every assertion here is the EMITTED TEXT, compared against the signature
  // transcribed from forge-kernel/include/forge/ft/FeatureTree.hpp -- quoted above
  // each dispatch. That is deliberate and it is the only check that can catch the
  // failure this batch is exposed to: `PUSHFACE(%body, dist, "sel")` has the right
  // op, the right arity and the right value kind, and builds the wrong solid in
  // silence. archie_op_vocabulary_test also compares tokens, but it compares them
  // against a JSON DERIVED FROM THIS SOURCE -- self-consistent, not independent.
  // These lines are written from the kernel header instead.
  {
    CommandRegistry regE2;
    PartDocument docE2;
    UndoStack stackE2;
    SelectionService noneE2;
    CHECK_EQ_INT(registerPartCommands(regE2, docE2, stackE2), 44);
    CHECK_EQ_INT(docE2.records().size(), 0);  // EMPTY: INPUT is a creator

    // INPUT()  -- "bind the task's input STEP as a solid". No selection, no
    // parameter, and it is the ONLY way a document can start from a part it was
    // given rather than one it built.
    CHECK(regE2.dispatch("part.input_solid", noneE2, CommandParams{}).ok());
    CHECK_EQ_STR(lastLine(docE2), "%1 = INPUT()");
    CHECK_EQ_INT(static_cast<int>(docE2.kindOf(1)), static_cast<int>(IrValueKind::Solid));
    CHECK_EQ_INT(docE2.valueFor("body_1"), 1);

    SelectionService faceE2;
    selectOnly(faceE2, {ref("body_1", EntityKind::Face, "f1")});
    SelectionService bodyE2;
    selectOnly(bodyE2, {ref("body_1", EntityKind::Body, "b1")});

    // HEAL(%body)
    CHECK(regE2.dispatch("part.heal", bodyE2, CommandParams{}).ok());
    CHECK_EQ_STR(lastLine(docE2), "%2 = HEAL(%1)");
    // pass-through-shaped: the body keeps its node, so the next command sees %2
    CHECK_EQ_INT(docE2.valueFor("body_1"), 2);

    // TAG(%body, "@name", "declaring-sel")  -- NAME second, SELECTOR third.
    CommandParams tag;
    tag.setText("name", "@datum_a");
    tag.setText("selector", "+Z");
    CHECK(regE2.dispatch("part.tag_feature", faceE2, tag).ok());
    CHECK_EQ_STR(lastLine(docE2), "%3 = TAG(%2, \"@datum_a\", \"+Z\")");

    // opTag throws unless the name starts with '@' and is [a-z0-9_] after it, so the
    // command must be DISABLED there rather than emit a statement that cannot compile.
    CommandParams badTag;
    badTag.setText("name", "datum_a");  // no '@'
    badTag.setText("selector", "+Z");
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.tag_feature", faceE2, badTag)),
                 static_cast<int>(DispatchStatus::Disabled));
    badTag.setText("name", "@datum a");  // a space is not [a-z0-9_]
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.tag_feature", faceE2, badTag)),
                 static_cast<int>(DispatchStatus::Disabled));
    badTag.setText("name", "@");  // '@' alone: opTag's "empty name"
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.tag_feature", faceE2, badTag)),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_STR(lastLine(docE2), "%3 = TAG(%2, \"@datum_a\", \"+Z\")");  // nothing appended

    // VERIFY(%body, "expr", ...)  -- the minimal form is ONE assertion ...
    CommandParams ver;
    ver.setText("assertion", "volume > 0");
    CHECK(regE2.dispatch("part.verify", bodyE2, ver).ok());
    CHECK_EQ_STR(lastLine(docE2), "%4 = VERIFY(%3, \"volume > 0\")");
    // ... and the SECOND is what reaches the variadic form. It carries no
    // hasDefault, so applyDefaults cannot fill it and the one-assertion form above
    // stays reachable.
    CommandParams ver2;
    ver2.setText("assertion", "faces = 6");
    ver2.setText("assertion2", "genus = 0");
    CHECK(regE2.dispatch("part.verify", bodyE2, ver2).ok());
    CHECK_EQ_STR(lastLine(docE2), "%5 = VERIFY(%4, \"faces = 6\", \"genus = 0\")");
    // an empty assertion is a SUPPLIED one the command must refuse, not an absent one
    CommandParams verEmpty;
    verEmpty.setText("assertion", "");
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.verify", bodyE2, verEmpty)),
                 static_cast<int>(DispatchStatus::Disabled));

    // PUSHFACE(%body, "sel", dist)  -- SELECTOR second, DISTANCE third. The reverse
    // order has the same arity and the same value kind and would never be caught by
    // anything that counts arguments.
    CommandParams push;
    push.setText("selector", "+Z");
    push.setNumber("distance", 4);
    CHECK(regE2.dispatch("part.push_face", faceE2, push).ok());
    CHECK_EQ_STR(lastLine(docE2), "%6 = PUSHFACE(%5, \"+Z\", 4)");
    push.setNumber("distance", 0);  // a zero push records a statement and moves nothing
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.push_face", faceE2, push)),
                 static_cast<int>(DispatchStatus::Disabled));

    // RESIZEBORE(%body, "sel", newRadius)  -- a RADIUS, where part.hole takes a
    // diameter. Same shape as PUSHFACE: selector second, number third.
    CommandParams bore;
    bore.setText("selector", "hole:at=21.75,0");
    bore.setNumber("radius", 3.5);
    CHECK(regE2.dispatch("part.resize_bore", faceE2, bore).ok());
    CHECK_EQ_STR(lastLine(docE2), "%7 = RESIZEBORE(%6, \"hole:at=21.75,0\", 3.5)");
    bore.setNumber("radius", -1);
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.resize_bore", faceE2, bore)),
                 static_cast<int>(DispatchStatus::Disabled));

    // DEFEATURE(%body, "sel")
    CommandParams defeat;
    defeat.setText("selector", "radial:all");
    CHECK(regE2.dispatch("part.defeature", faceE2, defeat).ok());
    CHECK_EQ_STR(lastLine(docE2), "%8 = DEFEATURE(%7, \"radial:all\")");
    defeat.setText("selector", "");
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.defeature", faceE2, defeat)),
                 static_cast<int>(DispatchStatus::Disabled));

    // FOLD(%body, hx, hy, hz, len, flangeH, thk, angleDeg [, runDeg=0])
    // Eight required arguments: the hinge point is NOT an optional group.
    CommandParams fold;
    fold.setNumber("hinge_x", 0);
    fold.setNumber("hinge_y", 25);
    fold.setNumber("hinge_z", 10);
    fold.setNumber("length", 60);
    fold.setNumber("flange_height", 15);
    fold.setNumber("thickness", 2);
    fold.setNumber("angle", 90);
    CHECK(regE2.dispatch("part.fold_flange", bodyE2, fold).ok());
    CHECK_EQ_STR(lastLine(docE2), "%9 = FOLD(%8, 0, 25, 10, 60, 15, 2, 90)");
    fold.setNumber("run_angle", 30);  // the ninth, emitted only when supplied
    CHECK(regE2.dispatch("part.fold_flange", bodyE2, fold).ok());
    CHECK_EQ_STR(lastLine(docE2), "%10 = FOLD(%9, 0, 25, 10, 60, 15, 2, 90, 30)");
    fold.setNumber("thickness", 0);  // opFold throws on thk <= 0
    CHECK_EQ_INT(statusOf(regE2.dispatch("part.fold_flange", bodyE2, fold)),
                 static_cast<int>(DispatchStatus::Disabled));

    // Every statement this block produced is legal IR by forge::ui's own validator,
    // which feature_ir_test proves is the kernel's table.
    for (const FeatureRecord& r : docE2.records()) {
      CHECK_EQ_INT(static_cast<int>(validateIr(r.line)), static_cast<int>(IrCheck::Ok));
    }
    CHECK_EQ_INT(docE2.records().size(), 10);
    CHECK_EQ_INT(docE2.featureCount(), 10);
  }

  // ── (d2) SECTION — the fourth boolean, and the one that is NOT a body ─────
  // Registration and a count prove nothing here: `withIrOp == 43` above stays
  // green if part.section_curve emitted FUSE. What distinguishes SECTION from the
  // other three booleans is not its arity — all four take two bodies — it is the
  // two properties below, and BOTH are wrong by default:
  //
  //   THE PRODUCED KIND IS A WIRE. forge::ft::Builder::kindOf() ends in
  //   `default: return Val::Solid`, so an op added without naming itself there is
  //   silently typed a body. A section is the CURVE where two bodies' faces cross
  //   — no faces, no shells, zero volume — so typing it SOLID would offer EXTRUDE
  //   on it and refuse LOFT, which is exactly backwards. Both are asserted.
  //
  //   IT CONSUMES NEITHER OPERAND. FUSE/CUT/COMMON absorb the tool body and its
  //   node stops resolving. Both bodies survive a section — taking one measures a
  //   part, it does not modify it — so both must still resolve afterwards, and a
  //   boolean over the SAME pair must still be dispatchable once it is taken.
  {
    CommandRegistry regS;
    PartDocument docS;
    UndoStack stackS;
    SelectionService selS;
    CHECK_EQ_INT(registerPartCommands(regS, docS, stackS), 44);

    const CommandDescriptor* sc = regS.find("part.section_curve");
    CHECK(sc != nullptr);
    if (sc != nullptr) CHECK_EQ_STR(sc->featureIrOp, "SECTION");
    CHECK(findIrOp("SECTION") != nullptr);

    CHECK_EQ_INT(docS.seed(IrValueKind::Solid, "plate", "BOX",
                           {IrArg::num(40), IrArg::num(40), IrArg::num(20)}),
                 1);
    CHECK_EQ_INT(docS.seed(IrValueKind::Solid, "ball", "SPHERE",
                           {IrArg::num(10), IrArg::num(0), IrArg::num(0), IrArg::num(20)}),
                 2);
    CHECK_EQ_INT(docS.seed(IrValueKind::Profile, "sk_s", "CIRCLE", {IrArg::num(5)}), 3);
    CHECK_EQ_INT(docS.seed(IrValueKind::Wire, "ring_a", "RING",
                           {IrArg::num(10), IrArg::num(10), IrArg::num(40)}),
                 4);

    // (b) the signature is two BODIES exactly. One body, and a body paired with a
    // sketch, are both refused — and a refused command leaves the document alone.
    selectOnly(selS, {ref("plate", EntityKind::Body, "")});
    CHECK_EQ_INT(statusOf(regS.evaluate("part.section_curve", selS)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
    selectOnly(selS, {ref("plate", EntityKind::Body, ""), ref("sk_s", EntityKind::Sketch, "")});
    CHECK_EQ_INT(statusOf(regS.evaluate("part.section_curve", selS)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));
    CHECK_EQ_INT(docS.records().size(), 4);

    // (c) the emitted statement, as text, legal against the kernel's own op table
    selectOnly(selS, {ref("plate", EntityKind::Body, ""), ref("ball", EntityKind::Body, "")});
    CHECK(regS.dispatch("part.section_curve", selS).ok());
    CHECK_EQ_STR(lastLine(docS), "%5 = SECTION(%1, %2)");
    CHECK_EQ_INT(static_cast<int>(validateIr(docS.records().back().line)),
                 static_cast<int>(IrCheck::Ok));

    // the produced value is a WIRE, and it is bound to a wire_ node
    CHECK_EQ_INT(static_cast<int>(docS.kindOf(5)), static_cast<int>(IrValueKind::Wire));
    CHECK_EQ_STR(toString(docS.kindOf(5)), "wire");
    CHECK_EQ_STR(docS.nodeFor(5), "wire_5");

    // neither operand was consumed — the whole difference from the other three
    CHECK_EQ_INT(docS.valueFor("plate"), 1);
    CHECK_EQ_INT(docS.valueFor("ball"), 2);

    // a WIRE feeds LOFT ...
    selectOnly(selS, {ref("wire_5", EntityKind::Wire, ""), ref("ring_a", EntityKind::Wire, "")});
    CHECK(regS.dispatch("part.loft", selS).ok());
    CHECK_EQ_STR(lastLine(docS), "%6 = LOFT(%5, %4)");

    // ... and EXTRUDE is not even offered for it: EXTRUDE's signature is one
    // SKETCH, so a section wire cannot reach the profile path at all.
    selectOnly(selS, {ref("wire_5", EntityKind::Wire, "")});
    CHECK_EQ_INT(statusOf(regS.evaluate("part.extrude", selS, params1("distance", 5))),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

    // and the two bodies are still there to be fused, AFTER the section — which a
    // consuming SECTION would have made impossible. FUSE, unlike SECTION, absorbs
    // its tool: `ball` stops resolving, `plate` is rebound to the new body.
    selectOnly(selS, {ref("plate", EntityKind::Body, ""), ref("ball", EntityKind::Body, "")});
    CHECK(regS.dispatch("part.boolean_union", selS).ok());
    CHECK_EQ_STR(lastLine(docS), "%7 = FUSE(%1, %2)");
    CHECK_EQ_INT(docS.valueFor("ball"), 0);
    CHECK_EQ_INT(docS.valueFor("plate"), 7);

    // (d) undo restores the program exactly; redo replays the SAME statement ids
    const std::string program = docS.irProgram();
    CHECK_EQ_INT(docS.featureCount(), 3);
    CHECK(stackS.undo(docS));
    CHECK(stackS.undo(docS));
    CHECK(stackS.undo(docS));
    CHECK_EQ_INT(docS.records().size(), 4);
    CHECK_EQ_INT(docS.valueFor("ball"), 2);   // the section's operands come back
    CHECK(stackS.redo(docS));
    CHECK(stackS.redo(docS));
    CHECK(stackS.redo(docS));
    CHECK_EQ_STR(docS.irProgram(), program);
  }

  // ── (e) THE PARAMETER EDIT ────────────────────────────────────────────────
  // The document was APPEND-ONLY: appendFeature() refuses any statement not
  // numbered nextIrId(), so nothing could change a number already in the
  // program. Every check here asserts the emitted IR TEXT, because that text is
  // what the kernel compiles -- a document that reports "edited" and emits the
  // old statement is the exact failure this block exists to catch.
  {
    CommandRegistry regF;
    PartDocument docF;
    UndoStack stackF;
    SelectionService selF;
    CHECK_EQ_INT(registerPartCommands(regF, docF, stackF), 44);

    // The five statements of the application's own starting part, seeded exactly
    // as the app seeds them: NONE of them is command-authored, so undo cannot
    // reach any of them and the edit path is the ONLY way to change them.
    docF.seed(IrValueKind::Profile, "sk", "RECT", {IrArg::num(80), IrArg::num(50)});
    docF.seed(IrValueKind::Solid, "b2", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20)});
    docF.seed(IrValueKind::Solid, "tool", "CYL",
              {IrArg::num(6), IrArg::num(40), IrArg::num(0), IrArg::num(0), IrArg::num(-10)});
    docF.seed(IrValueKind::Solid, "b4", "CUT", {IrArg::valueRef(2), IrArg::valueRef(3)});
    docF.seed(IrValueKind::Solid, "body", "FILLET",
              {IrArg::valueRef(4), IrArg::num(3), IrArg::keyword("VERTICAL")});
    CHECK_EQ_INT(docF.records().size(), 5);
    CHECK_EQ_INT(docF.featureCount(), 0);
    CHECK_EQ_INT(stackF.undoDepth(), 0);

    // `value` has no honest default, so a bare invocation must be refused by the
    // parameter gate rather than silently resizing the part.
    CHECK_EQ_INT(statusOf(regF.evaluate("part.edit_feature", selF)),
                 static_cast<int>(DispatchStatus::MissingRequiredParameter));
    CHECK_EQ_STR(regF.evaluate("part.edit_feature", selF).detail, "value");
    // It needs NO selection: a tree row is not a viewport pick.
    selF.clearSelection();
    CHECK(regF.evaluate("part.edit_feature", selF, params1("value", 6)).ok());

    // feature 0 == the LAST statement, index 0 == its first NUMBER argument, so
    // the bare form edits the fillet radius and steps over the leading %ref.
    CHECK(regF.dispatch("part.edit_feature", selF, params1("value", 6)).ok());
    CHECK_EQ_STR(docF.records().at(4).line.text(), "%5 = FILLET(%4, 6, VERTICAL)");
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::Ok));
    // one edit == one undo step, and it is the document's stack, not a counter
    CHECK_EQ_INT(stackF.undoDepth(), 1);
    CHECK_EQ_STR(stackF.undoLabel(), "Edit body");

    // an EARLIER statement, by explicit id: the plate width
    CommandParams w;
    w.setNumber("feature", 1);
    w.setNumber("index", 0);
    w.setNumber("value", 120);
    CHECK(regF.dispatch("part.edit_feature", selF, w).ok());
    CHECK_EQ_STR(docF.records().at(0).line.text(), "%1 = RECT(120, 50)");
    // and the SECOND number of the same statement
    CommandParams h;
    h.setNumber("feature", 1);
    h.setNumber("index", 1);
    h.setNumber("value", 65);
    CHECK(regF.dispatch("part.edit_feature", selF, h).ok());
    CHECK_EQ_STR(docF.records().at(0).line.text(), "%1 = RECT(120, 65)");

    // index counts NUMBERS only, so on CUT(%2, %3) -- all refs -- there is no
    // index 0 at all, and the command is DISABLED rather than silently editing
    // the wrong slot.
    CommandParams cut;
    cut.setNumber("feature", 4);
    cut.setNumber("value", 9);
    CHECK_EQ_INT(statusOf(regF.evaluate("part.edit_feature", selF, cut)),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_STR(docF.records().at(3).line.text(), "%4 = CUT(%2, %3)");

    // ...and on CYL(6, 40, 0, 0, -10) index 4 is the LAST number, not the fifth
    // argument of some other statement
    CommandParams z;
    z.setNumber("feature", 3);
    z.setNumber("index", 4);
    z.setNumber("value", -20);
    CHECK(regF.dispatch("part.edit_feature", selF, z).ok());
    CHECK_EQ_STR(docF.records().at(2).line.text(), "%3 = CYL(6, 40, 0, 0, -20)");

    // out of range, in both directions, and a fractional id: refused by the
    // enabled predicate, and the document is byte-identical afterwards
    const std::string before = docF.irProgram();
    const double badIds[3] = {99.0, -3.0, 1.5};
    for (double bad : badIds) {
      CommandParams p2;
      p2.setNumber("feature", bad);
      p2.setNumber("value", 7);
      CHECK_EQ_INT(statusOf(regF.evaluate("part.edit_feature", selF, p2)),
                   static_cast<int>(DispatchStatus::Disabled));
    }
    CommandParams badIndex;
    badIndex.setNumber("feature", 1);
    badIndex.setNumber("index", 9);
    badIndex.setNumber("value", 7);
    CHECK_EQ_INT(statusOf(regF.evaluate("part.edit_feature", selF, badIndex)),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_STR(docF.irProgram(), before);

    // a no-op edit is REFUSED, so the undo stack never holds a step that does
    // nothing -- and the refusal is named, not silent
    const std::size_t depth = stackF.undoDepth();
    CommandParams same;
    same.setNumber("feature", 1);
    same.setNumber("value", 120);
    const DispatchResult noop = regF.dispatch("part.edit_feature", selF, same);
    CHECK_EQ_INT(statusOf(noop), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(noop.detail.find("no_change") != std::string::npos);
    CHECK_EQ_INT(stackF.undoDepth(), depth);
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::NoChange));

    // ── undo / redo of an EDIT, which is not an append ──────────────────────
    stackF.undo(docF);
    CHECK_EQ_STR(docF.records().at(2).line.text(), "%3 = CYL(6, 40, 0, 0, -10)");
    CHECK_EQ_INT(docF.records().size(), 5);  // an edit undo removes NO statement
    stackF.redo(docF);
    CHECK_EQ_STR(docF.records().at(2).line.text(), "%3 = CYL(6, 40, 0, 0, -20)");
    // undo-redo-undo: `before_` is re-captured on every apply, so the second
    // undo restores the same text and not a stale one. Driven through the STACK
    // because part.undo / part.redo are retired -- one undo stack, one Undo command.
    stackF.undo(docF);
    CHECK_EQ_STR(docF.records().at(2).line.text(), "%3 = CYL(6, 40, 0, 0, -10)");
    stackF.redo(docF);
    CHECK_EQ_STR(docF.records().at(2).line.text(), "%3 = CYL(6, 40, 0, 0, -20)");

    // unwinding the whole stack returns the SEEDED program exactly
    while (stackF.undoDepth() > 0) {
      const std::size_t before = stackF.undoDepth();
      stackF.undo(docF);
      // A loop whose body cannot make progress spins for ever. When this dispatched a
      // RETIRED command it never decremented and the gate TIMED OUT at 120s instead of
      // failing, which is the worst way for a test to break. Assert progress.
      CHECK(stackF.undoDepth() < before);
    }
    CHECK_EQ_STR(docF.irProgram(),
                 "%1 = RECT(80, 50)\n"
                 "%2 = EXTRUDE(%1, 20)\n"
                 "%3 = CYL(6, 40, 0, 0, -10)\n"
                 "%4 = CUT(%2, %3)\n"
                 "%5 = FILLET(%4, 3, VERTICAL)\n");
    CHECK_EQ_INT(docF.records().size(), 5);
    // the bindings never moved: an arg edit changes no statement id
    CHECK_EQ_INT(docF.valueFor("body"), 5);
    CHECK_EQ_INT(docF.valueFor("sk"), 1);

    // ── the invariants, asserted on the DOCUMENT directly ───────────────────
    // (the command can never present these, which is the point: they are what
    // makes the command unable to do harm)
    const std::string pristine = docF.irProgram();

    // moving a %ref is a REPARENT, not a parameter edit
    CHECK(!docF.editFeatureArgs(4, {IrArg::valueRef(3), IrArg::valueRef(2)}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::OperandChanged));
    CHECK(!docF.editFeatureArgs(
        5, {IrArg::valueRef(2), IrArg::num(3), IrArg::keyword("VERTICAL")}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::OperandChanged));
    // and so is turning a ref slot into a number
    CHECK(!docF.editFeatureArgs(5, {IrArg::num(4), IrArg::num(3), IrArg::keyword("VERTICAL")}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::OperandChanged));

    // a statement that does not exist
    CHECK(!docF.editFeatureArgs(0, {IrArg::num(1)}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::NoSuchFeature));
    CHECK(!docF.editFeatureArgs(6, {IrArg::num(1)}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::NoSuchFeature));
    CHECK(docF.featureAt(6) == nullptr);
    CHECK(docF.featureAt(0) == nullptr);
    CHECK(docF.featureAt(5) != nullptr);

    // the op table is the authority on arity, and it is enforced HERE, with the
    // document unmutated, rather than three layers down in the compiler
    CHECK(!docF.editFeatureArgs(5, {IrArg::valueRef(4), IrArg::num(3), IrArg::keyword("VERTICAL"),
                                    IrArg::num(1), IrArg::num(2), IrArg::num(3)}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::InvalidStatement));
    CHECK_EQ_INT(static_cast<int>(docF.lastCheck()), static_cast<int>(IrCheck::TooManyArgs));
    CHECK(!docF.editFeatureArgs(5, {IrArg::valueRef(4)}));
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::InvalidStatement));
    CHECK_EQ_INT(static_cast<int>(docF.lastCheck()), static_cast<int>(IrCheck::TooFewArgs));

    // NOT ONE of the refusals above moved a byte
    CHECK_EQ_STR(docF.irProgram(), pristine);

    // dropping a trailing KEYWORD is legal: the refs are untouched and the arity
    // is still inside FILLET's documented range
    CHECK(docF.editFeatureArgs(5, {IrArg::valueRef(4), IrArg::num(3)}));
    CHECK_EQ_STR(docF.records().at(4).line.text(), "%5 = FILLET(%4, 3)");
    // ...and so is changing the selector keyword itself
    CHECK(docF.editFeatureArgs(5, {IrArg::valueRef(4), IrArg::num(3), IrArg::keyword("ALL")}));
    CHECK_EQ_STR(docF.records().at(4).line.text(), "%5 = FILLET(%4, 3, ALL)");
    CHECK_EQ_INT(static_cast<int>(docF.lastEdit()), static_cast<int>(EditCheck::Ok));

    CHECK_EQ_STR(toString(EditCheck::Ok), "ok");
    CHECK_EQ_STR(toString(EditCheck::OperandChanged), "operand_changed");
    CHECK_EQ_STR(toString(EditCheck::NoSuchFeature), "no_such_feature");
    CHECK_EQ_STR(toString(EditCheck::NoChange), "no_change");
    CHECK_EQ_STR(toString(EditCheck::InvalidStatement), "invalid_statement");
  }

  return H.finish();
}
