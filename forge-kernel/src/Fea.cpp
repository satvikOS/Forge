#include "forge/Fea.hpp"

#include <BRepBndLib.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <Precision.hxx>
#include <TopAbs_State.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <stdexcept>
#include <vector>

// PHASE-D wiring (2026-06-25) — route the ONE FEA mesh-DOMAIN construction op in this
// module, meshFromBRep's per-voxel domain build (the shape's BOUNDING BOX that sizes
// the hex grid + the POINT-IN-SOLID test that keeps the voxels whose centroid lies
// inside the solid), through the ALREADY-BUILT in-house native B-rep ops behind the
// FEAT gate:
//   * BRepBndLib::Add / Bnd_Box      -> forge::native::brep::computeAabb  (exact analytic
//                                       model-space AABB of a native Solid)
//   * BRepClass3d_SolidClassifier    -> forge::native::brep::pointInSolid (even-odd ray
//                                       cast over the watertight boundary triangles)
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT
// gate forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B
// harness's setForgeNativeBrepEnabled(true)). PRODUCTION DEFAULT IS OFF: with the gate
// off the original OCCT path below (BRepBndLib + BRepClass3d_SolidClassifier) runs
// byte-for-byte unchanged. Mirrors the prior wires (Cam.cpp / Healing.cpp /
// CamAdvanced.cpp / Drawings.cpp). PHASE-D ACTIVATION (2026-06-25): tryNativeMeshFromBRep
// now takes the native branch on BOTH a NativeSolid handle AND an OCCT-backed
// (ShapeKind::Occt) handle, the latter imported into a native analytic Solid via
// forge::importOcctSolid (src/OcctImport.cpp) before the AABB + point-in-solid run. SAFE
// + HONEST: if importOcctSolid defers (ok==false: NURBS/Torus/non-analytic) the helper
// returns false and the OCCT path runs, byte-identical to today. The native build emits
// the SAME
// hex grid (same Nmax/hSnap snapping, same (Nx,Ny,Nz), same lazy node de-dup, same
// nodeToFace AABB bitfield) so the resulting Mesh is structurally identical to OCCT's;
// only the bbox + inside-test backends differ.
//
// The solvers (solveStatic / solveModal / solveDynamic) do NO OCCT geometry — they take
// a Mesh and run pure in-house linear algebra (forge::native::linalg) — so they have NO
// native geometry target and are left UNWIRED (not a gap; there is nothing to route).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Topology.hpp"      // Solid graph
#include "forge/native/brep/Aabb.hpp"          // computeAabb (native AABB)
#include "forge/native/brep/Query.hpp"         // pointInSolid (native point classify)
#include "forge/native/brep/Surface.hpp"       // Vec3
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
#endif

namespace la = forge::native::linalg;

namespace forge::fea {

namespace {

// ----------------------------------------------------------- dense helpers
//
// The in-house la::MatrixD has no Matrix*scalar operator and no in-place
// scaled-accumulate (Eigen's `A * w` and `C.noalias() += X * w`). These tiny
// helpers replicate exactly those operations element-wise so the assembled
// numerics are identical to the prior Eigen expressions. `matScale(A, w)`
// returns A*w; `addScaled(dst, src, w)` performs dst += src*w in place.
inline la::MatrixD matScale(const la::MatrixD& A, double w) {
    la::MatrixD R(A.rows(), A.cols());
    for (std::size_t i = 0; i < A.rows(); ++i)
        for (std::size_t j = 0; j < A.cols(); ++j)
            R(i, j) = A(i, j) * w;
    return R;
}
inline void addScaled(la::MatrixD& dst, const la::MatrixD& src, double w) {
    for (std::size_t i = 0; i < dst.rows(); ++i)
        for (std::size_t j = 0; j < dst.cols(); ++j)
            dst(i, j) += src(i, j) * w;
}

// ---------------------------------------------------------------- hex element
//
// 8-node linear hex (brick). Node ordering follows the canonical OCCT /
// Abaqus convention:
//        7-------6
//       /|      /|
//      4-------5 |
//      | 3-----|-2
//      |/      |/
//      0-------1
//   ξ axis : 0→1, η axis : 0→3, ζ axis : 0→4
//
// Local natural coordinates (ξ,η,ζ) ∈ [-1,1]³ with shape functions
//   N_i(ξ,η,ζ) = 1/8 (1+ξ_i ξ)(1+η_i η)(1+ζ_i ζ).

constexpr double GAUSS_PT = 0.5773502691896258; // 1/√3
constexpr int    GAUSS_COUNT = 8;

struct GaussPoint { double xi, eta, zeta, w; };
constexpr std::array<GaussPoint, GAUSS_COUNT> kGauss{{
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
constexpr int kSignXi  [8] = {-1, 1, 1,-1,-1, 1, 1,-1};
constexpr int kSignEta [8] = {-1,-1, 1, 1,-1,-1, 1, 1};
constexpr int kSignZeta[8] = {-1,-1,-1,-1, 1, 1, 1, 1};

inline void shapeFunctions(double xi, double eta, double zeta,
                           double N[8]) {
    for (int i = 0; i < 8; ++i) {
        N[i] = 0.125 * (1 + kSignXi[i]*xi)
                     * (1 + kSignEta[i]*eta)
                     * (1 + kSignZeta[i]*zeta);
    }
}

// Returns ∂N/∂(ξ,η,ζ): 8×3 with row i = (dN_i/dξ, dN_i/dη, dN_i/dζ).
inline void shapeDerivatives(double xi, double eta, double zeta,
                             double dN[8][3]) {
    for (int i = 0; i < 8; ++i) {
        const double a = kSignXi[i],   xa = 1 + a*xi;
        const double b = kSignEta[i],  yb = 1 + b*eta;
        const double c = kSignZeta[i], zc = 1 + c*zeta;
        dN[i][0] = 0.125 * a * yb * zc;
        dN[i][1] = 0.125 * b * xa * zc;
        dN[i][2] = 0.125 * c * xa * yb;
    }
}

// ------------------------------------------------------- incompatible modes
//
// Wilson/Taylor Q6 incompatible-modes hex (UPGRADE: kills first-order shear
// locking). Three internal "bubble" shape functions are added on top of the
// 8 trilinear ones:
//     P1 = 1 - ξ²,  P2 = 1 - η²,  P3 = 1 - ζ²
// each carrying 3 internal DOFs (x,y,z) → 9 incompatible DOFs α. These curve
// the element so a single brick through the bending depth recovers near-exact
// pure-bending strain energy instead of locking up in spurious shear.
//
// ∂P/∂(ξ,η,ζ):  P1 → (-2ξ,0,0), P2 → (0,-2η,0), P3 → (0,0,-2ζ).
inline void incompatDerivativesNatural(double xi, double eta, double zeta,
                                       double dP[3][3]) {
    // dP[m][·] = ∂P_m/∂(ξ,η,ζ)
    dP[0][0] = -2.0 * xi;  dP[0][1] = 0.0;        dP[0][2] = 0.0;
    dP[1][0] = 0.0;        dP[1][1] = -2.0 * eta; dP[1][2] = 0.0;
    dP[2][0] = 0.0;        dP[2][1] = 0.0;        dP[2][2] = -2.0 * zeta;
}

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

// ---- material matrix (3D isotropic linear elasticity) ----
// D is 6×6 in Voigt form (σ_xx, σ_yy, σ_zz, σ_xy, σ_yz, σ_xz).
la::MatrixD buildD(const Material& mat) {
    la::MatrixD D(6, 6);  // zero-initialised
    const double lam = mat.E * mat.nu / ((1 + mat.nu) * (1 - 2 * mat.nu));
    const double mu  = mat.E / (2 * (1 + mat.nu));
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            D(i, j) = lam + (i == j ? 2 * mu : 0);
    D(3, 3) = mu;
    D(4, 4) = mu;
    D(5, 5) = mu;
    return D;
}

// ---- element K, lumped M, and consistent M ----
//
// Returns K_e (24×24), the lumped M_e diagonal (24 entries), AND the full
// 24×24 consistent mass M_e = ρ ∫ Nᵀ N dV. Each row of K_e corresponds to a
// node DOF in order [u₀x,u₀y,u₀z, u₁x,...].
//
// Consistent mass (UPGRADE A — cuts hex modal error from ~24%):
//   The 8-node trilinear hex consistent mass is M_e = ρ ∫_Ω Nᵀ N dV, where N
//   is the 3×24 shape-function matrix (each scalar N_a expanded to a 3×3 block
//   N_a·I₃ so all three translational DOFs share the same shape function). The
//   integral is evaluated with the SAME 2×2×2 Gauss rule the stiffness uses, so
//   the inertia distribution is exactly consistent with the stiffness
//   integration. Because the off-diagonal nodal coupling (ρ∫N_aN_b dV, a≠b) is
//   retained — instead of being lumped onto the diagonal — the modal solve sees
//   the true mass distribution and the first bending frequency drops toward the
//   Euler–Bernoulli value. M_e is a Gram matrix (∫NᵀN), hence symmetric
//   positive-definite, which the GeneralizedSelfAdjointEigenSolver (Ax_lBx,
//   Cholesky on M) requires.
// Fill the compatible 6×24 strain-displacement matrix Bc from dN/dx (8×3).
inline void fillBc(const double dNx[8][3], la::MatrixD& B) {
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

// Fill the incompatible 6×9 strain-displacement matrix Bi from dP/dx (3×3).
// Column block m (m=0,1,2) holds the x,y,z DOFs of incompatible mode P_m.
inline void fillBi(const double dPx[3][3], la::MatrixD& Bi) {
    Bi.setZero();
    for (int m = 0; m < 3; ++m) {
        const int c = 3 * m;
        const double bx = dPx[m][0];
        const double by = dPx[m][1];
        const double bz = dPx[m][2];
        Bi(0, c    ) = bx;
        Bi(1, c + 1) = by;
        Bi(2, c + 2) = bz;
        Bi(3, c    ) = by; Bi(3, c + 1) = bx;
        Bi(4, c + 1) = bz; Bi(4, c + 2) = by;
        Bi(5, c    ) = bz; Bi(5, c + 2) = bx;
    }
}

// Holds the per-element incompatible-mode condensation operators needed to
// recover the internal DOFs α = T·d at stress time:  T = -Kii⁻¹·Kicᵀ (9×24),
// plus the centre Jacobian inverse + det used to map the incompatible natural
// derivatives to physical space (Taylor's centre-point correction).
struct IncompatOps {
    la::MatrixD T{9, 24};                   // α = T · d_compatible
    double Ji0[3][3];                       // J(0)⁻¹  (element centre)
    double detJ0;                           // det J(0)
    bool   valid = false;
};

// ---- element K, lumped M, and consistent M ----
//
// Returns the condensed K_e (24×24), the lumped M_e diagonal (24 entries), the
// full 24×24 consistent mass M_e = ρ ∫ Nᵀ N dV, and (optionally) the
// incompatible-mode recovery operator. Each row of K_e corresponds to a node
// DOF in order [u₀x,u₀y,u₀z, u₁x,...].
//
// Incompatible-modes hex (Wilson Q6 / Taylor 1976) — kills shear locking:
//   On top of the 8 trilinear shape functions we add three internal "bubble"
//   modes P1=1-ξ², P2=1-η², P3=1-ζ² (9 internal DOFs α). The element stiffness
//   is assembled over both fields:
//       Kcc = ∫ Bcᵀ D Bc dV   (24×24)
//       Kci = ∫ Bcᵀ D Bi dV   (24×9)
//       Kii = ∫ Biᵀ D Bi dV   ( 9×9)
//   The internal α are statically condensed at the element level (they couple
//   no neighbour, the bubbles vanishing on every face):
//       Ke = Kcc - Kci · Kii⁻¹ · Kciᵀ.
//   Taylor's correction evaluates the incompatible derivatives with the
//   element-CENTRE Jacobian J(0) scaled by det J(0)/det J(g); this is what
//   lets the element pass the constant-strain patch test (and is exact for the
//   parallelepiped grid bricks the mesher emits). The result: a single element
//   through the bending depth no longer locks — pure-bending strain energy is
//   captured, so static tip deflection error collapses from ~35% to a few %
//   and the modal bending frequency (which the locking inflated) drops onto the
//   Euler–Bernoulli value.
//
// Consistent mass (M_e = ρ ∫ NᵀN dV) is integrated on the SAME 2×2×2 Gauss
// rule from the trilinear functions only (the bubble modes carry no mass — they
// are quasi-static internal DOFs), so the inertia distribution stays consistent
// with the displacement interpolation and is SPD for the Ax_lBx Cholesky.
void buildElement(const double nodeCoords[8][3],
                  const la::MatrixD& D,
                  double rho,
                  la::MatrixD& Ke,
                  std::array<double, 24>& Me_diag,
                  la::MatrixD& Me_consistent,
                  IncompatOps* incompat = nullptr) {
    Ke.setZero();
    Me_diag.fill(0);
    Me_consistent.setZero();

    // ---- centre Jacobian for Taylor's incompatible-mode correction ----
    double dN0[8][3];
    shapeDerivatives(0.0, 0.0, 0.0, dN0);
    double J0[3][3];
    jacobian(dN0, nodeCoords, J0);
    const double detJ0 = det3(J0);
    if (detJ0 <= 0) {
        throw std::runtime_error(
            "forge.fea: element centre Jacobian non-positive — degenerate brick");
    }
    double Ji0[3][3];
    inv3(J0, Ji0, detJ0);

    la::MatrixD Kcc(24, 24);  // zero-initialised
    la::MatrixD Kci(24,  9);
    la::MatrixD Kii( 9,  9);

    double elemVolume = 0;
    // Accumulate the 8×8 nodal consistent-mass blocks Mnn(a,b) = ρ∫N_a N_b dV.
    la::MatrixD Mnn(8, 8);  // zero-initialised
    for (int g = 0; g < GAUSS_COUNT; ++g) {
        const auto& gp = kGauss[g];
        double dN[8][3];
        shapeDerivatives(gp.xi, gp.eta, gp.zeta, dN);
        double J[3][3];
        jacobian(dN, nodeCoords, J);
        const double det = det3(J);
        if (det <= 0) {
            throw std::runtime_error(
                "forge.fea: element Jacobian non-positive — degenerate brick");
        }
        double Ji[3][3];
        inv3(J, Ji, det);

        // Build dN/dx: 8×3 = dN/dξ · J⁻¹.
        double dNx[8][3];
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
                dNx[i][j] = s;
            }

        // Build compatible B: 6 × 24.
        // Voigt layout: rows = [εxx, εyy, εzz, γxy, γyz, γxz]
        la::MatrixD B(6, 24);
        fillBc(dNx, B);

        // Build incompatible Bi: 6 × 9. Taylor's correction: map the natural
        // incompatible derivatives with the CENTRE Jacobian inverse Ji0 and
        // scale the quadrature by detJ0/detJ so the element passes the
        // constant-strain patch test.
        double dP[3][3];
        incompatDerivativesNatural(gp.xi, gp.eta, gp.zeta, dP);
        double dPx[3][3];
        for (int m = 0; m < 3; ++m)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dP[m][k] * Ji0[k][j];
                dPx[m][j] = s;
            }
        la::MatrixD Bi(6, 9);
        fillBi(dPx, Bi);

        const double w  = gp.w * det;       // compatible quadrature weight
        const double wi = gp.w * detJ0;     // incompatible weight (centre detJ)
        addScaled(Kcc, B.transpose()  * D * B,  w);
        // Cross + internal blocks use the consistent incompatible weight wi so
        // the patch test holds on distorted (here, perfectly regular) bricks.
        addScaled(Kci, B.transpose()  * D * Bi, wi);
        addScaled(Kii, Bi.transpose() * D * Bi, wi);
        elemVolume += w;

        // Consistent-mass quadrature: accumulate ρ·N_a·N_b·detJ·w_g.
        // Use the SAME trilinear shape functions evaluated at this Gauss point.
        double N[8];
        shapeFunctions(gp.xi, gp.eta, gp.zeta, N);
        const double wm = rho * w; // ρ · detJ · w_g
        for (int a = 0; a < 8; ++a)
            for (int b = 0; b < 8; ++b)
                Mnn(a, b) += wm * N[a] * N[b];
    }

    // Static condensation of the 9 internal incompatible DOFs:
    //   Ke = Kcc - Kci · Kii⁻¹ · Kciᵀ.
    // Kii is SPD (∫ Biᵀ D Bi with D SPD and Bi full-rank), so LLT is stable.
    la::LLT<double> llt(Kii);
    if (llt.ok()) {
        la::MatrixD KiiInvKic = llt.solve(Kci.transpose());
        Ke = Kcc - Kci * KiiInvKic;
        if (incompat) {
            // T = -Kii⁻¹·Kicᵀ · d
            incompat->T = matScale(KiiInvKic, -1.0);
            for (int r = 0; r < 3; ++r)
                for (int c = 0; c < 3; ++c) incompat->Ji0[r][c] = Ji0[r][c];
            incompat->detJ0 = detJ0;
            incompat->valid = true;
        }
    } else {
        // Degenerate Kii (should not happen for a valid brick): fall back to the
        // compatible-only stiffness rather than producing garbage.
        Ke = Kcc;
        if (incompat) incompat->valid = false;
    }

    // Expand each scalar nodal-mass coupling Mnn(a,b) to a 3×3 block
    // diag(Mnn(a,b)) so x/y/z translational DOFs each carry that coupling.
    for (int a = 0; a < 8; ++a)
        for (int b = 0; b < 8; ++b)
            for (int d = 0; d < 3; ++d)
                Me_consistent(3 * a + d, 3 * b + d) = Mnn(a, b);

    // Lumped mass = (ρ V / 8) on every translational DOF of every node.
    // Kept for solveDynamic (diagonal mass → trivial Newmark inversion) and as
    // an optional fallback for solveModal.
    const double nodalMass = rho * elemVolume / 8.0;
    for (int i = 0; i < 24; ++i) Me_diag[i] = nodalMass;
}

// Compute σ at element centroid (single Gauss-point evaluation at (0,0,0)).
// Returns 6-vector in Voigt form.
//
// When `incompat` is supplied (and valid) the incompatible-mode contribution
// is added to the strain: ε = Bc·d + Bi·α, with α = T·d recovered from the
// condensed internal DOFs and Bi mapped through the centre Jacobian (Taylor).
// At the centroid the incompatible derivatives ∂P/∂(ξ,η,ζ) all vanish
// (∂(1-ξ²)/∂ξ = -2ξ = 0 at ξ=0), so Bi(centre)=0 and the bubble contribution to
// the *centroidal* stress is zero — but evaluating it explicitly keeps the path
// correct if the sampling point is ever moved off-centre, and documents intent.
std::vector<double> elementStress(
    const double nodeCoords[8][3],
    const la::MatrixD& D,
    const std::array<double, 24>& uElem,
    const IncompatOps* incompat = nullptr)
{
    double dN[8][3];
    shapeDerivatives(0.0, 0.0, 0.0, dN);
    double J[3][3];
    jacobian(dN, nodeCoords, J);
    const double det = det3(J);
    double Ji[3][3];
    inv3(J, Ji, det);

    double dNx[8][3];
    for (int i = 0; i < 8; ++i)
        for (int j = 0; j < 3; ++j) {
            double s = 0;
            for (int k = 0; k < 3; ++k) s += dN[i][k] * Ji[k][j];
            dNx[i][j] = s;
        }
    la::MatrixD B(6, 24);
    fillBc(dNx, B);
    std::vector<double> ue(24);
    for (int i = 0; i < 24; ++i) ue[i] = uElem[i];
    std::vector<double> eps = B * ue;

    if (incompat && incompat->valid) {
        // Incompatible derivatives at the centroid, mapped via the centre
        // Jacobian inverse (Taylor). dP(0)=0 → Bi(centre)=0, so this adds zero
        // at (0,0,0); included for correctness if the sample point moves.
        double dP[3][3];
        incompatDerivativesNatural(0.0, 0.0, 0.0, dP);
        double dPx[3][3];
        for (int m = 0; m < 3; ++m)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += dP[m][k] * incompat->Ji0[k][j];
                dPx[m][j] = s;
            }
        la::MatrixD Bi(6, 9);
        fillBi(dPx, Bi);
        std::vector<double> alpha = incompat->T * ue;
        la::vaxpy(eps, 1.0, Bi * alpha);    // eps += Bi * alpha
    }
    return D * eps;
}

inline double vonMisesFromVoigt(const std::vector<double>& s) {
    const double sx = s[0], sy = s[1], sz = s[2];
    const double txy = s[3], tyz = s[4], txz = s[5];
    const double dxy = sx - sy;
    const double dyz = sy - sz;
    const double dxz = sx - sz;
    return std::sqrt(0.5 * (dxy*dxy + dyz*dyz + dxz*dxz
                            + 6.0 * (txy*txy + tyz*tyz + txz*txz)));
}

// ---- assembly ----
//
// Assemble K and lumped M for the whole mesh. `dofMap` is identity
// (3*nodeId + axis); we only collapse it during the BC-elimination step.
//
// la::SparseCSR is assembled once from triplets and exposes no post-assembly
// mutation API (no InnerIterator / valueRef / coeffRef / prune that Eigen's
// SparseMatrix offered). The BC-elimination step (applyPinnedBCs) therefore
// operates on the RAW TRIPLET lists, which we retain here, and rebuilds the CSR
// from the filtered triplets. setFromTriplets sums duplicates exactly as the
// element scatter did, so the assembled matrix is numerically identical to the
// prior Eigen path; we keep the assembled CSR here too for the no-BC consumers.
struct AssembledSystem {
    la::SparseCSR<double>          K;
    std::vector<la::Triplet<double>> kTrips;       // raw stiffness triplets (for BCs)
    std::vector<double>            Mdiag;          // lumped mass vector (full DOF length)
    la::SparseCSR<double>          Mconsistent;    // full consistent mass (only when requested)
    std::vector<la::Triplet<double>> mTrips;       // raw consistent-mass triplets (for BCs)
    bool                           hasConsistent = false;
    std::size_t                    nDof;
    // Per-element incompatible-mode recovery operators (one per element, same
    // order as mesh.tets). Populated only when `withIncompatOps` is requested
    // (the static/dynamic stress-recovery paths); empty otherwise.
    std::vector<IncompatOps>       incompat;
};

// `withConsistentMass`: when true, additionally assemble the global consistent
// mass matrix M = ρ ∫ NᵀN dV (UPGRADE A). Static/dynamic paths leave it false
// to avoid the extra sparse assembly; only the modal path requests it.
AssembledSystem assemble(const Mesh& mesh, const Material& mat,
                         bool withConsistentMass = false,
                         bool withIncompatOps = false) {
    const std::size_t nNodes = mesh.nodes.size() / 3;
    const std::size_t nElems = mesh.tets.size() / mesh.elemNodeCount;
    const std::size_t nDof   = 3 * nNodes;

    la::MatrixD D = buildD(mat);

    AssembledSystem sys;
    sys.Mdiag.assign(nDof, 0.0);
    sys.nDof  = nDof;
    sys.hasConsistent = withConsistentMass;
    if (withIncompatOps) sys.incompat.resize(nElems);

    std::vector<la::Triplet<double>>& trips = sys.kTrips;
    trips.reserve(nElems * 24 * 24);
    std::vector<la::Triplet<double>>& mTrips = sys.mTrips;
    if (withConsistentMass) {
        mTrips.reserve(nElems * 24 * 24);
    }

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
        la::MatrixD Ke(24, 24);
        std::array<double, 24> Me;
        la::MatrixD Mc(24, 24);
        buildElement(nodeCoords, D, mat.rho, Ke, Me, Mc,
                     withIncompatOps ? &sys.incompat[e] : nullptr);

        // Scatter into global K + lumped M (+ consistent M when requested).
        for (int i = 0; i < 8; ++i) {
            for (int ai = 0; ai < 3; ++ai) {
                const int gi = 3 * nodeIds[i] + ai;
                const int li = 3 * i + ai;
                sys.Mdiag[gi] += Me[li];
                for (int j = 0; j < 8; ++j) {
                    for (int aj = 0; aj < 3; ++aj) {
                        const int gj = 3 * nodeIds[j] + aj;
                        const int lj = 3 * j + aj;
                        const double v = Ke(li, lj);
                        if (std::abs(v) > 0) {
                            trips.emplace_back(gi, gj, v);
                        }
                        if (withConsistentMass) {
                            const double mv = Mc(li, lj);
                            if (std::abs(mv) > 0) {
                                mTrips.emplace_back(gi, gj, mv);
                            }
                        }
                    }
                }
            }
        }
    }
    sys.K.setFromTriplets(nDof, nDof, trips);
    if (withConsistentMass) {
        sys.Mconsistent.setFromTriplets(nDof, nDof, mTrips);
    }
    return sys;
}

// ---- BC application ----
//
// Replace the row + column of each pinned DOF with the identity, and set the
// corresponding entry of the RHS to zero (i.e. constraint u = 0 on that DOF).
//
// Eigen mutated the assembled SparseMatrix in place (InnerIterator zeroing of
// pinned rows/cols, coeffRef(i,i)=1, prune+makeCompressed). la::SparseCSR has
// no such post-assembly mutation, so we perform the IDENTICAL transformation on
// the RAW TRIPLET lists and rebuild the CSR: drop every triplet whose row OR
// col is pinned, then append (i,i,1) for each pinned DOF. setFromTriplets sums
// duplicates exactly as the element scatter did, so the rebuilt matrix has the
// same nonzero values the Eigen zero+set+prune produced (zeroed entries simply
// never appear; the pinned diagonal is exactly 1).
//
// Returns the set of pinned DOF indices for later residual checking.
std::vector<int> applyPinnedBCs(la::SparseCSR<double>& K,
                                std::vector<la::Triplet<double>>& kTrips,
                                std::vector<double>& f,
                                std::vector<double>* Mdiag,
                                const Mesh& mesh,
                                const std::vector<BCPinned>& bcs,
                                la::SparseCSR<double>* Mconsistent = nullptr,
                                std::vector<la::Triplet<double>>* mTrips = nullptr)
{
    std::vector<int> pinned;
    const int nDof = static_cast<int>(K.rows());
    std::vector<bool> isPinned(nDof, false);

    for (const auto& bc : bcs) {
        const int base = 3 * bc.nodeId;
        if (bc.fx) isPinned[base + 0] = true;
        if (bc.fy) isPinned[base + 1] = true;
        if (bc.fz) isPinned[base + 2] = true;
    }
    for (int i = 0; i < nDof; ++i) if (isPinned[i]) pinned.push_back(i);

    // Sparse row/col elimination — triplet level. Drop every stiffness triplet
    // touching a pinned row or column (equivalent to Eigen's InnerIterator
    // valueRef()=0), then append the unit diagonal for each pinned DOF.
    {
        std::vector<la::Triplet<double>> kept;
        kept.reserve(kTrips.size() + pinned.size());
        for (const auto& t : kTrips) {
            const int r = static_cast<int>(t.row);
            const int c = static_cast<int>(t.col);
            if (isPinned[r] || isPinned[c]) continue;
            kept.push_back(t);
        }
        // K.coeffRef(i,i) = 1.0 for each pinned DOF.
        for (int i : pinned) kept.emplace_back(i, i, 1.0);
        kTrips.swap(kept);
        K.setFromTriplets(static_cast<std::size_t>(nDof),
                          static_cast<std::size_t>(nDof), kTrips);
    }

    // Apply the SAME row/col elimination to the consistent mass so the pinned
    // DOFs decouple from the structural modes. Putting 1.0 on the pinned mass
    // diagonal (matching the 1.0 on the K diagonal) yields a spurious eigenvalue
    // of exactly 1 rad²/s² per pinned DOF, which the modal filter discards; it
    // also keeps M symmetric positive-definite so the Ax_lBx Cholesky succeeds.
    if (Mconsistent && mTrips) {
        std::vector<la::Triplet<double>> kept;
        kept.reserve(mTrips->size() + pinned.size());
        for (const auto& t : *mTrips) {
            const int r = static_cast<int>(t.row);
            const int c = static_cast<int>(t.col);
            if (isPinned[r] || isPinned[c]) continue;
            kept.push_back(t);
        }
        // Mconsistent->coeffRef(i,i) = 1.0 for each pinned DOF.
        for (int i : pinned) kept.emplace_back(i, i, 1.0);
        mTrips->swap(kept);
        Mconsistent->setFromTriplets(static_cast<std::size_t>(nDof),
                                     static_cast<std::size_t>(nDof), *mTrips);
    }

    for (int i : pinned) {
        f[i] = 0.0;
        if (Mdiag) (*Mdiag)[i] = 1.0; // 1 keeps generalised eigenproblem regular
    }
    (void)mesh;
    return pinned;
}

// ---- pressure → equivalent nodal forces (simplified) ----
//
// For each AABB face touched by the pressure load, distribute the total
// pressure × area as equal lumped forces along the inward-facing nodes.
// Faces correspond to: 0=-X, 1=+X, 2=-Y, 3=+Y, 4=-Z, 5=+Z.
//
// This is a deliberate simplification for the brick-grid mesher; a proper
// face-integration step is straightforward once the mesher carries explicit
// surface-element data (follow-up slice).
void applyPressureLoads(std::vector<double>& f, const Mesh& mesh,
                        const std::vector<LoadPressure>& loads) {
    if (loads.empty()) return;
    const std::size_t nNodes = mesh.nodes.size() / 3;
    if (mesh.nodeToFace.size() != nNodes) return;

    // Compute AABB.
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
    const int faceAxis[6]    = { 0, 0, 1, 1, 2, 2 };
    const double faceSign[6] = {-1, 1,-1, 1,-1, 1};

    for (const auto& pl : loads) {
        if (pl.faceId >= 6) continue;
        // Collect nodes on this face.
        std::vector<std::size_t> faceNodes;
        for (std::size_t i = 0; i < nNodes; ++i) {
            if (mesh.nodeToFace[i] & (1u << pl.faceId)) faceNodes.push_back(i);
        }
        if (faceNodes.empty()) continue;
        const double totalForce = pl.pressure * faceArea[pl.faceId];
        const double perNode    = totalForce / static_cast<double>(faceNodes.size());
        const int    axis = faceAxis[pl.faceId];
        const double dir  = faceSign[pl.faceId]; // outward sign; pressure pushes inward against it
        for (std::size_t i : faceNodes) {
            f[3*i + axis] += -perNode * dir;
        }
    }
}

} // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Try the native AABB + native point-in-solid for meshFromBRep's hex-grid domain
// build. Returns true + fills `out` (an identically-structured voxel-clipped hex Mesh)
// on success; returns false (NEVER throws) when the native path HONESTLY DEFERS so the
// caller falls through to the OCCT BRepBndLib / BRepClass3d_SolidClassifier path. Same
// deferral contract as Cam.cpp::tryNativeInwardOffset / Healing.cpp::tryNativeHeal /
// CamAdvanced.cpp::tryNativeGenerateCmm.
//
// Deferral cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * the input is a NativeMesh, or an OCCT-backed body whose importOcctSolid defers
//     (ok==false: NURBS/Torus/non-analytic) -> the whole call defers to OCCT, exactly
//     as the gate-off default behaves.
//   * the native AABB is void_ (empty solid) -> defer; OCCT owns the empty-shape throw.
//
// The grid construction below is LINE-FOR-LINE the same as the OCCT path's (same
// Lmax-based Nmax/hSnap snapping, same axisCount -> (Nx,Ny,Nz), same dx/dy/dz, same
// inside-test fallback offset retry, same lazy getOrAddNode de-dup with the same hex
// node order, same nodeToFace AABB-face bitfield). ONLY the two backends differ:
//   bbox   : BRepBndLib::Add/Bnd_Box      -> brep::computeAabb(solid)
//   inside : BRepClass3d_SolidClassifier  -> brep::pointInSolid(solid, p)
// On an On/Inside classification the voxel is kept (matching OCCT's TopAbs_IN||ON).
bool tryNativeMeshFromBRep(ShapeHandle h, double targetElemSize, Mesh& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // Resolve the input to a native analytic Solid. A NativeSolid handle is used
    // directly; PHASE-D ACTIVATION (2026-06-25) — an OCCT-backed (ShapeKind::Occt)
    // handle is IMPORTED via forge::importOcctSolid (analytic box/cyl/cone/sphere/
    // prism + analytic-boolean results) so the native AABB + point-in-solid hex grid
    // runs on it. SAFE: importOcctSolid ok==false (NURBS/Torus/non-analytic) -> defer
    // to OCCT. `imported` keeps the imported topology alive for this call.
    ImportResult imported;
    const Solid* solidPtr = nullptr;
    if (reg.kindOf(h) == ShapeKind::NativeSolid) {
        solidPtr = &reg.getNativeSolid(h);
    } else if (reg.kindOf(h) == ShapeKind::Occt) {
        imported = importOcctSolid(reg.get(h));
        if (!imported.ok || imported.solid == nullptr) return false;  // defer to OCCT
        solidPtr = imported.solid;
    } else {
        return false;   // NativeMesh -> no analytic Solid -> defer to OCCT
    }
    const Solid& solid = *solidPtr;

    const Aabb3 bb = computeAabb(solid);
    if (bb.void_) return false;                                  // empty -> defer to OCCT

    const double xmin = bb.minX, ymin = bb.minY, zmin = bb.minZ;
    const double xmax = bb.maxX, ymax = bb.maxY, zmax = bb.maxZ;

    const double Lx = xmax - xmin;
    const double Ly = ymax - ymin;
    const double Lz = zmax - zmin;

    // Snap element size against the longest axis (identical to the OCCT path).
    const double Lmax = std::max({Lx, Ly, Lz});
    int Nmax = std::max(1, static_cast<int>(std::round(Lmax / targetElemSize)));
    const double hSnap = Lmax / Nmax;

    auto axisCount = [&](double L) {
        return std::max(1, static_cast<int>(std::round(L / hSnap)));
    };
    const int Nx = axisCount(Lx);
    const int Ny = axisCount(Ly);
    const int Nz = axisCount(Lz);

    const double dx = Lx / Nx;
    const double dy = Ly / Ny;
    const double dz = Lz / Nz;

    // First pass: tag which voxels survive the native even-odd inside test.
    std::vector<bool> alive(static_cast<std::size_t>(Nx) * Ny * Nz, false);
    auto cellIdx = [&](int i, int j, int k) {
        return ((std::size_t)i * Ny + j) * Nz + k;
    };
    for (int i = 0; i < Nx; ++i) {
        for (int j = 0; j < Ny; ++j) {
            for (int k = 0; k < Nz; ++k) {
                Vec3 c{ xmin + (i + 0.5) * dx,
                        ymin + (j + 0.5) * dy,
                        zmin + (k + 0.5) * dz };
                const PointClass st = pointInSolid(solid, c, 1e-7);
                if (st == PointClass::Inside || st == PointClass::On) {
                    alive[cellIdx(i, j, k)] = true;
                }
            }
        }
    }
    // Fallback: same small-offset retry the OCCT path uses before declaring empty.
    bool any = false;
    for (bool b : alive) { if (b) { any = true; break; } }
    if (!any) {
        for (int i = 0; i < Nx && !any; ++i) {
            for (int j = 0; j < Ny && !any; ++j) {
                for (int k = 0; k < Nz; ++k) {
                    Vec3 c{ xmin + (i + 0.5) * dx + 1e-6,
                            ymin + (j + 0.5) * dy + 1e-6,
                            zmin + (k + 0.5) * dz + 1e-6 };
                    const PointClass st = pointInSolid(solid, c, 1e-5);
                    if (st == PointClass::Inside || st == PointClass::On) {
                        alive[cellIdx(i, j, k)] = true;
                        any = true;
                    }
                }
            }
        }
    }
    if (!any) {
        // No voxel inside — defer to OCCT, which owns the descriptive throw (the
        // native path must NOT throw; returning false yields the identical error).
        return false;
    }

    // Second pass: emit unique nodes + 8-node hex element list (identical to OCCT).
    const int nx1 = Nx + 1, ny1 = Ny + 1, nz1 = Nz + 1;
    const std::size_t nodeCount = static_cast<std::size_t>(nx1) * ny1 * nz1;
    std::vector<int> nodeIdx(nodeCount, -1);
    auto nIdx = [&](int i, int j, int k) {
        return ((std::size_t)i * ny1 + j) * nz1 + k;
    };

    Mesh mesh;
    mesh.elemNodeCount = 8;

    auto getOrAddNode = [&](int i, int j, int k) -> std::uint32_t {
        const auto idx = nIdx(i, j, k);
        if (nodeIdx[idx] < 0) {
            nodeIdx[idx] = static_cast<int>(mesh.nodes.size() / 3);
            mesh.nodes.push_back(xmin + i * dx);
            mesh.nodes.push_back(ymin + j * dy);
            mesh.nodes.push_back(zmin + k * dz);
        }
        return static_cast<std::uint32_t>(nodeIdx[idx]);
    };

    for (int i = 0; i < Nx; ++i) {
        for (int j = 0; j < Ny; ++j) {
            for (int k = 0; k < Nz; ++k) {
                if (!alive[cellIdx(i, j, k)]) continue;
                std::uint32_t n[8] = {
                    getOrAddNode(i,   j,   k),
                    getOrAddNode(i+1, j,   k),
                    getOrAddNode(i+1, j+1, k),
                    getOrAddNode(i,   j+1, k),
                    getOrAddNode(i,   j,   k+1),
                    getOrAddNode(i+1, j,   k+1),
                    getOrAddNode(i+1, j+1, k+1),
                    getOrAddNode(i,   j+1, k+1),
                };
                for (int q = 0; q < 8; ++q) mesh.tets.push_back(n[q]);
            }
        }
    }

    // Per-node AABB-face bitfield (identical to OCCT).
    mesh.nodeToFace.assign(mesh.nodes.size() / 3, 0u);
    for (int i = 0; i < nx1; ++i) {
        for (int j = 0; j < ny1; ++j) {
            for (int k = 0; k < nz1; ++k) {
                const auto idx = nIdx(i, j, k);
                if (nodeIdx[idx] < 0) continue;
                const auto nid = static_cast<std::uint32_t>(nodeIdx[idx]);
                std::uint32_t mask = 0;
                if (i == 0)   mask |= (1u << 0);
                if (i == Nx)  mask |= (1u << 1);
                if (j == 0)   mask |= (1u << 2);
                if (j == Ny)  mask |= (1u << 3);
                if (k == 0)   mask |= (1u << 4);
                if (k == Nz)  mask |= (1u << 5);
                mesh.nodeToFace[nid] = mask;
            }
        }
    }
    out = std::move(mesh);
    return true;
}

} // namespace
#endif

// ----------------------------------------------------------------- mesh
//
// Builds an axis-aligned hex grid clipped to the shape's bounding box.
// Voxels whose centroid is inside the solid (per BRepClass3d_SolidClassifier)
// are kept; node deduplication uses an Nx*Ny*Nz dense lookup so neighbouring
// voxels share corner nodes.
Mesh meshFromBRep(ShapeHandle h, double targetElemSize) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native AABB + even-odd point-in-solid domain build is opt-in via the
    // FEAT gate (default OFF). When on AND the input is a NativeSolid, build the hex
    // grid via brep::computeAabb + brep::pointInSolid; otherwise fall through to OCCT
    // (an OCCT-backed input HONESTLY DEFERS — no behavior change in the default build).
    // A false return == defer. The same input-validation throws below still guard the
    // OCCT path; the native pre-flight only intercepts the geometry domain build.
    if (native::brep::forgeNativeFeaturesEnabled() && targetElemSize > 0) {
        Mesh nativeMesh;
        if (tryNativeMeshFromBRep(h, targetElemSize, nativeMesh)) return nativeMesh;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::invalid_argument("forge.fea.meshFromBRep: null shape");
    }
    if (!(targetElemSize > 0)) {
        throw std::invalid_argument("forge.fea.meshFromBRep: targetElemSize must be > 0");
    }

    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    const double Lx = xmax - xmin;
    const double Ly = ymax - ymin;
    const double Lz = zmax - zmin;

    // Snap element size against the longest axis so the brick remains a
    // simple cube.
    const double Lmax = std::max({Lx, Ly, Lz});
    int Nmax = std::max(1, static_cast<int>(std::round(Lmax / targetElemSize)));
    const double hSnap = Lmax / Nmax;

    auto axisCount = [&](double L) {
        return std::max(1, static_cast<int>(std::round(L / hSnap)));
    };
    const int Nx = axisCount(Lx);
    const int Ny = axisCount(Ly);
    const int Nz = axisCount(Lz);

    const double dx = Lx / Nx;
    const double dy = Ly / Ny;
    const double dz = Lz / Nz;

    BRepClass3d_SolidClassifier clf(shape);

    // First pass: tag which voxels survive the inside test.
    std::vector<bool> alive(static_cast<std::size_t>(Nx) * Ny * Nz, false);
    auto cellIdx = [&](int i, int j, int k) {
        return ((std::size_t)i * Ny + j) * Nz + k;
    };
    for (int i = 0; i < Nx; ++i) {
        for (int j = 0; j < Ny; ++j) {
            for (int k = 0; k < Nz; ++k) {
                gp_Pnt c(xmin + (i + 0.5) * dx,
                         ymin + (j + 0.5) * dy,
                         zmin + (k + 0.5) * dz);
                clf.Perform(c, 1e-7);
                const auto st = clf.State();
                if (st == TopAbs_IN || st == TopAbs_ON) {
                    alive[cellIdx(i, j, k)] = true;
                }
            }
        }
    }
    // Fallback: if the AABB happens to be aligned to the shape (e.g. raw Box
    // primitive), the inside test may still return OUT for boundary-edge
    // centroids due to OCCT tolerances at integer grid positions. Try a
    // small offset before declaring the mesh empty.
    bool any = false;
    for (bool b : alive) { if (b) { any = true; break; } }
    if (!any) {
        for (int i = 0; i < Nx && !any; ++i) {
            for (int j = 0; j < Ny && !any; ++j) {
                for (int k = 0; k < Nz; ++k) {
                    gp_Pnt c(xmin + (i + 0.5) * dx + 1e-6,
                             ymin + (j + 0.5) * dy + 1e-6,
                             zmin + (k + 0.5) * dz + 1e-6);
                    clf.Perform(c, 1e-5);
                    const auto st = clf.State();
                    if (st == TopAbs_IN || st == TopAbs_ON) {
                        alive[cellIdx(i, j, k)] = true;
                        any = true;
                    }
                }
            }
        }
    }
    if (!any) {
        throw std::runtime_error(
            "forge.fea.meshFromBRep: no voxel centroid inside the solid — "
            "shape too small relative to targetElemSize");
    }

    // Second pass: emit unique nodes + 8-node hex element list.
    // Node grid is (Nx+1) × (Ny+1) × (Nz+1).
    const int nx1 = Nx + 1, ny1 = Ny + 1, nz1 = Nz + 1;
    const std::size_t nodeCount = static_cast<std::size_t>(nx1) * ny1 * nz1;
    std::vector<int> nodeIdx(nodeCount, -1);
    auto nIdx = [&](int i, int j, int k) {
        return ((std::size_t)i * ny1 + j) * nz1 + k;
    };

    Mesh mesh;
    mesh.elemNodeCount = 8;

    // Walk live voxels; emit nodes lazily.
    auto getOrAddNode = [&](int i, int j, int k) -> std::uint32_t {
        const auto idx = nIdx(i, j, k);
        if (nodeIdx[idx] < 0) {
            nodeIdx[idx] = static_cast<int>(mesh.nodes.size() / 3);
            mesh.nodes.push_back(xmin + i * dx);
            mesh.nodes.push_back(ymin + j * dy);
            mesh.nodes.push_back(zmin + k * dz);
        }
        return static_cast<std::uint32_t>(nodeIdx[idx]);
    };

    // Hex node order matches kSign{Xi,Eta,Zeta} so the element K builder
    // computes a positive-determinant Jacobian.
    //   local 0 = (i,   j,   k)   (-ξ,-η,-ζ)
    //   local 1 = (i+1, j,   k)   (+ξ,-η,-ζ)
    //   local 2 = (i+1, j+1, k)   (+ξ,+η,-ζ)
    //   local 3 = (i,   j+1, k)   (-ξ,+η,-ζ)
    //   local 4 = (i,   j,   k+1) (-ξ,-η,+ζ)
    //   local 5 = (i+1, j,   k+1) (+ξ,-η,+ζ)
    //   local 6 = (i+1, j+1, k+1) (+ξ,+η,+ζ)
    //   local 7 = (i,   j+1, k+1) (-ξ,+η,+ζ)
    for (int i = 0; i < Nx; ++i) {
        for (int j = 0; j < Ny; ++j) {
            for (int k = 0; k < Nz; ++k) {
                if (!alive[cellIdx(i, j, k)]) continue;
                std::uint32_t n[8] = {
                    getOrAddNode(i,   j,   k),
                    getOrAddNode(i+1, j,   k),
                    getOrAddNode(i+1, j+1, k),
                    getOrAddNode(i,   j+1, k),
                    getOrAddNode(i,   j,   k+1),
                    getOrAddNode(i+1, j,   k+1),
                    getOrAddNode(i+1, j+1, k+1),
                    getOrAddNode(i,   j+1, k+1),
                };
                for (int q = 0; q < 8; ++q) mesh.tets.push_back(n[q]);
            }
        }
    }

    // Per-node AABB-face bitfield. Bit 0=-X face (i=0), 1=+X (i=Nx),
    // 2=-Y, 3=+Y, 4=-Z, 5=+Z.
    mesh.nodeToFace.assign(mesh.nodes.size() / 3, 0u);
    for (int i = 0; i < nx1; ++i) {
        for (int j = 0; j < ny1; ++j) {
            for (int k = 0; k < nz1; ++k) {
                const auto idx = nIdx(i, j, k);
                if (nodeIdx[idx] < 0) continue;
                const auto nid = static_cast<std::uint32_t>(nodeIdx[idx]);
                std::uint32_t mask = 0;
                if (i == 0)   mask |= (1u << 0);
                if (i == Nx)  mask |= (1u << 1);
                if (j == 0)   mask |= (1u << 2);
                if (j == Ny)  mask |= (1u << 3);
                if (k == 0)   mask |= (1u << 4);
                if (k == Nz)  mask |= (1u << 5);
                mesh.nodeToFace[nid] = mask;
            }
        }
    }
    return mesh;
}

// ---------------------------------------------------------- solveStatic
StaticResult solveStatic(const Mesh& mesh, const Material& mat,
                         const std::vector<LoadNodal>&    loads,
                         const std::vector<LoadPressure>& pressureLoads,
                         const std::vector<BCPinned>&     bcs)
{
    auto sys = assemble(mesh, mat, /*withConsistentMass=*/false,
                        /*withIncompatOps=*/true);
    const int nDof = static_cast<int>(sys.nDof);

    std::vector<double> f(nDof, 0.0);
    for (const auto& L : loads) {
        const int base = 3 * static_cast<int>(L.nodeId);
        if (base + 2 >= nDof) {
            throw std::out_of_range(
                "forge.fea.solveStatic: nodal load references missing node");
        }
        f[base + 0] += L.fx;
        f[base + 1] += L.fy;
        f[base + 2] += L.fz;
    }
    applyPressureLoads(f, mesh, pressureLoads);
    // Keep an unmodified copy of f for residual reporting.
    std::vector<double> fOrig = f;
    auto pinned = applyPinnedBCs(sys.K, sys.kTrips, f, nullptr, mesh, bcs);

    la::SparseLDLT ldlt(sys.K);
    if (!ldlt.ok()) {
        throw std::runtime_error("forge.fea.solveStatic: LDLT factorisation failed");
    }
    std::vector<double> u = ldlt.solve(f);
    if (!ldlt.ok()) {
        throw std::runtime_error("forge.fea.solveStatic: LDLT solve failed");
    }

    // Compute residual on the reduced system (skip pinned rows since we
    // forced them to identity).
    std::vector<double> r = la::vsub(sys.K * u, f);
    for (int i : pinned) r[i] = 0;
    const double residual = la::normInf(r);

    // ---- per-element von-Mises ----
    StaticResult result;
    result.u.assign(u.begin(), u.begin() + nDof);
    result.residual = residual;

    const std::size_t nElems = mesh.tets.size() / 8;
    result.vonMises.assign(nElems, 0.0);
    la::MatrixD D = buildD(mat);
    double maxVM = 0;
    std::uint32_t maxAt = 0;
    for (std::size_t e = 0; e < nElems; ++e) {
        double nodeCoords[8][3];
        std::array<double, 24> ue{};
        for (int i = 0; i < 8; ++i) {
            const std::uint32_t nid = mesh.tets[e * 8 + i];
            nodeCoords[i][0] = mesh.nodes[3 * nid + 0];
            nodeCoords[i][1] = mesh.nodes[3 * nid + 1];
            nodeCoords[i][2] = mesh.nodes[3 * nid + 2];
            for (int a = 0; a < 3; ++a) ue[3*i + a] = u[3*nid + a];
        }
        const IncompatOps* iop =
            (e < sys.incompat.size()) ? &sys.incompat[e] : nullptr;
        auto sigma = elementStress(nodeCoords, D, ue, iop);
        const double vm = vonMisesFromVoigt(sigma);
        result.vonMises[e] = vm;
        if (vm > maxVM) { maxVM = vm; maxAt = static_cast<std::uint32_t>(e); }
    }
    result.maxVonMises = maxVM;
    result.maxAtElem   = maxAt;
    return result;
}

// ---------------------------------------------------------- solveModal
//
// Solve K φ = ω² M φ. We pin BCs by row/col elimination and put 1's on
// the diagonal of both K and M for pinned DOFs — that gives a spurious
// eigenvalue of 1 (rad²/s²) per pinned DOF, which we discard by skipping
// modes whose eigenvector is supported only on pinned DOFs.
//
// Dense GeneralizedSelfAdjointEigenSolver for simplicity; documented cap
// of ~1500 DOFs. The cantilever smoke is well under that.
//
// UPGRADE A: modal now defaults to the CONSISTENT mass matrix
// M = ρ∫NᵀN dV (full 24×24 per element, off-diagonal nodal coupling retained)
// instead of the lumped ρV/8 diagonal. The consistent mass distributes inertia
// in agreement with the trilinear interpolation, which removes the systematic
// over-prediction of the first bending frequency (≈24% with the lumped mass)
// and brings the cantilever f₁ toward the Euler–Bernoulli value. The lumped
// path is preserved behind `kUseConsistentMass` purely as a fallback/diagnostic.
ModalResult solveModal(const Mesh& mesh, const Material& mat,
                       const std::vector<BCPinned>& bcs, int nModes)
{
    if (nModes <= 0) {
        throw std::invalid_argument("forge.fea.solveModal: nModes must be ≥ 1");
    }
    // Default: consistent mass (physically accurate). Flip to false to recover
    // the legacy lumped-mass behaviour for comparison/diagnostics.
    constexpr bool kUseConsistentMass = true;

    auto sys = assemble(mesh, mat, /*withConsistentMass=*/kUseConsistentMass);
    const int nDof = static_cast<int>(sys.nDof);
    if (nDof > 1500) {
        // Soft warning via exception text — caller can catch + retry on a
        // coarser mesh. We keep this strict to avoid silently wasting CPU.
        throw std::runtime_error(
            "forge.fea.solveModal: nDof exceeds dense-eigen cap (1500). "
            "Coarsen the mesh or wait for the subspace-iteration upgrade.");
    }

    std::vector<double> dummyF(nDof, 0.0);
    auto pinned = applyPinnedBCs(
        sys.K, sys.kTrips, dummyF, &sys.Mdiag, mesh, bcs,
        kUseConsistentMass ? &sys.Mconsistent : nullptr,
        kUseConsistentMass ? &sys.mTrips : nullptr);
    std::vector<bool> isPinned(nDof, false);
    for (int i : pinned) isPinned[i] = true;

    la::MatrixD Kd = sys.K.toDense();
    la::MatrixD Md;
    if (kUseConsistentMass) {
        // Dense consistent mass (SPD after pinning → Ax_lBx Cholesky valid).
        Md = sys.Mconsistent.toDense();
    } else {
        Md = la::MatrixD(nDof, nDof);  // zero-initialised
        for (int i = 0; i < nDof; ++i) Md(i, i) = sys.Mdiag[i];
    }

    la::GeneralizedSymmetricEigen eig(Kd, Md, /*computeVectors=*/true);
    if (!eig.ok()) {
        throw std::runtime_error("forge.fea.solveModal: eigensolver failed");
    }
    const std::vector<double>& vals = eig.eigenvalues();
    const la::MatrixD& vecs = eig.eigenvectors();

    // Filter spurious pinned-DOF modes: a true structural mode has
    // significant displacement on at least one free DOF.
    ModalResult result;
    result.nModes = 0;
    for (int m = 0; m < static_cast<int>(vals.size()) && result.nModes < nModes; ++m) {
        const double lam = vals[m];
        if (lam < -1e-3) continue; // negative → numerical noise; skip
        double normFree = 0, normPinned = 0;
        for (int i = 0; i < nDof; ++i) {
            const double v = vecs(i, m);
            (isPinned[i] ? normPinned : normFree) += v * v;
        }
        if (normFree < 1e-12) continue; // pure pinned-DOF mode
        // Discard modes whose eigenvalue is suspiciously close to 1
        // (default pinned diagonal); the genuine first natural frequency of
        // a steel cantilever beam is ~10⁵ rad²/s² so a 1 rad²/s² mode is
        // certainly spurious.
        if (std::abs(lam - 1.0) < 1e-3 && normPinned > 10 * normFree) continue;

        const double w2 = std::max(0.0, lam);
        result.eigenvalues.push_back(w2);
        std::vector<double> phi(nDof);
        for (int i = 0; i < nDof; ++i) phi[i] = vecs(i, m);
        result.eigenvectors.push_back(std::move(phi));
        result.nModes++;
    }
    return result;
}

// ---------------------------------------------------------- solveDynamic
//
// Newmark-β with β=1/4, γ=1/2 (constant-average-acceleration scheme):
//
//   u_{n+1} = u_n + Δt v_n + Δt² ((1/2 − β) a_n + β a_{n+1})
//   v_{n+1} = v_n + Δt ((1−γ) a_n + γ a_{n+1})
//
// At each step we solve for a_{n+1} via the effective system
//   (M + γΔt C + βΔt² K) a_{n+1} = f_{n+1} − C v̂ − K û
// where
//   û = u_n + Δt v_n + Δt² (1/2 − β) a_n
//   v̂ = v_n + Δt (1 − γ) a_n
//
// Rayleigh damping C = α M + β_R K. The factorisation depends only on dt,
// α, β_R, K and M; it's done once and reused for every step.
DynamicResult solveDynamic(const Mesh& mesh, const Material& mat,
                           const std::vector<LoadNodal>& loads,
                           const std::vector<BCPinned>&  bcs,
                           double tEnd, double dt,
                           double alpha, double betaR)
{
    // Forward to the options overload with historical defaults: zero initial
    // conditions, lumped mass. (Keeps the existing 8-arg ABI intact.)
    return solveDynamic(mesh, mat, loads, bcs, tEnd, dt, alpha, betaR,
                        DynamicOptions{});
}

DynamicResult solveDynamic(const Mesh& mesh, const Material& mat,
                           const std::vector<LoadNodal>& loads,
                           const std::vector<BCPinned>&  bcs,
                           double tEnd, double dt,
                           double alpha, double betaR,
                           const DynamicOptions& opts)
{
    if (!(dt > 0)) {
        throw std::invalid_argument("forge.fea.solveDynamic: dt must be > 0");
    }
    if (!(tEnd > 0)) {
        throw std::invalid_argument("forge.fea.solveDynamic: tEnd must be > 0");
    }
    auto startWall = std::chrono::steady_clock::now();

    // Assemble K (+ optionally the consistent mass M = ρ∫NᵀN dV used by the
    // modal solver, so a transient period matches the modal frequency).
    auto sys = assemble(mesh, mat, /*withConsistentMass=*/opts.useConsistentMass,
                        /*withIncompatOps=*/true);
    const int nDof = static_cast<int>(sys.nDof);

    if ((!opts.u0.empty() && static_cast<int>(opts.u0.size()) != nDof) ||
        (!opts.v0.empty() && static_cast<int>(opts.v0.size()) != nDof)) {
        throw std::invalid_argument(
            "forge.fea.solveDynamic: u0/v0 length must equal 3*nodeCount");
    }

    // External force vector (constant step load throughout the simulation).
    std::vector<double> fStep(nDof, 0.0);
    for (const auto& L : loads) {
        const int base = 3 * static_cast<int>(L.nodeId);
        fStep[base + 0] += L.fx;
        fStep[base + 1] += L.fy;
        fStep[base + 2] += L.fz;
    }

    // Apply BCs: zero rows/cols on K and replace the mass with 1 on pinned DOFs.
    // When the consistent mass is in play, eliminate it the same way modal does
    // so the pinned DOFs decouple identically.
    std::vector<double> dummyF(nDof, 0.0);
    auto pinned = applyPinnedBCs(
        sys.K, sys.kTrips, dummyF, &sys.Mdiag, mesh, bcs,
        opts.useConsistentMass ? &sys.Mconsistent : nullptr,
        opts.useConsistentMass ? &sys.mTrips : nullptr);
    std::vector<bool> isPinned(nDof, false);
    for (int i : pinned) isPinned[i] = true;
    // Zero pinned DOFs in fStep.
    for (int i : pinned) fStep[i] = 0;

    // Build the mass matrix the integrator sees: the eliminated consistent mass
    // (sparse, off-diagonal coupling) or the lumped diagonal.
    la::SparseCSR<double> M(nDof, nDof);
    if (opts.useConsistentMass) {
        M = sys.Mconsistent;
    } else {
        std::vector<la::Triplet<double>> trips;
        trips.reserve(nDof);
        for (int i = 0; i < nDof; ++i) trips.emplace_back(i, i, sys.Mdiag[i]);
        M.setFromTriplets(static_cast<std::size_t>(nDof),
                          static_cast<std::size_t>(nDof), trips);
    }

    // C = α M + βR K  (Rayleigh). Assembled at the triplet level — la::SparseCSR
    // has no operator+/scalar-multiply, so we densify the two operands once,
    // combine, and re-emit the CSR (the matrices here are the moderate-DOF
    // dense-eigen-capped systems, so this is exact and bounded). The result is
    // numerically identical to αM + βR K.
    la::SparseCSR<double> C(nDof, nDof);
    {
        la::MatrixD Mden = M.toDense();
        la::MatrixD Kden = sys.K.toDense();
        std::vector<la::Triplet<double>> cTrips;
        cTrips.reserve(M.nnz() + sys.K.nnz());
        for (int i = 0; i < nDof; ++i)
            for (int j = 0; j < nDof; ++j) {
                const double v = alpha * Mden(i, j) + betaR * Kden(i, j);
                if (v != 0.0) cTrips.emplace_back(i, j, v);
            }
        C.setFromTriplets(static_cast<std::size_t>(nDof),
                          static_cast<std::size_t>(nDof), cTrips);
    }

    // Effective system A = M + γΔt C + βΔt² K
    const double beta = 0.25, gamma = 0.5;
    la::SparseCSR<double> A(nDof, nDof);
    {
        la::MatrixD Mden = M.toDense();
        la::MatrixD Cden = C.toDense();
        la::MatrixD Kden = sys.K.toDense();
        std::vector<la::Triplet<double>> aTrips;
        aTrips.reserve(M.nnz() + C.nnz() + sys.K.nnz());
        for (int i = 0; i < nDof; ++i)
            for (int j = 0; j < nDof; ++j) {
                const double v = Mden(i, j)
                               + (gamma * dt) * Cden(i, j)
                               + (beta * dt * dt) * Kden(i, j);
                if (v != 0.0) aTrips.emplace_back(i, j, v);
            }
        A.setFromTriplets(static_cast<std::size_t>(nDof),
                          static_cast<std::size_t>(nDof), aTrips);
    }

    la::SparseLDLT ldlt(A);
    if (!ldlt.ok()) {
        throw std::runtime_error(
            "forge.fea.solveDynamic: Newmark factorisation failed");
    }

    // Initial conditions. Default u0=v0=0; otherwise honour the supplied state
    // (pinned DOFs always forced to zero). a₀ from M a₀ = f₀ − C v₀ − K u₀.
    std::vector<double> u(nDof, 0.0);
    std::vector<double> v(nDof, 0.0);
    if (!opts.u0.empty())
        for (int i = 0; i < nDof; ++i) u[i] = opts.u0[i];
    if (!opts.v0.empty())
        for (int i = 0; i < nDof; ++i) v[i] = opts.v0[i];
    for (int i : pinned) { u[i] = 0; v[i] = 0; }

    // a₀ solves M a₀ = f₀ − C v₀ − K u₀ exactly (factorise M once for this).
    std::vector<double> a(nDof, 0.0);
    {
        // rhs0 = fStep - C*v - K*u
        std::vector<double> rhs0 = la::vsub(fStep, la::vadd(C * v, sys.K * u));
        for (int i : pinned) rhs0[i] = 0;
        la::SparseLDLT ldltM(M);
        if (ldltM.ok()) {
            a = ldltM.solve(rhs0);
            if (!ldltM.ok()) std::fill(a.begin(), a.end(), 0.0);
        }
        for (int i : pinned) a[i] = 0;
    }

    const int steps = static_cast<int>(std::ceil(tEnd / dt));
    DynamicResult result;
    result.displacements.reserve(steps + 1);
    result.velocities.reserve(steps + 1);
    result.times.reserve(steps + 1);
    result.maxDisp.reserve(steps + 1);
    result.kineticEnergy.reserve(steps + 1);
    result.potentialEnergy.reserve(steps + 1);
    result.totalEnergy.reserve(steps + 1);
    const std::size_t nNodes = mesh.nodes.size() / 3;

    auto pushSnapshot = [&](double t) {
        std::vector<double> snapU(nDof), snapV(nDof);
        double mx = 0.0;
        for (int i = 0; i < nDof; ++i) { snapU[i] = u[i]; snapV[i] = v[i]; }
        for (std::size_t n = 0; n < nNodes; ++n) {
            const double ux = u[3*n+0], uy = u[3*n+1], uz = u[3*n+2];
            mx = std::max(mx, std::sqrt(ux*ux + uy*uy + uz*uz));
        }
        // Energy: KE = ½ vᵀ M v, PE = ½ uᵀ K u. Pinned DOFs carry a unit mass
        // and a unit stiffness from the BC elimination but their u,v are held
        // at zero, so they contribute nothing to either form.
        const double ke = 0.5 * la::vdot(v, M * v);
        const double pe = 0.5 * la::vdot(u, sys.K * u);
        result.displacements.push_back(std::move(snapU));
        result.velocities.push_back(std::move(snapV));
        result.times.push_back(t);
        result.maxDisp.push_back(mx);
        result.kineticEnergy.push_back(ke);
        result.potentialEnergy.push_back(pe);
        result.totalEnergy.push_back(ke + pe);
    };
    pushSnapshot(0.0);

    // For envelope: track per-element von-Mises max across all steps.
    const std::size_t nElems = mesh.tets.size() / 8;
    result.maxStressEnvelope.assign(nElems, 0.0);
    la::MatrixD D = buildD(mat);

    auto stressUpdate = [&]() {
        for (std::size_t e = 0; e < nElems; ++e) {
            double nodeCoords[8][3];
            std::array<double, 24> ue{};
            for (int i = 0; i < 8; ++i) {
                const std::uint32_t nid = mesh.tets[e * 8 + i];
                nodeCoords[i][0] = mesh.nodes[3 * nid + 0];
                nodeCoords[i][1] = mesh.nodes[3 * nid + 1];
                nodeCoords[i][2] = mesh.nodes[3 * nid + 2];
                for (int aa = 0; aa < 3; ++aa) ue[3*i + aa] = u[3*nid + aa];
            }
            const IncompatOps* iop =
                (e < sys.incompat.size()) ? &sys.incompat[e] : nullptr;
            auto sigma = elementStress(nodeCoords, D, ue, iop);
            const double vm = vonMisesFromVoigt(sigma);
            if (vm > result.maxStressEnvelope[e]) result.maxStressEnvelope[e] = vm;
        }
    };

    for (int step = 1; step <= steps; ++step) {
        const double t = step * dt;

        // Predictors.
        // uHat = u + dt*v + dt²(0.5-beta)*a
        std::vector<double> uHat = u;
        la::vaxpy(uHat, dt, v);
        la::vaxpy(uHat, dt * dt * (0.5 - beta), a);
        // vHat = v + dt(1-gamma)*a
        std::vector<double> vHat = v;
        la::vaxpy(vHat, dt * (1.0 - gamma), a);

        // Solve for a_{n+1}.
        // rhs = fStep - C*vHat - K*uHat
        std::vector<double> rhs = la::vsub(fStep, la::vadd(C * vHat, sys.K * uHat));
        // Pin BCs on rhs (corresponding A row is already identity).
        for (int i : pinned) rhs[i] = 0;
        std::vector<double> aNew = ldlt.solve(rhs);
        if (!ldlt.ok()) {
            throw std::runtime_error(
                "forge.fea.solveDynamic: Newmark step solve failed");
        }

        // Correctors.
        // uNew = uHat + beta*dt²*aNew
        std::vector<double> uNew = uHat;
        la::vaxpy(uNew, beta * dt * dt, aNew);
        // vNew = vHat + gamma*dt*aNew
        std::vector<double> vNew = vHat;
        la::vaxpy(vNew, gamma * dt, aNew);
        for (int i : pinned) { uNew[i] = 0; vNew[i] = 0; aNew[i] = 0; }

        u = std::move(uNew);
        v = std::move(vNew);
        a = std::move(aNew);

        pushSnapshot(t);
        stressUpdate();
    }

    auto endWall = std::chrono::steady_clock::now();
    result.cpuMs = std::chrono::duration<double, std::milli>(endWall - startWall).count();
    return result;
}

} // namespace forge::fea
