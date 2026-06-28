// forge-kernel — shared scalar-elliptic (−∇·(c∇u)=f) element assembler
//
// THE single canonical Laplacian-type element-stiffness kernel for every solver
// whose operator is the scalar elliptic −∇·(c∇u)=f. The dedup sweep flagged that
// steady thermal conduction (c = thermal conductivity k), axisymmetric
// magnetostatics (c = reluctivity weighting ν/r), electrostatics (c = permittivity
// ε) and steady current-conduction (c = conductivity σ) all assemble the SAME
// element stiffness
//
//     K_e^{ij} = ∫_Ω c (∇N_i)·(∇N_j) dΩ
//
// on the 8-node hex. This header extracts that assembly out of FeaExtras.cpp's
// solveThermal so the queued field solvers reuse ONE definition instead of
// re-deriving the Laplacian. Element math (shape functions/derivatives, Jacobian,
// inverse, Gauss rule) comes from HexElement.hpp — NO shape functions are
// re-derived here.
//
// BYTE-EQUIVALENT extraction: elementStiffness() and gradientAt() reproduce the
// exact floating-point operations, in the exact order, that solveThermal used for
// its element stiffness and its centroid flux recovery — so refactoring the
// thermal path onto them leaves every assembled number unchanged.

#pragma once

#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/HexElement.hpp"

#include <stdexcept>
#include <string>

namespace forge::native::fea::scalar_elliptic {

namespace hex = forge::native::fea::hex;

// ---------------------------------------------------------------------------
// Element 8×8 stiffness for a CONSTANT coefficient c:
//   K_e^{ij} = Σ_g c (∇N_i)·(∇N_j) (w_g · det J_g)
// Accumulates into Ke (which must already be an 8×8, zero or pre-seeded as the
// caller intends) and returns the element volume Σ_g (w_g · det J_g). Throws
// std::runtime_error("<ctx>: element Jacobian non-positive") on a degenerate
// Gauss-point Jacobian (det ≤ 0).
//
// This is byte-identical to the inner loop solveThermal used (c plays the role of
// mat.k, identical multiply order c·s·w), so the thermal path is numerically
// unchanged after refactoring onto it.
inline double elementStiffness(double c,
                               const double X[8][3],
                               forge::native::linalg::MatrixD& Ke,
                               const char* ctx = "forge::native::fea::scalar_elliptic")
{
    double elemVolume = 0;
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
        // Build dN/dx (8×3).
        double dNx[8][3];
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                dNx[i][j] = s;
            }
        // K_e^{ij} += c Σ (∇N_i)·(∇N_j) det w.
        const double w = gp.w * det;
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 8; ++j) {
                const double s = dNx[i][0] * dNx[j][0]
                               + dNx[i][1] * dNx[j][1]
                               + dNx[i][2] * dNx[j][2];
                Ke(i, j) += c * s * w;
            }
        elemVolume += w;
    }
    return elemVolume;
}

// ---------------------------------------------------------------------------
// Element 8×8 stiffness + consistent source for a SPATIALLY-VARYING coefficient.
// At each Gauss point the coefficient c = coeffAt(x,y,z) and the volumetric source
// density s = srcAt(x,y,z) are evaluated at the physical Gauss-point position
// (x,y,z) (interpolated through the shape functions). Accumulates
//   Ke(i,j) += c (∇N_i)·(∇N_j) w     and     fe[i] += s N_i w   (w = w_g det J_g)
// returning the element volume. Used by axisymmetric magnetostatics with
// c = ν/(T·r) (the 1/r weighting) and s = J_φ/T on a thin Cartesian slab of
// thickness T, whose t-integration supplies the factor T. fe must point at 8
// doubles; it is zero-initialised here.
template <class CoeffFn, class SrcFn>
inline double elementStiffnessVar(CoeffFn&& coeffAt, SrcFn&& srcAt,
                                  const double X[8][3],
                                  forge::native::linalg::MatrixD& Ke,
                                  double fe[8],
                                  const char* ctx = "forge::native::fea::scalar_elliptic")
{
    for (int i = 0; i < 8; ++i) fe[i] = 0.0;
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
        double Ji[3][3]; hex::inv3(J, Ji, det);
        double dNx[8][3];
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                dNx[i][j] = s;
            }
        // Physical Gauss-point position (for coefficient + source evaluation).
        double px = 0, py = 0, pz = 0;
        for (int i = 0; i < 8; ++i) {
            px += N[i] * X[i][0];
            py += N[i] * X[i][1];
            pz += N[i] * X[i][2];
        }
        const double c   = coeffAt(px, py, pz);
        const double src = srcAt(px, py, pz);
        const double w   = gp.w * det;
        for (int i = 0; i < 8; ++i) {
            for (int j = 0; j < 8; ++j) {
                const double s = dNx[i][0] * dNx[j][0]
                               + dNx[i][1] * dNx[j][1]
                               + dNx[i][2] * dNx[j][2];
                Ke(i, j) += c * s * w;
            }
            fe[i] += src * N[i] * w;
        }
        elemVolume += w;
    }
    return elemVolume;
}

// ---------------------------------------------------------------------------
// ∇u at natural coordinates (ξ,η,ζ) from the 8 nodal values uNodal and the
// element node coords X (physical-space gradient). Byte-identical to the
// single-Gauss-point gradient recovery solveThermal used for nodal flux
// (q = −k∇T), and reused by the magnetostatic B = curl A post-process.
inline void gradientAt(double xi, double eta, double zeta,
                       const double X[8][3], const double uNodal[8],
                       double grad[3])
{
    double dN[8][3]; hex::shapeDerivatives(xi, eta, zeta, dN);
    double J[3][3];  hex::jacobian(dN, X, J);
    double Ji[3][3]; hex::inv3(J, Ji, hex::det3(J));
    double dNx[8][3];
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 3; ++j) {
            double s = 0;
            for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
            dNx[i][j] = s;
        }
    grad[0] = 0; grad[1] = 0; grad[2] = 0;
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 3; ++j) grad[j] += dNx[i][j] * uNodal[i];
}

} // namespace forge::native::fea::scalar_elliptic
