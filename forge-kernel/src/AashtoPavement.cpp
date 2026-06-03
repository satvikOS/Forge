// Forge-285 — implementation; see header for derivation references.

#include "forge/AashtoPavement.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::aashto {

// Inverse standard-normal CDF via Beasley-Springer/Moro approximation.
// Returns Z such that Φ(Z) = p, accurate to ~1e-8 for p ∈ (0, 1).
static double invNormCdf(double p) {
    if (p <= 0.0 || p >= 1.0)
        throw std::runtime_error("reliability out of valid CDF range");
    // Beasley-Springer / Moro approximation.
    static const double a[6] = {
        -3.969683028665376e+01,  2.209460984245205e+02,
        -2.759285104469687e+02,  1.383577518672690e+02,
        -3.066479806614716e+01,  2.506628277459239e+00
    };
    static const double b[5] = {
        -5.447609879822406e+01,  1.615858368580409e+02,
        -1.556989798598866e+02,  6.680131188771972e+01,
        -1.328068155288572e+01
    };
    static const double c[6] = {
        -7.784894002430293e-03, -3.223964580411365e-01,
        -2.400758277161838e+00, -2.549732539343734e+00,
         4.374664141464968e+00,  2.938163982698783e+00
    };
    static const double d[4] = {
         7.784695709041462e-03,  3.224671290700398e-01,
         2.445134137142996e+00,  3.754408661907416e+00
    };
    const double p_low = 0.02425, p_high = 1.0 - p_low;
    double q, r, x;
    if (p < p_low) {
        q = std::sqrt(-2.0 * std::log(p));
        x = (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5])
            / ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1.0);
    } else if (p <= p_high) {
        q = p - 0.5;
        r = q * q;
        x = (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5])*q
            / (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1.0);
    } else {
        q = std::sqrt(-2.0 * std::log(1.0 - p));
        x = -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5])
            / ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1.0);
    }
    return x;
}

// Residual: f(SN) = predicted log W_18 minus actual log W_18.
static double residual(double SN, double zR_S0, double deltaPSI,
                        double Mr_term, double logW18_actual) {
    const double sn1 = SN + 1.0;
    const double term1 = 9.36 * std::log10(sn1) - 0.20;
    const double term2 = std::log10(deltaPSI / 2.7)
                         / (0.40 + 1094.0 / std::pow(sn1, 5.19));
    const double predicted = zR_S0 + term1 + term2 + Mr_term - 8.07;
    return predicted - logW18_actual;
}

Result analyse(const Input& in) {
    if (in.w18Esals <= 0.0)
        throw std::runtime_error("w18Esals must be > 0");
    if (in.reliabilityPct <= 50.0 || in.reliabilityPct >= 100.0)
        throw std::runtime_error("reliabilityPct must be in (50, 100)");
    if (in.overallStdDev < 0.20 || in.overallStdDev > 0.60)
        throw std::runtime_error("overallStdDev must be in [0.20, 0.60]");
    if (in.deltaPSI <= 0.0 || in.deltaPSI > 4.5)
        throw std::runtime_error("deltaPSI must be in (0, 4.5]");
    if (in.subgradeMrPsi <= 0.0)
        throw std::runtime_error("subgradeMrPsi must be > 0");

    // Z_R from reliability percentage. AASHTO uses Z_R = Φ⁻¹(1 − R), so
    // higher R gives more negative Z_R (the design must work harder).
    const double zR = invNormCdf(1.0 - in.reliabilityPct / 100.0);

    const double logW18 = std::log10(in.w18Esals);
    const double zR_S0  = zR * in.overallStdDev;
    const double Mr_t   = 2.32 * std::log10(in.subgradeMrPsi);

    // Newton-Raphson on SN.
    double SN = 5.0;
    int iters = 0;
    const int MAX = 60;
    for (; iters < MAX; ++iters) {
        const double f  = residual(SN, zR_S0, in.deltaPSI, Mr_t, logW18);
        // Numerical derivative (5-pt central).
        const double h  = 1e-4;
        const double df = (residual(SN + h, zR_S0, in.deltaPSI, Mr_t, logW18)
                         - residual(SN - h, zR_S0, in.deltaPSI, Mr_t, logW18))
                         / (2.0 * h);
        if (std::abs(df) < 1e-12) break;
        const double SN_new = SN - f / df;
        if (std::abs(SN_new - SN) < 1e-6) {
            SN = SN_new;
            ++iters;
            break;
        }
        // Keep SN positive.
        SN = (SN_new > 0.1) ? SN_new : 0.1;
    }
    if (SN < 0.5)
        throw std::runtime_error("AASHTO 93 SN solution not in design range");

    Result r;
    r.zR               = zR;
    r.logW18           = logW18;
    r.structuralNumber = SN;
    r.iterations       = iters;
    return r;
}

}  // namespace forge::aashto
