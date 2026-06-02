#include "forge/Spring.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace spring {

namespace { constexpr double kPi = 3.14159265358979323846; }

Outputs design(const Inputs& in) {
    if (in.wireDiameter <= 0) throw std::invalid_argument("spring.design: d > 0");
    if (in.meanDiameter <= 0) throw std::invalid_argument("spring.design: D > 0");
    if (in.activeCoils <= 0)  throw std::invalid_argument("spring.design: N_a > 0");
    if (in.totalCoils  <= 0)  throw std::invalid_argument("spring.design: N_t > 0");
    if (in.shearModulus <= 0) throw std::invalid_argument("spring.design: G > 0");

    const double d = in.wireDiameter;
    const double D = in.meanDiameter;
    Outputs out{};
    out.rate = in.shearModulus * std::pow(d, 4)
             / (8.0 * std::pow(D, 3) * in.activeCoils);
    out.springIndex = D / d;
    const double C = out.springIndex;
    out.wahlFactor = (4.0 * C - 1.0) / (4.0 * C - 4.0) + 0.615 / C;
    out.maxShearStress = out.wahlFactor *
        (8.0 * in.appliedForce * D) / (kPi * std::pow(d, 3));
    out.solidHeight = in.totalCoils * d;
    out.deflectionAtF = in.appliedForce / out.rate;
    return out;
}

}} // namespace forge::spring
