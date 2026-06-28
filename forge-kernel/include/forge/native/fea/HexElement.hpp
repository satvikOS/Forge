// forge-kernel — shared 8-node hexahedral (brick) finite-element kernels
//
// THE single canonical copy of the trilinear 8-node hex element math that was
// previously copy-pasted, byte-for-byte, across three FEA translation units
// (src/Fea.cpp, src/FeaExtras.cpp, src/FeaContact.cpp). Each TU had re-declared
// its own anonymous-namespace copy of: the 2×2×2 (8-point) Gauss rule, the
// node-local sign table, the trilinear shape functions + their natural
// derivatives, the 3×3 isoparametric Jacobian + its determinant + inverse, and
// the compatible 6×24 strain-displacement (B) matrix. They are consolidated
// here, header-only (inline / constexpr), so all three callers share ONE
// definition.
//
// This is a BYTE-EQUIVALENT extraction: every constant, point ordering, sign
// convention and formula is reproduced EXACTLY as Fea.cpp had them (the
// most-used / canonical copy), so the assembled numerics are unchanged. The
// FeaExtras/FeaContact copies were already byte-identical (only the local
// helper names differed); those TUs now forward their old names here.
//
// Node ordering (canonical OCCT / Abaqus convention):
//        7-------6
//       /|      /|
//      4-------5 |
//      | 3-----|-2
//      |/      |/
//      0-------1
//   ξ axis : 0→1, η axis : 0→3, ζ axis : 0→4
// Local natural coordinates (ξ,η,ζ) ∈ [-1,1]³ with shape functions
//   N_i(ξ,η,ζ) = 1/8 (1+ξ_i ξ)(1+η_i η)(1+ζ_i ζ).

#pragma once

#include "forge/native/linalg/LinAlg.hpp"

#include <array>

namespace forge::native::fea::hex {

// ----------------------------------------------------------- Gauss rule
//
// 2×2×2 Gauss rule (8 points, all weights 1.0) at ±1/√3, in the canonical
// point order Fea.cpp used.
inline constexpr double GAUSS_PT    = 0.5773502691896258; // 1/√3
inline constexpr int    GAUSS_COUNT = 8;

struct GaussPoint { double xi, eta, zeta, w; };

inline constexpr std::array<GaussPoint, GAUSS_COUNT> kGauss{{
    {-GAUSS_PT,-GAUSS_PT,-GAUSS_PT,1.0},
    { GAUSS_PT,-GAUSS_PT,-GAUSS_PT,1.0},
    { GAUSS_PT, GAUSS_PT,-GAUSS_PT,1.0},
    {-GAUSS_PT, GAUSS_PT,-GAUSS_PT,1.0},
    {-GAUSS_PT,-GAUSS_PT, GAUSS_PT,1.0},
    { GAUSS_PT,-GAUSS_PT, GAUSS_PT,1.0},
    { GAUSS_PT, GAUSS_PT, GAUSS_PT,1.0},
    {-GAUSS_PT, GAUSS_PT, GAUSS_PT,1.0},
}};

// Node-local sign pattern: same indexing as the diagram above.
inline constexpr int kSignXi  [8] = {-1, 1, 1,-1,-1, 1, 1,-1};
inline constexpr int kSignEta [8] = {-1,-1, 1, 1,-1,-1, 1, 1};
inline constexpr int kSignZeta[8] = {-1,-1,-1,-1, 1, 1, 1, 1};

// ----------------------------------------------------------- shape funcs
//
// Trilinear shape functions N_i(ξ,η,ζ).
inline void shapeFunctions(double xi, double eta, double zeta, double N[8]) {
    for (int i = 0; i < 8; ++i) {
        N[i] = 0.125 * (1 + kSignXi[i]*xi)
                     * (1 + kSignEta[i]*eta)
                     * (1 + kSignZeta[i]*zeta);
    }
}

// Returns ∂N/∂(ξ,η,ζ): 8×3 with row i = (dN_i/dξ, dN_i/dη, dN_i/dζ).
inline void shapeDerivatives(double xi, double eta, double zeta, double dN[8][3]) {
    for (int i = 0; i < 8; ++i) {
        const double a = kSignXi[i],   xa = 1 + a*xi;
        const double b = kSignEta[i],  yb = 1 + b*eta;
        const double c = kSignZeta[i], zc = 1 + c*zeta;
        dN[i][0] = 0.125 * a * yb * zc;
        dN[i][1] = 0.125 * b * xa * zc;
        dN[i][2] = 0.125 * c * xa * yb;
    }
}

// ----------------------------------------------------------- Jacobian
//
// Build the 3×3 Jacobian J = ∂(x,y,z)/∂(ξ,η,ζ) at one Gauss point.
inline void jacobian(const double dN[8][3], const double nodeCoords[8][3],
                     double J[3][3]) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) {
            double s = 0;
            for (int k = 0; k < 8; ++k) s += dN[k][i] * nodeCoords[k][j];
            J[i][j] = s;
        }
}

inline double det3(const double J[3][3]) {
    return J[0][0]*(J[1][1]*J[2][2] - J[1][2]*J[2][1])
         - J[0][1]*(J[1][0]*J[2][2] - J[1][2]*J[2][0])
         + J[0][2]*(J[1][0]*J[2][1] - J[1][1]*J[2][0]);
}

inline void inv3(const double J[3][3], double Ji[3][3], double det) {
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

// --------------------------------------------------- strain-displacement B
//
// Fill the compatible 6×24 strain-displacement matrix Bc from dN/dx (8×3).
// Voigt layout: rows = [εxx, εyy, εzz, γxy, γyz, γxz]. This is byte-identical
// to Fea.cpp's former fillBc and FeaContact.cpp's former buildB.
inline void fillBc(const double dNx[8][3], forge::native::linalg::MatrixD& B) {
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
}

} // namespace forge::native::fea::hex
