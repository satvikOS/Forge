// Forge-236 — Bolted connection implementation.

#include "forge/BoltedConnection.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::boltconn {

ShearResult analyseShear(const ShearInput& in) {
    if (in.boltAreaM2 <= 0.0 || in.plateThicknessM <= 0.0 || in.boltNominalDiamM <= 0.0)
        throw std::invalid_argument("bolt/plate geometry must be positive");
    if (in.shearPlanes != 1 && in.shearPlanes != 2)
        throw std::invalid_argument("shearPlanes must be 1 or 2");
    if (in.boltUltimatePa <= 0.0 || in.plateUltimatePa <= 0.0)
        throw std::invalid_argument("F_ub, F_u must be positive");

    ShearResult r{};
    // F_nv for "threads in shear plane" (AISC J3-1 Table J3.2 → 0.45·F_ub).
    const double F_nv = 0.45 * in.boltUltimatePa;
    r.boltShearN = static_cast<double>(in.shearPlanes) * F_nv * in.boltAreaM2;

    // Plate bearing — both branches of J3-6a.
    r.bearingLcN = 1.2 * in.edgeClearanceM * in.plateThicknessM * in.plateUltimatePa;
    r.bearingDbN = 2.4 * in.boltNominalDiamM * in.plateThicknessM * in.plateUltimatePa;
    r.bearingN = std::min(r.bearingLcN, r.bearingDbN);

    r.designShearN = in.phiShear * r.boltShearN;
    r.designBearingN = in.phiBearing * r.bearingN;
    r.governingN = std::min(r.designShearN, r.designBearingN);
    r.governedByShear = r.designShearN < r.designBearingN;
    return r;
}

TensionResult analyseTension(const TensionInput& in) {
    if (in.grossAreaM2 <= 0.0 || in.plateWidthM <= 0.0 || in.plateThicknessM <= 0.0)
        throw std::invalid_argument("plate geometry must be positive");
    if (in.boltsAcross < 0)
        throw std::invalid_argument("boltsAcross must be ≥ 0");
    if (in.shearLagU <= 0.0 || in.shearLagU > 1.0)
        throw std::invalid_argument("shear-lag U must be in (0, 1]");

    TensionResult r{};
    const double A_n_raw = (in.plateWidthM
                            - static_cast<double>(in.boltsAcross) * in.holeDiameterM)
                           * in.plateThicknessM;
    r.netAreaM2 = std::max(A_n_raw, 0.0);
    r.effectiveAreaM2 = in.shearLagU * r.netAreaM2;

    r.yieldingN = in.yieldPa * in.grossAreaM2;
    r.ruptureN  = in.ultimatePa * r.effectiveAreaM2;

    r.designYieldN   = in.phiYield   * r.yieldingN;
    r.designRuptureN = in.phiRupture * r.ruptureN;
    r.governingN = std::min(r.designYieldN, r.designRuptureN);
    r.governedByRupture = r.designRuptureN < r.designYieldN;
    return r;
}

}  // namespace forge::boltconn
