// Forge-273 — implementation; see header for derivation references.

#include "forge/PumpNpsh.hpp"

#include <stdexcept>

namespace forge::pumpnpsh {

constexpr double G = 9.80665;

Result analyse(const Input& in) {
    if (in.atmosphericPressurePa <= 0.0)
        throw std::runtime_error("atmosphericPressurePa must be > 0");
    if (in.vapourPressurePa < 0.0)
        throw std::runtime_error("vapourPressurePa must be ≥ 0");
    if (in.vapourPressurePa >= in.atmosphericPressurePa)
        throw std::runtime_error("vapourPressurePa ≥ atmosphericPressurePa (fluid is boiling)");
    if (in.densityKgM3 <= 0.0)
        throw std::runtime_error("densityKgM3 must be > 0");
    if (in.frictionHeadM < 0.0)
        throw std::runtime_error("frictionHeadM must be ≥ 0");
    if (in.requiredNpshM < 0.0)
        throw std::runtime_error("requiredNpshM must be ≥ 0");

    const double pressureHead =
        (in.atmosphericPressurePa - in.vapourPressurePa) / (in.densityKgM3 * G);
    const double NPSH_A = pressureHead + in.staticSuctionHeadM - in.frictionHeadM;

    const double margin = NPSH_A - in.requiredNpshM;
    const double marginPct = (in.requiredNpshM > 0.0)
                                ? 100.0 * margin / in.requiredNpshM
                                : 0.0;

    const bool cavitating = NPSH_A <= in.requiredNpshM;
    // Hydraulic Institute marginal: < 1.1·NPSH_R OR margin < 1.0 m.
    const bool marginal = (NPSH_A < 1.1 * in.requiredNpshM) || (margin < 1.0);

    Result r;
    r.pressureHeadM   = pressureHead;
    r.availableNpshM  = NPSH_A;
    r.marginM         = margin;
    r.marginPct       = marginPct;
    r.cavitating      = cavitating;
    r.marginalPerHi   = marginal;
    return r;
}

}  // namespace forge::pumpnpsh
