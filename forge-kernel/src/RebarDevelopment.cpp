// Forge-320a — see header.

#include "forge/RebarDevelopment.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::rebardev {

Result analyse(const Input& in) {
    if (in.barDiameter_db_mm <= 0.0)
        throw std::runtime_error("barDiameter_db_mm must be > 0");
    if (in.fc_MPa <= 0.0)
        throw std::runtime_error("fc_MPa must be > 0");
    if (in.fy_MPa <= 0.0)
        throw std::runtime_error("fy_MPa must be > 0");
    if (in.lambda <= 0.0)
        throw std::runtime_error("lambda must be > 0");
    if (in.psi_t < 1.0 || in.psi_t > 1.3)
        throw std::runtime_error("psi_t must be in [1.0, 1.3]");
    if (in.psi_e < 1.0 || in.psi_e > 1.5)
        throw std::runtime_error("psi_e must be in [1.0, 1.5]");
    if (in.psi_s <= 0.0 || in.psi_s > 1.0)
        throw std::runtime_error("psi_s must be in (0, 1]");
    if (in.clearCover_cb_mm <= 0.0)
        throw std::runtime_error("clearCover_cb_mm must be > 0");
    if (in.Ktr_mm < 0.0)
        throw std::runtime_error("Ktr_mm must be ≥ 0");

    const double cbKtr = std::min((in.clearCover_cb_mm + in.Ktr_mm) / in.barDiameter_db_mm, 2.5);
    const double num = in.fy_MPa * in.psi_t * in.psi_e * in.psi_s;
    const double den = 1.1 * in.lambda * std::sqrt(in.fc_MPa) * cbKtr;
    const double raw = (num / den) * in.barDiameter_db_mm;
    const double ld  = std::max(raw, 300.0);

    Result r;
    r.cbKtrOverDb         = cbKtr;
    r.developmentLengthMm = ld;
    r.rawLengthMm         = raw;
    r.minimumGoverned     = (ld == 300.0 && raw < 300.0);
    return r;
}

}  // namespace forge::rebardev
