#include "forge/HydraulicCylinder.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace hydcyl {

namespace { constexpr double kPi = 3.14159265358979323846; }

Outputs analyse(const Inputs& in) {
    if (in.bore <= 0)         throw std::invalid_argument("hydcyl: bore > 0");
    if (in.rodDiameter <= 0)  throw std::invalid_argument("hydcyl: rodDiameter > 0");
    if (in.rodDiameter >= in.bore)
        throw std::invalid_argument("hydcyl: rod must be smaller than bore");
    if (in.pressure <= 0)     throw std::invalid_argument("hydcyl: pressure > 0");
    if (in.flowRate <= 0)     throw std::invalid_argument("hydcyl: flow > 0");
    if (in.strokeLength <= 0) throw std::invalid_argument("hydcyl: stroke > 0");
    if (in.rodE <= 0)         throw std::invalid_argument("hydcyl: rod E > 0");
    if (in.bucklingK <= 0)    throw std::invalid_argument("hydcyl: K > 0");

    Outputs out{};
    out.pistonArea     = kPi * in.bore * in.bore / 4.0;
    out.rodArea        = kPi * in.rodDiameter * in.rodDiameter / 4.0;
    out.annulusArea    = out.pistonArea - out.rodArea;

    out.extendForce    = in.pressure * out.pistonArea;
    out.retractForce   = in.pressure * out.annulusArea;
    out.extendSpeed    = in.flowRate / out.pistonArea;
    out.retractSpeed   = in.flowRate / out.annulusArea;
    out.volumePerCycle = out.pistonArea * in.strokeLength;

    out.rodMomentI     = kPi * std::pow(in.rodDiameter, 4) / 64.0;
    out.rodEulerCriticalLoad =
        kPi * kPi * in.rodE * out.rodMomentI / std::pow(in.bucklingK * in.strokeLength, 2);
    out.bucklingSafetyFactor = out.rodEulerCriticalLoad / out.extendForce;
    return out;
}

}} // namespace forge::hydcyl
