// Forge-341d — First-Order Second-Moment reliability (Cornell, Hasofer-Lind).
//   Performance function g = R − S (Resistance − Load)
//   μ_g = μ_R − μ_S
//   σ_g² = σ_R² + σ_S²              (uncorrelated)
//   Reliability index β = μ_g / σ_g
//   Probability of failure p_f = Φ(−β)  (standard normal CDF).

#pragma once

namespace forge::fosm {

struct Input {
    double meanR;
    double sigmaR;
    double meanS;
    double sigmaS;
    double correlation_rho;       // R-S correlation (typ 0)
};

struct Result {
    double mean_g;
    double sigma_g;
    double beta;
    double probabilityOfFailure;
    double safetyMarginCV;        // σ_g/μ_g (CV)
};

Result analyse(const Input& in);

}  // namespace forge::fosm
