// Forge-303 — implementation; see header for derivation references.

#include "forge/HazenWilliams.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::hazenwilliams {

Result analyse(const Input& in) {
    if (in.pipeLengthM <= 0.0)
        throw std::runtime_error("pipeLengthM must be > 0");
    if (in.innerDiameterMm <= 0.0)
        throw std::runtime_error("innerDiameterMm must be > 0");
    if (in.flowLpm <= 0.0)
        throw std::runtime_error("flowLpm must be > 0");
    if (in.hazenWilliamsC <= 0.0)
        throw std::runtime_error("hazenWilliamsC must be > 0");

    constexpr double rho_water = 1000.0;     // kg/m³
    constexpr double g         = 9.80665;    // m/s²
    constexpr double mu_water  = 1.002e-3;   // Pa·s (20 °C)
    constexpr double PI        = 3.141592653589793;

    const double D = in.innerDiameterMm / 1000.0;          // m
    const double Q = in.flowLpm / 60000.0;                 // m³/s
    const double A = 0.25 * PI * D * D;                    // m²
    const double V = Q / A;                                // m/s
    const double Re = rho_water * V * D / mu_water;

    int regime;
    if      (Re <  2000.0) regime = 1;  // laminar — HW invalid
    else if (Re <  4000.0) regime = 2;  // transitional
    else                   regime = 3;  // turbulent — HW good

    const double hf_per_m = 10.67 * std::pow(Q, 1.85)
                          / (std::pow(in.hazenWilliamsC, 1.85) * std::pow(D, 4.87));
    const double dP_per_m_Pa = rho_water * g * hf_per_m;
    const double total_kPa   = dP_per_m_Pa * in.pipeLengthM / 1000.0;
    const double vhead_kPa   = 0.5 * rho_water * V * V / 1000.0;

    Result r;
    r.velocityMs              = V;
    r.reynoldsApprox          = Re;
    r.regimeFlag              = regime;
    r.frictionLossMPerM       = hf_per_m;
    r.pressureGradientKpaPerM = dP_per_m_Pa / 1000.0;
    r.totalPressureLossKpa    = total_kPa;
    r.velocityHeadKpa         = vhead_kPa;
    return r;
}

}  // namespace forge::hazenwilliams
