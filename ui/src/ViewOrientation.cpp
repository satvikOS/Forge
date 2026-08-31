#include "forge/ui/ViewOrientation.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ViewportSelect.hpp"

namespace forge::ui {
namespace {

constexpr double kPi = 3.14159265358979323846;

double clampElevation(double el) noexcept {
  const double lim = kPi * 0.5 - kViewPoleGuardRad;
  return std::clamp(el, -lim, lim);
}

}  // namespace

void orientationDirection(const ViewOrientation& o, double out[3]) noexcept {
  const double ce = std::cos(o.elevation);
  out[0] = ce * std::cos(o.azimuth);
  out[1] = ce * std::sin(o.azimuth);
  out[2] = std::sin(o.elevation);
}

ViewOrientation orientationForDirection(const double n[3]) noexcept {
  const double len = std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (!(len > 1e-12)) {
    // A zero direction names no view. Answering the isometric is honest and
    // recoverable; answering (0,0) would silently be a bottom-of-the-world view.
    return ViewOrientation{-kPi * 0.25, clampElevation(std::atan(1.0 / std::sqrt(2.0)))};
  }
  const double x = n[0] / len, y = n[1] / len, z = n[2] / len;
  ViewOrientation o;
  // atan2(0,0) is 0 by the C standard, which is the right answer for a straight
  // top or bottom view: the azimuth is arbitrary there and 0 is deterministic.
  o.azimuth = std::atan2(y, x);
  o.elevation = clampElevation(std::asin(std::clamp(z, -1.0, 1.0)));
  return o;
}

std::string zoneName(const ViewCubeZone& zone) {
  if (!zone.valid()) return "";
  std::string out;
  const auto part = [&out](const char* s) {
    if (!out.empty()) out += '-';
    out += s;
  };
  if (zone.sign[2] > 0) part("Top");
  if (zone.sign[2] < 0) part("Bottom");
  if (zone.sign[1] < 0) part("Front");
  if (zone.sign[1] > 0) part("Back");
  if (zone.sign[0] < 0) part("Left");
  if (zone.sign[0] > 0) part("Right");
  return out;
}

ViewOrientation orientationForZone(const ViewCubeZone& zone) noexcept {
  const double n[3] = {static_cast<double>(zone.sign[0]), static_cast<double>(zone.sign[1]),
                       static_cast<double>(zone.sign[2])};
  return orientationForDirection(n);
}

const std::vector<ViewCubeZone>& viewCubeZones() {
  static const std::vector<ViewCubeZone> zones = [] {
    std::vector<ViewCubeZone> v;
    for (int rank = 1; rank <= 3; ++rank) {
      for (int x = -1; x <= 1; ++x) {
        for (int y = -1; y <= 1; ++y) {
          for (int z = -1; z <= 1; ++z) {
            const ViewCubeZone zone{{x, y, z}};
            if (zone.rank() == rank) v.push_back(zone);
          }
        }
      }
    }
    return v;
  }();
  return zones;
}

const std::vector<StandardViewSpec>& standardViews() {
  static const std::vector<StandardViewSpec> specs = {
      // The eye sits along the named direction. Front is -Y, which is the
      // convention forge::desktop::Camera::setFront has always used.
      {StandardViewId::Front, "view.front", "Front", ViewCubeZone{{0, -1, 0}}},
      {StandardViewId::Back, "view.back", "Back", ViewCubeZone{{0, 1, 0}}},
      {StandardViewId::Left, "view.left", "Left", ViewCubeZone{{-1, 0, 0}}},
      {StandardViewId::Right, "view.right", "Right", ViewCubeZone{{1, 0, 0}}},
      {StandardViewId::Top, "view.top", "Top", ViewCubeZone{{0, 0, 1}}},
      {StandardViewId::Bottom, "view.bottom", "Bottom", ViewCubeZone{{0, 0, -1}}},
      // The isometric is the top-front-right CORNER, which is exactly what
      // azimuth -45 / elevation atan(1/sqrt2) is -- so the cube's corner and the
      // View menu's "Isometric" are one pose, derived once.
      {StandardViewId::Isometric, "view.iso", "Isometric", ViewCubeZone{{1, -1, 1}}},
  };
  return specs;
}

const StandardViewSpec* findStandardView(StandardViewId id) noexcept {
  for (const StandardViewSpec& s : standardViews()) {
    if (s.id == id) return &s;
  }
  return nullptr;
}

const StandardViewSpec* findStandardViewByCommand(const std::string& commandId) noexcept {
  for (const StandardViewSpec& s : standardViews()) {
    if (commandId == s.commandId) return &s;
  }
  return nullptr;
}

ViewOrientation orientationForStandardView(StandardViewId id) noexcept {
  const StandardViewSpec* s = findStandardView(id);
  if (s == nullptr) return ViewOrientation{};
  return orientationForZone(s->zone);
}

ViewCubeHit viewCubeHit(const float view[16], const ViewRect& cube, double mx, double my,
                        double faceBand) {
  ViewCubeHit out;
  if (!(cube.w > 0.0) || !(cube.h > 0.0)) return out;
  if (mx < cube.x || mx > cube.x + cube.w || my < cube.y || my > cube.y + cube.h) return out;

  // The camera basis, read out of the column-major view matrix: row 0 is the
  // RIGHT vector, row 1 UP, row 2 BACKWARD (the look-at matrix stores -forward).
  const double s[3] = {view[0], view[4], view[8]};
  const double u[3] = {view[1], view[5], view[9]};
  const double b[3] = {view[2], view[6], view[10]};

  // The cube is drawn orthographically, sized so a corner-on unit cube fits: the
  // longest diagonal of [-1,1]^3 seen edge-on is sqrt(3) half-extents, so the
  // half-extent of the rect maps to sqrt(3) cube units. Anything else clips the
  // corners off exactly when the corners are the zones being clicked.
  const double half = 0.5 * std::min(cube.w, cube.h);
  if (!(half > 0.0)) return out;
  const double scale = half / std::sqrt(3.0);
  const double a = (mx - cube.centreX()) / scale;
  // Screen y grows DOWNWARD; the camera's up vector grows upward.
  const double c = -(my - cube.centreY()) / scale;

  // A ray parallel to the view axis, starting well outside the cube.
  double origin[3];
  double dir[3];
  for (int i = 0; i < 3; ++i) {
    origin[i] = a * s[i] + c * u[i] + 8.0 * b[i];  // +backward = toward the eye
    dir[i] = -b[i];                                // travelling forward, into the cube
  }

  // Slab test against [-1,1]^3, keeping the ENTRY parameter.
  double lo = 0.0;
  double hi = 1.0e30;
  for (int i = 0; i < 3; ++i) {
    if (std::fabs(dir[i]) < 1e-12) {
      if (origin[i] < -1.0 || origin[i] > 1.0) return out;
      continue;
    }
    double t0 = (-1.0 - origin[i]) / dir[i];
    double t1 = (1.0 - origin[i]) / dir[i];
    if (t0 > t1) std::swap(t0, t1);
    lo = std::max(lo, t0);
    hi = std::min(hi, t1);
    if (lo > hi) return out;  // the cursor is in the rect but off the cube
  }

  double entry[3];
  for (int i = 0; i < 3; ++i) entry[i] = origin[i] + dir[i] * lo;

  const double band = std::clamp(faceBand, 0.05, 0.98);
  ViewCubeZone zone{};
  for (int i = 0; i < 3; ++i) {
    if (entry[i] >= band) {
      zone.sign[i] = 1;
    } else if (entry[i] <= -band) {
      zone.sign[i] = -1;
    } else {
      zone.sign[i] = 0;
    }
  }
  // Numerical grazing can leave every coordinate inside the band -- the ray
  // clipped a corner it barely touched. Snap to the axis it entered on rather
  // than answering an invalid zone: the entry face is the one whose coordinate
  // is at the boundary.
  if (!zone.valid()) {
    int axis = 0;
    double best = std::fabs(entry[0]);
    for (int i = 1; i < 3; ++i) {
      if (std::fabs(entry[i]) > best) {
        best = std::fabs(entry[i]);
        axis = i;
      }
    }
    zone.sign[axis] = entry[axis] >= 0.0 ? 1 : -1;
  }

  out.hit = true;
  out.zone = zone;
  out.entry[0] = entry[0];
  out.entry[1] = entry[1];
  out.entry[2] = entry[2];
  return out;
}

}  // namespace forge::ui
