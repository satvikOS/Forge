// Forge-328c — Sound power → sound pressure (ISO 9613-2 spherical / hemisphere).
//   L_p = L_w + 10·log(Q / (4π·r²))                  Q directivity factor
//   Q = 1 free field, 2 floor reflection, 4 wall corner, 8 floor + 2 walls.

#pragma once

namespace forge::soundprop {

struct Input {
    double soundPowerLevelDbW;          // L_w (re 10⁻¹² W)
    double distanceM;                    // r
    double directivityQ;                 // 1 / 2 / 4 / 8
};

struct Result {
    double soundPressureLevelDbA;        // L_p
    double inverseSquareLossDb;          // term 10·log(Q/(4πr²))
};

Result analyse(const Input& in);

}  // namespace forge::soundprop
