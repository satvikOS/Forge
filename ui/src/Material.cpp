#include "forge/ui/Material.hpp"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "forge/ui/Units.hpp"

namespace forge::ui {
namespace {

// Two appearances are the same when every channel is, to a tolerance far below
// what a screen can show. An exact == on doubles would make a colour that
// survived a save/load round trip compare unequal on its last bit.
bool sameChannel(double a, double b) noexcept { return std::fabs(a - b) <= 1e-12; }

Material make(const char* id, const char* name, double density, double r, double g, double b,
              double metallic, double roughness) {
  Material m;
  m.id = id;
  m.name = name;
  m.densityKgPerM3 = density;
  m.appearance.red = r;
  m.appearance.green = g;
  m.appearance.blue = b;
  m.appearance.metallic = metallic;
  m.appearance.roughness = roughness;
  m.appearance.opacity = 1.0;
  return m;
}

}  // namespace

bool operator==(const Appearance& a, const Appearance& b) noexcept {
  return sameChannel(a.red, b.red) && sameChannel(a.green, b.green) &&
         sameChannel(a.blue, b.blue) && sameChannel(a.metallic, b.metallic) &&
         sameChannel(a.roughness, b.roughness) && sameChannel(a.opacity, b.opacity);
}
bool operator!=(const Appearance& a, const Appearance& b) noexcept { return !(a == b); }

bool operator==(const Material& a, const Material& b) noexcept {
  return a.id == b.id && a.name == b.name && sameChannel(a.densityKgPerM3, b.densityKgPerM3) &&
         a.appearance == b.appearance;
}
bool operator!=(const Material& a, const Material& b) noexcept { return !(a == b); }

// ── the library ─────────────────────────────────────────────────────────────
// Nominal handbook densities, kg/m^3 at room temperature. Sorted by id so the
// picker, the manifest and any test that walks the table see one order.
const std::vector<Material>& materialLibrary() {
  static const std::vector<Material> table = [] {
    std::vector<Material> v{
        make("abs", "ABS", 1040.0, 0.22, 0.23, 0.25, 0.0, 0.55),
        make("aluminium-6061", "Aluminium 6061-T6", 2700.0, 0.83, 0.85, 0.87, 1.0, 0.35),
        make("aluminium-7075", "Aluminium 7075-T6", 2810.0, 0.82, 0.84, 0.87, 1.0, 0.33),
        make("brass-c360", "Brass C360", 8500.0, 0.85, 0.72, 0.35, 1.0, 0.28),
        make("bronze-c932", "Bearing Bronze C932", 8800.0, 0.72, 0.55, 0.35, 1.0, 0.38),
        make("cast-iron-grey", "Grey Cast Iron", 7200.0, 0.36, 0.36, 0.38, 1.0, 0.62),
        make("copper-c110", "Copper C110", 8940.0, 0.78, 0.45, 0.30, 1.0, 0.26),
        make("hdpe", "HDPE", 950.0, 0.85, 0.86, 0.84, 0.0, 0.60),
        make("magnesium-az31", "Magnesium AZ31B", 1770.0, 0.76, 0.76, 0.74, 1.0, 0.45),
        make("nylon-66", "Nylon 6/6", 1140.0, 0.90, 0.88, 0.80, 0.0, 0.50),
        make("peek", "PEEK", 1320.0, 0.72, 0.60, 0.30, 0.0, 0.45),
        make("pla", "PLA", 1240.0, 0.35, 0.62, 0.45, 0.0, 0.50),
        make("polycarbonate", "Polycarbonate", 1200.0, 0.80, 0.84, 0.88, 0.0, 0.25),
        make("pom-acetal", "Acetal (POM)", 1410.0, 0.92, 0.92, 0.90, 0.0, 0.42),
        make("ptfe", "PTFE", 2200.0, 0.96, 0.96, 0.95, 0.0, 0.40),
        make("stainless-304", "Stainless 304", 8000.0, 0.74, 0.76, 0.78, 1.0, 0.30),
        make("stainless-316", "Stainless 316", 8000.0, 0.73, 0.75, 0.77, 1.0, 0.30),
        make("steel-1018", "Mild Steel 1018", 7870.0, 0.55, 0.57, 0.60, 1.0, 0.45),
        make("steel-4140", "Alloy Steel 4140", 7850.0, 0.50, 0.52, 0.56, 1.0, 0.42),
        make("titanium-ti6al4v", "Titanium Ti-6Al-4V", 4430.0, 0.66, 0.64, 0.62, 1.0, 0.40),
    };
    // "No material chosen" is a real document state and must be nameable.
    Material none;
    none.id = "unassigned";
    none.name = "Unassigned";
    none.densityKgPerM3 = 0.0;
    v.push_back(none);
    std::sort(v.begin(), v.end(),
              [](const Material& a, const Material& b) { return a.id < b.id; });
    return v;
  }();
  return table;
}

const Material* findMaterial(const std::string& id) {
  const std::vector<Material>& table = materialLibrary();
  for (const Material& m : table) {
    if (m.id == id) return &m;
  }
  return nullptr;
}

const Material& unassignedMaterial() {
  static const Material fallback = [] {
    const Material* m = findMaterial("unassigned");
    return m != nullptr ? *m : Material{};
  }();
  return fallback;
}

// ── mass properties ─────────────────────────────────────────────────────────
double massGrams(double volumeMm3, double densityKgPerM3) noexcept {
  return volumeMm3 * densityKgPerM3 / 1.0e6;
}

MassProperties massPropertiesOf(const Material& material, double volumeMm3) noexcept {
  MassProperties p;
  p.volumeMm3 = volumeMm3;
  p.densityKgPerM3 = material.densityKgPerM3;
  p.known = material.hasDensity();
  p.massGrams = p.known ? massGrams(volumeMm3, material.densityKgPerM3) : 0.0;
  return p;
}

std::string describeMass(const MassProperties& properties, MassUnit display) {
  // An unknown mass is reported as unknown. Printing "0 g" for a part whose
  // material was never chosen is a measurement the document never made.
  if (!properties.known) return "-- (no density)";
  return formatMass(properties.massGrams, display, 4);
}

}  // namespace forge::ui
