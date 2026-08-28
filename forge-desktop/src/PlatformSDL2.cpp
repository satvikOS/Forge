#include "PlatformSDL2.hpp"

#include <cstdint>
#include <string>
#include <vector>

#include <SDL.h>
#include <SDL_vulkan.h>

#include "imgui.h"

#include "forge/ui/Keymap.hpp"

namespace forge::desktop {
namespace {

// SDL_Keycode -> ImGuiKey. Written against SDL2's keycode table; the SDLK_a..z
// and SDLK_0..9 ranges are contiguous, which is what makes the two range checks
// legitimate rather than lucky.
ImGuiKey toImGuiKey(SDL_Keycode k) {
  if (k >= SDLK_a && k <= SDLK_z) {
    return static_cast<ImGuiKey>(ImGuiKey_A + (k - SDLK_a));
  }
  if (k >= SDLK_0 && k <= SDLK_9) {
    return static_cast<ImGuiKey>(ImGuiKey_0 + (k - SDLK_0));
  }
  if (k >= SDLK_F1 && k <= SDLK_F12) {
    return static_cast<ImGuiKey>(ImGuiKey_F1 + (k - SDLK_F1));
  }
  switch (k) {
    case SDLK_TAB:          return ImGuiKey_Tab;
    case SDLK_LEFT:         return ImGuiKey_LeftArrow;
    case SDLK_RIGHT:        return ImGuiKey_RightArrow;
    case SDLK_UP:           return ImGuiKey_UpArrow;
    case SDLK_DOWN:         return ImGuiKey_DownArrow;
    case SDLK_PAGEUP:       return ImGuiKey_PageUp;
    case SDLK_PAGEDOWN:     return ImGuiKey_PageDown;
    case SDLK_HOME:         return ImGuiKey_Home;
    case SDLK_END:          return ImGuiKey_End;
    case SDLK_INSERT:       return ImGuiKey_Insert;
    case SDLK_DELETE:       return ImGuiKey_Delete;
    case SDLK_BACKSPACE:    return ImGuiKey_Backspace;
    case SDLK_SPACE:        return ImGuiKey_Space;
    case SDLK_RETURN:       return ImGuiKey_Enter;
    case SDLK_ESCAPE:       return ImGuiKey_Escape;
    case SDLK_QUOTE:        return ImGuiKey_Apostrophe;
    case SDLK_COMMA:        return ImGuiKey_Comma;
    case SDLK_MINUS:        return ImGuiKey_Minus;
    case SDLK_PERIOD:       return ImGuiKey_Period;
    case SDLK_SLASH:        return ImGuiKey_Slash;
    case SDLK_SEMICOLON:    return ImGuiKey_Semicolon;
    case SDLK_EQUALS:       return ImGuiKey_Equal;
    case SDLK_LEFTBRACKET:  return ImGuiKey_LeftBracket;
    case SDLK_BACKSLASH:    return ImGuiKey_Backslash;
    case SDLK_RIGHTBRACKET: return ImGuiKey_RightBracket;
    case SDLK_BACKQUOTE:    return ImGuiKey_GraveAccent;
    case SDLK_LCTRL:        return ImGuiKey_LeftCtrl;
    case SDLK_RCTRL:        return ImGuiKey_RightCtrl;
    case SDLK_LSHIFT:       return ImGuiKey_LeftShift;
    case SDLK_RSHIFT:       return ImGuiKey_RightShift;
    case SDLK_LALT:         return ImGuiKey_LeftAlt;
    case SDLK_RALT:         return ImGuiKey_RightAlt;
    case SDLK_LGUI:         return ImGuiKey_LeftSuper;
    case SDLK_RGUI:         return ImGuiKey_RightSuper;
    default:                return ImGuiKey_None;
  }
}

// SDL_Keycode -> the canonical key NAME forge::ui::Keymap binds against.
std::string keyName(SDL_Keycode k) {
  if (k >= SDLK_a && k <= SDLK_z) {
    return std::string(1, static_cast<char>('A' + (k - SDLK_a)));
  }
  if (k >= SDLK_0 && k <= SDLK_9) {
    return std::string(1, static_cast<char>('0' + (k - SDLK_0)));
  }
  if (k >= SDLK_F1 && k <= SDLK_F12) {
    return "F" + std::to_string(1 + (k - SDLK_F1));
  }
  switch (k) {
    case SDLK_DELETE:    return "Delete";
    case SDLK_BACKSPACE: return "Backspace";
    case SDLK_TAB:       return "Tab";
    case SDLK_HOME:      return "Home";
    case SDLK_END:       return "End";
    case SDLK_ESCAPE:    return "Escape";
    case SDLK_RETURN:    return "Enter";
    case SDLK_SPACE:     return "Space";
    case SDLK_LEFT:      return "Left";
    case SDLK_RIGHT:     return "Right";
    case SDLK_UP:        return "Up";
    case SDLK_DOWN:      return "Down";
    default:             return std::string();
  }
}

std::uint8_t modMask(SDL_Keymod m) {
  using forge::ui::Mod;
  std::uint8_t out = 0;
  if (m & KMOD_SHIFT) out |= static_cast<std::uint8_t>(Mod::Shift);
  // On macOS the Command key is the one users press for Ctrl+S. SDL reports it
  // as KMOD_GUI. Mapping it to Ctrl is what makes the shipped default keymap
  // ("Ctrl+S" = file.save) reachable on this platform at all; mapping it to
  // Super instead would leave every default binding unreachable on a Mac.
#ifdef __APPLE__
  if (m & KMOD_GUI) out |= static_cast<std::uint8_t>(Mod::Ctrl);
  if (m & KMOD_CTRL) out |= static_cast<std::uint8_t>(Mod::Super);
#else
  if (m & KMOD_CTRL) out |= static_cast<std::uint8_t>(Mod::Ctrl);
  if (m & KMOD_GUI) out |= static_cast<std::uint8_t>(Mod::Super);
#endif
  if (m & KMOD_ALT) out |= static_cast<std::uint8_t>(Mod::Alt);
  return out;
}

const char* clipboardGet(ImGuiContext*) {
  static char* text = nullptr;
  if (text != nullptr) {
    SDL_free(text);
    text = nullptr;
  }
  text = SDL_GetClipboardText();
  return text;
}

void clipboardSet(ImGuiContext*, const char* text) { SDL_SetClipboardText(text); }

}  // namespace

bool PlatformSDL2::init(SDL_Window* window) {
  window_ = window;
  ImGuiIO& io = ImGui::GetIO();
  io.BackendPlatformName = "forge_platform_sdl2";
  io.BackendFlags |= ImGuiBackendFlags_HasMouseCursors;
  io.BackendFlags |= ImGuiBackendFlags_HasSetMousePos;

  ImGuiPlatformIO& pio = ImGui::GetPlatformIO();
  pio.Platform_GetClipboardTextFn = clipboardGet;
  pio.Platform_SetClipboardTextFn = clipboardSet;

  cursors_[ImGuiMouseCursor_Arrow] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_ARROW);
  cursors_[ImGuiMouseCursor_TextInput] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_IBEAM);
  cursors_[ImGuiMouseCursor_ResizeAll] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_SIZEALL);
  cursors_[ImGuiMouseCursor_ResizeNS] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_SIZENS);
  cursors_[ImGuiMouseCursor_ResizeEW] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_SIZEWE);
  cursors_[ImGuiMouseCursor_ResizeNESW] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_SIZENESW);
  cursors_[ImGuiMouseCursor_ResizeNWSE] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_SIZENWSE);
  cursors_[ImGuiMouseCursor_Hand] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_HAND);
  cursors_[ImGuiMouseCursor_NotAllowed] = SDL_CreateSystemCursor(SDL_SYSTEM_CURSOR_NO);

  lastTicks_ = SDL_GetPerformanceCounter();
  return true;
}

void PlatformSDL2::shutdown() {
  for (SDL_Cursor*& c : cursors_) {
    if (c != nullptr) {
      SDL_FreeCursor(c);
      c = nullptr;
    }
  }
  window_ = nullptr;
}

bool PlatformSDL2::processEvent(const SDL_Event& e) {
  ImGuiIO& io = ImGui::GetIO();
  switch (e.type) {
    case SDL_QUIT:
      quit_ = true;
      return true;

    case SDL_WINDOWEVENT:
      if (e.window.event == SDL_WINDOWEVENT_CLOSE) quit_ = true;
      if (e.window.event == SDL_WINDOWEVENT_FOCUS_GAINED) io.AddFocusEvent(true);
      if (e.window.event == SDL_WINDOWEVENT_FOCUS_LOST) io.AddFocusEvent(false);
      return false;

    case SDL_MOUSEMOTION:
      io.AddMouseSourceEvent(ImGuiMouseSource_Mouse);
      io.AddMousePosEvent(static_cast<float>(e.motion.x), static_cast<float>(e.motion.y));
      return io.WantCaptureMouse;

    case SDL_MOUSEWHEEL:
      io.AddMouseSourceEvent(ImGuiMouseSource_Mouse);
      io.AddMouseWheelEvent(e.wheel.preciseX, e.wheel.preciseY);
      return io.WantCaptureMouse;

    case SDL_MOUSEBUTTONDOWN:
    case SDL_MOUSEBUTTONUP: {
      int button = -1;
      if (e.button.button == SDL_BUTTON_LEFT) button = 0;
      if (e.button.button == SDL_BUTTON_RIGHT) button = 1;
      if (e.button.button == SDL_BUTTON_MIDDLE) button = 2;
      if (button < 0) return false;
      io.AddMouseSourceEvent(ImGuiMouseSource_Mouse);
      io.AddMouseButtonEvent(button, e.type == SDL_MOUSEBUTTONDOWN);
      return io.WantCaptureMouse;
    }

    case SDL_TEXTINPUT:
      io.AddInputCharactersUTF8(e.text.text);
      return io.WantTextInput;

    case SDL_KEYDOWN:
    case SDL_KEYUP: {
      const bool down = (e.type == SDL_KEYDOWN);
      const SDL_Keymod m = SDL_GetModState();
      io.AddKeyEvent(ImGuiMod_Ctrl, (m & KMOD_CTRL) != 0);
      io.AddKeyEvent(ImGuiMod_Shift, (m & KMOD_SHIFT) != 0);
      io.AddKeyEvent(ImGuiMod_Alt, (m & KMOD_ALT) != 0);
      io.AddKeyEvent(ImGuiMod_Super, (m & KMOD_GUI) != 0);
      const ImGuiKey key = toImGuiKey(e.key.keysym.sym);
      if (key != ImGuiKey_None) io.AddKeyEvent(key, down);

      // Only a press that ImGui does NOT want as text is offered to the shell's
      // keymap. Typing "e" into the palette's search box must not also fire the
      // Extrude shortcut — that is the single most common shortcut bug in an
      // immediate-mode UI, and this is where it is prevented.
      if (down && !io.WantTextInput && !e.key.repeat) {
        const std::string name = keyName(e.key.keysym.sym);
        if (!name.empty()) presses_.push_back(KeyPress{name, modMask(m)});
      }
      return io.WantTextInput;
    }

    default:
      return false;
  }
}

void PlatformSDL2::newFrame() {
  ImGuiIO& io = ImGui::GetIO();

  int w = 0, h = 0, dw = 0, dh = 0;
  SDL_GetWindowSize(window_, &w, &h);
  SDL_Vulkan_GetDrawableSize(window_, &dw, &dh);
  if (SDL_GetWindowFlags(window_) & SDL_WINDOW_MINIMIZED) {
    w = h = 0;
  }
  io.DisplaySize = ImVec2(static_cast<float>(w), static_cast<float>(h));
  if (w > 0 && h > 0) {
    io.DisplayFramebufferScale =
        ImVec2(static_cast<float>(dw) / static_cast<float>(w),
               static_cast<float>(dh) / static_cast<float>(h));
    dpiScale_ = io.DisplayFramebufferScale.x;
  }

  const std::uint64_t freq = SDL_GetPerformanceFrequency();
  const std::uint64_t now = SDL_GetPerformanceCounter();
  const double dt = lastTicks_ > 0 ? static_cast<double>(now - lastTicks_) /
                                         static_cast<double>(freq)
                                   : 1.0 / 60.0;
  lastTicks_ = now;
  // Clamp: a frame that took 4 seconds because the window was being dragged must
  // not teleport every animation. ImGui asserts DeltaTime > 0.
  io.DeltaTime = static_cast<float>(dt > 0.0 ? (dt < 0.25 ? dt : 0.25) : 1.0 / 60.0);

  const ImGuiMouseCursor want = ImGui::GetMouseCursor();
  if (want == ImGuiMouseCursor_None || io.MouseDrawCursor) {
    SDL_ShowCursor(SDL_FALSE);
  } else {
    SDL_Cursor* c = cursors_[want] != nullptr ? cursors_[want] : cursors_[ImGuiMouseCursor_Arrow];
    if (c != lastCursorSet_) {
      SDL_SetCursor(c);
      lastCursorSet_ = c;
    }
    SDL_ShowCursor(SDL_TRUE);
  }
}

}  // namespace forge::desktop
