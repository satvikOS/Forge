#include "forge/Tolerance.hpp"

#include <algorithm>
#include <cmath>
#include <random>
#include <stdexcept>

namespace forge { namespace tolerance {

namespace {

// Per-dimension μ and σ for a given distribution.
// For all three distributions we treat the asymmetric ±tolerances by
// shifting μ by (tolPlus − tolMinus) / 2 and using a symmetric half-width
// w = (tolPlus + tolMinus) / 2.
void meanSigma(const Dimension& d, double& mu, double& sigma) {
    const double half = 0.5 * (d.tolPlus + d.tolMinus);
    const double shift = 0.5 * (d.tolPlus - d.tolMinus);
    mu = d.nominal + shift;
    switch (d.dist) {
      case Distribution::Normal:     sigma = half / 3.0; break;
      case Distribution::Uniform:    sigma = half / std::sqrt(3.0); break;
      case Distribution::Triangular: sigma = half / std::sqrt(6.0); break;
    }
}

double sampleDim(const Dimension& d, std::mt19937_64& rng) {
    const double half = 0.5 * (d.tolPlus + d.tolMinus);
    const double shift = 0.5 * (d.tolPlus - d.tolMinus);
    const double centre = d.nominal + shift;
    switch (d.dist) {
      case Distribution::Normal: {
        std::normal_distribution<double> nd(centre, half / 3.0);
        return nd(rng);
      }
      case Distribution::Uniform: {
        std::uniform_real_distribution<double> ud(centre - half, centre + half);
        return ud(rng);
      }
      case Distribution::Triangular: {
        // Symmetric triangular around `centre` with half-width `half`.
        std::uniform_real_distribution<double> u(0.0, 1.0);
        const double a = u(rng);
        if (a < 0.5) return centre - half + std::sqrt(2.0 * a) * half;
        return centre + half - std::sqrt(2.0 * (1.0 - a)) * half;
      }
    }
    return centre;
}

} // anonymous namespace

StackResult compute(const StackInputs& in) {
    if (in.chain.empty()) {
        throw std::invalid_argument("forge.tolerance: chain must have ≥ 1 dimension");
    }
    if (in.mcSamples < 100) {
        throw std::invalid_argument("forge.tolerance: mcSamples must be ≥ 100");
    }
    if (!(in.USL > in.LSL)) {
        throw std::invalid_argument("forge.tolerance: USL must exceed LSL");
    }

    StackResult R{};

    // ----------------------- worst-case
    R.worstCaseNominal = 0;
    double sumTolPlus = 0, sumTolMinus = 0;
    for (const auto& d : in.chain) {
        R.worstCaseNominal += d.nominal;
        sumTolPlus  += d.tolPlus;
        sumTolMinus += d.tolMinus;
    }
    R.worstCaseHigh = R.worstCaseNominal + sumTolPlus;
    R.worstCaseLow  = R.worstCaseNominal - sumTolMinus;

    // ----------------------- RSS
    double sumMu = 0, sumVar = 0;
    for (const auto& d : in.chain) {
        double mu, sigma;
        meanSigma(d, mu, sigma);
        sumMu  += mu;
        sumVar += sigma * sigma;
    }
    R.rssMu    = sumMu;
    R.rssSigma = std::sqrt(sumVar);
    if (R.rssSigma > 1e-12) {
        R.rssCp  = (in.USL - in.LSL) / (6.0 * R.rssSigma);
        R.rssCpk = std::min((in.USL - R.rssMu) / (3.0 * R.rssSigma),
                            (R.rssMu - in.LSL) / (3.0 * R.rssSigma));
    } else {
        R.rssCp = R.rssCpk = 1e6;
    }

    // ----------------------- Monte-Carlo
    std::mt19937_64 rng(in.randomSeed);
    std::vector<double> samples(in.mcSamples);
    for (int s = 0; s < in.mcSamples; ++s) {
        double total = 0;
        for (const auto& d : in.chain) total += sampleDim(d, rng);
        samples[s] = total;
    }
    double mcSum = 0;
    for (double v : samples) mcSum += v;
    R.mcMu = mcSum / in.mcSamples;
    double mcVar = 0;
    for (double v : samples) {
        const double diff = v - R.mcMu;
        mcVar += diff * diff;
    }
    R.mcSigma = std::sqrt(mcVar / std::max(1, in.mcSamples - 1));
    std::sort(samples.begin(), samples.end());
    auto percentile = [&](double p) {
        const std::size_t idx = static_cast<std::size_t>(
            std::clamp(p * (samples.size() - 1), 0.0, (double)(samples.size() - 1)));
        return samples[idx];
    };
    R.mcP05 = percentile(0.05);
    R.mcP50 = percentile(0.50);
    R.mcP95 = percentile(0.95);
    if (R.mcSigma > 1e-12) {
        R.mcCp  = (in.USL - in.LSL) / (6.0 * R.mcSigma);
        R.mcCpk = std::min((in.USL - R.mcMu) / (3.0 * R.mcSigma),
                           (R.mcMu - in.LSL) / (3.0 * R.mcSigma));
    } else {
        R.mcCp = R.mcCpk = 1e6;
    }
    int hit = 0;
    for (double v : samples) if (v >= in.LSL && v <= in.USL) ++hit;
    R.mcYieldPct = 100.0 * hit / in.mcSamples;
    return R;
}

}} // namespace forge::tolerance
