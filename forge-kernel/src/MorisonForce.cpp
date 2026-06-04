#include "forge/MorisonForce.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::morison {

static double solveWaveNumber(double omega, double d) {
    // dispersion ω² = gk·tanh(kd) — Newton-Raphson, initial guess deep-water k_0 = ω²/g.
    constexpr double g = 9.80665;
    double k = omega * omega / g;
    for (int i = 0; i < 50; ++i) {
        const double f = g * k * std::tanh(k * d) - omega * omega;
        const double df = g * (std::tanh(k * d) + k * d * (1.0 - std::pow(std::tanh(k * d), 2.0)));
        if (std::fabs(df) < 1e-30) break;
        const double dk = f / df;
        k -= dk;
        if (std::fabs(dk) < 1e-10) break;
    }
    return k;
}

Result analyse(const Input& in) {
    if (in.waveHeight_H_m <= 0)         throw std::runtime_error("H > 0");
    if (in.wavePeriod_T_s <= 0)         throw std::runtime_error("T > 0");
    if (in.waterDepth_d_m <= 0)         throw std::runtime_error("d > 0");
    if (in.cylinderDiameter_D_m <= 0)   throw std::runtime_error("D > 0");
    if (in.waterDensity_kgM3 <= 0)      throw std::runtime_error("ρ > 0");
    if (in.inertiaCoeff_CM <= 0)        throw std::runtime_error("C_M > 0");
    if (in.dragCoeff_CD <= 0)           throw std::runtime_error("C_D > 0");
    if (in.evaluationDepth_z_m > 0)     throw std::runtime_error("z ≤ 0 (below SWL)");

    const double omega = 2.0 * M_PI / in.wavePeriod_T_s;
    const double k = solveWaveNumber(omega, in.waterDepth_d_m);
    const double H = in.waveHeight_H_m;
    const double z = in.evaluationDepth_z_m;
    const double d = in.waterDepth_d_m;

    const double profile = std::cosh(k * (z + d)) / std::sinh(k * d);
    const double u_max = M_PI * H / in.wavePeriod_T_s * profile;
    const double a_max = 2.0 * M_PI * M_PI * H / (in.wavePeriod_T_s * in.wavePeriod_T_s) * profile;

    const double A = M_PI * std::pow(in.cylinderDiameter_D_m, 2.0) / 4.0;
    const double F_inertia_N = in.waterDensity_kgM3 * A * in.inertiaCoeff_CM * a_max;
    const double F_drag_N    = 0.5 * in.waterDensity_kgM3 * in.cylinderDiameter_D_m
                             * in.dragCoeff_CD * u_max * u_max;
    const double F_result_N  = std::sqrt(F_inertia_N * F_inertia_N + F_drag_N * F_drag_N);

    Result r;
    r.waveNumber_k_perM         = k;
    r.maxParticleVelocity_mps   = u_max;
    r.maxParticleAccel_mps2     = a_max;
    r.inertiaForcePerM_kN       = F_inertia_N / 1000.0;
    r.dragForcePerM_kN          = F_drag_N / 1000.0;
    r.resultantPerM_kN          = F_result_N / 1000.0;
    return r;
}

}  // namespace forge::morison
