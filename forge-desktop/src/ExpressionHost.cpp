// forge-desktop/src/ExpressionHost.cpp -- see ExpressionHost.hpp.
#include "ExpressionHost.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/ExpressionEngine.hpp"
#include "forge_expr/Evaluator.h"
#include "forge_expr/Expression.h"
#include "forge_expr/Quantity.h"
#include "forge_expr/Unit.h"

namespace forge::desktop {

namespace {

// The base-dimension ORDER is part of forge::ui::ExprDimensions' contract (length,
// mass, time, current, temperature, amount, luminous intensity, angle) and it is
// also libforge_expr's (forge::expr::unitSymbols). The two are compared here, at
// compile time, rather than trusted: if either side reorders, this file stops
// compiling instead of silently reading a mass as a length.
constexpr std::array<std::string_view, 8> kForgeOrder = {"mm", "kg", "s", "A", "K", "mol", "cd", "deg"};
constexpr bool sameOrder() {
  if (forge::expr::unitSymbols.size() != kForgeOrder.size()) return false;
  for (std::size_t i = 0; i < kForgeOrder.size(); ++i) {
    if (forge::expr::unitSymbols[i] != kForgeOrder[i]) return false;
  }
  return true;
}
static_assert(sameOrder(), "libforge_expr's base-dimension order no longer matches "
                           "forge::ui::ExprDimensions");

forge::ui::ExprDimensions toForge(const forge::expr::Unit& unit) {
  forge::ui::ExprDimensions d;
  const forge::expr::UnitExponents exps = unit.exponents();
  for (std::size_t i = 0; i < d.exps.size(); ++i) d.exps[i] = exps[i];
  return d;
}

forge::expr::Unit toLibrary(const forge::ui::ExprDimensions& dims) {
  forge::expr::UnitExponents exps{};
  for (std::size_t i = 0; i < exps.size(); ++i) exps[i] = dims.exps[i];
  return forge::expr::Unit(exps);
}

// Adapts Forge's resolver onto the library's SymbolTable. The library calls this
// for every name it meets; Forge decides what the name is.
class Symbols final : public forge::expr::SymbolTable {
 public:
  explicit Symbols(const forge::ui::ExprNameResolver& names) : names_(names) {}

  bool lookup(const std::string& path, forge::expr::Value& out, std::string& why) const override {
    forge::ui::ExprQuantity q;
    if (!names_.resolve(path, q, why)) return false;
    try {
      out = forge::expr::Value(forge::expr::Quantity(q.value, toLibrary(q.dims)));
    } catch (...) {
      // A dimension the library cannot represent (an exponent beyond its range).
      why = "'" + path + "' has a unit too large to use in a formula";
      return false;
    }
    return true;
  }

 private:
  const forge::ui::ExprNameResolver& names_;
};

std::string number(double v) {
  std::ostringstream ss;
  ss << std::setprecision(12) << v;
  return ss.str();
}

}  // namespace

forge::ui::ExprCompiled ExpressionHost::compile(const std::string& text) const {
  forge::ui::ExprCompiled out;
  const forge::expr::CompiledExpression compiled = forge::expr::CompiledExpression::compile(text);
  out.ok = compiled.ok();
  if (!out.ok) {
    out.error = compiled.error();
    return out;
  }
  out.names.assign(compiled.names().begin(), compiled.names().end());  // std::set: sorted
  out.canonical = compiled.canonical();
  return out;
}

forge::ui::ExprEvaluated ExpressionHost::evaluate(const std::string& text,
                                                  const forge::ui::ExprNameResolver& names) const {
  forge::ui::ExprEvaluated out;
  const forge::expr::CompiledExpression compiled = forge::expr::CompiledExpression::compile(text);
  if (!compiled.ok()) {
    out.error = compiled.error();
    return out;
  }
  const Symbols symbols(names);
  const forge::expr::Evaluation e = compiled.evaluate(symbols);
  if (!e.ok) {
    out.error = e.error;
    return out;
  }
  if (!e.value.isNumber()) {
    out.error = "'" + text + "' is text, not a number";
    return out;
  }
  const forge::expr::Quantity& q = e.value.quantity();
  if (!std::isfinite(q.getValue())) {
    out.error = "'" + text + "' is not a finite number";
    return out;
  }
  out.ok = true;
  out.quantity.value = q.getValue();
  out.quantity.dims = toForge(q.getUnit());
  return out;
}

bool ExpressionHost::validName(const std::string& name) const {
  return forge::expr::isValidName(name);
}

std::string ExpressionHost::describe(const forge::ui::ExprQuantity& quantity) const {
  if (quantity.dims.dimensionless()) return number(quantity.value);
  try {
    const std::string unit = toLibrary(quantity.dims).getString();
    return number(quantity.value) + " " + unit;
  } catch (...) {
    return number(quantity.value);
  }
}

std::string ExpressionHost::dimensionName(const forge::ui::ExprDimensions& dims) const {
  if (dims.dimensionless()) return "plain number";
  try {
    const forge::expr::Unit unit = toLibrary(dims);
    const std::string type = unit.getTypeString();
    if (!type.empty()) {
      // "TimeSpan" -> "time span": the library's names are identifiers, and this
      // sentence is read by a person.
      std::string words;
      for (std::size_t i = 0; i < type.size(); ++i) {
        const char c = type[i];
        if (i > 0 && c >= 'A' && c <= 'Z') words += ' ';
        words += (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
      }
      return words;
    }
    return "quantity in " + unit.getString();
  } catch (...) {
    return "quantity";
  }
}

std::string ExpressionHost::identity() const {
  return forge::expr::libraryIdentity();
}

}  // namespace forge::desktop
