#include "forge/ui/ViewStyle.hpp"

#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {

const char* toString(DisplayMode mode) noexcept {
  switch (mode) {
    case DisplayMode::Shaded:      return "shaded";
    case DisplayMode::ShadedEdges: return "shaded_edges";
    case DisplayMode::Wireframe:   return "wireframe";
    case DisplayMode::HiddenLine:  return "hidden_line";
    case DisplayMode::Transparent: return "transparent";
  }
  return "shaded";
}

bool displayModeFromString(const std::string& text, DisplayMode& out) noexcept {
  for (const DisplayModeSpec& s : displayModes()) {
    if (text == toString(s.mode)) {
      out = s.mode;
      return true;
    }
  }
  return false;
}

const std::vector<DisplayModeSpec>& displayModes() {
  static const std::vector<DisplayModeSpec> specs = {
      {DisplayMode::Shaded, "view.shaded", "Shaded"},
      {DisplayMode::ShadedEdges, "view.shaded_edges", "Shaded with Edges"},
      // view.wireframe is the id the shell has always registered and every input
      // profile's keymap already binds. It keeps that id: renaming a stable
      // command id would break every saved macro and every recorded shortcut,
      // which is what "STABLE. Never renamed" in CommandDescriptor means.
      {DisplayMode::Wireframe, "view.wireframe", "Wireframe"},
      {DisplayMode::HiddenLine, "view.hidden_line", "Hidden Line"},
      {DisplayMode::Transparent, "view.transparent", "Transparent"},
  };
  return specs;
}

const DisplayModeSpec* findDisplayMode(DisplayMode mode) noexcept {
  for (const DisplayModeSpec& s : displayModes()) {
    if (s.mode == mode) return &s;
  }
  return nullptr;
}

const DisplayModeSpec* findDisplayModeByCommand(const std::string& commandId) noexcept {
  for (const DisplayModeSpec& s : displayModes()) {
    if (commandId == s.commandId) return &s;
  }
  return nullptr;
}

SectionPlane axisSectionPlane(int axis, double offset) noexcept {
  SectionPlane p;
  p.enabled = true;
  p.normal[0] = p.normal[1] = p.normal[2] = 0.0;
  const int a = (axis >= 0 && axis <= 2) ? axis : 0;
  p.normal[a] = 1.0;
  p.offset = offset;
  return p;
}

double SectionOutline::length() const {
  double total = 0.0;
  for (std::size_t s = 0; s + 5 < segments.size(); s += 6) {
    const double dx = segments[s + 3] - segments[s];
    const double dy = segments[s + 4] - segments[s + 1];
    const double dz = segments[s + 5] - segments[s + 2];
    total += std::sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

SectionOutline sectionOutline(const MeasureMesh& mesh, const SectionPlane& plane) {
  SectionOutline out;
  if (!plane.enabled || !plane.valid() || mesh.empty()) return out;

  const std::vector<double>& xyz = mesh.coords();
  const std::size_t n = mesh.triangleCount();
  for (std::size_t t = 0; t < n; ++t) {
    const double* p = &xyz[t * 9];
    double d[3];
    int positive = 0;
    int negative = 0;
    for (int c = 0; c < 3; ++c) {
      d[c] = plane.signedDistance(p + static_cast<std::size_t>(c) * 3);
      if (d[c] > 0.0) ++positive;
      if (d[c] < 0.0) ++negative;
    }
    if (positive == 3) {
      ++out.removedTriangles;
      continue;
    }
    if (negative == 3) {
      ++out.keptTriangles;
      continue;
    }
    if (positive == 0 && negative == 0) {
      // The whole triangle lies IN the plane. It contributes no cut line of its
      // own: its edges are already the boundary of the triangles either side of
      // it, and emitting them here would double every segment of a coincident
      // face -- which turns length() into twice the truth.
      ++out.keptTriangles;
      continue;
    }

    // One segment per crossing triangle: collect the points where the plane
    // meets an edge (including vertices exactly on it), then join the two
    // extremes. Collecting rather than assuming two lets a triangle with a
    // vertex exactly on the plane behave.
    double pts[6];
    int np = 0;
    for (int e = 0; e < 3 && np < 2; ++e) {
      const int a = e;
      const int b = (e + 1) % 3;
      const double da = d[a];
      const double db = d[b];
      if (da == 0.0) {
        const double* v = p + static_cast<std::size_t>(a) * 3;
        // A vertex on the plane can be found twice (it is shared by two edges);
        // take it once.
        bool dup = false;
        for (int k = 0; k < np; ++k) {
          if (pts[k * 3] == v[0] && pts[k * 3 + 1] == v[1] && pts[k * 3 + 2] == v[2]) dup = true;
        }
        if (!dup) {
          pts[np * 3] = v[0];
          pts[np * 3 + 1] = v[1];
          pts[np * 3 + 2] = v[2];
          ++np;
        }
        continue;
      }
      if ((da < 0.0 && db > 0.0) || (da > 0.0 && db < 0.0)) {
        const double u = da / (da - db);
        const double* va = p + static_cast<std::size_t>(a) * 3;
        const double* vb = p + static_cast<std::size_t>(b) * 3;
        for (int i = 0; i < 3; ++i) pts[np * 3 + i] = va[i] + (vb[i] - va[i]) * u;
        ++np;
      }
    }
    if (np != 2) {
      // A single touching vertex is not a cut through this triangle.
      ++out.keptTriangles;
      continue;
    }
    ++out.cutTriangles;
    for (int i = 0; i < 6; ++i) out.segments.push_back(pts[i]);
    out.box.grow(pts);
    out.box.grow(pts + 3);
  }
  return out;
}

std::vector<bool> sectionTriangleMask(const MeasureMesh& mesh, const SectionPlane& plane,
                                      std::size_t& straddling) {
  straddling = 0;
  const std::size_t n = mesh.triangleCount();
  std::vector<bool> keep(n, true);
  if (!plane.enabled || !plane.valid()) return keep;

  const std::vector<double>& xyz = mesh.coords();
  for (std::size_t t = 0; t < n; ++t) {
    const double* p = &xyz[t * 9];
    int positive = 0;
    for (int c = 0; c < 3; ++c) {
      if (plane.signedDistance(p + static_cast<std::size_t>(c) * 3) > 0.0) ++positive;
    }
    if (positive == 3) {
      keep[t] = false;
      continue;
    }
    if (positive != 0) ++straddling;
  }
  return keep;
}

}  // namespace forge::ui
