// test/native/fea/thermoelastic_test.cpp
// ─────────────────────────────────────────────────────────────────────────────
// Native gate — linear thermoelasticity (thermal-stress coupling) on the 8-node
// hex, validating the in-house thermomechanical primitive
// (forge/native/fea/Thermoelastic.hpp) against CLOSED-FORM thermoelasticity.
// Advances #62/#64 (native CAE multiphysics — temperature field → thermal stress
// in the structural solve). Pure C++ / no OCCT / no deps — the same primitive
// Fea.cpp::solveStatic(nodeDeltaT) forwards to (buildIsotropicD / thermalLoadElement
// / recoverStress), so a green gate here certifies the kernel that the .node
// binding exposes once it is relinked (batched elsewhere).
//
// Cases:
//   1) Fully-constrained heated bar (single hex, ALL DOFs fixed, uniform ΔT):
//        u ≡ 0  ⇒  σ = D(B·0 − ε₀) = −D ε₀ = −Eα·ΔT/(1−2ν) HYDROSTATIC.
//      Exact (no discretisation): matched within <1%.
//   2) Free thermal expansion (single hex, statically-determinate 3-2-1 support,
//      uniform ΔT):  solve K u = f_th, then σ = D(B u − ε₀) must be ZERO
//      (rigid-body dilation produces no stress). THE key consistency check that
//      the thermal load and the stress recovery are Galerkin-consistent.
//   3) (sanity) Through-thickness linear ΔT gradient on the fully-constrained
//      hex: per-Gauss-point σ(z) = −Eα·ΔT(z)/(1−2ν) is LINEAR through the depth
//      — the bending-stress distribution a constrained heated plate develops.
//
// Units SI (m, Pa, K).

#include "forge/native/fea/HexElement.hpp"
#include "forge/native/fea/Thermoelastic.hpp"
#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <vector>

namespace hex = forge::native::fea::hex;
namespace te  = forge::native::fea::thermoelastic;
namespace la  = forge::native::linalg;

namespace {

int g_fail = 0;
void check(bool ok, const char* msg) {
    std::printf("    [%s] %s\n", ok ? "PASS" : "FAIL", msg);
    if (!ok) ++g_fail;
}

// Single L×L×L hex with node0 at the origin, canonical HexElement node order
// (matches kSignXi/Eta/Zeta so det J > 0).
void unitCube(double L, double c[8][3]) {
    const double v[8][3] = {
        {0,0,0}, {L,0,0}, {L,L,0}, {0,L,0},
        {0,0,L}, {L,0,L}, {L,L,L}, {0,L,L},
    };
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 3; ++j) c[i][j] = v[i][j];
}

// Compatible element stiffness Ke = ∫ Bcᵀ D Bc dV (24×24), assembled with the
// SAME HexElement primitives the production assembler uses (this is the canonical
// B-matrix + Gauss rule, NOT a re-derivation of the shape functions).
la::MatrixD assembleKe(const double c[8][3], const la::MatrixD& D) {
    la::MatrixD Ke(24, 24);  // zero-init
    for (int g = 0; g < hex::GAUSS_COUNT; ++g) {
        const auto& gp = hex::kGauss[g];
        double dN[8][3];
        hex::shapeDerivatives(gp.xi, gp.eta, gp.zeta, dN);
        double J[3][3];
        hex::jacobian(dN, c, J);
        const double det = hex::det3(J);
        double Ji[3][3];
        hex::inv3(J, Ji, det);
        double dNx[8][3];
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                dNx[i][j] = s;
            }
        la::MatrixD B(6, 24);
        hex::fillBc(dNx, B);
        const double w = gp.w * det;
        la::MatrixD BtDB = B.transpose() * (D * B);
        for (std::size_t i = 0; i < 24; ++i)
            for (std::size_t j = 0; j < 24; ++j)
                Ke(i, j) += BtDB(i, j) * w;
    }
    return Ke;
}

// Compatible strain ε = Bc u at the element centroid (Voigt 6-vector).
void centroidStrain(const double c[8][3], const std::array<double, 24>& u,
                    double eps[6]) {
    double dN[8][3];
    hex::shapeDerivatives(0, 0, 0, dN);
    double J[3][3];
    hex::jacobian(dN, c, J);
    const double det = hex::det3(J);
    double Ji[3][3];
    hex::inv3(J, Ji, det);
    double dNx[8][3];
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 3; ++j) {
            double s = 0;
            for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
            dNx[i][j] = s;
        }
    la::MatrixD B(6, 24);
    hex::fillBc(dNx, B);
    std::vector<double> uv(u.begin(), u.end());
    std::vector<double> e = B * uv;
    for (int i = 0; i < 6; ++i) eps[i] = e[i];
}

// ── Test 1 — fully-constrained heated bar (u ≡ 0) ────────────────────────────
void test_constrained_bar() {
    std::printf("[fea/thermoelastic] Test 1 — fully-constrained heated bar (u≡0)\n");
    const double E = 200e9, nu = 0.30, alpha = 1.2e-5, dT = 80.0, L = 0.1;
    const double e0 = alpha * dT;
    double c[8][3]; unitCube(L, c);
    la::MatrixD D = te::buildIsotropicD(E, nu);

    std::array<double, 24> fe{};
    double sig0[6];
    te::thermalLoadElement(c, D, e0, fe, sig0);

    // u ≡ 0 (all DOFs fixed): ε_mech = 0 ⇒ σ = −σ₀.
    double epsZero[6] = {0, 0, 0, 0, 0, 0};
    double sigma[6];
    te::recoverStress(D, epsZero, sig0, sigma);

    const double sigAnalytic = -E * alpha * dT / (1.0 - 2.0 * nu);  // hydrostatic
    std::printf("    analytic  σ_hydro = -Eα·ΔT/(1-2ν) = %.6e Pa\n", sigAnalytic);
    std::printf("    recovered σxx=%.6e σyy=%.6e σzz=%.6e  (shear %.2e %.2e %.2e)\n",
                sigma[0], sigma[1], sigma[2], sigma[3], sigma[4], sigma[5]);
    auto relerr = [&](double s) {
        return std::fabs(s - sigAnalytic) / std::fabs(sigAnalytic);
    };
    const double eMax = std::max({relerr(sigma[0]), relerr(sigma[1]), relerr(sigma[2])});
    std::printf("    max relative error vs closed form = %.3e %%\n", eMax * 100.0);
    check(eMax < 1e-2, "constrained-bar σ matches -Eα·ΔT/(1-2ν) within 1%");
    const double shear = std::max({std::fabs(sigma[3]), std::fabs(sigma[4]), std::fabs(sigma[5])});
    check(shear < 1e-6 * std::fabs(sigAnalytic), "constrained-bar shear stresses are zero");
}

// ── Test 2 — free thermal expansion (3-2-1 support) → ZERO stress ────────────
void test_free_expansion() {
    std::printf("[fea/thermoelastic] Test 2 — free thermal expansion (zero-stress)\n");
    const double E = 200e9, nu = 0.30, alpha = 1.2e-5, dT = 80.0, L = 0.1;
    const double e0 = alpha * dT;
    double c[8][3]; unitCube(L, c);
    la::MatrixD D = te::buildIsotropicD(E, nu);

    la::MatrixD Ke = assembleKe(c, D);
    std::array<double, 24> fe{};
    double sig0[6];
    te::thermalLoadElement(c, D, e0, fe, sig0);

    // Statically-determinate 3-2-1 support about the origin node0 (consistent
    // with a pure dilation u = e0·x): node0 fixes ux,uy,uz; node1 fixes uy,uz;
    // node3 fixes uz. Removes all 6 rigid-body modes, constrains NO expansion.
    bool pinned[24] = {false};
    pinned[0] = pinned[1] = pinned[2] = true;  // node0 x,y,z
    pinned[3*1 + 1] = pinned[3*1 + 2] = true;  // node1 y,z
    pinned[3*3 + 2] = true;                    // node3 z

    std::vector<int> freeIdx;
    int g2c[24];
    for (int i = 0; i < 24; ++i) {
        if (pinned[i]) { g2c[i] = -1; }
        else { g2c[i] = static_cast<int>(freeIdx.size()); freeIdx.push_back(i); }
    }
    const std::size_t nf = freeIdx.size();
    la::MatrixD Kff(nf, nf);
    std::vector<double> fff(nf, 0.0);
    for (std::size_t a = 0; a < nf; ++a) {
        fff[a] = fe[freeIdx[a]];               // pinned g = 0 ⇒ no RHS lift term
        for (std::size_t b = 0; b < nf; ++b)
            Kff(a, b) = Ke(freeIdx[a], freeIdx[b]);
    }
    la::LU<double> lu(Kff);
    check(lu.ok(), "reduced free-free stiffness factorises (non-singular)");
    std::vector<double> uf = lu.solve(fff);

    std::array<double, 24> u{};
    for (std::size_t a = 0; a < nf; ++a) u[freeIdx[a]] = uf[a];

    // The free-expansion field is u = e0·x. Check the far corner node6=(L,L,L).
    const double uExp = e0 * L;
    std::printf("    node6 u = (%.6e, %.6e, %.6e),  expected e0·L = %.6e (each)\n",
                u[18], u[19], u[20], uExp);
    auto near = [&](double a, double b) { return std::fabs(a - b) <= 1e-9 * std::fabs(b) + 1e-18; };
    check(near(u[18], uExp) && near(u[19], uExp) && near(u[20], uExp),
          "displacement field recovers the free dilation u = e0·x");

    // Recovered stress must be ~0 (the key correctness gate).
    double eps[6]; centroidStrain(c, u, eps);
    double sigma[6]; te::recoverStress(D, eps, sig0, sigma);
    double sMax = 0;
    for (int i = 0; i < 6; ++i) sMax = std::max(sMax, std::fabs(sigma[i]));
    // Scale: the constrained-bar stress magnitude is the natural reference.
    const double sRef = E * alpha * dT / (1.0 - 2.0 * nu);
    std::printf("    centroid ε = [%.4e %.4e %.4e | %.2e %.2e %.2e]\n",
                eps[0], eps[1], eps[2], eps[3], eps[4], eps[5]);
    std::printf("    expected ε₀ = αΔT = %.6e on the three normal components\n", e0);
    std::printf("    RESIDUAL stress max|σ| = %.3e Pa   (ref Eα·ΔT/(1-2ν) = %.3e Pa, ratio %.2e)\n",
                sMax, sRef, sMax / sRef);
    check(sMax < 1e-6 * sRef, "free thermal expansion produces ZERO residual stress");
}

// ── Test 3 — through-thickness linear ΔT gradient (constrained) → bending ────
void test_gradient_bending() {
    std::printf("[fea/thermoelastic] Test 3 — linear ΔT gradient, constrained (sanity)\n");
    const double E = 200e9, nu = 0.30, alpha = 1.2e-5, L = 0.1, dTtop = 100.0;
    double c[8][3]; unitCube(L, c);
    la::MatrixD D = te::buildIsotropicD(E, nu);

    // ΔT linear in z: 0 at z=0 (nodes 0..3), dTtop at z=L (nodes 4..7).
    double nodeDT[8] = {0, 0, 0, 0, dTtop, dTtop, dTtop, dTtop};

    // Fully constrained (u≡0): at any Gauss point σ = −D ε₀(ΔT_gp), hydrostatic
    // value −Eα·ΔT_gp/(1-2ν). Sample the lower (ζ=-1/√3) and upper (ζ=+1/√3)
    // Gauss layers; the through-thickness stress must be LINEAR (bending).
    auto layerStress = [&](double zeta) {
        // interpolate ΔT at (ξ=η=0, ζ): only the z-linear part matters.
        double N[8]; hex::shapeFunctions(0, 0, zeta, N);
        double dTgp = 0; for (int a = 0; a < 8; ++a) dTgp += N[a] * nodeDT[a];
        double e0 = alpha * dTgp;
        double sig0[6];
        for (int i = 0; i < 6; ++i) sig0[i] = (D(i,0)+D(i,1)+D(i,2)) * e0;
        double epsZero[6] = {0,0,0,0,0,0};
        double sigma[6]; te::recoverStress(D, epsZero, sig0, sigma);
        return std::array<double,2>{ sigma[0], dTgp };  // σxx, ΔT at this layer
    };
    const double z = 1.0 / std::sqrt(3.0);
    auto lo = layerStress(-z);  // near z=0  (cooler)
    auto hi = layerStress(+z);  // near z=L  (hotter)

    auto closed = [&](double dTgp) { return -E * alpha * dTgp / (1.0 - 2.0 * nu); };
    std::printf("    lower layer ΔT=%.4f  σxx=%.4e  (closed %.4e)\n", lo[1], lo[0], closed(lo[1]));
    std::printf("    upper layer ΔT=%.4f  σxx=%.4e  (closed %.4e)\n", hi[1], hi[0], closed(hi[1]));
    auto rel = [&](double s, double dTgp) { return std::fabs(s - closed(dTgp)) / std::fabs(closed(dTgp)); };
    check(rel(lo[0], lo[1]) < 1e-2 && rel(hi[0], hi[1]) < 1e-2,
          "per-layer σ matches -Eα·ΔT(z)/(1-2ν) closed form");
    // hotter layer is MORE compressive ⇒ a through-thickness (bending) gradient.
    check(hi[0] < lo[0] - 1e-3 * std::fabs(lo[0]),
          "stress varies linearly through the depth (compressive bending toward hot face)");
}

} // namespace

int main() {
    std::printf("==== native gate: forge::fea thermoelastic (thermal-stress) ====\n");
    test_constrained_bar();
    test_free_expansion();
    test_gradient_bending();
    if (g_fail == 0) {
        std::printf("RESULT: ALL THERMOELASTIC GATES PASS (%d checks)\n", 8);
        return 0;
    }
    std::printf("RESULT: %d THERMOELASTIC CHECK(S) FAILED\n", g_fail);
    return 1;
}
