// ui/include/forge/ui/SurfaceAnalysis.hpp
//
// THE TWO SURFACE READINGS — will it come out of a mould, and can you see the
// joins.
//
// ── the defect this file exists for ─────────────────────────────────────────
// The Surface workspace ships eight docked tabs. Three of them -- Continuity,
// Isocline and Zebra -- had a name, a sentence and no content. Two of the three
// are answerable from the tessellation the viewport is ALREADY drawing, and they
// are the two a surfacing user actually acts on:
//
//   isocline    WHICH WAY EACH FACE FACES, against the direction a mould half
//               withdraws. Every face's own draft angle, the ones with less
//               taper than the job asks for, and the ones square to the pull
//               that will drag the whole way out.
//   continuity  WHETHER YOU CAN SEE THE JOIN. The angle the surface actually
//               breaks through, measured across every mesh edge where one
//               B-rep face meets another.
//
// Zebra is deliberately NOT here. A zebra display is striped light reflected off
// the surface and read in the 3D view; reducing it to a table would be a
// different instrument wearing its name, and the honest version of it is a
// shading pass in the viewport rather than a list of numbers in a docked panel.
//
// ── THE RULE, AND THE ONE THRESHOLD THAT IS MEASURED RATHER THAN CHOSEN ─────
// The rule is InspectionReport.hpp's: A PANEL MAY ONLY PRINT WHAT SOMETHING
// HEADLESS HAS ALREADY ASSERTED. Everything below is arithmetic over the same
// triangle soup MeasureModel.hpp already takes, and it is pinned by
// ui/test/surface_analysis_test.cpp.
//
// The continuity report needs to say whether two faces meet SMOOTHLY, and that
// needs an angle below which a break is not a break. Choosing one would be
// wrong, and the mesh already knows the answer: a curved face is drawn as flat
// facets, so the surface breaks by a few degrees at every facet INSIDE one face
// too. That largest inside-one-face step is the finest break this mesh can
// resolve at all -- a join tighter than it cannot be told from tangent no matter
// how the surfaces really meet. So the tolerance is that measured step (never
// below kMeasureAngleTolerance, which is the tolerance the Measure panel already
// uses for "these two faces are parallel"), it is REPORTED as
// `resolutionDeg`, and the panel says what it is. A part with no curved face
// measures a step of zero and falls back to the floor.
//
// Nothing here includes a drawing header or a kernel header.
#ifndef FORGE_UI_SURFACEANALYSIS_HPP
#define FORGE_UI_SURFACEANALYSIS_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {

// ── the direction a mould half withdraws in ─────────────────────────────────
// Six, because a part is pulled along an axis and the user picks which. +Z is
// the default because it is the direction this program's own extrude runs in.
enum class PullAxis : std::uint8_t { XPlus, XMinus, YPlus, YMinus, ZPlus, ZMinus };

// "+Z", "-X". The spelling a drawing uses.
const char* pullAxisWord(PullAxis axis) noexcept;
void pullAxisVector(PullAxis axis, double out[3]) noexcept;
const std::vector<PullAxis>& allPullAxes();

// ── 1. THE DRAFT READING ───────────────────────────────────────────────────
//
// The draft angle of a face against a pull direction d is the angle between the
// face and d, which for a unit outward normal n is asin(n . d): 0 for a wall
// running exactly along the pull, +90 for the face the pull comes straight out
// of, -90 for the one on the other half of the mould.
//
// FOR A TWO-PART MOULD SPLIT ACROSS THE PULL, this is the whole test, and it is
// worth saying because it is what makes the four verdicts below a complete
// answer rather than a colour scheme: every face must come out with one half or
// the other, so a face with positive draft leaves with the +d half, a face with
// negative draft leaves with the -d half, and a face SQUARE to the pull leaves
// with neither -- it slides against both the whole way out. The shallow ones
// come out and scuff.
//
// What this does NOT do, and does not claim: it does not find the parting line,
// and it does not detect a re-entrant pocket whose walls all read positive. Both
// need more than a face normal.
enum class DraftVerdict : std::uint8_t {
  // Tapered at least as much as the job asks for.
  Releasing,
  // It does come away, with less taper than was asked for.
  Shallow,
  // Square to the pull: it drags against the mould the whole way out.
  Square,
  // It faces the other way, and comes out of the other half.
  Opposite,
  // The face carries no triangles it could be measured from. NOT folded in with
  // Square: "the kernel drew none of this face" and "this face is square to the
  // pull" are different facts and a user acts differently on them.
  Unmeasured,
};

const char* toString(DraftVerdict verdict) noexcept;

struct DraftFace {
  std::uint32_t faceId = 0;
  double area = 0.0;
  // ── THE WORST PART OF THE FACE IS WHAT DECIDES IT ────────────────────────
  // `draftDeg` is the SMALLEST asin(n . d) over the face's own triangles, in
  // degrees, -90 .. +90, and `bestDraftDeg` the largest. Averaging them would be
  // wrong in a way that matters: a bore running across the pull faces every
  // direction at once, so its average normal cancels to nothing at all, and a
  // face that reported the average would call the one feature that certainly
  // traps the part "unmeasurable". A face comes out only if EVERY part of it
  // does, so the minimum is the verdict and the maximum is reported beside it.
  double draftDeg = 0.0;
  double bestDraftDeg = 0.0;
  // The two agree to within the angle tolerance: the face has ONE direction.
  bool uniform = false;
  DraftVerdict verdict = DraftVerdict::Unmeasured;
  double centroid[3] = {0.0, 0.0, 0.0};
  bool planar = false;
};

struct DraftReport {
  PullAxis pull = PullAxis::ZPlus;
  double requiredDeg = 0.0;
  // Every face of the mesh, WORST FIRST -- the smallest draft angle at the top,
  // because the face that will not come out is the one the user opened this for.
  std::vector<DraftFace> faces;
  double area = 0.0;           // over the measured faces
  double releasingArea = 0.0;
  double shallowArea = 0.0;
  double squareArea = 0.0;
  double oppositeArea = 0.0;
  std::size_t releasing = 0;
  std::size_t shallow = 0;
  std::size_t square = 0;
  std::size_t opposite = 0;
  std::size_t unmeasured = 0;
  // The smallest draft over the faces that come away with this half -- the one
  // number that decides whether the part strips. `worstKnown` is FALSE when no
  // face comes away with this half at all.
  double worstDraftDeg = 0.0;
  bool worstKnown = false;
  // FALSE when there is nothing on screen to measure. Not an error.
  bool known = false;

  std::size_t rowCount() const noexcept { return faces.size(); }
  // Every face that is not Releasing: what a user has to look at.
  std::size_t needsAttention() const noexcept { return shallow + square + opposite; }
};

// `requiredDeg` is the taper the JOB asks for, which is a shop's decision and
// never a property of the part: it is passed in, shown by the panel, and changed
// there. Zero is a valid answer and means "just tell me which way each face
// comes out". Negative values are clamped to zero.
DraftReport buildDraftReport(const MeasureMesh& mesh, PullAxis pull, double requiredDeg);

// ── 2. THE CONTINUITY READING ──────────────────────────────────────────────
enum class JoinSmoothness : std::uint8_t {
  // No break this mesh can resolve: the two surfaces run into each other.
  Smooth,
  // They meet at an angle you can see, and its size is reported.
  Sharp,
};

const char* toString(JoinSmoothness smoothness) noexcept;

// Where two B-rep faces meet, and how hard.
struct SurfaceJoin {
  std::uint32_t faceA = 0;   // always the smaller id, so a pair appears once
  std::uint32_t faceB = 0;
  std::size_t sharedEdges = 0;
  double sharedLength = 0.0;
  double minBreakDeg = 0.0;
  double maxBreakDeg = 0.0;
  // Length-weighted over the shared edges, so a long tangent run is not
  // outvoted by one short facet at its end.
  double meanBreakDeg = 0.0;
  JoinSmoothness smoothness = JoinSmoothness::Smooth;
  // TRUE when the surface stands out along this join, FALSE when it cuts in.
  // The difference is the one a machinist reads first: an inside corner is what
  // decides a cutter's diameter. `convexKnown` is FALSE when the mesh does not
  // close and face outward, because the test is a question about which side the
  // material is on and an open mesh has no answer.
  bool convex = false;
  bool convexKnown = false;
};

struct ContinuityReport {
  // Every pair of faces that touch, HARDEST FIRST.
  std::vector<SurfaceJoin> joins;
  std::size_t smooth = 0;
  std::size_t sharp = 0;
  double smoothLength = 0.0;
  double sharpLength = 0.0;
  // The finest break this mesh can resolve: the largest facet-to-facet angle
  // INSIDE a single face. See the header note -- this is measured, not chosen.
  double resolutionDeg = 0.0;
  // TRUE when that measurement had nothing to work with (no face is drawn with
  // more than one triangle) and the floor was used instead.
  bool resolutionIsFloor = false;
  double worstBreakDeg = 0.0;
  bool worstKnown = false;
  // The mesh's own topology, reported rather than hidden: an edge used once is a
  // hole, and the joins across it cannot be measured.
  std::size_t openEdges = 0;
  std::size_t oddEdges = 0;
  bool known = false;

  std::size_t rowCount() const noexcept { return joins.size(); }
};

// `measured` is what measureMesh() already reported for the same soup; it is
// passed in rather than recomputed because the panel has it, and because
// whether the mesh closes and faces outward is what decides if the inside /
// outside answer above may be given at all.
ContinuityReport buildContinuityReport(const MeasureMesh& mesh, const MeshMeasure& measured);

}  // namespace forge::ui

#endif  // FORGE_UI_SURFACEANALYSIS_HPP
