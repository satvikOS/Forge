// Forge-338b — Sabine reverberation time (ISO 3382, Beranek Ch 9).
//   T_60 = 0.161 · V / Σ(α_i · S_i)             V m³, S m², α dimensionless
//   Diffuse absorption A_total = Σ(α_i · S_i)
//   Speech transmission index STI approximation from T_60:
//     STI ≈ 1 − (T_60 − 0.5) / 1.5      clipped to [0, 1]            (rough rule of thumb).

#pragma once

#include <vector>

namespace forge::reverb {

struct Surface {
    double area_m2;
    double absorption_alpha;     // 0..1
};

struct Input {
    std::vector<Surface> surfaces;
    double roomVolume_m3;
};

struct Result {
    double absorptionTotal_m2;
    double T60_s;
    double STI_estimate;
    bool   intelligible;           // STI ≥ 0.5
};

Result analyse(const Input& in);

}  // namespace forge::reverb
