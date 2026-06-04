// Forge-325e — Welding electrode/wire consumption (AWS / Lincoln Procedure
// Handbook).
//   Fillet weld throat = leg/√2, area = (leg²)/2 mm² per mm length
//   Groove weld area = thickness · width (approximate V-groove area)
//   Deposit mass = volume · ρ_steel (7850 kg/m³)
//   Electrode mass = deposit / process_efficiency (SMAW 0.65, GMAW 0.85, FCAW 0.80)

#pragma once

#include <string>

namespace forge::weldelec {

struct Input {
    std::string weldType;          // "fillet" | "groove"
    double sizeMm;                 // leg size (fillet) or thickness (groove)
    double weldLengthM;
    double processEfficiency;      // 0.65 SMAW / 0.85 GMAW / 0.80 FCAW
    double electrodeCostPerKg;     // $/kg
    // groove only:
    double bevelAngleDeg;          // 60 typ
    double rootGapMm;              // 2 typ
};

struct Result {
    double weldAreaMm2;
    double weldVolumeM3;
    double depositMassKg;
    double electrodeMassKg;
    double electrodeCost;
};

Result analyse(const Input& in);

}  // namespace forge::weldelec
