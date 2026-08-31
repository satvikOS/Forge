// ui/include/forge/ui/ViewOrientation.hpp
//
// STANDARD VIEWS AND THE VIEW CUBE — where the camera goes when the user asks
// for "top", and what the corner of a little cube in the top-right means.
//
// ── the axis convention, stated once ────────────────────────────────────────
// Z-up, the mechanical-CAD default forge-kernel's primitives are authored in
// (makeBox extrudes +Z). The camera is a TURNTABLE: an azimuth about world Z and
// an elevation above the XY plane, with the eye at
//     eye = target + distance * (cos el cos az, cos el sin az, sin el)
// so a named view is just the direction the eye sits in. That makes every one of
// the twenty-six view-cube zones the SAME construction as the six orthographic
// views and the isometric -- one function, not a table of hand-typed angles that
// drift apart. `Front` is the -Y direction, which is what forge::desktop::Camera
// has always meant by it.
//
// ── why a cube and not four buttons ─────────────────────────────────────────
// Every mechanical CAD system ships one (NX's, Creo's, SolidWorks's, Fusion's
// ViewCube) because six named views are not enough to navigate a 400-face part:
// the twelve edges and eight corners are the three-quarter views a machinist
// actually inspects a fillet from, and clicking one is faster and more
// repeatable than an orbit drag. The hit test is exact rather than a nine-square
// grid guess: the cursor is unprojected into the cube's own space through the
// live camera rotation and classified by where it enters the unit cube, so the
// zone the user clicks is the zone under the pixel however the cube is turned.
//
// Nothing here includes ImGui, OCCT or a forge-kernel header.
#ifndef FORGE_UI_VIEWORIENTATION_HPP
#define FORGE_UI_VIEWORIENTATION_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/ViewportSelect.hpp"

namespace forge::ui {

// Radians kept clear of +/-90 degrees of elevation so the world-up cross product
// never degenerates. THE camera's guard: forge::desktop::Camera reads this
// constant rather than keeping its own copy, because a top view that is exactly
// vertical in one file and 0.02 rad short in another is two cameras.
inline constexpr double kViewPoleGuardRad = 0.02;

// A turntable pose. Distance is deliberately NOT here: "look from the top" and
// "how far away" are different questions, and a named view must not undo a fit.
struct ViewOrientation {
  double azimuth = 0.0;    // radians about world Z
  double elevation = 0.0;  // radians above the XY plane, |el| <= pi/2 - guard
};

// The eye direction a pose looks from, unit length.
void orientationDirection(const ViewOrientation& o, double out[3]) noexcept;

// The pose whose eye sits along `n` (need not be unit). A zero vector answers the
// isometric, which is the honest default rather than a silent (0,0).
ViewOrientation orientationForDirection(const double n[3]) noexcept;

// ── the twenty-six zones ────────────────────────────────────────────────────
// A zone is a sign triple in {-1,0,1}^3, excluding (0,0,0): six faces (one
// non-zero), twelve edges (two), eight corners (three).
struct ViewCubeZone {
  int sign[3] = {0, 0, 0};

  bool valid() const noexcept { return sign[0] != 0 || sign[1] != 0 || sign[2] != 0; }
  // 1 = a face, 2 = an edge, 3 = a corner, 0 = invalid.
  int rank() const noexcept {
    return (sign[0] != 0 ? 1 : 0) + (sign[1] != 0 ? 1 : 0) + (sign[2] != 0 ? 1 : 0);
  }
  bool operator==(const ViewCubeZone& o) const noexcept {
    return sign[0] == o.sign[0] && sign[1] == o.sign[1] && sign[2] == o.sign[2];
  }
};

// "Top-Front-Right", "Front", "Top-Right". Ordered Top/Bottom, then Front/Back,
// then Left/Right -- the order every CAD system labels a three-quarter view in.
std::string zoneName(const ViewCubeZone& zone);

// The pose that looks at the model from that zone.
ViewOrientation orientationForZone(const ViewCubeZone& zone) noexcept;

// Every zone, in a deterministic order: the six faces, then the twelve edges,
// then the eight corners, each group ordered by the sign triple.
const std::vector<ViewCubeZone>& viewCubeZones();

// ── the named standard views ────────────────────────────────────────────────
// Ids, so a command can name one and a keymap can bind it. Every one is DERIVED
// from a zone above, so the cube and the View menu cannot disagree about where
// "top" is.
enum class StandardViewId : std::uint8_t {
  Front = 0,
  Back,
  Left,
  Right,
  Top,
  Bottom,
  Isometric,
};

struct StandardViewSpec {
  StandardViewId id = StandardViewId::Front;
  const char* commandId = "";  // the registry id that selects it
  const char* label = "";
  ViewCubeZone zone{};
};

const std::vector<StandardViewSpec>& standardViews();
// The spec for an id, or nullptr. Never returns a default-constructed spec: a
// caller that asked for a view that does not exist must see that, not Front.
const StandardViewSpec* findStandardView(StandardViewId id) noexcept;
// The spec a command id names, or nullptr when the id is not a standard view.
const StandardViewSpec* findStandardViewByCommand(const std::string& commandId) noexcept;
ViewOrientation orientationForStandardView(StandardViewId id) noexcept;

// ── the cube's hit test ─────────────────────────────────────────────────────
struct ViewCubeHit {
  bool hit = false;
  ViewCubeZone zone{};
  double entry[3] = {0.0, 0.0, 0.0};  // where the ray entered the unit cube, cube space
};

// How wide the face zone is, as a fraction of the half-face. 0.65 leaves a 35%
// band along each border for the edge and corner zones, which is the proportion
// NX's and Fusion's cubes use; below about 0.5 the faces become unclickable and
// above about 0.8 the corners do.
inline constexpr double kViewCubeFaceBand = 0.65;

// `view` is the COLUMN-MAJOR view matrix the camera already computes: its first
// three columns' top rows carry the camera basis (right, up, backward), which is
// all a cube needs -- the cube is drawn orthographically at a fixed size, so
// neither the projection nor the eye distance enters. `cube` is the rectangle
// the cube occupies on screen, `mx`/`my` the cursor in the same coordinates.
//
// Returns hit=false when the cursor is outside the rectangle OR inside it but
// missing the cube (the corners of the rect are empty background), which is what
// lets the caller fall through to an orbit rather than snapping to a view the
// user did not click.
ViewCubeHit viewCubeHit(const float view[16], const ViewRect& cube, double mx, double my,
                        double faceBand = kViewCubeFaceBand);

}  // namespace forge::ui

#endif  // FORGE_UI_VIEWORIENTATION_HPP
