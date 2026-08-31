#include "forge/ui/SketchScene.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/Types.hpp"

namespace forge::ui {
namespace {

constexpr double kTwoPi = 6.283185307179586476925286766559;

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void cross3(const double a[3], const double b[3], double out[3]) noexcept {
  const double x = a[1] * b[2] - a[2] * b[1];
  const double y = a[2] * b[0] - a[0] * b[2];
  const double z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

bool normalize3(double v[3]) noexcept {
  const double n = std::sqrt(dot3(v, v));
  if (!(n > 1.0e-12)) return false;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
  return true;
}

// Wrap into [0, 2*pi). Used for every arc sweep question, so a single definition
// keeps "is this angle on the arc" and "how long is the arc" from disagreeing.
double wrapAngle(double a) noexcept {
  double r = std::fmod(a, kTwoPi);
  if (r < 0.0) r += kTwoPi;
  return r;
}

bool isCircular(SketchEntityKind k) noexcept {
  return k == SketchEntityKind::Circle || k == SketchEntityKind::Arc;
}

}  // namespace

// ── plane ───────────────────────────────────────────────────────────────────
const char* toString(SketchPlaneKind kind) noexcept {
  switch (kind) {
    case SketchPlaneKind::XY:    return "xy";
    case SketchPlaneKind::XZ:    return "xz";
    case SketchPlaneKind::YZ:    return "yz";
    case SketchPlaneKind::Face:  return "face";
    case SketchPlaneKind::Datum: return "datum";
  }
  return "xy";
}

void SketchPlane::normal(double out[3]) const noexcept { cross3(xAxis, yAxis, out); }

bool SketchPlane::orthonormal(double tol) const noexcept {
  const double xx = dot3(xAxis, xAxis);
  const double yy = dot3(yAxis, yAxis);
  const double xy = dot3(xAxis, yAxis);
  return std::fabs(xx - 1.0) <= tol && std::fabs(yy - 1.0) <= tol && std::fabs(xy) <= tol;
}

void SketchPlane::toModel(double u, double v, double out[3]) const noexcept {
  for (std::size_t i = 0; i < 3; ++i) out[i] = origin[i] + u * xAxis[i] + v * yAxis[i];
}

double SketchPlane::toSketch(const double p[3], double& u, double& v) const noexcept {
  const double d[3] = {p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]};
  u = dot3(d, xAxis);
  v = dot3(d, yAxis);
  double n[3];
  normal(n);
  return dot3(d, n);
}

SketchPlane basePlane(SketchPlaneKind kind) {
  SketchPlane p;
  p.kind = kind;
  p.origin[0] = p.origin[1] = p.origin[2] = 0.0;
  switch (kind) {
    case SketchPlaneKind::XZ:
      p.xAxis[0] = 1.0; p.xAxis[1] = 0.0; p.xAxis[2] = 0.0;
      p.yAxis[0] = 0.0; p.yAxis[1] = 0.0; p.yAxis[2] = 1.0;
      break;
    case SketchPlaneKind::YZ:
      p.xAxis[0] = 0.0; p.xAxis[1] = 1.0; p.xAxis[2] = 0.0;
      p.yAxis[0] = 0.0; p.yAxis[1] = 0.0; p.yAxis[2] = 1.0;
      break;
    // Face and Datum have no canonical basis; asking for one is a caller bug, and
    // returning XY (rather than something arbitrary) is the answer a caller can
    // check with `kind`.
    case SketchPlaneKind::XY:
    case SketchPlaneKind::Face:
    case SketchPlaneKind::Datum:
    default:
      p.kind = kind;
      p.xAxis[0] = 1.0; p.xAxis[1] = 0.0; p.xAxis[2] = 0.0;
      p.yAxis[0] = 0.0; p.yAxis[1] = 1.0; p.yAxis[2] = 0.0;
      break;
  }
  return p;
}

SketchViewTarget sketchViewTarget(const SketchPlane& plane, double distance) {
  SketchViewTarget t;
  double n[3];
  plane.normal(n);
  if (!normalize3(n)) { n[0] = 0.0; n[1] = 0.0; n[2] = 1.0; }
  // A non-positive distance would put the eye AT the target (or behind it), and
  // a camera that looks at the point it occupies renders nothing. Fall back to a
  // unit standoff rather than emitting a degenerate view.
  const double d = distance > 0.0 ? distance : 1.0;
  for (std::size_t i = 0; i < 3; ++i) {
    t.target[i] = plane.origin[i];
    t.eye[i] = plane.origin[i] + d * n[i];
    t.up[i] = plane.yAxis[i];
  }
  return t;
}

bool planeFromFace(const EntityRef& face, const double origin[3], const double normal[3],
                   SketchPlane& out) {
  double n[3] = {normal[0], normal[1], normal[2]};
  if (!normalize3(n)) return false;

  // Pick the world axis LEAST aligned with the normal. Any in-plane X axis is
  // geometrically valid; determinism is the property that matters, because the
  // same face must give the same u,v every time the sketch is re-opened -- a
  // rule that picked "the first axis not parallel" flips between two candidates
  // under a tiny normal perturbation and silently rotates the sketch by 90 deg.
  std::size_t pick = 0;
  double best = std::fabs(n[0]);
  for (std::size_t i = 1; i < 3; ++i) {
    const double a = std::fabs(n[i]);
    if (a < best) { best = a; pick = i; }
  }
  double x[3] = {0.0, 0.0, 0.0};
  x[pick] = 1.0;
  const double d = dot3(x, n);
  for (std::size_t i = 0; i < 3; ++i) x[i] -= d * n[i];
  if (!normalize3(x)) return false;

  double y[3];
  cross3(n, x, y);
  if (!normalize3(y)) return false;

  out.kind = SketchPlaneKind::Face;
  out.host = face;
  for (std::size_t i = 0; i < 3; ++i) {
    out.origin[i] = origin[i];
    out.xAxis[i] = x[i];
    out.yAxis[i] = y[i];
  }
  return true;
}

// ── entities ────────────────────────────────────────────────────────────────
const char* toString(SketchEntityKind kind) noexcept {
  switch (kind) {
    case SketchEntityKind::Point:  return "point";
    case SketchEntityKind::Line:   return "line";
    case SketchEntityKind::Circle: return "circle";
    case SketchEntityKind::Arc:    return "arc";
  }
  return "point";
}

std::size_t variableCountFor(SketchEntityKind kind) noexcept {
  switch (kind) {
    case SketchEntityKind::Point:  return 2;
    case SketchEntityKind::Line:   return 4;
    case SketchEntityKind::Circle: return 3;
    case SketchEntityKind::Arc:    return 5;
  }
  return 0;
}

const char* toString(SketchPointRole role) noexcept {
  switch (role) {
    case SketchPointRole::Start:  return "start";
    case SketchPointRole::End:    return "end";
    case SketchPointRole::Centre: return "centre";
  }
  return "start";
}

std::string SketchPointId::key() const {
  return std::to_string(entity) + "." + toString(role);
}

bool operator==(const SketchPointId& a, const SketchPointId& b) noexcept {
  return a.entity == b.entity && a.role == b.role;
}
bool operator!=(const SketchPointId& a, const SketchPointId& b) noexcept { return !(a == b); }

bool SketchEntity::point(SketchPointRole role, double& x, double& y) const noexcept {
  switch (kind) {
    case SketchEntityKind::Point:
      if (role == SketchPointRole::End) return false;
      x = v[0]; y = v[1];
      return true;
    case SketchEntityKind::Line:
      if (role == SketchPointRole::Start) { x = v[0]; y = v[1]; return true; }
      if (role == SketchPointRole::End)   { x = v[2]; y = v[3]; return true; }
      x = 0.5 * (v[0] + v[2]);
      y = 0.5 * (v[1] + v[3]);
      return true;
    case SketchEntityKind::Circle:
      if (role != SketchPointRole::Centre) return false;
      x = v[0]; y = v[1];
      return true;
    case SketchEntityKind::Arc:
      if (role == SketchPointRole::Centre) { x = v[0]; y = v[1]; return true; }
      {
        const double a = (role == SketchPointRole::Start) ? v[3] : v[4];
        x = v[0] + v[2] * std::cos(a);
        y = v[1] + v[2] * std::sin(a);
      }
      return true;
  }
  return false;
}

double SketchEntity::length() const noexcept {
  switch (kind) {
    case SketchEntityKind::Point:  return 0.0;
    case SketchEntityKind::Line:   return std::hypot(v[2] - v[0], v[3] - v[1]);
    case SketchEntityKind::Circle: return kTwoPi * std::fabs(v[2]);
    case SketchEntityKind::Arc:    return std::fabs(v[2]) * wrapAngle(v[4] - v[3]);
  }
  return 0.0;
}

bool SketchEntity::direction(double& dx, double& dy) const noexcept {
  if (kind != SketchEntityKind::Line) return false;
  const double ax = v[2] - v[0];
  const double ay = v[3] - v[1];
  const double n = std::hypot(ax, ay);
  if (!(n > 1.0e-12)) return false;
  dx = ax / n;
  dy = ay / n;
  return true;
}

double SketchEntity::distanceTo(double x, double y, double& px, double& py) const noexcept {
  switch (kind) {
    case SketchEntityKind::Point:
      px = v[0]; py = v[1];
      return std::hypot(x - px, y - py);
    case SketchEntityKind::Line: {
      const double ax = v[0], ay = v[1], bx = v[2], by = v[3];
      const double dx = bx - ax, dy = by - ay;
      const double len2 = dx * dx + dy * dy;
      double t = 0.0;
      if (len2 > 1.0e-24) t = ((x - ax) * dx + (y - ay) * dy) / len2;
      t = std::min(1.0, std::max(0.0, t));
      px = ax + t * dx;
      py = ay + t * dy;
      return std::hypot(x - px, y - py);
    }
    case SketchEntityKind::Circle: {
      const double dx = x - v[0], dy = y - v[1];
      const double d = std::hypot(dx, dy);
      if (d < 1.0e-12) {  // dead centre: every rim point is equidistant, pick one
        px = v[0] + v[2];
        py = v[1];
        return std::fabs(v[2]);
      }
      px = v[0] + v[2] * dx / d;
      py = v[1] + v[2] * dy / d;
      return std::fabs(d - v[2]);
    }
    case SketchEntityKind::Arc: {
      const double dx = x - v[0], dy = y - v[1];
      const double d = std::hypot(dx, dy);
      const double sweep = wrapAngle(v[4] - v[3]);
      if (d > 1.0e-12) {
        const double t = wrapAngle(std::atan2(dy, dx) - v[3]);
        if (t <= sweep) {  // the projection lands ON the swept part
          px = v[0] + v[2] * dx / d;
          py = v[1] + v[2] * dy / d;
          return std::fabs(d - v[2]);
        }
      }
      // Off the sweep: the nearest point is an endpoint, not the rim. A snap
      // engine that ignored this would offer "on entity" beyond the arc's ends.
      double sx = 0.0, sy = 0.0, ex = 0.0, ey = 0.0;
      point(SketchPointRole::Start, sx, sy);
      point(SketchPointRole::End, ex, ey);
      const double ds = std::hypot(x - sx, y - sy);
      const double de = std::hypot(x - ex, y - ey);
      if (ds <= de) { px = sx; py = sy; return ds; }
      px = ex; py = ey;
      return de;
    }
  }
  px = x;
  py = y;
  return 0.0;
}

SketchEntity makeSketchPoint(double x, double y) {
  SketchEntity e;
  e.kind = SketchEntityKind::Point;
  e.v[0] = x; e.v[1] = y;
  return e;
}
SketchEntity makeSketchLine(double x0, double y0, double x1, double y1) {
  SketchEntity e;
  e.kind = SketchEntityKind::Line;
  e.v[0] = x0; e.v[1] = y0; e.v[2] = x1; e.v[3] = y1;
  return e;
}
SketchEntity makeSketchCircle(double cx, double cy, double r) {
  SketchEntity e;
  e.kind = SketchEntityKind::Circle;
  e.v[0] = cx; e.v[1] = cy; e.v[2] = r;
  return e;
}
SketchEntity makeSketchArc(double cx, double cy, double r, double a0, double a1) {
  SketchEntity e;
  e.kind = SketchEntityKind::Arc;
  e.v[0] = cx; e.v[1] = cy; e.v[2] = r; e.v[3] = a0; e.v[4] = a1;
  return e;
}

// ── constraints ─────────────────────────────────────────────────────────────
const char* toString(SketchConstraintKind kind) noexcept {
  switch (kind) {
    case SketchConstraintKind::Coincident:         return "coincident";
    case SketchConstraintKind::PointOnEntity:      return "point_on_entity";
    case SketchConstraintKind::Horizontal:         return "horizontal";
    case SketchConstraintKind::Vertical:           return "vertical";
    case SketchConstraintKind::Parallel:           return "parallel";
    case SketchConstraintKind::Perpendicular:      return "perpendicular";
    case SketchConstraintKind::Tangent:            return "tangent";
    case SketchConstraintKind::Equal:              return "equal";
    case SketchConstraintKind::Concentric:         return "concentric";
    case SketchConstraintKind::Midpoint:           return "midpoint";
    case SketchConstraintKind::Symmetric:          return "symmetric";
    case SketchConstraintKind::Fix:                return "fix";
    case SketchConstraintKind::Distance:           return "distance";
    case SketchConstraintKind::HorizontalDistance: return "horizontal_distance";
    case SketchConstraintKind::VerticalDistance:   return "vertical_distance";
    case SketchConstraintKind::Radius:             return "radius";
    case SketchConstraintKind::Diameter:           return "diameter";
    case SketchConstraintKind::Angle:              return "angle";
  }
  return "coincident";
}

std::vector<SketchConstraintKind> allSketchConstraintKinds() {
  std::vector<SketchConstraintKind> out;
  out.reserve(kSketchConstraintKindCount);
  for (std::size_t i = 0; i < kSketchConstraintKindCount; ++i)
    out.push_back(static_cast<SketchConstraintKind>(i));
  return out;
}

bool sketchConstraintFromString(const std::string& name, SketchConstraintKind& out) noexcept {
  for (SketchConstraintKind k : allSketchConstraintKinds()) {
    if (name == toString(k)) { out = k; return true; }
  }
  return false;
}

bool isSketchDimension(SketchConstraintKind kind) noexcept {
  switch (kind) {
    case SketchConstraintKind::Distance:
    case SketchConstraintKind::HorizontalDistance:
    case SketchConstraintKind::VerticalDistance:
    case SketchConstraintKind::Radius:
    case SketchConstraintKind::Diameter:
    case SketchConstraintKind::Angle:
      return true;
    default:
      return false;
  }
}

const char* sketchConstraintGlyph(SketchConstraintKind kind) noexcept {
  switch (kind) {
    case SketchConstraintKind::Coincident:         return "o";
    case SketchConstraintKind::PointOnEntity:      return "-o";
    case SketchConstraintKind::Horizontal:         return "H";
    case SketchConstraintKind::Vertical:           return "V";
    case SketchConstraintKind::Parallel:           return "//";
    case SketchConstraintKind::Perpendicular:      return "|_";
    case SketchConstraintKind::Tangent:            return "T";
    case SketchConstraintKind::Equal:              return "=";
    case SketchConstraintKind::Concentric:         return "(o)";
    case SketchConstraintKind::Midpoint:           return "M";
    case SketchConstraintKind::Symmetric:          return "><";
    case SketchConstraintKind::Fix:                return "X";
    case SketchConstraintKind::Distance:           return "d";
    case SketchConstraintKind::HorizontalDistance: return "dx";
    case SketchConstraintKind::VerticalDistance:   return "dy";
    case SketchConstraintKind::Radius:             return "R";
    case SketchConstraintKind::Diameter:           return "D";
    case SketchConstraintKind::Angle:              return "A";
  }
  return "?";
}

// ── the scene ───────────────────────────────────────────────────────────────
int SketchScene::add(const SketchEntity& entity) {
  SketchEntity e = entity;
  if (variableCountFor(e.kind) == 0) return 0;
  if (isCircular(e.kind) && !(e.v[2] > 0.0)) return 0;  // a zero radius is not a circle
  e.id = nextEntityId_++;
  entities_.push_back(e);
  return e.id;
}

int SketchScene::addPoint(double x, double y) { return add(makeSketchPoint(x, y)); }
int SketchScene::addLine(double x0, double y0, double x1, double y1) {
  return add(makeSketchLine(x0, y0, x1, y1));
}
int SketchScene::addCircle(double cx, double cy, double r) {
  return add(makeSketchCircle(cx, cy, r));
}
int SketchScene::addArc(double cx, double cy, double r, double a0, double a1) {
  return add(makeSketchArc(cx, cy, r, a0, a1));
}

const SketchEntity* SketchScene::entity(int id) const noexcept {
  for (const SketchEntity& e : entities_) {
    if (e.id == id) return &e;
  }
  return nullptr;
}

SketchEntity* SketchScene::mutableEntity(int id) noexcept {
  for (SketchEntity& e : entities_) {
    if (e.id == id) return &e;
  }
  return nullptr;
}

bool SketchScene::removeEntity(int id, std::size_t* constraintsRemoved) {
  const auto it = std::find_if(entities_.begin(), entities_.end(),
                               [id](const SketchEntity& e) { return e.id == id; });
  if (it == entities_.end()) {
    if (constraintsRemoved != nullptr) *constraintsRemoved = 0;
    return false;
  }
  entities_.erase(it);

  const std::size_t before = constraints_.size();
  constraints_.erase(std::remove_if(constraints_.begin(), constraints_.end(),
                                    [id](const SketchConstraint& c) {
                                      return c.pointA.entity == id || c.pointB.entity == id ||
                                             c.entityA == id || c.entityB == id ||
                                             c.entityC == id;
                                    }),
                     constraints_.end());
  if (constraintsRemoved != nullptr) *constraintsRemoved = before - constraints_.size();
  return true;
}

bool SketchScene::pointPosition(const SketchPointId& p, double& x, double& y) const noexcept {
  const SketchEntity* e = entity(p.entity);
  if (e == nullptr) return false;
  return e->point(p.role, x, y);
}

bool SketchScene::wellFormed(const SketchConstraint& c, std::string& why) const {
  const auto namePoint = [](const SketchPointId& p) {
    return std::string("point ") + p.key();
  };
  const auto needPoint = [&](const SketchPointId& p) {
    double x = 0.0, y = 0.0;
    if (!p.valid()) { why = "constraint names no point where one is required"; return false; }
    if (entity(p.entity) == nullptr) {
      why = "entity " + std::to_string(p.entity) + " does not exist";
      return false;
    }
    if (!pointPosition(p, x, y)) {
      why = namePoint(p) + " is not a point of " + toString(entity(p.entity)->kind) + " " +
            std::to_string(p.entity);
      return false;
    }
    return true;
  };
  const auto needEntity = [&](int id, const char* what) {
    if (id <= 0) { why = std::string("constraint names no ") + what; return false; }
    if (entity(id) == nullptr) {
      why = "entity " + std::to_string(id) + " does not exist";
      return false;
    }
    return true;
  };
  const auto needLine = [&](int id) {
    if (!needEntity(id, "line")) return false;
    if (entity(id)->kind != SketchEntityKind::Line) {
      why = "entity " + std::to_string(id) + " is a " + toString(entity(id)->kind) +
            ", and this constraint needs a line";
      return false;
    }
    return true;
  };
  const auto needCircular = [&](int id) {
    if (!needEntity(id, "circle or arc")) return false;
    if (!isCircular(entity(id)->kind)) {
      why = "entity " + std::to_string(id) + " is a " + toString(entity(id)->kind) +
            ", and this constraint needs a circle or an arc";
      return false;
    }
    return true;
  };

  why.clear();
  switch (c.kind) {
    case SketchConstraintKind::Coincident:
      if (!needPoint(c.pointA) || !needPoint(c.pointB)) return false;
      if (c.pointA == c.pointB) { why = "a point cannot be coincident with itself"; return false; }
      return true;
    case SketchConstraintKind::PointOnEntity:
      if (!needPoint(c.pointA) || !needEntity(c.entityB, "host entity")) return false;
      if (entity(c.entityB)->kind == SketchEntityKind::Point) {
        why = "entity " + std::to_string(c.entityB) + " is a point; use coincident";
        return false;
      }
      if (c.pointA.entity == c.entityB) {
        why = "entity " + std::to_string(c.entityB) + " cannot host its own point";
        return false;
      }
      return true;
    case SketchConstraintKind::Horizontal:
    case SketchConstraintKind::Vertical:
      return needLine(c.entityA);
    case SketchConstraintKind::Parallel:
    case SketchConstraintKind::Perpendicular:
    case SketchConstraintKind::Angle:
      if (!needLine(c.entityA) || !needLine(c.entityB)) return false;
      if (c.entityA == c.entityB) {
        why = "entity " + std::to_string(c.entityA) + " cannot be constrained against itself";
        return false;
      }
      return true;
    case SketchConstraintKind::Tangent:
      if (!needEntity(c.entityA, "first entity") || !needEntity(c.entityB, "second entity"))
        return false;
      if (c.entityA == c.entityB) { why = "an entity cannot be tangent to itself"; return false; }
      if (!isCircular(entity(c.entityB)->kind)) {
        why = "entity " + std::to_string(c.entityB) +
              " must be the circle or arc of a tangency";
        return false;
      }
      if (entity(c.entityA)->kind != SketchEntityKind::Line && !isCircular(entity(c.entityA)->kind)) {
        why = "entity " + std::to_string(c.entityA) +
              " is a point; tangency needs a line, circle or arc";
        return false;
      }
      return true;
    case SketchConstraintKind::Equal:
      if (!needEntity(c.entityA, "first entity") || !needEntity(c.entityB, "second entity"))
        return false;
      if (c.entityA == c.entityB) { why = "an entity is always equal to itself"; return false; }
      if (entity(c.entityA)->kind == SketchEntityKind::Line &&
          entity(c.entityB)->kind == SketchEntityKind::Line)
        return true;
      if (isCircular(entity(c.entityA)->kind) && isCircular(entity(c.entityB)->kind)) return true;
      why = "equal needs two lines or two circular entities, not a " +
            std::string(toString(entity(c.entityA)->kind)) + " and a " +
            std::string(toString(entity(c.entityB)->kind));
      return false;
    case SketchConstraintKind::Concentric:
      if (!needCircular(c.entityA) || !needCircular(c.entityB)) return false;
      if (c.entityA == c.entityB) { why = "an entity is concentric with itself"; return false; }
      return true;
    case SketchConstraintKind::Midpoint:
      if (!needPoint(c.pointA) || !needLine(c.entityB)) return false;
      return true;
    case SketchConstraintKind::Symmetric:
      if (!needPoint(c.pointA) || !needPoint(c.pointB) || !needLine(c.entityC)) return false;
      if (c.pointA == c.pointB) { why = "a point is symmetric with itself"; return false; }
      return true;
    case SketchConstraintKind::Fix:
      return needEntity(c.entityA, "entity to fix");
    case SketchConstraintKind::Distance:
    case SketchConstraintKind::HorizontalDistance:
    case SketchConstraintKind::VerticalDistance:
      if (!needPoint(c.pointA) || !needPoint(c.pointB)) return false;
      if (c.pointA == c.pointB) { why = "a point is zero from itself"; return false; }
      if (c.kind == SketchConstraintKind::Distance && c.value < 0.0) {
        why = "a distance of " + std::to_string(c.value) + " is negative";
        return false;
      }
      return true;
    case SketchConstraintKind::Radius:
    case SketchConstraintKind::Diameter:
      if (!needCircular(c.entityA)) return false;
      if (!(c.value > 0.0)) {
        why = std::string(toString(c.kind)) + " of entity " + std::to_string(c.entityA) +
              " must be positive";
        return false;
      }
      return true;
  }
  why = "unknown constraint kind";
  return false;
}

int SketchScene::addConstraint(const SketchConstraint& c, std::string* why) {
  std::string reason;
  if (!wellFormed(c, reason)) {
    if (why != nullptr) *why = reason;
    return 0;
  }
  SketchConstraint copy = c;
  copy.id = nextConstraintId_++;
  constraints_.push_back(copy);
  if (why != nullptr) why->clear();
  return copy.id;
}

bool SketchScene::removeConstraint(int id) {
  const auto it = std::find_if(constraints_.begin(), constraints_.end(),
                               [id](const SketchConstraint& c) { return c.id == id; });
  if (it == constraints_.end()) return false;
  constraints_.erase(it);
  return true;
}

const SketchConstraint* SketchScene::constraint(int id) const noexcept {
  for (const SketchConstraint& c : constraints_) {
    if (c.id == id) return &c;
  }
  return nullptr;
}

SketchConstraint* SketchScene::mutableConstraint(int id) noexcept {
  for (SketchConstraint& c : constraints_) {
    if (c.id == id) return &c;
  }
  return nullptr;
}

std::vector<int> SketchScene::constraintsOn(int entityId) const {
  std::vector<int> out;
  for (const SketchConstraint& c : constraints_) {
    if (c.pointA.entity == entityId || c.pointB.entity == entityId || c.entityA == entityId ||
        c.entityB == entityId || c.entityC == entityId)
      out.push_back(c.id);
  }
  return out;
}

void SketchScene::clear() noexcept {
  entities_.clear();
  constraints_.clear();
  // Ids deliberately keep climbing. A cleared sketch that restarts at 1 makes a
  // stale reference held anywhere -- an undo record, a selection, a log line --
  // silently name new geometry.
}

std::size_t SketchScene::variableCount() const noexcept {
  std::size_t n = 0;
  for (const SketchEntity& e : entities_) n += e.variableCount();
  return n;
}

bool SketchScene::variableBase(int entityId, std::size_t& base) const noexcept {
  std::size_t at = 0;
  for (const SketchEntity& e : entities_) {
    if (e.id == entityId) { base = at; return true; }
    at += e.variableCount();
  }
  return false;
}

int SketchScene::entityForVariable(std::size_t column) const noexcept {
  std::size_t at = 0;
  for (const SketchEntity& e : entities_) {
    const std::size_t n = e.variableCount();
    if (column < at + n) return e.id;
    at += n;
  }
  return 0;
}

std::string SketchScene::variableName(std::size_t column) const {
  std::size_t at = 0;
  for (const SketchEntity& e : entities_) {
    const std::size_t n = e.variableCount();
    if (column < at + n) {
      const std::size_t k = column - at;
      const char* names[5] = {"?", "?", "?", "?", "?"};
      switch (e.kind) {
        case SketchEntityKind::Point:
          names[0] = "x"; names[1] = "y";
          break;
        case SketchEntityKind::Line:
          names[0] = "x0"; names[1] = "y0"; names[2] = "x1"; names[3] = "y1";
          break;
        case SketchEntityKind::Circle:
          names[0] = "cx"; names[1] = "cy"; names[2] = "r";
          break;
        case SketchEntityKind::Arc:
          names[0] = "cx"; names[1] = "cy"; names[2] = "r"; names[3] = "a0"; names[4] = "a1";
          break;
      }
      return std::string(toString(e.kind)) + " " + std::to_string(e.id) + "." + names[k];
    }
    at += n;
  }
  return "<no such variable>";
}

void SketchScene::packVariables(std::vector<double>& out) const {
  out.clear();
  out.reserve(variableCount());
  for (const SketchEntity& e : entities_) {
    const std::size_t n = e.variableCount();
    for (std::size_t i = 0; i < n; ++i) out.push_back(e.v[i]);
  }
}

bool SketchScene::unpackVariables(const std::vector<double>& in) {
  if (in.size() != variableCount()) return false;
  std::size_t at = 0;
  for (SketchEntity& e : entities_) {
    const std::size_t n = e.variableCount();
    for (std::size_t i = 0; i < n; ++i) e.v[i] = in[at + i];
    at += n;
  }
  return true;
}

std::size_t equationCountFor(const SketchScene& scene, const SketchConstraint& c) noexcept {
  if (!c.driving) return 0;
  std::string why;
  if (!scene.wellFormed(c, why)) return 0;
  switch (c.kind) {
    case SketchConstraintKind::Coincident:
    case SketchConstraintKind::Concentric:
    case SketchConstraintKind::Midpoint:
    case SketchConstraintKind::Symmetric:
      return 2;
    case SketchConstraintKind::Fix: {
      const SketchEntity* e = scene.entity(c.entityA);
      return e == nullptr ? 0 : e->variableCount();
    }
    default:
      return 1;
  }
}

// ── the DOF report ──────────────────────────────────────────────────────────
const char* toString(SketchDofStatus status) noexcept {
  switch (status) {
    case SketchDofStatus::Empty: return "empty";
    case SketchDofStatus::Under: return "under_constrained";
    case SketchDofStatus::Fully: return "fully_constrained";
    case SketchDofStatus::Over:  return "over_constrained";
  }
  return "empty";
}

bool sketchConstraintAddsInformation(const SketchSolver& solver, const SketchScene& scene,
                                     const SketchConstraint& candidate) {
  const SketchDofReport before = solver.analyse(scene);
  SketchScene probe = scene;
  std::string why;
  if (probe.addConstraint(candidate, &why) == 0) return false;  // malformed says nothing
  const SketchDofReport after = solver.analyse(probe);
  return after.rank > before.rank;
}

std::vector<int> SketchDofReport::conflictHighlight() const {
  std::vector<int> out;
  for (const SketchConflict& c : conflicts) {
    out.push_back(c.constraintId);
    for (int with : c.withConstraints) out.push_back(with);
  }
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

}  // namespace forge::ui
