// ui/test/units_test.cpp
//
// UNITS AND MATERIALS — the two things that turn a pile of doubles into a part
// somebody can weigh.
//
// Every check asserts a VALUE against a REFERENCE, and the references here are
// DEFINITIONS rather than numbers someone measured: the international inch is
// exactly 25.4 mm and the avoirdupois pound exactly 0.45359237 kg (1959
// international yard and pound agreement, NIST SP 811 App. B.6), so `25.4` and
// `453.59237` below are the standard, not a rounding of it.
//
// The parser is tested on BOTH halves of its contract:
//   * what it must ACCEPT — "12", "12mm", "0.5in", "1/2 in", "1ft 6in", 5'11",
//     any case, any spacing. A parser that refuses a legitimate spelling is a
//     capability gate, and it fires hardest on the densest input.
//   * what it must REFUSE, and how — never silently as 0, always with a status,
//     the OFFENDING TOKEN and its byte OFFSET, so a repair loop can act.
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/Material.hpp"
#include "forge/ui/Units.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// EXACT: these are the values a double can hold precisely, and a tolerance would
// hide a conversion that had quietly become 25.400000000000002.
void checkExact(Harness& H, double got, double want, const char* what) {
  ++H.checks;
  if (got == want) return;
  ++H.failures;
  std::printf("  FAIL %s: got %.17g, want %.17g (EXACT equality required)\n", what, got, want);
}

void unitNames(Harness& H) {
  for (LengthUnit u : allLengthUnits()) {
    LengthUnit back = LengthUnit::Metre;
    CHECK(lengthUnitFromName(toString(u), back));
    CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(u));
    CHECK(std::string(unitLabel(u)).size() > 1);
  }
  for (AngleUnit u : allAngleUnits()) {
    AngleUnit back = AngleUnit::Radian;
    CHECK(angleUnitFromName(toString(u), back));
    CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(u));
  }
  for (MassUnit u : allMassUnits()) {
    MassUnit back = MassUnit::Pound;
    CHECK(massUnitFromName(toString(u), back));
    CHECK_EQ_INT(static_cast<int>(back), static_cast<int>(u));
  }

  // Aliases and case. A user who types "INCHES" has not made a mistake.
  LengthUnit u = LengthUnit::Millimetre;
  CHECK(lengthUnitFromName("INCHES", u) && u == LengthUnit::Inch);
  CHECK(lengthUnitFromName("Inch", u) && u == LengthUnit::Inch);
  CHECK(lengthUnitFromName("\"", u) && u == LengthUnit::Inch);
  CHECK(lengthUnitFromName("'", u) && u == LengthUnit::Foot);
  CHECK(lengthUnitFromName("feet", u) && u == LengthUnit::Foot);
  CHECK(lengthUnitFromName("MilliMeters", u) && u == LengthUnit::Millimetre);
  CHECK(lengthUnitFromName("mil", u) && u == LengthUnit::Thou);
  CHECK(lengthUnitFromName("microns", u) && u == LengthUnit::Micrometre);
  CHECK(!lengthUnitFromName("furlong", u));
  CHECK(!lengthUnitFromName("", u));

  // The internal unit is a NAMED constant, not a convention in a comment.
  CHECK_EQ_INT(static_cast<int>(kInternalLengthUnit), static_cast<int>(LengthUnit::Millimetre));
  CHECK_EQ_STR(toString(kInternalLengthUnit), "mm");
  CHECK_EQ_STR(toString(kInternalAngleUnit), "deg");
  CHECK_EQ_STR(toString(kInternalMassUnit), "g");
}

void conversions(Harness& H) {
  checkExact(H, millimetresPerUnit(LengthUnit::Millimetre), 1.0, "mm factor");
  checkExact(H, millimetresPerUnit(LengthUnit::Inch), 25.4, "inch factor (definition)");
  checkExact(H, millimetresPerUnit(LengthUnit::Foot), 304.8, "foot factor (12 x 25.4)");
  checkExact(H, millimetresPerUnit(LengthUnit::Thou), 0.0254, "thou factor (25.4/1000)");
  checkExact(H, toMillimetres(1.0, LengthUnit::Inch), 25.4, "1 in -> mm");
  checkExact(H, toMillimetres(2.0, LengthUnit::Metre), 2000.0, "2 m -> mm");
  checkExact(H, fromMillimetres(25.4, LengthUnit::Inch), 1.0, "25.4 mm -> in");
  checkExact(H, fromMillimetres(304.8, LengthUnit::Foot), 1.0, "304.8 mm -> ft");
  CHECK_NEAR(toMillimetres(1000.0, LengthUnit::Thou), 25.4, 1e-12);

  checkExact(H, degreesPerUnit(AngleUnit::Degree), 1.0, "degree factor");
  CHECK_NEAR(toDegrees(1.0, AngleUnit::Radian), 57.29577951308232, 1e-12);
  CHECK_NEAR(fromDegrees(180.0, AngleUnit::Radian), 3.14159265358979323846, 1e-12);

  checkExact(H, gramsPerUnit(MassUnit::Kilogram), 1000.0, "kg factor");
  checkExact(H, gramsPerUnit(MassUnit::Pound), 453.59237, "pound factor (definition)");
  CHECK_NEAR(gramsPerUnit(MassUnit::Ounce), 28.349523125, 1e-12);
  checkExact(H, toGrams(2.0, MassUnit::Kilogram), 2000.0, "2 kg -> g");
  checkExact(H, fromGrams(1000.0, MassUnit::Kilogram), 1.0, "1000 g -> kg");
}

void parsingAccepts(Harness& H) {
  struct Case {
    const char* text;
    LengthUnit fallback;
    double millimetres;
    bool explicitUnit;
  };
  const Case cases[] = {
      {"12", LengthUnit::Millimetre, 12.0, false},
      {"12mm", LengthUnit::Millimetre, 12.0, true},
      {"12 mm", LengthUnit::Millimetre, 12.0, true},
      {"  12.5  MM  ", LengthUnit::Millimetre, 12.5, true},
      {"0.5in", LengthUnit::Millimetre, 12.7, true},
      {"0.5 inches", LengthUnit::Millimetre, 12.7, true},
      {".5in", LengthUnit::Millimetre, 12.7, true},
      {"1/2 in", LengthUnit::Millimetre, 12.7, true},
      {"1/2in", LengthUnit::Millimetre, 12.7, true},
      {"1 1/2 in", LengthUnit::Millimetre, 38.1, true},
      {"1ft 6in", LengthUnit::Millimetre, 457.2, true},
      {"1' 6\"", LengthUnit::Millimetre, 457.2, true},
      {"5'11\"", LengthUnit::Millimetre, 1803.4, true},
      {"-3in", LengthUnit::Millimetre, -76.2, true},
      {"+3in", LengthUnit::Millimetre, 76.2, true},
      {"1e1mm", LengthUnit::Millimetre, 10.0, true},
      {"2", LengthUnit::Inch, 50.8, false},          // the FALLBACK unit is used
      {"2mm", LengthUnit::Inch, 2.0, true},          // ...and overridden when named
      {"3 thou", LengthUnit::Millimetre, 0.0762, true},
      {"1 m", LengthUnit::Millimetre, 1000.0, true},
      {"0", LengthUnit::Millimetre, 0.0, false},
  };
  for (const Case& c : cases) {
    const QuantityParse p = parseLength(c.text, c.fallback);
    if (!p.ok()) {
      ++H.failures;
      ++H.checks;
      std::printf("  FAIL parseLength(\"%s\") refused: %s near '%s'\n", c.text,
                  toString(p.status), p.offendingText.c_str());
      continue;
    }
    ++H.checks;
    if (std::fabs(p.value - c.millimetres) > 1e-9) {
      ++H.failures;
      std::printf("  FAIL parseLength(\"%s\") = %.12g mm, want %.12g mm\n", c.text, p.value,
                  c.millimetres);
    }
    CHECK_EQ_INT(p.unitWasExplicit ? 1 : 0, c.explicitUnit ? 1 : 0);
  }

  // Angles travel the same road.
  const QuantityParse deg = parseAngle("45", AngleUnit::Degree);
  CHECK(deg.ok());
  CHECK_NEAR(deg.value, 45.0, 1e-12);
  const QuantityParse rad = parseAngle("1 rad", AngleUnit::Degree);
  CHECK(rad.ok());
  CHECK_NEAR(rad.value, 57.29577951308232, 1e-9);
  const QuantityParse implied = parseAngle("2", AngleUnit::Radian);
  CHECK(implied.ok());
  CHECK_NEAR(implied.value, 114.59155902616465, 1e-9);
}

void parsingRefusesLoudly(Harness& H) {
  struct Case {
    const char* text;
    UnitParse status;
    const char* offending;
    std::size_t offset;
  };
  const Case cases[] = {
      {"", UnitParse::Empty, "", 0},
      {"   ", UnitParse::Empty, "", 0},
      {"abc", UnitParse::NoNumber, "abc", 0},
      {"12 furlongs", UnitParse::UnknownUnit, "furlongs", 3},
      {"3/0", UnitParse::DivideByZero, "/0", 1},
      {"12mm5", UnitParse::TrailingText, "5", 4},
      {"12mm ?", UnitParse::TrailingText, "?", 5},
      {"1e999", UnitParse::NotFinite, "1e999", 0},
  };
  for (const Case& c : cases) {
    const QuantityParse p = parseLength(c.text, LengthUnit::Millimetre);
    ++H.checks;
    if (p.ok()) {
      ++H.failures;
      std::printf("  FAIL parseLength(\"%s\") was ACCEPTED as %.12g mm\n", c.text, p.value);
      continue;
    }
    CHECK_EQ_STR(toString(p.status), toString(c.status));
    // A refusal that does not name the token cannot be repaired by anything but
    // a human re-reading their own input.
    if (c.offending[0] != '\0') {
      CHECK_EQ_STR(p.offendingText, c.offending);
      CHECK_EQ_INT(p.offendingOffset, c.offset);
    }
    // A refused parse must not smuggle a value out.
    checkExact(H, p.value, 0.0, "a refused parse yields no value");
  }
}

void formatting(Harness& H) {
  CHECK_EQ_STR(formatLength(12.0, LengthUnit::Millimetre), "12 mm");
  CHECK_EQ_STR(formatLength(25.4, LengthUnit::Inch), "1 in");
  CHECK_EQ_STR(formatLength(12.7, LengthUnit::Inch), "0.5 in");
  CHECK_EQ_STR(formatLength(457.2, LengthUnit::Foot), "1.5 ft");
  CHECK_EQ_STR(formatLength(12.5, LengthUnit::Millimetre), "12.5 mm");
  CHECK_EQ_STR(formatLengthValue(12.0, LengthUnit::Millimetre), "12");
  CHECK_EQ_STR(formatAngle(90.0, AngleUnit::Degree), "90 deg");
  CHECK_EQ_STR(formatMass(2700.0, MassUnit::Kilogram), "2.7 kg");
  // A negative zero shown as "-0" reads as a different number from 0.
  CHECK_EQ_STR(formatLength(-0.0, LengthUnit::Millimetre), "0 mm");

  // DISPLAY round trip: what a field shows, typed back in, is what it was.
  const double values[] = {0.0, 1.0, 12.0, 12.7, 25.4, 100.5, 1803.4, -76.2};
  for (LengthUnit u : allLengthUnits()) {
    for (double mm : values) {
      const std::string shown = formatLength(mm, u, 10);
      const QuantityParse back = parseLength(shown, u);
      ++H.checks;
      if (!back.ok() || std::fabs(back.value - mm) > 1e-6 * (1.0 + std::fabs(mm))) {
        ++H.failures;
        std::printf("  FAIL display round trip: %.12g mm -> \"%s\" -> %.12g mm (%s)\n", mm,
                    shown.c_str(), back.value, toString(back.status));
      }
    }
  }
}

void exactStorage(Harness& H) {
  // STORAGE round trip is BIT-exact, which display formatting is not: a document
  // that changes a value when it is saved and reloaded has not round-tripped.
  const double values[] = {0.0,
                           1.0,
                           2.5,
                           -0.0,
                           0.1 + 0.2,
                           1.0 / 3.0,
                           25.4,
                           1e-300,
                           1e300,
                           123456789.123456789,
                           -4.9406564584124654e-324};
  for (double v : values) {
    const std::string text = formatRoundTripNumber(v);
    double back = 0.0;
    CHECK(parseRoundTripNumber(text, back));
    ++H.checks;
    if (back != v) {
      ++H.failures;
      std::printf("  FAIL storage round trip: %.17g -> \"%s\" -> %.17g\n", v, text.c_str(), back);
    }
  }
  // The short forms stay short: an exact formatter that printed 17 digits for
  // 2.5 would make every document file unreadable.
  CHECK_EQ_STR(formatRoundTripNumber(2.5), "2.5");
  CHECK_EQ_STR(formatRoundTripNumber(12.0), "12");
  CHECK_EQ_STR(formatRoundTripNumber(0.0), "0");

  double ignored = 0.0;
  CHECK(!parseRoundTripNumber("", ignored));
  CHECK(!parseRoundTripNumber("12abc", ignored));   // a prefix is not a number
  CHECK(!parseRoundTripNumber("abc", ignored));
  CHECK(parseRoundTripNumber("  12  ", ignored));   // surrounding space is fine
  CHECK_NEAR(ignored, 12.0, 0.0);
}

void materials(Harness& H) {
  const std::vector<Material>& library = materialLibrary();
  CHECK(library.size() >= 10);
  for (std::size_t i = 0; i < library.size(); ++i) {
    CHECK(!library[i].id.empty());
    CHECK(!library[i].name.empty());
    CHECK(library[i].densityKgPerM3 >= 0.0);
    if (i > 0) CHECK(library[i - 1].id < library[i].id);  // sorted AND unique
  }

  const Material* aluminium = findMaterial("aluminium-6061");
  CHECK(aluminium != nullptr);
  if (aluminium != nullptr) {
    checkExact(H, aluminium->densityKgPerM3, 2700.0, "6061 nominal density");
    CHECK(aluminium->hasDensity());
  }
  CHECK(findMaterial("unobtainium") == nullptr);
  CHECK(!unassignedMaterial().hasDensity());

  // 1 cm^3 == 1000 mm^3. Aluminium at 2700 kg/m^3 is 2.7 g/cm^3.
  CHECK_NEAR(massGrams(1000.0, 2700.0), 2.7, 1e-12);
  CHECK_NEAR(massGrams(1000.0, 7870.0), 7.87, 1e-12);
  // 1 litre of aluminium is 2.7 kg.
  CHECK_NEAR(massGrams(1.0e6, 2700.0), 2700.0, 1e-9);

  const Material steel = *findMaterial("steel-1018");
  const MassProperties p = massPropertiesOf(steel, 77583.539933);
  CHECK(p.known);
  CHECK_NEAR(p.volumeMm3, 77583.539933, 1e-9);
  CHECK_NEAR(p.massGrams, 77583.539933 * 7870.0 / 1.0e6, 1e-9);
  CHECK_EQ_STR(describeMass(p, MassUnit::Gram), formatMass(p.massGrams, MassUnit::Gram, 4));

  // A part with no material must report UNKNOWN, not 0 g: 0 g is a measurement
  // the document never made.
  const MassProperties none = massPropertiesOf(unassignedMaterial(), 77583.5);
  CHECK(!none.known);
  CHECK_EQ_STR(describeMass(none, MassUnit::Gram), "-- (no density)");

  Appearance a;
  Appearance b;
  CHECK(a == b);
  b.roughness += 0.5;
  CHECK(a != b);
  Material m1 = steel;
  Material m2 = steel;
  CHECK(m1 == m2);
  m2.densityKgPerM3 += 1.0;
  CHECK(m1 != m2);
}

}  // namespace

int main() {
  Harness H("units_and_materials");
  unitNames(H);
  conversions(H);
  parsingAccepts(H);
  parsingRefusesLoudly(H);
  formatting(H);
  exactStorage(H);
  materials(H);
  return H.finish();
}
