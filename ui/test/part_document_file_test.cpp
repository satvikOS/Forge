// ui/test/part_document_file_test.cpp
//
// THE SAVE GATE. An app that cannot save is a demo, and a save nobody proved is
// a demo with a file dialog.
//
// PartDocumentFile.hpp already claimed this gate existed by name. It did not:
// before this file, 1,295 lines of writer, reader, capture and restore -- the
// one code path standing between a user and their work -- had ZERO tests in
// forge::ui. Every check below is one of five kinds:
//
//   (a) the VERSION POLICY is enforced as written, in both directions: an older
//       file opens, a newer file is REFUSED BY NAME, and an `X-` line from a
//       version that does not exist yet survives being opened and saved here;
//   (b) the round trip is EXACT on a 71-statement document, field by field --
//       not "it parsed", but every label, node, kind, parameter binding,
//       persistent name, suppression flag and verifier message compared to the
//       one that went in;
//   (c) the round trip is IDEMPOTENT: write(read(write(d))) is byte-identical
//       to write(d), which is what makes a diff of two saves mean something;
//   (d) the reader REFUSES what it cannot represent and does so without half-
//       replacing the caller's document, and TOLERATES what it can, because a
//       document saved broken must reopen in the only program that can fix it;
//   (e) the CODEC is exact on the characters a line-oriented format cannot
//       carry raw -- a newline and a backslash inside a verifier message.
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartDocumentFile.hpp"
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
using forge::uitest::kFixtureDimpleMove;
using forge::uitest::kFixturePad0Cyl;
using forge::uitest::kFixturePinFuse;
using forge::uitest::kFixtureRib1Rotate;
using forge::uitest::kFixtureStatements;

namespace {

// The whole fixture, with every optional piece of history state on: this is the
// document the format has to survive.
const FixtureOptions kFullState{/*suppression=*/true, /*rollback=*/true,
                                /*verifierMessage=*/true};

std::size_t countLines(const std::string& text, const std::string& prefix) {
  std::size_t n = 0;
  std::size_t at = 0;
  while (at <= text.size()) {
    const std::size_t end = text.find('\n', at);
    const std::string line = text.substr(at, (end == std::string::npos ? text.size() : end) - at);
    if (line.compare(0, prefix.size(), prefix) == 0) ++n;
    if (end == std::string::npos) break;
    at = end + 1;
  }
  return n;
}

std::string firstLine(const std::string& text) {
  const std::size_t end = text.find('\n');
  return end == std::string::npos ? text : text.substr(0, end);
}

bool contains(const std::string& haystack, const std::string& needle) {
  return haystack.find(needle) != std::string::npos;
}

// Field-by-field equality of two documents, reported as individual checks so a
// failure names the field rather than saying "the documents differ".
void compareDocuments(Harness& H, const PartDocument& a, const PartDocument& b,
                      const char* what) {
  (void)what;
  CHECK_EQ_STR(b.name(), a.name());
  CHECK_EQ_STR(b.units(), a.units());
  CHECK_EQ_INT(b.rollbackAfter(), a.rollbackAfter());
  CHECK_EQ_INT(b.records().size(), a.records().size());
  CHECK_EQ_INT(b.parameters().size(), a.parameters().size());
  CHECK_EQ_INT(b.materials().size(), a.materials().size());
  CHECK_EQ_INT(b.materialAssignments().size(), a.materialAssignments().size());
  CHECK_EQ_INT(b.bindings().size(), a.bindings().size());
  CHECK_EQ_INT(b.extensions().size(), a.extensions().size());
  CHECK_EQ_INT(b.drivenArgCount(), a.drivenArgCount());

  for (std::size_t i = 0; i < a.parameters().size() && i < b.parameters().size(); ++i) {
    const Parameter& pa = a.parameters()[i];
    const Parameter& pb = b.parameters()[i];
    CHECK_EQ_STR(pb.name, pa.name);
    CHECK_NEAR(pb.value, pa.value, 0.0);
    CHECK_EQ_STR(pb.unit, pa.unit);
    CHECK_EQ_STR(pb.comment, pa.comment);
  }
  for (std::size_t i = 0; i < a.materials().size() && i < b.materials().size(); ++i) {
    const Material& ma = a.materials()[i];
    const Material& mb = b.materials()[i];
    CHECK_EQ_STR(mb.name, ma.name);
    CHECK_NEAR(mb.density, ma.density, 0.0);
    CHECK_EQ_STR(mb.standard, ma.standard);
    CHECK_EQ_STR(mb.appearance, ma.appearance);
  }
  for (const auto& kv : a.materialAssignments()) {
    CHECK_EQ_STR(b.materialOf(kv.first), kv.second);
  }
  for (const auto& kv : a.bindings()) {
    CHECK_EQ_INT(b.valueFor(kv.first), kv.second);
  }
  for (std::size_t i = 0; i < a.extensions().size() && i < b.extensions().size(); ++i) {
    CHECK_EQ_STR(b.extensions()[i], a.extensions()[i]);
  }

  for (std::size_t i = 0; i < a.records().size() && i < b.records().size(); ++i) {
    const FeatureRecord& ra = a.records()[i];
    const FeatureRecord& rb = b.records()[i];
    CHECK_EQ_INT(rb.irId, ra.irId);
    CHECK_EQ_STR(rb.line.text(), ra.line.text());
    CHECK_EQ_STR(rb.commandId, ra.commandId);
    CHECK_EQ_STR(rb.label, ra.label);
    CHECK_EQ_STR(toString(rb.produces), toString(ra.produces));
    CHECK_EQ_STR(rb.persistentName, ra.persistentName);
    CHECK_EQ_INT(rb.suppressed ? 1 : 0, ra.suppressed ? 1 : 0);
    CHECK_EQ_STR(rb.verifierMessage, ra.verifierMessage);
    CHECK_EQ_INT(rb.argParams.size(), ra.argParams.size());
    for (std::size_t j = 0; j < ra.argParams.size() && j < rb.argParams.size(); ++j) {
      CHECK_EQ_INT(rb.argParams[j].argIndex, ra.argParams[j].argIndex);
      CHECK_EQ_STR(rb.argParams[j].parameter, ra.argParams[j].parameter);
    }
  }

  // The DERIVED answers, not just the stored fields: two documents that agree
  // on every field but disagree on what the kernel is asked to build have not
  // round-tripped, they have coincided.
  CHECK_EQ_STR(b.irProgram(), a.irProgram());
  CHECK_EQ_STR(b.activeIrProgram(), a.activeIrProgram());
  CHECK_EQ_INT(b.errorCount(), a.errorCount());
  CHECK_EQ_INT(b.builtCount(), a.builtCount());
  CHECK_EQ_INT(b.blockedFeatures().size(), a.blockedFeatures().size());
  for (int id = 1; id <= static_cast<int>(a.records().size()); ++id) {
    CHECK_EQ_STR(toString(b.statusOf(id)), toString(a.statusOf(id)));
    CHECK_EQ_STR(b.diagnosticOf(id), a.diagnosticOf(id));
  }
}

}  // namespace

int main() {
  Harness H("part_document_file");

  // ── 0. the fixture itself ─────────────────────────────────────────────────
  PartDocument doc;
  CHECK(buildFixture(doc, kFullState));
  CHECK_EQ_INT(doc.records().size(), kFixtureStatements);
  CHECK_EQ_INT(doc.featureCount(), kFixtureStatements);
  // 20 distinct ops across three value kinds, so the KIND field and the
  // num|ref|kw arg codec are exercised by real rows.
  {
    std::vector<std::string> ops;
    for (const FeatureRecord& r : doc.records()) {
      bool seen = false;
      for (const std::string& o : ops) seen = seen || o == r.line.op;
      if (!seen) ops.push_back(r.line.op);
    }
    CHECK_EQ_INT(ops.size(), 20);
  }

  // ── 1. THE VERSION POLICY ─────────────────────────────────────────────────
  const PartFileDoc file = capturePartDocument(doc, "");
  const std::string text = writePartFile(file);

  // WRITES the current version, always. Never an older one.
  CHECK_EQ_STR(firstLine(text), std::string(kPartFileMagic) + " " +
                                    std::to_string(kPartFileVersion));
  CHECK_EQ_INT(partFileVersion(text), kPartFileVersion);
  CHECK_EQ_INT(kPartFileVersion, 2);
  CHECK_EQ_INT(kPartFileMinReadVersion, 1);
  CHECK(kPartFileMinReadVersion <= kPartFileVersion);

  // partFileVersion tells "not ours" (0) from "too new" (a number).
  CHECK_EQ_INT(partFileVersion("solid Bracket\nfacet normal 0 0 1\n"), 0);
  CHECK_EQ_INT(partFileVersion(""), 0);
  CHECK_EQ_INT(partFileVersion("FORGE-PART 9\nNAME x\n"), 9);
  CHECK_EQ_INT(partFileVersion("# a comment first\n\nFORGE-PART 2\n"), 2);

  {
    // READS min..current. A v1 file -- one with none of v2's additions -- opens,
    // and every v2 field defaults to what v1 meant.
    const std::string v1 =
        "FORGE-PART 1\n"
        "NAME Legacy\n"
        "UNITS in\n"
        "FEATURE\nID 1\nKIND profile\nCOMMAND part.sketch.rect\nLABEL Sketch\n"
        "OP RECT\nARG num 40\nARG num 30\nEND\n"
        "FEATURE\nID 2\nKIND solid\nNODE body\nCOMMAND part.extrude\nLABEL Pad\n"
        "OP EXTRUDE\nARG ref 1\nARG num 12\nEND\n";
    PartFileDoc legacy;
    std::string err = "unset";
    CHECK(readPartFile(v1, legacy, err));
    CHECK_EQ_STR(err, "");
    CHECK_EQ_STR(legacy.name, "Legacy");
    CHECK_EQ_STR(legacy.units, "in");
    CHECK_EQ_INT(legacy.features.size(), 2);
    // Every v2 addition defaults to what v1 meant: nothing.
    CHECK_EQ_INT(legacy.rollbackAfter, PartDocument::kRollbackEnd);
    CHECK_EQ_INT(legacy.parameters.size(), 0);
    CHECK_EQ_INT(legacy.materials.size(), 0);
    CHECK_EQ_INT(legacy.materialAssignments.size(), 0);
    CHECK_EQ_INT(legacy.extensions.size(), 0);
    CHECK_EQ_STR(legacy.features[0].record.persistentName, "");
    CHECK_EQ_INT(legacy.features[0].record.suppressed ? 1 : 0, 0);
    CHECK_EQ_INT(legacy.features[1].nodes.size(), 1);
    CHECK_EQ_STR(legacy.features[1].nodes[0], "body");
    CHECK_EQ_STR(legacy.irProgram(), "%1 = RECT(40, 30)\n%2 = EXTRUDE(%1, 12)\n");

    // The document it opens as builds, and the NEXT save writes v2.
    PartDocument upgraded;
    std::string rerr = "unset";
    CHECK(restorePartDocument(legacy, upgraded, rerr));
    CHECK_EQ_STR(rerr, "");
    CHECK_EQ_INT(upgraded.records().size(), 2);
    CHECK_EQ_STR(upgraded.activeIrProgram(), "%1 = RECT(40, 30)\n%2 = EXTRUDE(%1, 12)\n");
    const std::string resaved = writePartFile(capturePartDocument(upgraded, ""));
    CHECK_EQ_STR(firstLine(resaved), "FORGE-PART 2");
  }

  {
    // REFUSES a version above this build's, NAMING BOTH NUMBERS. Refusing
    // without saying what it can read is a dead end for the user.
    PartFileDoc future;
    std::string err;
    CHECK(!readPartFile("FORGE-PART 3\nNAME Tomorrow\n", future, err));
    CHECK(contains(err, "3"));
    CHECK(contains(err, std::to_string(kPartFileVersion)));
    CHECK(contains(err, std::to_string(kPartFileMinReadVersion)));
    CHECK(contains(err, "newer"));
    CHECK(contains(err, "line 1"));
    // `out` is untouched on a refusal: a rejected file never half-replaces a
    // document the user still has open.
    CHECK_EQ_STR(future.name, "untitled");
    CHECK_EQ_INT(future.features.size(), 0);
  }
  {
    PartFileDoc old;
    std::string err;
    CHECK(!readPartFile("FORGE-PART 0\nNAME Before\n", old, err));
    CHECK(contains(err, "predates"));
  }
  {
    PartFileDoc notOurs;
    std::string err;
    CHECK(!readPartFile("solid Bracket\n", notOurs, err));
    CHECK(contains(err, ".fpart"));
    CHECK(!readPartFile("FORGE-PART two\n", notOurs, err));
    CHECK(contains(err, "not an integer"));
    CHECK(!readPartFile("", notOurs, err));
    CHECK(contains(err, "no FORGE-PART header"));
    // A file that ends inside a block is a truncated write, not an empty
    // document: reporting it as "0 features" would lose the user's part
    // silently, which is the worst way to lose it.
    CHECK(!readPartFile("FORGE-PART 2\nFEATURE\nID 1\nOP RECT\n", notOurs, err));
    CHECK(contains(err, "ends inside a block"));
  }
  {
    // An unrecognised key that is NOT `X-` is an error naming its line: a typo
    // silently ignored is a field the user believes they set.
    PartFileDoc bad;
    std::string err;
    CHECK(!readPartFile("FORGE-PART 2\nUNIT mm\n", bad, err));
    CHECK(contains(err, "line 2"));
    CHECK(contains(err, "UNIT"));
    CHECK(!readPartFile("FORGE-PART 2\nPARAM\nPNAME a\nVALU 3\nEND\n", bad, err));
    CHECK(contains(err, "VALU"));
    CHECK(contains(err, "PARAM"));
    CHECK(!readPartFile("FORGE-PART 2\nMATERIAL\nMNAME a\nDENSTY 3\nEND\n", bad, err));
    CHECK(contains(err, "MATERIAL"));
    CHECK(!readPartFile("FORGE-PART 2\nFEATURE\nID 1\nOP RECT\nARGS num 1\nEND\n", bad, err));
    CHECK(contains(err, "FEATURE"));
  }

  // ── 2. `X-` FORWARD COMPATIBILITY, end to end ─────────────────────────────
  // The mechanism that lets version 3 add a field which survives a round trip
  // through a version-2 build. Proved on the path a USER takes -- Open, edit,
  // Save -- not just readPartFile -> writePartFile, because the document is
  // what the next save is built from.
  {
    const std::string fromV3 =
        "FORGE-PART 2\n"
        "NAME Forward\n"
        "UNITS mm\n"
        "X-TOLERANCE-CLASS ISO-2768-mK\n"
        "FEATURE\nID 1\nKIND solid\nNODE b\nOP BOX\nARG num 10\nARG num 10\nARG num 10\n"
        "X-FEATURE-COLOUR #ff8800\n"
        "END\n";
    PartFileDoc parsed;
    std::string err;
    CHECK(readPartFile(fromV3, parsed, err));
    CHECK_EQ_INT(parsed.extensions.size(), 2);
    CHECK_EQ_STR(parsed.extensions[0], "X-TOLERANCE-CLASS ISO-2768-mK");
    CHECK_EQ_STR(parsed.extensions[1], "X-FEATURE-COLOUR #ff8800");

    PartDocument opened;
    std::string rerr;
    CHECK(restorePartDocument(parsed, opened, rerr));
    // THE FIX: the document itself carries them, so the next Save still has
    // them. Before this, capturePartDocument() rebuilt the file from the
    // document and both lines were deleted by opening and saving.
    CHECK_EQ_INT(opened.extensions().size(), 2);
    CHECK_EQ_STR(opened.extensions()[0], "X-TOLERANCE-CLASS ISO-2768-mK");
    CHECK_EQ_STR(opened.extensions()[1], "X-FEATURE-COLOUR #ff8800");

    // Now EDIT it, the way a user would, and save.
    CHECK(opened.setUnits("cm"));
    const std::string resaved = writePartFile(capturePartDocument(opened, ""));
    CHECK_EQ_INT(countLines(resaved, "X-TOLERANCE-CLASS"), 1);
    CHECK_EQ_INT(countLines(resaved, "X-FEATURE-COLOUR"), 1);
    CHECK(contains(resaved, "X-TOLERANCE-CLASS ISO-2768-mK"));
    CHECK(contains(resaved, "X-FEATURE-COLOUR #ff8800"));
    CHECK(contains(resaved, "UNITS cm"));
    // And once more, so a second save cannot duplicate or drop them.
    PartFileDoc again;
    std::string aerr;
    CHECK(readPartFile(resaved, again, aerr));
    CHECK_EQ_INT(again.extensions.size(), 2);
    CHECK_EQ_STR(writePartFile(again), resaved);
  }

  // ── 3. THE ROUND TRIP, on the 71-statement document ───────────────────────
  {
    PartFileDoc reread;
    std::string err = "unset";
    CHECK(readPartFile(text, reread, err));
    CHECK_EQ_STR(err, "");
    CHECK_EQ_INT(reread.features.size(), kFixtureStatements);

    // (c) IDEMPOTENT: write(read(write(d))) is byte-identical to write(d).
    CHECK_EQ_STR(writePartFile(reread), text);

    // (b) EXACT, field by field, through the document the app actually holds.
    PartDocument back;
    std::string rerr = "unset";
    CHECK(restorePartDocument(reread, back, rerr));
    CHECK_EQ_STR(rerr, "");
    compareDocuments(H, doc, back, "save -> load");

    // A THIRD cycle, because a format that is stable on the first round trip
    // and drifts on the second is a format that drifts.
    const std::string text2 = writePartFile(capturePartDocument(back, ""));
    CHECK_EQ_STR(text2, text);
    PartFileDoc third;
    std::string terr;
    CHECK(readPartFile(text2, third, terr));
    PartDocument back2;
    CHECK(restorePartDocument(third, back2, terr));
    compareDocuments(H, doc, back2, "save -> load -> save -> load");
  }

  // ── 4. the fields that only exist because this is a DOCUMENT ──────────────
  {
    PartFileDoc reread;
    std::string err;
    CHECK(readPartFile(text, reread, err));
    PartDocument back;
    CHECK(restorePartDocument(reread, back, err));

    // MANY-TO-ONE NODE BINDINGS. Two selections naming one value came back as
    // one in v1; the file has a repeatable NODE line so it can say so.
    CHECK_EQ_INT(back.valueFor(kFixtureBodyNode), kFixturePinFuse);
    CHECK_EQ_INT(back.valueFor(kFixtureBodyAlias), kFixturePinFuse);
    CHECK_EQ_INT(countLines(text, "NODE bracket"), 2);

    // L4 PERSISTENT NAMES, stored with the '@' a kernel TAG selector uses, so
    // the string in the document IS the string a selector would use.
    CHECK_EQ_INT(back.featureNamed("@bracket"), kFixturePinFuse);
    CHECK_EQ_INT(back.featureNamed("@plate"), 2);
    CHECK_EQ_INT(back.featureNamed("@boss"), 6);
    CHECK_EQ_INT(back.featureNamed("@spout"), 39);
    CHECK(contains(text, "TAG @bracket"));

    // PARAMETERS and their argument-slot bindings.
    CHECK(back.parameter("plate_t") != nullptr);
    CHECK(back.parameter("pad_r") != nullptr);
    CHECK_NEAR(back.parameter("plate_t")->value, 14.0, 0.0);
    CHECK_EQ_STR(back.parameter("plate_t")->comment, "plate thickness -- drives the extrude");
    CHECK_EQ_INT(back.drivenArgCount(), 5);
    CHECK_EQ_INT(countLines(text, "ARGPARAM 0 pad_r"), 4);
    CHECK_EQ_INT(countLines(text, "ARGPARAM 1 plate_t"), 1);
    // And the binding is LIVE after the load: changing the parameter still
    // rewrites every slot it drives, which is the only thing that makes a
    // restored binding worth storing.
    Parameter widened = *back.parameter("pad_r");
    widened.value = 11.0;
    CHECK(back.setParameter(widened));
    CHECK_EQ_STR(back.featureAt(kFixturePad0Cyl)->line.text(), "%8 = CYL(11, 12)");
    CHECK_EQ_STR(back.featureAt(kFixturePad0Cyl + 3)->line.text(), "%11 = CYL(11, 12)");
    CHECK_EQ_STR(back.featureAt(kFixturePad0Cyl + 9)->line.text(), "%17 = CYL(11, 12)");

    // MATERIALS, per document, assigned per body NODE.
    CHECK_EQ_INT(back.materials().size(), 2);
    CHECK(back.material("AL6061") != nullptr);
    CHECK_NEAR(back.material("AL6061")->density, 2700.0, 0.0);
    CHECK_EQ_STR(back.material("AL6061")->standard, "ASTM B209");
    CHECK_EQ_STR(back.materialOf(kFixtureBodyNode), "AL6061");
    CHECK_EQ_STR(back.materialOf("plate"), "S355");
    CHECK_EQ_STR(back.materialOf("nobody"), "");

    // SUPPRESSION and the ROLLBACK BAR.
    CHECK(back.featureAt(kFixtureRib1Rotate)->suppressed);
    CHECK_EQ_INT(back.rollbackAfter(), kFixtureDimpleMove);
    CHECK_EQ_INT(countLines(text, "SUPPRESSED"), 1);
    CHECK_EQ_INT(countLines(text, "ROLLBACK "), 1);

    // (e) THE VERIFIER MESSAGE, with the two characters the format cannot carry
    // raw. It is stored deliberately: a document saved broken must reopen
    // broken, or the user loses the only account of what went wrong.
    const std::string kept = back.featureAt(kFixtureBossFillet)->verifierMessage;
    CHECK_EQ_STR(kept, doc.featureAt(kFixtureBossFillet)->verifierMessage);
    CHECK(contains(kept, "\n"));
    CHECK(contains(kept, "\\ gave up"));
    CHECK_EQ_INT(countLines(text, "DIAG "), 1);        // ONE line, not two
    CHECK_EQ_INT(countLines(text, "  tried r=3"), 0);  // and not a line of its own
    CHECK(contains(text, "distance\\n  tried r=3"));   // the newline really is escaped
    CHECK(contains(text, "1.6875 \\\\ gave up"));       // and so is the backslash
    CHECK_EQ_STR(toString(back.statusOf(kFixtureBossFillet)), toString(FeatureStatus::Error));
  }

  // ── 5. a rollback bar of ZERO, the boundary v1 could not express ──────────
  // kRollbackEnd is -1 and 0 means "above the first statement -- build nothing".
  // A writer that omitted a falsy bar would turn "build nothing" into "build
  // everything" on the next open.
  {
    PartDocument none;
    CHECK(buildFixture(none, FixtureOptions{}));
    CHECK(none.setRollbackAfter(0));
    CHECK_EQ_STR(none.activeIrProgram(), "");
    const std::string zeroText = writePartFile(capturePartDocument(none, ""));
    CHECK_EQ_INT(countLines(zeroText, "ROLLBACK 0"), 1);
    PartFileDoc z;
    std::string err;
    CHECK(readPartFile(zeroText, z, err));
    CHECK_EQ_INT(z.rollbackAfter, 0);
    PartDocument zback;
    CHECK(restorePartDocument(z, zback, err));
    CHECK_EQ_INT(zback.rollbackAfter(), 0);
    CHECK_EQ_STR(zback.activeIrProgram(), "");
  }

  // ── 6. TOLERANT LOAD ──────────────────────────────────────────────────────
  // A document saved with a dangling reference REOPENS, in the only program
  // that can repair it, with the damage visible per feature. The owner's
  // constraint is REPRESENT / REPAIR / TOLERATE, never refuse.
  {
    const std::string damaged =
        "FORGE-PART 2\n"
        "NAME Damaged\n"
        "UNITS mm\n"
        "FEATURE\nID 1\nKIND solid\nOP BOX\nARG num 40\nARG num 30\nARG num 20\nEND\n"
        "FEATURE\nID 2\nKIND solid\nOP FILLET\nARG ref 9\nARG num 2\nEND\n"
        "FEATURE\nID 3\nKIND solid\nNODE b\nOP SHELL\nARG ref 2\nARG num 1.5\nEND\n";
    PartFileDoc d;
    std::string err = "unset";
    CHECK(readPartFile(damaged, d, err));
    CHECK_EQ_STR(err, "");
    PartDocument opened;
    std::string rerr = "unset";
    CHECK(restorePartDocument(d, opened, rerr));
    CHECK_EQ_STR(rerr, "");
    CHECK_EQ_INT(opened.records().size(), 3);
    // %2 names a statement that does not exist -> Error, with validateIr's own
    // reason. %3 is well-formed and Blocked, with the CULPRIT NAMED.
    CHECK_EQ_STR(toString(opened.statusOf(1)), toString(FeatureStatus::Ok));
    CHECK_EQ_STR(toString(opened.statusOf(2)), toString(FeatureStatus::Error));
    CHECK_EQ_STR(toString(opened.statusOf(3)), toString(FeatureStatus::Blocked));
    CHECK(contains(opened.diagnosticOf(2), "forward_value_ref"));
    CHECK(contains(opened.diagnosticOf(3), "%2"));
    CHECK(contains(opened.diagnosticOf(3), "in error"));
    // Nothing broken reaches the kernel.
    CHECK_EQ_STR(opened.activeIrProgram(), "%1 = BOX(40, 30, 20)\n");
    CHECK_EQ_INT(opened.blockedFeatures().size(), 2);
    // errorCount() is Error PLUS Blocked -- a row that cannot build counts,
    // whether the fault is its own or its input's.
    CHECK_EQ_INT(opened.errorCount(), 2);
    CHECK_EQ_INT(opened.builtCount(), 1);
    // And it SAVES again, damage intact, so the repair can happen tomorrow.
    const std::string resaved = writePartFile(capturePartDocument(opened, ""));
    CHECK(contains(resaved, "ARG ref 9"));
    PartFileDoc again;
    CHECK(readPartFile(resaved, again, err));
    CHECK_EQ_STR(writePartFile(again), resaved);
  }

  // ── 7. the ONE structural refusal, and it leaves the document alone ───────
  // Ids are POSITIONS. A file whose statements arrive out of creation order does
  // not describe the program its own `%N`s spell; there is nothing left to
  // represent, so this is a refusal rather than a diagnostic.
  {
    const std::string scrambled =
        "FORGE-PART 2\nNAME Scrambled\n"
        "FEATURE\nID 1\nKIND solid\nOP BOX\nARG num 10\nARG num 10\nARG num 10\nEND\n"
        "FEATURE\nID 7\nKIND solid\nOP FILLET\nARG ref 1\nARG num 1\nEND\n";
    PartFileDoc d;
    std::string err;
    CHECK(readPartFile(scrambled, d, err));  // the FILE parses -- it is well-formed
    PartDocument target;
    std::string rerr;
    CHECK(!restorePartDocument(d, target, rerr));
    CHECK(contains(rerr, "%7"));
    CHECK(contains(rerr, "%2"));             // and what it expected instead
    CHECK(contains(rerr, "creation order"));
    // It appended what it COULD before it stopped, which is why a host must
    // restore into a CANDIDATE document and swap only on success -- which is
    // what ForgeFrame::openDocument does. The refusal is reported honestly; the
    // caller's own open document is the caller's to protect.
    CHECK_EQ_INT(target.records().size(), 1);

    // The same refusal at the FIRST statement, which is what restoring into a
    // document that already has statements looks like.
    PartDocument occupied;
    CHECK(buildFixtureProgram(occupied));
    const std::string beforeIr = occupied.irProgram();
    CHECK(!restorePartDocument(d, occupied, rerr));
    CHECK(contains(rerr, "%1"));
    CHECK_EQ_STR(occupied.irProgram(), beforeIr);
  }

  // ── 8. disk ───────────────────────────────────────────────────────────────
  {
    std::string err = "unset";
    CHECK(!savePartFile("", file, err));
    CHECK_EQ_STR(err, "no path");
    PartFileDoc sink;
    CHECK(!loadPartFile("", sink, err));
    CHECK_EQ_STR(err, "no path");
    CHECK(!loadPartFile("/nonexistent/forge/does-not-exist.fpart", sink, err));
    CHECK(contains(err, "cannot open"));
  }

  std::printf("[part_document_file] %d statements, %zu-byte document, format v%d (reads v%d..v%d)\n",
              kFixtureStatements, text.size(), kPartFileVersion, kPartFileMinReadVersion,
              kPartFileVersion);
  return H.finish();
}
