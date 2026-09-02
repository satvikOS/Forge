#include "forge/ui/Units.hpp"

#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace forge::ui {
namespace {

bool isWs(char c) noexcept { return std::isspace(static_cast<unsigned char>(c)) != 0; }
bool isDigit(char c) noexcept { return std::isdigit(static_cast<unsigned char>(c)) != 0; }
bool isAlpha(char c) noexcept { return std::isalpha(static_cast<unsigned char>(c)) != 0; }

std::string lower(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return out;
}

// Trailing-zero trim for a fixed-notation rendering. "12.0000" -> "12",
// "12.5000" -> "12.5", "-0" -> "0" (a negative zero displayed as "-0" reads to a
// user as a different number from 0, and it is not one).
std::string trimFixed(const std::string& text) {
  std::string s = text;
  if (s.find('.') != std::string::npos) {
    std::size_t end = s.size();
    while (end > 0 && s[end - 1] == '0') --end;
    if (end > 0 && s[end - 1] == '.') --end;
    s = s.substr(0, end);
  }
  if (s == "-0") return "0";
  return s;
}

std::string fixed(double value, int decimals) {
  int d = decimals;
  if (d < 0) d = 0;
  if (d > 15) d = 15;
  char buf[64];
  const int n = std::snprintf(buf, sizeof(buf), "%.*f", d, value);
  if (n <= 0) return "0";
  return trimFixed(std::string(buf, static_cast<std::size_t>(n)));
}

}  // namespace

// ── names ───────────────────────────────────────────────────────────────────
const char* toString(LengthUnit unit) noexcept {
  switch (unit) {
    case LengthUnit::Millimetre: return "mm";
    case LengthUnit::Centimetre: return "cm";
    case LengthUnit::Metre:      return "m";
    case LengthUnit::Micrometre: return "um";
    case LengthUnit::Inch:       return "in";
    case LengthUnit::Foot:       return "ft";
    case LengthUnit::Thou:       return "thou";
  }
  return "mm";
}

const char* unitLabel(LengthUnit unit) noexcept {
  switch (unit) {
    case LengthUnit::Millimetre: return "millimetre";
    case LengthUnit::Centimetre: return "centimetre";
    case LengthUnit::Metre:      return "metre";
    case LengthUnit::Micrometre: return "micrometre";
    case LengthUnit::Inch:       return "inch";
    case LengthUnit::Foot:       return "foot";
    case LengthUnit::Thou:       return "thou";
  }
  return "millimetre";
}

const char* toString(AngleUnit unit) noexcept {
  switch (unit) {
    case AngleUnit::Degree: return "deg";
    case AngleUnit::Radian: return "rad";
  }
  return "deg";
}

const char* toString(MassUnit unit) noexcept {
  switch (unit) {
    case MassUnit::Gram:     return "g";
    case MassUnit::Kilogram: return "kg";
    case MassUnit::Pound:    return "lb";
    case MassUnit::Ounce:    return "oz";
  }
  return "g";
}

const std::vector<LengthUnit>& allLengthUnits() {
  static const std::vector<LengthUnit> all{LengthUnit::Millimetre, LengthUnit::Centimetre,
                                           LengthUnit::Metre,      LengthUnit::Micrometre,
                                           LengthUnit::Inch,       LengthUnit::Foot,
                                           LengthUnit::Thou};
  return all;
}

const std::vector<AngleUnit>& allAngleUnits() {
  static const std::vector<AngleUnit> all{AngleUnit::Degree, AngleUnit::Radian};
  return all;
}

const std::vector<MassUnit>& allMassUnits() {
  static const std::vector<MassUnit> all{MassUnit::Gram, MassUnit::Kilogram, MassUnit::Pound,
                                         MassUnit::Ounce};
  return all;
}

bool lengthUnitFromName(const std::string& name, LengthUnit& out) noexcept {
  const std::string n = lower(name);
  if (n == "mm" || n == "millimetre" || n == "millimetres" || n == "millimeter" ||
      n == "millimeters") {
    out = LengthUnit::Millimetre;
    return true;
  }
  if (n == "cm" || n == "centimetre" || n == "centimetres" || n == "centimeter" ||
      n == "centimeters") {
    out = LengthUnit::Centimetre;
    return true;
  }
  if (n == "m" || n == "metre" || n == "metres" || n == "meter" || n == "meters") {
    out = LengthUnit::Metre;
    return true;
  }
  if (n == "um" || n == "micron" || n == "microns" || n == "micrometre" || n == "micrometres" ||
      n == "micrometer" || n == "micrometers") {
    out = LengthUnit::Micrometre;
    return true;
  }
  if (n == "in" || n == "inch" || n == "inches" || n == "\"") {
    out = LengthUnit::Inch;
    return true;
  }
  if (n == "ft" || n == "foot" || n == "feet" || n == "'") {
    out = LengthUnit::Foot;
    return true;
  }
  if (n == "thou" || n == "thous" || n == "mil" || n == "mils") {
    out = LengthUnit::Thou;
    return true;
  }
  return false;
}

bool angleUnitFromName(const std::string& name, AngleUnit& out) noexcept {
  const std::string n = lower(name);
  if (n == "deg" || n == "degs" || n == "degree" || n == "degrees") {
    out = AngleUnit::Degree;
    return true;
  }
  if (n == "rad" || n == "rads" || n == "radian" || n == "radians") {
    out = AngleUnit::Radian;
    return true;
  }
  return false;
}

bool massUnitFromName(const std::string& name, MassUnit& out) noexcept {
  const std::string n = lower(name);
  if (n == "g" || n == "gram" || n == "grams" || n == "gramme" || n == "grammes") {
    out = MassUnit::Gram;
    return true;
  }
  if (n == "kg" || n == "kilogram" || n == "kilograms" || n == "kilo" || n == "kilos") {
    out = MassUnit::Kilogram;
    return true;
  }
  if (n == "lb" || n == "lbs" || n == "pound" || n == "pounds") {
    out = MassUnit::Pound;
    return true;
  }
  if (n == "oz" || n == "ounce" || n == "ounces") {
    out = MassUnit::Ounce;
    return true;
  }
  return false;
}

// ── conversion ──────────────────────────────────────────────────────────────
// The imperial factors are DEFINITIONS, not measurements: the international inch
// has been exactly 25.4 mm since the 1959 international yard and pound agreement
// (NIST SP 811 App. B.6). Writing 25.4 as a decimal is therefore exact, and
// 304.8 / 0.0254 are exact multiples of it.
double millimetresPerUnit(LengthUnit unit) noexcept {
  switch (unit) {
    case LengthUnit::Millimetre: return 1.0;
    case LengthUnit::Centimetre: return 10.0;
    case LengthUnit::Metre:      return 1000.0;
    case LengthUnit::Micrometre: return 0.001;
    case LengthUnit::Inch:       return 25.4;
    case LengthUnit::Foot:       return 304.8;
    case LengthUnit::Thou:       return 0.0254;
  }
  return 1.0;
}

double toMillimetres(double value, LengthUnit unit) noexcept {
  return value * millimetresPerUnit(unit);
}

double fromMillimetres(double millimetres, LengthUnit unit) noexcept {
  return millimetres / millimetresPerUnit(unit);
}

double degreesPerUnit(AngleUnit unit) noexcept {
  switch (unit) {
    case AngleUnit::Degree: return 1.0;
    case AngleUnit::Radian: return 180.0 / 3.14159265358979323846;
  }
  return 1.0;
}

double toDegrees(double value, AngleUnit unit) noexcept { return value * degreesPerUnit(unit); }
double fromDegrees(double degrees, AngleUnit unit) noexcept { return degrees / degreesPerUnit(unit); }

// The avoirdupois pound is exactly 0.45359237 kg by the same 1959 agreement.
double gramsPerUnit(MassUnit unit) noexcept {
  switch (unit) {
    case MassUnit::Gram:     return 1.0;
    case MassUnit::Kilogram: return 1000.0;
    case MassUnit::Pound:    return 453.59237;
    case MassUnit::Ounce:    return 453.59237 / 16.0;
  }
  return 1.0;
}

double toGrams(double value, MassUnit unit) noexcept { return value * gramsPerUnit(unit); }
double fromGrams(double grams, MassUnit unit) noexcept { return grams / gramsPerUnit(unit); }

const char* toString(UnitParse status) noexcept {
  switch (status) {
    case UnitParse::Ok:           return "ok";
    case UnitParse::Empty:        return "empty";
    case UnitParse::NoNumber:     return "no_number";
    case UnitParse::BadNumber:    return "bad_number";
    case UnitParse::UnknownUnit:  return "unknown_unit";
    case UnitParse::DivideByZero: return "divide_by_zero";
    case UnitParse::NotFinite:    return "not_finite";
    case UnitParse::TrailingText: return "trailing_text";
  }
  return "ok";
}

// ── the parser ──────────────────────────────────────────────────────────────
namespace {

// One scan, shared by length and angle. `resolve` maps a unit word onto a factor
// into the internal unit and reports whether it knew the word; the empty word
// asks for the fallback unit. Written once because a second copy of a number
// scanner is a second set of edge cases.
struct ScanOut {
  UnitParse status = UnitParse::Ok;
  double value = 0.0;
  bool anyExplicit = false;
  std::string offending;
  std::size_t offset = 0;
};

// Reads a decimal number starting at `i`. Returns false without moving `i` when
// there is no number there.
bool readNumber(const std::string& text, std::size_t& i, double& out) {
  const char* base = text.c_str();
  char* end = nullptr;
  const double v = std::strtod(base + i, &end);
  if (end == base + i) return false;
  i = static_cast<std::size_t>(end - base);
  out = v;
  return true;
}

template <typename Resolve>
ScanOut scanQuantity(const std::string& text, Resolve resolve) {
  ScanOut r;
  const std::size_t n = text.size();
  std::size_t i = 0;
  while (i < n && isWs(text[i])) ++i;
  if (i >= n) {
    r.status = UnitParse::Empty;
    return r;
  }

  double sign = 1.0;
  if (text[i] == '+' || text[i] == '-') {
    if (text[i] == '-') sign = -1.0;
    ++i;
    while (i < n && isWs(text[i])) ++i;
  }

  double total = 0.0;
  bool sawTerm = false;
  bool prevUnitWasSymbol = false;

  while (true) {
    bool sawWs = false;
    while (i < n && isWs(text[i])) {
      ++i;
      sawWs = true;
    }
    if (i >= n) break;

    // A second term must be separated by whitespace, UNLESS the previous term
    // ended in a symbol unit -- 5'11" is one quantity everywhere in the imperial
    // world, while "12mm5" is a typo, and reading it as 17 mm would be a silent
    // wrong answer rather than a repairable one.
    if (sawTerm && !sawWs && !prevUnitWasSymbol) {
      r.status = UnitParse::TrailingText;
      r.offending = text.substr(i);
      r.offset = i;
      return r;
    }

    if (!isDigit(text[i]) && text[i] != '.') {
      // Name the TOKEN, not the whole string: a repair loop needs the character.
      std::size_t j = i;
      while (j < n && !isWs(text[j])) ++j;
      r.status = sawTerm ? UnitParse::TrailingText : UnitParse::NoNumber;
      r.offending = text.substr(i, j - i);
      r.offset = i;
      return r;
    }

    const std::size_t numberAt = i;
    double magnitude = 0.0;
    if (!readNumber(text, i, magnitude)) {
      r.status = UnitParse::BadNumber;
      r.offending = text.substr(numberAt);
      r.offset = numberAt;
      return r;
    }
    if (!std::isfinite(magnitude)) {
      r.status = UnitParse::NotFinite;
      r.offending = text.substr(numberAt, i - numberAt);
      r.offset = numberAt;
      return r;
    }

    // magnitude := number '/' number   (a plain fraction)
    if (i < n && text[i] == '/') {
      const std::size_t slashAt = i;
      std::size_t k = i + 1;
      double den = 0.0;
      if (!readNumber(text, k, den)) {
        r.status = UnitParse::BadNumber;
        r.offending = text.substr(slashAt);
        r.offset = slashAt;
        return r;
      }
      if (den == 0.0) {
        r.status = UnitParse::DivideByZero;
        r.offending = text.substr(slashAt, k - slashAt);
        r.offset = slashAt;
        return r;
      }
      magnitude = magnitude / den;
      i = k;
    } else {
      // magnitude := number ws+ number '/' number   (a mixed number: 5 1/2)
      std::size_t j = i;
      while (j < n && isWs(text[j])) ++j;
      if (j > i && j < n && isDigit(text[j])) {
        std::size_t k = j;
        double whole = 0.0;
        if (readNumber(text, k, whole) && k < n && text[k] == '/') {
          std::size_t m = k + 1;
          double den = 0.0;
          if (readNumber(text, m, den)) {
            if (den == 0.0) {
              r.status = UnitParse::DivideByZero;
              r.offending = text.substr(k, m - k);
              r.offset = k;
              return r;
            }
            magnitude = magnitude + whole / den;
            i = m;
          }
        }
      }
    }

    // term := magnitude ws* unit?
    std::size_t u = i;
    while (u < n && isWs(text[u])) ++u;
    double factor = 0.0;
    prevUnitWasSymbol = false;
    if (u < n && (isAlpha(text[u]) || text[u] == '"' || text[u] == '\'')) {
      std::size_t end = u;
      if (text[u] == '"' || text[u] == '\'') {
        end = u + 1;
        prevUnitWasSymbol = true;
      } else {
        while (end < n && isAlpha(text[end])) ++end;
      }
      const std::string word = text.substr(u, end - u);
      if (!resolve(word, factor)) {
        r.status = UnitParse::UnknownUnit;
        r.offending = word;
        r.offset = u;
        return r;
      }
      r.anyExplicit = true;
      i = end;
    } else {
      resolve(std::string(), factor);  // the fallback unit
    }

    total += magnitude * factor;
    sawTerm = true;
  }

  if (!sawTerm) {
    r.status = UnitParse::Empty;
    return r;
  }
  r.value = sign * total;
  if (!std::isfinite(r.value)) {
    r.status = UnitParse::NotFinite;
    r.offending = text;
    return r;
  }
  return r;
}

}  // namespace

QuantityParse parseLength(const std::string& text, LengthUnit fallback) {
  LengthUnit named = fallback;
  const ScanOut s = scanQuantity(text, [&named, fallback](const std::string& word, double& factor) {
    if (word.empty()) {
      factor = millimetresPerUnit(fallback);
      return true;
    }
    LengthUnit u = fallback;
    if (!lengthUnitFromName(word, u)) return false;
    named = u;
    factor = millimetresPerUnit(u);
    return true;
  });

  QuantityParse out;
  out.status = s.status;
  out.value = s.value;
  out.lengthUnit = s.anyExplicit ? named : fallback;
  out.unitWasExplicit = s.anyExplicit;
  out.offendingText = s.offending;
  out.offendingOffset = s.offset;
  if (!out.ok()) out.value = 0.0;
  return out;
}

QuantityParse parseAngle(const std::string& text, AngleUnit fallback) {
  AngleUnit named = fallback;
  const ScanOut s = scanQuantity(text, [&named, fallback](const std::string& word, double& factor) {
    if (word.empty()) {
      factor = degreesPerUnit(fallback);
      return true;
    }
    AngleUnit u = fallback;
    if (!angleUnitFromName(word, u)) return false;
    named = u;
    factor = degreesPerUnit(u);
    return true;
  });

  QuantityParse out;
  out.status = s.status;
  out.value = s.value;
  out.angleUnit = s.anyExplicit ? named : fallback;
  out.unitWasExplicit = s.anyExplicit;
  out.offendingText = s.offending;
  out.offendingOffset = s.offset;
  if (!out.ok()) out.value = 0.0;
  return out;
}

// ── display ─────────────────────────────────────────────────────────────────
std::string formatLengthValue(double millimetres, LengthUnit display, int decimals) {
  return fixed(fromMillimetres(millimetres, display), decimals);
}

std::string formatLength(double millimetres, LengthUnit display, int decimals) {
  return formatLengthValue(millimetres, display, decimals) + " " + toString(display);
}

std::string formatAngle(double degrees, AngleUnit display, int decimals) {
  return fixed(fromDegrees(degrees, display), decimals) + " " + toString(display);
}

std::string formatMass(double grams, MassUnit display, int decimals) {
  return fixed(fromGrams(grams, display), decimals) + " " + toString(display);
}

// ── exact numeric storage ───────────────────────────────────────────────────
std::string formatRoundTripNumber(double value) {
  char buf[64];
  for (int precision = 1; precision <= 17; ++precision) {
    const int n = std::snprintf(buf, sizeof(buf), "%.*g", precision, value);
    if (n <= 0 || static_cast<std::size_t>(n) >= sizeof(buf)) continue;
    const std::string text(buf, static_cast<std::size_t>(n));
    char* end = nullptr;
    const double back = std::strtod(text.c_str(), &end);
    if (end != nullptr && *end == '\0' && back == value) return text;
  }
  const int n = std::snprintf(buf, sizeof(buf), "%.17g", value);
  return n > 0 ? std::string(buf, static_cast<std::size_t>(n)) : std::string("0");
}

bool parseRoundTripNumber(const std::string& text, double& out) {
  std::size_t begin = 0;
  while (begin < text.size() && isWs(text[begin])) ++begin;
  std::size_t end = text.size();
  while (end > begin && isWs(text[end - 1])) --end;
  if (begin >= end) return false;
  const std::string body = text.substr(begin, end - begin);
  const char* base = body.c_str();
  char* stop = nullptr;
  const double v = std::strtod(base, &stop);
  if (stop == base || stop == nullptr || *stop != '\0') return false;
  out = v;
  return true;
}

}  // namespace forge::ui
