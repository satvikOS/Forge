// Forge-243 — Weir / orifice implementation.

#include "forge/WeirOrifice.hpp"

#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::weir {

namespace {
constexpr double pi = std::numbers::pi;
}

double rectWeirDischarge(const RectInput& in) {
    if (in.crestLengthM <= 0.0) throw std::invalid_argument("L must be positive");
    if (in.headM <= 0.0)         throw std::invalid_argument("H must be positive");
    if (in.dischargeCoeff <= 0.0) throw std::invalid_argument("C_d must be positive");
    if (in.gravityG <= 0.0)      throw std::invalid_argument("g must be positive");
    if (in.endContractions < 0 || in.endContractions > 2)
        throw std::invalid_argument("endContractions in {0, 1, 2}");
    const double L_eff = in.crestLengthM - 0.1 * in.endContractions * in.headM;
    if (L_eff <= 0.0) throw std::invalid_argument("contracted L_eff ≤ 0");
    return (2.0 / 3.0) * in.dischargeCoeff * L_eff
           * std::sqrt(2.0 * in.gravityG)
           * std::pow(in.headM, 1.5);
}

double vNotchDischarge(const VNotchInput& in) {
    if (in.notchAngleDeg <= 0.0 || in.notchAngleDeg >= 180.0)
        throw std::invalid_argument("θ must be in (0°, 180°)");
    if (in.headM <= 0.0)          throw std::invalid_argument("H must be positive");
    if (in.dischargeCoeff <= 0.0) throw std::invalid_argument("C_d must be positive");
    if (in.gravityG <= 0.0)       throw std::invalid_argument("g must be positive");
    const double halfRad = 0.5 * in.notchAngleDeg * pi / 180.0;
    return (8.0 / 15.0) * in.dischargeCoeff
           * std::sqrt(2.0 * in.gravityG)
           * std::tan(halfRad)
           * std::pow(in.headM, 2.5);
}

double orificeDischarge(const OrificeInput& in) {
    if (in.areaM2 <= 0.0)         throw std::invalid_argument("A must be positive");
    if (in.headM <= 0.0)          throw std::invalid_argument("H must be positive");
    if (in.dischargeCoeff <= 0.0) throw std::invalid_argument("C_d must be positive");
    if (in.gravityG <= 0.0)       throw std::invalid_argument("g must be positive");
    return in.dischargeCoeff * in.areaM2
           * std::sqrt(2.0 * in.gravityG * in.headM);
}

}  // namespace forge::weir
