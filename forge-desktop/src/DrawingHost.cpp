#include "DrawingHost.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <exception>
#include <initializer_list>
#include <limits>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "forge/Booleans.hpp"
#include "forge/OcctImport.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/native/brep/Hlr.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/ui/Drawing.hpp"

namespace forge::desktop {

namespace {

using forge::native::brep::HlrEdgeKind;
using forge::native::brep::HlrResult;
using forge::native::brep::HlrSegment;
using forge::native::brep::HlrVisibility;
using forge::native::brep::Solid;
using forge::native::brep::Vec3;

double dot(const Vec3& p, const double a[3]) { return p.x * a[0] + p.y * a[1] + p.z * a[2]; }

// The angle between two normals, 0 when either is unusable.
double angleBetween(const Vec3& a, const Vec3& b) {
  const double la = std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  const double lb = std::sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
  if (!(la > 0.0) || !(lb > 0.0) || !std::isfinite(la) || !std::isfinite(lb)) return 0.0;
  const double c = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return std::acos(std::clamp(c, -1.0, 1.0));
}

// ── how finely the HLR tessellates curved faces for its depth test ─────────
// hiddenLineRemoval triangulates EVERY curved face into HlrOptions::curveTess
// chords across that face's own u-range -- 48 by default, which on a WHOLE
// cylinder face is a 7.5-degree chord. importOcctSolid does not hand over whole
// faces: it cuts each curved face into a grid of strips (the app's starting part
// arrives as 34176 faces, 32768 of them NURBS cells), and 48 chords per strip is
// 48 times the density the default buys a whole face, at a cost the export could
// not afford -- MEASURED on that part: 20.1 s / 31.2 s for the front / side view.
// So the count is chosen here from the faces actually handed over: the smallest
// that keeps EVERY curved face's chord at or below the default's 7.5 degrees,
// floored at 4 and capped at the default. A native solid whose cylinder is one
// face still gets 48; the starting part gets 4, and its three views drawn at 4 and
// at 48 cover each other's visible and hidden ink to 2 micrometres (measured,
// T-230 evidence probe/diff_t4_t48_e9.log) in a tenth of the time.
std::size_t occluderTessellation(const Solid& solid) {
  constexpr double kPi = 3.14159265358979323846;
  constexpr double kDefaultChord = 2.0 * kPi / 48.0;
  double worst = 0.0;
  for (const forge::native::brep::Shell* sh : solid.shells) {
    if (sh == nullptr) continue;
    for (const forge::native::brep::Face* f : sh->faces) {
      if (f == nullptr || f->surface == nullptr) continue;
      const forge::native::brep::Surface& s = *f->surface;
      double span = 0.0;
      switch (s.kind) {
        case forge::native::brep::SurfaceKind::Plane:
          continue;
        case forge::native::brep::SurfaceKind::Cylinder:
        case forge::native::brep::SurfaceKind::Cone:
        case forge::native::brep::SurfaceKind::EllipseExtrusion:
          span = std::fabs(f->u1 - f->u0);  // u is the angle
          break;
        case forge::native::brep::SurfaceKind::Sphere:
        case forge::native::brep::SurfaceKind::Torus:
          span = std::max(std::fabs(f->u1 - f->u0), std::fabs(f->v1 - f->v0));  // both angles
          break;
        case forge::native::brep::SurfaceKind::Nurbs: {
          // No angle in the parameters: measure how far the normal turns across
          // the cell -- four corners and the centre, largest pairwise angle.
          const double um = 0.5 * (f->u0 + f->u1);
          const double vm = 0.5 * (f->v0 + f->v1);
          const Vec3 n[5] = {s.normalAt(f->u0, f->v0), s.normalAt(f->u1, f->v0),
                             s.normalAt(f->u0, f->v1), s.normalAt(f->u1, f->v1),
                             s.normalAt(um, vm)};
          for (int i = 0; i < 5; ++i) {
            for (int j = i + 1; j < 5; ++j) span = std::max(span, angleBetween(n[i], n[j]));
          }
          break;
        }
      }
      // A face whose extent cannot be read is drawn at the default density.
      if (!std::isfinite(span)) return forge::native::brep::HlrOptions{}.curveTess;
      worst = std::max(worst, span);
    }
  }
  const std::size_t cap = forge::native::brep::HlrOptions{}.curveTess;
  const double need = std::ceil(worst / kDefaultChord);
  if (!(need < static_cast<double>(cap))) return cap;
  return std::max<std::size_t>(4, static_cast<std::size_t>(need));
}

// ── and how finely it pre-chords edges ──────────────────────────────────────
// HlrOptions::samplesPerEdge cuts EVERY edge into that many spans before it is
// classified: a curved edge so the chords follow its curve, and a STRAIGHT edge
// for no reason the HLR still has -- its own header says a straight edge is split
// at the exact occlusion crossings "at ANY samplesPerEdge value (even 1)".
// importOcctSolid gives no edge a curve (each is the straight chord between two
// welded boundary samples), so the default 64 classified every edge of the
// starting part 64 times over. MEASURED, three views at curveTess 4: 6.7 s at 64,
// 2.9 s at 1, with the same visible lines and the same uncovered hidden lines
// (T-230 evidence probe/diff_t4spe1_t4spe64_e9.log). So: 1 when no edge of the
// body carries a curve, the default as soon as one does.
bool anyCurvedEdge(const Solid& solid) {
  for (const forge::native::brep::Shell* sh : solid.shells) {
    if (sh == nullptr) continue;
    for (const forge::native::brep::Face* f : sh->faces) {
      if (f == nullptr) continue;
      std::vector<const forge::native::brep::Loop*> loops;
      if (f->outerLoop != nullptr) loops.push_back(f->outerLoop);
      for (const forge::native::brep::Loop* il : f->innerLoops) loops.push_back(il);
      for (const forge::native::brep::Loop* lp : loops) {
        if (lp == nullptr) continue;
        const forge::native::brep::Coedge* c = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount && c != nullptr; ++i, c = c->next) {
          if (c->edge != nullptr && c->edge->curve != nullptr) return true;
        }
      }
    }
  }
  return false;
}

// The options this body is drawn with: the kernel's defaults, but for the two
// densities chosen above from the body itself.
forge::native::brep::HlrOptions hlrOptionsFor(const Solid& solid) {
  forge::native::brep::HlrOptions o;
  o.curveTess = occluderTessellation(solid);
  if (!anyCurvedEdge(solid)) o.samplesPerEdge = 1;
  return o;
}

// ── ONE LINE PER LINE ───────────────────────────────────────────────────────
// importOcctSolid welds every face from 64 samples per boundary edge, so the HLR
// hands back each real model edge as dozens of short collinear spans, each one
// (at the kernel's default 64 samples per edge) re-sampled along its length.
// MEASURED on the starting part before this pass: 3 views -> 6,884,127 bytes of
// SVG and a DXF of 385,799 LINE entities, for a plate a draughtsman draws with
// about forty lines -- and no single segment of the bore's hidden outline
// spanned the plate's thickness, so a CAD program opening the DXF could not even
// select it as one line. After it (and one sample per straight edge, chosen above):
// 131,256 bytes of SVG and 2,762 LINE entities, with the same picture.
//
// Two steps, within ONE visibility class (a visible span is never joined to a
// hidden one):
//   1. CHAIN spans that share an endpoint EXACTLY. The importer's shared
//      vertices are bit-identical and the projection is the same arithmetic for
//      both, so equality is the right test; a near miss is left as two lines.
//   2. DROP every point within kCollinearMm of the chord that replaces it
//      (Douglas-Peucker, so no dropped point is ever further than that from the
//      line that is drawn). A sampled straight edge collapses to its two ends; a
//      real arc keeps its chords, because a chord's sagitta is far above this.
// kCollinearMm is in MODEL millimetres: 1e-6 mm, three orders below the drawing's
// own 1e-3 mm acceptance tolerance at any standard enlargement up to 50:1.
constexpr double kCollinearMm = 1e-6;

using Pt2 = std::array<double, 2>;

double distToSegment(const Pt2& p, const Pt2& a, const Pt2& b) {
  const double ax = b[0] - a[0];
  const double ay = b[1] - a[1];
  const double l2 = ax * ax + ay * ay;
  double t = 0.0;
  if (l2 > 0.0) t = std::clamp(((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / l2, 0.0, 1.0);
  return std::hypot(a[0] + t * ax - p[0], a[1] + t * ay - p[1]);
}

void simplifyPolyline(std::vector<Pt2>& pts) {
  // Consecutive duplicates first: a zero-length span carries no ink.
  std::vector<Pt2> d;
  d.reserve(pts.size());
  for (const Pt2& p : pts) {
    if (d.empty() || d.back()[0] != p[0] || d.back()[1] != p[1]) d.push_back(p);
  }
  if (d.size() <= 2) {
    pts = std::move(d);
    return;
  }
  std::vector<char> keep(d.size(), 0);
  keep.front() = 1;
  keep.back() = 1;
  std::vector<std::pair<std::size_t, std::size_t>> work;
  work.emplace_back(0, d.size() - 1);
  while (!work.empty()) {
    const auto [i, j] = work.back();
    work.pop_back();
    if (j <= i + 1) continue;
    double worst = -1.0;
    std::size_t at = i;
    for (std::size_t k = i + 1; k < j; ++k) {
      const double dk = distToSegment(d[k], d[i], d[j]);
      if (dk > worst) {
        worst = dk;
        at = k;
      }
    }
    if (worst > kCollinearMm) {
      keep[at] = 1;
      work.emplace_back(i, at);
      work.emplace_back(at, j);
    }
  }
  std::vector<Pt2> out;
  for (std::size_t k = 0; k < d.size(); ++k) {
    if (keep[k]) out.push_back(d[k]);
  }
  pts = std::move(out);
}

// Chains then simplifies one class of a view. Deterministic: spans are taken in
// the HLR's own order and every endpoint lookup is an ordered map.
void tidyClass(std::vector<forge::ui::DrawingPolyline>& set) {
  const std::size_t n = set.size();
  std::map<Pt2, std::vector<std::size_t>> ends;
  for (std::size_t i = 0; i < n; ++i) {
    ends[set[i].points.front()].push_back(i);
    ends[set[i].points.back()].push_back(i);
  }
  std::vector<char> used(n, 0);
  // The first unused span other than `self` with an endpoint at `p`.
  const auto next = [&](const Pt2& p, std::size_t self) -> std::size_t {
    const auto it = ends.find(p);
    if (it == ends.end()) return n;
    for (std::size_t j : it->second) {
      if (j != self && !used[j]) return j;
    }
    return n;
  };
  std::vector<forge::ui::DrawingPolyline> out;
  for (std::size_t i = 0; i < n; ++i) {
    if (used[i]) continue;
    used[i] = 1;
    std::vector<Pt2> chain = set[i].points;
    // Forward from the back...
    for (std::size_t j = next(chain.back(), i); j < n; j = next(chain.back(), i)) {
      used[j] = 1;
      const std::vector<Pt2>& q = set[j].points;
      if (q.front() == chain.back()) {
        chain.insert(chain.end(), q.begin() + 1, q.end());
      } else {
        chain.insert(chain.end(), q.rbegin() + 1, q.rend());
      }
    }
    // ...then backward from the front.
    for (std::size_t j = next(chain.front(), i); j < n; j = next(chain.front(), i)) {
      used[j] = 1;
      const std::vector<Pt2>& q = set[j].points;
      std::vector<Pt2> head;
      if (q.back() == chain.front()) {
        head.assign(q.begin(), q.end() - 1);
      } else {
        head.assign(q.rbegin(), q.rend() - 1);
      }
      chain.insert(chain.begin(), head.begin(), head.end());
    }
    simplifyPolyline(chain);
    if (chain.size() < 2) continue;
    forge::ui::DrawingPolyline pl;
    pl.points = std::move(chain);
    out.push_back(std::move(pl));
  }
  set = std::move(out);
}

// One view through the native HLR, re-projected onto the drawing's own axes.
bool projectOne(const Solid& solid, const forge::native::brep::HlrOptions& options,
                forge::ui::NamedView view, forge::ui::DrawingViewLines& out, std::string& detail,
                std::size_t& edges) {
  const forge::ui::ViewAxes axes = forge::ui::drawingViewAxes(view);
  // `normal` points from the part TOWARD the viewer, so the viewer looks ALONG
  // -normal, which is the direction hiddenLineRemoval wants.
  const Vec3 lookAlong{-axes.normal[0], -axes.normal[1], -axes.normal[2]};
  HlrResult res;
  try {
    res = forge::native::brep::hiddenLineRemoval(solid, lookAlong, options);
  } catch (const std::exception& e) {
    detail += std::string("hlr threw: ") + e.what() + "; ";
    return false;
  } catch (...) {
    detail += "hlr threw; ";
    return false;
  }
  if (!res.ok) {
    detail += std::string("hlr declined: ") + (res.reason != nullptr ? res.reason : "") + "; ";
    return false;
  }
  edges += res.totalEdges;

  out = forge::ui::DrawingViewLines{};
  out.view = view;
  for (const HlrSegment& seg : res.segments) {
    if (seg.poly3d.size() < 2) continue;
    forge::ui::DrawingPolyline pl;
    pl.points.reserve(seg.poly3d.size());
    double lo[2] = {std::numeric_limits<double>::infinity(),
                    std::numeric_limits<double>::infinity()};
    double hi[2] = {-std::numeric_limits<double>::infinity(),
                    -std::numeric_limits<double>::infinity()};
    bool finite = true;
    for (const Vec3& p : seg.poly3d) {
      const double r = dot(p, axes.right);
      const double u = dot(p, axes.up);
      if (!std::isfinite(r) || !std::isfinite(u)) {
        finite = false;
        break;
      }
      pl.points.push_back({r, u});
      lo[0] = std::min(lo[0], r);
      lo[1] = std::min(lo[1], u);
      hi[0] = std::max(hi[0], r);
      hi[1] = std::max(hi[1], u);
    }
    if (!finite || pl.points.size() < 2) continue;
    // An edge seen end-on projects to a point and carries no ink; OCCT's HLR
    // omits these too, and the kernel's own emitter drops them at the same size.
    if (std::hypot(hi[0] - lo[0], hi[1] - lo[1]) <= 1e-7) continue;
    if (seg.visibility == HlrVisibility::Hidden) {
      out.hidden.push_back(std::move(pl));
    } else {
      // A silhouette that is visible is an outline, and an outline is drawn as a
      // visible line -- the routing the kernel's own drawing emitter uses.
      out.visible.push_back(std::move(pl));
    }
  }
  tidyClass(out.visible);
  tidyClass(out.hidden);
  if (out.visible.empty() && out.hidden.empty()) {
    detail += "hlr produced no drawable edges; ";
    return false;
  }
  // The extent is re-read from the lines as they will be drawn, so the cell the
  // sheet sizes from this and the ink in it are the same set of points.
  double minR = std::numeric_limits<double>::infinity();
  double minU = minR;
  double maxR = -std::numeric_limits<double>::infinity();
  double maxU = maxR;
  for (const std::vector<forge::ui::DrawingPolyline>* set : {&out.visible, &out.hidden}) {
    for (const forge::ui::DrawingPolyline& pl : *set) {
      for (const Pt2& q : pl.points) {
        minR = std::min(minR, q[0]);
        maxR = std::max(maxR, q[0]);
        minU = std::min(minU, q[1]);
        maxU = std::max(maxU, q[1]);
      }
    }
  }
  out.minRight = minR;
  out.maxRight = maxR;
  out.minUp = minU;
  out.maxUp = maxU;
  return true;
}

}  // namespace

DrawingProjectionResult projectDrawingViews(const DrawingProjectionRequest& request) {
  DrawingProjectionResult result;
  if (request.irProgram.empty()) {
    result.blocker = "There is nothing built to draw yet. Add a feature to the part and its "
                     "views can be saved.";
    return result;
  }

  using Clock = std::chrono::steady_clock;
  const auto msSince = [](Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
  };
  const Clock::time_point tCompile = Clock::now();
  // ── the document's own history, compiled the way the viewport compiles it ──
  forge::ft::CompileResult built;
  try {
    forge::resetBooleanBudget();
    const forge::ft::FeatureTree tree = forge::ft::parse(request.irProgram);
    built = forge::ft::compile(tree, request.inputFile);
  } catch (const std::exception& e) {
    result.detail = std::string("compile threw: ") + e.what();
    result.blocker = "The part did not rebuild, so there is nothing to draw. Fix the step the "
                     "feature tree marks as failed and save the drawing again.";
    return result;
  } catch (...) {
    result.detail = "compile threw";
    result.blocker = "The part did not rebuild, so there is nothing to draw. Fix the step the "
                     "feature tree marks as failed and save the drawing again.";
    return result;
  }
  if (!built.ok || built.handle == 0) {
    result.detail = "compile failed: " + built.error;
    result.blocker = "The part did not rebuild, so there is nothing to draw. Fix the step the "
                     "feature tree marks as failed and save the drawing again.";
    return result;
  }
  result.compileMs = msSince(tCompile);
  for (int i = 0; i < 3; ++i) {
    result.bboxMin[i] = built.bboxMin[i];
    result.bboxMax[i] = built.bboxMax[i];
  }

  // ── a native solid for the HLR ──────────────────────────────────────────
  // forge::ft::compile builds OCCT-backed bodies; the native analytic importer
  // turns one into the native B-rep the HLR reads. `imported` owns the result
  // for the whole of this call.
  const Clock::time_point tImport = Clock::now();
  forge::ImportResult imported;
  const Solid* solid = nullptr;
  try {
    forge::ShapeRegistry& reg = forge::ShapeRegistry::instance();
    const forge::ShapeKind kind = reg.kindOf(built.handle);
    if (kind == forge::ShapeKind::NativeSolid) {
      solid = &reg.getNativeSolid(built.handle);
    } else if (kind == forge::ShapeKind::Occt) {
      const TopoDS_Shape shape = reg.get(built.handle);  // a copy, not a borrow
      imported = forge::importOcctSolid(shape);
      if (imported.ok && imported.solid != nullptr) solid = imported.solid;
      else result.detail = "native import declined: " + imported.reason;
    } else {
      result.detail = "the body is a mesh, which has no edges to project";
    }
  } catch (const std::exception& e) {
    result.detail = std::string("native import threw: ") + e.what();
  } catch (...) {
    result.detail = "native import threw";
  }
  if (solid == nullptr) {
    result.blocker = "Forge cannot draw this part's edges yet: one of its surfaces is a kind the "
                     "drawing views do not cover. The 3-D model and its other exports are "
                     "unaffected.";
    return result;
  }

  result.importMs = msSince(tImport);
  for (const forge::native::brep::Shell* sh : solid->shells) {
    if (sh != nullptr) result.nativeFaces += sh->faces.size();
  }
  const Clock::time_point tViews = Clock::now();
  forge::native::brep::HlrOptions options;
  try {
    options = hlrOptionsFor(*solid);
  } catch (...) {
    // A surface that cannot be evaluated is drawn at the kernel's defaults; the
    // HLR itself will say so if it cannot draw it either.
    options = forge::native::brep::HlrOptions{};
  }
  result.curveTess = options.curveTess;
  result.samplesPerEdge = options.samplesPerEdge;
  for (forge::ui::NamedView v : request.views) {
    forge::ui::DrawingViewLines lines;
    bool drawn = false;
    try {
      // projectOne wraps the HLR itself; this catches what the tidying pass can
      // throw (an allocation), so the promise in the header holds.
      drawn = projectOne(*solid, options, v, lines, result.detail, result.edgesClassified);
    } catch (...) {
      result.detail += "view projection threw; ";
      drawn = false;
    }
    if (!drawn) {
      result.views.clear();
      result.blocker = "Forge could not work out which edges of this part are hidden in the " +
                       std::string(forge::ui::toString(v)) +
                       " view, so the drawing was not saved.";
      return result;
    }
    result.views.push_back(std::move(lines));
  }
  result.viewsMs = msSince(tViews);
  result.ok = true;
  return result;
}

}  // namespace forge::desktop
