// forge-kernel/test/fea_dynamic_sparse_gate.cpp — T-286
//
// GATE: forge::fea::solveDynamic (Newmark-β, β = 1/4, γ = 1/2) must form its
// Rayleigh damping C = αM + β_R K and its effective operator
// A = M + γΔt C + βΔt² K as SPARSE linear combinations (O(nnz) memory), not by
// densifying M, K and C (3 × 8n² bytes at the peak: 40.4 GB for the 41,052-DOF
// bracketM mesh, on a 36 GB machine) — and the answer must not change.
//
// Everything is driven through the PUBLIC FEA API (meshFromBRep / solveModal /
// solveDynamic) plus the linalg observation seam la::setSparseLDLTObserver
// (T-163), which hands the test the EXACT Newmark operator A that solveDynamic
// gives SparseLDLT. The same source therefore links against a pre-change
// library, which is how the BEFORE numbers and the A/B are produced
// (test/run_fea_dynamic_sparse_gate.sh, BASELINE_KERNEL_BUILD).
//
// MODES (argv[1])
//   ab <out.bin>       A/B fixtures (lumped + consistent mass, with/without
//                      Rayleigh damping, initial conditions, pinned DOFs, a CAD
//                      bracket mesh). Dumps every array solveDynamic returns
//                      plus the captured operator A (pattern and values) to a
//                      binary file.
//   compare <a> <b>    D1 the two dumps hold the same records with the same
//                      lengths; D2 the Newmark operator PATTERN is identical
//                      and its values agree to 4 ulp (one rounding per entry);
//                      D3 every history agrees to 1e-10 x its max-norm. The
//                      number of bitwise-different doubles is reported (the
//                      expected value is 0: the sparse combination evaluates
//                      the same per-entry expression the dense add did).
//   closedform         CF1 free vibration from a mode shape, undamped: the
//                      discrete solution of the average-acceleration scheme
//                      is EXACTLY u_n = cos(nΩ) φ with Ω = 2 atan(ω Δt / 2);
//                      CF2 the same with Rayleigh damping (C φ = (α + β_R ω²) M φ,
//                      so the mode stays decoupled and follows the scalar
//                      Newmark recurrence of q'' + c q' + ω² q = 0);
//                      CF3 vs the continuous closed form
//                      q(t) = e^{-ζωt}(cos ω_d t + ζ/√(1-ζ²) sin ω_d t), within the
//                      scheme's O(Δt²) period error;
//                      CF4 energy invariant of the scheme for a step load from
//                      rest, undamped: ½vᵀMv + ½uᵀKu − fᵀu = 0 at every step.
//                      Runs on a dense-modal (297 DOF) and a sparse-Lanczos
//                      modal (1,575 DOF) cantilever.
//   rss <fx,...>       per fixture, in a FORKED child (clean peak counters):
//                      peak phys footprint / peak RSS of one solveDynamic
//                      (10 Newmark steps, Rayleigh α = 10, β_R = 1e-6) over the
//                      pre-solve level, wall time, n and nnz(A).
//                      M1 for n >= 10000: peak growth <= 0.5 x 8n² bytes (the
//                      densifying path needs >= 3 x 8n²: it holds M, C and K
//                      dense at once; measured 3.2-4.0 x 8n² before T-286);
//                      M2 the solve succeeded;
//                      M3 SCALING: over the lumped-mass fixtures with
//                      n >= 5000, the growth exponent
//                      ln(g_max/g_min) / ln(n_max/n_min) <= 1.6 (dense add: 2;
//                      a sparse factor of a 3-D mesh: <= 4/3).
//   rss-report <fx,..> same measurements, no assertion (BEFORE numbers).
//
//   RSS fixtures: b2k b6k b11k b21k (structured cube-element bars, 2,499 /
//   6,075 / 11,253 / 20,787 DOF), bracketS / bracketM / bracketL (120x40x20 mm
//   block minus a Ø16 hole, h = 4 / 2 / 1.5 mm, the T-163 CAD fixtures).
//   Suffix ":c" runs the consistent-mass path (DynamicOptions).
//
// Exit 0 iff every assertion of the selected mode passes.

#include "forge/Booleans.hpp"
#include "forge/Fea.hpp"
#include "forge/Primitives.hpp"
#include "forge/Transform.hpp"
#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <libproc.h>
#include <mach/mach.h>
#endif

namespace fea = forge::fea;
namespace la = forge::native::linalg;

namespace {

int g_fail = 0;
void check(bool ok, const std::string& what) {
    std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
    std::fflush(stdout);
    if (!ok) ++g_fail;
}

double nowSec() {
    return std::chrono::duration<double>(
               std::chrono::steady_clock::now().time_since_epoch()).count();
}

// ---------------------------------------------------------------- meshes
// Structured bar of nx*ny*nz cube elements of edge h (metres), same node order
// and AABB-face bits as fea::meshFromBRep (bit 0 = -X face, bit 1 = +X face).
fea::Mesh boxMesh(int nx, int ny, int nz, double hx, double hy, double hz) {
    fea::Mesh m;
    m.elemNodeCount = 8;
    const int nx1 = nx + 1, ny1 = ny + 1, nz1 = nz + 1;
    auto id = [&](int i, int j, int k) {
        return static_cast<std::uint32_t>((i * ny1 + j) * nz1 + k);
    };
    for (int i = 0; i < nx1; ++i)
        for (int j = 0; j < ny1; ++j)
            for (int k = 0; k < nz1; ++k) {
                m.nodes.push_back(i * hx);
                m.nodes.push_back(j * hy);
                m.nodes.push_back(k * hz);
                std::uint32_t mask = 0;
                if (i == 0) mask |= 1u << 0;
                if (i == nx) mask |= 1u << 1;
                if (j == 0) mask |= 1u << 2;
                if (j == ny) mask |= 1u << 3;
                if (k == 0) mask |= 1u << 4;
                if (k == nz) mask |= 1u << 5;
                m.nodeToFace.push_back(mask);
            }
    for (int i = 0; i < nx; ++i)
        for (int j = 0; j < ny; ++j)
            for (int k = 0; k < nz; ++k) {
                const std::uint32_t n[8] = {id(i, j, k),         id(i + 1, j, k),
                                            id(i + 1, j + 1, k), id(i, j + 1, k),
                                            id(i, j, k + 1),     id(i + 1, j, k + 1),
                                            id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1)};
                for (std::uint32_t q : n) m.tets.push_back(q);
            }
    return m;
}

// 120 x 40 x 20 mm block minus a Ø16 mm through-hole (the T-163 bracket),
// meshed by the production mesher, converted to metres.
fea::Mesh bracketMesh(double h_mm) {
    forge::ShapeHandle blk = forge::makeBox(120.0, 40.0, 20.0);
    forge::ShapeHandle hole = forge::translate(forge::makeCylinder(8.0, 20.0), 40.0, 20.0, 0.0);
    fea::Mesh m = fea::meshFromBRep(forge::cut(blk, hole), h_mm);
    for (double& c : m.nodes) c *= 1e-3;
    return m;
}

// Clamp every node on the -X face; spread `Fz` over the +X face nodes.
void clampAndLoad(const fea::Mesh& m, double Fz, std::vector<fea::BCPinned>& bcs,
                  std::vector<fea::LoadNodal>& loads) {
    const std::size_t nN = m.nodes.size() / 3;
    std::vector<std::uint32_t> tip;
    for (std::uint32_t i = 0; i < nN; ++i) {
        if (m.nodeToFace[i] & 1u) bcs.push_back({i, true, true, true});
        else if (m.nodeToFace[i] & 2u) tip.push_back(i);
    }
    if (Fz != 0.0)
        for (std::uint32_t i : tip)
            loads.push_back({i, 0.0, 0.0, Fz / static_cast<double>(tip.size())});
}

const fea::Material kSteel{200e9, 0.3, 7850.0};

// ------------------------------------------------- observation of the operator
// solveDynamic factors the Newmark operator A first and then (for a₀) the mass
// M; the observer sees both, in that order.
struct Capture {
    bool copy = true;
    std::vector<la::SparseCSR<double>> mats;
    std::vector<std::size_t> rows, nnz;
};
void captureObserver(const la::SparseCSR<double>& A, void* ctx) {
    auto* c = static_cast<Capture*>(ctx);
    c->rows.push_back(A.rows());
    c->nnz.push_back(A.nnz());
    if (c->copy) c->mats.push_back(A);
}

// ---------------------------------------------------------------- dump format
// A sequence of records: u32 tag length, tag bytes, u64 count, count doubles.
struct Rec {
    std::string tag;
    std::vector<double> v;
};
void putRec(std::vector<Rec>& out, const std::string& tag, std::vector<double> v) {
    out.push_back({tag, std::move(v)});
}
bool writeDump(const std::string& path, const std::vector<Rec>& recs) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    for (const Rec& r : recs) {
        const std::uint32_t tl = static_cast<std::uint32_t>(r.tag.size());
        const std::uint64_t n = r.v.size();
        std::fwrite(&tl, sizeof tl, 1, f);
        std::fwrite(r.tag.data(), 1, tl, f);
        std::fwrite(&n, sizeof n, 1, f);
        if (n) std::fwrite(r.v.data(), sizeof(double), n, f);
    }
    return std::fclose(f) == 0;
}
bool readDump(const std::string& path, std::vector<Rec>& recs) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    for (;;) {
        std::uint32_t tl = 0;
        if (std::fread(&tl, sizeof tl, 1, f) != 1) break;
        Rec r;
        r.tag.resize(tl);
        std::uint64_t n = 0;
        if (std::fread(r.tag.data(), 1, tl, f) != tl || std::fread(&n, sizeof n, 1, f) != 1) {
            std::fclose(f);
            return false;
        }
        r.v.resize(n);
        if (n && std::fread(r.v.data(), sizeof(double), n, f) != n) {
            std::fclose(f);
            return false;
        }
        recs.push_back(std::move(r));
    }
    std::fclose(f);
    return true;
}

std::vector<double> flatten(const std::vector<std::vector<double>>& h) {
    std::vector<double> out;
    for (const auto& s : h) out.insert(out.end(), s.begin(), s.end());
    return out;
}

// ---------------------------------------------------------------- A/B mode
struct AbFixture {
    const char* tag;
    int nx, ny, nz;   // > 0: structured bar of 10 mm... see h
    double h;         // bar element edge (m); for the bracket: element size (mm)
    bool bracket;
    bool consistent;
    double alpha, betaR, dt;
    int steps;
    double Fz;
    bool initialConditions;
};

int runAb(const std::string& outPath) {
    const AbFixture fx[] = {
        // lumped mass, full Rayleigh damping, step load
        {"bar-lumped-rayleigh", 12, 3, 3, 0.005, false, false, 10.0, 1e-6, 2e-5, 50, -1000.0, false},
        // consistent mass, damping, nonzero u0/v0, step load
        {"bar-consistent-ic", 10, 2, 2, 0.01, false, true, 4.0, 2e-6, 2e-5, 40, -500.0, true},
        // undamped: C has no entries at all (α = β_R = 0)
        {"bar-lumped-undamped", 16, 4, 4, 0.005, false, false, 0.0, 0.0, 1e-5, 30, -800.0, false},
        // stiffness-proportional damping only (α = 0): C = β_R K
        {"bar-consistent-betaonly", 8, 3, 2, 0.01, false, true, 0.0, 5e-6, 2e-5, 30, 300.0, true},
        // CAD part through the production mesher (6k DOF; the dense path still fits)
        {"bracketS-lumped-rayleigh", 0, 0, 0, 4.0, true, false, 5.0, 2e-6, 1e-5, 20, -1000.0, false},
    };
    std::vector<Rec> recs;
    for (const AbFixture& f : fx) {
        fea::Mesh m = f.bracket ? bracketMesh(f.h) : boxMesh(f.nx, f.ny, f.nz, f.h, f.h, f.h);
        std::vector<fea::BCPinned> bcs;
        std::vector<fea::LoadNodal> loads;
        clampAndLoad(m, f.Fz, bcs, loads);
        const std::size_t nDof = m.nodes.size();
        fea::DynamicOptions opts;
        opts.useConsistentMass = f.consistent;
        if (f.initialConditions) {
            opts.u0.resize(nDof);
            opts.v0.resize(nDof);
            for (std::size_t i = 0; i < nDof; ++i) {
                const double x = m.nodes[3 * (i / 3)];
                opts.u0[i] = 1e-6 * x * (1.0 + 0.1 * static_cast<double>(i % 3));
                opts.v0[i] = 1e-3 * std::sin(37.0 * x + static_cast<double>(i % 7));
            }
        }
        Capture cap;
        la::setSparseLDLTObserver(&captureObserver, &cap);
        const double t0 = nowSec();
        fea::DynamicResult r;
        bool ok = true;
        try {
            r = fea::solveDynamic(m, kSteel, loads, bcs, f.steps * f.dt, f.dt, f.alpha, f.betaR, opts);
        } catch (const std::exception& e) {
            ok = false;
            std::printf("  %s threw: %s\n", f.tag, e.what());
        }
        const double secs = nowSec() - t0;
        la::setSparseLDLTObserver(nullptr, nullptr);
        check(ok, std::string("AB ") + f.tag + " solveDynamic succeeded");
        check(cap.mats.size() == 2, std::string("AB ") + f.tag + " two factorisations observed (A, then M)");
        if (!ok || cap.mats.empty()) continue;
        const la::SparseCSR<double>& A = cap.mats[0];
        std::printf("  %-26s n=%zu nnz(A)=%zu steps=%zu  %.3f s  max|u|=%.9e  E_end=%.9e\n", f.tag,
                    A.rows(), A.nnz(), r.times.size() - 1, secs, r.maxDisp.back(), r.totalEnergy.back());
        const std::string t = f.tag;
        std::vector<double> rp(A.rowPtr().begin(), A.rowPtr().end());
        std::vector<double> ci(A.colIdx().begin(), A.colIdx().end());
        putRec(recs, t + "/A.rowPtr", rp);
        putRec(recs, t + "/A.colIdx", ci);
        putRec(recs, t + "/A.values", A.values());
        putRec(recs, t + "/u", flatten(r.displacements));
        putRec(recs, t + "/v", flatten(r.velocities));
        putRec(recs, t + "/times", r.times);
        putRec(recs, t + "/maxDisp", r.maxDisp);
        putRec(recs, t + "/KE", r.kineticEnergy);
        putRec(recs, t + "/PE", r.potentialEnergy);
        putRec(recs, t + "/E", r.totalEnergy);
        putRec(recs, t + "/stressEnvelope", r.maxStressEnvelope);
    }
    check(writeDump(outPath, recs), "AB dump written to " + outPath);
    return g_fail ? 1 : 0;
}

int runCompare(const std::string& pa, const std::string& pb) {
    std::vector<Rec> a, b;
    check(readDump(pa, a) && readDump(pb, b), "D0 both dumps readable");
    check(!a.empty() && a.size() == b.size(), "D1 same number of records (" +
                                                  std::to_string(a.size()) + " vs " +
                                                  std::to_string(b.size()) + ")");
    if (a.empty() || a.size() != b.size()) return 1;
    std::size_t totalDiffBits = 0, totalDoubles = 0;
    for (std::size_t r = 0; r < a.size(); ++r) {
        const Rec& x = a[r];
        const Rec& y = b[r];
        const bool same = x.tag == y.tag && x.v.size() == y.v.size();
        if (!same) {
            check(false, "D1 record " + x.tag + " / " + y.tag + " tag and length match");
            continue;
        }
        std::size_t bitDiff = 0;
        double maxAbs = 0.0, maxRelEntry = 0.0, scale = 0.0;
        for (std::size_t i = 0; i < x.v.size(); ++i) {
            if (std::memcmp(&x.v[i], &y.v[i], sizeof(double)) != 0) ++bitDiff;
            const double d = std::fabs(x.v[i] - y.v[i]);
            maxAbs = std::max(maxAbs, d);
            scale = std::max(scale, std::fabs(x.v[i]));
            const double den = std::max(std::fabs(x.v[i]), std::fabs(y.v[i]));
            if (den > 0) maxRelEntry = std::max(maxRelEntry, d / den);
        }
        totalDiffBits += bitDiff;
        totalDoubles += x.v.size();
        const double rel = scale > 0 ? maxAbs / scale : maxAbs;
        std::printf("  %-44s n=%-9zu bitwise-different=%-6zu max|d|/max|x|=%.3e\n", x.tag.c_str(),
                    x.v.size(), bitDiff, rel);
        const bool pattern = x.tag.find("/A.rowPtr") != std::string::npos ||
                             x.tag.find("/A.colIdx") != std::string::npos;
        if (pattern)
            check(bitDiff == 0, "D2 " + x.tag + " Newmark operator pattern identical");
        else if (x.tag.find("/A.values") != std::string::npos)
            check(maxRelEntry <= 4 * 2.220446049250313e-16,
                  "D2 " + x.tag + " operator entries within 4 ulp (max rel " +
                      std::to_string(maxRelEntry) + ")");
        else
            check(rel <= 1e-10, "D3 " + x.tag + " within 1e-10 x max-norm");
    }
    std::printf("  TOTAL bitwise-different doubles: %zu of %zu\n", totalDiffBits, totalDoubles);
    return g_fail ? 1 : 0;
}

// ---------------------------------------------------------------- closed form
// Exact discrete solution of the average-acceleration Newmark scheme for the
// modal coordinate of q'' + c q' + k q = 0 (unit modal mass), q0 = 1, v0 = 0.
std::vector<double> newmarkSdof(double c, double k, double dt, std::size_t steps) {
    const double beta = 0.25, gamma = 0.5;
    double q = 1.0, v = 0.0, a = -(c * v + k * q);
    std::vector<double> out{q};
    for (std::size_t s = 1; s <= steps; ++s) {
        const double qh = q + dt * v + dt * dt * (0.5 - beta) * a;
        const double vh = v + dt * (1.0 - gamma) * a;
        const double an = (-c * vh - k * qh) / (1.0 + gamma * dt * c + beta * dt * dt * k);
        q = qh + beta * dt * dt * an;
        v = vh + gamma * dt * an;
        a = an;
        out.push_back(q);
    }
    return out;
}

void closedFormOn(const char* tag, int nx, int ny, int nz) {
    const double L = 0.2, b = 0.02;
    fea::Mesh m = boxMesh(nx, ny, nz, L / nx, b / ny, b / nz);
    std::vector<fea::BCPinned> bcs;
    std::vector<fea::LoadNodal> none;
    clampAndLoad(m, 0.0, bcs, none);
    const std::size_t nDof = m.nodes.size();
    std::printf("\n#### %s: %dx%dx%d hex, n=%zu DOF (solveModal %s path)\n", tag, nx, ny, nz, nDof,
                nDof > 1500 ? "sparse Lanczos" : "dense");

    fea::ModalResult mr = fea::solveModal(m, kSteel, bcs, 1);
    check(mr.nModes >= 1, std::string(tag) + " solveModal returned mode 1");
    if (mr.nModes < 1) return;
    const double w = std::sqrt(mr.eigenvalues[0]);
    const double T = 2.0 * M_PI / w;
    // Euler-Bernoulli cantilever, reported only (a model-accuracy number, not a
    // solver-identity one): f1 = (1.8751²/2π) sqrt(EI / (ρ A L⁴)).
    const double EI = kSteel.E * b * b * b * b / 12.0, rhoA = kSteel.rho * b * b;
    const double fEB = 1.87510407 * 1.87510407 / (2 * M_PI) * std::sqrt(EI / (rhoA * L * L * L * L));
    std::printf("  f1 = %.3f Hz (Euler-Bernoulli %.3f Hz, ratio %.4f)\n", w / (2 * M_PI), fEB,
                w / (2 * M_PI) / fEB);

    std::vector<double> u0 = mr.eigenvectors[0];
    double umax = 0;
    for (double x : u0) umax = std::max(umax, std::fabs(x));
    for (double& x : u0) x *= 1e-4 / umax;   // tip amplitude 0.1 mm
    const double dt = T / 128.0;
    const std::size_t steps = 3 * 128;       // three periods

    for (int damped = 0; damped <= 1; ++damped) {
        const double zeta = damped ? 0.02 : 0.0;
        // ζ = α/(2ω) + β_R ω/2 with equal shares
        const double alpha = damped ? zeta * w : 0.0;
        const double betaR = damped ? zeta / w : 0.0;
        fea::DynamicOptions o;
        o.u0 = u0;
        o.useConsistentMass = true;
        fea::DynamicResult r;
        bool ok = true;
        try {
            r = fea::solveDynamic(m, kSteel, none, bcs, static_cast<double>(steps) * dt, dt, alpha, betaR, o);
        } catch (const std::exception& e) {
            ok = false;
            std::printf("  threw: %s\n", e.what());
        }
        const std::string lab = std::string(tag) + (damped ? " CF2 damped (zeta=0.02)" : " CF1 undamped");
        check(ok && r.displacements.size() >= steps + 1, lab + " solveDynamic ran " + std::to_string(steps) + " steps");
        if (!ok || r.displacements.size() < steps + 1) continue;
        const std::vector<double> q = newmarkSdof(alpha + betaR * w * w, w * w, dt, steps);
        if (!damped) {
            // the recurrence IS cos(nΩ): self-check of the formula used below
            const double Om = 2.0 * std::atan(w * dt / 2.0);
            double e = 0;
            for (std::size_t s = 0; s <= steps; ++s) e = std::max(e, std::fabs(q[s] - std::cos(s * Om)));
            check(e <= 1e-12, lab + " scalar recurrence == cos(n*Omega), Omega = 2 atan(w dt/2) (err " +
                                  std::to_string(e) + ")");
        }
        double eDisc = 0, eCont = 0;
        const double wd = w * std::sqrt(1.0 - zeta * zeta);
        for (std::size_t s = 0; s <= steps; ++s) {
            const double t = r.times[s];
            const double qc = std::exp(-zeta * w * t) *
                              (std::cos(wd * t) + zeta / std::sqrt(1.0 - zeta * zeta) * std::sin(wd * t));
            for (std::size_t i = 0; i < nDof; ++i) {
                eDisc = std::max(eDisc, std::fabs(r.displacements[s][i] - q[s] * u0[i]));
                eCont = std::max(eCont, std::fabs(r.displacements[s][i] - qc * u0[i]));
            }
        }
        eDisc /= 1e-4;
        eCont /= 1e-4;
        const double predicted = (w * r.times[steps]) * (w * dt) * (w * dt) / 12.0;   // phase lag
        std::printf("  %s: max|u_n - q_n u0|/|u0| = %.3e (discrete closed form), vs continuous %.3e "
                    "(scheme phase-error estimate %.3e)\n",
                    lab.c_str(), eDisc, eCont, predicted);
        check(eDisc <= 1e-8, lab + " matches the discrete closed form to 1e-8");
        check(eCont <= 1e-2 && eCont <= 2.0 * predicted + 1e-6,
              lab + " CF3 matches the continuous closed form within the O(dt^2) phase error");
    }

    // CF4: step load from rest, undamped, lumped mass: E = KE + PE - f.u = 0.
    std::vector<fea::BCPinned> bcs2;
    std::vector<fea::LoadNodal> loads;
    clampAndLoad(m, -1000.0, bcs2, loads);
    fea::DynamicResult r = fea::solveDynamic(m, kSteel, loads, bcs2, 200 * (T / 64.0), T / 64.0, 0.0, 0.0);
    double emax = 0, scale = 0;
    for (std::size_t s = 0; s < r.times.size(); ++s) {
        double fu = 0;
        for (const auto& Ld : loads) {
            const std::size_t bI = 3 * Ld.nodeId;
            fu += Ld.fx * r.displacements[s][bI] + Ld.fy * r.displacements[s][bI + 1] +
                  Ld.fz * r.displacements[s][bI + 2];
        }
        emax = std::max(emax, std::fabs(r.totalEnergy[s] - fu));
        scale = std::max(scale, std::fabs(fu));
    }
    std::printf("  CF4 energy: max|KE+PE-f.u| = %.3e J over %zu steps (max|f.u| = %.3e J)\n", emax,
                r.times.size() - 1, scale);
    check(scale > 0 && emax <= 1e-9 * scale, std::string(tag) + " CF4 discrete energy invariant to 1e-9");
}

int runClosedForm() {
    closedFormOn("cantilever-297", 10, 2, 2);
    closedFormOn("cantilever-1575", 20, 4, 4);
    return g_fail ? 1 : 0;
}

// ---------------------------------------------------------------- RSS mode
struct RssOut {
    double footBefore = 0, footPeak = 0, rssBefore = 0, rssPeak = 0, seconds = 0;
    std::uint64_t n = 0, nnzA = 0, steps = 0;
    int ok = 0;
};

void memNow(double& foot, double& footPeak, double& rss, double& rssPeak) {
#if defined(__APPLE__)
    rusage_info_v4 ri{};
    if (proc_pid_rusage(getpid(), RUSAGE_INFO_V4, reinterpret_cast<rusage_info_t*>(&ri)) == 0) {
        foot = static_cast<double>(ri.ri_phys_footprint);
        footPeak = static_cast<double>(ri.ri_lifetime_max_phys_footprint);
    }
    mach_task_basic_info_data_t info{};
    mach_msg_type_number_t cnt = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, reinterpret_cast<task_info_t>(&info), &cnt) ==
        KERN_SUCCESS)
        rss = static_cast<double>(info.resident_size);
    struct rusage ru {};
    getrusage(RUSAGE_SELF, &ru);
    rssPeak = static_cast<double>(ru.ru_maxrss);   // bytes on Darwin
#else
    struct rusage ru {};
    getrusage(RUSAGE_SELF, &ru);
    rssPeak = 1024.0 * static_cast<double>(ru.ru_maxrss);   // KiB on Linux
    long pages = 0, resident = 0;
    if (FILE* f = std::fopen("/proc/self/statm", "r")) {
        if (std::fscanf(f, "%ld %ld", &pages, &resident) != 2) resident = 0;
        std::fclose(f);
    }
    rss = static_cast<double>(resident) * static_cast<double>(sysconf(_SC_PAGESIZE));
    foot = rss;
    footPeak = rssPeak;
#endif
}

fea::Mesh rssMesh(const std::string& fx, bool& known) {
    known = true;
    if (fx == "b2k") return boxMesh(16, 6, 6, 0.005, 0.005, 0.005);
    if (fx == "b6k") return boxMesh(24, 8, 8, 0.005, 0.005, 0.005);
    if (fx == "b11k") return boxMesh(30, 10, 10, 0.005, 0.005, 0.005);
    if (fx == "b21k") return boxMesh(40, 12, 12, 0.005, 0.005, 0.005);
    if (fx == "bracketS") return bracketMesh(4.0);
    if (fx == "bracketM") return bracketMesh(2.0);
    if (fx == "bracketL") return bracketMesh(1.5);
    known = false;
    return {};
}

RssOut rssChild(const std::string& fxArg) {
    RssOut o;
    bool known = false;
    const bool consistent = fxArg.size() > 2 && fxArg.compare(fxArg.size() - 2, 2, ":c") == 0;
    const std::string fx = consistent ? fxArg.substr(0, fxArg.size() - 2) : fxArg;
    fea::Mesh m;
    try {
        m = rssMesh(fx, known);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "mesh %s threw: %s\n", fx.c_str(), e.what());
        return o;
    }
    if (!known) return o;
    std::vector<fea::BCPinned> bcs;
    std::vector<fea::LoadNodal> loads;
    clampAndLoad(m, -1000.0, bcs, loads);
    Capture cap;
    cap.copy = false;   // record sizes only: a copy of A would inflate the peak
    double dummy = 0;
    memNow(o.footBefore, dummy, o.rssBefore, dummy);
    la::setSparseLDLTObserver(&captureObserver, &cap);
    const double dt = 1e-5;
    const int steps = 10;
    const double t0 = nowSec();
    try {
        // full Rayleigh damping; lumped mass (the 8-argument entry) or consistent
        fea::DynamicOptions opts;
        opts.useConsistentMass = consistent;
        fea::DynamicResult r = fea::solveDynamic(m, kSteel, loads, bcs, steps * dt, dt, 10.0, 1e-6, opts);
        o.ok = r.times.size() == static_cast<std::size_t>(steps + 1) ? 1 : 0;
        o.steps = r.times.size() - 1;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "solveDynamic %s threw: %s\n", fx.c_str(), e.what());
    }
    o.seconds = nowSec() - t0;
    la::setSparseLDLTObserver(nullptr, nullptr);
    double f = 0, r = 0;
    memNow(f, o.footPeak, r, o.rssPeak);
    o.n = m.nodes.size();
    o.nnzA = cap.nnz.empty() ? 0 : cap.nnz[0];
    return o;
}

int runRss(const std::string& list, bool assertBound) {
    std::printf("fixture      n(DOF)   nnz(A)     8n^2(GB)  peak-foot-growth(GB)  peak-RSS-growth(GB)  "
                "solveDynamic(s)  growth/(8n^2)\n");
    std::vector<std::pair<double, double>> lumped;   // (n, growth), n >= 5000
    std::size_t p = 0;
    while (p <= list.size()) {
        std::size_t q = list.find(',', p);
        if (q == std::string::npos) q = list.size();
        const std::string fx = list.substr(p, q - p);
        p = q + 1;
        if (fx.empty()) continue;
        int fds[2];
        if (pipe(fds) != 0) { check(false, "pipe"); continue; }
        std::fflush(stdout);
        const pid_t pid = fork();
        if (pid == 0) {
            close(fds[0]);
            RssOut o = rssChild(fx);
            ssize_t w = write(fds[1], &o, sizeof o);
            (void)w;
            close(fds[1]);
            _exit(0);
        }
        close(fds[1]);
        RssOut o;
        const ssize_t got = read(fds[0], &o, sizeof o);
        close(fds[0]);
        int status = 0;
        waitpid(pid, &status, 0);
        const bool childOk = got == static_cast<ssize_t>(sizeof o) && WIFEXITED(status) && o.ok;
        const double dense = 8.0 * static_cast<double>(o.n) * static_cast<double>(o.n);
        const double gFoot = std::max(0.0, o.footPeak - o.footBefore);
        const double gRss = std::max(0.0, o.rssPeak - o.rssBefore);
        const double growth = std::max(gFoot, gRss);
        std::printf("%-12s %-8llu %-10llu %-9.3f %-21.3f %-20.3f %-16.3f %.4f\n", fx.c_str(),
                    static_cast<unsigned long long>(o.n), static_cast<unsigned long long>(o.nnzA),
                    dense / 1e9, gFoot / 1e9, gRss / 1e9, o.seconds, dense > 0 ? growth / dense : 0.0);
        std::fflush(stdout);
        if (assertBound) {
            check(childOk, "M2 " + fx + " solveDynamic succeeded");
            if (o.n >= 10000)
                check(growth <= 0.5 * dense,
                      "M1 " + fx + " peak growth <= 0.5 x 8n^2 (dense add needs >= 3 x 8n^2)");
        }
        const bool consistent = fx.size() > 2 && fx.compare(fx.size() - 2, 2, ":c") == 0;
        if (childOk && !consistent && o.n >= 5000) lumped.push_back({static_cast<double>(o.n), growth});
    }
    if (lumped.size() >= 2) {
        auto lo = *std::min_element(lumped.begin(), lumped.end());
        auto hi = *std::max_element(lumped.begin(), lumped.end());
        if (hi.first > lo.first && lo.second > 0 && hi.second > 0) {
            const double expo = std::log(hi.second / lo.second) / std::log(hi.first / lo.first);
            std::printf("  growth exponent n=%.0f -> n=%.0f: %.3f (dense add 2, 3-D sparse factor <= 4/3)\n",
                        lo.first, hi.first, expo);
            if (assertBound) check(expo <= 1.6, "M3 peak-memory growth exponent <= 1.6");
        }
    }
    return g_fail ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
    const std::string mode = argc > 1 ? argv[1] : "";
    std::printf("fea_dynamic_sparse_gate (T-286) mode=%s\n", mode.c_str());
    int rc = 2;
    if (mode == "ab" && argc > 2) rc = runAb(argv[2]);
    else if (mode == "compare" && argc > 3) rc = runCompare(argv[2], argv[3]);
    else if (mode == "closedform") rc = runClosedForm();
    else if (mode == "rss" && argc > 2) rc = runRss(argv[2], true);
    else if (mode == "rss-report" && argc > 2) rc = runRss(argv[2], false);
    else {
        std::fprintf(stderr,
                     "usage: %s ab <out.bin> | compare <a.bin> <b.bin> | closedform | rss <fx,...> | "
                     "rss-report <fx,...>\n",
                     argv[0]);
        return 2;
    }
    std::printf("%s (%d failed checks)\n", rc == 0 ? "GATE PASS" : "GATE FAIL", g_fail);
    return rc;
}
