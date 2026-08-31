#include "forge/ui/Sketch.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace forge::ui {
namespace {

constexpr double kPi = 3.14159265358979323846;

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

double norm3(const double a[3]) noexcept { return std::sqrt(dot3(a, a)); }

bool closeTo(double a, double b, double tol) noexcept { return std::fabs(a - b) <= tol; }

double radians(double degrees) noexcept { return degrees * kPi / 180.0; }

// Catmull-Rom through four control points at local parameter t in [0, 1]. The
// spline INTERPOLATES its control points, which is the only choice that lets a
// coincident constraint on a spline endpoint mean what a user thinks it means:
// with a Bezier/B-spline hull the curve does not pass through the point the
// constraint pinned, so the solver would satisfy the constraint and the drawing
// would still show a gap.
double catmullRom(double p0, double p1, double p2, double p3, double t) noexcept {
  const double t2 = t * t;
  const double t3 = t2 * t;
  return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
                (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}

std::size_t paramCountFor(const SketchEntity& e) noexcept { return e.params.size(); }

}  // namespace

// ── enum spellings ──────────────────────────────────────────────────────────
const char* toString(SketchPlaneKind kind) noexcept {
  switch (kind) {
    case SketchPlaneKind::XY:     return "XY";
    case SketchPlaneKind::YZ:     return "YZ";
    case SketchPlaneKind::XZ:     return "XZ";
    case SketchPlaneKind::Custom: return "custom";
  }
  return "custom";
}

const char* toString(SketchEntityKind kind) noexcept {
  switch (kind) {
    case SketchEntityKind::Point:   return "point";
    case SketchEntityKind::Line:    return "line";
    case SketchEntityKind::Arc:     return "arc";
    case SketchEntityKind::Circle:  return "circle";
    case SketchEntityKind::Ellipse: return "ellipse";
    case SketchEntityKind::Spline:  return "spline";
  }
  return "point";
}

const char* toString(SketchPointRole role) noexcept {
  switch (role) {
    case SketchPointRole::Self:   return "self";
    case SketchPointRole::Start:  return "start";
    case SketchPointRole::End:    return "end";
    case SketchPointRole::Center: return "center";
  }
  return "self";
}

SketchRef sketchRef(int entity) noexcept { return SketchRef{entity, SketchPointRole::Self}; }

SketchRef sketchRef(int entity, SketchPointRole role) noexcept { return SketchRef{entity, role}; }

// ── the plane ───────────────────────────────────────────────────────────────
SketchPlane SketchPlane::standard(SketchPlaneKind kind) noexcept {
  SketchPlane p;
  p.kind = kind == SketchPlaneKind::Custom ? SketchPlaneKind::XY : kind;
  p.origin[0] = p.origin[1] = p.origin[2] = 0.0;
  switch (p.kind) {
    case SketchPlaneKind::XY:
      p.normal[0] = 0.0; p.normal[1] = 0.0; p.normal[2] = 1.0;
      p.xAxis[0] = 1.0; p.xAxis[1] = 0.0; p.xAxis[2] = 0.0;
      break;
    case SketchPlaneKind::YZ:
      p.normal[0] = 1.0; p.normal[1] = 0.0; p.normal[2] = 0.0;
      p.xAxis[0] = 0.0; p.xAxis[1] = 1.0; p.xAxis[2] = 0.0;
      break;
    case SketchPlaneKind::XZ:
      // Normal -Y, so that (u, v) -> (x, z) keeps a right-handed frame: with
      // +Y the v axis would come out as -Z and every sketch on the front plane
      // would be built upside down.
      p.normal[0] = 0.0; p.normal[1] = -1.0; p.normal[2] = 0.0;
      p.xAxis[0] = 1.0; p.xAxis[1] = 0.0; p.xAxis[2] = 0.0;
      break;
    case SketchPlaneKind::Custom:
      break;
  }
  return p;
}

bool SketchPlane::custom(const double origin[3], const double normal[3], const double xAxis[3],
                         SketchPlane& out) noexcept {
  const double nl = norm3(normal);
  if (!(nl > 1e-12)) return false;
  double n[3] = {normal[0] / nl, normal[1] / nl, normal[2] / nl};

  // Project the requested x axis off the normal, then normalise. A caller whose
  // axis is very slightly off the plane gets the axis they meant; a caller whose
  // axis IS the normal gets a refusal, because there is no in-plane direction to
  // recover and picking one for them would silently rotate every entity.
  const double d = dot3(xAxis, n);
  double x[3] = {xAxis[0] - d * n[0], xAxis[1] - d * n[1], xAxis[2] - d * n[2]};
  const double xl = norm3(x);
  if (!(xl > 1e-9)) return false;
  x[0] /= xl; x[1] /= xl; x[2] /= xl;

  out.kind = SketchPlaneKind::Custom;
  for (int i = 0; i < 3; ++i) {
    out.origin[i] = origin[i];
    out.normal[i] = n[i];
    out.xAxis[i] = x[i];
  }
  return true;
}

void SketchPlane::yAxis(double out[3]) const noexcept {
  out[0] = normal[1] * xAxis[2] - normal[2] * xAxis[1];
  out[1] = normal[2] * xAxis[0] - normal[0] * xAxis[2];
  out[2] = normal[0] * xAxis[1] - normal[1] * xAxis[0];
}

void SketchPlane::toWorld(double u, double v, double out[3]) const noexcept {
  double y[3];
  yAxis(y);
  for (int i = 0; i < 3; ++i) out[i] = origin[i] + u * xAxis[i] + v * y[i];
}

bool SketchPlane::orthonormal() const noexcept {
  return closeTo(norm3(normal), 1.0, 1e-9) && closeTo(norm3(xAxis), 1.0, 1e-9) &&
         closeTo(dot3(normal, xAxis), 0.0, 1e-9);
}

bool SketchPlane::isWorldXY() const noexcept {
  return orthonormal() && closeTo(origin[0], 0.0, 1e-12) && closeTo(origin[1], 0.0, 1e-12) &&
         closeTo(origin[2], 0.0, 1e-12) && closeTo(normal[0], 0.0, 1e-12) &&
         closeTo(normal[1], 0.0, 1e-12) && closeTo(normal[2], 1.0, 1e-12) &&
         closeTo(xAxis[0], 1.0, 1e-12) && closeTo(xAxis[1], 0.0, 1e-12) && closeTo(xAxis[2], 0.0, 1e-12);
}

// ── the sketch ──────────────────────────────────────────────────────────────
bool Sketch::setPlane(const SketchPlane& plane) noexcept {
  if (!plane.orthonormal()) return false;
  plane_ = plane;
  return true;
}

const SketchEntity* Sketch::entity(int index) const noexcept {
  if (index < 0 || static_cast<std::size_t>(index) >= entities_.size()) return nullptr;
  return &entities_[static_cast<std::size_t>(index)];
}

int Sketch::find(const std::string& name) const noexcept {
  for (std::size_t i = 0; i < entities_.size(); ++i) {
    if (entities_[i].name == name) return static_cast<int>(i);
  }
  return kNoSketchEntity;
}

bool Sketch::setConstruction(int index, bool construction) noexcept {
  if (index < 0 || static_cast<std::size_t>(index) >= entities_.size()) return false;
  entities_[static_cast<std::size_t>(index)].construction = construction;
  return true;
}

namespace {

// One place that decides whether an entity may join the sketch, so authoring can
// never produce an entity the solver or the profile builder has to special-case
// as impossible.
bool nameAvailable(const Sketch& sketch, const std::string& name) {
  return !name.empty() && sketch.find(name) == kNoSketchEntity;
}

}  // namespace

int Sketch::addPoint(const std::string& name, double x, double y, bool construction) {
  if (!nameAvailable(*this, name)) return kNoSketchEntity;
  SketchEntity e;
  e.kind = SketchEntityKind::Point;
  e.name = name;
  e.construction = construction;
  e.params = {x, y};
  entities_.push_back(std::move(e));
  return static_cast<int>(entities_.size()) - 1;
}

int Sketch::addLine(const std::string& name, double x0, double y0, double x1, double y1,
                    bool construction) {
  if (!nameAvailable(*this, name)) return kNoSketchEntity;
  SketchEntity e;
  e.kind = SketchEntityKind::Line;
  e.name = name;
  e.construction = construction;
  e.params = {x0, y0, x1, y1};
  entities_.push_back(std::move(e));
  return static_cast<int>(entities_.size()) - 1;
}

int Sketch::addCircle(const std::string& name, double cx, double cy, double r, bool construction) {
  if (!nameAvailable(*this, name)) return kNoSketchEntity;
  // A zero or negative radius is not a circle. The solver may drive a radius
  // small, and that is its business; SEEDING one is an authoring error, and an
  // authoring error accepted here becomes an unexplainable solve later.
  if (!(r > 0.0)) return kNoSketchEntity;
  SketchEntity e;
  e.kind = SketchEntityKind::Circle;
  e.name = name;
  e.construction = construction;
  e.params = {cx, cy, r};
  entities_.push_back(std::move(e));
  return static_cast<int>(entities_.size()) - 1;
}

int Sketch::addArc(const std::string& name, double cx, double cy, double r, double startDeg,
                   double endDeg, bool construction) {
  if (!nameAvailable(*this, name)) return kNoSketchEntity;
  if (!(r > 0.0)) return kNoSketchEntity;
  SketchEntity e;
  e.kind = SketchEntityKind::Arc;
  e.name = name;
  e.construction = construction;
  e.params = {cx, cy, r, radians(startDeg), radians(endDeg)};
  entities_.push_back(std::move(e));
  return static_cast<int>(entities_.size()) - 1;
}

int Sketch::addEllipse(const std::string& name, double cx, double cy, double rx, double ry,
                       double rotationDeg, bool construction) {
  if (!nameAvailable(*this, name)) return kNoSketchEntity;
  if (!(rx > 0.0) || !(ry > 0.0)) return kNoSketchEntity;
  SketchEntity e;
  e.kind = SketchEntityKind::Ellipse;
  e.name = name;
  e.construction = construction;
  e.params = {cx, cy, rx, ry, radians(rotationDeg)};
  entities_.push_back(std::move(e));
  return static_cast<int>(entities_.size()) - 1;
}

int Sketch::addSpline(const std::string& name, const std::vector<double>& controlPoints,
                      bool construction) {
  if (!nameAvailable(*this, name)) return kNoSketchEntity;
  if (controlPoints.size() < 4 || controlPoints.size() % 2 != 0) return kNoSketchEntity;
  SketchEntity e;
  e.kind = SketchEntityKind::Spline;
  e.name = name;
  e.construction = construction;
  e.params = controlPoints;
  entities_.push_back(std::move(e));
  return static_cast<int>(entities_.size()) - 1;
}

std::size_t Sketch::paramCount() const noexcept {
  std::size_t n = 0;
  for (const SketchEntity& e : entities_) n += paramCountFor(e);
  return n;
}

std::size_t Sketch::paramBase(int index) const noexcept {
  if (index < 0 || static_cast<std::size_t>(index) >= entities_.size()) return paramCount();
  std::size_t base = 0;
  for (int i = 0; i < index; ++i) base += paramCountFor(entities_[static_cast<std::size_t>(i)]);
  return base;
}

std::size_t Sketch::paramCountOf(int index) const noexcept {
  const SketchEntity* e = entity(index);
  return e == nullptr ? 0 : paramCountFor(*e);
}

std::vector<double> Sketch::parameters() const {
  std::vector<double> out;
  out.reserve(paramCount());
  for (const SketchEntity& e : entities_) {
    out.insert(out.end(), e.params.begin(), e.params.end());
  }
  return out;
}

bool Sketch::setParameters(const std::vector<double>& values) {
  if (values.size() != paramCount()) return false;
  std::size_t at = 0;
  for (SketchEntity& e : entities_) {
    for (std::size_t k = 0; k < e.params.size(); ++k) e.params[k] = values[at + k];
    at += e.params.size();
  }
  return true;
}

// ── readers over an arbitrary parameter vector ──────────────────────────────
namespace {

// The entity's parameters inside `params`, or nullptr when the vector is not the
// right length for this sketch. Checking the LENGTH rather than trusting the
// caller matters: a stale vector from before an entity was added would otherwise
// be read past its end.
const double* slice(const Sketch& sketch, const std::vector<double>& params, int entity) {
  const SketchEntity* e = sketch.entity(entity);
  if (e == nullptr) return nullptr;
  if (params.size() != sketch.paramCount()) return nullptr;
  const std::size_t base = sketch.paramBase(entity);
  if (base + e->params.size() > params.size()) return nullptr;
  return params.data() + base;
}

}  // namespace

bool resolvePoint(const Sketch& sketch, const std::vector<double>& params, const SketchRef& ref,
                  double& x, double& y) {
  const SketchEntity* e = sketch.entity(ref.entity);
  const double* p = slice(sketch, params, ref.entity);
  if (e == nullptr || p == nullptr) return false;

  switch (e->kind) {
    case SketchEntityKind::Point:
      // A point IS its position: Self, Start, End and Center all name it. Any
      // other answer would make `coincident(point, line.start)` depend on which
      // role the caller happened to write for the point.
      x = p[0];
      y = p[1];
      return true;
    case SketchEntityKind::Line:
      if (ref.role == SketchPointRole::Start) { x = p[0]; y = p[1]; return true; }
      if (ref.role == SketchPointRole::End)   { x = p[2]; y = p[3]; return true; }
      if (ref.role == SketchPointRole::Center) {
        x = 0.5 * (p[0] + p[2]);
        y = 0.5 * (p[1] + p[3]);
        return true;
      }
      return false;  // Self is a direction, not a point
    case SketchEntityKind::Circle:
      if (ref.role == SketchPointRole::Center) { x = p[0]; y = p[1]; return true; }
      return false;  // a circle has no start or end
    case SketchEntityKind::Arc:
      if (ref.role == SketchPointRole::Center) { x = p[0]; y = p[1]; return true; }
      if (ref.role == SketchPointRole::Start) {
        x = p[0] + p[2] * std::cos(p[3]);
        y = p[1] + p[2] * std::sin(p[3]);
        return true;
      }
      if (ref.role == SketchPointRole::End) {
        x = p[0] + p[2] * std::cos(p[4]);
        y = p[1] + p[2] * std::sin(p[4]);
        return true;
      }
      return false;
    case SketchEntityKind::Ellipse:
      if (ref.role == SketchPointRole::Center) { x = p[0]; y = p[1]; return true; }
      return false;
    case SketchEntityKind::Spline: {
      const std::size_t n = e->params.size();
      if (ref.role == SketchPointRole::Start) { x = p[0]; y = p[1]; return true; }
      if (ref.role == SketchPointRole::End)   { x = p[n - 2]; y = p[n - 1]; return true; }
      return false;
    }
  }
  return false;
}

bool resolveDirection(const Sketch& sketch, const std::vector<double>& params, int entity,
                      double& dx, double& dy) {
  const SketchEntity* e = sketch.entity(entity);
  const double* p = slice(sketch, params, entity);
  if (e == nullptr || p == nullptr) return false;
  switch (e->kind) {
    case SketchEntityKind::Line:
      dx = p[2] - p[0];
      dy = p[3] - p[1];
      return true;
    case SketchEntityKind::Ellipse:
      dx = std::cos(p[4]);
      dy = std::sin(p[4]);
      return true;
    case SketchEntityKind::Spline: {
      const std::size_t n = e->params.size();
      dx = p[n - 2] - p[0];
      dy = p[n - 1] - p[1];
      return true;
    }
    case SketchEntityKind::Point:
    case SketchEntityKind::Circle:
    case SketchEntityKind::Arc:
      // A circle has no direction, and an arc's is ambiguous (chord? tangent at
      // which end?). Refuse rather than pick: `parallel(circle, line)` is a
      // malformed constraint and must be reported as one.
      return false;
  }
  return false;
}

bool resolveRadius(const Sketch& sketch, const std::vector<double>& params, int entity, double& r) {
  const SketchEntity* e = sketch.entity(entity);
  const double* p = slice(sketch, params, entity);
  if (e == nullptr || p == nullptr) return false;
  if (e->kind == SketchEntityKind::Circle || e->kind == SketchEntityKind::Arc) {
    r = p[2];
    return true;
  }
  return false;
}

bool resolveLength(const Sketch& sketch, const std::vector<double>& params, int entity,
                   double& len) {
  double dx = 0.0, dy = 0.0;
  const SketchEntity* e = sketch.entity(entity);
  if (e == nullptr) return false;
  if (e->kind != SketchEntityKind::Line && e->kind != SketchEntityKind::Spline) return false;
  if (!resolveDirection(sketch, params, entity, dx, dy)) return false;
  len = std::sqrt(dx * dx + dy * dy);
  return true;
}

// ── tessellation ────────────────────────────────────────────────────────────
std::vector<double> Sketch::polyline(int index, std::size_t segments) const {
  std::vector<double> out;
  const SketchEntity* e = entity(index);
  if (e == nullptr) return out;
  const std::size_t seg = segments < 2 ? 2 : segments;
  const std::vector<double>& p = e->params;

  switch (e->kind) {
    case SketchEntityKind::Point:
      out = {p[0], p[1]};
      return out;
    case SketchEntityKind::Line:
      out = {p[0], p[1], p[2], p[3]};
      return out;
    case SketchEntityKind::Circle: {
      out.reserve(seg * 2);
      for (std::size_t i = 0; i < seg; ++i) {
        const double t = 2.0 * kPi * static_cast<double>(i) / static_cast<double>(seg);
        out.push_back(p[0] + p[2] * std::cos(t));
        out.push_back(p[1] + p[2] * std::sin(t));
      }
      return out;
    }
    case SketchEntityKind::Arc: {
      // The sweep is taken CCW from start to end. An end angle at or below the
      // start is lifted by full turns until it is above it, so a 350->10 degree
      // arc is the 20-degree arc across zero rather than a 340-degree one
      // backwards. This is the SAME convention the profile builder walks, which
      // is why an arc's tessellation and its endpoints cannot disagree.
      double a0 = p[3];
      double a1 = p[4];
      while (a1 <= a0 + 1e-12) a1 += 2.0 * kPi;
      out.reserve((seg + 1) * 2);
      for (std::size_t i = 0; i <= seg; ++i) {
        const double t = a0 + (a1 - a0) * static_cast<double>(i) / static_cast<double>(seg);
        out.push_back(p[0] + p[2] * std::cos(t));
        out.push_back(p[1] + p[2] * std::sin(t));
      }
      return out;
    }
    case SketchEntityKind::Ellipse: {
      const double c = std::cos(p[4]);
      const double s = std::sin(p[4]);
      out.reserve(seg * 2);
      for (std::size_t i = 0; i < seg; ++i) {
        const double t = 2.0 * kPi * static_cast<double>(i) / static_cast<double>(seg);
        const double u = p[2] * std::cos(t);
        const double v = p[3] * std::sin(t);
        out.push_back(p[0] + u * c - v * s);
        out.push_back(p[1] + u * s + v * c);
      }
      return out;
    }
    case SketchEntityKind::Spline: {
      const std::size_t n = p.size() / 2;
      const std::size_t spans = n - 1;
      const std::size_t per = seg;
      out.reserve((spans * per + 1) * 2);
      const auto px = [&p, n](std::ptrdiff_t i) {
        const std::ptrdiff_t k = std::min<std::ptrdiff_t>(
            std::max<std::ptrdiff_t>(i, 0), static_cast<std::ptrdiff_t>(n) - 1);
        return p[static_cast<std::size_t>(k) * 2];
      };
      const auto py = [&p, n](std::ptrdiff_t i) {
        const std::ptrdiff_t k = std::min<std::ptrdiff_t>(
            std::max<std::ptrdiff_t>(i, 0), static_cast<std::ptrdiff_t>(n) - 1);
        return p[static_cast<std::size_t>(k) * 2 + 1];
      };
      for (std::size_t s = 0; s < spans; ++s) {
        const std::ptrdiff_t i = static_cast<std::ptrdiff_t>(s);
        for (std::size_t k = 0; k < per; ++k) {
          const double t = static_cast<double>(k) / static_cast<double>(per);
          out.push_back(catmullRom(px(i - 1), px(i), px(i + 1), px(i + 2), t));
          out.push_back(catmullRom(py(i - 1), py(i), py(i + 1), py(i + 2), t));
        }
      }
      out.push_back(p[p.size() - 2]);
      out.push_back(p[p.size() - 1]);
      return out;
    }
  }
  return out;
}

}  // namespace forge::ui
