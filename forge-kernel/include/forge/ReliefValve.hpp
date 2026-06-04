// Forge-325a — Pressure-relief valve sizing (API 520 Part I §5).
// Gas/vapor critical flow + liquid trim modes.

#pragma once

#include <string>

namespace forge::prv {

struct Input {
    std::string mode;                 // "gas" | "liquid"
    // common
    double inletPressureKpaAbs;
    double dischargeCoeffKd;          // 0.975 conventional, 0.65 rupture disk
    // gas
    double massFlowKgPerH;
    double inletTempK;
    double molecularWeight;
    double kRatio;                    // C_p/C_v (1.4 air, 1.13 R-134a)
    // liquid
    double volumeFlowLpm;
    double backPressureKpaAbs;
    double specificGravity;
};

struct Result {
    double gasCoefficientC;           // C(k) function for gas
    double requiredOrificeAreaMm2;    // calculated A
    double standardLetterOrificeMm2;  // next standard API 526 orifice (echoed below)
    std::string nextStandardOrifice;  // letter D/E/F/G/H/J/K/L/M/N/P/Q/R/T
};

Result analyse(const Input& in);

}  // namespace forge::prv
