// Forge-328b — Fire sprinkler K-factor flow & density-area (NFPA 13).
//   Q [gpm] = K · √P [psi]            US customary
//   Q [L/min] = K_metric · √P [bar]
//   K_metric = K_us · 14.376  (approx)
// Required flow for a hazard density: Q_min = A_op · density.

#pragma once

namespace forge::sprinkler {

struct Input {
    double kFactorUSorMetric;          // 5.6 typical SR US (8 EC), or metric equivalent
    bool   metricInputs;               // true → K already in metric, P in bar
    double pressurePsi_or_bar;          // pressure at sprinkler
    double designDensityMmPerMin;       // 4.1 OH-G1, 6.1 OH-G2 typ
    double operationAreaM2;             // for hazard sizing (e.g. 144 m² OH-G1)
};

struct Result {
    double sprinklerFlowLpm;
    double sprinklerFlowGpm;
    double requiredAreaFlowLpm;         // density × area
    bool   sprinklerOK;                  // sprinkler flow ≥ density·spacing area (caller compares)
};

Result analyse(const Input& in);

}  // namespace forge::sprinkler
