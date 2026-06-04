// Forge-321d — Lapple cyclone separator cut diameter (Cooper & Alley §7).
//   d_50 = √(9·μ·W / (2π·N·V_i·(ρ_p − ρ_g)))
//   N    = number of effective turns (5-10 for Lapple HE)
//   W    = inlet width, V_i = inlet velocity

#pragma once

namespace forge::cyclone {

struct Input {
    double inletVelocityMs;
    double inletWidthM;
    double numberOfTurns;
    double gasViscosityPaS;       // air 1.8e-5
    double particleDensityKgPerM3;
    double gasDensityKgPerM3;     // air ~1.2
};

struct Result {
    double cutDiameterUm;          // d_50 (50% collection efficiency)
    double cutDiameterM;
};

Result analyse(const Input& in);

}  // namespace forge::cyclone
