// Forge-259 — Combustion analysis implementation.

#include "forge/Combustion.hpp"

#include <stdexcept>

namespace forge::combustion {

Result analyse(const Input& in) {
    const auto& f = in.fuel;
    if (f.C < 0.0 || f.H < 0.0 || f.O < 0.0 || f.N < 0.0 || f.S < 0.0)
        throw std::invalid_argument("mass fractions must be ≥ 0");
    const double total = f.C + f.H + f.O + f.N + f.S;
    if (total <= 0.0 || total > 1.0001)
        throw std::invalid_argument("sum of mass fractions must be in (0, 1]");
    if (in.excessAirRatio < 1.0)
        throw std::invalid_argument("excess-air ratio λ must be ≥ 1");

    Result r{};
    r.stoichiometricOxygenKgPerKgFuel = (8.0 / 3.0) * f.C + 8.0 * f.H + f.S - f.O;
    if (r.stoichiometricOxygenKgPerKgFuel < 0.0)
        r.stoichiometricOxygenKgPerKgFuel = 0.0;
    r.stoichiometricAirKgPerKgFuel = r.stoichiometricOxygenKgPerKgFuel / 0.232;
    r.actualAirKgPerKgFuel = in.excessAirRatio * r.stoichiometricAirKgPerKgFuel;

    r.co2KgPerKgFuel = (44.0 / 12.0) * f.C;
    r.h2oKgPerKgFuel = 9.0 * f.H;
    r.so2KgPerKgFuel = 2.0 * f.S;
    r.n2KgPerKgFuel = 0.768 * r.actualAirKgPerKgFuel + f.N;
    r.excessO2KgPerKgFuel = (in.excessAirRatio - 1.0) * r.stoichiometricOxygenKgPerKgFuel;

    r.dryFlueGasKgPerKgFuel = r.co2KgPerKgFuel + r.so2KgPerKgFuel
                            + r.n2KgPerKgFuel + r.excessO2KgPerKgFuel;
    if (r.dryFlueGasKgPerKgFuel > 0.0) {
        r.dryCO2MassPct = 100.0 * r.co2KgPerKgFuel / r.dryFlueGasKgPerKgFuel;
        r.dryO2MassPct  = 100.0 * r.excessO2KgPerKgFuel / r.dryFlueGasKgPerKgFuel;
        r.dryN2MassPct  = 100.0 * r.n2KgPerKgFuel / r.dryFlueGasKgPerKgFuel;
    }
    return r;
}

}  // namespace forge::combustion
