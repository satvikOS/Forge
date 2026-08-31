// ui/include/forge/ui/SketchScene.hpp
//
// THE SKETCHER'S VALUE MODEL AND ITS SOLVER SEAM.
//
// This is the data the sketcher's INTERACTION layer draws, hit-tests, snaps to,
// infers constraints over and reports degrees of freedom about. It is here, in
// forge::ui, and not in forge-desktop, for the reason every other model in this
// directory is: a sketch is arithmetic and bookkeeping, not drawing, and a
// number a UI prints is only trustworthy if something headless can assert it.
// Nothing in this file includes ImGui, OCCT or a forge-kernel header.
//
// ── the adapter, and why it is a PORT and not a dependency ──────────────────
// A separate track owns the entity/constraint/SOLVER core. Its interface is not
// frozen, and a UI wired directly into an unfrozen interface is rewritten every
// time that interface moves. So the numeric half of this file is an ABSTRACT
// PORT -- `SketchSolver` -- with exactly one method. Everything the user touches
// talks to the port; `SketchSolverLocal` is the in-tree implementation that
// makes the port non-empty today. When the core lands it implements the same
// port, and one construction site changes.
//
// The value types here are deliberately the SMALLEST set the interaction layer
// needs: four entity kinds and eighteen constraint kinds, each carrying only
// what a snap, a glyph, a DOF count or a dimension label reads. A richer core
// type is adapted INTO these; they are not a second copy of the core's model.
//
// ── the variable vector, and why entities expose one ────────────────────────
// Every DOF statement a sketcher makes -- "under-constrained by 3", "these two
// constraints conflict" -- is a statement about the rank of a Jacobian, and a
// Jacobian needs a packed variable vector with a stable column order. Rather
// than let each solver invent its own packing (and disagree with the UI about
// WHICH variable is free), the packing is defined HERE, once:
//
//   Point   x, y                        (2)
//   Line    x0, y0, x1, y1              (4)
//   Circle  cx, cy, r                   (3)
//   Arc     cx, cy, r, a0, a1           (5)
//
// in entity creation order. `variableBase()` gives the column offset of an
// entity, so a free column reported by the solver maps back to an entity the UI
// can highlight.
#ifndef FORGE_UI_SKETCHSCENE_HPP
#define FORGE_UI_SKETCHSCENE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── the sketch plane ────────────────────────────────────────────────────────
// A sketch is authored in 2D; the plane is how those two numbers become three.
// "Orient to the sketch plane" is a camera question and a camera needs a basis,
// so a basis is what this type is -- not an enum the renderer switches on, which
// is what makes a sketch on a PICKED FACE representable at all.
enum class SketchPlaneKind : std::uint8_t { XY = 0, XZ, YZ, Face, Datum };

const char* toString(SketchPlaneKind kind) noexcept;

struct SketchPlane {
  SketchPlaneKind kind = SketchPlaneKind::XY;
  double origin[3] = {0.0, 0.0, 0.0};
  double xAxis[3] = {1.0, 0.0, 0.0};
  double yAxis[3] = {0.0, 1.0, 0.0};
  // The face or datum this plane was taken from. Empty for the three base
  // planes. Kept as an EntityRef, never a face index, because a sketch outlives
  // the rebuild that repermutes the B-rep (Types.hpp, "typed topology selection").
  EntityRef host{};

  void normal(double out[3]) const noexcept;
  // Are the two axes unit and mutually perpendicular to `tol`? A plane that is
  // not is a silent shear: every sketch coordinate maps somewhere wrong and
  // nothing downstream can tell. Entering a sketch checks this.
  bool orthonormal(double tol = 1.0e-9) const noexcept;
  void toModel(double u, double v, double out[3]) const noexcept;
  // Projects a model point onto the plane. Returns the SIGNED off-plane
  // distance, so a caller can decide whether the point was really on the plane
  // rather than being handed a projection that quietly discarded the third
  // coordinate.
  double toSketch(const double p[3], double& u, double& v) const noexcept;
};

// The three base planes, exact and deterministic.
SketchPlane basePlane(SketchPlaneKind kind);

// Where the camera goes when the user asks to look at the sketch. Modelled here,
// headless, rather than left to the renderer: "orient to the sketch plane" is a
// geometric statement -- eye on the plane's normal, up along its Y axis, looking
// at its origin -- and a statement is assertable where a call into a Camera
// object is not.
struct SketchViewTarget {
  double eye[3] = {0.0, 0.0, 1.0};
  double target[3] = {0.0, 0.0, 0.0};
  double up[3] = {0.0, 1.0, 0.0};
};

SketchViewTarget sketchViewTarget(const SketchPlane& plane, double distance);

// A sketch on a picked face. `normal` need not be unit; the in-plane X axis is
// derived DETERMINISTICALLY (the world axis least aligned with the normal, then
// Gram-Schmidt), so re-entering the same sketch twice gives the same u,v --
// which is what stops a re-opened sketch appearing mirrored or rotated.
// Returns false, and leaves `out` untouched, for a degenerate normal.
bool planeFromFace(const EntityRef& face, const double origin[3], const double normal[3],
                   SketchPlane& out);

// ── entities ────────────────────────────────────────────────────────────────
enum class SketchEntityKind : std::uint8_t { Point = 0, Line, Circle, Arc };

const char* toString(SketchEntityKind kind) noexcept;
std::size_t variableCountFor(SketchEntityKind kind) noexcept;

// Which characteristic point of an entity a constraint or a snap names. Some are
// VARIABLES (a line's start) and some are DERIVED (an arc's start is
// centre + r*(cos a0, sin a0); a line's centre is its midpoint). The distinction
// does not leak: the analysis differentiates through the derivation, so a
// coincidence on an arc endpoint is an ordinary equation.
enum class SketchPointRole : std::uint8_t { Start = 0, End, Centre };

const char* toString(SketchPointRole role) noexcept;

struct SketchPointId {
  int entity = 0;
  SketchPointRole role = SketchPointRole::Start;

  bool valid() const noexcept { return entity > 0; }
  std::string key() const;
};

bool operator==(const SketchPointId& a, const SketchPointId& b) noexcept;
bool operator!=(const SketchPointId& a, const SketchPointId& b) noexcept;

struct SketchEntity {
  int id = 0;
  SketchEntityKind kind = SketchEntityKind::Line;
  // Construction geometry participates in constraints and DOF exactly like real
  // geometry and is excluded from the emitted profile. It is a FLAG, not a
  // separate container, because a centreline that could not be constrained to
  // real geometry would be decoration.
  bool construction = false;
  double v[5] = {0.0, 0.0, 0.0, 0.0, 0.0};

  std::size_t variableCount() const noexcept { return variableCountFor(kind); }
  // Position of a characteristic point. False when this kind has no such point
  // (a circle has no start), so a caller can report WHICH point was missing
  // rather than silently reading a zero.
  bool point(SketchPointRole role, double& x, double& y) const noexcept;
  // Nearest point ON the entity to (x, y), and the distance to it. For an arc
  // this respects the angular sweep, which is why a "nearest point" helper lives
  // with the entity rather than in the snap engine.
  double distanceTo(double x, double y, double& px, double& py) const noexcept;
  double length() const noexcept;  // 0 for a point; circumference / arc length otherwise
  // Unit direction of a LINE. False for every other kind -- the angular
  // inferences (horizontal, parallel, perpendicular) are line-only and must not
  // silently read a direction off a circle.
  bool direction(double& dx, double& dy) const noexcept;
};

SketchEntity makeSketchPoint(double x, double y);
SketchEntity makeSketchLine(double x0, double y0, double x1, double y1);
SketchEntity makeSketchCircle(double cx, double cy, double r);
SketchEntity makeSketchArc(double cx, double cy, double r, double a0, double a1);

// ── constraints ─────────────────────────────────────────────────────────────
// Eighteen kinds: the twelve geometric ones every parametric sketcher ships,
// plus six dimensions. Nothing here is a "hint": each one is a set of equations
// the DOF analysis counts, which is what makes the under/fully/over-constrained
// readout mean something.
enum class SketchConstraintKind : std::uint8_t {
  Coincident = 0,      // pointA == pointB                                  (2 eq)
  PointOnEntity,       // pointA lies on entityB                            (1 eq)
  Horizontal,          // entityA is a line, dy == 0                        (1 eq)
  Vertical,            // entityA is a line, dx == 0                        (1 eq)
  Parallel,            // cross(dA, dB) == 0                                (1 eq)
  Perpendicular,       // dot(dA, dB) == 0                                  (1 eq)
  Tangent,             // line/circle or circle/circle contact              (1 eq)
  Equal,               // equal length, or equal radius                     (1 eq)
  Concentric,          // two centres coincide                              (2 eq)
  Midpoint,            // pointA is the midpoint of line entityB            (2 eq)
  Symmetric,           // pointA, pointB mirror about line entityC          (2 eq)
  Fix,                 // every variable of entityA is pinned               (n eq)
  Distance,            // |pointA - pointB| == value                        (1 eq)
  HorizontalDistance,  // xB - xA == value                                  (1 eq)
  VerticalDistance,    // yB - yA == value                                  (1 eq)
  Radius,              // entityA radius == value                           (1 eq)
  Diameter,            // entityA radius * 2 == value                       (1 eq)
  Angle,               // angle between lines A and B == value (degrees)    (1 eq)
};

inline constexpr std::size_t kSketchConstraintKindCount = 18;

const char* toString(SketchConstraintKind kind) noexcept;
bool sketchConstraintFromString(const std::string& name, SketchConstraintKind& out) noexcept;
std::vector<SketchConstraintKind> allSketchConstraintKinds();

// Does this kind carry a driving VALUE the user types? Dimensions do; geometric
// constraints do not. The split is what a UI needs in order to know whether to
// draw a witness line and an editable number, or a glyph.
bool isSketchDimension(SketchConstraintKind kind) noexcept;

// The short marker the sketch draws next to the geometry it constrains. Two
// characters at most: this is a glyph label, not prose.
const char* sketchConstraintGlyph(SketchConstraintKind kind) noexcept;

struct SketchConstraint {
  int id = 0;
  SketchConstraintKind kind = SketchConstraintKind::Coincident;
  SketchPointId pointA{};
  SketchPointId pointB{};
  int entityA = 0;
  int entityB = 0;
  int entityC = 0;  // Symmetric's mirror line
  double value = 0.0;
  // A DRIVEN (reference) dimension MEASURES and never moves geometry, so it
  // contributes no equation and can never over-constrain. That is the escape
  // hatch a user reaches for instead of deleting the dimension they wanted to
  // read -- represent, do not refuse.
  bool driving = true;
  // Was this OFFERED by the auto-constrainer rather than asked for? The UI marks
  // inferred constraints differently and offers "remove every inferred
  // constraint on this entity", which is the only humane way out of a sketch
  // that inference over-helped.
  bool inferred = false;
  std::string label;  // "d1", "R3" -- the tag a dimension draws
};

class SketchScene;

// How many scalar equations this constraint contributes in `scene` (Fix depends
// on the entity's variable count). 0 for a driven dimension or a malformed one.
std::size_t equationCountFor(const SketchScene& scene, const SketchConstraint& c) noexcept;

// ── the scene ───────────────────────────────────────────────────────────────
// Ids are STABLE and never reused. Reusing a deleted entity's id would let a
// stale constraint silently re-attach to whatever was created next: a wrong
// sketch that no gate can see.
class SketchScene {
 public:
  int add(const SketchEntity& entity);  // 0 on a malformed entity
  int addPoint(double x, double y);
  int addLine(double x0, double y0, double x1, double y1);
  int addCircle(double cx, double cy, double r);
  int addArc(double cx, double cy, double r, double a0, double a1);

  // Removes the entity AND every constraint that names it, reporting how many
  // constraints went with it. Silently orphaning constraints is how a sketch
  // ends up holding equations about geometry that is not there.
  bool removeEntity(int id, std::size_t* constraintsRemoved = nullptr);

  const SketchEntity* entity(int id) const noexcept;
  SketchEntity* mutableEntity(int id) noexcept;
  const std::vector<SketchEntity>& entities() const noexcept { return entities_; }
  std::size_t entityCount() const noexcept { return entities_.size(); }

  // Resolves a point reference to coordinates. False when the entity is absent
  // or has no such point.
  bool pointPosition(const SketchPointId& p, double& x, double& y) const noexcept;

  // Refuses a constraint that names ABSENT GEOMETRY, and says which -- `why`
  // names the entity id and the reason, so a repair loop has something to act
  // on. It does NOT refuse a constraint that would over-constrain: that is a
  // state the sketch REPRESENTS and reports, not an input it rejects.
  int addConstraint(const SketchConstraint& c, std::string* why = nullptr);
  bool removeConstraint(int id);
  const SketchConstraint* constraint(int id) const noexcept;
  SketchConstraint* mutableConstraint(int id) noexcept;
  const std::vector<SketchConstraint>& constraints() const noexcept { return constraints_; }
  std::size_t constraintCount() const noexcept { return constraints_.size(); }

  // Every constraint that names this entity -- what the UI draws beside it, and
  // what deleting the entity takes with it.
  std::vector<int> constraintsOn(int entityId) const;

  void clear() noexcept;

  // ── the packed variable vector (see the header comment) ─────────────────
  std::size_t variableCount() const noexcept;
  bool variableBase(int entityId, std::size_t& base) const noexcept;
  // Which entity owns packed column `column`. 0 when out of range.
  int entityForVariable(std::size_t column) const noexcept;
  // A human name for a column: "line 3.y1". Used verbatim in the DOF readout,
  // because "3 degrees of freedom" without saying WHERE is not feedback.
  std::string variableName(std::size_t column) const;
  void packVariables(std::vector<double>& out) const;
  bool unpackVariables(const std::vector<double>& in);

  // Is this constraint well formed against the geometry present right now?
  // False, with `why` naming the entity and the reason.
  bool wellFormed(const SketchConstraint& c, std::string& why) const;

 private:
  std::vector<SketchEntity> entities_;
  std::vector<SketchConstraint> constraints_;
  int nextEntityId_ = 1;
  int nextConstraintId_ = 1;
};

// ── the DOF report, and the solver port ─────────────────────────────────────
enum class SketchDofStatus : std::uint8_t {
  Empty = 0,  // nothing drawn yet
  Under,      // dof > 0, no redundancy
  Fully,      // dof == 0, no redundancy
  Over,       // at least one constraint adds no new information
};

const char* toString(SketchDofStatus status) noexcept;

// ONE constraint that added nothing, AND the set it duplicates or contradicts.
// Reporting only the offending constraint is what makes an over-constrained
// sketch feel arbitrary: the user did nothing wrong when they added it, they did
// something wrong when they added it TOGETHER WITH these.
struct SketchConflict {
  int constraintId = 0;
  std::vector<int> withConstraints;
  // true  -- redundant but AGREES with the set (two horizontals on one line):
  //          still solvable, drop either.
  // false -- CONTRADICTS the set (10 mm and 20 mm on the same pair): no
  //          configuration satisfies both, and this is the one to say loudly.
  bool consistent = true;
  std::string detail;
};

struct SketchDofReport {
  SketchDofStatus status = SketchDofStatus::Empty;
  std::size_t unknowns = 0;
  std::size_t equations = 0;
  std::size_t rank = 0;
  std::size_t dof = 0;
  std::vector<SketchConflict> conflicts;
  // A maximal set of variables NOT determined by the constraints, as packed
  // columns, and the entities that own them. This is the "drag me" highlight and
  // it is why the readout can say WHERE the freedom is.
  std::vector<std::size_t> freeVariables;
  std::vector<int> underConstrainedEntities;
  std::string detail;

  bool overConstrained() const noexcept { return !conflicts.empty(); }
  // Every constraint the UI must paint as conflicting: the offenders AND the
  // sets they conflict with, deduplicated and sorted.
  std::vector<int> conflictHighlight() const;
};

// THE PORT. One method, deliberately: the interaction layer needs to know how
// free the sketch is and which constraints fight, and nothing else about how the
// core solves. A core that also MOVES geometry implements this and offers its
// own solve() beside it; the UI keeps talking to this.
class SketchSolver {
 public:
  virtual ~SketchSolver() = default;
  virtual SketchDofReport analyse(const SketchScene& scene) const = 0;
};

// THE OTHER HALF OF THE CORE, and the reason it is a SEPARATE port: analysing a
// sketch and MOVING one are different capabilities with different failure modes,
// and the interaction layer needs the first far more often than the second. With
// no driver installed the session records what the user asked for and says
// plainly that the geometry has not been re-solved -- which is a true statement a
// user can act on. Pretending to solve would not be.
class SketchSolveDriver {
 public:
  virtual ~SketchSolveDriver() = default;
  // Move `scene`'s variables to satisfy its driving constraints. Returns false
  // and leaves the scene UNTOUCHED when it cannot, filling `detail` with why.
  virtual bool solve(SketchScene& scene, std::string& detail) = 0;
};

// Would adding `c` to `scene` say anything NEW -- that is, does it raise the
// rank? Written against the PORT, so it works with whichever solver is
// installed, and it is the whole basis of the auto-constrainer's discipline:
// inference OFFERS only constraints that add information, so drawing a
// rectangle cannot leave the sketch over-constrained by its own helpfulness.
//
// Note what this is NOT: it is not a veto on what the USER may apply. A user who
// asks for a redundant constraint gets it, and the DOF readout then says so and
// names the set. Refusing input is a capability gate; declining to VOLUNTEER a
// redundant constraint is not.
bool sketchConstraintAddsInformation(const SketchSolver& solver, const SketchScene& scene,
                                     const SketchConstraint& candidate);

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHSCENE_HPP
