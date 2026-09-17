// forge-desktop/src/ExpressionHost.hpp
//
// THE ONE PLACE FORGE TOUCHES libforge_expr.
//
// forge::ui's parameter model talks to an abstract forge::ui::ExpressionEngine
// (ui/include/forge/ui/ExpressionEngine.hpp). This class is the engine the
// application ships: it translates that interface onto libforge_expr, the LGPL-2.1
// shared library derived from FreeCAD's expression code
// (third_party/freecad-derived/expressions).
//
// It is Forge's own code and lives in Forge's tree. It includes the library's
// PUBLIC headers only (forge_expr/Evaluator.h, forge_expr/Unit.h) and uses only the
// noexcept boundary API, so no exception from the library can reach a frame loop.
//
// ── linkage ─────────────────────────────────────────────────────────────────
// This translation unit is compiled into the forge_desktop EXECUTABLE and into the
// gates that exercise the real library -- never into forge_desktop_core,
// forge_ui or any static library -- and every one of those links libforge_expr
// DYNAMICALLY (`otool -L forge_desktop` names @rpath/libforge_expr.dylib).
// tools/gates/freecad_derived_lgpl_gate.sh checks both halves.
#ifndef FORGE_DESKTOP_EXPRESSIONHOST_HPP
#define FORGE_DESKTOP_EXPRESSIONHOST_HPP

#include <string>

#include "forge/ui/ExpressionEngine.hpp"

namespace forge::desktop {

class ExpressionHost final : public forge::ui::ExpressionEngine {
 public:
  forge::ui::ExprCompiled compile(const std::string& text) const override;
  forge::ui::ExprEvaluated evaluate(const std::string& text,
                                    const forge::ui::ExprNameResolver& names) const override;
  bool validName(const std::string& name) const override;
  std::string describe(const forge::ui::ExprQuantity& quantity) const override;
  std::string dimensionName(const forge::ui::ExprDimensions& dims) const override;
  std::string identity() const override;
};

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_EXPRESSIONHOST_HPP
