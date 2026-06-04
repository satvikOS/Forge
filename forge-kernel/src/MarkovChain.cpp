#include "forge/MarkovChain.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::markov {

static void mulVecMat(const std::vector<double>& v,
                      const std::vector<double>& P,
                      int n, std::vector<double>& out) {
    out.assign(n, 0.0);
    for (int j = 0; j < n; ++j)
        for (int i = 0; i < n; ++i)
            out[j] += v[i] * P[i * n + j];
}

Result analyse(const Input& in) {
    if (in.stateCount <= 0)                            throw std::runtime_error("n > 0");
    if ((int)in.transitionMatrix.size() != in.stateCount * in.stateCount)
        throw std::runtime_error("P size = n²");
    if ((int)in.initialDistribution.size() != in.stateCount)
        throw std::runtime_error("π_0 size = n");
    if (in.iterationCount < 0)                         throw std::runtime_error("iters >= 0");
    if (in.powerMethodMaxIter <= 0)                    throw std::runtime_error("power iters > 0");
    if (in.powerMethodTolerance <= 0)                  throw std::runtime_error("tol > 0");

    const int n = in.stateCount;
    // Validate row stochasticity.
    for (int i = 0; i < n; ++i) {
        double row = 0.0;
        for (int j = 0; j < n; ++j) {
            if (in.transitionMatrix[i * n + j] < 0)
                throw std::runtime_error("P_ij >= 0");
            row += in.transitionMatrix[i * n + j];
        }
        if (std::fabs(row - 1.0) > 1.0e-6)
            throw std::runtime_error("row sum = 1");
    }

    // π_n via repeated multiplication.
    std::vector<double> a = in.initialDistribution, b;
    for (int s = 0; s < in.iterationCount; ++s) {
        mulVecMat(a, in.transitionMatrix, n, b);
        std::swap(a, b);
    }
    std::vector<double> piN = a;

    // Power method for π*.
    std::vector<double> u(n, 1.0 / n), v;
    bool converged = false;
    int it = 0;
    for (; it < in.powerMethodMaxIter; ++it) {
        mulVecMat(u, in.transitionMatrix, n, v);
        double diff = 0.0;
        for (int i = 0; i < n; ++i) diff += std::fabs(v[i] - u[i]);
        u = v;
        if (diff < in.powerMethodTolerance) { converged = true; break; }
    }

    Result r;
    r.distributionAtN       = piN;
    r.stationary            = u;
    r.stationaryConverged   = converged;
    r.iterationsUsed        = it;
    return r;
}

}  // namespace forge::markov
