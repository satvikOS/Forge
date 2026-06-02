#include "forge/SheetMetalFlatPattern.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace sheetmetal {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kDegToRad = kPi / 180.0;
}

// DIN 6935 / SMACNA baseline. K rises with R/T (the neutral fibre
// shifts toward the geometric middle for larger radii) and depends on
// material strength (stiffer materials → smaller K).
double kFactor(Material material, double ratioRoT) {
    if (ratioRoT < 0) ratioRoT = 0;
    auto interp = [&](double k_at_0, double k_at_1, double k_at_3, double k_at_10) {
        if (ratioRoT < 1.0)  return k_at_0 + (k_at_1 - k_at_0) * ratioRoT;
        if (ratioRoT < 3.0)  return k_at_1 + (k_at_3 - k_at_1) * ((ratioRoT - 1.0) / 2.0);
        if (ratioRoT < 10.0) return k_at_3 + (k_at_10 - k_at_3) * ((ratioRoT - 3.0) / 7.0);
        return k_at_10;
    };
    switch (material) {
        case Material::Aluminium:      return interp(0.33, 0.40, 0.45, 0.50);
        case Material::MildSteel:      return interp(0.33, 0.41, 0.45, 0.50);
        case Material::StainlessSteel: return interp(0.30, 0.38, 0.43, 0.49);
        case Material::Copper:         return interp(0.35, 0.43, 0.46, 0.50);
        case Material::Brass:          return interp(0.34, 0.42, 0.46, 0.50);
        case Material::Galvanised:     return interp(0.33, 0.41, 0.45, 0.50);
    }
    return 0.41;
}

BendResult computeBend(double angleDeg, double innerRadius,
                       double thickness, double kOverride,
                       Material material) {
    if (thickness <= 0)    throw std::invalid_argument("computeBend: thickness > 0");
    if (innerRadius < 0)   throw std::invalid_argument("computeBend: innerRadius ≥ 0");
    if (angleDeg < 0 || angleDeg > 180)
        throw std::invalid_argument("computeBend: angleDeg in [0, 180]");

    const double k = (kOverride > 0) ? kOverride
                                     : kFactor(material, innerRadius / thickness);
    const double neutral = innerRadius + k * thickness;
    const double angleRad = angleDeg * kDegToRad;
    const double ba = angleRad * neutral;
    const double bd = 2.0 * (innerRadius + thickness) * std::tan(angleRad / 2.0) - ba;
    return { ba, bd, neutral, k };
}

UnfoldOutputs unfoldChain(const UnfoldInputs& in) {
    if (in.flangeLengths.empty())
        throw std::invalid_argument("unfoldChain: at least one flange required");
    if (in.bends.size() + 1 != in.flangeLengths.size())
        throw std::invalid_argument("unfoldChain: bends.size() must be flangeLengths.size() - 1");
    if (in.thickness <= 0)
        throw std::invalid_argument("unfoldChain: thickness > 0");
    if (in.width    <= 0)
        throw std::invalid_argument("unfoldChain: width > 0");

    UnfoldOutputs out{};
    out.perBend.reserve(in.bends.size());
    out.flangeStartX.reserve(in.flangeLengths.size());

    double cursor = 0.0;
    out.flangeStartX.push_back(cursor);
    cursor += in.flangeLengths[0];

    for (std::size_t i = 0; i < in.bends.size(); ++i) {
        const auto& b = in.bends[i];
        const BendResult br = computeBend(b.angleDeg, b.innerRadius,
                                          in.thickness, b.kOverride,
                                          in.material);
        out.perBend.push_back(br);
        cursor += br.bendAllowance;
        out.flangeStartX.push_back(cursor);
        cursor += in.flangeLengths[i + 1];
    }
    out.developedLength = cursor;
    out.sheetArea       = cursor * in.width;
    return out;
}

}} // namespace forge::sheetmetal
