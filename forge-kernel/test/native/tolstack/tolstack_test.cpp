// forge/native/tolstack/tolstack_test.cpp
//
// Standalone validation gate for forge::native::tolstack — the worst-case / RSS
// / Monte-Carlo tolerance-stack solver. Per Forge Engineering Bible §0/§9 the
// math is REAL (analytic WC/RSS + a seeded MC truth), so it is checked against
// independent inline reference computations + a few exact hand-computable anchors.
//
// HONESTY NOTE (matching gdt's convention): RSS is a LINEARIZATION — exact only
// for a linear sum of normals. For mechanisms / non-normal-dominant / thin-CLT
// stacks the engine declares rssValid=false and reports Monte-Carlo as the truth.
// These tests prove BOTH the valid-RSS agreement AND every invalidation path.
// No stub, no hidden fallback.
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/tolstack/Tolstack.cpp \
//       forge-kernel/src/native/gdt/Gdt.cpp \
//       forge-kernel/test/native/tolstack/tolstack_test.cpp \
//       -o /tmp/tolstack_test && /tmp/tolstack_test

#include "forge/native/tolstack/Tolstack.hpp"
#include "forge/native/gdt/Gdt.hpp"

#include <cstdio>
#include <cmath>
#include <random>
#include <vector>
#include <limits>
#include <algorithm>
#include <numeric>
#include <functional>
#include <string>

using namespace forge::native::tolstack;
namespace gdt = forge::native::gdt;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}

static bool approx(double a, double b, double tol = 1e-7) {
    return std::fabs(a - b) <= tol * (1.0 + std::fabs(a) + std::fabs(b));
}

// Independent reference normal CDF (Φ via erfc) — NOT the library under test's
// own normalCdf, so the test's reference is genuinely independent in structure.
static double refPhi(double x, double mean, double sigma) {
    return 0.5 * std::erfc(-((x - mean) / sigma) / std::sqrt(2.0));
}

// ===========================================================================
int main() {
    std::printf("== forge::native::tolstack validation gate ==\n");

    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    unsigned seed = rd();
    std::mt19937_64 rng(seed);
    std::printf("seed = %u\n", seed);

    // -----------------------------------------------------------------------
    // (0) normalCdf identities (randomized).
    // -----------------------------------------------------------------------
    {
        check(approx(normalCdf(0.0), 0.5), "(0) Φ(0)=0.5");
        check(normalCdf(40.0) > 1.0 - 1e-12, "(0) Φ(+big)→1");
        check(normalCdf(-40.0) < 1e-12, "(0) Φ(-big)→0");
        std::uniform_real_distribution<double> Ux(-5.0, 5.0);
        double prev = normalCdf(-6.0);
        bool mono = true;
        for (int i = 0; i < 5000; ++i) {
            double x = Ux(rng);
            check(approx(normalCdf(x) + normalCdf(-x), 1.0, 1e-9),
                  "(0) Φ(x)+Φ(-x)=1");
        }
        for (double x = -6.0; x <= 6.0; x += 0.01) {
            double cur = normalCdf(x);
            if (cur < prev - 1e-12) { mono = false; break; }
            prev = cur;
        }
        check(mono, "(0) Φ monotone non-decreasing");
        // mean/sigma overload re-centers.
        check(approx(normalCdf(5.0, 5.0, 1.3), 0.5), "(0) Φ(mean;mean,σ)=0.5");
        // degenerate sigma -> step.
        check(normalCdf(5.1, 5.0, 0.0) == 1.0 && normalCdf(4.9, 5.0, 0.0) == 0.0,
              "(0) σ=0 is a step at the mean");
    }

    // -----------------------------------------------------------------------
    // (1) FIXED ANCHOR — linear 3-stack, symmetric normal. gap = A+B−C.
    //     Nominals 10/20/25 (sens +1,+1,−1) ⇒ wcNominal=5; each ±0.10, k=3.
    // -----------------------------------------------------------------------
    {
        StackSpec spec;
        spec.k = 3.0;
        spec.LSL = 4.8; spec.USL = 5.2;
        spec.mcSamples = 200000;
        spec.mcSeed = 0xABCDEF01u;
        spec.topN = 3;
        spec.cltMinContributors = 3;   // this anchor is a clean 3-block normal sum
        auto mk = [](const char* nm, double nom, double s) {
            Contributor c; c.name = nm; c.nominal = nom;
            c.plusTol = 0.10; c.minusTol = 0.10; c.sensitivity = s;
            c.dist = DistType::NORMAL; return c;
        };
        spec.contributors = { mk("A", 10, +1), mk("B", 20, +1), mk("C", 25, -1) };

        StackResult r = analyzeStack(spec);

        // WORST-CASE: nominal 10+20-25 = 5; tol Σ|s|·0.10 = 0.30.
        check(approx(r.wcNominal, 5.0), "(1) wcNominal = 5");
        check(approx(r.wcTol, 0.30), "(1) wcTol = 0.30");
        check(approx(r.wcMin, 4.7), "(1) wcMin = 4.7");
        check(approx(r.wcMax, 5.3), "(1) wcMax = 5.3");

        // RSS: each sigma = 0.10/3; rssSigma = sqrt(3·(0.10/3)^2).
        double sig1 = 0.10 / 3.0;
        double rssSig = std::sqrt(3.0 * sig1 * sig1);
        check(approx(r.rssMean, 5.0), "(1) rssMean = 5");
        check(approx(r.rssSigma, rssSig, 1e-12), "(1) rssSigma = sqrt(Σ(s·σ)^2)");

        // RSS yield against an INDEPENDENT inline erfc reference.
        double refYield = refPhi(5.2, 5.0, rssSig) - refPhi(4.8, 5.0, rssSig);
        check(approx(r.rssYield, refYield, 1e-9), "(1) rssYield = Φ(USL)-Φ(LSL)");
        // ~0.99947 sanity.
        check(r.rssYield > 0.999 && r.rssYield < 1.0, "(1) rssYield ≈ 0.99947");

        // Cp = (0.4)/(6·σ); centered ⇒ Cpk == Cp.
        double refCp = (0.4) / (6.0 * rssSig);
        check(approx(r.cp, refCp), "(1) Cp = (USL-LSL)/(6σ)");
        check(approx(r.cpk, refCp), "(1) Cpk == Cp (centered)");
        check(approx(r.cp, 1.1547, 1e-3), "(1) Cp ≈ 1.1547");

        // MC ≈ RSS within ~0.003 at N=200k, and RSS is valid here.
        check(std::fabs(r.mcYield - r.rssYield) < 0.003, "(1) mcYield ≈ rssYield");
        check(approx(r.mcMean, 5.0, 5e-3), "(1) mcMean ≈ 5");
        check(approx(r.mcSigma, rssSig, 5e-2), "(1) mcSigma ≈ rssSigma");
        check(r.rssValid, "(1) rssValid == true (linear all-normal)");
        check(!r.authoritativeMc, "(1) MC not authoritative when RSS valid");

        // critical-path: 3 equal contributors ⇒ each share ≈ 1/3.
        check(r.contributors.size() == 3, "(1) top-3 critical contributors");
        for (auto& cs : r.contributors)
            check(approx(cs.varianceShare, 1.0 / 3.0, 1e-9),
                  "(1) equal variance share 1/3");
    }

    // -----------------------------------------------------------------------
    // (1b) FIXED ANCHOR — 4-block 1D stack with distinct tols.
    //      Asserts WC tol = Σ|s|·tol EXACTLY and RSS σ = sqrt(Σ(s·σ)^2) to 1e-9,
    //      and MC yield within 1% of the analytic normal yield.
    // -----------------------------------------------------------------------
    {
        StackSpec spec;
        spec.k = 3.0;
        spec.mcSamples = 300000;
        spec.mcSeed = 0x13572468u;
        struct B { const char* n; double nom, tol, s; };
        B blocks[4] = {
            {"P", 12.0, 0.05, +1.0},
            {"Q", 8.0,  0.08, +1.0},
            {"R", 5.0,  0.03, -1.0},
            {"S", 3.0,  0.06, +1.0},
        };
        double wcTolRef = 0.0, nomRef = 0.0, varRef = 0.0;
        for (auto& b : blocks) {
            Contributor c; c.name = b.n; c.nominal = b.nom;
            c.plusTol = b.tol; c.minusTol = b.tol; c.sensitivity = b.s;
            c.dist = DistType::NORMAL;
            spec.contributors.push_back(c);
            wcTolRef += std::fabs(b.s) * b.tol;
            nomRef += b.s * b.nom;
            double sg = b.tol / 3.0;
            varRef += (b.s * sg) * (b.s * sg);
        }
        double rssSigRef = std::sqrt(varRef);
        // spec window: ±4σ around nominal so yield is high but < 1.
        spec.LSL = nomRef - 4.0 * rssSigRef;
        spec.USL = nomRef + 4.0 * rssSigRef;

        StackResult r = analyzeStack(spec);
        check(approx(r.wcTol, wcTolRef, 1e-12), "(1b) WC tol = Σ|s|·tol exact");
        check(approx(r.wcNominal, nomRef, 1e-12), "(1b) wcNominal exact");
        check(approx(r.rssSigma, rssSigRef, 1e-9), "(1b) RSS σ = sqrt(Σ(s·σ)^2) to 1e-9");
        double analyticYield = refPhi(spec.USL, nomRef, rssSigRef) -
                               refPhi(spec.LSL, nomRef, rssSigRef);
        check(std::fabs(r.mcYield - analyticYield) < 0.01,
              "(1b) MC yield within 1% of analytic normal yield");
        check(r.rssValid, "(1b) rssValid (4 linear normals)");
    }

    // -----------------------------------------------------------------------
    // (2) MMC FEATURE-OF-SIZE — the bonus GROWS the contributor's tol.
    //     HOLE@MMC: actualSize-materialLimit = 0.05 ⇒ effPlusTol = plusTol+0.05.
    // -----------------------------------------------------------------------
    {
        Contributor c;
        c.name = "hole"; c.nominal = 10.0;
        c.plusTol = 0.10; c.minusTol = 0.10; c.sensitivity = 1.0;
        c.dist = DistType::NORMAL;
        c.isFeatureOfSize = true;
        c.materialLimit = 8.00; c.actualSize = 8.05;   // departure 0.05
        c.mc = gdt::MaterialCondition::MMC; c.ft = gdt::FeatureType::HOLE;

        double bonus = gdt::mmcBonus(c.actualSize, c.materialLimit, c.mc, c.ft);
        check(approx(bonus, 0.05), "(2) mmcBonus == 0.05");
        check(approx(effectivePlusTol(c), c.plusTol + 0.05),
              "(2) effPlusTol = plusTol + mmcBonus");
        check(approx(effectiveMinusTol(c), c.minusTol + 0.05),
              "(2) effMinusTol = minusTol + mmcBonus");

        // The grown band widens wcTol vs the same feature at RFS (no bonus).
        StackSpec mmcSpec; mmcSpec.contributors = { c };
        Contributor cR = c; cR.mc = gdt::MaterialCondition::RFS;
        StackSpec rfsSpec; rfsSpec.contributors = { cR };
        StackResult mmcR = solveWorstCase(mmcSpec);
        StackResult rfsR = solveWorstCase(rfsSpec);
        check(approx(rfsR.wcTol, 0.10), "(2) RFS wcTol = base 0.10");
        check(approx(mmcR.wcTol, 0.15), "(2) MMC wcTol = 0.10 + bonus 0.05");
        check(mmcR.wcTol > rfsR.wcTol, "(2) MMC bonus widens worst-case tol");

        // It also grows the derived sigma (band/k).
        check(approx(contributorSigma(c, 3.0), 0.15 / 3.0),
              "(2) MMC-grown sigma = (effPlus+effMinus)/2 / k");
        check(approx(contributorSigma(cR, 3.0), 0.10 / 3.0),
              "(2) RFS sigma = base/ k");
    }

    // -----------------------------------------------------------------------
    // (3) NON-LINEAR MECHANISM — sine-bar: gap = L·sin(θ). Strongly non-linear.
    //     rssValid MUST fire (reason a); MC is authoritative; MC spread differs
    //     from the linearized RSS (which would use ∂gap/∂θ = L·cos θ0).
    // -----------------------------------------------------------------------
    {
        const double L = 50.0;
        const double theta0 = 1.0;            // rad, ~57°; sin curvature large
        const double thetaSigma = 0.05;       // rad

        StackSpec spec;
        spec.k = 3.0;
        spec.mcSamples = 300000;
        spec.mcSeed = 0x0F0F0F0Fu;
        spec.cltMinContributors = 1;          // don't trip the CLT rule here
        // single θ contributor; local linear gain = L·cos θ0 is its sensitivity.
        Contributor th;
        th.name = "theta"; th.nominal = theta0;
        th.useMeanOverride = true; th.meanOverride = theta0;
        th.sigmaOverride = thetaSigma;        // direct sigma
        th.sensitivity = L * std::cos(theta0);// linearized gain about θ0
        th.dist = DistType::NORMAL;
        spec.contributors = { th };

        // Non-linear transfer = the REAL mechanism. dims[0] is θ.
        spec.transfer = [L](const std::vector<double>& dims) {
            return L * std::sin(dims[0]);
        };
        // mark the stack non-linear: |∂²/∂θ²| = L·|sin θ0|.
        spec.maxSecondDeriv = L * std::fabs(std::sin(theta0));

        // Spec window around the nominal gap L·sin θ0.
        double gap0 = L * std::sin(theta0);
        spec.LSL = gap0 - 1.0;
        spec.USL = gap0 + 1.0;

        StackResult r = analyzeStack(spec);

        check(!r.rssValid, "(3) rssValid == false for the mechanism");
        check(std::string(r.rssWarning).find("non-linear") != std::string::npos,
              "(3) warning names the non-linearity");
        check(r.authoritativeMc, "(3) MC is authoritative");

        // The linearized RSS sigma is L·cos θ0 · thetaSigma about gap0.
        double linSigma = std::fabs(L * std::cos(theta0)) * thetaSigma;
        // The TRUE (MC) sigma of L·sin θ differs (sin is concave here ⇒ the mean
        // shifts down and the spread is asymmetric). Assert a real divergence.
        check(std::fabs(r.mcSigma - linSigma) > 1e-3,
              "(3) MC spread differs from linearized RSS spread");
        // The MC mean also shifts off the linear gap0 (Jensen: E[sin θ] < sin θ0).
        check(r.mcMean < gap0 - 1e-4, "(3) Jensen: MC mean below the linear point");
        // MC yield is the reported truth — finite, in (0,1).
        check(r.mcYield > 0.0 && r.mcYield < 1.0, "(3) MC yield is a real truth");
    }

    // -----------------------------------------------------------------------
    // (4) LINEAR ALL-NORMAL STACK ⇒ rssValid == true (the valid regime).
    //     (Distinct from (1): different sizes/window, broader chain.)
    // -----------------------------------------------------------------------
    {
        StackSpec spec;
        spec.k = 3.0;
        spec.mcSamples = 200000;
        spec.mcSeed = 0x55AA55AAu;
        auto mk = [](const char* nm, double nom, double tol, double s) {
            Contributor c; c.name = nm; c.nominal = nom;
            c.plusTol = tol; c.minusTol = tol; c.sensitivity = s;
            c.dist = DistType::NORMAL; return c;
        };
        spec.contributors = {
            mk("a", 30, 0.05, +1), mk("b", 15, 0.04, +1),
            mk("c", 20, 0.03, -1), mk("d", 10, 0.06, -1),
            mk("e", 5,  0.02, +1),
        };
        double nom = 30 + 15 - 20 - 10 + 5;
        double var = 0;
        for (double t : {0.05, 0.04, 0.03, 0.06, 0.02}) {
            double sg = t / 3.0; var += sg * sg;
        }
        double sig = std::sqrt(var);
        spec.LSL = nom - 3.5 * sig; spec.USL = nom + 3.5 * sig;

        StackResult r = analyzeStack(spec);
        check(r.rssValid, "(4) rssValid == true for a linear all-normal stack");
        check(!r.authoritativeMc, "(4) MC not authoritative");
        check(std::fabs(r.mcYield - r.rssYield) < 0.01, "(4) MC and RSS agree");
    }

    // -----------------------------------------------------------------------
    // (5) DOMINANT-UNIFORM (reason b) — a non-normal contributor with ~huge
    //     variance share invalidates RSS even though the transfer is linear.
    // -----------------------------------------------------------------------
    {
        StackSpec spec;
        spec.k = 3.0;
        spec.mcSamples = 200000;
        spec.mcSeed = 0x9E3779B9u;
        spec.cltMinContributors = 1;          // isolate reason (b)
        spec.dominanceThresh = 0.50;
        // big uniform + tiny normal ⇒ uniform dominates variance.
        Contributor u; u.name = "bigU"; u.nominal = 50.0;
        u.plusTol = 0.50; u.minusTol = 0.50; u.sensitivity = 1.0;
        u.dist = DistType::UNIFORM;
        Contributor g; g.name = "tinyN"; g.nominal = 10.0;
        g.plusTol = 0.02; g.minusTol = 0.02; g.sensitivity = 1.0;
        g.dist = DistType::NORMAL;
        spec.contributors = { u, g };
        spec.LSL = 60.0 - 2.0; spec.USL = 60.0 + 2.0;

        StackResult r = analyzeStack(spec);
        // dominant contributor is the uniform & is non-normal.
        check(r.contributors.front().varianceShare > 0.9,
              "(5) uniform holds >90% variance share");
        check(!r.rssValid, "(5) rssValid == false (dominant non-normal)");
        check(std::string(r.rssWarning).find("non-normal") != std::string::npos,
              "(5) warning names the non-normal dominance");
        check(r.authoritativeMc, "(5) MC authoritative for the uniform-dominant stack");
    }

    // -----------------------------------------------------------------------
    // (6) THIN-CLT (reason c) — fewer than cltMinContributors, all normal,
    //     linear ⇒ still flagged (too thin for the CLT).
    // -----------------------------------------------------------------------
    {
        StackSpec spec;
        spec.k = 3.0;
        spec.cltMinContributors = 4;
        Contributor a; a.name = "x"; a.nominal = 10; a.plusTol = a.minusTol = 0.1;
        a.sensitivity = 1; a.dist = DistType::NORMAL;
        Contributor b = a; b.name = "y"; b.nominal = 6;
        spec.contributors = { a, b };       // only 2 < 4
        spec.LSL = 15.5; spec.USL = 16.5;
        StackResult r = analyzeStack(spec);
        check(!r.rssValid, "(6) rssValid == false (thin CLT, 2 < 4)");
        check(std::string(r.rssWarning).find("central-limit") != std::string::npos,
              "(6) warning names the CLT");
    }

    // -----------------------------------------------------------------------
    // (7) MC DETERMINISM — same seed ⇒ byte-identical; different seed ⇒ close
    //     but not identical.
    // -----------------------------------------------------------------------
    {
        StackSpec spec;
        spec.k = 3.0; spec.mcSamples = 100000; spec.mcSeed = 0xDEADBEEFu;
        auto mk = [](double nom, double tol, double s, DistType d) {
            Contributor c; c.nominal = nom; c.plusTol = tol; c.minusTol = tol;
            c.sensitivity = s; c.dist = d; return c;
        };
        spec.contributors = {
            mk(10, 0.05, +1, DistType::NORMAL),
            mk(8,  0.04, -1, DistType::TRIANGULAR),
            mk(6,  0.06, +1, DistType::UNIFORM),
        };
        spec.LSL = 7.5; spec.USL = 8.5;

        StackResult r1 = solveMonteCarlo(spec);
        StackResult r2 = solveMonteCarlo(spec);
        check(r1.mcYield == r2.mcYield && r1.mcP01 == r2.mcP01 &&
              r1.mcP99 == r2.mcP99 && r1.mcMean == r2.mcMean,
              "(7) same seed ⇒ byte-identical MC (mcYield/mcP01/mcP99/mcMean)");

        StackSpec spec2 = spec; spec2.mcSeed = 0xFEEDFACEu;
        StackResult r3 = solveMonteCarlo(spec2);
        check(r3.mcYield != r1.mcYield || r3.mcMean != r1.mcMean,
              "(7) different seed ⇒ not byte-identical");
        check(std::fabs(r3.mcYield - r1.mcYield) < 0.02,
              "(7) different seed ⇒ statistically close");
        // p01 <= mean <= p99 ordering sanity.
        check(r1.mcP01 <= r1.mcMean && r1.mcMean <= r1.mcP99,
              "(7) p01 <= mean <= p99");
    }

    // -----------------------------------------------------------------------
    // (8) RANDOMIZED CROSS-CHECK — many random LINEAR NORMAL stacks (RSS valid
    //     by construction): |mcYield−rssYield| < ~0.01, rssValid==true, and the
    //     worst-case ALWAYS brackets the MC percentile range.
    // -----------------------------------------------------------------------
    {
        std::uniform_real_distribution<double> Unom(-20.0, 20.0);
        std::uniform_real_distribution<double> Utol(0.02, 0.20);
        int trials = 0, agreed = 0;
        for (int t = 0; t < 120; ++t) {
            StackSpec spec;
            spec.k = 3.0; spec.mcSamples = 80000;
            spec.mcSeed = static_cast<unsigned>(rng());
            int n = 4 + static_cast<int>(rng() % 5);   // 4..8 contributors (CLT ok)
            double nom = 0.0, var = 0.0;
            for (int i = 0; i < n; ++i) {
                Contributor c;
                c.nominal = Unom(rng);
                double tol = Utol(rng);
                c.plusTol = tol; c.minusTol = tol;
                c.sensitivity = (rng() & 1) ? +1.0 : -1.0;
                c.dist = DistType::NORMAL;
                spec.contributors.push_back(c);
                nom += c.sensitivity * c.nominal;
                double sg = tol / 3.0;
                var += sg * sg;
            }
            double sig = std::sqrt(var);
            // Window at a random width so yields span a real range.
            std::uniform_real_distribution<double> Uw(1.5, 4.0);
            double w = Uw(rng);
            spec.LSL = nom - w * sig; spec.USL = nom + w * sig;

            StackResult r = analyzeStack(spec);
            ++trials;
            check(r.rssValid, "(8) random linear-normal stack ⇒ rssValid");
            if (std::fabs(r.mcYield - r.rssYield) < 0.01) ++agreed;
            // Worst-case brackets the MC range (samples can't exceed the limit
            // stack); allow a hair of slack for the 1st/99th percentile vs the
            // absolute extremes.
            check(r.wcMin <= r.mcP01 + 1e-9, "(8) wcMin <= mc 1st pct");
            check(r.wcMax >= r.mcP99 - 1e-9, "(8) wcMax >= mc 99th pct");
        }
        std::printf("(8) randomized: %d/%d linear-normal stacks agreed (<0.01)\n",
                    agreed, trials);
        check(agreed >= trials - 3, "(8) nearly all random stacks: MC≈RSS");
    }

    // -----------------------------------------------------------------------
    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
