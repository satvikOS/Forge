// forge-kernel — transient STRUCTURAL dynamics on the 8-node hex (Newmark-β)
//
// The continuum-FE complement to the modal eigensolver (Fea.cpp::solveModal /
// la::GeneralizedSymmetricEigen) and the rigid-body HHT-α DAE solver
// (MultibodyDynamics.cpp). It marches the SECOND-ORDER semi-discrete equation
//
//     M ü(t) + C u̇(t) + K u(t) = F(t)
//
// with the implicit, unconditionally-stable constant-average-acceleration
// Newmark scheme (γ=1/2, β=1/4). This is the header-only, OCCT-free mirror of
// Fea.cpp::solveDynamic — so the native gate (test/native/fea/
// transient_dynamics_test.cpp) can validate the integrator directly (pure C++,
// no deps) and the .node solveDynamic forwards onto the IDENTICAL primitives.
//
// REUSE (the dedup mandate — NO element math is re-derived here):
//   * stiffness  K_e = ∫ Bᵀ D B dV  — B from HexElement::fillBc (the canonical
//     6×24 strain-displacement), D from thermoelastic::buildIsotropicD (the SAME
//     6×6 isotropic Voigt constitutive Fea.cpp::buildD / solveStatic assemble).
//   * mass       M_e = ρ ∫ NᵀN dV   — the nodal 8×8 block is EXACTLY the
//     consistent-capacitance quadrature transient_thermal::elementCapacitance
//     (with rhoC←ρ) the modal solver's consistent mass is built from; we expand
//     each scalar nodal coupling M_nn(a,b) to a 3×3 translational block, exactly
//     as Fea.cpp's solveModal/solveDynamic do.
//   * linear solve — la::LLT (dense SPD, factor-once / solve-many), the posture
//     Fea.cpp's Newmark uses (SparseLDLT) and the θ-thermal integrator uses (LLT).
//   * modal cross-check — la::GeneralizedSymmetricEigen (K φ = ω² M φ), the dense
//     modal core, so the transient free-vibration period is gated against the
//     SAME eigenfrequency the modal solver returns.
//
// Newmark-β (constant average acceleration, γ=1/2, β=1/4):
//   u_{n+1} = û + βΔt² a_{n+1},   û = u_n + Δt v_n + Δt²(½−β) a_n
//   v_{n+1} = v̂ + γΔt a_{n+1},    v̂ = v_n + Δt(1−γ) a_n
//   solving the EFFECTIVE system for a_{n+1}
//     (M + γΔt C + βΔt² K) a_{n+1} = F_{n+1} − C v̂ − K û .
// The effective operator A = M + γΔt C + βΔt² K is (for a FIXED Δt) SPD on the
// free DOFs and factored ONCE; every step is a back-solve. This is the same A
// Fea.cpp::solveDynamic factors — algebraically identical to the textbook
// K̂ = K + (1/(βΔt²))M + (γ/(βΔt))C scaled through by βΔt².
//
// Rayleigh damping  C = α M + β_R K  (α,β_R exposed; both 0 ⇒ undamped). The
// known modal damping ratio is ζ_i = α/(2ω_i) + β_R ω_i/2.
//
// Dirichlet BCs are HOMOGENEOUS fixed DOFs (u=v=a=0), matching the .node dynamic
// path (which forces pinned DOFs to zero each step). All quantities SI.

#pragma once

#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/HexElement.hpp"
#include "forge/native/fea/Thermoelastic.hpp"
#include "forge/native/fea/TransientThermal.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::native::fea::transient_dynamics {

namespace la  = forge::native::linalg;
namespace hex = forge::native::fea::hex;
namespace te  = forge::native::fea::thermoelastic;
namespace tt  = forge::native::fea::transient_thermal;
using la::MatrixD;

// The element/mesh containers are shared with the transient-thermal path.
using HexMesh = tt::HexMesh;

// 2π as a literal — M_PI is not guaranteed under a strict -std=c++20 (non-GNU)
// libstdc++ build, so the kernel never relies on it.
inline constexpr double kTwoPi = 6.283185307179586476925286766559;

// ---------------------------------------------------------------------------
// Element 24×24 structural stiffness  K_e = Σ_g Bᵀ D B (w_g · det J_g).
// B = HexElement::fillBc (canonical 6×24), D = the 6×6 passed in (build it once
// with thermoelastic::buildIsotropicD(E,ν)). NO shape functions / B / D are
// re-derived here. Accumulates into Ke (must be 24×24, zero or pre-seeded) and
// returns the element volume. Throws on a degenerate (det ≤ 0) Jacobian.
inline double elementStiffness(const MatrixD& D, const double X[8][3],
                               MatrixD& Ke,
                               const char* ctx = "forge::native::fea::transient_dynamics")
{
    double elemVolume = 0;
    MatrixD B(6, 24);
    for (int g = 0; g < hex::GAUSS_COUNT; ++g) {
        const auto& gp = hex::kGauss[g];
        double dN[8][3]; hex::shapeDerivatives(gp.xi, gp.eta, gp.zeta, dN);
        double J[3][3];  hex::jacobian(dN, X, J);
        const double det = hex::det3(J);
        if (det <= 0) {
            throw std::runtime_error(std::string(ctx) +
                                     ": element Jacobian non-positive");
        }
        double Ji[3][3]; hex::inv3(J, Ji, det);
        double dNx[8][3];
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                dNx[i][j] = s;
            }
        hex::fillBc(dNx, B);                 // 6×24 compatible strain-displacement
        const double w = gp.w * det;
        MatrixD DB = D * B;                   // 6×24
        MatrixD Bt = B.transpose();           // 24×6
        MatrixD KeG = Bt * DB;                // 24×24
        for (int i = 0; i < 24; ++i)
            for (int j = 0; j < 24; ++j) Ke(i, j) += KeG(i, j) * w;
        elemVolume += w;
    }
    return elemVolume;
}

// ---------------------------------------------------------------------------
// Element 24×24 CONSISTENT mass M_e = ρ ∫ NᵀN dV. The nodal 8×8 coupling
// M_nn(a,b) = ρ ∫ N_a N_b dV is EXACTLY transient_thermal::elementCapacitance
// (rhoC←ρ) — REUSED verbatim — and each scalar coupling is expanded to a 3×3
// translational block (M_e[3a+d,3b+d] = M_nn(a,b)), exactly as Fea.cpp's
// consistent-mass assembly does. Returns the element volume.
inline double elementMassConsistent(double rho, const double X[8][3], MatrixD& Me,
                                    const char* ctx = "forge::native::fea::transient_dynamics")
{
    MatrixD Mnn(8, 8);                                  // zero-init nodal mass
    const double vol = tt::elementCapacitance(rho, X, Mnn, ctx);  // ρ∫N_aN_b dV
    for (int a = 0; a < 8; ++a)
        for (int b = 0; b < 8; ++b)
            for (int d = 0; d < 3; ++d) Me(3*a + d, 3*b + d) += Mnn(a, b);
    return vol;
}

// Element 24×24 LUMPED mass: ρV/8 on every translational DOF (the row-summed
// diagonal Fea.cpp keeps for the fast dynamic path). Returns the element volume.
inline double elementMassLumped(double rho, const double X[8][3], MatrixD& Me,
                                const char* ctx = "forge::native::fea::transient_dynamics")
{
    double diag[8];
    const double vol = tt::elementCapacitanceLumped(rho, X, diag, ctx);
    for (int a = 0; a < 8; ++a)
        for (int d = 0; d < 3; ++d) Me(3*a + d, 3*a + d) += diag[a];
    return vol;
}

// ---------------------------------------------------------------------------
// Assemble the global 3N×3N stiffness K and mass M for the hex mesh. DOF
// ordering is node-major: dof(node,d) = 3*node + d, d∈{x,y,z}. `lumpedMass`
// selects the diagonal ρV/8 mass (default: consistent, the modal-accurate one).
inline void assembleKM(const HexMesh& m, double E, double nu, double rho,
                       MatrixD& K, MatrixD& M, bool lumpedMass = false,
                       const char* ctx = "forge::native::fea::transient_dynamics")
{
    const std::size_t nDof = 3 * m.nodes.size();
    K.resize(nDof, nDof, 0.0);
    M.resize(nDof, nDof, 0.0);
    const MatrixD D = te::buildIsotropicD(E, nu);
    for (const auto& e : m.elems) {
        double X[8][3];
        for (int i = 0; i < 8; ++i) {
            const auto& nd = m.nodes[e[i]];
            X[i][0] = nd[0]; X[i][1] = nd[1]; X[i][2] = nd[2];
        }
        MatrixD Ke(24, 24), Me(24, 24);
        elementStiffness(D, X, Ke, ctx);
        if (lumpedMass) elementMassLumped(rho, X, Me, ctx);
        else            elementMassConsistent(rho, X, Me, ctx);
        for (int a = 0; a < 8; ++a)
            for (int da = 0; da < 3; ++da) {
                const std::size_t gi = 3 * e[a] + da, li = 3 * a + da;
                for (int b = 0; b < 8; ++b)
                    for (int db = 0; db < 3; ++db) {
                        const std::size_t gj = 3 * e[b] + db, lj = 3 * b + db;
                        K(gi, gj) += Ke(li, lj);
                        M(gi, gj) += Me(li, lj);
                    }
            }
    }
}

// ---------------------------------------------------------------------------
// Free/fixed DOF partition helper shared by the modal, static and dynamic paths.
inline std::vector<int> freeDofs(const std::vector<char>& fixed) {
    std::vector<int> f;
    f.reserve(fixed.size());
    for (std::size_t i = 0; i < fixed.size(); ++i) if (!fixed[i]) f.push_back(static_cast<int>(i));
    return f;
}

// ---------------------------------------------------------------------------
// Modal analysis — the lowest `nModes` eigenpairs of K φ = ω² M φ on the free
// DOFs via la::GeneralizedSymmetricEigen (THE modal core; eigenvalues ascending,
// M-orthonormal modes). Returns natural frequencies (Hz) and full-length mode
// shapes (fixed DOFs zero). This is the reference the transient free-vibration
// period is gated against.
struct ModalData {
    std::vector<double>              freqHz; // ascending
    std::vector<double>              omega;  // rad/s
    std::vector<std::vector<double>> modes;  // full-length 3N, fixed = 0
    bool ok = false;
};
inline ModalData modalAnalysis(const MatrixD& K, const MatrixD& M,
                               const std::vector<char>& fixed, int nModes)
{
    ModalData R;
    const std::vector<int> fr = freeDofs(fixed);
    const std::size_t nf = fr.size(), n = K.rows();
    MatrixD Kff(nf, nf), Mff(nf, nf);
    for (std::size_t a = 0; a < nf; ++a)
        for (std::size_t b = 0; b < nf; ++b) {
            Kff(a, b) = K(fr[a], fr[b]);
            Mff(a, b) = M(fr[a], fr[b]);
        }
    la::GeneralizedSymmetricEigen ges(Kff, Mff, true);
    R.ok = ges.ok();
    if (!R.ok) return R;
    const auto& ev = ges.eigenvalues();
    const auto& V  = ges.eigenvectors();
    const int want = std::min<int>(nModes, static_cast<int>(nf));
    for (int i = 0; i < want; ++i) {
        const double lam = ev[i] > 0 ? ev[i] : 0.0;   // clamp tiny negative round-off
        const double w   = std::sqrt(lam);
        R.omega.push_back(w);
        R.freqHz.push_back(w / kTwoPi);
        std::vector<double> mode(n, 0.0);
        for (std::size_t a = 0; a < nf; ++a) mode[fr[a]] = V(a, i);
        R.modes.push_back(std::move(mode));
    }
    return R;
}

// ---------------------------------------------------------------------------
// Static solve K u = f with homogeneous Dirichlet (free partition + dense SPD
// Cholesky) — the A/B reference the slow-ramp dynamic limit must reproduce.
inline std::vector<double> staticSolve(const MatrixD& K,
                                       const std::vector<char>& fixed,
                                       const std::vector<double>& f)
{
    const std::vector<int> fr = freeDofs(fixed);
    const std::size_t nf = fr.size(), n = K.rows();
    MatrixD Kff(nf, nf);
    std::vector<double> bf(nf);
    for (std::size_t a = 0; a < nf; ++a) {
        bf[a] = f[fr[a]];
        for (std::size_t b = 0; b < nf; ++b) Kff(a, b) = K(fr[a], fr[b]);
    }
    la::LLT<double> llt(Kff);
    std::vector<double> xf = llt.solve(bf);
    std::vector<double> u(n, 0.0);
    for (std::size_t a = 0; a < nf; ++a) u[fr[a]] = xf[a];
    return u;
}

// ---------------------------------------------------------------------------
// Newmark-β implicit transient integrator. Factor-once / solve-many: the
// effective A = M + γΔt C + βΔt² K is partitioned to the free DOFs and Cholesky-
// factored in the constructor; each step() is a single back-solve.
class NewmarkIntegrator {
public:
    // K,M global 3N×3N; Rayleigh α,β_R; fixed time step dt; homogeneous Dirichlet
    // mask `fixed`. Defaults: constant-average-acceleration (γ=½, β=¼).
    NewmarkIntegrator(const MatrixD& K, const MatrixD& M,
                      double alpha, double betaR, double dt,
                      const std::vector<char>& fixed,
                      double beta = 0.25, double gamma = 0.5)
        : n_(K.rows()), dt_(dt), beta_(beta), gamma_(gamma),
          K_(K), M_(M), fixed_(fixed)
    {
        if (!(dt > 0)) throw std::invalid_argument(
            "forge::native::fea::transient_dynamics: dt must be > 0");
        free_ = freeDofs(fixed);
        // C = α M + β_R K  (Rayleigh).
        C_.resize(n_, n_, 0.0);
        for (std::size_t i = 0; i < n_; ++i)
            for (std::size_t j = 0; j < n_; ++j)
                C_(i, j) = alpha * M_(i, j) + betaR * K_(i, j);
        // Effective A = M + γΔt C + βΔt² K, restricted to the free block.
        const std::size_t nf = free_.size();
        MatrixD Aff(nf, nf), Mff(nf, nf);
        for (std::size_t a = 0; a < nf; ++a)
            for (std::size_t b = 0; b < nf; ++b) {
                const std::size_t i = free_[a], j = free_[b];
                Aff(a, b) = M_(i, j) + (gamma_ * dt_) * C_(i, j)
                                     + (beta_ * dt_ * dt_) * K_(i, j);
                Mff(a, b) = M_(i, j);
            }
        llt_.compute(Aff);
        lltM_.compute(Mff);
        ok_ = llt_.ok() && lltM_.ok();
        u_.assign(n_, 0.0); v_.assign(n_, 0.0); a_.assign(n_, 0.0); f_.assign(n_, 0.0);
    }

    bool ok() const { return ok_; }

    // Initial state + constant load. Computes a₀ from M a₀ = F − C v₀ − K u₀ on
    // the free DOFs (fixed DOFs forced to zero throughout). Empty u0/v0/f ⇒ zero.
    void setInitial(const std::vector<double>& u0,
                    const std::vector<double>& v0,
                    const std::vector<double>& f = {})
    {
        u_.assign(n_, 0.0); v_.assign(n_, 0.0); f_.assign(n_, 0.0);
        if (!u0.empty()) for (std::size_t i = 0; i < n_; ++i) u_[i] = u0[i];
        if (!v0.empty()) for (std::size_t i = 0; i < n_; ++i) v_[i] = v0[i];
        if (!f.empty())  for (std::size_t i = 0; i < n_; ++i) f_[i] = f[i];
        for (std::size_t i = 0; i < n_; ++i) if (fixed_[i]) { u_[i] = v_[i] = f_[i] = 0; }
        // a₀: M a₀ = F − C v₀ − K u₀.
        std::vector<double> rhs = la::vsub(f_, la::vadd(C_ * v_, K_ * u_));
        a_ = solveFree_(lltM_, rhs);
        t_ = 0.0;
    }

    // Advance one step with the stored constant load.
    void step() { stepWithLoad(f_); }

    // Advance one step with an explicit (time-varying) load vector.
    void stepWithLoad(const std::vector<double>& fLoad) {
        // Predictors.
        std::vector<double> uHat = u_;            // û = u + Δt v + Δt²(½−β) a
        la::vaxpy(uHat, dt_, v_);
        la::vaxpy(uHat, dt_ * dt_ * (0.5 - beta_), a_);
        std::vector<double> vHat = v_;            // v̂ = v + Δt(1−γ) a
        la::vaxpy(vHat, dt_ * (1.0 - gamma_), a_);
        // Solve (M+γΔtC+βΔt²K) a_{n+1} = F − C v̂ − K û.
        std::vector<double> rhs = la::vsub(fLoad, la::vadd(C_ * vHat, K_ * uHat));
        std::vector<double> aNew = solveFree_(llt_, rhs);
        // Correctors.
        std::vector<double> uNew = uHat; la::vaxpy(uNew, beta_  * dt_ * dt_, aNew);
        std::vector<double> vNew = vHat; la::vaxpy(vNew, gamma_ * dt_,        aNew);
        for (std::size_t i = 0; i < n_; ++i) if (fixed_[i]) { uNew[i] = vNew[i] = aNew[i] = 0; }
        u_ = std::move(uNew); v_ = std::move(vNew); a_ = std::move(aNew);
        t_ += dt_;
    }

    double time() const { return t_; }
    const std::vector<double>& u() const { return u_; }
    const std::vector<double>& v() const { return v_; }
    double dispAt(std::size_t dof) const { return u_[dof]; }

    // Energies (fixed DOFs carry zero u,v so they contribute nothing).
    double kineticEnergy()   const { return 0.5 * la::vdot(v_, M_ * v_); }
    double potentialEnergy() const { return 0.5 * la::vdot(u_, K_ * u_); }
    double totalEnergy()     const { return kineticEnergy() + potentialEnergy(); }

private:
    // Solve A_ff x_f = rhs_f (free-partitioned dense Cholesky), lift to full DOF.
    std::vector<double> solveFree_(const la::LLT<double>& fac,
                                   const std::vector<double>& rhsFull) const {
        const std::size_t nf = free_.size();
        std::vector<double> rf(nf);
        for (std::size_t a = 0; a < nf; ++a) rf[a] = rhsFull[free_[a]];
        std::vector<double> xf = fac.solve(rf);
        std::vector<double> x(n_, 0.0);
        for (std::size_t a = 0; a < nf; ++a) x[free_[a]] = xf[a];
        return x;
    }

    std::size_t n_;
    double dt_, beta_, gamma_, t_ = 0.0;
    MatrixD K_, M_, C_;
    std::vector<char> fixed_;
    std::vector<int>  free_;
    std::vector<double> u_, v_, a_, f_;
    la::LLT<double> llt_, lltM_;
    bool ok_ = false;
};

} // namespace forge::native::fea::transient_dynamics
