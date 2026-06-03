// Forge-285 — AASHTO 1993 flexible-pavement structural number (SN).
//
// The classical AASHTO Design Equation for flexible pavements:
//
//   log W_18 = Z_R · S_0
//            + 9.36 · log(SN + 1) − 0.20
//            + log(ΔPSI / 2.7) / (0.40 + 1094 / (SN + 1)^5.19)
//            + 2.32 · log M_R − 8.07
//
// Inverted for SN via Newton-Raphson (initial guess SN = 5.0; tolerance 1e-6
// on log W_18 residual).
//
// Inputs:
//   W_18           Equivalent 18-kip single-axle loads over the design life.
//   reliabilityPct Reliability R (50.0 – 99.99 %). Z_R derived from inverse
//                  normal table (Abramowitz & Stegun 26.2.23 rational approx).
//   S_0            Overall standard deviation (0.30 – 0.50; 0.45 typical
//                  flexible, 0.35 typical rigid).
//   deltaPSI       Initial Serviceability − Terminal Serviceability
//                  (e.g. 4.2 − 2.5 = 1.7 for primary roads).
//   subgradeMrPsi  Resilient modulus M_R of subgrade [psi].

#pragma once

namespace forge::aashto {

struct Input {
    double w18Esals;
    double reliabilityPct;
    double overallStdDev;
    double deltaPSI;
    double subgradeMrPsi;
};

struct Result {
    double zR;
    double logW18;
    double structuralNumber;     // SN
    int    iterations;
};

Result analyse(const Input& in);

}  // namespace forge::aashto
