#pragma once

// Forge-190 — Linear circuit analysis (DC + AC small-signal).
//
// Modified Nodal Analysis (MNA) on a linear network of resistors,
// capacitors, inductors, ideal voltage sources, and ideal current
// sources. Nodes are uint32_t with 0 reserved for ground.
//
// DC: complex math collapses to real; capacitors are open circuits,
// inductors are shorts.
// AC: builds a complex MNA system at each frequency; capacitors have
// admittance jωC, inductors have impedance jωL.

#include <complex>
#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace circuit {

enum class Kind : std::uint8_t {
    Resistor      = 0,    // R [Ω]
    Capacitor     = 1,    // C [F]
    Inductor      = 2,    // L [H]
    VoltageSource = 3,    // V [V]
    CurrentSource = 4,    // I [A]  (out of + into nPos, into − out of nNeg)
};

struct Component {
    Kind         kind;
    std::string  name;
    std::uint32_t nA;    // first node (positive terminal for V/I sources)
    std::uint32_t nB;    // second node (negative terminal)
    double       value;
};

struct DCInputs {
    std::uint32_t nodeCount;       // includes ground (node 0)
    std::vector<Component> comps;
};

struct DCResult {
    std::vector<double> nodeVoltages;       // length = nodeCount; nodeVoltages[0] = 0
    std::vector<double> vSourceCurrents;    // in component order of V-sources
};

DCResult dcAnalysis(const DCInputs& in);

struct ACResult {
    std::vector<double> frequencies;            // Hz
    // nodeVoltages[i] is length = nodeCount, indexed by freq.
    std::vector<std::vector<std::complex<double>>> nodeVoltages;
};

ACResult acAnalysis(const DCInputs& in,
                    const std::vector<double>& freqs);

}} // namespace forge::circuit
