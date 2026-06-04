#include "forge/GroundGrid.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::groundgrid {

Result analyse(const Input& in) {
    if (in.soilResistivity_rho_Ohmm <= 0)            throw std::runtime_error("ρ > 0");
    if (in.surfaceLayerResistivity_rhos_Ohmm <= 0)   throw std::runtime_error("ρ_s > 0");
    if (in.surfaceLayerDepth_hs_m <= 0)              throw std::runtime_error("h_s > 0");
    if (in.gridDepth_h_m <= 0)                       throw std::runtime_error("h > 0");
    if (in.gridArea_m2 <= 0)                         throw std::runtime_error("A > 0");
    if (in.totalConductorLength_m <= 0)              throw std::runtime_error("L_T > 0");
    if (in.faultClearTime_s <= 0)                    throw std::runtime_error("t_s > 0");
    if (in.faultCurrent_kA <= 0)                     throw std::runtime_error("I_F > 0");
    if (in.conductorKf <= 0)                         throw std::runtime_error("K_f > 0");
    if (in.bodyWeight_kg != 50 && in.bodyWeight_kg != 70)
        throw std::runtime_error("body 50 or 70");

    const double rho   = in.soilResistivity_rho_Ohmm;
    const double rho_s = in.surfaceLayerResistivity_rhos_Ohmm;
    const double Cs    = 1.0
        - (0.09 * (1.0 - rho / rho_s)) / (2.0 * in.surfaceLayerDepth_hs_m + 0.09);
    const double safety = (in.bodyWeight_kg == 50) ? 0.116 : 0.157;
    const double E_step  = (1000.0 + 6.0   * Cs * rho_s) * safety / std::sqrt(in.faultClearTime_s);
    const double E_touch = (1000.0 + 1.5   * Cs * rho_s) * safety / std::sqrt(in.faultClearTime_s);

    const double A_req = in.faultCurrent_kA * 1000.0
                       * std::sqrt(in.faultClearTime_s * in.conductorKf);
    // Sverak grid resistance approximation.
    const double sqrt20A = std::sqrt(20.0 / in.gridArea_m2);
    const double Rg = rho * (
        1.0 / in.totalConductorLength_m
      + (1.0 / std::sqrt(20.0 * in.gridArea_m2))
        * (1.0 + 1.0 / (1.0 + in.gridDepth_h_m * sqrt20A))
    );
    const double GPR = in.faultCurrent_kA * 1000.0 * Rg;

    Result r;
    r.Cs_surface_derating       = Cs;
    r.allowableStepVoltage_V    = E_step;
    r.allowableTouchVoltage_V   = E_touch;
    r.requiredConductorArea_mm2 = A_req;
    r.gridResistance_Ohm        = Rg;
    r.groundPotentialRise_V     = GPR;
    return r;
}

}  // namespace forge::groundgrid
