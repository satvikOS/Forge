// forge-desktop/src/ModelQuality.hpp
//
// THE MEASUREMENTS BEHIND THE "IS THIS PART ACTUALLY GOOD?" PANELS.
//
// Five tabs in the shipped workspaces — Interference, Verification, Continuity,
// Draft and Zebra — are the ones a mechanical engineer opens when they are about
// to TRUST a model. Every number in this struct is produced by a real
// forge-kernel query on the real compiled solid; nothing here is derived from a
// layout, a default or a guess, and every field that could not be measured says
// so with its own `*Measured` flag rather than reporting a zero that reads like
// an answer.
//
// ── which query fills which field, by name ─────────────────────────────────
//   forge::shapecheck::analyse        shapeValid, faultyCount, faults
//   forge::heal::checkValidity        closed / manifold / oriented /
//                                     selfIntersect / nonManifoldEdge, badFaces,
//                                     badEdges
//   forge::massProperties             volume, area, com  (and per solid)
//   forge::topologySignature          genus, shells, topoV/E/F
//   forge::direct::faceCount/edgeCount  faceCount, edgeCount
//   forge::detectInterference         clashes (pair + overlap volume)
//   forge::common + massProperties    the overlap's own volume and centre —
//                                     a SECOND instrument on the same clash
//   forge::classa::continuityCheck    joins (g0 mm, g1 deg, g2 %)
//   forge::mold::analyseDraft         draft (per-face angle and verdict)
//   forge::classa::zebraStripes       zebra (per-face stripe samples)
//   forge::faceInventory              the face KIND beside each draft row
//
// ── what is deliberately NOT here ─────────────────────────────────────────
// The Class-A continuity check also returns a g3 term. forge/ClassASurfacing.hpp
// states, with the measurement, that it is identically zero for every join
// including a 40x curvature jump, because it projects the SHARED EDGE's tangent
// onto two normals it is perpendicular to by construction. A column that is zero
// whatever the geometry does is worse than an absent one, so it is absent.
//
// ── no kernel type crosses this header ────────────────────────────────────
// A ShapeHandle is a plain 32-bit id (forge/ShapeRegistry.hpp says so), so the
// entry point below takes one without this file including a kernel or an OCCT
// header. That is what lets the frame builder, which may see neither, hold the
// answers; ModelQuality.cpp is the only translation unit here that runs them.
#ifndef FORGE_DESKTOP_MODELQUALITY_HPP
#define FORGE_DESKTOP_MODELQUALITY_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::desktop {

// One solid in the model. A part file usually holds exactly one; a STEP file of
// an assembly holds several, and THAT is when a clash can exist at all.
struct QualitySolid {
  int index = 0;  // 1-based, in the model's own solid order
  double volume = 0.0;
  double area = 0.0;
  double com[3] = {0.0, 0.0, 0.0};
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  bool measured = false;
};

// Two solids that occupy the same space.
struct QualityClash {
  int solidA = 0;
  int solidB = 0;
  // The kernel's interference query's own answer, in mm^3.
  double volume = 0.0;
  // The overlap re-measured as a solid in its own right. Two instruments, one
  // clash: a disagreement is visible instead of averaged away.
  double commonVolume = 0.0;
  double com[3] = {0.0, 0.0, 0.0};
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  bool located = false;  // the overlap solid was built and measured
};

// How two faces meet along the edge they share.
struct QualityJoin {
  int faceA = 0;
  int faceB = 0;
  double g0mm = 0.0;    // largest gap between the two surfaces, mm
  double g1deg = 0.0;   // largest angle between their surface normals, degrees
  double g2pct = 0.0;   // largest curvature step across the join, percent
  std::uint32_t samples = 0;
  bool measured = false;
};

// Where one face stands relative to the pull direction.
enum class DraftVerdict : std::uint8_t {
  Releases = 0,  // the mould can pull away from this face
  Undercut = 1,  // it holds the part in; a side action is needed
  Vertical = 2,  // it stands along the pull, with no draft either way
};

struct QualityDraftFace {
  int face = 0;
  std::string kind;  // plane, cylinder, cone, sphere, torus, ... from the kernel
  double area = 0.0;
  double angleDeg = 0.0;  // angle between the face normal and the pull direction
  DraftVerdict verdict = DraftVerdict::Vertical;
  // ── WHY THIS FLAG EXISTS, AND WHAT IT SAVES THE READER FROM ─────────────
  // The mould pass samples ONE normal per face, at the face's own parametric
  // centre (forge/Mold.hpp says so). On a FLAT face that single sample IS the
  // face. On a curved one it is a single point on a surface whose angle to the
  // pull direction changes continuously across it -- measured on the
  // application's own default part pulled along +X, the through bore reports
  // 0.000 degrees, which is true at the sampled point and true nowhere else on
  // that wall. A panel that printed the two side by side with no distinction
  // would be handing a reader a number that looks like a verdict on the whole
  // face and is not one.
  //
  // `flat` is MEASURED, not inferred from the surface's name: the kernel's face
  // inventory calls four of that part's flat walls "other", so testing the name
  // would mark a flat face curved. It is true when the face's Gaussian AND mean
  // curvature are zero at every point sampled across it.
  bool flat = false;
  bool curvatureMeasured = false;  // false when the curvature pass declined
};

// The stripe pattern over one face, laid out across the face's own surface.
struct QualityZebraFace {
  int face = 0;
  std::uint32_t gridW = 0;
  std::uint32_t gridH = 0;
  std::uint32_t bands = 0;  // how many different stripes cross this face
  std::vector<std::uint8_t> stripes;  // gridW * gridH, row major
};

// What one run of the check produced.
struct ModelQualityReport {
  bool ran = false;
  // Present exactly when `ran` is false: one sentence, addressed to the person
  // who asked for the check, saying why there is nothing to show.
  std::string unavailable;

  // ── the settings the run actually used ──────────────────────────────────
  double pull[3] = {0.0, 0.0, 1.0};
  double draftThresholdDeg = 3.0;
  double light[3] = {0.3, 0.4, 0.86};
  std::uint32_t stripeCount = 8;
  double clashTolerance = 0.0;

  // ── verification ────────────────────────────────────────────────────────
  bool checkedShape = false;
  bool shapeValid = false;
  long faultyCount = 0;
  std::vector<std::string> faults;

  bool checkedClosure = false;
  bool closed = false;
  bool manifold = false;
  bool oriented = false;
  bool selfIntersecting = false;
  bool nonManifoldEdge = false;
  std::size_t badFaces = 0;
  std::size_t badEdges = 0;

  bool checkedMass = false;
  double volume = 0.0;
  double area = 0.0;
  double com[3] = {0.0, 0.0, 0.0};

  bool checkedBox = false;
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};

  bool checkedCounts = false;
  long faceCount = 0;
  long edgeCount = 0;

  bool checkedTopology = false;
  long genus = 0;
  long shells = 0;
  long topoVertices = 0;
  long topoEdges = 0;
  long topoFaces = 0;

  // ── interference ────────────────────────────────────────────────────────
  bool checkedClashes = false;
  std::vector<QualitySolid> solids;
  std::vector<QualityClash> clashes;

  // ── continuity ──────────────────────────────────────────────────────────
  bool checkedContinuity = false;
  std::size_t sharedEdges = 0;  // edges with a face on each side
  std::vector<QualityJoin> joins;
  bool continuityCapped = false;

  // ── draft ───────────────────────────────────────────────────────────────
  bool checkedDraft = false;
  std::vector<QualityDraftFace> draft;
  std::size_t releasing = 0;
  std::size_t undercutting = 0;
  std::size_t standingVertical = 0;

  // ── zebra ───────────────────────────────────────────────────────────────
  bool checkedZebra = false;
  std::vector<QualityZebraFace> zebra;
  bool zebraCapped = false;
};

// The settings one run is asked for. Held apart from the report so a caller can
// change the pull direction and re-run without editing an answer.
struct QualitySettings {
  double pull[3] = {0.0, 0.0, 1.0};
  double draftThresholdDeg = 3.0;
  double light[3] = {0.3, 0.4, 0.86};
  std::uint32_t stripeCount = 8;
  double clashTolerance = 0.0;
};

// ── the caps, and why there are any ────────────────────────────────────────
// The continuity check projects a point onto two surfaces at every sample of
// every shared edge, and the stripe pass evaluates a normal per grid cell per
// face. Both are proportional to the model, and a 4,000-face import would make
// the check take longer than a person will wait. Reaching a cap is REPORTED
// (`continuityCapped` / `zebraCapped`) rather than silently truncating a list —
// a shortened answer that does not say it is shortened is a wrong answer.
inline constexpr std::size_t kQualityMaxJoins = 600;
inline constexpr std::size_t kQualityMaxZebraFaces = 64;
inline constexpr std::uint32_t kQualityZebraGrid = 20;
inline constexpr std::uint32_t kQualityContinuitySamples = 16;

// ── the entry point ────────────────────────────────────────────────────────
// `shapeHandle` is a forge::ShapeHandle for a compiled solid. Runs every query
// above and returns what each one answered. Never throws: a query that fails
// leaves its own `checked*` flag false, and the others still run — one refusing
// kernel call must not blank four panels.
ModelQualityReport analyseSolidQuality(std::uint32_t shapeHandle,
                                       const QualitySettings& settings);

// ── across the worker boundary ─────────────────────────────────────────────
// The check runs OCCT code on paths the kernel's own reports record faulting on,
// so the application runs it in the isolated worker exactly as it runs a build.
// Text, not a binary frame: the payload is a few tens of kilobytes at the caps
// above, and a format a person can read in a terminal is worth more here than
// the bytes it costs.
std::string encodeQualityReport(const ModelQualityReport& report);
bool decodeQualityReport(const std::string& payload, ModelQualityReport& out,
                         std::string& failure);

// The first line of an encoded report, and the pragma that asks for one.
inline constexpr const char* kQualityResultMagic = "FORGE-QUALITY-RESULT 1";
inline constexpr const char* kWorkerAnalysePragma = "#!forge-worker-analyse ";

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_MODELQUALITY_HPP
