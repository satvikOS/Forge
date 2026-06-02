#include "forge/CarbonLca.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge { namespace carbon {

LcaResult computeLca(const LcaInputs& in) {
    if (in.volumeCm3 <= 0) {
        throw std::invalid_argument("forge.carbon: volume must be > 0");
    }
    if (in.qty <= 0) {
        throw std::invalid_argument("forge.carbon: qty must be ≥ 1");
    }
    if (in.material.co2PerKg < 0) {
        throw std::invalid_argument("forge.carbon: material co2PerKg must be ≥ 0");
    }

    LcaResult R{};
    R.massKg = (in.volumeCm3 / 1.0e6) * in.material.densityKgM3;
    R.unitMaterialKgCo2 = R.massKg * in.material.co2PerKg;

    // Manufacturing energy (kWh) = (spindle_kW × overhead × time_h)
    const double timeH = std::max(0.0, in.machiningTimeMin) / 60.0;
    R.energyKwh = in.process.spindleKW * in.process.overheadFactor * timeH;
    R.unitManufKgCo2 = R.energyKwh * std::max(0.0, in.gridCo2PerKwh);

    // Transport: mass (t) × km × emissions per t-km
    const double massT = R.massKg / 1000.0;
    R.unitTransportKgCo2 = massT * in.transportKm * in.transportEmissionsPerTkm;

    // End-of-life credit: recycling captures part of the embodied carbon back.
    const double recCredit = std::clamp(in.material.recyclingCredit, 0.0, 1.0);
    R.unitRecyclingCreditKgCo2 = -recCredit * R.massKg * in.material.co2PerKg;

    R.unitTotalKgCo2 = R.unitMaterialKgCo2 + R.unitManufKgCo2
                     + R.unitTransportKgCo2 + R.unitRecyclingCreditKgCo2;
    R.batchTotalKgCo2 = R.unitTotalKgCo2 * in.qty;
    return R;
}

}} // namespace forge::carbon
