// ui/test/document_round_trip_test.cpp
//
// THE GATE THAT MAKES "THE APP MUST SAVE" A MEASUREMENT.
//
// DocumentModel.cpp and DocumentStore.cpp arrived here as 1,918 lines that had
// never been through a compiler, from a branch whose own commit message says
// "NOT reviewed, NOT built, and NOT claimed to compile". They compile now. That
// is not the same as working, and the gap between those two is exactly where a
// save format goes wrong: a writer and a reader written together are each
// other's only witness, and they agree on their shared mistakes.
//
// ── why a VECTOR of observables, and not "the text came back the same" ──────
// Comparing serialise(load(text)) to text is ONE observable, and it is the one
// most likely to pass while the document is wrong. Two ways it lies:
//
//   * a field the WRITER never emits round-trips perfectly as its default.
//     Delete the MATERIAL-DENSITY line from the writer and every text
//     comparison still passes; every part silently weighs nothing.
//   * a field both halves get wrong THE SAME WAY is invisible. If the writer
//     truncates a double to six digits and the reader reads six digits, the
//     text is stable and the geometry has moved.
//
// So the round trip is asserted on a VECTOR: the text, and independently the
// feature count, every statement's id / op / produces-kind / label / command /
// node binding / suppression, every ARGUMENT's kind and BIT PATTERN, the units
// quadruple, the material's id and density and all six appearance channels, the
// fourteen view fields, every parameter's name and exact value and the
// expression the user typed, every named entity's five fields, and the derived
// IR program. Section 7 then MUTATES each of those in turn and requires the
// vector to notice — an observable that cannot report a difference is
// decoration, and this is the only way to know which ones are real.
//
// ── the document is AUTHORED, not hand-stuffed ──────────────────────────────
// Every statement below is emitted by dispatching a REAL command through the
// REAL registry (registerPartCommands over this model's own tree). A fixture
// built by poking records into PartDocument would prove only that the
// serialiser can round-trip a struct the application never produces.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DocumentModel.hpp"
#include "forge/ui/DocumentStore.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"
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

// BIT equality, never CHECK_NEAR. formatRoundTripNumber's whole contract is
// that strtod maps its output back to the IDENTICAL double, so a tolerance here
// would be a tolerance for a defect: 0.30000000000000004 coming back as 0.3 is
// a FAILED round trip that any epsilon in sight would pass.
std::uint64_t bits(double v) {
  std::uint64_t u = 0;
  std::memcpy(&u, &v, sizeof(u));
  return u;
}

// ── THE OBSERVABLE VECTOR ───────────────────────────────────────────────────
// One flat list of "field = value" strings covering everything the format
// claims to carry. Two documents are equal iff their vectors are equal, and a
// mismatch NAMES the field rather than reporting that two 4 KB blobs differ.
std::vector<std::string> observables(const DocumentFileData& d) {
  std::vector<std::string> v;
  const auto push = [&v](const std::string& k, const std::string& val) {
    v.push_back(k + " = " + val);
  };
  const auto pushNum = [&v](const std::string& k, double val) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(bits(val)));
    v.push_back(k + " = 0x" + buf);
  };

  push("version", std::to_string(d.version));
  push("name", d.name);

  push("units.storage", toString(d.units.storageLength));
  push("units.display.length", toString(d.units.displayLength));
  push("units.display.angle", toString(d.units.displayAngle));
  push("units.display.mass", toString(d.units.displayMass));

  push("material.id", d.material.id);
  push("material.name", d.material.name);
  pushNum("material.density", d.material.densityKgPerM3);
  pushNum("material.appearance.r", d.material.appearance.red);
  pushNum("material.appearance.g", d.material.appearance.green);
  pushNum("material.appearance.b", d.material.appearance.blue);
  pushNum("material.appearance.metallic", d.material.appearance.metallic);
  pushNum("material.appearance.roughness", d.material.appearance.roughness);
  pushNum("material.appearance.opacity", d.material.appearance.opacity);

  pushNum("view.eye.x", d.view.eye.x);
  pushNum("view.eye.y", d.view.eye.y);
  pushNum("view.eye.z", d.view.eye.z);
  pushNum("view.target.x", d.view.target.x);
  pushNum("view.target.y", d.view.target.y);
  pushNum("view.target.z", d.view.target.z);
  pushNum("view.up.x", d.view.up.x);
  pushNum("view.up.y", d.view.up.y);
  pushNum("view.up.z", d.view.up.z);
  pushNum("view.fov", d.view.fieldOfViewDegrees);
  pushNum("view.zoom", d.view.zoom);
  push("view.orthographic", d.view.orthographic ? "1" : "0");
  push("view.wireframe", d.view.wireframe ? "1" : "0");
  push("view.grid", d.view.showGrid ? "1" : "0");

  push("parameters.count", std::to_string(d.parameters.size()));
  for (std::size_t i = 0; i < d.parameters.size(); ++i) {
    const std::string p = "parameter[" + std::to_string(i) + "]";
    push(p + ".name", d.parameters[i].name);
    pushNum(p + ".mm", d.parameters[i].millimetres);
    push(p + ".expression", d.parameters[i].expression);
    push(p + ".comment", d.parameters[i].comment);
  }

  push("names.count", std::to_string(d.names.size()));
  for (std::size_t i = 0; i < d.names.size(); ++i) {
    const std::string n = "name[" + std::to_string(i) + "]";
    push(n + ".label", d.names[i].name);
    push(n + ".body", d.names[i].ref.bodyId);
    push(n + ".kind", toString(d.names[i].ref.kind));
    push(n + ".persistent", d.names[i].ref.persistentName);
    push(n + ".generation", std::to_string(d.names[i].ref.generation));
  }

  push("features.count", std::to_string(d.features.size()));
  for (std::size_t i = 0; i < d.features.size(); ++i) {
    const DocumentFeature& f = d.features[i];
    const std::string s = "feature[" + std::to_string(i) + "]";
    push(s + ".id", std::to_string(f.record.irId));
    push(s + ".op", f.record.line.op);
    push(s + ".produces", toString(f.record.produces));
    push(s + ".label", f.record.label);
    push(s + ".command", f.record.commandId);
    push(s + ".node", f.node);
    push(s + ".suppressed", f.suppressed ? "1" : "0");
    push(s + ".text", f.record.line.text());
    push(s + ".argcount", std::to_string(f.record.line.args.size()));
    for (std::size_t a = 0; a < f.record.line.args.size(); ++a) {
      const IrArg& arg = f.record.line.args[a];
      const std::string k = s + ".arg[" + std::to_string(a) + "]";
      push(k + ".kind", std::to_string(static_cast<int>(arg.kind)));
      pushNum(k + ".number", arg.number);
      push(k + ".ref", std::to_string(arg.ref));
      push(k + ".word", arg.word);
    }
  }
  push("irProgram", d.irProgram());
  return v;
}

// Compares two observable vectors ELEMENT BY ELEMENT and names the first
// differing fields. Returns how many entries differ; records ONE check.
// `report` is false for the negative controls, where a difference is the
// EXPECTED outcome and printing it as "FAIL" would put seventeen alarming lines
// into the log of a passing gate.
std::size_t countDifferences(const std::vector<std::string>& got,
                             const std::vector<std::string>& want, const char* what, bool report) {
  if (got.size() != want.size()) {
    if (report) {
      std::printf("  FAIL  %s: observable vector has %zu entries, want %zu\n", what, got.size(),
                  want.size());
    }
    return got.size() > want.size() ? got.size() - want.size() : want.size() - got.size();
  }
  std::size_t bad = 0;
  for (std::size_t i = 0; i < got.size(); ++i) {
    if (got[i] == want[i]) continue;
    ++bad;
    if (report && bad <= 12) {
      std::printf("  FAIL  %s: observable %zu differs\n        got  %s\n        want %s\n", what,
                  i, got[i].c_str(), want[i].c_str());
    }
  }
  return bad;
}

std::size_t diffObservables(Harness& H, const std::vector<std::string>& got,
                            const std::vector<std::string>& want, const char* what) {
  ++H.checks;
  const std::size_t bad = countDifferences(got, want, what, true);
  if (bad != 0) ++H.failures;
  return bad;
}

// The negative-control form: the mutation MUST be seen. diffObservables counts
// a failure when it finds a difference, which is what we want here, so its
// bookkeeping is undone and the DIFFERENCE is what gets asserted.
void mustDiffer(Harness& H, const DocumentFileData& mutated,
                const std::vector<std::string>& baseline, const char* what) {
  ++H.checks;
  if (countDifferences(observables(mutated), baseline, what, false) != 0) return;
  ++H.failures;
  std::printf("  FAIL  %s: the observable vector did NOT notice this mutation, so that field is "
              "unchecked and this gate has been lying about it\n",
              what);
}

}  // namespace

int main() {
  Harness H("document_round_trip");

  // ── 1. AUTHOR a document through the real registry ────────────────────────
  DocumentModel model;
  CommandRegistry registry;
  SelectionService sel;
  const std::size_t commands = registerPartCommands(registry, model.tree(), model.undo());
  CHECK(commands > 0);

  PartDocument& tree = model.tree();
  CHECK_EQ_INT(
      tree.seed(IrValueKind::Profile, "sketch_1", "RECT", {IrArg::num(80), IrArg::num(60)}), 1);
  CHECK_EQ_INT(tree.seed(IrValueKind::Solid, "body_x", "BOX",
                         {IrArg::num(5), IrArg::num(5), IrArg::num(5)}),
               2);

  sel.replaceWith({ref("sketch_1", EntityKind::Sketch, "s1")});
  CHECK(registry.dispatch("part.extrude", sel, num1("distance", 20)).ok());
  CHECK_EQ_INT(tree.valueFor("body_3"), 3);

  sel.replaceWith({ref("body_3", EntityKind::Edge, "e1")});
  CHECK(registry.dispatch("part.fillet", sel, num1("radius", 4)).ok());

  sel.replaceWith({ref("body_3", EntityKind::Face, "f1")});
  CHECK(registry.dispatch("part.shell", sel, num1("thickness", 2)).ok());
  const std::size_t authored = tree.records().size();
  CHECK_EQ_INT(authored, 5);
  CHECK_EQ_INT(tree.featureCount(), 3);

  // ── 2. metadata: units, material, view, parameters, names ─────────────────
  CHECK(model.setName("bracket rev C"));
  DocumentUnits units;
  units.displayLength = LengthUnit::Inch;
  units.displayAngle = AngleUnit::Radian;
  units.displayMass = MassUnit::Pound;
  units.storageLength = kInternalLengthUnit;
  CHECK(model.setUnits(units));

  CHECK(model.setMaterialById("titanium-ti6al4v"));
  CHECK_NEAR(model.material().densityKgPerM3, 4430.0, 1e-12);
  // An id the library does not hold must change NOTHING: a picker that can
  // blank a document's density is how a part silently stops having a mass.
  CHECK(!model.setMaterialById("unobtainium"));
  CHECK_EQ_STR(model.material().id, "titanium-ti6al4v");
  // and the density is real arithmetic, not a stored constant
  const MassProperties mp = model.massProperties(1000.0);
  CHECK(mp.known);
  CHECK_NEAR(mp.massGrams, 4.43, 1e-12);

  ViewState view;
  view.eye = Vec3{123.5, -87.25, 64.125};
  view.target = Vec3{1.0, 2.0, 3.0};
  view.up = Vec3{0.0, 0.0, 1.0};
  view.fieldOfViewDegrees = 38.5;
  view.zoom = 1.75;
  view.orthographic = true;
  view.wireframe = true;
  view.showGrid = false;
  model.setView(view);

  std::string perr;
  CHECK(model.setParameter("bore", "0.5 in", perr));
  CHECK_EQ_STR(perr, "");
  const DocumentParameter* bore = model.parameter("bore");
  CHECK(bore != nullptr);
  if (bore != nullptr) {
    CHECK_NEAR(bore->millimetres, 12.7, 1e-12);
    // the user's OWN WORDS survive, not this program's rounding of them
    CHECK_EQ_STR(bore->expression, "0.5 in");
  }
  // A value with no short decimal form: the entry that catches a writer which
  // rounds. 0.1 + 0.2 is not 0.3 and the file must not pretend it is.
  const double awkward = 0.1 + 0.2;
  CHECK(model.setParameter("awkward", formatRoundTripNumber(awkward) + " mm", perr));

  CHECK(model.nameEntity("largest bore", ref("body_3", EntityKind::Face, "face@bore.1")));
  CHECK(model.nameEntity("mount pad", ref("body_3", EntityKind::Face, "face@pad.2")));
  const EntityRef* named = model.entityNamed("largest bore");
  CHECK(named != nullptr);
  if (named != nullptr) CHECK_EQ_STR(named->persistentName, "face@bore.1");

  // Suppression, so the BUILD program genuinely differs from the AUTHORED one.
  // A round trip that only ever sees them equal has not tested either.
  CHECK_EQ_INT(static_cast<int>(model.setSuppressed(5, true)),
               static_cast<int>(TreeEditStatus::Ok));
  CHECK(model.suppressed(5));
  const std::string authoredProgram = model.irProgram();
  const std::string buildProgram = model.buildProgram();
  CHECK(authoredProgram != buildProgram);

  // ── 3. THE ROUND TRIP, on the vector ──────────────────────────────────────
  const DocumentFileData before = model.capture();
  const std::string text = writeDocumentFile(before);
  CHECK(!text.empty());

  DocumentFileData after;
  DocumentIoError io;
  const bool read = readDocumentFile(text, after, io);
  CHECK_EQ_STR(io.describe(), "ok");
  CHECK(read);

  const std::vector<std::string> vBefore = observables(before);
  const std::vector<std::string> vAfter = observables(after);
  std::printf("[document_round_trip] %zu observables over %zu statements, %zu parameters, "
              "%zu names; the file is %zu bytes\n",
              vBefore.size(), before.features.size(), before.parameters.size(),
              before.names.size(), text.size());
  CHECK_EQ_INT(diffObservables(H, vAfter, vBefore, "write -> read"), 0);
  // The vector must be big enough to BE a vector: a collapsed observables()
  // returning two entries would pass every comparison in this file.
  CHECK(vBefore.size() > 100);

  // the text is the SECOND observable, never the only one
  CHECK_EQ_STR(writeDocumentFile(after), text);

  // ── 4. round trip through the LIVE MODEL, not just the value type ─────────
  // capture() / readDocumentFile() prove the FORMAT. This proves the MODEL: a
  // loaded document must BEHAVE like the one that was saved, including its
  // derived programs and, above all, its bindings.
  DocumentModel reloaded;
  DocumentIoError lio;
  CHECK(reloaded.load(text, lio));
  CHECK_EQ_STR(lio.describe(), "ok");
  CHECK_EQ_STR(reloaded.name(), "bracket rev C");
  CHECK_EQ_STR(reloaded.irProgram(), authoredProgram);
  CHECK_EQ_STR(reloaded.buildProgram(), buildProgram);
  CHECK_EQ_STR(reloaded.contentDigest(), model.contentDigest());
  CHECK(reloaded.suppressed(5));
  CHECK_EQ_INT(reloaded.tree().records().size(), authored);
  CHECK_EQ_INT(reloaded.tree().featureCount(), tree.featureCount());
  // The node -> value BINDING survived. Without it a reloaded document cannot
  // be selected on: every command would report Disabled on a part that looks
  // perfectly fine on screen.
  CHECK_EQ_INT(reloaded.tree().valueFor("body_3"), model.tree().valueFor("body_3"));
  CHECK_EQ_STR(reloaded.tree().nodeFor(3), model.tree().nodeFor(3));
  // the display units came back, so a reopened inch document is still in inches
  CHECK_EQ_INT(static_cast<int>(reloaded.units().displayLength),
               static_cast<int>(LengthUnit::Inch));
  CHECK_EQ_STR(reloaded.material().id, "titanium-ti6al4v");
  // and the awkward double came back BIT-identical
  const DocumentParameter* rAwkward = reloaded.parameter("awkward");
  CHECK(rAwkward != nullptr);
  if (rAwkward != nullptr) CHECK_EQ_INT(bits(rAwkward->millimetres), bits(awkward));

  // Opening a file is not an edit: undo must not reach past it into the
  // previous document's history.
  CHECK_EQ_INT(reloaded.undo().undoDepth(), 0);

  // ── 5. IDEMPOTENCE, and the view is not content ───────────────────────────
  CHECK_EQ_STR(reloaded.serialize(), text);
  DocumentFileData third;
  DocumentIoError io3;
  CHECK(readDocumentFile(reloaded.serialize(), third, io3));
  CHECK_EQ_INT(diffObservables(H, observables(third), vBefore, "write -> read -> write -> read"),
               0);

  // dirty() is DERIVED, never accumulated: saving clears it, orbiting the
  // camera does not set it, a real edit does, and undoing that edit clears it
  // again — which a flag some mutation path forgets to set cannot do.
  model.markSaved();
  CHECK(!model.dirty());
  ViewState moved = view;
  moved.eye = Vec3{500.0, 500.0, 500.0};
  model.setView(moved);
  CHECK(!model.dirty());  // the camera is SAVED, but it is not an EDIT
  CHECK(model.setName("bracket rev D"));
  CHECK(model.dirty());
  CHECK(model.setName("bracket rev C"));
  CHECK(!model.dirty());

  // ── 6. THE VERSION POLICY ─────────────────────────────────────────────────
  // A format with no version is a format you can never change; a version with
  // no ENFORCED policy is one you can change exactly once. Every rule the
  // header states is asserted here.
  CHECK_EQ_INT(kDocumentFormatVersion, 2);
  CHECK_EQ_INT(kOldestReadableDocumentVersion, 1);
  CHECK_EQ_INT(documentFormatHistory().size(),
               static_cast<std::size_t>(kDocumentFormatVersion));
  CHECK_EQ_INT(documentFormatHistory().back().version, kDocumentFormatVersion);
  CHECK_EQ_INT(documentFormatHistory().front().version, kOldestReadableDocumentVersion);
  // rule 1: the file says what it is, on line 1
  CHECK_EQ_STR(text.substr(0, 12), "FORGE-PART 2");

  {  // rule 3: a FUTURE version is refused, and the refusal names BOTH numbers
     // — the only actionable answer, because the fix is a newer build
    DocumentFileData f;
    DocumentIoError e;
    CHECK(!readDocumentFile("FORGE-PART 3\nNAME x\n", f, e));
    CHECK_EQ_INT(e.fileVersion, 3);
    CHECK(e.message.find("version 3") != std::string::npos);
    CHECK(e.message.find("up to version 2") != std::string::npos);
  }
  {  // not a .fpart at all
    DocumentFileData f;
    DocumentIoError e;
    CHECK(!readDocumentFile("{\"json\": true}\n", f, e));
    CHECK(!e.ok());
  }
  {  // a version that is not a positive integer
    DocumentFileData f;
    DocumentIoError e;
    CHECK(!readDocumentFile("FORGE-PART 2.5\nNAME x\n", f, e));
    CHECK(!e.ok());
  }
  {  // rule 4: an unknown key is refused WITH ITS LINE NUMBER. This is what
     // makes rule 5 enforceable at all.
    DocumentFileData f;
    DocumentIoError e;
    CHECK(!readDocumentFile("FORGE-PART 2\nNAME x\nWIDGET 3\n", f, e));
    CHECK_EQ_INT(e.line, 3);
    CHECK(e.message.find("WIDGET") != std::string::npos);
  }
  {  // rule 5: a v1 file may NOT carry a v2 key. That is corruption, not
     // forward compatibility, and accepting it makes the policy unenforceable.
    DocumentFileData f;
    DocumentIoError e;
    CHECK(!readDocumentFile("FORGE-PART 1\nNAME x\nMATERIAL-DENSITY 7850\n", f, e));
    CHECK(e.message.find("version 2") != std::string::npos);
  }
  {  // rule 2: a v1 file is READ and UPGRADED IN MEMORY, taking the documented
     // defaults for everything v1 could not express
    const std::string v1 =
        "FORGE-PART 1\n"
        "NAME legacy\n"
        "UNITS in\n"
        "FEATURE\nID 1\nKIND profile\nNODE sketch_1\nOP RECT\n"
        "ARG num 80\nARG num 60\nEND\n"
        "FEATURE\nID 2\nKIND solid\nNODE body_2\nCOMMAND part.extrude\nLABEL Extrude\n"
        "OP EXTRUDE\nARG ref 1\nARG num 20\nEND\n";
    DocumentFileData f;
    DocumentIoError e;
    CHECK(readDocumentFile(v1, f, e));
    CHECK_EQ_STR(e.describe(), "ok");
    CHECK_EQ_INT(f.version, 1);
    CHECK_EQ_STR(f.name, "legacy");
    CHECK_EQ_INT(f.features.size(), 2);
    CHECK_EQ_STR(f.irProgram(), "%1 = RECT(80, 60)\n%2 = EXTRUDE(%1, 20)\n");
    // v1's ONE unit word meant both storage and display
    CHECK_EQ_INT(static_cast<int>(f.units.storageLength), static_cast<int>(LengthUnit::Inch));
    CHECK_EQ_INT(static_cast<int>(f.units.displayLength), static_cast<int>(LengthUnit::Inch));
    // the documented v1 defaults: no material — so mass properties report
    // UNKNOWN rather than 0 g — nothing suppressed, no parameters, no names
    CHECK_EQ_STR(f.material.id, "unassigned");
    CHECK(!f.material.hasDensity());
    CHECK(!massPropertiesOf(f.material, 1000.0).known);
    CHECK_EQ_INT(f.parameters.size(), 0);
    CHECK_EQ_INT(f.names.size(), 0);
    CHECK(!f.features[0].suppressed);

    // UPGRADING IS IDEMPOTENT: the upgraded document writes at the CURRENT
    // version, and reading that back yields the same document again.
    const std::string upgraded = writeDocumentFile(f);
    CHECK_EQ_STR(upgraded.substr(0, 12), "FORGE-PART 2");
    DocumentFileData g;
    DocumentIoError e2;
    CHECK(readDocumentFile(upgraded, g, e2));
    CHECK_EQ_STR(writeDocumentFile(g), upgraded);
    // `version` is the ONE observable that legitimately moves on upgrade;
    // every other field must be identical.
    DocumentFileData fAtCurrent = f;
    fAtCurrent.version = kDocumentFormatVersion;
    CHECK_EQ_INT(diffObservables(H, observables(g), observables(fAtCurrent), "v1 upgrade"), 0);
  }

  // ── 7. NEGATIVE CONTROLS: every observable must be able to FAIL ───────────
  // An instrument that cannot report a difference is decoration. Each mutation
  // below is a defect a writer could really have; each MUST be caught. If any
  // of them came back "no difference", that field is unchecked and everything
  // section 3 claimed about it is worthless.
  {
    DocumentFileData d;

    d = before;
    d.material.densityKgPerM3 = 0.0;
    mustDiffer(H, d, vBefore, "control: density dropped");

    d = before;
    d.material.appearance.opacity = 0.5;
    mustDiffer(H, d, vBefore, "control: one appearance channel moved");

    d = before;
    d.units.displayAngle = AngleUnit::Degree;
    mustDiffer(H, d, vBefore, "control: display angle unit changed");

    d = before;
    d.units.storageLength = LengthUnit::Inch;
    mustDiffer(H, d, vBefore, "control: STORAGE unit changed (a silent 25.4x)");

    d = before;
    d.view.showGrid = !d.view.showGrid;
    mustDiffer(H, d, vBefore, "control: one view flag flipped");

    d = before;
    d.view.zoom = std::nextafter(d.view.zoom, 1e300);
    mustDiffer(H, d, vBefore, "control: view zoom off by ONE ULP");

    d = before;
    CHECK(!d.parameters.empty());
    if (!d.parameters.empty()) {
      d.parameters[0].expression = "12.7";
      mustDiffer(H, d, vBefore, "control: the user's typed expression replaced by its value");
      d = before;
      d.parameters[0].millimetres = std::nextafter(d.parameters[0].millimetres, 1e300);
      mustDiffer(H, d, vBefore, "control: a parameter off by ONE ULP");
    }

    d = before;
    CHECK(!d.names.empty());
    if (!d.names.empty()) {
      d.names[0].ref.persistentName = "face@bore.2";
      mustDiffer(H, d, vBefore, "control: a persistent name repointed");
      d = before;
      d.names[0].ref.generation += 1;
      mustDiffer(H, d, vBefore, "control: a name's generation bumped");
      d = before;
      d.names[0].ref.kind = EntityKind::Edge;
      mustDiffer(H, d, vBefore, "control: a named entity's KIND changed");
    }

    d = before;
    CHECK(!d.features.empty());
    if (!d.features.empty()) {
      d.features.back().suppressed = !d.features.back().suppressed;
      mustDiffer(H, d, vBefore, "control: suppression flag flipped");

      d = before;
      d.features.back().node = "body_zzz";
      mustDiffer(H, d, vBefore, "control: a node binding repointed");

      d = before;
      d.features.back().record.label += " ";
      mustDiffer(H, d, vBefore, "control: a feature label gained a trailing space");

      d = before;
      d.features.back().record.produces = IrValueKind::Surface;
      mustDiffer(H, d, vBefore, "control: a statement's produces-kind changed");

      d = before;
      d.features.pop_back();
      mustDiffer(H, d, vBefore, "control: a whole statement dropped");

      d = before;
      if (!d.features.back().record.line.args.empty()) {
        IrArg& a = d.features.back().record.line.args.front();
        a.number = std::nextafter(a.number, 1e300);
        mustDiffer(H, d, vBefore, "control: an IR argument off by ONE ULP");
      }
    }
  }

  // ── 8. THE STORE: autosave, crash detection, recovery ─────────────────────
  // The kernel segfaults on some geometry (D-039), so this application WILL die
  // on a user's work. Recovery is not a nicety here; it is the consequence.
  {
    MemoryStorage storage;
    RecoveryService session(storage, "/session");
    std::string err;

    CHECK(session.beginSession("s1", 1000, err));
    CHECK_EQ_STR(err, "");
    CHECK(session.active());
    // A marker on disk MEANS a session that did not end. There is no separate
    // "was it a crash?" heuristic to get wrong: the absence of the clean-exit
    // step IS the evidence.
    CHECK(storage.exists(session.markerPath()));

    CHECK(session.autosaveNow(2000, model, "/parts/bracket.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 1);
    CHECK(storage.exists(session.autosavePath()));

    // An UNCHANGED document must not be rewritten: a timer that rewrites an
    // unchanged file spins a disk for nothing and hides real activity in its
    // own statistics.
    CHECK(!session.autosaveNow(3000, model, "/parts/bracket.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 1);
    CHECK_EQ_INT(session.stats().autosavesSkipped, 1);

    CHECK(model.setName("bracket rev E"));
    CHECK(session.autosaveNow(4000, model, "/parts/bracket.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 2);

    // A FAILING WRITE is the whole reason the storage seam exists. The previous
    // autosave must still be intact afterwards — a truncated recovery file is
    // worse than none, because it is the thing the user is told to trust.
    std::string good;
    CHECK(storage.contents(session.autosavePath(), good));
    CHECK(good.find("bracket rev E") != std::string::npos);
    storage.failNextWrites(1);
    CHECK(model.setName("bracket rev F"));
    CHECK(!session.autosaveNow(5000, model, "/parts/bracket.fpart", err));
    CHECK(!err.empty());
    CHECK_EQ_INT(session.stats().autosaveFailures, 1);
    std::string stillThere;
    CHECK(storage.contents(session.autosavePath(), stillThere));
    CHECK_EQ_STR(stillThere, good);

    // THE CRASH: a second session opens and finds a marker that is not its own.
    RecoveryService next(storage, "/session");
    std::string nerr;
    CHECK(next.beginSession("s2", 6000, nerr));
    const std::vector<RecoveryCandidate> found = next.scan();
    CHECK_EQ_INT(found.size(), 1);
    if (!found.empty()) {
      CHECK_EQ_STR(found.front().sessionId, "s1");
      CHECK(found.front().hasAutosave);
      // the marker names the user's own file, so recovery can offer to put the
      // work back where it came from
      CHECK_EQ_STR(found.front().documentPath, "/parts/bracket.fpart");

      // Recovery goes through the SAME reader a normal Open uses, so a
      // recovered document is a document and not a special case.
      DocumentModel recovered;
      DocumentIoError rerr;
      CHECK(next.recover(found.front(), recovered, rerr));
      CHECK_EQ_STR(rerr.describe(), "ok");
      CHECK_EQ_STR(recovered.name(), "bracket rev E");
      CHECK_EQ_STR(recovered.irProgram(), authoredProgram);
      CHECK_EQ_STR(recovered.buildProgram(), buildProgram);
      CHECK(recovered.suppressed(5));
      CHECK_EQ_INT(recovered.tree().valueFor("body_3"), model.tree().valueFor("body_3"));
      // the recovered work is the FULL observable vector, not just the name
      DocumentFileData rec = recovered.capture();
      DocumentFileData expected = before;
      expected.name = "bracket rev E";
      // Section 5 moved the camera before this autosave was taken, and the
      // view IS saved even though it is not content -- so the recovered
      // document carries `moved`, not the original `view`.
      expected.view = moved;
      CHECK_EQ_INT(diffObservables(H, observables(rec), observables(expected), "recovered"), 0);

      // discarding a candidate removes its evidence, so it is not offered twice
      std::string derr;
      CHECK(next.discard(found.front(), derr));
      CHECK_EQ_INT(next.scan().size(), 0);
    }

    // A CLEAN exit is the only thing that removes a marker, and it takes the
    // autosave with it: whatever is left after this is, by definition, a
    // session that died.
    CHECK(next.endSession(nerr));
    CHECK(!storage.exists(next.markerPath()));
    CHECK(!storage.exists(next.autosavePath()));
    RecoveryService fresh(storage, "/session");
    std::string ferr;
    CHECK(fresh.beginSession("s3", 7000, ferr));
    CHECK_EQ_INT(fresh.scan().size(), 0);
  }

  return H.finish();
}
