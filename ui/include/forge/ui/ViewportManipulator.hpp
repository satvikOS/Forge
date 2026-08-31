// ui/include/forge/ui/ViewportManipulator.hpp
//
// THE DRAG HANDLE — a translate gizmo and a rotate gizmo that emit ONE line of
// feature-IR when the mouse comes up, and show the move live while it is down.
//
// ── why this is a state machine and not a callback ──────────────────────────
// The defect class this application has shipped three times is MUTATING A
// CONTAINER WHILE THE FRAME WALK IS ITERATING IT: a tab click re-seated the dock
// tree under the recursion holding references into it, a splitter drag did the
// same, and a tree expander resized the row vector inside the clipper's loop.
// A drag handle is the fourth gesture of exactly that shape -- it appends a
// feature to the document, which rebuilds the tessellation, which invalidates
// every mesh reference the same frame is still projecting overlays from.
//
// So this class NEVER touches a document. It accumulates a drag and answers
// `commit()` with a command id and its parameters, as PLAIN DATA. The frame
// builder records that during the walk and dispatches it after build() returns,
// which is the same "record intent, apply after the walk" discipline
// pendingTabValid_ / pendingRatioValid_ / pendingExpandValid_ already encode.
//
// ── and why it is here and not in forge-desktop ─────────────────────────────
// The whole of it is arithmetic: closest approach between a ray and a line, a
// ray/plane intersection, an unwrapped angle. That is assertable headless, and
// forge-desktop is the layer CI never compiles.
#ifndef FORGE_UI_VIEWPORTMANIPULATOR_HPP
#define FORGE_UI_VIEWPORTMANIPULATOR_HPP

#include <cstddef>
#include <cstdint>
#include <string>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ViewportSelect.hpp"

namespace forge::ui {

enum class ManipulatorMode : std::uint8_t { None = 0, Translate, Rotate };

// Handles are named by AXIS in both modes: in Translate an axis handle is an
// arrow along it and a plane handle is the quad spanning the other two; in
// Rotate an axis handle is the ring turning ABOUT it. One vocabulary, so a
// keyboard axis lock ("press X") means the same thing in both.
enum class ManipulatorHandle : std::uint8_t {
  None = 0,
  AxisX,
  AxisY,
  AxisZ,
  PlaneYZ,  // the quad normal to X
  PlaneZX,  // normal to Y
  PlaneXY,  // normal to Z
};

const char* toString(ManipulatorMode mode) noexcept;
const char* toString(ManipulatorHandle handle) noexcept;
// The world axis a handle is named by: the arrow's direction, or the ring's and
// the plane's normal. `out` is left at (0,0,0) for None.
void handleAxis(ManipulatorHandle handle, double out[3]) noexcept;
bool isPlaneHandle(ManipulatorHandle handle) noexcept;

// The command ids the gizmo dispatches through. They are REGISTRY ids, not a
// private path: a gizmo drag lands in the same journal, the same undo stack and
// the same feature tree as the menu item, because it IS the menu item's command.
inline constexpr const char* kManipulatorTranslateCommand = "part.move";
inline constexpr const char* kManipulatorRotateCommand = "part.rotate_body";

// What the frame builder must dispatch after the walk. `ok` is false when the
// drag moved nothing worth recording -- a click on a handle with no movement, or
// a drag whose delta rounds to zero -- and a zero-move statement must never
// reach the history, because an undo step that undoes nothing reads as broken.
struct ManipulatorCommit {
  bool ok = false;
  std::string commandId;
  CommandParams params;
  std::string reason;  // why not, when !ok -- named, so a repair loop can act
};

// How near a handle the cursor must be, in PIXELS, to grab it. A screen-space
// band for the same reason edge picking uses one: a world tolerance is unusable
// at both ends of the zoom range.
inline constexpr double kManipulatorGrabPixels = 9.0;

class Manipulator {
 public:
  // ── configuration ───────────────────────────────────────────────────────
  void setMode(ManipulatorMode mode) noexcept;
  ManipulatorMode mode() const noexcept { return mode_; }
  // Where the gizmo sits: the centroid of the selection, in world units.
  void setOrigin(const double p[3]) noexcept;
  const double* origin() const noexcept { return origin_; }
  // The gizmo's world size -- the arrow length, and the ring radius. The frame
  // derives it from a PIXEL size at the eye distance so the gizmo stays the same
  // size on screen, which is what every CAD gizmo does.
  void setSize(double worldSize) noexcept;
  double size() const noexcept { return size_; }
  // Snap increments. Zero disables. Translate is in model units (mm), rotate in
  // degrees; 1 mm and 15 degrees are the defaults every CAD system ships.
  void setTranslateSnap(double mm) noexcept { translateSnap_ = mm > 0.0 ? mm : 0.0; }
  void setRotateSnap(double degrees) noexcept { rotateSnap_ = degrees > 0.0 ? degrees : 0.0; }
  double translateSnap() const noexcept { return translateSnap_; }
  double rotateSnap() const noexcept { return rotateSnap_; }

  // ── hit test ────────────────────────────────────────────────────────────
  // Which handle is under the cursor, or None. PLANE handles win ties against
  // axis handles, because they are drawn on top and are the smaller target.
  ManipulatorHandle hitTest(const float viewProj[16], const ViewRect& view, double mx, double my,
                            double pixelTolerance = kManipulatorGrabPixels) const;
  // What the last hitTest() found, so the frame can draw a hover highlight
  // without hit-testing twice.
  ManipulatorHandle hover() const noexcept { return hover_; }
  void setHover(ManipulatorHandle h) noexcept { hover_ = h; }

  // ── the drag ────────────────────────────────────────────────────────────
  // `rayOrigin`/`rayDir` are the picking ray through the cursor. begin() returns
  // false when the handle is None, the mode is None, or the ray is degenerate
  // against that handle (looking straight down an axis makes the closest-approach
  // solve singular, and a gizmo that leaps on a singular frame is worse than one
  // that declines to start).
  bool begin(ManipulatorHandle handle, const double rayOrigin[3], const double rayDir[3]);
  // Update the live delta. Returns false on a degenerate frame, leaving the last
  // good delta in place -- the handle stays where the user last saw it rather
  // than snapping to a number the geometry cannot support.
  bool drag(const double rayOrigin[3], const double rayDir[3]);
  bool active() const noexcept { return active_; }
  ManipulatorHandle handle() const noexcept { return handle_; }
  // Abandon the drag: no commit, nothing recorded. Escape during a drag.
  void cancel() noexcept;

  // ── what the drag currently means ───────────────────────────────────────
  // Translate: the accumulated world offset, after snapping.
  const double* translation() const noexcept { return delta_; }
  // Rotate: the accumulated angle in DEGREES, after snapping, unwrapped, so a
  // drag past half a turn keeps counting instead of flipping sign.
  double rotationDegrees() const noexcept { return angleDeg_; }
  // The live preview transform, column-major, ready to hand a renderer as a
  // model matrix. Identity when nothing is being dragged.
  void previewMatrix(float out[16]) const noexcept;

  // ── the commit ──────────────────────────────────────────────────────────
  // Ends the drag and reports what to dispatch. Calling it while inactive
  // answers ok=false with a reason; it never throws and never mutates anything
  // outside this object.
  ManipulatorCommit commit();

 private:
  bool axisPoint(const double rayOrigin[3], const double rayDir[3], double& along) const;
  bool planePoint(const double rayOrigin[3], const double rayDir[3], double out[3]) const;
  bool ringAngle(const double rayOrigin[3], const double rayDir[3], double& radians) const;

  ManipulatorMode mode_ = ManipulatorMode::None;
  ManipulatorHandle handle_ = ManipulatorHandle::None;
  ManipulatorHandle hover_ = ManipulatorHandle::None;
  double origin_[3] = {0.0, 0.0, 0.0};
  double size_ = 10.0;
  double translateSnap_ = 0.0;
  double rotateSnap_ = 0.0;

  bool active_ = false;
  double startAlong_ = 0.0;         // axis drag: the ray's closest approach parameter
  double startPoint_[3] = {0, 0, 0};  // plane drag: the first ray/plane hit
  double lastAngle_ = 0.0;          // ring drag: the previous raw angle, for unwrapping
  double rawAngle_ = 0.0;           // ring drag: the accumulated raw angle
  double delta_[3] = {0.0, 0.0, 0.0};
  double angleDeg_ = 0.0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_VIEWPORTMANIPULATOR_HPP
