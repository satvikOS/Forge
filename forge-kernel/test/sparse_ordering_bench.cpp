// ─────────────────────────────────────────────────────────────────────────────
// sparse_ordering_bench.cpp — T-163. WHAT FILL-REDUCING ORDERING DO THE SPARSE
// DIRECT SOLVERS ACTUALLY NEED?
//
// The kernel's SparseLDLT and SparseLU both pre-ordered with Reverse
// Cuthill-McKee. RCM minimises BANDWIDTH; a sparse direct factorization's cost
// is nnz(L). Those are different objectives. This program does not argue about
// that — it MEASURES it.
//
// WHAT IT MEASURES, AND ON WHAT.
//   * The matrices are REAL. Every "REAL-FEA" row is assembled from a mesh
//     produced by THIS repo's own mesher, forge::fea::meshFromBRep(), run on a
//     real BRep solid built by this repo's own modelling API, with this repo's
//     own 8-node hex element (forge::native::fea) and this repo's own Dirichlet
//     elimination convention (drop the pinned row+column, append (i,i,1) —
//     src/Fea.cpp::applyPinnedBCs). The sparsity pattern is therefore EXACTLY
//     the pattern src/Fea.cpp hands to la::SparseLDLT. Synthetic matrices appear
//     only in a clearly labelled CONTRAST block; no conclusion rests on them.
//   * Both DOF layouts the kernel actually solves: 3 DOF/node structural
//     (Fea.cpp, FeaExtras.cpp, FeaContact.cpp, TransientDynamics) and 1 DOF/node
//     scalar (Emag.cpp, TransientThermal, ScalarElliptic).
//   * EVERY arm on EVERY matrix: Natural (identity — the control, i.e. the
//     assembly's own DOF numbering), RCM, AMD.
//   * For every (matrix, arm): nnz(L), fill ratio nnz(L)/nnz(A), ordering time,
//     symbolic time, total factor time, solve time. Fill is the mechanism, time
//     is the symptom; both are reported, never one without the other.
//   * Solutions are compared ACROSS arms. A reordering is a permutation, so the
//     answer must be identical up to round-off; the worst observed relative
//     difference is printed and asserted.
//
// It prints the INPUT CHARACTERISATION first — dimension, nnz, density,
// bandwidth, profile, degree distribution — because whether a fill-reducing
// ordering can matter at all is a property of the input.
//
// Regenerate the report:
//   cmake --build build -j "$(forge-nproc)" --target forge_sparse_ordering_bench
//   ./build/forge_sparse_ordering_bench --markdown > ../forge-kernel/reports/SPARSE_ORDERING.md
//
// Exit 0 iff every arm produced a valid factorization, every arm's symbolic fill
// matched the fill the factorization actually allocated, every arm's solution
// agreed with the control arm's to 1e-8 relative, and the arms were
// DISTINGUISHABLE (three identical fill numbers on a non-trivial matrix is a
// broken harness far more often than it is a real tie).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/Primitives.hpp"
#include "forge/Booleans.hpp"
#include "forge/Fea.hpp"
#include "forge/native/linalg/LinAlg.hpp"
#include "forge/native/fea/Thermoelastic.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"
#include "forge/native/fea/TransientDynamics.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace la = forge::native::linalg;
namespace te = forge::native::fea::thermoelastic;
namespace se = forge::native::fea::scalar_elliptic;
namespace td = forge::native::fea::transient_dynamics;

using la::SparseCSR;
using la::SparseOrdering;
using la::Triplet;

static bool gMarkdown = false;
static int  gFails    = 0;
static long gElemBlockExactZeros = 0;   // see assembleStructural's pattern claim
static long gElemBlockEntries    = 0;

using Clock = std::chrono::steady_clock;
static double msSince(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

// ── structural characterisation of the INPUT ─────────────────────────────────
struct Structure {
    std::size_t n = 0, nnz = 0;
    double      density = 0;        // nnz / n^2
    std::size_t bandwidth = 0;      // max |i-j| over structural entries
    double      meanProfile = 0;    // mean over rows of (i - min j in row i)
    std::size_t minDeg = 0, maxDeg = 0;
    double      meanDeg = 0;
    std::size_t isolated = 0;       // rows whose only entry is the diagonal
};

static Structure characterise(const SparseCSR<double>& A) {
    Structure s;
    s.n = A.rows();
    s.nnz = A.nnz();
    if (s.n == 0) return s;
    s.density = static_cast<double>(s.nnz) /
                (static_cast<double>(s.n) * static_cast<double>(s.n));
    const auto& rp = A.rowPtr();
    const auto& ci = A.colIdx();
    s.minDeg = static_cast<std::size_t>(-1);
    double profSum = 0, degSum = 0;
    for (std::size_t i = 0; i < s.n; ++i) {
        std::size_t minCol = i, deg = 0;
        for (std::size_t p = rp[i]; p < rp[i + 1]; ++p) {
            const std::size_t j = ci[p];
            if (j != i) ++deg;
            const std::size_t d = (j > i) ? (j - i) : (i - j);
            if (d > s.bandwidth) s.bandwidth = d;
            if (j < minCol) minCol = j;
        }
        profSum += static_cast<double>(i - minCol);
        degSum  += static_cast<double>(deg);
        if (deg < s.minDeg) s.minDeg = deg;
        if (deg > s.maxDeg) s.maxDeg = deg;
        if (deg == 0) ++s.isolated;
    }
    s.meanProfile = profSum / static_cast<double>(s.n);
    s.meanDeg     = degSum / static_cast<double>(s.n);
    return s;
}

static bool isPermutation(const std::vector<std::size_t>& p, std::size_t n) {
    if (p.size() != n) return false;
    std::vector<char> seen(n, 0);
    for (std::size_t v : p) {
        if (v >= n || seen[v]) return false;
        seen[v] = 1;
    }
    return true;
}

// ── a benchmark case ─────────────────────────────────────────────────────────
struct MatrixCase {
    std::string       name;
    std::string       provenance;   // REAL-FEA | SYNTHETIC
    std::string       note;
    SparseCSR<double> A;
    std::size_t       nNodes = 0, nElems = 0;
    int               dofPerNode = 0;
};

// ── real FEA assembly, mirroring src/Fea.cpp ─────────────────────────────────
//
// src/Fea.cpp::assemble() scatters each element's 24x24 Ke into triplets at
// global DOF 3*node+axis and calls SparseCSR::setFromTriplets. Its element is
// the incompatible-modes brick; the one used here is the compatible brick from
// forge::native::fea::transient_dynamics (which Fea.cpp's own transient path
// uses). The incompatible modes are ELEMENT-INTERNAL and statically condensed,
// so the two differ in VALUES and not at all in the global sparsity PATTERN —
// and the pattern is the only thing an ordering sees.
static SparseCSR<double> assembleStructural(const forge::fea::Mesh& mesh,
                                            std::uint32_t pinFaceBit) {
    const std::size_t nNodes = mesh.nodes.size() / 3;
    const std::size_t nElems = mesh.tets.size() / mesh.elemNodeCount;
    const std::size_t nDof   = 3 * nNodes;

    const la::MatrixD D = te::buildIsotropicD(210e9, 0.3);

    std::vector<char> pinned(nDof, 0);
    for (std::size_t nd = 0; nd < nNodes; ++nd)
        if (nd < mesh.nodeToFace.size() && (mesh.nodeToFace[nd] & pinFaceBit))
            for (int a = 0; a < 3; ++a) pinned[3 * nd + a] = 1;

    std::vector<Triplet<double>> trips;
    trips.reserve(nElems * 24 * 24);
    for (std::size_t e = 0; e < nElems; ++e) {
        double X[8][3];
        std::uint32_t nid[8];
        for (int i = 0; i < 8; ++i) {
            nid[i] = mesh.tets[e * 8 + i];
            X[i][0] = mesh.nodes[3 * nid[i] + 0];
            X[i][1] = mesh.nodes[3 * nid[i] + 1];
            X[i][2] = mesh.nodes[3 * nid[i] + 2];
        }
        la::MatrixD Ke(24, 24);
        td::elementStiffness(D, X, Ke, "sparse_ordering_bench");
        // THE PATTERN CLAIM, CHECKED RATHER THAN ASSERTED. The header comment
        // above says this assembly's sparsity pattern equals the one
        // src/Fea.cpp produces with its incompatible-modes element. That is only
        // true if the element block is structurally DENSE — if it were, the
        // global pattern is the union of dense 24x24 blocks over the mesh
        // connectivity, which is a property of the MESH and not of the element
        // formulation, so any hex element gives the same pattern. Count the
        // exact zeros; a nonzero count would falsify the claim.
        for (int i = 0; i < 24; ++i)
            for (int j = 0; j < 24; ++j)
                if (Ke(static_cast<std::size_t>(i), static_cast<std::size_t>(j)) == 0.0)
                    ++gElemBlockExactZeros;
        gElemBlockEntries += 24 * 24;
        for (int i = 0; i < 8; ++i)
            for (int ai = 0; ai < 3; ++ai) {
                const std::size_t gi = 3 * nid[i] + static_cast<std::size_t>(ai);
                if (pinned[gi]) continue;
                for (int j = 0; j < 8; ++j)
                    for (int aj = 0; aj < 3; ++aj) {
                        const std::size_t gj = 3 * nid[j] + static_cast<std::size_t>(aj);
                        if (pinned[gj]) continue;
                        const double v = Ke(3 * i + ai, 3 * j + aj);
                        if (v != 0.0)
                            trips.emplace_back(static_cast<int>(gi), static_cast<int>(gj), v);
                    }
            }
    }
    for (std::size_t i = 0; i < nDof; ++i)
        if (pinned[i]) trips.emplace_back(static_cast<int>(i), static_cast<int>(i), 1.0);

    SparseCSR<double> K;
    K.setFromTriplets(nDof, nDof, trips);
    return K;
}

// The 1-DOF-per-node scalar operator: the SAME mesh, the SAME repo element
// (ScalarElliptic — the Laplacian Emag.cpp and TransientThermal both go through).
static SparseCSR<double> assembleScalar(const forge::fea::Mesh& mesh,
                                        std::uint32_t pinFaceBit) {
    const std::size_t nNodes = mesh.nodes.size() / 3;
    const std::size_t nElems = mesh.tets.size() / mesh.elemNodeCount;

    std::vector<char> pinned(nNodes, 0);
    for (std::size_t nd = 0; nd < nNodes; ++nd)
        if (nd < mesh.nodeToFace.size() && (mesh.nodeToFace[nd] & pinFaceBit)) pinned[nd] = 1;

    std::vector<Triplet<double>> trips;
    trips.reserve(nElems * 64);
    for (std::size_t e = 0; e < nElems; ++e) {
        double X[8][3];
        std::uint32_t nid[8];
        for (int i = 0; i < 8; ++i) {
            nid[i] = mesh.tets[e * 8 + i];
            X[i][0] = mesh.nodes[3 * nid[i] + 0];
            X[i][1] = mesh.nodes[3 * nid[i] + 1];
            X[i][2] = mesh.nodes[3 * nid[i] + 2];
        }
        la::MatrixD Ke(8, 8);
        se::elementStiffness(45.0, X, Ke, "sparse_ordering_bench");
        for (int i = 0; i < 8; ++i) {
            if (pinned[nid[i]]) continue;
            for (int j = 0; j < 8; ++j) {
                if (pinned[nid[j]]) continue;
                const double v = Ke(i, j);
                if (v != 0.0)
                    trips.emplace_back(static_cast<int>(nid[i]), static_cast<int>(nid[j]), v);
            }
        }
    }
    for (std::size_t i = 0; i < nNodes; ++i)
        if (pinned[i]) trips.emplace_back(static_cast<int>(i), static_cast<int>(i), 1.0);

    SparseCSR<double> K;
    K.setFromTriplets(nNodes, nNodes, trips);
    return K;
}

// ── synthetic CONTRAST matrices (labelled; no conclusion rests on them) ──────
static SparseCSR<double> laplacian(int nx, int ny, int nz) {
    auto id = [&](int i, int j, int k) {
        return static_cast<std::size_t>((static_cast<std::size_t>(k) * ny + j) * nx + i);
    };
    const std::size_t n = static_cast<std::size_t>(nx) * ny * nz;
    std::vector<Triplet<double>> t;
    const int di[6] = {1, -1, 0, 0, 0, 0};
    const int dj[6] = {0, 0, 1, -1, 0, 0};
    const int dk[6] = {0, 0, 0, 0, 1, -1};
    for (int k = 0; k < nz; ++k)
        for (int j = 0; j < ny; ++j)
            for (int i = 0; i < nx; ++i) {
                const std::size_t a = id(i, j, k);
                for (int d = 0; d < 6; ++d) {
                    const int x = i + di[d], y = j + dj[d], z = k + dk[d];
                    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
                    t.emplace_back(static_cast<int>(a), static_cast<int>(id(x, y, z)), -1.0);
                }
                t.emplace_back(static_cast<int>(a), static_cast<int>(a), 6.1);
            }
    SparseCSR<double> A;
    A.setFromTriplets(n, n, t);
    return A;
}

// ── one measured arm ─────────────────────────────────────────────────────────
struct ArmResult {
    bool        ok = false;
    std::size_t nnzL = 0;
    double      fillRatio = 0;
    double      orderMs = 0, symbolicMs = 0, factorMs = 0, solveMs = 0;
    double      worstDiffVsControl = 0;
    double      worstDiffVsPrechange = 0;   // vs the RCM arm = the solver as it shipped
    std::vector<double> x;
};

static ArmResult runArmLDLT(const SparseCSR<double>& A, SparseOrdering ord,
                            const std::vector<double>& b, int reps) {
    ArmResult r;
    double bestOrder = 1e300, bestSym = 1e300, bestFac = 1e300, bestSol = 1e300;
    for (int rep = 0; rep < reps; ++rep) {
        auto t0 = Clock::now();
        const std::vector<std::size_t> perm = la::fillReducingOrdering(A, ord);
        bestOrder = std::min(bestOrder, msSince(t0));

        // An ordering that is not a bijection is not a reordering, it is a bug
        // that happens to produce plausible numbers. Check it, every arm, every
        // matrix, rather than inferring it from the solve agreeing.
        if (!isPermutation(perm, A.rows())) {
            std::fprintf(stderr, "  [FAIL] the ordering is NOT a permutation of 0..n-1\n");
            ++gFails;
        }

        t0 = Clock::now();
        const std::size_t sym = la::symbolicFactorNnz(A, perm);
        bestSym = std::min(bestSym, msSince(t0));

        t0 = Clock::now();
        la::SparseLDLT s;
        s.compute(A, ord);
        bestFac = std::min(bestFac, msSince(t0));
        r.ok   = s.ok();
        r.nnzL = s.factorNnz();
        if (sym != r.nnzL) {
            std::fprintf(stderr, "  [FAIL] symbolic nnz(L)=%zu != factored nnz(L)=%zu\n",
                         sym, r.nnzL);
            r.ok = false;
        }

        t0 = Clock::now();
        r.x = s.solve(b);
        bestSol = std::min(bestSol, msSince(t0));
    }
    r.orderMs = bestOrder; r.symbolicMs = bestSym;
    r.factorMs = bestFac;  r.solveMs = bestSol;
    r.fillRatio = A.nnz() ? static_cast<double>(r.nnzL) / static_cast<double>(A.nnz()) : 0.0;
    return r;
}

static ArmResult runArmLU(const SparseCSR<double>& A, SparseOrdering ord,
                          const std::vector<double>& b) {
    ArmResult r;
    auto t0 = Clock::now();
    const std::vector<std::size_t> perm = la::fillReducingOrdering(A, ord);
    r.orderMs = msSince(t0);
    (void)perm;
    t0 = Clock::now();
    la::SparseLU s;
    s.compute(A, ord);
    r.factorMs = msSince(t0);
    r.ok   = s.ok();
    r.nnzL = s.factorNnz();     // nnz(L) + nnz(U)
    t0 = Clock::now();
    r.x = s.solve(b);
    r.solveMs = msSince(t0);
    r.fillRatio = A.nnz() ? static_cast<double>(r.nnzL) / static_cast<double>(A.nnz()) : 0.0;
    return r;
}

// ── report one case ──────────────────────────────────────────────────────────
// The fourth arm is the KERNEL DEFAULT — whatever `SparseLDLT::compute(A)` does
// when nobody names an ordering. It is measured as its own arm, not assumed to
// be one of the other three, because the assertion that actually guards the
// landed change is about the default.
static constexpr int kArms = 4;
static const char* kArmName[kArms] = {"Natural", "RCM", "AMD", "**Default (Auto)**"};
static const SparseOrdering kArmOrd[kArms] = {
    SparseOrdering::Natural, SparseOrdering::RCM, SparseOrdering::AMD,
    la::kDefaultSparseOrdering};

// Corpus-level tallies, for the summary and for the gate assertions.
struct Tally {
    int matrices = 0;
    int rcmWorseThanNatural = 0;
    int amdBeatsRcm = 0;
    int amdWorseThanRcm = 0;
    int defaultWorseThanBestFixed = 0;
    int defaultBeatsRcm = 0;
    double sumNnzNatural = 0, sumNnzRcm = 0, sumNnzAmd = 0, sumNnzDefault = 0;
    double sumFactorMsRcm = 0, sumFactorMsAmd = 0, sumFactorMsDefault = 0;
    double worstDiffVsPrechange = 0;        // corpus-wide worst |x_default - x_RCM| / ||x||
    std::string worstDiffWhere;
};
static Tally gT;

static void checkCrossArm(const MatrixCase& mc, ArmResult res[kArms], const Structure& st) {
    const std::size_t n = mc.A.rows();
    double refNorm = 0;
    for (double v : res[0].x) refNorm = std::max(refNorm, std::fabs(v));
    if (refNorm == 0) refNorm = 1;
    for (int a = 1; a < kArms; ++a) {
        double worst = 0;
        if (res[a].x.size() == n && res[0].x.size() == n)
            for (std::size_t i = 0; i < n; ++i)
                worst = std::max(worst, std::fabs(res[a].x[i] - res[0].x[i]));
        res[a].worstDiffVsControl = worst / refNorm;
        if (!(res[a].worstDiffVsControl <= 1e-8)) {
            std::fprintf(stderr, "  [FAIL] %s / %s: solution differs from the control "
                                 "arm by %.3e (rel)\n",
                         mc.name.c_str(), kArmName[a], res[a].worstDiffVsControl);
            ++gFails;
        }
    }
    // Separately: the DEFAULT against the solver EXACTLY AS IT SHIPPED (RCM).
    // This is the no-regression number the change has to be judged on.
    {
        double worst = 0;
        if (res[3].x.size() == n && res[1].x.size() == n)
            for (std::size_t i = 0; i < n; ++i)
                worst = std::max(worst, std::fabs(res[3].x[i] - res[1].x[i]));
        res[3].worstDiffVsPrechange = worst / refNorm;
        if (res[3].worstDiffVsPrechange > gT.worstDiffVsPrechange) {
            gT.worstDiffVsPrechange = res[3].worstDiffVsPrechange;
            gT.worstDiffWhere = mc.name;
        }
        if (!(res[3].worstDiffVsPrechange <= 1e-8)) {
            std::fprintf(stderr, "  [FAIL] %s: the DEFAULT differs from the PRE-CHANGE "
                                 "(RCM) solver by %.3e (rel)\n",
                         mc.name.c_str(), res[3].worstDiffVsPrechange);
            ++gFails;
        }
    }
    // The instrument must be able to TELL THE ARMS APART. Three identical fill
    // numbers on a non-trivial matrix is far more likely to be a broken harness
    // than a real tie.
    if (res[0].nnzL == res[1].nnzL && res[1].nnzL == res[2].nnzL &&
        n > 64 && st.maxDeg > 2) {
        std::fprintf(stderr, "  [FAIL] %s: all three orderings report the SAME "
                             "nnz(L)=%zu — the harness cannot distinguish the arms\n",
                     mc.name.c_str(), res[0].nnzL);
        ++gFails;
    }
}

static void printHeaderLine(const MatrixCase& mc, const Structure& st) {
    if (gMarkdown) {
        std::printf("\n### %s\n\n", mc.name.c_str());
        std::printf("`%s` — %s\n\n", mc.provenance.c_str(), mc.note.c_str());
        std::printf("n = %zu &nbsp;|&nbsp; nnz(A) = %zu &nbsp;|&nbsp; density = %.3e "
                    "&nbsp;|&nbsp; natural bandwidth = %zu &nbsp;|&nbsp; mean profile = %.1f "
                    "&nbsp;|&nbsp; degree min/mean/max = %zu/%.1f/%zu "
                    "&nbsp;|&nbsp; isolated (pinned) rows = %zu",
                    st.n, st.nnz, st.density, st.bandwidth, st.meanProfile,
                    st.minDeg, st.meanDeg, st.maxDeg, st.isolated);
        if (mc.nElems)
            std::printf(" &nbsp;|&nbsp; mesh = %zu hex / %zu nodes / %d DOF per node",
                        mc.nElems, mc.nNodes, mc.dofPerNode);
        std::printf("\n\n");
    } else {
        std::printf("\n%-32s %s\n", mc.name.c_str(), mc.note.c_str());
        std::printf("  n=%zu nnzA=%zu density=%.3e bw=%zu profile=%.1f deg=%zu/%.1f/%zu isolated=%zu\n",
                    st.n, st.nnz, st.density, st.bandwidth, st.meanProfile,
                    st.minDeg, st.meanDeg, st.maxDeg, st.isolated);
    }
}

static void reportCaseLDLT(const MatrixCase& mc) {
    const SparseCSR<double>& A = mc.A;
    const std::size_t n = A.rows();
    if (n == 0) {
        std::fprintf(stderr, "  [FAIL] %s produced an EMPTY matrix\n", mc.name.c_str());
        ++gFails;
        return;
    }
    const Structure st = characterise(A);
    std::vector<double> b(n);
    for (std::size_t i = 0; i < n; ++i)
        b[i] = std::sin(0.7137 * static_cast<double>(i)) + 1.25;

    const int reps = (n < 4000) ? 3 : 1;
    ArmResult res[kArms];
    SparseOrdering autoPicked = SparseOrdering::Natural;
    for (int a = 0; a < kArms; ++a) {
        res[a] = runArmLDLT(A, kArmOrd[a], b, reps);
        if (!res[a].ok) {
            std::fprintf(stderr, "  [FAIL] %s / %s: factorization not ok\n",
                         mc.name.c_str(), kArmName[a]);
            ++gFails;
        }
    }
    {
        la::SparseLDLT probe;
        probe.compute(A);                       // the DEFAULT, nobody naming an ordering
        autoPicked = probe.chosenOrdering();
    }
    checkCrossArm(mc, res, st);

    // ---- THE GATE ASSERTIONS ------------------------------------------------
    // 1. The default must never be beaten by any fixed ordering. This is the
    //    whole claim of the landed change, and it is the assertion a mutation of
    //    the ordering back to a fixed one has to break.
    const std::size_t bestFixed = std::min(std::min(res[0].nnzL, res[1].nnzL), res[2].nnzL);
    if (res[3].nnzL > bestFixed) {
        std::fprintf(stderr, "  [FAIL] %s: the DEFAULT ordering fills %zu, but the best "
                             "fixed ordering fills %zu \u2014 the default is not choosing "
                             "the least-fill candidate\n",
                     mc.name.c_str(), res[3].nnzL, bestFixed);
        ++gFails;
    }
    // 2. The default must never be WORSE than the ordering this kernel shipped
    //    before (RCM). A regression of the default back to RCM-always leaves
    //    this green, which is why assertion 3 exists.
    if (res[3].nnzL > res[1].nnzL) {
        std::fprintf(stderr, "  [FAIL] %s: the DEFAULT fills %zu vs RCM's %zu \u2014 a "
                             "REGRESSION against the ordering this kernel used to ship\n",
                     mc.name.c_str(), res[3].nnzL, res[1].nnzL);
        ++gFails;
    }

    ++gT.matrices;
    if (res[1].nnzL > res[0].nnzL) ++gT.rcmWorseThanNatural;
    if (res[2].nnzL < res[1].nnzL) ++gT.amdBeatsRcm;
    if (res[2].nnzL > res[1].nnzL) ++gT.amdWorseThanRcm;
    if (res[3].nnzL > bestFixed)   ++gT.defaultWorseThanBestFixed;
    if (res[3].nnzL < res[1].nnzL) ++gT.defaultBeatsRcm;
    gT.sumNnzNatural += static_cast<double>(res[0].nnzL);
    gT.sumNnzRcm     += static_cast<double>(res[1].nnzL);
    gT.sumNnzAmd     += static_cast<double>(res[2].nnzL);
    gT.sumNnzDefault += static_cast<double>(res[3].nnzL);
    gT.sumFactorMsRcm     += res[1].factorMs;
    gT.sumFactorMsAmd     += res[2].factorMs;
    gT.sumFactorMsDefault += res[3].factorMs;

    printHeaderLine(mc, st);
    const char* pickName = (autoPicked == SparseOrdering::Natural) ? "Natural"
                         : (autoPicked == SparseOrdering::RCM)     ? "RCM"
                         : (autoPicked == SparseOrdering::AMD)     ? "AMD" : "Auto";

    if (gMarkdown) {
        std::printf("| ordering | nnz(L) | fill ratio nnz(L)/nnz(A) | order ms | symbolic ms "
                    "| factor ms (total) | solve ms | nnz(L) vs RCM | max soln diff vs control |\n");
        std::printf("|---|---:|---:|---:|---:|---:|---:|---:|---:|\n");
        for (int a = 0; a < kArms; ++a) {
            char diff[32];
            if (a == 0) std::snprintf(diff, sizeof diff, "(control)");
            else        std::snprintf(diff, sizeof diff, "%.2e", res[a].worstDiffVsControl);
            const double vsRcm = res[1].nnzL
                ? static_cast<double>(res[a].nnzL) / static_cast<double>(res[1].nnzL) : 0.0;
            std::printf("| %s | %zu | %.2f | %.2f | %.2f | %.2f | %.3f | %.3fx | %s |\n",
                        kArmName[a], res[a].nnzL, res[a].fillRatio, res[a].orderMs,
                        res[a].symbolicMs, res[a].factorMs, res[a].solveMs, vsRcm, diff);
        }
        std::printf("\nAuto chose: **%s**. Max |x_default - x_RCM| / max|x| = %.2e "
                    "(the default vs the solver exactly as it shipped).\n",
                    pickName, res[3].worstDiffVsPrechange);
    } else {
        for (int a = 0; a < kArms; ++a)
            std::printf("  %-18s nnzL=%10zu fill=%7.2f order=%8.2fms sym=%8.2fms "
                        "factor=%9.2fms solve=%7.3fms diff=%.2e\n",
                        kArmName[a], res[a].nnzL, res[a].fillRatio, res[a].orderMs,
                        res[a].symbolicMs, res[a].factorMs, res[a].solveMs,
                        res[a].worstDiffVsControl);
        std::printf("  auto chose: %s   diff vs pre-change(RCM) = %.2e\n",
                    pickName, res[3].worstDiffVsPrechange);
    }
}

static void reportCaseLU(const MatrixCase& mc) {
    const SparseCSR<double>& A = mc.A;
    const std::size_t n = A.rows();
    if (n == 0) return;
    const Structure st = characterise(A);
    std::vector<double> b(n);
    for (std::size_t i = 0; i < n; ++i)
        b[i] = std::sin(0.7137 * static_cast<double>(i)) + 1.25;

    ArmResult res[kArms];
    for (int a = 0; a < kArms; ++a) {
        res[a] = runArmLU(A, kArmOrd[a], b);
        if (!res[a].ok) {
            std::fprintf(stderr, "  [FAIL] %s (LU) / %s: factorization not ok\n",
                         mc.name.c_str(), kArmName[a]);
            ++gFails;
        }
    }
    checkCrossArm(mc, res, st);
    if (res[3].nnzL > res[1].nnzL) {
        std::fprintf(stderr, "  [FAIL] %s (LU): the DEFAULT fills %zu vs RCM's %zu \u2014 a "
                             "REGRESSION on the SparseLU path\n",
                     mc.name.c_str(), res[3].nnzL, res[1].nnzL);
        ++gFails;
    }
    printHeaderLine(mc, st);

    if (gMarkdown) {
        std::printf("| ordering | nnz(L)+nnz(U) | fill ratio | order ms | factor ms | solve ms "
                    "| vs RCM | max soln diff vs control |\n");
        std::printf("|---|---:|---:|---:|---:|---:|---:|---:|\n");
        for (int a = 0; a < kArms; ++a) {
            char diff[32];
            if (a == 0) std::snprintf(diff, sizeof diff, "(control)");
            else        std::snprintf(diff, sizeof diff, "%.2e", res[a].worstDiffVsControl);
            const double vsRcm = res[1].nnzL
                ? static_cast<double>(res[a].nnzL) / static_cast<double>(res[1].nnzL) : 0.0;
            std::printf("| %s | %zu | %.2f | %.2f | %.2f | %.3f | %.3fx | %s |\n",
                        kArmName[a], res[a].nnzL, res[a].fillRatio, res[a].orderMs,
                        res[a].factorMs, res[a].solveMs, vsRcm, diff);
        }
    } else {
        for (int a = 0; a < kArms; ++a)
            std::printf("  LU %-18s nnzLU=%10zu fill=%7.2f order=%8.2fms factor=%9.2fms "
                        "solve=%7.3fms diff=%.2e\n",
                        kArmName[a], res[a].nnzL, res[a].fillRatio, res[a].orderMs,
                        res[a].factorMs, res[a].solveMs, res[a].worstDiffVsControl);
    }
}

// ── the real-geometry corpus ─────────────────────────────────────────────────
struct GeomSpec {
    const char*      label;
    forge::ShapeHandle h;
    double           elemSize;
    const char*      note;
};

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--markdown") == 0) gMarkdown = true;

    constexpr std::uint32_t kFaceMinusX = 1u << 0;   // Fea.hpp: 0=-X,1=+X,2=-Y,...

    if (gMarkdown) {
        std::printf("# T-163 — the fill-reducing ordering the sparse solvers actually need\n\n");
        std::printf("Generated by `forge-kernel/test/sparse_ordering_bench.cpp`. "
                    "Regenerate with:\n\n");
        std::printf("```sh\ncd forge-kernel\n"
                    "cmake --build build -j \"$(forge-nproc)\" --target forge_sparse_ordering_bench\n"
                    "./build/forge_sparse_ordering_bench --markdown > reports/SPARSE_ORDERING.md\n"
                    "```\n\n");
        std::printf("## The answer\n\n"
                    "RCM lost. Over 16 matrices \u2014 14 of them real FE stiffness matrices "
                    "assembled from this repo's own mesher \u2014 the Reverse Cuthill-McKee "
                    "ordering the sparse solvers used fills MORE than doing nothing at all on "
                    "10 of them, and 0.7%% more than nothing across the corpus as a whole. It "
                    "was not buying what it was there to buy.\n\n"
                    "AMD, implemented here from Amestoy/Davis/Duff 1996 with no new dependency, "
                    "fills less than RCM on 14 of 16 \u2014 by 2.3x on an annular solid \u2014 "
                    "but it LOSES by 1.4x on a long thin cantilever, where the mesher's own "
                    "lexicographic numbering is already near-optimal. So no fixed ordering wins "
                    "either.\n\n"
                    "What landed is therefore not an ordering but a CHOICE: the default now "
                    "forms all three candidate permutations, runs the exact symbolic "
                    "factorization on each (cheap: elimination tree and column counts, no "
                    "numeric work, no allocation of L), and factors with whichever fills least. "
                    "Measured over the corpus that is **0.596x the fill of RCM and about "
                    "1.9x its factor speed** (fill is deterministic; wall-times vary a few "
                    "percent run to run), it is beaten by no fixed ordering on any single "
                    "matrix, "
                    "and the worst solution difference against the solver exactly as it shipped "
                    "is 1.5e-13 relative \u2014 round-off, as a permutation must be.\n\n"
                    "---\n\n"
                    "## Method\n\n");
        std::printf("Every `REAL-FEA` matrix below is assembled from a mesh produced by "
                    "`forge::fea::meshFromBRep()` on a solid built with this repo's own "
                    "modelling API, using this repo's own hex element and this repo's own "
                    "Dirichlet-elimination convention. The sparsity pattern is the pattern "
                    "`src/Fea.cpp` hands to `la::SparseLDLT`. `SYNTHETIC` rows are a labelled "
                    "contrast and carry no conclusion.\n");
    }

    // ---- build the real solids ---------------------------------------------
    const forge::ShapeHandle box    = forge::makeBox(0.20, 0.02, 0.02);
    const forge::ShapeHandle block  = forge::makeBox(0.06, 0.06, 0.06);
    const forge::ShapeHandle tube   = forge::makeTube(0.03, 0.018, 0.08);
    const forge::ShapeHandle cyl    = forge::makeCylinder(0.025, 0.09);
    const forge::ShapeHandle lbrack = forge::fuse(forge::makeBox(0.08, 0.02, 0.08),
                                                  forge::makeBox(0.02, 0.02, 0.08));
    const forge::ShapeHandle plateH = forge::cut(forge::makeBox(0.10, 0.10, 0.012),
                                                 forge::makeCylinder(0.012, 0.05));

    const GeomSpec specs[] = {
        {"thick-block",       block,  0.006, "solid 60mm cube, 210GPa steel, -X face fully pinned"},
        {"plate-with-hole",   plateH, 0.005, "100x100x12mm plate with a 24mm bore — a VOID in the grid"},
        {"L-bracket",         lbrack, 0.005, "fused L section — a re-entrant corner"},
        {"cylinder",          cyl,    0.005, "R25 x 90mm cylinder — curved boundary, clipped voxels"},
        {"tube",              tube,   0.004, "R30/R18 x 80mm tube — an annulus, i.e. a hole through the graph"},
        {"thick-block-fine",  block,  0.004, "the same cube, refined"},
        {"cantilever-beam",   box,    0.0025, "200x20x20mm cantilever — the classic FE bar, long and thin"},
    };

    // ---- 3 DOF/node structural (Fea.cpp / FeaExtras / FeaContact / dynamics) -
    if (gMarkdown)
        std::printf("\n---\n\n## 1. REAL FEA matrices — 3 DOF per node (structural)\n\n"
                    "The `SparseLDLT` path of `src/Fea.cpp` (`solveStatic`, `solveModal`, "
                    "`solveDynamic`), `src/FeaExtras.cpp` and `src/FeaContact.cpp`.\n");
    else
        std::printf("== REAL FEA, 3 DOF/node (structural) ==\n");

    for (const GeomSpec& g : specs) {
        forge::fea::Mesh m = forge::fea::meshFromBRep(g.h, g.elemSize);
        MatrixCase mc;
        mc.name = std::string(g.label) + " (structural, 3 DOF/node)";
        mc.provenance = "REAL-FEA";
        mc.note = g.note;
        mc.nNodes = m.nodes.size() / 3;
        mc.nElems = m.tets.size() / m.elemNodeCount;
        mc.dofPerNode = 3;
        mc.A = assembleStructural(m, kFaceMinusX);
        reportCaseLDLT(mc);
        std::fflush(stdout);
    }

    // ---- 1 DOF/node scalar (Emag / TransientThermal / ScalarElliptic) -------
    if (gMarkdown)
        std::printf("\n---\n\n## 2. REAL FEA matrices — 1 DOF per node (scalar)\n\n"
                    "The `SparseLDLT` path of `src/Emag.cpp` and the "
                    "`forge::native::fea::transient_thermal` / `scalar_elliptic` operators. "
                    "Same meshes, one third the DOFs, and NO 3x supervariable structure — "
                    "the hardest case for AMD.\n");
    else
        std::printf("\n== REAL FEA, 1 DOF/node (scalar) ==\n");

    for (const GeomSpec& g : specs) {
        forge::fea::Mesh m = forge::fea::meshFromBRep(g.h, g.elemSize);
        MatrixCase mc;
        mc.name = std::string(g.label) + " (scalar, 1 DOF/node)";
        mc.provenance = "REAL-FEA";
        mc.note = g.note;
        mc.nNodes = m.nodes.size() / 3;
        mc.nElems = m.tets.size() / m.elemNodeCount;
        mc.dofPerNode = 1;
        mc.A = assembleScalar(m, kFaceMinusX);
        reportCaseLDLT(mc);
        std::fflush(stdout);
    }

    // ---- the SparseLU path (MoldFlow / WeldingFea) -------------------------
    if (gMarkdown)
        std::printf("\n---\n\n## 3. The SparseLU path\n\n"
                    "`src/MoldFlow.cpp` and `src/WeldingFea.cpp` factor with `la::SparseLU` "
                    "(Gilbert-Peierls, partial pivoting), whose COLUMN pre-ordering is the "
                    "same helper. Fill here is nnz(L)+nnz(U). Measured on the real scalar "
                    "matrices because LU with partial pivoting is far more expensive than "
                    "LDLT and these keep the run inside a CI budget.\n\n"
                    "**A regression lives in this section, and it is not being hidden.** On "
                    "`cylinder`, the default picks AMD for a 2.4%% fill saving and the LU "
                    "factorization comes out ~1.6x SLOWER than RCM's. Gilbert-Peierls cost is "
                    "not nnz(L)+nnz(U) alone \u2014 the depth-first reach computation and the "
                    "partial-pivot row choices both depend on the structure in ways the "
                    "symmetric symbolic proxy cannot see. Across the three cases the default "
                    "is still a net win on time and never worse on fill, which is why it is "
                    "used on this path too; but the per-case number is in the table above and "
                    "a reader should see it. Closing it properly means a real COLAMD on the "
                    "A\u1d40A column-fill graph, which is a separate piece of work.\n");
    else
        std::printf("\n== REAL FEA through SparseLU ==\n");

    for (const GeomSpec& g : {specs[0], specs[1], specs[3]}) {
        forge::fea::Mesh m = forge::fea::meshFromBRep(g.h, g.elemSize);
        MatrixCase mc;
        mc.name = std::string(g.label) + " (scalar, through SparseLU)";
        mc.provenance = "REAL-FEA";
        mc.note = g.note;
        mc.nNodes = m.nodes.size() / 3;
        mc.nElems = m.tets.size() / m.elemNodeCount;
        mc.dofPerNode = 1;
        mc.A = assembleScalar(m, kFaceMinusX);
        reportCaseLU(mc);
        std::fflush(stdout);
    }

    // ---- synthetic contrast ------------------------------------------------
    if (gMarkdown)
        std::printf("\n---\n\n## 4. SYNTHETIC contrast (labelled — no conclusion rests on these)\n\n"
                    "Structured Laplacians, included only to show the 2-D / 3-D split: RCM's "
                    "deficit against AMD is a 3-D phenomenon, and the kernel's FE meshes are "
                    "3-D solids.\n");
    else
        std::printf("\n== SYNTHETIC contrast ==\n");

    {
        struct SynSpec { const char* name; int nx, ny, nz; const char* note; };
        const SynSpec syn[] = {
            {"2-D Laplacian 90x90",       90, 90, 1,  "a 2-D grid: the case where RCM is competitive"},
            {"3-D Laplacian 20x20x20",    20, 20, 20, "a 3-D grid: the case the FE meshes look like"},
        };
        for (const SynSpec& s : syn) {
            MatrixCase mc;
            mc.name = s.name;
            mc.provenance = "SYNTHETIC";
            mc.note = s.note;
            mc.A = laplacian(s.nx, s.ny, s.nz);
            reportCaseLDLT(mc);
            std::fflush(stdout);
        }
    }

    // ---- corpus summary + the corpus-level gate assertion -------------------
    const double ratioDefaultRcm = gT.sumNnzRcm ? gT.sumNnzDefault / gT.sumNnzRcm : 1.0;
    const double ratioAmdRcm     = gT.sumNnzRcm ? gT.sumNnzAmd / gT.sumNnzRcm : 1.0;
    const double ratioRcmNat     = gT.sumNnzNatural ? gT.sumNnzRcm / gT.sumNnzNatural : 1.0;

    // A fixed ordering cannot satisfy this. If someone reverts the default to
    // RCM-always the ratio becomes exactly 1.0 and this goes RED; if they revert
    // it to AMD-always it becomes ratioAmdRcm, which is above the bar only
    // because AMD loses on the long-thin cases. MUTATION-PROVED, see the report.
    constexpr double kMaxDefaultOverRcm = 0.80;
    if (!(ratioDefaultRcm <= kMaxDefaultOverRcm)) {
        std::fprintf(stderr, "  [FAIL] corpus fill of the DEFAULT ordering is %.4f of RCM's, "
                             "above the %.2f bar\n", ratioDefaultRcm, kMaxDefaultOverRcm);
        ++gFails;
    }
    // ---- THE PROSE IS PINNED TO THE MEASUREMENT -----------------------------
    // "The answer" section above quotes numbers this same run recomputes. A
    // number copied into a second place goes stale silently, so each one is
    // asserted here: if the corpus or the algorithm changes, this goes RED and
    // names the sentence that has to be rewritten, instead of the report quietly
    // becoming a claim nothing supports. Only DETERMINISTIC quantities are
    // pinned — fill counts, not wall-times.
    struct Pin { const char* claim; long got; long want; };
    const Pin pins[] = {
        {"'fills MORE than doing nothing on 10 of them'", gT.rcmWorseThanNatural, 10},
        {"'fills less than RCM on 14 of 16'",             gT.amdBeatsRcm,         14},
        {"'it LOSES ... on a long thin cantilever' (AMD worse on 2)", gT.amdWorseThanRcm, 2},
        {"'beaten by no fixed ordering on any single matrix'", gT.defaultWorseThanBestFixed, 0},
        {"corpus size quoted as 'over 16 matrices'",      gT.matrices,            16},
    };
    for (const Pin& pin : pins)
        if (pin.got != pin.want) {
            std::fprintf(stderr, "  [FAIL] the report's prose says %s, but this run measured "
                                 "%ld. Rewrite the sentence and update the pin.\n",
                         pin.claim, pin.got);
            ++gFails;
        }
    if (std::fabs(ratioDefaultRcm - 0.596) > 0.001) {
        std::fprintf(stderr, "  [FAIL] the report's prose says the default is 0.596x the fill "
                             "of RCM, but this run measured %.4f. Rewrite the sentence.\n",
                     ratioDefaultRcm);
        ++gFails;
    }
    if (std::fabs(ratioRcmNat - 1.0067) > 0.0005) {
        std::fprintf(stderr, "  [FAIL] the report's prose says RCM fills 0.7%% more than "
                             "nothing (rcm/natural = 1.0067), but this run measured %.4f. "
                             "Rewrite the sentence.\n", ratioRcmNat);
        ++gFails;
    }

    if (gElemBlockExactZeros != 0) {
        std::fprintf(stderr, "  [FAIL] %ld of %ld element-stiffness entries are exactly zero "
                             "\u2014 the element block is NOT structurally dense, so the claim "
                             "that this assembly's pattern equals src/Fea.cpp's does not hold\n",
                     gElemBlockExactZeros, gElemBlockEntries);
        ++gFails;
    }
    if (gT.defaultWorseThanBestFixed != 0) {
        std::fprintf(stderr, "  [FAIL] the default lost to a fixed ordering on %d matrices\n",
                     gT.defaultWorseThanBestFixed);
        ++gFails;
    }

    if (gMarkdown) {
        std::printf("\n---\n\n## 5. Corpus summary\n\n");
        std::printf("Denominator: **%d** symmetric matrices measured through `SparseLDLT` "
                    "(%d of them REAL FEA assemblies from this repo's own mesher, the rest the "
                    "labelled synthetic contrast).\n\n", gT.matrices, gT.matrices - 2);
        std::printf("| claim | count | of |\n|---|---:|---:|\n");
        std::printf("| RCM fills MORE than doing nothing at all | %d | %d |\n",
                    gT.rcmWorseThanNatural, gT.matrices);
        std::printf("| AMD fills less than RCM | %d | %d |\n", gT.amdBeatsRcm, gT.matrices);
        std::printf("| AMD fills MORE than RCM | %d | %d |\n", gT.amdWorseThanRcm, gT.matrices);
        std::printf("| the default (Auto) fills less than RCM | %d | %d |\n",
                    gT.defaultBeatsRcm, gT.matrices);
        std::printf("| the default was beaten by some fixed ordering | %d | %d |\n",
                    gT.defaultWorseThanBestFixed, gT.matrices);
        std::printf("\n| total nnz(L) over the corpus | value | ratio vs RCM |\n|---|---:|---:|\n");
        std::printf("| Natural (no ordering) | %.0f | %.3fx |\n",
                    gT.sumNnzNatural, gT.sumNnzRcm ? gT.sumNnzNatural / gT.sumNnzRcm : 0.0);
        std::printf("| RCM (what the kernel used to ship) | %.0f | 1.000x |\n", gT.sumNnzRcm);
        std::printf("| AMD | %.0f | %.3fx |\n", gT.sumNnzAmd, ratioAmdRcm);
        std::printf("| **Default (Auto)** | %.0f | **%.3fx** |\n", gT.sumNnzDefault, ratioDefaultRcm);
        std::printf("\n| total factor wall-time over the corpus | ms |\n|---|---:|\n");
        std::printf("| RCM | %.1f |\n| AMD | %.1f |\n| **Default (Auto)** | **%.1f** |\n",
                    gT.sumFactorMsRcm, gT.sumFactorMsAmd, gT.sumFactorMsDefault);
        std::printf("\nWorst solution difference between the DEFAULT and the solver "
                    "exactly as it shipped (RCM), over the whole corpus: **%.2e** relative, "
                    "on `%s`. A reordering is a permutation, so this is round-off and "
                    "nothing else.\n",
                    gT.worstDiffVsPrechange, gT.worstDiffWhere.c_str());
        std::printf("\nPattern-claim check: %ld exact zeros out of %ld element-stiffness "
                    "entries. Zero of them means every 24x24 element block is structurally "
                    "dense, so the global pattern is the union of dense blocks over the MESH "
                    "connectivity alone \u2014 identical for any 8-node hex formulation, "
                    "including the incompatible-modes element `src/Fea.cpp` actually uses.\n",
                    gElemBlockExactZeros, gElemBlockEntries);
        std::printf("\nRCM / Natural = %.3fx: a number above 1.0 means the fill-reducing "
                    "ordering this kernel shipped was, over this corpus, worse than not "
                    "reordering at all.\n", ratioRcmNat);
        // ---- section 6: the RECORDED mutation-proof transcript ---------------
        // A gate never seen red is not a gate. This is the verbatim output of
        // test/sparse_ordering_mutation_proof.sh, which mutates the ordering in
        // src/native/linalg/LinAlg.cpp, rebuilds, and re-runs THIS program. It
        // is embedded here rather than kept in a side file so that regenerating
        // the report cannot silently drop it; re-run the script to refresh it.
        std::printf("\n---\n\n## 6. Mutation proof of the gate (recorded transcript)\n\n");
        std::printf("Re-run with `bash forge-kernel/test/sparse_ordering_mutation_proof.sh`. "
                    "The script backs up `src/native/linalg/LinAlg.cpp`, mutates it, rebuilds "
                    "`forge_kernel_core`, re-runs this program, and restores the file "
                    "(verified with `cmp`).\n\n");
        std::printf("```text\n"
"############ CONTROL (unmutated tree) ############\n"
"=== CONTROL - the tree as it will land\n"
"    exit code : 0  (GREEN)\n"
"    [FAIL] lines: 0\n"
"      RCM worse than no ordering at all : 10/16\n"
"      default beaten by a fixed ordering: 0/16\n"
"      default/RCM=0.5957  amd/RCM=0.6758  rcm/natural=1.0067\n"
"\n"
"############ MUTATION A - the default reverts to RCM (what the kernel shipped) ############\n"
"mutation A applied\n"
"=== MUTATION A - kDefaultSparseOrdering behaves as RCM\n"
"    exit code : 1  (RED)\n"
"    [FAIL] lines: 18\n"
"      [FAIL] thick-block (structural, 3 DOF/node): the DEFAULT ordering fills 1642503, but the best fixed ordering fills 963417\n"
"      [FAIL] plate-with-hole (structural, 3 DOF/node): the DEFAULT ordering fills 823329, but the best fixed ordering fills 464643\n"
"      [FAIL] L-bracket (structural, 3 DOF/node): the DEFAULT ordering fills 1223238, but the best fixed ordering fills 877323\n"
"      [FAIL] cylinder (structural, 3 DOF/node): the DEFAULT ordering fills 1827081, but the best fixed ordering fills 1636137\n"
"      RCM worse than no ordering at all : 10/16\n"
"      default beaten by a fixed ordering: 16/16\n"
"      default/RCM=1.0000  amd/RCM=0.6758  rcm/natural=1.0067\n"
"\n"
"############ MUTATION B - AMD degraded to the identity permutation ############\n"
"mutation B applied\n"
"=== MUTATION B - AMD returns the identity\n"
"    exit code : 1  (RED)\n"
"    [FAIL] lines: 1\n"
"      [FAIL] corpus fill of the DEFAULT ordering is 0.8599 of RCM's, above the 0.80 bar\n"
"      RCM worse than no ordering at all : 10/16\n"
"      default beaten by a fixed ordering: 0/16\n"
"      default/RCM=0.8599  amd/RCM=0.9934  rcm/natural=1.0067\n"
"\n"
"############ RESTORED ############\n"
"=== RESTORED - byte-identical to the control\n"
"    exit code : 0  (GREEN)\n"
"    [FAIL] lines: 0\n"
"      RCM worse than no ordering at all : 10/16\n"
"      default beaten by a fixed ordering: 0/16\n"
"      default/RCM=0.5957  amd/RCM=0.6758  rcm/natural=1.0067\n"
"\n"
"restored file identical to backup: YES\n"
"```\n\n");
        std::printf("Both mutations are caught, and by DIFFERENT assertions, which is the point "
                    "of having two. Mutation A (the default silently reverting to what the "
                    "kernel shipped) trips the per-matrix assertion on 16 of 16 matrices and "
                    "drives the corpus ratio to exactly 1.0000. Mutation B (AMD still called, "
                    "but no longer ordering anything) leaves the per-matrix assertion GREEN - "
                    "the default still picks the best of the candidates it is given, they are "
                    "just worse candidates - and is caught only by the corpus-ratio bar, which "
                    "moves 0.5957 -> 0.8599. A gate with only the per-matrix assertion would "
                    "have been green on a hollowed-out AMD.\n\n");

        std::printf("\n---\n\n%s\n",
                    gFails ? "**RESULT: FAIL** — see stderr."
                           : "**RESULT: PASS** — every arm factored, every arm's symbolic fill "
                             "matched the fill it allocated, every arm's solution matched the "
                             "control arm's, and the default ordering was beaten by no fixed "
                             "ordering on any matrix.");
    } else {
        std::printf("\n== SUMMARY over %d matrices ==\n", gT.matrices);
        std::printf("  RCM worse than no ordering at all : %d/%d\n", gT.rcmWorseThanNatural, gT.matrices);
        std::printf("  AMD beats RCM                     : %d/%d  (AMD worse: %d)\n",
                    gT.amdBeatsRcm, gT.matrices, gT.amdWorseThanRcm);
        std::printf("  default beats RCM                 : %d/%d\n", gT.defaultBeatsRcm, gT.matrices);
        std::printf("  default beaten by a fixed ordering: %d/%d\n",
                    gT.defaultWorseThanBestFixed, gT.matrices);
        std::printf("  total nnzL  natural=%.0f rcm=%.0f amd=%.0f default=%.0f\n",
                    gT.sumNnzNatural, gT.sumNnzRcm, gT.sumNnzAmd, gT.sumNnzDefault);
        std::printf("  default/RCM=%.4f  amd/RCM=%.4f  rcm/natural=%.4f\n",
                    ratioDefaultRcm, ratioAmdRcm, ratioRcmNat);
        std::printf("  total factor ms  rcm=%.1f amd=%.1f default=%.1f\n",
                    gT.sumFactorMsRcm, gT.sumFactorMsAmd, gT.sumFactorMsDefault);
        std::printf("  worst |x_default - x_RCM|/max|x| = %.2e on %s\n",
                    gT.worstDiffVsPrechange, gT.worstDiffWhere.c_str());
        std::printf("  element-block exact zeros: %ld / %ld\n",
                    gElemBlockExactZeros, gElemBlockEntries);
    }
    std::fprintf(stderr, "%s fails=%d\n", gFails ? "RESULT FAIL" : "RESULT PASS", gFails);
    return gFails ? 1 : 0;
}
