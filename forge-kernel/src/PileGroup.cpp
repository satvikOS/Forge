// Forge-319d — see header.

#include "forge/PileGroup.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::pilegroup {

Result analyse(const Input& in) {
    if (in.pileDiameterMm <= 0.0)
        throw std::runtime_error("pileDiameterMm must be > 0");
    if (in.spacingMm <= in.pileDiameterMm)
        throw std::runtime_error("spacingMm must be > pileDiameterMm (no overlap)");
    if (in.rows_m < 1 || in.columns_n < 1)
        throw std::runtime_error("rows_m and columns_n must be ≥ 1");
    if (in.singlePileCapacityKn <= 0.0)
        throw std::runtime_error("singlePileCapacityKn must be > 0");

    const double phi_deg = std::atan(in.pileDiameterMm / in.spacingMm)
                         * 180.0 / 3.141592653589793;
    const int m = in.rows_m;
    const int n = in.columns_n;
    const double term = (static_cast<double>(n - 1) * m
                       + static_cast<double>(m - 1) * n)
                       / (90.0 * m * n);
    const double eta = 1.0 - phi_deg * term;

    Result r;
    r.anglePhiDeg     = phi_deg;
    r.efficiency      = eta;
    r.groupCapacityKn = eta * static_cast<double>(m * n) * in.singlePileCapacityKn;
    return r;
}

}  // namespace forge::pilegroup
