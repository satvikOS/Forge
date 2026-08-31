// ui/test/part_inventory_test.cpp — the measured inventory, and the grounding.
//
// The claim under test is not "a JSON parser works". It is that the CoPilot can
// answer the OWNER'S OWN QUESTION — "shrink the diameter of the largest bore by
// 5 mm" — from MEASUREMENTS rather than from the sentence, at the scale the
// ground-truth records actually use:
//
//   1. A 430-FACE CENSUS PARSES. The fixture is built to the ground-truth face
//      mix (cylinder 167, torus 125, bspline 67, sphere 25, cone 4, plane 42),
//      not to a demo cube, because "it parsed" on six faces says nothing about
//      the parts this app exists for.
//   2. "LARGEST" IS A MEASUREMENT. Ranking is on the bore's pilot radius, is
//      total (ties keep census order), and is reproducible.
//   3. A CENSUS THAT CONTRADICTS ITSELF IS REFUSED. faceCount that disagrees
//      with the face array, a non-finite number, unbounded nesting.
//   4. A BORE IS TRACED TO THE STATEMENT THAT MADE IT, with the residual it
//      accepted, and an unmatched bore comes back with candidates and a reason
//      instead of a refusal.
//   5. THE EDIT IS DERIVED, NOT GUESSED. part.edit_feature's `feature` and
//      `index` come out of the document, and `value` out of the measurement.
#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartInventory.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string num(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.6g", v);
  return std::string(buf);
}

// ── the fixture: a ground-truth-shaped census ───────────────────────────────
// 430 faces in the mix the retained edit records carry, plus three bores. Built
// programmatically so the face array and the stated faceCount cannot drift apart
// by a typo, which is exactly the contradiction check 3 exists to catch.
struct CensusBuilder {
  std::string faces;
  std::size_t count = 0;

  void add(const std::string& kind, double area, double cx, double cy, double cz, double radius,
           bool hasRadius, bool concave) {
    if (count != 0) faces += ",";
    faces += "{\"kind\":\"" + kind + "\",\"area\":" + num(area) + ",\"centroid\":[" + num(cx) +
             "," + num(cy) + "," + num(cz) + "]";
    if (hasRadius) faces += ",\"radius\":" + num(radius);
    if (kind == "cylinder" || kind == "cone" || kind == "torus") {
      faces += ",\"axis\":[0,0,1],\"axisAt\":[" + num(cx) + "," + num(cy) + ",0]";
    }
    if (kind == "plane") faces += ",\"normal\":[0,0,1]";
    faces += ",\"concave\":";
    faces += concave ? "true" : "false";
    faces += ",\"index\":" + std::to_string(count) + "}";
    ++count;
  }

  void fill(const std::string& kind, std::size_t n, bool hasRadius) {
    for (std::size_t k = 0; k < n; ++k) {
      add(kind, 10.0 + static_cast<double>(k), static_cast<double>(k), 0.0, 0.0,
          1.0 + static_cast<double>(k) * 0.5, hasRadius, false);
    }
  }
};

std::string groundTruthCensus() {
  CensusBuilder b;
  b.fill("bspline", 67, false);
  b.fill("cone", 4, true);
  b.fill("cylinder", 167, true);
  b.fill("plane", 42, false);
  b.fill("sphere", 25, true);
  b.fill("torus", 125, true);
  // Three bores on distinct axes: ⌀12 the widest, ⌀6 the narrowest, ⌀8 the
  // deepest. Deliberately NOT sorted, so a ranking that returns census order
  // would fail rather than accidentally pass.
  const std::string bores =
      "\"bores\":["
      "{\"cx\":0,\"cy\":0,\"r\":4,\"span\":18,\"at\":[0,0,0],\"axis\":[0,0,1],\"faces\":1},"
      "{\"cx\":30,\"cy\":0,\"r\":6,\"span\":12,\"at\":[30,0,0],\"axis\":[0,0,1],\"faces\":2},"
      "{\"cx\":-30,\"cy\":0,\"r\":3,\"span\":40,\"at\":[-30,0,0],\"axis\":[0,0,1],"
      "\"faces\":1}]";
  return "{\"id\":\"fx\",\"ok\":true,\"volume\":123.5,\"faceCount\":" + std::to_string(b.count) +
         "," + bores + ",\"census\":{\"faceCount\":" + std::to_string(b.count) +
         ",\"kind_histogram\":{\"bspline\":67,\"cone\":4,\"cylinder\":167,\"plane\":42,"
         "\"sphere\":25,\"torus\":125},\"bbox\":{\"min\":[-50,-50,0],\"max\":[50,50,40]},"
         "\"faces\":[" +
         b.faces + "]}}";
}

// ── 1. a 430-face census parses, in the ground-truth mix ────────────────────
int testCensus() {
  Harness H("part_inventory:census");

  PartInventory inv;
  std::string why;
  CHECK(PartInventory::parseVerifyJson(groundTruthCensus(), inv, why));
  CHECK_EQ_STR(why, "");
  CHECK(inv.measured);
  CHECK_EQ_INT(inv.faceCount, 430);
  CHECK_EQ_INT(inv.faces.size(), 430);
  CHECK_EQ_INT(inv.kindCount("cylinder"), 167);
  CHECK_EQ_INT(inv.kindCount("torus"), 125);
  CHECK_EQ_INT(inv.kindCount("bspline"), 67);
  CHECK_EQ_INT(inv.kindCount("sphere"), 25);
  CHECK_EQ_INT(inv.kindCount("cone"), 4);
  CHECK_EQ_INT(inv.kindCount("plane"), 42);
  CHECK_EQ_INT(inv.kindCount("nurbs"), 0);
  CHECK(inv.hasBbox);
  CHECK_NEAR(inv.bboxMin[0], -50.0, 1e-9);
  CHECK_NEAR(inv.bboxMax[2], 40.0, 1e-9);
  CHECK_EQ_INT(inv.bores.size(), 3);
  CHECK_EQ_STR(inv.source, "forge_verify census=full");

  // Every kind in the histogram is the count of records of that kind: the header
  // and the body agree, which is the property the mismatch check enforces.
  long fromRecords = 0;
  for (const FaceRecord& f : inv.faces) {
    if (f.kind == "cylinder") ++fromRecords;
  }
  CHECK_EQ_INT(fromRecords, 167);

  // Faces carry what the schema says they carry.
  bool sawRadius = false;
  bool sawAxis = false;
  bool sawPlaneNormal = false;
  for (const FaceRecord& f : inv.faces) {
    if (f.kind == "cylinder" && f.hasRadius) sawRadius = true;
    if (f.kind == "cylinder" && f.hasAxis) sawAxis = true;
    if (f.kind == "plane" && f.hasAxis) sawPlaneNormal = true;
  }
  CHECK(sawRadius);
  CHECK(sawAxis);
  CHECK(sawPlaneNormal);

  const std::string summary = inv.summary();
  CHECK(summary.find("430 faces") != std::string::npos);
  CHECK(summary.find("cylinder 167") != std::string::npos);
  CHECK(summary.find("3 bores") != std::string::npos);

  const std::string block = inv.contextBlock();
  CHECK(block.find("MEASURED PART INVENTORY") != std::string::npos);
  CHECK(block.find("[largest]") != std::string::npos);
  CHECK(block.find("bores: 3") != std::string::npos);
  // The context a planner is handed states the bbox it was measured over.
  CHECK(block.find("bbox:") != std::string::npos);

  // An UNMEASURED inventory says so rather than answering as an empty part.
  PartInventory blank;
  CHECK(!blank.measured);
  CHECK(blank.bore(BoreRank::Largest) == nullptr);
  CHECK(blank.summary().find("no measured census") != std::string::npos);
  CHECK(blank.contextBlock().find("none") != std::string::npos);

  return H.finish();
}

// ── 2. "largest" is a measurement, and the ranking is total ─────────────────
int testRanking() {
  Harness H("part_inventory:ranking");

  PartInventory inv;
  std::string why;
  CHECK(PartInventory::parseVerifyJson(groundTruthCensus(), inv, why));

  const BoreRecord* largest = inv.bore(BoreRank::Largest);
  const BoreRecord* smallest = inv.bore(BoreRank::Smallest);
  const BoreRecord* deepest = inv.bore(BoreRank::Deepest);
  CHECK(largest != nullptr);
  CHECK(smallest != nullptr);
  CHECK(deepest != nullptr);
  if (largest != nullptr) {
    CHECK_NEAR(largest->radius, 6.0, 1e-9);
    CHECK_NEAR(largest->diameter(), 12.0, 1e-9);
    CHECK_NEAR(largest->centre[0], 30.0, 1e-9);
    // The widest bore is the SECOND in census order: a ranking that returned
    // census order would have failed here.
    CHECK(largest->display().find("⌀12.000") != std::string::npos);
    CHECK(largest->display().find("along +Z") != std::string::npos);
  }
  if (smallest != nullptr) CHECK_NEAR(smallest->radius, 3.0, 1e-9);
  // Deepest is the ⌀6 bore (span 40), which is neither the widest nor the first.
  if (deepest != nullptr) CHECK_NEAR(deepest->span, 40.0, 1e-9);

  // Ordinal ranking is census order, 1-based, and out of range is nullptr rather
  // than a clamped neighbour.
  const BoreRecord* first = inv.bore(BoreRank::Ordinal, 1);
  CHECK(first != nullptr);
  if (first != nullptr) CHECK_NEAR(first->radius, 4.0, 1e-9);
  CHECK(inv.bore(BoreRank::Ordinal, 4) == nullptr);
  CHECK(inv.bore(BoreRank::Ordinal, 0) == nullptr);

  // TOTAL ORDER. Two bores of equal radius keep census order, so the same
  // question ranks the same way twice.
  const std::string tied =
      "{\"bores\":[{\"r\":5,\"span\":10,\"at\":[0,0,0],\"axis\":[0,0,1],\"faces\":1},"
      "{\"r\":5,\"span\":10,\"at\":[9,0,0],\"axis\":[0,0,1],\"faces\":1}],"
      "\"census\":{\"faceCount\":0,\"kind_histogram\":{}}}";
  PartInventory tie;
  CHECK(PartInventory::parseVerifyJson(tied, tie, why));
  const std::vector<std::size_t> a = tie.boresRanked(BoreRank::Largest);
  const std::vector<std::size_t> b = tie.boresRanked(BoreRank::Largest);
  CHECK_EQ_INT(a.size(), 2);
  CHECK(a == b);
  if (a.size() == 2) CHECK_EQ_INT(a[0], 0);

  CHECK_EQ_STR(toString(BoreRank::Largest), "largest");
  CHECK_EQ_STR(toString(BoreRank::Deepest), "deepest");
  return H.finish();
}

// ── 3. a census that contradicts itself is refused, by name ─────────────────
int testRefusals() {
  Harness H("part_inventory:refusals");

  PartInventory inv;
  std::string why;

  CHECK(!PartInventory::parseVerifyJson("", inv, why));
  CHECK(!why.empty());

  CHECK(!PartInventory::parseVerifyJson("{\"ok\":true}", inv, why));
  CHECK(why.find("census") != std::string::npos);

  // faceCount says 3, the array holds 2.
  const std::string mismatch =
      "{\"census\":{\"faceCount\":3,\"faces\":["
      "{\"kind\":\"plane\",\"area\":1,\"centroid\":[0,0,0],\"concave\":false,\"index\":0},"
      "{\"kind\":\"plane\",\"area\":1,\"centroid\":[0,0,1],\"concave\":false,\"index\":1}]}}";
  CHECK(!PartInventory::parseVerifyJson(mismatch, inv, why));
  CHECK(why.find("faceCount 3") != std::string::npos);

  // A non-finite number is a broken measurement, not a face at nan.
  CHECK(!PartInventory::parseVerifyJson("{\"census\":{\"faceCount\":nan}}", inv, why));
  CHECK(!why.empty());

  // Unbounded nesting fails the parse rather than the stack.
  std::string deep = "{\"census\":{\"faceCount\":0,\"x\":";
  for (int k = 0; k < 200; ++k) deep += "[";
  for (int k = 0; k < 200; ++k) deep += "]";
  deep += "}}";
  CHECK(!PartInventory::parseVerifyJson(deep, inv, why));
  CHECK(why.find("nesting") != std::string::npos);

  // A truncated object is refused, not half-read.
  CHECK(!PartInventory::parseVerifyJson("{\"census\":{\"faceCount\":1", inv, why));
  CHECK(!why.empty());

  // A REFUSED parse leaves the caller's inventory untouched: the census that was
  // good a moment ago is not replaced by an empty one.
  PartInventory good;
  CHECK(PartInventory::parseVerifyJson(groundTruthCensus(), good, why));
  CHECK_EQ_INT(good.faceCount, 430);
  CHECK(!PartInventory::parseVerifyJson("{}", good, why));
  CHECK_EQ_INT(good.faceCount, 430);

  // A bores-only response is a legal, weaker measurement and says so.
  PartInventory boresOnly;
  CHECK(PartInventory::parseVerifyJson(
      "{\"bores\":[{\"r\":2,\"span\":5,\"at\":[0,0,0],\"axis\":[0,0,1],\"faces\":1}]}", boresOnly,
      why));
  CHECK(boresOnly.measured);
  CHECK_EQ_INT(boresOnly.bores.size(), 1);
  CHECK_EQ_STR(boresOnly.source, "forge_verify bores");

  // The older cx/cy form is honoured rather than dropped, and nothing that was
  // not measured is invented: z stays 0.
  PartInventory legacy;
  CHECK(PartInventory::parseVerifyJson("{\"bores\":[{\"cx\":7,\"cy\":8,\"r\":1,\"span\":2}]}",
                                       legacy, why));
  CHECK_EQ_INT(legacy.bores.size(), 1);
  if (legacy.bores.size() == 1) {
    CHECK_NEAR(legacy.bores[0].centre[0], 7.0, 1e-9);
    CHECK_NEAR(legacy.bores[0].centre[1], 8.0, 1e-9);
    CHECK_NEAR(legacy.bores[0].centre[2], 0.0, 1e-9);
    CHECK_NEAR(legacy.bores[0].axis[2], 1.0, 1e-9);
  }
  return H.finish();
}

// ── the document under test ─────────────────────────────────────────────────
// A plate with three holes, seeded exactly as the app seeds its starting part.
struct Doc {
  PartDocument doc;

  Doc() {
    doc.seed(IrValueKind::Profile, "sketch.base", "RECT", {IrArg::num(120.0), IrArg::num(60.0)});
    doc.seed(IrValueKind::Solid, "body.plate", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(40.0)});
    // %3 ⌀8 at (0,0,0) — the census's first bore
    doc.seed(IrValueKind::Solid, "body.h1", "HOLE",
             {IrArg::valueRef(2), IrArg::num(8.0), IrArg::num(0.0), IrArg::num(0.0),
              IrArg::num(0.0)});
    // %4 ⌀12 at (30,0,0) — the LARGEST
    doc.seed(IrValueKind::Solid, "body.h2", "HOLE",
             {IrArg::valueRef(3), IrArg::num(12.0), IrArg::num(30.0), IrArg::num(0.0),
              IrArg::num(0.0)});
    // %5 ⌀6 at (-30,0,0) — the smallest, and the deepest
    doc.seed(IrValueKind::Solid, "body.h3", "HOLE",
             {IrArg::valueRef(4), IrArg::num(6.0), IrArg::num(-30.0), IrArg::num(0.0),
              IrArg::num(0.0)});
  }
};

// ── 4. a bore is traced to the statement that made it ───────────────────────
int testMatching() {
  Harness H("part_inventory:matching");

  Doc fx;
  PartInventory inv;
  std::string why;
  CHECK(PartInventory::parseVerifyJson(groundTruthCensus(), inv, why));

  const BoreRecord* largest = inv.bore(BoreRank::Largest);
  CHECK(largest != nullptr);
  if (largest == nullptr) return H.finish();

  const BoreFeatureMatch match = matchBoreToFeature(*largest, fx.doc);
  CHECK(match.matched);
  CHECK_EQ_INT(match.irId, 4);
  CHECK_EQ_STR(match.op, "HOLE");
  // part.edit_feature's `index` counts NUMBER arguments only, so the diameter of
  // HOLE(%3, 12, 30, 0, 0) is index 0, not argument 1.
  CHECK_EQ_INT(match.numericIndex, 0);
  CHECK_NEAR(match.currentDiameter, 12.0, 1e-9);
  CHECK_NEAR(match.diameterError, 0.0, 1e-9);
  CHECK_NEAR(match.centreDistance, 0.0, 1e-9);
  // Every HOLE is a candidate; the match is the one that agrees on BOTH facts.
  CHECK_EQ_INT(match.candidates.size(), 3);
  CHECK(match.display().find("%4") != std::string::npos);

  const BoreRecord* smallest = inv.bore(BoreRank::Smallest);
  CHECK(smallest != nullptr);
  if (smallest != nullptr) {
    const BoreFeatureMatch m = matchBoreToFeature(*smallest, fx.doc);
    CHECK(m.matched);
    CHECK_EQ_INT(m.irId, 5);
  }

  // A DIAMETER THAT NOTHING STATES: reported with the nearest residual, not a
  // silent wrong match.
  BoreRecord ghost;
  ghost.radius = 20.0;
  ghost.centre[0] = 0.0;
  ghost.axis[2] = 1.0;
  const BoreFeatureMatch none = matchBoreToFeature(ghost, fx.doc);
  CHECK(!none.matched);
  CHECK(none.why.find("nearest is off by") != std::string::npos);
  CHECK_EQ_INT(none.candidates.size(), 3);

  // THE RIGHT DIAMETER AT THE WRONG PLACE. ⌀12 exists, but not on this axis.
  BoreRecord misplaced;
  misplaced.radius = 6.0;
  misplaced.centre[0] = -99.0;
  misplaced.axis[2] = 1.0;
  const BoreFeatureMatch off = matchBoreToFeature(misplaced, fx.doc);
  CHECK(!off.matched);
  CHECK(off.why.find("off this bore's axis") != std::string::npos);

  // AMBIGUITY IS REPORTED, NOT REFUSED: two identical holes on one axis still
  // match, deterministically, with the ambiguity named for the panel to show.
  PartDocument twin;
  twin.seed(IrValueKind::Profile, "s", "RECT", {IrArg::num(10.0), IrArg::num(10.0)});
  twin.seed(IrValueKind::Solid, "b", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(5.0)});
  twin.seed(IrValueKind::Solid, "h1", "HOLE",
            {IrArg::valueRef(2), IrArg::num(4.0), IrArg::num(0.0), IrArg::num(0.0),
             IrArg::num(0.0)});
  twin.seed(IrValueKind::Solid, "h2", "HOLE",
            {IrArg::valueRef(3), IrArg::num(4.0), IrArg::num(0.0), IrArg::num(0.0),
             IrArg::num(0.0)});
  BoreRecord shared;
  shared.radius = 2.0;
  shared.axis[2] = 1.0;
  const BoreFeatureMatch amb = matchBoreToFeature(shared, twin);
  CHECK(amb.matched);
  CHECK_EQ_INT(amb.irId, 3);  // the lowest statement id, deterministically
  CHECK(amb.why.find("ambiguous") != std::string::npos);

  // A document with no hole at all names that, rather than an empty match.
  PartDocument plain;
  plain.seed(IrValueKind::Profile, "s", "RECT", {IrArg::num(10.0), IrArg::num(10.0)});
  const BoreFeatureMatch bare = matchBoreToFeature(shared, plain);
  CHECK(!bare.matched);
  CHECK(bare.why.find("no HOLE or CBORE") != std::string::npos);

  // A CBORE states its centre three arguments later than a HOLE does; read at a
  // HOLE's offset it would match the wrong numbers.
  PartDocument cb;
  cb.seed(IrValueKind::Profile, "s", "RECT", {IrArg::num(10.0), IrArg::num(10.0)});
  cb.seed(IrValueKind::Solid, "b", "EXTRUDE", {IrArg::valueRef(1), IrArg::num(5.0)});
  cb.seed(IrValueKind::Solid, "c", "CBORE",
          {IrArg::valueRef(2), IrArg::num(6.0), IrArg::num(11.0), IrArg::num(3.0),
           IrArg::num(25.0), IrArg::num(0.0), IrArg::num(0.0)});
  BoreRecord cbBore;
  cbBore.radius = 3.0;
  cbBore.centre[0] = 25.0;
  cbBore.axis[2] = 1.0;
  const BoreFeatureMatch cbMatch = matchBoreToFeature(cbBore, cb);
  CHECK(cbMatch.matched);
  CHECK_EQ_STR(cbMatch.op, "CBORE");
  CHECK_EQ_INT(cbMatch.irId, 3);
  CHECK_EQ_INT(cbMatch.numericIndex, 0);
  return H.finish();
}

// ── 5. the edit is derived, and the phrase is parsed ────────────────────────
int testGroundedEdit() {
  Harness H("part_inventory:grounded-edit");

  Doc fx;
  PartInventory inv;
  std::string why;
  CHECK(PartInventory::parseVerifyJson(groundTruthCensus(), inv, why));

  // THE OWNER'S SENTENCE.
  const BoreEditPhrase phrase = parseBoreEditPhrase("shrink the diameter of the largest bore by 5 mm");
  CHECK(phrase.recognised);
  CHECK(phrase.rank == BoreRank::Largest);
  CHECK(!phrase.absolute);
  CHECK_NEAR(phrase.delta, -5.0, 1e-9);

  const GroundedEdit edit =
      groundBoreDiameterEdit(inv, fx.doc, phrase.rank, phrase.delta, phrase.absolute);
  CHECK(edit.ok);
  CHECK_EQ_STR(edit.step.commandId, "part.edit_feature");
  CHECK_EQ_STR(edit.step.irOp, "");
  CHECK_EQ_INT(edit.step.args.size(), 3);
  CHECK_NEAR(edit.fromDiameter, 12.0, 1e-9);
  CHECK_NEAR(edit.toDiameter, 7.0, 1e-9);
  double feature = -1.0;
  double index = -1.0;
  double value = -1.0;
  for (const PlanArg& a : edit.step.args) {
    if (a.name == "feature") feature = a.number;
    if (a.name == "index") index = a.number;
    if (a.name == "value") value = a.number;
  }
  CHECK_NEAR(feature, 4.0, 1e-9);
  CHECK_NEAR(index, 0.0, 1e-9);
  CHECK_NEAR(value, 7.0, 1e-9);
  // The grounding quotes the MEASUREMENT and the residual it accepted.
  CHECK(edit.grounding.find("⌀12.000") != std::string::npos);
  CHECK(edit.grounding.find("%4") != std::string::npos);
  CHECK(edit.grounding.find("off-axis") != std::string::npos);
  CHECK_EQ_STR(edit.step.note, edit.grounding);

  // "set the diameter of the deepest bore to 12 mm" — absolute, and a different
  // bore, so nothing about the previous answer carried over.
  const BoreEditPhrase abs = parseBoreEditPhrase("set the diameter of the deepest bore to 12 mm");
  CHECK(abs.recognised);
  CHECK(abs.absolute);
  CHECK(abs.rank == BoreRank::Deepest);
  const GroundedEdit absEdit =
      groundBoreDiameterEdit(inv, fx.doc, abs.rank, abs.delta, abs.absolute);
  CHECK(absEdit.ok);
  CHECK_NEAR(absEdit.fromDiameter, 6.0, 1e-9);
  CHECK_NEAR(absEdit.toDiameter, 12.0, 1e-9);
  CHECK_EQ_INT(absEdit.match.irId, 5);

  // "bore 3" — an ordinal in census order.
  const BoreEditPhrase third = parseBoreEditPhrase("enlarge bore 3 by 1.5mm");
  CHECK(third.recognised);
  CHECK(third.rank == BoreRank::Ordinal);
  CHECK_EQ_INT(third.ordinal, 3);
  CHECK_NEAR(third.delta, 1.5, 1e-9);

  // THE ONE REFUSAL, and it is a representability fact: no bore has a
  // non-positive diameter in any kernel.
  const GroundedEdit gone = groundBoreDiameterEdit(inv, fx.doc, BoreRank::Largest, -50.0);
  CHECK(!gone.ok);
  CHECK(gone.why.find("is not a bore") != std::string::npos);

  // NO CENSUS is a MISSING MEASUREMENT, and it says which one.
  PartInventory blank;
  const GroundedEdit unmeasured = groundBoreDiameterEdit(blank, fx.doc, BoreRank::Largest, -5.0);
  CHECK(!unmeasured.ok);
  CHECK(unmeasured.why.find("census") != std::string::npos);

  // A bore the document cannot account for reports the bore AND the reason.
  PartDocument empty;
  const GroundedEdit orphan = groundBoreDiameterEdit(inv, empty, BoreRank::Largest, -5.0);
  CHECK(!orphan.ok);
  CHECK(orphan.why.find("⌀12.000") != std::string::npos);
  CHECK(orphan.why.find("no HOLE or CBORE") != std::string::npos);

  // Phrases that are NOT this shape are declined with a reason a user can act
  // on, never with a silent guess.
  const BoreEditPhrase noNoun = parseBoreEditPhrase("shrink the largest thing by 5 mm");
  CHECK(!noNoun.recognised);
  CHECK(noNoun.why.find("bore") != std::string::npos);
  const BoreEditPhrase noAmount = parseBoreEditPhrase("shrink the largest bore");
  CHECK(!noAmount.recognised);
  CHECK(noAmount.why.find("amount") != std::string::npos);
  const BoreEditPhrase noDirection = parseBoreEditPhrase("change the largest bore by 5 mm");
  CHECK(!noDirection.recognised);
  CHECK(noDirection.why.find("shrink or enlarge") != std::string::npos);
  const BoreEditPhrase noRank = parseBoreEditPhrase("shrink the bore by 5 mm");
  CHECK(!noRank.recognised);
  CHECK(noRank.why.find("names no bore") != std::string::npos);

  // ★THE NUMBER IN "by 5 mm" IS NOT A BORE NUMBER. An ordinal is read only
  // beside the noun, so this stays a superlative with a 5 mm delta.
  const BoreEditPhrase notOrdinal = parseBoreEditPhrase("shrink the largest bore by 5 mm");
  CHECK(notOrdinal.rank == BoreRank::Largest);
  CHECK_EQ_INT(notOrdinal.ordinal, 1);
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testCensus();
  rc |= testRanking();
  rc |= testRefusals();
  rc |= testMatching();
  rc |= testGroundedEdit();
  return rc;
}
