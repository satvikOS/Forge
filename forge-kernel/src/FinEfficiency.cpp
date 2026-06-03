// Forge-261 — Fin efficiency implementation.

#include "forge/FinEfficiency.hpp"

#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::finefficiency {

namespace {
constexpr double pi = std::numbers::pi;
}

Result rectangular(const RectInput& in) {
    if (in.heightM <= 0.0 || in.thicknessM <= 0.0 || in.widthM <= 0.0)
        throw std::invalid_argument("L, t, w must be > 0");
    if (in.thermalConductivity <= 0.0 || in.convectionH <= 0.0)
        throw std::invalid_argument("k, h must be > 0");

    Result r{};
    r.correctedLength = in.heightM + in.thicknessM * 0.5;
    r.parameter_m = std::sqrt(2.0 * in.convectionH
                              / (in.thermalConductivity * in.thicknessM));
    const double mLc = r.parameter_m * r.correctedLength;
    r.finEfficiency = (mLc > 0.0) ? std::tanh(mLc) / mLc : 1.0;
    r.finAreaM2 = 2.0 * in.widthM * r.correctedLength;
    r.heatRateW = r.finEfficiency * in.convectionH * r.finAreaM2
                  * in.temperatureDiffK;
    const double A_c = in.widthM * in.thicknessM;
    r.finEffectiveness = (A_c > 0.0)
        ? r.heatRateW / (in.convectionH * A_c * in.temperatureDiffK)
        : 0.0;
    return r;
}

Result pin(const PinInput& in) {
    if (in.lengthM <= 0.0 || in.diameterM <= 0.0)
        throw std::invalid_argument("L, D must be > 0");
    if (in.thermalConductivity <= 0.0 || in.convectionH <= 0.0)
        throw std::invalid_argument("k, h must be > 0");

    Result r{};
    r.correctedLength = in.lengthM + in.diameterM * 0.25;
    r.parameter_m = std::sqrt(4.0 * in.convectionH
                              / (in.thermalConductivity * in.diameterM));
    const double mLc = r.parameter_m * r.correctedLength;
    r.finEfficiency = (mLc > 0.0) ? std::tanh(mLc) / mLc : 1.0;
    r.finAreaM2 = pi * in.diameterM * r.correctedLength;
    r.heatRateW = r.finEfficiency * in.convectionH * r.finAreaM2
                  * in.temperatureDiffK;
    const double A_c = pi * in.diameterM * in.diameterM * 0.25;
    r.finEffectiveness = (A_c > 0.0)
        ? r.heatRateW / (in.convectionH * A_c * in.temperatureDiffK)
        : 0.0;
    return r;
}

}  // namespace forge::finefficiency
