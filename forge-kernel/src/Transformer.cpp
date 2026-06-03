// Forge-245 — Transformer implementation.

#include "forge/Transformer.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace forge::transformer {

OcTestResult openCircuitTest(const OcTestInput& in) {
    if (in.openCircuitVoltageV <= 0.0 || in.openCircuitCurrentA <= 0.0)
        throw std::invalid_argument("V_oc, I_oc must be positive");
    if (in.openCircuitPowerW < 0.0)
        throw std::invalid_argument("P_oc must be ≥ 0");
    OcTestResult r{};
    const double S = in.openCircuitVoltageV * in.openCircuitCurrentA;
    r.cosPhiOc = (S > 0.0) ? std::min(1.0, in.openCircuitPowerW / S) : 0.0;
    const double sinphi = std::sqrt(std::max(0.0, 1.0 - r.cosPhiOc * r.cosPhiOc));
    const double Ic = in.openCircuitCurrentA * r.cosPhiOc;
    const double Im = in.openCircuitCurrentA * sinphi;
    r.coreResistanceOhm       = (Ic > 0.0) ? in.openCircuitVoltageV / Ic
                                            : std::numeric_limits<double>::infinity();
    r.magnetisingReactanceOhm = (Im > 0.0) ? in.openCircuitVoltageV / Im
                                            : std::numeric_limits<double>::infinity();
    return r;
}

ScTestResult shortCircuitTest(const ScTestInput& in) {
    if (in.shortCircuitCurrentA <= 0.0 || in.shortCircuitVoltageV <= 0.0)
        throw std::invalid_argument("I_sc, V_sc must be positive");
    if (in.shortCircuitPowerW < 0.0)
        throw std::invalid_argument("P_sc must be ≥ 0");
    ScTestResult r{};
    r.equivalentResistanceOhm = in.shortCircuitPowerW
                                / (in.shortCircuitCurrentA * in.shortCircuitCurrentA);
    r.equivalentImpedanceOhm  = in.shortCircuitVoltageV / in.shortCircuitCurrentA;
    const double X2 = r.equivalentImpedanceOhm * r.equivalentImpedanceOhm
                    - r.equivalentResistanceOhm * r.equivalentResistanceOhm;
    r.equivalentReactanceOhm = std::sqrt(std::max(0.0, X2));
    return r;
}

RegResult voltageRegulation(const RegInput& in) {
    if (in.ratedHvCurrentA <= 0.0 || in.ratedHvVoltageV <= 0.0)
        throw std::invalid_argument("rated I, V must be positive");
    if (in.loadFraction < 0.0)
        throw std::invalid_argument("load fraction must be ≥ 0");
    if (in.powerFactor < 0.0 || in.powerFactor > 1.0)
        throw std::invalid_argument("pf must be in [0, 1]");

    RegResult r{};
    const double IL = in.loadFraction * in.ratedHvCurrentA;
    const double sinphi = std::sqrt(std::max(0.0, 1.0 - in.powerFactor * in.powerFactor))
                          * (in.leading ? -1.0 : 1.0);
    r.voltageDropV = IL * (in.equivalentResistanceOhm * in.powerFactor
                         + in.equivalentReactanceOhm * sinphi);
    r.regulationPct = r.voltageDropV / in.ratedHvVoltageV * 100.0;
    return r;
}

double efficiency(const EffInput& in) {
    if (in.ratedKva <= 0.0) throw std::invalid_argument("rated kVA must be positive");
    if (in.loadFraction < 0.0) throw std::invalid_argument("load fraction must be ≥ 0");
    if (in.powerFactor < 0.0 || in.powerFactor > 1.0)
        throw std::invalid_argument("pf must be in [0, 1]");
    if (in.openCircuitPowerW < 0.0 || in.shortCircuitPowerW < 0.0)
        throw std::invalid_argument("P_oc, P_sc must be ≥ 0");

    const double S = in.ratedKva * 1000.0;
    const double output = in.loadFraction * S * in.powerFactor;
    const double Pcu = in.loadFraction * in.loadFraction * in.shortCircuitPowerW;
    const double input = output + in.openCircuitPowerW + Pcu;
    return (input > 0.0) ? (output / input) : 0.0;
}

double maximumEfficiencyLoadFraction(double Poc, double Psc) {
    if (Psc <= 0.0) throw std::invalid_argument("P_sc must be positive");
    if (Poc < 0.0)  throw std::invalid_argument("P_oc must be ≥ 0");
    // x* solves P_oc = x²·P_sc.
    return std::sqrt(Poc / Psc);
}

}  // namespace forge::transformer
