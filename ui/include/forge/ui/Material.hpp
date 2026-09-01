// ui/include/forge/ui/Material.hpp
//
// MATERIALS — the difference between a document that has a volume and a document
// that has a MASS.
//
// A part with no material has no weight, no cost and no shipping class, and the
// mass properties panel of every CAD system on the market is the first thing a
// mechanical engineer opens. Before this file the application had neither: the
// only physical quantity anywhere in the document was the kernel's volume in
// cubic millimetres.
//
// ── two things, deliberately in one record ──────────────────────────────────
// A material here carries BOTH the physical property that makes mass properties
// real (density) AND the display appearance the viewport shades with. They are
// one record because they are one user choice: picking "Aluminium 6061" must set
// the weight and the colour together, and a design where the two live in
// different tables is a design where a part can be steel and look like plastic.
//
// ── why the DOCUMENT stores the density, not just the id ────────────────────
// The library below is a convenience, not an authority. A document that stored
// only `material: al6061` would silently change weight when this table is edited,
// and would open on a build whose table lacks that id with NO density at all —
// so mass properties would vanish from a file that plainly stated its material.
// The document therefore stores the WHOLE record (id, name, density, appearance)
// and treats the library as a picker. An unknown id is REPRESENTED (kept, with
// its stored density), never refused.
//
// ── the densities ───────────────────────────────────────────────────────────
// Nominal room-temperature handbook values in kg/m^3, rounded to the precision
// the sources state. They are typical alloy values, not certified lot data: a
// 6061 extrusion is 2700 kg/m^3 nominal and no engineer should read four
// significant figures into that. Anyone who needs a certified density types it
// in, and the document stores what they typed.
#ifndef FORGE_UI_MATERIAL_HPP
#define FORGE_UI_MATERIAL_HPP

#include <string>
#include <vector>

#include "forge/ui/Units.hpp"

namespace forge::ui {

// Display appearance. Linear RGB in [0,1] plus the two PBR knobs the viewport
// actually reads; `opacity` exists because a glass or a jig fixture that is not
// see-through is a picture of the wrong part.
struct Appearance {
  double red = 0.72;
  double green = 0.74;
  double blue = 0.76;
  double metallic = 1.0;
  double roughness = 0.35;
  double opacity = 1.0;
};

bool operator==(const Appearance& a, const Appearance& b) noexcept;
bool operator!=(const Appearance& a, const Appearance& b) noexcept;

struct Material {
  std::string id = "unassigned";
  std::string name = "Unassigned";
  // kg/m^3. NOT g/cm^3: the SI form is what every material datasheet prints, and
  // a units layer exists precisely so nobody has to remember which one this is.
  double densityKgPerM3 = 0.0;
  Appearance appearance{};

  // A material with no density cannot answer "what does it weigh?", and saying
  // so is better than answering 0 g.
  bool hasDensity() const noexcept { return densityKgPerM3 > 0.0; }
};

bool operator==(const Material& a, const Material& b) noexcept;
bool operator!=(const Material& a, const Material& b) noexcept;

// The picker's table, sorted by id and deterministic. Includes the "unassigned"
// entry, because "no material chosen" is a real state a document can be in and
// hiding it would make the default unnameable.
const std::vector<Material>& materialLibrary();
const Material* findMaterial(const std::string& id);
const Material& unassignedMaterial();

// ── mass properties ─────────────────────────────────────────────────────────
// The kernel measures volume in mm^3 (it works in millimetres — see Units.hpp).
// 1 mm^3 of a material of density d kg/m^3 weighs d * 1e-6 grams, so:
//     grams = volumeMm3 * densityKgPerM3 / 1e6
// Written once, here, rather than at each of the panels that wants a weight.
double massGrams(double volumeMm3, double densityKgPerM3) noexcept;

struct MassProperties {
  double volumeMm3 = 0.0;
  double densityKgPerM3 = 0.0;
  double massGrams = 0.0;
  // False when the material has no density: the caller must show "—", not 0 g.
  bool known = false;
};

MassProperties massPropertiesOf(const Material& material, double volumeMm3) noexcept;

// "1.043 kg" in whatever unit the document displays mass in.
std::string describeMass(const MassProperties& properties, MassUnit display);

}  // namespace forge::ui

#endif  // FORGE_UI_MATERIAL_HPP
