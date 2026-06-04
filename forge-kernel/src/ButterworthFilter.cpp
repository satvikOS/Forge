#include "forge/ButterworthFilter.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::butter {

Result analyse(const Input& in) {
    if (in.sampleRate_Hz <= 0)        throw std::runtime_error("f_samp > 0");
    if (in.passEdge_Hz <= 0)          throw std::runtime_error("f_p > 0");
    if (in.stopEdge_Hz <= in.passEdge_Hz) throw std::runtime_error("f_s > f_p");
    if (in.stopEdge_Hz >= in.sampleRate_Hz / 2.0)
        throw std::runtime_error("f_s < f_Nyquist");
    if (in.passRipple_dB <= 0)        throw std::runtime_error("A_p > 0");
    if (in.stopAtten_dB <= in.passRipple_dB) throw std::runtime_error("A_s > A_p");

    const double fs = in.sampleRate_Hz;
    const double Wp = 2.0 * fs * std::tan(M_PI * in.passEdge_Hz / fs);
    const double Ws = 2.0 * fs * std::tan(M_PI * in.stopEdge_Hz / fs);
    const double eps_p = std::pow(10.0, in.passRipple_dB / 10.0) - 1.0;
    const double eps_s = std::pow(10.0, in.stopAtten_dB  / 10.0) - 1.0;
    const double N_real = std::log10(eps_s / eps_p) / (2.0 * std::log10(Ws / Wp));
    const int    N = static_cast<int>(std::ceil(N_real));

    const double Wc = Wp / std::pow(eps_p, 1.0 / (2.0 * N));
    // Digital cut-off via inverse bilinear.
    const double fc = std::atan(Wc / (2.0 * fs)) * fs / M_PI;

    // Construct a single 2nd-order biquad lowpass at f_c with Q = 1/√2 (lowest-Q Butterworth pole pair).
    const double omega = 2.0 * M_PI * fc / fs;
    const double cosw = std::cos(omega);
    const double sinw = std::sin(omega);
    const double Q = 1.0 / std::sqrt(2.0);
    const double alpha = sinw / (2.0 * Q);

    const double b0n =  (1.0 - cosw) / 2.0;
    const double b1n =   1.0 - cosw;
    const double b2n =  (1.0 - cosw) / 2.0;
    const double a0n =   1.0 + alpha;
    const double a1n =  -2.0 * cosw;
    const double a2n =   1.0 - alpha;

    Result r;
    r.order_N        = N;
    r.cutoff_Hz      = fc;
    r.analogueOmegaC = Wc;
    r.b0 = b0n / a0n;
    r.b1 = b1n / a0n;
    r.b2 = b2n / a0n;
    r.a1 = a1n / a0n;
    r.a2 = a2n / a0n;
    return r;
}

}  // namespace forge::butter
