// Forge-315 — implementation; see header for derivation references.

#include "forge/WindTurbine.hpp"

#include <stdexcept>

namespace forge::windturbine {

Result analyse(const Input& in) {
    if (in.rotorDiameterM <= 0.0)
        throw std::runtime_error("rotorDiameterM must be > 0");
    if (in.windSpeedMs <= 0.0)
        throw std::runtime_error("windSpeedMs must be > 0");
    if (in.airDensityKgPerM3 <= 0.0)
        throw std::runtime_error("airDensityKgPerM3 must be > 0");
    if (in.powerCoefficient <= 0.0 || in.powerCoefficient > 16.0/27.0 + 1e-9)
        throw std::runtime_error("powerCoefficient must be in (0, 16/27 = 0.593]");
    if (in.generatorEfficiency <= 0.0 || in.generatorEfficiency > 1.0)
        throw std::runtime_error("generatorEfficiency must be in (0, 1]");
    if (in.capacityFactor < 0.0 || in.capacityFactor > 1.0)
        throw std::runtime_error("capacityFactor must be in [0, 1]");
    if (in.rotorSpeedRpm < 0.0)
        throw std::runtime_error("rotorSpeedRpm must be ≥ 0");

    constexpr double PI = 3.141592653589793;

    const double A     = 0.25 * PI * in.rotorDiameterM * in.rotorDiameterM;
    const double V3    = in.windSpeedMs * in.windSpeedMs * in.windSpeedMs;
    const double P_w   = 0.5 * in.airDensityKgPerM3 * A * V3;
    const double P_b   = (16.0/27.0) * P_w;
    const double P_m   = in.powerCoefficient * P_w;
    const double P_e   = in.generatorEfficiency * P_m;

    double lambda = 0.0;
    if (in.rotorSpeedRpm > 0.0) {
        lambda = PI * in.rotorDiameterM * in.rotorSpeedRpm
               / (60.0 * in.windSpeedMs);
    }

    const double AEP_MWh = P_e * 8760.0 * in.capacityFactor / 1.0e6;

    Result r;
    r.sweptAreaM2          = A;
    r.availableWindPowerW  = P_w;
    r.betzCeilingPowerW    = P_b;
    r.mechanicalPowerW     = P_m;
    r.electricalPowerW     = P_e;
    r.tipSpeedRatio        = lambda;
    r.annualEnergyMWh      = AEP_MWh;
    return r;
}

}  // namespace forge::windturbine
