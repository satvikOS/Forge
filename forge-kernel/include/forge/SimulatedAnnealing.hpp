// Forge-337e — Simulated annealing for boundary-constrained min f(x) (Press NR §10.9).
//   Geometric cooling T_n = α·T_{n−1}, accept worse with P = exp(−Δf/T).
//   For demonstration the kernel optimises Rosenbrock f(x,y) = (1−x)² + 100·(y−x²)²
//   (a standard NR test) over a 2-D bounded box. Returns best (x,y) found and trace stats.

#pragma once

namespace forge::sa {

struct Input {
    double xLower, xUpper;
    double yLower, yUpper;
    double initialTemperature;
    double coolingFactor;          // 0.95 typical
    int    iterationsTotal;
    double proposalStdDev;          // neighbourhood radius
    int    randomSeed;
};

struct Result {
    double bestX, bestY;
    double bestValue;
    double acceptanceRatio;
    int    iterationsRun;
    double finalTemperature;
};

Result analyse(const Input& in);

}  // namespace forge::sa
