// Forge-338e — Beta-Binomial conjugate Bayesian update (Gelman BDA Ch 2).
//   Prior  θ ~ Beta(α_prior, β_prior)
//   Data    n trials, k successes
//   Posterior  θ | data ~ Beta(α_post, β_post)    α_post = α + k,  β_post = β + n − k
//   Posterior mean = α_post / (α_post + β_post)
//   Posterior variance = α_post·β_post / ((α_post + β_post)²·(α_post + β_post + 1))
//   95 % credible interval via Beta inverse-CDF (use Wilson-Cornish-Fisher approx).

#pragma once

namespace forge::bayes {

struct Input {
    double priorAlpha;
    double priorBeta;
    int    trials_n;
    int    successes_k;
    double credibleLevel;       // 0.95
};

struct Result {
    double posteriorAlpha;
    double posteriorBeta;
    double posteriorMean;
    double posteriorMode;
    double posteriorStdDev;
    double credibleIntervalLower;
    double credibleIntervalUpper;
    double posteriorPredictiveProb;     // for next trial
};

Result analyse(const Input& in);

}  // namespace forge::bayes
