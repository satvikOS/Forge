#include "forge/ui/StudyModel.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace forge::ui {

namespace {

// A short fixed-point rendering with no locale and no stream. The panel prints
// with ImGui's own formatting; these strings are for the sentences the model
// itself composes, so they must not depend on anything global.
std::string number(double v, int decimals) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.*f", decimals, v);
  return std::string(buf);
}

struct ElasticRow {
  const char* id;
  double youngsModulusPa;
  double poissonRatio;
};

// Nominal room-temperature handbook values, keyed on materialLibrary()'s ids.
//
// Young's modulus and Poisson's ratio are carried and nothing else, and that is
// deliberate: both are properties of the ALLOY and move by a few per cent across
// tempers, so a document that records only "Aluminium 6061-T6" already contains
// enough to state them. A yield strength does not have that property, which is
// why there is no column for it here and no safety factor anywhere above.
//
// Sorted by id, matching the material table, so a missing row is visible.
constexpr ElasticRow kElastic[] = {
    {"abs", 2.3e9, 0.35},
    {"aluminium-6061", 68.9e9, 0.33},
    {"aluminium-7075", 71.7e9, 0.33},
    {"brass-c360", 97.0e9, 0.31},
    {"bronze-c932", 100.0e9, 0.34},
    {"cast-iron-grey", 100.0e9, 0.26},
    {"copper-c110", 117.0e9, 0.34},
    {"hdpe", 1.0e9, 0.42},
    {"magnesium-az31", 45.0e9, 0.35},
    {"nylon-66", 2.8e9, 0.39},
    {"peek", 3.6e9, 0.38},
    {"pla", 3.5e9, 0.36},
    {"polycarbonate", 2.3e9, 0.37},
    {"pom-acetal", 3.1e9, 0.35},
    {"ptfe", 0.5e9, 0.46},
    {"stainless-304", 193.0e9, 0.29},
    {"stainless-316", 193.0e9, 0.30},
    {"steel-1018", 200.0e9, 0.29},
    {"steel-4140", 205.0e9, 0.29},
    {"titanium-ti6al4v", 113.8e9, 0.342},
};

}  // namespace

// ── the six sides ───────────────────────────────────────────────────────────
const std::vector<StudyFace>& allStudyFaces() {
  static const std::vector<StudyFace> kAll = {StudyFace::MinX, StudyFace::MaxX, StudyFace::MinY,
                                              StudyFace::MaxY, StudyFace::MinZ, StudyFace::MaxZ};
  return kAll;
}

const char* studyFaceName(StudyFace face) noexcept {
  switch (face) {
    case StudyFace::MinX: return "Left side (-X)";
    case StudyFace::MaxX: return "Right side (+X)";
    case StudyFace::MinY: return "Front side (-Y)";
    case StudyFace::MaxY: return "Back side (+Y)";
    case StudyFace::MinZ: return "Bottom (-Z)";
    case StudyFace::MaxZ: return "Top (+Z)";
  }
  return "Left side (-X)";
}

std::uint32_t studyFaceBit(StudyFace face) noexcept {
  return 1u << static_cast<std::uint32_t>(face);
}

int studyFaceAxis(StudyFace face) noexcept { return static_cast<int>(face) / 2; }

bool studyFaceIsMax(StudyFace face) noexcept { return (static_cast<int>(face) % 2) == 1; }

// ── a restraint ─────────────────────────────────────────────────────────────
int Restraint::heldDirections() const noexcept {
  return (holdX ? 1 : 0) + (holdY ? 1 : 0) + (holdZ ? 1 : 0);
}

std::string Restraint::describeHold() const {
  const int n = heldDirections();
  if (n == 3) return "held in all three directions";
  if (n == 0) return "free to move in every direction";
  std::string out = "held along ";
  bool first = true;
  const char* axes[3] = {"X", "Y", "Z"};
  const bool on[3] = {holdX, holdY, holdZ};
  int written = 0;
  for (int i = 0; i < 3; ++i) {
    if (!on[i]) continue;
    if (!first) out += (written == n - 1) ? " and " : ", ";
    out += axes[i];
    first = false;
    ++written;
  }
  return out;
}

// ── a load ──────────────────────────────────────────────────────────────────
double Load::magnitudeN() const noexcept { return std::sqrt(fx * fx + fy * fy + fz * fz); }

bool Load::isZero() const noexcept { return magnitudeN() <= 0.0; }

std::string Load::describeDirection() const {
  const double m = magnitudeN();
  if (m <= 0.0) return "no force";
  std::string out = number(m, 1) + " N ";
  // A pure-axis force gets the word a person would use for it; anything else is
  // reported as the unit vector it is, rather than rounded to the nearest word.
  const double ax = std::fabs(fx), ay = std::fabs(fy), az = std::fabs(fz);
  const double tol = m * 1.0e-9;
  if (ay <= tol && az <= tol) return out + (fx > 0 ? "to the right" : "to the left");
  if (ax <= tol && az <= tol) return out + (fy > 0 ? "backwards" : "forwards");
  if (ax <= tol && ay <= tol) return out + (fz > 0 ? "upwards" : "downwards");
  return out + "along (" + number(fx / m, 2) + ", " + number(fy / m, 2) + ", " +
         number(fz / m, 2) + ")";
}

// ── the material's elastic constants ────────────────────────────────────────
const ElasticProperties* elasticPropertiesFor(const std::string& materialId) {
  static const std::vector<ElasticProperties> kValues = [] {
    std::vector<ElasticProperties> v;
    v.reserve(sizeof(kElastic) / sizeof(kElastic[0]));
    for (const ElasticRow& row : kElastic) {
      ElasticProperties p;
      p.youngsModulusPa = row.youngsModulusPa;
      p.poissonRatio = row.poissonRatio;
      v.push_back(p);
    }
    return v;
  }();
  for (std::size_t i = 0; i < kValues.size(); ++i) {
    if (materialId == kElastic[i].id) return &kValues[i];
  }
  return nullptr;
}

std::size_t elasticPropertyCount() { return sizeof(kElastic) / sizeof(kElastic[0]); }

// ── the study ───────────────────────────────────────────────────────────────
double StudyDefinition::totalLoadN() const noexcept {
  double sx = 0.0, sy = 0.0, sz = 0.0;
  for (const Load& l : loads) {
    sx += l.fx;
    sy += l.fy;
    sz += l.fz;
  }
  return std::sqrt(sx * sx + sy * sy + sz * sz);
}

std::string studyBlocker(const StudyDefinition& study, bool hasBody) {
  if (!hasBody) {
    return "There is no part to test yet. Open or draw one and its sides will appear here.";
  }
  if (study.materialId.empty() || study.materialId == "unassigned") {
    return "Choose a material for this part first. How far it bends is a property of what it "
           "is made of, so the study cannot answer until one is picked.";
  }
  if (elasticPropertiesFor(study.materialId) == nullptr) {
    return "Forge does not carry stiffness figures for " +
           (study.materialName.empty() ? study.materialId : study.materialName) +
           ", so it cannot say how far this part would bend. Pick a material it does carry.";
  }
  if (study.restraints.empty()) {
    return "Add a restraint. Until one side is held, the part is free to drift and there is no "
           "answer to find.";
  }
  bool anyHold = false;
  for (const Restraint& r : study.restraints) {
    if (r.holdsAnything()) anyHold = true;
  }
  if (!anyHold) {
    return "Every restraint on this study holds nothing. Tick at least one direction on one of "
           "them, or the part is still free to drift.";
  }
  if (study.loads.empty()) {
    return "Add a force. With nothing pushing on it the part stays exactly where it is.";
  }
  bool anyLoad = false;
  for (const Load& l : study.loads) {
    if (!l.isZero()) anyLoad = true;
  }
  if (!anyLoad) {
    return "Every force on this study is zero. Give one of them a size, or the part stays "
           "exactly where it is.";
  }
  if (study.divisions < kMinStudyDivisions || study.divisions > kMaxStudyDivisions) {
    return "The number of elements across the part must be between " +
           std::to_string(kMinStudyDivisions) + " and " + std::to_string(kMaxStudyDivisions) + ".";
  }
  return std::string();
}

// ── the answer ──────────────────────────────────────────────────────────────
const FaceCensus* StudyOutcome::censusFor(StudyFace face) const {
  for (const FaceCensus& c : restraintCensus) {
    if (c.face == face) return &c;
  }
  for (const FaceCensus& c : loadCensus) {
    if (c.face == face) return &c;
  }
  return nullptr;
}

double appliedForceMagnitudeN(const StudyOutcome& outcome) noexcept {
  const double x = outcome.appliedForceN[0];
  const double y = outcome.appliedForceN[1];
  const double z = outcome.appliedForceN[2];
  return std::sqrt(x * x + y * y + z * z);
}

bool studyConverged(const StudyOutcome& outcome) noexcept {
  if (!outcome.solved) return false;
  const double applied = appliedForceMagnitudeN(outcome);
  // A study with no force at all is not "converged", it is unanswered — and it
  // cannot reach here, because studyBlocker() refuses it.
  if (!(applied > 0.0)) return false;
  return outcome.residualN <= kStudyResidualTolerance * applied;
}

}  // namespace forge::ui
