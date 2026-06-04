#include "forge/ResponseSpectrum.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::rspect {

static Point spectralAt(double T, const Input& in, double dt) {
    const double m = 1.0;          // mass = 1 (per unit; response normalised)
    const double omega = 2.0 * M_PI / T;
    const double k = m * omega * omega;
    const double c = 2.0 * in.dampingRatio * omega * m;

    // Newmark constant average acceleration: γ=1/2, β=1/4
    constexpr double gamma = 0.5;
    constexpr double beta  = 0.25;

    double x = 0.0, xdot = 0.0, xddot = 0.0;
    double peak_x = 0.0, peak_v = 0.0, peak_a = 0.0;

    const double a1 = m / (beta * dt * dt) + c * gamma / (beta * dt);
    const double a2 = m / (beta * dt)      + c * (gamma / beta - 1.0);
    const double a3 = m * (1.0 / (2.0 * beta) - 1.0) + c * dt * (gamma / (2.0 * beta) - 1.0);
    const double kHat = k + a1;

    // initial accel from EQ at t=0
    xddot = (-m * in.accel_ms2[0] - c * xdot - k * x) / m;

    for (size_t i = 1; i < in.time_s.size(); ++i) {
        const double p_iplus1 = -m * in.accel_ms2[i];
        const double pHat = p_iplus1 + a1 * x + a2 * xdot + a3 * xddot;
        const double x_new = pHat / kHat;
        const double xdot_new = (gamma / (beta * dt)) * (x_new - x)
                              + (1.0 - gamma / beta) * xdot
                              + dt * (1.0 - gamma / (2.0 * beta)) * xddot;
        const double xddot_new = (x_new - x) / (beta * dt * dt)
                               - xdot / (beta * dt)
                               - (1.0 / (2.0 * beta) - 1.0) * xddot;
        x     = x_new;
        xdot  = xdot_new;
        xddot = xddot_new;
        const double total_accel = xddot + in.accel_ms2[i];
        peak_x = std::max(peak_x, std::fabs(x));
        peak_v = std::max(peak_v, std::fabs(xdot));
        peak_a = std::max(peak_a, std::fabs(total_accel));
    }
    Point p;
    p.T_s    = T;
    p.Sd_m   = peak_x;
    p.Sv_mps = peak_v;
    p.Sa_mps2= peak_a;
    return p;
}

Result analyse(const Input& in) {
    if (in.time_s.size() < 4)                       throw std::runtime_error("≥ 4 samples");
    if (in.time_s.size() != in.accel_ms2.size())    throw std::runtime_error("len mismatch");
    if (in.dampingRatio < 0 || in.dampingRatio > 0.5) throw std::runtime_error("ζ in [0, 0.5]");
    if (in.Tmin_s <= 0 || in.Tmax_s <= in.Tmin_s)   throw std::runtime_error("T range");
    if (in.nSpectralPoints < 2)                     throw std::runtime_error("nPts >= 2");

    const double dt = in.time_s[1] - in.time_s[0];
    if (dt <= 0) throw std::runtime_error("dt > 0");

    Result r;
    double peak_pga = 0.0;
    for (double a : in.accel_ms2) peak_pga = std::max(peak_pga, std::fabs(a));
    r.peakGroundAccel_ms2 = peak_pga;

    const double logT_min = std::log(in.Tmin_s);
    const double logT_max = std::log(in.Tmax_s);
    for (int i = 0; i < in.nSpectralPoints; ++i) {
        const double t = static_cast<double>(i) / (in.nSpectralPoints - 1);
        const double T = std::exp(logT_min + t * (logT_max - logT_min));
        r.spectrum.push_back(spectralAt(T, in, dt));
    }
    return r;
}

}  // namespace forge::rspect
