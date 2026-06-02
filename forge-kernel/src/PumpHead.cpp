#include "forge/PumpHead.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace pumphead {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kG  = 9.80665;
}

double reynoldsNumber(double V, double D, double rho, double mu) {
    if (V < 0)   throw std::invalid_argument("Re: V ≥ 0");
    if (D <= 0)  throw std::invalid_argument("Re: D > 0");
    if (rho <= 0) throw std::invalid_argument("Re: ρ > 0");
    if (mu <= 0)  throw std::invalid_argument("Re: μ > 0");
    return rho * V * D / mu;
}

double swameeJainFrictionFactor(double Re, double D, double eps) {
    if (Re <= 0) throw std::invalid_argument("SJ: Re > 0");
    if (D <= 0)  throw std::invalid_argument("SJ: D > 0");
    if (eps < 0) throw std::invalid_argument("SJ: ε ≥ 0");
    const double bracket =
        eps / (3.7 * D) + 5.74 / std::pow(Re, 0.9);
    const double logTerm = std::log10(bracket);
    return 0.25 / (logTerm * logTerm);
}

double frictionFactor(double Re, double D, double eps) {
    if (Re < 2300.0) {
        if (Re <= 0) return 0.0;
        return 64.0 / Re;
    }
    return swameeJainFrictionFactor(Re, D, eps);
}

Outputs analyse(const Inputs& in) {
    if (in.flowRate < 0)           throw std::invalid_argument("pump.analyse: Q ≥ 0");
    if (in.diameter <= 0)          throw std::invalid_argument("pump.analyse: D > 0");
    if (in.pipeLength <= 0)        throw std::invalid_argument("pump.analyse: L > 0");
    if (in.roughness < 0)          throw std::invalid_argument("pump.analyse: ε ≥ 0");
    if (in.density <= 0)           throw std::invalid_argument("pump.analyse: ρ > 0");
    if (in.dynamicViscosity <= 0)  throw std::invalid_argument("pump.analyse: μ > 0");
    if (in.pumpEfficiency <= 0 || in.pumpEfficiency > 1)
        throw std::invalid_argument("pump.analyse: η ∈ (0, 1]");

    Outputs out{};
    const double A = kPi * in.diameter * in.diameter / 4.0;
    out.meanVelocity = (in.flowRate > 0) ? in.flowRate / A : 0.0;
    out.reynolds = reynoldsNumber(out.meanVelocity, in.diameter,
                                  in.density, in.dynamicViscosity);
    out.frictionFactor = (out.reynolds > 0)
        ? frictionFactor(out.reynolds, in.diameter, in.roughness)
        : 0.0;
    out.frictionHead = out.frictionFactor * (in.pipeLength / in.diameter)
                     * (out.meanVelocity * out.meanVelocity) / (2.0 * kG);
    out.totalHead = in.staticHead + out.frictionHead;
    const double rho_g_Q = in.density * kG * in.flowRate;
    out.hydraulicPower = rho_g_Q * out.frictionHead;
    out.shaftPower = rho_g_Q * out.totalHead / in.pumpEfficiency;
    return out;
}

}} // namespace forge::pumphead
