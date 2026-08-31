#include "forge/ui/ViewportSelect.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ViewportPick.hpp"

namespace forge::ui {
namespace {

// A screen-space segment/box overlap, used by CROSSING. Liang-Barsky on the
// parametric segment against the four half-planes: exact, allocation-free, and
// it answers "touches" (an endpoint on the border counts) rather than "strictly
// crosses", which is what a crossing selection means.
bool segmentTouchesBox(double ax, double ay, double bx, double by, const ScreenBox& box) {
  double t0 = 0.0, t1 = 1.0;
  const double dx = bx - ax;
  const double dy = by - ay;
  const double p[4] = {-dx, dx, -dy, dy};
  const double q[4] = {ax - box.minX(), box.maxX() - ax, ay - box.minY(), box.maxY() - ay};
  for (int i = 0; i < 4; ++i) {
    if (p[i] == 0.0) {
      if (q[i] < 0.0) return false;  // parallel and outside this slab
      continue;
    }
    const double r = q[i] / p[i];
    if (p[i] < 0.0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

// Even-odd point-in-polygon. `poly` is x,y pairs. The classic crossing-number
// test (Sunday, "Inclusion of a Point in a Polygon"): a horizontal ray to +x,
// counting edges that straddle the test y with a half-open rule so a vertex
// exactly on the scanline is counted once, not twice or zero times.
bool pointInPolygon(const std::vector<double>& poly, double px, double py) {
  const std::size_t n = poly.size() / 2;
  if (n < 3) return false;
  bool inside = false;
  for (std::size_t i = 0, j = n - 1; i < n; j = i++) {
    const double xi = poly[i * 2], yi = poly[i * 2 + 1];
    const double xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > py) != (yj > py)) {
      const double x = xj + (py - yi) * (xj - xi) / (yj - yi);
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

// Do two screen segments cross? Used to decide whether a triangle edge touches
// the lasso ring when neither endpoint is inside it.
bool segmentsCross(double ax, double ay, double bx, double by, double cx, double cy, double dx,
                   double dy) {
  const auto side = [](double x0, double y0, double x1, double y1, double px, double py) {
    const double v = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
    return v > 0.0 ? 1 : (v < 0.0 ? -1 : 0);
  };
  const int d1 = side(ax, ay, bx, by, cx, cy);
  const int d2 = side(ax, ay, bx, by, dx, dy);
  const int d3 = side(cx, cy, dx, dy, ax, ay);
  const int d4 = side(cx, cy, dx, dy, bx, by);
  if (d1 != d2 && d3 != d4) return true;
  // Collinear-and-overlapping counts as touching: a lasso drawn exactly along a
  // silhouette edge must select it.
  const auto onSeg = [](double x0, double y0, double x1, double y1, double px, double py) {
    return std::min(x0, x1) <= px && px <= std::max(x0, x1) && std::min(y0, y1) <= py &&
           py <= std::max(y0, y1);
  };
  if (d1 == 0 && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (d2 == 0 && onSeg(ax, ay, bx, by, dx, dy)) return true;
  if (d3 == 0 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (d4 == 0 && onSeg(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

// Per-face tally: a face survives a WINDOW only if every triangle of it was
// inside, and a CROSSING if any was. Carrying both counts means one pass answers
// both questions and the two modes cannot drift apart.
struct FaceTally {
  std::size_t triangles = 0;
  std::size_t inside = 0;
  std::size_t touching = 0;
};

RegionSelection collect(const std::map<std::uint32_t, FaceTally>& tally, RegionMode mode,
                        std::size_t tested, std::size_t behind) {
  RegionSelection out;
  out.trianglesTested = tested;
  out.behindEye = behind;
  for (const auto& e : tally) {
    if (e.first == 0) continue;  // face id 0 is "unknown", never selectable
    out.trianglesInside += e.second.inside;
    const bool keep = mode == RegionMode::Window ? (e.second.inside == e.second.triangles)
                                                 : (e.second.touching != 0);
    if (keep) out.faces.push_back(e.first);
  }
  // std::map already orders the keys, so `faces` comes back sorted and distinct.
  return out;
}

}  // namespace

ScreenPoint projectPoint(const float viewProj[16], const ViewRect& view, const double p[3]) {
  ScreenPoint out;
  const double px = p[0], py = p[1], pz = p[2];
  const double cx = static_cast<double>(viewProj[0]) * px + static_cast<double>(viewProj[4]) * py +
                    static_cast<double>(viewProj[8]) * pz + static_cast<double>(viewProj[12]);
  const double cy = static_cast<double>(viewProj[1]) * px + static_cast<double>(viewProj[5]) * py +
                    static_cast<double>(viewProj[9]) * pz + static_cast<double>(viewProj[13]);
  const double cw = static_cast<double>(viewProj[3]) * px + static_cast<double>(viewProj[7]) * py +
                    static_cast<double>(viewProj[11]) * pz + static_cast<double>(viewProj[15]);
  if (!(cw > 1e-9)) return out;  // at or behind the eye plane: no honest screen position
  out.depth = cw;
  // Vulkan NDC: x in [-1,1] left to right, y in [-1,1] TOP to bottom (the
  // projection already carries the Y flip), so the viewport map ADDS y rather
  // than subtracting it. Getting this backwards renders every overlay mirrored
  // about the horizontal centre line, which is frame_gate mutation 5.
  out.x = view.x + (cx / cw * 0.5 + 0.5) * view.w;
  out.y = view.y + (cy / cw * 0.5 + 0.5) * view.h;
  out.visible = true;
  return out;
}

RegionMode regionModeForDrag(const ScreenBox& box) noexcept {
  return box.x1 >= box.x0 ? RegionMode::Window : RegionMode::Crossing;
}

RegionSelection boxSelectFaces(const MeasureMesh& mesh, const float viewProj[16],
                               const ViewRect& view, const ScreenBox& box, RegionMode mode) {
  std::map<std::uint32_t, FaceTally> tally;
  std::size_t tested = 0;
  std::size_t behind = 0;
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();

  for (std::size_t t = 0; t < ids.size(); ++t) {
    ++tested;
    FaceTally& f = tally[ids[t]];
    ++f.triangles;
    ScreenPoint s[3];
    bool allVisible = true;
    for (int c = 0; c < 3; ++c) {
      s[c] = projectPoint(viewProj, view, &xyz[t * 9 + static_cast<std::size_t>(c) * 3]);
      if (!s[c].visible) allVisible = false;
    }
    if (!allVisible) {
      // A triangle straddling the eye plane has no screen footprint this code can
      // reason about. It is counted, NOT silently treated as inside: under WINDOW
      // that would select a face the user cannot see, which is the exact way a
      // box select ends up grabbing the back of the part.
      ++behind;
      continue;
    }
    int in = 0;
    for (int c = 0; c < 3; ++c) {
      if (box.contains(s[c].x, s[c].y)) ++in;
    }
    if (in == 3) {
      ++f.inside;
      ++f.touching;
      continue;
    }
    if (in > 0) {
      ++f.touching;
      continue;
    }
    // No corner inside: the triangle still TOUCHES if an edge crosses the box,
    // or if the box lies entirely within the triangle (a small band dragged over
    // a large face). Both are real cases on a 400-face part.
    bool touches = false;
    for (int e = 0; e < 3 && !touches; ++e) {
      const ScreenPoint& a = s[e];
      const ScreenPoint& b = s[(e + 1) % 3];
      touches = segmentTouchesBox(a.x, a.y, b.x, b.y, box);
    }
    if (!touches) {
      const double poly[6] = {s[0].x, s[0].y, s[1].x, s[1].y, s[2].x, s[2].y};
      const std::vector<double> tri(poly, poly + 6);
      touches = pointInPolygon(tri, box.minX(), box.minY());
    }
    if (touches) ++f.touching;
  }
  return collect(tally, mode, tested, behind);
}

RegionSelection lassoSelectFaces(const MeasureMesh& mesh, const float viewProj[16],
                                 const ViewRect& view, const std::vector<double>& polygon,
                                 RegionMode mode) {
  RegionSelection empty;
  if (polygon.size() < 6) return empty;  // fewer than 3 points is not a loop

  std::map<std::uint32_t, FaceTally> tally;
  std::size_t tested = 0;
  std::size_t behind = 0;
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  const std::size_t np = polygon.size() / 2;

  for (std::size_t t = 0; t < ids.size(); ++t) {
    ++tested;
    FaceTally& f = tally[ids[t]];
    ++f.triangles;
    ScreenPoint s[3];
    bool allVisible = true;
    for (int c = 0; c < 3; ++c) {
      s[c] = projectPoint(viewProj, view, &xyz[t * 9 + static_cast<std::size_t>(c) * 3]);
      if (!s[c].visible) allVisible = false;
    }
    if (!allVisible) {
      ++behind;
      continue;
    }
    int in = 0;
    for (int c = 0; c < 3; ++c) {
      if (pointInPolygon(polygon, s[c].x, s[c].y)) ++in;
    }
    if (in == 3) {
      ++f.inside;
      ++f.touching;
      continue;
    }
    if (in > 0) {
      ++f.touching;
      continue;
    }
    bool touches = false;
    for (std::size_t i = 0, j = np - 1; i < np && !touches; j = i++) {
      for (int e = 0; e < 3 && !touches; ++e) {
        touches = segmentsCross(s[e].x, s[e].y, s[(e + 1) % 3].x, s[(e + 1) % 3].y,
                                polygon[j * 2], polygon[j * 2 + 1], polygon[i * 2],
                                polygon[i * 2 + 1]);
      }
    }
    if (!touches) {
      // The whole lasso inside one big triangle.
      const double tri[6] = {s[0].x, s[0].y, s[1].x, s[1].y, s[2].x, s[2].y};
      const std::vector<double> triPoly(tri, tri + 6);
      touches = pointInPolygon(triPoly, polygon[0], polygon[1]);
    }
    if (touches) ++f.touching;
  }
  return collect(tally, mode, tested, behind);
}

std::vector<std::size_t> boxSelectEdges(const EdgeSet& set, const float viewProj[16],
                                        const ViewRect& view, const ScreenBox& box,
                                        RegionMode mode) {
  std::vector<std::size_t> out;
  for (std::size_t e = 0; e < set.edges.size(); ++e) {
    const MeshEdge& edge = set.edges[e];
    bool allInside = true;
    bool anyTouch = false;
    bool sawSegment = false;
    for (std::size_t s = 0; s + 5 < edge.points.size(); s += 6) {
      const ScreenPoint a = projectPoint(viewProj, view, &edge.points[s]);
      const ScreenPoint b = projectPoint(viewProj, view, &edge.points[s + 3]);
      if (!a.visible || !b.visible) {
        allInside = false;
        continue;
      }
      sawSegment = true;
      const bool ai = box.contains(a.x, a.y);
      const bool bi = box.contains(b.x, b.y);
      if (!ai || !bi) allInside = false;
      if (ai || bi || segmentTouchesBox(a.x, a.y, b.x, b.y, box)) anyTouch = true;
    }
    if (!sawSegment) continue;
    if (mode == RegionMode::Window ? allInside : anyTouch) out.push_back(e);
  }
  return out;
}

std::vector<std::size_t> boxSelectVertices(const VertexSet& set, const float viewProj[16],
                                           const ViewRect& view, const ScreenBox& box) {
  std::vector<std::size_t> out;
  for (std::size_t i = 0; i < set.vertices.size(); ++i) {
    const ScreenPoint p = projectPoint(viewProj, view, set.vertices[i].p);
    if (!p.visible) continue;
    if (box.contains(p.x, p.y)) out.push_back(i);
  }
  return out;
}

// ── bounds ──────────────────────────────────────────────────────────────────
MeasureBox faceBounds(const MeasureMesh& mesh, const std::vector<std::uint32_t>& faceIds) {
  MeasureBox box;
  if (faceIds.empty()) return box;
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  for (std::size_t t = 0; t < ids.size(); ++t) {
    if (std::find(faceIds.begin(), faceIds.end(), ids[t]) == faceIds.end()) continue;
    for (int c = 0; c < 3; ++c) box.grow(&xyz[t * 9 + static_cast<std::size_t>(c) * 3]);
  }
  return box;
}

MeasureBox edgeBounds(const EdgeSet& set, const std::vector<std::size_t>& indices) {
  MeasureBox box;
  for (std::size_t i : indices) {
    if (i >= set.edges.size()) continue;
    const MeshEdge& e = set.edges[i];
    for (std::size_t s = 0; s + 2 < e.points.size(); s += 3) box.grow(&e.points[s]);
  }
  return box;
}

MeasureBox vertexBounds(const VertexSet& set, const std::vector<std::size_t>& indices) {
  MeasureBox box;
  for (std::size_t i : indices) {
    if (i >= set.vertices.size()) continue;
    box.grow(set.vertices[i].p);
  }
  return box;
}

void boundsSphere(const MeasureBox& box, double centre[3], double& radius, double minRadius) {
  centre[0] = centre[1] = centre[2] = 0.0;
  radius = minRadius > 0.0 ? minRadius : 1.0;
  if (!box.valid) return;
  box.centre(centre);
  const double half = 0.5 * box.diagonal();
  if (half > radius) radius = half;
}

}  // namespace forge::ui
