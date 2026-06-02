#include "forge/Casting.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace forge { namespace casting {

namespace {

inline std::size_t idx(int i, int j, int k, int Nx, int Ny) {
    return (static_cast<std::size_t>(k) * Ny + j) * Nx + i;
}

// Piecewise inversion: given the volumetric enthalpy density H (J/m³) and
// the alloy thermodynamics, return T (K).
// Three regimes:
//   1. H ≤ H_solidus  ⇒  T = H / (ρ·cp)       (fully solid, no phase Δ)
//   2. H_solidus < H < H_liquidus
//                     ⇒  T = T_sol + (H − H_sol) / (H_liq − H_sol) × (T_liq − T_sol)
//   3. H ≥ H_liquidus ⇒  T = T_liq + (H − H_liq) / (ρ·cp)
// where H_sol = ρ·cp·T_sol  and  H_liq = ρ·cp·T_liq + ρ·L.
inline double Hto_T(double H, double rho, double cp, double L,
                    double Tsol, double Tliq) {
    const double Hsol = rho * cp * Tsol;
    const double Hliq = rho * cp * Tliq + rho * L;
    if (H <= Hsol) return H / (rho * cp);
    if (H >= Hliq) return Tliq + (H - Hliq) / (rho * cp);
    // Mushy interval — T held nearly constant while H spans ρ·L.
    return Tsol + (H - Hsol) / (Hliq - Hsol) * (Tliq - Tsol);
}

} // anonymous namespace

CastingResult solidify(const CastingConfig& cfg) {
    if (cfg.Nx < 2 || cfg.Ny < 2 || cfg.Nz < 2) {
        throw std::invalid_argument("forge.casting: grid dims must be ≥ 2");
    }
    if (!(cfg.alloy.rho > 0 && cfg.alloy.cp > 0 && cfg.alloy.k > 0)) {
        throw std::invalid_argument("forge.casting: alloy.rho/cp/k must be > 0");
    }
    if (cfg.alloy.Tliquidus < cfg.alloy.Tsolidus + 1e-9) {
        throw std::invalid_argument("forge.casting: Tliquidus must exceed Tsolidus");
    }
    if (!(cfg.endTimeSec > 0)) {
        throw std::invalid_argument("forge.casting: endTimeSec must be > 0");
    }
    if (cfg.cflFactor <= 0 || cfg.cflFactor > 0.5) {
        throw std::invalid_argument("forge.casting: cflFactor must be in (0, 0.5]");
    }
    if (cfg.sampleEvery < 1) {
        throw std::invalid_argument("forge.casting: sampleEvery must be ≥ 1");
    }
    if (cfg.cavityMask.size() !=
        static_cast<std::size_t>(cfg.Nx) * cfg.Ny * cfg.Nz) {
        throw std::invalid_argument("forge.casting: cavityMask size must equal Nx·Ny·Nz");
    }

    const int Nx = cfg.Nx, Ny = cfg.Ny, Nz = cfg.Nz;
    const std::size_t N = static_cast<std::size_t>(Nx) * Ny * Nz;
    const double dx = (cfg.maxX - cfg.minX) / (Nx - 1);
    const double dy = (cfg.maxY - cfg.minY) / (Ny - 1);
    const double dz = (cfg.maxZ - cfg.minZ) / (Nz - 1);
    const double hmin = std::min({ dx, dy, dz });

    const double rho = cfg.alloy.rho;
    const double cp  = cfg.alloy.cp;
    const double k   = cfg.alloy.k;
    const double L   = cfg.alloy.L;
    const double Tsol = cfg.alloy.Tsolidus;
    const double Tliq = cfg.alloy.Tliquidus;

    // Explicit FTCS stability — derived from diffusion CFL:
    //   Δt ≤ cfl · (1 / (2·α·(1/dx² + 1/dy² + 1/dz²))),   α = k / (ρ cp).
    const double alpha = k / (rho * cp);
    const double invHsum = 1.0 / (dx * dx) + 1.0 / (dy * dy) + 1.0 / (dz * dz);
    const double dt = cfg.cflFactor / (2.0 * alpha * invHsum);
    if (!(dt > 0)) {
        throw std::runtime_error("forge.casting: degenerate Δt computed");
    }
    const int nSteps = static_cast<int>(std::ceil(cfg.endTimeSec / dt));

    // Enthalpy field. Initialise inside the cavity at T = Tpour (so above
    // Tliq → fully liquid → H = ρcp·T + ρ·L). Outside cells parked at
    // ρcp·Tambient (no latent heat, no contribution).
    std::vector<double> H(N), Hn(N);
    std::vector<double> T(N, 0.0);
    int cellsSimulated = 0;
    for (std::size_t i = 0; i < N; ++i) {
        if (cfg.cavityMask[i]) {
            H[i] = rho * cp * cfg.Tpour + rho * L;
            T[i] = cfg.Tpour;
            ++cellsSimulated;
        } else {
            H[i] = rho * cp * cfg.TambientK;
            T[i] = cfg.TambientK;
        }
    }
    if (cellsSimulated == 0) {
        throw std::invalid_argument("forge.casting: cavityMask has no melt voxels");
    }

    std::vector<double> solidTime(N, -1.0);
    std::vector<double> peakT(N, 0.0);
    for (std::size_t i = 0; i < N; ++i) peakT[i] = T[i];
    std::vector<double> niyama(N, 0.0);

    CastingResult R;
    R.Nx = Nx; R.Ny = Ny; R.Nz = Nz;
    R.cellsSimulated = cellsSimulated;
    R.cellsSolidified = 0;
    R.totalSimTimeSec = 0;
    R.maxSolidTimeSec = 0;
    R.avgSolidTimeSec = 0;

    // Helper: face heat flux between two voxels at temperatures Ta, Tb,
    // multiplied by the face area. The wall (mask=0) face uses Newton BC.
    auto faceFlux = [&](double Ti, double Tj, bool wall,
                        double area, double dist) {
        if (wall) {
            // Newton convection with ambient
            return cfg.hWall * (Ti - cfg.TambientK) * area;
        }
        return k * (Ti - Tj) / dist * area;
    };

    int step = 0;
    double simT = 0.0;
    for (step = 0; step < nSteps; ++step, simT += dt) {
        // Compute new H per cell.
        for (int kk = 0; kk < Nz; ++kk) {
            for (int jj = 0; jj < Ny; ++jj) {
                for (int ii = 0; ii < Nx; ++ii) {
                    std::size_t c = idx(ii, jj, kk, Nx, Ny);
                    if (!cfg.cavityMask[c]) { Hn[c] = H[c]; continue; }
                    const double Tc = T[c];
                    double q = 0.0;
                    // 6-neighbour heat flux out of cell:
                    // X-faces (area = dy·dz, distance dx)
                    const double Axf = dy * dz;
                    // -X
                    {
                        const bool out = (ii == 0) || !cfg.cavityMask[idx(ii - 1, jj, kk, Nx, Ny)];
                        const double Tn = out ? Tc : T[idx(ii - 1, jj, kk, Nx, Ny)];
                        q += faceFlux(Tc, Tn, out, Axf, dx);
                    }
                    // +X
                    {
                        const bool out = (ii == Nx - 1) || !cfg.cavityMask[idx(ii + 1, jj, kk, Nx, Ny)];
                        const double Tn = out ? Tc : T[idx(ii + 1, jj, kk, Nx, Ny)];
                        q += faceFlux(Tc, Tn, out, Axf, dx);
                    }
                    // Y-faces
                    const double Ayf = dx * dz;
                    {
                        const bool out = (jj == 0) || !cfg.cavityMask[idx(ii, jj - 1, kk, Nx, Ny)];
                        const double Tn = out ? Tc : T[idx(ii, jj - 1, kk, Nx, Ny)];
                        q += faceFlux(Tc, Tn, out, Ayf, dy);
                    }
                    {
                        const bool out = (jj == Ny - 1) || !cfg.cavityMask[idx(ii, jj + 1, kk, Nx, Ny)];
                        const double Tn = out ? Tc : T[idx(ii, jj + 1, kk, Nx, Ny)];
                        q += faceFlux(Tc, Tn, out, Ayf, dy);
                    }
                    // Z-faces
                    const double Azf = dx * dy;
                    {
                        const bool out = (kk == 0) || !cfg.cavityMask[idx(ii, jj, kk - 1, Nx, Ny)];
                        const double Tn = out ? Tc : T[idx(ii, jj, kk - 1, Nx, Ny)];
                        q += faceFlux(Tc, Tn, out, Azf, dz);
                    }
                    {
                        const bool out = (kk == Nz - 1) || !cfg.cavityMask[idx(ii, jj, kk + 1, Nx, Ny)];
                        const double Tn = out ? Tc : T[idx(ii, jj, kk + 1, Nx, Ny)];
                        q += faceFlux(Tc, Tn, out, Azf, dz);
                    }
                    // Cell volume
                    const double Vc = dx * dy * dz;
                    // ∂H/∂t = −q / V   (q is net OUT; H decreases when q > 0)
                    Hn[c] = H[c] - dt * (q / Vc);
                }
            }
        }
        // Recover T, record solidification times, update peak, snapshot.
        H.swap(Hn);
        for (int kk = 0; kk < Nz; ++kk) {
            for (int jj = 0; jj < Ny; ++jj) {
                for (int ii = 0; ii < Nx; ++ii) {
                    std::size_t c = idx(ii, jj, kk, Nx, Ny);
                    if (!cfg.cavityMask[c]) continue;
                    const double Tprev = T[c];
                    const double Tnew = Hto_T(H[c], rho, cp, L, Tsol, Tliq);
                    T[c] = Tnew;
                    if (Tnew > peakT[c]) peakT[c] = Tnew;
                    if (solidTime[c] < 0.0) {
                        if (Tprev >= Tliq && Tnew < Tliq) {
                            solidTime[c] = simT;
                            ++R.cellsSolidified;
                            // Niyama at this moment: G/√R.
                            // G ≈ |∇T| from central differences (1-sided at edges).
                            auto sampleT = [&](int i2, int j2, int k2) {
                                int ic = std::clamp(i2, 0, Nx - 1);
                                int jc = std::clamp(j2, 0, Ny - 1);
                                int kc = std::clamp(k2, 0, Nz - 1);
                                return T[idx(ic, jc, kc, Nx, Ny)];
                            };
                            const double Tx = (sampleT(ii + 1, jj, kk) - sampleT(ii - 1, jj, kk)) / (2 * dx);
                            const double Ty = (sampleT(ii, jj + 1, kk) - sampleT(ii, jj - 1, kk)) / (2 * dy);
                            const double Tz = (sampleT(ii, jj, kk + 1) - sampleT(ii, jj, kk - 1)) / (2 * dz);
                            const double G = std::sqrt(Tx * Tx + Ty * Ty + Tz * Tz);
                            const double R_rate = std::max(1e-6, (Tprev - Tnew) / dt); // K/s
                            niyama[c] = G / std::sqrt(R_rate);
                        }
                    }
                }
            }
        }
        if (step % cfg.sampleEvery == 0) {
            R.snapshotTimesSec.push_back(simT);
            R.tempSnapshots.push_back(T);  // copy
        }
    }
    R.totalSimTimeSec = simT;
    R.solidTimeSec = std::move(solidTime);
    R.peakTempK    = std::move(peakT);
    R.niyama       = std::move(niyama);
    double maxSt = 0, sumSt = 0;
    int countSt = 0;
    for (std::size_t i = 0; i < N; ++i) {
        if (R.solidTimeSec[i] > maxSt) maxSt = R.solidTimeSec[i];
        if (R.solidTimeSec[i] >= 0) { sumSt += R.solidTimeSec[i]; ++countSt; }
    }
    R.maxSolidTimeSec = maxSt;
    R.avgSolidTimeSec = countSt > 0 ? sumSt / countSt : 0.0;
    return R;
}

}} // namespace forge::casting
