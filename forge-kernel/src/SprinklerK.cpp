#include "forge/SprinklerK.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::sprinkler {

Result analyse(const Input& in) {
    if (in.kFactorUSorMetric <= 0) throw std::runtime_error("K > 0");
    if (in.pressurePsi_or_bar <= 0) throw std::runtime_error("P > 0");
    if (in.designDensityMmPerMin <= 0) throw std::runtime_error("density > 0");
    if (in.operationAreaM2 <= 0) throw std::runtime_error("area > 0");

    double Q_lpm;
    double Q_gpm;
    if (in.metricInputs) {
        Q_lpm = in.kFactorUSorMetric * std::sqrt(in.pressurePsi_or_bar);
        Q_gpm = Q_lpm / 3.785;
    } else {
        Q_gpm = in.kFactorUSorMetric * std::sqrt(in.pressurePsi_or_bar);
        Q_lpm = Q_gpm * 3.785;
    }

    // density [mm/min] · area [m²] = L/min (since 1 mm = 1 L/m²)
    const double Q_required = in.designDensityMmPerMin * in.operationAreaM2;

    Result r;
    r.sprinklerFlowLpm     = Q_lpm;
    r.sprinklerFlowGpm     = Q_gpm;
    r.requiredAreaFlowLpm  = Q_required;
    r.sprinklerOK          = Q_lpm >= Q_required;
    return r;
}

}  // namespace forge::sprinkler
