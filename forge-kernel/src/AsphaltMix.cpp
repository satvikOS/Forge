#include "forge/AsphaltMix.hpp"

#include <stdexcept>

namespace forge::asphalt {

Result analyse(const Input& in) {
    if (in.aggregateSG <= 1.0) throw std::runtime_error("aggregateSG > 1");
    if (in.asphaltSG   <= 0.5) throw std::runtime_error("asphaltSG > 0.5");
    if (in.asphaltContentPct <= 0.0 || in.asphaltContentPct >= 20.0)
        throw std::runtime_error("asphaltContentPct must be in (0, 20)");
    if (in.bulkSG_Gmb <= 1.0) throw std::runtime_error("bulkSG_Gmb > 1");

    const double Wb = in.asphaltContentPct;
    const double Gmm = 100.0 / (Wb / in.asphaltSG + (100.0 - Wb) / in.aggregateSG);
    const double Va = (Gmm - in.bulkSG_Gmb) / Gmm * 100.0;
    const double VMA = 100.0 - in.bulkSG_Gmb * (100.0 - Wb) / in.aggregateSG;
    const double VFA = (VMA - Va) / VMA * 100.0;

    Result r;
    r.theoreticalMaxSG          = Gmm;
    r.airVoidsPct               = Va;
    r.vmaPct                    = VMA;
    r.vfaPct                    = VFA;
    r.meetsSuperpaveAirVoids    = (Va >= 3.0 && Va <= 5.0);
    return r;
}

}  // namespace forge::asphalt
