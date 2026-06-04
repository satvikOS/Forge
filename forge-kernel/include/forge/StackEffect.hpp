// Forge-321e — Stack-effect draft pressure (ASHRAE Fundamentals Ch.16).
//   ΔP = g · h · (ρ_o − ρ_i)     Pa
//   ρ = p_atm / (R·T)             ideal-gas dry air, R = 287 J/kg·K

#pragma once

namespace forge::stackeffect {

struct Input {
    double stackHeightM;
    double indoorTempC;
    double outdoorTempC;
    double atmPressureKPa;        // default 101.325
};

struct Result {
    double indoorDensityKgPerM3;
    double outdoorDensityKgPerM3;
    double stackPressurePa;        // positive when indoor warmer (upward draft)
    double stackPressurePascalAtMidHeight;
    double airflowDirection;       // +1 upward, -1 downward
};

Result analyse(const Input& in);

}  // namespace forge::stackeffect
