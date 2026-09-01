#include "forge/ui/CameraModel.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace forge::ui {
namespace {

constexpr double kPi = 3.14159265358979323846;

void cross3(const double a[3], const double b[3], double out[3]) noexcept {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

double dot3(const double a[3], const double b[3]) noexcept {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void normalize3(double v[3]) noexcept {
  const double len = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len > 1e-20) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }
}

// Column-major multiply: out = a * b, matching GLSL.
void mul4(const double a[16], const double b[16], double out[16]) noexcept {
  double tmp[16];
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      double s = 0.0;
      for (int k = 0; k < 4; ++k) s += a[k * 4 + r] * b[c * 4 + k];
      tmp[c * 4 + r] = s;
    }
  }
  std::memcpy(out, tmp, sizeof(tmp));
}

// The camera basis, shared by view() and ray() so the two cannot disagree about
// which way is right and which way is up. That disagreement is exactly the bug
// that draws a gizmo where the hit test does not look.
void basis(const double eyePos[3], const double target[3], double f[3], double s[3],
           double u[3]) noexcept {
  f[0] = target[0] - eyePos[0];
  f[1] = target[1] - eyePos[1];
  f[2] = target[2] - eyePos[2];
  normalize3(f);
  const double worldUp[3] = {0.0, 0.0, 1.0};
  cross3(f, worldUp, s);
  normalize3(s);
  cross3(s, f, u);
  normalize3(u);
}

}  // namespace

// ── resolving refs ──────────────────────────────────────────────────────────
bool faceIdFromKey(const std::string& persistentName, std::uint32_t& out) noexcept {
  constexpr const char* kPrefix = "face@";
  constexpr std::size_t kPrefixLen = 5;
  if (persistentName.size() <= kPrefixLen) return false;
  if (persistentName.compare(0, kPrefixLen, kPrefix) != 0) return false;

  std::uint64_t value = 0;
  for (std::size_t i = kPrefixLen; i < persistentName.size(); ++i) {
    const char c = persistentName[i];
    if (c < '0' || c > '9') return false;
    value = value * 10 + static_cast<std::uint64_t>(c - '0');
    // A face id is a uint32; refuse rather than wrap.
    if (value > 0xFFFFFFFFull) return false;
  }
  // Face ids are 1-based; 0 is the miss sentinel and is not a face.
  if (value == 0) return false;
  out = static_cast<std::uint32_t>(value);
  return true;
}

std::size_t growByFace(const MeasureMesh& mesh, std::uint32_t faceId, MeasureBox& box) noexcept {
  const std::vector<double>& xyz = mesh.coords();
  const std::vector<std::uint32_t>& ids = mesh.faceIds();
  std::size_t found = 0;
  for (std::size_t t = 0; t < ids.size(); ++t) {
    if (ids[t] != faceId) continue;
    ++found;
    const std::size_t base = t * 9;
    for (int corner = 0; corner < 3; ++corner) {
      const double p[3] = {xyz[base + static_cast<std::size_t>(corner) * 3 + 0],
                           xyz[base + static_cast<std::size_t>(corner) * 3 + 1],
                           xyz[base + static_cast<std::size_t>(corner) * 3 + 2]};
      box.grow(p);
    }
  }
  return found;
}

namespace {

// Grow by every triangle in the mesh. Used by both the whole-scene fit and a
// Body ref, which mean the same thing.
std::size_t growByWholeMesh(const MeasureMesh& mesh, MeasureBox& box) noexcept {
  const std::vector<double>& xyz = mesh.coords();
  const std::size_t tris = mesh.triangleCount();
  for (std::size_t t = 0; t < tris; ++t) {
    const std::size_t base = t * 9;
    for (int corner = 0; corner < 3; ++corner) {
      const double p[3] = {xyz[base + static_cast<std::size_t>(corner) * 3 + 0],
                           xyz[base + static_cast<std::size_t>(corner) * 3 + 1],
                           xyz[base + static_cast<std::size_t>(corner) * 3 + 2]};
      box.grow(p);
    }
  }
  return tris;
}

}  // namespace

FramingBounds sceneBounds(const PickScene& scene) {
  FramingBounds out;
  if (scene.mesh == nullptr || scene.mesh->empty()) {
    out.unresolved = 1;
    return out;
  }
  growByWholeMesh(*scene.mesh, out.box);
  out.resolved = 1;
  return out;
}

FramingBounds selectionBounds(const PickScene& scene, const std::vector<EntityRef>& refs) {
  FramingBounds out;
  for (const EntityRef& ref : refs) {
    // A ref for a different body cannot be resolved against this scene. Counting
    // it unresolved (rather than ignoring it) is what lets the caller say "2 of
    // 3" instead of quietly framing a subset.
    if (!ref.bodyId.empty() && !scene.bodyId.empty() && ref.bodyId != scene.bodyId) {
      ++out.unresolved;
      continue;
    }

    bool ok = false;
    switch (ref.kind) {
      case EntityKind::Face: {
        std::uint32_t faceId = 0;
        if (scene.mesh != nullptr && faceIdFromKey(ref.persistentName, faceId)) {
          ok = growByFace(*scene.mesh, faceId, out.box) > 0;
        }
        break;
      }
      case EntityKind::Edge: {
        if (scene.edges != nullptr) {
          const std::size_t idx = scene.edges->indexOf(ref.persistentName);
          if (idx != kNoEdge) {
            const MeshEdge& e = scene.edges->edges[idx];
            // Grow by the polyline itself rather than by the edge's own box, so
            // an edge whose box was never computed still frames correctly.
            for (std::size_t i = 0; i + 2 < e.points.size(); i += 3) {
              const double p[3] = {e.points[i], e.points[i + 1], e.points[i + 2]};
              out.box.grow(p);
            }
            ok = !e.points.empty();
          }
        }
        break;
      }
      case EntityKind::Vertex: {
        if (scene.vertices != nullptr) {
          const std::size_t idx = scene.vertices->indexOf(ref.persistentName);
          if (idx != kNoVertex) {
            out.box.grow(scene.vertices->vertices[idx].p);
            ok = true;
          }
        }
        break;
      }
      case EntityKind::Body: {
        if (scene.mesh != nullptr && !scene.mesh->empty()) {
          growByWholeMesh(*scene.mesh, out.box);
          ok = true;
        }
        break;
      }
      default:
        break;
    }

    if (ok) {
      ++out.resolved;
    } else {
      ++out.unresolved;
    }
  }
  return out;
}

// ── CameraModel ─────────────────────────────────────────────────────────────
void CameraModel::clampPlanes() noexcept {
  near_ = std::max(0.01, distance_ * 0.002);
  far_ = distance_ * 100.0;
}

void CameraModel::frame(const double centre[3], double radius) noexcept {
  target_[0] = centre[0];
  target_[1] = centre[1];
  target_[2] = centre[2];
  const double r = radius > 1e-4 ? radius : 1.0;
  double d = r / std::sin(fovY_ * 0.5);
  if (aspect_ < 1.0) d /= aspect_;
  distance_ = d * 1.15;  // 15% margin
  clampPlanes();
}

bool CameraModel::frameBounds(const FramingBounds& bounds) noexcept {
  if (!bounds.usable()) return false;
  double centre[3];
  bounds.box.centre(centre);
  // A box's bounding SPHERE has the half-diagonal as its radius. Using the
  // largest half-EXTENT instead is the classic fit bug: it frames a long thin
  // part so its ends fall off the screen.
  const double radius = bounds.box.diagonal() * 0.5;
  frame(centre, radius);
  return true;
}

void CameraModel::orbit(double dAzimuthRad, double dElevationRad) noexcept {
  azimuth_ += dAzimuthRad;
  // Keep azimuth in (-pi, pi] so a long drag cannot accumulate a huge double.
  while (azimuth_ > kPi) azimuth_ -= 2.0 * kPi;
  while (azimuth_ < -kPi) azimuth_ += 2.0 * kPi;
  elevation_ = std::clamp(elevation_ + dElevationRad, -kPi * 0.5 + kCameraPoleGuard,
                          kPi * 0.5 - kCameraPoleGuard);
}

void CameraModel::pan(double dxPixels, double dyPixels, double viewportHeight) noexcept {
  const double perPixel = worldPerPixelAtTarget(viewportHeight);

  double eyePos[3];
  eye(eyePos);
  double f[3], s[3], u[3];
  basis(eyePos, target_, f, s, u);

  for (int i = 0; i < 3; ++i) {
    target_[i] += (-dxPixels * s[i] + dyPixels * u[i]) * perPixel;
  }
}

void CameraModel::zoom(double steps) noexcept {
  // 1.1 per notch is the ratio every CAD wheel-zoom uses: fast enough to cross
  // two orders of magnitude in ~50 notches, slow enough to frame a chamfer.
  distance_ *= std::pow(1.1, -steps);
  distance_ = std::clamp(distance_, 1e-3, 1e7);
  clampPlanes();
}

void namedViewAngles(NamedView view, double& azimuthRad, double& elevationRad) noexcept {
  // Z-up. FRONT puts the eye on -Y, RIGHT on +X; TOP and BOTTOM sit ON the pole
  // guard so the up vector stays defined at the poles.
  constexpr double kPoleEl = kPi * 0.5 - kCameraPoleGuard;
  switch (view) {
    case NamedView::Front:  azimuthRad = -kPi * 0.5; elevationRad = 0.0; return;
    case NamedView::Back:   azimuthRad =  kPi * 0.5; elevationRad = 0.0; return;
    case NamedView::Right:  azimuthRad =  0.0;       elevationRad = 0.0; return;
    case NamedView::Left:   azimuthRad =  kPi;       elevationRad = 0.0; return;
    case NamedView::Top:    azimuthRad = -kPi * 0.5; elevationRad =  kPoleEl; return;
    case NamedView::Bottom: azimuthRad = -kPi * 0.5; elevationRad = -kPoleEl; return;
    case NamedView::Isometric:
      azimuthRad = -kPi * 0.25;
      // True isometric: elevation = atan(1/sqrt(2)) = 35.264 degrees, which is
      // what makes the three axis directions foreshorten equally.
      elevationRad = std::atan(1.0 / std::sqrt(2.0));
      return;
  }
  azimuthRad = -kPi * 0.5;
  elevationRad = 0.0;
}

void CameraModel::setNamedView(NamedView view) noexcept {
  namedViewAngles(view, azimuth_, elevation_);
}

bool CameraModel::viewNormalTo(const double normal[3]) noexcept {
  double n[3] = {normal[0], normal[1], normal[2]};
  const double len = std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (!(len > 1e-9)) return false;  // also rejects NaN, which `<=` would not
  n[0] /= len;
  n[1] /= len;
  n[2] /= len;

  // eye - target = distance * n, so elevation = asin(nz) and azimuth =
  // atan2(ny, nx). At a pole nx and ny are both ~0 and atan2 is arbitrary, so
  // the azimuth is KEPT rather than reset — spinning the part sideways when the
  // user asked to look at its top face is a surprise.
  const double clampedZ = std::clamp(n[2], -1.0, 1.0);
  const double el = std::asin(clampedZ);
  if (std::fabs(n[0]) > 1e-9 || std::fabs(n[1]) > 1e-9) {
    azimuth_ = std::atan2(n[1], n[0]);
  }
  elevation_ = std::clamp(el, -kPi * 0.5 + kCameraPoleGuard, kPi * 0.5 - kCameraPoleGuard);
  return true;
}

void CameraModel::setTarget(const double t[3]) noexcept {
  target_[0] = t[0];
  target_[1] = t[1];
  target_[2] = t[2];
}

void CameraModel::setAspect(double aspect) noexcept {
  aspect_ = aspect > 1e-4 ? aspect : 1.0;
}

void CameraModel::setFovY(double radians) noexcept {
  // Clamped to a sane lens: below ~1 degree the tangent explodes and above
  // ~170 degrees the projection is unusable.
  fovY_ = std::clamp(radians, 0.0175, 2.9670);
}

void CameraModel::setDistance(double d) noexcept {
  distance_ = std::clamp(d, 1e-3, 1e7);
  clampPlanes();
}

void CameraModel::eye(double out[3]) const noexcept {
  const double ce = std::cos(elevation_);
  out[0] = target_[0] + distance_ * ce * std::cos(azimuth_);
  out[1] = target_[1] + distance_ * ce * std::sin(azimuth_);
  out[2] = target_[2] + distance_ * std::sin(elevation_);
}

void CameraModel::view(double out[16]) const noexcept {
  double eyePos[3];
  eye(eyePos);
  double f[3], s[3], u[3];
  basis(eyePos, target_, f, s, u);

  // Column-major look-at (the gluLookAt matrix).
  out[0] = s[0];  out[4] = s[1];  out[8]  = s[2];  out[12] = -dot3(s, eyePos);
  out[1] = u[0];  out[5] = u[1];  out[9]  = u[2];  out[13] = -dot3(u, eyePos);
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = dot3(f, eyePos);
  out[3] = 0.0;   out[7] = 0.0;   out[11] = 0.0;   out[15] = 1.0;
}

void CameraModel::proj(double out[16]) const noexcept {
  // Vulkan clip space: depth in [0,1] and Y pointing DOWN in NDC, so the Y row
  // is negated relative to the OpenGL matrix.
  const double t = 1.0 / std::tan(fovY_ * 0.5);
  std::memset(out, 0, sizeof(double) * 16);
  out[0] = t / aspect_;
  out[5] = -t;
  out[10] = far_ / (near_ - far_);
  out[11] = -1.0;
  out[14] = (near_ * far_) / (near_ - far_);
}

void CameraModel::viewProj(double out[16]) const noexcept {
  double v[16], p[16];
  view(v);
  proj(p);
  mul4(p, v, out);
}

void CameraModel::ray(double x, double y, double width, double height, double origin[3],
                      double direction[3]) const noexcept {
  eye(origin);
  const double w = width > 1.0 ? width : 1.0;
  const double h = height > 1.0 ? height : 1.0;
  // Pixel -> NDC in [-1,1], y measured downward from the top-left, matching the
  // negated-Y projection above.
  const double ndcX = (2.0 * x / w) - 1.0;
  const double ndcY = (2.0 * y / h) - 1.0;
  const double tanHalf = std::tan(fovY_ * 0.5);

  double f[3], s[3], u[3];
  basis(origin, target_, f, s, u);

  const double sx = ndcX * tanHalf * aspect_;
  const double sy = -ndcY * tanHalf;  // undo the projection's Y flip
  for (int i = 0; i < 3; ++i) direction[i] = f[i] + s[i] * sx + u[i] * sy;
  normalize3(direction);
}

double CameraModel::worldPerPixelAtTarget(double viewportHeight) const noexcept {
  return worldPerPixel(distance_, fovY_, viewportHeight);
}

}  // namespace forge::ui
