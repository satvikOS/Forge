#include "forge/Variants.hpp"

#include <algorithm>
#include <random>
#include <stdexcept>

namespace forge { namespace variants {

LhsResult latinHypercube(const LhsInputs& in) {
    if (in.dims.empty()) {
        throw std::invalid_argument("forge.variants.lhs: dims must be non-empty");
    }
    if (in.samples < 2) {
        throw std::invalid_argument("forge.variants.lhs: samples must be ≥ 2");
    }
    for (const auto& d : in.dims) {
        if (!(d.hi > d.lo)) {
            throw std::invalid_argument(
                "forge.variants.lhs: dim '" + d.name + "' needs hi > lo");
        }
    }
    LhsResult R{};
    R.nDims    = static_cast<int>(in.dims.size());
    R.nSamples = in.samples;
    R.values.assign(static_cast<std::size_t>(R.nDims) * R.nSamples, 0.0);
    std::mt19937_64 rng(in.randomSeed);
    std::uniform_real_distribution<double> jitter(0.0, 1.0);
    // For each dimension: a permutation of [0..N-1], each bin
    // independently jittered with a uniform draw to land somewhere in
    // [bin/N, (bin+1)/N].
    std::vector<int> perm(R.nSamples);
    for (int d = 0; d < R.nDims; ++d) {
        for (int i = 0; i < R.nSamples; ++i) perm[i] = i;
        std::shuffle(perm.begin(), perm.end(), rng);
        const double range = in.dims[d].hi - in.dims[d].lo;
        for (int s = 0; s < R.nSamples; ++s) {
            const double u = (perm[s] + jitter(rng)) / R.nSamples;
            R.values[static_cast<std::size_t>(s) * R.nDims + d] =
                in.dims[d].lo + u * range;
        }
    }
    return R;
}

std::vector<std::uint32_t>
paretoFront(const std::vector<double>& objectives,
            int nObjectives,
            const std::vector<int>& axisSign) {
    if (nObjectives < 1) {
        throw std::invalid_argument("forge.variants.pareto: nObjectives must be ≥ 1");
    }
    if (objectives.size() % nObjectives != 0) {
        throw std::invalid_argument(
            "forge.variants.pareto: objectives size must be multiple of nObjectives");
    }
    if (static_cast<int>(axisSign.size()) != nObjectives) {
        throw std::invalid_argument(
            "forge.variants.pareto: axisSign length must equal nObjectives");
    }
    const std::size_t N = objectives.size() / nObjectives;
    // We re-orient each axis so MAXIMISE on every axis is the universal
    // dominance test: y_i = sign × original_i. Then point a dominates
    // point b iff y_a >= y_b for all axes and y_a > y_b for at least one.
    std::vector<double> y(objectives.size());
    for (std::size_t i = 0; i < N; ++i) {
        for (int k = 0; k < nObjectives; ++k) {
            y[i * nObjectives + k] = axisSign[k] >= 0
                ? +objectives[i * nObjectives + k]
                : -objectives[i * nObjectives + k];
        }
    }
    std::vector<std::uint32_t> out;
    out.reserve(N);
    for (std::size_t a = 0; a < N; ++a) {
        bool dominated = false;
        for (std::size_t b = 0; b < N; ++b) {
            if (a == b) continue;
            bool allGe = true, anyGt = false;
            for (int k = 0; k < nObjectives; ++k) {
                const double yb = y[b * nObjectives + k];
                const double ya = y[a * nObjectives + k];
                if (yb < ya - 1e-12) { allGe = false; break; }
                if (yb > ya + 1e-12) anyGt = true;
            }
            if (allGe && anyGt) { dominated = true; break; }
        }
        if (!dominated) out.push_back(static_cast<std::uint32_t>(a));
    }
    return out;
}

}} // namespace forge::variants
