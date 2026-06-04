#include "forge/SepticTank.hpp"

#include <stdexcept>

namespace forge::septic {

Result analyse(const Input& in) {
    if (in.occupants <= 0) throw std::runtime_error("occupants > 0");
    if (in.dailyFlowPerPersonL <= 0.0) throw std::runtime_error("dailyFlowPerPersonL > 0");
    if (in.retentionDays <= 0.0) throw std::runtime_error("retentionDays > 0");
    if (in.sludgeReserveFraction < 0.0) throw std::runtime_error("sludgeReserveFraction ≥ 0");

    const double daily = in.occupants * in.dailyFlowPerPersonL;
    const double primary = daily * in.retentionDays;
    const double sludge = primary * in.sludgeReserveFraction;
    const double total = primary + sludge;

    Result r;
    r.dailyInflowL       = daily;
    r.primaryStorageL    = primary;
    r.sludgeReserveL     = sludge;
    r.totalVolumeL       = total;
    r.totalVolumeM3      = total / 1000.0;
    return r;
}

}  // namespace forge::septic
