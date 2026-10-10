// ui/test/study_model_test.cpp — THE STUDY, HEADLESS.
//
// Four claims:
//
//   A. StudyFace's numbering IS the solver mesher's. It is not checked by
//      remembering to keep the two equal — the kernel's own header is READ AS
//      DATA and the mapping it documents is diffed against this one, the same
//      way feature_ir_test.cpp re-derives the IR op table. A study whose
//      restraint lands on the wrong side of the part because two enumerations
//      drifted is a wrong answer with no symptom.
//   B. every refusal studyBlocker() can produce is a sentence a person may read,
//      scanned by the SAME function the panel prose gate uses.
//   C. the refusals actually refuse, one incomplete study at a time, and a
//      complete one is not refused.
//   D. the arithmetic the panels print — a load's magnitude and direction, a
//      restraint's held directions, whether a solve settled — is right.
//
// And for the two questions added beside the static one (T-340):
//
//   E. there are three kinds of study, each named and described in a sentence,
//      and a definition that does not say which is a static one.
//   F/G. the modal and thermal refusals refuse, in prose a person may read, and
//      neither demands what its question does not use (a force for a natural
//      frequency; a restraint or a force for heat conduction).
//   H. every material the study can stretch carries a conductivity, in the range
//      from a polymer to copper, with metals and polymers on the right sides.
//   I. "the heat balances" is a RELATIVE judgement on the largest heat flow.
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/Material.hpp"
#include "forge/ui/StudyModel.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

std::string repoRoot() {
#ifdef FORGE_UI_REPO_ROOT
  return std::string(FORGE_UI_REPO_ROOT);
#else
  return std::string(".");
#endif
}

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path);
  if (!in.good()) { ok = false; return std::string(); }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

StudyDefinition completeStudy() {
  StudyDefinition s;
  const Material* m = findMaterial("steel-1018");
  if (m != nullptr) {
    s.materialId = m->id;
    s.materialName = m->name;
    s.densityKgPerM3 = m->densityKgPerM3;
  }
  Restraint r;
  r.face = StudyFace::MinX;
  s.restraints.push_back(r);
  Load l;
  l.face = StudyFace::MaxX;
  l.fz = -100.0;
  s.loads.push_back(l);
  return s;
}

}  // namespace

int main() {
  forge::uitest::Harness H("study_model");

  // ── A. the side numbering is the mesher's ────────────────────────────────
  {
    CHECK_EQ_INT(allStudyFaces().size(), kStudyFaceCount);
    for (std::size_t i = 0; i < allStudyFaces().size(); ++i) {
      CHECK_EQ_INT(static_cast<int>(allStudyFaces()[i]), static_cast<int>(i));
      CHECK_EQ_INT(studyFaceBit(allStudyFaces()[i]), 1u << i);
    }
    CHECK_EQ_INT(studyFaceAxis(StudyFace::MinX), 0);
    CHECK_EQ_INT(studyFaceAxis(StudyFace::MaxY), 1);
    CHECK_EQ_INT(studyFaceAxis(StudyFace::MaxZ), 2);
    CHECK(!studyFaceIsMax(StudyFace::MinZ));
    CHECK(studyFaceIsMax(StudyFace::MaxZ));

    // THE PIN. The kernel states the mapping in the comment on LoadPressure's
    // faceId, and that comment is the contract every node-set selection in this
    // application is built on. Read it, do not remember it.
    bool ok = false;
    const std::string fea = readFile(repoRoot() + "/forge-kernel/include/forge/Fea.hpp", ok);
    CHECK(ok);
    if (ok) {
      const bool documented =
          fea.find("0=-X,1=+X,2=-Y,3=+Y,4=-Z,5=+Z") != std::string::npos;
      if (!documented) {
        std::printf("  the solver's side numbering has changed; StudyFace must follow it\n");
      }
      CHECK(documented);
      // And the field the selection is made through still exists and is still a
      // per-node bitfield of those sides.
      CHECK(fea.find("nodeToFace") != std::string::npos);
      CHECK(fea.find("bitfield of AABB faces it sits on") != std::string::npos);
    }
    // Every side is nameable, and none of the names is a developer's.
    for (StudyFace f : allStudyFaces()) {
      const std::string name = studyFaceName(f);
      CHECK(name.size() >= 6);
      CHECK(scanUserFacingProse(name).empty());
    }
  }

  // ── B/C. the refusals ────────────────────────────────────────────────────
  {
    const StudyDefinition good = completeStudy();
    CHECK(studyBlocker(good, true).empty());

    std::vector<std::string> refusals;
    refusals.push_back(studyBlocker(good, false));            // no part
    StudyDefinition noMaterial = good;
    noMaterial.materialId = "unassigned";
    refusals.push_back(studyBlocker(noMaterial, true));
    StudyDefinition unknownMaterial = good;
    unknownMaterial.materialId = "unobtainium";
    unknownMaterial.materialName = "Unobtainium";
    refusals.push_back(studyBlocker(unknownMaterial, true));
    StudyDefinition noHold = good;
    noHold.restraints.clear();
    refusals.push_back(studyBlocker(noHold, true));
    StudyDefinition holdsNothing = good;
    holdsNothing.restraints[0].holdX = false;
    holdsNothing.restraints[0].holdY = false;
    holdsNothing.restraints[0].holdZ = false;
    refusals.push_back(studyBlocker(holdsNothing, true));
    StudyDefinition noPush = good;
    noPush.loads.clear();
    refusals.push_back(studyBlocker(noPush, true));
    StudyDefinition zeroPush = good;
    zeroPush.loads[0].fz = 0.0;
    refusals.push_back(studyBlocker(zeroPush, true));
    StudyDefinition tooFine = good;
    tooFine.divisions = kMaxStudyDivisions + 1;
    refusals.push_back(studyBlocker(tooFine, true));

    for (const std::string& why : refusals) {
      // It refused...
      CHECK(!why.empty());
      // ...in a sentence...
      CHECK(why.size() >= 30);
      // ...that a person may read.
      const std::vector<ProseFinding> f = scanUserFacingProse(why);
      if (!f.empty()) {
        std::printf("  refusal leaks: \"%s\"  %s\n", why.c_str(),
                    describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
    }
    CHECK_EQ_INT(refusals.size(), 8);
  }

  // ── the elastic table ────────────────────────────────────────────────────
  {
    CHECK(elasticPropertyCount() >= 12);
    CHECK(elasticPropertiesFor("unassigned") == nullptr);
    CHECK(elasticPropertiesFor("unobtainium") == nullptr);
    std::size_t covered = 0;
    for (const Material& m : materialLibrary()) {
      const ElasticProperties* e = elasticPropertiesFor(m.id);
      if (e == nullptr) continue;
      ++covered;
      // Every entry is a real solid: a stiffness of half a gigapascal or more
      // and a sideways spread strictly inside the physical range.
      CHECK(e->youngsModulusPa >= 0.4e9);
      CHECK(e->youngsModulusPa <= 1.0e12);
      CHECK(e->poissonRatio > 0.0);
      CHECK(e->poissonRatio < 0.5);
      // A material the study can stretch must also be one it can weigh.
      CHECK(m.hasDensity());
    }
    // Every material in the picker except "no material chosen".
    CHECK_EQ_INT(covered, materialLibrary().size() - 1);
  }

  // ── D. the arithmetic the panels print ───────────────────────────────────
  {
    Restraint all;
    CHECK_EQ_INT(all.heldDirections(), 3);
    CHECK_EQ_STR(all.describeHold(), "held in all three directions");
    Restraint roller;
    roller.holdX = false;
    roller.holdY = false;
    CHECK_EQ_INT(roller.heldDirections(), 1);
    CHECK_EQ_STR(roller.describeHold(), "held along Z");
    Restraint two;
    two.holdY = false;
    CHECK_EQ_STR(two.describeHold(), "held along X and Z");
    Restraint none;
    none.holdX = none.holdY = none.holdZ = false;
    CHECK(!none.holdsAnything());

    Load down;
    down.fz = -250.0;
    CHECK_NEAR(down.magnitudeN(), 250.0, 1e-9);
    CHECK_EQ_STR(down.describeDirection(), "250.0 N downwards");
    Load right;
    right.fx = 30.0;
    CHECK_EQ_STR(right.describeDirection(), "30.0 N to the right");
    Load nothing;
    CHECK(nothing.isZero());
    CHECK_EQ_STR(nothing.describeDirection(), "no force");
    Load skew;
    skew.fx = 3.0;
    skew.fz = 4.0;
    CHECK_NEAR(skew.magnitudeN(), 5.0, 1e-9);
    CHECK_EQ_STR(skew.describeDirection(), "5.0 N along (0.60, 0.00, 0.80)");
    // Every direction sentence is a sentence.
    for (StudyFace f : allStudyFaces()) {
      Load l;
      l.face = f;
      l.fy = 12.5;
      CHECK(scanUserFacingProse(l.describeDirection()).empty());
    }

    StudyDefinition sum = completeStudy();
    Load second;
    second.face = StudyFace::MaxY;
    second.fz = -50.0;
    sum.loads.push_back(second);
    CHECK_NEAR(sum.totalLoadN(), 150.0, 1e-9);
  }

  // ── whether an answer settled ────────────────────────────────────────────
  {
    StudyOutcome unsolved;
    CHECK(!studyConverged(unsolved));
    StudyOutcome solved;
    solved.solved = true;
    solved.appliedForceN[2] = -100.0;
    solved.residualN = 1.0e-9;
    CHECK(studyConverged(solved));
    CHECK_NEAR(appliedForceMagnitudeN(solved), 100.0, 1e-9);
    // The same residual against a hundredth of the force is NOT settled: the
    // comparison has to be relative or it means different things on different
    // studies.
    StudyOutcome loose = solved;
    loose.residualN = 1.0e-3;
    CHECK(!studyConverged(loose));
    // A solved study with no force at all cannot be called settled.
    StudyOutcome nothingApplied;
    nothingApplied.solved = true;
    CHECK(!studyConverged(nothingApplied));

    // censusFor searches both lists and answers with the side asked for.
    StudyOutcome withCensus;
    FaceCensus held;
    held.face = StudyFace::MinX;
    held.meshNodes = 25;
    held.planeMm = -40.0;
    withCensus.restraintCensus.push_back(held);
    FaceCensus pushed;
    pushed.face = StudyFace::MaxZ;
    pushed.meshNodes = 96;
    withCensus.loadCensus.push_back(pushed);
    CHECK(withCensus.censusFor(StudyFace::MinX) != nullptr);
    CHECK_EQ_INT(withCensus.censusFor(StudyFace::MinX)->meshNodes, 25);
    CHECK_EQ_INT(withCensus.censusFor(StudyFace::MaxZ)->meshNodes, 96);
    CHECK(withCensus.censusFor(StudyFace::MinY) == nullptr);
  }

  // ── E. the three questions ───────────────────────────────────────────────
  {
    CHECK_EQ_INT(allStudyKinds().size(), 3);
    CHECK(allStudyKinds()[0] == StudyKind::Static);
    // A definition made before kinds existed still asks the static question.
    StudyDefinition legacy;
    CHECK(legacy.kind == StudyKind::Static);
    std::vector<std::string> names;
    for (StudyKind k : allStudyKinds()) {
      const std::string name = studyKindName(k);
      const std::string question = studyKindQuestion(k);
      CHECK(name.size() >= 8);
      CHECK(question.size() >= 40);
      CHECK(scanUserFacingProse(name).empty());
      CHECK(scanUserFacingProse(question).empty());
      for (const std::string& seen : names) CHECK(seen != name);
      names.push_back(name);
    }
  }

  // ── F. the modal refusals ────────────────────────────────────────────────
  {
    StudyDefinition good = completeStudy();
    good.kind = StudyKind::Modal;
    good.loads.clear();  // a natural frequency needs no force
    CHECK(studyBlocker(good, true).empty());

    std::vector<std::string> refusals;
    StudyDefinition noMaterial = good;
    noMaterial.materialId = "unassigned";
    refusals.push_back(studyBlocker(noMaterial, true));
    StudyDefinition unknown = good;
    unknown.materialId = "unobtainium";
    unknown.materialName = "Unobtainium";
    refusals.push_back(studyBlocker(unknown, true));
    StudyDefinition weightless = good;
    weightless.densityKgPerM3 = 0.0;
    refusals.push_back(studyBlocker(weightless, true));
    StudyDefinition free = good;
    free.restraints.clear();
    refusals.push_back(studyBlocker(free, true));
    StudyDefinition holdsNothing = good;
    holdsNothing.restraints[0].holdX = holdsNothing.restraints[0].holdY =
        holdsNothing.restraints[0].holdZ = false;
    refusals.push_back(studyBlocker(holdsNothing, true));
    StudyDefinition none = good;
    none.modeCount = kMinStudyModes - 1;
    refusals.push_back(studyBlocker(none, true));
    StudyDefinition many = good;
    many.modeCount = kMaxStudyModes + 1;
    refusals.push_back(studyBlocker(many, true));
    StudyDefinition tooFine = good;
    tooFine.divisions = kMaxStudyDivisions + 1;
    refusals.push_back(studyBlocker(tooFine, true));
    for (const std::string& why : refusals) {
      CHECK(why.size() >= 30);
      const std::vector<ProseFinding> f = scanUserFacingProse(why);
      if (!f.empty()) {
        std::printf("  modal refusal leaks: \"%s\"  %s\n", why.c_str(),
                    describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
    }
    CHECK_EQ_INT(refusals.size(), 8);
    // The no-material sentence names what the material decides for THIS study.
    CHECK(refusals[0].find("vibrates") != std::string::npos);
  }

  // ── G. the thermal refusals ──────────────────────────────────────────────
  {
    StudyDefinition good;
    good.kind = StudyKind::Thermal;
    good.materialId = "copper-c110";
    good.materialName = "Copper";
    good.densityKgPerM3 = 8940.0;
    FixedTemperature hot;
    hot.face = StudyFace::MinZ;
    hot.temperatureC = 120.0;
    good.temperatures.push_back(hot);
    // No restraint and no force: a conduction study needs neither.
    CHECK(good.restraints.empty() && good.loads.empty());
    CHECK(studyBlocker(good, true).empty());
    StudyDefinition generating = good;
    generating.heatGeneratedW = 25.0;
    CHECK(studyBlocker(generating, true).empty());

    std::vector<std::string> refusals;
    refusals.push_back(studyBlocker(good, false));
    StudyDefinition noMaterial = good;
    noMaterial.materialId = "unassigned";
    refusals.push_back(studyBlocker(noMaterial, true));
    StudyDefinition unknown = good;
    unknown.materialId = "unobtainium";
    unknown.materialName = "Unobtainium";
    refusals.push_back(studyBlocker(unknown, true));
    StudyDefinition nothingHeld = good;
    nothingHeld.temperatures.clear();
    refusals.push_back(studyBlocker(nothingHeld, true));
    StudyDefinition belowZero = good;
    belowZero.temperatures[0].temperatureC = -300.0;
    refusals.push_back(studyBlocker(belowZero, true));
    StudyDefinition atZero = good;
    atZero.temperatures[0].temperatureC = kAbsoluteZeroC;
    refusals.push_back(studyBlocker(atZero, true));
    StudyDefinition notANumber = good;
    notANumber.heatGeneratedW = std::nan("");
    refusals.push_back(studyBlocker(notANumber, true));
    StudyDefinition tooFine = good;
    tooFine.divisions = kMinStudyDivisions - 1;
    refusals.push_back(studyBlocker(tooFine, true));
    for (const std::string& why : refusals) {
      CHECK(why.size() >= 30);
      const std::vector<ProseFinding> f = scanUserFacingProse(why);
      if (!f.empty()) {
        std::printf("  thermal refusal leaks: \"%s\"  %s\n", why.c_str(),
                    describeProseFindings(f).c_str());
      }
      CHECK(f.empty());
    }
    CHECK_EQ_INT(refusals.size(), 8);
    CHECK(refusals[1].find("heat") != std::string::npos);

    FixedTemperature t;
    t.temperatureC = 100.0;
    CHECK_EQ_STR(t.describe(), "held at 100.0 C");
    CHECK(scanUserFacingProse(t.describe()).empty());
  }

  // ── H. the conductivity table ────────────────────────────────────────────
  {
    CHECK(thermalPropertyCount() >= 12);
    CHECK(thermalPropertiesFor("unassigned") == nullptr);
    CHECK(thermalPropertiesFor("unobtainium") == nullptr);
    std::size_t covered = 0;
    for (const Material& m : materialLibrary()) {
      const ThermalProperties* k = thermalPropertiesFor(m.id);
      if (k == nullptr) continue;
      ++covered;
      // From a foam-like polymer to pure copper, and nothing outside that.
      CHECK(k->conductivityWPerMK >= 0.05);
      CHECK(k->conductivityWPerMK <= 450.0);
      // A metal (stiffer than 40 GPa) conducts at least ten times better than
      // any polymer here; a polymer (under 5 GPa) conducts under 1 W/(m K).
      const ElasticProperties* e = elasticPropertiesFor(m.id);
      CHECK(e != nullptr);
      if (e != nullptr && e->youngsModulusPa > 40.0e9) CHECK(k->conductivityWPerMK > 5.0);
      if (e != nullptr && e->youngsModulusPa < 5.0e9) CHECK(k->conductivityWPerMK < 1.0);
    }
    CHECK_EQ_INT(covered, materialLibrary().size() - 1);
    CHECK_EQ_INT(thermalPropertyCount(), elasticPropertyCount());
  }

  // ── I. whether a thermal answer balances ─────────────────────────────────
  {
    StudyOutcome t;
    CHECK(!thermalBalanced(t));  // unsolved
    t.solved = true;
    CHECK(!thermalBalanced(t));  // not a thermal answer
    t.kind = StudyKind::Thermal;
    SideHeatFlow in;
    in.heatInW = 4.152;
    SideHeatFlow out;
    out.heatInW = -4.152;
    t.heatFlows = {in, out};
    t.heatImbalanceW = 1.0e-12;
    t.maxResidualW = 1.0e-13;
    CHECK(thermalBalanced(t));
    StudyOutcome leaky = t;
    leaky.heatImbalanceW = 1.0e-3;  // a thousandth of a watt missing out of four
    CHECK(!thermalBalanced(leaky));
    StudyOutcome unsettled = t;
    unsettled.maxResidualW = 1.0e-2;
    CHECK(!thermalBalanced(unsettled));
    StudyOutcome nan = t;
    nan.heatImbalanceW = std::nan("");
    CHECK(!thermalBalanced(nan));
    // Generation alone sets the scale when the held sides carry little.
    StudyOutcome gen = t;
    gen.heatFlows.clear();
    gen.heatGeneratedW = 10.0;
    gen.heatImbalanceW = 5.0e-6;
    CHECK(thermalBalanced(gen));
    gen.heatImbalanceW = 5.0e-4;
    CHECK(!thermalBalanced(gen));
    // One temperature everywhere, nothing generated: the reactions are
    // round-off, and that is balanced -- not "unbalanced because 0 is the scale".
    StudyOutcome still = t;
    for (SideHeatFlow& f : still.heatFlows) f.heatInW = 2.6e-16;
    still.heatImbalanceW = 5.2e-16;
    still.maxResidualW = 3.0e-16;
    CHECK(thermalBalanced(still));
    // ...but a nanowatt unaccounted for in a part conducting nothing is not.
    still.heatImbalanceW = 1.0e-9;
    CHECK(!thermalBalanced(still));
  }

  return H.finish();
}
