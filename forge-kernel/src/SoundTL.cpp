// Forge-263 — Sound TL implementation.

#include "forge/SoundTL.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::soundtl {

double massLawTL(const MassLawInput& in) {
    if (in.surfaceDensityKgPerM2 <= 0.0)
        throw std::invalid_argument("ρ_s must be > 0");
    if (in.frequencyHz <= 0.0)
        throw std::invalid_argument("f must be > 0");
    if (in.coincidenceLossDb < 0.0)
        throw std::invalid_argument("coincidence loss must be ≥ 0");
    return 20.0 * std::log10(in.surfaceDensityKgPerM2 * in.frequencyHz)
           - 47.0 - in.coincidenceLossDb;
}

double compositeTL(const CompositeInput& in) {
    if (in.elements.empty())
        throw std::invalid_argument("composite needs ≥ 1 element");
    double totalArea = 0.0, weightedTau = 0.0;
    for (const auto& el : in.elements) {
        if (el.areaM2 <= 0.0)
            throw std::invalid_argument("area must be > 0");
        const double tau = std::pow(10.0, -el.transmissionLossDb / 10.0);
        weightedTau += el.areaM2 * tau;
        totalArea += el.areaM2;
    }
    if (totalArea <= 0.0)
        throw std::invalid_argument("total area must be > 0");
    return -10.0 * std::log10(weightedTau / totalArea);
}

}  // namespace forge::soundtl
