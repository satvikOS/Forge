// ui/test/feature_history_test.cpp
//
// THE FEATURE TREE AS A HISTORY MODELLER — the gate for rollback, reorder,
// suppress/unsuppress, delete-with-dependents, rename, persistent naming and
// per-node error surfacing.
//
// ── what makes this gate hard to fool ───────────────────────────────────────
// Every claim here is asserted on the EMITTED PROGRAM, which is the text the
// kernel would compile, not on an internal flag. `doc.setSuppressed(4, true)`
// returning true proves nothing; `%4` disappearing from the program while the
// statement that consumed it rebases onto `%3` is the whole behaviour.
//
// ── the properties, named ───────────────────────────────────────────────────
//   IDENTITY      With no history state applied, the emitted program is exactly
//                 the statements in order -- the pre-existing behaviour, bit for
//                 bit. A history model that changes the output of a document
//                 nobody has edited is a regression wearing a feature's hat.
//   REBASE        Suppressing or deleting a PASS-THROUGH feature (fillet, hole,
//                 pattern, boolean) forwards its consumers onto its own operand.
//                 The body survives; only that feature's effect goes.
//   BREAK, NAMED  Suppressing a VALUE PRODUCER (extrude: profile -> solid) has no
//                 operand to forward, so its consumers genuinely break. They are
//                 REPORTED, by statement, with the operand that went missing
//                 named -- never silently rewired, and never refused.
//   NO ORPHANS    The statement the broken feature consumed is dropped too, so
//                 the emitted program does not trip forge::ft's s0.4 orphan gate
//                 ("unexplained_orphans=1 [%1] ... The required value for each is
//                 ZERO"). A statement that was ALREADY a root is never dropped.
//   RENUMBERING   Delete never renumbers the DOCUMENT (a tombstone keeps every
//                 `%N` meaning what it meant); emission always renumbers, and the
//                 map back is what lets a kernel error naming emitted op %2 be
//                 shown on the right row.
//   CLAMPED MOVE  A reorder is never refused and never silently ignored: it lands
//                 as close to the request as the dependency graph allows and names
//                 the statement that stopped it.
//   PREVIEW == OUTCOME  The consequence preview is the same computation as the
//                 outcome, so the gate asserts they agree statement for statement.
//   SCALE         All of it, on the 71-statement tree the owner's fixtures reach.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureHistory.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// A plain chain: RECT -> EXTRUDE -> FILLET -> HOLE -> SHELL. Five statements,
// each consuming the one before, which is the shape every claim below is easiest
// to read against.
PartDocument chain() {
  PartDocument doc;
  doc.seed(IrValueKind::Profile, "sk", "RECT", {IrArg::num(80), IrArg::num(50)});
  doc.seed(IrValueKind::Solid, "b1", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20)});
  doc.seed(IrValueKind::Solid, "b2", "FILLET",
           {IrArg::valueRef(2), IrArg::num(3), IrArg::keyword("ALL")});
  doc.seed(IrValueKind::Solid, "b3", "HOLE",
           {IrArg::valueRef(3), IrArg::num(6), IrArg::num(0), IrArg::num(0), IrArg::num(0)});
  doc.seed(IrValueKind::Solid, "b4", "SHELL", {IrArg::valueRef(4), IrArg::num(2)});
  return doc;
}

std::string plan(const PartDocument& doc) { return doc.irProgram(); }

std::size_t countOmitted(const PartDocument& doc, PartDocument::OmitReason want) {
  // The plan is HELD, not chained off a temporary: EmissionPlan's accessors are
  // lvalue-ref-qualified with the rvalue overloads deleted, so the dangling form
  // does not compile. This is the shape every caller has to use.
  const PartDocument::EmissionPlan plan = doc.emissionPlan();
  std::size_t n = 0;
  for (const PartDocument::Omitted& o : plan.omitted()) {
    if (o.reason == want) ++n;
  }
  return n;
}

}  // namespace

int main() {
  Harness H("feature_history");

  // ══ IDENTITY ══════════════════════════════════════════════════════════════
  // The pre-existing behaviour, unchanged. This is the check that makes every
  // other one safe to add: emission is now DERIVED, and a derivation that moves
  // an untouched document is a silent regression in every existing gate.
  {
    PartDocument doc = chain();
    CHECK_EQ_STR(plan(doc),
                 "%1 = RECT(80, 50)\n"
                 "%2 = EXTRUDE(%1, 20)\n"
                 "%3 = FILLET(%2, 3, ALL)\n"
                 "%4 = HOLE(%3, 6, 0, 0, 0)\n"
                 "%5 = SHELL(%4, 2)\n");
    const PartDocument::EmissionPlan p = doc.emissionPlan();
    CHECK_EQ_INT(p.emittedCount(), 5);
    CHECK_EQ_INT(p.omitted().size(), 0);
    for (int i = 1; i <= 5; ++i) {
      CHECK_EQ_INT(p.emittedIdFor(i), i);   // the identity map, when nothing moved
      CHECK_EQ_INT(p.documentIdFor(i), i);
    }
    // Every record carries a distinct, non-zero identity.
    std::set<std::uint64_t> uids;
    for (const FeatureRecord& r : doc.records()) {
      CHECK(r.uid != 0);
      uids.insert(r.uid);
    }
    CHECK_EQ_INT(uids.size(), 5);
  }

  // ══ SUPPRESS a PASS-THROUGH: the consumer rebases ═════════════════════════
  {
    PartDocument doc = chain();
    CHECK(doc.setSuppressed(3, true));   // the FILLET
    // %4 consumed the fillet; it now consumes the extrude. The body survives,
    // renumbered, and the statement count drops by exactly one.
    CHECK_EQ_STR(plan(doc),
                 "%1 = RECT(80, 50)\n"
                 "%2 = EXTRUDE(%1, 20)\n"
                 "%3 = HOLE(%2, 6, 0, 0, 0)\n"
                 "%4 = SHELL(%3, 2)\n");
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Suppressed), 1);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::OperandUnavailable), 0);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Orphaned), 0);
    // THE MAP BACK. The kernel would blame emitted op %3; the row is document 4.
    const PartDocument::EmissionPlan p = doc.emissionPlan();
    CHECK_EQ_INT(p.documentIdFor(3), 4);
    CHECK_EQ_INT(p.emittedIdFor(5), 4);
    CHECK_EQ_INT(p.emittedIdFor(3), 0);   // suppressed: no emitted id at all

    // ...and unsuppressing puts it back, exactly.
    CHECK(doc.setSuppressed(3, false));
    CHECK_EQ_STR(plan(doc), plan(chain()));
  }

  // ══ SUPPRESS a VALUE PRODUCER: the break is REPORTED, not refused ═════════
  {
    PartDocument doc = chain();
    CHECK(doc.setSuppressed(2, true));   // the EXTRUDE: profile -> solid
    // There is no operand of the same kind to forward, so %3..%5 have no body.
    // They are omitted, and each names WHAT went missing. And %1, whose only
    // consumer just went, is dropped as an orphan rather than left to trip
    // forge::ft's graph-quality gate.
    CHECK_EQ_STR(plan(doc), "");
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Suppressed), 1);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::OperandUnavailable), 3);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Orphaned), 1);
    const PartDocument::EmissionPlan p = doc.emissionPlan();
    // NAMED: the fillet says the extrude is what it is missing.
    CHECK_EQ_INT(p.blockingFor(3), 2);
    CHECK_EQ_STR(PartDocument::toString(p.omitReasonFor(3)), "operand_unavailable");
    CHECK_EQ_STR(PartDocument::toString(p.omitReasonFor(1)), "orphaned");

    // The DIAGNOSIS a tree row shows, with the operand in the text.
    const FeatureDiagnosis d = diagnoseFeature(doc, 3, 0, "");
    CHECK_EQ_STR(toString(d.issue), "broken_operand");
    CHECK_EQ_INT(d.blockingId, 2);
    CHECK(d.detail.find("%2 EXTRUDE") != std::string::npos);
  }

  // ══ A ROOT BY DESIGN IS NEVER PRUNED ══════════════════════════════════════
  // Two bodies, never fused. Suppressing something on one must not delete the
  // other: the orphan prune only touches statements that WERE consumed.
  {
    PartDocument doc;
    doc.seed(IrValueKind::Solid, "a", "BOX", {IrArg::num(10), IrArg::num(10), IrArg::num(10)});
    doc.seed(IrValueKind::Solid, "b", "BOX", {IrArg::num(4), IrArg::num(4), IrArg::num(4)});
    doc.seed(IrValueKind::Solid, "b2", "FILLET",
             {IrArg::valueRef(2), IrArg::num(1), IrArg::keyword("ALL")});
    CHECK(doc.setSuppressed(3, true));
    // %1 was never consumed by anything, so it stays; %2 comes through because
    // the suppressed fillet rebases onto it.
    CHECK_EQ_STR(plan(doc), "%1 = BOX(10, 10, 10)\n%2 = BOX(4, 4, 4)\n");
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Orphaned), 0);
  }

  // ══ DELETE: a tombstone, and the document does NOT renumber ═══════════════
  {
    PartDocument doc = chain();
    CHECK(doc.setDeleted(4, true));   // the HOLE
    CHECK_EQ_INT(doc.records().size(), 5);          // the record stays
    CHECK_EQ_INT(doc.featureAt(5)->irId, 5);        // and every id is where it was
    CHECK_EQ_STR(doc.featureAt(5)->line.text(), "%5 = SHELL(%4, 2)");  // and so is every %N
    // The EMITTED program is what changed: the shell rebases onto the fillet.
    CHECK_EQ_STR(plan(doc),
                 "%1 = RECT(80, 50)\n"
                 "%2 = EXTRUDE(%1, 20)\n"
                 "%3 = FILLET(%2, 3, ALL)\n"
                 "%4 = SHELL(%3, 2)\n");
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Deleted), 1);
  }

  // ══ ROLLBACK ══════════════════════════════════════════════════════════════
  {
    PartDocument doc = chain();
    doc.setRollback(3);
    CHECK_EQ_INT(doc.rollback(), 3);
    CHECK_EQ_STR(plan(doc),
                 "%1 = RECT(80, 50)\n"
                 "%2 = EXTRUDE(%1, 20)\n"
                 "%3 = FILLET(%2, 3, ALL)\n");
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::RolledBack), 2);
    // A rolled statement is NOT a pass-through source: rolling back to 3 must not
    // let %4's value leak through into anything.
    const PartDocument::EmissionPlan p = doc.emissionPlan();
    CHECK_EQ_INT(p.emittedIdFor(4), 0);
    CHECK_EQ_INT(p.emittedIdFor(5), 0);

    // CLAMPED, never refused, at both ends -- and a bar AT or PAST the last
    // statement rolls nothing back, so it normalises to the same "off" 0 means.
    // One state, one spelling: `rollback() != 0` is exactly "something is rolled".
    doc.setRollback(999);
    CHECK_EQ_INT(doc.rollback(), 0);
    CHECK_EQ_STR(plan(doc), plan(chain()));
    doc.setRollback(5);            // the last statement: also nothing rolled
    CHECK_EQ_INT(doc.rollback(), 0);
    doc.setRollback(-7);
    CHECK_EQ_INT(doc.rollback(), 0);
    doc.setRollback(1);
    CHECK_EQ_INT(doc.rollback(), 1);
    CHECK_EQ_STR(plan(doc), "%1 = RECT(80, 50)\n");
    doc.setRollback(0);
  }

  // ══ REORDER ═══════════════════════════════════════════════════════════════
  {
    // A tree with an INDEPENDENT branch, so there is something legal to move.
    //   %1 RECT  %2 EXTRUDE(%1)  %3 CIRCLE  %4 EXTRUDE(%3)  %5 FUSE(%2,%4)
    PartDocument doc;
    doc.seed(IrValueKind::Profile, "sk1", "RECT", {IrArg::num(80), IrArg::num(50)});
    doc.seed(IrValueKind::Solid, "b1", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20)});
    doc.seed(IrValueKind::Profile, "sk2", "CIRCLE", {IrArg::num(10)});
    doc.seed(IrValueKind::Solid, "b2", "EXTRUDE", {IrArg::valueRef(3), IrArg::num(30)});
    doc.seed(IrValueKind::Solid, "b3", "FUSE", {IrArg::valueRef(2), IrArg::valueRef(4)});

    // The legal window for %3 (CIRCLE): anywhere from 1 up to just before %4.
    int first = 0, last = 0;
    doc.moveWindow(3, first, last);
    CHECK_EQ_INT(first, 1);
    CHECK_EQ_INT(last, 3);

    int clamped = 0, blocked = 0;
    CHECK(doc.moveFeature(3, 1, clamped, blocked));   // move the CIRCLE to the top
    CHECK_EQ_INT(clamped, 1);
    CHECK_EQ_INT(blocked, 0);
    // Every reference followed its STATEMENT, not its number.
    CHECK_EQ_STR(plan(doc),
                 "%1 = CIRCLE(10)\n"
                 "%2 = RECT(80, 50)\n"
                 "%3 = EXTRUDE(%2, 20)\n"
                 "%4 = EXTRUDE(%1, 30)\n"
                 "%5 = FUSE(%3, %4)\n");
    // The selection bindings moved with them, or a later command would fillet
    // the wrong body.
    CHECK_EQ_INT(doc.valueFor("sk2"), 1);
    CHECK_EQ_INT(doc.valueFor("sk1"), 2);
    CHECK_EQ_INT(doc.valueFor("b3"), 5);

    // CLAMPED, and the blocker is NAMED. %4 (now EXTRUDE(%1)) cannot go above
    // the circle it reads.
    CHECK(doc.moveFeature(4, 1, clamped, blocked));
    CHECK_EQ_INT(clamped, 2);
    CHECK_EQ_INT(blocked, 1);   // %1 CIRCLE pinned it

    // Dragging a statement below its own consumer clamps the other way.
    PartDocument doc2 = chain();
    CHECK(doc2.moveFeature(2, 5, clamped, blocked));
    CHECK_EQ_INT(clamped, 2);   // %3 FILLET reads it, so it cannot pass position 2
    CHECK_EQ_INT(blocked, 3);
    CHECK_EQ_STR(plan(doc2), plan(chain()));   // and nothing moved

    // A move that names no statement is the ONE refusal, and it mutates nothing.
    CHECK(!doc2.moveFeature(99, 1, clamped, blocked));
  }

  // ══ REORDER keeps the rollback bar on the SAME STATEMENT ══════════════════
  {
    PartDocument doc;
    doc.seed(IrValueKind::Profile, "sk1", "RECT", {IrArg::num(80), IrArg::num(50)});
    doc.seed(IrValueKind::Solid, "b1", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20)});
    doc.seed(IrValueKind::Profile, "sk2", "CIRCLE", {IrArg::num(10)});
    doc.seed(IrValueKind::Solid, "b2", "EXTRUDE", {IrArg::valueRef(3), IrArg::num(30)});
    doc.setRollback(2);   // the bar sits on the first EXTRUDE
    const std::uint64_t barUid = doc.uidOf(2);
    int clamped = 0, blocked = 0;
    CHECK(doc.moveFeature(3, 1, clamped, blocked));
    // The bar followed the statement, not the number.
    CHECK_EQ_INT(doc.idOfUid(barUid), 3);
    CHECK_EQ_INT(doc.rollback(), 3);
  }

  // ══ RENAME ════════════════════════════════════════════════════════════════
  {
    PartDocument doc = chain();
    CHECK(doc.setLabel(4, "Pilot Bore"));
    CHECK_EQ_STR(doc.featureAt(4)->label, "Pilot Bore");
    CHECK_EQ_STR(plan(doc), plan(chain()));   // a name is not geometry
    CHECK(!doc.setLabel(99, "nope"));
  }

  // ══ DEPENDENCY GRAPH ══════════════════════════════════════════════════════
  {
    PartDocument doc = chain();
    const std::vector<int> ops2 = featureOperands(doc, 2);
    CHECK_EQ_INT(ops2.size(), 1);
    CHECK_EQ_INT(ops2.empty() ? -1 : ops2[0], 1);
    const std::vector<int> dep2 = featureDependents(doc, 2);
    CHECK_EQ_INT(dep2.size(), 1);
    CHECK_EQ_INT(dep2.empty() ? -1 : dep2[0], 3);
    const std::vector<int> closure = featureDependentClosure(doc, 2);
    CHECK_EQ_INT(closure.size(), 3);          // 3, 4, 5
    CHECK_EQ_INT(closure.empty() ? -1 : closure.front(), 3);
    CHECK_EQ_INT(closure.empty() ? -1 : closure.back(), 5);
    CHECK_EQ_INT(featureDependentClosure(doc, 5).size(), 0);
    CHECK_EQ_INT(featureDependents(doc, 99).size(), 0);
  }

  // ══ PREVIEW == OUTCOME ════════════════════════════════════════════════════
  // The preview is not a second model of what a delete does; it is a delete,
  // performed on a copy. Assert that, so a future "optimisation" that replaces it
  // with a rule of thumb fails here.
  {
    PartDocument doc = chain();
    const Impact impact = previewDelete(doc, 2);   // delete the EXTRUDE
    CHECK(impact.possible);
    CHECK_EQ_INT(impact.stops, 5);      // %2 itself + %1 orphaned + %3,%4,%5 broken
    CHECK_EQ_INT(impact.resumes, 0);
    CHECK(impact.summary.find("delete %2 EXTRUDE") != std::string::npos);
    // Each broken row names the operand that went missing.
    std::size_t named = 0;
    for (const ImpactRow& r : impact.rows) {
      if (r.after == PartDocument::OmitReason::OperandUnavailable && r.blockingId == 2) ++named;
    }
    CHECK_EQ_INT(named, 3);
    // ...and the program the preview promised is the program the edit produces.
    PartDocument applied = chain();
    CHECK(applied.setDeleted(2, true));
    CHECK_EQ_STR(impact.program, applied.irProgram());
  }
  {
    PartDocument doc = chain();
    const Impact impact = previewSuppress(doc, 3, true);   // the FILLET rebases
    CHECK_EQ_INT(impact.stops, 1);
    CHECK_EQ_INT(impact.rebasedCount, 1);   // %4 HOLE now reads %2
    PartDocument applied = chain();
    CHECK(applied.setSuppressed(3, true));
    CHECK_EQ_STR(impact.program, applied.irProgram());
    // A preview NEVER mutates the document it was asked about.
    CHECK_EQ_STR(doc.irProgram(), chain().irProgram());
  }
  {
    PartDocument doc = chain();
    const Impact impact = previewMove(doc, 2, 5);
    CHECK_EQ_INT(impact.clampedTo, 2);
    CHECK_EQ_INT(impact.blockedBy, 3);
    CHECK(impact.summary.find("cannot move past") != std::string::npos);
    const Impact none = previewDelete(doc, 77);
    CHECK(!none.possible);
  }
  {
    PartDocument doc = chain();
    doc.setRollback(2);
    const Impact impact = previewRollback(doc, 4);
    CHECK_EQ_INT(impact.resumes, 2);   // %3 and %4 come back
    CHECK_EQ_INT(impact.stops, 0);
    CHECK_EQ_INT(impact.clampedTo, 4);
  }

  // ══ PERSISTENT NAMING (the L4 TAG/@name mechanism) ════════════════════════
  {
    // The kernel's rules, not house style: opTag() requires '@' + [a-z0-9_].
    CHECK(persistentNameProblem("@bore_main") == nullptr);
    CHECK(persistentNameProblem("@Bore2") == nullptr);
    CHECK(persistentNameProblem("bore") != nullptr);      // no '@'
    CHECK(persistentNameProblem("@") != nullptr);         // nothing after it
    CHECK(persistentNameProblem("") != nullptr);
    CHECK(persistentNameProblem("@bore:max") != nullptr);  // ':' would not survive
    CHECK_EQ_STR(toPersistentName("bore"), "@bore");
    CHECK_EQ_STR(toPersistentName("@bore"), "@bore");

    PartDocument doc = chain();
    // TAG is a PASS-THROUGH: it returns %body unchanged, so it produces a SOLID
    // from a SOLID, and the tree keeps building on it.
    doc.seed(IrValueKind::Solid, "b5", "TAG",
             {IrArg::valueRef(5), IrArg::text("@bore_main"), IrArg::text("bore:max")});
    doc.seed(IrValueKind::Solid, "b6", "RESIZEBORE",
             {IrArg::valueRef(6), IrArg::text("@bore_main"), IrArg::num(21.25)});

    const std::vector<PersistentName> names = persistentNames(doc);
    CHECK_EQ_INT(names.size(), 1);
    if (!names.empty()) {
      CHECK_EQ_INT(names[0].irId, 6);
      CHECK_EQ_INT(names[0].taggedId, 5);
      CHECK_EQ_STR(names[0].name, "@bore_main");
      CHECK_EQ_STR(names[0].declaredBy, "bore:max");
    }
    CHECK_EQ_STR(persistentNameOf(doc, 5), "@bore_main");
    CHECK_EQ_STR(persistentNameOf(doc, 4), "");

    // ── THE POINT OF A PERSISTENT NAME ──────────────────────────────────────
    // Insert a feature ABOVE the named one, and the downstream edit still names
    // the same face. Suppressing the fillet renumbers every emitted statement --
    // %6 becomes %5, %7 becomes %6 -- and "@bore_main" is untouched, because it
    // is not an index. A positional selector ("face:12") is exactly what would
    // have moved here.
    const std::string before = doc.irProgram();
    CHECK(before.find("RESIZEBORE(%6, \"@bore_main\", 21.25)") != std::string::npos);
    CHECK(doc.setSuppressed(3, true));
    const std::string after = doc.irProgram();
    CHECK(after.find("RESIZEBORE(%5, \"@bore_main\", 21.25)") != std::string::npos);
    CHECK(after.find("TAG(%4, \"@bore_main\", \"bore:max\")") != std::string::npos);
    CHECK(before != after);
    CHECK(doc.setSuppressed(3, false));

    // RENAMING a persistent name is an ARGUMENT EDIT of the TAG statement, which
    // means it goes through the existing validator and the existing undo stack --
    // there is no second naming mechanism to keep in step.
    std::vector<IrArg> args = doc.featureAt(6)->line.args;
    args[1] = IrArg::text("@main_bore");
    UndoStack stack;
    CHECK(stack.perform(doc, std::make_unique<EditFeatureArgsEdit>(6, args, "Rename @bore_main")));
    CHECK_EQ_STR(persistentNameOf(doc, 5), "@main_bore");
    CHECK(stack.undo(doc));
    CHECK_EQ_STR(persistentNameOf(doc, 5), "@bore_main");
    // And the operand may not move under it: that is a reparent, not a rename.
    std::vector<IrArg> moved = doc.featureAt(6)->line.args;
    moved[0] = IrArg::valueRef(4);
    CHECK(!doc.editFeatureArgs(6, moved));
    CHECK_EQ_STR(toString(doc.lastEdit()), "operand_changed");

    // Suppressing the TAG rebases its consumer, because TAG is pass-through --
    // and the RESIZEBORE that reads "@bore_main" then has no such name. It still
    // EMITS (the kernel is the authority on whether the selector resolves), which
    // is the honest split: the UI does not simulate face resolution.
    CHECK(doc.setSuppressed(6, true));
    CHECK(doc.irProgram().find("TAG(") == std::string::npos);
    CHECK(doc.irProgram().find("RESIZEBORE(%5, \"@bore_main\", 21.25)") != std::string::npos);
    CHECK(doc.setSuppressed(6, false));
  }

  // ══ ERROR SURFACING: the kernel blames an EMITTED op ══════════════════════
  {
    PartDocument doc = chain();
    CHECK(doc.setSuppressed(3, true));   // emitted %3 is now document %4 (the HOLE)
    const std::string verifierSaid =
        "first invalid solid is produced by op %3 HOLE (line 3): not closed";
    const std::vector<FeatureDiagnosis> all = diagnoseFeatures(doc, 3, verifierSaid);
    CHECK_EQ_INT(all.size(), 5);
    // The blame landed on document 4, NOT document 3 -- which is what the naive
    // "failedOpId == irId" comparison would have said, and it would have been the
    // suppressed row.
    std::size_t failed = 0;
    for (const FeatureDiagnosis& d : all) {
      if (d.issue != FeatureIssue::BuildFailed) continue;
      ++failed;
      CHECK_EQ_INT(d.irId, 4);
      CHECK_EQ_STR(d.detail, verifierSaid);   // VERBATIM: the numbers are the point
    }
    CHECK_EQ_INT(failed, 1);
    // ...and the suppressed row says suppressed, not failed.
    CHECK_EQ_STR(toString(diagnoseFeature(doc, 3, 3, verifierSaid).issue), "suppressed");
    // A build with no failure blames nobody.
    for (const FeatureDiagnosis& d : diagnoseFeatures(doc, 0, "")) {
      CHECK(d.issue != FeatureIssue::BuildFailed);
    }
  }

  // ══ THE COMMANDS, THROUGH THE ONE REGISTRY ════════════════════════════════
  {
    CommandRegistry reg;
    PartDocument doc = chain();
    UndoStack stack;
    SelectionService sel;
    CHECK_EQ_INT(registerPartCommands(reg, doc, stack), 29);

    CommandParams p;
    p.setNumber("feature", 3);
    CHECK(reg.dispatch("part.suppress_feature", sel, p).ok());
    CHECK(doc.featureAt(3)->suppressed);
    CHECK_EQ_INT(stack.undoDepth(), 1);
    // The undo label names the ROW, and a seeded record's row name is the node it
    // was seeded under -- which is what the tree shows for it too.
    CHECK_EQ_STR(stack.undoLabel(), "Suppress b2");
    // A second suppress of the same feature is a no-op and must NOT push a step
    // that undoes nothing.
    CHECK_EQ_INT(static_cast<int>(reg.evaluate("part.suppress_feature", sel, p).status),
                 static_cast<int>(DispatchStatus::Disabled));
    CHECK_EQ_INT(stack.undoDepth(), 1);
    CHECK(reg.dispatch("part.unsuppress_feature", sel, p).ok());
    CHECK(!doc.featureAt(3)->suppressed);
    // UNDO puts the suppression back, through the same one caretaker.
    CHECK(stack.undo(doc));
    CHECK(doc.featureAt(3)->suppressed);
    CHECK(stack.undo(doc));
    CHECK(!doc.featureAt(3)->suppressed);

    CommandParams del;
    del.setNumber("feature", 4);
    CHECK(reg.dispatch("part.delete_feature", sel, del).ok());
    CHECK(doc.featureAt(4)->deleted);
    CHECK_EQ_STR(doc.irProgram(),
                 "%1 = RECT(80, 50)\n"
                 "%2 = EXTRUDE(%1, 20)\n"
                 "%3 = FILLET(%2, 3, ALL)\n"
                 "%4 = SHELL(%3, 2)\n");
    CHECK(stack.undo(doc));
    CHECK(!doc.featureAt(4)->deleted);
    CHECK_EQ_STR(doc.irProgram(), chain().irProgram());

    CommandParams ren;
    ren.setNumber("feature", 4);
    ren.setText("name", "Pilot Bore");
    CHECK(reg.dispatch("part.rename_feature", sel, ren).ok());
    CHECK_EQ_STR(doc.featureAt(4)->label, "Pilot Bore");
    CHECK(stack.undo(doc));
    CHECK_EQ_STR(doc.featureAt(4)->label, "b3");

    CommandParams roll;
    roll.setNumber("feature", 2);
    CHECK(reg.dispatch("part.rollback_to", sel, roll).ok());
    CHECK_EQ_INT(doc.rollback(), 2);
    CHECK(reg.dispatch("part.rollback_end", sel).ok());
    CHECK_EQ_INT(doc.rollback(), 0);
    CHECK_EQ_INT(static_cast<int>(reg.evaluate("part.rollback_end", sel).status),
                 static_cast<int>(DispatchStatus::Disabled));   // already at the end
    CHECK(stack.undo(doc));
    CHECK_EQ_INT(doc.rollback(), 2);

    // A reorder that CANNOT move reports EditRefused with the pinning statement
    // named -- not a silent success, and not a crash.
    CommandParams bad;
    bad.setNumber("feature", 2);
    bad.setNumber("position", 5);
    const DispatchResult refused = reg.dispatch("part.reorder_feature", sel, bad);
    CHECK_EQ_INT(static_cast<int>(refused.status), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(refused.detail.find("%3 pins it") != std::string::npos);

    // A required parameter with no honest default is REPORTED, not guessed.
    CHECK_EQ_INT(static_cast<int>(reg.evaluate("part.rename_feature", sel).status),
                 static_cast<int>(DispatchStatus::MissingRequiredParameter));
  }

  // ══ part.tag_feature emits a real TAG statement ═══════════════════════════
  {
    CommandRegistry reg;
    PartDocument doc;
    UndoStack stack;
    SelectionService sel;
    registerPartCommands(reg, doc, stack);
    doc.seed(IrValueKind::Solid, "body_x", "BOX",
             {IrArg::num(80), IrArg::num(50), IrArg::num(20)});
    EntityRef face;
    face.kind = EntityKind::Face;
    face.bodyId = "body_x";
    face.persistentName = "face@1";
    sel.replaceWith({face});

    CommandParams p;
    p.setText("name", "@bore_main");
    CHECK(reg.dispatch("part.tag_feature", sel, p).ok());
    CHECK_EQ_STR(doc.irProgram(),
                 "%1 = BOX(80, 50, 20)\n"
                 "%2 = TAG(%1, \"@bore_main\", \"bore:max\")\n");
    CHECK_EQ_STR(persistentNameOf(doc, 1), "@bore_main");
    // The body keeps its IDENTITY -- a name is not a new body.
    CHECK_EQ_INT(doc.valueFor("body_x"), 2);

    // A name the KERNEL would refuse is refused here, where it can still be
    // fixed, rather than three layers down at compile time.
    CommandParams badName;
    badName.setText("name", "bore:max");
    CHECK_EQ_INT(static_cast<int>(reg.evaluate("part.tag_feature", sel, badName).status),
                 static_cast<int>(DispatchStatus::Disabled));
  }

  // ══ SCALE: 71 statements, the length the owner's fixtures reach ═══════════
  // "a 14-op tree is easy, but Archie emits trees of 40-70 statements and one
  // fixture has 71." Everything above, on that.
  {
    PartDocument doc;
    doc.seed(IrValueKind::Profile, "sk", "RECT", {IrArg::num(200), IrArg::num(120)});
    doc.seed(IrValueKind::Solid, "body", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(40)});
    // 69 more: a HOLE / FILLET alternation, each consuming the one before, which
    // is the shape a real bolt-pattern-plus-blend tree has.
    for (int i = 3; i <= 71; ++i) {
      if (i % 2 == 1) {
        doc.seed(IrValueKind::Solid, "body", "HOLE",
                 {IrArg::valueRef(i - 1), IrArg::num(6), IrArg::num(i * 2), IrArg::num(0),
                  IrArg::num(0)});
      } else {
        doc.seed(IrValueKind::Solid, "body", "FILLET",
                 {IrArg::valueRef(i - 1), IrArg::num(1), IrArg::keyword("ALL")});
      }
    }
    CHECK_EQ_INT(doc.records().size(), 71);
    const PartDocument::EmissionPlan full = doc.emissionPlan();
    CHECK_EQ_INT(full.emittedCount(), 71);
    CHECK_EQ_INT(full.omitted().size(), 0);

    // Suppress every third feature. All of them are pass-through, so the tree
    // must still build end to end -- 48 statements, one chain, no orphans and no
    // broken operands.
    std::size_t suppressed = 0;
    for (int i = 3; i <= 71; i += 3) {
      CHECK(doc.setSuppressed(i, true));
      ++suppressed;
    }
    CHECK_EQ_INT(suppressed, 23);
    const PartDocument::EmissionPlan p = doc.emissionPlan();
    CHECK_EQ_INT(p.emittedCount(), 71 - 23);
    CHECK_EQ_INT(p.omitted().size(), 23);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::OperandUnavailable), 0);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::Orphaned), 0);

    // The emitted program is DENSE and every reference resolves BACKWARDS -- the
    // property forge::ft::parse enforces and the one a renumbering can break.
    int seen = 0;
    for (const PartDocument::Emitted& e : p.emitted()) {
      ++seen;
      CHECK_EQ_INT(e.emittedId, seen);
      CHECK_EQ_INT(p.documentIdFor(e.emittedId), e.documentId);
    }
    // Re-derive the emitted statements and validate each one, ids and all.
    {
      std::size_t lines = 0;
      std::size_t badRefs = 0;
      const std::string program = p.program();
      std::size_t pos = 0;
      while (pos < program.size()) {
        const std::size_t nl = program.find('\n', pos);
        const std::string line = program.substr(pos, nl - pos);
        pos = nl == std::string::npos ? program.size() : nl + 1;
        if (line.empty()) continue;
        ++lines;
        // "%<id> = OP(...)": the id must equal the line number, and every "%k"
        // inside the parentheses must be < that id.
        const std::size_t eq = line.find(" = ");
        const int id = std::atoi(line.c_str() + 1);
        if (id != static_cast<int>(lines)) ++badRefs;
        for (std::size_t k = eq; k + 1 < line.size(); ++k) {
          if (line[k] != '%') continue;
          if (std::atoi(line.c_str() + k + 1) >= id) ++badRefs;
        }
      }
      CHECK_EQ_INT(lines, 48);
      CHECK_EQ_INT(badRefs, 0);
    }

    // A rollback on top of the suppressions, and the two compose.
    doc.setRollback(40);
    CHECK_EQ_INT(doc.rollback(), 40);
    CHECK_EQ_INT(countOmitted(doc, PartDocument::OmitReason::RolledBack), 31);
    const PartDocument::EmissionPlan rolled = doc.emissionPlan();
    CHECK_EQ_INT(rolled.emittedCount() + rolled.omitted().size(), 71);

    // ...and a delete of the EXTRUDE, which is the one statement in this tree
    // whose loss breaks everything downstream. It is ALLOWED, and every casualty
    // is named.
    doc.setRollback(0);
    for (int i = 3; i <= 71; i += 3) doc.setSuppressed(i, false);
    const Impact impact = previewDelete(doc, 2);
    CHECK(impact.possible);
    CHECK_EQ_INT(impact.stops, 71);   // the EXTRUDE, 69 broken consumers, the orphaned RECT
    std::size_t namedCasualties = 0;
    for (const ImpactRow& r : impact.rows) {
      if (r.after == PartDocument::OmitReason::OperandUnavailable && r.blockingId == 2) {
        ++namedCasualties;
      }
    }
    CHECK_EQ_INT(namedCasualties, 69);
    CHECK(doc.setDeleted(2, true));
    CHECK_EQ_STR(doc.irProgram(), impact.program);
    CHECK_EQ_STR(doc.irProgram(), "");
  }

  // ══ UNDO/REDO over the history operations, at scale ═══════════════════════
  // Every history edit shares one memento (the whole document), so the property
  // that matters is that a round trip is EXACT -- including after a renumbering,
  // where a hand-written inverse would be wrong.
  {
    PartDocument doc = chain();
    const std::string pristine = doc.irProgram();
    UndoStack stack;
    CHECK(stack.perform(doc, std::make_unique<SuppressFeatureEdit>(3, true, "Suppress")));
    CHECK(stack.perform(doc, std::make_unique<DeleteFeatureEdit>(4, "Delete")));
    CHECK(stack.perform(doc, std::make_unique<RollbackEdit>(2, "Roll Back")));
    CHECK(stack.perform(doc, std::make_unique<RenameFeatureEdit>(1, "Base", "Rename")));
    CHECK_EQ_INT(stack.undoDepth(), 4);
    while (stack.undo(doc)) {
    }
    CHECK_EQ_STR(doc.irProgram(), pristine);
    CHECK_EQ_STR(doc.featureAt(1)->label, "sk");
    CHECK_EQ_INT(doc.rollback(), 0);
    CHECK(!doc.featureAt(3)->suppressed);
    CHECK(!doc.featureAt(4)->deleted);
    // ...and redo replays all four.
    while (stack.redo(doc)) {
    }
    CHECK_EQ_INT(stack.undoDepth(), 4);
    CHECK_EQ_INT(doc.rollback(), 2);
    CHECK_EQ_STR(doc.featureAt(1)->label, "Base");

    // A no-op history edit is REFUSED rather than pushed, so Ctrl+Z never lands
    // on a step that does nothing.
    UndoStack s2;
    PartDocument d2 = chain();
    CHECK(!s2.perform(d2, std::make_unique<SuppressFeatureEdit>(3, false, "Unsuppress")));
    CHECK_EQ_INT(s2.undoDepth(), 0);
    CHECK(!s2.perform(d2, std::make_unique<RenameFeatureEdit>(3, "b2", "Rename")));
    CHECK_EQ_INT(s2.undoDepth(), 0);
    CHECK(!s2.perform(d2, std::make_unique<RollbackEdit>(0, "Roll")));
    CHECK_EQ_INT(s2.undoDepth(), 0);
    CHECK(!s2.perform(d2, std::make_unique<MoveFeatureEdit>(3, 3, "Move")));
    CHECK_EQ_INT(s2.undoDepth(), 0);
  }

  // A reorder round-trips through undo with every reference restored.
  {
    PartDocument doc;
    doc.seed(IrValueKind::Profile, "sk1", "RECT", {IrArg::num(80), IrArg::num(50)});
    doc.seed(IrValueKind::Solid, "b1", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(20)});
    doc.seed(IrValueKind::Profile, "sk2", "CIRCLE", {IrArg::num(10)});
    doc.seed(IrValueKind::Solid, "b2", "EXTRUDE", {IrArg::valueRef(3), IrArg::num(30)});
    doc.seed(IrValueKind::Solid, "b3", "FUSE", {IrArg::valueRef(2), IrArg::valueRef(4)});
    const std::string pristine = doc.irProgram();
    UndoStack stack;
    auto edit = std::make_unique<MoveFeatureEdit>(3, 1, "Reorder");
    MoveFeatureEdit* raw = edit.get();
    CHECK(stack.perform(doc, std::move(edit)));
    CHECK_EQ_INT(raw->clampedTo(), 1);
    CHECK(doc.irProgram() != pristine);
    CHECK(stack.undo(doc));
    CHECK_EQ_STR(doc.irProgram(), pristine);
    CHECK_EQ_INT(doc.valueFor("sk2"), 3);
    CHECK(stack.redo(doc));
    CHECK_EQ_INT(doc.valueFor("sk2"), 1);
  }

  return H.finish();
}
