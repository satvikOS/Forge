#include "forge/DustExplosionVent.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::dustvent {

Result analyse(const Input& in) {
    if (in.vesselVolumeM3 <= 0.0) throw std::runtime_error("vesselVolume > 0");
    if (in.kstBarMperS <= 0.0) throw std::runtime_error("K_st > 0");
    if (in.maxAllowableOverpressureBar <= in.ventReleasePressureBar)
        throw std::runtime_error("P_red > P_stat");
    if (in.ventReleasePressureBar < 0.0)
        throw std::runtime_error("P_stat ≥ 0");

    const double dP = in.maxAllowableOverpressureBar - in.ventReleasePressureBar;
    const double Av = (1.0 + 1.54 * std::pow(in.ventReleasePressureBar, 4.0/3.0))
                    * 1.0e-4 * in.kstBarMperS
                    * std::pow(in.vesselVolumeM3, 3.0/4.0)
                    / std::sqrt(dP);

    Result r;
    r.ventAreaM2          = Av;
    r.pressureMarginBar   = dP;
    return r;
}

}  // namespace forge::dustvent
