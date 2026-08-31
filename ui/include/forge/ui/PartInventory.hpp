// ui/include/forge/ui/PartInventory.hpp
//
// THE MEASURED INVENTORY — what the CoPilot is allowed to KNOW about the part.
//
// The ground-truth edit records this project is measured against do not say
// "shrink the bore". They say "shrink the diameter of the largest bore by 5 mm"
// against a part of 329-430 faces, and they condition the edit on a COMPLETE
// per-face census of the input solid. A planner that cannot see every face
// cannot answer "largest"; it can only guess, and a guess that lands near the
// right number is indistinguishable from a measurement until it does not.
//
// So this file is the census, in types. It mirrors EXACTLY the schema
// forge-kernel/src/tools/forge_verify.cpp emits for `{"census":"full"}`:
//
//     "census":{"faceCount":430,"kind_histogram":{"bspline":67,"cone":4,
//               "cylinder":167,"plane":42,"sphere":25,"torus":125},
//               "bbox":{"min":[..],"max":[..]},
//               "faces":[{"kind","area","centroid",["radius"],["major","minor"],
//                         ["axis","axisAt"],["normal"],"concave","index"}, ...]}
//     "bores":[{"cx","cy","r","span","at","axis","faces"}, ...]
//
// It is PARSED, not re-derived. forge::ui opens no process and no socket, so the
// app layer runs forge_verify and hands the line here. Deriving a face census in
// the UI would be a second geometry engine and a second answer.
//
// ── WHY A BORE IS NOT A FACE ────────────────────────────────────────────────
// One `bores` entry is one HOLE keyed on its AXIS LINE — a wall split at a seam,
// or into pilot + counterbore, is still one hole — so `r` is the SMALLEST radius
// on that axis (the pilot) and `span` the total axial length of cylindrical wall.
// "The largest bore" therefore ranks on `r`, not on a cylinder face's radius:
// ranking faces would call a counterbore's wide mouth a separate, larger bore.
//
// ── FROM A MEASUREMENT TO AN EDIT ───────────────────────────────────────────
// Knowing the largest bore is ⌀12 does not yet change it. The document is a
// feature tree, so the edit is a PARAMETER EDIT of the statement that MADE that
// bore, and finding that statement is a matching problem: which HOLE/CBORE in
// PartDocument::records() has this diameter at this centre? matchBoreToFeature()
// answers it and REPORTS ITS EVIDENCE — the diameter error and the centre
// distance it accepted — because a match asserted without its residual is a
// guess wearing a number.
//
// ★It never REFUSES a part it cannot match: an unmatched bore comes back with
// `candidates` and a `why` naming what was searched, so a repair loop or the
// user can act. Refusing would be a capability gate, and it would fire hardest
// on the longest trees, which are the ones with the most bores.
//
// HEADLESS: no ImGui, no GPU, no display, no socket, no file I/O.
#ifndef FORGE_UI_PARTINVENTORY_HPP
#define FORGE_UI_PARTINVENTORY_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── one face, in the ground-truth census schema ─────────────────────────────
struct FaceRecord {
  std::string kind;          // "plane" | "cylinder" | "cone" | "sphere" | "torus" | "bspline" | ...
  double area = 0.0;
  double centroid[3] = {0.0, 0.0, 0.0};
  double radius = 0.0;       // cylinder/sphere/cone; the MAJOR radius for a torus
  double minorRadius = 0.0;  // torus only
  // cylinder/cone/torus: the axis direction and a point on it.
  // plane: `axis` carries the NORMAL and `hasAxisAt` is false.
  double axis[3] = {0.0, 0.0, 0.0};
  double axisAt[3] = {0.0, 0.0, 0.0};
  bool hasRadius = false;
  bool hasAxis = false;
  bool hasAxisAt = false;
  bool concave = false;
  int index = -1;            // the kernel's face index, as measured

  std::string display() const;
};

// ── one bore, keyed on its axis line ────────────────────────────────────────
struct BoreRecord {
  double radius = 0.0;   // `r`: the SMALLEST radius on the axis — the pilot
  double centre[3] = {0.0, 0.0, 0.0};  // `at`: a point on the axis line
  double axis[3] = {0.0, 0.0, 1.0};
  double span = 0.0;     // total axial length of cylindrical wall on this axis
  int faces = 0;         // how many cylindrical faces were merged into it

  double diameter() const noexcept { return 2.0 * radius; }
  std::string display() const;  // "⌀12.000 at (0.000, 0.000, 0.000) span 40.000 along +Z"
};

// ── how a phrase picked a bore ──────────────────────────────────────────────
// Kept as an enum rather than a string because the panel must be able to say
// WHICH rule fired: "largest" and "the one at (0,0)" are different claims and a
// user checking the CoPilot's work needs to see which was made.
enum class BoreRank : std::uint8_t {
  Largest,   // greatest radius
  Smallest,  // least radius
  Deepest,   // greatest span
  Ordinal,   // "the 3rd bore", in the census's own order
};

const char* toString(BoreRank rank) noexcept;

// ── the census ──────────────────────────────────────────────────────────────
struct PartInventory {
  // FALSE until something measured this part. Every accessor below is honest on
  // an unmeasured inventory (empty, nullptr, "not measured") rather than
  // returning a zero a caller could mistake for a measurement of an empty part.
  bool measured = false;
  std::string source;  // e.g. "forge_verify census=full"; how it was obtained

  std::size_t faceCount = 0;
  // Sorted by kind name, in the order forge_verify emits it (its histogram is an
  // ordered container, so this is ascending by kind).
  std::vector<std::pair<std::string, long>> kindHistogram;
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  bool hasBbox = false;

  std::vector<FaceRecord> faces;
  std::vector<BoreRecord> bores;

  long kindCount(const std::string& kind) const noexcept;
  // Bores ranked by `rank`. Empty when nothing is measured. Ties are broken by
  // census order so the ranking is TOTAL and therefore reproducible: two bores
  // of equal radius must not swap places between two runs of the same question.
  std::vector<std::size_t> boresRanked(BoreRank rank) const;
  // The bore `rank` names, or nullptr. `ordinal` is 1-based and used only by
  // BoreRank::Ordinal.
  const BoreRecord* bore(BoreRank rank, std::size_t ordinal = 1) const;

  // One line: "430 faces (bspline 67, cone 4, cylinder 167, ...), 7 bores".
  std::string summary() const;
  // The multi-line block a planner is GIVEN. Every number in it is measured.
  // `maxBores` caps the bore list; the count is always stated in full, so a
  // truncated list still says how many there are rather than implying there are
  // only that many.
  std::string contextBlock(std::size_t maxBores = 16) const;

  // Parse one forge_verify response line. Returns false with `why` filled when
  // the text is not a census response; `out` is then left untouched.
  //
  // The reader is deliberately small and schema-specific: it reads the keys this
  // struct declares and IGNORES every other key, so a forge_verify that grows a
  // field does not break the CoPilot. It never executes anything it reads.
  static bool parseVerifyJson(const std::string& json, PartInventory& out, std::string& why);
};

// ── from a measured bore to the statement that made it ──────────────────────
struct BoreFeatureMatch {
  bool matched = false;
  int irId = 0;                  // the statement id: part.edit_feature's `feature`
  std::string op;                // "HOLE" or "CBORE"
  std::size_t numericIndex = 0;  // part.edit_feature's `index` (NUMBER args only)
  double currentDiameter = 0.0;  // what that statement states today
  double diameterError = 0.0;    // |stated - measured|, the residual accepted
  double centreDistance = 0.0;   // how far the statement's centre is from the axis
  // Every HOLE/CBORE considered, in document order. Present whether or not a
  // match was made: on a failure it is what a repair loop reads, and on a
  // success it is what says the match was unambiguous.
  std::vector<int> candidates;
  std::string why;               // why not, when matched == false

  std::string display() const;
};

// Which HOLE/CBORE statement in `document` made `bore`.
//
// MATCHES ON BOTH the stated diameter and the stated centre, and takes the best
// pair rather than the first: a part with eight identical ⌀6 bores has eight
// statements with the same diameter and only one at the right (x, y).
// `diameterTol` and `centreTol` are absolute millimetres and are REPORTED in the
// result, never hidden, because a tolerance is part of the claim.
BoreFeatureMatch matchBoreToFeature(const BoreRecord& bore, const PartDocument& document,
                                    double diameterTol = 1e-3, double centreTol = 1e-3);

// ── the ground-truth edit, grounded ─────────────────────────────────────────
// "shrink the diameter of the largest bore by 5 mm" as a plan step whose every
// number came from a measurement.
struct GroundedEdit {
  bool ok = false;
  PlanStep step;           // part.edit_feature(feature, index, value)
  std::string grounding;   // the measured facts the value was derived from
  std::string why;         // why not, when ok == false
  BoreFeatureMatch match;  // the evidence, kept whether or not it succeeded
  double fromDiameter = 0.0;
  double toDiameter = 0.0;
};

// `delta` is signed and in millimetres of DIAMETER: -5 shrinks by 5 mm.
// `absolute`, when true, reads `delta` as the new diameter instead.
//
// REFUSES ONLY WHAT IS NOT REPRESENTABLE — a non-positive resulting diameter is
// not a bore — and says so by name. Everything else that could go wrong (no
// census, no such bore, no matching statement) comes back with `why` naming the
// missing fact, so the conversation can ask for it rather than dying.
GroundedEdit groundBoreDiameterEdit(const PartInventory& inventory, const PartDocument& document,
                                    BoreRank rank, double delta, bool absolute = false,
                                    std::size_t ordinal = 1);

// ── the phrase ──────────────────────────────────────────────────────────────
// What a user typed, parsed into a bore reference. Recognises the ground-truth
// phrasing and nothing it cannot ground:
//   "shrink the diameter of the largest bore by 5 mm"
//   "enlarge the smallest hole by 2"
//   "set the diameter of the deepest bore to 12 mm"
//   "shrink bore 3 by 1.5mm"
struct BoreEditPhrase {
  bool recognised = false;
  BoreRank rank = BoreRank::Largest;
  std::size_t ordinal = 1;
  double delta = 0.0;     // signed, millimetres of diameter
  bool absolute = false;  // "to 12 mm" rather than "by 5 mm"
  std::string why;        // why not, when recognised == false
};

BoreEditPhrase parseBoreEditPhrase(const std::string& text);

}  // namespace forge::ui

#endif  // FORGE_UI_PARTINVENTORY_HPP
