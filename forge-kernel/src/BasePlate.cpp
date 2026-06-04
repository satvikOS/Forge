// Forge-318 — implementation; see header for derivation references.

#include "forge/BasePlate.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::baseplate {

Result analyse(const Input& in) {
    if (in.appliedAxialKn <= 0.0)
        throw std::runtime_error("appliedAxialKn must be > 0");
    if (in.plateWidthB_mm <= 0.0 || in.plateLengthN_mm <= 0.0)
        throw std::runtime_error("plate dimensions must be > 0");
    if (in.columnDepthD_mm <= 0.0 || in.columnFlangeBf_mm <= 0.0)
        throw std::runtime_error("column dimensions must be > 0");
    if (in.supportWidthB2_mm <= 0.0 || in.supportLengthN2_mm <= 0.0)
        throw std::runtime_error("support dimensions must be > 0");
    if (in.supportWidthB2_mm < in.plateWidthB_mm
        || in.supportLengthN2_mm < in.plateLengthN_mm)
        throw std::runtime_error("support area must contain the plate area");
    if (in.fc_MPa <= 0.0)
        throw std::runtime_error("fc_MPa must be > 0");
    if (in.Fy_MPa <= 0.0)
        throw std::runtime_error("Fy_MPa must be > 0");

    const double A1 = in.plateWidthB_mm * in.plateLengthN_mm;
    const double A2 = in.supportWidthB2_mm * in.supportLengthN2_mm;
    const double sqrtRatio = std::min(std::sqrt(A2 / A1), 2.0);

    const double Pp_N = 0.85 * in.fc_MPa * A1 * sqrtRatio;     // N
    constexpr double phi = 0.65;
    constexpr double omega = 2.31;
    const double phiPp_kN = phi * Pp_N / 1000.0;
    const double omPp_kN  = (Pp_N / omega) / 1000.0;

    const double m   = (in.plateLengthN_mm - 0.95 * in.columnDepthD_mm) / 2.0;
    const double n   = (in.plateWidthB_mm  - 0.80 * in.columnFlangeBf_mm) / 2.0;
    const double nPrime = std::sqrt(in.columnDepthD_mm * in.columnFlangeBf_mm) / 4.0;

    const double L_gov = std::max({std::abs(m), std::abs(n), nPrime});

    const double Pu_N = in.appliedAxialKn * 1000.0;
    const double tReq = L_gov * std::sqrt(2.0 * Pu_N
        / (phi * in.Fy_MPa * in.plateWidthB_mm * in.plateLengthN_mm));

    Result r;
    r.A_1_mm2                       = A1;
    r.A_2_mm2                       = A2;
    r.sqrtA2A1                      = sqrtRatio;
    r.bearingStrength_Pp_kN         = Pp_N / 1000.0;
    r.LRFD_phiPp_kN                 = phiPp_kN;
    r.ASD_PpOverOmega_kN            = omPp_kN;
    r.projection_m_mm               = m;
    r.projection_n_mm               = n;
    r.thorntonLambda_nprime_mm      = nPrime;
    r.governingProjection_mm        = L_gov;
    r.requiredPlateThickness_mm     = tReq;
    r.bearingPasses                 = in.appliedAxialKn <= phiPp_kN;
    return r;
}

}  // namespace forge::baseplate
