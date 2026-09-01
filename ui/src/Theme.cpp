#include "forge/ui/Theme.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

namespace forge::ui {
namespace {

// One row per token, in enum order. A std::array sized by kColorTokenCount means
// adding a token WITHOUT giving it a value in both themes is a compile-time
// error here, not a black rectangle in the running app.
struct TokenRow {
  ColorToken token;
  const char* name;
  std::uint32_t dark;
  std::uint32_t light;
};

// ── the palette ─────────────────────────────────────────────────────────────
// Every value below was chosen against contrastRequirements() and the measured
// ratios are in ui/test/theme_test.cpp's output, not asserted here in prose.
//
// The dark column keeps the shipped app's identity — the amber accent
// (0xF29E26) and the blue preselection (0x5AB8F2) are the two colours a user
// already reads as "selected" and "hovered", so they are preserved exactly.
// The light column is NOT the dark one inverted: amber on white is unreadable
// (2.0:1), so the light accent is the same hue driven down to 0x9A4F00, which
// clears 4.5:1 against white with white text on top of it.
constexpr std::array<TokenRow, kColorTokenCount> kPalette{{
    {ColorToken::WindowBg,      "window_bg",      0x12151A, 0xEEF1F5},
    {ColorToken::PanelBg,       "panel_bg",       0x191D24, 0xFFFFFF},
    {ColorToken::PanelHeaderBg, "panel_header_bg",0x222833, 0xE4E9F0},
    {ColorToken::MenuBarBg,     "menu_bar_bg",    0x161A20, 0xE8ECF2},
    {ColorToken::ToolbarBg,     "toolbar_bg",     0x1B2028, 0xF2F5F9},
    {ColorToken::StatusBg,      "status_bg",      0x16191D, 0xE2E7EE},
    {ColorToken::ViewportBg,    "viewport_bg",    0x0E1116, 0xF7F9FC},

    {ColorToken::Text,          "text",           0xE6EAF0, 0x14181E},
    {ColorToken::TextMuted,     "text_muted",     0xA8B2C1, 0x4A5361},
    {ColorToken::TextDisabled,  "text_disabled",  0x78818F, 0x767F8D},
    {ColorToken::TextOnAccent,  "text_on_accent", 0x1A1205, 0xFFFFFF},

    {ColorToken::Accent,        "accent",         0xF29E26, 0x9A4F00},
    {ColorToken::AccentHover,   "accent_hover",   0xFFB44D, 0xB45C00},
    {ColorToken::AccentActive,  "accent_active",  0xD8871A, 0x7D4000},

    {ColorToken::Border,        "border",         0x3A4453, 0xC3CBD6},
    {ColorToken::Separator,     "separator",      0x232A34, 0xD6DCE4},
    {ColorToken::FocusRing,     "focus_ring",     0x5AB8F2, 0x0A5FA8},

    {ColorToken::Selection,     "selection",      0xF29E26, 0x9A4F00},
    {ColorToken::Preselection,  "preselection",   0x5AB8F2, 0x0A5FA8},

    {ColorToken::Success,       "success",        0x5FD39A, 0x12684A},
    {ColorToken::Warning,       "warning",        0xF2C14E, 0x7A4D00},
    {ColorToken::Danger,        "danger",         0xFF7B72, 0xA3160F},

    {ColorToken::ButtonBg,      "button_bg",      0x232A34, 0xE8ECF2},
    {ColorToken::ButtonHover,   "button_hover",   0x2E3745, 0xDDE3EA},
    {ColorToken::ButtonActive,  "button_active",  0x3A4554, 0xCCD4DE},

    {ColorToken::TabActive,     "tab_active",     0x2B3340, 0xFFFFFF},
    {ColorToken::TabInactive,   "tab_inactive",   0x1A1F27, 0xDFE5EC},
    {ColorToken::TabHover,      "tab_hover",      0x242C37, 0xEAEFF4},

    {ColorToken::ScrollbarBg,   "scrollbar_bg",   0x141920, 0xE4E9F0},
    {ColorToken::ScrollbarGrab, "scrollbar_grab", 0x39424F, 0xB3BCC8},
    {ColorToken::GridLine,      "grid_line",      0x232A34, 0xDDE3EA},
}};

double srgbToLinear(double channel) noexcept {
  return channel <= 0.04045 ? channel / 12.92 : std::pow((channel + 0.055) / 1.055, 2.4);
}

std::uint8_t quantize(double v) noexcept {
  const double clamped = v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
  return static_cast<std::uint8_t>(clamped * 255.0 + 0.5);
}

}  // namespace

// ── enum plumbing ───────────────────────────────────────────────────────────
const char* toString(ThemeMode mode) noexcept {
  switch (mode) {
    case ThemeMode::Dark:  return "dark";
    case ThemeMode::Light: return "light";
  }
  return "dark";
}

bool themeModeFromString(const std::string& name, ThemeMode& out) noexcept {
  for (ThemeMode m : {ThemeMode::Dark, ThemeMode::Light}) {
    if (name == toString(m)) {
      out = m;
      return true;
    }
  }
  return false;
}

std::vector<ThemeMode> allThemeModes() { return {ThemeMode::Dark, ThemeMode::Light}; }

const char* toString(ColorToken token) noexcept {
  const std::size_t i = static_cast<std::size_t>(token);
  if (i >= kColorTokenCount) return "?";
  return kPalette[i].name;
}

bool colorTokenFromString(const std::string& name, ColorToken& out) noexcept {
  for (const TokenRow& row : kPalette) {
    if (name == row.name) {
      out = row.token;
      return true;
    }
  }
  return false;
}

std::vector<ColorToken> allColorTokens() {
  std::vector<ColorToken> out;
  out.reserve(kColorTokenCount);
  for (const TokenRow& row : kPalette) out.push_back(row.token);
  return out;
}

// ── Rgba ────────────────────────────────────────────────────────────────────
std::uint32_t Rgba::packedRgba() const noexcept {
  return (static_cast<std::uint32_t>(quantize(r)) << 24) |
         (static_cast<std::uint32_t>(quantize(g)) << 16) |
         (static_cast<std::uint32_t>(quantize(b)) << 8) |
         static_cast<std::uint32_t>(quantize(a));
}

std::uint32_t Rgba::packedAbgr() const noexcept {
  return static_cast<std::uint32_t>(quantize(r)) |
         (static_cast<std::uint32_t>(quantize(g)) << 8) |
         (static_cast<std::uint32_t>(quantize(b)) << 16) |
         (static_cast<std::uint32_t>(quantize(a)) << 24);
}

bool operator==(const Rgba& a, const Rgba& b) noexcept {
  return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a;
}

bool operator!=(const Rgba& a, const Rgba& b) noexcept { return !(a == b); }

Rgba rgbFromHex(std::uint32_t rrggbb, double alpha) noexcept {
  Rgba c;
  c.r = static_cast<double>((rrggbb >> 16) & 0xFFu) / 255.0;
  c.g = static_cast<double>((rrggbb >> 8) & 0xFFu) / 255.0;
  c.b = static_cast<double>(rrggbb & 0xFFu) / 255.0;
  c.a = alpha;
  return c;
}

double relativeLuminance(const Rgba& colour) noexcept {
  return 0.2126 * srgbToLinear(colour.r) + 0.7152 * srgbToLinear(colour.g) +
         0.0722 * srgbToLinear(colour.b);
}

double contrastRatio(const Rgba& a, const Rgba& b) noexcept {
  const double la = relativeLuminance(a);
  const double lb = relativeLuminance(b);
  const double hi = la > lb ? la : lb;
  const double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

// ── Theme ───────────────────────────────────────────────────────────────────
Theme Theme::forMode(ThemeMode mode) {
  Theme t;
  t.mode_ = mode;
  for (std::size_t i = 0; i < kColorTokenCount; ++i) {
    const TokenRow& row = kPalette[i];
    t.colors_[i] = rgbFromHex(mode == ThemeMode::Dark ? row.dark : row.light);
  }
  return t;
}

const Rgba& Theme::color(ColorToken token) const noexcept {
  const std::size_t i = static_cast<std::size_t>(token);
  // A token out of range is a programming error, not user data, and returning a
  // reference into a static keeps this noexcept and total: a UI that asks for a
  // colour must always get one, never a crash mid-frame.
  static const Rgba kFallback = Rgba{1.0, 0.0, 1.0, 1.0};  // magenta: visible, never shipped
  if (i >= kColorTokenCount) return kFallback;
  return colors_[i];
}

double Theme::contrast(ColorToken foreground, ColorToken background) const noexcept {
  return contrastRatio(color(foreground), color(background));
}

std::string Theme::serialize() const {
  std::ostringstream os;
  os << "forge-theme 1\n" << toString(mode_) << '\n';
  return os.str();
}

bool Theme::parse(const std::string& text, Theme& out) {
  std::istringstream is(text);
  std::string line;
  if (!std::getline(is, line) || line != "forge-theme 1") return false;
  if (!std::getline(is, line)) return false;
  ThemeMode mode = ThemeMode::Dark;
  if (!themeModeFromString(line, mode)) return false;
  out = forMode(mode);
  return true;
}

// ── the readability contract ────────────────────────────────────────────────
const std::vector<ContrastRequirement>& contrastRequirements() {
  static const std::vector<ContrastRequirement> kRows = {
      // Body text on every surface it is drawn on. 4.5:1 is WCAG 2.1 AA for
      // normal-size text, and the shell's text IS normal size.
      {ColorToken::Text, ColorToken::WindowBg, 4.5, "body text on the window"},
      {ColorToken::Text, ColorToken::PanelBg, 4.5, "body text in a panel"},
      {ColorToken::Text, ColorToken::PanelHeaderBg, 4.5, "a panel header's title"},
      {ColorToken::Text, ColorToken::MenuBarBg, 4.5, "a menu title"},
      {ColorToken::Text, ColorToken::ToolbarBg, 4.5, "a ribbon button's label"},
      {ColorToken::Text, ColorToken::StatusBg, 4.5, "the status strip"},
      {ColorToken::Text, ColorToken::ButtonBg, 4.5, "a button's label"},
      {ColorToken::Text, ColorToken::TabActive, 4.5, "the active dock tab"},
      {ColorToken::Text, ColorToken::TabInactive, 4.5, "an inactive dock tab"},

      // Muted text is held to the SAME 4.5:1 as body text, deliberately. It
      // carries the units, the counts and the shortcut hints — everything a user
      // has to read to operate the app — so exempting it would be exempting the
      // information rather than the decoration.
      {ColorToken::TextMuted, ColorToken::PanelBg, 4.5, "secondary text in a panel"},
      {ColorToken::TextMuted, ColorToken::StatusBg, 4.5, "the status strip's labels"},
      {ColorToken::TextMuted, ColorToken::MenuBarBg, 4.5, "a menu item's shortcut"},
      {ColorToken::TextMuted, ColorToken::ToolbarBg, 4.5, "a ribbon group's caption"},

      // Disabled text is exempt from 1.4.3 by name, but 3:1 keeps a greyed-out
      // command LEGIBLE — a user has to be able to read what they cannot run.
      {ColorToken::TextDisabled, ColorToken::PanelBg, 3.0, "a disabled command in a panel"},
      {ColorToken::TextDisabled, ColorToken::ToolbarBg, 3.0, "a disabled ribbon button"},

      // The accent is a FILL, so what has to be readable is the text on it.
      {ColorToken::TextOnAccent, ColorToken::Accent, 4.5, "a label on an accent fill"},
      {ColorToken::TextOnAccent, ColorToken::AccentActive, 4.5, "a label on a pressed accent fill"},

      // Status colours are text, not decoration: the log prints in them.
      {ColorToken::Success, ColorToken::PanelBg, 4.5, "a success line in the log"},
      {ColorToken::Warning, ColorToken::PanelBg, 4.5, "a warning line in the log"},
      {ColorToken::Danger, ColorToken::PanelBg, 4.5, "an error line in the log"},
      {ColorToken::Success, ColorToken::StatusBg, 4.5, "a success message in the strip"},
      {ColorToken::Warning, ColorToken::StatusBg, 4.5, "a warning message in the strip"},
      {ColorToken::Danger, ColorToken::StatusBg, 4.5, "an error message in the strip"},

      // WCAG 2.1 1.4.11 — a non-text indicator needs 3:1. The focus ring is the
      // ONLY thing telling a keyboard user where they are, so it is not optional.
      {ColorToken::FocusRing, ColorToken::PanelBg, 3.0, "the keyboard focus ring on a panel"},
      {ColorToken::FocusRing, ColorToken::ButtonBg, 3.0, "the keyboard focus ring on a button"},
      {ColorToken::Accent, ColorToken::PanelBg, 3.0, "an accent-coloured indicator"},

      // A border is decoration, but an invisible border is a layout the user
      // cannot parse. 1.3:1 is a floor, not a standard, and is named as such.
      {ColorToken::Border, ColorToken::PanelBg, 1.3, "a panel border (floor, not a WCAG rule)"},
  };
  return kRows;
}

std::string ContrastFailure::describe() const {
  std::ostringstream os;
  os << toString(mode) << ": " << toString(foreground) << " on " << toString(background) << " is "
     << ratio << ":1, below the required " << required << ":1";
  return os.str();
}

std::vector<ContrastFailure> auditContrast(const Theme& theme) {
  std::vector<ContrastFailure> out;
  for (const ContrastRequirement& req : contrastRequirements()) {
    const double ratio = theme.contrast(req.foreground, req.background);
    if (ratio + 1e-9 >= req.minRatio) continue;
    ContrastFailure f;
    f.mode = theme.mode();
    f.foreground = req.foreground;
    f.background = req.background;
    f.ratio = ratio;
    f.required = req.minRatio;
    out.push_back(f);
  }
  return out;
}

std::vector<ContrastFailure> auditContrast() {
  std::vector<ContrastFailure> out;
  for (ThemeMode mode : allThemeModes()) {
    const std::vector<ContrastFailure> here = auditContrast(Theme::forMode(mode));
    out.insert(out.end(), here.begin(), here.end());
  }
  return out;
}

}  // namespace forge::ui
