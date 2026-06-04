// Forge-323e — NFPA 68 dust-explosion vent area (Eq 8.2.4-1).
//   A_v = (1 + 1.54·P_stat^(4/3)) · 1×10⁻⁴ · K_st · V^(3/4) / √(P_red − P_stat)   m²

#pragma once

namespace forge::dustvent {

struct Input {
    double vesselVolumeM3;
    double kstBarMperS;             // dust class metric K_St
    double maxAllowableOverpressureBar;   // P_red
    double ventReleasePressureBar;        // P_stat (0.1 typical)
};

struct Result {
    double ventAreaM2;
    double pressureMarginBar;       // P_red − P_stat (must be > 0)
};

Result analyse(const Input& in);

}  // namespace forge::dustvent
