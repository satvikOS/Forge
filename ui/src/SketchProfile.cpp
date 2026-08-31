#include "forge/ui/SketchProfile.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Sketch.hpp"

namespace forge::ui {
namespace {

struct Vec2 {
  double x = 0.0, y = 0.0;
};

bool samepoint(const Vec2& a, const Vec2& b, double tol) {
  return std::fabs(a.x - b.x) <= tol && std::fabs(a.y - b.y) <= tol;
}

// One boundary curve, already tessellated in walk order.
struct Segment {
  int entity = kNoSketchEntity;
  std::vector<double> pts;  // u,v pairs, at least 2 points
  Vec2 start() const { return Vec2{pts[0], pts[1]}; }
  Vec2 end() const { return Vec2{pts[pts.size() - 2], pts[pts.size() - 1]}; }
};

double signedArea(const std::vector<double>& ring) {
  const std::size_t n = ring.size() / 2;
  if (n < 3) return 0.0;
  double acc = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    const std::size_t j = (i + 1) % n;
    acc += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return 0.5 * acc;
}

void reverseRing(std::vector<double>& ring) {
  const std::size_t n = ring.size() / 2;
  for (std::size_t i = 0; i < n / 2; ++i) {
    const std::size_t j = n - 1 - i;
    std::swap(ring[i * 2], ring[j * 2]);
    std::swap(ring[i * 2 + 1], ring[j * 2 + 1]);
  }
}

// Drop consecutive duplicates, and the wrap-around duplicate. A ring whose first
// and last point coincide is legal input to nothing: the kernel closes the loop
// itself, so a repeated vertex becomes a zero-length edge.
void dedupe(std::vector<double>& ring, double tol) {
  std::vector<double> out;
  out.reserve(ring.size());
  const std::size_t n = ring.size() / 2;
  for (std::size_t i = 0; i < n; ++i) {
    const Vec2 p{ring[i * 2], ring[i * 2 + 1]};
    if (!out.empty()) {
      const Vec2 q{out[out.size() - 2], out[out.size() - 1]};
      if (samepoint(p, q, tol)) continue;
    }
    out.push_back(p.x);
    out.push_back(p.y);
  }
  while (out.size() >= 6) {
    const Vec2 first{out[0], out[1]};
    const Vec2 last{out[out.size() - 2], out[out.size() - 1]};
    if (!samepoint(first, last, tol)) break;
    out.pop_back();
    out.pop_back();
  }
  ring.swap(out);
}

bool segmentsCross(const Vec2& p1, const Vec2& p2, const Vec2& q1, const Vec2& q2) {
  const auto orient = [](const Vec2& a, const Vec2& b, const Vec2& c) {
    const double v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (v > 1e-12) return 1;
    if (v < -1e-12) return -1;
    return 0;
  };
  const int o1 = orient(p1, p2, q1);
  const int o2 = orient(p1, p2, q2);
  const int o3 = orient(q1, q2, p1);
  const int o4 = orient(q1, q2, p2);
  return o1 != o2 && o3 != o4 && o1 != 0 && o2 != 0 && o3 != 0 && o4 != 0;
}

// Proper crossings only, and NON-ADJACENT pairs only: consecutive ring edges
// share a vertex by construction, and counting that as an intersection would
// report every ring as self-intersecting.
bool ringSelfIntersects(const std::vector<double>& ring) {
  const std::size_t n = ring.size() / 2;
  if (n < 4) return false;
  for (std::size_t i = 0; i < n; ++i) {
    const Vec2 p1{ring[i * 2], ring[i * 2 + 1]};
    const std::size_t i2 = (i + 1) % n;
    const Vec2 p2{ring[i2 * 2], ring[i2 * 2 + 1]};
    for (std::size_t j = i + 2; j < n; ++j) {
      if (i == 0 && j == n - 1) continue;  // adjacent across the wrap
      const Vec2 q1{ring[j * 2], ring[j * 2 + 1]};
      const std::size_t j2 = (j + 1) % n;
      const Vec2 q2{ring[j2 * 2], ring[j2 * 2 + 1]};
      if (segmentsCross(p1, p2, q1, q2)) return true;
    }
  }
  return false;
}

SketchProfile refuse(SketchProfileStatus status, std::string detail) {
  SketchProfile p;
  p.status = status;
  p.detail = std::move(detail);
  return p;
}

const char* entityName(const Sketch& s, int index) {
  const SketchEntity* e = s.entity(index);
  return e == nullptr ? "<none>" : e->name.c_str();
}

}  // namespace

const char* toString(SketchProfileStatus status) noexcept {
  switch (status) {
    case SketchProfileStatus::Ok:               return "ok";
    case SketchProfileStatus::NoGeometry:       return "no_geometry";
    case SketchProfileStatus::NotClosed:        return "not_closed";
    case SketchProfileStatus::Branching:        return "branching";
    case SketchProfileStatus::MultipleLoops:    return "multiple_loops";
    case SketchProfileStatus::Degenerate:       return "degenerate";
    case SketchProfileStatus::SelfIntersecting: return "self_intersecting";
    case SketchProfileStatus::Unsupported:      return "unsupported";
  }
  return "no_geometry";
}

const char* toString(SketchEmitStatus status) noexcept {
  switch (status) {
    case SketchEmitStatus::Ok:               return "ok";
    case SketchEmitStatus::NoProfile:        return "no_profile";
    case SketchEmitStatus::InvalidStatement: return "invalid_statement";
  }
  return "no_profile";
}

SketchProfile extractSketchProfile(const Sketch& sketch, const SketchProfileOptions& options) {
  const std::size_t seg = options.arcSegments < 3 ? 3 : options.arcSegments;
  const double tol = options.tolerance > 0.0 ? options.tolerance : 1e-6;

  // ── 1. what is boundary geometry at all ───────────────────────────────────
  std::vector<int> closedCurves;  // Circle / Ellipse: each is a loop on its own
  std::vector<Segment> open;      // Line / Arc / Spline: they have to be chained
  std::size_t realGeometry = 0;
  for (int i = 0; i < static_cast<int>(sketch.entityCount()); ++i) {
    const SketchEntity* e = sketch.entity(i);
    if (e == nullptr || e->construction) continue;
    switch (e->kind) {
      case SketchEntityKind::Point:
        // A point bounds nothing. It is legitimate sketch content (a hole
        // centre), so it is skipped rather than treated as unsupported.
        continue;
      case SketchEntityKind::Circle:
      case SketchEntityKind::Ellipse:
        closedCurves.push_back(i);
        ++realGeometry;
        continue;
      case SketchEntityKind::Line:
      case SketchEntityKind::Arc:
      case SketchEntityKind::Spline: {
        Segment s;
        s.entity = i;
        s.pts = sketch.polyline(i, seg);
        if (s.pts.size() < 4) {
          return refuse(SketchProfileStatus::Degenerate,
                        std::string("entity '") + entityName(sketch, i) +
                            "' tessellates to fewer than two points");
        }
        open.push_back(std::move(s));
        ++realGeometry;
        continue;
      }
    }
  }
  if (realGeometry == 0) {
    return refuse(SketchProfileStatus::NoGeometry,
                  "the sketch has no non-construction curve to bound a profile");
  }

  SketchProfile out;

  // ── 2. a single closed curve is already a loop ────────────────────────────
  if (open.empty()) {
    if (closedCurves.size() != 1) {
      out.status = SketchProfileStatus::MultipleLoops;
      out.detail = std::to_string(closedCurves.size()) +
                   " closed curves and no chain: a profile carries ONE ring, so only the first "
                   "is returned";
    } else {
      out.status = SketchProfileStatus::Ok;
    }
    out.ring = sketch.polyline(closedCurves.front(), seg);
    out.entities.push_back(closedCurves.front());
    out.closed = true;
  } else {
    // ── 3. chain the open curves end to end ─────────────────────────────────
    // A vertex where three or more ends meet has no unambiguous walk, and
    // picking one silently is how a profile builder returns a loop the user did
    // not draw. Counted up front so the report names the point, not "failed".
    std::vector<Vec2> ends;
    for (const Segment& s : open) {
      ends.push_back(s.start());
      ends.push_back(s.end());
    }
    for (std::size_t i = 0; i < ends.size(); ++i) {
      std::size_t incident = 0;
      for (std::size_t j = 0; j < ends.size(); ++j) {
        if (samepoint(ends[i], ends[j], tol)) ++incident;
      }
      if (incident > 2) {
        char buf[80];
        std::snprintf(buf, sizeof(buf), "(%.6g, %.6g)", ends[i].x, ends[i].y);
        return refuse(SketchProfileStatus::Branching,
                      std::string("three or more curve ends meet at ") + buf +
                          "; a profile ring has no unambiguous walk through it");
      }
    }

    std::vector<bool> used(open.size(), false);
    std::vector<double> ring;
    std::vector<int> walked;
    used[0] = true;
    walked.push_back(open[0].entity);
    ring.insert(ring.end(), open[0].pts.begin(), open[0].pts.end());
    Vec2 tail = open[0].end();
    const Vec2 head = open[0].start();

    bool closed = false;
    for (std::size_t step = 1; step < open.size(); ++step) {
      bool advanced = false;
      for (std::size_t c = 0; c < open.size(); ++c) {
        if (used[c]) continue;
        const bool atStart = samepoint(open[c].start(), tail, tol);
        const bool atEnd = samepoint(open[c].end(), tail, tol);
        if (!atStart && !atEnd) continue;
        used[c] = true;
        walked.push_back(open[c].entity);
        std::vector<double> pts = open[c].pts;
        if (atEnd) {
          // Walked backwards: reverse it so the ring stays a single ordered
          // path. A chain that appends a curve in its own direction regardless
          // produces a ring that jumps back and forth across the profile.
          std::vector<double> rev;
          rev.reserve(pts.size());
          for (std::size_t k = pts.size() / 2; k > 0; --k) {
            rev.push_back(pts[(k - 1) * 2]);
            rev.push_back(pts[(k - 1) * 2 + 1]);
          }
          pts.swap(rev);
        }
        ring.insert(ring.end(), pts.begin() + 2, pts.end());  // the shared vertex once
        tail = Vec2{pts[pts.size() - 2], pts[pts.size() - 1]};
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
    closed = samepoint(tail, head, tol);

    if (!closed) {
      SketchProfile p = refuse(SketchProfileStatus::NotClosed, "");
      char buf[160];
      std::snprintf(buf, sizeof(buf),
                    "the chain from '%s' ends at (%.6g, %.6g) and does not return to (%.6g, %.6g)",
                    entityName(sketch, walked.front()), tail.x, tail.y, head.x, head.y);
      p.detail = buf;
      p.ring = ring;  // the partial chain is returned, not discarded
      p.entities = walked;
      dedupe(p.ring, tol);
      p.area = signedArea(p.ring);
      return p;
    }

    const std::size_t leftover =
        static_cast<std::size_t>(std::count(used.begin(), used.end(), false)) +
        closedCurves.size();
    out.status = leftover == 0 ? SketchProfileStatus::Ok : SketchProfileStatus::MultipleLoops;
    if (leftover != 0) {
      out.detail = std::to_string(leftover) +
                   " curve(s) are not part of the returned ring; a profile carries ONE ring";
    }
    out.ring.swap(ring);
    out.entities.swap(walked);
    out.closed = true;
  }

  dedupe(out.ring, tol);
  if (out.points() < 3) {
    SketchProfile p = refuse(SketchProfileStatus::Degenerate,
                             "the ring collapses to fewer than three distinct points");
    p.ring = out.ring;
    p.entities = out.entities;
    return p;
  }

  const double signed_ = signedArea(out.ring);
  if (std::fabs(signed_) <= 1e-12) {
    SketchProfile p = refuse(SketchProfileStatus::Degenerate, "the ring encloses no area");
    p.ring = out.ring;
    p.entities = out.entities;
    return p;
  }
  // Counter-clockwise, always. The orientation is not cosmetic: it is the sign
  // of every area the caller computes and the direction the kernel builds the
  // face in, and a ring whose winding depends on which curve the author drew
  // first is a profile that flips under an edit that changed nothing.
  if (signed_ < 0.0) reverseRing(out.ring);
  out.area = std::fabs(signed_);

  if (out.status == SketchProfileStatus::Ok && ringSelfIntersects(out.ring)) {
    out.status = SketchProfileStatus::SelfIntersecting;
    out.detail = "the ring crosses itself; it is returned so it can be repaired, but no solid "
                 "built from it will be valid";
  }
  return out;
}

SketchEmission emitSketchProfile(const Sketch& sketch, int statementId,
                                 const SketchProfileOptions& options) {
  SketchEmission out;
  const SketchProfile profile = extractSketchProfile(sketch, options);
  out.profile = profile.status;
  out.detail = profile.detail;

  // ── the exact circle ──────────────────────────────────────────────────────
  // Recognised BEFORE the ring is considered, because the ring for a circle is
  // a polygon and a polygon is not a circle. Only on the world XY plane: CIRCLE
  // is a Z=0 profile op, and there is no argument in it for a plane.
  if (profile.status == SketchProfileStatus::Ok && profile.entities.size() == 1 &&
      sketch.plane().isWorldXY()) {
    const SketchEntity* e = sketch.entity(profile.entities.front());
    if (e != nullptr && e->kind == SketchEntityKind::Circle) {
      std::vector<IrArg> args{IrArg::num(e->params[2])};
      if (e->params[0] != 0.0 || e->params[1] != 0.0) {
        args.push_back(IrArg::num(e->params[0]));
        args.push_back(IrArg::num(e->params[1]));
      }
      out.line = IrLine{statementId, "CIRCLE", std::move(args)};
      out.produces = IrValueKind::Profile;
      out.check = validateIr(out.line);
      out.status = out.check == IrCheck::Ok ? SketchEmitStatus::Ok
                                            : SketchEmitStatus::InvalidStatement;
      if (out.detail.empty()) out.detail = "exact circle, not tessellated";
      return out;
    }
  }

  if (profile.points() < 3) {
    out.status = SketchEmitStatus::NoProfile;
    if (out.detail.empty()) out.detail = toString(profile.status);
    return out;
  }

  std::vector<IrPoint> pts;
  pts.reserve(profile.points());
  const bool worldXY = sketch.plane().isWorldXY();
  for (std::size_t i = 0; i < profile.points(); ++i) {
    const double u = profile.ring[i * 2];
    const double v = profile.ring[i * 2 + 1];
    if (worldXY) {
      pts.push_back(IrPoint{u, v, 0.0});
    } else {
      double w[3];
      sketch.plane().toWorld(u, v, w);
      pts.push_back(IrPoint{w[0], w[1], w[2]});
    }
  }

  if (worldXY) {
    out.line = IrLine{statementId, "POLY", {IrArg::pointRing(std::move(pts), 2)}};
    out.produces = IrValueKind::Profile;
  } else {
    // Off the world XY plane the ring is world-space 3D, so it is a WIRE — the
    // LOFT section kind — not a PROFILE. Saying so is the point: EXTRUDE would
    // refuse it at the kernel (`%N is not a WIRE section` in reverse), and a
    // caller that knows the value kind never offers the wrong op.
    out.line = IrLine{statementId, "WIRE", {IrArg::pointRing(std::move(pts), 3)}};
    out.produces = IrValueKind::Wire;
  }
  out.check = validateIr(out.line);
  out.status =
      out.check == IrCheck::Ok ? SketchEmitStatus::Ok : SketchEmitStatus::InvalidStatement;
  return out;
}

int seedSketchProfile(PartDocument& document, const Sketch& sketch, const std::string& nodeId,
                      const SketchProfileOptions& options) {
  const SketchEmission emission = emitSketchProfile(sketch, document.nextIrId(), options);
  if (!emission.ok()) return 0;
  return document.seed(emission.produces, nodeId, emission.line.op, emission.line.args);
}

}  // namespace forge::ui
