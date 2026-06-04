#include "forge/CMUCompression.hpp"

#include <stdexcept>

namespace forge::cmucomp {

Result analyse(const Input& in) {
    if (in.netAreaMm2 <= 0) throw std::runtime_error("A_n > 0");
    if (in.radiusOfGyrationMm <= 0) throw std::runtime_error("r > 0");
    if (in.effectiveHeightMm <= 0) throw std::runtime_error("h > 0");
    if (in.fm_MPa <= 0) throw std::runtime_error("f'_m > 0");

    const double hr = in.effectiveHeightMm / in.radiusOfGyrationMm;
    double slender_factor;
    bool slender = false;
    if (hr <= 99.0) {
        const double ratio = hr / 140.0;
        slender_factor = 1.0 - ratio * ratio;
    } else {
        slender_factor = 70.0 / hr;
        slender_factor *= slender_factor;
        slender = true;
    }
    const double Pn_N = 0.80 * in.netAreaMm2 * in.fm_MPa * slender_factor;

    Result r;
    r.slendernessRatio_h_r = hr;
    r.nominalCapacityKn    = Pn_N / 1000.0;
    r.designCapacityKn     = 0.60 * Pn_N / 1000.0;
    r.slenderRegime        = slender;
    return r;
}

}  // namespace forge::cmucomp
