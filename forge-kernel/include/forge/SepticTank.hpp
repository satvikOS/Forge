// Forge-321c — Residential septic-tank sizing (USDA-SSSA / EPA Onsite Wastewater).
//   V_total = N_people · q_per_person · (1 + sludge_volume_fraction) · retention_days
//   Standard: 600 L/person/day inflow, 30 day retention for primary settlement

#pragma once

namespace forge::septic {

struct Input {
    int occupants;
    double dailyFlowPerPersonL;     // 200 (low) - 600 (typical)
    double retentionDays;            // 1-3 typical
    double sludgeReserveFraction;    // 0.3 typical
};

struct Result {
    double dailyInflowL;
    double primaryStorageL;
    double sludgeReserveL;
    double totalVolumeL;
    double totalVolumeM3;
};

Result analyse(const Input& in);

}  // namespace forge::septic
