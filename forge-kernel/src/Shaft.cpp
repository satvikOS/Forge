// Forge-235 — Shaft design implementation.

#include "forge/Shaft.hpp"

#include <cmath>
#include <limits>
#include <numbers>
#include <stdexcept>

namespace forge::shaft {

namespace {
constexpr double pi = std::numbers::pi;

double sectionModulus(double d) {
    // Z = π·d³ / 32  (solid round shaft)
    return pi * d * d * d / 32.0;
}

double polarSectionModulus(double d) {
    // J/c = π·d³ / 16
    return pi * d * d * d / 16.0;
}
}  // namespace

StaticResult analyseStatic(const StaticInput& in) {
    if (in.diameterM <= 0.0) {
        throw std::invalid_argument("shaft diameter must be positive");
    }
    if (in.yieldMPa <= 0.0) {
        throw std::invalid_argument("shaft yield must be positive");
    }
    StaticResult r{};
    const double Z = sectionModulus(in.diameterM);
    const double Zp = polarSectionModulus(in.diameterM);
    const double sigma_x_Pa = std::abs(in.bendingMomentNm) / Z;
    const double tau_Pa = std::abs(in.torqueNm) / Zp;
    r.bendingStressMPa = sigma_x_Pa / 1.0e6;
    r.shearStressMPa = tau_Pa / 1.0e6;
    r.vonMisesStressMPa = std::sqrt(r.bendingStressMPa * r.bendingStressMPa
                                    + 3.0 * r.shearStressMPa * r.shearStressMPa);
    r.safetyFactor = (r.vonMisesStressMPa > 0.0)
                         ? (in.yieldMPa / r.vonMisesStressMPa)
                         : std::numeric_limits<double>::infinity();
    return r;
}

FatigueResult analyseFatigue(const FatigueInput& in) {
    if (in.diameterM <= 0.0) {
        throw std::invalid_argument("shaft diameter must be positive");
    }
    if (in.ultimateMPa <= 0.0) {
        throw std::invalid_argument("shaft ultimate must be positive");
    }
    if (in.marinFactor <= 0.0) {
        throw std::invalid_argument("Marin factor must be positive");
    }
    if (in.kfBending < 1.0 || in.kfsTorsion < 1.0) {
        throw std::invalid_argument("K_f, K_fs must be ≥ 1");
    }

    FatigueResult r{};
    // Shigley's S_e' rule: 0.5 S_ut for S_ut ≤ 1400 MPa, else 700 MPa.
    const double Se_prime_MPa = (in.ultimateMPa <= 1400.0) ? 0.5 * in.ultimateMPa
                                                           : 700.0;
    r.enduranceLimitMPa = in.marinFactor * Se_prime_MPa;

    const double Z = sectionModulus(in.diameterM);
    const double Zp = polarSectionModulus(in.diameterM);
    const double sigma_a_MPa = std::abs(in.bendingMomentNm) / Z / 1.0e6;  // bending
    const double tau_m_MPa = std::abs(in.torqueNm) / Zp / 1.0e6;          // torsion

    const double sigma_vm_a = in.kfBending * sigma_a_MPa;          // pure bending → σ_vm = σ
    const double sigma_vm_m = std::sqrt(3.0) * in.kfsTorsion * tau_m_MPa;  // pure shear → √3·τ
    r.alternatingMPa = sigma_vm_a;
    r.meanMPa = sigma_vm_m;

    // Modified Goodman: 1/n = σ_a/S_e + σ_m/S_ut
    const double inv_n = sigma_vm_a / r.enduranceLimitMPa
                       + sigma_vm_m / in.ultimateMPa;
    r.safetyFactor = (inv_n > 0.0) ? 1.0 / inv_n
                                    : std::numeric_limits<double>::infinity();
    return r;
}

}  // namespace forge::shaft
