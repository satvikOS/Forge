// Forge-328e — ASHRAE 90.1-2022 LPD (lighting power density) by space type.
//   P_installed = LPD · A_floor      W
//   Compare against allowance per Table 9.5.1 (building-area method)
//   or 9.6.1 (space-by-space method).

#pragma once

#include <string>

namespace forge::lpd {

struct Input {
    std::string spaceType;             // "office" 0.61, "retail" 0.84, "classroom" 0.71,
                                       // "warehouse" 0.49, "hospital" 0.85, "garage" 0.13
    double floorAreaM2;
    double installedPowerW;            // proposed design
};

struct Result {
    double allowanceWperM2;
    double allowedPowerW;
    double overshootW;
    double overshootPercent;
    bool   compliant;                  // installed ≤ allowed
};

Result analyse(const Input& in);

}  // namespace forge::lpd
