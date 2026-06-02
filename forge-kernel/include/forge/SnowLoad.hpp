#pragma once

// Forge-225 — Snow load (ASCE 7-22 Ch. 7).
//
//   Flat roof snow load    p_f = 0.7 · C_e · C_t · I_s · p_g
//   Sloped roof snow load  p_s = C_s · p_f
//
//   Slope factor C_s (warm roof, C_t ≤ 1.0):
//     θ ≤ 30°:  C_s = 1.0
//     30° < θ < 70°:  C_s = 1 − (θ − 30)/40
//     θ ≥ 70°:  C_s = 0
//   For cold roof (C_t > 1.0), the breakpoints shift to 45°/70°.

#include <string>

namespace forge { namespace snowload {

enum class Exposure { FullyExposed, PartiallyExposed, Sheltered };
enum class Thermal  { Heated, JustAboveFreezing, Unheated, ColdAboveVent };
enum class RiskCategory { I, II, III, IV };

Exposure     exposureFromString(const std::string& s);
Thermal      thermalFromString(const std::string& s);
RiskCategory riskFromString(const std::string& s);

double exposureFactor(Exposure e);
double thermalFactor(Thermal t);
double importanceFactor(RiskCategory r);

struct Inputs {
    double       groundSnowPa;
    Exposure     exposure;
    Thermal      thermal;
    RiskCategory risk;
    double       slopeDeg;
};

struct Outputs {
    double flatRoofPa;
    double slopeFactor;
    double slopedRoofPa;
};

Outputs analyse(const Inputs& in);

}} // namespace forge::snowload
