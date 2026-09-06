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

  return H.finish();
}
