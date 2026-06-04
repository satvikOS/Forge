#include "forge/FiberLink.hpp"

#include <stdexcept>

namespace forge::fiberlink {

Result analyse(const Input& in) {
    if (in.systemMargin_dB < 0)              throw std::runtime_error("margin >= 0");
    if (in.fiberAttenuation_dBperKm <= 0)    throw std::runtime_error("α > 0");
    if (in.linkLength_km <= 0)               throw std::runtime_error("L > 0");
    if (in.spliceCount < 0)                  throw std::runtime_error("N_splice >= 0");
    if (in.connectorCount < 0)               throw std::runtime_error("N_conn >= 0");
    if (in.spliceLoss_dB < 0)                throw std::runtime_error("splice loss >= 0");
    if (in.connectorLoss_dB < 0)             throw std::runtime_error("conn loss >= 0");

    const double A = in.txPower_dBm - in.rxSensitivity_dBm - in.systemMargin_dB;
    const double A_fiber = in.fiberAttenuation_dBperKm * in.linkLength_km;
    const double A_splice = in.spliceCount * in.spliceLoss_dB;
    const double A_conn = in.connectorCount * in.connectorLoss_dB;
    const double A_total = A_fiber + A_splice + A_conn;
    const double remaining = A - A_total;

    const double fixed = A_splice + A_conn;
    const double L_max = (A - fixed) / in.fiberAttenuation_dBperKm;

    Result r;
    r.allowableBudget_dB      = A;
    r.fiberLoss_dB            = A_fiber;
    r.spliceLoss_dB_total     = A_splice;
    r.connectorLoss_dB_total  = A_conn;
    r.totalLoss_dB            = A_total;
    r.remainingMargin_dB      = remaining;
    r.maxReach_km             = L_max;
    r.linkOK                  = remaining >= 0;
    return r;
}

}  // namespace forge::fiberlink
