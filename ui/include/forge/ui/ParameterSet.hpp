// ui/include/forge/ui/ParameterSet.hpp
//
// WHAT A PART'S PARAMETERS ARE, AS DATA.
//
// Two kinds of record, both owned by the part document (PartDocument::parameters):
//
//   * a PARAMETER -- a name and the formula that defines it:
//         wall   = 3 mm
//         hole_d = wall * 0.5 + 2 mm
//   * a BINDING  -- one number of one feature, driven by a formula:
//         Hole 5, dia = hole_d
//         Shell 4, wall = wall
//
// Only the FORMULAS are stored. A parameter's value is never cached here, because
// a cached value is a second copy of the truth that some edit forgets to refresh;
// Parameters.hpp recomputes every value from these records, in dependency order,
// every time it is asked. What a binding writes is stored where it belongs -- in
// the feature's own statement -- so the feature-IR program the kernel builds is
// always complete on its own and never needs this file to be read correctly.
//
// This header is deliberately free of the parser, the kernel and the document: it
// is included by PartCommands.hpp, which every forge::ui translation unit reaches.
#ifndef FORGE_UI_PARAMETERSET_HPP
#define FORGE_UI_PARAMETERSET_HPP

#include <cstddef>
#include <string>
#include <vector>

namespace forge::ui {

struct ParameterDef {
  std::string name;
  std::string expression;  // what the user (or Archie) wrote, kept verbatim
  std::string comment;
};

bool operator==(const ParameterDef& a, const ParameterDef& b) noexcept;
bool operator!=(const ParameterDef& a, const ParameterDef& b) noexcept;

struct DimensionBinding {
  int irId = 0;             // the statement whose number this drives
  std::string argument;     // the kernel's name for that number: "dia", "radius"
  std::size_t slot = 0;     // its position in the statement's argument list
  std::string expression;
};

bool operator==(const DimensionBinding& a, const DimensionBinding& b) noexcept;
bool operator!=(const DimensionBinding& a, const DimensionBinding& b) noexcept;

class ParameterSet {
 public:
  const std::vector<ParameterDef>& parameters() const noexcept { return parameters_; }
  const std::vector<DimensionBinding>& bindings() const noexcept { return bindings_; }
  bool empty() const noexcept { return parameters_.empty() && bindings_.empty(); }

  const ParameterDef* find(const std::string& name) const noexcept;
  const DimensionBinding* bindingFor(int irId, std::size_t slot) const noexcept;

  // Plain edits, no validation: Parameters.hpp validates a whole candidate set
  // before any of these reach a document. Order is preserved -- a parameter that
  // is changed keeps its row, a new one is appended.
  void upsertParameter(const ParameterDef& def);
  bool eraseParameter(const std::string& name);
  void upsertBinding(const DimensionBinding& binding);
  bool eraseBinding(int irId, std::size_t slot);

  bool operator==(const ParameterSet& other) const noexcept;
  bool operator!=(const ParameterSet& other) const noexcept { return !(*this == other); }

 private:
  std::vector<ParameterDef> parameters_;
  std::vector<DimensionBinding> bindings_;
};

}  // namespace forge::ui

#endif  // FORGE_UI_PARAMETERSET_HPP
