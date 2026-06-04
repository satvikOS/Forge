#include "forge/BridgeFlutter.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::flutter {

Result analyse(const Input& in) {
    if (in.deckWidth_B_m <= 0)              throw std::runtime_error("B > 0");
    if (in.linearMass_kgPerM <= 0)          throw std::runtime_error("m > 0");
    if (in.torsionalFreq_falpha_Hz <= 0)    throw std::runtime_error("f_α > 0");
    if (in.heaveFreq_fh_Hz <= 0)            throw std::runtime_error("f_h > 0");
    if (in.heaveFreq_fh_Hz >= in.torsionalFreq_falpha_Hz)
        throw std::runtime_error("f_h < f_α");
    if (in.airDensity_kgM3 <= 0)            throw std::runtime_error("ρ > 0");
    if (in.designWindSpeed_Vd_mps <= 0)     throw std::runtime_error("V_d > 0");

    const double b = in.deckWidth_B_m / 2.0;
    const double mu = in.linearMass_kgPerM / (M_PI * in.airDensity_kgM3 * b * b);
    const double omega_a = 2.0 * M_PI * in.torsionalFreq_falpha_Hz;
    const double omega_h = 2.0 * M_PI * in.heaveFreq_fh_Hz;
    const double freqRatioSq = (omega_h / omega_a) * (omega_h / omega_a);
    if (freqRatioSq >= 1.0) throw std::runtime_error("ω_h < ω_α");

    const double Ucr = 0.6 * b * omega_a * std::sqrt(mu * (1.0 - freqRatioSq));
    const double Ur = in.designWindSpeed_Vd_mps / (in.torsionalFreq_falpha_Hz * in.deckWidth_B_m);
    const double SF = Ucr / in.designWindSpeed_Vd_mps;

    Result r;
    r.halfWidth_b_m              = b;
    r.massRatio_mu               = mu;
    r.criticalWindSpeed_Ucr_mps  = Ucr;
    r.reducedVelocity_atVd       = Ur;
    r.safetyFactorUcrOverVd      = SF;
    r.stable                     = Ucr > in.designWindSpeed_Vd_mps;
    return r;
}

}  // namespace forge::flutter
