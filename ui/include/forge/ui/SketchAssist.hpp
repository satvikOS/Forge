// ui/include/forge/ui/SketchAssist.hpp
//
// THE TWO THINGS THAT MAKE A SKETCHER FEEL PROFESSIONAL: where the cursor
// actually lands, and what the sketch offers to remember about what you drew.
//
//   SNAPPING     the cursor at (x, y) resolves to a CHARACTERISTIC point --
//                an endpoint, a centre, a midpoint, an intersection, a quadrant,
//                a point on an entity, or a grid node -- with a stated priority
//                so a nearby endpoint always beats a nearer grid node. A snap
//                that silently preferred the grid is how a drawing ends up
//                0.03 mm short of closing.
//
//   INFERENCE    a line drawn 1.2 degrees off horizontal OFFERS a horizontal
//                constraint; an endpoint dropped on another endpoint offers a
//                coincidence; a line drawn beside another offers parallel. Each
//                offer carries a CONFIDENCE and a plain-language REASON, because
//                a constraint that appears without explanation is the single
//                most disliked behaviour in every parametric sketcher shipped.
//
// ── the discipline that keeps inference from ruining a sketch ───────────────
// Auto-constraints are the fastest way to make a sketch over-constrained by
// accident: a rectangle tool that emits four coincidences, two horizontals and
// two verticals emits eight constraints where a hand-built one would notice that
// some say nothing new. So the offer list is passed through
// `retainIndependent()`, which keeps only the proposals that RAISE THE RANK of
// the constraint system (SketchScene.hpp, `sketchConstraintAddsInformation`).
//
// Read that as the opposite of a gate. Nothing the USER asks for is filtered:
// apply a redundant constraint by hand and you get it, and the DOF readout says
// so and names the set. What is filtered is what the app VOLUNTEERS, and
// declining to volunteer noise is not a refusal of input.
//
// Headless: pure functions over SketchScene. No ImGui, no GPU, no display.
#ifndef FORGE_UI_SKETCHASSIST_HPP
#define FORGE_UI_SKETCHASSIST_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/SketchScene.hpp"

namespace forge::ui {

// ── snapping ────────────────────────────────────────────────────────────────
enum class SnapKind : std::uint8_t {
  None = 0,
  Endpoint,      // a line end, an arc end, a bare point
  Centre,        // a circle or arc centre
  Intersection,  // where two entities actually cross
  Midpoint,      // the middle of a line
  Quadrant,      // the four axis points of a circle or arc
  OnEntity,      // anywhere along an entity
  Grid,          // a grid node
};

inline constexpr std::size_t kSnapKindCount = 8;

const char* toString(SnapKind kind) noexcept;
std::vector<SnapKind> allSnapKinds();

// Lower wins. The ORDER is the product decision, and it is stated once here
// rather than implied by the order of a chain of if-statements: a characteristic
// point of real geometry always beats a grid node, and a point that EXISTS
// (endpoint, centre, intersection) beats one that is merely computable
// (midpoint, quadrant, anywhere-on).
int snapPriority(SnapKind kind) noexcept;

struct SnapSettings {
  // Indexed by SnapKind. Grid on, everything on: the defaults a new sketch opens
  // with. A user turning one off is a preference, never a capability loss --
  // every snap kind stays computable and the disabled ones simply stop winning.
  bool enabled[kSnapKindCount] = {false, true, true, true, true, true, true, true};
  double gridSpacing = 5.0;
  bool gridVisible = true;
  // How close the cursor must be, IN MODEL UNITS. The renderer converts its
  // pixel radius through the view scale, because a snap radius that is constant
  // in model units grows and shrinks under zoom, which is the wrong behaviour.
  double pickRadius = 2.5;

  bool on(SnapKind kind) const noexcept;
  void setOn(SnapKind kind, bool value) noexcept;
};

struct SnapResult {
  SnapKind kind = SnapKind::None;
  double x = 0.0;
  double y = 0.0;
  // Set for Endpoint / Centre / Midpoint: exactly which point was hit, so a
  // coincidence can be inferred against it.
  SketchPointId point{};
  int entityA = 0;  // OnEntity / Quadrant / Intersection: the entity
  int entityB = 0;  // Intersection: the second entity
  double distance = 0.0;  // from the raw cursor to the snapped position

  bool hit() const noexcept { return kind != SnapKind::None; }
  std::string describe() const;  // "endpoint of line 3"
};

double snapToGrid(double v, double spacing) noexcept;

// The best snap for a cursor at (x, y). `ignore` is the entity being drawn: an
// in-progress rubber band must not snap to itself, which is the defect that
// makes a polyline collapse onto its own last vertex.
//
// Always returns something when the grid is on -- a cursor that lands nowhere is
// not a refusal, it is a free cursor, and `kind == None` says exactly that.
SnapResult snapCursor(const SketchScene& scene, const SnapSettings& settings, double x, double y,
                      const std::vector<int>& ignore = std::vector<int>());

// Which entity the cursor is over, for picking. 0 for none. Nearest wins, and a
// tie is broken by the LOWEST id so a click on overlapping geometry is
// repeatable rather than dependent on container order.
int hitTestEntity(const SketchScene& scene, double x, double y, double pickRadius,
                  const std::vector<int>& ignore = std::vector<int>());

// Up to two intersections of two entities, restricted to the parts actually
// drawn (a segment, an arc's sweep). Returns how many were written.
std::size_t intersectSketchEntities(const SketchEntity& a, const SketchEntity& b,
                                    double out[2][2]);

// ── auto-constraint inference ───────────────────────────────────────────────
struct ConstraintProposal {
  SketchConstraint constraint{};  // id 0; the caller adds it
  double confidence = 0.0;        // 1.0 = dead on, 0.0 = at the tolerance edge
  std::string reason;             // "1.2 degrees off horizontal"
};

struct InferenceSettings {
  bool horizontalVertical = true;
  bool coincident = true;
  bool pointOnEntity = true;
  bool parallelPerpendicular = true;
  bool tangent = true;
  bool equal = true;
  bool concentric = true;
  // A line within this many degrees of horizontal is offered a horizontal
  // constraint. 3 degrees is the value every mainstream sketcher lands near:
  // large enough to catch a deliberate hand movement, small enough not to
  // flatten a shallow taper the user meant.
  double angleToleranceDeg = 3.0;
  // Two lengths or radii within this fraction of each other are offered Equal.
  double equalToleranceFraction = 0.02;
  // How close two points must be, in model units, to be offered a coincidence
  // when no snap reported one.
  double pointTolerance = 1.0e-6;
  std::size_t maxProposals = 8;
};

// Which point of the NEW entity a pick placed, and what the cursor was snapped
// to at that moment. The tool knows this pairing; inference must not guess it,
// because guessing is how a rectangle's third corner gets constrained to the
// first one's snap.
struct SketchPickBinding {
  SketchPointId point{};
  SnapResult snap{};
};

// Everything worth OFFERING about `entityId`, ranked by confidence then by a
// deterministic tie-break, capped at `maxProposals`. `entityId` must already be
// in `scene` -- for a preview, add the ghost to a COPY of the scene and infer
// against that, which is what SketchSession does.
std::vector<ConstraintProposal> inferConstraints(const SketchScene& scene, int entityId,
                                                 const std::vector<SketchPickBinding>& bindings,
                                                 const InferenceSettings& settings);

// The subset that actually says something new, tested CUMULATIVELY: each
// accepted proposal is added to a working copy before the next is tested, so
// four coincidences plus two horizontals plus two verticals reduce to whatever
// of them is independent, in confidence order.
std::vector<ConstraintProposal> retainIndependent(const SketchSolver& solver,
                                                  const SketchScene& scene,
                                                  const std::vector<ConstraintProposal>& offered);

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHASSIST_HPP
