#include "forge/PipeNetwork.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::pipenet {

Result analyse(const Input& in) {
    if (in.pipes.empty())             throw std::runtime_error("pipes empty");
    if (in.loopCount <= 0)            throw std::runtime_error("loopCount > 0");
    if (in.tolerance_Lps <= 0)        throw std::runtime_error("tol > 0");
    if (in.maxIterations <= 0)        throw std::runtime_error("maxIter > 0");

    constexpr double g = 9.80665;
    const double n = 2.0;        // Darcy-Weisbach exponent

    // Resistance r in Pa·s²/L² → head loss in m: h = r·Q² where Q in m³/s.
    // Working units: Q in L/s → m³/s = Q/1000.
    auto computeR = [&](const Pipe& p) -> double {
        const double D_m = p.diameter_mm / 1000.0;
        return 8.0 * p.frictionFactor_f * p.length_m
             / (M_PI * M_PI * g * std::pow(D_m, 5.0));
    };

    std::vector<double> Q_Lps(in.pipes.size());
    std::vector<double> r_vec(in.pipes.size());
    for (size_t i = 0; i < in.pipes.size(); ++i) {
        Q_Lps[i] = in.pipes[i].initialFlow_Lps;
        r_vec[i] = computeR(in.pipes[i]);
    }

    int iter = 0;
    double maxDeltaQ = 0.0;
    bool converged = false;

    for (iter = 0; iter < in.maxIterations; ++iter) {
        maxDeltaQ = 0.0;
        for (int L = 0; L < in.loopCount; ++L) {
            double num = 0.0, den = 0.0;
            for (size_t i = 0; i < in.pipes.size(); ++i) {
                if (in.pipes[i].loopIndex != L) continue;
                const double Q_m3s = Q_Lps[i] * 1.0e-3;
                const double sign = in.pipes[i].loopSignCW;
                const double rQQ = sign * r_vec[i] * Q_m3s * std::fabs(Q_m3s);
                num += rQQ;
                den += r_vec[i] * std::fabs(Q_m3s);
            }
            if (den < 1e-30) continue;
            const double dQ_m3s = -num / (n * den);
            const double dQ_Lps = dQ_m3s * 1.0e3;
            maxDeltaQ = std::max(maxDeltaQ, std::fabs(dQ_Lps));
            for (size_t i = 0; i < in.pipes.size(); ++i) {
                if (in.pipes[i].loopIndex != L) continue;
                Q_Lps[i] += in.pipes[i].loopSignCW * dQ_Lps;
            }
        }
        if (maxDeltaQ < in.tolerance_Lps) { converged = true; iter++; break; }
    }

    Result r;
    r.finalFlows_Lps.assign(in.pipes.size(), 0.0);
    r.headLosses_m.assign(in.pipes.size(), 0.0);
    for (size_t i = 0; i < in.pipes.size(); ++i) {
        const double Q_m3s = Q_Lps[i] * 1.0e-3;
        r.finalFlows_Lps[i] = Q_Lps[i];
        r.headLosses_m[i] = r_vec[i] * Q_m3s * std::fabs(Q_m3s);
    }
    r.iterationsUsed   = iter;
    r.maxCorrection_Lps = maxDeltaQ;
    r.converged        = converged;
    return r;
}

}  // namespace forge::pipenet
