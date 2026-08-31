// ui/include/forge/ui/ShapeReport.hpp
//
// WHAT THE VERIFIER ALREADY KNOWS, MADE REACHABLE IN THE APP.
//
// forge-kernel/src/tools/forge_verify.cpp measures a built solid and prints
// volume, faceCount, edgeCount, vertexCount, genus, shellCount, the bounding
// box, a PER-FACE census with kinds, and a `bores` array keyed on each hole's
// axis line. Every one of those numbers already existed, and NONE of them
// reached a user: forge::desktop::IrBuildReport carried five of them (valid,
// faceCount, edgeCount, volume, bbox) and the app printed those; genus,
// shellCount, vertexCount, the face census and the bore list were computed by
// the verifier for the corpus and thrown away by the application.
//
// This is the app-side model of the WHOLE thing. It is a value type with no
// kernel headers, no ImGui and no I/O, so:
//
//   * forge::desktop::KernelScene — the one translation unit that sees OCCT —
//     fills it from forge::massProperties / forge::topologySignature /
//     forge::faceInventory, and nothing else in the app needs a kernel header;
//   * every query over it (the kind histogram, "which is the LARGEST bore",
//     the census filter a 430-face part needs to be readable at all) is
//     arithmetic a headless gate asserts;
//   * the export is the same JSON schema forge_verify prints, so a number
//     copied out of the app and a number measured by the verifier are
//     comparable by `diff` rather than by eye.
//
// ── the schema is the verifier's, deliberately ──────────────────────────────
// Field names, the bore key (a canonical axis DIRECTION plus the axis' foot —
// its closest point to the origin) and the face-census entries are spelled the
// way forge_verify spells them. A second spelling of "how many holes does this
// part have" is how two measurements of one part come to disagree, and this
// programme has already paid for that once: the compiler's VERIFY "holes="
// counter and the verifier's `bores` array used different keys, and a
// cross-drilled part came back as 1 hole from one and 2 from the other.
//
// ── what "measured" means, and why it is not a bool per field ───────────────
// A field is either measured or it is NOT PRESENT. The counts default to -1
// (`kUnmeasuredCount`), never to 0: a part with genus 0 and a part whose
// topology could not be measured are different facts, and printing "genus 0"
// for the second is a fabricated number. `boresDegraded` carries the same
// discipline for the hole list — forge_verify falls back to the old
// concave-cylinder rule when point-in-solid declines, and says so, so the app
// says so too instead of showing an over-count as a measurement.
#ifndef FORGE_UI_SHAPEREPORT_HPP
#define FORGE_UI_SHAPEREPORT_HPP

#include <cstddef>
#include <string>
#include <vector>

namespace forge::ui {

// A count that was NOT measured. Chosen negative so it can never be mistaken
// for a real census: no shape has -1 faces.
inline constexpr long kUnmeasuredCount = -1;

// ── one B-rep face, as forge::faceInventory reports it ──────────────────────
// `kind` is the kernel's own spelling — plane, cylinder, cone, sphere, torus,
// bspline, bezier, revolution, other — kept as a string rather than an enum
// because the kernel may add a surface type, and an enum here would turn that
// into a face the app cannot name.
struct FaceCensusEntry {
  int index = 0;  // 1-based, into the shape's face map — the id the viewport picks by
  std::string kind;
  double area = 0.0;
  double centroid[3] = {0.0, 0.0, 0.0};
  // plane: the outward normal (orientation-corrected).
  // cylinder / cone / torus: the surface axis direction.
  double direction[3] = {0.0, 0.0, 0.0};
  double axisLocation[3] = {0.0, 0.0, 0.0};  // a point on that axis
  double radius = 0.0;       // cylinder / cone / sphere; torus: the MAJOR radius
  double minorRadius = 0.0;  // torus only: the blend radius
  double vMin = 0.0;         // cylinder: the parametric extent along the axis,
  double vMax = 0.0;         //           i.e. the bore's length span
  // True when material lies OUTSIDE the surface: a bore, a hole, a concave
  // blend. False for a boss, a shaft, a convex fillet.
  bool concave = false;

  bool hasRadius() const noexcept;
  bool hasAxis() const noexcept;
  double diameter() const noexcept { return 2.0 * radius; }
  // The axial length of a cylindrical wall, vMax - vMin, or 0 when the face is
  // not one. Named rather than left to the caller because vMin/vMax are
  // PARAMETRIC and only equal a length for a cylinder.
  double axialSpan() const noexcept;
};

// ── one HOLE ────────────────────────────────────────────────────────────────
// One entry is one hole, keyed on its AXIS LINE: a wall split at a seam, across
// the air gap of a clevis, or into pilot + counterbore is still ONE hole.
struct BoreEntry {
  double at[3] = {0.0, 0.0, 0.0};    // the axis' closest point to the origin
  double axis[3] = {0.0, 0.0, 1.0};  // canonical direction (largest component +ve)
  double radius = 0.0;               // the SMALLEST radius on the axis — the pilot
  double span = 0.0;                 // total axial length of cylindrical wall
  int faces = 0;                     // how many cylindrical faces make up the wall

  double diameter() const noexcept { return 2.0 * radius; }
};

// ── the whole measurement ───────────────────────────────────────────────────
struct ShapeReport {
  // There is a body and the fields below were taken from it. False means the
  // tree did not build; `error` then says why and every number stays unmeasured.
  bool measured = false;
  bool valid = false;  // watertight / manifold / oriented, as the kernel judges

  double volume = 0.0;
  double surfaceArea = 0.0;  // summed face areas; 0 when the census is absent

  long faceCount = kUnmeasuredCount;
  long edgeCount = kUnmeasuredCount;
  long vertexCount = kUnmeasuredCount;
  long genus = kUnmeasuredCount;
  long shellCount = kUnmeasuredCount;

  bool bboxValid = false;
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};

  // The volume centroid, from forge::massProperties. It has its OWN presence
  // flag rather than defaulting to the bbox centre, because those two are
  // different points on any part that is not symmetric, and a plausible wrong
  // number is precisely the failure this programme keeps paying for: a
  // substituted centroid looks right on the box you test with and is wrong on
  // every real part.
  bool hasCentreOfMass = false;
  double centreOfMass[3] = {0.0, 0.0, 0.0};

  std::vector<FaceCensusEntry> faces;
  std::vector<BoreEntry> bores;

  // Non-empty when the bore measurement was DECLINED and the old
  // concave-cylinder rule stood in. The list is then an OVER-COUNT (every edge
  // blend is a concave cylinder), and saying so is the difference between a
  // measurement and a guess.
  std::string boresDegraded;
  // How many individual faces fell back to that rule inside an otherwise
  // measured run.
  long boresFellBack = 0;

  std::string error;    // the build error; empty when the tree compiled
  std::string backend;  // which kernel backend produced the body

  double bboxSize(std::size_t axis) const noexcept;
  double bboxDiagonal() const noexcept;
  void bboxCentre(double out[3]) const noexcept;

  bool hasCensus() const noexcept { return !faces.empty(); }
  // Sum of every face area in the census, recomputed rather than trusted.
  double censusArea() const noexcept;
};

// ── derived queries ─────────────────────────────────────────────────────────
struct KindCount {
  std::string kind;
  long count = 0;
  double area = 0.0;
};

// Sorted by kind name, so two runs over one part print identical histograms.
std::vector<KindCount> kindHistogram(const ShapeReport& report);
long faceKindCount(const ShapeReport& report, const std::string& kind);

// A bore index that does not exist. "This part has no holes" must not look like
// "hole number 0".
inline constexpr std::size_t kNoBore = static_cast<std::size_t>(-1);

// The bore a user means by "the largest bore" — the greatest radius. Ties break
// on the LONGER span and then on the lower index, so a symmetric part gives a
// deterministic answer instead of one that depends on face order.
std::size_t largestBore(const ShapeReport& report);
std::size_t smallestBore(const ShapeReport& report);
// Every bore, ordered largest radius first. Indices, not copies: a panel row has
// to map back to the report's own numbering.
std::vector<std::size_t> boresByRadius(const ShapeReport& report);

// ── the census filter ───────────────────────────────────────────────────────
// A 430-face part is the TARGET, not the worst case, and 430 undifferentiated
// rows is not a census a person can read. This is the query a panel runs.
//
// Every bound is INCLUSIVE and every one of them is OFF by default: a
// default-constructed query selects the whole census, in face-index order. That
// matters more than it sounds — a filter whose default hides rows is a filter
// that silently answers a different question than the one asked.
struct FaceCensusQuery {
  std::string kind;          // "" = any kind
  bool concaveOnly = false;  // material outside the surface: bores, blends
  bool convexOnly = false;   // material inside: bosses, shafts, outer walls
  double minArea = 0.0;
  double maxArea = 0.0;  // <= 0 means "no upper bound"
  double minRadius = 0.0;
  double maxRadius = 0.0;  // <= 0 means "no upper bound"
  // When set, only faces that HAVE a radius (cylinder/cone/sphere/torus) pass.
  bool radiusOnly = false;

  enum class Sort {
    Index,  // the shape's own face order — the default
    AreaDesc,
    AreaAsc,
    RadiusDesc,
    RadiusAsc,
    Kind,  // by kind name, then by index
  };
  Sort sort = Sort::Index;
};

// Indices into report.faces, filtered and ordered. Deterministic: every sort
// breaks ties on the face index, so one part always produces one list.
std::vector<std::size_t> queryFaceCensus(const ShapeReport& report,
                                         const FaceCensusQuery& query);

// ── export ──────────────────────────────────────────────────────────────────
// A number you cannot get out of the app is half a feature. All three of these
// return a string a panel puts on the clipboard or writes to a file.

// The SAME schema forge_verify prints, so the app's answer and the verifier's
// answer diff cleanly. Numbers are formatted by measureNumber() below, which is
// forge_verify's own `num()`.
std::string shapeReportJson(const ShapeReport& report);

// One row per face: index,kind,area,cx,cy,cz,radius,minorRadius,concave,
// dirx,diry,dirz,axisx,axisy,axisz. Header row included.
std::string faceCensusCsv(const ShapeReport& report);

// The human-readable block the Measure panel shows and the clipboard receives.
std::string shapeReportText(const ShapeReport& report);

// forge_verify's `num()`: 6 decimal places, trailing zeros trimmed, "null" for a
// non-finite value. Exported because every serializer above must agree with the
// verifier digit for digit.
std::string measureNumber(double v);

}  // namespace forge::ui

#endif  // FORGE_UI_SHAPEREPORT_HPP
