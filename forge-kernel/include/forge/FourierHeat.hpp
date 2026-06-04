// Forge-337d — Semi-infinite slab transient conduction (Carslaw-Jaeger §2.3).
//   Sudden surface temperature step T_s applied at t=0 to body initially at T_inf:
//     T(x, t) = T_inf + (T_s − T_inf) · erfc( x / (2·√(α·t)) )
//   Heat flux at surface:   q_s = (T_s − T_inf) · √(k·ρ·c_p / (π·t))
//   Penetration depth:      δ ≈ 4·√(α·t)             (T at this depth ≈ 1 % of step)

#pragma once

namespace forge::fourier {

struct Input {
    double surfaceTemperature_Ts_C;
    double initialTemperature_Tinf_C;
    double thermalConductivity_k_WmK;
    double density_rho_kgM3;
    double specificHeat_cp_JkgK;
    double depth_x_m;
    double time_t_s;
};

struct Result {
    double thermalDiffusivity_alpha_m2pers;
    double normalisedDepth_eta;          // η = x / (2·√(α·t))
    double temperatureAtDepth_C;
    double surfaceHeatFlux_Wm2;
    double penetrationDepth_m;            // δ = 4·√(α·t)
};

Result analyse(const Input& in);

}  // namespace forge::fourier
