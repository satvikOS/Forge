// ui/include/forge/ui/Manipulator.hpp
//
// THE DRAG HANDLES — the translate arrows and rotate rings a user grabs in the
// viewport, and the TRANSLATE / ROTATE statements they emit on release.
//
// ── what this closes ───────────────────────────────────────────────────────
// `part.move` (TRANSLATE) and `part.rotate` (ROTATE) exist in the registry and
// both declare SelectionSignature::exactly(EntityKind::Body, 1). Until the pick
// engine grew a Body answer, nothing in the application could produce a Body
// reference, so both commands were permanently greyed out — and the ONLY other
// way to reach them was to type numbers into a parameter field. A CAD system
// does not ask you to type a distance to move a part. It gives you a handle.
//
// ── the drag math is WORLD-SPACE, not screen-space, and that is the point ───
// A gizmo that converts screen pixels to world units through a scale factor
// drifts away from the cursor as the part rotates, because the scale factor is
// only correct for a segment perpendicular to the view. This one inverts the
// SAME view-projection matrix the renderer uploads, turns the pixel into a
// world ray, and solves exactly:
//
//   TRANSLATE — the point on the axis LINE closest to the pick ray. The handle
//               stays under the cursor because the arithmetic says it does.
//   ROTATE    — the intersection of the pick ray with the PLANE through the
//               pivot normal to the axis, and the signed angle about that axis
//               from where the drag started.
//
// Both refuse rather than guess when the geometry is ill-conditioned: an axis
// seen end-on has no usable screen extent, and a rotation plane seen edge-on has
// no usable intersection. `begin()` returns false and no drag starts.
//
// ── live preview, and emission ON RELEASE ──────────────────────────────────
// While the drag is in flight the caller reads translation() / rotationDegrees()
// / previewOffset() and draws a ghost. NOTHING is dispatched until release(),
// which hands back the command id and the parameters — one statement in the
// history per gesture, not one per mouse-move. A drag that moved nothing emits
// nothing: part.move and part.rotate both refuse a zero, and recording a no-op
// statement in a feature tree is worse than recording none.
//
// Nothing here includes ImGui, OCCT or a forge-kernel header.
#ifndef FORGE_UI_MANIPULATOR_HPP
#define FORGE_UI_MANIPULATOR_HPP

#include <cstddef>
#include <cstdint>
#include <string>

#include "forge/ui/CommandRegistry.hpp"

namespace forge::ui {

// ── the camera, as plain data ──────────────────────────────────────────────
// forge::ui owns no camera. It owns the ONE matrix the renderer already
// uploads (forge::desktop::Camera::viewProj) plus the viewport rectangle, and
// derives everything from that — so there is no second projection to drift out
// of step with what is drawn on screen.
class ViewportProjection {
 public:
  ViewportProjection() noexcept;

  // `viewProj` is column-major, the layout GLSL `mat4` expects and the layout
  // Camera::viewProj() writes. Returns false (and leaves the object invalid) if
  // the matrix does not invert, which is what a degenerate camera produces.
  bool set(const float viewProj[16], double x, double y, double width, double height) noexcept;
  bool valid() const noexcept { return valid_; }

  double x() const noexcept { return x_; }
  double y() const noexcept { return y_; }
  double width() const noexcept { return width_; }
  double height() const noexcept { return height_; }

  // World -> pixel, in the SAME screen coordinates the viewport rectangle is
  // given in. Returns false when the point is at or behind the eye plane, which
  // a caller must treat as "not drawable" rather than clamping — a divide
  // through a negative w is the classic wrong-side smear.
  bool project(const double world[3], double out[2]) const noexcept;

  // Pixel -> world ray. `direction` comes back unit length. Returns false when
  // the projection is invalid or the two unprojected depths coincide.
  bool ray(double px, double py, double origin[3], double direction[3]) const noexcept;

 private:
  bool valid_ = false;
  double x_ = 0.0, y_ = 0.0, width_ = 1.0, height_ = 1.0;
  double m_[16] = {0.0};    // the view-projection, row-indexed as m_[col*4+row]
  double inv_[16] = {0.0};  // its inverse, same layout
};

// Invert a column-major 4x4. Exposed because the gizmo is not the only thing
// that will need it and a second copy of a matrix inverse is a second place for
// a transposition to hide.
bool invert4x4(const double m[16], double out[16]) noexcept;

// ── the gizmo ──────────────────────────────────────────────────────────────
enum class ManipulatorMode : std::uint8_t { Off = 0, Translate, Rotate };
enum class HandleAxis : std::uint8_t { None = 0, X, Y, Z };

const char* toString(ManipulatorMode mode) noexcept;
const char* toString(HandleAxis axis) noexcept;

struct ManipulatorHandle {
  ManipulatorMode mode = ManipulatorMode::Off;
  HandleAxis axis = HandleAxis::None;

  bool valid() const noexcept {
    return mode != ManipulatorMode::Off && axis != HandleAxis::None;
  }
};

bool operator==(const ManipulatorHandle& a, const ManipulatorHandle& b) noexcept;
bool operator!=(const ManipulatorHandle& a, const ManipulatorHandle& b) noexcept;

// What a finished drag asks the ONE registry to do. It is a command id and a
// parameter set, never a document edit: the gizmo dispatches nothing itself, so
// a drag lands in the same journal as the menu item and the Archie tool call.
struct ManipulatorEmission {
  bool valid = false;
  std::string commandId;  // "part.move" or "part.rotate"
  CommandParams params;
  std::string summary;  // one line for the status strip / journal
};

// How many segments a rotate ring is drawn and hit-tested with. The DRAW and the
// HIT TEST must use the same number or the ring is grabbable somewhere it is not
// drawn, which is the classic gizmo defect.
inline constexpr int kManipulatorRingSegments = 48;

class Manipulator {
 public:
  void setMode(ManipulatorMode mode) noexcept;
  ManipulatorMode mode() const noexcept { return mode_; }

  void setPivot(const double p[3]) noexcept;
  const double* pivot() const noexcept { return pivot_; }

  // The arm length / ring radius in WORLD units. A caller sizes it from the
  // selection's bounding box so the gizmo is proportionate to what it moves.
  void setSize(double worldRadius) noexcept;
  double size() const noexcept { return size_; }

  // Snap increments. Zero on either disables that snap. Applied to the RESULT,
  // not to the cursor, so the handle keeps tracking smoothly while the emitted
  // value lands on the grid.
  void setSnap(double translateStep, double rotateStepDegrees) noexcept;
  double translateSnap() const noexcept { return translateSnap_; }
  double rotateSnap() const noexcept { return rotateSnap_; }

  // ── the drawable geometry, which IS the hit-tested geometry ─────────────
  static void axisVector(HandleAxis axis, double out[3]) noexcept;
  // Tip of the translate arrow for `axis`.
  bool axisTip(HandleAxis axis, double out[3]) const noexcept;
  // Point `i` of `kManipulatorRingSegments` on the rotate ring for `axis`.
  bool ringPoint(HandleAxis axis, int i, double out[3]) const noexcept;

  // ── hover ───────────────────────────────────────────────────────────────
  // Which handle the pixel is over, or an invalid handle. Ties break X, then Y,
  // then Z, so the answer does not depend on iteration order.
  ManipulatorHandle hitTest(const ViewportProjection& view, double px, double py,
                            double pixelTolerance) const noexcept;
  void setHover(const ManipulatorHandle& handle) noexcept { hover_ = handle; }
  const ManipulatorHandle& hover() const noexcept { return hover_; }
  void clearHover() noexcept { hover_ = ManipulatorHandle{}; }

  // ── the drag ────────────────────────────────────────────────────────────
  // Returns false, and starts nothing, when the handle is invalid, the mode
  // disagrees, the projection is unusable, or the geometry is ill-conditioned
  // (an axis seen end-on, a ring seen edge-on).
  bool begin(const ViewportProjection& view, const ManipulatorHandle& handle, double px,
             double py) noexcept;
  bool dragTo(const ViewportProjection& view, double px, double py) noexcept;
  bool dragging() const noexcept { return dragging_; }
  const ManipulatorHandle& active() const noexcept { return active_; }

  // ── live preview ────────────────────────────────────────────────────────
  double translation() const noexcept { return translation_; }      // world units, signed
  double rotationDegrees() const noexcept { return rotation_; }      // right-handed, signed
  void previewOffset(double out[3]) const noexcept;                  // axis * translation

  // ── the emission ────────────────────────────────────────────────────────
  // Ends the drag and reports what to dispatch. `valid` is false when the drag
  // moved nothing: part.move and part.rotate both refuse a zero, and a no-op
  // statement in a feature tree is worse than no statement.
  ManipulatorEmission release() noexcept;
  void cancel() noexcept;

  // How many drags this gizmo has actually completed with an emission. The
  // claim "dragging a handle edits the document" is only meaningful if
  // something counts it.
  std::size_t emissions() const noexcept { return emissions_; }

 private:
  bool axisFrame(HandleAxis axis, double out[3]) const noexcept;

  ManipulatorMode mode_ = ManipulatorMode::Off;
  double pivot_[3] = {0.0, 0.0, 0.0};
  double size_ = 1.0;
  double translateSnap_ = 0.0;
  double rotateSnap_ = 0.0;

  ManipulatorHandle hover_;
  ManipulatorHandle active_;
  bool dragging_ = false;
  double grabParam_ = 0.0;      // translate: axis parameter at grab
  double grabVector_[3] = {0.0, 0.0, 0.0};  // rotate: in-plane vector at grab
  double translation_ = 0.0;
  double rotation_ = 0.0;
  std::size_t emissions_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_MANIPULATOR_HPP
