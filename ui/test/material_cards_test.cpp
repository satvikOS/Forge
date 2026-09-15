// ui/test/material_cards_test.cpp
//
// FORGE'S MATERIAL CARD READER AND MASS PROPERTIES, headless and with no library
// linked: the reader is fed text, so every refusal can be provoked on purpose.
//
//   1. UNITS: every unit the shipped cards and models use reads to the right SI
//      factor and dimension; an unknown symbol and a missing power are refused.
//   2. QUANTITIES: a decimal comma is refused rather than read either way.
//   3. THE YAML SUBSET: a byte-order mark, folded text, a bracketed list over three
//      lines and a `- key:` list item all read; a tab indent and a repeated key are
//      refused with a line number.
//   4. CARDS: a value in the wrong dimension is REFUSED (FreeCAD relabels it); a
//      convertible unit is converted; a property no model defines is marked, not
//      read; a card without a density is not offered; a name the handbook already
//      uses is refused; a parent card inside the library lends its properties.
//   5. THE SHIPPED LIBRARY, read from the source tree as data: 115 cards and 12
//      models, no refusal, and the aluminium and steel figures their text states.
//   6. MASS PROPERTIES: rho*V in kg, the inertia scaled by rho*1e-9, principal
//      moments by Jacobi against a rotated diagonal, and a refusal -- never a
//      number -- for no density, an unmeasured shape and a stale program.
//   7. THE COMMANDS: part.set_material resolves a card and refuses an unknown
//      name BY NAME; part.mass_properties and part.check_mass return evidence,
//      and refuse without a measurement.
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/MassProperties.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/MaterialCards.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string repoRoot() {
#ifdef FORGE_UI_REPO_ROOT
  return std::string(FORGE_UI_REPO_ROOT);
#else
  return std::string(".");
#endif
}

std::string readFile(const std::filesystem::path& p) {
  std::ifstream in(p, std::ios::binary);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

bool dimIs(const PhysicalDimension& d, int m, int l, int t, int k, int a) {
  return d.mass == m && d.length == l && d.time == t && d.temperature == k && d.current == a;
}

const char* kDensityModel = R"(# SPDX-License-Identifier: LGPL-2.1-or-later
Model:
  Name: 'Density'
  UUID: '454661e5-265b-4320-8e6f-fcf6223ac3af'
  Density:
    Type: 'Quantity'
    Units: 'kg/m^3'
)";

const char* kElasticModel = R"(---
Model:
  Name: 'Linear Elastic'
  UUID: '7b561d1d-fb9b-44f6-9da9-56a4f74d7536'
  Description: >
    Materials that are linearly elastic obey Hooke's law i.e. the stress and
    strain relationship is linear
  Inherits:
    - Density:
      UUID: '454661e5-265b-4320-8e6f-fcf6223ac3af'
  YoungsModulus:
    DisplayName: "Young's Modulus"
    Type: 'Quantity'
    Units: 'kPa'
    URL:
      'https://en.wikipedia.org/wiki/Young%27s_modulus'
  PoissonRatio:
    Type: 'Float'
    Units: ''
  Table:
    Type: '2DArray'
    Columns:
      Temperature:
        Type: 'Quantity'
        Units: 'C'
)";

std::string card(const std::string& density, const std::string& extra = "") {
  return "\xEF\xBB\xBF---\n"
         "# a card written for this test\n"
         "General:\n"
         "  UUID: \"11111111-2222-3333-4444-555555555555\"\n"
         "  Author: \"Forge test\"\n"
         "  License: \"LGPL-2.1-or-later\"\n"
         "  Name: \"Test Alloy\"\n"
         "  Tags:\n"
         "    - \"one\"\n"
         "    - \"two\"\n"
         "Models:\n"
         "  LinearElastic:\n"
         "    UUID: '7b561d1d-fb9b-44f6-9da9-56a4f74d7536'\n"
         "    Density: \"" + density + "\"\n"
         "    YoungsModulus: \"70 GPa\"\n"
         "    PoissonRatio: \"0.33\"\n"
         "    Table:\n"
         "      - [[\"295 K\", \"108 GPa\"],\n"
         "         [\"195 K\", \"114 GPa\"],\n"
         "         [\"76 K\",  \"115 GPa\"]]\n" + extra;
}

std::vector<MaterialModel> testModels(Harness& H) {
  std::vector<MaterialModel> out;
  for (const char* text : {kDensityModel, kElasticModel}) {
    ModelRead m = parseMaterialModel("Resources/Models/test.yml", text);
    CHECK(m.ok);
    if (m.ok) out.push_back(m.model);
  }
  return out;
}

void units(Harness& H) {
  const UnitRead density = parseUnitExpression("kg/m^3");
  CHECK(density.ok);
  CHECK_NEAR(density.toSI, 1.0, 1e-15);
  CHECK(dimIs(density.dimension, 1, -3, 0, 0, 0));

  const UnitRead mpa = parseUnitExpression("MPa");
  CHECK(mpa.ok && dimIs(mpa.dimension, 1, -1, -2, 0, 0));
  CHECK_NEAR(mpa.toSI, 1.0e6, 1e-6);
  const UnitRead kpa = parseUnitExpression("kPa");
  CHECK(kpa.ok && kpa.dimension == mpa.dimension);
  CHECK_NEAR(kpa.toSI, 1.0e3, 1e-9);

  const UnitRead cp = parseUnitExpression("J/kg/K");
  CHECK(cp.ok && dimIs(cp.dimension, 0, 2, -2, -1, 0));
  const UnitRead k = parseUnitExpression("W/m/K");
  CHECK(k.ok && dimIs(k.dimension, 1, 1, -3, -1, 0));
  const UnitRead micro = parseUnitExpression("\xC2\xB5m/m/K");  // µm/m/K as the cards write it
  CHECK(micro.ok && dimIs(micro.dimension, 0, 0, 0, -1, 0));
  CHECK_NEAR(micro.toSI, 1.0e-6, 1e-18);
  const UnitRead inverse = parseUnitExpression("1/K");
  CHECK(inverse.ok && inverse.dimension == micro.dimension);
  const UnitRead ratio = parseUnitExpression("m/m/K");
  CHECK(ratio.ok && ratio.dimension == micro.dimension);
  const UnitRead siemens = parseUnitExpression("MS/m");
  CHECK(siemens.ok && dimIs(siemens.dimension, -1, -3, 3, 0, 2));
  CHECK_NEAR(siemens.toSI, 1.0e6, 1e-6);
  const UnitRead gcc = parseUnitExpression("g/cm^3");
  CHECK(gcc.ok && gcc.dimension == density.dimension);
  CHECK_NEAR(gcc.toSI, 1000.0, 1e-9);
  const UnitRead empty = parseUnitExpression("");
  CHECK(empty.ok && empty.dimension.dimensionless());
  CHECK_EQ_STR(describeDimension(mpa.dimension), "kg m^-1 s^-2");

  CHECK(!parseUnitExpression("furlong").ok);
  CHECK(!parseUnitExpression("m^").ok);
  CHECK(!parseUnitExpression("C").ok);  // coulomb or Celsius: not guessed
  CHECK(parseUnitExpression("furlong").refusal.find("furlong") != std::string::npos);
}

void quantities(Harness& H) {
  const QuantityRead q = parsePhysicalQuantity("70000 MPa");
  CHECK(q.ok);
  CHECK_NEAR(q.quantity.valueSI, 7.0e10, 1.0);
  const QuantityRead e = parsePhysicalQuantity("2.1e5 MPa");
  CHECK(e.ok);
  CHECK_NEAR(e.quantity.valueSI, 2.1e11, 1.0);
  const QuantityRead plain = parsePhysicalQuantity("0.33");
  CHECK(plain.ok && plain.quantity.dimension.dimensionless());
  const QuantityRead comma = parsePhysicalQuantity("1200,00 kg/m^3");
  CHECK(!comma.ok);
  CHECK(comma.refusal.find("comma") != std::string::npos);
  CHECK(!parsePhysicalQuantity("kg/m^3").ok);
  CHECK(!parsePhysicalQuantity("").ok);
  CHECK(!parsePhysicalQuantity("nan kg").ok);
}

void cards(Harness& H) {
  const std::vector<MaterialModel> models = testModels(H);
  CHECK_EQ_INT(models.size(), 2);
  if (models.size() == 2) {
    CHECK_EQ_INT(models[1].inherits.size(), 1);
    CHECK_EQ_INT(models[1].properties.size(), 3);
  }

  // A good card, with a BOM, a list, a multi-line table and three models.
  const CardRead good = parseMaterialCard(
      "Resources/Materials/Standard/Metal/Test/Test-Alloy.FCMat", card("2700 kg/m^3"), models);
  CHECK(good.ok);
  CHECK_EQ_STR(good.card.id, "test-alloy");
  CHECK_EQ_STR(good.card.category, "Metal / Test");
  CHECK_EQ_STR(good.card.name, "Test Alloy");
  CHECK_EQ_INT(good.card.tags.size(), 2);
  const PhysicalQuantity* rho = good.card.quantity("Density");
  CHECK(rho != nullptr);
  CHECK_NEAR(rho == nullptr ? 0.0 : rho->valueSI, 2700.0, 1e-9);
  const PhysicalQuantity* young = good.card.quantity("YoungsModulus");
  CHECK_NEAR(young == nullptr ? 0.0 : young->valueSI, 7.0e10, 1.0);
  const CardProperty* table = good.card.property("Table");
  CHECK(table != nullptr && table->state == CardPropertyState::NotRead);

  // The WRONG DIMENSION, refused -- FreeCAD would call this 2700 kg/m^3.
  const CardRead wrong = parseMaterialCard("Resources/Materials/Standard/X/Bad.FCMat",
                                           card("2700 MPa"), models);
  CHECK(wrong.ok);
  const CardProperty* bad = wrong.card.property("Density");
  CHECK(bad != nullptr && bad->state == CardPropertyState::Refused);
  CHECK(bad != nullptr && bad->refusal.find("MPa") != std::string::npos);
  CHECK(bad != nullptr && bad->refusal.find("kg/m^3") != std::string::npos);
  CHECK(wrong.card.quantity("Density") == nullptr);

  // A plain number given a unit is refused too.
  const CardRead unitOnFloat = parseMaterialCard(
      "Resources/Materials/Standard/X/Bad2.FCMat",
      card("2700 kg/m^3").replace(card("2700 kg/m^3").find("\"0.33\""), 6, "\"0.33 m\""), models);
  const CardProperty* nu = unitOnFloat.card.property("PoissonRatio");
  CHECK(nu != nullptr && nu->state == CardPropertyState::Refused);

  // A convertible unit, converted.
  const CardRead grams = parseMaterialCard("Resources/Materials/Standard/X/G.FCMat",
                                           card("2.7 g/cm^3"), models);
  const PhysicalQuantity* g = grams.card.quantity("Density");
  CHECK_NEAR(g == nullptr ? 0.0 : g->valueSI, 2700.0, 1e-9);

  // Yaml the reader refuses, with a line number.
  const CardRead tab = parseMaterialCard("Resources/Materials/T.FCMat",
                                         "General:\n\tUUID: \"x\"\n", models);
  CHECK(!tab.ok && tab.refusal.find("line 2") != std::string::npos);
  const CardRead twice = parseMaterialCard(
      "Resources/Materials/T.FCMat", "General:\n  UUID: \"a\"\n  UUID: \"b\"\n", models);
  CHECK(!twice.ok && twice.refusal.find("repeats") != std::string::npos);
  const CardRead open = parseMaterialCard(
      "Resources/Materials/T.FCMat", "General:\n  UUID: \"a\n", models);
  CHECK(!open.ok);

  // ── the catalogue ──────────────────────────────────────────────────────
  std::vector<MaterialLibraryFile> files{
      {"Resources/Models/Mechanical/Density.yml", kDensityModel},
      {"Resources/Models/Mechanical/LinearElastic.yml", kElasticModel},
      {"Resources/Materials/Standard/Metal/Test/Test-Alloy.FCMat", card("2700 kg/m^3")},
  };
  // No density at all: not offered.
  std::string noDensity = card("1 kg/m^3");
  noDensity.erase(noDensity.find("    Density:"), std::string("    Density: \"1 kg/m^3\"\n").size());
  noDensity.replace(noDensity.find("11111111"), 8, "99999999");
  files.push_back({"Resources/Materials/Standard/Metal/Test/Weightless.FCMat", noDensity});
  // A handbook name: refused.
  std::string handbook = card("7870 kg/m^3");
  handbook.replace(handbook.find("11111111"), 8, "22222222");
  files.push_back({"Resources/Materials/Standard/Metal/Steel-1018.FCMat", handbook});
  // A child of Test-Alloy that states no density of its own: inherits it.
  std::string child = card("1 kg/m^3");
  child.erase(child.find("    Density:"), std::string("    Density: \"1 kg/m^3\"\n").size());
  child.replace(child.find("11111111"), 8, "33333333");
  child.replace(child.find("Models:"), 7,
                "Inherits:\n  TestAlloy:\n    UUID: \"11111111-2222-3333-4444-555555555555\"\n"
                "Models:");
  files.push_back({"Resources/Materials/Standard/Metal/Test/Child.FCMat", child});
  files.push_back({"Resources/Materials/readme.txt", "not a card"});

  const std::shared_ptr<const MaterialCatalogue> cat = MaterialCatalogue::build(files, "abc");
  CHECK_EQ_INT(cat->models().size(), 2);
  CHECK_EQ_INT(cat->cards().size(), 2);  // test-alloy and child
  CHECK(cat->findCard("test-alloy") != nullptr);
  CHECK(cat->findCard("weightless") == nullptr);
  CHECK(cat->findCard("steel-1018") == nullptr);
  const MaterialCard* inherited = cat->findCard("child");
  CHECK(inherited != nullptr && inherited->parentInLibrary);
  const Material* childMaterial = cat->findMaterial("child");
  CHECK_NEAR(childMaterial == nullptr ? 0.0 : childMaterial->densityKgPerM3, 2700.0, 1e-9);
  CHECK_EQ_INT(cat->refusals().size(), 3);
  CHECK_EQ_STR(cat->upstreamCommit(), "abc");
  // resolveMaterial: the handbook answers first, the cards second, nothing else.
  CHECK(resolveMaterial("steel-1018", cat.get()) == findMaterial("steel-1018"));
  CHECK(resolveMaterial("test-alloy", cat.get()) == cat->findMaterial("test-alloy"));
  CHECK(resolveMaterial("test-alloy", nullptr) == nullptr);
  CHECK(resolveMaterial("unobtanium", cat.get()) == nullptr);
}

void shippedLibrary(Harness& H) {
  namespace fs = std::filesystem;
  const fs::path base = fs::path(repoRoot()) / "third_party" / "freecad-derived" / "materials";
  std::vector<MaterialLibraryFile> files;
  std::error_code ec;
  for (fs::recursive_directory_iterator it(base / "Resources", ec), end; !ec && it != end;
       it.increment(ec)) {
    if (!it->is_regular_file()) continue;
    const std::string rel = fs::relative(it->path(), base).generic_string();
    files.push_back({rel, readFile(it->path())});
  }
  CHECK_EQ_INT(files.size(), 127);
  const std::shared_ptr<const MaterialCatalogue> cat = MaterialCatalogue::build(files);
  CHECK_EQ_INT(cat->models().size(), 12);
  CHECK_EQ_INT(cat->cards().size(), 115);
  CHECK_EQ_INT(cat->refusals().size(), 0);
  for (const CardRefusal& r : cat->refusals()) {
    std::printf("  refused %s: %s\n", r.bundlePath.c_str(), r.reason.c_str());
  }
  std::size_t refusedProperties = 0;
  for (const MaterialCard& c : cat->cards()) {
    for (const CardProperty& p : c.properties) {
      if (p.state == CardPropertyState::Refused) ++refusedProperties;
    }
    CHECK(c.license == "LGPL-2.0-or-later" || c.license == "LGPL-2.1-or-later");
  }
  CHECK_EQ_INT(refusedProperties, 0);
  const Material* al = cat->findMaterial("aluminum-generic");
  CHECK_NEAR(al == nullptr ? 0.0 : al->densityKgPerM3, 2700.0, 0.0);
  const Material* steel = cat->findMaterial("steel-s235jr");
  CHECK_NEAR(steel == nullptr ? 0.0 : steel->densityKgPerM3, 7800.0, 0.0);
  const MaterialCard* alCard = cat->findCard("aluminum-generic");
  const PhysicalQuantity* e = alCard == nullptr ? nullptr : alCard->quantity("YoungsModulus");
  CHECK_NEAR(e == nullptr ? 0.0 : e->valueSI, 7.0e10, 1.0);  // "70000 MPa"
  const PhysicalQuantity* alpha =
      alCard == nullptr ? nullptr : alCard->quantity("ThermalExpansionCoefficient");
  CHECK_NEAR(alpha == nullptr ? 0.0 : alpha->valueSI, 23.1e-6, 1e-15);  // "23.1 µm/m/K"
}

void massProperties(Harness& H) {
  std::array<double, 3> ev{};
  CHECK(symmetricEigenvalues({3, 0, 0, 0, 1, 0, 0, 0, 2}, ev));
  CHECK_NEAR(ev[0], 1.0, 1e-12);
  CHECK_NEAR(ev[1], 2.0, 1e-12);
  CHECK_NEAR(ev[2], 3.0, 1e-12);
  // diag(1, 2, 4) rotated 30 degrees about z, then 40 about x.
  {
    const double c1 = std::cos(0.5235987755982988), s1 = std::sin(0.5235987755982988);
    const double c2 = std::cos(0.6981317007977318), s2 = std::sin(0.6981317007977318);
    const double r[9] = {c1, -s1 * c2, s1 * s2, s1, c1 * c2, -c1 * s2, 0.0, s2, c2};
    const double d[3] = {1.0, 2.0, 4.0};
    std::array<double, 9> m{};
    for (int i = 0; i < 3; ++i) {
      for (int j = 0; j < 3; ++j) {
        double v = 0.0;
        for (int k = 0; k < 3; ++k) v += r[i * 3 + k] * d[k] * r[j * 3 + k];
        m[static_cast<std::size_t>(i * 3 + j)] = v;
      }
    }
    CHECK(symmetricEigenvalues(m, ev));
    CHECK_NEAR(ev[0], 1.0, 1e-10);
    CHECK_NEAR(ev[1], 2.0, 1e-10);
    CHECK_NEAR(ev[2], 4.0, 1e-10);
    m[1] += 1.0;  // no longer symmetric
    CHECK(!symmetricEigenvalues(m, ev));
  }

  Material al;
  al.id = "aluminum-generic";
  al.name = "Aluminum Generic";
  al.densityKgPerM3 = 2700.0;
  GeometricIntegrals g;
  g.known = true;
  g.program = "%1 = BOX(100, 50, 10)";
  g.volumeMm3 = 50000.0;
  g.centroidMm = {0.0, 0.0, 5.0};
  g.inertiaUnitDensityMm5 = {50000.0 * 2600.0 / 12.0, 0, 0, 0, 50000.0 * 10100.0 / 12.0, 0,
                             0, 0, 50000.0 * 12500.0 / 12.0};
  const MassPropertiesReport r = massPropertiesFor(al, g, g.program);
  CHECK(r.known);
  CHECK_NEAR(r.massKg, 0.135, 1e-15);
  CHECK_NEAR(r.inertiaKgMm2[0], 29.25, 1e-12);
  CHECK_NEAR(r.inertiaKgMm2[4], 113.625, 1e-12);
  CHECK_NEAR(r.inertiaKgMm2[8], 140.625, 1e-12);
  CHECK_NEAR(r.principalMomentsKgMm2[0], 29.25, 1e-12);
  CHECK(r.evidence().find("mass_kg=0.135 ") != std::string::npos);
  CHECK(r.evidence().find("material=aluminum-generic") != std::string::npos);

  CHECK(!massPropertiesFor(unassignedMaterial(), g, g.program).known);
  const MassPropertiesReport stale = massPropertiesFor(al, g, g.program + "\n%2 = BOX(1,1,1)");
  CHECK(!stale.known && stale.refusal.find("changed") != std::string::npos);
  GeometricIntegrals unmeasured;
  unmeasured.refusal = "the shape did not build, so it has no mass";
  CHECK_EQ_STR(massPropertiesFor(al, unmeasured, "").refusal, unmeasured.refusal);
  GeometricIntegrals impossible = g;
  impossible.inertiaUnitDensityMm5 = {1, 0, 0, 0, 1, 0, 0, 0, 5};  // I1 + I2 < I3
  CHECK(!massPropertiesFor(al, impossible, g.program).known);
  CHECK_EQ_STR(MassPropertiesReport{}.evidence(), "mass_known=0");
}

void commands(Harness& H) {
  std::vector<MaterialLibraryFile> files{
      {"Resources/Models/Mechanical/Density.yml", kDensityModel},
      {"Resources/Models/Mechanical/LinearElastic.yml", kElasticModel},
      {"Resources/Materials/Standard/Metal/Test/Test-Alloy.FCMat", card("2700 kg/m^3")},
  };
  const std::shared_ptr<const MaterialCatalogue> cat = MaterialCatalogue::build(files);
  PartDocument doc;
  UndoStack undo;
  CommandRegistry registry;
  SelectionService selection;
  PartCommandServices services;
  services.materials = cat;
  GeometricIntegrals measured;
  measured.known = true;
  measured.volumeMm3 = 50000.0;
  measured.inertiaUnitDensityMm5 = {1000, 0, 0, 0, 1000, 0, 0, 0, 1000};
  services.measuredIntegrals = [&measured, &doc]() {
    GeometricIntegrals g = measured;
    g.program = doc.irProgram();
    return g;
  };
  CHECK(registerPartCommands(registry, doc, undo, services) > 0);

  CommandParams pick;
  pick.setText("material", "test-alloy");
  CHECK(registry.dispatch("part.set_material", selection, pick).ok());
  CHECK_EQ_STR(doc.material().id, "test-alloy");
  CommandParams nope;
  nope.setText("material", "unobtanium-9000");
  const DispatchResult refused = registry.dispatch("part.set_material", selection, nope);
  CHECK(refused.status == DispatchStatus::EditRefused);
  CHECK(refused.detail.find("unobtanium-9000") != std::string::npos);
  CHECK_EQ_STR(doc.material().id, "test-alloy");

  const DispatchResult mp = registry.dispatch("part.mass_properties", selection, {});
  CHECK(mp.ok());
  CHECK(mp.evidence.find("mass_kg=0.135 ") != std::string::npos);
  CommandParams budget;
  budget.setNumber("kilograms", 0.135);
  CHECK(registry.dispatch("part.check_mass", selection, budget).ok());
  budget.setNumber("kilograms", 0.2);
  const DispatchResult over = registry.dispatch("part.check_mass", selection, budget);
  CHECK(!over.ok() && over.detail.find("0.135") != std::string::npos);
  CHECK(over.evidence.find("mass_kg=") != std::string::npos);
  // A zero or negative budget is not a budget: the command does not offer itself.
  budget.setNumber("kilograms", 0.0);
  CHECK(registry.dispatch("part.check_mass", selection, budget).status == DispatchStatus::Disabled);

  // No services: the handbook still resolves, the card does not, the query refuses.
  PartDocument bare;
  UndoStack bareUndo;
  CommandRegistry bareRegistry;
  registerPartCommands(bareRegistry, bare, bareUndo);
  CHECK(bareRegistry.dispatch("part.set_material", selection, pick).status ==
        DispatchStatus::EditRefused);
  CommandParams handbook;
  handbook.setText("material", "steel-1018");
  CHECK(bareRegistry.dispatch("part.set_material", selection, handbook).ok());
  const DispatchResult none = bareRegistry.dispatch("part.mass_properties", selection, {});
  CHECK(none.status == DispatchStatus::EditRefused);
  CHECK(none.detail.find("nothing measures") != std::string::npos);
}

}  // namespace

int main() {
  Harness H("material_cards");
  units(H);
  quantities(H);
  cards(H);
  shippedLibrary(H);
  massProperties(H);
  commands(H);
  return H.finish();
}
