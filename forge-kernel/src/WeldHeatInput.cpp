#include "forge/WeldHeatInput.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::weldhi {

Result analyse(const Input& in) {
    if (in.arcEfficiency_eta <= 0 || in.arcEfficiency_eta > 1)
        throw std::runtime_error("η in (0, 1]");
    if (in.voltage_V <= 0)                throw std::runtime_error("V > 0");
    if (in.current_A <= 0)                throw std::runtime_error("I > 0");
    if (in.travelSpeed_mmPerS <= 0)       throw std::runtime_error("v > 0");
    if (in.plateThickness_mm <= 0)        throw std::runtime_error("t > 0");
    if (in.preheatTemp_C < 0)             throw std::runtime_error("T_0 >= 0 (°C)");
    if (in.thermalConductivity_k_WmK <= 0) throw std::runtime_error("k > 0");
    if (in.densityRho_kgM3 <= 0)          throw std::runtime_error("ρ > 0");
    if (in.specificHeat_cp_JkgK <= 0)     throw std::runtime_error("c_p > 0");

    const double HI_Jpermm = in.arcEfficiency_eta * in.voltage_V * in.current_A
                            / in.travelSpeed_mmPerS;
    const double HI_kJpermm = HI_Jpermm / 1000.0;

    // Rosenthal thin-plate t_8/5 ≈ (HI/(2π·k·t·ρ·c_p)) · ((1/(500-T0))² − (1/(800-T0))²)
    const double t_m = in.plateThickness_mm * 1.0e-3;
    const double HI_Jperm = HI_Jpermm * 1000.0;        // J/m
    const double bracket = std::pow(1.0 / (500.0 - in.preheatTemp_C), 2.0)
                          - std::pow(1.0 / (800.0 - in.preheatTemp_C), 2.0);
    const double t85_s = (HI_Jperm * bracket)
                       / (2.0 * M_PI * in.thermalConductivity_k_WmK
                                * t_m
                                * in.densityRho_kgM3 * in.specificHeat_cp_JkgK
                                * 1.0e-6);            // dimensional fudge; rough estimate.
    // Heat-affected zone width estimate (rough peak-temp drop to 723°C austenite line).
    const double HAZ_mm = 0.5 * std::sqrt(HI_kJpermm);
    const double severity = HI_kJpermm / (in.thermalConductivity_k_WmK
                                          * in.plateThickness_mm);

    Result r;
    r.heatInput_kJperMm        = HI_kJpermm;
    r.tEightFive_s             = t85_s;
    r.maxHAZWidthEstimate_mm   = HAZ_mm;
    r.thermalCycleSeverity     = severity;
    return r;
}

}  // namespace forge::weldhi
