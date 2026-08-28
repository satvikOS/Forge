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
  CHECK_EQ_INT(added, 18);
  CHECK_EQ_INT(registry.size(), 18);
  CHECK_EQ_INT(registry.ids().size(), partCommandIds().size());
  for (std::size_t i = 0; i < partCommandIds().size(); ++i) {
    CHECK_EQ_STR(at(registry.ids(), i), at(partCommandIds(), i));
  }
  // Re-registering must be refused wholesale: two implementations behind one
  // stable ID is the failure the single registry exists to prevent.
  CHECK_EQ_INT(registerPartCommands(registry, doc, undoStack), 0);
  CHECK_EQ_INT(registry.size(), 18);

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
  CHECK_EQ_INT(withIrOp, 16);  // all but part.undo / part.redo

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

  CHECK(registry.dispatch("part.undo", sel).ok());
  CHECK_EQ_INT(doc.records().size(), 13);
  CHECK_EQ_INT(doc.valueFor("body_4"), 12);   // the pre-CUT binding is BACK
  CHECK_EQ_INT(doc.valueFor("body_13"), 13);  // and so is the consumed tool
  CHECK_EQ_INT(undoStack.redoDepth(), 1);
  CHECK_EQ_STR(undoStack.redoLabel(), "Subtract");

  CHECK(registry.dispatch("part.redo", sel).ok());
  CHECK_EQ_INT(doc.records().size(), 14);
  // redo replays the SAME statement id — an id that drifted would silently
  // rewrite every later `%N` in the program
  CHECK_EQ_STR(doc.irProgram(), program);
  CHECK_EQ_INT(undoStack.redoDepth(), 0);

  // redo is offered only when there is something to redo
  CHECK_EQ_INT(statusOf(registry.evaluate("part.redo", sel)),
               static_cast<int>(DispatchStatus::Disabled));

  // a NEW edit after an undo abandons the redo branch (linear undo)
  CHECK(registry.dispatch("part.undo", sel).ok());
  CHECK_EQ_INT(undoStack.redoDepth(), 1);
  selectOnly(sel, {ref("body_4", EntityKind::Edge, "e9")});
  CHECK(registry.dispatch("part.chamfer", sel, params1("distance", 1.5)).ok());
  CHECK_EQ_INT(undoStack.redoDepth(), 0);
  CHECK_EQ_INT(statusOf(registry.evaluate("part.redo", sel)),
               static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_STR(lastLine(doc), "%14 = CHAMFER(%12, 1.5, ALL)");

  // undo all the way down, then check undo is refused at the floor
  while (undoStack.undoDepth() > 0) {
    CHECK(registry.dispatch("part.undo", sel).ok());
  }
  CHECK_EQ_INT(doc.records().size(), 3);  // only the three seeds remain
  CHECK_EQ_INT(doc.featureCount(), 0);
  CHECK_EQ_INT(statusOf(registry.evaluate("part.undo", sel)),
               static_cast<int>(DispatchStatus::Disabled));
  CHECK_EQ_INT(doc.valueFor("body_4"), 0);  // the extruded body went with it
  CHECK_EQ_INT(doc.valueFor("sketch_1"), 1);  // the seeds did not

  // ── LOFT, REVOLVE, BLEND — on a separate document ─────────────────────────
  {
    CommandRegistry reg2;
    PartDocument doc2;
    UndoStack stack2;
    SelectionService sel2;
    CHECK_EQ_INT(registerPartCommands(reg2, doc2, stack2), 18);
    doc2.seed(IrValueKind::Profile, "sk_a", "CIRCLE", {IrArg::num(20)});
    doc2.seed(IrValueKind::Profile, "sk_b", "CIRCLE", {IrArg::num(12)});
    doc2.seed(IrValueKind::Profile, "sk_c", "CIRCLE", {IrArg::num(6)});

    // one section is not a loft
    selectOnly(sel2, {ref("sk_a", EntityKind::Sketch, "a")});
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.loft", sel2)),
                 static_cast<int>(DispatchStatus::SelectionSignatureMismatch));

    selectOnly(sel2, {ref("sk_a", EntityKind::Sketch, "a"), ref("sk_b", EntityKind::Sketch, "b"),
                      ref("sk_c", EntityKind::Sketch, "c")});
    CommandParams p;
    p.setFlag("ruled", true);
    CHECK(reg2.dispatch("part.loft", sel2, p).ok());
    CHECK_EQ_STR(lastLine(doc2), "%4 = LOFT(%1, %2, %3, RULED)");
    CHECK_EQ_INT(static_cast<int>(doc2.lastCheck()), static_cast<int>(IrCheck::Ok));

    // revolve's documented domain is 0 < angle <= 360
    selectOnly(sel2, {ref("sk_a", EntityKind::Sketch, "a")});
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.revolve", sel2, params1("angle", 0))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.revolve", sel2, params1("angle", 361))),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK(reg2.dispatch("part.revolve", sel2, params1("angle", 270)).ok());
    CHECK_EQ_STR(lastLine(doc2), "%5 = REVOLVE(%1, 270)");

    // variable fillet: SMOOTH is positional, so the selector slot before it has
    // to be written or the kernel reads SMOOTH as the selector
    selectOnly(sel2, {ref("body_4", EntityKind::Edge, "e1")});
    CommandParams vf;
    vf.setNumber("radius_start", 1);
    vf.setNumber("radius_end", 4);
    vf.setFlag("smooth", true);
    CHECK(reg2.dispatch("part.variable_fillet", sel2, vf).ok());
    CHECK_EQ_STR(lastLine(doc2), "%6 = BLEND(%4, 1, 4, ALL, SMOOTH)");

    // grid pattern, and a 1x1 grid refused
    selectOnly(sel2, {ref("body_4", EntityKind::Body, "")});
    CommandParams g;
    g.setNumber("nx", 1);
    g.setNumber("ny", 1);
    g.setNumber("dx", 10);
    g.setNumber("dy", 10);
    CHECK_EQ_INT(statusOf(reg2.evaluate("part.pattern_grid", sel2, g)),
                 static_cast<int>(DispatchStatus::Disabled));
    g.setNumber("nx", 3);
    CHECK(reg2.dispatch("part.pattern_grid", sel2, g).ok());
    CHECK_EQ_STR(lastLine(doc2), "%7 = PATTERN(%6, GRID, 3, 1, 10, 10)");

    // union and intersect, on two live bodies
    selectOnly(sel2, {ref("sk_b", EntityKind::Sketch, "b")});
    CHECK(reg2.dispatch("part.extrude", sel2, params1("distance", 5)).ok());
    CHECK_EQ_STR(lastLine(doc2), "%8 = EXTRUDE(%2, 5)");
    selectOnly(sel2, {ref("body_4", EntityKind::Body, ""), ref("body_8", EntityKind::Body, "")});
    CHECK(reg2.dispatch("part.boolean_union", sel2).ok());
    CHECK_EQ_STR(lastLine(doc2), "%9 = FUSE(%7, %8)");

    selectOnly(sel2, {ref("sk_c", EntityKind::Sketch, "c")});
    CHECK(reg2.dispatch("part.extrude", sel2, params1("distance", 5)).ok());
    selectOnly(sel2, {ref("body_4", EntityKind::Body, ""), ref("body_10", EntityKind::Body, "")});
    CHECK(reg2.dispatch("part.boolean_intersect", sel2).ok());
    CHECK_EQ_STR(lastLine(doc2), "%11 = COMMON(%9, %10)");

    for (const FeatureRecord& r : doc2.records()) {
      CHECK_EQ_INT(static_cast<int>(validateIr(r.line)), static_cast<int>(IrCheck::Ok));
    }
    CHECK_EQ_INT(doc2.records().size(), 11);
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
    CHECK_EQ_INT(registerPartCommands(regR, docR, stackR), 18);
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
    CHECK_EQ_INT(registerPartCommands(regP, docP, stackP), 18);
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
    CHECK_EQ_INT(registerPartCommands(regX, docX, stackX), 18);
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

  return H.finish();
}
