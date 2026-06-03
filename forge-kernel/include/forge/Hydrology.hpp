// Forge-256 — Hydrology (rational method + Kirpich Tc + IDF).
//
// Rational method (SCS / Chow Ch. 14):
//   Q = C · i · A
//   SI: Q (m³/s), i (mm/hr) → m/s by ÷ 3.6e6, A (m²) → m²
//   Q_m³_s = C · (i / 3.6e6) · A_m²
//   Equivalent form with A in km²: Q = 0.278·C·i·A_km².
//
// Time of concentration (Kirpich 1940, agricultural watersheds):
//   T_c (min) = 0.0195 · L^0.77 · S^(-0.385)
//   L in metres, S as fraction (e.g. 0.01 for 1%)
//
// Rainfall intensity IDF curve approximation:
//   i (mm/hr) = a / (t + b)^c
//   Returned given a/b/c constants and duration t.

#pragma once

namespace forge::hydrology {

struct RunoffInput {
    double runoffCoefficient;       // C, dimensionless
    double rainfallIntensityMmHr;   // i, mm/hr
    double drainageAreaM2;          // A, m²
};

double rationalDischarge(const RunoffInput& in);  // m³/s

double kirpichTimeOfConcentrationMin(double flowPathM, double slopeFraction);

struct IdfInput {
    double a;
    double b;
    double c;
    double durationMin;
};

double idfIntensityMmHr(const IdfInput& in);

}  // namespace forge::hydrology
