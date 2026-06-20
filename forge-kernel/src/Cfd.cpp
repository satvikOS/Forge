#include "forge/Cfd.hpp"

#include <Eigen/Sparse>
#include <Eigen/SparseCholesky>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::cfd {

// ---------------------------------------------------------------------------
// Incompressible Navier-Stokes on a staggered MAC grid (Harlow-Welch).
//
// Variables (Nx, Ny, Nz cell counts):
//   u : (Nx+1) × Ny × Nz      x-face velocities
//   v : Nx × (Ny+1) × Nz      y-face velocities
//   w : Nx × Ny × (Nz+1)      z-face velocities
//   p : Nx × Ny × Nz          cell-centre pressures
//
// Per outer iteration we run a pseudo-time step of the projection method:
//   1. predict u* = u^n − Δt (u·∇)u + Δt ν ∇²u                 (no pressure)
//   2. solve  ∇²p = (ρ/Δt) ∇·u*                                 (pressure Poisson)
//   3. correct u^{n+1} = u* − (Δt/ρ) ∇p
//
// The outer loop continues until ‖∇·u^{n+1}‖₂ falls below cfg.residualTol or
// `maxIter` is reached. This is "SIMPLE-flavoured" in the sense that we
// drive divergence to zero through repeated pressure-corrector iterations.
//
// Boundary conditions:
//   walls  (no-slip)       : tangential velocity 0 (set on faces), normal = 0
//   inlets (Dirichlet vel) : all 3 components fixed on the faces of that side
//   outlets                : zero-gradient on velocity, pressure clamped to 0
//   lid    (moving lid)    : like an inlet but only the in-plane tangential
//                            component is non-zero
//
// We do not enforce a continuous tangential boundary condition exactly on the
// staggered cells outside the domain — instead we use ghost-cell mirroring,
// which is the standard MAC trick and gives second-order accuracy at the wall.
//
// We deliberately keep the discretisation first-order in advection (upwind)
// because it stays stable at the Re = 100 cavity smoke; an MUSCL / QUICK
// upgrade is queued behind a turbulence model.
// ---------------------------------------------------------------------------

namespace {

inline std::size_t idxC(int i, int j, int k, int Nx, int Ny) {
    return (static_cast<std::size_t>(k) * Ny + j) * Nx + i;
}

inline std::size_t idxU(int i, int j, int k, int Nx, int Ny) {
    // u stored as (Nx+1) × Ny × Nz
    return (static_cast<std::size_t>(k) * Ny + j) * (Nx + 1) + i;
}

inline std::size_t idxV(int i, int j, int k, int Nx, int Ny) {
    // v stored as Nx × (Ny+1) × Nz
    return (static_cast<std::size_t>(k) * (Ny + 1) + j) * Nx + i;
}

inline std::size_t idxW(int i, int j, int k, int Nx, int Ny) {
    // w stored as Nx × Ny × (Nz+1)
    return (static_cast<std::size_t>(k) * Ny + j) * Nx + i;
}

struct FaceFlags {
    // Per AABB face: inlet velocity (if any), wall flag, outlet flag, lid flag.
    bool isWall   = false;
    bool isOutlet = false;
    bool isInlet  = false;
    double vx = 0, vy = 0, vz = 0;
};

} // namespace

CfdResult solveSteadyNS(const CfdConfig& cfg) {
    if (cfg.Nx < 4 || cfg.Ny < 4 || cfg.Nz < 4) {
        throw std::invalid_argument(
            "forge.cfd.solveSteadyNS: grid resolution too small (need ≥ 4 per axis)");
    }
    if (!(cfg.rho > 0)) {
        throw std::invalid_argument("forge.cfd.solveSteadyNS: rho must be > 0");
    }
    if (!(cfg.nu > 0)) {
        throw std::invalid_argument("forge.cfd.solveSteadyNS: nu must be > 0");
    }

    auto startWall = std::chrono::steady_clock::now();

    const int Nx = cfg.Nx, Ny = cfg.Ny, Nz = cfg.Nz;
    const double Lx = cfg.domain.maxX - cfg.domain.minX;
    const double Ly = cfg.domain.maxY - cfg.domain.minY;
    const double Lz = cfg.domain.maxZ - cfg.domain.minZ;
    const double dx = Lx / Nx;
    const double dy = Ly / Ny;
    const double dz = Lz / Nz;

    // Pseudo-time step (CFL-ish). For an explicit predictor we need
    //   dt ≤ 0.5 · h² / ν   (diffusive limit, von-Neumann)
    //   dt ≤ h / |u_max|    (advective CFL)
    // We don't know |u_max| up front; we estimate it from the highest BC
    // velocity (inlet / lid). For the lid-cavity smoke that's 1 m/s.
    const double hMin = std::min({dx, dy, dz});
    double uBc = 1e-6;
    for (const auto& in : cfg.inlets) uBc = std::max({uBc, std::abs(in.vx), std::abs(in.vy), std::abs(in.vz)});
    if (cfg.useLid) uBc = std::max({uBc, std::abs(cfg.lid.vx), std::abs(cfg.lid.vy), std::abs(cfg.lid.vz)});
    // Diffusive von-Neumann stability gives dt ≤ 0.5·h²/ν for the explicit
    // central Laplacian we use; the advective CFL gives dt ≤ h/|u_max|. We
    // pick 0.3·dt_diff (well inside von-Neumann) and 0.4·dt_adv against the
    // peak BC speed scaled up to handle transient overshoot. The projection
    // step itself is unconditionally stable now that the pressure Poisson
    // is correct (signed RHS), so the only limit is the predictor.
    //
    // UPGRADE B (channel-NaN fix, divide-by-zero guard): uBc is clamped to
    // 1e-6 above so dtAdv is always finite even before any flow develops
    // (lid-driven cavity init has uBc from the lid; an inlet sets it from the
    // inlet speed). std::max(dtDiff,dtAdv) is never used — dt is the min of two
    // strictly positive quantities, so dt > 0 is guaranteed and the explicit
    // predictor cannot produce a 0/0 timestep.
    const double dtDiff = 0.45 * hMin * hMin / cfg.nu;
    const double dtAdv  = 0.5  * hMin / (1.5 * uBc);
    const double dt = std::min(dtDiff, dtAdv);
    if (!(dt > 0) || !std::isfinite(dt)) {
        throw std::runtime_error(
            "forge.cfd.solveSteadyNS: non-finite timestep (check nu, domain, BC velocities)");
    }

    // ---------------------------------------------------- BC face flags
    std::array<FaceFlags, 6> face;
    for (auto id : cfg.walls)   { if (id < 6) face[id].isWall   = true; }
    for (auto id : cfg.outlets) { if (id < 6) face[id].isOutlet = true; }
    for (const auto& in : cfg.inlets) {
        if (in.faceId < 6) {
            face[in.faceId].isInlet = true;
            face[in.faceId].vx = in.vx;
            face[in.faceId].vy = in.vy;
            face[in.faceId].vz = in.vz;
        }
    }
    if (cfg.useLid && cfg.lid.faceId < 6) {
        face[cfg.lid.faceId].isInlet = true;
        face[cfg.lid.faceId].vx = cfg.lid.vx;
        face[cfg.lid.faceId].vy = cfg.lid.vy;
        face[cfg.lid.faceId].vz = cfg.lid.vz;
    }

    // ---------------------------------------------------- field allocation
    std::vector<double> u(static_cast<std::size_t>(Nx + 1) * Ny * Nz, 0.0);
    std::vector<double> v(static_cast<std::size_t>(Nx) * (Ny + 1) * Nz, 0.0);
    std::vector<double> w(static_cast<std::size_t>(Nx) * Ny * (Nz + 1), 0.0);
    std::vector<double> p(static_cast<std::size_t>(Nx) * Ny * Nz, 0.0);
    std::vector<double> uStar = u, vStar = v, wStar = w;

    // ---------------------------------------------------- BC enforcement
    //
    // Set the staggered face velocities that *lie on* a BC face. For walls we
    // also zero the tangential velocity on the row of faces adjacent to the
    // wall (no-slip via ghost-cell reflection — the gradient stencil already
    // sees ghost = −interior on the wall row).
    auto applyVelocityBCs = [&](std::vector<double>& U,
                                std::vector<double>& V,
                                std::vector<double>& W) {
        // -X face (i = 0 on u-grid)
        if (face[0].isInlet || face[0].isWall) {
            const double uVal = face[0].isWall ? 0.0 : face[0].vx;
            for (int k = 0; k < Nz; ++k)
              for (int j = 0; j < Ny; ++j)
                U[idxU(0, j, k, Nx, Ny)] = uVal;
        }
        // +X face (i = Nx on u-grid)
        if (face[1].isInlet || face[1].isWall) {
            const double uVal = face[1].isWall ? 0.0 : face[1].vx;
            for (int k = 0; k < Nz; ++k)
              for (int j = 0; j < Ny; ++j)
                U[idxU(Nx, j, k, Nx, Ny)] = uVal;
        }
        // -Y face (j = 0 on v-grid)
        if (face[2].isInlet || face[2].isWall) {
            const double vVal = face[2].isWall ? 0.0 : face[2].vy;
            for (int k = 0; k < Nz; ++k)
              for (int i = 0; i < Nx; ++i)
                V[idxV(i, 0, k, Nx, Ny)] = vVal;
        }
        // +Y face (j = Ny on v-grid) — typically the lid for cavity smoke.
        // For an inlet face whose v-component is 0 (i.e. a tangential lid), we
        // still want to capture the tangential u/w on the row of u/w faces
        // touching this wall via ghost-cell reflection (handled below in the
        // sweep update).
        if (face[3].isInlet || face[3].isWall) {
            const double vVal = face[3].isWall ? 0.0 : face[3].vy;
            for (int k = 0; k < Nz; ++k)
              for (int i = 0; i < Nx; ++i)
                V[idxV(i, Ny, k, Nx, Ny)] = vVal;
        }
        // -Z and +Z
        if (face[4].isInlet || face[4].isWall) {
            const double wVal = face[4].isWall ? 0.0 : face[4].vz;
            for (int j = 0; j < Ny; ++j)
              for (int i = 0; i < Nx; ++i)
                W[idxW(i, j, 0, Nx, Ny)] = wVal;
        }
        if (face[5].isInlet || face[5].isWall) {
            const double wVal = face[5].isWall ? 0.0 : face[5].vz;
            for (int j = 0; j < Ny; ++j)
              for (int i = 0; i < Nx; ++i)
                W[idxW(i, j, Nz, Nx, Ny)] = wVal;
        }
    };

    // ---------------------------------------------------- inlet flux
    //
    // UPGRADE B (channel through-flow fix): for an open domain the projection
    // method can only converge if global mass is conserved — Σ(outflow) must
    // equal Σ(inflow) every step, otherwise the pressure-Poisson RHS integrates
    // to a non-zero net source that the (outlet-pinned) Poisson operator cannot
    // satisfy, the corrector cannot drive ∇·u→0, pressure grows without bound,
    // and the field diverges to NaN. We compute the (signed, into-domain) inlet
    // volumetric flux once; the outlet BC below rescales the extrapolated outlet
    // velocity so the discrete outflow matches it exactly.
    auto inletFlux = [&]() {
        double Q = 0.0; // volumetric flow rate INTO the domain (m³/s)
        if (face[0].isInlet) Q += face[0].vx * (Ly * Lz);   // -X: +x is inward
        if (face[1].isInlet) Q += -face[1].vx * (Ly * Lz);  // +X: -x is inward
        if (face[2].isInlet) Q += face[2].vy * (Lx * Lz);   // -Y
        if (face[3].isInlet) Q += -face[3].vy * (Lx * Lz);  // +Y
        if (face[4].isInlet) Q += face[4].vz * (Lx * Ly);   // -Z
        if (face[5].isInlet) Q += -face[5].vz * (Lx * Ly);  // +Z
        return Q;
    };
    const double Qin = inletFlux();

    // Total open outlet area (m²) — used by the additive mass-conservation
    // correction below. Each outlet face contributes its full cross-sectional
    // area regardless of grid resolution.
    const double outletArea = [&]() {
        double A = 0.0;
        if (face[0].isOutlet || face[1].isOutlet) A += Ly * Lz; // ×X faces
        if (face[2].isOutlet || face[3].isOutlet) A += Lx * Lz; // ×Y faces
        if (face[4].isOutlet || face[5].isOutlet) A += Lx * Ly; // ×Z faces
        return A;
    }();

    // ---------------------------------------------------- outlet velocity BC
    //
    // FIX (channel through-flow divergence): the prior multiplicative rescale
    // s = Qin/Qout is an UNBOUNDED amplifier. In the first transient iterations
    // the zero-gradient extrapolated outflow Qout is tiny (the interior is
    // barely moving), so s explodes; the predictor advects that huge outlet
    // velocity inward, the next extrapolation grows, and the loop is positive
    // feedback → velocity blows up to NaN (observed: maxU 0.1→5→730→8e4→∞ while
    // ∇·u stays at machine ε, i.e. the projection is fine, the BC is the bomb).
    //
    // Correct open-domain treatment for a projection method: zero-gradient
    // (convective/Neumann) extrapolation of the outlet normal velocity, then a
    // BOUNDED ADDITIVE uniform correction δ = (Qin − Qout)/A_outlet applied in
    // the outflow-positive direction on every outlet face. This:
    //   * conserves global mass exactly (Σ outflow == Σ inflow == Qin), which
    //     makes the pressure-Poisson RHS integrate to zero against the
    //     Dirichlet-outlet operator — the consistency condition that lets the
    //     corrector drive ∇·u→0 instead of accumulating a net source;
    //   * is bounded (a shift, not a ratio) so it can never amplify a small
    //     transient outflow into a runaway;
    //   * preserves the developing profile SHAPE (the parabola grows naturally
    //     from the viscous Laplacian + wall no-slip; we never scale it), so the
    //     fully-developed peak/mean emerges from the physics, not the BC.
    // Pressure at the outlet cells is Dirichlet p=0 (see Poisson assembly), so
    // the pressure system is non-singular and consistent.
    auto applyOutletBCs = [&](std::vector<double>& U,
                              std::vector<double>& V,
                              std::vector<double>& W) {
        // -X outlet (i=0 on u-grid): u(0,·)=u(1,·)
        if (face[0].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int j = 0; j < Ny; ++j)
                U[idxU(0, j, k, Nx, Ny)] = U[idxU(1, j, k, Nx, Ny)];
        // +X outlet (i=Nx): u(Nx,·)=u(Nx-1,·)
        if (face[1].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int j = 0; j < Ny; ++j)
                U[idxU(Nx, j, k, Nx, Ny)] = U[idxU(Nx - 1, j, k, Nx, Ny)];
        // -Y outlet
        if (face[2].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int i = 0; i < Nx; ++i)
                V[idxV(i, 0, k, Nx, Ny)] = V[idxV(i, 1, k, Nx, Ny)];
        // +Y outlet
        if (face[3].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int i = 0; i < Nx; ++i)
                V[idxV(i, Ny, k, Nx, Ny)] = V[idxV(i, Ny - 1, k, Nx, Ny)];
        // -Z outlet
        if (face[4].isOutlet)
            for (int j = 0; j < Ny; ++j) for (int i = 0; i < Nx; ++i)
                W[idxW(i, j, 0, Nx, Ny)] = W[idxW(i, j, 1, Nx, Ny)];
        // +Z outlet
        if (face[5].isOutlet)
            for (int j = 0; j < Ny; ++j) for (int i = 0; i < Nx; ++i)
                W[idxW(i, j, Nz, Nx, Ny)] = W[idxW(i, j, Nz - 1, Nx, Ny)];

        // Additive global mass-conservation correction. Only meaningful when an
        // inlet drives the flow and there is open outlet area to correct on.
        if (std::abs(Qin) <= 0 || outletArea <= 0) return;
        double Qout = 0.0; // signed volumetric outflow (out of the domain)
        const double aX = dy * dz, aY = dx * dz, aZ = dx * dy;
        if (face[0].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int j = 0; j < Ny; ++j)
                Qout += -U[idxU(0, j, k, Nx, Ny)] * aX;            // -X: out = -u
        if (face[1].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int j = 0; j < Ny; ++j)
                Qout += U[idxU(Nx, j, k, Nx, Ny)] * aX;            // +X: out = +u
        if (face[2].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int i = 0; i < Nx; ++i)
                Qout += -V[idxV(i, 0, k, Nx, Ny)] * aY;
        if (face[3].isOutlet)
            for (int k = 0; k < Nz; ++k) for (int i = 0; i < Nx; ++i)
                Qout += V[idxV(i, Ny, k, Nx, Ny)] * aY;
        if (face[4].isOutlet)
            for (int j = 0; j < Ny; ++j) for (int i = 0; i < Nx; ++i)
                Qout += -W[idxW(i, j, 0, Nx, Ny)] * aZ;
        if (face[5].isOutlet)
            for (int j = 0; j < Ny; ++j) for (int i = 0; i < Nx; ++i)
                Qout += W[idxW(i, j, Nz, Nx, Ny)] * aZ;

        // δ has units of m/s; adding it to the (outflow-positive) normal
        // velocity on every outlet face raises total outflow by δ·A_outlet, so
        // δ = (Qin − Qout)/A_outlet makes Qout == Qin exactly. Bounded by Qin.
        const double delta = (Qin - Qout) / outletArea;
        if (face[0].isOutlet) // -X: outflow positive is −u, so add −δ to u
            for (int k=0;k<Nz;++k) for (int j=0;j<Ny;++j) U[idxU(0,j,k,Nx,Ny)]  -= delta;
        if (face[1].isOutlet) // +X: outflow positive is +u, so add +δ to u
            for (int k=0;k<Nz;++k) for (int j=0;j<Ny;++j) U[idxU(Nx,j,k,Nx,Ny)] += delta;
        if (face[2].isOutlet)
            for (int k=0;k<Nz;++k) for (int i=0;i<Nx;++i) V[idxV(i,0,k,Nx,Ny)]  -= delta;
        if (face[3].isOutlet)
            for (int k=0;k<Nz;++k) for (int i=0;i<Nx;++i) V[idxV(i,Ny,k,Nx,Ny)] += delta;
        if (face[4].isOutlet)
            for (int j=0;j<Ny;++j) for (int i=0;i<Nx;++i) W[idxW(i,j,0,Nx,Ny)]  -= delta;
        if (face[5].isOutlet)
            for (int j=0;j<Ny;++j) for (int i=0;i<Nx;++i) W[idxW(i,j,Nz,Nx,Ny)] += delta;
    };

    // Ghost-cell helpers — they return the velocity in the cell one outside the
    // domain. For inlet/outlet/wall we mirror appropriately so that the central
    // stencil produces the right behaviour at the boundary.
    auto uGhost = [&](int i, int j, int k) {
        // Out-of-bounds j/k for u-grid: mirror through wall/inlet/lid.
        if (j < 0) {
            if (face[2].isWall)   return -u[idxU(i, 0, k, Nx, Ny)];
            if (face[2].isInlet)  return  2.0 * face[2].vx - u[idxU(i, 0, k, Nx, Ny)];
            return u[idxU(i, 0, k, Nx, Ny)];
        }
        if (j >= Ny) {
            if (face[3].isWall)   return -u[idxU(i, Ny - 1, k, Nx, Ny)];
            if (face[3].isInlet)  return  2.0 * face[3].vx - u[idxU(i, Ny - 1, k, Nx, Ny)];
            return u[idxU(i, Ny - 1, k, Nx, Ny)];
        }
        if (k < 0) {
            if (face[4].isWall)   return -u[idxU(i, j, 0, Nx, Ny)];
            if (face[4].isInlet)  return  2.0 * face[4].vx - u[idxU(i, j, 0, Nx, Ny)];
            return u[idxU(i, j, 0, Nx, Ny)];
        }
        if (k >= Nz) {
            if (face[5].isWall)   return -u[idxU(i, j, Nz - 1, Nx, Ny)];
            if (face[5].isInlet)  return  2.0 * face[5].vx - u[idxU(i, j, Nz - 1, Nx, Ny)];
            return u[idxU(i, j, Nz - 1, Nx, Ny)];
        }
        return u[idxU(i, j, k, Nx, Ny)];
    };
    auto vGhost = [&](int i, int j, int k) {
        if (i < 0) {
            if (face[0].isWall)   return -v[idxV(0, j, k, Nx, Ny)];
            if (face[0].isInlet)  return  2.0 * face[0].vy - v[idxV(0, j, k, Nx, Ny)];
            return v[idxV(0, j, k, Nx, Ny)];
        }
        if (i >= Nx) {
            if (face[1].isWall)   return -v[idxV(Nx - 1, j, k, Nx, Ny)];
            if (face[1].isInlet)  return  2.0 * face[1].vy - v[idxV(Nx - 1, j, k, Nx, Ny)];
            return v[idxV(Nx - 1, j, k, Nx, Ny)];
        }
        if (k < 0) {
            if (face[4].isWall)   return -v[idxV(i, j, 0, Nx, Ny)];
            if (face[4].isInlet)  return  2.0 * face[4].vy - v[idxV(i, j, 0, Nx, Ny)];
            return v[idxV(i, j, 0, Nx, Ny)];
        }
        if (k >= Nz) {
            if (face[5].isWall)   return -v[idxV(i, j, Nz - 1, Nx, Ny)];
            if (face[5].isInlet)  return  2.0 * face[5].vy - v[idxV(i, j, Nz - 1, Nx, Ny)];
            return v[idxV(i, j, Nz - 1, Nx, Ny)];
        }
        return v[idxV(i, j, k, Nx, Ny)];
    };
    auto wGhost = [&](int i, int j, int k) {
        if (i < 0) {
            if (face[0].isWall)   return -w[idxW(0, j, k, Nx, Ny)];
            if (face[0].isInlet)  return  2.0 * face[0].vz - w[idxW(0, j, k, Nx, Ny)];
            return w[idxW(0, j, k, Nx, Ny)];
        }
        if (i >= Nx) {
            if (face[1].isWall)   return -w[idxW(Nx - 1, j, k, Nx, Ny)];
            if (face[1].isInlet)  return  2.0 * face[1].vz - w[idxW(Nx - 1, j, k, Nx, Ny)];
            return w[idxW(Nx - 1, j, k, Nx, Ny)];
        }
        if (j < 0) {
            if (face[2].isWall)   return -w[idxW(i, 0, k, Nx, Ny)];
            if (face[2].isInlet)  return  2.0 * face[2].vz - w[idxW(i, 0, k, Nx, Ny)];
            return w[idxW(i, 0, k, Nx, Ny)];
        }
        if (j >= Ny) {
            if (face[3].isWall)   return -w[idxW(i, Ny - 1, k, Nx, Ny)];
            if (face[3].isInlet)  return  2.0 * face[3].vz - w[idxW(i, Ny - 1, k, Nx, Ny)];
            return w[idxW(i, Ny - 1, k, Nx, Ny)];
        }
        return w[idxW(i, j, k, Nx, Ny)];
    };

    applyVelocityBCs(u, v, w);
    applyOutletBCs(u, v, w); // seed outlet plug flow so iter-1 div is finite

    // ----------------------------------------------- pressure Poisson matrix
    //
    // Laplacian on cell-centred pressure with Neumann BCs everywhere except
    // outlets (Dirichlet p = 0). If no outlet was specified we fix one cell
    // (origin) at p = 0 to remove the rank-1 null space.
    const int nCells = Nx * Ny * Nz;
    Eigen::SparseMatrix<double> Lp(nCells, nCells);
    {
        std::vector<Eigen::Triplet<double>> trips;
        trips.reserve(static_cast<std::size_t>(nCells) * 7);

        const double cx = 1.0 / (dx * dx);
        const double cy = 1.0 / (dy * dy);
        const double cz = 1.0 / (dz * dz);

        // Determine pressure-Dirichlet cells (outlet faces).
        auto isOutletCell = [&](int i, int j, int k) {
            if (face[0].isOutlet && i == 0)         return true;
            if (face[1].isOutlet && i == Nx - 1)    return true;
            if (face[2].isOutlet && j == 0)         return true;
            if (face[3].isOutlet && j == Ny - 1)    return true;
            if (face[4].isOutlet && k == 0)         return true;
            if (face[5].isOutlet && k == Nz - 1)    return true;
            return false;
        };

        bool anyOutlet = false;
        for (auto f : cfg.outlets) if (f < 6) { anyOutlet = true; break; }

        for (int k = 0; k < Nz; ++k) {
          for (int j = 0; j < Ny; ++j) {
            for (int i = 0; i < Nx; ++i) {
              const int c = static_cast<int>(idxC(i, j, k, Nx, Ny));
              if (isOutletCell(i, j, k)) {
                  trips.emplace_back(c, c, 1.0);
                  continue;
              }
              // Neumann pressure BC at walls/inlets: ∂p/∂n = 0, so the ghost
              // pressure equals the cell pressure and the wall contributes
              // nothing to either the diagonal or the off-diagonal. Only
              // interior neighbours add their cx/cy/cz coefficient to the
              // diagonal (with the corresponding -cx off-diagonal entry).
              double diag = 0;
              if (i > 0)        { trips.emplace_back(c, static_cast<int>(idxC(i-1,j,k,Nx,Ny)), -cx); diag += cx; }
              if (i < Nx - 1)   { trips.emplace_back(c, static_cast<int>(idxC(i+1,j,k,Nx,Ny)), -cx); diag += cx; }
              if (j > 0)        { trips.emplace_back(c, static_cast<int>(idxC(i,j-1,k,Nx,Ny)), -cy); diag += cy; }
              if (j < Ny - 1)   { trips.emplace_back(c, static_cast<int>(idxC(i,j+1,k,Nx,Ny)), -cy); diag += cy; }
              if (k > 0)        { trips.emplace_back(c, static_cast<int>(idxC(i,j,k-1,Nx,Ny)), -cz); diag += cz; }
              if (k < Nz - 1)   { trips.emplace_back(c, static_cast<int>(idxC(i,j,k+1,Nx,Ny)), -cz); diag += cz; }
              if (diag <= 0) diag = 1.0; // safety (all-isolated cell)
              trips.emplace_back(c, c, diag);
            }
          }
        }
        Lp.setFromTriplets(trips.begin(), trips.end());
        // Fix one cell to pin pressure if no Dirichlet outlet was specified.
        // We zero row 0 + column 0 and set (0,0) = 1 so that the equation for
        // cell 0 reads p_0 = 0 (rhs(0) is forced to 0 at solve time). Column 0
        // zeroing removes the back-coupling on every other equation.
        if (!anyOutlet) {
            for (int k = 0; k < Lp.outerSize(); ++k) {
                for (Eigen::SparseMatrix<double>::InnerIterator it(Lp, k); it; ++it) {
                    if (it.row() == 0 || it.col() == 0) it.valueRef() = 0;
                }
            }
            Lp.coeffRef(0, 0) = 1.0;
            Lp.prune(0.0);
        }
        Lp.makeCompressed();
    }

    // Singular-system guard. A projection-method pressure Poisson is singular
    // (rank-deficient) unless its null space is removed by EITHER a Dirichlet
    // pressure cell (an outlet) OR the explicit one-cell pin. If neither is
    // present the operator has the constant null vector and the solve is
    // ill-posed — throw a clear error rather than letting the corrector chase a
    // RHS the operator cannot represent and drift to NaN.
    {
        bool anyOutletForPin = false;
        for (auto f : cfg.outlets) if (f < 6) { anyOutletForPin = true; break; }
        // (!anyOutlet) path above pins cell 0, so a pin always exists; this
        // assertion documents the invariant and future-proofs against an edit
        // that removes the pin. With an inlet but no outlet AND no pin the
        // system would be singular; we never reach here in that case, but the
        // check is cheap insurance.
        if (!anyOutletForPin) {
            // cell-0 pin must be present: Lp(0,0) == 1 and row 0 otherwise zero.
            if (std::abs(Lp.coeff(0, 0) - 1.0) > 1e-12) {
                throw std::runtime_error(
                    "forge.cfd.solveSteadyNS: pressure system is singular — no "
                    "outlet (Dirichlet p) and no pressure pin present. Add an "
                    "outlet face or a pressure reference.");
            }
        }
    }

    Eigen::SimplicialLDLT<Eigen::SparseMatrix<double>> ldlt(Lp);
    if (ldlt.info() != Eigen::Success) {
        // Factorisation failed → the assembled operator is singular or
        // numerically rank-deficient. Surface a clear singular-system error
        // instead of proceeding to a NaN-producing solve.
        throw std::runtime_error(
            "forge.cfd.solveSteadyNS: pressure Poisson LDLT factorisation failed "
            "(singular/inconsistent pressure system — ensure an outlet or "
            "pressure pin is present)");
    }

    auto divergenceL2 = [&]() {
        double s = 0;
        for (int k = 0; k < Nz; ++k)
          for (int j = 0; j < Ny; ++j)
            for (int i = 0; i < Nx; ++i) {
              const double dux = (u[idxU(i + 1, j, k, Nx, Ny)] - u[idxU(i, j, k, Nx, Ny)]) / dx;
              const double dvy = (v[idxV(i, j + 1, k, Nx, Ny)] - v[idxV(i, j, k, Nx, Ny)]) / dy;
              const double dwz = (w[idxW(i, j, k + 1, Nx, Ny)] - w[idxW(i, j, k, Nx, Ny)]) / dz;
              const double d = dux + dvy + dwz;
              s += d * d;
            }
        return std::sqrt(s / nCells);
    };

    // Steady-state convergence measure: L₂ norm of velocity change between
    // iterations. Divergence stays at machine precision after each projection,
    // so it can't detect "did we reach steady state" — we instead require the
    // *update* to fall below a fraction of the BC velocity scale.
    std::vector<double> uPrev = u, vPrev = v, wPrev = w;
    auto velocityChange = [&]() {
        double s = 0;
        for (std::size_t i = 0; i < u.size(); ++i) { const double d = u[i] - uPrev[i]; s += d * d; }
        for (std::size_t i = 0; i < v.size(); ++i) { const double d = v[i] - vPrev[i]; s += d * d; }
        for (std::size_t i = 0; i < w.size(); ++i) { const double d = w[i] - wPrev[i]; s += d * d; }
        return std::sqrt(s / (u.size() + v.size() + w.size()));
    };

    // Current peak face speed across all three staggered velocity arrays — the
    // quantity the advective CFL limit is actually bound to. Used to throttle
    // the explicit predictor as the channel accelerates from rest toward its
    // developed peak (see dtStep below).
    auto maxFaceSpeed = [&]() {
        double m = 0;
        for (double x : u) m = std::max(m, std::abs(x));
        for (double x : v) m = std::max(m, std::abs(x));
        for (double x : w) m = std::max(m, std::abs(x));
        return m;
    };

    // Two convergence numbers are tracked:
    //   divResidual = ‖∇·u‖₂   — divergence after projection (should sit at
    //                            machine epsilon once Poisson is exact, so
    //                            it's a *consistency* check, not steady-state).
    //   velChange   = ‖u^{n+1} - u^n‖₂ — actual progress toward steady state.
    // We exit when velChange falls below cfg.residualTol. The "residual"
    // reported back to the JS caller is the *initial* divergence (before
    // first projection) over the *final* divergence — i.e. it captures the
    // order-of-magnitude drop in incompressibility error.
    double initialDiv = 0;
    int iter = 0;
    double divResidual = 0;
    double velChange = 0;

    // -------------------------------------------------- main SIMPLE loop
    for (iter = 1; iter <= cfg.maxIter; ++iter) {
        uPrev = u; vPrev = v; wPrev = w;

        // ADAPTIVE TIMESTEP (channel-stability fix). The base dt above was
        // sized from the *initial* BC speed (uBc, e.g. the 0.1 m/s inlet). But
        // the channel develops a peak ≈ 1.5× the mean and, during the transient,
        // can briefly overshoot; the explicit first-order-upwind predictor is
        // only CFL-stable while dt ≤ hMin / u_max. Freezing dt at the inlet
        // speed therefore goes unstable the instant the interior outruns the
        // inlet, which is exactly the observed blow-up. Recompute the advective
        // limit from the CURRENT peak face speed each iteration and march with
        // the smaller of the diffusive cap and that advective limit. dtStep
        // only ever shrinks below the base dt, so it stays inside von-Neumann;
        // it never grows past dtDiff.
        double uCur = maxFaceSpeed();
        if (!std::isfinite(uCur)) {
            throw std::runtime_error(
                "forge.cfd.solveSteadyNS: solution diverged to non-finite "
                "velocity before projection (advective instability — iter "
                + std::to_string(iter) + ")");
        }
        const double dtAdvCur = 0.5 * hMin / (1.5 * std::max(uCur, 1e-6));
        const double dtStep = std::min(dt, dtAdvCur);

        // -------- 1. predictor — solve for u* (interior u-faces only) ----
        for (int k = 0; k < Nz; ++k) {
          for (int j = 0; j < Ny; ++j) {
            for (int i = 1; i < Nx; ++i) {
              const std::size_t ui = idxU(i, j, k, Nx, Ny);
              const double uC = u[ui];
              // First-order upwind advection.
              const double uE = u[idxU(i + 1, j, k, Nx, Ny)];
              const double uW = u[idxU(i - 1, j, k, Nx, Ny)];
              const double uN = uGhost(i, j + 1, k);
              const double uS = uGhost(i, j - 1, k);
              const double uT = uGhost(i, j, k + 1);
              const double uB = uGhost(i, j, k - 1);

              // Interpolated v at the u-face: average of 4 neighbouring v-faces.
              const double v_here = 0.25 * (
                v[idxV(i - 1, j,     k, Nx, Ny)] +
                v[idxV(i,     j,     k, Nx, Ny)] +
                v[idxV(i - 1, j + 1, k, Nx, Ny)] +
                v[idxV(i,     j + 1, k, Nx, Ny)]);
              const double w_here = 0.25 * (
                w[idxW(i - 1, j, k,     Nx, Ny)] +
                w[idxW(i,     j, k,     Nx, Ny)] +
                w[idxW(i - 1, j, k + 1, Nx, Ny)] +
                w[idxW(i,     j, k + 1, Nx, Ny)]);

              const double duAdx = (uC > 0 ? (uC - uW) : (uE - uC)) / dx * uC;
              const double duAdy = (v_here > 0 ? (uC - uS) : (uN - uC)) / dy * v_here;
              const double duAdz = (w_here > 0 ? (uC - uB) : (uT - uC)) / dz * w_here;

              // Central diffusion.
              const double lap = (uE - 2 * uC + uW) / (dx * dx)
                               + (uN - 2 * uC + uS) / (dy * dy)
                               + (uT - 2 * uC + uB) / (dz * dz);

              uStar[ui] = uC + dtStep * (-duAdx - duAdy - duAdz + cfg.nu * lap);
            }
          }
        }
        // Same for v* (interior v-faces).
        for (int k = 0; k < Nz; ++k) {
          for (int j = 1; j < Ny; ++j) {
            for (int i = 0; i < Nx; ++i) {
              const std::size_t vi = idxV(i, j, k, Nx, Ny);
              const double vC = v[vi];
              const double vN = v[idxV(i, j + 1, k, Nx, Ny)];
              const double vS = v[idxV(i, j - 1, k, Nx, Ny)];
              const double vE = vGhost(i + 1, j, k);
              const double vW = vGhost(i - 1, j, k);
              const double vT = vGhost(i, j, k + 1);
              const double vB = vGhost(i, j, k - 1);

              const double u_here = 0.25 * (
                u[idxU(i,     j - 1, k, Nx, Ny)] +
                u[idxU(i + 1, j - 1, k, Nx, Ny)] +
                u[idxU(i,     j,     k, Nx, Ny)] +
                u[idxU(i + 1, j,     k, Nx, Ny)]);
              const double w_here = 0.25 * (
                w[idxW(i, j - 1, k,     Nx, Ny)] +
                w[idxW(i, j,     k,     Nx, Ny)] +
                w[idxW(i, j - 1, k + 1, Nx, Ny)] +
                w[idxW(i, j,     k + 1, Nx, Ny)]);

              const double dvAdx = (u_here > 0 ? (vC - vW) : (vE - vC)) / dx * u_here;
              const double dvAdy = (vC > 0 ? (vC - vS) : (vN - vC)) / dy * vC;
              const double dvAdz = (w_here > 0 ? (vC - vB) : (vT - vC)) / dz * w_here;

              const double lap = (vE - 2 * vC + vW) / (dx * dx)
                               + (vN - 2 * vC + vS) / (dy * dy)
                               + (vT - 2 * vC + vB) / (dz * dz);

              vStar[vi] = vC + dtStep * (-dvAdx - dvAdy - dvAdz + cfg.nu * lap);
            }
          }
        }
        // Same for w*.
        for (int k = 1; k < Nz; ++k) {
          for (int j = 0; j < Ny; ++j) {
            for (int i = 0; i < Nx; ++i) {
              const std::size_t wi = idxW(i, j, k, Nx, Ny);
              const double wC = w[wi];
              const double wE = wGhost(i + 1, j, k);
              const double wW = wGhost(i - 1, j, k);
              const double wN = wGhost(i, j + 1, k);
              const double wS = wGhost(i, j - 1, k);
              const double wT = w[idxW(i, j, k + 1, Nx, Ny)];
              const double wB = w[idxW(i, j, k - 1, Nx, Ny)];

              const double u_here = 0.25 * (
                u[idxU(i,     j, k - 1, Nx, Ny)] +
                u[idxU(i + 1, j, k - 1, Nx, Ny)] +
                u[idxU(i,     j, k,     Nx, Ny)] +
                u[idxU(i + 1, j, k,     Nx, Ny)]);
              const double v_here = 0.25 * (
                v[idxV(i, j,     k - 1, Nx, Ny)] +
                v[idxV(i, j + 1, k - 1, Nx, Ny)] +
                v[idxV(i, j,     k,     Nx, Ny)] +
                v[idxV(i, j + 1, k,     Nx, Ny)]);

              const double dwAdx = (u_here > 0 ? (wC - wW) : (wE - wC)) / dx * u_here;
              const double dwAdy = (v_here > 0 ? (wC - wS) : (wN - wC)) / dy * v_here;
              const double dwAdz = (wC > 0 ? (wC - wB) : (wT - wC)) / dz * wC;

              const double lap = (wE - 2 * wC + wW) / (dx * dx)
                               + (wN - 2 * wC + wS) / (dy * dy)
                               + (wT - 2 * wC + wB) / (dz * dz);

              wStar[wi] = wC + dtStep * (-dwAdx - dwAdy - dwAdz + cfg.nu * lap);
            }
          }
        }

        // Re-apply BCs (the predictor never touches boundary faces in the
        // loops above, but inlet/wall values can drift slightly so make sure).
        applyVelocityBCs(uStar, vStar, wStar);
        // UPGRADE B: enforce the outflow BC + global mass conservation on the
        // tentative field BEFORE the pressure solve. This makes ∮∇·u* dV (the
        // integral of the Poisson RHS) consistent with the Neumann/Dirichlet
        // operator, so the corrector can drive ∇·u→0 instead of accumulating a
        // net source that blows the pressure up to NaN.
        applyOutletBCs(uStar, vStar, wStar);

        // Capture the pre-projection divergence on iter 1 — this is the
        // honest "initial residual" the smoke test can compare against the
        // post-projection machine-epsilon final residual.
        if (iter == 1) {
            auto preU = u, preV = v, preW = w;
            std::swap(u, uStar); std::swap(v, vStar); std::swap(w, wStar);
            initialDiv = std::max(divergenceL2(), 1e-12);
            std::swap(u, uStar); std::swap(v, vStar); std::swap(w, wStar);
            u = preU; v = preV; w = preW;
        }

        // -------- 2. solve pressure Poisson ∇²p = (ρ/Δt) ∇·u* ------------
        //
        // We assembled Lp = −∇²p (positive-definite). The Poisson equation
        //   ∇²p = (ρ/Δt) ∇·u*
        // therefore becomes
        //   Lp p = −(ρ/Δt) ∇·u*
        // — note the sign flip on the RHS to match the positive-definite
        // operator. This is what makes the corrector ∇·u_new = 0 exactly:
        //   ∇·u_new = ∇·u* − (Δt/ρ) ∇²p
        //           = ∇·u* − (Δt/ρ) · (−Lp p / 1)
        //           = ∇·u* − (Δt/ρ) · (ρ/Δt) ∇·u*   (because Lp p = −rhs)
        //           = 0
        Eigen::VectorXd rhs(nCells);
        // RHS scale uses the SAME dtStep as the corrector below so the
        // projection identity ∇·u_new = 0 holds exactly regardless of the
        // adaptive timestep (the dt cancels: rhs ∝ ρ/dtStep, corrector ∝
        // dtStep/ρ).
        const double scale = -cfg.rho / dtStep;
        for (int k = 0; k < Nz; ++k)
          for (int j = 0; j < Ny; ++j)
            for (int i = 0; i < Nx; ++i) {
              const int c = static_cast<int>(idxC(i, j, k, Nx, Ny));
              const double dux = (uStar[idxU(i + 1, j, k, Nx, Ny)] - uStar[idxU(i, j, k, Nx, Ny)]) / dx;
              const double dvy = (vStar[idxV(i, j + 1, k, Nx, Ny)] - vStar[idxV(i, j, k, Nx, Ny)]) / dy;
              const double dwz = (wStar[idxW(i, j, k + 1, Nx, Ny)] - wStar[idxW(i, j, k, Nx, Ny)]) / dz;
              rhs(c) = scale * (dux + dvy + dwz);
            }
        // For outlet Dirichlet cells force rhs = 0; cell-0 pin handled below.
        for (int k = 0; k < Nz; ++k)
          for (int j = 0; j < Ny; ++j)
            for (int i = 0; i < Nx; ++i) {
              bool onOutlet = false;
              if (face[0].isOutlet && i == 0)         onOutlet = true;
              if (face[1].isOutlet && i == Nx - 1)    onOutlet = true;
              if (face[2].isOutlet && j == 0)         onOutlet = true;
              if (face[3].isOutlet && j == Ny - 1)    onOutlet = true;
              if (face[4].isOutlet && k == 0)         onOutlet = true;
              if (face[5].isOutlet && k == Nz - 1)    onOutlet = true;
              if (onOutlet) rhs(static_cast<int>(idxC(i, j, k, Nx, Ny))) = 0.0;
            }
        bool anyOutlet = false;
        for (auto f : cfg.outlets) if (f < 6) { anyOutlet = true; break; }
        if (!anyOutlet) rhs(0) = 0.0;

        Eigen::VectorXd pVec = ldlt.solve(rhs);
        if (ldlt.info() != Eigen::Success) {
            throw std::runtime_error(
                "forge.cfd.solveSteadyNS: pressure Poisson solve failed");
        }
        for (int c = 0; c < nCells; ++c) p[c] = pVec(c);

        // -------- 3. velocity corrector ----------------------------------
        // Standard pressure-projection corrector: u^{n+1} = u* - (Δt/ρ) ∇p.
        // No under-relaxation — the tight timestep above keeps it stable.
        const double k_dt_rho = dtStep / cfg.rho;
        for (int k = 0; k < Nz; ++k)
          for (int j = 0; j < Ny; ++j)
            for (int i = 1; i < Nx; ++i) {
              const std::size_t ui = idxU(i, j, k, Nx, Ny);
              const double dpdx = (p[idxC(i, j, k, Nx, Ny)]
                                 - p[idxC(i - 1, j, k, Nx, Ny)]) / dx;
              u[ui] = uStar[ui] - k_dt_rho * dpdx;
            }
        for (int k = 0; k < Nz; ++k)
          for (int j = 1; j < Ny; ++j)
            for (int i = 0; i < Nx; ++i) {
              const std::size_t vi = idxV(i, j, k, Nx, Ny);
              const double dpdy = (p[idxC(i, j, k, Nx, Ny)]
                                 - p[idxC(i, j - 1, k, Nx, Ny)]) / dy;
              v[vi] = vStar[vi] - k_dt_rho * dpdy;
            }
        for (int k = 1; k < Nz; ++k)
          for (int j = 0; j < Ny; ++j)
            for (int i = 0; i < Nx; ++i) {
              const std::size_t wi = idxW(i, j, k, Nx, Ny);
              const double dpdz = (p[idxC(i, j, k, Nx, Ny)]
                                 - p[idxC(i, j, k - 1, Nx, Ny)]) / dz;
              w[wi] = wStar[wi] - k_dt_rho * dpdz;
            }
        applyVelocityBCs(u, v, w);
        // UPGRADE B: re-impose the outflow BC + mass conservation on the
        // corrected field so the reported velocity carries the channel through-
        // flow at the outlet (the corrector's ∂p/∂n term does not act on the
        // boundary face itself).
        applyOutletBCs(u, v, w);

        divResidual = divergenceL2();
        velChange   = velocityChange();

        // UPGRADE B: NaN / divergence guard. If the pressure system is singular
        // or inconsistent (e.g. an open domain with no Dirichlet pressure pin
        // and a net mass imbalance), the projection cannot clean up divergence
        // and the field blows up. Detect a non-finite or runaway residual and
        // report it as a real error instead of silently returning NaN/maxVel=0.
        if (!std::isfinite(divResidual) || !std::isfinite(velChange)) {
            throw std::runtime_error(
                "forge.cfd.solveSteadyNS: solution diverged to non-finite values "
                "(singular/inconsistent pressure system — check that an outlet or "
                "pressure pin is present and inflow == outflow). Iter "
                + std::to_string(iter));
        }
        // Runaway guard: catch an exploding-but-still-finite field before it
        // overflows to inf. A correctly posed laminar channel settles to a peak
        // of O(1.5·u_inlet); a velocity exceeding a large multiple of the
        // driving BC speed (uBc) is unphysical and signals instability. We throw
        // a clear error so the JS caller never receives a garbage finite number.
        {
            const double umaxNow = maxFaceSpeed();
            if (umaxNow > 1e6 * std::max(uBc, 1.0)) {
                throw std::runtime_error(
                    "forge.cfd.solveSteadyNS: solution diverging (velocity "
                    "magnitude " + std::to_string(umaxNow) + " m/s >> driving "
                    "speed) — advective instability or inconsistent open-domain "
                    "mass balance. Iter " + std::to_string(iter));
            }
        }
        // initialDiv already set on iter==1 by the pre-projection capture above.
        if (std::getenv("FORGE_CFD_TRACE")) {
            double umaxNow = 0;
            for (double x : u) umaxNow = std::max(umaxNow, std::abs(x));
            double pmax = 0;
            for (double x : p) pmax = std::max(pmax, std::abs(x));
            std::fprintf(stderr, "[cfd] iter %d dtStep %.3e divRes %.3e velChange %.3e maxU %.3e maxP %.3e\n",
                         iter, dtStep, divResidual, velChange, umaxNow, pmax);
        }
        if (iter > 1 && velChange < cfg.residualTol) break;
    }

    // ---------------------------------------------------- output assembly
    CfdResult out;
    out.u.resize(nCells);
    out.v.resize(nCells);
    out.w.resize(nCells);
    out.p.resize(nCells);

    double maxV = 0;
    for (int k = 0; k < Nz; ++k)
      for (int j = 0; j < Ny; ++j)
        for (int i = 0; i < Nx; ++i) {
          const std::size_t c = idxC(i, j, k, Nx, Ny);
          const double uc = 0.5 * (u[idxU(i, j, k, Nx, Ny)] + u[idxU(i + 1, j, k, Nx, Ny)]);
          const double vc = 0.5 * (v[idxV(i, j, k, Nx, Ny)] + v[idxV(i, j + 1, k, Nx, Ny)]);
          const double wc = 0.5 * (w[idxW(i, j, k, Nx, Ny)] + w[idxW(i, j, k + 1, Nx, Ny)]);
          out.u[c] = uc; out.v[c] = vc; out.w[c] = wc;
          out.p[c] = p[c];
          const double mag = std::sqrt(uc * uc + vc * vc + wc * wc);
          if (mag > maxV) maxV = mag;
        }
    out.maxVelocity = maxV;
    const double Lref = std::max({Lx, Ly, Lz});
    out.reynolds    = (maxV * Lref) / cfg.nu;
    out.iterations  = std::min(iter, cfg.maxIter);
    // Final divergence residual = ‖∇·u‖ after the last projection step.
    // Should sit at machine epsilon since the Poisson is exact. Initial =
    // ‖∇·u*‖ on the first iteration before the first projection (captured
    // above) — that's the un-projected divergence the lid BC creates, so the
    // ratio reflects how well the projection cleans up incompressibility.
    out.finalResidual   = std::max(divResidual, 1e-16);
    out.initialResidual = initialDiv;

    auto endWall = std::chrono::steady_clock::now();
    out.cpuMs = std::chrono::duration<double, std::milli>(endWall - startWall).count();
    return out;
}

} // namespace forge::cfd
