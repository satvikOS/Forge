#include "CalculatorHost.hpp"

#include <exception>
#include <string>
#include <vector>

#include "CalculatorKernelBridge.hpp"
#include "forge/ui/EngineeringCalculators.hpp"

namespace forge::desktop {

forge::ui::CalculatorEvaluator kernelCalculatorEvaluator() {
  return [](const std::string& calculatorId, const forge::ui::CommandParams& params,
            std::vector<double>& outputs, std::string& refusal) -> bool {
    try {
      if (calcbridge::evaluate(calculatorId, params, outputs)) {
        refusal.clear();
        return true;
      }
      // Either this build carries no calculator by that id, or a declared input
      // was absent. Both are wiring, not arithmetic -- and neither is something
      // a user can fix, so the answer says so without naming a field.
      outputs.clear();
      refusal = forge::ui::calculatorRefusalText();
      return false;
    } catch (const std::exception&) {
      // ── THE KERNEL'S OWN MESSAGE IS DELIBERATELY DROPPED ─────────────────
      // e.what() here is the standard's notation -- "kappa must be > 0",
      // "d must be in (0, D)", "beta must be in [0.10, 0.75] for ISO 5167-2".
      // Those name symbols from a formula, not anything the person typed into,
      // and a surface that prints one is showing an identifier where a sentence
      // belongs. The partial `outputs` is cleared for the same reason: half a
      // result read out under full labels is worse than no result.
      outputs.clear();
      refusal = forge::ui::calculatorRefusalText();
      return false;
    }
  };
}

}  // namespace forge::desktop
