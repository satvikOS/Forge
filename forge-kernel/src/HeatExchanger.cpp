#include "forge/HeatExchanger.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace hxc {

Flow flowFromString(const std::string& name) {
    if (name == "counter" || name == "counter-flow")   return Flow::CounterFlow;
    if (name == "parallel" || name == "parallel-flow") return Flow::ParallelFlow;
    throw std::invalid_argument("hxc.flowFromString: unknown " + name);
}

LmtdOutputs lmtd(const LmtdInputs& in) {
    LmtdOutputs out{};
    switch (in.flow) {
        case Flow::CounterFlow:
            out.dT1 = in.thIn  - in.tcOut;
            out.dT2 = in.thOut - in.tcIn;
            break;
        case Flow::ParallelFlow:
            out.dT1 = in.thIn  - in.tcIn;
            out.dT2 = in.thOut - in.tcOut;
            break;
    }
    if (out.dT1 <= 0 || out.dT2 <= 0)
        throw std::invalid_argument("hxc.lmtd: temperature crossover or hot < cold");
    if (std::fabs(out.dT1 - out.dT2) < 1e-9) {
        out.lmtd = out.dT1;
    } else {
        out.lmtd = (out.dT1 - out.dT2) / std::log(out.dT1 / out.dT2);
    }
    return out;
}

double requiredArea(const AreaInputs& in) {
    if (in.U <= 0)    throw std::invalid_argument("hxc.requiredArea: U > 0");
    if (in.lmtd <= 0) throw std::invalid_argument("hxc.requiredArea: lmtd > 0");
    if (in.F <= 0)    throw std::invalid_argument("hxc.requiredArea: F > 0");
    return in.Q / (in.U * in.lmtd * in.F);
}

double effectiveness(const NtuInputs& in) {
    if (in.UA <= 0)   throw std::invalid_argument("hxc.effectiveness: UA > 0");
    if (in.cMin <= 0) throw std::invalid_argument("hxc.effectiveness: cMin > 0");
    if (in.cMax <  in.cMin)
        throw std::invalid_argument("hxc.effectiveness: cMax must be ≥ cMin");
    const double NTU = in.UA / in.cMin;
    const double Cr  = in.cMin / in.cMax;
    if (Cr < 1e-9) return 1.0 - std::exp(-NTU);
    switch (in.flow) {
        case Flow::CounterFlow: {
            if (std::fabs(Cr - 1.0) < 1e-9) return NTU / (1.0 + NTU);
            const double e = std::exp(-NTU * (1.0 - Cr));
            return (1.0 - e) / (1.0 - Cr * e);
        }
        case Flow::ParallelFlow: {
            return (1.0 - std::exp(-NTU * (1.0 + Cr))) / (1.0 + Cr);
        }
    }
    return 0.0;
}

}} // namespace forge::hxc
