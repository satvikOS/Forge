// forge-kernel — native 2D axisymmetric magnetostatics (Elmer-track E1)
//
// Implements forge::em::magnetostatics on the SHARED scalar-elliptic assembler
// (forge::native::fea::scalar_elliptic) reused from the thermal path. See
// include/forge/Emag.hpp for the full derivation; the short version:
//
//   * Variable        u = r·A_φ   (modified potential; finite, →0 on the axis).
//   * Operator        −∇·((ν/r)∇u) = J_φ      over the r-z half-plane.
//   * Discretisation  structured (nr×nz) r-z grid, each quad lifted to ONE
//                     8-node Cartesian-slab hex (x=r, y=z, third axis = unit slab
//                     thickness t). On the slab the operator −∇·(c∇u) with
//                     c = ν/(T·r) integrates over t (supplying the factor T) to
//                     the r-z operator −∇·((ν/r)∇u).
//                     Both t-layers map to the SAME r-z DOF, which ties them
//                     (∂u/∂t ≡ 0) and contracts the 3D hex stiffness to the exact
//                     2D axisymmetric quad operator — reusing HexElement math with
//                     no 2D shape-function re-derivation.
//   * Source          J_φ enters as the consistent load fe[i] += J_φ N_i w.
//   * BCs             u = 0 (Dirichlet) on the axis r=0 and on the truncated
//                     far-field boundary r=rMax, z=zMin, z=zMax.
//   * Recovery        A_φ = u/r; B_r = −(1/r)∂u/∂z; B_z = (1/r)∂u/∂r (gradientAt).

#include "forge/Emag.hpp"

#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"

#include <cmath>
#include <stdexcept>
#include <vector>

namespace forge::em {

namespace la = forge::native::linalg;
namespace se = forge::native::fea::scalar_elliptic;

namespace {
constexpr double kPi = 3.14159265358979323846;
} // namespace

MagnetostaticsResult magnetostatics(const MagnetostaticsConfig& cfg)
{
    if (cfg.nr < 1 || cfg.nz < 1) {
        throw std::invalid_argument("forge.em.magnetostatics: nr and nz must be ≥ 1");
    }
    if (cfg.rMax <= 0 || cfg.zMax <= cfg.zMin) {
        throw std::invalid_argument("forge.em.magnetostatics: need rMax>0 and zMax>zMin");
    }
    if (cfg.mu <= 0) {
        throw std::invalid_argument("forge.em.magnetostatics: mu must be > 0");
    }

    const int nr = cfg.nr;
    const int nz = cfg.nz;
    const double nu  = 1.0 / cfg.mu;          // reluctivity ν
    const double dr  = cfg.rMax / nr;
    const double dz  = (cfg.zMax - cfg.zMin) / nz;
    const double T   = 1.0;                    // slab thickness (cancels in the solve)

    const int nNodeR = nr + 1;
    const int nNodeZ = nz + 1;
    const std::size_t N2 = static_cast<std::size_t>(nNodeR) * nNodeZ; // r-z DOFs

    auto rOf = [&](int ir) { return ir * dr; };
    auto zOf = [&](int iz) { return cfg.zMin + iz * dz; };
    auto nid = [&](int ir, int iz) {           // r-z node id
        return static_cast<std::size_t>(iz) * nNodeR + ir;
    };

    // Current density at a physical point (sum of coil regions covering it).
    auto jphiAt = [&](double r, double z) {
        double j = 0;
        for (const auto& c : cfg.coils) {
            if (r >= c.rLo && r <= c.rHi && z >= c.zLo && z <= c.zHi) j += c.Jphi;
        }
        return j;
    };

    // ---- assemble K u = f over the r-z DOFs --------------------------------
    std::vector<la::Triplet<double>> trips;
    trips.reserve(static_cast<std::size_t>(nr) * nz * 8 * 8);
    std::vector<double> f(N2, 0.0);

    // Coefficient c = ν/(T·r). On the Cartesian slab (volume dr dz dt, no r in
    // the measure) the t-integration contributes the factor T, so the effective
    // r-z operator coefficient is T·c = ν/r — exactly the −∇·((ν/r)∇u) weighting.
    // Evaluated at the physical Gauss-point radius r = x (the source J_φ enters
    // with density s = J_φ/T so f^slab = f_2D). Both K and f carry the same 1/T,
    // which cancels in the solve; we keep T=1 so c = ν/r and s = J_φ directly.
    auto coeffAt = [&](double x, double /*y*/, double /*z*/) {
        return nu / (T * x);
    };

    for (int iz = 0; iz < nz; ++iz) {
        const double zLo = zOf(iz), zHi = zOf(iz + 1);
        for (int ir = 0; ir < nr; ++ir) {
            const double rLo = rOf(ir), rHi = rOf(ir + 1);
            // Slab hex node coords: bottom layer (t=0) nodes 0..3, top (t=T) 4..7,
            // (ξ,η,ζ)=(r,z,t) in the HexElement canonical ordering.
            const double X[8][3] = {
                {rLo, zLo, 0.0}, {rHi, zLo, 0.0}, {rHi, zHi, 0.0}, {rLo, zHi, 0.0},
                {rLo, zLo, T  }, {rHi, zLo, T  }, {rHi, zHi, T  }, {rLo, zHi, T  },
            };
            // Constant J_φ over the element, sampled at the centroid (coils are
            // axis-aligned bands snapped to the grid).
            const double jElem = jphiAt(0.5 * (rLo + rHi), 0.5 * (zLo + zHi));
            // Source density s = J_φ/T so the slab load f^slab = f_2D (T cancels).
            auto srcAt = [&](double, double, double) { return jElem / T; };

            la::MatrixD Ke(8, 8);
            double fe[8];
            se::elementStiffnessVar(coeffAt, srcAt, X, Ke, fe,
                                    "forge.em.magnetostatics");

            // local hex node -> r-z DOF (both t-layers tie to the same 2D node).
            const std::size_t g[8] = {
                nid(ir,     iz),     nid(ir + 1, iz),     nid(ir + 1, iz + 1), nid(ir,     iz + 1),
                nid(ir,     iz),     nid(ir + 1, iz),     nid(ir + 1, iz + 1), nid(ir,     iz + 1),
            };
            for (int a = 0; a < 8; ++a) {
                f[g[a]] += fe[a];
                for (int b = 0; b < 8; ++b) {
                    const double v = Ke(a, b);
                    if (v != 0.0) trips.emplace_back(g[a], g[b], v);
                }
            }
        }
    }

    // ---- Dirichlet BCs: u = 0 on axis (r=0) + truncated far-field boundary ---
    std::vector<bool> isFixed(N2, false);
    for (int iz = 0; iz < nNodeZ; ++iz) {
        for (int ir = 0; ir < nNodeR; ++ir) {
            if (ir == 0 || ir == nr || iz == 0 || iz == nz) isFixed[nid(ir, iz)] = true;
        }
    }
    // Filter the assembled triplets (drop fixed rows/cols), add unit diagonal for
    // each fixed dof, set rhs = 0 (all fixed values are 0, so no f-substitution).
    {
        std::vector<la::Triplet<double>> kt;
        kt.reserve(trips.size());
        for (const auto& t : trips) {
            if (isFixed[t.row] || isFixed[t.col]) continue;
            kt.push_back(t);
        }
        for (std::size_t i = 0; i < N2; ++i) {
            if (isFixed[i]) { kt.emplace_back(i, i, 1.0); f[i] = 0.0; }
        }
        trips.swap(kt);
    }

    la::SparseCSR<double> K;
    K.setFromTriplets(N2, N2, trips);
    la::SparseLDLT ldlt(K);
    if (!ldlt.ok()) {
        throw std::runtime_error(
            "forge.em.magnetostatics: LDLT factorisation failed (system not SPD)");
    }
    std::vector<double> u = ldlt.solve(f);     // u = r·A_φ on the r-z DOFs

    // ---- assemble result ----------------------------------------------------
    MagnetostaticsResult out;
    out.nr = nr; out.nz = nz;
    out.nodeR.resize(N2); out.nodeZ.resize(N2); out.Aphi.resize(N2);
    for (int iz = 0; iz < nNodeZ; ++iz) {
        for (int ir = 0; ir < nNodeR; ++ir) {
            const std::size_t n = nid(ir, iz);
            const double r = rOf(ir);
            out.nodeR[n] = r;
            out.nodeZ[n] = zOf(iz);
            out.Aphi[n]  = (r > 0) ? u[n] / r : 0.0;    // A_φ = u/r (0 on axis)
        }
    }

    const std::size_t NE = static_cast<std::size_t>(nr) * nz;
    out.elemR.resize(NE); out.elemZ.resize(NE);
    out.Br.resize(NE); out.Bz.resize(NE); out.Bmag.resize(NE);
    double energy = 0.0;
    for (int iz = 0; iz < nz; ++iz) {
        const double zLo = zOf(iz), zHi = zOf(iz + 1);
        for (int ir = 0; ir < nr; ++ir) {
            const double rLo = rOf(ir), rHi = rOf(ir + 1);
            const double rC = 0.5 * (rLo + rHi);
            const double X[8][3] = {
                {rLo, zLo, 0.0}, {rHi, zLo, 0.0}, {rHi, zHi, 0.0}, {rLo, zHi, 0.0},
                {rLo, zLo, T  }, {rHi, zLo, T  }, {rHi, zHi, T  }, {rLo, zHi, T  },
            };
            const std::size_t g[8] = {
                nid(ir,     iz),     nid(ir + 1, iz),     nid(ir + 1, iz + 1), nid(ir,     iz + 1),
                nid(ir,     iz),     nid(ir + 1, iz),     nid(ir + 1, iz + 1), nid(ir,     iz + 1),
            };
            double ue[8];
            for (int a = 0; a < 8; ++a) ue[a] = u[g[a]];
            // ∇u at the slab-hex centroid: grad[0]=∂u/∂r, grad[1]=∂u/∂z.
            double grad[3];
            se::gradientAt(0, 0, 0, X, ue, grad);
            const double Br =  -(1.0 / rC) * grad[1];   // −(1/r) ∂u/∂z
            const double Bz =   (1.0 / rC) * grad[0];   //  (1/r) ∂u/∂r
            const std::size_t e = static_cast<std::size_t>(iz) * nr + ir;
            out.elemR[e] = rC;
            out.elemZ[e] = 0.5 * (zLo + zHi);
            out.Br[e] = Br; out.Bz[e] = Bz;
            out.Bmag[e] = std::sqrt(Br * Br + Bz * Bz);
            // Magnetic energy ½∫B·H dV = ½ν|B|² over the revolved element volume
            // V = 2π·rC·dr·dz (exact ∫2πr dr dz for the band [rLo,rHi]).
            const double Vrev = 2.0 * kPi * rC * dr * dz;
            energy += 0.5 * nu * (Br * Br + Bz * Bz) * Vrev;
        }
    }
    out.energy = energy;

    // Residual of the BC-reduced system (diagnostic; scaled by the slab thickness).
    std::vector<double> resid = la::vsub(K * u, f);
    out.residual = la::normInf(resid);
    return out;
}

} // namespace forge::em
