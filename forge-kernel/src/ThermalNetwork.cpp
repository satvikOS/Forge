#include "forge/ThermalNetwork.hpp"

#include <stdexcept>
#include <vector>

#include "forge/native/linalg/LinAlg.hpp"

namespace la = forge::native::linalg;

namespace forge { namespace thermalnetwork {

Outputs solve(const Inputs& in) {
    const std::uint32_t n = static_cast<std::uint32_t>(in.nodes.size());
    if (n == 0)              throw std::invalid_argument("thermal.solve: no nodes");
    if (in.edges.empty())    throw std::invalid_argument("thermal.solve: no edges");

    la::MatrixD K(n, n);
    std::vector<double> Q(n, 0.0);
    for (const auto& e : in.edges) {
        if (e.a >= n || e.b >= n || e.a == e.b)
            throw std::invalid_argument("thermal.solve: bad edge node ids");
        if (e.conductance <= 0)
            throw std::invalid_argument("thermal.solve: conductance must be > 0");
        K(e.a, e.a) += e.conductance;
        K(e.b, e.b) += e.conductance;
        K(e.a, e.b) -= e.conductance;
        K(e.b, e.a) -= e.conductance;
    }
    for (const auto& s : in.sources) {
        if (s.node >= n) throw std::invalid_argument("thermal.solve: bad source node");
        Q[s.node] += s.heatFlux;
    }

    Outputs out{};
    out.temperatures.assign(n, 0.0);
    out.reactions.assign(n, 0.0);
    out.edgeFluxes.resize(in.edges.size(), 0.0);
    out.singular = false;

    std::vector<std::uint32_t> freeIdx;
    std::vector<std::uint32_t> fixedIdx;
    for (std::uint32_t i = 0; i < n; ++i) {
        if (in.nodes[i].fixed) {
            out.temperatures[i] = in.nodes[i].prescribedTemperature;
            fixedIdx.push_back(i);
        } else {
            freeIdx.push_back(i);
        }
    }

    if (freeIdx.empty()) {
        // Pure Dirichlet — nothing to solve, but report reactions.
    } else {
        const std::uint32_t nFree  = static_cast<std::uint32_t>(freeIdx.size());
        const std::uint32_t nFixed = static_cast<std::uint32_t>(fixedIdx.size());
        la::MatrixD Kff(nFree, nFree);
        std::vector<double> rhs(nFree, 0.0);
        for (std::uint32_t i = 0; i < nFree; ++i) {
            rhs[i] = Q[freeIdx[i]];
            for (std::uint32_t j = 0; j < nFree; ++j)
                Kff(i, j) = K(freeIdx[i], freeIdx[j]);
            // Move K_fc · T_fixed to the RHS.
            for (std::uint32_t j = 0; j < nFixed; ++j) {
                rhs[i] -= K(freeIdx[i], fixedIdx[j]) * out.temperatures[fixedIdx[j]];
            }
        }
        la::LDLT<double> ldlt(Kff);
        if (!ldlt.ok()) {
            out.singular = true;
        } else {
            std::vector<double> Tf = ldlt.solve(rhs);
            // residual = Kff * Tf - rhs
            std::vector<double> resid = Kff * Tf;
            for (std::uint32_t i = 0; i < nFree; ++i) resid[i] -= rhs[i];
            if (la::norm2(resid) > 1e-6 * std::max(1.0, la::norm2(rhs))) {
                out.singular = true;
            }
            for (std::uint32_t i = 0; i < nFree; ++i) {
                out.temperatures[freeIdx[i]] = Tf[i];
            }
        }
    }

    std::vector<double> Tvec(n, 0.0);
    for (std::uint32_t i = 0; i < n; ++i) Tvec[i] = out.temperatures[i];
    // R = K * Tvec - Q
    std::vector<double> R = K * Tvec;
    for (std::uint32_t i = 0; i < n; ++i) R[i] -= Q[i];
    for (std::uint32_t d : fixedIdx) out.reactions[d] = R[d];

    for (std::size_t i = 0; i < in.edges.size(); ++i) {
        const auto& e = in.edges[i];
        out.edgeFluxes[i] = e.conductance * (out.temperatures[e.a] - out.temperatures[e.b]);
    }
    return out;
}

}} // namespace forge::thermalnetwork
