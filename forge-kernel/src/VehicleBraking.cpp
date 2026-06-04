// Forge-298 — implementation; see header for derivation references.

#include "forge/VehicleBraking.hpp"

#include <stdexcept>

namespace forge::vehbrake {

Result analyse(const Input& in) {
    if (in.vehicleMassKg <= 0.0)
        throw std::runtime_error("vehicleMassKg must be > 0");
    if (in.initialSpeedKmH <= 0.0)
        throw std::runtime_error("initialSpeedKmH must be > 0");
    if (in.decelerationMs2 <= 0.0)
        throw std::runtime_error("decelerationMs2 must be > 0");
    if (in.brakeCount < 1 || in.brakeCount > 20)
        throw std::runtime_error("brakeCount must be in [1, 20]");
    if (in.discMassKg <= 0.0)
        throw std::runtime_error("discMassKg must be > 0");
    if (in.discSpecificHeatJkgK <= 0.0)
        throw std::runtime_error("discSpecificHeatJkgK must be > 0");

    const double v   = in.initialSpeedKmH / 3.6;        // m/s
    const double KE  = 0.5 * in.vehicleMassKg * v * v;
    const double t   = v / in.decelerationMs2;
    const double d   = v * v / (2.0 * in.decelerationMs2);
    const double F   = in.vehicleMassKg * in.decelerationMs2;
    const double F_each = F / static_cast<double>(in.brakeCount);
    const double Q_each = KE / static_cast<double>(in.brakeCount);
    const double dT  = Q_each / (in.discSpecificHeatJkgK * in.discMassKg);
    const double P   = KE / t;

    Result r;
    r.initialSpeedMs         = v;
    r.initialKineticEnergyJ  = KE;
    r.stopTimeS              = t;
    r.stopDistanceM          = d;
    r.brakeForceTotalN       = F;
    r.brakeForcePerBrakeN    = F_each;
    r.heatPerBrakeJ          = Q_each;
    r.discTemperatureRiseK   = dT;
    r.averagePowerW          = P;
    return r;
}

}  // namespace forge::vehbrake
