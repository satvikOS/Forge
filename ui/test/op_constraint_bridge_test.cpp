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
//       proves is the KERNEL's own op table. The 28 allowed and the 12 forbidden
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
//   1  every PROFILE creator is dropped     -> no user-invocable op produces a
//      from the allowed set                    PROFILE; the language closes empty
//                                              again and EXTRUDE/REVOLVE are OWED
//   2  POLY is added to the allowed set      -> the constraint silently widened to
//                                              an op no command emits
//   3  EXTRUDE's emitted arity is widened     -> the record of which forms the app
//      to the kernel's                          can AUTHOR is lost, so the 61-count
//                                               capability gap becomes invisible
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
//   9  SLOT is promoted from forbidden to  -> the ARGUMENT-VALUE rules stop
//      allowed                                  reading the vocabulary; a
//                                               transcribed list would not notice
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
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
    case 1: {  // the PROFILE creators disappear
      // Every one of them, not just RECT. When this mutation was written RECT was the
      // only PROFILE producer, so erasing it emptied the kind and the closure check
      // caught it. There are now four (RECT, CIRCLE, RRECT, REGPOLY), and erasing one of
      // four would leave the language closed -- the mutation would still be caught, but
      // by the row-count checks rather than by the check it exists to prove. Erasing the
      // KIND keeps the teeth where they were put: EXTRUDE and REVOLVE consume a PROFILE
      // and nothing would produce one.
      v.ops.erase(std::remove_if(v.ops.begin(), v.ops.end(),
                                 [](const OpVocabulary::Op& o) {
                                   return o.produces == IrValueKind::Profile;
                                 }),
                  v.ops.end());
      v.commands.erase(std::remove_if(v.commands.begin(), v.commands.end(),
                                      [](const OpVocabulary::Command& c) {
                                        return c.produces == IrValueKind::Profile;
                                      }),
                       v.commands.end());
      break;
    }
    case 2: {  // the allowed set is quietly widened to an op no command emits
      // SLOT, not POLY, and not BOX before it. This exemplar has now moved TWICE for the
      // same reason -- BOX became user-invocable with part.primitive_box, POLY with
      // part.sketch_poly -- and an op the registry really does emit cannot demonstrate
      // "widened to an op nothing emits": the mutation would be a no-op and the gate
      // would pass while proving nothing.
      //
      // SLOT is the durable one, and for a reason no future command can quietly undo:
      // it is not waiting on a spelling, it is out on a MEASUREMENT. profSlot builds
      // both semicircular caps INWARD (-50.4% of the volume its own signature promises
      // on SLOT(40,12); forge-kernel/reports/MODELLING_OP_FAMILIES.md 6.1), so it stays
      // forbidden until the kernel arc is fixed AND re-measured. It is also the LAST
      // member of forbidden_ops -- if a future change empties that set, this mutation
      // has no subject left and the assertion below is what will say so.
      OpVocabulary::Op slot;
      slot.op = "SLOT";
      slot.produces = IrValueKind::Profile;
      slot.kernelMinArgs = 2;
      slot.kernelMaxArgs = 5;
      slot.firstArgIsValueRef = false;
      slot.emittedForms.push_back(OpVocabulary::ArgCounts{2, 2});
      slot.commands.push_back("part.make_slot");
      v.ops.push_back(std::move(slot));
      break;
    }
    case 3: {  // the record of WHICH FORMS THE APP CAN AUTHOR is lost
      // This mutation used to mean "the KERNEL's arity is enforced instead of the
      // app's", back when the app's emitted forms were the REFUSAL boundary.
      // They are not any more -- the kernel's range is, and a kernel-legal form no
      // command emits is TOLERATED rather than refused, because the constraint on
      // this programme is REPRESENT / REPAIR / TOLERATE, never refuse.
      //
      // Widening `emittedForms` to the kernel's range no longer changes a single
      // verdict. What it destroys is the CAPABILITY GAP: every form suddenly looks
      // authorable, `OpRuling::tolerated` comes back empty, and the 61 kernel-legal
      // argument counts no forge::ui command can produce become invisible. That is
      // still a real regression -- tolerating must not mean forgetting -- and it is
      // what this mutation proves the gate still catches.
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
    case 9: {  // SLOT is promoted out of the forbidden set into the allowed one
      // The argument-value rules in section 4c must be READING THE VOCABULARY,
      // not a list transcribed into OpConstraintBridge.cpp. Move SLOT across
      // and a selector spelling it stops being ForbiddenOpInArgument -- which is
      // exactly what a hardcoded list would fail to notice.
      v.forbidden.erase(std::remove_if(v.forbidden.begin(), v.forbidden.end(),
                                       [](const OpVocabulary::Forbidden& f) {
                                         return f.op == "SLOT";
                                       }),
                        v.forbidden.end());
      OpVocabulary::Op slot;
      slot.op = "SLOT";
      slot.produces = IrValueKind::Solid;
      slot.kernelMinArgs = 2;
      slot.kernelMaxArgs = 5;
      slot.firstArgIsValueRef = false;
      slot.emittedForms.push_back(OpVocabulary::ArgCounts{2, 2});
      slot.commands.push_back("part.make_slot");
      v.ops.push_back(std::move(slot));
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
    //
    // This case named BOX until part.primitive_box was added, then POLY until
    // part.sketch_poly was. Both are now allowed, and a named example has to be an op
    // that is STILL out of reach or the assertion tests nothing. SLOT is the durable
    // one, and unlike its two predecessors it is not one command away: it is spellable
    // today and withheld on a MEASUREMENT (profSlot inverts both end caps, -50.4% of the
    // volume on SLOT(40,12)), so no new command legalises it -- only a kernel fix plus a
    // re-measurement does.
    const OpRuling slot = bridge.check(step(1, "SLOT", {IrArg::num(40), IrArg::num(12)}));
    CHECK_EQ_INT(static_cast<int>(slot.verdict), static_cast<int>(OpConstraint::ForbiddenOp));
    CHECK(slot.reason.find("SLOT") != std::string::npos);
    // NOT "no user can produce it": SLOT's recorded reason is the measurement, and
    // asserting the old blanket wording here would let the two be confused again.
    CHECK(!slot.reason.empty());
    // And POLY, which used to stand here, is now ACCEPTED in the form the new command
    // emits -- the other half of the same claim, and the reason this line moved. It is
    // also the FIRST points-token statement the bridge has ever had to rule on.
    const OpRuling polyNow = bridge.check(
        step(1, "POLY",
             {IrArg::points({IrPoint{-20, -10, 0}, IrPoint{20, -10, 0}, IrPoint{0, 18, 0}}, 2)},
             EntityKind::None, 0));
    CHECK_EQ_INT(static_cast<int>(polyNow.verdict), static_cast<int>(OpConstraint::Ok));
    // A ring carrying a non-finite coordinate is REFUSED, and by the argument-VALUE rule
    // rather than the op-name one. Without the Points arm in checkValue this statement
    // sails through: arg.word is empty, so every existing test in that function passes
    // it, and `[10 nan; ...]` reaches forge::ft as a ring it reads back differently.
    const OpRuling polyNaN = bridge.check(
        step(1, "POLY",
             {IrArg::points({IrPoint{-20, -10, 0}, IrPoint{20, std::nan(""), 0},
                             IrPoint{0, 18, 0}}, 2)},
             EntityKind::None, 0));
    CHECK_EQ_INT(static_cast<int>(polyNaN.verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));
    // An EMPTY ring renders as `[]`, which forge::ft's lexer refuses outright.
    const OpRuling polyEmpty =
        bridge.check(step(1, "POLY", {IrArg::points({}, 2)}, EntityKind::None, 0));
    CHECK_EQ_INT(static_cast<int>(polyEmpty.verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));

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

    // ARITY: the KERNEL's range is the refusal boundary, and the app's emitted
    // forms are a NOTE. This block asserts BOTH halves, because a rule that only
    // ever accepts is not a rule and a rule that only ever refuses was the bug.
    CHECK(findIrOp("EXTRUDE") != nullptr);
    CHECK_EQ_INT(findIrOp("EXTRUDE")->maxArgs, 5);

    // (a) 4 arguments: legal to the kernel (EXTRUDE is 2..5), emitted by no
    // forge::ui command. ACCEPTED -- refusing it removed capability and
    // prevented nothing -- and the fact is RECORDED rather than discarded.
    const OpRuling wide = bridge.check(step(2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(10),
                                                           IrArg::num(0), IrArg::num(0)}));
    CHECK(wide.accepted());
    CHECK_EQ_INT(static_cast<int>(wide.verdict), static_cast<int>(OpConstraint::Ok));
    CHECK(!wide.tolerated.empty());
    CHECK(wide.tolerated.find("EXTRUDE") != std::string::npos);
    CHECK(wide.tolerated.find("4 argument") != std::string::npos);
    CHECK(wide.tolerated.find("the modelling engine builds this") != std::string::npos);

    // (b) the forms FeatureTree.hpp DOCUMENTS and part.fillet never writes.
    // Both were refused before; both build.
    const OpRuling bareFillet =
        bridge.check(step(2, "FILLET", {IrArg::valueRef(1), IrArg::num(3)}));
    CHECK(bareFillet.accepted());
    CHECK(!bareFillet.tolerated.empty());
    const OpRuling bareChamfer =
        bridge.check(step(2, "CHAMFER", {IrArg::valueRef(1), IrArg::num(1)}));
    CHECK(bareChamfer.accepted());
    CHECK(!bareChamfer.tolerated.empty());

    // (c) OUTSIDE the kernel's range is still REFUSED, in both directions. This
    // is the half that had no test at all while the app's forms were the
    // boundary: every over-long form was refused for the app's reason, so the
    // kernel's own limit was never the thing being asserted.
    const OpRuling tooMany = bridge.check(step(2, "EXTRUDE",
                                               {IrArg::valueRef(1), IrArg::num(10), IrArg::num(0),
                                                IrArg::num(0), IrArg::num(0), IrArg::num(0)}));
    CHECK_EQ_INT(static_cast<int>(tooMany.verdict), static_cast<int>(OpConstraint::WrongArity));
    CHECK(tooMany.reason.find("EXTRUDE") != std::string::npos);
    CHECK(tooMany.reason.find("6 argument") != std::string::npos);
    CHECK(tooMany.reason.find("it cannot build this step") != std::string::npos);
    CHECK(tooMany.tolerated.empty());

    const OpRuling tooFew = bridge.check(step(2, "EXTRUDE", {IrArg::valueRef(1)}));
    CHECK_EQ_INT(static_cast<int>(tooFew.verdict), static_cast<int>(OpConstraint::WrongArity));
    CHECK(tooFew.reason.find("1 argument") != std::string::npos);

    // (d) a form the app DOES emit is accepted with NO note -- otherwise
    // "tolerated" would just be a second name for "accepted".
    const OpRuling plain =
        bridge.check(step(2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(10)}));
    CHECK(plain.accepted());
    CHECK(plain.tolerated.empty());

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

  // ── 4c. THE ARGUMENT IS ALSO A VALUE ─────────────────────────────────────
  // Sections 4 and 4b rule on the op name and on the SHAPE of the argument list.
  // Neither reads what an argument SAYS, and that was a hole with a name: three
  // of the app's own commands build a feature-IR argument out of a TEXT
  // PARAMETER the caller supplies verbatim (part.fillet and part.chamfer from
  // `selector`, part.mirror from `plane`). The op name of the statement is
  // therefore NOT the only op a statement can carry.
  //
  // Everything below was ACCEPTED by this bridge before checkValue() existed.
  {
    const auto render = [](const std::vector<ProposedOp>& plan) {
      std::string out;
      for (const ProposedOp& p : plan) {
        out += p.line.text();
        out += "\n";
      }
      return out;
    };

    // ── the bypass, at its full size ────────────────────────────────────────
    // A three-statement plan. Every `line.op` is user-invocable: RECT, EXTRUDE,
    // FILLET. The FILLET carries a selector whose VALUE closes the quote, opens
    // a NEW LINE, and writes a SLOT -- an op the vocabulary forbids outright.
    // forge::ft::parse reads statements line by line, so the text this plan
    // renders to is a program of THREE statements, the last of which no command
    // in this app can emit.
    std::vector<ProposedOp> smuggler;
    smuggler.push_back(step(1, "RECT", {IrArg::num(40), IrArg::num(30)}));
    smuggler.push_back(step(2, "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20)}));
    smuggler.push_back(step(3, "FILLET",
                            {IrArg::valueRef(2), IrArg::num(2),
                             IrArg::text("ALL\")\n%4 = SLOT(50, 20)\n#")}));

    // FIRST, the escalation MEASURED rather than asserted: the rendered text
    // really does gain a statement, and it really is a statement this same
    // bridge refuses when it is written where a gate can see it.
    const std::string text = render(smuggler);
    CHECK(text.find("\n%4 = SLOT(50, 20)\n") != std::string::npos);
    const OpRuling passenger = bridge.check(step(4, "SLOT", {IrArg::num(50), IrArg::num(20)}));
    CHECK_EQ_INT(static_cast<int>(passenger.verdict), static_cast<int>(OpConstraint::ForbiddenOp));

    // SECOND, the refusal. The carrier is refused for the value it carries, and
    // the reason names the argument's POSITION -- a planner told only "the plan
    // is bad" learns nothing it can act on.
    const PlanRuling sr = bridge.check(smuggler);
    if (sr.allAccepted()) std::printf("  [BYPASS] the gate accepted:\n%s", text.c_str());
    CHECK(!sr.allAccepted());
    CHECK_EQ_INT(sr.rejected, 1);
    CHECK(sr.firstRejection() != nullptr);
    if (sr.firstRejection() != nullptr) {
      CHECK_EQ_INT(static_cast<int>(sr.firstRejection()->verdict),
                   static_cast<int>(OpConstraint::MalformedArgumentValue));
      CHECK_EQ_STR(sr.firstRejection()->op, "FILLET");
      CHECK_EQ_INT(sr.firstRejection()->statementId, 3);
      CHECK(sr.firstRejection()->reason.find("argument 3 of 3") != std::string::npos);
      // The FIRST unwritable character is the one named, and here that is the
      // quote the value uses to close the string -- not the newline that follows
      // it. Naming the first one is what makes the reason actionable: fixing a
      // later character would leave the value just as unwritable.
      CHECK(sr.firstRejection()->reason.find("double quote") != std::string::npos);
    }
    // A value whose only defect IS the newline names the newline.
    const OpRuling nl = bridge.check(step(3, "FILLET",
                                          {IrArg::valueRef(2), IrArg::num(2),
                                           IrArg::text("ALL\n%4 = SLOT(50, 20)")}));
    CHECK_EQ_INT(static_cast<int>(nl.verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));
    CHECK(nl.reason.find("newline") != std::string::npos);
    // The two statements BEFORE it are still accepted: the refusal is about one
    // argument of one line, not a whole-plan panic.
    CHECK_EQ_INT(sr.accepted, 2);

    // ── the same hole without any injection: a bare forbidden op ────────────
    // No quote, no newline, nothing malformed -- the word SLOT simply sitting
    // in the argument slot. This is the plainest reading of "an op name hides in
    // an argument", and it is a DIFFERENT fact from the one above, so it gets a
    // different verdict.
    const OpRuling quoted = bridge.check(step(3, "FILLET",
                                              {IrArg::valueRef(2), IrArg::num(2),
                                               IrArg::text("SLOT")}));
    CHECK_EQ_INT(static_cast<int>(quoted.verdict),
                 static_cast<int>(OpConstraint::ForbiddenOpInArgument));
    CHECK(quoted.reason.find("SLOT") != std::string::npos);
    // ForbiddenOp's own words are quoted through, so the refusal cites the
    // vocabulary rather than paraphrasing it.
    CHECK(quoted.reason.find("no command in Forge produces it") !=
          std::string::npos);

    // A BARE keyword spelling it, which forge::ft upper-cases as it reads --
    // so the lower-case spelling must be refused by the same fact.
    const OpRuling kw = bridge.check(step(3, "FILLET",
                                          {IrArg::valueRef(2), IrArg::num(2),
                                           IrArg::keyword("slot")}));
    CHECK_EQ_INT(static_cast<int>(kw.verdict),
                 static_cast<int>(OpConstraint::ForbiddenOpInArgument));
    CHECK(kw.reason.find("SLOT") != std::string::npos);

    // An ALLOWED op as a bare keyword is a different fact again: not an
    // escalation, but no command emits an op name in a keyword slot.
    const OpRuling allowedKw = bridge.check(step(3, "FILLET",
                                                 {IrArg::valueRef(2), IrArg::num(2),
                                                  IrArg::keyword("EXTRUDE")}));
    CHECK_EQ_INT(static_cast<int>(allowedKw.verdict),
                 static_cast<int>(OpConstraint::OpNameInArgument));

    // ── the OTHER unwritable values ────────────────────────────────────────
    // A quote alone is enough: forge::ft opens a string on either quote
    // character, so the argument list re-reads with a different length.
    const OpRuling quoteBreak = bridge.check(step(3, "FILLET",
                                                  {IrArg::valueRef(2), IrArg::num(2),
                                                   IrArg::text("A\", 99, \"B")}));
    CHECK_EQ_INT(static_cast<int>(quoteBreak.verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));
    // Rendered, that is FIVE comma-separated arguments where the gate checked
    // THREE -- the arity check in section 4 ruled on a list the kernel will not
    // receive.
    CHECK(step(3, "FILLET", {IrArg::valueRef(2), IrArg::num(2), IrArg::text("A\", 99, \"B")})
              .line.text() == "%3 = FILLET(%2, 2, \"A\", 99, \"B\")");

    // A single quote inside a double-quoted selector: the same delimiter defect
    // by the other character.
    CHECK_EQ_INT(static_cast<int>(bridge.check(step(3, "FILLET",
                                                    {IrArg::valueRef(2), IrArg::num(2),
                                                     IrArg::text("it's")}))
                     .verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));

    // A non-finite NUMBER is the same defect through the numeric slot: "%.10g"
    // writes it as a bare word, and a bare word re-reads as a KEYWORD.
    const double inf = std::numeric_limits<double>::infinity();
    CHECK_EQ_INT(static_cast<int>(bridge.check(step(2, "EXTRUDE",
                                                    {IrArg::valueRef(1), IrArg::num(inf)}))
                     .verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));
    CHECK_EQ_INT(static_cast<int>(
                     bridge
                         .check(step(2, "EXTRUDE",
                                     {IrArg::valueRef(1),
                                      IrArg::num(std::numeric_limits<double>::quiet_NaN())}))
                         .verdict),
                 static_cast<int>(OpConstraint::MalformedArgumentValue));

    // ── AND THE APP'S OWN VALUES STILL PASS ────────────────────────────────
    // A rule that refuses the product's own output is not a rule, it is a bug.
    // These are the exact values ui/src/PartCommands.cpp emits, measured from it:
    // the four FILLET keywords, MIRROR's three planes, and a real quoted face
    // selector -- which contains a colon, an equals sign and a digit, and whose
    // "bore" is a SUBSTRING of the op CBORE. Nothing here may be refused.
    const char* const kEmittedKeywords[] = {"ALL",  "VERTICAL", "RIM",  "CONVEX", "SMOOTH",
                                            "RULED", "OPEN",    "LINEAR", "POLAR", "GRID"};
    for (const char* word : kEmittedKeywords) {
      std::string why;
      const OpConstraint v = bridge.checkValue(IrArg::keyword(word), why);
      if (v != OpConstraint::Ok) std::printf("  [regression] keyword %s refused: %s\n", word,
                                             why.c_str());
      CHECK_EQ_INT(static_cast<int>(v), static_cast<int>(OpConstraint::Ok));
      CHECK(why.empty());
    }
    for (const char* plane : {"XY", "XZ", "YZ"}) {
      std::string why;
      CHECK_EQ_INT(static_cast<int>(bridge.checkValue(IrArg::keyword(plane), why)),
                   static_cast<int>(OpConstraint::Ok));
    }
    for (const char* sel : {"bore:r=6", "hole:at=21.75,0", "face@3", "TOP"}) {
      std::string why;
      const OpConstraint v = bridge.checkValue(IrArg::text(sel), why);
      if (v != OpConstraint::Ok) std::printf("  [regression] selector %s refused: %s\n", sel,
                                             why.c_str());
      CHECK_EQ_INT(static_cast<int>(v), static_cast<int>(OpConstraint::Ok));
    }
    // The whole statement, as part.fillet builds it.
    CHECK(bridge.check(step(3, "FILLET",
                            {IrArg::valueRef(2), IrArg::num(2), IrArg::keyword("ALL")}))
              .accepted());
    CHECK(bridge.check(step(3, "FILLET",
                            {IrArg::valueRef(2), IrArg::num(2), IrArg::text("bore:r=6")}))
              .accepted());

    // ── the ForbiddenOp / UnknownOp split is UNTOUCHED ─────────────────────
    // The argument rules are additive. A forbidden op as a STATEMENT op is still
    // ForbiddenOp, and a word that is no feature-IR op at all is still
    // UnknownOp -- two different facts, and neither has become the other.
    CHECK_EQ_INT(static_cast<int>(bridge.check(step(1, "SLOT", {IrArg::num(50), IrArg::num(20)})).verdict),
                 static_cast<int>(OpConstraint::ForbiddenOp));
    CHECK_EQ_INT(static_cast<int>(bridge.check(step(1, "NOTANOP", {IrArg::num(1)})).verdict),
                 static_cast<int>(OpConstraint::UnknownOp));
    // ...and a word that is no op at all is not an op in an ARGUMENT either.
    std::string why;
    CHECK_EQ_INT(static_cast<int>(bridge.checkValue(IrArg::keyword("NOTANOP"), why)),
                 static_cast<int>(OpConstraint::Ok));
  }

  // ── 5. IS THE ALLOWED SET A LANGUAGE? -- D-015, measured ─────────────────
  const VocabularyClosure& closure = bridge.closure();
  std::printf("%s", closure.report().c_str());
  CHECK(closure.closed());
  CHECK_EQ_INT(closure.owedCreatorKinds.size(), 0);
  CHECK_EQ_INT(closure.unreachableOps.size(), 0);
  // The creators, pinned. D-015 measured ZERO; if that is ever true again the
  // language is empty and this line says so by name. Three of these (CIRCLE, RECT, RING)
  // closed the PROFILE and WIRE kinds; nine are the kernel's own primitives, which the
  // kernel has always built and no command could ask for until now; the thirteenth
  // is INPUT, which creates a SOLID from the task's imported STEP rather than from
  // numbers -- the creator every EDIT task starts from, without which the only solids
  // reachable were ones the app had just built from scratch, so "change the part you
  // were given" was not a program this language could write.
  //
  // The last three are the POINT-RING creators, and each closes a shape the other
  // twelve cannot express however they are composed: POLY is the only ARBITRARY 2D
  // silhouette (every other profile creator is a parameterised family -- rectangle,
  // circle, n-gon), WIRE is the only NON-superelliptical loft section (RING is rx/ry/p,
  // so an airfoil is not statable as one), and SWEEP is the only op that makes a solid
  // by following a 3D PATH. They needed no new value kind -- they needed a new ARGUMENT
  // kind, IrArgKind::Points, which is why they outlasted the other nine.
  //
  // The SEVENTEENTH is SKETCH, and it is a creator of a different shape from all
  // sixteen above: each of those hands back a FINISHED value, while SKETCH hands
  // back an EMPTY one that the four entity ops and the two constraint commands
  // fill in before SOLVE turns it into a PROFILE. It is what makes the vendored
  // constraint solver reachable from an empty document, and the closure report
  // printed above is where its consequence shows: SKETCH and SKETCHREF join the
  // reachable kinds, and the set stays CLOSED rather than owing a creator.
  CHECK_EQ_INT(closure.creatorOps.size(), 17);
  CHECK(contains(closure.creatorOps, "SKETCH"));
  CHECK(contains(closure.creatorOps, "POLY"));
  CHECK(contains(closure.creatorOps, "WIRE"));
  CHECK(contains(closure.creatorOps, "SWEEP"));
  CHECK(contains(closure.creatorOps, "INPUT"));
  CHECK(contains(closure.creatorOps, "CIRCLE"));
  CHECK(contains(closure.creatorOps, "RECT"));
  CHECK(contains(closure.creatorOps, "RING"));
  CHECK(contains(closure.creatorOps, "RRECT"));
  CHECK(contains(closure.creatorOps, "REGPOLY"));
  CHECK(contains(closure.creatorOps, "BOX"));
  CHECK(contains(closure.creatorOps, "CYL"));
  CHECK(contains(closure.creatorOps, "CONE"));
  CHECK(contains(closure.creatorOps, "SPHERE"));
  CHECK(contains(closure.creatorOps, "TORUS"));
  CHECK(contains(closure.creatorOps, "PRISM"));
  CHECK(contains(closure.creatorOps, "TUBE"));
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

    // ── and the KERNEL'S OWN PRIMITIVES, unreachable until this change ──────
    // BOX and CYL are the two most-used ops in the repo's feature-tree corpus and were
    // both in forbidden_ops; the app even SEEDED a BOX into every document while giving
    // the user no way to author one. These five statements are the proof that the
    // primitives are not merely listed but INVOCABLE, and that they compose with the
    // commands that were already here: %14 rotates the cylinder %13 made, and %17
    // extrudes the polygon profile %16 made.
    CommandParams cyl;
    cyl.setNumber("radius", 10);
    cyl.setNumber("height", 25);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.primitive_cylinder", {}, cyl)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams rot;
    rot.setNumber("angle", 90);
    rot.setNumber("axx", 0);
    rot.setNumber("axy", 1);
    rot.setNumber("axz", 0);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.rotate",
                                      {ref("body_13", EntityKind::Body, "b3")}, rot)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams tube;
    tube.setNumber("outer_radius", 12);
    tube.setNumber("inner_radius", 8);
    tube.setNumber("height", 30);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.primitive_tube", {}, tube)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams ngon;
    ngon.setNumber("radius", 20);
    ngon.setNumber("sides", 6);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_polygon", {}, ngon)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams ext3;
    ext3.setNumber("distance", 12);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.extrude",
                                      {ref("sketch_16", EntityKind::Sketch, "s16")}, ext3)),
                 static_cast<int>(DispatchStatus::Ok));


    // ── and THE SKETCH FAMILY, unreachable until this change ────────────────
    // Eleven statements, driven the way a user drives them: open a sketch, place
    // points in it, join them, constrain them, SOLVE, and EXTRUDE the profile
    // that comes out. This is the proof the family's exit is real rather than
    // merely type-correct -- %28 is `EXTRUDE(%27, 5)` where %27 is a SOLVE, and
    // part.extrude was not touched by this change.
    //
    // TWO constraints on purpose. The first one REBINDS the sketch's node (CON
    // is pass-through), so the second one is the case that fails if the node is
    // resolved by `nodeFor(root)`: after %25 the node no longer names %18. The
    // SOLVE that follows then names %26 -- the sketch WITH both constraints --
    // which is what the rebinding is for.
    CommandParams sketch;
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_new", {}, sketch)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams p0;
    p0.setNumber("x", 0);
    p0.setNumber("y", 0);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_entity_point",
                                      {ref("opensketch_18", EntityKind::OpenSketch, "sk")}, p0)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams p1;
    p1.setNumber("x", 40);
    p1.setNumber("y", 0);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_entity_point",
                                      {ref("opensketch_18", EntityKind::OpenSketch, "sk")}, p1)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams p2;
    p2.setNumber("x", 40);
    p2.setNumber("y", 30);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_entity_point",
                                      {ref("opensketch_18", EntityKind::OpenSketch, "sk")}, p2)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams line;
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_entity_line",
                                      {ref("sketchref_19", EntityKind::SketchRef, "e1"),
                                       ref("sketchref_20", EntityKind::SketchRef, "e2")}, line)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams arc;
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_entity_arc",
                                      {ref("sketchref_19", EntityKind::SketchRef, "e1"),
                                       ref("sketchref_20", EntityKind::SketchRef, "e2"),
                                       ref("sketchref_21", EntityKind::SketchRef, "e3")}, arc)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams circ;
    circ.setNumber("radius", 6);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_entity_circle",
                                      {ref("sketchref_19", EntityKind::SketchRef, "e1")}, circ)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams horiz;
    horiz.setText("kind", "HORIZ");
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_constrain_single",
                                      {ref("sketchref_22", EntityKind::SketchRef, "l1")}, horiz)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams dist;
    dist.setText("kind", "DIST");
    dist.setNumber("distance", 40);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_constrain",
                                      {ref("sketchref_19", EntityKind::SketchRef, "e1"),
                                       ref("sketchref_20", EntityKind::SketchRef, "e2")}, dist)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams solve;
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.sketch_solve",
                                      {ref("opensketch_18", EntityKind::OpenSketch, "sk")}, solve)),
                 static_cast<int>(DispatchStatus::Ok));

    CommandParams ext4;
    ext4.setNumber("distance", 5);
    CHECK_EQ_INT(static_cast<int>(run(shell.registry(), "part.extrude",
                                      {ref("sketch_27", EntityKind::Sketch, "s27")}, ext4)),
                 static_cast<int>(DispatchStatus::Ok));

    std::printf("  [measured] a program a USER could have authored, from an empty document:\n%s\n",
                doc.irProgram().c_str());

    // NON-TRIVIAL, stated as numbers rather than as an adjective.
    CHECK_EQ_INT(doc.records().size(), 28);
    std::vector<IrLine> program;
    std::vector<std::string> distinctOps;
    for (const FeatureRecord& rec : doc.records()) {
      program.push_back(rec.line);
      CHECK(!rec.commandId.empty());  // every statement is command-authored
      if (!contains(distinctOps, rec.line.op)) distinctOps.push_back(rec.line.op);
    }
    CHECK(distinctOps.size() >= 21);

    // THE CLOSING OF THE LOOP: the bridge accepts, statement for statement, what
    // the app itself produced. A constraint that refuses the product's own output
    // is not a constraint, it is a bug.
    const PlanRuling ruling = bridge.check(program);
    if (!ruling.allAccepted()) std::printf("%s", ruling.report().c_str());
    CHECK(ruling.allAccepted());
    CHECK_EQ_INT(ruling.accepted, 28);
    CHECK_EQ_INT(ruling.rejected, 0);

    // And the ops it used are a subset of the allowed set, by name.
    for (const std::string& op : distinctOps) CHECK(bridge.allows(op));
  }

  return H.finish();
}
