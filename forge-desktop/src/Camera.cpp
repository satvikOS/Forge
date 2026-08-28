#include "Camera.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "forge/ui/Keymap.hpp"

namespace forge::desktop {
namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kPoleGuard = 0.02f;  // radians kept clear of ±90° so up never degenerates

void cross(const float a[3], const float b[3], float out[3]) {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

void normalize(float v[3]) {
  const float len = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len > 1e-20f) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }
}

float dot(const float a[3], const float b[3]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Column-major multiply: out = a * b, both column-major, matching GLSL.
void mul(const float a[16], const float b[16], float out[16]) {
  float tmp[16];
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      float s = 0.0f;
      for (int k = 0; k < 4; ++k) s += a[k * 4 + r] * b[c * 4 + k];
      tmp[c * 4 + r] = s;
    }
  }
  std::memcpy(out, tmp, sizeof(tmp));
}

}  // namespace

const char* toString(NavVerb verb) noexcept {
  switch (verb) {
    case NavVerb::None:  return "none";
    case NavVerb::Orbit: return "orbit";
    case NavVerb::Pan:   return "pan";
    case NavVerb::Zoom:  return "zoom";
  }
  return "none";
}

// ── the four navigation profiles ────────────────────────────────────────────
// Each row is the documented behaviour of the system it imitates. They are NOT
// interchangeable, and the differences below are the whole point of shipping
// four profiles instead of one:
//
//   Forge-native  MMB orbit, Shift+MMB pan, Ctrl+MMB zoom.
//   NX-like       MMB rotate, Shift+MMB pan, Ctrl+MMB zoom. (Siemens NX default
//                 mouse map: "MB2 rotate, Shift+MB2 pan, Ctrl+MB2 zoom".)
//   CATIA-like    MMB alone PANS; MMB held while RMB is pressed ROTATES; MMB+LMB
//                 zooms. This is the V5 compass convention and is the profile a
//                 CATIA user's hands already know — it is also why NavVerb needs
//                 a None: a CATIA middle-drag with no second button is a pan, and
//                 a right-drag with no middle button is nothing at all.
//   Blender-like  MMB orbit, Shift+MMB pan, Ctrl+MMB zoom — Blender's own map.
//                 Alt+LMB also orbits, for the "emulate 3-button mouse" habit.
NavVerb navVerbFor(forge::ui::InputProfile profile, const NavInput& in) noexcept {
  using forge::ui::InputProfile;
  switch (profile) {
    case InputProfile::ForgeNative:
    case InputProfile::NXLike:
      if (!in.middle) return NavVerb::None;
      if (in.ctrl) return NavVerb::Zoom;
      if (in.shift) return NavVerb::Pan;
      return NavVerb::Orbit;

    case InputProfile::CATIALike:
      if (!in.middle) return NavVerb::None;
      if (in.right) return NavVerb::Orbit;
      if (in.left) return NavVerb::Zoom;
      return NavVerb::Pan;

    case InputProfile::BlenderLike:
      if (in.alt && in.left && !in.middle) return NavVerb::Orbit;
      if (!in.middle) return NavVerb::None;
      if (in.ctrl) return NavVerb::Zoom;
      if (in.shift) return NavVerb::Pan;
      return NavVerb::Orbit;
  }
  return NavVerb::None;
}

const char* navHintFor(forge::ui::InputProfile profile) noexcept {
  using forge::ui::InputProfile;
  switch (profile) {
    case InputProfile::ForgeNative:
      return "MMB orbit  |  Shift+MMB pan  |  Ctrl+MMB or wheel zoom";
    case InputProfile::NXLike:
      return "MB2 rotate  |  Shift+MB2 pan  |  Ctrl+MB2 or wheel zoom";
    case InputProfile::CATIALike:
      return "MMB pan  |  MMB+RMB rotate  |  MMB+LMB or wheel zoom";
    case InputProfile::BlenderLike:
      return "MMB orbit  |  Shift+MMB pan  |  Ctrl+MMB or wheel zoom  |  Alt+LMB orbit";
  }
  return "";
}

// ── Camera ──────────────────────────────────────────────────────────────────
void Camera::frame(const float centre[3], float radius) noexcept {
  target_[0] = centre[0];
  target_[1] = centre[1];
  target_[2] = centre[2];
  const float r = radius > 1e-4f ? radius : 1.0f;
  // Fit the bounding sphere in the VERTICAL fov, then apply the same margin
  // horizontally by dividing by the aspect when the viewport is narrow.
  float d = r / std::sin(fovY_ * 0.5f);
  if (aspect_ < 1.0f) d /= aspect_;
  distance_ = d * 1.15f;  // 15% margin
  near_ = std::max(0.01f, distance_ * 0.002f);
  far_ = distance_ * 100.0f;
}

void Camera::orbit(float dAzimuthRad, float dElevationRad) noexcept {
  azimuth_ += dAzimuthRad;
  // Keep azimuth in (-pi, pi] so a long drag cannot accumulate a huge float.
  while (azimuth_ > kPi) azimuth_ -= 2.0f * kPi;
  while (azimuth_ < -kPi) azimuth_ += 2.0f * kPi;
  elevation_ = std::clamp(elevation_ + dElevationRad, -kPi * 0.5f + kPoleGuard,
                          kPi * 0.5f - kPoleGuard);
}

void Camera::pan(float dxPixels, float dyPixels, float viewportHeight) noexcept {
  const float h = viewportHeight > 1.0f ? viewportHeight : 1.0f;
  // World units per pixel at the target plane.
  const float worldPerPixel = 2.0f * distance_ * std::tan(fovY_ * 0.5f) / h;

  float eyePos[3];
  eye(eyePos);
  float fwd[3] = {target_[0] - eyePos[0], target_[1] - eyePos[1], target_[2] - eyePos[2]};
  normalize(fwd);
  const float up[3] = {0.0f, 0.0f, 1.0f};
  float right[3];
  cross(fwd, up, right);
  normalize(right);
  float camUp[3];
  cross(right, fwd, camUp);
  normalize(camUp);

  for (int i = 0; i < 3; ++i) {
    target_[i] += (-dxPixels * right[i] + dyPixels * camUp[i]) * worldPerPixel;
  }
}

void Camera::zoom(float steps) noexcept {
  // 1.1 per notch is the ratio every CAD wheel-zoom uses: fast enough to cross
  // two orders of magnitude in ~50 notches, slow enough to frame a chamfer.
  distance_ *= std::pow(1.1f, -steps);
  distance_ = std::clamp(distance_, 1e-3f, 1e7f);
  near_ = std::max(0.01f, distance_ * 0.002f);
  far_ = distance_ * 100.0f;
}

void Camera::setFront() noexcept {
  azimuth_ = -kPi * 0.5f;
  elevation_ = 0.0f;
}
void Camera::setTop() noexcept {
  azimuth_ = -kPi * 0.5f;
  elevation_ = kPi * 0.5f - kPoleGuard;
}
void Camera::setRight() noexcept {
  azimuth_ = 0.0f;
  elevation_ = 0.0f;
}
void Camera::setIsometric() noexcept {
  azimuth_ = -kPi * 0.25f;
  // True isometric: elevation = atan(1/sqrt(2)) = 35.264 degrees.
  elevation_ = std::atan(1.0f / std::sqrt(2.0f));
}

void Camera::eye(float out[3]) const noexcept {
  const float ce = std::cos(elevation_);
  out[0] = target_[0] + distance_ * ce * std::cos(azimuth_);
  out[1] = target_[1] + distance_ * ce * std::sin(azimuth_);
  out[2] = target_[2] + distance_ * std::sin(elevation_);
}

void Camera::view(float out[16]) const noexcept {
  float eyePos[3];
  eye(eyePos);
  float f[3] = {target_[0] - eyePos[0], target_[1] - eyePos[1], target_[2] - eyePos[2]};
  normalize(f);
  const float worldUp[3] = {0.0f, 0.0f, 1.0f};
  float s[3];
  cross(f, worldUp, s);
  normalize(s);
  float u[3];
  cross(s, f, u);

  // Column-major look-at (the gluLookAt matrix).
  out[0] = s[0];  out[4] = s[1];  out[8]  = s[2];  out[12] = -dot(s, eyePos);
  out[1] = u[0];  out[5] = u[1];  out[9]  = u[2];  out[13] = -dot(u, eyePos);
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = dot(f, eyePos);
  out[3] = 0.0f;  out[7] = 0.0f;  out[11] = 0.0f;  out[15] = 1.0f;
}

void Camera::proj(float out[16]) const noexcept {
  // Vulkan clip space: depth in [0,1] and Y pointing DOWN in NDC, so the Y row
  // is negated relative to the OpenGL matrix. Getting this wrong renders the
  // model upside down, which is the classic first Vulkan bug.
  const float t = 1.0f / std::tan(fovY_ * 0.5f);
  std::memset(out, 0, sizeof(float) * 16);
  out[0] = t / aspect_;
  out[5] = -t;
  out[10] = far_ / (near_ - far_);
  out[11] = -1.0f;
  out[14] = (near_ * far_) / (near_ - far_);
}

void Camera::viewProj(float out[16]) const noexcept {
  float v[16], p[16];
  view(v);
  proj(p);
  mul(p, v, out);
}

void Camera::identity(float out[16]) noexcept {
  std::memset(out, 0, sizeof(float) * 16);
  out[0] = out[5] = out[10] = out[15] = 1.0f;
}

void Camera::ray(float x, float y, float width, float height, float origin[3],
                 float direction[3]) const noexcept {
  eye(origin);
  const float w = width > 1.0f ? width : 1.0f;
  const float h = height > 1.0f ? height : 1.0f;
  // Pixel -> NDC in [-1,1], y already measured downward from the top-left, which
  // matches the negated-Y projection above.
  const float ndcX = (2.0f * x / w) - 1.0f;
  const float ndcY = (2.0f * y / h) - 1.0f;
  const float tanHalf = std::tan(fovY_ * 0.5f);

  float eyePos[3];
  eye(eyePos);
  float f[3] = {target_[0] - eyePos[0], target_[1] - eyePos[1], target_[2] - eyePos[2]};
  normalize(f);
  const float worldUp[3] = {0.0f, 0.0f, 1.0f};
  float s[3];
  cross(f, worldUp, s);
  normalize(s);
  float u[3];
  cross(s, f, u);

  const float sx = ndcX * tanHalf * aspect_;
  const float sy = -ndcY * tanHalf;  // undo the projection's Y flip
  for (int i = 0; i < 3; ++i) direction[i] = f[i] + s[i] * sx + u[i] * sy;
  normalize(direction);
}

}  // namespace forge::desktop
