#include "forge/SteelColumn.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace steelcol {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kPhiC = 0.90;
constexpr double kOmegaC = 1.67;
}

Outputs analyse(const Inputs& in) {
    if (in.effectiveLengthK <= 0) throw std::invalid_argument("steelcol: K > 0");
    if (in.unbracedLength <= 0)   throw std::invalid_argument("steelcol: L > 0");
    if (in.radiusOfGyration <= 0) throw std::invalid_argument("steelcol: r > 0");
    if (in.area <= 0)             throw std::invalid_argument("steelcol: A > 0");
    if (in.youngsModulus <= 0)    throw std::invalid_argument("steelcol: E > 0");
    if (in.yieldStress <= 0)      throw std::invalid_argument("steelcol: F_y > 0");

    Outputs out{};
    const double lambda = in.effectiveLengthK * in.unbracedLength / in.radiusOfGyration;
    out.slenderness = lambda;
    out.slendernessLimit = 4.71 * std::sqrt(in.youngsModulus / in.yieldStress);
    out.eulerStress = kPi * kPi * in.youngsModulus / (lambda * lambda);

    if (lambda <= out.slendernessLimit) {
        out.inelasticRegime = true;
        out.criticalStress = std::pow(0.658, in.yieldStress / out.eulerStress) * in.yieldStress;
    } else {
        out.inelasticRegime = false;
        out.criticalStress = 0.877 * out.eulerStress;
    }
    out.nominalStrength      = out.criticalStress * in.area;
    out.designStrengthLRFD   = kPhiC * out.nominalStrength;
    out.allowableStrengthASD = out.nominalStrength / kOmegaC;
    return out;
}

}} // namespace forge::steelcol
