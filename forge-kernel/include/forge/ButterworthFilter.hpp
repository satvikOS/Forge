// Forge-335d — Butterworth digital low-pass IIR (Oppenheim-Schafer Ch 7).
//   Specification: pass-band edge f_p, stop-band edge f_s, attenuation A_p, A_s, sample rate f_samp.
//   Pre-warp analogue freqs via bilinear: Ω = 2·f_samp · tan(π·f / f_samp)
//   Required order:
//     N = ceil( log10( (10^(A_s/10) − 1) / (10^(A_p/10) − 1) ) / (2·log10(Ω_s / Ω_p)) )
//   Analogue cut-off:
//     Ω_c = Ω_p / (10^(A_p/10) − 1)^(1/(2N))
//   Digital cut-off f_c = atan(Ω_c/(2·f_samp)) · f_samp / π
//   For demonstration the kernel returns N, f_c, and one-pole-pair lowest-Q b/a coefficients
//   (2nd-order section), not the full cascaded SOS.

#pragma once

namespace forge::butter {

struct Input {
    double sampleRate_Hz;        // f_samp
    double passEdge_Hz;          // f_p
    double stopEdge_Hz;          // f_s
    double passRipple_dB;        // A_p
    double stopAtten_dB;         // A_s
};

struct Result {
    int    order_N;
    double cutoff_Hz;             // 3-dB cut-off f_c (digital)
    double analogueOmegaC;        // Ω_c
    double b0, b1, b2;            // single 2nd-order biquad (representative)
    double a1, a2;
};

Result analyse(const Input& in);

}  // namespace forge::butter
