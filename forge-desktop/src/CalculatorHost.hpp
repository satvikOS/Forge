// forge-desktop/src/CalculatorHost.hpp
//
// THE ONE TRANSLATION UNIT THAT MAY SEE AN ENGINEERING CALCULATOR.
//
// Same split, and for the same reason, as StudyHost: forge::ui is compiled and
// RUN headlessly by every gate and includes no kernel header, so the arithmetic
// lives in the kernel and the bookkeeping lives in forge::ui. This file is the
// seam between them -- it hands forge::ui::CalculatorBench a function that calls
// the kernel's own entry point and answers in plain doubles.
//
// It also owns the ONE translation the kernel cannot do for itself. A calculator
// reports a number it cannot work with by throwing, in its own notation
// ("kappa must be > 0", "d must be in (0, D)"). That notation names symbols from
// a standard, not anything on screen, so it is caught here and answered with a
// sentence. Forwarding it would be the echoed-internal-detail defect the prose
// gate exists for.
#ifndef FORGE_DESKTOP_CALCULATORHOST_HPP
#define FORGE_DESKTOP_CALCULATORHOST_HPP

#include "forge/ui/EngineeringCalculators.hpp"

namespace forge::desktop {

// The evaluator to install on a CalculatorBench. It reaches the kernel through
// the GENERATED bridge, so no field name in this subsystem is written twice.
forge::ui::CalculatorEvaluator kernelCalculatorEvaluator();

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_CALCULATORHOST_HPP
