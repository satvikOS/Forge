// Forge-329d — Belt-conveyor motor power (CEMA / DIN 22101 simplified).
//   P = F_eff · v / η
//   F_eff = C·f·L·g·(W_belt + W_idler + 2·W_mat) + W_mat·g·H
//     C    = secondary friction factor (1.1-1.3 short belts, 0.9 long)
//     f    = primary friction (0.02 typical)
//     L    = horizontal length, H = lift height
//     W's in kg/m

#pragma once

namespace forge::conveyor {

struct Input {
    double horizontalLengthM;
    double liftHeightM;
    double beltSpeedMs;
    double materialMassFlowKgPerS;
    double beltMassPerLengthKgM;
    double idlerMassPerLengthKgM;
    double primaryFriction;
    double drivetrainEfficiency;
};

struct Result {
    double materialPerLengthKgM;
    double effectiveTensionN;
    double powerRequiredKW;
};

Result analyse(const Input& in);

}  // namespace forge::conveyor
