// Forge-328d — ICAO standard atmosphere (ISA 1976 troposphere model).
//   T = T_0 − L·h                       L = 0.0065 K/m, T_0 = 288.15 K
//   p = p_0 · (T/T_0)^(g/(R·L))         p_0 = 101.325 kPa
//   ρ = p / (R·T)                        R = 287 J/kg·K

#pragma once

namespace forge::isa {

struct Input {
    double altitudeM;                  // up to 11000 m (troposphere)
};

struct Result {
    double temperatureK;
    double temperatureC;
    double pressureKpa;
    double densityKgM3;
    double speedOfSoundMs;             // √(k·R·T), k=1.4
};

Result analyse(const Input& in);

}  // namespace forge::isa
