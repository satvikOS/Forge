#include "forge/BeamDeflection.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace beam {

Config configFromString(const std::string& name) {
    if (name == "cantilever-point")     return Config::CantileverPoint;
    if (name == "cantilever-udl")       return Config::CantileverUdl;
    if (name == "ss-point")             return Config::SimplySupportedPoint;
    if (name == "ss-udl")               return Config::SimplySupportedUdl;
    if (name == "ff-udl")               return Config::FixedFixedUdl;
    throw std::invalid_argument("beam.config: unknown config " + name);
}

Outputs solve(const Inputs& in) {
    if (in.length <= 0)        throw std::invalid_argument("beam.solve: L > 0");
    if (in.youngsModulus <= 0) throw std::invalid_argument("beam.solve: E > 0");
    if (in.secondMomentI <= 0) throw std::invalid_argument("beam.solve: I > 0");

    const double L = in.length;
    const double EI = in.youngsModulus * in.secondMomentI;
    const double P = in.load;
    const double w = in.load;

    Outputs out{};
    switch (in.config) {
        case Config::CantileverPoint:
            out.deflectionMax = P * L * L * L / (3.0 * EI);
            out.slopeMax      = P * L * L     / (2.0 * EI);
            out.momentMax     = P * L;
            break;
        case Config::CantileverUdl:
            out.deflectionMax = w * std::pow(L, 4) / (8.0 * EI);
            out.slopeMax      = w * L * L * L      / (6.0 * EI);
            out.momentMax     = w * L * L / 2.0;
            break;
        case Config::SimplySupportedPoint:
            out.deflectionMax = P * L * L * L / (48.0 * EI);
            out.slopeMax      = P * L * L     / (16.0 * EI);
            out.momentMax     = P * L / 4.0;
            break;
        case Config::SimplySupportedUdl:
            out.deflectionMax = 5.0 * w * std::pow(L, 4) / (384.0 * EI);
            out.slopeMax      = w * L * L * L            / (24.0 * EI);
            out.momentMax     = w * L * L / 8.0;
            break;
        case Config::FixedFixedUdl:
            out.deflectionMax = w * std::pow(L, 4) / (384.0 * EI);
            out.slopeMax      = 0.0;
            out.momentMax     = w * L * L / 12.0;
            break;
    }
    return out;
}

}} // namespace forge::beam
