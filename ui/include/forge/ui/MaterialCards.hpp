// ui/include/forge/ui/MaterialCards.hpp
//
// THE MATERIAL LIBRARY'S READER -- Forge's own code, reading FreeCAD's data.
//
// FreeCAD publishes a material library as text: one `.FCMat` card per material
// (a YAML document naming the physical MODELS it fills in, each with values such
// as `Density: "2700 kg/m^3"`), and one `.yml` definition per model saying what
// each property is and in what UNIT it is declared. Forge ships a licence-checked
// subset of those files in the separately linked libforge_fcmaterials library
// (third_party/freecad-derived/materials). NOTHING in this header or its .cpp is
// taken from FreeCAD: FreeCAD's own loader is Qt and yaml-cpp, and this reader is
// written for Forge from the file format, with three deliberate differences.
//
// ── WHERE THIS READER DISAGREES WITH FREECAD'S, ON PURPOSE ──────────────────
//  1. A UNIT THAT DOES NOT MATCH ITS MODEL IS REFUSED. FreeCAD's loader, on a
//     units mismatch, logs a line and KEEPS THE NUMBER in the model's unit --
//     "setting to default property units" -- so a density typed as `2.7 g/cm^3`
//     against a model declared in kg/m^3 would become 2.7 kg/m^3, a thousand
//     times too light, and the material would load as if nothing had happened.
//     Here the property is refused, by name, with both units in the reason. A
//     card whose DENSITY is refused is not offered at all: a material that
//     cannot be weighed must not be choosable in a panel that exists to weigh.
//  2. UNITS ARE CONVERTED, NOT ASSUMED. Every quantity is carried in SI with its
//     dimension, so `70000 MPa` and `70 GPa` are the same number and a pressure
//     can never be read as a density. The dimension comes from the unit symbols
//     themselves, and it must equal the dimension of the unit the model declares.
//  3. A DECIMAL COMMA IS REFUSED, NOT GUESSED. `"1200,00 kg/m^3"` exists in
//     FreeCAD's own card set. Whether that is twelve hundred or a hundred and
//     twenty thousand depends on who typed it, so it is not read as either.
//
// Everything here is plain C++20 with no third-party code, no global state and
// no I/O: the catalogue is built from file contents a caller hands over.
#ifndef FORGE_UI_MATERIALCARDS_HPP
#define FORGE_UI_MATERIALCARDS_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "forge/ui/Material.hpp"

namespace forge::ui {

// ── dimensions and quantities ───────────────────────────────────────────────
// Exponents of the SI base quantities. Everything a material card states --
// density, modulus, conductivity, expansion -- is a product of these five.
struct PhysicalDimension {
  int mass = 0;         // kg
  int length = 0;       // m
  int time = 0;         // s
  int temperature = 0;  // K
  int current = 0;      // A

  bool dimensionless() const noexcept {
    return mass == 0 && length == 0 && time == 0 && temperature == 0 && current == 0;
  }
};
bool operator==(const PhysicalDimension& a, const PhysicalDimension& b) noexcept;
bool operator!=(const PhysicalDimension& a, const PhysicalDimension& b) noexcept;

// "kg m^-3", "kg m^-1 s^-2", "1" -- the SI spelling of a dimension, for a reason
// string and a panel. Always in base units, so it cannot hide a prefix.
std::string describeDimension(const PhysicalDimension& d);

// A unit expression such as "kg/m^3", "J/kg/K", "µm/m/K" or "MS/m", read into
// the factor that takes a value in that unit to SI and the dimension it carries.
struct UnitRead {
  bool ok = false;
  double toSI = 1.0;
  PhysicalDimension dimension{};
  std::string refusal;  // set iff !ok; names the symbol that could not be read
};
UnitRead parseUnitExpression(const std::string& text);

// A number, optionally followed by a unit: "2700 kg/m^3", "0.33", "108 GPa".
struct PhysicalQuantity {
  double valueSI = 0.0;
  PhysicalDimension dimension{};
  std::string asWritten;  // the card's own text, kept for display beside the SI value
};
struct QuantityRead {
  bool ok = false;
  PhysicalQuantity quantity{};
  std::string refusal;
};
QuantityRead parsePhysicalQuantity(const std::string& text);

// ── the model definitions ───────────────────────────────────────────────────
enum class CardValueType : std::uint8_t {
  Quantity,  // a number with a unit, checked against the model's unit
  Number,    // a plain number: Float, Integer, Percentage
  Text,      // String, URL, List and every other textual kind
  Table,     // 2DArray / 3DArray: kept, not interpreted in this release
};

struct ModelProperty {
  std::string name;
  std::string typeName;   // as the model file spells it: "Quantity", "Float", "2DArray"
  CardValueType type = CardValueType::Text;
  std::string unitsText;  // "kg/m^3"; empty for a unitless property
  UnitRead unit{};        // unitsText, read
};

struct MaterialModel {
  std::string uuid;
  std::string name;
  std::string bundlePath;
  std::vector<std::string> inherits;  // model UUIDs whose properties this model also has
  std::vector<ModelProperty> properties;
};

struct ModelRead {
  bool ok = false;
  MaterialModel model{};
  std::string refusal;
};
ModelRead parseMaterialModel(const std::string& bundlePath, const std::string& text);

// ── the cards ───────────────────────────────────────────────────────────────
enum class CardPropertyState : std::uint8_t {
  Read,         // interpreted: `quantity` (Quantity/Number) or `text` holds it
  NotRead,      // a table, carried as text and not interpreted in this release
  NoModel,      // the property is in no model the card names -- FreeCAD ignores these too
  Refused,      // `refusal` says why; the value is NOT available
};

struct CardProperty {
  std::string model;  // the model section it was written under ("LinearElastic")
  std::string name;   // "Density"
  CardValueType type = CardValueType::Text;
  CardPropertyState state = CardPropertyState::NoModel;
  std::string text;                // the value as written in the card
  PhysicalQuantity quantity{};     // for Quantity and Number when state == Read
  std::string declaredUnits;       // the model's unit for it, "" when unitless
  std::string refusal;
};

struct MaterialCard {
  std::string id;           // "steel-s235jr": the file name, lower-cased, without .FCMat
  std::string bundlePath;   // "Resources/Materials/Standard/Metal/Steel/Steel-S235JR.FCMat"
  std::string category;     // "Metal / Steel", from the folder the card sits in
  std::string uuid;
  std::string name;         // General.Name ("S235JR"); the file stem when the card has none
  std::string author;
  std::string license;
  std::string description;
  std::string sourceUrl;
  std::string referenceSource;
  std::string parentUuid;   // Inherits: the card this one refines, when it names one
  std::string parentName;   // the key it is named by ("Steel"), which chooses its shading
  bool parentInLibrary = false;
  std::vector<std::string> tags;
  std::vector<CardProperty> properties;

  // The property called `name`, or null. When a card writes one property under
  // two models the first is returned.
  const CardProperty* property(const std::string& name) const noexcept;
  // The SI value of a property that was read, or null when it was not.
  const PhysicalQuantity* quantity(const std::string& name) const noexcept;
  // The text of a property, "" when absent.
  std::string text(const std::string& name) const;
};

// ── the catalogue ───────────────────────────────────────────────────────────
struct MaterialLibraryFile {
  std::string path;   // relative to FreeCAD's src/Mod/Material/, as the library reports it
  std::string bytes;  // the file's contents
};

struct CardRefusal {
  std::string bundlePath;
  std::string reason;
};

class MaterialCatalogue {
 public:
  // Reads every model definition first and then every card against them. A file
  // that cannot be read is REPORTED in refusals(), never silently dropped, and
  // never stops the rest of the library loading.
  static std::shared_ptr<const MaterialCatalogue> build(
      const std::vector<MaterialLibraryFile>& files, std::string upstreamCommit = {});

  // Cards that were read and CAN be weighed, sorted by id.
  const std::vector<MaterialCard>& cards() const noexcept { return cards_; }
  const std::vector<MaterialModel>& models() const noexcept { return models_; }
  const std::vector<CardRefusal>& refusals() const noexcept { return refusals_; }
  const std::string& upstreamCommit() const noexcept { return upstreamCommit_; }

  const MaterialCard* findCard(const std::string& id) const noexcept;
  // The card as the document's material record: id, name, density from the
  // card, and the shading Forge gives cards of its kind.
  const Material* findMaterial(const std::string& id) const noexcept;
  const std::vector<Material>& materials() const noexcept { return materials_; }

 private:
  std::vector<MaterialCard> cards_;
  std::vector<Material> materials_;  // parallel to cards_
  std::vector<MaterialModel> models_;
  std::vector<CardRefusal> refusals_;
  std::string upstreamCommit_;
};

// One card, read against the models given. Exposed so a gate can hand it a card
// with a defect in it and watch the defect be refused.
struct CardRead {
  bool ok = false;
  MaterialCard card{};
  std::string refusal;
};
CardRead parseMaterialCard(const std::string& bundlePath, const std::string& text,
                           const std::vector<MaterialModel>& models);

// The material a document may be given under `id`: Forge's handbook table first,
// then the card library when one is supplied. Null when neither holds that name.
const Material* resolveMaterial(const std::string& id, const MaterialCatalogue* cards);

}  // namespace forge::ui

#endif  // FORGE_UI_MATERIALCARDS_HPP
