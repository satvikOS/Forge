// forge-kernel/test/sparse_ordering_gate.cpp — T-163
//
// GATE: the fill-reducing ordering behind forge::native::linalg::SparseLDLT,
// measured on REAL FEA matrices that the kernel's OWN production solvers
// assemble — never on a synthetic stencil.
//
// HOW THE MATRICES ARE OBTAINED
//   CAD parts are built through the public kernel API, meshed with
//   forge::fea::meshFromBRep (8-node hex), and solved with the production
//   forge::fea::solveStatic (3 DOF/node, incompatible-mode hex, pinned DOFs
//   kept as identity rows) and forge::fea::solveThermal (1 DOF/node conduction,
//   Dirichlet elimination). The linalg observation seam
//   (la::setSparseLDLTObserver) copies the EXACT CSR matrix each solver hands to
//   SparseLDLT. Fixtures (tag: part, element size):
//     bracketS/M/L  120x40x20 mm block minus a Ø16 through-hole, h = 4/2/1.5 mm
//     cantilever    200x20x20 mm bar, h = 2.5 mm — the long thin case where PR
//                   #282 measured AMD LOSING 1.4x to the natural numbering
//     tube          R30/R18 x 80 mm tube, h = 2.5 mm — an annulus (a hole
//                   through the graph), PR #282's biggest AMD win
//
// WHAT IS MEASURED, per captured matrix (n, nnz(A) printed)
//   For Natural / RCM (what shipped) / AMD / NestedDissection and the DEFAULT
//   ordering every production call site gets (SparseLDLT(A) == Auto):
//     * nnz(L) and factor flops from an INDEPENDENT O(nnz(L)) symbolic analysis
//       written here (etree + row-subtree marking), cross-checked against the
//       library's O(nnz(A)) symbolicFactorStats() AND against factorNnz();
//     * ordering time, and compute() wall-clock (ordering + symbolic + numeric,
//       best of R runs) — the cost a call site actually pays;
//     * relative residual ‖Ax−b‖₂/‖b‖₂ and forward error ‖x−x*‖₂/‖x*‖₂ for
//       b = A x* with a fixed pseudo-random x*, and the solution difference
//       against the RCM arm (= the solver exactly as it shipped).
//   Reference (Apple only, TEST-ONLY, never linked into the library): Accelerate
//   SparseFactor(Cholesky) with its own AMD and METIS orderings — factor time,
//   residual, forward error, and the EXACT nnz(L) of the permutation it
//   computed (returned via options.order; counted with the same symbolic
//   analysis, so fill is compared like for like).
//
// ASSERTIONS (exit 0 iff all pass)
//   G1 every ordering is a valid permutation of 0..n-1.
//   G2 for every arm: factorNnz() == independent symbolic nnz(L) == library
//      symbolicFactorStats().nnzL (and flops agree to 1e-9 relative).
//   G3 THE POLICY DOES WHAT IT SAYS (SparseOrdering::Auto is a cost model, see
//      chooseOrdering in LinAlg.cpp): the AutoOrderingReport agrees with
//      SparseLDLT::chosenOrdering(); RCM/AMD were evaluated iff Natural's flops
//      exceed the reorder threshold, ND iff the best cheap flops reach the ND
//      threshold; the default's flops equal the minimum over exactly the arms
//      the policy evaluated; and whenever a reordering was considered the
//      default needs no more flops than RCM (what shipped).
//   G4 ND QUALITY vs the industrial reference (Apple): the native nested
//      dissection's nnz(L) <= 1.20 x Accelerate-METIS nnz(L) on every matrix,
//      and <= 1.10 x over the corpus. (Before this task's ND changes it was
//      1.19-1.24x per matrix; RCM, the shipped ordering, is 1.66x on
//      bracketM-static.)
//   G5 ACCURACY: default relres <= 1e-12 and <= 10x the best of (RCM,
//      Accelerate) + 1e-15; default forward error <= 10x RCM's (the solver as
//      shipped) + 1e-15; and the default solution equals the RCM solution to
//      1e-9 relative (max-norm) — a faster solve to a worse answer is a
//      regression.
//   G6 TIME (ordering included — the cost a call site pays): on every matrix
//      the default compute() <= 1.25 x the fastest fixed arm's compute() +
//      5 ms (the policy may spend at most that much choosing); on every matrix
//      with n >= 10000 it is faster than RCM; and over the corpus the default's
//      total compute() is below RCM's.
//   G7 END-TO-END: solveStatic / solveThermal succeed, relative residual
//      <= 1e-9, and exactly one matrix is captured per solve.
//
// Build + run: test/run_sparse_ordering_gate.sh. Env knobs:
//   SOG_FIXTURES=bracketS,...  which fixtures to run  (default: all)
//   SOG_FLOP_BUDGET=1.2e11     skip a NON-default, non-RCM arm's numeric factor
//                              predicted above this many flops (fill still
//                              reported, from the symbolic analysis)
//   SOG_REPS=3                 best-of repetitions (1 for factors > 20 s)
//   SOG_JSON=<path>            append one JSON line per matrix (evidence)
//
// Compiled with -DSOG_E2E_ONLY it uses only the long-standing public FEA API
// (no new linalg symbol) and just times solveStatic / solveThermal on the same
// fixtures, so the SAME source can be linked against a pre-change library to
// give the end-to-end BEFORE number (run_sparse_ordering_gate.sh does this when
// BASELINE_KERNEL_BUILD is set).

#include "forge/Booleans.hpp"
#include "forge/Fea.hpp"
#include "forge/Primitives.hpp"
#include "forge/Transform.hpp"
#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <cfloat>
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

#if defined(__APPLE__) && !defined(SOG_E2E_ONLY)
#include <Accelerate/Accelerate.h>
#define SOG_HAVE_ACCELERATE 1
#endif

namespace la = forge::native::linalg;

namespace {

int g_fail = 0;
void check(bool ok, const std::string& what) {
    std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
    if (!ok) ++g_fail;
}

double nowSec() {
    return std::chrono::duration<double>(
               std::chrono::steady_clock::now().time_since_epoch()).count();
}

double envD(const char* k, double dflt) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::atof(v) : dflt;
}

std::string jnum(double v) {           // JSON number or null (never "nan")
    if (!std::isfinite(v)) return "null";
    char b[64];
    std::snprintf(b, sizeof b, "%.9g", v);
    return b;
}

std::string g_jsonPath;
void jsonLine(const std::string& s) {
    if (g_jsonPath.empty()) return;
    if (FILE* f = std::fopen(g_jsonPath.c_str(), "a")) { std::fprintf(f, "%s\n", s.c_str()); std::fclose(f); }
}

#ifndef SOG_E2E_ONLY
// ---------------------------------------------------------------------------
// Independent symbolic analysis of P A Pᵀ (pattern of A from CSR, both
// triangles, diagonal ignored): elimination tree by Liu's algorithm, then
// column counts by marking every row subtree — O(nnz(L)), deliberately a
// DIFFERENT algorithm from the library's O(nnz(A)) Gilbert-Ng-Peyton counts
// so G2 is a real cross-check. Returns {nnz(strict L), Σ c(c+3)/2}.
// ---------------------------------------------------------------------------
struct Symbolic { std::size_t nnzL = 0; double flops = 0; };

Symbolic symbolicCount(const la::SparseCSR<double>& A, const std::vector<std::size_t>& perm) {
    const std::size_t n = A.rows();
    const auto& rp = A.rowPtr();
    const auto& ci = A.colIdx();
    std::vector<std::size_t> iperm(n);
    for (std::size_t k = 0; k < n; ++k) iperm[perm[k]] = k;
    std::vector<std::vector<std::size_t>> lower(n);      // row k -> {j < k}
    for (std::size_t oi = 0; oi < n; ++oi)
        for (std::size_t p = rp[oi]; p < rp[oi + 1]; ++p) {
            const std::size_t i = iperm[oi], j = iperm[ci[p]];
            if (j < i) lower[i].push_back(j);
            else if (i < j) lower[j].push_back(i);        // symmetrize
        }
    const std::size_t NONE = static_cast<std::size_t>(-1);
    std::vector<std::size_t> parent(n, NONE), flag(n, NONE), colCount(n, 0);
    for (std::size_t k = 0; k < n; ++k) {
        flag[k] = k;
        for (std::size_t j : lower[k]) {
            std::size_t x = j;
            while (flag[x] != k) {
                if (parent[x] == NONE) parent[x] = k;
                ++colCount[x];                            // L(k, x) is structurally nonzero
                flag[x] = k;
                x = parent[x];
            }
        }
    }
    Symbolic s;
    for (std::size_t j = 0; j < n; ++j) {
        s.nnzL += colCount[j];
        const double c = static_cast<double>(colCount[j]);
        s.flops += c * (c + 3.0) / 2.0;
    }
    return s;
}

bool isPermutation(const std::vector<std::size_t>& p, std::size_t n) {
    if (p.size() != n) return false;
    std::vector<char> seen(n, 0);
    for (std::size_t v : p) { if (v >= n || seen[v]) return false; seen[v] = 1; }
    return true;
}

double norm2(const std::vector<double>& v) {
    long double s = 0;
    for (double x : v) s += static_cast<long double>(x) * x;
    return std::sqrt(static_cast<double>(s));
}

struct SolveStats { double relres = NAN, ferr = NAN; };
SolveStats solveStats(const la::SparseCSR<double>& A, const std::vector<double>& x,
                      const std::vector<double>& b, const std::vector<double>& xt) {
    SolveStats s;
    const std::vector<double> Ax = A * x;
    std::vector<double> r(b.size()), e(b.size());
    for (std::size_t i = 0; i < b.size(); ++i) { r[i] = Ax[i] - b[i]; e[i] = x[i] - xt[i]; }
    s.relres = norm2(r) / std::max(norm2(b), 1e-300);
    s.ferr   = norm2(e) / std::max(norm2(xt), 1e-300);
    return s;
}

double maxRelDiff(const std::vector<double>& a, const std::vector<double>& b) {
    if (a.size() != b.size() || a.empty()) return NAN;
    double d = 0, m = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        d = std::max(d, std::fabs(a[i] - b[i]));
        m = std::max(m, std::fabs(b[i]));
    }
    return d / std::max(m, 1e-300);
}

struct Arm {
    const char* name = "";
    la::SparseOrdering ord = la::SparseOrdering::Natural;
    bool isDefault = false;
    std::vector<std::size_t> perm;
    bool valid = false;
    Symbolic sym;                       // independent count
    la::SymbolicFactorStats lib;        // library's fast count
    double orderSec = NAN, computeSec = NAN, solveSec = NAN;
    bool factored = false, skipped = false, okFactor = false;
    std::size_t factorNnz = 0;
    la::SparseOrdering chosen = la::SparseOrdering::Natural;
    la::AutoOrderingReport report;      // the policy's decision (default arm only)
    std::vector<double> x;
    SolveStats st;
};

#ifdef SOG_HAVE_ACCELERATE
struct AccelResult {
    const char* name = "";
    bool ok = false;
    double factorSec = NAN, solveSec = NAN;
    std::size_t factorBytes = 0;
    std::vector<std::size_t> perm;    // the permutation Accelerate computed (our convention)
    Symbolic sym;                     // its exact fill by symbolicCount
    SolveStats st;
};

// Accelerate wants the LOWER triangle in CSC: column j = CSR row j entries with
// col >= j (A symmetric).
AccelResult accelerateRef(const la::SparseCSR<double>& A, SparseOrder_t method,
                          const char* name, const std::vector<double>& b,
                          const std::vector<double>& xt) {
    AccelResult R; R.name = name;
    const std::size_t n = A.rows();
    const auto& rp = A.rowPtr(); const auto& ci = A.colIdx(); const auto& av = A.values();
    std::vector<long> colStarts(n + 1, 0);
    std::vector<int> rowIdx; std::vector<double> vals;
    rowIdx.reserve(A.nnz() / 2 + n); vals.reserve(A.nnz() / 2 + n);
    for (std::size_t j = 0; j < n; ++j) {
        for (std::size_t p = rp[j]; p < rp[j + 1]; ++p)
            if (ci[p] >= j) { rowIdx.push_back(static_cast<int>(ci[p])); vals.push_back(av[p]); }
        colStarts[j + 1] = static_cast<long>(rowIdx.size());
    }
    SparseMatrixStructure s;
    std::memset(&s, 0, sizeof s);
    s.rowCount = static_cast<int>(n); s.columnCount = static_cast<int>(n);
    s.columnStarts = colStarts.data(); s.rowIndices = rowIdx.data();
    s.attributes.kind = SparseSymmetric; s.attributes.triangle = SparseLowerTriangle;
    s.blockSize = 1;
    SparseMatrix_Double M; M.structure = s; M.data = vals.data();

    std::vector<int> order(n, -1);
    SparseSymbolicFactorOptions so;
    std::memset(&so, 0, sizeof so);
    so.control = SparseDefaultControl; so.orderMethod = method;
    so.order = order.data(); so.ignoreRowsAndColumns = nullptr;
    so.malloc = [](size_t sz) -> void* { return std::malloc(sz); };
    so.free = [](void* ptr) { std::free(ptr); };
    so.reportError = nullptr;
    SparseNumericFactorOptions no;
    std::memset(&no, 0, sizeof no);
    no.control = SparseDefaultControl; no.scalingMethod = SparseScalingDefault;
    no.scaling = nullptr; no.pivotTolerance = 0.01; no.zeroTolerance = 1e-4 * DBL_EPSILON;

    const double t0 = nowSec();
    SparseOpaqueFactorization_Double F = SparseFactor(SparseFactorizationCholesky, M, so, no);
    R.factorSec = nowSec() - t0;
    R.ok = (F.status == SparseStatusOK);
    if (R.ok) {
        R.factorBytes = F.symbolicFactorization.factorSize_Double;
        std::vector<double> bx(b), xx(n, 0.0);
        DenseVector_Double bv{static_cast<int>(n), bx.data()};
        DenseVector_Double xv{static_cast<int>(n), xx.data()};
        const double t2 = nowSec();
        SparseSolve(F, bv, xv);
        R.solveSec = nowSec() - t2;
        R.st = solveStats(A, xx, b, xt);
        bool full = true;
        for (int v : order) if (v < 0 || static_cast<std::size_t>(v) >= n) { full = false; break; }
        if (full) {
            // Accelerate's order[i] is the INVERSE of our convention (ours:
            // perm[k] = original index at position k) — verified per matrix by
            // the replay control below.
            R.perm.assign(n, 0);
            for (std::size_t i = 0; i < n; ++i) R.perm[static_cast<std::size_t>(order[i])] = i;
            R.sym = isPermutation(R.perm, n) ? symbolicCount(A, R.perm) : Symbolic{};
        }
    }
    SparseCleanup(F);
    return R;
}

// Accelerate's symbolic factor size (bytes) for an OUR-convention permutation.
std::size_t accelerateUserOrderBytes(const la::SparseCSR<double>& A,
                                     const std::vector<std::size_t>& perm) {
    const std::size_t n = A.rows();
    const auto& rp = A.rowPtr(); const auto& ci = A.colIdx();
    std::vector<long> colStarts(n + 1, 0);
    std::vector<int> rowIdx;
    for (std::size_t j = 0; j < n; ++j) {
        for (std::size_t p = rp[j]; p < rp[j + 1]; ++p)
            if (ci[p] >= j) rowIdx.push_back(static_cast<int>(ci[p]));
        colStarts[j + 1] = static_cast<long>(rowIdx.size());
    }
    SparseMatrixStructure s;
    std::memset(&s, 0, sizeof s);
    s.rowCount = static_cast<int>(n); s.columnCount = static_cast<int>(n);
    s.columnStarts = colStarts.data(); s.rowIndices = rowIdx.data();
    s.attributes.kind = SparseSymmetric; s.attributes.triangle = SparseLowerTriangle;
    s.blockSize = 1;
    std::vector<int> order(n);           // Accelerate convention: inverse(perm)
    for (std::size_t k = 0; k < n; ++k) order[perm[k]] = static_cast<int>(k);
    SparseSymbolicFactorOptions so;
    std::memset(&so, 0, sizeof so);
    so.control = SparseDefaultControl; so.orderMethod = SparseOrderUser;
    so.order = order.data();
    so.malloc = [](size_t sz) -> void* { return std::malloc(sz); };
    so.free = [](void* ptr) { std::free(ptr); };
    SparseOpaqueSymbolicFactorization S = SparseFactor(SparseFactorizationCholesky, s, so);
    const std::size_t bytes = (S.status == SparseStatusOK) ? S.factorSize_Double : 0;
    SparseCleanup(S);
    return bytes;
}
#endif

// corpus totals for the summary
struct Totals {
    double nnzL[5] = {0, 0, 0, 0, 0};          // natural, rcm, amd, nd, default
    double flops[5] = {0, 0, 0, 0, 0};
    double accBest = 0;
    double ndNnzL = 0, metisNnzL = 0;          // only where both exist (G4 corpus)
    double rcmCompute = 0, dftCompute = 0;     // only where both were timed
    int matrices = 0, rcmWorseThanNatural = 0, amdWorseThanRcm = 0;
    double worstSolnDiff = 0;
};
Totals g_tot;

void analyse(const std::string& name, const la::SparseCSR<double>& A, int reps,
             double flopBudget) {
    const std::size_t n = A.rows();
    std::printf("\n== %s : n=%zu nnz(A)=%zu ==\n", name.c_str(), n, A.nnz());

    std::mt19937_64 rng(0x163u);
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    std::vector<double> xt(n);
    for (double& v : xt) v = U(rng);
    const std::vector<double> b = A * xt;

    std::vector<Arm> arms(5);
    arms[0].name = "natural"; arms[0].ord = la::SparseOrdering::Natural;
    arms[1].name = "rcm";     arms[1].ord = la::SparseOrdering::RCM;
    arms[2].name = "amd";     arms[2].ord = la::SparseOrdering::AMD;
    arms[3].name = "nd";      arms[3].ord = la::SparseOrdering::NestedDissection;
    arms[4].name = "default"; arms[4].ord = la::kDefaultSparseOrdering; arms[4].isDefault = true;

    for (Arm& a : arms) {
        const double t0 = nowSec();
        a.perm = la::fillReducingOrdering(A, a.ord, &a.chosen, &a.report);
        a.orderSec = nowSec() - t0;
        a.valid = isPermutation(a.perm, n);
        if (!a.valid) continue;
        a.sym = symbolicCount(A, a.perm);
        a.lib = la::symbolicFactorStats(A, a.perm);
    }

    for (Arm& a : arms) {
        if (!a.valid) continue;
        // RCM and the default are always factored (they are the A/B); other
        // arms only within the flop budget.
        if (!a.isDefault && a.ord != la::SparseOrdering::RCM && a.sym.flops > flopBudget) {
            a.skipped = true;
            continue;
        }
        double best = 1e300;
        const int R = std::max(1, reps);
        for (int k = 0; k < R; ++k) {
            const double t0 = nowSec();
            la::SparseLDLT F = a.isDefault ? la::SparseLDLT(A) : la::SparseLDLT(A, a.ord);
            const double t1 = nowSec();
            best = std::min(best, t1 - t0);
            a.okFactor = F.ok();
            a.factorNnz = F.factorNnz();
            if (k == 0 && F.permutation() != a.perm) a.valid = false;   // compute() must use the same perm
            if (a.isDefault) a.chosen = F.chosenOrdering();
            if (F.ok() && (k == R - 1 || t1 - t0 > 20.0)) {
                const double t2 = nowSec();
                a.x = F.solve(b);
                a.solveSec = nowSec() - t2;
            }
            if (!F.ok() || t1 - t0 > 20.0) break;   // one rep for an expensive factor
        }
        a.factored = true;
        a.computeSec = best;
        if (a.okFactor && !a.x.empty()) a.st = solveStats(A, a.x, b, xt);
    }

#ifdef SOG_HAVE_ACCELERATE
    const AccelResult accAmd = accelerateRef(A, SparseOrderAMD, "accel-amd", b, xt);
    const AccelResult accMetis = accelerateRef(A, SparseOrderMetis, "accel-metis", b, xt);
    const std::size_t replayBytes =
        accAmd.perm.empty() ? 0 : accelerateUserOrderBytes(A, accAmd.perm);
#endif

    std::printf("  %-12s %-17s %12s %10s %9s %10s %9s %11s %11s %11s\n",
                "ordering", "chosen", "nnz(L)", "GFlop", "order_s", "compute_s",
                "solve_s", "relres", "fwd_err", "dx_vs_rcm");
    const Arm& rcm = arms[1];
    for (const Arm& a : arms) {
        char cs[32];
        if (a.skipped) std::snprintf(cs, sizeof cs, "SKIP");
        else std::snprintf(cs, sizeof cs, "%.4f", a.computeSec);
        const double dx = (a.x.empty() || rcm.x.empty()) ? NAN : maxRelDiff(a.x, rcm.x);
        std::printf("  %-12s %-17s %12zu %10.3f %9.4f %10s %9.4f %11.3e %11.3e %11.3e\n",
                    a.name, la::sparseOrderingName(a.chosen), a.sym.nnzL, a.sym.flops * 1e-9,
                    a.orderSec, cs, a.solveSec, a.st.relres, a.st.ferr, dx);
    }
#ifdef SOG_HAVE_ACCELERATE
    for (const AccelResult* r : {&accAmd, &accMetis})
        std::printf("  %-12s %-17s %12zu %10.3f %9s %10.4f %9.4f %11.3e %11.3e  (factor only; %zu B)\n",
                    r->name, "(Accelerate)", r->sym.nnzL, r->sym.flops * 1e-9, "-", r->factorSec,
                    r->solveSec, r->st.relres, r->st.ferr, r->factorBytes);
#endif

    // ---- JSON evidence ------------------------------------------------------
    {
        std::string j = "{\"matrix\":\"" + name + "\",\"n\":" + std::to_string(n) +
                        ",\"nnzA\":" + std::to_string(A.nnz()) + ",\"orderings\":{";
        bool first = true;
        for (const Arm& a : arms) {
            const double dx = (a.x.empty() || rcm.x.empty()) ? NAN : maxRelDiff(a.x, rcm.x);
            j += std::string(first ? "" : ",") + "\"" + a.name + "\":{\"chosen\":\"" +
                 la::sparseOrderingName(a.chosen) + "\",\"nnzL\":" + std::to_string(a.sym.nnzL) +
                 ",\"gflop\":" + jnum(a.sym.flops * 1e-9) + ",\"order_s\":" + jnum(a.orderSec) +
                 ",\"compute_s\":" + jnum(a.skipped ? NAN : a.computeSec) +
                 ",\"solve_s\":" + jnum(a.solveSec) + ",\"relres\":" + jnum(a.st.relres) +
                 ",\"ferr\":" + jnum(a.st.ferr) + ",\"dx_vs_rcm\":" + jnum(dx) +
                 ",\"factorNnz\":" + std::to_string(a.factorNnz) +
                 ",\"skipped\":" + (a.skipped ? "true" : "false") + "}";
            first = false;
        }
#ifdef SOG_HAVE_ACCELERATE
        for (const AccelResult* r : {&accAmd, &accMetis})
            j += std::string(",\"") + r->name + "\":{\"nnzL\":" + std::to_string(r->sym.nnzL) +
                 ",\"gflop\":" + jnum(r->sym.flops * 1e-9) + ",\"factor_s\":" + jnum(r->factorSec) +
                 ",\"solve_s\":" + jnum(r->solveSec) + ",\"relres\":" + jnum(r->st.relres) +
                 ",\"ferr\":" + jnum(r->st.ferr) + ",\"factorBytes\":" + std::to_string(r->factorBytes) + "}";
#endif
        {
            const la::AutoOrderingReport& rp = arms[4].report;
            j += std::string("},\"auto\":{\"chosen\":\"") + la::sparseOrderingName(rp.chosen) +
                 "\",\"natural_flops\":" + jnum(rp.naturalFlops) + ",\"reorder_threshold\":" + jnum(rp.reorderThresholdFlops) +
                 ",\"evaluated_cheap\":" + (rp.evaluatedCheap ? "true" : "false") +
                 ",\"best_cheap_flops\":" + jnum(rp.bestCheapFlops) + ",\"compressed_edges\":" +
                 std::to_string(rp.compressedEdges) + ",\"nd_threshold\":" + jnum(rp.ndThresholdFlops) +
                 ",\"evaluated_nd\":" + (rp.evaluatedNd ? "true" : "false") + "}}";
        }
        jsonLine(j);
    }

    // ---- assertions ----------------------------------------------------------
    const Arm& nat = arms[0];
    const Arm& dft = arms[4];
    for (const Arm& a : arms)
        check(a.valid, name + " G1 " + a.name + " ordering is a valid permutation (and compute() used it)");
    for (const Arm& a : arms) {
        if (!a.valid) continue;
        const bool flopsAgree = std::fabs(a.lib.flops - a.sym.flops) <= 1e-9 * std::max(1.0, a.sym.flops);
        check(a.lib.nnzL == a.sym.nnzL && flopsAgree,
              name + " G2 " + a.name + " library symbolic nnz(L)=" + std::to_string(a.lib.nnzL) +
              " == independent count " + std::to_string(a.sym.nnzL));
        if (a.factored && a.okFactor)
            check(a.factorNnz == a.sym.nnzL,
                  name + " G2 " + a.name + " factorNnz()=" + std::to_string(a.factorNnz) +
                  " == independent symbolic nnz(L)");
    }
    check(dft.okFactor, name + " default SparseLDLT factorization ok()");
    // ---- G3: the Auto policy did what it reports, and what it reports is its rule
    const la::AutoOrderingReport& rp = dft.report;
    std::printf("  [auto] natural %.4g flops vs reorder threshold %.4g -> %s; best cheap %.4g vs ND threshold %.4g "
                "(compressed edges %zu) -> %s; chose %s\n",
                rp.naturalFlops, rp.reorderThresholdFlops, rp.evaluatedCheap ? "RCM+AMD evaluated" : "kept Natural",
                rp.bestCheapFlops, rp.ndThresholdFlops, rp.compressedEdges,
                rp.evaluatedNd ? "ND evaluated" : "ND skipped", la::sparseOrderingName(rp.chosen));
    check(rp.chosen == dft.chosen && std::fabs(rp.chosenFlops - dft.sym.flops) <= 1e-9 * std::max(1.0, dft.sym.flops),
          name + " G3 AutoOrderingReport agrees with SparseLDLT::chosenOrdering() and the exact flops");
    check(rp.naturalFlops == nat.sym.flops || std::fabs(rp.naturalFlops - nat.sym.flops) <= 1e-9 * std::max(1.0, nat.sym.flops),
          name + " G3 report's Natural flops == the natural arm's exact flops");
    check(rp.evaluatedCheap == (rp.naturalFlops > rp.reorderThresholdFlops) &&
          (!rp.evaluatedNd || (rp.evaluatedCheap && rp.bestCheapFlops >= rp.ndThresholdFlops)) &&
          (!rp.evaluatedCheap || rp.evaluatedNd == (rp.bestCheapFlops >= rp.ndThresholdFlops)),
          name + " G3 candidates evaluated exactly as the thresholds say");
    {
        double minEval = nat.sym.flops;
        if (rp.evaluatedCheap) minEval = std::min({minEval, rcm.sym.flops, arms[2].sym.flops});
        if (rp.evaluatedCheap && std::isfinite(rp.bestCheapFlops))
            check(std::fabs(rp.bestCheapFlops - std::min({nat.sym.flops, rcm.sym.flops, arms[2].sym.flops})) <=
                      1e-9 * std::max(1.0, rp.bestCheapFlops),
                  name + " G3 report's best cheap flops == min(natural, rcm, amd) arms");
        if (rp.evaluatedNd) minEval = std::min(minEval, arms[3].sym.flops);
        check(dft.sym.flops <= minEval * (1.0 + 1e-12),
              name + " G3 default flops " + jnum(dft.sym.flops) + " == min over the evaluated orderings " + jnum(minEval));
        if (rp.evaluatedCheap)
            check(dft.sym.flops <= rcm.sym.flops,
                  name + " G3 default flops " + jnum(dft.sym.flops) + " <= RCM (shipped) flops " + jnum(rcm.sym.flops));
    }
    double refRes = rcm.st.relres;
    const double refErr = rcm.st.ferr;
#ifdef SOG_HAVE_ACCELERATE
    check(accAmd.ok && !accAmd.perm.empty() && accMetis.ok && !accMetis.perm.empty(),
          name + " reference: Accelerate AMD and METIS factor ok and return their orderings");
    if (accAmd.ok && !accAmd.perm.empty()) {
        check(replayBytes == accAmd.factorBytes,
              name + " reference: Accelerate's returned AMD order, replayed as a user order, "
              "reproduces its factor size (permutation convention verified)");
    }
    if (!accAmd.perm.empty() && !accMetis.perm.empty()) {
        const double refFill = static_cast<double>(std::min(accAmd.sym.nnzL, accMetis.sym.nnzL));
        const double metis = static_cast<double>(std::max<std::size_t>(1, accMetis.sym.nnzL));
        const double ndRatio = static_cast<double>(arms[3].sym.nnzL) / metis;
        std::printf("  [ref] nnz(L)/METIS: natural %.3f  rcm %.3f  amd %.3f  nd %.3f  default %.3f   "
                    "flops/METIS: nd %.3f  default %.3f\n",
                    static_cast<double>(nat.sym.nnzL) / metis, static_cast<double>(rcm.sym.nnzL) / metis,
                    static_cast<double>(arms[2].sym.nnzL) / metis, ndRatio, static_cast<double>(dft.sym.nnzL) / metis,
                    arms[3].sym.flops / std::max(1.0, accMetis.sym.flops), dft.sym.flops / std::max(1.0, accMetis.sym.flops));
        check(arms[3].valid && ndRatio <= 1.20,
              name + " G4 native ND nnz(L) <= 1.20 x Accelerate-METIS nnz(L) (ratio " + jnum(ndRatio) + ")");
        g_tot.accBest += refFill;
        g_tot.ndNnzL += static_cast<double>(arms[3].sym.nnzL);
        g_tot.metisNnzL += static_cast<double>(accMetis.sym.nnzL);
    }
    refRes = std::min(refRes, std::min(accAmd.st.relres, accMetis.st.relres));
#endif
    check(dft.st.relres <= 1e-12, name + " G5 default relres " + jnum(dft.st.relres) + " <= 1e-12");
    if (std::isfinite(refRes))
        check(dft.st.relres <= 10.0 * refRes + 1e-15,
              name + " G5 default relres <= 10 x best of (RCM, Accelerate) relres " + jnum(refRes));
    check(std::isfinite(refErr) && dft.st.ferr <= 10.0 * refErr + 1e-15,
          name + " G5 default forward error " + jnum(dft.st.ferr) + " <= 10 x RCM (shipped) forward error " + jnum(refErr));
    const double dxr = (dft.x.empty() || rcm.x.empty()) ? NAN : maxRelDiff(dft.x, rcm.x);
    check(std::isfinite(dxr) && dxr <= 1e-9,
          name + " G5 default solution == RCM (shipped) solution, max|dx|/max|x| = " + jnum(dxr) + " <= 1e-9");
    // ---- G6: time, ordering included -----------------------------------------------
    {
        double fastest = 1e300;
        const char* fastestName = "?";
        for (int k = 0; k < 4; ++k) {
            const Arm& a = arms[static_cast<std::size_t>(k)];
            if (a.factored && a.okFactor && a.computeSec < fastest) { fastest = a.computeSec; fastestName = a.name; }
        }
        check(dft.factored && dft.computeSec <= 1.25 * fastest + 0.005,
              name + " G6 default compute " + jnum(dft.computeSec) + " s <= 1.25 x fastest fixed arm (" +
              fastestName + " " + jnum(fastest) + " s) + 5 ms");
    }
    if (n >= 10000) {
        check(rcm.factored && dft.factored && dft.computeSec < rcm.computeSec,
              name + " G6 default compute " + jnum(dft.computeSec) + " s < RCM compute " +
              jnum(rcm.computeSec) + " s (speedup " + jnum(rcm.computeSec / dft.computeSec) + "x)");
    }

    // ---- corpus totals -------------------------------------------------------
    ++g_tot.matrices;
    for (int k = 0; k < 5; ++k) {
        g_tot.nnzL[k] += static_cast<double>(arms[static_cast<std::size_t>(k)].sym.nnzL);
        g_tot.flops[k] += arms[static_cast<std::size_t>(k)].sym.flops;
    }
    if (rcm.sym.nnzL > nat.sym.nnzL) ++g_tot.rcmWorseThanNatural;
    if (arms[2].sym.nnzL > rcm.sym.nnzL) ++g_tot.amdWorseThanRcm;
    if (rcm.factored && dft.factored) { g_tot.rcmCompute += rcm.computeSec; g_tot.dftCompute += dft.computeSec; }
    if (std::isfinite(dxr)) g_tot.worstSolnDiff = std::max(g_tot.worstSolnDiff, dxr);
}

// ---------------------------------------------------------------------------
// Capture of the production matrices.
// ---------------------------------------------------------------------------
struct Capture { std::vector<la::SparseCSR<double>> mats; };
void captureObserver(const la::SparseCSR<double>& A, void* ctx) {
    static_cast<Capture*>(ctx)->mats.push_back(A);
}
#endif  // !SOG_E2E_ONLY

struct Fixture {
    const char* tag;
    int part;            // 0 bracket, 1 cantilever, 2 tube
    double h_mm;
    std::uint32_t clampBit, loadBit;
};

forge::ShapeHandle buildPart(int part) {
    if (part == 0) {     // 120 x 40 x 20 mm bracket with a Ø16 mm through-hole
        forge::ShapeHandle blk = forge::makeBox(120.0, 40.0, 20.0);
        forge::ShapeHandle hole = forge::translate(forge::makeCylinder(8.0, 20.0), 40.0, 20.0, 0.0);
        return forge::cut(blk, hole);
    }
    if (part == 1) return forge::makeBox(200.0, 20.0, 20.0);     // cantilever bar
    forge::ShapeHandle outer = forge::makeCylinder(30.0, 80.0);  // tube along +Z
    forge::ShapeHandle inner = forge::makeCylinder(18.0, 80.0);
    return forge::cut(outer, inner);
}

}  // namespace

int main() {
    if (const char* jp = std::getenv("SOG_JSON")) g_jsonPath = jp;
    const std::string want = std::getenv("SOG_FIXTURES") ? std::getenv("SOG_FIXTURES") : "";
#ifndef SOG_E2E_ONLY
    const double flopBudget = envD("SOG_FLOP_BUDGET", 1.2e11);
    const int reps = static_cast<int>(envD("SOG_REPS", 3));
    std::printf("sparse_ordering_gate (T-163): default SparseLDLT ordering = %s\n",
                la::sparseOrderingName(la::kDefaultSparseOrdering));
#else
    std::printf("sparse_ordering_gate (T-163) E2E-ONLY build: production solvers, library default ordering\n");
#endif
    const int e2eReps = static_cast<int>(envD("SOG_E2E_REPS", 1));

    const Fixture all[] = {
        {"bracketS", 0, 4.0, 1u << 0, 1u << 1},
        {"bracketM", 0, 2.0, 1u << 0, 1u << 1},
        {"bracketL", 0, 1.5, 1u << 0, 1u << 1},
        {"cantilever", 1, 2.5, 1u << 0, 1u << 1},
        {"tube", 2, 2.5, 1u << 4, 1u << 5},
    };
    for (const Fixture& fx : all) {
        if (!want.empty()) {
            const std::string list = "," + want + ",";
            if (list.find(std::string(",") + fx.tag + ",") == std::string::npos) continue;
        }
        forge::ShapeHandle part;
        forge::fea::Mesh mesh;
        try {
            part = buildPart(fx.part);
            mesh = forge::fea::meshFromBRep(part, fx.h_mm);
        } catch (const std::exception& e) {
            check(false, std::string(fx.tag) + " part/mesh: " + e.what());
            continue;
        }
        for (double& c : mesh.nodes) c *= 1e-3;   // mm -> m
        const std::size_t nNodes = mesh.nodes.size() / 3;
        std::printf("\n#### %s: h=%.2f mm, nodes=%zu, hex=%zu\n", fx.tag, fx.h_mm, nNodes,
                    mesh.tets.size() / 8);

        // ---- structural: clamp one face, 1 kN on the opposite face -------------
        std::vector<forge::fea::BCPinned> bcs;
        std::vector<forge::fea::LoadNodal> loads;
        std::vector<std::uint32_t> tip;
        for (std::uint32_t i = 0; i < nNodes; ++i) {
            if (mesh.nodeToFace[i] & fx.clampBit) bcs.push_back({i, true, true, true});
            else if (mesh.nodeToFace[i] & fx.loadBit) tip.push_back(i);
        }
        for (std::uint32_t i : tip) loads.push_back({i, 0.0, 0.0, -1000.0 / static_cast<double>(tip.size())});
        const forge::fea::Material steel{200e9, 0.3, 7850.0};
        const double fsc = 1000.0 / static_cast<double>(std::max<std::size_t>(1, tip.size()));

#ifndef SOG_E2E_ONLY
        Capture cap;
        la::setSparseLDLTObserver(&captureObserver, &cap);
#endif
        double tS = 1e300;
        forge::fea::StaticResult sr;
        bool okS = true;
        for (int r = 0; r < std::max(1, e2eReps) && okS; ++r) {
            const double t0 = nowSec();
            try { sr = forge::fea::solveStatic(mesh, steel, loads, {}, bcs); }
            catch (const std::exception& e) { okS = false; std::printf("solveStatic threw: %s\n", e.what()); }
            tS = std::min(tS, nowSec() - t0);
#ifndef SOG_E2E_ONLY
            la::setSparseLDLTObserver(nullptr, nullptr);   // capture the first solve only
#endif
        }
        double umax = 0;
        for (double v : sr.u) umax = std::max(umax, std::fabs(v));
        std::printf("[e2e] solveStatic %s: dof=%zu %.3f s, residual_inf=%.3e (rel %.3e), max|u|=%.12e m, maxVM=%.9e Pa\n",
                    fx.tag, 3 * nNodes, tS, sr.residual, sr.residual / fsc, umax, sr.maxVonMises);
        jsonLine(std::string("{\"e2e\":\"static-") + fx.tag + "\",\"dof\":" + std::to_string(3 * nNodes) +
                 ",\"seconds\":" + jnum(tS) + ",\"residual_inf\":" + jnum(sr.residual) +
                 ",\"umax\":" + jnum(umax) + ",\"maxVM\":" + jnum(sr.maxVonMises) + "}");
        check(okS && sr.residual / fsc <= 1e-9, std::string("G7 solveStatic ") + fx.tag + " relative residual <= 1e-9");
#ifndef SOG_E2E_ONLY
        check(cap.mats.size() == 1, std::string("G7 exactly one matrix captured from solveStatic ") + fx.tag);
        if (cap.mats.size() == 1) {
            const bool big = cap.mats[0].rows() > 60000;
            analyse(std::string(fx.tag) + "-static", cap.mats[0], big ? 1 : reps, flopBudget);
        }
        cap.mats.clear();
#endif

        // ---- thermal: 100 C on the clamp face, 20 C on the load face, source -----
        std::vector<forge::fea::ThermalNodalT> dir;
        for (std::uint32_t i = 0; i < nNodes; ++i) {
            if (mesh.nodeToFace[i] & fx.clampBit) dir.push_back({i, 100.0});
            else if (mesh.nodeToFace[i] & fx.loadBit) dir.push_back({i, 20.0});
        }
        std::vector<forge::fea::ThermalElemSource> src;
        for (std::uint32_t e = 0; e < mesh.tets.size() / 8; ++e) src.push_back({e, 1e5});
#ifndef SOG_E2E_ONLY
        Capture capT;
        la::setSparseLDLTObserver(&captureObserver, &capT);
#endif
        double tT = 1e300;
        forge::fea::ThermalResult tr;
        bool okT = true;
        for (int r = 0; r < std::max(1, e2eReps) && okT; ++r) {
            const double t0 = nowSec();
            try { tr = forge::fea::solveThermal(mesh, {45.0}, dir, src, {}); }
            catch (const std::exception& e) { okT = false; std::printf("solveThermal threw: %s\n", e.what()); }
            tT = std::min(tT, nowSec() - t0);
#ifndef SOG_E2E_ONLY
            la::setSparseLDLTObserver(nullptr, nullptr);
#endif
        }
        std::printf("[e2e] solveThermal %s: dof=%zu %.3f s, residual_inf=%.3e, T in [%.12f, %.12f]\n",
                    fx.tag, nNodes, tT, tr.residual, tr.minT, tr.maxT);
        jsonLine(std::string("{\"e2e\":\"thermal-") + fx.tag + "\",\"dof\":" + std::to_string(nNodes) +
                 ",\"seconds\":" + jnum(tT) + ",\"residual_inf\":" + jnum(tr.residual) +
                 ",\"minT\":" + jnum(tr.minT) + ",\"maxT\":" + jnum(tr.maxT) + "}");
        check(okT && tr.maxT >= 100.0 && tr.minT >= 20.0 - 1e-9,
              std::string("G7 solveThermal ") + fx.tag + " ran (max principle: T >= 20, max >= 100 with a source)");
        check(okT && tr.residual <= 1e-9 * std::max(1.0, tr.maxT),
              std::string("G7 solveThermal ") + fx.tag + " residual_inf <= 1e-9 x max|T|");
#ifndef SOG_E2E_ONLY
        check(capT.mats.size() == 1, std::string("G7 exactly one matrix captured from solveThermal ") + fx.tag);
        if (capT.mats.size() == 1)
            analyse(std::string(fx.tag) + "-thermal", capT.mats[0], reps, flopBudget);
#endif
    }

#ifndef SOG_E2E_ONLY
    // ---- corpus summary ----------------------------------------------------------
    std::printf("\n#### corpus summary over %d REAL FEA matrices\n", g_tot.matrices);
    const char* nm[5] = {"natural", "rcm (shipped)", "amd", "nd", "default (Auto)"};
    for (int k = 0; k < 5; ++k)
        std::printf("  total nnz(L) %-15s %14.0f  (%.3fx RCM)   total GFlop %10.2f (%.3fx RCM)\n", nm[k],
                    g_tot.nnzL[k], g_tot.nnzL[k] / std::max(1.0, g_tot.nnzL[1]), g_tot.flops[k] * 1e-9,
                    g_tot.flops[k] / std::max(1.0, g_tot.flops[1]));
#ifdef SOG_HAVE_ACCELERATE
    std::printf("  total nnz(L) best-of(Accelerate AMD, METIS) %14.0f  (default/ref = %.3f)\n",
                g_tot.accBest, g_tot.nnzL[4] / std::max(1.0, g_tot.accBest));
#endif
    std::printf("  RCM fills more than NO ordering on %d of %d; AMD fills more than RCM on %d of %d\n",
                g_tot.rcmWorseThanNatural, g_tot.matrices, g_tot.amdWorseThanRcm, g_tot.matrices);
    std::printf("  total compute() wall-clock: RCM %.3f s -> default %.3f s (%.2fx)\n", g_tot.rcmCompute,
                g_tot.dftCompute, g_tot.rcmCompute / std::max(1e-12, g_tot.dftCompute));
    std::printf("  worst default-vs-RCM solution difference: %.3e (relative, max-norm)\n", g_tot.worstSolnDiff);
    if (g_tot.matrices > 0)
        check(g_tot.dftCompute < g_tot.rcmCompute,
              "G6 corpus: total default compute " + jnum(g_tot.dftCompute) + " s < total RCM compute " +
              jnum(g_tot.rcmCompute) + " s");
#ifdef SOG_HAVE_ACCELERATE
    if (g_tot.metisNnzL > 0) {
        const double r = g_tot.ndNnzL / g_tot.metisNnzL;
        std::printf("  total nnz(L) native ND / Accelerate METIS = %.4f\n", r);
        check(r <= 1.10, "G4 corpus: native ND nnz(L) <= 1.10 x Accelerate-METIS nnz(L) (ratio " + jnum(r) + ")");
    }
#endif
    jsonLine(std::string("{\"summary\":true,\"matrices\":") + std::to_string(g_tot.matrices) +
             ",\"nnzL_rcm\":" + jnum(g_tot.nnzL[1]) + ",\"nnzL_natural\":" + jnum(g_tot.nnzL[0]) +
             ",\"nnzL_amd\":" + jnum(g_tot.nnzL[2]) + ",\"nnzL_nd\":" + jnum(g_tot.nnzL[3]) +
             ",\"nnzL_default\":" + jnum(g_tot.nnzL[4]) + ",\"nnzL_accel_best\":" + jnum(g_tot.accBest) +
             ",\"compute_rcm_s\":" + jnum(g_tot.rcmCompute) + ",\"compute_default_s\":" + jnum(g_tot.dftCompute) +
             ",\"worst_dx\":" + jnum(g_tot.worstSolnDiff) + "}");
#endif
    std::printf("\nsparse_ordering_gate: %s (%d failure%s)\n", g_fail ? "FAIL" : "PASS",
                g_fail, g_fail == 1 ? "" : "s");
    return g_fail ? 1 : 0;
}
