// Forge-340e — Discrete-time finite-state Markov chain (Grinstead-Snell Ch 11).
//   Transition matrix P (row-stochastic).
//   n-step distribution: π_n = π_0 · P^n
//   Stationary distribution π* solves π* = π* · P with Σπ_i = 1.
//   Power-method iteration converges for irreducible/aperiodic chains.

#pragma once

#include <vector>

namespace forge::markov {

struct Input {
    int    stateCount;
    std::vector<double> transitionMatrix;     // row-major, n×n; rows sum to 1
    std::vector<double> initialDistribution;
    int    iterationCount;                    // for π_n
    int    powerMethodMaxIter;                // for π*
    double powerMethodTolerance;
};

struct Result {
    std::vector<double> distributionAtN;     // π_0 · P^n
    std::vector<double> stationary;          // π* (or last iterate if not converged)
    bool   stationaryConverged;
    int    iterationsUsed;
};

Result analyse(const Input& in);

}  // namespace forge::markov
