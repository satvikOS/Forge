#pragma once

// Forge-226 — Rolling element bearing L10 rating life (ISO 281).
//
//   Equivalent dynamic load:   P = X · F_r + Y · F_a
//   Basic rating life (10^6 rev):
//     L_10 = (C / P)^p
//   where p = 3 (ball bearings) or 10/3 (roller bearings).
//
//   Reliability-adjusted life: L_na = a_1 · L_10
//   a_1 table (ISO 281):
//     90% reliability:  a_1 = 1.00
//     95%:              a_1 = 0.62
//     99%:              a_1 = 0.21
//     99.5%:            a_1 = 0.13
//     99.9%:            a_1 = 0.04

#include <string>

namespace forge { namespace bearing {

enum class Kind { Ball, Roller };

Kind kindFromString(const std::string& s);
double reliabilityFactor(double reliabilityPercent);

double equivalentLoad(double Fr, double Fa, double X, double Y);
double ratingLife10(double C, double P, Kind kind);

struct Inputs {
    double C;          // dynamic capacity, N
    double Fr;         // radial load, N
    double Fa;         // axial load, N
    double X;
    double Y;
    Kind   kind;
    double reliabilityPercent;
    double rpm;        // optional, > 0 to compute hours
};

struct Outputs {
    double equivalentLoad;        // P, N
    double L10MegaRev;            // L_10 in 10^6 rev
    double L10Hours;              // hours @ rpm (0 if rpm = 0)
    double LnaMegaRev;            // reliability-adjusted
    double LnaHours;
    double reliabilityFactor;
};

Outputs analyse(const Inputs& in);

}} // namespace forge::bearing
