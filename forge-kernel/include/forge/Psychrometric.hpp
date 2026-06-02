#pragma once

// Forge-192 — HVAC psychrometric chart calculator.
//
// ASHRAE 2017 Ch 1 psychrometrics:
//   Saturation pressure  ps(T) via Hyland-Wexler 1983 (T in K).
//   Humidity ratio       W  = 0.621945 · pw / (P − pw)
//   Enthalpy             h  = 1.006·Tdb + W·(2501 + 1.86·Tdb)        [kJ/kg]
//   Dew point            Tdp such that ps(Tdp) = pw
//   Wet bulb             Twb iteratively solved from the adiabatic-
//                        saturation equation.
//
// Given any two of (Tdb, RH, W, Tdp, Twb, h) compute the other four.

#include <cstdint>

namespace forge { namespace psychro {

// Saturation pressure (Pa) at T (°C). Negative-temperature branch uses
// the over-ice Hyland-Wexler set, positive uses over-water.
double saturationPressurePa(double tempC);

// Humidity ratio (kg water / kg dry air) at (vapour-pressure, total-pressure)
double humidityRatio(double pwPa, double pAtmPa);

// Enthalpy of moist air per kg dry air, kJ/kg.
double enthalpyKJperKg(double tempC, double humidityRatio);

// Dew-point temperature (°C) at a given vapour pressure (Pa). Uses
// Newton-Raphson on saturationPressurePa.
double dewPointC(double pwPa);

// Wet-bulb temperature (°C) given dry-bulb + humidity ratio + atmospheric
// pressure (Pa). Newton-Raphson on the adiabatic-saturation equation.
double wetBulbC(double tdbC, double humidityRatio, double pAtmPa);

struct State {
    double tdbC;          // dry bulb
    double rh;            // 0..1
    double humidityRatio; // kg/kg dry air
    double tdpC;          // dew point
    double twbC;          // wet bulb
    double enthalpyKJperKg;
    double vapourPressurePa;
    double satPressurePa;
    double atmPressurePa;
};

// Compute a complete state from any two of (Tdb, RH, W, Tdp, Twb, h)
// plus the atmospheric pressure.
//
// `which` is a bitmask telling the solver which two inputs are given,
// using these flags:
//   1 = Tdb (deg C)
//   2 = RH  (0..1)
//   4 = W   (kg/kg)
//   8 = Tdp (deg C)
//  16 = Twb (deg C)
//  32 = h   (kJ/kg)
//
// Throws std::invalid_argument if which has fewer or more than 2 bits
// set, or if the inputs are physically inconsistent.
State stateFromTwo(int whichMask,
                   double a, double b,
                   double pAtmPa);

}} // namespace forge::psychro
