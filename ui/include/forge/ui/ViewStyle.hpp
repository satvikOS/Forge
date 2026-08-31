// ui/include/forge/ui/ViewStyle.hpp
//
// DISPLAY MODES AND THE SECTION PLANE — what the viewport draws, as data.
//
// ── the gap this closes ─────────────────────────────────────────────────────
// The whole of the app's display state was ONE BOOLEAN: `DocumentStats::wireframe`,
// toggled by `view.wireframe` and carried to the renderer as
// `ViewportRequest::wireframe`. Two states is not a CAD display model. Shaded and
// shaded-with-edges are different answers to "where does this face end"; a
// hidden-line view is what a drawing is checked in; transparent is how an
// internal boss is found; and a SECTION is the only way to see a bore's wall
// thickness at all. On the 329-430-face parts this app targets, "shaded or
// wireframe" leaves the inside of the model permanently unreachable.
//
// ── a section is not a mode, and that is the point ──────────────────────────
// It is a plane that applies TO whichever mode is active: sectioned wireframe
// and sectioned shaded are both real and both used. So `ViewStyle` carries a
// mode AND a plane, and every consumer reads the pair.
//
// ── the cut is COMPUTED, not faked by clipping ──────────────────────────────
// Hiding the triangles on one side of a plane leaves the solid looking hollow --
// you see the inside of the far wall through an open shell, which is exactly the
// picture a section is meant to replace. What makes it read as a cut is the
// OUTLINE: the polyline where the plane meets the surface. sectionOutline()
// computes it exactly, triangle by triangle, so the app draws a real cut line
// rather than a shaded lie. It is arithmetic over the same triangle soup
// MeasureModel and EdgeModel consume, so it is asserted headless.
#ifndef FORGE_UI_VIEWSTYLE_HPP
#define FORGE_UI_VIEWSTYLE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {

enum class DisplayMode : std::uint8_t {
  Shaded = 0,       // faces only
  ShadedEdges,      // faces plus the B-rep edges over them -- the CAD default
  Wireframe,        // edges only, every one of them
  HiddenLine,       // edges only, with the ones behind a face removed
  Transparent,      // faces at reduced opacity, edges kept
};

const char* toString(DisplayMode mode) noexcept;
// Parses the spelling toString() produces. Returns false and leaves `out` alone
// on anything else -- a saved workspace naming a mode this build does not have
// must not silently become Shaded.
bool displayModeFromString(const std::string& text, DisplayMode& out) noexcept;

struct DisplayModeSpec {
  DisplayMode mode = DisplayMode::Shaded;
  const char* commandId = "";
  const char* label = "";
};

// Every mode, with the registry id that selects it. One table: the View menu,
// the keymap and the status strip all read it, so they cannot offer different
// sets.
const std::vector<DisplayModeSpec>& displayModes();
const DisplayModeSpec* findDisplayMode(DisplayMode mode) noexcept;
const DisplayModeSpec* findDisplayModeByCommand(const std::string& commandId) noexcept;

// ── the section plane ───────────────────────────────────────────────────────
// Half-space form: the material KEPT is where dot(normal, p) <= offset. Flipping
// is a real control (you cut from the other side), and it is spelled by negating
// both, so there is one representation and not a flag the maths has to remember.
struct SectionPlane {
  bool enabled = false;
  double normal[3] = {1.0, 0.0, 0.0};
  double offset = 0.0;

  // Signed distance in units of |normal|; negative is kept, positive is cut.
  double signedDistance(const double p[3]) const noexcept {
    return normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - offset;
  }
  // Is this point on the KEPT side? Always true when the plane is off, so a
  // caller never has to branch on `enabled` before asking.
  bool keeps(const double p[3]) const noexcept { return !enabled || signedDistance(p) <= 0.0; }
  void flip() noexcept {
    normal[0] = -normal[0];
    normal[1] = -normal[1];
    normal[2] = -normal[2];
    offset = -offset;
  }
  bool valid() const noexcept {
    return normal[0] != 0.0 || normal[1] != 0.0 || normal[2] != 0.0;
  }
};

// The three principal planes a section starts from, by the axis of the normal.
SectionPlane axisSectionPlane(int axis, double offset) noexcept;

struct ViewStyle {
  DisplayMode mode = DisplayMode::ShadedEdges;
  SectionPlane section{};

  bool drawsFaces() const noexcept {
    return mode != DisplayMode::Wireframe && mode != DisplayMode::HiddenLine;
  }
  bool drawsEdges() const noexcept { return mode != DisplayMode::Shaded; }
  // Hidden-line removal is exactly "draw the edges, and let the depth buffer of
  // the (invisible) faces occlude them", which is why this is a separate
  // question from drawsFaces(): the faces are rasterized to DEPTH ONLY.
  bool depthOnlyFaces() const noexcept { return mode == DisplayMode::HiddenLine; }
  float faceOpacity() const noexcept { return mode == DisplayMode::Transparent ? 0.35f : 1.0f; }
};

// ── the cut ─────────────────────────────────────────────────────────────────
struct SectionOutline {
  // Six doubles per segment: ax ay az bx by bz. The polyline the viewport
  // strokes to make the cut read as a cut.
  std::vector<double> segments;
  std::size_t cutTriangles = 0;      // triangles the plane actually crosses
  std::size_t removedTriangles = 0;  // entirely on the cut-away side
  std::size_t keptTriangles = 0;     // entirely on the kept side
  MeasureBox box{};                  // bounds of the cut itself

  std::size_t segmentCount() const noexcept { return segments.size() / 6; }
  double length() const;  // total cut-line length, a number a gate can assert
};

// Exact per-triangle plane intersection. A triangle with one vertex on each side
// yields one segment; a triangle lying IN the plane yields none (its three edges
// are already the outline of its neighbours, and emitting it would double every
// coincident face). Deterministic: segments come out in triangle order.
SectionOutline sectionOutline(const MeasureMesh& mesh, const SectionPlane& plane);

// Which triangles survive the cut, as a per-triangle flag the renderer can use
// to build a clipped vertex stream without re-tessellating. `true` means DRAW.
// A triangle straddling the plane is kept: clipping it exactly would change the
// vertex count, and the fragment-level discard the renderer already does handles
// the sliver. The count of straddlers is reported so nothing is silent.
std::vector<bool> sectionTriangleMask(const MeasureMesh& mesh, const SectionPlane& plane,
                                      std::size_t& straddling);

}  // namespace forge::ui

#endif  // FORGE_UI_VIEWSTYLE_HPP
