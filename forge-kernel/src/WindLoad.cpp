#include "forge/WindLoad.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace windload {

Exposure exposureFromString(const std::string& name) {
    if (name == "B" || name == "b") return Exposure::B;
    if (name == "C" || name == "c") return Exposure::C;
    if (name == "D" || name == "d") return Exposure::D;
    throw std::invalid_argument("windload: exposure must be B / C / D");
}

namespace {
struct ExposureParams { double zg; double alpha; };
ExposureParams params(Exposure e) {
    switch (e) {
        case Exposure::B: return { 365.76,  7.0 };
        case Exposure::C: return { 274.32,  9.5 };
        case Exposure::D: return { 213.36, 11.5 };
    }
    return { 274.32, 9.5 };
}
} // namespace

double kzCoefficient(double z, Exposure exposure) {
    if (z < 4.6) z = 4.6;        // ASCE 7 minimum height clause
    const auto p = params(exposure);
    if (z >= p.zg) return 2.01;
    return 2.01 * std::pow(z / p.zg, 2.0 / p.alpha);
}

double velocityPressure(const VelocityPressureInputs& in) {
    if (in.V <= 0)   throw std::invalid_argument("velocityPressure: V > 0");
    if (in.z <= 0)   throw std::invalid_argument("velocityPressure: z > 0");
    if (in.Kzt <= 0) throw std::invalid_argument("velocityPressure: Kzt > 0");
    if (in.Kd <= 0)  throw std::invalid_argument("velocityPressure: Kd > 0");
    if (in.Ke <= 0)  throw std::invalid_argument("velocityPressure: Ke > 0");
    const double Kz = kzCoefficient(in.z, in.exposure);
    return 0.613 * Kz * in.Kzt * in.Kd * in.Ke * in.V * in.V;
}

double designPressure(const DesignPressureInputs& in) {
    if (in.qz < 0) throw std::invalid_argument("designPressure: qz ≥ 0");
    if (in.G  <= 0) throw std::invalid_argument("designPressure: G > 0");
    return in.qz * in.G * in.Cp - in.qi * in.GCpi;
}

}} // namespace forge::windload
