#include "forge/SoldierPile.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::soldierpile {

Result analyse(const Input& in) {
    if (in.wallHeight_H_m <= 0)              throw std::runtime_error("H > 0");
    if (in.soilFrictionAngleDeg_phi <= 0 || in.soilFrictionAngleDeg_phi >= 90)
        throw std::runtime_error("φ in (0, 90)");
    if (in.soilUnitWeight_kNm3 <= 0)         throw std::runtime_error("γ > 0");
    if (in.surcharge_q_kNm2 < 0)             throw std::runtime_error("q >= 0");
    if (in.pileSpacing_S_m <= 0)             throw std::runtime_error("S > 0");
    if (in.soldierPileDepth_d_mm <= 0)       throw std::runtime_error("d_p > 0");
    if (in.soldierPileFy_MPa <= 0)           throw std::runtime_error("F_y > 0");

    const double phi = in.soilFrictionAngleDeg_phi * M_PI / 180.0;
    const double Ka = std::pow(std::tan(M_PI / 4.0 - phi / 2.0), 2.0);
    const double Kp = std::pow(std::tan(M_PI / 4.0 + phi / 2.0), 2.0);
    const double H = in.wallHeight_H_m;
    const double gamma = in.soilUnitWeight_kNm3;
    const double q = in.surcharge_q_kNm2;

    const double p_a_base = Ka * (gamma * H + q);
    const double P_a_per_m = 0.5 * Ka * gamma * H * H + Ka * q * H;
    // FHWA empirical embedment.
    const double d_embed = 1.5 * H * std::sqrt(Ka / Kp);

    // Cantilever pile (above dredge): M_max ≈ P_a · H/3  (acting at H/3 above base).
    // Distribute lateral force over pile spacing S.
    const double M_max_per_pile = P_a_per_m * (H / 3.0) * in.pileSpacing_S_m;
    const double d_m = in.soldierPileDepth_d_mm / 1000.0;
    const double S_mod = M_PI * std::pow(d_m, 3.0) / 32.0;        // m³, circular section
    const double sigma_MPa = M_max_per_pile / S_mod * 1.0e-3;     // kN·m / m³ · MPa/MPa

    Result r;
    r.Ka                              = Ka;
    r.Kp                              = Kp;
    r.activePressureAtBase_kPa        = p_a_base;
    r.totalActiveForce_kNperM         = P_a_per_m;
    r.requiredEmbedment_m             = d_embed;
    r.maxBendingMoment_kNm_perPile    = M_max_per_pile;
    r.maxFiberStress_MPa              = sigma_MPa;
    return r;
}

}  // namespace forge::soldierpile
