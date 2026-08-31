#include "forge/ui/ViewportManipulator.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ViewportSelect.hpp"

namespace forge::ui {
namespace {

constexpr double kPi = 3.14159265358979323846;

// Below this the drag has not moved the body: a zero-move TRANSLATE and a
// zero-angle ROTATE are both no-op statements, and PartDocument refuses a no-op
// edit rather than pushing an undo step that undoes nothing. Refusing here says
// WHY instead of letting the dispatch fail mute.
constexpr double kMinTranslate = 1.0e-4;  // mm
constexpr double kMinRotate = 1.0e-3;     // degrees

double dot(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

bool normalize(double v[3]) noexcept {
  const double n = std::sqrt(dot(v, v));
  if (!(n > 1e-12)) return false;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
  return true;
}

double snapTo(double value, double step) noexcept {
  if (!(step > 0.0)) return value;
  return std::round(value / step) * step;
}

// Distance in screen space from a point to a segment. The segment may be
// degenerate (both endpoints projecting to one pixel when an axis points at the
// eye), which is a real frame and must answer the point distance, not a NaN.
double pointSegmentDistance(double px, double py, double ax, double ay, double bx, double by) {
  const double vx = bx - ax;
  const double vy = by - ay;
  const double len2 = vx * vx + vy * vy;
  double t = 0.0;
  if (len2 > 1e-12) {
    t = ((px - ax) * vx + (py - ay) * vy) / len2;
    t = std::clamp(t, 0.0, 1.0);
  }
  const double dx = px - (ax + vx * t);
  const double dy = py - (ay + vy * t);
  return std::sqrt(dx * dx + dy * dy);
}

// Even-odd containment for the four projected corners of a plane handle.
bool pointInQuad(double px, double py, const ScreenPoint q[4]) {
  bool inside = false;
  for (int i = 0, j = 3; i < 4; j = i++) {
    if ((q[i].y > py) != (q[j].y > py)) {
      const double x = q[j].x + (py - q[i].y) * (q[j].x - q[i].x) / (q[j].y - q[i].y);
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

// The two axes a plane handle spans.
void planeBasis(ManipulatorHandle h, double u[3], double v[3]) noexcept {
  u[0] = u[1] = u[2] = 0.0;
  v[0] = v[1] = v[2] = 0.0;
  switch (h) {
    case ManipulatorHandle::PlaneYZ:
      u[1] = 1.0;
      v[2] = 1.0;
      break;
    case ManipulatorHandle::PlaneZX:
      u[2] = 1.0;
      v[0] = 1.0;
      break;
    case ManipulatorHandle::PlaneXY:
      u[0] = 1.0;
      v[1] = 1.0;
      break;
    default:
      break;
  }
}

// How many segments a projected ring is sampled at. 48 keeps the polyline within
// a third of a pixel of the true circle at any gizmo size a viewport shows, and
// the hit test walks it once per frame at most.
constexpr int kRingSegments = 48;

}  // namespace

const char* toString(ManipulatorMode mode) noexcept {
  switch (mode) {
    case ManipulatorMode::None:      return "none";
    case ManipulatorMode::Translate: return "translate";
    case ManipulatorMode::Rotate:    return "rotate";
  }
  return "none";
}

const char* toString(ManipulatorHandle handle) noexcept {
  switch (handle) {
    case ManipulatorHandle::None:    return "none";
    case ManipulatorHandle::AxisX:   return "axis_x";
    case ManipulatorHandle::AxisY:   return "axis_y";
    case ManipulatorHandle::AxisZ:   return "axis_z";
    case ManipulatorHandle::PlaneYZ: return "plane_yz";
    case ManipulatorHandle::PlaneZX: return "plane_zx";
    case ManipulatorHandle::PlaneXY: return "plane_xy";
  }
  return "none";
}

void handleAxis(ManipulatorHandle handle, double out[3]) noexcept {
  out[0] = out[1] = out[2] = 0.0;
  switch (handle) {
    case ManipulatorHandle::AxisX:
    case ManipulatorHandle::PlaneYZ:
      out[0] = 1.0;
      break;
    case ManipulatorHandle::AxisY:
    case ManipulatorHandle::PlaneZX:
      out[1] = 1.0;
      break;
    case ManipulatorHandle::AxisZ:
    case ManipulatorHandle::PlaneXY:
      out[2] = 1.0;
      break;
    case ManipulatorHandle::None:
      break;
  }
}

bool isPlaneHandle(ManipulatorHandle handle) noexcept {
  return handle == ManipulatorHandle::PlaneYZ || handle == ManipulatorHandle::PlaneZX ||
         handle == ManipulatorHandle::PlaneXY;
}

void Manipulator::setMode(ManipulatorMode mode) noexcept {
  if (mode == mode_) return;
  cancel();
  mode_ = mode;
}

void Manipulator::setOrigin(const double p[3]) noexcept {
  // Moving the gizmo under a live drag would rewrite the drag's own frame of
  // reference mid-gesture. The selection cannot change during a drag either, so
  // this is a refusal rather than a queue.
  if (active_) return;
  origin_[0] = p[0];
  origin_[1] = p[1];
  origin_[2] = p[2];
}

void Manipulator::setSize(double worldSize) noexcept {
  if (worldSize > 1e-6) size_ = worldSize;
}

void Manipulator::cancel() noexcept {
  active_ = false;
  handle_ = ManipulatorHandle::None;
  delta_[0] = delta_[1] = delta_[2] = 0.0;
  angleDeg_ = 0.0;
  rawAngle_ = 0.0;
  lastAngle_ = 0.0;
  startAlong_ = 0.0;
  startPoint_[0] = startPoint_[1] = startPoint_[2] = 0.0;
}

// ── hit test ────────────────────────────────────────────────────────────────
ManipulatorHandle Manipulator::hitTest(const float viewProj[16], const ViewRect& view, double mx,
                                       double my, double pixelTolerance) const {
  if (mode_ == ManipulatorMode::None) return ManipulatorHandle::None;
  const double tol = pixelTolerance > 0.0 ? pixelTolerance : kManipulatorGrabPixels;
  const ScreenPoint o = projectPoint(viewProj, view, origin_);
  if (!o.visible) return ManipulatorHandle::None;

  const ManipulatorHandle axes[3] = {ManipulatorHandle::AxisX, ManipulatorHandle::AxisY,
                                     ManipulatorHandle::AxisZ};

  if (mode_ == ManipulatorMode::Rotate) {
    // Three rings. The nearest one within tolerance wins; a tie goes to the
    // lower axis, so the answer is deterministic when two rings cross.
    ManipulatorHandle best = ManipulatorHandle::None;
    double bestDist = tol;
    for (int a = 0; a < 3; ++a) {
      double axis[3];
      handleAxis(axes[a], axis);
      double u[3] = {0.0, 0.0, 0.0};
      double v[3] = {0.0, 0.0, 0.0};
      // Any two vectors spanning the plane normal to `axis`; the axis is a unit
      // basis vector here, so the two OTHER basis vectors are exactly right.
      u[(a + 1) % 3] = 1.0;
      v[(a + 2) % 3] = 1.0;
      ScreenPoint prev{};
      for (int k = 0; k <= kRingSegments; ++k) {
        const double t = 2.0 * kPi * static_cast<double>(k) / kRingSegments;
        double p[3];
        for (int i = 0; i < 3; ++i) {
          p[i] = origin_[i] + size_ * (u[i] * std::cos(t) + v[i] * std::sin(t));
        }
        const ScreenPoint s = projectPoint(viewProj, view, p);
        if (k != 0 && prev.visible && s.visible) {
          const double d = pointSegmentDistance(mx, my, prev.x, prev.y, s.x, s.y);
          if (d < bestDist) {
            bestDist = d;
            best = axes[a];
          }
        }
        prev = s;
      }
    }
    return best;
  }

  // Translate. Plane quads first: they sit on top of the arrows and are the
  // smaller target, so an ambiguous pixel must resolve to the plane.
  const ManipulatorHandle planes[3] = {ManipulatorHandle::PlaneYZ, ManipulatorHandle::PlaneZX,
                                       ManipulatorHandle::PlaneXY};
  for (ManipulatorHandle h : planes) {
    double u[3], v[3];
    planeBasis(h, u, v);
    // The quad occupies the inner third of the two axes, offset off the origin,
    // which is where every CAD gizmo puts it: far enough not to swallow the
    // origin, near enough not to be mistaken for an arrow tip.
    const double lo = 0.22 * size_;
    const double hi = 0.55 * size_;
    double corners[4][3];
    for (int i = 0; i < 3; ++i) {
      corners[0][i] = origin_[i] + u[i] * lo + v[i] * lo;
      corners[1][i] = origin_[i] + u[i] * hi + v[i] * lo;
      corners[2][i] = origin_[i] + u[i] * hi + v[i] * hi;
      corners[3][i] = origin_[i] + u[i] * lo + v[i] * hi;
    }
    ScreenPoint q[4];
    bool ok = true;
    for (int c = 0; c < 4; ++c) {
      q[c] = projectPoint(viewProj, view, corners[c]);
      if (!q[c].visible) ok = false;
    }
    if (ok && pointInQuad(mx, my, q)) return h;
  }

  ManipulatorHandle best = ManipulatorHandle::None;
  double bestDist = tol;
  for (int a = 0; a < 3; ++a) {
    double axis[3];
    handleAxis(axes[a], axis);
    double tip[3];
    for (int i = 0; i < 3; ++i) tip[i] = origin_[i] + axis[i] * size_;
    const ScreenPoint s = projectPoint(viewProj, view, tip);
    if (!s.visible) continue;
    const double d = pointSegmentDistance(mx, my, o.x, o.y, s.x, s.y);
    if (d < bestDist) {
      bestDist = d;
      best = axes[a];
    }
  }
  return best;
}

// ── drag geometry ───────────────────────────────────────────────────────────
bool Manipulator::axisPoint(const double rayOrigin[3], const double rayDir[3],
                            double& along) const {
  double axis[3];
  handleAxis(handle_, axis);
  if (!normalize(axis)) return false;
  double d[3] = {rayDir[0], rayDir[1], rayDir[2]};
  if (!normalize(d)) return false;

  // Closest approach between the axis line (origin_, axis) and the ray. The
  // denominator vanishes when the two are parallel -- looking straight down the
  // arrow -- and a gizmo that solves that frame anyway jumps by an arbitrary
  // amount, which is the single most complained-about gizmo bug in CAD.
  const double b = dot(axis, d);
  const double den = 1.0 - b * b;
  if (!(den > 1.0e-4)) return false;
  double w[3];
  for (int i = 0; i < 3; ++i) w[i] = origin_[i] - rayOrigin[i];
  const double c = dot(axis, w);
  const double f = dot(d, w);
  along = (c - b * f) / den;  // signed distance along `axis` from origin_
  return true;
}

bool Manipulator::planePoint(const double rayOrigin[3], const double rayDir[3],
                             double out[3]) const {
  double n[3];
  handleAxis(handle_, n);
  if (!normalize(n)) return false;
  const double denom = dot(n, rayDir);
  // A ray in the plane never meets it in one point. Refusing is right: the
  // alternative is a hit at infinity.
  if (std::fabs(denom) < 1.0e-6) return false;
  double w[3];
  for (int i = 0; i < 3; ++i) w[i] = origin_[i] - rayOrigin[i];
  const double t = dot(n, w) / denom;
  if (t < 0.0) return false;  // the plane is behind the eye
  for (int i = 0; i < 3; ++i) out[i] = rayOrigin[i] + rayDir[i] * t;
  return true;
}

bool Manipulator::ringAngle(const double rayOrigin[3], const double rayDir[3],
                            double& radians) const {
  double n[3];
  handleAxis(handle_, n);
  if (!normalize(n)) return false;
  double hit[3];
  if (!planePoint(rayOrigin, rayDir, hit)) return false;
  int a = 0;
  if (handle_ == ManipulatorHandle::AxisY) a = 1;
  if (handle_ == ManipulatorHandle::AxisZ) a = 2;
  double u[3] = {0.0, 0.0, 0.0};
  double v[3] = {0.0, 0.0, 0.0};
  u[(a + 1) % 3] = 1.0;
  v[(a + 2) % 3] = 1.0;
  double r[3];
  for (int i = 0; i < 3; ++i) r[i] = hit[i] - origin_[i];
  // Too near the ring's centre the angle is noise: a pixel of mouse movement
  // spins it half a turn. Refuse rather than emit that as a rotation.
  const double radius = std::sqrt(dot(r, r));
  if (!(radius > 0.05 * size_)) return false;
  // `u` and `v` are the two OTHER world basis vectors, which span the ring's
  // plane exactly because the axis is a unit basis vector -- no Gram-Schmidt and
  // no cross product is needed, and none is done, so the angle's zero is a fixed
  // world direction rather than something that drifts with the camera.
  radians = std::atan2(dot(r, v), dot(r, u));
  return true;
}

bool Manipulator::begin(ManipulatorHandle handle, const double rayOrigin[3],
                        const double rayDir[3]) {
  cancel();
  if (mode_ == ManipulatorMode::None || handle == ManipulatorHandle::None) return false;
  if (mode_ == ManipulatorMode::Rotate && isPlaneHandle(handle)) return false;
  handle_ = handle;

  if (mode_ == ManipulatorMode::Rotate) {
    double a = 0.0;
    if (!ringAngle(rayOrigin, rayDir, a)) {
      handle_ = ManipulatorHandle::None;
      return false;
    }
    lastAngle_ = a;
    rawAngle_ = 0.0;
    angleDeg_ = 0.0;
    active_ = true;
    return true;
  }

  if (isPlaneHandle(handle)) {
    if (!planePoint(rayOrigin, rayDir, startPoint_)) {
      handle_ = ManipulatorHandle::None;
      return false;
    }
  } else {
    if (!axisPoint(rayOrigin, rayDir, startAlong_)) {
      handle_ = ManipulatorHandle::None;
      return false;
    }
  }
  active_ = true;
  return true;
}

bool Manipulator::drag(const double rayOrigin[3], const double rayDir[3]) {
  if (!active_) return false;

  if (mode_ == ManipulatorMode::Rotate) {
    double a = 0.0;
    if (!ringAngle(rayOrigin, rayDir, a)) return false;
    // Unwrap: a step of more than half a turn between frames is the branch cut,
    // not a real half-turn of the mouse. Without this a drag past 180 degrees
    // flips sign and the body snaps back the way it came.
    double step = a - lastAngle_;
    while (step > kPi) step -= 2.0 * kPi;
    while (step < -kPi) step += 2.0 * kPi;
    lastAngle_ = a;
    rawAngle_ += step;
    angleDeg_ = snapTo(rawAngle_ * 180.0 / kPi, rotateSnap_);
    return true;
  }

  if (isPlaneHandle(handle_)) {
    double now[3];
    if (!planePoint(rayOrigin, rayDir, now)) return false;
    double u[3], v[3];
    planeBasis(handle_, u, v);
    double raw[3];
    for (int i = 0; i < 3; ++i) raw[i] = now[i] - startPoint_[i];
    // Snap each in-plane component independently; snapping the vector length
    // would move the body off the axis grid the user is aligning to.
    const double du = snapTo(dot(raw, u), translateSnap_);
    const double dv = snapTo(dot(raw, v), translateSnap_);
    for (int i = 0; i < 3; ++i) delta_[i] = u[i] * du + v[i] * dv;
    return true;
  }

  double along = 0.0;
  if (!axisPoint(rayOrigin, rayDir, along)) return false;
  double axis[3];
  handleAxis(handle_, axis);
  const double d = snapTo(along - startAlong_, translateSnap_);
  for (int i = 0; i < 3; ++i) delta_[i] = axis[i] * d;
  return true;
}

void Manipulator::previewMatrix(float out[16]) const noexcept {
  for (int i = 0; i < 16; ++i) out[i] = 0.0f;
  out[0] = out[5] = out[10] = out[15] = 1.0f;
  if (!active_) return;

  if (mode_ == ManipulatorMode::Translate) {
    out[12] = static_cast<float>(delta_[0]);
    out[13] = static_cast<float>(delta_[1]);
    out[14] = static_cast<float>(delta_[2]);
    return;
  }

  // Rotation ABOUT the gizmo origin, not about the world origin: the preview has
  // to match what ROTATE(%body, angle, axis, ox, oy, oz) will produce, and a
  // rotation about (0,0,0) would fly a part positioned away from it off-screen.
  double n[3];
  handleAxis(handle_, n);
  const double a = angleDeg_ * kPi / 180.0;
  const double c = std::cos(a);
  const double s = std::sin(a);
  const double t = 1.0 - c;
  double r[9];
  r[0] = t * n[0] * n[0] + c;
  r[1] = t * n[0] * n[1] + s * n[2];
  r[2] = t * n[0] * n[2] - s * n[1];
  r[3] = t * n[0] * n[1] - s * n[2];
  r[4] = t * n[1] * n[1] + c;
  r[5] = t * n[1] * n[2] + s * n[0];
  r[6] = t * n[0] * n[2] + s * n[1];
  r[7] = t * n[1] * n[2] - s * n[0];
  r[8] = t * n[2] * n[2] + c;
  // Column-major: out[col*4 + row].
  for (int col = 0; col < 3; ++col) {
    for (int row = 0; row < 3; ++row) {
      out[col * 4 + row] = static_cast<float>(r[col * 3 + row]);
    }
  }
  for (int row = 0; row < 3; ++row) {
    double v = origin_[row];
    for (int k = 0; k < 3; ++k) v -= r[k * 3 + row] * origin_[k];
    out[12 + row] = static_cast<float>(v);
  }
}

ManipulatorCommit Manipulator::commit() {
  ManipulatorCommit out;
  if (!active_) {
    out.reason = "manipulator_not_active";
    cancel();
    return out;
  }
  const ManipulatorMode mode = mode_;
  const ManipulatorHandle handle = handle_;
  const double dx = delta_[0], dy = delta_[1], dz = delta_[2];
  const double deg = angleDeg_;
  cancel();

  if (mode == ManipulatorMode::Translate) {
    if (std::fabs(dx) < kMinTranslate && std::fabs(dy) < kMinTranslate &&
        std::fabs(dz) < kMinTranslate) {
      out.reason = "translate_below_tolerance";
      return out;
    }
    out.ok = true;
    out.commandId = kManipulatorTranslateCommand;
    out.params.setNumber("dx", dx);
    out.params.setNumber("dy", dy);
    out.params.setNumber("dz", dz);
    return out;
  }

  if (mode == ManipulatorMode::Rotate) {
    if (std::fabs(deg) < kMinRotate) {
      out.reason = "rotate_below_tolerance";
      return out;
    }
    double axis[3];
    handleAxis(handle, axis);
    out.ok = true;
    out.commandId = kManipulatorRotateCommand;
    out.params.setNumber("angle", deg);
    out.params.setNumber("axx", axis[0]);
    out.params.setNumber("axy", axis[1]);
    out.params.setNumber("axz", axis[2]);
    // The pivot is the gizmo, which is the selection's centroid -- not the world
    // origin. ROTATE's optional origin arguments exist for exactly this.
    out.params.setNumber("ox", origin_[0]);
    out.params.setNumber("oy", origin_[1]);
    out.params.setNumber("oz", origin_[2]);
    return out;
  }

  out.reason = "manipulator_mode_none";
  return out;
}

}  // namespace forge::ui
