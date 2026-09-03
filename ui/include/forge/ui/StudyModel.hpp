// ui/include/forge/ui/StudyModel.hpp
//
// THE SIMULATION STUDY — what is holding the part, what is pushing on it, and
// what the solver actually answered.
//
// It is here, and not in forge-desktop, for the same reason MeasureModel is:
// a study is arithmetic and bookkeeping, not drawing, and a number a panel
// prints is only trustworthy if something headless can assert it. Nothing in
// this file includes ImGui, the geometry kernel or the solver — the frame
// builder fills a StudyDefinition in, hands it to the one translation unit that
// may see the kernel, and prints the StudyOutcome that comes back.
//
// ── WHERE A RESTRAINT OR A LOAD IS ALLOWED TO SIT, AND WHY ──────────────────
// A restraint is applied to one of the six planar sides of the part's bounding
// box, and NOT to an arbitrary picked face. That is not a simplification chosen
// for convenience — it is the node set the solver's own mesher can name. The
// mesh it returns carries, per node, a bitfield of the bounding-box sides that
// node lies on, and that bitfield is the ONLY mapping from the shape to the mesh
// the kernel produces. Selecting a B-rep face would mean inventing a second
// mapping and hoping the two agree; a study whose restraint sits on a set of
// nodes nobody can enumerate is a study whose answer nobody can check.
//
// StudyFace's numbering is therefore not ours to choose: it is the mesher's, and
// the two are pinned equal by the gate rather than kept equal by memory.
//
// ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
// No strength number, and so no safety factor. A stress the solver computed is a
// measurement; a yield strength is a property of a heat treatment the document
// does not record, and "Alloy Steel 4140" is 415 MPa annealed and 655 MPa
// quenched and tempered. Printing one of those beside a computed stress would
// put a made-up number where a user reads a verdict. Young's modulus and
// Poisson's ratio are carried instead, because those two barely move with
// temper: they are a property of the alloy, which the document does record.
#ifndef FORGE_UI_STUDYMODEL_HPP
#define FORGE_UI_STUDYMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// ── the six sides of the part ───────────────────────────────────────────────
// The order IS the mesher's bit order. Do not reorder.
enum class StudyFace : std::uint8_t {
  MinX = 0,
  MaxX = 1,
  MinY = 2,
  MaxY = 3,
  MinZ = 4,
  MaxZ = 5,
};

inline constexpr std::size_t kStudyFaceCount = 6;

// All six, in bit order, so a picker and the solver walk one list.
const std::vector<StudyFace>& allStudyFaces();

// What the user reads: "Left side (-X)", "Top (+Z)" and so on.
const char* studyFaceName(StudyFace face) noexcept;
// Which bit of the mesh's per-node side bitfield this side is.
std::uint32_t studyFaceBit(StudyFace face) noexcept;
// 0 = X, 1 = Y, 2 = Z.
int studyFaceAxis(StudyFace face) noexcept;
// True for the side at the HIGH end of its axis.
bool studyFaceIsMax(StudyFace face) noexcept;

// ── a restraint ─────────────────────────────────────────────────────────────
// Which side is held, and in which directions. Holding all three is a fixed
// support; holding one is a roller / symmetry plane.
struct Restraint {
  StudyFace face = StudyFace::MinX;
  bool holdX = true;
  bool holdY = true;
  bool holdZ = true;

  int heldDirections() const noexcept;
  bool holdsAnything() const noexcept { return heldDirections() > 0; }
  // "held in all three directions" / "held along X and Z" — for the panel.
  std::string describeHold() const;
};

// ── a load ──────────────────────────────────────────────────────────────────
// A TOTAL force in newtons, spread over the mesh nodes on one side. The total
// is what the user types and what the solver assembles; the per-node share is
// reported after a solve rather than assumed, because how many nodes a side
// carries depends on the mesh the solver actually built.
struct Load {
  StudyFace face = StudyFace::MaxX;
  double fx = 0.0;
  double fy = 0.0;
  double fz = 0.0;

  double magnitudeN() const noexcept;
  bool isZero() const noexcept;
  // "120.0 N downwards" / "85.0 N at (0.6, 0.0, -0.8)" — for the panel.
  std::string describeDirection() const;
};

// ── the material's elastic constants ────────────────────────────────────────
// Nominal handbook values at room temperature, keyed on the SAME material ids
// materialLibrary() defines. A material with no entry here is REPRESENTED as
// having none: the study refuses to run and says which material it cannot
// stretch, rather than substituting a number.
struct ElasticProperties {
  double youngsModulusPa = 0.0;
  double poissonRatio = 0.0;
};
// Null when this build carries no elastic constants for that material.
const ElasticProperties* elasticPropertiesFor(const std::string& materialId);
// How many materials carry them, so a gate can assert the table is populated.
std::size_t elasticPropertyCount();

// ── the study ───────────────────────────────────────────────────────────────
// Everything the solver is given. The material fields are COPIED OUT of the open
// document rather than looked up again at solve time, for the reason
// Material.hpp already gives: a table is a picker, not an authority.
struct StudyDefinition {
  std::string materialId;
  std::string materialName;
  double densityKgPerM3 = 0.0;
  // How many elements the mesher is asked to lay across the part's LONGEST side.
  // A count rather than a length, so the one number a user sets means the same
  // thing on an 8 mm part and an 800 mm one.
  int divisions = 12;
  std::vector<Restraint> restraints;
  std::vector<Load> loads;

  double totalLoadN() const noexcept;
};

inline constexpr int kMinStudyDivisions = 4;
inline constexpr int kMaxStudyDivisions = 40;

// What stops this study from being answerable, as a sentence addressed to the
// person. Empty when it can run. `hasBody` is false when no part is built yet.
std::string studyBlocker(const StudyDefinition& study, bool hasBody);

// ── what the mesh turned out to hold ────────────────────────────────────────
// One row per side a restraint or a load names, filled from the mesh the solver
// actually built. `meshNodes` is a count of real nodes, never an estimate.
struct FaceCensus {
  StudyFace face = StudyFace::MinX;
  std::size_t meshNodes = 0;
  double planeMm = 0.0;  // where that side of the bounding box is
};

// ── the answer ──────────────────────────────────────────────────────────────
struct StudyOutcome {
  bool solved = false;
  // Why not, in the user's words. Empty iff solved.
  std::string blocker;

  // the mesh the solver used
  double elementSizeMm = 0.0;
  std::size_t meshNodes = 0;
  std::size_t meshElements = 0;
  std::size_t freedoms = 0;      // three per node
  std::size_t heldFreedoms = 0;  // removed by the restraints
  std::size_t loadedNodes = 0;

  // the load it assembled, summed over every node it reached
  double appliedForceN[3] = {0.0, 0.0, 0.0};

  // the answer
  double residualN = 0.0;
  double maxDisplacementMm = 0.0;
  std::uint32_t maxDisplacementNode = 0;
  double maxStressMPa = 0.0;
  std::uint32_t maxStressElement = 0;
  double solveMs = 0.0;

  // the constants it stretched the part with
  double youngsModulusPa = 0.0;
  double poissonRatio = 0.0;
  double densityKgPerM3 = 0.0;

  std::vector<FaceCensus> restraintCensus;
  std::vector<FaceCensus> loadCensus;

  const FaceCensus* censusFor(StudyFace face) const;
};

// The magnitude of the force the solver actually assembled.
double appliedForceMagnitudeN(const StudyOutcome& outcome) noexcept;

// Whether the linear system was solved to a force that is negligible beside the
// one applied. The comparison is RELATIVE, because an absolute newton tolerance
// means one thing on a 5 N load and another on a 50 kN one.
inline constexpr double kStudyResidualTolerance = 1.0e-6;
bool studyConverged(const StudyOutcome& outcome) noexcept;

}  // namespace forge::ui

#endif  // FORGE_UI_STUDYMODEL_HPP
