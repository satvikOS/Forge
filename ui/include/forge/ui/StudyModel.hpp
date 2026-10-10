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

#include "forge/ui/StudyField.hpp"

namespace forge::ui {

// ── what the study asks ─────────────────────────────────────────────────────
// ONE study, three questions. They share the part, the mesh, the material and
// the sides a user can name; they differ in what is held, what is applied and
// what comes back, and every one of them goes through the same seam
// (forge::desktop::runStudy) so there is no second pipeline to drift.
//
//   Static   how far the part moves and how hard it is stressed under a steady
//            push (restraints + forces -> displacement, stress).
//   Modal    the frequencies the part rings at when it is held as the
//            restraints say, and the shape it moves in at each one (restraints
//            -> natural frequencies, mode shapes; forces are not used).
//   Thermal  the steady temperature everywhere in the part when some sides are
//            held at fixed temperatures and, optionally, heat is generated
//            evenly through it (fixed temperatures + heat -> temperature field,
//            the heat that flows through each held side).
enum class StudyKind : std::uint8_t {
  Static = 0,
  Modal = 1,
  Thermal = 2,
};

// All three, in this order, so a picker and a gate walk one list.
const std::vector<StudyKind>& allStudyKinds();
// What the user reads in the picker: "Stress under load" and so on.
const char* studyKindName(StudyKind kind) noexcept;
// One sentence saying what that study answers, for the panel.
const char* studyKindQuestion(StudyKind kind) noexcept;

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

// ── a side held at a fixed temperature ──────────────────────────────────────
// For a Thermal study. The temperature is in degrees Celsius. A steady
// conduction field depends only on DIFFERENCES of temperature, so Celsius and
// kelvin give the same field shifted by 273.15; Celsius is what a user types.
inline constexpr double kAbsoluteZeroC = -273.15;
struct FixedTemperature {
  StudyFace face = StudyFace::MinX;
  double temperatureC = 20.0;

  // "held at 100.0 C" -- for the panel.
  std::string describe() const;
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

// ── the material's thermal conductivity ─────────────────────────────────────
// Nominal room-temperature handbook values in W/(m K), keyed on the same ids. A
// material with no entry cannot be given a Thermal study, for the reason the
// elastic table states: no number is substituted.
struct ThermalProperties {
  double conductivityWPerMK = 0.0;
};
const ThermalProperties* thermalPropertiesFor(const std::string& materialId);
std::size_t thermalPropertyCount();

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

  // Which question is asked. Static is the default, so a study set up before
  // the other two existed means what it always meant.
  StudyKind kind = StudyKind::Static;
  // Modal: how many of the lowest natural frequencies to find.
  int modeCount = 6;
  // Thermal: the sides held at fixed temperatures, and the total heat generated
  // evenly through the part's volume, in watts (0 for none).
  std::vector<FixedTemperature> temperatures;
  double heatGeneratedW = 0.0;

  double totalLoadN() const noexcept;
};

inline constexpr int kMinStudyDivisions = 4;
inline constexpr int kMaxStudyDivisions = 40;
inline constexpr int kMinStudyModes = 1;
inline constexpr int kMaxStudyModes = 12;

// What stops this study from being answerable, as a sentence addressed to the
// person. Empty when it can run. `hasBody` is false when no part is built yet.
// Asks the questions of the study's OWN kind: a modal study needs no force and a
// thermal one needs no restraint.
std::string studyBlocker(const StudyDefinition& study, bool hasBody);

// ── what the mesh turned out to hold ────────────────────────────────────────
// One row per side a restraint or a load names, filled from the mesh the solver
// actually built. `meshNodes` is a count of real nodes, never an estimate.
struct FaceCensus {
  StudyFace face = StudyFace::MinX;
  std::size_t meshNodes = 0;
  double planeMm = 0.0;  // where that side of the bounding box is
};

// ── one natural mode ────────────────────────────────────────────────────────
struct NaturalMode {
  double frequencyHz = 0.0;
  double eigenvalue = 0.0;  // omega^2, rad^2/s^2, as the solver returned it
  std::uint32_t peakNode = 0;  // the mesh node that moves furthest
  ModeMotion motion;           // what the mode does, read off its own shape
};

// ── the heat through one held side ──────────────────────────────────────────
struct SideHeatFlow {
  StudyFace face = StudyFace::MinX;
  double temperatureC = 0.0;
  std::size_t meshNodes = 0;  // the nodes this side actually held
  // Heat flowing INTO the part through this side, in watts: the sum of the
  // nodal reactions K T - f over the nodes it held. Negative is heat leaving.
  double heatInW = 0.0;
};

// ── the answer ──────────────────────────────────────────────────────────────
struct StudyOutcome {
  bool solved = false;
  // Why not, in the user's words. Empty iff solved.
  std::string blocker;
  // Which question this answers. Filled in before anything can refuse, so a
  // refusal is still known to belong to the study that was asked.
  StudyKind kind = StudyKind::Static;

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

  // ── the volume the mesh fills, beside the part's own ──────────────────────
  // The mesh is bricks; a part that is not a box is approximated by a
  // staircase of them. Both numbers are reported so the difference is visible.
  double meshVolumeMm3 = 0.0;
  double partVolumeMm3 = 0.0;

  // ── Modal ─────────────────────────────────────────────────────────────────
  int modesRequested = 0;
  // When a Modal study is refused because its mesh lands where the solver is
  // slow: the nearest element count across the part that does not, or 0.
  int suggestedDivisions = 0;
  double meshMassKg = 0.0;  // mesh volume x density: the mass that vibrates
  std::vector<NaturalMode> modes;  // lowest first
  // One shape per mode, 3 values per mesh node, scaled so the furthest-moving
  // node moves exactly 1 (normaliseModeShape).
  std::vector<std::vector<double>> modeShapes;

  // ── Thermal ───────────────────────────────────────────────────────────────
  double conductivityWPerMK = 0.0;
  std::vector<FaceCensus> temperatureCensus;  // one per fixed-temperature row
  std::vector<SideHeatFlow> heatFlows;        // one per side that held nodes
  std::size_t heldNodes = 0;        // nodes given a fixed temperature
  // Nodes a LATER row also reached at a different temperature: where two held
  // sides meet, the row listed first keeps the node (StudyHost.hpp).
  std::size_t sharedHeldNodes = 0;
  double heatGeneratedW = 0.0;      // what was assembled into the part
  // sum of heatFlows[].heatInW + heatGeneratedW: what is not accounted for.
  double heatImbalanceW = 0.0;
  // largest |K T - f| at a node whose temperature was NOT fixed, W
  double maxResidualW = 0.0;
  double minTemperatureC = 0.0;
  double maxTemperatureC = 0.0;
  std::uint32_t coldestNode = 0;
  std::uint32_t hottestNode = 0;
  double maxHeatFluxWPerM2 = 0.0;  // largest element heat-flux density
  std::vector<double> nodeTemperatureC;  // one per mesh node

  // ── what to draw ──────────────────────────────────────────────────────────
  // The outside of the mesh the study was solved on (Modal and Thermal).
  StudySurface surface;

  const FaceCensus* censusFor(StudyFace face) const;
};

// The magnitude of the force the solver actually assembled.
double appliedForceMagnitudeN(const StudyOutcome& outcome) noexcept;

// Whether the linear system was solved to a force that is negligible beside the
// one applied. The comparison is RELATIVE, because an absolute newton tolerance
// means one thing on a 5 N load and another on a 50 kN one.
inline constexpr double kStudyResidualTolerance = 1.0e-6;
bool studyConverged(const StudyOutcome& outcome) noexcept;

// Whether a Thermal answer balances: the heat that is not accounted for, and the
// largest out-of-balance at a free node, are both negligible beside the largest
// heat flow through the part. Relative, for the same reason as above.
// The scale never falls below kThermalFlowFloorW, so a part that conducts
// nothing (one temperature everywhere) is judged on its round-off, not on 0.
inline constexpr double kThermalBalanceTolerance = 1.0e-6;
inline constexpr double kThermalFlowFloorW = 1.0e-6;
bool thermalBalanced(const StudyOutcome& outcome) noexcept;

}  // namespace forge::ui

#endif  // FORGE_UI_STUDYMODEL_HPP
