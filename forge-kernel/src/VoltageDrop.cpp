// Forge-304 — implementation; see header for derivation references.

#include "forge/VoltageDrop.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::voltagedrop {

Result analyse(const Input& in) {
    if (in.crossSectionMm2 <= 0.0)
        throw std::runtime_error("crossSectionMm2 must be > 0");
    if (in.currentA <= 0.0)
        throw std::runtime_error("currentA must be > 0");
    if (in.oneWayLengthM <= 0.0)
        throw std::runtime_error("oneWayLengthM must be > 0");
    if (in.nominalVoltageV <= 0.0)
        throw std::runtime_error("nominalVoltageV must be > 0");
    if (in.powerFactor <= 0.0 || in.powerFactor > 1.0)
        throw std::runtime_error("powerFactor must be in (0,1]");
    if (in.reactancePerMOhm < 0.0)
        throw std::runtime_error("reactancePerMOhm must be ≥ 0");

    double rho20, alpha;
    if (in.conductor == "copper") {
        rho20 = 1.72e-8;
        alpha = 0.00393;
    } else if (in.conductor == "aluminum") {
        rho20 = 2.83e-8;
        alpha = 0.00403;
    } else {
        throw std::runtime_error("conductor must be 'copper' or 'aluminum'");
    }
    const double rho = rho20 * (1.0 + alpha * (in.conductorTempC - 20.0));
    const double A_m2 = in.crossSectionMm2 * 1e-6;
    const double R_per_m = rho / A_m2;

    double K, lossN;
    if (in.phaseSystem == "single") {
        K = 2.0;        // 2-wire round trip
        lossN = 2.0;
    } else if (in.phaseSystem == "three") {
        K = std::sqrt(3.0);
        lossN = 3.0;
    } else {
        throw std::runtime_error("phaseSystem must be 'single' or 'three'");
    }

    const double pf = in.powerFactor;
    const double sinphi = std::sqrt(1.0 - pf * pf);
    const double X = in.reactancePerMOhm;
    const double Z_eff = R_per_m * pf + X * sinphi;
    const double Vdrop = K * in.currentA * Z_eff * in.oneWayLengthM;
    const double Vdrop_pct = 100.0 * Vdrop / in.nominalVoltageV;

    const double P_loss_W = in.currentA * in.currentA * R_per_m
                          * in.oneWayLengthM * lossN;

    Result r;
    r.resistancePerMOhm     = R_per_m;
    r.reactancePerMOhmOut   = X;
    r.impedanceVoltageDropV = Vdrop;
    r.voltageDropV          = Vdrop;
    r.voltageDropPercent    = Vdrop_pct;
    r.powerLossKw           = P_loss_W / 1000.0;
    r.meetsFeederLimit      = Vdrop_pct <= 3.0;
    r.meetsCombinedLimit    = Vdrop_pct <= 5.0;
    return r;
}

}  // namespace forge::voltagedrop
