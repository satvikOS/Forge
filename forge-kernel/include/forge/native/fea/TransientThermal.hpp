// forge-kernel — transient (time-dependent) heat conduction on the 8-node hex
//
// Extends the STEADY conduction operator (FeaExtras.cpp::solveThermal, whose
// element conductance K_e = ∫ k (∇N_i)·(∇N_j) dΩ is the scalar-elliptic kernel
// in ScalarElliptic.hpp) to the time-dependent problem
//
//     ρc ∂T/∂t = ∇·(k ∇T) + Q .
//
// Semi-discrete FE form (Galerkin, same trilinear hex):
//     C Ṫ + K T = F ,
// with the NEW piece being the consistent thermal CAPACITANCE matrix
//
//     C_e^{ij} = ∫_Ω ρc N_i N_j dΩ ,
//
// integrated on the SAME 2×2×2 Gauss rule and the SAME HexElement shape
// functions the conductance uses — NO Laplacian / shape functions are
// re-derived here (K reuses scalar_elliptic::elementStiffness verbatim).
//
// Time integration is the generalized-θ rule, defaulting to BACKWARD EULER
// (θ=1, unconditionally stable):
//     (C/Δt + θK) Tⁿ⁺¹ = (C/Δt − (1−θ)K) Tⁿ + F        (θ=1 ⇒ backward Euler,
//                                                         θ=½ ⇒ Crank–Nicolson).
// For a FIXED Δt the left operator A = C/Δt + θK is factored ONCE (dense SPD
// Cholesky, forge::native::linalg::LLT — the same factor-once / solve-many
// posture solveThermal uses with SparseLDLT) and every step is a back-solve.
// Dirichlet (prescribed surface T) is imposed by the SAME symmetric free/fixed
// partition the structural path uses; Neumann (surface heat flux) and body
// sources enter through the constant load vector F (faceFluxLoad below builds
// the consistent nodal flux load on a hex face).
//
// Pure C++ / header-only / no OCCT / no deps — so the native gate
// test/native/fea/transient_thermal_test.cpp validates it directly against the
// closed-form semi-infinite-slab erf solution and against the steady operator,
// and FeaExtras.cpp::solveTransientThermal forwards the .node path onto the
// identical primitives.

#pragma once

#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/HexElement.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::native::fea::transient_thermal {

namespace hex = forge::native::fea::hex;
namespace se  = forge::native::fea::scalar_elliptic;
using forge::native::linalg::MatrixD;

// ---------------------------------------------------------------------------
// Element 8×8 CONSISTENT thermal capacitance — THE new piece:
//   C_e^{ij} = Σ_g ρc N_i N_j (w_g · det J_g).
// `rhoC` = ρ·c_p, the volumetric heat capacity J/(m³·K). Accumulates into Ce
// (must be an 8×8, zero or pre-seeded as the caller intends) and returns the
// element volume Σ_g (w_g · det J_g). Same HexElement shape functions / Gauss
// rule the conductance uses. Throws on a degenerate (det ≤ 0) Jacobian.
inline double elementCapacitance(double rhoC,
                                 const double X[8][3],
                                 MatrixD& Ce,
                                 const char* ctx = "forge::native::fea::transient_thermal")
{
    double elemVolume = 0;
    for (int g = 0; g < hex::GAUSS_COUNT; ++g) {
        const auto& gp = hex::kGauss[g];
        double N[8];     hex::shapeFunctions(gp.xi, gp.eta, gp.zeta, N);
        double dN[8][3]; hex::shapeDerivatives(gp.xi, gp.eta, gp.zeta, dN);
        double J[3][3];  hex::jacobian(dN, X, J);
        const double det = hex::det3(J);
        if (det <= 0) {
            throw std::runtime_error(std::string(ctx) +
                                     ": element Jacobian non-positive");
        }
        const double w = gp.w * det;
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j)
                Ce(i, j) += rhoC * N[i] * N[j] * w;
        elemVolume += w;
    }
    return elemVolume;
}

// ---------------------------------------------------------------------------
// Element LUMPED thermal capacitance (row-sum / "special lumping" of the
// consistent matrix). Because Σ_j N_j ≡ 1, the row sum is diag_i = ∫ ρc N_i dΩ,
// which preserves the total heat capacity ρc·V exactly. Lumping yields a
// diagonal C with the M-matrix property (no negative off-diagonals coupling the
// time term), useful when a sharp initial step must propagate without spurious
// node-to-node oscillation. `diag` must point at 8 doubles. Returns elem volume.
inline double elementCapacitanceLumped(double rhoC,
                                       const double X[8][3],
                                       double diag[8],
                                       const char* ctx = "forge::native::fea::transient_thermal")
{
    MatrixD Ce(8, 8);  // zero-init
    const double vol = elementCapacitance(rhoC, X, Ce, ctx);
    for (int i = 0; i < 8; ++i) {
        double s = 0;
        for (int j = 0; j < 8; ++j) s += Ce(i, j);
        diag[i] = s;
    }
    return vol;
}

// ---------------------------------------------------------------------------
// Canonical hex face → 4 local node ids (HexElement node order). Used to apply
// a Neumann surface heat flux on an AABB face: faces 0..5 =
// {-x,+x,-y,+y,-z,+z}. Each quad is the face's 4 corner nodes.
inline constexpr int kHexFaces[6][4] = {
    {0, 3, 7, 4},  // -x
    {1, 2, 6, 5},  // +x
    {0, 1, 5, 4},  // -y
    {3, 2, 6, 7},  // +y
    {0, 1, 2, 3},  // -z
    {4, 5, 6, 7},  // +z
};

// ---------------------------------------------------------------------------
// Consistent Neumann (surface heat-flux) load on one quad face of the hex:
//   f_a += ∫_face q'' N_a dA   for the 4 face nodes a,
// where q'' (W/m²) is the heat flux INTO the body. The face is a bilinear quad
// (corner ids `face[4]`); dA is the true surface element |∂x/∂s × ∂x/∂t| from a
// 2×2 Gauss rule, so the load is exact for planar faces and consistent for
// distorted ones. Accumulates into the element's 8-node load `feNodal`.
inline void faceFluxLoad(const double X[8][3], const int face[4], double qflux,
                         double feNodal[8])
{
    constexpr double g = hex::GAUSS_PT;          // 1/√3
    const double pt[2] = {-g, g};
    constexpr int sgnS[4] = {-1, 1, 1, -1};
    constexpr int sgnT[4] = {-1, -1, 1, 1};
    for (int a = 0; a < 2; ++a)
        for (int b = 0; b < 2; ++b) {
            const double s = pt[a], t = pt[b];
            double Nq[4], dNs[4], dNt[4];
            for (int i = 0; i < 4; ++i) {
                Nq[i]  = 0.25 * (1 + sgnS[i] * s) * (1 + sgnT[i] * t);
                dNs[i] = 0.25 * sgnS[i] * (1 + sgnT[i] * t);
                dNt[i] = 0.25 * sgnT[i] * (1 + sgnS[i] * s);
            }
            double dxs[3] = {0, 0, 0}, dxt[3] = {0, 0, 0};
            for (int i = 0; i < 4; ++i) {
                const double* xi = X[face[i]];
                for (int k = 0; k < 3; ++k) {
                    dxs[k] += dNs[i] * xi[k];
                    dxt[k] += dNt[i] * xi[k];
                }
            }
            const double cx[3] = {
                dxs[1] * dxt[2] - dxs[2] * dxt[1],
                dxs[2] * dxt[0] - dxs[0] * dxt[2],
                dxs[0] * dxt[1] - dxs[1] * dxt[0],
            };
            const double dA = std::sqrt(cx[0]*cx[0] + cx[1]*cx[1] + cx[2]*cx[2]); // ·w(1·1)
            for (int i = 0; i < 4; ++i) feNodal[face[i]] += qflux * Nq[i] * dA;
        }
}

// ---------------------------------------------------------------------------
// Minimal hex mesh for the time-dependent assembler: unique node coordinates +
// per-element 8 node ids in the canonical HexElement order.
struct HexMesh {
    std::vector<std::array<double, 3>> nodes;
    std::vector<std::array<int, 8>>    elems;
    std::size_t nNodes() const { return nodes.size(); }
};

// ---------------------------------------------------------------------------
// Assemble the global conductance K and capacitance C (dense, n×n).
//   K reuses scalar_elliptic::elementStiffness(k,…) verbatim — the SAME element
//     Laplacian solveThermal assembles (no re-derivation).
//   C uses elementCapacitance (consistent) or elementCapacitanceLumped.
inline void assembleKC(const HexMesh& m, double k, double rhoC,
                       MatrixD& K, MatrixD& C, bool lumped = false,
                       const char* ctx = "forge::native::fea::transient_thermal")
{
    const std::size_t n = m.nodes.size();
    K.resize(n, n, 0.0);
    C.resize(n, n, 0.0);
    for (const auto& e : m.elems) {
        double X[8][3];
        for (int i = 0; i < 8; ++i) {
            const auto& nd = m.nodes[e[i]];
            X[i][0] = nd[0]; X[i][1] = nd[1]; X[i][2] = nd[2];
        }
        MatrixD Ke(8, 8);
        se::elementStiffness(k, X, Ke, ctx);          // REUSE the steady Laplacian
        MatrixD Ce(8, 8);
        if (lumped) {
            double diag[8];
            elementCapacitanceLumped(rhoC, X, diag, ctx);
            for (int i = 0; i < 8; ++i) Ce(i, i) = diag[i];
        } else {
            elementCapacitance(rhoC, X, Ce, ctx);
        }
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j) {
                K(e[i], e[j]) += Ke(i, j);
                C(e[i], e[j]) += Ce(i, j);
            }
    }
}

// ---------------------------------------------------------------------------
// θ-method (default backward-Euler) time integrator for C Ṫ + K T = F with a
// FIXED Δt and CONSTANT Dirichlet set. Builds A = C/Δt + θK, partitions the
// free / fixed dofs symmetrically (as the structural path does), and factors
// the free–free block A_ff ONCE with a dense SPD Cholesky (LLT). Each step is a
// single back-solve: factor-once, solve-many.
class ThetaThermalIntegrator {
public:
    // K, C are the n×n globals from assembleKC; `fixed[i]!=0` flags a Dirichlet
    // dof with prescribed value `fixedVal[i]`. theta=1 backward Euler (default),
    // theta=0.5 Crank–Nicolson.
    ThetaThermalIntegrator(const MatrixD& K, const MatrixD& C, double dt,
                           const std::vector<char>&   fixed,
                           const std::vector<double>& fixedVal,
                           double theta = 1.0)
        : n_(K.rows()), dt_(dt), theta_(theta),
          isFixed_(fixed), fixedVal_(fixedVal)
    {
        if (dt <= 0) throw std::invalid_argument(
            "forge::native::fea::transient_thermal: dt must be > 0");
        const double idt = 1.0 / dt;
        // A = C/Δt + θK ;  R = C/Δt − (1−θ)K  (RHS operator on Tⁿ).
        MatrixD A(n_, n_);
        R_.resize(n_, n_, 0.0);
        for (std::size_t i = 0; i < n_; ++i)
            for (std::size_t j = 0; j < n_; ++j) {
                const double cij = C(i, j) * idt, kij = K(i, j);
                A(i, j)  = cij + theta_ * kij;
                R_(i, j) = cij - (1.0 - theta_) * kij;
            }
        for (std::size_t i = 0; i < n_; ++i) {
            if (isFixed_[i]) fixedIdx_.push_back(static_cast<int>(i));
            else             free_.push_back(static_cast<int>(i));
        }
        const std::size_t nf = free_.size();
        MatrixD Aff(nf, nf);
        Afp_.resize(nf, fixedIdx_.size(), 0.0);
        for (std::size_t a = 0; a < nf; ++a) {
            for (std::size_t b = 0; b < nf; ++b) Aff(a, b) = A(free_[a], free_[b]);
            for (std::size_t c = 0; c < fixedIdx_.size(); ++c)
                Afp_(a, c) = A(free_[a], fixedIdx_[c]);
        }
        llt_.compute(Aff);
    }

    bool ok() const { return llt_.ok(); }

    // Advance one step. `Tn` is the full n-vector of the current field (its
    // fixed entries hold the surface values that were active over [tⁿ, tⁿ⁺¹));
    // `F` is the constant load (body source + Neumann flux). Returns Tⁿ⁺¹ with
    // the Dirichlet entries set to fixedVal.
    std::vector<double> step(const std::vector<double>& Tn,
                             const std::vector<double>& F) const
    {
        std::vector<double> b = R_ * Tn;            // C/Δt − (1−θ)K applied to Tⁿ
        for (std::size_t i = 0; i < n_; ++i) b[i] += F[i];
        const std::size_t nf = free_.size();
        std::vector<double> bf(nf);
        for (std::size_t a = 0; a < nf; ++a) {
            double v = b[free_[a]];
            for (std::size_t c = 0; c < fixedIdx_.size(); ++c)  // lift fixed dofs
                v -= Afp_(a, c) * fixedVal_[fixedIdx_[c]];
            bf[a] = v;
        }
        std::vector<double> xf = llt_.solve(bf);
        std::vector<double> Tn1(n_);
        for (std::size_t i = 0; i < n_; ++i)
            Tn1[i] = isFixed_[i] ? fixedVal_[i] : 0.0;
        for (std::size_t a = 0; a < nf; ++a) Tn1[free_[a]] = xf[a];
        return Tn1;
    }

    // March `nSteps` from the initial field T0 with constant load F. If
    // `history` is non-null and snapEvery>0, pushes T0 then every snapEvery-th
    // step. Returns the final field Tᴺ.
    std::vector<double> march(std::vector<double> T, const std::vector<double>& F,
                              int nSteps, int snapEvery = 0,
                              std::vector<std::vector<double>>* history = nullptr) const
    {
        if (history && snapEvery > 0) history->push_back(T);
        for (int s = 0; s < nSteps; ++s) {
            T = step(T, F);
            if (history && snapEvery > 0 && ((s + 1) % snapEvery == 0))
                history->push_back(T);
        }
        return T;
    }

private:
    std::size_t        n_;
    double             dt_, theta_;
    std::vector<char>  isFixed_;
    std::vector<double> fixedVal_;
    std::vector<int>   free_, fixedIdx_;
    MatrixD            R_, Afp_;
    forge::native::linalg::LLT<double> llt_;
};

} // namespace forge::native::fea::transient_thermal
