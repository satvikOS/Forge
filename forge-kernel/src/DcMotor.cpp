// Forge-279 — implementation; see header for derivation references.

#include "forge/DcMotor.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::dcmotor {

Result analyse(const Input& in) {
    if (in.supplyVoltageV <= 0.0)
        throw std::runtime_error("supplyVoltageV must be > 0");
    if (in.armatureResistanceOhms <= 0.0)
        throw std::runtime_error("armatureResistanceOhms must be > 0");
    if (in.motorConstantVPerRadS <= 0.0)
        throw std::runtime_error("motorConstantVPerRadS must be > 0");
    if (in.loadTorqueNm < 0.0)
        throw std::runtime_error("loadTorqueNm must be ≥ 0");
    if (in.fieldResistanceOhms < 0.0)
        throw std::runtime_error("fieldResistanceOhms must be ≥ 0");

    const double V  = in.supplyVoltageV;
    const double Ra = in.armatureResistanceOhms;
    const double K  = in.motorConstantVPerRadS;   // K_a·Φ
    const double TL = in.loadTorqueNm;
    const double Rf = in.fieldResistanceOhms;

    const double Ia = TL / K;
    const double Ea = V - Ia * Ra;
    if (Ea <= 0.0)
        throw std::runtime_error("Load torque exceeds stall torque (E_a ≤ 0)");

    const double omega = Ea / K;
    const double n     = omega * 60.0 / (2.0 * M_PI);

    const double omega0 = V / K;
    const double n0     = omega0 * 60.0 / (2.0 * M_PI);
    const double Ts     = V * K / Ra;
    const double SR     = (n > 0.0) ? (n0 - n) / n * 100.0 : 0.0;

    const double Pmech    = TL * omega;
    const double Pin_arm  = V * Ia;
    const double Pcu_arm  = Ia * Ia * Ra;
    const double If       = (Rf > 0.0) ? V / Rf : 0.0;
    const double Pcu_fld  = If * If * Rf;
    const double eta_arm  = (Pin_arm > 0.0) ? Pmech / Pin_arm : 0.0;

    Result r;
    r.armatureCurrentA     = Ia;
    r.backEmfV             = Ea;
    r.angularSpeedRadS     = omega;
    r.speedRpm             = n;
    r.noLoadSpeedRpm       = n0;
    r.stallTorqueNm        = Ts;
    r.speedRegulationPct   = SR;
    r.mechanicalPowerW     = Pmech;
    r.armatureInputPowerW  = Pin_arm;
    r.armatureCopperLossW  = Pcu_arm;
    r.fieldCurrentA        = If;
    r.fieldCopperLossW     = Pcu_fld;
    r.armatureEfficiency   = eta_arm;
    return r;
}

}  // namespace forge::dcmotor
