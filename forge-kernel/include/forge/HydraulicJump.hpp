// Forge-319 — Rectangular-channel hydraulic jump (Belanger 1828 momentum
// equation, Chow "Open Channel Hydraulics" §15).
//
// Companion to Forge-242 open-channel flow (Manning + critical depth) —
// this slice quotes the downstream sequent depth y_2 created when a
// supercritical stream undergoes a stationary hydraulic jump (the classic
// energy dissipator at the foot of spillways, sluice gates, weirs, and
// stilling basins).
//
//   y_2 / y_1 = 0.5 · (√(1 + 8·Fr_1²) − 1)     Belanger eq. (rectangular)
//   Fr_1 = V_1 / √(g·y_1)                      upstream Froude
//
//   ΔE = (y_2 − y_1)³ / (4·y_1·y_2)            Chow eq. 15-7 specific-energy
//                                              loss across the jump
//   L  ≈ 6.1 · y_2                              Chow design recommendation
//                                              (5-7·y_2 range)
//
//   Jump classification by Fr_1 (Chow §15-2):
//     1.0–1.7  undular jump (small ripple, ΔE ~ 0)
//     1.7–2.5  weak jump
//     2.5–4.5  oscillating jump
//     4.5–9.0  steady jump (best energy dissipator)
//     > 9.0    strong jump (rough surface, ΔE > 70 %)

#pragma once

#include <string>

namespace forge::hydjump {

struct Input {
    double channelWidthB_m;          // rectangular b
    double upstreamDepthY1_m;        // y_1 (supercritical regime required)
    double dischargeQM3PerS;         // Q
    double gravityMs2;               // g, default 9.81
};

struct Result {
    double upstreamVelocityV1_ms;
    double upstreamFroudeNumber;
    double sequentDepthY2_m;
    double downstreamVelocityV2_ms;
    double downstreamFroudeNumber;
    double upstreamSpecificEnergyM;
    double downstreamSpecificEnergyM;
    double energyHeadLossM;
    double jumpEfficiencyPercent;
    double jumpLengthM;
    std::string jumpType;            // undular | weak | oscillating | steady | strong
};

Result analyse(const Input& in);

}  // namespace forge::hydjump
