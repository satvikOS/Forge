// ui/test/feature_tree_history_test.cpp
//
// THE HISTORY MODELLER. A feature tree you cannot roll back, reorder or suppress
// is a log of what happened, and a log is not a document.
//
// 689 lines of PartDocumentState.cpp shipped with no gate. This is it, and it is
// asserted on a 71-statement document because every defect here is a defect that
// only appears at length: a `%N` rewrite has 71 chances to be off by one, a
// suppression's pass-through has to survive twenty-two FUSEs, and an orphan
// prune needs real orphans to find.
//
// ── the constraint that shapes every check below ────────────────────────────
// "dont gate anything if you do that then how will Archie generate ultra long
// feature trees for Kernel to execute" -- REPRESENT / REPAIR / TOLERATE, never
// refuse. So the interesting assertions are not "the bad edit was rejected".
// They are: the bad edit was PERFORMED, the row that broke says WHY in the
// validator's own words, every row downstream says WHICH row broke it BY NAME,
// and nothing broken reached the kernel. A modeller that refuses the drag leaves
// the user with no way to see what was wrong with it, and an ultra-long
// generated tree with one bad edge is not a tree to throw away.
//
// ── ONE WALK, TWO ANSWERS ───────────────────────────────────────────────────
// resolveGraph() decides both what colour a row is and what program the kernel
// gets. Every section below therefore checks BOTH: the per-row status AND
// activeIrProgram(). A row shown green whose statement was silently dropped from
// the build is the exact defect this layer exists to prevent, and a gate that
// only reads the statuses could not see it.
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "part_document_fixture.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::buildFixture;
using forge::uitest::buildFixtureProgram;
using forge::uitest::FixtureOptions;
using forge::uitest::Harness;
using forge::uitest::kFixtureBodyAlias;
using forge::uitest::kFixtureBodyNode;
using forge::uitest::kFixtureBossFillet;
using forge::uitest::kFixtureBossFuse;
using forge::uitest::kFixtureDimpleCut;
using forge::uitest::kFixtureDimpleMove;
using forge::uitest::kFixtureDimpleSphere;
using forge::uitest::kFixtureLoft;
using forge::uitest::kFixturePinFuse;
using forge::uitest::kFixtureRib1Rotate;
using forge::uitest::kFixtureStatements;

namespace {

bool contains(const std::string& haystack, const std::string& needle) {
  return haystack.find(needle) != std::string::npos;
}

std::size_t lineCount(const std::string& program) {
  std::size_t n = 0;
  for (const char c : program) {
    if (c == '\n') ++n;
  }
  return n;
}

bool programHas(const std::string& program, const std::string& statement) {
  return contains(program, statement + "\n");
}

std::size_t countStatus(const PartDocument& doc, FeatureStatus want) {
  std::size_t n = 0;
  for (int id = 1; id <= static_cast<int>(doc.records().size()); ++id) {
    if (doc.statusOf(id) == want) ++n;
  }
  return n;
}

// Every statement a legal program emits must be numbered 1..m in order, and
// every `%N` in it must name an EARLIER statement. If activeIrProgram() ever
// emits something that fails this, the kernel would refuse the whole program --
// which is the failure mode the healing exists to prevent.
bool programIsSelfConsistent(const std::string& program) {
  int expect = 1;
  std::size_t at = 0;
  while (at < program.size()) {
    const std::size_t end = program.find('\n', at);
    if (end == std::string::npos) break;
    const std::string line = program.substr(at, end - at);
    at = end + 1;
    if (line.empty()) continue;
    if (line[0] != '%') return false;
    const std::size_t eq = line.find(" = ");
    if (eq == std::string::npos) return false;
    if (line.substr(1, eq - 1) != std::to_string(expect)) return false;
    // Every ref in the argument list must be < expect.
    for (std::size_t i = eq; i < line.size(); ++i) {
      if (line[i] != '%') continue;
      std::size_t j = i + 1;
      std::string digits;
      while (j < line.size() && line[j] >= '0' && line[j] <= '9') digits += line[j++];
      if (digits.empty()) return false;
      if (std::stoi(digits) >= expect) return false;
      i = j - 1;
    }
    ++expect;
  }
  return true;
}

}  // namespace

int main() {
  Harness H("feature_tree_history");

  // ── 0. the baseline: nothing suppressed, no bar ───────────────────────────
  // activeIrProgram() == irProgram() on a document nobody has touched. This is
  // the property that makes every later difference attributable.
  PartDocument base;
  CHECK(buildFixture(base, FixtureOptions{}));
  CHECK_EQ_INT(base.records().size(), kFixtureStatements);
  CHECK_EQ_STR(base.activeIrProgram(), base.irProgram());
  CHECK_EQ_INT(lineCount(base.irProgram()), kFixtureStatements);
  CHECK_EQ_INT(base.builtCount(), kFixtureStatements);
  CHECK_EQ_INT(base.errorCount(), 0);
  CHECK_EQ_INT(base.blockedFeatures().size(), 0);
  CHECK(programIsSelfConsistent(base.activeIrProgram()));
  for (int id = 1; id <= kFixtureStatements; ++id) {
    CHECK_EQ_STR(toString(base.statusOf(id)), toString(FeatureStatus::Ok));
    CHECK_EQ_STR(base.diagnosticOf(id), "");   // "" if and only if Ok
  }

  // ── 1. SUPPRESSION, and the PASS-THROUGH that makes it usable ─────────────
  // Suppressing one statement in a chain of seventy-one must not orphan the
  // other seventy. %25 = ROTATE(%24, 45, 0, 0, 1) hands %24 down, so
  // %26 = TRANSLATE(%25, ...) keeps building -- off %24.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK(doc.setSuppressed(kFixtureRib1Rotate, true));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureRib1Rotate)),
                 toString(FeatureStatus::Suppressed));
    CHECK(contains(doc.diagnosticOf(kFixtureRib1Rotate), "not built"));
    // EXACTLY ONE row lost, and it is that one. Nothing downstream blocked.
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Suppressed), 1);
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Blocked), 0);
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Ok), kFixtureStatements - 1);
    const std::string active = doc.activeIrProgram();
    CHECK_EQ_INT(lineCount(active), kFixtureStatements - 1);
    CHECK(programIsSelfConsistent(active));
    // THE HEALING, in the emitted text: the consumer now names the value the
    // suppressed row passed through, renumbered into the shorter program.
    CHECK(programHas(active, "%24 = BOX(70, 6, 18)"));
    CHECK(programHas(active, "%25 = TRANSLATE(%24, 0, 0, 8)"));
    CHECK(!contains(active, "ROTATE(%24, 45"));
    // The DOCUMENT is unchanged -- suppression hides a statement, it does not
    // delete one, and irProgram() is still the document as written.
    CHECK_EQ_STR(doc.irProgram(), base.irProgram());
    // And it comes back.
    CHECK(doc.setSuppressed(kFixtureRib1Rotate, false));
    CHECK_EQ_STR(doc.activeIrProgram(), base.activeIrProgram());
  }

  // ── 2. suppression with NOTHING TO PASS THROUGH ───────────────────────────
  // A BOX has no value input, so suppressing it leaves its consumer with no
  // value at all. The consumer is told exactly that, by name.
  //
  // MEASURED, and worth stating plainly because it is what makes the tree
  // readable rather than what makes the model right: %24 is a rib BLANK, and the
  // rib's FUSE is the accumulator, so suppressing the blank takes the whole
  // chain below it. The document does not refuse the gesture and does not fail
  // silently -- it builds the twenty-three statements that still make sense and
  // gives every one of the other forty-seven rows its own reason. Section 2b is
  // the gesture a user actually makes.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK(doc.setSuppressed(24, true));   // %24 = BOX(70, 6, 18), a rib blank
    CHECK_EQ_STR(toString(doc.statusOf(24)), toString(FeatureStatus::Suppressed));
    CHECK_EQ_STR(toString(doc.statusOf(25)), toString(FeatureStatus::Blocked));
    CHECK(contains(doc.diagnosticOf(25), "%24"));
    CHECK(contains(doc.diagnosticOf(25), "Rib"));            // the row's LABEL
    CHECK(contains(doc.diagnosticOf(25), "no value to pass through"));
    // and the consequence propagates, each row naming ITS OWN culprit rather
    // than repeating the original one.
    CHECK_EQ_STR(toString(doc.statusOf(26)), toString(FeatureStatus::Blocked));
    CHECK(contains(doc.diagnosticOf(26), "%25"));
    CHECK(contains(doc.diagnosticOf(26), "Rib turned"));
    CHECK_EQ_STR(toString(doc.statusOf(27)), toString(FeatureStatus::Blocked));
    CHECK(contains(doc.diagnosticOf(27), "%26"));
    CHECK(contains(doc.diagnosticOf(27), "Rib placed"));
    // Everything past the broken accumulator is orphaned rather than blocked by
    // an input, and says the DIFFERENT thing that is true of it.
    CHECK_EQ_STR(toString(doc.statusOf(28)), toString(FeatureStatus::Blocked));
    CHECK(contains(doc.diagnosticOf(28), "nothing consumes its value"));
    // What still builds is the part up to the last coherent result: plate, boss,
    // four pads and the first rib.
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Ok), 23);
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Blocked), 47);
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Suppressed), 1);
    CHECK_EQ_INT(lineCount(doc.activeIrProgram()), 23);
    CHECK(programIsSelfConsistent(doc.activeIrProgram()));
    CHECK(programHas(doc.activeIrProgram(), "%23 = FUSE(%19, %22)"));
  }

  // ── 2b. suppressing the FEATURE, which is the gesture a user makes ────────
  // A rib is four statements and ONE feature: the FUSE that adds it. Suppress
  // that and the pass-through hands %23 down, the rib's own three statements are
  // orphaned and pruned, and the other sixty-seven statements build unchanged.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK(doc.setSuppressed(27, true));   // %27 = FUSE(%23, %26), "Rib to plate"
    CHECK_EQ_STR(toString(doc.statusOf(27)), toString(FeatureStatus::Suppressed));
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Blocked), 3);   // 24, 25, 26
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Ok), kFixtureStatements - 4);
    const std::string active = doc.activeIrProgram();
    CHECK_EQ_INT(lineCount(active), kFixtureStatements - 4);
    CHECK(programIsSelfConsistent(active));
    // The next rib fuses onto what the suppressed one passed through.
    CHECK(programHas(active, "%23 = FUSE(%19, %22)"));
    CHECK(programHas(active, "%27 = FUSE(%23, %26)"));
    CHECK(!contains(active, "ROTATE(%24, 45"));
    CHECK(doc.setSuppressed(27, false));
    CHECK_EQ_STR(doc.activeIrProgram(), base.activeIrProgram());
  }

  // ── 3. suppressing a BOOLEAN orphans its tool, and the prune says so ──────
  // forge::ft::compile fails the WHOLE program on an op that "contributes
  // nothing to the result". Suppressing %69 = CUT(%66, %68) leaves the dimple
  // (%67, %68) feeding nothing, so a program that was fine would become one the
  // kernel refuses in full. They are dropped from the BUILD and reported.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK(doc.setSuppressed(kFixtureDimpleCut, true));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureDimpleCut)),
                 toString(FeatureStatus::Suppressed));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureDimpleSphere)),
                 toString(FeatureStatus::Blocked));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureDimpleMove)),
                 toString(FeatureStatus::Blocked));
    CHECK(contains(doc.diagnosticOf(kFixtureDimpleSphere), "nothing consumes its value"));
    CHECK(contains(doc.diagnosticOf(kFixtureDimpleSphere), "unused result"));
    const std::string active = doc.activeIrProgram();
    CHECK_EQ_INT(lineCount(active), kFixtureStatements - 3);
    CHECK(programIsSelfConsistent(active));
    CHECK(!contains(active, "SPHERE"));
    // The pin still fuses, onto what the suppressed CUT passed through.
    CHECK(programHas(active, "%68 = FUSE(%66, %67)"));
    CHECK_EQ_INT(doc.blockedFeatures().size(), 3);
  }

  // ── 4. the ROLLBACK BAR ───────────────────────────────────────────────────
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK(doc.setRollbackAfter(kFixtureDimpleMove));   // after %68
    CHECK_EQ_INT(doc.rollbackAfter(), kFixtureDimpleMove);
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureDimpleMove)), toString(FeatureStatus::Blocked));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureDimpleCut)), toString(FeatureStatus::RolledBack));
    CHECK_EQ_STR(toString(doc.statusOf(kFixturePinFuse)), toString(FeatureStatus::RolledBack));
    CHECK(contains(doc.diagnosticOf(kFixtureDimpleCut), "rolled back"));
    CHECK(contains(doc.diagnosticOf(kFixtureDimpleCut), "%68"));
    // Three rows past the bar; %67 and %68, orphaned BY the bar, are pruned and
    // said so rather than silently dropped.
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::RolledBack), 3);
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::Blocked), 2);
    const std::string active = doc.activeIrProgram();
    CHECK_EQ_INT(lineCount(active), kFixtureStatements - 5);
    CHECK(programIsSelfConsistent(active));
    CHECK(!contains(active, "SPHERE"));

    // The two boundaries: the end, and above the first statement.
    CHECK(doc.setRollbackAfter(PartDocument::kRollbackEnd));
    CHECK_EQ_STR(doc.activeIrProgram(), base.activeIrProgram());
    CHECK(doc.setRollbackAfter(0));
    CHECK_EQ_STR(doc.activeIrProgram(), "");
    CHECK_EQ_INT(countStatus(doc, FeatureStatus::RolledBack), kFixtureStatements);
    CHECK(contains(doc.diagnosticOf(1), "above the first statement"));
    // Only meaningless positions are refused.
    CHECK(!doc.setRollbackAfter(kFixtureStatements + 1));
    CHECK(!doc.setRollbackAfter(-2));
    CHECK_EQ_INT(doc.rollbackAfter(), 0);   // and the refusal changed nothing
    CHECK(doc.setRollbackAfter(kFixtureStatements));
    CHECK_EQ_STR(doc.activeIrProgram(), base.activeIrProgram());

    // The bar is DOCUMENT STATE, not an undoable edit: it changes what is built,
    // not what the document says.
    CHECK_EQ_STR(doc.irProgram(), base.irProgram());
  }

  // ── 5. REORDER ───────────────────────────────────────────────────────────
  // Moving a statement renumbers every statement and rewrites every `%N` so each
  // reference still names the same STATEMENT it named before.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    // Move the locating pin's CYL (%70) up to just after the plate fillet, where
    // it is still legal: it consumes nothing, so it can go anywhere.
    CHECK(doc.moveFeature(70, 4));
    CHECK_EQ_INT(doc.records().size(), kFixtureStatements);
    // NOTHING BROKE. The document still builds, in full, and still emits a
    // self-consistent program.
    CHECK_EQ_INT(doc.errorCount(), 0);
    CHECK_EQ_INT(doc.builtCount(), kFixtureStatements);
    CHECK(programIsSelfConsistent(doc.activeIrProgram()));
    CHECK_EQ_INT(lineCount(doc.activeIrProgram()), kFixtureStatements);
    // The moved row IS at 4, and what was at 4 has slid down by one.
    CHECK_EQ_STR(doc.featureAt(4)->line.text(), "%4 = CYL(5, 30, 30, -20, 0)");
    CHECK_EQ_STR(doc.featureAt(5)->line.text(), "%5 = CIRCLE(26)");
    // THE POINT: the FUSE that consumed it still consumes IT, by its new number.
    CHECK_EQ_STR(doc.featureAt(kFixturePinFuse)->line.text(), "%71 = FUSE(%70, %4)");
    // PERSISTENT NAMES are what survive a renumber -- that is why a record has
    // one. @boss was %6; it is %7 now, and it is still @boss.
    CHECK_EQ_INT(doc.featureNamed("@boss"), kFixtureBossFuse + 1);
    CHECK_EQ_INT(doc.featureNamed("@plate"), 2);       // above the move: unmoved
    CHECK_EQ_INT(doc.featureNamed("@spout"), kFixtureLoft + 1);
    CHECK_EQ_INT(doc.featureNamed("@bracket"), kFixturePinFuse);
    // NODE BINDINGS name values, and a value moved with its statement.
    CHECK_EQ_INT(doc.valueFor(kFixtureBodyNode), kFixturePinFuse);
    CHECK_EQ_INT(doc.valueFor(kFixtureBodyAlias), kFixturePinFuse);
    CHECK_EQ_INT(doc.valueFor("plate"), 2);
    CHECK_EQ_INT(doc.valueFor("spout"), kFixtureLoft + 1);
    // ARG-PARAMETER BINDINGS moved with their record: pad_r still drives four
    // slots and plate_t one, and setting the parameter still reaches all of them.
    CHECK_EQ_INT(doc.drivenArgCount(), 5);
    Parameter wider = *doc.parameter("pad_r");
    wider.value = 10.0;
    CHECK(doc.setParameter(wider));
    CHECK_EQ_STR(doc.featureAt(9)->line.text(), "%9 = CYL(10, 12)");
    // And it is REVERSIBLE, exactly: move it back and the document is the one
    // we started with.
    Parameter narrower = *doc.parameter("pad_r");
    narrower.value = 9.0;
    CHECK(doc.setParameter(narrower));
    CHECK(doc.moveFeature(4, 70));
    CHECK_EQ_STR(doc.irProgram(), base.irProgram());
    CHECK_EQ_INT(doc.featureNamed("@boss"), kFixtureBossFuse);

    // Only the meaningless move is refused: an unknown id, a position outside
    // [1, size], and a no-op (so undo never holds an empty step).
    CHECK(!doc.moveFeature(0, 3));
    CHECK(!doc.moveFeature(kFixtureStatements + 1, 3));
    CHECK(!doc.moveFeature(3, 0));
    CHECK(!doc.moveFeature(3, kFixtureStatements + 1));
    CHECK(!doc.moveFeature(3, 3));
    CHECK_EQ_STR(doc.irProgram(), base.irProgram());
  }

  // ── 6. THE DEPENDENCY EDIT THAT BREAKS THE DOCUMENT ───────────────────────
  // Dragging a fillet above the body it fillets creates a forward reference,
  // which is illegal IR. The modeller PERFORMS IT and makes the consequence
  // diagnosable, because the owner's constraint is REPRESENT / REPAIR /
  // TOLERATE. This is the section the constraint exists for.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    // %7 = FILLET(%6, 3, ALL) dragged above the FUSE it fillets.
    CHECK(doc.moveFeature(kFixtureBossFillet, 5));
    CHECK_EQ_INT(doc.records().size(), kFixtureStatements);   // nothing lost

    // The row that broke says WHY, in validateIr's own words -- which are the
    // kernel's rules transcribed, not a house message.
    CHECK_EQ_STR(toString(doc.statusOf(5)), toString(FeatureStatus::Error));
    CHECK(contains(doc.diagnosticOf(5), "not legal feature-IR"));
    CHECK(contains(doc.diagnosticOf(5), "forward_value_ref"));
    CHECK(contains(doc.diagnosticOf(5), "FILLET"));
    // The statement is still THERE, and still says what the user asked for --
    // rewriting it to something legal would destroy the only evidence of intent.
    CHECK_EQ_STR(doc.featureAt(5)->line.text(), "%5 = FILLET(%7, 3, ALL)");

    // The first row that CONSUMES it is Blocked, and it names the culprit BY
    // NAME -- the L4 @name where there is one, the row's label otherwise. (The
    // rows between are pad blanks, which consume nothing and are fine on their
    // own; they are dropped later, as orphans, with the reason that is true of
    // THEM. Two different failures must not print one message.)
    CHECK_EQ_STR(doc.featureAt(10)->line.text(), "%10 = FUSE(%5, %9)");
    CHECK_EQ_STR(toString(doc.statusOf(10)), toString(FeatureStatus::Blocked));
    CHECK(contains(doc.diagnosticOf(10), "cannot build"));
    CHECK(contains(doc.diagnosticOf(10), "%5"));
    CHECK(contains(doc.diagnosticOf(10), "is in error"));
    CHECK(contains(doc.diagnosticOf(8), "nothing consumes its value"));
    CHECK_EQ_INT(doc.errorCount() > 1, 1);

    // NOTHING BROKEN REACHED THE KERNEL, and what did is a legal program.
    const std::string active = doc.activeIrProgram();
    CHECK(programIsSelfConsistent(active));
    CHECK(!contains(active, "FILLET(%7, 3, ALL)"));
    CHECK(lineCount(active) < static_cast<std::size_t>(kFixtureStatements));
    // and the tree can say exactly what is missing from the program it shows.
    CHECK_EQ_INT(doc.blockedFeatures().size(),
                 kFixtureStatements - lineCount(active));

    // IT IS REPAIRABLE, which is the reason for tolerating it: drag it back.
    CHECK(doc.moveFeature(5, kFixtureBossFillet));
    CHECK_EQ_INT(doc.errorCount(), 0);
    CHECK_EQ_STR(doc.irProgram(), base.irProgram());
    CHECK_EQ_STR(doc.activeIrProgram(), base.activeIrProgram());
  }

  // ── 7. the KERNEL's own message, verbatim ─────────────────────────────────
  // This layer never invents a kernel message: a paraphrase of a compiler error
  // is a second error message that drifts from the first.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    const std::string kernelSaid =
        "op %7 (line 7): FILLET: kernel declined at every distance";
    doc.setVerifierDiagnostic(kFixtureBossFillet, kernelSaid);
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureBossFillet)), toString(FeatureStatus::Error));
    CHECK_EQ_STR(doc.diagnosticOf(kFixtureBossFillet), kernelSaid);   // VERBATIM
    bool fromVerifier = false;
    for (const FeatureDiagnostic& d : doc.diagnostics()) {
      if (d.irId == kFixtureBossFillet) fromVerifier = d.fromVerifier;
    }
    CHECK(fromVerifier);     // and flagged as the kernel's, not ours
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureBossFillet + 1)),
                 toString(FeatureStatus::Blocked));
    // A stale message cannot outlive the build that produced it.
    doc.clearVerifierDiagnostics();
    CHECK_EQ_INT(doc.errorCount(), 0);
    CHECK_EQ_STR(doc.activeIrProgram(), base.activeIrProgram());
  }

  // ── 8. PARAMETERS drive literals; the kernel still gets numbers ───────────
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK_EQ_INT(doc.parameters().size(), 2);
    CHECK_EQ_INT(doc.drivenArgCount(), 5);
    Parameter thicker = *doc.parameter("plate_t");
    thicker.value = 20.0;
    CHECK(doc.setParameter(thicker));
    CHECK_EQ_STR(doc.featureAt(2)->line.text(), "%2 = EXTRUDE(%1, 20)");
    Parameter wider = *doc.parameter("pad_r");
    wider.value = 12.5;
    CHECK(doc.setParameter(wider));
    // ALL FOUR pads move, and nothing else does.
    CHECK_EQ_STR(doc.featureAt(8)->line.text(), "%8 = CYL(12.5, 12)");
    CHECK_EQ_STR(doc.featureAt(11)->line.text(), "%11 = CYL(12.5, 12)");
    CHECK_EQ_STR(doc.featureAt(14)->line.text(), "%14 = CYL(12.5, 12)");
    CHECK_EQ_STR(doc.featureAt(17)->line.text(), "%17 = CYL(12.5, 12)");
    // The emitted IR is still literals -- the grammar has no expressions and
    // this layer may not invent one.
    CHECK(!contains(doc.irProgram(), "plate_t"));
    CHECK(!contains(doc.irProgram(), "pad_r"));
    CHECK_EQ_INT(doc.errorCount(), 0);
    // A name that is not an identifier is refused, and a slot that is a REF or a
    // KEYWORD cannot be parameter-driven: driving either from a double would be
    // a reparent or a nonsense keyword dressed up as a dimension change.
    Parameter bad;
    bad.name = "2r";
    bad.value = 1.0;
    CHECK(!doc.setParameter(bad));
    CHECK(!doc.bindArgToParameter(3, 0, "pad_r"));   // %3 = FILLET(%2, ...) slot 0 is a ref
    CHECK(!doc.bindArgToParameter(3, 2, "pad_r"));   // slot 2 is the VERTICAL keyword
    CHECK(doc.bindArgToParameter(3, 1, "pad_r"));    // slot 1 is the radius
    CHECK_EQ_INT(doc.drivenArgCount(), 6);
    // Deleting a parameter UNBINDS its slots and leaves the literals alone:
    // deleting a parameter is not a request to change the geometry.
    const std::string beforeRemoval = doc.irProgram();
    CHECK(doc.removeParameter("pad_r"));
    CHECK_EQ_STR(doc.irProgram(), beforeRemoval);
    CHECK_EQ_INT(doc.drivenArgCount(), 1);
    CHECK(doc.parameter("pad_r") == nullptr);
  }

  // ── 9. MATERIALS are per BODY, not per feature ────────────────────────────
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    CHECK_EQ_STR(doc.materialOf(kFixtureBodyNode), "AL6061");
    // An assignment naming a material this document does not define is refused:
    // that is how a BOM gets a blank row.
    CHECK(!doc.assignMaterial(kFixtureBodyNode, "TI64"));
    CHECK_EQ_STR(doc.materialOf(kFixtureBodyNode), "AL6061");
    // Removing a material clears every assignment to it, rather than leaving
    // assignments pointing at nothing.
    CHECK(doc.removeMaterial("AL6061"));
    CHECK_EQ_STR(doc.materialOf(kFixtureBodyNode), "");
    CHECK_EQ_STR(doc.materialOf("plate"), "S355");
    CHECK(doc.clearMaterial("plate"));
    CHECK_EQ_STR(doc.materialOf("plate"), "");
  }

  // ── 10. PERSISTENT NAMES are the L4 scheme, not a parallel one ────────────
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{}));
    // Stored WITH the '@', so the string in the document IS the string a kernel
    // TAG(%body, "@name", "sel") selector would use.
    CHECK_EQ_STR(doc.featureAt(kFixturePinFuse)->persistentName, "@bracket");
    // A caller that omits the '@' names the SAME feature, not a second one.
    CHECK(doc.setPersistentName(kFixtureLoft, "nozzle"));
    CHECK_EQ_STR(doc.featureAt(kFixtureLoft)->persistentName, "@nozzle");
    CHECK_EQ_INT(doc.featureNamed("@nozzle"), kFixtureLoft);
    CHECK_EQ_INT(doc.featureNamed("nozzle"), kFixtureLoft);
    // Two features may not share one name: a selector that resolves to two
    // features resolves to neither.
    CHECK(!doc.setPersistentName(kFixtureBossFuse, "@nozzle"));
    CHECK_EQ_STR(doc.featureAt(kFixtureBossFuse)->persistentName, "@boss");
    CHECK_EQ_INT(doc.featureNamed("@nowhere"), 0);
  }

  // ── 11. EVERYTHING AT ONCE, which is the state a real document is in ──────
  // A suppression, a bar, a kernel message and a broken reorder in one document.
  // The interesting property is that each row still reports its OWN reason.
  {
    PartDocument doc;
    CHECK(buildFixture(doc, FixtureOptions{true, true, true}));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureBossFillet)), toString(FeatureStatus::Error));
    CHECK_EQ_STR(toString(doc.statusOf(kFixtureRib1Rotate)),
                 toString(FeatureStatus::Suppressed));
    CHECK_EQ_STR(toString(doc.statusOf(kFixturePinFuse)), toString(FeatureStatus::RolledBack));
    // The verifier message on %7 blocks the chain below it, so what reaches the
    // kernel is the head of the program -- and it is a LEGAL program.
    CHECK(programIsSelfConsistent(doc.activeIrProgram()));
    CHECK_EQ_INT(doc.builtCount() + doc.blockedFeatures().size(), kFixtureStatements);
    // Every non-Ok row has a reason, and every Ok row has none. That biconditional
    // is what makes the tree readable at 71 rows.
    for (int id = 1; id <= kFixtureStatements; ++id) {
      const bool ok = doc.statusOf(id) == FeatureStatus::Ok;
      CHECK_EQ_INT(doc.diagnosticOf(id).empty() ? 1 : 0, ok ? 1 : 0);
    }
  }

  // ── 12. SCALE ─────────────────────────────────────────────────────────────
  // 71 is the fixture; this is 400, because "Archie emits ultra long feature
  // trees" is a requirement and a recompute that is quadratic in a bad way stops
  // being a UI at some length. Asserted on BEHAVIOUR at length, not on a timing.
  {
    PartDocument big;
    PartDocument::BatchEdit hold(big);
    FeatureRecord seedRec;
    seedRec.irId = 1;
    seedRec.label = "Blank";
    seedRec.produces = IrValueKind::Solid;
    seedRec.line = IrLine{1, "BOX", {IrArg::num(40), IrArg::num(30), IrArg::num(20)}};
    CHECK(big.adoptFeature(seedRec, {"body"}));
    for (int i = 2; i <= 400; ++i) {
      FeatureRecord r;
      r.irId = i;
      r.label = "Step";
      r.produces = IrValueKind::Solid;
      r.line = IrLine{i, "TRANSLATE",
                      {IrArg::valueRef(i - 1), IrArg::num(0), IrArg::num(0), IrArg::num(1)}};
      CHECK(big.adoptFeature(r, {}));
    }
    CHECK_EQ_INT(big.records().size(), 400);
  }
  {
    // Outside the BatchEdit so the document has settled.
    PartDocument big;
    {
      PartDocument::BatchEdit hold(big);
      FeatureRecord seedRec;
      seedRec.irId = 1;
      seedRec.label = "Blank";
      seedRec.produces = IrValueKind::Solid;
      seedRec.line = IrLine{1, "BOX", {IrArg::num(40), IrArg::num(30), IrArg::num(20)}};
      big.adoptFeature(seedRec, {"body"});
      for (int i = 2; i <= 400; ++i) {
        FeatureRecord r;
        r.irId = i;
        r.label = "Step";
        r.produces = IrValueKind::Solid;
        r.line = IrLine{i, "TRANSLATE",
                        {IrArg::valueRef(i - 1), IrArg::num(0), IrArg::num(0), IrArg::num(1)}};
        big.adoptFeature(r, {});
      }
    }
    CHECK_EQ_INT(big.builtCount(), 400);
    CHECK_EQ_INT(lineCount(big.activeIrProgram()), 400);
    CHECK(programIsSelfConsistent(big.activeIrProgram()));
    // Suppress the middle two hundred: the pass-through chains through all of
    // them and the other two hundred still build.
    for (int i = 100; i < 300; ++i) CHECK(big.setSuppressed(i, true));
    CHECK_EQ_INT(big.builtCount(), 200);
    CHECK_EQ_INT(lineCount(big.activeIrProgram()), 200);
    CHECK(programIsSelfConsistent(big.activeIrProgram()));
    CHECK(programHas(big.activeIrProgram(), "%100 = TRANSLATE(%99, 0, 0, 1)"));
    // Move the last statement to the front: 400 refs get rewritten, one of them
    // becomes a forward reference, and the document says so per row instead of
    // refusing the drag.
    CHECK(big.moveFeature(400, 1));
    CHECK_EQ_STR(toString(big.statusOf(1)), toString(FeatureStatus::Error));
    CHECK(contains(big.diagnosticOf(1), "forward_value_ref"));
    CHECK(programIsSelfConsistent(big.activeIrProgram()));
    CHECK(big.moveFeature(1, 400));
    for (int i = 100; i < 300; ++i) CHECK(big.setSuppressed(i, false));
    CHECK_EQ_INT(big.builtCount(), 400);
    CHECK_EQ_INT(big.errorCount(), 0);
  }

  std::printf("[feature_tree_history] fixture %d statements, scale case 400\n",
              kFixtureStatements);
  return H.finish();
}
