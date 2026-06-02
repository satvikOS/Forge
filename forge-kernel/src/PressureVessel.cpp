#include "forge/PressureVessel.hpp"

#include <stdexcept>

namespace forge { namespace pvessel {

Geometry geometryFromString(const std::string& s) {
    if (s == "cylinder") return Geometry::Cylinder;
    if (s == "sphere")   return Geometry::Sphere;
    throw std::invalid_argument("pvessel: geometry must be cylinder|sphere");
}

StressOutputs stress(const StressInputs& in) {
    if (in.pressure <= 0)      throw std::invalid_argument("stress: p > 0");
    if (in.diameter <= 0)      throw std::invalid_argument("stress: D > 0");
    if (in.wallThickness <= 0) throw std::invalid_argument("stress: t > 0");
    StressOutputs out{};
    switch (in.geometry) {
        case Geometry::Cylinder:
            out.hoopStress         = in.pressure * in.diameter / (2.0 * in.wallThickness);
            out.longitudinalStress = in.pressure * in.diameter / (4.0 * in.wallThickness);
            break;
        case Geometry::Sphere:
            out.hoopStress         = in.pressure * in.diameter / (4.0 * in.wallThickness);
            out.longitudinalStress = 0.0;     // identical membrane; report once
            break;
    }
    return out;
}

double requiredThickness(const ThicknessInputs& in) {
    if (in.pressure <= 0)         throw std::invalid_argument("thickness: p > 0");
    if (in.insideRadius <= 0)     throw std::invalid_argument("thickness: R > 0");
    if (in.allowableStress <= 0)  throw std::invalid_argument("thickness: S > 0");
    if (in.jointEfficiency <= 0 || in.jointEfficiency > 1)
        throw std::invalid_argument("thickness: E ∈ (0, 1]");
    double denom = 0.0;
    switch (in.geometry) {
        case Geometry::Cylinder:
            denom = in.allowableStress * in.jointEfficiency - 0.6 * in.pressure;
            break;
        case Geometry::Sphere:
            denom = 2.0 * in.allowableStress * in.jointEfficiency - 0.2 * in.pressure;
            break;
    }
    if (denom <= 0) throw std::invalid_argument("thickness: pressure exceeds allowable");
    return in.pressure * in.insideRadius / denom;
}

}} // namespace forge::pvessel
