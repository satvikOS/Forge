// Forge-339b — Rectangular waveguide TE_mn / TM_mn modes (Pozar §3.3, Collin §5.2).
//   f_c,mn = c/(2·√ε_r) · √((m/a)² + (n/b)²)
//   Dominant TE10 mode: f_c10 = c/(2·a·√ε_r)
//   Phase constant β = √((2πf/c)² − k_c²)
//   Guided wavelength λ_g = 2π/β
//   Group velocity v_g = β·c² / (2πf)
//   Operating range: 1.25·f_c10 ≤ f ≤ 1.9·f_c10 (WR standard)

#pragma once

namespace forge::waveguide {

struct Input {
    double broadDim_a_mm;          // a (longer interior dim, typ 22.86 = WR-90)
    double narrowDim_b_mm;         // b
    double dielectric_eps_r;       // ε_r (1 = vacuum)
    double operatingFreq_GHz;
    int    modeM;
    int    modeN;
};

struct Result {
    double cutoffFreq_GHz;
    double cutoffWavelength_mm;
    double phaseConstant_beta_perM;
    double guidedWavelength_mm;
    double groupVelocity_mps;
    bool   isPropagating;          // f > f_c
};

Result analyse(const Input& in);

}  // namespace forge::waveguide
