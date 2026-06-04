// Forge-320d — Reverse-osmosis system sizing (van't Hoff osmotic pressure +
// flux balance, Dow FilmTec Technical Manual §1).
//
//   Recovery R     = Q_perm / Q_feed
//   Conc factor CF = 1 / (1 − R)
//   Brine TDS     ≈ CF · TDS_feed                    (mass balance)
//
//   van't Hoff osmotic pressure:
//     π[kPa] = i · C[mol/L] · R·T                    R = 8.314 J/mol·K, T in K
//     ≈ 80 kPa per 1000 ppm NaCl  (i = 2 ions)
//
//   Net driving pressure NDP = ΔP_applied − π_avg

#pragma once

namespace forge::ro {

struct Input {
    double feedFlowLpm;          // Q_feed (L/min)
    double recoveryFraction;     // R ∈ (0, 1)
    double feedTdsPpm;           // C_feed mg/L
    double appliedPressureBar;   // ΔP across membrane
    double temperatureC;
    double vantHoffFactorI;      // 2 for NaCl, 1 for sugar
};

struct Result {
    double permeateFlowLpm;
    double concentrateFlowLpm;
    double concentrationFactor;
    double brineTdsPpm;
    double averageOsmoticPressureKpa;
    double netDrivingPressureKpa;
    bool   pressureSufficient;
};

Result analyse(const Input& in);

}  // namespace forge::ro
