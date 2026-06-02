// Forge-237 — Fillet weld implementation.

#include "forge/FilletWeld.hpp"

#include <stdexcept>

namespace forge::filletweld {

namespace {
constexpr double sqrt2_inv = 0.7071067811865476;  // sin 45° = cos 45°

double awsMinLegMm(double t_thicker_m) {
    const double t_mm = t_thicker_m * 1000.0;
    if (t_mm <= 6.0)  return 3.0;
    if (t_mm <= 13.0) return 5.0;
    if (t_mm <= 19.0) return 6.0;
    return 8.0;
}

double aiscMaxLegM(double t_edge_m) {
    if (t_edge_m < 6.4e-3) return t_edge_m;
    return t_edge_m - 1.6e-3;
}
}  // namespace

Result analyse(const Input& in) {
    if (in.legSizeM <= 0.0 || in.weldLengthM <= 0.0)
        throw std::invalid_argument("leg and weld length must be positive");
    if (in.electrodeFexxPa <= 0.0)
        throw std::invalid_argument("F_EXX must be positive");
    if (in.thickerPlateM <= 0.0 || in.edgePlateM <= 0.0)
        throw std::invalid_argument("plate thicknesses must be positive");

    Result r{};
    r.effectiveThroatM      = sqrt2_inv * in.legSizeM;
    const double F_nw       = 0.60 * in.electrodeFexxPa;
    r.nominalPerUnitNPerM   = F_nw * r.effectiveThroatM;
    r.designPerUnitNPerM    = in.phi * r.nominalPerUnitNPerM;
    r.totalDesignN          = r.designPerUnitNPerM * in.weldLengthM;
    r.awsMinLegM            = awsMinLegMm(in.thickerPlateM) / 1000.0;
    r.aiscMaxLegM           = aiscMaxLegM(in.edgePlateM);
    r.legBelowAwsMin        = in.legSizeM < r.awsMinLegM;
    r.legAboveAiscMax       = in.legSizeM > r.aiscMaxLegM;
    return r;
}

}  // namespace forge::filletweld
