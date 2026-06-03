// Forge-281 — implementation; see header for derivation references.

#include "forge/DiscBrake.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::discbrake {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.outerRadiusMm <= 0.0)
        throw std::runtime_error("outerRadiusMm must be > 0");
    if (in.innerRadiusMm <= 0.0)
        throw std::runtime_error("innerRadiusMm must be > 0");
    if (in.innerRadiusMm >= in.outerRadiusMm)
        throw std::runtime_error("innerRadiusMm must be < outerRadiusMm");
    if (in.frictionCoefficient <= 0.0 || in.frictionCoefficient > 1.0)
        throw std::runtime_error("frictionCoefficient must be in (0, 1]");
    if (in.clampingForceN <= 0.0)
        throw std::runtime_error("clampingForceN must be > 0");
    if (in.numberOfFaces < 1 || in.numberOfFaces > 100)
        throw std::runtime_error("numberOfFaces must be in [1, 100]");

    const double Ro   = in.outerRadiusMm;
    const double Ri   = in.innerRadiusMm;
    const double mu   = in.frictionCoefficient;
    const double F    = in.clampingForceN;
    const int    n    = in.numberOfFaces;

    const double area_mm2 = PI * (Ro * Ro - Ri * Ri);
    const double p_avg    = F / area_mm2;            // N/mm² = MPa

    double torque_Nmm = 0.0;
    double p_max      = 0.0;
    std::string assumption_str;

    if (in.assumption == Assumption::UniformWear) {
        // F  = π·p_a·R_i·(R_o − R_i)  ⇒  p_a = F / [π·R_i·(R_o − R_i)]
        p_max = F / (PI * Ri * (Ro - Ri));
        // T  = μ·F·(R_o + R_i)/2 · n
        torque_Nmm = mu * F * (Ro + Ri) * 0.5 * static_cast<double>(n);
        assumption_str = "uniform-wear";
    } else {
        // F = π·p_a·(R_o²−R_i²)  ⇒  p_a = F / (π·(R_o²−R_i²)) = p_avg
        p_max = p_avg;
        // T = (2/3)·μ·F·(R_o³−R_i³)/(R_o²−R_i²) · n
        const double num = std::pow(Ro, 3) - std::pow(Ri, 3);
        const double den = Ro * Ro - Ri * Ri;
        torque_Nmm = (2.0 / 3.0) * mu * F * (num / den) * static_cast<double>(n);
        assumption_str = "uniform-pressure";
    }

    Result r;
    r.meanRadiusMm      = (Ro + Ri) * 0.5;
    r.contactAreaMm2    = area_mm2;
    r.torqueNm          = torque_Nmm * 1e-3;       // N·mm → N·m
    r.averagePressureMPa= p_avg;
    r.maxPressureMPa    = p_max;
    r.assumptionUsed    = assumption_str;
    return r;
}

}  // namespace forge::discbrake
