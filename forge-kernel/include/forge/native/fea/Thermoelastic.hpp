// forge-kernel — shared linear-thermoelastic (thermal-stress) element kernel
//
// THE single canonical copy of the 8-node hex thermoelastic coupling that the
// structural static solver uses to turn a temperature field into thermal stress
// (#62/#64 — native CAE multiphysics). The dedup sweep flagged that Fea.cpp's
// solveStatic(nodeDeltaT) had the thermoelastic load + the σ = D(ε − ε₀) stress
// recovery inline in its private TU, where neither the native gate harness
// (pure C++, no OCCT) nor any other field solver could reach it. This header
// extracts that math — and ONLY that math — so:
//   * Fea.cpp forwards its (anonymous-namespace) buildD / thermalLoadVector here
//     → one definition, no duplication;
//   * the native gate test/native/fea/thermoelastic_test.cpp validates the
//     primitive directly against closed-form thermoelasticity.
//
// Linear thermoelasticity (isotropic, small strain):
//   thermal strain          ε₀ = α·ΔT·[1,1,1,0,0,0]ᵀ           (Voigt)
//   thermal nodal load       f_th,e = ∫_Ω Bᵀ D ε₀ dV           (initial-strain)
//   total stress recovery    σ = D (ε_mech − ε₀) = D B u − D ε₀.
//
// Element math (trilinear shape fns, Jacobian, 6×24 B-matrix, the 2×2×2 Gauss
// rule) comes from HexElement.hpp — NO shape functions / B-matrix are
// re-derived here. The constitutive D is the SAME 6×6 isotropic Voigt matrix
// Fea.cpp::buildD assembled (λ = Eν/((1+ν)(1−2ν)), μ = E/(2(1+ν))), reproduced
// here operation-for-operation so the assembled numerics are byte-identical and
// forwarding leaves every existing FEA result unchanged.

#pragma once

#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/HexElement.hpp"

#include <array>

namespace forge::native::fea::thermoelastic {

namespace hex = forge::native::fea::hex;

// ---------------------------------------------------------------------------
// 3D isotropic linear-elastic constitutive matrix D (6×6, Voigt order
// {σxx,σyy,σzz,σxy,σyz,σxz}). Byte-identical to Fea.cpp::buildD: the upper-left
// 3×3 block is λ + 2μ·δ_ij and the three shear diagonals are μ.
inline forge::native::linalg::MatrixD buildIsotropicD(double E, double nu) {
    forge::native::linalg::MatrixD D(6, 6);  // zero-initialised
    const double lam = E * nu / ((1 + nu) * (1 - 2 * nu));
    const double mu  = E / (2 * (1 + nu));
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            D(i, j) = lam + (i == j ? 2 * mu : 0);
    D(3, 3) = mu;
    D(4, 4) = mu;
    D(5, 5) = mu;
    return D;
}

// ---------------------------------------------------------------------------
// Consistent element thermal (initial-strain) load vector for the trilinear hex:
//   f_e^th = ∫ Bcᵀ D ε₀ dV ,  ε₀ = e0·[1,1,1,0,0,0],  e0 = α·ΔT̄ₑ.
// Integrated on the SAME 2×2×2 Gauss rule the stiffness uses (compatible field).
// Also returns the constant element thermal stress σ₀ = D ε₀ for the
// σ = D(ε − ε₀) recovery. `D` is the 6×6 from buildIsotropicD (passed in so the
// caller controls the material). This is byte-identical to the body that was
// inline in Fea.cpp::thermalLoadVector.
inline void thermalLoadElement(const double nodeCoords[8][3],
                               const forge::native::linalg::MatrixD& D,
                               double e0,
                               std::array<double, 24>& fe,
                               double sig0[6]) {
    fe.fill(0.0);
    for (int i = 0; i < 6; ++i) sig0[i] = (D(i, 0) + D(i, 1) + D(i, 2)) * e0;
    for (int g = 0; g < hex::GAUSS_COUNT; ++g) {
        const auto& gp = hex::kGauss[g];
        double dN[8][3];
        hex::shapeDerivatives(gp.xi, gp.eta, gp.zeta, dN);
        double J[3][3];
        hex::jacobian(dN, nodeCoords, J);
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
        const double w = gp.w * det;   // dV at this Gauss point
        // fe += Bcᵀ σ₀ · dV, expanded per node (Bc layout = HexElement::fillBc).
        for (int a = 0; a < 8; ++a) {
            const double bx = dNx[a][0], by = dNx[a][1], bz = dNx[a][2];
            fe[3*a+0] += w * (bx*sig0[0] + by*sig0[3] + bz*sig0[5]);
            fe[3*a+1] += w * (by*sig0[1] + bx*sig0[3] + bz*sig0[4]);
            fe[3*a+2] += w * (bz*sig0[2] + by*sig0[4] + bx*sig0[5]);
        }
    }
}

// ---------------------------------------------------------------------------
// Total-stress recovery for a thermoelastic point:
//   σ = D·ε_mech − σ₀ = D·(ε_mech − ε₀),
// where ε_mech (Voigt) = B u is the COMPATIBLE mechanical strain and σ₀ = D ε₀
// is the constant thermal stress returned by thermalLoadElement. This is exactly
// the subtraction solveStatic performs after elementStress (σ[i] -= σ₀[i]).
inline void recoverStress(const forge::native::linalg::MatrixD& D,
                          const double epsMechVoigt[6],
                          const double sig0[6],
                          double sigmaOut[6]) {
    for (int i = 0; i < 6; ++i) {
        double s = 0.0;
        for (int j = 0; j < 6; ++j) s += D(i, j) * epsMechVoigt[j];
        sigmaOut[i] = s - sig0[i];
    }
}

} // namespace forge::native::fea::thermoelastic
