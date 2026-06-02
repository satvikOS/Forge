#include "forge/ThermalNetwork.hpp"

#include <stdexcept>
#include <vector>

#include <Eigen/Dense>

namespace forge { namespace thermalnetwork {

Outputs solve(const Inputs& in) {
    const std::uint32_t n = static_cast<std::uint32_t>(in.nodes.size());
    if (n == 0)              throw std::invalid_argument("thermal.solve: no nodes");
    if (in.edges.empty())    throw std::invalid_argument("thermal.solve: no edges");

    Eigen::MatrixXd K = Eigen::MatrixXd::Zero(n, n);
    Eigen::VectorXd Q = Eigen::VectorXd::Zero(n);
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
        Q(s.node) += s.heatFlux;
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
        Eigen::MatrixXd Kff(nFree, nFree);
        Eigen::VectorXd rhs(nFree);
        for (std::uint32_t i = 0; i < nFree; ++i) {
            rhs(i) = Q(freeIdx[i]);
            for (std::uint32_t j = 0; j < nFree; ++j)
                Kff(i, j) = K(freeIdx[i], freeIdx[j]);
            // Move K_fc · T_fixed to the RHS.
            for (std::uint32_t j = 0; j < nFixed; ++j) {
                rhs(i) -= K(freeIdx[i], fixedIdx[j]) * out.temperatures[fixedIdx[j]];
            }
        }
        Eigen::LDLT<Eigen::MatrixXd> ldlt(Kff);
        if (ldlt.info() != Eigen::Success) {
            out.singular = true;
        } else {
            Eigen::VectorXd Tf = ldlt.solve(rhs);
            if ((Kff * Tf - rhs).norm() > 1e-6 * std::max(1.0, rhs.norm())) {
                out.singular = true;
            }
            for (std::uint32_t i = 0; i < nFree; ++i) {
                out.temperatures[freeIdx[i]] = Tf(i);
            }
        }
    }

    Eigen::VectorXd Tvec(n);
    for (std::uint32_t i = 0; i < n; ++i) Tvec(i) = out.temperatures[i];
    Eigen::VectorXd R = K * Tvec - Q;
    for (std::uint32_t d : fixedIdx) out.reactions[d] = R(d);

    for (std::size_t i = 0; i < in.edges.size(); ++i) {
        const auto& e = in.edges[i];
        out.edgeFluxes[i] = e.conductance * (out.temperatures[e.a] - out.temperatures[e.b]);
    }
    return out;
}

}} // namespace forge::thermalnetwork
