// Forge-306 — implementation; see header for derivation references.

#include "forge/CoolingLoad.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::coolingload {

Result analyse(const Input& in) {
    if (in.airflowLps <= 0.0)
        throw std::runtime_error("airflowLps must be > 0");
    if (in.wSupplyKgPerKg < 0.0 || in.wReturnKgPerKg < 0.0)
        throw std::runtime_error("humidity ratios must be ≥ 0");

    constexpr double cpa  = 1.006;      // kJ/kg·K dry air
    constexpr double cpv  = 1.86;       // kJ/kg·K vapor
    constexpr double hfg0 = 2501.0;     // kJ/kg at 0 °C

    const double Tret = in.tReturnC;
    const double Tsup = in.tSupplyC;
    const double Wret = in.wReturnKgPerKg;
    const double Wsup = in.wSupplyKgPerKg;

    // Mean dry-air density at mean coil-air temperature (Boltzmann ideal-gas)
    double rho;
    if (in.atmPressureKPa > 0.0) {
        const double Tmean = 0.5 * (Tret + Tsup) + 273.15;
        rho = (in.atmPressureKPa * 1000.0) / (287.0 * Tmean);  // kg/m³
    } else {
        rho = 1.20;
    }

    const double Qv = in.airflowLps * 1e-3;          // m³/s
    const double m  = rho * Qv;                       // kg/s dry air

    const double Qsens = m * cpa * (Tret - Tsup);     // kW
    const double Qlat  = m * hfg0 * (Wret - Wsup);    // kW
    const double Qtot  = Qsens + Qlat;                // kW

    const double h_ret = cpa * Tret + Wret * (hfg0 + cpv * Tret);
    const double h_sup = cpa * Tsup + Wsup * (hfg0 + cpv * Tsup);
    const double dh    = h_ret - h_sup;

    Result r;
    r.massFlowKgPerS         = m;
    r.sensibleLoadKw         = Qsens;
    r.latentLoadKw           = Qlat;
    r.totalLoadKw            = Qtot;
    r.sensibleHeatRatio      = (std::fabs(Qtot) > 1e-9) ? Qsens / Qtot : 1.0;
    r.enthalpyDifferenceKjKg = dh;
    r.modeName               = (Qtot >= 0.0) ? "cooling" : "heating";
    return r;
}

}  // namespace forge::coolingload
