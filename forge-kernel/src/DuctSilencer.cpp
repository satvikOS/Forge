#include "forge/DuctSilencer.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::silencer {

Result analyse(const Input& in) {
    if (in.length_m <= 0)             throw std::runtime_error("L > 0");
    if (in.openCrossArea_m2 <= 0)     throw std::runtime_error("A_open > 0");
    if (in.linedPerimeter_m <= 0)     throw std::runtime_error("P > 0");
    if (in.faceVelocity_mps <= 0)     throw std::runtime_error("v > 0");
    if (in.airDensity_kgM3 <= 0)      throw std::runtime_error("ρ > 0");
    if (in.pressureLossK <= 0)        throw std::runtime_error("K_loss > 0");
    if (in.Koct_dBPerMeter <= 0)      throw std::runtime_error("K_oct > 0");

    const double IL = in.Koct_dBPerMeter * (in.linedPerimeter_m * in.length_m)
                     / in.openCrossArea_m2;
    const double dP = in.pressureLossK * in.airDensity_kgM3
                    * in.faceVelocity_mps * in.faceVelocity_mps / 2.0;
    // Self-noise empirical L_w ≈ 10 + 50·log10(v[m/s]) + 10·log10(A[m²]).
    const double Lw = 10.0 + 50.0 * std::log10(in.faceVelocity_mps)
                          + 10.0 * std::log10(in.openCrossArea_m2);

    Result r;
    r.insertionLoss_dB   = IL;
    r.pressureDrop_Pa    = dP;
    r.selfNoise_LwA_dB   = Lw;
    return r;
}

}  // namespace forge::silencer
