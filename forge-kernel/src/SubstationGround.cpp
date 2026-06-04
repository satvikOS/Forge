// Forge-319c — see header.

#include "forge/SubstationGround.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::subgnd {

Result analyse(const Input& in) {
    if (in.soilResistivityOhmM <= 0.0)
        throw std::runtime_error("soilResistivityOhmM must be > 0");
    if (in.gridAreaM2 <= 0.0)
        throw std::runtime_error("gridAreaM2 must be > 0");
    if (in.totalConductorLengthM <= 0.0)
        throw std::runtime_error("totalConductorLengthM must be > 0");
    if (in.burialDepthM <= 0.0)
        throw std::runtime_error("burialDepthM must be > 0");

    const double rho = in.soilResistivityOhmM;
    const double A   = in.gridAreaM2;
    const double L   = in.totalConductorLengthM;
    const double h   = in.burialDepthM;

    const double sqrtA = std::sqrt(20.0 * A);
    const double bracket = 1.0 / L
                         + (1.0 / sqrtA) * (1.0 + 1.0 / (1.0 + h * std::sqrt(20.0 / A)));
    const double Rg = rho * bracket;

    Result r;
    r.gridResistanceOhm  = Rg;
    r.meetsIeee80Target  = Rg <= 1.0;
    return r;
}

}  // namespace forge::subgnd
