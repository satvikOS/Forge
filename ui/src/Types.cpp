#include "forge/ui/Types.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>

namespace forge::ui {

const char* toString(EntityKind kind) noexcept {
  switch (kind) {
    case EntityKind::None:        return "none";
    case EntityKind::Vertex:      return "vertex";
    case EntityKind::Edge:        return "edge";
    case EntityKind::Face:        return "face";
    case EntityKind::Body:        return "body";
    case EntityKind::Sketch:      return "sketch";
    case EntityKind::SketchCurve: return "sketch_curve";
    case EntityKind::Wire:        return "wire";
    case EntityKind::Surface:     return "surface";
    case EntityKind::Feature:     return "feature";
    case EntityKind::Component:   return "component";
    case EntityKind::Datum:       return "datum";
    case EntityKind::Any:         return "any";
  }
  return "none";
}

const char* toString(NamedView view) noexcept {
  switch (view) {
    case NamedView::Front:     return "Front";
    case NamedView::Back:      return "Back";
    case NamedView::Left:      return "Left";
    case NamedView::Right:     return "Right";
    case NamedView::Top:       return "Top";
    case NamedView::Bottom:    return "Bottom";
    case NamedView::Isometric: return "Isometric";
  }
  return "Front";
}

const char* commandSuffix(NamedView view) noexcept {
  switch (view) {
    case NamedView::Front:     return "front";
    case NamedView::Back:      return "back";
    case NamedView::Left:      return "left";
    case NamedView::Right:     return "right";
    case NamedView::Top:       return "top";
    case NamedView::Bottom:    return "bottom";
    case NamedView::Isometric: return "iso";
  }
  return "front";
}

bool namedViewFromSuffix(const std::string& suffix, NamedView& out) noexcept {
  for (std::size_t i = 0; i < kNamedViewCount; ++i) {
    const auto v = static_cast<NamedView>(i);
    if (suffix == commandSuffix(v)) {
      out = v;
      return true;
    }
  }
  return false;
}

std::string EntityRef::key() const {
  std::string k;
  k.reserve(bodyId.size() + persistentName.size() + 16);
  k += bodyId;
  k += '/';
  k += toString(kind);
  k += '/';
  k += persistentName;
  return k;
}

bool operator==(const EntityRef& a, const EntityRef& b) noexcept {
  return a.bodyId == b.bodyId && a.kind == b.kind && a.persistentName == b.persistentName;
}

bool operator!=(const EntityRef& a, const EntityRef& b) noexcept { return !(a == b); }

namespace {
// Dock geometry is authored in whole pixels but round-trips through decimal
// text, so compare with a tolerance far below one pixel.
constexpr double kGeomEps = 1e-6;
bool near(double a, double b) noexcept { return std::fabs(a - b) <= kGeomEps; }
}  // namespace

bool Rect::contains(const Rect& r) const noexcept {
  return r.x >= x - kGeomEps && r.y >= y - kGeomEps && r.right() <= right() + kGeomEps &&
         r.bottom() <= bottom() + kGeomEps;
}

bool operator==(const Rect& a, const Rect& b) noexcept {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
}

bool operator!=(const Rect& a, const Rect& b) noexcept { return !(a == b); }

}  // namespace forge::ui
