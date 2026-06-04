// Forge-323a — Aircraft longitudinal static margin (Etkin Ch.6, Nelson §3).
//   x_NP/c̄ = x_AC,wing/c̄ + V_h · (C_Lα,tail / C_Lα,wing) · (1 - dε/dα)
//   SM = (x_NP - x_CG) / c̄

#pragma once

namespace forge::staticmargin {

struct Input {
    double xCG_normalized;             // x_CG / c̄
    double xACwing_normalized;         // x_AC / c̄
    double tailVolumeCoefficient;      // V_h = l_h·S_h / (c̄·S_w)
    double tailToWingCLalphaRatio;     // C_Lα,t / C_Lα,w
    double downwashGradient;           // dε/dα
};

struct Result {
    double xNP_normalized;
    double staticMargin;               // SM (fraction of c̄)
    bool   stable;                     // SM > 0
    bool   meetsTypicalDesignTarget;   // 0.05 ≤ SM ≤ 0.15
};

Result analyse(const Input& in);

}  // namespace forge::staticmargin
