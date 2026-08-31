#include "forge/ui/SketchAssist.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/SketchScene.hpp"

namespace forge::ui {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kDegPerRad = 57.295779513082320876798154814105;

bool isCircular(SketchEntityKind k) noexcept {
  return k == SketchEntityKind::Circle || k == SketchEntityKind::Arc;
}

bool ignored(const std::vector<int>& ignore, int id) {
  return std::find(ignore.begin(), ignore.end(), id) != ignore.end();
}

// How far, in degrees, `deg` sits from the nearest multiple of `period`.
double deviationFrom(double deg, double period) {
  double r = std::fmod(std::fabs(deg), period);
  if (r > period * 0.5) r = period - r;
  return r;
}

double lineAngleDeg(const SketchEntity& e) {
  return std::atan2(e.v[3] - e.v[1], e.v[2] - e.v[0]) * kDegPerRad;
}

// Is (x, y) ON the DRAWN part of `e` -- inside the segment, inside the arc's
// sweep? Answered by reusing distanceTo, which already owns those two rules, so
// the intersection filter and the snap engine can never disagree about where an
// entity ends.
bool onDrawnExtent(const SketchEntity& e, double x, double y) {
  double px = 0.0, py = 0.0;
  const double d = e.distanceTo(x, y, px, py);
  const double scale = 1.0 + std::max(std::fabs(x), std::fabs(y));
  return d <= 1.0e-7 * scale;
}

}  // namespace

// ── snapping ────────────────────────────────────────────────────────────────
const char* toString(SnapKind kind) noexcept {
  switch (kind) {
    case SnapKind::None:         return "none";
    case SnapKind::Endpoint:     return "endpoint";
    case SnapKind::Centre:       return "centre";
    case SnapKind::Intersection: return "intersection";
    case SnapKind::Midpoint:     return "midpoint";
    case SnapKind::Quadrant:     return "quadrant";
    case SnapKind::OnEntity:     return "on_entity";
    case SnapKind::Grid:         return "grid";
  }
  return "none";
}

std::vector<SnapKind> allSnapKinds() {
  std::vector<SnapKind> out;
  out.reserve(kSnapKindCount);
  for (std::size_t i = 0; i < kSnapKindCount; ++i) out.push_back(static_cast<SnapKind>(i));
  return out;
}

int snapPriority(SnapKind kind) noexcept {
  switch (kind) {
    case SnapKind::Endpoint:     return 1;
    case SnapKind::Centre:       return 2;
    case SnapKind::Intersection: return 3;
    case SnapKind::Midpoint:     return 4;
    case SnapKind::Quadrant:     return 5;
    case SnapKind::OnEntity:     return 6;
    case SnapKind::Grid:         return 7;
    case SnapKind::None:         return 99;
  }
  return 99;
}

bool SnapSettings::on(SnapKind kind) const noexcept {
  const std::size_t i = static_cast<std::size_t>(kind);
  return i < kSnapKindCount && enabled[i];
}

void SnapSettings::setOn(SnapKind kind, bool value) noexcept {
  const std::size_t i = static_cast<std::size_t>(kind);
  if (i < kSnapKindCount) enabled[i] = value;
}

std::string SnapResult::describe() const {
  if (kind == SnapKind::None) return "free";
  std::string s = toString(kind);
  if (kind == SnapKind::Grid) return s;
  if (kind == SnapKind::Intersection)
    return s + " of " + std::to_string(entityA) + " and " + std::to_string(entityB);
  if (point.valid()) return s + " of entity " + std::to_string(point.entity);
  if (entityA != 0) return s + " on entity " + std::to_string(entityA);
  return s;
}

double snapToGrid(double v, double spacing) noexcept {
  if (!(spacing > 0.0)) return v;
  return std::round(v / spacing) * spacing;
}

std::size_t intersectSketchEntities(const SketchEntity& a, const SketchEntity& b,
                                    double out[2][2]) {
  if (a.kind == SketchEntityKind::Point || b.kind == SketchEntityKind::Point) return 0;

  double cand[2][2];
  std::size_t n = 0;

  const auto lineCircle = [&cand, &n](const SketchEntity& l, const SketchEntity& c) {
    const double dx = l.v[2] - l.v[0], dy = l.v[3] - l.v[1];
    const double fx = l.v[0] - c.v[0], fy = l.v[1] - c.v[1];
    const double A = dx * dx + dy * dy;
    if (!(A > 1.0e-24)) return;
    const double B = 2.0 * (fx * dx + fy * dy);
    const double C = fx * fx + fy * fy - c.v[2] * c.v[2];
    const double disc = B * B - 4.0 * A * C;
    if (disc < 0.0) return;
    const double sq = std::sqrt(disc);
    const double ts[2] = {(-B - sq) / (2.0 * A), (-B + sq) / (2.0 * A)};
    for (double t : ts) {
      if (n >= 2) break;
      cand[n][0] = l.v[0] + t * dx;
      cand[n][1] = l.v[1] + t * dy;
      ++n;
      if (disc == 0.0) break;
    }
  };

  if (a.kind == SketchEntityKind::Line && b.kind == SketchEntityKind::Line) {
    const double ax = a.v[2] - a.v[0], ay = a.v[3] - a.v[1];
    const double bx = b.v[2] - b.v[0], by = b.v[3] - b.v[1];
    const double den = ax * by - ay * bx;
    const double scale = std::hypot(ax, ay) * std::hypot(bx, by);
    if (std::fabs(den) <= 1.0e-12 * (scale > 0.0 ? scale : 1.0)) return 0;
    const double t = ((b.v[0] - a.v[0]) * by - (b.v[1] - a.v[1]) * bx) / den;
    cand[0][0] = a.v[0] + t * ax;
    cand[0][1] = a.v[1] + t * ay;
    n = 1;
  } else if (a.kind == SketchEntityKind::Line) {
    lineCircle(a, b);
  } else if (b.kind == SketchEntityKind::Line) {
    lineCircle(b, a);
  } else {
    const double dx = b.v[0] - a.v[0], dy = b.v[1] - a.v[1];
    const double d = std::hypot(dx, dy);
    const double r1 = a.v[2], r2 = b.v[2];
    if (!(d > 1.0e-12) || d > r1 + r2 || d < std::fabs(r1 - r2)) return 0;
    const double base = (d * d + r1 * r1 - r2 * r2) / (2.0 * d);
    const double h2 = r1 * r1 - base * base;
    const double h = h2 > 0.0 ? std::sqrt(h2) : 0.0;
    const double mx = a.v[0] + base * dx / d, my = a.v[1] + base * dy / d;
    cand[0][0] = mx + h * dy / d;
    cand[0][1] = my - h * dx / d;
    n = 1;
    if (h > 0.0) {
      cand[1][0] = mx - h * dy / d;
      cand[1][1] = my + h * dx / d;
      n = 2;
    }
  }

  // The solve above works on INFINITE lines and FULL circles; the drawn extent
  // is applied here, once, by asking each entity how far the candidate is from
  // it. Without this a snap offers the intersection of two segments that do not
  // reach each other.
  std::size_t kept = 0;
  for (std::size_t i = 0; i < n; ++i) {
    if (!onDrawnExtent(a, cand[i][0], cand[i][1])) continue;
    if (!onDrawnExtent(b, cand[i][0], cand[i][1])) continue;
    out[kept][0] = cand[i][0];
    out[kept][1] = cand[i][1];
    ++kept;
  }
  return kept;
}

SnapResult snapCursor(const SketchScene& scene, const SnapSettings& settings, double x, double y,
                      const std::vector<int>& ignore) {
  SnapResult best;
  int bestPriority = 100;
  double bestDistance = 0.0;

  const auto offer = [&](SnapKind kind, double px, double py, const SketchPointId& point,
                         int entityA, int entityB) {
    if (!settings.on(kind)) return;
    const double d = std::hypot(px - x, py - y);
    if (kind != SnapKind::Grid && d > settings.pickRadius) return;
    const int prio = snapPriority(kind);
    // Priority first, distance only within a priority. A nearer grid node must
    // never beat an endpoint inside the pick radius -- that is the whole reason
    // the order is declared rather than emergent.
    if (best.hit() && (prio > bestPriority || (prio == bestPriority && d >= bestDistance))) return;
    best.kind = kind;
    best.x = px;
    best.y = py;
    best.point = point;
    best.entityA = entityA;
    best.entityB = entityB;
    best.distance = d;
    bestPriority = prio;
    bestDistance = d;
  };

  std::vector<int> near;
  for (const SketchEntity& e : scene.entities()) {
    if (ignored(ignore, e.id)) continue;

    double px = 0.0, py = 0.0;
    switch (e.kind) {
      case SketchEntityKind::Point:
        if (e.point(SketchPointRole::Start, px, py))
          offer(SnapKind::Endpoint, px, py, SketchPointId{e.id, SketchPointRole::Start}, e.id, 0);
        break;
      case SketchEntityKind::Line:
        if (e.point(SketchPointRole::Start, px, py))
          offer(SnapKind::Endpoint, px, py, SketchPointId{e.id, SketchPointRole::Start}, e.id, 0);
        if (e.point(SketchPointRole::End, px, py))
          offer(SnapKind::Endpoint, px, py, SketchPointId{e.id, SketchPointRole::End}, e.id, 0);
        if (e.point(SketchPointRole::Centre, px, py))
          offer(SnapKind::Midpoint, px, py, SketchPointId{e.id, SketchPointRole::Centre}, e.id, 0);
        break;
      case SketchEntityKind::Arc:
        if (e.point(SketchPointRole::Start, px, py))
          offer(SnapKind::Endpoint, px, py, SketchPointId{e.id, SketchPointRole::Start}, e.id, 0);
        if (e.point(SketchPointRole::End, px, py))
          offer(SnapKind::Endpoint, px, py, SketchPointId{e.id, SketchPointRole::End}, e.id, 0);
        [[fallthrough]];
      case SketchEntityKind::Circle:
        if (e.point(SketchPointRole::Centre, px, py))
          offer(SnapKind::Centre, px, py, SketchPointId{e.id, SketchPointRole::Centre}, e.id, 0);
        for (int q = 0; q < 4; ++q) {
          const double a = 0.5 * kPi * static_cast<double>(q);
          const double qx = e.v[0] + e.v[2] * std::cos(a);
          const double qy = e.v[1] + e.v[2] * std::sin(a);
          // An arc's quadrant only exists where the arc actually is.
          if (e.kind == SketchEntityKind::Arc && !onDrawnExtent(e, qx, qy)) continue;
          offer(SnapKind::Quadrant, qx, qy, SketchPointId{}, e.id, 0);
        }
        break;
    }

    const double d = e.distanceTo(x, y, px, py);
    if (d <= settings.pickRadius) {
      offer(SnapKind::OnEntity, px, py, SketchPointId{}, e.id, 0);
      near.push_back(e.id);
    }
  }

  // Intersections, but only among the entities the cursor is already near --
  // every pair in the scene would be quadratic in the entity count for a snap
  // that can only ever land inside the pick radius anyway.
  if (settings.on(SnapKind::Intersection)) {
    for (std::size_t i = 0; i < near.size(); ++i) {
      for (std::size_t j = i + 1; j < near.size(); ++j) {
        const SketchEntity* ea = scene.entity(near[i]);
        const SketchEntity* eb = scene.entity(near[j]);
        if (ea == nullptr || eb == nullptr) continue;
        double pts[2][2];
        const std::size_t n = intersectSketchEntities(*ea, *eb, pts);
        for (std::size_t k = 0; k < n; ++k)
          offer(SnapKind::Intersection, pts[k][0], pts[k][1], SketchPointId{}, ea->id, eb->id);
      }
    }
  }

  if (settings.on(SnapKind::Grid))
    offer(SnapKind::Grid, snapToGrid(x, settings.gridSpacing), snapToGrid(y, settings.gridSpacing),
          SketchPointId{}, 0, 0);

  if (!best.hit()) {
    best.x = x;
    best.y = y;
  }
  return best;
}

int hitTestEntity(const SketchScene& scene, double x, double y, double pickRadius,
                  const std::vector<int>& ignore) {
  int hit = 0;
  double bestDistance = 0.0;
  for (const SketchEntity& e : scene.entities()) {
    if (ignored(ignore, e.id)) continue;
    double px = 0.0, py = 0.0;
    const double d = e.distanceTo(x, y, px, py);
    if (d > pickRadius) continue;
    // Nearest wins; an exact tie goes to the LOWEST id, so clicking a spot where
    // two entities overlap picks the same one every time.
    if (hit == 0 || d < bestDistance || (d == bestDistance && e.id < hit)) {
      hit = e.id;
      bestDistance = d;
    }
  }
  return hit;
}

// ── inference ───────────────────────────────────────────────────────────────
namespace {

// Does `scene` already hold this constraint? Offering what is already there is
// how an inference panel fills with duplicates the user has to dismiss.
bool alreadyPresent(const SketchScene& scene, const SketchConstraint& c) {
  for (const SketchConstraint& e : scene.constraints()) {
    if (e.kind != c.kind) continue;
    const bool samePoints = (e.pointA == c.pointA && e.pointB == c.pointB) ||
                            (e.pointA == c.pointB && e.pointB == c.pointA);
    const bool sameEntities = (e.entityA == c.entityA && e.entityB == c.entityB) ||
                              (e.entityA == c.entityB && e.entityB == c.entityA);
    if (samePoints && sameEntities && e.entityC == c.entityC) return true;
  }
  return false;
}

struct ProposalSink {
  const SketchScene* scene = nullptr;
  std::vector<ConstraintProposal> out;

  void add(SketchConstraintKind kind, double confidence, std::string reason,
           const SketchPointId& a, const SketchPointId& b, int ea, int eb, int ec) {
    SketchConstraint c;
    c.kind = kind;
    c.pointA = a;
    c.pointB = b;
    c.entityA = ea;
    c.entityB = eb;
    c.entityC = ec;
    c.inferred = true;
    std::string why;
    if (scene == nullptr || !scene->wellFormed(c, why)) return;
    if (alreadyPresent(*scene, c)) return;
    for (const ConstraintProposal& p : out) {
      if (p.constraint.kind == c.kind && p.constraint.pointA == c.pointA &&
          p.constraint.pointB == c.pointB && p.constraint.entityA == c.entityA &&
          p.constraint.entityB == c.entityB)
        return;
    }
    ConstraintProposal p;
    p.constraint = c;
    p.confidence = confidence;
    p.reason = std::move(reason);
    out.push_back(std::move(p));
  }
};

std::string degreeText(double deg) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.2f", deg);
  return std::string(buf);
}

}  // namespace

std::vector<ConstraintProposal> inferConstraints(const SketchScene& scene, int entityId,
                                                 const std::vector<SketchPickBinding>& bindings,
                                                 const InferenceSettings& settings) {
  const SketchEntity* e = scene.entity(entityId);
  if (e == nullptr) return {};

  ProposalSink sink;
  sink.scene = &scene;

  // ── what the snaps said ─────────────────────────────────────────────────
  for (const SketchPickBinding& b : bindings) {
    if (!b.snap.hit() || !b.point.valid() || b.point.entity != entityId) continue;
    switch (b.snap.kind) {
      case SnapKind::Endpoint:
      case SnapKind::Centre:
        if (!settings.coincident) break;
        if (isCircular(e->kind) && b.point.role == SketchPointRole::Centre &&
            b.snap.point.role == SketchPointRole::Centre && settings.concentric) {
          sink.add(SketchConstraintKind::Concentric, 1.0,
                   "centre was snapped to the centre of entity " +
                       std::to_string(b.snap.point.entity),
                   SketchPointId{}, SketchPointId{}, entityId, b.snap.point.entity, 0);
          break;
        }
        sink.add(SketchConstraintKind::Coincident, 1.0,
                 "snapped to the " + std::string(toString(b.snap.point.role)) + " of entity " +
                     std::to_string(b.snap.point.entity),
                 b.point, b.snap.point, 0, 0, 0);
        break;
      case SnapKind::Midpoint:
        if (!settings.coincident) break;
        sink.add(SketchConstraintKind::Midpoint, 1.0,
                 "snapped to the midpoint of line " + std::to_string(b.snap.point.entity), b.point,
                 SketchPointId{}, 0, b.snap.point.entity, 0);
        break;
      case SnapKind::Intersection:
        if (!settings.pointOnEntity) break;
        sink.add(SketchConstraintKind::PointOnEntity, 1.0,
                 "snapped to where entities " + std::to_string(b.snap.entityA) + " and " +
                     std::to_string(b.snap.entityB) + " cross",
                 b.point, SketchPointId{}, 0, b.snap.entityA, 0);
        sink.add(SketchConstraintKind::PointOnEntity, 1.0,
                 "snapped to where entities " + std::to_string(b.snap.entityA) + " and " +
                     std::to_string(b.snap.entityB) + " cross",
                 b.point, SketchPointId{}, 0, b.snap.entityB, 0);
        break;
      case SnapKind::Quadrant:
      case SnapKind::OnEntity:
        if (!settings.pointOnEntity) break;
        sink.add(SketchConstraintKind::PointOnEntity, 0.9,
                 "snapped onto entity " + std::to_string(b.snap.entityA), b.point,
                 SketchPointId{}, 0, b.snap.entityA, 0);
        break;
      case SnapKind::Grid:
      case SnapKind::None:
        // A grid node is a POSITION, not a relationship. Turning it into a
        // constraint is how sketches acquire dimensions nobody asked for.
        break;
    }
  }

  const double tol = settings.angleToleranceDeg;

  // ── what the geometry looks like ────────────────────────────────────────
  if (e->kind == SketchEntityKind::Line) {
    const double ang = lineAngleDeg(*e);
    if (settings.horizontalVertical && tol > 0.0) {
      const double dh = deviationFrom(ang, 180.0);
      const double dv = deviationFrom(ang - 90.0, 180.0);
      if (dh <= tol)
        sink.add(SketchConstraintKind::Horizontal, 1.0 - dh / tol,
                 degreeText(dh) + " degrees off horizontal", SketchPointId{}, SketchPointId{},
                 entityId, 0, 0);
      else if (dv <= tol)
        sink.add(SketchConstraintKind::Vertical, 1.0 - dv / tol,
                 degreeText(dv) + " degrees off vertical", SketchPointId{}, SketchPointId{},
                 entityId, 0, 0);
    }

    for (const SketchEntity& o : scene.entities()) {
      if (o.id == entityId) continue;
      if (o.kind == SketchEntityKind::Line) {
        if (settings.parallelPerpendicular && tol > 0.0) {
          const double rel = lineAngleDeg(o) - ang;
          const double dp = deviationFrom(rel, 180.0);
          const double dq = deviationFrom(rel - 90.0, 180.0);
          if (dp <= tol)
            sink.add(SketchConstraintKind::Parallel, 0.8 * (1.0 - dp / tol),
                     degreeText(dp) + " degrees off parallel with line " + std::to_string(o.id),
                     SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
          else if (dq <= tol)
            sink.add(SketchConstraintKind::Perpendicular, 0.8 * (1.0 - dq / tol),
                     degreeText(dq) + " degrees off perpendicular to line " + std::to_string(o.id),
                     SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
        }
        if (settings.equal && settings.equalToleranceFraction > 0.0) {
          const double la = e->length(), lb = o.length();
          const double scale = std::max(la, lb);
          if (scale > 0.0) {
            const double rel = std::fabs(la - lb) / scale;
            if (rel <= settings.equalToleranceFraction)
              sink.add(SketchConstraintKind::Equal,
                       0.5 * (1.0 - rel / settings.equalToleranceFraction),
                       "within " + degreeText(rel * 100.0) + "% of line " + std::to_string(o.id) +
                           "'s length",
                       SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
          }
        }
      } else if (isCircular(o.kind) && settings.tangent &&
                 settings.equalToleranceFraction > 0.0) {
        const double dx = e->v[2] - e->v[0], dy = e->v[3] - e->v[1];
        const double len = std::hypot(dx, dy);
        if (len > 1.0e-12) {
          const double perp =
              std::fabs(((o.v[0] - e->v[0]) * dy - (o.v[1] - e->v[1]) * dx) / len);
          const double dev = std::fabs(perp - o.v[2]);
          const double band = settings.equalToleranceFraction * o.v[2];
          if (band > 0.0 && dev <= band)
            sink.add(SketchConstraintKind::Tangent, 0.7 * (1.0 - dev / band),
                     "runs within " + degreeText(dev) + " of tangency to entity " +
                         std::to_string(o.id),
                     SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
        }
      }
    }
  } else if (isCircular(e->kind)) {
    for (const SketchEntity& o : scene.entities()) {
      if (o.id == entityId || !isCircular(o.kind)) continue;
      const double band = settings.equalToleranceFraction * std::max(e->v[2], o.v[2]);
      if (!(band > 0.0)) continue;
      const double centres = std::hypot(e->v[0] - o.v[0], e->v[1] - o.v[1]);
      if (settings.concentric && centres <= band)
        sink.add(SketchConstraintKind::Concentric, 0.9 * (1.0 - centres / band),
                 "centre sits within " + degreeText(centres) + " of entity " +
                     std::to_string(o.id) + "'s centre",
                 SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
      const double dr = std::fabs(e->v[2] - o.v[2]);
      if (settings.equal && dr <= band)
        sink.add(SketchConstraintKind::Equal, 0.5 * (1.0 - dr / band),
                 "radius is within " + degreeText(dr) + " of entity " + std::to_string(o.id) +
                     "'s",
                 SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
      if (settings.tangent) {
        const double ext = std::fabs(centres - (e->v[2] + o.v[2]));
        const double intl = std::fabs(centres - std::fabs(e->v[2] - o.v[2]));
        const double dev = std::min(ext, intl);
        if (dev <= band)
          sink.add(SketchConstraintKind::Tangent, 0.7 * (1.0 - dev / band),
                   "sits within " + degreeText(dev) + " of tangency to entity " +
                       std::to_string(o.id),
                   SketchPointId{}, SketchPointId{}, entityId, o.id, 0);
      }
    }
  }

  // Confidence first, then a total order on the constraint itself, so two
  // proposals that tie do not swap places between runs.
  std::vector<ConstraintProposal> out = std::move(sink.out);
  std::stable_sort(out.begin(), out.end(),
                   [](const ConstraintProposal& a, const ConstraintProposal& b) {
                     if (a.confidence != b.confidence) return a.confidence > b.confidence;
                     if (a.constraint.kind != b.constraint.kind)
                       return static_cast<int>(a.constraint.kind) <
                              static_cast<int>(b.constraint.kind);
                     if (a.constraint.entityA != b.constraint.entityA)
                       return a.constraint.entityA < b.constraint.entityA;
                     if (a.constraint.entityB != b.constraint.entityB)
                       return a.constraint.entityB < b.constraint.entityB;
                     return a.constraint.pointA.key() < b.constraint.pointA.key();
                   });
  if (out.size() > settings.maxProposals) out.resize(settings.maxProposals);
  return out;
}

std::vector<ConstraintProposal> retainIndependent(const SketchSolver& solver,
                                                  const SketchScene& scene,
                                                  const std::vector<ConstraintProposal>& offered) {
  std::vector<ConstraintProposal> kept;
  SketchScene work = scene;
  for (const ConstraintProposal& p : offered) {
    // CUMULATIVE: each accepted proposal joins the working copy before the next
    // is judged. Testing every proposal against the ORIGINAL scene would accept
    // four coincidences that are independent one at a time and dependent
    // together -- which is exactly how a rectangle tool over-constrains.
    if (!sketchConstraintAddsInformation(solver, work, p.constraint)) continue;
    std::string why;
    if (work.addConstraint(p.constraint, &why) == 0) continue;
    kept.push_back(p);
  }
  return kept;
}

}  // namespace forge::ui
