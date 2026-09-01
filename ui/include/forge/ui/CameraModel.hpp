// ui/include/forge/ui/CameraModel.hpp
//
// THE VIEWPORT CAMERA, headless — the turntable, the standard views, and the
// two framing verbs a CAD viewport is judged on: ZOOM TO FIT and ZOOM TO
// SELECTION.
//
// ── why this file exists, when forge::desktop::Camera already did ──────────
// The camera math was written THREE times in this tree and NOT ONE copy could
// be asserted by a cheap gate:
//
//   forge-desktop/src/Camera.cpp   the real one, in a translation unit that
//                                  links SDL2 and Vulkan, so measuring it means
//                                  building the whole desktop app.
//   ui/test/manipulator_test.cpp   a hand-copied `RefCamera` whose own comment
//                                  admits it is spelled out "rather than linked
//                                  because forge-desktop is not compiled by
//                                  this gate".
//   forge-desktop/src/ForgeFrame   the fit arithmetic, inline at its call site.
//
// A convention duplicated three ways is a convention that drifts, and the drift
// is invisible: if the gizmo's inverse disagrees with the renderer's matrix by
// a sign, the app draws a handle where the hit test does not look. So the math
// lands HERE, once, in headless forge::ui — no ImGui, no Vulkan, no OCCT — and
// the desktop camera becomes a thin float-facing shim over it.
//
// The conventions are forge::desktop::Camera's, reproduced EXACTLY and not
// re-derived, because changing them would move every pixel the renderer draws:
//
//   * Z-UP TURNTABLE. eye = target + d*(cos E cos A, cos E sin A, sin E), with
//     elevation clamped short of the poles so the up vector never degenerates.
//     Mechanical CAD orbits about a target with a world up; free-flight loses
//     "up" and is disorienting on a part.
//   * Column-major look-at (the gluLookAt matrix), world up +Z.
//   * VULKAN clip space: depth in [0,1] and the Y row NEGATED. Getting this
//     wrong renders the model upside down.
//   * Pixels are measured from the viewport's TOP-LEFT.
//
// ── what is new here, and why it is not decoration ─────────────────────────
// ZOOM TO SELECTION is the verb that makes a viewport feel like CAD. `view.fit`
// frames the whole body, which on a 430-face part means the chamfer you are
// working on is four pixels wide. Framing the SELECTION is how you actually
// work, and it is why this file needs the pick engine's types: a selection is a
// set of EntityRefs, and turning those back into a bounding box means resolving
// face ids against the triangle soup, edge keys against the EdgeSet and vertex
// keys against the VertexSet. That resolution is the whole content of the
// feature and it belongs beside the pick engine that produced the refs.
//
// The standard-view set is completed at the same time. forge::desktop::Camera
// had Front, Top, Right and Isometric; BACK, BOTTOM and LEFT were simply
// missing, so half of the standard view cube was unreachable from anywhere.
#ifndef FORGE_UI_CAMERAMODEL_HPP
#define FORGE_UI_CAMERAMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PickModel.hpp"
#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── resolving a selection back to geometry ──────────────────────────────────
// The persistent name a Face ref carries is "face@<id>". Returns false if the
// string is not that shape, so a malformed ref is refused rather than resolved
// to face 0.
bool faceIdFromKey(const std::string& persistentName, std::uint32_t& out) noexcept;

// Grow `box` by every triangle of `faceId`. Returns the triangle count found;
// zero means the face id is not in this mesh and `box` is untouched.
std::size_t growByFace(const MeasureMesh& mesh, std::uint32_t faceId, MeasureBox& box) noexcept;

// What a framing request could and could not resolve. The census is reported
// rather than hidden behind the box's `valid` flag, because "I framed 3 of your
// 5 selected entities" and "I framed all 5" are different answers and the
// status line should be able to say which.
struct FramingBounds {
  MeasureBox box{};
  std::size_t resolved = 0;    // refs that contributed to the box
  std::size_t unresolved = 0;  // refs whose geometry this scene does not carry

  bool usable() const noexcept { return box.valid && resolved > 0; }
};

// The bounds of the WHOLE scene — what `view.fit` frames.
FramingBounds sceneBounds(const PickScene& scene);

// The bounds of a selection — what `view.selection` frames. Refs of any kind
// are accepted: a Face resolves through the triangle soup, an Edge through the
// EdgeSet, a Vertex through the VertexSet, and a Body through the whole mesh.
// A ref naming a body other than the scene's is counted unresolved rather than
// silently framed, because framing the wrong body is worse than refusing.
FramingBounds selectionBounds(const PickScene& scene, const std::vector<EntityRef>& refs);

// ── the standard-view angles, in ONE place ──────────────────────────────────
// Exposed as a free function rather than only as a CameraModel method because
// forge::desktop::Camera is float-facing and needs the same seven answers. Two
// tables of view angles is two tables that drift, and the drift shows up as a
// button labelled "Top" that does not look down.
void namedViewAngles(NamedView view, double& azimuthRad, double& elevationRad) noexcept;

// ── the camera ──────────────────────────────────────────────────────────────
class CameraModel {
 public:
  // ── framing ───────────────────────────────────────────────────────────────
  // Frames a sphere so the whole of it is inside the vertical field of view
  // with a 15% margin, applying the margin horizontally too when the viewport
  // is narrower than it is tall.
  void frame(const double centre[3], double radius) noexcept;
  // Frames a box: the target becomes its centre and the radius its half
  // diagonal. Returns false and MOVES NOTHING on an unusable box — a fit that
  // silently jumps to the origin on an empty selection is the bug that makes a
  // user think the part vanished.
  bool frameBounds(const FramingBounds& bounds) noexcept;

  // ── navigation ────────────────────────────────────────────────────────────
  void orbit(double dAzimuthRad, double dElevationRad) noexcept;
  // Screen-space pan: dx/dy in pixels, converted at the target's depth so the
  // point under the cursor stays under the cursor.
  void pan(double dxPixels, double dyPixels, double viewportHeight) noexcept;
  // Multiplicative dolly, 1.1 per notch; positive `steps` moves toward target.
  void zoom(double steps) noexcept;

  // ── orientation ───────────────────────────────────────────────────────────
  void setNamedView(NamedView view) noexcept;
  // Look STRAIGHT AT a face: place the eye along +normal from the target. This
  // is "normal to" in every CAD system and the natural follow-up to picking a
  // face. Returns false on a degenerate (near-zero) normal, which is what
  // measureFace reports for a face whose triangles cancel.
  bool viewNormalTo(const double normal[3]) noexcept;

  // ── state ─────────────────────────────────────────────────────────────────
  void setTarget(const double t[3]) noexcept;
  void setAspect(double aspect) noexcept;
  void setFovY(double radians) noexcept;
  void setDistance(double d) noexcept;

  double aspect() const noexcept { return aspect_; }
  double distance() const noexcept { return distance_; }
  double fovY() const noexcept { return fovY_; }
  double azimuth() const noexcept { return azimuth_; }
  double elevation() const noexcept { return elevation_; }
  double nearPlane() const noexcept { return near_; }
  double farPlane() const noexcept { return far_; }
  const double* target() const noexcept { return target_; }

  void eye(double out[3]) const noexcept;

  // ── matrices, column-major, GLSL `mat4` layout ────────────────────────────
  void view(double out[16]) const noexcept;
  void proj(double out[16]) const noexcept;
  void viewProj(double out[16]) const noexcept;

  // A picking ray through a viewport pixel measured from the TOP-LEFT. The
  // direction is normalized.
  void ray(double x, double y, double width, double height, double origin[3],
           double direction[3]) const noexcept;

  // World units per pixel at the TARGET plane — what a pixel pick tolerance has
  // to be multiplied by. Defers to worldPerPixel() in PickModel so there is one
  // formula, not two.
  double worldPerPixelAtTarget(double viewportHeight) const noexcept;

 private:
  void clampPlanes() noexcept;

  double target_[3] = {0.0, 0.0, 0.0};
  double distance_ = 200.0;
  double azimuth_ = -0.9;    // radians about world Z
  double elevation_ = 0.55;  // radians above the XY plane
  double aspect_ = 1.6;
  double fovY_ = 0.7853981633974483;  // 45 degrees
  double near_ = 0.1;
  double far_ = 10000.0;
};

// The pole guard, exported because the Top and Bottom views sit exactly on it
// and a test asserting "top looks straight down" has to know the tolerance is
// deliberate rather than sloppy.
inline constexpr double kCameraPoleGuard = 0.02;

}  // namespace forge::ui

#endif  // FORGE_UI_CAMERAMODEL_HPP
