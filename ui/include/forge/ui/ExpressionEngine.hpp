// ui/include/forge/ui/ExpressionEngine.hpp
//
// THE SEAM BETWEEN FORGE'S PARAMETERS AND THE LIBRARY THAT READS AN EXPRESSION.
//
// Forge's parameter model (Parameters.hpp) needs three things from an expression
// language: parse a formula and say which names it uses, evaluate it against
// values Forge supplies, and say whether two quantities have the same dimension.
// It does NOT need to know whose parser does that, and it must not: the parser
// Forge ships is libforge_expr, a SEPARATE LGPL-2.1 shared library derived from
// FreeCAD (third_party/freecad-derived/expressions). Forge's own code talks to it
// only through this interface, so
//
//   * no forge::ui translation unit includes a libforge_expr header, and nothing
//     that compiles ui/src/*.cpp -- every headless gate in this repository -- has
//     to link the library;
//   * the one class that does include it, forge::desktop::ExpressionHost
//     (forge-desktop/src/ExpressionHost.cpp), is linked into the application, and
//     the library is loaded from Contents/Frameworks at run time;
//   * a user who replaces libforge_expr.dylib with their own build (LGPL-2.1 s6)
//     changes nothing Forge was compiled against.
//
// Everything here is plain data and a pure virtual interface. No implementation
// throws: a failure is `ok == false` with a sentence saying why.
#ifndef FORGE_UI_EXPRESSIONENGINE_HPP
#define FORGE_UI_EXPRESSIONENGINE_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// ── dimensions ──────────────────────────────────────────────────────────────
// The exponents of the eight base dimensions, in this order and in these base
// units: length (mm), mass (kg), time (s), electric current (A), temperature (K),
// amount of substance (mol), luminous intensity (cd), plane angle (deg).
//
// Millimetres and degrees are the base units because they are what Forge's
// feature-IR stores: a HOLE's `dia` is millimetres and a DRAFT's `angleDeg` is
// degrees (forge-kernel/docs/feature_tree_ir.md), so a length or angle a formula
// produces can be written into a statement without a conversion that could be
// forgotten.
struct ExprDimensions {
  std::array<std::int8_t, 8> exps{};

  bool dimensionless() const noexcept;
  bool operator==(const ExprDimensions& other) const noexcept { return exps == other.exps; }
  bool operator!=(const ExprDimensions& other) const noexcept { return exps != other.exps; }

  static ExprDimensions none() noexcept { return ExprDimensions{}; }
  static ExprDimensions length() noexcept;
  static ExprDimensions mass() noexcept;
  static ExprDimensions angle() noexcept;
};

// A number with a dimension, the value expressed in the base units above.
struct ExprQuantity {
  double value = 0.0;
  ExprDimensions dims{};
};

// ── what the engine says about a formula ───────────────────────────────────
struct ExprCompiled {
  bool ok = false;
  std::string error;               // why the text is not a formula; empty when ok
  std::vector<std::string> names;  // every name it uses, sorted, as written
  std::string canonical;           // the formula printed back ("wall * 0.5 + 2 mm")
};

struct ExprEvaluated {
  bool ok = false;
  std::string error;  // why there is no value; empty when ok
  ExprQuantity quantity;
};

// How evaluation reads a name. Return false, with `why`, to refuse.
class ExprNameResolver {
 public:
  virtual ~ExprNameResolver() = default;
  virtual bool resolve(const std::string& name, ExprQuantity& out, std::string& why) const = 0;
};

class ExpressionEngine {
 public:
  virtual ~ExpressionEngine() = default;

  // Parse only. Never throws.
  virtual ExprCompiled compile(const std::string& text) const = 0;
  // Parse and evaluate against `names`. A result that is text rather than a
  // number is refused. Never throws.
  virtual ExprEvaluated evaluate(const std::string& text, const ExprNameResolver& names) const = 0;
  // May `name` be a parameter's name? A single identifier that the language does
  // not already read as a unit, a constant or a function.
  virtual bool validName(const std::string& name) const = 0;
  // "12.5 mm", "30 deg", "2 kg", "4" -- for a person.
  virtual std::string describe(const ExprQuantity& quantity) const = 0;
  // "Length", "Mass", "Angle", "Pressure", or the exponents spelled out
  // ("mm^2*kg") when the dimension has no name, or "a plain number".
  virtual std::string dimensionName(const ExprDimensions& dims) const = 0;
  // Which library, which version, which licence -- for the About box and a log.
  virtual std::string identity() const = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_EXPRESSIONENGINE_HPP
