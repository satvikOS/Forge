// ui/include/forge/ui/Units.hpp
//
// UNITS, MADE EXPLICIT — the layer that stops "12" from being a number whose
// meaning depends on who reads it.
//
// ── the rule this header exists to state ────────────────────────────────────
// THE KERNEL WORKS IN MILLIMETRES. forge::ft's ops take bare doubles (RECT(80,
// 50), FILLET(%4, 3)) and every one of them is a millimetre; the feature-IR
// grammar has no unit token and will not grow one, because a unit inside the IR
// would be a second place for a length to mean something. That was IMPLICIT: the
// number 80 travelled from a UI field, through a CommandParams, into an IrArg and
// out to the kernel without one line of code ever saying what it measured. A user
// typing an inch value got a millimetre part, and nothing in the system could
// have noticed.
//
// So this header makes it explicit and keeps it in exactly one place:
//
//   * `kInternalLengthUnit` NAMES the internal unit. Everything stored, emitted
//     or compared is in it.
//   * `toMillimetres` / `fromMillimetres` are the ONLY conversion, and they are
//     exact-by-table: the international inch is 25.4 mm by definition, so the
//     factors are written as definitions rather than as decimals someone typed.
//   * `parseLength` is the unit-aware ENTRY point: "12", "12mm", "0.5in", "1/2
//     in", "1ft 6in", '5\' 11"' all arrive as millimetres.
//   * `formatLength` is the DISPLAY exit, and `parseLength(formatLength(x, u), u)`
//     returns x — proved in ui/test/units_test.cpp rather than asserted here.
//
// ── refusal policy ──────────────────────────────────────────────────────────
// A parser that refuses is a capability gate wearing a safety hat, and it fires
// hardest on the densest input. So this one TOLERATES everything it can read:
// any case, any spacing, any alias, a bare number, a fraction, a mixed number, a
// sum of terms. When it genuinely cannot read something it does not answer 0 —
// it returns a status, the OFFENDING TEXT and its byte OFFSET, so a caller (or a
// repair loop) can point at the character that broke and fix it. "Could not
// parse" with no location is the same as silence.
#ifndef FORGE_UI_UNITS_HPP
#define FORGE_UI_UNITS_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// ── the unit sets ───────────────────────────────────────────────────────────
// Ordered so the enumerator value is stable: it is written into the document
// format by NAME, never by number, but a stable order keeps menus stable too.
enum class LengthUnit : std::uint8_t {
  Millimetre = 0,
  Centimetre,
  Metre,
  Micrometre,
  Inch,
  Foot,
  Thou,  // 1/1000 inch, the imperial machining unit ("mil")
};

enum class AngleUnit : std::uint8_t { Degree = 0, Radian };

enum class MassUnit : std::uint8_t { Gram = 0, Kilogram, Pound, Ounce };

// THE internal units. Every double this application stores, compares or emits is
// in these; a display unit is a presentation choice and never a storage choice.
inline constexpr LengthUnit kInternalLengthUnit = LengthUnit::Millimetre;
inline constexpr AngleUnit kInternalAngleUnit = AngleUnit::Degree;
inline constexpr MassUnit kInternalMassUnit = MassUnit::Gram;

const char* toString(LengthUnit unit) noexcept;  // "mm" "cm" "m" "um" "in" "ft" "thou"
const char* toString(AngleUnit unit) noexcept;   // "deg" "rad"
const char* toString(MassUnit unit) noexcept;    // "g" "kg" "lb" "oz"

// The human name, for menus: "millimetre", "inch", ...
const char* unitLabel(LengthUnit unit) noexcept;

const std::vector<LengthUnit>& allLengthUnits();
const std::vector<AngleUnit>& allAngleUnits();
const std::vector<MassUnit>& allMassUnits();

// Case-insensitive, alias-tolerant. "MM", "millimeter", "millimetres" all name
// LengthUnit::Millimetre; `"` names Inch and `'` names Foot.
bool lengthUnitFromName(const std::string& name, LengthUnit& out) noexcept;
bool angleUnitFromName(const std::string& name, AngleUnit& out) noexcept;
bool massUnitFromName(const std::string& name, MassUnit& out) noexcept;

// ── conversion ──────────────────────────────────────────────────────────────
// Exact by definition where a definition exists: the international inch is
// exactly 25.4 mm (NIST SP 811, and the 1959 international yard and pound
// agreement), so foot = 304.8 and thou = 0.0254 follow exactly. Nothing here is
// a rounded decimal someone measured.
double millimetresPerUnit(LengthUnit unit) noexcept;
double toMillimetres(double value, LengthUnit unit) noexcept;
double fromMillimetres(double millimetres, LengthUnit unit) noexcept;

double degreesPerUnit(AngleUnit unit) noexcept;
double toDegrees(double value, AngleUnit unit) noexcept;
double fromDegrees(double degrees, AngleUnit unit) noexcept;

// The avoirdupois pound is exactly 0.45359237 kg by the same agreement, so the
// gram factor is exact too; the ounce is a pound/16.
double gramsPerUnit(MassUnit unit) noexcept;
double toGrams(double value, MassUnit unit) noexcept;
double fromGrams(double grams, MassUnit unit) noexcept;

// ── unit-aware entry ────────────────────────────────────────────────────────
enum class UnitParse : std::uint8_t {
  Ok = 0,
  Empty,          // nothing but whitespace
  NoNumber,       // a term that begins with something that is not a digit or '.'
  BadNumber,      // digits that strtod could not finish reading
  UnknownUnit,    // a unit word no alias table knows
  DivideByZero,   // "3/0"
  NotFinite,      // the text read as inf or nan
  TrailingText,   // characters after the last complete term
};

const char* toString(UnitParse status) noexcept;

// The result of reading one user-typed quantity.
//
// `value` is ALWAYS in the internal unit (millimetres for length, degrees for
// angle) — a caller never has to remember to convert, which is the whole point.
// `unit` reports which unit the text named, so a UI can echo it back.
struct QuantityParse {
  UnitParse status = UnitParse::Ok;
  double value = 0.0;
  LengthUnit lengthUnit = kInternalLengthUnit;
  AngleUnit angleUnit = kInternalAngleUnit;
  bool unitWasExplicit = false;
  // WHAT broke and WHERE. A refusal that does not name the offending token
  // cannot be repaired by anything but a human re-reading their own input.
  std::string offendingText;
  std::size_t offendingOffset = 0;

  bool ok() const noexcept { return status == UnitParse::Ok; }
};

// Grammar, stated once so the tests can quote it:
//
//   quantity := ws* sign? term (ws* term)* ws*
//   term     := magnitude ws* unit?
//   magnitude:= number | number '/' number | number ws+ number '/' number
//   number   := digits ['.' digits] [('e'|'E') sign? digits] | '.' digits
//   unit     := letters | '"' | '\''
//
// Terms SUM, which is what makes 1ft 6in and 5' 11" work. A term with no unit
// takes `fallback`. A leading '-' negates the whole sum.
QuantityParse parseLength(const std::string& text, LengthUnit fallback);
QuantityParse parseAngle(const std::string& text, AngleUnit fallback);

// ── display ─────────────────────────────────────────────────────────────────
// Deterministic and locale-independent (snprintf with the C locale's "%.*f",
// trailing zeros trimmed). `decimals` is the MAXIMUM shown; a value that needs
// fewer prints fewer, so 12 mm is "12 mm" and not "12.0000 mm".
std::string formatLength(double millimetres, LengthUnit display, int decimals = 4);
std::string formatAngle(double degrees, AngleUnit display, int decimals = 4);
std::string formatMass(double grams, MassUnit display, int decimals = 4);

// The same three without the unit suffix, for a field the UI labels separately.
std::string formatLengthValue(double millimetres, LengthUnit display, int decimals = 4);

// ── exact numeric storage ───────────────────────────────────────────────────
// NOT formatIrNumber(). That one is "%.10g" and is the right answer for IR text,
// which is a published surface a human and a VLM both read; it is LOSSY at the
// 11th significant figure. A document file is not read by a VLM, and a value that
// changes when you save and reload is a document that does not round-trip — so
// storage uses the SHORTEST representation that strtod maps back to the identical
// double, found by trying increasing precision and stopping at the first exact
// one. 2.5 still writes as "2.5"; 0.1+0.2 writes as "0.30000000000000004" and
// comes back bit-identical.
std::string formatRoundTripNumber(double value);
// Reads what formatRoundTripNumber wrote, plus anything strtod accepts. Refuses
// trailing junk rather than silently taking a prefix.
bool parseRoundTripNumber(const std::string& text, double& out);

}  // namespace forge::ui

#endif  // FORGE_UI_UNITS_HPP
