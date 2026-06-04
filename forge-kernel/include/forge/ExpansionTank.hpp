// Forge-325b — Closed-loop hydronic expansion-tank sizing (ASHRAE Fund Ch 13).
//   V_tank = V_sys · (ρ_min/ρ_max − 1) · P_atm / (P_min·(1 − P_min/P_max))
//   ρ(T) = 999.97 + 0.0156·T − 0.00574·T² + 1.49e-5·T³  kg/m³  (Kell 1975 fit)

#pragma once

namespace forge::extank {

struct Input {
    double systemVolumeLiters;
    double minTempC;                  // fill / coldest expected
    double maxTempC;                  // service / hottest expected
    double minPressureBarAbs;         // bladder pre-charge / system fill
    double maxPressureBarAbs;         // relief setting
};

struct Result {
    double densityMinKgPerM3;
    double densityMaxKgPerM3;
    double expansionFraction;         // Δv/v_min
    double expansionVolumeLiters;
    double pressureFactor;            // P_atm / (P_min·(1 − P_min/P_max))
    double tankVolumeLiters;
};

Result analyse(const Input& in);

}  // namespace forge::extank
