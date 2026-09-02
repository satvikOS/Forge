// ui/test/document_walk_test.cpp
//
// MID-WALK CONTAINER MUTATION, ONE CONTAINER OVER.
//
// D-026: this application has shipped THREE crashes on one root cause —
// mutating a container while a frame is walking it. The dock tree grew a walk
// guard for exactly that, and `reseatsDuringWalk()` is asserted zero by the
// click gate. The DOCUMENT is the other container a frame walks, and it had no
// guard at all.
//
// The shape is identical and it is reachable from a button. A feature-tree
// panel draws its rows by iterating `model.tree().records()`. Every structural
// edit on this document REBUILDS that vector — `deleteFeature` and
// `reorderFeature` renumber the entire SSA program through `installTree()`, so
// the backing storage is replaced outright. Click a row's delete button while
// the panel is inside that loop and every reference, iterator and index it
// holds is dangling on the next iteration.
//
// ── what this gate proves, and what it deliberately does NOT do ─────────────
// It does NOT prove "the edit is refused". Refusing would be the wrong fix, and
// the owner's constraint is explicit: REPRESENT / REPAIR / TOLERATE, never
// refuse. An application that drops a user's click because it happened to be
// drawing at the time is broken in a quieter way than one that crashes. So the
// contract is DEFERRAL, and the three things a deferral has to get right are
// what is asserted here:
//
//   1. SAFETY  — the container is not rebuilt while the walk is open. The walk
//      below reads every record on every iteration and compares against a
//      snapshot taken before it started, so a rebuild underneath it is a
//      value mismatch rather than a hope.
//   2. FIDELITY — the edits still happen, in the order they were asked for, and
//      the document that results is BYTE-IDENTICAL to the one you get by making
//      the same edits outside a walk. Deferral that changes the answer is not
//      deferral, it is a second code path.
//   3. HONESTY — a deferred edit that fails for a REAL reason (a delete that
//      would strand a consumer) is reported, not swallowed. The caller is no
//      longer on the stack to be handed the status, so it lands in
//      pendingEditErrors() instead of nowhere.
//
// Section 5 is the negative control: it drives the SAME edits through the
// unguarded path and shows the container really is reseated underneath a reader
// — because a guard that is never shown to be load-bearing is decoration.
#include <cstddef>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DocumentModel.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

EntityRef ref(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

CommandParams num1(const std::string& n, double v) {
  CommandParams p;
  p.setNumber(n, v);
  return p;
}

// A document with a real chain of statements, authored through the real
// registry: RECT -> EXTRUDE -> FILLET -> SHELL, plus an independent BOX. The
// chain matters — a delete has to have a consumer to strand.
void author(DocumentModel& model, CommandRegistry& registry, SelectionService& sel) {
  registerPartCommands(registry, model.tree(), model.undo());
  PartDocument& tree = model.tree();
  tree.seed(IrValueKind::Profile, "sketch_1", "RECT", {IrArg::num(80), IrArg::num(60)});
  tree.seed(IrValueKind::Solid, "body_x", "BOX", {IrArg::num(5), IrArg::num(5), IrArg::num(5)});
  sel.replaceWith({ref("sketch_1", EntityKind::Sketch, "s1")});
  registry.dispatch("part.extrude", sel, num1("distance", 20));
  sel.replaceWith({ref("body_3", EntityKind::Edge, "e1")});
  registry.dispatch("part.fillet", sel, num1("radius", 4));
  sel.replaceWith({ref("body_3", EntityKind::Face, "f1")});
  registry.dispatch("part.shell", sel, num1("thickness", 2));
}

// The full text of every statement, in order — the cheap observable that says
// whether the container moved.
std::vector<std::string> snapshot(const DocumentModel& model) {
  std::vector<std::string> out;
  for (const FeatureRecord& r : model.tree().records()) out.push_back(r.line.text());
  return out;
}

}  // namespace

int main() {
  Harness H("document_walk");

  // ── 1. the baseline: these edits, made OUTSIDE any walk ───────────────────
  // This is the reference answer. Everything below has to reproduce it exactly.
  std::string referenceProgram;
  std::string referenceDigest;
  std::size_t referenceCount = 0;
  {
    DocumentModel model;
    CommandRegistry registry;
    SelectionService sel;
    author(model, registry, sel);
    CHECK_EQ_INT(model.tree().records().size(), 5);
    CHECK(!model.walking());

    CHECK_EQ_INT(static_cast<int>(model.setSuppressed(5, true)),
                 static_cast<int>(TreeEditStatus::Ok));
    CHECK_EQ_INT(static_cast<int>(model.renameFeature(4, "Edge break")),
                 static_cast<int>(TreeEditStatus::Ok));
    referenceProgram = model.irProgram();
    referenceDigest = model.contentDigest();
    referenceCount = model.tree().records().size();
    CHECK_EQ_INT(model.deferredEditCount(), 0);  // nothing was deferred
  }

  // ── 2. SAFETY: the container is not rebuilt underneath the walk ───────────
  {
    DocumentModel model;
    CommandRegistry registry;
    SelectionService sel;
    author(model, registry, sel);

    const std::vector<std::string> before = snapshot(model);
    CHECK_EQ_INT(before.size(), 5);

    std::size_t rowsDrawn = 0;
    std::size_t mismatches = 0;
    {
      DocumentWalk walk(model);
      CHECK(model.walking());
      CHECK_EQ_INT(model.walkDepth(), 1);

      // THE PANEL LOOP. Iterating by reference over the live container, exactly
      // as a feature-tree panel draws its rows, and requesting a structural
      // edit from inside it — the gesture that used to be a use-after-free.
      const std::vector<FeatureRecord>& rows = model.tree().records();
      for (std::size_t i = 0; i < rows.size(); ++i) {
        ++rowsDrawn;
        // read EVERY row on EVERY iteration: if the vector were reseated, the
        // storage would have moved and these would stop matching.
        for (std::size_t j = 0; j < rows.size(); ++j) {
          if (j < before.size() && rows[j].line.text() != before[j]) ++mismatches;
        }
        if (i == 1) {
          CHECK_EQ_INT(static_cast<int>(model.setSuppressed(5, true)),
                       static_cast<int>(TreeEditStatus::Deferred));
        }
        if (i == 3) {
          CHECK_EQ_INT(static_cast<int>(model.renameFeature(4, "Edge break")),
                       static_cast<int>(TreeEditStatus::Deferred));
        }
      }
      // the walk is still open, so NOTHING has been applied yet
      CHECK_EQ_INT(model.pendingEdits(), 2);
      CHECK_EQ_INT(model.tree().records().size(), 5);
      CHECK(!model.suppressed(5));
    }  // ← the queue runs HERE

    CHECK_EQ_INT(rowsDrawn, 5);
    CHECK_EQ_INT(mismatches, 0);  // the container never moved during the walk
    CHECK(!model.walking());
    CHECK_EQ_INT(model.pendingEdits(), 0);
    CHECK_EQ_INT(model.deferredEditCount(), 2);
    CHECK_EQ_INT(model.pendingEditErrors().size(), 0);

    // ── 3. FIDELITY: the deferred result IS the reference result ────────────
    CHECK(model.suppressed(5));
    CHECK_EQ_INT(model.tree().records().size(), referenceCount);
    CHECK_EQ_STR(model.irProgram(), referenceProgram);
    CHECK_EQ_STR(model.contentDigest(), referenceDigest);
  }

  // ── 4. the harder case: a DELETE, which renumbers everything ──────────────
  // Suppress and rename leave the statement ids alone. Delete does not: it
  // renumbers the whole program, which is the edit that genuinely reseats the
  // vector, and the one a panel is most likely to offer per row.
  {
    DocumentModel direct;
    CommandRegistry r1;
    SelectionService s1;
    author(direct, r1, s1);
    CHECK_EQ_INT(static_cast<int>(direct.deleteFeature(5, DeletePolicy::Cascade)),
                 static_cast<int>(TreeEditStatus::Ok));
    const std::string deletedProgram = direct.irProgram();
    const std::size_t deletedCount = direct.tree().records().size();
    CHECK(deletedCount < 5);

    DocumentModel walked;
    CommandRegistry r2;
    SelectionService s2;
    author(walked, r2, s2);
    const std::vector<std::string> before = snapshot(walked);
    std::size_t mismatches = 0;
    {
      DocumentWalk walk(walked);
      const std::vector<FeatureRecord>& rows = walked.tree().records();
      for (std::size_t i = 0; i < rows.size(); ++i) {
        for (std::size_t j = 0; j < rows.size(); ++j) {
          if (j < before.size() && rows[j].line.text() != before[j]) ++mismatches;
        }
        if (i == 0) {
          CHECK_EQ_INT(static_cast<int>(walked.deleteFeature(5, DeletePolicy::Cascade)),
                       static_cast<int>(TreeEditStatus::Deferred));
        }
      }
      // the row count is UNCHANGED for the rest of the frame, so the panel's
      // own loop bound stays valid to its end
      CHECK_EQ_INT(rows.size(), 5);
    }
    CHECK_EQ_INT(mismatches, 0);
    CHECK_EQ_INT(walked.tree().records().size(), deletedCount);
    CHECK_EQ_STR(walked.irProgram(), deletedProgram);

    // ── ORDER IS PRESERVED ───────────────────────────────────────────────
    // Two edits queued in one walk must apply in the order they were asked
    // for. A queue that reordered them would be a different document.
    DocumentModel a;
    CommandRegistry ra;
    SelectionService sa;
    author(a, ra, sa);
    a.renameFeature(3, "First");
    a.renameFeature(3, "Second");
    const std::string sequential = a.irProgram();
    const FeatureRecord* aRec = a.tree().featureAt(3);
    CHECK(aRec != nullptr);

    DocumentModel b;
    CommandRegistry rb;
    SelectionService sb;
    author(b, rb, sb);
    {
      DocumentWalk walk(b);
      b.renameFeature(3, "First");
      b.renameFeature(3, "Second");
    }
    const FeatureRecord* bRec = b.tree().featureAt(3);
    CHECK(bRec != nullptr);
    if (aRec != nullptr && bRec != nullptr) {
      CHECK_EQ_STR(bRec->label, aRec->label);
      CHECK_EQ_STR(bRec->label, "Second");  // not "First"
    }
    CHECK_EQ_STR(b.irProgram(), sequential);
  }

  // ── 5. THE NEGATIVE CONTROL ───────────────────────────────────────────────
  // A guard that is never shown to be load-bearing is decoration. Drive the
  // same delete WITHOUT a walk and confirm the container really is reseated
  // under a reader that took its bounds first: if this came back "no change",
  // sections 2-4 would be proving nothing at all.
  {
    DocumentModel model;
    CommandRegistry registry;
    SelectionService sel;
    author(model, registry, sel);
    const std::vector<std::string> before = snapshot(model);
    const std::size_t boundTakenFirst = model.tree().records().size();
    CHECK_EQ_INT(boundTakenFirst, 5);

    CHECK_EQ_INT(static_cast<int>(model.deleteFeature(5, DeletePolicy::Cascade)),
                 static_cast<int>(TreeEditStatus::Ok));

    // The stale bound is now WRONG — a panel that cached it and kept indexing
    // would run off the end of the live vector. That is the crash, made
    // visible as a number instead of a signal.
    const std::size_t nowHolds = model.tree().records().size();
    CHECK(nowHolds < boundTakenFirst);
    std::printf("[document_walk] negative control: an UNGUARDED delete took the record count "
                "%zu -> %zu mid-frame; a panel holding the old bound indexes past the end\n",
                boundTakenFirst, nowHolds);
    // and the contents moved too, so it is a reseat and not merely a shrink
    const std::vector<std::string> after = snapshot(model);
    bool contentsMoved = after.size() != before.size();
    for (std::size_t i = 0; i < after.size() && i < before.size(); ++i) {
      if (after[i] != before[i]) contentsMoved = true;
    }
    CHECK(contentsMoved);
  }

  // ── 6. the guard's own edges ──────────────────────────────────────────────
  {
    DocumentModel model;
    CommandRegistry registry;
    SelectionService sel;
    author(model, registry, sel);

    // NESTING: an inner walk closing must not apply the queue. A panel that
    // draws a sub-tree inside a row would otherwise rebuild the document in the
    // middle of the outer loop, which is the exact defect one level down.
    {
      DocumentWalk outer(model);
      CHECK_EQ_INT(model.walkDepth(), 1);
      {
        DocumentWalk inner(model);
        CHECK_EQ_INT(model.walkDepth(), 2);
        model.setSuppressed(5, true);
        CHECK_EQ_INT(model.pendingEdits(), 1);
      }
      CHECK_EQ_INT(model.walkDepth(), 1);
      CHECK_EQ_INT(model.pendingEdits(), 1);  // the INNER close applied nothing
      CHECK(!model.suppressed(5));
    }
    CHECK_EQ_INT(model.walkDepth(), 0);
    CHECK_EQ_INT(model.pendingEdits(), 0);
    CHECK(model.suppressed(5));

    // An unbalanced close must not wrap the depth around. endWalk() on a
    // document that is not walking is a no-op, not an underflow that would make
    // walking() true for the next four billion frames.
    CHECK_EQ_INT(model.endWalk(), 0);
    CHECK_EQ_INT(model.walkDepth(), 0);
    CHECK(!model.walking());

    // applyPendingEdits() while a walk is open must do NOTHING — it is the one
    // call that could defeat the whole mechanism by being invoked from inside a
    // panel body.
    {
      DocumentWalk walk(model);
      model.renameFeature(3, "Deferred");
      CHECK_EQ_INT(model.pendingEdits(), 1);
      CHECK_EQ_INT(model.applyPendingEdits(), 0);  // refused: still walking
      CHECK_EQ_INT(model.pendingEdits(), 1);
    }
    CHECK_EQ_INT(model.pendingEdits(), 0);

    // ── 7. HONESTY: a deferred edit that really fails is REPORTED ──────────
    // %3 is consumed by %4, so deleting it with RefuseIfReferenced is a genuine
    // refusal. The caller is no longer on the stack, so the reason has to land
    // somewhere a user can be shown it rather than being dropped on the floor.
    const std::string programBefore = model.irProgram();
    {
      DocumentWalk walk(model);
      CHECK_EQ_INT(static_cast<int>(model.deleteFeature(3, DeletePolicy::RefuseIfReferenced)),
                   static_cast<int>(TreeEditStatus::Deferred));
    }
    CHECK_EQ_INT(model.pendingEditErrors().size(), 1);
    if (!model.pendingEditErrors().empty()) {
      const std::string& why = model.pendingEditErrors().front();
      CHECK(why.find("%3") != std::string::npos);
      // it names the CONSUMER, so a repair loop can act instead of guessing
      CHECK(why.find("consumed by") != std::string::npos);
      std::printf("[document_walk] a deferred edit that failed for a real reason reported: %s\n",
                  why.c_str());
    }
    // and the document is untouched by the failed edit
    CHECK_EQ_STR(model.irProgram(), programBefore);
  }

  // ── 7b. A THROW OUT OF A PANEL BODY ───────────────────────────────────────
  // This is why the guard is RAII and not a matching endWalk() call. A panel
  // that throws midway through drawing its rows must still close the walk, or
  // the depth stays above zero for ever and EVERY later edit is deferred and
  // never applied — a silent, permanent failure that looks like the app
  // ignoring the user.
  {
    DocumentModel model;
    CommandRegistry registry;
    SelectionService sel;
    author(model, registry, sel);

    bool caught = false;
    try {
      DocumentWalk walk(model);
      CHECK_EQ_INT(static_cast<int>(model.renameFeature(4, "Queued before the throw")),
                   static_cast<int>(TreeEditStatus::Deferred));
      throw std::runtime_error("a panel body failed mid-draw");
    } catch (const std::runtime_error&) {
      caught = true;
    }
    CHECK(caught);
    // the guard ran during unwinding: the depth is back to zero...
    CHECK_EQ_INT(model.walkDepth(), 0);
    CHECK(!model.walking());
    // ...and the edit queued before the throw was APPLIED, not lost
    CHECK_EQ_INT(model.pendingEdits(), 0);
    const FeatureRecord* renamed = model.tree().featureAt(4);
    CHECK(renamed != nullptr);
    if (renamed != nullptr) CHECK_EQ_STR(renamed->label, "Queued before the throw");

    // and the document is still usable afterwards — a later edit applies
    // immediately, which it would not if the depth had been left stuck
    CHECK_EQ_INT(static_cast<int>(model.renameFeature(4, "After")),
                 static_cast<int>(TreeEditStatus::Ok));
  }

  // ── 8. the status is a real enumerator, and toString covers it ────────────
  CHECK_EQ_STR(toString(TreeEditStatus::Deferred), "deferred to the end of the walk");
  CHECK(std::string(toString(TreeEditStatus::Deferred)) !=
        std::string(toString(TreeEditStatus::Refused)));
  CHECK(std::string(toString(TreeEditStatus::Deferred)) !=
        std::string(toString(TreeEditStatus::Ok)));

  return H.finish();
}
