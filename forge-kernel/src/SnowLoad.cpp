#include "forge/SnowLoad.hpp"

#include <stdexcept>

namespace forge { namespace snowload {

Exposure exposureFromString(const std::string& s) {
    if (s == "fully")     return Exposure::FullyExposed;
    if (s == "partially") return Exposure::PartiallyExposed;
    if (s == "sheltered") return Exposure::Sheltered;
    throw std::invalid_argument("snowload: exposure must be fully|partially|sheltered");
}
Thermal thermalFromString(const std::string& s) {
    if (s == "heated")           return Thermal::Heated;
    if (s == "just-above-freezing") return Thermal::JustAboveFreezing;
    if (s == "unheated")         return Thermal::Unheated;
    if (s == "cold-vent")        return Thermal::ColdAboveVent;
    throw std::invalid_argument("snowload: bad thermal category");
}
RiskCategory riskFromString(const std::string& s) {
    if (s == "I"   || s == "1") return RiskCategory::I;
    if (s == "II"  || s == "2") return RiskCategory::II;
    if (s == "III" || s == "3") return RiskCategory::III;
    if (s == "IV"  || s == "4") return RiskCategory::IV;
    throw std::invalid_argument("snowload: bad risk category");
}

double exposureFactor(Exposure e) {
    switch (e) {
        case Exposure::FullyExposed:     return 0.8;
        case Exposure::PartiallyExposed: return 1.0;
        case Exposure::Sheltered:        return 1.2;
    }
    return 1.0;
}
double thermalFactor(Thermal t) {
    switch (t) {
        case Thermal::Heated:             return 1.0;
        case Thermal::JustAboveFreezing:  return 1.1;
        case Thermal::Unheated:           return 1.2;
        case Thermal::ColdAboveVent:      return 1.1;
    }
    return 1.0;
}
double importanceFactor(RiskCategory r) {
    switch (r) {
        case RiskCategory::I:   return 0.80;
        case RiskCategory::II:  return 1.00;
        case RiskCategory::III: return 1.10;
        case RiskCategory::IV:  return 1.20;
    }
    return 1.0;
}

namespace {
double slopeFactorWarm(double thetaDeg) {
    if (thetaDeg <= 30.0) return 1.0;
    if (thetaDeg >= 70.0) return 0.0;
    return 1.0 - (thetaDeg - 30.0) / 40.0;
}
double slopeFactorCold(double thetaDeg) {
    if (thetaDeg <= 45.0) return 1.0;
    if (thetaDeg >= 70.0) return 0.0;
    return 1.0 - (thetaDeg - 45.0) / 25.0;
}
} // namespace

Outputs analyse(const Inputs& in) {
    if (in.groundSnowPa < 0) throw std::invalid_argument("snowload: p_g ≥ 0");
    if (in.slopeDeg < 0 || in.slopeDeg > 90)
        throw std::invalid_argument("snowload: slope ∈ [0, 90]");
    const double Ce = exposureFactor(in.exposure);
    const double Ct = thermalFactor(in.thermal);
    const double Is = importanceFactor(in.risk);
    Outputs out{};
    out.flatRoofPa   = 0.7 * Ce * Ct * Is * in.groundSnowPa;
    out.slopeFactor  = (Ct > 1.0)
        ? slopeFactorCold(in.slopeDeg)
        : slopeFactorWarm(in.slopeDeg);
    out.slopedRoofPa = out.slopeFactor * out.flatRoofPa;
    return out;
}

}} // namespace forge::snowload
