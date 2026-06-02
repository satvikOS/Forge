#include "forge/FrameTruss.hpp"

#include <array>
#include <cmath>
#include <stdexcept>
#include <vector>

#include <Eigen/Dense>

namespace forge { namespace frame {

Outputs solve(const Inputs& in) {
    const std::uint32_t nNodes = static_cast<std::uint32_t>(in.nodes.size());
    if (nNodes == 0)         throw std::invalid_argument("frame.solve: no nodes");
    if (in.elements.empty()) throw std::invalid_argument("frame.solve: no elements");

    const std::uint32_t dofs = nNodes * 3;
    Eigen::MatrixXd K = Eigen::MatrixXd::Zero(dofs, dofs);
    Eigen::VectorXd F = Eigen::VectorXd::Zero(dofs);

    Outputs out{};
    out.axialForce.resize(in.elements.size(), 0.0);
    out.elementLength.resize(in.elements.size(), 0.0);

    // Cache direction-cosine rows so we can compute member forces later.
    std::vector<std::array<double, 6>> cRow(in.elements.size());
    std::vector<double> ek_overL(in.elements.size());

    for (std::size_t e = 0; e < in.elements.size(); ++e) {
        const auto& el = in.elements[e];
        if (el.a >= nNodes || el.b >= nNodes || el.a == el.b)
            throw std::invalid_argument("frame.solve: bad element node ids");
        if (el.E <= 0 || el.A <= 0)
            throw std::invalid_argument("frame.solve: E, A must be > 0");
        const auto& na = in.nodes[el.a];
        const auto& nb = in.nodes[el.b];
        const double dx = nb.position[0] - na.position[0];
        const double dy = nb.position[1] - na.position[1];
        const double dz = nb.position[2] - na.position[2];
        const double L = std::sqrt(dx*dx + dy*dy + dz*dz);
        if (L < 1e-12) throw std::invalid_argument("frame.solve: zero-length element");
        const double l = dx / L, m = dy / L, n = dz / L;
        const double kOverL = el.E * el.A / L;
        out.elementLength[e] = L;
        ek_overL[e] = kOverL;
        cRow[e] = { -l, -m, -n, l, m, n };

        // Global element stiffness = kOverL · cᵀ c.
        const std::uint32_t dofIdx[6] = {
            el.a*3+0, el.a*3+1, el.a*3+2,
            el.b*3+0, el.b*3+1, el.b*3+2,
        };
        for (int i = 0; i < 6; ++i) {
            for (int j = 0; j < 6; ++j) {
                K(dofIdx[i], dofIdx[j]) += kOverL * cRow[e][i] * cRow[e][j];
            }
        }
    }

    for (const auto& ld : in.loads) {
        if (ld.node >= nNodes) throw std::invalid_argument("frame.solve: bad load node");
        F(ld.node * 3 + 0) += ld.force[0];
        F(ld.node * 3 + 1) += ld.force[1];
        F(ld.node * 3 + 2) += ld.force[2];
    }

    // Build free / constrained partitions.
    std::vector<std::uint32_t> freeDofs;
    std::vector<std::uint32_t> fixedDofs;
    freeDofs.reserve(dofs);
    for (std::uint32_t i = 0; i < nNodes; ++i) {
        for (int c = 0; c < 3; ++c) {
            if (in.nodes[i].fixed[c]) fixedDofs.push_back(i * 3 + c);
            else                      freeDofs.push_back(i * 3 + c);
        }
    }

    out.displacements.assign(dofs, 0.0);
    out.reactions.assign(dofs, 0.0);
    out.singular = false;

    if (!freeDofs.empty()) {
        const std::uint32_t nFree = static_cast<std::uint32_t>(freeDofs.size());
        Eigen::MatrixXd Kff(nFree, nFree);
        Eigen::VectorXd Ff(nFree);
        for (std::uint32_t i = 0; i < nFree; ++i) {
            Ff(i) = F(freeDofs[i]);
            for (std::uint32_t j = 0; j < nFree; ++j) {
                Kff(i, j) = K(freeDofs[i], freeDofs[j]);
            }
        }
        Eigen::LDLT<Eigen::MatrixXd> ldlt(Kff);
        if (ldlt.info() != Eigen::Success) {
            out.singular = true;
        } else {
            Eigen::VectorXd uf = ldlt.solve(Ff);
            if ((Kff * uf - Ff).norm() > 1e-6 * std::max(1.0, Ff.norm())) {
                out.singular = true;
            }
            for (std::uint32_t i = 0; i < nFree; ++i) {
                out.displacements[freeDofs[i]] = uf(i);
            }
        }
    }

    Eigen::VectorXd uVec(dofs);
    for (std::uint32_t i = 0; i < dofs; ++i) uVec(i) = out.displacements[i];
    Eigen::VectorXd R = K * uVec - F;
    for (std::uint32_t d : fixedDofs) out.reactions[d] = R(d);

    // Member axial forces.
    for (std::size_t e = 0; e < in.elements.size(); ++e) {
        const auto& el = in.elements[e];
        const double u_local =
            cRow[e][0] * out.displacements[el.a*3+0] +
            cRow[e][1] * out.displacements[el.a*3+1] +
            cRow[e][2] * out.displacements[el.a*3+2] +
            cRow[e][3] * out.displacements[el.b*3+0] +
            cRow[e][4] * out.displacements[el.b*3+1] +
            cRow[e][5] * out.displacements[el.b*3+2];
        out.axialForce[e] = ek_overL[e] * u_local;
    }

    return out;
}

}} // namespace forge::frame
