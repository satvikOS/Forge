#pragma once

// Forge-187 — Generative variant explorer (parametric design space).
//
// Two primitives the workbench composes against arbitrary domain
// generators (NACA wings, soil-slope geometries, …):
//
//   * Latin-hypercube sampling — given a list of (min, max) per
//     dimension and a sample count N, returns N stratified parameter
//     vectors that cover the input space with much better coverage than
//     pure-random Monte-Carlo at modest N.
//   * Pareto-front extraction — given M points in K-dimensional
//     objective space and a per-axis "minimise / maximise" sign list,
//     returns the indices of points on the non-dominated front.

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace variants {

struct DimSpec {
    std::string name;
    double      lo;
    double      hi;
};

struct LhsInputs {
    std::vector<DimSpec> dims;
    int                  samples;
    unsigned long        randomSeed;
};

struct LhsResult {
    int    nDims;
    int    nSamples;
    // Flat layout, length = nDims × nSamples, packed row-major
    // (row = sample, col = dim).
    std::vector<double> values;
};

LhsResult latinHypercube(const LhsInputs& in);

// axisSign[k] = +1 → "higher is better" (maximise); -1 → "lower is
// better" (minimise). The returned indices are sorted ascending.
std::vector<std::uint32_t>
paretoFront(const std::vector<double>& objectives,
            int nObjectives,
            const std::vector<int>& axisSign);

}} // namespace forge::variants
