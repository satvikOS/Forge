#include "forge/ui/Manipulator.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>

#include "forge/ui/CommandRegistry.hpp"

namespace forge::ui {
namespace {

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void cross3(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

bool normalize3(double v[3]) noexcept {
  const double n = std::sqrt(dot3(v, v));
  if (!(n > 1e-15)) return false;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
  return true;
}

// Distance from a pixel to the SEGMENT a..b, in pixels. The segment, not the
// line: an arrow that ends is not grabbable past its tip.
double pointToSegment2(const double p[2], const double a[2], const double b[2]) noexcept {
  const double vx = b[0] - a[0], vy = b[1] - a[1];
  const double wx = p[0] - a[0], wy = p[1] - a[1];
  const double vv = vx * vx + vy * vy;
  double t = vv > 0.0 ? (wx * vx + wy * vy) / vv : 0.0;
  if (t < 0.0) t = 0.0;
  if (t > 1.0) t = 1.0;
  const double dx = wx - t * vx, dy = wy - t * vy;
  return std::sqrt(dx * dx + dy * dy);
}

double snapTo(double value, double step) noexcept {
  if (!(step > 0.0)) return value;
  return std::round(value / step) * step;
}

// Trim a value that is a rounding artefact of a drag that did not move. The
// threshold is far below any distance a user can express with a mouse and far
// above double noise.
constexpr double kNullMotion = 1e-9;

}  // namespace

// ── matrix ─────────────────────────────────────────────────────────────────
// Column-major throughout: m[col * 4 + row], the layout GLSL `mat4` expects.
// The cofactor expansion below is the standard one (Mesa's invert_matrix), kept
// literal rather than clever because a transposed sign in a matrix inverse is
// invisible until a drag goes the wrong way.
bool invert4x4(const double m[16], double out[16]) noexcept {
  double inv[16];
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] +
           m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] -
           m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] +
           m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] -
            m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] -
           m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] +
           m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] -
           m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] +
            m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] +
           m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] -
           m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] +
            m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] -
            m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] -
           m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] +
           m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] -
            m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] +
            m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

  const double det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!(std::fabs(det) > 1e-20)) return false;
  const double invDet = 1.0 / det;
  for (int i = 0; i < 16; ++i) out[i] = inv[i] * invDet;
  return true;
}

// ── ViewportProjection ─────────────────────────────────────────────────────
ViewportProjection::ViewportProjection() noexcept = default;

bool ViewportProjection::set(const float viewProj[16], double x, double y, double width,
                             double height) noexcept {
  valid_ = false;
  if (viewProj == nullptr) return false;
  if (!(width > 0.0) || !(height > 0.0)) return false;
  for (int i = 0; i < 16; ++i) m_[i] = static_cast<double>(viewProj[i]);
  if (!invert4x4(m_, inv_)) return false;
  x_ = x;
  y_ = y;
  width_ = width;
  height_ = height;
  valid_ = true;
  return true;
}

bool ViewportProjection::project(const double world[3], double out[2]) const noexcept {
  if (!valid_) return false;
  const double cx = m_[0] * world[0] + m_[4] * world[1] + m_[8] * world[2] + m_[12];
  const double cy = m_[1] * world[0] + m_[5] * world[1] + m_[9] * world[2] + m_[13];
  const double cw = m_[3] * world[0] + m_[7] * world[1] + m_[11] * world[2] + m_[15];
  if (!(cw > 1e-9)) return false;  // at or behind the eye plane
  // Vulkan NDC: x in [-1,1] left to right, y in [-1,1] TOP to bottom -- the
  // projection already carries the Y flip, so the viewport map ADDS y rather
  // than subtracting it. This is the same mapping ForgeFrame's edge overlay
  // uses; the two must agree or the gizmo is grabbable where it is not drawn.
  out[0] = x_ + (cx / cw * 0.5 + 0.5) * width_;
  out[1] = y_ + (cy / cw * 0.5 + 0.5) * height_;
  return true;
}

bool ViewportProjection::ray(double px, double py, double origin[3],
                             double direction[3]) const noexcept {
  if (!valid_) return false;
  const double ndcX = 2.0 * (px - x_) / width_ - 1.0;
  const double ndcY = 2.0 * (py - y_) / height_ - 1.0;
  // Two points down the same pixel, at the near and far planes of the Vulkan
  // depth range [0, 1], unprojected through the inverse and de-homogenised.
  const double zs[2] = {0.0, 1.0};
  double world[2][3];
  for (int k = 0; k < 2; ++k) {
    const double c[4] = {ndcX, ndcY, zs[k], 1.0};
    double w[4];
    for (int r = 0; r < 4; ++r) {
      w[r] = inv_[0 * 4 + r] * c[0] + inv_[1 * 4 + r] * c[1] + inv_[2 * 4 + r] * c[2] +
             inv_[3 * 4 + r] * c[3];
    }
    if (!(std::fabs(w[3]) > 1e-18)) return false;
    for (int a = 0; a < 3; ++a) world[k][a] = w[a] / w[3];
  }
  for (int a = 0; a < 3; ++a) {
    origin[a] = world[0][a];
    direction[a] = world[1][a] - world[0][a];
  }
  return normalize3(direction);
}

// ── names ──────────────────────────────────────────────────────────────────
const char* toString(ManipulatorMode mode) noexcept {
  switch (mode) {
    case ManipulatorMode::Off:       return "off";
    case ManipulatorMode::Translate: return "translate";
    case ManipulatorMode::Rotate:    return "rotate";
  }
  return "off";
}

const char* toString(HandleAxis axis) noexcept {
  switch (axis) {
    case HandleAxis::None: return "none";
    case HandleAxis::X:    return "x";
    case HandleAxis::Y:    return "y";
    case HandleAxis::Z:    return "z";
  }
  return "none";
}

bool operator==(const ManipulatorHandle& a, const ManipulatorHandle& b) noexcept {
  return a.mode == b.mode && a.axis == b.axis;
}

bool operator!=(const ManipulatorHandle& a, const ManipulatorHandle& b) noexcept {
  return !(a == b);
}

// ── Manipulator ────────────────────────────────────────────────────────────
void Manipulator::setMode(ManipulatorMode mode) noexcept {
  if (mode == mode_) return;
  cancel();
  mode_ = mode;
  hover_ = ManipulatorHandle{};
}

void Manipulator::setPivot(const double p[3]) noexcept {
  if (p == nullptr) return;
  for (int a = 0; a < 3; ++a) pivot_[a] = p[a];
}

void Manipulator::setSize(double worldRadius) noexcept {
  size_ = worldRadius > 1e-9 ? worldRadius : 1e-9;
}

void Manipulator::setSnap(double translateStep, double rotateStepDegrees) noexcept {
  translateSnap_ = translateStep > 0.0 ? translateStep : 0.0;
  rotateSnap_ = rotateStepDegrees > 0.0 ? rotateStepDegrees : 0.0;
}

void Manipulator::axisVector(HandleAxis axis, double out[3]) noexcept {
  out[0] = out[1] = out[2] = 0.0;
  switch (axis) {
    case HandleAxis::X: out[0] = 1.0; break;
    case HandleAxis::Y: out[1] = 1.0; break;
    case HandleAxis::Z: out[2] = 1.0; break;
    case HandleAxis::None: break;
  }
}

bool Manipulator::axisFrame(HandleAxis axis, double out[3]) const noexcept {
  if (axis == HandleAxis::None) return false;
  axisVector(axis, out);
  return true;
}

bool Manipulator::axisTip(HandleAxis axis, double out[3]) const noexcept {
  double a[3];
  if (!axisFrame(axis, a)) return false;
  for (int i = 0; i < 3; ++i) out[i] = pivot_[i] + size_ * a[i];
  return true;
}

bool Manipulator::ringPoint(HandleAxis axis, int i, double out[3]) const noexcept {
  double n[3];
  if (!axisFrame(axis, n)) return false;
  // Two unit vectors spanning the plane normal to `n`. For the three world axes
  // this is a fixed, right-handed choice, so ring point 0 of the X ring is
  // always +Y and the drawn ring is reproducible.
  double u[3], v[3];
  switch (axis) {
    case HandleAxis::X: u[0] = 0; u[1] = 1; u[2] = 0; v[0] = 0; v[1] = 0; v[2] = 1; break;
    case HandleAxis::Y: u[0] = 0; u[1] = 0; u[2] = 1; v[0] = 1; v[1] = 0; v[2] = 0; break;
    default:            u[0] = 1; u[1] = 0; u[2] = 0; v[0] = 0; v[1] = 1; v[2] = 0; break;
  }
  const double twoPi = 6.283185307179586;
  const double t = twoPi * static_cast<double>(i) / static_cast<double>(kManipulatorRingSegments);
  const double c = std::cos(t) * size_;
  const double s = std::sin(t) * size_;
  for (int a = 0; a < 3; ++a) out[a] = pivot_[a] + c * u[a] + s * v[a];
  return true;
}

ManipulatorHandle Manipulator::hitTest(const ViewportProjection& view, double px, double py,
                                       double pixelTolerance) const noexcept {
  ManipulatorHandle best;
  if (mode_ == ManipulatorMode::Off || !view.valid()) return best;
  const double p[2] = {px, py};
  double bestDistance = pixelTolerance;

  double centre[2];
  const bool centreOk = view.project(pivot_, centre);
  const HandleAxis axes[3] = {HandleAxis::X, HandleAxis::Y, HandleAxis::Z};

  for (int k = 0; k < 3; ++k) {
    const HandleAxis axis = axes[k];
    if (mode_ == ManipulatorMode::Translate) {
      if (!centreOk) continue;
      double tip[3], tip2[2];
      if (!axisTip(axis, tip)) continue;
      if (!view.project(tip, tip2)) continue;
      const double d = pointToSegment2(p, centre, tip2);
      // Strictly closer wins; a tie keeps the earlier axis, which is X then Y
      // then Z, so the answer never depends on iteration order.
      if (d < bestDistance) {
        bestDistance = d;
        best.mode = mode_;
        best.axis = axis;
      }
    } else {
      // The ring is hit-tested against the SAME polyline the caller draws --
      // kManipulatorRingSegments chords, not an analytic circle -- so a ring is
      // never grabbable where it is not drawn.
      double prev[2];
      bool havePrev = false;
      for (int i = 0; i <= kManipulatorRingSegments; ++i) {
        double w[3], s[2];
        if (!ringPoint(axis, i % kManipulatorRingSegments, w)) break;
        if (!view.project(w, s)) {
          havePrev = false;
          continue;
        }
        if (havePrev) {
          const double d = pointToSegment2(p, prev, s);
          if (d < bestDistance) {
            bestDistance = d;
            best.mode = mode_;
            best.axis = axis;
          }
        }
        prev[0] = s[0];
        prev[1] = s[1];
        havePrev = true;
      }
    }
  }
  return best;
}

bool Manipulator::begin(const ViewportProjection& view, const ManipulatorHandle& handle,
                        double px, double py) noexcept {
  cancel();
  if (mode_ == ManipulatorMode::Off || !handle.valid() || handle.mode != mode_) return false;
  if (!view.valid()) return false;

  double o[3], d[3];
  if (!view.ray(px, py, o, d)) return false;
  double a[3];
  if (!axisFrame(handle.axis, a)) return false;

  if (mode_ == ManipulatorMode::Translate) {
    // Closest point on the axis LINE (pivot + s*a) to the pick ray (o + t*d).
    // denom = (a.d)^2 - (a.a)(d.d) vanishes when the ray is parallel to the
    // axis, which is an axis seen end-on: there is no usable screen extent and
    // the drag must be refused rather than solved to a huge number.
    const double w0[3] = {pivot_[0] - o[0], pivot_[1] - o[1], pivot_[2] - o[2]};
    const double A = dot3(a, a), B = dot3(a, d), C = dot3(d, d);
    const double D = dot3(a, w0), E = dot3(d, w0);
    const double denom = B * B - A * C;
    if (!(std::fabs(denom) > 1e-6)) return false;
    const double t = (D * B - A * E) / denom;
    grabParam_ = (t * B - D) / A;
  } else {
    // Ray / plane(pivot, normal = a). A near-zero denominator is a ring seen
    // edge-on: the intersection runs off to infinity and the angle is noise.
    const double denom = dot3(d, a);
    if (!(std::fabs(denom) > 1e-4)) return false;
    const double w0[3] = {pivot_[0] - o[0], pivot_[1] - o[1], pivot_[2] - o[2]};
    const double t = dot3(w0, a) / denom;
    if (!(t > 0.0)) return false;  // the plane is behind the eye
    double hit[3];
    for (int i = 0; i < 3; ++i) hit[i] = o[i] + t * d[i] - pivot_[i];
    const double along = dot3(hit, a);
    for (int i = 0; i < 3; ++i) grabVector_[i] = hit[i] - along * a[i];
    if (!normalize3(grabVector_)) return false;
  }

  active_ = handle;
  dragging_ = true;
  translation_ = 0.0;
  rotation_ = 0.0;
  return true;
}

bool Manipulator::dragTo(const ViewportProjection& view, double px, double py) noexcept {
  if (!dragging_ || !view.valid()) return false;
  double o[3], d[3];
  if (!view.ray(px, py, o, d)) return false;
  double a[3];
  if (!axisFrame(active_.axis, a)) return false;

  if (active_.mode == ManipulatorMode::Translate) {
    const double w0[3] = {pivot_[0] - o[0], pivot_[1] - o[1], pivot_[2] - o[2]};
    const double A = dot3(a, a), B = dot3(a, d), C = dot3(d, d);
    const double D = dot3(a, w0), E = dot3(d, w0);
    const double denom = B * B - A * C;
    // Mid-drag the view can swing until the axis is end-on. The previous value
    // is KEPT rather than replaced with a divergent one: a gizmo that jumps to
    // infinity when the camera passes through a singularity is worse than one
    // that holds still for a frame.
    if (!(std::fabs(denom) > 1e-6)) return false;
    const double t = (D * B - A * E) / denom;
    const double s = (t * B - D) / A;
    translation_ = snapTo(s - grabParam_, translateSnap_);
    return true;
  }

  const double denom = dot3(d, a);
  if (!(std::fabs(denom) > 1e-4)) return false;
  const double w0[3] = {pivot_[0] - o[0], pivot_[1] - o[1], pivot_[2] - o[2]};
  const double t = dot3(w0, a) / denom;
  if (!(t > 0.0)) return false;
  double hit[3];
  for (int i = 0; i < 3; ++i) hit[i] = o[i] + t * d[i] - pivot_[i];
  const double along = dot3(hit, a);
  double now[3];
  for (int i = 0; i < 3; ++i) now[i] = hit[i] - along * a[i];
  if (!normalize3(now)) return false;
  // Signed angle from the grab vector to the current one ABOUT the axis:
  // atan2(|u x v| . a, u . v). Right-handed, so a positive angle is the same
  // sense ROTATE(%body, angle, ax, ay, az) applies.
  double c[3];
  cross3(grabVector_, now, c);
  const double sn = dot3(c, a);
  const double cs = dot3(grabVector_, now);
  const double deg = std::atan2(sn, cs) * 57.29577951308232;
  rotation_ = snapTo(deg, rotateSnap_);
  return true;
}

void Manipulator::previewOffset(double out[3]) const noexcept {
  out[0] = out[1] = out[2] = 0.0;
  if (!dragging_ || active_.mode != ManipulatorMode::Translate) return;
  double a[3];
  if (!axisFrame(active_.axis, a)) return;
  for (int i = 0; i < 3; ++i) out[i] = a[i] * translation_;
}

ManipulatorEmission Manipulator::release() noexcept {
  ManipulatorEmission out;
  if (!dragging_) return out;
  const ManipulatorHandle handle = active_;
  const double translation = translation_;
  const double rotation = rotation_;
  cancel();
  if (!handle.valid()) return out;

  double a[3];
  axisVector(handle.axis, a);
  if (handle.mode == ManipulatorMode::Translate) {
    if (!(std::fabs(translation) > kNullMotion)) return out;
    out.valid = true;
    out.commandId = "part.move";
    out.params.setNumber("dx", a[0] * translation);
    out.params.setNumber("dy", a[1] * translation);
    out.params.setNumber("dz", a[2] * translation);
    out.summary = std::string("move ") + toString(handle.axis) + " " + std::to_string(translation);
  } else {
    if (!(std::fabs(rotation) > kNullMotion)) return out;
    out.valid = true;
    out.commandId = "part.rotate";
    out.params.setNumber("angle", rotation);
    out.params.setNumber("axx", a[0]);
    out.params.setNumber("axy", a[1]);
    out.params.setNumber("axz", a[2]);
    // The pivot is passed explicitly. ROTATE's origin triple defaults to the
    // world origin, and a gizmo whose ring is drawn around the selection but
    // whose statement turns the body about (0,0,0) is a handle that lies.
    out.params.setNumber("ox", pivot_[0]);
    out.params.setNumber("oy", pivot_[1]);
    out.params.setNumber("oz", pivot_[2]);
    out.summary =
        std::string("rotate ") + toString(handle.axis) + " " + std::to_string(rotation) + " deg";
  }
  ++emissions_;
  return out;
}

void Manipulator::cancel() noexcept {
  dragging_ = false;
  active_ = ManipulatorHandle{};
  translation_ = 0.0;
  rotation_ = 0.0;
  grabParam_ = 0.0;
  grabVector_[0] = grabVector_[1] = grabVector_[2] = 0.0;
}

}  // namespace forge::ui
