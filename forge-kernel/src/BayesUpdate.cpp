#include "forge/BayesUpdate.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::bayes {

// Wilson-Cornish-Fisher quantile approx for Beta(a, b) – good for moderate a, b > 5.
static double betaQuantile(double p, double a, double b) {
    // Normal approximation with mean and variance adjusted.
    const double mu  = a / (a + b);
    const double var = a * b / ((a + b) * (a + b) * (a + b + 1.0));
    const double sd  = std::sqrt(var);
    // Inverse normal CDF (Beasley-Springer for high precision):
    auto invNormal = [](double pp) {
        // Acklam algorithm.
        constexpr double a_[6] = {-3.969683028665376e+01,  2.209460984245205e+02,
                                  -2.759285104469687e+02,  1.383577518672690e+02,
                                  -3.066479806614716e+01,  2.506628277459239e+00};
        constexpr double b_[5] = {-5.447609879822406e+01,  1.615858368580409e+02,
                                  -1.556989798598866e+02,  6.680131188771972e+01,
                                  -1.328068155288572e+01};
        constexpr double c_[6] = {-7.784894002430293e-03, -3.223964580411365e-01,
                                  -2.400758277161838e+00, -2.549732539343734e+00,
                                   4.374664141464968e+00,  2.938163982698783e+00};
        constexpr double d_[4] = { 7.784695709041462e-03,  3.224671290700398e-01,
                                   2.445134137142996e+00,  3.754408661907416e+00};
        const double p_low = 0.02425, p_high = 1.0 - p_low;
        double q, r, x;
        if (pp < p_low) {
            q = std::sqrt(-2.0 * std::log(pp));
            x = (((((c_[0] * q + c_[1]) * q + c_[2]) * q + c_[3]) * q + c_[4]) * q + c_[5])
              / ((((d_[0] * q + d_[1]) * q + d_[2]) * q + d_[3]) * q + 1.0);
        } else if (pp <= p_high) {
            q = pp - 0.5;
            r = q * q;
            x = (((((a_[0] * r + a_[1]) * r + a_[2]) * r + a_[3]) * r + a_[4]) * r + a_[5]) * q
              / (((((b_[0] * r + b_[1]) * r + b_[2]) * r + b_[3]) * r + b_[4]) * r + 1.0);
        } else {
            q = std::sqrt(-2.0 * std::log(1.0 - pp));
            x = -(((((c_[0] * q + c_[1]) * q + c_[2]) * q + c_[3]) * q + c_[4]) * q + c_[5])
              / ((((d_[0] * q + d_[1]) * q + d_[2]) * q + d_[3]) * q + 1.0);
        }
        return x;
    };
    const double z = invNormal(p);
    double q = mu + z * sd;
    if (q < 0) q = 0;
    if (q > 1) q = 1;
    return q;
}

Result analyse(const Input& in) {
    if (in.priorAlpha <= 0)               throw std::runtime_error("α > 0");
    if (in.priorBeta <= 0)                throw std::runtime_error("β > 0");
    if (in.trials_n < 0)                  throw std::runtime_error("n >= 0");
    if (in.successes_k < 0 || in.successes_k > in.trials_n) throw std::runtime_error("0 ≤ k ≤ n");
    if (in.credibleLevel <= 0 || in.credibleLevel >= 1)
        throw std::runtime_error("cred level in (0, 1)");

    const double a = in.priorAlpha + in.successes_k;
    const double b = in.priorBeta + in.trials_n - in.successes_k;
    const double mean = a / (a + b);
    const double mode = (a > 1.0 && b > 1.0) ? (a - 1.0) / (a + b - 2.0) : mean;
    const double var  = a * b / ((a + b) * (a + b) * (a + b + 1.0));
    const double sd   = std::sqrt(var);

    const double alpha2 = (1.0 - in.credibleLevel) / 2.0;
    const double lo = betaQuantile(alpha2,         a, b);
    const double hi = betaQuantile(1.0 - alpha2,   a, b);

    Result r;
    r.posteriorAlpha            = a;
    r.posteriorBeta             = b;
    r.posteriorMean             = mean;
    r.posteriorMode             = mode;
    r.posteriorStdDev           = sd;
    r.credibleIntervalLower     = lo;
    r.credibleIntervalUpper     = hi;
    r.posteriorPredictiveProb   = mean;
    return r;
}

}  // namespace forge::bayes
