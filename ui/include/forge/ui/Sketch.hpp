// ui/include/forge/ui/Sketch.hpp
//
// THE SKETCH — the 2D constrained profile every history-based CAD model starts
// from, and the thing Forge did not have. `EntityKind::Sketch` and
// `EntityKind::SketchCurve` have been in Types.hpp since the selection service
// was written and NOTHING produced one: `part.extrude` requires a Sketch
// selection, and the only way to satisfy it was to SEED a profile straight into
// the document. A modeller whose sketches can only be seeded is a modeller with
// no sketcher.
//
// ── what lives here and what does not ───────────────────────────────────────
// This header is the DATA MODEL: a plane, a set of entities, and the flat
// parameter vector the solver moves. It knows nothing about constraints, about
// solving, or about the IR — those are SketchSolver.hpp and SketchProfile.hpp —
// so it compiles and runs headless with no ImGui, no GPU and no global state,
// like every other file under ui/.
//
// ── the parameter vector, and why it is flat ────────────────────────────────
// A constraint solver moves NUMBERS, not objects. Every entity owns a
// contiguous run of doubles in one flat vector (`parameters()`), addressed by
// `paramBase(entity)`, and every geometric quantity a constraint can talk about
// — an endpoint, a centre, a radius, a direction — is a pure function of that
// vector (`resolvePoint` / `resolveRadius` / `resolveDirection`). That is what
// makes a numeric Jacobian possible at all: perturb one double, re-evaluate,
// and the derivative of an ARC ENDPOINT with respect to the arc's start angle
// falls out without anyone having to write it down.
//
// It is also why arc and ellipse endpoints are DERIVED rather than stored. An
// arc holding its own endpoints as parameters would need three hidden internal
// constraints to stay an arc, and a solver that has to be told its own geometry
// is consistent reports degrees of freedom that are not real. Here an arc has
// exactly 5 DOF because an arc has exactly 5 DOF.
//
// ── the plane ───────────────────────────────────────────────────────────────
// Entities live in the plane's (u, v) coordinates. The plane maps them to world
// space, and it is specifiable: the three standard planes plus an arbitrary
// origin/normal/xAxis frame. A sketcher pinned to Z=0 cannot express the second
// section of a loft, which is the exact gap RING was added to paper over.
#ifndef FORGE_UI_SKETCH_HPP
#define FORGE_UI_SKETCH_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// ── the plane ───────────────────────────────────────────────────────────────
enum class SketchPlaneKind : std::uint8_t { XY, YZ, XZ, Custom };

const char* toString(SketchPlaneKind kind) noexcept;

struct SketchPlane {
  SketchPlaneKind kind = SketchPlaneKind::XY;
  double origin[3] = {0.0, 0.0, 0.0};
  double normal[3] = {0.0, 0.0, 1.0};
  double xAxis[3] = {1.0, 0.0, 0.0};

  static SketchPlane standard(SketchPlaneKind kind) noexcept;
  // Orthonormalises: xAxis is projected off the normal and both are normalised.
  // Returns false and leaves `out` untouched when the frame is degenerate (a
  // zero axis, or an xAxis parallel to the normal) — a plane that silently
  // repaired itself into some other plane would place every entity somewhere
  // the author did not ask for.
  static bool custom(const double origin[3], const double normal[3], const double xAxis[3],
                     SketchPlane& out) noexcept;

  void yAxis(double out[3]) const noexcept;
  void toWorld(double u, double v, double out[3]) const noexcept;
  bool orthonormal() const noexcept;
  // The plane POLY can express: origin at the world origin, +Z normal, +X xAxis.
  // Anything else has to become a WIRE, because POLY's points are read as Z=0
  // world coordinates.
  bool isWorldXY() const noexcept;
};

// ── entities ────────────────────────────────────────────────────────────────
// Parameter layout, in the order the flat vector holds them:
//   Point    x, y                                    2
//   Line     x0, y0, x1, y1                          4
//   Circle   cx, cy, r                               3
//   Arc      cx, cy, r, startAngle, endAngle         5   (angles in RADIANS)
//   Ellipse  cx, cy, rx, ry, rotation                5   (rotation in RADIANS)
//   Spline   x0, y0, x1, y1, ... xn, yn              2n  (interpolated, open)
//
// Angles are stored in radians because every residual that touches one is a
// trigonometric function of it, and a degree-to-radian conversion inside a
// residual is a constant factor smeared through the Jacobian for no reason. The
// AUTHORING api takes degrees, which is what a UI and the IR both speak.
enum class SketchEntityKind : std::uint8_t { Point, Line, Arc, Circle, Ellipse, Spline };

const char* toString(SketchEntityKind kind) noexcept;

// Which characteristic point of an entity a constraint is talking about.
// `Self` means the entity as a whole (a line as a direction, a circle as a
// radius) rather than any one of its points.
enum class SketchPointRole : std::uint8_t { Self, Start, End, Center };

const char* toString(SketchPointRole role) noexcept;

struct SketchEntity {
  SketchEntityKind kind = SketchEntityKind::Point;
  std::string name;               // stable, unique within the sketch
  bool construction = false;      // reference geometry: never part of a profile
  std::vector<double> params;
};

inline constexpr int kNoSketchEntity = -1;

// One operand of a constraint: an entity, and optionally one of its points.
struct SketchRef {
  int entity = kNoSketchEntity;
  SketchPointRole role = SketchPointRole::Self;

  bool valid() const noexcept { return entity >= 0; }
};

SketchRef sketchRef(int entity) noexcept;
SketchRef sketchRef(int entity, SketchPointRole role) noexcept;

class Sketch {
 public:
  Sketch() = default;
  explicit Sketch(const SketchPlane& plane) : plane_(plane) {}

  const SketchPlane& plane() const noexcept { return plane_; }
  // Refuses a non-orthonormal frame rather than repairing it; see
  // SketchPlane::custom.
  bool setPlane(const SketchPlane& plane) noexcept;

  // ── authoring ─────────────────────────────────────────────────────────────
  // Every one returns the entity index, or kNoSketchEntity when refused. A name
  // is refused when it is empty or already taken: constraints and diagnostics
  // name entities, and two entities with one name makes a conflict report a lie.
  int addPoint(const std::string& name, double x, double y, bool construction = false);
  int addLine(const std::string& name, double x0, double y0, double x1, double y1,
              bool construction = false);
  int addCircle(const std::string& name, double cx, double cy, double r,
                bool construction = false);
  // Angles in DEGREES, measured from the plane's +u axis, counter-clockwise.
  int addArc(const std::string& name, double cx, double cy, double r, double startDeg,
             double endDeg, bool construction = false);
  int addEllipse(const std::string& name, double cx, double cy, double rx, double ry,
                 double rotationDeg, bool construction = false);
  // `controlPoints` is a flat u,v list; at least two points, even length.
  int addSpline(const std::string& name, const std::vector<double>& controlPoints,
                bool construction = false);

  std::size_t entityCount() const noexcept { return entities_.size(); }
  const SketchEntity* entity(int index) const noexcept;
  int find(const std::string& name) const noexcept;
  bool setConstruction(int index, bool construction) noexcept;

  // ── the flat parameter vector ─────────────────────────────────────────────
  std::size_t paramCount() const noexcept;
  // Index of the entity's first parameter, or paramCount() for a bad index.
  std::size_t paramBase(int index) const noexcept;
  std::size_t paramCountOf(int index) const noexcept;
  std::vector<double> parameters() const;
  // Refuses a vector of the wrong length and mutates nothing: a partially
  // applied solution is a sketch that is neither the input nor the answer.
  bool setParameters(const std::vector<double>& values);

  // ── entity queries in the plane ───────────────────────────────────────────
  // How many degrees of freedom this sketch has before any constraint.
  std::size_t degreesOfFreedom() const noexcept { return paramCount(); }

  // Tessellate one entity into (u, v) pairs. A Line gives 2 points, a Circle and
  // an Ellipse give `segments` points around the full loop, an Arc gives
  // `segments + 1` from start to end, a Spline gives `segments` points along a
  // Catmull-Rom interpolation through its control points, and a Point gives 1.
  std::vector<double> polyline(int index, std::size_t segments) const;

 private:
  SketchPlane plane_{};
  std::vector<SketchEntity> entities_;
};

// ── pure readers over an ARBITRARY parameter vector ─────────────────────────
// These are what the solver differentiates. They take the parameter vector
// explicitly rather than reading the sketch's own, because a numeric Jacobian
// evaluates at x + h*e_j without ever writing that perturbation back — a
// mutate-evaluate-restore round trip is how a failed evaluation leaves the
// document holding a perturbed sketch.
//
// Every one returns false rather than a plausible number when the reference does
// not name a real quantity (role Center on a Line, role Start on a Circle, an
// entity index out of range). "Diagnose, never refuse" applies to the SKETCH;
// a reference to a point that does not exist is a malformed constraint, and it
// is reported by name, not silently evaluated as (0, 0).
bool resolvePoint(const Sketch& sketch, const std::vector<double>& params, const SketchRef& ref,
                  double& x, double& y);
// The entity's characteristic direction: a Line's start->end, a Spline's
// first->last chord, an Ellipse's major axis. NOT normalised — residuals that
// need a unit vector normalise themselves, and a normalisation inside here would
// be a division by a length the solver is allowed to drive to zero.
bool resolveDirection(const Sketch& sketch, const std::vector<double>& params, int entity,
                      double& dx, double& dy);
bool resolveRadius(const Sketch& sketch, const std::vector<double>& params, int entity, double& r);
// A Line's length, a Circle's/Arc's circumference-defining radius is NOT this:
// `resolveLength` is the quantity an Equal constraint compares on curves that
// have one (Line, Spline chord). Circles and arcs compare radii instead.
bool resolveLength(const Sketch& sketch, const std::vector<double>& params, int entity, double& len);

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCH_HPP
