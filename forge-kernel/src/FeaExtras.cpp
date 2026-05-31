// forge-kernel — Forge-12b extensions to forge::fea
//
// Adds three solvers on top of the brick-grid mesh shared with Forge-12:
//   * solveThermal           — steady ∇·(k ∇T) = q with Dirichlet + convection
//   * solveNonlinearStatic   — Newton-Raphson over geometric nonlinearity
//   * fatigueLife            — rainflow + Basquin/Goodman per element
//
// All three share the existing hex-element helpers in Fea.cpp via small
// duplicated kernels here (we deliberately keep the helpers anonymous-
// namespace local to avoid a fragile dependency on `Fea.cpp`'s private TUs).

#include "forge/Fea.hpp"

#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <Eigen/SparseCholesky>

#include <algorithm>
#include <array>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace forge::fea {

namespace {

// ---------------------------- hex element kernels (duplicated)
// We re-declare a minimal local copy of the 8-node hex shape derivatives so
// this TU stays independent of Fea.cpp's private namespace. The constants and
// algebra match exactly.

constexpr double kGaussPt = 0.5773502691896258; // 1/√3
constexpr int    kGaussCount = 8;

struct GaussPoint { double xi, eta, zeta, w; };
constexpr std::array<GaussPoint, kGaussCount> kGauss{{
    {-kGaussPt,-kGaussPt,-kGaussPt,1.0},
    { kGaussPt,-kGaussPt,-kGaussPt,1.0},
    { kGaussPt, kGaussPt,-kGaussPt,1.0},
    {-kGaussPt, kGaussPt,-kGaussPt,1.0},
    {-kGaussPt,-kGaussPt, kGaussPt,1.0},
    { kGaussPt,-kGaussPt, kGaussPt,1.0},
    { kGaussPt, kGaussPt, kGaussPt,1.0},
    {-kGaussPt, kGaussPt, kGaussPt,1.0},
}};

constexpr int kSignXi  [8] = {-1, 1, 1,-1,-1, 1, 1,-1};
constexpr int kSignEta [8] = {-1,-1, 1, 1,-1,-1, 1, 1};
constexpr int kSignZeta[8] = {-1,-1,-1,-1, 1, 1, 1, 1};

inline void shapeFns(double xi, double eta, double zeta, double N[8]) {
    for (int i = 0; i < 8; ++i) {
        N[i] = 0.125 * (1 + kSignXi[i]*xi)
                     * (1 + kSignEta[i]*eta)
                     * (1 + kSignZeta[i]*zeta);
    }
}

inline void shapeDerivs(double xi, double eta, double zeta, double dN[8][3]) {
    for (int i = 0; i < 8; ++i) {
        const double a = kSignXi[i],   xa = 1 + a*xi;
        const double b = kSignEta[i],  yb = 1 + b*eta;
        const double c = kSignZeta[i], zc = 1 + c*zeta;
        dN[i][0] = 0.125 * a * yb * zc;
        dN[i][1] = 0.125 * b * xa * zc;
        dN[i][2] = 0.125 * c * xa * yb;
    }
}

inline void jacobian3(const double dN[8][3], const double nodeCoords[8][3],
                      double J[3][3]) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) {
            double s = 0;
            for (int k = 0; k < 8; ++k) s += dN[k][i] * nodeCoords[k][j];
            J[i][j] = s;
        }
}
inline double det3x3(const double J[3][3]) {
    return J[0][0]*(J[1][1]*J[2][2] - J[1][2]*J[2][1])
         - J[0][1]*(J[1][0]*J[2][2] - J[1][2]*J[2][0])
         + J[0][2]*(J[1][0]*J[2][1] - J[1][1]*J[2][0]);
}
inline void inv3x3(const double J[3][3], double Ji[3][3], double det) {
    const double inv = 1.0 / det;
    Ji[0][0] =  (J[1][1]*J[2][2] - J[1][2]*J[2][1]) * inv;
    Ji[0][1] = -(J[0][1]*J[2][2] - J[0][2]*J[2][1]) * inv;
    Ji[0][2] =  (J[0][1]*J[1][2] - J[0][2]*J[1][1]) * inv;
    Ji[1][0] = -(J[1][0]*J[2][2] - J[1][2]*J[2][0]) * inv;
    Ji[1][1] =  (J[0][0]*J[2][2] - J[0][2]*J[2][0]) * inv;
    Ji[1][2] = -(J[0][0]*J[1][2] - J[0][2]*J[1][0]) * inv;
    Ji[2][0] =  (J[1][0]*J[2][1] - J[1][1]*J[2][0]) * inv;
    Ji[2][1] = -(J[0][0]*J[2][1] - J[0][1]*J[2][0]) * inv;
    Ji[2][2] =  (J[0][0]*J[1][1] - J[0][1]*J[1][0]) * inv;
}

} // namespace

// =====================================================================
// solveThermal — steady-state heat conduction on the hex mesh
// =====================================================================
//
// Element K_T (8×8) for ∇·(k ∇T) is the standard Laplacian stiffness:
//   K_e^{ij} = ∫_Ω k (∇N_i)·(∇N_j) dΩ
// summed at Gauss points. Body source per element is lumped to the 8 nodes
// (q·V/8 each). Convective BCs use the 2×2 Gauss quadrature on the AABB face
// patch with the standard Robin contribution K_h += h Σ N_i N_j dA and
// f_h += h T∞ Σ N_i dA. Because the mesh is brick-grid we know each AABB face
// patch's area = element_face_area directly from the cell spacing.
ThermalResult solveThermal(const Mesh& mesh, const ThermalMaterial& mat,
                           const std::vector<ThermalNodalT>&     dirichlet,
                           const std::vector<ThermalElemSource>& sources,
                           const std::vector<ThermalConvection>& convection)
{
    const std::size_t nNodes = mesh.nodes.size() / 3;
    const std::size_t nElems = mesh.tets.size() / mesh.elemNodeCount;
    if (mat.k <= 0) {
        throw std::invalid_argument("forge.fea.solveThermal: k must be > 0");
    }

    Eigen::SparseMatrix<double> K(static_cast<int>(nNodes), static_cast<int>(nNodes));
    Eigen::VectorXd              f = Eigen::VectorXd::Zero(static_cast<int>(nNodes));

    std::vector<Eigen::Triplet<double>> trips;
    trips.reserve(nElems * 8 * 8);

    // Map elemId → bit-mask of node ids on the +X face, etc. — used by the
    // pressure-style convection BC application below.

    // Build per-element source quick lookup.
    std::unordered_map<std::uint32_t, double> elemSource;
    elemSource.reserve(sources.size());
    for (const auto& s : sources) elemSource.emplace(s.elemId, s.q);

    for (std::size_t e = 0; e < nElems; ++e) {
        double nodeCoords[8][3];
        std::uint32_t nodeIds[8];
        for (int i = 0; i < 8; ++i) {
            const std::uint32_t nid = mesh.tets[e * 8 + i];
            nodeIds[i] = nid;
            nodeCoords[i][0] = mesh.nodes[3 * nid + 0];
            nodeCoords[i][1] = mesh.nodes[3 * nid + 1];
            nodeCoords[i][2] = mesh.nodes[3 * nid + 2];
        }

        Eigen::Matrix<double, 8, 8> Ke = Eigen::Matrix<double, 8, 8>::Zero();
        double elemVolume = 0;
        for (int g = 0; g < kGaussCount; ++g) {
            const auto& gp = kGauss[g];
            double dN[8][3]; shapeDerivs(gp.xi, gp.eta, gp.zeta, dN);
            double J[3][3];  jacobian3(dN, nodeCoords, J);
            const double det = det3x3(J);
            if (det <= 0) {
                throw std::runtime_error(
                    "forge.fea.solveThermal: element Jacobian non-positive");
            }
            double Ji[3][3]; inv3x3(J, Ji, det);
            // Build dN/dx (8×3).
            double dNx[8][3];
            for (int i = 0; i < 8; ++i)
                for (int j = 0; j < 3; ++j) {
                    double s = 0;
                    for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                    dNx[i][j] = s;
                }
            // K_e^{ij} += k Σ (∇N_i)·(∇N_j) det w.
            const double w = gp.w * det;
            for (int i = 0; i < 8; ++i)
                for (int j = 0; j < 8; ++j) {
                    const double s = dNx[i][0] * dNx[j][0]
                                   + dNx[i][1] * dNx[j][1]
                                   + dNx[i][2] * dNx[j][2];
                    Ke(i, j) += mat.k * s * w;
                }
            elemVolume += w;
        }
        // Scatter into global K.
        for (int i = 0; i < 8; ++i) {
            for (int j = 0; j < 8; ++j) {
                const double v = Ke(i, j);
                if (std::abs(v) > 0) trips.emplace_back(nodeIds[i], nodeIds[j], v);
            }
        }
        // Body source — lumped equally.
        auto srcIt = elemSource.find(static_cast<std::uint32_t>(e));
        if (srcIt != elemSource.end()) {
            const double per = srcIt->second * elemVolume / 8.0;
            for (int i = 0; i < 8; ++i) f(nodeIds[i]) += per;
        }
    }
    K.setFromTriplets(trips.begin(), trips.end());
    K.makeCompressed();

    // ---- convective BCs on AABB faces -------------------------------------
    //
    // For each face id we walk every node on that face (from `nodeToFace`) and
    // add h·A_node·(T_node) to the diagonal of K and h·A_node·T∞ to f. A_node
    // is approximated as the area of the AABB face divided by the number of
    // face-nodes (consistent with the brick-grid mesher's lumped distribution
    // strategy used for pressure loads in Fea.cpp).
    if (mesh.nodeToFace.size() == nNodes && !convection.empty()) {
        double minP[3] = { 1e300, 1e300, 1e300};
        double maxP[3] = {-1e300,-1e300,-1e300};
        for (std::size_t i = 0; i < nNodes; ++i) {
            for (int j = 0; j < 3; ++j) {
                minP[j] = std::min(minP[j], mesh.nodes[3*i + j]);
                maxP[j] = std::max(maxP[j], mesh.nodes[3*i + j]);
            }
        }
        const double Lx = maxP[0] - minP[0];
        const double Ly = maxP[1] - minP[1];
        const double Lz = maxP[2] - minP[2];
        const double faceArea[6] = { Ly*Lz, Ly*Lz, Lx*Lz, Lx*Lz, Lx*Ly, Lx*Ly };

        for (const auto& c : convection) {
            if (c.faceId >= 6) continue;
            std::vector<std::size_t> faceNodes;
            for (std::size_t i = 0; i < nNodes; ++i) {
                if (mesh.nodeToFace[i] & (1u << c.faceId)) faceNodes.push_back(i);
            }
            if (faceNodes.empty()) continue;
            const double per = faceArea[c.faceId] / static_cast<double>(faceNodes.size());
            for (std::size_t i : faceNodes) {
                K.coeffRef(static_cast<int>(i), static_cast<int>(i)) += c.h * per;
                f(static_cast<int>(i)) += c.h * c.Tinf * per;
            }
        }
        K.makeCompressed();
    }

    // ---- Dirichlet elimination --------------------------------------------
    std::vector<bool> isFixed(nNodes, false);
    std::vector<double> fixedVal(nNodes, 0.0);
    for (const auto& d : dirichlet) {
        if (d.nodeId < nNodes) {
            isFixed[d.nodeId] = true;
            fixedVal[d.nodeId] = d.T;
        }
    }
    // Substitute fixed values into f, then zero rows/cols and place 1 on
    // diagonal with rhs = fixedVal.
    for (int k = 0; k < K.outerSize(); ++k) {
        for (Eigen::SparseMatrix<double>::InnerIterator it(K, k); it; ++it) {
            const int r = static_cast<int>(it.row());
            const int c = static_cast<int>(it.col());
            if (isFixed[c] && !isFixed[r]) {
                f(r) -= it.value() * fixedVal[c];
            }
        }
    }
    for (int k = 0; k < K.outerSize(); ++k) {
        for (Eigen::SparseMatrix<double>::InnerIterator it(K, k); it; ++it) {
            const int r = static_cast<int>(it.row());
            const int c = static_cast<int>(it.col());
            if (isFixed[r] || isFixed[c]) it.valueRef() = 0;
        }
    }
    for (std::size_t i = 0; i < nNodes; ++i) {
        if (isFixed[i]) {
            K.coeffRef(static_cast<int>(i), static_cast<int>(i)) = 1.0;
            f(static_cast<int>(i)) = fixedVal[i];
        }
    }
    K.prune(0.0);
    K.makeCompressed();

    Eigen::SimplicialLDLT<Eigen::SparseMatrix<double>> ldlt(K);
    if (ldlt.info() != Eigen::Success) {
        throw std::runtime_error("forge.fea.solveThermal: LDLT factorisation failed");
    }
    Eigen::VectorXd T = ldlt.solve(f);

    // ---- output -----------------------------------------------------------
    ThermalResult out;
    out.T.assign(T.data(), T.data() + nNodes);
    out.elemFluxMag.assign(nElems, 0.0);
    double maxT = -1e300, minT = 1e300;
    for (double t : out.T) { if (t > maxT) maxT = t; if (t < minT) minT = t; }
    out.maxT = maxT;
    out.minT = minT;
    // Per-element flux at the centroid (single Gauss-point at (0,0,0)).
    for (std::size_t e = 0; e < nElems; ++e) {
        double nodeCoords[8][3]; double Te[8];
        for (int i = 0; i < 8; ++i) {
            const std::uint32_t nid = mesh.tets[e * 8 + i];
            nodeCoords[i][0] = mesh.nodes[3*nid + 0];
            nodeCoords[i][1] = mesh.nodes[3*nid + 1];
            nodeCoords[i][2] = mesh.nodes[3*nid + 2];
            Te[i] = out.T[nid];
        }
        double dN[8][3]; shapeDerivs(0,0,0, dN);
        double J[3][3];  jacobian3(dN, nodeCoords, J);
        double Ji[3][3]; inv3x3(J, Ji, det3x3(J));
        double dNx[8][3];
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                dNx[i][j] = s;
            }
        double gT[3] = {0, 0, 0};
        for (int i = 0; i < 8; ++i) {
            for (int j = 0; j < 3; ++j) gT[j] += dNx[i][j] * Te[i];
        }
        // q = −k ∇T.
        const double qx = -mat.k * gT[0];
        const double qy = -mat.k * gT[1];
        const double qz = -mat.k * gT[2];
        out.elemFluxMag[e] = std::sqrt(qx*qx + qy*qy + qz*qz);
    }
    // Residual (post-elimination).
    Eigen::VectorXd r = K * T - f;
    out.residual = r.lpNorm<Eigen::Infinity>();
    return out;
}

// =====================================================================
// solveNonlinearStatic — geometric Newton-Raphson
// =====================================================================
//
// We use the classical updated-Lagrangian first-order geometric tangent.
// Elements are 8-node hex; the geometric stiffness contribution K_σ uses the
// shape derivatives in the *current* (deformed) configuration. For our
// brick-grid mesh that means re-evaluating Jacobians against (X + u) each
// Newton iteration. We retain the linear stress-strain law (no plasticity).
//
// Residual: r = K(u) u − f_ext where K(u) = K_L + K_σ(σ(u)). The Newton step
// solves K_T(u^k) Δu = −r(u^k), updates u^{k+1} = u^k + Δu, and stops once
// ‖r‖₂ / ‖f_ext‖₂ < tol. f_ext is applied in `loadSteps` even sub-increments
// to broaden the radius of convergence.
NonlinearResult solveNonlinearStatic(const Mesh& mesh, const Material& mat,
                                     const std::vector<LoadNodal>& loads,
                                     const std::vector<BCPinned>&  bcs,
                                     const NonlinearConfig& cfg)
{
    if (cfg.loadSteps <= 0) {
        throw std::invalid_argument("forge.fea.solveNonlinearStatic: loadSteps must be > 0");
    }
    if (cfg.maxNewton <= 0) {
        throw std::invalid_argument("forge.fea.solveNonlinearStatic: maxNewton must be > 0");
    }

    auto t0 = std::chrono::steady_clock::now();

    const std::size_t nNodes = mesh.nodes.size() / 3;
    const std::size_t nElems = mesh.tets.size() / mesh.elemNodeCount;
    const int nDof = static_cast<int>(3 * nNodes);

    // ---- material 6×6 D ----------------------------------------------------
    Eigen::Matrix<double, 6, 6> D = Eigen::Matrix<double, 6, 6>::Zero();
    {
        const double lam = mat.E * mat.nu / ((1 + mat.nu) * (1 - 2 * mat.nu));
        const double mu  = mat.E / (2 * (1 + mat.nu));
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j)
                D(i, j) = lam + (i == j ? 2 * mu : 0);
        D(3, 3) = mu; D(4, 4) = mu; D(5, 5) = mu;
    }

    // ---- pin BCs as bool vector -------------------------------------------
    std::vector<bool> isPinned(nDof, false);
    for (const auto& bc : bcs) {
        const int base = 3 * bc.nodeId;
        if (bc.fx) isPinned[base + 0] = true;
        if (bc.fy) isPinned[base + 1] = true;
        if (bc.fz) isPinned[base + 2] = true;
    }

    // ---- external load vector (full at load step = loadSteps) -------------
    Eigen::VectorXd fFull = Eigen::VectorXd::Zero(nDof);
    for (const auto& L : loads) {
        const int base = 3 * static_cast<int>(L.nodeId);
        if (base + 2 < nDof) {
            fFull(base + 0) += L.fx;
            fFull(base + 1) += L.fy;
            fFull(base + 2) += L.fz;
        }
    }
    for (int i = 0; i < nDof; ++i) if (isPinned[i]) fFull(i) = 0;
    const double fNorm = std::max(1e-12, fFull.norm());

    NonlinearResult out;
    out.stepDisplacements.reserve(cfg.loadSteps);
    out.stepResiduals.reserve(cfg.loadSteps);
    out.stepIterations.reserve(cfg.loadSteps);
    out.converged = true;

    Eigen::VectorXd u = Eigen::VectorXd::Zero(nDof);

    // Reference nodal coords (undeformed).
    std::vector<double> Xref = mesh.nodes;

    // -------- per-load-step Newton loop ------------------------------------
    for (int step = 1; step <= cfg.loadSteps; ++step) {
        const double lambda = static_cast<double>(step) / cfg.loadSteps;
        Eigen::VectorXd fExt = lambda * fFull;

        int iter = 0;
        double relRes = 0;
        for (iter = 0; iter < cfg.maxNewton; ++iter) {
            // Build K_T and internal force at current u using the geometric
            // stiffness on the deformed coords X = X_ref + u.
            Eigen::SparseMatrix<double> Kt(nDof, nDof);
            Eigen::VectorXd fInt = Eigen::VectorXd::Zero(nDof);

            std::vector<Eigen::Triplet<double>> trips;
            trips.reserve(nElems * 24 * 24);

            for (std::size_t e = 0; e < nElems; ++e) {
                double Xdef[8][3];
                std::uint32_t nodeIds[8];
                std::array<double, 24> ue{};
                for (int i = 0; i < 8; ++i) {
                    const std::uint32_t nid = mesh.tets[e * 8 + i];
                    nodeIds[i] = nid;
                    Xdef[i][0] = Xref[3*nid + 0] + u(3*nid + 0);
                    Xdef[i][1] = Xref[3*nid + 1] + u(3*nid + 1);
                    Xdef[i][2] = Xref[3*nid + 2] + u(3*nid + 2);
                    for (int a = 0; a < 3; ++a) ue[3*i + a] = u(3*nid + a);
                }
                Eigen::Matrix<double, 24, 24> Ke = Eigen::Matrix<double, 24, 24>::Zero();
                Eigen::Matrix<double, 24, 1>  fInt_e = Eigen::Matrix<double, 24, 1>::Zero();

                for (int g = 0; g < kGaussCount; ++g) {
                    const auto& gp = kGauss[g];
                    double dN[8][3]; shapeDerivs(gp.xi, gp.eta, gp.zeta, dN);
                    double J[3][3];  jacobian3(dN, Xdef, J);
                    const double det = det3x3(J);
                    if (det <= 0) {
                        // Element inverted — the load step is too large.
                        throw std::runtime_error(
                            "forge.fea.solveNonlinearStatic: element inverted, "
                            "reduce load step count or load magnitude");
                    }
                    double Ji[3][3]; inv3x3(J, Ji, det);
                    double dNx[8][3];
                    for (int i = 0; i < 8; ++i)
                        for (int j = 0; j < 3; ++j) {
                            double s = 0;
                            for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                            dNx[i][j] = s;
                        }
                    Eigen::Matrix<double, 6, 24> B;
                    B.setZero();
                    for (int i = 0; i < 8; ++i) {
                        const int c = 3 * i;
                        const double bx = dNx[i][0];
                        const double by = dNx[i][1];
                        const double bz = dNx[i][2];
                        B(0, c    ) = bx;
                        B(1, c + 1) = by;
                        B(2, c + 2) = bz;
                        B(3, c    ) = by; B(3, c + 1) = bx;
                        B(4, c + 1) = bz; B(4, c + 2) = by;
                        B(5, c    ) = bz; B(5, c + 2) = bx;
                    }
                    Eigen::Matrix<double, 24, 1> ueV;
                    for (int i = 0; i < 24; ++i) ueV(i) = ue[i];
                    Eigen::Matrix<double, 6, 1> eps = B * ueV;
                    Eigen::Matrix<double, 6, 1> sigma = D * eps;

                    const double wScale = gp.w * det;
                    Ke.noalias()       += B.transpose() * D * B * wScale;
                    fInt_e.noalias()   += B.transpose() * sigma * wScale;

                    // Geometric stiffness K_σ:
                    //   K_σ = ∫ G^T S G dΩ where G is the 9×24 nodal gradient
                    //   matrix and S is a 9×9 block-diagonal of σ.
                    Eigen::Matrix<double, 9, 24> G = Eigen::Matrix<double, 9, 24>::Zero();
                    for (int i = 0; i < 8; ++i) {
                        const int c = 3 * i;
                        G(0, c    ) = dNx[i][0];
                        G(1, c    ) = dNx[i][1];
                        G(2, c    ) = dNx[i][2];
                        G(3, c + 1) = dNx[i][0];
                        G(4, c + 1) = dNx[i][1];
                        G(5, c + 1) = dNx[i][2];
                        G(6, c + 2) = dNx[i][0];
                        G(7, c + 2) = dNx[i][1];
                        G(8, c + 2) = dNx[i][2];
                    }
                    Eigen::Matrix<double, 3, 3> S;
                    S(0,0) = sigma(0); S(0,1) = sigma(3); S(0,2) = sigma(5);
                    S(1,0) = sigma(3); S(1,1) = sigma(1); S(1,2) = sigma(4);
                    S(2,0) = sigma(5); S(2,1) = sigma(4); S(2,2) = sigma(2);
                    Eigen::Matrix<double, 9, 9> SBlock = Eigen::Matrix<double, 9, 9>::Zero();
                    SBlock.block<3,3>(0,0) = S;
                    SBlock.block<3,3>(3,3) = S;
                    SBlock.block<3,3>(6,6) = S;
                    Ke.noalias() += G.transpose() * SBlock * G * wScale;
                }
                // Scatter into K_t and f_int.
                for (int i = 0; i < 8; ++i) {
                    for (int ai = 0; ai < 3; ++ai) {
                        const int gi = 3 * nodeIds[i] + ai;
                        const int li = 3 * i + ai;
                        fInt(gi) += fInt_e(li);
                        for (int j = 0; j < 8; ++j) {
                            for (int aj = 0; aj < 3; ++aj) {
                                const int gj = 3 * nodeIds[j] + aj;
                                const int lj = 3 * j + aj;
                                const double v = Ke(li, lj);
                                if (std::abs(v) > 0) trips.emplace_back(gi, gj, v);
                            }
                        }
                    }
                }
            }
            Kt.setFromTriplets(trips.begin(), trips.end());
            Kt.makeCompressed();

            Eigen::VectorXd r = fInt - fExt;
            // Apply pinned BCs to residual + Kt.
            for (int i = 0; i < nDof; ++i) if (isPinned[i]) r(i) = 0;
            relRes = r.norm() / fNorm;
            if (relRes < cfg.residualTol && iter > 0) break;

            // Apply pinned BCs to Kt: zero rows/cols + diag = 1.
            for (int k = 0; k < Kt.outerSize(); ++k) {
                for (Eigen::SparseMatrix<double>::InnerIterator it(Kt, k); it; ++it) {
                    const int rr = static_cast<int>(it.row());
                    const int cc = static_cast<int>(it.col());
                    if (isPinned[rr] || isPinned[cc]) it.valueRef() = 0;
                }
            }
            for (int i = 0; i < nDof; ++i) if (isPinned[i]) Kt.coeffRef(i, i) = 1.0;
            Kt.prune(0.0); Kt.makeCompressed();

            Eigen::SimplicialLDLT<Eigen::SparseMatrix<double>> ldlt(Kt);
            if (ldlt.info() != Eigen::Success) {
                throw std::runtime_error(
                    "forge.fea.solveNonlinearStatic: tangent LDLT factorisation failed");
            }
            Eigen::VectorXd du = ldlt.solve(-r);
            // Pinned DOFs stay at 0.
            for (int i = 0; i < nDof; ++i) if (isPinned[i]) du(i) = 0;
            u += du;
        }
        out.stepResiduals.push_back(relRes);
        out.stepIterations.push_back(iter);
        if (iter >= cfg.maxNewton && relRes > cfg.residualTol) {
            out.converged = false;
        }
        std::vector<double> snap(nDof);
        for (int i = 0; i < nDof; ++i) snap[i] = u(i);
        out.stepDisplacements.push_back(std::move(snap));
    }

    auto t1 = std::chrono::steady_clock::now();
    out.cpuMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return out;
}

// =====================================================================
// fatigueLife — rainflow + Basquin S-N with Goodman/Soderberg correction
// =====================================================================
//
// Approach:
//   1. For each element, count cycles via simplified rainflow on the
//      stress-time history. We use the 4-point method (peak/valley scan +
//      hysteresis loop closure) which is sufficient for our smoke test.
//   2. For each amplitude S_a (and mean S_m), apply Goodman / Soderberg:
//        S_eq = S_a / (1 − S_m / S_*)  where S_* = S_u (Goodman) or S_y
//                                       (Soderberg). Clamped to S_a if no
//                                       correction selected or denominator
//                                       non-positive.
//   3. Look up N(S_eq) from the S-N curve (log-log interpolation between
//      the table points; if S below the smallest table point, life is Inf;
//      if S above the largest, life is 0).
//   4. Per-element life = Σ n_i / N(S_eq_i)   (Miner's linear damage rule),
//      total cycles = 1 / damage.
//
// For a constant sinusoid: rainflow returns one cycle per pair of (peak, valley)
// so the result reduces to Basquin's relation:
//   N = N_ref · (S_ref / S_a) ^ (−1 / b)
// where b is the slope of the (log N, log S) line through (N_ref, S_ref).

namespace {

double snLookup(const SNCurve& sn, double S) {
    if (sn.N.size() < 2) return std::numeric_limits<double>::infinity();
    // sn.N expected ascending. sn.S typically descending.
    // Build log-log interp.
    if (S <= 0) return std::numeric_limits<double>::infinity();
    // Endurance regime: below the smallest S in the table → infinite life.
    double Smin = sn.S[0], Smax = sn.S[0];
    for (double s : sn.S) { if (s < Smin) Smin = s; if (s > Smax) Smax = s; }
    if (S < Smin * 0.999) return std::numeric_limits<double>::infinity();
    if (S > Smax * 1.001) return 1.0; // immediate failure
    // Find bracket in S (we want to interpolate N).
    for (std::size_t i = 0; i + 1 < sn.N.size(); ++i) {
        const double S0 = sn.S[i],   S1 = sn.S[i + 1];
        const double N0 = sn.N[i],   N1 = sn.N[i + 1];
        if ((S - S0) * (S - S1) <= 0) {
            // log-log interpolation in (log N, log S).
            const double t = (std::log(S) - std::log(S0))
                           / (std::log(S1) - std::log(S0));
            return std::exp(std::log(N0) + t * (std::log(N1) - std::log(N0)));
        }
    }
    // Extrapolate using last two points (Basquin slope).
    const std::size_t last = sn.N.size() - 1;
    const double S0 = sn.S[last - 1], S1 = sn.S[last];
    const double N0 = sn.N[last - 1], N1 = sn.N[last];
    const double slope = (std::log(N1) - std::log(N0))
                       / (std::log(S1) - std::log(S0));
    return std::exp(std::log(N1) + slope * (std::log(S) - std::log(S1)));
}

// Simplified peak-valley extraction + cycle counting. Returns a list of
// (amplitude, mean) pairs.
struct CyclePair { double amp; double mean; double count; };
std::vector<CyclePair> rainflow(const std::vector<double>& s, double perPair) {
    std::vector<CyclePair> out;
    if (s.size() < 2) return out;
    // Extract turning points (alternating peak/valley).
    std::vector<double> tp;
    tp.reserve(s.size());
    tp.push_back(s[0]);
    for (std::size_t i = 1; i + 1 < s.size(); ++i) {
        if ((s[i] - s[i - 1]) * (s[i + 1] - s[i]) <= 0) {
            tp.push_back(s[i]);
        }
    }
    tp.push_back(s.back());
    // 4-point method (ASTM E1049 simplified).
    std::vector<double> stack;
    stack.reserve(tp.size());
    for (double v : tp) {
        stack.push_back(v);
        while (stack.size() >= 3) {
            const std::size_t n = stack.size();
            const double X = std::abs(stack[n - 1] - stack[n - 2]);
            const double Y = std::abs(stack[n - 2] - stack[n - 3]);
            if (X < Y) break;
            // Y is a closed cycle.
            const double amp  = 0.5 * Y;
            const double mean = 0.5 * (stack[n - 2] + stack[n - 3]);
            out.push_back({amp, mean, perPair});
            stack[n - 3] = stack[n - 1];
            stack.pop_back(); stack.pop_back();
        }
    }
    // Residual stack → half cycles.
    for (std::size_t i = 0; i + 1 < stack.size(); ++i) {
        const double amp  = 0.5 * std::abs(stack[i + 1] - stack[i]);
        const double mean = 0.5 * (stack[i] + stack[i + 1]);
        out.push_back({amp, mean, 0.5 * perPair});
    }
    return out;
}

} // namespace

FatigueResult fatigueLife(const std::vector<double>& stressHistory,
                          std::size_t nElem, std::size_t nSteps,
                          const FatigueConfig& cfg)
{
    if (stressHistory.size() != nElem * nSteps) {
        throw std::invalid_argument(
            "forge.fea.fatigueLife: stressHistory size != nElem * nSteps");
    }
    if (cfg.sn.N.size() < 2 || cfg.sn.S.size() != cfg.sn.N.size()) {
        throw std::invalid_argument(
            "forge.fea.fatigueLife: S-N curve must have ≥ 2 matched (N, S) points");
    }
    if ((cfg.meanCorrection == kGoodman && cfg.ultimateStress <= 0) ||
        (cfg.meanCorrection == kSoderberg && cfg.yieldStress <= 0)) {
        throw std::invalid_argument(
            "forge.fea.fatigueLife: ultimate/yield stress required for chosen correction");
    }

    FatigueResult out;
    out.cyclesToFailure.assign(nElem, std::numeric_limits<double>::infinity());
    out.minLife = std::numeric_limits<double>::infinity();
    out.minLifeElem = 0;
    out.maxAmplitude = 0;

    std::vector<double> hist(nSteps);
    for (std::size_t e = 0; e < nElem; ++e) {
        for (std::size_t t = 0; t < nSteps; ++t) hist[t] = stressHistory[e * nSteps + t];
        auto cycles = rainflow(hist, cfg.cyclesPerSample);
        double damage = 0;
        double totalCycles = 0;
        double localMaxAmp = 0;
        for (const auto& c : cycles) {
            double Seq = c.amp;
            // Mean-stress correction.
            if (cfg.meanCorrection == kGoodman && cfg.ultimateStress > 0) {
                const double r = c.mean / cfg.ultimateStress;
                if (1 - r > 1e-12) Seq = c.amp / (1 - r);
                else                Seq = std::numeric_limits<double>::infinity();
            } else if (cfg.meanCorrection == kSoderberg && cfg.yieldStress > 0) {
                const double r = c.mean / cfg.yieldStress;
                if (1 - r > 1e-12) Seq = c.amp / (1 - r);
                else                Seq = std::numeric_limits<double>::infinity();
            }
            if (Seq > localMaxAmp) localMaxAmp = Seq;
            totalCycles += c.count;
            if (!std::isfinite(Seq) || Seq <= 0) continue;
            const double Nf = snLookup(cfg.sn, Seq);
            if (!std::isfinite(Nf) || Nf <= 0) continue;
            damage += c.count / Nf;
        }
        // cyclesToFailure expressed as absolute cycles: if `totalCycles`
        // cycles in the input history accumulated `damage` damage, then by
        // Miner's rule failure happens when damage = 1. The absolute cycle
        // count to failure scales with the input duration: N_f =
        // totalCycles / damage. For constant-amplitude this collapses to
        // N_f = N(S), recovering the Basquin closed-form directly.
        if (damage > 0 && totalCycles > 0) {
            out.cyclesToFailure[e] = totalCycles / damage;
        }
        if (out.cyclesToFailure[e] < out.minLife) {
            out.minLife = out.cyclesToFailure[e];
            out.minLifeElem = static_cast<std::uint32_t>(e);
        }
        if (localMaxAmp > out.maxAmplitude) out.maxAmplitude = localMaxAmp;
    }
    return out;
}

} // namespace forge::fea
