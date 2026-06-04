// Forge-308 — implementation; see header for derivation references.

#include "forge/CoolingTower.hpp"

#include <stdexcept>

namespace forge::coolingtower {

Result analyse(const Input& in) {
    if (in.waterFlowLps <= 0.0)
        throw std::runtime_error("waterFlowLps must be > 0");
    if (in.inletTempC <= in.outletTempC)
        throw std::runtime_error("inletTempC must be > outletTempC (range > 0)");
    if (in.outletTempC <= in.wetBulbTempC)
        throw std::runtime_error("outletTempC must be > wetBulbTempC (positive approach)");
    if (in.cyclesOfConcentration < 2.0)
        throw std::runtime_error("cyclesOfConcentration must be ≥ 2");
    if (in.driftFraction < 0.0)
        throw std::runtime_error("driftFraction must be ≥ 0");

    constexpr double cp_water  = 4.186;     // kJ/kg·K
    constexpr double h_fg      = 2430.0;    // kJ/kg at 30 °C (representative)

    const double Q_w_kgs = in.waterFlowLps;  // L/s → kg/s (ρ=1)
    const double range   = in.inletTempC - in.outletTempC;
    const double approach= in.outletTempC - in.wetBulbTempC;
    const double Q_rej   = Q_w_kgs * cp_water * range;        // kW

    const double m_evap  = Q_rej / h_fg;                       // kg/s
    const double m_bleed = m_evap / (in.cyclesOfConcentration - 1.0);
    const double m_drift = in.driftFraction * Q_w_kgs;
    const double m_makeup= m_evap + m_bleed + m_drift;

    Result r;
    r.rangeK              = range;
    r.approachK           = approach;
    r.heatRejectionKw     = Q_rej;
    r.evaporationLps      = m_evap;
    r.bleedLps            = m_bleed;
    r.driftLps            = m_drift;
    r.makeupLps           = m_makeup;
    r.evaporationPercent  = 100.0 * m_evap   / Q_w_kgs;
    r.makeupPercent       = 100.0 * m_makeup / Q_w_kgs;
    return r;
}

}  // namespace forge::coolingtower
