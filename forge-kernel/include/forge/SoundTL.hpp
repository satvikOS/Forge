// Forge-263 — Sound transmission loss (Bies & Hansen, Beranek).
//
// Mass law for single-leaf partition (random incidence, idealised):
//   TL_field (dB) = 20·log₁₀(ρ_s · f) − 47
//   where ρ_s is surface density (kg/m²) and f is frequency (Hz).
//
// Coincidence dip: at f_c the partition becomes flexible. We expose
// a user-supplied coincidence-loss subtraction (dB) for designers
// who know the panel is operating near f_c.
//
// Composite TL for a partition composed of several area-weighted
// elements with transmission coefficients τ_i = 10^(-TL_i/10):
//   τ_total = Σ(A_i · τ_i) / Σ A_i
//   TL_total = -10·log₁₀(τ_total)

#pragma once
#include <vector>

namespace forge::soundtl {

struct MassLawInput {
    double surfaceDensityKgPerM2;  // ρ_s
    double frequencyHz;            // f
    double coincidenceLossDb;      // user-supplied (0 if not near f_c)
};

double massLawTL(const MassLawInput& in);

struct CompositeElement {
    double areaM2;
    double transmissionLossDb;
};

struct CompositeInput {
    std::vector<CompositeElement> elements;
};

double compositeTL(const CompositeInput& in);

}  // namespace forge::soundtl
