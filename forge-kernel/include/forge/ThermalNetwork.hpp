#pragma once

// Forge-211 — steady-state thermal network FEA.
//
// Each node carries a temperature (the single DOF). Each edge carries
// a thermal conductance G = k·A/L (or 1/R for a thermal resistor)
// between two nodes. Stamping the global conductance matrix follows
// the same pattern as the linear truss: K += G · [[+1,−1],[−1,+1]].
//
// Nodes can be fixed (Dirichlet boundary condition) or carry a node
// heat-flux source (Neumann). The linear system K·T = Q is solved on
// the free partition by Eigen LDLT; reactions at fixed nodes report
// the heat flow needed to hold the temperature.

#include <cstdint>
#include <vector>

namespace forge { namespace thermalnetwork {

struct Node {
    bool   fixed;
    double prescribedTemperature;   // used when fixed
};

struct Edge {
    std::uint32_t a, b;
    double conductance;             // W/K
};

struct Source {
    std::uint32_t node;
    double heatFlux;                // W (positive ⇒ into the node)
};

struct Inputs {
    std::vector<Node>   nodes;
    std::vector<Edge>   edges;
    std::vector<Source> sources;
};

struct Outputs {
    std::vector<double> temperatures;   // size = nodes
    std::vector<double> reactions;      // size = nodes; non-zero only at fixed
    std::vector<double> edgeFluxes;     // size = edges; sign convention =
                                        // positive when heat flows a → b
    bool                singular;
};

Outputs solve(const Inputs& in);

}} // namespace forge::thermalnetwork
