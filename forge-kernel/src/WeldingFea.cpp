#include "forge/WeldingFea.hpp"

#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace forge { namespace welding {

namespace la = forge::native::linalg;

namespace {

constexpr double PI = 3.14159265358979323846;

inline std::size_t T3(std::size_t t, int i) { return 4 * t + i; }

// 3 × 4 tet shape-function gradient matrix B_T (so ∇T ≈ B_T · T_nodes).
//   N_i(x) is linear in (x,y,z); ∇N_i is constant per tet.
//   B_T[d, i] = (1/(6V)) × cofactor_d_i where the cofactor comes from
//   the 4×4 system [1 x y z] of the tet vertices.
// Returns volume V (signed; we keep |V|).
double tetGrads(const double n[12], double grads[12], double& volOut) {
    la::MatrixD M(4, 4);
    for (int i = 0; i < 4; ++i) {
        M(i, 0) = 1.0;
        M(i, 1) = n[3 * i + 0];
        M(i, 2) = n[3 * i + 1];
        M(i, 3) = n[3 * i + 2];
    }
    la::LU<double> luM(M);
    const double det = luM.determinant();
    const double V = std::abs(det) / 6.0;
    if (V < 1e-20) { volOut = 0.0; return 0.0; }
    la::MatrixD Minv = luM.inverse();
    // ∂N_i/∂x_d = Minv(d+1, i)  for d = 0..2, i = 0..3
    for (int i = 0; i < 4; ++i) {
        grads[3 * i + 0] = Minv(1, i);
        grads[3 * i + 1] = Minv(2, i);
        grads[3 * i + 2] = Minv(3, i);
    }
    volOut = V;
    return V;
}

// 6 × 12 strain-displacement matrix B for a linear tet, packed in row-major.
// Strain order: εxx, εyy, εzz, γxy, γyz, γzx.
void buildB(const double grads[12], la::MatrixD& B) {
    B.setZero();
    for (int i = 0; i < 4; ++i) {
        const double dx = grads[3 * i + 0];
        const double dy = grads[3 * i + 1];
        const double dz = grads[3 * i + 2];
        const int c = 3 * i;
        B(0, c + 0) = dx;
        B(1, c + 1) = dy;
        B(2, c + 2) = dz;
        B(3, c + 0) = dy; B(3, c + 1) = dx;
        B(4, c + 1) = dz; B(4, c + 2) = dy;
        B(5, c + 0) = dz; B(5, c + 2) = dx;
    }
}

// 6 × 6 elastic constitutive matrix D (isotropic).
la::MatrixD elasticD(double E, double nu) {
    la::MatrixD D(6, 6);
    const double c = E / ((1.0 + nu) * (1.0 - 2.0 * nu));
    D(0, 0) = c * (1.0 - nu); D(1, 1) = c * (1.0 - nu); D(2, 2) = c * (1.0 - nu);
    D(0, 1) = c * nu; D(0, 2) = c * nu;
    D(1, 0) = c * nu; D(1, 2) = c * nu;
    D(2, 0) = c * nu; D(2, 1) = c * nu;
    const double G = E / (2.0 * (1.0 + nu));
    D(3, 3) = G; D(4, 4) = G; D(5, 5) = G;
    return D;
}

// Goldak heat density at world position (x, y, z) for a torch centred at
// (tx, ty, tz) moving with unit tangent (ux, uy, uz).
double goldakDensity(double x, double y, double z,
                     double tx, double ty, double tz,
                     double ux, double uy, double uz,
                     const GoldakSource& src) {
    // Local axes: x' along path, y' perpendicular in-plane (estimate via
    // cross with global Z), z' depth (cross x' × y').
    const double rx = x - tx, ry = y - ty, rz = z - tz;
    // x' projection
    const double xp = rx * ux + ry * uy + rz * uz;
    // y' = unit × global Z then normalise
    double yax = uy * 0.0 - uz * 0.0;   // dummy
    double yx = uy, yy = -ux, yz = 0.0;  // u × ẑ when ẑ = (0,0,1)
    const double yL = std::sqrt(yx * yx + yy * yy + yz * yz);
    if (yL < 1e-9) { yx = 1.0; yy = 0.0; yz = 0.0; }
    else           { yx /= yL; yy /= yL; yz /= yL; }
    const double yp = rx * yx + ry * yy + rz * yz;
    // z' = x' × y'
    const double zx = uy * yz - uz * yy;
    const double zy = uz * yx - ux * yz;
    const double zz = ux * yy - uy * yx;
    const double zp = rx * zx + ry * zy + rz * zz;
    const double a = src.a, b = src.b;
    const double cx = (xp >= 0) ? src.cf : src.cr;
    const double f  = (xp >= 0) ? src.ff : src.fr;
    const double C  = 6.0 * std::sqrt(3.0) * f * src.power
                    / (PI * std::sqrt(PI) * a * b * cx);
    const double expArg = -3.0 * ((xp * xp) / (cx * cx)
                                + (yp * yp) / (a  * a)
                                + (zp * zp) / (b  * b));
    if (expArg < -50.0) return 0.0;   // negligible
    return C * std::exp(expArg);
    (void)yax;
}

// Path tangent + position at parameter s along the polyline.
void pathAt(const std::vector<double>& pathXYZ, double s,
            double& x, double& y, double& z,
            double& ux, double& uy, double& uz) {
    const std::size_t segs = pathXYZ.size() / 3 - 1;
    double rem = s;
    for (std::size_t i = 0; i < segs; ++i) {
        const double x0 = pathXYZ[3*i+0], y0 = pathXYZ[3*i+1], z0 = pathXYZ[3*i+2];
        const double x1 = pathXYZ[3*(i+1)+0], y1 = pathXYZ[3*(i+1)+1], z1 = pathXYZ[3*(i+1)+2];
        const double dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const double L = std::sqrt(dx*dx + dy*dy + dz*dz);
        if (rem <= L || i == segs - 1) {
            const double t = std::min(L, std::max(0.0, rem)) / std::max(1e-9, L);
            x = x0 + t * dx; y = y0 + t * dy; z = z0 + t * dz;
            ux = dx / std::max(1e-9, L);
            uy = dy / std::max(1e-9, L);
            uz = dz / std::max(1e-9, L);
            return;
        }
        rem -= L;
    }
}

double pathLength(const std::vector<double>& pathXYZ) {
    double L = 0.0;
    for (std::size_t i = 1; i < pathXYZ.size() / 3; ++i) {
        const double dx = pathXYZ[3*i+0] - pathXYZ[3*(i-1)+0];
        const double dy = pathXYZ[3*i+1] - pathXYZ[3*(i-1)+1];
        const double dz = pathXYZ[3*i+2] - pathXYZ[3*(i-1)+2];
        L += std::sqrt(dx*dx + dy*dy + dz*dz);
    }
    return L;
}

} // anonymous namespace

WeldResult simulateWeld(const TetMesh& mesh,
                        const Material& mat,
                        const GoldakSource& src,
                        double totalTimeSec,
                        int    snapshotCount) {
    const std::size_t N = mesh.nodes.size() / 3;
    const std::size_t M = mesh.tets.size()  / 4;
    if (N < 4)  throw std::invalid_argument("forge.welding: need ≥ 4 nodes");
    if (M < 1)  throw std::invalid_argument("forge.welding: need ≥ 1 tet");
    if (mesh.fixedDof.size() != 3 * N) {
        throw std::invalid_argument("forge.welding: fixedDof size must be 3N");
    }
    if (src.pathXYZ.size() < 6) {
        throw std::invalid_argument("forge.welding: path must have ≥ 2 points");
    }
    if (snapshotCount < 1) snapshotCount = 4;

    // ----------------------- per-tet geometry + B matrix + volumes
    std::vector<double> tetGradsArr(M * 12);
    std::vector<double> tetVol(M, 0.0);
    std::vector<la::MatrixD> tetBmat(M, la::MatrixD(6, 12));
    la::MatrixD Delast = elasticD(mat.E, mat.nu);
    for (std::size_t t = 0; t < M; ++t) {
        double n[12];
        for (int i = 0; i < 4; ++i) {
            const uint32_t id = mesh.tets[4 * t + i];
            if (id >= N) {
                throw std::invalid_argument("forge.welding: tet index out of range");
            }
            n[3 * i + 0] = mesh.nodes[3 * id + 0];
            n[3 * i + 1] = mesh.nodes[3 * id + 1];
            n[3 * i + 2] = mesh.nodes[3 * id + 2];
        }
        double V;
        tetGrads(n, tetGradsArr.data() + 12 * t, V);
        tetVol[t] = V;
        buildB(tetGradsArr.data() + 12 * t, tetBmat[t]);
    }

    // ----------------------- lumped capacity matrix
    std::vector<double> capacity(N, 0.0);
    for (std::size_t t = 0; t < M; ++t) {
        const double m = mat.rho * mat.cp * tetVol[t] / 4.0;
        for (int i = 0; i < 4; ++i) capacity[mesh.tets[4*t+i]] += m;
    }
    // Avoid /0 — orphan nodes (shouldn't happen) get a small mass.
    for (auto& c : capacity) if (c < 1e-12) c = 1e-12;

    // ----------------------- explicit thermal stepping
    // CFL-style Δt = cflFactor · ρ·cp·dx² / k where dx is the typical
    // edge length. We estimate dx as cbrt(V_mean).
    double vMean = 0;
    for (auto v : tetVol) vMean += v;
    vMean /= M;
    const double dxEst = std::pow(std::max(1e-12, vMean), 1.0 / 3.0);
    const double alpha = mat.k / (mat.rho * mat.cp);
    double dt = 0.20 * dxEst * dxEst / alpha;
    // Cap to avoid losing path-resolution: ≥ 30 steps per path traversal.
    const double pathL = pathLength(src.pathXYZ);
    const double traversalSec = pathL / std::max(1e-9, src.speed);
    if (dt > traversalSec / 30.0) dt = traversalSec / 30.0;
    if (dt > totalTimeSec / 30.0) dt = totalTimeSec / 30.0;
    if (dt <= 0) dt = totalTimeSec / 100.0;

    const int nSteps = std::max(10, static_cast<int>(std::ceil(totalTimeSec / dt)));

    std::vector<double> Tnow(N, mat.Tref);
    std::vector<double> Tpeak(N, mat.Tref);

    std::vector<int> snapStep(snapshotCount);
    for (int s = 0; s < snapshotCount; ++s) {
        snapStep[s] = static_cast<int>((static_cast<double>(s + 1) / snapshotCount) * nSteps);
    }

    // Plastic strain history (accumulated over snapshots).
    std::vector<double> ePeq(M, 0.0);   // equivalent plastic strain
    std::vector<std::vector<double>> ePlastic(M, std::vector<double>(6, 0.0));
    std::vector<double> misesOut(M, 0.0);

    // Build the mechanical stiffness matrix K (constant under linear
    // elasticity assumption — we update the right-hand side each snapshot).
    la::SparseCSR<double> K(3 * N, 3 * N);
    std::vector<la::Triplet<double>> trips;
    trips.reserve(M * 144);
    for (std::size_t t = 0; t < M; ++t) {
        la::MatrixD Ke = tetBmat[t].transpose() * Delast * tetBmat[t];
        uint32_t ids[4] = { mesh.tets[4*t], mesh.tets[4*t+1],
                            mesh.tets[4*t+2], mesh.tets[4*t+3] };
        for (int a = 0; a < 4; ++a) {
            for (int b = 0; b < 4; ++b) {
                for (int i = 0; i < 3; ++i) {
                    for (int j = 0; j < 3; ++j) {
                        trips.emplace_back(3 * ids[a] + i, 3 * ids[b] + j,
                                           Ke(3 * a + i, 3 * b + j) * tetVol[t]);
                    }
                }
            }
        }
    }

    // Apply Dirichlet BC: zero rows + cols for fixed dofs (penalty method
    // — set K_ii = penalty and f_i = 0 instead of removing). Folded into the
    // triplet list as a duplicate diagonal entry; setFromTriplets SUMS
    // duplicates, which is numerically identical to K_ii += penalty on the
    // assembled matrix (la::SparseCSR has no post-assembly coeffRef mutation).
    const double penalty = 1e20;
    for (std::size_t i = 0; i < 3 * N; ++i) {
        if (mesh.fixedDof[i]) trips.emplace_back(i, i, penalty);
    }
    K.setFromTriplets(3 * N, 3 * N, trips);

    la::SparseLU mechSolver;
    mechSolver.compute(K);
    if (!mechSolver.ok()) {
        throw std::runtime_error("forge.welding: mechanical K factorisation failed");
    }

    std::vector<double> uTotal(3 * N, 0.0);
    int snapIdx = 0;
    int thermalSteps = 0;

    for (int step = 0; step < nSteps; ++step) {
        const double simT = (step + 0.5) * dt;
        // Torch position along path
        const double s = std::min(pathL, src.speed * simT);
        double tx, ty, tz, ux, uy, uz;
        pathAt(src.pathXYZ, s, tx, ty, tz, ux, uy, uz);

        // Heat source nodal vector by integrating q at each tet's centroid.
        std::vector<double> Q(N, 0.0);
        for (std::size_t t = 0; t < M; ++t) {
            const uint32_t* ids = &mesh.tets[4 * t];
            double cx = 0, cy = 0, cz = 0;
            for (int i = 0; i < 4; ++i) {
                cx += mesh.nodes[3 * ids[i] + 0];
                cy += mesh.nodes[3 * ids[i] + 1];
                cz += mesh.nodes[3 * ids[i] + 2];
            }
            cx /= 4; cy /= 4; cz /= 4;
            const double q = goldakDensity(cx, cy, cz, tx, ty, tz, ux, uy, uz, src);
            // Distribute q × V_tet equally to 4 nodes.
            const double qNode = q * tetVol[t] / 4.0;
            for (int i = 0; i < 4; ++i) Q[ids[i]] += qNode;
        }

        // Diffusion contribution: per-tet 4×4 K_T = k · B_T^T · B_T · V
        // assembled into a sparse Laplacian acting on T.
        // We compute it on-the-fly per tet to avoid storing a sparse K_T.
        std::vector<double> diffusionOut(N, 0.0);
        for (std::size_t t = 0; t < M; ++t) {
            const uint32_t* ids = &mesh.tets[4 * t];
            const double* g = tetGradsArr.data() + 12 * t;
            // For each pair (i, j): K_e(i, j) = k · (∇N_i · ∇N_j) · V
            // diffusion_i = Σ_j K_e(i, j) · T_j
            for (int i = 0; i < 4; ++i) {
                double sum = 0;
                for (int j = 0; j < 4; ++j) {
                    const double dot = g[3*i+0] * g[3*j+0]
                                     + g[3*i+1] * g[3*j+1]
                                     + g[3*i+2] * g[3*j+2];
                    sum += mat.k * dot * tetVol[t] * Tnow[ids[j]];
                }
                diffusionOut[ids[i]] += sum;
            }
        }
        // Forward Euler update
        for (std::size_t i = 0; i < N; ++i) {
            const double dT = (Q[i] - diffusionOut[i]) / capacity[i] * dt;
            Tnow[i] += dT;
            if (Tnow[i] > Tpeak[i]) Tpeak[i] = Tnow[i];
        }
        ++thermalSteps;

        // Take a snapshot if we've reached one
        if (snapIdx < snapshotCount && step + 1 == snapStep[snapIdx]) {
            // ---------------------- mechanical solve at this snapshot
            // Right-hand side: f_th = ∫ B^T D ε_th dV summed per element.
            std::vector<double> rhs(3 * N, 0.0);
            for (std::size_t t = 0; t < M; ++t) {
                const uint32_t* ids = &mesh.tets[4 * t];
                double Tmid = 0;
                for (int i = 0; i < 4; ++i) Tmid += Tnow[ids[i]];
                Tmid /= 4.0;
                const double dT = Tmid - mat.Tref;
                std::vector<double> epsTh(6, 0.0);
                epsTh[0] = mat.alpha * dT;
                epsTh[1] = mat.alpha * dT;
                epsTh[2] = mat.alpha * dT;
                // f_e_th = B^T · D · epsTh · V — but subtract plastic strain too
                std::vector<double> epsLoad = la::vadd(epsTh, ePlastic[t]);
                std::vector<double> fe =
                    la::vscale(tetBmat[t].transpose() * Delast * epsLoad, tetVol[t]);
                for (int a = 0; a < 4; ++a) {
                    for (int i = 0; i < 3; ++i) {
                        rhs[3 * ids[a] + i] += fe[3 * a + i];
                    }
                }
            }
            // Apply Dirichlet via penalty (already added to K diagonal)
            std::vector<double> u = mechSolver.solve(rhs);
            if (mechSolver.ok()) {
                uTotal = u;
                // Per-element radial-return update for J2 plasticity.
                const double G = mat.E / (2.0 * (1.0 + mat.nu));
                const double H = mat.Etan * mat.E / std::max(1.0, mat.E - mat.Etan);
                for (std::size_t t = 0; t < M; ++t) {
                    const uint32_t* ids = &mesh.tets[4 * t];
                    std::vector<double> ue(12, 0.0);
                    for (int a = 0; a < 4; ++a) {
                        for (int i = 0; i < 3; ++i) {
                            ue[3 * a + i] = u[3 * ids[a] + i];
                        }
                    }
                    std::vector<double> eps = tetBmat[t] * ue;
                    double Tmid = 0;
                    for (int i = 0; i < 4; ++i) Tmid += Tnow[ids[i]];
                    Tmid /= 4.0;
                    std::vector<double> epsTh(6, 0.0);
                    epsTh[0] = mat.alpha * (Tmid - mat.Tref);
                    epsTh[1] = epsTh[0]; epsTh[2] = epsTh[0];
                    std::vector<double> epsE = la::vsub(la::vsub(eps, epsTh), ePlastic[t]);
                    std::vector<double> sigmaTrial = Delast * epsE;
                    // Deviator (note γ-strain convention for shears, but D
                    // already handles factor-of-2; we use σ directly).
                    const double sm = (sigmaTrial[0] + sigmaTrial[1] + sigmaTrial[2]) / 3.0;
                    std::vector<double> s = sigmaTrial;
                    s[0] -= sm; s[1] -= sm; s[2] -= sm;
                    const double sNorm = std::sqrt(
                        s[0]*s[0] + s[1]*s[1] + s[2]*s[2]
                      + 2.0 * (s[3]*s[3] + s[4]*s[4] + s[5]*s[5]));
                    const double sigmaYcur = mat.sigmaY0 + H * ePeq[t];
                    const double f = sNorm - std::sqrt(2.0 / 3.0) * sigmaYcur;
                    std::vector<double> sigma = sigmaTrial;
                    if (f > 0) {
                        // Δλ for radial return
                        const double dLambda = f / (2.0 * G + (2.0 / 3.0) * H);
                        std::vector<double> n_dev(6, 0.0);
                        if (sNorm > 0) {
                            for (int c = 0; c < 6; ++c) n_dev[c] = s[c] / sNorm;
                        }
                        // Plastic strain increment is sqrt(3/2)·dλ·n in
                        // stress space → equivalent plastic strain += dλ·√(2/3).
                        ePeq[t] += dLambda * std::sqrt(2.0 / 3.0);
                        std::vector<double> dEpsP = la::vscale(n_dev,
                                                              std::sqrt(3.0 / 2.0) * dLambda);
                        la::vaxpy(ePlastic[t], 1.0, dEpsP);
                        la::vaxpy(sigma, -(2.0 * G), dEpsP);
                    }
                    // Mises stress
                    const double sm2 = (sigma[0] + sigma[1] + sigma[2]) / 3.0;
                    std::vector<double> sD = sigma;
                    sD[0] -= sm2; sD[1] -= sm2; sD[2] -= sm2;
                    misesOut[t] = std::sqrt(1.5 * (sD[0]*sD[0] + sD[1]*sD[1] + sD[2]*sD[2]
                                                 + 2.0 * (sD[3]*sD[3] + sD[4]*sD[4] + sD[5]*sD[5])));
                }
            }
            ++snapIdx;
        }
    }

    // Pack outputs.
    WeldResult R;
    R.displacement.assign(uTotal.data(), uTotal.data() + 3 * N);
    R.plasticStrain = std::move(ePeq);
    R.misesStressPa = std::move(misesOut);
    R.peakHazTempK  = std::move(Tpeak);
    R.snapshotsTaken = snapIdx;
    R.thermalStepsTaken = thermalSteps;
    double maxDisp = 0, maxMises = 0, maxT = 0;
    for (std::size_t i = 0; i < N; ++i) {
        const double dx = R.displacement[3 * i + 0];
        const double dy = R.displacement[3 * i + 1];
        const double dz = R.displacement[3 * i + 2];
        const double d  = std::sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxDisp) maxDisp = d;
        if (R.peakHazTempK[i] > maxT) maxT = R.peakHazTempK[i];
    }
    for (auto m : R.misesStressPa) if (m > maxMises) maxMises = m;
    R.maxDisplacementMm = maxDisp * 1000.0;
    R.maxMisesPa        = maxMises;
    R.maxTempK          = maxT;
    return R;
}

}} // namespace forge::welding
