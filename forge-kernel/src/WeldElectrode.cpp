#include "forge/WeldElectrode.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::weldelec {

Result analyse(const Input& in) {
    if (in.sizeMm <= 0.0) throw std::runtime_error("size > 0");
    if (in.weldLengthM <= 0.0) throw std::runtime_error("length > 0");
    if (in.processEfficiency <= 0.0 || in.processEfficiency > 1.0)
        throw std::runtime_error("efficiency in (0, 1]");
    if (in.electrodeCostPerKg < 0.0)
        throw std::runtime_error("cost ≥ 0");

    constexpr double rho_steel = 7850.0;     // kg/m³
    constexpr double PI = 3.141592653589793;

    double area_mm2;
    if (in.weldType == "fillet") {
        // Rectangular fillet approximation, area = a²/2
        area_mm2 = in.sizeMm * in.sizeMm / 2.0;
    } else if (in.weldType == "groove") {
        if (in.bevelAngleDeg <= 0.0 || in.bevelAngleDeg >= 90.0)
            throw std::runtime_error("bevelAngle in (0, 90)");
        if (in.rootGapMm < 0.0)
            throw std::runtime_error("rootGap ≥ 0");
        // V-groove single bevel: area = t·root + (t²/2)·tan(θ)
        const double t = in.sizeMm;
        const double th = in.bevelAngleDeg * PI / 180.0;
        area_mm2 = t * in.rootGapMm + 0.5 * t * t * std::tan(th);
    } else {
        throw std::runtime_error("weldType must be 'fillet' or 'groove'");
    }

    const double vol_m3 = area_mm2 * 1.0e-6 * in.weldLengthM;
    const double deposit_kg = vol_m3 * rho_steel;
    const double electrode_kg = deposit_kg / in.processEfficiency;
    const double cost = electrode_kg * in.electrodeCostPerKg;

    Result r;
    r.weldAreaMm2     = area_mm2;
    r.weldVolumeM3    = vol_m3;
    r.depositMassKg   = deposit_kg;
    r.electrodeMassKg = electrode_kg;
    r.electrodeCost   = cost;
    return r;
}

}  // namespace forge::weldelec
