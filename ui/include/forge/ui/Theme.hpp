// ui/include/forge/ui/Theme.hpp
//
// THE DESIGN TOKENS. Every colour the shell draws is named here once, in both
// themes, and NOWHERE ELSE.
//
// ── why this file exists ────────────────────────────────────────────────────
// ForgeFrame.cpp drew its chrome from ~40 inline `rgb(130, 137, 148)` literals.
// Three consequences, all measured by reading it:
//   1. there was exactly ONE theme, and no way to add a second that did not mean
//      editing every call site;
//   2. the same semantic colour was spelled with three different values in three
//      panels, because a literal carries no name to keep them equal;
//   3. NOTHING could check the contrast of text against the surface behind it,
//      because neither the text colour nor the surface colour was a value any
//      test could name.
//
// A token fixes all three at once: `ColorToken::TextMuted` has one value per
// mode, the mode is a parameter, and a gate can ask what the ratio between two
// tokens is. ui/test/theme_test.cpp does exactly that and REFUSES a palette that
// puts unreadable text on a surface — the contrast requirement is data
// (contrastRequirements()), so adding a new pair is adding a row, not editing a
// test.
//
// ── the accessibility claim, stated exactly ────────────────────────────────
// contrastRatio() is WCAG 2.1's definition (relative luminance with the sRGB
// transfer function, (L1+0.05)/(L2+0.05)). The gate holds body text at 4.5:1 —
// WCAG AA for normal text — and non-text indicators (the focus ring) at 3:1,
// which is 1.4.11. It does NOT claim conformance of the running application:
// that would need a rendered pixel, and this layer draws nothing. It claims the
// PALETTE cannot be the reason contrast fails, which is the part a headless gate
// can actually establish.
#ifndef FORGE_UI_THEME_HPP
#define FORGE_UI_THEME_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

enum class ThemeMode : std::uint8_t { Dark = 0, Light };

inline constexpr std::size_t kThemeModeCount = 2;

const char* toString(ThemeMode mode) noexcept;
bool themeModeFromString(const std::string& name, ThemeMode& out) noexcept;
std::vector<ThemeMode> allThemeModes();

// ── the token set ───────────────────────────────────────────────────────────
// SEMANTIC, not descriptive: `PanelBg`, never `DarkGrey`. A descriptive name
// stops being true the moment the light theme exists, which is how a "theme"
// ends up being one palette with the names of another.
//
// Count is a sentinel and MUST stay last: kColorTokenCount is derived from it,
// and every table in Theme.cpp is sized by that.
enum class ColorToken : std::uint8_t {
  WindowBg = 0,
  PanelBg,
  PanelHeaderBg,
  MenuBarBg,
  ToolbarBg,
  StatusBg,
  ViewportBg,

  Text,
  TextMuted,
  TextDisabled,
  TextOnAccent,

  Accent,
  AccentHover,
  AccentActive,

  Border,
  Separator,
  FocusRing,

  Selection,
  Preselection,

  Success,
  Warning,
  Danger,

  ButtonBg,
  ButtonHover,
  ButtonActive,

  TabActive,
  TabInactive,
  TabHover,

  ScrollbarBg,
  ScrollbarGrab,
  GridLine,

  Count,
};

inline constexpr std::size_t kColorTokenCount = static_cast<std::size_t>(ColorToken::Count);

const char* toString(ColorToken token) noexcept;
bool colorTokenFromString(const std::string& name, ColorToken& out) noexcept;
std::vector<ColorToken> allColorTokens();

// ── the colour value ────────────────────────────────────────────────────────
// Doubles in [0,1], because this layer has no GPU and no float-precision budget
// to defend; the packed accessors are what a renderer actually consumes.
struct Rgba {
  double r = 0.0, g = 0.0, b = 0.0, a = 1.0;

  // 0xRRGGBBAA — the spelling a CSS/hex-minded reader expects.
  std::uint32_t packedRgba() const noexcept;
  // 0xAABBGGRR — the byte order Dear ImGui's IM_COL32 packs into a u32 on a
  // little-endian host. Named for what it IS rather than for ImGui, so this
  // header still owes nothing to any UI toolkit.
  std::uint32_t packedAbgr() const noexcept;
};

bool operator==(const Rgba& a, const Rgba& b) noexcept;
bool operator!=(const Rgba& a, const Rgba& b) noexcept;

// 0xRRGGBB -> Rgba. Alpha is separate because no palette entry below is
// translucent and folding it into the literal hides that.
Rgba rgbFromHex(std::uint32_t rrggbb, double alpha = 1.0) noexcept;

// WCAG 2.1 relative luminance of an sRGB colour, alpha ignored (a ratio is only
// defined between opaque colours; a caller compositing translucency must do so
// before asking).
double relativeLuminance(const Rgba& colour) noexcept;

// WCAG 2.1 contrast ratio, in [1, 21]. Symmetric.
double contrastRatio(const Rgba& a, const Rgba& b) noexcept;

// ── the palette ─────────────────────────────────────────────────────────────
class Theme {
 public:
  static Theme forMode(ThemeMode mode);

  ThemeMode mode() const noexcept { return mode_; }
  const Rgba& color(ColorToken token) const noexcept;
  double contrast(ColorToken foreground, ColorToken background) const noexcept;

  // "forge-theme 1\n<mode>\n" — the whole persistent state, because a theme is a
  // CHOICE OF PALETTE and not a user-edited colour list. Storing the resolved
  // colours would make an old session file pin an old palette for ever.
  std::string serialize() const;
  static bool parse(const std::string& text, Theme& out);

 private:
  Theme() = default;
  ThemeMode mode_ = ThemeMode::Dark;
  std::array<Rgba, kColorTokenCount> colors_{};
};

// ── the readability contract, as DATA ───────────────────────────────────────
// A requirement names the pair and the ratio it must clear, plus the reason, so
// a failure report can say what breaks rather than printing two numbers.
struct ContrastRequirement {
  ColorToken foreground;
  ColorToken background;
  double minRatio;
  const char* why;
};

const std::vector<ContrastRequirement>& contrastRequirements();

struct ContrastFailure {
  ThemeMode mode;
  ColorToken foreground;
  ColorToken background;
  double ratio = 0.0;
  double required = 0.0;
  std::string describe() const;
};

// Every requirement, in every mode. Empty means the palette is readable; the
// gate asserts exactly that, and a POSITIVE CONTROL in the gate proves this
// function can return a non-empty answer.
std::vector<ContrastFailure> auditContrast();
std::vector<ContrastFailure> auditContrast(const Theme& theme);

}  // namespace forge::ui

#endif  // FORGE_UI_THEME_HPP
