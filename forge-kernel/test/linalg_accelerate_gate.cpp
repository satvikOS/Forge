// forge-kernel/test/linalg_accelerate_gate.cpp — T-157
//
// GATE: the sparse SPD direct solver behind every FEA solve (la::SparseLDLT)
// factors through a SUPERNODAL multifrontal Cholesky whose dense blocks go
// through a native dense-kernel seam (POTRF / TRSM / SYRK) — portable native
// loops, or Apple Accelerate above the MEASURED per-kernel crossover — and it
// must be faster on the production matrices without changing the answer
// beyond round-off.
//
// Measured on the REAL matrices the kernel's own production solvers assemble
// (forge::fea::solveStatic / solveThermal on CAD parts meshed by
// fea::meshFromBRep), captured through the linalg observation seam
// (la::setSparseLDLTObserver, T-163). Fixtures, as in T-163:
//   bracketS/M/L  120x40x20 mm block minus a Ø16 through-hole, h = 4/2/1.5 mm
//   cantilever    200x20x20 mm bar, h = 2.5 mm
//   tube          R30/R18 x 80 mm tube, h = 2.5 mm
//
// MODES (argv[1]; none = "gate")
//   gate              A1 + A3/A2-per-matrix + A4, with assertions:
//     A1 SIZE DISTRIBUTION per solver (printed): for every captured SparseLDLT
//        matrix n, nnz(A), nnz(L), factor flops and the dense-kernel calls /
//        multiply-adds per size bucket of max(m, k) and per backend; and, with
//        the DenseOp diagnostic on, the dense factorization/eigen sizes that
//        solveModal (dense and Lanczos paths), solveDynamic, the PlaneGCS
//        sketch solver and NurbsFit hand the library.
//     G1 every method factors every matrix (ok()).
//     G2 SAME ANSWER (A3): for the default method and for the forced-native and
//        forced-Accelerate dispatch: relres ‖Ax−b‖₂/‖b‖₂ <= 1e-12 and <= 10x the
//        up-looking oracle's + 1e-15; the solution equals the up-looking
//        solution to 1e-9 (max-norm relative). Justification: both are
//        backward-stable SPD factorizations (measured relres ~1e-15); the FE
//        matrices' condition numbers (<= ~1e7 here) bound the forward
//        difference by ~kappa*eps ~ 1e-9; measured 1e-11 or less.
//     G3 factorNnz() == symbolicFactorStats(A, permutation()).nnzL (the
//        supernodal factor has exactly the structural fill of its ordering).
//     G4 SPEED (A2, in process): on every matrix whose up-looking factor needs
//        >= 0.5 GFlop, the default compute() (ordering included) <= R x the
//        up-looking compute(), and over the corpus total <= R; R = 0.35 with
//        Accelerate, 0.75 for the native-only build.
//     C1 CROSSOVER (A4): each kernel is timed native vs Accelerate over a size
//        grid (interleaved, best of 3 rounds). The dispatch rule
//        (denseAccelerateWins) must be within 15% of the per-cell best backend
//        (geometric mean of chosen/best over the grid), never > 3x slower, and
//        > 2x slower in at most 2 cells: cells right at a crossover vary by
//        more than 2x between runs on this shared machine, while a wrong rule
//        loses 2.3-3x on a whole row (the first TRSM rule did, at m = 16/32).
//     C2 the Accelerate path is NOT used below the crossover: after the corpus
//        factorizations under the default dispatch, the seam's count of
//        Accelerate calls at sizes where the rule says native wins is 0, every
//        potrf with k < 8 ran native, and Accelerate did run above it; a build
//        without Accelerate sends it nothing. (Rule: potrf k >= 8; trsm k >= 24
//        or (m <= 32 and k >= 8); syrk k >= 12 or (m >= 256 and k >= 8) or
//        (m >= 512 and k >= 2).)
//   e2e <out.bin>     production solvers end to end on the fixtures (best of
//                     LAG_REPS, default 3): solveStatic + solveThermal on every
//                     fixture, solveModal (6 modes, Lanczos) on bracketS; prints
//                     wall-clocks and dumps outputs. Uses only the public FEA
//                     API, so it also links against a PRE-CHANGE library (built
//                     with -DLAG_E2E_ONLY, which keeps e2e and compare) —
//                     the BEFORE number on the SAME command.
//   compare <a> <b>   E2E OUTPUT A/B (A3): u, von Mises, T and eigenvalues of the
//                     two dumps agree to 1e-9 (max-norm relative); prints the
//                     number of bitwise-different doubles.
//
// Env: LAG_FIXTURES=bracketS,...  LAG_REPS=3  LAG_JSON=<path> (append JSON lines)

#include "forge/Booleans.hpp"
#include "forge/Fea.hpp"
#include "forge/Primitives.hpp"
#include "forge/Transform.hpp"
#include "forge/native/linalg/LinAlg.hpp"
#ifndef LAG_E2E_ONLY
#include "forge/NurbsFit.hpp"
#include "forge/Sketcher.hpp"
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <random>
#include <string>
#include <vector>

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
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

double envD(const char* k, double dflt) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::atof(v) : dflt;
}

std::string g_jsonPath;
void jsonLine(const std::string& s) {
    if (g_jsonPath.empty()) return;
    if (FILE* f = std::fopen(g_jsonPath.c_str(), "a")) {
        std::fprintf(f, "%s\n", s.c_str());
        std::fclose(f);
    }
}
std::string jnum(double v) {
    if (!std::isfinite(v)) return "null";
    char b[64];
    std::snprintf(b, sizeof b, "%.9g", v);
    return b;
}

// ---------------------------------------------------------------- fixtures
struct Fixture {
    const char* tag;
    int part;   // 0 bracket, 1 cantilever, 2 tube
    double h_mm;
    std::uint32_t clampBit, loadBit;
};
const Fixture kFixtures[] = {
    {"bracketS", 0, 4.0, 1u << 0, 1u << 1},  {"bracketM", 0, 2.0, 1u << 0, 1u << 1},
    {"bracketL", 0, 1.5, 1u << 0, 1u << 1},  {"cantilever", 1, 2.5, 1u << 0, 1u << 1},
    {"tube", 2, 2.5, 1u << 4, 1u << 5},
};

forge::ShapeHandle buildPart(int part) {
    if (part == 0) {
        forge::ShapeHandle blk = forge::makeBox(120.0, 40.0, 20.0);
        forge::ShapeHandle hole = forge::translate(forge::makeCylinder(8.0, 20.0), 40.0, 20.0, 0.0);
        return forge::cut(blk, hole);
    }
    if (part == 1) return forge::makeBox(200.0, 20.0, 20.0);
    forge::ShapeHandle outer = forge::makeCylinder(30.0, 80.0);
    forge::ShapeHandle inner = forge::makeCylinder(18.0, 80.0);
    return forge::cut(outer, inner);
}

bool wanted(const std::string& list, const char* tag) {
    if (list.empty()) return true;
    return ("," + list + ",").find(std::string(",") + tag + ",") != std::string::npos;
}

struct Problem {
    fea::Mesh mesh;
    std::vector<fea::BCPinned> bcs;
    std::vector<fea::LoadNodal> loads;
    std::vector<fea::ThermalNodalT> dir;
    std::vector<fea::ThermalElemSource> src;
    double loadScale = 1.0;
};

bool makeProblem(const Fixture& fx, Problem& P) {
    try {
        P.mesh = fea::meshFromBRep(buildPart(fx.part), fx.h_mm);
    } catch (const std::exception& e) {
        check(false, std::string(fx.tag) + " part/mesh: " + e.what());
        return false;
    }
    for (double& c : P.mesh.nodes) c *= 1e-3;
    const std::size_t nN = P.mesh.nodes.size() / 3;
    std::vector<std::uint32_t> tip;
    for (std::uint32_t i = 0; i < nN; ++i) {
        if (P.mesh.nodeToFace[i] & fx.clampBit) {
            P.bcs.push_back({i, true, true, true});
            P.dir.push_back({i, 20.0});
        } else if (P.mesh.nodeToFace[i] & fx.loadBit) {
            tip.push_back(i);
            P.dir.push_back({i, 100.0});
        }
    }
    for (std::uint32_t i : tip) P.loads.push_back({i, 0.0, 0.0, -1000.0 / static_cast<double>(tip.size())});
    P.loadScale = 1000.0 / static_cast<double>(std::max<std::size_t>(1, tip.size()));
    const std::size_t nE = P.mesh.tets.size() / 8;
    for (std::uint32_t e = 0; e < nE; e += 7) P.src.push_back({e, 1e5});
    return true;
}

const fea::Material kSteel{200e9, 0.3, 7850.0};

// ---------------------------------------------------------------- dump format
struct Rec {
    std::string tag;
    std::vector<double> v;
};
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

// ---------------------------------------------------------------- e2e mode
int runE2E(const std::string& outPath) {
    const std::string want = std::getenv("LAG_FIXTURES") ? std::getenv("LAG_FIXTURES") : "bracketS,bracketM,cantilever,tube";
    const int reps = std::max(1, static_cast<int>(envD("LAG_REPS", 3)));
    std::vector<Rec> recs;
    for (const Fixture& fx : kFixtures) {
        if (!wanted(want, fx.tag)) continue;
        Problem P;
        if (!makeProblem(fx, P)) continue;
        const std::size_t nN = P.mesh.nodes.size() / 3;
        double tS = 1e300, tT = 1e300;
        fea::StaticResult sr;
        fea::ThermalResult tr;
        bool okS = true, okT = true;
        for (int r = 0; r < reps && okS; ++r) {
            const double t0 = nowSec();
            try { sr = fea::solveStatic(P.mesh, kSteel, P.loads, {}, P.bcs); }
            catch (const std::exception& e) { okS = false; std::printf("solveStatic threw: %s\n", e.what()); }
            tS = std::min(tS, nowSec() - t0);
        }
        for (int r = 0; r < reps && okT; ++r) {
            const double t0 = nowSec();
            try { tr = fea::solveThermal(P.mesh, {45.0}, P.dir, P.src, {}); }
            catch (const std::exception& e) { okT = false; std::printf("solveThermal threw: %s\n", e.what()); }
            tT = std::min(tT, nowSec() - t0);
        }
        double umax = 0;
        for (double v : sr.u) umax = std::max(umax, std::fabs(v));
        std::printf("[e2e] solveStatic  %-10s dof=%-6zu %8.3f s  residual_inf=%.3e (rel %.3e)  max|u|=%.12e  maxVM=%.9e\n",
                    fx.tag, 3 * nN, tS, sr.residual, sr.residual / P.loadScale, umax, sr.maxVonMises);
        std::printf("[e2e] solveThermal %-10s dof=%-6zu %8.3f s\n", fx.tag, nN, tT);
        jsonLine(std::string("{\"e2e\":\"static-") + fx.tag + "\",\"seconds\":" + jnum(tS) + ",\"umax\":" + jnum(umax) + "}");
        jsonLine(std::string("{\"e2e\":\"thermal-") + fx.tag + "\",\"seconds\":" + jnum(tT) + "}");
        check(okS && sr.residual / P.loadScale <= 1e-9, std::string("E1 solveStatic ") + fx.tag + " relative residual <= 1e-9");
        check(okT, std::string("E1 solveThermal ") + fx.tag + " succeeded");
        recs.push_back({std::string(fx.tag) + "/static.u", sr.u});
        recs.push_back({std::string(fx.tag) + "/static.vonMises", sr.vonMises});
        std::vector<double> T(tr.T.begin(), tr.T.end());
        recs.push_back({std::string(fx.tag) + "/thermal.T", T});
        recs.push_back({std::string(fx.tag) + "/time.static", {tS}});
        recs.push_back({std::string(fx.tag) + "/time.thermal", {tT}});

        if (std::string(fx.tag) == "bracketS") {
            double tM = 1e300;
            fea::ModalResult mr;
            bool okM = true;
            for (int r = 0; r < reps && okM; ++r) {
                const double t0 = nowSec();
                try { mr = fea::solveModal(P.mesh, kSteel, P.bcs, 6); }
                catch (const std::exception& e) { okM = false; std::printf("solveModal threw: %s\n", e.what()); }
                tM = std::min(tM, nowSec() - t0);
            }
            std::printf("[e2e] solveModal   %-10s dof=%-6zu %8.3f s  f1=%.6f Hz\n", fx.tag, 3 * nN, tM,
                        mr.nModes > 0 ? std::sqrt(mr.eigenvalues[0]) / (2 * M_PI) : 0.0);
            check(okM && mr.nModes == 6, "E1 solveModal bracketS returned 6 modes");
            recs.push_back({"bracketS/modal.eigenvalues", mr.eigenvalues});
            recs.push_back({"bracketS/time.modal", {tM}});
        }
    }
    check(writeDump(outPath, recs), "E2E dump written to " + outPath);
    return g_fail ? 1 : 0;
}

int runCompare(const std::string& pa, const std::string& pb) {
    std::vector<Rec> a, b;
    check(readDump(pa, a) && readDump(pb, b), "D0 both dumps readable");
    check(!a.empty() && a.size() == b.size(), "D1 same records");
    if (a.empty() || a.size() != b.size()) return 1;
    std::size_t bits = 0, total = 0;
    for (std::size_t r = 0; r < a.size(); ++r) {
        const Rec& x = a[r];
        const Rec& y = b[r];
        if (x.tag != y.tag || x.v.size() != y.v.size()) {
            check(false, "D1 record " + x.tag + " matches " + y.tag);
            continue;
        }
        if (x.tag.find("/time.") != std::string::npos) {
            const double before = x.v.empty() ? 0 : x.v[0], after = y.v.empty() ? 0 : y.v[0];
            std::printf("  %-28s before %8.3f s  after %8.3f s  (x%.2f)\n", x.tag.c_str(), before, after,
                        after > 0 ? before / after : 0.0);
            continue;
        }
        std::size_t diff = 0;
        double maxAbs = 0, scale = 0;
        for (std::size_t i = 0; i < x.v.size(); ++i) {
            if (std::memcmp(&x.v[i], &y.v[i], sizeof(double)) != 0) ++diff;
            maxAbs = std::max(maxAbs, std::fabs(x.v[i] - y.v[i]));
            scale = std::max(scale, std::fabs(x.v[i]));
        }
        bits += diff;
        total += x.v.size();
        const double rel = scale > 0 ? maxAbs / scale : maxAbs;
        std::printf("  %-28s n=%-8zu bitwise-different=%-8zu max|d|/max|x|=%.3e\n", x.tag.c_str(), x.v.size(), diff, rel);
        check(rel <= 1e-9, "D2 " + x.tag + " within 1e-9 (max-norm relative)");
    }
    std::printf("  TOTAL bitwise-different doubles: %zu of %zu\n", bits, total);
    return g_fail ? 1 : 0;
}

#ifndef LAG_E2E_ONLY

// ---------------------------------------------------------------- gate mode
struct Capture {
    std::vector<la::SparseCSR<double>> mats;
};
void captureObserver(const la::SparseCSR<double>& A, void* ctx) {
    static_cast<Capture*>(ctx)->mats.push_back(A);
}

const char* kBucketNames[la::kDenseSizeBuckets] = {"<8", "8-31", "32-127", "128-511", "512-2047", ">=2048"};
const char* kKernelNames[3] = {"potrf", "trsm", "syrk"};

void printKernelHistogram(const la::DenseKernelStats& s) {
    double totalMadds = 0;
    for (int k = 0; k < 3; ++k)
        for (int b = 0; b < 2; ++b) totalMadds += static_cast<double>(s.madds[k][b]);
    std::printf("      kernel  backend    ");
    for (const char* n : kBucketNames) std::printf("%18s", n);
    std::printf("   (calls / %% of all multiply-adds, bucket = max(m,k))\n");
    for (int k = 0; k < 3; ++k)
        for (int b = 0; b < 2; ++b) {
            std::uint64_t c = 0;
            for (int q = 0; q < la::kDenseSizeBuckets; ++q) c += s.bucketCalls[k][b][q];
            if (!c) continue;
            std::printf("      %-6s  %-10s ", kKernelNames[k], b ? "Accelerate" : "native");
            for (int q = 0; q < la::kDenseSizeBuckets; ++q) {
                char cell[64];
                std::snprintf(cell, sizeof cell, "%llu/%.1f%%", static_cast<unsigned long long>(s.bucketCalls[k][b][q]),
                              totalMadds > 0 ? 100.0 * static_cast<double>(s.bucketMadds[k][b][q]) / totalMadds : 0.0);
                std::printf("%18s", cell);
            }
            std::printf("\n");
        }
}

void printOpStats(const char* solver, double seconds) {
    const la::DenseOpStats s = la::denseOpStats();
    std::printf("    [A1] %s: %.3f s; dense ops (calls / seconds per size bucket of max(rows,cols)):\n", solver, seconds);
    bool any = false;
    for (int o = 0; o < la::kDenseOpCount; ++o) {
        std::uint64_t c = 0;
        for (int q = 0; q < la::kDenseSizeBuckets; ++q) c += s.calls[o][q];
        if (!c) continue;
        any = true;
        std::printf("      %-26s max %zux%zu  ", la::denseOpName(static_cast<la::DenseOp>(o)), s.maxRows[o], s.maxCols[o]);
        for (int q = 0; q < la::kDenseSizeBuckets; ++q)
            if (s.calls[o][q])
                std::printf(" %s:%llu/%.4fs", kBucketNames[q], static_cast<unsigned long long>(s.calls[o][q]), s.seconds[o][q]);
        std::printf("\n");
    }
    if (!any) std::printf("      (no dense factorization or eigen call)\n");
}

struct Solve {
    bool ok = false;
    double seconds = 0, relres = 0, fwd = 0, flops = 0;
    std::size_t nnzL = 0;
    la::SparseOrdering ord = la::SparseOrdering::Natural;
    std::vector<double> x;
};

double norm2(const std::vector<double>& v) {
    double s = 0;
    for (double a : v) s += a * a;
    return std::sqrt(s);
}

Solve factorAndSolve(const la::SparseCSR<double>& A, la::SparseFactorMethod method,
                     const std::vector<double>& b, const std::vector<double>& xs, int reps, bool checkFill) {
    Solve r;
    r.seconds = 1e300;
    la::SparseLDLT F;
    for (int i = 0; i < reps; ++i) {
        const double t0 = nowSec();
        F.compute(A, la::kDefaultSparseOrdering, method);
        r.seconds = std::min(r.seconds, nowSec() - t0);
    }
    r.ok = F.ok();
    if (!r.ok) return r;
    r.nnzL = F.factorNnz();
    r.ord = F.chosenOrdering();
    r.x = F.solve(b);
    std::vector<double> Ax = A * r.x;
    for (std::size_t i = 0; i < Ax.size(); ++i) Ax[i] -= b[i];
    r.relres = norm2(Ax) / norm2(b);
    std::vector<double> e = r.x;
    for (std::size_t i = 0; i < e.size(); ++i) e[i] -= xs[i];
    r.fwd = norm2(e) / norm2(xs);
    const la::SymbolicFactorStats sym = la::symbolicFactorStats(A, F.permutation());
    r.flops = sym.flops;
    if (checkFill)
        check(sym.nnzL == r.nnzL, "G3 factorNnz() " + std::to_string(r.nnzL) + " == symbolic nnz(L) " + std::to_string(sym.nnzL));
    return r;
}

double maxRelDiff(const std::vector<double>& a, const std::vector<double>& b) {
    double d = 0, s = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        d = std::max(d, std::fabs(a[i] - b[i]));
        s = std::max(s, std::fabs(b[i]));
    }
    return s > 0 ? d / s : d;
}

// ---- A1: dense sizes of the solvers that do NOT go through SparseLDLT ----------
void profileDenseSolvers() {
    std::printf("\n==== A1 dense-op size distribution of the other production solvers ====\n");
    // solveModal, dense path (<= 1500 DOF): 200x20x20 bar at h = 10 mm.
    {
        fea::Mesh m = fea::meshFromBRep(forge::makeBox(200.0, 20.0, 20.0), 10.0);
        for (double& c : m.nodes) c *= 1e-3;
        std::vector<fea::BCPinned> bcs;
        for (std::uint32_t i = 0; i < m.nodeToFace.size(); ++i)
            if (m.nodeToFace[i] & 1u) bcs.push_back({i, true, true, true});
        la::resetDenseOpStats();
        la::resetDenseKernelStats();
        la::setDenseOpStatsEnabled(true);
        const double t0 = nowSec();
        fea::ModalResult mr = fea::solveModal(m, kSteel, bcs, 4);
        const double t = nowSec() - t0;
        la::setDenseOpStatsEnabled(false);
        printOpStats(("solveModal dense path, bar 200x20x20 h=10mm, n=" + std::to_string(m.nodes.size()) + " DOF").c_str(), t);
        check(mr.nModes == 4, "A1 solveModal (dense path) returned 4 modes");
    }
    // solveModal, sparse Lanczos path, and solveDynamic on bracketS.
    {
        Problem P;
        if (makeProblem(kFixtures[0], P)) {
            la::resetDenseOpStats();
            la::resetDenseKernelStats();
            la::setDenseOpStatsEnabled(true);
            double t0 = nowSec();
            fea::ModalResult mr = fea::solveModal(P.mesh, kSteel, P.bcs, 6);
            double t = nowSec() - t0;
            la::setDenseOpStatsEnabled(false);
            printOpStats(("solveModal Lanczos path, bracketS n=" + std::to_string(P.mesh.nodes.size()) + " DOF").c_str(), t);
            printKernelHistogram(la::denseKernelStats());
            check(mr.nModes == 6, "A1 solveModal (Lanczos) returned 6 modes");
            la::resetDenseOpStats();
            la::resetDenseKernelStats();
            la::setDenseOpStatsEnabled(true);
            t0 = nowSec();
            fea::DynamicResult dr = fea::solveDynamic(P.mesh, kSteel, P.loads, P.bcs, 10 * 1e-5, 1e-5, 10.0, 1e-6);
            t = nowSec() - t0;
            la::setDenseOpStatsEnabled(false);
            printOpStats(("solveDynamic 10 steps, bracketS n=" + std::to_string(P.mesh.nodes.size()) + " DOF").c_str(), t);
            printKernelHistogram(la::denseKernelStats());
            check(dr.times.size() == 11, "A1 solveDynamic ran 10 steps");
        }
    }
    // PlaneGCS sketch solver: an open rectilinear staircase of K points, each
    // segment Horizontal/Vertical + Distance, first point fixed (fully constrained).
    for (int K : {16, 64, 128}) {
        forge::SketchHandle h = forge::createSketch();
        std::vector<forge::SketchParamId> pts;
        double x = 0, y = 0;
        for (int i = 0; i < K; ++i) {
            pts.push_back(forge::addPoint(h, x + 0.3 * std::sin(i), y + 0.2 * std::cos(i)));
            if (i % 2 == 0) x += 10.0; else y += 10.0;
        }
        for (int i = 0; i + 1 < K; ++i) {
            const forge::SketchEntityId L = forge::addLine(h, pts[static_cast<std::size_t>(i)], pts[static_cast<std::size_t>(i) + 1]);
            forge::addConstraint(h, i % 2 == 0 ? forge::SketchConstraintKind::Horizontal : forge::SketchConstraintKind::Vertical,
                                 {L}, 0.0);
            forge::addConstraint(h, forge::SketchConstraintKind::Distance,
                                 {pts[static_cast<std::size_t>(i)], pts[static_cast<std::size_t>(i) + 1]}, 10.0);
        }
        forge::addConstraint(h, forge::SketchConstraintKind::Fix, {pts[0]}, 0.0);
        la::resetDenseOpStats();
        la::setDenseOpStatsEnabled(true);
        const double t0 = nowSec();
        const forge::SketchSolveResult res = forge::solve(h);
        const double t = nowSec() - t0;
        la::setDenseOpStatsEnabled(false);
        forge::destroySketch(h);
        printOpStats(("PlaneGCS sketch solve, staircase K=" + std::to_string(K) + " points (" + std::to_string(2 * K) +
                      " params), status " + std::to_string(static_cast<int>(res.status)) + " dof " + std::to_string(res.dof))
                         .c_str(),
                     t);
    }
    // NurbsFit: least-squares Z surface through a gridded cloud.
    for (int g : {20, 40}) {
        forge::nurbsfit::FitInputs in;
        for (int i = 0; i < g; ++i)
            for (int j = 0; j < g; ++j) {
                const double u = i / (g - 1.0), v = j / (g - 1.0);
                in.points.insert(in.points.end(), {u, v, std::sin(3 * u) * std::cos(2 * v)});
            }
        in.uCount = g / 2;
        in.vCount = g / 2;
        la::resetDenseOpStats();
        la::setDenseOpStatsEnabled(true);
        const double t0 = nowSec();
        forge::nurbsfit::FitResult fr = forge::nurbsfit::fitSurface(in);
        const double t = nowSec() - t0;
        la::setDenseOpStatsEnabled(false);
        printOpStats(("NurbsFit fitSurface " + std::to_string(g * g) + " points, " + std::to_string(g / 2) + "x" +
                      std::to_string(g / 2) + " control net, rms " + std::to_string(fr.rmsResidual))
                         .c_str(),
                     t);
    }
}

// ---- A4: crossover microbenchmark of the three kernels ------------------------
// Seconds per call of one kernel at (m, k) under the CURRENT backend policy:
// best of 5 batches of fresh in-place inputs, each batch >= 1 ms (or capped at
// 4M doubles of inputs); the copies are made before the batch timer starts.
double timeKernel(int kern, int m, int k) {
    std::mt19937 rng(7);
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    std::vector<double> src;
    std::vector<double> L;   // trsm's k x k lower factor; syrk's m x k B
    if (kern == 0) {         // SPD k x k, diagonally dominant
        src.assign(static_cast<std::size_t>(k) * k, 0.0);
        for (int j = 0; j < k; ++j)
            for (int i = j; i < k; ++i) {
                const double v = (i == j) ? k + 2.0 : 0.5 * U(rng) / k;
                src[static_cast<std::size_t>(j) * k + i] = v;
                src[static_cast<std::size_t>(i) * k + j] = v;
            }
    } else if (kern == 1) {  // B m x k; L k x k lower, diagonal 2
        src.resize(static_cast<std::size_t>(m) * k);
        for (double& v : src) v = U(rng);
        L.assign(static_cast<std::size_t>(k) * k, 0.0);
        for (int j = 0; j < k; ++j) {
            L[static_cast<std::size_t>(j) * k + j] = 2.0;
            for (int i = j + 1; i < k; ++i) L[static_cast<std::size_t>(j) * k + i] = 0.5 * U(rng) / k;
        }
    } else {                 // C m x m identity; B m x k
        src.assign(static_cast<std::size_t>(m) * m, 0.0);
        for (int i = 0; i < m; ++i) src[static_cast<std::size_t>(i) * m + i] = 1.0;
        L.resize(static_cast<std::size_t>(m) * k);
        for (double& v : L) v = U(rng);
    }
    const std::size_t sz = src.size();
    double best = 1e300;
    std::size_t batch = 1;
    for (int rep = 0; rep < 5; ++rep) {
        double t = 0;
        for (;;) {
            std::vector<double> buf(sz * batch);
            for (std::size_t b = 0; b < batch; ++b) std::copy(src.begin(), src.end(), buf.begin() + static_cast<std::ptrdiff_t>(b * sz));
            const double t0 = nowSec();
            for (std::size_t b = 0; b < batch; ++b) {
                double* X = buf.data() + b * sz;
                if (kern == 0) la::densePotrf(k, X, k);
                else if (kern == 1) la::denseTrsm(m, k, L.data(), k, X, m);
                else la::denseSyrk(m, k, L.data(), m, X, m);
            }
            t = nowSec() - t0;
            if (t >= 1e-3 || sz * batch * 4 > (std::size_t(1) << 22)) break;
            batch *= 4;
        }
        best = std::min(best, t / static_cast<double>(batch));
    }
    return best;
}

void runCrossover() {
    std::printf("\n==== A4 dense-kernel crossover (seconds per call; rule = denseAccelerateWins) ====\n");
    if (!la::denseAccelerateAvailable()) {
        std::printf("  library built WITHOUT Accelerate: every call runs the native loops\n");
        return;
    }
    struct Cell { int kern, m, k; };
    std::vector<Cell> cells;
    for (int k : {1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64, 128, 256}) cells.push_back({0, k, k});
    for (int m : {16, 32, 64, 128, 256, 512, 1024})
        for (int k : {1, 2, 3, 4, 8, 12, 16, 24, 32, 64}) {
            cells.push_back({1, m, k});
            cells.push_back({2, m, k});
        }
    int gross = 0, mild = 0, over2 = 0;
    double logSum = 0.0, worst = 1.0;
    int cellsTimed = 0;
    std::printf("  kernel     m     k      native  Accelerate  native/acc  rule        verdict\n");
    for (const Cell& c : cells) {
        // interleaved, best of 3 rounds per backend (each round itself best of
        // 5 batches): the box is shared, so a single sample can be a load spike
        double tn = 1e300, ta = 1e300;
        for (int round = 0; round < 3; ++round) {
            la::setDenseBackendPolicy(la::DenseBackendPolicy::ForceNative);
            tn = std::min(tn, timeKernel(c.kern, c.m, c.k));
            la::setDenseBackendPolicy(la::DenseBackendPolicy::ForceAccelerate);
            ta = std::min(ta, timeKernel(c.kern, c.m, c.k));
        }
        la::setDenseBackendPolicy(la::DenseBackendPolicy::Auto);
        const bool rule = la::denseAccelerateWins(static_cast<la::DenseKernel>(c.kern), c.m, c.k);
        const double chosen = rule ? ta : tn, other = rule ? tn : ta;
        const double pen = chosen / std::max(std::min(chosen, other), 1e-12);   // >= 1
        logSum += std::log(pen);
        worst = std::max(worst, pen);
        ++cellsTimed;
        const char* verdict = "ok";
        if (chosen > 3.0 * other + 2e-9) { verdict = "LOSES >3x"; ++gross; }
        else if (chosen > 2.0 * other + 2e-9) { verdict = "loses 2-3x"; ++over2; }
        else if (chosen > 1.1 * other + 2e-9) { verdict = "loses <2x"; ++mild; }
        std::printf("  %-6s %5d %5d  %10.3e  %10.3e  %10.2f  %-10s  %s\n", kKernelNames[c.kern], c.m, c.k, tn, ta,
                    ta > 0 ? tn / ta : 0.0, rule ? "Accelerate" : "native", verdict);
    }
    std::printf("  crossover rule: potrf k >= 8; trsm k >= 24 or (m <= 32 and k >= 8);\n"
                "                  syrk k >= 12 or (m >= 256 and k >= 8) or (m >= 512 and k >= 2)\n");
    const double geo = cellsTimed ? std::exp(logSum / cellsTimed) : 1.0;
    std::printf("  rule vs the per-cell best backend over %d cells: geometric-mean penalty %.3f, worst %.2fx;\n"
                "  cells 1.1-2x slower: %d, 2-3x: %d, >3x: %d (cells right at a crossover vary run to run on\n"
                "  this shared box: syrk m=64 k=8 measured native/Accelerate 2.17, 0.59, 0.95, 2.20 in four runs)\n",
                cellsTimed, geo, worst, mild, over2, gross);
    check(geo <= 1.15, "C1 the dispatch rule is within 15% of the per-cell best backend (geometric mean " + std::to_string(geo) + ")");
    check(gross == 0, "C1 the dispatch rule never picks a backend measured > 3x slower (" + std::to_string(gross) + " cells)");
    check(over2 <= 2, "C1 at most 2 cells (timing noise at a crossover) lose 2-3x (" + std::to_string(over2) + " cells)");
}

int runGate() {
    const std::string want = std::getenv("LAG_FIXTURES") ? std::getenv("LAG_FIXTURES") : "bracketS,bracketM,cantilever,tube";
    const int reps = std::max(1, static_cast<int>(envD("LAG_REPS", 3)));
    const bool acc = la::denseAccelerateAvailable();
    const double R = acc ? 0.35 : 0.75;
    std::printf("linalg_accelerate_gate (T-157): Accelerate %s; default method %s; speed bound R = %.2f\n",
                acc ? "AVAILABLE" : "NOT built in",
                la::kDefaultSparseFactorMethod == la::SparseFactorMethod::Supernodal ? "Supernodal" : "UpLooking", R);

    // ---- capture the production matrices
    struct M { std::string tag; la::SparseCSR<double> A; };
    std::vector<M> corpus;
    for (const Fixture& fx : kFixtures) {
        if (!wanted(want, fx.tag)) continue;
        Problem P;
        if (!makeProblem(fx, P)) continue;
        Capture cs, ct;
        la::setSparseLDLTObserver(&captureObserver, &cs);
        fea::StaticResult sr = fea::solveStatic(P.mesh, kSteel, P.loads, {}, P.bcs);
        la::setSparseLDLTObserver(&captureObserver, &ct);
        fea::ThermalResult tr = fea::solveThermal(P.mesh, {45.0}, P.dir, P.src, {});
        la::setSparseLDLTObserver(nullptr, nullptr);
        check(cs.mats.size() == 1 && ct.mats.size() == 1, std::string("capture one matrix each from solveStatic/solveThermal ") + fx.tag);
        if (cs.mats.size() == 1) corpus.push_back({std::string(fx.tag) + "-static", cs.mats[0]});
        if (ct.mats.size() == 1) corpus.push_back({std::string(fx.tag) + "-thermal", ct.mats[0]});
        (void)sr;
        (void)tr;
    }

    std::printf("\n==== A1 SparseLDLT size distribution (production FEA matrices) + A2/A3 per matrix ====\n");
    double totUp = 0, totDef = 0;
    la::DenseKernelStats corpusStats{};
    std::mt19937 rng(12345);
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    for (M& mtx : corpus) {
        const la::SparseCSR<double>& A = mtx.A;
        const std::size_t n = A.rows();
        std::vector<double> xs(n);
        for (double& v : xs) v = U(rng);
        const std::vector<double> b = A * xs;
        // oracle: the up-looking LDLᵀ as shipped (T-163 ordering policy at its speed)
        const Solve up = factorAndSolve(A, la::SparseFactorMethod::UpLooking, b, xs, reps, false);
        const la::SparseOrdering upOrd = up.ord;
        const double upFlops = up.flops;
        // default (Supernodal, Auto dispatch) — with the size histogram of THIS matrix
        la::resetDenseKernelStats();
        const Solve def = factorAndSolve(A, la::kDefaultSparseFactorMethod, b, xs, 1, true);
        const la::DenseKernelStats st = la::denseKernelStats();
        for (int k = 0; k < 3; ++k) corpusStats.accelBelowCrossover[k] += st.accelBelowCrossover[k];
        for (int k = 0; k < 3; ++k)
            for (int bk = 0; bk < 2; ++bk) {
                corpusStats.calls[k][bk] += st.calls[k][bk];
                corpusStats.madds[k][bk] += st.madds[k][bk];
                for (int q = 0; q < la::kDenseSizeBuckets; ++q) {
                    corpusStats.bucketCalls[k][bk][q] += st.bucketCalls[k][bk][q];
                    corpusStats.bucketMadds[k][bk][q] += st.bucketMadds[k][bk][q];
                }
            }
        const Solve defT = factorAndSolve(A, la::kDefaultSparseFactorMethod, b, xs, reps, false);   // timed best-of
        const la::SparseOrdering defOrd = def.ord;
        la::setDenseBackendPolicy(la::DenseBackendPolicy::ForceNative);
        const Solve nat = factorAndSolve(A, la::kDefaultSparseFactorMethod, b, xs, 1, false);
        la::setDenseBackendPolicy(la::DenseBackendPolicy::ForceAccelerate);
        const Solve fa = factorAndSolve(A, la::kDefaultSparseFactorMethod, b, xs, 1, false);
        la::setDenseBackendPolicy(la::DenseBackendPolicy::Auto);

        std::printf("\n  %-18s n=%-6zu nnz(A)=%-8zu | up-looking (%s) nnz(L)=%zu %.2f GF %.3f s relres %.2e fwd %.2e\n",
                    mtx.tag.c_str(), n, A.nnz(), la::sparseOrderingName(upOrd), up.nnzL, upFlops / 1e9, up.seconds,
                    up.relres, up.fwd);
        std::printf("  %-18s default supernodal (%s) nnz(L)=%zu %.3f s (x%.2f) relres %.2e fwd %.2e dx %.2e | "
                    "forced-native %.3f s relres %.2e dx %.2e | forced-Accelerate %.3f s relres %.2e dx %.2e\n",
                    "", la::sparseOrderingName(defOrd), def.nnzL, defT.seconds, defT.seconds > 0 ? up.seconds / defT.seconds : 0.0,
                    def.relres, def.fwd, maxRelDiff(def.x, up.x), nat.seconds, nat.relres, maxRelDiff(nat.x, up.x),
                    fa.seconds, fa.relres, maxRelDiff(fa.x, up.x));
        printKernelHistogram(st);
        jsonLine("{\"matrix\":\"" + mtx.tag + "\",\"n\":" + std::to_string(n) + ",\"nnzA\":" + std::to_string(A.nnz()) +
                 ",\"up_s\":" + jnum(up.seconds) + ",\"default_s\":" + jnum(defT.seconds) + ",\"native_s\":" + jnum(nat.seconds) +
                 ",\"accel_s\":" + jnum(fa.seconds) + ",\"up_relres\":" + jnum(up.relres) + ",\"default_relres\":" +
                 jnum(def.relres) + ",\"dx\":" + jnum(maxRelDiff(def.x, up.x)) + "}");

        check(up.ok && def.ok && nat.ok && fa.ok, "G1 " + mtx.tag + " every method factors");
        const char* armName[3] = {"default", "forced-native", "forced-Accelerate"};
        const Solve* arm[3] = {&def, &nat, &fa};
        for (int a = 0; a < 3; ++a) {
            if (!arm[a]->ok || !up.ok) continue;
            check(arm[a]->relres <= 1e-12 && arm[a]->relres <= 10 * up.relres + 1e-15,
                  "G2 " + mtx.tag + " " + armName[a] + " relres <= 1e-12 and <= 10x up-looking");
            check(maxRelDiff(arm[a]->x, up.x) <= 1e-9, "G2 " + mtx.tag + " " + armName[a] + " solution == up-looking to 1e-9");
        }
        totUp += up.seconds;
        totDef += defT.seconds;
        if (upFlops >= 0.5e9)
            check(defT.seconds <= R * up.seconds,
                  "G4 " + mtx.tag + " default compute " + std::to_string(defT.seconds) + " s <= " + std::to_string(R) +
                      " x up-looking " + std::to_string(up.seconds) + " s");
    }
    std::printf("\n  corpus compute(): up-looking %.3f s -> default %.3f s (x%.2f)\n", totUp, totDef,
                totDef > 0 ? totUp / totDef : 0.0);
    check(!corpus.empty() && totDef <= R * totUp, "G4 corpus total default compute <= R x up-looking");
    std::printf("\n  [A1] corpus dense-kernel distribution under the default dispatch:\n");
    printKernelHistogram(corpusStats);

    // ---- C2: Accelerate never used below the crossover
    {
        const auto& s2 = corpusStats;
        std::uint64_t nat = 0, ac = 0, below = 0;
        for (int k = 0; k < 3; ++k) { nat += s2.calls[k][0]; ac += s2.calls[k][1]; below += s2.accelBelowCrossover[k]; }
        std::printf("  calls: native %llu, Accelerate %llu; Accelerate calls below the crossover: %llu\n",
                    static_cast<unsigned long long>(nat), static_cast<unsigned long long>(ac),
                    static_cast<unsigned long long>(below));
        check(below == 0, "C2 no Accelerate call below the measured crossover under the default dispatch");
        if (acc) {
            check(s2.bucketCalls[0][1][0] == 0, "C2 every potrf with k < 8 ran the native loop");
            check(ac > 0, "C2 Accelerate is actually used above the crossover");
        } else {
            check(ac == 0, "C2 a build without Accelerate sends it nothing");
        }
    }

    profileDenseSolvers();
    runCrossover();
    return g_fail ? 1 : 0;
}
#endif  // !LAG_E2E_ONLY

}  // namespace

int main(int argc, char** argv) {
    if (const char* jp = std::getenv("LAG_JSON")) g_jsonPath = jp;
    const std::string mode = argc > 1 ? argv[1] : "gate";
    int rc = 2;
    if (mode == "e2e" && argc > 2) rc = runE2E(argv[2]);
    else if (mode == "compare" && argc > 3) rc = runCompare(argv[2], argv[3]);
#ifndef LAG_E2E_ONLY
    else if (mode == "gate") rc = runGate();
#endif
    else {
        std::fprintf(stderr, "usage: %s [gate] | e2e <out.bin> | compare <a.bin> <b.bin>\n", argv[0]);
        return 2;
    }
    std::printf("%s (%d failed checks)\n", rc == 0 ? "GATE PASS" : "GATE FAIL", g_fail);
    return rc;
}
