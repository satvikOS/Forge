#include "forge/Refrigeration.hpp"

#include <stdexcept>

namespace forge { namespace refrig {

Mode modeFromString(const std::string& s) {
    if (s == "refrig" || s == "refrigeration") return Mode::Refrigeration;
    if (s == "heatpump" || s == "hp")          return Mode::HeatPump;
    throw std::invalid_argument("refrig: mode must be refrig|heatpump");
}

double carnotCOP(double Th, double Tc, Mode mode) {
    if (Th <= 0) throw std::invalid_argument("carnotCOP: T_hot > 0 K");
    if (Tc <= 0) throw std::invalid_argument("carnotCOP: T_cold > 0 K");
    if (Th <= Tc) throw std::invalid_argument("carnotCOP: T_hot > T_cold");
    switch (mode) {
        case Mode::Refrigeration: return Tc / (Th - Tc);
        case Mode::HeatPump:      return Th / (Th - Tc);
    }
    return 0.0;
}

CycleOutputs vaporCycle(const CycleInputs& in) {
    if (in.h2 <= in.h1) throw std::invalid_argument("vaporCycle: h_2 > h_1 (need compression work)");
    if (in.h2 <= in.h3) throw std::invalid_argument("vaporCycle: h_2 > h_3 (need condenser rejection)");
    if (in.h1 <= in.h3) throw std::invalid_argument("vaporCycle: h_1 > h_3 (cooling effect needed)");
    CycleOutputs out{};
    out.refrigerationEffect = in.h1 - in.h3;   // h_4 == h_3 (throttle)
    out.condenserRejection  = in.h2 - in.h3;
    out.compressorWork      = in.h2 - in.h1;
    switch (in.mode) {
        case Mode::Refrigeration: out.cop = out.refrigerationEffect / out.compressorWork; break;
        case Mode::HeatPump:      out.cop = out.condenserRejection  / out.compressorWork; break;
    }
    return out;
}

double compressorPower(double thermalCapacity, double cop) {
    if (thermalCapacity <= 0) throw std::invalid_argument("compressorPower: Q > 0");
    if (cop <= 0)             throw std::invalid_argument("compressorPower: COP > 0");
    return thermalCapacity / cop;
}

}} // namespace forge::refrig
