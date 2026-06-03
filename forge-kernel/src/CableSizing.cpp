// Forge-252 — Cable sizing implementation.

#include "forge/CableSizing.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::cable {

namespace {

const std::vector<AmpacityEntry>& cachedTable() {
    static const std::vector<AmpacityEntry> t = {
        {"14",          2.08,   20},
        {"12",          3.31,   25},
        {"10",          5.26,   35},
        {"8",           8.37,   50},
        {"6",          13.30,   65},
        {"4",          21.20,   85},
        {"3",          26.70,  100},
        {"2",          33.60,  115},
        {"1",          42.40,  130},
        {"1/0",        53.50,  150},
        {"2/0",        67.40,  175},
        {"3/0",        85.00,  200},
        {"4/0",       107.20,  230},
        {"250 kcmil", 127.00,  255},
        {"350 kcmil", 177.00,  310},
        {"500 kcmil", 253.00,  380},
    };
    return t;
}
}  // namespace

std::vector<AmpacityEntry> nec31016Table() {
    return cachedTable();
}

double ambientDeratingFactor(double tempC) {
    if (tempC < 0.0 || tempC > 100.0)
        throw std::invalid_argument("ambient must be 0-100°C");
    if (tempC <= 25.0) return 1.05;
    if (tempC <= 30.0) return 1.00;
    if (tempC <= 35.0) return 0.94;
    if (tempC <= 40.0) return 0.88;
    if (tempC <= 45.0) return 0.82;
    if (tempC <= 50.0) return 0.75;
    if (tempC <= 55.0) return 0.67;
    return 0.58;  // 56-60
}

double groupingDeratingFactor(int n) {
    if (n <= 0) throw std::invalid_argument("conductor count must be ≥ 1");
    if (n <= 3)  return 1.00;
    if (n <= 6)  return 0.80;
    if (n <= 9)  return 0.70;
    if (n <= 20) return 0.50;
    return 0.40;
}

AmpacityResult ampacity(const AmpacityInput& in) {
    const auto& table = cachedTable();
    int base = -1;
    for (const auto& e : table) if (e.size == in.conductorSize) base = e.ampacityCu75C;
    if (base < 0) throw std::invalid_argument(
        "unknown conductor size '" + in.conductorSize + "'");
    if (in.numCurrentCarryingConductors < 1)
        throw std::invalid_argument("numCurrentCarryingConductors must be ≥ 1");

    AmpacityResult r{};
    r.baseAmpacityA   = static_cast<double>(base);
    r.ambientFactor   = ambientDeratingFactor(in.ambientTempC);
    r.groupingFactor  = groupingDeratingFactor(in.numCurrentCarryingConductors);
    r.materialFactor  = (in.material == Material::Aluminum) ? 0.80 : 1.00;
    r.effectiveAmpacityA = r.baseAmpacityA * r.ambientFactor
                          * r.groupingFactor * r.materialFactor;
    return r;
}

VoltageDropResult voltageDrop(const VoltageDropInput& in) {
    if (in.xsecMm2 <= 0.0) throw std::invalid_argument("xsec must be positive");
    if (in.lengthMeters <= 0.0) throw std::invalid_argument("length must be positive");
    if (in.systemVoltage <= 0.0) throw std::invalid_argument("V must be positive");
    if (in.powerFactor < 0.0 || in.powerFactor > 1.0)
        throw std::invalid_argument("pf in [0, 1]");
    if (in.materialResistivityOhmMmSqPerM <= 0.0)
        throw std::invalid_argument("ρ must be positive");

    VoltageDropResult r{};
    const double R_per_km = in.materialResistivityOhmMmSqPerM
                          * 1000.0 / in.xsecMm2;
    r.cableResistanceOhmPerKm = R_per_km;

    const double sinphi = std::sqrt(std::max(0.0,
                                  1.0 - in.powerFactor * in.powerFactor));
    const double L_km = in.lengthMeters / 1000.0;
    const double Z = R_per_km * in.powerFactor + in.conductorReactanceOhmPerKm * sinphi;
    const double multiplier = (in.system == System::ThreePhase) ? std::sqrt(3.0)
                                                                : 2.0;
    r.voltageDropV = multiplier * in.loadAmperes * L_km * Z;
    r.voltageDropPct = r.voltageDropV / in.systemVoltage * 100.0;
    return r;
}

}  // namespace forge::cable
