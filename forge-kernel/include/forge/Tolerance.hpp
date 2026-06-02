#pragma once

// Forge-185 — Tolerance stack-up analysis.
//
// 1-D linear stack of dimensions, each with a nominal + bilateral tolerance.
// Computes:
//   * Worst-case stack: assembly = Σ nominal_i, range = Σ |tol_i|.
//   * RSS (statistical): assumes each tolerance covers ±3σ_i; assembly σ =
//     √Σ σ_i².
//   * Monte-Carlo: sample each input from its distribution (normal /
//     uniform / triangular), accumulate; report μ, σ, percentiles, Cp, Cpk.
//
// Cp / Cpk vs (USL, LSL) speak directly to process-capability + yield:
//   Cp  = (USL − LSL) / (6σ)
//   Cpk = min((USL − μ) / 3σ, (μ − LSL) / 3σ)

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace tolerance {

enum class Distribution : std::uint8_t {
    Normal     = 0,   // tol = ±3σ
    Uniform    = 1,
    Triangular = 2,
};

struct Dimension {
    std::string name;
    double      nominal;
    double      tolPlus;   // +tolerance
    double      tolMinus;  // −tolerance (positive number)
    Distribution dist;
};

struct StackInputs {
    std::vector<Dimension> chain;
    double USL;            // upper spec limit on assembly
    double LSL;            // lower spec limit on assembly
    int    mcSamples;
    unsigned long randomSeed;
};

struct StackResult {
    double worstCaseNominal;
    double worstCaseHigh;
    double worstCaseLow;
    double rssMu;
    double rssSigma;
    double rssCp;
    double rssCpk;
    // Monte-Carlo metrics:
    double mcMu;
    double mcSigma;
    double mcP05, mcP50, mcP95;
    double mcCp;
    double mcCpk;
    double mcYieldPct;    // % of samples within [LSL, USL]
};

StackResult compute(const StackInputs& in);

}} // namespace forge::tolerance
