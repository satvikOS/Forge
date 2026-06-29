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

#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/HexElement.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"
#include "forge/native/fea/TransientThermal.hpp"

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

namespace la = forge::native::linalg;

namespace {

// ---------------------------- hex element kernels (shared)
// The 8-node hex Gauss rule, node-sign table, shape functions/derivatives and
// Jacobian/det3/inv3 are THE single canonical copy in the shared header
// forge/native/fea/HexElement.hpp (extracted from Fea.cpp). This TU previously
// re-declared a byte-identical local copy; it now forwards to the shared one
// under the names the call sites below already use, so behavior is unchanged.
// (The former local `shapeFns` was dead code here and is dropped.)
namespace hex = forge::native::fea::hex;
namespace se  = forge::native::fea::scalar_elliptic;
using hex::GaussPoint;
using hex::kGauss;
constexpr int kGaussCount = hex::GAUSS_COUNT;

inline void shapeDerivs(double xi, double eta, double zeta, double dN[8][3]) {
    hex::shapeDerivatives(xi, eta, zeta, dN);
}
inline void jacobian3(const double dN[8][3], const double nodeCoords[8][3],
                      double J[3][3]) {
    hex::jacobian(dN, nodeCoords, J);
}
inline double det3x3(const double J[3][3]) { return hex::det3(J); }
inline void inv3x3(const double J[3][3], double Ji[3][3], double det) {
    hex::inv3(J, Ji, det);
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

    std::vector<double> f(nNodes, 0.0);

    std::vector<la::Triplet<double>> trips;
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

        // Element 8×8 Laplacian stiffness K_e^{ij} = ∫ k (∇N_i)·(∇N_j) dΩ — the
        // scalar-elliptic operator −∇·(c∇u)=f with c = k — via the SHARED
        // assembler (ScalarElliptic.hpp). Byte-identical to the former inline loop
        // (same HexElement math, same k·s·w order), so the thermal numerics are
        // unchanged; the ctx reproduces the prior degenerate-element message.
        la::MatrixD Ke(8, 8);
        const double elemVolume =
            se::elementStiffness(mat.k, nodeCoords, Ke, "forge.fea.solveThermal");
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
            for (int i = 0; i < 8; ++i) f[nodeIds[i]] += per;
        }
    }
    // Convection (Robin) diagonal/RHS contributions are appended to `trips` (for
    // the diagonal) below before assembly: la::SparseCSR is assembled once from
    // triplets and has no post-assembly mutation API (no coeffRef / InnerIterator
    // / valueRef / prune), so what Eigen did with K.coeffRef(i,i) += ... on the
    // already-compressed matrix is instead expressed as an additional
    // (i, i, c.h*per) triplet — setFromTriplets sums duplicates, giving the
    // identical assembled diagonal. The Dirichlet row/col elimination that Eigen
    // performed by walking InnerIterator + prune is likewise reproduced at the
    // CSR level after this assembly, by reading the assembled entries and
    // re-assembling a filtered triplet list (see below).

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
                trips.emplace_back(i, i, c.h * per);
                f[i] += c.h * c.Tinf * per;
            }
        }
    }

    // Assemble the (element + convection-diagonal) triplets into the global K.
    // setFromTriplets sums duplicates exactly as Eigen's setFromTriplets +
    // coeffRef(+=) sequence did, so K0 here equals the post-convection matrix.
    la::SparseCSR<double> K0;
    K0.setFromTriplets(nNodes, nNodes, trips);

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
    //
    // The Eigen version walked the assembled matrix with InnerIterator and
    // mutated it in place (valueRef=0 / coeffRef=1 / prune). la::SparseCSR is
    // immutable post-assembly, so the IDENTICAL transformation is reproduced by
    // (a) reading the assembled entries of K0 (read-only CSR accessors) to do
    // the f-substitution, then (b) rebuilding a filtered triplet list — keeping
    // every entry NOT touching a fixed row/col, dropping (== zeroing+pruning)
    // the rest, and appending (i,i,1.0) for each fixed dof — and re-assembling.
    {
        const auto& rowPtr = K0.rowPtr();
        const auto& colIdx = K0.colIdx();
        const auto& vals   = K0.values();
        // (a) f(r) -= K(r,c)*fixedVal[c] for fixed c, free r — same iteration
        //     order over stored entries as Eigen's column-walk (order-invariant
        //     since each (r,c) entry is unique post-assembly).
        for (std::size_t r = 0; r < nNodes; ++r) {
            for (std::size_t p = rowPtr[r]; p < rowPtr[r + 1]; ++p) {
                const std::size_t c = colIdx[p];
                if (isFixed[c] && !isFixed[r]) {
                    f[r] -= vals[p] * fixedVal[c];
                }
            }
        }
        // (b) rebuild filtered triplets: drop entries on a fixed row/col, add
        //     unit diagonal for each fixed dof, set f(i)=fixedVal[i].
        std::vector<la::Triplet<double>> ktrips;
        ktrips.reserve(vals.size());
        for (std::size_t r = 0; r < nNodes; ++r) {
            for (std::size_t p = rowPtr[r]; p < rowPtr[r + 1]; ++p) {
                const std::size_t c = colIdx[p];
                if (isFixed[r] || isFixed[c]) continue;
                ktrips.emplace_back(r, c, vals[p]);
            }
        }
        for (std::size_t i = 0; i < nNodes; ++i) {
            if (isFixed[i]) {
                ktrips.emplace_back(i, i, 1.0);
                f[i] = fixedVal[i];
            }
        }
        K0.setFromTriplets(nNodes, nNodes, ktrips);
    }

    la::SparseLDLT ldlt(K0);
    if (!ldlt.ok()) {
        throw std::runtime_error("forge.fea.solveThermal: LDLT factorisation failed");
    }
    std::vector<double> T = ldlt.solve(f);

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
        // ∇T at the element centroid via the SHARED gradient recovery
        // (ScalarElliptic.hpp) — byte-identical to the former inline single
        // Gauss-point (0,0,0) evaluation.
        double gT[3];
        se::gradientAt(0, 0, 0, nodeCoords, Te, gT);
        // q = −k ∇T.
        const double qx = -mat.k * gT[0];
        const double qy = -mat.k * gT[1];
        const double qz = -mat.k * gT[2];
        out.elemFluxMag[e] = std::sqrt(qx*qx + qy*qy + qz*qz);
    }
    // Residual (post-elimination).
    std::vector<double> r = la::vsub(K0 * T, f);
    out.residual = la::normInf(r);
    return out;
}

// =====================================================================
// solveTransientThermal — time-dependent heat conduction on the hex mesh
// =====================================================================
//
// Extends solveThermal to ρc ∂T/∂t = ∇·(k ∇T) + Q. The element conductance K_e
// is the SAME scalar-elliptic Laplacian (se::elementStiffness, c = k) the steady
// path assembles; the NEW piece is the consistent thermal capacitance
//   C_e^{ij} = ∫ ρc N_i N_j dΩ   (transient_thermal::elementCapacitance).
// Backward Euler (unconditionally stable): (C/Δt + K) Tⁿ⁺¹ = (C/Δt) Tⁿ + F.
// The left operator A = C/Δt + K (plus the convective Robin diagonal) is
// Dirichlet-eliminated and factored ONCE with SparseLDLT — the identical
// factor-once / solve-many posture and the identical row/col elimination
// solveThermal uses — then every step is one back-solve. Body sources +
// convection RHS form the constant load F; the per-step RHS adds (C/Δt) Tⁿ and
// re-applies the (constant) Dirichlet lift. Convergence of this operator to the
// steady K T = F as t→∞, and the closed-form semi-infinite-slab erf profile, are
// the native-gate known answers (test/native/fea/transient_thermal_test.cpp).
TransientThermalResult solveTransientThermal(
    const Mesh& mesh, const ThermalMaterial& mat,
    const TransientThermalConfig& cfg,
    const std::vector<ThermalNodalT>&     dirichlet,
    const std::vector<ThermalElemSource>& sources,
    const std::vector<ThermalConvection>& convection,
    const std::vector<double>&            initialT)
{
    namespace tt = forge::native::fea::transient_thermal;
    const std::size_t nNodes = mesh.nodes.size() / 3;
    const std::size_t nElems = mesh.tets.size() / mesh.elemNodeCount;
    if (mat.k <= 0)
        throw std::invalid_argument("forge.fea.solveTransientThermal: k must be > 0");
    if (cfg.rhoC <= 0)
        throw std::invalid_argument("forge.fea.solveTransientThermal: rhoC must be > 0");
    if (cfg.dt <= 0)
        throw std::invalid_argument("forge.fea.solveTransientThermal: dt must be > 0");
    if (cfg.nSteps <= 0)
        throw std::invalid_argument("forge.fea.solveTransientThermal: nSteps must be > 0");

    const double idt = 1.0 / cfg.dt;

    std::vector<double> F0(nNodes, 0.0);              // constant load (body + Robin RHS)
    std::vector<la::Triplet<double>> aTrips;          // A = C/Δt + K (+ Robin diagonal)
    std::vector<la::Triplet<double>> cTrips;          // C (consistent capacitance)
    aTrips.reserve(nElems * 8 * 8);
    cTrips.reserve(nElems * 8 * 8);

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
        // K_e (reuse the steady Laplacian) and C_e (the new consistent capacitance).
        la::MatrixD Ke(8, 8);
        const double elemVolume =
            se::elementStiffness(mat.k, nodeCoords, Ke, "forge.fea.solveTransientThermal");
        la::MatrixD Ce(8, 8);
        tt::elementCapacitance(cfg.rhoC, nodeCoords, Ce, "forge.fea.solveTransientThermal");
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j) {
                const double kij = Ke(i, j), cij = Ce(i, j);
                const double aij = cij * idt + kij;
                if (std::abs(aij) > 0) aTrips.emplace_back(nodeIds[i], nodeIds[j], aij);
                if (std::abs(cij) > 0) cTrips.emplace_back(nodeIds[i], nodeIds[j], cij);
            }
        // Body source — lumped equally (held constant over the march).
        auto srcIt = elemSource.find(static_cast<std::uint32_t>(e));
        if (srcIt != elemSource.end()) {
            const double per = srcIt->second * elemVolume / 8.0;
            for (int i = 0; i < 8; ++i) F0[nodeIds[i]] += per;
        }
    }

    // Convection (Robin) — part of the SPATIAL operator: h·A_node adds to A's
    // diagonal, h·A_node·T∞ to the constant load F0 (same AABB-face lumping as
    // solveThermal). Held constant across the march.
    if (mesh.nodeToFace.size() == nNodes && !convection.empty()) {
        double minP[3] = { 1e300, 1e300, 1e300};
        double maxP[3] = {-1e300,-1e300,-1e300};
        for (std::size_t i = 0; i < nNodes; ++i)
            for (int j = 0; j < 3; ++j) {
                minP[j] = std::min(minP[j], mesh.nodes[3*i + j]);
                maxP[j] = std::max(maxP[j], mesh.nodes[3*i + j]);
            }
        const double Lx = maxP[0]-minP[0], Ly = maxP[1]-minP[1], Lz = maxP[2]-minP[2];
        const double faceArea[6] = { Ly*Lz, Ly*Lz, Lx*Lz, Lx*Lz, Lx*Ly, Lx*Ly };
        for (const auto& c : convection) {
            if (c.faceId >= 6) continue;
            std::vector<std::size_t> faceNodes;
            for (std::size_t i = 0; i < nNodes; ++i)
                if (mesh.nodeToFace[i] & (1u << c.faceId)) faceNodes.push_back(i);
            if (faceNodes.empty()) continue;
            const double per = faceArea[c.faceId] / static_cast<double>(faceNodes.size());
            for (std::size_t i : faceNodes) {
                aTrips.emplace_back(i, i, c.h * per);
                F0[i] += c.h * c.Tinf * per;
            }
        }
    }

    // Aorig = un-eliminated C/Δt + K (+ Robin) for the per-step Dirichlet lift;
    // Cmat = the consistent capacitance for the (C/Δt) Tⁿ RHS matvec.
    la::SparseCSR<double> Aorig; Aorig.setFromTriplets(nNodes, nNodes, aTrips);
    la::SparseCSR<double> Cmat;  Cmat.setFromTriplets(nNodes, nNodes, cTrips);

    // Dirichlet set (prescribed surface temperatures, constant in time).
    std::vector<bool>   isFixed(nNodes, false);
    std::vector<double> fixedVal(nNodes, 0.0);
    for (const auto& d : dirichlet)
        if (d.nodeId < nNodes) { isFixed[d.nodeId] = true; fixedVal[d.nodeId] = d.T; }

    // Eliminated operator: drop fixed rows/cols, unit diagonal on fixed dofs —
    // IDENTICAL to solveThermal's elimination. Factor ONCE (fixed Δt).
    la::SparseCSR<double> Aelim;
    {
        const auto& rowPtr = Aorig.rowPtr();
        const auto& colIdx = Aorig.colIdx();
        const auto& vals   = Aorig.values();
        std::vector<la::Triplet<double>> et;
        et.reserve(vals.size());
        for (std::size_t r = 0; r < nNodes; ++r)
            for (std::size_t p = rowPtr[r]; p < rowPtr[r + 1]; ++p) {
                const std::size_t c = colIdx[p];
                if (isFixed[r] || isFixed[c]) continue;
                et.emplace_back(r, c, vals[p]);
            }
        for (std::size_t i = 0; i < nNodes; ++i)
            if (isFixed[i]) et.emplace_back(i, i, 1.0);
        Aelim.setFromTriplets(nNodes, nNodes, et);
    }
    la::SparseLDLT ldlt(Aelim);
    if (!ldlt.ok())
        throw std::runtime_error("forge.fea.solveTransientThermal: LDLT factorisation failed");

    // Initial condition.
    std::vector<double> T(nNodes, cfg.T0);
    if (!initialT.empty()) {
        if (initialT.size() != nNodes)
            throw std::invalid_argument(
                "forge.fea.solveTransientThermal: initialT size must equal node count");
        T = initialT;
    }

    TransientThermalResult out;
    out.steps = cfg.nSteps;
    const int snap = cfg.snapshotEvery;
    if (snap > 0) { out.snapshots.push_back(T); out.snapshotTimes.push_back(0.0); }

    const auto& arp = Aorig.rowPtr();
    const auto& aci = Aorig.colIdx();
    const auto& avv = Aorig.values();
    for (int s = 0; s < cfg.nSteps; ++s) {
        // RHS b = (C/Δt) Tⁿ + F0.
        std::vector<double> cT = Cmat * T;
        std::vector<double> b(nNodes);
        for (std::size_t i = 0; i < nNodes; ++i) b[i] = cT[i] * idt + F0[i];
        // Dirichlet lift on the FREE rows: b[r] -= A(r,c)·fixedVal[c] for fixed c.
        for (std::size_t r = 0; r < nNodes; ++r) {
            if (isFixed[r]) continue;
            for (std::size_t p = arp[r]; p < arp[r + 1]; ++p) {
                const std::size_t c = aci[p];
                if (isFixed[c]) b[r] -= avv[p] * fixedVal[c];
            }
        }
        for (std::size_t i = 0; i < nNodes; ++i)
            if (isFixed[i]) b[i] = fixedVal[i];
        T = ldlt.solve(b);
        if (snap > 0 && ((s + 1) % snap == 0)) {
            out.snapshots.push_back(T);
            out.snapshotTimes.push_back((s + 1) * cfg.dt);
        }
    }

    out.T.assign(T.begin(), T.end());
    double maxT = -1e300, minT = 1e300;
    for (double t : T) { if (t > maxT) maxT = t; if (t < minT) minT = t; }
    out.maxT = maxT;
    out.minT = minT;
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
    la::MatrixD D(6, 6);
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
    std::vector<double> fFull(nDof, 0.0);
    for (const auto& L : loads) {
        const int base = 3 * static_cast<int>(L.nodeId);
        if (base + 2 < nDof) {
            fFull[base + 0] += L.fx;
            fFull[base + 1] += L.fy;
            fFull[base + 2] += L.fz;
        }
    }
    for (int i = 0; i < nDof; ++i) if (isPinned[i]) fFull[i] = 0;
    const double fNorm = std::max(1e-12, la::norm2(fFull));

    NonlinearResult out;
    out.stepDisplacements.reserve(cfg.loadSteps);
    out.stepResiduals.reserve(cfg.loadSteps);
    out.stepIterations.reserve(cfg.loadSteps);
    out.converged = true;

    std::vector<double> u(nDof, 0.0);

    // Reference nodal coords (undeformed).
    std::vector<double> Xref = mesh.nodes;

    // -------- per-load-step Newton loop ------------------------------------
    for (int step = 1; step <= cfg.loadSteps; ++step) {
        const double lambda = static_cast<double>(step) / cfg.loadSteps;
        std::vector<double> fExt = la::vscale(fFull, lambda);

        int iter = 0;
        double relRes = 0;
        for (iter = 0; iter < cfg.maxNewton; ++iter) {
            // Build K_T and internal force at current u using the geometric
            // stiffness on the deformed coords X = X_ref + u.
            std::vector<double> fInt(nDof, 0.0);

            std::vector<la::Triplet<double>> trips;
            trips.reserve(nElems * 24 * 24);

            for (std::size_t e = 0; e < nElems; ++e) {
                double Xdef[8][3];
                std::uint32_t nodeIds[8];
                std::array<double, 24> ue{};
                for (int i = 0; i < 8; ++i) {
                    const std::uint32_t nid = mesh.tets[e * 8 + i];
                    nodeIds[i] = nid;
                    Xdef[i][0] = Xref[3*nid + 0] + u[3*nid + 0];
                    Xdef[i][1] = Xref[3*nid + 1] + u[3*nid + 1];
                    Xdef[i][2] = Xref[3*nid + 2] + u[3*nid + 2];
                    for (int a = 0; a < 3; ++a) ue[3*i + a] = u[3*nid + a];
                }
                la::MatrixD Ke(24, 24);
                std::vector<double> fInt_e(24, 0.0);

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
                    la::MatrixD B(6, 24);
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
                    std::vector<double> ueV(24);
                    for (int i = 0; i < 24; ++i) ueV[i] = ue[i];
                    std::vector<double> eps = B * ueV;
                    std::vector<double> sigma = D * eps;

                    const double wScale = gp.w * det;
                    // Ke += (Bᵀ D B) * wScale  (scalar fold into the entrywise add,
                    // since la::MatrixD has no scalar operator* / .noalias()).
                    const la::MatrixD BtDB = B.transpose() * D * B;
                    for (int ii = 0; ii < 24; ++ii)
                        for (int jj = 0; jj < 24; ++jj)
                            Ke(ii, jj) += BtDB(ii, jj) * wScale;
                    // fInt_e += (Bᵀ σ) * wScale.
                    const std::vector<double> Bts = B.transpose() * sigma;
                    for (int ii = 0; ii < 24; ++ii)
                        fInt_e[ii] += Bts[ii] * wScale;

                    // Geometric stiffness K_σ:
                    //   K_σ = ∫ G^T S G dΩ where G is the 9×24 nodal gradient
                    //   matrix and S is a 9×9 block-diagonal of σ.
                    la::MatrixD G(9, 24);
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
                    la::MatrixD S(3, 3);
                    S(0,0) = sigma[0]; S(0,1) = sigma[3]; S(0,2) = sigma[5];
                    S(1,0) = sigma[3]; S(1,1) = sigma[1]; S(1,2) = sigma[4];
                    S(2,0) = sigma[5]; S(2,1) = sigma[4]; S(2,2) = sigma[2];
                    la::MatrixD SBlock(9, 9);
                    SBlock.setBlock(0, 0, S);
                    SBlock.setBlock(3, 3, S);
                    SBlock.setBlock(6, 6, S);
                    // Ke += (Gᵀ SBlock G) * wScale.
                    const la::MatrixD GtSG = G.transpose() * SBlock * G;
                    for (int ii = 0; ii < 24; ++ii)
                        for (int jj = 0; jj < 24; ++jj)
                            Ke(ii, jj) += GtSG(ii, jj) * wScale;
                }
                // Scatter into K_t and f_int.
                for (int i = 0; i < 8; ++i) {
                    for (int ai = 0; ai < 3; ++ai) {
                        const int gi = 3 * nodeIds[i] + ai;
                        const int li = 3 * i + ai;
                        fInt[gi] += fInt_e[li];
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
            std::vector<double> r = la::vsub(fInt, fExt);
            // Apply pinned BCs to residual + Kt.
            for (int i = 0; i < nDof; ++i) if (isPinned[i]) r[i] = 0;
            relRes = la::norm2(r) / fNorm;
            if (relRes < cfg.residualTol && iter > 0) break;

            // Apply pinned BCs to Kt: zero rows/cols + diag = 1.
            //
            // Eigen did this on the assembled matrix (InnerIterator valueRef=0,
            // coeffRef=1, prune). la::SparseCSR is immutable post-assembly, so the
            // identical transformation is performed at the TRIPLET level before
            // assembly: drop every triplet touching a pinned row/col (== the
            // valueRef=0 + prune), then append (i,i,1.0) per pinned dof (==
            // coeffRef=1). setFromTriplets sums duplicates — and no other entry
            // on a pinned row/col survives the filter — so the assembled Kt is
            // exactly what the prior post-assembly mutation produced. No
            // f-substitution is done here (the Eigen code did none either).
            {
                std::vector<la::Triplet<double>> ktrips;
                ktrips.reserve(trips.size());
                for (const auto& t : trips) {
                    if (isPinned[t.row] || isPinned[t.col]) continue;
                    ktrips.push_back(t);
                }
                for (int i = 0; i < nDof; ++i)
                    if (isPinned[i]) ktrips.emplace_back(i, i, 1.0);
                trips.swap(ktrips);
            }
            la::SparseCSR<double> Kt;
            Kt.setFromTriplets(nDof, nDof, trips);

            la::SparseLDLT ldlt(Kt);
            if (!ldlt.ok()) {
                throw std::runtime_error(
                    "forge.fea.solveNonlinearStatic: tangent LDLT factorisation failed");
            }
            std::vector<double> du = ldlt.solve(la::vscale(r, -1.0));
            // Pinned DOFs stay at 0.
            for (int i = 0; i < nDof; ++i) if (isPinned[i]) du[i] = 0;
            la::vaxpy(u, 1.0, du);  // u += du
        }
        out.stepResiduals.push_back(relRes);
        out.stepIterations.push_back(iter);
        if (iter >= cfg.maxNewton && relRes > cfg.residualTol) {
            out.converged = false;
        }
        std::vector<double> snap(nDof);
        for (int i = 0; i < nDof; ++i) snap[i] = u[i];
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
