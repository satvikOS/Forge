// ui/test/op_constraint_bridge_test.cpp
//
// CONTRACT -- the op-constraint bridge refuses what a user cannot invoke, and
// the allowed set it enforces is a LANGUAGE rather than an empty promise.
//
// Three authorities are cross-checked here, and no two of them are the same
// file:
//
//   (a) the GENERATED TABLE, ui/include/forge/ui/ArchieOpVocabulary.hpp, written
//       from implementation/sacrosanct/archie_op_vocabulary.json. That the
//       header still matches the vocabulary BYTE FOR BYTE is proved by
//       `gen_op_constraint_table.py --check`, which CI and the CMake build run;
//       it is not re-proved here, because a second JSON reader in C++ would be a
//       third transcription of the same list.
//   (b) forge::ui::irOpTable(), which ui/test/feature_ir_test.cpp separately
//       proves is the KERNEL's own op table. The 18 allowed and the 22 forbidden
//       ops must PARTITION it exactly -- an op classified as neither is drift,
//       and drift is what silently widens a constraint.
//   (c) the LIVE REGISTRY the app builds (ForgeShell + registerPartCommands).
//       Every command that emits an allowed op must have a row, with the same
//       selection signature. A table that agrees with its source and disagrees
//       with the running code teaches a model an API the product does not have.
//
// AND THE QUESTION D-015 RAISED, MEASURED RATHER THAN REMEMBERED. D-015 recorded
// that forge::ui had 31 commands, 14 that emitted IR and NOT ONE that CREATED a
// value, so "emit only what a user can invoke" described an EMPTY language.
// Section 5 drives the LIVE registry from an EMPTY document and reads back what
// it actually produced. If that ever stops being a real program, the bridge
// reports the missing creators as OWED (VocabularyClosure::owedCreatorKinds) and
// this gate fails -- it does not widen the allowed set to compensate.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>` perturbs the vocabulary the bridge
// is built from, or the path the gate takes to it. Each is a regression that has
// a name:
//   1  RECT is dropped from the allowed set  -> the only PROFILE creator is gone;
//                                               the language closes empty again
//   2  BOX is added to the allowed set       -> the constraint silently widened to
//                                               an op no command emits
//   3  EXTRUDE's emitted arity is widened     -> the KERNEL's arity is enforced
//      to the kernel's                          instead of the app's, and a form
//                                               no user can produce is accepted
//   4  FILLET also accepts a Body selection  -> the selection half of the
//                                               constraint stops discriminating
//   5  EXTRUDE's consumed value kind is      -> value flow stops being checked and
//      cleared                                  a SOLID feeds a profile operand
//   6  FILLET stops requiring a leading      -> FILLET(3, 2, ALL) -- a statement
//      %ref                                     with no body -- is accepted
//   7  two of PATTERN's three commands are   -> the table and the live registry
//      dropped from the table                   disagree about what is reachable
//   8  part.sketch_circle is made to require -> a creator that is no longer
//      a selection                              reachable from an empty document
#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ArchieOpVocabulary.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

int g_mutation = 0;

IrLine stmt(int id, const char* op, std::vector<IrArg> args) {
  IrLine line;
  line.id = id;
  line.op = op;
  line.args = std::move(args);
  return line;
}

ProposedOp step(int id, const char* op, std::vector<IrArg> args,
                EntityKind selection = EntityKind::Any, std::size_t count = 0) {
  ProposedOp p;
  p.line = stmt(id, op, std::move(args));
  p.selection = selection;
  p.selectionCount = count;
  return p;
}

bool contains(const std::vector<std::string>& xs, const std::string& x) {
  return std::find(xs.begin(), xs.end(), x) != xs.end();
}

// The perturbations. Each one is a plausible way the constraint stops being a
// constraint -- not a synthetic abort.
OpVocabulary perturbed(OpVocabulary v) {
  const auto opAt = [&v](const std::string& name) -> OpVocabulary::Op* {
    for (OpVocabulary::Op& o : v.ops) {
      if (o.op == name) return &o;
    }
    return nullptr;
  };
  switch (g_mutation) {
    case 1: {  // the only PROFILE creator disappears
      v.ops.erase(std::remove_if(v.ops.begin(), v.ops.end(),
                                 [](const OpVocabulary::Op& o) { return o.op == "RECT"; }),
                  v.ops.end());
      v.commands.erase(std::remove_if(v.commands.begin(), v.commands.end(),
                                      [](const OpVocabulary::Command& c) {
                                        return c.op == "RECT";
                                      }),
                       v.commands.end());
      break;
    }
    case 2: {  // the allowed set is quietly widened to an op no command emits
      OpVocabulary::Op box;
      box.op = "BOX";
      box.produces = IrValueKind::Solid;
      box.kernelMinArgs = 3;
      box.kernelMaxArgs = 6;
      box.firstArgIsValueRef = false;
      box.emittedForms.push_back(OpVocabulary::ArgCounts{3, 3});
      box.commands.push_back("part.make_box");
      v.ops.push_back(std::move(box));
      break;
    }
    case 3: {  // the KERNEL's arity is enforced instead of the app's
      if (OpVocabulary::Op* o = opAt("EXTRUDE")) {
        o->emittedForms.clear();
        o->emittedForms.push_back(OpVocabulary::ArgCounts{o->kernelMinArgs, o->kernelMaxArgs});
      }
      break;
    }
    case 4: {  // the selection half stops discriminating
      OpVocabulary::Command loose;
      loose.id = "part.fillet_any";
      loose.op = "FILLET";
      loose.selection = EntityKind::Body;
      loose.selectionMin = 1;
      loose.selectionMax = 1;
      loose.produces = IrValueKind::Solid;
      v.commands.push_back(std::move(loose));
      if (OpVocabulary::Op* o = opAt("FILLET")) o->commands.push_back("part.fillet_any");
      break;
    }
    case 5: {  // value flow stops being checked
      if (OpVocabulary::Op* o = opAt("EXTRUDE")) o->consumes.clear();
      break;
    }
    case 6: {  // a body-consuming op stops requiring a body
      if (OpVocabulary::Op* o = opAt("FILLET")) o->firstArgIsValueRef = false;
      break;
    }
    case 7: {  // the table falls behind the registry
      v.commands.erase(std::remove_if(v.commands.begin(), v.commands.end(),
                                      [](const OpVocabulary::Command& c) {
                                        return c.id == "part.pattern_grid" ||
                                               c.id == "part.pattern_circular";
                                      }),
                       v.commands.end());
      if (OpVocabulary::Op* o = opAt("PATTERN")) {
        o->commands.erase(std::remove_if(o->commands.begin(), o->commands.end(),
                                         [](const std::string& id) {
                                           return id == "part.pattern_grid" ||
                                                  id == "part.pattern_circular";
                                         }),
                          o->commands.end());
      }
      break;
    }
    case 8: {  // a creator stops being reachable from an empty document
      for (OpVocabulary::Command& c : v.commands) {
        if (c.id == "part.sketch_circle") c.selectionMin = 1;
      }
      break;
    }
    default:
      break;
  }
  return v;
}

EntityRef ref(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

// One dispatch through the real registry, exactly as the Tools panel does it.
DispatchStatus run(CommandRegistry& registry, const std::string& id,
                   const std::vector<EntityRef>& refs, const CommandParams& params) {
  SelectionService sel;
  sel.replaceWith(refs);
  return registry.dispatch(id, sel, params).status;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  Harness H("op_constraint_bridge");
  if (g_mutation != 0) std::printf("  [op-constraint] MUTATION %d ACTIVE\n", g_mutation);

  const OpConstraintBridge bridge(perturbed(generatedVocabulary()));
  const OpVocabulary& V = bridge.vocabulary();

  // ── 1. the generated table transcribed cleanly ───────────────────────────
  // An unmapped spelling would become IrValueKind::None and pass every check
  // below by meaning nothing, so it is asserted before anything is checked WITH
  // the table.
  CHECK_EQ_INT(generatedVocabulary().unmappedSpellings.size(), 0);
  for (const std::string& bad : generatedVocabulary().unmappedSpellings) {
    std::printf("  FAIL unmapped vocabulary spelling: %s\n", bad.c_str());
  }
  CHECK_EQ_INT(generatedVocabulary().ops.size(), vocab::kUserInvocableOpsCount);
  CHECK_EQ_INT(generatedVocabulary().forbidden.size(), vocab::kForbiddenOpsCount);
  CHECK_EQ_INT(generatedVocabulary().commands.size(), vocab::kCommandsEmittingIrCount);
  CHECK_EQ_STR(generatedVocabulary().schema, "forge.archie.op_vocabulary/1");
  CHECK_EQ_INT(generatedVocabulary().sha256.size(), 64);

  // Every allowed op consumes AT MOST ONE value kind. The plan checker leans on
  // this: it applies the op's consumed kind to EVERY %ref argument, which is how
  // one rule covers CUT's two solid operands and LOFT's n wire sections. If an
  // op ever consumed two kinds, that rule would silently mis-check it.
  for (const OpVocabulary::Op& op : V.ops) {
    CHECK_LE_INT(op.consumes.size(), 1);
    CHECK(!op.emittedForms.empty());
    CHECK(!op.commands.empty());
    CHECK(op.produces != IrValueKind::None);
    // A creator is exactly an op that takes no leading value ref, and vice versa.
    CHECK_EQ_INT(op.consumes.empty() ? 1 : 0, op.firstArgIsValueRef ? 0 : 1);
  }

  // ── 2. allowed + forbidden PARTITION the kernel's op table ───────────────
  {
    const std::vector<std::string> allowed = bridge.allowedOps();
    const std::vector<std::string> forbidden = bridge.forbiddenOps();
    for (const std::string& op : allowed) {
      CHECK(!contains(forbidden, op));      // disjoint
      CHECK(findIrOp(op) != nullptr);       // and every one is a real IR op
    }
    for (const std::string& op : forbidden) {
      CHECK(findIrOp(op) != nullptr);
      CHECK(!bridge.allows(op));
    }
    // Total: nothing in the kernel's table is unclassified. An op classified as
    // neither allowed nor forbidden is drift, and the bridge would have to guess.
    std::size_t classified = 0;
    for (const IrOpSpec& spec : irOpTable()) {
      const bool isAllowed = contains(allowed, spec.name);
      const bool isForbidden = contains(forbidden, spec.name);
      CHECK(isAllowed || isForbidden);
      if (!isAllowed && !isForbidden) {
        std::printf("  FAIL op %s is in irOpTable() and in neither list\n", spec.name.c_str());
      }
      if (isAllowed || isForbidden) ++classified;
    }
    CHECK_EQ_INT(classified, irOpTable().size());
    CHECK_EQ_INT(allowed.size() + forbidden.size(), irOpTable().size());
    CHECK_EQ_INT(irOpTable().size(), vocab::kKernelOpsCount);

    // Kernel arity is transcribed, not invented, and the app's emitted forms sit
    // INSIDE it. A form the kernel would refuse is a form the app cannot emit.
    for (const OpVocabulary::Op& op : V.ops) {
      const IrOpSpec* spec = findIrOp(op.op);
      CHECK(spec != nullptr);
      if (spec == nullptr) continue;
      CHECK_EQ_INT(op.kernelMinArgs, spec->minArgs);
      CHECK_EQ_INT(op.kernelMaxArgs, spec->maxArgs);
      CHECK_EQ_INT(op.firstArgIsValueRef ? 1 : 0, spec->firstArgIsValueRef ? 1 : 0);
      for (const OpVocabulary::ArgCounts& form : op.emittedForms) {
        CHECK(form.min >= spec->minArgs);
        CHECK(spec->maxArgs == kIrArgsUnbounded || form.max <= spec->maxArgs);
      }
    }
  }

  // ── 3. the table is what the LIVE REGISTRY does ──────────────────────────
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  const std::size_t partAdded = registerPartCommands(shell.registry(), doc, undo);
  CHECK(partAdded >= 20);
  {
    const std::vector<std::string> liveIds = shell.registry().ids();
    CHECK_EQ_INT(liveIds.size(), V.registryCommandCount);

    std::size_t withIrOp = 0;
    std::size_t rowed = 0;
    std::size_t declaresAnOpTheKernelLacks = 0;
    for (const std::string& id : liveIds) {
      const CommandDescriptor* c = shell.registry().find(id);
      CHECK(c != nullptr);
      if (c == nullptr) continue;
      if (c->featureIrOp.empty()) continue;
      ++withIrOp;

      // No live command may declare a FORBIDDEN op: that would make an op the
      // vocabulary says nobody can reach reachable in one click.
      CHECK(!contains(bridge.forbiddenOps(), c->featureIrOp));

      if (findIrOp(c->featureIrOp) == nullptr) {
        // D-021 records exactly one: edit.delete declares "DELETE", which
        // forge::ft::opFromName does not have, and emits nothing. The bridge
        // must classify it as UNKNOWN rather than allow it.
        ++declaresAnOpTheKernelLacks;
        CHECK_EQ_STR(id, "edit.delete");
        const OpRuling r = bridge.check(step(1, c->featureIrOp.c_str(), {IrArg::valueRef(0)}));
        CHECK_EQ_INT(static_cast<int>(r.verdict), static_cast<int>(OpConstraint::UnknownOp));
        continue;
      }

      CHECK(bridge.allows(c->featureIrOp));
      const OpVocabulary::Command* row = nullptr;
      for (const OpVocabulary::Command& cmd : V.commands) {
        if (cmd.id == id) row = &cmd;
      }
      CHECK(row != nullptr);
      if (row == nullptr) {
        std::printf("  FAIL live command %s emits %s and the table has no row for it\n",
                    id.c_str(), c->featureIrOp.c_str());
        continue;
      }
      ++rowed;
      CHECK_EQ_STR(row->op, c->featureIrOp);
      CHECK_EQ_INT(static_cast<int>(row->selection), static_cast<int>(c->signature.kind));
      CHECK_EQ_INT(row->selectionMin, c->signature.minCount);
      CHECK_EQ_INT(row->selectionMax, c->signature.maxCount);
    }
    CHECK_EQ_INT(rowed, V.commands.size());
    CHECK_EQ_INT(withIrOp, V.commandsEmittingIr + declaresAnOpTheKernelLacks);
    CHECK_EQ_INT(declaresAnOpTheKernelLacks, 1);

    // Every allowed op is named by at least one live command. An op in the
    // allowed set that nothing emits is the constraint widening by neglect.
    for (const std::string& op : bridge.allowedOps()) {
      bool named = false;
      for (const std::string& id : liveIds) {
        const CommandDescriptor* c = shell.registry().find(id);
        if (c != nullptr && c->featureIrOp == op) named = true;
      }
      CHECK(named);
      if (!named) std::printf("  FAIL allowed op %s: no live command emits it\n", op.c_str());
    }
  }

  // ── 4. the rulings ───────────────────────────────────────────────────────
  {
    // ACCEPT: a form the app really emits.
    const OpRuling ok = bridge.check(step(1, "RECT", {IrArg::num(40), IrArg::num(30)},
                                          EntityKind::None, 0));
    CHECK_EQ_INT(static_cast<int>(ok.verdict), static_cast<int>(OpConstraint::Ok));
    CHECK_EQ_STR(ok.reason, "");

    // FORBIDDEN: a real kernel op no command emits. The refusal must quote the
    // vocabulary's own reason, not say "not allowed".
    const OpRuling box = bridge.check(step(1, "BOX",
                                           {IrArg::num(10), IrArg::num(10), IrArg::num(10)}));
    CHECK_EQ_INT(static_cast<int>(box.verdict), static_cast<int>(OpConstraint::ForbiddenOp));
    CHECK(box.reason.find("BOX") != std::string::npos);
    CHECK(box.reason.find("no user can produce it") != std::string::npos);

    // Every forbidden op is refused, every one names itself, and none is allowed.
    for (const std::string& op : bridge.forbiddenOps()) {
      const OpRuling r = bridge.check(step(1, op.c_str(), {IrArg::num(1)}));
      CHECK(!r.accepted());
      CHECK(r.reason.find(op) != std::string::npos);
    }

    // UNKNOWN is a different fact from FORBIDDEN and must not look like it.
    const OpRuling nope = bridge.check(step(1, "FROBNICATE", {IrArg::num(1)}));
    CHECK_EQ_INT(static_cast<int>(nope.verdict), static_cast<int>(OpConstraint::UnknownOp));
    CHECK(nope.reason.find("FROBNICATE") != std::string::npos);

    // ARITY: 4 arguments is legal to the KERNEL (EXTRUDE is 2..5) and no
    // forge::ui command emits it. This is the check that the app's narrower
    // vocabulary is the one being enforced.
    CHECK(findIrOp("EXTRUDE") != nullptr);
    CHECK_EQ_INT(findIrOp("EXTRUDE")->maxArgs, 5);
    const OpRuling wide = bridge.check(step(2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(10),
                                                           IrArg::num(0), IrArg::num(0)}));
    CHECK_EQ_INT(static_cast<int>(wide.verdict), static_cast<int>(OpConstraint::WrongArity));
    CHECK(wide.reason.find("EXTRUDE") != std::string::npos);
    CHECK(wide.reason.find("4 argument") != std::string::npos);

    // SELECTION KIND: FILLET is reachable only from an Edge selection.
    const OpRuling wrongSel = bridge.check(step(2, "FILLET",
                                                {IrArg::valueRef(1), IrArg::num(2),
                                                 IrArg::keyword("ALL")},
                                                EntityKind::Body, 1));
    CHECK_EQ_INT(static_cast<int>(wrongSel.verdict),
                 static_cast<int>(OpConstraint::WrongSelectionKind));
    CHECK(wrongSel.reason.find("FILLET") != std::string::npos);
    CHECK(wrongSel.reason.find("edge") != std::string::npos);

    // SELECTION COUNT: the right kind, none picked.
    const OpRuling noneSel = bridge.check(step(2, "FILLET",
                                               {IrArg::valueRef(1), IrArg::num(2),
                                                IrArg::keyword("ALL")},
                                               EntityKind::Edge, 0));
    CHECK_EQ_INT(static_cast<int>(noneSel.verdict),
                 static_cast<int>(OpConstraint::WrongSelectionCount));
    // and the same statement with one edge picked is fine
    const OpRuling goodSel = bridge.check(step(2, "FILLET",
                                               {IrArg::valueRef(1), IrArg::num(2),
                                                IrArg::keyword("ALL")},
                                               EntityKind::Edge, 1));
    CHECK_EQ_INT(static_cast<int>(goodSel.verdict), static_cast<int>(OpConstraint::Ok));

    // A BODY-CONSUMING op with no body.
    const OpRuling noRef = bridge.check(step(2, "FILLET",
                                             {IrArg::num(3), IrArg::num(2),
                                              IrArg::keyword("ALL")}));
    CHECK_EQ_INT(static_cast<int>(noRef.verdict), static_cast<int>(OpConstraint::MissingValueRef));
    CHECK(noRef.reason.find("FILLET") != std::string::npos);

    // A CREATOR handed a body.
    const OpRuling creatorRef = bridge.check(step(2, "RECT",
                                                  {IrArg::valueRef(1), IrArg::num(30)}));
    CHECK_EQ_INT(static_cast<int>(creatorRef.verdict),
                 static_cast<int>(OpConstraint::UnexpectedValueRef));

    // An id that is not positive.
    const OpRuling badId = bridge.check(step(0, "RECT", {IrArg::num(40), IrArg::num(30)}));
    CHECK_EQ_INT(static_cast<int>(badId.verdict), static_cast<int>(OpConstraint::BadStatementId));
  }

  // ── 4b. plan-level rules: order and value flow ───────────────────────────
  {
    // A forward reference can never resolve.
    std::vector<ProposedOp> forward;
    forward.push_back(step(1, "RECT", {IrArg::num(40), IrArg::num(30)}));
    forward.push_back(step(2, "EXTRUDE", {IrArg::valueRef(3), IrArg::num(10)}));
    const PlanRuling fr = bridge.check(forward);
    CHECK_EQ_INT(fr.rejected, 1);
    CHECK(fr.firstRejection() != nullptr);
    if (fr.firstRejection() != nullptr) {
      CHECK_EQ_INT(static_cast<int>(fr.firstRejection()->verdict),
                   static_cast<int>(OpConstraint::ForwardValueRef));
    }

    // Out of order: %3 where %2 was due.
    std::vector<ProposedOp> gap;
    gap.push_back(step(1, "RECT", {IrArg::num(40), IrArg::num(30)}));
    gap.push_back(step(3, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(10)}));
    const PlanRuling gr = bridge.check(gap);
    CHECK_EQ_INT(gr.rejected, 1);
    if (gr.firstRejection() != nullptr) {
      CHECK_EQ_INT(static_cast<int>(gr.firstRejection()->verdict),
                   static_cast<int>(OpConstraint::BadStatementId));
    }

    // VALUE KIND: EXTRUDE consumes a PROFILE and %1 here is a SOLID. This is the
    // mis-wiring a typed selection exists to refuse, checked before a dispatch is
    // spent on it.
    std::vector<ProposedOp> wrongKind;
    wrongKind.push_back(step(2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(10)}));
    const PlanRuling wk = bridge.check(wrongKind, {IrValueKind::Solid});
    CHECK_EQ_INT(wk.rejected, 1);
    if (wk.firstRejection() != nullptr) {
      CHECK_EQ_INT(static_cast<int>(wk.firstRejection()->verdict),
                   static_cast<int>(OpConstraint::WrongValueKind));
      CHECK(wk.firstRejection()->reason.find("profile") != std::string::npos);
    }
    // The SAME statement over a seeded PROFILE is accepted -- the refusal above
    // is about the value, not about EXTRUDE.
    const PlanRuling okKind = bridge.check(wrongKind, {IrValueKind::Profile});
    CHECK(okKind.allAccepted());

    // LOFT consumes WIRE, and a profile is not a wire even though both are 2D.
    std::vector<ProposedOp> loft;
    loft.push_back(step(3, "LOFT", {IrArg::valueRef(1), IrArg::valueRef(2)}));
    const PlanRuling lp = bridge.check(loft, {IrValueKind::Profile, IrValueKind::Profile});
    CHECK_EQ_INT(lp.rejected, 1);
    const PlanRuling lw = bridge.check(loft, {IrValueKind::Wire, IrValueKind::Wire});
    CHECK(lw.allAccepted());
  }

  // ── 5. IS THE ALLOWED SET A LANGUAGE? -- D-015, measured ─────────────────
  const VocabularyClosure& closure = bridge.closure();
  std::printf("%s", closure.report().c_str());
  CHECK(closure.closed());
  CHECK_EQ_INT(closure.owedCreatorKinds.size(), 0);
  CHECK_EQ_INT(closure.unreachableOps.size(), 0);
  // The creators, pinned. D-015 measured ZERO; if that is ever true again the
  // language is empty and this line says so by name.
  CHECK_EQ_INT(closure.creatorOps.size(), 3);
  CHECK(contains(closure.creatorOps, "CIRCLE"));
  CHECK(contains(closure.creatorOps, "RECT"));
  CHECK(contains(closure.creatorOps, "RING"));
  for (const IrValueKind kind : closure.owedCreatorKinds) {
    std::printf("  OWED: no forge::ui command creates a %s\n", toString(kind));
  }

  // ── 5b. and the language, EXECUTED ───────────────────────────────────────
  // Not a claim about the table: the LIVE registry, driven from an EMPTY
  // document, with only commands a user can invoke. What it emits is then fed
  // back through the bridge, which must accept every statement of it.
  {
    CHECK_EQ_INT(doc.records().size(), 0);  // nothing seeded -- this is the point

    CommandParams rect;
    rect.setNumber("width", 40);
    rect.setNumber("height", 30);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_rect", {}, rect)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams ext;
    ext.setNumber("distance", 20);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.extrude",
                                      {ref("sketch_1", EntityKind::Sketch, "s1")}, ext)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams circle;
    circle.setNumber("radius", 8);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_circle", {}, circle)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams ext2;
    ext2.setNumber("distance", 30);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.extrude",
                                      {ref("sketch_3", EntityKind::Sketch, "s3")}, ext2)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams empty;
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.boolean_union",
                                      {ref("body_2", EntityKind::Body, "b1"),
                                       ref("body_4", EntityKind::Body, "b2")}, empty)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams fillet;
    fillet.setNumber("radius", 2);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.fillet",
                                      {ref("body_2", EntityKind::Edge, "e1")}, fillet)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams hole;
    hole.setNumber("diameter", 6);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.hole",
                                      {ref("body_2", EntityKind::Face, "f1")}, hole)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams shell2;
    shell2.setNumber("thickness", 2);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.shell",
                                      {ref("body_2", EntityKind::Face, "f1")}, shell2)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams pattern;
    pattern.setNumber("count", 3);
    pattern.setNumber("dx", 25);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.pattern_linear",
                                      {ref("body_2", EntityKind::Body, "b1")}, pattern)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams ring1;
    ring1.setNumber("rx", 20);
    ring1.setNumber("ry", 20);
    ring1.setNumber("z", 0);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.section_ring", {}, ring1)),
                 static_cast<int>(DispatchStatus::Ok));
    CommandParams ring2;
    ring2.setNumber("rx", 12);
    ring2.setNumber("ry", 12);
    ring2.setNumber("z", 30);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.section_ring", {}, ring2)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams loft;
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.loft",
                                      {ref("wire_10", EntityKind::Wire, "w1"),
                                       ref("wire_11", EntityKind::Wire, "w2")}, loft)),
                 static_cast<int>(DispatchStatus::Ok));

    std::printf("  [measured] a program a USER could have authored, from an empty document:\n%s\n",
                doc.irProgram().c_str());

    // NON-TRIVIAL, stated as numbers rather than as an adjective.
    CHECK_EQ_INT(doc.records().size(), 12);
    std::vector<IrLine> program;
    std::vector<std::string> distinctOps;
    for (const FeatureRecord& rec : doc.records()) {
      program.push_back(rec.line);
      CHECK(!rec.commandId.empty());  // every statement is command-authored
      if (!contains(distinctOps, rec.line.op)) distinctOps.push_back(rec.line.op);
    }
    CHECK(distinctOps.size() >= 10);

    // THE CLOSING OF THE LOOP: the bridge accepts, statement for statement, what
    // the app itself produced. A constraint that refuses the product's own output
    // is not a constraint, it is a bug.
    const PlanRuling ruling = bridge.check(program);
    if (!ruling.allAccepted()) std::printf("%s", ruling.report().c_str());
    CHECK(ruling.allAccepted());
    CHECK_EQ_INT(ruling.accepted, 12);
    CHECK_EQ_INT(ruling.rejected, 0);

    // And the ops it used are a subset of the allowed set, by name.
    for (const std::string& op : distinctOps) CHECK(bridge.allows(op));
  }

  return H.finish();
}
