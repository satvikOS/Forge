// forge/native/tolstack/Tolstack.cpp
//
// Implementation of forge::native::tolstack — the worst-case / RSS / Monte-Carlo
// tolerance-stack solver with critical-path ranking and the RSS-validity verdict.
// Pure C++20, standard library only. See Tolstack.hpp for the full scope note.

#include "forge/native/tolstack/Tolstack.hpp"

#include <cmath>
#include <algorithm>
#include <numeric>
#include <random>
#include <vector>
#include <limits>
#include <functional>
#include <cstddef>

namespace forge {
namespace native {
namespace tolstack {

// ---------------------------------------------------------------------------
// Normal CDF.
// ---------------------------------------------------------------------------
double normalCdf(double x) {
    // Φ(x) = ½·erfc(−x/√2). Exact in standard-library precision.
    return 0.5 * std::erfc(-x / std::sqrt(2.0));
}

double normalCdf(double x, double mean, double sigma) {
    if (sigma <= 0.0) {
        // Degenerate: a unit step at the mean (P(X<=x) is 0/1, ½ at the mean).
        if (x < mean) return 0.0;
        if (x > mean) return 1.0;
        return 0.5;
    }
    return normalCdf((x - mean) / sigma);
}

// ---------------------------------------------------------------------------
// GD&T-grown effective tolerance band.
//
// The mmcBonus (Y14.5 §7.3.3) is a DIAMETRAL position bonus; for a 1D FoS
// contributor it widens the available tolerance band symmetrically (the feature
// may sit anywhere in the enlarged zone), so we add the full bonus to BOTH the
// plus and minus tol of a feature-of-size contributor at MMC/LMC departure.
// ---------------------------------------------------------------------------
double effectivePlusTol(const Contributor& c) {
    double bonus = 0.0;
    if (c.isFeatureOfSize) {
        bonus = gdt::mmcBonus(c.actualSize, c.materialLimit, c.mc, c.ft);
    }
    return c.plusTol + bonus;
}

double effectiveMinusTol(const Contributor& c) {
    double bonus = 0.0;
    if (c.isFeatureOfSize) {
        bonus = gdt::mmcBonus(c.actualSize, c.materialLimit, c.mc, c.ft);
    }
    return c.minusTol + bonus;
}

// ---------------------------------------------------------------------------
// Per-contributor mean and sigma (AFTER GD&T growth + overrides).
//
//   mean  = nominal + (effPlus - effMinus)/2     (or meanOverride).
//   sigma : sigmaOverride if >0, else from the distribution & half-band a:
//             NORMAL     : a/k          (k-sigma design convention, e.g. ±t→t/3)
//             UNIFORM    : a/√3
//             TRIANGULAR : a/√6
//           with a = (effPlus + effMinus)/2  (symmetric half-width of the band).
// ---------------------------------------------------------------------------
double contributorMean(const Contributor& c, double /*k*/) {
    if (c.useMeanOverride) return c.meanOverride;
    return c.nominal + (effectivePlusTol(c) - effectiveMinusTol(c)) * 0.5;
}

double contributorSigma(const Contributor& c, double k) {
    if (c.sigmaOverride > 0.0) return c.sigmaOverride;
    const double a = (effectivePlusTol(c) + effectiveMinusTol(c)) * 0.5;
    const double kk = (k > 0.0) ? k : 3.0;
    switch (c.dist) {
        case DistType::NORMAL:     return a / kk;
        case DistType::UNIFORM:    return a / std::sqrt(3.0);
        case DistType::TRIANGULAR: return a / std::sqrt(6.0);
    }
    return a / kk;
}

// ---------------------------------------------------------------------------
// WORST-CASE.
//   wcNominal = Σ sᵢ·nominalᵢ
//   wcMax     = wcNominal + Σ |sᵢ|·effPlusᵢ
//   wcMin     = wcNominal − Σ |sᵢ|·effMinusᵢ
//   wcTol     = Σ |sᵢ|·max(effPlusᵢ, effMinusᵢ)   (the conservative band)
// ---------------------------------------------------------------------------
StackResult solveWorstCase(const StackSpec& spec) {
    StackResult r;
    double nominal = 0.0, plus = 0.0, minus = 0.0, tol = 0.0;
    for (const auto& c : spec.contributors) {
        const double s = std::fabs(c.sensitivity);
        const double ep = effectivePlusTol(c);
        const double em = effectiveMinusTol(c);
        nominal += c.sensitivity * c.nominal;
        plus    += s * ep;
        minus   += s * em;
        tol     += s * std::max(ep, em);
    }
    r.wcNominal = nominal;
    r.wcMax = nominal + plus;
    r.wcMin = nominal - minus;
    r.wcTol = tol;
    return r;
}

// ---------------------------------------------------------------------------
// RSS (statistical, linearized normal-sum).
//   rssMean  = Σ sᵢ·meanᵢ
//   rssSigma = √(Σ (sᵢ·σᵢ)²)
//   limits   = rssMean ∓ k·rssSigma
//   yield    = Φ(USL; mean,σ) − Φ(LSL; mean,σ)
//   Cp       = (USL−LSL)/(6σ),  Cpk = min(USL−mean, mean−LSL)/(3σ)
// ---------------------------------------------------------------------------
StackResult solveRSS(const StackSpec& spec) {
    StackResult r;
    double mean = 0.0, varSum = 0.0;
    for (const auto& c : spec.contributors) {
        const double m  = contributorMean(c, spec.k);
        const double sg = contributorSigma(c, spec.k);
        const double sc = c.sensitivity * sg;       // contribution to gap sigma
        mean   += c.sensitivity * m;
        varSum += sc * sc;
    }
    const double sigma = std::sqrt(varSum);
    const double k = (spec.k > 0.0) ? spec.k : 3.0;
    r.rssMean = mean;
    r.rssSigma = sigma;
    r.rssMin = mean - k * sigma;
    r.rssMax = mean + k * sigma;
    r.rssYield = normalCdf(spec.USL, mean, sigma) -
                 normalCdf(spec.LSL, mean, sigma);
    if (sigma > 0.0) {
        r.cp  = (spec.USL - spec.LSL) / (6.0 * sigma);
        r.cpk = std::min(spec.USL - mean, mean - spec.LSL) / (3.0 * sigma);
    } else {
        // Zero-variation stack: infinitely capable if the nominal is in-spec.
        const bool inSpec = (mean >= spec.LSL && mean <= spec.USL);
        r.cp  = inSpec ? std::numeric_limits<double>::infinity() : 0.0;
        r.cpk = inSpec ? std::numeric_limits<double>::infinity() : 0.0;
    }
    return r;
}

// ---------------------------------------------------------------------------
// MONTE-CARLO (deterministic-seeded).
//
// Per sample, draw each contributor's dimension from its distribution about its
// mean (NORMAL via normal_distribution; UNIFORM over [mean−a, mean+a]; symmetric
// TRIANGULAR via mean + a·(u1+u2−1), the sum-of-two-uniforms construction). The
// gap is spec.transfer(dims) when supplied (the TRUTH for a mechanism), else the
// linear sum Σ sᵢ·dimᵢ. Mean/sigma via Welford; yield by in-spec count; p01/p99
// via nth_element. Reproducible for a fixed mcSeed.
// ---------------------------------------------------------------------------
StackResult solveMonteCarlo(const StackSpec& spec) {
    StackResult r;
    const std::size_t n = spec.contributors.size();
    const int N = std::max(1, spec.mcSamples);

    // Per-contributor mean + half-width a (for uniform/triangular draws).
    std::vector<double> mean(n), sigma(n), halfA(n);
    for (std::size_t i = 0; i < n; ++i) {
        const auto& c = spec.contributors[i];
        mean[i]  = contributorMean(c, spec.k);
        sigma[i] = contributorSigma(c, spec.k);
        halfA[i] = (effectivePlusTol(c) + effectiveMinusTol(c)) * 0.5;
    }

    std::mt19937_64 rng(spec.mcSeed);
    std::normal_distribution<double> gauss(0.0, 1.0);
    std::uniform_real_distribution<double> uni(0.0, 1.0);

    std::vector<double> gaps;
    gaps.reserve(static_cast<std::size_t>(N));
    std::vector<double> dims(n);

    long long inSpec = 0;
    double runMean = 0.0, m2 = 0.0;   // Welford

    for (int s = 0; s < N; ++s) {
        for (std::size_t i = 0; i < n; ++i) {
            const auto& c = spec.contributors[i];
            double x;
            switch (c.dist) {
                case DistType::NORMAL:
                    x = mean[i] + sigma[i] * gauss(rng);
                    break;
                case DistType::UNIFORM: {
                    const double u = uni(rng);            // [0,1)
                    x = mean[i] + (2.0 * u - 1.0) * halfA[i];
                    break;
                }
                case DistType::TRIANGULAR: {
                    const double u1 = uni(rng);
                    const double u2 = uni(rng);
                    // sum of two U(0,1) is symmetric triangular on (0,2);
                    // (u1+u2-1) is symmetric triangular on (-1,1).
                    x = mean[i] + halfA[i] * (u1 + u2 - 1.0);
                    break;
                }
                default:
                    x = mean[i];
                    break;
            }
            dims[i] = x;
        }

        double gap;
        if (spec.transfer) {
            gap = spec.transfer(dims);          // non-linear truth
        } else {
            gap = 0.0;
            for (std::size_t i = 0; i < n; ++i)
                gap += spec.contributors[i].sensitivity * dims[i];
        }

        gaps.push_back(gap);
        if (gap >= spec.LSL && gap <= spec.USL) ++inSpec;

        // Welford online mean/variance.
        const double delta = gap - runMean;
        runMean += delta / static_cast<double>(s + 1);
        m2 += delta * (gap - runMean);
    }

    r.mcMean = runMean;
    r.mcSigma = (N > 1) ? std::sqrt(m2 / static_cast<double>(N - 1)) : 0.0;
    r.mcYield = static_cast<double>(inSpec) / static_cast<double>(N);

    // Percentiles via nth_element (partial sort — O(N), no full sort).
    if (!gaps.empty()) {
        std::size_t i01 = static_cast<std::size_t>(0.01 * N);
        std::size_t i99 = static_cast<std::size_t>(0.99 * N);
        if (i99 >= gaps.size()) i99 = gaps.size() - 1;
        std::nth_element(gaps.begin(), gaps.begin() + i01, gaps.end());
        r.mcP01 = gaps[i01];
        std::nth_element(gaps.begin(), gaps.begin() + i99, gaps.end());
        r.mcP99 = gaps[i99];
    }
    return r;
}

// ---------------------------------------------------------------------------
// CRITICAL-PATH contributors: variance share (sᵢσᵢ)² / Σ(sσ)², sorted desc.
// Returns the top-N rows. Also returns, via out-params, the dominant non-normal
// share + whether it crosses the dominance threshold (for the RSS verdict).
// ---------------------------------------------------------------------------
static std::vector<ContributorShare> criticalPath(
        const StackSpec& spec, int topN,
        double& outMaxNonNormalShare) {
    const std::size_t n = spec.contributors.size();
    std::vector<ContributorShare> rows;
    rows.reserve(n);
    double total = 0.0;
    std::vector<double> vshare(n, 0.0), sigc(n, 0.0);
    for (std::size_t i = 0; i < n; ++i) {
        const auto& c = spec.contributors[i];
        const double sc = c.sensitivity * contributorSigma(c, spec.k);
        const double v = sc * sc;
        vshare[i] = v;
        sigc[i] = std::fabs(sc);
        total += v;
    }
    outMaxNonNormalShare = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const auto& c = spec.contributors[i];
        ContributorShare row;
        row.name = c.name;
        row.varianceShare = (total > 0.0) ? vshare[i] / total : 0.0;
        row.sigmaContribution = sigc[i];
        if (c.dist != DistType::NORMAL && row.varianceShare > outMaxNonNormalShare)
            outMaxNonNormalShare = row.varianceShare;
        rows.push_back(row);
    }
    std::sort(rows.begin(), rows.end(),
              [](const ContributorShare& a, const ContributorShare& b) {
                  return a.varianceShare > b.varianceShare;
              });
    if (topN > 0 && rows.size() > static_cast<std::size_t>(topN))
        rows.resize(static_cast<std::size_t>(topN));
    return rows;
}

// ---------------------------------------------------------------------------
// analyzeStack — runs all three methods, fills critical-path + the verdict.
// ---------------------------------------------------------------------------
StackResult analyzeStack(const StackSpec& spec) {
    StackResult wc = solveWorstCase(spec);
    StackResult rss = solveRSS(spec);
    StackResult mc = solveMonteCarlo(spec);

    StackResult r;
    // worst-case
    r.wcNominal = wc.wcNominal; r.wcMin = wc.wcMin;
    r.wcMax = wc.wcMax;         r.wcTol = wc.wcTol;
    // RSS
    r.rssMean = rss.rssMean; r.rssSigma = rss.rssSigma;
    r.rssMin = rss.rssMin;   r.rssMax = rss.rssMax;
    r.rssYield = rss.rssYield; r.cp = rss.cp; r.cpk = rss.cpk;
    // MC
    r.mcMean = mc.mcMean; r.mcSigma = mc.mcSigma; r.mcYield = mc.mcYield;
    r.mcP01 = mc.mcP01;   r.mcP99 = mc.mcP99;

    // critical-path + dominant non-normal share.
    double maxNonNormalShare = 0.0;
    r.contributors = criticalPath(spec, spec.topN, maxNonNormalShare);

    // ---- RSS-VALIDITY VERDICT (any one breaks RSS) -------------------------
    r.rssValid = true;
    r.rssWarning = "";
    // (a) non-linear transfer (mechanism): linearized RSS underpredicts spread.
    if (std::fabs(spec.maxSecondDeriv) > spec.nonlinThresh) {
        r.rssValid = false;
        r.rssWarning =
            "non-linear transfer: linearized RSS underpredicts spread";
    }
    // (b) a dominant non-normal contributor breaks the normal-sum assumption.
    else if (maxNonNormalShare > spec.dominanceThresh) {
        r.rssValid = false;
        r.rssWarning =
            "dominant non-normal contributor breaks the normal-sum assumption";
    }
    // (c) too few contributors for the central-limit theorem.
    else if (spec.contributors.size() <
             static_cast<std::size_t>(spec.cltMinContributors)) {
        r.rssValid = false;
        r.rssWarning =
            "too few contributors for the central-limit theorem";
    }
    // (d) MC and RSS yields diverge — trust MC.
    else if (std::fabs(mc.mcYield - rss.rssYield) > spec.rssDivergeThresh) {
        r.rssValid = false;
        r.rssWarning =
            "MC and RSS yields diverge; trust MC";
    }

    r.authoritativeMc = !r.rssValid;
    return r;
}

} // namespace tolstack
} // namespace native
} // namespace forge
