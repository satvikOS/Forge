#pragma once

// Forge-212 — S-N fatigue life calculator.
//
// Basquin's law (high-cycle fatigue):
//     σ_a = σ'_f · (2 · N_f)^b
//   ⇒ N_f = ½ · (σ_a / σ'_f)^(1/b)
//
// Miner's linear damage accumulation rule:
//     D = Σ (n_i / N_f,i)
//     failure ⇔ D ≥ 1
//
// where σ'_f is the fatigue-strength coefficient [MPa], b is the
// fatigue-strength exponent (negative, ≈ −0.05 … −0.12 for steel),
// n_i is the number of applied cycles at amplitude σ_a,i, and N_f,i
// is the allowable cycles at that amplitude.
//
// `materialDefaults(name)` returns canonical (σ'_f, b) for a small
// catalogue (mild steel, 7075-T6 aluminium, Ti-6Al-4V).

#include <string>
#include <vector>

namespace forge { namespace fatigue {

struct Material {
    double sigmaFCoef;       // σ'_f, MPa
    double bExponent;        // b (negative)
};

Material materialDefaults(const std::string& name);

double cyclesToFailure(double stressAmplitudeMPa,
                       double sigmaFCoef, double bExponent);

struct LoadBlock {
    double stressAmplitudeMPa;
    double appliedCycles;
};

struct BlockResult {
    double cyclesToFailure;
    double damageContribution;
};

struct Outputs {
    std::vector<BlockResult> perBlock;
    double                   totalDamage;
    bool                     failed;
    double                   cyclesRemaining;    // assuming the
                                                 // largest-amplitude
                                                 // block continues
};

Outputs cumulativeDamage(const std::vector<LoadBlock>& blocks,
                         const Material& material);

}} // namespace forge::fatigue
