// forge-desktop/src/PlatformSDL2.hpp
//
// The ImGui PLATFORM backend: SDL2 window/input -> ImGuiIO.
//
// Dear ImGui ships a reference platform backend for SDL2
// (`backends/imgui_impl_sdl2.cpp`). It is NOT vendored here — the vendored tree
// under third_party/imgui carries the core translation units and the VULKAN
// RENDERER backend only, and this repository builds offline against a pinned
// dependency plane (Sacrosanct s10.6), so pulling a new upstream file mid-segment
// would add an unpinned dependency to satisfy an unpinned dependency.
//
// This is therefore a first-party implementation of the SAME CONTRACT that
// backend implements, and only that contract:
//   * io.DisplaySize / DisplayFramebufferScale from the SDL window and drawable
//   * io.DeltaTime from SDL_GetPerformanceCounter
//   * io.AddMousePosEvent / AddMouseButtonEvent / AddMouseWheelEvent
//   * io.AddKeyEvent for keys and modifiers, io.AddInputCharacter for text
//   * io.AddFocusEvent, and the mouse cursor pushed back to SDL
// It deliberately does NOT implement multi-viewport, gamepad, or IME: this app
// declares none of those config flags, and a backend feature nothing turns on is
// untested code.
#ifndef FORGE_DESKTOP_PLATFORMSDL2_HPP
#define FORGE_DESKTOP_PLATFORMSDL2_HPP

#include <cstdint>
#include <string>
#include <vector>

#include <SDL.h>
#include <SDL_vulkan.h>

#include "imgui.h"

namespace forge::desktop {

// A key press seen this frame, already translated to forge::ui::Keymap's
// vocabulary — the shell speaks key NAMES, not SDL scancodes.
struct KeyPress {
  std::string key;
  std::uint8_t mods = 0;  // forge::ui::ModMask
};

class PlatformSDL2 {
 public:
  bool init(SDL_Window* window);
  void shutdown();

  // Translate one SDL event. Returns true when ImGui consumed it in a way the
  // app should not also act on (text typed into a focused field).
  bool processEvent(const SDL_Event& event);

  // Per-frame: pushes display size, dpi scale and dt into ImGuiIO, and applies
  // the cursor ImGui asked for.
  void newFrame();

  bool quitRequested() const noexcept { return quit_; }
  float dpiScale() const noexcept { return dpiScale_; }

  // The key presses seen since the last call, drained. Only presses that ImGui
  // did NOT want (no text field focused) reach the shell's keymap.
  const std::vector<KeyPress>& drainKeyPresses() noexcept { return presses_; }
  void clearKeyPresses() noexcept { presses_.clear(); }

 private:
  SDL_Window* window_ = nullptr;
  std::uint64_t lastTicks_ = 0;
  float dpiScale_ = 1.0f;
  bool quit_ = false;
  std::vector<KeyPress> presses_;
  // ImGuiMouseCursor_COUNT, not a literal: upstream has added cursor kinds
  // (Wait, Progress, NotAllowed) and a literal silently writes past the array.
  SDL_Cursor* cursors_[ImGuiMouseCursor_COUNT] = {nullptr};
  SDL_Cursor* lastCursorSet_ = nullptr;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_PLATFORMSDL2_HPP
