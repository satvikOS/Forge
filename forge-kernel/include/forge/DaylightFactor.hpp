// Forge-330c — Average daylight factor (Lynes / BS 8206-2 / LEED v4.1).
//   DF_avg = (T · θ · A_glass · M) / (A_total · (1 − ρ_avg²))
//   T   visible transmittance
//   θ   visible sky angle (deg) seen from window centre
//   M   maintenance factor (0.8 typ, 0.7 dirty, 0.9 clean)
//   ρ_avg area-weighted average surface reflectance (walls + ceiling + floor).

#pragma once

namespace forge::daylight {

struct Input {
    double visibleTransmittance;   // T (0–1)
    double skyAngleDeg;            // θ
    double glazingArea_m2;
    double maintenanceFactor;      // M
    double totalSurfaceArea_m2;    // 2(LW + LH + WH) interior
    double avgReflectance;         // ρ (0–1)
};

struct Result {
    double daylightFactorPct;
    bool   meetsLeed2pct;          // LEED EQc8.1 option 2 ≥ 2 %
    bool   meetsLeed3pct;          // EN 17037 minimum target
};

Result analyse(const Input& in);

}  // namespace forge::daylight
