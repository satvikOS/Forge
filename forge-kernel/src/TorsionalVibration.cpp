#include "forge/TorsionalVibration.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::torvib {

static double holzerResidual(double omega, const Input& in, std::vector<double>* shape) {
    const size_t n = in.inertias_kgm2.size();
    double theta = 1.0;
    double T = 0.0;
    if (shape) { shape->clear(); shape->push_back(theta); }
    for (size_t i = 0; i < n; ++i) {
        T += omega * omega * in.inertias_kgm2[i] * theta;
        if (i < n - 1) {
            theta -= T / in.stiffnesses_NmPerRad[i];
            if (shape) shape->push_back(theta);
        }
    }
    return T;
}

Result analyse(const Input& in) {
    if (in.inertias_kgm2.size() < 2)               throw std::runtime_error("≥ 2 inertias");
    if (in.stiffnesses_NmPerRad.size() != in.inertias_kgm2.size() - 1)
        throw std::runtime_error("k count = J − 1");
    if (in.frequencyLowerBound_Hz <= 0)            throw std::runtime_error("f_lo > 0");
    if (in.frequencyUpperBound_Hz <= in.frequencyLowerBound_Hz)
        throw std::runtime_error("f_hi > f_lo");
    if (in.nModesSought <= 0)                      throw std::runtime_error("modes > 0");

    // Sample residual sign changes coarsely, then bisect.
    Result r;
    constexpr int N_SAMPLES = 1000;
    const double f_lo = in.frequencyLowerBound_Hz;
    const double f_hi = in.frequencyUpperBound_Hz;
    const double df = (f_hi - f_lo) / N_SAMPLES;
    double f_prev = f_lo;
    double res_prev = holzerResidual(2.0 * M_PI * f_prev, in, nullptr);

    int total_iter = N_SAMPLES;
    for (int s = 1; s <= N_SAMPLES && (int)r.modes.size() < in.nModesSought; ++s) {
        const double f_cur = f_lo + s * df;
        const double res_cur = holzerResidual(2.0 * M_PI * f_cur, in, nullptr);
        if (res_prev * res_cur < 0.0) {
            // bisect.
            double lo = f_prev, hi = f_cur;
            double r_lo = res_prev, r_hi = res_cur;
            for (int b = 0; b < 60; ++b) {
                const double mid = 0.5 * (lo + hi);
                const double r_mid = holzerResidual(2.0 * M_PI * mid, in, nullptr);
                total_iter++;
                if (std::fabs(r_mid) < 1.0e-10 || (hi - lo) < 1.0e-9) {
                    Mode mode;
                    mode.frequency_Hz = mid;
                    holzerResidual(2.0 * M_PI * mid, in, &mode.shape);
                    r.modes.push_back(mode);
                    break;
                }
                if (r_lo * r_mid < 0.0) { hi = mid; r_hi = r_mid; }
                else                    { lo = mid; r_lo = r_mid; }
            }
            if ((int)r.modes.size() && r.modes.back().frequency_Hz < f_cur) {
                // already added
            }
        }
        f_prev = f_cur;
        res_prev = res_cur;
    }
    r.iterationsTotal = total_iter;
    return r;
}

}  // namespace forge::torvib
