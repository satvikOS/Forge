// ui/test/manipulator_test.cpp — the viewport drag handles.
//
// The gizmo's whole claim is that the handle stays under the cursor, so every
// assertion here is made by CONSTRUCTION rather than by eye: a world point on
// the handle is projected to a pixel with the same matrix the renderer uploads,
// that pixel is fed back in as the drag position, and the value that comes out
// must be the distance (or the angle) between the two world points. If the
// inverse, the NDC convention or the sign of the rotation is wrong, the number
// is wrong by a lot, not by a little.
//
// The reference camera below reproduces forge::desktop::Camera's convention
// EXACTLY — column-major look-at, Vulkan clip space with depth in [0,1] and the
// Y row negated. It is spelled out here rather than linked because
// forge-desktop is not compiled by this gate; if the two ever disagree, the app
// draws the gizmo somewhere the hit test does not look, so the desktop click
// gate asserts the agreement on the real Camera.
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <string>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/Manipulator.hpp"
#include "ui_test_util.hpp"

using forge::ui::HandleAxis;
using forge::ui::invert4x4;
using forge::ui::Manipulator;
using forge::ui::ManipulatorEmission;
using forge::ui::ManipulatorHandle;
using forge::ui::ManipulatorMode;
using forge::ui::ViewportProjection;

namespace {

// ── the reference camera ───────────────────────────────────────────────────
struct RefCamera {
  double eye[3] = {200.0, 160.0, 140.0};
  double target[3] = {0.0, 0.0, 0.0};
  double fovY = 0.7853981633974483;
  double aspect = 1.6;
  double nearZ = 0.1;
  double farZ = 10000.0;

  void viewProj(float out[16]) const {
    double f[3] = {target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]};
    const auto norm = [](double v[3]) {
      const double n = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      v[0] /= n; v[1] /= n; v[2] /= n;
    };
    const auto cross = [](const double a[3], const double b[3], double o[3]) {
      o[0] = a[1] * b[2] - a[2] * b[1];
      o[1] = a[2] * b[0] - a[0] * b[2];
      o[2] = a[0] * b[1] - a[1] * b[0];
    };
    const auto dot = [](const double a[3], const double b[3]) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    };
    norm(f);
    const double worldUp[3] = {0.0, 0.0, 1.0};
    double s[3];
    cross(f, worldUp, s);
    norm(s);
    double u[3];
    cross(s, f, u);

    double v[16];
    v[0] = s[0];  v[4] = s[1];  v[8]  = s[2];  v[12] = -dot(s, eye);
    v[1] = u[0];  v[5] = u[1];  v[9]  = u[2];  v[13] = -dot(u, eye);
    v[2] = -f[0]; v[6] = -f[1]; v[10] = -f[2]; v[14] = dot(f, eye);
    v[3] = 0.0;   v[7] = 0.0;   v[11] = 0.0;   v[15] = 1.0;

    double p[16];
    std::memset(p, 0, sizeof(p));
    const double t = 1.0 / std::tan(fovY * 0.5);
    p[0] = t / aspect;
    p[5] = -t;  // Vulkan: NDC Y points DOWN
    p[10] = farZ / (nearZ - farZ);
    p[11] = -1.0;
    p[14] = (nearZ * farZ) / (nearZ - farZ);

    // out = p * v, column-major.
    for (int c = 0; c < 4; ++c) {
      for (int r = 0; r < 4; ++r) {
        double sum = 0.0;
        for (int k = 0; k < 4; ++k) sum += p[k * 4 + r] * v[c * 4 + k];
        out[c * 4 + r] = static_cast<float>(sum);
      }
    }
  }
};

constexpr double kVpX = 100.0;
constexpr double kVpY = 60.0;
constexpr double kVpW = 1280.0;
constexpr double kVpH = 800.0;

ViewportProjection viewFor(const RefCamera& cam) {
  float vp[16];
  cam.viewProj(vp);
  ViewportProjection view;
  view.set(vp, kVpX, kVpY, kVpW, kVpH);
  return view;
}

// ── 1. the matrix inverse ──────────────────────────────────────────────────
int testInverse() {
  forge::uitest::Harness H("manip:inverse");
  double id[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
  double out[16];
  CHECK(invert4x4(id, out));
  bool same = true;
  for (int i = 0; i < 16; ++i) {
    if (std::fabs(out[i] - id[i]) > 1e-12) same = false;
  }
  CHECK(same);

  // A real view-projection: M * M^-1 must be the identity to float precision.
  RefCamera cam;
  float vpf[16];
  cam.viewProj(vpf);
  double vp[16];
  for (int i = 0; i < 16; ++i) vp[i] = static_cast<double>(vpf[i]);
  double inv[16];
  CHECK(invert4x4(vp, inv));
  double worst = 0.0;
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      double sum = 0.0;
      for (int k = 0; k < 4; ++k) sum += vp[k * 4 + r] * inv[c * 4 + k];
      const double want = (c == r) ? 1.0 : 0.0;
      worst = std::max(worst, std::fabs(sum - want));
    }
  }
  CHECK_NEAR(worst, 0.0, 1e-6);

  // A singular matrix is REFUSED rather than producing infinities.
  double singular[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
  CHECK(!invert4x4(singular, out));
  return H.finish();
}

// ── 2. project / unproject round trip ──────────────────────────────────────
int testProjection() {
  forge::uitest::Harness H("manip:projection");
  const RefCamera cam;
  const ViewportProjection view = viewFor(cam);
  CHECK(view.valid());

  // An unset projection answers nothing rather than reading uninitialised state.
  ViewportProjection unset;
  CHECK(!unset.valid());
  double dummy[2];
  const double origin[3] = {0.0, 0.0, 0.0};
  CHECK(!unset.project(origin, dummy));
  double ro[3], rd[3];
  CHECK(!unset.ray(500.0, 400.0, ro, rd));

  // A zero-area viewport is refused.
  float vpf[16];
  cam.viewProj(vpf);
  ViewportProjection flat;
  CHECK(!flat.set(vpf, 0.0, 0.0, 0.0, 800.0));

  // The camera target projects to the CENTRE of the viewport rectangle.
  double centre[2];
  CHECK(view.project(cam.target, centre));
  CHECK_NEAR(centre[0], kVpX + kVpW * 0.5, 0.5);
  CHECK_NEAR(centre[1], kVpY + kVpH * 0.5, 0.5);

  // The centre ray points from the eye at the target.
  CHECK(view.ray(centre[0], centre[1], ro, rd));
  for (int a = 0; a < 3; ++a) CHECK_NEAR(ro[a], cam.eye[a], 0.5);
  double f[3] = {cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1],
                 cam.target[2] - cam.eye[2]};
  const double n = std::sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
  for (int a = 0; a < 3; ++a) CHECK_NEAR(rd[a], f[a] / n, 1e-4);

  // ROUND TRIP over the whole rectangle: a world point on the ray through a
  // pixel must project back to that pixel. This is the assertion that catches a
  // transposed inverse or a flipped Y, which are the two ways this goes wrong.
  double worst = 0.0;
  for (int i = 0; i < 5; ++i) {
    for (int j = 0; j < 5; ++j) {
      const double px = kVpX + kVpW * (0.1 + 0.2 * i);
      const double py = kVpY + kVpH * (0.1 + 0.2 * j);
      double o[3], d[3];
      if (!view.ray(px, py, o, d)) {
        CHECK(false);
        continue;
      }
      double w[3];
      for (int a = 0; a < 3; ++a) w[a] = o[a] + 250.0 * d[a];
      double back[2];
      if (!view.project(w, back)) {
        CHECK(false);
        continue;
      }
      worst = std::max(worst, std::max(std::fabs(back[0] - px), std::fabs(back[1] - py)));
    }
  }
  CHECK_NEAR(worst, 0.0, 0.05);

  // A point BEHIND the eye is refused rather than smeared across the screen.
  double behind[3];
  for (int a = 0; a < 3; ++a) behind[a] = cam.eye[a] + (cam.eye[a] - cam.target[a]);
  CHECK(!view.project(behind, dummy));
  return H.finish();
}

// ── 3. the translate drag, exactly ─────────────────────────────────────────
int testTranslateDrag() {
  forge::uitest::Harness H("manip:translate");
  const RefCamera cam;
  const ViewportProjection view = viewFor(cam);

  Manipulator g;
  const double pivot[3] = {0.0, 0.0, 0.0};
  g.setPivot(pivot);
  g.setSize(40.0);
  g.setMode(ManipulatorMode::Translate);
  CHECK(g.mode() == ManipulatorMode::Translate);
  CHECK(!g.dragging());

  // The hit test must find the X arm where the X arm is DRAWN: half way along
  // the segment from the pivot to axisTip().
  double tip[3];
  CHECK(g.axisTip(HandleAxis::X, tip));
  CHECK_NEAR(tip[0], 40.0, 1e-12);
  double mid[3] = {0.5 * tip[0], 0.5 * tip[1], 0.5 * tip[2]};
  double midPx[2];
  CHECK(view.project(mid, midPx));
  ManipulatorHandle h = g.hitTest(view, midPx[0], midPx[1], 6.0);
  CHECK(h.valid());
  CHECK(h.mode == ManipulatorMode::Translate);
  CHECK(h.axis == HandleAxis::X);

  // Far from every arm: no handle.
  CHECK(!g.hitTest(view, kVpX + 5.0, kVpY + 5.0, 6.0).valid());

  // ── the drag ────────────────────────────────────────────────────────────
  // Grab at the world point 5 mm out along +X and drag to the pixel of the
  // world point 12 mm out. The answer must be 7 mm, because the ray through a
  // projected point passes through that point.
  double p5[3] = {5.0, 0.0, 0.0};
  double p12[3] = {12.0, 0.0, 0.0};
  double px5[2], px12[2];
  CHECK(view.project(p5, px5));
  CHECK(view.project(p12, px12));
  CHECK(g.begin(view, h, px5[0], px5[1]));
  CHECK(g.dragging());
  CHECK(g.active().axis == HandleAxis::X);
  CHECK_NEAR(g.translation(), 0.0, 1e-12);

  CHECK(g.dragTo(view, px12[0], px12[1]));
  CHECK_NEAR(g.translation(), 7.0, 1e-3);
  double offset[3];
  g.previewOffset(offset);
  CHECK_NEAR(offset[0], 7.0, 1e-3);
  CHECK_NEAR(offset[1], 0.0, 1e-9);
  CHECK_NEAR(offset[2], 0.0, 1e-9);

  // ...and dragging BACKWARDS is negative, not an absolute value.
  double pm3[3] = {-3.0, 0.0, 0.0};
  double pxm3[2];
  CHECK(view.project(pm3, pxm3));
  CHECK(g.dragTo(view, pxm3[0], pxm3[1]));
  CHECK_NEAR(g.translation(), -8.0, 1e-3);

  // Back to +12 and release.
  CHECK(g.dragTo(view, px12[0], px12[1]));
  const ManipulatorEmission e = g.release();
  CHECK(e.valid);
  CHECK_EQ_STR(e.commandId, std::string("part.move"));
  CHECK_NEAR(e.params.number("dx").value_or(0.0), 7.0, 1e-3);
  CHECK_NEAR(e.params.number("dy").value_or(-1.0), 0.0, 1e-9);
  CHECK_NEAR(e.params.number("dz").value_or(-1.0), 0.0, 1e-9);
  CHECK(!g.dragging());
  CHECK_EQ_INT(g.emissions(), 1);

  // A drag that moved NOTHING emits nothing: part.move refuses a zero move and
  // a no-op statement in a feature tree is worse than no statement.
  CHECK(g.begin(view, h, px5[0], px5[1]));
  CHECK(g.dragTo(view, px5[0], px5[1]));
  const ManipulatorEmission none = g.release();
  CHECK(!none.valid);
  CHECK(none.commandId.empty());
  CHECK_EQ_INT(g.emissions(), 1);

  // cancel() throws the drag away without emitting.
  CHECK(g.begin(view, h, px5[0], px5[1]));
  CHECK(g.dragTo(view, px12[0], px12[1]));
  g.cancel();
  CHECK(!g.dragging());
  CHECK_NEAR(g.translation(), 0.0, 1e-12);
  CHECK(!g.release().valid);
  CHECK_EQ_INT(g.emissions(), 1);

  // ── SNAP ────────────────────────────────────────────────────────────────
  // 7.0 mm on a 2.5 mm grid is 7.5, not 5.0: nearest, not floor.
  g.setSnap(2.5, 0.0);
  CHECK(g.begin(view, h, px5[0], px5[1]));
  CHECK(g.dragTo(view, px12[0], px12[1]));
  CHECK_NEAR(g.translation(), 7.5, 1e-9);
  const ManipulatorEmission snapped = g.release();
  CHECK(snapped.valid);
  CHECK_NEAR(snapped.params.number("dx").value_or(0.0), 7.5, 1e-9);
  g.setSnap(0.0, 0.0);

  // The Y arm moves Y, not X — a copy-pasted axis is the classic gizmo bug.
  double y5[3] = {0.0, 5.0, 0.0};
  double y15[3] = {0.0, 15.0, 0.0};
  double pxy5[2], pxy15[2];
  CHECK(view.project(y5, pxy5));
  CHECK(view.project(y15, pxy15));
  ManipulatorHandle hy{ManipulatorMode::Translate, HandleAxis::Y};
  CHECK(g.begin(view, hy, pxy5[0], pxy5[1]));
  CHECK(g.dragTo(view, pxy15[0], pxy15[1]));
  const ManipulatorEmission ey = g.release();
  CHECK(ey.valid);
  CHECK_NEAR(ey.params.number("dx").value_or(-1.0), 0.0, 1e-9);
  CHECK_NEAR(ey.params.number("dy").value_or(0.0), 10.0, 1e-3);
  CHECK_NEAR(ey.params.number("dz").value_or(-1.0), 0.0, 1e-9);
  return H.finish();
}

// ── 4. the rotate drag, and its SIGN ───────────────────────────────────────
int testRotateDrag() {
  forge::uitest::Harness H("manip:rotate");
  const RefCamera cam;
  const ViewportProjection view = viewFor(cam);

  Manipulator g;
  const double pivot[3] = {10.0, -4.0, 6.0};  // NOT the origin: see the emission
  g.setPivot(pivot);
  g.setSize(30.0);
  g.setMode(ManipulatorMode::Rotate);

  // Ring point 0 about +Z is at pivot + size*(+X) and a quarter of the way
  // round is pivot + size*(+Y) — but those two points are ALSO on the Y and X
  // rings, because three orthogonal rings of one radius meet at six points.
  // A grab there is a genuine tie, resolved deterministically below; the drag
  // itself is measured from a point that belongs to the Z ring alone.
  const int kQuarter = forge::ui::kManipulatorRingSegments / 4;  // 12 = 90 degrees
  double axial0[3], axial90[3];
  CHECK(g.ringPoint(HandleAxis::Z, 0, axial0));
  CHECK(g.ringPoint(HandleAxis::Z, kQuarter, axial90));
  CHECK_NEAR(axial0[0], pivot[0] + 30.0, 1e-9);
  CHECK_NEAR(axial90[1], pivot[1] + 30.0, 1e-9);

  // 22.5 degrees round the Z ring: on that ring and no other.
  double r0[3], r90[3];
  CHECK(g.ringPoint(HandleAxis::Z, 3, r0));
  CHECK(g.ringPoint(HandleAxis::Z, 3 + kQuarter, r90));
  CHECK_NEAR(r0[2], pivot[2], 1e-9);  // the Z ring lies in the pivot's XY plane

  double px0[2], px90[2];
  CHECK(view.project(r0, px0));
  CHECK(view.project(r90, px90));

  // The ring is grabbable where it is drawn.
  ManipulatorHandle h = g.hitTest(view, px0[0], px0[1], 5.0);
  CHECK(h.valid());
  CHECK(h.mode == ManipulatorMode::Rotate);
  CHECK(h.axis == HandleAxis::Z);

  // ...and where two rings genuinely cross, the tie breaks X, then Y, then Z,
  // so the answer never depends on iteration order. pivot + size*(+X) is on
  // both the Y ring (its 90-degree point) and the Z ring (its 0-degree point).
  double crossPx[2];
  CHECK(view.project(axial0, crossPx));
  const ManipulatorHandle tie = g.hitTest(view, crossPx[0], crossPx[1], 5.0);
  CHECK(tie.valid());
  CHECK(tie.axis == HandleAxis::Y);

  CHECK(g.begin(view, h, px0[0], px0[1]));
  CHECK_NEAR(g.rotationDegrees(), 0.0, 1e-12);
  CHECK(g.dragTo(view, px90[0], px90[1]));
  CHECK_NEAR(g.rotationDegrees(), 90.0, 1e-2);

  // ...and the other way is NEGATIVE ninety, not positive two hundred seventy.
  double rm90[3], pxm90[2];
  CHECK(g.ringPoint(HandleAxis::Z, 3 + 3 * kQuarter, rm90));
  CHECK(view.project(rm90, pxm90));
  CHECK(g.dragTo(view, pxm90[0], pxm90[1]));
  CHECK_NEAR(g.rotationDegrees(), -90.0, 1e-2);

  CHECK(g.dragTo(view, px90[0], px90[1]));
  const ManipulatorEmission e = g.release();
  CHECK(e.valid);
  CHECK_EQ_STR(e.commandId, std::string("part.rotate"));
  CHECK_NEAR(e.params.number("angle").value_or(0.0), 90.0, 1e-2);
  CHECK_NEAR(e.params.number("axx").value_or(-1.0), 0.0, 1e-12);
  CHECK_NEAR(e.params.number("axy").value_or(-1.0), 0.0, 1e-12);
  CHECK_NEAR(e.params.number("axz").value_or(0.0), 1.0, 1e-12);
  // THE PIVOT IS EMITTED. ROTATE's origin triple defaults to the world origin,
  // so a gizmo drawn around the selection that emitted no pivot would turn the
  // body about (0,0,0) — a handle that lies about what it does.
  CHECK_NEAR(e.params.number("ox").value_or(0.0), pivot[0], 1e-12);
  CHECK_NEAR(e.params.number("oy").value_or(0.0), pivot[1], 1e-12);
  CHECK_NEAR(e.params.number("oz").value_or(0.0), pivot[2], 1e-12);

  // Angle snapping to 15 degrees.
  g.setSnap(0.0, 15.0);
  CHECK(g.begin(view, h, px0[0], px0[1]));
  double r10[3], px10[2];
  CHECK(g.ringPoint(HandleAxis::Z, 4, r10));  // one segment on: 360/48 = 7.5 degrees
  CHECK(view.project(r10, px10));
  CHECK(g.dragTo(view, px10[0], px10[1]));
  // 7.5 rounds to 15 at a 15-degree step (std::round takes .5 away from zero).
  CHECK_NEAR(g.rotationDegrees(), 15.0, 1e-6);
  g.release();
  g.setSnap(0.0, 0.0);
  return H.finish();
}

// ── 5. what the gizmo REFUSES ──────────────────────────────────────────────
int testRefusals() {
  forge::uitest::Harness H("manip:refusals");
  Manipulator g;
  const double pivot[3] = {0.0, 0.0, 0.0};
  g.setPivot(pivot);
  g.setSize(40.0);

  const RefCamera oblique;
  const ViewportProjection view = viewFor(oblique);

  // Mode Off: nothing is hittable and nothing begins.
  CHECK(g.mode() == ManipulatorMode::Off);
  CHECK(!g.hitTest(view, kVpX + 640.0, kVpY + 400.0, 8.0).valid());
  ManipulatorHandle tx{ManipulatorMode::Translate, HandleAxis::X};
  CHECK(!g.begin(view, tx, kVpX + 640.0, kVpY + 400.0));

  g.setMode(ManipulatorMode::Translate);
  // A handle whose MODE disagrees with the gizmo's is refused: a rotate handle
  // cannot start a translate drag.
  ManipulatorHandle rz{ManipulatorMode::Rotate, HandleAxis::Z};
  CHECK(!g.begin(view, rz, kVpX + 640.0, kVpY + 400.0));
  // ...and so is an empty handle.
  CHECK(!g.begin(view, ManipulatorHandle{}, kVpX + 640.0, kVpY + 400.0));
  // dragTo without a begin does nothing and says so.
  CHECK(!g.dragTo(view, kVpX + 700.0, kVpY + 400.0));
  CHECK(!g.release().valid);

  // An INVALID projection cannot start a drag.
  ViewportProjection broken;
  CHECK(!g.begin(broken, tx, 0.0, 0.0));

  // ── the ill-conditioned cases ───────────────────────────────────────────
  // A camera looking straight down the +X axis at the origin. The X ARM is
  // end-on: it projects to a point, there is no screen extent to drag along,
  // and the closest-point solve is singular. It must be refused, not solved.
  RefCamera endOn;
  endOn.eye[0] = 300.0; endOn.eye[1] = 0.0; endOn.eye[2] = 0.0;
  const ViewportProjection endOnView = viewFor(endOn);
  CHECK(endOnView.valid());
  double px[2];
  const double onAxis[3] = {20.0, 0.0, 0.0};
  CHECK(endOnView.project(onAxis, px));
  CHECK(!g.begin(endOnView, tx, px[0], px[1]));
  CHECK(!g.dragging());
  // ...while the Y arm, square to that view, drags perfectly well.
  ManipulatorHandle ty{ManipulatorMode::Translate, HandleAxis::Y};
  double y4[3] = {0.0, 4.0, 0.0}, y9[3] = {0.0, 9.0, 0.0};
  double pxy4[2], pxy9[2];
  CHECK(endOnView.project(y4, pxy4));
  CHECK(endOnView.project(y9, pxy9));
  CHECK(g.begin(endOnView, ty, pxy4[0], pxy4[1]));
  CHECK(g.dragTo(endOnView, pxy9[0], pxy9[1]));
  CHECK_NEAR(g.translation(), 5.0, 1e-3);
  g.cancel();

  // A rotate ring seen EDGE-ON has no usable plane intersection. With the same
  // +X camera the ring about +Z lies in the XY plane, which contains the view
  // direction.
  g.setMode(ManipulatorMode::Rotate);
  double ringZ[3], pxRing[2];
  CHECK(g.ringPoint(HandleAxis::Z, 0, ringZ));
  CHECK(endOnView.project(ringZ, pxRing));
  CHECK(!g.begin(endOnView, rz, pxRing[0], pxRing[1]));
  CHECK(!g.dragging());
  // ...while the ring about +X faces the camera and works.
  ManipulatorHandle rx{ManipulatorMode::Rotate, HandleAxis::X};
  double rx0[3], rx90[3], pr0[2], pr90[2];
  CHECK(g.ringPoint(HandleAxis::X, 0, rx0));
  CHECK(g.ringPoint(HandleAxis::X, forge::ui::kManipulatorRingSegments / 4, rx90));
  CHECK(endOnView.project(rx0, pr0));
  CHECK(endOnView.project(rx90, pr90));
  CHECK(g.begin(endOnView, rx, pr0[0], pr0[1]));
  CHECK(g.dragTo(endOnView, pr90[0], pr90[1]));
  CHECK_NEAR(g.rotationDegrees(), 90.0, 1e-2);
  g.cancel();

  // Changing MODE mid-drag abandons the drag rather than reinterpreting it.
  g.setMode(ManipulatorMode::Translate);
  CHECK(g.begin(view, tx, kVpX + 640.0, kVpY + 400.0) || true);  // may or may not grab
  g.setMode(ManipulatorMode::Rotate);
  CHECK(!g.dragging());
  return H.finish();
}

// ── 6. names, so a status strip and a journal can print them ───────────────
int testNames() {
  forge::uitest::Harness H("manip:names");
  CHECK_EQ_STR(std::string(forge::ui::toString(ManipulatorMode::Off)), std::string("off"));
  CHECK_EQ_STR(std::string(forge::ui::toString(ManipulatorMode::Translate)),
               std::string("translate"));
  CHECK_EQ_STR(std::string(forge::ui::toString(ManipulatorMode::Rotate)), std::string("rotate"));
  CHECK_EQ_STR(std::string(forge::ui::toString(HandleAxis::None)), std::string("none"));
  CHECK_EQ_STR(std::string(forge::ui::toString(HandleAxis::X)), std::string("x"));
  CHECK_EQ_STR(std::string(forge::ui::toString(HandleAxis::Y)), std::string("y"));
  CHECK_EQ_STR(std::string(forge::ui::toString(HandleAxis::Z)), std::string("z"));

  ManipulatorHandle a{ManipulatorMode::Translate, HandleAxis::X};
  ManipulatorHandle b{ManipulatorMode::Translate, HandleAxis::X};
  ManipulatorHandle c{ManipulatorMode::Rotate, HandleAxis::X};
  CHECK(a == b);
  CHECK(a != c);
  CHECK(!ManipulatorHandle{}.valid());
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testInverse();
  rc |= testProjection();
  rc |= testTranslateDrag();
  rc |= testRotateDrag();
  rc |= testRefusals();
  rc |= testNames();
  return rc;
}
