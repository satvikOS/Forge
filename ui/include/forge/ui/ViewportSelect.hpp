// ui/include/forge/ui/ViewportSelect.hpp
//
// SCREEN-SPACE SELECTION — projection, box select, lasso select, and the bounds
// a "zoom to selection" frames.
//
// ── ONE projection, and why that matters ────────────────────────────────────
// Three places in the app project a world point onto the viewport: the edge
// overlay strokes a polyline, the manipulator hit-tests its handles, and a box
// select decides what is inside the rubber band. Before this file each would
// have carried its own copy of the same eight multiplies and the same Vulkan
// Y-convention, and the frame gate's mutation 5 -- "the projection loses its
// Vulkan Y-flip" -- exists precisely because that convention has been got wrong
// here before. One projectPoint(), asserted headless, is the fix.
//
// ── WINDOW vs CROSSING, which is not a preference ───────────────────────────
// Every mechanical CAD system and every drafting tool distinguishes them, and
// users navigate by the distinction rather than by a menu:
//   WINDOW   (drag left -> right)  selects only what is ENTIRELY inside the box.
//   CROSSING (drag right -> left)  selects anything the box TOUCHES.
// Shipping only one of them is the difference between "select that whole boss"
// and "select every face this band clips", and no amount of clicking recovers
// the other. Both are here, and the drag DIRECTION picks between them, which is
// the convention AutoCAD established and NX, Creo and SolidWorks all kept.
//
// Nothing here includes ImGui, OCCT, Vulkan or a forge-kernel header. The caller
// supplies the column-major view-projection matrix its camera already computes.
#ifndef FORGE_UI_VIEWPORTSELECT_HPP
#define FORGE_UI_VIEWPORTSELECT_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ViewportPick.hpp"

namespace forge::ui {

// The viewport's rectangle on screen, in the same units the caller's mouse
// position is in (points, or framebuffer pixels -- one or the other, both).
struct ViewRect {
  double x = 0.0, y = 0.0, w = 1.0, h = 1.0;
  double centreX() const noexcept { return x + 0.5 * w; }
  double centreY() const noexcept { return y + 0.5 * h; }
};

// A projected point. `visible` is false when the point is at or behind the eye
// plane, where the perspective divide is meaningless -- a projected point with a
// negative w smeared across the screen is the classic wrong-side artefact, and
// the flag is what lets a caller DROP the segment rather than draw it.
struct ScreenPoint {
  double x = 0.0, y = 0.0;
  double depth = 0.0;  // clip-space w: distance along the view axis
  bool visible = false;
};

// Column-major 4x4, the layout GLSL `mat4` and forge::desktop::Camera::viewProj
// both use. Y is measured DOWNWARD from the rect's top edge, matching the
// Vulkan NDC the projection already carries and matching ImGui's screen space.
ScreenPoint projectPoint(const float viewProj[16], const ViewRect& view, const double p[3]);

// ── the rubber band ─────────────────────────────────────────────────────────
struct ScreenBox {
  double x0 = 0.0, y0 = 0.0, x1 = 0.0, y1 = 0.0;

  // The drag as the user made it: (x0,y0) is where the button went down.
  double minX() const noexcept { return x0 < x1 ? x0 : x1; }
  double maxX() const noexcept { return x0 < x1 ? x1 : x0; }
  double minY() const noexcept { return y0 < y1 ? y0 : y1; }
  double maxY() const noexcept { return y0 < y1 ? y1 : y0; }
  double width() const noexcept { return maxX() - minX(); }
  double height() const noexcept { return maxY() - minY(); }
  bool contains(double px, double py) const noexcept {
    return px >= minX() && px <= maxX() && py >= minY() && py <= maxY();
  }
  bool empty() const noexcept { return width() <= 0.0 && height() <= 0.0; }
};

enum class RegionMode : std::uint8_t {
  Window,    // entirely inside
  Crossing,  // touched at all
};

// The AutoCAD/NX/Creo convention: dragging RIGHT is a window, dragging LEFT is a
// crossing. Exposed as a function rather than inlined at the call site so the
// viewport and any gate agree on which drag means which.
RegionMode regionModeForDrag(const ScreenBox& box) noexcept;

// What a region select found, plus the work it did. `trianglesTested` is
// reported because a count is not a cost but an unreported cost is worse: a
// caller can see the region select is linear in the mesh and choose when to run
// it (on RELEASE, not on every mouse-move).
struct RegionSelection {
  std::vector<std::uint32_t> faces;  // sorted, distinct, 1-based face ids
  std::size_t trianglesTested = 0;
  std::size_t trianglesInside = 0;
  std::size_t behindEye = 0;  // triangles dropped because a corner was behind the eye
};

// WINDOW keeps a face only when EVERY one of its triangles is entirely inside;
// CROSSING keeps it when any triangle touches. Both are decided per FACE and not
// per triangle, because the selection's unit is the B-rep face -- a window that
// selected "part of face 7" would produce a ref no command can consume.
RegionSelection boxSelectFaces(const MeasureMesh& mesh, const float viewProj[16],
                               const ViewRect& view, const ScreenBox& box, RegionMode mode);

// The lasso. `polygon` is x,y pairs in screen space, at least 3 points; the ring
// is closed implicitly. WINDOW/CROSSING mean the same thing they do for a box.
// A self-intersecting lasso is answered by the EVEN-ODD rule, which is what a
// freehand loop crossing itself means to a user drawing it.
RegionSelection lassoSelectFaces(const MeasureMesh& mesh, const float viewProj[16],
                                 const ViewRect& view, const std::vector<double>& polygon,
                                 RegionMode mode);

// The same two questions for the recovered edges and corners. An edge is inside
// a WINDOW when every one of its segment endpoints is; a corner is a point, so
// the two modes coincide for vertices and only one function is offered.
std::vector<std::size_t> boxSelectEdges(const EdgeSet& set, const float viewProj[16],
                                        const ViewRect& view, const ScreenBox& box,
                                        RegionMode mode);
std::vector<std::size_t> boxSelectVertices(const VertexSet& set, const float viewProj[16],
                                           const ViewRect& view, const ScreenBox& box);

// ── what a "zoom to selection" frames ───────────────────────────────────────
// A camera frames a SPHERE (centre + radius), which is what Camera::frame takes.
// These give it one, from whichever kind the selection actually holds. An empty
// or unresolvable selection returns an invalid box, and the caller must then
// leave the camera alone rather than fly to the origin -- "zoom to selection"
// with nothing selected must do nothing, not lose the part off-screen.
MeasureBox faceBounds(const MeasureMesh& mesh, const std::vector<std::uint32_t>& faceIds);
MeasureBox edgeBounds(const EdgeSet& set, const std::vector<std::size_t>& indices);
MeasureBox vertexBounds(const VertexSet& set, const std::vector<std::size_t>& indices);

// Centre and radius of a box's bounding sphere. `radius` is half the diagonal,
// and never zero for a valid box: framing a single planar face or one corner
// must still give the camera a distance it can use, so a degenerate box falls
// back to `minRadius`.
void boundsSphere(const MeasureBox& box, double centre[3], double& radius,
                  double minRadius = 1.0);

}  // namespace forge::ui

#endif  // FORGE_UI_VIEWPORTSELECT_HPP
