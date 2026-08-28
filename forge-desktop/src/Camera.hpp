// forge-desktop/src/Camera.hpp
//
// The viewport camera and the NAVIGATION MAP that drives it. Pure math and pure
// value types — no ImGui, no Vulkan, no kernel — so the whole of it is asserted
// headless in the frame gate.
//
// TURNTABLE, not free-flight. Every mechanical CAD system (NX, CATIA, Creo,
// SolidWorks, Fusion) orbits about a target with a world-up constraint, because
// a machinist's mental model has a floor in it; a free-flight camera loses "up"
// and is disorienting on a part. Elevation is clamped just short of the poles so
// the up vector never degenerates.
//
// The navigation map is the viewport's half of the four input profiles in
// forge::ui::Keymap. Keymap owns COMMAND bindings; a drag is not a command, so
// the mouse-drag verbs live here — but they are keyed off the SAME
// forge::ui::InputProfile enum, so switching profile in the shell switches both
// at once and they can never disagree about which profile is active.
#ifndef FORGE_DESKTOP_CAMERA_HPP
#define FORGE_DESKTOP_CAMERA_HPP

#include <cstdint>

#include "forge/ui/Keymap.hpp"

namespace forge::desktop {

// What a drag does. The fourth value matters: CATIA's middle-drag alone pans,
// and only becomes an orbit once the right button joins it, so "no verb" is a
// real state a profile can be in mid-drag.
enum class NavVerb : std::uint8_t { None = 0, Orbit, Pan, Zoom };

const char* toString(NavVerb verb) noexcept;

// The live mouse state a drag is resolved against.
struct NavInput {
  bool left = false;
  bool middle = false;
  bool right = false;
  bool shift = false;
  bool ctrl = false;
  bool alt = false;
};

// Resolve a drag verb for one input profile. Documented per profile in the .cpp;
// the parity gate asserts each profile's table.
NavVerb navVerbFor(forge::ui::InputProfile profile, const NavInput& in) noexcept;

// A short human string for the status bar — "MMB orbit · Shift+MMB pan · wheel
// zoom" — so the app tells the user what the active profile does.
const char* navHintFor(forge::ui::InputProfile profile) noexcept;

class Camera {
 public:
  // Frames a sphere of `radius` about `centre` so the whole of it is inside the
  // vertical field of view with a 15% margin. This is `view.fit`.
  void frame(const float centre[3], float radius) noexcept;

  void orbit(float dAzimuthRad, float dElevationRad) noexcept;
  // Pan in SCREEN space: dx/dy are pixels, converted to world using the distance
  // to the target, so a drag keeps the point under the cursor under the cursor.
  void pan(float dxPixels, float dyPixels, float viewportHeight) noexcept;
  // Multiplicative zoom (dolly): `steps` positive moves toward the target.
  void zoom(float steps) noexcept;

  void setAspect(float aspect) noexcept { aspect_ = aspect > 1e-4f ? aspect : 1.0f; }
  float aspect() const noexcept { return aspect_; }
  float distance() const noexcept { return distance_; }
  float azimuth() const noexcept { return azimuth_; }
  float elevation() const noexcept { return elevation_; }
  const float* target() const noexcept { return target_; }

  // Standard named views. The axis convention is Z-up, the mechanical-CAD
  // default that forge-kernel's primitives are authored in (makeBox extrudes +Z).
  void setFront() noexcept;
  void setTop() noexcept;
  void setRight() noexcept;
  void setIsometric() noexcept;

  void eye(float out[3]) const noexcept;

  // Column-major 4x4, the layout GLSL `mat4` expects and the layout the push
  // constant is memcpy'd from.
  void viewProj(float out[16]) const noexcept;
  void view(float out[16]) const noexcept;
  void proj(float out[16]) const noexcept;
  // The model rotation the normal is transformed by — identity here, kept so the
  // shader interface does not change when instancing arrives.
  static void identity(float out[16]) noexcept;

  // Build a picking ray through a viewport pixel. `x`,`y` are in pixels from the
  // viewport's top-left; the returned direction is normalized.
  void ray(float x, float y, float width, float height, float origin[3],
           float direction[3]) const noexcept;

 private:
  float target_[3] = {0.0f, 0.0f, 0.0f};
  float distance_ = 200.0f;
  float azimuth_ = -0.9f;    // radians, about world Z
  float elevation_ = 0.55f;  // radians above the XY plane
  float aspect_ = 1.6f;
  float fovY_ = 0.7853982f;  // 45 degrees
  float near_ = 0.1f;
  float far_ = 10000.0f;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_CAMERA_HPP
