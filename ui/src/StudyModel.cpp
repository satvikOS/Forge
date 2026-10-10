#include "forge/ui/StudyModel.hpp"

#include <algorithm>
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

struct ThermalRow {
  const char* id;
  double conductivityWPerMK;
};

// Nominal room-temperature thermal conductivity, W/(m K), keyed on the same ids
// and sorted the same way. Typical handbook values for the alloy or polymer
// family (wrought alloys in their usual temper); like the elastic constants,
// conductivity moves by a few per cent with temper and lot, which is the
// accuracy a design-stage conduction study can claim and no more.
constexpr ThermalRow kThermal[] = {
    {"abs", 0.17},
    {"aluminium-6061", 167.0},
    {"aluminium-7075", 130.0},
    {"brass-c360", 115.0},
    {"bronze-c932", 58.2},
    {"cast-iron-grey", 46.0},
    {"copper-c110", 388.0},
    {"hdpe", 0.48},
    {"magnesium-az31", 96.0},
    {"nylon-66", 0.25},
    {"peek", 0.25},
    {"pla", 0.13},
    {"polycarbonate", 0.20},
    {"pom-acetal", 0.31},
    {"ptfe", 0.25},
    {"stainless-304", 16.2},
    {"stainless-316", 16.3},
    {"steel-1018", 51.9},
    {"steel-4140", 42.6},
    {"titanium-ti6al4v", 6.7},
};

std::string materialLabel(const StudyDefinition& study) {
  return study.materialName.empty() ? study.materialId : study.materialName;
}

bool divisionsInRange(const StudyDefinition& study) {
  return study.divisions >= kMinStudyDivisions && study.divisions <= kMaxStudyDivisions;
}

std::string divisionsSentence() {
  return "The number of elements across the part must be between " +
         std::to_string(kMinStudyDivisions) + " and " + std::to_string(kMaxStudyDivisions) + ".";
}

// The refusals a held-part study (Static, Modal) shares.
std::string restraintBlocker(const StudyDefinition& study) {
  if (study.restraints.empty()) {
    return study.kind == StudyKind::Modal
               ? "Add a restraint. This study finds how a held part vibrates, and a part held "
                 "nowhere would only drift."
               : "Add a restraint. Until one side is held, the part is free to drift and there is "
                 "no answer to find.";
  }
  bool anyHold = false;
  for (const Restraint& r : study.restraints) {
    if (r.holdsAnything()) anyHold = true;
  }
  if (!anyHold) {
    return "Every restraint on this study holds nothing. Tick at least one direction on one of "
           "them, or the part is still free to drift.";
  }
  return std::string();
}

std::string modalBlocker(const StudyDefinition& study) {
  if (elasticPropertiesFor(study.materialId) == nullptr) {
    return "Forge does not carry stiffness figures for " + materialLabel(study) +
           ", so it cannot say how this part would vibrate. Pick a material it does carry.";
  }
  if (!(study.densityKgPerM3 > 0.0) || !std::isfinite(study.densityKgPerM3)) {
    return "Forge does not carry a density for " + materialLabel(study) +
           ", and how fast a part vibrates depends on its weight. Pick a material it does carry.";
  }
  const std::string held = restraintBlocker(study);
  if (!held.empty()) return held;
  if (study.modeCount < kMinStudyModes || study.modeCount > kMaxStudyModes) {
    return "Ask for between " + std::to_string(kMinStudyModes) + " and " +
           std::to_string(kMaxStudyModes) + " natural frequencies.";
  }
  if (!divisionsInRange(study)) return divisionsSentence();
  return std::string();
}

std::string thermalBlocker(const StudyDefinition& study) {
  if (thermalPropertiesFor(study.materialId) == nullptr) {
    return "Forge does not carry a heat conductivity for " + materialLabel(study) +
           ", so it cannot say how heat moves through this part. Pick a material it does carry.";
  }
  if (study.temperatures.empty()) {
    return "Hold at least one side at a fixed temperature. Without one, heat has nowhere to go "
           "and the part has no steady temperature to find.";
  }
  for (const FixedTemperature& t : study.temperatures) {
    if (!std::isfinite(t.temperatureC) || !(t.temperatureC > kAbsoluteZeroC)) {
      return "Every held temperature must be above absolute zero, which is -273.15 C.";
    }
  }
  if (!std::isfinite(study.heatGeneratedW)) {
    return "The heat generated inside the part must be a number of watts.";
  }
  if (!divisionsInRange(study)) return divisionsSentence();
  return std::string();
}

}  // namespace

// ── what the study asks ─────────────────────────────────────────────────────
const std::vector<StudyKind>& allStudyKinds() {
  static const std::vector<StudyKind> kAll = {StudyKind::Static, StudyKind::Modal,
                                              StudyKind::Thermal};
  return kAll;
}

const char* studyKindName(StudyKind kind) noexcept {
  switch (kind) {
    case StudyKind::Static: return "Stress under load";
    case StudyKind::Modal: return "Natural frequencies";
    case StudyKind::Thermal: return "Steady heat conduction";
  }
  return "Stress under load";
}

const char* studyKindQuestion(StudyKind kind) noexcept {
  switch (kind) {
    case StudyKind::Static:
      return "How far the part moves, and how hard it is stressed, under a steady push.";
    case StudyKind::Modal:
      return "The frequencies the part rings at when it is held as the restraints say, and the "
             "shape it moves in at each one.";
    case StudyKind::Thermal:
      return "The steady temperature everywhere in the part when some of its sides are held at "
             "fixed temperatures, and the heat that flows through each of them.";
  }
  return "";
}

std::string FixedTemperature::describe() const {
  return "held at " + number(temperatureC, 1) + " C";
}

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

// ── the material's thermal conductivity ─────────────────────────────────────
const ThermalProperties* thermalPropertiesFor(const std::string& materialId) {
  static const std::vector<ThermalProperties> kValues = [] {
    std::vector<ThermalProperties> v;
    v.reserve(sizeof(kThermal) / sizeof(kThermal[0]));
    for (const ThermalRow& row : kThermal) {
      ThermalProperties p;
      p.conductivityWPerMK = row.conductivityWPerMK;
      v.push_back(p);
    }
    return v;
  }();
  for (std::size_t i = 0; i < kValues.size(); ++i) {
    if (materialId == kThermal[i].id) return &kValues[i];
  }
  return nullptr;
}

std::size_t thermalPropertyCount() { return sizeof(kThermal) / sizeof(kThermal[0]); }

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
    switch (study.kind) {
      case StudyKind::Modal:
        return "Choose a material for this part first. How fast it vibrates depends on what it "
               "is made of, so the study cannot answer until one is picked.";
      case StudyKind::Thermal:
        return "Choose a material for this part first. How heat moves through it depends on what "
               "it is made of, so the study cannot answer until one is picked.";
      case StudyKind::Static:
        break;
    }
    return "Choose a material for this part first. How far it bends is a property of what it "
           "is made of, so the study cannot answer until one is picked.";
  }
  if (study.kind == StudyKind::Modal) return modalBlocker(study);
  if (study.kind == StudyKind::Thermal) return thermalBlocker(study);

  if (elasticPropertiesFor(study.materialId) == nullptr) {
    return "Forge does not carry stiffness figures for " + materialLabel(study) +
           ", so it cannot say how far this part would bend. Pick a material it does carry.";
  }
  const std::string held = restraintBlocker(study);
  if (!held.empty()) return held;
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
  if (!divisionsInRange(study)) return divisionsSentence();
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

bool thermalBalanced(const StudyOutcome& outcome) noexcept {
  if (!outcome.solved || outcome.kind != StudyKind::Thermal) return false;
  // The scale is the largest heat flow through the part: the biggest side flow
  // or the heat generated, whichever is larger -- but never below a microwatt.
  // A part held at one temperature everywhere and generating nothing carries no
  // heat, and its reactions are round-off (each node's row of K sums to zero
  // only to about 1e-16 of its diagonal); judged against their own size they
  // would never balance. A microwatt is far below any heat a part in this
  // application conducts, so it is the floor the round-off is judged against.
  double scale = std::max(std::fabs(outcome.heatGeneratedW), kThermalFlowFloorW);
  for (const SideHeatFlow& f : outcome.heatFlows) scale = std::max(scale, std::fabs(f.heatInW));
  if (!std::isfinite(scale) || !std::isfinite(outcome.heatImbalanceW) ||
      !std::isfinite(outcome.maxResidualW)) {
    return false;
  }
  return std::fabs(outcome.heatImbalanceW) <= kThermalBalanceTolerance * scale &&
         outcome.maxResidualW <= kThermalBalanceTolerance * scale;
}

}  // namespace forge::ui
