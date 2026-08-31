// ui/test/sketch_test.cpp
//
// The sketch DATA MODEL, against closed forms.
//
// Every reference here is a number that can be written down before the code
// runs: an arc's endpoint is (cx + r cos a, cy + r sin a), a unit square's
// polyline area is 1, a 5-parameter arc has 5 degrees of freedom because an arc
// has 5. A model gate whose reference is "whatever the code returned" measures
// nothing.
//
// The REFUSALS are the point of the second half. `resolvePoint` must answer
// "no" for `Center` on a line-as-direction, for `Start` on a circle, and for an
// entity index that does not exist — because the solver turns exactly those
// answers into a MALFORMED constraint report, and a reader that invented (0, 0)
// instead would turn a user's typo into geometry pinned to the origin.
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/Sketch.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

constexpr double kPi = 3.14159265358979323846;

double polylineArea(const std::vector<double>& pts) {
  const std::size_t n = pts.size() / 2;
  if (n < 3) return 0.0;
  double acc = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    const std::size_t j = (i + 1) % n;
    acc += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return 0.5 * acc;
}

}  // namespace

int main() {
  Harness H("sketch");

  // ── 1. the standard planes ────────────────────────────────────────────────
  {
    const SketchPlane xy = SketchPlane::standard(SketchPlaneKind::XY);
    CHECK(xy.orthonormal());
    CHECK(xy.isWorldXY());
    double w[3];
    xy.toWorld(3.0, 4.0, w);
    CHECK_NEAR(w[0], 3.0, 1e-12);
    CHECK_NEAR(w[1], 4.0, 1e-12);
    CHECK_NEAR(w[2], 0.0, 1e-12);

    const SketchPlane yz = SketchPlane::standard(SketchPlaneKind::YZ);
    CHECK(yz.orthonormal());
    CHECK(!yz.isWorldXY());
    yz.toWorld(3.0, 4.0, w);
    // u runs along +Y, v along +Z (normal +X, right-handed).
    CHECK_NEAR(w[0], 0.0, 1e-12);
    CHECK_NEAR(w[1], 3.0, 1e-12);
    CHECK_NEAR(w[2], 4.0, 1e-12);

    const SketchPlane xz = SketchPlane::standard(SketchPlaneKind::XZ);
    CHECK(xz.orthonormal());
    xz.toWorld(3.0, 4.0, w);
    // Normal -Y is deliberate: with +Y the v axis would come out as -Z and every
    // front-plane sketch would be built upside down.
    CHECK_NEAR(w[0], 3.0, 1e-12);
    CHECK_NEAR(w[1], 0.0, 1e-12);
    CHECK_NEAR(w[2], 4.0, 1e-12);
    CHECK_EQ_STR(toString(xz.kind), "XZ");
  }

  // ── 2. a custom plane orthonormalises, and refuses the degenerate frames ──
  {
    const double o[3] = {10.0, 0.0, 5.0};
    const double n[3] = {0.0, 0.0, 2.0};      // not unit
    const double x[3] = {3.0, 0.0, 7.0};      // not unit, and not in the plane
    SketchPlane p;
    CHECK(SketchPlane::custom(o, n, x, p));
    CHECK(p.orthonormal());
    CHECK_NEAR(p.normal[2], 1.0, 1e-12);
    CHECK_NEAR(p.xAxis[0], 1.0, 1e-12);   // the +Z component is projected off
    CHECK_NEAR(p.xAxis[2], 0.0, 1e-12);
    CHECK(!p.isWorldXY());                // its origin is (10, 0, 5)
    double w[3];
    p.toWorld(1.0, 2.0, w);
    CHECK_NEAR(w[0], 11.0, 1e-12);
    CHECK_NEAR(w[1], 2.0, 1e-12);
    CHECK_NEAR(w[2], 5.0, 1e-12);

    SketchPlane bad;
    const double zero[3] = {0.0, 0.0, 0.0};
    CHECK(!SketchPlane::custom(o, zero, x, bad));         // no normal
    const double along[3] = {0.0, 0.0, 3.0};
    CHECK(!SketchPlane::custom(o, n, along, bad));        // xAxis IS the normal

    Sketch s;
    CHECK(s.setPlane(p));
    SketchPlane skew = p;
    skew.xAxis[2] = 0.5;                                   // no longer orthonormal
    CHECK(!s.setPlane(skew));
    CHECK_NEAR(s.plane().xAxis[2], 0.0, 1e-12);            // and nothing moved
  }

  // ── 3. the parameter layout is the degree-of-freedom count ────────────────
  {
    Sketch s;
    const int pt = s.addPoint("p", 1.0, 2.0);
    const int ln = s.addLine("l", 0.0, 0.0, 10.0, 0.0);
    const int ci = s.addCircle("c", 5.0, 5.0, 3.0);
    const int ar = s.addArc("a", 0.0, 0.0, 4.0, 0.0, 90.0);
    const int el = s.addEllipse("e", 1.0, 1.0, 6.0, 2.0, 30.0);
    const int sp = s.addSpline("s", {0.0, 0.0, 5.0, 5.0, 10.0, 0.0});
    CHECK_EQ_INT(s.entityCount(), 6);
    CHECK_EQ_INT(s.paramCountOf(pt), 2);
    CHECK_EQ_INT(s.paramCountOf(ln), 4);
    CHECK_EQ_INT(s.paramCountOf(ci), 3);
    CHECK_EQ_INT(s.paramCountOf(ar), 5);
    CHECK_EQ_INT(s.paramCountOf(el), 5);
    CHECK_EQ_INT(s.paramCountOf(sp), 6);
    CHECK_EQ_INT(s.paramCount(), 2 + 4 + 3 + 5 + 5 + 6);
    CHECK_EQ_INT(s.degreesOfFreedom(), 25);

    CHECK_EQ_INT(s.paramBase(pt), 0);
    CHECK_EQ_INT(s.paramBase(ln), 2);
    CHECK_EQ_INT(s.paramBase(ci), 6);
    CHECK_EQ_INT(s.paramBase(ar), 9);
    CHECK_EQ_INT(s.paramBase(el), 14);
    CHECK_EQ_INT(s.paramBase(sp), 19);

    // The flat vector round-trips, and a vector of the wrong length is refused
    // WITHOUT partial application — half a solution is neither the input nor the
    // answer.
    std::vector<double> x = s.parameters();
    CHECK_EQ_INT(x.size(), 25);
    x[0] = 99.0;
    CHECK(s.setParameters(x));
    CHECK_NEAR(s.entity(pt)->params[0], 99.0, 1e-12);
    std::vector<double> shortVec(24, 0.0);
    CHECK(!s.setParameters(shortVec));
    CHECK_NEAR(s.entity(pt)->params[0], 99.0, 1e-12);

    // Angles are stored in RADIANS; the authoring API takes degrees.
    CHECK_NEAR(s.entity(ar)->params[4], kPi / 2.0, 1e-12);
    CHECK_NEAR(s.entity(el)->params[4], kPi / 6.0, 1e-12);
  }

  // ── 4. authoring refusals ─────────────────────────────────────────────────
  {
    Sketch s;
    CHECK(s.addPoint("p", 0, 0) >= 0);
    CHECK_EQ_INT(s.addPoint("p", 1, 1), kNoSketchEntity);      // duplicate name
    CHECK_EQ_INT(s.addLine("", 0, 0, 1, 1), kNoSketchEntity);  // empty name
    CHECK_EQ_INT(s.addCircle("c", 0, 0, 0.0), kNoSketchEntity);
    CHECK_EQ_INT(s.addCircle("c", 0, 0, -2.0), kNoSketchEntity);
    CHECK_EQ_INT(s.addArc("a", 0, 0, -1.0, 0, 90), kNoSketchEntity);
    CHECK_EQ_INT(s.addEllipse("e", 0, 0, 5.0, 0.0, 0.0), kNoSketchEntity);
    CHECK_EQ_INT(s.addSpline("s", {0.0, 0.0}), kNoSketchEntity);       // one point
    CHECK_EQ_INT(s.addSpline("s", {0.0, 0.0, 1.0}), kNoSketchEntity);  // odd length
    CHECK_EQ_INT(s.entityCount(), 1);
    CHECK_EQ_INT(s.find("p"), 0);
    CHECK_EQ_INT(s.find("nothing"), kNoSketchEntity);
    CHECK(s.entity(7) == nullptr);
    CHECK(s.entity(-1) == nullptr);
  }

  // ── 5. point resolution, including every refusal ──────────────────────────
  {
    Sketch s;
    const int ln = s.addLine("l", 1.0, 2.0, 7.0, 10.0);
    const int ci = s.addCircle("c", 3.0, 4.0, 5.0);
    const int ar = s.addArc("a", 10.0, 0.0, 2.0, 0.0, 90.0);
    const int sp = s.addSpline("s", {0.0, 0.0, 1.0, 4.0, 8.0, 1.0});
    const std::vector<double> x = s.parameters();
    double px = 0.0, py = 0.0;

    CHECK(resolvePoint(s, x, sketchRef(ln, SketchPointRole::Start), px, py));
    CHECK_NEAR(px, 1.0, 1e-12);
    CHECK_NEAR(py, 2.0, 1e-12);
    CHECK(resolvePoint(s, x, sketchRef(ln, SketchPointRole::End), px, py));
    CHECK_NEAR(px, 7.0, 1e-12);
    CHECK_NEAR(py, 10.0, 1e-12);
    CHECK(resolvePoint(s, x, sketchRef(ln, SketchPointRole::Center), px, py));
    CHECK_NEAR(px, 4.0, 1e-12);          // the midpoint
    CHECK_NEAR(py, 6.0, 1e-12);
    CHECK(!resolvePoint(s, x, sketchRef(ln, SketchPointRole::Self), px, py));

    CHECK(resolvePoint(s, x, sketchRef(ci, SketchPointRole::Center), px, py));
    CHECK_NEAR(px, 3.0, 1e-12);
    CHECK_NEAR(py, 4.0, 1e-12);
    CHECK(!resolvePoint(s, x, sketchRef(ci, SketchPointRole::Start), px, py));
    CHECK(!resolvePoint(s, x, sketchRef(ci, SketchPointRole::Self), px, py));

    // The arc's endpoints are DERIVED, which is why an arc has 5 dof and not 7.
    CHECK(resolvePoint(s, x, sketchRef(ar, SketchPointRole::Start), px, py));
    CHECK_NEAR(px, 12.0, 1e-12);
    CHECK_NEAR(py, 0.0, 1e-12);
    CHECK(resolvePoint(s, x, sketchRef(ar, SketchPointRole::End), px, py));
    CHECK_NEAR(px, 10.0, 1e-12);
    CHECK_NEAR(py, 2.0, 1e-12);

    CHECK(resolvePoint(s, x, sketchRef(sp, SketchPointRole::Start), px, py));
    CHECK_NEAR(px, 0.0, 1e-12);
    CHECK(resolvePoint(s, x, sketchRef(sp, SketchPointRole::End), px, py));
    CHECK_NEAR(px, 8.0, 1e-12);
    CHECK_NEAR(py, 1.0, 1e-12);

    CHECK(!resolvePoint(s, x, sketchRef(42, SketchPointRole::Start), px, py));
    CHECK(!resolvePoint(s, x, SketchRef{}, px, py));
    // A parameter vector of the wrong length reads nothing rather than reading
    // past the end of a stale one.
    const std::vector<double> stale(4, 0.0);
    CHECK(!resolvePoint(s, stale, sketchRef(ln, SketchPointRole::Start), px, py));

    double dx = 0.0, dy = 0.0, r = 0.0, len = 0.0;
    CHECK(resolveDirection(s, x, ln, dx, dy));
    CHECK_NEAR(dx, 6.0, 1e-12);
    CHECK_NEAR(dy, 8.0, 1e-12);
    CHECK(!resolveDirection(s, x, ci, dx, dy));   // a circle has no direction
    CHECK(!resolveDirection(s, x, ar, dx, dy));   // an arc's is ambiguous
    CHECK(resolveRadius(s, x, ci, r));
    CHECK_NEAR(r, 5.0, 1e-12);
    CHECK(resolveRadius(s, x, ar, r));
    CHECK_NEAR(r, 2.0, 1e-12);
    CHECK(!resolveRadius(s, x, ln, r));
    CHECK(resolveLength(s, x, ln, len));
    CHECK_NEAR(len, 10.0, 1e-12);                 // 6-8-10
    CHECK(!resolveLength(s, x, ci, len));
  }

  // ── 6. tessellation ───────────────────────────────────────────────────────
  {
    Sketch s;
    const int ln = s.addLine("l", 0, 0, 3, 4);
    const int ci = s.addCircle("c", 0, 0, 10);
    const int ar = s.addArc("a", 0, 0, 10, 0, 90);
    const int wrap = s.addArc("w", 0, 0, 10, 350, 10);
    const int el = s.addEllipse("e", 0, 0, 20, 10, 0);

    const std::vector<double> line = s.polyline(ln, 8);
    CHECK_EQ_INT(line.size(), 4);           // a line is two points, whatever seg says
    CHECK_NEAR(line[2], 3.0, 1e-12);

    // An inscribed n-gon of a circle of radius R has area (n/2) R^2 sin(2pi/n).
    const std::size_t n = 64;
    const std::vector<double> circle = s.polyline(ci, n);
    CHECK_EQ_INT(circle.size(), n * 2);
    const double want = 0.5 * static_cast<double>(n) * 100.0 * std::sin(2.0 * kPi / static_cast<double>(n));
    CHECK_NEAR(polylineArea(circle), want, 1e-9);
    // ...and it IS a circle: the inscribed polygon undershoots pi R^2 by
    // exactly 2 pi^3 R^2 / (3 n^2) = 0.5046 mm^2 here (sin x = x - x^3/6), so a
    // tolerance of 0.51 admits the chord error and NOTHING else. A looser one
    // would pass on a shape that is not a circle.
    CHECK_NEAR(polylineArea(circle), kPi * 100.0, 0.51);
    CHECK(polylineArea(circle) < kPi * 100.0);             // inscribed, never circumscribed

    const std::vector<double> arc = s.polyline(ar, 4);
    CHECK_EQ_INT(arc.size(), 5 * 2);        // seg + 1 points from start to end
    CHECK_NEAR(arc[0], 10.0, 1e-12);
    CHECK_NEAR(arc[1], 0.0, 1e-12);
    CHECK_NEAR(arc[8], 0.0, 1e-12);
    CHECK_NEAR(arc[9], 10.0, 1e-12);
    CHECK_NEAR(arc[4], 10.0 * std::cos(kPi / 4.0), 1e-12);  // the midpoint of the sweep

    // 350 -> 10 degrees is the 20-degree arc ACROSS zero, not 340 degrees
    // backwards. The endpoint is the test: sin(10 deg) is positive.
    const std::vector<double> across = s.polyline(wrap, 2);
    CHECK_EQ_INT(across.size(), 3 * 2);
    CHECK_NEAR(across[4], 10.0 * std::cos(kPi / 18.0), 1e-12);
    CHECK_NEAR(across[5], 10.0 * std::sin(kPi / 18.0), 1e-12);
    CHECK_NEAR(across[2], 10.0, 1e-12);     // the midpoint sits at angle 0
    CHECK_NEAR(across[3], 0.0, 1e-12);

    // An ellipse's inscribed polygon area scales the circle's by rx*ry/R^2.
    const std::vector<double> ell = s.polyline(el, n);
    const double wantEll = 0.5 * static_cast<double>(n) * 20.0 * 10.0 * std::sin(2.0 * kPi / static_cast<double>(n));
    CHECK_NEAR(polylineArea(ell), wantEll, 1e-9);

    // A spline INTERPOLATES its control points: the tessellation must pass
    // through each one, or a coincident constraint on an endpoint means nothing.
    const int sp = s.addSpline("s", {0, 0, 10, 10, 20, 0, 30, 10});
    const std::vector<double> curve = s.polyline(sp, 5);
    CHECK_EQ_INT(curve.size(), (3 * 5 + 1) * 2);
    CHECK_NEAR(curve[0], 0.0, 1e-12);
    CHECK_NEAR(curve[1], 0.0, 1e-12);
    CHECK_NEAR(curve[5 * 2], 10.0, 1e-12);       // control point 1
    CHECK_NEAR(curve[5 * 2 + 1], 10.0, 1e-12);
    CHECK_NEAR(curve[10 * 2], 20.0, 1e-12);      // control point 2
    CHECK_NEAR(curve[10 * 2 + 1], 0.0, 1e-12);
    CHECK_NEAR(curve[curve.size() - 2], 30.0, 1e-12);
    CHECK_NEAR(curve[curve.size() - 1], 10.0, 1e-12);

    CHECK_EQ_INT(s.polyline(99, 8).size(), 0);
  }

  // ── 7. construction geometry is carried, not lost ─────────────────────────
  {
    Sketch s;
    const int a = s.addLine("axis", 0, 0, 0, 100, true);
    const int b = s.addLine("edge", 0, 0, 50, 0);
    CHECK(s.entity(a)->construction);
    CHECK(!s.entity(b)->construction);
    CHECK(s.setConstruction(b, true));
    CHECK(s.entity(b)->construction);
    CHECK(!s.setConstruction(99, true));
    // Construction geometry keeps its parameters: it is real geometry a
    // constraint can name, it is only excluded from the PROFILE.
    CHECK_EQ_INT(s.paramCount(), 8);
    CHECK_EQ_STR(toString(s.entity(a)->kind), "line");
  }

  // ── 8. the enum spellings a diagnostic prints ─────────────────────────────
  {
    CHECK_EQ_STR(toString(SketchEntityKind::Arc), "arc");
    CHECK_EQ_STR(toString(SketchEntityKind::Spline), "spline");
    CHECK_EQ_STR(toString(SketchEntityKind::Ellipse), "ellipse");
    CHECK_EQ_STR(toString(SketchPointRole::Center), "center");
    CHECK_EQ_STR(toString(SketchPointRole::Self), "self");
    CHECK_EQ_STR(toString(SketchPlaneKind::YZ), "YZ");
    CHECK_EQ_STR(toString(SketchPlaneKind::Custom), "custom");
  }

  return H.finish();
}
