#include "forge/FrameTruss.hpp"

#include <array>
#include <cmath>
#include <stdexcept>
#include <vector>

#include "forge/native/linalg/LinAlg.hpp"

namespace la = forge::native::linalg;

namespace forge { namespace frame {

Outputs solve(const Inputs& in) {
    const std::uint32_t nNodes = static_cast<std::uint32_t>(in.nodes.size());
    if (nNodes == 0)         throw std::invalid_argument("frame.solve: no nodes");
    if (in.elements.empty()) throw std::invalid_argument("frame.solve: no elements");

    const std::uint32_t dofs = nNodes * 3;
    la::MatrixD K(dofs, dofs);
    std::vector<double> F(dofs, 0.0);

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
        F[ld.node * 3 + 0] += ld.force[0];
        F[ld.node * 3 + 1] += ld.force[1];
        F[ld.node * 3 + 2] += ld.force[2];
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
        la::MatrixD Kff(nFree, nFree);
        std::vector<double> Ff(nFree, 0.0);
        for (std::uint32_t i = 0; i < nFree; ++i) {
            Ff[i] = F[freeDofs[i]];
            for (std::uint32_t j = 0; j < nFree; ++j) {
                Kff(i, j) = K(freeDofs[i], freeDofs[j]);
            }
        }
        la::LDLT<double> ldlt(Kff);
        if (!ldlt.ok()) {
            out.singular = true;
        } else {
            std::vector<double> uf = ldlt.solve(Ff);
            // residual = Kff * uf - Ff
            std::vector<double> resid = Kff * uf;
            for (std::uint32_t i = 0; i < nFree; ++i) resid[i] -= Ff[i];
            if (la::norm2(resid) > 1e-6 * std::max(1.0, la::norm2(Ff))) {
                out.singular = true;
            }
            for (std::uint32_t i = 0; i < nFree; ++i) {
                out.displacements[freeDofs[i]] = uf[i];
            }
        }
    }

    std::vector<double> uVec(dofs, 0.0);
    for (std::uint32_t i = 0; i < dofs; ++i) uVec[i] = out.displacements[i];
    std::vector<double> R = K * uVec;       // R = K * uVec - F
    for (std::uint32_t i = 0; i < dofs; ++i) R[i] -= F[i];
    for (std::uint32_t d : fixedDofs) out.reactions[d] = R[d];

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

// ---------- Forge-210 modal analysis ----------------------------------

ModalOutputs modal(const ModalInputs& in) {
    const std::uint32_t nNodes = static_cast<std::uint32_t>(in.nodes.size());
    if (nNodes == 0)            throw std::invalid_argument("frame.modal: no nodes");
    if (in.elements.empty())    throw std::invalid_argument("frame.modal: no elements");
    if (in.kModes == 0)         throw std::invalid_argument("frame.modal: kModes > 0");

    const std::uint32_t dofs = nNodes * 3;
    la::MatrixD K(dofs, dofs);
    la::MatrixD M(dofs, dofs);

    for (const auto& el : in.elements) {
        if (el.a >= nNodes || el.b >= nNodes || el.a == el.b)
            throw std::invalid_argument("frame.modal: bad element node ids");
        if (el.E <= 0 || el.A <= 0 || el.density <= 0)
            throw std::invalid_argument("frame.modal: E, A, ρ must be > 0");
        const auto& na = in.nodes[el.a];
        const auto& nb = in.nodes[el.b];
        const double dx = nb.position[0] - na.position[0];
        const double dy = nb.position[1] - na.position[1];
        const double dz = nb.position[2] - na.position[2];
        const double L = std::sqrt(dx*dx + dy*dy + dz*dz);
        if (L < 1e-12) throw std::invalid_argument("frame.modal: zero-length element");
        const double l = dx / L, m = dy / L, n = dz / L;
        const double kOverL = el.E * el.A / L;
        const double c[6] = { -l, -m, -n, l, m, n };
        const std::uint32_t dofIdx[6] = {
            el.a*3+0, el.a*3+1, el.a*3+2,
            el.b*3+0, el.b*3+1, el.b*3+2,
        };
        for (int i = 0; i < 6; ++i)
            for (int j = 0; j < 6; ++j)
                K(dofIdx[i], dofIdx[j]) += kOverL * c[i] * c[j];

        // Lumped mass: half per end-node, applied to each of tx/ty/tz.
        const double halfM = 0.5 * el.density * el.A * L;
        for (int dim = 0; dim < 3; ++dim) {
            M(el.a*3+dim, el.a*3+dim) += halfM;
            M(el.b*3+dim, el.b*3+dim) += halfM;
        }
    }

    std::vector<std::uint32_t> freeDofs;
    freeDofs.reserve(dofs);
    for (std::uint32_t i = 0; i < nNodes; ++i)
        for (int c = 0; c < 3; ++c)
            if (!in.nodes[i].fixed[c]) freeDofs.push_back(i*3 + c);

    const std::uint32_t nFree = static_cast<std::uint32_t>(freeDofs.size());
    if (nFree == 0) throw std::invalid_argument("frame.modal: all DOFs are fixed");
    la::MatrixD Kff(nFree, nFree), Mff(nFree, nFree);
    for (std::uint32_t i = 0; i < nFree; ++i)
        for (std::uint32_t j = 0; j < nFree; ++j) {
            Kff(i, j) = K(freeDofs[i], freeDofs[j]);
            Mff(i, j) = M(freeDofs[i], freeDofs[j]);
        }

    la::GeneralizedSymmetricEigen es(Kff, Mff);
    if (!es.ok())
        throw std::runtime_error("frame.modal: eigenvalue solve failed");

    ModalOutputs out{};
    const std::uint32_t take = std::min<std::uint32_t>(in.kModes, nFree);
    out.frequenciesHz.resize(take, 0.0);
    out.modeShapes.resize(take, std::vector<double>(dofs, 0.0));
    for (std::uint32_t k = 0; k < take; ++k) {
        const double lambda = es.eigenvalues()[k];
        const double omega  = (lambda > 0) ? std::sqrt(lambda) : 0.0;
        out.frequenciesHz[k] = omega / (2.0 * 3.14159265358979323846);
        // phi = column k of the eigenvector matrix.
        std::vector<double> phi(nFree, 0.0);
        for (std::uint32_t i = 0; i < nFree; ++i) phi[i] = es.eigenvectors()(i, k);
        // Normalise so the largest |component| is 1.
        double maxAbs = 0.0;
        for (std::uint32_t i = 0; i < nFree; ++i) {
            const double a = std::abs(phi[i]);
            if (a > maxAbs) maxAbs = a;
        }
        if (maxAbs > 1e-30)
            for (std::uint32_t i = 0; i < nFree; ++i) phi[i] /= maxAbs;
        for (std::uint32_t i = 0; i < nFree; ++i)
            out.modeShapes[k][freeDofs[i]] = phi[i];
    }
    return out;
}

}} // namespace forge::frame
