#include "forge/SimulatedAnnealing.hpp"

#include <cmath>
#include <random>
#include <stdexcept>

namespace forge::sa {

static double rosenbrock(double x, double y) {
    const double a = 1.0 - x;
    const double b = y - x * x;
    return a * a + 100.0 * b * b;
}

Result analyse(const Input& in) {
    if (in.xUpper <= in.xLower)            throw std::runtime_error("xU > xL");
    if (in.yUpper <= in.yLower)            throw std::runtime_error("yU > yL");
    if (in.initialTemperature <= 0)        throw std::runtime_error("T_0 > 0");
    if (in.coolingFactor <= 0 || in.coolingFactor >= 1)
        throw std::runtime_error("α in (0, 1)");
    if (in.iterationsTotal <= 0)           throw std::runtime_error("iters > 0");
    if (in.proposalStdDev <= 0)            throw std::runtime_error("σ > 0");

    std::mt19937 rng(static_cast<uint32_t>(in.randomSeed));
    std::uniform_real_distribution<double> uX(in.xLower, in.xUpper);
    std::uniform_real_distribution<double> uY(in.yLower, in.yUpper);
    std::normal_distribution<double> step(0.0, in.proposalStdDev);
    std::uniform_real_distribution<double> u01(0.0, 1.0);

    double x = uX(rng), y = uY(rng);
    double f = rosenbrock(x, y);
    double best_x = x, best_y = y, best_f = f;
    double T = in.initialTemperature;
    int accepted = 0;

    for (int i = 0; i < in.iterationsTotal; ++i) {
        double xn = x + step(rng);
        double yn = y + step(rng);
        if (xn < in.xLower) xn = in.xLower;
        if (xn > in.xUpper) xn = in.xUpper;
        if (yn < in.yLower) yn = in.yLower;
        if (yn > in.yUpper) yn = in.yUpper;
        const double fn = rosenbrock(xn, yn);
        const double df = fn - f;
        if (df < 0 || u01(rng) < std::exp(-df / T)) {
            x = xn; y = yn; f = fn; accepted++;
            if (f < best_f) { best_x = x; best_y = y; best_f = f; }
        }
        T *= in.coolingFactor;
    }

    Result r;
    r.bestX             = best_x;
    r.bestY             = best_y;
    r.bestValue         = best_f;
    r.acceptanceRatio   = static_cast<double>(accepted) / in.iterationsTotal;
    r.iterationsRun     = in.iterationsTotal;
    r.finalTemperature  = T;
    return r;
}

}  // namespace forge::sa
