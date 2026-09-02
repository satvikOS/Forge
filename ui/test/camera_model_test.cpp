// ui/test/camera_model_test.cpp — the viewport camera, asserted by construction.
//
// Every claim here is checked against a REFERENCE VALUE, and the two that
// matter most are round trips rather than eyeballed constants:
//
//   ray -> project   a pixel becomes a world ray; a point on that ray, pushed
//                    back through the SAME view-projection the renderer
//                    uploads, must land on the pixel it came from. This is the
//                    check that would have caught a sign drift between the
//                    three hand-copied camera conventions this file replaces.
//   fit -> frustum   after zoom-to-fit, EVERY corner of the part must project
//                    inside the viewport. That is the user-visible claim, and
//                    it is what distinguishes a bounding-SPHERE fit from the
//                    classic half-extent bug that lets a long part's ends fall
//                    off the screen.
//
// The projection convention is pinned numerically (Vulkan depth in [0,1], Y
// negated) rather than described, because "the model renders upside down" is
// the first Vulkan bug and a comment does not catch it.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/CameraModel.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PickModel.hpp"
#include "ui_test_util.hpp"

using forge::ui::CameraModel;
using forge::ui::EntityKind;
using forge::ui::EntityRef;
using forge::ui::FramingBounds;
using forge::ui::MeasureMesh;
using forge::ui::NamedView;
using forge::ui::PickScene;
using forge::uitest::Harness;

namespace {

constexpr double kPi = 3.14159265358979323846;

// ── a deliberately LONG THIN plate ──────────────────────────────────────────
// 60 x 20 x 10. The aspect matters: a fit that uses the largest half-EXTENT
// instead of the half-DIAGONAL frames this part with its ends off screen, so
// the frustum check below is a real discriminator rather than a formality.
constexpr double kLenX = 60.0;
constexpr double kLenY = 20.0;
constexpr double kLenZ = 10.0;

void addQuad(MeasureMesh& m, const double a[3], const double b[3], const double c[3],
             const double d[3], std::uint32_t faceId) {
  m.addTriangle(a, b, c, faceId);
  m.addTriangle(a, c, d, faceId);
}

// Face ids: 1 z-min, 2 z-max, 3 y-min, 4 y-max, 5 x-min, 6 x-max.
MeasureMesh makePlate() {
  MeasureMesh m;
  const double x0 = 0.0, x1 = kLenX;
  const double y0 = 0.0, y1 = kLenY;
  const double z0 = 0.0, z1 = kLenZ;
  const double p000[3] = {x0, y0, z0}, p100[3] = {x1, y0, z0};
  const double p110[3] = {x1, y1, z0}, p010[3] = {x0, y1, z0};
  const double p001[3] = {x0, y0, z1}, p101[3] = {x1, y0, z1};
  const double p111[3] = {x1, y1, z1}, p011[3] = {x0, y1, z1};
  addQuad(m, p000, p010, p110, p100, 1);
  addQuad(m, p001, p101, p111, p011, 2);
  addQuad(m, p000, p100, p101, p001, 3);
  addQuad(m, p010, p011, p111, p110, 4);
  addQuad(m, p000, p001, p011, p010, 5);
  addQuad(m, p100, p110, p111, p101, 6);
  return m;
}

// Project a world point with the SAME matrix the renderer uploads. Returns the
// pixel from the viewport's top-left plus the NDC depth.
bool project(const double vp[16], const double p[3], double w, double h, double& px, double& py,
             double& ndcZ) {
  double clip[4];
  for (int r = 0; r < 4; ++r) {
    clip[r] = vp[0 * 4 + r] * p[0] + vp[1 * 4 + r] * p[1] + vp[2 * 4 + r] * p[2] + vp[3 * 4 + r];
  }
  if (!(clip[3] > 1e-12)) return false;  // behind the eye
  const double ndcX = clip[0] / clip[3];
  const double ndcY = clip[1] / clip[3];
  ndcZ = clip[2] / clip[3];
  px = (ndcX * 0.5 + 0.5) * w;
  py = (ndcY * 0.5 + 0.5) * h;
  return true;
}

void plateCorners(double out[8][3]) {
  int i = 0;
  for (int xi = 0; xi < 2; ++xi) {
    for (int yi = 0; yi < 2; ++yi) {
      for (int zi = 0; zi < 2; ++zi) {
        out[i][0] = xi ? kLenX : 0.0;
        out[i][1] = yi ? kLenY : 0.0;
        out[i][2] = zi ? kLenZ : 0.0;
        ++i;
      }
    }
  }
}

// ── the named views ─────────────────────────────────────────────────────────
int testNamedViews() {
  Harness H("camera:named-views");

  // Every suffix round-trips, and the seven are DISTINCT — a duplicated suffix
  // would silently make one view unreachable from the command layer.
  std::vector<std::string> suffixes;
  for (std::size_t i = 0; i < forge::ui::kNamedViewCount; ++i) {
    const auto v = static_cast<NamedView>(i);
    const std::string s = forge::ui::commandSuffix(v);
    NamedView back = NamedView::Front;
    CHECK(forge::ui::namedViewFromSuffix(s, back));
    CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(v));
    CHECK(std::string(forge::ui::toString(v)).size() > 0);
    suffixes.push_back(s);
  }
  std::sort(suffixes.begin(), suffixes.end());
  CHECK_EQ_INT(std::unique(suffixes.begin(), suffixes.end()) - suffixes.begin(),
               static_cast<long long>(forge::ui::kNamedViewCount));

  // An unknown suffix is REFUSED and leaves the output untouched.
  NamedView keep = NamedView::Bottom;
  CHECK(!forge::ui::namedViewFromSuffix("oblique", keep));
  CHECK(!forge::ui::namedViewFromSuffix("", keep));
  CHECK(!forge::ui::namedViewFromSuffix("FRONT", keep));  // case matters: ids are lowercase
  CHECK_EQ_INT(static_cast<int>(keep), static_cast<int>(NamedView::Bottom));

  // Where each view puts the EYE. Z-up: FRONT on -Y, BACK on +Y, RIGHT on +X,
  // LEFT on -X, TOP on +Z, BOTTOM on -Z. These are the six directions half of
  // which had no implementation at all before this file.
  struct Expect {
    NamedView view;
    double dir[3];
  };
  const Expect table[] = {
      {NamedView::Front,  {0.0, -1.0, 0.0}},
      {NamedView::Back,   {0.0, 1.0, 0.0}},
      {NamedView::Right,  {1.0, 0.0, 0.0}},
      {NamedView::Left,   {-1.0, 0.0, 0.0}},
      {NamedView::Top,    {0.0, 0.0, 1.0}},
      {NamedView::Bottom, {0.0, 0.0, -1.0}},
  };
  for (const Expect& e : table) {
    CameraModel cam;
    const double target[3] = {5.0, 6.0, 7.0};
    cam.setTarget(target);
    cam.setDistance(100.0);
    cam.setNamedView(e.view);
    double eye[3];
    cam.eye(eye);
    double unit[3];
    for (int i = 0; i < 3; ++i) unit[i] = (eye[i] - target[i]) / 100.0;
    // TOP and BOTTOM sit on the pole guard by construction, so they are within
    // sin(0.02) of the axis rather than exactly on it. The tolerance is the
    // guard, stated, not a fudge.
    const double tol = 0.021;
    for (int i = 0; i < 3; ++i) CHECK_NEAR(unit[i], e.dir[i], tol);
  }

  // True isometric: the eye direction has equal magnitude on all three axes,
  // which is what makes the three edge directions foreshorten equally.
  {
    CameraModel cam;
    cam.setNamedView(NamedView::Isometric);
    double eye[3];
    cam.eye(eye);
    const double d = cam.distance();
    CHECK_NEAR(std::fabs(eye[0]) / d, std::fabs(eye[1]) / d, 1e-9);
    CHECK_NEAR(std::fabs(eye[0]) / d, std::fabs(eye[2]) / d, 1e-9);
    CHECK_NEAR(cam.elevation(), std::atan(1.0 / std::sqrt(2.0)), 1e-12);
  }
  return H.finish();
}

// ── ray / projection round trip ─────────────────────────────────────────────
int testRayProjectRoundTrip() {
  Harness H("camera:ray-round-trip");

  CameraModel cam;
  const double w = 1280.0, h = 800.0;
  cam.setAspect(w / h);
  const double target[3] = {30.0, 10.0, 5.0};
  cam.setTarget(target);
  cam.setDistance(220.0);
  cam.orbit(0.3, -0.2);

  double vp[16];
  cam.viewProj(vp);

  // A pixel becomes a ray; a point 150 units along that ray must project back
  // to the SAME pixel. If ray() and viewProj() disagree about the basis, the Y
  // flip or the aspect, this is off by tens of pixels, not by a rounding.
  double worst = 0.0;
  for (double py = 40.0; py < h; py += 137.0) {
    for (double px = 40.0; px < w; px += 211.0) {
      double o[3], d[3];
      cam.ray(px, py, w, h, o, d);
      // The direction is unit length -- picking depends on it.
      CHECK_NEAR(std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]), 1.0, 1e-12);
      const double p[3] = {o[0] + d[0] * 150.0, o[1] + d[1] * 150.0, o[2] + d[2] * 150.0};
      double bx = 0.0, by = 0.0, bz = 0.0;
      CHECK(project(vp, p, w, h, bx, by, bz));
      worst = std::max(worst, std::max(std::fabs(bx - px), std::fabs(by - py)));
    }
  }
  std::printf("[camera:ray-round-trip] worst pixel error over the grid: %.3e px\n", worst);
  CHECK(worst < 1e-6);

  // The ray through the exact centre of the viewport points AT the target.
  {
    double o[3], d[3];
    cam.ray(w * 0.5, h * 0.5, w, h, o, d);
    double toTarget[3] = {target[0] - o[0], target[1] - o[1], target[2] - o[2]};
    const double len =
        std::sqrt(toTarget[0] * toTarget[0] + toTarget[1] * toTarget[1] + toTarget[2] * toTarget[2]);
    for (int i = 0; i < 3; ++i) CHECK_NEAR(d[i], toTarget[i] / len, 1e-12);
  }
  return H.finish();
}

// ── the projection convention, pinned ───────────────────────────────────────
int testProjectionConvention() {
  Harness H("camera:projection-convention");

  CameraModel cam;
  cam.setAspect(1.6);
  const double origin[3] = {0.0, 0.0, 0.0};
  cam.setTarget(origin);
  cam.setDistance(100.0);
  cam.setNamedView(NamedView::Front);  // eye on -Y looking toward +Y

  double p[16];
  cam.proj(p);
  // VULKAN, not OpenGL: the perspective divide row is -1 in column 2, and the
  // Y row is NEGATED. If out[5] were positive the model renders upside down.
  CHECK_NEAR(p[11], -1.0, 1e-15);
  CHECK(p[5] < 0.0);
  CHECK_NEAR(p[5], -1.0 / std::tan(cam.fovY() * 0.5), 1e-12);
  CHECK_NEAR(p[0], (1.0 / std::tan(cam.fovY() * 0.5)) / 1.6, 1e-12);
  // Depth maps the NEAR plane to 0 and the FAR plane to 1 (Vulkan), not to
  // -1..1 (OpenGL). Checked through the divide, on a view-space point.
  const double n = cam.nearPlane(), f = cam.farPlane();
  const double zn = (p[10] * (-n) + p[14]) / n;   // view-space z = -n
  const double zf = (p[10] * (-f) + p[14]) / f;   // view-space z = -f
  CHECK_NEAR(zn, 0.0, 1e-9);
  CHECK_NEAR(zf, 1.0, 1e-9);

  // Y really does point DOWN in pixels: a point ABOVE the target must project
  // to a SMALLER pixel y than one below it. A directional claim, so a sign flip
  // cannot pass it.
  double vp[16];
  cam.viewProj(vp);
  const double above[3] = {0.0, 0.0, 10.0};
  const double below[3] = {0.0, 0.0, -10.0};
  double ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
  CHECK(project(vp, above, 1280.0, 800.0, ax, ay, az));
  CHECK(project(vp, below, 1280.0, 800.0, bx, by, bz));
  CHECK(ay < by);
  // ...and both are inside the depth range, so the near/far derivation above is
  // not vacuous.
  CHECK(az > 0.0 && az < 1.0);
  CHECK(bz > 0.0 && bz < 1.0);
  return H.finish();
}

// ── zoom to fit ─────────────────────────────────────────────────────────────
int testZoomToFit() {
  Harness H("camera:zoom-to-fit");

  MeasureMesh mesh = makePlate();
  PickScene scene;
  scene.mesh = &mesh;
  scene.bodyId = "body-1";

  const FramingBounds all = forge::ui::sceneBounds(scene);
  CHECK(all.usable());
  CHECK_EQ_INT(all.unresolved, 0);
  CHECK_NEAR(all.box.size(0), kLenX, 1e-12);
  CHECK_NEAR(all.box.size(1), kLenY, 1e-12);
  CHECK_NEAR(all.box.size(2), kLenZ, 1e-12);

  const double w = 1280.0, h = 800.0;
  double corners[8][3];
  plateCorners(corners);

  // THE CLAIM: after a fit, from ANY orientation, every corner of the part is
  // on screen. Checked from several orbits because a fit that only works from
  // the default azimuth is not a fit.
  const double azimuths[] = {-kPi * 0.25, 0.0, 1.1, 2.4, -2.9};
  for (double az : azimuths) {
    CameraModel cam;
    cam.setAspect(w / h);
    CHECK(cam.frameBounds(all));
    cam.orbit(az - cam.azimuth(), 0.0);
    double vp[16];
    cam.viewProj(vp);
    for (const auto& c : corners) {
      double px = 0, py = 0, pz = 0;
      CHECK(project(vp, c, w, h, px, py, pz));
      CHECK(px >= 0.0 && px <= w);
      CHECK(py >= 0.0 && py <= h);
      CHECK(pz >= 0.0 && pz <= 1.0);  // inside the depth range too
    }
  }

  // A NARROW viewport must still fit horizontally -- that is what the aspect
  // division in frame() buys, and without it the ends fall off a tall window.
  {
    const double nw = 400.0, nh = 900.0;
    CameraModel cam;
    cam.setAspect(nw / nh);
    CHECK(cam.frameBounds(all));
    double vp[16];
    cam.viewProj(vp);
    for (const auto& c : corners) {
      double px = 0, py = 0, pz = 0;
      CHECK(project(vp, c, nw, nh, px, py, pz));
      CHECK(px >= 0.0 && px <= nw);
      CHECK(py >= 0.0 && py <= nh);
    }
  }

  // The fit is a bounding SPHERE fit: the distance follows the half-diagonal,
  // not the largest half-extent. Stated as a value so the half-extent bug is a
  // failing number rather than a subtly cropped picture.
  {
    CameraModel cam;
    cam.setAspect(w / h);
    CHECK(cam.frameBounds(all));
    const double halfDiag = all.box.diagonal() * 0.5;
    CHECK_NEAR(cam.distance(), halfDiag / std::sin(cam.fovY() * 0.5) * 1.15, 1e-9);
    CHECK(halfDiag > kLenX * 0.5);  // the discriminator actually differs here
    double centre[3];
    all.box.centre(centre);
    for (int i = 0; i < 3; ++i) CHECK_NEAR(cam.target()[i], centre[i], 1e-12);
  }

  // An EMPTY scene refuses and MOVES NOTHING. A fit that jumps to the origin on
  // an empty document is what makes a user think the part vanished.
  {
    PickScene empty;
    const FramingBounds none = forge::ui::sceneBounds(empty);
    CHECK(!none.usable());
    CHECK_EQ_INT(none.unresolved, 1);
    CameraModel cam;
    const double before[3] = {11.0, 12.0, 13.0};
    cam.setTarget(before);
    cam.setDistance(77.0);
    CHECK(!cam.frameBounds(none));
    CHECK_NEAR(cam.distance(), 77.0, 1e-12);
    for (int i = 0; i < 3; ++i) CHECK_NEAR(cam.target()[i], before[i], 1e-12);
  }
  return H.finish();
}

// ── zoom to selection ───────────────────────────────────────────────────────
int testZoomToSelection() {
  Harness H("camera:zoom-to-selection");

  MeasureMesh mesh = makePlate();
  forge::ui::EdgeSet edges = forge::ui::deriveEdges(mesh);
  forge::ui::VertexSet verts = forge::ui::deriveVertices(mesh);
  PickScene scene;
  scene.mesh = &mesh;
  scene.edges = &edges;
  scene.vertices = &verts;
  scene.bodyId = "body-1";

  auto faceRef = [](std::uint32_t id) {
    EntityRef r;
    r.bodyId = "body-1";
    r.kind = EntityKind::Face;
    r.persistentName = "face@" + std::to_string(id);
    return r;
  };

  // ONE face (x-min, 20 x 10) frames much tighter than the whole 60 x 20 x 10
  // part. This is the entire point of the verb: `view.fit` on a 430-face part
  // leaves the chamfer you are working on four pixels wide.
  {
    const FramingBounds one = forge::ui::selectionBounds(scene, {faceRef(5)});
    CHECK(one.usable());
    CHECK_EQ_INT(one.resolved, 1);
    CHECK_EQ_INT(one.unresolved, 0);
    CHECK_NEAR(one.box.size(0), 0.0, 1e-12);  // the face is planar at x = 0
    CHECK_NEAR(one.box.size(1), kLenY, 1e-12);
    CHECK_NEAR(one.box.size(2), kLenZ, 1e-12);

    CameraModel wide, tight;
    wide.setAspect(1.6);
    tight.setAspect(1.6);
    CHECK(wide.frameBounds(forge::ui::sceneBounds(scene)));
    CHECK(tight.frameBounds(one));
    CHECK(tight.distance() < wide.distance());
    // The target moved to the FACE, not the body centre.
    CHECK_NEAR(tight.target()[0], 0.0, 1e-12);
    CHECK_NEAR(tight.target()[1], kLenY * 0.5, 1e-12);
    CHECK_NEAR(tight.target()[2], kLenZ * 0.5, 1e-12);
  }

  // Two faces frame their UNION.
  {
    const FramingBounds two = forge::ui::selectionBounds(scene, {faceRef(5), faceRef(6)});
    CHECK_EQ_INT(two.resolved, 2);
    CHECK_NEAR(two.box.size(0), kLenX, 1e-12);
  }

  // A Body ref frames the whole mesh -- the same answer as sceneBounds.
  {
    EntityRef body;
    body.bodyId = "body-1";
    body.kind = EntityKind::Body;
    body.persistentName = "body-1";
    const FramingBounds b = forge::ui::selectionBounds(scene, {body});
    const FramingBounds s = forge::ui::sceneBounds(scene);
    CHECK(b.usable());
    for (int i = 0; i < 3; ++i) CHECK_NEAR(b.box.size(static_cast<std::size_t>(i)),
                                           s.box.size(static_cast<std::size_t>(i)), 1e-12);
  }

  // An EDGE ref resolves through the EdgeSet, and a VERTEX through the
  // VertexSet -- the two kinds the pick engine added and nothing could frame.
  {
    CHECK(edges.size() > 0);
    EntityRef e;
    e.bodyId = "body-1";
    e.kind = EntityKind::Edge;
    e.persistentName = edges.edges[0].key();
    const FramingBounds eb = forge::ui::selectionBounds(scene, {e});
    CHECK(eb.usable());
    CHECK_EQ_INT(eb.resolved, 1);
    CHECK(eb.box.diagonal() > 0.0);

    CHECK(verts.size() > 0);
    EntityRef v;
    v.bodyId = "body-1";
    v.kind = EntityKind::Vertex;
    v.persistentName = verts.vertices[0].key();
    const FramingBounds vb = forge::ui::selectionBounds(scene, {v});
    CHECK(vb.usable());
    CHECK_EQ_INT(vb.resolved, 1);
    // A single point is a degenerate box; frame() must still produce a usable
    // distance rather than diving to zero.
    CameraModel cam;
    CHECK(cam.frameBounds(vb));
    CHECK(cam.distance() > 0.0);
    CHECK(std::isfinite(cam.distance()));
  }

  // ── refusals, counted rather than hidden ──────────────────────────────────
  {
    // A ref for ANOTHER body is unresolved, not silently framed.
    EntityRef other = faceRef(5);
    other.bodyId = "body-2";
    const FramingBounds fb = forge::ui::selectionBounds(scene, {other});
    CHECK(!fb.usable());
    CHECK_EQ_INT(fb.resolved, 0);
    CHECK_EQ_INT(fb.unresolved, 1);

    // A face id that is not in the mesh is unresolved.
    const FramingBounds missing = forge::ui::selectionBounds(scene, {faceRef(99)});
    CHECK_EQ_INT(missing.resolved, 0);
    CHECK_EQ_INT(missing.unresolved, 1);

    // A MIXED selection reports both halves of the census.
    const FramingBounds mixed = forge::ui::selectionBounds(scene, {faceRef(5), faceRef(99)});
    CHECK_EQ_INT(mixed.resolved, 1);
    CHECK_EQ_INT(mixed.unresolved, 1);
    CHECK(mixed.usable());  // one good ref is still framable

    // An empty selection is not an error and not a jump to the origin.
    const FramingBounds none = forge::ui::selectionBounds(scene, {});
    CHECK(!none.usable());
    CHECK_EQ_INT(none.resolved, 0);
    CHECK_EQ_INT(none.unresolved, 0);
  }

  // faceIdFromKey refuses everything that is not exactly "face@<positive int>".
  {
    std::uint32_t id = 7;
    CHECK(forge::ui::faceIdFromKey("face@12", id));
    CHECK_EQ_INT(id, 12);
    CHECK(!forge::ui::faceIdFromKey("face@", id));
    CHECK(!forge::ui::faceIdFromKey("face@0", id));      // 0 is the miss sentinel
    CHECK(!forge::ui::faceIdFromKey("face@-1", id));
    CHECK(!forge::ui::faceIdFromKey("face@1x", id));
    CHECK(!forge::ui::faceIdFromKey("edge@1_2#0", id));
    CHECK(!forge::ui::faceIdFromKey("", id));
    CHECK(!forge::ui::faceIdFromKey("face@99999999999999", id));  // would wrap a uint32
    CHECK_EQ_INT(id, 12);  // a refusal leaves the output untouched
  }
  return H.finish();
}

// ── navigation ──────────────────────────────────────────────────────────────
int testNavigation() {
  Harness H("camera:navigation");

  // ORBIT clamps at the poles from both directions, however hard it is pushed,
  // so the up vector never degenerates and the view never flips.
  {
    CameraModel cam;
    for (int i = 0; i < 50; ++i) cam.orbit(0.0, 1.0);
    CHECK_NEAR(cam.elevation(), kPi * 0.5 - forge::ui::kCameraPoleGuard, 1e-12);
    for (int i = 0; i < 100; ++i) cam.orbit(0.0, -1.0);
    CHECK_NEAR(cam.elevation(), -kPi * 0.5 + forge::ui::kCameraPoleGuard, 1e-12);
    // Azimuth stays wrapped in (-pi, pi] through a long drag.
    for (int i = 0; i < 500; ++i) cam.orbit(0.7, 0.0);
    CHECK(cam.azimuth() > -kPi - 1e-9 && cam.azimuth() <= kPi + 1e-9);
  }

  // ZOOM is multiplicative and exactly reversible -- a wheel notch out then in
  // must land back where it started, or repeated zooming drifts.
  {
    CameraModel cam;
    const double d0 = cam.distance();
    cam.zoom(1.0);
    CHECK_NEAR(cam.distance(), d0 / 1.1, 1e-9);
    cam.zoom(-1.0);
    CHECK_NEAR(cam.distance(), d0, 1e-9);
    // Clamped rather than allowed to reach zero or infinity.
    for (int i = 0; i < 500; ++i) cam.zoom(1.0);
    CHECK(cam.distance() >= 1e-3);
    for (int i = 0; i < 1000; ++i) cam.zoom(-1.0);
    CHECK(cam.distance() <= 1e7);
  }

  // PAN keeps the point under the cursor under the cursor. Asserted by
  // projecting the target before the pan and after: dragging by (dx, dy) pixels
  // must move it by exactly (dx, dy) pixels on screen.
  {
    const double w = 1280.0, h = 800.0;
    CameraModel cam;
    cam.setAspect(w / h);
    cam.setDistance(200.0);
    cam.orbit(0.4, 0.25);

    double before[3];
    const double t0[3] = {cam.target()[0], cam.target()[1], cam.target()[2]};
    double vp0[16];
    cam.viewProj(vp0);
    double px0 = 0, py0 = 0, pz0 = 0;
    CHECK(project(vp0, t0, w, h, px0, py0, pz0));
    CHECK_NEAR(px0, w * 0.5, 1e-9);  // the target starts dead centre
    CHECK_NEAR(py0, h * 0.5, 1e-9);
    for (int i = 0; i < 3; ++i) before[i] = t0[i];

    const double dx = 90.0, dy = -55.0;
    cam.pan(dx, dy, h);
    double vp1[16];
    cam.viewProj(vp1);
    double px1 = 0, py1 = 0, pz1 = 0;
    // The world point that WAS at the centre is now offset by the drag.
    CHECK(project(vp1, before, w, h, px1, py1, pz1));
    CHECK_NEAR(px1 - px0, dx, 1e-6);
    CHECK_NEAR(py1 - py0, dy, 1e-6);
  }

  // worldPerPixelAtTarget is the SAME formula the pick tolerance uses -- one
  // copy, so a pick radius and a pan speed cannot disagree.
  {
    CameraModel cam;
    cam.setDistance(200.0);
    CHECK_NEAR(cam.worldPerPixelAtTarget(800.0),
               forge::ui::worldPerPixel(200.0, cam.fovY(), 800.0), 1e-15);
  }
  return H.finish();
}

// ── view normal to a face ───────────────────────────────────────────────────
int testViewNormalTo() {
  Harness H("camera:view-normal-to");

  MeasureMesh mesh = makePlate();

  // Look straight at the top face: its area-weighted normal is +Z, so the eye
  // must end up above the part and the face must fill the middle of the screen.
  forge::ui::FaceMeasure fm;
  CHECK(forge::ui::measureFace(mesh, 2, fm));
  CHECK_NEAR(fm.normal[2], 1.0, 1e-9);

  CameraModel cam;
  cam.setAspect(1.6);
  cam.setTarget(fm.centroid);
  cam.setDistance(120.0);
  CHECK(cam.viewNormalTo(fm.normal));

  double eye[3];
  cam.eye(eye);
  CHECK(eye[2] > fm.centroid[2]);  // above the face
  // Within the pole guard of straight down.
  CHECK_NEAR(cam.elevation(), kPi * 0.5 - forge::ui::kCameraPoleGuard, 1e-12);

  // A side face points along -X, and the camera follows it round.
  {
    forge::ui::FaceMeasure side;
    CHECK(forge::ui::measureFace(mesh, 5, side));
    CHECK_NEAR(side.normal[0], -1.0, 1e-9);
    CameraModel c2;
    c2.setTarget(side.centroid);
    c2.setDistance(100.0);
    CHECK(c2.viewNormalTo(side.normal));
    double e2[3];
    c2.eye(e2);
    CHECK_NEAR(e2[0] - side.centroid[0], -100.0, 1e-6);
    CHECK_NEAR(e2[1] - side.centroid[1], 0.0, 1e-6);
    CHECK_NEAR(e2[2] - side.centroid[2], 0.0, 1e-6);
    CHECK_NEAR(c2.azimuth(), kPi, 1e-12);
  }

  // A degenerate normal is REFUSED and moves nothing -- measureFace reports an
  // all-zero normal for a face whose triangles cancel, and orienting to it
  // would send the camera to NaN.
  {
    CameraModel c3;
    const double az = c3.azimuth(), el = c3.elevation();
    const double zero[3] = {0.0, 0.0, 0.0};
    CHECK(!c3.viewNormalTo(zero));
    CHECK_NEAR(c3.azimuth(), az, 1e-15);
    CHECK_NEAR(c3.elevation(), el, 1e-15);
    const double tiny[3] = {1e-12, 0.0, 0.0};
    CHECK(!c3.viewNormalTo(tiny));
  }

  // A non-unit normal is normalized rather than scaling the distance.
  {
    CameraModel c4;
    c4.setDistance(50.0);
    const double big[3] = {0.0, 0.0, 900.0};
    CHECK(c4.viewNormalTo(big));
    CHECK_NEAR(c4.distance(), 50.0, 1e-12);
  }
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testNamedViews();
  rc |= testRayProjectRoundTrip();
  rc |= testProjectionConvention();
  rc |= testZoomToFit();
  rc |= testZoomToSelection();
  rc |= testNavigation();
  rc |= testViewNormalTo();
  return rc;
}
